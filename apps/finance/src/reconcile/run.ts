// `finance reconcile`: load staging → pure rules + classifier → rewrite
// recon_link and recon_status in ONE transaction (PRD §9 "Atomic").
// recon_manual_override is only ever read here.
import type pg from "pg";
import { behaviourConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withRun } from "../db/sync-run.js";
import { logger } from "../lib/logger.js";
import { parseSquareNote } from "../sources/square/note.js";
import { classify } from "./classify.js";
import { matchAll } from "./rules.js";
import type { ReconConfig, ReconInput } from "./types.js";

const n = (v: string | number | null) => (v === null ? 0 : Number(v)); // bigint cents arrive as strings

async function loadInput(client: pg.PoolClient): Promise<ReconInput> {
  const q = async <R extends pg.QueryResultRow>(sql: string) => (await client.query<R>(sql)).rows;

  const appointments = (
    await q<Record<string, string | null> & { paid: boolean; is_canceled: boolean }>(
      `SELECT appointment_id::text AS id, local_date, client_email_norm, type_name, list_price_cents, price_cents,
              discount_cents, amount_paid_cents, tip_cents, code_extra_paid_cents, paid, certificate_kind, is_canceled
         FROM finance.stg_acuity_appointment ORDER BY appointment_id`,
    )
  ).map((r) => ({
    id: r.id!,
    localDate: r.local_date!,
    email: r.client_email_norm,
    typeName: r.type_name,
    listPriceCents: n(r.list_price_cents),
    priceCents: n(r.price_cents),
    discountCents: n(r.discount_cents),
    amountPaidCents: n(r.amount_paid_cents),
    tipCents: n(r.tip_cents),
    codeExtraPaidCents: n(r.code_extra_paid_cents),
    paid: r.paid,
    certificateKind: r.certificate_kind,
    isCanceled: r.is_canceled,
  }));

  const payments = (
    await q<Record<string, string | null>>(
      `SELECT acuity_payment_key, appointment_id::text AS appointment_id, processor, processor_txn_id, amount_cents,
              to_char(paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS paid_at, local_date
         FROM finance.stg_acuity_payment ORDER BY acuity_payment_key`,
    )
  ).map((r) => ({
    key: r.acuity_payment_key!,
    appointmentId: r.appointment_id!,
    processor: r.processor,
    txnId: r.processor_txn_id,
    amountCents: n(r.amount_cents),
    paidAt: r.paid_at,
    payDate: r.local_date,
  }));

  const orders = (
    await q<Record<string, string | null>>(
      `SELECT order_id::text AS id, local_date, client_email_norm, total_cents, status,
              to_char(ordered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ordered_at
         FROM finance.stg_acuity_order ORDER BY order_id`,
    )
  ).map((r) => ({
    id: r.id!,
    localDate: r.local_date,
    orderedAt: r.ordered_at,
    email: r.client_email_norm,
    totalCents: n(r.total_cents),
    status: r.status,
  }));

  const square = (
    await q<Record<string, string | null>>(
      `SELECT p.payment_id, to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              p.local_date, p.status, p.amount_cents, p.refunded_cents, p.order_id, coalesce(o.discount_cents, 0) AS order_discount_cents,
              p.buyer_email_norm, p.square_product, p.acuity_ref_kind, p.acuity_ref, p.acuity_certificate_code, p.note
         FROM finance.stg_square_payment p
         LEFT JOIN finance.stg_square_order o ON o.order_id = p.order_id
        ORDER BY p.payment_id`,
    )
  ).map((r) => ({
    id: r.payment_id!,
    createdAt: r.created_at!,
    localDate: r.local_date!,
    status: r.status!,
    amountCents: n(r.amount_cents),
    refundedCents: n(r.refunded_cents),
    orderId: r.order_id,
    orderDiscountCents: n(r.order_discount_cents),
    email: r.buyer_email_norm,
    squareProduct: r.square_product,
    refKind: r.acuity_ref_kind ?? "empty",
    ref: r.acuity_ref,
    certificateCode: r.acuity_certificate_code,
    // The note is parsed here and never stored or logged: 2020 notes contain client names.
    noteClassDate: ((ref) => (ref.kind === "dated" ? (ref.classDate ?? null) : null))(parseSquareNote(r.note)),
  }));

  const certificateCodes = new Set(
    (
      await q<{ code: string }>(
        `SELECT upper(payload ->> 'certificate') AS code FROM finance.raw_record WHERE source = 'acuity' AND entity = 'certificate'`,
      )
    ).map((r) => r.code),
  );

  const overrides = (
    await q<Record<string, string | null>>(
      `SELECT id::text AS id, acuity_kind, acuity_id, square_payment_id, reason_code, note FROM finance.recon_manual_override ORDER BY id`,
    )
  ).map((r) => ({
    id: r.id!,
    acuityKind: r.acuity_kind as "appointment" | "order",
    acuityId: r.acuity_id!,
    squarePaymentId: r.square_payment_id,
    reasonCode: r.reason_code!,
    note: r.note,
  }));

  return { appointments, payments, orders, square, certificateCodes, overrides };
}

export interface ReconcileOptions {
  from?: string;
  to?: string;
  dryRun?: boolean;
}

export async function runReconcile(opts: ReconcileOptions = {}): Promise<void> {
  const beh = behaviourConfig();
  const cfg: ReconConfig = {
    matchWindowMinutes: beh.matchWindowMinutes,
    membershipTypePatterns: beh.membershipTypePatterns,
    window: { from: opts.from ?? beh.seedStart, to: opts.to ?? beh.seedEnd },
  };

  const body = async (runId: number | null) => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const input = await loadInput(client);
      const links = matchAll(input, cfg);
      const statuses = classify(input, links, cfg);

      await client.query(`DELETE FROM finance.recon_link`);
      await client.query(`DELETE FROM finance.recon_status`);
      await client.query(
        `INSERT INTO finance.recon_link (acuity_kind, acuity_id, square_payment_id, rule, confidence, allocated_cents, evidence, sync_run_id)
         SELECT acuity_kind, acuity_id, square_payment_id, rule, confidence, allocated_cents, evidence, $2
           FROM jsonb_to_recordset($1::jsonb) AS r(acuity_kind text, acuity_id text, square_payment_id text, rule text,
                confidence text, allocated_cents bigint, evidence jsonb)`,
        [
          JSON.stringify(
            links.map((l) => ({
              acuity_kind: l.acuityKind,
              acuity_id: l.acuityId,
              square_payment_id: l.squarePaymentId,
              rule: l.rule,
              confidence: l.confidence,
              allocated_cents: l.allocatedCents,
              evidence: l.evidence,
            })),
          ),
          runId,
        ],
      );
      await client.query(
        `INSERT INTO finance.recon_status (side, kind, id, local_date, status, reason_code, exception, expected_cents, actual_cents, delta_cents, sync_run_id)
         SELECT side, kind, id, local_date, status, reason_code, exception, expected_cents, actual_cents, delta_cents, $2
           FROM jsonb_to_recordset($1::jsonb) AS r(side text, kind text, id text, local_date date, status text, reason_code text,
                exception boolean, expected_cents bigint, actual_cents bigint, delta_cents bigint)`,
        [
          JSON.stringify(
            statuses.map((s) => ({
              side: s.side,
              kind: s.kind,
              id: s.id,
              local_date: s.localDate,
              status: s.status,
              reason_code: s.reasonCode,
              exception: s.exception,
              expected_cents: s.expectedCents,
              actual_cents: s.actualCents,
              delta_cents: s.deltaCents,
            })),
          ),
          runId,
        ],
      );
      await client.query(opts.dryRun ? "ROLLBACK" : "COMMIT");

      const byRule = new Map<string, number>();
      for (const l of links) byRule.set(l.rule, (byRule.get(l.rule) ?? 0) + 1);
      const exceptions = statuses.filter((s) => s.exception).length;
      const unknown = statuses.filter((s) => s.reasonCode === "UNKNOWN").length;
      logger.info(
        { window: cfg.window, links: links.length, byRule: Object.fromEntries(byRule), statuses: statuses.length, exceptions, unknown },
        opts.dryRun ? "dry run: reconciled (rolled back)" : "reconciled",
      );
      return { links: links.length, statuses: statuses.length };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  if (opts.dryRun) {
    await body(null);
    return;
  }
  await withRun({ job: "reconcile", windowStart: cfg.window.from, windowEnd: cfg.window.to }, async (runId) => {
    const r = await body(runId);
    return { result: undefined, rowsNew: r.links + r.statuses };
  });
}

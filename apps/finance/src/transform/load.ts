// `finance transform`: rebuild staging from raw (PRD §7.3).
//
// Strategy: delete + reload every selected staging table inside ONE transaction.
// Why not upsert? At this volume (thousands of rows) a full rebuild takes
// seconds, is trivially deterministic, and readers never see a half-built
// state: until COMMIT they keep seeing the previous staging data.
//
// Memory stays flat: raw rows are read in pages of 1,000 (keyset on id), mapped
// with the pure functions in acuity.ts / square.ts, and inserted page by page.
import type pg from "pg";
import { behaviourConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withRun } from "../db/sync-run.js";
import { logger } from "../lib/logger.js";
import type { Source } from "../raw/repo.js";
import { toStgAcuityAppointment, toStgAcuityOrder, toStgAcuityPayment, type AcuityCtx } from "./acuity.js";
import {
  toStgSquareInvoice,
  toStgSquareOrder,
  toStgSquarePayment,
  toStgSquareRefund,
  type SquareCtx,
} from "./square.js";
import type { MapResult, RawRow } from "./types.js";

const PAGE = 1000;

/** Column name → Postgres type, used to unpack rows with jsonb_to_recordset. */
type Columns = Record<string, string>;

interface Target {
  table: string; // fixed allow-list: these are the only identifiers ever put into SQL text
  columns: Columns;
}

interface Spec {
  key: string; // "<source>.<entity>", also the transform_error.entity value
  source: Source;
  entity: string;
  targets: Target[]; // first = main table; others = child tables (e.g. order discounts)
  map: (raw: RawRow, ctx: Ctx) => MapResult<Record<string, unknown>[][]>; // rows per target
}

interface Ctx {
  acuity: AcuityCtx;
  square: SquareCtx;
}

const T = {
  acuityAppointment: {
    table: "finance.stg_acuity_appointment",
    columns: {
      appointment_id: "bigint", raw_record_id: "bigint", starts_at: "timestamptz", local_date: "date", source_tz: "text",
      type_id: "bigint", type_name: "text", calendar_id: "bigint", calendar_name: "text", client_email_norm: "text",
      client_name: "text", list_price_cents: "bigint", price_cents: "bigint", discount_cents: "bigint",
      amount_paid_cents: "bigint", tip_cents: "bigint", code_extra_paid_cents: "bigint", paid: "boolean",
      certificate_code: "text", certificate_kind: "text", is_canceled: "boolean", no_show: "boolean",
      booked_at: "timestamptz", labels: "text[]", missing_since: "timestamptz",
    },
  },
  acuityPayment: {
    table: "finance.stg_acuity_payment",
    columns: {
      acuity_payment_key: "text", raw_record_id: "bigint", appointment_id: "bigint", processor: "text",
      processor_txn_id: "text", amount_cents: "bigint", paid_at: "timestamptz", local_date: "date",
      related_payments_count: "integer", missing_since: "timestamptz",
    },
  },
  acuityOrder: {
    table: "finance.stg_acuity_order",
    columns: {
      order_id: "bigint", raw_record_id: "bigint", ordered_at: "timestamptz", local_date: "date", total_cents: "bigint",
      status: "text", title: "text", product_summary: "text", client_email_norm: "text", missing_since: "timestamptz",
    },
  },
  squarePayment: {
    table: "finance.stg_square_payment",
    columns: {
      payment_id: "text", raw_record_id: "bigint", created_at: "timestamptz", local_date: "date", status: "text",
      amount_cents: "bigint", tip_cents: "bigint", total_cents: "bigint", refunded_cents: "bigint", fee_cents: "bigint",
      source_type: "text", square_product: "text", order_id: "text", invoice_id: "text", customer_id: "text",
      buyer_email_norm: "text", note: "text", reference_id: "text", acuity_ref_kind: "text", acuity_ref: "text",
      acuity_certificate_code: "text", missing_since: "timestamptz",
    },
  },
  squareOrder: {
    table: "finance.stg_square_order",
    columns: {
      order_id: "text", raw_record_id: "bigint", created_at: "timestamptz", local_date: "date", total_cents: "bigint",
      discount_cents: "bigint", tax_cents: "bigint", tip_cents: "bigint", line_item_count: "integer",
      line_item_summary: "text", source_name: "text", invoice: "boolean", missing_since: "timestamptz",
    },
  },
  squareOrderDiscount: {
    table: "finance.stg_square_order_discount",
    columns: {
      order_id: "text", discount_uid: "text", raw_record_id: "bigint", name: "text", type: "text", scope: "text",
      applied_cents: "bigint",
    },
  },
  squareRefund: {
    table: "finance.stg_square_refund",
    columns: {
      refund_id: "text", raw_record_id: "bigint", payment_id: "text", created_at: "timestamptz", local_date: "date",
      amount_cents: "bigint", status: "text", reason: "text", missing_since: "timestamptz",
    },
  },
  squareInvoice: {
    table: "finance.stg_square_invoice",
    columns: {
      invoice_id: "text", raw_record_id: "bigint", order_id: "text", invoice_number: "text", title: "text",
      status: "text", created_at: "timestamptz", local_date: "date", due_date: "date", requested_cents: "bigint",
      paid_cents: "bigint", customer_id: "text", missing_since: "timestamptz",
    },
  },
} satisfies Record<string, Target>;

// Wrap a single-row mapper so every spec returns "rows per target".
const one =
  <C>(fn: (raw: RawRow, ctx: C) => MapResult<object>) =>
  (raw: RawRow, ctx: C): MapResult<Record<string, unknown>[][]> => {
    const r = fn(raw, ctx);
    return r.ok ? { ok: true, row: [[r.row as Record<string, unknown>]] } : r;
  };

export const SPECS: Spec[] = [
  { key: "acuity.appointment", source: "acuity", entity: "appointment", targets: [T.acuityAppointment], map: (r, c) => one(toStgAcuityAppointment)(r, c.acuity) },
  { key: "acuity.appointment_payment", source: "acuity", entity: "appointment_payment", targets: [T.acuityPayment], map: (r, c) => one(toStgAcuityPayment)(r, c.acuity) },
  { key: "acuity.order", source: "acuity", entity: "order", targets: [T.acuityOrder], map: (r, c) => one(toStgAcuityOrder)(r, c.acuity) },
  { key: "square.payment", source: "square", entity: "payment", targets: [T.squarePayment], map: (r, c) => one(toStgSquarePayment)(r, c.square) },
  {
    key: "square.order",
    source: "square",
    entity: "order",
    targets: [T.squareOrder, T.squareOrderDiscount],
    map: (r, c) => {
      const res = toStgSquareOrder(r, c.square);
      return res.ok ? { ok: true, row: [[res.row.order as unknown as Record<string, unknown>], res.row.discounts as unknown as Record<string, unknown>[]] } : res;
    },
  },
  { key: "square.refund", source: "square", entity: "refund", targets: [T.squareRefund], map: (r, c) => one(toStgSquareRefund)(r, c.square) },
  { key: "square.invoice", source: "square", entity: "invoice", targets: [T.squareInvoice], map: (r, c) => one(toStgSquareInvoice)(r, c.square) },
];

/** Small lookups the mappers need, read straight from raw (only the fields required). */
async function buildCtx(client: pg.PoolClient): Promise<Ctx> {
  const tz = behaviourConfig().reportingTz;
  const q = async <R extends pg.QueryResultRow>(sql: string) => (await client.query<R>(sql)).rows;

  const certs = await q<{ code: string; product_type: string | null }>(
    `SELECT upper(payload ->> 'certificate') AS code, payload ->> 'productType' AS product_type
       FROM finance.raw_record WHERE source = 'acuity' AND entity = 'certificate'`,
  );
  const customers = await q<{ id: string; email: string | null }>(
    `SELECT external_id AS id, payload ->> 'email_address' AS email
       FROM finance.raw_record WHERE source = 'square' AND entity = 'customer'`,
  );
  const aliases = await q<{ id: string; customer_id: string }>(
    `SELECT external_id AS id, payload ->> 'customer_id' AS customer_id
       FROM finance.raw_record WHERE source = 'square' AND entity = 'customer_alias'`,
  );
  const orderCustomers = await q<{ id: string; customer_id: string }>(
    `SELECT external_id AS id, payload ->> 'customer_id' AS customer_id
       FROM finance.raw_record WHERE source = 'square' AND entity = 'order' AND payload ? 'customer_id'`,
  );
  const invoices = await q<{ id: string; order_id: string }>(
    `SELECT external_id AS id, payload ->> 'order_id' AS order_id
       FROM finance.raw_record WHERE source = 'square' AND entity = 'invoice' AND payload ? 'order_id'`,
  );
  return {
    acuity: { tz, certificatesByCode: new Map(certs.map((c) => [c.code, { productType: c.product_type }])) },
    square: {
      tz,
      customerEmailById: new Map(customers.filter((c) => c.email).map((c) => [c.id, c.email!])),
      customerAlias: new Map(aliases.map((a) => [a.id, a.customer_id])),
      orderCustomerById: new Map(orderCustomers.map((o) => [o.id, o.customer_id])),
      invoiceIdByOrderId: new Map(invoices.map((i) => [i.order_id, i.id])),
    },
  };
}

async function insertRows(client: pg.PoolClient, target: Target, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const cols = Object.keys(target.columns);
  const recordset = cols.map((c) => `${c} ${target.columns[c]}`).join(", ");
  await client.query(
    `INSERT INTO ${target.table} (${cols.join(", ")})
     SELECT ${cols.join(", ")} FROM jsonb_to_recordset($1::jsonb) AS r(${recordset})`,
    [JSON.stringify(rows)],
  );
}

export interface TransformOptions {
  entity?: string; // a SPECS key, e.g. "acuity.appointment"
  dryRun?: boolean;
}

export interface SpecCounts {
  key: string;
  raw: number;
  staged: number;
  errors: number;
}

/** Rebuild the selected staging tables. Everything happens in one transaction. */
export async function rebuildStaging(client: pg.PoolClient, runId: number | null, specs: Spec[]): Promise<SpecCounts[]> {
  const ctx = await buildCtx(client);

  // Children before parents (order discounts reference orders).
  for (const spec of specs) for (const t of [...spec.targets].reverse()) await client.query(`DELETE FROM ${t.table}`);
  await client.query(`DELETE FROM finance.transform_error WHERE entity = ANY($1::text[])`, [specs.map((s) => s.key)]);

  const counts: SpecCounts[] = [];
  for (const spec of specs) {
    const c: SpecCounts = { key: spec.key, raw: 0, staged: 0, errors: 0 };
    let lastId = "0";
    for (;;) {
      const { rows } = await client.query<RawRow>(
        `SELECT id::text AS id, external_id, parent_external_id, payload, missing_since
           FROM finance.raw_record
          WHERE source = $1 AND entity = $2 AND id > $3::bigint
          ORDER BY id LIMIT ${PAGE}`,
        [spec.source, spec.entity, lastId],
      );
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;

      const perTarget: Record<string, unknown>[][] = spec.targets.map(() => []);
      const errors: Array<{ raw_record_id: string; message: string }> = [];
      for (const raw of rows) {
        const res = spec.map(raw, ctx);
        if (res.ok) res.row.forEach((list, i) => perTarget[i].push(...list));
        else errors.push({ raw_record_id: raw.id, message: res.error.slice(0, 2000) });
      }
      for (let i = 0; i < spec.targets.length; i++) await insertRows(client, spec.targets[i], perTarget[i]);
      if (errors.length) {
        await client.query(
          `INSERT INTO finance.transform_error (raw_record_id, entity, message, sync_run_id)
           SELECT raw_record_id, $2, message, $3 FROM jsonb_to_recordset($1::jsonb) AS r(raw_record_id bigint, message text)`,
          [JSON.stringify(errors), spec.key, runId],
        );
      }
      c.raw += rows.length;
      c.staged += perTarget[0].length;
      c.errors += errors.length;
    }
    counts.push(c);
  }
  return counts;
}

export async function runTransform(opts: TransformOptions): Promise<void> {
  const specs = opts.entity ? SPECS.filter((s) => s.key === opts.entity) : SPECS;
  if (specs.length === 0) {
    throw new Error(`Unknown --entity "${opts.entity}". Use one of: ${SPECS.map((s) => s.key).join(", ")}`);
  }

  const body = async (runId: number | null) => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const counts = await rebuildStaging(client, runId, specs);
      // A dry run does all the work, reports it, and throws it away.
      await client.query(opts.dryRun ? "ROLLBACK" : "COMMIT");
      for (const c of counts) logger.info(c, opts.dryRun ? "dry run: would stage" : "staged");
      return counts;
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
  await withRun({ job: "transform" }, async (runId) => {
    const counts = await body(runId);
    const errors = counts.reduce((s, c) => s + c.errors, 0);
    if (errors) logger.warn({ errors }, "some raw records could not be mapped — see finance.transform_error");
    return { result: undefined, rowsNew: counts.reduce((s, c) => s + c.staged, 0) };
  });
}

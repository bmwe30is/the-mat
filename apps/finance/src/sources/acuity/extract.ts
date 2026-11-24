// `finance extract --source acuity` (PRD Phase 3): land Acuity data in raw_record.
//
// Order of work:
//   1. Small lookups, pulled in full every run: calendars, appointment types,
//      products, certificates, orders. (/orders and /certificates have no date filter.)
//   2. Appointments month by month over the seed window, each month padded ±1 day.
//      After each month: payments for paid appointments that are new/changed (or
//      have none stored yet), then the resume cursor is saved.
//
// API calls happen OUTSIDE database transactions (they're slow at 1 req/s);
// each month's writes are then committed in one short transaction.
import { behaviourConfig } from "../../config.js";
import { getCursor, setCursor } from "../../db/cursor.js";
import { getPool, withTransaction } from "../../db/pool.js";
import { withRun } from "../../db/sync-run.js";
import { logger } from "../../lib/logger.js";
import { decimalToCents } from "../../lib/money.js";
import { markMissing, parentsWithChildren, upsertRaw, type RawInput, type UpsertCounts } from "../../raw/repo.js";
import { AcuityClient } from "./client.js";
import { monthChunks, paddedDates } from "../../lib/windows.js";
import { appointmentToRaw, lookupToRaw, orderToRaw, paymentsToRaw } from "./raw-mapping.js";

/** Far above any month's volume (2020 had ~260/month). Hitting it means data was cut off. */
const APPOINTMENT_MAX = 5000;
const ORDER_MAX = 5000;

export interface AcuityExtractOptions {
  from?: string;
  to?: string;
  resume?: boolean;
  dryRun?: boolean;
  refreshPayments?: boolean;
}

type Totals = UpsertCounts & { missing: number };

export async function runAcuityExtract(opts: AcuityExtractOptions): Promise<void> {
  const beh = behaviourConfig();
  const from = opts.from ?? beh.seedStart;
  const to = opts.to ?? beh.seedEnd;
  const acuity = new AcuityClient();

  const body = async (runId: number) => {
    const totals: Totals = { new: 0, changed: 0, unchanged: 0, missing: 0 };
    const perEntity = new Map<string, Totals>();
    const add = (entity: string, c: UpsertCounts, missing = 0) => {
      const t = perEntity.get(entity) ?? { new: 0, changed: 0, unchanged: 0, missing: 0 };
      for (const k of ["new", "changed", "unchanged"] as const) {
        t[k] += c[k];
        totals[k] += c[k];
      }
      t.missing += missing;
      totals.missing += missing;
      perEntity.set(entity, t);
    };

    // Write one entity's records (+ optional missing check) in one transaction.
    const land = async (
      entity: string,
      records: RawInput[],
      missingScope?: { window?: { from: string; to: string }; parentIds?: string[] },
      cursor?: { key: string; value: string },
    ) =>
      withTransaction(async (client) => {
        const res = await upsertRaw(client, { source: "acuity", entity, runId, records, dryRun: opts.dryRun });
        let missing = 0;
        if (!opts.dryRun && missingScope) missing = await markMissing(client, { source: "acuity", entity, runId, ...missingScope });
        if (!opts.dryRun && cursor) await setCursor(client, cursor.key, cursor.value);
        add(entity, res, missing);
        return res;
      });

    // 1. Lookups — full pulls, so "missing" means "gone from the whole list".
    const lookups: Array<[string, () => Promise<Array<{ id: number | string }>>]> = [
      ["calendar", acuity.calendars],
      ["appointment_type", acuity.appointmentTypes as () => Promise<Array<{ id: number }>>],
      ["product", acuity.products as () => Promise<Array<{ id: number }>>],
      ["certificate", acuity.certificates],
    ];
    for (const [entity, fetchAll] of lookups) {
      await land(entity, (await fetchAll()).map(lookupToRaw), {});
    }
    const orders = await acuity.orders({ max: ORDER_MAX });
    if (orders.length >= ORDER_MAX) throw new Error(`/orders returned ${orders.length} = max; raise ORDER_MAX`);
    await land("order", orders.map((o) => orderToRaw(o, beh.reportingTz)), {});

    // 2. Appointments + payments, month by month.
    const cursorKey = `acuity:appointment:${from}..${to}`;
    const done = opts.resume ? await getCursor(cursorKey) : undefined;
    const chunks = monthChunks(from, to).filter((c) => !done || c.month > done);
    if (done) logger.info({ resumeAfter: done, remaining: chunks.length }, "resuming");

    for (const chunk of chunks) {
      const padded = paddedDates(chunk);
      const appts = await acuity.appointments({ minDate: padded.from, maxDate: padded.to, max: APPOINTMENT_MAX });
      if (appts.length >= APPOINTMENT_MAX) {
        throw new Error(`${chunk.month}: /appointments returned ${appts.length} = max; data would be cut off`);
      }
      const res = await land(
        "appointment",
        appts.map((a) => appointmentToRaw(a, beh.reportingTz)),
        { window: padded },
      );

      // Payments: one API call per appointment, so only where something could have changed.
      const paid = appts.filter((a) => decimalToCents(a.amountPaid) > 0);
      const already = await parentsWithChildren(getPool(), {
        source: "acuity",
        entity: "appointment_payment",
        parentIds: paid.map((a) => String(a.id)),
      });
      const toFetch = paid.filter(
        (a) => opts.refreshPayments || res.statusById.get(String(a.id)) !== "unchanged" || !already.has(String(a.id)),
      );
      const paymentRows: RawInput[] = [];
      for (const a of toFetch) paymentRows.push(...paymentsToRaw(a.id, await acuity.appointmentPayments(a.id)));
      await land(
        "appointment_payment",
        paymentRows,
        { parentIds: toFetch.map((a) => String(a.id)) },
        { key: cursorKey, value: chunk.month },
      );

      logger.info(
        { month: chunk.month, appointments: appts.length, ...pick(res), paymentLookups: toFetch.length, apiCalls: acuity.http.calls },
        "month done",
      );
    }

    for (const [entity, t] of perEntity) logger.info({ entity, ...t }, opts.dryRun ? "dry run: would write" : "landed");
    logger.info({ ...totals, apiCalls: acuity.http.calls }, opts.dryRun ? "dry run total (nothing written)" : "extract total");
    return {
      result: undefined,
      apiCalls: acuity.http.calls,
      rowsNew: totals.new,
      rowsChanged: totals.changed,
      rowsUnchanged: totals.unchanged,
    };
  };

  // A dry run writes nothing at all — not even a sync_run row.
  if (opts.dryRun) await body(0);
  else await withRun({ job: "extract", source: "acuity", windowStart: from, windowEnd: to }, body);
}

const pick = (c: UpsertCounts) => ({ new: c.new, changed: c.changed, unchanged: c.unchanged });

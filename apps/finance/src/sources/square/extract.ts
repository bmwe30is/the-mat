// `finance extract --source square` (PRD Phase 4): land Square data in raw_record.
//
// Goal: never lose a transaction. Every payment and refund in the window is
// kept whatever its status, every invoice is kept (paid or not), and the order
// behind each payment and invoice is fetched.
//
// Order of work:
//   1. Invoices — full pull (SearchInvoices has no date filter).
//   2. Payments + refunds month by month over the seed window (LA months, padded
//      ±1 day, as UTC instants). After each month: the orders of new/changed
//      payments (or any not stored yet), then the resume cursor is saved.
//   3. Orders behind invoices (an unpaid invoice has an order but no payment).
//   4. Customers referenced by any stored payment, order or invoice and not yet stored.
//      (2020 payments carry no customer_id, but their orders do.)
//
// API calls happen outside DB transactions; each step commits in one transaction.
import { behaviourConfig, squareConfig } from "../../config.js";
import { getCursor, setCursor } from "../../db/cursor.js";
import { getPool, withTransaction } from "../../db/pool.js";
import { withRun } from "../../db/sync-run.js";
import { logger } from "../../lib/logger.js";
import { monthChunks, paddedDates } from "../../lib/windows.js";
import { markMissing, storedIds, upsertRaw, type RawInput, type UpsertCounts, type UpsertResult } from "../../raw/repo.js";
import { SquareClient } from "./client.js";
import {
  customerAliasToRaw,
  customerToRaw,
  idsToFetch,
  invoiceToRaw,
  orderToRaw,
  paymentToRaw,
  refundToRaw,
  squareWindow,
} from "./raw-mapping.js";

export interface SquareExtractOptions {
  from?: string;
  to?: string;
  resume?: boolean;
  dryRun?: boolean;
  refreshCustomers?: boolean;
}

type Totals = UpsertCounts & { missing: number };
type MissingScope = { window?: { from: string; to: string }; ids?: string[] } | undefined;

export async function runSquareExtract(opts: SquareExtractOptions): Promise<void> {
  if (!squareConfig().locationId) {
    throw new Error("SQUARE_LOCATION_ID is empty in apps/finance/.env (the probe found EAJEBA375QYQN).");
  }
  const beh = behaviourConfig();
  const tz = beh.reportingTz;
  const from = opts.from ?? beh.seedStart;
  const to = opts.to ?? beh.seedEnd;
  const square = new SquareClient();

  const body = async (runId: number) => {
    const totals: Totals = { new: 0, changed: 0, unchanged: 0, missing: 0 };
    const perEntity = new Map<string, Totals>();
    const add = (entity: string, c: UpsertCounts, missing: number) => {
      const t = perEntity.get(entity) ?? { new: 0, changed: 0, unchanged: 0, missing: 0 };
      for (const k of ["new", "changed", "unchanged"] as const) {
        t[k] += c[k];
        totals[k] += c[k];
      }
      t.missing += missing;
      totals.missing += missing;
      perEntity.set(entity, t);
    };

    /** Write several entities (+ missing checks, + optional cursor) in ONE transaction. */
    const land = async (
      writes: Array<{ entity: string; records: RawInput[]; missing?: MissingScope }>,
      cursor?: { key: string; value: string },
    ): Promise<UpsertResult[]> =>
      withTransaction(async (client) => {
        const results: UpsertResult[] = [];
        for (const w of writes) {
          const res = await upsertRaw(client, { source: "square", entity: w.entity, runId, records: w.records, dryRun: opts.dryRun });
          const missing =
            !opts.dryRun && w.missing ? await markMissing(client, { source: "square", entity: w.entity, runId, ...w.missing }) : 0;
          add(w.entity, res, missing);
          results.push(res);
        }
        if (!opts.dryRun && cursor) await setCursor(client, cursor.key, cursor.value);
        return results;
      });

    /** Fetch orders by id; ids Square didn't return are flagged missing. */
    const fetchOrders = async (ids: string[]) => {
      const orders = await square.batchRetrieveOrders(ids);
      const returned = new Set(orders.map((o) => o.id));
      const notReturned = ids.filter((id) => !returned.has(id));
      if (notReturned.length) logger.warn({ count: notReturned.length }, "some referenced orders were not returned by Square");
      return { records: orders.map(orderToRaw), notReturned };
    };

    // 1. Invoices (full pull: "missing" = gone from the whole list).
    const invoices = await square.searchInvoices();
    const [invoiceRes] = await land([{ entity: "invoice", records: invoices.map(invoiceToRaw), missing: {} }]);

    // 2. Payments + refunds, month by month.
    const cursorKey = `square:payment:${from}..${to}`;
    const done = opts.resume ? await getCursor(cursorKey) : undefined;
    const chunks = monthChunks(from, to).filter((c) => !done || c.month > done);
    if (done) logger.info({ resumeAfter: done, remaining: chunks.length }, "resuming");

    for (const chunk of chunks) {
      const w = squareWindow(chunk, tz);
      const padded = paddedDates(chunk);
      const payments = await square.listPayments(w.begin, w.end);
      const refunds = await square.listRefunds(w.begin, w.end);
      const [payRes] = await land([
        { entity: "payment", records: payments.map((p) => paymentToRaw(p, tz)), missing: { window: padded } },
        { entity: "refund", records: refunds.map((r) => refundToRaw(r, tz)), missing: { window: padded } },
      ]);

      // A payment's order can change with it (e.g. a refund), so re-fetch for changed payments too.
      const refs = payments.map((p) => ({ id: p.order_id, force: payRes.statusById.get(p.id) !== "unchanged" }));
      const stored = await storedIds(getPool(), {
        source: "square",
        entity: "order",
        ids: refs.flatMap((r) => (r.id ? [r.id] : [])),
      });
      const orderIds = idsToFetch(refs, stored);
      const orders = await fetchOrders(orderIds);
      await land([{ entity: "order", records: orders.records, missing: { ids: orders.notReturned } }], {
        key: cursorKey,
        value: chunk.month,
      });

      logger.info(
        {
          month: chunk.month,
          payments: payments.length,
          refunds: refunds.length,
          new: payRes.new,
          changed: payRes.changed,
          orderFetches: orderIds.length,
          apiCalls: square.http.calls,
        },
        "month done",
      );
    }

    // 3. Orders behind invoices (unpaid invoices have no payment to lead us there).
    const invRefs = invoices.map((i) => ({ id: i.order_id, force: invoiceRes.statusById.get(i.id) !== "unchanged" }));
    const invStored = await storedIds(getPool(), {
      source: "square",
      entity: "order",
      ids: invRefs.flatMap((r) => (r.id ? [r.id] : [])),
    });
    const invOrders = await fetchOrders(idsToFetch(invRefs, invStored));
    await land([{ entity: "order", records: invOrders.records, missing: { ids: invOrders.notReturned } }]);

    // 4. Customers referenced anywhere in stored payments/orders/invoices (covers --resume too).
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT DISTINCT id FROM (
         SELECT payload ->> 'customer_id' AS id FROM finance.raw_record WHERE source = 'square' AND entity = 'payment'
         UNION
         SELECT payload ->> 'customer_id' FROM finance.raw_record WHERE source = 'square' AND entity = 'order'
         UNION
         SELECT payload -> 'primary_recipient' ->> 'customer_id' FROM finance.raw_record WHERE source = 'square' AND entity = 'invoice'
       ) refs WHERE id IS NOT NULL`,
    );
    const custRefs = rows.map((r) => ({ id: r.id, force: !!opts.refreshCustomers }));
    const refIds = rows.map((r) => r.id);
    // An id is resolved if it's stored as a customer, or as an alias of a merged one.
    const custStored = new Set([
      ...(await storedIds(getPool(), { source: "square", entity: "customer", ids: refIds })),
      ...(await storedIds(getPool(), { source: "square", entity: "customer_alias", ids: refIds })),
    ]);
    const custIds = idsToFetch(custRefs, custStored);
    const fetched = await square.bulkRetrieveCustomers(custIds);
    const answered = new Set(fetched.map((f) => f.requestedId));
    const customers = [...new Map(fetched.map((f) => [f.customer.id, f.customer])).values()];
    const aliases = fetched.filter((f) => f.customer.id !== f.requestedId);
    await land([
      {
        entity: "customer",
        records: customers.map(customerToRaw),
        missing: { ids: custIds.filter((id) => !answered.has(id)) }, // deleted in Square
      },
      { entity: "customer_alias", records: aliases.map((a) => customerAliasToRaw(a.requestedId, a.customer.id)) },
    ]);

    for (const [entity, t] of perEntity) logger.info({ entity, ...t }, opts.dryRun ? "dry run: would write" : "landed");
    logger.info({ ...totals, apiCalls: square.http.calls }, opts.dryRun ? "dry run total (nothing written)" : "extract total");
    return {
      result: undefined,
      apiCalls: square.http.calls,
      rowsNew: totals.new,
      rowsChanged: totals.changed,
      rowsUnchanged: totals.unchanged,
    };
  };

  if (opts.dryRun) await body(0);
  else await withRun({ job: "extract", source: "square", windowStart: from, windowEnd: to }, body);
}

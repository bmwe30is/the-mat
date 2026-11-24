// Pure helpers for the Square extract: how API objects become raw_record rows,
// and which related objects (orders, customers) still need fetching. No I/O.
import { payloadHash } from "../../lib/hash.js";
import { localDateOf, localRangeToUtc } from "../../lib/time.js";
import type { MonthChunk } from "../../lib/windows.js";
import type { RawInput } from "../../raw/repo.js";
import type { SquareCustomer, SquareInvoice, SquareOrder, SquarePayment, SquareRefund } from "./types.js";

/**
 * The UTC instants to ask Square for: the chunk's LA dates padded by a day
 * each side, as a half-open window [begin, end). Square filters on created_at,
 * so a record's window_date (LA date of created_at) falls in the padded dates
 * exactly when its created_at falls in this window.
 */
export const squareWindow = (c: MonthChunk, tz: string) => localRangeToUtc(c.from, c.to, tz, 1);

const instant = (s: string | undefined) => (s ? new Date(s) : null);

export function paymentToRaw(p: SquarePayment, tz: string): RawInput {
  return {
    externalId: p.id,
    payload: p,
    payloadHash: payloadHash(p),
    sourceCreatedAt: instant(p.created_at),
    sourceUpdatedAt: instant(p.updated_at as string | undefined),
    windowDate: localDateOf(new Date(p.created_at), tz),
  };
}

export function refundToRaw(r: SquareRefund, tz: string): RawInput {
  return {
    externalId: r.id,
    parentExternalId: r.payment_id ?? null,
    payload: r,
    payloadHash: payloadHash(r),
    sourceCreatedAt: instant(r.created_at),
    sourceUpdatedAt: instant(r.updated_at as string | undefined),
    windowDate: r.created_at ? localDateOf(new Date(r.created_at), tz) : null,
  };
}

/** Orders are fetched by id (from payments or invoices), so they aren't windowed. */
export function orderToRaw(o: SquareOrder): RawInput {
  return {
    externalId: o.id,
    payload: o,
    payloadHash: payloadHash(o),
    sourceCreatedAt: instant(o.created_at),
    sourceUpdatedAt: instant(o.updated_at as string | undefined),
  };
}

export function invoiceToRaw(i: SquareInvoice): RawInput {
  return {
    externalId: i.id,
    parentExternalId: i.order_id ?? null,
    payload: i,
    payloadHash: payloadHash(i),
    sourceCreatedAt: instant(i.created_at),
    sourceUpdatedAt: instant(i.updated_at),
  };
}

/**
 * Square returns `segment_ids` in a different order on every call, which made
 * unchanged customers look changed. Hash a copy with that list sorted; the
 * payload itself is stored exactly as returned.
 */
export function customerToRaw(c: SquareCustomer): RawInput {
  const forHash = Array.isArray(c.segment_ids) ? { ...c, segment_ids: [...(c.segment_ids as string[])].sort() } : c;
  return {
    externalId: c.id,
    payload: c,
    payloadHash: payloadHash(forHash),
    sourceCreatedAt: instant(c.created_at),
    sourceUpdatedAt: instant(c.updated_at),
  };
}

/**
 * A merged-away customer id → the surviving customer's id. Stored as its own
 * small raw row so the old id counts as resolved (no re-fetch every run) and
 * transform can follow it to the customer's email.
 */
export function customerAliasToRaw(requestedId: string, customerId: string): RawInput {
  const payload = { requested_id: requestedId, customer_id: customerId };
  return { externalId: requestedId, parentExternalId: customerId, payload, payloadHash: payloadHash(payload) };
}

/**
 * Which referenced ids to fetch: every id from a record that is new/changed
 * this run (`force`), plus any id we don't have stored yet. Deduplicated and
 * sorted so runs are deterministic.
 */
export function idsToFetch(refs: Array<{ id: string | undefined | null; force: boolean }>, stored: Set<string>): string[] {
  const out = new Set<string>();
  for (const r of refs) if (r.id && (r.force || !stored.has(r.id))) out.add(r.id);
  return [...out].sort();
}

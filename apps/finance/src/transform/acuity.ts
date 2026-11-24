// Pure mappers: Acuity raw payloads → staging rows (PRD §7.3). No DB, no network.
//
// Each mapper validates the fields it relies on with zod, so a payload that
// doesn't look like what the probe found becomes a logged transform_error
// instead of a silently wrong number.
import { z } from "zod";
import { decimalToCents } from "../lib/money.js";
import { localDateOf, parseLocalDateTime, parseSourceInstant } from "../lib/time.js";
import { attempt, normEmail, type MapResult, type RawRow } from "./types.js";

export type CertificateKind = "membership" | "package" | "gift" | "coupon" | "certificate_deleted";

/**
 * What kind of code an appointment used (PRD §7.3 "Mapping rules"):
 *   found in /certificates → by productType (Subscription / Package / Gift Certificate)
 *   not found, 8 hex chars → an Acuity-generated certificate that no longer exists
 *   not found, anything else → a coupon (coupons are never listed in /certificates)
 */
export function certificateKind(cert: Record<string, unknown> | undefined, code: string): CertificateKind {
  if (cert) {
    const pt = String(cert.productType ?? "");
    if (/subscription/i.test(pt)) return "membership";
    if (/gift/i.test(pt)) return "gift";
    if (/package/i.test(pt)) return "package";
    throw new Error(`certificate ${code}: unknown productType "${pt}"`);
  }
  return /^[0-9A-F]{8}$/i.test(code) ? "certificate_deleted" : "coupon";
}

export interface AcuityCtx {
  tz: string;
  /** /certificates by upper-cased code. */
  certificatesByCode: Map<string, Record<string, unknown>>;
}

// ---------- appointment ----------

const Money = z.union([z.string(), z.number()]);

const AppointmentSchema = z.object({
  id: z.number(),
  datetime: z.string(),
  datetimeCreated: z.string().nullish(),
  calendarTimezone: z.string().nullish(),
  appointmentTypeID: z.number().nullish(),
  type: z.string().nullish(),
  calendarID: z.number().nullish(),
  calendar: z.string().nullish(),
  email: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  price: Money,
  priceSold: Money.nullish(),
  amountPaid: Money,
  paid: z.enum(["yes", "no"]),
  certificate: z.string().nullish(),
  canceled: z.boolean(),
  noShow: z.boolean().nullish(),
  labels: z.array(z.object({ name: z.string() })).nullish(),
});

export interface StgAcuityAppointment {
  appointment_id: number;
  raw_record_id: string;
  starts_at: string;
  local_date: string;
  source_tz: string | null;
  type_id: number | null;
  type_name: string | null;
  calendar_id: number | null;
  calendar_name: string | null;
  client_email_norm: string | null;
  client_name: string | null;
  list_price_cents: number;
  price_cents: number;
  discount_cents: number;
  amount_paid_cents: number;
  tip_cents: number;
  code_extra_paid_cents: number;
  paid: boolean;
  certificate_code: string | null;
  certificate_kind: CertificateKind | null;
  is_canceled: boolean;
  no_show: boolean;
  booked_at: string | null;
  labels: string[];
  missing_since: string | null;
}

/**
 * Money columns:
 *   list_price = priceSold (before any code), price = price (after any code),
 *   discount   = list_price − price.
 *   Anything paid above `price` is split by whether a code was used:
 *     no code  → tip_cents (Acuity's tip option: +10/15/20% in the probe)
 *     a code   → code_extra_paid_cents (owner: may be a gift card or prepayment, NOT a tip)
 */
export function toStgAcuityAppointment(raw: RawRow, ctx: AcuityCtx): MapResult<StgAcuityAppointment> {
  return attempt(() => {
    const a = AppointmentSchema.parse(raw.payload);
    const starts = parseSourceInstant(a.datetime);
    const price = decimalToCents(a.price);
    const list = a.priceSold === null || a.priceSold === undefined ? price : decimalToCents(a.priceSold);
    const paidCents = decimalToCents(a.amountPaid);
    const extra = Math.max(paidCents - price, 0);
    const code = a.certificate?.trim() ? a.certificate.trim() : null;
    const name = [a.firstName, a.lastName].filter((s) => s && s.trim()).join(" ").trim();
    return {
      appointment_id: a.id,
      raw_record_id: raw.id,
      starts_at: starts.toISOString(),
      local_date: localDateOf(starts, ctx.tz),
      source_tz: a.calendarTimezone || null,
      type_id: a.appointmentTypeID ?? null,
      type_name: a.type ?? null,
      calendar_id: a.calendarID ?? null,
      calendar_name: a.calendar ?? null,
      client_email_norm: normEmail(a.email),
      client_name: name || null,
      list_price_cents: list,
      price_cents: price,
      discount_cents: list - price,
      amount_paid_cents: paidCents,
      tip_cents: code ? 0 : extra,
      code_extra_paid_cents: code ? extra : 0,
      paid: a.paid === "yes",
      certificate_code: code,
      certificate_kind: code ? certificateKind(ctx.certificatesByCode.get(code.toUpperCase()), code) : null,
      is_canceled: a.canceled,
      no_show: a.noShow ?? false,
      booked_at: a.datetimeCreated ? parseSourceInstant(a.datetimeCreated).toISOString() : null,
      labels: (a.labels ?? []).map((l) => l.name),
      missing_since: raw.missing_since?.toISOString() ?? null,
    };
  });
}

// ---------- appointment payment ----------

const PaymentSchema = z.object({
  transactionID: z.string().nullish(),
  created: z.string().nullish(),
  processor: z.string().nullish(),
  amount: Money,
  relatedPaymentsCount: z.number().nullish(),
});

export interface StgAcuityPayment {
  acuity_payment_key: string;
  raw_record_id: string;
  appointment_id: number;
  processor: string | null;
  processor_txn_id: string | null;
  amount_cents: number;
  paid_at: string | null;
  local_date: string | null;
  related_payments_count: number | null;
  missing_since: string | null;
}

export function toStgAcuityPayment(raw: RawRow, ctx: AcuityCtx): MapResult<StgAcuityPayment> {
  return attempt(() => {
    const p = PaymentSchema.parse(raw.payload);
    if (!raw.parent_external_id || !/^\d+$/.test(raw.parent_external_id)) {
      throw new Error("payment has no parent appointment id");
    }
    const paidAt = p.created ? parseSourceInstant(p.created) : null;
    return {
      acuity_payment_key: raw.external_id,
      raw_record_id: raw.id,
      appointment_id: Number(raw.parent_external_id),
      processor: p.processor || null,
      processor_txn_id: p.transactionID?.trim() ? p.transactionID.trim() : null, // "" for cash
      amount_cents: decimalToCents(p.amount),
      paid_at: paidAt?.toISOString() ?? null,
      local_date: paidAt ? localDateOf(paidAt, ctx.tz) : null,
      related_payments_count: p.relatedPaymentsCount ?? null,
      missing_since: raw.missing_since?.toISOString() ?? null,
    };
  });
}

// ---------- order ----------

const OrderSchema = z.object({
  id: z.number(),
  time: z.string().nullish(),
  total: Money, // the API sends a number here, unlike appointments
  status: z.string().nullish(),
  title: z.string().nullish(),
  email: z.string().nullish(),
  products: z.array(z.object({ name: z.string().nullish(), quantity: z.number().nullish() })).nullish(),
});

export interface StgAcuityOrder {
  order_id: number;
  raw_record_id: string;
  ordered_at: string | null;
  local_date: string | null;
  total_cents: number;
  status: string | null;
  title: string | null;
  product_summary: string | null;
  client_email_norm: string | null;
  missing_since: string | null;
}

export function toStgAcuityOrder(raw: RawRow, ctx: AcuityCtx): MapResult<StgAcuityOrder> {
  return attempt(() => {
    const o = OrderSchema.parse(raw.payload);
    // Order `time` has no offset; it's in the account timezone (LA) — probe Q3.
    const at = o.time ? parseLocalDateTime(o.time, ctx.tz) : null;
    const summary = (o.products ?? []).map((p) => `${p.quantity ?? 1}× ${p.name ?? "?"}`).join("; ");
    return {
      order_id: o.id,
      raw_record_id: raw.id,
      ordered_at: at?.toISOString() ?? null,
      local_date: at ? localDateOf(at, ctx.tz) : null,
      total_cents: decimalToCents(o.total),
      status: o.status ?? null,
      title: o.title ?? null,
      product_summary: summary || null,
      client_email_norm: normEmail(o.email),
      missing_since: raw.missing_since?.toISOString() ?? null,
    };
  });
}

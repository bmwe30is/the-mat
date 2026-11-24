// Pure mappers: Square raw payloads → staging rows (PRD §7.3). No DB, no network.
import { z } from "zod";
import { squareMoneyToCents } from "../lib/money.js";
import { localDateOf } from "../lib/time.js";
import { parseSquareNote } from "../sources/square/note.js";
import { attempt, normEmail, type MapResult, type RawRow } from "./types.js";

export interface SquareCtx {
  tz: string;
  /** customer id → email (from stored Square customers). */
  customerEmailById: Map<string, string>;
  /** merged-away customer id → surviving customer id (customer_alias rows). */
  customerAlias: Map<string, string>;
  /** Square order id → customer id (2020 payments carry none; their orders do). */
  orderCustomerById: Map<string, string>;
  /** Square order id → invoice id. */
  invoiceIdByOrderId: Map<string, string>;
}

const MoneySchema = z.object({ amount: z.number().int(), currency: z.string() });
const cents = (m: z.infer<typeof MoneySchema> | null | undefined) => squareMoneyToCents(m ?? undefined);
const iso = (s: string | null | undefined) => (s ? new Date(s).toISOString() : null);
const missing = (raw: RawRow) => raw.missing_since?.toISOString() ?? null;

// ---------- payment ----------

const PaymentSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  status: z.string(),
  amount_money: MoneySchema,
  tip_money: MoneySchema.nullish(),
  total_money: MoneySchema.nullish(),
  refunded_money: MoneySchema.nullish(),
  processing_fee: z.array(z.object({ amount_money: MoneySchema.nullish() })).nullish(),
  source_type: z.string().nullish(),
  order_id: z.string().nullish(),
  customer_id: z.string().nullish(),
  buyer_email_address: z.string().nullish(),
  note: z.string().nullish(),
  reference_id: z.string().nullish(),
  application_details: z.object({ square_product: z.string().nullish() }).nullish(),
});

export interface StgSquarePayment {
  payment_id: string;
  raw_record_id: string;
  created_at: string;
  local_date: string;
  status: string;
  amount_cents: number;
  tip_cents: number;
  total_cents: number;
  refunded_cents: number;
  fee_cents: number;
  source_type: string | null;
  square_product: string | null;
  order_id: string | null;
  invoice_id: string | null;
  customer_id: string | null;
  buyer_email_norm: string | null;
  note: string | null;
  reference_id: string | null;
  acuity_ref_kind: string;
  acuity_ref: string | null;
  acuity_certificate_code: string | null;
  missing_since: string | null;
}

/** Follow a merged-away customer id to the surviving profile. */
const resolveCustomer = (id: string | null | undefined, ctx: SquareCtx) => (id ? (ctx.customerAlias.get(id) ?? id) : null);

export function toStgSquarePayment(raw: RawRow, ctx: SquareCtx): MapResult<StgSquarePayment> {
  return attempt(() => {
    const p = PaymentSchema.parse(raw.payload);
    const created = new Date(p.created_at);
    const amount = cents(p.amount_money);
    const tip = cents(p.tip_money);
    // 2020 payments have no customer_id, but their orders do (Phase 5 finding).
    const customerId = resolveCustomer(p.customer_id ?? (p.order_id ? ctx.orderCustomerById.get(p.order_id) : null), ctx);
    const ref = parseSquareNote(p.note);
    return {
      payment_id: p.id,
      raw_record_id: raw.id,
      created_at: created.toISOString(),
      local_date: localDateOf(created, ctx.tz),
      status: p.status,
      amount_cents: amount,
      tip_cents: tip,
      total_cents: p.total_money ? cents(p.total_money) : amount + tip,
      refunded_cents: cents(p.refunded_money),
      fee_cents: (p.processing_fee ?? []).reduce((sum, f) => sum + cents(f.amount_money), 0),
      source_type: p.source_type ?? null,
      square_product: p.application_details?.square_product ?? null,
      order_id: p.order_id ?? null,
      invoice_id: p.order_id ? (ctx.invoiceIdByOrderId.get(p.order_id) ?? null) : null,
      customer_id: customerId,
      buyer_email_norm: normEmail(p.buyer_email_address) ?? (customerId ? normEmail(ctx.customerEmailById.get(customerId)) : null),
      note: p.note ?? null,
      reference_id: p.reference_id ?? null,
      acuity_ref_kind: ref.kind,
      acuity_ref:
        ref.kind === "appointment" ? ref.appointmentId : ref.kind === "order" ? ref.orderId : ref.kind === "subscription" ? ref.subscriptionId : null,
      acuity_certificate_code: ref.kind === "subscription" ? (ref.certificateCode ?? null) : null,
      missing_since: missing(raw),
    };
  });
}

// ---------- order (+ discounts) ----------

const OrderSchema = z.object({
  id: z.string(),
  created_at: z.string().nullish(),
  customer_id: z.string().nullish(),
  total_money: MoneySchema.nullish(),
  total_discount_money: MoneySchema.nullish(),
  total_tax_money: MoneySchema.nullish(),
  total_tip_money: MoneySchema.nullish(),
  source: z.object({ name: z.string().nullish() }).nullish(),
  line_items: z.array(z.object({ name: z.string().nullish(), quantity: z.string().nullish() })).nullish(),
  discounts: z
    .array(
      z.object({
        uid: z.string(),
        name: z.string().nullish(),
        type: z.string().nullish(),
        scope: z.string().nullish(),
        applied_money: MoneySchema.nullish(),
      }),
    )
    .nullish(),
});

export interface StgSquareOrder {
  order_id: string;
  raw_record_id: string;
  created_at: string | null;
  local_date: string | null;
  total_cents: number;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  line_item_count: number;
  line_item_summary: string | null;
  source_name: string | null;
  invoice: boolean;
  missing_since: string | null;
}

export interface StgSquareOrderDiscount {
  order_id: string;
  discount_uid: string;
  raw_record_id: string;
  name: string | null;
  type: string | null;
  scope: string | null;
  applied_cents: number;
}

export function toStgSquareOrder(
  raw: RawRow,
  ctx: SquareCtx,
): MapResult<{ order: StgSquareOrder; discounts: StgSquareOrderDiscount[] }> {
  return attempt(() => {
    const o = OrderSchema.parse(raw.payload);
    const items = o.line_items ?? [];
    const created = o.created_at ? new Date(o.created_at) : null;
    return {
      order: {
        order_id: o.id,
        raw_record_id: raw.id,
        created_at: iso(o.created_at),
        local_date: created ? localDateOf(created, ctx.tz) : null,
        total_cents: cents(o.total_money),
        discount_cents: cents(o.total_discount_money),
        tax_cents: cents(o.total_tax_money),
        tip_cents: cents(o.total_tip_money),
        line_item_count: items.length,
        line_item_summary: items.map((li) => `${li.quantity ?? "1"}× ${li.name ?? "Custom amount"}`).join("; ") || null,
        source_name: o.source?.name ?? null,
        invoice: ctx.invoiceIdByOrderId.has(o.id) || o.source?.name === "Invoices",
        missing_since: missing(raw),
      },
      discounts: (o.discounts ?? []).map((d) => ({
        order_id: o.id,
        discount_uid: d.uid,
        raw_record_id: raw.id,
        name: d.name ?? null,
        type: d.type ?? null,
        scope: d.scope ?? null,
        applied_cents: cents(d.applied_money),
      })),
    };
  });
}

// ---------- refund ----------

const RefundSchema = z.object({
  id: z.string(),
  payment_id: z.string().nullish(),
  created_at: z.string().nullish(),
  amount_money: MoneySchema,
  status: z.string().nullish(),
  reason: z.string().nullish(),
});

export interface StgSquareRefund {
  refund_id: string;
  raw_record_id: string;
  payment_id: string | null;
  created_at: string | null;
  local_date: string | null;
  amount_cents: number;
  status: string | null;
  reason: string | null;
  missing_since: string | null;
}

export function toStgSquareRefund(raw: RawRow, ctx: SquareCtx): MapResult<StgSquareRefund> {
  return attempt(() => {
    const r = RefundSchema.parse(raw.payload);
    return {
      refund_id: r.id,
      raw_record_id: raw.id,
      payment_id: r.payment_id ?? null,
      created_at: iso(r.created_at),
      local_date: r.created_at ? localDateOf(new Date(r.created_at), ctx.tz) : null,
      amount_cents: cents(r.amount_money),
      status: r.status ?? null,
      reason: r.reason ?? null,
      missing_since: missing(raw),
    };
  });
}

// ---------- invoice ----------

const InvoiceSchema = z.object({
  id: z.string(),
  order_id: z.string().nullish(),
  invoice_number: z.string().nullish(),
  title: z.string().nullish(),
  status: z.string().nullish(),
  created_at: z.string().nullish(),
  primary_recipient: z.object({ customer_id: z.string().nullish() }).nullish(),
  payment_requests: z
    .array(
      z.object({
        due_date: z.string().nullish(),
        computed_amount_money: MoneySchema.nullish(),
        total_completed_amount_money: MoneySchema.nullish(),
      }),
    )
    .nullish(),
});

export interface StgSquareInvoice {
  invoice_id: string;
  raw_record_id: string;
  order_id: string | null;
  invoice_number: string | null;
  title: string | null;
  status: string | null;
  created_at: string | null;
  local_date: string | null;
  due_date: string | null;
  requested_cents: number;
  paid_cents: number;
  customer_id: string | null;
  missing_since: string | null;
}

export function toStgSquareInvoice(raw: RawRow, ctx: SquareCtx): MapResult<StgSquareInvoice> {
  return attempt(() => {
    const i = InvoiceSchema.parse(raw.payload);
    const reqs = i.payment_requests ?? [];
    const dues = reqs.map((r) => r.due_date).filter((d): d is string => !!d).sort();
    return {
      invoice_id: i.id,
      raw_record_id: raw.id,
      order_id: i.order_id ?? null,
      invoice_number: i.invoice_number ?? null,
      title: i.title ?? null,
      status: i.status ?? null,
      created_at: iso(i.created_at),
      local_date: i.created_at ? localDateOf(new Date(i.created_at), ctx.tz) : null,
      due_date: dues[0] ?? null,
      requested_cents: reqs.reduce((s, r) => s + cents(r.computed_amount_money), 0),
      paid_cents: reqs.reduce((s, r) => s + cents(r.total_completed_amount_money), 0),
      customer_id: resolveCustomer(i.primary_recipient?.customer_id, ctx),
      missing_since: missing(raw),
    };
  });
}

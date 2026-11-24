import { describe, expect, it } from "vitest";
import {
  toStgSquareInvoice,
  toStgSquareOrder,
  toStgSquarePayment,
  toStgSquareRefund,
  type SquareCtx,
} from "../src/transform/square.js";
import type { RawRow } from "../src/transform/types.js";

const usd = (amount: number) => ({ amount, currency: "USD" });
const raw = (payload: unknown): RawRow => ({ id: "9", external_id: "x", parent_external_id: null, payload, missing_since: null });

const ctx: SquareCtx = {
  tz: "America/Los_Angeles",
  customerEmailById: new Map([["CUST_NEW", "Pat@Example.com"]]),
  customerAlias: new Map([["CUST_OLD", "CUST_NEW"]]),
  orderCustomerById: new Map([["ORD1", "CUST_OLD"]]),
  invoiceIdByOrderId: new Map([["ORD_INV", "INV1"]]),
};

const payment = {
  id: "PAY1",
  created_at: "2020-04-01T06:30:00.000Z",
  status: "COMPLETED",
  amount_money: usd(1500),
  total_money: usd(1500),
  processing_fee: [{ amount_money: usd(49) }, { amount_money: usd(1) }],
  source_type: "CARD",
  order_id: "ORD1",
  note: "Order #44035300",
  application_details: { square_product: "ECOMMERCE_API" },
};

describe("toStgSquarePayment", () => {
  it("maps money, the LA date, fees and the parsed Acuity reference", () => {
    const r = toStgSquarePayment(raw(payment), ctx);
    expect(r.ok && r.row).toMatchObject({
      payment_id: "PAY1",
      local_date: "2020-03-31",
      amount_cents: 1500,
      tip_cents: 0,
      total_cents: 1500,
      refunded_cents: 0,
      fee_cents: 50,
      square_product: "ECOMMERCE_API",
      acuity_ref_kind: "order",
      acuity_ref: "44035300",
    });
  });

  it("gets the customer from the order and follows a merged-customer alias to the email", () => {
    const r = toStgSquarePayment(raw(payment), ctx);
    expect(r.ok && r.row.customer_id).toBe("CUST_NEW");
    expect(r.ok && r.row.buyer_email_norm).toBe("pat@example.com");
  });

  it("links invoice payments and keeps subscription certificate codes", () => {
    const r = toStgSquarePayment(
      raw({ ...payment, order_id: "ORD_INV", note: "Subscription 792817 - Plan - Recurring - 67a0b014" }),
      ctx,
    );
    expect(r.ok && r.row).toMatchObject({ invoice_id: "INV1", acuity_ref_kind: "subscription", acuity_certificate_code: "67A0B014" });
  });

  it("rejects non-USD money as an error", () => {
    expect(toStgSquarePayment(raw({ ...payment, amount_money: { amount: 1, currency: "CAD" } }), ctx).ok).toBe(false);
  });
});

describe("toStgSquareOrder", () => {
  it("summarises line items and emits discount rows", () => {
    const r = toStgSquareOrder(
      raw({
        id: "ORD_INV",
        created_at: "2020-06-01T18:00:00Z",
        total_money: usd(9000),
        total_discount_money: usd(1000),
        line_items: [{ quantity: "1", name: "Membership" }, { quantity: "2" }],
        discounts: [{ uid: "d1", name: "Friend", type: "FIXED_AMOUNT", scope: "ORDER", applied_money: usd(1000) }],
      }),
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.order).toMatchObject({
      total_cents: 9000,
      discount_cents: 1000,
      line_item_count: 2,
      line_item_summary: "1× Membership; 2× Custom amount",
      invoice: true,
    });
    expect(r.row.discounts).toEqual([
      { order_id: "ORD_INV", discount_uid: "d1", raw_record_id: "9", name: "Friend", type: "FIXED_AMOUNT", scope: "ORDER", applied_cents: 1000 },
    ]);
  });
});

describe("toStgSquareRefund / toStgSquareInvoice", () => {
  it("maps a refund", () => {
    const r = toStgSquareRefund(raw({ id: "R1", payment_id: "PAY1", created_at: "2020-08-10T20:00:00Z", amount_money: usd(1329), status: "COMPLETED" }), ctx);
    expect(r.ok && r.row).toMatchObject({ refund_id: "R1", payment_id: "PAY1", local_date: "2020-08-10", amount_cents: 1329 });
  });

  it("sums payment requests and keeps unpaid invoices", () => {
    const r = toStgSquareInvoice(
      raw({
        id: "INV1",
        order_id: "ORD_INV",
        status: "UNPAID",
        created_at: "2026-09-01T17:00:00Z",
        primary_recipient: { customer_id: "CUST_OLD" },
        payment_requests: [
          { due_date: "2026-10-01", computed_amount_money: usd(5000), total_completed_amount_money: usd(0) },
          { due_date: "2026-09-15", computed_amount_money: usd(4000), total_completed_amount_money: usd(4000) },
        ],
      }),
      ctx,
    );
    expect(r.ok && r.row).toMatchObject({
      status: "UNPAID",
      due_date: "2026-09-15",
      requested_cents: 9000,
      paid_cents: 4000,
      customer_id: "CUST_NEW",
    });
  });
});

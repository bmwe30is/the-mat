import { describe, expect, it } from "vitest";
import { classify, mismatchReason, unmatchedAppointmentReason, unmatchedSquareReason } from "../src/reconcile/classify.js";
import { matchAll } from "../src/reconcile/rules.js";
import type { AcuityAppt, AcuityPay, ReconConfig, ReconInput, SquarePay } from "../src/reconcile/types.js";

const cfg: ReconConfig = { matchWindowMinutes: 15, membershipTypePatterns: ["Membership"], window: { from: "2020-03-01", to: "2020-12-31" } };

const appt = (id: string, over: Partial<AcuityAppt> = {}): AcuityAppt => ({
  id,
  localDate: "2020-06-02",
  email: "pat@example.com",
  typeName: "Yoga",
  listPriceCents: 1500,
  priceCents: 1500,
  discountCents: 0,
  amountPaidCents: 1500,
  tipCents: 0,
  codeExtraPaidCents: 0,
  paid: true,
  certificateKind: null,
  isCanceled: false,
  ...over,
});
const pay = (key: string, appointmentId: string, over: Partial<AcuityPay> = {}): AcuityPay => ({
  key,
  appointmentId,
  processor: "square",
  txnId: null,
  amountCents: 1500,
  paidAt: "2020-06-01T17:00:00Z",
  payDate: "2020-06-01",
  ...over,
});
const sq = (id: string, over: Partial<SquarePay> = {}): SquarePay => ({
  id,
  createdAt: "2020-06-01T17:00:30Z",
  localDate: "2020-06-01",
  status: "COMPLETED",
  amountCents: 1500,
  refundedCents: 0,
  orderId: `ORD_${id}`,
  orderDiscountCents: 0,
  email: null,
  squareProduct: "ECOMMERCE_API",
  refKind: "dated",
  ref: null,
  certificateCode: null,
  noteClassDate: null,
  ...over,
});
const input = (over: Partial<ReconInput>): ReconInput => ({
  appointments: [],
  payments: [],
  orders: [],
  square: [],
  certificateCodes: new Set(),
  overrides: [],
  ...over,
});

describe("matchAll", () => {
  it("rule 1a links by Square order id (2020) and by payment id (later)", () => {
    const links = matchAll(
      input({
        appointments: [appt("1"), appt("2")],
        payments: [pay("p1", "1", { txnId: "ORD_S1" }), pay("p2", "2", { txnId: "S2" })],
        square: [sq("S1"), sq("S2")],
      }),
      cfg,
    );
    expect(links.map((l) => [l.acuityId, l.squarePaymentId, l.rule, l.evidence.acuity_transaction_id_matches])).toEqual([
      ["1", "S1", "1a", "order_id"],
      ["2", "S2", "1a", "payment_id"],
    ]);
  });

  it("ignores failed Square payments", () => {
    const links = matchAll(
      input({ appointments: [appt("1")], payments: [pay("p1", "1", { txnId: "F1" })], square: [sq("F1", { status: "FAILED" })] }),
      cfg,
    );
    expect(links).toEqual([]);
  });

  it("rule 1b links appointments, orders and membership certificates from the note", () => {
    const links = matchAll(
      input({
        appointments: [appt("1764688793")],
        orders: [{ id: "44035300", localDate: "2020-06-01", orderedAt: null, email: null, totalCents: 4000, status: "paid" }],
        square: [
          sq("A", { refKind: "appointment", ref: "1764688793" }),
          sq("B", { refKind: "order", ref: "44035300", amountCents: 4000 }),
          sq("C", { refKind: "subscription", ref: "792817", certificateCode: "67A0B014" }),
          sq("D", { refKind: "subscription", ref: "792817", certificateCode: "67A0B014" }),
        ],
        certificateCodes: new Set(["67A0B014"]),
      }),
      cfg,
    );
    expect(links.map((l) => [l.squarePaymentId, l.acuityKind, l.acuityId])).toEqual([
      ["A", "appointment", "1764688793"],
      ["B", "order", "44035300"],
      ["C", "certificate", "67A0B014"],
      ["D", "certificate", "67A0B014"], // monthly charges all link to the same certificate
    ]);
  });

  it("rule 2 needs email + amount + time window, and picks the closest", () => {
    const links = matchAll(
      input({
        appointments: [appt("1")],
        payments: [pay("p1", "1")],
        square: [
          sq("FAR", { email: "pat@example.com", createdAt: "2020-06-01T17:14:00Z" }),
          sq("NEAR", { email: "pat@example.com", createdAt: "2020-06-01T17:01:00Z" }),
          sq("TOO_LATE", { email: "pat@example.com", createdAt: "2020-06-01T17:30:00Z" }),
        ],
      }),
      cfg,
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ squarePaymentId: "NEAR", rule: "2", confidence: "medium" });
  });

  it("rule 3 pairs a unique email+date even if amounts differ; rule 4 pairs a unique amount+date", () => {
    const links = matchAll(
      input({
        appointments: [appt("1"), appt("2", { email: null, amountPaidCents: 2000 })],
        payments: [pay("p1", "1"), pay("p2", "2", { amountCents: 2000, paidAt: "2020-06-01T20:00:00Z" })],
        square: [
          sq("S1", { email: "pat@example.com", amountCents: 1800, createdAt: "2020-06-01T23:00:00Z" }),
          sq("S2", { amountCents: 2000, createdAt: "2020-06-01T22:00:00Z" }),
        ],
      }),
      cfg,
    );
    expect(links.map((l) => [l.acuityId, l.squarePaymentId, l.rule])).toEqual([
      ["1", "S1", "3"],
      ["2", "S2", "4"],
    ]);
  });

  it("rule 4 does not guess when two candidates share amount and date", () => {
    const links = matchAll(
      input({
        appointments: [appt("1", { email: null }), appt("2", { email: null })],
        payments: [pay("p1", "1"), pay("p2", "2")],
        square: [sq("S1"), sq("S2")],
      }),
      cfg,
    );
    expect(links).toEqual([]);
  });

  it("manual overrides win, and is deterministic", () => {
    const i = input({
      appointments: [appt("1")],
      payments: [pay("p1", "1", { txnId: "ORD_S1" })],
      square: [sq("S1"), sq("S2")],
      overrides: [{ id: "1", acuityKind: "appointment", acuityId: "1", squarePaymentId: "S2", reasonCode: "MANUAL_MATCH", note: null }],
    });
    const a = matchAll(i, cfg);
    expect(a.map((l) => [l.squarePaymentId, l.rule])).toEqual([["S2", "0"]]);
    expect(matchAll(i, cfg)).toEqual(a);
  });
});

describe("classify", () => {
  it("matched, and an amount mismatch explained by Acuity tips", () => {
    const i = input({
      appointments: [appt("1"), appt("2", { amountPaidCents: 1800, tipCents: 300 })],
      payments: [pay("p1", "1", { txnId: "S1" }), pay("p2", "2", { txnId: "ORD_S2", amountCents: 1800 })],
      square: [sq("S1"), sq("S2", { amountCents: 1500 })],
    });
    const rows = classify(i, matchAll(i, cfg), cfg);
    const a = (id: string) => rows.find((r) => r.side === "acuity" && r.id === id)!;
    expect(a("1")).toMatchObject({ status: "matched", reasonCode: null, deltaCents: 0, exception: false });
    expect(a("2")).toMatchObject({ status: "amount_mismatch", reasonCode: "TIP", deltaCents: -300 });
  });

  it("never hides a paid booking behind 'canceled' or a code", () => {
    expect(unmatchedAppointmentReason(appt("1", { isCanceled: true }), [pay("p", "1")], cfg)).toEqual({ reason: "PAID_NO_SQUARE", status: "acuity_only" });
  });

  it("gives no-money bookings their reason", () => {
    const zero = { amountPaidCents: 0 };
    expect(unmatchedAppointmentReason(appt("1", { ...zero, isCanceled: true }), [], cfg).reason).toBe("CANCELED");
    expect(unmatchedAppointmentReason(appt("1", { ...zero, certificateKind: "package" }), [], cfg).reason).toBe("PACKAGE_REDEMPTION");
    expect(unmatchedAppointmentReason(appt("1", { ...zero, certificateKind: "certificate_deleted" }), [], cfg).reason).toBe("PACKAGE_REDEMPTION");
    expect(unmatchedAppointmentReason(appt("1", { ...zero, certificateKind: "membership" }), [], cfg).reason).toBe("MEMBERSHIP");
    expect(unmatchedAppointmentReason(appt("1", { ...zero, typeName: "Membership Call" }), [], cfg).reason).toBe("MEMBERSHIP");
    expect(unmatchedAppointmentReason(appt("1", { ...zero, certificateKind: "coupon" }), [], cfg).reason).toBe("COUPON_FULL");
    expect(unmatchedAppointmentReason(appt("1", { ...zero, priceCents: 0 }), [], cfg).reason).toBe("FREE_TYPE");
    expect(unmatchedAppointmentReason(appt("1", { ...zero, paid: false }), [], cfg)).toEqual({ reason: "UNPAID", status: "acuity_only" });
  });

  it("treats cash-only and net-zero adjustments as CASH, not a Square gap", () => {
    const pays = [
      pay("a", "1", { txnId: null, processor: "cash", amountCents: -1800 }),
      pay("b", "1", { txnId: null, processor: "cash", amountCents: 1800 }),
    ];
    expect(unmatchedAppointmentReason(appt("1", { amountPaidCents: 1800 }), pays, cfg).reason).toBe("CASH");
  });

  it("classifies unmatched Square payments", () => {
    expect(unmatchedSquareReason(sq("x", { status: "FAILED" })).reason).toBe("NOT_COMPLETED");
    expect(unmatchedSquareReason(sq("x", { refKind: "subscription" })).reason).toBe("MEMBERSHIP_CHARGE");
    expect(unmatchedSquareReason(sq("x", { squareProduct: "INVOICES" })).reason).toBe("INVOICE");
    expect(unmatchedSquareReason(sq("x", { squareProduct: "OTHER" })).reason).toBe("POS_RETAIL");
    expect(unmatchedSquareReason(sq("x", { refKind: "order", ref: "1" })).reason).toBe("ACUITY_ORDER");
    expect(unmatchedSquareReason(sq("x")).reason).toBe("NO_ACUITY_REF");
    expect(unmatchedSquareReason(sq("x", { noteClassDate: "2021-01-03" }), cfg.window).reason).toBe("CLASS_OUTSIDE_WINDOW");
    expect(unmatchedSquareReason(sq("x", { noteClassDate: "2020-12-31" }), cfg.window).reason).toBe("NO_ACUITY_REF");
  });

  it("orders: unpaid checkouts need no money; undercharged orders stay exceptions", () => {
    const order = (id: string, over = {}) => ({ id, localDate: "2020-12-10", orderedAt: null, email: null, totalCents: 5000, status: "paid", ...over });
    const i = input({
      orders: [order("1", { status: "unpaid" }), order("2", { totalCents: 16000 })],
      square: [sq("S2", { refKind: "order", ref: "2", amountCents: 8000, localDate: "2020-12-10" })],
    });
    const rows = classify(i, matchAll(i, cfg), cfg);
    expect(rows.find((r) => r.id === "1")).toMatchObject({ status: "not_applicable", reasonCode: "ORDER_UNPAID", exception: false });
    expect(rows.find((r) => r.id === "2")).toMatchObject({ status: "amount_mismatch", reasonCode: "ORDER_CHARGED_LESS", exception: true, deltaCents: -8000 });
  });

  it("explains mismatches in order, falling back to UNKNOWN", () => {
    const base = { discountCents: 0, tipCents: 0, codeExtraPaidCents: 0, refundedCents: 0, orderDiscountCents: 0, priceCents: 1500, amountPaidCents: 1500 };
    expect(mismatchReason(-500, { ...base, discountCents: 500 })).toBe("ACUITY_DISCOUNT");
    expect(mismatchReason(200, { ...base, refundedCents: 200 })).toBe("PARTIAL_REFUND");
    expect(mismatchReason(100, { ...base, amountPaidCents: 1600 })).toBe("PRICE_OVERRIDE");
    expect(mismatchReason(100, base)).toBe("UNKNOWN");
  });

  it("only writes statuses inside the window", () => {
    const i = input({ appointments: [appt("1", { localDate: "2021-01-01", amountPaidCents: 0, priceCents: 0 })] });
    expect(classify(i, [], cfg)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  certificateKind,
  toStgAcuityAppointment,
  toStgAcuityOrder,
  toStgAcuityPayment,
  type AcuityCtx,
} from "../src/transform/acuity.js";
import type { RawRow } from "../src/transform/types.js";

// Payloads are shaped like the scrubbed probe examples, with made-up values.
const ctx: AcuityCtx = {
  tz: "America/Los_Angeles",
  certificatesByCode: new Map([
    ["244EA515", { productType: "Subscription" }],
    ["PACK0001", { productType: "Package" }],
    ["GIFT0001", { productType: "Gift Certificate" }],
  ]),
};

const raw = (payload: unknown, extra: Partial<RawRow> = {}): RawRow => ({
  id: "7",
  external_id: "x",
  parent_external_id: null,
  payload,
  missing_since: null,
  ...extra,
});

const appt = {
  id: 369245755,
  datetime: "2020-03-31T23:30:00-0700",
  datetimeCreated: "2020-03-30T00:20:47-0500",
  calendarTimezone: "America/Los_Angeles",
  appointmentTypeID: 13734145,
  type: "Yoga Practice (W 5:30p)",
  calendarID: 1008703,
  calendar: "Studio Online",
  email: "  Pat@Example.COM ",
  firstName: "Pat",
  lastName: "Example",
  price: "15.00",
  priceSold: "15.00",
  amountPaid: "15.00",
  paid: "yes",
  certificate: null,
  canceled: false,
  labels: null,
};

describe("certificateKind", () => {
  it("maps /certificates productType", () => {
    expect(certificateKind({ productType: "Subscription" }, "X")).toBe("membership");
    expect(certificateKind({ productType: "Package" }, "X")).toBe("package");
    expect(certificateKind({ productType: "Gift Certificate" }, "X")).toBe("gift");
  });

  it("classifies unlisted codes by shape", () => {
    expect(certificateKind(undefined, "E82CABC7")).toBe("certificate_deleted");
    expect(certificateKind(undefined, "WELCOME10")).toBe("coupon");
  });

  it("refuses an unknown productType rather than guessing", () => {
    expect(() => certificateKind({ productType: "Mystery" }, "X")).toThrow(/unknown productType/);
  });
});

describe("toStgAcuityAppointment", () => {
  it("maps a plain paid booking, with the LA date of an 11:30 PM class", () => {
    const r = toStgAcuityAppointment(raw(appt), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toMatchObject({
      appointment_id: 369245755,
      raw_record_id: "7",
      starts_at: "2020-04-01T06:30:00.000Z",
      local_date: "2020-03-31",
      client_email_norm: "pat@example.com",
      client_name: "Pat Example",
      list_price_cents: 1500,
      price_cents: 1500,
      discount_cents: 0,
      amount_paid_cents: 1500,
      tip_cents: 0,
      code_extra_paid_cents: 0,
      paid: true,
      certificate_kind: null,
      booked_at: "2020-03-30T05:20:47.000Z",
      labels: [],
    });
  });

  it("counts money above price as a tip only when no code was used", () => {
    const r = toStgAcuityAppointment(raw({ ...appt, amountPaid: "18.00" }), ctx);
    expect(r.ok && r.row.tip_cents).toBe(300);
    expect(r.ok && r.row.code_extra_paid_cents).toBe(0);
  });

  it("tracks money above a $0 post-code price separately — never as a tip (owner decision)", () => {
    const r = toStgAcuityAppointment(raw({ ...appt, certificate: "244ea515", price: "0.00", amountPaid: "3.00" }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toMatchObject({
      certificate_code: "244ea515",
      certificate_kind: "membership",
      list_price_cents: 1500,
      price_cents: 0,
      discount_cents: 1500,
      tip_cents: 0,
      code_extra_paid_cents: 300,
    });
  });

  it("keeps labels and missing_since", () => {
    const r = toStgAcuityAppointment(
      raw({ ...appt, labels: [{ id: 1, name: "Checked In", color: "green" }] }, { missing_since: new Date("2026-10-01T00:00:00Z") }),
      ctx,
    );
    expect(r.ok && r.row.labels).toEqual(["Checked In"]);
    expect(r.ok && r.row.missing_since).toBe("2026-10-01T00:00:00.000Z");
  });

  it("turns a malformed payload into an error, not a crash", () => {
    const r = toStgAcuityAppointment(raw({ ...appt, paid: "maybe" }), ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/paid/);
  });
});

describe("toStgAcuityPayment", () => {
  it("maps a Square-processed payment and links it to its appointment", () => {
    const r = toStgAcuityPayment(
      raw(
        { transactionID: "Icr7sZfU3kVi9JA0dZuoiXteV", created: "2020-03-30T07:57:23-0700", processor: "square", amount: "15.00", relatedPaymentsCount: 1 },
        { external_id: "369245755:2020-03-30T07:57:23-0700:square:15.00", parent_external_id: "369245755" },
      ),
      ctx,
    );
    expect(r.ok && r.row).toMatchObject({
      appointment_id: 369245755,
      processor_txn_id: "Icr7sZfU3kVi9JA0dZuoiXteV",
      amount_cents: 1500,
      paid_at: "2020-03-30T14:57:23.000Z",
      local_date: "2020-03-30",
    });
  });

  it("stores an empty cash transactionID as null", () => {
    const r = toStgAcuityPayment(raw({ transactionID: "", processor: "cash", amount: "60.00" }, { parent_external_id: "1" }), ctx);
    expect(r.ok && r.row.processor_txn_id).toBeNull();
  });

  it("errors without a parent appointment", () => {
    expect(toStgAcuityPayment(raw({ amount: "1.00" }), ctx).ok).toBe(false);
  });
});

describe("toStgAcuityOrder", () => {
  it("reads a numeric total and an offset-less LA order time", () => {
    const r = toStgAcuityOrder(
      raw({ id: 163360384, total: 40, time: "2026-09-29 22:22:34", status: "paid", title: "Monthly Membership", products: [{ name: "Monthly Membership", quantity: 1 }] }),
      ctx,
    );
    expect(r.ok && r.row).toMatchObject({
      order_id: 163360384,
      total_cents: 4000,
      ordered_at: "2026-09-30T05:22:34.000Z",
      local_date: "2026-09-29",
      product_summary: "1× Monthly Membership",
    });
  });
});

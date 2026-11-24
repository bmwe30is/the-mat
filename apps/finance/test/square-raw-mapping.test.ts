import { describe, expect, it } from "vitest";
import { monthChunks } from "../src/lib/windows.js";
import {
  customerAliasToRaw,
  customerToRaw,
  idsToFetch,
  invoiceToRaw,
  paymentToRaw,
  refundToRaw,
  squareWindow,
} from "../src/sources/square/raw-mapping.js";
import type { SquarePayment } from "../src/sources/square/types.js";

const LA = "America/Los_Angeles";

describe("squareWindow", () => {
  it("pads the LA month and converts to UTC instants (PST start, PDT end)", () => {
    const [march] = monthChunks("2020-03-01", "2020-03-31");
    const w = squareWindow(march, LA);
    expect(w.begin.toISOString()).toBe("2020-02-29T08:00:00.000Z");
    expect(w.end.toISOString()).toBe("2020-04-02T07:00:00.000Z");
  });

  it("crosses the year boundary for December", () => {
    const [dec] = monthChunks("2020-12-01", "2020-12-31");
    const w = squareWindow(dec, LA);
    expect(w.begin.toISOString()).toBe("2020-11-30T08:00:00.000Z");
    expect(w.end.toISOString()).toBe("2021-01-02T08:00:00.000Z");
  });
});

describe("paymentToRaw", () => {
  it("windows by the LA date of created_at, not the UTC date", () => {
    // 06:30Z on Apr 1 is still Mar 31 (11:30 PM PDT) in LA.
    const p = { id: "pay1", created_at: "2020-04-01T06:30:00.000Z", updated_at: "2020-04-01T06:31:00.000Z" } as SquarePayment;
    const r = paymentToRaw(p, LA);
    expect(r.externalId).toBe("pay1");
    expect(r.windowDate).toBe("2020-03-31");
    expect(r.sourceUpdatedAt?.toISOString()).toBe("2020-04-01T06:31:00.000Z");
  });
});

describe("refundToRaw / invoiceToRaw", () => {
  it("links refunds to their payment and invoices to their order", () => {
    expect(refundToRaw({ id: "r1", payment_id: "pay1", created_at: "2020-08-10T20:00:00Z" }, LA)).toMatchObject({
      externalId: "r1",
      parentExternalId: "pay1",
      windowDate: "2020-08-10",
    });
    expect(invoiceToRaw({ id: "inv1", order_id: "ord1" })).toMatchObject({ externalId: "inv1", parentExternalId: "ord1" });
  });
});

describe("customers", () => {
  it("hashes the same regardless of segment_ids order, but stores the payload as returned", () => {
    const a = customerToRaw({ id: "c1", segment_ids: ["B", "A"] });
    const b = customerToRaw({ id: "c1", segment_ids: ["A", "B"] });
    expect(a.payloadHash).toBe(b.payloadHash);
    expect((a.payload as { segment_ids: string[] }).segment_ids).toEqual(["B", "A"]);
  });

  it("records a merged-away id as an alias of the surviving customer", () => {
    expect(customerAliasToRaw("old", "new")).toMatchObject({
      externalId: "old",
      parentExternalId: "new",
      payload: { requested_id: "old", customer_id: "new" },
    });
  });
});

describe("idsToFetch", () => {
  it("fetches new/changed refs and anything not stored, deduplicated and sorted", () => {
    const ids = idsToFetch(
      [
        { id: "o3", force: false }, // not stored → fetch
        { id: "o1", force: false }, // stored, unchanged → skip
        { id: "o2", force: true }, // stored but its payment changed → fetch
        { id: "o3", force: false }, // duplicate
        { id: undefined, force: true }, // payment without an order
      ],
      new Set(["o1", "o2"]),
    );
    expect(ids).toEqual(["o2", "o3"]);
  });
});

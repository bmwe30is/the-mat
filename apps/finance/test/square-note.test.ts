import { describe, expect, it } from "vitest";
import { parseSquareNote } from "../src/sources/square/note.js";

// Shapes copied from probe findings with made-up words (no real client data).
describe("parseSquareNote", () => {
  it("reads a leading appointment id", () => {
    expect(parseSquareNote("1764688793 - Yoga Flow - Online: Class with Teacher (Mondays) - Sep 14, 2026 10:45am")).toEqual({
      kind: "appointment",
      appointmentId: "1764688793",
    });
  });

  it("reads Acuity order ids in both formats", () => {
    expect(parseSquareNote("Order #44035300")).toEqual({ kind: "order", orderId: "44035300" });
    expect(parseSquareNote("Order 163224681 - 10 Class Pack")).toEqual({ kind: "order", orderId: "163224681" });
  });

  it("reads subscription charges and their certificate code", () => {
    expect(parseSquareNote("Subscription 792817 - Monthly Unlimited - Recurring payment - 67a0b014")).toEqual({
      kind: "subscription",
      subscriptionId: "792817",
      certificateCode: "67A0B014",
    });
  });

  it("reads the 2020-era subscription form (id only)", () => {
    expect(parseSquareNote("792817 (Monthly Unlimited Membership)")).toEqual({ kind: "subscription", subscriptionId: "792817" });
  });

  it("recognises 2020-era dated notes that carry no id", () => {
    expect(parseSquareNote("Pat Example on March 4, 2020 5:30pm (Yoga Practice")).toEqual({ kind: "dated", classDate: "2020-03-04" });
    expect(parseSquareNote("Pat Example on Smarch 4, 2020 5:30pm (Yoga")).toEqual({ kind: "dated" });
  });

  it("handles empty and unknown notes", () => {
    expect(parseSquareNote(undefined)).toEqual({ kind: "empty" });
    expect(parseSquareNote("walk-in")).toEqual({ kind: "other" });
  });
});

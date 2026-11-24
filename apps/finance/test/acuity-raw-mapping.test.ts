import { describe, expect, it } from "vitest";
import { monthChunks, paddedDates } from "../src/lib/windows.js";
import { appointmentToRaw, orderToRaw, paymentsToRaw } from "../src/sources/acuity/raw-mapping.js";
import type { AcuityAppointment } from "../src/sources/acuity/types.js";

const LA = "America/Los_Angeles";

describe("monthChunks", () => {
  it("splits the seed window into clamped calendar months", () => {
    const c = monthChunks("2020-03-01", "2020-12-31");
    expect(c).toHaveLength(10);
    expect(c[0]).toEqual({ month: "2020-03", from: "2020-03-01", to: "2020-03-31" });
    expect(c.at(-1)).toEqual({ month: "2020-12", from: "2020-12-01", to: "2020-12-31" });
  });

  it("clamps partial months and crosses year ends", () => {
    expect(monthChunks("2020-12-15", "2021-01-10")).toEqual([
      { month: "2020-12", from: "2020-12-15", to: "2020-12-31" },
      { month: "2021-01", from: "2021-01-01", to: "2021-01-10" },
    ]);
  });

  it("pads each chunk by a day, including across leap day", () => {
    expect(paddedDates({ month: "2020-03", from: "2020-03-01", to: "2020-03-31" })).toEqual({
      from: "2020-02-29",
      to: "2020-04-01",
    });
  });

  it("rejects an inverted range", () => {
    expect(() => monthChunks("2020-05-01", "2020-04-01")).toThrow();
  });
});

describe("appointmentToRaw", () => {
  const appt = {
    id: 369245755,
    datetime: "2020-03-31T23:30:00-0700",
    datetimeCreated: "2020-03-30T00:20:47-0500",
    canClientCancel: true,
  } as AcuityAppointment;

  it("keys by id and windows by the LA class date", () => {
    const r = appointmentToRaw(appt, LA);
    expect(r.externalId).toBe("369245755");
    expect(r.windowDate).toBe("2020-03-31");
    expect(r.sourceCreatedAt?.toISOString()).toBe("2020-03-30T05:20:47.000Z");
  });

  it("ignores cancel/reschedule flags when hashing", () => {
    expect(appointmentToRaw({ ...appt, canClientCancel: false }, LA).payloadHash).toBe(appointmentToRaw(appt, LA).payloadHash);
  });
});

describe("paymentsToRaw", () => {
  it("builds stable keys and de-duplicates identical payments", () => {
    const p = { created: "2020-03-30T07:57:23-0700", processor: "square", amount: "15.00", transactionID: "x" };
    const rows = paymentsToRaw(42, [p, { ...p }]);
    expect(rows.map((r) => r.externalId)).toEqual([
      "42:2020-03-30T07:57:23-0700:square:15.00",
      "42:2020-03-30T07:57:23-0700:square:15.00#2",
    ]);
    expect(rows[0].parentExternalId).toBe("42");
  });
});

describe("orderToRaw", () => {
  it("reads the offset-less order time as LA time", () => {
    expect(orderToRaw({ id: 1, time: "2026-09-29 22:22:34" }, LA).sourceCreatedAt?.toISOString()).toBe(
      "2026-09-30T05:22:34.000Z",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  localDateOf,
  localDayStartUtc,
  localRangeToUtc,
  monthBounds,
  parseLocalDateTime,
  parseSourceInstant,
  sourceOffset,
} from "../src/lib/time.js";

const LA = "America/Los_Angeles";

describe("parseSourceInstant", () => {
  it("parses Acuity offsets without a colon", () => {
    expect(parseSourceInstant("2020-03-02T09:00:00-0800").toISOString()).toBe("2020-03-02T17:00:00.000Z");
  });

  it("parses an Eastern offset to the right instant", () => {
    expect(parseSourceInstant("2020-03-02T09:00:00-0500").toISOString()).toBe("2020-03-02T14:00:00.000Z");
  });

  it("parses Square UTC timestamps", () => {
    expect(parseSourceInstant("2020-03-02T17:00:00.123Z").toISOString()).toBe("2020-03-02T17:00:00.123Z");
  });

  it("parses offset-less local timestamps in the given zone (DST-aware)", () => {
    expect(parseLocalDateTime("2026-09-29 22:22:34", LA).toISOString()).toBe("2026-09-30T05:22:34.000Z"); // PDT
    expect(parseLocalDateTime("2020-12-01 08:00:00", LA).toISOString()).toBe("2020-12-01T16:00:00.000Z"); // PST
    expect(parseLocalDateTime("2020-03-02T09:00:00-0500", LA).toISOString()).toBe("2020-03-02T14:00:00.000Z");
    expect(() => parseLocalDateTime("March 2", LA)).toThrow();
  });

  it("refuses timestamps without an offset", () => {
    expect(() => parseSourceInstant("2020-03-02T09:00:00")).toThrow(/no offset/);
  });

  it("reports the source offset", () => {
    expect(sourceOffset("2020-03-02T09:00:00-0500")).toBe("-0500");
    expect(sourceOffset("2020-03-02T17:00:00Z")).toBe("Z");
  });
});

describe("localDateOf", () => {
  it("puts 11:30 PM PT on the last day of a month in that month", () => {
    // 2020-03-31 23:30 PDT == 2020-04-01 06:30 UTC
    expect(localDateOf(new Date("2020-04-01T06:30:00Z"), LA)).toBe("2020-03-31");
  });

  it("puts an Eastern-offset morning booking on the same LA date", () => {
    expect(localDateOf(parseSourceInstant("2020-03-02T09:00:00-0500"), LA)).toBe("2020-03-02");
  });
});

describe("DST transition Sundays", () => {
  it("2020-03-08 (spring forward) starts at 08:00Z and is 23h long", () => {
    expect(localDayStartUtc("2020-03-08", LA).toISOString()).toBe("2020-03-08T08:00:00.000Z");
    expect(localDayStartUtc("2020-03-09", LA).toISOString()).toBe("2020-03-09T07:00:00.000Z");
  });

  it("2020-11-01 (fall back) starts at 07:00Z and is 25h long", () => {
    expect(localDayStartUtc("2020-11-01", LA).toISOString()).toBe("2020-11-01T07:00:00.000Z");
    expect(localDayStartUtc("2020-11-02", LA).toISOString()).toBe("2020-11-02T08:00:00.000Z");
  });

  it("stepping by local days crosses DST without drifting", () => {
    expect(addLocalDays("2020-03-07", 1)).toBe("2020-03-08");
    expect(addLocalDays("2020-03-08", 1)).toBe("2020-03-09");
    expect(addLocalDays("2020-10-31", 2)).toBe("2020-11-02");
  });
});

describe("ranges", () => {
  it("converts an inclusive local range to a half-open padded UTC window", () => {
    const { begin, end } = localRangeToUtc("2020-03-01", "2020-03-31", LA, 1);
    expect(begin.toISOString()).toBe("2020-02-29T08:00:00.000Z"); // leap day, PST
    expect(end.toISOString()).toBe("2020-04-02T07:00:00.000Z"); // PDT
  });

  it("knows month lengths", () => {
    expect(monthBounds("2020-02")).toEqual({ from: "2020-02-01", to: "2020-02-29" });
    expect(monthBounds("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

import { describe, expect, it } from "vitest";
import { decimalToCents, formatCents, squareMoneyToCents } from "../src/lib/money.js";

describe("decimalToCents", () => {
  it.each([
    ["25.00", 2500],
    ["25", 2500],
    ["25.5", 2550],
    ["0.10", 10],
    [".99", 99],
    ["-3.10", -310],
    ["1,234.56", 123456],
    ["19.990", 1999],
    ["", 0],
    [null, 0],
  ])("%s → %d", (input, cents) => {
    expect(decimalToCents(input)).toBe(cents);
  });

  it("is exact where floats are not", () => {
    // parseFloat("0.29") * 100 === 28.999999999999996
    expect(decimalToCents("0.29")).toBe(29);
    expect(decimalToCents("1.15")).toBe(115);
  });

  it("rejects junk and sub-cent amounts", () => {
    expect(() => decimalToCents("abc")).toThrow();
    expect(() => decimalToCents("1.005")).toThrow(/sub-cent/);
  });
});

describe("squareMoneyToCents / formatCents", () => {
  it("passes Square cents through and guards currency", () => {
    expect(squareMoneyToCents({ amount: 2500, currency: "USD" })).toBe(2500);
    expect(squareMoneyToCents(undefined)).toBe(0);
    expect(() => squareMoneyToCents({ amount: 1, currency: "CAD" })).toThrow();
  });

  it("formats for display", () => {
    expect(formatCents(2550)).toBe("25.50");
    expect(formatCents(-5)).toBe("-0.05");
  });
});

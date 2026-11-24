import { describe, expect, it } from "vitest";
import { maskCode, scrub } from "../src/probe/scrub.js";

describe("scrub", () => {
  it("removes PII keys at any depth, case-insensitively", () => {
    const out = scrub({
      id: 123,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "555-1234",
      card_details: { card: { last_4: "4242", cardholder_name: "ADA L", card_brand: "VISA" } },
      customer: { given_name: "Ada", email_address: "ada@example.com" },
    });
    expect(out).toEqual({
      id: 123,
      firstName: "[scrubbed]",
      lastName: "[scrubbed]",
      email: "[scrubbed]",
      phone: "[scrubbed]",
      card_details: { card: { last_4: "[scrubbed]", cardholder_name: "[scrubbed]", card_brand: "VISA" } },
      customer: { given_name: "[scrubbed]", email_address: "[scrubbed]" },
    });
  });

  it("masks letters in free text but keeps digits (so embedded IDs stay visible)", () => {
    expect(scrub({ note: "Acuity appt 123456789 for Ada" })).toEqual({ note: "xxxxxx xxxx 123456789 xxx xxx" });
  });

  it("masks emails inside other strings and keeps empty PII values as-is", () => {
    expect(scrub({ description: "contact ada@example.com", email: "" })).toEqual({
      description: "contact [email]",
      email: "",
    });
  });

  it("masks codes", () => {
    expect(maskCode("WELCOME10")).toBe("WEL…(9)");
  });
});

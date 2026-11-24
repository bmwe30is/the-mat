import { describe, expect, it } from "vitest";
import { canonicalJson, payloadHash } from "../src/lib/hash.js";

describe("canonicalJson", () => {
  it("sorts object keys at every depth but keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it("drops undefined values like JSON.stringify does", () => {
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });
});

describe("payloadHash", () => {
  it("is the same regardless of key order", () => {
    expect(payloadHash({ id: 1, price: "15.00" })).toBe(payloadHash({ price: "15.00", id: 1 }));
  });

  it("changes when a value changes", () => {
    expect(payloadHash({ id: 1, price: "15.00" })).not.toBe(payloadHash({ id: 1, price: "18.00" }));
  });

  it("ignores the listed volatile top-level keys", () => {
    const ignore = ["canClientCancel"];
    expect(payloadHash({ id: 1, canClientCancel: true }, ignore)).toBe(payloadHash({ id: 1, canClientCancel: false }, ignore));
    expect(payloadHash({ id: 1, canClientCancel: true })).not.toBe(payloadHash({ id: 1, canClientCancel: false }));
  });
});

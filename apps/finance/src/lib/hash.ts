// Stable hashing for change detection in the raw layer.
//
// Two payloads that mean the same thing must hash the same, even if the API
// returns their keys in a different order. So we serialise with object keys
// sorted (arrays keep their order — order inside an array can be meaningful).
import crypto from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined) // JSON.stringify drops undefined too
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * sha256 of the canonical JSON. `ignoreKeys` are top-level fields left out of
 * the hash because they change on their own without the record really
 * changing (e.g. Acuity's `canClientCancel` flips once the cancel cutoff
 * passes). The full payload is still stored; only change detection skips them.
 */
export function payloadHash(payload: unknown, ignoreKeys: readonly string[] = []): string {
  let value = payload;
  if (ignoreKeys.length && payload && typeof payload === "object" && !Array.isArray(payload)) {
    value = Object.fromEntries(Object.entries(payload).filter(([k]) => !ignoreKeys.includes(k)));
  }
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

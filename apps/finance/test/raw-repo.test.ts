import { describe, expect, it } from "vitest";
import { partitionByHash, type RawInput } from "../src/raw/repo.js";

const rec = (externalId: string, payloadHash: string): RawInput => ({ externalId, payloadHash, payload: {} });

describe("partitionByHash", () => {
  it("splits into new, changed and unchanged", () => {
    const existing = new Map([
      ["a", "h1"],
      ["b", "h2"],
    ]);
    const p = partitionByHash([rec("a", "h1"), rec("b", "CHANGED"), rec("c", "h3")], existing);
    expect(p.unchanged.map((r) => r.externalId)).toEqual(["a"]);
    expect(p.changed.map((r) => r.externalId)).toEqual(["b"]);
    expect(p.new.map((r) => r.externalId)).toEqual(["c"]);
  });

  it("keeps only the last copy of an id that appears twice in a batch", () => {
    const p = partitionByHash([rec("a", "old"), rec("a", "new")], new Map([["a", "old"]]));
    expect(p.changed).toHaveLength(1);
    expect(p.changed[0].payloadHash).toBe("new");
    expect(p.unchanged).toHaveLength(0);
  });

  it("treats everything as new on an empty table", () => {
    const p = partitionByHash([rec("a", "h"), rec("b", "h")], new Map());
    expect(p.new).toHaveLength(2);
  });
});

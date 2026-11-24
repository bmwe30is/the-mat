import { describe, expect, it } from "vitest";
import { sampleRows } from "../src/commands/query.js";
import { bindNamedParams, parseParamsHeader } from "../src/db/sql-file.js";

describe("bindNamedParams", () => {
  it("replaces params with positional binds", () => {
    const q = bindNamedParams("select * from t where d between :from and :to", { from: "a", to: "b" });
    expect(q.text).toBe("select * from t where d between $1 and $2");
    expect(q.values).toEqual(["a", "b"]);
    expect(q.names).toEqual(["from", "to"]);
  });

  it("reuses the same position for a repeated name", () => {
    const q = bindNamedParams("select :x, :y, :x", { x: 1, y: 2 });
    expect(q.text).toBe("select $1, $2, $1");
    expect(q.values).toEqual([1, 2]);
  });

  it("leaves :: casts alone", () => {
    const q = bindNamedParams("select :from::date, ts::timestamptz", { from: "2020-03-01" });
    expect(q.text).toBe("select $1::date, ts::timestamptz");
  });

  it("ignores colons inside string literals, identifiers and comments", () => {
    const sql = [
      "-- filter by :ignored_line",
      "select '10:30 :nope', 'it''s :nope', \"col:nope\", E'\\' :nope'",
      "/* :ignored /* nested :also */ still :ignored */",
      "from t where a = :a",
    ].join("\n");
    const q = bindNamedParams(sql, { a: 1 });
    expect(q.names).toEqual(["a"]);
    expect(q.text.endsWith("where a = $1")).toBe(true);
    expect(q.text).toContain("'10:30 :nope'");
  });

  it("ignores dollar-quoted strings but not $1 positional params", () => {
    const q = bindNamedParams("select $$ :nope $$, $tag$ :nope $tag$, :a", { a: 1 });
    expect(q.names).toEqual(["a"]);
    expect(q.text).toBe("select $$ :nope $$, $tag$ :nope $tag$, $1");
  });

  it("throws a clear error listing missing params", () => {
    expect(() => bindNamedParams("select :from, :to, :x", { from: "a" })).toThrow(/:to, :x/);
  });

  it("never puts values into the SQL text", () => {
    const evil = "'; drop table finance.sync_run; --";
    const q = bindNamedParams("select :v", { v: evil });
    expect(q.text).toBe("select $1");
    expect(q.values).toEqual([evil]);
  });

  it("treats a lone colon or a colon before a digit as plain text", () => {
    const q = bindNamedParams("select array[1,2,3][1:2], 'x' : 1", {});
    expect(q.names).toEqual([]);
  });
});

describe("parseParamsHeader", () => {
  it("parses names and types", () => {
    expect(parseParamsHeader("-- params: from (date), to (date), tz\nselect 1")).toEqual([
      { name: "from", type: "date" },
      { name: "to", type: "date" },
      { name: "tz", type: undefined },
    ]);
  });

  it("returns [] for none and undefined when absent", () => {
    expect(parseParamsHeader("-- params: none\nselect 1")).toEqual([]);
    expect(parseParamsHeader("select 1")).toBeUndefined();
  });
});

describe("sampleRows", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }));

  it("is repeatable and keeps the original order", () => {
    const a = sampleRows(rows, 20);
    expect(a).toHaveLength(20);
    expect(sampleRows(rows, 20)).toEqual(a);
    expect(a.map((r) => r.id)).toEqual([...a.map((r) => r.id)].sort((x, y) => x - y));
  });

  it("returns everything when n exceeds the row count", () => {
    expect(sampleRows(rows.slice(0, 3), 20)).toHaveLength(3);
  });
});

import { describe, expect, it } from "vitest";
import { planMigrations, sha256, sortMigrationFilenames, type MigrationFile } from "../src/db/migrate.js";

const file = (filename: string, sql = `-- ${filename}`): MigrationFile => ({ filename, sql, checksum: sha256(sql) });

describe("sortMigrationFilenames", () => {
  it("sorts numerically and ignores non-sql files", () => {
    expect(sortMigrationFilenames(["0002_raw.sql", "README.md", "0001_schema_and_ops.sql"])).toEqual([
      "0001_schema_and_ops.sql",
      "0002_raw.sql",
    ]);
  });

  it("rejects bad names and duplicate numbers", () => {
    expect(() => sortMigrationFilenames(["1_raw.sql"])).toThrow(/Bad migration filename/);
    expect(() => sortMigrationFilenames(["0001_a.sql", "0001_b.sql"])).toThrow(/share number 0001/);
  });
});

describe("planMigrations", () => {
  const f1 = file("0001_a.sql");
  const f2 = file("0002_b.sql");

  it("returns everything on a fresh database", () => {
    expect(planMigrations([f1, f2], [])).toEqual([f1, f2]);
  });

  it("is a no-op when everything is applied", () => {
    expect(planMigrations([f1, f2], [f1, f2])).toEqual([]);
  });

  it("returns only pending files", () => {
    expect(planMigrations([f1, f2], [f1])).toEqual([f2]);
  });

  it("refuses when an applied file was edited", () => {
    const edited = { ...f1, checksum: sha256("changed") };
    expect(() => planMigrations([edited, f2], [f1])).toThrow(/were edited: 0001_a.sql/);
  });

  it("refuses when an applied file is missing from disk", () => {
    expect(() => planMigrations([f2], [f1, f2])).toThrow(/missing from disk/);
  });

  it("refuses a pending file that sorts before the last applied one", () => {
    const f0 = file("0000_early.sql");
    expect(() => planMigrations([f0, f1, f2], [f1, f2])).toThrow(/Renumber/);
  });
});

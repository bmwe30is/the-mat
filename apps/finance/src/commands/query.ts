// `finance query <file.sql>` — run a report SQL file (PRD §11.2).
//
// The query always runs inside `BEGIN READ ONLY … ROLLBACK`, so even a report
// file that accidentally contains an INSERT/UPDATE/DELETE can't change data.
import Table from "cli-table3";
import { stringify } from "csv-stringify/sync";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { behaviourConfig, FINANCE_ROOT } from "../config.js";
import { getPool } from "../db/pool.js";
import { bindNamedParams, loadSqlFile, parseParamsHeader } from "../db/sql-file.js";

export interface QueryOptions {
  from?: string;
  to?: string;
  param?: string[];
  csv?: boolean;
  limit?: number;
  explain?: boolean;
  sample?: number;
}

/**
 * A deterministic "random" sample: rows ordered by a hash of their contents,
 * first `n` kept, then put back in the query's own order. The same data always
 * gives the same sample, so a spot-check can be repeated and discussed.
 */
export function sampleRows<T>(rows: T[], n: number): T[] {
  const keyed = rows.map((r, i) => ({ r, i, h: crypto.createHash("md5").update(JSON.stringify(r)).digest("hex") }));
  return keyed
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.i - b.i))
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.r);
}

/** `--param key=value` (repeatable) → { key: value } */
export function parseParamFlags(flags: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of flags) {
    const eq = f.indexOf("=");
    if (eq <= 0) throw new Error(`--param must look like name=value, got "${f}"`);
    out[f.slice(0, eq)] = f.slice(eq + 1);
  }
  return out;
}

// Make cells printable: Dates as ISO (UTC), objects as JSON, null as empty.
export function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * npm runs workspace scripts from apps/finance, so `queries/x.sql` works from
 * anywhere. Also accept paths relative to where the user typed the command
 * (INIT_CWD), e.g. `apps/finance/queries/x.sql` from the repo root.
 */
export function resolveQueryPath(file: string): string {
  const fromInvoker = path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
  return fs.existsSync(fromInvoker) ? fromInvoker : path.resolve(file);
}

/**
 * Load a .sql file, bind its :named params and run it read-only. Shared by
 * `query` and `check`. Throws a clear error if a param has no value.
 */
export async function runSqlFileReadOnly(
  file: string,
  overrides: { from?: string; to?: string; param?: string[] } = {},
  explain = false,
): Promise<{ rows: Record<string, unknown>[]; fields: string[]; params: Record<string, unknown>; ms: number }> {
  const sql = loadSqlFile(file);
  const beh = behaviourConfig();

  const params: Record<string, unknown> = {
    from: overrides.from ?? beh.seedStart,
    to: overrides.to ?? beh.seedEnd,
    tz: beh.reportingTz,
    ...parseParamFlags(overrides.param),
  };

  // If the file declares its params, check them up front for a clearer error.
  const declared = parseParamsHeader(sql);
  if (declared) {
    const missing = declared.filter((d) => params[d.name] === undefined).map((d) => d.name);
    if (missing.length) throw new Error(`${file} declares params with no value: ${missing.join(", ")}`);
  }

  const bound = bindNamedParams(sql, params);
  const text = explain ? `EXPLAIN (ANALYZE, BUFFERS) ${bound.text}` : bound.text;

  const client = await getPool().connect();
  const started = performance.now();
  try {
    await client.query("BEGIN READ ONLY");
    const res = await client.query(text, bound.values);
    return { rows: res.rows, fields: res.fields.map((f) => f.name), params, ms: Math.round(performance.now() - started) };
  } finally {
    // Always roll back: a report must never leave changes behind.
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

export async function runQuery(fileArg: string, opts: QueryOptions): Promise<void> {
  const file = resolveQueryPath(fileArg);
  const result = await runSqlFileReadOnly(file, opts, opts.explain);
  const { fields, params, ms } = result;
  const rows = opts.sample ? sampleRows(result.rows, opts.sample) : result.rows;

  if (opts.explain) {
    console.log(rows.map((r) => r["QUERY PLAN"]).join("\n"));
    return;
  }

  if (opts.csv) {
    const stem = path.basename(file, ".sql");
    const outDir = path.join(FINANCE_ROOT, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${stem}_${params.from}_${params.to}${opts.sample ? `_sample${opts.sample}` : ""}.csv`);
    const csv = stringify([fields, ...rows.map((r) => fields.map((f) => cell(r[f])))]);
    fs.writeFileSync(outPath, csv);
    console.log(`${rows.length} rows · ${ms} ms → ${path.relative(process.cwd(), outPath)}`);
    return;
  }

  const limit = opts.limit ?? 50;
  const table = new Table({ head: fields });
  for (const r of rows.slice(0, limit)) table.push(fields.map((f) => cell(r[f])));
  console.log(table.toString());
  const shown = rows.length > limit ? ` (showing ${limit}; use --limit or --csv)` : "";
  console.log(`${rows.length} rows · ${ms} ms${shown}`);
}

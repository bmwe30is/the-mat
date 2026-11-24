// Plain-SQL migration runner (PRD §7.1). No ORM.
//
// How it works:
//   1. Make sure the `finance` schema and `finance.schema_migrations` exist.
//      These are created here, not in 0001, because the runner needs the
//      bookkeeping table before it can know which files have run.
//   2. Take a Postgres advisory lock so two `migrate` runs can't interleave.
//   3. Compare db/migrations/*.sql against schema_migrations:
//        - an applied file whose checksum changed → stop (write a new migration instead)
//        - a pending file → run it and record it, in ONE transaction (all or nothing)
//
// The planning step (`planMigrations`) is a pure function so it can be unit-tested
// without a database.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import type pg from "pg";
import { FINANCE_ROOT } from "../config.js";
import { logger } from "../lib/logger.js";
import { getPool, withTransaction } from "./pool.js";

export const MIGRATIONS_DIR = path.join(FINANCE_ROOT, "db", "migrations");
const FILENAME_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;
// Arbitrary constant; any process holding this advisory lock is "the migrator".
const LOCK_KEY = 7_202_603_01;

export interface MigrationFile {
  filename: string;
  checksum: string;
  sql: string;
}

export interface AppliedMigration {
  filename: string;
  checksum: string;
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Validate filenames and return them in apply order. Throws on bad names or duplicate numbers. */
export function sortMigrationFilenames(filenames: string[]): string[] {
  const sqlFiles = filenames.filter((f) => f.endsWith(".sql"));
  const bad = sqlFiles.filter((f) => !FILENAME_RE.test(f));
  if (bad.length) throw new Error(`Bad migration filename(s) (want NNNN_lower_snake.sql): ${bad.join(", ")}`);

  const sorted = [...sqlFiles].sort();
  const seen = new Set<string>();
  for (const f of sorted) {
    const num = f.slice(0, 4);
    if (seen.has(num)) throw new Error(`Two migrations share number ${num}`);
    seen.add(num);
  }
  return sorted;
}

/**
 * Decide what to run. Pure: given the files on disk and the rows in
 * schema_migrations, return the pending files, or throw if history was edited.
 */
export function planMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationFile[] {
  const onDisk = new Map(files.map((f) => [f.filename, f]));
  const changed: string[] = [];
  const missing: string[] = [];
  for (const a of applied) {
    const f = onDisk.get(a.filename);
    if (!f) missing.push(a.filename);
    else if (f.checksum !== a.checksum) changed.push(a.filename);
  }
  if (changed.length) {
    throw new Error(
      `Already-applied migration(s) were edited: ${changed.join(", ")}. ` +
        `Revert the edit and put the change in a new migration file.`,
    );
  }
  if (missing.length) {
    throw new Error(`Applied migration(s) missing from disk: ${missing.join(", ")}`);
  }

  const appliedNames = new Set(applied.map((a) => a.filename));
  const pending = files.filter((f) => !appliedNames.has(f.filename));

  // A pending file sorting before the newest applied one means someone added a
  // migration "in the past" — order would differ between databases, so refuse.
  const lastApplied = [...appliedNames].sort().at(-1);
  const outOfOrder = lastApplied ? pending.filter((p) => p.filename < lastApplied) : [];
  if (outOfOrder.length) {
    throw new Error(
      `Pending migration(s) sort before the last applied one (${lastApplied}): ` +
        `${outOfOrder.map((f) => f.filename).join(", ")}. Renumber them.`,
    );
  }
  return pending;
}

export function readMigrationFiles(dir = MIGRATIONS_DIR): MigrationFile[] {
  return sortMigrationFilenames(fs.readdirSync(dir)).map((filename) => {
    const sql = fs.readFileSync(path.join(dir, filename), "utf8");
    return { filename, sql, checksum: sha256(sql) };
  });
}

async function bootstrap(client: pg.PoolClient) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS finance`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS finance.schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  // No policies = anon/authenticated roles can't read it even if exposed.
  await client.query(`ALTER TABLE finance.schema_migrations ENABLE ROW LEVEL SECURITY`);
}

async function tableExists(client: pg.PoolClient, qualified: string): Promise<boolean> {
  const { rows } = await client.query<{ t: string | null }>(`SELECT to_regclass($1) AS t`, [qualified]);
  return rows[0].t !== null;
}

export interface MigrateOptions {
  dryRun?: boolean;
}

export async function migrate(opts: MigrateOptions = {}): Promise<{ applied: string[] }> {
  const files = readMigrationFiles();
  const client = await getPool().connect();
  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [LOCK_KEY]);
    await bootstrap(client);

    const { rows: applied } = await client.query<AppliedMigration>(
      `SELECT filename, checksum FROM finance.schema_migrations ORDER BY filename`,
    );
    const pending = planMigrations(files, applied);

    if (pending.length === 0) {
      logger.info({ applied: applied.length }, "0 pending migrations — database is up to date");
      return { applied: [] };
    }
    if (opts.dryRun) {
      logger.info({ pending: pending.map((p) => p.filename) }, "dry run: would apply");
      return { applied: [] };
    }

    const startedAt = new Date();
    const done: string[] = [];
    for (const m of pending) {
      // Each file + its bookkeeping row commit together, or not at all.
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(`INSERT INTO finance.schema_migrations (filename, checksum) VALUES ($1, $2)`, [
          m.filename,
          m.checksum,
        ]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${m.filename} failed and was rolled back: ${(err as Error).message}`);
      }
      done.push(m.filename);
      logger.info({ file: m.filename }, "applied");
    }

    // sync_run is created by 0001, so only record the run once it exists.
    if (await tableExists(client, "finance.sync_run")) {
      await client.query(
        `INSERT INTO finance.sync_run (job, status, started_at, finished_at)
         VALUES ('migrate', 'succeeded', $1, now())`,
        [startedAt],
      );
    }
    return { applied: done };
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/**
 * Drop and recreate the finance schema. Local development only.
 * Requires --yes AND typing the schema name at an interactive prompt.
 */
export async function resetSchema(opts: { yes?: boolean }): Promise<void> {
  if (!opts.yes) throw new Error("migrate --reset also requires --yes");
  if (!process.stdin.isTTY) throw new Error("migrate --reset needs an interactive terminal to confirm");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "This DROPS the `finance` schema and ALL its data (raw, staging, recon, manual overrides).\n" +
      "Type `finance` to confirm: ",
  );
  rl.close();
  if (answer.trim() !== "finance") throw new Error("Reset aborted.");

  await withTransaction(async (c) => {
    await c.query(`DROP SCHEMA IF EXISTS finance CASCADE`);
  });
  logger.warn("finance schema dropped");
}

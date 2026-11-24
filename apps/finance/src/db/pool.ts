// The single Postgres connection pool for the finance CLI.
//
// Everything that talks to the database goes through `pool` (single reads) or
// `withTransaction` (anything that writes more than one statement).
import fs from "node:fs";
import pg from "pg";
import { dbConfig } from "../config.js";

// A SQL `date` has no time or timezone. pg's default turns it into a JS Date at
// *local* midnight, which then prints as e.g. "2020-06-02T07:00:00.000Z" — the
// wrong day in any UTC output. Keep dates as their 'YYYY-MM-DD' text instead.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const cfg = dbConfig();

  // Supabase requires TLS. If a CA cert is configured we verify the server's
  // certificate (best). Without one we still encrypt, but skip verification —
  // acceptable for a local CLI, but set FINANCE_DB_SSL_CA before running this
  // anywhere less trusted.
  const ssl = cfg.ssl
    ? cfg.sslCaPath
      ? { ca: fs.readFileSync(cfg.sslCaPath, "utf8"), rejectUnauthorized: true }
      : { rejectUnauthorized: false }
    : false;

  // Note: we deliberately do NOT override pg's int8 parser. bigint columns
  // (our money columns) come back as strings, so a large value can never be
  // silently rounded by JavaScript's Number. Convert explicitly where needed.
  pool = new pg.Pool({
    connectionString: cfg.url,
    ssl,
    max: 5,
    // Make every session UTC so timestamptz values are never shifted by a
    // server/session default (PRD §8 rule 8). Supabase is UTC already; be explicit.
    // `onConnect` is awaited before the pool hands the client out, so this SET
    // always finishes before the caller's first query.
    onConnect: async (client) => {
      await client.query("SET TIME ZONE 'UTC'");
    },
  });

  return pool;
}

/**
 * Run `fn` inside BEGIN/COMMIT on one dedicated client. Any thrown error rolls
 * the whole thing back, so callers never leave a half-written state behind.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

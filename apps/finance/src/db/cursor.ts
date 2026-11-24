// finance.sync_cursor: tiny key/value store that makes extraction resumable.
import type pg from "pg";
import { getPool } from "./pool.js";

export async function getCursor(key: string): Promise<string | undefined> {
  const { rows } = await getPool().query<{ value: string }>(`SELECT value FROM finance.sync_cursor WHERE key = $1`, [key]);
  return rows[0]?.value;
}

/** Call inside the same transaction as the data it describes, so they can't disagree. */
export async function setCursor(client: pg.PoolClient, key: string, value: string): Promise<void> {
  await client.query(
    `INSERT INTO finance.sync_cursor (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

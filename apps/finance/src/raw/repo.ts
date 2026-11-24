// Writes to finance.raw_record with versioning (PRD §7.2).
//
// For each batch (one source + entity, ~500 records) inside one transaction:
//   1. Lock the existing rows for these ids and read their hashes.
//   2. Split the batch into new / changed / unchanged (pure: `partitionByHash`).
//   3. changed   → copy the current payload into raw_record_version first,
//      new+changed → one bulk INSERT … ON CONFLICT DO UPDATE,
//      unchanged → only bump last_seen_at / last_sync_run_id.
// Every row we see also gets missing_since cleared.
import type pg from "pg";

export type Source = "acuity" | "square";
export type RawStatus = "new" | "changed" | "unchanged";

export interface RawInput {
  externalId: string;
  parentExternalId?: string | null;
  payload: unknown;
  payloadHash: string;
  sourceCreatedAt?: Date | null;
  sourceUpdatedAt?: Date | null;
  windowDate?: string | null; // YYYY-MM-DD, studio-local
}

export interface UpsertCounts {
  new: number;
  changed: number;
  unchanged: number;
}

export interface UpsertResult extends UpsertCounts {
  /** Status of each external id written in this call. */
  statusById: Map<string, RawStatus>;
}

const BATCH_SIZE = 500;

/**
 * Pure: decide what to do with each incoming record given the hashes already
 * stored. If the same id appears twice in one batch, the last one wins (the
 * padded Acuity windows overlap by a day, so this happens).
 */
export function partitionByHash(
  inputs: RawInput[],
  existingHashes: Map<string, string>,
): { new: RawInput[]; changed: RawInput[]; unchanged: RawInput[] } {
  const latest = new Map<string, RawInput>();
  for (const r of inputs) latest.set(r.externalId, r);
  const out = { new: [] as RawInput[], changed: [] as RawInput[], unchanged: [] as RawInput[] };
  for (const r of latest.values()) {
    const stored = existingHashes.get(r.externalId);
    if (stored === undefined) out.new.push(r);
    else if (stored !== r.payloadHash) out.changed.push(r);
    else out.unchanged.push(r);
  }
  return out;
}

async function upsertBatch(
  client: pg.PoolClient,
  source: Source,
  entity: string,
  runId: number,
  batch: RawInput[],
  dryRun: boolean,
): Promise<UpsertResult> {
  const ids = [...new Set(batch.map((r) => r.externalId))];
  // FOR UPDATE: nobody else can change these rows until our transaction ends.
  const { rows } = await client.query<{ external_id: string; payload_hash: string }>(
    `SELECT external_id, payload_hash FROM finance.raw_record
      WHERE source = $1 AND entity = $2 AND external_id = ANY($3::text[])
      FOR UPDATE`,
    [source, entity, ids],
  );
  const parts = partitionByHash(batch, new Map(rows.map((r) => [r.external_id, r.payload_hash])));
  const statusById = new Map<string, RawStatus>();
  for (const [status, list] of Object.entries(parts) as Array<[RawStatus, RawInput[]]>) {
    for (const r of list) statusById.set(r.externalId, status);
  }
  const counts = { new: parts.new.length, changed: parts.changed.length, unchanged: parts.unchanged.length };
  if (dryRun) return { ...counts, statusById };

  if (parts.changed.length) {
    // Keep the old version before it's overwritten (audit trail).
    await client.query(
      `INSERT INTO finance.raw_record_version (raw_record_id, payload, payload_hash)
       SELECT id, payload, payload_hash FROM finance.raw_record
        WHERE source = $1 AND entity = $2 AND external_id = ANY($3::text[])`,
      [source, entity, parts.changed.map((r) => r.externalId)],
    );
  }

  const toWrite = [...parts.new, ...parts.changed];
  if (toWrite.length) {
    // The whole batch goes in as ONE json parameter, unpacked server-side by
    // jsonb_to_recordset — a single round trip, and still fully parameterized.
    const rowsJson = JSON.stringify(
      toWrite.map((r) => ({
        external_id: r.externalId,
        parent_external_id: r.parentExternalId ?? null,
        payload: r.payload,
        payload_hash: r.payloadHash,
        source_created_at: r.sourceCreatedAt?.toISOString() ?? null,
        source_updated_at: r.sourceUpdatedAt?.toISOString() ?? null,
        window_date: r.windowDate ?? null,
      })),
    );
    await client.query(
      `INSERT INTO finance.raw_record
         (source, entity, external_id, parent_external_id, payload, payload_hash,
          source_created_at, source_updated_at, window_date, last_sync_run_id)
       SELECT $1, $2, r.external_id, r.parent_external_id, r.payload, r.payload_hash,
              r.source_created_at, r.source_updated_at, r.window_date, $3
         FROM jsonb_to_recordset($4::jsonb) AS r(
              external_id text, parent_external_id text, payload jsonb, payload_hash text,
              source_created_at timestamptz, source_updated_at timestamptz, window_date date)
       ON CONFLICT (source, entity, external_id) DO UPDATE SET
         parent_external_id = EXCLUDED.parent_external_id,
         payload            = EXCLUDED.payload,
         payload_hash       = EXCLUDED.payload_hash,
         source_created_at  = EXCLUDED.source_created_at,
         source_updated_at  = EXCLUDED.source_updated_at,
         window_date        = EXCLUDED.window_date,
         last_seen_at       = now(),
         last_sync_run_id   = EXCLUDED.last_sync_run_id,
         missing_since      = NULL`,
      [source, entity, runId, rowsJson],
    );
  }

  if (parts.unchanged.length) {
    await client.query(
      `UPDATE finance.raw_record
          SET last_seen_at = now(), last_sync_run_id = $3, missing_since = NULL
        WHERE source = $1 AND entity = $2 AND external_id = ANY($4::text[])`,
      [source, entity, runId, parts.unchanged.map((r) => r.externalId)],
    );
  }
  return { ...counts, statusById };
}

/** Upsert any number of records for one source + entity, in batches. Call inside withTransaction. */
export async function upsertRaw(
  client: pg.PoolClient,
  args: { source: Source; entity: string; runId: number; records: RawInput[]; dryRun?: boolean },
): Promise<UpsertResult> {
  const total: UpsertResult = { new: 0, changed: 0, unchanged: 0, statusById: new Map() };
  for (let i = 0; i < args.records.length; i += BATCH_SIZE) {
    const r = await upsertBatch(client, args.source, args.entity, args.runId, args.records.slice(i, i + BATCH_SIZE), !!args.dryRun);
    total.new += r.new;
    total.changed += r.changed;
    total.unchanged += r.unchanged;
    for (const [id, s] of r.statusById) total.statusById.set(id, s);
  }
  return total;
}

/**
 * After a scope has been fully re-pulled, flag rows in that scope that this run
 * didn't see. Nothing is deleted. Scope = the whole entity, a window_date range,
 * a set of parents (e.g. the appointments whose payments we re-fetched), or a set
 * of ids we asked for by id and the API didn't return (e.g. Square orders).
 * Returns the number of rows newly flagged.
 */
export async function markMissing(
  client: pg.PoolClient,
  args: {
    source: Source;
    entity: string;
    runId: number;
    window?: { from: string; to: string };
    parentIds?: string[];
    ids?: string[];
  },
): Promise<number> {
  const where = ["source = $1", "entity = $2", "last_sync_run_id <> $3", "missing_since IS NULL"];
  const params: unknown[] = [args.source, args.entity, args.runId];
  if (args.window) {
    params.push(args.window.from, args.window.to);
    where.push(`window_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
  }
  if (args.parentIds) {
    if (args.parentIds.length === 0) return 0;
    params.push(args.parentIds);
    where.push(`parent_external_id = ANY($${params.length}::text[])`);
  }
  if (args.ids) {
    if (args.ids.length === 0) return 0;
    params.push(args.ids);
    where.push(`external_id = ANY($${params.length}::text[])`);
  }
  const res = await client.query(`UPDATE finance.raw_record SET missing_since = now() WHERE ${where.join(" AND ")}`, params);
  return res.rowCount ?? 0;
}

/** Which of the given external ids are already stored for this source + entity. */
export async function storedIds(
  client: pg.PoolClient | pg.Pool,
  args: { source: Source; entity: string; ids: string[] },
): Promise<Set<string>> {
  if (args.ids.length === 0) return new Set();
  const { rows } = await client.query<{ external_id: string }>(
    `SELECT external_id FROM finance.raw_record
      WHERE source = $1 AND entity = $2 AND external_id = ANY($3::text[])`,
    [args.source, args.entity, args.ids],
  );
  return new Set(rows.map((r) => r.external_id));
}

/** Parent ids (within the given set) that already have at least one child row of `entity`. */
export async function parentsWithChildren(
  client: pg.PoolClient | pg.Pool,
  args: { source: Source; entity: string; parentIds: string[] },
): Promise<Set<string>> {
  if (args.parentIds.length === 0) return new Set();
  const { rows } = await client.query<{ parent_external_id: string }>(
    `SELECT DISTINCT parent_external_id FROM finance.raw_record
      WHERE source = $1 AND entity = $2 AND parent_external_id = ANY($3::text[])`,
    [args.source, args.entity, args.parentIds],
  );
  return new Set(rows.map((r) => r.parent_external_id));
}

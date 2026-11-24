// Shared shapes for the pure transform mappers.

/** The bits of a raw_record row a mapper may use. */
export interface RawRow {
  id: string; // raw_record.id (bigint → string, per PRD §12)
  external_id: string;
  parent_external_id: string | null;
  payload: unknown;
  missing_since: Date | null;
}

/** A mapper either produces staging row(s) or explains why it couldn't. */
export type MapResult<T> = { ok: true; row: T } | { ok: false; error: string };

export const ok = <T>(row: T): MapResult<T> => ({ ok: true, row });
export const fail = <T>(error: string): MapResult<T> => ({ ok: false, error });

/** Normalised email: the main fuzzy-match key (PRD §7.3). */
export const normEmail = (e: unknown): string | null =>
  typeof e === "string" && e.trim() !== "" ? e.trim().toLowerCase() : null;

/** Run `fn`, turning any thrown error (zod, money parsing, bad timestamp) into a fail result. */
export function attempt<T>(fn: () => T): MapResult<T> {
  try {
    return ok(fn());
  } catch (err) {
    const e = err as { issues?: Array<{ path: PropertyKey[]; message: string }>; message?: string };
    if (e.issues) return fail(e.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; "));
    return fail(e.message ?? String(err));
  }
}

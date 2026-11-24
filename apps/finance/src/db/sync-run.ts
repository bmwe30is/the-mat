// Bookkeeping for finance.sync_run: every command records when it ran, over
// which window, how many API calls it made and whether it succeeded.
import { getPool } from "./pool.js";

export interface StartRunInput {
  job: string;
  source?: "acuity" | "square";
  windowStart?: string;
  windowEnd?: string;
}

export interface FinishRunInput {
  status: "succeeded" | "failed";
  apiCalls?: number;
  rowsNew?: number;
  rowsChanged?: number;
  rowsUnchanged?: number;
  error?: string;
}

export async function startRun(input: StartRunInput): Promise<number> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO finance.sync_run (job, source, window_start, window_end)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.job, input.source ?? null, input.windowStart ?? null, input.windowEnd ?? null],
  );
  return Number(rows[0].id); // bigserial ids stay far below 2^53
}

export async function finishRun(id: number, r: FinishRunInput): Promise<void> {
  await getPool().query(
    `UPDATE finance.sync_run
        SET status = $2, finished_at = now(), api_calls = $3,
            rows_new = $4, rows_changed = $5, rows_unchanged = $6, error = $7
      WHERE id = $1`,
    [id, r.status, r.apiCalls ?? 0, r.rowsNew ?? 0, r.rowsChanged ?? 0, r.rowsUnchanged ?? 0, r.error ?? null],
  );
}

/** Wrap a command body so its sync_run row is always closed, even on failure. */
export async function withRun<T>(
  input: StartRunInput,
  body: (runId: number) => Promise<{ result: T } & Omit<FinishRunInput, "status">>,
): Promise<T> {
  const id = await startRun(input);
  try {
    const { result, ...counts } = await body(id);
    await finishRun(id, { status: "succeeded", ...counts });
    return result;
  } catch (err) {
    await finishRun(id, { status: "failed", error: (err as Error).message.slice(0, 2000) }).catch(() => {});
    throw err;
  }
}

// Structured logging with pino.
//
// Human-readable output when running in a terminal, JSON otherwise (e.g. a
// future scheduled job piping into a log collector). Log IDs, never emails or
// phone numbers (PRD §12 Privacy).
import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(process.stdout.isTTY
    ? { transport: { target: "pino-pretty", options: { ignore: "pid,hostname", translateTime: "HH:MM:ss" } } }
    : {}),
});

/** A child logger tagged with the sync_run id, so every line can be traced to its run. */
export const runLogger = (runId: number | string) => logger.child({ run_id: String(runId) });

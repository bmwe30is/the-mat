// Timezone helpers — the ONLY place studio-local dates are derived (PRD §8).
//
// Vocabulary used throughout the app:
//   instant    — a real point in time (JS Date / Postgres timestamptz, stored UTC)
//   local date — a calendar date in the reporting timezone, as 'YYYY-MM-DD'
//
// Library: date-fns-tz. It does exactly the two conversions we need
// (instant → local date, local midnight → instant) using the platform's IANA
// tz database, so DST is handled for us and there's no polyfill to ship.
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertLocalDate(d: string) {
  if (!LOCAL_DATE_RE.test(d)) throw new Error(`Expected YYYY-MM-DD, got "${d}"`);
}

/**
 * Parse a source timestamp that carries its own offset or `Z` into an instant.
 * Acuity sends offsets without a colon ("2020-03-02T09:00:00-0800"), which isn't
 * strict ISO 8601, so we normalise it before parsing. Never drops the offset.
 */
export function parseSourceInstant(s: string): Date {
  const normalised = s.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(normalised)) {
    throw new Error(`Timestamp has no offset, refusing to guess its timezone: "${s}"`);
  }
  const d = new Date(normalised);
  if (Number.isNaN(d.getTime())) throw new Error(`Unparseable timestamp "${s}"`);
  return d;
}

/**
 * Parse a wall-clock timestamp WITHOUT an offset (e.g. Acuity orders'
 * "2026-09-29 22:22:34") as local time in `tz`. Only for sources documented to
 * use a known zone — Acuity order times are in the account timezone (LA).
 * Timestamps that do carry an offset are parsed with it instead.
 */
export function parseLocalDateTime(s: string, tz: string): Date {
  const t = s.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(t)) return parseSourceInstant(t);
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(t)) throw new Error(`Unparseable local timestamp "${s}"`);
  return fromZonedTime(t.replace(" ", "T"), tz);
}

/** The offset string a source timestamp was written with, e.g. "-0800" or "Z". */
export function sourceOffset(s: string): string | undefined {
  return /(Z|[+-]\d{2}:?\d{2})$/.exec(s.trim())?.[1];
}

/** The local calendar date of an instant in `tz`. */
export function localDateOf(instant: Date, tz: string): string {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}

/** The instant local midnight starts on `localDate` in `tz` (DST-aware). */
export function localDayStartUtc(localDate: string, tz: string): Date {
  assertLocalDate(localDate);
  return fromZonedTime(`${localDate}T00:00:00`, tz);
}

/**
 * Calendar arithmetic on local dates. Works on the date itself (via UTC, which
 * has no DST), never by adding 24h to an instant (PRD §8 rule 6).
 */
export function addLocalDays(localDate: string, days: number): string {
  assertLocalDate(localDate);
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Turn an inclusive local-date range into a half-open UTC instant window
 * [begin, end), optionally padded by `padDays` on each side (PRD §8 rule 4).
 */
export function localRangeToUtc(from: string, to: string, tz: string, padDays = 0): { begin: Date; end: Date } {
  return {
    begin: localDayStartUtc(addLocalDays(from, -padDays), tz),
    end: localDayStartUtc(addLocalDays(to, 1 + padDays), tz),
  };
}

/** First and last local date of a 'YYYY-MM' month. */
export function monthBounds(month: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Expected YYYY-MM, got "${month}"`);
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of next month
  return { from, to };
}

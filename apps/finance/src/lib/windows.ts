// Splitting an extraction range into monthly chunks — shared by every
// windowed extract (Acuity appointments, Square payments/refunds).
// Pure: local dates in, local dates out. Converting to instants is time.ts's job.
import { addLocalDays, monthBounds } from "./time.js";

export interface MonthChunk {
  month: string; // YYYY-MM
  from: string; // first local date in range (inclusive)
  to: string; // last local date in range (inclusive)
}

/** Split an inclusive local-date range into calendar-month chunks, clamped to the range. */
export function monthChunks(from: string, to: string): MonthChunk[] {
  if (from > to) throw new Error(`Empty range ${from}…${to}`);
  const chunks: MonthChunk[] = [];
  let month = from.slice(0, 7);
  while (month <= to.slice(0, 7)) {
    const b = monthBounds(month);
    chunks.push({ month, from: b.from < from ? from : b.from, to: b.to > to ? to : b.to });
    month = addLocalDays(b.to, 1).slice(0, 7);
  }
  return chunks;
}

/** The chunk padded by a day on each side (PRD §8 rule 4), as local dates. */
export const paddedDates = (c: MonthChunk) => ({ from: addLocalDays(c.from, -1), to: addLocalDays(c.to, 1) });

// Pure helpers for the Acuity extract: how API objects become raw_record rows.
// No I/O, so it's unit-tested. Month chunking lives in lib/windows.ts.
import { payloadHash } from "../../lib/hash.js";
import { localDateOf, parseLocalDateTime, parseSourceInstant } from "../../lib/time.js";
import type { RawInput } from "../../raw/repo.js";
import type { AcuityAppointment, AcuityOrder, AcuityPayment } from "./types.js";

/**
 * Fields that change by themselves as time passes, without the booking really
 * changing (they flip once the cancel/reschedule cutoff passes). Left out of the
 * change-detection hash so re-runs don't create pointless versions.
 */
export const APPOINTMENT_VOLATILE_KEYS = ["canClientCancel", "canClientReschedule"] as const;

export function appointmentToRaw(a: AcuityAppointment, tz: string): RawInput {
  return {
    externalId: String(a.id),
    payload: a,
    payloadHash: payloadHash(a, APPOINTMENT_VOLATILE_KEYS),
    sourceCreatedAt: a.datetimeCreated ? parseSourceInstant(a.datetimeCreated) : null,
    // The class date is the window key: it's what minDate/maxDate filter on.
    windowDate: localDateOf(parseSourceInstant(a.datetime), tz),
  };
}

/**
 * Acuity payments have no id of their own, so build a stable key from what
 * identifies one: appointment, creation time, processor and amount. If an
 * appointment ever has two identical payments, later ones get "#2", "#3".
 */
export function paymentsToRaw(appointmentId: number | string, payments: AcuityPayment[]): RawInput[] {
  const seen = new Map<string, number>();
  return payments.map((p) => {
    const base = [appointmentId, p.created ?? "", p.processor ?? "", p.amount ?? ""].join(":");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      externalId: n === 1 ? base : `${base}#${n}`,
      parentExternalId: String(appointmentId),
      payload: p,
      payloadHash: payloadHash(p),
      sourceCreatedAt: p.created ? parseSourceInstant(p.created) : null,
    };
  });
}

/** Order `time` has no offset; it's in the account timezone (LA, probe Q3). */
export function orderToRaw(o: AcuityOrder, tz: string): RawInput {
  return {
    externalId: String(o.id),
    payload: o,
    payloadHash: payloadHash(o),
    sourceCreatedAt: o.time ? parseLocalDateTime(o.time, tz) : null,
  };
}

/** Lookups (calendars, appointment types, products, certificates): id + payload only. */
export function lookupToRaw(obj: { id: number | string }): RawInput {
  return { externalId: String(obj.id), payload: obj, payloadHash: payloadHash(obj) };
}

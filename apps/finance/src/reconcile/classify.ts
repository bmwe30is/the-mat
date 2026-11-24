// Give every Acuity record and every Square payment in the window a status and
// reason code (PRD §9 "Classifying"). Pure.
//
// Guiding rule: if Acuity says money went through Square and nothing matched,
// it is ALWAYS an exception (PAID_NO_SQUARE), even when the booking is also
// canceled or used a code. "No payment expected" reasons (CANCELED, MEMBERSHIP,
// …) only apply when no Square money is expected, so a real gap can never hide
// behind one of them.
import { squareExpectedCents } from "./rules.js";
import type { AcuityAppt, AcuityPay, Link, ReconConfig, ReconInput, SquarePay, StatusRow } from "./types.js";

/** Reason codes that go on the exceptions list (PRD §9: bold codes). */
export const EXCEPTION_CODES = new Set([
  "PAID_NO_SQUARE",
  "UNKNOWN",
  "NO_ACUITY_REF",
  "ORDER_NO_SQUARE",
  "ACUITY_ORDER",
  // Square charged less than the Acuity order total. Probably a checkout coupon
  // (Acuity's order API exposes no discount), but unproven — so owner reviews it.
  "ORDER_CHARGED_LESS",
]);

const inWindow = (d: string | null, w: ReconConfig["window"]) => !!d && d >= w.from && d <= w.to;

/**
 * Why a matched pair's amounts differ (delta = Square − Acuity expected).
 * Checked in order; the first explanation that fits wins.
 */
export function mismatchReason(
  deltaCents: number,
  ctx: { discountCents: number; tipCents: number; codeExtraPaidCents: number; refundedCents: number; orderDiscountCents: number; priceCents: number; amountPaidCents: number },
): string {
  const d = Math.abs(deltaCents);
  if (ctx.discountCents > 0 && d === ctx.discountCents) return "ACUITY_DISCOUNT";
  if ((ctx.tipCents > 0 && d === ctx.tipCents) || (ctx.codeExtraPaidCents > 0 && d === ctx.codeExtraPaidCents)) return "TIP";
  if (ctx.refundedCents > 0 && d === ctx.refundedCents) return "PARTIAL_REFUND";
  if (ctx.orderDiscountCents > 0 && d === ctx.orderDiscountCents) return "SQUARE_DISCOUNT";
  if (ctx.priceCents !== ctx.amountPaidCents) return "PRICE_OVERRIDE";
  return "UNKNOWN";
}

/** Reason an unmatched appointment needs no Square payment (or UNKNOWN). */
export function unmatchedAppointmentReason(
  a: AcuityAppt,
  pays: AcuityPay[],
  cfg: Pick<ReconConfig, "membershipTypePatterns">,
): { reason: string; status: StatusRow["status"] } {
  if (squareExpectedCents(a, pays) > 0) return { reason: "PAID_NO_SQUARE", status: "acuity_only" };
  if (a.isCanceled) return { reason: "CANCELED", status: "not_applicable" };
  if (a.amountPaidCents > 0 && pays.length > 0 && pays.every((p) => p.processor === "cash")) {
    return { reason: "CASH", status: "not_applicable" };
  }
  const kind = a.certificateKind;
  if (kind && ["package", "gift", "certificate_deleted"].includes(kind) && a.amountPaidCents === 0) {
    return { reason: "PACKAGE_REDEMPTION", status: "not_applicable" };
  }
  const typeIsMembership = cfg.membershipTypePatterns.some((p) => (a.typeName ?? "").toLowerCase().includes(p.toLowerCase()));
  if (kind === "membership" || typeIsMembership) return { reason: "MEMBERSHIP", status: "not_applicable" };
  if (kind === "coupon" && a.amountPaidCents === 0) return { reason: "COUPON_FULL", status: "not_applicable" };
  if (a.priceCents === 0) return { reason: "FREE_TYPE", status: "not_applicable" };
  if (a.priceCents > 0 && !a.paid) return { reason: "UNPAID", status: "acuity_only" };
  return { reason: "UNKNOWN", status: "acuity_only" };
}

/** Reason a Square payment has no Acuity match. */
export function unmatchedSquareReason(
  s: SquarePay,
  window?: ReconConfig["window"],
): { reason: string; status: StatusRow["status"] } {
  if (s.status !== "COMPLETED") return { reason: "NOT_COMPLETED", status: "not_applicable" };
  // Paid in the window for a class outside it (e.g. Dec 28 for Jan 3): the
  // appointment simply wasn't extracted. Explained, not an exception.
  if (window && s.noteClassDate && !inWindow(s.noteClassDate, window)) return { reason: "CLASS_OUTSIDE_WINDOW", status: "square_only" };
  if (s.refKind === "order") return { reason: "ACUITY_ORDER", status: "square_only" }; // note names an order we don't have
  if (s.refKind === "subscription") return { reason: "MEMBERSHIP_CHARGE", status: "square_only" };
  if (s.squareProduct === "INVOICES") return { reason: "INVOICE", status: "square_only" };
  if (s.squareProduct && s.squareProduct !== "ECOMMERCE_API") return { reason: "POS_RETAIL", status: "square_only" };
  return { reason: "NO_ACUITY_REF", status: "square_only" };
}

export function classify(input: ReconInput, links: Link[], cfg: ReconConfig): StatusRow[] {
  const rows: StatusRow[] = [];
  const squareById = new Map(input.square.map((s) => [s.id, s]));
  const linksByAcuity = new Map<string, Link[]>();
  const linksBySquare = new Map<string, Link[]>();
  for (const l of links) {
    const k = `${l.acuityKind}:${l.acuityId}`;
    linksByAcuity.set(k, [...(linksByAcuity.get(k) ?? []), l]);
    linksBySquare.set(l.squarePaymentId, [...(linksBySquare.get(l.squarePaymentId) ?? []), l]);
  }
  const paysByAppt = new Map<string, AcuityPay[]>();
  for (const p of input.payments) paysByAppt.set(p.appointmentId, [...(paysByAppt.get(p.appointmentId) ?? []), p]);
  const noPaymentOverride = new Map(
    input.overrides.filter((o) => !o.squarePaymentId).map((o) => [`${o.acuityKind}:${o.acuityId}`, o]),
  );
  const row = (r: Omit<StatusRow, "exception">): StatusRow => ({ ...r, exception: EXCEPTION_CODES.has(r.reasonCode ?? "") });
  const sumAllocated = (ls: Link[]) => ls.reduce((s, l) => s + l.allocatedCents, 0);
  const refundedOf = (ls: Link[]) => ls.reduce((s, l) => s + (squareById.get(l.squarePaymentId)?.refundedCents ?? 0), 0);

  // ---- Acuity appointments ----
  for (const a of [...input.appointments].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (!inWindow(a.localDate, cfg.window)) continue;
    const k = `appointment:${a.id}`;
    const pays = paysByAppt.get(a.id) ?? [];
    const ls = linksByAcuity.get(k) ?? [];
    const override = noPaymentOverride.get(k);
    if (override) {
      rows.push(row({ side: "acuity", kind: "appointment", id: a.id, localDate: a.localDate, status: "not_applicable", reasonCode: override.reasonCode, expectedCents: 0, actualCents: 0, deltaCents: 0 }));
      continue;
    }
    if (ls.length) {
      const expected = squareExpectedCents(a, pays);
      const actual = sumAllocated(ls);
      const delta = actual - expected;
      const reason =
        delta === 0
          ? null
          : mismatchReason(delta, {
              discountCents: a.discountCents,
              tipCents: a.tipCents,
              codeExtraPaidCents: a.codeExtraPaidCents,
              refundedCents: refundedOf(ls),
              orderDiscountCents: ls.reduce((s, l) => s + (squareById.get(l.squarePaymentId)?.orderDiscountCents ?? 0), 0),
              priceCents: a.priceCents,
              amountPaidCents: a.amountPaidCents,
            });
      rows.push(row({ side: "acuity", kind: "appointment", id: a.id, localDate: a.localDate, status: delta === 0 ? "matched" : "amount_mismatch", reasonCode: reason, expectedCents: expected, actualCents: actual, deltaCents: delta }));
      continue;
    }
    const u = unmatchedAppointmentReason(a, pays, cfg);
    const expected = squareExpectedCents(a, pays);
    rows.push(row({ side: "acuity", kind: "appointment", id: a.id, localDate: a.localDate, status: u.status, reasonCode: u.reason, expectedCents: expected, actualCents: 0, deltaCents: -expected }));
  }

  // ---- Acuity orders ----
  for (const o of [...input.orders].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (!inWindow(o.localDate, cfg.window)) continue;
    const k = `order:${o.id}`;
    const ls = linksByAcuity.get(k) ?? [];
    const override = noPaymentOverride.get(k);
    if (override) {
      rows.push(row({ side: "acuity", kind: "order", id: o.id, localDate: o.localDate, status: "not_applicable", reasonCode: override.reasonCode, expectedCents: 0, actualCents: 0, deltaCents: 0 }));
    } else if (ls.length) {
      const actual = sumAllocated(ls);
      const delta = actual - o.totalCents;
      const reason =
        delta === 0 ? null : refundedOf(ls) === Math.abs(delta) ? "PARTIAL_REFUND" : delta < 0 ? "ORDER_CHARGED_LESS" : "UNKNOWN";
      rows.push(row({ side: "acuity", kind: "order", id: o.id, localDate: o.localDate, status: delta === 0 ? "matched" : "amount_mismatch", reasonCode: reason, expectedCents: o.totalCents, actualCents: actual, deltaCents: delta }));
    } else if (o.status === "unpaid") {
      rows.push(row({ side: "acuity", kind: "order", id: o.id, localDate: o.localDate, status: "not_applicable", reasonCode: "ORDER_UNPAID", expectedCents: 0, actualCents: 0, deltaCents: 0 }));
    } else if (o.totalCents <= 0) {
      rows.push(row({ side: "acuity", kind: "order", id: o.id, localDate: o.localDate, status: "not_applicable", reasonCode: "FREE_TYPE", expectedCents: 0, actualCents: 0, deltaCents: 0 }));
    } else {
      rows.push(row({ side: "acuity", kind: "order", id: o.id, localDate: o.localDate, status: "acuity_only", reasonCode: "ORDER_NO_SQUARE", expectedCents: o.totalCents, actualCents: 0, deltaCents: -o.totalCents }));
    }
  }

  // ---- Square payments ----
  for (const s of [...input.square].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (!inWindow(s.localDate, cfg.window)) continue;
    const ls = linksBySquare.get(s.id) ?? [];
    if (ls.length) {
      // The links' allocations should add up to the payment (1→N support, PRD §7.4).
      const actual = sumAllocated(ls);
      const delta = actual - s.amountCents;
      const kinds = [...new Set(ls.map((l) => l.acuityKind))].sort().join("+");
      rows.push(row({ side: "square", kind: "payment", id: s.id, localDate: s.localDate, status: delta === 0 ? "matched" : "amount_mismatch", reasonCode: delta === 0 ? `LINKED_${kinds.toUpperCase()}` : s.refundedCents === Math.abs(delta) ? "PARTIAL_REFUND" : "ALLOCATION_DIFFERS", expectedCents: s.amountCents, actualCents: actual, deltaCents: delta }));
      continue;
    }
    const u = unmatchedSquareReason(s, cfg.window);
    const expected = u.status === "not_applicable" ? 0 : s.amountCents;
    rows.push(row({ side: "square", kind: "payment", id: s.id, localDate: s.localDate, status: u.status, reasonCode: u.reason, expectedCents: expected, actualCents: 0, deltaCents: -expected }));
  }

  return rows;
}

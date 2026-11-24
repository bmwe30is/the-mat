// Matching rules (PRD §9), as pure functions over in-memory staging rows.
//
// Rules run in order; the first rule that claims a pair wins, and a claimed
// record isn't offered to later rules. Everything is sorted by id first, so the
// same input always produces the same links (PRD §9 "Deterministic").
//
//   0   manual override (human-owned table)
//   1a  Acuity payment transactionID = Square payment id OR order id   (high)
//   1b  Square note → Acuity appointment / order / certificate code     (high)
//   2   same email + same amount + created within MATCH_WINDOW_MINUTES  (medium)
//   3   same email + same payment date, exactly one candidate each side (low; amount may differ)
//   4   same amount + same payment date, exactly one candidate each side (low)
//
// Only COMPLETED Square payments take part in matching: a failed or canceled
// card attempt moved no money (classify.ts gives those NOT_COMPLETED).
import type { AcuityAppt, AcuityOrder, AcuityPay, Link, ReconConfig, ReconInput, SquarePay } from "./types.js";

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * What an appointment should have charged through Square: the sum of its
 * non-cash Acuity payments (refunds/adjustments included), or amountPaid if
 * Acuity returned no payment records for it.
 */
export function squareExpectedCents(appt: AcuityAppt, pays: AcuityPay[]): number {
  if (pays.length === 0) return appt.amountPaidCents;
  return pays.filter((p) => p.processor !== "cash").reduce((s, p) => s + p.amountCents, 0);
}

/** One "thing that should have a Square payment" on the Acuity side, for rules 2–4. */
interface Payable {
  kind: "appointment" | "order";
  id: string;
  email: string | null;
  cents: number;
  at: string | null; // instant the money moved (Acuity payment time / order time)
  date: string | null; // LA date of `at`
}

export function matchAll(input: ReconInput, cfg: Pick<ReconConfig, "matchWindowMinutes">): Link[] {
  const links: Link[] = [];
  const claimedSquare = new Set<string>();
  const claimedAcuity = new Set<string>(); // "appointment:123", "order:456"
  const key = (kind: string, id: string) => `${kind}:${id}`;

  const square = [...input.square].filter((s) => s.status === "COMPLETED").sort(byId);
  const squareById = new Map(square.map((s) => [s.id, s]));
  const squareByOrder = new Map<string, SquarePay>();
  for (const s of square) if (s.orderId && !squareByOrder.has(s.orderId)) squareByOrder.set(s.orderId, s);
  const appts = new Map(input.appointments.map((a) => [a.id, a]));
  const orders = new Map(input.orders.map((o) => [o.id, o]));
  const paysByAppt = new Map<string, AcuityPay[]>();
  for (const p of [...input.payments].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const list = paysByAppt.get(p.appointmentId) ?? [];
    list.push(p);
    paysByAppt.set(p.appointmentId, list);
  }

  // ---- Rule 0: manual overrides ----
  for (const o of [...input.overrides].sort(byId)) {
    claimedAcuity.add(key(o.acuityKind, o.acuityId)); // "no payment expected" also claims the record
    if (!o.squarePaymentId) continue;
    const s = input.square.find((x) => x.id === o.squarePaymentId);
    if (!s) continue; // override names a payment we don't have; classify.ts reports it
    links.push({
      acuityKind: o.acuityKind,
      acuityId: o.acuityId,
      squarePaymentId: s.id,
      rule: "0",
      confidence: "manual",
      allocatedCents: s.amountCents,
      evidence: { override_id: o.id, reason_code: o.reasonCode },
    });
    claimedSquare.add(s.id);
  }

  // ---- Rule 1a: Acuity transactionID → Square payment id or order id ----
  // Several Acuity payments may point at one Square payment (declared 1→N),
  // so Square payments are claimed only after all 1a links are made.
  const alloc = new Map<string, { appt: string; square: string; cents: number; via: string; keys: string[] }>();
  for (const [apptId, pays] of [...paysByAppt.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (claimedAcuity.has(key("appointment", apptId)) || !appts.has(apptId)) continue;
    for (const p of pays) {
      if (!p.txnId) continue;
      const viaPayment = squareById.get(p.txnId);
      const s = viaPayment ?? squareByOrder.get(p.txnId);
      if (!s || claimedSquare.has(s.id)) continue;
      const k = `${apptId}|${s.id}`;
      const a = alloc.get(k) ?? { appt: apptId, square: s.id, cents: 0, via: viaPayment ? "payment_id" : "order_id", keys: [] };
      a.cents += p.amountCents;
      a.keys.push(p.key);
      alloc.set(k, a);
    }
  }
  // Allocation: a Square payment linked to ONE appointment gives it its whole
  // amount, so any difference from what Acuity recorded shows up on the Acuity
  // side as an amount_mismatch. Only when one Square payment covers several
  // appointments (1→N) is it split, using each appointment's Acuity amounts.
  const linksPerSquare = new Map<string, number>();
  for (const a of alloc.values()) linksPerSquare.set(a.square, (linksPerSquare.get(a.square) ?? 0) + 1);
  for (const a of [...alloc.values()].sort((x, y) => (x.appt + x.square < y.appt + y.square ? -1 : 1))) {
    const split = (linksPerSquare.get(a.square) ?? 1) > 1;
    links.push({
      acuityKind: "appointment",
      acuityId: a.appt,
      squarePaymentId: a.square,
      rule: "1a",
      confidence: "high",
      allocatedCents: split ? a.cents : squareById.get(a.square)!.amountCents,
      evidence: { acuity_transaction_id_matches: a.via, acuity_payment_keys: a.keys, ...(split ? { split_by_acuity_amounts: true } : {}) },
    });
  }
  for (const a of alloc.values()) {
    claimedAcuity.add(key("appointment", a.appt));
    claimedSquare.add(a.square);
  }

  // ---- Rule 1b: the Square note names an Acuity record ----
  for (const s of square) {
    if (claimedSquare.has(s.id) || !s.ref) continue;
    let kind: Link["acuityKind"] | null = null;
    let id: string | null = null;
    if (s.refKind === "appointment" && appts.has(s.ref) && !claimedAcuity.has(key("appointment", s.ref))) {
      kind = "appointment";
      id = s.ref;
    } else if (s.refKind === "order" && orders.has(s.ref) && !claimedAcuity.has(key("order", s.ref))) {
      kind = "order";
      id = s.ref;
    } else if (s.refKind === "subscription" && s.certificateCode && input.certificateCodes.has(s.certificateCode)) {
      // A membership is charged every month against the same certificate, so
      // certificates are never "claimed" — each charge links to it.
      kind = "certificate";
      id = s.certificateCode;
    }
    if (!kind || !id) continue;
    links.push({
      acuityKind: kind,
      acuityId: id,
      squarePaymentId: s.id,
      rule: "1b",
      confidence: "high",
      allocatedCents: s.amountCents,
      evidence: { square_note_ref: s.refKind },
    });
    claimedSquare.add(s.id);
    if (kind !== "certificate") claimedAcuity.add(key(kind, id));
  }

  // ---- Rules 2–4 work on what's left ----
  const payables = (): Payable[] => {
    const out: Payable[] = [];
    for (const a of [...appts.values()].sort(byId)) {
      if (claimedAcuity.has(key("appointment", a.id))) continue;
      const pays = paysByAppt.get(a.id) ?? [];
      const cents = squareExpectedCents(a, pays);
      if (cents <= 0) continue;
      const first = pays.filter((p) => p.processor !== "cash" && p.paidAt).sort((x, y) => (x.paidAt! < y.paidAt! ? -1 : 1))[0];
      out.push({ kind: "appointment", id: a.id, email: a.email, cents, at: first?.paidAt ?? null, date: first?.payDate ?? null });
    }
    for (const o of [...orders.values()].sort(byId)) {
      // Unpaid orders are abandoned checkouts: no money to look for.
      if (claimedAcuity.has(key("order", o.id)) || o.totalCents <= 0 || o.status === "unpaid") continue;
      out.push({ kind: "order", id: o.id, email: o.email, cents: o.totalCents, at: o.orderedAt, date: o.localDate });
    }
    return out;
  };
  const openSquare = () => square.filter((s) => !claimedSquare.has(s.id));
  const claim = (p: Payable, s: SquarePay, rule: Link["rule"], confidence: Link["confidence"], evidence: Record<string, unknown>) => {
    links.push({ acuityKind: p.kind, acuityId: p.id, squarePaymentId: s.id, rule, confidence, allocatedCents: s.amountCents, evidence });
    claimedAcuity.add(key(p.kind, p.id));
    claimedSquare.add(s.id);
  };

  // Rule 2: email + exact amount + close in time. Closest in time wins; ties → lowest id.
  const windowMs = cfg.matchWindowMinutes * 60_000;
  for (const p of payables()) {
    if (!p.email || !p.at) continue;
    const t = Date.parse(p.at);
    const best = openSquare()
      .filter((s) => s.email === p.email && s.amountCents === p.cents && Math.abs(Date.parse(s.createdAt) - t) <= windowMs)
      .sort((x, y) => Math.abs(Date.parse(x.createdAt) - t) - Math.abs(Date.parse(y.createdAt) - t) || byId(x, y))[0];
    if (best) {
      claim(p, best, "2", "medium", {
        email: true,
        amount_cents: p.cents,
        minutes_apart: Math.round(Math.abs(Date.parse(best.createdAt) - t) / 60_000),
      });
    }
  }

  // Rules 3 and 4: exactly one candidate on each side of a (key, date) group.
  const uniquePairs = (keyOf: (x: { email: string | null; cents: number; date: string | null }) => string | null) => {
    const left = new Map<string, Payable[]>();
    for (const p of payables()) {
      const k = keyOf(p);
      if (k) left.set(k, [...(left.get(k) ?? []), p]);
    }
    const right = new Map<string, SquarePay[]>();
    for (const s of openSquare()) {
      const k = keyOf({ email: s.email, cents: s.amountCents, date: s.localDate });
      if (k) right.set(k, [...(right.get(k) ?? []), s]);
    }
    return [...left.entries()]
      .filter(([k, ps]) => ps.length === 1 && right.get(k)?.length === 1)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, ps]) => ({ k, p: ps[0], s: right.get(k)![0] }));
  };

  for (const { p, s } of uniquePairs((x) => (x.email && x.date ? `${x.email}|${x.date}` : null))) {
    claim(p, s, "3", "low", { email: true, same_date: p.date, acuity_cents: p.cents, square_cents: s.amountCents });
  }
  for (const { p, s } of uniquePairs((x) => (x.date ? `${x.cents}|${x.date}` : null))) {
    claim(p, s, "4", "low", { email: false, same_date: p.date, amount_cents: p.cents });
  }

  return links;
}

// Re-exported for classify.ts and tests.
export type { AcuityOrder };

// Inputs and outputs of the pure reconciliation core (PRD §9).
// run.ts loads these from staging; rules.ts + classify.ts never touch the DB.

export interface AcuityAppt {
  id: string;
  localDate: string; // class date (LA)
  email: string | null;
  typeName: string | null;
  listPriceCents: number;
  priceCents: number;
  discountCents: number;
  amountPaidCents: number;
  tipCents: number;
  codeExtraPaidCents: number;
  paid: boolean;
  certificateKind: string | null;
  isCanceled: boolean;
}

export interface AcuityPay {
  key: string;
  appointmentId: string;
  processor: string | null;
  txnId: string | null;
  amountCents: number; // may be negative: refunds/adjustments recorded in Acuity
  paidAt: string | null; // ISO instant
  payDate: string | null; // LA date of paidAt
}

export interface AcuityOrder {
  id: string;
  localDate: string | null;
  orderedAt: string | null;
  email: string | null;
  totalCents: number;
  status: string | null; // Acuity order status: 'paid', 'unpaid', …
}

export interface SquarePay {
  id: string;
  createdAt: string; // ISO instant
  localDate: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  orderId: string | null;
  orderDiscountCents: number;
  email: string | null;
  squareProduct: string | null;
  refKind: string; // parseSquareNote kind
  ref: string | null;
  certificateCode: string | null;
  noteClassDate: string | null; // class date named in a 2020-era "dated" note
}

export interface Override {
  id: string;
  acuityKind: "appointment" | "order";
  acuityId: string;
  squarePaymentId: string | null;
  reasonCode: string;
  note: string | null;
}

export interface ReconInput {
  appointments: AcuityAppt[];
  payments: AcuityPay[];
  orders: AcuityOrder[];
  square: SquarePay[];
  certificateCodes: Set<string>; // upper-cased codes known to /certificates
  overrides: Override[];
}

export interface ReconConfig {
  matchWindowMinutes: number;
  membershipTypePatterns: string[];
  /** Statuses are written only for records whose local_date is in this range (inclusive). */
  window: { from: string; to: string };
}

export type AcuityKind = "appointment" | "order" | "certificate";

export interface Link {
  acuityKind: AcuityKind;
  acuityId: string;
  squarePaymentId: string;
  rule: "0" | "1a" | "1b" | "2" | "3" | "4";
  confidence: "manual" | "high" | "medium" | "low";
  allocatedCents: number;
  evidence: Record<string, unknown>;
}

export type Status = "matched" | "amount_mismatch" | "acuity_only" | "square_only" | "not_applicable";

export interface StatusRow {
  side: "acuity" | "square";
  kind: "appointment" | "order" | "payment";
  id: string;
  localDate: string | null;
  status: Status;
  reasonCode: string | null;
  exception: boolean;
  expectedCents: number | null;
  actualCents: number | null;
  deltaCents: number | null;
}

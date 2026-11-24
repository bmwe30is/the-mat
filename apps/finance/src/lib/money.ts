// Money as integer cents — never floats (PRD §12 Correctness).
//
// Why: 0.1 + 0.2 !== 0.3 in floating point. Acuity sends money as decimal
// strings ("25.00"), so we split on the dot and do integer math on the parts
// instead of calling parseFloat.

/** "25.00" → 2500, "25" → 2500, "25.5" → 2550, "-3.10" → -310, "" / null → 0. */
export function decimalToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const s = String(value).trim().replace(/,/g, "");
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`Not a decimal amount: "${value}"`);
  const [, sign, whole, frac = ""] = m;
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) {
    throw new Error(`Amount has sub-cent precision: "${value}"`);
  }
  const cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount too large: "${value}"`);
  return sign ? -cents : cents;
}

/** Square Money is already in the smallest unit; just guard the currency. */
export function squareMoneyToCents(m: { amount: number; currency: string } | undefined | null): number {
  if (!m) return 0;
  if (m.currency !== "USD") throw new Error(`Unexpected currency ${m.currency}`);
  return m.amount;
}

/** 2550 → "25.50" — for display only. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

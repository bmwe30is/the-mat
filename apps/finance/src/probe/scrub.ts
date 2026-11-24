// Remove personal data from API payloads before they go into a committed file
// (probe findings now, test fixtures later). PRD §15: scrub names/emails/phones.
//
// Three treatments:
//   - PII keys          → "[scrubbed]"  (names, emails, phones, addresses, card details, links with tokens)
//   - free-text keys    → letters masked as "x", digits kept, so we can still see
//                          whether a note carries an ID like "Acuity #123456789"
//   - any other string  → embedded email addresses masked

const PII_KEYS = new Set([
  "firstname", "lastname", "email", "phone", "forms", "formstext",
  "given_name", "family_name", "nickname", "company_name", "email_address", "buyer_email_address",
  "phone_number", "address", "billing_address", "shipping_address", "birthday",
  "cardholder_name", "fingerprint", "bin", "last_4", "exp_month", "exp_year",
  "ip_address", "receipt_url", "confirmationpage", "confirmationpagepaymentlink",
  "scheduledby", "recipient", "buyer_email", "client_name", "cards",
]);

const FREE_TEXT_KEYS = new Set(["notes", "note", "reason", "statement_description_identifier"]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export const maskLetters = (s: string) => s.replace(EMAIL_RE, "[email]").replace(/[A-Za-z]/g, "x");

export function scrub<T>(value: T): T {
  return walk(value, undefined) as T;
}

function walk(value: unknown, key: string | undefined): unknown {
  const k = key?.toLowerCase();
  if (k && PII_KEYS.has(k)) {
    return value === null || value === undefined || value === "" ? value : "[scrubbed]";
  }
  if (typeof value === "string") {
    return k && FREE_TEXT_KEYS.has(k) ? maskLetters(value) : value.replace(EMAIL_RE, "[email]");
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([ck, cv]) => [ck, walk(cv, ck)]));
  }
  return value;
}

/** Show a code's shape without revealing it: "WELCOME10" → "WEL…(9)". */
export const maskCode = (code: string) => (code.length <= 3 ? "…" : `${code.slice(0, 3)}…(${code.length})`);

// Parse the Acuity reference out of a Square payment's `note`.
//
// Acuity writes the note when it charges a card through Square. The probe
// (docs/finance/probe-findings.md, Q1) found these formats:
//
//   appointment  "1764688793 - <type> - <calendar>: … - <date time>"  → leading Acuity appointment id (newer)
//   order        "Order #44035300" / "Order 163224681 - <product>"    → Acuity order id (package/gift/membership sale)
//   subscription "Subscription 792817 - <plan> - … - 67A0B014"        → recurring membership charge; trailing
//                                                                        token is the Acuity certificate code
//                "792817 (<plan name>)"                              → 2020-era form of the same: subscription id only
//   dated        "<client name> … March 4, 2020 5:30pm (<type>…"      → 2020-era: no id at all, only text
//
// Pure function: no I/O. Never log the note itself — the "dated" format contains client names.

export type SquareNoteRef =
  | { kind: "appointment"; appointmentId: string }
  | { kind: "order"; orderId: string }
  | { kind: "subscription"; subscriptionId: string; certificateCode?: string }
  | { kind: "dated"; classDate?: string } // YYYY-MM-DD of the class named in the note, when readable
  | { kind: "empty" }
  | { kind: "other" };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "… on January 3, 2021 9:00am (…" → "2021-01-03". The wall-clock date as written (studio time). */
function parseNoteDate(s: string): string | undefined {
  const m = /\b([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+\d{1,2}:\d{2}\s*[ap]m\b/i.exec(s);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return undefined;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function parseSquareNote(note: string | null | undefined): SquareNoteRef {
  const s = (note ?? "").trim();
  if (s === "") return { kind: "empty" };

  let m = /^(\d{6,})\s+-\s/.exec(s);
  if (m) return { kind: "appointment", appointmentId: m[1] };

  m = /^Order\s+#?\s*(\d{6,})\b/i.exec(s);
  if (m) return { kind: "order", orderId: m[1] };

  m = /^Subscription\s+(\d+)\s+-\s.*\s-\s([0-9A-Za-z]{4,})$/i.exec(s);
  if (m) return { kind: "subscription", subscriptionId: m[1], certificateCode: m[2].toUpperCase() };

  m = /^(\d{5,7})\s+\(/.exec(s);
  if (m) return { kind: "subscription", subscriptionId: m[1] };

  if (/\b\d{4}\s+\d{1,2}:\d{2}\s*[ap]m\b/i.test(s)) {
    const classDate = parseNoteDate(s);
    return classDate ? { kind: "dated", classDate } : { kind: "dated" };
  }
  return { kind: "other" };
}

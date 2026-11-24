// Turn the raw probe pull into evidence for each open question in PRD §14.
//
// Pure: takes the data the probe fetched (or a cached copy of it) and returns
// markdown-ready findings. No network, no DB — so findings can be regenerated
// with `probe --from-cache <dir>` while iterating on the analysis.
//
// Never print client-identifying text: tables show counts, ids, codes (masked)
// and appointment-type names only.
import { decimalToCents } from "../lib/money.js";
import { localDateOf, parseSourceInstant, sourceOffset } from "../lib/time.js";
import type {
  AcuityAppointment,
  AcuityCalendar,
  AcuityCertificate,
  AcuityMe,
  AcuityOrder,
  AcuityPayment,
} from "../sources/acuity/types.js";
import { parseSquareNote } from "../sources/square/note.js";
import { certificateKind } from "../transform/acuity.js";
import type { SquareLocation, SquareOrder, SquarePayment, SquareRefund } from "../sources/square/types.js";
import { maskCode, scrub } from "./scrub.js";

export interface Window {
  from: string;
  to: string;
}

/** Result of asking an endpoint for `max` records. */
export interface MaxTrial<T> {
  requested: number;
  returned?: number;
  error?: string;
  records?: T[];
}

export interface ProbeData {
  fetchedAt: string;
  reportingTz: string;
  squareVersion: string;
  windows: { early: Window; recent: Window; fullYear: Window };
  acuity: {
    me: AcuityMe;
    calendars: AcuityCalendar[];
    appointmentTypes: Record<string, unknown>[];
    products: Record<string, unknown>[];
    certificates: AcuityCertificate[];
    appointments: { early: AcuityAppointment[]; recent: AcuityAppointment[] };
    /** Full-year pull at increasing `max` — answers Q8 and gives volume. */
    yearTrials: MaxTrial<AcuityAppointment>[];
    /** Single-day pulls (DST Sundays + busiest day) — answers Q3 (minDate semantics). */
    testDays: Array<{ date: string; appointments: AcuityAppointment[] }>;
    orderTrials: MaxTrial<AcuityOrder>[];
    paymentsByAppointment: Record<string, AcuityPayment[]>;
  };
  square: {
    locations: SquareLocation[];
    payments: { early: SquarePayment[]; recent: SquarePayment[]; fullYear: SquarePayment[] };
    refunds: { early: SquareRefund[]; recent: SquareRefund[]; fullYear: SquareRefund[] };
    orders: SquareOrder[];
    customers: Record<string, unknown>[];
  };
  /** Count of records in the matching Acuity CSV export, if present. */
  csv?: { file: string; records: number; canceled: number; byMonth: Record<string, number> };
}

export interface Finding {
  id: string; // "Q1", …
  question: string;
  answer: string;
  /** What this means for later phases / the PRD. */
  implications?: string[];
  evidence: string[]; // markdown blocks
  examples?: Array<{ label: string; json: unknown }>;
}

// ---------- small helpers ----------

const countBy = <T>(items: T[], key: (t: T) => string | undefined | null) => {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it) ?? "(none)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const table = (head: string[], rows: Array<Array<string | number>>) =>
  rows.length === 0
    ? "_(no rows)_"
    : [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join(
        "\n",
      );

const dist = (label: string, entries: Array<[string, number]>, limit = 12) =>
  table([label, "count"], entries.slice(0, limit).map(([k, n]) => [`\`${k}\``, n]));

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const uniqBy = <T>(items: T[], key: (t: T) => string | number) => [...new Map(items.map((i) => [key(i), i])).values()];
const keysOf = (objs: object[]) => [...new Set(objs.flatMap((o) => Object.keys(o)))].sort();
const minutesBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60_000;


// ---------- analysis ----------

interface Ctx {
  d: ProbeData;
  appts: AcuityAppointment[];
  apptIds: Set<string>;
  orders: AcuityOrder[];
  orderIds: Set<string>;
  certByCode: Map<string, AcuityCertificate>;
  sqPayments: SquarePayment[]; // full year + recent
  sqOrdersById: Map<string, SquareOrder>;
  acuityPayments: Array<AcuityPayment & { apptId: string; window: "early" | "recent" }>;
}

export function analyze(d: ProbeData): Finding[] {
  const yearAppts = d.acuity.yearTrials.find((t) => t.records)?.records ?? [];
  const appts = uniqBy([...d.acuity.appointments.early, ...d.acuity.appointments.recent, ...yearAppts], (a) => a.id);
  const orders = d.acuity.orderTrials.find((t) => t.records)?.records ?? [];
  const earlyIds = new Set(d.acuity.appointments.early.map((a) => String(a.id)));
  const ctx: Ctx = {
    d,
    appts,
    apptIds: new Set(appts.map((a) => String(a.id))),
    orders,
    orderIds: new Set(orders.map((o) => String(o.id))),
    certByCode: new Map(d.acuity.certificates.map((c) => [c.certificate.toUpperCase(), c])),
    sqPayments: uniqBy([...d.square.payments.fullYear, ...d.square.payments.recent], (p) => p.id),
    sqOrdersById: new Map(d.square.orders.map((o) => [o.id, o])),
    acuityPayments: Object.entries(d.acuity.paymentsByAppointment).flatMap(([apptId, ps]) =>
      ps.map((p) => ({ ...p, apptId, window: earlyIds.has(apptId) ? ("early" as const) : ("recent" as const) })),
    ),
  };
  return [q1(ctx), q2(ctx), q3(ctx), q4(ctx), q5(ctx), q6(ctx), q7(ctx), q8(ctx)];
}

function q1(c: Ctx): Finding {
  const { d } = c;
  const yearLabel = d.windows.fullYear.from.slice(0, 4);
  const groups: Array<[string, SquarePayment[]]> = [
    [`${yearLabel} (full year)`, d.square.payments.fullYear],
    [`${d.windows.recent.from.slice(0, 7)}`, d.square.payments.recent],
  ];

  // Subscription ids that also appear in a newer note together with a certificate
  // code — lets us check whether 2020-era "<id> (<plan>)" notes are the same series.
  const subIdsWithCode = new Set(
    c.sqPayments.flatMap((p) => {
      const ref = parseSquareNote(p.note);
      return ref.kind === "subscription" && ref.certificateCode && c.certByCode.has(ref.certificateCode)
        ? [ref.subscriptionId]
        : [];
    }),
  );

  const rows: Array<Array<string | number>> = [];
  for (const [label, payments] of groups) {
    for (const [kind, n] of countBy(payments, (p) => parseSquareNote(p.note).kind)) {
      const ofKind = payments.filter((p) => parseSquareNote(p.note).kind === kind);
      const resolved = ofKind.filter((p) => {
        const ref = parseSquareNote(p.note);
        if (ref.kind === "appointment") return c.apptIds.has(ref.appointmentId);
        if (ref.kind === "order") return c.orderIds.has(ref.orderId);
        if (ref.kind === "subscription") {
          return ref.certificateCode ? c.certByCode.has(ref.certificateCode) : subIdsWithCode.has(ref.subscriptionId);
        }
        return false;
      }).length;
      const target =
        kind === "appointment"
          ? "appointment id"
          : kind === "order"
            ? "order id"
            : kind === "subscription"
              ? "certificate code (2020: subscription id seen with a code)"
              : "—";
      rows.push([label, `\`${kind}\``, n, target, target === "—" ? "—" : `${resolved} (${pct(resolved, n)})`]);
    }
  }

  const appNotes = d.square.payments.recent.filter((p) => parseSquareNote(p.note).kind === "appointment");
  const unresolvedAppt = appNotes.filter((p) => {
    const ref = parseSquareNote(p.note);
    return ref.kind === "appointment" && !c.apptIds.has(ref.appointmentId);
  }).length;

  return {
    id: "Q1",
    question: "Which Square field carries the Acuity ID, and which Acuity ID is it?",
    answer:
      "**`payment.note`** (and the identical `order.line_items[].note`). `reference_id` and order metadata are always empty. " +
      "The note's format depends on era and the kind of sale: newer appointment charges **start with the Acuity appointment id**; package/gift/membership sales say **`Order #<Acuity order id>`**; " +
      "recurring membership charges are **`Subscription <id> - … - <certificate code>`** (in 2020: **`<id> (<plan name>)`**, with no code); and **2020-era appointment charges carry no id at all** (just client name, date and class).",
    implications: [
      "Rule 1 (ID link) must parse the note with `parseSquareNote()` (`src/sources/square/note.ts`), not look for one fixed field. Store the parsed ref on `stg_square_payment` (`acuity_ref` + a ref kind).",
      "For 2020 the note gives nothing to link on. The link comes from the Acuity side instead (Q2: `transactionID` = Square order id).",
      `Unresolved appointment ids in ${d.windows.recent.from.slice(0, 7)} (${unresolvedAppt} of ${appNotes.length}) are payments taken this month for classes held in other months. The probe only pulled appointments *held* in the window, so this is expected; full extraction resolves them.`,
      "2020-era subscription notes (`<id> (<plan>)`) carry no certificate code, and none of their subscription ids reappear in newer notes, so they can't be linked to a specific certificate. Classify them as membership charges by note kind alone.",
      "`Subscription` charges (memberships) map to an Acuity **certificate**, not an appointment or an order. The PRD's `recon_link.acuity_kind` needs a third value, `certificate` / membership charge (or classify them as `MEMBERSHIP_CHARGE`). **This is a PRD change.**",
      "The 2020-era note text contains client names, so never log `note`.",
    ],
    evidence: [
      "Square `note` format (parsed with `parseSquareNote`) and how many of those references exist in the Acuity data the probe pulled:",
      table(["window", "note kind", "payments", "refers to Acuity…", "found in probe data"], rows),
      "Other Square fields scanned for 6+ digit Acuity ids: `payment.reference_id`, `order.reference_id`, `order.metadata` and `line_item.metadata` were empty on every payment; `line_item.note` repeats `payment.note`.",
      "Who created the Square payment (`application_details.square_product`):",
      dist("square_product", countBy(c.sqPayments, (p) => p.application_details?.square_product)),
      "`order.source.name`:",
      dist("order source", countBy(c.sqPayments, (p) => (p.order_id ? c.sqOrdersById.get(p.order_id)?.source?.name : undefined))),
    ],
  };
}

function q2(c: Ctx): Finding {
  const sqById = new Map(c.sqPayments.map((p) => [p.id, p]));
  const sqByOrder = new Map(c.sqPayments.filter((p) => p.order_id).map((p) => [p.order_id!, p]));
  const link = (txn?: string) =>
    !txn ? "no transactionID" : sqById.has(txn) ? "= Square payment.id" : sqByOrder.has(txn) ? "= Square order_id" : "no match in pulled Square data";

  const rows = countBy(c.acuityPayments, (p) => `${p.window} | ${p.processor ?? "?"} | ${link(p.transactionID)}`).map(
    ([k, n]) => k.split(" | ").concat(String(n)),
  );

  const linked = c.acuityPayments
    .map((p) => ({ p, sq: p.transactionID ? (sqById.get(p.transactionID) ?? sqByOrder.get(p.transactionID)) : undefined }))
    .filter((x): x is { p: (typeof x)["p"]; sq: SquarePayment } => !!x.sq);
  const amountAgrees = linked.filter((x) => decimalToCents(x.p.amount) === x.sq.amount_money?.amount).length;
  const within1Min = linked.filter(
    (x) => x.p.created && minutesBetween(parseSourceInstant(x.p.created), new Date(x.sq.created_at)) <= 1,
  ).length;
  const relatedCounts = countBy(c.acuityPayments, (p) => String(p.relatedPaymentsCount ?? "?"));

  return {
    id: "Q2",
    question: "Does `GET /appointments/{id}/payments` return the Square `payment_id`?",
    answer:
      "**Yes, but which Square id it holds changed over time.** In 2020 `transactionID` is the Square **order id** (`payment.order_id`). In the recent month it is the Square **payment id**. " +
      `Linked pairs agree on amount in ${amountAgrees}/${linked.length} cases and on time (within a minute) in ${within1Min}/${linked.length}.`,
    implications: [
      "Rule 1 should treat `stg_acuity_payment.processor_txn_id` as matching **either** `stg_square_payment.payment_id` **or** `stg_square_payment.order_id`. That gives a high-confidence link for 2020, where the Square note has no id.",
      "Recent rows with no match were paid outside the probe's ±1-day window (booked weeks ahead). Full extraction resolves these.",
      "`processor = cash` payments have no transactionID, so they never have a Square counterpart. Classify them as their own reason, e.g. `CASH`. **This is a PRD change.**",
    ],
    evidence: [
      `Paid appointments sampled: ${Object.keys(c.d.acuity.paymentsByAppointment).length}; Acuity payment records: ${c.acuityPayments.length}.`,
      `Fields on Acuity payment objects: ${keysOf(c.acuityPayments)
        .filter((k) => k !== "apptId" && k !== "window")
        .map((k) => `\`${k}\``)
        .join(", ")}`,
      table(["window", "processor", "transactionID is…", "count"], rows),
      "`relatedPaymentsCount`:",
      dist("relatedPaymentsCount", relatedCounts),
    ],
    examples: c.acuityPayments.find((p) => p.transactionID)
      ? [{ label: "Acuity appointment payment", json: scrub(c.acuityPayments.find((p) => p.transactionID)) }]
      : [],
  };
}

function q3(c: Ctx): Finding {
  const { d } = c;
  const tz = d.reportingTz;
  const accountTz = d.acuity.me.timezone ?? "(not returned)";
  const dayRows = d.acuity.testDays.map((t) => {
    const own = t.appointments.filter((a) => a.datetime.startsWith(t.date)).length;
    const la = t.appointments.filter((a) => localDateOf(parseSourceInstant(a.datetime), tz) === t.date).length;
    return [t.date, t.appointments.length, own, la];
  });
  const tested = d.acuity.testDays.filter((t) => t.appointments.length > 0);
  const allOwn = tested.every((t) => t.appointments.every((a) => a.datetime.startsWith(t.date)));
  const calTzs = [...new Set(d.acuity.calendars.map((cal) => cal.timezone))];

  return {
    id: "Q3",
    question: "Is the Acuity account/calendar timezone LA or New York? Which timezone are minDate/maxDate interpreted in?",
    answer:
      `**LA.** The account (\`/me\`) and all ${d.acuity.calendars.length} calendars use \`${accountTz}\`, and every appointment \`datetime\` carries a -0700/-0800 offset. ` +
      "The CSV's `America/New_York` is the **client's** timezone (the appointment `timezone` field), not the studio's. " +
      (tested.length === 0
        ? "None of the single-day pulls returned rows, so minDate semantics are unconfirmed."
        : allOwn
          ? `\`minDate\`/\`maxDate\` filter on the appointment's **calendar-local date** (all rows from ${tested.length} single-day pulls have that date in their own offset). The calendar timezone is LA, so this is the LA date.`
          : "Some single-day rows fall on another calendar-local date. See the table."),
    implications: [
      "PRD §8 table: the Acuity timezone is LA, not New York. Keep `source_tz` = `calendarTimezone` anyway, to catch future calendars set to another zone.",
      "The ±1-day padding is cheap insurance but isn't strictly needed for Acuity.",
      `**New finding:** the Square **location** timezone is \`${d.square.locations[0]?.timezone ?? "?"}\`. The Square dashboard's monthly totals are probably bucketed by that zone, so the Phase 4 gross check must use the same month boundaries (or the dashboard must be set to Pacific).`,
    ],
    evidence: [
      table(
        ["calendar id", "timezone"],
        d.acuity.calendars.map((cal) => [String(cal.id), `\`${cal.timezone ?? "?"}\``]),
      ),
      `Distinct calendar timezones: ${calTzs.map((t) => `\`${t}\``).join(", ")}.`,
      "Offsets in appointment `datetime`:",
      dist("offset", countBy(c.appts, (a) => sourceOffset(a.datetime))),
      "`calendarTimezone` (studio) vs `timezone` (client):",
      dist("calendarTimezone", countBy(c.appts, (a) => a.calendarTimezone || "(empty)")),
      dist("client timezone", countBy(c.appts, (a) => a.timezone), 6),
      "Single-day pulls (`minDate = maxDate = date`):",
      table(["date", "rows", "own-offset date = date", "LA date = date"], dayRows),
    ],
    examples: d.acuity.appointments.early[0] ? [{ label: "Acuity appointment", json: scrub(d.acuity.appointments.early[0]) }] : [],
  };
}

function q4(c: Ctx): Finding {
  const withCode = c.appts.filter((a) => a.certificate);
  const kindOf = (a: AcuityAppointment) => certificateKind(c.certByCode.get(a.certificate!.toUpperCase()), a.certificate!);
  const priceShape = (a: AcuityAppointment) => {
    const price = decimalToCents(a.price);
    const sold = decimalToCents(a.priceSold);
    const paid = decimalToCents(a.amountPaid);
    return `price ${price === 0 ? "= 0" : sold > price ? "< priceSold" : "= priceSold"}, amountPaid ${paid === 0 ? "= 0" : paid > price ? "> price" : "≤ price"}`;
  };
  const noCode = c.appts.filter((a) => !a.certificate && decimalToCents(a.priceSold) > 0);
  const over = noCode.filter((a) => decimalToCents(a.amountPaid) > decimalToCents(a.price));
  const overDelta = countBy(over, (a) => {
    const p = decimalToCents(a.price);
    const pctOver = p ? Math.round((100 * (decimalToCents(a.amountPaid) - p)) / p) : -1;
    return pctOver < 0 ? "price 0" : `+${pctOver}%`;
  });

  return {
    id: "Q4",
    question:
      "How do coupons appear (certificate, lower amountPaid, or both)? Can /certificates tell coupon vs package vs membership apart?",
    answer:
      "**Both.** Any code (coupon, package, gift or membership) is stored in the appointment's `certificate` field. The price after the code is applied is in **`price`**, and the list price is in **`priceSold`**. " +
      "`/certificates` tells the kind through **`productType`** (`Subscription` → membership, `Package` → package, `Gift Certificate` → gift). Coupons are **not** in `/certificates`. Neither are many old Acuity-generated 8-hex-char codes, which were presumably deleted. " +
      `Separately, ${over.length} paid appointments **without** a code have \`amountPaid > price\`. They cluster at +10%, +15% and +20%, which looks like **tips collected in Acuity** (Square never has \`tip_money\`, Q7).`,
    implications: [
      "`certificate_kind` = `certificateKind()` in this file: look up the code in `/certificates` and map `productType`; if it isn't there, a hex-8 code means an Acuity-generated certificate that no longer exists (kind unknown: `certificate_deleted`), and anything else means `coupon`.",
      "`stg_acuity_appointment`: rename or document the columns so `price_cents` means **charged price after code**, and add `list_price_cents` (from `priceSold`). Discount = list − price. **This is a PRD change** (§7.3 has only `price_cents`).",
      "The `TIP` amount_mismatch code (Square `tip_cents`) will never fire, because Square never has `tip_money` (Q7). Tips live on the Acuity side as `amountPaid − price`, so add `tip_cents` (or `overpaid_cents`) to `stg_acuity_appointment`. **This is a PRD change.**",
      "`paid = yes` with `amountPaid = 0` is normal for full redemptions. `paid` alone doesn't mean money moved.",
    ],
    evidence: [
      `Appointments examined: ${c.appts.length}; with a code: ${withCode.length}.`,
      "Code kind (via `/certificates.productType`, else code shape):",
      dist("kind", countBy(withCode, kindOf)),
      "Price fields on appointments with a code:",
      dist("shape", countBy(withCode, priceShape)),
      "`/certificates` `productType` / `type`:",
      dist("productType / type", countBy(c.d.acuity.certificates, (x) => `${x.productType} / ${x.type}`)),
      "`/products` `kind` / `type`:",
      dist("kind / type", countBy(c.d.acuity.products, (p) => `${p.kind} / ${p.type}${p.isGiftCertificate ? " (gift)" : ""}`)),
      "Most-used codes that are NOT in `/certificates` (masked):",
      dist("code", countBy(withCode.filter((a) => !c.certByCode.has(a.certificate!.toUpperCase())), (a) => maskCode(a.certificate!.toUpperCase()))),
      "Paid appointments without a code where `amountPaid > price`, by % over price:",
      dist("over by", overDelta),
    ],
    examples: [
      ...(c.d.acuity.certificates[0] ? [{ label: "Acuity certificate", json: scrub({ ...c.d.acuity.certificates[0], appointmentTypes: "(trimmed)", remainingCounts: "(trimmed)", appointmentTypeIDs: "(trimmed)" }) }] : []),
    ],
  };
}

function q5(c: Ctx): Finding {
  const orders = [...c.sqOrdersById.values()];
  const withDiscounts = orders.filter((o) => (o.discounts?.length ?? 0) > 0);
  const lines = orders.flatMap((o) => o.line_items ?? []);
  const custom = lines.filter((l) => !l.catalog_object_id);
  const pos = c.sqPayments.filter((p) => !["ECOMMERCE_API", "INVOICES"].includes(p.application_details?.square_product ?? ""));

  return {
    id: "Q5",
    question: "How do manual discounts at the Square register appear — order-level `discounts[]` or a changed line-item price?",
    answer:
      `**Neither appears: there are no register sales in the data.** Of ${c.sqPayments.length} Square payments (${c.d.windows.fullYear.from.slice(0, 4)} plus ${c.d.windows.recent.from.slice(0, 7)}), ` +
      `${pos.length} came from anything other than Acuity (\`ECOMMERCE_API\`) or Square Invoices. ${withDiscounts.length} of ${orders.length} orders have \`discounts[]\`, and ${custom.length} of ${lines.length} line items are custom amounts with no catalog item. ` +
      "Discounts in this business happen **in Acuity** (coupons and codes, Q4), not at a Square register.",
    implications: [
      "The PRD's premise in §1 ('Manual discounts at the Square register') doesn't hold for this data. Keep `stg_square_order_discount` (cheap, future-proof), but expect it to be empty.",
      "`POS_RETAIL` will be rare or empty. Square-only payments are mostly **Invoices** (`square_product = INVOICES`, e.g. payment-plan memberships), which map to `INVOICE`.",
      "`SQUARE_DISCOUNT` won't explain mismatches. Look at Acuity tips/overpayments (Q4) instead.",
    ],
    evidence: [
      "`application_details.square_product` by payment status:",
      dist("product / status", countBy(c.sqPayments, (p) => `${p.application_details?.square_product} / ${p.status}`)),
      "Order-level discounts (`discounts[].scope / type`):",
      dist("scope / type", countBy(orders.flatMap((o) => o.discounts ?? []), (x) => `${x.scope} / ${x.type}`)),
      "Line items with a catalog item vs custom amount:",
      dist("line item", countBy(lines, (l) => (l.catalog_object_id ? "catalog item" : "custom amount"))),
    ],
    examples: orders[0] ? [{ label: "Square order", json: scrub(orders[0]) }] : [],
  };
}

function q6(c: Ctx): Finding {
  const byTxn = new Map<string, Set<string>>();
  for (const p of c.acuityPayments) {
    if (!p.transactionID) continue;
    byTxn.set(p.transactionID, (byTxn.get(p.transactionID) ?? new Set()).add(p.apptId));
  }
  const shared = [...byTxn.values()].filter((s) => s.size > 1).length;
  const lineCounts = countBy(c.sqPayments, (p) => {
    const n = p.order_id ? (c.sqOrdersById.get(p.order_id)?.line_items?.length ?? 0) : 0;
    return n >= 4 ? "4+" : String(n);
  });
  const multi = c.sqPayments.filter((p) => (p.order_id ? (c.sqOrdersById.get(p.order_id)?.line_items?.length ?? 0) : 0) > 1);

  return {
    id: "Q6",
    question: "Does one Square payment ever cover several appointments? How often?",
    answer:
      shared === 0 && multi.length === 0
        ? `**Not observed.** Every sampled Acuity payment has \`relatedPaymentsCount = 1\` and a distinct transactionID, and no Square order has more than one line item (${c.sqPayments.length} payments).`
        : `**Yes, occasionally**: ${shared} shared transactionIDs in the Acuity sample, and ${multi.length} Square payments with several line items.`,
    implications: [
      "Keep `recon_link.allocated_cents` and the 1→N support as designed (it's cheap), but expect allocations to equal the full payment almost always.",
      "`relatedPaymentsCount` on Acuity payments is the field to watch. If it's ever > 1, log it.",
    ],
    evidence: [
      `Acuity transactionIDs shared by >1 sampled appointment: ${shared} (of ${byTxn.size}).`,
      "Square payments by number of order line items:",
      dist("line items", lineCounts),
    ],
  };
}

function q7(c: Ctx): Finding {
  const row = (label: string, ps: SquarePayment[]) => {
    const completed = ps.filter((p) => p.status === "COMPLETED");
    const withFee = completed.filter((p) => (p.processing_fee?.length ?? 0) > 0);
    const withTip = ps.filter((p) => (p.tip_money?.amount ?? 0) > 0);
    return [label, ps.length, completed.length, `${withFee.length} (${pct(withFee.length, completed.length)})`, withTip.length];
  };
  const fy = c.d.square.payments.fullYear;
  const completed = fy.filter((p) => p.status === "COMPLETED");
  const withFee = completed.filter((p) => (p.processing_fee?.length ?? 0) > 0).length;

  return {
    id: "Q7",
    question: "Are processing fees present on 2020 Square payments?",
    answer: `**Yes.** ${withFee} of ${completed.length} completed ${c.d.windows.fullYear.from.slice(0, 4)} payments have \`processing_fee[]\` (${pct(withFee, completed.length)}). No payment has \`tip_money\`.`,
    implications: ["`fee_cents` = sum of `processing_fee[].amount_money` works as specified. Expect `tip_cents = 0` on Square throughout (see Q4 for where tips actually live)."],
    evidence: [
      table(["window", "payments", "completed", "completed with processing_fee", "with tip_money"], [
        row(`${c.d.windows.fullYear.from.slice(0, 4)} full year`, fy),
        row(`${c.d.windows.recent.from}…${c.d.windows.recent.to}`, c.d.square.payments.recent),
      ]),
      "Fee `type`:",
      dist("type", countBy([...fy, ...c.d.square.payments.recent].flatMap((p) => p.processing_fee ?? []), (f) => f.type)),
      `Refunds: ${c.d.square.refunds.fullYear.length} in ${c.d.windows.fullYear.from.slice(0, 4)}, ${c.d.square.refunds.recent.length} in ${c.d.windows.recent.from.slice(0, 7)}.`,
    ],
    examples: completed[0] ? [{ label: "Square payment", json: scrub(completed[0]) }] : [],
  };
}

function q8(c: Ctx): Finding {
  const trialRows = (trials: MaxTrial<unknown>[]) =>
    trials.map((t) => [t.requested, t.returned ?? "—", t.error ? `error: ${t.error.slice(0, 80)}` : "ok"]);
  const yearOk = c.d.acuity.yearTrials.find((t) => t.records);
  const orderOk = c.d.acuity.orderTrials.find((t) => t.records);
  const orderTimes = c.orders.map((o) => o.time).filter(Boolean).sort() as string[];
  const capped = (t?: MaxTrial<unknown>) => t && t.returned === t.requested;
  const orderNotes = c.d.square.payments.fullYear
    .map((p) => parseSquareNote(p.note))
    .filter((r): r is { kind: "order"; orderId: string } => r.kind === "order");
  const missingOrders = orderNotes.filter((r) => !c.orderIds.has(r.orderId)).length;

  const evidence = [
    `Appointments for ${c.d.windows.fullYear.from}…${c.d.windows.fullYear.to} (showall=true):`,
    table(["max requested", "returned", "result"], trialRows(c.d.acuity.yearTrials)),
    "Orders (no date filter):",
    table(["max requested", "returned", "result"], trialRows(c.d.acuity.orderTrials)),
    orderTimes.length ? `Order \`time\` range: ${orderTimes[0]} … ${orderTimes.at(-1)}.` : "",
    `Square ${c.d.windows.fullYear.from.slice(0, 4)} notes that reference an Acuity order: ${orderNotes.length}. Of these, ${missingOrders} reference an order id that \`/orders\` does not return.`,
  ];
  if (c.d.csv && yearOk) {
    const apiByMonth = new Map(countBy(yearOk.records!, (a) => a.datetime.slice(0, 7)));
    const months = [...new Set([...Object.keys(c.d.csv.byMonth), ...apiByMonth.keys()])].sort();
    evidence.push(
      `CSV \`${c.d.csv.file}\`: ${c.d.csv.records} records. API full-year pull: ${yearOk.returned}. Canceled in API pull: ${yearOk.records!.filter((a) => a.canceled).length}.`,
      table(
        ["month", "CSV", "API", "Δ"],
        months.map((m) => [m, c.d.csv!.byMonth[m] ?? 0, apiByMonth.get(m) ?? 0, (apiByMonth.get(m) ?? 0) - (c.d.csv!.byMonth[m] ?? 0)]),
      ),
    );
  }
  return {
    id: "Q8",
    question: "Highest `max` that /appointments and /orders accept; total number of orders.",
    answer:
      `\`max\` above 1000 works. A full year of appointments came back in one call (max ${yearOk?.requested ?? "?"} → ${yearOk?.returned ?? "—"}${capped(yearOk) ? ", **hit the cap**" : ""}). ` +
      `\`/orders\` returned **${orderOk?.returned ?? "—"} orders in total**${capped(orderOk) ? " (**hit the cap**)" : ""}, from ${orderTimes[0]?.slice(0, 10) ?? "?"} to ${orderTimes.at(-1)?.slice(0, 10) ?? "?"}. ` +
      (c.d.csv && yearOk ? `The API's 2020 count matches the CSV export exactly (${yearOk.returned} = ${c.d.csv.records}, every month).` : ""),
    implications: [
      "Extract appointments in monthly chunks with `max=5000` (far above any month), and fail loudly if a chunk returns exactly `max`.",
      "`/orders` is small enough to pull in full every run (no date filter exists).",
      missingOrders > 0
        ? `${missingOrders} early order ids in Square notes are missing from \`/orders\`. They're probably from before the order history starts. They will classify as \`ACUITY_ORDER\` via the note anyway, but flag them in the exceptions report.`
        : "",
    ].filter(Boolean),
    evidence: evidence.filter(Boolean),
    examples: orderOk?.records?.[0] ? [{ label: "Acuity order", json: scrub(orderOk.records[0]) }] : [],
  };
}

// ---------- rendering ----------

export function renderFindings(d: ProbeData, findings: Finding[]): string {
  const loc = d.square.locations[0];
  const lines = [
    "# Probe findings: Acuity + Square",
    "",
    `_Generated by \`npm run finance -- probe\` from data fetched ${d.fetchedAt}. Re-generate from the cached raw data with \`probe --from-cache data/probe/<run>/\`._`,
    "",
    "Examples are scrubbed: PII fields are removed, and letters in free-text fields are masked as `x` (digits are kept, so embedded IDs stay visible). Raw responses are in the gitignored `data/probe/` folder.",
    "",
    "## Setup",
    "",
    `- Windows: early **${d.windows.early.from} … ${d.windows.early.to}**, recent **${d.windows.recent.from} … ${d.windows.recent.to}**, full year **${d.windows.fullYear.from} … ${d.windows.fullYear.to}** (Acuity appointments, Square payments and refunds).`,
    `- Square-Version header: \`${d.squareVersion}\` (worked; pin it as \`SQUARE_VERSION\`).`,
    `- Square locations: ${d.square.locations.length}${loc ? `. Pin \`SQUARE_LOCATION_ID=${loc.id}\`; the location's timezone is \`${loc.timezone ?? "?"}\`` : ""}.`,
    `- Acuity: account timezone \`${d.acuity.me.timezone ?? "?"}\`; ${d.acuity.calendars.length} calendars, ${d.acuity.appointmentTypes.length} appointment types, ${d.acuity.products.length} products, ${d.acuity.certificates.length} certificates.`,
    `- Pulled: Acuity appointments ${d.acuity.appointments.early.length} early / ${d.acuity.appointments.recent.length} recent, plus a full year; Square payments ${d.square.payments.fullYear.length} for the full year / ${d.square.payments.recent.length} recent; ${d.square.orders.length} Square orders.`,
    "",
    "## Summary",
    "",
    table(
      ["#", "question", "answer"],
      findings.map((f) => [f.id, f.question.replace(/\|/g, "\\|"), f.answer.replace(/\|/g, "\\|")]),
    ),
    "",
  ];
  for (const f of findings) {
    lines.push(`## ${f.id}. ${f.question}`, "", `**Answer:** ${f.answer}`, "");
    if (f.implications?.length) {
      lines.push("**Implications**", "", ...f.implications.map((i) => `- ${i}`), "");
    }
    lines.push("### Evidence", "");
    for (const e of f.evidence) lines.push(e, "");
    for (const ex of f.examples ?? []) {
      lines.push(`<details><summary>Example: ${ex.label} (scrubbed)</summary>`, "", "```json", JSON.stringify(ex.json, null, 2), "```", "", "</details>", "");
    }
  }
  const extra = [
    ["Square refund", d.square.refunds.fullYear[0] ?? d.square.refunds.recent[0]],
    ["Acuity appointment type", d.acuity.appointmentTypes[0]],
  ] as const;
  lines.push("## Other payload examples", "");
  for (const [label, obj] of extra) {
    if (!obj) continue;
    lines.push(`<details><summary>${label} (scrubbed)</summary>`, "", "```json", JSON.stringify(scrub(obj), null, 2), "```", "", "</details>", "");
  }
  return lines.join("\n");
}

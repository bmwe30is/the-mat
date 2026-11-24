// `finance probe` (PRD Phase 2): pull small, representative samples from both
// APIs and write docs/finance/probe-findings.md answering PRD §14 Q1–8.
//
// Raw responses contain PII, so they are saved to the gitignored
// data/probe/<timestamp>/ folder. Only scrubbed examples reach the docs.
import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { behaviourConfig, FINANCE_ROOT, squareConfig } from "../config.js";
import { withRun } from "../db/sync-run.js";
import { logger } from "../lib/logger.js";
import { decimalToCents } from "../lib/money.js";
import { addLocalDays, localDateOf, localRangeToUtc, monthBounds } from "../lib/time.js";
import { AcuityClient } from "../sources/acuity/client.js";
import { SquareClient } from "../sources/square/client.js";
import { analyze, renderFindings, type MaxTrial, type ProbeData } from "./analyze.js";

const REPO_ROOT = path.resolve(FINANCE_ROOT, "../..");
const FINDINGS_PATH = path.join(REPO_ROOT, "docs/finance/probe-findings.md");

export interface ProbeOptions {
  from: string;
  to: string;
  recent?: string; // YYYY-MM
  sample: number;
  fromCache?: string;
}

/** Previous full calendar month in the reporting timezone, as YYYY-MM. */
function previousMonth(tz: string): string {
  const today = localDateOf(new Date(), tz);
  return addLocalDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}

/** Try increasing `max` values; keep every attempt (errors included) as evidence. */
async function tryMaxes<T>(maxes: number[], call: (max: number) => Promise<T[]>): Promise<MaxTrial<T>[]> {
  const trials: MaxTrial<T>[] = [];
  for (const max of maxes) {
    try {
      const records = await call(max);
      trials.push({ requested: max, returned: records.length, records });
      if (records.length < max) break; // got everything — larger values tell us nothing new
    } catch (err) {
      trials.push({ requested: max, error: (err as Error).message });
    }
  }
  // Keep records only on the best successful trial, to keep the cache small.
  const best = trials.filter((t) => t.records).sort((a, b) => (b.returned ?? 0) - (a.returned ?? 0))[0];
  for (const t of trials) if (t !== best) delete t.records;
  return trials;
}

function readCsvCounts(year: string): ProbeData["csv"] {
  const file = path.join(REPO_ROOT, `data/acuity-exports/tejal-acuity - ${year}.csv`);
  if (!fs.existsSync(file)) return undefined;
  const rows = parse(fs.readFileSync(file), { columns: true, skip_empty_lines: true, bom: true }) as Record<
    string,
    string
  >[];
  const byMonth: Record<string, number> = {};
  for (const r of rows) {
    // "Start Time" looks like "March 2, 2020 9:00am"; Date can parse the date part.
    const d = new Date((r["Start Time"] ?? "").replace(/\s+\d{1,2}:\d{2}\s*[ap]m$/i, ""));
    const key = Number.isNaN(d.getTime())
      ? "(unparsed)"
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] ?? 0) + 1;
  }
  const canceled = rows.filter((r) => /^(yes|true|1|canceled)$/i.test((r["Canceled"] ?? "").trim())).length;
  return { file: path.relative(REPO_ROOT, file), records: rows.length, canceled, byMonth };
}

async function fetchProbeData(opts: ProbeOptions): Promise<{ data: ProbeData; apiCalls: number }> {
  const beh = behaviourConfig();
  const tz = beh.reportingTz;
  const acuity = new AcuityClient();
  const square = new SquareClient();

  const early = { from: opts.from, to: opts.to };
  const recent = monthBounds(opts.recent ?? previousMonth(tz));
  const year = opts.from.slice(0, 4);
  const fullYear = { from: `${year}-01-01`, to: `${year}-12-31` };
  // Pad by a day on both sides (PRD §8 rule 4); Acuity takes dates, Square instants.
  const pad = (w: { from: string; to: string }) => ({ minDate: addLocalDays(w.from, -1), maxDate: addLocalDays(w.to, 1) });

  logger.info({ early, recent }, "probing Acuity");
  const me = await acuity.me();
  const calendars = await acuity.calendars();
  const appointmentTypes = await acuity.appointmentTypes();
  const products = await acuity.products();
  const certificates = await acuity.certificates();
  const apptEarly = await acuity.appointments({ ...pad(early), max: 5000 });
  const apptRecent = await acuity.appointments({ ...pad(recent), max: 5000 });
  const yearTrials = await tryMaxes([1000, 5000, 10000], (max) =>
    acuity.appointments({ minDate: fullYear.from, maxDate: fullYear.to, max }),
  );
  // minDate/maxDate semantics: pull single days — both DST Sundays and the
  // busiest day of the year (so at least one test day has rows).
  const yearRecords = yearTrials.find((t) => t.records)?.records ?? [];
  const busiest = [...yearRecords.reduce((m, a) => m.set(a.datetime.slice(0, 10), (m.get(a.datetime.slice(0, 10)) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const testDates = [...new Set([`${year}-03-08`, `${year}-11-01`, ...(busiest ? [busiest] : [])])];
  const testDays: ProbeData["acuity"]["testDays"] = [];
  for (const date of testDates) {
    testDays.push({ date, appointments: await acuity.appointments({ minDate: date, maxDate: date, max: 1000 }) });
  }
  const orderTrials = await tryMaxes([1000, 5000, 10000, 50000], (max) => acuity.orders({ max }));

  // Payment lookups are one request each — sample paid appointments from both windows.
  const paid = (as: typeof apptEarly) => as.filter((a) => decimalToCents(a.amountPaid) > 0);
  const toSample = [
    ...paid(apptEarly).slice(0, opts.sample),
    ...paid(apptRecent).slice(0, Math.ceil(opts.sample / 3)),
  ];
  logger.info({ appointments: toSample.length }, "fetching Acuity appointment payments");
  const paymentsByAppointment: ProbeData["acuity"]["paymentsByAppointment"] = {};
  for (const a of toSample) paymentsByAppointment[a.id] = await acuity.appointmentPayments(a.id);

  logger.info("probing Square");
  const locations = await square.locations();
  const sqWin = (w: { from: string; to: string }) => localRangeToUtc(w.from, w.to, tz, 1);
  const e = sqWin(early);
  const r = sqWin(recent);
  // Pull the whole early year once (cheap at Square's rate limit) and slice the
  // early window out of it, so Q5/Q7 aren't judged on a handful of payments.
  const y = sqWin(fullYear);
  const payFullYear = await square.listPayments(y.begin, y.end);
  const inWindow = (p: { created_at: string }) => {
    const t = Date.parse(p.created_at);
    return t >= e.begin.getTime() && t < e.end.getTime();
  };
  const payEarly = payFullYear.filter(inWindow);
  const payRecent = await square.listPayments(r.begin, r.end);
  const refFullYear = await square.listRefunds(y.begin, y.end);
  const refEarly = refFullYear.filter((x) => x.created_at && inWindow({ created_at: x.created_at }));
  const refRecent = await square.listRefunds(r.begin, r.end);
  const orderIds = [...new Set([...payFullYear, ...payRecent].map((p) => p.order_id).filter((x): x is string => !!x))];
  const orders = await square.batchRetrieveOrders(orderIds);
  const customerIds = [...new Set([...payEarly, ...payRecent].map((p) => p.customer_id).filter((x): x is string => !!x))];
  const customers: Record<string, unknown>[] = [];
  for (const id of customerIds.slice(0, 5)) {
    const c = await square.retrieveCustomer(id);
    if (c) customers.push(c);
  }

  const data: ProbeData = {
    fetchedAt: new Date().toISOString(),
    reportingTz: tz,
    squareVersion: squareConfig().version,
    windows: { early, recent, fullYear },
    acuity: {
      me,
      calendars,
      appointmentTypes,
      products,
      certificates,
      appointments: { early: apptEarly, recent: apptRecent },
      yearTrials,
      testDays,
      orderTrials,
      paymentsByAppointment,
    },
    square: {
      locations,
      payments: { early: payEarly, recent: payRecent, fullYear: payFullYear },
      refunds: { early: refEarly, recent: refRecent, fullYear: refFullYear },
      orders,
      customers,
    },
    csv: readCsvCounts(year),
  };
  return { data, apiCalls: acuity.http.calls + square.http.calls };
}

export async function runProbe(opts: ProbeOptions): Promise<void> {
  let data: ProbeData;
  if (opts.fromCache) {
    // npm runs workspace scripts from apps/finance; resolve relative paths from
    // where the user actually typed the command (INIT_CWD) instead.
    const dir = path.resolve(process.env.INIT_CWD ?? process.cwd(), opts.fromCache);
    data = JSON.parse(fs.readFileSync(path.join(dir, "probe-data.json"), "utf8"));
    logger.info({ dir: opts.fromCache }, "re-analyzing cached probe data (no API calls)");
  } else {
    data = await withRun({ job: "probe", windowStart: opts.from, windowEnd: opts.to }, async () => {
      const { data, apiCalls } = await fetchProbeData(opts);
      return { result: data, apiCalls };
    });
    const dir = path.join(REPO_ROOT, "data/probe", data.fetchedAt.replace(/[:.]/g, "-"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "probe-data.json"), JSON.stringify(data, null, 2));
    logger.info({ dir: path.relative(REPO_ROOT, dir) }, "raw probe data saved (gitignored; contains PII)");
  }

  const markdown = renderFindings(data, analyze(data));
  fs.mkdirSync(path.dirname(FINDINGS_PATH), { recursive: true });
  fs.writeFileSync(FINDINGS_PATH, markdown);
  logger.info({ file: path.relative(REPO_ROOT, FINDINGS_PATH) }, "findings written");
}

# PRD — Finance Web: Data Review UI + Refresh

**Status:** Draft v1 · 2026-10-16
**Owner:** Jonathan
**Implementer:** Claude Code
**Location in repo:** `docs/finance/PRD-finance-ui.md`
**Depends on:** `docs/finance/PRD-finance-ledger.md` (pipeline, `finance` schema) and the code in `apps/finance` as built.

---

## 1. Purpose

The pipeline lands Acuity + Square data in Postgres, but the only way to look at it today is `npm run finance -- query …`. Build a **quick, local-only web UI** that lets the owner:

1. **Trust the data:** see whether pulls succeeded, whether coverage is complete, and whether our totals tie to each source system.
2. **See customers:** each client with every booking, payment and refund, and its match status.
3. **See revenue P&L by month and year:** gross → discounts → refunds → fees → net revenue, by revenue type.
4. **Refresh on demand:** a button that runs the pipeline (Acuity + Square → raw → staging → reconcile → checks) and shows live progress.

"Quick" means plain, fast and correct. It doesn't mean pretty.

## 2. Decisions (owner, 2026-10-16)

| # | Decision |
|---|---|
| U1 | **New app `apps/finance-web`**: Next.js in the monorepo, separate from the consumer app (`apps/web`) |
| U2 | **Local only, single user, no login.** The server binds to `127.0.0.1`. Hosting and auth come later. |
| U3 | **Revenue-only P&L for now.** Expenses (rent, payroll, software) are out of scope; the design leaves room to add them (§9.4). |
| U4 | **Refresh runs on the owner's Mac** by spawning the existing `finance run` CLI as a background process |
| U5 | Built by Claude Code from this PRD |

## 3. Non-goals

- Authentication, roles, deployment, mobile layout.
- Editing source data. The UI is **read-only** apart from triggering a refresh. Adding manual reconciliation overrides from the UI is a later phase (§13).
- Expenses / true profit, accrual accounting, fiscal (4-4-5) calendar.
- Webhooks or scheduled refresh.

---

## 4. Architecture

```
┌────────────────────── apps/finance-web (Next.js, 127.0.0.1:3100) ──────────────────────┐
│ Server Components ──► lib/db.ts (pg pool, READ ONLY txns) ──► queries/ui/*.sql          │
│ Route handlers:  POST /api/refresh ──► spawn `finance run` (detached) ──► log file       │
│                  GET  /api/refresh/:id ──► reads finance.sync_run (+ log tail)           │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │ Postgres (same FINANCE_DATABASE_URL)
┌──────────────────────────────────────────▼──────────────────────────────────────────────┐
│ apps/finance (CLI)  `run`: lock → extract acuity → extract square → transform →          │
│                     reconcile → check, writing progress to finance.sync_run               │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

**The contract between the UI and the pipeline is narrow on purpose. finance-web never imports `apps/finance/src`.** It depends on exactly three things:
1. **The `finance` schema** (tables from `db/migrations`).
2. **SQL files** in `apps/finance/queries/ui/`. They live next to the existing report queries, so they're also runnable from the CLI with `npm run finance -- query`, the same tuning loop as before.
3. **The CLI command** `finance run`, launched as a child process.

**Why (for the junior reader):**
- `apps/finance` is TypeScript executed directly by `tsx`, using `.js`-suffixed ESM imports. Importing it into Next.js would need bundler tweaks, and it would tie a long-running pipeline to a web request's lifetime.
- A child process survives page reloads. It's the same thing a scheduled job will run later, and if it crashes it can't take the web server down.

### 4.1 Shared SQL-file loader (small refactor)
The `:named`-param binder lives in `apps/finance/src/db/sql-file.ts`. Move its **pure parsing/binding logic** into a new workspace package so both apps use one implementation:

```
packages/sql-file/          # NEW workspace package (add "packages/*" to root workspaces)
├─ package.json             # name "@the-mat/sql-file", "type": "module", exports ./src/index.ts
├─ src/index.ts             # loadSqlFile(path) + bindNamedParams(sql, params) → { text, values }
└─ test/bind.test.ts        # moved tests: :: casts, quotes, comments, missing params
```
- `apps/finance` re-exports from it (behaviour unchanged; existing tests must pass).
- `apps/finance-web` sets `transpilePackages: ["@the-mat/sql-file"]` in `next.config.ts`.
- **The package must have no `.js`-suffixed relative imports and no Node-only dependencies other than `node:fs`.**

---

## 5. Repository layout

**All new unless marked.**

```
the-mat/
├─ package.json                     # EDIT: workspaces ["apps/*", "packages/*"]; script "finance-web": "npm run dev -w apps/finance-web"
├─ packages/sql-file/               # see §4.1
├─ apps/finance/
│  ├─ db/migrations/0005_run_tracking.sql   # §8.2
│  ├─ src/cli.ts                    # EDIT: `run` gains --run-id/--triggered-by, lock, step tracking, heartbeat (§8.3)
│  ├─ src/db/run-tracking.ts        # startRun / startStep / finishStep / heartbeat / finishRun
│  └─ queries/ui/                   # read-only SQL used by the UI (each starts with a `-- params:` header)
│     ├─ runs_list.sql  run_detail.sql
│     ├─ coverage_daily.sql  source_vs_reference_monthly.sql  pipeline_funnel.sql
│     ├─ recon_overview_monthly.sql  recon_by_reason.sql  exceptions.sql
│     ├─ inspect_raw.sql  inspect_versions.sql  inspect_staging.sql  inspect_recon.sql
│     ├─ sample_ledger.sql
│     ├─ customers_list.sql  customer_timeline.sql
│     ├─ revenue_bucketed.sql       # the single source of revenue classification (§9.2)
│     └─ pnl.sql                    # month or year grain via :grain
└─ apps/finance-web/
   ├─ package.json                  # dev: "next dev --turbopack -H 127.0.0.1 -p 3100"
   ├─ next.config.ts                # transpilePackages, serverExternalPackages: ["pg"]
   ├─ .env.example                  # §10
   ├─ src/
   │  ├─ lib/
   │  │  ├─ db.ts                   # pg Pool (same SSL/UTC/date-parser rules as apps/finance/src/db/pool.ts)
   │  │  ├─ sql.ts                  # runUiQuery(name, params): READ ONLY txn + @the-mat/sql-file
   │  │  ├─ money.ts                # formatCents(string|bigint) via BigInt + Intl (never Number for sums)
   │  │  ├─ params.ts               # zod parsing of URL search params (dates, page, sort)
   │  │  ├─ refresh.ts              # spawn / status / cancel (server-only)
   │  │  └─ target.ts               # LOCAL vs REMOTE from the DB host
   │  ├─ app/
   │  │  ├─ layout.tsx              # nav + target badge + last-refresh pill
   │  │  ├─ page.tsx                # Overview
   │  │  ├─ runs/page.tsx           # V1 + refresh panel
   │  │  ├─ quality/page.tsx        # V2, V3, V4 (tabs)
   │  │  ├─ reconciliation/page.tsx # V5
   │  │  ├─ exceptions/page.tsx     # V6
   │  │  ├─ inspect/page.tsx        # V7 (?q=<any id or email>)
   │  │  ├─ sample/page.tsx         # V8
   │  │  ├─ customers/page.tsx      # C1
   │  │  ├─ customers/[key]/page.tsx# C2
   │  │  ├─ pnl/page.tsx            # P1
   │  │  └─ api/refresh/route.ts, api/refresh/[id]/route.ts, api/refresh/[id]/cancel/route.ts
   │  └─ components/                # DataTable, Money, DateRangePicker, StatusBadge, JsonViewer, Heatmap, Chart
   └─ test/                         # vitest: money, params, refresh guards; SQL snapshot tests against a seeded test DB
```

### Dependencies (apps/finance-web)
| Package | Why |
|---|---|
| `next@15.5.x`, `react@19.1.x`, `react-dom` | Same versions as `apps/web`, so the monorepo has one React |
| `pg`, `@types/pg` | Server-side DB access (no ORM, same as the pipeline) |
| `@the-mat/sql-file` (workspace) | Shared `.sql` loader + `:named` binder |
| `zod` | Validate URL params and the refresh request body |
| `tailwindcss@4`, `@tailwindcss/postcss` | Styling (already used in `apps/web`) |
| `@tanstack/react-table` | Sortable, paginated tables (headless; works with server-side pagination) |
| `recharts` | Bar/line charts for P&L and the reconciliation overview |
| `dotenv-cli` (dev) | `.env.local` / `.env.remote` switching, same convention as `apps/finance` |
| dev: `typescript`, `vitest` | |

No component library. Plain Tailwind keeps it quick and dependency-light.

---

## 6. Global UX rules

- **State lives in the URL** (`?from=2020-03-01&to=2020-12-31&page=2&sort=-net`). Back/forward work, and a view can be bookmarked.
- **Global date range** in the header defaults to `SEED_START`–`SEED_END`. Presets: *This month*, *Last month*, *YTD*, *2020*, *All loaded*.
- **Target badge:** a green `LOCAL` or red `REMOTE · <host>` badge on every page, so it's always obvious which database is in use.
- **Money:**
  - Right-aligned, `$1,234.56`, negatives in parentheses and red.
  - Formatted from cents strings with `BigInt`. Never sum money in JavaScript; sums happen in SQL.
- **Dates:** every date is an LA local date (`local_date`). Instants are shown as LA time with a hover tooltip showing UTC.
- **Every ID is a link** to the Record Inspector (V7).
- **Tables:** server-side pagination (50/page), sortable columns, a CSV download of the current query (the same SQL with no limit).
- **PII:** names/emails are shown (local, single user). Never log them in server logs.
- **Empty and error states:** every view says *why* it's empty, e.g. "No sync runs yet — use Refresh".

---

## 7. Views

### 7.1 Overview (`/`)
KPI tiles for the selected range:
- net revenue;
- the month with the largest change vs. the prior month;
- open exceptions count and $;
- % of Acuity bookings matched;
- last refresh (status, finished time, duration).

Each tile links to its detailed view.

### 7.2 Data-correctness views

| # | View | Content | Source |
|---|---|---|---|
| **V1** | **Sync runs** `/runs` | Table of `sync_run` (newest first): id, job, source, window, status, started/finished, duration, api_calls, rows new/changed/unchanged, error. Child steps nest under their parent `run`. Includes the **Refresh panel** (§8). | `runs_list.sql`, `run_detail.sql` |
| **V2** | **Coverage calendar** `/quality?tab=coverage` | GitHub-style heatmap per month: one cell per LA day, two rows (Acuity appointments, Square payments). Colour = count. **Zero-count days are outlined**, and Sundays/holidays can be dimmed via a simple weekday rule. Hover shows the counts. Clicking a day goes to the Inspector, filtered to that date. | `coverage_daily.sql` |
| **V3** | **Source totals vs reference** `/quality?tab=reference` | Per month: Acuity appointment count vs `data/acuity-exports/*.csv`; Square gross / refunds / fees vs `data/square-dashboard/*.csv`. Columns: ours, reference, Δ, Δ%. Red when Δ ≠ 0. Built on the existing `queries/validate/*.sql`. Reference CSVs are read server-side from `data/`; if missing, the column shows "no reference loaded". | `source_vs_reference_monthly.sql` + existing validate queries |
| **V4** | **Pipeline funnel & checks** `/quality?tab=pipeline` | Per entity: raw rows → staging rows → `transform_error` rows, with the gap highlighted. Below it, a pass/fail card per `queries/checks/*.sql` (rows returned, first 5 rows expandable). | `pipeline_funnel.sql` + run each check file |
| **V5** | **Reconciliation overview** `/reconciliation` | A stacked bar per month (matched / amount_mismatch / acuity_only / square_only, in $ and with a count toggle). Below it, a table by `reason_code` (count, $, % of side) and by `rule × confidence`. Clicking a segment opens V6, filtered. | `recon_overview_monthly.sql`, `recon_by_reason.sql` |
| **V6** | **Exceptions** `/exceptions` | Rows where `recon_status.exception = true`, filterable by side / status / reason / month. Expanding a row shows a **side-by-side card**: Acuity record ⇄ candidate/linked Square record(s), expected vs actual cents, Δ, and the link `evidence` JSON. | `exceptions.sql` (UI variant of the existing query) |
| **V7** | **Record Inspector** `/inspect?q=` | Accepts an Acuity appointment/order ID, Square payment/order/refund/invoice ID, certificate code or email. Shows, stacked: **raw payload** (collapsible JSON viewer, with `first_seen_at`, `last_seen_at`, `missing_since`); **version history** (from `raw_record_version`, with a diff of changed keys); **staging row(s)**; **recon links + status**. "Where did this number come from?" in one page. | `inspect_*.sql` |
| **V8** | **Spot-check sampler** `/sample` | 20 repeatable pseudo-random ledger rows (seeded by `?seed=`; "New sample" changes the seed). Each row has a ✓ / ✗ toggle, kept in `localStorage` only, plus links to open the record in the Acuity / Square web dashboards if the URL patterns are known (owner to confirm). | `sample_ledger.sql` (reuses `ledger.sql` logic + `--sample` approach) |

### 7.3 Customers

**Customer key** (computed in SQL, documented in `customers_list.sql`):
1. `client_email_norm` / `buyer_email_norm` when present → `key = 'e:' || email`
2. otherwise a Square `customer_id` → `key = 'sq:' || customer_id`
3. otherwise the row goes to a single **"Unidentified"** pseudo-customer, so its $ total stays visible

Display name: the most recent Acuity `client_name` for the key, otherwise the Square customer name from raw.

| # | View | Content |
|---|---|---|
| **C1** | **Customers** `/customers` | Search (name/email contains). Columns: name, email, first visit, last visit, bookings, attended, canceled, net paid, refunds, open exceptions, status (**active** <60 days since last visit, **lapsed** 60–180, **churned** >180, relative to the range end). Sortable; default sort net paid desc. |
| **C2** | **Customer detail** `/customers/[key]` | Header: totals as in C1, plus the codes/packages/memberships used. **Timeline** (newest first) merging Acuity appointments, Acuity orders, Square payments, refunds and invoices. Each row: date, type, description (class/instructor or line items), list price, charged, discount, tip, fee, refund, **match status chip**, link to the Inspector. Toggle: "show only unmatched". |

### 7.4 P&L (revenue only)

**P1 `/pnl?grain=month|year`**: one table with periods as columns (months, or years) and these rows:

| Line | Definition (cash basis, by payment / refund LA date) |
|---|---|
| Gross sales | Net sales + discounts |
| − Discounts | Square order discounts (`stg_square_order_discount.applied_cents`) + Acuity code discounts on **paid, linked** appointments (`stg_acuity_appointment.discount_cents`) |
| **= Net sales** | `stg_square_payment.amount_cents` for `COMPLETED` payments (+ non-Square Acuity payments, §9.3) |
| + Tips | `stg_square_payment.tip_cents` |
| − Refunds | `stg_square_refund.amount_cents` (`COMPLETED`), dated on the refund date |
| − Processing fees | `stg_square_payment.fee_cents` |
| **= Net revenue** | What the studio keeps before expenses |
| *Memo:* comps / 100% coupons | List price of bookings fully covered by a coupon/comp (`COUPON_FULL`, `FREE_TYPE`). **Not revenue**; shows what discounting costs |
| *Memo:* credits redeemed | Count of package/membership bookings (`PACKAGE_REDEMPTION`, `MEMBERSHIP`) |
| *Memo:* effective fee rate | fees ÷ net sales |

Then a **by-bucket** section (§9.2): net sales and net revenue per bucket, per period.

Each period also shows **Δ vs prior period** and **Δ vs same period last year** (blank when there's no data). The chart is a stacked bar of net revenue by bucket, with a net-sales line.

Year grain is **calendar year** (the fiscal calendar is out of scope).

---

## 8. Refresh

### 8.1 UX (on `/runs`, plus a "Refresh" button in the header that links there)
- **Range picker** with presets:
  - **Recent (−30 → +90 days)** (default): picks up new bookings, payments, late edits and refunds;
  - **This month**, **Last month**, **Custom**.
- Source is always **both** (the PRD's `run`). Advanced options: *Re-fetch all payments* (`--refresh-payments`) and *Re-fetch customers* (`--refresh-customers`).
- **Start** is disabled while a run is active, and shows who/when started it.
- **Live progress** (polls `GET /api/refresh/:id` every 2s): one row per step
  `extract acuity → extract square → transform → reconcile → check`
  with status (pending / running / done / failed), duration and the rows new/changed/unchanged for extract steps. Below the steps, the last 50 log lines (tail of the log file).
- **Cancel** sends `SIGINT` to the process. Extraction is resumable, so a cancelled run can simply be started again.
- **When it finishes:** a toast ("Refresh complete — 12 new, 3 changed; checks: 1 failing"), and every page's data reloads (`router.refresh()`).
- **Remote target safeguard:** when the target is `REMOTE`, Start asks for a typed confirmation of the host name.

### 8.2 Migration `apps/finance/db/migrations/0005_run_tracking.sql`
```sql
-- 0005: lets a UI-triggered `run` report progress and be detected as alive/stale.
ALTER TABLE finance.sync_run
  ADD COLUMN parent_run_id bigint REFERENCES finance.sync_run (id),  -- steps point at their `run`
  ADD COLUMN step_order    int,          -- 1..5 within a run, for display order
  ADD COLUMN triggered_by  text,         -- 'cli' | 'ui'
  ADD COLUMN params        jsonb,        -- {from, to, refreshPayments, …} as requested
  ADD COLUMN pid           int,          -- OS process id of the CLI (for cancel); null when finished
  ADD COLUMN log_path      text,         -- where stdout/stderr were written
  ADD COLUMN heartbeat_at  timestamptz;  -- bumped every ~10s while running
CREATE INDEX sync_run_parent_idx ON finance.sync_run (parent_run_id);
```
Also extend the status check: today it allows only `running`, `succeeded` and `failed`.
```sql
ALTER TABLE finance.sync_run DROP CONSTRAINT sync_run_status_check;   -- verify the actual constraint name first
ALTER TABLE finance.sync_run ADD CONSTRAINT sync_run_status_check
  CHECK (status IN ('running', 'succeeded', 'failed', 'canceled', 'completed_with_failures'));
```

### 8.3 CLI changes (`apps/finance/src/cli.ts` → `run`)
1. **New options:** `--triggered-by <cli|ui>` (default `cli`), `--refresh-payments`, `--refresh-customers`, `--log-path <path>`.
2. **Single-run lock:**
   - `SELECT pg_try_advisory_lock(hashtext('finance.run'))` on a dedicated client held for the whole run.
   - If it returns false, exit with code **75** and the message "another run is in progress". No `sync_run` row is created.
   - Why an advisory lock: Postgres releases it automatically if the process dies, so a crash can never leave a stuck lock.
3. **Tracking:**
   - Insert a parent `sync_run` row (`job='run'`, `pid=process.pid`, params, `triggered_by`).
   - Print **`RUN_ID=<id>`** as the first stdout line, so the UI learns the id.
   - Each step creates a child row (`parent_run_id`, `step_order`) and finishes it with its counts/status.
   - Existing extract/transform/reconcile code keeps writing its own `sync_run` rows. Link those to the step via `parent_run_id` where it's simple; otherwise the step row carries the totals.
4. **Heartbeat:** a `setInterval` updates the parent's `heartbeat_at` every 10s and is cleared in `finally`.
5. **Signals:**
   - On `SIGINT`/`SIGTERM`: stop after the current page/step, mark the current step and the run `canceled`, release the lock, exit 130.
   - On error: mark them `failed` with the message.
6. **Checks:** a failing check marks the `check` step `failed` but the run `completed_with_failures` (data was still refreshed), with exit code 1.

### 8.4 API (`apps/finance-web/src/app/api/refresh/…`, server-only)

| Route | Behaviour |
|---|---|
| `POST /api/refresh` body `{from, to, refreshPayments?, refreshCustomers?}` | 1. **Guards:** reject unless `FINANCE_WEB_ALLOW_REFRESH=true` **and** the request `Host` is `127.0.0.1`/`localhost` (403 otherwise). 2. Validate the body with zod (valid dates, `from ≤ to`, range ≤ 400 days). 3. Return 409 with the active run id if a parent run is `running` with a heartbeat < 60s old. 4. Spawn `npm run --silent finance -- run --from … --to … --triggered-by ui --log-path …` from the repo root with `detached: true`, `stdio` → `apps/finance/out/logs/run-<timestamp>.log`, then `child.unref()`. 5. Wait up to 10s for `RUN_ID=` in the log, then return `202 {runId}`. If the process exits early with 75, return 409. |
| `GET /api/refresh/:id` | The parent row + child steps + the last 50 log lines. Derived `state`: `running` / `stale` (status running but heartbeat > 60s old, i.e. it crashed) / final status. |
| `POST /api/refresh/:id/cancel` | Same guards. `process.kill(pid, 'SIGINT')` only if the row is running **and** `triggered_by='ui'`, and the pid's command line contains `cli.ts` (avoid signalling a reused pid). |

**Why not run the pipeline inside the API route:** the run takes minutes. A request handler would time out, tie up the dev server, and die on hot reload. A detached process avoids all of that, and it's the same process a future scheduled job will run.

---

## 9. Data rules the UI depends on

### 9.1 Read-only access
`lib/sql.ts` runs every UI query inside `BEGIN READ ONLY … ROLLBACK`, with a `statement_timeout` of 15s. The UI can't change data even through a buggy query.

### 9.2 Revenue buckets: `queries/ui/revenue_bucketed.sql`
**The single place revenue is classified.** P&L, customer totals and the Overview all select from it. One row per COMPLETED Square payment (plus non-Square Acuity payments), with `bucket` decided **in this order**:

| Bucket | Rule |
|---|---|
| `membership` | `acuity_ref_kind = 'subscription'`, or linked to an Acuity order/certificate whose product is a membership, or a Square invoice (`invoice_id` not null), or any payment linked to an appointment with `certificate_kind = 'membership'` |
| `package` | linked to an Acuity order/certificate whose product is a package/credit pack |
| `gift_certificate` | linked to an Acuity order/certificate of kind `gift` |
| `drop_in` | linked (`recon_link`) to an Acuity appointment and none of the above |
| `retail` | everything else (POS line items, no Acuity reference) |

The bucket rules are a SQL `CASE` with comments. Claude Code verifies them against probe findings and lists any rule it had to change.

### 9.3 Non-Square Acuity payments
`stg_acuity_payment` rows with `processor <> 'square'` (e.g. cash) are money that never touches Square. Include them in net sales, under bucket by the same rules, with **`source = 'acuity_other'`**, so they can be filtered out. **Owner to confirm** (§12).

### 9.4 Leaving room for expenses
`pnl.sql` builds the P&L from a `lines` CTE of `(period, line_key, cents)`. Adding expenses later is one more `UNION ALL` from a future `finance.expense` table. The UI renders lines generically from a line-definition list (key, label, sign, order, section). Expenses then need no UI rewrite.

---

## 10. Config

**One env file for both apps.** finance-web loads **`apps/finance/.env`**, the same file the CLI uses. It does this with `dotenv` in `lib/db.ts` and the `dev` script, using the path from `FINANCE_ENV_FILE`. The UI and the pipeline it spawns can therefore never point at different databases.

`apps/finance-web/.env.example` (new) holds only UI-specific settings:
```bash
FINANCE_ENV_FILE=../finance/.env       # DB URL, SSL, REPORTING_TZ, SEED_START/END come from here
FINANCE_WEB_ALLOW_REFRESH=true         # false = UI is view-only
FINANCE_REPO_ROOT=../..                # where `npm run finance -- run` is executed
```
- The UI reuses the pipeline's variable names (`FINANCE_DATABASE_URL`, `FINANCE_DB_SSL`, `FINANCE_DB_SSL_CA`, `REPORTING_TZ`, `SEED_START`, `SEED_END`).
- **Before writing `lib/db.ts`, check `apps/finance/src/config.ts` for the exact names.**
- If a local/remote env split is added to the pipeline later, finance-web follows it by changing `FINANCE_ENV_FILE`.

---

## 11. Non-functional requirements

| Area | Requirement |
|---|---|
| Correctness | All aggregation in SQL. Money stays in cents strings → `BigInt`. **P&L 2020 net sales, refunds and fees must equal `queries/validate/square_monthly_gross.sql` to the cent**, enforced by a test. |
| Performance | Each page renders in < 1.5s on the 2020 dataset (local DB). Add indexes in `0005` if a UI query needs them (`EXPLAIN` in the PR). |
| Safety | Server binds to `127.0.0.1` only. Refresh guarded per §8.4. Any `pg`/`fs`/`child_process` code is server-only (`import "server-only"`). No secrets or PII reach client bundles or logs. |
| Testing | Unit: `formatCents`, URL param parsing, refresh guards (host, flag, 409 logic, stale detection). SQL: each `queries/ui/*.sql` runs against a seeded test DB and its totals tie out (bucket totals = net sales; customer totals = ledger totals). CLI: lock contention (second `run` exits 75), SIGINT → `canceled`. |
| Code quality | Comments explain *why* (junior-friendly). Each PR lists new files at the top. |

---

## 12. Open questions

1. **Non-Square Acuity payments** (cash/other): include them in revenue as `acuity_other` (proposed), or exclude them?
2. **Bucket rules:** does any membership revenue arrive in a way §9.2 misses, e.g. Square-native subscriptions without invoices?
3. **Month boundaries:** the probe noted the Square location timezone. Confirm the Square dashboard reference CSVs use LA months, so V3 compares like for like.
4. **Deep links:** the URL patterns for opening an appointment in Acuity and a payment in the Square dashboard (V8). If unknown, V8 shows IDs only.
5. **Lapsed/churned thresholds** (60 / 180 days): OK?

---

## 13. Phases & acceptance criteria

Claude Code: **one phase per PR; stop for owner review after Phase 2.**

| Phase | Deliverable | Done when |
|---|---|---|
| **1. Scaffold** | `packages/sql-file` refactor; `apps/finance-web` with layout, nav, target badge, date-range header, `lib/*`, DataTable/Money components; Overview with placeholder tiles | `npm test -w apps/finance` still passes; `npm run finance-web` serves on 127.0.0.1:3100 only; target badge correct when `apps/finance/.env` points at local vs remote |
| **2. Runs + Refresh** | `0005` migration; CLI `run` changes; API routes; `/runs` with live progress and cancel | Start a recent-window refresh from the UI and watch the steps complete. A second Start returns 409. Killing the CLI with `kill -9` shows `stale` within 60s, and a new run can start. Cancel → `canceled`, and re-running finishes the job. `npm run finance -- run` from a terminal still works. |
| **3. Data correctness** | V2–V8 + their SQL | Coverage shows no unexplained zero days for Mar–Dec 2020. V3 shows Δ = 0 for Square gross/fees/refunds, or each Δ is explained. Every ID links to the Inspector. The Inspector resolves all ID types listed in V7. |
| **4. Customers** | C1, C2 | Sum of C1 net paid = net sales for the range (plus "Unidentified"). Every timeline row links to the Inspector. |
| **5. P&L** | `revenue_bucketed.sql`, `pnl.sql`, P1 | The cent-for-cent tie-out test passes; bucket totals sum to net sales; month and year grains agree. |
| **Later** | Manual-override editor on V6 (writes `recon_manual_override`), expenses table + entry form, hosting + auth, scheduled refresh | Separate PRD |

---

## 14. Instructions for Claude Code

- Read this PRD and `PRD-finance-ledger.md` first. Inspect the **actual** tables in `apps/finance/db/migrations` and the existing `queries/` before writing SQL; this PRD names columns as of 2026-10-16.
- Don't import `apps/finance/src` into `apps/finance-web`. Use the three-part contract in §4.
- No ORM. Use `pg` + `.sql` files only.
- Keep queries in `apps/finance/queries/ui/` so they also run from the CLI. Each starts with `-- params:` and a comment block explaining its grain and gotchas.
- If a probe finding or the existing schema contradicts this PRD, stop and update the PRD (or ask) before building on the assumption.

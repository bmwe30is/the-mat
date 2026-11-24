# PRD — Finance Ledger: Acuity + Square Ingestion & Reconciliation

**Status:** v3 · 2026-10-16. Phases 1–7 built and passing their automated acceptance checks. **Owner close-out items are in §16.**
**Owner:** Jonathan
**Implementer:** Claude Code
**Location in repo:** `docs/finance/PRD-finance-ledger.md`
**Background (not binding):** `docs/acuity-square-sheets-sync-spec.md` (v4, Sheets/Apps Script). This PRD **starts fresh**. Business rules from v4 (accrual, fiscal calendar, memberships) are **out of scope** here and may come back in a later PRD.

**Changes from v2** (from the Phase 2 probe — evidence in `docs/finance/probe-findings.md`)
- §1: discounts happen **in Acuity** (coupons and codes). There are no Square register sales or Square discounts in the data.
- §7.3: `stg_acuity_appointment` gains `list_price_cents` and `tip_cents`, and `price_cents` now means the price after a code. `certificate_kind` gains `certificate_deleted`. `stg_square_payment` gains parsed note-reference columns.
- §7.4: `recon_link.acuity_kind` gains `certificate` (membership charges).
- §8: Acuity is on LA time; the CSV's New York is the *client's* timezone. The Square **location** is on New York time.
- §9:
  - Rule 1 splits into 1a (Acuity `transactionID` = the Square payment id **or** order id) and 1b (the parsed Square note).
  - New reason codes: `CASH`, `MEMBERSHIP_CHARGE`, `NOT_COMPLETED` (failed or canceled Square payments) and `ACUITY_DISCOUNT`.
  - `TIP` now uses Acuity-side tips. `SQUARE_DISCOUNT` is kept but never seen in the data.
- §10: tips and discounts in the reports come from Acuity.
- §11.3: `SQUARE_LOCATION_ID` and `SQUARE_VERSION` filled in; warning about inline comments.
- §13: the Phase 4 gross check uses the Square dashboard's timezone.
- §14: Q1–8 resolved. Q9 resolved later (owner figures; probe data matches to the cent).
- §7.2 *(Phase 3 build)*:
  - `raw_record` gains `window_date`, which makes `missing_since` work for windowed entities.
  - `0002_raw.sql` also creates `transform_error`.
  - Acuity payment keys and volatile appointment fields are documented.
- §7.2 *(Phase 4 build)*:
  - The Square `invoice` entity is required, and invoices' orders are fetched too.
  - Customers come from bulk-retrieve.
  - The nightly job needs a lookback window.
- §9: rule 2 notes that 2020 Square payments have no email of their own.
- §9 *(Phase 6 build)*:
  - New subsections on scope and allocation.
  - New reason codes `ORDER_UNPAID`, `ORDER_NO_SQUARE`, `ORDER_CHARGED_LESS` and `CLASS_OUTSIDE_WINDOW`, plus the `recon_status.exception` column.
  - `PAID_NO_SQUARE` takes priority over every "no payment expected" reason.
- §14 Q6 corrected: one Square payment can cover several appointments.
- §16 *(new)*: the owner close-out checklist. It covers:
  - the ledger spot-check;
  - the exception review, with every id;
  - privacy checks;
  - committing the work;
  - extending past 2020;
  - nightly job and dashboard decisions.
- §10 *(Phase 7 build)*:
  - The five reports are built. Each file's header documents its columns and date basis.
  - `revenue_daily` puts bookings by class date and money by payment date. Its monthly `square_collected` equals the dashboard to the cent.
  - New `query --sample <n>` makes the ledger spot-check repeatable.
  - §14 Q12 records the owner's exception review as a non-blocking to-do.
- §7.3 *(Phase 5 build)*:
  - New `stg_square_invoice` table and new `code_extra_paid_cents` column; tips only count when no code was used.
  - Rows flagged `missing_since` are kept in staging.
  - The loader deletes and reloads staging in one transaction.
  - Square customers come from orders too, and merged customers are followed through `customer_alias` raw rows.
  - Acuity payments can be negative (refunds/adjustments recorded in Acuity).

**Changes from v1**
- A **new, dedicated Supabase project** replaces the shared the-mat database.
- **No Prisma.** Migrations are plain `.sql` files, applied by a small runner, and queries go through `pg` (node-postgres).
- **Report queries are `.sql` files** run from the CLI, so reports can be tuned without migrations.
- `packages/finance-db` and `packages/db` are dropped.

---

## 1. Problem

The studio books classes in **Acuity** and collects money in **Square**. Normally each paid Acuity appointment has a matching Square transaction, but the data is fragmented:

- Coupons and package/membership credits produce Acuity bookings with **no** Square transaction.
- Discounts are applied **in Acuity** with codes (coupons, packages, gift certificates, memberships), so the amount charged differs from the class's list price. Tips are also collected in Acuity and folded into the charge. *(v2 assumed manual discounts at the Square register; the probe found no register sales and no Square discounts — probe Q4/Q5.)*
- Some Square sales have **no** Acuity booking: membership subscription charges, package/gift orders, and Square Invoices (e.g. payment-plan memberships).
- Some Acuity payments are **cash** and never reach Square.

As a result, no single place answers "what did we earn, and where are the gaps?"

## 2. Goals

1. **Ingest** every relevant record from both APIs into a new Postgres database, keeping the full original payload so nothing is lost and everything can be re-processed.
2. **Normalize** raw records into typed tables. Money is in integer cents, timestamps are in UTC, and each row gets a studio-local reporting date.
3. **Reconcile** Acuity ⇄ Square with explicit, explainable rules. Every record ends up matched, or unmatched with a **reason code**.
4. **Tune reporting quickly.** Reports are plain `.sql` files you can edit and re-run with one command. No migration or deploy is needed to change a report.
5. Lay the groundwork for a **Node app** (`apps/finance`) that grows into the nightly sync service and dashboard API.

## 3. Non-goals (v1)

- Dashboard UI (decided later).
- Scheduled/nightly runs (design for it, don't deploy it).
- Accrual accounting, deferred revenue, fiscal calendar, membership revenue allocation.
- Writing to Acuity or Square. Access is **read-only**.
- Any change to the-mat's existing database, Prisma schema or models.
- An ORM or query builder.

## 4. Decisions (owner, 2026-10-15)

| # | Decision |
|---|---|
| D1 | **New Supabase project** (Postgres) dedicated to finance. It's separate from the-mat app database. |
| D2 | **No Prisma / ORM.** Schema lives in numbered **plain SQL migration files**, applied by a small in-repo runner. DB access goes through **`pg`** with parameterized SQL. |
| D3 | Runtime: **TypeScript Node app** at `apps/finance`, built to be extended (CLI now, service later) |
| D4 | Repo: the-mat becomes an **npm-workspaces monorepo** (`apps/web`, `apps/finance`) |
| D5 | **Transforms and reconciliation are written in TypeScript** as pure, unit-tested functions. SQL handles storage and reporting. |
| D6 | **Report queries are `.sql` files** in `apps/finance/queries/`, run with `npm run finance -- query <file>` |
| D7 | Seed window: **2020-03-01 → 2020-12-31**, configurable |
| D8 | Reporting timezone: **America/Los_Angeles**. Acuity and Square represent time differently (§8). |
| D9 | Dashboard **deferred** |
| D10 | Historical seed comes from the **APIs only**. The CSV exports are used **only to validate** counts. |
| D11 | *(2026-10-16, after probe)* Apply the probe findings: Acuity-side discounts and tips, note-based linking, `CASH` and `MEMBERSHIP_CHARGE` reason codes (see "Changes from v2"). |

---

## 5. Architecture

```
                 TypeScript (apps/finance)                                         SQL files (apps/finance/queries)
 Acuity API ─┐   ┌──────────┐                 ┌────────────┐                ┌────────────┐                 ┌──────────────┐
             ├──►│ extract  │──► raw_record ──►│ transform  │──► stg_* ──────►│ reconcile  │──► recon_* ─────►│ query *.sql  │──► console / CSV
 Square API ─┘   └──────────┘   (jsonb, all    └────────────┘   (typed)      └────────────┘   (links +       └──────────────┘
                  idempotent,    records)        pure fns,                     pure fns,       status +
                  resumable                      rebuildable                   rebuildable     manual overrides)
```

This is **ELT** in three layers:

| Layer | Tables | Rule |
|---|---|---|
| Raw | `raw_record`, `raw_record_version` | Exactly what the API returned. Never hand-edited. |
| Staging | `stg_*` | Derived **only** from raw by `transform`. It can be wiped and rebuilt at any time. |
| Reconciliation | `recon_*` | Derived from staging by `reconcile`, **except** `recon_manual_override`, which is human-owned and never overwritten |
| Reporting | `queries/*.sql` | Read-only SELECTs over staging and recon. Edit and re-run freely. |

**Why this shape:** a mistake in a transform, a matching rule or a report is fixed by changing code or SQL and re-running from raw. The APIs are never re-fetched, and no number is ever hand-edited.

**The tuning loop this enables:**
```bash
npm run finance -- query queries/recon_summary_monthly.sql --from 2020-03-01 --to 2020-06-30   # look
# edit queries/recon_summary_monthly.sql …
npm run finance -- query queries/recon_summary_monthly.sql --from 2020-03-01 --to 2020-06-30   # look again
# if the fix belongs in matching logic instead:
npm run finance -- reconcile && npm run finance -- query queries/exceptions.sql --csv
```

---

## 6. Repository layout

**New and moved files.** ⚠️ = moves existing code.

```
the-mat/
├─ package.json                  # NEW root: "private": true, "workspaces": ["apps/*"]
├─ tsconfig.base.json            # NEW shared compiler options
├─ .gitignore                    # EDIT: add data/, out/, *.csv
├─ data/acuity-exports/          # NEW (gitignored). Move tejal-acuity-*.csv here (contains PII)
├─ docs/finance/PRD-finance-ledger.md
└─ apps/
   ├─ web/                       # ⚠️ existing Next.js app moved here unchanged, incl. its prisma/ folder
   └─ finance/                   # NEW Node app
      ├─ package.json
      ├─ tsconfig.json
      ├─ .env.example
      ├─ db/
      │  └─ migrations/          # NEW numbered plain-SQL migrations (forward-only)
      │     ├─ 0001_schema_and_ops.sql      # finance schema, schema_migrations, sync_run, sync_cursor
      │     ├─ 0002_raw.sql                 # raw_record, raw_record_version, transform_error
      │     ├─ 0003_staging.sql             # stg_* tables
      │     └─ 0004_recon.sql               # recon_* tables
      ├─ queries/                # NEW report SQL, edited freely (no migration needed)
      │  ├─ ledger.sql
      │  ├─ recon_summary_monthly.sql
      │  ├─ exceptions.sql
      │  ├─ revenue_daily.sql
      │  ├─ discount_impact.sql
      │  └─ checks/              # data-quality checks (row counts, orphans, sums); used by `check`
      ├─ src/
      │  ├─ cli.ts               # commander: migrate | probe | extract | transform | reconcile | query | check | run
      │  ├─ config.ts            # zod-validated env
      │  ├─ db/
      │  │  ├─ pool.ts           # single pg Pool; withTransaction() helper
      │  │  ├─ migrate.ts        # applies db/migrations in order, records checksum
      │  │  └─ sql-file.ts       # loads queries/*.sql, binds :named params safely (§11.2)
      │  ├─ lib/
      │  │  ├─ http.ts           # fetch wrapper: rate limit, retry with backoff, logging
      │  │  ├─ money.ts          # "25.00" → 2500 cents (no floats); Square Money → cents
      │  │  ├─ time.ts           # timezone helpers (§8)
      │  │  ├─ hash.ts           # stable JSON hash for change detection
      │  │  └─ logger.ts         # pino
      │  ├─ sources/
      │  │  ├─ acuity/{client.ts, extract.ts, types.ts}
      │  │  └─ square/{client.ts, extract.ts, types.ts}
      │  ├─ raw/repo.ts          # upsert raw_record + versioning (SQL lives here)
      │  ├─ transform/{acuity.ts, square.ts, load.ts}   # pure mappers + batched loader
      │  ├─ reconcile/{rules.ts, classify.ts, run.ts}   # pure rules + orchestrator
      │  └─ probe/probe.ts
      └─ test/                   # vitest; fixtures/ holds recorded, PII-scrubbed API responses
```

The-mat's existing Prisma setup stays **inside `apps/web`** and is untouched. The finance app has no dependency on it.

### Dependencies (apps/finance)
| Package | Why |
|---|---|
| `pg` + `@types/pg` | Postgres driver. All SQL is parameterized (`$1, $2…`) and never string-concatenated. |
| `commander` | CLI |
| `zod` | Validate env and the API payload shapes used by transforms |
| `pino` (+ `pino-pretty` dev) | Structured logs (already used in repo) |
| `date-fns-tz` *or* `@js-temporal/polyfill` | Timezone conversion. Pick one and document why. |
| `csv-stringify` | `query --csv` output |
| `cli-table3` (or `console.table`) | `query` console output |
| `dotenv` | Local env loading |
| dev: `typescript`, `tsx`, `vitest`, `msw` | Build, run, test with mocked HTTP |

Use **native `fetch`** (Node 22) with thin typed clients for both APIs. Don't use the Square SDK; only a handful of endpoints are needed. **Pin the `Square-Version` header** in config.

---

## 7. Data model (`finance` schema, new Supabase project)

Conventions:
- All money is **`bigint` cents**.
- All instants are **`timestamptz` (UTC)**.
- Every staging row carries `local_date` (studio-local `date`).
- Everything lives in a **`finance`** schema, which is **not** exposed through Supabase's Data API (§12).

### 7.1 Migrations (no ORM)

- Files are named `NNNN_description.sql` and applied in order by `npm run finance -- migrate`.
- `finance.schema_migrations(filename text pk, checksum text, applied_at timestamptz)` records what ran.
- Each file runs inside **one transaction**: all or nothing.
- The runner **refuses to continue** if an already-applied file's checksum has changed. To change applied SQL, write a new migration instead.
- Forward-only. For local resets, `migrate --reset` drops and recreates the `finance` schema, behind an interactive confirmation plus `--yes`.

### 7.2 Raw layer

```sql
-- db/migrations/0002_raw.sql (sketch; Claude Code finalizes)

-- One row per source object: the single table that stores every record from both APIs.
CREATE TABLE finance.raw_record (
  id                  bigserial PRIMARY KEY,
  source              text        NOT NULL CHECK (source IN ('acuity','square')),
  entity              text        NOT NULL,            -- 'appointment', 'appointment_payment', 'payment', 'order', 'refund', ...
  external_id         text        NOT NULL,            -- the source system's id
  parent_external_id  text,                            -- e.g. Acuity appointment id for an appointment_payment
  payload             jsonb       NOT NULL,            -- full API object, untouched
  payload_hash        text        NOT NULL,            -- sha256 of canonical JSON; unchanged hash = skip write
  source_created_at   timestamptz,
  source_updated_at   timestamptz,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  window_date         date,                            -- (v3) LA date the extract window selects by, e.g. an appointment's class date
  missing_since       timestamptz,                     -- set when a re-pulled window no longer returns it
  last_sync_run_id    bigint      NOT NULL REFERENCES finance.sync_run(id),
  UNIQUE (source, entity, external_id)                 -- the upsert target
);
CREATE INDEX raw_record_entity_created_idx ON finance.raw_record (source, entity, source_created_at);
CREATE INDEX raw_record_payload_gin        ON finance.raw_record USING gin (payload jsonb_path_ops); -- ad-hoc JSON queries

-- Previous payload whenever payload_hash changes: audit trail for refunds, reschedules, edits.
CREATE TABLE finance.raw_record_version (
  id             bigserial PRIMARY KEY,
  raw_record_id  bigint      NOT NULL REFERENCES finance.raw_record(id),
  payload        jsonb       NOT NULL,
  payload_hash   text        NOT NULL,
  superseded_at  timestamptz NOT NULL DEFAULT now()
);
```

**Upsert behaviour** (`raw/repo.ts`), applied in batches of about 500 using `INSERT … ON CONFLICT (source, entity, external_id) DO UPDATE`:
- **New row:** insert it.
- **Same hash:** only bump `last_seen_at` and `last_sync_run_id`.
- **Different hash:** copy the old payload into `raw_record_version`, then update.

The CLI reports `new / changed / unchanged` counts.

**Implementation notes (v3)**
- **`missing_since`:** set only after a scope has been fully re-pulled, and cleared when the row is seen again. Nothing is deleted. The scope is one of:
  - for windowed entities, the rows whose `window_date` falls in the re-pulled (padded) window;
  - for full-pull entities (orders, certificates, lookups), the whole entity;
  - for Acuity payments, the appointments whose payments were re-fetched.
- **Acuity `appointment_payment`:** these objects have no id. `external_id` = `<appointmentId>:<created>:<processor>:<amount>`, with `#2`, `#3`… added if two are identical. `parent_external_id` = the appointment id.
- **Payment lookups:** made only for paid appointments that are new or changed in this run, or that have no payment stored yet. `--refresh-payments` forces all of them.
- **Square:**
  - Payments and refunds are windowed by the LA date of `created_at`, using the same padded monthly chunks as Acuity. **All statuses are kept.**
  - Orders are fetched by id for the run's new or changed payments and invoices, plus any order not yet stored.
  - An id Square doesn't return gets `missing_since` if a row for it is already stored. Square keeps no order for a FAILED card attempt (18 in 2020).
  - `queries/checks/square_completed_payment_without_order.sql` guards the case that matters: a COMPLETED payment with no order.
- **Nightly job (future):** Square payments change after their creation month (refunds update `refunded_money`), and a re-pull only sees that if it covers the creation month. The nightly job must therefore re-pull a **lookback window** of recent months, not just "yesterday".
- **Volatile fields:** `canClientCancel` and `canClientReschedule` are left out of an appointment's `payload_hash`. They flip by themselves as the cancel cutoff passes, which would otherwise create meaningless versions. The full payload is still stored.

**Ops tables** (`0001`):
- `sync_run`: id, job, source, window_start, window_end, status, started_at, finished_at, api_calls, rows_new, rows_changed, rows_unchanged, error
- `sync_cursor`: key pk, value, updated_at

**Entities to land:**

| Source | Entity | Endpoint (verified in the Phase 2 probe, except Square invoices) |
|---|---|---|
| Acuity | `appointment` | `GET /api/v1/appointments` (`minDate`, `maxDate`, `max`, `showall=true`, `excludeForms=true`) |
| Acuity | `appointment_payment` | `GET /api/v1/appointments/{id}/payments` (only for appointments with amount paid > 0) |
| Acuity | `order` | `GET /api/v1/orders` (packages, gift certificates, subscriptions) |
| Acuity | `certificate` | `GET /api/v1/certificates` (package / coupon / gift codes) |
| Acuity | `appointment_type`, `calendar`, `product` | lookups |
| Square | `payment` | `GET /v2/payments` (`begin_time`, `end_time`, `location_id`, `cursor`, `limit=100`) |
| Square | `refund` | `GET /v2/refunds` (same windowing) |
| Square | `order` | `POST /v2/orders/batch-retrieve` for each payment's `order_id` (line items live here; in practice one custom-amount line item per order, no discounts) |
| Square | `customer` | `POST /v2/customers/bulk-retrieve` for customers referenced by payments or invoices and not yet stored. **2020 payments carry no `customer_id` or email**; only invoice recipients do. |
| Square | `invoice` | `POST /v2/invoices/search`, filtered to the location. **Required (v3, owner: "don't lose track of any transaction data").** It has no date filter, so it's a full pull every run. Each invoice's order is fetched too, so unpaid or scheduled invoices are tracked before any payment exists. |

### 7.3 Staging layer (written by `transform`, rebuilt from raw)

| Table | Key columns |
|---|---|
| `stg_acuity_appointment` | `appointment_id` PK, `starts_at`, `local_date`, `source_tz` (= `calendarTimezone`), `type_id`, `type_name`, `calendar_id`, `calendar_name` (instructor), `client_email_norm`, `client_name`, `list_price_cents` (from `priceSold`), `price_cents` (from `price`: the price **after** any code), `discount_cents` (= list − price), `amount_paid_cents`, `tip_cents` (= `amount_paid − price` when positive **and no code was used**, else 0), `code_extra_paid_cents` (= `amount_paid − price` when positive **and a code was used**: possibly a gift card or prepayment, never a tip — owner, Phase 5), `paid`, `certificate_code`, `certificate_kind` (membership / package / gift / coupon / certificate_deleted / null), `is_canceled`, `no_show`, `booked_at`, `labels text[]` |
| `stg_acuity_payment` | `acuity_payment_key` PK, `appointment_id`, `processor` (`square` / `cash` / …), `processor_txn_id` (Acuity `transactionID`: the Square **order id** in 2020, the Square **payment id** in recent years; empty for cash), `amount_cents`, `paid_at`, `local_date`, `related_payments_count` |
| `stg_acuity_order` | `order_id` PK, `ordered_at`, `local_date`, `total_cents`, `status`, `title`, `client_email_norm` |
| `stg_square_payment` | `payment_id` PK, `created_at`, `local_date`, `status`, `amount_cents`, `tip_cents`, `total_cents`, `refunded_cents`, `fee_cents` (sum of `processing_fee[]`), `source_type`, `order_id`, `customer_id`, `buyer_email_norm`, `note`, `reference_id`, `square_product` (`application_details.square_product`: `ECOMMERCE_API` = Acuity, `INVOICES`, …), `acuity_ref_kind` (appointment / order / subscription / dated / empty / other — from `parseSquareNote()`, §9 rule 1), `acuity_ref` (the parsed appointment id, order id or subscription id), `acuity_certificate_code` (subscription notes only) |
| `stg_square_order` | `order_id` PK, `created_at`, `total_cents`, `discount_cents`, `tax_cents`, `tip_cents`, `line_item_summary`, `invoice` (bool: order source is Square Invoices) |
| `stg_square_order_discount` | `order_id`, `discount_uid`, `name`, `type`, `scope`, `applied_cents` |
| `stg_square_refund` | `refund_id` PK, `payment_id`, `created_at`, `local_date`, `amount_cents`, `status`, `reason` |
| `stg_square_invoice` | *(v3, Phase 5)* `invoice_id` PK, `order_id`, `invoice_number`, `title`, `status` (PAID / UNPAID / SCHEDULED / CANCELED / …), `created_at`, `local_date`, `due_date`, `requested_cents`, `paid_cents`, `customer_id`. Keeps unpaid invoices visible in reports. |

Every `stg_*` row also has `raw_record_id`, so any number traces back to its source payload, and `missing_since` copied from raw. Rows the API stopped returning are **kept** in staging with that flag set, never dropped (owner, Phase 5).

**How `transform` works (TypeScript):**
1. Stream `raw_record` rows for an entity with a server-side cursor or keyset pagination, so memory stays flat.
2. Map each payload through a **pure function**, e.g. `toStgAcuityAppointment(payload, ctx) → row | TransformError`. These are unit-tested with fixtures.
3. Write to the staging table. **Chosen:** delete and reload every selected staging table in **one transaction** (`src/transform/load.ts`). At this volume it takes about a second, it's deterministic (identical checksums on re-run, `queries/validate/staging_checksums.sql`), and readers keep seeing the old data until COMMIT. `transform --entity <source.entity>` rebuilds one table.
4. Log rows that fail the payload's zod shape into `finance.transform_error` (raw_record_id, entity, message). Never drop them silently.

`client_email_norm` = `lower(trim(email))`. It's the main fuzzy-match key.

**Mapping rules confirmed by the probe**
- **`certificate_kind`:** look the code up in `/certificates` (case-insensitive) and map `productType`: `Subscription` → membership, `Package` → package, `Gift Certificate` → gift. If the code isn't there: an 8-character hex code is an Acuity-generated certificate that no longer exists (`certificate_deleted`); anything else is a `coupon`. The `/certificates` lookup is a transform input, so `transform` loads the `certificate` raw records first.
- **Price fields:** `paid = yes` with `amountPaid = 0` is normal for a full redemption. Use amounts, not `paid`, to decide whether money moved.
- **Never log `note`.** 2020-era Square notes contain client names.
- **Negative Acuity payments are real:** staff record refunds and adjustments in Acuity this way. Example: −$18 cash then +$18 cash on a canceled class on 2020-06-10 (the only one in 2020). They're kept, and reconciliation accounts for them.
- **Square customers:**
  - Square merges duplicate customer profiles. Asking for a merged-away id returns the surviving profile under a different id, and extract records that link as a `customer_alias` raw row.
  - Square returns `segment_ids` in random order, so they're sorted before hashing.

### 7.4 Reconciliation layer (written by `reconcile`)

| Table | Owner | Purpose |
|---|---|---|
| `recon_link` | auto (rebuilt each run) | `acuity_kind` (appointment / order / certificate — certificate = a membership subscription charge), `acuity_id`, `square_payment_id`, `rule`, `confidence`, `allocated_cents`, `evidence jsonb` (which fields matched). Supports **one Square payment → many appointments**; allocated amounts must add up to the payment. |
| `recon_manual_override` | **human** | `acuity_kind`, `acuity_id`, `square_payment_id` (nullable = "no payment expected"), `reason_code`, `note`, `created_at`. Applied **first**; never written by the job. Rows are added with plain SQL `INSERT` (example in `queries/README.md`). |
| `recon_status` | auto | One row per Acuity record **and** per Square payment: `side`, `id`, `local_date`, `status` (`matched` / `amount_mismatch` / `acuity_only` / `square_only` / `not_applicable`), `reason_code`, `expected_cents`, `actual_cents`, `delta_cents` |

---

## 8. Time handling (critical — read before writing any date code)

Acuity and Square represent time differently. Treating them the same causes wrong-day revenue and missed matches around midnight.

| | Acuity | Square |
|---|---|---|
| Timestamp format | Local time **with offset**, e.g. `2020-03-02T09:00:00-0800`. The account and all calendars are **`America/Los_Angeles`** (probe Q3). The CSV's `Timezone` column (often `America/New_York`) is the **client's** timezone, not the studio's. | RFC 3339 in **UTC**, e.g. `2020-03-02T17:00:00Z`. Note: the Square **location** timezone is **`America/New_York`**, so the Square dashboard may bucket days and months in Eastern time. |
| Query filters | `minDate`/`maxDate` are **dates** on the calendar's local (LA) date (confirmed in probe) | `begin_time`/`end_time` are **instants** (RFC 3339) |
| Default lookback | — | `ListPayments` defaults to **1 year back** if `begin_time` is omitted. Always pass it. |

**Rules**
1. **Store instants, not wall-clock times.** Parse every source timestamp, with its offset or `Z`, into `timestamptz`. Never strip the offset. The original string remains in `payload`.
2. **Derive `local_date` in exactly one place** (`lib/time.ts`). SQL reports that need it from a raw instant use `(ts AT TIME ZONE 'America/Los_Angeles')::date`, but should prefer the stored `local_date`.
3. **Record `source_tz`** on Acuity rows, so mismatches with LA are visible.
4. **Pad extraction windows** by ±1 day on both APIs, then filter by `local_date` after transforming. This avoids losing records at window edges.
5. **Seed window config (`SEED_START`, `SEED_END`)** is in **LA local dates, inclusive**. Convert it to UTC instants for Square and to padded dates for Acuity.
6. **DST:** never add "24 hours" to step through days. Step through local dates and convert each one.
7. **Matching time windows** compare instants, never local strings.
8. **Set the DB session timezone to UTC** in `pool.ts` (`SET TIME ZONE 'UTC'` on connect). Supabase defaults to UTC, but be explicit.
9. **Unit tests required:** a booking at 11:30 PM PT on the last day of a month, the DST-transition Sundays (2020-03-08, 2020-11-01), and an Acuity row with an Eastern offset.

---

## 9. Reconciliation rules (TypeScript, `reconcile/rules.ts`)

Each rule is a pure function over in-memory staging rows: `(candidates, ctx) → Link[]`. Rules run in order; the first rule that claims a pair wins. A claimed record isn't reused by later rules unless it's a declared 1→N payment.

| # | Rule | Confidence |
|---|---|---|
| 0 | `recon_manual_override` row exists | manual |
| 1a | **Acuity → Square ID link:** the Acuity payment's `processor_txn_id` equals the Square `payment_id` **or** the Square payment's `order_id` (Acuity stored the order id in 2020 and the payment id later — probe Q2) | high |
| 1b | **Square → Acuity ID link:** the Square note parses (`parseSquareNote()`, `src/sources/square/note.ts`) to an Acuity **appointment** id or **order** id that exists in staging. A **subscription** note with a certificate code links to that certificate (`acuity_kind = certificate`). | high |
| 2 | *(2020 Square payments have no `customer_id` or buyer email of their own, but **their orders do**. `buyer_email_norm` comes from the order's customer, following merged-customer aliases, which gives 671 of 899 completed 2020 payments an email. Rule 1a is still the primary 2020 link.)* Same `client_email_norm`, plus Square `amount` (Square never has `tip_money` here) equal to Acuity `amount_paid`, plus Square `created_at` within `MATCH_WINDOW_MINUTES` (default 15) of the Acuity payment time. The probe saw linked pairs created within 1 minute of each other. | medium |
| 3 | Same email + same `local_date` + **exactly one** candidate on each side; the amount may differ | low → `amount_mismatch` if delta ≠ 0 |
| 4 | Same amount + same `local_date` + exactly one candidate on each side, no email | low |
| — | No rule matched | unmatched → classify |

**Scope and allocation (v3, Phase 6 build)**
- **Matching** uses every staged record. **Statuses** are written only for records whose `local_date` is inside the reconcile window (`SEED_START`–`SEED_END`, or `reconcile --from/--to`). Appointments are dated by class date, orders by order date, Square payments by payment date.
- **Only COMPLETED Square payments take part in matching**; the rest get `NOT_COMPLETED`.
- **Allocation:**
  - A Square payment linked to **one** Acuity record allocates its whole amount to that record, so any difference shows up as an Acuity-side `amount_mismatch`.
  - A Square payment linked to several appointments by rule 1a (one checkout for several classes) is split by each appointment's Acuity payment amounts. 20 Square payments in 2020 cover 63 appointments, up to 8 each.
- **Expected Square money for an appointment** = the sum of its non-cash Acuity payments, including negative adjustments, or `amount_paid` if Acuity returned no payment records.
- **Certificates are never "claimed":** every monthly membership charge links to the same certificate.
- Unpaid Acuity orders (`status = unpaid`, i.e. abandoned checkouts) are left out of matching.

**Classifying unmatched records (`reason_code`, `reconcile/classify.ts`):**

*Acuity appointment with no Square payment.* **First rule:** if Square money is expected (see above), the reason is always `PAID_NO_SQUARE`, even when the booking is canceled or used a code. The "no payment expected" reasons below apply only when no Square money is expected, so a real gap can't hide behind them.
| Code | Condition |
|---|---|
| `CANCELED` | `is_canceled` |
| `CASH` | every Acuity payment on the appointment has `processor = cash` (never reaches Square) |
| `PACKAGE_REDEMPTION` | `certificate_kind` in (package, gift, certificate_deleted) and `amount_paid = 0` |
| `MEMBERSHIP` | `certificate_kind = membership`, or type name matches `MEMBERSHIP_TYPE_PATTERNS` |
| `COUPON_FULL` | `certificate_kind = coupon` and `amount_paid = 0` |
| `FREE_TYPE` | `price = 0` |
| `UNPAID` | `price > 0`, `paid = false`, not canceled |
| **`PAID_NO_SQUARE`** | `amount_paid > 0` and no match. **Real gap; goes on the exceptions list** |
| `UNKNOWN` | none of the above. **Goes on the exceptions list** |
| *(override)* | a `recon_manual_override` row with no `square_payment_id`: `not_applicable` with the override's `reason_code` |

*Acuity order with no Square payment:*
| Code | Condition |
|---|---|
| `ORDER_UNPAID` | order `status = unpaid` (abandoned checkout; 7 in 2020, e.g. five $50 gift certificates on Dec 10–11). `not_applicable`. |
| `FREE_TYPE` | `total = 0` |
| **`ORDER_NO_SQUARE`** | paid order, `total > 0`, no match. **Goes on the exceptions list** |

*Square payment with no Acuity record:*
| Code | Condition |
|---|---|
| `ACUITY_ORDER` | matched to an Acuity **order** (package/gift/membership sale), not an appointment. Also used when the note says `Order #<id>` but `/orders` doesn't return that id (seen for 2 early-2020 orders); those rows **also** go on the exceptions list. |
| `MEMBERSHIP_CHARGE` | note kind is `subscription`: a recurring membership charge. Newer notes link to a certificate (rule 1b). 2020-era notes (`<id> (<plan>)`) have no code and stay unlinked with this reason. |
| `INVOICE` | `square_product = INVOICES` (e.g. payment-plan memberships) |
| `POS_RETAIL` | Square order has catalog line items and no Acuity reference (none seen in the probe; kept for the future) |
| `NOT_COMPLETED` | Square `status` is not `COMPLETED` (FAILED / CANCELED). No money moved, so these are `not_applicable`, not exceptions. |
| `CLASS_OUTSIDE_WINDOW` | 2020-era "dated" note names a class date outside the reconcile window, e.g. paid Dec 28 for a Jan 3 class. The appointment wasn't extracted, so this is explained, not an exception. |
| **`NO_ACUITY_REF`** | anything else. **Goes on the exceptions list** |

*Matched but amounts differ (`amount_mismatch`):*
| Code | Condition |
|---|---|
| `ACUITY_DISCOUNT` | Acuity `discount_cents` (list − price, from a code) explains the delta, i.e. the comparison used list price |
| `TIP` | delta equals the Acuity-side `tip_cents` (amount paid above price; probe found clusters at +10/15/20%). Square `tip_cents` is always 0 in this data. |
| `PARTIAL_REFUND` | delta equals the refunded amount |
| `SQUARE_DISCOUNT` | `stg_square_order.discount_cents` explains the delta (kept for the future; never seen in the probe) |
| `PRICE_OVERRIDE` | none of the above, but `price ≠ amount_paid` on the Acuity side |
| `UNKNOWN` | none of the above. **Goes on the exceptions list** |
| **`ORDER_CHARGED_LESS`** | *(orders)* Square charged **less** than the Acuity order total. Seen 8× in 2020: memberships at exactly half price, a $35 special at $26.25 (25% off), a $108 pack at $80. Probably checkout coupons, but the order API has no discount field to prove it. **Goes on the exceptions list** until the owner confirms (then add overrides). |
| *(Square side)* `LINKED_<KIND>` / `ALLOCATION_DIFFERS` | a matched Square payment's status reason: what it links to, or that its allocations don't add up to its amount |

`recon_status.exception` (boolean) marks the rows that go on the exceptions list: `PAID_NO_SQUARE`, `UNKNOWN`, `NO_ACUITY_REF`, `ORDER_NO_SQUARE`, `ACUITY_ORDER`, `ORDER_CHARGED_LESS`.

**Properties**
- **Deterministic:** running `reconcile` twice gives identical output. Ties are broken by stable sort on IDs.
- **Atomic:** `recon_link` and `recon_status` are deleted and rewritten in **one transaction**. Readers never see a half-built state.
- **Explainable:** every link stores its `rule` and an `evidence` JSON.
- **Tunable:** thresholds (`MATCH_WINDOW_MINUTES`, membership patterns) come from config, not code.

---

## 10. Reporting queries (`apps/finance/queries/`)

Plain `SELECT` files over `stg_*` and `recon_*`. **They aren't views**, so editing one never needs a migration. Once a query is stable and a dashboard needs it, it can be promoted to a view in a later migration.

| File | Grain | Answers |
|---|---|---|
| `ledger.sql` | one row per Acuity appointment, Acuity order, and Square payment | The single combined table: date, side, client, type, instructor, list price, charged, discount, tip, fee, refund, status, reason_code |
| `recon_summary_monthly.sql` | month × status × reason_code | Count and $. How big is each gap? |
| `exceptions.sql` | row | Actionable list: `PAID_NO_SQUARE`, `NO_ACUITY_REF`, `UNKNOWN`, unexplained mismatches |
| `revenue_daily.sql` | `local_date` | gross (list), discounts, net charged, tips (Acuity-side), refunds, processing fees, net after fees, bookings, attended |
| `discount_impact.sql` | month × `certificate_kind` × code | Acuity codes (coupons, packages, gift certificates, memberships): uses and $ given up (`discount_cents`). Square discount names are included if any ever appear. |
| `checks/*.sql` | — | Data-quality assertions. Each returns **zero rows when healthy**, e.g. staging rows without raw, links whose allocations don't add up, payments in the window missing a `local_date`. |

`queries/README.md` (new) explains the conventions, the parameters and how to add a manual override.

---

## 11. CLI

```bash
npm run finance -- migrate                                            # apply db/migrations
npm run finance -- probe     --from 2020-03-01 --to 2020-03-31        # Phase 2: writes docs/finance/probe-findings.md
npm run finance -- extract   --source acuity|square|all [--resume]
npm run finance -- transform [--entity appointment]
npm run finance -- reconcile
npm run finance -- query     queries/exceptions.sql --from 2020-03-01 --to 2020-12-31 [--csv] [--limit 50]
npm run finance -- check                                              # runs queries/checks/*.sql; non-zero exit if any return rows
npm run finance -- run                                                # extract → transform → reconcile → check (what a nightly job will call)
```

### 11.1 Behaviour
- **Idempotent:** running `extract` twice changes nothing (unchanged hashes). `transform` and `reconcile` rebuild deterministically.
- **Resumable:** extraction runs in monthly chunks and saves `sync_cursor` after each one. `--resume` continues from the last completed chunk.
- **Dry run:** `--dry-run` on write commands logs what would change without writing.

### 11.2 `query` command spec
- Loads the file and replaces **named params** (`:from`, `:to`, any `--param key=value`) with positional binds (`$1…`) before sending it to `pg`. Values are **never** interpolated into the SQL string.
  - Skip `::` casts and anything inside quotes or comments when parsing params. This needs a unit test.
- Defaults: `:from`/`:to` come from `SEED_START`/`SEED_END`. `:tz` is `REPORTING_TZ`.
- Optional header comment documents params, e.g. `-- params: from (date), to (date)`. The CLI errors clearly if a referenced param is missing.
- **Read-only guard:** runs inside `BEGIN READ ONLY … ROLLBACK`, so a query file can never modify data.
- Output:
  - Default is a console table, truncated by `--limit`, with the row count and elapsed ms.
  - `--csv` writes `out/<file-stem>_<from>_<to>.csv` (gitignored) and prints the path.
- `--explain` prints `EXPLAIN ANALYZE` instead of rows, for when a query gets slow.

### 11.3 Config (`apps/finance/.env.example`, new file)

```bash
# --- Database: NEW dedicated Supabase project (not the-mat's DB) ---
# Use the direct connection (5432) or the session-mode pooler for this CLI.
FINANCE_DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
FINANCE_DB_SSL=true

# --- Acuity (Basic auth: user id + API key) ---
ACUITY_USER_ID=
ACUITY_API_KEY=
ACUITY_REQUESTS_PER_SEC=1

# --- Square ---
SQUARE_ACCESS_TOKEN=
SQUARE_ENV=production            # production | sandbox
# Don't put a "# comment" on the same line as an empty value: dotenv reads the
# variable as empty. Probe found: EAJEBA375QYQN and 2025-01-23.
SQUARE_LOCATION_ID=EAJEBA375QYQN
SQUARE_VERSION=2025-01-23

# --- Behaviour ---
REPORTING_TZ=America/Los_Angeles
SEED_START=2020-03-01            # inclusive, LA local date
SEED_END=2020-12-31              # inclusive, LA local date
MATCH_WINDOW_MINUTES=15
MEMBERSHIP_TYPE_PATTERNS=Membership   # comma-separated, case-insensitive, used by classify
```

---

## 12. Non-functional requirements

| Area | Requirement |
|---|---|
| Correctness | No floating-point money. Parse decimal strings to cents with integer math. Return `bigint` columns as strings from `pg` and convert deliberately (`pg` returns int8 as string by default; don't override it globally to `Number`). |
| SQL safety | Every query is parameterized. No string-built SQL except identifiers from a fixed allow-list (e.g. staging table names in `load.ts`). |
| Privacy | `finance` schema **not** listed in Supabase → Settings → Data API → Exposed schemas. RLS enabled on every finance table with no policies, so the anon/authenticated keys see nothing. Only the CLI's DB credentials can read it. `data/`, `out/` and `.env*` are gitignored. Logs contain IDs, never emails/phones. |
| Reliability | Retry 429/5xx with exponential backoff and jitter (max 5 attempts); honor `Retry-After`. Fail the run on a 4xx other than 429. All multi-statement writes go through `withTransaction()`. |
| Observability | Every command writes a `sync_run` row and pino logs with `run_id`. |
| Testing | Unit: money parsing, time (§8.9), param binding (§11.2), each transform mapper, each recon rule and classifier. Integration: extract → transform → reconcile against recorded, **scrubbed** fixtures via msw and a disposable Postgres (local Docker `postgres:16` or a Supabase branch). No live API calls in tests. |
| Performance | The 2020 window (~2k appointments) should extract in under 30 min at 1 req/s, including payment lookups. `transform` and `reconcile` should each take under 1 min. |

---

## 13. Phases & acceptance criteria

Claude Code: **one phase per PR. Stop for owner review after Phases 1 and 2.**

| Phase | Deliverable | Done when |
|---|---|---|
| **1. Monorepo + DB plumbing** | npm workspaces; move the Next app (with its `prisma/`) to `apps/web` unchanged; scaffold `apps/finance`; `pool.ts`, migration runner, `0001_schema_and_ops.sql`; `query` command; move CSVs to gitignored `data/` | `npm run build -w apps/web` passes and the dev server works; `npm run finance -- migrate` runs against the new Supabase project (and again as a no-op); `npm run finance -- query` runs a sample `select now()` file. **⚠️ Owner actions:** create the new Supabase project and provide the connection string; change the Vercel project's Root Directory to `apps/web`. |
| **2. Probe** | `finance probe` for March 2020 + one recent month; writes `docs/finance/probe-findings.md` | Answers every item in §14 with evidence (field names + scrubbed examples). Raw responses may be landed into `raw_record` already. |
| **3. Raw + Acuity extract** | `0002_raw.sql`; raw repo with versioning; Acuity extract | Seed window landed; a second run reports 0 new / 0 changed; monthly appointment counts (via a `query` file) match `data/acuity-exports/tejal-acuity - 2020.csv`, with any differences documented |
| **4. Square extract** | payments, refunds, orders, customers | Monthly gross (via a `query` file) matches the Square dashboard for Mar–Dec 2020 (owner provides the numbers). The dashboard reports in Pacific time, so months use the LA `local_date`. Gross = sum of `amount_money` over `COMPLETED` payments. Figures are in `data/square-dashboard/2020-monthly.csv`, and the probe data already matches them exactly (§14 Q9). |
| **5. Transform** | `0003_staging.sql`; TS mappers + loader + `transform_error` | Staging counts equal raw counts per entity (minus logged errors); §8.9 tests pass; `check` is green |
| **6. Reconcile** | `0004_recon.sql`; rules, classifier, manual overrides | 100% of records have a status; `UNKNOWN` < 5% of rows (or each one is explained in the PR); re-run gives identical output; `check` is green |
| **7. Report queries** | the five `queries/*.sql` files + `queries/README.md` | Each runs with `--csv` for the seed window; owner spot-checks 20 random `ledger.sql` rows |

---

## 14. Open questions

Q1–8 were resolved by the Phase 2 probe (2026-10-16). Full evidence is in `docs/finance/probe-findings.md`.

1. ✅ **Which Square field carries the Acuity ID?** Only `payment.note` (repeated in the line item note). Its format varies:
   - appointment charges start with the appointment id (recent years only);
   - `Order #<id>` for package/gift/membership sales;
   - `Subscription <id> - … - <certificate code>` for membership charges (2020: `<id> (<plan>)`);
   - 2020-era class charges carry **no id**.
2. ✅ **Does the Acuity payment return the Square id?** **Yes.** `transactionID` = the Square order id (2020) or the Square payment id (recent years). It is empty for cash.
3. ✅ **Timezone?** LA for the account and all calendars. `minDate`/`maxDate` use the calendar's local date. The CSV's New York is the client's timezone. The Square location is on New York time.
4. ✅ **How do coupons appear?** All codes are in `certificate`. `price` is the price after the code and `priceSold` is the list price. `/certificates.productType` separates membership, package and gift. Coupons and deleted certificates aren't listed there.
5. ✅ **Square register discounts?** None: there are no register sales and no `discounts[]` in the data. Discounts happen in Acuity.
6. ✅ **One payment, several appointments?** **Yes. Corrected in Phase 6:** 20 Square payments in 2020 cover 63 appointments (one checkout for several classes, up to 8), all linked by rule 1a. The probe's sample hadn't shown this. *(Original probe answer:)* Not observed (`relatedPaymentsCount` = 1, and each order has at most one line item). The 1→N support is kept anyway.
7. ✅ **Processing fees on 2020 payments?** Yes, on 99.8% of completed payments. Square never has `tip_money`.
8. ✅ **Highest `max`?** `max=5000` works. A full year of appointments is 1898 and matches the CSV. There are 1482 orders in total.
9. ✅ *(Owner, 2026-10-16)* **Square gross by month for Mar–Dec 2020** is saved in the gitignored `data/square-dashboard/2020-monthly.csv` (gross, refunds, and fees for Mar–Apr only). The dashboard reports in **Pacific time**.
   - **Early check against the probe's cached 2020 payments:** gross sales and refunds match **to the cent in every month**. The calculation counts `COMPLETED` payments only, uses `amount_money`, and buckets by the LA `local_date`.
   - The dashboard's March and April fees ($15, $140) are rounded versions of the API's $15.24 and $140.05.
   - December refunds were blank on the dashboard and are $0 in the API.
10. *(Owner)* New Supabase project: which region? On the free tier, the project pauses after a week of inactivity (affects a future nightly job).
11. *(Owner, later)* Dashboard choice, nightly scheduling host, and whether accrual/membership rules from v4 come back.
12. ⏳ *(Owner to-do, from Phase 6. Not blocking. **Step-by-step instructions: §16.2.**)* Review the 20 reconciliation exceptions for Mar–Dec 2020 (`npm run finance -- query queries/exceptions.sql`):
   - **8 × `ORDER_CHARGED_LESS`** ($305.75 short): Square charged less than the Acuity order total. Memberships were at exactly half, a $35 special at $26.25, a $108 pack at $80. Were these checkout coupons? If yes for all, add a rule that treats an Acuity order undercharge as explained (owner's call). Otherwise add `recon_manual_override` rows, e.g. reason `CHECKOUT_COUPON`.
   - **8 × `NO_ACUITY_REF`** ($131.20): Square payments for in-window classes that no Acuity record points at. Was the booking deleted or rescheduled?
   - **3 appointments `UNKNOWN`**: two are marked "paid" in Acuity with $0, no code and no payment record. The third is a Dec 30 class whose $32 Square payment probably also covered a January class.
   - **1 × `ACUITY_ORDER`**: a Square payment ($9.00, 2020-04-26) whose note names an Acuity order that `/orders` doesn't return.

---

## 15. Instructions for Claude Code

- Read this PRD fully before starting. Treat the v4 spec as background only.
- **No ORM or query builder.** Use `pg` and SQL files only. If you think one is needed, ask first.
- Explain non-obvious code with comments aimed at a junior engineer: say *why*, not just *what*. Each migration file starts with a header comment saying what it creates and why.
- **List new files at the top of each PR description.**
- Don't touch the-mat's existing database, Prisma schema or migrations (beyond moving them into `apps/web` in Phase 1).
- Never commit secrets, `.env*`, `data/`, `out/` or unscrubbed fixtures. Scrub names/emails/phones in fixtures.
- Keep transforms, rules and classifiers as **pure functions** (no DB or network inside), so they're unit-testable and can later run inside a scheduled job or API route unchanged.
- If a probe finding contradicts this PRD, **stop and update the PRD** (or ask) before building on the assumption.

---

## 16. Owner close-out checklist (added 2026-10-16)

Phases 1–7 are built and pass their automated acceptance checks. These items need a human. Tick each box when done, and add the date and your initials.

### 16.0 Before you start

Unless an item says otherwise, run every command from the repo root.

```bash
npm run finance -- check                                    # expect "All 7 checks passed."
npm run finance -- query queries/recon_summary_monthly.sql  # overview of every gap
```

**Baseline as built** (2026-10-16, Mar–Dec 2020). If your numbers differ before you've changed anything, the data or code changed since; investigate before ticking items.

| What | Value |
|---|---|
| Raw records | 1,896 Acuity appointments (incl. ±1-day padding), 674 Acuity payments, 1,482 Acuity orders, 980 Square payments, 3 refunds, 1,161 Square orders, 199 invoices |
| Statuses | 3,020: 1,884 appointments (equals the CSV export for Mar–Dec), 160 orders, 976 Square payments in the window |
| Links | 811: 669 by rule 1a, 138 by 1b, 2 by rule 3, 2 by rule 4 |
| Exceptions | 20 (§16.2). `UNKNOWN` = 3. |
| Square gross, Mar–Dec 2020 | $26,824.78. Matches the dashboard to the cent in every month (`data/square-dashboard/2020-monthly.csv`). |

**Tracing any number back to its source.** Every staging row has `raw_record_id`. To see the untouched API payload:

```sql
-- in the Supabase SQL editor (finance project):
SELECT payload FROM finance.raw_record WHERE source = 'acuity' AND entity = 'appointment' AND external_id = '<appointment id>';
SELECT payload FROM finance.raw_record WHERE source = 'square' AND entity = 'payment'     AND external_id = '<square payment id>';
```

**Where to look things up.**
- Acuity: Appointments → search by date or client.
- Square: Dashboard → Transactions → search by date and amount.
- A Square payment id appears in the transaction's URL and details panel.

---

### 16.1 ☐ Spot-check 20 ledger rows *(PRD §13, Phase 7 acceptance)*

```bash
npm run finance -- query queries/ledger.sql --sample 20 --csv
# → apps/finance/out/ledger_2020-03-01_2020-12-31_sample20.csv  (contains client names/emails: keep it local)
```

The sample is repeatable: the same data always gives the same 20 rows. As built, it contains:

| # | Date | Row | Id | Status / reason | What to verify |
|---|---|---|---|---|---|
| 1 | 2020-04-05 | Acuity order | 44045431 | amount_mismatch / ORDER_CHARGED_LESS | Acuity order total $40. Linked Square payment `9YjlVIjhoj1AthjN9ijXZOeRvaB` is $20. Part of §16.2a. |
| 2 | 2020-04-09 | Acuity appt | 369448641 | not_applicable / CANCELED | Canceled in Acuity, $0 paid |
| 3 | 2020-04-14 | Acuity appt | 371197019 | not_applicable / PACKAGE_REDEMPTION | Booked with an 8-character code, $0 paid. The code no longer exists in Acuity's certificate list. |
| 4 | 2020-04-19 | Acuity appt | 373034817 | matched | Price $10, paid $11 ($1 tip). Square `JsifkAMHdk5hFpSHWNVeyftQvaB` = $11. |
| 5 | 2020-05-21 | Acuity appt | 379019749 | matched | Price $10, paid $11. Square `XV1anfrdpptiIVfG7Qv73SwJuaB` = $11. |
| 6 | 2020-06-08 | Square payment | x0myLoI57Wd8UcT4sUhAGIMivaB | not_applicable / NOT_COMPLETED | Shows as Canceled/Voided in Square, no money moved |
| 7 | 2020-06-10 | Acuity appt | 377829790 | not_applicable / PACKAGE_REDEMPTION | Code used, $0 paid |
| 8 | 2020-07-15 | Acuity appt | 404886177 | not_applicable / FREE_TYPE | Class price is $0 |
| 9 | 2020-07-19 | Square payment | F8deJZeQulss44S515qraSAFvaB | square_only / MEMBERSHIP_CHARGE | $9 recurring membership charge (2020 note format, so no certificate link) |
| 10 | 2020-07-21 | Acuity appt | 410519762 | not_applicable / PACKAGE_REDEMPTION | Code used, $0 paid |
| 11 | 2020-07-26 | Acuity appt | 407455387 | not_applicable / MEMBERSHIP | Booked with a membership code, $0 paid |
| 12 | 2020-07-28 | Acuity appt | 410492264 | not_applicable / PACKAGE_REDEMPTION | Code used, $0 paid |
| 13 | 2020-08-13 | Acuity appt | 422662111 | not_applicable / PACKAGE_REDEMPTION | Code used, $0 paid |
| 14 | 2020-08-19 | Square payment | xgaji3qYQSc4Zy5WpTlqePPDuaB | matched | $14, linked to appointment 426627545 |
| 15 | 2020-08-31 | Acuity appt | 432763502 | matched | Price $7, paid $10 ($3 tip). Square `Nigd8nlWcuKZmfeRGBrgRqekvaB` = $10. |
| 16 | 2020-09-07 | Square payment | RinN02aBpiebFMF5a64UGsusuaB | matched | $10, linked to appointment 437225887 |
| 17 | 2020-10-28 | Square payment | XjEcUuRR9A52OqQeiMTFltNSuaB | matched | $7, linked to appointment 466135621 |
| 18 | 2020-11-12 | Square payment | f7Ggogw8MWluWET2J1th6HWluaB | matched | $16, linked to appointment 474257078 |
| 19 | 2020-11-28 | Acuity order | 55261597 | matched | $35 order. Square `9oF0We8wokjk2NIPot57kqxguaB` = $35. |
| 20 | 2020-12-23 | Acuity appt | 494181213 | matched | Price $7, paid $10. Square `dea9EnpnXOZdO9u4BvwfJ1vGvaB` = $10. |

**For each row, check against Acuity and Square:**
- [ ] **Date.** Acuity rows: the class or order date in LA time. Square rows: the payment date in LA time (the dashboard is set to Pacific).
- [ ] **Amounts.** In `ledger`:
  - `list_price` = the class's normal price;
  - `charged` = the price after any code;
  - `amount_paid` = what the client actually paid, *including* any Acuity tip;
  - `tip` = `amount_paid − charged` when no code was used;
  - `code_extra_paid` = the same difference when a code was used (gift card or prepayment, never a tip).
- [ ] **Link.** For `matched` rows, the Square payment in `linked_to` is the right one: same client, same amount, paid within minutes of the Acuity payment.
- [ ] **Reason.** For `not_applicable` rows, the reason is true. For example, a `MEMBERSHIP` booking really used a membership, and a `CANCELED` booking really was canceled with nothing paid.
- [ ] **Fees.** For Square rows, `square_fee` matches the fee in the transaction's details.

**If a row is wrong**, note the id and what's wrong, then work out which layer is at fault:
- the raw payload is wrong → the API returned it that way;
- raw is right but staging is wrong → a mapper bug in `src/transform/`;
- staging is right but the link or reason is wrong → `src/reconcile/`.

Re-run `transform` or `reconcile` after any fix. Don't edit tables by hand.

---

### 16.2 ☐ Review the 20 reconciliation exceptions *(PRD §14 Q12)*

```bash
npm run finance -- query queries/exceptions.sql --csv   # → out/exceptions_2020-03-01_2020-12-31.csv (has emails + a next_step column)
```

**How to resolve one:** decide what happened, then either fix the source (Acuity or Square) and re-run `npm run finance -- run`, or record your decision as an override (`queries/README.md`):

```sql
INSERT INTO finance.recon_manual_override (acuity_kind, acuity_id, square_payment_id, reason_code, note)
VALUES ('<appointment|order>', '<acuity id>', '<square payment id or NULL>', '<REASON_CODE>', '<what you found>');
```

then run `npm run finance -- reconcile`. The row leaves `exceptions.sql` and shows your `reason_code` in `recon_status`.

**What overrides can and can't do.** An override is keyed on an **Acuity** record. It can:
- link an Acuity record to a Square payment, which resolves both sides;
- say an Acuity record needs no Square payment.

It can't mark a Square-only payment as explained without naming an Acuity record. For the `NO_ACUITY_REF` items below, either link each payment to its booking, or ask for a small change: allow `acuity_kind = 'none'` overrides keyed on the Square payment.

#### 16.2a ☐ 8 × `ORDER_CHARGED_LESS` ($305.75 short in total)

Square charged less than the Acuity order total. The Acuity order API has no discount field, so the data can't tell whether a checkout coupon was used.

| Order | Date | Product | Acuity total | Square charged | Square payment |
|---|---|---|---|---|---|
| 44045431 | 2020-04-05 | Weekly unlimited membership | $40.00 | $20.00 | 9YjlVIjhoj1AthjN9ijXZOeRvaB |
| 44235928 | 2020-04-05 | Monthly Unlimited Membership | $160.00 | $80.00 | BYepCxU87vFMA8IX8fr4WyfsuaB |
| 44240023 | 2020-04-05 | Monthly Unlimited Membership | $160.00 | $80.00 | BMsHyuxUOzlnlZZL2MW1ILbAwaB |
| 44244934 | 2020-04-05 | Weekly unlimited membership | $40.00 | $20.00 | JU0E51EL8DqHrQP4QHqDpLOJuaB |
| 46602032 | 2020-06-04 | Monthly Unlimited Membership | $120.00 | $60.00 | pWDL77CCv5gjowKAOKl4ZQsbuaB |
| 47613376 | 2020-06-28 | 1 Week Special: Unlimited | $35.00 | $26.00 | TBOZ8ejHED8eIXV634BafUd1uaB (matched by rule 3: same email + date) |
| 48554680 | 2020-07-20 | 1 Week Special: Unlimited | $35.00 | $26.25 | jlU9GL4zauWrMVWgQFDAy6yZuaB |
| 50791213 | 2020-09-05 | 10 Class Pack (Assorted) | $108.00 | $80.00 | jBsqY0hU5CEPO44M48LY9eDauaB |

- [ ] **Check the order in Acuity.** In Acuity (Orders / Packages), open each order and look for a coupon or discount on it.
- [ ] **Memberships at exactly half price.** Was there a "first month 50% off" or similar intro offer in April–June 2020? If not, a second charge may be missing: check whether a second Square payment of the same amount exists for that client around the same date.
- [ ] **Order 47613376 (matched by rule 3, low confidence).** Confirm the Square payment is the same client and order. If it isn't, override it with the correct payment.
- [ ] **Decide, then tell Claude Code:**
  - **(a) All 8 are checkout coupons, now and in future.** Add a rule: an Acuity order linked to a Square payment that charged less is `ORDER_DISCOUNT`, not an exception. This is a code change; ask for it.
  - **(b) Case by case.** Add an override per order, e.g. `reason_code = 'CHECKOUT_COUPON'`. *Note:* an override with `square_payment_id = NULL` marks the order "no payment expected" and unlinks its Square payment. To keep the link, use the Square payment id from the table above.
  - **(c) Something else**, such as genuinely missing money. Leave them as exceptions and write down what you found.

#### 16.2b ☐ 8 × `NO_ACUITY_REF` ($131.20)

These are completed Square payments whose note names a class *inside* the window, but no Acuity appointment or payment points at them.

| Square payment | Paid on | Amount | Class named in the note |
|---|---|---|---|
| XTY6CFBALeVjXjZQF8uyydvAvaB | 2020-03-30 | $10.00 | March 31, 2020 1:00pm |
| lEj54JPeLzseQr0o5K2jIydguaB | 2020-03-30 | $18.00 | April 1, 2020 5:30pm |
| Lnxil40ROU7Y5uM36SqYH4IyuaB | 2020-04-18 | $12.00 | April 19, 2020 1:30pm |
| n1PZp4MUTcEBZu1ZYAeVOPwvvaB | 2020-04-19 | $10.00 | April 20, 2020 9:30am |
| 3LYGhDxqKUFbe22BKcmvxs36taB | 2020-04-20 | $6.00 | April 22, 2020 9:30am |
| bRUjRQioGBChbDit7x6XZm5CwaB | 2020-06-01 | $19.20 | June 2, 2020 8:00am |
| pMuJoswjEiCdbROyxFEXbbLkvaB | 2020-08-09 | $36.00 | *(note has no class date)* |
| l8p8Vm82lpxhYAVW1Osm51rkuaB | 2020-12-30 | $20.00 | December 31, 2020 11:00am |

- [ ] **Find each booking in Acuity.** Look up the class on the date in the note, plus the client from the Square transaction. Common causes:
  - **the appointment was deleted** (deleted appointments disappear from the API, even with `showall`);
  - **rescheduled to another class** that was then refunded or canceled with `amountPaid = 0`;
  - **paid twice:** a duplicate charge that should have been refunded. Check Square for a refund.
- [ ] **If you find the booking**, add an override linking it: `('appointment', '<id>', '<square payment id>', 'MANUAL_MATCH', '…')`.
- [ ] **If it was a duplicate charge that was never refunded**, that's money owed back. Handle it in Square, then re-run `npm run finance -- run`.

#### 16.2c ☐ 3 × appointment `UNKNOWN`

| Appointment | Class date | Class | What the data shows |
|---|---|---|---|
| 413353042 | 2020-07-23 | Yoga Nidra (Th 8:30pm) | Price $16, Acuity says **paid = yes** but amount paid $0, no code, no payment record |
| 489511302 | 2020-12-23 | Slow Flow and Reclaim Space (W 5:30p) | Same pattern: paid = yes, $0, no code, no payment record |
| 496665893 | 2020-12-30 | Slow Flow and Reclaim Space (W 5:30p) | Paid $16. The linked Square payment `1kzhx6UtFe702s0HPYDYulZ5taB` is **$32**, probably also covering a January 2021 class that isn't extracted yet. |

- [ ] **413353042 and 489511302:** in Acuity, check whether these were marked paid by hand (comp, paid at the door, paid another way). Then override with a fitting reason, e.g. `'COMP'` or `'PAID_OFFLINE'`, with `square_payment_id = NULL`.
- [ ] **496665893:** confirm in Square that the $32 covers two classes. This resolves itself once January 2021 is extracted (§16.5), when the second appointment links to the same payment. Leave it until then.

#### 16.2d ☐ 1 × `ACUITY_ORDER`

- **Square payment** `N8dpIm6kSJTw6a49ipSE5XNBuaB`, 2020-04-26, $9.00.
- **The problem:** its note names an Acuity order (`Order #…`) that Acuity's `/orders` doesn't return. `/orders` history starts 2020-03-30, and a few early order ids are missing from it.

- [ ] Look up the order number from the Square note in Acuity.
- [ ] If the sale is real, there's no Acuity record to link it to (the order isn't in the API). Write down the finding here and leave it, or ask for Square-side overrides (see "What overrides can and can't do" above).

**Done when:** `exceptions.sql` returns only the items you've chosen to leave open, each with a written finding.

---

### 16.3 ☐ Confirm privacy settings *(PRD §12; Phase 1 owner action)*

Checked by Claude Code on 2026-10-16:
- the `anon` and `authenticated` roles have **no** USAGE on the `finance` schema and **no** table grants;
- every `finance` table has row-level security enabled;
- `SQUARE_LOCATION_ID` and `SQUARE_VERSION` are pinned in `apps/finance/.env`.

Still for you:

- [ ] **Data API:** in Supabase (finance project), go to **Settings → Data API → Exposed schemas**. `finance` must **not** be listed. Even if it were, the role checks above mean nothing would be readable, but keep it off.
- [ ] **Re-verify any time** in the SQL editor. Expect `false | 0` on both rows:
  ```sql
  SELECT rolname, has_schema_privilege(rolname, 'finance', 'USAGE') AS usage,
         (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.grantee = r.rolname AND g.table_schema = 'finance') AS grants
  FROM pg_roles r WHERE rolname IN ('anon', 'authenticated');
  ```
- [ ] **Database access:** only people who should see client PII have the finance project's database password or connection string.
- [ ] **Local PII files** stay off shared drives. These hold raw API responses and reports with client names and emails, and are all gitignored:
  - `data/probe/` (2 probe runs);
  - `data/acuity-exports/`;
  - `apps/finance/out/`.

  Delete the probe runs if you no longer need them (`rm -rf data/probe`). Nothing depends on them; `probe --from-cache` is the only thing that reads them.

---

### 16.4 ☐ Review and commit the work

Everything is uncommitted on `main` (owner's instruction). When you're ready:

- [ ] **Review** `git status`. You should see:
  - modified: `.gitignore`, `package.json`, `package-lock.json`;
  - new: `.nvmrc`, `tsconfig.base.json`, `apps/`, `docs/`;
  - about 80 files under "deleted": the Next.js app moved from the root to `apps/web/` (`src/`, `public/`, `prisma/`, configs).
- [ ] **Confirm nothing sensitive is staged:**
  ```bash
  git add -A && git status --short | grep -E '\.env|data/|out/|\.csv$'   # expect no output
  ```
- [ ] **Web app:**
  - `npm run build` passes (it did on 2026-10-16).
  - After a fresh clone, run `npm install` then `npm run db:generate -w apps/web` (there's no Prisma postinstall hook) before `npm run dev`.
- [ ] **Fresh-clone setup:**
  - copy `apps/finance/.env.example` to `apps/finance/.env` and fill in the secrets;
  - copy the web app's `.env` and `.env.local` into `apps/web/`;
  - put the Acuity CSV exports in `data/acuity-exports/` if you want the validation query.
- [ ] **Leftovers to decide on:**
  - `src/lib/test-crypto.ts`, now `apps/web/src/lib/test-crypto.ts`, was untracked before this work and still is. Commit it or delete it.
  - `stripe-connect-prompt.md` at the root is untouched.

---

### 16.5 ☐ Extend the data past 2020

The seed window is `SEED_START=2020-03-01` → `SEED_END=2020-12-31`. To add later years, go one year at a time:

```bash
# 1. Extract one year (re-runnable; add --resume if interrupted)
npm run finance -- extract --source acuity --from 2021-01-01 --to 2021-12-31
npm run finance -- extract --source square --from 2021-01-01 --to 2021-12-31
# 2. Rebuild staging + reconcile the WHOLE range you care about
npm run finance -- transform
npm run finance -- reconcile --from 2020-03-01 --to 2021-12-31
npm run finance -- check
```

- [ ] **Runtime.** Acuity is limited to 1 request/second, plus one payment lookup per paid appointment:
  - 2020: 1,898 appointments took 12 minutes.
  - 2021 has 3,981 and 2022 has 4,711 (from your CSV exports). Expect roughly 25–40 minutes per year.
  - Square takes about a minute per year.
- [ ] **Appointment counts vs the CSV:** `npm run finance -- query queries/validate/acuity_monthly_counts.sql --from 2021-01-01 --to 2021-12-31` must equal `data/acuity-exports/tejal-acuity - 2021.csv` month by month (3,981 total, canceled included). Do the same for 2022 (4,711).
- [ ] **Square gross vs the dashboard:** export the dashboard's monthly gross sales and refunds for each new year (Pacific time) into `data/square-dashboard/<year>-monthly.csv`, in the same format as `2020-monthly.csv`. Then compare with `npm run finance -- query queries/validate/square_monthly_gross.sql --from <year>-01-01 --to <year>-12-31`. It should match to the cent.
- [ ] **Re-run is a no-op:** a second `extract` for the same year reports `new: 0, changed: 0`.
- [ ] **Expect these changes:**
  - **January 2021 resolves 2020 leftovers:** the 4 `CLASS_OUTSIDE_WINDOW` payments from late December 2020 and appointment 496665893 (§16.2c) should become `matched`.
  - **New links:** later years use newer Square note formats (appointment id in the note, subscription certificate codes), so expect more rule-1b links and `MEMBERSHIP_CHARGE` payments linked to certificates.
  - **New invoice reasons:** invoice payments (from 2023) will appear with reason `INVOICE`.
- [ ] **Update `.env`:** once all years are loaded, set `SEED_END` so reports default to the full range.

---

### 16.6 ☐ Decide how the nightly job runs *(PRD §14 Q10, Q11)*

`npm run finance -- run` already does extract (both sources) → transform → reconcile → check. It exits 1 if a check fails. Decisions needed:

- [ ] **Host:** where it runs, e.g. a GitHub Actions cron, a small VM, or Supabase scheduled functions. The CLI needs Node 22 and the `apps/finance/.env` secrets, stored as the host's secrets and never committed.
- [ ] **Lookback window (required):**
  - Square payments change *after* their creation month (refunds update `refunded_money`), and a re-pull only sees that if it covers the creation month.
  - Acuity appointments get rescheduled or canceled.
  - So each night should re-pull **the last 3 months** plus upcoming bookings, not just yesterday. Pick the number of months; this needs a small code change to compute `--from/--to` relative to today.
- [ ] **Supabase free tier:** it pauses projects after about a week with no activity. A nightly job counts as activity, but the first night after a pause fails. Either upgrade the plan or accept that and re-run. Also pick or confirm the region.
- [ ] **Alerting:** who gets told when `run` exits non-zero, i.e. when an extract fails or a check returns rows.
- [ ] **New exceptions:** decide who reviews new rows in `exceptions.sql` after each run, and how often.

---

### 16.7 ☐ Choose the dashboard *(PRD §14 Q11, D9: deferred)*

- [ ] **Pick a tool**, e.g. a page in `apps/web`, Metabase or Looker Studio reading Supabase, or Google Sheets fed by `query --csv`.
- [ ] **Promote stable reports to views.** The report SQL files can become views in a new migration once they stop changing (PRD §10). A dashboard should read a **read-only database role** that can see only those views, never the client-PII tables.
- [ ] **Accrual and memberships:** decide whether the v4 rules (deferred revenue, fiscal calendar, membership allocation) come back as a follow-up PRD.

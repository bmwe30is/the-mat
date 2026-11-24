# Acuity + Square → Google Sheets Financial Data Pipeline — Spec

**Status:** Draft v4 · 2026-10-08 (owner answers incorporated)
**Owner:** Jonathan
**Scope:** One Acuity account (single studio). Square for payment collection (not yet implemented). Google Sheets is the system of record. Web UI comes later.

---

## 1. Goals

1. **Seed** 6+ years of history (2020-01-01 → today, 2026-10-08) from Acuity, and later from Square.
2. **Nightly update** so the financial workbook is current every morning.
3. **Reconcile** Acuity bookings with Square payments, with a toggle for which system is authoritative for revenue.
4. **Pre-computed summaries** by day, week and month; by appointment type; by instructor; and by client cohort/retention.
5. Revenue shown on **both a cash basis (payment date) and an accrual basis (service date)**, side by side.
6. Tab schemas mirror future database tables, so moving to the web app means changing where data is stored, not redesigning it.

## 2. Non-goals (v1)

- Real-time updates (webhooks). The nightly run is enough; webhooks can come later in the web app.
- Writing back to Acuity or Square (the pipeline only reads from them).
- Payroll calculation. Instructor summaries provide the inputs only.

---

## 3. Architecture

```
            ┌──────────────┐        ┌──────────────┐
            │ Acuity API   │        │ Square API   │  (toggle: SQUARE_ENABLED)
            └──────┬───────┘        └──────┬───────┘
                   │  UrlFetchApp (server-side, secrets in Script Properties)
                   ▼                       ▼
        ┌──────────────────────────────────────────────┐
        │  Apps Script project (bound to DATA file)     │
        │  seed() · nightly() · reconcile() · rollup()  │
        └──────────────────────┬───────────────────────┘
                               ▼
   ┌───────────────────────────────────┐     ┌──────────────────────────────┐
   │ Spreadsheet A: "Studio Data"       │ ──▶ │ Spreadsheet B: "Financial     │
   │ raw_* tabs, reconciliation,        │     │ Workbook"                     │
   │ sync_state, sync_log, config       │     │ sum_* tabs (written by        │
   │ (restricted sharing — PII)         │     │ script) + your model tabs     │
   └───────────────────────────────────┘     └──────────────────────────────┘
```

**Why two spreadsheets**
- **Size:** 6 years of raw rows plus a financial model in one file will slow down. Google Sheets caps a file at 10M cells.
- **Privacy:** raw tabs contain client names, emails and phone numbers. The workbook holds only aggregates, so it can be shared more widely.
- **Raw data in the workbook:** the script also writes a `raw_recent` tab there with the last 24 months of appointments, which covers the "summaries + raw tab" choice.

**Why Apps Script as the scheduler (recommended while Sheets is the database)**
- No server to host. It writes to Sheets without separate authentication, and time-driven triggers are built in.
- The trade-offs are quota limits (§9) and a 6-minute limit per run. All jobs are therefore built to be **resumable**: each run saves a cursor in `sync_state` and picks up where the last one stopped.
- **Moving off it later:** keep the logic in plain functions (fetch → normalize → upsert) so it can be ported to a TypeScript job in the-mat (Vercel Cron / Supabase / GitHub Actions) with minimal change.

**Ownership and sharing (confirmed requirement: the Workspace admin assigns visibility)**
- Put both spreadsheets **and the Apps Script project** in a **Shared Drive** owned by the studio's Workspace. Access then belongs to the organization, not to one person, and the admin manages membership and roles there.
- Use separate Shared Drives (or separate file-level permissions) for **Studio Data** (restricted, PII) and the **Financial Workbook** (broader). The admin assigns each group independently.
- Install the nightly trigger as a dedicated Workspace account (e.g. `ops@<studio domain>`), not a personal account, so syncs don't stop when someone leaves.

**Secrets:** `ACUITY_USER_ID`, `ACUITY_API_KEY` and `SQUARE_ACCESS_TOKEN` go in **Script Properties**, never in sheet cells.

---

## 4. Config tab (`config` in Studio Data)

| Key | Example | Purpose |
|---|---|---|
| `SEED_START` | `2020-01-01` | Start of the backfill |
| `STUDIO_TZ` | `America/Los_Angeles` | All date bucketing |
| `SQUARE_ENABLED` | `FALSE` | Turns Square fetching and reconciliation on or off |
| `CASH_SOURCE` | `ACUITY` \| `SQUARE` \| `RECONCILED` | Which system's payments feed cash-basis revenue |
| `NIGHTLY_LOOKBACK_DAYS` | `90` | Acuity re-pull window into the past |
| `NIGHTLY_LOOKAHEAD_DAYS` | `180` | Acuity re-pull window into the future (forward bookings) |
| `RAW_RECENT_MONTHS` | `24` | Size of the `raw_recent` tab in the workbook |
| `MATCH_TIME_WINDOW_MIN` | `15` | Time tolerance for fuzzy matching (§7) |
| `WEEK_START` | `SUN` | First day of the week (confirmed: Sunday) |
| `FISCAL_CALENDAR` | `SEE fiscal_calendar TAB` | Fiscal periods aren't calendar months. Every summary groups by the `fiscal_calendar` tab (§8.4), so the pattern can change without code changes. |
| `FISCAL_PATTERN` | `4-4-5` (confirmed; also supports `4-5-4`, `5-4-4`, `13x4`, `WEEKS`, `CALENDAR_MONTH`) | Used to generate `fiscal_calendar` |
| `FISCAL_YEAR_RULE` | `SUNDAY_NEAREST_JAN_1` (confirmed) | Fiscal year starts on the Sunday nearest Jan 1 |
| `WEEK_53_PLACEMENT` | `LAST_PERIOD` | In a 53-week year the extra week goes to period 12 (5 → 6 weeks). Alternative: `OWN_PERIOD`. |

**What `CASH_SOURCE` does**
- `ACUITY`: cash revenue = Acuity appointment payments + paid Acuity orders. This works today, without Square.
- `SQUARE`: cash revenue = Square payments minus refunds (fees reported separately).
- `RECONCILED`: Square amounts, but only for transactions matched to an Acuity record. Unmatched items from either side are reported separately.

---

## 5. Data model (raw tabs in Studio Data)

Every raw tab has a **primary key in column A** (upsert target), `synced_at`, and `raw_json` (the full source object, truncated to 50k chars). With `raw_json`, a tab can be re-mapped later without re-fetching.

### 5.1 `acuity_appointments`
| Column | Source | Notes |
|---|---|---|
| `appointment_id` (PK) | `id` | |
| `datetime` | `datetime` | ISO with offset |
| `service_date` | derived | Local date in `STUDIO_TZ`. This is the accrual date. |
| `end_time`, `duration_min` | `endTime`, `duration` | |
| `appointment_type_id`, `type` | | |
| `calendar_id`, `calendar` | `calendarID`, `calendar` | `calendar` = instructor |
| `client_key` | derived | Lower-cased trimmed email, falling back to phone and then to name |
| `first_name`, `last_name`, `email`, `phone` | | PII |
| `price` | `price` | List price |
| `amount_paid` | `amountPaid` | |
| `paid` | `paid` | |
| `certificate` | `certificate` | Package/code used, if any |
| `canceled` | derived | From the canceled pass, or `showall` |
| `no_show` | `noShow` | |
| `date_created` | `dateCreated` | Booking date |
| `labels` | `labels[].name` joined | |
| `status_note` | derived | e.g. `missing_since:2026-10-01` (§6.3) |

### 5.2 `acuity_appointment_payments`
| Column | Notes |
|---|---|
| `transaction_id` (PK) | Processor transaction ID (expected to be a Square payment ID; **verify in Step 0**) |
| `appointment_id` | FK |
| `processor` | |
| `amount` | |
| `created` | Payment timestamp. This is the cash-basis date. |

### 5.3 `acuity_orders`
Covers packages, gift certificates and subscriptions.

`order_id` (PK), `time`, `total`, `status`, `title` (product names), `first_name`, `last_name`, `email`, `client_key`, `notes`.

### 5.4 `acuity_certificates`
Package and membership instances.

`certificate_code` (PK), `product_id`, `name`, `client_key`, `remaining` / counts, `expiration`. Exact fields to be **confirmed in Step 0**.

### 5.5 Lookup tabs
- `acuity_appointment_types`: id, name, price, duration, category, active
- `acuity_calendars`: id, name (instructor)
- `acuity_products`: id, name, price, **credits** (needed for per-credit value, §8.2), type (package / membership / gift)

### 5.6 `square_payments` (when `SQUARE_ENABLED`)
`payment_id` (PK), `created_at`, `updated_at`, `status`, `amount`, `tip`, `total`, `processing_fee_total` (sum of all fee entries), `refunded_amount`, `net_of_fees` (total − refunds − fees), `order_id`, `invoice_id` (filled when the payment's `order_id` matches a Square invoice), `customer_id`, `location_id`, `buyer_email`, `client_key`, `note`, `reference_id`, `card_last4`, `source_type`.

### 5.6a `square_processing_fees` (one row per fee entry)
Square returns fees as an **array** on each payment (`processing_fee[]`), which can include later adjustments, so they get their own tab instead of a single number.

`fee_row_id` (PK = payment_id + index), `payment_id`, `effective_at` (fee date; cash-basis date for fees), `fee_type` (e.g. initial vs. adjustment, **verify field values in probe**), `amount`, `source_type` (card / card-on-file / invoice / cash…), `bucket` (inherited from the payment's classification).

- Fees can show up a few seconds or more after the payment. The nightly `updated_at` re-pull (§6.3) picks up late fees and adjustments.
- Cash and other non-card tenders have $0 fees.

### 5.6b `square_invoices`
`invoice_id` (PK), `order_id`, `status`, `customer_id`, `email`, `client_key`, `title`, `description`, `subscription_id` (if any), `due_date`, `amount_requested`, `amount_paid`, `created_at`, `updated_at`.
- Source: `SearchInvoices` (pinned `location_id`, cursor-paged, up to 200 per page).
- **Link to payments:** invoice `order_id` = payment `order_id`. **Verify in probe.**
- **Business meaning (owner, 2026-10-08):** Square invoices include charges to students who book in Acuity **using an Acuity membership**. Those invoice payments are the membership's **revenue**, and the Acuity bookings are its **consumption**.

### 5.7 `square_refunds`
`refund_id` (PK), `payment_id`, `created_at`, `amount`, `status`, `reason`.

### 5.8 Reconciliation and operations tabs
- `reconciliation` (§7)
- `manual_matches`: user-edited, never overwritten by the script
- `sync_state`: key/value (cursors, last-success timestamps)
- `sync_log`: run_id, job, started, finished, rows_upserted, api_calls, errors

---

## 6. Sync jobs

### Step 0: Probe (one-off, before building)
Pull **one recent month** and one 2020 month, and check:
1. ~~Whether `showall=true` works~~ **Confirmed:** one request returns active and cancelled bookings together.
2. ~~Whether Acuity payments contain Square IDs~~ **Confirmed: they don't.** Instead, Square records contain Acuity IDs. Probe: find which Square field holds them and which Acuity ID it is.
3. The highest `max` that `/appointments` and `/orders` accept.
4. The fields returned by `/certificates` and `/products`, especially credit counts and membership vs. package.
5. How memberships/subscriptions show up (orders vs. certificates).
6. Rough volume: appointments per month in 2020 vs. 2026. This sizes the seed (§9).

Record the findings in an appendix to this doc.

### 6.1 Seed: Acuity (resumable)
1. Pull the lookups (types, calendars, products, certificates).
2. For each month from `SEED_START` to the current month + 6:
   - `GET /appointments?minDate=…&maxDate=…&max=<high>&showall=true&excludeForms=true&direction=ASC` (single pass, confirmed)
   - If the result count equals `max`, split the window in half and query again.
   - Upsert into `acuity_appointments`.
   - Save `seed.acuity.month` in `sync_state`.
3. **Payments queue:** for each appointment with `amount_paid > 0` that has no payment rows yet, call `GET /appointments/:id/payments` and upsert. This is the slowest step and may take several days of runs (§9).
4. **Orders:** `GET /orders?max=<high>` (no date filter is available), then upsert.
5. **Throttling:** about 1 request per second. On 429 or 5xx, back off exponentially (2s, 4s, 8s… up to 5 tries).
6. **Time limit:** each run stops at about 5 minutes, saves its cursor, and a 10-minute trigger keeps calling `seed()` until `seed.done = TRUE`.

### 6.2 Seed: Square (when enabled)
- `ListPayments` with **an explicit `begin_time`**. If it's omitted, Square only looks back one year.
- Use monthly windows and page with `cursor` (`limit=100`). Same steps for `ListPaymentRefunds`.
- **Confirmed: one Square location.** Pin `location_id` in config anyway, so a future second location doesn't silently mix in.

### 6.3 Nightly job (trigger around 2–3 AM PT)
1. **Acuity appointments:** re-pull from `today − LOOKBACK` to `today + LOOKAHEAD` and upsert. Rows inside the window that were *not* returned get `status_note = missing_since:<date>` rather than being deleted.
2. **Acuity payments:** fetch for appointments in the window whose `amount_paid` changed (compare with the previous value) or that have no payment rows.
3. **Acuity orders:** re-pull a recent `max` (e.g. 500) and upsert.
4. **Lookups:** refresh weekly. Certificates refresh nightly.
5. **Square:** `ListPayments` with `updated_at_begin_time = last_success − 1 day`, plus refunds. This is cheap and catches late refunds and settlements.
6. Run `reconcile()` (§7), then `rollup()` (§8).
7. Write to `sync_log`. On error, email the owner (`MailApp`).

### 6.4 Upsert mechanics (Sheets as database)
- Read column A once into a `Map<key,rowIndex>`.
- Write changed rows in **batches** with `setValues` on contiguous blocks, and append new rows in one call.
- Never write one cell at a time.
- Sort by `service_date` / `created` occasionally, not on every run.

---

## 7. Reconciliation (Acuity ⇄ Square)

Each candidate pair is evaluated in priority order. The first rule that matches wins.

| # | Rule | Confidence |
|---|---|---|
| 0 | Row exists in `manual_matches` | manual |
| 1 | Square payment contains the Acuity payment/appointment/order ID (field TBD — see §11) → exact join | high |
| 2 | — (removed: Acuity payment records do **not** contain Square payment IDs; confirmed by owner) | — |
| 3 | Same `client_key` + same amount + Square `created_at` within ±`MATCH_TIME_WINDOW_MIN` of the Acuity payment `created` or order `time` | medium |
| 4 | Same amount + same day + unique candidate | low |
| — | Nothing matches | unmatched |

**`reconciliation` tab columns:** `recon_id`, `acuity_kind` (appointment / order), `acuity_id`, `square_payment_id`, `rule`, `confidence`, `acuity_amount`, `square_amount`, `delta`, `square_fee`, `status` (matched / amount_mismatch / acuity_only / square_only), `reviewed` (checkbox, user-owned).

**Expected unmatched cases**
- **acuity_only:** package redemptions ($0 at booking), comps, cash.
- **square_only:** retail/POS sales, tips, items not booked through Acuity.

These are categorized, not treated as errors.

---

## 8. Summaries (written to the Financial Workbook)

### 8.1 Cash basis (by payment date)
- **Source:** set by `CASH_SOURCE`.
- **Revenue:** appointment payments + package, membership and gift sales on the day the money was collected.
- **Refunds:** subtracted on the refund date.
- **Square fees:** shown as a separate column (`fees`, `net`).

### 8.2 Accrual basis (by service date)
- **Pay-per-visit appointment:** `amount_paid` (or `price` if paid later) on `service_date`.
- **Package redemption:** `package price ÷ package credits` on `service_date` (needs `acuity_products.credits`).
- **Membership (decided 2026-10-08):** memberships go in their **own revenue bucket** and are **not** attributed to individual visits, class types or instructors. Members also use on-demand content (YouTube playlists) that can't be measured, so a per-visit split would overstate what classes earn.
  - **Accrual = transaction date (decided 2026-10-08):** a membership charge is recognized in full on the date it's charged, on both cash and accrual bases. Memberships therefore never add to the deferred balance.
  - **Invoices (added v4):** membership charges for Acuity-membership students can also arrive as **Square invoice payments**. These are classified into the `membership` bucket and linked to the student's Acuity bookings for the consumption analysis.
    - **No dedupe needed (decided):** Acuity does **not** record these charges, so the Square invoice is the only revenue record.
    - **Link key (decided), applied in order:**
      1. The invoice recipient email equals the Acuity client email (`client_key`).
      2. The invoice title or description names the Acuity membership or code. Parsing patterns are kept in `bucket_rules`.
      - If both are found and disagree, or neither is found, the invoice goes to `review_queue`.
  - **Sources (decided):** memberships are sold **both** as Acuity subscriptions (charged through Square) **and** as native Square subscriptions. Acuity-sold memberships come from `acuity_orders`/`acuity_certificates`, and Square-native ones from the Square Subscriptions + Invoices APIs (new tabs `square_subscriptions`, `square_invoices`).
  - **Dedupe rule:** an Acuity membership charge also appears as a Square payment. Once matched in `reconciliation`, it counts only once, in the `membership` bucket.
  - Member visits still count toward bookings and attendance in every tab, at $0 attributed revenue.
  - Consumption is analysed separately in `sum_membership_consumption` (§8.3).
- **Gift certificates:** recognized when redeemed.
- **Cancellations / no-shows:** always $0. **Confirmed:** no late-cancel or no-show fees are charged.
- **Deferred revenue (unearned) balance:** cash collected minus revenue recognized, cumulative. Shown at the end of each period. In practice this is unredeemed packages and gift certificates. **Starts at $0 on 2020-01-01** (confirmed: no data before 2020).
- **Breakage:** **Deferred by owner.** v1 leaves unused credits in the deferred balance and doesn't recognize them.
- **Revenue buckets:** `drop_in` (paid per appointment), `package` (credit packs), `membership`, `gift_certificate`, `retail` (added 2026-10-08: merch and other non-service sales). **Square sales with no Acuity booking** (walk-ins, retail, merch, desk gift cards) are **rolled into these existing buckets**, not given their own line (decided 2026-10-08). A user-editable `bucket_rules` tab maps Square catalog item/category names (or note keywords) to a bucket, with **`retail` as the default** for anything unmapped. Rows that hit the default are listed in `review_queue`, so the rules can be refined.
- **Discounts (decided):** every revenue summary shows `gross` (list price), `discounts` (coupons and discounts given) and `net` (amount charged), so gross − discounts = net. Sources: Acuity `price` vs. `amountPaid` plus coupon/certificate codes, and Square order `total_discount_money`.
- **Sales tax (decided):** none collected today. `tax` is still captured from Square (`total_tax_money`) and kept out of revenue, so a future change won't affect revenue figures.
- **Refunds (decided, rare):** shown as their own `refunds` column, dated when issued. Past periods are never restated.
- **Tips:** **Confirmed:** tips count as revenue, with `tips` as its own column so they can be viewed as a sub-group (`revenue_ex_tips` = total − tips). Tips are always cash basis (date paid). In accrual they are attached to the service date of the matched booking.

### 8.2a Processing fees and true net revenue (added v4)
Every revenue summary follows the same breakdown, from gross down to true net:

| Line | Definition |
|---|---|
| `gross` | List price before discounts (incl. tips) |
| − `discounts` | Coupons and discounts |
| = `net_sales` | Amount charged |
| − `refunds` | Dated when issued (no restating) |
| − `processing_fees` | Sum of `square_processing_fees.amount` by `effective_at` |
| = **`true_net_revenue`** | What the studio actually keeps |

- **Scope (decided):** true net = revenue minus **per-transaction processing fees only**. Chargebacks, Square software fees and the Acuity plan cost are out of scope; they can go in the workbook's own expense tabs.
- **Fee rate KPIs:** `effective_fee_rate` = fees ÷ net_sales, shown overall, **per bucket** and **per tender type** (card in person, card on file/online, invoice). This shows which channels cost the most.
- **Allocation:** fees belong to a Square payment, which inherits its bucket from classification and reconciliation. Bucket-level true net is exact.
  - Class-type and instructor tabs get fees only for **directly matched** drop-in and package payments. Membership fees stay in the membership bucket, consistent with the rule that memberships aren't attributed per visit.
- **Accrual view (decided):** fees follow the revenue they relate to.
  - **Packages and gift certificates:** the fee is **spread across redemptions** in the same proportion as the revenue. Fee per credit = package fee ÷ credits, recognized on each redemption's `service_date`. Fees on unredeemed credits sit in a `deferred_fees` balance alongside deferred revenue, so accrual true net is exact per visit.
  - **Drop-ins, memberships (transaction-date accrual), retail:** the fee is recognized on the same date as the revenue.
  - **Cash view:** all fees on `effective_at`.
  - **Fee adjustments** after the sale are recognized on their own `effective_at` in both views. They aren't spread back over redemptions.
- **Refund fees:** Square generally doesn't return the original processing fee on a refund. Any fee entries attached to refunds are captured as they appear, and the probe confirms behaviour.
- **Unmatched fees:** fees on `square_only` payments (retail, walk-ins) count in totals via their bucket.

### 8.3 Summary tabs

| Tab | Grain | Key columns |
|---|---|---|
| `sum_daily` | date | gross, (+ `deferred_fees` balance), discounts, net_sales, refunds, processing_fees, **true_net_revenue**, effective_fee_rate, accrual_revenue, accrual_true_net, tips, revenue_ex_tips, fees by tender type, revenue by bucket (drop_in / package / membership / gift_certificate / retail), bookings, attended, canceled, no_shows, unique_clients, new_clients, deferred_balance |
| `sum_weekly` | week starting `WEEK_START` (Sun) | same |
| `sum_period` | fiscal period (from `fiscal_calendar`) | same + period-over-period % and YoY % (same period last fiscal year) |
| `sum_fiscal_year` | fiscal year | same |
| `sum_by_type_period` | fiscal period × appointment type | bookings, attended, member_visits, accrual_revenue (non-membership), cash_revenue, avg_price, utilization* |
| `sum_by_instructor_period` | fiscal period × calendar | sessions, bookings, attended, member_visits, accrual_revenue (non-membership), avg_attendance, no_show_rate |
| `sum_fees` | fiscal period × bucket × tender type | net_sales, processing_fees, effective_fee_rate, txn_count, avg_fee_per_txn |
| `sum_membership_consumption` | fiscal period | active_members, membership_revenue (incl. Square invoices), membership_fees, membership_true_net, member_visits (Acuity), visits_per_member, implied_$_per_visit (true net ÷ visits, informational only), members_with_0_visits (likely on-demand-only), member share of total attendance; also split by class type and instructor (visit counts only, no $) |
| `sum_cohort_retention` | first-visit fiscal period × periods since | active clients, % retained, cumulative revenue per client |
| `client_ltv` | client_key | first_visit, last_visit, visits, cash_spend, accrual_revenue, cohort, status (active <60d / lapsed / churned >180d) |
| `review_queue` | row | Unmatched Acuity paid bookings, unmatched Square payments, amount mismatches and default-bucket Square rows. Columns: reason, ids, amounts, date, `resolution` (user-entered), `resolved` checkbox. The script never overwrites user columns, and resolved rows are kept. |
| `sum_reconciliation_period` | fiscal period | matched $, acuity_only $, square_only $, mismatch count |
| `raw_recent` | appointment | last `RAW_RECENT_MONTHS` of appointments, PII trimmed (client_key hashed) |

\* Utilization requires class capacity (Acuity class slots via `/availability/classes`), which is optional in v1.

### 8.4 `fiscal_calendar` tab
One row per day from 2020-01-01 through 2030-12-31: `date`, `week_start` (Sunday), `fiscal_week`, `fiscal_period`, `fiscal_quarter`, `fiscal_year`, `period_label`.
- Generated from `FISCAL_PATTERN` + `FISCAL_YEAR_START`, but **editable by hand** for 53-week years or one-off adjustments.
- Calendar with the confirmed rules (4-4-5, Sunday nearest Jan 1):

  | FY | Starts | Weeks |
  |---|---|---|
  | 2020 | 2019-12-29 | **53** |
  | 2021 | 2021-01-03 | 52 |
  | 2022 | 2022-01-02 | 52 |
  | 2023 | 2023-01-01 | 52 |
  | 2024 | 2023-12-31 | 52 |
  | 2025 | 2024-12-29 | **53** |
  | 2026 | 2026-01-04 | 52 |
  | 2027 | 2027-01-03 | 52 |

- **53-week years (FY2020, FY2025):** year-over-year columns also show a `comparable_weeks` flag, and `sum_weekly` makes like-for-like comparison by week number possible.
- Every summary joins on `date` → fiscal fields, so a calendar change only needs a rebuild, not a code change.

**Rebuild strategy:** fully recompute all summaries every night in memory. This is simpler and more reliable than incremental updates. If it exceeds the 6-minute limit, split it into two triggers (time rollups / dimension rollups).

**Model tabs:** your own tabs reference only `sum_*`. The script never touches tabs that don't start with `sum_` or `raw_recent`.

---

## 9. Limits and sizing

| Limit | Value | Impact |
|---|---|---|
| Apps Script run time | 6 min per execution | Resumable jobs + cursors |
| Trigger runtime per day | 90 min (gmail) / 6 hr (Workspace) | Seed may span days on a gmail account |
| UrlFetch calls per day | 20k (gmail) / 100k (Workspace) | Payment calls during the seed are the main cost |
| Sheets cells per file | 10M | Two-file split; `raw_json` truncation |
| Acuity rate limit | Not documented | ~1 request/s + backoff |
| Square `ListPayments` | 100 per page, 1-year default lookback | Always pass `begin_time` |

**Example sizing** (replace with Step 0 numbers): 40 appointments/day × ~2,470 days ≈ 99k appointments.
- About 99k × ~25 columns ≈ 2.5M cells in the Data file. That fits.
- Payment calls for about 60% paid ≈ 59k calls. That's about 3 days on gmail quota, or 1 day on Workspace, at 1 request/s within runtime limits.
- **Confirmed: Google Workspace.** Quotas: 100k fetches/day and 6 hr of trigger runtime per day, so the seed should finish in about 1–2 days.

---

## 10. Build plan

| Phase | Deliverable |
|---|---|
| 0 | Probe script + findings appendix (§6, Step 0) |
| 1 | Data spreadsheet + tab headers + config + Script Properties |
| 2 | Acuity client (auth, throttle, retry) + upsert library |
| 3 | Acuity seed (appointments, lookups, orders, certificates) → validate monthly counts against an Acuity UI CSV export |
| 4 | Payments queue backfill |
| 5 | Nightly job + `sync_log` + failure email |
| 6 | Rollups → Financial Workbook (cash + accrual) |
| 7 | Square client + seed (payments, **processing fees**, refunds, **invoices**, subscriptions) + nightly + `reconcile()` (behind `SQUARE_ENABLED`) |
| 8 | Cohort/LTV tabs, then the web UI (port the logic to the-mat; Sheets stays read-only or is retired) |

**Validation checks (every phase)**
- Monthly appointment counts vs. Acuity reports.
- Monthly Square gross vs. the Square dashboard.
- Cash − accrual change = deferred balance change.

---

## 11. Open decisions

| # | Question | Status |
|---|---|---|
| 1 | Membership accrual | **Decided:** own bucket, recognized on transaction date; separate consumption analysis vs. Acuity reservations (on-demand use isn't measurable) |
| 2 | Package breakage | **Deferred** (revisit after seed) |
| 3 | Tips | **Decided:** revenue, with a tips sub-line |
| 4 | Late-cancel / no-show fees | **Decided:** none charged |
| 5 | Google account type | **Decided:** Workspace |
| 6 | Square locations | **Decided:** one location. Non-Acuity POS sales are rolled into existing buckets via `bucket_rules` |
| 7 | Sharing | **Decided:** Workspace admin assigns access (Shared Drive model, §3) |
| 8 | Which Square field holds the Acuity ID, and which ID | **Probe** (Step 0) |
| 9 | Square as processor since 2020 | **Decided:** Square throughout, so reconcile every year |
| 10 | Membership billing source | **Decided:** both Acuity subscriptions and Square subscriptions (dedupe via reconciliation) |
| 11 | Discounts | **Decided:** gross, discounts and net all shown |
| 12 | Sales tax | **Decided:** none today; captured but excluded from revenue |
| 13 | Refunds | **Decided:** own column, no restating |
| 14 | Pre-2020 data | **Decided:** none; deferred balance starts at $0 |
| 15 | Fiscal calendar | **Decided:** 4-4-5, Sunday week start, FY starts on the Sunday nearest Jan 1; configurable |
| 16 | Credentials / Workspace account | **Ready:** Acuity key, Square token and Workspace account exist |
| 17 | Unmatched paid bookings | **Decided:** flag in `review_queue` and also count in the reconciliation summary |
| 18 | Default bucket for unmapped Square sales | **Decided:** new `retail` bucket |
| 19 | Placement of the 53rd week | **Assumed:** last period of the year. Confirm or change via `WEEK_53_PLACEMENT`. |
| 20 | Processing fees | **Decided:** track per transaction from Square; summaries show true net revenue and fee rates |
| 21 | Square invoices for Acuity-membership students | **Decided:** Square is the only record (no dedupe); link by email, then invoice title/description |
| 22 | Fees in accrual view | **Decided:** package/gift fees spread with redemptions (`deferred_fees`); others on the revenue date |
| 23 | Scope of true net | **Decided:** processing fees only |

## 12. Appendix A: Step 0 probe findings
- 2026-10-08 (owner): `showall` returns active and cancelled bookings in one request.
- 2026-10-08 (owner): Acuity payment records do not contain Square payment IDs. Square records may contain Acuity payment IDs.
- 2026-10-08 (owner): Square has been the processor since Jan 2020.
- 2026-10-08 (owner): memberships are sold both as Acuity subscriptions and as Square subscriptions. Coupons/discounts are in use. No sales tax. Refunds are rare.
- TODO probe (v4): `processing_fee[]` entry fields and types; whether fees are present on historical (2020) payments; fee entries on refunds; invoice `order_id` → payment `order_id` link; sample invoice titles/descriptions, to build the membership-name patterns.
- TODO probe: which Square field (payment `note`, `reference_id`, order line item or metadata) holds the Acuity ID, and whether it's the appointment, payment or order ID.
- _Remaining probe items to be filled in._

## References
- Acuity API: https://developers.acuityscheduling.com/reference/quick-start · /reference/get-appointments · /reference/get-orders · /reference/get-appointments-id-payments · /docs/webhooks
- Square ListPayments: https://developer.squareup.com/reference/square/payments-api/list-payments
- Acuity ↔ Square: https://squareup.com/help/article/6101
- Apps Script quotas: https://developers.google.com/apps-script/guides/services/quotas

# Report queries

Plain `SELECT` files over the `finance` schema. They are **not** views: edit a file and re-run it. No migration or deploy is needed.

```bash
npm run finance -- query queries/revenue_daily.sql                                  # whole seed window
npm run finance -- query queries/exceptions.sql --from 2020-03-01 --to 2020-06-30 --csv
npm run finance -- query queries/ledger.sql --sample 20 --csv                       # spot-check 20 rows
npm run finance -- query queries/some_report.sql --param instructor=Tejal --limit 200
npm run finance -- query queries/some_report.sql --explain                          # when it gets slow
```

If the numbers look stale, refresh first with `npm run finance -- run`. That runs extract, transform, reconcile and check. After editing only the matching rules, `reconcile` is enough.

## Reports

| File | One row per | Use it for |
|---|---|---|
| `ledger.sql` | Acuity appointment, Acuity order and Square payment in the window | The combined table: date, side, client, type, instructor, list price, charged, discount, tip, code extra paid, Square amount / fee / refund, recon status, reason, and what it's linked to. **A matched Acuity row and its Square payment both appear, so filter on `side` before summing money.** |
| `recon_summary_monthly.sql` | month × side × kind × status × reason | How big is each gap: record counts, exceptions, and expected / actual / delta dollars. |
| `exceptions.sql` | exception | The to-do list: every row that needs a human, with context and a suggested next step. |
| `revenue_daily.sql` | studio-local day (including empty days) | Bookings by **class date** (bookings, attended, list price, discounts, tips) and money by **payment date** (Square collected, Acuity cash, refunds, fees, net after fees). `square_collected` summed by month equals the Square dashboard's gross sales. |
| `discount_impact.sql` | month × code kind × code or product | What codes cost: uses, list price, charged, and $ given up. Coupons are grouped by code; packages, gift certificates and memberships by product name. |

`validate/` holds one-off acceptance checks: monthly counts vs the CSV export, monthly gross vs the dashboard, and checksums proving `transform` and `reconcile` are deterministic. `checks/` holds the data-quality assertions run by `check` (below).

**Privacy:** `ledger.sql` and `exceptions.sql` include client names and emails. Keep their CSVs in the gitignored `out/` folder and don't share them outside the studio.

## Conventions

- **Params** are written `:name` in the SQL. The CLI turns them into positional binds (`$1, $2…`), so values are never pasted into the SQL text.
  - `:from` and `:to` default to `SEED_START` and `SEED_END`. They are LA local dates and inclusive.
  - `:tz` defaults to `REPORTING_TZ`.
  - Anything else comes from `--param name=value`.
  - Casts like `:from::date` work. Colons inside strings and comments are ignored.
- Start each file with a header line declaring its params, so a missing one fails clearly:
  ```sql
  -- params: from (date), to (date)
  ```
  Use `-- params: none` when there are none.
- Filter by stored `local_date` columns where they exist. If you must derive a date from an instant, use `(ts AT TIME ZONE :tz)::date`.
- Money columns are `bigint` cents. Divide by 100.0 only in the final SELECT, for display.
- **Read-only:** every file runs inside `BEGIN READ ONLY … ROLLBACK`. A report can't change data, even by accident.
- **Output:**
  - `--csv` writes `apps/finance/out/<file>_<from>_<to>.csv`. The `out/` folder is gitignored.
  - `--sample <n>` keeps a repeatable pseudo-random sample of n rows, so the same data always gives the same sample.
- **Never select `stg_square_payment.note`** in a report. 2020-era notes contain client names. Use `acuity_ref_kind` instead.

## checks/

These are data-quality assertions run by `npm run finance -- check`. Each file returns **zero rows when healthy**, and `check` exits 1 if any returns rows.

## Manual reconciliation overrides

`finance.recon_manual_override` is the one table **you** own. `reconcile` applies these rows first (rule 0) and never writes to, changes or deletes the table. After adding a row, run `npm run finance -- reconcile`.

Use them for exceptions you've looked into and resolved (see `exceptions.sql`). Replace the `<…>` placeholders with real ids from that report:

```sql
-- "This Acuity appointment was paid by this Square payment" (forces a link):
INSERT INTO finance.recon_manual_override (acuity_kind, acuity_id, square_payment_id, reason_code, note)
VALUES ('appointment', '<acuity appointment id>', '<square payment id>', 'MANUAL_MATCH', '<how you confirmed it>');

-- "No Square payment is expected for this Acuity record" (e.g. comped, paid at the door, checkout coupon):
INSERT INTO finance.recon_manual_override (acuity_kind, acuity_id, square_payment_id, reason_code, note)
VALUES ('order', '<acuity order id>', NULL, 'CHECKOUT_COUPON', '<what happened>');
```

- `acuity_kind` is `appointment` or `order`. `acuity_id` is the Acuity id as text.
- `reason_code` is free text and appears in `recon_status.reason_code`. Use a short UPPER_SNAKE code so reports can group by it.
- To undo an override, `DELETE` its row and re-run `reconcile`.

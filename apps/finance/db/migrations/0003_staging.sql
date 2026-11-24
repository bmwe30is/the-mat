-- 0003_staging.sql
--
-- The staging layer (PRD §7.3): typed tables derived ONLY from raw_record by
-- `finance transform`. They can be emptied and rebuilt at any time, so never
-- edit them by hand — fix the mapper and re-run transform instead.
--
-- Conventions: money = bigint cents; instants = timestamptz (UTC); local_date =
-- studio-local (America/Los_Angeles) date. Every row keeps raw_record_id (trace
-- any number back to its payload) and missing_since (copied from raw: the API
-- stopped returning it — kept, not dropped, so nothing silently disappears).

-- ---------- Acuity ----------

CREATE TABLE finance.stg_acuity_appointment (
  appointment_id         bigint      PRIMARY KEY,
  raw_record_id          bigint      NOT NULL REFERENCES finance.raw_record (id),
  starts_at              timestamptz NOT NULL,
  local_date             date        NOT NULL,          -- LA date of the class
  source_tz              text,                          -- Acuity calendarTimezone
  type_id                bigint,
  type_name              text,
  calendar_id            bigint,
  calendar_name          text,                          -- instructor / calendar
  client_email_norm      text,                          -- lower(trim(email)): main fuzzy-match key
  client_name            text,
  list_price_cents       bigint      NOT NULL,          -- priceSold: price before any code
  price_cents            bigint      NOT NULL,          -- price: after any code
  discount_cents         bigint      NOT NULL,          -- list_price - price
  amount_paid_cents      bigint      NOT NULL,
  tip_cents              bigint      NOT NULL,          -- paid above price, NO code used (Acuity tip option)
  code_extra_paid_cents  bigint      NOT NULL,          -- paid above price WITH a code (gift card / prepaid?) — not a tip
  paid                   boolean     NOT NULL,          -- Acuity's flag; "yes" even when a code covered everything
  certificate_code       text,
  certificate_kind       text CHECK (certificate_kind IN ('membership', 'package', 'gift', 'coupon', 'certificate_deleted')),
  is_canceled            boolean     NOT NULL,
  no_show                boolean     NOT NULL,
  booked_at              timestamptz,
  labels                 text[]      NOT NULL DEFAULT '{}',
  missing_since          timestamptz
);
CREATE INDEX stg_acuity_appointment_local_date_idx ON finance.stg_acuity_appointment (local_date);
CREATE INDEX stg_acuity_appointment_email_idx      ON finance.stg_acuity_appointment (client_email_norm);

CREATE TABLE finance.stg_acuity_payment (
  acuity_payment_key      text        PRIMARY KEY,      -- raw external_id (Acuity payments have no id)
  raw_record_id           bigint      NOT NULL REFERENCES finance.raw_record (id),
  appointment_id          bigint      NOT NULL,
  processor               text,                         -- 'square', 'cash', …
  processor_txn_id        text,                         -- Square order id (2020) or payment id (later); null for cash
  amount_cents            bigint      NOT NULL,
  paid_at                 timestamptz,
  local_date              date,
  related_payments_count  integer,
  missing_since           timestamptz
);
CREATE INDEX stg_acuity_payment_appt_idx ON finance.stg_acuity_payment (appointment_id);
CREATE INDEX stg_acuity_payment_txn_idx  ON finance.stg_acuity_payment (processor_txn_id);

CREATE TABLE finance.stg_acuity_order (
  order_id           bigint      PRIMARY KEY,
  raw_record_id      bigint      NOT NULL REFERENCES finance.raw_record (id),
  ordered_at         timestamptz,
  local_date         date,
  total_cents        bigint      NOT NULL,
  status             text,
  title              text,
  product_summary    text,
  client_email_norm  text,
  missing_since      timestamptz
);
CREATE INDEX stg_acuity_order_local_date_idx ON finance.stg_acuity_order (local_date);

-- ---------- Square ----------

CREATE TABLE finance.stg_square_payment (
  payment_id               text        PRIMARY KEY,
  raw_record_id            bigint      NOT NULL REFERENCES finance.raw_record (id),
  created_at               timestamptz NOT NULL,
  local_date               date        NOT NULL,
  status                   text        NOT NULL,          -- COMPLETED / FAILED / CANCELED / …
  amount_cents             bigint      NOT NULL,
  tip_cents                bigint      NOT NULL,
  total_cents              bigint      NOT NULL,
  refunded_cents           bigint      NOT NULL,
  fee_cents                bigint      NOT NULL,          -- sum of processing_fee[]
  source_type              text,
  square_product           text,                          -- ECOMMERCE_API (= Acuity), INVOICES, …
  order_id                 text,
  invoice_id               text,                          -- set when the payment's order belongs to an invoice
  customer_id              text,
  buyer_email_norm         text,                          -- buyer email, else the customer's email
  note                     text,                          -- may contain client names: never log
  reference_id             text,
  acuity_ref_kind          text,                          -- parseSquareNote(): appointment / order / subscription / dated / empty / other
  acuity_ref               text,                          -- the parsed appointment / order / subscription id
  acuity_certificate_code  text,                          -- subscription notes only
  missing_since            timestamptz
);
CREATE INDEX stg_square_payment_local_date_idx ON finance.stg_square_payment (local_date);
CREATE INDEX stg_square_payment_order_idx      ON finance.stg_square_payment (order_id);

CREATE TABLE finance.stg_square_order (
  order_id           text        PRIMARY KEY,
  raw_record_id      bigint      NOT NULL REFERENCES finance.raw_record (id),
  created_at         timestamptz,
  local_date         date,
  total_cents        bigint      NOT NULL,
  discount_cents     bigint      NOT NULL,
  tax_cents          bigint      NOT NULL,
  tip_cents          bigint      NOT NULL,
  line_item_count    integer     NOT NULL,
  line_item_summary  text,
  source_name        text,
  invoice            boolean     NOT NULL,
  missing_since      timestamptz
);

CREATE TABLE finance.stg_square_order_discount (
  order_id       text   NOT NULL REFERENCES finance.stg_square_order (order_id),
  discount_uid   text   NOT NULL,
  raw_record_id  bigint NOT NULL REFERENCES finance.raw_record (id),
  name           text,
  type           text,
  scope          text,
  applied_cents  bigint NOT NULL,
  PRIMARY KEY (order_id, discount_uid)
);

CREATE TABLE finance.stg_square_refund (
  refund_id      text        PRIMARY KEY,
  raw_record_id  bigint      NOT NULL REFERENCES finance.raw_record (id),
  payment_id     text,
  created_at     timestamptz,
  local_date     date,
  amount_cents   bigint      NOT NULL,
  status         text,
  reason         text,
  missing_since  timestamptz
);

-- v3: invoices are tracked whether or not they've been paid (owner decision).
CREATE TABLE finance.stg_square_invoice (
  invoice_id       text        PRIMARY KEY,
  raw_record_id    bigint      NOT NULL REFERENCES finance.raw_record (id),
  order_id         text,
  invoice_number   text,
  title            text,
  status           text,                               -- PAID / UNPAID / SCHEDULED / CANCELED / REFUNDED / …
  created_at       timestamptz,
  local_date       date,
  due_date         date,                               -- earliest payment request due date
  requested_cents  bigint      NOT NULL,               -- sum of payment_requests[].computed_amount_money
  paid_cents       bigint      NOT NULL,               -- sum of payment_requests[].total_completed_amount_money
  customer_id      text,
  missing_since    timestamptz
);

-- ---------- Privacy ----------

ALTER TABLE finance.stg_acuity_appointment    ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.stg_acuity_payment        ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.stg_acuity_order          ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.stg_square_payment        ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.stg_square_order          ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.stg_square_order_discount ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.stg_square_refund         ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.stg_square_invoice        ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM authenticated;
  END IF;
END
$$;

-- queries/docs/lineage_examples.sql
--
-- PURPOSE: feed docs/finance/data-dictionary.md with REAL but ANONYMIZED examples
-- that trace records from the API (raw_record) → staging (stg_*) → reconciliation
-- (recon_link / recon_status). Also returns row counts per table and per entity.
--
-- Run (from the repo root):
--   npm run finance -- query queries/docs/lineage_examples.sql --csv --limit 500
-- Output: apps/finance/out/lineage_examples_<from>_<to>.csv  (gitignored)
--
-- PRIVACY — nothing identifying leaves the database:
--   * names    → "[first]" / "[last]" / "[Client name]"
--   * emails   → "client@example.com"
--   * phone, address, forms, card details → never selected
--   * Square notes → only the leading Acuity reference is kept ("1764688793 … [masked]");
--     2020-era "dated" notes start with a client name, so they become "[masked]"
--   * Order line items are kept by item name/price only (their `note` holds client names)
-- Only fields listed explicitly below are read from payloads; whole payloads are never output.
--
-- Picks are deterministic (ordered by id), so re-running gives the same examples.
--   A = a booking paid online and MATCHED to its Square payment (the full happy path)
--   B = a booking with NO Square payment that needs none (package / membership / coupon)
--   C = a Square payment with NO booking (membership charge / invoice / other)
--   D = a booking MATCHED but with an amount difference (tip / discount / refund …)

with
pick_a as (
  select 'A'::text as example, a.appointment_id
    from finance.stg_acuity_appointment a
    join finance.recon_status s on s.side = 'acuity' and s.kind = 'appointment' and s.id = a.appointment_id::text
   where s.status = 'matched'
     and exists (select 1 from finance.stg_acuity_payment p where p.appointment_id = a.appointment_id)
   order by (a.certificate_code is null) desc, a.appointment_id
   limit 1
),
pick_b as (
  select 'B'::text as example, s.id::bigint as appointment_id
    from finance.recon_status s
   where s.side = 'acuity' and s.kind = 'appointment'
     and s.reason_code in ('PACKAGE_REDEMPTION', 'MEMBERSHIP', 'COUPON_FULL')
   order by s.reason_code desc, s.id
   limit 1
),
pick_d as (
  select 'D'::text as example, s.id::bigint as appointment_id
    from finance.recon_status s
   where s.side = 'acuity' and s.kind = 'appointment' and s.status = 'amount_mismatch'
   order by (s.reason_code = 'ACUITY_DISCOUNT') desc, (s.reason_code = 'TIP') desc, s.id
   limit 1
),
appt_picks as (
  select * from pick_a union all select * from pick_b union all select * from pick_d
),
pick_c as (
  select 'C'::text as example, s.id as payment_id
    from finance.recon_status s
   where s.side = 'square' and s.status = 'square_only'
   order by (s.reason_code = 'MEMBERSHIP_CHARGE') desc, (s.reason_code = 'INVOICE') desc, s.id
   limit 1
),
-- Square payments in each example: the ones linked to the picked bookings, plus pick C.
sq_picks as (
  select ap.example, l.square_payment_id as payment_id
    from appt_picks ap
    join finance.recon_link l on l.acuity_kind = 'appointment' and l.acuity_id = ap.appointment_id::text
  union all
  select example, payment_id from pick_c
),

-- ---------- masked views of each layer ----------
raw_meta as (
  select r.id, r.source, r.entity, r.external_id, r.parent_external_id,
         jsonb_build_object(
           '_raw_record_id', r.id, '_source', r.source, '_entity', r.entity, '_external_id', r.external_id,
           '_parent_external_id', r.parent_external_id, '_payload_hash', left(r.payload_hash, 12) || '…',
           '_window_date', r.window_date, '_source_created_at', r.source_created_at,
           '_first_seen_at', r.first_seen_at, '_last_seen_at', r.last_seen_at,
           '_missing_since', r.missing_since, '_last_sync_run_id', r.last_sync_run_id,
           '_previous_versions', (select count(*) from finance.raw_record_version v where v.raw_record_id = r.id)
         ) as meta,
         r.payload as p
    from finance.raw_record r
),
note_mask as (
  -- keep only the leading reference ("1764688793", "Order #123", "Subscription 792817")
  select payment_id,
         case when acuity_ref_kind in ('appointment', 'order', 'subscription')
              then (regexp_match(note, '^(\S+(?:\s+#?\d+)?)'))[1] || ' … [masked]'
              when note is null then null
              else '[masked]' end as note_masked
    from finance.stg_square_payment
),

steps as (
  -- 1. RAW Acuity appointment (selected payload fields)
  select ap.example, 1 as step, 'raw' as layer, 'raw_record (acuity / appointment)' as tbl, rm.external_id as record_key,
         jsonb_build_object(
           'id', rm.p -> 'id', 'datetime', rm.p -> 'datetime', 'datetimeCreated', rm.p -> 'datetimeCreated',
           'calendarTimezone', rm.p -> 'calendarTimezone', 'appointmentTypeID', rm.p -> 'appointmentTypeID',
           'type', rm.p -> 'type', 'calendarID', rm.p -> 'calendarID', 'calendar', rm.p -> 'calendar',
           'classID', rm.p -> 'classID',
           'firstName', '[first]', 'lastName', '[last]',
           'email', case when rm.p ->> 'email' is not null then 'client@example.com' end,
           'priceSold', rm.p -> 'priceSold', 'price', rm.p -> 'price', 'amountPaid', rm.p -> 'amountPaid',
           'paid', rm.p -> 'paid', 'certificate', rm.p -> 'certificate', 'canceled', rm.p -> 'canceled',
           'noShow', rm.p -> 'noShow', 'labels', rm.p -> 'labels'
         ) || rm.meta as data
    from appt_picks ap
    join raw_meta rm on rm.source = 'acuity' and rm.entity = 'appointment' and rm.external_id = ap.appointment_id::text

  union all
  -- 2. RAW Acuity appointment payments (children of the appointment)
  select ap.example, 2, 'raw', 'raw_record (acuity / appointment_payment)', rm.external_id,
         jsonb_build_object(
           'transactionID', rm.p -> 'transactionID', 'created', rm.p -> 'created', 'processor', rm.p -> 'processor',
           'amount', rm.p -> 'amount', 'relatedPaymentsCount', rm.p -> 'relatedPaymentsCount'
         ) || rm.meta
    from appt_picks ap
    join raw_meta rm on rm.source = 'acuity' and rm.entity = 'appointment_payment' and rm.parent_external_id = ap.appointment_id::text

  union all
  -- 3. STAGING Acuity appointment
  select ap.example, 3, 'staging', 'stg_acuity_appointment', a.appointment_id::text,
         (to_jsonb(a) - 'client_email_norm' - 'client_name')
         || jsonb_build_object(
              'client_email_norm', case when a.client_email_norm is not null then 'client@example.com' end,
              'client_name', case when a.client_name is not null then '[Client name]' end)
    from appt_picks ap
    join finance.stg_acuity_appointment a on a.appointment_id = ap.appointment_id

  union all
  -- 4. STAGING Acuity payments
  select ap.example, 4, 'staging', 'stg_acuity_payment', p.acuity_payment_key, to_jsonb(p)
    from appt_picks ap
    join finance.stg_acuity_payment p on p.appointment_id = ap.appointment_id

  union all
  -- 5. RAW Square payment (selected payload fields)
  select sp.example, 5, 'raw', 'raw_record (square / payment)', rm.external_id,
         jsonb_build_object(
           'id', rm.p -> 'id', 'created_at', rm.p -> 'created_at', 'updated_at', rm.p -> 'updated_at',
           'status', rm.p -> 'status', 'amount_money', rm.p -> 'amount_money', 'tip_money', rm.p -> 'tip_money',
           'total_money', rm.p -> 'total_money', 'refunded_money', rm.p -> 'refunded_money',
           'processing_fee', rm.p -> 'processing_fee', 'source_type', rm.p -> 'source_type',
           'card_entry_method', rm.p -> 'card_details' -> 'entry_method',
           'application_details', rm.p -> 'application_details', 'order_id', rm.p -> 'order_id',
           'customer_id', rm.p -> 'customer_id', 'reference_id', rm.p -> 'reference_id',
           'buyer_email_address', case when rm.p ->> 'buyer_email_address' is not null then 'client@example.com' end,
           'note', nm.note_masked
         ) || rm.meta
    from sq_picks sp
    join raw_meta rm on rm.source = 'square' and rm.entity = 'payment' and rm.external_id = sp.payment_id
    left join note_mask nm on nm.payment_id = sp.payment_id

  union all
  -- 6. STAGING Square payment
  select sp.example, 6, 'staging', 'stg_square_payment', s.payment_id,
         (to_jsonb(s) - 'note' - 'buyer_email_norm')
         || jsonb_build_object(
              'note', nm.note_masked,
              'buyer_email_norm', case when s.buyer_email_norm is not null then 'client@example.com' end)
    from sq_picks sp
    join finance.stg_square_payment s on s.payment_id = sp.payment_id
    left join note_mask nm on nm.payment_id = s.payment_id

  union all
  -- 7. RAW Square order behind the payment (line items without their notes)
  select sp.example, 7, 'raw', 'raw_record (square / order)', rm.external_id,
         jsonb_build_object(
           'id', rm.p -> 'id', 'created_at', rm.p -> 'created_at', 'customer_id', rm.p -> 'customer_id',
           'source', rm.p -> 'source', 'total_money', rm.p -> 'total_money',
           'total_discount_money', rm.p -> 'total_discount_money', 'total_tax_money', rm.p -> 'total_tax_money',
           'total_tip_money', rm.p -> 'total_tip_money', 'discounts', rm.p -> 'discounts',
           'line_items', (select jsonb_agg(jsonb_build_object(
                             'name', li -> 'name', 'variation_name', li -> 'variation_name', 'quantity', li -> 'quantity',
                             'base_price_money', li -> 'base_price_money', 'total_discount_money', li -> 'total_discount_money',
                             'total_money', li -> 'total_money'))
                            from jsonb_array_elements(coalesce(rm.p -> 'line_items', '[]'::jsonb)) li)
         ) || rm.meta
    from sq_picks sp
    join finance.stg_square_payment s on s.payment_id = sp.payment_id
    join raw_meta rm on rm.source = 'square' and rm.entity = 'order' and rm.external_id = s.order_id

  union all
  -- 8. STAGING Square order (+ its discounts as a nested list)
  select sp.example, 8, 'staging', 'stg_square_order (+ stg_square_order_discount)', o.order_id,
         to_jsonb(o) || jsonb_build_object('discounts',
           (select coalesce(jsonb_agg(to_jsonb(d) order by d.discount_uid), '[]'::jsonb)
              from finance.stg_square_order_discount d where d.order_id = o.order_id))
    from sq_picks sp
    join finance.stg_square_payment s on s.payment_id = sp.payment_id
    join finance.stg_square_order o on o.order_id = s.order_id

  union all
  -- 9. RECON links touching the example
  select x.example, 9, 'reconciliation', 'recon_link', l.id::text, to_jsonb(l)
    from (select example, appointment_id::text as acuity_id, null::text as payment_id from appt_picks
          union all select example, null, payment_id from pick_c) x
    join finance.recon_link l
      on (l.acuity_kind = 'appointment' and l.acuity_id = x.acuity_id) or l.square_payment_id = x.payment_id

  union all
  -- 10. RECON status for the Acuity side
  select ap.example, 10, 'reconciliation', 'recon_status (acuity side)', st.id, to_jsonb(st)
    from appt_picks ap
    join finance.recon_status st on st.side = 'acuity' and st.kind = 'appointment' and st.id = ap.appointment_id::text

  union all
  -- 11. RECON status for the Square side
  select sp.example, 11, 'reconciliation', 'recon_status (square side)', st.id, to_jsonb(st)
    from sq_picks sp
    join finance.recon_status st on st.side = 'square' and st.kind = 'payment' and st.id = sp.payment_id

  -- ---------- summary counts (no PII) ----------
  union all
  select 'COUNTS', 100, 'raw', 'raw_record', r.source || ' / ' || r.entity,
         jsonb_build_object(
           'rows', count(*), 'missing_now', count(*) filter (where r.missing_since is not null),
           'min_window_date', min(r.window_date), 'max_window_date', max(r.window_date),
           'min_source_created_at', min(r.source_created_at), 'max_source_created_at', max(r.source_created_at),
           'rows_with_versions', count(*) filter (where exists (select 1 from finance.raw_record_version v where v.raw_record_id = r.id)))
    from finance.raw_record r
   group by r.source, r.entity

  union all
  select 'COUNTS', 101, 'staging', t.tbl, null, jsonb_build_object('rows', t.n)
    from (
      select 'stg_acuity_appointment' as tbl, count(*) as n from finance.stg_acuity_appointment
      union all select 'stg_acuity_payment', count(*) from finance.stg_acuity_payment
      union all select 'stg_acuity_order', count(*) from finance.stg_acuity_order
      union all select 'stg_square_payment', count(*) from finance.stg_square_payment
      union all select 'stg_square_order', count(*) from finance.stg_square_order
      union all select 'stg_square_order_discount', count(*) from finance.stg_square_order_discount
      union all select 'stg_square_refund', count(*) from finance.stg_square_refund
      union all select 'stg_square_invoice', count(*) from finance.stg_square_invoice
      union all select 'transform_error', count(*) from finance.transform_error
      union all select 'recon_link', count(*) from finance.recon_link
      union all select 'recon_status', count(*) from finance.recon_status
      union all select 'recon_manual_override', count(*) from finance.recon_manual_override
      union all select 'sync_run', count(*) from finance.sync_run
    ) t

  union all
  select 'COUNTS', 102, 'reconciliation', 'recon_status by status/reason', st.side || ' / ' || st.status || ' / ' || coalesce(st.reason_code, '—'),
         jsonb_build_object('rows', count(*), 'exceptions', count(*) filter (where st.exception),
                            'expected_cents', sum(st.expected_cents), 'actual_cents', sum(st.actual_cents))
    from finance.recon_status st
   group by st.side, st.status, st.reason_code

  union all
  select 'COUNTS', 103, 'reconciliation', 'recon_link by rule', l.acuity_kind || ' / rule ' || l.rule || ' / ' || l.confidence,
         jsonb_build_object('rows', count(*), 'allocated_cents', sum(l.allocated_cents))
    from finance.recon_link l
   group by l.acuity_kind, l.rule, l.confidence
)
select example, step, layer, tbl as table_name, record_key, data::text as data
  from steps
 order by example, step, record_key

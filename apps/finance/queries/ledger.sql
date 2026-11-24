-- params: from (date), to (date)
-- The ledger: ONE ROW per Acuity appointment, Acuity order and Square payment
-- in the window, with its money and its reconciliation result (PRD §10).
--
-- Reading it:
--   * `side` says where the row comes from. A matched Acuity row and its Square
--     payment are BOTH listed (each `linked_to` the other), so never sum money
--     across sides — filter on side first.
--   * Acuity rows are dated by class / order date; Square rows by payment date.
--   * Money is in dollars. On Acuity rows, square_* columns are the linked
--     Square money (fees and refunds prorated by each link's allocation).
--   * Contains client names and emails: CSV output goes to the gitignored out/.
with link_money as (
  select l.acuity_kind, l.acuity_id,
         string_agg(l.square_payment_id || ' (rule ' || l.rule || ')', ', ' order by l.square_payment_id) as linked_to,
         sum(l.allocated_cents) as square_cents,
         round(sum(case when p.amount_cents <> 0 then p.fee_cents * l.allocated_cents::numeric / p.amount_cents else 0 end)) as fee_cents,
         round(sum(case when p.amount_cents <> 0 then p.refunded_cents * l.allocated_cents::numeric / p.amount_cents else 0 end)) as refund_cents
  from finance.recon_link l
  join finance.stg_square_payment p on p.payment_id = l.square_payment_id
  group by 1, 2
),
square_links as (
  select square_payment_id,
         string_agg(acuity_kind || ' ' || acuity_id || ' (rule ' || rule || ')', ', ' order by acuity_kind, acuity_id) as linked_to
  from finance.recon_link
  group by 1
),
ledger as (
  -- Acuity appointments
  select a.local_date, 'acuity' as side, 'appointment' as kind, a.appointment_id::text as id,
         a.client_name as client, a.client_email_norm as email, a.type_name as description, a.calendar_name as instructor,
         case when a.is_canceled then 'canceled' when a.no_show then 'no-show' else 'booked' end as state,
         a.certificate_kind, a.certificate_code,
         a.list_price_cents, a.price_cents as charged_cents, a.discount_cents, a.tip_cents, a.code_extra_paid_cents,
         a.amount_paid_cents, lm.square_cents, lm.fee_cents, lm.refund_cents,
         s.status, s.reason_code, s.exception, lm.linked_to
  from finance.stg_acuity_appointment a
  left join finance.recon_status s on s.side = 'acuity' and s.kind = 'appointment' and s.id = a.appointment_id::text
  left join link_money lm on lm.acuity_kind = 'appointment' and lm.acuity_id = a.appointment_id::text
  where a.local_date between :from::date and :to::date

  union all

  -- Acuity orders (packages, gift certificates, memberships)
  select o.local_date, 'acuity', 'order', o.order_id::text,
         null, o.client_email_norm, coalesce(o.product_summary, o.title), null,
         coalesce(o.status, ''), null, null,
         o.total_cents, o.total_cents, 0, 0, 0,
         case when o.status = 'paid' then o.total_cents else 0 end, lm.square_cents, lm.fee_cents, lm.refund_cents,
         s.status, s.reason_code, s.exception, lm.linked_to
  from finance.stg_acuity_order o
  left join finance.recon_status s on s.side = 'acuity' and s.kind = 'order' and s.id = o.order_id::text
  left join link_money lm on lm.acuity_kind = 'order' and lm.acuity_id = o.order_id::text
  where o.local_date between :from::date and :to::date

  union all

  -- Square payments (all statuses; failed/canceled ones carry no money)
  select p.local_date, 'square', 'payment', p.payment_id,
         null, p.buyer_email_norm,
         -- Never the note itself (it can contain client names): its parsed kind only.
         concat_ws(' · ', coalesce(p.square_product, 'Square'), nullif(o.line_item_summary, '1× Custom amount'),
                   'note: ' || p.acuity_ref_kind, case when p.invoice_id is not null then 'invoice ' || p.invoice_id end),
         null,
         lower(p.status), null, null,
         null, case when p.status = 'COMPLETED' then p.amount_cents else 0 end, null, p.tip_cents, null,
         null, case when p.status = 'COMPLETED' then p.amount_cents else 0 end, p.fee_cents, p.refunded_cents,
         s.status, s.reason_code, s.exception, sl.linked_to
  from finance.stg_square_payment p
  left join finance.stg_square_order o on o.order_id = p.order_id
  left join finance.recon_status s on s.side = 'square' and s.kind = 'payment' and s.id = p.payment_id
  left join square_links sl on sl.square_payment_id = p.payment_id
  where p.local_date between :from::date and :to::date
)
select local_date, side, kind, id, client, email, description, instructor, state,
       certificate_kind, certificate_code,
       (list_price_cents / 100.0)::numeric(12, 2)      as list_price,
       (charged_cents / 100.0)::numeric(12, 2)         as charged,
       (discount_cents / 100.0)::numeric(12, 2)        as discount,
       (tip_cents / 100.0)::numeric(12, 2)             as tip,
       (code_extra_paid_cents / 100.0)::numeric(12, 2) as code_extra_paid,
       (amount_paid_cents / 100.0)::numeric(12, 2)     as amount_paid,
       (square_cents / 100.0)::numeric(12, 2)          as square_amount,
       (fee_cents / 100.0)::numeric(12, 2)             as square_fee,
       (refund_cents / 100.0)::numeric(12, 2)          as square_refund,
       status, reason_code, exception, linked_to
from ledger
order by local_date, side, kind, id;

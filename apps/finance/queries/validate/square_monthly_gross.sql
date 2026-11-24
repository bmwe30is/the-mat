-- params: from (date), to (date)
-- Square money per studio-local (LA) month, straight from raw_record.
-- Compare with data/square-dashboard/2020-monthly.csv (PRD Phase 4 acceptance).
-- gross   = sum of amount_money over COMPLETED payments (the definition that matched
--           the dashboard to the cent in the probe, PRD §14 Q9)
-- refunds = sum of amount_money over COMPLETED refunds, by the refund's own date
-- fees    = sum of processing_fee[] on COMPLETED payments
with pay as (
  select to_char(window_date, 'YYYY-MM') as month, payload
  from finance.raw_record
  where source = 'square' and entity = 'payment'
    and window_date between :from::date and :to::date
),
fees as (
  select p.month, sum((f -> 'amount_money' ->> 'amount')::bigint) as fee_cents
  from pay p, jsonb_array_elements(coalesce(p.payload -> 'processing_fee', '[]'::jsonb)) f
  where p.payload ->> 'status' = 'COMPLETED'
  group by 1
),
ref as (
  select to_char(window_date, 'YYYY-MM') as month,
         sum((payload -> 'amount_money' ->> 'amount')::bigint) as refund_cents
  from finance.raw_record
  where source = 'square' and entity = 'refund'
    and payload ->> 'status' = 'COMPLETED'
    and window_date between :from::date and :to::date
  group by 1
)
select
  p.month,
  count(*) filter (where p.payload ->> 'status' = 'COMPLETED')                                        as completed,
  count(*) filter (where p.payload ->> 'status' <> 'COMPLETED')                                       as not_completed,
  count(*) filter (where p.payload -> 'application_details' ->> 'square_product' = 'INVOICES')        as invoice_payments,
  (coalesce(sum((p.payload -> 'amount_money' ->> 'amount')::bigint)
     filter (where p.payload ->> 'status' = 'COMPLETED'), 0) / 100.0)::numeric(12, 2)                 as gross,
  (coalesce(max(r.refund_cents), 0) / 100.0)::numeric(12, 2)                                          as refunds,
  (coalesce(max(f.fee_cents), 0) / 100.0)::numeric(12, 2)                                             as fees
from pay p
left join ref r using (month)
left join fees f using (month)
group by p.month
order by p.month;

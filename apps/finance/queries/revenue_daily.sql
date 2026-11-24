-- params: from (date), to (date)
-- One row per studio-local day, including days with no activity (PRD §10).
--
-- Two kinds of columns, on two different date bases:
--   Bookings (by CLASS date), from Acuity appointments that weren't canceled:
--     bookings, attended, gross_list (list price before codes), discounts (from
--     codes), charged_after_codes, tips (paid above price, no code), code_extra_paid
--     (paid above price with a code; not a tip).
--   Money (by PAYMENT date), cash basis:
--     square_collected (COMPLETED Square payments; the dashboard's "gross sales"),
--     acuity_cash (cash payments recorded in Acuity, adjustments included),
--     refunds (COMPLETED Square refunds, by refund date), fees (Square processing),
--     net_after_fees = square_collected + acuity_cash − refunds − fees.
-- A class paid in advance therefore shows its booking and its money on
-- different days; monthly totals line up better than daily ones.
-- `attended` = not canceled and not marked no-show (Acuity rarely records no-shows).
with days as (
  select d::date as local_date from generate_series(:from::date, :to::date, interval '1 day') d
),
bookings as (
  select local_date,
         count(*)                                         as bookings,
         count(*) filter (where not no_show)              as attended,
         sum(list_price_cents)                            as gross_list,
         sum(discount_cents)                              as discounts,
         sum(price_cents)                                 as charged_after_codes,
         sum(tip_cents)                                   as tips,
         sum(code_extra_paid_cents)                       as code_extra_paid
  from finance.stg_acuity_appointment
  where not is_canceled and local_date between :from::date and :to::date
  group by 1
),
square as (
  select local_date, sum(amount_cents) as collected, sum(fee_cents) as fees, count(*) as payments
  from finance.stg_square_payment
  where status = 'COMPLETED' and local_date between :from::date and :to::date
  group by 1
),
refunds as (
  select local_date, sum(amount_cents) as refunds
  from finance.stg_square_refund
  where status = 'COMPLETED' and local_date between :from::date and :to::date
  group by 1
),
cash as (
  select local_date, sum(amount_cents) as cash
  from finance.stg_acuity_payment
  where processor = 'cash' and local_date between :from::date and :to::date
  group by 1
)
select d.local_date,
       coalesce(b.bookings, 0)                                                     as bookings,
       coalesce(b.attended, 0)                                                     as attended,
       (coalesce(b.gross_list, 0) / 100.0)::numeric(12, 2)                         as gross_list,
       (coalesce(b.discounts, 0) / 100.0)::numeric(12, 2)                          as discounts,
       (coalesce(b.charged_after_codes, 0) / 100.0)::numeric(12, 2)                as charged_after_codes,
       (coalesce(b.tips, 0) / 100.0)::numeric(12, 2)                               as tips,
       (coalesce(b.code_extra_paid, 0) / 100.0)::numeric(12, 2)                    as code_extra_paid,
       coalesce(s.payments, 0)                                                     as square_payments,
       (coalesce(s.collected, 0) / 100.0)::numeric(12, 2)                          as square_collected,
       (coalesce(c.cash, 0) / 100.0)::numeric(12, 2)                               as acuity_cash,
       (coalesce(r.refunds, 0) / 100.0)::numeric(12, 2)                            as refunds,
       (coalesce(s.fees, 0) / 100.0)::numeric(12, 2)                               as fees,
       ((coalesce(s.collected, 0) + coalesce(c.cash, 0) - coalesce(r.refunds, 0) - coalesce(s.fees, 0)) / 100.0)::numeric(12, 2)
                                                                                    as net_after_fees
from days d
left join bookings b using (local_date)
left join square s   using (local_date)
left join refunds r  using (local_date)
left join cash c     using (local_date)
order by d.local_date;

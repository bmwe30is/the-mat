-- params: from (date), to (date)
-- What did codes cost? Per month × kind × code (PRD §10).
--   Acuity: every non-canceled appointment booked with a code, by class date.
--     Coupons are grouped by their code. Packages, gift certificates and
--     memberships are grouped by product name, because their codes are
--     per-person (and a gift code works like cash). Deleted certificates have no
--     product name left, so they share one row.
--   Square: order-level discounts, if any ever appear (none in 2020).
-- given_up = list price − price after the code.
with certificate as (
  select upper(payload ->> 'certificate') as code, payload ->> 'name' as product
  from finance.raw_record
  where source = 'acuity' and entity = 'certificate'
),
acuity as (
  select to_char(a.local_date, 'YYYY-MM') as month,
         a.certificate_kind as kind,
         case a.certificate_kind
           when 'coupon' then upper(a.certificate_code)
           when 'certificate_deleted' then '(deleted certificate)'
           else coalesce(c.product, '(unknown product)')
         end as code_or_product,
         a.list_price_cents, a.price_cents, a.discount_cents
  from finance.stg_acuity_appointment a
  left join certificate c on c.code = upper(a.certificate_code)
  where a.certificate_code is not null
    and not a.is_canceled
    and a.local_date between :from::date and :to::date
)
select month, 'acuity' as source, kind, code_or_product,
       count(*)                                          as uses,
       (sum(list_price_cents) / 100.0)::numeric(12, 2)   as list_price,
       (sum(price_cents) / 100.0)::numeric(12, 2)        as charged,
       (sum(discount_cents) / 100.0)::numeric(12, 2)     as given_up
from acuity
group by 1, 2, 3, 4

union all

select to_char(o.local_date, 'YYYY-MM'), 'square', 'square_discount', coalesce(d.name, '(unnamed)'),
       count(*), null, null, (sum(d.applied_cents) / 100.0)::numeric(12, 2)
from finance.stg_square_order_discount d
join finance.stg_square_order o using (order_id)
where o.local_date between :from::date and :to::date
group by 1, 2, 3, 4

order by month, given_up desc nulls last, code_or_product;

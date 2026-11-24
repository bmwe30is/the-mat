-- params: none
-- HEALTHY = ZERO ROWS. A COMPLETED Square payment whose order isn't in raw_record
-- means money moved but we can't see what it was for. (FAILED/CANCELED payments
-- legitimately have no order: Square doesn't keep one for a declined charge.)
select p.external_id as payment_id,
       p.window_date,
       p.payload ->> 'order_id' as order_id,
       (p.payload -> 'amount_money' ->> 'amount')::bigint as amount_cents
from finance.raw_record p
where p.source = 'square' and p.entity = 'payment'
  and p.payload ->> 'status' = 'COMPLETED'
  and not exists (
    select 1 from finance.raw_record o
    where o.source = 'square' and o.entity = 'order' and o.external_id = p.payload ->> 'order_id'
  )
order by p.window_date, p.external_id;

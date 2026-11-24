-- params: from (date), to (date)
-- HEALTHY = ZERO ROWS. Every Acuity appointment/order and every Square payment
-- in the window must have exactly one recon_status row (PRD Phase 6: "100% of
-- records have a status"). Run `reconcile` after `transform` if this fails.
select 'acuity.appointment' as entity, a.appointment_id::text as id
from finance.stg_acuity_appointment a
where a.local_date between :from::date and :to::date
  and not exists (select 1 from finance.recon_status s where s.side = 'acuity' and s.kind = 'appointment' and s.id = a.appointment_id::text)
union all
select 'acuity.order', o.order_id::text
from finance.stg_acuity_order o
where o.local_date between :from::date and :to::date
  and not exists (select 1 from finance.recon_status s where s.side = 'acuity' and s.kind = 'order' and s.id = o.order_id::text)
union all
select 'square.payment', p.payment_id
from finance.stg_square_payment p
where p.local_date between :from::date and :to::date
  and not exists (select 1 from finance.recon_status s where s.side = 'square' and s.kind = 'payment' and s.id = p.payment_id)
order by 1, 2;

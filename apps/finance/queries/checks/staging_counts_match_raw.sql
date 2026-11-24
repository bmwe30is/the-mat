-- params: none
-- HEALTHY = ZERO ROWS. Every raw record of a transformed entity must end up as
-- exactly one staging row or one transform_error (PRD Phase 5 acceptance).
with raw as (
  select source || '.' || entity as entity, count(*) as n
  from finance.raw_record
  where (source, entity) in (('acuity', 'appointment'), ('acuity', 'appointment_payment'), ('acuity', 'order'),
                             ('square', 'payment'), ('square', 'order'), ('square', 'refund'), ('square', 'invoice'))
  group by 1
),
stg as (
  select 'acuity.appointment' as entity, count(*) as n from finance.stg_acuity_appointment
  union all select 'acuity.appointment_payment', count(*) from finance.stg_acuity_payment
  union all select 'acuity.order', count(*) from finance.stg_acuity_order
  union all select 'square.payment', count(*) from finance.stg_square_payment
  union all select 'square.order', count(*) from finance.stg_square_order
  union all select 'square.refund', count(*) from finance.stg_square_refund
  union all select 'square.invoice', count(*) from finance.stg_square_invoice
),
err as (select entity, count(*) as n from finance.transform_error group by 1)
select r.entity, r.n as raw, coalesce(s.n, 0) as staged, coalesce(e.n, 0) as errors
from raw r
left join stg s using (entity)
left join err e using (entity)
where r.n <> coalesce(s.n, 0) + coalesce(e.n, 0)
order by 1;

-- params: none
-- HEALTHY = ZERO ROWS. Money that should never be negative, and Acuity rows
-- where the post-code price is above the list price (a negative discount).
-- Not checked: Acuity appointment *payments* may be negative — staff record
-- refunds/adjustments that way (e.g. -$18 cash then +$18 cash on a canceled
-- class, 2020-06-10). Those are real data; reconciliation accounts for them.
select 'acuity.appointment' as entity, appointment_id::text as id, 'negative money or discount' as problem
from finance.stg_acuity_appointment
where list_price_cents < 0 or price_cents < 0 or amount_paid_cents < 0 or discount_cents < 0
   or tip_cents < 0 or code_extra_paid_cents < 0
union all
select 'acuity.order', order_id::text, 'negative total' from finance.stg_acuity_order where total_cents < 0
union all
select 'square.payment', payment_id, 'negative money'
from finance.stg_square_payment
where amount_cents < 0 or tip_cents < 0 or total_cents < 0 or refunded_cents < 0 or fee_cents < 0
union all
select 'square.refund', refund_id, 'negative amount' from finance.stg_square_refund where amount_cents < 0
union all
select 'square.invoice', invoice_id, 'negative amount' from finance.stg_square_invoice where requested_cents < 0 or paid_cents < 0
order by 1, 2;

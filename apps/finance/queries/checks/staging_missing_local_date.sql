-- params: none
-- HEALTHY = ZERO ROWS. Every dated staging row needs a studio-local date, or it
-- silently falls out of every report. (Appointments and Square payments enforce
-- this with NOT NULL; these tables can't, because the source field is optional.)
select 'acuity.appointment_payment' as entity, acuity_payment_key as id from finance.stg_acuity_payment where local_date is null
union all select 'acuity.order', order_id::text from finance.stg_acuity_order where local_date is null
union all select 'square.order', order_id from finance.stg_square_order where local_date is null
union all select 'square.refund', refund_id from finance.stg_square_refund where local_date is null
union all select 'square.invoice', invoice_id from finance.stg_square_invoice where local_date is null
order by 1, 2;

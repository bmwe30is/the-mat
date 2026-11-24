-- params: none
-- One md5 per staging table over all rows (ordered by key). Run before and
-- after `transform`: identical checksums = the rebuild is deterministic.
-- raw_record_id is part of the rows, so this also proves rows point at the same raw records.
select 'stg_acuity_appointment' as tbl, count(*) as n, md5(string_agg(t::text, '|' order by appointment_id)) as checksum from finance.stg_acuity_appointment t
union all select 'stg_acuity_payment', count(*), md5(string_agg(t::text, '|' order by acuity_payment_key)) from finance.stg_acuity_payment t
union all select 'stg_acuity_order', count(*), md5(string_agg(t::text, '|' order by order_id)) from finance.stg_acuity_order t
union all select 'stg_square_payment', count(*), md5(string_agg(t::text, '|' order by payment_id)) from finance.stg_square_payment t
union all select 'stg_square_order', count(*), md5(string_agg(t::text, '|' order by order_id)) from finance.stg_square_order t
union all select 'stg_square_order_discount', count(*), md5(string_agg(t::text, '|' order by order_id, discount_uid)) from finance.stg_square_order_discount t
union all select 'stg_square_refund', count(*), md5(string_agg(t::text, '|' order by refund_id)) from finance.stg_square_refund t
union all select 'stg_square_invoice', count(*), md5(string_agg(t::text, '|' order by invoice_id)) from finance.stg_square_invoice t;

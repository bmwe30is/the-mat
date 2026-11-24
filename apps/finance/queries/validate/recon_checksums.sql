-- params: none
-- md5 over recon_link and recon_status (excluding run ids and serial ids).
-- Identical before and after a second `reconcile` = deterministic (PRD §9).
select 'recon_link' as tbl, count(*) as n,
       md5(string_agg(concat_ws('|', acuity_kind, acuity_id, square_payment_id, rule, confidence, allocated_cents, evidence::text), E'\n'
                      order by acuity_kind, acuity_id, square_payment_id)) as checksum
from finance.recon_link
union all
select 'recon_status', count(*),
       md5(string_agg(concat_ws('|', side, kind, id, local_date, status, reason_code, exception, expected_cents, actual_cents, delta_cents), E'\n'
                      order by side, kind, id))
from finance.recon_status;

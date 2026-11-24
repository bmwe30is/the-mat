-- params: from (date), to (date)
-- How big is each gap? Count and dollars per month × side × status × reason
-- (PRD §10). Months are studio-local: Acuity by class/order date, Square by
-- payment date. `delta` = actual − expected (negative = money missing on the
-- other side). `exceptions` counts rows that need a human (exceptions.sql).
select to_char(local_date, 'YYYY-MM')                    as month,
       side,
       kind,
       status,
       coalesce(reason_code, '')                         as reason_code,
       count(*)                                          as records,
       count(*) filter (where exception)                 as exceptions,
       (sum(expected_cents) / 100.0)::numeric(12, 2)     as expected,
       (sum(actual_cents) / 100.0)::numeric(12, 2)       as actual,
       (sum(delta_cents) / 100.0)::numeric(12, 2)        as delta
from finance.recon_status
where local_date between :from::date and :to::date
group by 1, 2, 3, 4, 5
order by 1, 2, 3, 4, 5;

-- params: from (date), to (date)
-- Acuity appointments per studio-local month, straight from raw_record.
-- Compare with data/acuity-exports/tejal-acuity - <year>.csv (PRD Phase 3 acceptance).
-- window_date is the LA class date, so the ±1-day extraction padding is excluded
-- by the :from/:to filter. Canceled appointments are included (as in the CSV export).
select
  to_char(window_date, 'YYYY-MM')                                  as month,
  count(*)                                                         as appointments,
  count(*) filter (where (payload ->> 'canceled')::boolean)        as canceled,
  count(*) filter (where missing_since is not null)                as missing_from_api
from finance.raw_record
where source = 'acuity'
  and entity = 'appointment'
  and window_date between :from::date and :to::date
group by 1
order by 1;

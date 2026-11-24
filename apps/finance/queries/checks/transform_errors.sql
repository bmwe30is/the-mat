-- params: none
-- HEALTHY = ZERO ROWS. Raw payloads `transform` couldn't map. Fix the mapper
-- (src/transform/*.ts) and re-run transform; never edit staging by hand.
select entity, raw_record_id, left(message, 200) as message, created_at
from finance.transform_error
order by entity, raw_record_id;

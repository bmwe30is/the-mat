select r.source, r.entity, r.external_id, r.first_seen_at, r.last_seen_at, r.missing_since, r.payload
  from finance.stg_acuity_appointment a
  join finance.raw_record r on r.id = a.raw_record_id
 where a.appointment_id = 369277389;

 select * from finance.recon_link   where acuity_kind = 'appointment' and acuity_id = '369277389';

 -- The full Square payment record, exactly as the API returned it
select id                     as raw_record_id,
       external_id            as square_payment_id,
       first_seen_at,
       last_seen_at,
       missing_since,
       jsonb_pretty(payload)  as payload
  from finance.raw_record
 where source = 'square'
   and entity = 'payment'
   and external_id = 'VEN0icZpLlmMhpgYQmjieivpuaB';   -- ← your square_payment_id
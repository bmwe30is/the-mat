-- Raw API records behind the data dictionary's worked examples (§7).
-- ⚠️ Not masked: payloads include client names, emails, phones and Square notes. Run locally.
with example_keys (example, step, what, source, entity, external_id, parent_external_id) as (
  values
    -- A: a $15 booking paid online, matched by rule 1a
    ('A', 1, 'Acuity booking',                         'acuity', 'appointment',         '369277389',                  null),
    ('A', 2, 'Acuity payment line(s) for the booking', 'acuity', 'appointment_payment', null,                         '369277389'),  -- found by parent (booking id): Acuity payments have no id
    ('A', 3, 'Square payment',                         'square', 'payment',             'VEN0icZpLlmMhpgYQmjieivpuaB', null),
    ('A', 4, 'Square order behind the payment',        'square', 'order',               'q5HGgzeWPygzPwZUuZ4LEp1eV',   null),
    ('A', 5, 'Merged-customer redirect (order → kept)', 'square', 'customer_alias',     'JWXT5SVDMCYB171QN49P5JT4Z0',  null),
    ('A', 6, 'Square customer (source of the email)',  'square', 'customer',            'BMRTCCTEKH5C999YTFB71QZ4VM',  null),

    -- B: a booking covered by a (deleted) package code; no payment lines exist
    ('B', 1, 'Acuity booking',                         'acuity', 'appointment',         '369276414',                  null),
    ('B', 2, 'Acuity payment line(s) (expect none)',   'acuity', 'appointment_payment', null,                         '369276414'),

    -- C: a 2020 membership charge with no booking
    ('C', 1, 'Square payment',                         'square', 'payment',             '12eCLrQSyDxJCHdQN5vx4NqXvaB', null),
    ('C', 2, 'Square order behind the payment',        'square', 'order',               'a1pQ7SKEqUaqBKM0ySJbTO2eV',   null),
    ('C', 3, 'Merged-customer redirect (order → kept)', 'square', 'customer_alias',     '1BRKW73C8RX99CPQM5TRTZXWZW',  null),
    ('C', 4, 'Square customer (source of the email)',  'square', 'customer',            'NENC94Z05N4JH8JJKCMY12R4QR',  null),

    -- D: a $16 booking matched to a $32 Square payment (exception)
    ('D', 1, 'Acuity booking',                         'acuity', 'appointment',         '496665893',                  null),
    ('D', 2, 'Acuity payment line(s) for the booking', 'acuity', 'appointment_payment', null,                         '496665893'),
    ('D', 3, 'Square payment ($32)',                   'square', 'payment',             '1kzhx6UtFe702s0HPYDYulZ5taB', null),
    ('D', 4, 'Square order behind the payment',        'square', 'order',               'O5eIJJ8njHjMSUFwJfQsFPxeV',   null),
    ('D', 5, 'Merged-customer redirect (order → kept)', 'square', 'customer_alias',     'FZSZQQSB7GR3VCJGJ9CENFZWZM',  null),
    ('D', 6, 'Square customer (source of the email)',  'square', 'customer',            'P4B9ZY3AKS1W7067009XFDRZ0G',  null)
)
select
  k.example, k.step, k.what,
  r.id as raw_record_id,                -- NULL = no raw record found for this step
  r.source, r.entity, r.external_id, r.parent_external_id,
  r.window_date, r.first_seen_at, r.last_seen_at, r.missing_since,
  (select count(*) from finance.raw_record_version v where v.raw_record_id = r.id) as previous_versions,
  jsonb_pretty(r.payload) as payload
from example_keys k
-- LEFT JOIN so a step with no match still shows (B step 2 should be empty)
left join finance.raw_record r
  on  r.source = k.source
  and r.entity = k.entity
  and (
        r.external_id = k.external_id                                            -- by the record's own id…
     or (k.external_id is null and r.parent_external_id = k.parent_external_id)  -- …or by its parent (Acuity payments)
      )
order by k.example, k.step, r.external_id;
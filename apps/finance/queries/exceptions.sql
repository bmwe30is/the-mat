-- params: from (date), to (date)
-- The actionable list (PRD §10): every reconciliation row flagged `exception`
-- (PAID_NO_SQUARE, NO_ACUITY_REF, ORDER_NO_SQUARE, ACUITY_ORDER,
-- ORDER_CHARGED_LESS, and anything UNKNOWN, including unexplained mismatches),
-- with enough context to look it up and a suggested next step.
-- Resolve one by fixing the source data, or with a recon_manual_override row
-- (queries/README.md), then re-run `reconcile`. Contains client emails.
select s.local_date,
       s.side,
       s.kind,
       s.id,
       s.status,
       s.reason_code,
       (s.expected_cents / 100.0)::numeric(12, 2) as expected,
       (s.actual_cents / 100.0)::numeric(12, 2)   as actual,
       (s.delta_cents / 100.0)::numeric(12, 2)    as delta,
       coalesce(a.client_email_norm, o.client_email_norm, p.buyer_email_norm) as email,
       coalesce(a.type_name, o.product_summary, concat_ws(' · ', p.square_product, 'note: ' || p.acuity_ref_kind)) as description,
       (select string_agg(l.square_payment_id || ' (rule ' || l.rule || ')', ', ' order by l.square_payment_id)
          from finance.recon_link l where l.acuity_kind = s.kind and l.acuity_id = s.id) as linked_square,
       case s.reason_code
         when 'PAID_NO_SQUARE'     then 'Acuity shows a card payment but no Square payment matched. Find it in Square (check the client''s email and date), or add an override.'
         when 'NO_ACUITY_REF'      then 'Square payment with no Acuity booking. Was the booking deleted or rescheduled? Link it with an override.'
         when 'ORDER_NO_SQUARE'    then 'Paid Acuity order with no Square payment. Check how it was paid.'
         when 'ACUITY_ORDER'       then 'The Square note names an Acuity order that the API no longer returns. Confirm the sale in Acuity.'
         when 'ORDER_CHARGED_LESS' then 'Square charged less than the order total. Probably a checkout coupon. Owner to confirm (PRD §14 Q12).'
         when 'UNKNOWN'            then 'No rule explains this record. Review it and add an override.'
         else 'Review.'
       end as next_step
from finance.recon_status s
left join finance.stg_acuity_appointment a on s.side = 'acuity' and s.kind = 'appointment' and a.appointment_id::text = s.id
left join finance.stg_acuity_order o       on s.side = 'acuity' and s.kind = 'order'       and o.order_id::text = s.id
left join finance.stg_square_payment p     on s.side = 'square' and p.payment_id = s.id
where s.exception
  and s.local_date between :from::date and :to::date
order by s.reason_code, s.local_date, s.side, s.id;

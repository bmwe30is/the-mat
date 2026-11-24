-- params: none
-- HEALTHY = ZERO ROWS. A Square payment shown as `matched` must have link
-- allocations that add up to exactly its amount (PRD §7.4: 1→N allocations).
select p.payment_id, p.amount_cents, sum(l.allocated_cents) as allocated_cents
from finance.recon_status s
join finance.stg_square_payment p on p.payment_id = s.id
join finance.recon_link l on l.square_payment_id = p.payment_id
where s.side = 'square' and s.status = 'matched'
group by p.payment_id, p.amount_cents
having sum(l.allocated_cents) <> p.amount_cents
order by 1;

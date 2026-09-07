-- DIP-6.1 — Dashboard Core View (Budget/Period Picker, Category States)
-- Jira: STEW-25 | Epic: STEW-6
--
-- One read-only view. security_invoker = true so the underlying budget_period /
-- category / category_limit / transaction / transaction_split RLS policies are
-- evaluated as the querying user, never bypassed (AC5). Soft-deleted categories
-- and transactions are filtered explicitly at the join layer -- RLS does not do
-- this. coalesce() guarantees non-null limit_amount / spent so the client's
-- empty/zero state (AC4) is a plain equality check.

create view v_category_period_state
with (security_invoker = true) as
select
  bp.id as budget_period_id,
  bp.budget_id,
  c.id as category_id,
  c.name as category_name,
  coalesce(cl.limit_amount, 0) as limit_amount,
  coalesce(sum(ts.amount) filter (where t.direction = 'expense'), 0) as spent
from budget_period bp
join category c
  on c.household_id = (select household_id from budget where id = bp.budget_id)
 and not c.is_deleted
left join category_limit cl
  on cl.budget_period_id = bp.id and cl.category_id = c.id
left join transaction_split ts on ts.category_id = c.id
left join transaction t
  on t.id = ts.transaction_id
 and t.budget_id = bp.budget_id
 and t.date between bp.period_start and bp.period_end
 and not t.is_deleted
group by bp.id, bp.budget_id, c.id, c.name, cl.limit_amount;

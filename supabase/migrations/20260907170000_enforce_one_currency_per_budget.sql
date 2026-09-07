-- DIP-2.4.G2 — Enforce One Currency Per Budget (DB-Layer)
-- Jira: STEW-42 | Epic: STEW-2
--
-- Product-owner-clarified invariant (2026-09-07): a single Budget is always
-- single-currency; multi-currency support means separate Budgets per currency,
-- never mixed-currency accounts within one Budget, and no FX conversion logic
-- anywhere. Nothing enforced this before -- account.currency was validated only
-- against the currency reference FK. This adds one validation trigger; the
-- first account in a Budget sets its currency implicitly. No RPC, schema-shape,
-- or client change. Mirrors fn_validate_transfer_destination_budget_scope /
-- fn_validate_category_limit_household_scope from prior stories.

create function fn_validate_account_currency_matches_budget() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_mismatch boolean;
begin
  select exists (
    select 1 from account
    where budget_id = new.budget_id
      and id <> new.id
      and not is_deleted
      and currency <> new.currency
  ) into v_mismatch;

  if v_mismatch then
    raise exception 'all accounts in a budget must share the same currency';
  end if;

  return new;
end;
$$;
revoke all on function fn_validate_account_currency_matches_budget() from public, anon, authenticated;

create trigger trg_account_validate_currency_matches_budget
  before insert or update of currency, budget_id on account
  for each row execute function fn_validate_account_currency_matches_budget();

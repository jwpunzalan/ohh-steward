-- DIP-6.3 — Accounts/Cards/Savings Summary & Detail View
-- Jira: STEW-27 | Epic: STEW-6
--
-- rpc_update_account: the validated write path for account edits from the
-- detail view. Mirrors rpc_create_account's own validation exactly. type,
-- currency, budget_id, and every balance field are intentionally NOT
-- parameters -- the RPC reads type/budget_id from the existing row, so an
-- account's type can never be changed through this function (AC2's "not its
-- type", enforced by the signature, not a UI omission). SECURITY DEFINER
-- bypasses RLS on its own writes, so can_access_budget() is re-checked
-- explicitly and fail-closed, exactly as rpc_create_account does.

create function rpc_update_account(
  p_account_id uuid,
  p_name text,
  p_target_amount numeric default null,
  p_target_date date default null,
  p_credit_limit numeric default null,
  p_due_date date default null,
  p_minimum_payment numeric default null
) returns void
security definer set search_path = public language plpgsql as $$
declare
  v_type text;
  v_budget_id uuid;
begin
  select type, budget_id into v_type, v_budget_id
  from account
  where id = p_account_id and not is_deleted;

  if v_type is null then
    raise exception 'account not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if v_type = 'savings_goal' then
    if p_target_amount is null then
      raise exception 'target_amount is required for savings_goal';
    end if;
  elsif p_target_amount is not null or p_target_date is not null then
    raise exception 'target_amount/target_date are only valid for savings_goal';
  end if;

  if v_type = 'credit_card' then
    if p_credit_limit is null then
      raise exception 'credit_limit is required for credit_card';
    end if;
  elsif p_credit_limit is not null or p_due_date is not null or p_minimum_payment is not null then
    raise exception 'credit_limit/due_date/minimum_payment are only valid for credit_card';
  end if;

  update account
  set name = p_name,
      target_amount = p_target_amount,
      target_date = p_target_date,
      credit_limit = p_credit_limit,
      due_date = p_due_date,
      minimum_payment = p_minimum_payment
  where id = p_account_id;
end;
$$;
revoke all on function rpc_update_account(uuid, text, numeric, date, numeric, date, numeric) from public, anon;
grant execute on function rpc_update_account(uuid, text, numeric, date, numeric, date, numeric) to authenticated;

-- DIP-2.2 — Account, Savings, Savings Goal & Credit Card Types
-- Jira: STEW-15 | Epic: STEW-2

-- ── account table ──────────────────────────────────────────────────
create table account (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budget(id),
  type text not null check (type in ('account','savings','savings_goal','credit_card')),
  name text not null,
  opening_balance numeric not null default 0,
  current_balance numeric not null default 0,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  is_archived boolean not null default false,
  target_amount numeric,
  target_date date,
  credit_limit numeric,
  due_date date,
  minimum_payment numeric,
  balance_owed numeric,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  check (type = 'savings_goal' or (target_amount is null and target_date is null)),
  check (type <> 'savings_goal' or target_amount is not null),
  check (type = 'credit_card' or (credit_limit is null and due_date is null
         and minimum_payment is null and balance_owed is null)),
  check (type <> 'credit_card' or credit_limit is not null)
);

alter table account enable row level security;
alter table account force row level security;

create policy budget_scoped_access on account
  for all using (can_access_budget(budget_id));

create trigger trg_audit_account
  after insert or update or delete on account
  for each row execute function fn_audit_log();

-- ── rpc_create_account ─────────────────────────────────────────────
-- All parameters are typed and bound; no dynamic SQL construction from
-- p_type or any other input (Secure Coding Obligation 1).
create function rpc_create_account(
  p_budget_id uuid,
  p_type text,
  p_name text,
  p_currency text,
  p_opening_balance numeric,
  p_target_amount numeric default null,
  p_target_date date default null,
  p_credit_limit numeric default null,
  p_due_date date default null,
  p_minimum_payment numeric default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_current_balance numeric;
  v_balance_owed numeric;
begin
  -- Authorization: SECURITY DEFINER functions are NOT subject to RLS on
  -- their own writes, even with force row level security set on the
  -- target table. The check that Story 2.1's RLS policy would apply to
  -- a client-side insert must be re-implemented explicitly here, exactly
  -- as rpc_create_budget already does for `budget`. Fail closed.
  if not can_access_budget(p_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  if p_type not in ('account','savings','savings_goal','credit_card') then
    raise exception 'invalid account type';
  end if;

  if p_type = 'savings_goal' then
    if p_target_amount is null then
      raise exception 'target_amount is required for savings_goal';
    end if;
  elsif p_target_amount is not null or p_target_date is not null then
    raise exception 'target_amount/target_date are only valid for savings_goal';
  end if;

  if p_type = 'credit_card' then
    if p_credit_limit is null then
      raise exception 'credit_limit is required for credit_card';
    end if;
  elsif p_credit_limit is not null or p_due_date is not null or p_minimum_payment is not null then
    raise exception 'credit_limit/due_date/minimum_payment are only valid for credit_card';
  end if;

  if p_type = 'credit_card' then
    v_current_balance := 0;
    v_balance_owed := coalesce(p_opening_balance, 0);
  else
    v_current_balance := coalesce(p_opening_balance, 0);
    v_balance_owed := null;
  end if;

  insert into account (
    budget_id, type, name, opening_balance, current_balance, currency,
    target_amount, target_date, credit_limit, due_date, minimum_payment, balance_owed
  ) values (
    p_budget_id, p_type, p_name, coalesce(p_opening_balance, 0), v_current_balance, upper(p_currency),
    p_target_amount, p_target_date, p_credit_limit, p_due_date, p_minimum_payment, v_balance_owed
  )
  returning id into v_account_id;

  return v_account_id;
end;
$$;

-- Explicit anon-revoke — IMPLEMENTATION_CONVENTIONS.md §3. Supabase's
-- ALTER DEFAULT PRIVILEGES grants EXECUTE to anon/authenticated/service_role
-- on every new function independently of this statement's absence, which is
-- exactly the gap tracked as STEW-33 for four earlier functions.
revoke all on function rpc_create_account(
  uuid, text, text, text, numeric, numeric, date, numeric, date, numeric
) from public, anon;

grant execute on function rpc_create_account(
  uuid, text, text, text, numeric, numeric, date, numeric, date, numeric
) to authenticated;

-- ── fn_apply_transaction_to_balance ────────────────────────────────
-- Defined now (this story's balance-maintenance concern per ATD §4.2);
-- NOT attached to `transaction` here — that table does not exist yet.
-- Story 3.1's DIP attaches this trigger; it must not redefine the function.
create function fn_apply_transaction_to_balance() returns trigger
language plpgsql as $$
declare
  v_old_signed numeric;
  v_new_signed numeric;
  v_old_type text;
  v_new_type text;
begin
  -- Sign convention: expense is negative, income is positive.
  -- account/savings/savings_goal: applied directly to current_balance.
  -- credit_card: current_balance is left untouched (not a meaningful
  -- figure for a card); balance_owed moves with the INVERSE sign --
  -- a purchase (expense) increases what's owed, a payment (income
  -- direction) decreases it.
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_signed := case when old.direction = 'income' then old.amount else -old.amount end;
    select type into v_old_type from account where id = old.account_id;
    if v_old_type = 'credit_card' then
      update account set balance_owed = balance_owed + v_old_signed
       where id = old.account_id;
    else
      update account set current_balance = current_balance - v_old_signed
       where id = old.account_id;
    end if;
  end if;

  if tg_op in ('UPDATE', 'INSERT') then
    v_new_signed := case when new.direction = 'income' then new.amount else -new.amount end;
    select type into v_new_type from account where id = new.account_id;
    if v_new_type = 'credit_card' then
      update account set balance_owed = balance_owed - v_new_signed
       where id = new.account_id;
    else
      update account set current_balance = current_balance + v_new_signed
       where id = new.account_id;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- Not exposed as a client-callable RPC endpoint: PostgREST does not expose
-- functions whose return type is `trigger` (no serializable HTTP response
-- shape), the same reason fn_audit_log() carries no explicit anon-revoke
-- live today. No revoke statement needed for this function specifically;
-- verify at Deployment time that it does not appear as a callable RPC.

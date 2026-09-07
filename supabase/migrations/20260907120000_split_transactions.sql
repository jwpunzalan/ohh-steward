-- DIP-3.2 — Split Transactions (Creation & Retroactive)
-- Jira: STEW-19 | Epic: STEW-3
--
-- Extends Story 3.1's live transaction_split with a genuine one-to-many split
-- structure, sum-to-total enforced at two independent layers (the write RPCs
-- and a deferred DB-layer constraint trigger). No CREATE TABLE (transaction_split
-- already exists), no RLS changes, no new columns. rpc_create_transaction's
-- signature is changed via explicit DROP + CREATE (not CREATE OR REPLACE) to
-- avoid a PostgREST overload-resolution hazard. The three 3.1-era trigger
-- functions (fn_apply_transaction_to_balance, fn_inherit_transaction_currency,
-- fn_validate_transaction_budget_scope) are NOT touched.

-- 1. Shared split-insertion + validation helper (used by both write paths below).
--    transaction_split itself already exists (Story 3.1) -- no CREATE TABLE here.

create or replace function public.fn_apply_transaction_splits(
  p_transaction_id uuid,
  p_household_id uuid,
  p_amount numeric,
  p_splits jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_split record;
  v_sum numeric := 0;
begin
  if p_splits is null or jsonb_array_length(p_splits) = 0 then
    raise exception 'at least one split is required';
  end if;

  for v_split in
    select * from jsonb_to_recordset(p_splits) as x(category_id uuid, amount numeric)
  loop
    if v_split.amount is null or v_split.amount <= 0 then
      raise exception 'each split amount must be greater than zero';
    end if;

    if v_split.category_id is not null and not exists (
      select 1 from category c
       where c.id = v_split.category_id
         and c.household_id = p_household_id
         and not c.is_deleted
    ) then
      raise exception 'category not found for this household';
    end if;

    v_sum := v_sum + v_split.amount;

    insert into transaction_split (transaction_id, category_id, amount)
    values (p_transaction_id, v_split.category_id, v_split.amount);
  end loop;

  if v_sum <> p_amount then
    raise exception 'split amounts (%) must sum exactly to the transaction amount (%)', v_sum, p_amount;
  end if;
end;
$$;

revoke all on function public.fn_apply_transaction_splits(uuid, uuid, numeric, jsonb) from public, anon, authenticated;

-- 2. Deferred sum-to-total constraint (the authoritative, unbypassable check).

create or replace function public.fn_check_split_sum()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_transaction_id uuid := coalesce(new.transaction_id, old.transaction_id);
  v_split_sum numeric;
  v_total numeric;
begin
  select coalesce(sum(amount), 0) into v_split_sum
    from transaction_split where transaction_id = v_transaction_id;

  select amount into v_total from transaction where id = v_transaction_id;

  if v_total is null then
    -- parent transaction was deleted in the same statement; nothing to validate.
    return null;
  end if;

  if v_split_sum <> v_total then
    raise exception 'split amounts (%) must sum exactly to the transaction amount (%)', v_split_sum, v_total;
  end if;

  return null;
end;
$$;

revoke all on function public.fn_check_split_sum() from public, anon, authenticated;

create constraint trigger trg_check_split_sum
  after insert or update or delete on transaction_split
  deferrable initially deferred
  for each row execute function fn_check_split_sum();

-- 3. Cross-tenant referential safety for transaction_split.category_id
--    (Standing Rule Sec7 rule 6 -- defense-in-depth alongside both RPCs' own checks).

create or replace function public.fn_validate_transaction_split_category_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_split_household_id uuid;
  v_category_household_id uuid;
begin
  if new.category_id is null then
    return new;
  end if;

  select b.household_id into v_split_household_id
    from transaction t
    join budget b on b.id = t.budget_id
   where t.id = new.transaction_id;

  select household_id into v_category_household_id
    from category where id = new.category_id;

  if v_split_household_id is null
     or v_category_household_id is null
     or v_split_household_id <> v_category_household_id then
    raise exception 'category does not belong to this transaction''s household';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_validate_transaction_split_category_scope() from public, anon, authenticated;

create trigger trg_transaction_split_validate_category_scope
  before insert or update of transaction_id, category_id on transaction_split
  for each row execute function fn_validate_transaction_split_category_scope();

-- 4. Extend rpc_create_transaction with an optional p_splits parameter.
--    A changed parameter list is a distinct overload to Postgres/PostgREST --
--    explicit drop + recreate, not CREATE OR REPLACE. Body is byte-identical
--    to the live version for every existing step; only the new branch at the
--    end (splits vs. the single default row) is new.

drop function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid);

create function public.rpc_create_transaction(
  p_account_id uuid,
  p_description text,
  p_amount numeric,
  p_date date,
  p_direction text default 'expense',
  p_time time default null,
  p_store text default null,
  p_category_id uuid default null,
  p_splits jsonb default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_budget_id uuid;
  v_household_id uuid;
  v_transaction_id uuid;
  v_has_splits boolean := p_splits is not null and jsonb_array_length(p_splits) > 0;
begin
  if p_direction not in ('expense', 'income') then
    raise exception 'invalid direction';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'description is required';
  end if;

  if p_date is null then
    raise exception 'date is required';
  end if;

  if v_has_splits and p_category_id is not null then
    raise exception 'p_category_id must be omitted when p_splits is provided';
  end if;

  select budget_id into v_budget_id
    from account
   where id = p_account_id and not is_deleted;

  if v_budget_id is null then
    raise exception 'account not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  select household_id into v_household_id from budget where id = v_budget_id;

  if p_category_id is not null and not exists (
    select 1 from category c
     where c.id = p_category_id
       and c.household_id = v_household_id
       and not c.is_deleted
  ) then
    raise exception 'category not found for this household';
  end if;

  insert into transaction (budget_id, account_id, description, amount, direction, date, time, store)
  values (v_budget_id, p_account_id, p_description, p_amount, p_direction, p_date, p_time, p_store)
  returning id into v_transaction_id;

  if v_has_splits then
    perform fn_apply_transaction_splits(v_transaction_id, v_household_id, p_amount, p_splits);
  else
    insert into transaction_split (transaction_id, category_id, amount)
    values (v_transaction_id, p_category_id, p_amount);
  end if;

  return v_transaction_id;
end;
$$;

revoke all on function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid, jsonb) from public, anon;
grant execute on function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid, jsonb) to authenticated;

-- 5. Retroactive split RPC.

create or replace function public.rpc_set_transaction_splits(
  p_transaction_id uuid,
  p_splits jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_budget_id uuid;
  v_household_id uuid;
  v_amount numeric;
begin
  select t.budget_id, t.amount into v_budget_id, v_amount
    from transaction t
   where t.id = p_transaction_id and not t.is_deleted;

  if v_budget_id is null then
    raise exception 'transaction not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  select household_id into v_household_id from budget where id = v_budget_id;

  delete from transaction_split where transaction_id = p_transaction_id;

  perform fn_apply_transaction_splits(p_transaction_id, v_household_id, v_amount, p_splits);
end;
$$;

revoke all on function public.rpc_set_transaction_splits(uuid, jsonb) from public, anon;
grant execute on function public.rpc_set_transaction_splits(uuid, jsonb) to authenticated;

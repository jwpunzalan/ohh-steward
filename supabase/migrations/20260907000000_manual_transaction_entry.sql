-- DIP-3.1 — Manual Transaction Entry
-- Jira: STEW-18 | Epic: STEW-3
--
-- Introduces the `transaction` / `transaction_split` schema and the single
-- atomic `rpc_create_transaction` write path, and attaches (never redefines)
-- the two trigger functions deferred from earlier stories:
--   * fn_apply_transaction_to_balance()  — defined in DIP-2.2 (20260906190851)
--   * fn_inherit_transaction_currency()  — defined in DIP-2.4 (20260906224104)
-- Both already exist; this migration contains no CREATE OR REPLACE for either.

-- 1. Tables

create table transaction (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budget(id),
  account_id uuid not null references account(id),
  description text not null,
  amount numeric not null check (amount > 0),
  direction text not null default 'expense' check (direction in ('expense','income')),
  date date not null,
  time time,
  store text,
  currency char(3) not null references currency(code),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table transaction_split (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transaction(id),
  category_id uuid references category(id),
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

-- 2. Cross-tenant referential safety (Standing Rule §7 rule 6)

create or replace function public.fn_validate_transaction_budget_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_account_budget_id uuid;
begin
  select budget_id into v_account_budget_id
    from account
   where id = new.account_id;

  if v_account_budget_id is null then
    raise exception 'referenced account does not exist';
  end if;

  if v_account_budget_id <> new.budget_id then
    raise exception 'account does not belong to the specified budget';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_validate_transaction_budget_scope() from public, anon, authenticated;

create trigger trg_transaction_validate_budget_scope
  before insert or update of budget_id, account_id on transaction
  for each row execute function fn_validate_transaction_budget_scope();

-- 3. Attach the two triggers deferred from DIP-2.2-v2 and DIP-2.4-v2.
--    fn_apply_transaction_to_balance() and fn_inherit_transaction_currency()
--    already exist -- this migration does NOT define or replace either.

create trigger trg_transaction_inherit_currency
  before insert on transaction
  for each row execute function fn_inherit_transaction_currency();

create trigger trg_transaction_apply_balance
  after insert or update or delete on transaction
  for each row execute function fn_apply_transaction_to_balance();

-- 4. Audit triggers (existing fn_audit_log(), not redefined)

create trigger trg_audit_transaction
  after insert or delete or update on transaction
  for each row execute function fn_audit_log();

create trigger trg_audit_transaction_split
  after insert or delete or update on transaction_split
  for each row execute function fn_audit_log();

-- 5. RLS: enable + force on both new tables, per IMPLEMENTATION_CONVENTIONS item 1

alter table transaction enable row level security;
alter table transaction force row level security;

alter table transaction_split enable row level security;
alter table transaction_split force row level security;

create policy budget_scoped_access on transaction
  for select using (can_access_budget(budget_id));
create policy budget_scoped_update on transaction
  for update using (can_access_budget(budget_id)) with check (can_access_budget(budget_id));
create policy budget_scoped_delete on transaction
  for delete using (can_access_budget(budget_id));
-- Deliberately no INSERT policy: creation is exclusively via rpc_create_transaction
-- (SECURITY DEFINER, bypasses RLS on its own writes). Under FORCE ROW LEVEL SECURITY
-- with no INSERT policy, a direct client insert is denied by default (fail-closed).

create policy budget_scoped_access on transaction_split
  for select using (
    exists (select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id))
  );
create policy budget_scoped_update on transaction_split
  for update using (
    exists (select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id))
  ) with check (
    exists (select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id))
  );
create policy budget_scoped_delete on transaction_split
  for delete using (
    exists (select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id))
  );
-- Same rationale: no INSERT policy; creation is exclusively via rpc_create_transaction.

-- 6. rpc_create_transaction

create or replace function public.rpc_create_transaction(
  p_account_id uuid,
  p_description text,
  p_amount numeric,
  p_date date,
  p_direction text default 'expense',
  p_time time default null,
  p_store text default null,
  p_category_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_budget_id uuid;
  v_household_id uuid;
  v_transaction_id uuid;
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

  -- Never accept budget_id from the caller -- derive it from the account itself.
  select budget_id into v_budget_id
    from account
   where id = p_account_id and not is_deleted;

  if v_budget_id is null then
    raise exception 'account not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  if p_category_id is not null then
    select b.household_id into v_household_id from budget b where b.id = v_budget_id;

    if not exists (
      select 1 from category c
       where c.id = p_category_id
         and c.household_id = v_household_id
         and not c.is_deleted
    ) then
      raise exception 'category not found for this household';
    end if;
  end if;

  insert into transaction (budget_id, account_id, description, amount, direction, date, time, store)
  values (v_budget_id, p_account_id, p_description, p_amount, p_direction, p_date, p_time, p_store)
  returning id into v_transaction_id;

  insert into transaction_split (transaction_id, category_id, amount)
  values (v_transaction_id, p_category_id, p_amount);

  return v_transaction_id;
end;
$$;

revoke all on function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid) from public, anon;
grant execute on function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid) to authenticated;

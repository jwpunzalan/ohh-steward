-- DIP-5.2 — Envelope Surplus Transfer
-- Jira: STEW-24 | Epic: STEW-5
--
-- Adds the `transfer` entity (destination-only, SELECT-only RLS, no client
-- write path) and `budget.surplus_destination_id`, and extends Story 5.1's
-- fn_rollover_budget_periods() (body-only, same zero-arg signature) with a
-- nested surplus-transfer step: when a period closes with unspent funds, a
-- destination is configured, and the Budget is single-currency, one transfer
-- row is written and the destination account's current_balance is credited by
-- the unspent amount -- atomically, in the same rollover run. fn_audit_log()
-- is reused, never redefined.

alter table budget add column surplus_destination_id uuid references account(id);

create function fn_validate_surplus_destination_scope() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_account_budget_id uuid;
  v_account_type text;
  v_account_deleted boolean;
begin
  if new.surplus_destination_id is null then
    return new;
  end if;

  select budget_id, type, is_deleted
    into v_account_budget_id, v_account_type, v_account_deleted
    from account where id = new.surplus_destination_id;

  if v_account_budget_id is null or v_account_deleted then
    raise exception 'surplus destination account not found';
  end if;
  if v_account_budget_id <> new.id then
    raise exception 'surplus destination must belong to this budget';
  end if;
  if v_account_type = 'credit_card' then
    raise exception 'surplus destination cannot be a credit card';
  end if;

  return new;
end;
$$;
revoke all on function fn_validate_surplus_destination_scope() from public, anon, authenticated;

create trigger trg_budget_validate_surplus_destination
  before insert or update of surplus_destination_id on budget
  for each row execute function fn_validate_surplus_destination_scope();

create table transfer (
  id uuid primary key default gen_random_uuid(),
  budget_period_id uuid not null references budget_period(id),
  destination_account_id uuid not null references account(id),
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
create unique index uq_transfer_period on transfer(budget_period_id);

alter table transfer enable row level security;
alter table transfer force row level security;
create policy transfer_read on transfer
  for select using (
    can_access_budget((select budget_id from budget_period where id = budget_period_id))
  );

create trigger trg_audit_transfer after insert or update or delete
  on transfer for each row execute function fn_audit_log();

create function fn_validate_transfer_destination_budget_scope() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_period_budget_id uuid;
  v_destination_budget_id uuid;
begin
  select budget_id into v_period_budget_id
    from budget_period where id = new.budget_period_id;
  select budget_id into v_destination_budget_id
    from account where id = new.destination_account_id;

  if v_period_budget_id is null or v_destination_budget_id is null
     or v_period_budget_id <> v_destination_budget_id then
    raise exception 'transfer destination does not belong to this budget';
  end if;
  return new;
end;
$$;
revoke all on function fn_validate_transfer_destination_budget_scope()
  from public, anon, authenticated;

create trigger trg_transfer_validate_destination_scope
  before insert on transfer
  for each row execute function fn_validate_transfer_destination_budget_scope();

create function fn_create_surplus_transfer(p_budget_id uuid, p_closing_period_id uuid)
returns void
security definer set search_path = public language plpgsql as $$
declare
  v_destination_id uuid;
  v_distinct_currencies int;
  v_total_limits numeric;
  v_total_spend numeric;
  v_unspent numeric;
begin
  select surplus_destination_id into v_destination_id
    from budget where id = p_budget_id;

  if v_destination_id is null then
    return; -- AC2: inactive feature, not an error
  end if;

  select count(distinct currency) into v_distinct_currencies
    from account where budget_id = p_budget_id and not is_deleted;

  if v_distinct_currencies <> 1 then
    return; -- AC7: multi-currency Budget -- inactive for this run, per Joseph's decision
  end if;

  select coalesce(sum(limit_amount), 0) into v_total_limits
    from category_limit where budget_period_id = p_closing_period_id;

  select coalesce(sum(ts.amount), 0) into v_total_spend
    from transaction_split ts
    join transaction t on t.id = ts.transaction_id
    join budget_period bp on bp.id = p_closing_period_id
   where t.budget_id = p_budget_id
     and not t.is_deleted
     and t.direction = 'expense'
     and t.date >= bp.period_start
     and t.date <= bp.period_end
     and ts.category_id in (
       select category_id from category_limit where budget_period_id = p_closing_period_id
     );

  v_unspent := v_total_limits - v_total_spend;

  if v_unspent > 0 then
    insert into transfer (budget_period_id, destination_account_id, amount)
    values (p_closing_period_id, v_destination_id, v_unspent);

    update account set current_balance = current_balance + v_unspent
      where id = v_destination_id;
  end if;
end;
$$;
revoke all on function fn_create_surplus_transfer(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fix a Story 5.1 catch-up regression (surfaced while validating this story).
-- 5.1's fn_enforce_open_period_only fires BEFORE INSERT OR UPDATE and rejects
-- any write to a period whose period_end < current_date. That is correct for
-- client-facing writes, but fn_rollover_budget_periods()'s own copy-forward
-- `insert into category_limit ... select ...` targets the period it just
-- opened -- and if pg_cron has not run for longer than one period, that new
-- period's period_end can already be in the past, so the guard would reject
-- the rollover's own insert, the outer per-budget exception block would roll
-- the whole savepoint back, and that budget would make zero rollover progress
-- on every subsequent run. Rollover marks its own transaction with a
-- transaction-local flag; the guard honours it. Client paths never set it.
create or replace function fn_enforce_open_period_only() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_period_end date;
begin
  -- The rollover job's own copy-forward INSERT is always legitimate, even
  -- into a period whose period_end is already past (catch-up after cron
  -- downtime). No client-facing path sets this flag.
  if current_setting('app.rollover', true) = 'on' then
    return new;
  end if;

  select period_end into v_period_end
    from budget_period
   where id = coalesce(new.budget_period_id, old.budget_period_id);
  if v_period_end < current_date then
    raise exception 'cannot edit limits for a closed period';
  end if;
  return new;
end;
$$;
revoke all on function fn_enforce_open_period_only() from public, anon, authenticated;

-- fn_rollover_budget_periods: body-only change (same zero-arg signature).
-- Full function restated for clarity; only the newly-added nested block
-- (marked below) differs from the live 5.1 version.
create or replace function fn_rollover_budget_periods() returns void
security definer
set search_path = public
language plpgsql as $$
declare
  r record;
  v_next_start date;
  v_next_end date;
  v_new_period_id uuid;
begin
  -- Story 5.2: mark this transaction as the rollover job so
  -- fn_enforce_open_period_only permits the copy-forward INSERT below even
  -- when a catch-up run opens a period whose period_end is already past.
  perform set_config('app.rollover', 'on', true);

  for r in
    select distinct on (b.id)
      b.id as budget_id, b.period_type, bp.id as closing_period_id, bp.period_end
    from budget b
    join budget_period bp on bp.budget_id = b.id
    where not b.is_deleted
    order by b.id, bp.period_start desc
  loop
    if r.period_end >= current_date then
      continue;
    end if;

    begin
      v_next_start := r.period_end + 1;
      v_next_end := fn_compute_period_end(r.period_type, v_next_start);

      insert into budget_period (budget_id, period_start, period_end)
      values (r.budget_id, v_next_start, v_next_end)
      returning id into v_new_period_id;

      insert into category_limit (budget_period_id, category_id, limit_amount)
      select v_new_period_id, category_id, limit_amount
        from category_limit
       where budget_period_id = r.closing_period_id;

      -- New (Story 5.2): nested so a surplus-transfer failure rolls back
      -- only this step's own savepoint, never the period/category_limit
      -- work already committed above in this same outer block.
      begin
        perform fn_create_surplus_transfer(r.budget_id, r.closing_period_id);
      exception
        when others then
          raise warning 'surplus transfer failed for budget %: %', r.budget_id, sqlerrm;
      end;

    exception
      when unique_violation then
        null;
      when others then
        raise warning 'rollover failed for budget %: %', r.budget_id, sqlerrm;
    end;
  end loop;
end;
$$;
-- Grant/revoke unchanged from the live 5.1 function (same signature):
-- already `revoke all ... from public, anon, authenticated` -- never
-- client-callable, cron-only. No grant statement needs to be re-run.

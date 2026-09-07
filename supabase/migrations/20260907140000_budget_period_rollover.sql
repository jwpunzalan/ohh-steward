-- DIP-5.1 — Budget Period Types & Rollover
-- Jira: STEW-23 | Epic: STEW-5
--
-- Adds budget_period / category_limit (SELECT-only RLS — no client write path
-- of any kind), bootstraps every Budget's first period inside rpc_create_budget
-- (body-only change, same signature), and schedules a daily pg_cron rollover
-- that copies category limits forward unchanged. Historical periods and their
-- limits are immutable at the database layer (missing write policies + two
-- BEFORE triggers), not by UI omission. fn_audit_log() is reused, never
-- redefined.

create table budget_period (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budget(id),
  period_start date not null,
  period_end date not null,
  created_at timestamptz not null default now()
);
create unique index uq_budget_period_boundary on budget_period(budget_id, period_start);

alter table budget_period enable row level security;
alter table budget_period force row level security;
create policy budget_period_read on budget_period
  for select using (can_access_budget(budget_id));

create trigger trg_audit_budget_period after insert or update or delete
  on budget_period for each row execute function fn_audit_log();

create table category_limit (
  id uuid primary key default gen_random_uuid(),
  budget_period_id uuid not null references budget_period(id),
  category_id uuid not null references category(id),
  limit_amount numeric not null check (limit_amount > 0)
);
create unique index uq_category_limit_period_category
  on category_limit(budget_period_id, category_id);

alter table category_limit enable row level security;
alter table category_limit force row level security;
create policy category_limit_read on category_limit
  for select using (
    can_access_budget((select budget_id from budget_period where id = budget_period_id))
  );

create trigger trg_audit_category_limit after insert or update or delete
  on category_limit for each row execute function fn_audit_log();

create function fn_validate_category_limit_household_scope() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_budget_household_id uuid;
  v_category_household_id uuid;
begin
  select b.household_id into v_budget_household_id
    from budget_period bp join budget b on b.id = bp.budget_id
   where bp.id = new.budget_period_id;

  select household_id into v_category_household_id
    from category where id = new.category_id;

  if v_budget_household_id is null or v_category_household_id is null
     or v_budget_household_id <> v_category_household_id then
    raise exception 'category does not belong to this budget''s household';
  end if;
  return new;
end;
$$;
revoke all on function fn_validate_category_limit_household_scope()
  from public, anon, authenticated;

create trigger trg_category_limit_validate_household_scope
  before insert or update of budget_period_id, category_id on category_limit
  for each row execute function fn_validate_category_limit_household_scope();

create function fn_enforce_open_period_only() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_period_end date;
begin
  -- Fires on INSERT and UPDATE. AC6 requires that a closed period's limits
  -- cannot be written through any client-facing path -- and rpc_upsert_category_limit's
  -- `on conflict do update` runs as an INSERT the first time a (period, category)
  -- pair is set, so an UPDATE-only guard would miss a brand-new limit written
  -- onto a historical period. The rollover job's own copy-forward INSERT always
  -- targets the freshly-opened period, whose period_end is >= current_date, so
  -- it is not blocked here.
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

create trigger trg_category_limit_enforce_open_period
  before insert or update on category_limit
  for each row execute function fn_enforce_open_period_only();

create function fn_compute_period_end(p_period_type text, p_period_start date)
returns date
security definer set search_path = public language plpgsql as $$
begin
  if p_period_type = 'monthly' then
    return (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date;
  elsif p_period_type = 'biweekly' then
    return p_period_start + 13;
  else
    raise exception 'unknown period_type: %', p_period_type;
  end if;
end;
$$;
revoke all on function fn_compute_period_end(text, date) from public, anon, authenticated;

-- rpc_create_budget: body-only change (same signature) -- insert added
-- immediately after the existing `insert into budget ... returning id`.
-- Full function restated for clarity; every other line is unchanged from
-- the live version.
create or replace function rpc_create_budget(
  p_name text,
  p_period_type text,
  p_owner_member_ids uuid[]
) returns uuid
security definer
set search_path = public
language plpgsql as $$
declare
  v_household_id uuid;
  v_caller_member_id uuid;
  v_caller_is_parent boolean;
  v_budget_count int;
  v_budget_cap int;
  v_new_budget uuid;
  v_owner_id uuid;
  v_period_start date;
  v_period_end date;
begin
  select hm.id, hm.household_id, (hm.role = 'parent')
    into v_caller_member_id, v_household_id, v_caller_is_parent
    from household_member hm
   where hm.auth_user_id = auth.uid() and not hm.is_deleted
   limit 1;

  if v_caller_member_id is null then
    raise exception 'not an active household member';
  end if;

  if not v_caller_is_parent and not (v_caller_member_id = any(p_owner_member_ids)) then
    raise exception 'members may only create a budget for themselves';
  end if;

  select budget_cap into v_budget_cap
    from household where id = v_household_id for update;

  select count(*) into v_budget_count
    from budget where household_id = v_household_id and not is_deleted;

  if v_budget_count >= v_budget_cap then
    raise exception 'household budget cap reached';
  end if;

  insert into budget (household_id, name, period_type, created_by)
  values (v_household_id, p_name, p_period_type, v_caller_member_id)
  returning id into v_new_budget;

  -- New: bootstrap the Budget's first period (Revision Note item 1).
  v_period_start := current_date;
  v_period_end := fn_compute_period_end(p_period_type, v_period_start);
  insert into budget_period (budget_id, period_start, period_end)
  values (v_new_budget, v_period_start, v_period_end);

  foreach v_owner_id in array p_owner_member_ids loop
    insert into budget_owner (budget_id, household_member_id)
    values (v_new_budget, v_owner_id);
  end loop;

  return v_new_budget;
end;
$$;
-- Grants unchanged from the live function (same signature): already
-- `revoke all ... from public` + `grant execute ... to authenticated`;
-- STEW-33 already revoked `anon` execute on this function. No grant
-- statement needs to be re-run for an unchanged signature/grant set.

create function rpc_upsert_category_limit(
  p_budget_period_id uuid,
  p_category_id uuid,
  p_limit_amount numeric
) returns uuid
security definer
set search_path = public
language plpgsql as $$
declare
  v_budget_id uuid;
  v_id uuid;
begin
  select budget_id into v_budget_id
    from budget_period where id = p_budget_period_id;

  if v_budget_id is null then
    raise exception 'period not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  insert into category_limit (budget_period_id, category_id, limit_amount)
  values (p_budget_period_id, p_category_id, p_limit_amount)
  on conflict (budget_period_id, category_id)
  do update set limit_amount = excluded.limit_amount
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function rpc_upsert_category_limit(uuid, uuid, numeric) from public, anon;
grant execute on function rpc_upsert_category_limit(uuid, uuid, numeric) to authenticated;

create function fn_rollover_budget_periods() returns void
security definer
set search_path = public
language plpgsql as $$
declare
  r record;
  v_next_start date;
  v_next_end date;
  v_new_period_id uuid;
begin
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

    exception
      when unique_violation then
        -- AC5: a duplicate firing for the same (budget_id, period_start)
        -- is an expected, already-handled no-op, not an error.
        null;
      when others then
        raise warning 'rollover failed for budget %: %', r.budget_id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function fn_rollover_budget_periods() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule(
  'rollover-budget-periods-daily',
  '0 3 * * *',
  $$select fn_rollover_budget_periods();$$
);

-- DIP — Story 2.1: Budget Entity, Ownership Assignment & Multi-Tenant Data
-- Isolation (RLS Migration)
-- Jira: STEW-14 | Epic: STEW-2 | DIP ID: DIP-2.1-v1
--
-- Ordering fix (not a change to the DIP's Code Requirements' logic, just DDL
-- statement order): the DIP's Code Requirements lists can_access_budget()
-- before the budget/budget_owner tables it queries. Unlike a `language
-- plpgsql` function body (validated lazily, at first call — confirmed in
-- Story 3.3's and 1.1's migrations), a `language sql` function's body is
-- parsed and semantically checked immediately at CREATE FUNCTION time.
-- Confirmed by local testing: `create function ... language sql as $$ select
-- exists (select 1 from not_yet_existing_table ...) $$;` fails immediately
-- with "relation does not exist" — this is not a lazy-checked plpgsql body.
-- So budget/budget_owner are created first here, then both helper functions
-- together (matching the DIP's "create the two helper functions ... do not
-- reimplement this logic per-table" grouping) — same statements, same SQL,
-- reordered only so the migration actually applies.

create table budget (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id),
  name text not null,
  period_type text not null check (period_type in ('monthly','biweekly')),
  created_by uuid not null references household_member(id),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table budget_owner (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budget(id),
  household_member_id uuid not null references household_member(id),
  unique (budget_id, household_member_id)
);

-- Verbatim from ATD §3.3
create function is_household_parent(p_household_id uuid) returns boolean
  security definer language sql as $$
    select exists (
      select 1 from household_member
      where household_id = p_household_id
        and auth_user_id = auth.uid()
        and role = 'parent'
        and not is_deleted
    )
  $$;

create function can_access_budget(p_budget_id uuid) returns boolean
  security definer language sql as $$
    select
      is_household_parent((select household_id from budget where id = p_budget_id))
      or exists (
        select 1 from budget_owner bo
        join household_member hm on hm.id = bo.household_member_id
        where bo.budget_id = p_budget_id
          and hm.auth_user_id = auth.uid()
          and not hm.is_deleted
      )
  $$;

revoke all on function is_household_parent(uuid), can_access_budget(uuid) from public;
grant execute on function is_household_parent(uuid), can_access_budget(uuid) to authenticated;

alter table budget enable row level security;
alter table budget force row level security;

create policy budget_read_write on budget
  for all using (
    is_household_parent(household_id) or can_access_budget(id)
  );

-- budget_owner itself: readable by anyone who can access the budget it
-- points at (Parent or an existing owner) — no separate write policy;
-- all writes to budget_owner happen inside rpc_create_budget (SECURITY DEFINER).
alter table budget_owner enable row level security;
alter table budget_owner force row level security;

create policy budget_owner_read on budget_owner
  for select using (can_access_budget(budget_id));

-- Audit trigger attachment, per Story 3.3's convention.
create trigger trg_audit_budget after insert or update or delete
  on budget for each row execute function fn_audit_log();
create trigger trg_audit_budget_owner after insert or update or delete
  on budget_owner for each row execute function fn_audit_log();

-- Deferred from Story 3.3 (audit_log_entry shipped RLS-enabled with zero
-- policies specifically pending is_household_parent()).
create policy audit_log_read on audit_log_entry
  for select using (
    is_household_parent((select household_id from household_member where id = household_member_id))
  );

-- Deferred from Story 1.1 (household/household_member shipped RLS-enabled
-- with zero policies specifically pending is_household_parent()). Member
-- read access to household's own settings columns is Story 2.3's concern
-- (is_household_member()), not added here — see Grounding Check.
create policy household_parent_access on household
  for all using (is_household_parent(id));

create policy household_member_read on household_member
  for select using (
    is_household_parent(household_id) or auth_user_id = auth.uid()
  );

create function rpc_create_budget(
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

  -- Row-lock the household to make the cap check atomic under concurrency
  -- (Obligation 12): two simultaneous rpc_create_budget calls cannot both
  -- pass a stale count and jointly exceed budget_cap.
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

  foreach v_owner_id in array p_owner_member_ids loop
    insert into budget_owner (budget_id, household_member_id)
    values (v_new_budget, v_owner_id);
  end loop;

  return v_new_budget;
end;
$$;

revoke all on function rpc_create_budget(text, text, uuid[]) from public;
grant execute on function rpc_create_budget(text, text, uuid[]) to authenticated;

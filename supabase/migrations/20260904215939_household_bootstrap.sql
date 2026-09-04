-- DIP — Story 1.1: Subscriber Self-Registration & Household Creation
-- Jira: STEW-10 | Epic: STEW-1 | DIP ID: DIP-1.1-v1
--
-- Depends on Story 3.3 (fn_audit_log(), PR #1, merged to dev) for the audit
-- trigger attached below, per Story 3.3's trigger-attachment convention.

create table household (
  id uuid primary key default gen_random_uuid(),
  member_cap int not null default 5,
  budget_cap int not null default 5,
  retention_years int not null default 7,
  session_timeout_minutes int not null default 30,
  notification_threshold_pct numeric not null default 90,
  created_at timestamptz not null default now()
);

create table household_member (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id),
  auth_user_id uuid not null references auth.users(id),
  role text not null check (role in ('parent','member')),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index uq_household_member_active_user
  on household_member(auth_user_id) where not is_deleted;

-- Fail-closed placeholder: RLS enabled/forced, zero policies.
-- rpc_bootstrap_household() is SECURITY DEFINER and bypasses this.
-- Real read/write policies land in Story 2.1 once is_household_parent() exists.
alter table household enable row level security;
alter table household force row level security;
alter table household_member enable row level security;
alter table household_member force row level security;

-- Audit trigger attachment, per Story 3.3's convention (fn_audit_log() must
-- already exist on `dev` — confirmed merged via PR #1 before this branch
-- was cut, per Deployment Instructions step 1).
create trigger trg_audit_household after insert or update or delete
  on household for each row execute function fn_audit_log();
create trigger trg_audit_household_member after insert or update or delete
  on household_member for each row execute function fn_audit_log();

-- Defer-FK follow-up from Story 3.3's migration (see that migration's header
-- comment): audit_log_entry.household_member_id was created without an
-- inline REFERENCES clause because household_member did not exist yet.
-- household_member now exists, so add the deferred constraint here.
alter table audit_log_entry
  add constraint fk_audit_log_entry_household_member
  foreign key (household_member_id) references household_member(id);

-- Sequencing note (not a change to this DIP's Code Requirements, applied as
-- an implementation-obligation fix, per Obligation 12 — Concurrency and
-- state — and the DIP's own "Application to this story" section, which
-- describes this exact behavior): the Code Requirements' rpc_bootstrap_household()
-- body as given is a plain check-then-act with no exception handling. Under
-- true concurrent execution (two simultaneous calls for the same auth.uid(),
-- e.g. a double-tapped submit button both landing before either commits),
-- both could pass the initial `select ... limit 1` check with a null result,
-- then both proceed to insert — the second household_member insert then
-- raises an unhandled unique_violation on uq_household_member_active_user,
-- surfacing as a hard error instead of returning the winner's household_id
-- per AC5. The DIP's own "Application to this story" text says explicitly:
-- "wrap the insert in an exception handler that re-selects on
-- unique-violation instead of surfacing a hard 500, satisfying AC5 under
-- real concurrency, not just sequential retries" — so the function below
-- adds that handler. This is implementing the obligation the DIP already
-- specifies in prose, not new authorization/business logic, so it is not
-- treated as a Blocking Question. The inner `begin ... exception ... end`
-- block gives plpgsql an implicit savepoint: on unique_violation, both the
-- household insert and the household_member insert from this call roll back
-- together, so no orphan household row is left behind.
create function rpc_bootstrap_household()
returns uuid
security definer
set search_path = public
language plpgsql as $$
declare
  v_existing_household uuid;
  v_new_household uuid;
begin
  select household_id into v_existing_household
    from household_member
   where auth_user_id = auth.uid() and not is_deleted
   limit 1;

  if v_existing_household is not null then
    return v_existing_household;
  end if;

  begin
    insert into household default values returning id into v_new_household;

    insert into household_member (household_id, auth_user_id, role)
    values (v_new_household, auth.uid(), 'parent');
  exception when unique_violation then
    select household_id into v_existing_household
      from household_member
     where auth_user_id = auth.uid() and not is_deleted
     limit 1;
    return v_existing_household;
  end;

  return v_new_household;
end;
$$;

revoke all on function rpc_bootstrap_household() from public;
grant execute on function rpc_bootstrap_household() to authenticated;

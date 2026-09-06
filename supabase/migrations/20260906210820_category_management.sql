-- DIP-2.3 — Category Management (Household-Level, Parent-Only)
-- Jira: STEW-16 | Epic: STEW-2

-- ── category table ─────────────────────────────────────────────────
create table category (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id),
  name text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create function is_household_member(p_household_id uuid) returns boolean
  security definer language sql as $$
    select exists (
      select 1 from household_member
      where household_id = p_household_id
        and auth_user_id = auth.uid()
        and not is_deleted
    )
  $$;

alter table category enable row level security;
alter table category force row level security;

create policy category_read on category
  for select using (is_household_member(household_id));

create policy category_insert on category
  for insert with check (is_household_parent(household_id));

create policy category_update on category
  for update
  using (is_household_parent(household_id))
  with check (is_household_parent(household_id));

-- Deliberately no DELETE policy: category rows are never hard-deleted by
-- any client role, including Parents. Removal goes exclusively through
-- rpc_delete_category's soft delete (is_deleted = true).

create trigger trg_audit_category
  after insert or update or delete on category
  for each row execute function fn_audit_log();

-- Explicit anon-revoke — IMPLEMENTATION_CONVENTIONS.md §3. Supabase's
-- ALTER DEFAULT PRIVILEGES grants EXECUTE to anon/authenticated/service_role
-- on every new function independently of this statement's absence, which is
-- exactly the gap tracked as STEW-33 for four earlier functions.
revoke all on function is_household_member(uuid) from public, anon;
grant execute on function is_household_member(uuid) to authenticated;

-- ── rpc_upsert_category ────────────────────────────────────────────
-- Parameter order corrected from the v1 draft: a parameter with a DEFAULT
-- must follow every parameter without one (Postgres syntax requirement) --
-- v1's `p_id uuid default null` as the FIRST parameter, ahead of two
-- required parameters, would fail to deploy as written.
create function rpc_upsert_category(
  p_household_id uuid,
  p_name text,
  p_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_id uuid;
  v_existing_household_id uuid;
begin
  if p_id is null then
    -- INSERT path: p_household_id is exactly the value being written,
    -- so it is safe to authorize against directly -- there is no
    -- existing row for a caller to have mismatched it against.
    if not is_household_parent(p_household_id) then
      raise exception 'not authorized for this household';
    end if;

    insert into category (household_id, name)
    values (p_household_id, p_name)
    returning id into v_category_id;
  else
    -- UPDATE path: authorize against the category's ACTUAL household_id,
    -- looked up from the row itself -- never against the caller-supplied
    -- p_household_id. Trusting the caller's value here would let a Parent
    -- of household A pass their own (authorized) household_id while
    -- supplying the id of a category belonging to household B, and rename
    -- another household's category (CWE-639; ASVS V4). This is the core
    -- fix in DIP-2.3-v2 -- see Revision Note item 2.
    select household_id into v_existing_household_id
      from category where id = p_id and not is_deleted;

    if v_existing_household_id is null then
      raise exception 'category not found';
    end if;

    if not is_household_parent(v_existing_household_id) then
      raise exception 'not authorized for this household';
    end if;

    if p_household_id is distinct from v_existing_household_id then
      raise exception 'cannot move a category to a different household';
    end if;

    update category set name = p_name
      where id = p_id and household_id = v_existing_household_id;

    v_category_id := p_id;
  end if;

  return v_category_id;
end;
$$;

revoke all on function rpc_upsert_category(uuid, text, uuid) from public, anon;
grant execute on function rpc_upsert_category(uuid, text, uuid) to authenticated;

-- ── rpc_delete_category (soft delete only) ─────────────────────────
create function rpc_delete_category(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_rows int;
begin
  -- Same server-derived-household_id pattern as the update path above:
  -- p_id is the only client input here, so the household it belongs to
  -- is looked up server-side, never supplied by the caller -- there is
  -- nothing for a caller to spoof.
  select household_id into v_household_id
    from category where id = p_id and not is_deleted;

  if v_household_id is null then
    raise exception 'category not found';
  end if;

  if not is_household_parent(v_household_id) then
    raise exception 'not authorized for this household';
  end if;

  update category set is_deleted = true
    where id = p_id and household_id = v_household_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'category not found';
  end if;
end;
$$;

revoke all on function rpc_delete_category(uuid) from public, anon;
grant execute on function rpc_delete_category(uuid) to authenticated;

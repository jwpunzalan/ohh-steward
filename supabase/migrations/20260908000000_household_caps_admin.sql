-- DIP-7.1 — Household Setup, Invite/Cap Management (Web, Parent-Only)
-- Jira: STEW-50 | Epic: STEW-7
--
-- Two CHECK constraints bound household.member_cap / budget_cap regardless of
-- write path (form, RPC, or a raw client .update()) -- a data-integrity change,
-- not an authorization change (the household_parent_access RLS policy is
-- untouched). Plus rpc_update_household_caps: the story's own validated write
-- path, server-deriving the caller's household (never a client-supplied id),
-- fail-closed for a non-Parent, with a friendly range message ahead of the
-- CHECK backstop. trg_audit_household already covers the UPDATE.

alter table household
  add constraint household_member_cap_range check (member_cap between 1 and 50),
  add constraint household_budget_cap_range check (budget_cap between 1 and 50);

create or replace function rpc_update_household_caps(p_member_cap int, p_budget_cap int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_household_id uuid;
begin
  select household_id into v_household_id
    from household_member
    where auth_user_id = auth.uid()
      and role = 'parent'
      and is_deleted = false;

  if v_household_id is null then
    raise exception 'not authorized';
  end if;

  if p_member_cap is null or p_member_cap < 1 or p_member_cap > 50
     or p_budget_cap is null or p_budget_cap < 1 or p_budget_cap > 50 then
    raise exception 'caps must be between 1 and 50';
  end if;

  update household
    set member_cap = p_member_cap,
        budget_cap = p_budget_cap
    where id = v_household_id;
end;
$$;

revoke execute on function rpc_update_household_caps(int, int) from public;
revoke execute on function rpc_update_household_caps(int, int) from anon;
grant execute on function rpc_update_household_caps(int, int) to authenticated;

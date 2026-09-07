-- STEW-33 — explicit anon-revoke retrofit on 3 of the 4 originally-named
-- functions (rpc_bootstrap_household already has zero anon/authenticated
-- grants live — confirmed this session, excluded here, not touched).
revoke execute on function public.rpc_create_budget(text, text, uuid[]) from anon;
revoke execute on function public.is_household_parent(uuid) from anon;
revoke execute on function public.can_access_budget(uuid) from anon;

-- STEW-35 — rpc_accept_invite hardening. Same signature as the live
-- function (uuid, text, uuid) -- CREATE OR REPLACE is safe here, no
-- PostgREST overload hazard, and grants (service_role-only) are preserved
-- automatically by REPLACE (unlike a DROP+CREATE, which would require
-- re-granting). Only the household_member insert gains a nested exception
-- block; every other line is byte-identical to the live body.
create or replace function public.rpc_accept_invite(p_token uuid, p_email text, p_auth_user_id uuid)
returns void
security definer
set search_path = public
language plpgsql
as $$
declare
  v_invite record;
begin
  select * into v_invite
    from invite
   where token = p_token
   for update;

  if v_invite is null
     or v_invite.status <> 'pending'
     or v_invite.expires_at <= now()
     or v_invite.email <> p_email then
    raise exception 'invalid or expired invite';
  end if;

  -- STEW-35: the RPC itself is the authoritative boundary for this
  -- constraint, independent of what its current one caller (the
  -- accept-invite Edge Function) happens to already catch generically.
  begin
    insert into household_member (household_id, auth_user_id, role)
    values (v_invite.household_id, p_auth_user_id, v_invite.role);
  exception
    when unique_violation then
      raise exception 'invalid or expired invite';
  end;

  update invite set status = 'accepted' where id = v_invite.id;
end;
$$;

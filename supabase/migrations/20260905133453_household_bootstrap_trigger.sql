-- DIP-1.1.G2 — Fix Household Bootstrap Under Mandatory Email Confirmation
-- Jira: STEW-34 | Epic: STEW-1
--
-- Bootstrap a new household + household_member(parent) row directly from auth.users,
-- independent of email-confirmation state or any client session.
--
-- Blocking regression found and closed during local validation (not
-- anticipated by the DIP): Story 1.2's accept-invite Edge Function calls
-- Supabase Auth Admin createUser() *before* calling rpc_accept_invite() —
-- see supabase/functions/accept-invite/index.ts. An unconditional AFTER
-- INSERT trigger on auth.users fires immediately on that createUser() call,
-- before rpc_accept_invite() ever runs. Confirmed empirically against the
-- real local stack: the trigger bootstraps a throwaway household (role
-- 'parent') for the invitee first, then rpc_accept_invite()'s own
-- household_member insert hits uq_household_member_active_user and fails
-- with a raw, uncaught `duplicate key value violates unique constraint`
-- (23505) — not the AC6-required generic "invalid or expired invite"
-- message. The Edge Function's existing orphan-cleanup then deletes the
-- just-created auth.users row, which (via Story 1.3's `on delete set null`
-- fix) leaves the trigger-created household/household_member row
-- permanently orphaned — and the genuinely valid invite is left unaccepted,
-- failing identically on every retry. This would have permanently broken
-- Story 1.2's already-merged invite-acceptance flow for every future
-- invited user.
--
-- Fixed by skipping self-bootstrap when a pending invite exists for this
-- exact email: at the moment createUser() fires this trigger, the matching
-- invite is still 'pending' (rpc_accept_invite() hasn't run yet), so this
-- reliably distinguishes "this auth.users insert is invite-acceptance-
-- driven" from a genuine self-registration, using data this schema already
-- has (the invite table, Story 1.2) — no change to accept-invite's own code,
-- and no change to who is authorized to do what.
create or replace function public.fn_bootstrap_household()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing_household uuid;
  v_new_household uuid;
  v_has_pending_invite boolean;
begin
  select household_id into v_existing_household
    from household_member
   where auth_user_id = new.id and not is_deleted
   limit 1;

  if v_existing_household is not null then
    return new;
  end if;

  select exists (
    select 1 from invite where email = new.email and status = 'pending'
  ) into v_has_pending_invite;

  if v_has_pending_invite then
    return new;
  end if;

  begin
    insert into household default values returning id into v_new_household;

    insert into household_member (household_id, auth_user_id, role)
    values (v_new_household, new.id, 'parent');
  exception when unique_violation then
    -- a concurrent path already bootstrapped this user; nothing further to do
    null;
  end;

  return new;
end;
$$;

revoke all on function public.fn_bootstrap_household() from public, anon, authenticated;

create trigger trg_bootstrap_household_on_signup
  after insert on auth.users
  for each row execute function public.fn_bootstrap_household();

-- Close STEW-33's finding for this specific function: no client caller remains after this story.
revoke all on function public.rpc_bootstrap_household() from anon, authenticated;

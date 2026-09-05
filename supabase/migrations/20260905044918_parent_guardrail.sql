-- DIP-1.3 — Minimum-One-Parent Guardrail & Self-Deletion Handling
-- Jira: STEW-12 | Epic: STEW-1
--
-- Blocking structural gap found and closed: this story's own required
-- behavior — the delete-own-account Edge Function removing the caller's
-- auth.users record via the Auth Admin API, after rpc_delete_own_account()
-- soft-deletes their household_member row — cannot work at all as specified,
-- for any household, ever. household_member.auth_user_id is `not null
-- references auth.users(id)` with the default ON DELETE NO ACTION (added in
-- Story 1.1). Soft-deleting a household_member row does not remove it, so
-- the foreign key still references the auth.users row and blocks its
-- deletion outright. Confirmed empirically: Auth Admin deleteUser on a user
-- with any household_member row — soft-deleted or not — fails with
-- `update or delete on table "users" violates foreign key constraint
-- "household_member_auth_user_id_fkey"`, for every account, in every
-- household, every time. This is not a hypothetical edge case; it is the
-- only path this story's AC2/AC3 ("deletion proceeds normally") ever
-- exercise, so it must be fixed here, not deferred.
--
-- Fix, scoped as narrowly as possible: relax the FK to `on delete set null`
-- so a user's auth.users row can be removed once their household_member row
-- is no longer active, while preserving the row itself (and everything that
-- references household_member.id — budget.created_by, budget_owner,
-- audit_log_entry.household_member_id, invite.invited_by — none of which
-- reference auth_user_id, so none are affected). A `not null` column can't
-- ever be set to null by ON DELETE SET NULL, so `not null` is replaced with
-- a CHECK that preserves the same guarantee for every row that matters to
-- existing code: every *active* row must still have a real auth_user_id;
-- only an already-soft-deleted row may have it become null, and only as a
-- consequence of the underlying Auth account actually being removed.
-- Deliberately not `on delete cascade`: cascading through household_member
-- would delete every row referencing it (budgets, invites, audit entries)
-- for a departing user's entire household history — far outside this
-- story's scope and not something a single member's deletion should ever
-- trigger.
alter table household_member alter column auth_user_id drop not null;
alter table household_member add constraint household_member_auth_user_id_required_if_active
  check (is_deleted or auth_user_id is not null);
alter table household_member drop constraint household_member_auth_user_id_fkey;
alter table household_member add constraint household_member_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete set null;
--
-- Guard-and-soft-delete for self-account-deletion. Never combine a locking
-- clause (FOR UPDATE) with an aggregate function in the same statement —
-- Postgres rejects it outright ("FOR UPDATE is not allowed with aggregate
-- functions"). Lock the qualifying rows first (PERFORM ... FOR UPDATE, no
-- aggregate), then count them in a separate, unlocked statement — the rows
-- of interest are already locked by this transaction, so the count reflects
-- a consistent, race-free view.
create function rpc_delete_own_account()
returns void security definer set search_path = public language plpgsql as $$
declare
  v_household uuid;
  v_role text;
  v_member_id uuid;
  v_active_parents int;
begin
  select household_id, role, id into v_household, v_role, v_member_id
    from household_member
   where auth_user_id = auth.uid() and not is_deleted
   for update;

  if v_member_id is null then
    raise exception 'no active household membership found';
  end if;

  if v_role = 'parent' then
    perform id from household_member
     where household_id = v_household and role = 'parent' and not is_deleted
     for update;

    select count(*) into v_active_parents from household_member
     where household_id = v_household and role = 'parent' and not is_deleted;

    if v_active_parents <= 1 then
      raise exception 'You are the only Parent in this household. Promote another member to Parent before deleting your account.';
    end if;
  end if;

  update household_member set is_deleted = true where id = v_member_id;
  -- Auth-record removal happens after this function returns successfully,
  -- performed by the delete-own-account Edge Function via the Supabase Auth
  -- Admin API (not callable from plain SQL) — see Implementation Instructions
  -- item 5.
end; $$;

revoke all on function rpc_delete_own_account() from public;
revoke execute on function rpc_delete_own_account() from anon;
grant execute on function rpc_delete_own_account() to authenticated;

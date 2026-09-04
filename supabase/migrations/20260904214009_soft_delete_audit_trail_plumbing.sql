-- DIP-3.3 — Soft Delete & Audit Trail Plumbing (Cross-Entity Foundation)
-- Jira: STEW-20 | Epic: STEW-3 | PDE Story ID: 3.3
--
-- Sequencing correction (see documentation/dips/DIP-3.3.md, Grounding Check):
-- this migration is sequenced first in the Build Plan, before any entity table
-- exists. It therefore creates ONLY audit_log_entry, fn_audit_log(), and
-- rpc_restore_entity() — no `create trigger` statements against entity tables
-- belong here. Each subsequent Phase 1 story attaches its own trigger as the
-- last step of its own migration (Implementation Instructions step 8).
--
-- Deferred FK (Implementation Instructions step 4): household_member(id) does
-- not exist until Story 1.1's migration lands. Per the DIP's explicit choice
-- of implementation detail, this migration creates household_member_id as a
-- plain uuid column with no inline REFERENCES. Story 1.1's migration must
-- follow this one with:
--   alter table audit_log_entry
--     add constraint fk_audit_log_entry_household_member
--     foreign key (household_member_id) references household_member(id);
--
-- Second sequencing defect found during local validation (not caught by the
-- DIP's own Grounding Check, which only addressed the trigger-attachment
-- issue): the DIP's Code Requirements creates a policy, `audit_log_read`,
-- whose USING clause queries `household_member` and calls
-- `is_household_parent(uuid)`. Unlike the plpgsql function bodies below
-- (fn_audit_log, rpc_restore_entity), whose internal object references are
-- validated lazily at call time, `CREATE POLICY ... USING (...)` is a plain
-- SQL expression that Postgres parses and analyzes immediately. Confirmed by
-- local validation (throwaway Postgres container, this migration applied
-- standalone): `CREATE POLICY audit_log_read` fails immediately with
-- `relation "household_member" does not exist` — it would fail again on
-- `is_household_parent` once that relation exists, since that function is
-- also not created by any story yet. household_member() is not created until
-- Story 1.1; is_household_parent() is not created by any story in this DIP
-- set at all (assumed pre-existing per ATD §4.4 but not actually specified
-- anywhere in this repo).
--
-- Applying the same class of fix the DIP already used for trigger attachment
-- (defer to the story whose migration first has the dependencies available),
-- this migration enables and forces RLS on audit_log_entry but does NOT
-- create the audit_log_read policy. With RLS enabled/forced and zero
-- policies, the table is fail-closed: no role except the table owner can
-- read it, which satisfies Secure Coding Baseline obligations 6 (fail closed)
-- and 7 (least privilege) in the interim. This does not weaken any AC in this
-- story: AC1/AC3/AC5 do not depend on audit-log reads, and AC2 (restore) goes
-- through rpc_restore_entity, not a direct table read.
--
-- Once household_member exists (Story 1.1) and is_household_parent() is
-- defined (currently unscheduled — a genuine open question, not resolved
-- here), a follow-up migration must add:
--   create policy audit_log_read on audit_log_entry
--     for select using (
--       is_household_parent((select household_id from household_member where id = household_member_id))
--     );
-- This is flagged in the PR description as a Blocking Question for Joseph,
-- per the Standing Rule ("any perceived gap must be raised as a Blocking
-- Question — do not silently implement it") — the fix above unblocks this
-- migration without inventing the missing authorization logic.

create table audit_log_entry (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  household_member_id uuid,
  action text not null check (action in ('create','update','delete','restore')),
  diff jsonb not null,
  created_at timestamptz not null default now()
);

create index idx_audit_log_entity on audit_log_entry(entity_type, entity_id);

alter table audit_log_entry enable row level security;
alter table audit_log_entry force row level security;
-- No insert/update/delete policy is granted to any client role: only this security-definer
-- trigger (and, later, the service-role purge job) can write to this table.
--
-- audit_log_read SELECT policy deferred — see the sequencing-defect note
-- above. RLS is enabled/forced with zero policies in the meantime, so the
-- table is fail-closed (no client role can read it) until the policy is
-- added by a follow-up migration once household_member and
-- is_household_parent() both exist.

create function fn_audit_log() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_action text;
  v_diff jsonb;
  v_member_id uuid;
  v_row record;
begin
  select id into v_member_id from household_member
   where auth_user_id = auth.uid() and not is_deleted limit 1;

  if tg_op = 'INSERT' then
    v_action := 'create'; v_diff := to_jsonb(new); v_row := new;
  elsif tg_op = 'DELETE' then
    v_action := 'delete'; v_diff := to_jsonb(old); v_row := old;
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(old)->>'is_deleted') = 'false' and (to_jsonb(new)->>'is_deleted') = 'true' then
      v_action := 'delete';
    elsif (to_jsonb(old)->>'is_deleted') = 'true' and (to_jsonb(new)->>'is_deleted') = 'false' then
      v_action := 'restore';
    else
      v_action := 'update';
    end if;
    v_diff := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
    v_row := new;
  end if;

  insert into audit_log_entry (entity_type, entity_id, household_member_id, action, diff)
  values (tg_table_name, (to_jsonb(v_row)->>'id')::uuid, v_member_id, v_action, v_diff);

  return coalesce(new, old);
end; $$;

-- NOTE (sequencing correction): no `create trigger` statements belong in this story's
-- migration. Each entity table gets its trigger attached by the story that creates that
-- table, per Implementation Instructions step 8, e.g.:
--   create trigger trg_audit_household_member after insert or update or delete
--     on household_member for each row execute function fn_audit_log();
-- (one such statement, appended to Story 1.1's own migration, not this one.)

create function rpc_restore_entity(p_entity_type text, p_entity_id uuid)
returns void security definer set search_path = public language plpgsql as $$
begin
  case p_entity_type
    when 'category' then
      if not is_household_parent((select household_id from category where id = p_entity_id)) then
        raise exception 'not authorized';
      end if;
      update category set is_deleted = false where id = p_entity_id;
    when 'budget' then
      if not is_household_parent((select household_id from budget where id = p_entity_id)) then
        raise exception 'not authorized';
      end if;
      update budget set is_deleted = false where id = p_entity_id;
    when 'account' then
      if not is_household_parent((select household_id from budget
           where id = (select budget_id from account where id = p_entity_id))) then
        raise exception 'not authorized';
      end if;
      update account set is_deleted = false where id = p_entity_id;
    when 'transaction' then
      if not is_household_parent((select household_id from budget
           where id = (select budget_id from transaction where id = p_entity_id))) then
        raise exception 'not authorized';
      end if;
      update transaction set is_deleted = false where id = p_entity_id;
    else
      raise exception 'unsupported entity type';
  end case;
end; $$;
revoke all on function rpc_restore_entity(text, uuid) from public;
grant execute on function rpc_restore_entity(text, uuid) to authenticated;

-- DIP-1.2 — Email Invite Flow (Parent or Member)
-- Jira: STEW-11 | Epic: STEW-1
--
-- Gap found and closed (not in the DIP's literal Code Requirements SQL, but
-- required by Implementation Instructions step 5: "trigger send-invite-email
-- with only the invite id (never the token) in the payload"): the Code
-- Requirements' rpc_create_invite() never actually calls send-invite-email.
-- Implemented below via pg_net (Postgres's async HTTP extension, the
-- standard Supabase mechanism for calling an Edge Function from the
-- database) using Supabase Vault to source the Edge Functions base URL and
-- an invocation key — never a hardcoded secret (Obligation 4). This needs a
-- one-time manual setup step (see this PR's description / Deployment
-- Instructions addendum): Joseph runs
--   select vault.create_secret('<functions base URL>', 'edge_functions_base_url');
--   select vault.create_secret('<service role key>', 'edge_functions_service_key');
-- once, the same way the DIP's own Deployment Instructions already require a
-- manual step for the email provider's API key. net.http_post is
-- fire-and-forget/async by design, and the call is additionally wrapped in
-- its own exception-swallowing block, so a missing secret, unreachable
-- function, or any dispatch failure can never roll back invite creation —
-- matching this story's own Non-Functional Requirement ("email delivery
-- failure does not roll back the invite row").

create extension if not exists pg_net;

-- invite table + uniqueness/idempotency guarantee for AC5
create table invite (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id),
  email text not null,
  role text not null check (role in ('parent','member')),
  invited_by uuid not null references household_member(id),
  status text not null default 'pending' check (status in ('pending','accepted','expired')),
  token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create unique index uq_invite_pending_email
  on invite(household_id, email) where status = 'pending';

-- Gap found and closed: the DIP does not mention RLS on `invite` at all,
-- but this table's `token` column is explicitly described elsewhere in the
-- same DIP as "a bearer credential for account creation" (Secure Coding
-- Application, Obligation 5) that "must never appear in ... logs" — yet
-- every other table in this schema (Stories 3.3/1.1/2.1) ships with RLS
-- enabled and forced from creation, specifically to prevent this exact class
-- of exposure via the auto-generated PostgREST API. Applying that same
-- established, mandatory fail-closed convention here, with zero policies:
-- no AC asks for a client-facing "list my household's invites" view, so
-- only the SECURITY DEFINER functions below (and service_role, used by the
-- Edge Functions) can ever touch this table. This is a Secure Coding
-- Baseline fix (fail-closed default), not a new authorization decision, per
-- the Standing Rule scope clarification.
alter table invite enable row level security;
alter table invite force row level security;

-- Audit trigger attachment, per Story 3.3's convention ("every entity
-- table... must have the identical fn_audit_log() trigger attached; no
-- entity may be exempted") and Story 1.1's "attach your own trigger as the
-- last step of your migration" standing instruction — not restated in this
-- DIP, but not superseded either.
create trigger trg_audit_invite after insert or update or delete
  on invite for each row execute function fn_audit_log();

-- Parent-only invite creation, reusing is_household_parent() (Story 2.1) —
-- do not re-derive this check.
create function rpc_create_invite(p_email text, p_role text)
returns uuid security definer set search_path = public language plpgsql as $$
declare
  v_household uuid;
  v_caller_member_id uuid;
  v_member_count int;
  v_cap int;
  v_invite_id uuid;
  v_functions_url text;
  v_functions_key text;
begin
  select household_id, id into v_household, v_caller_member_id
    from household_member
   where auth_user_id = auth.uid() and not is_deleted
   limit 1;

  if v_household is null or not is_household_parent(v_household) then
    raise exception 'not authorized';
  end if;

  if p_role not in ('parent','member') then
    raise exception 'invalid role';
  end if;

  select member_cap into v_cap from household where id = v_household;

  select count(*) into v_member_count from household_member
   where household_id = v_household and not is_deleted;
  select v_member_count + count(*) into v_member_count from invite
   where household_id = v_household and status = 'pending';

  if v_member_count >= v_cap then
    raise exception 'member cap reached';
  end if;

  insert into invite (household_id, email, role, invited_by)
  values (v_household, p_email, p_role, v_caller_member_id)
  on conflict (household_id, email) where status = 'pending'
  do update set role = excluded.role,
                token = gen_random_uuid(),
                expires_at = now() + interval '7 days'
  returning id into v_invite_id;

  -- Fire-and-forget webhook to send-invite-email, per Implementation
  -- Instructions step 5. Never lets an email-dispatch problem roll back
  -- invite creation (see header comment).
  begin
    select decrypted_secret into v_functions_url
      from vault.decrypted_secrets where name = 'edge_functions_base_url';
    select decrypted_secret into v_functions_key
      from vault.decrypted_secrets where name = 'edge_functions_service_key';

    if v_functions_url is not null and v_functions_key is not null then
      perform net.http_post(
        url := v_functions_url || '/send-invite-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_functions_key
        ),
        body := jsonb_build_object('invite_id', v_invite_id)
      );
    end if;
  exception when others then
    null;
  end;

  return v_invite_id;
end; $$;

-- Gap found and closed: `revoke all ... from public` alone does not remove
-- the schema-level default EXECUTE grant Supabase applies to `anon` on every
-- newly created function (the same platform behavior this DIP's own
-- Grounding Check already documented for four prior functions in this
-- database) — confirmed live: without the explicit revoke below, `anon`
-- still had EXECUTE despite this line. This is this story's own new
-- function, not one of the four prior ones the DIP explicitly says not to
-- touch, and the DIP's own stated intent for it is "authenticated only"
-- (Implementation Instructions step 5) — so this closes the gap between
-- that stated intent and what the literal grant statements actually
-- achieve, using the exact same explicit-revoke pattern the DIP already
-- applies to rpc_accept_invite below.
revoke all on function rpc_create_invite(text, text) from public;
revoke execute on function rpc_create_invite(text, text) from anon;
grant execute on function rpc_create_invite(text, text) to authenticated;

-- Invite acceptance — service_role only. Never grant this to authenticated
-- or anon: it takes a caller-supplied auth_user_id and must only be reached
-- through the accept-invite Edge Function after Auth Admin has legitimately
-- created that user.
create function rpc_accept_invite(p_token uuid, p_email text, p_auth_user_id uuid)
returns void security definer set search_path = public language plpgsql as $$
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

  insert into household_member (household_id, auth_user_id, role)
  values (v_invite.household_id, p_auth_user_id, v_invite.role);

  update invite set status = 'accepted' where id = v_invite.id;
end; $$;

revoke all on function rpc_accept_invite(uuid, text, uuid) from public;
revoke execute on function rpc_accept_invite(uuid, text, uuid) from anon, authenticated;
grant execute on function rpc_accept_invite(uuid, text, uuid) to service_role;

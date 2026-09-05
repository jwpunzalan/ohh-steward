# DIP-1.2 — Email Invite Flow (Parent or Member)

**Jira Key:** STEW-11 (Epic STEW-1) | **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward | **Base Branch:** dev

---

## Story (Persona 3 format)

**Review Summary Strip:** Story ID: 1.2 | Objective: Allow Parents to bring new people into the household | Core Change: Invite generation, email delivery, invite-acceptance registration | Risk Level: Medium | Confidence Score: 90 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As a Parent, I want to invite someone to the household by email and have them register themselves on acceptance, so that I don't need to set up credentials on their behalf.

**Acceptance Criteria:**
1. Given a Parent role, when they send an invite to an email address with a specified role (Parent or Member), then an invite record is created and an email is dispatched.
2. Given an invite email, when the recipient clicks through, then they are taken to a registration form pre-associated with that household and role — no credentials pre-filled by the inviter.
3. Given successful registration via invite, when complete, then the new person is added to the household with the specified role, and no Budget is auto-assigned.
4. Given the household's Member cap, when a new invite would exceed it, then the system blocks sending the invite with a clear message.
5. Given an unaccepted invite, when it expires (implementation-defined window) or is resent, then only one active invite per email exists at a time.

**Dependencies & Assumptions:** Depends on Story 1.1 (Household must exist to invite into it) and Story 2.1 (`is_household_parent()` helper, reused here rather than re-derived). Assumes a transactional email provider is configured.

**Traceability:** PIB Objective: "Onboarding — only subscriber self-registers, all others via invite." PSDD Capability: Household & Role Management.

**Change Impact:**
- What changes: New `invite` table; `rpc_create_invite` and `rpc_accept_invite` RPCs; two new Edge Functions (`send-invite-email`, `accept-invite`); invite-send UI and invite-acceptance registration screen (web + mobile).
- What it touches: `household` (member_cap read), `household_member` (new row inserted on acceptance), `is_household_parent()` (reused, not modified).
- Breaking risk: No.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:** Implement invite creation (Parent-only action), email dispatch, and an invite-acceptance registration path distinct from Story 1.1's direct-subscriber path. Do NOT implement: any registration path that bypasses an invite for non-subscribers, any role other than Parent/Member on invite, automatic Budget assignment on acceptance (Story 2.1's concern), or a second parent-check function duplicating `is_household_parent()`.

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (resending an invite to the same email updates the existing record rather than creating a duplicate) | Reason: Clear, bounded flow with an explicit cap-check guard and a database-enforced single-active-invite constraint.

**Standing Rule:** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

---

## Story Summary

Implements Parent-initiated invitations: a Parent invites an email address with a specified role, an email is dispatched, and the recipient completes their own registration on acceptance. This is the only way a non-subscriber joins a household, per Discovery. It builds directly on Story 1.1's `household`/`household_member` schema and Story 2.1's `is_household_parent()` helper — no new authorization primitive is introduced.

## Repo Target

Both `apps/web` and `apps/mobile` (invite-send UI is Parent-only, surfaced wherever household settings live; invite-acceptance registration screen must exist in both apps since either a Parent or a Member could be invited and accept from either client) plus the shared Supabase backend (migration + two Edge Functions).

## Grounding Check

Verified live against the `ohhsteward-dev` Supabase project (not assumed from spec language) before drafting:

- `household.member_cap` — confirmed: `integer not null default 5`. Matches this DIP's cap-check reference exactly.
- `household_member` — confirmed columns `id uuid pk`, `household_id uuid fk→household(id)`, `auth_user_id uuid fk→auth.users(id)`, `role text check (role in ('parent','member'))`, `is_deleted boolean default false`, `created_at`. Matches this DIP's insert/query references exactly.
- `is_household_parent(p_household_id uuid)` — confirmed live: `language sql security definer`, body checks `household_member` for a row matching `household_id = p_household_id and auth_user_id = auth.uid() and role = 'parent' and not is_deleted`. Confirmed reusable as-is for this story's Parent-only gate.
- **Correction made to the pre-drafted version of this DIP:** the original `rpc_create_invite` sketch re-derived the Parent check inline (`select ... where role = 'parent'`) instead of calling `is_household_parent()`, contradicting this same DIP's own Implementation Instructions ("reused from Story 2.1's helper — do not write a second parent-check function"). Fixed below to resolve the caller's household from *any* active membership row, then gate on `is_household_parent(v_household)` — the single source of truth for "is this caller a Parent of this household," per Story 2.1's own Do NOT list (no bespoke re-derivation of access logic).
- **Gap found and closed:** the pre-drafted Code Requirements section referenced "the two functions above" but only `rpc_create_invite`'s SQL was ever written — `rpc_accept_invite` was described only in prose. Added below, with an explicit `service_role`-only execute grant (see §5 Application to this story) since, unlike the other RPCs in this schema, this one accepts a caller-supplied `auth_user_id` and must never be reachable by an ordinary authenticated or anonymous client.
- **Finding surfaced, not fixed here (out of this story's scope per the Standing Rule):** querying live grants on the four existing `SECURITY DEFINER` functions (`rpc_bootstrap_household`, `rpc_create_budget`, `is_household_parent`, `can_access_budget`) shows `EXECUTE` currently granted to `anon`, `authenticated`, `postgres`, **and** `service_role` — despite each function's own DIP specifying `revoke all ... from public; grant execute ... to authenticated`. Supabase applies `ALTER DEFAULT PRIVILEGES` at the schema level granting `EXECUTE` on newly created functions to `anon`/`authenticated`/`service_role` independently of a later `REVOKE ... FROM PUBLIC` in the same migration — so the intended "authenticated-only" restriction never actually took effect on any prior story's RPCs. Each function's own internal `auth.uid()` check happens to fail closed for an unauthenticated caller today, so this is not currently exploitable, but it is a real gap between stated intent and live database state. Recommend a small standalone hardening migration (`revoke execute on function ... from anon` for the four existing functions) — flagged to Joseph below as a candidate tech-debt ticket rather than folded into this story's scope.
- Trust boundaries in this story: the email/role supplied by the inviting (authenticated Parent) client, and the token/email/password supplied by the (unauthenticated) invite-acceptance client, are both untrusted and validated server-side per the Secure Coding Baseline below.

## Acceptance Criteria

1. Given a Parent role, when they send an invite to an email address with a specified role (Parent or Member), then an invite record is created and an email is dispatched.
2. Given an invite email, when the recipient clicks through, then they are taken to a registration form pre-associated with that household and role — no credentials pre-filled by the inviter.
3. Given successful registration via invite, when complete, then the new person is added to the household with the specified role, and no Budget is auto-assigned.
4. Given the household's Member cap, when a new invite would exceed it, then the system blocks sending the invite with a clear message.
5. Given an unaccepted invite, when it expires or is resent, then only one active invite per email exists at a time.
6. **(Negative security AC)** Given an invite token that is malformed, already accepted, expired, or presented with a mismatched email, when acceptance is attempted, then the system returns the same generic "invalid or expired invite" message in every case — no response distinguishes which failure occurred.

## Implementation Instructions

1. **Standing Rule (verbatim):** "Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it."
2. **Standing Rule scope clarification (verbatim):** "This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version."
3. **Do NOT implement:**
   - Do NOT implement any registration path for non-subscribers that bypasses an invite.
   - Do NOT accept any role value other than `'parent'`/`'member'` on invite creation.
   - Do NOT auto-assign a Budget on acceptance — that is Story 2.1's concern, not this story's.
   - Do NOT include the invite token in any log line, error message, or Edge Function structured log output.
   - Do NOT write a second Parent-check query — reuse `is_household_parent()` exactly as Story 2.1 defined it.
   - Do NOT grant `EXECUTE` on `rpc_accept_invite` to `authenticated` or `anon` — it takes a caller-supplied `auth_user_id` and must only ever be invoked by the `accept-invite` Edge Function using the service-role key.
   - Do NOT leave an orphaned `auth.users` record if `rpc_accept_invite` rejects after the Edge Function has already called Auth Admin `createUser` — the Edge Function must delete that user via the Admin API before returning the generic error to the client.
   - Do NOT modify any existing story's RPC grants (the `anon`-grant finding above) as part of this story — that is a separate, already-flagged hardening item, not this story's scope.
4. Create `invite`: `id uuid pk default gen_random_uuid()`, `household_id uuid not null references household(id)`, `email text not null`, `role text not null check (role in ('parent','member'))`, `invited_by uuid not null references household_member(id)`, `status text not null default 'pending' check (status in ('pending','accepted','expired'))`, `token uuid not null default gen_random_uuid()`, `expires_at timestamptz not null default (now() + interval '7 days')`, `created_at timestamptz not null default now()`. Add `create unique index uq_invite_pending_email on invite(household_id, email) where status = 'pending'` — this is what makes AC5 ("only one active invite per email") a database guarantee, and makes resend idempotent (upsert on this index rather than insert-then-conflict).
5. Write `rpc_create_invite(p_email text, p_role text)` (`security definer`, `language plpgsql`, granted to `authenticated` only): resolve the caller's household from their own active `household_member` row (any role), then gate on `is_household_parent(v_household)` — do not re-derive the Parent check; reject with a generic `'not authorized'` if the caller isn't a Parent of that household; validate `p_role in ('parent','member')`; count active `household_member` rows plus pending invites against `household.member_cap` and reject with a clear error if creating this invite would exceed it (AC4); upsert the `invite` row on `uq_invite_pending_email` (AC5); trigger `send-invite-email` with only the invite `id` (never the token) in the payload.
6. Write `rpc_accept_invite(p_token uuid, p_email text, p_auth_user_id uuid)` (`security definer`, `language plpgsql`, granted to `service_role` only — never `authenticated`/`anon`): lock the invite row by token (`for update`); if it doesn't exist, isn't `status = 'pending'`, has expired, or the supplied email doesn't match the invite's email, raise the single generic `'invalid or expired invite'` exception (AC6) and roll back; otherwise insert `household_member(household_id, auth_user_id, role)` using the invite's own `household_id`/`role`, and set the invite's `status = 'accepted'` — all in one transaction, so the check and the write cannot race.
7. Build the `accept-invite` Edge Function as the only caller of `rpc_accept_invite`: validate the request body against an explicit schema (`token: uuid`, `email: string`, `password: string`); call Supabase Auth Admin `createUser({ email, password })` to obtain `auth_user_id`; call `rpc_accept_invite(p_token, p_email, p_auth_user_id)` using the service-role client; on success, sign the new user in and return a session; on the RPC's generic-error rejection, delete the just-created `auth.users` record via Admin API (see Do NOT list) and return the same generic 400 message to the client regardless of which internal condition failed.
8. Build the `send-invite-email` Edge Function, invoked only from `rpc_create_invite` (via `pg_net`/webhook, not directly client-callable): re-reads the invite row server-side by `id` to build the email; the email provider's API key is a Supabase Edge Function secret, never committed or logged.
9. Build the invite-send UI (Parent-only, both apps) calling `rpc_create_invite`, and the invite-acceptance registration screen (both apps) that reads the token from the invite link and calls `accept-invite` — pre-associated with the household/role, no credential pre-fill by the inviter.

## Code Requirements

```sql
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

  return v_invite_id;
end; $$;

revoke all on function rpc_create_invite(text, text) from public;
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
```

Both functions use only bind parameters (`p_email`, `p_role`, `p_token`, `p_auth_user_id`) — never string-built SQL.

**Secure Coding Requirements** (OWASP ASVS Level 2 / CWE — reproduced verbatim, mandatory on every DIP):

1. **Injection.** All SQL is parameterized. String concatenation or interpolation of any value into SQL, shell commands, file paths, or query strings is prohibited. This applies equally to SQL supplied in a DIP — any SQL in a DIP must itself be parameterized, or explicitly marked as a one-time DDL/migration statement executed with no user-supplied input. (CWE-89, CWE-78; ASVS V5)
2. **Input validation at trust boundaries.** Validate type, range, length, format, and allowed values on every input crossing a boundary — API route, RPC call, Edge Function, file upload, or external system response. Validate server-side; client-side validation is never sufficient. Reject by default rather than sanitize where a closed set of valid values exists. (ASVS V5)
3. **Output encoding.** Encode data for the context it enters — HTML, URL, SQL identifier, log line, or downstream message/notification. (CWE-79; ASVS V5)
4. **Secrets.** No credential, connection string, key, token, or certificate may appear in source, configuration committed to the repository, test fixtures, log output, error messages, or telemetry. Secrets are resolved at runtime through the platform's environment-variable and secret management, never hardcoded. (CWE-798; ASVS V6, V14)
5. **Sensitive data in logs and telemetry.** Do not log credentials, tokens, personal data, or full request/response payloads. Where a record must be traceable, log an identifier or reference, never the content. (CWE-532; ASVS V7, V8)
6. **Authentication and authorization.** Use the platform's authentication primitives — never implement custom authentication, session handling, or token validation. Enforce authorization on the server for every protected operation, and fail closed — an authorization check that errors must deny, never allow. (ASVS V2, V3, V4)
7. **Least privilege.** Database roles, RLS policies, service credentials, and API scopes are the minimum required by the story. Do not grant broad access for convenience. (ASVS V1)
8. **Cryptography.** Never write custom cryptography or invent a scheme. Use platform-provided algorithms and key management. TLS is required for all data in transit; do not disable certificate validation, including in local/dev code paths. (CWE-327, CWE-295; ASVS V6, V9)
9. **Deserialization and parsing.** Treat every inbound payload as untrusted — request bodies, webhook payloads, file uploads. Do not deserialize to arbitrary or polymorphic types from untrusted input; validate against an explicit schema rather than trusting shape. (CWE-502, CWE-611; ASVS V5)
10. **Error handling.** Error responses must not disclose stack traces, SQL text, connection strings, internal hostnames, or file paths to the client. Log the detail server-side; return a generic message and, where useful, a correlation identifier externally. (CWE-209; ASVS V7)
11. **Dependencies.** Do not add a dependency not named in the DIP. Any dependency the DIP does add must be pinned to an explicit version. (ASVS V14)
12. **Concurrency and state.** Where the story involves shared state or idempotency, the implementation must be safe under concurrent execution and retry — a check-then-act sequence over shared state must be atomic. (CWE-362)

**Application to this story:**
- **Obligation 1 (Injection):** both RPCs use typed function parameters (`p_email text`, `p_role text`, `p_token uuid`, `p_auth_user_id uuid`) bound by Postgres's function-call mechanism, never concatenated into a query string.
- **Obligation 5 (Sensitive data in logs):** the invite `token` is a bearer credential for account creation — it must never appear in Edge Function structured logs, error messages, or `raise exception` text. Only the invite `id` passes between `rpc_create_invite` and `send-invite-email`.
- **Obligation 6/7 (Authorization, least privilege) — the key access-control point of this story:** `rpc_accept_invite` accepts a caller-supplied `auth_user_id`, which makes it categorically different from every other RPC in this schema — if a regular `authenticated` (or `anon`) client could call it directly, they could insert a `household_member` row for *any* auth_user_id they choose (a privilege-escalation / IDOR path). It is therefore granted to `service_role` only, reachable exclusively through the `accept-invite` Edge Function after Supabase Auth Admin has legitimately created that user. `rpc_create_invite` fails closed via `is_household_parent()` — an error there denies, it never falls through to allow.
- **Obligation 6 (fail closed, uniform errors):** `rpc_accept_invite` returns the identical generic error for "token not found," "already accepted," "expired," and "email mismatch," so a client probing tokens cannot distinguish valid-but-used from never-issued from wrong-email (AC6).
- **Obligation 12 (Concurrency):** the partial unique index on `(household_id, email) where status='pending'` makes invite resend an atomic upsert rather than a check-then-insert race; `rpc_accept_invite`'s `select ... for update` closes the race window between validating the token and consuming it, so two simultaneous acceptance attempts on the same token cannot both succeed.
- **Obligation 4 (Secrets):** the transactional email provider's API key lives only as a Supabase Edge Function secret, never in committed config or client code.

## API Contract

- `supabase.rpc('rpc_create_invite', { p_email, p_role })` — Parent-only (enforced inside the function via `is_household_parent()`). Returns `{ invite_id }`. Errors: `not authorized` (403-equivalent), `invalid role`, `member cap reached` — all safe, non-internal messages per Obligation 10.
- Edge Function `POST /functions/v1/accept-invite` — body `{ token: uuid, email: string, password: string }` (validated against an explicit schema per Obligation 2/9). Response contract: **200** with `{ session }` on success; **400** with `{ error: "invalid or expired invite" }` for every rejection reason (malformed, already-accepted, expired, or email-mismatched token) — uniform per the no-distinguishing-response rule above; **500** only for a genuinely unexpected server error, returning `{ error: "something went wrong", correlation_id }` and never internal detail.
- Edge Function `POST /functions/v1/send-invite-email` (internal only, invoked by `rpc_create_invite` via `pg_net`/webhook — not directly client-callable) — body `{ invite_id: uuid }`; re-reads the row server-side to build the email.

## Non-Functional Requirements

**Performance:** Invite creation/acceptance are low-frequency, single-row operations; no special latency target beyond standard RPC/Edge Function round-trip.

**Scalability:** Bounded by `household.member_cap` (default 5) — no scale concern at this volume.

**Reliability:** Resend is idempotent via the partial unique index; email delivery failure does not roll back the invite row (the row exists regardless, so it can be resent). Acceptance is atomic — a failure after Auth Admin `createUser` but before the RPC commits leaves no orphaned `household_member` row (only a cleaned-up orphaned `auth.users` record, per the Do NOT list's explicit cleanup instruction).

**Security:** ASVS chapters in scope: V2/V4 (session/access control for the Parent-only creation check and the service-role-only acceptance path), V5 (validation of email/role/token/password), V6/V14 (email provider API key and service-role usage as Supabase secrets, never in client code). Trust boundaries: the invite email/role from the inviting (authenticated) client, and the token/email/password from the (unauthenticated) acceptance client, are both untrusted. Sensitive data: the invite token is a bearer credential, handled per Obligation 5. Weaknesses excluded: CWE-798 (email provider key and service-role key server-side only), CWE-89 (parameterized SQL throughout), CWE-284/CWE-639 (IDOR — `rpc_accept_invite`'s `service_role`-only grant prevents a client from supplying an arbitrary `auth_user_id` directly).

## Files to Create/Modify

- New Supabase migration: `invite` table, `rpc_create_invite`, `rpc_accept_invite`.
- New Supabase Edge Functions: `send-invite-email`, `accept-invite`.
- `apps/web`: invite-send UI (Parent-only, household settings area) and an invite-acceptance registration route.
- `apps/mobile`: equivalent invite-send screen (Parent-only) and invite-acceptance registration screen.
- No existing files from Stories 1.1/2.1/3.3 are modified.

## Migration Files

Raw SQL as shown in Code Requirements above. Written to disk under `supabase/migrations/`, validated locally via the Supabase CLI (per the standing migration rule) before being proposed for the remote Preview project — never applied directly to a remote/production project by CC.

## Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-11

1. Apply the `invite` table + `rpc_create_invite`/`rpc_accept_invite` migration.
2. Deploy the `send-invite-email` and `accept-invite` Edge Functions; configure the transactional email provider's API key as a Supabase Edge Function secret (never in a committed `.env`).
3. Confirm `rpc_create_invite`'s execute grant is `authenticated`-only, and `rpc_accept_invite`'s execute grant is `service_role`-only (not `authenticated`, not `anon`) — verify with a live grants query, not by inspection of the migration file alone, given the live-database finding in the Grounding Check above.
4. CC stages changes, commits, pushes the feature branch, and opens a PR against `dev` following local validation. Does not merge — Joseph tests locally and merges manually.

## Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations; two new Edge Functions (`send-invite-email`, `accept-invite`); web/mobile invite-send UI (Parent-only) and invite-acceptance registration screen.

**Expected integration behavior:** invite creation stays a synchronous RPC call from the authenticated Parent session; acceptance is an unauthenticated Edge Function endpoint (no Supabase session exists yet at that point) that itself calls a `service_role`-only RPC — never a client-callable RPC.

**Data flow impact:** adds the `invite` table; on acceptance, writes into `household_member` using the same shape as Story 1.1's bootstrap, but with a caller-specified role instead of always `'parent'`, and without touching `household` itself.

**Dependencies to add/update:** a transactional email provider SDK (e.g., Resend), added to the Edge Function's dependency manifest and pinned to an explicit version.

**Constraints:** must not duplicate `rpc_bootstrap_household`'s household-creation logic — acceptance only ever joins an *existing* household, never creates one. Must not modify `is_household_parent()`, `can_access_budget()`, or any Story 2.1 RLS policy.

## Change Impact

- What changes: New `invite` table, `rpc_create_invite`/`rpc_accept_invite` RPCs, two Edge Functions, invite-send and invite-acceptance UI in both apps.
- What it touches: `household` (read-only, member_cap check), `household_member` (new row on acceptance), `is_household_parent()` (reused, unmodified).
- Breaking risk: No.

## Branch Name

feature/1.2-invite-flow

## Commit Message

1.2: Add email invite flow (invite table, create/accept RPCs, invite-send and acceptance UI)

## Pull Request Description

Maps to each Acceptance Criterion:
- AC1: `rpc_create_invite` creates the invite row and dispatches `send-invite-email`.
- AC2: invite-acceptance screen reads the token from the link, pre-associated with household/role, no inviter-supplied credentials.
- AC3: `rpc_accept_invite` inserts `household_member` with the invite's role; no Budget touched.
- AC4: `rpc_create_invite` blocks creation once active members + pending invites reach `household.member_cap`.
- AC5: partial unique index on `(household_id, email) where status='pending'` makes resend idempotent and guarantees a single active invite per email.
- AC6 (negative security): `rpc_accept_invite` returns one generic error for every rejection reason (missing/expired/accepted/email-mismatched token).

## Jira Linkage

- PDE Story ID: 1.2
- Jira Epic Key: STEW-1
- Jira Story Key: STEW-11

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-1.2.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary. For `is_household_parent()` and any other file this story must NOT touch, include `git diff dev [branch] -- <file>` showing zero output as explicit proof.

## Confidence Assessment

- **Confidence Score:** 90/100
- **Reasoning:** Schema and helper-function reuse verified directly against the live `ohhsteward-dev` database, not assumed from the pre-drafted spec text — two real drafting gaps were found and closed in that verification (a bespoke Parent-check re-derivation, and an entirely missing `rpc_accept_invite` implementation). The remaining uncertainty is ordinary first-pass-execution risk (Edge Function wiring, email provider integration) rather than a design gap.
- **Top Risk Areas:**
  1. `rpc_accept_invite`'s `service_role`-only grant is the single most important access-control detail in this story — CC must verify it live post-migration (per Deployment Instructions item 3), not just trust the migration file's text, given the live-grants discrepancy already found on four prior functions in this same database.
  2. The Edge Function orphan-cleanup step (deleting a just-created `auth.users` record if `rpc_accept_invite` rejects) is easy to skip silently since it's a failure-path-only behavior — flagged explicitly in the Do NOT list so it isn't missed.
  3. Email provider integration (Resend or equivalent) is new to this codebase — first-pass wiring risk, though low relative to Story 2.1's RLS work.

## ⚠️ Open Questions to be Answered Before Moving Forward

None at the design level. One related, out-of-scope finding for Joseph's awareness (not a blocker for this story): the four `SECURITY DEFINER` functions from Stories 1.1/2.1/3.3 (`rpc_bootstrap_household`, `rpc_create_budget`, `is_household_parent`, `can_access_budget`) currently grant `EXECUTE` to `anon` in the live database despite each one's own DIP specifying an authenticated-only restriction — Supabase's schema-level default privileges override a plain `revoke ... from public`. Not currently exploitable (each function's internal `auth.uid()` check fails closed for an unauthenticated caller), but worth a small standalone hardening migration. Recommend filing as tech debt if you'd like it tracked — say the word and I'll draft the ticket.

# DIP — Story 1.1: Subscriber Self-Registration & Household Creation

**Jira Story Key:** STEW-10 | **Jira Epic Key:** STEW-1 | **DIP ID:** DIP-1.1-v1

---

### Story Summary

This story implements the sole unauthenticated account-creation path in OHh Steward: a person registers with email/password via Supabase Auth, and a Household plus a Parent-role HouseholdMember record are created for them atomically. This is the entry point for the entire system — no household or budget can exist before this runs — so correctness of the atomic creation and the uniqueness guarantee is foundational for every downstream story. Per the DVP Build Plan, this is the second story built (after 3.3), and the first to create durable application tables against `dev`.

### Repo Target

Both the web (Next.js) and mobile (Expo) clients call the same Supabase RPC — no server-side API layer exists for this (ATD §1: no separate custom API server). The Supabase migrations directory is shared across both apps in the monorepo. This is the first schema-bearing story to land against `dev`; Story 3.3 (`documentation/dips/DIP-3.3.md`, PR #1) is queued ahead of it but not yet merged.

### Grounding Check

- Verified via live query against `ohhsteward-dev` (Supabase project ref `poqvothxwmjbtitqtbgh`) that the `public` schema is currently empty — no `household`, `household_member`, or any other application table exists yet. This story is safe to build against a clean slate.
- **Sequencing dependency on Story 3.3:** per the DVP Build Plan, this story runs immediately after 3.3. Story 3.3's DIP establishes `fn_audit_log()` and the convention that each subsequent story attaches its own `AFTER INSERT OR UPDATE OR DELETE` trigger to the table(s) it creates. This DIP assumes 3.3 (PR #1) is merged to `dev` before this story's branch is cut — if it is not yet merged, hold this DIP; `fn_audit_log()` will not exist yet.
- Schema names (`household`, `household_member`, `auth_user_id`, `is_deleted`, `role`) verified against ATD §3.2 and cross-checked against Story 3.3's already-implemented `fn_audit_log()` trigger body, which references `household_member` and its `is_deleted` column — consistent.
- **New finding — RLS gap not present in the original story draft:** the source content for this story (as authored in `BACKLOG_DIP.md`) creates `household` and `household_member` with no `ROW LEVEL SECURITY` statements at all. On Supabase, a table with default `authenticated`-role grants and RLS disabled is directly reachable through the auto-generated PostgREST API — any authenticated user could read or write every household's roster, not just their own. This is a fail-closed/least-privilege (Secure Coding Baseline obligations 6–7) gap, not a scope change: enabling RLS with zero policies is "writing the authorized behavior safely," not a new authorization decision. This DIP adds `enable`/`force` RLS with no policies on both tables — `rpc_bootstrap_household()` is `SECURITY DEFINER` so it is unaffected; direct table access stays denied until Story 2.1 defines real policies (see Dependencies & Assumptions below — those policies need `is_household_parent()`, which doesn't exist until 2.1, so they cannot be written any sooner than that).
- Trust boundary: the `email`/`password` payload crossing to Supabase Auth's `signUp` is untrusted client input, handled entirely inside Supabase Auth — no custom code in this story touches it. The only boundary this story's own code touches is `auth.uid()`, a server-derived, JWT-verified value, never client-supplied — so `rpc_bootstrap_household()` takes zero parameters and has no untrusted input of its own to validate.

### Acceptance Criteria

1. Given no existing account, when a person submits valid registration details (email, password), then a new Household is created and the person is assigned the Parent role within it.
2. Given a successful registration, when the household is created, then default Member cap (5) and Budget cap (5) values are applied (configurable afterward via Story 7.1).
3. Given an email already associated with an account, when registration is attempted, then the system rejects it with a clear error — no duplicate households are created (enforced by Supabase Auth's native email uniqueness, not custom logic).
4. Given a new Household, when created, then it contains zero Categories and zero Budgets by default.
5. **(Negative security AC)** Given a caller whose `auth.uid()` already has an active `household_member` row, when `rpc_bootstrap_household()` is invoked again (retry, double-tap, or deliberate replay), then no second household is created, no role change occurs, and the function returns the caller's existing `household_id` unchanged.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

3. **Do NOT implement:**
   - Do NOT implement invite-based registration here — that is Story 1.2's `rpc_accept_invite`.
   - Do NOT implement any admin-configurable registration approval step.
   - Do NOT implement any non-email registration method (social login, magic link, SSO) — none was specified.
   - Do NOT accept household name, cap values, or role as parameters to `rpc_bootstrap_household()` — these are server-determined defaults only.
   - Do NOT define any read/write RLS policies on `household` or `household_member` beyond enabling + forcing RLS with no policies. Policy design for these tables is Story 2.1's concern (it depends on `is_household_parent()`, which this story does not create) — direct table access must stay fail-closed (denied) until then.
   - Do NOT attach an audit trigger to any table other than `household` and `household_member` — those are the only two tables this story creates.

4. Create the `household` table per ATD §3.2: `id uuid primary key default gen_random_uuid()`, `member_cap int not null default 5`, `budget_cap int not null default 5`, `retention_years int not null default 7`, `session_timeout_minutes int not null default 30`, `notification_threshold_pct numeric not null default 90`, `created_at timestamptz not null default now()`.

5. Create the `household_member` table: `id uuid primary key default gen_random_uuid()`, `household_id uuid not null references household(id)`, `auth_user_id uuid not null references auth.users(id)`, `role text not null check (role in ('parent','member'))`, `is_deleted boolean not null default false`, `created_at timestamptz not null default now()`. Add a partial unique index `uq_household_member_active_user` on `household_member(auth_user_id) where not is_deleted` — this is the guard that makes the RPC below idempotent and prevents a user from ever belonging to a second household via this path.

6. Enable and force RLS on both `household` and `household_member`, with no policies defined in this story (see Grounding Check and Do NOT implement above — this is a fail-closed placeholder, not a scope addition).

7. Attach `fn_audit_log()` (created in Story 3.3) to both new tables via `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW EXECUTE FUNCTION fn_audit_log()` triggers, per the trigger-attachment convention Story 3.3 establishes for every story downstream of it.

8. Write `rpc_bootstrap_household()` as a `SECURITY DEFINER` Postgres function (owned by a least-privilege role, not the Postgres superuser, per Secure Coding obligation 7) that: (a) checks whether an active `household_member` row already exists for `auth.uid()` — if so, returns that existing `household_id` and takes no further action (idempotency guard, see Application to this story below); (b) otherwise inserts one `household` row using only column defaults (no caller-supplied cap values accepted) and one `household_member` row with `role = 'parent'`, both inside the same transaction; (c) returns the new `household_id`.

9. Wire the client (web and mobile) to call `signUp`, then on success call `rpc_bootstrap_household()`, then route to the empty-dashboard state described in AC4.

10. Grant `execute` on `rpc_bootstrap_household()` to the `authenticated` Supabase role only — not `anon` — since the function relies on `auth.uid()` being non-null.

### Code Requirements

```sql
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
-- already exist on `dev` — see Grounding Check).
create trigger trg_audit_household after insert or update or delete
  on household for each row execute function fn_audit_log();
create trigger trg_audit_household_member after insert or update or delete
  on household_member for each row execute function fn_audit_log();

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

  insert into household default values returning id into v_new_household;

  insert into household_member (household_id, auth_user_id, role)
  values (v_new_household, auth.uid(), 'parent');

  return v_new_household;
end;
$$;

revoke all on function rpc_bootstrap_household() from public;
grant execute on function rpc_bootstrap_household() to authenticated;
```

This DDL/function creation is executed once as a migration with no user-supplied input, per Secure Coding obligation 1's DDL exemption.

**Secure Coding Requirements** (OWASP ASVS Level 2 / CWE — reproduced verbatim, mandatory on every DIP):

1. **Injection.** All SQL is parameterized. String concatenation or interpolation of any value into SQL, shell commands, file paths, or query strings is prohibited. This applies equally to SQL written by Atlas — any SQL supplied in a DIP must itself be parameterized, or explicitly marked as a one-time DDL/migration statement executed with no user-supplied input. (CWE-89, CWE-78; ASVS V5)
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

**Application to this story:** Obligation 1 (Injection): `rpc_bootstrap_household()` takes zero parameters — every value it writes is either `auth.uid()` (server-derived from the verified JWT) or a column default, so there is no SQL built from client input to parameterize; the DDL above is migration-only. Obligation 6 (Authentication/Authorization, fail closed): the function is granted only to `authenticated` and relies exclusively on `auth.uid()`, never a client-supplied user id; both new tables ship with RLS enabled and forced with zero policies, so direct table access denies by default until Story 2.1 adds real policies. Obligation 7 (Least privilege): no policy grants broader access than "nothing," pending 2.1. Obligation 12 (Concurrency): the partial unique index `uq_household_member_active_user` makes double-submission (e.g., a double-tapped "Create Account" button firing two RPC calls) safe — a concurrent second insert violates the unique index; wrap the insert in an exception handler that re-selects on unique-violation instead of surfacing a hard 500, satisfying AC5 under real concurrency, not just sequential retries.

### API Contract

No REST API — Supabase client SDK only.

`supabase.auth.signUp({ email: string, password: string })` — Supabase-native, returns `{ user, session }` or an error (including the built-in duplicate-email error, surfaced to the user per AC3).

`supabase.rpc('rpc_bootstrap_household')` — no parameters. Returns `{ household_id: uuid }` on success. Errors propagate as standard PostgREST/Supabase RPC errors (see Error Handling, obligation 10) — the client must show a generic "couldn't finish setting up your household" message, never the raw Postgres error text.

### Non-Functional Requirements

*Performance:* Single-row inserts on signup; no measurable latency target beyond standard Supabase RPC round-trip (<300ms p95).

*Scalability:* Household count scales with subscriber count; no denormalization needed at this volume (ATD §4.2).

*Reliability:* The partial unique index guarantees at-most-one-household-per-user even under retries or client bugs. RLS-with-no-policies on both new tables means a bug in a later story's policy definition can only ever be *too restrictive*, never accidentally expose this data — a safe default to build on top of.

**Security:** ASVS chapters in scope: V1 (Architecture — RLS enabled from the moment these tables exist, not deferred to "later"), V2/V3/V4 (Authentication/Session/Access Control — Supabase Auth native `signUp`, no custom auth; fail-closed RLS), V5 (Validation — server-side-only trust of `auth.uid()`). Trust boundary: the `email`/`password` payload from the client to Supabase Auth is untrusted; the RPC call itself has no client-supplied trust boundary beyond the verified JWT. Sensitive data handled: password (handled entirely by Supabase Auth, never touches this application's own tables or logs); `household_member.role` and `auth_user_id` are access-control-relevant but not directly reachable by any client role yet, per the RLS gap fix above. Weaknesses excluded: CWE-798 (no credentials in source/config — Supabase handles password hashing/storage), CWE-362 (race on double-submit, mitigated per Obligation 12), and — newly, as of this DIP — the "RLS-disabled-by-omission" class of exposure (no CWE-corresponding ID; mapped to ASVS V1/V4) that the original story draft did not address.

### Observability

Rely on Supabase's built-in Auth logs for signUp attempts/failures. Add a lightweight structured log line (`household_id`, no email/PII) inside `rpc_bootstrap_household()` only if Persona 4/5 later adopt Edge Function structured logging (currently DEFERRED per DVP NFR decision) — not required for this story's completion.

### Files to Create/Modify

- New Supabase migration file under `supabase/migrations/` (timestamped, following the convention CC already established in Story 3.3's migration) containing all DDL above.
- Web: the Next.js auth page/hook that currently (or will) call `signUp` — extend to chain `rpc_bootstrap_household()` on success, then route to the empty-dashboard state.
- Mobile: the Expo auth screen/hook — same chain as web.
- No other files. Exact paths are intent-driven, not path-confirmed — the repo's file/folder structure has not yet been observed for the web/mobile app surfaces (Project Profile §2 notes this explicitly); CC should follow whatever convention Story 3.3 or the existing app scaffold already established rather than inventing a new one.

### Migration Files

Raw SQL as given in Code Requirements above. Written to disk only; validated locally via the Supabase CLI before anything is proposed for a remote project, exactly as CC already did for Story 3.3 (standalone container validation is an acceptable substitute if the local Supabase stack's port is unavailable, as it was for 3.3).

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-10

1. Confirm Story 3.3 (PR #1) is merged to `dev` before branching — this story's trigger-attachment step depends on `fn_audit_log()` existing.
2. Apply the `household` and `household_member` table migrations, the RLS enable/force statements, the two audit triggers, and the `rpc_bootstrap_household()` function migration to the target Supabase project via the standard migration pipeline.
3. Verify `execute` grant on `rpc_bootstrap_household()` is `authenticated`-only (not `anon`, not `public`) before merging.
4. Verify both `household` and `household_member` show `rowsecurity = true` and `forcerowsecurity = true` in `pg_tables`/`pg_class` before merging — this is the fail-closed guarantee the Grounding Check fix depends on.
5. No environment variables or secrets are introduced by this story.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations directory (new table + function migration file); the client-side Auth module (web: Next.js auth page/hook; mobile: Expo auth screen/hook) to chain `signUp` → `rpc_bootstrap_household` → route to empty dashboard.

**Expected integration behavior:** registration becomes a two-call sequence from both clients, sharing the same RPC — no duplicate household-bootstrap logic should exist per client.

**Data flow impact:** introduces the `household` and `household_member` tables that every other entity in the schema (Stories 2.1 onward) will reference, and the first two tables (besides `audit_log_entry`) to carry the `fn_audit_log()` trigger.

**Dependencies to add/update:** Supabase JS client SDK (already the platform standard per ATD §1) — no new dependency required.

**Constraints:** do not introduce a separate `users` or `profile` table duplicating `auth.users` — `household_member.auth_user_id` is the only link required. Do not write any RLS policy beyond enable/force on these two tables — that is Story 2.1's concern.

### Change Impact

- What changes: introduces the `household` and `household_member` tables (RLS enabled/forced, no policies yet), audit triggers on both, and `rpc_bootstrap_household()`; wires web/mobile signup to call it.
- What it touches: net-new tables only — no existing schema/code to affect, aside from depending on Story 3.3's `fn_audit_log()` already being merged.
- Breaking risk: No.

### Branch Name

`feature/1.1-household-bootstrap`

### Commit Message

`1.1: Add household bootstrap tables, RLS fail-closed baseline, and rpc_bootstrap_household()`

### Pull Request Description

Maps to each Acceptance Criterion:
- AC1/AC2: `rpc_bootstrap_household()` creates `household` (with default caps) + `household_member` (role `parent`) in one transaction.
- AC3: enforced natively by Supabase Auth's `auth.users.email` unique constraint — no custom code.
- AC4: `household` starts with zero related rows by construction; no seed data is inserted.
- AC5: `uq_household_member_active_user` partial unique index + existing-row check in `rpc_bootstrap_household()` makes retries idempotent.

Also includes (Secure Coding Baseline, not a new AC): RLS enabled/forced on both new tables with zero policies, closing a direct-table-access gap that existed in the original story draft; audit triggers attached to both tables per Story 3.3's established convention.

### Jira Linkage

- PDE Story ID: 1.1
- Jira Epic Key: STEW-1
- Jira Story Key: STEW-10

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-1.1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary. For any file this DIP required to remain untouched, include `git diff dev <branch> -- <file>` showing zero output as explicit proof.

### Confidence Assessment

- **Confidence Score:** 88
- **Reasoning:** The core logic (idempotent bootstrap RPC, partial unique index, Supabase-native email uniqueness) is simple and low-risk, and matches the original story draft closely. Confidence is bounded slightly by two things outside this DIP's control: (1) whether Story 3.3 is actually merged to `dev` before this branch is cut — flagged explicitly above; (2) the exact web/mobile file paths, since the repo's app-layer structure hasn't been directly observed yet.
- **Top Risk Areas:** Trigger attachment failing if `fn_audit_log()` isn't yet on `dev` (mitigated by the explicit pre-check in Deployment Instructions step 1); the RLS gap fix being the one piece of this DIP not present in the original backlog content, so it's worth a quick second look before merging even though it's additive-only (enable/force, no policies) and can't make anything less secure.

### ⚠️ Open Questions to be Answered Before Moving Forward

None blocking. One item for your awareness: the RLS-enable/force fix applied here to `household`/`household_member` is a pattern I'd recommend retroactively checking against Story 3.3's `audit_log_entry` table too (it already has RLS enabled per its own DIP) and against every future story's tables as they're added — this DIP doesn't change 3.3, just flags the pattern for consistency going forward.

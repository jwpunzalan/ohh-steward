# Story 1.1.G2 — Fix Household Bootstrap Under Mandatory Email Confirmation

**Review Summary Strip:** Story ID: 1.1.G2 | Objective: Registration must actually work under Supabase Auth's default (email-confirmation-required) configuration | Core Change: Move household bootstrap from a client-called RPC to a database trigger on `auth.users`, so it fires unconditionally at signup regardless of confirmation state | Risk Level: High (auth/signup path; a trigger bug here can break every future signup, not just this one case) | Confidence Score: 82 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As a new Parent signing up for OHh Steward, I want my household to actually be created when I register — even though I have to confirm my email before I can log in — so that registration isn't silently broken by Supabase's own default security setting.

**Acceptance Criteria:**
1. Given a brand-new sign-up (email + password) on a project with email confirmation required (the default, and what `ohhsteward-dev` is actually configured with), when the form is submitted, then the household and household_member (role `parent`) rows are created immediately and atomically as part of account creation — with no dependency on an active client session.
2. Given the same scenario, when `signUp()` returns with `session: null` (confirmation pending), then the client shows a "check your email to confirm your account" state, and does **not** attempt to call any bootstrap RPC that assumes an authenticated session — the previous unconditional call is what produced the generic "we couldn't create your account" failure.
3. Given the user later clicks the email confirmation link and then logs in with their password, when authentication succeeds, then they land on the dashboard with their already-created household in place — no bootstrap call happens or is needed at login time.
4. Given a user attempts to log in before confirming their email, then Supabase Auth itself refuses to issue a session (existing platform behavior — verified, not built by this story).
5. **(Negative security / idempotency AC)** Given the household-bootstrap trigger fires for a user who — through a retry, a duplicate event delivery, or a lingering call to the now-legacy `rpc_bootstrap_household()` — already has an active `household_member` row, then no second household or household_member row is created and no error is raised to the caller; the existing unique constraint (`uq_household_member_active_user`) and idempotency check hold exactly as they do today.

**Dependencies & Assumptions:** Discovered while manually testing Story 1.4 (STEW-13) on a real device against `ohhsteward-dev`. Originating story: 1.1 (STEW-10, PR #2) — the `rpc_bootstrap_household()` function and the signUp-then-bootstrap client flow this story corrects. Also touches the `household_member.auth_user_id` nullable/CHECK design from Story 1.3 (STEW-12) — see Grounding Check for exactly how that interacts with this bug.

**Traceability:** PIB Objective: "Subscriber self-registration creates a household." PSDD Capability: Household & Access Foundations. Originating story: 1.1 (STEW-10).

**Change Impact:**
- What changes: Household bootstrap moves from a client-invoked RPC to a database trigger on `auth.users`; both apps' sign-up flow stops calling that RPC and instead branches on whether `signUp()` returned an active session.
- What it touches: `public.household`, `public.household_member` (write path only — no schema change), a new trigger + trigger function, the web and mobile sign-up screens.
- Breaking risk: No — this replaces a bootstrap path that has never worked correctly under the project's actual settings; there is no working behavior to regress.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Add a `SECURITY DEFINER` trigger function on `auth.users` (`AFTER INSERT`) that creates the household + household_member(parent) rows directly from `NEW.id`, with no dependency on `auth.uid()` or an active session — mirroring Supabase's own documented pattern for this exact problem. Update both clients' sign-up flow to stop calling `rpc_bootstrap_household()` unconditionally and instead branch on `session` being present. Do NOT change Supabase Auth's email-confirmation setting, login behavior, or any RLS policy. Do NOT add any new UI beyond a "check your email" state on both clients.

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (the trigger's own existing-household check plus the unique index on `household_member.auth_user_id` make repeat firings a safe no-op) | Reason: Touches the signup path directly — a bug in the new trigger function fails the *entire* `auth.users` insert (Supabase surfaces this as "Database error saving new user"), so this must be validated locally against a fresh signup before anything else.
Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

---

### Story Summary

Story 1.1 (STEW-10, already Done) wired registration as `signUp()` → `supabase.rpc('rpc_bootstrap_household')` → route to dashboard. That RPC reads `auth.uid()` to determine the calling user, which only exists when the call runs under an authenticated client session. `ohhsteward-dev` has email confirmation required — Supabase's own default — so `signUp()` never returns an active session on first call; the bootstrap RPC then runs as `anon`, and fails. This story replaces the client-driven bootstrap with a database trigger on `auth.users` that fires unconditionally at account-creation time, independent of confirmation state or session — the same pattern Supabase's own documentation recommends for "run something when a user signs up."

### Repo Target

`apps/web` and `apps/mobile`: remove the unconditional `rpc_bootstrap_household()` call from the sign-up flow, add a "check your email" state when `signUp()` returns no session. Supabase migrations: the new trigger + trigger function, plus closing the `anon`/`authenticated` execute grant on the now-client-unused `rpc_bootstrap_household()`.

### Grounding Check

**Root cause, verified against live state, not assumed:** Queried `auth.users` for two actual failed sign-up attempts during this session's testing — both showed `email_confirmed_at: null`, `confirmation_sent_at` populated, `last_sign_in_at: null`, and zero corresponding `household_member` rows. Read `rpc_bootstrap_household()`'s live definition (`pg_get_functiondef`): it resolves the caller entirely via `auth.uid()`, with a `begin/exception when unique_violation` block that does **not** catch a `check_violation`. Cross-referenced against Story 1.3's fix (which relaxed `household_member.auth_user_id` from `NOT NULL` to nullable with `CHECK (is_deleted OR auth_user_id IS NOT NULL)`): when the RPC runs as `anon`, `auth.uid()` is `NULL`, so the `insert into household_member (..., auth_user_id, ...) values (..., NULL, ...)` with `is_deleted` defaulting to `false` violates that CHECK constraint directly — an exception type the function's handler doesn't catch, so it propagates and fails the whole call. Confirmed live that `rpc_bootstrap_household()` currently grants `EXECUTE` to `anon` (a known gap already tracked as STEW-33) — that grant is *why* the call gets far enough to hit the CHECK violation instead of being rejected outright at the permission layer; both are real, and this story closes the specific instance of STEW-33 on this function as a byproduct (see Implementation Instructions).

**Trigger pattern verified against Supabase's own documentation** (not assumed from memory): the canonical pattern is a `SECURITY DEFINER` function reading `NEW.id` directly, attached via `AFTER INSERT ON auth.users FOR EACH ROW`. No trigger currently exists on `auth.users` (checked live via `pg_trigger`) — this is a net-new attachment point, not a conflict with anything.

**Audit-trigger interaction, checked:** `trg_audit_household` and `trg_audit_household_member` (Story 3.3) both fire on the inserts this new trigger performs, via `fn_audit_log()`. That function also resolves its actor via `auth.uid()`, which will be `NULL` in this trigger's execution context (the insert happens under whatever role the Auth service uses to write `auth.users`, not a client session) — `audit_log_entry.household_member_id` is nullable, so this produces a correctly-attributed "no specific actor" audit row for a system-driven action, not an error. No change needed to `fn_audit_log()`.

**IMPLEMENTATION_CONVENTIONS.md checklist**, applied to the new `fn_bootstrap_household()` trigger function: (1) RLS enable+force — not applicable, no new table. (2) Audit trigger attachment — not applicable, the function isn't itself a table needing an audit trigger; the tables it writes to already carry theirs (see above). (3) Explicit `anon`/`authenticated` revoke on every new `SECURITY DEFINER` function — applied below, even though Postgres refuses to let any role invoke a trigger-returning function directly outside trigger context; this is a defense-in-depth application of the convention, not reliance on it being exploitable. (4) "Confirm the grant" via live query, not file inspection — the Deployment Instructions below require the same live grants query used throughout this session. **Aside, not in scope for this story:** the same live-grants check surfaced that `fn_audit_log()` (Story 3.3) still grants `EXECUTE` to `PUBLIC`/`anon`/`authenticated`, predating both STEW-33 and the conventions doc — worth folding into STEW-33 or a new line item, not fixed here.

**Trust boundary:** none new. Email and password remain validated entirely by Supabase Auth's own primitives; this story adds no new input surface — the trigger reads only `NEW.id`, a value Supabase Auth itself generates, never client-supplied.

### Acceptance Criteria

(Restated verbatim from above.)

1. Given a brand-new sign-up (email + password) on a project with email confirmation required (the default, and what `ohhsteward-dev` is actually configured with), when the form is submitted, then the household and household_member (role `parent`) rows are created immediately and atomically as part of account creation — with no dependency on an active client session.
2. Given the same scenario, when `signUp()` returns with `session: null` (confirmation pending), then the client shows a "check your email to confirm your account" state, and does not attempt to call any bootstrap RPC that assumes an authenticated session.
3. Given the user later clicks the email confirmation link and then logs in with their password, when authentication succeeds, then they land on the dashboard with their already-created household in place — no bootstrap call happens or is needed at login time.
4. Given a user attempts to log in before confirming their email, then Supabase Auth itself refuses to issue a session (existing platform behavior).
5. **(Negative security / idempotency AC)** Given the household-bootstrap trigger fires for a user who already has an active `household_member` row (retry, duplicate event, or a lingering call to the legacy RPC), then no second household or household_member row is created and no error is raised to the caller.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:**
   - Do NOT disable, weaken, or otherwise touch Supabase Auth's email-confirmation setting — it stays on, exactly as configured.
   - Do NOT build any email-confirmation deep-link handling on either client — not needed by this design.
   - Do NOT change `rpc_bootstrap_household()`'s existing logic or drop it — leave its body as-is; only its grants change (step 7).
   - Do NOT change `fn_audit_log()` — its `NULL`-actor behavior in this new trigger's context is correct as-is (see Grounding Check).
   - Do NOT build any UI beyond a plain "check your email to confirm your account" state — no resend-confirmation button, no countdown, no polling for confirmation status, unless a future story calls for it.
   - Do NOT touch the login screen's error handling beyond what already exists — Supabase's own refusal to authenticate an unconfirmed user is not something this story needs to build or message specially.
4. Write a new migration creating `public.fn_bootstrap_household()`: `SECURITY DEFINER`, `SET search_path TO 'public'` (consistent with every other function in this schema), `RETURNS trigger`. Body: if an active `household_member` row already exists for `NEW.id` (`auth_user_id = NEW.id and not is_deleted`), return `NEW` immediately (idempotency, AC5). Otherwise, insert a new `household` (default values) and a `household_member` row (`household_id`, `auth_user_id = NEW.id`, `role = 'parent'`), wrapped in the same `begin/exception when unique_violation then null` pattern the existing RPC uses, then return `NEW`.
5. Attach it: `CREATE TRIGGER trg_bootstrap_household_on_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.fn_bootstrap_household();`
6. `REVOKE ALL ON FUNCTION public.fn_bootstrap_household() FROM PUBLIC, anon, authenticated;` — defense-in-depth per IMPLEMENTATION_CONVENTIONS item 3, even though Postgres won't allow direct invocation of a trigger-returning function outside trigger context.
7. `REVOKE ALL ON FUNCTION public.rpc_bootstrap_household() FROM anon, authenticated;` — no client caller remains after step 8, and this closes STEW-33's finding for this specific function as a byproduct. Do not drop the function itself (Do NOT list, above).
8. On both clients, change the sign-up handler: after `signUp()` resolves, branch on whether a `session` was returned. If yes (some environment has confirmation disabled), route to the dashboard as before — the trigger has already created the household, so no RPC call is made in either branch. If no (`session: null`, confirmation pending — the actual, current `ohhsteward-dev` behavior), show a "check your email to confirm your account" screen instead of attempting any further authenticated call. Remove the previously-unconditional `rpc_bootstrap_household()` call from this flow entirely on both platforms.
9. Local validation (per the Migration rule, §7 rule 5): before opening the PR, sign up a fresh test user against the local Supabase CLI stack with email confirmation left **on** (matching `ohhsteward-dev`'s actual setting — do not test this against a local stack that has confirmations disabled, since that would validate the wrong configuration), and confirm the trigger creates the household/household_member rows even though no session was ever established. This is the single most important validation step in this DIP — a bug in step 4's function fails every future signup outright (Supabase returns "Database error saving new user" for the whole request), not just this story's case.

### Code Requirements

**Secure Coding Requirements** (OWASP ASVS Level 2 / CWE — reproduced verbatim, mandatory on every DIP):

1. **Injection.** All SQL is parameterized. String concatenation or interpolation of any value into SQL, shell commands, file paths, or query strings is prohibited. This applies equally to SQL supplied in a DIP — any SQL supplied in a DIP must itself be parameterized, or explicitly marked as a one-time DDL/migration statement executed with no user-supplied input. (CWE-89, CWE-78; ASVS V5)
2. **Input validation at trust boundaries.** Validate type, range, length, format, and allowed values on every input crossing a boundary — API route, RPC call, Edge Function, file upload, or external system response. Validate server-side; client-side validation is never sufficient. Reject by default rather than sanitize where a closed set of valid values exists. (ASVS V5)
3. **Output encoding.** Encode data for the context it enters — HTML, URL, SQL identifier, log line, or downstream message/notification. (CWE-79; ASVS V5)
4. **Secrets.** No credential, connection string, key, token, or certificate may appear in source, configuration committed to the repository, test fixtures, log output, error messages, or telemetry. Secrets are resolved at runtime through the platform's environment-variable and secret management, never hardcoded. (CWE-798; ASVS V6, V14)
5. **Sensitive data in logs and telemetry.** Do not log credentials, tokens, personal data, or full request/response payloads. Where a record must be traceable, log an identifier or reference, never the content. (CWE-532; ASVS V7, V8)
6. **Authentication and authorization.** Use the platform's authentication primitives — never implement custom authentication, session handling, or token validation. Enforce authorization on the server for every protected operation, and **fail closed** — an authorization check that errors must deny, never allow. (ASVS V2, V3, V4)
7. **Least privilege.** Database roles, RLS policies, service credentials, and API scopes are the minimum required by the story. Do not grant broad access for convenience. (ASVS V1)
8. **Cryptography.** Never write custom cryptography or invent a scheme. Use platform-provided algorithms and key management. TLS is required for all data in transit; do not disable certificate validation, including in local/dev code paths. (CWE-327, CWE-295; ASVS V6, V9)
9. **Deserialization and parsing.** Treat every inbound payload as untrusted — request bodies, webhook payloads, file uploads. Do not deserialize to arbitrary or polymorphic types from untrusted input; validate against an explicit schema rather than trusting shape. (CWE-502, CWE-611; ASVS V5)
10. **Error handling.** Error responses must not disclose stack traces, SQL text, connection strings, internal hostnames, or file paths to the client. Log the detail server-side; return a generic message and, where useful, a correlation identifier externally. (CWE-209; ASVS V7)
11. **Dependencies.** Do not add a dependency not named in the DIP. Any dependency the DIP does add must be pinned to an explicit version. (ASVS V14)
12. **Concurrency and state.** Where the story involves shared state or idempotency, the implementation must be safe under concurrent execution and retry — a check-then-act sequence over shared state must be atomic. (CWE-362)

**Application to this story:** Obligation 6 (Authentication/authorization): household creation now happens entirely through Supabase's own account-creation event, not a custom endpoint — no new auth surface is introduced. Obligation 7 (Least privilege): the new trigger function's grants are revoked from every client-facing role (step 6); the legacy RPC's grants are tightened for the same reason (step 7) rather than left broader than necessary. Obligation 12 (Concurrency/idempotency): AC5 exists specifically because this function can, in principle, run more than once for the same user (retry, duplicate delivery, or the legacy RPC being invoked afterward with a real session) — the existing-row check plus the unique partial index (`uq_household_member_active_user`) make repeat execution a safe no-op rather than a duplicate or an error, a property carried over unchanged from the existing RPC's own design. Obligation 10 (Error handling): if the trigger function raises anything other than the caught `unique_violation`, the entire signup request fails with Supabase's generic "Database error saving new user" — no internal detail is exposed to the client either way.

### API Contract

Not applicable — no new client-callable API/RPC surface. The one function this story adds is a trigger, never invoked directly by any client; the one function it changes (`rpc_bootstrap_household`) has its grants narrowed, not its contract.

### Non-Functional Requirements

*Performance:* One additional trigger execution per signup — negligible; two single-row inserts, same as the logic it replaces.

*Scalability:* No scale concern — per-signup, one-time operation.

*Reliability:* This is the primary reliability improvement this story makes: bootstrap now happens exactly once, atomically, at account-creation time, regardless of confirmation settings, client bugs, or whether the user ever returns to the app after signing up. The trade-off, disclosed rather than hidden: a bug in the trigger function fails signup entirely for every user, not just degrades one feature — which is why step 9's local validation is called out as the single most important step in this DIP.

*Security:* ASVS chapters in scope: V1 (Least privilege — grants narrowed on both the new and legacy functions), V4 (Access Control — household creation is no longer reachable by any client role at all, closing that surface rather than merely gating it). Trust boundaries: none new — the trigger consumes only `NEW.id`, generated by Supabase Auth itself, never client input. Sensitive data: none handled by this story beyond what Supabase Auth already manages. Weaknesses excluded: CWE-362 (concurrent/duplicate trigger firings are idempotent by design, per AC5).

### Observability

Rely on Supabase Auth's own signup logs for the `auth.users` insert itself, and Postgres logs for any trigger-function exception (which would surface to the client as a generic "Database error saving new user," per Obligation 10 — the detail stays server-side in the Postgres logs). No new application-level logging is introduced.

### Files to Create/Modify

Intent-driven:
- Supabase migrations: new migration file adding `fn_bootstrap_household()`, its trigger on `auth.users`, and the two `REVOKE` statements from steps 6–7.
- `apps/web`: sign-up page/hook — remove the unconditional bootstrap RPC call, add the session-branch and "check your email" state.
- `apps/mobile`: same change, mirrored.

### Migration Files (if applicable)

```sql
-- Bootstrap a new household + household_member(parent) row directly from auth.users,
-- independent of email-confirmation state or any client session.
create or replace function public.fn_bootstrap_household()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing_household uuid;
  v_new_household uuid;
begin
  select household_id into v_existing_household
    from household_member
   where auth_user_id = new.id and not is_deleted
   limit 1;

  if v_existing_household is not null then
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
```

This is written to disk as a migration file and validated locally (Migration rule, §7 rule 5) — never applied directly against `ohhsteward-dev` by CC.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-34

1. After merge, confirm live (per IMPLEMENTATION_CONVENTIONS item 4 — a query, not file inspection) that `fn_bootstrap_household()` and `rpc_bootstrap_household()` both show no `anon`/`authenticated` grant on `ohhsteward-dev`.
2. Sign up one fresh real test account against `ohhsteward-dev` end-to-end and confirm a `household_member` row appears immediately (query `public.household_member`), before ever confirming that account's email.
3. No Supabase Auth dashboard settings change — email confirmation stays exactly as configured.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations directory (new trigger + function + two revokes); the web sign-up page/hook and mobile sign-up screen/hook (remove the bootstrap RPC call, add the no-session "check your email" branch).

**Expected integration behavior:** sign-up becomes a single call (`signUp()`) on both clients; the household is guaranteed to exist by the time any session is ever established, so nothing downstream (login, dashboard load) needs to account for a "confirmed but no household yet" state.

**Data flow impact:** none to the schema — same two tables, same columns, just written by a trigger instead of a client-invoked RPC.

**Dependencies to add/update:** none.

**Constraints:** do not alter `household_member.auth_user_id`'s nullable/CHECK design from Story 1.3 — this story relies on it (a NULL `auth_user_id` would violate the CHECK exactly as it does today; this trigger simply never attempts that, since `NEW.id` is always a real value at `auth.users` insert time).

### Change Impact

- What changes: Household bootstrap moves from a client-invoked RPC to a database trigger on `auth.users`; both apps' sign-up flow stops calling that RPC and instead branches on whether `signUp()` returned an active session.
- What it touches: `public.household`, `public.household_member` (write path only), a new trigger + trigger function, the web and mobile sign-up screens.
- Breaking risk: No — replaces a bootstrap path that has never worked correctly under this project's actual settings.

### Branch Name

feature/1.1.G2-household-bootstrap-trigger

### Commit Message

1.1.G2: Move household bootstrap to an auth.users trigger so signup works under mandatory email confirmation

### Pull Request Description

Maps to each Acceptance Criterion:
- AC1: `fn_bootstrap_household()` fires on every `auth.users` insert, unconditionally, and creates the household/household_member(parent) rows using `NEW.id` directly — no session required.
- AC2: both clients now check for `session` after `signUp()` and show a "check your email" state instead of calling the old RPC when it's null.
- AC3: login after confirmation lands on the dashboard with the household already in place — no client-side bootstrap call exists anymore.
- AC4: unchanged, existing Supabase Auth behavior — verified, not modified.
- AC5 (negative/idempotency): the existing-row check plus the unique partial index make repeat trigger firings, or a lingering call to the now-grant-revoked legacy RPC, a safe no-op.

### Jira Linkage

- PDE Story ID: 1.1.G2
- Jira Epic Key: STEW-1
- Jira Story Key: STEW-34

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-1.1.G2.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests locally and merges manually.

Include full diffs for every file created or modified in the completion report — not a summary. For any file this DIP requires to remain untouched (`fn_audit_log()`, the RLS policies on `household`/`household_member`, the `household_member.auth_user_id` column definition itself), include `git diff dev [branch] -- [file]` showing zero output as explicit proof.

### Confidence Assessment

- **Confidence Score:** 82
- **Reasoning:** The root cause is fully confirmed against live data (not inferred), the fix follows Supabase's own documented pattern for this exact problem, and the idempotency/grant-hardening pieces reuse patterns already proven elsewhere in this codebase (Story 1.2/1.3's grant-revoke work, the existing unique-index-based idempotency check). The score isn't higher because this is the highest-stakes migration shipped so far in terms of blast radius — a mistake in the trigger function doesn't degrade one feature, it can break every future signup — so correctness here rests entirely on step 9's local validation actually being run before the PR opens, not on inspection alone.
- **Top Risk Areas:** (1) A raised exception in `fn_bootstrap_household()` other than the caught `unique_violation` fails the entire signup for every user, not just this story's case — must be validated locally with confirmation left ON, matching `ohhsteward-dev`'s real setting, not tested against a local stack with confirmations disabled. (2) Forgetting to remove the client-side RPC call on either platform would reintroduce today's exact bug's failure mode (the call would still run as `anon` and still hit the same CHECK violation) even though the trigger had already succeeded — a false-negative failure that would look identical to the original bug. (3) `fn_audit_log()`'s still-open `PUBLIC`/`anon`/`authenticated` grant (noted in Grounding Check) is out of scope here but should be folded into STEW-33 or its own ticket before it's forgotten.

### ⚠️ Open Questions to be Answered Before Moving Forward

None.

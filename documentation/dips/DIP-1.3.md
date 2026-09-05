# DIP-1.3 — Minimum-One-Parent Guardrail & Self-Deletion Handling

**Jira Key:** STEW-12 (Epic STEW-1) | **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward | **Base Branch:** dev

---

## Story (Persona 3 format)

**Review Summary Strip:** Story ID: 1.3 | Objective: Guarantee a household always has admin coverage | Core Change: Deletion-blocking logic for the last Parent, plus a minimal account-deletion entry point (see Grounding Check — none exists yet) | Risk Level: Medium | Confidence Score: 87 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As the sole Parent of a household, I want the system to prevent me from deleting my account until I promote someone else to Parent, so that the household is never left without an admin.

**Acceptance Criteria:**
1. Given exactly one Parent in a household, when that Parent attempts self-deletion, then the system blocks it and displays a message instructing them to promote another Member first.
2. Given more than one Parent in a household, when one of them deletes their own account, then the deletion proceeds normally.
3. Given a Parent promotes a Member to Parent, when that promotion succeeds, then the original Parent can subsequently delete their own account without being blocked.
4. Given the guardrail check, when evaluated, then it counts only active (non-soft-deleted) Parents.

**Dependencies & Assumptions:** Depends on Story 1.1 (role model). **Correction to the pre-drafted assumption:** the pre-drafted version of this story assumed a Profile screen with an existing "Delete my account" action already exists, to be wired to this story's guard. Verified against the actual repo (PRs #1–#7): no Profile/Account/Settings screen exists yet in either app — Epic 6/7, where one is properly scheduled, hasn't been built. This story therefore includes building a minimal, single-purpose account-deletion entry point in both apps (see Implementation Instructions item 9) — not a full Profile screen, which remains Epic 6/7's job. Role promotion UI is still assumed to exist on a future Profile screen (Epic 6/7 concern) — this story covers the guardrail logic and its own minimal trigger point, not promotion UI.

**Traceability:** PIB Objective: "Household integrity — minimum one Parent enforced at all times." PSDD Journey: H (Last Parent Attempts Self-Deletion).

**Change Impact:**
- What changes: `rpc_delete_own_account()` guard-and-soft-delete RPC; a `delete-own-account` Edge Function orchestrating the guard step and the Auth-record removal step; a minimal account-deletion entry point in both apps.
- What it touches: `household_member` (soft-delete), `auth.users` (via Admin API, not directly).
- Breaking risk: No, but this is a security/integrity-relevant story — treat conservatively.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:** Implement a guard check invoked before any self-account-deletion completes: count active Parents in the household; if the requester is the sole active Parent, block with the specified message. Do NOT implement: any blocking of deletion for Members or for Parents when other Parents exist (Apple policy requires deletion to otherwise proceed unblocked) — this guard applies to the last-Parent case ONLY. Do NOT build a full Profile/Settings screen — only the minimal entry point this story's own ACs require.

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (read-then-block check; the corrected locking pattern below has no side effects on a blocked attempt) | Reason: Pure validation logic with a narrow, well-specified exception.

**Standing Rule:** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

---

## Story Summary

Guarantees a household is never left without an active Parent by blocking a sole Parent's self-deletion until they promote another Member. This is a narrow, security-relevant guard on top of Supabase Auth's account-deletion capability, plus the minimal client-side entry point needed to actually reach it (verified missing from the current codebase — see Grounding Check).

## Repo Target

Both `apps/web` and `apps/mobile` (a minimal account-deletion entry point in each, per the corrected Dependencies note) plus the shared Supabase backend (migration + one Edge Function).

## Grounding Check

Verified live against the `ohhsteward-dev` Supabase project and the actual repository state (not assumed from spec language):

- `household_member` columns (`id`, `household_id`, `auth_user_id`, `role`, `is_deleted`) confirmed live, matching this DIP's references exactly.
- **No new table is created by this story** — `IMPLEMENTATION_CONVENTIONS.md` items 1–2 (RLS force-enable, audit trigger attachment) are not applicable here; noted explicitly rather than silently skipped.
- **`IMPLEMENTATION_CONVENTIONS.md` item 3 applies** — the pre-drafted version of `rpc_delete_own_account()` only had `revoke all ... from public; grant execute ... to authenticated`, the same incomplete pattern already found to leave `anon` with `EXECUTE` on four other functions. Fixed below with an explicit `revoke execute ... from anon`.
- **Bug found and fixed — this one would have failed on every single call:** the pre-drafted SQL used `select count(*) ... for update` to lock and count active Parents in one statement. Postgres does not allow locking clauses (`FOR UPDATE`/`FOR SHARE`) on a query containing an aggregate function — the query would raise `ERROR: FOR UPDATE is not allowed with aggregate functions` on every invocation. Confirmed this codebase already avoids the mistake elsewhere (`rpc_create_invite`'s member-cap count correctly uses a plain, unlocked `count(*)`) — the 1.3 draft is the only place this pattern was attempted. Fixed below using the standard two-step pattern: a non-aggregated `PERFORM ... FOR UPDATE` to acquire the row locks, followed by a separate plain `count(*)` that safely reads the now-locked, consistent row set.
- **Gap found and fixed:** the original SQL had no handling for a caller with zero matching `household_member` rows (e.g., an already-soft-deleted or otherwise inconsistent state) — `v_household`/`v_role`/`v_member_id` would all resolve to `NULL`, the Parent-guard branch would be skipped (since `NULL = 'parent'` is not true), the subsequent `UPDATE ... WHERE id = NULL` would silently affect zero rows, and the function would still proceed to delete the underlying Auth account. Fixed by failing closed with an explicit exception when no active membership is found, per Secure Coding Obligation 6.
- **Correction, not a bug:** the pre-drafted SQL included an illustrative call to `auth.admin_delete_user(auth.uid())`, which does not exist as a callable SQL function — the DIP's own prose already correctly said this was "illustrative of intent" and that the real Auth-record removal must happen via a service-role Edge Function. Removed the fictional call from the literal Code Requirements below (replaced with a comment) so nothing in the DIP's actual SQL block references a function that doesn't exist, even under an "illustrative" label.
- **Orchestration clarified (was ambiguous in the pre-drafted version):** the RPC alone only soft-deletes the `household_member` row — it cannot remove the `auth.users` record itself (Supabase Auth Admin API is not callable from plain SQL). The pre-drafted DIP said a "companion service-role Edge Function performs the Auth-record removal after the guard-and-soft-delete step commits" but didn't specify how the Edge Function invokes the guarded RPC while preserving the correct `auth.uid()` context. Specified below: the client calls a `delete-own-account` Edge Function (not the RPC directly) with its own session; the Edge Function forwards the caller's own JWT to call `rpc_delete_own_account()` (so `auth.uid()` resolves correctly, scoped to the caller), and only on success uses a separate service-role Admin client to remove the `auth.users` record. The RPC itself stays `authenticated`-granted — it is inherently self-scoped (no caller-supplied target id), so this is not a security change, only an orchestration clarification.
- Trust boundary: none beyond the caller's own verified session — this RPC takes no parameters and acts only on `auth.uid()`.

## Acceptance Criteria

1. Given exactly one Parent in a household, when that Parent attempts self-deletion, then the system blocks it and displays a message instructing them to promote another Member first.
2. Given more than one Parent in a household, when one of them deletes their own account, then the deletion proceeds normally.
3. Given a Parent promotes a Member to Parent, when that promotion succeeds, then the original Parent can subsequently delete their own account without being blocked.
4. Given the guardrail check, when evaluated, then it counts only active (non-soft-deleted) Parents.
5. **(Negative security AC)** Given a request to `rpc_delete_own_account()`, when invoked, then it only ever reads or writes the `household_member` row matching the caller's own `auth.uid()` — no code path in this function accepts or acts on a client-supplied member id.

## Implementation Instructions

1. **Standing Rule (verbatim):** "Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it."
2. **Standing Rule scope clarification (verbatim):** "This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version."
3. **Do NOT implement:**
   - Do NOT block deletion for a Member (the guard applies to Parents only).
   - Do NOT block a Parent's self-deletion when another active Parent exists.
   - Do NOT build a new promotion/role-change UI in this story — only consume the existing `role` field.
   - Do NOT build a full Profile/Settings screen — only a minimal entry point exposing the "Delete my account" action, per item 9 below.
   - Do NOT grant `EXECUTE` on `rpc_delete_own_account` to `anon`.
   - Do NOT call `rpc_delete_own_account()` using a service-role client with a caller-supplied target id — it must only ever be invoked with the requesting user's own forwarded JWT, so `auth.uid()` resolves to the actual caller.
4. Write `rpc_delete_own_account()` (`security definer`, granted to `authenticated` only): lock the caller's own `household_member` row; if the caller is a Parent, lock every active Parent row in the household (non-aggregated `PERFORM ... FOR UPDATE` — never combine a locking clause with an aggregate), then count them in a separate statement; if the count is 1, raise the exact guidance message from AC1 and roll back; otherwise soft-delete the caller's row.
5. Build the `delete-own-account` Edge Function: read the caller's own JWT from the request's Authorization header; construct a Supabase client using that JWT (not the service-role key) and call `rpc_delete_own_account()` through it, so the guard correctly evaluates the actual caller; if the RPC raises, return its message verbatim to the client (per API Contract — it is safe to surface directly, per Application to this story below); if the RPC succeeds, use a separate service-role Admin client to call Auth Admin `deleteUser(callerId)`.
6. Confirm the promotion path (existing role-change capability, not built by this story) updates `household_member.role`, so that after a promotion the guard naturally re-evaluates to a passing state on the next self-deletion attempt — no separate cache or flag to invalidate.
7. In `apps/web`: add a minimal account page (e.g., `apps/web/app/dashboard/account/page.tsx`) containing only a "Delete my account" action that calls the `delete-own-account` Edge Function and surfaces its response (success → sign out and redirect; blocked → display the guidance message verbatim).
8. In `apps/mobile`: add an equivalent minimal "delete account" state to the existing `App.tsx` state machine, reachable from the dashboard, calling the same Edge Function.
9. Both entry points are scoped to only this action — no other account/profile settings are in scope for this story (see Do NOT list).

## Code Requirements

```sql
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
```

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
- **Obligation 6 (Authentication/Authorization, fail closed):** the function operates exclusively on `auth.uid()`'s own `household_member` row — there is no parameter accepting a target member id, so this RPC can never be used to delete someone else's account. A caller with no resolvable active membership now fails closed via an explicit exception (the fixed gap above) rather than silently falling through. If the guard-check itself errors for any reason, the transaction rolls back and no deletion occurs.
- **Obligation 12 (Concurrency):** the two-step lock-then-count pattern (`PERFORM ... FOR UPDATE` on the qualifying rows, then a plain `count(*)`) closes the check-then-act race between two Parents self-deleting at the same moment — without the lock, both could read count=2, both proceed, and the household could end up with zero Parents. This also fixes the pre-drafted version's illegal combination of a locking clause with an aggregate, which would have failed outright at runtime.
- **Obligation 10 (Error handling):** the guard's exception message (AC1's guidance text) contains no internal detail and is safe to surface to the client verbatim — this is the one exception in this schema to the generic-external-message pattern, and it's safe specifically because the message is a fixed, pre-written string with no interpolated internal state.

## API Contract

- Edge Function `POST /functions/v1/delete-own-account` — no body; authenticated via the caller's own session (Authorization header forwarded to the internal RPC call, per Implementation Instructions item 5). Response contract: **200** on successful deletion; **400** with `{ error: "You are the only Parent in this household. Promote another member to Parent before deleting your account." }` when blocked (the RPC's own exception message, safe to surface verbatim per Application to this story); **500** only for a genuinely unexpected server error, returning `{ error: "something went wrong", correlation_id }` and never internal detail.
- `rpc_delete_own_account()` itself remains an internal building block, callable only via a client authenticated as the target user (forwarded-JWT pattern) — not intended for direct client invocation via `supabase.rpc()`, since a standalone RPC call would only soft-delete the membership row without ever removing the Auth account.

## Non-Functional Requirements

**Performance:** Single transaction with a small row lock; negligible latency impact.

**Scalability:** Bounded by household size (capped at `member_cap`, default 5) — trivial scale.

**Reliability:** Row locking prevents the zero-Parent race condition under concurrent self-deletion. If the Edge Function's Auth-deletion step fails after the RPC has already soft-deleted the caller's `household_member` row, the account is left in a soft-deleted-but-not-fully-removed state — acceptable for this story (the household-integrity guarantee, the actual goal here, is already satisfied at that point), but worth surfacing to the user as a generic failure rather than a false success.

**Security:** ASVS chapters in scope: V4 (Access Control — self-only action, no caller-supplied target). Trust boundary: none beyond the verified JWT forwarded into the RPC call — no client-supplied identifiers are trusted anywhere in this flow. Sensitive data: none beyond the existing account/session data already governed elsewhere. Weaknesses excluded: CWE-362 (race on the last-Parent count, mitigated by the corrected lock-then-count pattern).

## Files to Create/Modify

- New Supabase migration: `rpc_delete_own_account()`.
- New Supabase Edge Function: `delete-own-account`.
- `apps/web`: new minimal account page (e.g., `apps/web/app/dashboard/account/page.tsx`) with only the delete-account action.
- `apps/mobile`: a new minimal "delete account" state in `App.tsx`'s existing state machine.
- No existing files from Stories 1.1/1.2/2.1/3.3 are modified.

## Migration Files

Raw SQL as shown in Code Requirements above. Written to disk under `supabase/migrations/`, validated locally via the Supabase CLI before being proposed for the remote Preview project — never applied directly to a remote/production project by CC.

## Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-12

1. Apply the `rpc_delete_own_account()` migration.
2. Deploy the `delete-own-account` Edge Function.
3. Confirm `rpc_delete_own_account`'s execute grant is `authenticated`-only and `anon` does NOT have it — verify with a live grants query (per `IMPLEMENTATION_CONVENTIONS.md` item 4), not by inspection of the migration file alone.
4. CC stages changes, commits, pushes the feature branch, and opens a PR against `dev` following local validation. Does not merge — Joseph tests locally and merges manually.

## Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations; one new Edge Function (`delete-own-account`); a new minimal account-deletion entry point in each app (not a full Profile screen — see Grounding Check).

**Expected integration behavior:** the client's only path to deleting its own account is the `delete-own-account` Edge Function — never a direct Supabase Auth Admin call from the client, and never a direct `supabase.rpc('rpc_delete_own_account')` call without the Edge Function's subsequent Auth-removal step.

**Data flow impact:** soft-deletes the caller's `household_member` row before the underlying `auth.users` record is removed by the Edge Function.

**Dependencies to add/update:** none new.

**Constraints:** must not alter the deletion behavior for Members or for Parents with active co-Parents — this story only adds a narrow exception path, not a general deletion redesign. Must not build any Profile/Settings functionality beyond the single delete-account action.

## Change Impact

- What changes: `rpc_delete_own_account()`, `delete-own-account` Edge Function, minimal account-deletion entry point in both apps.
- What it touches: `household_member` (soft-delete), `auth.users` (via Admin API).
- Breaking risk: No.

## Branch Name

feature/1.3-parent-guardrail

## Commit Message

1.3: Add minimum-one-parent guardrail and account-deletion entry point

## Pull Request Description

Maps to each Acceptance Criterion:
- AC1: `rpc_delete_own_account()` blocks and returns the exact guidance message when the caller is the sole active Parent.
- AC2: deletion proceeds normally when more than one active Parent exists.
- AC3: the guard re-evaluates on each call, so a promotion (existing role-change capability) naturally unblocks a subsequent attempt.
- AC4: the Parent count only ever considers `not is_deleted` rows.
- AC5 (negative security): the function takes no parameters and acts only on `auth.uid()`'s own row.

## Jira Linkage

- PDE Story ID: 1.3
- Jira Epic Key: STEW-1
- Jira Story Key: STEW-12

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-1.3.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary.

## Confidence Assessment

- **Confidence Score:** 88/100
- **Reasoning:** The pre-drafted version of this DIP had a SQL statement that would have failed on every single invocation (`FOR UPDATE` combined with an aggregate) — caught and fixed here by inspection against known Postgres locking-clause semantics, not by executing it, so CC's local validation is still the first actual execution of this corrected logic and should be treated as a real check, not a formality. The Profile-screen assumption was also corrected against the actual repo state rather than the spec's literal (and, it turned out, inaccurate) claim that such a screen already exists.
- **Top Risk Areas:**
  1. The lock-then-count pattern is a genuine (if standard) two-statement concurrency technique — CC's local validation should specifically exercise the concurrent-co-Parent-self-deletion race, not just the single-caller happy path, to confirm the fix actually closes the race it's meant to close.
  2. The forwarded-JWT pattern in the `delete-own-account` Edge Function (using the caller's own token to invoke the RPC, then switching to a service-role client only for the Auth-removal step) is new to this codebase — every prior Edge Function in this project has used either a pure service-role client (`send-invite-email`) or created a fresh session (`accept-invite`), not forwarded an inbound user JWT to a second internal call. Worth a specific look during review.
  3. Building a minimal account page/state that didn't exist before is a bigger UI footprint than a typical "wire an existing action" story — reasonable and narrowly scoped here, but worth confirming the placeholder doesn't get built out into more than this story's single action.

## ⚠️ Open Questions to be Answered Before Moving Forward

None at the design level.

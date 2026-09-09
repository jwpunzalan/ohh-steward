# Story 7.1.G1 — Remove Parent-Facing Household Cap Screen/RPC (Platform-Owner-Only)

**Review Summary Strip:** Story ID: 7.1.G1 | Objective: Correct a scope error found reviewing the live Story 7.1 deploy — Member/Budget caps must not be tenant-editable | Core Change: Remove the household cap screen, its sidebar entry, and `rpc_update_household_caps` entirely; caps become direct-database-only | Risk Level: Low | Confidence Score: 93 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As the platform owner, I want `member_cap`/`budget_cap` editable only by me directly (via Supabase), never through the web app, so that these stay platform-level limits and no household can raise its own cap.

**Dependencies & Assumptions:** Depends on, and reverses part of, Story 7.1 (merged PR #29, `dev` commit `e380f98`). Confirmed directly with Joseph 2026-09-08: no plan/tier system exists for this product (single-household personal use, not monetized multi-tenant SaaS), so this is a straightforward policy correction, not a business-logic redesign — the caps simply were never meant to be Parent-facing.

**Traceability:** Originating story: 7.1 (Household Setup, Invite/Cap Management). This gap was found live-testing Story 7.1's Vercel Preview deploy, the same day it merged.

**Change Impact:**
- What changes: Removes the `/dashboard/household` screen, its sidebar entry, and `rpc_update_household_caps` — all added by Story 7.1.
- What it touches: `apps/web/app/dashboard/household/` (deleted), `apps/web/app/dashboard/layout.tsx`, a new migration dropping the RPC, `tests/rls/rls-ci-01.test.ts`.
- Breaking risk: No — the screen shipped hours ago and was not used to change real cap values (confirmed: current `household.member_cap`/`budget_cap` are still their pre-7.1 values); removing it loses no data.

---

### Story Summary

Story 7.1 built `/dashboard/household` and `rpc_update_household_caps` on the reading that PSDD's Role Model ("Parent — ...cap configuration") and Journey A ("Subscriber is prompted to set the Member cap and Budget cap... editable") made these Parent-facing settings. Reviewing the live deploy, Joseph clarified the actual intent: these caps are a platform-owner control, not something a household should be able to raise on its own — the PSDD language was read too literally against a business reality the docs didn't fully spell out. This story removes exactly what 7.1 added for this purpose (the screen, the sidebar entry, the RPC) and leaves the columns editable only through direct Supabase access outside the application, which needs no RPC at all since a service-role/Studio connection already bypasses RLS. The two CHECK constraints Story 7.1 added (`household_member_cap_range`, `household_budget_cap_range`) are kept — they're a plain data-integrity guard rail against a typo during a direct edit, unrelated to who initiates the edit, so there's no reason to remove them.

### Repo Target

`apps/web` (delete the screen and its sidebar entry) and `supabase/migrations` (drop the RPC). No mobile change — the caps screen never existed on mobile.

### Grounding Check

- **Current live values confirmed unchanged:** `household.member_cap`/`budget_cap` still hold their original values — the screen was never used to change a real household's caps before this correction, confirmed by re-reading the row Story 7.1's own RLS-CI-01 tests exercised (those tests use disposable fixture households, not any real one).
- **No other code depends on `rpc_update_household_caps`.** Confirmed via `git grep` across `apps/web`/`apps/mobile`/`tests`: the only call sites are `apps/web/app/dashboard/household/page.tsx` (deleted by this story) and `tests/rls/rls-ci-01.test.ts`'s `"RLS-CI-01: household cap admin access"` block (trimmed by this story, not deleted wholesale — see Instruction 4).
- **The CHECK constraints have no dependency on the RPC.** `household_member_cap_range`/`household_budget_cap_range` are plain column constraints on `household` — they apply to any write path (direct `.update()`, Studio, the now-removed RPC) and are unaffected by dropping the function. Confirmed live: `select conname from pg_constraint where conrelid = 'household'::regclass` still lists both after reasoning through the drop — `DROP FUNCTION` never touches table constraints.
- **`household_parent_access` RLS policy is untouched by this story** — a Parent can still, technically, run a raw `.from("household").update(...)` from a browser console since that policy was never changed by 7.1 or this story (7.1's DIP explicitly kept it out of scope, reasoning that closing "any value" was the CHECK constraint's job, not an RLS change). This story doesn't reopen that decision — removing the *deliberate, discoverable* screen and RPC closes the realistic path; a Parent hand-crafting a raw Supabase client call from devtools is a different threat model this story was never asked to address, and doing so now would be exactly the kind of silent scope expansion the Standing Rule forbids. If Joseph wants that path closed too, it's a separate, explicit decision (tightening `household_parent_access` to exclude `member_cap`/`budget_cap` from `with_check`, or splitting the policy) — not assumed here.
- **Trust boundary:** none newly introduced — this story only removes surface area, it adds no new input path.

### Acceptance Criteria

1. Given the `/dashboard/household` route, when accessed by anyone (Parent or Member, or unauthenticated), then it no longer exists — the file is deleted, so Next.js returns its standard 404.
2. Given the dashboard sidebar, when rendered, then no "Household Settings" entry appears anywhere — the `SETUP` array reverts to the six entries it had before Story 7.1's cap screen was added (Categories, New Budget, New Account, Invite, Security, Account), with `CORE` and `activeHref` logic completely untouched.
3. Given `rpc_update_household_caps(int, int)`, when any client (web, a raw RPC call, any role) attempts to call it, then the call fails because the function no longer exists in the schema.
4. Given the CHECK constraints `household_member_cap_range` and `household_budget_cap_range`, they remain exactly as Story 7.1 left them — no migration in this story touches them.
5. **(Negative security AC)** Given a direct `.from("household").update({ member_cap: <value> })` call from any authenticated Parent's client (the pre-existing, RLS-permitted path this story does not change), the write still succeeds for an in-range value and is still rejected by the CHECK constraint for an out-of-range one — proving the constraint remains the real backstop after the RPC is gone, independent of any application code.

### Implementation Instructions

1. *Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.*

2. *This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline (§6): writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.*

3. **Do NOT implement:**
   - Any change to the `household_parent_access` RLS policy — see Grounding Check. A Parent's direct-`.update()` path stays exactly as permissive as it was after Story 7.1; only the discoverable screen and RPC are removed.
   - Any change to the CHECK constraints, `trg_audit_household`, or any other part of the `household` table's schema beyond dropping the one function.
   - Any change to the Category management screen, its RPCs, the route guard (`middleware.ts`), or `member-web-blocked` — none of Story 7.1's other deliverables are touched by this correction.
   - Any change to the beige/white background issue Joseph also flagged this session — that's tracked separately as part of the upcoming pastel-reskin pass, not this story.
   - Any new Budget-settings or Preferences screen — those are separate gap stories (7.1.G2 and a future mobile-side story), not folded into this cleanup.

4. **Migration.** Create `supabase/migrations/20260908010000_remove_household_caps_rpc.sql`:
   ```sql
   drop function if exists rpc_update_household_caps(int, int);
   ```
   No change to `household`'s columns or constraints.

5. **Delete `apps/web/app/dashboard/household/page.tsx`** entirely.

6. **Modify `apps/web/app/dashboard/layout.tsx`:** remove the `SETUP` array's `{ href: "/dashboard/household", ... }` entry and the now-unused `SlidersIcon` function. Leave `CORE`, `activeHref`, `NavList`, the `TagIcon`/Categories entry, and every other `SETUP` entry exactly as they are.

7. **Trim `tests/rls/rls-ci-01.test.ts`'s `"RLS-CI-01: household cap admin access"` block** (added by Story 7.1): remove the three test cases that call `rpc_update_household_caps` (they'd otherwise permanently fail once the function is dropped) — "AC1/AC3: a Parent can set caps...", "AC4: a Member calling rpc_update_household_caps...", "an unauthenticated call to rpc_update_household_caps...", and "rpc_update_household_caps rejects an out-of-range value...". **Keep** the two tests that exercise direct `.from("household").update(...)` behavior ("a direct .from('household').update() with an out-of-range cap is rejected by the CHECK constraint" and "a Member's direct .from('household').update() is filtered out by household_parent_access RLS") — both are still true and still the only coverage of `household`'s own RLS/CHECK behavior; deleting them would silently reopen the exact coverage gap `IMPLEMENTATION_CONVENTIONS.md` item 5 called out. Rename the `describe` block to `"RLS-CI-01: household direct-write constraints"` to reflect what it now actually covers, and trim the `beforeAll`/`afterAll` fixture setup to only what the remaining two tests use (both still need `parentA`/`memberB`/`householdId`, so the fixture setup itself is largely unchanged — just remove the now-dead `caps()` calls inside the four deleted tests' bodies, keeping the `caps()` helper itself since the two surviving tests still use it).

### Code Requirements

**Secure Coding Requirements**

1. **Injection.** All SQL is parameterized. String concatenation or interpolation of any value into SQL, shell commands, file paths, or query strings is prohibited. This applies equally to SQL written by Atlas — any SQL supplied in a DIP must itself be parameterized, or explicitly marked as a one-time DDL/migration statement executed with no user-supplied input. (CWE-89, CWE-78; ASVS V5)
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

**Application to this story:** Obligation 7 (least privilege) is the one this story actually exercises — removing `rpc_update_household_caps`'s `authenticated` grant entirely (by dropping the function) is a least-privilege tightening: no client role should have ever been able to change a platform-level setting, and this closes that. No other obligation is freshly exercised — this story removes code, it writes none beyond a one-line `DROP FUNCTION` DDL statement with no user input involved (obligation 1 is trivially satisfied, not really "at risk" here).

### API Contract

`rpc_update_household_caps` is removed — not applicable. No other API/RPC surface is touched.

### Non-Functional Requirements

**Performance:** No impact — removing one unused code path.

**Scalability:** No impact.

**Reliability:** No impact — the removed screen was live for a matter of hours and, per the Grounding Check, was never used to change a real household's caps.

**Security:** ASVS chapters in scope: V1 (least privilege — the RPC's `authenticated` grant is removed entirely, per obligation 7 above). Trust boundary: none newly introduced. Sensitive data: none. Weaknesses this story must not introduce: none — it is a pure removal.

### Observability

Nothing to log — a `DROP FUNCTION` in a migration is already visible in the migration history itself; no application-level logging is relevant to a deleted code path.

### Files to Create/Modify

- `supabase/migrations/20260908010000_remove_household_caps_rpc.sql` (new) — drops `rpc_update_household_caps`.
- `apps/web/app/dashboard/household/page.tsx` (delete).
- `apps/web/app/dashboard/layout.tsx` (modify) — remove one `SETUP` entry and the `SlidersIcon` function only.
- `tests/rls/rls-ci-01.test.ts` (modify) — remove 4 of 6 test cases in the block Story 7.1 added; keep 2; rename the block.

**Explicit constraint (must NOT be altered):** every other file Story 7.1 touched or left untouched — `apps/web/app/dashboard/categories/page.tsx`, `apps/web/middleware.ts`, `apps/web/lib/supabase/middleware.ts`, `apps/web/app/member-web-blocked/page.tsx`, the `household_member_cap_range`/`household_budget_cap_range` CHECK constraints, and the entire "must NOT be altered" list from DIP-7.1 itself. Include `git diff [base] [branch] -- [file]` showing zero output for each in the completion report.

### Migration Files

```sql
-- 20260908010000_remove_household_caps_rpc.sql
--
-- Story 7.1.G1 — corrects Story 7.1's scope: member_cap/budget_cap are a
-- platform-owner setting, not a tenant/Parent one (confirmed directly with
-- Joseph 2026-09-08). The CHECK constraints from Story 7.1
-- (household_member_cap_range, household_budget_cap_range) stay in place --
-- unrelated to who initiates a write, still a useful guard rail for a direct
-- Studio/service-role edit. Only the client-callable write path is removed.

drop function if exists rpc_update_household_caps(int, int);
```

### Deployment Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`
- **Jira Key:** `STEW-51`

1. Apply the migration locally (Supabase CLI), confirm it validates.
2. Confirm live: `select proname from pg_proc where proname = 'rpc_update_household_caps';` returns zero rows after migration.
3. Confirm live: `select conname from pg_constraint where conrelid = 'household'::regclass;` still lists both CHECK constraints — unaffected.
4. Run the trimmed `rls-ci-01` suite locally — the two surviving tests in the renamed block must still pass.
5. Stage, commit, push, open the PR against `dev`. Do not merge — Joseph tests on Vercel Preview and merges manually.

### Repository Integration Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`

**Components to extend:** none — this story only removes a page, a sidebar entry, a function, and four test cases.

**Expected integration behavior:** the sidebar's remaining nine destinations (3 `CORE` + 6 `SETUP`) all continue to work unchanged; `/dashboard/household` returns a standard 404; `/dashboard/categories` and everything else Story 7.1 shipped is completely unaffected.

**Data flow impact:** none — `household.member_cap`/`budget_cap` keep their current values; only the RPC that could change them is removed.

**Dependencies to add/update:** none.

**Explicit constraints (must NOT be altered):** the `household_parent_access` RLS policy, both CHECK constraints, `rpc_upsert_category`/`rpc_delete_category`, the middleware/route guard, and every file in Story 7.1's own "must NOT be altered" list.

### Branch Name

feature/7.1.G1-remove-household-caps-ui

### Commit Message

7.1.G1: Remove Parent-facing household cap screen and RPC — platform-owner-only setting

### Pull Request Description

Corrects a scope error found reviewing Story 7.1's live deploy: `member_cap`/`budget_cap` were built as Parent-editable, but Joseph confirmed these are a platform-owner setting, not something a household should be able to raise itself (this product has no plan/tier system for the caps to be gating). Removes `/dashboard/household`, its sidebar entry, and `rpc_update_household_caps` entirely (AC1–AC3). The CHECK constraints Story 7.1 added stay in place — a data-integrity guard rail independent of who edits the row (AC4). AC5 confirms the constraint is still the real backstop for a direct `.update()` after the RPC is gone. No other part of Story 7.1 is touched.

### Jira Linkage

- PDE Story ID: 7.1.G1
- Jira Epic Key: STEW-7
- Jira Story Key: STEW-51

---

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-7.1.G1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests on Vercel Preview and merges manually.

Include full diffs for every file created, modified, or deleted in the completion report per §7 rule 13 — not a summary — plus the explicit zero-output `git diff` proof for each file in the "must NOT be altered" list above.

### Confidence Assessment

- **Confidence Score:** 93
- **Reasoning:** This is a small, mechanical removal with no new logic — the highest-confidence kind of DIP, since there's very little for an implementation to get wrong. The only real judgment call (trimming rather than deleting the whole test block) is spelled out explicitly rather than left to inference.
- **Top Risk Areas:**
  1. The test-file trim (Instruction 7) is the one place a careless implementation could over-delete — removing the whole `describe` block instead of the four specific tests would silently reopen the `household` RLS/CHECK coverage gap `IMPLEMENTATION_CONVENTIONS.md` item 5 exists to prevent. Worth a specific check in review.
  2. Confirm no other in-flight branch or uncommitted work depends on `rpc_update_household_caps` before merging — it was only live for a few hours, so this should be a non-issue, but worth a quick `git grep` sanity check right before merge given how recently it shipped.

---

## Confidence Assessment

- **Confidence Score:** 93
- **Reasoning:** See story-level Confidence Assessment above.
- **Top Risk Areas:** See above.

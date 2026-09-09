# Story 7.1.G2 — Budget Settings Screen (Period Type, Currency, Surplus Destination) — Web + Mobile

**Review Summary Strip:** Story ID: 7.1.G2 | Objective: Close a confirmed, previously-flagged gap — no UI anywhere edits a Budget's period type, currency, or surplus destination after creation | Core Change: One new settings screen per platform, reading/writing `budget` directly (no new RPC — the write path is already fully DB-validated) | Risk Level: Low | Confidence Score: 88 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As a Budget owner or co-owner, I want to change my Budget's period type, currency, and surplus destination after it's created, so that I'm not stuck with whatever I picked at creation time or forced to ask for a direct database edit.

**Dependencies & Assumptions:** Depends on Stories 2.1 (Budget/RLS), 2.4 (currency reference table), 5.2 (`surplus_destination_id` column + its validation trigger, live). Not blocked by Story 7.1.G1 (unrelated table). Per Joseph's explicit direction: covers both `apps/web` and `apps/mobile` in one story, since PSDD specifies this capability as available to any Budget owner/co-owner (not Parent-only) and PIB frames it as "same capability as mobile" — a web-only build would leave Member-owners with no way to reach it at all, since Story 7.1's route guard now blocks Members from web entirely.

**Traceability:** Originating stories: 5.2 (flagged the gap explicitly: *"ready for whichever future story (6.1/7.1, not decided here) builds a settings surface for it"*) and 6.1 (same note, never picked up). PIB Web Admin section: *"Budget creation/settings (same capability as mobile)."* PSDD: *"Budget-level settings: period type, surplus destination — editable by any owner/co-owner of that Budget."*

**Change Impact:**
- What changes: One new settings screen per platform for an existing Budget's `period_type`/`default_currency`/`surplus_destination_id`; a small entry point added next to each platform's existing Budget picker.
- What it touches: `apps/web` (new route + a small addition to `dashboard/page.tsx`), `apps/mobile/App.tsx` (new `Screen` value + a small addition to the dashboard's Budget picker).
- Breaking risk: No — additive UI over an already-working, already-validated write path; no schema or RLS change.

---

### Story Summary

Story 5.2 added `budget.surplus_destination_id` (with a DB-level validation trigger) and Story 2.4 added `budget.default_currency` (FK-constrained to a real currency table); `period_type` has existed since Story 2.1. All three are freely writable today via the existing `budget_read_write` RLS policy — any Parent, or any Member who is an owner/co-owner of that specific Budget (via `can_access_budget`), can already update them with a plain client `.update()` call. But no screen on either platform has ever exposed that. `/dashboard/budgets/new` (web) sets only `name` and `period_type` at creation; nothing sets `default_currency` or `surplus_destination_id` anywhere, ever — confirmed as a live pain point in the 2026-09-07 session manifest, where Joseph had to set `default_currency` directly against the database because no UI existed. This story builds exactly that missing settings surface, on both platforms, reusing the write path that's already there rather than adding a new RPC — the same reasoning Story 5.2's own Grounding Check already used for `surplus_destination_id`: *"the write path... already works today via the same permissive `budget_read_write` RLS policy `period_type`/`default_currency` already use."*

### Repo Target

Both apps. `apps/web`: a new per-Budget settings route, plus a small link next to the existing Budget picker on `dashboard/page.tsx` — there is currently no way to navigate to a specific Budget at all outside the picker's own `<select>`, so this story's entry point is genuinely new, not a reuse of an existing link. `apps/mobile`: a new `Screen` value in the existing `App.tsx` state machine, following the same in-place-extension convention every other mobile story this session has used (no navigation library, no screens directory), plus a small settings affordance next to mobile's own Budget picker.

### Grounding Check

- **`budget` table columns and constraints, confirmed live:** `id`, `household_id`, `name`, `period_type text not null` (CHECK `period_type = ANY(ARRAY['monthly','biweekly'])`), `created_by`, `is_deleted`, `created_at`, `default_currency character` (FK → `currency(code)`), `surplus_destination_id uuid` (FK → `account(id)`, nullable).
- **`budget_read_write` RLS policy, confirmed live:** `cmd = ALL`, `qual = is_household_parent(household_id) OR can_access_budget(id)`, no `with_check`. This already permits a direct client `.update()` on any of the three target columns, by a Parent or by any Budget owner/co-owner — exactly the access PSDD specifies, already in place, no policy change needed.
- **`trg_budget_validate_surplus_destination`, confirmed live** (`BEFORE INSERT OR UPDATE OF surplus_destination_id ON budget`, calls `fn_validate_surplus_destination_scope()`): this is Story 5.2's own DB-level guard restricting the destination to a real account belonging to *this* Budget, and (per 5.2's own Do-Not-Implement list) excluding `credit_card`-type accounts. This story's client code does not need to reimplement that check — it only needs to build a picker that offers *sensible* choices (accounts belonging to this Budget, non-archived, non-credit-card) so a user doesn't hit the DB rejection needlessly; the trigger remains the actual enforcement regardless of what the dropdown offers.
- **`rpc_create_budget`'s live body, confirmed via `pg_get_functiondef`:** takes only `p_name`, `p_period_type`, `p_owner_member_ids` — it has never set `default_currency` or `surplus_destination_id`, on either platform, at any point. This story adds the only path that ever sets them.
- **`account` table columns, confirmed live:** includes `budget_id`, `type`, `name`, `is_archived`, `is_deleted` — enough to build the destination-account picker's query (`budget_id = <this budget>`, `type <> 'credit_card'`, `is_archived = false`, `is_deleted = false`).
- **`currency` table, confirmed to exist** (Story 2.4's 154-row ISO-4217 reference table, `code`/`name` columns) — the currency dropdown's data source.
- **No existing route reaches a specific Budget on web.** Confirmed by directory listing: `apps/web/app/dashboard/budgets/` contains only `new/`. No `[id]` route exists. This story adds it.
- **Mobile's `Screen` union type, confirmed live** (`apps/mobile/App.tsx` lines 31–44): includes `"account-detail"` as the precedent for a single-record settings/edit screen reached from a list/picker — this story's `"budget-settings"` follows that exact naming and structural pattern.
- **Trust boundary:** the three form values (`period_type`, `default_currency`, `surplus_destination_id`) are untrusted client input. All three are already validated server-side by existing, unchanged mechanisms — a CHECK constraint, an FK constraint, and an FK constraint plus trigger, respectively — so this story adds a UI layer over validation that already exists; it does not introduce a new validation boundary.
- **IMPLEMENTATION_CONVENTIONS.md walk-through:** Item 1/2 (RLS+audit on new tables) — N/A, no new table. Item 3/4 (`anon` grant hygiene) — N/A, no new function; this story calls no RPC at all. Item 5 (RLS-CI-01 coverage) — `budget`'s isolation (Parent-vs-Member-vs-cross-household) is already covered by the existing `"RLS-CI-01: budget tenant isolation"` block; this story doesn't change `budget`'s RLS, so no new isolation test is owed — but see Instruction 7 for the one genuinely new behavior (the surplus-destination trigger) that has no client-driven test today. Item 6 (mobile keyboard) — **applies**: the settings screen has no text input crossing near the keyboard in a way that risks trapping a primary action (it's two pickers and one dropdown, no free-text field), but the screen must still be built inside the same scrollable/keyboard-safe container convention already used elsewhere for consistency; stated explicitly in Instruction 6. Item 7/8 — N/A, no anon-grant change, no upsert-with-guard-trigger pattern introduced.

### Acceptance Criteria

1. Given a Budget owner, co-owner, or Parent, when they open that Budget's settings (web: a new per-Budget route reached from a link next to the dashboard's Budget picker; mobile: a new screen reached the same way), then they see the Budget's current `period_type`, `default_currency`, and `surplus_destination_id` (as a labeled account, or "None" if unset).
2. Given a change to any of the three fields, when saved, then it is written to the `budget` row and reflected immediately on the next read — no deploy required, matching every other Budget-scoped setting in this system.
3. Given a Member who is not an owner or co-owner of the Budget being viewed, when they attempt to reach or save its settings, then the write is denied at the database layer (the existing `budget_read_write` RLS policy, unchanged) — the client shows a generic error, never the raw denial.
4. Given a surplus-destination selection, when the dropdown is populated, then it only offers accounts belonging to this Budget that are not archived, not soft-deleted, and not `credit_card`-type — narrowing the choices to what the existing DB trigger would accept, without relying on the client narrowing alone to enforce it.
5. **(Negative security AC)** Given a request that bypasses the client-side dropdown narrowing entirely (e.g. a raw `.update()` call setting `surplus_destination_id` to a `credit_card` account, or one belonging to a different Budget), when it executes, then `trg_budget_validate_surplus_destination` rejects it — the client-side narrowing in AC4 is a UX convenience, not the enforcement boundary.

### Implementation Instructions

1. *Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.*

2. *This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline (§6): writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.*

3. **Do NOT implement:**
   - Any new RPC. The existing `budget_read_write` RLS policy plus the existing CHECK/FK/trigger validation are already sufficient — a plain `.from("budget").update(...)` is the correct, precedented write path (matches Story 5.2's own stated reasoning for this exact column).
   - Any change to `budget_read_write`, `trg_budget_validate_surplus_destination`, `fn_validate_surplus_destination_scope`, or any RLS policy or trigger on any table.
   - Renaming, deleting, or reassigning a Budget — this story is settings-only for the three named fields; anything else about a Budget's lifecycle is untouched.
   - A general "Budgets list" page. The entry point is a single link/icon next to the *currently selected* Budget in each platform's existing picker — not a new browsable list of every Budget (that's a bigger, separate UX decision not asked for here).
   - Editing `name` — not one of the three fields named in this story's scope; the only existing way to set a Budget's name remains `/dashboard/budgets/new` (web) / mobile's equivalent creation screen, both unchanged.
   - Any change to the Household Settings work in Story 7.1/7.1.G1 — unrelated table, unrelated screens.
   - Any visual reskin using the Story 10.2 design-system primitives — this screen follows the same plain, unstyled form convention as `/dashboard/security`, `/dashboard/invites/new`, etc. (Story 10.3's concern, not yet DIP'd).

4. **Web: create `apps/web/app/dashboard/budgets/[id]/page.tsx`.** On mount: `.from("budget").select("id, name, period_type, default_currency, surplus_destination_id").eq("id", params.id).single()` (RLS scopes visibility automatically); `.from("currency").select("code, name").order("name")` for the currency dropdown; `.from("account").select("id, name, type").eq("budget_id", params.id).eq("is_deleted", false).eq("is_archived", false).neq("type", "credit_card")` for the surplus-destination dropdown (AC4). Render a plain form (matching `/dashboard/security`'s convention — no design-system primitives): a `period_type` `<select>` (`monthly`/`biweekly`), a `default_currency` `<select>` populated from the currency list, and a `surplus_destination_id` `<select>` populated from the filtered account list plus an explicit "None" option (the column is nullable). On submit: `.from("budget").update({ period_type, default_currency, surplus_destination_id: surplus_destination_id || null }).eq("id", params.id)`; on error, a generic message ("We couldn't save those changes. Please try again." — Secure Coding obligation 10, since the RLS denial and the trigger's rejection message must not be surfaced verbatim); on success, a confirmation and a re-read of the row (AC2).

5. **Web: add the entry point.** In `apps/web/app/dashboard/page.tsx`, immediately next to the existing Budget `<select>` picker (around the `budgetId`/`budgets` state already there), add a small, plain link — `<Link href={\`/dashboard/budgets/${budgetId}\`}>Settings</Link>` or an unstyled icon button — visible only once a Budget is selected (`budgetId` is truthy). This is the only change to this file; do not touch any other part of the dashboard.

6. **Mobile: add `"budget-settings"` to the `Screen` union type** in `apps/mobile/App.tsx`, following the exact pattern `"account-detail"` already establishes. Add a new render branch (`if (screen === "budget-settings")`) with the same three fields as the web screen, using the same three Supabase queries/writes (adapted to React Native form controls — e.g. a simple picker/segmented control for `period_type`, since Expo has no native `<select>`). Wrap the screen in the existing `KeyboardAvoidingView` convention this session's `IMPLEMENTATION_CONVENTIONS.md` item 6 already establishes as the default for every mobile form screen, even though this screen has no free-text input near the primary action — stated explicitly here so the convention isn't silently skipped just because the risk is low on this particular screen. Add a small "Settings" affordance next to mobile's own Budget picker on the dashboard screen (same trigger condition as web: visible once a Budget is selected), navigating to `setScreen("budget-settings")` with the selected Budget's id carried in state, following the same pattern `"account-detail"` already uses to carry its own selected-record id.

7. **New RLS-CI-01 test coverage for the one genuinely untested behavior.** `trg_budget_validate_surplus_destination` (Story 5.2) has never had a client-driven test confirming it rejects an invalid destination via a direct `.update()` call — Story 5.2's own test coverage exercised it only through the rollover job's internal path. Add to `tests/rls/rls-ci-01.test.ts`, inside or alongside the existing budget-scoped fixtures: (a) a Budget owner's direct `.from("budget").update({ surplus_destination_id: <a credit_card account's id> })` is rejected; (b) the same call with an account belonging to a *different* Budget is rejected; (c) the same call with a valid, same-Budget, non-credit-card account succeeds. This directly covers AC5.

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

**Application to this story:** Obligation 2 (input validation) is central but already satisfied by existing server-side mechanisms this story reuses rather than reimplements — the CHECK constraint on `period_type`, the FK on `default_currency`, and the FK+trigger on `surplus_destination_id` all predate this story; AC4/AC5 confirm the client narrows choices sensibly while the DB stays the real boundary. Obligation 6 (authorization, fail closed): AC3 confirms a non-owner's write is denied by the existing `budget_read_write` RLS policy, unchanged by this story — no new authorization logic is written here at all. Obligation 10 (error handling): both platforms show a generic message on any write failure, never the RLS denial or trigger-rejection text verbatim.

### API Contract

No new RPC or API route. Direct, RLS-governed table access only:
- `.from("budget").select("id, name, period_type, default_currency, surplus_destination_id").eq("id", <budget id>).single()`
- `.from("currency").select("code, name").order("name")`
- `.from("account").select("id, name, type").eq("budget_id", <budget id>).eq("is_deleted", false).eq("is_archived", false).neq("type", "credit_card")`
- `.from("budget").update({ period_type, default_currency, surplus_destination_id }).eq("id", <budget id>)` — success: no special return needed, caller re-reads; failure: an RLS-denial (empty result, no thrown error — matches this table's existing behavior) or a trigger/constraint exception (thrown), both surfaced to the user as the same generic message.

### Non-Functional Requirements

**Performance:** Three small reads plus one update per screen visit; negligible at this app's scale.

**Scalability:** Bounded by household/Budget counts already established elsewhere in the system.

**Reliability:** Settings apply immediately (AC2) since nothing caches `budget`'s columns — every existing reader (the rollover job, account-creation currency pre-fill) reads the live row on each use, unchanged by this story.

**Security:** ASVS chapters in scope: V4 (Access Control — the existing `budget_read_write` RLS policy is the actual boundary; this story adds no new authorization surface), V5 (Validation — the three fields are validated by pre-existing CHECK/FK/trigger mechanisms, not new code). Trust boundary: the three form values are untrusted client input, already bounded server-side. Sensitive data: none. Weaknesses this story must not introduce: CWE-862/863 (missing/incorrect authorization) — none possible here since no new authorization logic is written; CWE-209 (error handling) — generic messages only, per obligation 10.

### Observability

Budget setting changes are already covered by the universal audit trail — `trg_audit_budget` fires on every `UPDATE`, including one from this story's new screens, with no additional logging needed.

### Files to Create/Modify

- `apps/web/app/dashboard/budgets/[id]/page.tsx` (new) — the Budget settings screen.
- `apps/web/app/dashboard/page.tsx` (modify) — one small link/button added next to the existing Budget picker; nothing else touched.
- `apps/mobile/App.tsx` (modify) — new `"budget-settings"` `Screen` value, its render branch, and a small entry-point affordance next to mobile's Budget picker; nothing else touched.
- `tests/rls/rls-ci-01.test.ts` (modify) — three new test cases per Instruction 7.

**Explicit constraint (must NOT be altered):** `apps/web/app/dashboard/budgets/new/page.tsx`, `apps/web/app/dashboard/household/**` (already removed by 7.1.G1 — do not resurrect), `apps/web/app/dashboard/categories/page.tsx`, `apps/web/middleware.ts`, `rpc_create_budget`, `fn_validate_surplus_destination_scope`, `trg_budget_validate_surplus_destination`, and every other file untouched by this story. Include `git diff [base] [branch] -- [file]` showing zero output for each in the completion report.

### Migration Files

Not applicable — no schema, RLS, or trigger change. This story is UI-only over an already-complete, already-validated write path.

### Deployment Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`
- **Jira Key:** `STEW-52`

1. No migration to apply.
2. Run the extended `rls-ci-01` suite locally (including the three new cases from Instruction 7) before pushing.
3. Manually verify on both platforms locally: a Budget owner can change all three fields and see them persist; a non-owner Member (mobile only — web blocks Members entirely per Story 7.1's guard) cannot.
4. Stage, commit, push, open the PR against `dev`. Do not merge — Joseph tests on Vercel Preview (web) and a device/simulator build (mobile) and merges manually.

### Repository Integration Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`

**Components to extend:** a new Next.js dynamic route (web); the existing `App.tsx` state machine (mobile, additive `Screen` value + render branch, following the `"account-detail"` precedent exactly); a small, additive touch to each platform's existing dashboard Budget picker.

**Expected integration behavior:** the new entry point appears only once a Budget is selected in each picker; selecting it and returning (via back navigation) must not disturb the dashboard's own selected-Budget/Period state — confirm this explicitly, since Story 6.1's dashboard state (`budgetId`, `selectedPeriod`) lives in the same file this story adds a link into.

**Data flow impact:** writes to `budget.period_type`/`default_currency`/`surplus_destination_id`, read by: the rollover job (`period_type`), the account-creation currency pre-fill (`default_currency`, Story 2.4.G1), and the surplus-transfer step (`surplus_destination_id`, Story 5.2) — all already read the live row, so no downstream change is needed for them to see this story's writes.

**Dependencies to add/update:** none.

**Explicit constraints (must NOT be altered):** `budget_read_write` RLS, `trg_budget_validate_surplus_destination`/`fn_validate_surplus_destination_scope`, `rpc_create_budget`, and every file in the "must NOT be altered" list above.

### Change Impact

- What changes: One new settings screen per platform for an existing Budget's period type, currency, and surplus destination; a small entry point on each dashboard.
- What it touches: `apps/web` (new route + small dashboard addition), `apps/mobile/App.tsx` (new screen + small dashboard addition), `tests/rls/rls-ci-01.test.ts`.
- Breaking risk: No.

### Branch Name

feature/7.1.G2-budget-settings-web-mobile

### Commit Message

7.1.G2: Add Budget settings screen (period type, currency, surplus destination) on web and mobile

### Pull Request Description

Closes a gap Story 5.2's own DIP explicitly flagged and left unresolved: `budget.period_type`, `default_currency`, and `surplus_destination_id` have had no edit UI on either platform since the columns were added — confirmed as a real pain point in the 2026-09-07 session manifest (Joseph set `default_currency` directly via the database). Adds one settings screen per platform (web: a new `/dashboard/budgets/[id]` route; mobile: a new `"budget-settings"` screen following the existing `Screen` state-machine convention), both reached via a small new entry point next to each platform's existing Budget picker. No new RPC — the write path (`budget_read_write` RLS, already permitting any Parent or Budget owner/co-owner) and all three fields' validation (a CHECK constraint, an FK constraint, and an FK+trigger pair) already existed and are reused as-is (AC1–AC3). The surplus-destination dropdown narrows to sensible choices client-side (AC4), while the existing DB trigger remains the actual enforcement boundary, now covered by three new committed tests that had never existed for it before (AC5).

### Jira Linkage

- PDE Story ID: 7.1.G2
- Jira Epic Key: STEW-7
- Jira Story Key: STEW-52

---

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-7.1.G2.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests on Vercel Preview (web) and a device/simulator build (mobile) and merges manually.

Include full diffs for every file created or modified in the completion report per §7 rule 13 — not a summary — plus the explicit zero-output `git diff` proof for each file in the "must NOT be altered" list above.

### Confidence Assessment

- **Confidence Score:** 88
- **Reasoning:** Every write path and every piece of validation this story relies on already exists and is already live-verified — there is genuinely no new authorization or validation logic to get wrong. The main source of residual risk is mechanical: this is the first story since Story 6.1 to touch `apps/mobile/App.tsx`'s dashboard render branch and `apps/web/app/dashboard/page.tsx` at the same time as a web story, so there's real (if modest) risk of a careless edit disturbing either file's existing state management — mitigated by keeping both touches explicitly small and named (Instructions 5 and part of 6).
- **Top Risk Areas:**
  1. `apps/web/app/dashboard/page.tsx` and `apps/mobile/App.tsx` are both large, actively-evolving files this session — confirm via the completion report's diff that only the described small addition landed in each, nothing else shifted.
  2. The surplus-destination dropdown's client-side filter (AC4) must match the DB trigger's actual rule exactly (same Budget, non-`credit_card`, and this DIP additionally excludes archived/deleted accounts as a UX nicety not enforced by the trigger) — worth a specific check that a deliberately-mismatched raw update (AC5/Instruction 7) still gets rejected, proving the dropdown was never the real boundary.
  3. Mobile's `KeyboardAvoidingView` convention (Instruction 6) is easy to skip on a screen that "doesn't obviously need it" (no free-text field) — confirm it's applied anyway, per `IMPLEMENTATION_CONVENTIONS.md` item 6's explicit "default expectation for every mobile form screen, not something to add reactively."

---

## Confidence Assessment

- **Confidence Score:** 88
- **Reasoning:** See story-level Confidence Assessment above.
- **Top Risk Areas:** See above.

# Story 6.1 — Dashboard Core View (Budget/Period Picker, Category States)

*DIP v2 — grounded against the live `ohhsteward-dev` schema and the current `dev` branch source. Supersedes the speculative v1 draft embedded in `BACKLOG_DIP.md`.*

## Revision Note (v1 → v2)

1. **`v_category_period_state`'s join omitted soft-delete filtering.** Live schema confirms both `category` and `transaction` carry `is_deleted boolean not null`. RLS does not filter soft-deleted rows — it only scopes by household/budget — so every existing client query that reads these tables filters `is_deleted = false` explicitly at the query layer (confirmed in `apps/web/app/dashboard/transactions/page.tsx`: both its `transaction` load and its `category` load carry `.eq("is_deleted", false)`). Without the same filter here, a deleted Category would still show up with a (frozen) spend figure, and a deleted Transaction's amount would remain counted in `spent` forever. Added `and not c.is_deleted` to the category join and `and not t.is_deleted` to the transaction join condition.
2. **Real repo structure verified — this changes the mobile implementation instructions materially.** Web's target is `apps/web/app/dashboard/page.tsx`, currently a placeholder (a welcome message plus a plain list of links to other pages) with no real content to preserve beyond replacing it. Mobile has **no navigation library and no separate screens directory at all** — the entire mobile app is one 1576-line file, `apps/mobile/App.tsx`, built as a hand-rolled `Screen` string-union state machine (`useState<Screen>` plus a chain of `if (screen === "...")` blocks). `"dashboard"` is already one of those branches (currently a placeholder, at the time of this grounding starting around line 1391). The v1 draft's Repository Integration Instructions said only "Dashboard screen/component (web + mobile)" with no awareness of this — this DIP's mobile instructions extend that existing `if (screen === "dashboard")` block in place. Do NOT introduce React Navigation, Expo Router, or a new file/folder structure for mobile.
3. **Budget-picker query pattern confirmed, with one correctness addition.** The existing `loadAccountBudgets()` in `App.tsx` already does the simplest possible thing — `select("id, name, default_currency").from("budget")` with zero role branching — relying entirely on the `budget_read_write` RLS policy (`is_household_parent(household_id) OR can_access_budget(id)`) to return "all household Budgets" for a Parent and "only assigned Budgets" for a Member. This confirms AC3 needs no client-side role logic. That existing call does **not** filter `is_deleted`, however; this story's own Budget-picker query adds `.eq("is_deleted", false)` — a deleted Budget must not be selectable on the dashboard (AC1/AC3 imply only real, current Budgets). This DIP does not modify the pre-existing `loadAccountBudgets()` call itself.
4. **Idle-timeout convention confirmed not applicable to this story's queries.** Existing mobile code calls `guardIdleOrSignOut` only immediately before write/mutation actions (`handleCreateBudget`, `handleCreateAccount`, `handleCreateTransaction`, `handleSetSplits`, `handleSendInvite`, `handleDeleteAccount` — verified by direct inspection, 6/6 call sites are inside `handle*` mutation functions). Pure read/load functions (`loadAccountBudgets`, `loadTransactionData`, `loadTransactionList`) never call it; idle enforcement on resume is handled separately by `checkIdleAndSignOutIfElapsed`. This story's dashboard queries are pure reads, so per existing convention they do not call `guardIdleOrSignOut` either.
5. **`budget_owner(budget_id, household_member_id)` confirmed as the live assignment table** backing "Member's assigned Budget(s)," via `can_access_budget()`'s actual body — matches v1's assumption; verified, not re-guessed.
6. **Real Jira keys found:** Story STEW-25, Epic STEW-6 (both were unresolved in v1).

No blocking questions arose — this story adds no new authorization surface and both open items above (soft-delete filtering, mobile file structure) are corrections grounded in already-established convention, not new design decisions.

---

**Review Summary Strip:** Story ID: 6.1 | Objective: Primary daily-use screen — Budget/Period pickers plus Category-state list | Core Change: New `v_category_period_state` read-only view + Dashboard UI (web + mobile) | Risk Level: Medium | Confidence Score: 88 | Blocking Issues: None | ClaudeCode Ready: Yes (depends on 2.1, 3.1, 5.1 — all live)

**User Story:** As any household member, I want to open the app and immediately see how each Category is doing this period, so that I can quickly gauge my household's/my own financial state.

**Acceptance Criteria:**
1. Given a user with access to one or more Budgets, when the dashboard loads, then a Budget picker and Period picker (with historical navigation) are shown.
2. Given a selected Budget/Period, when displayed, then all Categories show their current-period spending state, occupying the largest portion of screen space.
3. Given a Parent, when using the Budget picker, then all household Budgets are available for selection; given a Member, only their assigned Budget(s).
4. Given a Category with no historical data for the selected period, when displayed, then it shows a clear empty/zero state rather than an error.
5. **(Negative security AC)** Given a Member querying `v_category_period_state` for a `budget_period_id` belonging to a Budget they are not assigned to, when the query executes, then it returns zero rows — the view's `security_invoker` setting ensures the underlying `budget_period`/`transaction` RLS policies are evaluated as the querying Member, never bypassed.

**Dependencies & Assumptions:** Depends on Story 2.1 (Budget access rules — live), 3.1 (transactions to aggregate — live), 5.1 (periods to navigate — live). Assumption carried forward from 5.1: `category_limit.limit_amount` has no currency of its own; this story only ever displays it byte-for-byte alongside `spent`, never converts or blends it — multi-currency display treatment is Story 6.2's concern.

**Traceability:** PIB Objective: "Dashboard, quick look at budget state." PSDD Capability: Dashboard & Reporting; PSDD Journey D, E.

**Change Impact:**
- What changes: New `v_category_period_state` read-only view; Dashboard screen content (web: `apps/web/app/dashboard/page.tsx`; mobile: the `"dashboard"` branch of `apps/mobile/App.tsx`).
- What it touches: `budget`, `budget_period`, `category`, `category_limit`, `transaction`, `transaction_split` (all read-only).
- Breaking risk: No — additive view, no existing RPC/table signature changes.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement the dashboard as specified: Budget picker, Period picker with historical (older/newer) navigation, and a Category-state list as the dominant visual element, built entirely on read-only queries against existing RLS-scoped tables plus the one new view. Do NOT implement: the pacing-ratio health-indicator calculation or any Green/Amber/Red coloring (Story 6.2's concern — this story only displays raw spend/limit figures and layout); a materialized view (the DVP explicitly deferred that optimization — use the plain view below); any navigation library or new file/folder structure on mobile (extend the existing `App.tsx` state machine in place); any write/mutation path on `budget`, `budget_period`, or `category_limit` (this story is read-only, full stop).

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (read-only view; no state change on repeat) | Reason: Primarily a read/display story built on already-established, already-verified RLS-scoped data.

Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

This rule governs security policy, not secure implementation: the Secure Coding Baseline below always applies and is never out of scope. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

---

### Story Summary

Implements the primary daily-use screen: a Budget picker, a Period picker with historical (older/newer) navigation, and a Category-state list occupying the dominant portion of the screen, built entirely on the RLS-scoped data already established through Story 5.1. A new read-only Postgres view, `v_category_period_state`, aggregates `transaction_split` amounts by `budget_period_id`/`category_id` joined to `category_limit` for the configured limit — this is the single shared aggregation Story 6.2 (pacing) will also read from, so "what to show" (6.1) and "how to color it" (6.2) never duplicate aggregation logic. Per the DVP's explicit deferral, this is a plain indexed view, not materialized.

### Repo Target

- **Web:** `apps/web/app/dashboard/page.tsx` — currently a placeholder (welcome text + a flat list of links to other pages, no real dashboard content). This story replaces its body with the real Budget/Period pickers and Category-state list; the existing links to other screens should be preserved or relocated (e.g. into a simple nav area) rather than deleted, since those destinations (Add Transaction, Invite, Account, Security, etc.) have no other entry point yet.
- **Mobile:** `apps/mobile/App.tsx` — a single 1576-line file with no navigation library and no screens directory. `"dashboard"` is already a member of the `Screen` string-union type and already has its own `if (screen === "dashboard")` render branch (currently a placeholder identical in spirit to web's). This story extends that branch in place — adding new `useState` hooks for the selected Budget/Period and the loaded picker/state data, following the same patterns already used elsewhere in the file (`loadAccountBudgets`, `loadTransactionList`) — and does not restructure the file or add a router.

### Grounding Check

- **Schema verified live** against `ohhsteward-dev` (`poqvothxwmjbtitqtbgh`): `budget(id, household_id, name, period_type, created_by, is_deleted, created_at, default_currency, surplus_destination_id)`; `budget_period(id, budget_id, period_start, period_end, created_at)`; `category(id, household_id, name, is_deleted, created_at)`; `category_limit(id, budget_period_id, category_id, limit_amount)`; `transaction(id, budget_id, account_id, description, amount, direction, date, time, store, currency, is_deleted, created_at)`; `transaction_split(id, transaction_id, category_id, amount, created_at)`; `budget_owner(id, budget_id, household_member_id)`.
- **RLS verified live:** `budget.budget_read_write` (ALL) = `is_household_parent(household_id) OR can_access_budget(id)`; `budget_period.budget_period_read` (SELECT) = `can_access_budget(budget_id)`; `category.category_read` (SELECT) = `is_household_member(household_id)`; `category_limit.category_limit_read` (SELECT) = `can_access_budget((select budget_id from budget_period where id = category_limit.budget_period_id))`; `transaction.budget_scoped_access` (SELECT) = `can_access_budget(budget_id)`; `transaction_split.budget_scoped_access` (SELECT) = `exists(select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id))`. All confirmed via `pg_policies`, not assumed from spec language.
- **`can_access_budget(p_budget_id)`'s live body:** `is_household_parent(household_id) OR exists(... budget_owner bo join household_member hm ... where bo.budget_id = p_budget_id and hm.auth_user_id = auth.uid() and not hm.is_deleted)` — confirms a Parent always passes via household-level check regardless of `budget_owner` rows; a Member passes only if explicitly listed in `budget_owner` for that Budget. This is exactly AC3's behavior, already fully enforced at the RLS layer — no client-side role branching is needed for the Budget picker.
- **Trust boundary:** the client-selected `budget_id` and `budget_period_id` (from the picker) are untrusted input from the client's perspective and are re-validated by RLS on every query against `budget_period`, `category_limit`, `transaction`/`transaction_split`, and by the view's `security_invoker = true` setting — never trusted merely because they came from a dropdown the server itself populated.
- **Soft-delete convention confirmed:** `apps/web/app/dashboard/transactions/page.tsx` filters `.eq("is_deleted", false)` on both its `transaction` and `category` reads; RLS never does this filtering itself. This governs both the new view (Revision Note item 1) and the Budget-picker query (Revision Note item 3).
- **No existing `v_category_period_state`** (or any view) currently exists in `public` — confirmed via `information_schema.views`. No prior DIP for this story exists under `documentation/dips/`.

### Acceptance Criteria

*(restated verbatim from the story)*

1. Given a user with access to one or more Budgets, when the dashboard loads, then a Budget picker and Period picker (with historical navigation) are shown.
2. Given a selected Budget/Period, when displayed, then all Categories show their current-period spending state, occupying the largest portion of screen space.
3. Given a Parent, when using the Budget picker, then all household Budgets are available for selection; given a Member, only their assigned Budget(s).
4. Given a Category with no historical data for the selected period, when displayed, then it shows a clear empty/zero state rather than an error.
5. **(Negative security AC)** Given a Member querying `v_category_period_state` for a `budget_period_id` belonging to a Budget they are not assigned to, when the query executes, then it returns zero rows — the view's `security_invoker` setting ensures the underlying `budget_period`/`transaction` RLS policies are evaluated as the querying Member, never bypassed.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:**
   - The pacing-ratio health-indicator calculation or any Green/Amber/Red coloring (Story 6.2).
   - A materialized view — the DVP explicitly deferred that optimization for v1; use the plain view in Code Requirements.
   - Any navigation library (React Navigation, Expo Router) or new screens directory on mobile — extend the existing `App.tsx` `Screen` state machine in place.
   - Any write/mutation path on `budget`, `budget_period`, or `category_limit` — this story is read-only.
   - Any change to `loadAccountBudgets()` or any other pre-existing function not touched by this story's own new code.
4. Apply the `v_category_period_state` view migration (Code Requirements below), with `security_invoker = true` explicitly set.
5. **Web** (`apps/web/app/dashboard/page.tsx`): replace the placeholder body with: a Budget picker (`select id, name from budget where not is_deleted order by name` — plain client SDK call, RLS-scoped automatically per the Grounding Check); a Period picker for the selected Budget (`select id, period_start, period_end from budget_period where budget_id = eq.<id> order by period_start desc`), defaulting to the first (most recent/open) row, with "Older"/"Newer" controls that move an index through the already-loaded, already-ordered array (no new query per navigation click) and are disabled at the array's bounds; and a Category-state list (`select * from v_category_period_state where budget_period_id = eq.<selected period id>`) rendered as the dominant element on the page. Preserve the existing links to other dashboard pages (Add Transaction, View Transactions, Invite, Account, Security, etc.) — relocate them into a compact nav area rather than deleting them, since this story does not build replacement entry points for them.
6. **Mobile** (`apps/mobile/App.tsx`): add `useState` hooks for the selected Budget id, the loaded Budget list, the loaded (ordered) Period list for the selected Budget, the selected Period index, and the loaded Category-state rows; add a `loadDashboardBudgets()`/`loadDashboardPeriods(budgetId)`/`loadCategoryStates(periodId)` set of functions mirroring the existing `loadAccountBudgets`/`loadTransactionList` patterns (plain awaited Supabase calls, `if (data) setX(data)`); extend the existing `if (screen === "dashboard")` block to render the Budget picker, Period picker (Older/Newer `Pressable`s over the loaded array, same index-based navigation as web), and the Category-state list as the dominant element, using the same `Button`/`Pressable`/`styles` conventions already used throughout the file. Do not add `guardIdleOrSignOut` calls to these new read-only load functions (Revision Note item 4 — matches existing convention exactly).
7. Render a clear empty/zero state (not an error) for a Category with `spent = 0` and no `category_limit` row for the selected period — the view's `coalesce`s already return `0` rather than `null` for both `limit_amount` and `spent`, so this is a simple equality/zero check in the UI, never a null-handling special case.

### Code Requirements

```sql
create view v_category_period_state
with (security_invoker = true) as
select
  bp.id as budget_period_id,
  bp.budget_id,
  c.id as category_id,
  c.name as category_name,
  coalesce(cl.limit_amount, 0) as limit_amount,
  coalesce(sum(ts.amount) filter (where t.direction = 'expense'), 0) as spent
from budget_period bp
join category c
  on c.household_id = (select household_id from budget where id = bp.budget_id)
 and not c.is_deleted
left join category_limit cl
  on cl.budget_period_id = bp.id and cl.category_id = c.id
left join transaction_split ts on ts.category_id = c.id
left join transaction t
  on t.id = ts.transaction_id
 and t.budget_id = bp.budget_id
 and t.date between bp.period_start and bp.period_end
 and not t.is_deleted
group by bp.id, bp.budget_id, c.id, c.name, cl.limit_amount;
```

All picker and Category-state queries are plain, fully-bound `select` statements against the client SDK — no dynamic SQL, no RPC, no mutation surface.

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

**Application to this story:** Obligation 6 (Authentication/authorization) is the central control here: `security_invoker = true` on `v_category_period_state` is what makes AC5 true — without it, a view defined by a privileged migration role would evaluate its underlying table reads as that privileged role, silently bypassing the RLS policies Stories 2.1/5.1 already established, for a purely cosmetic convenience. Obligation 1: every parameter in the picker/state queries (`budget_id`, `budget_period_id`) is bound via the Supabase client SDK's `eq()` filters, never string-interpolated. Obligation 2: the view's own `coalesce`/`not is_deleted` handling (Revision Note item 1) is edge-case input validation applied at the data layer, not merely a display nicety — it prevents a deleted row's stale figures from silently leaking into a "current" display. Obligation 7: the view is granted no elevated privilege of its own — it runs with the querying role's own privileges via `security_invoker`, the narrowest possible scope. Obligation 10: this story introduces no new server-side error paths beyond what the existing Supabase client error handling already covers (no new RPC), so no new disclosure surface is created.

### API Contract

Read-only Supabase client SDK calls only, no RPC or mutation surface:
- `select id, name from budget where not is_deleted order by name` (Budget picker).
- `select id, period_start, period_end from budget_period where budget_id = eq.<budget_id> order by period_start desc` (Period picker).
- `select * from v_category_period_state where budget_period_id = eq.<budget_period_id>` (Category-state list).

All three are RLS-scoped automatically (`can_access_budget`/`is_household_parent` on the underlying tables, `security_invoker` on the view) — no application-layer authorization check is added or needed.

### Non-Functional Requirements

*Performance:* Plain-view aggregation (not materialized) is acceptable for v1 per the DVP's explicit deferral decision; revisit as a materialized view only if dashboard load latency becomes a measured problem as retention history grows.

*Scalability:* Bounded by the confirmed low-volume household/Budget/Category counts (household caps default to 5 members / 5 Budgets per the ATD's Domain Invariant §3.9) — trivial aggregation volume at this scale.

*Reliability:* The view's `coalesce` handling means a Category with no limit and no spend for a period never produces a null-related rendering error; AC4's empty/zero state is a simple equality check against already-non-null data.

*Security:* ASVS chapters in scope: V4 (Access Control — `security_invoker` view semantics), V5 (Validation — bound parameters only). Trust boundary: the client-selected `budget_id`/`budget_period_id` from the picker is untrusted and is re-validated by RLS on every query, never merely filtered client-side by which options were shown in the picker. Sensitive data: household financial figures (spend, limits), protected by the same RLS boundary as every other Budget-scoped table — this story adds no new sensitive-data category. Weaknesses excluded: RLS-bypass-via-view (CWE-284-adjacent), specifically closed by `security_invoker = true`; stale/soft-deleted data leakage, closed by the explicit `is_deleted` filtering added in this revision.

### Observability

No dedicated server-side logging — this is a read-only view consumed directly by the client SDK with no Edge Function or RPC hop. No sensitive figures (spend amounts, category names) should be logged client-side beyond standard crash/error reporting already in place; a failed picker/state query should surface a generic "couldn't load your dashboard" message (matching the existing `handleCreateAccount`-style error convention — never the raw Supabase error text) rather than any SQL/error detail.

### Files to Create/Modify

- New migration: `supabase/migrations/<timestamp>_dashboard_category_period_state_view.sql` (the `v_category_period_state` view only — no table changes).
- Modify: `apps/web/app/dashboard/page.tsx` (replace placeholder body with the real dashboard).
- Modify: `apps/mobile/App.tsx` (extend the existing `"dashboard"` branch in place; add the new `useState` hooks and load functions near the file's existing similar functions, e.g. adjacent to `loadAccountBudgets`).

### Migration Files

```sql
-- supabase/migrations/<timestamp>_dashboard_category_period_state_view.sql

create view v_category_period_state
with (security_invoker = true) as
select
  bp.id as budget_period_id,
  bp.budget_id,
  c.id as category_id,
  c.name as category_name,
  coalesce(cl.limit_amount, 0) as limit_amount,
  coalesce(sum(ts.amount) filter (where t.direction = 'expense'), 0) as spent
from budget_period bp
join category c
  on c.household_id = (select household_id from budget where id = bp.budget_id)
 and not c.is_deleted
left join category_limit cl
  on cl.budget_period_id = bp.id and cl.category_id = c.id
left join transaction_split ts on ts.category_id = c.id
left join transaction t
  on t.id = ts.transaction_id
 and t.budget_id = bp.budget_id
 and t.date between bp.period_start and bp.period_end
 and not t.is_deleted
group by bp.id, bp.budget_id, c.id, c.name, cl.limit_amount;
```

Validate locally via the Supabase CLI (`supabase db reset` against the local stack) before proposing anything against the remote `ohhsteward-dev` project — applying to the remote project remains Joseph's manual step per the Migration Rule, never CC's.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-25

1. Apply the `v_category_period_state` view migration, explicitly setting `security_invoker = true`.
2. Verify locally (via the RLS-CI-01 suite or an ad hoc local check) that a Member test account querying the view for an unassigned Budget's period returns zero rows before opening the PR.
3. Create a feature branch off `dev`: `feature/6.1-dashboard-core-view`.
4. Commit, push, and open a PR against `dev`. Do not merge — Joseph tests locally and merges manually.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations (new view only); the web Dashboard page (`apps/web/app/dashboard/page.tsx`); the mobile `"dashboard"` branch inside `apps/mobile/App.tsx`'s existing state machine.

**Expected integration behavior:** both clients read from the same view and the same two picker queries, sharing layout intent (Budget picker → Period picker → dominant Category-state list) even though the platforms' component primitives differ (Next.js/React on web, React Native `Button`/`Pressable` on mobile, no shared component library between them today).

**Data flow impact:** introduces the shared aggregation view Story 6.2 (pacing) will also depend on — Story 6.2 must read from this exact view, never duplicate its aggregation logic.

**Dependencies to add/update:** none new on either platform.

**Constraints:** must not introduce a navigation library or restructure `apps/mobile/App.tsx` into multiple files/screens; must not alter or remove any of web dashboard's existing links to other pages, only relocate them; must not create a second, competing aggregation query for Category state anywhere in this story's own code.

### Change Impact

- What changes: New `v_category_period_state` view; Dashboard screen content on both platforms.
- What it touches: `budget`, `budget_period`, `category`, `category_limit`, `transaction`, `transaction_split` (all read-only).
- Breaking risk: No.

### Branch Name

feature/6.1-dashboard-core-view

### Commit Message

6.1: Add dashboard core view — Budget/Period pickers and Category-state list

### Pull Request Description

Implements Story 6.1's primary daily-use screen on both web and mobile: a Budget picker, a Period picker with older/newer historical navigation, and a Category-state list (spend vs. limit per Category) as the dominant element. Backed by one new read-only view, `v_category_period_state` (`security_invoker = true`), which both this story and the upcoming pacing story (6.2) will share — no duplicated aggregation logic. Maps to:
- AC1 → Budget picker + Period picker with older/newer navigation, both platforms.
- AC2 → Category-state list occupying the dominant portion of the screen.
- AC3 → No client-side role branching; RLS (`can_access_budget`/`is_household_parent`) already returns the correct Budget set per role.
- AC4 → The view's `coalesce`s guarantee a non-null zero state for a Category with no data.
- AC5 → `security_invoker = true` verified locally against a Member test account querying an unassigned Budget's period.

### Jira Linkage

- PDE Story ID: 6.1
- Jira Epic Key: STEW-6 (Epic 6: Dashboards)
- Jira Story Key: STEW-25

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-6.1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary.

### Confidence Assessment

- **Confidence Score:** 88/100
- **Reasoning:** Every schema/RLS/function claim was verified against the live post-5.2 schema, not assumed from the v1 draft — three material corrections were found and closed (soft-delete filtering the v1 draft's view omitted entirely; the real, and unusually monolithic, mobile file structure; the real Jira keys). The view itself is a straightforward read-only aggregation with no write path, and `security_invoker` is a one-line, well-understood control. The score is not higher because this is the first UI-layer story in Epic 6 — mobile's single-file architecture means CC has more room to make a stylistic misstep (e.g. accidentally duplicating state logic, or drifting from the file's existing conventions) than a typical isolated-component change would allow, and that risk is about implementation craftsmanship, not about anything ambiguous in the specification itself.
- **Top Risk Areas:**
  1. `apps/mobile/App.tsx`'s size and single-file structure make it easy for an implementation to technically satisfy the ACs while drifting from established conventions (e.g. adding a `guardIdleOrSignOut` call where the rest of the file's read paths don't, or a different error-handling shape) — worth a deliberate side-by-side comparison against `loadAccountBudgets`/`loadTransactionList` during review, not just a functional check.
  2. The Period picker's "historical navigation" is specified as index-based navigation over an already-loaded, already-ordered array (no new query per click) — if implemented instead as a new query per navigation step, it would still satisfy the ACs functionally but would diverge from this DIP's stated approach; not a correctness risk, but worth confirming during review since the DIP is explicit about it.
  3. Web's existing dashboard links (Add Transaction, Invite, etc.) currently have no other entry point in the app — if this story's implementation removes them outright while replacing the placeholder rather than relocating them, users lose access to those screens until a later story adds proper navigation.

### ⚠️ Open Questions to be Answered Before Moving Forward

None — the two genuine unknowns going into this story (soft-delete filtering conventions, mobile's actual file structure) were both resolved by direct inspection of the live schema and current source during grounding, not left as assumptions.

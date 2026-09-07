# Story 6.2 — Pacing-Ratio Health Indicator (Green/Amber/Red) with Multi-Currency Display Clarity

*DIP v2 — grounded against the live `ohhsteward-dev` schema and current `dev` branch source, and against a product-scope clarification from Joseph. Supersedes the speculative v1 draft embedded in `BACKLOG_DIP.md`.*

## Revision Note (v1 → v2)

1. **Elapsed-time calculation had a real bug for any already-closed period.** The v1 draft's ratio formula used `current_date - bp.period_start` as "time elapsed" unconditionally. For a period the user has already navigated *away* from via Story 6.1's Older/Newer picker (i.e. any past, fully-closed period), `current_date` can be well past `period_end` — so "elapsed" would read as more than 100% of the period's actual length, artificially shrinking the computed ratio and understating how a closed period actually performed (e.g. a period that finished 2x over budget could read as pacing "on track" purely because the denominator was inflated by however long ago it closed). Fixed by clamping elapsed time on both ends — `greatest(least(current_date, bp.period_end), bp.period_start) - bp.period_start` — so a closed period always computes at exactly 100% elapsed (ratio becomes simply `spent/limit`), and a period whose `period_start` is somehow still in the future (not reachable given Story 5.1's rollover model, but not structurally forbidden by the schema either) computes exactly 0% elapsed, correctly `null`-ing out to the 'pending' band via the existing `nullif` guard rather than ever producing a negative or nonsensical ratio.
2. **Product-scope clarification, resolved directly with Joseph before drafting this DIP's SQL (2026-09-07):** the v1 draft (and Story 2.4's own original AC2 in `BACKLOG.md`) assumed a single Budget could genuinely span multiple currencies across its Accounts, requiring this story to group Budget-level figures by currency and render them as separate, non-combined values. Joseph clarified the actual intent is narrower: **a Budget is always single-currency**; multi-currency support means a household can run *separate* Budgets in different currencies (e.g. a CAD Budget and a USD Budget), never one Budget mixing currencies across its own Accounts — and the app should never need foreign-exchange conversion logic anywhere. Nothing currently enforced that invariant (confirmed live: `account.currency` was validated only against the reference `currency` table, with no check against sibling accounts in the same Budget), so this is now enforced separately as **Story 2.4.G2** (STEW-42, its own DIP, `documentation/dips/DIP-2.4.G2.md`) — a DB-only trigger on `account`. **This DIP depends on 2.4.G2 merging first.** With that invariant real, this story's Budget-level query no longer needs the complex per-currency-grouping/stacked-cards-or-tabs UI the v1 draft described — a Budget-period's `spent`/`limit_amount` are guaranteed single-currency, so AC4/AC6 below are satisfied structurally rather than by branching UI logic. The query still derives and displays the currency label (never blending), and still groups by currency defensively, but in practice will only ever produce one row per Budget-period once 2.4.G2 is live.
3. **The v1 draft's Code Requirements never actually contained the Budget-level aggregation SQL** — Implementation Instruction 5 described it only in prose ("select account.currency, sum(spent)... group by account.currency"), and that literal approach has a real fan-out bug: joining `v_category_period_state` (one row per Category) directly to `account` (potentially several rows per Budget) before aggregating would multiply `spent`/`limit_amount` by the account count. This DIP's Code Requirements below use a two-step CTE (aggregate first, then derive the currency label via a scalar subquery) that avoids the fan-out entirely.
4. **Confirmed live:** no `fn_pacing_band` or `fn_pacing_ratio` function exists yet (fresh, no prior work); `v_category_period_state` exists exactly as merged by Story 6.1's PR #22, with the `is_deleted`-filtering correction from that story's own grounding intact.

No blocking questions remain — the one genuine open item (the multi-currency model itself) was resolved directly with Joseph, and it simplified this story rather than complicating it.

---

**Review Summary Strip:** Story ID: 6.2 | Objective: At-a-glance budget health signal | Core Change: `fn_pacing_band` + per-Category and per-Budget ratio queries + color-banded UI (web + mobile) | Risk Level: Medium | Confidence Score: 87 | Blocking Issues: None | ClaudeCode Ready: Yes (depends on 6.1/STEW-25 — merged; **and 2.4.G2/STEW-42 — must merge first**)

**User Story:** As any household member, I want a clear color signal for how my budget/category is pacing against the period, so that I immediately know if I'm on track without doing math myself.

**Acceptance Criteria:**
1. Given a Budget or Category's current period, when its pacing ratio (% of budget spent ÷ % of period elapsed) is ≤ 1.1, then it displays Green.
2. Given a pacing ratio between 1.1 and 1.3, then it displays Amber; given a ratio above 1.3, then it displays Red.
3. Given the ratio calculation, when applied, then it is computed both at the overall-Budget level and per-Category.
4. Given a Budget's figures (guaranteed single-currency per Story 2.4.G2), when the pacing indicator and any spend totals are displayed, then they carry a clear currency label derived from the Budget's own Accounts — never a client-supplied or hardcoded value, and never a blended multi-currency figure even if that invariant were ever violated.
5. Given a period with zero elapsed time (e.g., viewing the very first day) or an already-closed period, when the ratio is computed, then a zero-elapsed period displays a neutral/pending state (never a misleading color) and a closed period's elapsed time is clamped to exactly 100% of the period's length (never overstated by how long ago it closed).
6. **(Negative security/integrity AC)** Given the Budget-level pacing query, when executed, then it derives its currency label from `account` rows scoped to the Budget (via `can_access_budget`-governed, already-RLS-scoped data) and aggregates `spent`/`limit_amount` through a single grouping key per Budget-period — there is no code path in this query, correct or malicious client input aside, that sums two different currencies' amounts into one number.

**Dependencies & Assumptions:** Depends on Story 6.1 (STEW-25, merged — `v_category_period_state`) and **Story 2.4.G2 (STEW-42) — must be merged before this story is implemented**, since it's what makes AC4/AC6 true by construction rather than by complex UI branching. Also depends on Story 2.4 (STEW-17, merged — `currency` reference data). Exact visual treatment of the color bands (badge, background tint, icon) is a UI design detail left to implementation — the ACs mandate the thresholds and the currency-labeling/never-blend behavior, not a specific visual style.

**Traceability:** PIB Objective: "Pacing-ratio health indicator, Green ≤1.1, Amber 1.1–1.3, Red >1.3." PSDD Capability: Dashboard & Reporting; PSDD Risk Summary item 3 (multi-currency UX) — resolved by AC4/AC6, now grounded in the corrected single-currency-per-Budget model (Story 2.4.G2) rather than the originally-approved-but-superseded mixed-currency-Budget model.

**Change Impact:**
- What changes: `fn_pacing_band()` function; per-Category and per-Budget pacing/band queries; color-banded display added to Story 6.1's dashboard shell (web + mobile).
- What it touches: `v_category_period_state` (read-only, Story 6.1), `budget_period` (read-only), `account` (read-only, for the currency label).
- Breaking risk: No — purely additive; does not alter `v_category_period_state`'s definition.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement the pacing formula and banding exactly as specified (Green ≤1.1, Amber 1.1–1.3, Red >1.3), applied at both Budget and Category level, reading exclusively from Story 6.1's `v_category_period_state` view, with elapsed time clamped so an already-closed period never reads as pacing better than it actually did. Do NOT implement: any currency conversion or blended total (explicitly forbidden and, per Story 2.4.G2, no longer even a reachable case); any alternate banding thresholds; any "average"/"blended" pacing ratio; any change to `v_category_period_state`'s own definition or RLS/`security_invoker` behavior (Story 6.1's, must stay untouched); implementation before Story 2.4.G2 (STEW-42) has merged.

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (read-only calculation; no state change on repeat) | Reason: Formula and thresholds are fully specified; the one design element the v1 draft left genuinely open (the multi-currency model) was resolved with the Product Owner and now simplifies rather than complicates this story.

Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

This rule governs security policy, not secure implementation: the Secure Coding Baseline below always applies and is never out of scope. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

---

### Story Summary

Adds the pacing-ratio health indicator (percent-of-budget-spent ÷ percent-of-period-elapsed, with elapsed time clamped for closed periods) with fixed color bands (Green ≤1.1, Amber 1.1–1.3, Red >1.3), computed at both the Budget and Category level, reading exclusively from Story 6.1's `v_category_period_state` view. Now that Story 2.4.G2 makes "one Budget = one currency" a real, DB-enforced invariant, this story's currency-labeling requirement (AC4/AC6) is satisfied structurally — the Budget-level query still derives and displays the currency defensively, but never needs to branch its UI across multiple currency groups in practice.

### Repo Target

- **Web:** `apps/web/app/dashboard/page.tsx` — the real dashboard Story 6.1 shipped. This story adds color-banded figures alongside the existing Category-state table and a Budget-level summary line, without altering the Budget/Period picker logic.
- **Mobile:** `apps/mobile/App.tsx` — the `"dashboard"` branch Story 6.1 extended in place. This story adds the same color-banding to the existing Category-state list and Budget-level summary, following the same conventions Story 6.1 already established (no navigation library, no new files).

### Grounding Check

- **`v_category_period_state` confirmed live**, exactly as merged by Story 6.1's PR #22 (columns: `budget_period_id, budget_id, category_id, category_name, limit_amount, spent`; `security_invoker = true`; `is_deleted`-filtered on both `category` and `transaction`).
- **No `fn_pacing_band`/`fn_pacing_ratio` exists yet** — confirmed via `pg_proc`, fresh implementation.
- **`account.currency` has no cross-account consistency check today** — confirmed via `pg_constraint`/`pg_trigger` on `account`; this is exactly what Story 2.4.G2 (STEW-42) closes, and why this story depends on it merging first. I ran 2.4.G2's own pre-migration check against `ohhsteward-dev` during this grounding session: zero Budgets currently have accounts in more than one currency, so 2.4.G2 is safe to land ahead of this story with no data conflict.
- **`budget_period(period_start, period_end)` both `date` columns** (not `timestamptz`) — confirmed live; `extract(epoch from (date - date))` is valid Postgres (date arithmetic promotes to an interval), so the elapsed/total-length calculations in Code Requirements are valid against the actual column types, not assumed.
- **Trust boundary:** the client-selected `budget_period_id` is the only input into this story's queries, already validated by `v_category_period_state`'s own RLS/`security_invoker` boundary (Story 6.1) — this story adds computation over already-scoped data, not a new access surface.

### Acceptance Criteria

*(restated verbatim from the story)*

1. Given a Budget or Category's current period, when its pacing ratio (% of budget spent ÷ % of period elapsed) is ≤ 1.1, then it displays Green.
2. Given a pacing ratio between 1.1 and 1.3, then it displays Amber; given a ratio above 1.3, then it displays Red.
3. Given the ratio calculation, when applied, then it is computed both at the overall-Budget level and per-Category.
4. Given a Budget's figures (guaranteed single-currency per Story 2.4.G2), when the pacing indicator and any spend totals are displayed, then they carry a clear currency label derived from the Budget's own Accounts — never a client-supplied or hardcoded value, and never a blended multi-currency figure even if that invariant were ever violated.
5. Given a period with zero elapsed time or an already-closed period, when the ratio is computed, then a zero-elapsed period displays a neutral/pending state and a closed period's elapsed time is clamped to exactly 100% of the period's length.
6. **(Negative security/integrity AC)** Given the Budget-level pacing query, when executed, then it derives its currency label from `account` rows scoped to the Budget and aggregates `spent`/`limit_amount` through a single grouping key per Budget-period — no code path sums two different currencies' amounts into one number.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:**
   - Any currency conversion, exchange-rate, or blended/averaged total across currencies.
   - Alternate or configurable banding thresholds — 1.1/1.3 are fixed constants.
   - Any change to `v_category_period_state`'s definition, RLS, or `security_invoker` setting.
   - Anything before Story 2.4.G2 (STEW-42) has merged — this story's AC4/AC6 rely on that invariant being live.
4. Apply the `fn_pacing_band()` function migration (Code Requirements below).
5. Implement the per-Category pacing query (Code Requirements) and the Budget-level pacing query (Code Requirements) exactly as written — the Budget-level query uses a CTE to aggregate first and derive the currency label via a scalar subquery afterward, specifically to avoid a join-fan-out that would otherwise multiply `spent`/`limit_amount` by the Budget's account count.
6. **Web** (`apps/web/app/dashboard/page.tsx`): extend the existing Category-state table with a color-banded indicator per row (computed client-side from `spent`/`limit_amount`/`period_start`/`period_end` already being fetched, or via the per-Category query above — implementation's choice, as long as the formula/thresholds match exactly) and add a Budget-level summary line above the table showing the Budget-level ratio's band and currency label.
7. **Mobile** (`apps/mobile/App.tsx`): extend the existing Category-state list the same way, plus a Budget-level summary line, using the same `Text`/`View` styling conventions Story 6.1 already established. No `guardIdleOrSignOut` on these read-only additions (same convention as Story 6.1).
8. Render the 'pending' band (from `fn_pacing_band`, triggered by a `null` ratio) as a neutral state — not a color — for a period with zero elapsed time.

### Code Requirements

```sql
create function fn_pacing_band(p_ratio numeric) returns text
immutable language sql as $$
  select case
    when p_ratio is null then 'pending'
    when p_ratio <= 1.1 then 'green'
    when p_ratio <= 1.3 then 'amber'
    else 'red'
  end
$$;

-- Per-Category pacing (reads v_category_period_state from Story 6.1).
-- Elapsed time is clamped to the period's own end (least(current_date, period_end))
-- so an already-closed period always reads as exactly 100% elapsed.
select
  vps.category_id, vps.category_name, vps.spent, vps.limit_amount,
  fn_pacing_band(
    (vps.spent / nullif(vps.limit_amount, 0))
    / nullif(extract(epoch from (greatest(least(current_date, bp.period_end), bp.period_start) - bp.period_start)), 0)
    * nullif(extract(epoch from (bp.period_end - bp.period_start)), 0)
  ) as band
from v_category_period_state vps
join budget_period bp on bp.id = vps.budget_period_id
where vps.budget_period_id = $1;

-- Budget-level pacing: aggregate first (no join to account before the group-by,
-- which would fan out spent/limit_amount by account count), then derive the
-- currency label via a scalar subquery. With Story 2.4.G2 enforced, a Budget's
-- accounts always share one currency, so this always returns exactly one row.
with cat as (
  select
    vps.budget_id,
    bp.period_start,
    bp.period_end,
    sum(vps.spent) as total_spent,
    sum(vps.limit_amount) as total_limit
  from v_category_period_state vps
  join budget_period bp on bp.id = vps.budget_period_id
  where vps.budget_period_id = $1
  group by vps.budget_id, bp.period_start, bp.period_end
)
select
  cat.total_spent,
  cat.total_limit,
  (
    select a.currency from account a
    where a.budget_id = cat.budget_id and not a.is_deleted
    order by a.created_at
    limit 1
  ) as currency,
  fn_pacing_band(
    (cat.total_spent / nullif(cat.total_limit, 0))
    / nullif(extract(epoch from (greatest(least(current_date, cat.period_end), cat.period_start) - cat.period_start)), 0)
    * nullif(extract(epoch from (cat.period_end - cat.period_start)), 0)
  ) as band
from cat;
```

All ratio inputs come from the already-RLS-scoped `v_category_period_state` view and bound parameters (`$1` = `budget_period_id`) — no client-supplied value is ever interpolated into these queries.

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

**Application to this story:** Obligation 2 (Input validation at trust boundaries): the `nullif`-guarded divisions (zero `limit_amount`, zero elapsed time) turn what would otherwise be a raw Postgres division-by-zero error into a well-defined `null` → `'pending'` band — edge-case input validation applied to a computed value, not just raw client input. Obligation 10 (Error handling): if the ratio computation ever produces an unexpected error, the client must render a neutral/pending state, never a raw Postgres error. Obligation 6 (Authorization): the Budget-level query's currency label is derived server-side from `account` rows (already RLS-scoped via Story 2.1/2.2's `budget_scoped_access` policy), never accepted as a client-supplied parameter — a client cannot influence which currency label is shown by passing one in.

### API Contract

Read-only queries against `v_category_period_state`, `budget_period`, and `account`, plus the currency-grouped Budget-level aggregation — all consumed via the Supabase client SDK, no RPC or mutation surface. `fn_pacing_band(numeric)` is called inline within these `select` statements.

### Non-Functional Requirements

*Performance:* Both queries reuse Story 6.1's already-indexed view; the Budget-level query's CTE aggregates once per dashboard load, no additional full-table scan.

*Scalability:* Bounded by Category count per Budget-period, trivial at this scale.

*Reliability:* `nullif`-guarded division removes the zero-division failure mode entirely at the query layer; the `least(current_date, period_end)` clamp removes the "closed period reads better than it actually performed" failure mode identified in this revision.

*Security:* ASVS chapters in scope: V5 (Validation — safe handling of degenerate/edge-case inputs: a zero-length period, a closed period, a zero limit). Trust boundary: none beyond Story 6.1's already-established RLS boundary — this story adds computation over already-scoped data, not a new data-access surface. Sensitive data: none beyond the existing financial figures already governed by RLS. Weaknesses excluded: unhandled division-by-zero (explicitly guarded); cross-currency blending (structurally prevented by Story 2.4.G2, defensively non-fan-out at the query level regardless).

### Observability

No dedicated logging; correctness verified via the DVP's Story 6.2 test cases, including the closed-period elapsed-time-clamp regression and the Budget-level query's fan-out-safety.

### Files to Create/Modify

- New migration: `supabase/migrations/<timestamp>_pacing_ratio_health_indicator.sql` (`fn_pacing_band()` only).
- Modify: `apps/web/app/dashboard/page.tsx` (add color-banded indicators + Budget-level summary line).
- Modify: `apps/mobile/App.tsx` (same, in the existing `"dashboard"` branch).

### Migration Files

```sql
-- supabase/migrations/<timestamp>_pacing_ratio_health_indicator.sql

create function fn_pacing_band(p_ratio numeric) returns text
immutable language sql as $$
  select case
    when p_ratio is null then 'pending'
    when p_ratio <= 1.1 then 'green'
    when p_ratio <= 1.3 then 'amber'
    else 'red'
  end
$$;
```

Validate locally via the Supabase CLI (`supabase db reset`) before proposing anything against the remote `ohhsteward-dev` project — applying to the remote project remains Joseph's manual step per the Migration Rule, never CC's. This migration must be applied after Story 2.4.G2's.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-26

1. Confirm Story 2.4.G2 (STEW-42) is merged to `dev` first.
2. Apply the `fn_pacing_band()` migration.
3. Verify locally that a closed (past) period's Category/Budget-level ratio reflects `spent/limit` directly (elapsed clamped to 100%), and that the Budget-level query returns exactly one row per Budget-period.
4. Create a feature branch off `dev`: `feature/6.2-pacing-ratio-health-indicator`.
5. Commit, push, and open a PR against `dev`. Do not merge — Joseph tests locally and merges manually.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations (`fn_pacing_band` only); Story 6.1's Dashboard page/screen on both platforms (color-banding added to the existing Category-state list and a new Budget-level summary line).

**Expected integration behavior:** pacing calculation reads exclusively from Story 6.1's `v_category_period_state` view plus `budget_period`/`account` — no parallel aggregation query is introduced, and `v_category_period_state`'s own definition is never altered.

**Data flow impact:** none beyond read access to existing tables/views.

**Dependencies to add/update:** none new. Sequencing dependency: Story 2.4.G2 (STEW-42) must merge first.

**Constraints:** must not alter Story 6.1's `v_category_period_state` view definition in any way; must not introduce a fan-out join in the Budget-level query (use the CTE-plus-scalar-subquery shape in Code Requirements, not a direct join from the view to `account`).

### Change Impact

- What changes: `fn_pacing_band()`; per-Category and per-Budget pacing queries; color-banded display on Story 6.1's dashboard (web + mobile).
- What it touches: `v_category_period_state` (read-only), `budget_period` (read-only), `account` (read-only, currency label only).
- Breaking risk: No.

### Branch Name

feature/6.2-pacing-ratio-health-indicator

### Commit Message

6.2: Add pacing-ratio health indicator (Green/Amber/Red) with per-currency labeling

### Pull Request Description

Implements Story 6.2's pacing-ratio health indicator on both web and mobile: `fn_pacing_band()` plus per-Category and per-Budget ratio queries, reading exclusively from Story 6.1's `v_category_period_state`. Fixes a real elapsed-time bug the v1 draft had (an already-closed period's ratio was understated because elapsed time wasn't clamped to the period's own end) and avoids a join-fan-out bug in the Budget-level query the v1 draft's prose description would have produced. AC4/AC6's currency-labeling requirement is now satisfied structurally, since Story 2.4.G2 (STEW-42, merged first) makes a Budget's accounts always single-currency at the database layer — this story's Budget-level query still derives the currency defensively rather than trusting a client value, and structurally cannot blend currencies even if that invariant were somehow violated. Maps to:
- AC1/AC2 → `fn_pacing_band()`'s fixed thresholds.
- AC3 → both the per-Category and per-Budget queries.
- AC4/AC6 → currency derived server-side from `account`, single grouping key, non-fan-out CTE shape.
- AC5 → `nullif`-guarded zero-elapsed handling plus the `least(current_date, period_end)` clamp for closed periods.

### Jira Linkage

- PDE Story ID: 6.2
- Jira Epic Key: STEW-6 (Epic 6: Dashboards)
- Jira Story Key: STEW-26

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-6.2.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary.

### Confidence Assessment

- **Confidence Score:** 87/100
- **Reasoning:** Every schema/RLS claim was verified live, not assumed from the v1 draft — two material corrections were found and closed (the elapsed-time clamp bug, and the join-fan-out the v1 draft's prose would have produced), plus one genuine product-scope clarification resolved directly with Joseph that simplified rather than complicated the story. The score isn't higher because this story now has a hard sequencing dependency on Story 2.4.G2 (STEW-42) actually merging first — if implementation started before that lands, AC4/AC6 would need the more complex per-currency UI branching the v1 draft originally sketched, which this DIP deliberately does not build.
- **Top Risk Areas:**
  1. Sequencing: if CC (or a future session) implements this DIP before Story 2.4.G2 has merged, AC4/AC6 are not actually guaranteed — worth an explicit check before handing this DIP off.
  2. The Budget-level query's CTE-plus-scalar-subquery shape is deliberately more complex than the v1 draft's naive join description specifically to avoid fan-out — worth a direct comparison against a manually-computed expected total during review, not just a "does it return a row" check.
  3. Elapsed-time clamping is now correct for both a closed period and a not-yet-started one (`greatest`/`least` bound both ends), but this is still worth a quick local check with a manually-backdated and manually-future-dated `budget_period` row during review, since it's the kind of edge case that's easy to get subtly wrong and easy to under-test.

### ⚠️ Open Questions to be Answered Before Moving Forward

None — the one genuine open question (the multi-currency model) was resolved directly with Joseph and is now Story 2.4.G2, not an open item within this DIP.

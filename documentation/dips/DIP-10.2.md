# Story 10.2 — Web Reskin: Dashboard & Accounts

**Review Summary Strip:** Story ID: 10.2 | Objective: Apply the Story 10.1 design system to the web Dashboard and Accounts summary/detail screens, matching the approved mockup | Core Change: Restyle `apps/web/app/dashboard/page.tsx` and `apps/web/app/dashboard/accounts/[id]/page.tsx` using the Story 10.1 tokens/primitives — no new data, no new RPC, no schema change | Risk Level: Low | Confidence Score: 84 | Blocking Issues: None (see hard pre-condition below) | ClaudeCode Ready: Yes — **but only once PR #26 (Story 10.1, STEW-44) is merged to `dev`.** This DIP is grounded against PR #26's verified content (independently confirmed via `git diff` before this DIP was written); do not branch or hand this DIP to CC until that merge has actually happened, since this story imports `apps/web/components/ui/*` and `apps/web/app/globals.css` tokens that only exist on `dev` once PR #26 lands.

**User Story:** As any household member using the web app, I want the Dashboard and my Accounts to look and feel like the rest of a real, commercial-grade budgeting product — not a plain HTML table — so that I actually want to use it, using the warm/friendly, blue-primary design system Joseph approved.

**Acceptance Criteria:**
1. Given the Dashboard page (`apps/web/app/dashboard/page.tsx`), when it renders, then the Budget/Period picker, the pacing summary, the Accounts panel, and the Categories panel are all built from the Story 10.1 tokens and primitives (`Card`, `Button`, `Chip`, `ProgressBar`, `IconBadge`) — no raw hex colors, no unstyled `<table>`, no inline ad hoc styling that duplicates a token value instead of referencing it.
2. Given the same page's existing data-fetching and calculation logic (`pacingRatio`, `pacingBand`, the four `useEffect` queries, `budgetSummary`, `money()`), then none of it changes — this story is presentation-only. The only additive data change permitted is extending the existing `account` query's `select(...)` to also fetch `target_amount` (needed to render a Savings Goal's progress toward its target, per AC3) — no new query, no new RPC, no new table.
3. Given an account of type `savings_goal`, when displayed in the Accounts panel, then it shows a `ProgressBar` for `current_balance` against `target_amount` (clamped 0–100%), matching the approved mockup's Emergency Fund card. Accounts of every other type display balance only, exactly as today.
4. Given every navigation destination currently reachable from the Dashboard's `NAV_LINKS` array (New budget, New account, Add transaction, Transactions, Invite, Account, Security), then all seven remain reachable from the reskinned page — restyled to match the design system, never removed or hidden behind a change that makes them unreachable.
5. Given the Account detail page (`apps/web/app/dashboard/accounts/[id]/page.tsx`), when it renders, then its balance display, edit form (including the `savings_goal`/`credit_card` type-conditional fields), and recent-transactions list are restyled with the same tokens/primitives, with the `rpc_update_account` call, its parameters, and its generic-error-message behavior (Secure Coding obligation 10) completely unchanged.
6. **(Negative security AC)** Given a category name, account name, transaction description, or store value containing HTML/script metacharacters (e.g. `<img src=x onerror=alert(1)>`), when rendered anywhere in the reskinned Dashboard or Account detail page, then it displays as literal text and does not execute as markup — enforced by React's default JSX text-node escaping; this story introduces no `dangerouslySetInnerHTML` anywhere.

**Dependencies & Assumptions:** Depends on Story 10.1 (STEW-44, PR #26) — hard pre-condition, see Review Summary Strip above; this DIP was grounded against PR #26's actual verified file contents (`Button`, `Card`, `Chip`, `ProgressBar`, `IconBadge` prop shapes below), not the DIP-10.1 spec language, per this pipeline's "verify against actual current source" rule. Also depends on Stories 6.1/6.2 (STEW-25/26, PR #22/#24) and 6.3 (STEW-27, PR #25) for the screens being reskinned — all three merged and live.

**Category icon/color mapping — grounding finding, decided here rather than left ambiguous:** `category` (verified live via direct schema query against `ohhsteward-dev`, 2026-09-08) has only `id, household_id, name, is_deleted, created_at` — no `icon` or `color` column, and Category names are arbitrary Parent-entered text (Story 2.3), not a fixed enum. The approved mockup's five category icons (Groceries/cart, Dining/utensils, Transportation/car, Entertainment/screen, Utilities/bolt) cannot be a real data-driven mapping without a schema change that is out of scope for a presentation-only story. This story instead implements a small **client-side, name-keyed lookup** (case-insensitive exact match against `"groceries"`, `"dining out"`, `"dining"`, `"transportation"`, `"entertainment"`, `"utilities"`) reproducing the mockup's five icon+color pairs for those exact names (which are Joseph's own real category names in `ohhsteward-dev` today), with a **generic fallback** (a single neutral "tag" glyph, `IconBadge` background `var(--color-primary-tint)`, foreground `var(--color-primary-dark)`) for any category name outside that list — so any household with different category names still gets a fully-styled, non-broken badge, just without a bespoke icon. This is presentation-only, reversible, and touches no table — if Joseph later wants Parents to actually choose a per-category icon/color, that's new scope (a `category.icon`/`category.color` column plus Category-management UI) and should be its own future gap story, not something this DIP invents unasked. `account.type`, by contrast, **is** a real, fixed schema enum (`account | savings | savings_goal | credit_card`) — so the account-icon mapping below is a direct, unambiguous switch on that column, not a name-keyed guess.

**Verified live this session (component contracts — from PR #26's actual merged file contents, not re-derived):**
- `Button` (`apps/web/components/ui/Button.tsx`): `{ variant?: 'primary' | 'secondary'; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>`. Hover/press handled internally; pass `disabled`, `onClick`, etc. through normally.
- `Card` (`apps/web/components/ui/Card.tsx`): `{ children: ReactNode } & HTMLAttributes<HTMLDivElement>`. Renders a `<div>` with token background/border/radius/shadow/padding (`1.25rem`); pass `style` to override/extend, never to replace the token values wholesale.
- `Chip` (`apps/web/components/ui/Chip.tsx`): `{ selected?: boolean; children: ReactNode } & HTMLAttributes<HTMLButtonElement>`. Renders `<button type="button">` — use for the Budget/Period picker pills and the restyled secondary nav links.
- `ProgressBar` (`apps/web/components/ui/ProgressBar.tsx`): `{ value: number; color?: string; style?: CSSProperties }`, `value` is 0–100 and internally clamped, `color` defaults to `var(--color-green)`. Use `color` to pass the pacing band's token color or the Savings Goal's gold token — never a new hardcoded hex.
- `IconBadge` (`apps/web/components/ui/IconBadge.tsx`): `{ background: string; children: ReactNode; size?: number; style?: CSSProperties }`. `background` takes a CSS color/token string; `children` is an already-rendered icon element (an inline SVG this story supplies, per 10.1's Do-NOT list — `IconBadge` does not own an icon library).

**Traceability:** PIB Problem Statement (commercial quality bar). New Epic 10 (STEW-43), Story 10.1 (STEW-44) foundation. Reskins Stories 6.1/6.2 (STEW-25/26) and 6.3 (STEW-27)'s existing screens — no new PSDD capability, this is presentation-layer only.

**Change Impact:**
- What changes: Full visual restyle of two existing web pages using Story 10.1's tokens/primitives; one additive `select()` column (`target_amount`) on an existing query; new inline SVG icons for categories/accounts; nav links restyled but not removed.
- What it touches: `apps/web/app/dashboard/page.tsx`, `apps/web/app/dashboard/accounts/[id]/page.tsx` only. No other route, no schema, no RPC, no RLS policy.
- Breaking risk: No — all existing queries, mutations, and business-logic functions (`pacingRatio`, `pacingBand`, `rpc_update_account`) are preserved verbatim; only their rendering changes.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Restyle exactly the two files named above using the Story 10.1 primitives and tokens, matching the approved mockup's Dashboard (hero pacing card, Categories panel, Accounts panel) as closely as the real data model allows, per the category-icon grounding finding above. Do NOT implement: any change to `pacingRatio`, `pacingBand`, the band thresholds, or any Supabase query's filter/scope logic; any new RPC or Edge Function; any change to `rpc_update_account`'s call signature; a `category.icon`/`category.color` schema column or any Category-management UI for choosing one; removal of any of the seven `NAV_LINKS` destinations; any change to `/dashboard/accounts/new/page.tsx`, `/dashboard/account/page.tsx` (singular — self-deletion), `/dashboard/security/page.tsx`, `/dashboard/invites/new/page.tsx`, `/dashboard/budgets/new/page.tsx`, `/dashboard/transactions*`, or `apps/web/app/page.tsx` — all explicitly out of scope (transactions/forms are Story 10.3's scope, per the Backlog roadmap note).

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (pure rendering change plus one additive `select()` column; no writes, no new side effects) | Reason: Presentation-only restyle of two already-shipped, already-tested screens; the one data change is a strict superset of an existing read query against a column already covered by existing RLS.

Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

Standing Rule scope clarification: This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline (§6): writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

**Do NOT implement (explicit list, this DIP's own — CC reads only this document):**
- Do NOT change `pacingRatio()`, `pacingBand()`, the 1.1/1.3 thresholds, or any Supabase `.eq()`/`.gte()`/`.lte()` filter on any existing query.
- Do NOT add any new Supabase query, RPC call, or Edge Function invocation. The one permitted data change is adding `target_amount` to the existing account `select(...)` string on the Dashboard page.
- Do NOT change `rpc_update_account`'s parameters, its call site's argument shape, or its error-handling/generic-message behavior on the Account detail page.
- Do NOT add a `category.icon` or `category.color` column, migration, or any Category-management UI for setting one.
- Do NOT remove, hide-without-a-reachable-path, or rename any of the seven `NAV_LINKS` destinations.
- Do NOT touch `/dashboard/accounts/new/page.tsx`, `/dashboard/account/page.tsx`, `/dashboard/security/page.tsx`, `/dashboard/invites/new/page.tsx`, `/dashboard/budgets/new/page.tsx`, `/dashboard/transactions/page.tsx`, `/dashboard/transactions/new/page.tsx`, or `apps/web/app/page.tsx` — none are in this story's two named files.
- Do NOT introduce `dangerouslySetInnerHTML` anywhere, for any reason.
- Do NOT add any new npm dependency (icon library, animation library, etc.) — all icons in this story are hand-written inline SVG, matching the pattern already established in the approved mockup and in Story 10.1's primitives.

**Implementation Instructions:**
1. **Pre-condition check (do this first):** Confirm `apps/web/components/ui/{Button,Card,Chip,ProgressBar,IconBadge}.tsx` and the token block in `apps/web/app/globals.css` actually exist on `dev` before branching. If they don't, PR #26 has not merged yet — stop and tell Joseph, do not proceed on an improvised/duplicated copy of the primitives.
2. **Dashboard — top bar:** Replace the plain `NAV_LINKS` `<Link>` row's visual treatment. Keep the Budget `<select>` and period Older/Newer buttons functionally identical, but present the Budget picker as a `Chip`-styled dropdown affordance and the Period picker as a pill-style control with the existing Older/Newer semantics (index-based, no new query), per the mockup's top bar. Restyle the seven `NAV_LINKS` as a compact secondary row of small `Chip` or `Button(variant="secondary")` elements below or beside the header — every link keeps its existing `href` and destination, only its visual presentation changes.
3. **Dashboard — hero pacing card:** Wrap the existing `budgetSummary`-driven summary in a `Card`. Add a circular SVG progress ring (matching the mockup's 96×96 ring: a static grey background circle, `stroke="var(--color-border)"`, plus a foreground circle using `stroke-dasharray`/`stroke-dashoffset` on the circle's circumference, colored via the token matching `budgetSummary.band` — green/amber/red from `--color-green`/`--color-amber`/`--color-red`, or the muted-text token for `pending`) showing `Math.round(budgetSummary.totalSpent / budgetSummary.totalLimit * 100)` (clamped 0–100; guard `totalLimit === 0` to avoid `NaN`, rendering a pending/neutral state instead) — this is a pure display transform of the already-computed `budgetSummary` values, no new calculation logic. Keep the existing spent/limit text and the band label; add an "Add Transaction" `Button(variant="primary")` in the card linking to `/dashboard/transactions/new`, matching the mockup's CTA (this reuses the existing nav destination already in `NAV_LINKS`, not a new route).
4. **Dashboard — Categories panel:** Wrap in a `Card`. Replace the `<table>` with a vertical list of rows, each showing: an `IconBadge` (background/icon per the category name-keyed lookup + generic fallback described in Dependencies & Assumptions above), the category name, the existing `money(state.spent)` / `money(state.limit_amount)` text (preserve the existing "—" and "No limit" special-case text exactly), and a `ProgressBar` whose `value` is `state.limit_amount > 0 ? Math.min(100, state.spent / state.limit_amount * 100) : 0` and whose `color` is the token matching that row's already-computed `band` (reuse the existing inline `pacingBand(pacingRatio(...))` call unchanged — only its rendering changes from `BandBadge` text to `ProgressBar` color).
5. **Dashboard — Accounts panel:** Wrap in a `Card` per account (or one `Card` containing a stack of rows — match the mockup's stacked-card layout). Extend the account `select(...)` to `"id, type, name, currency, current_balance, balance_owed, target_amount"`. For each account: `IconBadge` colored/iconed by `account.type` (`account` → `var(--color-primary-tint)` bg / `var(--color-primary-dark)` icon, matching "Checking"; `credit_card` → coral tint/icon, matching "Visa Rewards"; `savings` and `savings_goal` → gold tint/icon, matching "Emergency Fund"), the account name, the existing balance value (preserve the `credit_card` → `balance_owed` vs. other types → `current_balance` branch exactly, and preserve the currency-code display — prefix `"$"` only when `currency === "USD"`, otherwise show the plain number followed by the currency code, e.g. `"1,850.00 CAD"`, to stay correct for every currency while matching the mockup's `"$"` treatment for Joseph's own USD data). For `type === "savings_goal"` only, add a `ProgressBar` (`value = target_amount ? Math.min(100, current_balance / target_amount * 100) : 0`, `color="var(--color-gold)"` — note: `--color-gold` is a category/brand accent, not one of the reserved green/amber/red pacing tokens, so this use is allowed) plus a small muted-text line showing `"{money(current_balance)} of {money(target_amount)}"`, matching the mockup's Emergency Fund card. Preserve the existing per-account `+`/`−` period totals (`acctTotals`) — render them as a small two-color muted line under the balance (green-token `+` value, red-token `−` value) rather than a separate table column, since the panel is now card-based, not tabular.
6. **Account detail page reskin:** Wrap the page content in a `Card`. Restyle the balance display, the edit `<form>`'s labeled inputs (keep every existing `<label htmlFor>`/`<input id>` pairing and its `required`/`type`/`step` attributes exactly, including the `savings_goal`/`credit_card` conditional field blocks), the "Saved."/error messaging, and the Save button (`Button(variant="primary")`, `disabled={submitting}`, label text unchanged) using tokens. Restyle the "Recent transactions" list as a stack of compact rows inside a `Card` (or nested `Card`s), preserving the existing description/amount/direction-sign/date/store rendering exactly — no new fields, no new query.
7. Write every new icon as inline SVG (`stroke="currentColor"` or an explicit token-referencing color, `fill="none"`, matching the stroke-based style already established in the approved mockup and in Story 10.1's own token comments) — do not add an icon-library dependency.
8. Run `tsc --noEmit` and `next build` on `apps/web` and confirm both are clean (aside from any pre-existing, unrelated failure already present on `dev` — note any such failure explicitly in the completion report rather than silently working around it).

**Code Requirements**

**Secure Coding Requirements (verbatim — twelve baseline obligations):**
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

**Application to this story:** Obligations 1, 2, 4–9, 11, and 12 do not apply directly — no SQL is written by this story, no new trust boundary is opened, no secret or credential is touched, no logging changes, no cryptography, no deserialization, no new dependency, no concurrent/shared-state write. Obligation 3 (output encoding) is the one obligation that genuinely bites: category names, account names, transaction descriptions, and store values are all end-user-supplied text rendered into this story's restyled JSX — React's default text-node escaping is what satisfies this, and AC6 above is the explicit, checkable negative-security criterion for it (no `dangerouslySetInnerHTML` introduced anywhere in this story). Obligation 10 (error handling) is preserved, not newly satisfied — the existing generic "We couldn't save those changes" / "We couldn't load that account" messages on the Account detail page are restyled visually but their text and the fact that they never surface `rpcError`'s raw content must remain unchanged.

**API Contract**

Not applicable — no new API route, RPC, or Edge Function is introduced or modified by this story. The existing `rpc_update_account` call on the Account detail page keeps its exact current signature (`p_account_id`, `p_name`, `p_target_amount`, `p_target_date`, `p_credit_limit`, `p_due_date`, `p_minimum_payment`); the only query-shape change anywhere in this story is appending `target_amount` to the Dashboard's existing account `select(...)` string, which is a read against a column already covered by the same RLS policy as every other selected column on that table.

**Non-Functional Requirements**

**Performance:** No new network round-trip is introduced — the one query-shape change (adding `target_amount` to an existing `select()`) is free (same round-trip, one more scalar column). Rendering additional SVG icon-badges and progress bars per row is negligible client-side cost at the row counts this app operates at (a household's Categories/Accounts, not a large dataset).

**Scalability:** Unaffected — this story changes rendering only, not query shape in any way that scales differently (the `target_amount` column addition is O(1) per already-fetched row, not a new query pattern).

**Reliability:** Because this story changes no query filter, no RPC signature, and no business-logic function, it cannot regress any already-shipped, already-tested calculation (pacing bands, account balances, RLS scoping). The only new runtime behavior is the `totalLimit === 0` guard on the hero ring's percentage calculation (Implementation Instruction 3) — explicitly specified to avoid a `NaN`/divide-by-zero rendering bug that doesn't exist in the current plain-text rendering.

**Security:** ASVS chapters in scope: V5 (Validation, Sanitization and Encoding) for the output-encoding point above — no other chapter is newly touched. Trust boundary: user-supplied display strings (category/account names, transaction description/store) rendered into this story's new JSX structure — already-existing data, now rendered through new markup, so the boundary itself isn't new but the rendering surface is; AC6 covers it explicitly. Sensitive data: none newly handled — this story never touches auth, payment, or credential data. Weaknesses excluded: CWE-79 (XSS) via React's default escaping and the explicit no-`dangerouslySetInnerHTML` constraint above.

**Observability**

No new logging, monitoring, or alerting is introduced by this story — it is a client-side rendering change with no new server-side code path. If `next build`/`tsc --noEmit` surface any pre-existing warning in either touched file, note it in the completion report rather than silently suppressing it.

**Files to Create/Modify**

- Modify: `apps/web/app/dashboard/page.tsx`
- Modify: `apps/web/app/dashboard/accounts/[id]/page.tsx`
- No new files are required — all needed primitives (`Button`, `Card`, `Chip`, `ProgressBar`, `IconBadge`) already exist at `apps/web/components/ui/*` from Story 10.1 (PR #26).

**Migration Files (if applicable)**

Not applicable — no schema change of any kind.

**Deployment Instructions**

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-45 (Epic STEW-43)

Do not branch until PR #26 (STEW-44) is confirmed merged to `dev` (Implementation Instruction 1). Once confirmed, create `feature/10.2-web-reskin-dashboard-accounts` off `dev`, implement per the instructions above, validate locally (`tsc --noEmit`, `next build`), commit, push, and open a PR against `dev`. Do not merge — Joseph tests on the resulting Vercel Preview deploy and merges manually.

**Repository Integration Instructions**

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

Both touched files are Next.js App Router client components (`"use client"`) under `apps/web/app/dashboard/`. They import the five UI primitives from `apps/web/components/ui/*` (relative import, same as any other component in `apps/web`) and reference design tokens via CSS custom properties already present in `apps/web/app/globals.css` post-PR-#26 — no new import path, no new provider/context, no new client-side routing. Data flow is unchanged: both pages still read directly from the Supabase client (`createClient()`) with the same table/view names (`budget`, `budget_period`, `account`, `v_category_period_state`, `transaction`) and the same RLS-scoped queries; the only query-shape change is the one additive `select()` column named above. No dependency is added or updated. Constraint: neither file may import from, or otherwise couple to, any route this DIP marks out of scope (Implementation Intent's Do NOT list) — each screen's restyle is self-contained to its own file.

**Change Impact**

- What changes: Full visual restyle of the Dashboard and Account-detail web pages using Story 10.1's design system; one additive read column.
- What it touches: `apps/web/app/dashboard/page.tsx`, `apps/web/app/dashboard/accounts/[id]/page.tsx`.
- Breaking risk: No.

**Branch Name**

feature/10.2-web-reskin-dashboard-accounts

**Commit Message**

10.2: Reskin web Dashboard and Account detail with the Story 10.1 design system

**Pull Request Description**

Implements Story 10.2 (STEW-45): applies the Story 10.1 design-system tokens and primitives (`Card`, `Button`, `Chip`, `ProgressBar`, `IconBadge`) to the web Dashboard (`apps/web/app/dashboard/page.tsx`) and Account detail (`apps/web/app/dashboard/accounts/[id]/page.tsx`) pages, matching Joseph's approved mockup — AC1–AC6. No calculation logic, query filter, or RPC signature changes; the only data-shape change is one additive `target_amount` column on the Dashboard's existing account query, needed to render a Savings Goal's progress bar (AC3). All seven existing Dashboard nav destinations remain reachable (AC4), just restyled. Category icon/color is a client-side, name-keyed lookup with a generic fallback (see this DIP's grounding note) since `category` has no `icon`/`color` column and category names are arbitrary Parent-entered text — Account icon/color, by contrast, switches directly on the real `account.type` enum.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

**Jira Linkage**

- PDE Story ID: 10.2
- Jira Epic Key: STEW-43
- Jira Story Key: STEW-45

**Stop Point**

Save this DIP verbatim to `documentation/dips/DIP-10.2.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests on Vercel Preview and merges manually.

Include full diffs for every file created or modified in the completion report — not a summary. For every file this DIP's Do NOT list requires stay untouched (`apps/web/app/dashboard/accounts/new/page.tsx`, `apps/web/app/dashboard/account/page.tsx`, `apps/web/app/dashboard/security/page.tsx`, `apps/web/app/dashboard/invites/new/page.tsx`, `apps/web/app/dashboard/budgets/new/page.tsx`, `apps/web/app/dashboard/transactions/page.tsx`, `apps/web/app/dashboard/transactions/new/page.tsx`, `apps/web/app/page.tsx`), include `git diff dev [branch] -- [file]` showing zero output as explicit proof, per this pipeline's standing rule for scope-boundary evidence.

**Confidence Assessment**

- **Confidence Score:** 84/100
- **Reasoning:** The two touched files were read in full this session (not assumed from any spec), so every existing state variable, query, and business-logic function this DIP must preserve is named exactly rather than approximately. The category-icon ambiguity (arbitrary Parent-entered names vs. the mockup's five bespoke icons) was a real grounding gap this DIP resolves explicitly with a documented, reversible, no-schema-change decision rather than leaving it to CC's judgment. The score isn't higher for two reasons: this is a genuinely broader restyle than Story 10.1 (real layout decisions — card structure, information density on the Accounts panel — aren't as mechanically specifiable as token substitution was), and it carries a hard external pre-condition (PR #26 must actually be merged first) that this DIP cannot itself satisfy or verify at hand-off time.
- **Top Risk Areas:**
  1. If PR #26 is handed to CC before merging to `dev`, the build breaks immediately on missing imports — Implementation Instruction 1's pre-condition check exists specifically to catch this before any code is written.
  2. The Accounts panel's information density (balance + period totals + goal progress, now in card form instead of a table) is the one area with real layout judgment left to CC; Instruction 5 is deliberately specific about what must be preserved (all three pieces of data) even though the exact visual arrangement has some latitude.
  3. The nav-link restyle (Instruction 2) is the story's least mockup-grounded piece, since the approved mockup doesn't depict the seven secondary destinations at all — CC has real latitude here, bounded only by "don't remove any destination," which is a testable but not a pixel-specified constraint.

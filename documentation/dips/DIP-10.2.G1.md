# Story 10.2.G1 — Left Sidebar Navigation Shell (Header Rebrand + App-Wide Nav)

*(Gap story — discovered while Joseph reviewed the live Story 10.2 (STEW-45, PR #27) deploy on Vercel Preview, 2026-09-08: the pill-row nav under the header doesn't match the approved mockup's intent — that treatment was a compromise Story 10.2's own DIP had to make because the approved mockup never depicted those seven destinations at all. Joseph asked for a left sidebar instead, and for the header to read "Steward" only, not "OHh Steward." Originating story: 10.2 (STEW-45, PR #27).)*

**Review Summary Strip:** Story ID: 10.2.G1 | Objective: Replace the Dashboard's pill-row nav with a persistent left sidebar shared across every `/dashboard/*` route, rebranded to "Steward" only | Core Change: New `apps/web/app/dashboard/layout.tsx` (Next.js layout) providing the sidebar + wordmark; `apps/web/app/dashboard/page.tsx` loses its now-redundant `<nav>` block; `apps/web/app/layout.tsx`'s page-title metadata updated | Risk Level: Low | Confidence Score: 87 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As Joseph, using the web app, I want a persistent left sidebar for navigation — with the header reading "Steward," not "OHh Steward" — instead of the current pill row under the header, so that the app's chrome matches the direction I approved and every future admin screen (Epic 7) gets consistent navigation for free.

**Acceptance Criteria:**
1. Given any page under `/dashboard/*`, when it renders, then a persistent left sidebar (240px wide, `--color-bg` background, `--color-border` right border) is present, showing the "Steward" wordmark (icon badge + text, no "OHh") at the top and a vertical list of nav items below it.
2. Given the sidebar's nav list, then it contains exactly the eight real, currently-reachable destinations: Dashboard (`/dashboard` — new addition, see Dependencies & Assumptions), Transactions (`/dashboard/transactions`), Add Transaction (`/dashboard/transactions/new`), New Budget (`/dashboard/budgets/new`), New Account (`/dashboard/accounts/new`), Invite (`/dashboard/invites/new`), Security (`/dashboard/security`), Account (`/dashboard/account`) — grouped as "core" (Dashboard, Transactions, Add Transaction) above a thin divider and "setup/admin" (the remaining five) below it. No dead links — a nav item is added only for a route that exists today.
3. Given the currently-active route, when the sidebar renders, then that route's nav item is visually distinguished (background `var(--color-primary-tint)`, text `var(--color-primary-dark)`) from the rest — computed via `usePathname()`, exact match for `/dashboard` and prefix match for every other item.
4. Given each sidebar nav item, then it is a real `<Link href>` (or a styled wrapper around one) — not a `<button onClick={() => router.push(...)}>` — so native browser affordances (open in new tab, right-click copy link, hover prefetch) work, correcting the minor regression Story 10.2's `Chip`-based nav row introduced.
5. Given `apps/web/app/dashboard/page.tsx`, when it renders, then its own top-of-page `<nav>`/`NAV_LINKS` block is removed (superseded by the sidebar) and its Budget/Period-picker top bar and every other existing element render exactly as they did in PR #27 — this story does not touch any query, calculation, or the Accounts/Categories panels.
6. Given the browser tab, when any page loads, then its title reads "Steward" (via `apps/web/app/layout.tsx`'s `metadata.title`), not "OHh Steward."

**Dependencies & Assumptions:** Depends on Story 10.1 (STEW-44, merged) for tokens/primitives and Story 10.2 (STEW-45, PR #27, merged) for the page this story modifies — both verified live via `git show` against `dev` this session. A Next.js `layout.tsx` under `app/dashboard/` automatically wraps every nested route (`accounts/[id]`, `accounts/new`, `account`, `security`, `invites/new`, `budgets/new`, `transactions`, `transactions/new`) — this is the correct, idiomatic way to share persistent chrome across routes, and it is an *expected, intentional* side effect that every one of those currently-plain pages will suddenly render inside the sidebar shell; their own inner content is untouched (still plain — Story 10.3 reskins those forms later), only the chrome around them changes. The "Dashboard" nav item is new (not in the current `NAV_LINKS` array) because today the nav only ever appears while already on `/dashboard`; once the shell is shared across every route, a way back to the Dashboard becomes necessary. The approved mockup's illustrative sidebar additionally showed "Accounts" and "Categories" entries — this DIP deliberately excludes both: there is no Accounts-index route today (accounts are only reachable individually, from the Dashboard's own panel), and the Categories/budget-limit-editor screen doesn't exist yet (that's the separately-planned `5.1.G1` gap story, which can add its own nav entry to this same layout when it ships).

**Traceability:** Direct product-owner feedback from Joseph on the live Story 10.2 deploy, 2026-09-08. No new PIB/PSDD capability — presentation-layer/navigation-architecture only. Prepares the shell Epic 7 (STEW-43's sibling epic, admin screens) will build inside.

**Change Impact:**
- What changes: New shared sidebar layout for every `/dashboard/*` route; the Dashboard page's own duplicate nav row is removed; browser tab title updated.
- What it touches: New `apps/web/app/dashboard/layout.tsx`; `apps/web/app/dashboard/page.tsx` (remove `NAV_LINKS`/`<nav>`/`useRouter` import if no longer used elsewhere in the file); `apps/web/app/layout.tsx` (`metadata.title` only).
- Breaking risk: No — every route's own content and behavior is unchanged; only the surrounding chrome moves from a per-page pill row to a shared sidebar.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement exactly the sidebar shell described above as a new `apps/web/app/dashboard/layout.tsx`, remove the now-redundant nav block from `dashboard/page.tsx`, and update the root layout's page title. Do NOT implement: a "Categories" or "Accounts" nav entry (no such route exists yet — do not create placeholder/dead links); any change to `dashboard/page.tsx`'s Budget/Period picker, hero card, Categories panel, Accounts panel, or any query/calculation logic; any change to the inner content of `accounts/new`, `account`, `security`, `invites/new`, `budgets/new`, `transactions`, `transactions/new`, or `accounts/[id]` — only the chrome around them changes, as an automatic consequence of Next.js layout nesting, never a hand-edit to those files; any renaming of the product itself in Jira, the GitHub repo, `PIB.md`/`PSDD.md`, or anywhere outside the two files/one metadata field named above — this is an in-app header and browser-tab-title change only, not a product rebrand.

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (pure rendering/routing-chrome change, no data layer touched) | Reason: Presentation-only; the one structural change (a shared layout wrapping nested routes) is standard, idiomatic Next.js App Router usage, not a novel pattern.

Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

Standing Rule scope clarification: This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline (§6): writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

**Do NOT implement (explicit list, this DIP's own):**
- Do NOT add a "Categories" or "Accounts" sidebar entry — no such route exists; that is `5.1.G1`'s and a future story's own concern respectively.
- Do NOT touch the inner content/JSX of any page other than removing `dashboard/page.tsx`'s own nav block — every other route's content is untouched, only its surrounding chrome changes automatically via the new layout.
- Do NOT change any Supabase query, RLS-relevant logic, or the Budget/Period-picker's state management on `dashboard/page.tsx`.
- Do NOT rename the product anywhere outside `apps/web/app/layout.tsx`'s `metadata.title` and the new sidebar's wordmark text — repo name, Jira project, `PIB.md`/`PSDD.md` all stay "OHh Steward."
- Do NOT add any new npm dependency — the sidebar is plain JSX/inline styles using tokens already available from Story 10.1, same as every other reskinned screen this epic.
- Do NOT use `router.push` for the sidebar's nav items — use real `<Link href>` elements (AC4).

**Implementation Instructions:**
1. Create `apps/web/app/dashboard/layout.tsx` as a client component (`"use client"`, needed for `usePathname()`). Export a default `DashboardLayout({ children }: { children: React.ReactNode })` rendering a flex row: the sidebar (240px, `background: var(--color-bg)`, `borderRight: 1px solid var(--color-border)`, padding, flex column) plus `<div style={{ flexGrow: 1, minWidth: 0 }}>{children}</div>`.
2. Sidebar top: a small icon badge (reuse the existing house/roof glyph already drawn inline in the current `dashboard/page.tsx` styling conventions — hand-written inline SVG, no icon library) plus the text "Steward" (`var(--font-nunito)`, weight 800, ~19px) — no "OHh" anywhere.
3. Define the eight-item nav list (Implementation Instruction's own array, e.g. `NAV_ITEMS`) exactly per AC2's hrefs/labels/grouping, replacing the `NAV_LINKS` array currently in `dashboard/page.tsx` (move it here, don't duplicate it).
4. Each item: a `<Link href={item.href}>` styled as a row (icon + label, padding, border-radius `var(--radius-input)`), active-state computed via `usePathname()` (exact match for `/dashboard`, `pathname.startsWith(item.href)` for every other item — order the comparison so a more specific path doesn't fall through to a less specific one, e.g. check `/dashboard/transactions/new` before `/dashboard/transactions`).
5. In `apps/web/app/dashboard/page.tsx`: remove the `NAV_LINKS` array, the `<nav>` block that renders it, and the `useRouter`/`router` usage if nothing else in the file still needs it (grep the file first — `router` may still be used elsewhere; if so keep the import and only remove the nav-specific usage). Leave every other element (top bar pickers, hero card, Categories panel, Accounts panel) exactly as PR #27 shipped them.
6. In `apps/web/app/layout.tsx`: change `metadata.title` from `"OHh Steward"` to `"Steward"`. Leave `metadata.description` and everything else in that file unchanged.
7. Run `tsc --noEmit` and `next build` on `apps/web`; confirm both are clean (aside from any pre-existing, unrelated failure already on `dev` — note it explicitly rather than working around it).

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

**Application to this story:** None of the twelve obligations bite directly — this story has no SQL, no new trust boundary, no secret, no logging change, no auth surface, no cryptography, no deserialization, no new dependency (obligation 11 is satisfied by there being zero new dependencies at all), and no shared/concurrent state. It is pure client-side routing chrome (a `Link`-based nav list and a `usePathname()` read, both React/Next.js built-ins). The nearest-relevant obligation is 3 (output encoding), trivially satisfied since every nav label is a hardcoded string this DIP specifies — none of it is user-supplied.

**API Contract**

Not applicable — no API route, RPC, or Edge Function is introduced or touched.

**Non-Functional Requirements**

**Performance:** Negligible — a client-side layout with a `usePathname()` call and a static eight-item list; no new network request.

**Scalability:** Unaffected.

**Reliability:** Because every existing page's own content/logic is untouched (this story only changes what wraps it), no already-shipped behavior can regress. The one thing that could go wrong — the active-state path matching picking the wrong item for a nested route — is explicitly sequenced in Implementation Instruction 4 (check more specific paths first) to avoid it.

**Security:** ASVS chapters in scope: none directly. Trust boundary: none newly opened. Sensitive data: none. Weaknesses excluded: not applicable (no injection, auth, or data-handling surface).

**Observability**

No new logging, monitoring, or alerting — client-side rendering/routing chrome only.

**Files to Create/Modify**

- Create: `apps/web/app/dashboard/layout.tsx`
- Modify: `apps/web/app/dashboard/page.tsx` (remove `NAV_LINKS`/`<nav>` block only)
- Modify: `apps/web/app/layout.tsx` (`metadata.title` only)

**Migration Files (if applicable)**

Not applicable.

**Deployment Instructions**

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-49 (Epic STEW-43)

Branch off `dev`, implement per the instructions above, validate locally (`tsc --noEmit`, `next build`), commit, push, open a PR against `dev`. Do not merge — Joseph tests on the resulting Vercel Preview deploy and merges manually.

**Repository Integration Instructions**

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

`apps/web/app/dashboard/layout.tsx` is a new Next.js App Router layout (client component) that Next.js automatically applies to every route under `apps/web/app/dashboard/`. No new import path, provider, or dependency. Data flow: none — this is pure routing chrome with no data fetching of its own. Constraint: the layout must not fetch or hold any Budget/Period/account state itself — that stays owned by `dashboard/page.tsx` exactly as today, since other routes under the same layout (e.g. `/dashboard/security`) have no need for it.

**Change Impact**

- What changes: A new shared sidebar layout replaces the Dashboard's own pill-row nav across every `/dashboard/*` route; browser tab title updated.
- What it touches: `apps/web/app/dashboard/layout.tsx` (new), `apps/web/app/dashboard/page.tsx`, `apps/web/app/layout.tsx`.
- Breaking risk: No.

**Branch Name**

feature/10.2.G1-left-sidebar-nav-shell

**Commit Message**

10.2.G1: Add left sidebar navigation shell, rebrand header to "Steward"

**Pull Request Description**

Implements Story 10.2.G1 (STEW-49), a gap story from Joseph's direct feedback on the live Story 10.2 deploy: replaces the Dashboard's pill-row nav with a persistent left sidebar shared across every `/dashboard/*` route via a new `apps/web/app/dashboard/layout.tsx`, and rebrands the in-app header and browser tab title to "Steward" (dropping "OHh") — AC1–AC6. The sidebar's eight nav items are grounded against real, currently-reachable routes only (no dead links for the not-yet-built Categories/Accounts-index screens). Every existing page's own content and logic — including `dashboard/page.tsx`'s Budget/Period picker, hero card, and Categories/Accounts panels from Story 10.2 — is unchanged; only the chrome around every `/dashboard/*` route changes, as the natural effect of introducing a shared layout. Sets up Epic 7's upcoming admin screens to inherit this navigation automatically.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

**Jira Linkage**

- PDE Story ID: 10.2.G1
- Jira Epic Key: STEW-43
- Jira Story Key: STEW-49

**Stop Point**

Save this DIP verbatim to `documentation/dips/DIP-10.2.G1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests on Vercel Preview and merges manually.

Include full diffs for every file created or modified in the completion report — not a summary. For every other `/dashboard/*` route file (`accounts/new/page.tsx`, `accounts/[id]/page.tsx`, `account/page.tsx`, `security/page.tsx`, `invites/new/page.tsx`, `budgets/new/page.tsx`, `transactions/page.tsx`, `transactions/new/page.tsx`), include `git diff dev [branch] -- [file]` showing zero output as explicit proof that only the new shared layout changed their rendering, never their own source.

**Confidence Assessment**

- **Confidence Score:** 87/100
- **Reasoning:** Both files this story modifies were read in full this session against the actual merged PR #27 code, so the extraction (moving `NAV_LINKS` and the nav block into a new layout) is specified against real, current source rather than assumed. The route inventory backing AC2 was independently verified against the live repo tree — every nav item points at a route that actually exists, and the two routes the mockup implied (Accounts index, Categories) were deliberately excluded rather than papered over with dead links. The score isn't higher only because the active-state path-matching order (Instruction 4) is a small but real judgment call with more than one reasonable implementation, and because this is the first layout.tsx in `apps/web/app/dashboard/` — there's no established local convention to match against, just idiomatic Next.js practice generally.
- **Top Risk Areas:**
  1. Active-state matching for nested routes (e.g. `/dashboard/transactions/new` vs. `/dashboard/transactions`) is the one place a naive `startsWith` ordering could highlight the wrong item — Instruction 4 calls this out explicitly.
  2. Every other `/dashboard/*` page will visually change (gains a sidebar) as an automatic, unavoidable consequence of the new layout — expected and desired, but worth Joseph noticing on the Preview deploy so it doesn't read as an unrequested change to those screens.
  3. Removing `NAV_LINKS`/`useRouter` from `dashboard/page.tsx` needs a quick check that `router` isn't used elsewhere in that file before deleting the import — a minor mechanical risk, not a design one.

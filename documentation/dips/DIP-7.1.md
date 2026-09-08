# Story 7.1 — Household Setup, Invite/Cap Management (Web, Parent-Only)

**Review Summary Strip:** Story ID: 7.1 | Objective: Web-based household administration | Core Change: Parent-only web-wide route guard + household cap admin screen + Category management screen, surfacing the already-shipped invite-send screen | Risk Level: Medium (introduces the first Next.js middleware in this repo — the entire web app's access control now runs through it) | Confidence Score: 87 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As a Parent, I want a web interface for inviting members and configuring household caps and categories, so that I can manage setup from a full-sized screen.

---

### Story Summary

Story 10.2.G1 (merged, PR #28) gave the web app its first persistent navigation shell but deliberately left out "Accounts" and "Categories" links because neither route existed yet, and left the sidebar's own eight destinations as the only reachable screens. This story adds the two still-missing pieces of that sidebar's promise for Category management and household caps, and closes a gap that has existed since Story 1.1: nothing in this repository currently stops a Member from signing in on web and reaching the full Parent admin surface. Story 1.1's own DIP explicitly deferred "role-based route guarding" to this story by name — it is not new scope, it is scope this story has owned since the beginning. Concretely, this story: (1) builds a Next.js middleware that checks the caller's household role on every web request and blocks a non-Parent from the entire app (not just an admin section); (2) adds a Parent-only screen for editing `household.member_cap`/`budget_cap`, backed by a new validated RPC rather than a bare RLS-permitted table write, because no CHECK constraint today stops any value — including negative or zero — from being written directly; (3) adds a screen wiring the already-built, currently-unused `rpc_upsert_category`/`rpc_delete_category` RPCs (shipped under Story 2.3, called from no client code anywhere) to real Category list/create/rename/delete UI; and (4) leaves the existing invite-send screen (`/dashboard/invites/new`, Story 1.2) untouched — AC1 only requires that a Parent can reach it, which the sidebar already does.

### Repo Target

`apps/web` (Next.js) only. No mobile change — Members are mobile-only by design, so there is no "block Members from an admin section" concern on mobile: the entire mobile app is already the Member/Parent-shared surface, and this story does not touch it.

### Grounding Check

Verified this session against the live `ohhsteward-dev` schema (project `poqvothxwmjbtitqtbgh`) and the current `dev` branch (through PR #28's merge, commit `63ab268`) — not assumed from `BACKLOG.md`'s stub text or from the older, unpublished DIP draft that was sitting in `BACKLOG_DIP.md`'s Story 7.1 section (see Revision Note below).

- **`household` table columns, confirmed live:** `id`, `member_cap` (int, default 5), `budget_cap` (int, default 5), `retention_years` (int, default 7), `session_timeout_minutes` (int, default 30), `notification_threshold_pct` (numeric, default 90), `created_at`. Only one constraint exists: `household_pkey` (primary key) — **no CHECK constraint bounds any of these columns today.**
- **`household` RLS, confirmed live:** `enable row level security` + `force row level security`; single policy `household_parent_access`, `cmd = ALL`, `qual = is_household_parent(id)`, **no `with_check`**. This means a Parent's client-side `.from("household").update(...)` on their own household row already succeeds today, for any value, on any column — including `retention_years` (a platform-level setting per Story 9.1's own language, "changed by the platform owner," not a Parent-facing concept) and `session_timeout_minutes`/`notification_threshold_pct` (real, ATD-listed per-household settings, but not named in this story's AC1 — "configure Member/Budget caps" is the literal, complete text). Per the Standing Rule, AC1's literal text is the scope boundary: this DIP touches only `member_cap`/`budget_cap`. It does not touch the RLS policy (an authorization change, out of scope) — instead it closes the "any value including invalid ones" gap with a CHECK constraint (a data-integrity change, not an authorization change) plus a new validated RPC that becomes this story's own intended write path.
- **`household_member` table, confirmed live:** `id`, `household_id`, `auth_user_id` (uuid, not directly joinable client-side to `auth.users` — no email/display-name column here and no view bridges to `auth.users`), `role`, `is_deleted`, `created_at`. RLS: single policy `household_member_read` (`SELECT`, `qual = is_household_parent(household_id) OR auth_user_id = auth.uid()`) — a caller can always read their own row, which is exactly what the route guard needs (their own `role`).
- **`category` table and RPCs, confirmed live by reading the actual function bodies (`pg_get_functiondef`), not assumed:** `rpc_upsert_category(p_household_id uuid, p_name text, p_id uuid default null)` and `rpc_delete_category(p_id uuid)`, both `SECURITY DEFINER`. Both already contain the DIP-2.3-v2 IDOR fix (update/delete paths authorize against the category's *actual* `household_id` looked up from the row itself, never against a caller-supplied value) and both soft-delete (`is_deleted = true`), matching the repo-wide soft-delete convention. **Confirmed via `git grep` across `apps/web` and `apps/mobile`: neither RPC is called from any client file today.** This story is the first to wire them up. `category` RLS (`category_insert`/`category_update`, `with_check/qual = is_household_parent`; `category_read`, `qual = is_household_member`) needs no change. Both RPCs' `EXECUTE` grants are already `authenticated`-only live (`anon` absent), per the STEW-33 hardening batch — confirmed via `information_schema.routine_privileges`, not assumed.
- **`invite` table, confirmed live:** RLS is `enable` + `force` with **zero policies** — a deliberate fail-closed placeholder per `IMPLEMENTATION_CONVENTIONS.md` item 1 (no client, Parent included, can read/write this table directly; the only path is the `SECURITY DEFINER` `rpc_create_invite`, which is `authenticated`-only and already shipped under Story 1.2). This is why AC1's "send invites" is satisfied with **zero new work**: `/dashboard/invites/new` already calls `rpc_create_invite` and is already reachable from the sidebar. AC1 does not ask for an invite list, resend, or cancel — only "send invites" — so building that management surface here would be scope beyond the literal AC text; it is not attempted.
- **No route guard exists anywhere in `apps/web` today, confirmed by searching the repo** (`find` for `middleware*`/`*guard*`: no matches; `grep` for `role` across `apps/web`: only local component state in `invites/new/page.tsx`, nothing that reads the caller's own role). Any authenticated user — Parent or Member — who signs in on web today reaches the full dashboard. `@supabase/ssr` (`0.12.6`) is already a pinned dependency (used today for the browser client only), so building the server-side client this guard needs adds no new dependency.
- **No `/dashboard/household` or `/dashboard/categories` route exists** (`find apps/web/app/dashboard -iname "*categor*"` and directory listing both confirm) — no prior work to build on for either screen (§7 rule 11).
- **Trust boundary named:** every value in the caps form (`p_member_cap`, `p_budget_cap`) and the Category form (`p_name`) is untrusted client input, validated server-side — the cap RPC range-checks explicitly (new, since no CHECK constraint exists yet); the Category RPCs already validate authorization server-side (existing, unchanged). The route guard's own read (the caller's `role`) is itself RLS-protected — a spoofed/forged client claim about "being a Parent" cannot bypass it, because the guard reads `household_member.role` from the database via the caller's own authenticated session, never from client-supplied state.
- **`IMPLEMENTATION_CONVENTIONS.md` walk-through (per its own "How to use this doc"):**
  - Item 1 (RLS enable+force on new tables): N/A — no new table.
  - Item 2 (audit trigger on new tables): N/A — no new table. (For completeness: `household` already carries `trg_audit_household` and `category` already carries `trg_audit_category`, both confirmed live — cap and Category writes are already covered by the audit trail once this story's RPC/UI calls them.)
  - Item 3 (explicit `anon` revoke on new functions): **Applies** — the new `rpc_update_household_caps` function must include an explicit `revoke execute on function ... from anon` in its own migration, not rely on a bare `revoke ... from public`, per the documented Supabase default-privilege gap.
  - Item 4 (confirm the grant live, not by file inspection): **Applies** — Deployment Instructions require the live grants query below, not a re-read of the migration file.
  - Item 5 (RLS-CI-01 full-fidelity cross-check against DVP §3): **Applies.** DVP §3's mandatory list is Budget/Account/Category/unauthenticated-focused and does not separately name the `household` table — but this story is the **first** to exercise `household`'s own RLS policy and its first-ever RPC from any client, and per this convention's own standard ("don't just check the item that matches the story's ACs — state coverage explicitly"), confirmed via `grep` that **zero existing tests touch `household` at all** (no `.from("household")`, no `member_cap`/`budget_cap` reference anywhere in `tests/rls/rls-ci-01.test.ts`). New committed test coverage for this exact gap is specified in Implementation Instructions below — this is a new, real requirement of this story, not deferred.
  - Item 6 (mobile keyboard): N/A — web only, no mobile screen touched.
  - Item 7 (anon-denial failure mode, empty vs. thrown error): **Applies** to the new anon-denial test cases below — asserted by outcome (zero rows / thrown error, either acceptable), never by a specific mechanism, per the documented convention.
  - Item 8 (`on conflict` guard-trigger timing): N/A — no upsert-with-guard-trigger pattern introduced by this story.

### Revision Note

`BACKLOG_DIP.md` already contained a full, never-finalized DIP draft under Story 7.1's heading (no corresponding `documentation/dips/DIP-7.1.md` file exists, and `BACKLOG.md`'s own Story 7.1 pointer read `DIP to be completed by Persona 5 — ID: TBD` going into this session — the two files had drifted). That draft's core design decisions — a new validated `rpc_update_household_caps` RPC rather than a bare direct table write, and a Next.js middleware guarding the entire web app rather than only an "admin section" — independently matched the design this DIP arrived at from grounding against the live schema this session, and are adopted here with attribution. Two things from that draft are **not** carried forward: (1) its AC1 phrasing dropped the story's own "(Story 1.2)"/"(Story 2.3)" citations — restored here to the current `BACKLOG.md` text; (2) it did not identify the CHECK-constraint gap (that a bare RLS-permitted update lets any value through, RPC or not, unless the column itself is bounded) — added here as Instruction 2 below, since without it the new RPC's own range validation would be trivially bypassable via a direct client `.update()` call on the same column.

### ATD Delta

No ATD amendment needed. The middleware is new infrastructure (this repo's first `apps/web/middleware.ts`) but implements an access-control pattern ATD §4.1 already describes as a "UX-layer convenience" layered on top of RLS as the real boundary — it does not change any ATD-level decision about where authorization actually lives. The new `rpc_update_household_caps` function follows the exact `SECURITY DEFINER` + `is_household_parent()` pattern ATD §3.3 already establishes for every other Parent-gated write; it is an instance of an existing pattern, not a new one.

---

### Acceptance Criteria

1. Given a Parent on web, when they access the admin section, then they can send invites (Story 1.2), configure Member/Budget caps, and manage Categories (Story 2.3).
2. Given a Member (not a Parent) attempts to access the web app, then access is denied — Members cannot use web at all per role rules (Story 1.4-adjacent access control).
3. Given cap changes, when saved, then they apply immediately without requiring a deployment/code change.
4. **(Negative security AC)** Given a Member's session directly calls the cap-update RPC (bypassing the web route guard entirely — e.g. a raw RPC call from a non-web client, or a hypothetical bug in the guard itself), when invoked, then the function's own `is_household_parent` check denies it — the route guard is not the only enforcement layer.

---

### Implementation Instructions

1. *Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.*

2. *This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline (§6): writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.*

3. **Do NOT implement:**
   - Invite list, resend, or cancel UI — AC1 says "send invites" only, and the `invite` table has zero RLS policies (fail-closed by design), so a list/resend/cancel screen would need new `SECURITY DEFINER` RPCs neither AC1 nor any dependency calls for. The existing `/dashboard/invites/new` screen is unchanged.
   - `session_timeout_minutes` or `notification_threshold_pct` editing — AC1's literal text is "Member/Budget caps" only. ATD's domain invariant that these are "configurable per household" does not, on its own, put an editing UI for them in this story's scope; if Joseph wants that surfaced, it is a follow-up gap story (e.g. `7.1.G1`), not a silent addition here.
   - `retention_years` editing anywhere — Story 9.1 frames this as a platform-owner setting, not a household Parent one; do not add it to the caps form or expose it via any new RPC.
   - Any change to the `household_parent_access` RLS policy, or any new RLS policy on `household` — the CHECK constraint (Instruction 5 below) closes the value-bounding gap without touching who can write.
   - Any change to `rpc_upsert_category`'s or `rpc_delete_category`'s SQL body, parameters, or grants — call them exactly as they exist today.
   - Category *limit*/budget-setting UI (`category_limit`, `rpc_upsert_category_limit`) — a different screen, different RPC, out of this story's scope entirely (tracked separately, not this story).
   - Any visual reskin using the Story 10.2 design-system primitives (`Button`/`Card`/`Chip`/`ProgressBar`/`IconBadge`). The two new screens follow the same plain, unstyled form convention already used by `/dashboard/security`, `/dashboard/invites/new`, `/dashboard/budgets/new`, and `/dashboard/accounts/new` — all deliberately left for the not-yet-DIP'd Story 10.3 ("Web Reskin: Add Transaction & Forms"). Reskinning them here would be scope this story was never asked to do.
   - Any change to `apps/web/app/page.tsx` (sign-up/sign-in), `apps/web/app/accept-invite/page.tsx`, or the authentication flow itself — the guard sits in front of these, it does not modify them.
   - Blocking an unauthenticated (not-signed-in) visitor from any route. Today, an unauthenticated visit to `/dashboard/*` is not redirected anywhere (client Supabase calls simply return no data). AC2 is about a Member's *authenticated* session being denied — it says nothing about tightening unauthenticated access, and doing so would be a behavior change beyond what any AC requires. Preserve this exactly: the guard only evaluates role for a request that already has a session.
   - Any new npm dependency. `@supabase/ssr` (`0.12.6`) is already pinned in `apps/web/package.json` and provides everything the middleware needs (`createServerClient`).

4. **Migration — `household` cap validation and the new RPC.** Create `supabase/migrations/20260908000000_household_caps_admin.sql`:
   - Add two CHECK constraints on `household`: `member_cap` and `budget_cap` must each be between 1 and 50 inclusive (an implementation-chosen upper bound — not specified numerically anywhere upstream — reasonable per Secure Coding Obligation 2, "reject by default... where a closed set of valid values exists" applied here as a bounded numeric range; the current default of 5 for both falls well inside it, so no existing row can violate it). This is the change that makes the RLS-permitted-but-previously-unbounded direct `.update()` path safe regardless of write path (form, RPC, or a raw client call) — it is a data-integrity constraint, not an authorization change, so it does not conflict with Instruction 1/2's Standing Rule.
   - Create `rpc_update_household_caps(p_member_cap int, p_budget_cap int)`, `SECURITY DEFINER`, `SET search_path TO 'public'`: look up the caller's own household **server-side** — `select household_id from household_member where auth_user_id = auth.uid() and role = 'parent' and is_deleted = false` — never accept a client-supplied household id (there is nothing for a caller to spoof, matching the pattern already used by `rpc_delete_category`'s household lookup). If no row is found, `raise exception 'not authorized'` (fail closed — a Member or an unaffiliated caller gets the same denial the CHECK-constraint/RLS layer would eventually also produce). Range-check `p_member_cap`/`p_budget_cap` are each between 1 and 50 before the update, raising a clear, non-leaking message (Obligation 10) rather than surfacing the CHECK constraint's own raw Postgres error text — the CHECK constraint is the backstop, this is the friendly first line. `update household set member_cap = p_member_cap, budget_cap = p_budget_cap where id = <the looked-up household id>`.
   - Explicitly `revoke execute on function rpc_update_household_caps(int, int) from anon;` and `grant execute on function rpc_update_household_caps(int, int) to authenticated;` — per `IMPLEMENTATION_CONVENTIONS.md` item 3, a bare `revoke ... from public` does not remove Supabase's default `anon` grant.
   - No change to `trg_audit_household` — it already fires `AFTER UPDATE` on every column, so a cap change via this RPC is already captured by the existing audit trail (confirmed live). No new trigger needed.

5. **Middleware — Parent-only web-wide route guard.** Create `apps/web/lib/supabase/middleware.ts`, a server-side Supabase client factory using `createServerClient` from `@supabase/ssr`, reading/writing cookies via the standard Next.js middleware cookie adapter pattern (`getAll`/`setAll` against the incoming `NextRequest`/outgoing `NextResponse`) — mirror the existing `apps/web/lib/supabase/client.ts` for the URL/anon-key env vars, but this one is the server-cookie-aware variant, not the browser client. Create `apps/web/middleware.ts`:
   - Call `supabase.auth.getUser()`. If there is no authenticated user, return `NextResponse.next()` unchanged — do not evaluate role, do not redirect (preserves today's unauthenticated-access behavior exactly, per the Do-NOT-implement list above).
   - Skip the role check entirely (always `NextResponse.next()`) for `pathname === "/"`, `pathname.startsWith("/accept-invite")`, and `pathname === "/member-web-blocked"` — these three must stay reachable regardless of role, or sign-in/invite-acceptance/the block page itself would break.
   - Otherwise, read the caller's own role: `.from("household_member").select("role").eq("auth_user_id", user.id).eq("is_deleted", false).maybeSingle()` (RLS already permits this — `auth_user_id = auth.uid()` matches the existing `household_member_read` policy, no new policy needed). If no row is found, or `role !== "parent"`, redirect to `/member-web-blocked`.
   - Otherwise (`role === "parent"`), return `NextResponse.next()`.
   - `export const config = { matcher: [...] }` with a broad matcher excluding only Next.js static internals (`_next/static`, `_next/image`, `favicon.ico`) — keep the three path exclusions above inside the function body (not the matcher regex), since a regex-only exclusion is easy to get subtly wrong (per the general lesson already documented in this repo's own `IMPLEMENTATION_CONVENTIONS.md` — verify by inspection, not by trusting a hand-written regex).
   - Create `apps/web/app/member-web-blocked/page.tsx` — a minimal, unstyled page (matching the plain-form convention named above) with a clear message: web is for parents; use the mobile app to continue. No sidebar (it lives outside `apps/web/app/dashboard/`, so `dashboard/layout.tsx` never wraps it — a blocked Member should not see the Parent nav shell at all).

6. **Household caps screen.** Create `apps/web/app/dashboard/household/page.tsx` (plain form, matching `/dashboard/security`'s convention: no design-system primitives). On mount, read the current `member_cap`/`budget_cap` via `.from("household").select("member_cap, budget_cap")` (RLS already scopes this to the caller's own household — no explicit household-id filter needed, matching the pattern already used elsewhere in this codebase, e.g. `accounts/new`'s Budget select). On submit, call `supabase.rpc("rpc_update_household_caps", { p_member_cap, p_budget_cap })`; on error, show a generic message ("We couldn't save those changes. Please try again.") — never surface the RPC's raw exception text client-side (Obligation 10); on success, show a confirmation and re-read the updated values (AC3 — no deploy needed, the next read reflects the change immediately since nothing is cached).

7. **Category management screen.** Create `apps/web/app/dashboard/categories/page.tsx` (plain form/list, same convention). Fetch the caller's own `household_id` once (`.from("household_member").select("household_id").eq("auth_user_id", user.id).eq("is_deleted", false).single()` — same pattern `budgets/new/page.tsx` already uses to resolve the caller's own membership row). List existing categories: `.from("category").select("id, name").eq("is_deleted", false).order("name")` (RLS already scopes to the caller's own household). Provide: an add-new form calling `rpc_upsert_category(p_household_id, p_name, null)` (insert path — `p_id` omitted/`null`); an inline rename per row calling `rpc_upsert_category(p_household_id, p_name, p_id)` (update path, existing `p_id`); a delete action per row calling `rpc_delete_category(p_id)`. All three calls use generic error messages on failure (Obligation 10) — do not surface "not authorized for this household" or "category not found" verbatim, since (per the RPCs' own existing design, unchanged by this story) those are intentionally indistinguishable to avoid leaking which condition failed.

8. **Sidebar — two new destinations.** Modify `apps/web/app/dashboard/layout.tsx`: add two entries to the existing `SETUP` array — `{ href: "/dashboard/household", label: "Household Settings", icon: <SlidersIcon /> }` and `{ href: "/dashboard/categories", label: "Categories", icon: <TagIcon /> }` — following the file's own established pattern exactly (same inline-SVG icon-component style as `HomeIcon`/`ListIcon`/etc., same `NavItem` shape, same `Link href` rendering already fixed by Story 10.2.G1; no change to `activeHref` computation, `CORE`, or any existing entry). This is the completion of the "Categories" placeholder Story 10.2.G1's own comment explicitly deferred ("no 'Accounts' or 'Categories' — those routes don't exist yet — future stories add them here").

9. **New committed RLS-CI-01 coverage** (per `IMPLEMENTATION_CONVENTIONS.md` item 5's finding above — `household`'s own RLS and its first-ever RPC have zero existing test coverage). Add a new `describe("RLS-CI-01: household cap admin access")` block to `tests/rls/rls-ci-01.test.ts`, reusing existing fixtures (`parentA`, `memberB`, `householdId`) where possible rather than duplicating setup:
   - Parent A can call `rpc_update_household_caps` with valid values (e.g. `{ p_member_cap: 7, p_budget_cap: 4 }`) and a subsequent `.from("household").select("member_cap, budget_cap")` reflects the change.
   - Member B (not a Parent) calling `rpc_update_household_caps` is denied — assert an error is returned and the household row's caps are unchanged (AC4).
   - An unauthenticated (`anon`) client calling `rpc_update_household_caps` is denied (per Item 7's guidance: assert the outcome — an error or, if `EXECUTE` were ever mistakenly re-granted, a subsequent no-op — never assert a specific error code/shape).
   - `rpc_update_household_caps` called with an out-of-range value (e.g. `p_member_cap: 0` or `p_member_cap: 51`) is rejected and the household row is unchanged.
   - A direct client `.from("household").update({ member_cap: 0 })` call (bypassing the RPC entirely) is rejected by the new CHECK constraint — confirms the constraint, not just the RPC's own range check, is the real backstop.
   - Member B's direct `.from("household").update(...)` on any column is denied by the existing `household_parent_access` RLS policy (zero rows affected) — this policy has never been exercised by any existing test; this closes that gap as a side effect of this story's own new surface.

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

**Application to this story:** Obligation 2 (input validation) is central — `rpc_update_household_caps` range-validates server-side (client-side form bounds are a UX nicety only), and the new CHECK constraint is the actual backstop against any write path (form, RPC, or a raw client `.update()`) writing an invalid cap value; obligation 6 (authorization, fail closed): the middleware is explicitly a UX-layer convenience — `rpc_update_household_caps` and the Category RPCs each independently re-verify `is_household_parent` (or the caller's own membership) server-side, so a Member who somehow reaches an admin screen (a route-guard bug, a direct RPC call) still cannot mutate anything, satisfying AC4; obligation 10 (error handling): every new client call surfaces a generic message, never the RPC's raw exception text, consistent with how `invites/new` and `security` already behave; obligation 3 (output encoding) is not specially exercised — category names render as plain React text content, which React encodes by default, no `dangerouslySetInnerHTML` anywhere in this story's new files.

### API Contract

- `supabase.rpc("rpc_update_household_caps", { p_member_cap: number, p_budget_cap: number })` — new, `authenticated`-only. Success: no return value needed (`void`), the caller re-reads `household`. Failure: a thrown Postgres exception (not-a-parent, or out-of-range) — the client must catch and show a generic message, never the raw text.
- `supabase.rpc("rpc_upsert_category", { p_household_id: string, p_name: string, p_id?: string })` — existing, unchanged. Returns the category's `uuid`.
- `supabase.rpc("rpc_delete_category", { p_id: string })` — existing, unchanged. Returns `void`.
- `supabase.rpc("rpc_create_invite", { p_email: string, p_role: "parent" | "member" })` — existing, unchanged; no new call site added by this story (already called from `/dashboard/invites/new`).
- `.from("household").select("member_cap, budget_cap")` / `.from("category").select("id, name").eq("is_deleted", false)` — existing RLS-scoped reads, no new policy.

### Non-Functional Requirements

**Performance:** The middleware adds one extra Supabase query (`household_member` role lookup) per navigation, only for an authenticated session — negligible at this app's confirmed low-volume profile (households capped at 5 members, 5 budgets), consistent with the "no separate custom API server, RLS as the boundary" architecture already accepted for every other screen.

**Scalability:** Bounded by household size; no scale concern at this profile.

**Reliability:** Cap changes take effect immediately (AC3) because nothing caches `household.member_cap`/`budget_cap` — every existing cap-check (Stories 1.2's invite-cap check, 2.1's budget-cap check) reads the live row on each invocation, unchanged by this story.

**Security:** ASVS chapters in scope: V4 (Access Control — dual-layer: the new middleware is a UX convenience, `is_household_parent`/the caller's-own-row lookup inside each RPC is the actual boundary, per AC4), V5 (Validation — cap values are range-checked server-side, both at the RPC and, as a backstop, at the CHECK-constraint layer). Trust boundaries this story crosses: the caps form (two integers), the Category form (one text field, already protected by the existing IDOR-safe RPCs), and the middleware's own read of the caller's role (itself RLS-protected, not client-asserted). Sensitive data handled: none — no PII, no financial data touched by this story's own new surface. Weaknesses this story must not introduce: CWE-89 (all new SQL is parameterized via RPC arguments, no string-built SQL anywhere in the new migration), CWE-862/CWE-863 (missing/incorrect authorization — closed by the dual-layer design in AC4), CWE-209 (error handling — generic client-facing messages only, per obligation 10 above).

### Observability

Cap changes are already covered by the universal audit trail — `trg_audit_household` fires on every `UPDATE`, including one issued through the new RPC, with no additional logging needed. Category create/rename/delete are already covered the same way via `trg_audit_category` (both confirmed live and unchanged by this story). The middleware itself logs nothing new — a redirect to `/member-web-blocked` is not a security event worth a dedicated log line at this app's scale (it is expected, routine behavior for a Member who tries the web app), and per obligation 5, no request payload or session token is ever logged.

### Files to Create/Modify

- `supabase/migrations/20260908000000_household_caps_admin.sql` (new) — CHECK constraints + `rpc_update_household_caps` + grants.
- `apps/web/lib/supabase/middleware.ts` (new) — server-side Supabase client for middleware use.
- `apps/web/middleware.ts` (new) — the Parent-only web-wide route guard.
- `apps/web/app/member-web-blocked/page.tsx` (new) — the block message shown to a denied Member.
- `apps/web/app/dashboard/household/page.tsx` (new) — Member/Budget cap form.
- `apps/web/app/dashboard/categories/page.tsx` (new) — Category list/create/rename/delete.
- `apps/web/app/dashboard/layout.tsx` (modify) — two new `SETUP` entries + two new icon components, following the file's existing pattern exactly; no other change.
- `tests/rls/rls-ci-01.test.ts` (modify) — new `"RLS-CI-01: household cap admin access"` describe block per Instruction 9.

**Explicit constraint (must NOT be altered):** `apps/web/app/dashboard/page.tsx`, `apps/web/app/dashboard/invites/new/page.tsx`, `apps/web/app/dashboard/security/page.tsx`, `apps/web/app/dashboard/accounts/**`, `apps/web/app/dashboard/budgets/**`, `apps/web/app/dashboard/transactions/**`, `apps/web/app/page.tsx`, `apps/web/app/accept-invite/page.tsx`, `apps/web/lib/supabase/client.ts` — include `git diff [base] [branch] -- [file]` showing zero output for each in the completion report, per §7 rule 13.

### Migration Files

```sql
-- 20260908000000_household_caps_admin.sql

alter table household
  add constraint household_member_cap_range check (member_cap between 1 and 50),
  add constraint household_budget_cap_range check (budget_cap between 1 and 50);

create or replace function rpc_update_household_caps(p_member_cap int, p_budget_cap int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_household_id uuid;
begin
  select household_id into v_household_id
    from household_member
    where auth_user_id = auth.uid()
      and role = 'parent'
      and is_deleted = false;

  if v_household_id is null then
    raise exception 'not authorized';
  end if;

  if p_member_cap is null or p_member_cap < 1 or p_member_cap > 50
     or p_budget_cap is null or p_budget_cap < 1 or p_budget_cap > 50 then
    raise exception 'caps must be between 1 and 50';
  end if;

  update household
    set member_cap = p_member_cap,
        budget_cap = p_budget_cap
    where id = v_household_id;
end;
$$;

revoke execute on function rpc_update_household_caps(int, int) from public;
revoke execute on function rpc_update_household_caps(int, int) from anon;
grant execute on function rpc_update_household_caps(int, int) to authenticated;
```

Validate locally via the Supabase CLI before this is proposed for the remote Preview project — never apply directly to a remote/production project (per the pipeline's standing migration rule).

### Deployment Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`
- **Jira Key:** `STEW-50`

1. Apply the migration locally (Supabase CLI), confirm it validates before any remote proposal.
2. Confirm live (not by file inspection, per `IMPLEMENTATION_CONVENTIONS.md` item 4):
   ```sql
   select p.proname, g.grantee, g.privilege_type
   from information_schema.routine_privileges g
   join information_schema.routines r on r.specific_name = g.specific_name
   join pg_proc p on p.proname = r.routine_name
   where r.routine_schema = 'public' and p.proname = 'rpc_update_household_caps';
   -- anon must NOT appear; authenticated must appear
   ```
3. Confirm both CHECK constraints exist live: `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'household'::regclass;` — both `household_member_cap_range` and `household_budget_cap_range` must be present.
4. Create the feature branch off `dev`, implement, run the full `rls-ci-01` suite locally (including the new block from Instruction 9) before pushing.
5. Stage, commit, push, open the PR against `dev`. Do not merge — Joseph tests on Vercel Preview and merges manually.

### Repository Integration Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`

**Components to extend:** a new Next.js middleware (repo's first) sitting in front of every `apps/web` route; two new page components under `apps/web/app/dashboard/`; one new page component outside the dashboard shell (`member-web-blocked`); one new `SECURITY DEFINER` RPC; two new CHECK constraints on an existing table; the existing `dashboard/layout.tsx` sidebar (additive only).

**Expected integration behavior:** the middleware's access-control change applies to the entire web app, not just the two new routes — explicitly verify (locally, before opening the PR) that a Parent's existing access to `/dashboard`, `/dashboard/transactions`, `/dashboard/accounts/*`, `/dashboard/budgets/new`, `/dashboard/invites/new`, `/dashboard/security`, and `/dashboard/account` all continue to work unchanged, and that `/` and `/accept-invite` remain reachable by anyone (signed in or not, Parent or Member) — a regression in either direction (blocking a Parent, or failing to block a Member) is a failed AC, not a minor bug.

**Data flow impact:** writes to `household.member_cap`/`budget_cap` (read by the existing, unchanged cap-check logic in `rpc_create_invite` and `rpc_create_budget`); writes to `category` rows (read by the existing, unchanged Category-select logic used elsewhere, e.g. the Story 10.2 dashboard's category-icon lookup, which is name-keyed and unaffected by new rows).

**Dependencies to add/update:** none — `@supabase/ssr` is already pinned.

**Explicit constraints (must NOT be altered):** the `household_parent_access` RLS policy; `rpc_upsert_category`/`rpc_delete_category`'s SQL bodies, parameters, or grants; `rpc_create_invite`; any file listed in "Files to Create/Modify"'s explicit-constraint list above; the existing `CORE` array or `activeHref` logic in `dashboard/layout.tsx`.

### Change Impact

- **What changes:** New Parent-only web-wide route guard; new household-cap admin screen backed by a new validated RPC; new Category management screen wiring already-shipped RPCs; two new sidebar entries.
- **What it touches:** `household` (new constraints, new RPC), the entire `apps/web` request path (new middleware), `apps/web/app/dashboard/layout.tsx` (additive), `tests/rls/rls-ci-01.test.ts` (new coverage).
- **Breaking risk:** Yes, narrowly and intentionally — a Member who could previously reach the web dashboard (an unintended gap since Story 1.1) can no longer do so. This is exactly AC2's purpose, not an unintended regression. No other existing behavior changes.

### Branch Name

feature/7.1-web-admin-caps-categories-guard

### Commit Message

7.1: Parent-only web route guard, household cap admin screen, Category management screen

### Pull Request Description

Closes Story 7.1. Adds this repository's first Next.js middleware, enforcing Parent-only access across the entire web app (AC2) while every underlying RPC independently re-checks authorization server-side (AC4) — the middleware is a UX convenience, not the security boundary. Adds a Parent-only household-caps screen (Member/Budget caps only, per AC1's literal scope) backed by a new `rpc_update_household_caps` RPC plus a CHECK constraint that bounds the columns regardless of write path (AC3 — changes apply immediately, no deploy). Adds a Category management screen wiring the already-shipped, previously-unused `rpc_upsert_category`/`rpc_delete_category` RPCs to real list/create/rename/delete UI (AC1). Leaves the existing invite-send screen untouched — already reachable, already satisfies that part of AC1. Two new sidebar entries complete the placeholder Story 10.2.G1 explicitly left for this story. New committed RLS-CI-01 coverage closes a pre-existing gap: zero tests previously touched the `household` table's own RLS policy or exercised any RPC against it.

### Jira Linkage

- PDE Story ID: 7.1
- Jira Epic Key: STEW-7
- Jira Story Key: STEW-50

---

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-7.1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests locally and merges manually.

Include full diffs for every file created or modified in the completion report per §7 rule 13 — not a summary — plus the explicit zero-output `git diff` proof for each file in the "must NOT be altered" list above.

### Confidence Assessment

- **Confidence Score:** 87
- **Reasoning:** The Category and invite-send portions of this story are low-risk — wiring already-tested, already-IDOR-safe RPCs to new UI, following an established plain-form convention. The middleware is the real source of risk: it is this repository's first Next.js middleware, it sits in front of every request, and a mistake in its matcher or its "no session → pass through" branch could either lock out a Parent (a hard regression, easy to notice) or fail to lock out a Member (a silent security gap, easy to miss in casual testing since it only shows up when actually signed in as a Member on web). The dual-layer design (AC4) is what keeps a middleware bug from becoming a real authorization bypass — the RPCs deny independently either way — which is why this isn't scored lower despite introducing genuinely new infrastructure.
- **Top Risk Areas:**
  1. Middleware matcher/exclusion correctness — verify explicitly, on a local Preview-equivalent run, that both directions work: a Parent reaches every existing screen unchanged, and a Member signing in on web actually lands on `/member-web-blocked` rather than an infinite redirect or a silent pass-through.
  2. The new CHECK constraint is additive and the current default (5/5) is well within [1,50], so no existing row should violate it on migration — but confirm this with a live count (`select count(*) from household where member_cap not between 1 and 50 or budget_cap not between 1 and 50;` should return 0) before applying, since a violation would fail the migration outright.
  3. `rpc_update_household_caps`'s server-derived household lookup requires the caller to have an active `household_member` row with `role = 'parent'` — confirm this matches every existing Parent account's actual state live (it should, since `role` is set at registration/promotion and never touched by this story), not just assumed from the schema.

---

## Confidence Assessment

- **Confidence Score:** 87
- **Reasoning:** See story-level Confidence Assessment above (same content — provided at both levels per the Output Template).
- **Top Risk Areas:** See above.

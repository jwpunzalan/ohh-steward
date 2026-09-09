# Story 7.2 — Reports/Export & Audit Log Viewer (Web)

**Review Summary Strip:** Story ID: 7.2 | Objective: Support the documentation-as-asset success metric with a Parent-only Reports/Export screen and an Audit Log browser | Core Change: Reports screen (category/period summary + account balances, CSV export via a new Edge Function) + Audit Log viewer (filterable read-only browser over `audit_log_entry`) | Risk Level: Medium | Confidence Score: 82 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As a Parent, I want to view and export reports and browse the audit log, so that I have documentation I can rely on for support and, potentially, for a future sale of the household's financial records asset.

**Dependencies & Assumptions:** Depends on Story 3.3 (`audit_log_entry`, `audit_log_read` policy — live and confirmed), Story 6.1 (`v_category_period_state` view, `security_invoker=true` — live and confirmed), Story 7.1 (the Parent-only web-wide middleware — live, PR #29). Exact export format is CSV for v1 (PDF explicitly deferred, not silently bundled in) — this carries forward the decision already recorded in `BACKLOG_DIP.md`'s prior draft for this story, not a new choice made here.

**Traceability:** PIB Success Metric: "Process-level — documentation as a sellable/supportable asset." PSDD Capability: Dashboard & Reporting (admin layer), Epic 7.

**Change Impact:**
- What changes: New Reports screen (web), new `export-report` Edge Function, new Audit Log viewer screen (web), two new sidebar entries.
- What it touches: `v_category_period_state` (read), `account` (read), `audit_log_entry` (read) — no schema change to any of them.
- Breaking risk: No.

---

### Story Summary

Delivers the two remaining Parent-only web capabilities Epic 7 was scoped for: a Reports screen showing category/period spend-vs-limit and account balances with CSV export, and an Audit Log viewer over the `audit_log_entry` table Story 3.3 already populates on every entity mutation. `BACKLOG_DIP.md` already carried a full, never-finalized draft DIP under this story's heading (`BACKLOG.md`'s own pointer still reads "DIP to be completed by Persona 5 — ID: TBD" — the two files had drifted, the same situation Story 7.1 was found in). This DIP re-grounds that draft against the live schema and current `dev` source rather than trusting it as-is, and it found one real gap the draft missed: the export Edge Function sits outside Story 7.1's Next.js middleware (middleware only guards page navigation inside the Next app, not a direct HTTPS call to a Supabase Edge Function), and `v_category_period_state`'s RLS is governed by `can_access_budget()` — which permits a Budget-owner **Member**, not just a Parent. Relying on RLS alone for the export path would let a Member who owns/co-owns a Budget call the function directly (bypassing the web UI) and successfully export that Budget's data, which does not satisfy this story's own AC3 ("Reports... Parent-only"). The DIP below adds an explicit Parent check inside the Edge Function itself to close this — see Grounding Check and Instruction 5.

### Repo Target

`apps/web` only (Parent-only surface, per PSDD Epic 7) plus one new Supabase Edge Function (`supabase/functions/export-report`). No mobile changes — Reports/Audit Log are explicitly web-only per PSDD's Functional Overview ("web Reports/Export, Audit Log viewer").

### Grounding Check

- **`audit_log_entry`, confirmed live:** columns `id, entity_type, entity_id, household_member_id (nullable), action (check: create/update/delete/restore), diff jsonb, created_at`; `enable`+`force` RLS; single policy `audit_log_read` (SELECT only) with `qual = is_household_parent((select household_id from household_member where household_member.id = audit_log_entry.household_member_id))` — Parent-only, exactly as the prior draft assumed. Index: `idx_audit_log_entity (entity_type, entity_id)` only — no index on `created_at` or `household_member_id`. Given ATD §4.2's confirmed low-volume profile (capped households, small member/budget counts), this is acceptable without a new index; not adding one to avoid unrequested schema scope.
- **12 audited entity tables, confirmed live** via `trg_audit_*` triggers: `account, budget, budget_owner, budget_period, category, category_limit, household, household_member, invite, transaction, transaction_split, transfer`. The Audit Log viewer's entity-type filter uses this fixed list (Instruction 4) — new entity tables must be added here as they're added elsewhere, the same standing convention Story 3.3 established for trigger coverage itself.
- **Known, pre-existing data-completeness gap found during grounding (not fixed by this story):** `fn_audit_log()` resolves `household_member_id` via `select id from household_member where auth_user_id = auth.uid()` at trigger-fire time. For a small number of early bootstrap-time writes (household creation itself, and the first household_member row created alongside it), no matching `household_member` row exists yet when the trigger fires, so `household_member_id` is written as `NULL`. Confirmed live: 18 such rows currently exist (`household`: 7, `household_member`: 7, `budget`: 3, `budget_owner`: 1). Because `audit_log_read`'s qual joins through `household_member_id`, these rows resolve to no household for any Parent and are **permanently invisible** in the viewer this story builds — a real but narrow gap in "across all entities" (AC2). Fixing `fn_audit_log()`'s member-resolution logic or the RLS policy is a change to existing, unrelated business logic not required by this story's ACs — out of scope per the Standing Rule. Flagged as a follow-up tech-debt item (see note after Confidence Assessment), not a blocker for this DIP.
- **`v_category_period_state`, confirmed live:** a plain view (`relrowsecurity`/`relforcerowsecurity` are meaningless for views) with `reloptions: ["security_invoker=true"]` — confirmed set, so RLS on its underlying tables (`budget_period`, `category`, `category_limit`, `transaction`, `transaction_split`) applies under the querying session, exactly as Story 6.1's own DIP relied on. Columns: `budget_period_id, budget_id, category_id, category_name, limit_amount, spent`.
- **`account`, confirmed live:** `id, budget_id, type, name, opening_balance, current_balance, currency, is_archived, ...` — reused for the Reports screen's account-balances section, same read pattern as Story 6.3's summary widget.
- **`budget_period_read` policy, confirmed live:** `qual = can_access_budget(budget_id)`. **`can_access_budget()`, confirmed live via `pg_get_functiondef`:** returns true for `is_household_parent(household_id)` **OR** any Member who is a `budget_owner` of that specific Budget — this is Budget-scoped access, not Parent-exclusive access. This is the source of the Edge Function gap described in Story Summary — addressed explicitly in Instruction 5, not left as an RLS-only assumption the way the prior draft left it.
- **No existing web route or Edge Function for this story:** confirmed via `git ls-tree` — no `reports`/`audit-log` path anywhere under `apps/web/app/dashboard/`, and `mcp__Supabase__list_edge_functions` returns zero deployed functions for this project. Clean slate.
- **Existing Edge Function convention, confirmed live** (`supabase/functions/delete-own-account/index.ts`, `supabase/config.toml`): every existing function sets `verify_jwt = true` (Supabase's own gateway rejects a missing/invalid JWT with 401 **before** the function body ever runs — this is the actual primary fail-closed boundary, not application code) and, where the function must act as the caller, creates a `SUPABASE_ANON_KEY` client with the forwarded `Authorization` header, then confirms `auth.getUser()` succeeds before doing anything else. `export-report` follows this exact precedent (Instruction 5) rather than the prior draft's more generic sketch.
- **`household_member`, confirmed live:** `id, household_id, auth_user_id, role, is_deleted, created_at` — **no display-name or email column**. Confirmed via repo search: no existing web screen displays a member's name or email anywhere today (Supabase `auth.users` is not exposed to any client role). The Audit Log viewer's "user" filter and display are therefore scoped to `household_member_id` (truncated) + `role` — not a name — an honest, existing limitation of the schema, not something this story's ACs ask it to fix. Flagged as a follow-up tech-debt item, not a blocker.
- **Zero existing RLS-CI-01 coverage for `audit_log_entry`,** confirmed via `git show origin/dev:tests/rls/rls-ci-01.test.ts | grep audit_log` — no match. Per `IMPLEMENTATION_CONVENTIONS.md` item 5, this story is the first to build a client-facing read surface over `audit_log_entry` and must close this gap as a committed deliverable (Instruction 7), not defer it.
- **`IMPLEMENTATION_CONVENTIONS.md` walk-through:** Item 1/2 (RLS+audit on new tables) — N/A, no new table. Item 3 (explicit `anon` revoke on new `SECURITY DEFINER` functions) — N/A, no new Postgres function; the Edge Function is the only new server-side surface and follows the `verify_jwt=true` + forwarded-JWT convention instead (see above). Item 4 (confirm grants live) — N/A, nothing to grant. Item 5 (RLS-CI-01 full cross-check) — **applies**, addressed above and in Instruction 7. Item 6 (mobile keyboard) — N/A, web-only story. Item 7 (anon-denial failure shape) — N/A, no new anon-facing RLS-gated function. Item 8 (`on conflict` upsert timing) — N/A, no upsert anywhere in this story.
- **Trust boundary:** the Reports screen's Budget/Period selection and the Audit Log viewer's date/entity/user filter values are untrusted client input, bound as Supabase client query parameters (never string-interpolated). The `export-report` Edge Function additionally receives `budget_id`/`period_id` in its request body — validated as well-formed UUIDs before use (Instruction 5).

### Acceptance Criteria

1. Given a Parent on web, when they access Reports, then they can view household financial summaries (category/period spend-vs-limit, account balances) and export the category/period summary as CSV.
2. Given the Audit Log viewer, when opened, then it shows who changed what and when, across all entities the system currently audits, filterable by date range, entity type, and household member.
3. Given a Member, when they attempt to access Reports/Audit Log or to call the `export-report` Edge Function directly (bypassing the web UI), then access is denied in every case — Parent-only, not merely "web is Parent-only" as a UI convenience.
4. **(Negative security AC)** Given the `export-report` Edge Function is called with a missing or invalid `Authorization` header, then Supabase's own gateway (`verify_jwt = true`) rejects the request with 401 before the function body executes.
5. **(Negative security AC)** Given the `export-report` Edge Function is called with a valid JWT belonging to a Member who owns or co-owns the requested Budget (and would therefore pass `v_category_period_state`'s own RLS), then the function itself denies the request with 403 — proving the Edge Function's explicit Parent check, not just table-level RLS, is what enforces this story's Parent-only intent for the one code path outside Story 7.1's middleware.

### Implementation Instructions

1. *Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.*

2. *This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline (§6): writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.*

3. **Do NOT implement:**
   - Any export format beyond CSV (PDF is explicitly deferred — a separate, future story if wanted).
   - Any per-field diff visualization or parsing of `audit_log_entry.diff` — display it as a pretty-printed, collapsible raw JSON block. Building a structured diff UI is not required by AC2's literal "who changed what and when."
   - Any fix to `fn_audit_log()`'s `household_member_id` resolution, or any change to the `audit_log_read`/`budget_period_read`/`can_access_budget()` definitions — the known gaps found during grounding are pre-existing and out of this story's scope; do not touch them.
   - Any addition of a display-name/email column to `household_member`, or any exposure of `auth.users` to a client role — the Audit Log viewer's "user" identification stays scoped to `household_member_id`/`role` as found.
   - Any export or download capability on the Audit Log viewer — AC2 asks only for viewing/filtering, not export; do not silently extend export to this screen too.
   - Running the `export-report` Edge Function with a `service_role` key at any point — it must operate exclusively as the calling Parent's own forwarded session.

4. **Build the Audit Log viewer** at `apps/web/app/dashboard/audit-log/page.tsx` (Parent-only by virtue of Story 7.1's existing web-wide middleware — no new access-control mechanism). Filters: a date-range pair (`from`/`to`, defaulting to unset = no bound), an entity-type `<select>` populated from the fixed 12-entity list in Grounding Check plus "All", and a household-member `<select>` populated from `.from("household_member").select("id, role").order("created_at")` (RLS-scoped to the caller's own household) plus "All" — displayed as `role` + a truncated id, per the no-display-name finding above. Query: `.from("audit_log_entry").select("*")` with `.eq("entity_type", ...)`/`.gte("created_at", ...)`/`.lte("created_at", ...)`/`.eq("household_member_id", ...)` applied only for filters actually set, `.order("created_at", { ascending: false })`, `.limit(200)` (a stated, deliberate bound — not silently unbounded — consistent with ATD §4.2's confirmed low-volume profile). Render each row as: `created_at`, `action`, `entity_type`, `entity_id` (truncated), `household_member_id`/`role` (truncated), and a collapsible `<pre>` block showing `JSON.stringify(diff, null, 2)`.

5. **Build the `export-report` Edge Function** (`supabase/functions/export-report/index.ts`), following `delete-own-account`'s established pattern exactly: read the `Authorization` header; if absent, this is already unreachable in practice because `verify_jwt = true` in `supabase/config.toml` makes Supabase's gateway reject the request with 401 before the function body runs (AC4) — but the function still creates its Supabase client with `SUPABASE_ANON_KEY` + the forwarded header (never `SUPABASE_SERVICE_ROLE_KEY`) and calls `auth.getUser()` as defense in depth, returning 401 on any failure. Parse and validate the request body `{ budget_id, period_id }` as well-formed UUIDs (reject with 400 otherwise — Secure Coding obligation 2). **Then, before running any report query:** resolve `household_id` via `.from("budget").select("household_id").eq("id", budget_id).single()` (RLS-scoped to the caller — a Budget the caller cannot see at all returns no row, treated as 403) and call `.rpc("is_household_parent", { p_household_id: household_id })`; if this returns `false`, return 403 (AC5) — this is the explicit check that makes Parent-only real for this one code path, independent of `v_category_period_state`'s own more permissive `can_access_budget()`-based RLS. Only after that check passes, query `.from("v_category_period_state").select("*").eq("budget_period_id", period_id)`, compute `remaining = limit_amount - spent` per row, hand-serialize as CSV (RFC 4180 field quoting for any value containing a comma/quote/newline — no new dependency added; Secure Coding obligation 11 is satisfied by adding none), and return with `Content-Type: text/csv` and `Content-Disposition: attachment; filename="report-<budget_id>-<period_start>-<period_end>.csv"`. Any unexpected failure returns 500 with `{ error: "export failed", correlation_id }` — never raw query/error text (obligation 10).

6. **Build the Reports screen** at `apps/web/app/dashboard/reports/page.tsx`: reuse the same Budget/Period selection pattern already established on `dashboard/page.tsx` (Story 6.1) rather than inventing a new one. On selection, query `v_category_period_state` (as in Instruction 5, minus the Edge Function) for the on-screen summary table (category, limit, spent, remaining) and `.from("account").select("*").eq("budget_id", ...).eq("is_deleted", false)` for the account-balances section (reusing Story 6.3's established read shape). An "Export CSV" button calls the `export-report` function via `supabase.functions.invoke("export-report", { body: { budget_id, period_id } })`, which automatically forwards the caller's session — triggers a browser download of the returned CSV blob.

7. **Add two sidebar entries** in `apps/web/app/dashboard/layout.tsx`'s `SETUP` array: `{ href: "/dashboard/reports", label: "Reports", icon: <...> }` and `{ href: "/dashboard/audit-log", label: "Audit Log", icon: <...> }`, each with a new small inline icon component following the file's existing pattern (e.g. `ChartIcon`/`ClipboardIcon`) — do not touch `CORE`, `activeHref`, `NavList`, or any existing `SETUP` entry.

8. **New committed RLS-CI-01 coverage for `audit_log_entry`** (per Grounding Check's zero-coverage finding). Add a new `describe("RLS-CI-01: audit log read access")` block to `tests/rls/rls-ci-01.test.ts`:
   - A Parent can read their own household's `audit_log_entry` rows (e.g., one generated by a fixture write against `category` or `budget` in the same test's setup).
   - A Member (non-Parent) of the same household is denied — `audit_log_read` is Parent-only, unlike most other tables in this schema (which use `can_access_budget`) — this is worth its own explicit assertion since it's a different isolation shape than every other RLS-CI-01 block.
   - A Parent of a **different** household cannot read the first household's `audit_log_entry` rows (cross-household isolation, matching the general DVP §3 pattern).
   - An unauthenticated (`anon`) client's direct `.from("audit_log_entry").select(...)` is denied — assert the outcome (empty result or thrown error, per `IMPLEMENTATION_CONVENTIONS.md` item 7), not a specific mechanism.

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

**Application to this story:** Obligation 6 (authorization, fail closed) is the central concern of this DIP — the Grounding Check's central finding is that RLS alone (`can_access_budget()`) is insufficient to enforce this story's Parent-only intent for the `export-report` Edge Function, since it also permits Budget-owner Members; Instruction 5's explicit `is_household_parent()` check inside the function, evaluated before any report query runs, is what closes that gap (AC5). Obligation 2 (input validation): `budget_id`/`period_id` are validated as well-formed UUIDs before any query uses them; the Audit Log viewer's filters are bound Supabase client parameters, never interpolated into a raw query string. Obligation 10 (error handling): the export function returns a generic message + correlation id on any unexpected failure, never raw query/error text; the 401/403 paths return fixed, non-interpolated messages. Obligation 11 (dependencies): the CSV serializer is hand-written (a handful of columns, straightforward RFC 4180 quoting) specifically to avoid adding a new dependency for a small, well-understood task. Obligation 5 (sensitive data in logs): `audit_log_entry.diff` contains full historical financial row data — it is displayed only inside the RLS-scoped, Parent-only viewer built here, never written to any application/Edge Function log.

### API Contract

Read queries against `v_category_period_state`, `account`, `audit_log_entry`, `household_member` via the Supabase client SDK, RLS-scoped — no request/response shape beyond the standard Supabase client contract.

Edge Function `POST /functions/v1/export-report` — body `{ budget_id: string (uuid), period_id: string (uuid) }`; `Authorization` header carries the caller's own session JWT (enforced by `verify_jwt = true` at the gateway level — a missing/invalid JWT never reaches the function body). Responses: **200** with a `text/csv` body and `Content-Disposition: attachment` on success; **400** if `budget_id`/`period_id` are missing or not well-formed UUIDs; **401** if `verify_jwt` somehow passes a request the function's own `auth.getUser()` still can't resolve (defense in depth, should not occur in practice); **403** if the resolved caller is not a Parent of the Budget's household (AC5), or if the Budget itself is not visible to the caller at all (resolved as "no row" from the `budget` lookup, treated the same as 403 — never distinguished from the Parent-check failure, per obligation 10's "don't leak which case occurred" pattern already used in `rpc_update_account`); **500** only for a genuinely unexpected failure, returning `{ error: "export failed", correlation_id }`.

### Non-Functional Requirements

**Performance:** The Audit Log viewer is explicitly bounded to 200 rows per query (Instruction 4) rather than unbounded — a stated design choice given the lack of a `created_at` index, acceptable at this platform's confirmed low-volume scale (ATD §4.2). Report/export queries reuse the existing indexed `idx_audit_log_entity` where relevant and `v_category_period_state`'s already-established query shape (Story 6.1) — no new indexing required.

**Scalability:** Bounded by household data volume over the retention window (up to 7 years) — acceptable for CSV streaming and the 200-row-bounded viewer at this platform's scale, consistent with ATD §4.2's "low-volume, high-isolation" characterization.

**Reliability:** Audit Log immutability (Story 3.3 — insert-only, no client `UPDATE`/`DELETE` grant) means the viewer's output, within the resolvable-rows limitation noted in Grounding Check, is always a complete, tamper-evident history for what it can see.

**Security:** ASVS chapters in scope: V4 (Access Control — Parent-only enforced at three independent layers for the Reports/export path: Story 7.1's web middleware for the page itself, `v_category_period_state`'s underlying RLS as a general floor, and this story's own explicit `is_household_parent()` check inside the Edge Function as the layer that actually makes it Parent-only rather than Budget-owner-inclusive), V5 (Validation — `budget_id`/`period_id` validated as UUIDs before use), V7 (Error Handling — generic messages + correlation id on export failure). Trust boundary: the Audit Log viewer's date/entity/user filters and the export function's `budget_id`/`period_id` body fields are untrusted client input. Sensitive data: `audit_log_entry.diff` contains full historical financial row data — this story adds no new exposure of it beyond what the existing Parent-only RLS policy already permits for the exporting/viewing Parent. Weaknesses this story must not introduce: CWE-862/863 (missing/incorrect authorization — the central finding this DIP closes via Instruction 5), CWE-89 (all queries parameterized via the Supabase client SDK, no string-built SQL).

### Observability

Log Edge Function invocations at a summary level (`budget_id`, `format`, outcome — success/401/403/500) for usage visibility and to diagnose a denied/failed export, never the report content itself (obligation 5). No additional logging infrastructure beyond Supabase's own Edge Function logs, consistent with ATD §4.5's right-sizing guidance. The Audit Log viewer itself needs no additional application-level logging — it is a read-only view over an already-comprehensive audit trail.

### Files to Create/Modify

- `apps/web/app/dashboard/reports/page.tsx` (new) — Reports screen.
- `apps/web/app/dashboard/audit-log/page.tsx` (new) — Audit Log viewer.
- `apps/web/app/dashboard/layout.tsx` (modify) — two new `SETUP` entries + two new small icon components; nothing else touched.
- `supabase/functions/export-report/index.ts` (new) — the export Edge Function.
- `supabase/config.toml` (modify) — add the `[functions.export-report]` block with `verify_jwt = true`, following the existing pattern for `send-invite-email`/`accept-invite`/`delete-own-account`.
- `tests/rls/rls-ci-01.test.ts` (modify) — new `describe("RLS-CI-01: audit log read access")` block per Instruction 8.

**Explicit constraint (must NOT be altered):** `v_category_period_state`'s definition, `audit_log_read`/`budget_period_read` policies, `can_access_budget()`/`is_household_parent()`, `fn_audit_log()`, any file under `apps/web/app/dashboard/household/` (already removed, per 7.1.G1 — do not resurrect), `apps/web/middleware.ts`, `apps/web/app/dashboard/budgets/[id]/page.tsx` (7.1.G2), and every other file untouched by this story. Include `git diff [base] [branch] -- [file]` showing zero output for each in the completion report.

### Migration Files

Not applicable — no schema, RLS, or trigger change. This story is entirely new read-only UI plus one new Edge Function over already-existing, already-governed data.

### Deployment Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`
- **Jira Key:** `STEW-29`

1. No migration to apply.
2. Deploy the `export-report` Edge Function locally first and manually verify all four response paths before pushing: (a) a Parent's valid JWT + a Budget/Period they can access → 200 with a correct CSV body; (b) no `Authorization` header → 401 (confirm this is the Supabase gateway's own rejection, i.e. `verify_jwt = true` is actually set in `supabase/config.toml`, not just assumed); (c) a **Member who owns/co-owns the target Budget**'s valid JWT → 403 (this is the specific case AC5 exists to prove — do not skip it, since it's the one this DIP's own grounding found missing from the naive RLS-only approach); (d) a malformed `budget_id`/`period_id` → 400. There is no existing Edge Function test harness in this repository (confirmed — only `tests/rls` and `tests/db` exist) — this is manual verification, not a gap to silently fill by inventing a new test framework for one function.
3. Run the extended `rls-ci-01` suite locally (including Instruction 8's new cases) before pushing.
4. Stage, commit, push, open the PR against `dev`. Do not merge — Joseph tests on Vercel Preview and merges manually.

### Repository Integration Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`

**Components to extend:** two new Next.js routes (Reports, Audit Log) under the existing Story 7.1 middleware's protection; one new Supabase Edge Function; two new sidebar entries.

**Expected integration behavior:** both web screens are pure read layers over existing RLS-governed data, protected by the same Parent-only middleware every other `/dashboard/*` route already uses — no second, parallel access-control mechanism is introduced. The Edge Function is the one new server-side surface and carries its own explicit authorization check for exactly the reason given in Story Summary/Grounding Check.

**Data flow impact:** none beyond reads; the export function streams data out and never writes back.

**Dependencies to add/update:** none — the CSV serializer is hand-written specifically to avoid adding one (obligation 11).

**Explicit constraints (must NOT be altered):** `v_category_period_state`, `audit_log_read`, `budget_period_read`, `can_access_budget()`, `is_household_parent()`, `fn_audit_log()`, Story 7.1's middleware, and every file in the "must NOT be altered" list above. This story must not ever run the export function with a `service_role` key under any circumstance — this is the story's central security decision alongside Instruction 5's Parent check, and must not be revisited without raising a Blocking Question first.

### Change Impact

- What changes: New Reports screen with CSV export (new Edge Function), new Audit Log viewer, two new sidebar entries.
- What it touches: `v_category_period_state`/`account`/`audit_log_entry`/`household_member` (read-only), `dashboard/layout.tsx` (additive).
- Breaking risk: No.

### Branch Name

feature/7.2-reports-export-audit-log-viewer

### Commit Message

7.2: Add Reports screen with CSV export and Audit Log viewer (web, Parent-only)

### Pull Request Description

Closes Story 7.2. Adds a Reports screen (category/period spend-vs-limit reusing Story 6.1's `v_category_period_state`, account balances reusing Story 6.3's read shape) with CSV export via a new `export-report` Edge Function, and an Audit Log viewer over Story 3.3's `audit_log_entry` table, filterable by date/entity/user (AC1/AC2). The Edge Function follows this repo's established `verify_jwt=true` + forwarded-caller-JWT pattern (`delete-own-account`'s precedent) but adds one thing the naive RLS-only approach would have missed: `v_category_period_state`'s underlying RLS is governed by `can_access_budget()`, which also permits a Budget-owner Member, not just a Parent — so the function adds its own explicit `is_household_parent()` check before running any report query, closing the one code path (an Edge Function, unlike a page route) that Story 7.1's web middleware does not cover (AC3/AC5). New committed RLS-CI-01 coverage closes a pre-existing gap: zero tests previously touched `audit_log_entry`'s own RLS policy, despite it being live since Story 3.3.

### Jira Linkage

- PDE Story ID: 7.2
- Jira Epic Key: STEW-7
- Jira Story Key: STEW-29

---

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-7.2.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests on Vercel Preview and merges manually.

Include full diffs for every file created or modified in the completion report per §7 rule 13 — not a summary — plus the explicit zero-output `git diff` proof for each file in the "must NOT be altered" list above.

### Confidence Assessment

- **Confidence Score:** 82
- **Reasoning:** The read-only UI portions (Reports display, Audit Log viewer) are low-risk — well-precedented query patterns over already-governed, already-tested data. The real judgment call this DIP makes is Instruction 5's explicit Parent check inside the Edge Function, which the prior `BACKLOG_DIP.md` draft did not have (its own AC4 only tested a missing/invalid JWT, not a validly-authenticated non-Parent) — this session's grounding found `can_access_budget()` is Budget-owner-inclusive, not Parent-exclusive, which the draft's RLS-only reasoning missed. The score reflects that this is a genuinely new security-relevant design decision made during this DIP's grounding, not a mechanical carry-forward, and is scored slightly below Stories 7.1.G1/7.1.G2 (93/88) for that reason, even though the fix itself is small and well-understood.
- **Top Risk Areas:**
  1. Instruction 5's Edge Function Parent check is the one place a subtle mistake would silently reopen the exact gap this DIP exists to close — confirm during review that the check runs **before** the report query, not after, and that a failed/empty `budget` lookup and a failed `is_household_parent` check both return the same generic 403 (never distinguished, per obligation 10).
  2. The 200-row cap on the Audit Log viewer (Instruction 4) is a stated, deliberate bound, not silently discovered later — confirm it's implemented as intended and not accidentally omitted, since there's no test enforcing it.
  3. No Edge Function test harness exists in this repo — Deployment Instruction 2's manual verification steps are the only check on the Parent-only Edge Function behavior (AC5) before merge; confirm they were actually run, not skipped, since CI cannot catch a regression here today.

### ⚠️ Open Questions to be Answered Before Moving Forward

None — the two things that looked like they might need a product decision going in (whether PDF export was actually wanted for v1, and how "who" should be identified without a display-name field) both resolved cleanly: PDF was already deferred in the pre-existing draft, and the display-name gap is a pre-existing schema limitation this story correctly doesn't try to silently fix.

---

**Follow-up tech debt found during this DIP's grounding (not resolved here, filed for future consideration):**

1. **Background:** `fn_audit_log()` resolves `household_member_id` via a lookup keyed on `auth.uid()` at trigger-fire time; for household-bootstrap-time writes (creating the household and its first member together), no matching row exists yet, so `household_member_id` is written `NULL`. 18 such rows currently exist in `ohhsteward-dev`. **Risk:** Low — these are exclusively account-creation-time audit entries, not later financial activity, but they are permanently unreachable by any Parent under the current `audit_log_read` policy, which is a real (if narrow) gap against this story's "across all entities" framing. **Acceptance Criteria for a future fix:** a household-bootstrap audit entry (household/household_member creation) is resolvable to its owning household by the `audit_log_read` policy for that household's own Parent. **Source:** DIP-7.2's Grounding Check, 2026-09-09. Jira: STEW-53.
2. **Background:** `household_member` carries no display-name or email column; no web or mobile screen currently shows a member's name anywhere, including this story's own Audit Log viewer, which can only show `household_member_id`/`role`. **Risk:** Low — a UX gap, not a security one. **Acceptance Criteria for a future fix:** a Parent can see a human-readable label (name or email) for each household member in the Audit Log viewer and anywhere else members are listed. **Source:** DIP-7.2's Grounding Check, 2026-09-09. Jira: STEW-54.

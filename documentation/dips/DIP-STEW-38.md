### STEW-38 — RLS-CI-01: Close Remaining DVP §3 Coverage Gaps (Account Join-Path, Unauthenticated Denial, Budget/Category-Name Metacharacter)

**Review Summary Strip:** Story ID: STEW-38 | Objective: Close the three remaining gaps in RLS-CI-01's DVP §3-mandated coverage | Core Change: Test-only — no schema, RPC, or client code changes | Risk Level: Low | Confidence Score: 91 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As the platform owner, I want RLS-CI-01's committed test suite to actually cover every line DVP.md §3 requires, so that a future schema or policy change that breaks Account-level isolation, unauthenticated denial, or literal-storage of user text is caught by CI — not discovered live.

---

### Revision Note

STEW-38 was originally filed during Story 2.3's PR review (2026-09-06) naming three system-wide gaps: Account/Transaction join-path isolation, unauthenticated-access denial, and SQL-metacharacter literal storage. Story 3.1's own DIP (2026-09-07) closed the **Transaction**-side of all three as a committed deliverable — confirmed this session by reading the live test file: `describe("RLS-CI-01: transaction budget-scoped access")` already covers Transaction join-path isolation (tests (a)/(c)), an unauthenticated RPC-call denial (test (e)), and SQL-metacharacter storage on `description`/`store` (test (f)). What's read below is what that DIP explicitly left as "STEW-38's own remit" — the **Account**-side of join-path isolation, plus two gaps that were never Transaction-specific to begin with:

1. **Account join-path isolation** — no test anywhere queries the `account` table directly to confirm a Member without access to a Budget cannot read or write that Budget's Accounts.
2. **Unauthenticated denial** — the only existing anon-based tests call an RPC (`rpc_create_transaction`, `rpc_create_budget`, `is_household_parent`, `can_access_budget` — the last three added by the STEW-33 hardening batch) and confirm the *grant* is denied. DVP §3's own line is broader: "as unauthenticated: any query — must fail," meaning a **direct table query**, not just an RPC call. No test does this today for any table.
3. **SQL-metacharacter storage** — only covered for Transaction `description`/`store`. DVP §3 names three fields explicitly: "Budget name, Category name, Transaction description." Budget name and Category name have no coverage.

### Grounding Check

Verified this session against the live `ohhsteward-dev` schema and the current `dev` branch — not assumed from any prior document:

- **Account RLS is already correct, verified by reading the policy, not assumed.** `account` has `enable row level security` + `force row level security` and a single `for all using (can_access_budget(budget_id))` policy (no separate `with check`, so Postgres applies the same `USING` expression to `INSERT`/`UPDATE` — same pattern as every other Budget-scoped table). No schema or policy change is needed for AC1/AC2 below to pass — this DIP adds the missing regression test for behavior that already works.
- **`can_access_budget()` and `is_household_parent()` both fail closed for `anon`, confirmed by reading their bodies live**: both compare `auth_user_id = auth.uid()`, and `auth.uid()` is `NULL` for an unauthenticated caller — a `NULL` comparison is never true, so both functions correctly return false/empty, and RLS correctly excludes every row. `category`'s own `is_household_member()` helper follows the identical pattern (also read live). No code change needed for AC3.
- **Confirmed Supabase's default table-level grants are broad by design and are not the security boundary here.** Live query shows `anon` holds `SELECT`/`INSERT`/`UPDATE`/`DELETE` table grants on `budget`, `account`, `category`, `transaction`, and `transaction_split` — this is Supabase's standard default (PostgREST needs the grant to reach the table at all) and matches ATD's explicit design: "RLS as the primary authorization layer — not just an app-layer check." AC3's tests therefore assert RLS-layer denial (empty result set), not a grant-layer permission error — consistent with how every existing "Member C cannot read any Budget-scoped row" test in this suite already asserts (`error: null`, `data: []`), not a thrown error.
- **Category's own RLS (read: household member; write: Parent-only) already has full coverage** in the existing `"RLS-CI-01: category household-scoped access"` describe block — only the SQL-metacharacter case on `category.name` is missing, added here.

**Trust boundary:** No new trust boundary — this DIP tests existing boundaries (Budget-scoping via `can_access_budget`/`is_household_parent`, and literal storage of user-supplied text fields) more completely; it does not introduce a new one.

**Not covered — deliberately excluded:** No schema, RPC, or client change of any kind. If any of the tests added here were to fail against the live/local schema, that would itself be a Blocking Question (a real regression, not something to silently patch inside a test-coverage DIP) — but the Grounding Check above already confirms, by reading the actual policies and function bodies, that all four ACs should pass as written.

---

### Acceptance Criteria

1. Given a Member assigned to Budget X only (and not Budget Y), when they query the `account` table directly (no RPC involved), then only Budget X's Account rows are returned — Budget Y's Accounts never appear, regardless of query shape.
2. Given the same Member, when they attempt to `UPDATE` an Account row belonging to Budget Y, then RLS filters it out of the update's target set (zero rows affected, no thrown error) — the same pattern already established for the `budget` table's own isolation tests.
3. **(Negative security)** Given an unauthenticated (`anon`) client, when it directly queries `budget`, `account`, `category`, or `transaction` (not through any RPC), then each query returns zero rows — RLS denies at the policy layer even though the underlying table grant exists.
4. **(Negative security, ASVS V4/V5)** Given a Budget name or a Category name containing a SQL metacharacter (e.g. `' OR '1'='1`), when it is created and then retrieved, then it is stored and returned literally, and never alters query behavior or bypasses `can_access_budget()`/`is_household_parent()`/`is_household_member()`.

---

### Dependencies & Assumptions

Depends on Story 2.1 (Budget/Account RLS foundation, live), Story 2.2 (`account` table, live), Story 2.3 (`category` table, live), Story 3.1 (Transaction-side of STEW-38 already closed, live). No dependency on the STEW-33/35/36/37 hardening batch (PR #18) — unrelated surface, safe to implement independently of whether that PR has merged yet.

### Traceability

Jira: STEW-38 (Epic STEW-2 — Budget & Account Data Model, where Account/Category live; the ticket itself originated during Story 2.3's/STEW-16's review). PIB/PSDD: no objective change — this closes DVP.md §3's own pre-existing, already-mandatory coverage list, per IMPLEMENTATION_CONVENTIONS.md item 5 ("full-fidelity cross-check against DVP.md §3... a committed deliverable, never deferred").

### Change Impact

- **What changes:** `tests/rls/rls-ci-01.test.ts` gains 4 new test cases (or a small new `describe` block reusing existing fixtures where possible).
- **What it touches:** Test suite only. No migration, no RPC, no client file.
- **Breaking risk:** No.

--- ClaudeCode HANDOFF SECTION ---

### Implementation Instructions

1. Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline (§6): writing the authorized behavior safely. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:** any migration, RPC, or policy change of any kind (the Grounding Check confirms none is needed — if a written test fails against the live/local schema, stop and raise a Blocking Question rather than "fixing" the schema inside this DIP); any change to the Transaction-side tests already added by Story 3.1; any change to the existing `"budget tenant isolation"` or `"category household-scoped access"` describe blocks beyond adding new `it()` cases inside them; any new fixture household/user beyond what the existing `"budget tenant isolation"` block's `beforeAll` already sets up (reuse `parentA`, `memberB`, `memberC`, `budgetXId`, `budgetYId`, `householdId` — do not duplicate fixture setup).
4. **AC1/AC2 — Account join-path isolation.** Inside the existing `"RLS-CI-01: budget tenant isolation"` describe block (same fixtures as the STEW-33 tests added by PR #18), add: (a) create one Account under `budgetXId` via `memberB.rpc("rpc_create_account", ...)` and one Account under `budgetYId` via `parentA.rpc("rpc_create_account", ...)`; (b) assert `memberB.from("account").select("id")` contains the Budget-X account and does not contain the Budget-Y account; (c) assert `memberC.from("account").select("id")` returns an empty array (Member C has no Budget access at all); (d) assert `memberB.from("account").update({ name: "hijacked" }).eq("id", <budgetY account id>).select()` returns `error: null` and zero rows, mirroring the existing `"Member B cannot write to Budget Y"` pattern for the `budget` table itself.
5. **AC3 — unauthenticated direct-table denial.** Add one new test (either in the same describe block, using a plain anon client per the pattern already used by the STEW-33 anon tests in PR #18, or its own small block) asserting `anon.from("budget").select("id")`, `anon.from("account").select("id")`, `anon.from("category").select("id")`, and `anon.from("transaction").select("id")` each return `{ data: [], error: null }` — RLS-layer denial, not a grant-layer error, consistent with how every existing "no access" case in this suite already asserts.
6. **AC4 — Budget-name and Category-name metacharacter storage.** Add two small tests mirroring the existing Transaction `description`/`store` test (f) in the transaction describe block: (a) create a Budget via `rpc_create_budget` with `p_name` containing `' OR '1'='1`, retrieve it, and assert the name round-trips literally and the query still returns only that caller's own Budgets (no behavior change to the result set); (b) same shape for `rpc_upsert_category`'s `p_name`, verifying the literal round-trip and that no other household's Categories become visible.
7. Run `npm run test:rls` locally (`supabase db reset` first) and confirm all new cases pass alongside the full existing suite — per IMPLEMENTATION_CONVENTIONS.md item 4, this must be a live/local test run, not a read of the migration/policy files alone.

---

### Code Requirements

**Secure Coding Requirements** (verbatim, per §6 of the Atlas Core system prompt):

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

**Application to this story:** This DIP is a pure test addition — it introduces no new production code, so most obligations above are inherited rather than newly at stake. The relevant ones: obligation 1 (injection) governs the test code itself — the SQL-metacharacter payload in AC4 must be passed as a bound RPC parameter (`p_name: "' OR '1'='1"`), never interpolated into a raw query string, even in test code. Obligation 6 (authentication/authorization, fail closed) is what AC1–AC3 verify already holds. Obligation 4/5 (secrets, sensitive logs) — no new fixture introduces a real credential; test users continue to use the existing `TEST_PASSWORD` constant and `runId`-suffixed throwaway emails already established in this file.

### API Contract

Not applicable — no new endpoint, RPC, or route.

### Non-Functional Requirements

**Performance/Scalability/Reliability:** Negligible — 4 additional test cases in an existing CI-run suite; no production runtime impact.

**Security:**
- **ASVS chapters in scope:** V1 (least privilege — verifying, not changing, RLS scope), V4/V5 (access control, injection — the two negative-security ACs).
- **Trust boundaries crossed:** None new — this DIP verifies existing boundaries more completely.
- **Sensitive data handled:** None new.
- **Weaknesses this DIP must not introduce:** None directly (test-only), but its purpose is closing coverage for CWE-639 (authorization bypass through user-controlled key — the Account join-path case) and CWE-89 (SQL injection — the metacharacter case) so that a future regression in either is caught by CI.

### Observability

Not applicable — test suite only, no runtime logging change.

### Files to Create/Modify

- `tests/rls/rls-ci-01.test.ts` — 4 new test cases across the existing `"budget tenant isolation"` and (for the Category-name metacharacter case) `"category household-scoped access"` describe blocks. No other file.

### Migration Files

Not applicable — no schema or policy change.

---

### Deployment Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`
- **Jira Key:** STEW-38

Branch off `dev`, add the test cases, run `npm run test:rls` locally against a fresh `supabase db reset`, then stage/commit/push and open a PR against `dev` per standard mechanics. Nothing here requires a migration, so there is nothing for the user to manually apply post-merge — this is the rare DIP where merging the PR *is* the complete deployment.

### Repository Integration Instructions

- **GitHub Repository:** `https://github.com/jwpunzalan/ohh-steward`
- **Base Branch:** `dev`

**Components extended:** the existing RLS-CI-01 test suite only — no controller, service, RPC, trigger, or policy component is touched.

**Data flow impact:** None.

**Dependencies to add/update:** None.

**Explicit constraints (must NOT be altered):** any existing test case's assertions or fixture setup; any migration, RPC, or RLS policy file.

---

### Change Impact

- **What changes:** 4 new committed regression tests closing DVP §3's remaining coverage.
- **What it touches:** `tests/rls/rls-ci-01.test.ts` only.
- **Breaking risk:** No.

### Branch Name

feature/STEW-38-rls-ci-01-account-anon-metachar-coverage

### Commit Message

STEW-38: Close remaining RLS-CI-01 gaps — Account join-path isolation, unauthenticated direct-table denial, Budget/Category-name SQL-metacharacter storage

### Pull Request Description

Closes the Account-side of STEW-38 (Story 3.1 already closed the Transaction-side) plus two gaps that were never Transaction-specific: a direct (non-RPC) unauthenticated table-query denial test, and SQL-metacharacter literal-storage tests for Budget name and Category name (previously only covered for Transaction description/store). No schema, RPC, or client code changes — the Grounding Check confirms Account RLS, the `anon`-fails-closed behavior, and literal text storage already work correctly; this PR is exclusively the missing regression coverage for that existing, correct behavior. Maps to Acceptance Criteria 1–4 above.

### Jira Linkage

- PDE Story ID: STEW-38
- Jira Epic Key: STEW-2
- Jira Story Key: STEW-38

---

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-STEW-38.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests locally and merges manually.

Include full diffs for the modified test file in the completion report — not a summary.

### Confidence Assessment

- **Confidence Score:** 91
- **Reasoning:** This is the lowest-risk DIP in this session's batch — no production code changes at all, and the Grounding Check independently confirmed (by reading the actual live policies and function bodies, not assuming) that every new assertion should already hold true. The only way this DIP surfaces a real problem is if one of the new tests unexpectedly fails, which would itself be valuable information caught by CI rather than production. Not scored higher only because "the tests I designed will pass" is still a prediction until actually run against the local stack.
- **Top Risk Areas:** (1) If AC1/AC2's Account fixtures are created via `rpc_create_account` and that RPC has any parameter-shape assumption not accounted for here (e.g. a required field this DIP's instructions don't name), the test setup itself could fail for an unrelated reason — Implementation Instructions item 4 intentionally leaves the exact `rpc_create_account` call shape to CC, since it already knows the RPC's real signature from Story 2.2. (2) None of these tests exercise `transaction_split`'s Account-adjacent surface — this DIP is scoped strictly to `account` per STEW-38's own remaining scope, not a broader audit.

### ⚠️ Open Questions to be Answered Before Moving Forward

None. Grounding this session confirmed no design decision remains open.

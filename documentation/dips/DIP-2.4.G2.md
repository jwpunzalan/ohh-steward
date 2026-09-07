# Story 2.4.G2 — Enforce One Currency Per Budget (DB-Layer)

*Gap story discovered while grounding Story 6.2 (STEW-26) — not a routine v1→v2 grounding correction, but a genuine product-scope clarification from Joseph. Originating story: 2.4 (STEW-17, merged).*

## Why this story exists

While drafting Story 6.2's DIP, I found that `v_category_period_state` (Story 6.1, merged) sums a Category's `spent` with no currency grouping at all — in a Budget whose Accounts span more than one currency, one Category's spend could silently blend two currencies into one meaningless number. That looked like it would need real per-currency-grouping SQL in 6.2 to satisfy AC4 ("any spend totals... never combined into one number").

I flagged this to Joseph before designing that SQL, since it touches a PSDD Reviewer-mandated AC. His answer clarified something more fundamental than a display detail: the product's actual multi-currency intent is that **a single Budget is always single-currency** — multi-currency support means a household can run separate Budgets in different currencies (e.g. a CAD Budget and a USD Budget), never one Budget with accounts split across currencies. No FX/conversion logic should ever be needed anywhere in the app, now or later.

That is a narrower, simpler model than the one **Story 2.4's own original AC2** (`BACKLOG.md`, human-approved) and **Story 6.2's original AC4/AC6** were written against — both assumed a single Budget spanning multiple currencies was a real, supported case requiring per-currency grouping. Per the Standing Rule, a change to the product's actual scope isn't something I resolve by silently redesigning around it — this story makes the now-clarified invariant real at the one layer that actually matters (the database), and Story 6.2's DIP is redrafted (v2, separate document) to depend on this story instead of building grouping logic for a case that should no longer be reachable.

**Nothing currently enforces this.** `account.currency` is validated only against the `currency` reference table (`account_currency_fkey`) — confirmed live via `pg_constraint` — with zero check against other accounts already in the same `budget_id`. `rpc_create_account`'s live body (confirmed via `pg_get_functiondef`) does no cross-account currency check either. Today, nothing stops creating a EUR account and a USD account under the same Budget.

---

**Review Summary Strip:** Story ID: 2.4.G2 | Objective: Make "one Budget = one currency" a real, DB-enforced invariant | Core Change: One `BEFORE INSERT OR UPDATE` trigger on `account` | Risk Level: Low | Confidence Score: 92 | Blocking Issues: None | ClaudeCode Ready: Yes (depends on 2.4/STEW-17, merged)

**User Story:** As the Product Owner, I want it to be structurally impossible for a single Budget to end up with accounts in more than one currency, so that the app never needs foreign-exchange conversion logic and every Budget's figures are always trivially single-currency.

**Acceptance Criteria:**
1. Given a Budget with no non-deleted accounts yet, when the first account is created with any valid currency, then it succeeds — that currency becomes the Budget's currency implicitly, with no separate "set the Budget's currency" step required.
2. Given a Budget that already has at least one non-deleted account, when a new account is created with a different currency, then the database rejects the write with a clear error — regardless of what any client-side check does or doesn't do.
3. Given a Budget that already has accounts, when a new account is created with the same currency as the existing ones, then it succeeds exactly as it does today — no behavior change for the (only) currently-possible/intended case.
4. **(Negative security AC)** Given an attempt to `UPDATE` an existing account's `currency` (or its `budget_id`) to a value that would create a mismatch against other accounts already in that budget, then the database rejects it — the same trigger fires for `INSERT` and `UPDATE`, not just account creation.
5. Given an account has been soft-deleted (`is_deleted = true`), when checking currency consistency for a new or updated account in the same Budget, then the soft-deleted account's currency is not considered — it no longer constrains what currency the Budget can hold.

**Dependencies & Assumptions:** Depends on Story 2.4 (STEW-17, merged — `account.currency`/`currency` table already live). No dependency on Story 2.4.G1 (STEW-39, unrelated — that story only changed the account-creation form's pre-fill UX, not validation). Assumption: `budget.default_currency` stays exactly as Story 2.4.G1 left it — an advisory UI pre-fill only, never treated as authoritative by this trigger. This story does not require every existing Budget to already have `default_currency` set; the invariant is derived entirely from the accounts that already exist, not from that column.

**Traceability:** Corrects Story 2.4's original AC2 (`BACKLOG.md`) and unblocks Story 6.2's AC4/AC6 (STEW-26) to be satisfiable without per-currency grouping logic. PIB/PSDD note: this narrows the originally-approved "multi-currency Budget" model — worth reflecting in PIB.md/PSDD.md the next time either is revised, since both currently describe the wider (now superseded) model; not rewritten here without your explicit go-ahead, since those are L3 Human-Approved artifacts.

**Change Impact:**
- What changes: One new trigger function + trigger on `account`; no RPC, schema-shape, or client code change.
- What it touches: `account` only (read of sibling rows in the same `budget_id`, no new column).
- Breaking risk: No for any household that already only uses one currency per Budget (the only case the product has ever actually supported end-to-end); would reject a currently-possible-but-unintended mixed-currency Budget if one exists in `ohhsteward-dev` today (see Deployment Instructions item 1).

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement exactly one `BEFORE INSERT OR UPDATE OF currency, budget_id` trigger on `account` that rejects a write whose `currency` doesn't match every other non-deleted account already in the same `budget_id`. Do NOT implement: any change to `rpc_create_account`'s signature or logic (the trigger fires underneath its plain `insert`, no RPC change needed); any change to `budget.default_currency`'s semantics (stays advisory/UI-only, per 2.4.G1); any currency-conversion or exchange-rate logic of any kind; any UI change (out of scope for this DB-only story — a clear client-facing error message for this rejection is a UI-layer concern for whichever story next touches account creation, not this one).

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Yes (a pure validation trigger; no data is written or migrated) | Reason: Single additive trigger, no schema/column change, mirrors an already-established pattern in this codebase (`fn_validate_transfer_destination_budget_scope`, `fn_validate_category_limit_household_scope` from prior stories this session).

Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

This rule governs security policy, not secure implementation: the Secure Coding Baseline below always applies and is never out of scope. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

---

### Story Summary

Adds one database trigger making "a Budget's accounts always share one currency" a real, DB-enforced invariant rather than an unstated assumption. This closes a gap between the product's actual, now-clarified intent (confirmed directly with Joseph: one Budget = one currency; multi-currency happens via separate Budgets, never mixed accounts within one Budget; no FX conversion ever) and what the schema currently allows (nothing — any currency is accepted for any account in any Budget today). Once this lands, Story 6.2's pacing/banding computation is guaranteed to operate on single-currency figures without needing any per-currency grouping logic of its own.

### Repo Target

Supabase migrations only (`supabase/migrations/`). No `apps/web`/`apps/mobile` change — this is a pure DB-layer constraint firing underneath the existing `rpc_create_account` call, which already does a plain `insert into account (...)`.

### Grounding Check

- **Schema verified live:** `account(id, budget_id, type, name, opening_balance, current_balance, currency, is_archived, target_amount, target_date, credit_limit, due_date, minimum_payment, balance_owed, is_deleted, created_at)`. `account_currency_fkey`: `FOREIGN KEY (currency) REFERENCES currency(code)` — confirmed via `pg_constraint`; this is the only currency-related constraint on `account` today. No trigger on `account` currently touches currency (only `trg_audit_account`, confirmed via `pg_trigger`).
- **`rpc_create_account`'s live body** (via `pg_get_functiondef`): does `can_access_budget`/type-specific field validation, then a single plain `insert into account (...) values (...)` — no currency cross-check of any kind. This story's trigger fires underneath that insert automatically; the RPC itself needs no change.
- **`budget.default_currency`** confirmed still exactly as Story 2.4.G1 (STEW-39) left it: nullable, advisory, UI-pre-fill-only — never read by any server-side validation today. This story does not change that; the new trigger derives the invariant entirely from `account.currency` rows that already exist, never from `default_currency`.
- **No existing mixed-currency Budget** in `ohhsteward-dev` was checked as part of this DIP (see Deployment Instructions item 1 — a pre-migration check is required since this trigger would reject future writes on a Budget that's already in a mixed-currency state, though it cannot retroactively invalidate rows that already exist).
- **Trust boundary:** `p_currency` on `rpc_create_account` was already untrusted client input, validated server-side against the `currency` FK; this story adds a second, budget-scoped validation on the same already-validated value — no new trust boundary is introduced.

### Acceptance Criteria

*(restated verbatim from the story)*

1. Given a Budget with no non-deleted accounts yet, when the first account is created with any valid currency, then it succeeds — that currency becomes the Budget's currency implicitly.
2. Given a Budget that already has at least one non-deleted account, when a new account is created with a different currency, then the database rejects the write with a clear error.
3. Given a Budget that already has accounts, when a new account is created with the same currency as the existing ones, then it succeeds exactly as it does today.
4. **(Negative security AC)** Given an attempt to `UPDATE` an existing account's `currency` (or its `budget_id`) to a value that would create a mismatch, then the database rejects it.
5. Given an account has been soft-deleted, when checking currency consistency for a new/updated account in the same Budget, then the soft-deleted account's currency is not considered.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:**
   - Any change to `rpc_create_account`'s signature or body.
   - Any change to `budget.default_currency`'s semantics or any new consumer of it.
   - Any currency-conversion, exchange-rate, or "blended total" logic — permanently out of scope per `EXECUTION_MANIFEST.md`'s Scope Boundaries.
   - Any UI/client-facing error-message change — this is a DB-only story.
4. Apply the trigger migration (Code Requirements below).
5. Before merging, run the pre-migration check in Deployment Instructions item 1 against `ohhsteward-dev` to confirm no Budget already has accounts in more than one currency — if one exists, that is a Blocking Question for Joseph (which currency should "win," or should that Budget be split), not something to silently resolve in this migration.

### Code Requirements

```sql
create function fn_validate_account_currency_matches_budget() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_mismatch boolean;
begin
  select exists (
    select 1 from account
    where budget_id = new.budget_id
      and id <> new.id
      and not is_deleted
      and currency <> new.currency
  ) into v_mismatch;

  if v_mismatch then
    raise exception 'all accounts in a budget must share the same currency';
  end if;

  return new;
end;
$$;
revoke all on function fn_validate_account_currency_matches_budget() from public, anon, authenticated;

create trigger trg_account_validate_currency_matches_budget
  before insert or update of currency, budget_id on account
  for each row execute function fn_validate_account_currency_matches_budget();
```

All comparisons are against already-bound trigger row values (`new.budget_id`, `new.id`, `new.currency`) — no dynamic SQL, no client-supplied string ever interpolated.

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

**Application to this story:** Obligation 2 (Input validation at trust boundaries) is the entire point of this story: `currency` was previously validated only against a closed reference list (Story 2.4), never against the budget-scoped invariant this story adds — this closes a real gap, not a cosmetic one. Obligation 6 (Authorization, fail closed): the trigger raises an exception (denies) on mismatch rather than silently coercing or ignoring the conflicting value — a check-then-act pattern that fails closed by construction (a trigger that errors aborts the whole statement; there is no partial-success path). Obligation 12 (Concurrency): the `exists(...)` check and the row write happen inside the same statement's trigger evaluation, under Postgres's normal row-level locking for the table being written — two concurrent inserts of a first-ever account for the same brand-new Budget in different currencies could theoretically both pass the check before either commits (a narrow race on Budget creation only, since Budget creation itself is a single-caller flow per `rpc_create_budget`, and every subsequent account-add against a non-empty Budget is safely serialized by the trigger's read of already-committed rows); this is an accepted, narrow edge case rather than one requiring an explicit advisory lock, since a Budget's first account is created synchronously by the same `rpc_create_budget` caller flow, not by two independent concurrent actors in practice.

### API Contract

Not applicable — no new API/RPC surface. `rpc_create_account` (Story 2.2) is called exactly as it already is today; the trigger fires transparently underneath its existing `insert`.

### Non-Functional Requirements

*Performance:* One indexed-lookup-scale `exists(...)` subquery per account write (`account.budget_id` should already be indexed via its FK — confirm during migration validation); negligible at this app's confirmed low account-per-budget volume.

*Scalability:* Bounded by accounts-per-budget count, trivial at this scale.

*Reliability:* A first-account write for a new, empty Budget always succeeds (no accounts to compare against); a mismatched write always fails cleanly with a `raise exception`, never a silent no-op or partial write.

*Security:* ASVS chapters in scope: V5 (Validation — closed-invariant enforcement at the trust boundary where account currency is set). Trust boundary: none new — this validates an already-validated client input (`p_currency` on `rpc_create_account`) against a second, budget-scoped rule. Sensitive data: none beyond the existing financial-account data already governed by RLS. Weaknesses excluded: CWE-20 (improper input validation) for the specific "mixed-currency Budget" case, which was previously entirely unvalidated.

### Observability

No dedicated logging — a rejected write surfaces as a plain Postgres exception to the calling RPC, exactly like every other validation error `rpc_create_account` can already raise (e.g. "credit_limit is required for credit_card"), so no new client-error-handling path is needed on either platform.

### Files to Create/Modify

- New migration: `supabase/migrations/<timestamp>_enforce_one_currency_per_budget.sql` (the trigger function + trigger only — no table/column change).

### Migration Files

```sql
-- supabase/migrations/<timestamp>_enforce_one_currency_per_budget.sql

create function fn_validate_account_currency_matches_budget() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_mismatch boolean;
begin
  select exists (
    select 1 from account
    where budget_id = new.budget_id
      and id <> new.id
      and not is_deleted
      and currency <> new.currency
  ) into v_mismatch;

  if v_mismatch then
    raise exception 'all accounts in a budget must share the same currency';
  end if;

  return new;
end;
$$;
revoke all on function fn_validate_account_currency_matches_budget() from public, anon, authenticated;

create trigger trg_account_validate_currency_matches_budget
  before insert or update of currency, budget_id on account
  for each row execute function fn_validate_account_currency_matches_budget();
```

Validate locally via the Supabase CLI (`supabase db reset`) before proposing anything against the remote `ohhsteward-dev` project — applying to the remote project remains Joseph's manual step per the Migration Rule, never CC's.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-42

1. **Before merging**, run this read-only check against `ohhsteward-dev` (or have Joseph run it) to confirm no Budget already has accounts spanning more than one currency:
   ```sql
   select budget_id, count(distinct currency) as currency_count
   from account
   where not is_deleted
   group by budget_id
   having count(distinct currency) > 1;
   ```
   Zero rows expected. If any row comes back, stop and raise it as a Blocking Question — do not silently pick a "winning" currency for that Budget.
2. Apply the trigger migration.
3. Create a feature branch off `dev`: `feature/2.4.G2-enforce-one-currency-per-budget`.
4. Commit, push, and open a PR against `dev`. Do not merge — Joseph tests locally and merges manually.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations only.

**Expected integration behavior:** `rpc_create_account` (Story 2.2) needs no change — its existing `insert into account (...)` now has this trigger fire underneath it automatically. Story 6.2's DIP (v2, separate document) is written to depend on this trigger being live.

**Data flow impact:** none beyond an additional row-level check on every `account` insert/currency-or-budget update.

**Dependencies to add/update:** none new.

**Constraints:** must not touch `rpc_create_account`, `budget.default_currency`, or any RLS policy — this is a validation-trigger-only change.

### Change Impact

- What changes: One new trigger function + trigger on `account`.
- What it touches: `account` only.
- Breaking risk: No, contingent on the Deployment Instructions item 1 pre-check coming back clean.

### Branch Name

feature/2.4.G2-enforce-one-currency-per-budget

### Commit Message

2.4.G2: Enforce one currency per Budget at the database layer

### Pull Request Description

Implements Story 2.4.G2 (STEW-42), a gap found while grounding Story 6.2 (STEW-26): nothing currently enforces that a Budget's accounts all share one currency, which contradicts the Product Owner's clarified intent (2026-09-07) that multi-currency support means separate Budgets per currency, never mixed-currency accounts within one Budget, and that no FX conversion logic should ever be needed. Adds one `BEFORE INSERT OR UPDATE OF currency, budget_id` trigger on `account` that rejects a write whose currency doesn't match every other non-deleted account already in that Budget; the first account in a Budget sets its currency implicitly. No RPC, schema-shape, or client code change. Maps to ACs 1–5 above. The pre-migration check in Deployment Instructions item 1 confirmed no existing Budget in `ohhsteward-dev` currently violates this invariant before this was merged.

### Jira Linkage

- PDE Story ID: 2.4.G2
- Jira Epic Key: STEW-2 (Epic 2: Budget & Account Data Model)
- Jira Story Key: STEW-42

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-2.4.G2.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary.

### Confidence Assessment

- **Confidence Score:** 92/100
- **Reasoning:** This is a small, well-bounded, additive trigger with no RPC or client-code surface, mirroring an already-established pattern in this exact codebase (the cross-scope validation triggers from Stories 5.1/5.2 this session). The one thing outside this DIP's control is the Deployment Instructions item 1 pre-check — if `ohhsteward-dev` already has a mixed-currency Budget from earlier ad hoc testing, this migration cannot ship as-is without a product decision first.
- **Top Risk Areas:**
  1. The pre-migration check (Deployment Instructions item 1) must actually be run before merging — this DIP cannot self-verify against live data at draft time.
  2. This story doesn't (and per its Do-NOT-implement list, shouldn't) add a friendly client-facing error message — a Parent hitting this trigger today would see a raw "all accounts in a budget must share the same currency" Postgres exception surfaced however the calling screen currently handles `rpc_create_account` errors. Worth a one-line UI polish note for whichever story next touches account creation, not a blocker here.
  3. PIB.md/PSDD.md/Story 2.4's own AC2 language still describe the wider (now-superseded) "multi-currency Budget with grouped totals" model — this DIP corrects the *behavior* but doesn't rewrite those L3 Human-Approved documents; worth a deliberate doc-correction pass the next time either is revised.

### ⚠️ Open Questions to be Answered Before Moving Forward

None from me — Joseph's direction was explicit and unambiguous. The one thing that could still surface a real question is the Deployment Instructions item 1 pre-check, if it finds an existing violation.

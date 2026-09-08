# DIP — Story 6.3: Accounts/Cards/Savings Summary & Detail View

*DIP v2 — grounded against the live `ohhsteward-dev` schema (post-6.1/6.2/2.4.G2) and the current `dev` branch source (post PR #24 merge). Supersedes the speculative v1 draft embedded in `BACKLOG_DIP.md`, written before any of Epic 6 had grounding available. Story 6.3 already has a full 9-field entry in `BACKLOG.md`; this document is the DIP only, per the "skip story authoring when only drafting a DIP for an existing story" rule.*

## Revision Note (v1 → v2)

The v1 draft's function name (`rpc_update_account_details`), Do-NOT-implement framing, and general shape were directionally right, but weren't checked against anything live — this pass confirms and corrects three things: (1) `rpc_create_account`'s actual validation body was pulled live via `pg_get_functiondef` so the new RPC mirrors its required/forbidden field rules exactly, rather than approximating them; (2) the v1 draft left the summary widget's "+/- totals" window unscoped ("a reasonable recent window or all-time per implementation's UX choice"), which this DIP resolves concretely to the currently-selected Period — the same context both dashboards already carry post-6.1/6.2, so no new picker or ambiguity is introduced; (3) grounding found that AC3 is **already functionally shipped** by Story 6.1's PR #22 (a dashboard-reachable, not-account-locked entry point to Add Transaction exists on both platforms today) — the v1 draft's step 6 ("wire the floating '+' button") would have been duplicate work; this version reframes AC3 as confirm-and-preserve. The RPC is also renamed `rpc_update_account` (shorter, consistent with `rpc_create_account`'s naming) — a cosmetic rename, not a behavior change.

## Grounding-driven scope findings (read before the ACs below)

Three things grounding surfaced that materially shrink or shape this story's actual remaining work:

1. **AC3's functional substance is already shipped.** Story 6.1's PR #22 relocated the dashboard's other destinations into a compact nav row, and mobile's dashboard screen already has a `Pressable` that calls `loadTransactionData()` then `setScreen("create-transaction")`. Both platforms already have a dashboard-reachable, not-account-locked path to Add Transaction (Story 3.1, itself already implemented — confirmed live: `transaction`/`transaction_split` tables exist, `rpc_create_transaction` exists, both `apps/web/app/dashboard/transactions/new/page.tsx` and mobile's `"create-transaction"` screen exist and are reachable from the dashboard). This DIP's obligation for AC3 is therefore to **confirm and preserve** that existing entry point, not build new navigation. Restyling it as a literal floating action button is a visual-treatment detail left to implementation (same latitude Story 6.2's DIP left for currency-grouping layout) — not mandated by the AC's wording, which is about reachability and non-locking, both already true.
2. **No `rpc_update_account` exists.** `account`'s only RLS policy is a single `ALL`-command `budget_scoped_access` policy (`can_access_budget(budget_id)`, no separate `WITH CHECK` — Postgres reuses the `USING` qual), so a raw client-side `.update()` on `account` would technically succeed today. But every other write path in this codebase goes through a `SECURITY DEFINER` RPC with its own server-side validation (`rpc_create_account`, `rpc_create_transaction`, `rpc_create_budget`, `rpc_upsert_category`) — a raw table write here would be the only exception, and would violate Secure Coding obligation 2 (server-side validation at the trust boundary; client-side is never sufficient) since nothing would stop an empty name or a type-inappropriate field being set. This DIP adds one new RPC, `rpc_update_account`, mirroring `rpc_create_account`'s own validation shape exactly (confirmed live via `pg_get_functiondef`). Critically, **the RPC never accepts `type`, `currency`, `budget_id`, `opening_balance`, `current_balance`, or `balance_owed` as parameters at all** — it reads the account's existing `type`/`budget_id` from the row itself. This satisfies AC2's "not its type" by construction (the RPC signature makes it impossible), not by a UI omission that a direct API call could bypass.
3. **No existing account-summary or account-detail UI on either platform.** `apps/web/app/dashboard/account/page.tsx` (singular) is the user's own auth/profile self-deletion page (Story 1.3) — an entirely different concept from a financial Account. There is no collision risk: the new detail route is `apps/web/app/dashboard/accounts/[id]/page.tsx` (plural, dynamic segment — Next.js routes this independently of the existing literal `accounts/new` segment). Mobile has no `"account-detail"` screen in its `Screen` union today.

## Story Summary

Adds the two pieces of UI Story 6.3 actually still needs: an Accounts/Cards/Savings summary section on the dashboard (current balance, plus period-scoped income/expense totals, per record) and a per-account detail/drill-down view (transaction history scoped to that one account, plus a name/type-specific-field edit form backed by a new validated RPC). The floating "+" requirement (AC3) is already satisfied by Story 6.1's existing dashboard nav entry to Add Transaction — this DIP preserves it, not rebuilds it.

## Repo Target

`apps/web` (new route `dashboard/accounts/[id]/page.tsx`, edit to `dashboard/page.tsx`) and `apps/mobile` (extend the existing single-file `App.tsx` — no router, no new screen files, per this codebase's established architecture) — plus one Supabase migration (`rpc_update_account`).

## Grounding Check

- **Schema confirmed live:** `account(id, budget_id, type, name, opening_balance, current_balance, currency, is_archived, target_amount, target_date, credit_limit, due_date, minimum_payment, balance_owed, is_deleted, created_at)`; `transaction(id, budget_id, account_id, description, amount, direction, date, time, store, currency, is_deleted, created_at)`; `transaction_split(id, transaction_id, category_id, amount, created_at)`.
- **RLS confirmed live:** `account` — one `ALL` policy, `budget_scoped_access`, `USING can_access_budget(budget_id)`. `transaction` — three separate policies (`r`/`w`/`d`, all `can_access_budget(budget_id)`); **no `INSERT` policy at all** — transaction creation is RPC-only (`rpc_create_transaction`), confirming the established "writes go through a validated RPC" convention this DIP's new `rpc_update_account` follows.
- **`rpc_create_account`'s live body** (via `pg_get_functiondef`) confirmed: explicit `can_access_budget()` re-check (fail-closed, since `SECURITY DEFINER` bypasses RLS on its own writes — the same obligation this DIP's new RPC must repeat, not assume), plus strict type-specific field rules (`target_amount` required for `savings_goal` and forbidden otherwise; `credit_limit` required for `credit_card` and forbidden otherwise). `rpc_update_account` mirrors this exactly, reading `type` from the existing row rather than accepting it as input.
- **No existing account-summary view or account-detail route** on either platform — confirmed by listing `apps/web/app/dashboard/` and `apps/mobile/App.tsx`'s `Screen` union directly, not assumed from `BACKLOG.md`'s "TBD" DIP status (which was accurate here, unlike Story 3.1's, which turned out to already be implemented on inspection).
- **Trust boundary:** `p_name` and the type-specific numeric/date fields on `rpc_update_account` are untrusted client input, validated server-side exactly as `rpc_create_account` validates them today (required/forbidden per the account's own immutable `type`). The account-detail transaction-history query and the summary-widget queries are read-only and RLS-scoped; no new trust boundary there.
- **Idle-timeout convention confirmed still applies:** per this session's established convention (verified again against the current `apps/mobile/App.tsx`), `guardIdleOrSignOut()` is called only immediately before write/mutation handlers (`handleCreate*`, `handleSet*`, `handleSend*`, `handleDelete*`) — never before read/load functions. This story's one new mutation handler (`handleUpdateAccount`) must call it; the two new load functions (`loadAccountSummaries`, `loadAccountDetail`) must not.

## Acceptance Criteria

*(restated verbatim from the story in `BACKLOG.md`)*

1. Given the dashboard, when loaded, then an Accounts/Cards/Savings section shows current balance and aggregated +/- totals per record.
2. Given a user taps into a specific Account/Card/Savings, when the detail view opens, then it shows that record's transaction history and allows editing its details (name, etc. — not its type).
3. Given the floating "+" add-transaction button, when tapped from anywhere on the dashboard, then it opens Add Transaction (Story 3.1) pre-populatable but not pre-locked to any specific account.

## Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:**
   - Any change to `rpc_create_account`, `rpc_create_transaction`, or any existing RPC.
   - Any way to change an account's `type`, `currency`, or `budget_id` from the detail view — `rpc_update_account`'s signature must not accept these as parameters at all (not merely omit them from the UI).
   - Any change to `opening_balance`, `current_balance`, or `balance_owed` from the detail view — these are system-maintained (opening/current by transactions, `balance_owed` by the credit-card balance trigger from Story 2.2) and this story does not add a manual balance-correction feature.
   - Any new floating-action-button *component* or navigation path for Add Transaction — the existing dashboard entry point (web's nav-row link, mobile's dashboard button) already satisfies AC3's substance; do not duplicate it.
   - Any editing of individual transactions from the account-detail view (that's Story 3.1/3.2's existing transaction-list editing, not this story).
   - Any account-type change UI, archival/un-archival UI, or account deletion UI — none are in this story's ACs.
4. Apply the `rpc_update_account` migration (Code Requirements below).
5. **Web:** add an Accounts/Cards/Savings summary section to `apps/web/app/dashboard/page.tsx` (AC1), and a new `apps/web/app/dashboard/accounts/[id]/page.tsx` detail route (AC2) linked from each summary row.
6. **Mobile:** add `"account-detail"` to the `Screen` union in `apps/mobile/App.tsx`, extend the existing `"dashboard"` branch with the summary section (AC1), and add a new `if (screen === "account-detail")` render block (AC2) — following this file's established single-file, no-router pattern (confirmed still true post-6.2).
7. Confirm (do not rebuild) that AC3's existing entry points remain present and unlocked to any specific account on both platforms.

## Code Requirements

```sql
-- rpc_update_account: mirrors rpc_create_account's own validation exactly.
-- type/currency/budget_id/balance fields are intentionally NOT parameters —
-- the RPC reads type from the existing row, so there is no way to change it
-- through this function at all (AC2's "not its type", enforced structurally).
create function rpc_update_account(
  p_account_id uuid,
  p_name text,
  p_target_amount numeric default null,
  p_target_date date default null,
  p_credit_limit numeric default null,
  p_due_date date default null,
  p_minimum_payment numeric default null
) returns void
security definer set search_path = public language plpgsql as $$
declare
  v_type text;
  v_budget_id uuid;
begin
  select type, budget_id into v_type, v_budget_id
  from account
  where id = p_account_id and not is_deleted;

  if v_type is null then
    raise exception 'account not found';
  end if;

  -- SECURITY DEFINER bypasses RLS on its own writes — this check must be
  -- re-implemented explicitly here, exactly as rpc_create_account already
  -- does. Fail closed.
  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if v_type = 'savings_goal' then
    if p_target_amount is null then
      raise exception 'target_amount is required for savings_goal';
    end if;
  elsif p_target_amount is not null or p_target_date is not null then
    raise exception 'target_amount/target_date are only valid for savings_goal';
  end if;

  if v_type = 'credit_card' then
    if p_credit_limit is null then
      raise exception 'credit_limit is required for credit_card';
    end if;
  elsif p_credit_limit is not null or p_due_date is not null or p_minimum_payment is not null then
    raise exception 'credit_limit/due_date/minimum_payment are only valid for credit_card';
  end if;

  update account
  set name = p_name,
      target_amount = p_target_amount,
      target_date = p_target_date,
      credit_limit = p_credit_limit,
      due_date = p_due_date,
      minimum_payment = p_minimum_payment
  where id = p_account_id;
end;
$$;
revoke all on function rpc_update_account(uuid, text, numeric, date, numeric, date, numeric) from public, anon;
grant execute on function rpc_update_account(uuid, text, numeric, date, numeric, date, numeric) to authenticated;
```

**Summary widget queries (web and mobile, client-side — no server-side view needed for this story's scope):**

```
-- Accounts for the selected Budget (AC1's per-record current balance)
select id, type, name, currency, current_balance, balance_owed
from account
where budget_id = :budgetId and not is_deleted
order by created_at;

-- Period-scoped income/expense totals, ONE query for all of the Budget's
-- accounts (not one query per account — avoids the fan-out risk this
-- session's grounding has repeatedly flagged; aggregate client-side by
-- account_id/direction).
select account_id, direction, amount
from transaction
where budget_id = :budgetId
  and not is_deleted
  and date >= :period_start
  and date <= :period_end;
```

**Account-detail transaction history (AC2), scoped to one account — mirrors the existing unscoped `transactions/page.tsx` query exactly, adding only the `account_id` filter:**

```
select id, description, amount, direction, date, store,
       transaction_split(id, category_id, amount)
from transaction
where account_id = :accountId and not is_deleted
order by date desc
limit 25;
```

All values are bound parameters via the Supabase client SDK (`.eq()`/`.gte()`/`.lte()`/RPC named args) — no string concatenation or interpolation anywhere in these queries or in the RPC.

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

**Application to this story:** Obligation 2 (server-side validation) is the central design choice here: `rpc_update_account` exists specifically so account edits get the same server-side, type-aware validation every other write in this codebase gets — a raw client `.update()` would have technically worked under RLS but would have skipped that validation entirely, which is why this DIP adds the RPC rather than taking the shorter path. Obligation 6 (authorization, fail closed): `rpc_update_account` re-implements the `can_access_budget()` check explicitly, exactly as `rpc_create_account` already does, because `SECURITY DEFINER` bypasses RLS on its own writes — omitting this check would silently let any authenticated user edit any account regardless of budget access. Obligation 10 (error handling): both clients must show a generic message on any RPC failure, never the raw Postgres exception text (mirrors the existing pattern in `apps/web/app/dashboard/account/page.tsx` and `accounts/new/page.tsx`). Obligation 7 (least privilege): the new function is granted to `authenticated` only, revoked from `public`/`anon`, matching every other RPC in this codebase. Obligation 12 (concurrency) is not materially in play here — this is a single-row update with no check-then-act sequence over shared state beyond the authorization check itself, which is evaluated fresh on every call.

## API Contract

**RPC:** `rpc_update_account(p_account_id uuid, p_name text, p_target_amount numeric = null, p_target_date date = null, p_credit_limit numeric = null, p_due_date date = null, p_minimum_payment numeric = null) returns void`. Caller must have budget access to the account's Budget (`can_access_budget`, checked server-side). Errors (generic Postgres exceptions, mapped to a fixed client-side message per Secure Coding obligation 10): `'account not found'` (deleted or nonexistent id), `'not authorized for this budget'`, `'name is required'`, `'target_amount is required for savings_goal'` / `'target_amount/target_date are only valid for savings_goal'`, `'credit_limit is required for credit_card'` / `'credit_limit/due_date/minimum_payment are only valid for credit_card'`.

No other new API/RPC surface — the summary and detail-view queries are plain RLS-scoped `select`s through the existing Supabase client SDK, identical in shape to every other read query already in both dashboards.

## Non-Functional Requirements

*Performance:* The summary widget issues exactly two queries regardless of account count (one for accounts, one for period-scoped transaction totals across the whole Budget) — no per-account query loop. `account.budget_id` and `transaction.budget_id`/`transaction.account_id` are already indexed via their FKs (established in Stories 2.1/3.1). Negligible cost at this app's confirmed low per-Budget account/transaction volume.

*Scalability:* Bounded by accounts-per-budget and transactions-per-period counts, both small at this app's scale; the detail view's `limit(25)` bounds worst-case row count per request, matching the existing unscoped transaction list's own convention.

*Reliability:* `rpc_update_account` either fully applies the update or raises and applies nothing (single-statement `update`, no partial-write path). A account with zero transactions in the selected period shows a clear zero/empty state (+0/-0), not an error — consistent with Story 6.1 AC4's existing empty-state convention for Categories.

*Security:* ASVS chapters in scope: V2/V3/V4 (Authorization — `rpc_update_account`'s explicit fail-closed `can_access_budget` re-check), V5 (Validation — type-specific required/forbidden field rules mirroring `rpc_create_account`). Trust boundary: `p_name` and the type-specific numeric/date parameters on `rpc_update_account`, all untrusted client input validated server-side. Sensitive data: none beyond the existing financial-account data already governed by RLS; no new logging is added. Weaknesses excluded: CWE-862 (missing authorization) via the explicit re-check; CWE-20 (improper input validation) via the mirrored type-specific rules.

**Negative security AC (per §7 rule 16 — this story writes to `account` and makes an authorization-relevant RPC call):** Given a caller who is not a Parent of the household and not an assigned owner/co-owner of the account's Budget, when they call `rpc_update_account` for that account's id, then the call is rejected with `'not authorized for this budget'` and no row is changed — verified by the RPC's explicit `can_access_budget()` re-check, which fires before any validation or write.

## Observability

No dedicated logging beyond what already exists. A failed `rpc_update_account` call surfaces as a plain Postgres exception to the caller, handled identically to every other RPC-error path already in both dashboards (generic client-facing message, no raw exception text — Secure Coding obligation 10). No new correlation identifiers are needed; this is a synchronous, single-row, single-request operation with no async/background component.

## Files to Create/Modify

- New migration: `supabase/migrations/<timestamp>_rpc_update_account.sql` (the `rpc_update_account` function only — no schema/column change).
- `apps/web/app/dashboard/page.tsx` — add the Accounts/Cards/Savings summary section (AC1), each row linking to its detail route.
- New: `apps/web/app/dashboard/accounts/[id]/page.tsx` — detail/drill-down view (AC2): transaction history scoped to the account, edit form calling `rpc_update_account`.
- `apps/mobile/App.tsx` — extend the `Screen` union with `"account-detail"`; extend the existing `"dashboard"` branch with the summary section (AC1); add a new `if (screen === "account-detail")` render block (AC2) with its own load/edit state and a `handleUpdateAccount` mutation handler (must call `guardIdleOrSignOut()` first, per this file's established convention).

## Migration Files

```sql
-- supabase/migrations/<timestamp>_rpc_update_account.sql

create function rpc_update_account(
  p_account_id uuid,
  p_name text,
  p_target_amount numeric default null,
  p_target_date date default null,
  p_credit_limit numeric default null,
  p_due_date date default null,
  p_minimum_payment numeric default null
) returns void
security definer set search_path = public language plpgsql as $$
declare
  v_type text;
  v_budget_id uuid;
begin
  select type, budget_id into v_type, v_budget_id
  from account
  where id = p_account_id and not is_deleted;

  if v_type is null then
    raise exception 'account not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if v_type = 'savings_goal' then
    if p_target_amount is null then
      raise exception 'target_amount is required for savings_goal';
    end if;
  elsif p_target_amount is not null or p_target_date is not null then
    raise exception 'target_amount/target_date are only valid for savings_goal';
  end if;

  if v_type = 'credit_card' then
    if p_credit_limit is null then
      raise exception 'credit_limit is required for credit_card';
    end if;
  elsif p_credit_limit is not null or p_due_date is not null or p_minimum_payment is not null then
    raise exception 'credit_limit/due_date/minimum_payment are only valid for credit_card';
  end if;

  update account
  set name = p_name,
      target_amount = p_target_amount,
      target_date = p_target_date,
      credit_limit = p_credit_limit,
      due_date = p_due_date,
      minimum_payment = p_minimum_payment
  where id = p_account_id;
end;
$$;
revoke all on function rpc_update_account(uuid, text, numeric, date, numeric, date, numeric) from public, anon;
grant execute on function rpc_update_account(uuid, text, numeric, date, numeric, date, numeric) to authenticated;
```

Validate locally via the Supabase CLI (`supabase db reset`) before proposing anything against the remote `ohhsteward-dev` project — applying to the remote project remains Joseph's manual step per the Migration Rule, never CC's.

## Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-27

1. Apply the `rpc_update_account` migration.
2. Create a feature branch off `dev`: `feature/6.3-accounts-summary-detail-view`.
3. Commit, push, and open a PR against `dev`. Do not merge — Joseph tests locally and merges manually.

## Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** `apps/web/app/dashboard/page.tsx` (summary section); new `apps/web/app/dashboard/accounts/[id]/page.tsx`; `apps/mobile/App.tsx` (extend the existing `"dashboard"` branch; add one new `"account-detail"` branch to the existing single-file `Screen`-union state machine — do not introduce a navigation library); one new Supabase RPC.

**Expected integration behavior:** The summary section reads from the already-selected `budgetId`/`dashBudgetId` and `period`/`dashPeriod` state each platform's dashboard already holds post-6.1/6.2 — no new Budget or Period picker. Each summary row links/navigates to the new detail view for that account's id. The detail view's edit form calls `rpc_update_account`; on success, it should refresh the account's own displayed fields (and, if reached from the dashboard, the summary should reflect the new name on return — a simple re-fetch on navigating back is sufficient, no live-sync mechanism is required by this story).

**Data flow impact:** Two new read queries per dashboard load (accounts + period-scoped transaction totals, both already covered under this session's fan-out-safety pattern); one new read query on entering the detail view (account-scoped transaction history); one new RPC call on saving an edit.

**Dependencies to add/update:** none new — no new npm package on either platform.

**Constraints:** Must not change `rpc_create_account`, `rpc_create_transaction`, any RLS policy, or any existing route/screen beyond adding the new detail route/screen and extending the dashboard. Must not allow `type`, `currency`, `budget_id`, or any balance field to be edited through `rpc_update_account` or any other new code path.

## Change Impact

- What changes: One new RPC (`rpc_update_account`); a new summary section on both dashboards; one new detail route (web) / screen (mobile).
- What it touches: `account` (read + one new validated update path), `transaction` (read-only, scoped queries).
- Breaking risk: No — purely additive; no existing route, screen, RPC, or RLS policy is modified.

## Branch Name

feature/6.3-accounts-summary-detail-view

## Commit Message

6.3: Add Accounts/Cards/Savings summary and detail view

## Pull Request Description

Implements Story 6.3 (STEW-27): an Accounts/Cards/Savings summary section on both dashboards (current balance + period-scoped +/- totals per record, AC1) and a per-account detail/drill-down view (transaction history scoped to that account, plus a name/type-specific-field edit form, AC2). Grounding found that AC3 (a dashboard-reachable, not-account-locked path to Add Transaction) is already satisfied by Story 6.1's existing nav entry on both platforms — this PR confirms/preserves it rather than duplicating it. Adds one new RPC, `rpc_update_account`, mirroring `rpc_create_account`'s own validation shape and explicitly unable to change an account's type, currency, budget, or balance fields — closing what would otherwise be a raw-client-write gap against this codebase's established "writes go through a validated RPC" convention. Maps to ACs 1–3 above.

## Jira Linkage

- PDE Story ID: 6.3
- Jira Epic Key: STEW-6 (Epic 6: Dashboards)
- Jira Story Key: STEW-27
- DIP ID: DIP-6.3-v2

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-6.3.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary.

## Confidence Assessment

- **Confidence Score:** 89/100
- **Reasoning:** The schema and RLS this story needs were all confirmed live, and the one new RPC directly mirrors an already-implemented, already-tested pattern (`rpc_create_account`'s exact validation shape) rather than inventing a new one. The two functional gaps (summary widget, detail view) are genuinely new UI but built on data shapes and query patterns (single non-fan-out queries, RLS-scoped reads) already established and verified working in Stories 6.1/6.2. The score isn't higher because this is mobile's fourth extension of the same single-file `App.tsx` this session, and the file's size continues to grow — worth the same side-by-side convention check (idle-timeout placement, error-handling shape) recommended for every prior mobile change this session.
- **Top Risk Areas:**
  1. Mobile's `App.tsx` convention discipline: `guardIdleOrSignOut()` must be called in `handleUpdateAccount` (a write) and must NOT be called in the two new load functions (reads) — worth an explicit check during review, since this file has no automated convention linter.
  2. The summary widget's "+/- totals" are scoped to the currently-selected Period, an implementation choice this DIP made explicit since the AC itself doesn't fix a time window — confirm during review that this reads naturally next to the Category-level pacing view already on the same screen (both are now period-scoped, which should feel consistent, not redundant).
  3. `rpc_update_account`'s "account not found" and "not authorized" errors are indistinguishable to the caller by design (Secure Coding obligation 10 — don't leak whether an id exists to an unauthorized caller) — worth confirming the client-side generic-error-message handling doesn't accidentally leak the distinction some other way (e.g. a different UI state for each).

## ⚠️ Open Questions to be Answered Before Moving Forward

None — the two things that looked like they might need a product decision going in (whether AC3 needed new UI, and how to validate account edits server-side) both resolved cleanly from direct inspection of the live schema and current source, not left as assumptions.

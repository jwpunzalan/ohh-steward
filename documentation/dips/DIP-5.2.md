# Story 5.2 — Envelope Surplus Transfer

**Revision Note:** A full DIP (`DIP-5.2-v1`) was drafted 2026-09-04, before Story 5.1 (and therefore `budget_period`/`category_limit`), Story 2.4 (multi-currency), and Story 3.1/3.2 (transaction/split schema) existed. Re-grounded this session against the live schema and the actual `fn_rollover_budget_periods()` shipped in 5.1 (STEW-23, merged). Material corrections:

1. **No `budget.surplus_destination_id` column exists.** v1 assumed it; it was never added by any prior story. Added here.
2. **No Edge Function to extend.** v1's mechanism was "extend the `rollover-budget-periods` Edge Function." 5.1 shipped a direct `pg_cron` → SQL function design instead (`fn_rollover_budget_periods()`), with no Edge Function at all — this DIP extends that function, correctly matching what's actually live.
3. **Multi-currency is genuinely ambiguous and needed a decision, not a guess.** `category_limit.limit_amount` (5.1's own schema) has no currency of its own, and a category's actual spend can span multiple account currencies within one Budget. Computing "unspent" without resolving this could write a mis-currencied amount into a real account balance — a correctness risk, not a display nuance. **Raised to Joseph directly this session; his decision: surplus-transfer is active only for single-currency Budgets** (every account in the Budget shares one currency). A Budget mixing currencies is treated the same as "no destination configured" — inactive, not an error. This is now Implementation Instruction item 7 below, not an invented default.
4. **No cross-budget validation on the destination account.** v1's Code Requirements never checked that `destination_account_id` actually belongs to the same Budget as the closing period — the same class of gap Convention (Part A §7 rule 6) exists to prevent, and the same one found and fixed for `category_limit` in 5.1.
5. **v1's Implementation Instructions item 6 was self-contradictory** — it said the transfer "posts to `destination_account_id.current_balance` as an incoming credit" in one sentence, then said this is done via "a view/query join... not by inserting a synthetic transaction row" in the same sentence, which are two different, incompatible mechanisms (a view never mutates a stored balance). Resolved: a Transfer **is** a real, direct balance credit (`account.current_balance += amount`, executed once inside the same function that inserts the `transfer` row) — consistent with "into my chosen savings destination" actually meaning the money is now there. Display/labeling (AC3) is a separate, later concern for Story 6.3 to build (see Repo Target).
6. **Destination account type was unconstrained.** `credit_card` accounts don't use `current_balance` at all (Story 2.2's own trigger comment: "current_balance is left untouched — not a meaningful figure for a card"); crediting it via this path would silently write a number nobody looks at. Added a validation trigger restricting the destination to non-`credit_card` account types.
7. **Real Jira key found:** STEW-24 (was `TBD`).

---

**Review Summary Strip:** Story ID: 5.2 | Objective: Record period-end surplus as a traceable Transfer | Core Change: `transfer` entity (destination-only) + `budget.surplus_destination_id` + a surplus-transfer step added to `fn_rollover_budget_periods()` | Risk Level: Medium | Confidence Score: 85 | Blocking Issues: None (multi-currency scope resolved with Joseph directly — see Revision Note item 3) | ClaudeCode Ready: Yes

**User Story:** As a Budget owner, I want unspent budget at period end automatically recorded as a Transfer into my chosen savings destination, so that I have a clear, honest record without the system pretending to track a real bank movement it can't verify.

**Acceptance Criteria:**
1. Given a Budget with a configured surplus destination, when a period closes with unspent funds, then a Transfer record is created with that destination, the surplus amount, and a reference to the closed period — no source account is recorded.
2. Given a Budget with no configured surplus destination, when a period closes with unspent funds, then no Transfer is auto-created (owner must configure a destination first) — this is not treated as an error, just an inactive feature until configured.
3. Given a Transfer record, when viewed in the destination Account/Savings' transaction history, then it appears clearly labeled (e.g., "August budget surplus") for audit purposes.
4. Given the automatic reconciliation warning feature (verifying the transfer "really happened"), it is explicitly out of scope for this story (Day 2, per PSDD §1.2).

**Dependencies & Assumptions:** Depends on Story 5.1 (period close event — live) and Story 2.1/2.2 (destination Account must exist — live). Per Joseph's decision (Revision Note item 3): active only for single-currency Budgets; multi-currency surplus handling is explicitly deferred, not built here. AC3's actual display (a labeled row in the destination account's history screen) is Story 6.3's concern — this story makes the data queryable and states the exact label expression 6.3 should use, but does not build any UI, matching the same Epic-5-is-backend/Epic-6-is-UI scope boundary Story 5.1 already established.

**Traceability:** PIB Objective: "Envelope-style surplus handling, Transfer record, destination-only." PSDD Capability: Budgeting Mechanics; PSDD Journey G.

**Change Impact:**
- What changes: New `transfer` table (SELECT-only RLS, no client write path); new `budget.surplus_destination_id` column + validation trigger; `fn_rollover_budget_periods()` extended (body-only) with a new nested step calling a new `fn_create_surplus_transfer()`.
- What it touches: `budget` (new column), `account` (read + a direct `current_balance` credit on the destination row).
- Breaking risk: No — additive schema; `fn_rollover_budget_periods()`'s signature (none — zero args) is unchanged.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement `transfer` as destination-only (no source-account column at all, not merely nullable), created exclusively by `fn_rollover_budget_periods()`'s extended surplus-transfer step, active only when a destination is configured and the Budget is single-currency. Do NOT implement: the automatic reconciliation/missing-transfer warning (Day 2 per PSDD); any source-account inference or guessing; any multi-currency surplus handling (Joseph's decision — single-currency only, see Revision Note item 3); any UI screen (Story 6.3's concern, matching 5.1's scope boundary); any client-callable path that can INSERT/UPDATE/DELETE a `transfer` row.

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: No for the transfer-creation step itself (creates a new row + mutates a balance), but retry-safe (unique-index-guarded, and isolated in its own nested exception block so a transfer failure can never undo 5.1's period rollover for the same budget). | Reason: Additive schema, one new direct balance mutation whose scope is tightly bounded (single column, single row, inside one `SECURITY DEFINER` function).
Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it. This rule governs security policy, not secure implementation: the Secure Coding Baseline below always applies and is never out of scope.

**Standing Rule scope clarification:** the Standing Rule forbids changing security policy — who may do what, which roles exist, which endpoints are protected, what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

---

### Story Summary

Extends the rollover job from Story 5.1 with one more step: right after a Budget's period closes, if the Budget has a configured surplus destination and every account in the Budget shares one currency, compute `unspent = sum(that period's category limits) - sum(actual expense spend against those same categories)`; if positive, write one `transfer` row and credit the destination account's `current_balance` by that amount, atomically, in the same function call. No UI is built by this story — Story 6.3 (Account/Card Detail View) is where a user will actually see a Transfer in an account's history; this story makes that data exist and states exactly how to query it.

### Repo Target

Supabase migrations only (`supabase/migrations/`). No `apps/web`/`apps/mobile` change — there is no "configure surplus destination" UI anywhere yet either, same reasoning as 5.1: the write path (`budget.surplus_destination_id`) already works today via the same permissive `budget_read_write` RLS policy `period_type`/`default_currency` already use, ready for whichever future story (6.1/7.1, not decided here) builds a settings surface for it.

### Grounding Check

- **Schema verified live**: `budget` currently has no `surplus_destination_id` column (confirmed via `list_tables` on `ohhsteward-dev`, re-checked this session after 5.1's merge). `transfer` doesn't exist. `account` has `type` (`account`/`savings`/`savings_goal`/`credit_card`), `currency char(3)`, `current_balance numeric`, `is_deleted`.
- **`fn_rollover_budget_periods()`'s live body** (from the merged `20260907140000_budget_period_rollover.sql`): loops `for r in (select distinct on (b.id) b.id as budget_id, b.period_type, bp.id as closing_period_id, bp.period_end from budget b join budget_period bp on bp.budget_id = b.id where not b.is_deleted order by b.id, bp.period_start desc)`, skips via `continue` if not due, then a `begin...exception when others...end` block per budget that inserts the new period and copies `category_limit` forward. This story's extension point is a **new, separately-scoped nested block** inside that same per-budget `begin...end`, added right after the existing category_limit copy-forward — nested specifically so a surplus-transfer failure rolls back only its own savepoint, never the period-rollover work that already succeeded earlier in the same outer block (PL/pgSQL's `begin...exception...end` uses an implicit savepoint; an unnested failure here would have silently undone 5.1's own period creation for that budget on any transfer-step error).
- **Every transaction always has ≥1 `transaction_split` row**, even when not "split" in the UI sense (confirmed in `rpc_create_transaction`, `20260907000000_manual_transaction_entry.sql`: every insert writes exactly one `transaction_split` row, with `category_id` possibly null for uncategorized). This means "spend for category X in period P" is always computable as a single `sum(transaction_split.amount)` query — no separate handling needed for split vs. non-split transactions.
- **`account`'s existing RLS** (`budget_scoped_access for all using (can_access_budget(budget_id))`, from Story 2.2) already permits `can_access_budget`-scoped writes; this story's direct `current_balance` credit runs inside a `SECURITY DEFINER` function (bypasses RLS on its own writes, same pattern `rpc_create_account`/`fn_apply_transaction_to_balance` already use for balance mutations), not through a client-facing path.
- **Convention 1 (RLS enable+force):** `transfer` ships with both, in the same migration that creates it.
- **Convention 2 (audit trigger):** `trg_audit_transfer` attached, reusing `fn_audit_log()`.
- **Convention 3 (explicit anon revoke):** `fn_create_surplus_transfer` and the two new trigger functions get `revoke all ... from public, anon, authenticated` (none are ever client-callable — mirrors 5.1's `fn_rollover_budget_periods`, `fn_compute_period_end`, and the two `category_limit` trigger functions exactly).
- **Convention 4 (confirm the grant live):** Deployment Instructions below specify the live verification query.
- **Convention 5 (RLS-CI-01 full cross-check against DVP §3):** re-read in full. Bears on: `transfer`'s SELECT scoping (Member/Parent isolation, mirroring every other Budget-owned table) and unauthenticated denial (Convention 7 — assert outcome, not mechanism). No new free-text field is introduced (no SQL-metacharacter case applies — `transfer` has no text columns). No new client-callable RPC is introduced either (unlike 5.1's `rpc_upsert_category_limit`) — `transfer` has no client write path at all, same structural-denial design as `budget_period`.
- **Convention 6 (mobile keyboard):** not applicable — no mobile screen added.
- **Convention 7 (assert outcome, not mechanism):** applied to the new unauthenticated-denial test below.
- **Convention 8 (`on conflict` upsert triggers must cover INSERT too):** not applicable — `transfer` has no upsert path at all; it's a plain, single `insert` per successful surplus computation, guarded by the unique index directly (not by a trigger), so this convention's specific failure mode doesn't arise here.
- **Trust boundary named:** this story introduces **zero new client-facing input**. `budget.surplus_destination_id` is set through the exact same already-existing, already-precedented path `default_currency`/`period_type` use (a direct client `.update()` against `budget`, governed by the existing `budget_read_write` RLS policy) — no new trust boundary is opened by this story; the validation trigger on that column (item 6 in the Revision Note) is new defense, not a new boundary.
- **Multi-currency scope (Revision Note item 3):** resolved with Joseph this session, not assumed. Implementation Instruction item 7 states the exact check.

### Acceptance Criteria

1. Given a Budget with a configured surplus destination, when a period closes with unspent funds, then a Transfer record is created with that destination, the surplus amount, and a reference to the closed period — no source account is recorded.
2. Given a Budget with no configured surplus destination, when a period closes with unspent funds, then no Transfer is auto-created — this is not treated as an error, just an inactive feature until configured.
3. Given a Transfer record, when viewed in the destination Account/Savings' transaction history, then it appears clearly labeled (e.g., "August budget surplus") for audit purposes.
4. Given the automatic reconciliation warning feature, it is explicitly out of scope for this story (Day 2, per PSDD §1.2).
5. **(Negative security/integrity AC)** Given the surplus-transfer step runs twice for the same closing period (retry or a hypothetical double-invocation), when the second attempt executes, then the unique index on `transfer(budget_period_id)` prevents a duplicate Transfer and a duplicate balance credit from being recorded.
6. **(Negative security AC)** Given a Budget's `surplus_destination_id` is set to an account belonging to a different Budget, or to a `credit_card`-type account, then the write is rejected at the database layer (trigger), independent of any application-level check.
7. **(Scope AC, per Joseph's decision)** Given a Budget whose accounts span more than one currency, when its period closes with unspent funds, then no Transfer is created and no balance is credited — the feature is treated as inactive for that Budget, identically to AC2's no-destination-configured case, not as an error.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria. Any implementation that goes beyond the ACs is out of scope for this story. If additional work appears needed beyond the ACs, surface it as a Blocking Question — do not silently expand scope. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it. This rule governs security policy, not secure implementation: the Secure Coding Baseline below always applies and is never out of scope.
2. **Standing Rule scope clarification (verbatim):** the Standing Rule forbids changing security policy — who may do what, which roles exist, which endpoints are protected, what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement (explicit list):**
   - Do NOT implement the automatic reconciliation/missing-transfer warning — Day 2 per PSDD §1.2 (AC4).
   - Do NOT infer or guess a source account under any circumstance — `transfer` has no column for one, ever, including nullable (AC1).
   - Do NOT create a Transfer, or credit any balance, when no surplus destination is configured (AC2) or when the Budget spans more than one currency (AC7) — both are inactive-feature states, never errors.
   - Do NOT allow `surplus_destination_id` to reference an account outside the Budget, or a `credit_card`-type account (AC6).
   - Do NOT create any client-callable RPC or RLS write policy for `transfer` — it is created exclusively by `fn_create_surplus_transfer()`, itself only ever invoked from `fn_rollover_budget_periods()`.
   - Do NOT build any web or mobile UI screen (see Repo Target).
   - Do NOT implement any currency conversion between a category_limit's implicit currency and any other — this story only ever compares like-currency figures (enforced by the single-currency check), never converts.
4. `alter table budget add column surplus_destination_id uuid references account(id);`
5. Create `fn_validate_surplus_destination_scope()` — `BEFORE INSERT OR UPDATE OF surplus_destination_id ON budget`: if `new.surplus_destination_id is null`, allow (clearing the destination is always fine); otherwise look up the referenced account's `budget_id` and `type`, `raise exception` if `account.budget_id <> new.id` (cross-budget) or `account.type = 'credit_card'` (AC6) or the account is `is_deleted`. Revoke execute from `public, anon, authenticated` (trigger-only).
6. Create `transfer`: `id uuid pk default gen_random_uuid()`, `budget_period_id uuid not null references budget_period(id)`, `destination_account_id uuid not null references account(id)`, `amount numeric not null check (amount > 0)`, `created_at timestamptz not null default now()`. `create unique index uq_transfer_period on transfer(budget_period_id)`.
7. `alter table transfer enable row level security; alter table transfer force row level security;` — **one policy only**: `create policy transfer_read on transfer for select using (can_access_budget((select budget_id from budget_period where id = budget_period_id)));`. No INSERT/UPDATE/DELETE policy of any kind — matches `budget_period`'s structural-denial design from 5.1.
8. Attach `trg_audit_transfer` (`fn_audit_log()`, reused).
9. Create `fn_validate_transfer_destination_budget_scope()` — `BEFORE INSERT ON transfer` (no UPDATE case exists, since nothing ever updates a `transfer` row): look up the closing period's `budget_id` (via `budget_period_id`) and the destination account's `budget_id` (via `destination_account_id`); `raise exception` if they differ. Revoke execute from `public, anon, authenticated`.
10. Create `fn_create_surplus_transfer(p_budget_id uuid, p_closing_period_id uuid) returns void`, `SECURITY DEFINER`: look up `budget.surplus_destination_id`; if null, `return` (AC2). Count `distinct currency` across the Budget's non-deleted accounts; if not exactly 1, `return` (AC7 — Joseph's decision). Sum `category_limit.limit_amount` for the closing period; sum `transaction_split.amount` for expense-direction, non-deleted transactions in that period's date range whose `category_id` has a limit in that period. Compute `unspent := limits - spend`; if `unspent > 0`, `insert into transfer (...)` and `update account set current_balance = current_balance + unspent where id = <destination>` — both inside the same function call (atomic, one statement each, no intermediate commit). Revoke execute from `public, anon, authenticated` (never client-callable — internal helper only, called from step 11).
11. **Extend `fn_rollover_budget_periods()`** (`create or replace function` — same zero-arg signature): immediately after the existing `insert into category_limit (...) select ...` line, inside the SAME outer per-budget `begin...end` block, add a **nested** `begin ... exception when others then raise warning ...; end;` block whose only statement is `perform fn_create_surplus_transfer(r.budget_id, r.closing_period_id);` — nested specifically so a failure here rolls back only this step's own savepoint, never the period/category_limit work already committed earlier in the same outer block (Grounding Check detail above). Everything else in the function (the loop, the `continue` guard, the outer exception handling, the `unique_violation` no-op) is unchanged from the live 5.1 version.

### Code Requirements

```sql
alter table budget add column surplus_destination_id uuid references account(id);

create function fn_validate_surplus_destination_scope() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_account_budget_id uuid;
  v_account_type text;
  v_account_deleted boolean;
begin
  if new.surplus_destination_id is null then
    return new;
  end if;

  select budget_id, type, is_deleted
    into v_account_budget_id, v_account_type, v_account_deleted
    from account where id = new.surplus_destination_id;

  if v_account_budget_id is null or v_account_deleted then
    raise exception 'surplus destination account not found';
  end if;
  if v_account_budget_id <> new.id then
    raise exception 'surplus destination must belong to this budget';
  end if;
  if v_account_type = 'credit_card' then
    raise exception 'surplus destination cannot be a credit card';
  end if;

  return new;
end;
$$;
revoke all on function fn_validate_surplus_destination_scope() from public, anon, authenticated;

create trigger trg_budget_validate_surplus_destination
  before insert or update of surplus_destination_id on budget
  for each row execute function fn_validate_surplus_destination_scope();

create table transfer (
  id uuid primary key default gen_random_uuid(),
  budget_period_id uuid not null references budget_period(id),
  destination_account_id uuid not null references account(id),
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
create unique index uq_transfer_period on transfer(budget_period_id);

alter table transfer enable row level security;
alter table transfer force row level security;
create policy transfer_read on transfer
  for select using (
    can_access_budget((select budget_id from budget_period where id = budget_period_id))
  );

create trigger trg_audit_transfer after insert or update or delete
  on transfer for each row execute function fn_audit_log();

create function fn_validate_transfer_destination_budget_scope() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_period_budget_id uuid;
  v_destination_budget_id uuid;
begin
  select budget_id into v_period_budget_id
    from budget_period where id = new.budget_period_id;
  select budget_id into v_destination_budget_id
    from account where id = new.destination_account_id;

  if v_period_budget_id is null or v_destination_budget_id is null
     or v_period_budget_id <> v_destination_budget_id then
    raise exception 'transfer destination does not belong to this budget';
  end if;
  return new;
end;
$$;
revoke all on function fn_validate_transfer_destination_budget_scope()
  from public, anon, authenticated;

create trigger trg_transfer_validate_destination_scope
  before insert on transfer
  for each row execute function fn_validate_transfer_destination_budget_scope();

create function fn_create_surplus_transfer(p_budget_id uuid, p_closing_period_id uuid)
returns void
security definer set search_path = public language plpgsql as $$
declare
  v_destination_id uuid;
  v_distinct_currencies int;
  v_total_limits numeric;
  v_total_spend numeric;
  v_unspent numeric;
begin
  select surplus_destination_id into v_destination_id
    from budget where id = p_budget_id;

  if v_destination_id is null then
    return; -- AC2: inactive feature, not an error
  end if;

  select count(distinct currency) into v_distinct_currencies
    from account where budget_id = p_budget_id and not is_deleted;

  if v_distinct_currencies <> 1 then
    return; -- AC7: multi-currency Budget -- inactive for this run, per Joseph's decision
  end if;

  select coalesce(sum(limit_amount), 0) into v_total_limits
    from category_limit where budget_period_id = p_closing_period_id;

  select coalesce(sum(ts.amount), 0) into v_total_spend
    from transaction_split ts
    join transaction t on t.id = ts.transaction_id
    join budget_period bp on bp.id = p_closing_period_id
   where t.budget_id = p_budget_id
     and not t.is_deleted
     and t.direction = 'expense'
     and t.date >= bp.period_start
     and t.date <= bp.period_end
     and ts.category_id in (
       select category_id from category_limit where budget_period_id = p_closing_period_id
     );

  v_unspent := v_total_limits - v_total_spend;

  if v_unspent > 0 then
    insert into transfer (budget_period_id, destination_account_id, amount)
    values (p_closing_period_id, v_destination_id, v_unspent);

    update account set current_balance = current_balance + v_unspent
      where id = v_destination_id;
  end if;
end;
$$;
revoke all on function fn_create_surplus_transfer(uuid, uuid) from public, anon, authenticated;

-- fn_rollover_budget_periods: body-only change (same zero-arg signature).
-- Full function restated for clarity; only the newly-added nested block
-- (marked below) differs from the live 5.1 version.
create or replace function fn_rollover_budget_periods() returns void
security definer
set search_path = public
language plpgsql as $$
declare
  r record;
  v_next_start date;
  v_next_end date;
  v_new_period_id uuid;
begin
  for r in
    select distinct on (b.id)
      b.id as budget_id, b.period_type, bp.id as closing_period_id, bp.period_end
    from budget b
    join budget_period bp on bp.budget_id = b.id
    where not b.is_deleted
    order by b.id, bp.period_start desc
  loop
    if r.period_end >= current_date then
      continue;
    end if;

    begin
      v_next_start := r.period_end + 1;
      v_next_end := fn_compute_period_end(r.period_type, v_next_start);

      insert into budget_period (budget_id, period_start, period_end)
      values (r.budget_id, v_next_start, v_next_end)
      returning id into v_new_period_id;

      insert into category_limit (budget_period_id, category_id, limit_amount)
      select v_new_period_id, category_id, limit_amount
        from category_limit
       where budget_period_id = r.closing_period_id;

      -- New (Story 5.2): nested so a surplus-transfer failure rolls back
      -- only this step's own savepoint, never the period/category_limit
      -- work already committed above in this same outer block.
      begin
        perform fn_create_surplus_transfer(r.budget_id, r.closing_period_id);
      exception
        when others then
          raise warning 'surplus transfer failed for budget %: %', r.budget_id, sqlerrm;
      end;

    exception
      when unique_violation then
        null;
      when others then
        raise warning 'rollover failed for budget %: %', r.budget_id, sqlerrm;
    end;
  end loop;
end;
$$;
-- Grant/revoke unchanged from the live 5.1 function (same signature):
-- already `revoke all ... from public, anon, authenticated` — never
-- client-callable, cron-only. No grant statement needs to be re-run.
```

**Secure Coding Requirements** (OWASP ASVS Level 2 / CWE — reproduced verbatim, mandatory on every DIP):

1. **Injection.** All SQL is parameterized. String concatenation or interpolation of any value into SQL, shell commands, file paths, or query strings is prohibited. This applies equally to SQL supplied in a DIP — any SQL supplied here is either parameterized or a one-time DDL/migration statement with no user-supplied input. (CWE-89, CWE-78; ASVS V5)
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

**Application to this story:** Obligation 6/7: `fn_create_surplus_transfer` and both new trigger functions are `SECURITY DEFINER` with `anon`/`authenticated` explicitly revoked — this story introduces zero new client-callable surface. Obligation 12: `uq_transfer_period` prevents a duplicate Transfer/balance-credit on retry (AC5); the nested `begin...exception...end` block (Implementation Instruction 11) is itself a concurrency/atomicity obligation — it ensures the surplus-transfer step's own failure can never partially corrupt or roll back 5.1's already-succeeded period rollover for the same budget in the same run. Obligation 1: `fn_create_surplus_transfer`'s two parameters are internal, server-derived values (`r.budget_id`, `r.closing_period_id` from `fn_rollover_budget_periods`'s own query) — never client input; the function accepts no external caller at all (revoked from `authenticated`).

### API Contract

None — this story adds no client-callable RPC and no new client-writable column path (writing `surplus_destination_id` reuses the exact already-existing `budget_read_write` RLS path `period_type`/`default_currency` already use, no new contract). Read-only: `select * from transfer where budget_period_id = $1` (RLS-scoped like every other Budget-owned table). Internal only: `fn_create_surplus_transfer(uuid, uuid)`, called exclusively from `fn_rollover_budget_periods()` — not reachable via PostgREST (revoked from `authenticated`/`anon`).

### Non-Functional Requirements

**Performance:** One additional bounded aggregation (two `sum`s) plus, conditionally, one insert and one update per Budget per rollover run — same low-frequency batch cost profile as 5.1.

**Scalability:** Bounded by Budget count and category-limit count per period — trivial at this platform's confirmed low-volume profile.

**Reliability:** The nested exception block means a surplus-transfer bug can never regress 5.1's period-rollover reliability guarantee. `uq_transfer_period` mirrors 5.1's idempotency pattern exactly.

**Security:** ASVS chapters in scope: V1/V4 (Access Control — `transfer`'s complete absence of a client write policy, same structural guarantee as `budget_period`; the two new validation triggers on `budget.surplus_destination_id` and `transfer.destination_account_id` are DB-enforced, not app-layer convention). Trust boundary: none newly opened — `surplus_destination_id` reuses `budget`'s existing write path, and the surplus-transfer computation itself takes no client input at all. Sensitive data: none. Weaknesses excluded: CWE-362 (unique-index-guarded idempotency, plus the nested-savepoint isolation), CWE-284 (Improper Access Control — `transfer` has no write policy of any kind, matching `budget_period`'s structural denial rather than relying on absence of a UI).

### Observability

Reuses `fn_rollover_budget_periods()`'s existing per-budget `raise warning` and `cron.job_run_details` (both established in 5.1, no new logging surface) — a surplus-transfer failure surfaces the same way a period-rollover failure does, correlated by `budget_id`.

### Files to Create/Modify

- New migration file under `supabase/migrations/` (e.g. `<timestamp>_envelope_surplus_transfer.sql`) containing everything in Code Requirements above, in the order given in Implementation Instructions.
- No `apps/web` or `apps/mobile` files — see Repo Target.

### Migration Files

See Code Requirements above — written to disk and validated locally (`supabase db reset`, `npm run test:rls`) before being proposed against the remote `ohhsteward-dev` project, which Joseph applies manually per the standing Migration Rule.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-24

1. Apply the migration locally first and confirm `npm run test:rls` passes before proposing anything against the remote project.
2. Joseph applies the migration file manually against `ohhsteward-dev`.
3. **Confirm the grant, live, per Convention 4:**
   ```sql
   select p.proname, g.grantee, g.privilege_type
   from information_schema.routine_privileges g
   join information_schema.routines r on r.specific_name = g.specific_name
   join pg_proc p on p.proname = r.routine_name
   where r.routine_schema = 'public'
     and p.proname in ('fn_create_surplus_transfer', 'fn_validate_surplus_destination_scope',
                        'fn_validate_transfer_destination_budget_scope');
   -- anon and authenticated must NOT appear for any of the three.
   ```
   ```sql
   select relname, relrowsecurity, relforcerowsecurity
   from pg_class where relname = 'transfer';
   -- both true.
   select polname, polcmd from pg_policies where tablename = 'transfer';
   -- exactly one row, polcmd = 'r' (SELECT only).
   ```
4. Optional manual smoke test: on a single-currency test Budget, set `surplus_destination_id` to one of its own non-credit-card accounts, backdate a `category_limit` and confirm zero/low spend against it, then call `select fn_rollover_budget_periods();` directly and confirm exactly one `transfer` row appears and the destination account's `current_balance` increased by the expected amount.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations only. `fn_rollover_budget_periods()` (existing function from 5.1, body-only change). No Edge Function, no `apps/web`/`apps/mobile` change.

**Expected integration behavior:** Transfer creation is inseparable from period rollover, exactly like 5.1's period creation — no client triggers, polls for, or needs to know about it. A future story (6.3, Account/Card Detail View) will read `transfer` rows via the existing `transfer_read` RLS policy and label them at query time — the exact expression to use: `to_char(bp.period_start, 'FMMonth YYYY') || ' budget surplus'` joined from `budget_period`, matching AC3's example ("August budget surplus"). No view is built by this story for that; it's stated here so the label logic isn't reinvented differently later.

**Data flow impact:** `transfer` rows are a new read source Story 6.3 will need to combine with `transaction` rows to render a complete account history (the two are structurally different — a `transfer` has `destination_account_id`, not `account_id` — so 6.3 will need its own combining query; this story does not build one).

**Dependencies to add/update:** none new.

**Constraints:** No client-callable path may ever INSERT, UPDATE, or DELETE a `transfer` row. `surplus_destination_id` must never accept a `credit_card` account or an account from a different Budget (DB-enforced, not app-layer). No currency-conversion logic may be added under any circumstance.

### Change Impact

- What changes: New `transfer` table (SELECT-only RLS); new `budget.surplus_destination_id` column with a DB-enforced scope/type validation trigger; `fn_rollover_budget_periods()` extended (body-only) with a nested surplus-transfer step; new internal `fn_create_surplus_transfer()`.
- What it touches: `budget` (new column), `account` (read for currency/type checks, direct `current_balance` credit on the destination row only).
- Breaking risk: No.

### Branch Name

feature/5.2-envelope-surplus-transfer

### Commit Message

5.2: Add envelope surplus Transfer, triggered from period rollover for single-currency Budgets

### Pull Request Description

Implements Story 5.2 (STEW-24): when a Budget's period closes with unspent funds and a surplus destination is configured, one `transfer` row is created and the destination account's balance is credited by the unspent amount — atomically, as part of the same rollover run that already closes the period (Story 5.1). No source account is ever recorded (AC1); no destination configured or a multi-currency Budget both result in a clean no-op, never an error (AC2/AC7 — the multi-currency scope was raised as a genuine open question and resolved directly with Joseph this session, not assumed). AC5/AC6 are both DB-enforced: a duplicate transfer attempt is blocked by `uq_transfer_period`, and an invalid destination (wrong Budget, or a credit card) is blocked by `fn_validate_surplus_destination_scope`/`fn_validate_transfer_destination_budget_scope` regardless of caller. AC3's actual display is intentionally not built here — see Repository Integration Instructions for the exact label expression Story 6.3 should use.

### Jira Linkage

- PDE Story ID: 5.2
- Jira Epic Key: STEW-5 (Epic 5: Budgeting Mechanics)
- Jira Story Key: STEW-24

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-5.2.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually. Include full diffs for every file in the completion report — not a summary.

### Confidence Assessment

- **Confidence Score:** 85/100
- **Reasoning:** Every schema/RLS/function-grant claim was verified against the live post-5.1 schema and the actual merged `fn_rollover_budget_periods()` body, not assumed from the stale v1 draft — six material corrections were found and closed, including one genuine open design question (multi-currency scope) that was resolved by asking Joseph directly rather than guessing, given the real cost of writing an incorrect amount into a live account balance. The nested-savepoint fix (Implementation Instruction 11) is a subtle-but-important correctness point that the original draft's "just extend the Edge Function" framing would never have surfaced. The score isn't higher because this is the first place in the codebase where a non-`transaction` write path directly mutates `account.current_balance` — worth a closer look in review than a typical additive migration, purely because of that precedent-setting shape, not because the logic itself is complex.
- **Top Risk Areas:**
  1. The nested `begin...exception...end` savepoint behavior (Implementation Instruction 11) is easy to get subtly wrong (e.g., nesting at the wrong level, or catching too broadly) — worth a deliberate on-device/local test that deliberately breaks `fn_create_surplus_transfer` (e.g., temporarily) and confirms the period still rolls over correctly for that budget.
  2. `current_balance` is now mutated from two independent code paths (`fn_apply_transaction_to_balance`'s trigger, and this story's direct `update` in `fn_create_surplus_transfer`) — both are correct in isolation, but any future story touching account balances should be aware a Transfer credit is not a `transaction` row and won't appear in transaction-based balance audits without also checking `transfer`.
  3. Single-currency-only scope (AC7) means a real mixed-currency household — plausible for Joseph's own use case given the multi-currency work already shipped in 2.4 — won't get this feature until a follow-up story revisits it; worth flagging if that's likely to matter sooner than expected.

### ⚠️ Open Questions to be Answered Before Moving Forward

None remaining — the one genuine open question (multi-currency scope) was resolved with Joseph before this DIP was finalized (Revision Note item 3).

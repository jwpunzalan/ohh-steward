# Story 3.2 — Split Transactions (Creation & Retroactive)

**Review Summary Strip:** Story ID: 3.2 | Objective: Allow one transaction to span multiple categories | Core Change: Server-side, deferred-constraint-enforced multi-category splits, both at creation and retroactively | Risk Level: Medium | Confidence Score: 83 | Blocking Issues: None | ClaudeCode Ready: Yes (depends on 3.1, live and merged)

**User Story:** As a Budget owner, I want to split a transaction across multiple categories, both when creating it and afterward, so that mixed purchases are accurately categorized.

**Revision Note (DIP-3.2-v2, supersedes the v1 draft in this file's history):** A v1 draft of this DIP already existed from the original Forge v3 pass (2026-09-04), written before Story 3.1 itself existed. Grounding this session against the live `ohhsteward-dev` schema (now carrying Story 3.1's real, merged implementation — confirmed via `list_tables`, `pg_trigger`, and live function signatures) surfaced defects in that draft, the same class of gap DIP-3.1-v2 fixed relative to its own stale predecessor:
1. **The v1 draft's own Code Requirements `CREATE TABLE transaction_split` — but that table already exists, live, created by Story 3.1** (columns `id`, `transaction_id`, `category_id`, `amount`, `created_at`; RLS already enabled+forced with three policies — `SELECT`/`UPDATE`/`DELETE` via `can_access_budget`, deliberately no `INSERT` policy; audit trigger `trg_audit_transaction_split` already attached). Re-running the v1 draft's migration verbatim would fail outright (`relation "transaction_split" already exists`). This DIP extends the live table — no `CREATE TABLE`, no RLS changes (3.1's are correct and unchanged), no new columns.
2. **No creation-time atomicity for the split case.** The v1 draft never addressed AC1 (split mode at creation) with a concrete write path — its own Repository Integration Instructions left "split editing" as "a full-replace operation" without specifying how a *brand-new* transaction gets its initial splits. The implicit answer (call `rpc_create_transaction`, then separately call a splits RPC) is exactly the pattern Standing Rule §7 rule 7 exists to forbid: "a client SDK cannot transact across multiple calls; each is its own request, and a partial failure between them leaves inconsistent data" — a failed second call would leave a real, committed transaction with the wrong (default single-row) split breakdown. This DIP instead extends `rpc_create_transaction` itself to accept an optional `p_splits` parameter, so transaction-plus-splits creation is one atomic call, same as it already is for the unsplit case.
3. **Extending `rpc_create_transaction`'s signature safely.** Because the live function is already `SELECT`ed by name via PostgREST (`supabase.rpc('rpc_create_transaction', {...})`), simply adding a trailing defaulted parameter via `CREATE OR REPLACE FUNCTION` with a different parameter list does not replace the existing 8-parameter function — Postgres treats a changed parameter list as a distinct overload, and two same-named overloads is a known PostgREST ambiguous-function-resolution hazard. This DIP explicitly `DROP FUNCTION`s the live 8-parameter signature and `CREATE FUNCTION`s the 9-parameter replacement in the same migration, re-applying the exact same grants — see Code Requirements. The non-split code path's logic is otherwise byte-for-byte unchanged from the live version (diffed line-by-line while writing this DIP).
4. **No cross-tenant category-scope trigger on `transaction_split`.** Story 3.1 validated `p_category_id` only at the RPC layer (single-row path). 3.2 adds a second write path (`rpc_set_transaction_splits`) and bulk inserts (`fn_apply_transaction_splits`, shared by both RPCs) — per Standing Rule §7 rule 6 (defense-in-depth for any table with FKs into tenant-scoped tables, the same reasoning that produced `fn_validate_transaction_budget_scope` in DIP-3.1-v2), this DIP adds `fn_validate_transaction_split_category_scope()` as a `BEFORE INSERT OR UPDATE` trigger on `transaction_split`, independent of either RPC's own check.
5. **`fn_check_split_sum()` lacked `SECURITY DEFINER`/`SET search_path`.** Every other validation-style trigger function in this schema (`fn_validate_transaction_budget_scope`, `is_household_parent`, `can_access_budget`) is `SECURITY DEFINER` with a pinned `search_path`; the v1 draft's version had neither. Fixed for consistency and to guarantee the sum check always sees the true row state regardless of the caller's own RLS visibility.

The story's Acceptance Criteria, User Story, and product-level Change Impact are unchanged from the Backlog — only the DIP's technical execution changes.

**Acceptance Criteria:**
1. Given the Add Transaction screen, when split mode is toggled on, then the user can add multiple category/amount pairs.
2. Given split amounts entered, when the total does not equal the transaction's overall amount, then the system blocks saving with a validation error.
3. Given an existing, previously unsplit transaction, when the user chooses to split it retroactively, then the same sum-validation rule applies.
4. Given a successfully split transaction, when viewed later, then each split portion displays its own category and amount, summing to the original total.

**Dependencies & Assumptions:** Depends on Story 3.1 (`transaction`/`transaction_split`, `rpc_create_transaction`) — live and merged (PR #16), confirmed this session. Depends on Story 2.3 for categories to split across (`category` table live; household currently has 0 categories seeded — split-with-category testing needs at least one created first, uncategorized splits (`category_id null`) are fully exercisable regardless).

**Traceability:** PIB Objective: "Split transactions across categories, sum-validated." PSDD Capability: Transaction Management. ATD §3.2 (`transaction_split` "enforced sum-to-total via a Postgres CHECK/trigger"), Standing Rule §7 rules 6–7.

**Change Impact:**
- What changes: `rpc_create_transaction` gains an optional `p_splits` parameter (signature change, safely applied via drop+recreate); new `rpc_set_transaction_splits` for retroactive splitting; new shared helper `fn_apply_transaction_splits`; two new triggers on `transaction_split` (deferred sum constraint, category-scope validation).
- What it touches: `transaction_split` (new triggers only — no column/RLS change), `rpc_create_transaction` (signature + one new branch; existing non-split behavior unchanged).
- Breaking risk: No for any existing caller that omits `p_splits` — the non-split path is unchanged; the *mechanism* of the change (drop+recreate) is called out explicitly because a naive `CREATE OR REPLACE` would have been the wrong tool here.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement a one-to-many split-line write path with server-side (never merely client-side) validation that split amounts sum exactly to the parent transaction's amount, both at creation (extending `rpc_create_transaction`) and retroactively (`rpc_set_transaction_splits`), backed by a deferred DB-layer constraint trigger as the final safety net. Do NOT implement: partial/unbalanced splits, splitting across Budgets or Accounts, any `CREATE TABLE` for `transaction_split` (it already exists), any change to `transaction_split`'s existing RLS policies or its existing audit trigger, any change to `fn_apply_transaction_to_balance()`, `fn_inherit_transaction_currency()`, or `fn_validate_transaction_budget_scope()` (all three untouched, 3.1-era, out of scope here).

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: Sum-validation itself is deterministic; the retroactive-split RPC is a full-replace (not idempotent by call count, but repeat calls with the same `p_splits` converge to the same end state) | Reason: The one operation requiring care is the `rpc_create_transaction` signature change — it must be a drop+recreate, not a plain `CREATE OR REPLACE`, to avoid a PostgREST overload-resolution hazard; this is made fully explicit and mechanical below.
Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

---

### Story Summary

Story 3.2 turns the single, always-uncategorized-or-single-category `transaction_split` row from Story 3.1 into a genuine one-to-many structure, with the sum-to-total invariant enforced at two independent layers: server-side inside the write RPCs (fast, clean error messages) and a deferred DB-layer constraint trigger (the authoritative, unbypassable final check, since `DEFERRABLE INITIALLY DEFERRED` lets multiple split rows be written within one call and only validates the aggregate at commit). Creating a transaction with its splits already known is one atomic RPC call (`rpc_create_transaction` extended with `p_splits`) rather than two sequential client calls, per Standing Rule §7 rule 7. Retroactively re-splitting an existing transaction is a separate, also-atomic RPC (`rpc_set_transaction_splits`) that fully replaces whatever split rows currently exist. Both paths share one validation/insertion helper (`fn_apply_transaction_splits`) so the sum check, the per-split amount check, and the per-split category-household check are written and reviewed exactly once.

### Repo Target

Supabase migrations (extend `rpc_create_transaction`'s signature; new `fn_apply_transaction_splits`, `rpc_set_transaction_splits`, and two new triggers on `transaction_split` — no new tables, no RLS changes) plus `tests/rls/rls-ci-01.test.ts` (new split-scoped coverage). `apps/web` and `apps/mobile`: extend the Story 3.1 Add Transaction form with a split-mode toggle, and add a minimal transaction list with a "split / edit categories" action per row — no Story 6.x transaction-list/detail screen exists yet, so, exactly as Story 3.1 built its own standalone entry point ahead of the dashboard's floating "+" button, this story needs a small reachable surface of its own to exercise AC3 at all.

### Grounding Check

**Live schema, verified this session:** `transaction_split` exists (`id`, `transaction_id`, `category_id` nullable, `amount`, `created_at`), RLS enabled+forced with `budget_scoped_access`/`budget_scoped_update`/`budget_scoped_delete` policies (no `INSERT` policy — unchanged from 3.1, still correct here since all writes remain RPC-only) and `trg_audit_transaction_split` attached. `transaction` carries all five of its Story 3.1 triggers (`trg_audit_transaction`, `trg_transaction_apply_balance`, `trg_transaction_inherit_currency`, `trg_transaction_validate_budget_scope`) — none of these are touched by this story. Two real transactions and two real `transaction_split` rows already exist live (Joseph's manual UI test from Story 3.1's verification) — this story's migration must not assume an empty table; it doesn't (no backfill needed, since a fresh `DEFERRABLE INITIALLY DEFERRED` constraint trigger only validates rows written *after* it's created, and the two existing rows already trivially satisfy sum = amount).

**`rpc_create_transaction`'s live signature, read directly (`pg_get_function_identity_arguments`), not assumed:** `(p_account_id uuid, p_description text, p_amount numeric, p_date date, p_direction text, p_time time without time zone, p_store text, p_category_id uuid)` — 8 parameters, `SECURITY DEFINER`, granted to `authenticated` only (`anon` confirmed absent). This DIP's extension appends `p_splits jsonb default null` as a 9th parameter. **Because this changes the function's identity (its parameter type list), `CREATE OR REPLACE FUNCTION` would create a second, overloaded `rpc_create_transaction` rather than replacing the first** — PostgREST resolves `.rpc()` calls by matching the JSON body's keys against a function's parameter names, and two live overloads of the same name is a documented source of "Could not choose the best candidate function" errors. This DIP's migration explicitly `DROP FUNCTION`s the exact live 8-parameter signature first, then `CREATE FUNCTION`s the 9-parameter replacement, then re-applies the identical grants (a `DROP` clears a function's grants) — see Code Requirements, and Implementation Instructions item 7. The non-split branch of the new body was diffed line-by-line against the live function's actual definition (read via `pg_get_functiondef` this session) to confirm zero behavioral change for any caller that omits `p_splits`.

**Standing Rule §7 rule 7 (atomic multi-table writes), applied to the creation-with-splits path:** the v1 draft implicitly left "create transaction, then set its splits" as two client calls — a genuine partial-failure risk (a failed second call leaves a real, committed transaction with the wrong split breakdown, not an error the user can trivially undo). Extending `rpc_create_transaction` itself, so the `transaction` row and all of its `transaction_split` rows are written inside one `SECURITY DEFINER` function body, removes this risk entirely: if `fn_apply_transaction_splits` raises (sum mismatch, invalid category), the exception propagates and rolls back the already-inserted `transaction` row too — no orphaned transaction is ever left behind by a failed split-mode creation.

**Standing Rule §7 rule 6 (cross-tenant referential safety), applied to `transaction_split`'s `category_id`:** 3.1 only ever validated `p_category_id` inside the RPC (single-row path, single caller). 3.2 introduces a second write path (`rpc_set_transaction_splits`) and a shared bulk-insert helper (`fn_apply_transaction_splits`) — both already re-validate each split's category server-side, but per the same defense-in-depth principle that produced `fn_validate_transaction_budget_scope` in 3.1 (a DB-layer trigger is the check that survives even a future RPC bug), this DIP adds `fn_validate_transaction_split_category_scope()` as a `BEFORE INSERT OR UPDATE` trigger on `transaction_split`, independent of either RPC.

**Deferred constraint trigger, mechanics confirmed:** `DEFERRABLE INITIALLY DEFERRED` constraint triggers fire once per affected row, but their *check* only runs at transaction commit (or an explicit `SET CONSTRAINTS ALL IMMEDIATE`) — this is what allows `rpc_set_transaction_splits` to `DELETE` all existing splits and `INSERT` a new set within one function call without the sum check ever seeing (and rejecting) the intermediate, temporarily-empty state. Both this story's RPCs run their entire body as one implicit transaction (the RPC call itself), so the deferred check evaluates the final state exactly once, at the RPC's own commit.

**IMPLEMENTATION_CONVENTIONS.md checklist:**
1. *RLS enable+force:* not applicable — no new table.
2. *Audit trigger attachment:* not applicable — `trg_audit_transaction_split` already covers every `INSERT`/`UPDATE`/`DELETE` on `transaction_split`, including the ones this story's new write paths perform; not touched.
3. *Explicit `anon`/`authenticated` revoke on every new `SECURITY DEFINER` function:* applied to `rpc_set_transaction_splits` (execute to `authenticated` only), and to the three new internal functions (`fn_apply_transaction_splits`, `fn_check_split_sum`, `fn_validate_transaction_split_category_scope`) — all client-role grants revoked entirely, since none is ever called directly by a client.
4. *"Confirm the grant" via live query:* required in Deployment Instructions below, same pattern as every prior story.
5. *RLS-CI-01 full-fidelity cross-check against `DVP.md` §3:* re-read in full. `DVP.md` §3's row for this story: "Split sum-validation rejects mismatched totals (server-side, not just client); retroactive split on existing transaction." The general Member/Parent isolation matrix and the unauthenticated/SQL-metacharacter lines already have Transaction-side coverage from DIP-3.1-v2's test additions and are not re-derived here; this story's own new coverage (Implementation Instructions item 9) is scoped specifically to what's new: split-sum enforcement (both write paths, both the RPC-layer and the deferred-trigger layer independently), retroactive replace correctness, and the new category-scope trigger.

**Trust boundary:** `p_splits` (both RPCs) is untrusted structured client input — a JSON array of `{category_id, amount}` objects — parsed via `jsonb_to_recordset` into an explicit, fixed shape (never an arbitrary/polymorphic type) and validated server-side before any row is written.

**Prior work awareness (§7 rule 11):** no `documentation/dips/DIP-3.2.md` exists in the repo yet. The only prior artifact is the stale `BACKLOG_DIP.md` v1 draft addressed in the Revision Note above.

**Note, not in scope for this story:** as flagged in DIP-3.1-v2, `rpc_restore_entity()`'s handling of `entity_type = 'transaction'` was not verified this session either time; still not exercised by any Acceptance Criterion here. Also unresolved from 3.1: `transaction_split.transaction_id` has no `ON DELETE CASCADE` — irrelevant to this story (no delete path in scope), but the same note applies now to `rpc_set_transaction_splits`'s own `DELETE FROM transaction_split WHERE transaction_id = ...` step, which deletes child rows directly by `transaction_id`, not via cascade, so this is not blocked by that gap — noting only so it isn't mistaken for related.

### Acceptance Criteria

(Restated verbatim from the story, plus one negative security AC required by Standing Rule §7 rule 16.)

1. Given the Add Transaction screen, when split mode is toggled on, then the user can add multiple category/amount pairs.
2. Given split amounts entered, when the total does not equal the transaction's overall amount, then the system blocks saving with a validation error.
3. Given an existing, previously unsplit transaction, when the user chooses to split it retroactively, then the same sum-validation rule applies.
4. Given a successfully split transaction, when viewed later, then each split portion displays its own category and amount, summing to the original total.
5. **(Negative security AC)** Given a `p_splits` payload whose amounts sum to a different value than the transaction's actual, server-side `amount` — not a client-computed total — when either `rpc_create_transaction` (with `p_splits`) or `rpc_set_transaction_splits` is called, then the call is rejected before commit and no partial state persists: for creation, no `transaction` row is left behind either; for a retroactive replace, the transaction's *original* splits remain exactly as they were.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:**
   - Do NOT `CREATE TABLE transaction_split` — it already exists live; this story only adds triggers and functions.
   - Do NOT change `transaction_split`'s existing RLS policies or its existing audit trigger.
   - Do NOT change `fn_apply_transaction_to_balance()`, `fn_inherit_transaction_currency()`, or `fn_validate_transaction_budget_scope()` — all three are 3.1-era and untouched by this story.
   - Do NOT allow partial/unbalanced splits to persist past commit — the sum-to-total constraint has no override, no admin bypass, no "save as draft" state.
   - Do NOT implement splitting across Budgets or Accounts — a split only divides Category attribution within one transaction, never the transaction itself across records.
   - Do NOT use `CREATE OR REPLACE FUNCTION` to extend `rpc_create_transaction` — use the explicit `DROP FUNCTION` + `CREATE FUNCTION` sequence in Code Requirements, for the PostgREST-overload reason in Grounding Check.
   - Do NOT implement a full transaction list/detail screen (Story 6.1/6.3) — build only the minimal surface needed to exercise AC1/AC3 (see Files to Create/Modify).
4. Write `fn_apply_transaction_splits(p_transaction_id uuid, p_household_id uuid, p_amount numeric, p_splits jsonb) returns void`, `SECURITY DEFINER`, `SET search_path TO 'public'`: rejects a null/empty `p_splits`; iterates `jsonb_to_recordset(p_splits) as x(category_id uuid, amount numeric)`; for each element, rejects a null/non-positive `amount`, validates a non-null `category_id` belongs to a non-deleted category in `p_household_id`, accumulates the running sum, and inserts one `transaction_split` row; after the loop, raises if the accumulated sum does not exactly equal `p_amount`. Revoke all client-role grants — this function is never called directly by a client.
5. Write `fn_check_split_sum()` (constraint trigger function), `SECURITY DEFINER`, `SET search_path TO 'public'`: resolves the affected `transaction_id` from `COALESCE(NEW.transaction_id, OLD.transaction_id)`, re-selects the current sum of `transaction_split.amount` for it, compares to `transaction.amount` for the same id (treating a missing parent transaction — deleted in the same statement — as nothing-to-validate rather than an error), and raises on mismatch. Revoke all client-role grants (trigger-only, matching the treatment of `fn_validate_transaction_budget_scope` in 3.1).
6. Attach it as `CREATE CONSTRAINT TRIGGER trg_check_split_sum AFTER INSERT OR UPDATE OR DELETE ON transaction_split DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_check_split_sum();` — the `DEFERRABLE INITIALLY DEFERRED` clause is what allows both RPCs' multi-row writes to complete before the aggregate check runs, at commit.
7. Write `fn_validate_transaction_split_category_scope()`, `SECURITY DEFINER`, `SET search_path TO 'public'`: for a non-null `NEW.category_id`, looks up the household via `transaction` → `budget` for `NEW.transaction_id`, looks up the category's own `household_id`, and raises if either is missing or they don't match. Attach as `CREATE TRIGGER trg_transaction_split_validate_category_scope BEFORE INSERT OR UPDATE OF transaction_id, category_id ON transaction_split FOR EACH ROW EXECUTE FUNCTION fn_validate_transaction_split_category_scope();` Revoke all client-role grants.
8. Extend `rpc_create_transaction`: `DROP FUNCTION public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid);` then `CREATE FUNCTION public.rpc_create_transaction(..., p_splits jsonb DEFAULT NULL)` with the exact same body as the live version for every existing parameter and validation step, adding: (a) reject if both `p_splits` (non-empty) and `p_category_id` (non-null) are supplied together; (b) after inserting the `transaction` row, branch — if `p_splits` is non-empty, call `fn_apply_transaction_splits(...)`; otherwise, insert the single default `transaction_split` row exactly as the live version does today. Re-`REVOKE`/`GRANT` identically to the live function (`authenticated` only, `anon` explicitly revoked).
9. Write `rpc_set_transaction_splits(p_transaction_id uuid, p_splits jsonb) returns void`, `SECURITY DEFINER`, `SET search_path TO 'public'`: looks up `budget_id`/`amount` from `transaction` (rejecting if not found or soft-deleted); checks `can_access_budget()`, raising on failure (AC5); looks up the household; deletes existing `transaction_split` rows for the transaction; calls `fn_apply_transaction_splits(...)` with the same `p_amount` the transaction already has — never a client-supplied total. Grant `EXECUTE` to `authenticated` only, `anon` explicitly revoked.
10. **RLS-CI-01 test additions (committed deliverable, per IMPLEMENTATION_CONVENTIONS item 5):** extend `tests/rls/rls-ci-01.test.ts` with a new `describe('transaction split sum validation and retroactive splitting')` block (read the file's existing structure first, per precedent) covering: (a) `rpc_create_transaction` with `p_splits` summing exactly to `p_amount` succeeds, creates N `transaction_split` rows; (b) the same with a mismatched sum fails and creates **no** `transaction` row at all, not just no split rows; (c) `rpc_set_transaction_splits` with a matching sum on an existing (3.1-created, single-split) transaction succeeds and fully replaces the prior split(s); (d) the same with a mismatched sum fails and the transaction's *original* splits are confirmed unchanged afterward; (e) a Member cannot call `rpc_set_transaction_splits` on a transaction belonging to a Budget they don't have access to; (f) an unauthenticated call to either RPC fails outright; (g) a split referencing a `category_id` from a different household is rejected by both write paths; (h) directly (service-role, bypassing both RPCs) inserting split rows whose sum doesn't match the parent transaction's amount is rejected by the deferred constraint trigger at commit; (i) directly (service-role) inserting a split row whose category belongs to a different household than the transaction's is rejected by `fn_validate_transaction_split_category_scope`.

### Code Requirements

```sql
-- 1. Shared split-insertion + validation helper (used by both write paths below).
--    transaction_split itself already exists (Story 3.1) -- no CREATE TABLE here.

create or replace function public.fn_apply_transaction_splits(
  p_transaction_id uuid,
  p_household_id uuid,
  p_amount numeric,
  p_splits jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_split record;
  v_sum numeric := 0;
begin
  if p_splits is null or jsonb_array_length(p_splits) = 0 then
    raise exception 'at least one split is required';
  end if;

  for v_split in
    select * from jsonb_to_recordset(p_splits) as x(category_id uuid, amount numeric)
  loop
    if v_split.amount is null or v_split.amount <= 0 then
      raise exception 'each split amount must be greater than zero';
    end if;

    if v_split.category_id is not null and not exists (
      select 1 from category c
       where c.id = v_split.category_id
         and c.household_id = p_household_id
         and not c.is_deleted
    ) then
      raise exception 'category not found for this household';
    end if;

    v_sum := v_sum + v_split.amount;

    insert into transaction_split (transaction_id, category_id, amount)
    values (p_transaction_id, v_split.category_id, v_split.amount);
  end loop;

  if v_sum <> p_amount then
    raise exception 'split amounts (%) must sum exactly to the transaction amount (%)', v_sum, p_amount;
  end if;
end;
$$;

revoke all on function public.fn_apply_transaction_splits(uuid, uuid, numeric, jsonb) from public, anon, authenticated;

-- 2. Deferred sum-to-total constraint (the authoritative, unbypassable check).

create or replace function public.fn_check_split_sum()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_transaction_id uuid := coalesce(new.transaction_id, old.transaction_id);
  v_split_sum numeric;
  v_total numeric;
begin
  select coalesce(sum(amount), 0) into v_split_sum
    from transaction_split where transaction_id = v_transaction_id;

  select amount into v_total from transaction where id = v_transaction_id;

  if v_total is null then
    -- parent transaction was deleted in the same statement; nothing to validate.
    return null;
  end if;

  if v_split_sum <> v_total then
    raise exception 'split amounts (%) must sum exactly to the transaction amount (%)', v_split_sum, v_total;
  end if;

  return null;
end;
$$;

revoke all on function public.fn_check_split_sum() from public, anon, authenticated;

create constraint trigger trg_check_split_sum
  after insert or update or delete on transaction_split
  deferrable initially deferred
  for each row execute function fn_check_split_sum();

-- 3. Cross-tenant referential safety for transaction_split.category_id
--    (Standing Rule Sec7 rule 6 -- defense-in-depth alongside both RPCs' own checks).

create or replace function public.fn_validate_transaction_split_category_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_split_household_id uuid;
  v_category_household_id uuid;
begin
  if new.category_id is null then
    return new;
  end if;

  select b.household_id into v_split_household_id
    from transaction t
    join budget b on b.id = t.budget_id
   where t.id = new.transaction_id;

  select household_id into v_category_household_id
    from category where id = new.category_id;

  if v_split_household_id is null
     or v_category_household_id is null
     or v_split_household_id <> v_category_household_id then
    raise exception 'category does not belong to this transaction''s household';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_validate_transaction_split_category_scope() from public, anon, authenticated;

create trigger trg_transaction_split_validate_category_scope
  before insert or update of transaction_id, category_id on transaction_split
  for each row execute function fn_validate_transaction_split_category_scope();

-- 4. Extend rpc_create_transaction with an optional p_splits parameter.
--    A changed parameter list is a distinct overload to Postgres/PostgREST --
--    explicit drop + recreate, not CREATE OR REPLACE. Body is byte-identical
--    to the live version for every existing step; only the new branch at the
--    end (splits vs. the single default row) is new.

drop function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid);

create function public.rpc_create_transaction(
  p_account_id uuid,
  p_description text,
  p_amount numeric,
  p_date date,
  p_direction text default 'expense',
  p_time time default null,
  p_store text default null,
  p_category_id uuid default null,
  p_splits jsonb default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_budget_id uuid;
  v_household_id uuid;
  v_transaction_id uuid;
  v_has_splits boolean := p_splits is not null and jsonb_array_length(p_splits) > 0;
begin
  if p_direction not in ('expense', 'income') then
    raise exception 'invalid direction';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'description is required';
  end if;

  if p_date is null then
    raise exception 'date is required';
  end if;

  if v_has_splits and p_category_id is not null then
    raise exception 'p_category_id must be omitted when p_splits is provided';
  end if;

  select budget_id into v_budget_id
    from account
   where id = p_account_id and not is_deleted;

  if v_budget_id is null then
    raise exception 'account not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  select household_id into v_household_id from budget where id = v_budget_id;

  if p_category_id is not null and not exists (
    select 1 from category c
     where c.id = p_category_id
       and c.household_id = v_household_id
       and not c.is_deleted
  ) then
    raise exception 'category not found for this household';
  end if;

  insert into transaction (budget_id, account_id, description, amount, direction, date, time, store)
  values (v_budget_id, p_account_id, p_description, p_amount, p_direction, p_date, p_time, p_store)
  returning id into v_transaction_id;

  if v_has_splits then
    perform fn_apply_transaction_splits(v_transaction_id, v_household_id, p_amount, p_splits);
  else
    insert into transaction_split (transaction_id, category_id, amount)
    values (v_transaction_id, p_category_id, p_amount);
  end if;

  return v_transaction_id;
end;
$$;

revoke all on function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid, jsonb) from public, anon;
grant execute on function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid, jsonb) to authenticated;

-- 5. Retroactive split RPC.

create or replace function public.rpc_set_transaction_splits(
  p_transaction_id uuid,
  p_splits jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_budget_id uuid;
  v_household_id uuid;
  v_amount numeric;
begin
  select t.budget_id, t.amount into v_budget_id, v_amount
    from transaction t
   where t.id = p_transaction_id and not t.is_deleted;

  if v_budget_id is null then
    raise exception 'transaction not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  select household_id into v_household_id from budget where id = v_budget_id;

  delete from transaction_split where transaction_id = p_transaction_id;

  perform fn_apply_transaction_splits(p_transaction_id, v_household_id, v_amount, p_splits);
end;
$$;

revoke all on function public.rpc_set_transaction_splits(uuid, jsonb) from public, anon;
grant execute on function public.rpc_set_transaction_splits(uuid, jsonb) to authenticated;
```

Every value extracted from `p_splits` is typed and bound via `jsonb_to_recordset(...) as x(category_id uuid, amount numeric)` — the jsonb payload itself is never interpolated into SQL text, and a malformed element fails with a Postgres cast error (reject-by-default) rather than being coerced or silently dropped.

**Secure Coding Requirements** (OWASP ASVS Level 2 / CWE — reproduced verbatim, mandatory on every DIP):

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

**Application to this story:** Obligation 1: every split value is bound via `jsonb_to_recordset`'s typed columns, never string-built. Obligation 2: amount positivity and sum-exactness are validated both inside the RPCs (fast, clean errors) and by the deferred constraint trigger (authoritative, unbypassable) — reject-by-default at both layers. Obligation 6 (fail closed): `rpc_set_transaction_splits` re-derives `budget_id` from the transaction row itself and checks `can_access_budget()` explicitly, exactly like `rpc_create_transaction` — never trusts a client-supplied scope. Obligation 9 (deserialization): `p_splits` is parsed into the fixed `(category_id uuid, amount numeric)` shape via `jsonb_to_recordset`, never deserialized polymorphically. Obligation 12 (concurrency/atomicity): the deferred constraint trigger is precisely what makes `rpc_set_transaction_splits`'s delete-then-insert safe — the intermediate, temporarily-empty state is never checked, only the state at the RPC call's own commit; and extending `rpc_create_transaction` (rather than a second client call) eliminates the multi-call partial-failure window entirely, per Standing Rule §7 rule 7.

### API Contract

`supabase.rpc('rpc_create_transaction', { p_account_id, p_description, p_amount, p_date, p_direction, p_time, p_store, p_category_id, p_splits })` — `p_splits`, when provided, is `[{ category_id: uuid | null, amount: number }, ...]` and `p_category_id` must be omitted/null. Returns the new transaction's `uuid`, or an error if the split sum doesn't match `p_amount` (no `transaction` row persists in that case).

`supabase.rpc('rpc_set_transaction_splits', { p_transaction_id, p_splits })` — `p_splits` same shape, required, at least one element. Returns success (`void`) or a sum-mismatch/authorization error; on failure the transaction's prior splits are unchanged.

### Non-Functional Requirements

*Performance:* The deferred constraint check runs once per affected row at commit, not per intermediate write — a 5-way split still pays one aggregate `SELECT SUM(...)` at commit, not five.

*Scalability:* Split count per transaction is small (a handful); no scale concern, consistent with ATD §4.2's confirmed low-volume/high-isolation profile.

*Reliability:* The sum-to-total invariant is now enforced at the database layer via a deferred constraint trigger and cannot be bypassed by any application code path, present or future — including a future story's RPC that forgets to call `fn_apply_transaction_splits`. Creation-with-splits is genuinely atomic (one RPC call); a failed split-sum check leaves no orphaned transaction.

*Security:* ASVS chapters in scope: V4 (Access Control — `can_access_budget()` re-derived server-side in both RPCs), V5 (Validation — structured `p_splits` input parsed into a fixed shape, validated at two independent layers). Trust boundary: `p_splits` in both RPCs. Sensitive data: none. Weaknesses excluded: CWE-89 (bound values throughout), CWE-502 (fixed-shape deserialization only), CWE-639/IDOR (category and budget scope both re-derived server-side, never trusted from the client).

### Observability

No dedicated application-level logging. Sum-mismatch and category-scope failures surface as validation errors to the user (generic message per Obligation 10); rely on Postgres logs for the underlying exception detail and on the RLS-CI-01 suite (Implementation Instructions item 10) for regression coverage going forward.

### Files to Create/Modify

Intent-driven (exact paths to be confirmed by CC against the actual current repo structure):
- Supabase migrations: one new migration file containing the full Code Requirements block above.
- `tests/rls/rls-ci-01.test.ts`: extended per Implementation Instructions item 10.
- `apps/web`: extend `apps/web/app/dashboard/transactions/new/page.tsx` (Story 3.1) with a split-mode toggle and repeatable category/amount row editor; add a minimal transaction-list route (e.g. under `app/dashboard/transactions`) listing recent transactions with their current split summary and a "split / edit categories" action calling `rpc_set_transaction_splits`, pre-populated by reading the transaction's current `transaction_split` rows.
- `apps/mobile`: mirror both changes — a split-mode toggle on the existing create-transaction screen, and a minimal transaction-list screen with the same retroactive-split action.

### Migration Files

See the complete SQL in Code Requirements above — written to disk as a migration file and validated locally against the Supabase CLI stack (Migration rule, §7 rule 5) before anything is proposed for `ohhsteward-dev`. CC must never apply this migration directly against `ohhsteward-dev`. Local validation must explicitly exercise the `DROP FUNCTION` + `CREATE FUNCTION` step and confirm `rpc_create_transaction` still resolves correctly (single signature, no overload ambiguity) via `supabase.rpc()` afterward — this is the one genuinely novel mechanical risk in this DIP.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-19

1. Apply the migration locally first; only after local validation passes (including the drop+recreate step above) does it get proposed for `ohhsteward-dev` via the normal PR review flow — CC does not apply it to the remote project directly, per this project's established Migration rule (see the Story 3.1 incident: the migration sat unapplied on `ohhsteward-dev` after merge until manually pushed — confirm this one is actually applied to `ohhsteward-dev`, not just merged into `dev`, before considering this story deployed).
2. After the migration is applied to `ohhsteward-dev`, confirm live (a query, not file inspection, per IMPLEMENTATION_CONVENTIONS item 4): `rpc_create_transaction` resolves to exactly one function with 9 parameters (no leftover 8-parameter overload); `trg_check_split_sum` appears on `transaction_split` with `tgdeferrable`/`tginitdeferred` both true; `trg_transaction_split_validate_category_scope` is present; `rpc_set_transaction_splits`, `fn_apply_transaction_splits`, `fn_check_split_sum`, and `fn_validate_transaction_split_category_scope` all show no `anon` grant (the latter three also no `authenticated` grant).
3. Manually create one split transaction (2+ categories) through the deployed UI/RPC and confirm the split rows sum correctly and the parent `transaction`'s balance effect on the account is unaffected by split count (balance is driven by `transaction.amount`, not by the number of splits).

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations directory; `tests/rls/rls-ci-01.test.ts`; the Story 3.1 Add Transaction UI on both platforms (split-mode toggle); a new minimal transaction-list surface on both platforms (retroactive-split entry point, since no Story 6.x screen exists yet).

**Expected integration behavior:** split editing is always a full-replace operation (`rpc_set_transaction_splits` deletes then re-inserts) rather than incremental per-row edits — simpler than diffing, and consistent with the deferred-constraint model.

**Data flow impact:** a `transaction` row can now have one-or-more `transaction_split` children instead of exactly one, though "exactly one" (Story 3.1's default) remains the common case for an uncategorized or single-category entry.

**Dependencies to add/update:** none new.

**Constraints:** must not allow a `transaction_split` row to reference a `transaction_id` outside the caller's accessible Budgets (already enforced by 3.1's existing RLS, unchanged) or a `category_id` outside the transaction's own household (newly enforced by `fn_validate_transaction_split_category_scope`, this story).

### Change Impact

- What changes: `rpc_create_transaction` gains an optional `p_splits` parameter via drop+recreate; new `rpc_set_transaction_splits` and shared `fn_apply_transaction_splits` helper; two new triggers on `transaction_split` (deferred sum constraint, category-scope validation).
- What it touches: `transaction_split` (triggers only), `rpc_create_transaction` (signature + one new branch).
- Breaking risk: No for existing callers omitting `p_splits` — behavior is unchanged and was diffed line-by-line against the live function to confirm it.

### Branch Name

feature/3.2-split-transactions

### Commit Message

3.2: Add split transactions — deferred sum-validation constraint, rpc_set_transaction_splits, extend rpc_create_transaction with p_splits

### Pull Request Description

Maps to each Acceptance Criterion:
- AC1: `rpc_create_transaction`'s new `p_splits` parameter lets the Add Transaction form submit multiple category/amount pairs in the same atomic call that creates the transaction.
- AC2: sum validation happens at two layers — `fn_apply_transaction_splits` (fast, clean RPC-level error) and the deferred `trg_check_split_sum` constraint trigger (authoritative, unbypassable) — both reject a mismatched total.
- AC3: `rpc_set_transaction_splits` applies the identical sum-validation rule to a full replace of an existing transaction's splits.
- AC4: each `transaction_split` row retains its own `category_id`/`amount`; a read joining `transaction_split` → `category` displays each portion, always summing to `transaction.amount` by construction.
- AC5 (negative security): a mismatched-sum `p_splits` payload is rejected before commit in both RPCs — no orphaned transaction on creation, no partial replace on the retroactive path.

Also documents why `rpc_create_transaction`'s signature change required an explicit drop+recreate rather than `CREATE OR REPLACE FUNCTION` (PostgREST overload-resolution hazard — see Grounding Check).

### Jira Linkage

- PDE Story ID: 3.2
- Jira Epic Key: STEW-3
- Jira Story Key: STEW-19

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-3.2.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests locally and merges manually.

Include full diffs for every file created or modified in the completion report — not a summary. For the three functions this DIP requires to remain byte-for-byte unmodified (`fn_apply_transaction_to_balance()`, `fn_inherit_transaction_currency()`, `fn_validate_transaction_budget_scope()`), include `git diff dev [branch] -- [migration files that would touch them]` showing zero output as explicit proof.

### Confidence Assessment

- **Confidence Score:** 83
- **Reasoning:** The sum-validation architecture (deferred constraint trigger backing an RPC-level check) is a well-established Postgres pattern, and the shared `fn_apply_transaction_splits` helper means the validation logic is written and reviewed exactly once for both write paths, reducing drift risk between them. The score is not higher than 3.1's because this story requires safely changing an already-live, already-tested function's signature (`rpc_create_transaction`) — a class of change 3.1 never had to make — and getting the drop+recreate step wrong (or missing the PostgREST overload hazard entirely) would be a subtle, hard-to-diagnose production issue rather than a clean failure.
- **Top Risk Areas:** (1) If the `DROP FUNCTION`'s parameter-type list in the migration doesn't exactly match the live function's actual signature, the drop itself fails loudly (safe) — but local validation must still explicitly confirm only one `rpc_create_transaction` overload exists afterward, since a typo in the drop's argument list would silently leave the old 8-parameter version in place alongside a new one. (2) The deferred constraint trigger's correctness depends entirely on both RPCs running their full multi-row write inside one implicit transaction (the function call itself) — a future refactor that splits either RPC's work across multiple statements/calls would silently reintroduce the exact partial-failure risk this DIP was designed to eliminate. (3) As with 3.1, the RLS-CI-01 additions in item 10 are a committed-test obligation per IMPLEMENTATION_CONVENTIONS item 5, not a suggestion.

### ⚠️ Open Questions to be Answered Before Moving Forward

None. (The creation-time atomicity design — extending `rpc_create_transaction` rather than two sequential client calls — and the drop+recreate mechanism for its signature change are both resolved design decisions with rationale documented above, not open questions.)

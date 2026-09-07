# Story 3.1 — Manual Transaction Entry

**Review Summary Strip:** Story ID: 3.1 | Objective: Core transaction logging | Core Change: `transaction`/`transaction_split` schema + `rpc_create_transaction` + attachment of the two triggers deferred from Stories 2.2 and 2.4 | Risk Level: Medium (upgraded from Backlog's "Low" — see Revision Note) | Confidence Score: 85 | Blocking Issues: None | ClaudeCode Ready: Yes (depends on 2.1, 2.2; deferred triggers from 2.2/2.4 confirmed live and unattached)

**User Story:** As a Budget owner, I want to log a transaction quickly with the essential details, so that my Budget stays current with minimal friction.

**Revision Note (DIP-3.1-v2, supersedes the v1 draft in this file's history):** A v1 draft of this DIP already existed in `BACKLOG_DIP.md` from the original Forge v3 pass (2026-09-04, before either deferred-trigger dependency existed). Grounding this session against the live `ohhsteward-dev` schema and `MANIFEST-2026-09-07.md` surfaced five real defects in that draft, the same class of gap that produced DIP-2.3-v2 and DIP-1.1.G2:
1. **The v1 draft's own Code Requirements never attach `fn_apply_transaction_to_balance()` or `fn_inherit_transaction_currency()` to the new table at all** — despite step 6 of its Implementation Instructions asserting the balance trigger was "already wired to fire on `transaction` insert." Verified live: both functions exist (`pg_get_functiondef` read this session) and neither has any trigger anywhere, because `transaction` itself didn't exist until now. This is precisely the deferred work Joseph's request called out as the two things this DIP must get right, and the stale draft would have shipped a transaction table that never updates account balances and never inherits currency. Fixed in Implementation Instructions items 7–8 below.
2. **No cross-tenant referential-safety trigger.** `transaction` has FKs into two tenant-scoped tables (`budget`, `account`) — Standing Rule §7 rule 6 requires a `BEFORE INSERT OR UPDATE` trigger validating the referenced `account` actually belongs to the stated `budget_id`; a plain FK only proves the account exists, not that it's the right one. The v1 draft only checked this once, inside the RPC — not at the table layer, so it wasn't defense-in-depth. Fixed in Implementation Instructions item 6.
3. **No audit trigger.** IMPLEMENTATION_CONVENTIONS.md item 2 ("no entity table is exempt") was not applied to either new table. Fixed in Implementation Instructions item 9.
4. **Weaker RPC authorization design.** The v1 draft's `rpc_create_transaction` accepted `p_budget_id` directly from the client and merely cross-checked it against `p_account_id`. DIP-2.3-v2's fix to `rpc_upsert_category` established the stronger pattern for this exact class of bug (never trust a caller-supplied tenant-scope id; derive it from the row being referenced): this DIP's `rpc_create_transaction` does not accept `p_budget_id` as a parameter at all — it derives `budget_id` from `p_account_id` server-side, which is strictly safer and removes an entire class of mismatched-parameter bugs rather than merely detecting them after the fact.
5. **No RLS-CI-01 coverage plan.** IMPLEMENTATION_CONVENTIONS.md item 5 requires every DIP touching a new Budget-owned table to re-read `DVP.md` §3 in full and specify the exact committed test additions needed — the v1 draft did neither. `DVP.md` §3 already names "Budget Y's Accounts/**Transactions**" as required RLS-CI-01 coverage, and STEW-38 (open, filed 2026-09-06) separately flags Account/Transaction join-path isolation, unauthenticated access, and SQL-metacharacter storage as missing system-wide. Since `transaction` didn't exist until this story, this is the first opportunity to add real coverage for the Transaction side of all three STEW-38 items — done in Implementation Instructions item 12 (this closes the Transaction-side gap only; the pre-existing Account-side portion of STEW-38 remains that ticket's own scope, not silently absorbed here — see Grounding Check).

None of these were Standing Rule violations in the sense of added scope — they were gaps in *secure/correct implementation* of the story's own necessary schema, which the Standing Rule's own scope clarification says is never optional. This v2 keeps the story's Acceptance Criteria, User Story, and product-level Change Impact identical to the Backlog; only the DIP's technical execution changes.

**Acceptance Criteria:**
1. Given the Add Transaction form, when submitted with description, amount, required Account/Card/Savings, and required date, then the transaction is saved.
2. Given no category is selected, when the transaction is saved, then it is stored as uncategorized without error.
3. Given no direction is explicitly chosen, when the transaction is saved, then it defaults to expense ("buying").
4. Given optional fields (time, store/establishment, category) are left blank, when saved, then the transaction still saves successfully.

**Dependencies & Assumptions:** Depends on Stories 2.1, 2.2 (Budget/Account entities must exist — confirmed live). Depends on Story 2.3 for category selection (optional — `category` table confirmed live). Depends on Story 3.3 for soft-delete/audit behavior (`fn_audit_log()` confirmed live, generic, and reused as-is). **Carries forward two explicit deferred obligations, both confirmed live this session and neither yet attached to anything:** `fn_apply_transaction_to_balance()` (deferred from DIP-2.2-v2) and `fn_inherit_transaction_currency()` (deferred from DIP-2.4-v2) — this DIP attaches both via `CREATE TRIGGER` only; their function bodies are not touched.

**Traceability:** PIB Objective: "Expense tracking, transaction entry." PSDD Capability: Transaction Management; PSDD Journey D. ATD §3.2 (`transaction`, `transaction_split` key tables), §3.3 (`budget_scoped_access` RLS pattern, applied to `transaction_split` "via join" per ATD's own wording), §4.4 (shared audit trigger pattern), Standing Rule §7 rules 6–7 (cross-tenant referential safety, atomic multi-table writes).

**Change Impact:**
- What changes: New `transaction` and `transaction_split` tables; new `rpc_create_transaction`; two pre-existing deferred trigger functions attached for the first time; one new cross-tenant validation trigger function; audit triggers attached to both new tables.
- What it touches: `account.current_balance`/`balance_owed` (via the now-attached balance trigger), `audit_log_entry` (via the now-attached audit triggers), `category` (read-only reference from `transaction_split`).
- Breaking risk: No — net-new tables; nothing existing is altered.

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement transaction creation with the specified required/optional fields and default direction behavior, as a single atomic `SECURITY DEFINER` RPC that also attaches (never redefines) the two functions deferred from Stories 2.2 and 2.4. Do NOT implement: mandatory category selection, mandatory time/store fields, any automatic categorization/ML suggestion, any transaction edit/delete UI (soft-delete plumbing exists per 3.3 but no edit/delete screen is in scope here), any redefinition of `fn_apply_transaction_to_balance()` or `fn_inherit_transaction_currency()`, any multi-row split UI or sum-validation logic (Story 3.2).

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: No (creates a new record each call; standard create semantics) | Reason: Schema and RPC design are fully specified below, including the two deferred-trigger attachments and the cross-tenant validation trigger; the highest-risk element is getting the trigger *attachment* right without touching the trigger *functions* themselves, which Implementation Instructions items 7–8 make explicit and mechanical.
Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

---

### Story Summary

Story 3.1 introduces the `transaction` entity — the first write path that touches account balances. It closes two obligations deliberately deferred by earlier stories because their target table didn't exist yet: `fn_apply_transaction_to_balance()` (DIP-2.2-v2) and `fn_inherit_transaction_currency()` (DIP-2.4-v2) both already exist, fully implemented and verified against the live `ohhsteward-dev` schema this session, and need only a `CREATE TRIGGER` statement each — redefining either is explicitly out of scope. Category association is modeled per ATD §3.2 through a `transaction_split` row (exactly one, for the unsplit case this story covers) rather than a `category_id` column directly on `transaction`, so that Story 3.2's multi-row split logic is a pure addition later with no schema migration of `transaction` itself. All writes go through one new `SECURITY DEFINER` RPC, `rpc_create_transaction`, which performs the transaction + transaction_split insert atomically (Standing Rule §7 rule 7) and derives its own authorization scope from the referenced account rather than trusting a client-supplied budget id (the same class of fix DIP-2.3-v2 made to `rpc_upsert_category`).

### Repo Target

Supabase migrations (new `transaction`/`transaction_split` tables, RLS, `rpc_create_transaction`, the two deferred `CREATE TRIGGER` statements, one new validation trigger, two new audit triggers) plus `tests/rls/rls-ci-01.test.ts` (new Transaction-scoped test cases, per IMPLEMENTATION_CONVENTIONS item 5). `apps/web` and `apps/mobile`: a new Add Transaction form/screen calling `rpc_create_transaction`. Story 6.3's floating "+" entry point does not exist yet (Phase 2), so this story's UI must be reachable on its own (e.g. a plain nav link/route on both platforms) — Story 6.3 wires the floating button to it later; that is not this story's work.

### Grounding Check

**Live schema, verified this session (not assumed from spec language):** `transaction` and `transaction_split` do not exist in `ohhsteward-dev` — confirmed via `list_tables`. `fn_apply_transaction_to_balance()` and `fn_inherit_transaction_currency()` both exist (`pg_get_functiondef` read in full this session) and have zero triggers anywhere (impossible for any to exist, since their only intended target table didn't exist until now). `fn_apply_transaction_to_balance()`'s body already correctly implements ATD invariant §3 (`transaction.direction` default `expense`; expense subtracts from `current_balance` and increases `balance_owed`; income the reverse) via `tg_op`-branched logic reading `old`/`new` — it is written as an `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` trigger (it reads `old.account_id`/`old.direction`/`old.amount` for the UPDATE/DELETE reversal branch and `new.*` for the INSERT/UPDATE branch), so it must be attached to all three operations, not INSERT alone. `fn_inherit_transaction_currency()`'s body sets `new.currency` from the referenced account, which only makes sense as a `BEFORE INSERT` trigger (it must run before the row's own NOT NULL constraint is checked); it is scoped to INSERT only in this DIP since editing an existing transaction's account is out of scope for 3.1 (no edit UI is built here) — a future edit-transaction story should reconsider whether reassigning `account_id` needs the trigger to also fire `BEFORE UPDATE OF account_id`.

**`category`-via-`transaction_split` schema decision (resolved, not a Blocking Question):** ATD §3.1's entity-relationship summary and §3.2's key-tables list both describe `transaction_split` as core schema co-equal with `transaction` itself — "Transaction *───* Category (via TransactionSplit, **1 row when unsplit**)" — not as something Story 3.2 alone introduces. Backlog Story 3.2's own Change Impact ("Split-line sub-entity linked to a parent Transaction; validation logic") is read here as 3.2 adding the *multi-row* capability and the *sum-validation trigger/CHECK* on top of a table this story creates in its minimal single-row form — not as 3.2 owning the table's existence. This reading is unambiguous enough from ATD's approved language (the authoritative schema source, since no live migration exists yet to check against) that it doesn't warrant stalling the story on a Blocking Question; the exact boundary is made explicit in the Do NOT implement list below so 3.2 can extend without redoing 3.1's work.

**Cross-tenant referential safety (Standing Rule §7 rule 6), applied:** `transaction` has FKs into `budget` and `account`, both tenant-scoped. A plain `references account(id)` only proves the account row exists, not that it belongs to `transaction.budget_id`. A new `BEFORE INSERT OR UPDATE OF budget_id, account_id` trigger (`fn_validate_transaction_budget_scope`, `SECURITY DEFINER` to guarantee it always sees `account.budget_id` regardless of the caller's own RLS visibility) closes this — see Implementation Instructions item 6 and Code Requirements.

**Atomic multi-table writes (Standing Rule §7 rule 7), applied:** creating a transaction always writes `transaction` + `transaction_split` together. `rpc_create_transaction` performs both inserts in one function body, `SECURITY DEFINER`. Because a `SECURITY DEFINER` function bypasses RLS on its own writes (the exact mechanism behind the STEW-16 IDOR incident on `rpc_upsert_category`), the RPC must enforce its own authorization rather than relying on RLS — it does, via an explicit `can_access_budget()` check derived from the referenced account (never from client-supplied input), matching DIP-2.3-v2's corrected pattern rather than the weaker one in this story's own stale v1 draft (see Revision Note item 4).

**IMPLEMENTATION_CONVENTIONS.md checklist, applied to both new tables:**
1. *RLS enable+force on every new table:* applied to both `transaction` and `transaction_split` in the migration (Code Requirements). Verification query (§1) to be run post-deploy per Deployment Instructions.
2. *Audit trigger attachment on every entity table:* `trg_audit_transaction` and `trg_audit_transaction_split` both attach the existing, unmodified `fn_audit_log()` — no entity table exempted.
3. *Explicit `anon`/`authenticated` revoke on every new `SECURITY DEFINER` function:* applied to `rpc_create_transaction` and to the new `fn_validate_transaction_budget_scope()` trigger function (defense-in-depth, matching DIP-1.1.G2's treatment of its own trigger function, even though Postgres won't let a trigger-returning function be invoked directly outside trigger context).
4. *"Confirm the grant" via live query, not file inspection:* required in Deployment Instructions below, same query pattern used throughout this session.
5. *RLS-CI-01 full-fidelity cross-check against `DVP.md` §3:* re-read in full this session. Lines this story's new tables bear on: "As Member A... attempt to read/write Budget Y's Accounts/**Transactions** via any join path — must fail" (names Transaction explicitly); the general Member/Parent isolation matrix (now applies to `transaction`/`transaction_split` too); the unauthenticated-any-query line; the SQL-metacharacter negative case. STEW-38 (open) separately flags exactly these last two plus "Account/Transaction join-path isolation" as missing system-wide — **since `transaction` did not exist until this story, this DIP is the first opportunity to add real coverage for the Transaction side of all three STEW-38 items, and Implementation Instructions item 12 requires it as this story's own committed deliverable.** This resolves STEW-38 only for the Transaction-side surface introduced here; the pre-existing Account-side portion of STEW-38 (which predates this story per its own filing) remains STEW-38's own remit and is explicitly not silently absorbed into this DIP.

**Trust boundary:** every field submitted through the Add Transaction form (`description`, `amount`, `direction`, `date`, `time`, `store`, `account_id`, `category_id`) is untrusted client input, validated server-side inside `rpc_create_transaction` and by table-level CHECK constraints — never trusted from client-side validation alone.

**Prior work awareness (§7 rule 11):** no `documentation/dips/DIP-3.1.md` exists in the repo yet (confirmed — not present in the project's synced doc list); this story is not building on any prior committed DIP for 3.1. A v1 draft existed only inside `BACKLOG_DIP.md`'s original placeholder-filling pass — see Revision Note above for exactly what it got wrong.

**Note, not in scope for this story:** `rpc_restore_entity(p_entity_type text, p_entity_id uuid)` (Story 3.3) was not re-read this session to confirm whether its `entity_type` handling is generic enough to already cover `'transaction'`, since no restore UI is in scope for 3.1's Acceptance Criteria. Flagging this so it isn't silently assumed working when Story 3.2 or a future edit/restore story relies on it for `transaction`.

### Acceptance Criteria

(Restated verbatim from the story, plus one negative security AC required by Standing Rule §7 rule 16 since this story writes SQL, accepts external input, and makes an authorization decision.)

1. Given the Add Transaction form, when submitted with description, amount, required Account/Card/Savings, and required date, then the transaction is saved.
2. Given no category is selected, when the transaction is saved, then it is stored as uncategorized without error.
3. Given no direction is explicitly chosen, when the transaction is saved, then it defaults to expense ("buying").
4. Given optional fields (time, store/establishment, category) are left blank, when saved, then the transaction still saves successfully.
5. **(Negative security AC)** Given a caller who is not an owner/co-owner of the Budget that owns the referenced Account, and is not a Parent of that Budget's household, when they call `rpc_create_transaction` with that Account's id, then the call is rejected and no `transaction` or `transaction_split` row is created — the function derives authorization from the referenced Account server-side and never trusts a client-supplied Budget id.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement:**
   - Do NOT require category selection at entry.
   - Do NOT require time or store fields.
   - Do NOT implement any automatic categorization or ML-based suggestion — not specified.
   - Do NOT redefine, alter, or replace `fn_apply_transaction_to_balance()` or `fn_inherit_transaction_currency()` — attach each via `CREATE TRIGGER` only, exactly as each already exists live.
   - Do NOT implement `transaction_split`'s multi-row split UI, retroactive-split flow, or sum-validation CHECK/trigger — Story 3.2's scope. This story's RPC always inserts exactly one `transaction_split` row per transaction.
   - Do NOT build any transaction edit or delete UI or endpoint — soft-delete plumbing (Story 3.3) exists on the table, but no edit/delete flow is in this story's Acceptance Criteria.
   - Do NOT grant `INSERT` on `transaction` or `transaction_split` to `authenticated` via RLS — creation is exclusively through `rpc_create_transaction` (see item 5's rationale); this is a deliberate, narrower deviation from the `account` table's `FOR ALL` RLS pattern, made because transaction creation is a genuine atomic two-table write (Standing Rule §7 rule 7) that a direct client insert could not perform safely.
   - Do NOT modify `rpc_restore_entity()` or any other Story 3.3-era function.
4. Create `transaction`: `id uuid primary key default gen_random_uuid()`, `budget_id uuid not null references budget(id)`, `account_id uuid not null references account(id)`, `description text not null`, `amount numeric not null check (amount > 0)`, `direction text not null default 'expense' check (direction in ('expense','income'))`, `date date not null`, `time time`, `store text`, `currency char(3) not null references currency(code)`, `is_deleted boolean not null default false`, `created_at timestamptz not null default now()`. `currency` has no client-settable path (see item 5) — it is populated exclusively by the trigger in item 8.
5. Create `transaction_split`: `id uuid primary key default gen_random_uuid()`, `transaction_id uuid not null references transaction(id)`, `category_id uuid references category(id)` (nullable — uncategorized), `amount numeric not null check (amount > 0)`, `created_at timestamptz not null default now()`. No `is_deleted` column — it is not an independently soft-deletable entity; it is removed/superseded transitively with its parent transaction, consistent with `budget_owner`'s existing join-table pattern (no `is_deleted` there either).
6. Create `fn_validate_transaction_budget_scope()`: `SECURITY DEFINER`, `SET search_path TO 'public'`, `RETURNS trigger`. Looks up `account.budget_id` for `new.account_id`; raises an exception if the account doesn't exist or its `budget_id` doesn't equal `new.budget_id`. Attach as `trg_transaction_validate_budget_scope BEFORE INSERT OR UPDATE OF budget_id, account_id ON transaction FOR EACH ROW EXECUTE FUNCTION fn_validate_transaction_budget_scope()` — Standing Rule §7 rule 6, defense-in-depth independent of the RPC's own check in item 10.
7. Attach the existing `fn_inherit_transaction_currency()` (do not redefine): `CREATE TRIGGER trg_transaction_inherit_currency BEFORE INSERT ON transaction FOR EACH ROW EXECUTE FUNCTION fn_inherit_transaction_currency();`
8. Attach the existing `fn_apply_transaction_to_balance()` (do not redefine): `CREATE TRIGGER trg_transaction_apply_balance AFTER INSERT OR UPDATE OR DELETE ON transaction FOR EACH ROW EXECUTE FUNCTION fn_apply_transaction_to_balance();` — all three operations, matching the function body's own `tg_op` branching (confirmed by reading its live definition this session).
9. Attach the existing `fn_audit_log()` (do not redefine) to both new tables, matching every other table's naming convention: `CREATE TRIGGER trg_audit_transaction AFTER INSERT OR DELETE OR UPDATE ON transaction FOR EACH ROW EXECUTE FUNCTION fn_audit_log();` and `CREATE TRIGGER trg_audit_transaction_split AFTER INSERT OR DELETE OR UPDATE ON transaction_split FOR EACH ROW EXECUTE FUNCTION fn_audit_log();`
10. Write `rpc_create_transaction(p_account_id uuid, p_description text, p_amount numeric, p_date date, p_direction text default 'expense', p_time time default null, p_store text default null, p_category_id uuid default null) returns uuid`, `SECURITY DEFINER`, `SET search_path TO 'public'`: validates `p_direction in ('expense','income')` and `p_amount > 0` (reject-by-default, redundant with but independent of the table CHECKs); looks up `v_budget_id` from `account` by `p_account_id` (rejecting if not found or soft-deleted) — **never accepts a budget id from the caller**; checks `can_access_budget(v_budget_id)`, raising on failure (AC5); if `p_category_id` is supplied, verifies it references a non-deleted category belonging to the same household as `v_budget_id`'s budget, raising on mismatch; inserts the `transaction` row (`currency` omitted — set by item 7's trigger); inserts exactly one `transaction_split` row (`amount = p_amount`, `category_id = p_category_id`); returns the new transaction id.
11. Apply RLS to `transaction`: `enable row level security`, `force row level security`; `budget_scoped_access` policy for `SELECT`, `UPDATE`, `DELETE` using `can_access_budget(budget_id)` — no `INSERT` policy (see Do NOT implement). Apply RLS to `transaction_split` the same way, scoped "via join" per ATD §3.3's own wording: `using (exists (select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id)))` — again no `INSERT` policy.
12. `REVOKE ALL ON FUNCTION rpc_create_transaction(...) FROM PUBLIC, anon;` then `GRANT EXECUTE ON FUNCTION rpc_create_transaction(...) TO authenticated;` — matching the correct pattern already established by `rpc_create_invite`/`rpc_upsert_category`, not the still-broken `rpc_create_budget` (tracked separately as STEW-33). Apply the same `REVOKE ALL ... FROM PUBLIC, anon, authenticated` to `fn_validate_transaction_budget_scope()` (defense-in-depth per convention item 3, even though Postgres won't allow direct invocation of a trigger-returning function outside trigger context).
13. **RLS-CI-01 test additions (committed deliverable of this story, per IMPLEMENTATION_CONVENTIONS item 5 — not deferred):** extend `tests/rls/rls-ci-01.test.ts` with a new `describe('transaction')` block (or equivalent, matching the file's existing structure — read it before editing) covering: (a) Member A, assigned to Budget X only, calling `rpc_create_transaction` against Budget X's own account succeeds; the same call against an account belonging to Budget Y (not assigned) fails and creates no row; (b) a direct `.from('transaction').insert(...)` attempt (bypassing the RPC) is rejected by RLS for any authenticated role, proving creation genuinely requires the RPC; (c) Member A's `SELECT` against Budget Y's transactions returns zero rows; (d) a Parent's `SELECT` spans every Budget in their household; (e) an unauthenticated (`anon`) call to `rpc_create_transaction` fails outright (grant revoked) — closes the Transaction side of STEW-38's "unauthenticated access" item; (f) a transaction `description`/`store` containing a SQL metacharacter (e.g. `' OR '1'='1`) is stored and retrieved literally via the RPC and never alters query behavior — closes the Transaction side of STEW-38's "SQL-metacharacter literal storage" item; (g) directly exercising `fn_validate_transaction_budget_scope()`'s rejection path (e.g. via a service-role test connection, since no normal client path can reach it — the RPC already blocks the mismatched case) — proves the DB-layer trigger is real defense-in-depth, not merely duplicate logic living only in the RPC.

### Code Requirements

```sql
-- 1. Tables

create table transaction (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budget(id),
  account_id uuid not null references account(id),
  description text not null,
  amount numeric not null check (amount > 0),
  direction text not null default 'expense' check (direction in ('expense','income')),
  date date not null,
  time time,
  store text,
  currency char(3) not null references currency(code),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table transaction_split (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transaction(id),
  category_id uuid references category(id),
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

-- 2. Cross-tenant referential safety (Standing Rule §7 rule 6)

create or replace function public.fn_validate_transaction_budget_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_account_budget_id uuid;
begin
  select budget_id into v_account_budget_id
    from account
   where id = new.account_id;

  if v_account_budget_id is null then
    raise exception 'referenced account does not exist';
  end if;

  if v_account_budget_id <> new.budget_id then
    raise exception 'account does not belong to the specified budget';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_validate_transaction_budget_scope() from public, anon, authenticated;

create trigger trg_transaction_validate_budget_scope
  before insert or update of budget_id, account_id on transaction
  for each row execute function fn_validate_transaction_budget_scope();

-- 3. Attach the two triggers deferred from DIP-2.2-v2 and DIP-2.4-v2.
--    fn_apply_transaction_to_balance() and fn_inherit_transaction_currency()
--    already exist -- this migration does NOT define or replace either.

create trigger trg_transaction_inherit_currency
  before insert on transaction
  for each row execute function fn_inherit_transaction_currency();

create trigger trg_transaction_apply_balance
  after insert or update or delete on transaction
  for each row execute function fn_apply_transaction_to_balance();

-- 4. Audit triggers (existing fn_audit_log(), not redefined)

create trigger trg_audit_transaction
  after insert or delete or update on transaction
  for each row execute function fn_audit_log();

create trigger trg_audit_transaction_split
  after insert or delete or update on transaction_split
  for each row execute function fn_audit_log();

-- 5. RLS: enable + force on both new tables, per IMPLEMENTATION_CONVENTIONS item 1

alter table transaction enable row level security;
alter table transaction force row level security;

alter table transaction_split enable row level security;
alter table transaction_split force row level security;

create policy budget_scoped_access on transaction
  for select using (can_access_budget(budget_id));
create policy budget_scoped_update on transaction
  for update using (can_access_budget(budget_id)) with check (can_access_budget(budget_id));
create policy budget_scoped_delete on transaction
  for delete using (can_access_budget(budget_id));
-- Deliberately no INSERT policy: creation is exclusively via rpc_create_transaction
-- (SECURITY DEFINER, bypasses RLS on its own writes). Under FORCE ROW LEVEL SECURITY
-- with no INSERT policy, a direct client insert is denied by default (fail-closed).

create policy budget_scoped_access on transaction_split
  for select using (
    exists (select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id))
  );
create policy budget_scoped_update on transaction_split
  for update using (
    exists (select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id))
  ) with check (
    exists (select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id))
  );
create policy budget_scoped_delete on transaction_split
  for delete using (
    exists (select 1 from transaction t where t.id = transaction_split.transaction_id and can_access_budget(t.budget_id))
  );
-- Same rationale: no INSERT policy; creation is exclusively via rpc_create_transaction.

-- 6. rpc_create_transaction

create or replace function public.rpc_create_transaction(
  p_account_id uuid,
  p_description text,
  p_amount numeric,
  p_date date,
  p_direction text default 'expense',
  p_time time default null,
  p_store text default null,
  p_category_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_budget_id uuid;
  v_household_id uuid;
  v_transaction_id uuid;
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

  -- Never accept budget_id from the caller -- derive it from the account itself.
  select budget_id into v_budget_id
    from account
   where id = p_account_id and not is_deleted;

  if v_budget_id is null then
    raise exception 'account not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  if p_category_id is not null then
    select b.household_id into v_household_id from budget b where b.id = v_budget_id;

    if not exists (
      select 1 from category c
       where c.id = p_category_id
         and c.household_id = v_household_id
         and not c.is_deleted
    ) then
      raise exception 'category not found for this household';
    end if;
  end if;

  insert into transaction (budget_id, account_id, description, amount, direction, date, time, store)
  values (v_budget_id, p_account_id, p_description, p_amount, p_direction, p_date, p_time, p_store)
  returning id into v_transaction_id;

  insert into transaction_split (transaction_id, category_id, amount)
  values (v_transaction_id, p_category_id, p_amount);

  return v_transaction_id;
end;
$$;

revoke all on function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid) from public, anon;
grant execute on function public.rpc_create_transaction(uuid, text, numeric, date, text, time, text, uuid) to authenticated;
```

Every value in `rpc_create_transaction` and `fn_validate_transaction_budget_scope` is a typed, bound PL/pgSQL parameter/variable — no string concatenation or interpolation into any query anywhere in this DIP.

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

**Application to this story:** Obligation 1: every statement in `rpc_create_transaction` and `fn_validate_transaction_budget_scope` uses bound parameters/variables exclusively. Obligation 2: `p_amount > 0`, `p_direction in ('expense','income')`, non-empty `p_description`, and non-null `p_date` are all validated server-side inside the RPC, redundant with (never a substitute for) the table's own CHECK constraints — reject-by-default on any invalid value. Obligation 6 (fail closed): `can_access_budget()` is checked explicitly inside the RPC because `SECURITY DEFINER` bypasses RLS on the RPC's own writes — an unauthorized caller is rejected with an exception (AC5), never silently allowed through. Obligation 7 (least privilege): `rpc_create_transaction` grants `EXECUTE` to `authenticated` only, `anon` explicitly revoked; `fn_validate_transaction_budget_scope()` has all client-role grants revoked entirely, since it is only ever invoked as a trigger. Obligation 12 (concurrency): the account-balance update in `fn_apply_transaction_to_balance()` is expressed as a single atomic `UPDATE account SET current_balance = current_balance + x` statement (verified by reading its live definition), not a read-then-write in application code, so concurrent transaction inserts against the same account cannot lose an update under Postgres's own row-level locking — no additional locking is introduced by this story.

### API Contract

`supabase.rpc('rpc_create_transaction', { p_account_id, p_description, p_amount, p_date, p_direction, p_time, p_store, p_category_id })` — returns the new transaction's `uuid` on success, or a Postgres exception (surfaced by the Supabase client as an error) on validation/authorization failure (AC5, and the input-validation checks in item 10). `p_budget_id` is never a parameter.

Reads use plain `select` on `transaction` joined to `transaction_split`, RLS-scoped identically to every other Budget-owned table (`can_access_budget`).

### Non-Functional Requirements

*Performance:* One RPC call performs two single-row inserts plus three AFTER-trigger side effects (balance update, two audit log writes) and two BEFORE-trigger checks (currency inheritance, budget-scope validation) — all within one transaction, well within standard RPC latency at this system's confirmed low-volume/high-isolation usage profile (ATD §4.2).

*Scalability:* `transaction` is the fastest-growing table over the multi-year retention window (ATD §3.5/§4.2); no denormalization or materialized view is introduced here (ATD §4.3's materialized-view recommendation is explicitly deferred per DVP §5, not this story's concern).

*Reliability:* Every transaction, split or not, has exactly one `transaction_split` row created atomically with it — no special-cased "unsplit" code path exists elsewhere in the system, and no transaction can exist with zero split rows via any client-reachable path (the missing INSERT RLS policy on both tables forecloses that).

*Security:* ASVS chapters in scope: V4 (Access Control — `can_access_budget()` derived server-side from the referenced account, never from client input), V5 (Validation — every RPC input validated server-side, redundant with table CHECK constraints). Trust boundary: every field submitted through the Add Transaction form. Sensitive data: none (no PII; transaction descriptions/amounts are the household's own financial data, protected by the RLS/RPC authorization boundary, not by field-level secrecy). Weaknesses excluded: CWE-89 (bound parameters throughout, verified by inspection of every statement above), CWE-639/IDOR (budget scope is derived, never trusted from the client — the exact class of bug DIP-2.3-v2 fixed elsewhere in this codebase).

### Observability

No dedicated application-level logging is introduced. Rely on Postgres logs for any exception raised inside `rpc_create_transaction` or `fn_validate_transaction_budget_scope` (detail stays server-side per Obligation 10 above) and on the DVP §3 / RLS-CI-01 test suite (Implementation Instructions item 13) to verify correctness in CI going forward rather than ad hoc manual checks.

### Files to Create/Modify

Intent-driven (exact paths to be confirmed by CC against the actual current repo structure, per the "never invent a folder structure" rule — Story 6.1/6.3's dashboard shell, which will eventually host this screen's entry point, has not been built yet):
- Supabase migrations: one new migration file containing the full Code Requirements block above.
- `tests/rls/rls-ci-01.test.ts`: extended per Implementation Instructions item 13 — read the file's existing structure before adding to it, do not restructure what's already there.
- `apps/web`: a new Add Transaction route/page calling `rpc_create_transaction`, reachable via a plain nav link or route until Story 6.3 wires it to a floating "+" button.
- `apps/mobile`: a new Add Transaction screen, same backend call, added to whatever navigation structure `apps/mobile/App.tsx` currently uses.

### Migration Files

See the complete SQL in Code Requirements above — written to disk as a migration file and validated locally against the Supabase CLI stack (Migration rule, §7 rule 5) before anything is proposed for the remote `ohhsteward-dev` project. CC must never apply this migration directly against `ohhsteward-dev`.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-18

1. Apply the migration locally first; only after local validation passes does it get proposed for `ohhsteward-dev` via the normal PR review flow (per the Migration rule) — CC does not apply it to the remote project directly.
2. After merge, confirm live (per IMPLEMENTATION_CONVENTIONS item 4 — a query, not file inspection) that: both tables show `relrowsecurity = true` and `relforcerowsecurity = true`; `trg_transaction_inherit_currency`, `trg_transaction_apply_balance`, `trg_transaction_validate_budget_scope`, and `trg_audit_transaction` all appear on `transaction`'s trigger list (and `trg_audit_transaction_split` on `transaction_split`'s); `rpc_create_transaction` and `fn_validate_transaction_budget_scope` show no `anon` grant (and `fn_validate_transaction_budget_scope` shows no `authenticated` grant either).
3. Manually create one test transaction against `ohhsteward-dev` through the deployed RPC and confirm the referenced account's `current_balance` (or `balance_owed`, for a credit card account) changed by the correct signed amount, and that a `transaction_split` row and two `audit_log_entry` rows (transaction + split) exist for it.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations directory (new tables, triggers, RPC — see Code Requirements); `tests/rls/rls-ci-01.test.ts` (new coverage, item 13); Add Transaction UI on both `apps/web` and `apps/mobile`.

**Expected integration behavior:** one shared creation RPC (`rpc_create_transaction`) called from platform-specific form components on both clients; no separate API layer, consistent with ATD §1's "both clients talk directly to Supabase's client SDK" architecture.

**Data flow impact:** `transaction` becomes the parent of `transaction_split` (this story, extended by Story 3.2) and the write source that drives `account.current_balance`/`balance_owed` via the now-attached `fn_apply_transaction_to_balance()` trigger (Story 2.2's deferred obligation) and inherits `currency` via the now-attached `fn_inherit_transaction_currency()` trigger (Story 2.4's deferred obligation).

**Dependencies to add/update:** none new.

**Constraints:** must not bypass the two attached triggers by setting `current_balance`, `balance_owed`, or `currency` directly from the RPC — those remain trigger-owned fields, exactly as they were designed to be when Stories 2.2 and 2.4 deferred their attachment to this story. Must not redefine `fn_apply_transaction_to_balance()`, `fn_inherit_transaction_currency()`, or `fn_audit_log()` — attach only.

### Change Impact

- What changes: New `transaction` and `transaction_split` tables; new `rpc_create_transaction`; first-time attachment of two pre-existing deferred trigger functions; one new cross-tenant validation trigger; audit triggers on both new tables.
- What it touches: `account.current_balance`/`balance_owed` (via the now-live balance trigger), `audit_log_entry` (via the now-live audit triggers), `category` (read-only reference).
- Breaking risk: No — net-new tables and RPC; nothing existing is altered or redefined.

### Branch Name

feature/3.1-manual-transaction-entry

### Commit Message

3.1: Add manual transaction entry — transaction/transaction_split schema, rpc_create_transaction, attach deferred balance and currency triggers

### Pull Request Description

Maps to each Acceptance Criterion:
- AC1: `rpc_create_transaction` requires `p_account_id`, `p_description`, `p_amount`, and `p_date`; the transaction is saved via one atomic RPC call.
- AC2: `p_category_id` is nullable throughout — the RPC, the `transaction_split.category_id` column, and the form all treat "no category" as a first-class, error-free state.
- AC3: `direction` defaults to `'expense'` both at the column level (`DEFAULT 'expense'`) and the RPC parameter level.
- AC4: `time`, `store`, and `category_id` are all nullable with no RPC-side requirement.
- AC5 (negative security): `can_access_budget()` is checked explicitly inside `rpc_create_transaction`, derived from the referenced account rather than any client-supplied budget id — an unauthorized caller's request is rejected and creates no row.

Also closes two deferred obligations from earlier stories: `fn_apply_transaction_to_balance()` (DIP-2.2-v2) and `fn_inherit_transaction_currency()` (DIP-2.4-v2) are both attached to `transaction` for the first time, without modification to either function body.

### Jira Linkage

- PDE Story ID: 3.1
- Jira Epic Key: STEW-3
- Jira Story Key: STEW-18

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-3.1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests locally and merges manually.

Include full diffs for every file created or modified in the completion report — not a summary. For the two functions this DIP requires to remain byte-for-byte unmodified (`fn_apply_transaction_to_balance()`, `fn_inherit_transaction_currency()`), include `git diff dev [branch] -- [migration files that would touch them]` showing zero output as explicit proof no redefinition slipped in.

### Confidence Assessment

- **Confidence Score:** 85
- **Reasoning:** Both deferred functions were read in full from the live database this session and their attachment requirements (which operations, BEFORE vs AFTER, column scoping) were derived directly from their actual bodies rather than assumed — the single highest-risk element of this story (silently redefining or misattaching either) is now fully mechanical rather than a judgment call. The RPC's authorization design applies a pattern already proven correct elsewhere in this codebase (deriving tenant scope from the referenced row, never the caller). The score is not higher because this is the first story to combine three separate non-trivial DB-layer mechanisms in one migration (two deferred-trigger attachments, one new cross-tenant validation trigger, RLS-CI-01 extension) — first-pass execution accuracy across all three, verified against local Supabase CLI testing before any PR opens, is what determines whether this lands cleanly.
- **Top Risk Areas:** (1) Misattaching `fn_apply_transaction_to_balance()` to INSERT only instead of INSERT/UPDATE/DELETE would silently break balance correctness on any future edit/delete story without failing loudly now, since 3.1 itself never exercises the UPDATE/DELETE branches — local testing should explicitly insert, update, and delete a test transaction and check `account.current_balance`/`balance_owed` after each. (2) The deliberate absence of an INSERT RLS policy on both new tables (a deviation from the `account` table's `FOR ALL` precedent) is easy to "fix" by a well-meaning future change that adds one back for convenience — Implementation Instructions item 13(b)'s test exists specifically to catch that regression. (3) The RLS-CI-01 additions in item 13 are a real, committed-test obligation, not a suggestion — per IMPLEMENTATION_CONVENTIONS item 5's own history (STEW-16, STEW-38), "verified locally and it passed" without a corresponding committed test is not sufficient DIP-completion evidence.

### ⚠️ Open Questions to be Answered Before Moving Forward

None. (The `category`-via-`transaction_split` schema reading and the RLS INSERT-policy deviation are both resolved design decisions, documented above with rationale, not open questions — see Grounding Check and Implementation Instructions item 3.)

# Story 5.1 — Budget Period Types & Rollover

**Revision Note:** A full DIP (`DIP-5.1-v1`) was drafted for this story on 2026-09-04, before any implementation existed — it predates Story 2.1's actual RLS design, Story 2.3's category household-scoping, Story 2.4's currency FK model, and every established `IMPLEMENTATION_CONVENTIONS.md` item. This is `DIP-5.1-v2`, re-grounded against the live `ohhsteward-dev` schema, the actual `dev` branch source, and all 7 standing conventions. It supersedes v1. Material corrections found during grounding:

1. **No first period was ever created.** v1's rollover job only handles budgets that already have a current period ("most recent `budget_period.period_end < current_date`"). A brand-new Budget has zero `budget_period` rows, so AC1 ("when the period ends, a new period is created") could never fire for it — there'd be nothing to end. `rpc_create_budget` must be extended to create the Budget's first period atomically at creation time.
2. **`budget_period` had no DB-level immutability.** v1's Do-NOT-implement list said "no update path exists for a `budget_period` row after `period_end` has passed" — but its own Code Requirements gave the table a permissive `for all using (can_access_budget(budget_id))` RLS policy, identical in shape to `budget`'s, which *does* permit client-side `UPDATE`. Relying on "we just don't build a UI for it" is not a DB-enforced boundary and conflicts with Domain Invariant 2 (RLS is the authorization boundary, not app-layer convention). Fixed: `budget_period` gets a SELECT-only policy; no INSERT/UPDATE/DELETE policy exists for any client role at all.
3. **`category_limit` had no cross-household validation.** `category` became household-scoped (not budget-scoped) in Story 2.3, which postdates v1. `category_limit.category_id` and `category_limit.budget_period_id` (→ `budget_id` → `household_id`) are two independently-referenced tenant anchors — a plain `REFERENCES` only proves the category row exists, not that it belongs to the *same* household as the budget. This is exactly the cross-tenant referential-safety gap the Standing Conventions (Part A §7 rule 6) require a trigger for, and it's the same shape as `transaction_split`'s existing `fn_validate_transaction_split_category_scope()` (Story 3.2) — v1 predates that precedent too.
4. **No DB-level enforcement that AC3 ("only that period is affected") actually holds.** v1's item 8 said this was "enforced simply by requiring the caller to pass the specific `budget_period_id`" — but nothing stopped a caller from passing a *closed* period's id and editing history. Fixed with a dedicated `BEFORE UPDATE` trigger.
5. **Rollover mechanism simplified.** v1 specified a `pg_cron`-scheduled Edge Function reached via `pg_net` (mirroring `send-invite-email`'s pattern). That hop exists in this codebase specifically to reach an *external* email provider. Rollover is pure internal `budget_period`/`category_limit` manipulation with no external call — `pg_cron` invoking a `SECURITY DEFINER` SQL function directly is simpler, atomic (one transaction, no HTTP failure mode to handle), and removes an unnecessary network-reachable Edge Function endpoint. `pg_cron` (extension available, not yet installed) already logs every run to `cron.job_run_details`, covering DVP §5's "diagnose a missed run" without new logging code. This is a Persona-5-level implementation-mechanism choice within the ATD's stated intent ("Edge Functions + pg_cron: scheduled/background work"), not a contradiction of it — flagged here rather than silently substituted.
6. **Real Jira key found:** STEW-23 (was `TBD` in `BACKLOG_DIP.md`'s v1).

---

**Review Summary Strip:** Story ID: 5.1 | Objective: Support monthly/biweekly periods with copy-forward rollover | Core Change: `budget_period`/`category_limit` entities, budget-creation bootstrap, `pg_cron`-scheduled rollover, category-limit upsert RPC | Risk Level: Medium | Confidence Score: 86 | Blocking Issues: None | ClaudeCode Ready: Yes

**User Story:** As a Budget owner, I want my Budget's period (monthly or biweekly) to roll over automatically with the same limits as last period, so that I don't have to rebuild it each time — but nothing changes unless I edit it.

**Acceptance Criteria:**
1. Given a Budget with a set period type, when the period ends, then a new period is created with Category limits copied forward exactly from the prior period.
2. Given a newly rolled-over period, when the user has not edited it, then its limits remain static — they do not increase due to unspent surplus.
3. Given a Budget owner, when they edit the current period's limits, then only that period is affected — historical periods remain unchanged.
4. Given a Budget's period type is changed (monthly ↔ biweekly), when the change is saved, then it takes effect starting the next period, not retroactively.

**Dependencies & Assumptions:** Depends on Story 2.1 (Budget entity — live), 2.3 (Categories — live). Interacts with Story 5.2 (surplus Transfer), which per its own draft runs "within the same job as Story 5.1" — this DIP's rollover function is written so a later migration can extend it, not replace it. Assumption carried forward: `category_limit.limit_amount` has no currency field of its own (the schema doesn't attach one), so how a limit is compared against multi-currency spend is Story 6.2's concern, not this story's — this story only ever copies `limit_amount` forward byte-for-byte, never interprets it.

**Traceability:** PIB Objective: "Budget periods: monthly and biweekly, static, copy-forward." PSDD Capability: Budgeting Mechanics; PSDD Journey G.

**Change Impact:**
- What changes: Two new tables (`budget_period`, `category_limit`); `rpc_create_budget` extended (body only, same signature) to bootstrap the first period; new `rpc_upsert_category_limit`; new `fn_rollover_budget_periods()` + `pg_cron` schedule.
- What it touches: `budget` (read-only, via `rpc_create_budget`'s existing transaction), `category` (read-only, via the new cross-tenant trigger).
- Breaking risk: No — additive schema, and `rpc_create_budget`'s signature is unchanged (existing callers on web/mobile need no changes).

--- ClaudeCode HANDOFF SECTION ---

**Implementation Intent + Technical Constraints:**
Implement period rollover as a copy-forward operation triggered on a daily `pg_cron` schedule, with historical periods immutable once closed **at the database layer**, not by UI omission. Bootstrap every Budget's first period atomically at creation. Do NOT implement: automatic limit increases based on leftover surplus (explicitly ruled out); retroactive application of a period-type change to past or the currently-open period; any client-callable path (RPC or direct table write) that can INSERT, UPDATE, or DELETE a `budget_period` row; any UI screen for editing Budget settings or category limits (Epic 6/Dashboard's concern — this story delivers the data-layer capability those screens will call, per ATD §1's framing of Epic 5 as backend mechanics feeding Epic 6's UI); Story 5.2's surplus-Transfer logic.

**ClaudeCode Execution Safety:** Status: Safe | Idempotent: No for the rollover function itself (creates new rows), but retry-safe (unique-index-guarded) | Reason: Well-specified, additive schema with a clear immutability boundary; the one genuinely new piece of infrastructure is enabling the `pg_cron` extension, which is a one-line, low-risk migration statement.
Standing Rule: Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it. This rule governs security *policy*, not secure *implementation*: the Secure Coding Baseline below always applies and is never out of scope.

**Standing Rule scope clarification:** the Standing Rule forbids changing security *policy* — who may do what, which roles exist, which endpoints are protected, what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

---

### Story Summary

Implements the `budget_period`/`category_limit` data layer: every Budget gets its first period the moment it's created; a daily `pg_cron` job closes any period whose `period_end` has passed and opens the next one, copying every category limit forward unchanged; historical periods and their limits become genuinely unwritable at the database layer once closed; and a new `rpc_upsert_category_limit` gives an owner a safe, validated way to set or change the *current* period's limits. No UI is built by this story — Story 6.1/6.2 (Dashboard) is where a user will actually see and edit this data; this story makes that possible.

### Repo Target

Supabase migrations only (`supabase/migrations/`). No `apps/web` or `apps/mobile` changes — there is currently no Budget list/detail/settings screen anywhere in either app (the web dashboard is still the Story-1.1.G1 placeholder with plain links; `apps/web/app/dashboard/budgets/` has only a creation form). Building that screen belongs to Story 6.1, which is explicitly the "Budget/Period picker" story and depends on this one.

### Grounding Check

- **Schema verified live** (not assumed from ATD prose) via `list_tables` on `ohhsteward-dev`: `budget` already has `period_type text not null check (period_type in ('monthly','biweekly'))` and `default_currency char(3) references currency(code)` (Story 2.4). `category` is `(id, household_id, name, is_deleted, created_at)` — household-scoped, confirming finding 3 above. Neither `budget_period` nor `category_limit` exists yet — clean slate at the schema level.
- **`budget`'s existing RLS** (`supabase/migrations/20260905022638_budget_rls_foundation.sql`): a single permissive policy, `budget_read_write for all using (is_household_parent(household_id) or can_access_budget(id))`. Story 2.4's migration already relies on this same policy for direct client `UPDATE` of `default_currency` — confirmed by that migration's own comment. AC4's period-type change is satisfied the identical, already-precedented way: a direct client `.update({ period_type })` against `budget`, no new RPC needed. The rollover function reads `budget.period_type` fresh at rollover time rather than snapshotting it onto a period row, which is what actually makes "takes effect next period, not retroactively" true — this is stated as a mechanism, not left implicit.
- **`rpc_create_budget`'s live signature**: `rpc_create_budget(p_name text, p_period_type text, p_owner_member_ids uuid[])`, `SECURITY DEFINER`, already row-locks `household` for the budget-cap check. This story's change is body-only (adds the first-period insert inside the same transaction) — the parameter list is unchanged, so `create or replace function` is safe; no `DROP`/overload risk per the PostgREST overload hazard noted in Story 3.2's DIP.
- **Convention 1 (RLS enable+force):** both new tables ship with `enable row level security` + `force row level security` in the same migration that creates them.
- **Convention 2 (audit trigger):** `trg_audit_budget_period` and `trg_audit_category_limit` attached as the last step for each table, reusing `fn_audit_log()` — no redefinition.
- **Convention 3 (explicit anon revoke):** `rpc_upsert_category_limit` and `fn_rollover_budget_periods` both get `revoke all on function ... from public, anon` — `fn_rollover_budget_periods` additionally revokes from `authenticated` (cron-only, never client-callable, mirroring `fn_validate_transaction_split_category_scope`'s all-three revoke).
- **Convention 4 (confirm the grant live):** the Deployment Instructions below specify the live verification query, not a re-read of the migration file.
- **Convention 5 (RLS-CI-01 full cross-check against DVP §3):** re-read in full this session. Of DVP §3's RLS-CI-01 bullets, the ones this story's new tables/functions bear on: "As Member A: SELECT/INSERT/UPDATE/DELETE against Budget X succeeds; against Budget Y fails" → new `describe` block below extends this to `budget_period`/`category_limit`. "As unauthenticated: any query — must fail" → covered, asserting outcome not mechanism (Convention 7). The SQL-metacharacter case does **not** newly apply: neither `budget_period` nor `category_limit` has a free-text field (dates and numerics only) — stated explicitly rather than silently skipped.
- **Convention 6 (mobile keyboard):** not applicable — no mobile screen is added by this story.
- **Convention 7 (RLS-CI-01 "must fail" assertions tolerate either failure shape):** applied throughout the new test cases below — every unauthenticated-denial assertion checks `(data ?? []).length === 0`, never a specific error code or `error: null`.
- **Trust boundary named:** `rpc_upsert_category_limit`'s three parameters (`p_budget_period_id`, `p_category_id`, `p_limit_amount`) are the only client-supplied input this story introduces. All three are validated server-side: `p_budget_period_id` and `p_category_id` are looked up and checked for household/budget membership rather than trusted at face value (mirroring `rpc_upsert_category`'s anti-IDOR fix), and `p_limit_amount`'s type is enforced by the function's own `numeric` parameter typing plus a `> 0` constraint at the table level (matching `account`/`transaction`'s existing `check (amount > 0)` pattern — a limit of zero or negative has no meaningful interpretation).
- **Infrastructure prerequisite confirmed live:** `pg_cron` extension is available (`default_version 1.6.4`) but not yet installed on `ohhsteward-dev` (`installed_version: null`) — this migration installs it. `pg_net` is already installed (used by Story 1.2's invite flow) but is not needed here, since the simplified mechanism (finding 5) has no external call.

### Acceptance Criteria

1. Given a Budget with a set period type, when the period ends, then a new period is created with Category limits copied forward exactly from the prior period.
2. Given a newly rolled-over period, when the user has not edited it, then its limits remain static — they do not increase due to unspent surplus.
3. Given a Budget owner, when they edit the current period's limits, then only that period is affected — historical periods remain unchanged.
4. Given a Budget's period type is changed (monthly ↔ biweekly), when the change is saved, then it takes effect starting the next period, not retroactively.
5. **(Negative security/integrity AC)** Given `fn_rollover_budget_periods()` fires twice for the same Budget/boundary (retry or overlapping cron run), when the second run executes, then the unique index on `(budget_id, period_start)` prevents a duplicate period from being created — handled as a no-op, not a data-corrupting second insert.
6. **(Negative security AC)** Given a Budget owner attempts to call `rpc_upsert_category_limit` against a `budget_period_id` whose `period_end` has already passed, then the call is rejected and no row is inserted or modified — historical limits cannot be rewritten through this or any other client-facing path.
7. **(Negative security AC)** Given a Budget owner attempts to call `rpc_upsert_category_limit` with a `category_id` belonging to a different household than the target `budget_period`'s Budget, then the call is rejected at the database layer (trigger), independent of any application-level check.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria. Any implementation that goes beyond the ACs is out of scope for this story. If additional work appears needed beyond the ACs, surface it as a Blocking Question — do not silently expand scope. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it. This rule governs security policy, not secure implementation: the Secure Coding Baseline below always applies and is never out of scope.
2. **Standing Rule scope clarification (verbatim):** the Standing Rule forbids changing security policy — who may do what, which roles exist, which endpoints are protected, what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement (explicit list):**
   - Do NOT increase a rolled-over period's limits based on unspent surplus — limits are copied exactly, static until explicitly edited (AC2).
   - Do NOT retroactively apply a `period_type` change to historical or the currently-open period (AC4).
   - Do NOT create any client-callable RPC or RLS policy that allows INSERT, UPDATE, or DELETE on `budget_period` — period rows are created exclusively by `rpc_create_budget` (first period) and `fn_rollover_budget_periods()` (subsequent periods), both `SECURITY DEFINER`/cron-invoked, never by a client session.
   - Do NOT allow `rpc_upsert_category_limit` to write to a closed period, under any caller (enforced twice: inside the RPC and by the `BEFORE UPDATE` trigger, as defense-in-depth).
   - Do NOT build any web or mobile UI screen — this story is data-layer only (see Repo Target).
   - Do NOT implement Story 5.2's surplus-Transfer logic.
   - Do NOT reach the rollover job through an Edge Function/`pg_net` HTTP hop — `pg_cron` calls the SQL function directly (finding 5).
4. Create `budget_period`: `id uuid pk default gen_random_uuid()`, `budget_id uuid not null references budget(id)`, `period_start date not null`, `period_end date not null`, `created_at timestamptz not null default now()`. `create unique index uq_budget_period_boundary on budget_period(budget_id, period_start)`.
5. `alter table budget_period enable row level security; alter table budget_period force row level security;` — **one policy only**: `create policy budget_period_read on budget_period for select using (can_access_budget(budget_id));`. No INSERT/UPDATE/DELETE policy of any kind.
6. Attach `trg_audit_budget_period` (`fn_audit_log()`, reused, not redefined).
7. Create `category_limit`: `id uuid pk default gen_random_uuid()`, `budget_period_id uuid not null references budget_period(id)`, `category_id uuid not null references category(id)`, `limit_amount numeric not null check (limit_amount > 0)`. `create unique index uq_category_limit_period_category on category_limit(budget_period_id, category_id)`.
8. `alter table category_limit enable row level security; alter table category_limit force row level security;` — **one policy only**: `create policy category_limit_read on category_limit for select using (can_access_budget((select budget_id from budget_period where id = budget_period_id)));`. No INSERT/UPDATE/DELETE policy — all writes go through `rpc_upsert_category_limit` (`SECURITY DEFINER`) and the rollover function.
9. Attach `trg_audit_category_limit`.
10. Create `fn_validate_category_limit_household_scope()` — `BEFORE INSERT OR UPDATE OF budget_period_id, category_id ON category_limit`, `SECURITY DEFINER`, mirroring `fn_validate_transaction_split_category_scope()` exactly: look up the budget's `household_id` via `budget_period_id → budget_period.budget_id → budget.household_id`, look up `category_id`'s `household_id` directly, `raise exception` if they differ or either is null. Revoke execute from `public, anon, authenticated` (trigger-only, never client-callable).
11. Create `fn_enforce_open_period_only()` — `BEFORE UPDATE ON category_limit`, `SECURITY DEFINER`: look up `old.budget_period_id`'s `period_end`; if `period_end < current_date`, `raise exception 'cannot edit limits for a closed period'`. Fires on UPDATE only (never blocks the rollover job's legitimate INSERTs into a brand-new, not-yet-closed period). Revoke execute from `public, anon, authenticated`.
12. Create `fn_compute_period_end(p_period_type text, p_period_start date) returns date` — `monthly`: last day of `p_period_start`'s calendar month (`(date_trunc('month', p_period_start) + interval '1 month - 1 day')::date`); `biweekly`: `p_period_start + 13`. Raise exception on any other `p_period_type` value (defensive; the table CHECK already constrains `budget.period_type`, but this function must not silently do the wrong thing if ever called with a stray value). `SECURITY DEFINER`, revoked from `public, anon, authenticated` — internal helper only, called from the two functions below.
13. **Modify `rpc_create_budget`** (`create or replace function` — same signature, no `DROP` needed): immediately after the existing `insert into budget (...) returning id into v_new_budget`, add: compute `v_period_start := current_date`, `v_period_end := fn_compute_period_end(p_period_type, v_period_start)`, then `insert into budget_period (budget_id, period_start, period_end) values (v_new_budget, v_period_start, v_period_end)`. Everything else in the function (household lookup, cap check row-lock, owner-loop insert, return) is unchanged.
14. Create `rpc_upsert_category_limit(p_budget_period_id uuid, p_category_id uuid, p_limit_amount numeric) returns uuid`, `SECURITY DEFINER`, `set search_path = public`: look up `v_budget_id` from `budget_period where id = p_budget_period_id` (server-derived, `p_budget_period_id` is the only period-identifying input — no separate `p_budget_id` parameter for a caller to mismatch, same anti-IDOR shape as `rpc_upsert_category`); if not found, `raise exception 'period not found'`; if `not can_access_budget(v_budget_id)`, `raise exception 'not authorized for this budget'`; `insert into category_limit (budget_period_id, category_id, limit_amount) values (p_budget_period_id, p_category_id, p_limit_amount) on conflict (budget_period_id, category_id) do update set limit_amount = excluded.limit_amount returning id into v_id; return v_id;` — the "period still open" check and the cross-household category check are both enforced by the two triggers above (rather than duplicated inline), so both the RPC and any hypothetical future direct write are equally protected.
15. Create `fn_rollover_budget_periods() returns void`, `SECURITY DEFINER`, `set search_path = public`: for every `budget` (not `is_deleted`) whose most recent `budget_period` (by `period_start desc`, one row via a `distinct on (budget_id)` or lateral join) has `period_end < current_date`: wrap each budget's processing in its own `begin ... exception when others then raise warning '...'` block (one budget's failure does not abort the batch); compute `v_next_start := <that period's period_end> + 1`, `v_next_end := fn_compute_period_end(<that budget's current, live> period_type, v_next_start)`; `insert into budget_period (...)`, catching `unique_violation` as an expected no-op (AC5); on successful insert, `insert into category_limit (budget_period_id, category_id, limit_amount) select <new_period_id>, category_id, limit_amount from category_limit where budget_period_id = <closing_period_id>` (copy-forward, byte-identical `limit_amount`, satisfying AC1/AC2).
16. `revoke all on function rpc_upsert_category_limit(uuid, uuid, numeric), fn_rollover_budget_periods(), fn_compute_period_end(text, date), fn_validate_category_limit_household_scope(), fn_enforce_open_period_only() from public, anon;` and additionally `revoke all on function fn_rollover_budget_periods(), fn_compute_period_end(text, date), fn_validate_category_limit_household_scope(), fn_enforce_open_period_only() from authenticated;` (cron/trigger-only). `grant execute on function rpc_upsert_category_limit(uuid, uuid, numeric) to authenticated;`
17. `create extension if not exists pg_cron;` then `select cron.schedule('rollover-budget-periods-daily', '0 3 * * *', $$select fn_rollover_budget_periods();$$);` — 03:00 UTC daily, chosen as an off-peak hour with no stated latency requirement; adjust only if Joseph has a preference, not a Blocking Question.

### Code Requirements

```sql
create table budget_period (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budget(id),
  period_start date not null,
  period_end date not null,
  created_at timestamptz not null default now()
);
create unique index uq_budget_period_boundary on budget_period(budget_id, period_start);

alter table budget_period enable row level security;
alter table budget_period force row level security;
create policy budget_period_read on budget_period
  for select using (can_access_budget(budget_id));

create trigger trg_audit_budget_period after insert or update or delete
  on budget_period for each row execute function fn_audit_log();

create table category_limit (
  id uuid primary key default gen_random_uuid(),
  budget_period_id uuid not null references budget_period(id),
  category_id uuid not null references category(id),
  limit_amount numeric not null check (limit_amount > 0)
);
create unique index uq_category_limit_period_category
  on category_limit(budget_period_id, category_id);

alter table category_limit enable row level security;
alter table category_limit force row level security;
create policy category_limit_read on category_limit
  for select using (
    can_access_budget((select budget_id from budget_period where id = budget_period_id))
  );

create trigger trg_audit_category_limit after insert or update or delete
  on category_limit for each row execute function fn_audit_log();

create function fn_validate_category_limit_household_scope() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_budget_household_id uuid;
  v_category_household_id uuid;
begin
  select b.household_id into v_budget_household_id
    from budget_period bp join budget b on b.id = bp.budget_id
   where bp.id = new.budget_period_id;

  select household_id into v_category_household_id
    from category where id = new.category_id;

  if v_budget_household_id is null or v_category_household_id is null
     or v_budget_household_id <> v_category_household_id then
    raise exception 'category does not belong to this budget''s household';
  end if;
  return new;
end;
$$;
revoke all on function fn_validate_category_limit_household_scope()
  from public, anon, authenticated;

create trigger trg_category_limit_validate_household_scope
  before insert or update of budget_period_id, category_id on category_limit
  for each row execute function fn_validate_category_limit_household_scope();

create function fn_enforce_open_period_only() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_period_end date;
begin
  select period_end into v_period_end from budget_period where id = old.budget_period_id;
  if v_period_end < current_date then
    raise exception 'cannot edit limits for a closed period';
  end if;
  return new;
end;
$$;
revoke all on function fn_enforce_open_period_only() from public, anon, authenticated;

create trigger trg_category_limit_enforce_open_period
  before update on category_limit
  for each row execute function fn_enforce_open_period_only();

create function fn_compute_period_end(p_period_type text, p_period_start date)
returns date
security definer set search_path = public language plpgsql as $$
begin
  if p_period_type = 'monthly' then
    return (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date;
  elsif p_period_type = 'biweekly' then
    return p_period_start + 13;
  else
    raise exception 'unknown period_type: %', p_period_type;
  end if;
end;
$$;
revoke all on function fn_compute_period_end(text, date) from public, anon, authenticated;

-- rpc_create_budget: body-only change (same signature) -- insert added
-- immediately after the existing `insert into budget ... returning id`.
-- Full function restated for clarity; every other line is unchanged from
-- the live version.
create or replace function rpc_create_budget(
  p_name text,
  p_period_type text,
  p_owner_member_ids uuid[]
) returns uuid
security definer
set search_path = public
language plpgsql as $$
declare
  v_household_id uuid;
  v_caller_member_id uuid;
  v_caller_is_parent boolean;
  v_budget_count int;
  v_budget_cap int;
  v_new_budget uuid;
  v_owner_id uuid;
  v_period_start date;
  v_period_end date;
begin
  select hm.id, hm.household_id, (hm.role = 'parent')
    into v_caller_member_id, v_household_id, v_caller_is_parent
    from household_member hm
   where hm.auth_user_id = auth.uid() and not hm.is_deleted
   limit 1;

  if v_caller_member_id is null then
    raise exception 'not an active household member';
  end if;

  if not v_caller_is_parent and not (v_caller_member_id = any(p_owner_member_ids)) then
    raise exception 'members may only create a budget for themselves';
  end if;

  select budget_cap into v_budget_cap
    from household where id = v_household_id for update;

  select count(*) into v_budget_count
    from budget where household_id = v_household_id and not is_deleted;

  if v_budget_count >= v_budget_cap then
    raise exception 'household budget cap reached';
  end if;

  insert into budget (household_id, name, period_type, created_by)
  values (v_household_id, p_name, p_period_type, v_caller_member_id)
  returning id into v_new_budget;

  -- New: bootstrap the Budget's first period (Revision Note item 1).
  v_period_start := current_date;
  v_period_end := fn_compute_period_end(p_period_type, v_period_start);
  insert into budget_period (budget_id, period_start, period_end)
  values (v_new_budget, v_period_start, v_period_end);

  foreach v_owner_id in array p_owner_member_ids loop
    insert into budget_owner (budget_id, household_member_id)
    values (v_new_budget, v_owner_id);
  end loop;

  return v_new_budget;
end;
$$;
-- Grants unchanged from the live function (same signature): already
-- `revoke all ... from public` + `grant execute ... to authenticated`;
-- STEW-33 already revoked `anon` execute on this function. No grant
-- statement needs to be re-run for an unchanged signature/grant set.

create function rpc_upsert_category_limit(
  p_budget_period_id uuid,
  p_category_id uuid,
  p_limit_amount numeric
) returns uuid
security definer
set search_path = public
language plpgsql as $$
declare
  v_budget_id uuid;
  v_id uuid;
begin
  select budget_id into v_budget_id
    from budget_period where id = p_budget_period_id;

  if v_budget_id is null then
    raise exception 'period not found';
  end if;

  if not can_access_budget(v_budget_id) then
    raise exception 'not authorized for this budget';
  end if;

  insert into category_limit (budget_period_id, category_id, limit_amount)
  values (p_budget_period_id, p_category_id, p_limit_amount)
  on conflict (budget_period_id, category_id)
  do update set limit_amount = excluded.limit_amount
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function rpc_upsert_category_limit(uuid, uuid, numeric) from public, anon;
grant execute on function rpc_upsert_category_limit(uuid, uuid, numeric) to authenticated;

create function fn_rollover_budget_periods() returns void
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

    exception
      when unique_violation then
        -- AC5: a duplicate firing for the same (budget_id, period_start)
        -- is an expected, already-handled no-op, not an error.
        null;
      when others then
        raise warning 'rollover failed for budget %: %', r.budget_id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function fn_rollover_budget_periods() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule(
  'rollover-budget-periods-daily',
  '0 3 * * *',
  $$select fn_rollover_budget_periods();$$
);
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

**Application to this story:** Obligation 1: `fn_rollover_budget_periods()` builds every insert from bound `record` fields (`r.budget_id`, `v_next_start`, etc.), never string-built SQL — the only "dynamic" element is `p_period_type`, which is validated against a closed set (`'monthly'`/`'biweekly'`) inside `fn_compute_period_end` and raises on anything else. Obligation 6/7: every write path (`rpc_create_budget`'s extension, `rpc_upsert_category_limit`, both triggers, `fn_rollover_budget_periods`) is `SECURITY DEFINER` with an explicit `anon`/`authenticated` revoke matching Convention 3 — `fn_rollover_budget_periods` and the two trigger functions are revoked from `authenticated` too, since nothing about them should ever be client-callable, only cron/trigger-invoked. Obligation 10: `rpc_upsert_category_limit`'s two failure modes ("period not found", "not authorized for this budget") and the two triggers' exceptions ("cannot edit limits for a closed period", "category does not belong to this budget's household") are all short, generic, non-leaking messages — no SQL text, no internal identifiers beyond the ones the caller already supplied. Obligation 12: the `uq_budget_period_boundary` unique index is what makes a duplicate `pg_cron` firing idempotent (AC5); `fn_rollover_budget_periods`'s per-budget `exception when others` block additionally ensures one budget's failure can't abort or partially-corrupt another budget's rollover in the same run.

### API Contract

Client-facing: `supabase.rpc('rpc_upsert_category_limit', { p_budget_period_id, p_category_id, p_limit_amount })` — returns the `category_limit` row's `id` (uuid) on success; raises `'period not found'`, `'not authorized for this budget'`, `'cannot edit limits for a closed period'`, or `'category does not belong to this budget''s household'` on failure (all generic, no internal detail). Period-type changes go through the already-existing `supabase.from('budget').update({ period_type })` path (no new contract — same shape as the already-shipped `default_currency` update). Internal only: `fn_rollover_budget_periods()`, invoked exclusively by `pg_cron` — not reachable via PostgREST (revoked from `authenticated`/`anon`; also `returns void`, which PostgREST does not expose as a callable RPC by default, matching `fn_apply_transaction_to_balance`'s and `fn_inherit_transaction_currency`'s precedent for trigger-shaped/internal functions).

### Non-Functional Requirements

**Performance:** Rollover runs once daily across all Budgets with a due period — bounded, low-frequency batch work, not a per-request cost. `rpc_upsert_category_limit` is a single indexed upsert.

**Scalability:** Bounded by total Budget count across all households — trivial at this platform's confirmed low-volume, capped-household profile (ATD §4.2).

**Reliability:** Historical-period immutability (DB-enforced, not UI-enforced) plus the unique-index-guarded idempotent rollover make this safe to retry without manual intervention. The per-budget exception block means one malformed Budget can't take down the whole day's rollover run for every other household.

**Security:** ASVS chapters in scope: V1/V4 (Access Control/Architecture — `budget_period`'s SELECT-only RLS is a structural, not conventional, immutability guarantee; `category_limit`'s write path is exclusively a validated `SECURITY DEFINER` RPC). Trust boundary: `rpc_upsert_category_limit`'s three parameters are the only client input this story accepts — `p_budget_period_id`/`p_category_id` are re-derived and re-checked server-side rather than trusted (anti-IDOR, matching `rpc_upsert_category`'s established fix), `p_limit_amount` is constrained by both the function's `numeric` typing and the table's `check (limit_amount > 0)`. Sensitive data: none (no PII, no financial-account data — consistent with ATD §4.1's structural no-PII posture). Weaknesses excluded: CWE-362 (unique-index-guarded rollover idempotency), CWE-639/IDOR (server-derived authorization lookups in `rpc_upsert_category_limit`, mirroring Story 2.3's fix), CWE-284 (Improper Access Control — `budget_period`'s complete absence of a write policy, rather than an unenforced convention, is what actually prevents any client role from mutating history).

### Observability

`pg_cron`'s own `cron.job_run_details` table (native to the extension, no new code) records every `rollover-budget-periods-daily` run's start/end time and success/failure status — sufficient to diagnose a missed or failed run per ATD §4.5's solo-developer-appropriate observability guidance, and consistent with DVP §5's decision to defer bespoke structured logging infrastructure. `fn_rollover_budget_periods`'s per-budget `raise warning` on an unexpected failure surfaces in Supabase's Postgres logs, correlated by `budget_id` (not by any sensitive value).

### Files to Create/Modify

- New migration file under `supabase/migrations/` (e.g. `<timestamp>_budget_period_rollover.sql`) containing everything in Code Requirements above, in the order given in Implementation Instructions.
- No `apps/web` or `apps/mobile` files — see Repo Target.

### Migration Files

See Code Requirements above — this is the complete migration content, written to disk and validated locally (`supabase db reset`) before being proposed against the remote `ohhsteward-dev` project, which Joseph applies manually per the Migration Rule.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-23

1. Apply the migration locally first (`supabase db reset` against the local CLI stack) and confirm it applies cleanly and `npm run test:rls` passes before proposing anything against the remote project.
2. Joseph applies the migration file manually against `ohhsteward-dev` (per the standing Migration Rule — CC does not touch the remote project).
3. **Confirm the grant, live, per Convention 4** — run against `ohhsteward-dev` after the migration is applied:
   ```sql
   select p.proname, g.grantee, g.privilege_type
   from information_schema.routine_privileges g
   join information_schema.routines r on r.specific_name = g.specific_name
   join pg_proc p on p.proname = r.routine_name
   where r.routine_schema = 'public'
     and p.proname in ('rpc_upsert_category_limit', 'fn_rollover_budget_periods',
                        'fn_compute_period_end', 'fn_validate_category_limit_household_scope',
                        'fn_enforce_open_period_only');
   -- anon must not appear for any of the five. authenticated must appear
   -- ONLY for rpc_upsert_category_limit.
   ```
   ```sql
   select relname, relrowsecurity, relforcerowsecurity
   from pg_class where relname in ('budget_period', 'category_limit');
   -- both true for both tables (Convention 1).
   select polname, polcmd from pg_policies
   where tablename in ('budget_period', 'category_limit');
   -- exactly one row per table, polcmd = 'r' (SELECT only) for both.
   ```
4. Confirm the cron schedule registered: `select * from cron.job where jobname = 'rollover-budget-periods-daily';`.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations only. `rpc_create_budget` (existing function, body-only change). No Edge Function, no `apps/web`/`apps/mobile` change.

**Expected integration behavior:** Every new Budget gets a first period the instant `rpc_create_budget` returns. From then on, rollover is entirely server-scheduled (`pg_cron`) — no client code triggers it, polls for it, or needs to know it happened. A future Dashboard screen (Story 6.1) will read `budget_period`/`category_limit` via the existing `can_access_budget`-scoped SELECT policies and will call `rpc_upsert_category_limit` for edits — no schema or RLS change anticipated for that story to consume this one.

**Data flow impact:** `budget_period`/`category_limit` become the basis for Story 5.2's surplus Transfer (reads `budget_period.period_end`/`id`) and Story 6.1/6.2's Dashboard period navigation and pacing calculation (reads both tables, compares `category_limit.limit_amount` against aggregated `transaction_split` amounts — that comparison logic belongs to 6.2, not here).

**Dependencies to add/update:** `pg_cron` extension (enabled by this migration; already available on the project, confirmed via `list_extensions`). No new npm/Deno dependency.

**Constraints:** No client-callable path may ever INSERT, UPDATE, or DELETE a `budget_period` row. No client-callable path may write `category_limit` except through `rpc_upsert_category_limit`, and never against a closed period.

### Change Impact

- What changes: Two new tables (`budget_period`, `category_limit`) with SELECT-only RLS; `rpc_create_budget` extended (body-only) to bootstrap the first period; new `rpc_upsert_category_limit`, `fn_rollover_budget_periods`, `fn_compute_period_end`, and two validation triggers; `pg_cron` extension enabled and one daily schedule registered.
- What it touches: `budget` and `category` (read-only lookups from the new functions/triggers); no existing table's schema, RLS, or data is altered.
- Breaking risk: No.

### Branch Name

feature/5.1-budget-period-rollover

### Commit Message

5.1: Add budget period/category limit tables with daily rollover and period bootstrap

### Pull Request Description

Implements Story 5.1 (STEW-23): every Budget now gets its first period at creation; a daily `pg_cron` job closes due periods and copies category limits forward unchanged (AC1/AC2); historical periods and their limits are immutable at the database layer, not just by convention (AC3); period-type changes apply from the next rollover since the job always reads the live `budget.period_type` value rather than a snapshot (AC4). Maps each AC to: AC1/AC2 → `fn_rollover_budget_periods`'s copy-forward insert; AC3 → `category_limit`'s SELECT-only RLS plus the two `BEFORE` triggers plus `rpc_upsert_category_limit`'s period-open check; AC4 → the rollover function's live read of `budget.period_type`; AC5 → `uq_budget_period_boundary` plus the `unique_violation` catch; AC6 → `fn_enforce_open_period_only`; AC7 → `fn_validate_category_limit_household_scope`.

### Jira Linkage

- PDE Story ID: 5.1
- Jira Epic Key: STEW-5 (Epic 5: Budgeting Mechanics — verify exact key at execution time if it has changed)
- Jira Story Key: STEW-23

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-5.1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually. Include full diffs for every file in the completion report — not a summary.

### Confidence Assessment

- **Confidence Score:** 86/100
- **Reasoning:** Every table/column name, RLS pattern, and RPC convention in this DIP was verified against the live `ohhsteward-dev` schema and the actual `dev` branch source this session, not assumed from the ATD's prose or the stale 2026-09-04 draft — five material gaps in that draft were found and closed (first-period bootstrap, DB-enforced `budget_period` immutability, cross-household category validation, DB-enforced closed-period protection on `category_limit`, and a simplified rollover mechanism with a stated rationale for departing from the ATD's literal "Edge Function" wording). The score isn't higher because the rollover function's `distinct on (budget_id) ... order by period_start desc` query pattern, while standard, is new to this codebase (no prior story does a "most recent row per group" query) and deserves a close look in review; and because `fn_compute_period_end`'s monthly boundary math, while textbook, has zero existing test coverage in this codebase to compare against.
- **Top Risk Areas:**
  1. The rollover function's correctness under two adjacent edge cases deserves careful test coverage: a Budget whose period_type changes on the exact day its period would have rolled over anyway, and a biweekly Budget crossing a calendar-month or year boundary.
  2. This is the first `pg_cron` schedule in the project — confirm after deployment that the schedule actually fires (via `cron.job_run_details`) rather than assuming registration alone means it's running.
  3. `category_limit.limit_amount` has no currency association in this schema; Story 6.2 will need to resolve how a limit is compared against multi-currency spend — flagged here as a forward dependency, not a gap in this story's own scope.

### ⚠️ Open Questions to be Answered Before Moving Forward

None — no genuine blocking ambiguity remains. The rollover cron time (03:00 UTC) and the "no UI in this story" scope call are both stated as reasoned defaults above rather than left open; either can be revisited on request without reopening this DIP's core design.

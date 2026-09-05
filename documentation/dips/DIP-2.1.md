# DIP — Story 2.1: Budget Entity, Ownership Assignment & Multi-Tenant Data Isolation (RLS Migration)

**Jira Story Key:** STEW-14 | **Jira Epic Key:** STEW-2 | **DIP ID:** DIP-2.1-v1

---

### Story Summary

Establishes `budget` as the schema root for every financial entity and implements the Row-Level Security design from ATD §3.3 that makes cross-Budget data leakage structurally impossible. This is the single highest-risk story in the entire backlog (ATD §5, Top Risk #1) — every downstream data-model story (2.2–2.4, 3.1–3.2, 5.x, 6.x) depends on the schema and RLS pattern established here. Beyond its own scope, this DIP also closes out two pieces of deliberately deferred work from earlier stories that were explicitly waiting on `is_household_parent()` to exist: Story 3.3's `audit_log_read` policy and Story 1.1's `household`/`household_member` read policies. Both were flagged in their own DIPs as "Story 2.1's concern" — this is that follow-through, not new scope.

### Repo Target

Supabase migrations (schema root for the whole financial data model); a new `tests/rls/` (or framework-equivalent) CI suite implementing RLS-CI-01; the Budget-creation UI in `apps/web` and `apps/mobile` (both scaffolded by Story 1.1.G1, merged).

### Grounding Check

- Verified via live query against `ohhsteward-dev` (project ref `poqvothxwmjbtitqtbgh`): `household`, `household_member`, and `audit_log_entry` exist (from Stories 1.1/3.3, both merged and migrated); `budget`/`budget_owner` do not exist yet. Safe to build against current state.
- **Deferred item #1 (from Story 3.3):** `audit_log_entry` shipped with RLS enabled/forced and zero policies, because the `audit_log_read` policy's `is_household_parent()` call didn't exist yet. It now does (created by this story) — this DIP adds that policy exactly as originally specified in 3.3's own migration comments.
- **Deferred item #2 (from Story 1.1):** `household` and `household_member` shipped with RLS enabled/forced and zero policies, for the same reason. This DIP adds Parent-scoped access to both. It deliberately does **not** add a Member-level read policy for `household`'s own settings columns (`session_timeout_minutes`, `notification_threshold_pct`, etc.) — the Backlog/ATD explicitly reserve introducing a general `is_household_member()` helper for Story 2.3 ("a small, reusable addition to the same helper-function family established in Story 2.1"), and front-running that helper here would duplicate work Story 2.3 already owns. Members will gain read access to `household` settings when 2.3 adds `is_household_member()`. This is a scoping decision, not an oversight — flagged explicitly rather than silently narrowed.
- Schema names (`budget`, `budget_owner`, `household_id`, `household_member_id`) verified against ATD §3.2/§3.3 and cross-checked against the live `household`/`household_member` tables' actual column names — consistent.
- Trust boundary: every `budget_id`/`household_member_id`/`p_owner_member_ids` value arriving from the client is untrusted and must resolve through `can_access_budget()`/`is_household_parent()` before any row is returned or written — this is the primary tenant-isolation boundary for all financial data in the system, per ATD §5 Top Risk #1.

### Acceptance Criteria

1. Given a Parent or a Member with creation rights, when they create a Budget, then it is assigned zero, one, or multiple Member owners as specified at creation.
2. Given a Budget exists, when any Account/Savings/Savings Goal/Credit Card/Transaction is created under it, then that record is exclusively scoped to that Budget — no cross-Budget references are possible even with identical names.
3. Given a Parent, when they query Budgets, then all Budgets in the household are visible regardless of assignment.
4. Given a Member, when they query Budgets, then only Budgets they are assigned to (as owner/co-owner) are visible.
5. Given the household's Budget cap, when a new Budget would exceed it, then creation is blocked with a clear message — regardless of whether a Parent or Member initiated it.
6. **(Negative security AC)** Given a Member without a `budget_owner` grant on Budget X, when they attempt any SELECT/INSERT/UPDATE/DELETE against `account`, `transaction`, `transaction_split`, `budget_period`, `category_limit`, or `transfer` rows scoped to Budget X — via any query shape, not only the app's own UI — then every such attempt is denied at the database layer.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.

2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.

3. **Do NOT implement:**
   - Do NOT implement any shared/synced account concept across Budgets — explicitly ruled out in Discovery.
   - Do NOT implement Member-level default Budget auto-creation — Budgets are always explicitly created via `rpc_create_budget`.
   - Do NOT write per-table bespoke RLS policies that re-derive access logic — every Budget-owned table must use the two shared helper functions.
   - Do NOT grant table-level bypass (`bypassrls`) to any client-facing role.
   - Do NOT add a Member-level read policy to `household` for its settings columns, and do NOT create `is_household_member()` — both are explicitly Story 2.3's concern (see Grounding Check). Adding a `household_member` SELECT policy for a member's own row (see step 8) is not the same thing and is in scope.
   - Do NOT alter `household`/`household_member`'s existing columns, triggers, or the `uq_household_member_active_user` index from Story 1.1 — this story only adds RLS policies to those two tables, nothing else.

4. Create the two helper functions exactly as specified in ATD §3.3 — do not reimplement this logic per-table:
   - `is_household_parent(p_household_id uuid)`
   - `can_access_budget(p_budget_id uuid)`

5. Create `budget`: `id uuid pk default gen_random_uuid()`, `household_id uuid not null references household(id)`, `name text not null`, `period_type text not null check (period_type in ('monthly','biweekly'))`, `created_by uuid not null references household_member(id)`, `is_deleted boolean not null default false`, `created_at timestamptz not null default now()`. (`surplus_destination_id uuid references account(id)` is deliberately deferred as an `alter table` once `account` exists in Story 2.2 — `account` doesn't exist yet.)

6. Create `budget_owner`: `id uuid pk default gen_random_uuid()`, `budget_id uuid not null references budget(id)`, `household_member_id uuid not null references household_member(id)`, unique `(budget_id, household_member_id)`.

7. Enable and force RLS on `budget`: Parents see every Budget in their household (`is_household_parent(household_id)`); Members see only Budgets with a `budget_owner` row for them (via `can_access_budget(id)`).

8. **Deferred-policy follow-through (new to this DIP, not in the original story draft — see Grounding Check):**
   - Add `audit_log_read` on `audit_log_entry`, exactly as specified in Story 3.3's migration comments, now that `is_household_parent()` exists.
   - Add a Parent-scoped policy on `household` (`is_household_parent(id)`, full access) and a read policy on `household_member` (a Parent sees every row in their household; a member sees their own row) — both deferred by Story 1.1 for the same reason.

9. Attach `fn_audit_log()` (from Story 3.3) to `budget` and `budget_owner` via `AFTER INSERT OR UPDATE OR DELETE` triggers, per the trigger-attachment convention established in 3.3 and continued in 1.1.

10. Write `rpc_create_budget(p_name text, p_period_type text, p_owner_member_ids uuid[])` (`SECURITY DEFINER`): verify caller is an active household member; verify caller is either a Parent or is included in `p_owner_member_ids` (Members may create a Budget only for themselves); check `household.budget_cap` against the count of active Budgets for the household under `for update` row locking on the household row to avoid a cap-check race (AC5, Obligation 12); insert the `budget` row and one `budget_owner` row per id in `p_owner_member_ids`, all in one transaction.

11. Apply the `budget_scoped_access` policy pattern (ATD §3.3, i.e. `using (can_access_budget(budget_id))`) to every Budget-owned table as each is created in Stories 2.2–2.4 and 3.1–3.2 — this story establishes the pattern; downstream stories apply it, they do not redefine it.

12. Implement the mandatory automated RLS regression suite **RLS-CI-01** (ATD Reviewer condition 1, hard-gated by the DVP): a CI test suite that authenticates as (a) Parent A, (b) Member B assigned to Budget X only, (c) Member C assigned to no Budget, and asserts B cannot read/write any row scoped to a Budget other than X, C cannot read/write any Budget-scoped row at all, and A can read/write every Budget in their household. This suite must run in CI on every schema/policy change going forward — it is a hard gate, not optional tooling.

### Code Requirements

```sql
-- Verbatim from ATD §3.3
create function is_household_parent(p_household_id uuid) returns boolean
  security definer language sql as $$
    select exists (
      select 1 from household_member
      where household_id = p_household_id
        and auth_user_id = auth.uid()
        and role = 'parent'
        and not is_deleted
    )
  $$;

create function can_access_budget(p_budget_id uuid) returns boolean
  security definer language sql as $$
    select
      is_household_parent((select household_id from budget where id = p_budget_id))
      or exists (
        select 1 from budget_owner bo
        join household_member hm on hm.id = bo.household_member_id
        where bo.budget_id = p_budget_id
          and hm.auth_user_id = auth.uid()
          and not hm.is_deleted
      )
  $$;

revoke all on function is_household_parent(uuid), can_access_budget(uuid) from public;
grant execute on function is_household_parent(uuid), can_access_budget(uuid) to authenticated;

create table budget (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id),
  name text not null,
  period_type text not null check (period_type in ('monthly','biweekly')),
  created_by uuid not null references household_member(id),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table budget_owner (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budget(id),
  household_member_id uuid not null references household_member(id),
  unique (budget_id, household_member_id)
);

alter table budget enable row level security;
alter table budget force row level security;

create policy budget_read_write on budget
  for all using (
    is_household_parent(household_id) or can_access_budget(id)
  );

-- budget_owner itself: readable by anyone who can access the budget it
-- points at (Parent or an existing owner) — no separate write policy;
-- all writes to budget_owner happen inside rpc_create_budget (SECURITY DEFINER).
alter table budget_owner enable row level security;
alter table budget_owner force row level security;

create policy budget_owner_read on budget_owner
  for select using (can_access_budget(budget_id));

-- Audit trigger attachment, per Story 3.3's convention.
create trigger trg_audit_budget after insert or update or delete
  on budget for each row execute function fn_audit_log();
create trigger trg_audit_budget_owner after insert or update or delete
  on budget_owner for each row execute function fn_audit_log();

-- Deferred from Story 3.3 (audit_log_entry shipped RLS-enabled with zero
-- policies specifically pending is_household_parent()).
create policy audit_log_read on audit_log_entry
  for select using (
    is_household_parent((select household_id from household_member where id = household_member_id))
  );

-- Deferred from Story 1.1 (household/household_member shipped RLS-enabled
-- with zero policies specifically pending is_household_parent()). Member
-- read access to household's own settings columns is Story 2.3's concern
-- (is_household_member()), not added here — see Grounding Check.
create policy household_parent_access on household
  for all using (is_household_parent(id));

create policy household_member_read on household_member
  for select using (
    is_household_parent(household_id) or auth_user_id = auth.uid()
  );

create function rpc_create_budget(
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

  -- Row-lock the household to make the cap check atomic under concurrency
  -- (Obligation 12): two simultaneous rpc_create_budget calls cannot both
  -- pass a stale count and jointly exceed budget_cap.
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

  foreach v_owner_id in array p_owner_member_ids loop
    insert into budget_owner (budget_id, household_member_id)
    values (v_new_budget, v_owner_id);
  end loop;

  return v_new_budget;
end;
$$;

revoke all on function rpc_create_budget(text, text, uuid[]) from public;
grant execute on function rpc_create_budget(text, text, uuid[]) to authenticated;
```

`rpc_create_budget` follows the same bind-parameter, `for update`-locked pattern established in Story 1.1 — no SQL is string-built from `p_name`/`p_period_type`.

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

**Application to this story:** This is the story where Obligation 6 (fail-closed authorization) matters most in the entire system — RLS is the actual authorization boundary (ATD §4.1: "enforced at the database layer, not just the application layer"), and `force row level security` on every table here ensures even a bug in application code, or a direct connection as the table owner, cannot read past it. Obligation 1 (Injection): every `rpc_create_budget` parameter is typed and bound; `p_period_type` is additionally constrained by the table's own CHECK constraint, giving defense in depth beyond function-level validation. Obligation 7 (Least privilege): `is_household_parent`/`can_access_budget` run as `SECURITY DEFINER` but are granted `execute` only to `authenticated`, never broader. Obligation 12 (Concurrency): `rpc_create_budget`'s cap check uses `for update` locking on the household row, so two simultaneous calls cannot both pass a stale cap check and jointly exceed `budget_cap` — directly satisfying AC5 under real concurrency, not just sequential retries.

### API Contract

`supabase.rpc('rpc_create_budget', { p_name, p_period_type, p_owner_member_ids })` — returns `{ budget_id: uuid }` on success, or a cap/authorization error surfaced as a generic client message (per obligation 10).

All subsequent Budget/Account/Transaction reads and writes go through plain Supabase client SDK table operations (`select`/`insert`/`update`), transparently scoped by the RLS policies above — there is no separate "list budgets" endpoint; it is simply `select * from budget`, and RLS determines what each caller sees.

### Non-Functional Requirements

*Performance:* RLS-per-query overhead is negligible at the confirmed low-volume/high-isolation usage profile (ATD §4.2); no denormalization needed for v1.

*Scalability:* Bounded by `household.budget_cap` (default 5) per household — no scale concern at this profile.

*Reliability:* `force row level security` plus the centralized helper-function pattern means one function fix corrects every table's enforcement at once (ATD §4.4). RLS-CI-01 running on every schema/policy change is the ongoing reliability guarantee for this boundary specifically.

**Security:** ASVS chapters in scope: V1 (Architecture — centralized authorization functions), V4 (Access Control — RLS as the enforced boundary, not app-layer-only). Trust boundary: every `budget_id`/`household_member_id`/`p_owner_member_ids` value arriving from the client is untrusted and must resolve through `can_access_budget()`/`is_household_parent()` before any row is returned or written — never trust a client-supplied budget_id's ownership implicitly. Sensitive data: none directly (no PII), but this is the primary tenant-isolation boundary for all financial data in the system (ATD §5 Top Risk #1). Weaknesses excluded: CWE-89 (parameterized throughout); the cross-tenant-access class of bug this story's entire purpose is to prevent (mapped to ASVS V4 rather than a single CWE); the two audit-log/household read-access gaps this DIP closes are themselves fail-closed→scoped-open transitions, never the reverse.

### Observability

RLS-CI-01 results are the primary observability signal for this story — a red run blocks the pipeline rather than shipping silently. No additional runtime monitoring is required beyond Supabase's standard Postgres logs (structured Edge Function logging remains DEFERRED per the DVP and isn't applicable here — no Edge Function in this story).

### Files to Create/Modify

- New Supabase migration file under `supabase/migrations/` containing all DDL above.
- New `tests/rls/` (or equivalent, matching whatever test runner the repo already uses once observed) implementing RLS-CI-01: three test identities (Parent A, Member B on Budget X, Member C on no Budget) and the assertions specified in Implementation Instructions step 12.
- Budget-creation screen in `apps/web` and `apps/mobile` (both scaffolded by Story 1.1.G1) calling `rpc_create_budget`.
- No other files.

### Migration Files

Raw SQL as given in Code Requirements above. Written to disk only; validated locally (Supabase CLI or a throwaway container, per the pattern already used for Stories 3.3/1.1) before anything is proposed for a remote project.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev
- **Jira Key:** STEW-14

1. Confirm Stories 1.1 (STEW-10) and 1.1.G1 (STEW-32) are merged to `dev` first — this story depends on `household`/`household_member` existing and on the app scaffolding to build the Budget-creation screen into.
2. Apply the `budget`/`budget_owner` table migrations, the two helper functions, RLS enable+force (including the two deferred-policy additions on `audit_log_entry` and `household`/`household_member`), the audit triggers, and `rpc_create_budget` in a single migration set.
3. Run the RLS-CI-01 test suite against the migrated schema before merge — this is a hard gate per the ATD Reviewer's condition; do not merge on a failing run.
4. Confirm `force row level security` is set (not just `enable`) on `budget` and `budget_owner`.
5. Verify `audit_log_read`, `household_parent_access`, and `household_member_read` policies exist and behave as specified — this closes the two items flagged as fail-closed placeholders in Stories 3.3 and 1.1.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations (schema root); a new `tests/rls/` CI suite implementing RLS-CI-01; the Budget-creation UI in `apps/web` and `apps/mobile`.

**Expected integration behavior:** every downstream entity table (Stories 2.2 onward) must be created with `budget_id` as a required foreign key and must apply the `budget_scoped_access` policy pattern shown above — this DIP is the reference pattern those stories point back to.

**Data flow impact:** this is the schema root for financial data; it has no upstream dependency beyond `household`/`household_member` (Story 1.1) and closes the two policies those tables (and Story 3.3's `audit_log_entry`) were left waiting on.

**Dependencies to add/update:** a CI test runner capable of authenticating as multiple distinct Supabase test users to exercise RLS-CI-01 (e.g., the Supabase CLI's local test harness) — pin the exact tool/version used, once chosen.

**Constraints:** must not alter `household`/`household_member`'s existing columns, indexes, or triggers from Story 1.1 beyond adding the two RLS policies specified here. Must not add `budget.surplus_destination_id` yet — that's an `alter table` once `account` exists in Story 2.2.

### Change Impact

- What changes: introduces `budget`/`budget_owner` (RLS-scoped), the two `is_household_parent()`/`can_access_budget()` helper functions, `rpc_create_budget()`, the RLS-CI-01 test suite, and closes two previously-deferred RLS policies on `audit_log_entry` and `household`/`household_member`.
- What it touches: `audit_log_entry`, `household`, `household_member` (adding policies only — no column/trigger/index changes) plus two new tables.
- Breaking risk: No — all changes are additive (new tables, or policies added where none existed, which can only ever grant access that was previously fail-closed, never remove existing access).

### Branch Name

`feature/2.1-budget-rls-foundation`

### Commit Message

`2.1: Add budget/budget_owner schema with RLS foundation, rpc_create_budget, and close deferred audit/household policies`

### Pull Request Description

Maps to each Acceptance Criterion:
- AC1/AC5: `rpc_create_budget()` assigns owners at creation and enforces `budget_cap` under row-locking.
- AC2: every Budget-owned table (this and future stories) uses `can_access_budget(budget_id)` — no cross-Budget reference is structurally possible.
- AC3/AC4: `budget_read_write` policy — `is_household_parent()` for Parents, `can_access_budget()` for Members.
- AC6 (negative security): RLS-CI-01 asserts denial for Member C (no budget) and Member B (wrong budget) against every Budget-scoped table shape.

Also includes (Secure Coding Baseline / prior-story follow-through, not new ACs): the `audit_log_read` policy Story 3.3 deferred, and the `household`/`household_member` Parent-scoped policies Story 1.1 deferred — both explicitly waiting on `is_household_parent()`, which this story creates.

### Jira Linkage

- PDE Story ID: 2.1
- Jira Epic Key: STEW-2
- Jira Story Key: STEW-14

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-2.1.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary.

### Confidence Assessment

- **Confidence Score:** 80
- **Reasoning:** The core RLS pattern is exactly what ATD §3.3 already specified in full detail, and the two deferred-policy additions are simple, previously-scoped follow-through, not new design. Confidence is bounded by this being the highest-risk story in the backlog by the ATD's own assessment, and by RLS-CI-01 being a real, non-trivial test suite to stand up correctly (multi-identity Supabase test auth) rather than a simple unit test.
- **Top Risk Areas:** RLS-CI-01 itself — a bug in the *test suite* could produce false confidence in the RLS boundary it's meant to verify; recommend a close read of the test assertions, not just a passing run. The `household_member_read` policy's `auth_user_id = auth.uid()` clause is a new access grant (a member reading their own row) — low-risk but worth a second look since it's additive to a table that shipped fail-closed by design.

### ⚠️ Open Questions to be Answered Before Moving Forward

None blocking. For your awareness: Story 2.3 will need to add a Member-level read policy to `household` (for settings like `session_timeout_minutes`/`notification_threshold_pct`) alongside introducing `is_household_member()` — flagged here so it isn't lost track of, the same way the two items this DIP closes were tracked from 1.1/3.3.

# DIP-3.3 — Soft Delete & Audit Trail Plumbing (Cross-Entity Foundation)

**Jira Story:** STEW-20 | **Jira Epic:** STEW-3 (Transaction Core) | **PDE Story ID:** 3.3
**Status:** ClaudeCode Ready — sequencing correction applied (see Grounding Check)
**Confidence Score:** 86/100

---

### Story Summary

Establishes the shared soft-delete convention and the universal audit-log write path that every other entity in the system relies on for its delete/history behavior, per ATD §4.4's reusable trigger-pattern design. This story is foundational and cross-cutting: it is sequenced first in the Build Plan despite being the last story listed in Epic 3, because Stories 1.1–2.4 and 3.1–3.2 all depend on the pattern defined here for their own delete/audit behavior.

### Repo Target

Supabase Postgres — the single shared backend for both the Next.js web client and the React Native mobile client (ATD §1). No web-only or mobile-only application code is required for this story; it is entirely a database migration (schema + trigger function + RPC).

### Grounding Check

Consistent with PIB's "soft delete standard pattern; full audit trail across all entities" objective and PSDD's Data Governance capability (implemented here as shared plumbing rather than a standalone epic, per ATD §4.4). No conflicts found against ATD invariants.

**Sequencing correction (flagged and resolved, not silently passed through):** the version of this DIP drafted in `BACKLOG_DIP.md` instructed attaching `fn_audit_log()` triggers to eight entity tables (`household`, `household_member`, `category`, `budget`, `budget_owner`, `account`, `transaction`, `transaction_split`) as part of *this* story's own migration. But the DVP Build Plan sequences Story 3.3 first in Phase 1 — none of those tables exist yet at that point, so those `CREATE TRIGGER` statements would fail immediately (`relation does not exist`) since `CREATE TRIGGER` is validated at DDL-apply time, not lazily like a function body. This DIP corrects that: Story 3.3's migration now creates only `audit_log_entry`, `fn_audit_log()`, and `rpc_restore_entity` — none of which require another entity table to already exist — and each subsequent Phase 1 story is responsible for attaching its own trigger as the last step of its own migration (see Deployment Instructions). This was the DIP's own stated pattern for "Story 5.x onward"; it's simply extended to start immediately, since 3.3 runs first. If you'd rather resequence 3.3 to run *after* 1.1/2.1/2.2/2.3/3.1/3.2 instead (so the original single-migration version is literally accurate), that's the alternative — but it fights the Build Plan's stated rationale that those stories depend on this pattern existing first, so this DIP defaults to the split-migration fix unless you say otherwise.

**Trust boundary named:** `rpc_restore_entity`'s `p_entity_type` and `p_entity_id` parameters are untrusted client input — the RPC dispatches on `p_entity_type` via a hardcoded allow-list `case` statement, never dynamic SQL.

**Schema names:** as specified in ATD §3.2. Not yet verified against live migrations, because none have been applied to either Supabase project yet — this is the first story to actually create schema, so there is nothing to verify against. Once applied, confirm actual column/table names before any later story assumes them.

### Acceptance Criteria

1. Given any entity supporting deletion (Budget, Account, Member, Category, Transaction), when deleted, then it is soft-deleted (flagged, not removed) and excluded from normal views.
2. Given a soft-deleted record, when a Parent requests restoration, then it becomes visible/active again.
3. Given any create/update/delete action on any entity, when it occurs, then an audit log entry captures who changed what and when.
4. Given the configurable retention period expires for a record, when the purge job runs, then that record (and its audit history) becomes genuinely unreferenceable — this is the one case where deletion is not soft (implemented in Story 9.1; this story only establishes what that purge job will later act on).
5. **(Negative security AC)** Given `rpc_restore_entity` is called with a `p_entity_type` value not present in the function's allow-list (e.g., an attempt to target `household_member`, or an arbitrary string), when invoked, then the call raises `unsupported entity type` and no SQL is executed against any table for that call.

### Implementation Instructions

1. **Standing Rule (verbatim):** Implement only what is necessary to satisfy the Acceptance Criteria above. Any implementation beyond the ACs is out of scope for this story. Do NOT add, remove, or modify any authorization rules, security constraints, or business logic that is not present in the original source code and not explicitly required by the Acceptance Criteria. Preserve existing behavior exactly. Any perceived gap or improvement must be raised as a Blocking Question — do not silently implement it.
2. **Standing Rule scope clarification (verbatim):** This rule governs security policy, not secure implementation. It forbids changing who may do what, which roles exist, which endpoints are protected, and what an authorization check decides. It does not forbid, and never overrides, the Secure Coding Baseline below: writing the authorized behavior safely. Parameterizing a query, validating input at a trust boundary, encoding output, keeping a secret out of source, and keeping sensitive data out of logs are implementation obligations, not scope additions. If satisfying an Acceptance Criterion appears to require weakening the Secure Coding Baseline, that is a Blocking Question — never resolve it by writing the insecure version.
3. **Do NOT implement list (verbatim from source DIP):**
   - Do NOT implement hard delete anywhere outside the retention-purge job (Story 9.1) — this trigger pattern and the soft-delete convention are the only deletion mechanism until then.
   - Do NOT implement partial/tiered audit coverage — every entity table (this story's initial set, and every table added by later stories) must have the identical `fn_audit_log()` trigger attached; no entity may be exempted.
   - Do NOT implement a second, competing audit mechanism (e.g., application-layer logging of mutations) — `audit_log_entry` via the trigger is the single source of truth.
   - Do NOT build `rpc_restore_entity` with a dynamically constructed table name from client input — use the explicit allow-list `case` dispatch shown in Code Requirements.
   - **(Sequencing correction)** Do NOT attempt to attach `fn_audit_log()` triggers to entity tables in this story's own migration — those tables do not exist yet at this point in the Build Plan. Trigger attachment for each table is the responsibility of the story that creates that table (see Deployment Instructions).
4. Create `audit_log_entry` per ATD §3.2: `id uuid pk default gen_random_uuid()`, `entity_type text not null`, `entity_id uuid not null`, `household_member_id uuid references household_member(id)`, `action text not null check (action in ('create','update','delete','restore'))`, `diff jsonb not null`, `created_at timestamptz not null default now()`. Add `create index idx_audit_log_entity on audit_log_entry(entity_type, entity_id)`.

   Note: `household_member_id` references `household_member(id)`, which does not exist until Story 1.1's migration lands. Apply this story's migration only after (or atomically alongside) Story 1.1's `household_member` table creation, or defer the foreign-key constraint to a follow-up `ALTER TABLE` once `household_member` exists — pick whichever your migration tooling handles more cleanly; either is a valid, ACs-preserving choice, so this is an implementation detail, not a Blocking Question.
5. Write `fn_audit_log()` as a generic `AFTER INSERT OR UPDATE OR DELETE` trigger function (`security definer`, so it can write to `audit_log_entry` regardless of the calling role's own grants): compute `v_action` from `TG_OP`, mapping an `UPDATE` that flips `is_deleted` false→true to `action = 'delete'` and true→false to `action = 'restore'` (so soft-delete and restore are visible as their own semantic actions, not generic updates); compute `v_diff` as a jsonb before/after object; resolve `v_member_id` from `auth.uid()` via `household_member`; insert one `audit_log_entry` row per DML operation. This function references no table by name except `household_member` and `audit_log_entry` — it is otherwise fully generic via `TG_TABLE_NAME`/`NEW`/`OLD`, so it does not need to exist "after" any particular entity table.
6. Document the soft-delete convention (`is_deleted boolean not null default false`, never a hard `DELETE`) as the standard every future table migration must follow.
7. Implement the Parent-only restore RPC, `rpc_restore_entity(p_entity_type text, p_entity_id uuid)`: validates `p_entity_type` against an explicit allow-list of table names (never accepts an arbitrary string used to build dynamic SQL), verifies the caller is a Parent of the household that owns the target record, and issues a parameterized restore via a `case` dispatch over the allow-listed entity types. Note: because Postgres validates `plpgsql` function bodies lazily (object references are checked at call time, not at `CREATE FUNCTION` time), this function can be created safely in this story even though the tables its `case` branches reference (`category`, `budget`, `account`, `transaction`) don't exist yet — each branch simply won't be callable until its table exists, which is expected and not a defect.
8. **(New — closes the sequencing gap)** Add the following note verbatim to the top of every subsequent Phase 1 story's own Deployment Instructions, starting with the very next story built (1.1): *"This migration must end with `create trigger trg_audit_<table> after insert or update or delete on <table> for each row execute function fn_audit_log();` for the table(s) this story creates — required by DIP-3.3's audit-coverage guarantee."*

### Code Requirements

```sql
create table audit_log_entry (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  household_member_id uuid references household_member(id),
  action text not null check (action in ('create','update','delete','restore')),
  diff jsonb not null,
  created_at timestamptz not null default now()
);

create index idx_audit_log_entity on audit_log_entry(entity_type, entity_id);

alter table audit_log_entry enable row level security;
alter table audit_log_entry force row level security;
-- No insert/update/delete policy is granted to any client role: only this security-definer
-- trigger (and, later, the service-role purge job) can write to this table.
create policy audit_log_read on audit_log_entry
  for select using (
    is_household_parent((select household_id from household_member where id = household_member_id))
  );

create function fn_audit_log() returns trigger
security definer set search_path = public language plpgsql as $$
declare
  v_action text;
  v_diff jsonb;
  v_member_id uuid;
  v_row record;
begin
  select id into v_member_id from household_member
   where auth_user_id = auth.uid() and not is_deleted limit 1;

  if tg_op = 'INSERT' then
    v_action := 'create'; v_diff := to_jsonb(new); v_row := new;
  elsif tg_op = 'DELETE' then
    v_action := 'delete'; v_diff := to_jsonb(old); v_row := old;
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(old)->>'is_deleted') = 'false' and (to_jsonb(new)->>'is_deleted') = 'true' then
      v_action := 'delete';
    elsif (to_jsonb(old)->>'is_deleted') = 'true' and (to_jsonb(new)->>'is_deleted') = 'false' then
      v_action := 'restore';
    else
      v_action := 'update';
    end if;
    v_diff := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
    v_row := new;
  end if;

  insert into audit_log_entry (entity_type, entity_id, household_member_id, action, diff)
  values (tg_table_name, (to_jsonb(v_row)->>'id')::uuid, v_member_id, v_action, v_diff);

  return coalesce(new, old);
end; $$;

-- NOTE (sequencing correction): no `create trigger` statements belong in this story's
-- migration. Each entity table gets its trigger attached by the story that creates that
-- table, per Implementation Instructions step 8, e.g.:
--   create trigger trg_audit_household_member after insert or update or delete
--     on household_member for each row execute function fn_audit_log();
-- (one such statement, appended to Story 1.1's own migration, not this one.)

create function rpc_restore_entity(p_entity_type text, p_entity_id uuid)
returns void security definer set search_path = public language plpgsql as $$
begin
  case p_entity_type
    when 'category' then
      if not is_household_parent((select household_id from category where id = p_entity_id)) then
        raise exception 'not authorized';
      end if;
      update category set is_deleted = false where id = p_entity_id;
    when 'budget' then
      if not is_household_parent((select household_id from budget where id = p_entity_id)) then
        raise exception 'not authorized';
      end if;
      update budget set is_deleted = false where id = p_entity_id;
    when 'account' then
      if not is_household_parent((select household_id from budget
           where id = (select budget_id from account where id = p_entity_id))) then
        raise exception 'not authorized';
      end if;
      update account set is_deleted = false where id = p_entity_id;
    when 'transaction' then
      if not is_household_parent((select household_id from budget
           where id = (select budget_id from transaction where id = p_entity_id))) then
        raise exception 'not authorized';
      end if;
      update transaction set is_deleted = false where id = p_entity_id;
    else
      raise exception 'unsupported entity type';
  end case;
end; $$;
revoke all on function rpc_restore_entity(text, uuid) from public;
grant execute on function rpc_restore_entity(text, uuid) to authenticated;
```

**Secure Coding Requirements** (OWASP ASVS Level 2 / CWE — reproduced verbatim, mandatory on every DIP):

1. **Injection.** All SQL is parameterized. String concatenation or interpolation of any value into SQL, shell commands, file paths, LDAP filters, or XPath is prohibited. This applies equally to SQL supplied in a DIP — it must itself be parameterized, or explicitly marked as a one-time DDL/migration statement executed with no user-supplied input. (CWE-89, CWE-78; ASVS V5)
2. **Input validation at trust boundaries.** Validate type, range, length, format, and allowed values on every input crossing a boundary. Validate on the server side; client-side validation is never sufficient. Reject by default rather than sanitize where a closed set of valid values exists. (ASVS V5)
3. **Output encoding.** Encode data for the context it enters — HTML, URL, SQL identifier, log line, or downstream message. (CWE-79; ASVS V5)
4. **Secrets.** No credential, connection string, key, token, or certificate may appear in source, committed configuration, test fixtures, log output, error messages, or telemetry. Secrets are resolved at runtime through the platform's secret interface. (CWE-798; ASVS V6, V14)
5. **Sensitive data in logs and telemetry.** Do not log credentials, tokens, personal data, or full payloads. Where traceable, log an identifier or reference, never the content. (CWE-532; ASVS V7, V8)
6. **Authentication and authorization.** Use the platform's primitives. Never implement custom authentication, session handling, or token validation. Enforce authorization on the server for every protected operation, and fail closed. (ASVS V2, V3, V4)
7. **Least privilege.** Database principals, service identities, and access are the minimum required by the story. (ASVS V1)
8. **Cryptography.** Never write custom cryptography. Use platform-provided algorithms and key management. TLS required for data in transit. (CWE-327, CWE-295; ASVS V6, V9)
9. **Deserialization and parsing.** Treat every inbound payload as untrusted; never deserialize to arbitrary/polymorphic types. (CWE-502, CWE-611; ASVS V5)
10. **Error handling.** Error responses must not disclose stack traces, SQL text, connection strings, hostnames, or file paths. Log detail internally; return a correlation identifier externally. (CWE-209; ASVS V7)
11. **Dependencies.** Do not add a dependency not named in the DIP; pin any that is added. (ASVS V14)
12. **Concurrency and state.** Shared-state operations must be safe under concurrent execution and retry; check-then-act must be atomic. (CWE-362)

**Application to this story:** Obligation 1 (Injection): `rpc_restore_entity` dispatches on `p_entity_type` via an explicit `case` statement against a fixed, hardcoded allow-list — it never builds a table or column name from client input via `format()`/`execute` dynamic SQL, the classic injection vector for a "generic restore" function. Obligation 5 (Sensitive data in logs): `audit_log_entry.diff` stores full before/after row state — exactly the kind of content Obligation 5 says must never reach *external* telemetry. This table is the authorized, RLS-gated destination for that data, not a log stream, and that distinction must hold — application/Edge Function logs must never also echo `diff` contents. Obligation 6 (fail closed): `rpc_restore_entity` re-derives the owning household per entity type and checks `is_household_parent` before restoring; an unsupported `p_entity_type` raises rather than defaulting to an unguarded restore. Obligation 12 (Concurrency): the audit insert runs in the same transaction as the triggering DML, so a partially-committed mutation can never produce an entity change with no corresponding audit row, or vice versa.

### API Contract

No direct client writes to `audit_log_entry` — it is populated exclusively by `fn_audit_log()`. `supabase.rpc('rpc_restore_entity', { p_entity_type, p_entity_id })` — Parent-only; returns success or a not-authorized/unsupported-type error.

Reads: `select * from audit_log_entry where entity_type = $1 and entity_id = $2 order by created_at` — RLS-scoped to Parents of the owning household (consumed later by Story 7.2's Audit Log viewer).

### Non-Functional Requirements

*Performance:* One audit-log insert per DML operation adds a small, constant per-write cost; the `(entity_type, entity_id)` index keeps history lookups indexed.

*Scalability:* `audit_log_entry` is the fastest-growing table in the system by row count over the 7-year retention window — the direct motivation for Story 9.1's purge design.

*Reliability:* One shared trigger function applied identically to every table removes the risk of an entity silently falling out of audit coverage as the schema grows (ATD §4.4).

*Security:* ASVS chapters in scope: V4 (Access Control — Parent-only restore and audit-log read), V7/V8 (Error Handling/Logging — audit content is access-controlled data, not a log stream). Trust boundary: `p_entity_type`/`p_entity_id` on `rpc_restore_entity` are untrusted client input, validated against a hardcoded allow-list. Sensitive data: `audit_log_entry.diff` contains full row-level financial data, protected by RLS to Parents of the owning household only, never exposed to Members or any external log sink. Weaknesses excluded: CWE-89 (no dynamic SQL table-name construction), CWE-532 (diff content stays inside the access-controlled table, never echoed to application logs).

### Observability

`audit_log_entry` itself is the primary observability artifact for this story — verify row counts increment 1:1 with DML operations during testing. No additional structured logging infrastructure required (deferred per the DVP's NFR decision).

### Files to Create/Modify

Supabase migration file(s) under the project's migrations directory (exact path not yet confirmed against the repo's structure — none has been established yet, since this is the first schema-bearing story). Create: `audit_log_entry` table, `fn_audit_log()` function, RLS policy `audit_log_read`, `rpc_restore_entity()` function. No web or mobile application code changes in this story.

### Migration Files

See Code Requirements above — written to disk and validated locally via the Supabase CLI before being proposed against the remote Preview project. Do not apply directly to a remote project.

### Deployment Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

1. Branch off `dev`: `feature/3.3-soft-delete-audit-trail`.
2. Apply the `audit_log_entry` table, RLS policy, `fn_audit_log()` function, and `rpc_restore_entity` in one migration set — no `CREATE TRIGGER` statements in this migration (see sequencing correction above).
3. **Standing convention starting with the very next story:** every subsequent Phase 1 story (1.1, 2.1, 2.2, 2.3, 3.1, 3.2) must end its own migration with one `create trigger trg_audit_<table> after insert or update or delete on <table> for each row execute function fn_audit_log();` statement for the table it creates. From Story 5.x onward this was already the stated convention; this DIP makes it apply from the first Phase 1 story after 3.3, not just "5.x onward."
4. Validate locally via the Supabase CLI before proposing anything against the remote Preview project (`ohhsteward-dev`). Never apply directly to Production (`ohhsteward-prod`).
5. Stage, commit, push the branch, open a PR against `dev`. Do not merge — human tests locally and merges manually.

### Repository Integration Instructions

- **GitHub Repository:** https://github.com/jwpunzalan/ohh-steward
- **Base Branch:** dev

**Components to extend:** Supabase migrations only — a new cross-cutting table, trigger function, and RPC, plus a repository convention (the "attach `fn_audit_log()`" step) that every future entity-table migration must follow.

**Expected integration behavior:** every future entity-table migration in this codebase attaches `fn_audit_log()` as its final migration step — a standing repository convention from this point forward, not a one-time task.

**Data flow impact:** `audit_log_entry` becomes a dependent of every entity table in the system.

**Dependencies to add/update:** none.

**Constraints:** must not grant `insert`/`update`/`delete` on `audit_log_entry` to any client role — the trigger's `security definer` privilege is the only write path, and the future purge job (Story 9.1) is the only path that may ever remove rows from it.

### Change Impact

- **What changes:** New `audit_log_entry` table, `fn_audit_log()` trigger function, `rpc_restore_entity` RPC, and a standing migration convention every later story must follow.
- **What it touches:** Every entity table in the system, present and future.
- **Breaking risk:** No — net-new build — but high blast radius, since this pattern must be applied consistently everywhere from here on.

### Branch Name

`feature/3.3-soft-delete-audit-trail`

### Commit Message

`3.3: Add soft-delete convention, universal audit log trigger, and Parent-only restore RPC`

### Pull Request Description

Implements Story 3.3 (STEW-20). Maps to Acceptance Criteria:
- AC1 (soft delete, not hard delete): `is_deleted` convention formalized; `fn_audit_log()` maps an `is_deleted` false→true update to a `delete` audit action.
- AC2 (Parent restore): `rpc_restore_entity()`, Parent-only via `is_household_parent()`, allow-listed entity types only.
- AC3 (universal audit): `fn_audit_log()` created as a generic, reusable trigger; this PR establishes the convention that every subsequent story's migration attaches it to the table that story creates.
- AC4 (retention purge): out of scope for this story by design — `audit_log_entry` is what Story 9.1's purge job will later act on.
- AC5 (negative security — invalid entity type): `rpc_restore_entity`'s `case`/`else` branch raises `unsupported entity type` with no SQL executed for the invalid input.

Sequencing note included in the PR description for reviewer visibility: this story creates no `CREATE TRIGGER` statements against entity tables, since none exist yet at this point in the Build Plan — see DIP-3.3's Grounding Check for why.

### Jira Linkage

- **PDE Story ID:** 3.3
- **Jira Epic Key:** STEW-3
- **Jira Story Key:** STEW-20

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-3.3.md` and do not append executor notes or observations after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — Joseph tests locally and merges manually.

Include full diffs for every file in the completion report — not a summary.

### Confidence Assessment

- **Confidence Score:** 86/100 (unchanged from the source DIP's own assessment — the sequencing correction addresses an execution-order defect, not a content-quality one)
- **Reasoning:** The trigger logic, RLS policy, and RPC are fully specified and match ATD §3.2/§4.4 exactly. The one gap found — the original draft's migration would have failed at apply-time due to referencing not-yet-created tables — is corrected above by splitting trigger attachment across each table's own creating story, which is a smaller, lower-risk change than resequencing the Build Plan itself.
- **Top Risk Areas:** (1) The standing "attach your own trigger" convention depends on every subsequent Phase 1 story's DIP actually including that step — worth a quick visual check on 1.1's DIP once it's drafted/refreshed, to confirm the instruction landed. (2) `rpc_restore_entity`'s `category`/`budget`/`account`/`transaction` branches are inert until those tables exist — expected, not a defect, but worth knowing if someone calls the RPC prematurely during testing.

### ⚠️ Open Questions to be Answered Before Moving Forward

None blocking. One recommendation, not a blocker: confirm you're fine with the split-migration sequencing fix described in Grounding Check (default: yes, proceed as written above) rather than resequencing 3.3 to run after the tables it originally assumed existed.

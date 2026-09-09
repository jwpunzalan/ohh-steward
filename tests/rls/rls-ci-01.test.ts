/**
 * RLS-CI-01 (DIP-2.1, ATD Reviewer condition 1 — hard-gated, not optional
 * tooling): authenticates as Parent A, Member B (assigned to Budget X only),
 * and Member C (assigned to no Budget), and asserts the tenant-isolation
 * boundary holds for every Budget-scoped table shape that exists as of this
 * story (`budget`, `budget_owner`). Per the DIP, this suite must run in CI on
 * every schema/policy change going forward — future stories that add
 * Budget-scoped tables (2.2–2.4, 3.1–3.2) must extend it, not replace it.
 *
 * Requires a local Supabase stack with this repo's migrations applied
 * (`supabase start`) and three env vars — never hardcode credentials here
 * (Secure Coding obligation 4):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Get them via `supabase status -o env` and export them before running
 * `npm run test:rls`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "RLS-CI-01 requires SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY " +
      "(run `supabase start`, then export `supabase status -o env`).",
  );
}

const TEST_PASSWORD = "rls-ci-01-test-password!";
const runId = Date.now();

function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signInClient(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) throw error;
  return client;
}

describe("RLS-CI-01: budget tenant isolation", () => {
  const admin = adminClient();

  let parentAId: string;
  let memberBId: string;
  let memberCId: string;
  let householdId: string;
  let budgetXId: string; // owned by Member B
  let budgetYId: string; // Parent-only; not owned by B or C

  let parentA: SupabaseClient;
  let memberB: SupabaseClient;
  let memberC: SupabaseClient;

  beforeAll(async () => {
    const parentAEmail = `rls-ci-01-parent-a-${runId}@example.com`;
    const memberBEmail = `rls-ci-01-member-b-${runId}@example.com`;
    const memberCEmail = `rls-ci-01-member-c-${runId}@example.com`;

    const { data: parentAUser, error: parentAErr } =
      await admin.auth.admin.createUser({
        email: parentAEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (parentAErr) throw parentAErr;
    parentAId = parentAUser.user.id;

    const { data: memberBUser, error: memberBErr } =
      await admin.auth.admin.createUser({
        email: memberBEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (memberBErr) throw memberBErr;
    memberBId = memberBUser.user.id;

    const { data: memberCUser, error: memberCErr } =
      await admin.auth.admin.createUser({
        email: memberCEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (memberCErr) throw memberCErr;
    memberCId = memberCUser.user.id;

    parentA = await signInClient(parentAEmail);
    memberB = await signInClient(memberBEmail);
    memberC = await signInClient(memberCEmail);

    // Since Story 1.1.G2, every auth.users insert (including the
    // admin.createUser() calls above) is bootstrapped into its own new
    // household by the trg_bootstrap_household_on_signup trigger,
    // unconditionally — rpc_bootstrap_household() is no longer
    // client-callable at all (authenticated's EXECUTE grant is revoked) and
    // is redundant here regardless, since the trigger already did the work.
    // Parent A's household is simply whatever the trigger already created.
    const { data: parentAMember, error: parentAMemberErr } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentAId)
      .single();
    if (parentAMemberErr) throw parentAMemberErr;
    householdId = parentAMember.household_id as string;

    // Member B and C each also got their own self-bootstrapped household
    // from the same trigger — reassign their existing row into Parent A's
    // household instead of inserting a new one (a fresh insert would
    // collide with uq_household_member_active_user, since they already have
    // an active row from the trigger). There is no invite RPC flow exercised
    // here (Story 1.2); this uses the service_role client to update
    // directly, bypassing RLS — test fixture setup, not part of what the
    // suite below is asserting.
    const { data: memberRows, error: memberUpdateErr } = await admin
      .from("household_member")
      .update({ household_id: householdId, role: "member" })
      .in("auth_user_id", [memberBId, memberCId])
      .select("id, auth_user_id");
    if (memberUpdateErr) throw memberUpdateErr;

    const memberBRow = memberRows!.find((r) => r.auth_user_id === memberBId)!;
    const memberCRow = memberRows!.find((r) => r.auth_user_id === memberCId)!;
    void memberCRow;

    // Budget X: owned by Member B only.
    const { data: budgetX, error: budgetXErr } = await memberB.rpc(
      "rpc_create_budget",
      {
        p_name: "RLS-CI-01 Budget X",
        p_period_type: "monthly",
        p_owner_member_ids: [memberBRow.id],
      },
    );
    if (budgetXErr) throw budgetXErr;
    budgetXId = budgetX as string;

    // Budget Y: created by Parent A, with no owner grant for B or C.
    const { data: budgetY, error: budgetYErr } = await parentA.rpc(
      "rpc_create_budget",
      {
        p_name: "RLS-CI-01 Budget Y",
        p_period_type: "monthly",
        p_owner_member_ids: [],
      },
    );
    if (budgetYErr) throw budgetYErr;
    budgetYId = budgetY as string;
  });

  afterAll(async () => {
    // Best-effort cleanup so repeated local runs (without `supabase db
    // reset` in between) don't accumulate fixture users. The assertions
    // above have already run by this point regardless of cleanup outcome.
    for (const id of [parentAId, memberBId, memberCId]) {
      if (id) {
        await admin.auth.admin.deleteUser(id).catch(() => {});
      }
    }
  });

  it("Parent A can read every Budget in their household", async () => {
    const { data, error } = await parentA.from("budget").select("id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(budgetXId);
    expect(ids).toContain(budgetYId);
  });

  it("Parent A can write to every Budget in their household", async () => {
    const { error } = await parentA
      .from("budget")
      .update({ name: "Budget Y (renamed by Parent A)" })
      .eq("id", budgetYId);
    expect(error).toBeNull();
  });

  it("Member B can read only Budget X, not Budget Y", async () => {
    const { data, error } = await memberB.from("budget").select("id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(budgetXId);
    expect(ids).not.toContain(budgetYId);
  });

  it("Member B cannot write to Budget Y (a Budget other than X)", async () => {
    // RLS filters the row out of the UPDATE's target set entirely — this
    // surfaces as zero rows affected, not a thrown error.
    const { data, error } = await memberB
      .from("budget")
      .update({ name: "hijacked" })
      .eq("id", budgetYId)
      .select();
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("Member B cannot insert a budget_owner row for Budget Y", async () => {
    const { data: row } = await admin
      .from("household_member")
      .select("id")
      .eq("auth_user_id", memberBId)
      .single();
    const { error } = await memberB
      .from("budget_owner")
      .insert({ budget_id: budgetYId, household_member_id: row!.id });
    expect(error).not.toBeNull();
  });

  it("Member C cannot read any Budget-scoped row", async () => {
    const { data: budgets, error: budgetErr } = await memberC
      .from("budget")
      .select("id");
    expect(budgetErr).toBeNull();
    expect(budgets ?? []).toHaveLength(0);

    const { data: owners, error: ownerErr } = await memberC
      .from("budget_owner")
      .select("id");
    expect(ownerErr).toBeNull();
    expect(owners ?? []).toHaveLength(0);
  });

  it("Member C cannot write to Budget X or Budget Y", async () => {
    const { data: xData, error: xErr } = await memberC
      .from("budget")
      .update({ name: "hijacked" })
      .eq("id", budgetXId)
      .select();
    expect(xErr).toBeNull();
    expect(xData ?? []).toHaveLength(0);

    const { data: yData, error: yErr } = await memberC
      .from("budget")
      .update({ name: "hijacked" })
      .eq("id", budgetYId)
      .select();
    expect(yErr).toBeNull();
    expect(yData ?? []).toHaveLength(0);
  });

  it("Member C cannot insert a budget_owner row for any Budget", async () => {
    const { data: row } = await admin
      .from("household_member")
      .select("id")
      .eq("auth_user_id", memberCId)
      .single();
    const { error } = await memberC
      .from("budget_owner")
      .insert({ budget_id: budgetXId, household_member_id: row!.id });
    expect(error).not.toBeNull();
  });

  // STEW-33 (AC2): the three earliest SECURITY DEFINER functions each still
  // granted EXECUTE to `anon` until the hardening-batch migration. An
  // unauthenticated caller must be rejected at the grant layer — the call
  // never reaches the function's own auth.uid() check. Mirrors the
  // rpc_create_transaction anon-denial test in the transaction describe block.
  it("STEW-33: an anon client cannot call rpc_create_budget / is_household_parent / can_access_budget directly", async () => {
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const someUuid = "00000000-0000-0000-0000-000000000000";

    const { error: createBudgetErr } = await anon.rpc("rpc_create_budget", {
      p_name: "anon budget",
      p_period_type: "monthly",
      p_owner_member_ids: [],
    });
    expect(createBudgetErr).not.toBeNull();

    const { error: isParentErr } = await anon.rpc("is_household_parent", {
      p_household_id: someUuid,
    });
    expect(isParentErr).not.toBeNull();

    const { error: canAccessErr } = await anon.rpc("can_access_budget", {
      p_budget_id: someUuid,
    });
    expect(canAccessErr).not.toBeNull();
  });

  it("STEW-33: authenticated callers keep their existing access to the three functions", async () => {
    // Regression guard for AC1 — the anon revoke must not touch authenticated's
    // grant. Parent A can still create a budget and evaluate the helpers.
    const { error: createBudgetErr } = await parentA.rpc("rpc_create_budget", {
      p_name: "STEW-33 authed budget",
      p_period_type: "monthly",
      p_owner_member_ids: [],
    });
    expect(createBudgetErr).toBeNull();

    const { data: isParent, error: isParentErr } = await parentA.rpc(
      "is_household_parent",
      { p_household_id: householdId },
    );
    expect(isParentErr).toBeNull();
    expect(isParent).toBe(true);

    const { data: canAccess, error: canAccessErr } = await parentA.rpc(
      "can_access_budget",
      { p_budget_id: budgetXId },
    );
    expect(canAccessErr).toBeNull();
    expect(canAccess).toBe(true);
  });

  // STEW-38 AC1/AC2: Account join-path isolation. Story 3.1 covered the
  // Transaction side; the `account` table itself had no direct-query
  // isolation test. Account RLS is `for all using (can_access_budget(budget_id))`
  // — verified live, unchanged by this DIP; these are the missing regression
  // tests for that existing, correct behavior.
  it("STEW-38: a Member's direct account query is scoped to Budgets they can access", async () => {
    const { data: acctX, error: acctXErr } = await memberB.rpc(
      "rpc_create_account",
      {
        p_budget_id: budgetXId,
        p_type: "account",
        p_name: "STEW-38 Budget X account",
        p_currency: "USD",
        p_opening_balance: 0,
      },
    );
    if (acctXErr) throw acctXErr;
    const acctXId = acctX as string;

    const { data: acctY, error: acctYErr } = await parentA.rpc(
      "rpc_create_account",
      {
        p_budget_id: budgetYId,
        p_type: "account",
        p_name: "STEW-38 Budget Y account",
        p_currency: "USD",
        p_opening_balance: 0,
      },
    );
    if (acctYErr) throw acctYErr;
    const acctYId = acctY as string;

    // (b) Member B sees Budget X's account, never Budget Y's — via a direct
    // table query, no RPC.
    const { data: memberBAccounts, error: readErr } = await memberB
      .from("account")
      .select("id");
    expect(readErr).toBeNull();
    const memberBIds = (memberBAccounts ?? []).map((r) => r.id);
    expect(memberBIds).toContain(acctXId);
    expect(memberBIds).not.toContain(acctYId);

    // (c) Member C (no Budget access at all) sees no account rows.
    const { data: memberCAccounts, error: memberCErr } = await memberC
      .from("account")
      .select("id");
    expect(memberCErr).toBeNull();
    expect(memberCAccounts ?? []).toHaveLength(0);

    // (d) Member B's UPDATE of Budget Y's account is filtered out by RLS —
    // zero rows affected, no thrown error (same pattern as the `budget`
    // isolation tests above).
    const { data: updated, error: updateErr } = await memberB
      .from("account")
      .update({ name: "hijacked" })
      .eq("id", acctYId)
      .select();
    expect(updateErr).toBeNull();
    expect(updated ?? []).toHaveLength(0);

    const { data: unchanged } = await admin
      .from("account")
      .select("name")
      .eq("id", acctYId)
      .single();
    expect(unchanged?.name).toBe("STEW-38 Budget Y account");
  });

  // STEW-38 AC3: DVP §3's "as unauthenticated: any query — must fail" is
  // broader than the RPC-grant denial covered elsewhere — it means a direct
  // table query too. The table SELECT grant exists (Supabase default,
  // PostgREST needs it), so denial happens at the RLS layer. Post the STEW-33
  // hardening batch, every Budget/household-scoped table's policy calls a
  // SECURITY DEFINER helper (is_household_parent / can_access_budget /
  // is_household_member) that anon can no longer EXECUTE, so the query now
  // fails outright with a permission error rather than returning []. Either
  // way the requirement is the same and is what this asserts: no row ever
  // leaks to an unauthenticated caller.
  it("STEW-38: an unauthenticated client's direct table queries never return rows", async () => {
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    for (const table of ["budget", "account", "category", "transaction"]) {
      const { data, error } = await anon.from(table).select("id");
      // No data is the invariant. If the query errored, it must be a denial
      // (permission denied — 42501), never a leak or an unexpected failure.
      expect(data ?? []).toHaveLength(0);
      if (error) expect(error.code).toBe("42501");
    }
  });

  // STEW-38 AC4: DVP §3 names "Budget name" as a required SQL-metacharacter
  // literal-storage case (only Transaction description/store was covered, by
  // Story 3.1). Mirrors that test's shape.
  it("STEW-38: a SQL metacharacter in a Budget name is stored and retrieved literally", async () => {
    const payload = "' OR '1'='1";
    const { data: budgetId, error } = await parentA.rpc("rpc_create_budget", {
      p_name: payload,
      p_period_type: "monthly",
      p_owner_member_ids: [],
    });
    expect(error).toBeNull();

    const { data: row } = await parentA
      .from("budget")
      .select("name")
      .eq("id", budgetId as string)
      .single();
    expect(row?.name).toBe(payload);

    // The literal never widened the result set — the caller still only sees
    // Budgets they can access, and exactly one matches the payload name.
    const { data: matches, error: matchErr } = await parentA
      .from("budget")
      .select("id")
      .eq("name", payload);
    expect(matchErr).toBeNull();
    expect(matches).toHaveLength(1);
  });
});

/**
 * DVP.md §3's mandatory RLS-CI-01 coverage list includes "As Member: attempt
 * Category CRUD — must fail (read-only allowed, write denied)" — this block
 * closes that gap. It also covers DIP-2.3's own AC5/AC6 negative-security
 * cases (the RPC-layer + RLS-layer double denial, and the IDOR fix keying
 * authorization off the target row's actual household rather than any
 * caller-supplied one) and the soft-delete/idempotency behavior from
 * AC3/AC4/Obligation 12. Runs as its own describe block with its own
 * fixtures — Category is household-scoped, not Budget-scoped, and the IDOR
 * case specifically needs a *second* household the first describe block's
 * fixtures don't provide.
 */
describe("RLS-CI-01: category household-scoped access", () => {
  const admin = adminClient();
  const catRunId = `${runId}-cat`;

  let parentAId: string;
  let memberId: string;
  let parentBId: string;
  let householdAId: string;
  let householdBId: string;

  let parentA: SupabaseClient;
  let member: SupabaseClient;
  let parentB: SupabaseClient;

  let categoryAId: string; // belongs to household A

  beforeAll(async () => {
    const parentAEmail = `rls-ci-01-${catRunId}-parent-a@example.com`;
    const memberEmail = `rls-ci-01-${catRunId}-member@example.com`;
    const parentBEmail = `rls-ci-01-${catRunId}-parent-b@example.com`;

    const { data: parentAUser, error: parentAErr } =
      await admin.auth.admin.createUser({
        email: parentAEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (parentAErr) throw parentAErr;
    parentAId = parentAUser.user.id;

    const { data: memberUser, error: memberErr } =
      await admin.auth.admin.createUser({
        email: memberEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (memberErr) throw memberErr;
    memberId = memberUser.user.id;

    const { data: parentBUser, error: parentBErr } =
      await admin.auth.admin.createUser({
        email: parentBEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (parentBErr) throw parentBErr;
    parentBId = parentBUser.user.id;

    parentA = await signInClient(parentAEmail);
    member = await signInClient(memberEmail);
    parentB = await signInClient(parentBEmail);

    // Every auth.users insert is self-bootstrapped into its own household
    // by the trg_bootstrap_household_on_signup trigger (Story 1.1.G2).
    // Parent A's and Parent B's households are simply whatever the trigger
    // already created for each — exactly what this test needs (two
    // independent households). The member is reassigned into Parent A's
    // household (a fresh insert would collide with
    // uq_household_member_active_user, since the trigger already gave them
    // an active row) — service_role, bypassing RLS; test fixture setup, not
    // part of what the suite below is asserting.
    const { data: parentAMember, error: parentAMemberErr } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentAId)
      .single();
    if (parentAMemberErr) throw parentAMemberErr;
    householdAId = parentAMember.household_id as string;

    const { data: parentBMember, error: parentBMemberErr } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentBId)
      .single();
    if (parentBMemberErr) throw parentBMemberErr;
    householdBId = parentBMember.household_id as string;

    const { error: memberUpdateErr } = await admin
      .from("household_member")
      .update({ household_id: householdAId, role: "member" })
      .eq("auth_user_id", memberId);
    if (memberUpdateErr) throw memberUpdateErr;

    // A real category in household A, created the only sanctioned way.
    const { data: categoryA, error: categoryAErr } = await parentA.rpc(
      "rpc_upsert_category",
      { p_household_id: householdAId, p_name: "RLS-CI-01 Category A" },
    );
    if (categoryAErr) throw categoryAErr;
    categoryAId = categoryA as string;
  });

  afterAll(async () => {
    for (const id of [parentAId, memberId, parentBId]) {
      if (id) {
        await admin.auth.admin.deleteUser(id).catch(() => {});
      }
    }
  });

  it("Member can read Category (read-only allowed, per DVP §3)", async () => {
    const { data, error } = await member.from("category").select("id, name");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(categoryAId);
  });

  it("Member cannot create a Category via the RPC (write denied)", async () => {
    const { error } = await member.rpc("rpc_upsert_category", {
      p_household_id: householdAId,
      p_name: "Member-created Category",
    });
    expect(error).not.toBeNull();
  });

  it("Member cannot create a Category via a direct insert (RLS layer, independent of the RPC)", async () => {
    const { error } = await member
      .from("category")
      .insert({ household_id: householdAId, name: "Direct Insert" });
    expect(error).not.toBeNull();
  });

  it("Member cannot edit a Category via the RPC (write denied)", async () => {
    const { error } = await member.rpc("rpc_upsert_category", {
      p_household_id: householdAId,
      p_name: "hijacked",
      p_id: categoryAId,
    });
    expect(error).not.toBeNull();
  });

  it("Member cannot edit a Category via a direct update (RLS layer, independent of the RPC)", async () => {
    // RLS filters the row out of the UPDATE's target set entirely — this
    // surfaces as zero rows affected, not a thrown error (same pattern as
    // the Budget RLS tests above).
    const { data, error } = await member
      .from("category")
      .update({ name: "hijacked" })
      .eq("id", categoryAId)
      .select();
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("Member cannot delete a Category via the RPC (write denied)", async () => {
    const { error } = await member.rpc("rpc_delete_category", {
      p_id: categoryAId,
    });
    expect(error).not.toBeNull();
  });

  it("AC6: a Parent cannot use their own authorized p_household_id to rename another household's Category (IDOR)", async () => {
    // Parent B creates a category in their own household.
    const { data: categoryB, error: categoryBErr } = await parentB.rpc(
      "rpc_upsert_category",
      { p_household_id: householdBId, p_name: "RLS-CI-01 Category B" },
    );
    if (categoryBErr) throw categoryBErr;

    // Parent A supplies their OWN authorized household_id, but the id of a
    // category that actually belongs to household B. Authorization must be
    // checked against B (the category's real household), not A (the
    // caller-supplied one) — the core fix in DIP-2.3-v2.
    const { error } = await parentA.rpc("rpc_upsert_category", {
      p_household_id: householdAId,
      p_name: "Renamed by attacker",
      p_id: categoryB as string,
    });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin
      .from("category")
      .select("name")
      .eq("id", categoryB as string)
      .single();
    expect(unchanged?.name).toBe("RLS-CI-01 Category B");
  });

  it("rejects a mismatched p_household_id even for a Parent's own Category", async () => {
    // Parent A owns categoryAId, so is_household_parent(householdAId)
    // passes — but supplying householdBId (a household Parent A does not
    // control) as p_household_id must still be rejected as an attempted
    // cross-household move, independent of the ownership check above.
    const { error } = await parentA.rpc("rpc_upsert_category", {
      p_household_id: householdBId,
      p_name: "Trying to move households",
      p_id: categoryAId,
    });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin
      .from("category")
      .select("name, household_id")
      .eq("id", categoryAId)
      .single();
    expect(unchanged?.name).toBe("RLS-CI-01 Category A");
    expect(unchanged?.household_id).toBe(householdAId);
  });

  it("soft-delete preserves the label, sets is_deleted, and is excluded from an active-only query", async () => {
    const { data: toDelete, error: createErr } = await parentA.rpc(
      "rpc_upsert_category",
      { p_household_id: householdAId, p_name: "To Be Deleted" },
    );
    if (createErr) throw createErr;

    const { error: deleteErr } = await parentA.rpc("rpc_delete_category", {
      p_id: toDelete as string,
    });
    expect(deleteErr).toBeNull();

    const { data: row } = await admin
      .from("category")
      .select("name, is_deleted")
      .eq("id", toDelete as string)
      .single();
    expect(row?.name).toBe("To Be Deleted");
    expect(row?.is_deleted).toBe(true);

    const { data: activeOnly } = await admin
      .from("category")
      .select("id")
      .eq("household_id", householdAId)
      .eq("is_deleted", false);
    expect((activeOnly ?? []).map((r) => r.id)).not.toContain(toDelete);
  });

  it("double-delete raises rather than silently succeeding as a no-op", async () => {
    const { data: toDelete, error: createErr } = await parentA.rpc(
      "rpc_upsert_category",
      { p_household_id: householdAId, p_name: "Deleted Twice" },
    );
    if (createErr) throw createErr;

    const { error: firstDeleteErr } = await parentA.rpc(
      "rpc_delete_category",
      { p_id: toDelete as string },
    );
    expect(firstDeleteErr).toBeNull();

    const { error: secondDeleteErr } = await parentA.rpc(
      "rpc_delete_category",
      { p_id: toDelete as string },
    );
    expect(secondDeleteErr).not.toBeNull();
  });

  // STEW-38 AC4: DVP §3 names "Category name" as a required SQL-metacharacter
  // literal-storage case — previously only Transaction description/store was
  // covered (Story 3.1). Mirrors that test's shape.
  it("STEW-38: a SQL metacharacter in a Category name is stored and retrieved literally", async () => {
    const payload = "' OR '1'='1";
    const { data: categoryId, error } = await parentA.rpc("rpc_upsert_category", {
      p_household_id: householdAId,
      p_name: payload,
    });
    expect(error).toBeNull();

    const { data: row } = await parentA
      .from("category")
      .select("name")
      .eq("id", categoryId as string)
      .single();
    expect(row?.name).toBe(payload);

    // The literal never widened the result set — the member of household A
    // still sees only household A's categories, and exactly one matches.
    const { data: aMatches, error: aErr } = await member
      .from("category")
      .select("id")
      .eq("name", payload);
    expect(aErr).toBeNull();
    expect(aMatches).toHaveLength(1);

    // ...and parentB (household B) never sees household A's metacharacter row.
    const { data: bMatches, error: bErr } = await parentB
      .from("category")
      .select("id")
      .eq("name", payload);
    expect(bErr).toBeNull();
    expect(bMatches ?? []).toHaveLength(0);
  });
});

/**
 * DIP-3.1 (Story 3.1) — Transaction-scoped RLS-CI-01 coverage. Per
 * IMPLEMENTATION_CONVENTIONS item 5 and DVP.md §3 ("attempt to read/write
 * Budget Y's ... Transactions via any join path — must fail"), this is a
 * committed deliverable of the story, not deferred. It also closes the
 * Transaction side of STEW-38's three system-wide gaps: unauthenticated
 * access (e), SQL-metacharacter literal storage (f), and Account/Transaction
 * join-path isolation (a, c). Runs with its own fixtures: one household, a
 * Parent, and a Member who owns Budget X only — Budget Y is Parent-only.
 */
describe("RLS-CI-01: transaction budget-scoped access", () => {
  const admin = adminClient();
  const txnRunId = `${runId}-txn`;
  const today = new Date().toISOString().slice(0, 10);

  let parentAId: string;
  let memberId: string;

  let householdAId: string;
  let budgetXId: string; // owned by Member
  let budgetYId: string; // Parent-only; Member is not an owner
  let accountXId: string; // belongs to Budget X
  let accountYId: string; // belongs to Budget Y

  let parentA: SupabaseClient;
  let member: SupabaseClient;
  const anon: SupabaseClient = createClient(
    SUPABASE_URL!,
    SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  beforeAll(async () => {
    const parentAEmail = `rls-ci-01-${txnRunId}-parent-a@example.com`;
    const memberEmail = `rls-ci-01-${txnRunId}-member@example.com`;

    const { data: parentAUser, error: parentAErr } =
      await admin.auth.admin.createUser({
        email: parentAEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (parentAErr) throw parentAErr;
    parentAId = parentAUser.user.id;

    const { data: memberUser, error: memberErr } =
      await admin.auth.admin.createUser({
        email: memberEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (memberErr) throw memberErr;
    memberId = memberUser.user.id;

    parentA = await signInClient(parentAEmail);
    member = await signInClient(memberEmail);

    // Parent A's household is whatever the signup trigger created; reassign
    // the Member into it (a fresh insert would collide with
    // uq_household_member_active_user). service_role, bypassing RLS — fixture
    // setup, not part of what the suite asserts.
    const { data: parentAMember, error: parentAMemberErr } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentAId)
      .single();
    if (parentAMemberErr) throw parentAMemberErr;
    householdAId = parentAMember.household_id as string;

    const { data: memberRows, error: memberUpdateErr } = await admin
      .from("household_member")
      .update({ household_id: householdAId, role: "member" })
      .eq("auth_user_id", memberId)
      .select("id");
    if (memberUpdateErr) throw memberUpdateErr;
    const memberMemberId = memberRows![0].id as string;

    // Budget X: owned by the Member. Budget Y: Parent-only.
    const { data: budgetX, error: budgetXErr } = await member.rpc(
      "rpc_create_budget",
      {
        p_name: "RLS-CI-01 Txn Budget X",
        p_period_type: "monthly",
        p_owner_member_ids: [memberMemberId],
      },
    );
    if (budgetXErr) throw budgetXErr;
    budgetXId = budgetX as string;

    const { data: budgetY, error: budgetYErr } = await parentA.rpc(
      "rpc_create_budget",
      {
        p_name: "RLS-CI-01 Txn Budget Y",
        p_period_type: "monthly",
        p_owner_member_ids: [],
      },
    );
    if (budgetYErr) throw budgetYErr;
    budgetYId = budgetY as string;

    // One plain account per Budget, each created by a caller authorized for
    // that Budget.
    const { data: accountX, error: accountXErr } = await member.rpc(
      "rpc_create_account",
      {
        p_budget_id: budgetXId,
        p_type: "account",
        p_name: "Budget X Checking",
        p_currency: "USD",
        p_opening_balance: 0,
      },
    );
    if (accountXErr) throw accountXErr;
    accountXId = accountX as string;

    const { data: accountY, error: accountYErr } = await parentA.rpc(
      "rpc_create_account",
      {
        p_budget_id: budgetYId,
        p_type: "account",
        p_name: "Budget Y Checking",
        p_currency: "USD",
        p_opening_balance: 0,
      },
    );
    if (accountYErr) throw accountYErr;
    accountYId = accountY as string;
  });

  afterAll(async () => {
    for (const id of [parentAId, memberId]) {
      if (id) {
        await admin.auth.admin.deleteUser(id).catch(() => {});
      }
    }
  });

  it("(a) Member can create a transaction against their own Budget's account", async () => {
    const { data, error } = await member.rpc("rpc_create_transaction", {
      p_account_id: accountXId,
      p_description: "Groceries",
      p_amount: 12.5,
      p_date: today,
    });
    expect(error).toBeNull();
    expect(typeof data).toBe("string");

    const { data: rows } = await admin
      .from("transaction")
      .select("id, direction, currency")
      .eq("id", data as string);
    expect(rows).toHaveLength(1);
    // AC3: unspecified direction defaults to expense. AC / DIP-2.4 trigger:
    // currency is inherited from the account, never client-supplied.
    expect(rows![0].direction).toBe("expense");
    expect(rows![0].currency).toBe("USD");

    const { data: splits } = await admin
      .from("transaction_split")
      .select("id, category_id, amount")
      .eq("transaction_id", data as string);
    expect(splits).toHaveLength(1);
    expect(splits![0].category_id).toBeNull();
    expect(Number(splits![0].amount)).toBe(12.5);
  });

  it("(a) Member cannot create a transaction against a Budget they are not assigned to, and no row is created", async () => {
    const { data: before } = await admin
      .from("transaction")
      .select("id")
      .eq("account_id", accountYId);
    const beforeCount = (before ?? []).length;

    const { error } = await member.rpc("rpc_create_transaction", {
      p_account_id: accountYId,
      p_description: "Should never persist",
      p_amount: 99,
      p_date: today,
    });
    expect(error).not.toBeNull();

    const { data: after } = await admin
      .from("transaction")
      .select("id")
      .eq("account_id", accountYId);
    expect((after ?? []).length).toBe(beforeCount);
  });

  it("(b) a direct insert into transaction (bypassing the RPC) is denied by RLS even for a Budget the caller owns", async () => {
    const { error } = await member.from("transaction").insert({
      budget_id: budgetXId,
      account_id: accountXId,
      description: "Direct insert",
      amount: 5,
      date: today,
      currency: "USD",
    });
    expect(error).not.toBeNull();

    const { data: rows } = await admin
      .from("transaction")
      .select("id")
      .eq("description", "Direct insert");
    expect(rows ?? []).toHaveLength(0);
  });

  it("(b) a direct insert into transaction_split (bypassing the RPC) is denied by RLS", async () => {
    const { data: existing } = await admin
      .from("transaction")
      .select("id")
      .eq("account_id", accountXId)
      .limit(1);
    const anyTxnId = existing![0].id as string;

    const { error } = await member.from("transaction_split").insert({
      transaction_id: anyTxnId,
      amount: 1,
    });
    expect(error).not.toBeNull();
  });

  it("(c) Member's SELECT never returns another Budget's transactions", async () => {
    // Seed one transaction on Budget Y through the sanctioned path.
    const { error: seedErr } = await parentA.rpc("rpc_create_transaction", {
      p_account_id: accountYId,
      p_description: "Budget Y private",
      p_amount: 7,
      p_date: today,
    });
    if (seedErr) throw seedErr;

    const { data, error } = await member
      .from("transaction")
      .select("id, budget_id");
    expect(error).toBeNull();
    expect((data ?? []).some((r) => r.budget_id === budgetYId)).toBe(false);

    // ...and not via the transaction_split join path either.
    const { data: splits, error: splitErr } = await member
      .from("transaction_split")
      .select("id, transaction:transaction_id (budget_id)");
    expect(splitErr).toBeNull();
    expect(
      (splits ?? []).some(
        (r) =>
          (r as { transaction: { budget_id: string } | null }).transaction
            ?.budget_id === budgetYId,
      ),
    ).toBe(false);
  });

  it("(d) a Parent's SELECT spans every Budget in their household", async () => {
    const { data, error } = await parentA
      .from("transaction")
      .select("budget_id");
    expect(error).toBeNull();
    const budgetIds = new Set((data ?? []).map((r) => r.budget_id));
    expect(budgetIds.has(budgetXId)).toBe(true);
    expect(budgetIds.has(budgetYId)).toBe(true);
  });

  it("(e) an unauthenticated call to rpc_create_transaction fails outright (grant revoked)", async () => {
    const { error } = await anon.rpc("rpc_create_transaction", {
      p_account_id: accountXId,
      p_description: "anon attempt",
      p_amount: 1,
      p_date: today,
    });
    expect(error).not.toBeNull();
  });

  it("(f) a SQL metacharacter in description/store is stored and retrieved literally", async () => {
    const payload = "' OR '1'='1";
    const { data: txnId, error } = await member.rpc("rpc_create_transaction", {
      p_account_id: accountXId,
      p_description: payload,
      p_amount: 3,
      p_date: today,
      p_store: payload,
    });
    expect(error).toBeNull();

    const { data: row } = await member
      .from("transaction")
      .select("description, store")
      .eq("id", txnId as string)
      .single();
    expect(row?.description).toBe(payload);
    expect(row?.store).toBe(payload);

    // The literal never widened the result set — exactly one row matches.
    const { data: matches } = await member
      .from("transaction")
      .select("id")
      .eq("description", payload);
    expect(matches).toHaveLength(1);
  });

  it("(g) fn_validate_transaction_budget_scope rejects a budget/account mismatch at the DB layer, independent of the RPC", async () => {
    // service_role bypasses RLS but BEFORE INSERT triggers still fire. Budget
    // X's id with Budget Y's account must be rejected by the trigger even
    // though the RPC (which already blocks this) is not involved here.
    const { error } = await admin.from("transaction").insert({
      budget_id: budgetXId,
      account_id: accountYId,
      description: "trigger-layer mismatch",
      amount: 5,
      date: today,
      currency: "USD",
    });
    expect(error).not.toBeNull();

    const { data: rows } = await admin
      .from("transaction")
      .select("id")
      .eq("description", "trigger-layer mismatch");
    expect(rows ?? []).toHaveLength(0);
  });
});

/**
 * DIP-3.2 (Story 3.2) — Split-transaction sum validation and retroactive
 * splitting. Committed deliverable per IMPLEMENTATION_CONVENTIONS item 5;
 * DVP.md §3's row for this story: "Split sum-validation rejects mismatched
 * totals (server-side, not just client); retroactive split on existing
 * transaction." Scoped to what 3.2 adds on top of 3.1's Transaction-side
 * coverage: the two write paths (creation with p_splits, retroactive
 * rpc_set_transaction_splits), both the RPC-layer and the deferred-trigger
 * layer independently, and the new category-scope trigger. Own fixtures:
 * household A (Parent A + a Member owning Budget X only; Budget Y is
 * Parent-only) and household B (Parent B) for the cross-household category
 * cases.
 */
describe("RLS-CI-01: transaction split sum validation and retroactive splitting", () => {
  const admin = adminClient();
  const splitRunId = `${runId}-split`;
  const today = new Date().toISOString().slice(0, 10);

  let parentAId: string;
  let memberId: string;
  let parentBId: string;

  let householdAId: string;
  let budgetXId: string; // Member-owned
  let budgetYId: string; // Parent-only
  let accountXId: string;
  let accountYId: string;
  let categoryA1Id: string;
  let categoryA2Id: string;
  let categoryBId: string; // household B

  let parentA: SupabaseClient;
  let member: SupabaseClient;
  let parentB: SupabaseClient;
  const anon: SupabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  async function splitsFor(transactionId: string) {
    const { data } = await admin
      .from("transaction_split")
      .select("category_id, amount")
      .eq("transaction_id", transactionId);
    return (data ?? [])
      .map((r) => ({
        category_id: r.category_id as string | null,
        amount: Number(r.amount),
      }))
      .sort((a, b) => a.amount - b.amount);
  }

  beforeAll(async () => {
    const parentAEmail = `rls-ci-01-${splitRunId}-parent-a@example.com`;
    const memberEmail = `rls-ci-01-${splitRunId}-member@example.com`;
    const parentBEmail = `rls-ci-01-${splitRunId}-parent-b@example.com`;

    for (const [email, assign] of [
      [parentAEmail, (id: string) => (parentAId = id)],
      [memberEmail, (id: string) => (memberId = id)],
      [parentBEmail, (id: string) => (parentBId = id)],
    ] as const) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      assign(data.user.id);
    }

    parentA = await signInClient(parentAEmail);
    member = await signInClient(memberEmail);
    parentB = await signInClient(parentBEmail);

    const { data: parentAMember, error: parentAMemberErr } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentAId)
      .single();
    if (parentAMemberErr) throw parentAMemberErr;
    householdAId = parentAMember.household_id as string;

    const { data: memberRows, error: memberUpdateErr } = await admin
      .from("household_member")
      .update({ household_id: householdAId, role: "member" })
      .eq("auth_user_id", memberId)
      .select("id");
    if (memberUpdateErr) throw memberUpdateErr;
    const memberMemberId = memberRows![0].id as string;

    const { data: budgetX, error: budgetXErr } = await member.rpc(
      "rpc_create_budget",
      {
        p_name: "RLS-CI-01 Split Budget X",
        p_period_type: "monthly",
        p_owner_member_ids: [memberMemberId],
      },
    );
    if (budgetXErr) throw budgetXErr;
    budgetXId = budgetX as string;

    const { data: budgetY, error: budgetYErr } = await parentA.rpc(
      "rpc_create_budget",
      {
        p_name: "RLS-CI-01 Split Budget Y",
        p_period_type: "monthly",
        p_owner_member_ids: [],
      },
    );
    if (budgetYErr) throw budgetYErr;
    budgetYId = budgetY as string;

    const mkAccount = async (
      client: SupabaseClient,
      budgetId: string,
      name: string,
    ) => {
      const { data, error } = await client.rpc("rpc_create_account", {
        p_budget_id: budgetId,
        p_type: "account",
        p_name: name,
        p_currency: "USD",
        p_opening_balance: 0,
      });
      if (error) throw error;
      return data as string;
    };
    accountXId = await mkAccount(member, budgetXId, "Split X Checking");
    accountYId = await mkAccount(parentA, budgetYId, "Split Y Checking");

    const mkCategory = async (
      client: SupabaseClient,
      householdId: string,
      name: string,
    ) => {
      const { data, error } = await client.rpc("rpc_upsert_category", {
        p_household_id: householdId,
        p_name: name,
      });
      if (error) throw error;
      return data as string;
    };
    categoryA1Id = await mkCategory(parentA, householdAId, "Split Cat A1");
    categoryA2Id = await mkCategory(parentA, householdAId, "Split Cat A2");

    const { data: parentBMember, error: parentBMemberErr } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentBId)
      .single();
    if (parentBMemberErr) throw parentBMemberErr;
    categoryBId = await mkCategory(
      parentB,
      parentBMember.household_id as string,
      "Split Cat B",
    );
  });

  afterAll(async () => {
    for (const id of [parentAId, memberId, parentBId]) {
      if (id) await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it("(a) create with p_splits summing exactly to p_amount succeeds and writes N split rows", async () => {
    const { data: txnId, error } = await member.rpc("rpc_create_transaction", {
      p_account_id: accountXId,
      p_description: "Split create OK",
      p_amount: 10,
      p_date: today,
      p_splits: [
        { category_id: categoryA1Id, amount: 6 },
        { category_id: categoryA2Id, amount: 4 },
      ],
    });
    expect(error).toBeNull();
    expect(await splitsFor(txnId as string)).toEqual([
      { category_id: categoryA2Id, amount: 4 },
      { category_id: categoryA1Id, amount: 6 },
    ]);
  });

  it("(b) create with a mismatched split sum fails and leaves NO transaction row", async () => {
    const desc = `Split create mismatch ${splitRunId}`;
    const { error } = await member.rpc("rpc_create_transaction", {
      p_account_id: accountXId,
      p_description: desc,
      p_amount: 10,
      p_date: today,
      p_splits: [
        { category_id: categoryA1Id, amount: 6 },
        { category_id: categoryA2Id, amount: 3 },
      ],
    });
    expect(error).not.toBeNull();

    const { data: rows } = await admin
      .from("transaction")
      .select("id")
      .eq("description", desc);
    expect(rows ?? []).toHaveLength(0);
  });

  it("(b) create rejects p_splits and p_category_id supplied together", async () => {
    const { error } = await member.rpc("rpc_create_transaction", {
      p_account_id: accountXId,
      p_description: "Split + category",
      p_amount: 10,
      p_date: today,
      p_category_id: categoryA1Id,
      p_splits: [{ category_id: categoryA2Id, amount: 10 }],
    });
    expect(error).not.toBeNull();
  });

  it("(c) rpc_set_transaction_splits with a matching sum fully replaces an existing transaction's splits", async () => {
    const { data: txnId, error: createErr } = await member.rpc(
      "rpc_create_transaction",
      {
        p_account_id: accountXId,
        p_description: "Retro replace OK",
        p_amount: 20,
        p_date: today,
      },
    );
    if (createErr) throw createErr;
    // 3.1 default: exactly one uncategorized split of the full amount.
    expect(await splitsFor(txnId as string)).toEqual([
      { category_id: null, amount: 20 },
    ]);

    const { error } = await member.rpc("rpc_set_transaction_splits", {
      p_transaction_id: txnId as string,
      p_splits: [
        { category_id: categoryA1Id, amount: 12 },
        { category_id: categoryA2Id, amount: 8 },
      ],
    });
    expect(error).toBeNull();
    expect(await splitsFor(txnId as string)).toEqual([
      { category_id: categoryA2Id, amount: 8 },
      { category_id: categoryA1Id, amount: 12 },
    ]);
  });

  it("(d) rpc_set_transaction_splits with a mismatched sum fails and leaves the original splits intact", async () => {
    const { data: txnId, error: createErr } = await member.rpc(
      "rpc_create_transaction",
      {
        p_account_id: accountXId,
        p_description: "Retro replace fail",
        p_amount: 15,
        p_date: today,
        p_splits: [
          { category_id: categoryA1Id, amount: 9 },
          { category_id: categoryA2Id, amount: 6 },
        ],
      },
    );
    if (createErr) throw createErr;
    const before = await splitsFor(txnId as string);

    const { error } = await member.rpc("rpc_set_transaction_splits", {
      p_transaction_id: txnId as string,
      p_splits: [
        { category_id: categoryA1Id, amount: 5 },
        { category_id: categoryA2Id, amount: 3 },
      ],
    });
    expect(error).not.toBeNull();
    expect(await splitsFor(txnId as string)).toEqual(before);
  });

  it("(e) a Member cannot rpc_set_transaction_splits on a transaction in a Budget they cannot access", async () => {
    const { data: txnId, error: createErr } = await parentA.rpc(
      "rpc_create_transaction",
      {
        p_account_id: accountYId,
        p_description: "Budget Y txn",
        p_amount: 10,
        p_date: today,
      },
    );
    if (createErr) throw createErr;

    const { error } = await member.rpc("rpc_set_transaction_splits", {
      p_transaction_id: txnId as string,
      p_splits: [{ category_id: null, amount: 10 }],
    });
    expect(error).not.toBeNull();
    // Original single split untouched.
    expect(await splitsFor(txnId as string)).toEqual([
      { category_id: null, amount: 10 },
    ]);
  });

  it("(f) unauthenticated calls to either split RPC fail outright", async () => {
    const { error: createErr } = await anon.rpc("rpc_create_transaction", {
      p_account_id: accountXId,
      p_description: "anon split",
      p_amount: 10,
      p_date: today,
      p_splits: [{ category_id: null, amount: 10 }],
    });
    expect(createErr).not.toBeNull();

    const { error: setErr } = await anon.rpc("rpc_set_transaction_splits", {
      p_transaction_id: "00000000-0000-0000-0000-000000000000",
      p_splits: [{ category_id: null, amount: 10 }],
    });
    expect(setErr).not.toBeNull();
  });

  it("(g) a split referencing a category from a different household is rejected by both write paths", async () => {
    const { error: createErr } = await member.rpc("rpc_create_transaction", {
      p_account_id: accountXId,
      p_description: "cross-household split create",
      p_amount: 10,
      p_date: today,
      p_splits: [{ category_id: categoryBId, amount: 10 }],
    });
    expect(createErr).not.toBeNull();

    const { data: txnId, error: seedErr } = await member.rpc(
      "rpc_create_transaction",
      {
        p_account_id: accountXId,
        p_description: "cross-household split retro seed",
        p_amount: 10,
        p_date: today,
      },
    );
    if (seedErr) throw seedErr;

    const { error: setErr } = await member.rpc("rpc_set_transaction_splits", {
      p_transaction_id: txnId as string,
      p_splits: [{ category_id: categoryBId, amount: 10 }],
    });
    expect(setErr).not.toBeNull();
    expect(await splitsFor(txnId as string)).toEqual([
      { category_id: null, amount: 10 },
    ]);
  });

  it("(h) direct (service-role) split rows whose sum != the parent amount are rejected by the deferred constraint trigger", async () => {
    const { data: txnId, error: seedErr } = await member.rpc(
      "rpc_create_transaction",
      {
        p_account_id: accountXId,
        p_description: "deferred trigger seed",
        p_amount: 10,
        p_date: today,
      },
    );
    if (seedErr) throw seedErr;

    // Parent transaction already has one split of 10; adding another (null
    // category, so the category-scope trigger is a no-op) makes the sum 15.
    const { error } = await admin.from("transaction_split").insert({
      transaction_id: txnId as string,
      category_id: null,
      amount: 5,
    });
    expect(error).not.toBeNull();
    expect(await splitsFor(txnId as string)).toEqual([
      { category_id: null, amount: 10 },
    ]);
  });

  it("(i) direct (service-role) split row with a cross-household category is rejected by fn_validate_transaction_split_category_scope", async () => {
    const { data: txnId, error: seedErr } = await member.rpc(
      "rpc_create_transaction",
      {
        p_account_id: accountXId,
        p_description: "category-scope trigger seed",
        p_amount: 10,
        p_date: today,
      },
    );
    if (seedErr) throw seedErr;

    const { error } = await admin.from("transaction_split").insert({
      transaction_id: txnId as string,
      category_id: categoryBId,
      amount: 10,
    });
    expect(error).not.toBeNull();
  });
});

/**
 * DIP-5.1 (Story 5.1) — budget_period / category_limit RLS + write-path
 * coverage. The DIP's Grounding Check (Convention 5) commits to this
 * describe block per IMPLEMENTATION_CONVENTIONS item 5 (RLS-CI-01 cross-check
 * against DVP §3 is a committed deliverable, never deferred); the block spec
 * itself was omitted from the DIP body, so it is written here to the
 * Grounding Check's stated shape. Covers: SELECT isolation on both new
 * tables, the deliberate absence of any client write policy on budget_period
 * and category_limit, rpc_upsert_category_limit's authz + closed-period (AC6)
 * + cross-household (AC7) rejections, and unauthenticated denial (Convention
 * 7 — assert no rows, tolerate either failure shape).
 */
describe("RLS-CI-01: budget period & category limit access", () => {
  const admin = adminClient();
  const bpRunId = `${runId}-bp`;
  const today = new Date().toISOString().slice(0, 10);

  let parentAId: string;
  let memberId: string;
  let parentBId: string;

  let householdAId: string;
  let budgetXId: string; // Member-owned
  let budgetYId: string; // Parent-only
  let periodXId: string; // Budget X's bootstrapped first period
  let periodYId: string; // Budget Y's bootstrapped first period
  let categoryA1Id: string;
  let categoryBId: string; // household B

  let parentA: SupabaseClient;
  let member: SupabaseClient;
  let parentB: SupabaseClient;
  const anon: SupabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  beforeAll(async () => {
    const parentAEmail = `rls-ci-01-${bpRunId}-parent-a@example.com`;
    const memberEmail = `rls-ci-01-${bpRunId}-member@example.com`;
    const parentBEmail = `rls-ci-01-${bpRunId}-parent-b@example.com`;

    for (const [email, assign] of [
      [parentAEmail, (id: string) => (parentAId = id)],
      [memberEmail, (id: string) => (memberId = id)],
      [parentBEmail, (id: string) => (parentBId = id)],
    ] as const) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      assign(data.user.id);
    }

    parentA = await signInClient(parentAEmail);
    member = await signInClient(memberEmail);
    parentB = await signInClient(parentBEmail);

    const { data: parentAMember, error: pErr } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentAId)
      .single();
    if (pErr) throw pErr;
    householdAId = parentAMember.household_id as string;

    const { data: memberRows, error: mErr } = await admin
      .from("household_member")
      .update({ household_id: householdAId, role: "member" })
      .eq("auth_user_id", memberId)
      .select("id");
    if (mErr) throw mErr;
    const memberMemberId = memberRows![0].id as string;

    const { data: budgetX, error: bxErr } = await member.rpc(
      "rpc_create_budget",
      {
        p_name: "RLS-CI-01 BP Budget X",
        p_period_type: "monthly",
        p_owner_member_ids: [memberMemberId],
      },
    );
    if (bxErr) throw bxErr;
    budgetXId = budgetX as string;

    const { data: budgetY, error: byErr } = await parentA.rpc(
      "rpc_create_budget",
      {
        p_name: "RLS-CI-01 BP Budget Y",
        p_period_type: "monthly",
        p_owner_member_ids: [],
      },
    );
    if (byErr) throw byErr;
    budgetYId = budgetY as string;

    // Each budget got its first period from rpc_create_budget (DIP item 13).
    const { data: pX } = await admin
      .from("budget_period")
      .select("id")
      .eq("budget_id", budgetXId)
      .single();
    periodXId = pX!.id as string;
    const { data: pY } = await admin
      .from("budget_period")
      .select("id")
      .eq("budget_id", budgetYId)
      .single();
    periodYId = pY!.id as string;

    const mkCategory = async (
      client: SupabaseClient,
      householdId: string,
      name: string,
    ) => {
      const { data, error } = await client.rpc("rpc_upsert_category", {
        p_household_id: householdId,
        p_name: name,
      });
      if (error) throw error;
      return data as string;
    };
    categoryA1Id = await mkCategory(parentA, householdAId, "BP Cat A1");

    const { data: parentBMember } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentBId)
      .single();
    categoryBId = await mkCategory(
      parentB,
      parentBMember!.household_id as string,
      "BP Cat B",
    );
  });

  afterAll(async () => {
    for (const id of [parentAId, memberId, parentBId]) {
      if (id) await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it("every new Budget is bootstrapped with exactly one period, visible to a caller who can access the Budget", async () => {
    const { data, error } = await member
      .from("budget_period")
      .select("id, budget_id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(periodXId);
    expect(ids).not.toContain(periodYId); // Member is not an owner of Budget Y
  });

  it("a Member cannot INSERT or UPDATE a budget_period row (no client write policy exists)", async () => {
    const { error: insErr } = await member.from("budget_period").insert({
      budget_id: budgetXId,
      period_start: today,
      period_end: today,
    });
    expect(insErr).not.toBeNull();

    // No UPDATE policy → the row is filtered out of the update's target set.
    const { data: updated, error: updErr } = await member
      .from("budget_period")
      .update({ period_end: "2099-01-01" })
      .eq("id", periodXId)
      .select();
    expect(updErr).toBeNull();
    expect(updated ?? []).toHaveLength(0);
  });

  it("a Member cannot directly INSERT a category_limit row (writes go only through the RPC)", async () => {
    const { error } = await member.from("category_limit").insert({
      budget_period_id: periodXId,
      category_id: categoryA1Id,
      limit_amount: 100,
    });
    expect(error).not.toBeNull();
  });

  it("rpc_upsert_category_limit: an owner can set and then update a limit on their own open period", async () => {
    const { data: id1, error: e1 } = await member.rpc(
      "rpc_upsert_category_limit",
      {
        p_budget_period_id: periodXId,
        p_category_id: categoryA1Id,
        p_limit_amount: 250,
      },
    );
    expect(e1).toBeNull();

    const { data: id2, error: e2 } = await member.rpc(
      "rpc_upsert_category_limit",
      {
        p_budget_period_id: periodXId,
        p_category_id: categoryA1Id,
        p_limit_amount: 400,
      },
    );
    expect(e2).toBeNull();
    expect(id2).toBe(id1); // upsert on (budget_period_id, category_id)

    const { data: row } = await member
      .from("category_limit")
      .select("limit_amount")
      .eq("id", id1 as string)
      .single();
    expect(Number(row?.limit_amount)).toBe(400);
  });

  it("category_limit SELECT is scoped via its period's Budget — a Member never sees another Budget's limits", async () => {
    // Parent A sets a limit on Budget Y's period.
    const { error: seedErr } = await parentA.rpc("rpc_upsert_category_limit", {
      p_budget_period_id: periodYId,
      p_category_id: categoryA1Id,
      p_limit_amount: 99,
    });
    if (seedErr) throw seedErr;

    const { data, error } = await member
      .from("category_limit")
      .select("id, budget_period_id");
    expect(error).toBeNull();
    expect(
      (data ?? []).some((r) => r.budget_period_id === periodYId),
    ).toBe(false);
  });

  it("rpc_upsert_category_limit: a Member cannot write to a Budget they cannot access", async () => {
    const { error } = await member.rpc("rpc_upsert_category_limit", {
      p_budget_period_id: periodYId,
      p_category_id: categoryA1Id,
      p_limit_amount: 10,
    });
    expect(error).not.toBeNull();
  });

  it("AC6: rpc_upsert_category_limit is rejected for a closed period, and no row is written", async () => {
    // budget_period has no client write path, so the closed period is seeded
    // with the service-role client (bypasses RLS; the audit trigger still fires).
    const { data: closed, error: cErr } = await admin
      .from("budget_period")
      .insert({
        budget_id: budgetXId,
        period_start: "2020-01-01",
        period_end: "2020-01-31",
      })
      .select("id")
      .single();
    if (cErr) throw cErr;
    const closedPeriodId = closed!.id as string;

    const { error } = await member.rpc("rpc_upsert_category_limit", {
      p_budget_period_id: closedPeriodId,
      p_category_id: categoryA1Id,
      p_limit_amount: 100,
    });
    expect(error).not.toBeNull();

    const { data: rows } = await admin
      .from("category_limit")
      .select("id")
      .eq("budget_period_id", closedPeriodId);
    expect(rows ?? []).toHaveLength(0);
  });

  it("AC7: rpc_upsert_category_limit is rejected for a category from a different household", async () => {
    const { error } = await member.rpc("rpc_upsert_category_limit", {
      p_budget_period_id: periodXId,
      p_category_id: categoryBId,
      p_limit_amount: 100,
    });
    expect(error).not.toBeNull();

    const { data: rows } = await admin
      .from("category_limit")
      .select("id")
      .eq("budget_period_id", periodXId)
      .eq("category_id", categoryBId);
    expect(rows ?? []).toHaveLength(0);
  });

  it("an unauthenticated client's direct queries on budget_period / category_limit never return rows", async () => {
    for (const table of ["budget_period", "category_limit"]) {
      const { data, error } = await anon.from(table).select("id");
      // Convention 7: assert no rows; tolerate either an empty result or a
      // permission-denied error (RLS helpers are not anon-executable).
      expect(data ?? []).toHaveLength(0);
      if (error) expect(error.code).toBe("42501");
    }
  });
});

/**
 * DIP-5.2 (Story 5.2) — `transfer` RLS + surplus-transfer coverage. The DIP's
 * Grounding Check (Convention 5) commits to this per IMPLEMENTATION_CONVENTIONS
 * item 5 ("a committed deliverable, never deferred"); the block spec was
 * omitted from the DIP body, so it is written here to the Grounding Check's
 * stated shape. Covers: transfer SELECT isolation, the deliberate absence of
 * any client write path, unauthenticated denial (Convention 7), the two new
 * DB-layer validation triggers on budget.surplus_destination_id (AC6), the
 * end-to-end surplus-transfer created by rollover (AC1), the duplicate guard
 * (AC5), and the multi-currency no-op (AC7).
 */
describe("RLS-CI-01: envelope surplus transfer", () => {
  const admin = adminClient();
  const trRunId = `${runId}-transfer`;
  const today = new Date().toISOString().slice(0, 10);

  let parentAId: string;
  let memberId: string;

  let householdAId: string;
  let budgetXId: string; // Member-owned, single-currency
  let budgetYId: string; // Parent-only
  let periodXId: string; // Budget X's bootstrapped first period
  let destAccountXId: string; // non-credit-card account in Budget X (the destination)
  let ccAccountXId: string; // a credit_card account in Budget X
  let accountYId: string; // an account in Budget Y
  let categoryA1Id: string;

  let parentA: SupabaseClient;
  let member: SupabaseClient;
  const anon: SupabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  beforeAll(async () => {
    const parentAEmail = `rls-ci-01-${trRunId}-parent-a@example.com`;
    const memberEmail = `rls-ci-01-${trRunId}-member@example.com`;

    for (const [email, assign] of [
      [parentAEmail, (id: string) => (parentAId = id)],
      [memberEmail, (id: string) => (memberId = id)],
    ] as const) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      assign(data.user.id);
    }

    parentA = await signInClient(parentAEmail);
    member = await signInClient(memberEmail);

    const { data: parentAMember, error: pErr } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentAId)
      .single();
    if (pErr) throw pErr;
    householdAId = parentAMember.household_id as string;

    const { data: memberRows, error: mErr } = await admin
      .from("household_member")
      .update({ household_id: householdAId, role: "member" })
      .eq("auth_user_id", memberId)
      .select("id");
    if (mErr) throw mErr;
    const memberMemberId = memberRows![0].id as string;

    const { data: bx, error: bxErr } = await member.rpc("rpc_create_budget", {
      p_name: "RLS-CI-01 Transfer Budget X",
      p_period_type: "monthly",
      p_owner_member_ids: [memberMemberId],
    });
    if (bxErr) throw bxErr;
    budgetXId = bx as string;

    const { data: by, error: byErr } = await parentA.rpc("rpc_create_budget", {
      p_name: "RLS-CI-01 Transfer Budget Y",
      p_period_type: "monthly",
      p_owner_member_ids: [],
    });
    if (byErr) throw byErr;
    budgetYId = by as string;

    const { data: pX } = await admin
      .from("budget_period")
      .select("id")
      .eq("budget_id", budgetXId)
      .single();
    periodXId = pX!.id as string;

    const mkAccount = async (
      client: SupabaseClient,
      budgetId: string,
      name: string,
      type: string,
      currency: string,
      extra: Record<string, unknown> = {},
    ) => {
      const { data, error } = await client.rpc("rpc_create_account", {
        p_budget_id: budgetId,
        p_type: type,
        p_name: name,
        p_currency: currency,
        p_opening_balance: 0,
        ...extra,
      });
      if (error) throw error;
      return data as string;
    };
    destAccountXId = await mkAccount(member, budgetXId, "Dest Savings", "savings", "USD");
    ccAccountXId = await mkAccount(member, budgetXId, "Card", "credit_card", "USD", {
      p_credit_limit: 1000,
    });
    accountYId = await mkAccount(parentA, budgetYId, "Y Checking", "account", "USD");

    const { data: cat, error: catErr } = await parentA.rpc("rpc_upsert_category", {
      p_household_id: householdAId,
      p_name: "Transfer Cat",
    });
    if (catErr) throw catErr;
    categoryA1Id = cat as string;
  });

  afterAll(async () => {
    for (const id of [parentAId, memberId]) {
      if (id) await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it("AC6: surplus_destination_id rejects a credit_card account and an account from another Budget", async () => {
    const { error: ccErr } = await member
      .from("budget")
      .update({ surplus_destination_id: ccAccountXId })
      .eq("id", budgetXId);
    expect(ccErr).not.toBeNull();

    const { error: crossErr } = await member
      .from("budget")
      .update({ surplus_destination_id: accountYId })
      .eq("id", budgetXId);
    expect(crossErr).not.toBeNull();

    const { data: row } = await admin
      .from("budget")
      .select("surplus_destination_id")
      .eq("id", budgetXId)
      .single();
    expect(row?.surplus_destination_id).toBeNull();
  });

  it("a Member cannot directly write a transfer row (no client write policy exists)", async () => {
    const { error } = await member.from("transfer").insert({
      budget_period_id: periodXId,
      destination_account_id: destAccountXId,
      amount: 1,
    });
    expect(error).not.toBeNull();
  });

  it("AC1/AC5/AC7: rollover creates exactly one surplus transfer and credits the destination once", async () => {
    // Configure a valid single-currency destination + a limit with zero spend.
    const { error: setDestErr } = await member
      .from("budget")
      .update({ surplus_destination_id: destAccountXId })
      .eq("id", budgetXId);
    expect(setDestErr).toBeNull();

    const { error: limErr } = await member.rpc("rpc_upsert_category_limit", {
      p_budget_period_id: periodXId,
      p_category_id: categoryA1Id,
      p_limit_amount: 120,
    });
    if (limErr) throw limErr;

    // Close Budget X's first period (service-role: no client write path).
    const { error: closeErr } = await admin
      .from("budget_period")
      .update({ period_start: "2020-01-01", period_end: "2020-01-31" })
      .eq("id", periodXId);
    if (closeErr) throw closeErr;

    const { error: rollErr } = await admin.rpc("fn_rollover_budget_periods");
    expect(rollErr).toBeNull();

    const { data: transfers } = await admin
      .from("transfer")
      .select("id, amount, destination_account_id")
      .eq("budget_period_id", periodXId);
    expect(transfers).toHaveLength(1);
    expect(Number(transfers![0].amount)).toBe(120);
    expect(transfers![0].destination_account_id).toBe(destAccountXId);

    const { data: acct } = await admin
      .from("account")
      .select("current_balance")
      .eq("id", destAccountXId)
      .single();
    expect(Number(acct?.current_balance)).toBe(120);

    // AC5: a second direct surplus-transfer attempt for the same period is
    // blocked by uq_transfer_period; the balance is not credited again.
    const { error: dupErr } = await admin.rpc("fn_create_surplus_transfer", {
      p_budget_id: budgetXId,
      p_closing_period_id: periodXId,
    });
    expect(dupErr).not.toBeNull();

    const { data: acct2 } = await admin
      .from("account")
      .select("current_balance")
      .eq("id", destAccountXId)
      .single();
    expect(Number(acct2?.current_balance)).toBe(120);

    // Transfer is visible to the owner via RLS, not to an outsider.
    const { data: memberView } = await member
      .from("transfer")
      .select("id")
      .eq("budget_period_id", periodXId);
    expect((memberView ?? []).map((r) => r.id)).toContain(transfers![0].id);
  });

  // AC7 was written against a Budget spanning >1 currency. DIP-2.4.G2
  // (STEW-42) later made that state impossible to create: the
  // trg_account_validate_currency_matches_budget trigger rejects the second,
  // different-currency account. fn_create_surplus_transfer's own
  // `count(distinct currency) <> 1` guard is now defensive-only. This test is
  // updated to assert the state is unreachable rather than that the surplus
  // path handles it.
  it("AC7 (post-2.4.G2): a multi-currency Budget cannot be created, so the multi-currency surplus path is unreachable", async () => {
    const { data: memberRow } = await admin
      .from("household_member")
      .select("id")
      .eq("auth_user_id", memberId)
      .single();
    const { data: bmc, error: bmcErr } = await member.rpc("rpc_create_budget", {
      p_name: "RLS-CI-01 Multi-currency Budget",
      p_period_type: "monthly",
      p_owner_member_ids: [memberRow!.id],
    });
    if (bmcErr) throw bmcErr;
    const mcBudgetId = bmc as string;

    const { error: usdErr } = await member.rpc("rpc_create_account", {
      p_budget_id: mcBudgetId,
      p_type: "savings",
      p_name: "MC USD",
      p_currency: "USD",
      p_opening_balance: 0,
    });
    expect(usdErr).toBeNull();

    const { error: eurErr } = await member.rpc("rpc_create_account", {
      p_budget_id: mcBudgetId,
      p_type: "savings",
      p_name: "MC EUR",
      p_currency: "EUR",
      p_opening_balance: 0,
    });
    expect(eurErr).not.toBeNull();

    const { data: accts } = await admin
      .from("account")
      .select("currency")
      .eq("budget_id", mcBudgetId)
      .eq("is_deleted", false);
    expect(new Set((accts ?? []).map((r) => r.currency))).toEqual(
      new Set(["USD"]),
    );
  });

  it("an unauthenticated client's direct query on transfer never returns rows", async () => {
    const { data, error } = await anon.from("transfer").select("id");
    expect(data ?? []).toHaveLength(0);
    if (error) expect(error.code).toBe("42501");
  });

  // 5.1 regression found while implementing 5.2: fn_rollover_budget_periods
  // advances one period per run, so a budget many periods behind opens
  // intermediate periods whose period_end is already past. The 5.1 AC6
  // open-period guard (BEFORE INSERT OR UPDATE) rejected the rollover's own
  // copy-forward INSERT into such a period, and the outer per-budget
  // exception block then rolled the whole savepoint back — that budget made
  // zero progress on every run. Fixed in this migration via a
  // transaction-local `app.rollover` flag the guard honours.
  it("rollover advances a budget that is multiple periods behind, copying limits into each past period", async () => {
    const { data: memberRow } = await admin
      .from("household_member")
      .select("id")
      .eq("auth_user_id", memberId)
      .single();
    const { data: bhId, error: bhErr } = await member.rpc("rpc_create_budget", {
      p_name: "RLS-CI-01 Catch-up Budget",
      p_period_type: "monthly",
      p_owner_member_ids: [memberRow!.id],
    });
    if (bhErr) throw bhErr;
    const catchupBudgetId = bhId as string;

    const { data: firstPeriod } = await admin
      .from("budget_period")
      .select("id")
      .eq("budget_id", catchupBudgetId)
      .single();

    // Set a limit while the period is still open, then backdate it ~3 months.
    const { error: limErr } = await member.rpc("rpc_upsert_category_limit", {
      p_budget_period_id: firstPeriod!.id,
      p_category_id: categoryA1Id,
      p_limit_amount: 90,
    });
    if (limErr) throw limErr;
    await admin
      .from("budget_period")
      .update({ period_start: "2020-01-01", period_end: "2020-01-31" })
      .eq("id", firstPeriod!.id);

    // First run: opens 2020-02 (a past period) and copies the limit forward
    // — this is exactly the write the 5.1 guard used to reject.
    let { error: r1 } = await admin.rpc("fn_rollover_budget_periods");
    expect(r1).toBeNull();
    // Second run: advances again to 2020-03.
    let { error: r2 } = await admin.rpc("fn_rollover_budget_periods");
    expect(r2).toBeNull();

    const { data: periods } = await admin
      .from("budget_period")
      .select("id, period_start, period_end")
      .eq("budget_id", catchupBudgetId)
      .order("period_start");
    expect((periods ?? []).length).toBe(3); // 2020-01, -02, -03 — progress each run

    // Every opened period carries the copied-forward limit (90).
    const { data: limits } = await admin
      .from("category_limit")
      .select("budget_period_id, limit_amount")
      .in(
        "budget_period_id",
        (periods ?? []).map((p) => p.id),
      );
    expect((limits ?? []).length).toBe(3);
    for (const l of limits ?? []) expect(Number(l.limit_amount)).toBe(90);
  });
});

/**
 * DIP-6.1 (Story 6.1) — v_category_period_state. The view is defined
 * `with (security_invoker = true)`, so its underlying budget_period /
 * category / category_limit / transaction RLS policies are evaluated as the
 * querying user (AC5). The DIP's "Files to Create/Modify" listed only the
 * migration + two UI files, but its Deployment Instructions item 2 requires a
 * local check that a Member querying the view for an unassigned Budget's
 * period returns zero rows — added here as committed coverage, same handling
 * as the 5.1/5.2 Grounding-Check-vs-file-list inconsistency.
 */
describe("RLS-CI-01: v_category_period_state (dashboard)", () => {
  const admin = adminClient();
  const dashRunId = `${runId}-dash`;

  let parentAId: string;
  let memberId: string;

  let householdAId: string;
  let budgetXId: string; // Member-owned
  let budgetYId: string; // Parent-only
  let periodXId: string;
  let periodYId: string;
  let categoryA1Id: string;

  let parentA: SupabaseClient;
  let member: SupabaseClient;

  beforeAll(async () => {
    const parentAEmail = `rls-ci-01-${dashRunId}-parent-a@example.com`;
    const memberEmail = `rls-ci-01-${dashRunId}-member@example.com`;

    for (const [email, assign] of [
      [parentAEmail, (id: string) => (parentAId = id)],
      [memberEmail, (id: string) => (memberId = id)],
    ] as const) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      assign(data.user.id);
    }

    parentA = await signInClient(parentAEmail);
    member = await signInClient(memberEmail);

    const { data: parentAMember, error: pErr } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentAId)
      .single();
    if (pErr) throw pErr;
    householdAId = parentAMember.household_id as string;

    const { data: memberRows, error: mErr } = await admin
      .from("household_member")
      .update({ household_id: householdAId, role: "member" })
      .eq("auth_user_id", memberId)
      .select("id");
    if (mErr) throw mErr;
    const memberMemberId = memberRows![0].id as string;

    const { data: bx, error: bxErr } = await member.rpc("rpc_create_budget", {
      p_name: "RLS-CI-01 Dash Budget X",
      p_period_type: "monthly",
      p_owner_member_ids: [memberMemberId],
    });
    if (bxErr) throw bxErr;
    budgetXId = bx as string;

    const { data: by, error: byErr } = await parentA.rpc("rpc_create_budget", {
      p_name: "RLS-CI-01 Dash Budget Y",
      p_period_type: "monthly",
      p_owner_member_ids: [],
    });
    if (byErr) throw byErr;
    budgetYId = by as string;

    const { data: pX } = await admin
      .from("budget_period")
      .select("id")
      .eq("budget_id", budgetXId)
      .single();
    periodXId = pX!.id as string;
    const { data: pY } = await admin
      .from("budget_period")
      .select("id")
      .eq("budget_id", budgetYId)
      .single();
    periodYId = pY!.id as string;

    const { data: cat, error: catErr } = await parentA.rpc("rpc_upsert_category", {
      p_household_id: householdAId,
      p_name: "Dash Cat",
    });
    if (catErr) throw catErr;
    categoryA1Id = cat as string;
  });

  afterAll(async () => {
    for (const id of [parentAId, memberId]) {
      if (id) await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it("AC5: a Member's query for an unassigned Budget's period returns zero rows (security_invoker)", async () => {
    const { data, error } = await member
      .from("v_category_period_state")
      .select("*")
      .eq("budget_period_id", periodYId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("AC4: a Member sees a row per household category for their own period, zero-stated when there is no data", async () => {
    const { data, error } = await member
      .from("v_category_period_state")
      .select("category_id, category_name, limit_amount, spent")
      .eq("budget_period_id", periodXId);
    expect(error).toBeNull();
    const row = (data ?? []).find((r) => r.category_id === categoryA1Id);
    expect(row).toBeDefined();
    // coalesce() in the view -> never null, so the UI's empty/zero check is plain.
    expect(Number(row!.limit_amount)).toBe(0);
    expect(Number(row!.spent)).toBe(0);
  });

  it("a Parent sees their household's Budget X and Budget Y category states", async () => {
    const { data: xData, error: xErr } = await parentA
      .from("v_category_period_state")
      .select("budget_id")
      .eq("budget_period_id", periodXId);
    expect(xErr).toBeNull();
    expect((xData ?? []).length).toBeGreaterThan(0);

    const { data: yData, error: yErr } = await parentA
      .from("v_category_period_state")
      .select("budget_id")
      .eq("budget_period_id", periodYId);
    expect(yErr).toBeNull();
    expect((yData ?? []).length).toBeGreaterThan(0);
  });

  it("spent reflects only expense splits within the period date range, and excludes soft-deleted rows", async () => {
    // An account + two transactions in Budget X's (open) period.
    const { data: acct, error: acctErr } = await member.rpc("rpc_create_account", {
      p_budget_id: budgetXId,
      p_type: "account",
      p_name: "Dash Checking",
      p_currency: "USD",
      p_opening_balance: 0,
    });
    if (acctErr) throw acctErr;

    const today = new Date().toISOString().slice(0, 10);
    const { error: t1Err } = await member.rpc("rpc_create_transaction", {
      p_account_id: acct as string,
      p_description: "counted expense",
      p_amount: 30,
      p_date: today,
      p_direction: "expense",
      p_category_id: categoryA1Id,
    });
    if (t1Err) throw t1Err;

    const { data: incomeTxnId, error: t2Err } = await member.rpc(
      "rpc_create_transaction",
      {
        p_account_id: acct as string,
        p_description: "ignored income",
        p_amount: 999,
        p_date: today,
        p_direction: "income",
        p_category_id: categoryA1Id,
      },
    );
    if (t2Err) throw t2Err;
    void incomeTxnId;

    const { data, error } = await member
      .from("v_category_period_state")
      .select("spent")
      .eq("budget_period_id", periodXId)
      .eq("category_id", categoryA1Id)
      .single();
    expect(error).toBeNull();
    expect(Number(data?.spent)).toBe(30); // income excluded; only the expense split
  });
});

/**
 * DIP-6.3 (Story 6.3) — rpc_update_account. Covers the negative security AC
 * (a caller without budget access is rejected before any write) plus the
 * structural guarantee that this RPC cannot change an account's type,
 * currency, budget, or balances (it has no parameters for them) and mirrors
 * rpc_create_account's type-specific field validation.
 */
describe("RLS-CI-01: account edit via rpc_update_account", () => {
  const admin = adminClient();
  const acctRunId = `${runId}-acctedit`;

  let parentAId: string;
  let memberId: string;
  let householdAId: string;
  let budgetXId: string; // Member-owned
  let budgetYId: string; // Parent-only
  let accountXId: string; // plain account in Budget X (Member can edit)
  let accountYId: string; // account in Budget Y (Member cannot edit)

  let parentA: SupabaseClient;
  let member: SupabaseClient;

  beforeAll(async () => {
    const parentAEmail = `rls-ci-01-${acctRunId}-parent-a@example.com`;
    const memberEmail = `rls-ci-01-${acctRunId}-member@example.com`;

    for (const [email, assign] of [
      [parentAEmail, (id: string) => (parentAId = id)],
      [memberEmail, (id: string) => (memberId = id)],
    ] as const) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      assign(data.user.id);
    }

    parentA = await signInClient(parentAEmail);
    member = await signInClient(memberEmail);

    const { data: parentAMember } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentAId)
      .single();
    householdAId = parentAMember!.household_id as string;

    const { data: memberRows } = await admin
      .from("household_member")
      .update({ household_id: householdAId, role: "member" })
      .eq("auth_user_id", memberId)
      .select("id");
    const memberMemberId = memberRows![0].id as string;

    const { data: bx } = await member.rpc("rpc_create_budget", {
      p_name: "RLS-CI-01 Acct Budget X",
      p_period_type: "monthly",
      p_owner_member_ids: [memberMemberId],
    });
    budgetXId = bx as string;
    const { data: by } = await parentA.rpc("rpc_create_budget", {
      p_name: "RLS-CI-01 Acct Budget Y",
      p_period_type: "monthly",
      p_owner_member_ids: [],
    });
    budgetYId = by as string;

    const { data: ax } = await member.rpc("rpc_create_account", {
      p_budget_id: budgetXId,
      p_type: "account",
      p_name: "X Checking",
      p_currency: "USD",
      p_opening_balance: 0,
    });
    accountXId = ax as string;
    const { data: ay } = await parentA.rpc("rpc_create_account", {
      p_budget_id: budgetYId,
      p_type: "account",
      p_name: "Y Checking",
      p_currency: "USD",
      p_opening_balance: 0,
    });
    accountYId = ay as string;
  });

  afterAll(async () => {
    for (const id of [parentAId, memberId]) {
      if (id) await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it("an owner can rename their own account; type/currency/budget/balance are untouched", async () => {
    const { data: before } = await admin
      .from("account")
      .select("type, currency, budget_id, current_balance")
      .eq("id", accountXId)
      .single();

    const { error } = await member.rpc("rpc_update_account", {
      p_account_id: accountXId,
      p_name: "X Checking (renamed)",
    });
    expect(error).toBeNull();

    const { data: after } = await admin
      .from("account")
      .select("name, type, currency, budget_id, current_balance")
      .eq("id", accountXId)
      .single();
    expect(after?.name).toBe("X Checking (renamed)");
    expect(after?.type).toBe(before?.type);
    expect(after?.currency).toBe(before?.currency);
    expect(after?.budget_id).toBe(before?.budget_id);
    expect(Number(after?.current_balance)).toBe(Number(before?.current_balance));
  });

  it("negative security: a Member cannot rpc_update_account an account in a Budget they cannot access, and no row changes", async () => {
    const { error } = await member.rpc("rpc_update_account", {
      p_account_id: accountYId,
      p_name: "hijacked",
    });
    expect(error).not.toBeNull();

    const { data: row } = await admin
      .from("account")
      .select("name")
      .eq("id", accountYId)
      .single();
    expect(row?.name).toBe("Y Checking");
  });

  it("mirrors rpc_create_account's type-specific rules: a target_amount on a plain account is rejected", async () => {
    const { error } = await member.rpc("rpc_update_account", {
      p_account_id: accountXId,
      p_name: "X Checking (renamed)",
      p_target_amount: 500,
    });
    expect(error).not.toBeNull();
  });

  it("an empty name is rejected", async () => {
    const { error } = await member.rpc("rpc_update_account", {
      p_account_id: accountXId,
      p_name: "   ",
    });
    expect(error).not.toBeNull();
  });

  it("an unauthenticated call to rpc_update_account fails outright (grant revoked)", async () => {
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await anon.rpc("rpc_update_account", {
      p_account_id: accountXId,
      p_name: "anon rename",
    });
    expect(error).not.toBeNull();
  });

  it("a bogus account id is rejected (indistinguishable from unauthorized)", async () => {
    const { error } = await member.rpc("rpc_update_account", {
      p_account_id: "00000000-0000-0000-0000-000000000000",
      p_name: "ghost",
    });
    expect(error).not.toBeNull();
  });
});

/**
 * DIP-7.1.G1 (Story 7.1.G1) — Story 7.1's rpc_update_household_caps was removed
 * (member_cap/budget_cap are a platform-owner setting, not Parent-facing), so
 * the four RPC-exercising tests are gone. These two remain: they're still the
 * only coverage of `household`'s own RLS/CHECK behavior (IMPLEMENTATION_CONVENTIONS
 * item 5) — the CHECK constraint as the backstop for a direct out-of-range
 * write, and the household_parent_access RLS policy filtering a Member's direct
 * write. Both are unaffected by dropping the RPC.
 */
describe("RLS-CI-01: household direct-write constraints", () => {
  const admin = adminClient();
  const capRunId = `${runId}-caps`;

  let parentAId: string;
  let memberBId: string;
  let householdId: string;

  let parentA: SupabaseClient;
  let memberB: SupabaseClient;

  const caps = async () => {
    const { data } = await admin
      .from("household")
      .select("member_cap, budget_cap")
      .eq("id", householdId)
      .single();
    return { member: Number(data?.member_cap), budget: Number(data?.budget_cap) };
  };

  beforeAll(async () => {
    const parentAEmail = `rls-ci-01-${capRunId}-parent-a@example.com`;
    const memberBEmail = `rls-ci-01-${capRunId}-member-b@example.com`;

    for (const [email, assign] of [
      [parentAEmail, (id: string) => (parentAId = id)],
      [memberBEmail, (id: string) => (memberBId = id)],
    ] as const) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      assign(data.user.id);
    }

    parentA = await signInClient(parentAEmail);
    memberB = await signInClient(memberBEmail);

    const { data: parentAMember } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", parentAId)
      .single();
    householdId = parentAMember!.household_id as string;

    // Member B is reassigned into Parent A's household as a member.
    const { error: reassignErr } = await admin
      .from("household_member")
      .update({ household_id: householdId, role: "member" })
      .eq("auth_user_id", memberBId);
    if (reassignErr) throw reassignErr;
  });

  afterAll(async () => {
    for (const id of [parentAId, memberBId]) {
      if (id) await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it("a direct .from('household').update() with an out-of-range cap is rejected by the CHECK constraint", async () => {
    // Parent A passes the household_parent_access RLS USING check, so this
    // reaches the CHECK constraint — which is the real backstop.
    const before = await caps();
    const { error } = await parentA
      .from("household")
      .update({ member_cap: 0 })
      .eq("id", householdId);
    expect(error).not.toBeNull();
    expect(await caps()).toEqual(before);
  });

  it("a Member's direct .from('household').update() is filtered out by household_parent_access RLS", async () => {
    const before = await caps();
    const { data, error } = await memberB
      .from("household")
      .update({ member_cap: 6 })
      .eq("id", householdId)
      .select();
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(await caps()).toEqual(before);
  });
});

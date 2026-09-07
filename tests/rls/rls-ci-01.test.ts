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

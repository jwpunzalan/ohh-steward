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

    // Parent A bootstraps a fresh household via the real Story 1.1 RPC.
    const { data: bootstrappedHouseholdId, error: bootstrapErr } =
      await parentA.rpc("rpc_bootstrap_household");
    if (bootstrapErr) throw bootstrapErr;
    householdId = bootstrappedHouseholdId as string;

    // Member B and C join the SAME household. There is no invite RPC yet
    // (Story 1.2), so this uses the service_role client to insert directly,
    // bypassing RLS — this is test fixture setup, not part of what the
    // suite below is asserting.
    const { data: memberRows, error: memberInsertErr } = await admin
      .from("household_member")
      .insert([
        { household_id: householdId, auth_user_id: memberBId, role: "member" },
        { household_id: householdId, auth_user_id: memberCId, role: "member" },
      ])
      .select("id, auth_user_id");
    if (memberInsertErr) throw memberInsertErr;

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

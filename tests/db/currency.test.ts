/**
 * DIP-2.4, Implementation Instructions item 10: standard schema-constraint
 * testing for the `currency` reference table and its FK-backed validation on
 * `account.currency` / `budget.default_currency`. Deliberately kept separate
 * from `tests/rls/rls-ci-01.test.ts` — no tenant-isolation boundary is being
 * tested here (`currency` is global and identical for every household), per
 * that file's own docstring scope and this DIP's explicit instruction not to
 * fold this coverage into it.
 *
 * Requires a local Supabase stack with this repo's migrations applied
 * (`supabase start`) and three env vars — never hardcode credentials here
 * (Secure Coding obligation 4):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Get them via `supabase status -o env` and export them before running
 * `npm run test:db`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "currency.test.ts requires SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY " +
      "(run `supabase start`, then export `supabase status -o env`).",
  );
}

const TEST_PASSWORD = "currency-test-password!";
const runId = Date.now();

function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signInClient(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) throw error;
  return client;
}

describe("Story 2.4: currency reference table and FK validation", () => {
  const admin = adminClient();

  let parentId: string;
  let budgetId: string;
  let parent: SupabaseClient;

  beforeAll(async () => {
    const parentEmail = `currency-test-${runId}-parent@example.com`;

    const { data: parentUser, error: parentErr } =
      await admin.auth.admin.createUser({
        email: parentEmail,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    if (parentErr) throw parentErr;
    parentId = parentUser.user.id;

    parent = await signInClient(parentEmail);

    const { data: budget, error: budgetErr } = await parent.rpc(
      "rpc_create_budget",
      { p_name: "Currency Test Budget", p_period_type: "monthly", p_owner_member_ids: [] },
    );
    if (budgetErr) throw budgetErr;
    budgetId = budget as string;
  });

  afterAll(async () => {
    if (parentId) {
      await admin.auth.admin.deleteUser(parentId).catch(() => {});
    }
  });

  it("an authenticated user can read the currency reference table", async () => {
    const { data, error } = await parent.from("currency").select("code, name");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(154);
    expect((data ?? []).map((r) => r.code)).toContain("USD");
  });

  it("an unauthenticated (anon) client cannot read the currency reference table", async () => {
    const client = anonClient();
    const { data, error } = await client.from("currency").select("code");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("rpc_create_account with a valid currency code succeeds (AC1)", async () => {
    const { data, error } = await parent.rpc("rpc_create_account", {
      p_budget_id: budgetId,
      p_type: "account",
      p_name: "Valid Currency Account",
      p_currency: "USD",
      p_opening_balance: 100,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("rpc_create_account with an invalid currency code fails (AC5)", async () => {
    const { error } = await parent.rpc("rpc_create_account", {
      p_budget_id: budgetId,
      p_type: "account",
      p_name: "Invalid Currency Account",
      p_currency: "ZZZ",
      p_opening_balance: 100,
    });
    expect(error).not.toBeNull();

    const { data: rows } = await admin
      .from("account")
      .select("id")
      .eq("name", "Invalid Currency Account");
    expect(rows ?? []).toHaveLength(0);
  });

  it("budget.default_currency accepts a valid currency code (AC4)", async () => {
    const { error } = await parent
      .from("budget")
      .update({ default_currency: "EUR" })
      .eq("id", budgetId);
    expect(error).toBeNull();

    const { data } = await admin
      .from("budget")
      .select("default_currency")
      .eq("id", budgetId)
      .single();
    expect(data?.default_currency).toBe("EUR");
  });

  it("budget.default_currency rejects an invalid currency code (AC5)", async () => {
    const { error } = await parent
      .from("budget")
      .update({ default_currency: "ZZZ" })
      .eq("id", budgetId);
    expect(error).not.toBeNull();

    // Confirm the earlier valid value from the previous test wasn't
    // clobbered by the rejected write.
    const { data } = await admin
      .from("budget")
      .select("default_currency")
      .eq("id", budgetId)
      .single();
    expect(data?.default_currency).toBe("EUR");
  });

  // Story 2.4's original AC2 assumed a single Budget could span multiple
  // currencies (with per-currency grouped totals). DIP-2.4.G2 (STEW-42)
  // superseded that per the Product Owner's clarification: one Budget is
  // always single-currency (multi-currency = separate Budgets), enforced by
  // the trg_account_validate_currency_matches_budget trigger on `account`.
  // This test now asserts that invariant: budgetId already holds a USD
  // account (from the AC1 test above).
  it("2.4.G2: a second account in a different currency is rejected; the first account's currency is the Budget's currency (supersedes Story 2.4 AC2)", async () => {
    const { error: gbpErr } = await parent.rpc("rpc_create_account", {
      p_budget_id: budgetId,
      p_type: "savings",
      p_name: "GBP Savings",
      p_currency: "GBP",
      p_opening_balance: 250,
    });
    expect(gbpErr).not.toBeNull();

    // No GBP row was written; USD stays the Budget's only currency.
    const { data: afterReject } = await admin
      .from("account")
      .select("currency")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false);
    expect(new Set((afterReject ?? []).map((r) => r.currency))).toEqual(
      new Set(["USD"]),
    );

    // AC3: another account in the SAME currency still succeeds as before.
    const { error: usd2Err } = await parent.rpc("rpc_create_account", {
      p_budget_id: budgetId,
      p_type: "savings",
      p_name: "Second USD Savings",
      p_currency: "USD",
      p_opening_balance: 10,
    });
    expect(usd2Err).toBeNull();
  });
});

/**
 * DIP-2.4.G2 (STEW-42) — one currency per Budget, DB-enforced by
 * trg_account_validate_currency_matches_budget. AC2/AC3 are covered by the
 * updated "2.4.G2: a second account in a different currency is rejected"
 * test above; this block covers AC1 (first account, any currency), AC4
 * (UPDATE of currency / budget_id is rejected on mismatch), and AC5
 * (a soft-deleted account no longer constrains the Budget's currency).
 * Schema-constraint scope, not tenant isolation — same rationale this file's
 * docstring gives for living outside tests/rls/.
 */
describe("DIP-2.4.G2: one currency per Budget", () => {
  const admin = adminClient();

  let owner: SupabaseClient;
  let ownerId: string;
  let budgetA: string;
  let budgetB: string;

  beforeAll(async () => {
    const email = `currency-test-${runId}-g2@example.com`;
    const { data: user, error: userErr } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (userErr) throw userErr;
    ownerId = user.user.id;
    owner = await signInClient(email);

    for (const name of ["G2 Budget A", "G2 Budget B"]) {
      const { data, error } = await owner.rpc("rpc_create_budget", {
        p_name: name,
        p_period_type: "monthly",
        p_owner_member_ids: [],
      });
      if (error) throw error;
      if (name.endsWith("A")) budgetA = data as string;
      else budgetB = data as string;
    }
  });

  afterAll(async () => {
    if (ownerId) await admin.auth.admin.deleteUser(ownerId).catch(() => {});
  });

  it("AC1: the first account in an empty Budget succeeds with any valid currency", async () => {
    const { error } = await owner.rpc("rpc_create_account", {
      p_budget_id: budgetA,
      p_type: "account",
      p_name: "A EUR",
      p_currency: "EUR",
      p_opening_balance: 0,
    });
    expect(error).toBeNull();
  });

  it("AC4: a direct UPDATE of an account's currency to a mismatching value is rejected", async () => {
    // budgetA has an EUR account; add a second EUR account, then try to flip
    // its currency to USD via a direct (service-role) update.
    const { data: acctId, error: createErr } = await owner.rpc(
      "rpc_create_account",
      {
        p_budget_id: budgetA,
        p_type: "savings",
        p_name: "A EUR 2",
        p_currency: "EUR",
        p_opening_balance: 0,
      },
    );
    if (createErr) throw createErr;

    const { error: updErr } = await admin
      .from("account")
      .update({ currency: "USD" })
      .eq("id", acctId as string);
    expect(updErr).not.toBeNull();

    const { data: unchanged } = await admin
      .from("account")
      .select("currency")
      .eq("id", acctId as string)
      .single();
    expect(unchanged?.currency).toBe("EUR");
  });

  it("AC4: moving an account into a Budget whose currency differs is rejected", async () => {
    // budgetB gets a USD account; moving it into budgetA (EUR) must fail.
    const { data: usdAcctId, error: createErr } = await owner.rpc(
      "rpc_create_account",
      {
        p_budget_id: budgetB,
        p_type: "account",
        p_name: "B USD",
        p_currency: "USD",
        p_opening_balance: 0,
      },
    );
    if (createErr) throw createErr;

    const { error: moveErr } = await admin
      .from("account")
      .update({ budget_id: budgetA })
      .eq("id", usdAcctId as string);
    expect(moveErr).not.toBeNull();
  });

  it("AC5: a soft-deleted account no longer constrains the Budget's currency", async () => {
    // Fresh Budget: create a JPY account, soft-delete it, then a USD account
    // in the same Budget must succeed (the JPY row is ignored).
    const { data: freshBudget, error: bErr } = await owner.rpc(
      "rpc_create_budget",
      { p_name: "G2 Budget C", p_period_type: "monthly", p_owner_member_ids: [] },
    );
    if (bErr) throw bErr;

    const { data: jpyId, error: jpyErr } = await owner.rpc("rpc_create_account", {
      p_budget_id: freshBudget as string,
      p_type: "account",
      p_name: "C JPY",
      p_currency: "JPY",
      p_opening_balance: 0,
    });
    if (jpyErr) throw jpyErr;

    const { error: delErr } = await admin
      .from("account")
      .update({ is_deleted: true })
      .eq("id", jpyId as string);
    expect(delErr).toBeNull();

    const { error: usdErr } = await owner.rpc("rpc_create_account", {
      p_budget_id: freshBudget as string,
      p_type: "account",
      p_name: "C USD",
      p_currency: "USD",
      p_opening_balance: 0,
    });
    expect(usdErr).toBeNull();
  });
});

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

  it("a Budget-scoped aggregation query groups by currency rather than summing across currencies (AC2)", async () => {
    const { error: secondAccountErr } = await parent.rpc(
      "rpc_create_account",
      {
        p_budget_id: budgetId,
        p_type: "savings",
        p_name: "GBP Savings",
        p_currency: "GBP",
        p_opening_balance: 250,
      },
    );
    expect(secondAccountErr).toBeNull();

    const { data, error } = await admin
      .from("account")
      .select("currency, current_balance")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false);
    expect(error).toBeNull();

    const totalsByCurrency = new Map<string, number>();
    for (const row of data ?? []) {
      totalsByCurrency.set(
        row.currency,
        (totalsByCurrency.get(row.currency) ?? 0) + Number(row.current_balance),
      );
    }

    // USD (100 from the earlier valid-account test) and GBP (250) must
    // remain distinct entries, never combined into one blended figure.
    expect(totalsByCurrency.get("USD")).toBe(100);
    expect(totalsByCurrency.get("GBP")).toBe(250);
  });
});

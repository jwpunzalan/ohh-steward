/**
 * DIP-6.2 (Story 6.2) — pacing-ratio health indicator. Covers the DB artifact
 * (fn_pacing_band's fixed thresholds) and the two behaviours the DIP's
 * Observability section calls out as regression-worthy:
 *   - a closed period's elapsed time clamps to 100%, so its ratio is exactly
 *     spent/limit (never understated by how long ago it closed) — AC5;
 *   - the Budget-level total is a single grouping key per Budget-period with
 *     no per-account fan-out — the summed v_category_period_state.spent equals
 *     the real expense total regardless of how many Accounts the Budget has
 *     (AC3/AC6).
 *
 * Schema-constraint / computation scope, not tenant isolation — same rationale
 * currency.test.ts gives for living outside tests/rls/.
 *
 * Requires a local Supabase stack with this repo's migrations applied
 * (`supabase start`) and SUPABASE_URL / SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY (via `supabase status -o env`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "pacing.test.ts requires SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY " +
      "(run `supabase start`, then export `supabase status -o env`).",
  );
}

const TEST_PASSWORD = "pacing-test-password!";
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

// Same formula the dashboard clients use (day-based; budget_period columns
// are `date`). Kept here to assert the closed-period clamp explicitly.
function pacingRatio(
  spent: number,
  limit: number,
  periodStart: string,
  periodEnd: string,
  today: string,
): number | null {
  if (limit <= 0) return null;
  const DAY = 86_400_000;
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  const now = Date.parse(today);
  const elapsedDays = (Math.max(Math.min(now, end), start) - start) / DAY;
  const totalDays = (end - start) / DAY;
  if (elapsedDays <= 0 || totalDays <= 0) return null;
  return spent / limit / (elapsedDays / totalDays);
}

describe("DIP-6.2: fn_pacing_band fixed thresholds", () => {
  const admin = adminClient();

  const cases: [number | null, string][] = [
    [null, "pending"],
    [0, "green"],
    [1.1, "green"],
    [1.1001, "amber"],
    [1.3, "amber"],
    [1.3001, "red"],
    [5, "red"],
  ];

  for (const [ratio, expected] of cases) {
    it(`ratio ${ratio} → ${expected}`, async () => {
      const { data, error } = await admin.rpc("fn_pacing_band", {
        p_ratio: ratio,
      });
      expect(error).toBeNull();
      expect(data).toBe(expected);
    });
  }
});

describe("DIP-6.2: closed-period clamp and Budget-level fan-out safety", () => {
  const admin = adminClient();

  let ownerId: string;
  let owner: SupabaseClient;
  let budgetId: string;
  let periodId: string;
  let categoryId: string;

  beforeAll(async () => {
    const email = `pacing-test-${runId}@example.com`;
    const { data: user, error: userErr } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (userErr) throw userErr;
    ownerId = user.user.id;
    owner = await signInClient(email);

    const { data: b, error: bErr } = await owner.rpc("rpc_create_budget", {
      p_name: "Pacing Budget",
      p_period_type: "monthly",
      p_owner_member_ids: [],
    });
    if (bErr) throw bErr;
    budgetId = b as string;

    // Two Accounts, both USD (single-currency per Story 2.4.G2).
    for (const name of ["Acct 1", "Acct 2"]) {
      const { error } = await owner.rpc("rpc_create_account", {
        p_budget_id: budgetId,
        p_type: "account",
        p_name: name,
        p_currency: "USD",
        p_opening_balance: 0,
      });
      if (error) throw error;
    }

    const { data: hm } = await admin
      .from("household_member")
      .select("household_id")
      .eq("auth_user_id", ownerId)
      .single();
    const { data: cat, error: catErr } = await owner.rpc("rpc_upsert_category", {
      p_household_id: hm!.household_id,
      p_name: "Pacing Cat",
    });
    if (catErr) throw catErr;
    categoryId = cat as string;

    // Bootstrapped period; set a limit while open, then backdate it closed.
    const { data: p } = await admin
      .from("budget_period")
      .select("id")
      .eq("budget_id", budgetId)
      .single();
    periodId = p!.id as string;
    const { error: limErr } = await owner.rpc("rpc_upsert_category_limit", {
      p_budget_period_id: periodId,
      p_category_id: categoryId,
      p_limit_amount: 100,
    });
    if (limErr) throw limErr;
  });

  afterAll(async () => {
    if (ownerId) await admin.auth.admin.deleteUser(ownerId).catch(() => {});
  });

  it("AC6: summed category spend for a Budget-period is not multiplied by the Account count", async () => {
    // One expense of 30 against the category, while the period is still open.
    const { data: accts } = await admin
      .from("account")
      .select("id")
      .eq("budget_id", budgetId);
    const { error: txnErr } = await owner.rpc("rpc_create_transaction", {
      p_account_id: accts![0].id,
      p_description: "pacing spend",
      p_amount: 30,
      p_date: new Date().toISOString().slice(0, 10),
      p_direction: "expense",
      p_category_id: categoryId,
    });
    if (txnErr) throw txnErr;

    const { data: rows, error } = await owner
      .from("v_category_period_state")
      .select("category_id, spent, limit_amount")
      .eq("budget_period_id", periodId);
    expect(error).toBeNull();

    // Exactly one row per category (the view groups by category), and the
    // summed spend is 30 — NOT 60, even though the Budget has two Accounts.
    const catRow = (rows ?? []).find((r) => r.category_id === categoryId);
    expect(Number(catRow?.spent)).toBe(30);
    const totalSpent = (rows ?? []).reduce((s, r) => s + Number(r.spent), 0);
    expect(totalSpent).toBe(30);
  });

  it("AC5: an already-closed period's pacing ratio is exactly spent/limit (elapsed clamped to 100%)", async () => {
    // Backdate the period so it closed well in the past, then seed an
    // in-range expense (the view only counts transactions whose date falls
    // inside the period).
    const { error: closeErr } = await admin
      .from("budget_period")
      .update({ period_start: "2020-01-01", period_end: "2020-01-31" })
      .eq("id", periodId);
    expect(closeErr).toBeNull();

    const { data: accts } = await admin
      .from("account")
      .select("id")
      .eq("budget_id", budgetId);
    const { error: txnErr } = await owner.rpc("rpc_create_transaction", {
      p_account_id: accts![0].id,
      p_description: "closed-period spend",
      p_amount: 30,
      p_date: "2020-01-15",
      p_direction: "expense",
      p_category_id: categoryId,
    });
    if (txnErr) throw txnErr;

    const { data: rows } = await owner
      .from("v_category_period_state")
      .select("spent, limit_amount")
      .eq("budget_period_id", periodId);
    const spent = Number(rows?.[0]?.spent ?? 0);
    const limit = Number(rows?.[0]?.limit_amount ?? 0);
    expect(spent).toBe(30);
    expect(limit).toBe(100);

    const today = new Date().toISOString().slice(0, 10);
    const ratio = pacingRatio(spent, limit, "2020-01-01", "2020-01-31", today);
    // Clamp: elapsed = full period length, so ratio == spent/limit == 0.3,
    // NOT a tiny number produced by dividing by "years since it closed".
    expect(ratio).toBeCloseTo(0.3, 10);
    // Sanity: without the clamp, elapsed would be ~6.7 years vs a 30-day
    // period, making the ratio ~135x smaller — the bug this AC guards against.
    const unclampedElapsedDays =
      (Date.parse(today) - Date.parse("2020-01-01")) / 86_400_000;
    const totalDays =
      (Date.parse("2020-01-31") - Date.parse("2020-01-01")) / 86_400_000;
    const unclamped = (spent / limit) / (unclampedElapsedDays / totalDays);
    expect(unclamped).toBeLessThan(0.01);

    const { data: band } = await admin.rpc("fn_pacing_band", { p_ratio: ratio });
    expect(band).toBe("green");
  });

  it("AC5: a zero-elapsed (not-yet-started) period yields a null ratio → 'pending'", async () => {
    const future = "2999-01-01";
    const ratio = pacingRatio(10, 100, future, "2999-01-31", "2026-09-07");
    expect(ratio).toBeNull();
    const { data: band } = await admin.rpc("fn_pacing_band", { p_ratio: ratio });
    expect(band).toBe("pending");
  });
});

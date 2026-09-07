"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Budget = { id: string; name: string };
type Period = { id: string; period_start: string; period_end: string };
type CategoryState = {
  budget_period_id: string;
  budget_id: string;
  category_id: string;
  category_name: string;
  limit_amount: number;
  spent: number;
};
type Band = "pending" | "green" | "amber" | "red";

// Other dashboard destinations still have no other entry point in the app, so
// they are relocated into a compact nav row rather than deleted (DIP item 5).
const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/dashboard/budgets/new", label: "New budget" },
  { href: "/dashboard/accounts/new", label: "New account" },
  { href: "/dashboard/transactions/new", label: "Add transaction" },
  { href: "/dashboard/transactions", label: "Transactions" },
  { href: "/dashboard/invites/new", label: "Invite" },
  { href: "/dashboard/account", label: "Account" },
  { href: "/dashboard/security", label: "Security" },
];

const DAY_MS = 86_400_000;

// Story 6.2 — pacing ratio = (% of budget spent) / (% of period elapsed).
// Elapsed time is clamped to [period_start, period_end], so an already-closed
// period always reads as exactly 100% elapsed (ratio = spent/limit) and a
// not-yet-started one reads as 0% → null → 'pending' (AC5). Mirrors the DIP's
// SQL formula; day-based (budget_period columns are `date`, so date−date is an
// integer number of days).
function pacingRatio(
  spent: number,
  limit: number,
  periodStart: string,
  periodEnd: string,
): number | null {
  if (limit <= 0) return null;
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const elapsedDays = (Math.max(Math.min(today, end), start) - start) / DAY_MS;
  const totalDays = (end - start) / DAY_MS;
  if (elapsedDays <= 0 || totalDays <= 0) return null;
  return spent / limit / (elapsedDays / totalDays);
}

// Fixed thresholds (AC1/AC2), identical to fn_pacing_band().
function pacingBand(ratio: number | null): Band {
  if (ratio === null) return "pending";
  if (ratio <= 1.1) return "green";
  if (ratio <= 1.3) return "amber";
  return "red";
}

const BAND_COLOR: Record<Band, string> = {
  pending: "#6b7280", // neutral grey — never a "colour" signal (AC5)
  green: "#1a7f37",
  amber: "#9a6700",
  red: "#cf222e",
};

function BandBadge({ band }: { band: Band }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        color: "#fff",
        background: BAND_COLOR[band],
        textTransform: "capitalize",
      }}
    >
      {band}
    </span>
  );
}

export default function DashboardPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetId, setBudgetId] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  // periods are ordered newest-first; index 0 is the current/open period.
  // "Older" moves the index up, "Newer" moves it down (DIP item 5: index-based
  // navigation over the already-loaded array, no query per click).
  const [periodIndex, setPeriodIndex] = useState(0);
  const [states, setStates] = useState<CategoryState[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("budget")
      .select("id, name")
      .eq("is_deleted", false)
      .order("name")
      .then(({ data, error: budgetError }) => {
        if (budgetError) {
          setError("We couldn't load your dashboard. Please try again.");
          return;
        }
        if (data) {
          setBudgets(data);
          if (data[0]) setBudgetId(data[0].id);
        }
      });
  }, []);

  useEffect(() => {
    if (!budgetId) return;
    const supabase = createClient();
    setPeriodIndex(0);
    setCurrency(null);
    supabase
      .from("budget_period")
      .select("id, period_start, period_end")
      .eq("budget_id", budgetId)
      .order("period_start", { ascending: false })
      .then(({ data, error: periodError }) => {
        if (periodError) {
          setError("We couldn't load your dashboard. Please try again.");
          return;
        }
        setPeriods(data ?? []);
      });
    // AC4/AC6: the currency label is derived server-side from the Budget's own
    // Accounts (RLS-scoped), never a client-supplied or hardcoded value. Per
    // Story 2.4.G2 a Budget's accounts are always single-currency, so the
    // first non-deleted account's currency is the Budget's currency.
    supabase
      .from("account")
      .select("currency")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false)
      .order("created_at")
      .limit(1)
      .then(({ data }) => setCurrency(data?.[0]?.currency ?? null));
  }, [budgetId]);

  const selectedPeriodId = periods[periodIndex]?.id ?? "";

  const loadStates = useCallback(async () => {
    if (!selectedPeriodId) {
      setStates([]);
      return;
    }
    const supabase = createClient();
    const { data, error: stateError } = await supabase
      .from("v_category_period_state")
      .select("*")
      .eq("budget_period_id", selectedPeriodId)
      .order("category_name");
    if (stateError) {
      setError("We couldn't load your dashboard. Please try again.");
      return;
    }
    setError(null);
    setStates((data as CategoryState[]) ?? []);
  }, [selectedPeriodId]);

  useEffect(() => {
    loadStates();
  }, [loadStates]);

  const period = periods[periodIndex];

  // AC3/AC6: Budget-level pacing — sum the already-fetched, single-currency
  // Category rows through one grouping key (this Budget-period); no per-account
  // fan-out, no cross-currency blend.
  const budgetSummary = useMemo(() => {
    if (!period || states.length === 0) return null;
    const totalSpent = states.reduce((sum, s) => sum + s.spent, 0);
    const totalLimit = states.reduce((sum, s) => sum + s.limit_amount, 0);
    const ratio = pacingRatio(
      totalSpent,
      totalLimit,
      period.period_start,
      period.period_end,
    );
    return { totalSpent, totalLimit, band: pacingBand(ratio) };
  }, [period, states]);

  const money = (n: number) =>
    currency ? `${n.toFixed(2)} ${currency}` : n.toFixed(2);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <nav
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          fontSize: "0.85rem",
          marginBottom: "1.5rem",
        }}
      >
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.8rem" }}>Budget</span>
          <select
            value={budgetId}
            onChange={(event) => setBudgetId(event.target.value)}
          >
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.8rem" }}>Period</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setPeriodIndex((i) => i + 1)}
              disabled={periodIndex >= periods.length - 1}
            >
              ← Older
            </button>
            <span style={{ minWidth: 180, textAlign: "center" }}>
              {period
                ? `${period.period_start} – ${period.period_end}`
                : "No periods yet"}
            </span>
            <button
              type="button"
              onClick={() => setPeriodIndex((i) => Math.max(0, i - 1))}
              disabled={periodIndex <= 0}
            >
              Newer →
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}

      {budgetSummary && (
        <p style={{ marginTop: "1.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <strong>This period:</strong>
          <span>
            {money(budgetSummary.totalSpent)} of {money(budgetSummary.totalLimit)}
          </span>
          <BandBadge band={budgetSummary.band} />
        </p>
      )}

      <section style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem" }}>Categories this period</h2>
        {states.length === 0 ? (
          <p>No categories to show for this period yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                <th style={{ padding: "0.5rem 0.25rem" }}>Category</th>
                <th style={{ padding: "0.5rem 0.25rem", textAlign: "right" }}>Spent</th>
                <th style={{ padding: "0.5rem 0.25rem", textAlign: "right" }}>Limit</th>
                <th style={{ padding: "0.5rem 0.25rem" }}>Pacing</th>
              </tr>
            </thead>
            <tbody>
              {states.map((state) => {
                const empty = state.spent === 0 && state.limit_amount === 0;
                const band = period
                  ? pacingBand(
                      pacingRatio(
                        state.spent,
                        state.limit_amount,
                        period.period_start,
                        period.period_end,
                      ),
                    )
                  : "pending";
                return (
                  <tr
                    key={state.category_id}
                    style={{ borderBottom: "1px solid #eee" }}
                  >
                    <td style={{ padding: "0.5rem 0.25rem" }}>
                      {state.category_name}
                    </td>
                    <td style={{ padding: "0.5rem 0.25rem", textAlign: "right" }}>
                      {empty ? "—" : money(state.spent)}
                    </td>
                    <td style={{ padding: "0.5rem 0.25rem", textAlign: "right" }}>
                      {state.limit_amount === 0 ? "No limit" : money(state.limit_amount)}
                    </td>
                    <td style={{ padding: "0.5rem 0.25rem" }}>
                      <BandBadge band={band} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function DashboardPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetId, setBudgetId] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  // periods are ordered newest-first; index 0 is the current/open period.
  // "Older" moves the index up, "Newer" moves it down (DIP item 5: index-based
  // navigation over the already-loaded array, no query per click).
  const [periodIndex, setPeriodIndex] = useState(0);
  const [states, setStates] = useState<CategoryState[]>([]);
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

      <section style={{ marginTop: "2rem" }}>
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
              </tr>
            </thead>
            <tbody>
              {states.map((state) => {
                const empty = state.spent === 0 && state.limit_amount === 0;
                return (
                  <tr
                    key={state.category_id}
                    style={{ borderBottom: "1px solid #eee" }}
                  >
                    <td style={{ padding: "0.5rem 0.25rem" }}>
                      {state.category_name}
                    </td>
                    <td style={{ padding: "0.5rem 0.25rem", textAlign: "right" }}>
                      {empty ? "—" : state.spent.toFixed(2)}
                    </td>
                    <td style={{ padding: "0.5rem 0.25rem", textAlign: "right" }}>
                      {state.limit_amount === 0
                        ? "No limit"
                        : state.limit_amount.toFixed(2)}
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

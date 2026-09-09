"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Story 7.2 — Reports screen (web, Parent-only via Story 7.1's middleware).
// Read layer over v_category_period_state (Story 6.1) + account (Story 6.3's
// read shape). "Export CSV" calls the export-report Edge Function, which
// forwards the caller's own session and carries its own explicit Parent check
// (the middleware does not cover a direct function call).

type Budget = { id: string; name: string };
type Period = { id: string; period_start: string; period_end: string };
type CategoryState = {
  category_id: string;
  category_name: string;
  limit_amount: number;
  spent: number;
};
type Account = {
  id: string;
  name: string;
  type: string;
  current_balance: number;
  currency: string;
};

export default function ReportsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetId, setBudgetId] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [states, setStates] = useState<CategoryState[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("budget")
      .select("id, name")
      .eq("is_deleted", false)
      .order("name")
      .then(({ data, error: budgetError }) => {
        if (budgetError) {
          setError("We couldn't load your budgets. Please try again.");
          return;
        }
        const list = (data as Budget[]) ?? [];
        setBudgets(list);
        if (list[0]) setBudgetId(list[0].id);
      });
  }, []);

  useEffect(() => {
    if (!budgetId) return;
    const supabase = createClient();
    setPeriodId("");
    supabase
      .from("budget_period")
      .select("id, period_start, period_end")
      .eq("budget_id", budgetId)
      .order("period_start", { ascending: false })
      .then(({ data }) => {
        const list = (data as Period[]) ?? [];
        setPeriods(list);
        if (list[0]) setPeriodId(list[0].id);
      });
    supabase
      .from("account")
      .select("id, name, type, current_balance, currency")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false)
      .order("name")
      .then(({ data }) => setAccounts((data as Account[]) ?? []));
  }, [budgetId]);

  const loadStates = useCallback(async () => {
    if (!periodId) {
      setStates([]);
      return;
    }
    const supabase = createClient();
    const { data, error: stateError } = await supabase
      .from("v_category_period_state")
      .select("*")
      .eq("budget_period_id", periodId)
      .order("category_name");
    if (stateError) {
      setError("We couldn't load this report. Please try again.");
      return;
    }
    setError(null);
    setStates((data as CategoryState[]) ?? []);
  }, [periodId]);

  useEffect(() => {
    loadStates();
  }, [loadStates]);

  async function handleExport() {
    if (!budgetId || !periodId) return;
    setExporting(true);
    setError(null);
    const supabase = createClient();
    const { data, error: invokeError } = await supabase.functions.invoke(
      "export-report",
      { body: { budget_id: budgetId, period_id: periodId } },
    );
    setExporting(false);
    if (invokeError || typeof data !== "string") {
      // Never surface the function's raw error text (Secure Coding
      // obligation 10) — 401/403/500 all collapse to one message here.
      setError("We couldn't export that report. Please try again.");
      return;
    }
    const period = periods.find((p) => p.id === periodId);
    const budget = budgets.find((b) => b.id === budgetId);
    const filename = `report-${budget?.name ?? "budget"}-${
      period ? `${period.period_start}-${period.period_end}` : "period"
    }.csv`;
    const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const money = (n: number, currency?: string) =>
    currency ? `${Number(n).toFixed(2)} ${currency}` : Number(n).toFixed(2);

  return (
    <main style={{ maxWidth: 900, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Reports</h1>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", margin: "1rem 0" }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Budget
          <select value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Period
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.period_start} – {p.period_end}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || !periodId}
          style={{ alignSelf: "flex-end" }}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}

      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Category spend vs limit</h2>
      {states.length === 0 ? (
        <p>No category data for this period.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
              <th style={{ padding: "0.4rem 0.5rem" }}>Category</th>
              <th style={{ padding: "0.4rem 0.5rem" }}>Limit</th>
              <th style={{ padding: "0.4rem 0.5rem" }}>Spent</th>
              <th style={{ padding: "0.4rem 0.5rem" }}>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {states.map((s) => (
              <tr key={s.category_id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem 0.5rem" }}>{s.category_name}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{money(s.limit_amount)}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{money(s.spent)}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>
                  {money(Number(s.limit_amount) - Number(s.spent))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Account balances</h2>
      {accounts.length === 0 ? (
        <p>No accounts in this budget.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
              <th style={{ padding: "0.4rem 0.5rem" }}>Account</th>
              <th style={{ padding: "0.4rem 0.5rem" }}>Type</th>
              <th style={{ padding: "0.4rem 0.5rem" }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem 0.5rem" }}>{a.name}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>{a.type}</td>
                <td style={{ padding: "0.4rem 0.5rem" }}>
                  {money(a.current_balance, a.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

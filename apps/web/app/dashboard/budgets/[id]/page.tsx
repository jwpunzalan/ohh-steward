"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Story 7.1.G2 — Budget settings: period type, currency, surplus destination.
// Plain form (matching /dashboard/security's convention — no design-system
// primitives). No new RPC: budget_read_write RLS already permits any Parent or
// Budget owner/co-owner to .update() these three columns, and all three are
// validated server-side by pre-existing mechanisms (a CHECK constraint on
// period_type, an FK on default_currency, an FK + trg_budget_validate_surplus_
// destination on surplus_destination_id). The surplus-destination <select> only
// offers sensible choices (AC4); the trigger remains the real boundary (AC5).

type PeriodType = "monthly" | "biweekly";
type Budget = {
  id: string;
  name: string;
  period_type: PeriodType;
  default_currency: string | null;
  surplus_destination_id: string | null;
};
type Currency = { code: string; name: string };
type Account = { id: string; name: string; type: string };

export default function BudgetSettingsPage() {
  const params = useParams<{ id: string }>();
  const budgetId = params.id;

  const [budget, setBudget] = useState<Budget | null>(null);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [defaultCurrency, setDefaultCurrency] = useState("");
  const [surplusDestinationId, setSurplusDestinationId] = useState("");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    // RLS scopes visibility automatically — a Budget the caller can't access
    // returns no row, handled the same as any other load failure.
    const { data, error: readError } = await supabase
      .from("budget")
      .select("id, name, period_type, default_currency, surplus_destination_id")
      .eq("id", budgetId)
      .single();
    if (readError || !data) {
      setError("We couldn't load this budget's settings. Please try again.");
      setLoading(false);
      return;
    }
    const b = data as Budget;
    setBudget(b);
    setPeriodType(b.period_type);
    setDefaultCurrency(b.default_currency ?? "");
    setSurplusDestinationId(b.surplus_destination_id ?? "");
    setLoading(false);
  }, [budgetId]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("currency")
      .select("code, name")
      .order("name")
      .then(({ data }) => setCurrencies((data as Currency[]) ?? []));
    // AC4: only this Budget's own accounts that are not archived, not
    // soft-deleted, and not credit_card — narrowing to what the DB trigger
    // would accept. The trigger stays the enforcement boundary regardless.
    supabase
      .from("account")
      .select("id, name, type")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false)
      .eq("is_archived", false)
      .neq("type", "credit_card")
      .order("name")
      .then(({ data }) => setAccounts((data as Account[]) ?? []));
    load();
  }, [budgetId, load]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("budget")
      .update({
        period_type: periodType,
        default_currency: defaultCurrency || null,
        surplus_destination_id: surplusDestinationId || null,
      })
      .eq("id", budgetId);

    if (updateError) {
      // Generic message only (Secure Coding obligation 10) — never the RLS
      // denial or the trigger/constraint rejection text verbatim.
      setError("We couldn't save those changes. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setSaved(true);
    await load();
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Budget settings{budget ? `: ${budget.name}` : ""}</h1>

      {loading ? (
        <p>Loading…</p>
      ) : !budget ? (
        error && (
          <p role="alert" style={{ color: "crimson" }}>
            {error}
          </p>
        )
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <label htmlFor="periodType">Period</label>
          <select
            id="periodType"
            name="periodType"
            value={periodType}
            onChange={(event) =>
              setPeriodType(event.target.value as PeriodType)
            }
          >
            <option value="monthly">Monthly</option>
            <option value="biweekly">Biweekly</option>
          </select>

          <label htmlFor="defaultCurrency">Currency</label>
          <select
            id="defaultCurrency"
            name="defaultCurrency"
            value={defaultCurrency}
            onChange={(event) => setDefaultCurrency(event.target.value)}
          >
            <option value="">Not set</option>
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </select>

          <label htmlFor="surplusDestinationId">Surplus destination</label>
          <select
            id="surplusDestinationId"
            name="surplusDestinationId"
            value={surplusDestinationId}
            onChange={(event) => setSurplusDestinationId(event.target.value)}
          >
            <option value="">None</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>

          {error && (
            <p role="alert" style={{ color: "crimson" }}>
              {error}
            </p>
          )}
          {saved && <p>Saved.</p>}

          <button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}
    </main>
  );
}

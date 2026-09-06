"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type AccountType = "account" | "savings" | "savings_goal" | "credit_card";
type Budget = { id: string; name: string };

export default function NewAccountPage() {
  const router = useRouter();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetId, setBudgetId] = useState("");
  const [type, setType] = useState<AccountType>("account");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [minimumPayment, setMinimumPayment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("budget")
      .select("id, name")
      .then(({ data }) => {
        if (data) {
          setBudgets(data);
          if (data[0]) setBudgetId(data[0].id);
        }
      });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();

    const { error: createError } = await supabase.rpc("rpc_create_account", {
      p_budget_id: budgetId,
      p_type: type,
      p_name: name,
      p_currency: currency,
      p_opening_balance: Number(openingBalance) || 0,
      p_target_amount: type === "savings_goal" && targetAmount ? Number(targetAmount) : null,
      p_target_date: type === "savings_goal" && targetDate ? targetDate : null,
      p_credit_limit: type === "credit_card" && creditLimit ? Number(creditLimit) : null,
      p_due_date: type === "credit_card" && dueDate ? dueDate : null,
      p_minimum_payment: type === "credit_card" && minimumPayment ? Number(minimumPayment) : null,
    });

    if (createError) {
      // Never surface raw Supabase/Postgres error text (Secure Coding
      // obligation 10) — e.g. "not authorized for this budget" or a
      // type/field-mismatch rejection.
      setError("We couldn't create that account. Please try again.");
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Add an account</h1>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label htmlFor="budget">Budget</label>
        <select
          id="budget"
          value={budgetId}
          onChange={(event) => setBudgetId(event.target.value)}
          required
        >
          {budgets.map((budget) => (
            <option key={budget.id} value={budget.id}>
              {budget.name}
            </option>
          ))}
        </select>

        <label htmlFor="type">Type</label>
        <select
          id="type"
          value={type}
          onChange={(event) => setType(event.target.value as AccountType)}
        >
          <option value="account">Account</option>
          <option value="savings">Savings</option>
          <option value="savings_goal">Savings Goal</option>
          <option value="credit_card">Credit Card</option>
        </select>

        <label htmlFor="name">Name</label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />

        <label htmlFor="currency">Currency</label>
        <input
          id="currency"
          type="text"
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          maxLength={3}
          required
        />

        <label htmlFor="openingBalance">
          {type === "credit_card" ? "Current balance owed" : "Opening balance"}
        </label>
        <input
          id="openingBalance"
          type="number"
          step="0.01"
          value={openingBalance}
          onChange={(event) => setOpeningBalance(event.target.value)}
          required
        />

        {type === "savings_goal" && (
          <>
            <label htmlFor="targetAmount">Target amount</label>
            <input
              id="targetAmount"
              type="number"
              step="0.01"
              value={targetAmount}
              onChange={(event) => setTargetAmount(event.target.value)}
              required
            />

            <label htmlFor="targetDate">Target date (optional)</label>
            <input
              id="targetDate"
              type="date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </>
        )}

        {type === "credit_card" && (
          <>
            <label htmlFor="creditLimit">Credit limit</label>
            <input
              id="creditLimit"
              type="number"
              step="0.01"
              value={creditLimit}
              onChange={(event) => setCreditLimit(event.target.value)}
              required
            />

            <label htmlFor="dueDate">Due date (optional)</label>
            <input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />

            <label htmlFor="minimumPayment">Minimum payment (optional)</label>
            <input
              id="minimumPayment"
              type="number"
              step="0.01"
              value={minimumPayment}
              onChange={(event) => setMinimumPayment(event.target.value)}
            />
          </>
        )}

        {error && (
          <p role="alert" style={{ color: "crimson" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting || !budgetId}>
          {submitting ? "Creating…" : "Create account"}
        </button>
      </form>
    </main>
  );
}

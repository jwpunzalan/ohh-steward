"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Direction = "expense" | "income";
type Account = { id: string; name: string };
type Category = { id: string; name: string };
type SplitRow = { categoryId: string; amount: string };

export default function NewTransactionPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  // AC3: direction defaults to expense ("buying") when the user makes no
  // explicit choice — the select simply starts on "expense".
  const [direction, setDirection] = useState<Direction>("expense");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const [store, setStore] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // AC1: split mode lets the user enter multiple category/amount pairs.
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitRow[]>([
    { categoryId: "", amount: "" },
    { categoryId: "", amount: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    // Both queries are RLS-scoped: accounts to Budgets the caller can access,
    // categories to the caller's household. rpc_create_transaction re-checks
    // both server-side regardless of what the client submits.
    supabase
      .from("account")
      .select("id, name")
      .eq("is_deleted", false)
      .then(({ data }) => {
        if (data) {
          setAccounts(data);
          if (data[0]) setAccountId(data[0].id);
        }
      });
    supabase
      .from("category")
      .select("id, name")
      .eq("is_deleted", false)
      .then(({ data }) => {
        if (data) setCategories(data);
      });
  }, []);

  const splitTotal = splits.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  // Client-side sum feedback only — the RPC + deferred constraint trigger are
  // the authoritative check (AC2/AC5).
  const splitsBalance =
    splitMode && amount !== "" && Math.abs(splitTotal - Number(amount)) < 1e-9;

  function updateSplit(index: number, patch: Partial<SplitRow>) {
    setSplits((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (splitMode && !splitsBalance) {
      setError("Split amounts must add up to the transaction amount.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    // p_budget_id is intentionally never sent — the RPC derives it from the
    // referenced account server-side (AC5). In split mode p_category_id is
    // omitted and p_splits carries the category/amount pairs.
    const { error: createError } = await supabase.rpc("rpc_create_transaction", {
      p_account_id: accountId,
      p_description: description,
      p_amount: Number(amount),
      p_date: date,
      p_direction: direction,
      p_time: time || null,
      p_store: store || null,
      p_category_id: splitMode ? null : categoryId || null,
      p_splits: splitMode
        ? splits.map((row) => ({
            category_id: row.categoryId || null,
            amount: Number(row.amount),
          }))
        : null,
    });

    if (createError) {
      // Never surface raw Supabase/Postgres error text (Secure Coding
      // obligation 10) — e.g. "not authorized for this budget" or a
      // sum-validation rejection.
      setError("We couldn't save that transaction. Please try again.");
      setSubmitting(false);
      return;
    }

    router.push("/dashboard/transactions");
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Add a transaction</h1>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label htmlFor="account">Account / Card / Savings</label>
        <select
          id="account"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          required
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>

        <label htmlFor="description">Description</label>
        <input
          id="description"
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
        />

        <label htmlFor="amount">Amount</label>
        <input
          id="amount"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />

        <label htmlFor="direction">Direction</label>
        <select
          id="direction"
          value={direction}
          onChange={(event) => setDirection(event.target.value as Direction)}
        >
          <option value="expense">Expense (buying)</option>
          <option value="income">Income</option>
        </select>

        <label htmlFor="date">Date</label>
        <input
          id="date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />

        <label htmlFor="time">Time (optional)</label>
        <input
          id="time"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />

        <label htmlFor="store">Store / establishment (optional)</label>
        <input
          id="store"
          type="text"
          value={store}
          onChange={(event) => setStore(event.target.value)}
        />

        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={splitMode}
            onChange={(event) => setSplitMode(event.target.checked)}
          />
          Split across multiple categories
        </label>

        {!splitMode && (
          <>
            <label htmlFor="category">Category (optional)</label>
            <select
              id="category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </>
        )}

        {splitMode && (
          <fieldset style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <legend>Splits</legend>
            {splits.map((row, index) => (
              <div key={index} style={{ display: "flex", gap: "0.5rem" }}>
                <select
                  aria-label={`Split ${index + 1} category`}
                  value={row.categoryId}
                  onChange={(event) =>
                    updateSplit(index, { categoryId: event.target.value })
                  }
                  style={{ flex: 1 }}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Split ${index + 1} amount`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.amount}
                  onChange={(event) =>
                    updateSplit(index, { amount: event.target.value })
                  }
                  style={{ width: 90 }}
                />
                {splits.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSplits((rows) => rows.filter((_, i) => i !== index))
                    }
                    aria-label={`Remove split ${index + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setSplits((rows) => [...rows, { categoryId: "", amount: "" }])
              }
            >
              Add split
            </button>
            <p style={{ color: splitsBalance ? "green" : "crimson" }}>
              Split total: {splitTotal.toFixed(2)}
              {amount !== "" && ` / ${Number(amount).toFixed(2)}`}
            </p>
          </fieldset>
        )}

        {error && (
          <p role="alert" style={{ color: "crimson" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !accountId || (splitMode && !splitsBalance)}
        >
          {submitting ? "Saving…" : "Save transaction"}
        </button>
      </form>
    </main>
  );
}

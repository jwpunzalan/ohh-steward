"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string };
type Split = { id: string; category_id: string | null; amount: number };
type Transaction = {
  id: string;
  description: string;
  amount: number;
  date: string;
  direction: string;
  transaction_split: Split[];
};
type SplitRow = { categoryId: string; amount: string };

export default function TransactionsListPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("transaction")
      .select(
        "id, description, amount, date, direction, transaction_split(id, category_id, amount)",
      )
      .eq("is_deleted", false)
      .order("date", { ascending: false })
      .limit(25);
    if (data) setTransactions(data as unknown as Transaction[]);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    load();
    supabase
      .from("category")
      .select("id, name")
      .eq("is_deleted", false)
      .then(({ data }) => {
        if (data) setCategories(data);
      });
  }, [load]);

  const categoryName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? "—") : "Uncategorized";

  function startEditing(txn: Transaction) {
    setError(null);
    setEditingId(txn.id);
    setRows(
      txn.transaction_split.map((split) => ({
        categoryId: split.category_id ?? "",
        amount: String(split.amount),
      })),
    );
  }

  async function saveSplits(txn: Transaction) {
    setError(null);
    const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    if (Math.abs(total - txn.amount) > 1e-9) {
      setError("Split amounts must add up to the transaction amount.");
      return;
    }

    setSavingId(txn.id);
    const supabase = createClient();
    // p_amount is never sent — rpc_set_transaction_splits reads the
    // transaction's own amount server-side (AC3/AC5).
    const { error: rpcError } = await supabase.rpc("rpc_set_transaction_splits", {
      p_transaction_id: txn.id,
      p_splits: rows.map((r) => ({
        category_id: r.categoryId || null,
        amount: Number(r.amount),
      })),
    });

    if (rpcError) {
      // Generic message only (Secure Coding obligation 10).
      setError("We couldn't update those splits. Please try again.");
      setSavingId(null);
      return;
    }

    setSavingId(null);
    setEditingId(null);
    await load();
  }

  return (
    <main style={{ maxWidth: 560, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Transactions</h1>
      <p>
        <Link href="/dashboard/transactions/new">Add a transaction</Link>
      </p>

      {transactions.length === 0 && <p>No transactions yet.</p>}

      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>
        {transactions.map((txn) => (
          <li key={txn.id} style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{txn.description}</strong>
              <span>
                {txn.direction === "income" ? "+" : "−"}
                {txn.amount.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>{txn.date}</div>

            <ul style={{ margin: "0.5rem 0", paddingLeft: "1rem" }}>
              {txn.transaction_split.map((split) => (
                <li key={split.id}>
                  {categoryName(split.category_id)}: {split.amount.toFixed(2)}
                </li>
              ))}
            </ul>

            {editingId === txn.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {rows.map((row, index) => (
                  <div key={index} style={{ display: "flex", gap: "0.5rem" }}>
                    <select
                      aria-label={`Split ${index + 1} category`}
                      value={row.categoryId}
                      onChange={(event) =>
                        setRows((rs) =>
                          rs.map((r, i) =>
                            i === index ? { ...r, categoryId: event.target.value } : r,
                          ),
                        )
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
                        setRows((rs) =>
                          rs.map((r, i) =>
                            i === index ? { ...r, amount: event.target.value } : r,
                          ),
                        )
                      }
                      style={{ width: 90 }}
                    />
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setRows((rs) => rs.filter((_, i) => i !== index))
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
                    setRows((rs) => [...rs, { categoryId: "", amount: "" }])
                  }
                >
                  Add split
                </button>
                <div>
                  Split total:{" "}
                  {rows
                    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
                    .toFixed(2)}{" "}
                  / {txn.amount.toFixed(2)}
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    onClick={() => saveSplits(txn)}
                    disabled={savingId === txn.id}
                  >
                    {savingId === txn.id ? "Saving…" : "Save splits"}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => startEditing(txn)}>
                Split / edit categories
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}
    </main>
  );
}

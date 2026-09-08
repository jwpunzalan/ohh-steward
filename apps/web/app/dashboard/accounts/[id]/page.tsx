"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type Account = {
  id: string;
  budget_id: string;
  type: "account" | "savings" | "savings_goal" | "credit_card";
  name: string;
  currency: string;
  current_balance: number;
  balance_owed: number | null;
  target_amount: number | null;
  target_date: string | null;
  credit_limit: number | null;
  due_date: string | null;
  minimum_payment: number | null;
};
type Txn = {
  id: string;
  description: string;
  amount: number;
  direction: string;
  date: string;
  store: string | null;
  transaction_split: { id: string; category_id: string | null; amount: number }[];
};

const labelStyle: CSSProperties = {
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
};
const inputStyle: CSSProperties = {
  padding: "0.55rem 0.75rem",
  borderRadius: "var(--radius-input)",
  border: "1px solid var(--color-border)",
  background: "var(--color-card)",
  color: "var(--color-text)",
  fontFamily: "var(--font-work-sans), system-ui, sans-serif",
  fontSize: "0.95rem",
};
const heading: CSSProperties = {
  fontFamily: "var(--font-nunito), system-ui, sans-serif",
  fontWeight: 800,
  color: "var(--color-text)",
};

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const accountId = params.id;

  const [account, setAccount] = useState<Account | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [minimumPayment, setMinimumPayment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: acct, error: acctError } = await supabase
      .from("account")
      .select(
        "id, budget_id, type, name, currency, current_balance, balance_owed, target_amount, target_date, credit_limit, due_date, minimum_payment",
      )
      .eq("id", accountId)
      .eq("is_deleted", false)
      .single();
    if (acctError || !acct) {
      setError("We couldn't load that account.");
      return;
    }
    const a = acct as Account;
    setAccount(a);
    setName(a.name);
    setTargetAmount(a.target_amount != null ? String(a.target_amount) : "");
    setTargetDate(a.target_date ?? "");
    setCreditLimit(a.credit_limit != null ? String(a.credit_limit) : "");
    setDueDate(a.due_date ?? "");
    setMinimumPayment(
      a.minimum_payment != null ? String(a.minimum_payment) : "",
    );

    const { data: history } = await supabase
      .from("transaction")
      .select(
        "id, description, amount, direction, date, store, transaction_split(id, category_id, amount)",
      )
      .eq("account_id", accountId)
      .eq("is_deleted", false)
      .order("date", { ascending: false })
      .limit(25);
    setTxns((history as Txn[]) ?? []);
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setSubmitting(true);
    setError(null);
    setSaved(false);

    const supabase = createClient();
    // rpc_update_account never accepts type/currency/budget_id/balance fields —
    // type-inappropriate fields are sent as null; the RPC re-validates
    // everything server-side against the account's own immutable type.
    const isGoal = account.type === "savings_goal";
    const isCard = account.type === "credit_card";
    const { error: rpcError } = await supabase.rpc("rpc_update_account", {
      p_account_id: account.id,
      p_name: name,
      p_target_amount: isGoal && targetAmount ? Number(targetAmount) : null,
      p_target_date: isGoal && targetDate ? targetDate : null,
      p_credit_limit: isCard && creditLimit ? Number(creditLimit) : null,
      p_due_date: isCard && dueDate ? dueDate : null,
      p_minimum_payment: isCard && minimumPayment ? Number(minimumPayment) : null,
    });

    if (rpcError) {
      // Generic message only (Secure Coding obligation 10) — "account not
      // found" and "not authorized" are intentionally indistinguishable here.
      setError("We couldn't save those changes. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setSaved(true);
    await load();
  }

  if (!account) {
    return (
      <main style={{ maxWidth: 560, margin: "3rem auto", padding: "0 1rem" }}>
        <p>
          <Link href="/dashboard" style={{ color: "var(--color-primary-dark)" }}>
            ← Dashboard
          </Link>
        </p>
        {error ? (
          <p role="alert" style={{ color: "var(--color-red)" }}>
            {error}
          </p>
        ) : (
          <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
        )}
      </main>
    );
  }

  const balance =
    account.type === "credit_card"
      ? (account.balance_owed ?? 0)
      : account.current_balance;

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "2rem 1rem 4rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        color: "var(--color-text)",
      }}
    >
      <p style={{ margin: 0 }}>
        <Link href="/dashboard" style={{ color: "var(--color-primary-dark)", fontWeight: 500 }}>
          ← Dashboard
        </Link>
      </p>

      <Card>
        <h1 style={{ ...heading, fontSize: "1.5rem", margin: "0 0 0.25rem" }}>
          {account.name}
        </h1>
        <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
          {account.type} ·{" "}
          <span style={{ color: "var(--color-text)", fontWeight: 600 }}>
            {balance.toFixed(2)} {account.currency}
            {account.type === "credit_card" ? " owed" : ""}
          </span>
        </p>

        <form
          onSubmit={handleSave}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.6rem",
            maxWidth: 380,
            marginTop: "1.25rem",
          }}
        >
          <h2 style={{ ...heading, fontSize: "1rem", margin: "0 0 0.25rem" }}>
            Edit details
          </h2>

          <label htmlFor="name" style={labelStyle}>
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            style={inputStyle}
          />

          {account.type === "savings_goal" && (
            <>
              <label htmlFor="targetAmount" style={labelStyle}>
                Target amount
              </label>
              <input
                id="targetAmount"
                type="number"
                step="0.01"
                value={targetAmount}
                onChange={(event) => setTargetAmount(event.target.value)}
                required
                style={inputStyle}
              />
              <label htmlFor="targetDate" style={labelStyle}>
                Target date (optional)
              </label>
              <input
                id="targetDate"
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
                style={inputStyle}
              />
            </>
          )}

          {account.type === "credit_card" && (
            <>
              <label htmlFor="creditLimit" style={labelStyle}>
                Credit limit
              </label>
              <input
                id="creditLimit"
                type="number"
                step="0.01"
                value={creditLimit}
                onChange={(event) => setCreditLimit(event.target.value)}
                required
                style={inputStyle}
              />
              <label htmlFor="dueDate" style={labelStyle}>
                Due date (optional)
              </label>
              <input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                style={inputStyle}
              />
              <label htmlFor="minimumPayment" style={labelStyle}>
                Minimum payment (optional)
              </label>
              <input
                id="minimumPayment"
                type="number"
                step="0.01"
                value={minimumPayment}
                onChange={(event) => setMinimumPayment(event.target.value)}
                style={inputStyle}
              />
            </>
          )}

          {error && (
            <p role="alert" style={{ color: "var(--color-red)", margin: 0 }}>
              {error}
            </p>
          )}
          {saved && (
            <p style={{ color: "var(--color-green)", margin: 0 }}>Saved.</p>
          )}

          <Button type="submit" variant="primary" disabled={submitting} style={{ marginTop: "0.25rem" }}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 style={{ ...heading, fontSize: "1rem", margin: "0 0 0.75rem" }}>
          Recent transactions
        </h2>
        {txns.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
            No transactions for this account yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {txns.map((txn) => (
              <div
                key={txn.id}
                style={{
                  borderBottom: "1px solid var(--color-border)",
                  paddingBottom: "0.6rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600 }}>{txn.description}</span>
                  <span
                    style={{
                      fontFamily: "var(--font-nunito), system-ui, sans-serif",
                      fontWeight: 700,
                      color: "var(--color-text)",
                    }}
                  >
                    {txn.direction === "income" ? "+" : "−"}
                    {txn.amount.toFixed(2)} {account.currency}
                  </span>
                </div>
                <div style={{ color: "var(--color-text-muted)", fontSize: "0.8rem" }}>
                  {txn.date}
                  {txn.store ? ` · ${txn.store}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}

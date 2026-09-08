"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

// Story 7.1 — Parent-only Member/Budget cap admin. Plain form, matching the
// /dashboard/security convention (no design-system primitives — Story 10.3's
// scope). RLS already scopes the household read/write to the caller's own
// household; rpc_update_household_caps re-verifies Parent server-side (AC4).
export default function HouseholdSettingsPage() {
  const [memberCap, setMemberCap] = useState("");
  const [budgetCap, setBudgetCap] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("household")
      .select("member_cap, budget_cap")
      .maybeSingle();
    if (readError || !data) {
      setError("We couldn't load your household settings. Please try again.");
      setLoading(false);
      return;
    }
    setMemberCap(String(data.member_cap));
    setBudgetCap(String(data.budget_cap));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("rpc_update_household_caps", {
      p_member_cap: Number(memberCap),
      p_budget_cap: Number(budgetCap),
    });

    if (rpcError) {
      // Generic message only (Secure Coding obligation 10) — never the raw
      // "not authorized" / "caps must be between 1 and 50" exception text.
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
      <h1>Household settings</h1>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <label htmlFor="memberCap">Member cap</label>
          <input
            id="memberCap"
            name="memberCap"
            type="number"
            min={1}
            max={50}
            value={memberCap}
            onChange={(event) => setMemberCap(event.target.value)}
            required
          />

          <label htmlFor="budgetCap">Budget cap</label>
          <input
            id="budgetCap"
            name="budgetCap"
            type="number"
            min={1}
            max={50}
            value={budgetCap}
            onChange={(event) => setBudgetCap(event.target.value)}
            required
          />

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

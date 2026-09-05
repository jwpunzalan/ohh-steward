"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type PeriodType = "monthly" | "biweekly";

export default function NewBudgetPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in to create a budget.");
      setSubmitting(false);
      return;
    }

    const { data: member, error: memberError } = await supabase
      .from("household_member")
      .select("id")
      .eq("auth_user_id", user.id)
      .eq("is_deleted", false)
      .single();

    if (memberError || !member) {
      setError("We couldn't find your household. Please try again.");
      setSubmitting(false);
      return;
    }

    // Assigns the new Budget to the creator only. Picking additional
    // co-owners requires a household member list, which doesn't exist yet
    // (Story 1.2's invite flow) — see this story's PR description.
    const { error: createError } = await supabase.rpc("rpc_create_budget", {
      p_name: name,
      p_period_type: periodType,
      p_owner_member_ids: [member.id],
    });

    if (createError) {
      // Never surface raw Supabase/Postgres error text (Secure Coding
      // obligation 10) — e.g. the household budget cap being reached.
      setError("We couldn't create that budget. Please try again.");
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Create a budget</h1>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />

        <label htmlFor="periodType">Period</label>
        <select
          id="periodType"
          name="periodType"
          value={periodType}
          onChange={(event) => setPeriodType(event.target.value as PeriodType)}
        >
          <option value="monthly">Monthly</option>
          <option value="biweekly">Biweekly</option>
        </select>

        {error && (
          <p role="alert" style={{ color: "crimson" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create budget"}
        </button>
      </form>
    </main>
  );
}

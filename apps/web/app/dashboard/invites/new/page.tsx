"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Role = "parent" | "member";

export default function NewInvitePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();

    const { error: inviteError } = await supabase.rpc("rpc_create_invite", {
      p_email: email,
      p_role: role,
    });

    if (inviteError) {
      // Never surface raw Supabase/Postgres error text (Secure Coding
      // obligation 10) — e.g. "not authorized" or "member cap reached".
      setError("We couldn't send that invite. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setSent(true);
    setEmail("");
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Invite someone to your household</h1>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="role">Role</label>
        <select
          id="role"
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          <option value="member">Member</option>
          <option value="parent">Parent</option>
        </select>

        {error && (
          <p role="alert" style={{ color: "crimson" }}>
            {error}
          </p>
        )}
        {sent && <p>Invite sent.</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Send invite"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => router.push("/dashboard")}
        style={{ marginTop: "1rem", background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}
      >
        Back to dashboard
      </button>
    </main>
  );
}

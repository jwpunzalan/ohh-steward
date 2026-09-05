"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AccountPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setMessage(null);

    const supabase = createClient();

    const { data, error } = await supabase.functions.invoke(
      "delete-own-account",
      { method: "POST" },
    );

    if (error) {
      // The RPC's own exception messages are fixed, non-interpolated
      // strings safe to show verbatim (Secure Coding obligation 10 — see
      // this story's Application to this story section) — e.g. the
      // last-Parent guidance message. A genuinely unexpected failure falls
      // back to a generic message instead.
      const body = await error.context?.json?.().catch(() => null);
      setMessage(body?.error ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    void data;
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Account</h1>

      {message && <p role="alert">{message}</p>}

      <button type="button" onClick={handleDelete} disabled={submitting}>
        {submitting ? "Deleting…" : "Delete my account"}
      </button>
    </main>
  );
}

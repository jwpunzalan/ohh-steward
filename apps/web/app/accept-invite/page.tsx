"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [token, setToken] = useState(searchParams.get("token") ?? "");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();

    const { data, error: invokeError } = await supabase.functions.invoke(
      "accept-invite",
      { body: { token, email, password } },
    );

    if (invokeError || !data?.session) {
      // Uniform generic message regardless of which internal condition
      // failed (AC6) — never surface raw error text (obligation 10).
      setError("This invite link is invalid or has expired.");
      setSubmitting(false);
      return;
    }

    await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });

    router.push("/dashboard");
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Accept your invite</h1>

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

        <label htmlFor="token">Invite token</label>
        <input
          id="token"
          name="token"
          type="text"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          required
        />

        <label htmlFor="password">Choose a password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />

        {error && (
          <p role="alert" style={{ color: "crimson" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? "Please wait…" : "Join household"}
        </button>
      </form>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}

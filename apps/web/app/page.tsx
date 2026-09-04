"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signup" | "signin";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();

    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signUpError) {
        // Never surface raw Supabase/Postgres error text (Secure Coding
        // obligation 10) — e.g. Supabase Auth's native duplicate-email error.
        setError("We couldn't create your account. Please try again.");
        setSubmitting(false);
        return;
      }

      const { error: bootstrapError } = await supabase.rpc(
        "rpc_bootstrap_household",
      );
      if (bootstrapError) {
        setError(
          "We couldn't finish setting up your household. Please try again.",
        );
        setSubmitting(false);
        return;
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError("Invalid email or password.");
        setSubmitting(false);
        return;
      }
    }

    router.push("/dashboard");
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>{mode === "signup" ? "Create your household" : "Sign in"}</h1>

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
          autoComplete="email"
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={6}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />

        {error && (
          <p role="alert" style={{ color: "crimson" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting
            ? "Please wait…"
            : mode === "signup"
              ? "Sign up"
              : "Sign in"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signup" ? "signin" : "signup");
          setError(null);
        }}
        style={{ marginTop: "1rem", background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}
      >
        {mode === "signup"
          ? "Already have an account? Sign in"
          : "Need an account? Sign up"}
      </button>
    </main>
  );
}

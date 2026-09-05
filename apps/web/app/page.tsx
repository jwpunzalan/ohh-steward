"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signup" | "signin";
type Step = "credentials" | "mfa-challenge";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signup");
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaChallengeId, setMfaChallengeId] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();

    if (mode === "signup") {
      // Household bootstrap happens server-side via a database trigger on
      // auth.users (Story 1.1.G2) — unconditionally, at account-creation
      // time, regardless of whether email confirmation is required. No
      // client-side bootstrap call exists: under mandatory email
      // confirmation (this project's actual configuration), signUp()
      // returns session: null until the user confirms, so any call
      // requiring an authenticated session would run as anon and fail.
      const { data, error: signUpError } = await supabase.auth.signUp({
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

      if (!data.session) {
        setSubmitting(false);
        setCheckEmail(true);
        return;
      }
    } else {
      // AC1: any device with no valid stored session always goes through
      // the full flow — password, then MFA challenge if the user has 2FA
      // enrolled — never a shortcut.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError("Invalid email or password.");
        setSubmitting(false);
        return;
      }

      const { data: aal } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        const { data: factors, error: factorsError } =
          await supabase.auth.mfa.listFactors();
        const factor = factors?.totp?.[0];
        if (factorsError || !factor) {
          setError("We couldn't complete sign-in. Please try again.");
          setSubmitting(false);
          return;
        }
        const { data: challenge, error: challengeError } =
          await supabase.auth.mfa.challenge({ factorId: factor.id });
        if (challengeError || !challenge) {
          setError("We couldn't complete sign-in. Please try again.");
          setSubmitting(false);
          return;
        }
        setMfaFactorId(factor.id);
        setMfaChallengeId(challenge.id);
        setSubmitting(false);
        setStep("mfa-challenge");
        return;
      }
    }

    router.push("/dashboard");
  }

  if (checkEmail) {
    return (
      <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Check your email</h1>
        <p>
          We sent a confirmation link to {email}. Confirm your account, then
          come back and sign in.
        </p>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode("signin");
            setCheckEmail(false);
          }}
          style={{ background: "none", border: "none", textDecoration: "underline", cursor: "pointer", padding: 0 }}
        >
          Back to sign in
        </button>
      </main>
    );
  }

  async function handleVerifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode,
    });

    if (verifyError) {
      setError("Invalid code. Please try again.");
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
  }

  if (step === "mfa-challenge") {
    return (
      <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Enter your 2FA code</h1>

        <form
          onSubmit={handleVerifyMfa}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <label htmlFor="mfaCode">6-digit code</label>
          <input
            id="mfaCode"
            name="mfaCode"
            type="text"
            inputMode="numeric"
            value={mfaCode}
            onChange={(event) => setMfaCode(event.target.value)}
            required
          />

          {error && (
            <p role="alert" style={{ color: "crimson" }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting}>
            {submitting ? "Verifying…" : "Verify"}
          </button>
        </form>
      </main>
    );
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

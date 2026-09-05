"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SecurityPage() {
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);

  async function handleStartEnrollment() {
    setSubmitting(true);
    setError(null);
    setEnrolled(false);

    const supabase = createClient();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
    });

    if (enrollError || !data) {
      setError("We couldn't start 2FA enrollment. Please try again.");
      setSubmitting(false);
      return;
    }

    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setSubmitting(false);
  }

  async function handleConfirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError("We couldn't confirm 2FA enrollment. Please try again.");
      setSubmitting(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    if (verifyError) {
      setError("Invalid code. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setEnrolled(true);
    setQrCode("");
    setSecret("");
    setCode("");
    setFactorId("");
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Security</h1>

      {enrolled && <p>Two-factor authentication is now enabled.</p>}

      {!qrCode && !enrolled && (
        <button type="button" onClick={handleStartEnrollment} disabled={submitting}>
          {submitting ? "Starting…" : "Enable 2FA"}
        </button>
      )}

      {qrCode && (
        <form
          onSubmit={handleConfirmEnrollment}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <p>Scan this QR code with your authenticator app:</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- inline
              SVG data URI from Supabase, not a static/optimizable asset */}
          <img src={qrCode} alt="2FA enrollment QR code" width={200} height={200} />
          <p>Or enter this code manually: {secret}</p>

          <label htmlFor="code">6-digit code</label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />

          {error && (
            <p role="alert" style={{ color: "crimson" }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting}>
            {submitting ? "Confirming…" : "Confirm"}
          </button>
        </form>
      )}
    </main>
  );
}

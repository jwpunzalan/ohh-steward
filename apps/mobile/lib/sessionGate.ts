import * as LocalAuthentication from "expo-local-authentication";
import { supabase } from "./supabase";
import {
  clearStoredSession,
  getIdleElapsedMinutes,
  getStoredSession,
  touchActivity,
} from "./session";

export type ResumeResult = "resumed" | "reauth-required";

// AC5 (negative security): the idle-timer check runs before any biometric
// prompt or setSession() call on the stored token — no code path here may
// reach LocalAuthentication.authenticateAsync() or supabase.auth.setSession()
// without first passing this check. Used at cold start, when the in-memory
// Supabase client has no session yet (persistSession is false — see
// lib/supabase.ts) and a stored session may need to be resumed.
export async function resumeStoredSessionIfAllowed(
  sessionTimeoutMinutes: number,
): Promise<ResumeResult> {
  const idleElapsedMinutes = await getIdleElapsedMinutes();

  if (idleElapsedMinutes > sessionTimeoutMinutes) {
    // Idle timeout elapsed: revoke this device's session only (never the
    // default 'global' scope — that would sign the user out of every
    // device), then remove our own stored copy. Do not proceed to the
    // biometric gate below.
    await supabase.auth.signOut({ scope: "local" });
    await clearStoredSession();
    return "reauth-required";
  }

  const stored = await getStoredSession();
  if (!stored) {
    return "reauth-required";
  }

  const biometric = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock OHh Steward",
  });
  if (!biometric.success) {
    return "reauth-required";
  }

  const { error } = await supabase.auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
  });
  if (error) {
    return "reauth-required";
  }

  await touchActivity();
  return "resumed";
}

// For an app that was only backgrounded, not cold-started: the in-memory
// Supabase client still holds its live session (nothing was cleared), so
// there is no stored token to resume and no biometric gate to run — only
// the idle check applies, to decide whether that still-live session should
// now be explicitly revoked (AC3). Never reaches the biometric prompt.
export async function checkIdleAndSignOutIfElapsed(
  sessionTimeoutMinutes: number,
): Promise<"signed-out" | "still-active"> {
  const idleElapsedMinutes = await getIdleElapsedMinutes();
  if (idleElapsedMinutes > sessionTimeoutMinutes) {
    await supabase.auth.signOut({ scope: "local" });
    await clearStoredSession();
    return "signed-out";
  }
  return "still-active";
}

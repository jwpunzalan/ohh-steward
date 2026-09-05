import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { Session } from "@supabase/supabase-js";

// The session token is the sensitive value here (Secure Coding obligation
// 8) — stored only via the OS Keychain/Keystore through expo-secure-store,
// never AsyncStorage. The last-activity timestamp and the cached idle-
// timeout minutes are not secrets, so plain AsyncStorage is fine for those
// (and keeps them off the more limited-capacity SecureStore).
const SESSION_KEY = "sb-session";
const LAST_ACTIVITY_KEY = "last-activity-at";
const SESSION_TIMEOUT_MINUTES_KEY = "cached-session-timeout-minutes";

const DEFAULT_SESSION_TIMEOUT_MINUTES = 30; // matches household.session_timeout_minutes's own DB default

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function getStoredSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function touchActivity(): Promise<void> {
  await AsyncStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

// No recorded activity (e.g. first launch after install) is treated as
// fully idle — fail closed into requiring full re-authentication rather
// than assuming a fresh, unelapsed window (Secure Coding obligation 6).
export async function getIdleElapsedMinutes(): Promise<number> {
  const raw = await AsyncStorage.getItem(LAST_ACTIVITY_KEY);
  if (!raw) return Number.POSITIVE_INFINITY;
  const lastActivityAt = Number(raw);
  if (!Number.isFinite(lastActivityAt)) return Number.POSITIVE_INFINITY;
  return (Date.now() - lastActivityAt) / 60000;
}

// household.session_timeout_minutes can only be read via an authenticated,
// RLS-scoped query (Story 2.1) — but the idle-timer check that decides
// whether to allow resuming a session must run *before* any session is
// restored, so it cannot make that query itself. Resolved by caching the
// value locally whenever the app does have a live session (see
// cacheSessionTimeoutMinutes, called after login/enrollment/resume), and
// reading the cached value for the next gate check. Not a secret, so plain
// AsyncStorage is fine.
export async function cacheSessionTimeoutMinutes(
  minutes: number,
): Promise<void> {
  await AsyncStorage.setItem(SESSION_TIMEOUT_MINUTES_KEY, String(minutes));
}

export async function getCachedSessionTimeoutMinutes(): Promise<number> {
  const raw = await AsyncStorage.getItem(SESSION_TIMEOUT_MINUTES_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_SESSION_TIMEOUT_MINUTES;
}

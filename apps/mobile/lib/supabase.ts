import { createClient } from "@supabase/supabase-js";

// persistSession is deliberately false: Story 1.4's idle-timeout/biometric
// design manages its own explicit copy of the session in expo-secure-store
// (see lib/session.ts) and only ever calls supabase.auth.setSession() after
// the idle-timer + biometric gate (lib/sessionGate.ts) has passed — never
// via the SDK's own automatic session restoration, which would resume a
// stored session unconditionally on cold start with no gate at all.
// autoRefreshToken stays true: once a session IS live (gate passed, or a
// fresh signInWithPassword), normal in-session token refresh is exactly what
// should keep happening while the app is actually in use.
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

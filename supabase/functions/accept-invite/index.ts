// accept-invite
//
// The only caller of rpc_accept_invite (service_role-only RPC — see the
// invite_flow migration). Unauthenticated endpoint: no Supabase user session
// exists yet at this point, only the project's anon key (sent automatically
// by the client SDK) is required to reach it.
//
// Body: { token: string (uuid), email: string, password: string } — validated
// against this explicit schema before any downstream call (obligations 2/9).
// Every rejection reason (malformed/expired/accepted/email-mismatched token)
// returns the identical generic 400 message (AC6) — never distinguishing
// which internal condition failed (obligation 10). The invite token itself
// is never logged (obligation 5).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";

const GENERIC_ERROR = "invalid or expired invite";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isValidEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 72;
}

function genericError(status: number) {
  return new Response(JSON.stringify({ error: GENERIC_ERROR }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return genericError(400);
  }

  const { token, email, password } = body as Record<string, unknown>;

  if (!isUuid(token) || !isValidEmail(email) || !isValidPassword(password)) {
    return genericError(400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (createError || !created?.user) {
    // Covers "email already registered" and any other Auth Admin failure —
    // still the same generic message externally (obligation 10); the
    // specific reason is not this endpoint's to disclose.
    return genericError(400);
  }

  const { error: acceptError } = await admin.rpc("rpc_accept_invite", {
    p_token: token,
    p_email: email,
    p_auth_user_id: created.user.id,
  });

  if (acceptError) {
    // Do NOT leave an orphaned auth.users record (Implementation
    // Instructions "Do NOT" list) — clean up before returning.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return genericError(400);
  }

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: signInData, error: signInError } =
    await anon.auth.signInWithPassword({ email, password });

  if (signInError || !signInData.session) {
    // The household_member row and auth user both exist correctly at this
    // point — a sign-in hiccup here is not an invite-validity failure, so it
    // does not get the generic invite error, but it also never discloses
    // internal detail (obligation 10).
    return new Response(
      JSON.stringify({ error: "account created, please sign in" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ session: signInData.session }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

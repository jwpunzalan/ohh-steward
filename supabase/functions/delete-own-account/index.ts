// delete-own-account
//
// The only client-facing path to deleting a caller's own account. Forwards
// the caller's own JWT (never a service-role client with a caller-supplied
// target id — Do NOT list) to call rpc_delete_own_account(), so auth.uid()
// inside the RPC resolves to the actual requester and the last-Parent guard
// evaluates correctly. Only after that call succeeds does this function
// switch to a separate service-role Admin client to remove the underlying
// auth.users record — the RPC itself cannot do that (Supabase Auth Admin API
// is not callable from plain SQL).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "not authorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "not authorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error: rpcError } = await callerClient.rpc(
    "rpc_delete_own_account",
  );

  if (rpcError) {
    // Safe to surface verbatim (obligation 10) — rpc_delete_own_account()
    // only ever raises one of two fixed, non-interpolated strings, neither
    // of which discloses stack traces, SQL text, or internal state.
    return new Response(JSON.stringify({ error: rpcError.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

  if (deleteError) {
    // The household-integrity guarantee is already satisfied at this point
    // (the household_member row is soft-deleted) — this is a genuinely
    // unexpected failure, logged by id only (obligation 5), never disclosed
    // in detail to the client (obligation 10).
    console.error(`delete-own-account: Auth deletion failed for ${user.id}`);
    return new Response(
      JSON.stringify({
        error: "something went wrong",
        correlation_id: crypto.randomUUID(),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

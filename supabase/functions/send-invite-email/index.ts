// send-invite-email
//
// Internal only — invoked by rpc_create_invite via a pg_net webhook using
// the service_role key stored in Supabase Vault (see the invite_flow
// migration). Never intended to be called directly by a client. Supabase's
// gateway already verifies the caller presented a valid, signed JWT before
// this code runs; this function additionally checks that JWT's `role` claim
// is `service_role` specifically, so a caller holding only an `anon` or
// `authenticated` JWT is rejected even though gateway-level verification
// passed (Secure Coding obligations 6/7 — fail closed, least privilege).
//
// Body: { invite_id: string (uuid) }. The invite row (including its token)
// is re-read server-side by id — the token is never accepted as an input to
// this function, and never appears in any log line here (obligation 5).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";

function isServiceRoleRequest(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1]));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

Deno.serve(async (req) => {
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: "not authorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const inviteId = (body as { invite_id?: unknown })?.invite_id;
  if (!isUuid(inviteId)) {
    return new Response(JSON.stringify({ error: "invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: invite, error: inviteError } = await supabase
    .from("invite")
    .select("email, token, role")
    .eq("id", inviteId)
    .single();

  if (inviteError || !invite) {
    // Never disclose internal error detail to the caller (obligation 10).
    // This is an internal webhook, so the only "caller" is Postgres itself
    // (fire-and-forget) — logging a reference id server-side is sufficient.
    console.error(`send-invite-email: invite ${inviteId} not found`);
    return new Response(JSON.stringify({ error: "invite not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const siteUrl = Deno.env.get("PUBLIC_SITE_URL");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("INVITE_EMAIL_FROM");

  if (!siteUrl || !resendApiKey || !fromAddress) {
    console.error(
      "send-invite-email: missing PUBLIC_SITE_URL, RESEND_API_KEY, or INVITE_EMAIL_FROM secret",
    );
    return new Response(
      JSON.stringify({ error: "email delivery not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const acceptUrl = `${siteUrl}/accept-invite?token=${invite.token}&email=${encodeURIComponent(invite.email)}`;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: invite.email,
      subject: "You've been invited to a household on OHh Steward",
      html: `<p>You've been invited to join a household as a ${invite.role}.</p><p><a href="${acceptUrl}">Accept the invite</a></p><p>This link expires in 7 days.</p>`,
    }),
  });

  if (!resendResponse.ok) {
    // Never log the response body verbatim (could echo back request
    // content); log only the status for troubleshooting (obligation 5).
    console.error(`send-invite-email: Resend request failed (${resendResponse.status})`);
    return new Response(JSON.stringify({ error: "email delivery failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

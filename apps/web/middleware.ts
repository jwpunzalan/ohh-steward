import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

// Story 7.1 — Parent-only web-wide route guard. This is a UX-layer convenience:
// every mutating RPC independently re-checks authorization server-side (AC4),
// so a guard bug cannot become an authorization bypass.
//
// - No authenticated session -> pass through unchanged (preserve today's
//   unauthenticated-access behavior exactly; AC2 is about a Member's
//   *authenticated* session being denied, not tightening anon access).
// - "/", "/accept-invite*", "/member-web-blocked" -> always reachable
//   regardless of role, or sign-in / invite-acceptance / the block page break.
// - Otherwise: read the caller's own role (RLS already permits `auth_user_id =
//   auth.uid()`); a non-Parent (or no membership row) is redirected to
//   /member-web-blocked. Parents pass through.

const PUBLIC_EXACT = new Set(["/", "/member-web-blocked"]);

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);
  const { pathname } = request.nextUrl;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return response;
  }

  if (PUBLIC_EXACT.has(pathname) || pathname.startsWith("/accept-invite")) {
    return response;
  }

  const { data: member } = await supabase
    .from("household_member")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (!member || member.role !== "parent") {
    const url = request.nextUrl.clone();
    url.pathname = "/member-web-blocked";
    const redirect = NextResponse.redirect(url);
    // Carry any refreshed auth cookies onto the redirect so the block page
    // doesn't see a stale/expired session and loop.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

// Broad matcher: only Next.js static internals are excluded here. The three
// always-reachable paths are handled in the function body (a regex-only
// exclusion is easy to get subtly wrong).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

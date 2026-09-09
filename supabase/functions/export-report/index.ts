// export-report
//
// Story 7.2 — the CSV export path for the Parent-only Reports screen. This is
// the ONE server-side surface for this story that sits outside Story 7.1's
// Next.js middleware (middleware only guards page navigation inside the Next
// app, never a direct HTTPS call to this function), so it carries its own
// explicit Parent check.
//
// It runs exclusively as the calling Parent's own forwarded session — never a
// service-role client (Do NOT list). `verify_jwt = true` in config.toml is the
// primary fail-closed boundary: the Supabase gateway rejects a missing/invalid
// JWT with 401 before this body runs (AC4). auth.getUser() below is defence in
// depth. The is_household_parent() call is what makes this Parent-only rather
// than Budget-owner-inclusive: v_category_period_state's own RLS is governed by
// can_access_budget(), which also permits a Budget-owner Member (AC5).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// RFC 4180: quote a field iff it contains a comma, double-quote, CR or LF;
// escape embedded double-quotes by doubling them.
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

Deno.serve(async (req) => {
  // Summary-level observability only — never the report content (obligation 5).
  const log = (outcome: string, budgetId?: string) =>
    console.log(
      JSON.stringify({ fn: "export-report", outcome, budget_id: budgetId ?? null }),
    );

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    log("401_no_auth_header");
    return json({ error: "not authorized" }, 401);
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
    log("401_getuser_failed");
    return json({ error: "not authorized" }, 401);
  }

  // Untrusted request body — validate shape and UUID format before any use
  // (obligation 2 / 9).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    log("400_bad_json");
    return json({ error: "invalid request" }, 400);
  }
  const budgetId = (body as Record<string, unknown>)?.budget_id;
  const periodId = (body as Record<string, unknown>)?.period_id;
  if (
    typeof budgetId !== "string" ||
    typeof periodId !== "string" ||
    !UUID_RE.test(budgetId) ||
    !UUID_RE.test(periodId)
  ) {
    log("400_bad_params");
    return json({ error: "invalid request" }, 400);
  }

  try {
    // RLS-scoped to the caller: a Budget they cannot see returns no row. A
    // missing row and a failed Parent check both resolve to the SAME generic
    // 403 — never distinguished (obligation 10), matching rpc_update_account.
    const { data: budgetRow, error: budgetError } = await callerClient
      .from("budget")
      .select("household_id")
      .eq("id", budgetId)
      .single();
    if (budgetError || !budgetRow) {
      log("403_budget_not_visible", budgetId);
      return json({ error: "forbidden" }, 403);
    }

    const { data: isParent, error: parentError } = await callerClient.rpc(
      "is_household_parent",
      { p_household_id: budgetRow.household_id },
    );
    if (parentError || isParent !== true) {
      log("403_not_parent", budgetId);
      return json({ error: "forbidden" }, 403);
    }

    // Filename bounds — RLS-scoped read; a period outside the caller's reach
    // resolves to no row, treated the same as the 403 above.
    const { data: periodRow, error: periodError } = await callerClient
      .from("budget_period")
      .select("period_start, period_end")
      .eq("id", periodId)
      .single();
    if (periodError || !periodRow) {
      log("403_period_not_visible", budgetId);
      return json({ error: "forbidden" }, 403);
    }

    const { data: rows, error: stateError } = await callerClient
      .from("v_category_period_state")
      .select("*")
      .eq("budget_period_id", periodId);
    if (stateError) {
      throw stateError;
    }

    const header = ["category_name", "limit_amount", "spent", "remaining"];
    const lines = [header.join(",")];
    for (const row of rows ?? []) {
      const remaining = Number(row.limit_amount) - Number(row.spent);
      lines.push(
        [
          csvField(row.category_name),
          csvField(row.limit_amount),
          csvField(row.spent),
          csvField(remaining),
        ].join(","),
      );
    }
    const csv = lines.join("\r\n");

    log("200", budgetId);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="report-${budgetId}-${periodRow.period_start}-${periodRow.period_end}.csv"`,
      },
    });
  } catch (_error) {
    // Never surface raw query/error text (obligation 10).
    const correlationId = crypto.randomUUID();
    console.error(
      JSON.stringify({ fn: "export-report", outcome: "500", correlation_id: correlationId }),
    );
    return json({ error: "export failed", correlation_id: correlationId }, 500);
  }
});

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Story 7.2 — Audit Log viewer. Parent-only by virtue of Story 7.1's web-wide
// middleware — no new access-control mechanism. Pure read layer over
// audit_log_entry (RLS: audit_log_read, Parent-only, live since Story 3.3).
// AC2: who changed what and when, across every entity the system audits,
// filterable by date range, entity type, and household member.

// The fixed 12-entity audit set (Grounding Check). New audited tables must be
// added here as they are added elsewhere — the same standing convention
// Story 3.3 established for trigger coverage.
const ENTITY_TYPES = [
  "account",
  "budget",
  "budget_owner",
  "budget_period",
  "category",
  "category_limit",
  "household",
  "household_member",
  "invite",
  "transaction",
  "transaction_split",
  "transfer",
] as const;

const ROW_LIMIT = 200;

type AuditRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  household_member_id: string | null;
  action: string;
  diff: unknown;
  created_at: string;
};
type Member = { id: string; role: string };

const trunc = (value: string | null) =>
  value ? `${value.slice(0, 8)}…` : "—";

export default function AuditLogPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entityType, setEntityType] = useState("");
  const [memberId, setMemberId] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("household_member")
      .select("id, role")
      .order("created_at")
      .then(({ data }) => setMembers((data as Member[]) ?? []));
  }, []);

  const runQuery = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    let query = supabase
      .from("audit_log_entry")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT);

    // Each filter is applied only when actually set; values are bound as
    // Supabase client parameters, never interpolated into a query string.
    if (entityType) query = query.eq("entity_type", entityType);
    if (memberId) query = query.eq("household_member_id", memberId);
    if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
    if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

    const { data, error: queryError } = await query;
    if (queryError) {
      setError("We couldn't load the audit log. Please try again.");
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((data as AuditRow[]) ?? []);
    setLoading(false);
  }, [entityType, memberId, from, to]);

  useEffect(() => {
    runQuery();
  }, [runQuery]);

  return (
    <main style={{ maxWidth: 900, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Audit log</h1>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          alignItems: "flex-end",
          margin: "1rem 0",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Entity
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Member
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">All</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.role} · {trunc(m.id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No audit entries match these filters.</p>
      ) : (
        <>
          <p style={{ fontSize: "0.8rem", color: "#666" }}>
            Showing {rows.length} most recent {rows.length === ROW_LIMIT ? `(capped at ${ROW_LIMIT})` : ""}.
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
                <th style={{ padding: "0.4rem 0.5rem" }}>When</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Action</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Entity</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Entity ID</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Member</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Diff</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const memberRole = members.find((m) => m.id === row.household_member_id)?.role;
                return (
                  <tr key={row.id} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                    <td style={{ padding: "0.4rem 0.5rem", whiteSpace: "nowrap" }}>
                      {row.created_at}
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>{row.action}</td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>{row.entity_type}</td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>{trunc(row.entity_id)}</td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      {memberRole ? `${memberRole} · ` : ""}
                      {trunc(row.household_member_id)}
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <details>
                        <summary style={{ cursor: "pointer" }}>view</summary>
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            background: "#f6f6f6",
                            padding: "0.5rem",
                            margin: "0.3rem 0 0",
                            maxWidth: 420,
                            overflowX: "auto",
                          }}
                        >
                          {JSON.stringify(row.diff, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

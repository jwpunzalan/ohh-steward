"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { IconBadge } from "@/components/ui/IconBadge";

type Budget = { id: string; name: string };
type Period = { id: string; period_start: string; period_end: string };
type CategoryState = {
  budget_period_id: string;
  budget_id: string;
  category_id: string;
  category_name: string;
  limit_amount: number;
  spent: number;
};
type Band = "pending" | "green" | "amber" | "red";
type AccountRow = {
  id: string;
  type: string;
  name: string;
  currency: string;
  current_balance: number;
  balance_owed: number | null;
  target_amount: number | null;
};
type AcctTotals = Record<string, { income: number; expense: number }>;

const DAY_MS = 86_400_000;

// Story 6.2 — pacing ratio = (% of budget spent) / (% of period elapsed).
// Elapsed time is clamped to [period_start, period_end], so an already-closed
// period always reads as exactly 100% elapsed (ratio = spent/limit) and a
// not-yet-started one reads as 0% → null → 'pending' (AC5). Mirrors the DIP's
// SQL formula; day-based (budget_period columns are `date`, so date−date is an
// integer number of days).
function pacingRatio(
  spent: number,
  limit: number,
  periodStart: string,
  periodEnd: string,
): number | null {
  if (limit <= 0) return null;
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const elapsedDays = (Math.max(Math.min(today, end), start) - start) / DAY_MS;
  const totalDays = (end - start) / DAY_MS;
  if (elapsedDays <= 0 || totalDays <= 0) return null;
  return spent / limit / (elapsedDays / totalDays);
}

// Fixed thresholds (AC1/AC2), identical to fn_pacing_band().
function pacingBand(ratio: number | null): Band {
  if (ratio === null) return "pending";
  if (ratio <= 1.1) return "green";
  if (ratio <= 1.3) return "amber";
  return "red";
}

// Story 10.1 semantic tokens for the pacing bands — never a raw hex (AC1).
// 'pending' is the muted-text token, never a colour signal.
const BAND_TOKEN: Record<Band, string> = {
  pending: "var(--color-text-muted)",
  green: "var(--color-green)",
  amber: "var(--color-amber)",
  red: "var(--color-red)",
};

const BAND_LABEL: Record<Band, string> = {
  pending: "Pending",
  green: "On track",
  amber: "Watch",
  red: "Over budget",
};

// ── inline SVG icons (no icon-library dependency, per Story 10.1) ──────────
type IconProps = { color?: string };
const svgBase = (color?: string): CSSProperties => ({
  color: color ?? "var(--color-card)",
  width: 20,
  height: 20,
});
const iconProps = (color?: string) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  style: svgBase(color),
});

function CartIcon({ color }: IconProps) {
  return (
    <svg {...iconProps(color)}>
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M3 4h2l2.4 12.5a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 8H6" />
    </svg>
  );
}
function UtensilsIcon({ color }: IconProps) {
  return (
    <svg {...iconProps(color)}>
      <path d="M4 3v7a2 2 0 0 0 2 2v9M8 3v7M6 3v4M18 3c-1.7 0-3 2-3 5s1 4 3 4v9" />
    </svg>
  );
}
function CarIcon({ color }: IconProps) {
  return (
    <svg {...iconProps(color)}>
      <path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13M5 13h14v4H5zM7 17v2M17 17v2" />
      <circle cx="7.5" cy="15" r="0.5" />
      <circle cx="16.5" cy="15" r="0.5" />
    </svg>
  );
}
function ScreenIcon({ color }: IconProps) {
  return (
    <svg {...iconProps(color)}>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
function BoltIcon({ color }: IconProps) {
  return (
    <svg {...iconProps(color)}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  );
}
function TagIcon({ color }: IconProps) {
  return (
    <svg {...iconProps(color)}>
      <path d="M20 12l-8 8-9-9V4h7z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </svg>
  );
}
function WalletIcon({ color }: IconProps) {
  return (
    <svg {...iconProps(color)}>
      <path d="M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9H5a2 2 0 0 1-2-2z" />
      <circle cx="16" cy="13" r="1" />
    </svg>
  );
}
function CardIcon({ color }: IconProps) {
  return (
    <svg {...iconProps(color)}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </svg>
  );
}
function TargetIcon({ color }: IconProps) {
  return (
    <svg {...iconProps(color)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}

// AC3 grounding decision: `category` has no icon/color column and names are
// arbitrary Parent text — a client-side, case-insensitive, name-keyed lookup
// for the mockup's five, with a generic tinted fallback for everything else.
function categoryVisual(name: string): {
  bg: string;
  icon: ReactNode;
} {
  const key = name.trim().toLowerCase();
  switch (key) {
    case "groceries":
      return { bg: "var(--color-coral)", icon: <CartIcon /> };
    case "dining out":
    case "dining":
      return { bg: "var(--color-gold)", icon: <UtensilsIcon /> };
    case "transportation":
      return { bg: "var(--color-slate)", icon: <CarIcon /> };
    case "entertainment":
      return { bg: "var(--color-lavender)", icon: <ScreenIcon /> };
    case "utilities":
      return { bg: "var(--color-sage)", icon: <BoltIcon /> };
    default:
      return {
        bg: "var(--color-primary-tint)",
        icon: <TagIcon color="var(--color-primary-dark)" />,
      };
  }
}

// `account.type` IS a fixed schema enum — a direct switch, not a name guess.
function accountVisual(type: string): { bg: string; icon: ReactNode } {
  switch (type) {
    case "credit_card":
      return { bg: "var(--color-coral)", icon: <CardIcon /> };
    case "savings":
    case "savings_goal":
      return { bg: "var(--color-gold)", icon: <TargetIcon /> };
    default:
      return {
        bg: "var(--color-primary-tint)",
        icon: <WalletIcon color="var(--color-primary-dark)" />,
      };
  }
}

// A circular progress ring (AC3 hero). Pure display transform of already-
// computed budgetSummary values — no new calculation logic.
function ProgressRing({
  percent,
  color,
  label,
}: {
  percent: number;
  color: string;
  label: string;
}) {
  const size = 96;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - clamped / 100)}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-nunito), system-ui, sans-serif",
        }}
      >
        <span style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--color-text)" }}>
          {label}
        </span>
      </div>
    </div>
  );
}

const panelHeading: CSSProperties = {
  fontFamily: "var(--font-nunito), system-ui, sans-serif",
  fontWeight: 800,
  fontSize: "1rem",
  color: "var(--color-text)",
  margin: "0 0 0.75rem",
};

export default function DashboardPage() {
  const router = useRouter();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetId, setBudgetId] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  // periods are ordered newest-first; index 0 is the current/open period.
  // "Older" moves the index up, "Newer" moves it down (DIP item 5: index-based
  // navigation over the already-loaded array, no query per click).
  const [periodIndex, setPeriodIndex] = useState(0);
  const [states, setStates] = useState<CategoryState[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);
  // Story 6.3: Accounts/Cards/Savings summary — one accounts query + one
  // period-scoped transaction query for the whole Budget (no per-account loop).
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [acctTotals, setAcctTotals] = useState<AcctTotals>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("budget")
      .select("id, name")
      .eq("is_deleted", false)
      .order("name")
      .then(({ data, error: budgetError }) => {
        if (budgetError) {
          setError("We couldn't load your dashboard. Please try again.");
          return;
        }
        if (data) {
          setBudgets(data);
          if (data[0]) setBudgetId(data[0].id);
        }
      });
  }, []);

  useEffect(() => {
    if (!budgetId) return;
    const supabase = createClient();
    setPeriodIndex(0);
    setCurrency(null);
    supabase
      .from("budget_period")
      .select("id, period_start, period_end")
      .eq("budget_id", budgetId)
      .order("period_start", { ascending: false })
      .then(({ data, error: periodError }) => {
        if (periodError) {
          setError("We couldn't load your dashboard. Please try again.");
          return;
        }
        setPeriods(data ?? []);
      });
    // AC4/AC6: the currency label is derived server-side from the Budget's own
    // Accounts (RLS-scoped), never a client-supplied or hardcoded value. Per
    // Story 2.4.G2 a Budget's accounts are always single-currency, so the
    // first non-deleted account's currency is the Budget's currency.
    supabase
      .from("account")
      .select("currency")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false)
      .order("created_at")
      .limit(1)
      .then(({ data }) => setCurrency(data?.[0]?.currency ?? null));
    // AC1: per-record current balance. (Story 10.2: target_amount added for
    // the Savings Goal progress bar — same query, one more scalar column.)
    supabase
      .from("account")
      .select(
        "id, type, name, currency, current_balance, balance_owed, target_amount",
      )
      .eq("budget_id", budgetId)
      .eq("is_deleted", false)
      .order("created_at")
      .then(({ data }) => setAccounts((data as AccountRow[]) ?? []));
  }, [budgetId]);

  const selectedPeriodId = periods[periodIndex]?.id ?? "";
  const selectedPeriod = periods[periodIndex];

  // AC1: period-scoped +/- totals — one query for the whole Budget, aggregated
  // client-side by account_id/direction (no fan-out, no per-account query).
  useEffect(() => {
    if (!budgetId || !selectedPeriod) {
      setAcctTotals({});
      return;
    }
    const supabase = createClient();
    supabase
      .from("transaction")
      .select("account_id, direction, amount")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false)
      .gte("date", selectedPeriod.period_start)
      .lte("date", selectedPeriod.period_end)
      .then(({ data }) => {
        const totals: AcctTotals = {};
        for (const row of data ?? []) {
          const t = (totals[row.account_id] ??= { income: 0, expense: 0 });
          if (row.direction === "income") t.income += Number(row.amount);
          else t.expense += Number(row.amount);
        }
        setAcctTotals(totals);
      });
  }, [budgetId, selectedPeriod?.period_start, selectedPeriod?.period_end]);

  const loadStates = useCallback(async () => {
    if (!selectedPeriodId) {
      setStates([]);
      return;
    }
    const supabase = createClient();
    const { data, error: stateError } = await supabase
      .from("v_category_period_state")
      .select("*")
      .eq("budget_period_id", selectedPeriodId)
      .order("category_name");
    if (stateError) {
      setError("We couldn't load your dashboard. Please try again.");
      return;
    }
    setError(null);
    setStates((data as CategoryState[]) ?? []);
  }, [selectedPeriodId]);

  useEffect(() => {
    loadStates();
  }, [loadStates]);

  const period = periods[periodIndex];

  // AC3/AC6: Budget-level pacing — sum the already-fetched, single-currency
  // Category rows through one grouping key (this Budget-period); no per-account
  // fan-out, no cross-currency blend.
  const budgetSummary = useMemo(() => {
    if (!period || states.length === 0) return null;
    const totalSpent = states.reduce((sum, s) => sum + s.spent, 0);
    const totalLimit = states.reduce((sum, s) => sum + s.limit_amount, 0);
    const ratio = pacingRatio(
      totalSpent,
      totalLimit,
      period.period_start,
      period.period_end,
    );
    return { totalSpent, totalLimit, band: pacingBand(ratio) };
  }, [period, states]);

  const money = (n: number) =>
    currency ? `${n.toFixed(2)} ${currency}` : n.toFixed(2);

  // Balance display (AC5): "$" only for USD, otherwise "<number> <CODE>".
  const acctMoney = (n: number, curr: string) =>
    curr === "USD" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${curr}`;

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "2rem 1rem 4rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        color: "var(--color-text)",
      }}
    >
      {/* ── top bar: pickers + secondary nav ─────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "center",
        }}
      >
        <select
          aria-label="Budget"
          value={budgetId}
          onChange={(event) => setBudgetId(event.target.value)}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: "var(--radius-input)",
            border: "1px solid var(--color-border)",
            background: "var(--color-card)",
            color: "var(--color-text)",
            fontFamily: "var(--font-work-sans), system-ui, sans-serif",
            fontWeight: 600,
            fontSize: "0.95rem",
          }}
        >
          {budgets.map((budget) => (
            <option key={budget.id} value={budget.id}>
              {budget.name}
            </option>
          ))}
        </select>

        {/* Story 7.1.G2 — the only route to a specific Budget's settings;
            shown once a Budget is selected. */}
        {budgetId && (
          <Link
            href={`/dashboard/budgets/${budgetId}`}
            style={{ fontSize: "0.9rem", color: "var(--color-primary-dark)" }}
          >
            Settings
          </Link>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-pill)",
            padding: "0.25rem 0.5rem",
          }}
        >
          <Button
            variant="secondary"
            onClick={() => setPeriodIndex((i) => i + 1)}
            disabled={periodIndex >= periods.length - 1}
            style={{ padding: "0.3rem 0.6rem", borderRadius: "var(--radius-pill)" }}
          >
            ← Older
          </Button>
          <span
            style={{
              minWidth: 170,
              textAlign: "center",
              fontSize: "0.85rem",
              color: "var(--color-text-muted)",
            }}
          >
            {period
              ? `${period.period_start} – ${period.period_end}`
              : "No periods yet"}
          </span>
          <Button
            variant="secondary"
            onClick={() => setPeriodIndex((i) => Math.max(0, i - 1))}
            disabled={periodIndex <= 0}
            style={{ padding: "0.3rem 0.6rem", borderRadius: "var(--radius-pill)" }}
          >
            Newer →
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--color-red)", margin: 0 }}>
          {error}
        </p>
      )}

      {/* ── hero pacing card ─────────────────────────────────────────── */}
      {budgetSummary && (
        <Card
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.25rem",
            flexWrap: "wrap",
          }}
        >
          <ProgressRing
            percent={
              budgetSummary.totalLimit === 0
                ? 0
                : Math.round(
                    (budgetSummary.totalSpent / budgetSummary.totalLimit) * 100,
                  )
            }
            color={
              budgetSummary.totalLimit === 0
                ? BAND_TOKEN.pending
                : BAND_TOKEN[budgetSummary.band]
            }
            label={
              budgetSummary.totalLimit === 0
                ? "—"
                : `${Math.round(
                    (budgetSummary.totalSpent / budgetSummary.totalLimit) * 100,
                  )}%`
            }
          />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--color-text-muted)",
                marginBottom: "0.15rem",
              }}
            >
              This period
            </div>
            <div
              style={{
                fontFamily: "var(--font-nunito), system-ui, sans-serif",
                fontWeight: 800,
                fontSize: "1.35rem",
              }}
            >
              {money(budgetSummary.totalSpent)}{" "}
              <span
                style={{ fontWeight: 500, fontSize: "1rem", color: "var(--color-text-muted)" }}
              >
                of {money(budgetSummary.totalLimit)}
              </span>
            </div>
            <div
              style={{
                display: "inline-block",
                marginTop: "0.4rem",
                padding: "0.1rem 0.55rem",
                borderRadius: "var(--radius-pill)",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--color-card)",
                background:
                  budgetSummary.totalLimit === 0
                    ? BAND_TOKEN.pending
                    : BAND_TOKEN[budgetSummary.band],
              }}
            >
              {budgetSummary.totalLimit === 0
                ? BAND_LABEL.pending
                : BAND_LABEL[budgetSummary.band]}
            </div>
          </div>
          <Button
            variant="primary"
            onClick={() => router.push("/dashboard/transactions/new")}
          >
            Add Transaction
          </Button>
        </Card>
      )}

      {/* ── Categories panel ─────────────────────────────────────────── */}
      <Card>
        <h2 style={panelHeading}>Categories this period</h2>
        {states.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
            No categories to show for this period yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {states.map((state) => {
              const empty = state.spent === 0 && state.limit_amount === 0;
              const band = period
                ? pacingBand(
                    pacingRatio(
                      state.spent,
                      state.limit_amount,
                      period.period_start,
                      period.period_end,
                    ),
                  )
                : "pending";
              const vis = categoryVisual(state.category_name);
              const barValue =
                state.limit_amount > 0
                  ? Math.min(100, (state.spent / state.limit_amount) * 100)
                  : 0;
              return (
                <div
                  key={state.category_id}
                  style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}
                >
                  <IconBadge background={vis.bg}>{vis.icon}</IconBadge>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                        marginBottom: "0.3rem",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{state.category_name}</span>
                      <span style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>
                        {empty ? "—" : money(state.spent)}
                        {" / "}
                        {state.limit_amount === 0 ? "No limit" : money(state.limit_amount)}
                      </span>
                    </div>
                    <ProgressBar value={barValue} color={BAND_TOKEN[band]} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Accounts panel ──────────────────────────────────────────── */}
      <Card>
        <h2 style={panelHeading}>Accounts</h2>
        {accounts.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
            No accounts in this budget yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
            {accounts.map((account) => {
              const t = acctTotals[account.id] ?? { income: 0, expense: 0 };
              const balance =
                account.type === "credit_card"
                  ? (account.balance_owed ?? 0)
                  : account.current_balance;
              const vis = accountVisual(account.type);
              const goalPct =
                account.type === "savings_goal"
                  ? account.target_amount
                    ? Math.min(
                        100,
                        (account.current_balance / account.target_amount) * 100,
                      )
                    : 0
                  : null;
              return (
                <div
                  key={account.id}
                  style={{ display: "flex", gap: "0.9rem", alignItems: "flex-start" }}
                >
                  <IconBadge background={vis.bg}>{vis.icon}</IconBadge>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                      }}
                    >
                      <Link
                        href={`/dashboard/accounts/${account.id}`}
                        style={{ fontWeight: 600, color: "var(--color-primary-dark)" }}
                      >
                        {account.name}
                      </Link>
                      <span style={{ fontWeight: 700, fontFamily: "var(--font-nunito), system-ui, sans-serif" }}>
                        {acctMoney(balance, account.currency)}
                        {account.type === "credit_card" ? " owed" : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "0.1rem" }}>
                      <span style={{ color: "var(--color-green)" }}>+{t.income.toFixed(2)}</span>
                      {"  "}
                      <span style={{ color: "var(--color-red)" }}>−{t.expense.toFixed(2)}</span>
                    </div>
                    {goalPct !== null && (
                      <div style={{ marginTop: "0.5rem" }}>
                        <ProgressBar value={goalPct} color="var(--color-gold)" />
                        <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
                          {money(account.current_balance)} of{" "}
                          {money(account.target_amount ?? 0)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </main>
  );
}

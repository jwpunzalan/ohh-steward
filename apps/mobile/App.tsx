import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Button, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFonts } from "expo-font";
import {
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from "@expo-google-fonts/nunito";
import {
  WorkSans_400Regular,
  WorkSans_500Medium,
  WorkSans_600SemiBold,
} from "@expo-google-fonts/work-sans";
import { colors as themeColors } from "./theme";
import { supabase } from "./lib/supabase";
import {
  cacheSessionTimeoutMinutes,
  getCachedSessionTimeoutMinutes,
  saveSession,
  touchActivity,
} from "./lib/session";
import {
  checkIdleAndSignOutIfElapsed,
  guardIdleOrSignOut,
  resumeStoredSessionIfAllowed,
} from "./lib/sessionGate";
import type { Session } from "@supabase/supabase-js";

type Mode = "signup" | "signin";
type Screen =
  | "loading"
  | "auth"
  | "check-email"
  | "mfa-challenge"
  | "dashboard"
  | "create-budget"
  | "invite-send"
  | "accept-invite"
  | "account"
  | "security"
  | "create-account"
  | "create-transaction"
  | "transaction-list"
  | "account-detail";
type PeriodType = "monthly" | "biweekly";
type InviteRole = "parent" | "member";
type AccountType = "account" | "savings" | "savings_goal" | "credit_card";
type Direction = "expense" | "income";
type Budget = { id: string; name: string; default_currency: string | null };
type TxnAccount = { id: string; name: string };
type TxnCategory = { id: string; name: string };
type DashBudget = { id: string; name: string };
type DashPeriod = { id: string; period_start: string; period_end: string };
type CategoryState = {
  budget_period_id: string;
  budget_id: string;
  category_id: string;
  category_name: string;
  limit_amount: number;
  spent: number;
};
type SplitRow = { categoryId: string; amount: string };
type TxnListItem = {
  id: string;
  description: string;
  amount: number;
  date: string;
  direction: string;
  transaction_split: { id: string; category_id: string | null; amount: number }[];
};
type Band = "pending" | "green" | "amber" | "red";
type DashAccount = {
  id: string;
  type: string;
  name: string;
  currency: string;
  current_balance: number;
  balance_owed: number | null;
};
type DetailAccount = {
  id: string;
  budget_id: string;
  type: AccountType;
  name: string;
  currency: string;
  current_balance: number;
  balance_owed: number | null;
  target_amount: number | null;
  target_date: string | null;
  credit_limit: number | null;
  due_date: string | null;
  minimum_payment: number | null;
};
type DetailTxn = {
  id: string;
  description: string;
  amount: number;
  direction: string;
  date: string;
  store: string | null;
};

const DAY_MS = 86_400_000;

// Story 6.2 — pacing ratio = (% of budget spent) / (% of period elapsed).
// Elapsed time is clamped to [period_start, period_end], so an already-closed
// period reads as exactly 100% elapsed (ratio = spent/limit) and a not-yet-
// started one reads as 0% -> null -> 'pending' (AC5). Mirrors the DIP's SQL
// formula, day-based (budget_period columns are `date`; date-date is an
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

const BAND_COLOR: Record<Band, string> = {
  pending: "#6b7280", // neutral grey — never a "colour" signal (AC5)
  green: "#1a7f37",
  amber: "#9a6700",
  red: "#cf222e",
};

// After any successful full authentication (signup, password-only signin,
// or a signin's MFA challenge/verify step), persist the session for future
// biometric resume, cache the household's idle-timeout value for the next
// gate check (see lib/session.ts for why this must be cached rather than
// read live), and record this moment as the last activity.
async function completeAuthentication(session: Session): Promise<void> {
  await saveSession(session);
  await touchActivity();

  const { data: member } = await supabase
    .from("household_member")
    .select("household_id")
    .eq("auth_user_id", session.user.id)
    .eq("is_deleted", false)
    .single();

  if (member) {
    const { data: household } = await supabase
      .from("household")
      .select("session_timeout_minutes")
      .eq("id", member.household_id)
      .single();
    if (household) {
      await cacheSessionTimeoutMinutes(household.session_timeout_minutes);
    }
  }
}

export default function App() {
  // Story 10.1: load the design-system typefaces before rendering. Sub-second
  // asset load on app start; render a bare warm-cream View until it resolves
  // (avoids a flash of unstyled text). This is the ONLY change 10.1 makes to
  // this file — every screen below renders exactly as it does today.
  const [fontsLoaded] = useFonts({
    Nunito_700Bold,
    Nunito_800ExtraBold,
    WorkSans_400Regular,
    WorkSans_500Medium,
    WorkSans_600SemiBold,
  });

  const [screen, setScreen] = useState<Screen>("loading");
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetName, setBudgetName] = useState("");
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [inviteSent, setInviteSent] = useState(false);
  const [acceptToken, setAcceptToken] = useState("");
  const [acceptEmail, setAcceptEmail] = useState("");
  const [acceptPassword, setAcceptPassword] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaChallengeId, setMfaChallengeId] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [enrollFactorId, setEnrollFactorId] = useState("");
  const [enrollQrCode, setEnrollQrCode] = useState("");
  const [enrollSecret, setEnrollSecret] = useState("");
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollDone, setEnrollDone] = useState(false);
  const [accountBudgets, setAccountBudgets] = useState<Budget[]>([]);
  const [accountBudgetId, setAccountBudgetId] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("account");
  const [accountName, setAccountName] = useState("");
  const [accountCurrency, setAccountCurrency] = useState("USD");
  const [accountCurrencyTouched, setAccountCurrencyTouched] = useState(false);
  const [accountOpeningBalance, setAccountOpeningBalance] = useState("0");
  const [accountTargetAmount, setAccountTargetAmount] = useState("");
  const [accountCreditLimit, setAccountCreditLimit] = useState("");
  const [txnAccounts, setTxnAccounts] = useState<TxnAccount[]>([]);
  const [txnCategories, setTxnCategories] = useState<TxnCategory[]>([]);
  const [txnAccountId, setTxnAccountId] = useState("");
  const [txnDescription, setTxnDescription] = useState("");
  const [txnAmount, setTxnAmount] = useState("");
  // AC3: direction defaults to expense ("buying") unless the user changes it.
  const [txnDirection, setTxnDirection] = useState<Direction>("expense");
  const [txnDate, setTxnDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [txnTime, setTxnTime] = useState("");
  const [txnStore, setTxnStore] = useState("");
  const [txnCategoryId, setTxnCategoryId] = useState("");
  // AC1: split mode lets the user enter multiple category/amount pairs.
  const [txnSplitMode, setTxnSplitMode] = useState(false);
  const [txnSplits, setTxnSplits] = useState<SplitRow[]>([
    { categoryId: "", amount: "" },
    { categoryId: "", amount: "" },
  ]);
  const [txnListItems, setTxnListItems] = useState<TxnListItem[]>([]);
  const [txnEditingId, setTxnEditingId] = useState<string | null>(null);
  const [txnEditRows, setTxnEditRows] = useState<SplitRow[]>([]);
  const [txnEditAmount, setTxnEditAmount] = useState(0);
  // Story 6.1 dashboard: Budget picker, Period picker (index over an ordered
  // array, no query per navigation click), and the Category-state list.
  const [dashBudgets, setDashBudgets] = useState<DashBudget[]>([]);
  const [dashBudgetId, setDashBudgetId] = useState("");
  const [dashPeriods, setDashPeriods] = useState<DashPeriod[]>([]);
  const [dashPeriodIndex, setDashPeriodIndex] = useState(0);
  const [dashStates, setDashStates] = useState<CategoryState[]>([]);
  // Story 6.2: the Budget's currency label, derived server-side from its own
  // Accounts (AC4/AC6) — single-currency per Story 2.4.G2.
  const [dashCurrency, setDashCurrency] = useState<string | null>(null);
  // Story 6.3: Accounts/Cards/Savings summary + per-account detail view.
  const [dashAccounts, setDashAccounts] = useState<DashAccount[]>([]);
  const [dashAcctTotals, setDashAcctTotals] = useState<
    Record<string, { income: number; expense: number }>
  >({});
  const [detailAccount, setDetailAccount] = useState<DetailAccount | null>(null);
  const [detailTxns, setDetailTxns] = useState<DetailTxn[]>([]);
  const [editName, setEditName] = useState("");
  const [editTargetAmount, setEditTargetAmount] = useState("");
  const [editTargetDate, setEditTargetDate] = useState("");
  const [editCreditLimit, setEditCreditLimit] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editMinPayment, setEditMinPayment] = useState("");

  // Cold start: the in-memory Supabase client has no session yet
  // (persistSession is false — see lib/supabase.ts). Run the idle-timer +
  // biometric gate (AC5) before ever deciding whether to resume one.
  useEffect(() => {
    (async () => {
      const timeoutMinutes = await getCachedSessionTimeoutMinutes();
      const result = await resumeStoredSessionIfAllowed(timeoutMinutes);
      setScreen(result === "resumed" ? "dashboard" : "auth");
    })();
  }, []);

  // App was only backgrounded (still has a live in-memory session) — only
  // the idle check applies here, never the biometric gate (see
  // checkIdleAndSignOutIfElapsed's own comment).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (next) => {
      if (next === "active") {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          const timeoutMinutes = await getCachedSessionTimeoutMinutes();
          const result = await checkIdleAndSignOutIfElapsed(timeoutMinutes);
          if (result === "signed-out") {
            setScreen("auth");
          } else {
            await touchActivity();
          }
        }
      } else {
        await touchActivity();
      }
    });
    return () => subscription.remove();
  }, []);

  // Story 6.1: load the dashboard's Budget picker whenever the dashboard is
  // shown; then its Period picker for the selected Budget; then the
  // Category-state list for the selected Period.
  useEffect(() => {
    if (screen === "dashboard") loadDashboardBudgets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  useEffect(() => {
    if (dashBudgetId) loadDashboardPeriods(dashBudgetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashBudgetId]);

  useEffect(() => {
    loadCategoryStates(dashPeriods[dashPeriodIndex]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashPeriods, dashPeriodIndex]);

  // Story 6.3: accounts summary + period-scoped totals for the selected Budget.
  useEffect(() => {
    if (dashBudgetId) {
      loadAccountSummaries(dashBudgetId, dashPeriods[dashPeriodIndex]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashBudgetId, dashPeriods, dashPeriodIndex]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    try {
      if (mode === "signup") {
        // Household bootstrap happens server-side via a database trigger on
        // auth.users (Story 1.1.G2) — unconditionally, at account-creation
        // time, regardless of whether email confirmation is required. No
        // client-side bootstrap call exists: under mandatory email
        // confirmation (this project's actual configuration), signUp()
        // returns session: null until the user confirms, so any call
        // requiring an authenticated session would run as anon and fail.
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) {
          // Never surface raw Supabase/Postgres error text (Secure Coding
          // obligation 10) — e.g. Supabase Auth's native duplicate-email error.
          setError("We couldn't create your account. Please try again.");
          setSubmitting(false);
          return;
        }

        // Mandatory email confirmation (this project's actual configuration)
        // means signUp() returns session: null until the user confirms — not
        // an error. completeAuthentication() (session caching, biometric
        // storage) only makes sense once a session actually exists, so it
        // must never run on this branch.
        if (!data.session) {
          setSubmitting(false);
          setScreen("check-email");
          return;
        }

        await completeAuthentication(data.session);
      } else {
        // AC1: any device with no valid stored session always goes through
        // the full flow — password, then MFA challenge if the user has 2FA
        // enrolled — never a shortcut.
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError || !data.session) {
          setError("Invalid email or password.");
          setSubmitting(false);
          return;
        }

        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
          const { data: factors, error: factorsError } =
            await supabase.auth.mfa.listFactors();
          const factor = factors?.totp?.[0];
          if (factorsError || !factor) {
            setError("We couldn't complete sign-in. Please try again.");
            setSubmitting(false);
            return;
          }
          const { data: challenge, error: challengeError } =
            await supabase.auth.mfa.challenge({ factorId: factor.id });
          if (challengeError || !challenge) {
            setError("We couldn't complete sign-in. Please try again.");
            setSubmitting(false);
            return;
          }
          setMfaFactorId(factor.id);
          setMfaChallengeId(challenge.id);
          setSubmitting(false);
          setScreen("mfa-challenge");
          return;
        }

        await completeAuthentication(data.session);
      }

      setSubmitting(false);
      setScreen("dashboard");
    } catch {
      // STEW-36: a thrown exception (not a normal { error } result) must never
      // leave the form permanently stuck submitting. Generic message only
      // (obligation 10) — no "page reload" wording; this is a native app.
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleVerifyMfa() {
    setSubmitting(true);
    setError(null);

    try {
      const { data, error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: mfaCode,
      });

      if (verifyError || !data) {
        setError("Invalid code. Please try again.");
        setSubmitting(false);
        return;
      }

      // mfa.verify() returns the new session as flat fields, not a nested
      // `session` object — structurally the same shape completeAuthentication
      // needs (access_token/refresh_token/user), just reassembled here.
      await completeAuthentication({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
        user: data.user,
      } as Session);
      setMfaCode("");
      setSubmitting(false);
      setScreen("dashboard");
    } catch {
      // STEW-36: see handleSubmit — a thrown exception must not strand the form.
      setError("We couldn't verify that code. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleStartEnrollment() {
    setSubmitting(true);
    setError(null);
    setEnrollDone(false);

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
    });

    if (enrollError || !data) {
      setError("We couldn't start 2FA enrollment. Please try again.");
      setSubmitting(false);
      return;
    }

    setEnrollFactorId(data.id);
    setEnrollQrCode(data.totp.qr_code);
    setEnrollSecret(data.totp.secret);
    setSubmitting(false);
  }

  async function handleConfirmEnrollment() {
    setSubmitting(true);
    setError(null);

    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId: enrollFactorId });
    if (challengeError || !challenge) {
      setError("We couldn't confirm 2FA enrollment. Please try again.");
      setSubmitting(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrollFactorId,
      challengeId: challenge.id,
      code: enrollCode,
    });

    if (verifyError) {
      setError("Invalid code. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setEnrollDone(true);
    setEnrollCode("");
    setEnrollQrCode("");
    setEnrollSecret("");
    setEnrollFactorId("");
  }

  async function handleCreateBudget() {
    setSubmitting(true);
    setError(null);
    // STEW-37: enforce the idle timeout before any network call — not only at
    // cold start / app-resume. On elapsed: local-scope sign-out, back to auth.
    const timeoutMinutes = await getCachedSessionTimeoutMinutes();
    if (!(await guardIdleOrSignOut(timeoutMinutes))) {
      setSubmitting(false);
      setScreen("auth");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in to create a budget.");
      setSubmitting(false);
      return;
    }

    const { data: member, error: memberError } = await supabase
      .from("household_member")
      .select("id")
      .eq("auth_user_id", user.id)
      .eq("is_deleted", false)
      .single();

    if (memberError || !member) {
      setError("We couldn't find your household. Please try again.");
      setSubmitting(false);
      return;
    }

    // Assigns the new Budget to the creator only. Picking additional
    // co-owners requires a household member list, which doesn't exist yet
    // (Story 1.2's invite flow) — see this story's PR description.
    const { error: createError } = await supabase.rpc("rpc_create_budget", {
      p_name: budgetName,
      p_period_type: periodType,
      p_owner_member_ids: [member.id],
    });

    if (createError) {
      // Never surface raw Supabase/Postgres error text (Secure Coding
      // obligation 10) — e.g. the household budget cap being reached.
      setError("We couldn't create that budget. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setBudgetName("");
    setScreen("dashboard");
  }

  async function loadAccountBudgets() {
    const { data } = await supabase
      .from("budget")
      .select("id, name, default_currency");
    if (data) {
      setAccountBudgets(data);
      if (data[0]) {
        setAccountBudgetId(data[0].id);
        if (!accountCurrencyTouched) {
          setAccountCurrency(data[0].default_currency ?? "USD");
        }
      }
    }
  }

  // Story 6.1 dashboard reads. Pure reads: no guardIdleOrSignOut (idle
  // enforcement on read paths is handled by checkIdleAndSignOutIfElapsed on
  // resume) — matches loadAccountBudgets / loadTransactionList exactly.
  async function loadDashboardBudgets() {
    const { data, error: budgetError } = await supabase
      .from("budget")
      .select("id, name")
      .eq("is_deleted", false)
      .order("name");
    if (budgetError) {
      setError("We couldn't load your dashboard. Please try again.");
      return;
    }
    if (data) {
      setDashBudgets(data);
      if (data[0] && !data.some((b) => b.id === dashBudgetId)) {
        setDashBudgetId(data[0].id);
      }
    }
  }

  async function loadDashboardPeriods(budgetId: string) {
    setDashPeriodIndex(0);
    setDashCurrency(null);
    const { data, error: periodError } = await supabase
      .from("budget_period")
      .select("id, period_start, period_end")
      .eq("budget_id", budgetId)
      .order("period_start", { ascending: false });
    if (periodError) {
      setError("We couldn't load your dashboard. Please try again.");
      return;
    }
    setDashPeriods(data ?? []);

    // Story 6.2 AC4/AC6: currency label derived server-side from the Budget's
    // own (single-currency, per 2.4.G2) Accounts — never client-supplied.
    const { data: acct } = await supabase
      .from("account")
      .select("currency")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false)
      .order("created_at")
      .limit(1);
    setDashCurrency(acct?.[0]?.currency ?? null);
  }

  async function loadCategoryStates(periodId: string) {
    if (!periodId) {
      setDashStates([]);
      return;
    }
    const { data, error: stateError } = await supabase
      .from("v_category_period_state")
      .select("*")
      .eq("budget_period_id", periodId)
      .order("category_name");
    if (stateError) {
      setError("We couldn't load your dashboard. Please try again.");
      return;
    }
    setError(null);
    setDashStates((data as CategoryState[]) ?? []);
  }

  // Story 6.3 AC1: one accounts query + one period-scoped transaction query
  // for the whole Budget (no per-account loop). Pure reads — no
  // guardIdleOrSignOut (same convention as loadDashboard* / loadCategoryStates).
  async function loadAccountSummaries(budgetId: string, period?: DashPeriod) {
    const { data: acctData } = await supabase
      .from("account")
      .select("id, type, name, currency, current_balance, balance_owed")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false)
      .order("created_at");
    setDashAccounts((acctData as DashAccount[]) ?? []);

    if (!period) {
      setDashAcctTotals({});
      return;
    }
    const { data: txnData } = await supabase
      .from("transaction")
      .select("account_id, direction, amount")
      .eq("budget_id", budgetId)
      .eq("is_deleted", false)
      .gte("date", period.period_start)
      .lte("date", period.period_end);
    const totals: Record<string, { income: number; expense: number }> = {};
    for (const row of txnData ?? []) {
      const t = (totals[row.account_id] ??= { income: 0, expense: 0 });
      if (row.direction === "income") t.income += Number(row.amount);
      else t.expense += Number(row.amount);
    }
    setDashAcctTotals(totals);
  }

  async function loadAccountDetail(accountId: string) {
    const { data: acct, error: acctErr } = await supabase
      .from("account")
      .select(
        "id, budget_id, type, name, currency, current_balance, balance_owed, target_amount, target_date, credit_limit, due_date, minimum_payment",
      )
      .eq("id", accountId)
      .eq("is_deleted", false)
      .single();
    if (acctErr || !acct) {
      setError("We couldn't load that account.");
      return;
    }
    const a = acct as DetailAccount;
    setDetailAccount(a);
    setEditName(a.name);
    setEditTargetAmount(a.target_amount != null ? String(a.target_amount) : "");
    setEditTargetDate(a.target_date ?? "");
    setEditCreditLimit(a.credit_limit != null ? String(a.credit_limit) : "");
    setEditDueDate(a.due_date ?? "");
    setEditMinPayment(
      a.minimum_payment != null ? String(a.minimum_payment) : "",
    );

    const { data: history } = await supabase
      .from("transaction")
      .select("id, description, amount, direction, date, store")
      .eq("account_id", accountId)
      .eq("is_deleted", false)
      .order("date", { ascending: false })
      .limit(25);
    setDetailTxns((history as DetailTxn[]) ?? []);
  }

  async function handleUpdateAccount() {
    if (!detailAccount) return;
    setSubmitting(true);
    setError(null);
    // STEW-37: enforce the idle timeout before any network call (write path).
    const timeoutMinutes = await getCachedSessionTimeoutMinutes();
    if (!(await guardIdleOrSignOut(timeoutMinutes))) {
      setSubmitting(false);
      setScreen("auth");
      return;
    }

    const isGoal = detailAccount.type === "savings_goal";
    const isCard = detailAccount.type === "credit_card";
    // rpc_update_account never accepts type/currency/budget_id/balance fields;
    // type-inappropriate fields go as null and the RPC re-validates server-side.
    const { error: rpcError } = await supabase.rpc("rpc_update_account", {
      p_account_id: detailAccount.id,
      p_name: editName,
      p_target_amount:
        isGoal && editTargetAmount ? Number(editTargetAmount) : null,
      p_target_date: isGoal && editTargetDate ? editTargetDate : null,
      p_credit_limit:
        isCard && editCreditLimit ? Number(editCreditLimit) : null,
      p_due_date: isCard && editDueDate ? editDueDate : null,
      p_minimum_payment:
        isCard && editMinPayment ? Number(editMinPayment) : null,
    });

    if (rpcError) {
      // Generic message only (obligation 10) — "account not found" and "not
      // authorized" are intentionally indistinguishable to the caller.
      setError("We couldn't save those changes. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    await loadAccountDetail(detailAccount.id);
  }

  async function handleCreateAccount() {
    setSubmitting(true);
    setError(null);
    // STEW-37: enforce the idle timeout before any network call.
    const timeoutMinutes = await getCachedSessionTimeoutMinutes();
    if (!(await guardIdleOrSignOut(timeoutMinutes))) {
      setSubmitting(false);
      setScreen("auth");
      return;
    }

    const { error: createError } = await supabase.rpc("rpc_create_account", {
      p_budget_id: accountBudgetId,
      p_type: accountType,
      p_name: accountName,
      p_currency: accountCurrency,
      p_opening_balance: Number(accountOpeningBalance) || 0,
      p_target_amount:
        accountType === "savings_goal" && accountTargetAmount
          ? Number(accountTargetAmount)
          : null,
      p_credit_limit:
        accountType === "credit_card" && accountCreditLimit
          ? Number(accountCreditLimit)
          : null,
    });

    if (createError) {
      // Never surface raw Supabase/Postgres error text (Secure Coding
      // obligation 10) — e.g. "not authorized for this budget" or a
      // type/field-mismatch rejection.
      setError("We couldn't create that account. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setAccountName("");
    setScreen("dashboard");
  }

  async function loadTransactionData() {
    // Both queries are RLS-scoped: accounts to Budgets the caller can access,
    // categories to the caller's household. rpc_create_transaction re-checks
    // both server-side regardless of what the client submits.
    const { data: accountData } = await supabase
      .from("account")
      .select("id, name")
      .eq("is_deleted", false);
    if (accountData) {
      setTxnAccounts(accountData);
      if (accountData[0]) setTxnAccountId(accountData[0].id);
    }
    const { data: categoryData } = await supabase
      .from("category")
      .select("id, name")
      .eq("is_deleted", false);
    if (categoryData) setTxnCategories(categoryData);
  }

  function splitsTotal(rows: SplitRow[]) {
    return rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  }

  async function handleCreateTransaction() {
    setError(null);

    if (
      txnSplitMode &&
      Math.abs(splitsTotal(txnSplits) - Number(txnAmount)) > 1e-9
    ) {
      // Client-side feedback only — the RPC + deferred constraint trigger are
      // the authoritative check (AC2/AC5).
      setError("Split amounts must add up to the transaction amount.");
      return;
    }

    setSubmitting(true);
    // STEW-37: enforce the idle timeout before any network call.
    const timeoutMinutes = await getCachedSessionTimeoutMinutes();
    if (!(await guardIdleOrSignOut(timeoutMinutes))) {
      setSubmitting(false);
      setScreen("auth");
      return;
    }

    // p_budget_id is intentionally never sent — the RPC derives it from the
    // referenced account server-side (AC5). In split mode p_category_id is
    // omitted and p_splits carries the category/amount pairs.
    const { error: createError } = await supabase.rpc("rpc_create_transaction", {
      p_account_id: txnAccountId,
      p_description: txnDescription,
      p_amount: Number(txnAmount),
      p_date: txnDate,
      p_direction: txnDirection,
      p_time: txnTime || null,
      p_store: txnStore || null,
      p_category_id: txnSplitMode ? null : txnCategoryId || null,
      p_splits: txnSplitMode
        ? txnSplits.map((row) => ({
            category_id: row.categoryId || null,
            amount: Number(row.amount),
          }))
        : null,
    });

    if (createError) {
      // Never surface raw Supabase/Postgres error text (Secure Coding
      // obligation 10) — e.g. "not authorized for this budget" or a
      // sum-validation rejection.
      setError("We couldn't save that transaction. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setTxnDescription("");
    setTxnAmount("");
    setTxnDirection("expense");
    setTxnTime("");
    setTxnStore("");
    setTxnCategoryId("");
    setTxnSplitMode(false);
    setTxnSplits([
      { categoryId: "", amount: "" },
      { categoryId: "", amount: "" },
    ]);
    setScreen("dashboard");
  }

  async function loadTransactionList() {
    const { data: categoryData } = await supabase
      .from("category")
      .select("id, name")
      .eq("is_deleted", false);
    if (categoryData) setTxnCategories(categoryData);

    const { data } = await supabase
      .from("transaction")
      .select(
        "id, description, amount, date, direction, transaction_split(id, category_id, amount)",
      )
      .eq("is_deleted", false)
      .order("date", { ascending: false })
      .limit(25);
    if (data) setTxnListItems(data as unknown as TxnListItem[]);
    setTxnEditingId(null);
  }

  async function handleSetSplits(transactionId: string) {
    setError(null);
    if (Math.abs(splitsTotal(txnEditRows) - txnEditAmount) > 1e-9) {
      setError("Split amounts must add up to the transaction amount.");
      return;
    }

    setSubmitting(true);
    // STEW-37: enforce the idle timeout before any network call.
    const timeoutMinutes = await getCachedSessionTimeoutMinutes();
    if (!(await guardIdleOrSignOut(timeoutMinutes))) {
      setSubmitting(false);
      setScreen("auth");
      return;
    }

    // p_amount is never sent — rpc_set_transaction_splits reads the
    // transaction's own amount server-side (AC3/AC5).
    const { error: rpcError } = await supabase.rpc("rpc_set_transaction_splits", {
      p_transaction_id: transactionId,
      p_splits: txnEditRows.map((row) => ({
        category_id: row.categoryId || null,
        amount: Number(row.amount),
      })),
    });

    if (rpcError) {
      setError("We couldn't update those splits. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    await loadTransactionList();
  }

  async function handleSendInvite() {
    setSubmitting(true);
    setError(null);
    setInviteSent(false);
    // STEW-37: enforce the idle timeout before any network call.
    const timeoutMinutes = await getCachedSessionTimeoutMinutes();
    if (!(await guardIdleOrSignOut(timeoutMinutes))) {
      setSubmitting(false);
      setScreen("auth");
      return;
    }

    const { error: inviteError } = await supabase.rpc("rpc_create_invite", {
      p_email: inviteEmail,
      p_role: inviteRole,
    });

    if (inviteError) {
      // Never surface raw Supabase/Postgres error text (Secure Coding
      // obligation 10) — e.g. "not authorized" or "member cap reached".
      setError("We couldn't send that invite. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setInviteSent(true);
    setInviteEmail("");
  }

  async function handleAcceptInvite() {
    setSubmitting(true);
    setError(null);

    const { data, error: invokeError } = await supabase.functions.invoke(
      "accept-invite",
      { body: { token: acceptToken, email: acceptEmail, password: acceptPassword } },
    );

    if (invokeError || !data?.session) {
      // Uniform generic message regardless of which internal condition
      // failed (AC6) — never surface raw error text (obligation 10).
      setError("This invite is invalid or has expired.");
      setSubmitting(false);
      return;
    }

    await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    await completeAuthentication(data.session);

    setSubmitting(false);
    setAcceptToken("");
    setAcceptEmail("");
    setAcceptPassword("");
    setScreen("dashboard");
  }

  async function handleDeleteAccount() {
    setSubmitting(true);
    setError(null);
    // STEW-37: enforce the idle timeout before any network call.
    const timeoutMinutes = await getCachedSessionTimeoutMinutes();
    if (!(await guardIdleOrSignOut(timeoutMinutes))) {
      setSubmitting(false);
      setScreen("auth");
      return;
    }

    const { error: invokeError } = await supabase.functions.invoke(
      "delete-own-account",
      { method: "POST" },
    );

    if (invokeError) {
      // The RPC's own exception messages are fixed, non-interpolated
      // strings safe to show verbatim (Secure Coding obligation 10 — see
      // this story's Application to this story section) — e.g. the
      // last-Parent guidance message. A genuinely unexpected failure falls
      // back to a generic message instead.
      const context = (invokeError as { context?: Response }).context;
      const body = await context?.json?.().catch(() => null);
      setError(body?.error ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    await supabase.auth.signOut();
    setScreen("auth");
  }

  // Story 10.1: hold rendering on a bare warm-cream background until the
  // design-system fonts have loaded. (All hooks above run unconditionally.)
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: themeColors.bg }} />;
  }

  if (screen === "check-email") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Check your email</Text>
        <Text>
          We sent a confirmation link to {email}. Confirm your account, then
          come back and sign in.
        </Text>

        <Pressable
          onPress={() => {
            setError(null);
            setMode("signin");
            setScreen("auth");
          }}
        >
          <Text style={styles.link}>Back to sign in</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "loading") {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "security") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Security</Text>

        {enrollDone && <Text>Two-factor authentication is now enabled.</Text>}

        {!enrollQrCode && !enrollDone && (
          <Button
            title={submitting ? "Starting…" : "Enable 2FA"}
            onPress={handleStartEnrollment}
            disabled={submitting}
          />
        )}

        {enrollQrCode && (
          <>
            {/* mfa.enroll() also returns totp.qr_code as inline SVG markup,
                which React Native's Image component cannot render without an
                SVG-rendering dependency not named in this DIP (Obligation 11)
                — the manual-entry secret below is the standard, always-
                available alternative every authenticator app already
                supports, so it's used here as the primary path rather than
                adding a new dependency for the QR image alone. */}
            <Text>Enter this code in your authenticator app:</Text>
            <Text selectable style={styles.secret}>
              {enrollSecret}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              value={enrollCode}
              onChangeText={setEnrollCode}
              keyboardType="number-pad"
            />

            <Button
              title={submitting ? "Confirming…" : "Confirm"}
              onPress={handleConfirmEnrollment}
              disabled={submitting}
            />
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          onPress={() => {
            setError(null);
            setScreen("dashboard");
          }}
        >
          <Text style={styles.link}>Back to dashboard</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "account") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Account</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          title={submitting ? "Deleting…" : "Delete my account"}
          onPress={handleDeleteAccount}
          disabled={submitting}
        />

        <Pressable
          onPress={() => {
            setError(null);
            setScreen("dashboard");
          }}
        >
          <Text style={styles.link}>Back to dashboard</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "accept-invite") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Accept your invite</Text>
        <Text>Enter the details from your invite email.</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={acceptEmail}
          onChangeText={setAcceptEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Invite token"
          value={acceptToken}
          onChangeText={setAcceptToken}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Choose a password"
          value={acceptPassword}
          onChangeText={setAcceptPassword}
          secureTextEntry
          textContentType="newPassword"
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          title={submitting ? "Please wait…" : "Join household"}
          onPress={handleAcceptInvite}
          disabled={submitting}
        />

        <Pressable
          onPress={() => {
            setError(null);
            setScreen("auth");
          }}
        >
          <Text style={styles.link}>Cancel</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "invite-send") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Invite someone to your household</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Pressable
          onPress={() =>
            setInviteRole(inviteRole === "member" ? "parent" : "member")
          }
        >
          <Text style={styles.link}>Role: {inviteRole} (tap to change)</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}
        {inviteSent && <Text>Invite sent.</Text>}

        <Button
          title={submitting ? "Sending…" : "Send invite"}
          onPress={handleSendInvite}
          disabled={submitting}
        />

        <Pressable onPress={() => setScreen("dashboard")}>
          <Text style={styles.link}>Back to dashboard</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "create-account") {
    const accountTypes: AccountType[] = [
      "account",
      "savings",
      "savings_goal",
      "credit_card",
    ];
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Add an account</Text>

        <Pressable
          onPress={() => {
            const next =
              accountBudgets[
                (accountBudgets.findIndex((b) => b.id === accountBudgetId) + 1) %
                  accountBudgets.length
              ];
            if (next) {
              setAccountBudgetId(next.id);
              if (!accountCurrencyTouched) {
                setAccountCurrency(next.default_currency ?? "USD");
              }
            }
          }}
        >
          <Text style={styles.link}>
            Budget:{" "}
            {accountBudgets.find((b) => b.id === accountBudgetId)?.name ??
              "none"}{" "}
            (tap to change)
          </Text>
        </Pressable>

        <Pressable
          onPress={() =>
            setAccountType(
              accountTypes[
                (accountTypes.indexOf(accountType) + 1) % accountTypes.length
              ],
            )
          }
        >
          <Text style={styles.link}>Type: {accountType} (tap to change)</Text>
        </Pressable>

        <TextInput
          style={styles.input}
          placeholder="Name"
          value={accountName}
          onChangeText={setAccountName}
        />
        <TextInput
          style={styles.input}
          placeholder="Currency"
          value={accountCurrency}
          onChangeText={(text) => {
            setAccountCurrency(text.toUpperCase());
            setAccountCurrencyTouched(true);
          }}
          maxLength={3}
          autoCapitalize="characters"
        />
        <TextInput
          style={styles.input}
          placeholder={
            accountType === "credit_card"
              ? "Current balance owed"
              : "Opening balance"
          }
          value={accountOpeningBalance}
          onChangeText={setAccountOpeningBalance}
          keyboardType="numeric"
        />

        {accountType === "savings_goal" && (
          <TextInput
            style={styles.input}
            placeholder="Target amount"
            value={accountTargetAmount}
            onChangeText={setAccountTargetAmount}
            keyboardType="numeric"
          />
        )}

        {accountType === "credit_card" && (
          <TextInput
            style={styles.input}
            placeholder="Credit limit"
            value={accountCreditLimit}
            onChangeText={setAccountCreditLimit}
            keyboardType="numeric"
          />
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          title={submitting ? "Creating…" : "Create account"}
          onPress={handleCreateAccount}
          disabled={submitting || !accountBudgetId}
        />

        <Pressable onPress={() => setScreen("dashboard")}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "create-transaction") {
    const selectedCategory = txnCategories.find((c) => c.id === txnCategoryId);
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Add a transaction</Text>

        <Pressable
          onPress={() => {
            const next =
              txnAccounts[
                (txnAccounts.findIndex((a) => a.id === txnAccountId) + 1) %
                  txnAccounts.length
              ];
            if (next) setTxnAccountId(next.id);
          }}
        >
          <Text style={styles.link}>
            Account:{" "}
            {txnAccounts.find((a) => a.id === txnAccountId)?.name ?? "none"} (tap
            to change)
          </Text>
        </Pressable>

        <TextInput
          style={styles.input}
          placeholder="Description"
          value={txnDescription}
          onChangeText={setTxnDescription}
        />
        <TextInput
          style={styles.input}
          placeholder="Amount"
          value={txnAmount}
          onChangeText={setTxnAmount}
          keyboardType="numeric"
        />

        <Pressable
          onPress={() =>
            setTxnDirection(txnDirection === "expense" ? "income" : "expense")
          }
        >
          <Text style={styles.link}>
            Direction: {txnDirection} (tap to change)
          </Text>
        </Pressable>

        <TextInput
          style={styles.input}
          placeholder="Date (YYYY-MM-DD)"
          value={txnDate}
          onChangeText={setTxnDate}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Time (optional, HH:MM)"
          value={txnTime}
          onChangeText={setTxnTime}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Store / establishment (optional)"
          value={txnStore}
          onChangeText={setTxnStore}
        />

        <Pressable onPress={() => setTxnSplitMode(!txnSplitMode)}>
          <Text style={styles.link}>
            Split across multiple categories: {txnSplitMode ? "on" : "off"} (tap
            to toggle)
          </Text>
        </Pressable>

        {!txnSplitMode && (
          <Pressable
            onPress={() => {
              if (txnCategories.length === 0) return;
              const idx = txnCategories.findIndex((c) => c.id === txnCategoryId);
              // Cycle: Uncategorized -> cat[0] -> cat[1] -> ... -> Uncategorized.
              const next =
                idx === txnCategories.length - 1 ? null : txnCategories[idx + 1];
              setTxnCategoryId(next ? next.id : "");
            }}
          >
            <Text style={styles.link}>
              Category: {selectedCategory?.name ?? "Uncategorized"} (tap to
              change)
            </Text>
          </Pressable>
        )}

        {txnSplitMode && (
          <View style={{ width: "100%", gap: 8 }}>
            {txnSplits.map((row, index) => {
              const rowCat = txnCategories.find((c) => c.id === row.categoryId);
              return (
                <View key={index} style={{ gap: 4 }}>
                  <Pressable
                    onPress={() => {
                      const idx = txnCategories.findIndex(
                        (c) => c.id === row.categoryId,
                      );
                      const next =
                        idx === txnCategories.length - 1
                          ? null
                          : txnCategories[idx + 1];
                      setTxnSplits((rows) =>
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, categoryId: next ? next.id : "" }
                            : r,
                        ),
                      );
                    }}
                  >
                    <Text style={styles.link}>
                      Split {index + 1} category:{" "}
                      {rowCat?.name ?? "Uncategorized"} (tap to change)
                    </Text>
                  </Pressable>
                  <TextInput
                    style={styles.input}
                    placeholder={`Split ${index + 1} amount`}
                    value={row.amount}
                    onChangeText={(text) =>
                      setTxnSplits((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, amount: text } : r,
                        ),
                      )
                    }
                    keyboardType="numeric"
                  />
                  {txnSplits.length > 1 && (
                    <Pressable
                      onPress={() =>
                        setTxnSplits((rows) =>
                          rows.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Text style={styles.link}>Remove split {index + 1}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Pressable
              onPress={() =>
                setTxnSplits((rows) => [
                  ...rows,
                  { categoryId: "", amount: "" },
                ])
              }
            >
              <Text style={styles.link}>Add split</Text>
            </Pressable>
            <Text>
              Split total: {splitsTotal(txnSplits).toFixed(2)}
              {txnAmount !== "" && ` / ${Number(txnAmount).toFixed(2)}`}
            </Text>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          title={submitting ? "Saving…" : "Save transaction"}
          onPress={handleCreateTransaction}
          disabled={submitting || !txnAccountId}
        />

        <Pressable onPress={() => setScreen("dashboard")}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "transaction-list") {
    const categoryName = (id: string | null) =>
      id
        ? (txnCategories.find((c) => c.id === id)?.name ?? "—")
        : "Uncategorized";
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Transactions</Text>

        {txnListItems.length === 0 && <Text>No transactions yet.</Text>}

        {txnListItems.map((item) => (
          <View
            key={item.id}
            style={{
              width: "100%",
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 6,
              padding: 10,
              gap: 4,
            }}
          >
            <Text style={{ fontWeight: "600" }}>
              {item.description} — {item.direction === "income" ? "+" : "−"}
              {item.amount.toFixed(2)}
            </Text>
            <Text style={{ color: "#666", fontSize: 12 }}>{item.date}</Text>
            {item.transaction_split.map((split) => (
              <Text key={split.id}>
                {categoryName(split.category_id)}: {split.amount.toFixed(2)}
              </Text>
            ))}

            {txnEditingId === item.id ? (
              <View style={{ gap: 4 }}>
                {txnEditRows.map((row, index) => {
                  const rowCat = txnCategories.find(
                    (c) => c.id === row.categoryId,
                  );
                  return (
                    <View key={index} style={{ gap: 4 }}>
                      <Pressable
                        onPress={() => {
                          const idx = txnCategories.findIndex(
                            (c) => c.id === row.categoryId,
                          );
                          const next =
                            idx === txnCategories.length - 1
                              ? null
                              : txnCategories[idx + 1];
                          setTxnEditRows((rows) =>
                            rows.map((r, i) =>
                              i === index
                                ? { ...r, categoryId: next ? next.id : "" }
                                : r,
                            ),
                          );
                        }}
                      >
                        <Text style={styles.link}>
                          Split {index + 1}: {rowCat?.name ?? "Uncategorized"}{" "}
                          (tap to change)
                        </Text>
                      </Pressable>
                      <TextInput
                        style={styles.input}
                        placeholder={`Split ${index + 1} amount`}
                        value={row.amount}
                        onChangeText={(text) =>
                          setTxnEditRows((rows) =>
                            rows.map((r, i) =>
                              i === index ? { ...r, amount: text } : r,
                            ),
                          )
                        }
                        keyboardType="numeric"
                      />
                      {txnEditRows.length > 1 && (
                        <Pressable
                          onPress={() =>
                            setTxnEditRows((rows) =>
                              rows.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <Text style={styles.link}>Remove split {index + 1}</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
                <Pressable
                  onPress={() =>
                    setTxnEditRows((rows) => [
                      ...rows,
                      { categoryId: "", amount: "" },
                    ])
                  }
                >
                  <Text style={styles.link}>Add split</Text>
                </Pressable>
                <Text>
                  Split total: {splitsTotal(txnEditRows).toFixed(2)} /{" "}
                  {item.amount.toFixed(2)}
                </Text>
                <Button
                  title={submitting ? "Saving…" : "Save splits"}
                  onPress={() => handleSetSplits(item.id)}
                  disabled={submitting}
                />
                <Pressable onPress={() => setTxnEditingId(null)}>
                  <Text style={styles.link}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => {
                  setError(null);
                  setTxnEditingId(item.id);
                  setTxnEditAmount(item.amount);
                  setTxnEditRows(
                    item.transaction_split.map((split) => ({
                      categoryId: split.category_id ?? "",
                      amount: String(split.amount),
                    })),
                  );
                }}
              >
                <Text style={styles.link}>Split / edit categories</Text>
              </Pressable>
            )}
          </View>
        ))}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable onPress={() => setScreen("dashboard")}>
          <Text style={styles.link}>Back to dashboard</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "create-budget") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Create a budget</Text>

        <TextInput
          style={styles.input}
          placeholder="Name"
          value={budgetName}
          onChangeText={setBudgetName}
        />

        <Pressable
          onPress={() =>
            setPeriodType(periodType === "monthly" ? "biweekly" : "monthly")
          }
        >
          <Text style={styles.link}>Period: {periodType} (tap to change)</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          title={submitting ? "Creating…" : "Create budget"}
          onPress={handleCreateBudget}
          disabled={submitting}
        />

        <Pressable onPress={() => setScreen("dashboard")}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "dashboard") {
    const dashPeriod = dashPeriods[dashPeriodIndex];
    const money = (n: number) =>
      dashCurrency ? `${n.toFixed(2)} ${dashCurrency}` : n.toFixed(2);
    const bandBadge = (band: Band) => (
      <Text
        style={{
          color: "#fff",
          backgroundColor: BAND_COLOR[band],
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 1,
          fontSize: 12,
          overflow: "hidden",
          textTransform: "capitalize",
        }}
      >
        {band}
      </Text>
    );
    // AC3/AC6: Budget-level pacing — sum the already-fetched single-currency
    // Category rows through one grouping key; no per-account fan-out, no blend.
    const dashSummary =
      dashPeriod && dashStates.length > 0
        ? (() => {
            const totalSpent = dashStates.reduce((s, r) => s + r.spent, 0);
            const totalLimit = dashStates.reduce((s, r) => s + r.limit_amount, 0);
            return {
              totalSpent,
              totalLimit,
              band: pacingBand(
                pacingRatio(
                  totalSpent,
                  totalLimit,
                  dashPeriod.period_start,
                  dashPeriod.period_end,
                ),
              ),
            };
          })()
        : null;
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Dashboard</Text>

        {/* AC1/AC3: Budget picker — RLS returns all household Budgets for a
            Parent, only assigned Budgets for a Member; no client role logic. */}
        <Pressable
          onPress={() => {
            if (dashBudgets.length === 0) return;
            const idx = dashBudgets.findIndex((b) => b.id === dashBudgetId);
            const next = dashBudgets[(idx + 1) % dashBudgets.length];
            if (next) setDashBudgetId(next.id);
          }}
        >
          <Text style={styles.link}>
            Budget:{" "}
            {dashBudgets.find((b) => b.id === dashBudgetId)?.name ?? "none"} (tap
            to change)
          </Text>
        </Pressable>

        {/* AC1: Period picker with historical navigation — index moves over the
            already-loaded, newest-first array; no query per click. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            onPress={() =>
              setDashPeriodIndex((i) =>
                Math.min(i + 1, dashPeriods.length - 1),
              )
            }
          >
            <Text
              style={[
                styles.link,
                dashPeriodIndex >= dashPeriods.length - 1 && { opacity: 0.3 },
              ]}
            >
              ← Older
            </Text>
          </Pressable>
          <Text>
            {dashPeriod
              ? `${dashPeriod.period_start} – ${dashPeriod.period_end}`
              : "No periods yet"}
          </Text>
          <Pressable
            onPress={() => setDashPeriodIndex((i) => Math.max(i - 1, 0))}
          >
            <Text
              style={[styles.link, dashPeriodIndex <= 0 && { opacity: 0.3 }]}
            >
              Newer →
            </Text>
          </Pressable>
        </View>

        {/* Story 6.2: Budget-level pacing summary (AC3), currency-labelled (AC4). */}
        {dashSummary && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontWeight: "600" }}>This period:</Text>
            <Text>
              {money(dashSummary.totalSpent)} of {money(dashSummary.totalLimit)}
            </Text>
            {bandBadge(dashSummary.band)}
          </View>
        )}

        {/* Story 6.3 AC1: Accounts/Cards/Savings summary — current balance plus
            period-scoped +/- totals per record. Tap a row to open its detail. */}
        {dashAccounts.length > 0 && (
          <View style={{ width: "100%", gap: 4 }}>
            <Text style={{ fontWeight: "600" }}>Accounts</Text>
            {dashAccounts.map((acct) => {
              const t = dashAcctTotals[acct.id] ?? { income: 0, expense: 0 };
              const balance =
                acct.type === "credit_card"
                  ? (acct.balance_owed ?? 0)
                  : acct.current_balance;
              return (
                <Pressable
                  key={acct.id}
                  onPress={() => {
                    setError(null);
                    loadAccountDetail(acct.id);
                    setScreen("account-detail");
                  }}
                  style={{
                    borderBottomWidth: 1,
                    borderBottomColor: "#eee",
                    paddingVertical: 6,
                  }}
                >
                  <Text style={styles.link}>
                    {acct.name} ({acct.type === "credit_card" ? "card · owed" : acct.type})
                  </Text>
                  <Text>
                    {balance.toFixed(2)} {acct.currency} · +{t.income.toFixed(2)} / −
                    {t.expense.toFixed(2)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* AC2: Category-state list — the dominant element. AC4: a Category with
            no data shows "—" / "No limit", never an error. */}
        <View style={{ width: "100%", gap: 6 }}>
          {dashStates.length === 0 ? (
            <Text>No categories to show for this period yet.</Text>
          ) : (
            dashStates.map((state) => {
              const empty = state.spent === 0 && state.limit_amount === 0;
              const band = dashPeriod
                ? pacingBand(
                    pacingRatio(
                      state.spent,
                      state.limit_amount,
                      dashPeriod.period_start,
                      dashPeriod.period_end,
                    ),
                  )
                : "pending";
              return (
                <View
                  key={state.category_id}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottomWidth: 1,
                    borderBottomColor: "#eee",
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ fontWeight: "600" }}>
                    {state.category_name}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text>
                      {empty ? "—" : money(state.spent)} /{" "}
                      {state.limit_amount === 0 ? "No limit" : money(state.limit_amount)}
                    </Text>
                    {bandBadge(band)}
                  </View>
                </View>
              );
            })
          )}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {/* Relocated entry points — these screens have no other way in yet. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          <Pressable onPress={() => { setError(null); setScreen("create-budget"); }}>
            <Text style={styles.link}>New budget</Text>
          </Pressable>
          <Pressable onPress={async () => { setError(null); await loadAccountBudgets(); setScreen("create-account"); }}>
            <Text style={styles.link}>New account</Text>
          </Pressable>
          <Pressable onPress={async () => { setError(null); await loadTransactionData(); setScreen("create-transaction"); }}>
            <Text style={styles.link}>Add transaction</Text>
          </Pressable>
          <Pressable onPress={async () => { setError(null); await loadTransactionList(); setScreen("transaction-list"); }}>
            <Text style={styles.link}>Transactions</Text>
          </Pressable>
          <Pressable onPress={() => { setError(null); setInviteSent(false); setScreen("invite-send"); }}>
            <Text style={styles.link}>Invite</Text>
          </Pressable>
          <Pressable onPress={() => { setError(null); setScreen("account"); }}>
            <Text style={styles.link}>Account</Text>
          </Pressable>
          <Pressable onPress={() => { setError(null); setScreen("security"); }}>
            <Text style={styles.link}>Security</Text>
          </Pressable>
        </View>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "account-detail") {
    const a = detailAccount;
    const balance = a
      ? a.type === "credit_card"
        ? (a.balance_owed ?? 0)
        : a.current_balance
      : 0;
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{a ? a.name : "Account"}</Text>

        {a && (
          <Text style={{ color: "#666" }}>
            {a.type} · {balance.toFixed(2)} {a.currency}
            {a.type === "credit_card" ? " owed" : ""}
          </Text>
        )}

        {/* AC2: edit name and the type-specific fields — never type/currency/
            budget/balance (rpc_update_account has no parameters for those). */}
        <TextInput
          style={styles.input}
          placeholder="Name"
          value={editName}
          onChangeText={setEditName}
        />

        {a?.type === "savings_goal" && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Target amount"
              value={editTargetAmount}
              onChangeText={setEditTargetAmount}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="Target date (YYYY-MM-DD, optional)"
              value={editTargetDate}
              onChangeText={setEditTargetDate}
              autoCapitalize="none"
            />
          </>
        )}

        {a?.type === "credit_card" && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Credit limit"
              value={editCreditLimit}
              onChangeText={setEditCreditLimit}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="Due date (YYYY-MM-DD, optional)"
              value={editDueDate}
              onChangeText={setEditDueDate}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Minimum payment (optional)"
              value={editMinPayment}
              onChangeText={setEditMinPayment}
              keyboardType="numeric"
            />
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          title={submitting ? "Saving…" : "Save changes"}
          onPress={handleUpdateAccount}
          disabled={submitting || !a}
        />

        <Text style={{ fontWeight: "600", marginTop: 8 }}>Recent transactions</Text>
        {detailTxns.length === 0 ? (
          <Text>No transactions for this account yet.</Text>
        ) : (
          detailTxns.map((txn) => (
            <View
              key={txn.id}
              style={{
                width: "100%",
                borderBottomWidth: 1,
                borderBottomColor: "#eee",
                paddingVertical: 6,
              }}
            >
              <Text>
                {txn.description} — {txn.direction === "income" ? "+" : "−"}
                {txn.amount.toFixed(2)} {a?.currency ?? ""}
              </Text>
              <Text style={{ color: "#666", fontSize: 12 }}>
                {txn.date}
                {txn.store ? ` · ${txn.store}` : ""}
              </Text>
            </View>
          ))
        )}

        <Pressable
          onPress={() => {
            setError(null);
            setDetailAccount(null);
            setScreen("dashboard");
          }}
        >
          <Text style={styles.link}>Back to dashboard</Text>
        </Pressable>

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "mfa-challenge") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Enter your 2FA code</Text>

        <TextInput
          style={styles.input}
          placeholder="6-digit code"
          value={mfaCode}
          onChangeText={setMfaCode}
          keyboardType="number-pad"
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          title={submitting ? "Verifying…" : "Verify"}
          onPress={handleVerifyMfa}
          disabled={submitting}
        />

        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {mode === "signup" ? "Create your household" : "Sign in"}
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType={mode === "signup" ? "newPassword" : "password"}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Button
        title={
          submitting ? "Please wait…" : mode === "signup" ? "Sign up" : "Sign in"
        }
        onPress={handleSubmit}
        disabled={submitting}
      />

      <Pressable
        onPress={() => {
          setMode(mode === "signup" ? "signin" : "signup");
          setError(null);
        }}
      >
        <Text style={styles.link}>
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "Need an account? Sign up"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          setError(null);
          setScreen("accept-invite");
        }}
      >
        <Text style={styles.link}>Have an invite? Accept it here</Text>
      </Pressable>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 10,
  },
  error: {
    color: "crimson",
  },
  link: {
    marginTop: 12,
    textDecorationLine: "underline",
  },
  secret: {
    fontFamily: "monospace",
    fontSize: 12,
  },
});

import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Button, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "./lib/supabase";
import {
  cacheSessionTimeoutMinutes,
  getCachedSessionTimeoutMinutes,
  saveSession,
  touchActivity,
} from "./lib/session";
import {
  checkIdleAndSignOutIfElapsed,
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
  | "transaction-list";
type PeriodType = "monthly" | "biweekly";
type InviteRole = "parent" | "member";
type AccountType = "account" | "savings" | "savings_goal" | "credit_card";
type Direction = "expense" | "income";
type Budget = { id: string; name: string; default_currency: string | null };
type TxnAccount = { id: string; name: string };
type TxnCategory = { id: string; name: string };
type SplitRow = { categoryId: string; amount: string };
type TxnListItem = {
  id: string;
  description: string;
  amount: number;
  date: string;
  direction: string;
  transaction_split: { id: string; category_id: string | null; amount: number }[];
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

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

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
  }

  async function handleVerifyMfa() {
    setSubmitting(true);
    setError(null);

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
    await touchActivity();

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

  async function handleCreateAccount() {
    setSubmitting(true);
    setError(null);
    await touchActivity();

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
    await touchActivity();

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
    await touchActivity();

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
    await touchActivity();

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
    await touchActivity();

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
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Welcome to your household</Text>
        <Text>
          You don&apos;t have any budgets or categories yet. This is a
          placeholder — later stories will build the real dashboard here.
        </Text>
        <Button
          title="Create a budget"
          onPress={() => {
            setError(null);
            setScreen("create-budget");
          }}
        />
        <Button
          title="Add an account"
          onPress={async () => {
            setError(null);
            await loadAccountBudgets();
            setScreen("create-account");
          }}
        />
        <Button
          title="Add a transaction"
          onPress={async () => {
            setError(null);
            await loadTransactionData();
            setScreen("create-transaction");
          }}
        />
        <Button
          title="View transactions"
          onPress={async () => {
            setError(null);
            await loadTransactionList();
            setScreen("transaction-list");
          }}
        />
        <Button
          title="Invite someone to your household"
          onPress={() => {
            setError(null);
            setInviteSent(false);
            setScreen("invite-send");
          }}
        />
        <Button
          title="Account"
          onPress={() => {
            setError(null);
            setScreen("account");
          }}
        />
        <Button
          title="Security"
          onPress={() => {
            setError(null);
            setScreen("security");
          }}
        />
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

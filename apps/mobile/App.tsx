import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Button, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "./lib/supabase";

type Mode = "signup" | "signin";
type Screen =
  | "auth"
  | "dashboard"
  | "create-budget"
  | "invite-send"
  | "accept-invite"
  | "account";
type PeriodType = "monthly" | "biweekly";
type InviteRole = "parent" | "member";

export default function App() {
  const [screen, setScreen] = useState<Screen>("auth");
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

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
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

      const { error: bootstrapError } = await supabase.rpc(
        "rpc_bootstrap_household",
      );
      if (bootstrapError) {
        setError(
          "We couldn't finish setting up your household. Please try again.",
        );
        setSubmitting(false);
        return;
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError("Invalid email or password.");
        setSubmitting(false);
        return;
      }
    }

    setSubmitting(false);
    setScreen("dashboard");
  }

  async function handleCreateBudget() {
    setSubmitting(true);
    setError(null);

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

  async function handleSendInvite() {
    setSubmitting(true);
    setError(null);
    setInviteSent(false);

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

    setSubmitting(false);
    setAcceptToken("");
    setAcceptEmail("");
    setAcceptPassword("");
    setScreen("dashboard");
  }

  async function handleDeleteAccount() {
    setSubmitting(true);
    setError(null);

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
});

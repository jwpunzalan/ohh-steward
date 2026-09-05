import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Button, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "./lib/supabase";

type Mode = "signup" | "signin";
type Screen = "auth" | "dashboard" | "create-budget";
type PeriodType = "monthly" | "biweekly";

export default function App() {
  const [screen, setScreen] = useState<Screen>("auth");
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetName, setBudgetName] = useState("");
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");

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

import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Button, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "./lib/supabase";

type Mode = "signup" | "signin";
type Screen = "auth" | "dashboard";

export default function App() {
  const [screen, setScreen] = useState<Screen>("auth");
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (screen === "dashboard") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Welcome to your household</Text>
        <Text>
          You don&apos;t have any budgets or categories yet. This is a
          placeholder — later stories will build the real dashboard here.
        </Text>
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

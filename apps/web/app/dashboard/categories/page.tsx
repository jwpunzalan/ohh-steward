"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string };

// Story 7.1 — Parent-only Category management, wiring the already-shipped
// (Story 2.3), previously-unused rpc_upsert_category / rpc_delete_category to
// list/create/rename/delete UI. Plain form/list convention (no design-system
// primitives). Both RPCs authorize server-side against the category's own
// household — this screen adds no new authorization logic.
export default function CategoriesPage() {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("category")
      .select("id, name")
      .eq("is_deleted", false)
      .order("name");
    if (readError) {
      setError("We couldn't load your categories. Please try again.");
      return;
    }
    setCategories(data ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: member } = await supabase
        .from("household_member")
        .select("household_id")
        .eq("auth_user_id", user.id)
        .eq("is_deleted", false)
        .single();
      if (member) setHouseholdId(member.household_id);
      await loadCategories();
    })();
  }, [loadCategories]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!householdId) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("rpc_upsert_category", {
      p_household_id: householdId,
      p_name: newName,
      p_id: null,
    });
    setBusy(false);
    if (rpcError) {
      // Generic message only (obligation 10) — the RPC's own errors are
      // deliberately indistinguishable, don't surface them.
      setError("We couldn't add that category. Please try again.");
      return;
    }
    setNewName("");
    await loadCategories();
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!householdId || !editId) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("rpc_upsert_category", {
      p_household_id: householdId,
      p_name: editName,
      p_id: editId,
    });
    setBusy(false);
    if (rpcError) {
      setError("We couldn't rename that category. Please try again.");
      return;
    }
    setEditId(null);
    setEditName("");
    await loadCategories();
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("rpc_delete_category", {
      p_id: id,
    });
    setBusy(false);
    if (rpcError) {
      setError("We couldn't delete that category. Please try again.");
      return;
    }
    if (editId === id) setEditId(null);
    await loadCategories();
  }

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Categories</h1>

      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}

      <form
        onSubmit={handleCreate}
        style={{ display: "flex", gap: "0.5rem", margin: "1rem 0" }}
      >
        <label htmlFor="newName" style={{ position: "absolute", left: "-9999px" }}>
          New category name
        </label>
        <input
          id="newName"
          name="newName"
          type="text"
          placeholder="New category"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          required
        />
        <button type="submit" disabled={busy || !householdId}>
          Add
        </button>
      </form>

      {categories.length === 0 ? (
        <p>No categories yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {categories.map((category) => (
            <li key={category.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              {editId === category.id ? (
                <form onSubmit={handleRename} style={{ display: "flex", gap: "0.5rem", flex: 1 }}>
                  <label
                    htmlFor="editName"
                    style={{ position: "absolute", left: "-9999px" }}
                  >
                    Category name
                  </label>
                  <input
                    id="editName"
                    name="editName"
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    required
                    style={{ flex: 1 }}
                  />
                  <button type="submit" disabled={busy}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditId(null)} disabled={busy}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span style={{ flex: 1 }}>{category.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(category.id);
                      setEditName(category.name);
                    }}
                    disabled={busy}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(category.id)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

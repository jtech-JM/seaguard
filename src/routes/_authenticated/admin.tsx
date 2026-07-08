import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Shield, UserCog, Link2, X } from "lucide-react";
import type { AppRole } from "@/lib/use-role";
import { STAFF_ROLES } from "@/lib/use-role";
import { requireRole, type RouteContext } from "@/lib/route-guard";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: ({ context }) => requireRole(context as RouteContext, ["admin"]),
  head: () => ({
    meta: [
      { title: "Administrator — MarineRescue" },
      { name: "description", content: "User and role administration." },
    ],
  }),
  component: AdminDashboard,
});

// Exactly the 4 roles this platform supports
const ROLES: AppRole[] = ["admin", "bmu_officer", "rescue_officer", "fisherman"];

const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  bmu_officer: "BMU Officer",
  rescue_officer: "Rescue Officer",
  fisherman: "Fisherman",
};

interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  roles: AppRole[];
  fisherman_id: string | null;
}

interface FishermanOption {
  id: string;
  full_name: string | null;
  phone: string | null;
}

function AdminDashboard() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [linkUser, setLinkUser] = useState<UserRow | null>(null);

  async function load() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setMe(u.user.id);
    const { data: hasAdmin } = await supabase.rpc("has_role", {
      _user_id: u.user.id,
      _role: "admin",
    });
    setIsAdmin(!!hasAdmin);
    if (!hasAdmin) return;
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email, fisherman_id")
      .order("created_at", { ascending: false })
      .limit(200);
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    const rolesByUser = new Map<string, AppRole[]>();
    for (const r of roles ?? []) {
      const arr = rolesByUser.get(r.user_id as string) ?? [];
      arr.push(r.role as AppRole);
      rolesByUser.set(r.user_id as string, arr);
    }
    setUsers(
      (profs ?? []).map(
        (p: {
          id: string;
          full_name: string | null;
          email: string | null;
          fisherman_id: string | null;
        }) => ({
          ...p,
          roles: rolesByUser.get(p.id) ?? [],
        }),
      ),
    );
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleRole(userId: string, role: AppRole, has: boolean) {
    if (has) {
      await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    } else {
      await supabase.from("user_roles").insert({ user_id: userId, role });
    }
    load();
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen bg-ocean text-foam">
      <header className="flex items-center justify-between border-b border-foam/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-distress/20 ring-1 ring-distress/40">
            <Shield className="h-4 w-4 text-distress" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-foam/50">Administrator</div>
            <div className="text-sm font-semibold">User & Role Management</div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 rounded-lg border border-foam/15 px-3 py-1.5 text-xs hover:bg-foam/10"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {isAdmin === false ? (
          <div className="rounded-2xl border border-distress/40 bg-distress/10 p-6 text-sm">
            You don't have administrator access.
          </div>
        ) : isAdmin === null ? (
          <div className="text-sm text-foam/50">Loading…</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-foam/10">
            <div className="border-b border-foam/10 bg-foam/[0.03] px-5 py-3 text-sm font-semibold inline-flex items-center gap-2">
              <UserCog className="h-4 w-4 text-tide" /> {users.length} users
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-foam/[0.02] text-[10px] uppercase tracking-wider text-foam/50">
                <tr>
                  <th className="px-4 py-2">User</th>
                  {ROLES.map((r) => (
                    <th key={r} className="px-3 py-2 text-center">
                      {ROLE_LABEL[r]}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center">Fisherman</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foam/5">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-foam/[0.03]">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {u.full_name ?? "—"}
                        {u.id === me && <span className="ml-2 text-[10px] text-tide">(you)</span>}
                      </div>
                      <div className="text-[11px] text-foam/50">{u.email}</div>
                    </td>
                    {ROLES.map((r) => {
                      const has = u.roles.includes(r);
                      return (
                        <td key={r} className="px-3 py-3 text-center">
                          <button
                            onClick={() => toggleRole(u.id, r, has)}
                            className={`h-5 w-5 rounded border transition ${has ? "border-tide bg-tide" : "border-foam/20 bg-transparent hover:border-foam/40"}`}
                            aria-label={`Toggle ${r} for ${u.full_name}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-center">
                      <button
                        onClick={() => setLinkUser(u)}
                        className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] transition ${
                          u.fisherman_id
                            ? "border-tide/30 text-tide hover:bg-tide/10"
                            : "border-foam/15 text-foam/40 hover:border-foam/40 hover:text-foam"
                        }`}
                      >
                        <Link2 className="h-3 w-3" />
                        {u.fisherman_id ? "Linked" : "Link"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {linkUser && (
        <LinkFishermanModal
          user={linkUser}
          onClose={() => setLinkUser(null)}
          onSaved={() => {
            setLinkUser(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ── Link a user profile to a fisherman record ────────────────────
function LinkFishermanModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fishermen, setFishermen] = useState<FishermanOption[]>([]);
  const [selected, setSelected] = useState(user.fisherman_id ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("fishermen")
      .select("id, full_name, phone")
      .order("full_name")
      .then(({ data }) => {
        if (data) setFishermen(data as FishermanOption[]);
      });
  }, []);

  async function save() {
    setBusy(true);
    try {
      // Unlink any profile that currently holds this fisherman_id (avoid duplicates)
      if (selected) {
        await supabase
          .from("profiles")
          .update({ fisherman_id: null })
          .eq("fisherman_id", selected)
          .neq("id", user.id);
      }
      await supabase
        .from("profiles")
        .update({ fisherman_id: selected || null })
        .eq("id", user.id);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-foam/15 bg-ocean p-5 text-foam">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Link fisherman record</h3>
            <p className="text-xs text-foam/50 mt-0.5">{user.full_name ?? user.email}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-foam/60 hover:bg-foam/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-foam/50">
            Fisherman record
          </span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-1 w-full rounded-lg border border-foam/10 bg-foam/[0.04] px-3 py-2 text-sm text-foam outline-none focus:border-tide/60"
          >
            <option value="" className="bg-ocean">
              — Unlink —
            </option>
            {fishermen.map((f) => (
              <option key={f.id} value={f.id} className="bg-ocean">
                {f.full_name ?? "—"} {f.phone ? `(${f.phone})` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-foam/15 px-3 py-2 text-sm text-foam/80 hover:bg-foam/10"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-tide px-4 py-2 text-sm font-semibold text-ocean hover:bg-tide/90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

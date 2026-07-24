"use client";

/**
 * AZ ONE OFFICIAL — Admin (v0, modest)
 * Static-exported client app talking to the API Worker at /api/v1
 * (same origin via the azoneofficial.com/api/* route).
 */

import { useCallback, useEffect, useState } from "react";

const API = "/api/v1";

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface Enquiry {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  message: string;
  status: string;
  created_at: string;
}

interface CrudItem {
  id: number;
  [key: string]: unknown;
}

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
    const data = res.status === 204 ? null : ((await res.json()) as T);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const btnClass =
  "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50";
const btnGhost =
  "inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-secondary";

/* ---------------- Login ---------------- */

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("pending")) {
      setNotice("Your account is awaiting approval by an administrator.");
    } else if (q.get("error") === "oauth") {
      setError("Google sign-in didn't complete — please try again.");
    }
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    setNotice("");

    if (mode === "register") {
      const res = await api<{ pending?: boolean }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, name, password }),
      });
      setBusy(false);
      if (res.ok) {
        setMode("login");
        setPassword("");
        setNotice("Account created — you can sign in once an administrator approves it.");
      } else if (res.status === 409) {
        setError("An account with this email already exists.");
      } else if (res.status === 429) {
        setError("Too many registrations — try again later.");
      } else {
        setError("Check all fields — password needs 10+ characters.");
      }
      return;
    }

    const res = await api<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok && res.data) {
      onLogin(res.data.user);
    } else if (res.status === 429) {
      setError("Too many attempts — try again in 15 minutes.");
    } else if (res.status === 0) {
      setError("Can't reach the API. Is the Worker deployed on /api/*?");
    } else {
      setError("Email or password is incorrect — or the account is not yet approved.");
    }
  };

  return (
    <div className="mx-auto mt-24 w-full max-w-sm px-6">
      <p className="text-gold-deep mb-3 text-xs font-medium tracking-[0.3em] uppercase">
        Admin
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === "login" ? "Sign in" : "Create an account"}
      </h1>

      <a
        href={`${API}/auth/google`}
        className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border text-sm font-medium transition-colors hover:bg-secondary"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.2C12.3 13.6 17.7 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.4 6.9-17.7z"/>
          <path fill="#FBBC05" d="M10.4 28.7a14.6 14.6 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z"/>
          <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/>
        </svg>
        Continue with Google
      </a>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-muted-foreground text-xs">or with email</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-4">
        {mode === "register" && (
          <input
            className={inputClass}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        )}
        <input
          className={inputClass}
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
        <input
          className={inputClass}
          placeholder={mode === "register" ? "Password (10+ characters)" : "Password"}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        {notice && <p className="text-sm text-foreground">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="button"
          className={btnClass}
          disabled={
            busy || !email || !password || (mode === "register" && !name)
          }
          onClick={() => void submit()}
        >
          {busy
            ? "Please wait…"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>
        <button
          type="button"
          className="text-muted-foreground block text-sm underline"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
            setNotice("");
          }}
        >
          {mode === "login"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
        {mode === "register" && (
          <p className="text-muted-foreground text-xs">
            New accounts need approval by an administrator before first sign-in.
            Signing in with a Google {`@azoneofficial.com`} account is approved
            automatically.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------- Enquiries ---------------- */

const ENQUIRY_STATUSES = ["new", "contacted", "qualified", "closed"] as const;

function Enquiries() {
  const [items, setItems] = useState<Enquiry[]>([]);
  const load = useCallback(async () => {
    const res = await api<{ enquiries: Enquiry[] }>("/enquiries");
    if (res.ok && res.data) setItems(res.data.enquiries);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: number, status: string) => {
    await api(`/enquiries/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    void load();
  };

  if (items.length === 0)
    return <p className="text-muted-foreground text-sm">No enquiries yet.</p>;

  return (
    <div className="space-y-4">
      {items.map((e) => (
        <article key={e.id} className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {e.name}
              {e.company ? ` — ${e.company}` : ""}
            </p>
            <select
              className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
              value={e.status}
              onChange={(ev) => void setStatus(e.id, ev.target.value)}
            >
              {ENQUIRY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {e.email ?? "no email"} · {e.phone ?? "no phone"} · {e.created_at}
          </p>
          <p className="mt-2 text-sm">{e.message}</p>
        </article>
      ))}
    </div>
  );
}

/* ---------------- Generic CRUD panel ---------------- */

interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number" | "checkbox";
}

function CrudPanel({
  resource,
  fields,
  titleKey,
}: {
  resource: string;
  fields: FieldDef[];
  titleKey: string;
}) {
  const [items, setItems] = useState<CrudItem[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ items: CrudItem[] }>(`/${resource}`);
    if (res.ok && res.data) setItems(res.data.items);
  }, [resource]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setError("");
    const res = editingId
      ? await api(`/${resource}/${editingId}`, { method: "PUT", body: JSON.stringify(draft) })
      : await api(`/${resource}`, { method: "POST", body: JSON.stringify(draft) });
    if (!res.ok) {
      setError("Save failed — check required fields.");
      return;
    }
    setDraft({});
    setEditingId(null);
    void load();
  };

  const remove = async (id: number) => {
    await api(`/${resource}/${id}`, { method: "DELETE" });
    void load();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">
          {editingId ? `Edit #${editingId}` : "Add new"}
        </h3>
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {f.label}
            </span>
            {f.type === "textarea" ? (
              <textarea
                className={inputClass}
                rows={4}
                value={String(draft[f.key] ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            ) : f.type === "checkbox" ? (
              <input
                type="checkbox"
                checked={Boolean(draft[f.key])}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked ? 1 : 0 }))}
              />
            ) : (
              <input
                className={inputClass}
                type={f.type === "number" ? "number" : "text"}
                value={String(draft[f.key] ?? "")}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value,
                  }))
                }
              />
            )}
          </label>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className={btnClass} onClick={() => void save()}>
            {editingId ? "Save changes" : "Create"}
          </button>
          {editingId && (
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                setEditingId(null);
                setDraft({});
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight">Existing</h3>
        {items.length === 0 && (
          <p className="text-muted-foreground text-sm">Nothing here yet.</p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <span className="truncate text-sm">
              #{item.id} — {String(item[titleKey] ?? "(untitled)")}
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                className="text-xs underline"
                onClick={() => {
                  setEditingId(item.id);
                  const d: Record<string, unknown> = {};
                  for (const f of fields) d[f.key] = item[f.key] ?? "";
                  setDraft(d);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="text-destructive text-xs underline"
                onClick={() => void remove(item.id)}
              >
                Delete
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */

interface Activity {
  action: string;
  entity: string | null;
  entity_id: string | null;
  created_at: string;
  user_name: string | null;
}

function Dashboard() {
  const [summary, setSummary] = useState<{
    enquiries?: { total: number; new_count: number };
    products?: { total: number };
    posts?: { total: number };
    testimonials?: { total: number };
    activity?: Activity[];
  } | null>(null);
  useEffect(() => {
    void api<typeof summary>("/dashboard/summary").then((r) => {
      if (r.ok) setSummary(r.data);
    });
  }, []);
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Total enquiries", value: summary?.enquiries?.total },
          { label: "New enquiries", value: summary?.enquiries?.new_count },
          { label: "Products", value: summary?.products?.total },
          { label: "Posts", value: summary?.posts?.total },
          { label: "Testimonials", value: summary?.testimonials?.total },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border p-5">
            <p className="text-3xl font-semibold">{s.value ?? "—"}</p>
            <p className="text-muted-foreground mt-1 text-sm">{s.label}</p>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Recent activity</h3>
        <ul className="mt-3 space-y-1.5">
          {(summary?.activity ?? []).map((a, i) => (
            <li key={i} className="text-muted-foreground text-sm">
              <span className="text-foreground">{a.user_name ?? "system"}</span>{" "}
              — {a.action}
              {a.entity_id ? ` #${a.entity_id}` : ""} · {a.created_at}
            </li>
          ))}
          {(summary?.activity ?? []).length === 0 && (
            <li className="text-muted-foreground text-sm">No activity yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- Media ---------------- */

interface MediaItem {
  id: number;
  r2_key: string;
  kind: string;
  alt: string | null;
  created_at: string;
}

function MediaPanel() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ media: MediaItem[] }>("/media");
    if (res.ok && res.data) setItems(res.data.media);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const kind = file.type.startsWith("video") ? "video" : file.type.startsWith("image") ? "image" : "document";
      const res = await fetch(
        `${API}/media?filename=${encodeURIComponent(file.name)}&kind=${kind}`,
        { method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file },
      );
      if (!res.ok) setError("Upload failed.");
    } catch {
      setError("Upload failed — is the API reachable?");
    }
    setBusy(false);
    void load();
  };

  const remove = async (id: number) => {
    await api(`/media/${id}`, { method: "DELETE" });
    void load();
  };

  return (
    <div className="space-y-6">
      <label className="block">
        <span className="mb-2 block text-sm font-semibold">Upload file</span>
        <input
          type="file"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
          className="text-sm"
        />
      </label>
      {busy && <p className="text-muted-foreground text-sm">Uploading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((m) => (
          <div key={m.id} className="rounded-lg border border-border p-3">
            {m.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${API}/media/file/${encodeURIComponent(m.r2_key)}`}
                alt={m.alt ?? m.r2_key}
                className="h-32 w-full rounded-md object-cover"
                loading="lazy"
              />
            ) : (
              <p className="text-muted-foreground flex h-32 items-center justify-center text-xs">
                {m.kind}
              </p>
            )}
            <p className="mt-2 truncate text-xs">{m.r2_key}</p>
            <div className="mt-1 flex justify-between">
              <button
                type="button"
                className="text-xs underline"
                onClick={() => void navigator.clipboard.writeText(`${API}/media/file/${encodeURIComponent(m.r2_key)}`)}
              >
                Copy URL
              </button>
              <button
                type="button"
                className="text-destructive text-xs underline"
                onClick={() => void remove(m.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-muted-foreground text-sm">No media yet.</p>}
      </div>
    </div>
  );
}

/* ---------------- Site content ---------------- */

interface ContentRow {
  key: string;
  value: string;
  updated_at: string;
}

function ContentPanel() {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ content: ContentRow[] }>("/content");
    if (res.ok && res.data) setRows(res.data.content);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setError("");
    if (!key.trim()) return;
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      /* store as plain string */
    }
    const res = await api(`/content/${encodeURIComponent(key.trim())}`, {
      method: "PUT",
      body: JSON.stringify({ value: parsed }),
    });
    if (!res.ok) {
      setError("Save failed.");
      return;
    }
    setKey("");
    setValue("");
    void load();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">Set content</h3>
        <p className="text-muted-foreground text-xs">
          Keys use dot notation, e.g. <code>home.hero.headline</code>. Values can
          be plain text or JSON.
        </p>
        <input
          className={inputClass}
          placeholder="key (e.g. home.hero.headline)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <textarea
          className={inputClass}
          rows={4}
          placeholder="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="button" className={btnClass} onClick={() => void save()}>
          Save
        </button>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight">Existing keys</h3>
        {rows.length === 0 && <p className="text-muted-foreground text-sm">No content keys yet.</p>}
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-secondary"
            onClick={() => {
              setKey(r.key);
              setValue(r.value.startsWith('"') ? (JSON.parse(r.value) as string) : r.value);
            }}
          >
            <span className="font-medium">{r.key}</span>
            <span className="text-muted-foreground block truncate text-xs">{r.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Users (super admin) ---------------- */

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  is_active: number;
}

const ROLES = ["super_admin", "admin", "editor", "marketing"] as const;

function UsersPanel({ me }: { me: User }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [draft, setDraft] = useState({ email: "", name: "", role: "editor", password: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ users: AdminUser[] }>("/users");
    if (res.ok && res.data) setUsers(res.data.users);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError("");
    const res = await api("/users", { method: "POST", body: JSON.stringify(draft) });
    if (!res.ok) {
      setError(res.status === 409 ? "Email already exists." : "Check all fields — password needs 10+ characters.");
      return;
    }
    setDraft({ email: "", name: "", role: "editor", password: "" });
    void load();
  };

  const patch = async (id: number, body: Record<string, unknown>) => {
    await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    void load();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">Add user</h3>
        <input className={inputClass} placeholder="Email" value={draft.email}
          onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
        <input className={inputClass} placeholder="Name" value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        <select className={inputClass} value={draft.role}
          onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input className={inputClass} placeholder="Password (10+ characters)" type="password" value={draft.password}
          onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="button" className={btnClass} onClick={() => void create()}>Create user</button>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight">Team</h3>
        {users.map((u) => (
          <div key={u.id} className="rounded-lg border border-border px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {u.name} <span className="text-muted-foreground">· {u.email}</span>
              </span>
              <span className="flex items-center gap-2">
                <select
                  className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                  value={u.role}
                  disabled={u.id === me.id}
                  onChange={(e) => void patch(u.id, { role: e.target.value })}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {u.id !== me.id && (
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => void patch(u.id, { is_active: u.is_active ? 0 : 1 })}
                  >
                    {u.is_active ? "Deactivate" : "Activate"}
                  </button>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Shell ---------------- */

const TABS = [
  "Dashboard",
  "Enquiries",
  "Products",
  "Posts",
  "Portfolio",
  "Testimonials",
  "Media",
  "Content",
  "Users",
] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<Tab>("Dashboard");

  useEffect(() => {
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data) setUser(r.data.user);
      setChecked(true);
    });
  }, []);

  if (!checked) return null;
  if (!user) return <Login onLogin={setUser} />;

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-gold-deep text-xs font-medium tracking-[0.3em] uppercase">
            Admin
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            AZ ONE OFFICIAL
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">
            {user.name} · {user.role}
          </span>
          <button type="button" className={btnGhost} onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="mt-8 flex flex-wrap gap-2" aria-label="Admin sections">
        {TABS.filter((t) => t !== "Users" || user.role === "super_admin").map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "bg-primary text-primary-foreground rounded-lg px-4 py-1.5 text-sm font-medium"
                : "rounded-lg border border-border px-4 py-1.5 text-sm hover:bg-secondary"
            }
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="mt-8">
        {tab === "Dashboard" && <Dashboard />}
        {tab === "Enquiries" && <Enquiries />}
        {tab === "Products" && (
          <CrudPanel
            resource="products"
            titleKey="name"
            fields={[
              { key: "slug", label: "Slug (unique)" },
              { key: "name", label: "Name" },
              { key: "category", label: "Category" },
              { key: "description", label: "Description", type: "textarea" },
              { key: "price_cents", label: "Price (sen — leave 0 for live-only)", type: "number" },
              { key: "inventory", label: "Inventory", type: "number" },
              { key: "is_featured", label: "Featured", type: "checkbox" },
              { key: "is_visible", label: "Visible", type: "checkbox" },
            ]}
          />
        )}
        {tab === "Posts" && (
          <CrudPanel
            resource="posts"
            titleKey="title"
            fields={[
              { key: "slug", label: "Slug (unique)" },
              { key: "title", label: "Title" },
              { key: "excerpt", label: "Excerpt", type: "textarea" },
              { key: "body", label: "Body", type: "textarea" },
              { key: "status", label: "Status (draft/scheduled/published)" },
              { key: "category", label: "Category" },
            ]}
          />
        )}
        {tab === "Portfolio" && (
          <CrudPanel
            resource="portfolio"
            titleKey="client"
            fields={[
              { key: "client", label: "Client" },
              { key: "summary", label: "Summary", type: "textarea" },
              { key: "result", label: "Result" },
              { key: "is_published", label: "Published", type: "checkbox" },
            ]}
          />
        )}
        {tab === "Media" && <MediaPanel />}
        {tab === "Content" && <ContentPanel />}
        {tab === "Users" && user.role === "super_admin" && <UsersPanel me={user} />}
        {tab === "Testimonials" && (
          <CrudPanel
            resource="testimonials"
            titleKey="author"
            fields={[
              { key: "author", label: "Author" },
              { key: "company", label: "Company" },
              { key: "position", label: "Position" },
              { key: "review", label: "Review", type: "textarea" },
              { key: "rating", label: "Rating (1–5)", type: "number" },
              { key: "is_published", label: "Published", type: "checkbox" },
            ]}
          />
        )}
      </main>
    </div>
  );
}

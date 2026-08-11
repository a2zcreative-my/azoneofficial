"use client";

/**
 * AZ ONE OFFICIAL — Admin (v0, modest)
 * Static-exported client app talking to the API Worker at /api/v1
 * (same origin via the azoneofficial.com/api/* route).
 */

import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { compressImage } from "@/lib/compress-image";
import { useCallback, useEffect, useState } from "react";
import { AuditPanel } from "@/components/admin/audit-panel";
import { SystemHealthCard } from "@/components/admin/system-health";
import { HrAdminPanel } from "@/components/admin/hr-admin-panel";
import { StaffDirectory } from "@/components/staff/staff-directory";
import { StaffPanel } from "@/components/admin/staff-panel";
import { PasswordInput } from "@/components/ui/password-input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SiteEditor } from "@/components/admin/site-editor";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { inputClass, btnClass } from "@/lib/ui-styles";
import { dmyMYT as dmyMyt } from "@/lib/format";
import { rowBtn, rowBtnDanger } from "@/components/ui/row-button";
import { RecordToggle, DetailGrid } from "@/components/ui/record-row";
import { useSaveToast } from "@/components/ui/save-toast";

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

function getCsrfToken() {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match ? match[1] : "";
}

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const isMutating = init?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method);
    const csrfHeader = isMutating ? { "X-CSRF-Token": getCsrfToken() } : {};
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...csrfHeader,
        ...(init?.headers as Record<string, string>),
      },
      ...init,
    });
    const data = res.status === 204 ? null : ((await res.json()) as T);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const btnGhost =
  "inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-secondary";

/* ---------------- Enquiries ---------------- */

const ENQUIRY_STATUSES = ["new", "contacted", "qualified", "closed"] as const;

function Enquiries() {
  const [openEnq, setOpenEnq] = useState<number | null>(null);
  const { show: showToast, node: toastNode } = useSaveToast();
  const [items, setItems] = useState<Enquiry[]>([]);
  const load = useCallback(async () => {
    const res = await api<{ enquiries: Enquiry[] }>("/enquiries");
    if (res.ok && res.data) setItems(res.data.enquiries);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: number, status: string) => {
    const r = await api(`/enquiries/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    showToast(r.ok ? "Saved" : "No changes",
      r.ok ? `Marked ${status}` : "Could not update that enquiry — try again",
      r.ok ? undefined : "notice");
    void load();
  };

  if (items.length === 0)
    return <p className="text-muted-foreground text-sm">No enquiries yet.</p>;

  return (
    <div className="space-y-4">
      {toastNode}
      {items.map((e) => (
        <article key={e.id} className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* v1.4.256: the enquirer's name opens the record. Every enquiry
                used to print its whole message inline, so ten enquiries was a
                wall of text and the status control — the thing you actually
                came to change — sat somewhere in the middle of it. */}
            <p className="text-sm font-semibold">
              <RecordToggle open={openEnq === e.id} title="Contact details and the message"
                onToggle={() => setOpenEnq(openEnq === e.id ? null : e.id)}>
                {e.name}
              </RecordToggle>
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
          {openEnq === e.id && (
            <DetailGrid items={[
              { label: "Email", value: e.email ?? "" },
              { label: "Phone", value: e.phone ?? "" },
              { label: "Company", value: e.company ?? "" },
              { label: "Received", value: dmyMyt(e.created_at) },
              { label: "Message", wide: true, value: <span className="whitespace-pre-line">{e.message}</span> },
            ]} />
          )}
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
  const [openItem, setOpenItem] = useState<number | null>(null);
  const { show: showToast, node: toastNode } = useSaveToast();
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
      showToast("No changes", "Save failed — check the required fields", "notice");
      return;
    }
    setDraft({});
    setEditingId(null);
    const recordTitle = String(draft[titleKey] || "Record");
    showToast("Saved", editingId ? `${recordTitle} updated` : `${recordTitle} created`);
    void load();
  };

  const remove = async (id: number) => {
    const item = items.find((i) => i.id === id);
    const recordTitle = item ? String((item as Record<string, unknown>)[titleKey] || "Record") : "Record";
    const r = await api(`/${resource}/${id}`, { method: "DELETE" });
    showToast(r.ok ? "Saved" : "No changes",
      r.ok ? `${recordTitle} removed` : "Could not remove that record", r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {toastNode}
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
          <div key={item.id} className="rounded-lg border border-border px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 text-sm">
              <RecordToggle open={openItem === item.id} title="What this record contains"
                onToggle={() => setOpenItem(openItem === item.id ? null : item.id)}>
                {String(item[titleKey] ?? "(untitled)")}
              </RecordToggle>
              <span className="text-muted-foreground"> · #{item.id}</span>
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                className={rowBtn}
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
                className={rowBtnDanger}
                onClick={() => void remove(item.id)}
              >
                Delete
              </button>
            </span>
            </div>
            {/* v1.4.256: reading a record no longer means loading it into the
                edit form — which was the only way to see a single field. */}
            {openItem === item.id && (
              <DetailGrid items={fields.map((f) => ({
                label: f.label,
                wide: f.type === "textarea",
                value: f.type === "checkbox"
                  ? (item[f.key] ? "Yes" : "No")
                  : String(item[f.key] ?? ""),
              }))} />
            )}
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
    portfolio?: { total: number };
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
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Total enquiries", value: summary?.enquiries?.total },
          { label: "New enquiries", value: summary?.enquiries?.new_count },
          { label: "Blog posts", value: summary?.posts?.total },
          { label: "Portfolio items", value: summary?.portfolio?.total },
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
              {a.entity_id ? ` #${a.entity_id}` : ""} · {dmyMyt(a.created_at)}
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
  const { show: showToast, node: toastNode } = useSaveToast();
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
      // R2 free tier: images are resized/recompressed client-side first
      // (videos and documents pass through unchanged).
      const payload = kind === "image" ? await compressImage(file) : file;
      const res = await fetch(
        `${API}/media?filename=${encodeURIComponent(file.name)}&kind=${kind}`,
        { method: "POST", credentials: "include", headers: { "Content-Type": payload.type || file.type }, body: payload },
      );
      if (!res.ok) { setError("Upload failed."); showToast("No changes", "Upload failed — try again", "notice"); }
      else showToast("Saved", `${file.name} uploaded`);
    } catch {
      setError("Upload failed — is the API reachable?");
      showToast("No changes", "Upload failed — is the API reachable?", "notice");
    }
    setBusy(false);
    void load();
  };

  const remove = async (id: number) => {
    const r = await api(`/media/${id}`, { method: "DELETE" });
    showToast(r.ok ? "Saved" : "No changes",
      r.ok ? "File removed" : "Could not remove that file", r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}
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
                className={rowBtn}
                onClick={() => void navigator.clipboard.writeText(`${API}/media/file/${encodeURIComponent(m.r2_key)}`)}
              >
                Copy URL
              </button>
              <button
                type="button"
                className={rowBtnDanger}
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
  const { show: showToast, node: toastNode } = useSaveToast();
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
      showToast("No changes", "Save failed — check the key and value", "notice");
      return;
    }
    setKey("");
    setValue("");
    showToast("Saved", `${key.trim()} updated — live on the website now`);
    void load();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {toastNode}
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

/* ---------------- Account (every admin user) ---------------- */

function AccountPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Change password</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Changing your password signs you out everywhere else — any other
          device or stolen session loses access immediately.
        </p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}

/* ---------------- Users (admin & super admin) ---------------- */

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  employment_status?: string | null; // v1.4.180 — drives live_host_part_time display
  is_active: number;
}

/** UTC DB timestamp → DD-MM-YYYY HH:mm in Malaysia time. */

// customer included deliberately: demoting a personal-email account back to
// customer is the cleanup path the domain policy (v1.4.42) depends on.
/* v1.4.180 (CEO): live_host_part_time is a real option — role live_host with
   employment_status part_time, assignable to ANY email (Google accounts
   included). Other staff roles on personal emails are auto-forced part-time
   by the server per the v1.4.156–157 policy. */
const ROLES = ["super_admin", "admin", "editor", "marketing", "live_host", "live_host_part_time", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "customer"] as const;

function UsersPanel({ me }: { me: User }) {
  const { show: showToast, node: toastNode } = useSaveToast();
  const { confirm: userConfirm, node: userConfirmNode } = useConfirm(); // v1.4.240
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
    const res = await api<{ error?: { code?: string; message?: string } }>("/users", {
      method: "POST",
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      setError(
        res.status === 409
          ? "Email already exists."
          : (res.data?.error?.message ??
            "Check all fields — password needs 10+ characters."),
      );
      showToast("No changes", "User not created — see the message on the form", "notice");
      return;
    }
    showToast("Saved", `${draft.email} created`);
    setDraft({ email: "", name: "", role: "editor", password: "" });
    void load();
  };

  /* v1.4.255: patch() drives suspend / reinstate / role change / promote —
     four different actions that all used to complete in silence. The caller
     passes what happened so the toast can say it. */
  const patch = async (id: number, body: Record<string, unknown>, said = "Updated") => {
    const r = await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    showToast(r.ok ? "Saved" : "No changes",
      r.ok ? said : "Could not update that account — try again", r.ok ? undefined : "notice");
    void load();
  };

  const forceLogout = async (id: number) => {
    const r = await api(`/users/${id}/revoke-sessions`, { method: "POST" });
    showToast(r.ok ? "Saved" : "No changes",
      r.ok ? "Signed out of every device" : "Could not revoke those sessions", r.ok ? undefined : "notice");
    void load();
  };

  // Inline password reset (forgotten-password flow). Uses the existing
  // PATCH /users/:id — the server hashes the new password and revokes every
  // session the user had, so a forgotten (or compromised) credential is dead
  // the moment the new one is set.
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetDone, setResetDone] = useState<number | null>(null);

  const resetPassword = async (id: number) => {
    if (resetPw.length < 10) return;
    const res = await api(`/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: resetPw }),
    });
    if (res.ok) {
      setResetDone(id);
      setResetId(null);
      setResetPw("");
      window.setTimeout(() => setResetDone(null), 5000);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {userConfirmNode}
      {toastNode}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">Add user</h3>
        <input className={inputClass} placeholder="Email" value={draft.email}
          onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
        <input className={inputClass} placeholder="Name" value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        <select className={inputClass} value={draft.role}
          onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
          {ROLES.filter((r) => r !== "super_admin" || me.role === "super_admin").map(
            (r) => <option key={r} value={r}>{r}</option>,
          )}
        </select>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">Password</span>
          <PasswordInput
            className={inputClass}
            placeholder="10+ characters"
            value={draft.password}
            onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
          />
          {draft.password.length > 0 && draft.password.length < 10 && (
            <p className="text-destructive mt-1 text-xs">
              {draft.password.length} of 10 characters
            </p>
          )}
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="button" className={btnClass} onClick={() => void create()}>Create user</button>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight">Team</h3>
        {users.map((u) => {
          // An admin can see a super admin but cannot act on them
          const locked = u.role === "super_admin" && me.role !== "super_admin";
          return (
            <div key={u.id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {u.name} <span className="text-muted-foreground">· {u.email}</span>
                  {!u.is_active && (
                    <span className="bg-destructive/10 text-destructive ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                      Suspended
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                    value={u.role === "live_host" && u.employment_status === "part_time" ? "live_host_part_time" : u.role}
                    disabled={u.id === me.id || locked}
                    onChange={(e) => {
                      const newRole = e.target.value;
                      void userConfirm({
                        title: "Confirm Role Change",
                        message: `Are you sure you want to change ${u.name}'s role to ${newRole.replace(/_/g, " ")}?`,
                        confirmLabel: "Change Role",
                      }).then((ok) => {
                        if (ok) void patch(u.id, { role: newRole }, `Role changed to ${newRole.replace(/_/g, " ")}`);
                      });
                    }}
                  >
                    {ROLES.filter((r) => r !== "super_admin" || me.role === "super_admin" || u.role === "super_admin").map(
                      (r) => <option key={r} value={r}>{r}</option>,
                    )}
                  </select>
                  {u.id !== me.id && !locked && (
                    <>
                      {/* Force logout: ends every session immediately but keeps the
                          account. First response to "this account looks odd". */}
                      <button
                        type="button"
                        className={rowBtn}
                        onClick={() => void forceLogout(u.id)}
                      >
                        Force logout
                      </button>
                      <button
                        type="button"
                        className={rowBtn}
                        onClick={() => {
                          setResetId(resetId === u.id ? null : u.id);
                          setResetPw("");
                        }}
                      >
                        Reset password
                      </button>
                      {/* Kill switch: suspend blocks sign-in AND revokes all
                          sessions server-side, instantly. */}
                      <button
                        type="button"
                        className={u.is_active ? "text-destructive text-xs font-medium underline" : "text-xs underline"}
                        onClick={async () => {
                          if (u.is_active && !(await userConfirm({
                            title: `Suspend ${u.email}?`,
                            message: "They are signed out everywhere immediately and cannot sign back in until reinstated.",
                            confirmLabel: "Suspend",
                            variant: "danger",
                          }))) return;
                          void patch(u.id, { is_active: u.is_active ? 0 : 1 }, u.is_active ? `${u.email} suspended — signed out everywhere` : `${u.email} reinstated`);
                        }}
                      >
                        {u.is_active ? "Suspend" : "Reinstate"}
                      </button>
                    </>
                  )}
                </span>
              </div>

              {resetId === u.id && (
                <div className="border-border mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                  <PasswordInput
                    autoComplete="new-password"
                    className="border-input bg-background w-full rounded-lg border px-2 py-1.5 text-xs sm:w-56"
                    placeholder="New password (10+ characters)"
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                  />
                  <button
                    type="button"
                    className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    disabled={resetPw.length < 10}
                    onClick={() => void resetPassword(u.id)}
                  >
                    Set password
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground text-xs underline"
                    onClick={() => {
                      setResetId(null);
                      setResetPw("");
                    }}
                  >
                    Cancel
                  </button>
                  {resetPw.length > 0 && resetPw.length < 10 && (
                    <span className="text-destructive text-xs">
                      {resetPw.length} of 10 characters
                    </span>
                  )}
                  <span className="text-muted-foreground w-full text-[11px]">
                    Tell them the new password directly (WhatsApp or in person) and ask
                    them to change it in Profile after signing in. Setting it signs them
                    out everywhere.
                  </span>
                </div>
              )}
              {resetDone === u.id && (
                <p className="mt-2 text-xs font-medium text-green-700">
                  Password set — all their sessions were signed out.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Shell ---------------- */

const TABS = [
  "Dashboard",
  "Website",
  "Enquiries",
  "Portfolio",
  "Testimonials",
  "Posts",
  "Media",
  "Users",
  "Staff",
  "Audit",
  "Account",
  "Advanced",
] as const;
type Tab = (typeof TABS)[number];

const PORTAL_ROLES = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco"];

/** Plain-language purpose line shown under the tab bar. */
const TAB_HELP: Record<Tab, string> = {
  Dashboard: "Company snapshot and recent account activity.",
  Website: "Edit the text on the live website — hero, about, sections, footer, statistics.",
  Enquiries: "Messages from the contact form.",
  Portfolio: "Client work shown on the Portfolio page.",
  Testimonials: "Client quotes shown on the site.",
  Posts: "Blog articles.",
  Media: "Uploaded images and files.",
  Users: "Staff and customer accounts — roles, suspension, force logout.",
  Staff: "Leave approvals and entry to every staff module — full admin authority.",
  Audit: "Full activity trail — sign-ins, approvals, role changes, resets.",
  Account: "Your own sign-in security.",
  Advanced: "Raw content keys — for anything the Website tab does not cover.",
};

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [moreOpen, setMoreOpen] = useState(false);

  // While the More sheet is open, the page behind must not scroll.
  useEffect(() => {
    document.body.style.overflow = moreOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [moreOpen]);

  useEffect(() => {
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data) setUser(r.data.user);
      setChecked(true);
    });
  }, []);

  if (!checked) return null;
  if (!user) {
    if (typeof window !== "undefined") window.location.replace("/login");
    return null;
  }
  // Data-integrity boundary: /admin is the content-management interface for
  // admin/editor/marketing only. Staff roles work in /portal — even though
  // the API also enforces this, they should never see this surface at all.
  if (PORTAL_ROLES.includes(user.role)) {
    window.location.replace("/portal");
    return null;
  }
  if (user.role === "customer") {
    if (typeof window !== "undefined") window.location.replace("/account");
    return null;
  }

  if (user.requires_2fa) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-12 md:py-24">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
            Two-Factor Authentication Required
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">
            Your role requires two-factor authentication to be enabled before you can access the admin panel. Please set it up now.
          </p>
          <TwoFactorPanel />
          <div className="mt-8 flex justify-end border-t border-border pt-6">
            <button
              onClick={() => {
                document.cookie = "azone_session=; path=/; max-age=0";
                window.location.href = "/login";
              }}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }


  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 pb-24 md:px-5 md:py-6 md:pb-6">
      <header className="border-border bg-background/95 sticky top-0 z-30 -mx-5 flex flex-wrap items-center justify-between gap-4 border-b px-5 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
        <div>
          <p className="text-gold-deep hidden text-xs font-medium tracking-[0.3em] uppercase md:block">
            Admin
          </p>
          <h1 className="hidden text-xl font-semibold tracking-tight md:block">
            AZ ONE OFFICIAL
          </h1>
          <h1 className="text-lg font-semibold tracking-tight md:hidden">{tab}</h1>
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

      {(() => {
        /* v1.4.187: nav = full-width grid flush with the card edges (see /portal). */
        const visibleTabs = TABS.filter((t) => !["Users", "Staff", "Audit"].includes(t) || ["super_admin", "admin"].includes(user.role));
        return (
      <nav className="mt-6 hidden gap-2 md:grid" aria-label="Admin sections"
        style={{ gridTemplateColumns: `repeat(${Math.min(visibleTabs.length, 8)}, minmax(0, 1fr))` }}>
        {visibleTabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "bg-primary text-primary-foreground inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium"
                : "inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg border border-border px-2 py-1.5 text-sm hover:bg-secondary"
            }
          >
            {t}
          </button>
        ))}
      </nav>
        );
      })()}

      {/* App-style bottom navigation (v1.4.55) — phones only. */}
      {(() => {
        const visible = TABS.filter((t) => !["Users", "Staff", "Audit"].includes(t) || ["super_admin", "admin"].includes(user.role));
        const primary = visible.slice(0, 4);
        const rest = visible.slice(4);
        return (
          <>
            <nav
              className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
              aria-label="Admin sections (mobile)"
            >
              {primary.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTab(t); setMoreOpen(false); window.scrollTo({ top: 0 }); }}
                  className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium ${
                    tab === t && !moreOpen ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <span className={`h-1 w-6 rounded-full ${tab === t && !moreOpen ? "bg-gold-deep" : "bg-transparent"}`} />
                  {t}
                </button>
              ))}
              {rest.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium ${
                    moreOpen || rest.includes(tab) ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <span className={`h-1 w-6 rounded-full ${moreOpen || rest.includes(tab) ? "bg-gold-deep" : "bg-transparent"}`} />
                  More
                </button>
              )}
            </nav>
            {moreOpen && (
              <div className="fixed inset-0 z-30 md:hidden">
                <button
                  type="button"
                  aria-label="Close menu"
                  className="absolute inset-0 cursor-pointer bg-black/40"
                  onClick={() => setMoreOpen(false)}
                />
                <div className="border-border bg-card absolute inset-x-0 bottom-0 rounded-t-2xl border-t p-4 pb-16">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="w-9" />
                    <button
                      type="button"
                      aria-label="Close menu"
                      className="bg-border mx-auto h-1.5 w-12 rounded-full"
                      onClick={() => setMoreOpen(false)}
                    />
                    <button
                      type="button"
                      aria-label="Close"
                      className="border-border text-muted-foreground flex h-9 w-9 items-center justify-center rounded-full border text-base"
                      onClick={() => setMoreOpen(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {rest.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setTab(t); setMoreOpen(false); window.scrollTo({ top: 0 }); }}
                        className={`min-h-14 rounded-lg border px-2 py-3 text-xs font-medium ${
                          tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        );
      })()}

      <main key={tab} className="screen-enter mt-4 md:mt-8">
        <p className="text-muted-foreground -mt-2 mb-4 text-xs">{TAB_HELP[tab]}</p>
        {tab === "Dashboard" && <Dashboard />}
        {tab === "Enquiries" && <Enquiries />}
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
        {tab === "Website" && <SiteEditor />}
        {tab === "Advanced" && <ContentPanel />}
        {tab === "Users" && ["super_admin", "admin"].includes(user.role) && <UsersPanel me={user} />}
        {/* v1.4.192: standard multi-card spacing wrapper (was ad-hoc mt-6 divs) */}
        {tab === "Staff" && ["super_admin", "admin"].includes(user.role) && (
          <div className="space-y-4 md:space-y-6">
            <StaffDirectory canAmend />
            <HrAdminPanel />
            <StaffPanel />
          </div>
        )}
        {tab === "Audit" && ["super_admin", "admin"].includes(user.role) && (
          <div className="space-y-4 md:space-y-6">
            <SystemHealthCard />
            <AuditPanel />
          </div>
        )}
        {tab === "Account" && (
          <div className="space-y-4 md:space-y-6">
            <AccountPanel />
            <TwoFactorPanel />
          </div>
        )}
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

"use client";

/**
 * A2Z CREATIVE MARKETING — Admin Portal (v0, modest)
 * Static-exported client app talking to the API Worker at /api/v1
 * (same origin via the azoneofficial.com/api/* route).
 */

import { TabIcon, LogOut, Ellipsis, CloseX } from "@/components/layout/nav-icons";
import { api, csrfFetch } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { compressImage } from "@/lib/compress-image";
import { useCallback, useEffect, useState } from "react";
import { AuditPanel } from "@/components/admin/audit-panel";
import { SystemHealthCard } from "@/components/admin/system-health";
import { HrAdminPanel } from "@/components/admin/hr-admin-panel";
import { StaffDirectory } from "@/components/staff/staff-directory";
import { StaffPanel } from "@/components/admin/staff-panel";
import { SignaturesPanel } from "@/components/admin/signatures-panel"; // v1.38.0 (S-1)
import { PasswordInput } from "@/components/ui/password-input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SiteEditor } from "@/components/admin/site-editor";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { inputClass, btnClass, btnGhost, btnHdr, card } from "@/lib/ui-styles";
import { AppShell } from "@/components/layout/app-shell";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { dmyMYT as dmyMyt } from "@/lib/format";
import { rowBtn, rowBtnDanger } from "@/components/ui/row-button";
import { RecordToggle, DetailGrid } from "@/components/ui/record-row";
import { useSaveToast } from "@/components/ui/save-toast";
import { getLang, setLang as persistLang, type Lang } from "@/lib/i18n";

const API = "/api/v1";

/* v1.25.7 — EN/BM for the admin console. Same storage as the portal
   (localStorage azone-lang, lib/i18n). L() re-reads per render, so the
   header toggle's re-render flips the whole page. Display-point only:
   role/status/tab VALUES stay English — they are compared and sent to
   the API — and map to BM labels only where they are shown. */
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  requires_2fa?: boolean;
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




/* ---------------- Enquiries ---------------- */

const ENQUIRY_STATUSES = ["new", "contacted", "qualified", "closed"] as const;

/* BM labels for enquiry status VALUES — display only; the value sent to the
   API stays English. */
const ENQUIRY_STATUS_MS: Record<string, string> = {
  new: "baharu",
  contacted: "dihubungi",
  qualified: "layak",
  closed: "ditutup",
};

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
    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"),
      r.ok ? L(`Marked ${status}`, `Ditanda ${ENQUIRY_STATUS_MS[status] ?? status}`) : L("Could not update that enquiry — try again", "Pertanyaan itu tidak dapat dikemas kini — cuba lagi"),
      r.ok ? undefined : "notice");
    void load();
  };

  if (items.length === 0)
    return <p className="text-muted-foreground text-sm">{L("No enquiries yet.", "Belum ada pertanyaan.")}</p>;

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
              <RecordToggle open={openEnq === e.id} title={L("Contact details and the message", "Butiran hubungan dan mesej")}
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
                  {L(s, ENQUIRY_STATUS_MS[s] ?? s)}
                </option>
              ))}
            </select>
          </div>
          {openEnq === e.id && (
            <DetailGrid items={[
              { label: L("Email", "E-mel"), value: e.email ?? "" },
              { label: L("Phone", "Telefon"), value: e.phone ?? "" },
              { label: L("Company", "Syarikat"), value: e.company ?? "" },
              { label: L("Received", "Diterima"), value: dmyMyt(e.created_at) },
              { label: L("Message", "Mesej"), wide: true, value: <span className="whitespace-pre-line">{e.message}</span> },
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
      setError(L("Save failed — check required fields.", "Simpanan gagal — semak medan yang diperlukan."));
      showToast(L("No changes", "Tiada perubahan"), L("Save failed — check the required fields", "Simpanan gagal — semak medan yang diperlukan"), "notice");
      return;
    }
    setDraft({});
    setEditingId(null);
    const recordTitle = String(draft[titleKey] || L("Record", "Rekod"));
    showToast(L("Saved", "Disimpan"), editingId ? L(`${recordTitle} updated`, `${recordTitle} dikemas kini`) : L(`${recordTitle} created`, `${recordTitle} dibuat`));
    void load();
  };

  const remove = async (id: number) => {
    const item = items.find((i) => i.id === id);
    const recordTitle = item ? String((item as Record<string, unknown>)[titleKey] || L("Record", "Rekod")) : L("Record", "Rekod");
    const r = await api(`/${resource}/${id}`, { method: "DELETE" });
    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"),
      r.ok ? L(`${recordTitle} removed`, `${recordTitle} dipadam`) : L("Could not remove that record", "Rekod itu tidak dapat dipadam"), r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      {toastNode}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">
          {editingId ? L(`Edit #${editingId}`, `Sunting #${editingId}`) : L("Add new", "Tambah baharu")}
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
            {editingId ? L("Save changes", "Simpan perubahan") : L("Create", "Buat")}
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
              {L("Cancel", "Batal")}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight">{L("Existing", "Sedia ada")}</h3>
        {items.length === 0 && (
          <p className="text-muted-foreground text-sm">{L("Nothing here yet.", "Belum ada apa-apa di sini.")}</p>
        )}
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-border px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 text-sm">
              <RecordToggle open={openItem === item.id} title={L("What this record contains", "Kandungan rekod ini")}
                onToggle={() => setOpenItem(openItem === item.id ? null : item.id)}>
                {String(item[titleKey] ?? L("(untitled)", "(tanpa tajuk)"))}
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
                {L("Edit", "Sunting")}
              </button>
              <button
                type="button"
                className={rowBtnDanger}
                onClick={() => void remove(item.id)}
              >
                {L("Delete", "Padam")}
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
                  ? (item[f.key] ? L("Yes", "Ya") : L("No", "Tidak"))
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: L("Total enquiries", "Jumlah pertanyaan"), value: summary?.enquiries?.total },
          { label: L("New enquiries", "Pertanyaan baharu"), value: summary?.enquiries?.new_count },
          { label: L("Blog posts", "Kiriman blog"), value: summary?.posts?.total },
          { label: L("Portfolio items", "Item portfolio"), value: summary?.portfolio?.total },
          { label: L("Testimonials", "Testimoni"), value: summary?.testimonials?.total },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border p-5">
            <p className="text-3xl font-semibold">{s.value ?? "—"}</p>
            <p className="text-muted-foreground mt-1 text-sm">{s.label}</p>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{L("Recent activity", "Aktiviti terkini")}</h3>
        <ul className="mt-3 space-y-1.5">
          {(summary?.activity ?? []).map((a, i) => (
            <li key={i} className="text-muted-foreground text-sm">
              <span className="text-foreground">{a.user_name ?? L("system", "sistem")}</span>{" "}
              — {a.action}
              {a.entity_id ? ` #${a.entity_id}` : ""} · {dmyMyt(a.created_at)}
            </li>
          ))}
          {(summary?.activity ?? []).length === 0 && (
            <li className="text-muted-foreground text-sm">{L("No activity yet.", "Belum ada aktiviti.")}</li>
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
      const res = await csrfFetch(
        `${API}/media?filename=${encodeURIComponent(file.name)}&kind=${kind}`,
        { method: "POST", headers: { "Content-Type": payload.type || file.type }, body: payload },
      );
      if (!res.ok) { setError(L("Upload failed.", "Muat naik gagal.")); showToast(L("No changes", "Tiada perubahan"), L("Upload failed — try again", "Muat naik gagal — cuba lagi"), "notice"); }
      else showToast(L("Saved", "Disimpan"), L(`${file.name} uploaded`, `${file.name} dimuat naik`));
    } catch {
      setError(L("Upload failed — is the API reachable?", "Muat naik gagal — adakah API boleh dicapai?"));
      showToast(L("No changes", "Tiada perubahan"), L("Upload failed — is the API reachable?", "Muat naik gagal — adakah API boleh dicapai?"), "notice");
    }
    setBusy(false);
    void load();
  };

  const remove = async (id: number) => {
    const r = await api(`/media/${id}`, { method: "DELETE" });
    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"),
      r.ok ? L("File removed", "Fail dipadam") : L("Could not remove that file", "Fail itu tidak dapat dipadam"), r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}
      <label className="block">
        <span className="mb-2 block text-sm font-semibold">{L("Upload file", "Muat naik fail")}</span>
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
      {busy && <p className="text-muted-foreground text-sm">{L("Uploading…", "Sedang dimuat naik…")}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                {L("Copy URL", "Salin URL")}
              </button>
              <button
                type="button"
                className={rowBtnDanger}
                onClick={() => void remove(m.id)}
              >
                {L("Delete", "Padam")}
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-muted-foreground text-sm">{L("No media yet.", "Belum ada media.")}</p>}
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
      setError(L("Save failed.", "Simpanan gagal."));
      showToast(L("No changes", "Tiada perubahan"), L("Save failed — check the key and value", "Simpanan gagal — semak kunci dan nilai"), "notice");
      return;
    }
    setKey("");
    setValue("");
    showToast(L("Saved", "Disimpan"), L(`${key.trim()} updated — live on the website now`, `${key.trim()} dikemas kini — kini live di laman web`));
    void load();
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      {toastNode}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">{L("Set content", "Tetapkan kandungan")}</h3>
        <p className="text-muted-foreground text-xs">
          {L("Keys use dot notation, e.g.", "Kunci menggunakan notasi titik, cth.")} <code>home.hero.headline</code>. {L("Values can be plain text or JSON.", "Nilai boleh berupa teks biasa atau JSON.")}
        </p>
        <input
          className={inputClass}
          placeholder={L("key (e.g. home.hero.headline)", "kunci (cth. home.hero.headline)")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <textarea
          className={inputClass}
          rows={4}
          placeholder={L("value", "nilai")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="button" className={btnClass} onClick={() => void save()}>
          {L("Save", "Simpan")}
        </button>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight">{L("Existing keys", "Kunci sedia ada")}</h3>
        {rows.length === 0 && <p className="text-muted-foreground text-sm">{L("No content keys yet.", "Belum ada kunci kandungan.")}</p>}
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
        <h3 className="text-sm font-semibold tracking-tight">{L("Change password", "Tukar kata laluan")}</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {L("Changing your password signs you out everywhere else — any other device or stolen session loses access immediately.",
            "Menukar kata laluan anda akan melog keluar anda di tempat lain — mana-mana peranti lain atau sesi yang dicuri hilang akses serta-merta.")}
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
          ? L("Email already exists.", "E-mel sudah wujud.")
          : (res.data?.error?.message ??
            L("Check all fields — password needs 10+ characters.", "Semak semua medan — kata laluan perlu 10+ aksara.")),
      );
      showToast(L("No changes", "Tiada perubahan"), L("User not created — see the message on the form", "Pengguna tidak dibuat — lihat mesej pada borang"), "notice");
      return;
    }
    showToast(L("Saved", "Disimpan"), L(`${draft.email} created`, `${draft.email} dibuat`));
    setDraft({ email: "", name: "", role: "editor", password: "" });
    void load();
  };

  /* v1.4.255: patch() drives suspend / reinstate / role change / promote —
     four different actions that all used to complete in silence. The caller
     passes what happened so the toast can say it. */
  const patch = async (id: number, body: Record<string, unknown>, said = L("Updated", "Dikemas kini")) => {
    const r = await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"),
      r.ok ? said : L("Could not update that account — try again", "Akaun itu tidak dapat dikemas kini — cuba lagi"), r.ok ? undefined : "notice");
    void load();
  };

  const forceLogout = async (id: number) => {
    const r = await api(`/users/${id}/revoke-sessions`, { method: "POST" });
    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"),
      r.ok ? L("Signed out of every device", "Dilog keluar dari setiap peranti") : L("Could not revoke those sessions", "Sesi tersebut tidak dapat dibatalkan"), r.ok ? undefined : "notice");
    void load();
  };

  // Inline password reset (forgotten-password flow). Uses the existing
  // PATCH /users/:id — the server hashes the new password and revokes every
  // session the user had, so a forgotten (or compromised) credential is dead
  // the moment the new one is set.
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetDone, setResetDone] = useState<number | null>(null);

  /* v1.22.7 (CEO: "when I click on set password there is no popup to tell me
     that the password set successfully or what?"): the result now speaks
     through the SAME save-toast every other action here uses — success and
     failure both. The inline green line stays as a second confirmation. */
  const resetPassword = async (id: number, email: string) => {
    if (resetPw.length < 10) return;
    const res = await api<{ error?: { message?: string } }>(`/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: resetPw }),
    });
    if (res.ok) {
      setResetDone(id);
      setResetId(null);
      setResetPw("");
      window.setTimeout(() => setResetDone(null), 5000);
      showToast(L("Password set", "Kata laluan ditetapkan"), L(`${email} — signed out everywhere. Tell them the new password directly.`, `${email} — dilog keluar di semua tempat. Beritahu mereka kata laluan baharu secara terus.`));
    } else {
      showToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Could not set that password — try again", "Kata laluan itu tidak dapat ditetapkan — cuba lagi"), "notice");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      {userConfirmNode}
      {toastNode}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">{L("Add user", "Tambah pengguna")}</h3>
        <input className={inputClass} placeholder={L("Email", "E-mel")} value={draft.email}
          onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
        <input className={inputClass} placeholder={L("Name", "Nama")} value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        <select className={inputClass} value={draft.role}
          onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
          {ROLES.filter((r) => r !== "super_admin" || me.role === "super_admin").map(
            (r) => <option key={r} value={r}>{r}</option>,
          )}
        </select>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">{L("Password", "Kata laluan")}</span>
          <PasswordInput
            className={inputClass}
            placeholder={L("10+ characters", "10+ aksara")}
            value={draft.password}
            onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
          />
          {draft.password.length > 0 && draft.password.length < 10 && (
            <p className="text-destructive mt-1 text-xs">
              {L(`${draft.password.length} of 10 characters`, `${draft.password.length} daripada 10 aksara`)}
            </p>
          )}
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="button" className={btnClass} onClick={() => void create()}>{L("Create user", "Buat pengguna")}</button>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight">{L("Team", "Pasukan")}</h3>
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
                      {L("Suspended", "Digantung")}
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
                        title: L("Confirm Role Change", "Sahkan Pertukaran Peranan"),
                        message: L(`Are you sure you want to change ${u.name}'s role to ${newRole.replace(/_/g, " ")}?`, `Adakah anda pasti mahu menukar peranan ${u.name} kepada ${newRole.replace(/_/g, " ")}?`),
                        confirmLabel: L("Change Role", "Tukar Peranan"),
                      }).then((ok) => {
                        if (ok) void patch(u.id, { role: newRole }, L(`Role changed to ${newRole.replace(/_/g, " ")}`, `Peranan ditukar kepada ${newRole.replace(/_/g, " ")}`));
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
                        {L("Force logout", "Paksa log keluar")}
                      </button>
                      <button
                        type="button"
                        className={rowBtn}
                        onClick={() => {
                          setResetId(resetId === u.id ? null : u.id);
                          setResetPw("");
                        }}
                      >
                        {L("Reset password", "Set semula kata laluan")}
                      </button>
                      {/* Kill switch: suspend blocks sign-in AND revokes all
                          sessions server-side, instantly. */}
                      <button
                        type="button"
                        className={u.is_active ? "text-destructive text-xs font-medium underline" : "text-xs underline"}
                        onClick={async () => {
                          if (u.is_active && !(await userConfirm({
                            title: L(`Suspend ${u.email}?`, `Gantung ${u.email}?`),
                            message: L("They are signed out everywhere immediately and cannot sign back in until reinstated.", "Mereka dilog keluar di semua tempat serta-merta dan tidak boleh log masuk semula sehingga dipulihkan."),
                            confirmLabel: L("Suspend", "Gantung"),
                            variant: "danger",
                          }))) return;
                          void patch(u.id, { is_active: u.is_active ? 0 : 1 }, u.is_active ? L(`${u.email} suspended — signed out everywhere`, `${u.email} digantung — dilog keluar di semua tempat`) : L(`${u.email} reinstated`, `${u.email} dipulihkan`));
                        }}
                      >
                        {u.is_active ? L("Suspend", "Gantung") : L("Reinstate", "Pulihkan")}
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
                    placeholder={L("New password (10+ characters)", "Kata laluan baharu (10+ aksara)")}
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                  />
                  <button
                    type="button"
                    className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    disabled={resetPw.length < 10}
                    onClick={() => void resetPassword(u.id, u.email)}
                  >
                    {L("Set password", "Tetapkan kata laluan")}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground text-xs underline"
                    onClick={() => {
                      setResetId(null);
                      setResetPw("");
                    }}
                  >
                    {L("Cancel", "Batal")}
                  </button>
                  {resetPw.length > 0 && resetPw.length < 10 && (
                    <span className="text-destructive text-xs">
                      {L(`${resetPw.length} of 10 characters`, `${resetPw.length} daripada 10 aksara`)}
                    </span>
                  )}
                  <span className="text-muted-foreground w-full text-[11px]">
                    {L("Tell them the new password directly (WhatsApp or in person) and ask them to change it in Profile after signing in. Setting it signs them out everywhere.",
                      "Beritahu mereka kata laluan baharu secara terus (WhatsApp atau bersemuka) dan minta mereka menukarnya di Profil selepas log masuk. Menetapkannya akan melog keluar mereka di semua tempat.")}
                  </span>
                </div>
              )}
              {resetDone === u.id && (
                <p className="mt-2 text-xs font-medium text-green-700">
                  {L("Password set — all their sessions were signed out.", "Kata laluan ditetapkan — semua sesi mereka telah dilog keluar.")}
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

/* BM labels for the tab KEYS above — display only. The Tab values themselves
   drive routing, icon lookup and role gating, so they stay English. */
const TAB_MS: Record<Tab, string> = {
  Dashboard: "Papan Pemuka",
  Website: "Laman Web",
  Enquiries: "Pertanyaan",
  Portfolio: "Portfolio",
  Testimonials: "Testimoni",
  Posts: "Kiriman",
  Media: "Media",
  Users: "Pengguna",
  Staff: "Kakitangan",
  Audit: "Audit",
  Account: "Akaun",
  Advanced: "Lanjutan",
};
const tabLabel = (t: Tab) => L(t, TAB_MS[t]);

/* v1.11.0: the mobile bottom nav shows an icon per tab, exactly like /portal.
   v1.16.0: the local emoji map is gone — admin's tab names live in the shared
   SVG map (components/layout/nav-icons.tsx) alongside the portal's, so the
   surfaces speak one icon language and get tintable strokes. */

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

/* BM twin of TAB_HELP — same keys, display only. */
const TAB_HELP_MS: Record<Tab, string> = {
  Dashboard: "Gambaran syarikat dan aktiviti akaun terkini.",
  Website: "Sunting teks laman web live — hero, tentang, seksyen, footer, statistik.",
  Enquiries: "Mesej daripada borang hubungan.",
  Portfolio: "Kerja pelanggan yang dipaparkan di halaman Portfolio.",
  Testimonials: "Petikan pelanggan yang dipaparkan di laman.",
  Posts: "Artikel blog.",
  Media: "Imej dan fail yang dimuat naik.",
  Users: "Akaun kakitangan dan pelanggan — peranan, penggantungan, paksa log keluar.",
  Staff: "Kelulusan cuti dan akses ke setiap modul kakitangan — kuasa admin penuh.",
  Audit: "Jejak aktiviti penuh — log masuk, kelulusan, pertukaran peranan, set semula.",
  Account: "Keselamatan log masuk anda sendiri.",
  Advanced: "Kunci kandungan mentah — untuk apa-apa yang tab Laman Web tidak liputi.",
};

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [moreOpen, setMoreOpen] = useState(false);
  /* v1.25.7: EN/BM toggle — same storage as /portal. State lives here so
     flipping it re-renders the whole console (L() re-reads per render).
     Hydrated in an effect because localStorage is client-only. */
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { setLangState(getLang()); }, []);

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
            {L("Two-Factor Authentication Required", "Pengesahan Dua Faktor Diperlukan")}
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">
            {L("Your role requires two-factor authentication to be enabled before you can access the A2Z CREATIVE MARKETING Admin Portal. Please set it up now.",
              "Peranan anda memerlukan pengesahan dua faktor diaktifkan sebelum anda boleh mengakses Portal Admin A2Z CREATIVE MARKETING. Sila tetapkannya sekarang.")}
          </p>
          <TwoFactorPanel />
          <div className="mt-8 flex justify-end border-t border-border pt-6">
            <button
              onClick={() => {
                /* v1.5.0 fix: azone_session is HttpOnly — document.cookie
                   could never clear it, so this button bounced users straight
                   back here. A real server-side logout now. */
                void api("/auth/logout", { method: "POST", body: JSON.stringify({}) })
                  .then(() => { window.location.href = "/login"; });
              }}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {L("Sign out", "Log keluar")}
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

  /* v1.11.0: pb-28 — the bottom nav grew to min-h-16 + safe-area inset (same
     as /portal), and pb-24 left the last card tucked under it on notched
     phones. */
  /* v1.22.8 (CEO: "/admin and /account also I found doesnt follow UI/UX as
     /portal"): the admin console now sits on the SAME shell as the portal —
     navy backdrop, rounded canvas, internal scroll on desktop — and every
     section renders inside a house card. Phones untouched (md:-prefixed).
     v1.23.0 (CEO: "Where is the sidebar for /account and /admin as same as
     /portal?"): the navy ICON RAIL too — same SidebarNav component, fed the
     admin tabs. The desktop pill row is gone (the rail replaces it, exactly
     like /portal); phones keep the bottom navigation. */
  const visibleTabs = TABS.filter((t) => !["Users", "Staff", "Audit"].includes(t) || ["super_admin", "admin"].includes(user.role));
  return (
    <AppShell
      maxWidth="md:max-w-6xl"
      rail={
        <SidebarNav
          items={visibleTabs.map((t) => ({ name: t, label: tabLabel(t) }))}
          active={tab}
          onSelect={(t) => { setTab(t as Tab); setMoreOpen(false); }}
          onSignOut={() => void logout()}
        />
      }
    >
    <div className="mx-auto w-full max-w-6xl px-4 py-4 pb-28 md:px-6 md:py-6 md:pb-8">
      {/* v1.11.0: -mx-4/px-4 matches the wrapper's mobile padding — with -mx-5
          the sticky header overhung the viewport by 4px each side. */}
      <header className="border-border bg-background/95 sticky top-0 z-30 -mx-4 flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
        <div>
          {/* v1.27.0: the console's main header. It was the only monolingual
              string left in /admin, so it gets its BM twin here too. */}
          <p className="text-gold-deep hidden text-xs font-medium tracking-[0.3em] uppercase md:block">
            {L("A2Z CREATIVE MARKETING — Admin Portal", "A2Z CREATIVE MARKETING — Portal Admin")}
          </p>
          {/* v1.23.0: with the pill row retired for the rail, the desktop
              heading names the ACTIVE SECTION (portal pattern). */}
          <h1 className="hidden text-xl font-semibold tracking-tight md:block">
            {tabLabel(tab)}
          </h1>
          {/* v1.11.0: on phones this reads as an app screen title, matching
              /portal's mobile h1 weight and size. */}
          <h1 className="text-xl font-bold tracking-tight md:hidden">{tabLabel(tab)}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">
            {user.name} · {user.role}
          </span>
          {/* v1.25.7: EN/BM — the portal's header toggle, verbatim (btnHdr on
              all sizes: admin has no mobile Preferences sheet to fall back to). */}
          <button type="button" className={`${btnHdr} text-xs font-semibold`} title={lang === "ms" ? "Bahasa: BM — tukar ke English" : "Language: EN — switch to Bahasa Melayu"}
            aria-label="Toggle language" onClick={() => { const next = lang === "ms" ? "en" : "ms"; setLangState(next); persistLang(next); }}>
            {lang === "ms" ? "BM" : "EN"}
          </button>
          {/* v1.16.0 (CEO): icon-only sign out — minimal width. */}
          <button type="button" className={`${btnGhost} px-2.5`} title={L("Sign out", "Log keluar")} aria-label={L("Sign out", "Log keluar")} onClick={() => void logout()}>
            <LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* v1.23.0: the desktop pill row is retired — the icon rail (left,
          same as /portal) is the desktop navigation now. */}

      {/* App-style bottom navigation (v1.4.55) — phones only. */}
      {(() => {
        const visible = TABS.filter((t) => !["Users", "Staff", "Audit"].includes(t) || ["super_admin", "admin"].includes(user.role));
        const primary = visible.slice(0, 4);
        const rest = visible.slice(4);
        return (
          <>
            <nav
              className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden"
              /* v1.25.4 (CEO: "Why bottom nav like this?!!!" — labels sliced along
           their bottom edge on iPhone): iOS Safari reports this inset as 0 while
           its floating toolbar is shown, which removed ALL breathing room under
           the labels. max() guarantees a floor either way. */
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)" }}
              aria-label={L("Admin sections (mobile)", "Seksyen admin (mudah alih)")}
            >
              {/* v1.11.0 (reference design, ported from /portal): each tab
                  shows its icon; the active one sits in a filled navy rounded
                  square with the label in navy underneath. */}
              {primary.map((t) => {
                const active = tab === t && !moreOpen;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setTab(t); setMoreOpen(false); window.scrollTo({ top: 0 }); }}
                    aria-current={active ? "page" : undefined}
                    className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
                  >
                    <span
                      aria-hidden
                      className={`grid h-9 w-9 place-items-center rounded-xl text-base transition-colors ${
                        active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                      }`}
                    >
                      <TabIcon name={t} />
                    </span>
                    {/* truncate: longer names ("Testimonials") must not wrap
                        and unbalance the row on narrow phones */}
                    <span className={`w-full truncate px-0.5 text-center leading-[1.6] ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}>{tabLabel(t)}</span>
                  </button>
                );
              })}
              {/* Unlike /portal, admin's More sheet holds only overflow tabs —
                  there are no mobile Preferences here — so gating on
                  rest.length stays correct. */}
              {rest.length > 0 && (() => {
                const active = moreOpen || rest.includes(tab);
                return (
                  <button
                    type="button"
                    onClick={() => setMoreOpen((v) => !v)}
                    className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
                  >
                    <span
                      aria-hidden
                      className={`grid h-9 w-9 place-items-center rounded-xl text-base transition-colors ${
                        active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                      }`}
                    >
                      <Ellipsis aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </span>
                    <span className={`w-full truncate text-center leading-[1.6] ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}>{L("More", "Lagi")}</span>
                  </button>
                );
              })()}
            </nav>
            {moreOpen && (
              <div className="fixed inset-0 z-30 md:hidden">
                <button
                  type="button"
                  aria-label={L("Close menu", "Tutup menu")}
                  className="absolute inset-0 cursor-pointer bg-black/40"
                  onClick={() => setMoreOpen(false)}
                />
                {/* v1.11.0: bottom padding clears the taller nav PLUS the
                    phone's home-indicator inset — pb-16 left the last row of
                    tabs half-covered and untappable on notched iPhones. */}
                <div className="border-border bg-card absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t p-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="w-9" />
                    <button
                      type="button"
                      aria-label={L("Close menu", "Tutup menu")}
                      className="bg-border mx-auto h-1.5 w-12 rounded-full"
                      onClick={() => setMoreOpen(false)}
                    />
                    <button
                      type="button"
                      aria-label={L("Close", "Tutup")}
                      className="border-border text-muted-foreground flex h-9 w-9 items-center justify-center rounded-full border text-base"
                      onClick={() => setMoreOpen(false)}
                    >
                      <CloseX aria-hidden className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {rest.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setTab(t); setMoreOpen(false); window.scrollTo({ top: 0 }); }}
                        className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium ${
                          tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
                        }`}
                      >
                        <span aria-hidden className="grid place-items-center"><TabIcon name={t} /></span>
                        {tabLabel(t)}
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
        <p className="text-muted-foreground -mt-2 mb-4 text-xs">{L(TAB_HELP[tab], TAB_HELP_MS[tab])}</p>
        {/* v1.22.8: bare sections now render inside the house card, exactly
            like every /portal module. Staff/Audit/Account tabs already use
            card components of their own. */}
        {tab === "Dashboard" && <div className={card}><Dashboard /></div>}
        {tab === "Enquiries" && <div className={card}><Enquiries /></div>}
        {tab === "Posts" && (
          <div className={card}>
          <CrudPanel
            resource="posts"
            titleKey="title"
            fields={[
              { key: "slug", label: L("Slug (unique)", "Slug (unik)") },
              { key: "title", label: L("Title", "Tajuk") },
              { key: "excerpt", label: L("Excerpt", "Petikan"), type: "textarea" },
              { key: "body", label: L("Body", "Isi kandungan"), type: "textarea" },
              { key: "status", label: L("Status (draft/scheduled/published)", "Status (draft/scheduled/published)") },
              { key: "category", label: L("Category", "Kategori") },
            ]}
          />
          </div>
        )}
        {tab === "Portfolio" && (
          <div className={card}>
          <CrudPanel
            resource="portfolio"
            titleKey="client"
            fields={[
              { key: "client", label: L("Client", "Pelanggan") },
              { key: "summary", label: L("Summary", "Ringkasan"), type: "textarea" },
              { key: "result", label: L("Result", "Hasil") },
              { key: "is_published", label: L("Published", "Diterbitkan"), type: "checkbox" },
            ]}
          />
          </div>
        )}
        {tab === "Media" && <div className={card}><MediaPanel /></div>}
        {tab === "Website" && <div className={card}><SiteEditor /></div>}
        {tab === "Advanced" && <div className={card}><ContentPanel /></div>}
        {tab === "Users" && ["super_admin", "admin"].includes(user.role) && <div className={card}><UsersPanel me={user} /></div>}
        {/* v1.4.192: standard multi-card spacing wrapper (was ad-hoc mt-6 divs) */}
        {tab === "Staff" && ["super_admin", "admin"].includes(user.role) && (
          <div className="space-y-4 md:space-y-6">
            <StaffDirectory canAmend />
            <HrAdminPanel />
            <StaffPanel />
            <SignaturesPanel />
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
            <div className={card}><AccountPanel /></div>
            <TwoFactorPanel />
          </div>
        )}
        {tab === "Testimonials" && (
          <div className={card}>
          <CrudPanel
            resource="testimonials"
            titleKey="author"
            fields={[
              { key: "author", label: L("Author", "Penulis") },
              { key: "company", label: L("Company", "Syarikat") },
              { key: "position", label: L("Position", "Jawatan") },
              { key: "review", label: L("Review", "Ulasan"), type: "textarea" },
              { key: "rating", label: L("Rating (1–5)", "Penilaian (1–5)"), type: "number" },
              { key: "is_published", label: L("Published", "Diterbitkan"), type: "checkbox" },
            ]}
          />
          </div>
        )}
      </main>
    </div>
    </AppShell>
  );
}

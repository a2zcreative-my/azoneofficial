"use client";

/**
 * A2Z CREATIVE MARKETING — Admin Portal (v0, modest)
 * Static-exported client app talking to the API Worker at /api/v1
 * (same origin via the azoneofficial.com/api/* route).
 */

import { api, csrfFetch } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { signOutRequest } from "@/lib/push-client"; // v1.226.0: signing out unbinds this device's push
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { compressImage } from "@/lib/compress-image";
import { useCallback, useEffect, useState } from "react";
import { AdminOverview } from "@/components/admin/admin-overview"; // v1.349.0 - Phase 2
import { AdminUsers } from "@/components/admin/admin-users"; // v1.349.0 - Phase 2
import { AdminSecurity } from "@/components/admin/admin-security"; // v1.351.0 - Phase 3
import { AdminAccount } from "@/components/admin/admin-account"; // v1.351.0 - Phase 3
import { SignaturesPanel } from "@/components/admin/signatures-panel"; // v1.38.0 (S-1)
import { SiteEditor } from "@/components/admin/site-editor";
import { btnClass, btnGhost, card, inputClass } from "@/lib/ui-styles";
import { PortalSkeleton } from "@/components/portal/portal-skeleton"; // v1.228.0
import { ConsoleShell } from "@/components/layout/console-shell"; // v1.228.0 - the portal chrome
import { rowBtn, rowBtnDanger } from "@/components/ui/row-button";
import { RecordToggle, DetailGrid } from "@/components/ui/record-row";
import { useSaveToast } from "@/components/ui/save-toast";
import { getLang, type Lang } from "@/lib/i18n";
import { Skel } from "@/components/ui/skeleton"; // v1.77.0

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
  is_owner?: boolean; // v1.249.2 - the verified company owner (server-set)
}

interface CrudItem {
  id: number;
  [key: string]: unknown;
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
  const [loaded, setLoaded] = useState(false); // v1.77.0 — first fetch settled (ok or not)

  const load = useCallback(async () => {
    const res = await api<{ items: CrudItem[] }>(`/${resource}`);
    if (res.ok && res.data) setItems(res.data.items);
    setLoaded(true);
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
        {/* v1.77.0 — skeleton until the first fetch lands: the same bordered
            rows as the real list (title · #id on the left, Edit/Delete right). */}
        {!loaded && Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-border px-3 py-2" aria-busy="true">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Skel className="h-4 w-40 max-w-full" />
              <span className="flex shrink-0 gap-2">
                <Skel className="h-6 w-12" />
                <Skel className="h-6 w-14" />
              </span>
            </div>
          </div>
        ))}
        {loaded && items.length === 0 && (
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
  const [loaded, setLoaded] = useState(false); // v1.77.0 — first fetch settled (ok or not)

  const load = useCallback(async () => {
    const res = await api<{ media: MediaItem[] }>("/media");
    if (res.ok && res.data) setItems(res.data.media);
    setLoaded(true);
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
        {/* v1.77.0 — skeleton until the first fetch lands: the same tiles as
            the real grid (h-32 preview, file name, two row buttons). */}
        {!loaded && Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-lg border border-border p-3" aria-busy="true">
            <Skel className="h-32 w-full rounded-md" />
            <Skel className="mt-2 h-3 w-3/4" />
            <div className="mt-1 flex justify-between">
              <Skel className="h-6 w-16" />
              <Skel className="h-6 w-14" />
            </div>
          </div>
        ))}
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
        {loaded && items.length === 0 && <p className="text-muted-foreground text-sm">{L("No media yet.", "Belum ada media.")}</p>}
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
  const [loaded, setLoaded] = useState(false); // v1.77.0 — first fetch settled (ok or not)

  const load = useCallback(async () => {
    const res = await api<{ content: ContentRow[] }>("/content");
    if (res.ok && res.data) setRows(res.data.content);
    setLoaded(true);
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
        {/* v1.77.0 — skeleton until the first fetch lands: the same bordered
            key rows (key line over a value line) as the real list. */}
        {!loaded && Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="w-full rounded-lg border border-border px-3 py-2" aria-busy="true">
            <Skel className="h-4 w-40 max-w-full" />
            <Skel className="mt-1.5 h-3 w-2/3" />
          </div>
        ))}
        {loaded && rows.length === 0 && <p className="text-muted-foreground text-sm">{L("No content keys yet.", "Belum ada kunci kandungan.")}</p>}
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

/* ---------------- My Account: components/admin/admin-account.tsx (v1.351.0) ---------------- */

/* ---------------- Users: components/admin/admin-users.tsx (v1.349.0) ---------------- */

/* ---------------- Shell ---------------- */

/* v1.348.0 (the CEO, 17-11-2026: "/Admin are totally super admin control") -
   Enquiries and Staff are retired here (Sales → Customers & Follow-ups, and the
   portal's Staff, Leave and HR own them); the signature vault, which lives
   nowhere else, is its own tab. */
const TABS = [
  "Dashboard",
  "Website",
  "Portfolio",
  "Testimonials",
  "Posts",
  "Media",
  "Users",
  "Signatures",
  "Audit",
  "Account",
  "Advanced",
] as const;
type Tab = (typeof TABS)[number];

/* BM labels for the tab KEYS above — display only. The Tab values themselves
   drive routing, icon lookup and role gating, so they stay English. */
const TAB_MS: Record<Tab, string> = {
  Dashboard: "Gambaran Keseluruhan",
  Website: "Laman Web",
  Portfolio: "Portfolio",
  Testimonials: "Testimoni",
  Posts: "Kiriman",
  Media: "Media",
  Users: "Pengguna",
  Signatures: "Tandatangan",
  Audit: "Keselamatan & Audit",
  Account: "Akaun Saya",
  Advanced: "Lanjutan",
};
/* v1.351.0 - the plan's names on screen; the keys (routing, icons, guards) stay as they were */
const TAB_EN: Partial<Record<Tab, string>> = { Dashboard: "Overview", Audit: "Security & Audit", Account: "My Account" };
const tabLabel = (t: Tab) => L(TAB_EN[t] ?? t, TAB_MS[t]);
/* v1.228.0 - how the rail and the More sheet group the admin tabs (the
   portal's grouped-rail pattern, components/layout/side-nav.tsx) */
const ADMIN_SECTIONS = [
  { title: "Overview", tabs: ["Dashboard"] },
  { title: "Content", tabs: ["Website", "Portfolio", "Testimonials", "Posts", "Media", "Advanced"] },
  { title: "People", tabs: ["Users"] },
  { title: "System", tabs: ["Signatures", "Audit"] },
  { title: "Account", tabs: ["Account"] },
];

/* v1.11.0: the mobile bottom nav shows an icon per tab, exactly like /portal.
   v1.16.0: the local emoji map is gone — admin's tab names live in the shared
   SVG map (components/layout/nav-icons.tsx) alongside the portal's, so the
   surfaces speak one icon language and get tintable strokes. */


/** Plain-language purpose line shown under the tab bar. */
const TAB_HELP: Record<Tab, string> = {
  Dashboard: "The console's state: accounts, backups, errors, database updates and recent activity.",
  Website: "Edit the text on the live website — hero, about, sections, footer, statistics.",
  Portfolio: "Client work shown on the Portfolio page.",
  Testimonials: "Client quotes shown on the site.",
  Posts: "Blog articles.",
  Media: "Uploaded images and files.",
  Users: "Staff and customer accounts — roles, suspension, force logout.",
  Signatures: "Officer signatures and company stamps for each issuing company.",
  Audit: "The full audit trail, backups, errors and database updates.",
  Account: "Your own password, two-factor, Google sign-in, passkeys and recovery.",
  Advanced: "Raw content keys — for anything the Website tab does not cover.",
};

/* BM twin of TAB_HELP — same keys, display only. */
const TAB_HELP_MS: Record<Tab, string> = {
  Dashboard: "Keadaan konsol: akaun, sandaran, ralat, kemas kini pangkalan data dan aktiviti terkini.",
  Website: "Sunting teks laman web live — hero, tentang, seksyen, footer, statistik.",
  Portfolio: "Kerja pelanggan yang dipaparkan di halaman Portfolio.",
  Testimonials: "Petikan pelanggan yang dipaparkan di laman.",
  Posts: "Artikel blog.",
  Media: "Imej dan fail yang dimuat naik.",
  Users: "Akaun kakitangan dan pelanggan — peranan, penggantungan, paksa log keluar.",
  Signatures: "Tandatangan pegawai dan cop syarikat bagi setiap syarikat pengeluar.",
  Audit: "Jejak audit penuh, sandaran, ralat dan kemas kini pangkalan data.",
  Account: "Kata laluan, dua faktor, log masuk Google, kunci laluan dan pemulihan anda sendiri.",
  Advanced: "Kunci kandungan mentah — untuk apa-apa yang tab Laman Web tidak liputi.",
};

/* v1.77.0 — the console's first paint while /auth/me answers (and while a
   redirect to /login, /portal or /account is on its way). Pure presentational:
   the SAME shell (full-width canvas since v1.88.2, navy rail, header row, house cards in
   the Dashboard's own layout, bottom nav on phones), so nothing jumps when the
   real console takes over. No hooks, no fetch. */
function AdminPageSkeleton() {
  /* v1.228.0 - the portal's own first paint: the same rail, header and bar
     the console shell draws, so nothing jumps when the page takes over */
  return <PortalSkeleton />;
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<Tab>("Dashboard");
  /* v1.265.0 - back from Connect Google (?google=...): the Account tab, where the panel says how it went */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("google")) requestAnimationFrame(() => setTab("Account" as Tab));
  }, []);
  /* v1.25.7: EN/BM toggle — same storage as /portal. State lives here so
     flipping it re-renders the whole console (L() re-reads per render).
     Hydrated in an effect because localStorage is client-only. */
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { setLangState(getLang()); }, []);

  // v1.228.0 - the More sheet (and its scroll lock) lives in ConsoleShell now.

  /* v1.241.0 (go-live audit A3) - also re-read after the 2FA gate's
     enrolment, so the gate clears without a sign-out. */
  const loadMe = () =>
    api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data) setUser(r.data.user);
      setChecked(true);
    });
  useEffect(() => {
    void loadMe();
  }, []);

  /* v1.77.0 — skeleton until the first fetch lands. The auth check used to
     return null (a blank screen with a name); the page-shaped shell paints
     instead, and stays up while any redirect below is on its way. */
  if (!checked) return <AdminPageSkeleton />;
  if (!user) {
    if (typeof window !== "undefined") window.location.replace("/login");
    return <AdminPageSkeleton />;
  }
  // Data-integrity boundary: /admin is the content-management interface for
  // admin/editor/marketing only. Staff roles work in /portal — even though
  // the API also enforces this, they should never see this surface at all.
  /* v1.249.2 (the owner, 01-11-2026) - the verified company owner opens
     /admin for one thing: Users, to give and take every role. Any other CEO
     account, and every other portal role, still goes to /portal. */
  /* v1.348.0 (the CEO, 17-11-2026) - /admin is the SUPER ADMIN's console and
     nobody else's: the company owner gives and takes roles in portal Users
     (the same server rule, roleChangeRule), the admin role and every other
     staff role work in /portal, a customer in /account. The server refuses the
     website content to everyone but the super admin as well (content_manage). */
  if (user.role === "customer") {
    if (typeof window !== "undefined") window.location.replace("/account");
    return <AdminPageSkeleton />;
  }
  if (user.role !== "super_admin") {
    if (typeof window !== "undefined") window.location.replace("/portal");
    return <AdminPageSkeleton />;
  }

  if (user.requires_2fa) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-12 md:py-24">
        <div className={card}>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
            {L("Two-Factor Authentication Required", "Pengesahan Dua Faktor Diperlukan")}
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">
            {L("Your role requires two-factor authentication to be enabled before you can access the A2Z CREATIVE MARKETING Admin Portal. Please set it up now.",
              "Peranan anda memerlukan pengesahan dua faktor diaktifkan sebelum anda boleh mengakses Portal Admin A2Z CREATIVE MARKETING. Sila tetapkannya sekarang.")}
          </p>
          <TwoFactorPanel onEnabled={() => void loadMe()} />
          <div className="mt-8 flex justify-end border-t border-border pt-6">
            <button
              onClick={() => {
                /* v1.5.0 fix: azone_session is HttpOnly — document.cookie
                   could never clear it, so this button bounced users straight
                   back here. A real server-side logout now. */
                void signOutRequest()
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
    await signOutRequest();
    setUser(null);
  };

  /* v1.164.1: phone bottom spacing follows the shared PWA nav clearance used
     by /portal and /account. */
  /* v1.22.8 (CEO: "/admin and /account also I found doesnt follow UI/UX as
     /portal"): the admin console now sits on the SAME shell as the portal —
     navy backdrop, rounded canvas, internal scroll on desktop — and every
     section renders inside a house card. Phones untouched (md:-prefixed).
     v1.23.0 (CEO: "Where is the sidebar for /account and /admin as same as
     /portal?"): the navy ICON RAIL too — same SidebarNav component, fed the
     admin tabs. The desktop pill row is gone (the rail replaces it, exactly
     like /portal); phones keep the bottom navigation. */
  const visibleTabs: Tab[] = [...TABS]; // v1.348.0 - one person reaches this page: the super admin
  const tabNow: Tab = visibleTabs.includes(tab) ? tab : visibleTabs[0]!;
  /* v1.228.0 (the owner, 30-10-2026: "/admin and /account should follow the
     interface of /portal"): the console now wears the portal's chrome -
     the light grouped rail, the .erp-topbar header, the tinted phone bar and
     the More sheet - through components/layout/console-shell.tsx. The tabs,
     their order, the role gates and every panel below are unchanged. */
  return (
    <ConsoleShell
      eyebrow={L("A2Z Admin Console", "Konsol Admin A2Z")}
      items={visibleTabs.map((t) => ({ name: t, label: tabLabel(t) }))}
      sections={ADMIN_SECTIONS}
      active={tabNow}
      onSelect={(t) => setTab(t as Tab)}
      title={tabLabel(tabNow)}
      phoneTitle={tabLabel(tabNow)}
      user={user}
      lang={lang}
      onLang={setLangState}
      onSignOut={() => void logout()}
    >
      <main key={tabNow} className="screen-enter mt-4 md:mt-8">
        <p className="text-muted-foreground -mt-2 mb-4 text-xs">{L(TAB_HELP[tabNow], TAB_HELP_MS[tabNow])}</p>
        {/* v1.22.8: bare sections now render inside the house card, exactly
            like every /portal module. Staff/Audit/Account tabs already use
            card components of their own. */}
        {tabNow === "Dashboard" && <AdminOverview onOpen={(t) => setTab(t as Tab)} />}
        {tabNow === "Posts" && (
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
        {tabNow === "Portfolio" && (
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
        {tabNow === "Media" && <div className={card}><MediaPanel /></div>}
        {tabNow === "Website" && <div className={card}><SiteEditor /></div>}
        {tabNow === "Advanced" && <div className={card}><ContentPanel /></div>}
        {tabNow === "Users" && <AdminUsers me={user} />}
        {/* v1.4.192: standard multi-card spacing wrapper (was ad-hoc mt-6 divs) */}
        {tabNow === "Signatures" && <SignaturesPanel />}
        {tabNow === "Audit" && <AdminSecurity />}
        {tabNow === "Account" && <AdminAccount onReload={() => void loadMe()} />}
        {tabNow === "Testimonials" && (
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
    </ConsoleShell>
  );
}

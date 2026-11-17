"use client";

/* v1.352.0 - WEBSITE CONTENT (Phase 4 of the /admin plan the CEO approved,
   17-11-2026): the six website tabs - Website, Posts, Portfolio,
   Testimonials, Media, Advanced - are ONE tab, on the portal's pages. One KPI
   strip from the lists the views already read, one underline tab row, and
   each view keeps the requests it always sent:
     Website text  SiteEditor                 GET /content, PUT /content/:key
     Posts / Portfolio / Testimonials          GET, POST, PUT /:resource/:id, DELETE (now asks first)
     Media         GET /media, POST /media (images compressed first), DELETE /media/:id (now asks first)
     Advanced keys GET /content, PUT /content/:key
   The views stay mounted while hidden, so a half-written post survives a
   look at the media library. The server refuses all of it to every role but
   the super admin (content_manage, v1.348.0). */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, csrfFetch } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { compressImage } from "@/lib/compress-image";
import { dmyMYT } from "@/lib/format";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs } from "@/components/ui/line-tabs";
import { SkelRows } from "@/components/ui/skeleton";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { SiteEditor } from "@/components/admin/site-editor";
import { btnSm, btnSmDanger, btnSmPrimary, chipSmNeutral, chipSmSuccess, chipSmWarn, fieldLabel, inputClass, inputClassSm, textareaClass } from "@/lib/ui-styles";
import css from "./admin-console.module.css";
import w from "./admin-website.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const API = "/api/v1";

/* ---------------- the three lists: posts, portfolio, testimonials ---------------- */

interface FieldDef { key: string; label: string; type?: "text" | "textarea" | "number" | "checkbox" }
interface CrudItem { id: number; [k: string]: unknown }

/** A published flag in words: posts carry a status, the other two a checkbox. */
function stateOf(item: CrudItem): ReactNode {
  if (typeof item.status === "string") {
    const s = item.status;
    return <span className={s === "published" ? chipSmSuccess : s === "scheduled" ? chipSmWarn : chipSmNeutral}>{s === "published" ? L("Published", "Diterbitkan") : s === "scheduled" ? L("Scheduled", "Dijadualkan") : L("Draft", "Draf")}</span>;
  }
  return item.is_published ? <span className={chipSmSuccess}>{L("Published", "Diterbitkan")}</span> : <span className={chipSmNeutral}>{L("Hidden", "Tersembunyi")}</span>;
}

export function ContentList({ resource, fields, titleKey, noun, onCount }: {
  resource: string; fields: FieldDef[]; titleKey: string; noun: [string, string]; onCount?: (n: number) => void;
}) {
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const [items, setItems] = useState<CrudItem[] | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const load = useCallback(async () => {
    const res = await api<{ items: CrudItem[] }>(`/${resource}`);
    const list = res.ok && res.data && Array.isArray(res.data.items) ? res.data.items : [];
    setItems(list);
    onCount?.(list.length);
  }, [resource, onCount]);
  useEffect(() => { void load(); }, [load]);

  const titleOf = (it: Record<string, unknown>) => String(it[titleKey] || L("(untitled)", "(tanpa tajuk)"));
  const startNew = () => { setEditingId(null); setDraft({}); setError(""); };
  const open = (id: number) => {
    const item = (items ?? []).find((i) => i.id === id);
    if (!item) return;
    const d: Record<string, unknown> = {};
    for (const f of fields) d[f.key] = item[f.key] ?? "";
    setEditingId(id); setDraft(d); setError("");
  };
  const save = async () => {
    setError("");
    const res = editingId
      ? await api(`/${resource}/${editingId}`, { method: "PUT", body: JSON.stringify(draft) })
      : await api(`/${resource}`, { method: "POST", body: JSON.stringify(draft) });
    if (!res.ok) {
      setError(L("Save failed — check the required fields.", "Simpanan gagal — semak medan yang diperlukan."));
      toast(L("No changes", "Tiada perubahan"), L("Save failed — check the required fields", "Simpanan gagal — semak medan yang diperlukan"), "notice");
      return;
    }
    const t = titleOf(draft);
    toast(L("Saved", "Disimpan"), editingId ? L(`${t} updated`, `${t} dikemas kini`) : L(`${t} created`, `${t} dibuat`));
    startNew();
    void load();
  };
  const remove = async (id: number) => {
    const item = (items ?? []).find((i) => i.id === id);
    const t = item ? titleOf(item) : L("Record", "Rekod");
    if (!(await confirm({ title: L(`Delete ${t}?`, `Padam ${t}?`), message: L("It leaves the website at once and cannot be brought back from here.", "Ia hilang dari laman web serta-merta dan tidak boleh dikembalikan dari sini."), confirmLabel: L("Delete", "Padam"), variant: "danger" }))) return;
    const r = await api(`/${resource}/${id}`, { method: "DELETE" });
    toast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L(`${t} removed`, `${t} dipadam`) : L("Could not remove that record", "Rekod itu tidak dapat dipadam"), r.ok ? undefined : "notice");
    if (r.ok && editingId === id) startNew();
    void load();
  };

  const cols: TableCol<CrudItem>[] = [
    { key: "title", label: L("Title", "Tajuk"), main: true, cell: (it) => <span className={css.cell}><strong>{titleOf(it)}</strong><span>#{it.id}</span></span> },
    { key: "state", label: L("On the site", "Di laman"), cell: stateOf },
  ];
  return (
    <>
      {toastNode}{confirmNode}
      <WorkspaceSplit testid={`${resource}-split`} ratio="55-45" hold={false}>
        <SplitPane testid={`${resource}-list`} title={L(`${noun[0]}s`, noun[1])} sub={L("A row opens it in the editor", "Satu baris membukanya dalam penyunting")}
          actions={<button type="button" className={btnSmPrimary} onClick={startNew} data-testid={`${resource}-new`}>{L(`New ${noun[0].toLowerCase()}`, `${noun[1]} baharu`)}</button>}>
          {items === null ? <SkelRows rows={5} /> : (
            <CompactTaskTable rows={items} cols={cols} label={L(`${noun[0]}s`, noun[1])} record={resource} testid={`${resource}-table`}
              onOpen={open} picked={editingId} page={page} size={8} onPage={setPage}
              empty={<p className={css.muted}>{L("Nothing here yet.", "Belum ada apa-apa di sini.")}</p>} />
          )}
        </SplitPane>
        <SplitPane testid={`${resource}-editor`} title={editingId ? L(`Edit #${editingId}`, `Sunting #${editingId}`) : L(`New ${noun[0].toLowerCase()}`, `${noun[1]} baharu`)}
          sub={editingId ? titleOf(draft) : L("Fill in and create", "Isi dan buat")}
          foot={
            <span className={css.actions}>
              <button type="button" className={btnSmPrimary} onClick={() => void save()} data-testid={`${resource}-save`}>{editingId ? L("Save changes", "Simpan perubahan") : L("Create", "Buat")}</button>
              {editingId && <button type="button" className={btnSm} onClick={startNew}>{L("Cancel", "Batal")}</button>}
              {editingId && <button type="button" className={btnSmDanger} onClick={() => void remove(editingId)} data-testid={`${resource}-delete`}>{L("Delete", "Padam")}</button>}
            </span>
          }>
          <div className={css.form}>
            {fields.map((f) => (
              <label key={f.key} className={f.type === "checkbox" ? css.checkRow : undefined}>
                {f.type === "checkbox" ? (
                  <><input type="checkbox" checked={Boolean(draft[f.key])} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked ? 1 : 0 }))} /><span>{f.label}</span></>
                ) : (
                  <>
                    <span className={fieldLabel}>{f.label}</span>
                    {f.type === "textarea"
                      ? <textarea className={textareaClass} rows={4} value={String(draft[f.key] ?? "")} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
                      : <input className={inputClass} type={f.type === "number" ? "number" : "text"} value={String(draft[f.key] ?? "")}
                          onChange={(e) => setDraft((d) => ({ ...d, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value }))} />}
                  </>
                )}
              </label>
            ))}
            {error && <p className={css.error} role="alert">{error}</p>}
          </div>
        </SplitPane>
      </WorkspaceSplit>
    </>
  );
}

/* ---------------- media ---------------- */

interface MediaItem { id: number; r2_key: string; kind: string; alt: string | null; created_at: string }

export function MediaLibrary({ onCount }: { onCount?: (n: number) => void }) {
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const load = useCallback(async () => {
    const res = await api<{ media: MediaItem[] }>("/media");
    const list = res.ok && res.data && Array.isArray(res.data.media) ? res.data.media : [];
    setItems(list);
    onCount?.(list.length);
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const kind = file.type.startsWith("video") ? "video" : file.type.startsWith("image") ? "image" : "document";
      /* R2 free tier: images are resized/recompressed first; videos and documents pass through */
      const payload = kind === "image" ? await compressImage(file) : file;
      const res = await csrfFetch(`${API}/media?filename=${encodeURIComponent(file.name)}&kind=${kind}`,
        { method: "POST", headers: { "Content-Type": payload.type || file.type }, body: payload });
      if (!res.ok) toast(L("No changes", "Tiada perubahan"), L("Upload failed — try again", "Muat naik gagal — cuba lagi"), "notice");
      else toast(L("Saved", "Disimpan"), L(`${file.name} uploaded`, `${file.name} dimuat naik`));
    } catch {
      toast(L("No changes", "Tiada perubahan"), L("Upload failed — is the API reachable?", "Muat naik gagal — adakah API boleh dicapai?"), "notice");
    }
    setBusy(false);
    void load();
  };
  const remove = async (m: MediaItem) => {
    if (!(await confirm({ title: L("Delete this file?", "Padam fail ini?"), message: L(`${m.r2_key} - any page that shows it will show nothing in its place.`, `${m.r2_key} - mana-mana halaman yang memaparkannya tidak akan memaparkan apa-apa.`), confirmLabel: L("Delete", "Padam"), variant: "danger" }))) return;
    const r = await api(`/media/${m.id}`, { method: "DELETE" });
    toast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L("File removed", "Fail dipadam") : L("Could not remove that file", "Fail itu tidak dapat dipadam"), r.ok ? undefined : "notice");
    void load();
  };
  const copy = (m: MediaItem) => {
    void navigator.clipboard.writeText(`${API}/media/file/${encodeURIComponent(m.r2_key)}`)
      .then(() => toast(L("Copied", "Disalin"), L("The file's link is on your clipboard", "Pautan fail ada pada papan klip anda")))
      .catch(() => toast(L("Not copied", "Tidak disalin"), L("This browser refused the clipboard", "Pelayar ini menolak papan klip"), "notice"));
  };
  const SIZE = 12;
  const shown = (items ?? []).slice((page - 1) * SIZE, page * SIZE);
  const pages = Math.max(1, Math.ceil((items ?? []).length / SIZE));
  return (
    <>
      {toastNode}{confirmNode}
      <SplitPane testid="media-library" title={L("Media Library", "Pustaka Media")} sub={L("Images are compressed before they are stored", "Imej dimampatkan sebelum disimpan")}
        actions={
          <label className={`${btnSmPrimary} ${w.upload}`} aria-disabled={busy || undefined} data-testid="media-upload">
            <AppIcon name="upload" />{busy ? L("Uploading…", "Sedang dimuat naik…") : L("Upload file", "Muat naik fail")}
            <input type="file" className={w.file} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </label>
        }
        foot={pages > 1 ? (
          <span className={css.actions}>
            <button type="button" className={btnSm} disabled={page <= 1} onClick={() => setPage(page - 1)}>{L("Previous", "Sebelum")}</button>
            <span className={css.muted}>{L(`Page ${page} of ${pages}`, `Halaman ${page} daripada ${pages}`)}</span>
            <button type="button" className={btnSm} disabled={page >= pages} onClick={() => setPage(page + 1)}>{L("Next", "Seterusnya")}</button>
          </span>
        ) : undefined}>
        {items === null ? <SkelRows rows={4} /> : items.length === 0 ? <p className={css.muted}>{L("No media yet.", "Belum ada media.")}</p> : (
          <ul className={w.grid} data-testid="media-grid">
            {shown.map((m) => (
              <li key={m.id} className={w.tile} data-testid="media-tile">
                {m.kind === "image"
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`${API}/media/file/${encodeURIComponent(m.r2_key)}`} alt={m.alt ?? m.r2_key} className={w.thumb} loading="lazy" />
                  : <span className={w.kind}><AppIcon name={m.kind === "video" ? "video" : "document"} />{m.kind}</span>}
                <span className={w.name} title={m.r2_key}>{m.r2_key}</span>
                <span className={w.meta}>{dmyMYT(m.created_at).slice(0, 10)}</span>
                <span className={css.actions}>
                  <button type="button" className={btnSm} onClick={() => copy(m)}>{L("Copy URL", "Salin URL")}</button>
                  <button type="button" className={btnSmDanger} onClick={() => void remove(m)}>{L("Delete", "Padam")}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SplitPane>
    </>
  );
}

/* ---------------- advanced keys ---------------- */

interface ContentRow { key: string; value: string; updated_at: string }

export function ContentKeys({ onCount }: { onCount?: (n: number) => void }) {
  const { show: toast, node: toastNode } = useSaveToast();
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const res = await api<{ content: ContentRow[] }>("/content");
    const list = res.ok && res.data && Array.isArray(res.data.content) ? res.data.content.filter((r) => typeof r.key === "string" && typeof r.value === "string") : [];
    setRows(list);
    onCount?.(list.length);
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setError("");
    if (!key.trim()) return;
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* stored as plain text */ }
    const res = await api(`/content/${encodeURIComponent(key.trim())}`, { method: "PUT", body: JSON.stringify({ value: parsed }) });
    if (!res.ok) {
      setError(L("Save failed.", "Simpanan gagal."));
      toast(L("No changes", "Tiada perubahan"), L("Save failed — check the key and value", "Simpanan gagal — semak kunci dan nilai"), "notice");
      return;
    }
    toast(L("Saved", "Disimpan"), L(`${key.trim()} updated — live on the website now`, `${key.trim()} dikemas kini — kini live di laman web`));
    setKey(""); setValue("");
    void load();
  };
  const list = useMemo(() => (rows ?? []).filter((r) => !q.trim() || r.key.toLowerCase().includes(q.trim().toLowerCase())).map((r, i) => ({ ...r, id: i + 1 })), [rows, q]);
  type Row = (typeof list)[number];
  const cols: TableCol<Row>[] = [
    { key: "key", label: L("Key", "Kunci"), main: true, cell: (r) => <span className={css.cell}><strong>{r.key}</strong><span>{r.value}</span></span> },
    { key: "updated", label: L("Updated", "Dikemas kini"), cell: (r) => <span className={css.nowrap}>{dmyMYT(r.updated_at).slice(0, 10)}</span> },
  ];
  return (
    <>
      {toastNode}
      <WorkspaceSplit testid="keys-split" ratio="55-45" hold={false}>
        <SplitPane testid="keys-list" title={L("Content Keys", "Kunci Kandungan")} sub={L("For anything the Website text view does not cover", "Untuk apa-apa yang tidak diliputi paparan Teks laman web")}
          toolbar={<input className={inputClassSm} type="search" placeholder={L("Search keys", "Cari kunci")} aria-label={L("Search keys", "Cari kunci")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}>
          {rows === null ? <SkelRows rows={5} /> : (
            <CompactTaskTable rows={list} cols={cols} label={L("Content keys", "Kunci kandungan")} record="key" testid="keys-table" page={page} size={8} onPage={setPage}
              onOpen={(id) => { const r = list.find((x) => x.id === id); if (r) { setKey(r.key); setValue(r.value.startsWith('"') ? (JSON.parse(r.value) as string) : r.value); } }}
              empty={<p className={css.muted}>{L("No content keys yet.", "Belum ada kunci kandungan.")}</p>} />
          )}
        </SplitPane>
        <SplitPane testid="keys-editor" title={L("Set a key", "Tetapkan kunci")} sub={L("Dot notation, e.g. home.hero.headline; plain text or JSON", "Notasi titik, cth. home.hero.headline; teks biasa atau JSON")}
          foot={<button type="button" className={btnSmPrimary} onClick={() => void save()} disabled={!key.trim()}>{L("Save", "Simpan")}</button>}>
          <div className={css.form}>
            <label><span className={fieldLabel}>{L("Key", "Kunci")}</span><input className={inputClass} placeholder="home.hero.headline" value={key} onChange={(e) => setKey(e.target.value)} /></label>
            <label><span className={fieldLabel}>{L("Value", "Nilai")}</span><textarea className={textareaClass} rows={6} value={value} onChange={(e) => setValue(e.target.value)} /></label>
            {error && <p className={css.error} role="alert">{error}</p>}
            <p className={css.note}>{L("Saved keys are live on the website at the next page load.", "Kunci yang disimpan dipaparkan di laman web pada muatan halaman seterusnya.")}</p>
          </div>
        </SplitPane>
      </WorkspaceSplit>
    </>
  );
}

/* ---------------- the page ---------------- */

type View = "text" | "posts" | "portfolio" | "testimonials" | "media" | "keys";

export function AdminWebsite() {
  const [view, setView] = useState<View>("text");
  const [count, setCount] = useState<Partial<Record<"posts" | "portfolio" | "testimonials" | "media" | "keys", number>>>({});
  const set = useCallback((k: keyof typeof count) => (n: number) => setCount((c) => (c[k] === n ? c : { ...c, [k]: n })), []);
  /* one setter per list, made once, so a list's load never re-runs because the page re-rendered */
  const setters = useMemo(() => ({ posts: set("posts"), portfolio: set("portfolio"), testimonials: set("testimonials"), media: set("media"), keys: set("keys") }), [set]);
  const tile = (k: keyof typeof count) => (count[k] === undefined ? "—" : count[k]!);
  return (
    <TabPage className={css.page}>
      <TabZone label={L("Website content", "Kandungan laman web")}>
        <KpiRow label={L("Website content figures", "Angka kandungan laman web")} testid="website-strip">
          <KpiTile icon="edit" tone="navy" label={L("Content Keys", "Kunci Kandungan")} busy={count.keys === undefined} value={tile("keys")} sub={L("Website text set", "Teks laman web ditetapkan")} onClick={() => setView("keys")} pressed={view === "keys"} testid="tile-keys" />
          <KpiTile icon="document" tone="blue" label={L("Posts", "Kiriman")} busy={count.posts === undefined} value={tile("posts")} onClick={() => setView("posts")} pressed={view === "posts"} testid="tile-posts" />
          <KpiTile icon="clients" tone="gold" label={L("Portfolio", "Portfolio")} busy={count.portfolio === undefined} value={tile("portfolio")} onClick={() => setView("portfolio")} pressed={view === "portfolio"} testid="tile-portfolio" />
          <KpiTile icon="chat" tone="purple" label={L("Testimonials", "Testimoni")} busy={count.testimonials === undefined} value={tile("testimonials")} onClick={() => setView("testimonials")} pressed={view === "testimonials"} testid="tile-testimonials" />
          <KpiTile icon="upload" tone="green" label={L("Media Files", "Fail Media")} busy={count.media === undefined} value={tile("media")} onClick={() => setView("media")} pressed={view === "media"} testid="tile-media" />
        </KpiRow>
      </TabZone>
      <LineTabs<View> value={view} onChange={setView} label={L("Website content", "Kandungan laman web")} testid="website-view"
        tabs={[["text", L("Website Text", "Teks Laman Web")], ["posts", L("Posts", "Kiriman")], ["portfolio", L("Portfolio", "Portfolio")], ["testimonials", L("Testimonials", "Testimoni")], ["media", L("Media", "Media")], ["keys", L("Advanced Keys", "Kunci Lanjutan")]]} />
      {/* every view stays mounted (hidden, never unmounted): a half-written post survives a look at the media */}
      <div hidden={view !== "text"} data-testid="view-text"><SiteEditor /></div>
      <div hidden={view !== "posts"} data-testid="view-posts">
        <ContentList resource="posts" titleKey="title" noun={["Post", "Kiriman"]} onCount={setters.posts} fields={[
          { key: "slug", label: L("Slug (unique)", "Slug (unik)") },
          { key: "title", label: L("Title", "Tajuk") },
          { key: "excerpt", label: L("Excerpt", "Petikan"), type: "textarea" },
          { key: "body", label: L("Body", "Isi kandungan"), type: "textarea" },
          { key: "status", label: L("Status (draft/scheduled/published)", "Status (draft/scheduled/published)") },
          { key: "category", label: L("Category", "Kategori") },
        ]} />
      </div>
      <div hidden={view !== "portfolio"} data-testid="view-portfolio">
        <ContentList resource="portfolio" titleKey="client" noun={["Portfolio item", "Item portfolio"]} onCount={setters.portfolio} fields={[
          { key: "client", label: L("Client", "Pelanggan") },
          { key: "summary", label: L("Summary", "Ringkasan"), type: "textarea" },
          { key: "result", label: L("Result", "Hasil") },
          { key: "is_published", label: L("Published", "Diterbitkan"), type: "checkbox" },
        ]} />
      </div>
      <div hidden={view !== "testimonials"} data-testid="view-testimonials">
        <ContentList resource="testimonials" titleKey="author" noun={["Testimonial", "Testimoni"]} onCount={setters.testimonials} fields={[
          { key: "author", label: L("Author", "Penulis") },
          { key: "company", label: L("Company", "Syarikat") },
          { key: "position", label: L("Position", "Jawatan") },
          { key: "review", label: L("Review", "Ulasan"), type: "textarea" },
          { key: "rating", label: L("Rating (1–5)", "Penilaian (1–5)"), type: "number" },
          { key: "is_published", label: L("Published", "Diterbitkan"), type: "checkbox" },
        ]} />
      </div>
      <div hidden={view !== "media"} data-testid="view-media"><MediaLibrary onCount={setters.media} /></div>
      <div hidden={view !== "keys"} data-testid="view-keys"><ContentKeys onCount={setters.keys} /></div>
    </TabPage>
  );
}

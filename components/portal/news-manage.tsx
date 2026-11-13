"use client";

/* v1.295.0 - NEWS v2.0, RELEASE N1: PUBLISH & MANAGE and REPORTS & ARCHIVE
   (CEO directive 12-11-2026; claude/NEWS-V2-AUDIT.md). Management only: the
   page draws these for `can_publish`, and the server refuses every route
   below without team_manage whatever the page does.

   Over the routes that already exist (worker/src/news.ts), unchanged:
     POST   /staff/announcements           publish (the server signs it)
     PATCH  /staff/announcements/:id       edit - a change of words is a new
                                           version and asks again
     POST/DELETE  .../:id/files            attachments (PDF, JPEG, PNG, WebP)
     GET    /staff/announcements/report    each post's completion
     GET    /staff/announcements/:id/acks  who has and has not acknowledged

   What N1 adds is on the page only: the composer in sections with a desktop
   and phone preview, a draft kept on THIS device until it is published, a
   warning before unsaved words are lost, a confirmation that says who will
   be notified, one press per publish; the posts list with search and
   filters; the report's strip, filters, paging and CSV exports. Drafts on the
   server, scheduling, optional acknowledgement and archiving need the N2
   data change, which waits for the CEO - nothing here pretends to them. */

import { useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Announcement, L } from "@/components/portal/page-shared";
import { CATS, Chip, MemoBody, NewsEmpty, NewsFilterBar, NewsPager, NewsStats, catL, todayMalay } from "@/components/portal/news-parts";
import { api, csrfFetch } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { downloadCsv } from "@/lib/csv";
import { dmyMYT } from "@/lib/format";
import { btnSm, btnSmPrimary, card, inputClass } from "@/lib/ui-styles";
import css from "./announcements.module.css";

const API = "/api/v1/staff";
const DRAFT_KEY = "a2z:news-draft";

type Form = { category: string; title: string; body: string; to: string; memo_date: string; important: boolean; pinned: boolean; audience: string[] };
const blank = (): Form => ({ category: "news", title: "", body: "", to: L("All staff", "Semua kakitangan"), memo_date: todayMalay(), important: false, pinned: false, audience: [] });
const readDraft = (): Form | null => {
  try { const raw = window.localStorage.getItem(DRAFT_KEY); return raw ? { ...blank(), ...(JSON.parse(raw) as Partial<Form>) } : null; } catch { return null; }
};
const writeDraft = (f: Form | null) => {
  try { if (f) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); else window.localStorage.removeItem(DRAFT_KEY); } catch { /* private mode: the words stay on screen */ }
};

/* the three calls the composer makes, each only when a button is pressed
   (publish / save, attach, remove) - never when the form mounts */
function sendPost(id: number | null, payload: Record<string, unknown>) {
  return id === null
    ? api<{ id?: number; recipients?: number; error?: { message?: string } }>(`/staff/announcements`, { method: "POST", body: JSON.stringify(payload) })
    : api<{ version?: number; error?: { message?: string } }>(`/staff/announcements/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}
async function uploadFiles(id: number, files: File[]) {
  let bad = 0;
  for (const file of files) {
    const r = await csrfFetch(`${API}/announcements/${id}/files`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": file.name }, body: file });
    if (!r.ok) bad++;
  }
  return bad;
}
const removeFileCall = (id: number, fid: number) => api(`/staff/announcements/${id}/files/${fid}`, { method: "DELETE" });

/** The composer: publish, or edit one post. The publisher is never typed - the server signs it. */
export function PostForm({ edit, departments, onDone, onDirty }: {
  edit?: Announcement; departments: string[];
  onDone: (msg: string) => void;
  /** told whenever the form starts or stops holding unsaved words */
  onDirty?: (dirty: boolean) => void;
}) {
  const start = useMemo<Form>(() => edit ? {
    category: edit.category, title: edit.title, body: edit.body, to: edit.to_line ?? "", memo_date: edit.memo_date ?? todayMalay(),
    important: !!edit.important, pinned: !!edit.pinned, audience: edit.audience ?? [],
  } : blank(), [edit]);
  const [f, setF] = useState<Form>(start);
  const [restored, setRestored] = useState<Form | null>(() => (edit ? null : typeof window === "undefined" ? null : readDraft()));
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const pressed = useRef(false);
  const [msg, setMsg] = useState("");
  const [shownOn, setShownOn] = useState<"desktop" | "phone">("desktop");
  const { confirm, node: confirmNode } = useConfirm();
  const memo = f.category === "memo";
  const left = 5000 - f.body.length;
  const dirty = JSON.stringify(f) !== JSON.stringify(start) || files.length > 0;
  const problem = !f.title.trim() ? L("Write a subject.", "Tulis perkara.") : !f.body.trim() ? L("Write the announcement.", "Tulis pengumuman.") : left < 0 ? L("The announcement is too long.", "Pengumuman terlalu panjang.") : "";

  /* the form says when it holds unsaved words; the browser asks before a
     reload or a closed tab throws them away */
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  /* a new post's words are kept on this device while they are written */
  useEffect(() => {
    if (edit || restored) return;
    const t = window.setTimeout(() => writeDraft(f.title.trim() || f.body.trim() ? f : null), 600);
    return () => window.clearTimeout(t);
  }, [f, edit, restored]);

  const who = f.audience.length ? L(`the ${f.audience.join(", ")} department${f.audience.length > 1 ? "s" : ""}`, `jabatan ${f.audience.join(", ")}`) : L("all staff", "semua kakitangan");
  const save = async () => {
    if (problem) { setMsg(problem); return; }
    if (busy || pressed.current) return;
    pressed.current = true;
    const ok = await confirm(edit
      ? { title: L("Save the changes?", "Simpan perubahan?"), message: L("If the subject, text, category, To or date changed, this becomes a new version and everyone it is for is asked to acknowledge again. What they acknowledged before stays on record.", "Jika perkara, teks, kategori, Kepada atau tarikh berubah, ia menjadi versi baharu dan semua penerima diminta memperakui semula. Perakuan lama kekal direkod."), confirmLabel: L("Save changes", "Simpan perubahan") }
      : { title: L("Publish this announcement?", "Terbitkan pengumuman ini?"), message: L(`It goes to ${who} now. Each of them is notified and asked to acknowledge it.`, `Ia dihantar kepada ${who} sekarang. Setiap penerima dimaklumkan dan diminta memperakuinya.`), confirmLabel: L("Publish", "Terbitkan") });
    if (!ok) { pressed.current = false; return; }
    setBusy(true); setMsg("");
    const payload = { category: f.category, title: f.title, body: f.body, to: f.to, memo_date: memo ? f.memo_date : null,
      important: f.important, pinned: f.pinned, audience: f.audience.length ? f.audience : null, ...(edit ? { version: edit.version ?? 1 } : {}) };
    const r = await sendPost(edit?.id ?? null, payload);
    if (!r.ok) {
      setBusy(false); pressed.current = false;
      /* the words stay: a failed publish never clears the form */
      setMsg(r.status === 0 ? L("No connection - nothing was published.", "Tiada sambungan - tiada apa diterbitkan.") : (r.data as { error?: { message?: string } })?.error?.message ?? L("Not saved.", "Tidak disimpan."));
      return;
    }
    const id = edit ? edit.id : (r.data as { id?: number }).id;
    const bad = id && files.length ? await uploadFiles(id, files) : 0;
    setBusy(false); pressed.current = false;
    const title = f.title;
    if (!edit) { setF(blank()); writeDraft(null); }
    setFiles([]);
    const rec = (r.data as { recipients?: number }).recipients;
    onDone(`${title}${rec !== undefined ? ` · ${L(`${rec} recipients`, `${rec} penerima`)}` : ""}${bad ? ` · ${L(`${bad} file(s) not attached`, `${bad} fail tidak dilampirkan`)}` : ""}`);
  };
  const removeFile = async (fid: number) => {
    if (!edit) return;
    if (!(await confirm({ title: L("Remove this file?", "Buang fail ini?"), message: L("It stops showing on the post. The removal is recorded.", "Ia tidak lagi dipaparkan pada hantaran. Pembuangan direkod."), confirmLabel: L("Remove", "Buang"), variant: "danger" }))) return;
    const r = await removeFileCall(edit.id, fid);
    if (r.ok) onDone(L("File removed", "Fail dibuang"));
    else setMsg(r.status === 0 ? L("No connection - the file was not removed.", "Tiada sambungan - fail tidak dibuang.") : L("The file was not removed.", "Fail tidak dibuang."));
  };

  return (
    <div className={css.composer} data-testid={edit ? "news-edit-form" : "news-compose"}>
      {confirmNode}
      {restored && (
        <div className="erp-note erp-note-info" role="status" data-testid="news-draft-found">
          {L(`An unpublished draft is kept on this device: "${restored.title || L("untitled", "tanpa tajuk")}".`, `Draf yang belum diterbitkan disimpan pada peranti ini: "${restored.title || "tanpa tajuk"}".`)}{" "}
          <button type="button" className={btnSm} onClick={() => { setF(restored); setRestored(null); }}>{L("Continue the draft", "Teruskan draf")}</button>{" "}
          <button type="button" className={btnSm} onClick={() => { writeDraft(null); setRestored(null); }}>{L("Discard it", "Buang")}</button>
        </div>
      )}
      <div className={css.composerGrid}>
        <div className={css.form}>
          <fieldset className={css.section}>
            <legend>{L("Basic information", "Maklumat asas")}</legend>
            <div className={css.grid2}>
              <label className={css.field}><span>{L("Category", "Kategori")}</span>
                <select className={inputClass} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{catL(c)}</option>)}</select>
              </label>
              <label className={css.field}><span>{memo ? "Perkara (Subject)" : L("Subject", "Perkara")} *</span>
                <input className={inputClass} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-required="true" />
              </label>
              <label className={css.field}><span>{memo ? "Kepada (To)" : L("To", "Kepada")}</span>
                <input className={inputClass} maxLength={120} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
              </label>
              <div className={css.field}><span>{memo ? "Daripada (From)" : L("From", "Daripada")}</span>
                <p className={css.fromLine}>{edit?.from_name ?? L("You - signed with your name and position when published", "Anda - ditandatangani dengan nama dan jawatan anda semasa diterbitkan")}</p>
              </div>
              {memo && <label className={css.field}><span>Tarikh</span><input className={inputClass} maxLength={40} value={f.memo_date} onChange={(e) => setF({ ...f, memo_date: e.target.value })} /></label>}
            </div>
            <label className={css.field}><span>{memo ? "Kandungan memo" : L("Announcement", "Pengumuman")} *</span>
              <textarea className={inputClass} rows={memo ? 10 : 8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} aria-required="true"
                placeholder={memo ? "Guna * di awal baris untuk senarai, dan 'Label: nilai' untuk baris tebal" : L("Start a line with * for a bullet, and 'Label: value' for a bold label", "Mulakan baris dengan * untuk senarai, dan 'Label: nilai' untuk label tebal")} />
              <span className={left < 0 ? css.over : css.meta}>{L(`${left} characters left · text only, never HTML`, `${left} aksara lagi · teks sahaja, bukan HTML`)}</span>
            </label>
          </fieldset>
          <fieldset className={css.section}>
            <legend>{L("Audience", "Penerima")}</legend>
            <div className={css.audience}>
              <label className={css.check}><input type="checkbox" checked={f.audience.length === 0} onChange={() => setF({ ...f, audience: [] })} /> {L("All staff", "Semua kakitangan")}</label>
              {departments.map((d) => (
                <label key={d} className={css.check}><input type="checkbox" checked={f.audience.includes(d)}
                  onChange={(e) => setF({ ...f, audience: e.target.checked ? [...f.audience, d] : f.audience.filter((x) => x !== d) })} /> {d}</label>
              ))}
            </div>
            <p className={css.meta}>{L("The server works out who is in the audience; the publisher and anyone who joins later are not asked to acknowledge.", "Pelayan menentukan siapa penerima; penerbit dan sesiapa yang menyertai kemudian tidak diminta memperakui.")}</p>
          </fieldset>
          <fieldset className={css.section}>
            <legend>{L("Publishing", "Penerbitan")}</legend>
            <div className={css.flags}>
              <label className={css.check}><input type="checkbox" checked={f.important} onChange={(e) => setF({ ...f, important: e.target.checked })} /> {L("Important", "Penting")}</label>
              <label className={css.check}><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> {L("Pin to the top", "Semat di atas")}</label>
            </div>
            <p className={css.meta}>{L("Every post asks its recipients to acknowledge it, and is published when you press Publish. Scheduling, optional acknowledgement with a deadline, server drafts and archiving arrive with release N2.", "Setiap hantaran meminta penerima memperakuinya, dan diterbitkan apabila anda menekan Terbitkan. Penjadualan, perakuan pilihan dengan tarikh akhir, draf pelayan dan arkib akan datang dalam keluaran N2.")}</p>
            <div className={css.field}><span>{L("Attachments (PDF, JPEG, PNG, WebP - up to 10 MB, 5 files)", "Lampiran (PDF, JPEG, PNG, WebP - sehingga 10 MB, 5 fail)")}</span>
              {edit && (edit.files?.length ?? 0) > 0 && (
                <ul className={css.files}>{edit.files!.map((x) => <li key={x.id}><span>{x.filename}</span> <button type="button" className={btnSm} onClick={() => void removeFile(x.id)}>{L("Remove", "Buang")}</button></li>)}</ul>
              )}
              <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 5))} />
              {files.length > 0 && <span className={css.meta}>{files.map((x) => x.name).join(", ")}</span>}
            </div>
          </fieldset>
          {msg && <p className="erp-note erp-note-warning" role="alert">{msg}</p>}
          <div className={css.foot}>
            {!edit && dirty && <span className={css.meta} data-testid="news-draft-saved">{L("Draft kept on this device", "Draf disimpan pada peranti ini")}</span>}
            <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void save()}>{busy ? L("Saving…", "Menyimpan…") : edit ? L("Save changes", "Simpan perubahan") : L("Publish", "Terbitkan")}</button>
          </div>
        </div>
        <section className={css.previewPane} aria-label={L("Preview", "Pratonton")} data-testid="news-preview">
          <div className={css.previewHead}>
            <strong>{L("Preview", "Pratonton")}</strong>
            <div className={css.seg} role="group" aria-label={L("Preview size", "Saiz pratonton")}>
              <button type="button" aria-pressed={shownOn === "desktop"} onClick={() => setShownOn("desktop")}>{L("Desktop", "Desktop")}</button>
              <button type="button" aria-pressed={shownOn === "phone"} onClick={() => setShownOn("phone")}>{L("Phone", "Telefon")}</button>
            </div>
          </div>
          <div className={css.previewFrame} data-size={shownOn}>
            <div className={css.postTop}>
              {f.pinned && <Chip tone="gold">{L("Pinned", "Disemat")}</Chip>}
              {f.important && <Chip tone="red">{L("Important", "Penting")}</Chip>}
              <Chip tone="blue">{catL(f.category)}</Chip>
            </div>
            <strong className={css.postTitle}>{f.title || L("Your subject appears here", "Perkara anda dipaparkan di sini")}</strong>
            <p className={css.meta}>{L(`For ${who}`, `Untuk ${who}`)}</p>
            {f.body.trim() ? <MemoBody body={f.body} /> : <p className={css.meta}>{L("The announcement appears here as staff will read it.", "Pengumuman dipaparkan di sini seperti yang akan dibaca kakitangan.")}</p>}
          </div>
        </section>
      </div>
      {edit && <p className={css.meta}>{L("Changing the subject, the text, the category, To or the date makes a new version: everyone it is for is asked to acknowledge again, and what they acknowledged before stays on record. Pinning, Important and the departments do not.", "Menukar perkara, teks, kategori, Kepada atau tarikh menjadikan versi baharu: semua penerima diminta memperakui semula, dan perakuan lama kekal direkod. Semat, Penting dan jabatan tidak.")}</p>}
    </div>
  );
}

/* ---------------- the posts, for management ---------------- */
export function ManageList({ anns, loaded, v2, onEdit, onPreview, onReport }: {
  anns: Announcement[]; loaded: boolean; v2: boolean;
  onEdit: (id: number) => void; onPreview: (id: number) => void; onReport: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [flag, setFlag] = useState("");
  const [page, setPage] = useState(0);
  const needle = q.trim().toLowerCase();
  const rows = anns.filter((a) => (!cat || a.category === cat) && (!flag || (flag === "pinned" ? !!a.pinned : flag === "important" ? !!a.important : (a.version ?? 1) > 1))
    && (!needle || `${a.title} ${a.body} ${a.publisher_name ?? ""}`.toLowerCase().includes(needle)));
  const PER = 15;
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  const at = Math.min(page, pages - 1);
  return (
    <section className={card} aria-label={L("Announcements", "Pengumuman")} data-testid="news-manage">
      <div className={css.head}>
        <h3 className={css.h3}><AppIcon name="edit" />{L("Announcements", "Pengumuman")} <span className={css.count}>{loaded ? anns.length : ""}</span></h3>
      </div>
      <p className={css.meta}>{L("Every post here is published. Drafts, scheduled and archived posts need the N2 data change, which waits for the CEO's approval.", "Setiap hantaran di sini telah diterbitkan. Draf, hantaran berjadual dan arkib memerlukan perubahan data N2, yang menunggu kelulusan CEO.")}</p>
      <NewsFilterBar q={q} onQ={(v) => { setQ(v); setPage(0); }} placeholder={L("Search posts", "Cari hantaran")} selects={[
        { key: "mcat", label: L("Category", "Kategori"), value: cat, onChange: (v) => { setCat(v); setPage(0); }, options: [["", L("All categories", "Semua kategori")], ...CATS.map((c) => [c, catL(c)] as [string, string])] },
        { key: "mflag", label: L("Flag", "Tanda"), value: flag, onChange: (v) => { setFlag(v); setPage(0); }, options: [["", L("All posts", "Semua hantaran")], ["pinned", L("Pinned", "Disemat")], ["important", L("Important", "Penting")], ["revised", L("Revised", "Disemak semula")]] },
      ]} />
      {!loaded ? <SkelRows rows={4} /> : rows.length === 0 ? <NewsEmpty>{anns.length === 0 ? L("Nothing published yet.", "Belum ada yang diterbitkan.") : L("Nothing matches.", "Tiada yang sepadan.")}</NewsEmpty> : (
        <>
          <ul className={css.manage}>
            {rows.slice(at * PER, at * PER + PER).map((a) => (
              <li key={a.id} data-testid="news-manage-row">
                <span className={css.mTitle}><strong>{a.title}</strong><span>{catL(a.category)} · {dmyMYT(a.created_at).slice(0, 10)} · {a.publisher_name ?? "—"}{(a.version ?? 1) > 1 ? ` · v${a.version}` : ""}{a.audience?.length ? ` · ${a.audience.join(", ")}` : ""}</span></span>
                <span className={css.chips}><Chip tone="green">{L("Published", "Diterbitkan")}</Chip>{a.pinned ? <Chip tone="gold">{L("Pinned", "Disemat")}</Chip> : null}{a.important ? <Chip tone="red">{L("Important", "Penting")}</Chip> : null}</span>
                <span className={css.rowActions}>
                  <button type="button" className={btnSm} onClick={() => onPreview(a.id)}>{L("Preview", "Pratonton")}</button>
                  <button type="button" className={btnSm} onClick={() => onReport(a.id)}>{L("Report", "Laporan")}</button>
                  <button type="button" className={btnSm} onClick={() => onEdit(a.id)} disabled={!v2}>{L("Edit", "Sunting")}</button>
                </span>
              </li>
            ))}
          </ul>
          <NewsPager page={at} pages={pages} total={rows.length} per={PER} onPage={setPage} />
        </>
      )}
    </section>
  );
}

/* ---------------- Reports & Archive ---------------- */
type ReportRow = { id: number; title: string; category: string; version: number; created_at: string; publisher_name: string | null; audience: string[] | null; important: number; pinned: number; recipients: number; acknowledged: number };
export function Reports({ onOpen }: { onOpen: (id: number) => void }) {
  const rep = useCachedApi<{ posts: ReportRow[] }>("/staff/announcements/report", true, ["announcements"]);
  const all = useMemo(() => rep.data?.posts ?? [], [rep.data]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(0);
  const needle = q.trim().toLowerCase();
  const rows = all.filter((p) => (!cat || p.category === cat) && (!needle || `${p.title} ${p.publisher_name ?? ""}`.toLowerCase().includes(needle))
    && (!state || (state === "done" ? p.recipients > 0 && p.acknowledged >= p.recipients : state === "open" ? p.acknowledged < p.recipients : p.recipients === 0)));
  const sum = (k: "recipients" | "acknowledged") => all.reduce((n, p) => n + p[k], 0);
  const PER = 15;
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  const at = Math.min(page, pages - 1);
  const exportCsv = () => downloadCsv(`news-acknowledgement-report-${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}${cat ? `-${cat}` : ""}${state ? `-${state}` : ""}.csv`, [
    ["Title", "Category", "Published", "Publisher", "Version", "Audience", "Important", "Pinned", "Recipients", "Acknowledged", "Outstanding", "Completion %"],
    ...rows.map((p) => [p.title, catL(p.category), dmyMYT(p.created_at), p.publisher_name ?? "", p.version, p.audience?.join("; ") ?? "All staff", p.important ? "Yes" : "No", p.pinned ? "Yes" : "No",
      p.recipients, p.acknowledged, Math.max(0, p.recipients - p.acknowledged), p.recipients ? Math.round((p.acknowledged / p.recipients) * 100) : ""]),
  ]);
  return (
    <>
      <NewsStats label={L("Acknowledgement summary", "Ringkasan perakuan")} busy={rep.loading} stats={[
        { key: "published", icon: "document", tone: "blue", value: all.length, label: L("Published", "Diterbitkan"), sub: L("posts on record", "hantaran direkod") },
        { key: "required", icon: "pending", tone: "gold", value: all.filter((p) => p.recipients > 0).length, label: L("To acknowledge", "Perlu perakuan"), sub: L("posts with recipients", "hantaran dengan penerima") },
        { key: "expected", icon: "users", tone: "purple", value: sum("recipients"), label: L("Expected", "Dijangka"), sub: L("acknowledgements across posts", "perakuan merentas hantaran") },
        { key: "ackedAll", icon: "success", tone: "green", value: sum("acknowledged"), label: L("Acknowledged", "Diperakui"), sub: L("of the version that stands", "versi semasa") },
        { key: "outstanding", icon: "warning", tone: "red", value: Math.max(0, sum("recipients") - sum("acknowledged")), label: L("Outstanding", "Belum"), sub: L("still to acknowledge", "belum diperakui") },
      ]} />
      <section className={card} aria-label={L("Acknowledgement report", "Laporan perakuan")} data-testid="news-report">
        <div className={css.head}>
          <h3 className={css.h3}><AppIcon name="chart" />{L("Acknowledgement report", "Laporan perakuan")}</h3>
          <button type="button" className={btnSm} onClick={exportCsv} disabled={rows.length === 0} data-testid="news-report-csv"><AppIcon name="download" />{L("Export CSV", "Eksport CSV")}</button>
        </div>
        <p className={css.meta}>{L("Every post, newest first: who it is for today and how many have acknowledged the version that stands. Read from the posts and acknowledgements themselves.", "Setiap hantaran, terbaharu dahulu: untuk siapa hari ini dan berapa ramai telah memperakui versi semasa. Dibaca terus daripada hantaran dan perakuan.")}</p>
        <NewsFilterBar q={q} onQ={(v) => { setQ(v); setPage(0); }} placeholder={L("Search the report", "Cari dalam laporan")} selects={[
          { key: "rcat", label: L("Category", "Kategori"), value: cat, onChange: (v) => { setCat(v); setPage(0); }, options: [["", L("All categories", "Semua kategori")], ...CATS.map((c) => [c, catL(c)] as [string, string])] },
          { key: "rstate", label: L("Completion", "Penyiapan"), value: state, onChange: (v) => { setState(v); setPage(0); }, options: [["", L("Any completion", "Semua")], ["open", L("Outstanding", "Belum selesai")], ["done", L("Complete", "Selesai")], ["none", L("No recipients", "Tiada penerima")]] },
        ]} />
        {rep.loading ? <SkelRows rows={5} /> : rep.failed && !rep.data ? <p className="erp-note erp-note-warning" role="alert">{L("The report could not be loaded. Try again shortly.", "Laporan tidak dapat dimuatkan. Cuba sebentar lagi.")}</p>
          : rows.length === 0 ? <NewsEmpty>{all.length === 0 ? L("Nothing published yet.", "Belum ada yang diterbitkan.") : L("Nothing matches.", "Tiada yang sepadan.")}</NewsEmpty> : (
          <>
            <div className={css.reportHead} aria-hidden><span>{L("Announcement", "Pengumuman")}</span><span>{L("Completion", "Penyiapan")}</span><span /></div>
            <ul className={css.report}>
              {rows.slice(at * PER, at * PER + PER).map((p) => {
                const pct = p.recipients ? Math.round((p.acknowledged / p.recipients) * 100) : 100;
                return (
                  <li key={p.id} data-testid="news-report-row">
                    <span className={css.mTitle}><strong>{p.title}</strong>
                      <span>{catL(p.category)} · {dmyMYT(p.created_at).slice(0, 10)} · {p.publisher_name ?? "—"}{p.version > 1 ? ` · v${p.version}` : ""}{p.audience ? ` · ${p.audience.join(", ")}` : ""}</span></span>
                    <span className={css.progress}>
                      <span className={css.bar} role="img" aria-label={L(`${p.acknowledged} of ${p.recipients} acknowledged`, `${p.acknowledged} daripada ${p.recipients} diperakui`)}><span style={{ width: `${pct}%` }} /></span>
                      <span className={css.meta}>{p.recipients ? L(`${p.acknowledged} of ${p.recipients} · ${pct}%`, `${p.acknowledged} daripada ${p.recipients} · ${pct}%`) : L("No recipients", "Tiada penerima")}</span>
                    </span>
                    <button type="button" className={btnSm} onClick={() => onOpen(p.id)}>{L("Who", "Siapa")}</button>
                  </li>
                );
              })}
            </ul>
            <NewsPager page={at} pages={pages} total={rows.length} per={PER} onPage={setPage} />
          </>
        )}
        <p className={css.meta}>{L("Archive: every post stays here and in the feed; nothing is deleted. Recipients are worked out from today's staff list until the N2 snapshot exists.", "Arkib: setiap hantaran kekal di sini dan dalam suapan; tiada yang dipadam. Penerima dikira daripada senarai kakitangan hari ini sehingga snapshot N2 wujud.")}</p>
      </section>
    </>
  );
}

type AckRow = { id: number; name: string; department: string | null; acked_at: string | null; last_version: number | null };
export function AckReport({ id, onClose }: { id: number | null; onClose: () => void }) {
  const r = useCachedApi<{ title: string; version: number; total: number; acknowledged: number; recipients: AckRow[] }>(
    id === null ? null : `/staff/announcements/${id}/acks`, id !== null, ["announcements"]);
  const d = r.data;
  const [dept, setDept] = useState("");
  const list = (d?.recipients ?? []).filter((x) => !dept || (x.department ?? "") === dept);
  const not = list.filter((x) => !x.acked_at);
  const yes = list.filter((x) => x.acked_at);
  const depts = [...new Set((d?.recipients ?? []).map((x) => x.department ?? "").filter(Boolean))].sort();
  const exportCsv = () => d && downloadCsv(`news-recipients-${id}-v${d.version}.csv`, [
    ["Name", "Department", "Status", "Acknowledged at (MYT)", "Last version acknowledged", "Current version"],
    ...list.map((x) => [x.name, x.department ?? "", x.acked_at ? "Acknowledged" : x.last_version ? "Acknowledged an earlier version" : "Not yet", x.acked_at ? dmyMYT(x.acked_at) : "", x.last_version ?? "", d.version]),
  ]);
  return (
    <SideDrawer open={id !== null} onClose={onClose} title={d?.title ?? L("Acknowledgements", "Perakuan")}
      subtitle={d ? L(`${d.acknowledged} of ${d.total} acknowledged · version ${d.version}`, `${d.acknowledged} daripada ${d.total} diperakui · versi ${d.version}`) : undefined}
      footer={d ? <button type="button" className={btnSm} onClick={exportCsv} data-testid="news-recipients-csv"><AppIcon name="download" />{L("Export recipients (CSV)", "Eksport penerima (CSV)")}</button> : undefined}>
      {!d ? (r.failed ? <p className="erp-note erp-note-warning" role="alert">{L("The recipients could not be loaded.", "Penerima tidak dapat dimuatkan.")}</p> : <SkelRows rows={5} />) : (
        <div className={css.drawer} data-testid="news-recipients">
          {depts.length > 1 && (
            <select className={inputClass} value={dept} onChange={(e) => setDept(e.target.value)} aria-label={L("Department", "Jabatan")}>
              <option value="">{L("All departments", "Semua jabatan")}</option>
              {depts.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          <p className={css.drawerHead}>{L(`Not yet (${not.length})`, `Belum (${not.length})`)}</p>
          {not.length === 0 ? <p className={css.empty}>{L("Everyone has acknowledged.", "Semua telah memperakui.")}</p> : (
            <ul className={css.people}>{not.map((x) => <li key={x.id}><span>{x.name}</span><span className={css.meta}>{x.department ?? "—"}{x.last_version ? ` · ${L(`acknowledged v${x.last_version}`, `memperakui v${x.last_version}`)}` : ""}</span></li>)}</ul>
          )}
          <p className={css.drawerHead}>{L(`Acknowledged (${yes.length})`, `Diperakui (${yes.length})`)}</p>
          <ul className={css.people}>{yes.map((x) => <li key={x.id}><span>{x.name}</span><span className={css.meta}>{x.department ?? "—"} · v{d.version} · {dmyMYT(x.acked_at!)}</span></li>)}</ul>
        </div>
      )}
    </SideDrawer>
  );
}

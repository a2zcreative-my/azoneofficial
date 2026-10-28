"use client";

/* v1.217.0 - NEWS & ANNOUNCEMENTS 2.0 (the owner's brief, 28-10-2026, and his
   answers to claude/NEWS-ANNOUNCEMENTS-AUDIT.md). Four tabs over the one
   announcement record (worker/src/news.ts):

     News Feed            every post for you, pinned first; search, category
     My Acknowledgements  what waits on you, what you acknowledged (with your
                          time and version), and history (posts from before
                          you joined, and your own)
     Publish & Manage     management: publish, edit (a change of words is a
                          new version), pin, mark important, choose the
                          departments, attach files
     Reports & Archive    management: every post's completion and who has
                          not acknowledged

   Acknowledging is only ever the button in a post's drawer, and it sends the
   version the drawer showed: if the post changed meanwhile the server says
   so and nothing is saved. The publisher is the person signed in (the
   server's from_name), never a box anybody types. Bodies are text, never
   HTML. Before v1.217.0 this file was the v1.114.0 move from page.tsx;
   MemoBody keeps its v1.4.215 reading of "Label: value" and "* " lines. */
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelCard, SkelRows, StaleHint } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { Announcement, L, MANAGE_ROLES, User } from "@/components/portal/page-shared";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { api, csrfFetch } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { dmyMYT } from "@/lib/format";
import { useRecordFocus, type RecordFocus } from "@/lib/record-focus";
import { btnSm, btnSmPrimary, card, inputClass } from "@/lib/ui-styles";
import { ReactNode, useMemo, useState } from "react";
import css from "./announcements.module.css";

/* v1.4.215 (CEO pasted his real internal memo): Malay month names for the
   memo's default Tarikh line. */
export const MS_MONTHS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
export const todayMalay = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCDate()} ${MS_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/* v1.4.215: renders an announcement body the way the CEO's memo reads -
   "Label: value" lines get a bold label, consecutive "* " lines become a
   real bullet list, everything else stays a paragraph. Text nodes only. */
export function MemoBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length > 0) {
      out.push(<ul key={`ul${out.length}`} className={css.bullets}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
      bullets = [];
    }
  };
  lines.forEach((ln, i) => {
    const bullet = ln.match(/^\s*[*•-]\s+(.*)$/);
    if (bullet) { bullets.push(bullet[1]!); return; }
    flush();
    const label = ln.match(/^([A-Za-z][A-Za-z\s()\/&]{1,30}):\s+(.+)$/);
    if (label && !label[2]!.startsWith("//")) out.push(<p key={i}><span className={css.label}>{label[1]}:</span> {label[2]}</p>);
    else if (ln.trim() === "") out.push(<div key={i} className={css.gap} />);
    else out.push(<p key={i}>{ln}</p>);
  });
  flush();
  return <div className={css.body}>{out}</div>;
}

const CATS = ["news", "meeting", "holiday", "kpi", "training", "memo"] as const;
const CAT_LABEL: Record<string, [string, string]> = {
  news: ["News", "Berita"], meeting: ["Meeting", "Mesyuarat"], holiday: ["Holiday", "Cuti umum"],
  kpi: ["KPI", "KPI"], training: ["Training", "Latihan"], memo: ["Memo", "Memo"],
};
const catL = (c: string) => L(...(CAT_LABEL[c] ?? [c, c]));
type View = "feed" | "mine" | "publish" | "reports";
type Feed = { announcements: Announcement[]; can_publish?: boolean; departments?: string[]; pending_migration?: boolean };
const API = "/api/v1/staff";

/** The header lines of a post published from v1.217.0 (older posts carry them in the body). */
function headLines(a: Announcement): [string, string][] {
  if (!a.from_name) return [];
  const memo = a.category === "memo";
  const out: [string, string][] = [];
  if (a.to_line) out.push([memo ? "Kepada" : L("To", "Kepada"), a.to_line]);
  out.push([memo ? "Daripada" : L("From", "Daripada"), a.from_name]);
  if (memo && a.memo_date) out.push(["Tarikh", a.memo_date]);
  if (memo) out.push(["Perkara", a.title]);
  return out;
}
const needs = (a: Announcement) => (a.required ?? 1) === 1 && !a.acked;
const preview = (body: string) => body.replace(/^(To|From|Kepada|Daripada|Tarikh|Perkara):.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 180);

export function Announcements({ user, focus }: { user: User; focus?: RecordFocus | null }) {
  const feed = useCachedApi<Feed>("/staff/announcements", true, ["announcements"]);
  const anns = useMemo(() => feed.data?.announcements ?? [], [feed.data]);
  const loaded = !feed.loading;
  const canPost = feed.data?.can_publish ?? MANAGE_ROLES.includes(user.role);
  const v2 = loaded && !feed.data?.pending_migration;
  const [view, setView] = useState<View>("feed");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [reportId, setReportId] = useState<number | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();

  /* the bell's "announcement:<id>" opens that post (lib/record-focus.ts) */
  useRecordFocus(focus, loaded, (f) => { if (f.kind === "announcement") { setView("feed"); setOpenId(f.id); } });

  const toAck = anns.filter(needs);
  const acked = anns.filter((a) => a.acked);
  const shown = anns.filter((a) => (!cat || a.category === cat)
    && (!q.trim() || `${a.title} ${a.body} ${a.publisher_name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const open = openId === null ? null : anns.find((a) => a.id === openId) ?? null;
  const editing = editId === null ? null : anns.find((a) => a.id === editId) ?? null;

  const tabs: [View, string][] = [
    ["feed", L("News Feed", "Suapan Berita")],
    ["mine", L("My Acknowledgements", "Perakuan Saya")],
    ...(canPost ? ([["publish", L("Publish & Manage", "Terbit & Urus")], ["reports", L("Reports & Archive", "Laporan & Arkib")]] as [View, string][]) : []),
  ];

  return (
    <TabPage>
      {toastNode}
      <LineTabs value={view} onChange={setView} label={L("News", "Berita")} tabs={tabs}
        aside={canPost ? <TabAside><TabAction icon="add" onClick={() => setView("publish")}>{L("New announcement", "Pengumuman baharu")}</TabAction></TabAside> : undefined} />
      <TabZone label={L("At a glance", "Sepintas lalu")}>
        <div className={css.kpis}>
          <KpiRow label={L("Announcement summary", "Ringkasan pengumuman")}>
            <KpiTile icon="pending" tone={toAck.length ? "gold" : "blue"} label={L("To acknowledge", "Untuk diperakui")} value={toAck.length} busy={!loaded}
              sub={toAck.length ? L("Waiting on you", "Menunggu anda") : L("You're up to date", "Anda sudah terkini")} onClick={() => setView("mine")} />
            <KpiTile icon="success" tone="green" label={L("Acknowledged", "Diperakui")} value={acked.length} busy={!loaded} sub={L("By you", "Oleh anda")} />
            <KpiTile icon="document" tone="purple" label={L("All posts", "Semua hantaran")} value={anns.length} busy={!loaded} sub={L("For you to read", "Untuk anda baca")} />
            <KpiTile icon="users" tone="gold" label={L("Recipients", "Penerima")} value={canPost ? L("All staff", "Semua kakitangan") : L("You", "Anda")} busy={!loaded}
              sub={canPost ? L("or the departments a post names", "atau jabatan yang dinamakan") : L("and your department", "dan jabatan anda")} />
          </KpiRow>
        </div>
        <StaleHint show={feed.stale} />
      </TabZone>

      {/* ---------------- NEWS FEED ---------------- */}
      <TabZone label={L("News feed", "Suapan berita")} className={view !== "feed" ? css.off : ""}>
        <div className={css.split}>
          <section className={card} aria-label={L("Latest announcements", "Pengumuman terkini")}>
            <div className={css.head}>
              <PanelTitle icon="chat">{L("Latest announcements", "Pengumuman terkini")}</PanelTitle>
              <div className={css.filters}>
                <input className={inputClass} type="search" value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder={L("Search announcements", "Cari pengumuman")} aria-label={L("Search announcements", "Cari pengumuman")} />
                <select className={inputClass} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={L("Category", "Kategori")}>
                  <option value="">{L("All categories", "Semua kategori")}</option>
                  {CATS.map((c) => <option key={c} value={c}>{catL(c)}</option>)}
                </select>
              </div>
            </div>
            {!loaded ? <div className={css.list}>{[0, 1, 2].map((i) => <SkelCard key={i} lines={2} sub={false} />)}</div>
              : shown.length === 0 ? <p className={css.empty}>{anns.length === 0 ? L("No announcements yet.", "Tiada pengumuman lagi.") : L("Nothing matches.", "Tiada yang sepadan.")}</p> : (
              <ul className={css.list}>{shown.map((a) => <PostCard key={a.id} a={a} onOpen={() => setOpenId(a.id)} />)}</ul>
            )}
          </section>
          <aside className={css.side}>
            <section className={card} aria-label={L("Categories", "Kategori")}>
              <PanelTitle icon="search">{L("Categories", "Kategori")}</PanelTitle>
              <ul className={css.cats}>
                {CATS.map((c) => {
                  const n = anns.filter((a) => a.category === c).length;
                  return (
                    <li key={c}><button type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? "" : c)}>
                      <span>{catL(c)}</span><span className={css.count}>{n}</span>
                    </button></li>
                  );
                })}
              </ul>
            </section>
          </aside>
        </div>
      </TabZone>

      {/* ---------------- MY ACKNOWLEDGEMENTS ---------------- */}
      <TabZone label={L("My acknowledgements", "Perakuan saya")} className={view !== "mine" ? css.off : ""}>
        <MineSection title={L("Requires acknowledgement", "Perlu diperakui")} rows={toAck} loaded={loaded} onOpen={setOpenId}
          empty={L("Nothing waits on you.", "Tiada apa yang menunggu anda.")} />
        <MineSection title={L("Acknowledged", "Diperakui")} rows={acked} loaded={loaded} onOpen={setOpenId}
          empty={L("You have not acknowledged anything yet.", "Anda belum memperakui apa-apa.")} />
        <MineSection title={L("History", "Sejarah")} rows={anns.filter((a) => (a.required ?? 1) === 0 && !a.acked)} loaded={loaded} onOpen={setOpenId}
          note={L("Posts from before you joined, and your own posts - for reading, no acknowledgement needed.", "Hantaran sebelum anda menyertai, dan hantaran anda sendiri - untuk dibaca, tiada perakuan diperlukan.")}
          empty={L("No history.", "Tiada sejarah.")} />
      </TabZone>

      {/* ---------------- PUBLISH & MANAGE ---------------- */}
      {canPost && (
        <TabZone label={L("Publish", "Terbit")} className={view !== "publish" ? css.off : ""}>
          {!v2 && loaded && <p className="erp-note erp-note-warning">{L("Publishing waits for the server update (migration 0146).", "Penerbitan menunggu kemas kini pelayan (migrasi 0146).")}</p>}
          <PostForm key="new" departments={feed.data?.departments ?? []} onDone={(msg) => { toast(L("Published", "Diterbitkan"), msg); feed.refresh(); }} />
          <section className={card} aria-label={L("Manage posts", "Urus hantaran")}>
            <PanelTitle icon="edit">{L("Manage posts", "Urus hantaran")}</PanelTitle>
            {!loaded ? <SkelRows rows={4} /> : anns.length === 0 ? <p className={css.empty}>{L("Nothing published yet.", "Belum ada yang diterbitkan.")}</p> : (
              <ul className={css.manage}>
                {anns.slice(0, 40).map((a) => (
                  <li key={a.id}>
                    <span className={css.mTitle}><strong>{a.title}</strong><span>{catL(a.category)} · {dmyMYT(a.created_at).slice(0, 10)}{(a.version ?? 1) > 1 ? ` · v${a.version}` : ""}</span></span>
                    <span className={css.chips}>{a.pinned ? <Chip tone="gold">{L("Pinned", "Disemat")}</Chip> : null}{a.important ? <Chip tone="red">{L("Important", "Penting")}</Chip> : null}</span>
                    <button type="button" className={btnSm} onClick={() => setEditId(a.id)} disabled={!v2}>{L("Edit", "Sunting")}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabZone>
      )}

      {/* ---------------- REPORTS & ARCHIVE ---------------- */}
      {canPost && (
        <TabZone label={L("Reports", "Laporan")} className={view !== "reports" ? css.off : ""}>
          {view === "reports" && <Reports onOpen={setReportId} />}
        </TabZone>
      )}

      <PostDrawer a={open} onClose={() => setOpenId(null)} onAcked={(msg) => { toast(L("Acknowledged", "Diperakui"), msg); feed.refresh(); }} onChanged={() => feed.refresh()} />
      {canPost && (
        <SideDrawer open={!!editing} onClose={() => setEditId(null)} title={L("Edit announcement", "Sunting pengumuman")} subtitle={editing?.title} wide>
          {editing && <PostForm key={`e${editing.id}-${editing.version}`} edit={editing} departments={feed.data?.departments ?? []}
            onDone={(msg) => { toast(L("Saved", "Disimpan"), msg); setEditId(null); feed.refresh(); }} />}
        </SideDrawer>
      )}
      {canPost && <AckReport id={reportId} onClose={() => setReportId(null)} />}
    </TabPage>
  );
}

function Chip({ tone, children }: { tone: "gold" | "red" | "green" | "blue" | "grey"; children: ReactNode }) {
  const cls = { gold: "erp-chip-warning", red: "erp-chip-danger", green: "erp-chip-success", blue: "erp-chip-info", grey: "erp-chip-neutral" }[tone];
  return <span className={`erp-chip erp-chip-sm ${cls}`}>{children}</span>;
}

function AckState({ a }: { a: Announcement }) {
  if (a.acked) return <Chip tone="green">{L(`Acknowledged ${dmyMYT(a.acked_at ?? "").slice(0, 10)}`, `Diperakui ${dmyMYT(a.acked_at ?? "").slice(0, 10)}`)}</Chip>;
  if ((a.required ?? 1) === 0) return null;
  if ((a.my_last_version ?? 0) > 0) return <Chip tone="gold">{L("Updated - acknowledge again", "Dikemas kini - perakui semula")}</Chip>;
  return <Chip tone="gold">{L("Requires acknowledgement", "Perlu diperakui")}</Chip>;
}

function PostCard({ a, onOpen }: { a: Announcement; onOpen: () => void }) {
  return (
    <li className={`${css.post} ${needs(a) ? css.waiting : ""}`} data-record={`announcement:${a.id}`}>
      <div className={css.postTop}>
        {a.pinned ? <Chip tone="gold">{L("Pinned", "Disemat")}</Chip> : null}
        {a.important ? <Chip tone="red">{L("Important", "Penting")}</Chip> : null}
        <Chip tone="blue">{catL(a.category)}</Chip>
        <AckState a={a} />
      </div>
      <button type="button" className={css.postOpen} onClick={onOpen}>
        <strong className={css.postTitle}>{a.title}</strong>
        <span className={css.preview}>{preview(a.body)}</span>
      </button>
      <div className={css.postMeta}>
        <span>{a.publisher_name ?? L("Management", "Pengurusan")}</span>
        <span>{dmyMYT(a.created_at)}</span>
        {(a.version ?? 1) > 1 && <span>{L(`Updated · v${a.version}`, `Dikemas kini · v${a.version}`)}</span>}
        {a.audience && a.audience.length > 0 && <span>{L(`For ${a.audience.join(", ")}`, `Untuk ${a.audience.join(", ")}`)}</span>}
        {(a.files?.length ?? 0) > 0 && <span><AppIcon name="document" /> {a.files!.length}</span>}
        <button type="button" className={needs(a) ? btnSmPrimary : btnSm} onClick={onOpen}>{needs(a) ? L("Read & acknowledge", "Baca & perakui") : L("View details", "Lihat butiran")}</button>
      </div>
    </li>
  );
}

function MineSection({ title, rows, loaded, onOpen, empty, note }: { title: string; rows: Announcement[]; loaded: boolean; onOpen: (id: number) => void; empty: string; note?: string }) {
  return (
    <section className={card} aria-label={title}>
      <PanelTitle icon="document">{title} <span className={css.count}>{loaded ? rows.length : ""}</span></PanelTitle>
      {note && <p className={css.meta}>{note}</p>}
      {!loaded ? <SkelRows rows={3} /> : rows.length === 0 ? <p className={css.empty}>{empty}</p> : (
        <ul className={css.rows}>
          {rows.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onOpen(a.id)}>
                <span className={css.mTitle}><strong>{a.title}</strong><span>{catL(a.category)} · {dmyMYT(a.created_at).slice(0, 10)} · {a.publisher_name ?? L("Management", "Pengurusan")}</span></span>
                <AckState a={a} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One post, whole, with the only acknowledge button there is. */
function PostDrawer({ a, onClose, onAcked, onChanged }: { a: Announcement | null; onClose: () => void; onAcked: (msg: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [versions, setVersions] = useState<{ id: number; rows: { version: number; title: string; body: string; replaced_at: string }[]; mine: { version: number; acked_at: string }[] } | null>(null);
  const close = () => { setMsg(""); setVersions(null); onClose(); };
  const ack = async () => {
    if (!a || busy) return;
    setBusy(true); setMsg("");
    const r = await api<{ error?: { message?: string } }>(`/staff/announcements/${a.id}/ack`, { method: "POST", body: JSON.stringify({ version: a.version }) });
    setBusy(false);
    if (r.ok) onAcked(a.title);
    else { setMsg(r.status === 0 ? L("No connection - not acknowledged yet.", "Tiada sambungan - belum diperakui.") : r.data?.error?.message ?? L("Not acknowledged.", "Tidak diperakui.")); if (r.status === 409) onChanged(); }
  };
  const loadVersions = async () => {
    if (!a) return;
    const r = await api<{ versions: { version: number; title: string; body: string; replaced_at: string }[]; my_acks: { version: number; acked_at: string }[] }>(`/staff/announcements/${a.id}/versions`);
    if (r.ok && r.data) setVersions({ id: a.id, rows: r.data.versions, mine: r.data.my_acks });
  };
  const hl = a ? headLines(a) : [];
  return (
    <SideDrawer open={!!a} onClose={close} title={a?.title ?? ""} subtitle={a ? `${catL(a.category)} · ${dmyMYT(a.created_at)}` : undefined} wide
      footer={a && needs(a) ? (
        <div className={css.foot}>
          <button type="button" className={btnSm} onClick={close}>{L("Later", "Nanti")}</button>
          <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void ack()}>{busy ? L("Saving…", "Menyimpan…") : L("I have read this - acknowledge", "Saya telah membaca - perakui")}</button>
        </div>
      ) : undefined}>
      {a && (
        <div className={css.drawer}>
          <div className={css.postTop}>
            {a.pinned ? <Chip tone="gold">{L("Pinned", "Disemat")}</Chip> : null}
            {a.important ? <Chip tone="red">{L("Important", "Penting")}</Chip> : null}
            <AckState a={a} />
          </div>
          <p className={css.meta}>{L("Published by", "Diterbitkan oleh")} <strong>{a.publisher_name ?? L("Management", "Pengurusan")}</strong>{a.publisher_position ? `, ${a.publisher_position}` : ""}
            {a.audience && a.audience.length ? ` · ${L(`for ${a.audience.join(", ")}`, `untuk ${a.audience.join(", ")}`)}` : ` · ${L("for all staff", "untuk semua kakitangan")}`}
            {(a.version ?? 1) > 1 && a.updated_at ? ` · ${L(`version ${a.version}, updated ${dmyMYT(a.updated_at)}`, `versi ${a.version}, dikemas kini ${dmyMYT(a.updated_at)}`)}` : ""}</p>
          {hl.length > 0 && <dl className={css.memoHead}>{hl.map(([k, v]) => <div key={k}><dt>{k}:</dt><dd>{v}</dd></div>)}</dl>}
          <MemoBody body={a.body} />
          {(a.files?.length ?? 0) > 0 && (
            <ul className={css.files}>
              {a.files!.map((f) => <li key={f.id}><a href={`${API}/announcements/${a.id}/files/${f.id}`}><AppIcon name="document" /> {f.filename}</a></li>)}
            </ul>
          )}
          {(a.version ?? 1) > 1 && (
            versions?.id === a.id ? (
              <div className={css.versions}>
                <p className={css.meta}>{versions.mine.length ? L(`You acknowledged: ${versions.mine.map((m) => `v${m.version} on ${dmyMYT(m.acked_at)}`).join(", ")}`, `Anda memperakui: ${versions.mine.map((m) => `v${m.version} pada ${dmyMYT(m.acked_at)}`).join(", ")}`) : L("You have not acknowledged any version.", "Anda belum memperakui mana-mana versi.")}</p>
                {versions.rows.map((v) => (
                  <details key={v.version}><summary>{L(`Version ${v.version} (replaced ${dmyMYT(v.replaced_at)})`, `Versi ${v.version} (diganti ${dmyMYT(v.replaced_at)})`)}</summary><strong>{v.title}</strong><MemoBody body={v.body} /></details>
                ))}
              </div>
            ) : <button type="button" className={btnSm} onClick={() => void loadVersions()}>{L("Earlier versions", "Versi terdahulu")}</button>
          )}
          {msg && <p className="erp-note erp-note-warning" role="alert">{msg}</p>}
          {needs(a) && <p className={css.meta}>{L("Opening a post does not acknowledge it. Press the button when you have read it.", "Membuka hantaran tidak memperakuinya. Tekan butang apabila anda telah membacanya.")}</p>}
        </div>
      )}
    </SideDrawer>
  );
}

/** Publish, or edit one post. The publisher is never typed: the server signs it. */
function PostForm({ edit, departments, onDone }: { edit?: Announcement; departments: string[]; onDone: (msg: string) => void }) {
  const [f, setF] = useState({
    category: edit?.category ?? "news", title: edit?.title ?? "", body: edit?.body ?? "",
    to: edit ? edit.to_line ?? "" : L("All staff", "Semua kakitangan"), memo_date: edit?.memo_date ?? todayMalay(),
    important: !!edit?.important, pinned: !!edit?.pinned, audience: edit?.audience ?? ([] as string[]),
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const memo = f.category === "memo";
  const left = 5000 - f.body.length;
  const problem = !f.title.trim() ? L("Write a subject.", "Tulis perkara.") : !f.body.trim() ? L("Write the announcement.", "Tulis pengumuman.") : left < 0 ? L("The announcement is too long.", "Pengumuman terlalu panjang.") : "";
  const upload = async (id: number) => {
    let bad = 0;
    for (const file of files) {
      const r = await csrfFetch(`${API}/announcements/${id}/files`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": file.name }, body: file });
      if (!r.ok) bad++;
    }
    return bad;
  };
  const save = async () => {
    if (problem || busy) { setMsg(problem); return; }
    setBusy(true); setMsg("");
    const payload = { category: f.category, title: f.title, body: f.body, to: f.to, memo_date: memo ? f.memo_date : null,
      important: f.important, pinned: f.pinned, audience: f.audience.length ? f.audience : null, ...(edit ? { version: edit.version ?? 1 } : {}) };
    const r = edit
      ? await api<{ version?: number; error?: { message?: string } }>(`/staff/announcements/${edit.id}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await api<{ id?: number; recipients?: number; error?: { message?: string } }>(`/staff/announcements`, { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) {
      setBusy(false);
      /* the draft stays: a failed publish never clears the form */
      setMsg(r.status === 0 ? L("No connection - nothing was published.", "Tiada sambungan - tiada apa diterbitkan.") : (r.data as { error?: { message?: string } })?.error?.message ?? L("Not saved.", "Tidak disimpan."));
      return;
    }
    const id = edit ? edit.id : (r.data as { id?: number }).id;
    const bad = id && files.length ? await upload(id) : 0;
    setBusy(false);
    if (!edit) setF((x) => ({ ...x, title: "", body: "", important: false, pinned: false, audience: [] }));
    setFiles([]);
    const rec = (r.data as { recipients?: number }).recipients;
    onDone(`${f.title}${rec !== undefined ? ` · ${L(`${rec} recipients`, `${rec} penerima`)}` : ""}${bad ? ` · ${L(`${bad} file(s) not attached`, `${bad} fail tidak dilampirkan`)}` : ""}`);
  };
  const removeFile = async (fid: number) => {
    if (!edit) return;
    const r = await api(`/staff/announcements/${edit.id}/files/${fid}`, { method: "DELETE" });
    if (r.ok) onDone(L("File removed", "Fail dibuang"));
    else setMsg(r.status === 0 ? L("No connection - the file was not removed.", "Tiada sambungan - fail tidak dibuang.") : L("The file was not removed.", "Fail tidak dibuang."));
  };
  const body = (
    <div className={css.form}>
      <div className={css.grid2}>
        <label className={css.field}><span>{L("Category", "Kategori")}</span>
          <select className={inputClass} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{catL(c)}</option>)}</select>
        </label>
        <label className={css.field}><span>{memo ? "Perkara (Subject)" : L("Subject", "Perkara")}</span>
          <input className={inputClass} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <label className={css.field}><span>{memo ? "Kepada (To)" : L("To", "Kepada")}</span>
          <input className={inputClass} maxLength={120} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
        <div className={css.field}><span>{memo ? "Daripada (From)" : L("From", "Daripada")}</span>
          <p className={css.fromLine}>{edit?.from_name ?? L("You - signed with your name and position when published", "Anda - ditandatangani dengan nama dan jawatan anda semasa diterbitkan")}</p>
        </div>
        {memo && <label className={css.field}><span>Tarikh</span><input className={inputClass} maxLength={40} value={f.memo_date} onChange={(e) => setF({ ...f, memo_date: e.target.value })} /></label>}
      </div>
      <fieldset className={css.audience}>
        <legend>{L("Who it is for", "Untuk siapa")}</legend>
        <label className={css.check}><input type="checkbox" checked={f.audience.length === 0} onChange={() => setF({ ...f, audience: [] })} /> {L("All staff", "Semua kakitangan")}</label>
        {departments.map((d) => (
          <label key={d} className={css.check}><input type="checkbox" checked={f.audience.includes(d)}
            onChange={(e) => setF({ ...f, audience: e.target.checked ? [...f.audience, d] : f.audience.filter((x) => x !== d) })} /> {d}</label>
        ))}
      </fieldset>
      <label className={css.field}><span>{memo ? "Kandungan memo" : L("Announcement", "Pengumuman")}</span>
        <textarea className={inputClass} rows={memo ? 9 : 6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}
          placeholder={memo ? "Guna * di awal baris untuk senarai, dan 'Label: nilai' untuk baris tebal" : L("Start a line with * for a bullet, and 'Label: value' for a bold label", "Mulakan baris dengan * untuk senarai, dan 'Label: nilai' untuk label tebal")} />
        <span className={left < 0 ? css.over : css.meta}>{L(`${left} characters left`, `${left} aksara lagi`)}</span>
      </label>
      <div className={css.flags}>
        <label className={css.check}><input type="checkbox" checked={f.important} onChange={(e) => setF({ ...f, important: e.target.checked })} /> {L("Important", "Penting")}</label>
        <label className={css.check}><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> {L("Pin to the top", "Semat di atas")}</label>
      </div>
      <div className={css.field}><span>{L("Attachments (PDF, JPEG, PNG, WebP - up to 10 MB, 5 files)", "Lampiran (PDF, JPEG, PNG, WebP - sehingga 10 MB, 5 fail)")}</span>
        {edit && (edit.files?.length ?? 0) > 0 && (
          <ul className={css.files}>{edit.files!.map((x) => <li key={x.id}><span>{x.filename}</span> <button type="button" className={btnSm} onClick={() => void removeFile(x.id)}>{L("Remove", "Buang")}</button></li>)}</ul>
        )}
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 5))} />
      </div>
      {edit && <p className={css.meta}>{L("Changing the subject, the text, the category, To or the date makes a new version: everyone it is for is asked to acknowledge again, and what they acknowledged before stays on record. Pinning, Important and the departments do not.", "Menukar perkara, teks, kategori, Kepada atau tarikh menjadikan versi baharu: semua penerima diminta memperakui semula, dan perakuan lama kekal direkod. Semat, Penting dan jabatan tidak.")}</p>}
      {msg && <p className="erp-note erp-note-warning" role="alert">{msg}</p>}
      <div className={css.foot}>
        <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void save()}>{busy ? L("Saving…", "Menyimpan…") : edit ? L("Save changes", "Simpan perubahan") : L("Publish", "Terbitkan")}</button>
      </div>
    </div>
  );
  if (edit) return body;
  return (
    <section className={card} aria-label={L("Publish news", "Terbit berita")}>
      <PanelTitle icon="add">{L("Publish news", "Terbit berita")}</PanelTitle>
      <p className={css.meta}>{L("Everyone it is for is notified, and it waits on their Desk until they acknowledge it.", "Semua penerima dimaklumkan, dan ia menunggu di Meja mereka sehingga diperakui.")}</p>
      {body}
    </section>
  );
}

type ReportRow = { id: number; title: string; category: string; version: number; created_at: string; publisher_name: string | null; audience: string[] | null; important: number; pinned: number; recipients: number; acknowledged: number };
function Reports({ onOpen }: { onOpen: (id: number) => void }) {
  const rep = useCachedApi<{ posts: ReportRow[] }>("/staff/announcements/report", true, ["announcements"]);
  const rows = rep.data?.posts ?? [];
  return (
    <section className={card} aria-label={L("Acknowledgement report", "Laporan perakuan")}>
      <PanelTitle icon="chart">{L("Acknowledgement report", "Laporan perakuan")}</PanelTitle>
      <p className={css.meta}>{L("Every post, newest first: who it is for today and how many have acknowledged the version that stands. Read from the posts and acknowledgements themselves.", "Setiap hantaran, terbaharu dahulu: untuk siapa hari ini dan berapa ramai telah memperakui versi semasa. Dibaca terus daripada hantaran dan perakuan.")}</p>
      {rep.loading ? <SkelRows rows={5} /> : rows.length === 0 ? <p className={css.empty}>{L("Nothing published yet.", "Belum ada yang diterbitkan.")}</p> : (
        <ul className={css.report}>
          {rows.map((p) => {
            const pct = p.recipients ? Math.round((p.acknowledged / p.recipients) * 100) : 100;
            return (
              <li key={p.id}>
                <span className={css.mTitle}><strong>{p.title}</strong>
                  <span>{catL(p.category)} · {dmyMYT(p.created_at).slice(0, 10)} · {p.publisher_name ?? "—"}{p.version > 1 ? ` · v${p.version}` : ""}{p.audience ? ` · ${p.audience.join(", ")}` : ""}</span></span>
                <span className={css.progress}>
                  <span className={css.bar} role="img" aria-label={L(`${p.acknowledged} of ${p.recipients} acknowledged`, `${p.acknowledged} daripada ${p.recipients} diperakui`)}><span style={{ width: `${pct}%` }} /></span>
                  <span className={css.meta}>{L(`${p.acknowledged} of ${p.recipients} · ${pct}%`, `${p.acknowledged} daripada ${p.recipients} · ${pct}%`)}</span>
                </span>
                <button type="button" className={btnSm} onClick={() => onOpen(p.id)}>{L("Who", "Siapa")}</button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={css.meta}>{L("Archive: every post stays here and in the feed; nothing is deleted.", "Arkib: setiap hantaran kekal di sini dan dalam suapan; tiada yang dipadam.")}</p>
    </section>
  );
}

function AckReport({ id, onClose }: { id: number | null; onClose: () => void }) {
  const r = useCachedApi<{ title: string; version: number; total: number; acknowledged: number; recipients: { id: number; name: string; department: string | null; acked_at: string | null; last_version: number | null }[] }>(
    id === null ? null : `/staff/announcements/${id}/acks`, id !== null, ["announcements"]);
  const d = r.data;
  const not = d?.recipients.filter((x) => !x.acked_at) ?? [];
  const yes = d?.recipients.filter((x) => x.acked_at) ?? [];
  return (
    <SideDrawer open={id !== null} onClose={onClose} title={d?.title ?? L("Acknowledgements", "Perakuan")} subtitle={d ? L(`${d.acknowledged} of ${d.total} acknowledged · version ${d.version}`, `${d.acknowledged} daripada ${d.total} diperakui · versi ${d.version}`) : undefined}>
      {!d ? <SkelRows rows={5} /> : (
        <div className={css.drawer}>
          <p className={css.drawerHead}>{L(`Not yet (${not.length})`, `Belum (${not.length})`)}</p>
          {not.length === 0 ? <p className={css.empty}>{L("Everyone has acknowledged.", "Semua telah memperakui.")}</p> : (
            <ul className={css.people}>{not.map((x) => <li key={x.id}><span>{x.name}</span><span className={css.meta}>{x.department ?? "—"}{x.last_version ? ` · ${L(`acknowledged v${x.last_version}`, `memperakui v${x.last_version}`)}` : ""}</span></li>)}</ul>
          )}
          <p className={css.drawerHead}>{L(`Acknowledged (${yes.length})`, `Diperakui (${yes.length})`)}</p>
          <ul className={css.people}>{yes.map((x) => <li key={x.id}><span>{x.name}</span><span className={css.meta}>{dmyMYT(x.acked_at!)}</span></li>)}</ul>
        </div>
      )}
    </SideDrawer>
  );
}

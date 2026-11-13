"use client";

/* v1.217.0 - NEWS & ANNOUNCEMENTS 2.0 (the owner's brief, 28-10-2026), and
   v1.295.0 - NEWS v2.0, RELEASE N1 (the CEO's directive "A2Z OS - NEWS
   v2.0", 12-11-2026, with its photo; "approve continuously", 13-11-2026;
   claude/NEWS-V2-AUDIT.md). Four tabs over the one announcement record
   (worker/src/news.ts), unchanged on the server:

     News Feed            every post for you, pinned first; its own figures,
                          search, category, flag, date, my status, sort, ten a
                          page; a post opens in the reader beside the list on
                          a wide screen, in a drawer on a smaller one
     My Acknowledgements  Requires Action / Acknowledged / History - one
                          section at a time, never the feed again
     Publish & Manage     management: Announcements (the posts) and New
                          announcement (the composer, news-manage.tsx)
     Reports & Archive    management: the completion strip, the report, who
                          has and has not acknowledged, CSV

   The tab is in the address (?tab=Announcements&view=mine), so Back and
   Forward move between tabs; a management tab is never drawn for anyone
   else, and asking for it by address opens the feed. Acknowledging is only
   ever the reader's button, and it sends the version the reader showed: if
   the post changed meanwhile the server says so and nothing is saved.
   Bodies are text, never HTML. The shared pieces are news-parts.tsx. */
import { AppIcon } from "@/components/ui/app-icon";
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelCard, StaleHint } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { Announcement, L, MANAGE_ROLES, User } from "@/components/portal/page-shared";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { AckState, CATS, Chip, MemoBody, NewsEmpty, NewsFilterBar, NewsPager, NewsStats, PostCard, ackWord, catL, needs, within } from "@/components/portal/news-parts";
import { AckReport, ManageList, PostForm, Reports } from "@/components/portal/news-manage";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { dmyMYT } from "@/lib/format";
import { useRecordFocus, type RecordFocus } from "@/lib/record-focus";
import { useTabViewAddress } from "@/lib/tab-view";
import { btnSm, btnSmPrimary, card } from "@/lib/ui-styles";
import { useCallback, useState, useSyncExternalStore } from "react";
import css from "./announcements.module.css";

/* the memo reader and its Malay date stay importable from here */
export { MemoBody, MS_MONTHS, todayMalay } from "@/components/portal/news-parts";

type View = "feed" | "mine" | "publish" | "reports";
const VIEWS: readonly View[] = ["feed", "mine", "publish", "reports"];
type Feed = { announcements: Announcement[]; can_publish?: boolean; departments?: string[]; pending_migration?: boolean };
type Mine = "action" | "done" | "history";
const API = "/api/v1/staff";
const PER = 10;

/* the reader sits beside the list from 1280px; below, it is a drawer */
const WIDE = "(min-width: 1280px)";
const subWide = (cb: () => void) => { const m = window.matchMedia(WIDE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const readWide = () => window.matchMedia(WIDE).matches;

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

export function Announcements({ user, focus, startView }: { user: User; focus?: RecordFocus | null; startView?: string }) {
  const feed = useCachedApi<Feed>("/staff/announcements", true, ["announcements"]);
  const anns = feed.data?.announcements ?? [];
  const loaded = !feed.loading;
  const canPost = feed.data?.can_publish ?? MANAGE_ROLES.includes(user.role);
  const v2 = loaded && !feed.data?.pending_migration;
  /* stable for a given permission: the address hook re-binds only when it changes */
  const allowed = useCallback((v: string | null): v is View => !!v && (VIEWS as readonly string[]).includes(v) && (canPost || v === "feed" || v === "mine"), [canPost]);
  const [asked, setViewRaw] = useState<View>(() => (startView === "mine" || startView === "publish" || startView === "reports" ? startView : "feed"));
  /* a management tab asked for by someone who may not publish opens the feed */
  const view: View = allowed(asked) ? asked : "feed";
  /* the post open in the reader, and the tab it was opened on: it does not
     follow you to another tab as a drawer */
  const [opened, setOpened] = useState<{ id: number; on: View } | null>(null);
  const [seenStart, setSeenStart] = useState(startView);
  if (startView !== seenStart) { setSeenStart(startView); if (startView && (VIEWS as readonly string[]).includes(startView)) setViewRaw(startView as View); }
  const setView = setViewRaw;
  useTabViewAddress("Announcements", view, setView, allowed);
  const wide = useSyncExternalStore(subWide, readWide, () => false);

  /* feed filters - kept while you move between tabs */
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [flag, setFlag] = useState("");
  const [when, setWhen] = useState("");
  const [mineF, setMineF] = useState("");
  const [sort, setSort] = useState("pinned");
  const [page, setPage] = useState(0);
  const [mine, setMine] = useState<Mine>("action");
  const [editId, setEditId] = useState<number | null>(null);
  const [editDirty, setEditDirty] = useState(false);
  const [reportId, setReportId] = useState<number | null>(null);
  const [manage, setManage] = useState<"list" | "compose">("list");
  const { show: toast, node: toastNode } = useSaveToast();

  /* the bell's "announcement:<id>" opens that post (lib/record-focus.ts) */
  useRecordFocus(focus, loaded, (f) => { if (f.kind === "announcement") { setView("feed"); setOpened({ id: f.id, on: "feed" }); } });
  const openId = opened && opened.on === view ? opened.id : null;
  const setOpenId = (id: number | null) => setOpened(id === null ? null : { id, on: view });

  const toAck = anns.filter(needs);
  const acked = anns.filter((a) => a.acked);
  const history = anns.filter((a) => !a.acked && !needs(a));
  const needle = q.trim().toLowerCase();
  const filtered = anns.filter((a) => (!cat || a.category === cat)
    && (!flag || (flag === "pinned" ? !!a.pinned : !!a.important))
    && (!when || within(a.created_at, Number(when)))
    && (!mineF || (mineF === "action" ? needs(a) : mineF === "acked" ? !!a.acked : !a.acked && !needs(a)))
    && (!needle || `${a.title} ${a.body} ${a.publisher_name ?? ""}`.toLowerCase().includes(needle)));
  const shown = [...filtered].sort((x, y) => (sort === "pinned" ? (y.pinned ?? 0) - (x.pinned ?? 0) : 0)
    || (sort === "oldest" ? x.created_at.localeCompare(y.created_at) : y.created_at.localeCompare(x.created_at)));
  const pages = Math.max(1, Math.ceil(shown.length / PER));
  const at = Math.min(page, pages - 1);
  const pageRows = shown.slice(at * PER, at * PER + PER);
  const open = openId === null ? null : anns.find((a) => a.id === openId) ?? null;
  /* the wide reader shows the chosen post, or the first one on the page */
  const reading = wide && view === "feed" ? (open ?? pageRows[0] ?? null) : null;
  const editing = editId === null ? null : anns.find((a) => a.id === editId) ?? null;
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); };

  const tabs: [View, string, number | null, string][] = [
    ["feed", L("News Feed", "Suapan Berita"), null, L("Feed", "Suapan")],
    ["mine", L("My Acknowledgements", "Perakuan Saya"), toAck.length || null, L("My Ack.", "Perakuan")],
    ...(canPost ? ([["publish", L("Publish & Manage", "Terbit & Urus"), null, L("Manage", "Urus")], ["reports", L("Reports & Archive", "Laporan & Arkib"), null, L("Reports", "Laporan")]] as [View, string, number | null, string][]) : []),
  ];
  const compose = () => { setView("publish"); setManage("compose"); };

  return (
    <TabPage>
      {toastNode}
      <LineTabs value={view} onChange={setView} label={L("News", "Berita")} tabs={tabs}
        aside={canPost ? <TabAside><TabAction icon="add" onClick={compose}>{L("New announcement", "Pengumuman baharu")}</TabAction></TabAside> : undefined} />

      {/* ---------------- NEWS FEED ---------------- */}
      <TabZone label={L("News feed", "Suapan berita")} className={view !== "feed" ? css.off : ""}>
        <NewsStats label={L("Your news at a glance", "Berita anda sepintas lalu")} busy={!loaded} stats={[
          { key: "posts", icon: "content", tone: "gold", value: anns.length, label: L("Posts for you", "Hantaran untuk anda"), sub: L("published to you", "diterbitkan kepada anda") },
          { key: "waiting", icon: "pending", tone: toAck.length ? "red" : "blue", value: toAck.length, label: L("Waiting on you", "Menunggu anda"), sub: toAck.length ? L("to read and acknowledge", "untuk dibaca & diperakui") : L("you are up to date", "anda sudah terkini"), onClick: () => setView("mine") },
          { key: "acked", icon: "success", tone: "green", value: acked.length, label: L("Acknowledged", "Diperakui"), sub: L("by you", "oleh anda") },
          { key: "important", icon: "warning", tone: "purple", value: anns.filter((a) => a.important).length, label: L("Important", "Penting"), sub: L(`${anns.filter((a) => a.pinned).length} pinned`, `${anns.filter((a) => a.pinned).length} disemat`) },
        ]} />
        <StaleHint show={feed.stale} />
        <div className={css.split} data-reader={wide ? "" : undefined}>
          <section className={card} aria-label={L("Latest announcements", "Pengumuman terkini")}>
            <NewsFilterBar q={q} onQ={resetPage(setQ)} placeholder={L("Search announcements", "Cari pengumuman")} selects={[
              { key: "category", label: L("Category", "Kategori"), value: cat, onChange: resetPage(setCat), options: [["", L("All categories", "Semua kategori")], ...CATS.map((c) => [c, catL(c)] as [string, string])] },
              { key: "flag", label: L("Important or pinned", "Penting atau disemat"), value: flag, onChange: resetPage(setFlag), options: [["", L("All posts", "Semua hantaran")], ["important", L("Important", "Penting")], ["pinned", L("Pinned", "Disemat")]] },
              { key: "status", label: L("My status", "Status saya"), value: mineF, onChange: resetPage(setMineF), options: [["", L("Any status", "Semua status")], ["action", L("Requires my acknowledgement", "Perlu perakuan saya")], ["acked", L("Acknowledged", "Diperakui")], ["none", L("Nothing required", "Tiada diperlukan")]] },
              { key: "date", label: L("Published", "Diterbitkan"), value: when, onChange: resetPage(setWhen), options: [["", L("Any date", "Semua tarikh")], ["7", L("Last 7 days", "7 hari lepas")], ["30", L("Last 30 days", "30 hari lepas")], ["90", L("Last 90 days", "90 hari lepas")], ["365", L("Last 12 months", "12 bulan lepas")]] },
              { key: "sort", label: L("Sort", "Susun"), value: sort, onChange: resetPage(setSort), options: [["pinned", L("Pinned first", "Disemat dahulu")], ["latest", L("Latest first", "Terbaharu dahulu")], ["oldest", L("Oldest first", "Terlama dahulu")]] },
            ]} />
            {!loaded ? <div className={css.list}>{[0, 1, 2].map((i) => <SkelCard key={i} lines={2} sub={false} />)}</div>
              : feed.failed && !feed.data ? <p className="erp-note erp-note-warning" role="alert">{L("The news could not be loaded. Check the connection and try again.", "Berita tidak dapat dimuatkan. Semak sambungan dan cuba lagi.")}</p>
              : shown.length === 0 ? <NewsEmpty action={anns.length > 0 ? <button type="button" className={btnSm} onClick={() => { setQ(""); setCat(""); setFlag(""); setWhen(""); setMineF(""); setPage(0); }}>{L("Clear the filters", "Kosongkan penapis")}</button> : undefined}>
                  {anns.length === 0 ? L("No announcements yet.", "Tiada pengumuman lagi.") : L("Nothing matches these filters.", "Tiada yang sepadan dengan penapis ini.")}</NewsEmpty> : (
              <>
                <ul className={css.list}>{pageRows.map((a) => <PostCard key={a.id} a={a} me={user.id} selected={reading?.id === a.id} onOpen={() => setOpenId(a.id)} />)}</ul>
                <NewsPager page={at} pages={pages} total={shown.length} per={PER} onPage={setPage} />
              </>
            )}
          </section>
          {wide && (
            <aside className={`${card} ${css.reader}`} aria-label={L("Announcement", "Pengumuman")} data-testid="news-reader-inline">
              {reading ? <PostReader key={`${reading.id}-${reading.version ?? 1}`} a={reading} me={user.id} onAcked={(msg) => { toast(L("Acknowledged", "Diperakui"), msg); feed.refresh(); }} onChanged={() => feed.refresh()} />
                : <NewsEmpty>{L("Choose an announcement to read it here.", "Pilih pengumuman untuk membacanya di sini.")}</NewsEmpty>}
            </aside>
          )}
        </div>
      </TabZone>

      {/* ---------------- MY ACKNOWLEDGEMENTS ---------------- */}
      <TabZone label={L("My acknowledgements", "Perakuan saya")} className={view !== "mine" ? css.off : ""}>
        <section className={card} aria-label={L("My acknowledgements", "Perakuan saya")} data-testid="news-mine">
          <div className={css.seg} role="group" aria-label={L("Which acknowledgements", "Perakuan yang mana")}>
            {([["action", L("Requires action", "Perlu tindakan"), toAck.length], ["done", L("Acknowledged", "Diperakui"), acked.length], ["history", L("History", "Sejarah"), history.length]] as [Mine, string, number][]).map(([k, t, n]) => (
              <button key={k} type="button" aria-pressed={mine === k} onClick={() => setMine(k)} data-testid={`news-mine-${k}`}>{t} <span className={css.count}>{loaded ? n : ""}</span></button>
            ))}
          </div>
          {mine === "action" && <MineList rows={toAck} loaded={loaded} me={user.id} onOpen={setOpenId} kind="action"
            empty={L("Nothing waits on you. You are up to date.", "Tiada apa yang menunggu anda. Anda sudah terkini.")} />}
          {mine === "done" && <MineList rows={acked} loaded={loaded} me={user.id} onOpen={setOpenId} kind="done"
            empty={L("You have not acknowledged anything yet.", "Anda belum memperakui apa-apa.")} />}
          {mine === "history" && <MineList rows={history} loaded={loaded} me={user.id} onOpen={setOpenId} kind="history"
            note={L("Posts you can read that do not need you now: your own posts, posts from before you joined, and posts whose earlier version you acknowledged before it stopped needing you.", "Hantaran yang boleh anda baca tetapi tidak memerlukan anda sekarang: hantaran anda sendiri, hantaran sebelum anda menyertai, dan hantaran yang versi terdahulunya telah anda perakui.")}
            empty={L("No history.", "Tiada sejarah.")} />}
        </section>
      </TabZone>

      {/* ---------------- PUBLISH & MANAGE ---------------- */}
      {canPost && (
        <TabZone label={L("Publish", "Terbit")} className={view !== "publish" ? css.off : ""}>
          {!v2 && loaded && <p className="erp-note erp-note-warning">{L("Publishing waits for the server update (migration 0146).", "Penerbitan menunggu kemas kini pelayan (migrasi 0146).")}</p>}
          <div className={css.seg} role="group" aria-label={L("Publish & Manage", "Terbit & Urus")}>
            <button type="button" aria-pressed={manage === "list"} onClick={() => setManage("list")} data-testid="news-manage-list">{L("Announcements", "Pengumuman")}</button>
            <button type="button" aria-pressed={manage === "compose"} onClick={() => setManage("compose")} data-testid="news-manage-compose">{L("New announcement", "Pengumuman baharu")}</button>
          </div>
          <div className={manage !== "list" ? css.off : ""}>
            <ManageList anns={anns} loaded={loaded} v2={v2} onEdit={setEditId} onPreview={setOpenId} onReport={setReportId} />
          </div>
          <section className={`${card} ${manage !== "compose" ? css.off : ""}`} aria-label={L("New announcement", "Pengumuman baharu")}>
            <h3 className={css.h3}><AppIcon name="add" />{L("New announcement", "Pengumuman baharu")}</h3>
            <p className={css.meta}>{L("Everyone it is for is notified, and it waits on their Desk until they acknowledge it.", "Semua penerima dimaklumkan, dan ia menunggu di Meja mereka sehingga diperakui.")}</p>
            <PostForm key="new" departments={feed.data?.departments ?? []} onDone={(msg) => { toast(L("Published", "Diterbitkan"), msg); feed.refresh(); setManage("list"); }} />
          </section>
        </TabZone>
      )}

      {/* ---------------- REPORTS & ARCHIVE ---------------- */}
      {canPost && (
        <TabZone label={L("Reports", "Laporan")} className={view !== "reports" ? css.off : ""}>
          {view === "reports" && <Reports onOpen={setReportId} />}
        </TabZone>
      )}

      {/* the drawer reader: phones and narrower screens, and My Acknowledgements and Manage everywhere */}
      <SideDrawer open={!!open && !(wide && view === "feed")} onClose={() => setOpenId(null)} title={open?.title ?? ""}
        subtitle={open ? `${catL(open.category)} · ${dmyMYT(open.created_at)}` : undefined} wide>
        {open && <PostReader key={`${open.id}-${open.version ?? 1}`} a={open} me={user.id} inDrawer onClose={() => setOpenId(null)}
          onAcked={(msg) => { toast(L("Acknowledged", "Diperakui"), msg); feed.refresh(); }} onChanged={() => feed.refresh()} />}
      </SideDrawer>
      {canPost && (
        <SideDrawer open={!!editing} onClose={() => { setEditId(null); setEditDirty(false); }} dirty={editDirty} title={L("Edit announcement", "Sunting pengumuman")} subtitle={editing?.title} wide>
          {editing && <PostForm key={`e${editing.id}-${editing.version}`} edit={editing} departments={feed.data?.departments ?? []} onDirty={setEditDirty}
            onDone={(msg) => { toast(L("Saved", "Disimpan"), msg); setEditId(null); setEditDirty(false); feed.refresh(); }} />}
        </SideDrawer>
      )}
      {canPost && <AckReport id={reportId} onClose={() => setReportId(null)} />}
    </TabPage>
  );
}

function MineList({ rows, loaded, me, onOpen, empty, note, kind }: { rows: Announcement[]; loaded: boolean; me: number; onOpen: (id: number) => void; empty: string; note?: string; kind: Mine }) {
  return (
    <>
      {note && <p className={css.meta}>{note}</p>}
      {!loaded ? <div className={css.list}>{[0, 1].map((i) => <SkelCard key={i} lines={1} sub={false} />)}</div> : rows.length === 0 ? <NewsEmpty>{empty}</NewsEmpty> : (
        <>
          <div className={css.mineHead} aria-hidden>
            <span>{L("Announcement", "Pengumuman")}</span>
            <span>{kind === "done" ? L("Acknowledged", "Diperakui") : kind === "action" ? L("Version", "Versi") : L("Why", "Sebab")}</span>
            <span>{L("Status", "Status")}</span>
            <span />
          </div>
          <ul className={css.rows}>
            {rows.map((a) => (
              <li key={a.id} data-testid={`news-mine-row-${kind}`}>
                <button type="button" onClick={() => onOpen(a.id)}>
                  <span className={css.mTitle}><strong>{a.title}</strong><span>{catL(a.category)} · {a.publisher_name ?? L("Management", "Pengurusan")} · {dmyMYT(a.created_at).slice(0, 10)}</span></span>
                  <span className={css.mineCell}>
                    {kind === "done" ? L(`${dmyMYT(a.acked_at ?? "")} · v${a.version ?? 1}`, `${dmyMYT(a.acked_at ?? "")} · v${a.version ?? 1}`)
                      : kind === "action" ? ((a.my_last_version ?? 0) > 0 ? L(`v${a.version ?? 1} (you acknowledged v${a.my_last_version})`, `v${a.version ?? 1} (anda memperakui v${a.my_last_version})`) : `v${a.version ?? 1}`)
                      : ackWord(a, me) === "own" ? L("Your post", "Hantaran anda") : ackWord(a, me) === "previous" ? L("Earlier version acknowledged", "Versi terdahulu diperakui") : L("Before you joined, or not addressed to you", "Sebelum anda menyertai, atau bukan untuk anda")}
                  </span>
                  <AckState a={a} me={me} />
                  {kind === "action" && <span className={btnSmPrimary}>{L("Read & acknowledge", "Baca & perakui")}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** One post, whole, with the only acknowledge button there is. */
function PostReader({ a, me, inDrawer = false, onClose, onAcked, onChanged }: { a: Announcement; me: number; inDrawer?: boolean; onClose?: () => void; onAcked: (msg: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [versions, setVersions] = useState<{ rows: { version: number; title: string; body: string; replaced_at: string }[]; mine: { version: number; acked_at: string }[] } | null>(null);
  const ack = async () => {
    if (busy) return;
    setBusy(true); setMsg("");
    const r = await api<{ error?: { message?: string } }>(`/staff/announcements/${a.id}/ack`, { method: "POST", body: JSON.stringify({ version: a.version }) });
    setBusy(false);
    if (r.ok) { onAcked(a.title); onClose?.(); }
    else { setMsg(r.status === 0 ? L("No connection - not acknowledged yet.", "Tiada sambungan - belum diperakui.") : r.data?.error?.message ?? L("Not acknowledged.", "Tidak diperakui.")); if (r.status === 409) onChanged(); }
  };
  const loadVersions = async () => {
    const r = await api<{ versions: { version: number; title: string; body: string; replaced_at: string }[]; my_acks: { version: number; acked_at: string }[] }>(`/staff/announcements/${a.id}/versions`);
    if (r.ok && r.data) setVersions({ rows: r.data.versions, mine: r.data.my_acks });
  };
  const hl = headLines(a);
  return (
    <article className={css.drawer} data-testid="news-reader">
      <div className={css.postTop}>
        {a.pinned ? <Chip tone="gold">{L("Pinned", "Disemat")}</Chip> : null}
        {a.important ? <Chip tone="red">{L("Important", "Penting")}</Chip> : null}
        <Chip tone="blue">{catL(a.category)}</Chip>
        <AckState a={a} me={me} />
      </div>
      {!inDrawer && <h2 className={css.readerTitle}>{a.title}</h2>}
      <p className={css.meta}>{L("Published by", "Diterbitkan oleh")} <strong>{a.publisher_name ?? L("Management", "Pengurusan")}</strong>{a.publisher_position ? `, ${a.publisher_position}` : ""} · {dmyMYT(a.created_at)}
        {a.audience && a.audience.length ? ` · ${L(`for ${a.audience.join(", ")}`, `untuk ${a.audience.join(", ")}`)}` : ` · ${L("for all staff", "untuk semua kakitangan")}`}
        {` · ${L(`version ${a.version ?? 1}`, `versi ${a.version ?? 1}`)}`}{(a.version ?? 1) > 1 && a.updated_at ? ` ${L(`updated ${dmyMYT(a.updated_at)}`, `dikemas kini ${dmyMYT(a.updated_at)}`)}` : ""}</p>
      {hl.length > 0 && <dl className={css.memoHead}>{hl.map(([k, v]) => <div key={k}><dt>{k}:</dt><dd>{v}</dd></div>)}</dl>}
      <MemoBody body={a.body} />
      {(a.files?.length ?? 0) > 0 && (
        <>
          <p className={css.drawerHead}>{L(`Attachments (${a.files!.length})`, `Lampiran (${a.files!.length})`)}</p>
          <ul className={css.files}>
            {a.files!.map((f) => <li key={f.id}><a href={`${API}/announcements/${a.id}/files/${f.id}`}><AppIcon name="document" /> {f.filename}{f.size ? <span className={css.meta}> · {Math.max(1, Math.round(f.size / 1024))} KB</span> : null}</a></li>)}
          </ul>
        </>
      )}
      {(a.version ?? 1) > 1 && (
        versions ? (
          <div className={css.versions}>
            <p className={css.meta}>{versions.mine.length ? L(`You acknowledged: ${versions.mine.map((m) => `v${m.version} on ${dmyMYT(m.acked_at)}`).join(", ")}`, `Anda memperakui: ${versions.mine.map((m) => `v${m.version} pada ${dmyMYT(m.acked_at)}`).join(", ")}`) : L("You have not acknowledged any version.", "Anda belum memperakui mana-mana versi.")}</p>
            {versions.rows.map((v) => (
              <details key={v.version}><summary>{L(`Version ${v.version} (replaced ${dmyMYT(v.replaced_at)})`, `Versi ${v.version} (diganti ${dmyMYT(v.replaced_at)})`)}</summary><strong>{v.title}</strong><MemoBody body={v.body} /></details>
            ))}
          </div>
        ) : <button type="button" className={btnSm} onClick={() => void loadVersions()}>{L("Earlier versions", "Versi terdahulu")}</button>
      )}
      {msg && <p className="erp-note erp-note-warning" role="alert">{msg}</p>}
      {needs(a) && (
        <div className={css.ackBox}>
          <p className={css.meta}>{L("Opening a post does not acknowledge it. Press the button when you have read it.", "Membuka hantaran tidak memperakuinya. Tekan butang apabila anda telah membacanya.")}</p>
          <div className={css.foot}>
            {onClose && <button type="button" className={btnSm} onClick={onClose}>{L("Later", "Nanti")}</button>}
            <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void ack()}>{busy ? L("Saving…", "Menyimpan…") : L("I have read this - acknowledge", "Saya telah membaca - perakui")}</button>
          </div>
        </div>
      )}
    </article>
  );
}

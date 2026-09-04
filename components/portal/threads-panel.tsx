"use client";

/**
 * The Threads tab — v1.89.0, phase 1 of the Threads workspace.
 *
 * CEO, 04-09-2026, after a walkthrough video of LazyThreads: *"for Threads I
 * want new tabs all in 1 tabs for the Threads with minimalist interface"*.
 *
 * ONE TAB, THREE SECTIONS, chosen the way the attendance card chooses its
 * area (v1.80.0): Overview, Library, Connection. Not the eleven analytics
 * sub-tabs in the video — most of those are a model's opinion dressed as a
 * screen, and the CEO asked for minimalist. What is here is what the numbers
 * support on their own:
 *
 *   OVERVIEW   the 30-day brief — followers, views, views per post, posts —
 *              against the 30 days before; the five posts that did best, each
 *              with its "× baseline"; and the hours of the day the account's
 *              posts earn their views, which is where "publish around 1-3 PM"
 *              comes from without anybody guessing.
 *   LIBRARY    every post the account has ever published, imported from
 *              Threads, with a chip row that filters the table and the CSV
 *              together — one definition of "the rows on screen".
 *   CONNECTION the account itself: who connected it, when the token runs
 *              out, how far the import has got, and the buttons that need a
 *              manager (connect, sync, disconnect).
 *
 * EVERY FIGURE OPENS. A tile on the Overview is the filter it counts — press
 * Posts and the Library opens on the last 30 days; press Views and it opens
 * sorted by views. A tile with nothing behind it (followers: a number, not a
 * list) stays a plain tile, per guard #31: never promise an action that is
 * not there.
 *
 * "× BASELINE" is the video's one good idea and is honest arithmetic here: a
 * post against the median views of the thirty posts before it on the same
 * account, computed by the worker over the whole history in order, so a
 * post from March is judged against the account of March.
 */

import { useCallback, useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { StatTile, StatStrip } from "@/components/ui/stat-tile";
import { Skel } from "@/components/ui/skeleton";
import { rowBtn, rowBtnDanger, rowBtnPrimary } from "@/components/ui/row-button";
import { card, inputClassSm, th, td, thR2, tdR2 } from "@/lib/ui-styles";
import { downloadCsv, csvStampMyt } from "@/lib/csv";
import { dmyMYT } from "@/lib/format";
import { getLang } from "@/lib/i18n";

const api = makeApi("/staff/threads");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Account {
  id: number; username: string; display_label: string | null; connected_at: string;
  token_expires_at: string | null; last_sync_at: string | null; sync_error: string | null;
  sync_state: string; connected_by_name: string | null; posts: number; metrics_on: string | null;
}
interface Post {
  id: number; account_id: number; media_id: string; text: string | null; media_type: string;
  permalink: string | null; published_at: string; has_media: number; char_count: number;
  language_guess: string | null;
  views: number | null; likes: number | null; replies: number | null; reposts: number | null;
  quotes: number | null; shares: number | null; metrics_at: string | null;
  baseline: number | null; multiplier: number | null;
}
interface Period { posts: number; views: number; likes: number; replies: number; avg_views: number | null; engagement_pm: number | null }
interface Summary {
  days: number; from: string; this: Period; prev: Period;
  followers: { now: number | null; start: number | null; as_of: string | null };
  by_hour: { hour: number; views: number; posts: number; avg: number }[];
  media_median: number | null; text_median: number | null;
  top: { id: number; text: string; permalink: string | null; published_at: string; views: number | null; likes: number | null; replies: number | null; multiplier: number | null }[];
}

type Section = "overview" | "library" | "connection";
type Filter = "all" | "recent" | "winners" | "media" | "text";
type Sort = "date" | "views";

/** 12,345 → "12.3K"; the tile has room for five characters, not eight. */
const compact = (n: number | null | undefined): string => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}K`;
  if (Math.abs(n) >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};
const num = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString("en-MY"));
/** "+12%" against the previous window, or nothing when there is no previous. */
const delta = (now: number | null | undefined, before: number | null | undefined): string => {
  if (now == null || before == null || before === 0) return "";
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% ${L("vs previous", "berbanding sebelum")}`;
};
const excerpt = (t: string | null, n = 110): string => {
  const s = (t ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const typeLabel = (mt: string): string =>
  mt === "TEXT_POST" ? L("Text", "Teks")
  : mt === "IMAGE" ? L("Image", "Imej")
  : mt === "VIDEO" ? L("Video", "Video")
  : mt === "CAROUSEL_ALBUM" ? L("Carousel", "Karusel")
  : mt === "REPOST_FACADE" ? L("Repost", "Siar semula")
  : mt;
const hourLabel = (h: number): string => `${String(h).padStart(2, "0")}:00`;
const daysLeft = (iso: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso.replace(" ", "T") + "Z").getTime();
  return Number.isNaN(d) ? null : Math.floor((d - Date.now()) / 86400000);
};

/** The "17.7×" pill. Module scope, per guard #30. */
function Mult({ m }: { m: number | null }) {
  if (m == null) return <span className="text-muted-foreground text-xs">—</span>;
  const tone = m >= 2 ? "bg-success-soft text-success" : m >= 1 ? "bg-info-soft text-info" : "bg-secondary text-muted-foreground";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${tone}`}
      title={L("Views against the median of the 30 posts before it", "Tontonan berbanding median 30 hantaran sebelumnya")}>
      {m}×
    </span>
  );
}

/** One post, opened: the whole text and the door to Threads itself. */
function PostBody({ p }: { p: { text: string | null; permalink: string | null } }) {
  return (
    <div className="bg-secondary/40 mt-2 rounded-lg p-3 text-sm whitespace-pre-wrap">
      {p.text || <span className="text-muted-foreground">{L("No text on this post", "Tiada teks pada hantaran ini")}</span>}
      {p.permalink && (
        <p className="mt-2">
          <a href={p.permalink} target="_blank" rel="noreferrer" className="text-primary text-xs underline">
            {L("Open on Threads ↗", "Buka di Threads ↗")}
          </a>
        </p>
      )}
    </div>
  );
}

export function ThreadsPanel() {
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();

  const [section, setSection] = useState<Section>("overview");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [configured, setConfigured] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [pending, setPending] = useState(false);
  const [accLoaded, setAccLoaded] = useState(false);
  const [account, setAccount] = useState<number | 0>(0); // 0 = all

  const [summary, setSummary] = useState<Summary | null>(null);
  const [sumLoaded, setSumLoaded] = useState(false);
  const [openTop, setOpenTop] = useState<number | null>(null);

  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [months, setMonths] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [month, setMonth] = useState("");
  const [sort, setSort] = useState<Sort>("date");
  const [q, setQ] = useState("");
  const [qLive, setQLive] = useState("");
  const [libLoaded, setLibLoaded] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);

  const [busy, setBusy] = useState<number | null>(null);
  const [label, setLabel] = useState<{ id: number; v: string } | null>(null);

  const loadAccounts = useCallback(async () => {
    const r = await api<{ accounts: Account[]; configured?: boolean; can_manage?: boolean; pending_migration?: boolean }>(`/accounts`);
    if (r.ok && r.data) {
      setAccounts(r.data.accounts ?? []);
      setConfigured(r.data.configured !== false);
      setCanManage(Boolean(r.data.can_manage));
      setPending(Boolean(r.data.pending_migration));
    }
    setAccLoaded(true);
  }, []);
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const loadSummary = useCallback(async () => {
    setSumLoaded(false);
    const r = await api<Summary>(`/summary?days=30${account ? `&account=${account}` : ""}`);
    if (r.ok && r.data && r.data.this) setSummary(r.data);
    else setSummary(null);
    setSumLoaded(true);
  }, [account]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  /* Search waits for the typing to stop — the list is the whole history and
     a request per keystroke is a request per keystroke. */
  useEffect(() => {
    const t = window.setTimeout(() => setQ(qLive.trim()), 350);
    return () => window.clearTimeout(t);
  }, [qLive]);

  const loadPosts = useCallback(async () => {
    setLibLoaded(false);
    const qs = new URLSearchParams();
    if (account) qs.set("account", String(account));
    if (filter !== "all") qs.set("filter", filter);
    if (month) qs.set("month", month);
    if (sort !== "date") qs.set("sort", sort);
    if (q) qs.set("q", q);
    qs.set("limit", "500");
    const r = await api<{ posts: Post[]; total: number; months: string[] }>(`/posts?${qs.toString()}`);
    if (r.ok && r.data) {
      setPosts(r.data.posts ?? []);
      setTotal(r.data.total ?? 0);
      setMonths(r.data.months ?? []);
    } else {
      setPosts([]); setTotal(0);
    }
    setLibLoaded(true);
  }, [account, filter, month, sort, q]);
  useEffect(() => { void loadPosts(); }, [loadPosts]);

  /* A tile on the Overview is a door into the Library with that filter set. */
  const openLibrary = (f: Filter, s: Sort) => {
    setFilter(f); setSort(s); setMonth(""); setQLive(""); setQ("");
    setSection("library");
  };

  /* ONE definition of the rows on screen — the table and the CSV both read
     `posts`, which the worker filtered; the export never re-filters. */
  const exportCsv = () => {
    const tag = [filter !== "all" ? filter : "", month].filter(Boolean).join("-");
    downloadCsv(`threads-posts${tag ? `-${tag}` : ""}`, [
      [`# ${L("Threads posts", "Hantaran Threads")}${account ? ` — @${accounts.find((a) => a.id === account)?.username ?? account}` : ""}`],
      [`# ${L("Generated", "Dijana")} ${csvStampMyt()} — ${posts.length} ${L("of", "daripada")} ${total}`],
      [],
      [
        L("Published (MYT)", "Disiarkan (MYT)"), L("Account", "Akaun"), L("Type", "Jenis"), L("Language", "Bahasa"),
        L("Characters", "Aksara"), L("Views", "Tontonan"), L("Likes", "Suka"), L("Replies", "Balasan"),
        L("Reposts", "Siar semula"), L("Quotes", "Petikan"), L("Shares", "Kongsi"),
        L("Baseline", "Garis asas"), L("× baseline", "× garis asas"), L("Metrics as of", "Metrik setakat"),
        L("Link", "Pautan"), L("Text", "Teks"),
      ],
      ...posts.map((p) => [
        dmyMYT(p.published_at), `@${accounts.find((a) => a.id === p.account_id)?.username ?? p.account_id}`,
        typeLabel(p.media_type), p.language_guess ?? "", p.char_count,
        p.views, p.likes, p.replies, p.reposts, p.quotes, p.shares,
        p.baseline, p.multiplier, dmyMYT(p.metrics_at), p.permalink ?? "", p.text ?? "",
      ]),
    ]);
  };

  /* ---- management actions: each one reports, either way (guard #25) ---- */
  const syncNow = async (a: Account) => {
    setBusy(a.id);
    const r = await api<{ ok: boolean; report: { imported: number; snapshots: number; refreshed: number; errors: string[] }; sync_state: string | null; sync_error: string | null; error?: { message?: string } }>(
      `/accounts/${a.id}/sync`, { method: "POST" },
    );
    setBusy(null);
    if (r.ok && r.data?.report) {
      const rep = r.data.report;
      const more = r.data.sync_state === "importing";
      toast(
        L("Synced", "Disegerakkan"),
        `${rep.imported} ${L("posts", "hantaran")} · ${rep.snapshots} ${L("snapshots", "cerapan")}` +
          (more ? ` · ${L("more history still to fetch — press again or let the cron carry on", "sejarah masih ada — tekan lagi atau biarkan cron teruskan")}` : "") +
          (rep.errors.length ? ` · ${rep.errors[0]}` : ""),
        rep.errors.length ? "notice" : "success",
      );
    } else {
      toast(L("Sync failed", "Penyegerakan gagal"), r.data?.error?.message ?? L("The worker did not answer", "Pelayan tidak menjawab"), "notice");
    }
    await Promise.all([loadAccounts(), loadSummary(), loadPosts()]);
  };

  const disconnect = async (a: Account) => {
    const ok = await confirm({
      title: L(`Disconnect @${a.username}?`, `Putuskan @${a.username}?`),
      message: L("The imported posts and their history stay. The token is removed, so nothing new is fetched until the account is connected again.", "Hantaran yang diimport dan sejarahnya kekal. Token dibuang, jadi tiada yang baharu diambil sehingga akaun disambung semula."),
      confirmLabel: L("Disconnect", "Putuskan"),
      variant: "danger",
    });
    if (!ok) return;
    const r = await api<{ ok: boolean; error?: { message?: string } }>(`/accounts/${a.id}/disconnect`, { method: "POST" });
    if (r.ok) toast(L("Disconnected", "Diputuskan"), `@${a.username}`);
    else toast(L("Not disconnected", "Tidak diputuskan"), r.data?.error?.message ?? "", "notice");
    await loadAccounts();
    if (account === a.id) setAccount(0);
  };

  const saveLabel = async () => {
    if (!label) return;
    const r = await api<{ ok: boolean; error?: { message?: string } }>(`/accounts/${label.id}`, { method: "PUT", body: JSON.stringify({ display_label: label.v }) });
    if (r.ok) toast(L("Label saved", "Label disimpan"), label.v || L("(cleared)", "(dikosongkan)"));
    else toast(L("Label not saved", "Label tidak disimpan"), r.data?.error?.message ?? "", "notice");
    setLabel(null);
    await loadAccounts();
  };

  /* v1.94.0 — the setup check, on the screen instead of in a typed URL. It
     prints what the worker actually sends to Meta, so the two lines that
     have to match the dashboard can be read side by side. Nothing here is
     secret: the app id travels in every authorise URL, and the secret is
     reported only as set-or-not. */
  const [setup, setSetup] = useState<Record<string, unknown> | null>(null);
  const checkSetup = async () => {
    const r = await fetch("/api/v1/integrations/threads/connect?show=1", { credentials: "include" });
    const d = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (d) setSetup(d);
    else toast(L("Could not read the setup", "Tetapan tidak dapat dibaca"), L("The worker did not answer", "Pelayan tidak menjawab"), "notice");
  };

  const connect = () => {
    /* A browser redirect to Meta, not an API call: the worker sets the state
       cookie and sends the manager to the authorisation page. */
    window.location.href = "/api/v1/integrations/threads/connect";
  };

  const cur = summary?.this;
  const prev = summary?.prev;
  const maxHour = Math.max(1, ...(summary?.by_hour ?? []).map((h) => h.avg));
  const noAccounts = accLoaded && accounts.length === 0;

  return (
    <div className="grid grid-cols-1 gap-4">
      {toastNode}
      {confirmNode}
      <div className={card}>
        {/* header: title, account chips, section chooser */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Threads</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("What the account has published, what it earned, and when.", "Apa yang akaun siarkan, apa yang diperoleh, dan bila.")}
            </p>
          </div>
          {accounts.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {([{ id: 0, username: L("All", "Semua"), display_label: null }, ...accounts] as { id: number; username: string; display_label: string | null }[]).map((a) => (
                <button key={a.id} type="button" aria-pressed={account === a.id}
                  className={account === a.id
                    ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium"
                    : "border-border text-muted-foreground hover:bg-secondary/70 rounded-full border px-3 py-1 text-xs"}
                  onClick={() => setAccount(a.id)}>
                  {a.id ? `@${a.username}` : a.username}{a.display_label ? ` · ${a.display_label}` : ""}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {([
            ["overview", L("Overview", "Ringkasan")],
            ["library", L("Library", "Pustaka")],
            ["connection", L("Connection", "Sambungan")],
          ] as [Section, string][]).map(([key, lbl]) => (
            <button key={key} type="button"
              className={section === key
                ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium"
                : "border-border text-muted-foreground hover:bg-secondary/70 rounded-full border px-3 py-1 text-xs"}
              aria-pressed={section === key}
              onClick={() => setSection(key)}>
              {lbl}
            </button>
          ))}
        </div>

        {/* the one-line states that need no section */}
        {pending && (
          <p className="text-warning mt-3 text-xs">
            {L("The Threads tables are not on this database yet — run the deploy so migration 0105 applies.", "Jadual Threads belum ada pada pangkalan data ini — jalankan deploy supaya migrasi 0105 digunakan.")}
          </p>
        )}
        {!pending && accLoaded && !configured && (
          <p className="text-warning mt-3 text-xs">
            {L("The Threads app credentials are not set on the worker (THREADS_APP_ID and THREADS_APP_SECRET). Nothing can be connected until they are.", "Kelayakan aplikasi Threads belum ditetapkan pada pelayan (THREADS_APP_ID dan THREADS_APP_SECRET). Tiada yang boleh disambung sehingga ia ditetapkan.")}
          </p>
        )}
        {noAccounts && configured && !pending && section !== "connection" && (
          <p className="text-muted-foreground mt-3 text-xs">
            {L("No Threads account is connected yet.", "Belum ada akaun Threads disambungkan.")}{" "}
            <button type="button" className="text-primary underline" onClick={() => setSection("connection")}>
              {L("Open Connection", "Buka Sambungan")}
            </button>
          </p>
        )}
      </div>

      {/* ================= OVERVIEW ================= */}
      {section === "overview" && (
        <>
          <StatStrip>
            {!sumLoaded ? (
              Array.from({ length: 4 }, (_, i) => <Skel key={i} className="h-[92px] rounded-card" />)
            ) : (
              <>
                <StatTile label={L("Followers", "Pengikut")} value={compact(summary?.followers.now)} tone="brand"
                  hint={summary?.followers.now != null && summary.followers.start != null
                    ? `${summary.followers.now - summary.followers.start >= 0 ? "+" : ""}${num(summary.followers.now - summary.followers.start)} ${L("in 30 days", "dalam 30 hari")}`
                    : L("first snapshot after the next sync", "cerapan pertama selepas penyegerakan")} />
                <StatTile label={L("Views · 30 days", "Tontonan · 30 hari")} value={compact(cur?.views)} tone="info"
                  hint={delta(cur?.views, prev?.views)}
                  onClick={() => openLibrary("recent", "views")}
                  title={L("Open the last 30 days, most viewed first", "Buka 30 hari terakhir, paling banyak tontonan dahulu")} />
                <StatTile label={L("Views per post", "Tontonan setiap hantaran")} value={compact(cur?.avg_views)} tone="gold"
                  hint={delta(cur?.avg_views, prev?.avg_views)}
                  onClick={() => openLibrary("winners", "views")}
                  title={L("Open the posts at 2× baseline or better", "Buka hantaran 2× garis asas atau lebih")} />
                <StatTile label={L("Posts · 30 days", "Hantaran · 30 hari")} value={cur ? String(cur.posts) : "—"} tone="muted"
                  hint={cur?.engagement_pm != null ? `${(cur.engagement_pm / 10).toFixed(1)}% ${L("engagement", "penglibatan")}` : delta(cur?.posts, prev?.posts)}
                  onClick={() => openLibrary("recent", "date")}
                  title={L("Open the last 30 days, newest first", "Buka 30 hari terakhir, terbaharu dahulu")} />
              </>
            )}
          </StatStrip>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            {/* top five */}
            <div className={`${card} lg:col-span-3`}>
              <p className="text-sm font-semibold">{L("Top posts · 30 days", "Hantaran teratas · 30 hari")}</p>
              {!sumLoaded ? (
                <div className="mt-3 space-y-2">{Array.from({ length: 5 }, (_, i) => <Skel key={i} className="h-10" />)}</div>
              ) : !summary || summary.top.length === 0 ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  {L("No measured posts in this window yet — the sync fills these in.", "Belum ada hantaran diukur dalam tempoh ini — penyegerakan akan mengisinya.")}
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {summary.top.map((p) => (
                    <li key={p.id} className="py-2">
                      <button type="button" className="flex w-full items-start justify-between gap-3 text-left"
                        aria-expanded={openTop === p.id} onClick={() => setOpenTop(openTop === p.id ? null : p.id)}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{excerpt(p.text, 90) || <span className="text-muted-foreground">{L("(no text)", "(tiada teks)")}</span>}</span>
                          <span className="text-muted-foreground block text-[11px]">{dmyMYT(p.published_at)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                          <span title={L("Views", "Tontonan")}>{compact(p.views)}</span>
                          <Mult m={p.multiplier} />
                        </span>
                      </button>
                      {openTop === p.id && <PostBody p={p} />}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* by hour + media vs text */}
            <div className={`${card} lg:col-span-2`}>
              <p className="text-sm font-semibold">{L("Views by publishing hour", "Tontonan mengikut jam siaran")}</p>
              <p className="text-muted-foreground mt-0.5 text-[11px]">{L("Average views per post, Malaysia time, last 30 days", "Purata tontonan setiap hantaran, waktu Malaysia, 30 hari terakhir")}</p>
              {!sumLoaded ? (
                <div className="mt-3 space-y-1.5">{Array.from({ length: 6 }, (_, i) => <Skel key={i} className="h-4" />)}</div>
              ) : !summary || summary.by_hour.length === 0 ? (
                <p className="text-muted-foreground mt-2 text-xs">{L("Nothing measured yet.", "Belum ada yang diukur.")}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {summary.by_hour.map((h) => (
                    <li key={h.hour} className="flex items-center gap-2 text-[11px] tabular-nums">
                      <span className="text-muted-foreground w-10 shrink-0">{hourLabel(h.hour)}</span>
                      <span className="bg-secondary h-3 flex-1 overflow-hidden rounded-sm">
                        <span className="bg-tile-info block h-full rounded-sm" style={{ width: `${Math.max(2, Math.round((h.avg / maxHour) * 100))}%` }} />
                      </span>
                      <span className="w-14 shrink-0 text-right">{compact(h.avg)}</span>
                      <span className="text-muted-foreground w-8 shrink-0 text-right">×{h.posts}</span>
                    </li>
                  ))}
                </ul>
              )}
              {sumLoaded && summary && (summary.media_median != null || summary.text_median != null) && (
                <p className="text-muted-foreground mt-3 text-[11px]">
                  {L("Median views", "Median tontonan")}: {L("with media", "dengan media")} {num(summary.media_median)} · {L("text only", "teks sahaja")} {num(summary.text_median)}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ================= LIBRARY ================= */}
      {section === "library" && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5 text-xs">
              {([
                ["all", L("All", "Semua")],
                ["recent", L("Last 30 days", "30 hari terakhir")],
                ["winners", L("≥ 2× baseline", "≥ 2× garis asas")],
                ["media", L("With media", "Dengan media")],
                ["text", L("Text only", "Teks sahaja")],
              ] as [Filter, string][]).map(([k, lbl]) => (
                <button key={k} type="button" aria-pressed={filter === k}
                  className={`rounded-full px-2.5 py-1 ${filter === k ? "bg-primary text-primary-foreground font-medium" : "border-border text-muted-foreground hover:bg-secondary/70 border"}`}
                  onClick={() => setFilter(k)}>
                  {lbl}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select className={inputClassSm} value={month} onChange={(e) => setMonth(e.target.value)} aria-label={L("Month", "Bulan")}>
                <option value="">{L("Every month", "Setiap bulan")}</option>
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select className={inputClassSm} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={L("Sort", "Susun")}>
                <option value="date">{L("Newest first", "Terbaharu dahulu")}</option>
                <option value="views">{L("Most viewed first", "Paling ditonton dahulu")}</option>
              </select>
              <input className={`${inputClassSm} w-40`} value={qLive} onChange={(e) => setQLive(e.target.value)}
                placeholder={L("Find in text", "Cari dalam teks")} aria-label={L("Find in text", "Cari dalam teks")} />
              <button type="button" className={rowBtn} onClick={exportCsv} disabled={!libLoaded || posts.length === 0}>
                {L("Export CSV", "Eksport CSV")}
              </button>
            </div>
          </div>
          <p className="text-muted-foreground mt-2 text-[11px]">
            {!libLoaded ? <Skel className="inline-block h-3 w-28" /> : `${posts.length} ${L("of", "daripada")} ${total} ${L("posts", "hantaran")}`}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className={th}>{L("Published", "Disiarkan")}</th>
                  <th className={th}>{L("Post", "Hantaran")}</th>
                  <th className={th}>{L("Type", "Jenis")}</th>
                  <th className={thR2}>{L("Views", "Tontonan")}</th>
                  <th className={thR2}>{L("Likes", "Suka")}</th>
                  <th className={thR2}>{L("Replies", "Balasan")}</th>
                  <th className={thR2}>{L("× baseline", "× garis asas")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!libLoaded && Array.from({ length: 8 }, (_, i) => (
                  <tr key={i}><td className={td} colSpan={7}><Skel className="h-5" /></td></tr>
                ))}
                {libLoaded && posts.length === 0 && (
                  <tr><td className={`${td} text-muted-foreground`} colSpan={7}>
                    {accounts.length === 0
                      ? L("Connect an account and the history arrives here.", "Sambungkan akaun dan sejarahnya tiba di sini.")
                      : L("No posts match this filter.", "Tiada hantaran sepadan dengan tapisan ini.")}
                  </td></tr>
                )}
                {libLoaded && posts.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{dmyMYT(p.published_at)}</td>
                    <td className={`${td} max-w-[420px]`}>
                      <button type="button" className="w-full text-left" aria-expanded={openRow === p.id}
                        onClick={() => setOpenRow(openRow === p.id ? null : p.id)}>
                        {excerpt(p.text) || <span className="text-muted-foreground">{L("(no text)", "(tiada teks)")}</span>}
                      </button>
                      {openRow === p.id && <PostBody p={p} />}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{typeLabel(p.media_type)}{p.language_guess ? <span className="text-muted-foreground"> · {p.language_guess.toUpperCase()}</span> : null}</td>
                    <td className={tdR2}>{num(p.views)}</td>
                    <td className={tdR2}>{num(p.likes)}</td>
                    <td className={tdR2}>{num(p.replies)}</td>
                    <td className={tdR2}><Mult m={p.multiplier} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= CONNECTION ================= */}
      {section === "connection" && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{L("Connected accounts", "Akaun yang disambungkan")}</p>
            {canManage && configured && !pending && (
              <span className="flex flex-wrap gap-1.5">
                <button type="button" className={rowBtn} onClick={() => void checkSetup()}>
                  {L("Check setup", "Semak tetapan")}
                </button>
                <button type="button" className={rowBtnPrimary} onClick={connect}>
                  {L("Connect a Threads account", "Sambungkan akaun Threads")}
                </button>
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {L("Each account is a Threads Tester on the Meta app. The token lasts 60 days and is refreshed by the worker inside its last 35; if it ever lapses, connect the account again here.", "Setiap akaun ialah Threads Tester pada aplikasi Meta. Token bertahan 60 hari dan disegarkan oleh pelayan dalam 35 hari terakhirnya; jika ia luput, sambungkan semula akaun di sini.")}
          </p>
          {setup && (
            <div className="bg-secondary/40 mt-3 rounded-lg p-3 text-xs">
              <p className="font-medium">{L("What this worker sends to Meta", "Apa yang pelayan ini hantar ke Meta")}</p>
              <dl className="mt-1.5 space-y-1">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground w-28 shrink-0">client_id</dt>
                  <dd className="font-mono break-all">
                    {String(setup.client_id ?? "")}
                    {setup.client_id_had_whitespace ? <span className="text-danger font-sans font-medium"> · {L("has stray whitespace — set it again", "ada ruang tersasar — tetapkan semula")}</span> : null}
                    {setup.client_id_looks_right === false ? <span className="text-warning font-sans font-medium"> · {L("a Threads App ID is all digits — this may be the wrong value", "ID Aplikasi Threads semuanya digit — ini mungkin nilai yang salah")}</span> : null}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground w-28 shrink-0">redirect_uri</dt>
                  <dd className="font-mono break-all">{String(setup.redirect_uri ?? "")}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground w-28 shrink-0">{L("secret", "rahsia")}</dt>
                  <dd>
                    {setup.secret_set ? L("set", "ditetapkan") : <span className="text-danger">{L("NOT set", "TIDAK ditetapkan")}</span>}
                    {setup.secret_had_whitespace ? <span className="text-danger"> · {L("has stray whitespace — set it again", "ada ruang tersasar — tetapkan semula")}</span> : null}
                  </dd>
                </div>
              </dl>
              <p className="text-muted-foreground mt-2">
                {L("Both lines must match Use cases → Threads API → Customize → Settings — the Threads App ID (not the Meta App ID), and the Redirect Callback URLs list. The Uninstall and Delete callback fields on that page must not be empty.",
                   "Kedua-dua baris mesti sepadan dengan Use cases → Threads API → Customize → Settings — ID Aplikasi Threads (bukan ID Aplikasi Meta), dan senarai Redirect Callback URLs. Medan Uninstall dan Delete pada halaman itu tidak boleh kosong.")}
              </p>
              <button type="button" className="text-primary mt-1.5 underline" onClick={() => setSetup(null)}>{L("Hide", "Sembunyi")}</button>
            </div>
          )}
          {!accLoaded ? (
            <div className="mt-3 space-y-2">{Array.from({ length: 2 }, (_, i) => <Skel key={i} className="h-16" />)}</div>
          ) : accounts.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-xs">
              {canManage
                ? L("Nothing connected yet. Press the button above, sign in to Threads as the account, and allow the three permissions.", "Belum ada yang disambungkan. Tekan butang di atas, log masuk ke Threads sebagai akaun itu, dan benarkan tiga kebenaran.")
                : L("Nothing connected yet. A manager connects the account here.", "Belum ada yang disambungkan. Pengurus menyambungkan akaun di sini.")}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {accounts.map((a) => {
                const left = daysLeft(a.token_expires_at);
                const tokenTone = left == null ? "text-danger" : left <= 10 ? "text-warning" : "text-muted-foreground";
                return (
                  <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        @{a.username}
                        {label?.id === a.id ? (
                          <span className="ml-2 inline-flex items-center gap-1">
                            <input className={`${inputClassSm} w-32`} value={label.v} autoFocus
                              onChange={(e) => setLabel({ id: a.id, v: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") void saveLabel(); if (e.key === "Escape") setLabel(null); }} />
                            <button type="button" className={rowBtn} onClick={() => void saveLabel()}>{L("Save", "Simpan")}</button>
                          </span>
                        ) : (
                          <>
                            {a.display_label && <span className="text-muted-foreground ml-2 text-xs">· {a.display_label}</span>}
                            {canManage && (
                              <button type="button" className="text-primary ml-2 text-[11px] underline" onClick={() => setLabel({ id: a.id, v: a.display_label ?? "" })}>
                                {L("label", "label")}
                              </button>
                            )}
                          </>
                        )}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-[11px]">
                        {L("Connected", "Disambungkan")} {dmyMYT(a.connected_at)}{a.connected_by_name ? ` · ${a.connected_by_name}` : ""}
                        {" · "}{num(a.posts)} {L("posts imported", "hantaran diimport")}
                        {a.sync_state === "importing" && ` · ${L("history still importing", "sejarah masih diimport")}`}
                      </p>
                      <p className={`mt-0.5 text-[11px] ${tokenTone}`}>
                        {left == null
                          ? L("No token — connect again", "Tiada token — sambung semula")
                          : left < 0 ? L("Token expired — connect again", "Token luput — sambung semula")
                          : `${L("Token expires in", "Token luput dalam")} ${left} ${L("days", "hari")}`}
                        {" · "}{L("last sync", "penyegerakan terakhir")} {a.last_sync_at ? dmyMYT(a.last_sync_at) : L("never", "tidak pernah")}
                        {a.metrics_on ? ` · ${L("followers as of", "pengikut setakat")} ${a.metrics_on}` : ""}
                      </p>
                      {a.sync_error && <p className="text-danger mt-0.5 text-[11px]">{a.sync_error}</p>}
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1.5">
                        <button type="button" className={rowBtn} disabled={busy === a.id} onClick={() => void syncNow(a)}>
                          {busy === a.id ? <Skel className="inline-block h-3 w-14" /> : L("Sync now", "Segerak sekarang")}
                        </button>
                        <button type="button" className={rowBtnDanger} onClick={() => void disconnect(a)}>
                          {L("Disconnect", "Putuskan")}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

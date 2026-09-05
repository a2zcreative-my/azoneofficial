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

interface Topic {
  id: number; label: string; query: string; search_type: string;
  last_run_at: string | null; last_error: string | null; created_by_name: string | null;
  posts: number; accounts: number;
}
interface StudyPost {
  id: number; media_id: string; username: string | null; text: string | null; permalink: string | null;
  media_type: string | null; published_at: string | null; char_count: number;
  has_number_hook: number; has_question_hook: number; has_cta: number; has_media: number;
  language_guess: string | null; found_at: string;
}
interface Findings {
  posts: number; accounts: number; with_media: number; median_chars: number | null;
  languages: { code: string; n: number }[];
  lengths: { bucket: string; n: number }[];
  hours: { hour: number; n: number }[];
  traits: { number_hook: number; question_hook: number; cta: number };
  words: { word: string; n: number }[];
}
interface Quota { used: number; left: number; cap: number }

type Section = "overview" | "library" | "study" | "connection";
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

/** "37% (14)" — a share and the count it came from, because a percentage
    of nine posts is a percentage nobody should act on alone. */
const share = (k: number, of: number): string => (of === 0 ? "—" : `${Math.round((k / of) * 100)}% (${k})`);

/** One finding, as a labelled bar. Module scope, per guard #30. */
function Bar({ label, n, of }: { label: string; n: number; of: number }) {
  return (
    <li className="flex items-center gap-2 text-[11px]">
      <span className="text-muted-foreground w-20 shrink-0 truncate">{label}</span>
      <span className="bg-secondary h-3 flex-1 overflow-hidden rounded-sm">
        <span className="bg-tile-info block h-full rounded-sm" style={{ width: `${of ? Math.max(2, Math.round((n / of) * 100)) : 0}%` }} />
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums">{share(n, of)}</span>
    </li>
  );
}

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

  /* ---- study cases (v1.96.0) ---- */
  const [topics, setTopics] = useState<Topic[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [topicsLoaded, setTopicsLoaded] = useState(false);
  const [topic, setTopic] = useState<number | 0>(0);
  const [studyPosts, setStudyPosts] = useState<StudyPost[]>([]);
  const [findings, setFindings] = useState<Findings | null>(null);
  const [studyLoaded, setStudyLoaded] = useState(false);
  const [studyQ, setStudyQ] = useState("");
  const [newTopic, setNewTopic] = useState({ label: "", query: "", search_type: "keyword" });
  const [searching, setSearching] = useState(false);
  const [openStudy, setOpenStudy] = useState<number | null>(null);

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

  const loadTopics = useCallback(async () => {
    const r = await api<{ topics: Topic[]; quota: Quota; can_manage?: boolean }>(`/topics`);
    if (r.ok && r.data) {
      setTopics(r.data.topics ?? []);
      setQuota(r.data.quota ?? null);
      setTopic((t) => (t || r.data!.topics?.[0]?.id) ?? 0);
    }
    setTopicsLoaded(true);
  }, []);
  useEffect(() => { if (section === "study") void loadTopics(); }, [section, loadTopics]);

  const loadStudy = useCallback(async () => {
    if (!topic) { setStudyPosts([]); setFindings(null); setStudyLoaded(true); return; }
    setStudyLoaded(false);
    const r = await api<{ posts: StudyPost[]; findings: Findings }>(`/study?topic=${topic}${studyQ ? `&q=${encodeURIComponent(studyQ)}` : ""}`);
    if (r.ok && r.data) { setStudyPosts(r.data.posts ?? []); setFindings(r.data.findings ?? null); }
    else { setStudyPosts([]); setFindings(null); }
    setStudyLoaded(true);
  }, [topic, studyQ]);
  useEffect(() => { if (section === "study") void loadStudy(); }, [section, loadStudy]);

  const addTopic = async () => {
    if (!newTopic.label.trim() || !newTopic.query.trim()) {
      toast(L("Not added", "Tidak ditambah"), L("A name and something to search for are both needed", "Nama dan sesuatu untuk dicari kedua-duanya diperlukan"), "notice");
      return;
    }
    const r = await api<{ ok: boolean; error?: { message?: string } }>(`/topics`, { method: "POST", body: JSON.stringify(newTopic) });
    if (r.ok) {
      toast(L("Topic added", "Topik ditambah"), `${newTopic.label} · ${newTopic.query}`);
      setNewTopic({ label: "", query: "", search_type: "keyword" });
      await loadTopics();
    } else {
      toast(L("Not added", "Tidak ditambah"), r.data?.error?.message ?? "", "notice");
    }
  };

  const removeTopic = async (t: Topic) => {
    const ok = await confirm({
      title: L(`Remove "${t.label}"?`, `Buang "${t.label}"?`),
      message: L(`The ${t.posts} posts collected for it go too. The weekly search allowance is not refunded.`,
                 `${t.posts} hantaran yang dikumpul untuknya turut dibuang. Peruntukan carian mingguan tidak dikembalikan.`),
      confirmLabel: L("Remove", "Buang"), variant: "danger",
    });
    if (!ok) return;
    const r = await api<{ ok: boolean; error?: { message?: string } }>(`/topics/${t.id}`, { method: "DELETE" });
    if (r.ok) toast(L("Topic removed", "Topik dibuang"), t.label);
    else toast(L("Not removed", "Tidak dibuang"), r.data?.error?.message ?? "", "notice");
    if (topic === t.id) setTopic(0);
    await loadTopics();
  };

  const runSearch = async (t: Topic) => {
    setSearching(true);
    const r = await api<{ ok: boolean; found?: number; scanned?: number; note?: string | null; reason?: string; needs_reconnect?: boolean; quota?: Quota; error?: { message?: string } }>(
      `/topics/${t.id}/search`, { method: "POST" },
    );
    setSearching(false);
    if (r.data?.quota) setQuota(r.data.quota);
    if (r.ok && r.data?.ok) {
      const scanned = r.data.scanned ?? 0;
      const found = r.data.found ?? 0;
      /* v1.96.1 — "12 posts back" hid whether anything was new. Say both:
         what came back, and how many the study had not seen before. */
      toast(L("Searched", "Dicari"),
        `${t.label}: ${scanned} ${L("posts back", "hantaran diterima")}, ${found} ${L("new", "baharu")}${r.data.note ? ` — ${r.data.note}` : ""}`,
        r.data.note ? "notice" : undefined);
    } else if (r.data?.needs_reconnect) {
      toast(L("Search not allowed yet", "Carian belum dibenarkan"),
        L("This account was connected before search was added. Reconnect it on the Connection section to grant it.",
          "Akaun ini disambung sebelum carian ditambah. Sambung semula pada bahagian Sambungan untuk membenarkannya."), "notice");
    } else {
      toast(L("Search failed", "Carian gagal"), r.data?.reason ?? r.data?.error?.message ?? "", "notice");
    }
    await Promise.all([loadTopics(), loadStudy()]);
  };

  const exportStudy = () => {
    const t = topics.find((x) => x.id === topic);
    downloadCsv(`threads-study-${(t?.label ?? "topic").replace(/\W+/g, "-").toLowerCase()}`, [
      [`# ${L("Study case", "Kajian kes")}: ${t?.label ?? ""} — ${t?.query ?? ""}`],
      [`# ${L("Generated", "Dijana")} ${csvStampMyt()} — ${studyPosts.length} ${L("public posts", "hantaran awam")}`],
      [`# ${L("Public posts carry no view counts — these are the words, not the reach", "Hantaran awam tiada kiraan tontonan — ini perkataannya, bukan jangkauannya")}`],
      [],
      [L("Published (MYT)", "Disiarkan (MYT)"), L("Account", "Akaun"), L("Type", "Jenis"), L("Language", "Bahasa"),
       L("Characters", "Aksara"), L("Number hook", "Cangkuk nombor"), L("Question hook", "Cangkuk soalan"),
       L("Call to action", "Ajakan bertindak"), L("Link", "Pautan"), L("Text", "Teks")],
      ...studyPosts.map((p) => [
        dmyMYT(p.published_at), p.username ? `@${p.username}` : "", typeLabel(p.media_type ?? ""),
        p.language_guess ?? "", p.char_count,
        p.has_number_hook ? "yes" : "", p.has_question_hook ? "yes" : "", p.has_cta ? "yes" : "",
        p.permalink ?? "", p.text ?? "",
      ]),
    ]);
  };

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
            ["study", L("Study", "Kajian")],
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

      {/* ================= STUDY ================= *
          CEO, 05-09-2026: *"I want to view only for study case on Product and
          Service like Hotel, product for Tudung."* Not our account - the
          SUBJECT. What a niche looks like on Threads, so a pitch or a
          content plan starts from what it actually does.

          THE ONE THING THIS CANNOT SHOW is reach: view counts belong to the
          account that owns a post, so a stranger's post arrives as words,
          author, time, format and link. Every figure below is therefore
          about the WRITING, and the card says so once rather than letting
          somebody read a share of posts as a share of eyeballs. */}
      {section === "study" && (
        <>
          <div className={card}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{L("Study cases", "Kajian kes")}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {L("What other people post about a subject — hotels, tudung, whatever the next client sells. Public posts carry no view counts, so these are findings about the writing, not about reach.",
                     "Apa yang orang lain siarkan tentang sesuatu subjek — hotel, tudung, apa sahaja yang klien seterusnya jual. Hantaran awam tiada kiraan tontonan, jadi ini penemuan tentang penulisan, bukan jangkauan.")}
                </p>
              </div>
              {quota && (
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${quota.left <= 25 ? "bg-danger-soft text-danger" : quota.left <= 100 ? "bg-warning-soft text-warning" : "bg-secondary text-muted-foreground"}`}
                  title={L("Threads rations keyword searches per rolling 7 days, for the whole app. One run spends two: the top posts, then the newest.", "Threads mencatu carian kata kunci setiap 7 hari bergolek, untuk keseluruhan aplikasi. Satu larian guna dua: hantaran teratas, kemudian terbaharu.")}>
                  {quota.left} / {quota.cap} {L("searches left this week", "carian tinggal minggu ini")}
                </span>
              )}
            </div>

            {!topicsLoaded ? (
              <div className="mt-3 flex flex-wrap gap-1.5">{Array.from({ length: 3 }, (_, i) => <Skel key={i} className="h-7 w-28 rounded-full" />)}</div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {topics.map((t) => (
                  <button key={t.id} type="button" aria-pressed={topic === t.id}
                    className={topic === t.id
                      ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium"
                      : "border-border text-muted-foreground hover:bg-secondary/70 rounded-full border px-3 py-1 text-xs"}
                    title={`${t.query}${t.last_run_at ? ` · ${L("last searched", "carian terakhir")} ${dmyMYT(t.last_run_at)}` : ""}`}
                    onClick={() => setTopic(t.id)}>
                    {t.label} <span className="opacity-70">{t.posts}</span>
                  </button>
                ))}
                {topics.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    {canManage
                      ? L("No topics yet. Add one below — a name you will recognise, and the words to search for.", "Belum ada topik. Tambah satu di bawah — nama yang anda kenali, dan perkataan untuk dicari.")
                      : L("No topics yet. A manager adds them.", "Belum ada topik. Pengurus menambahnya.")}
                  </p>
                )}
              </div>
            )}

            {canManage && (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                <input className={inputClassSm} value={newTopic.label} maxLength={60}
                  placeholder={L("Name — e.g. Hotel", "Nama — cth. Hotel")}
                  aria-label={L("Topic name", "Nama topik")}
                  onChange={(e) => setNewTopic((d) => ({ ...d, label: e.target.value }))} />
                <input className={inputClassSm} value={newTopic.query} maxLength={100}
                  placeholder={L("Search for — e.g. tudung", "Cari — cth. tudung")}
                  aria-label={L("Search words", "Perkataan carian")}
                  onChange={(e) => setNewTopic((d) => ({ ...d, query: e.target.value }))} />
                <select className={inputClassSm} value={newTopic.search_type} aria-label={L("Search kind", "Jenis carian")}
                  onChange={(e) => setNewTopic((d) => ({ ...d, search_type: e.target.value }))}>
                  <option value="keyword">{L("words in the post", "perkataan dalam hantaran")}</option>
                  <option value="tag">{L("topic tag", "tag topik")}</option>
                </select>
                <button type="button" className={rowBtn} onClick={() => void addTopic()}>{L("Add topic", "Tambah topik")}</button>
              </div>
            )}

            {topic > 0 && (() => {
              const t = topics.find((x) => x.id === topic);
              if (!t) return null;
              return (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {L("Searching for", "Mencari")} <span className="text-foreground font-medium">{t.query}</span>
                    {t.search_type === "tag" ? ` (${L("topic tag", "tag topik")})` : ""}
                    {t.last_run_at ? ` · ${L("last run", "kali terakhir")} ${dmyMYT(t.last_run_at)}` : ` · ${L("never run", "belum dijalankan")}`}
                    {t.accounts > 0 ? ` · ${t.accounts} ${L("accounts", "akaun")}` : ""}
                  </span>
                  {canManage && (
                    <>
                      <button type="button" className={rowBtn} disabled={searching || (quota?.left ?? 1) <= 0}
                        onClick={() => void runSearch(t)}>
                        {searching ? <Skel className="inline-block h-3 w-16" /> : L("Search now", "Cari sekarang")}
                      </button>
                      <button type="button" className={rowBtnDanger} onClick={() => void removeTopic(t)}>{L("Remove", "Buang")}</button>
                    </>
                  )}
                  {t.last_error && <span className="text-danger">{t.last_error}</span>}
                </div>
              );
            })()}
          </div>

          {topic > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              {/* what the niche does */}
              <div className={`${card} lg:col-span-2`}>
                <p className="text-sm font-semibold">{L("What this niche does", "Apa yang niche ini buat")}</p>
                {!studyLoaded ? (
                  <div className="mt-3 space-y-2">{Array.from({ length: 6 }, (_, i) => <Skel key={i} className="h-4" />)}</div>
                ) : !findings || findings.posts === 0 ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {L("Nothing collected yet — press Search now.", "Belum ada yang dikumpul — tekan Cari sekarang.")}
                  </p>
                ) : (
                  <div className="mt-2 space-y-3 text-xs">
                    <p className="text-muted-foreground">
                      {findings.posts} {L("posts", "hantaran")} · {findings.accounts} {L("accounts", "akaun")}
                      {findings.median_chars != null && ` · ${L("median", "median")} ${findings.median_chars} ${L("characters", "aksara")}`}
                    </p>
                    <div>
                      <p className="mb-1 font-medium">{L("How they open", "Cara mereka mula")}</p>
                      <ul className="space-y-1">
                        <Bar label={L("a number", "nombor")} n={findings.traits.number_hook} of={findings.posts} />
                        <Bar label={L("a question", "soalan")} n={findings.traits.question_hook} of={findings.posts} />
                        <Bar label={L("a call to act", "ajakan")} n={findings.traits.cta} of={findings.posts} />
                        <Bar label={L("with media", "dengan media")} n={findings.with_media} of={findings.posts} />
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 font-medium">{L("How long", "Berapa panjang")}</p>
                      <ul className="space-y-1">
                        {findings.lengths.map((b) => <Bar key={b.bucket} label={b.bucket} n={b.n} of={findings.posts} />)}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 font-medium">{L("Which language", "Bahasa apa")}</p>
                      <ul className="space-y-1">
                        {findings.languages.map((l) => (
                          <Bar key={l.code} label={l.code === "ms" ? L("Malay", "Melayu") : l.code === "en" ? L("English", "Inggeris") : L("unclear", "tidak jelas")} n={l.n} of={findings.posts} />
                        ))}
                      </ul>
                    </div>
                    {findings.words.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium">{L("Words they use", "Perkataan yang digunakan")}</p>
                        <div className="flex flex-wrap gap-1">
                          {findings.words.slice(0, 24).map((w) => (
                            <button key={w.word} type="button"
                              className="bg-secondary hover:bg-secondary/70 rounded-full px-2 py-0.5 text-[11px]"
                              title={L(`in ${w.n} posts — press to read them`, `dalam ${w.n} hantaran — tekan untuk membacanya`)}
                              onClick={() => setStudyQ(w.word)}>
                              {w.word} <span className="text-muted-foreground">{w.n}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* the posts themselves */}
              <div className={`${card} lg:col-span-3`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{L("The posts", "Hantaran")}</p>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <input className={`${inputClassSm} w-40`} value={studyQ}
                      placeholder={L("Find in text", "Cari dalam teks")} aria-label={L("Find in text", "Cari dalam teks")}
                      onChange={(e) => setStudyQ(e.target.value)} />
                    {studyQ && (
                      <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setStudyQ("")}>
                        {L("Clear", "Kosongkan")}
                      </button>
                    )}
                    <button type="button" className={rowBtn} onClick={exportStudy} disabled={!studyLoaded || studyPosts.length === 0}>
                      {L("Export CSV", "Eksport CSV")}
                    </button>
                  </span>
                </div>
                {!studyLoaded ? (
                  <div className="mt-3 space-y-2">{Array.from({ length: 6 }, (_, i) => <Skel key={i} className="h-10" />)}</div>
                ) : studyPosts.length === 0 ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {studyQ ? L("No post here uses that word.", "Tiada hantaran menggunakan perkataan itu.")
                            : L("Nothing collected yet — press Search now.", "Belum ada yang dikumpul — tekan Cari sekarang.")}
                  </p>
                ) : (
                  <ul className="divide-border mt-2 max-h-[32rem] divide-y overflow-y-auto">
                    {studyPosts.map((p) => (
                      <li key={p.id} className="py-2">
                        <button type="button" className="w-full text-left" aria-expanded={openStudy === p.id}
                          onClick={() => setOpenStudy(openStudy === p.id ? null : p.id)}>
                          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                            <span className="text-xs font-medium">{p.username ? `@${p.username}` : L("unknown", "tidak diketahui")}</span>
                            <span className="text-muted-foreground text-[11px]">
                              {p.published_at ? dmyMYT(p.published_at) : ""} · {typeLabel(p.media_type ?? "")} · {p.char_count} {L("chars", "aksara")}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-sm">{excerpt(p.text, 160) || <span className="text-muted-foreground">{L("(no text)", "(tiada teks)")}</span>}</span>
                        </button>
                        {openStudy === p.id && <PostBody p={{ text: p.text, permalink: p.permalink }} />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
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

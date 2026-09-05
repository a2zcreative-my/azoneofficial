"use client";

/**
 * The Threads tab — the study room.
 *
 * v1.89.0 opened this as a workspace for the connected account's own posts
 * (Overview, Library). v1.96.0 added Study. On 05-09-2026 the CEO decided
 * which one the tab is for: *"remove library since this is not supposed to
 * view by my staff. the objective for this Threads to make them to find a
 * study case based on the market research and the demand based on the
 * keywords that they want. and the data should not keep too much since it is
 * only for 7 days for them to study."*
 *
 * So, from v1.99.0, ONE TAB, TWO SECTIONS:
 *
 *   STUDY       saved topics (a name and the words to search), the public
 *               posts the search found for each, and what they add up to:
 *               Malaysian or not (with the reason), asking or selling, how
 *               the niche writes. Every staff role with threads_view sees
 *               this and only this.
 *   CONNECTION  management only: the account whose token the search asks
 *               with, connect / disconnect / label, the setup check.
 *
 * WHAT IS KEPT, AND FOR HOW LONG. A found post lives seven days from the day
 * it was found, a topic holds at most 400, and there are at most 40 topics;
 * the worker purges on every cron tick and the Study header shows what the
 * database holds right now. Nothing about a person is looked up or stored:
 * a found post is text, handle, time, format and link.
 */

import { useCallback, useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Skel } from "@/components/ui/skeleton";
import { rowBtn, rowBtnDanger, rowBtnPrimary } from "@/components/ui/row-button";
import { card, inputClassSm } from "@/lib/ui-styles";
import { downloadCsv, csvStampMyt } from "@/lib/csv";
import { dmyMYT } from "@/lib/format";
import { getLang } from "@/lib/i18n";

const api = makeApi("/staff/threads");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Account {
  id: number; username: string; display_label: string | null; connected_at: string;
  token_expires_at: string | null; connected_by_name: string | null; can_search?: number;
}
interface Topic {
  id: number; label: string; query: string; search_type: string;
  last_run_at: string | null; last_error: string | null; created_by_name: string | null;
  posts: number; accounts: number; my_posts?: number; asking_posts?: number; last_note?: string | null;
}
interface StudyPost {
  id: number; media_id: string; username: string | null; text: string | null; permalink: string | null;
  media_type: string | null; published_at: string | null; char_count: number;
  has_number_hook: number; has_question_hook: number; has_cta: number; has_media: number;
  language_guess: string | null; found_at: string;
  /* v1.97.0 — what the text gives away about being Malaysian, and why */
  my_signal?: number; my_reasons?: string | null;
  intent?: Intent | null;
}
interface Findings {
  posts: number; accounts: number; with_media: number; median_chars: number | null;
  languages: { code: string; n: number }[];
  lengths: { bucket: string; n: number }[];
  hours: { hour: number; n: number }[];
  traits: { number_hook: number; question_hook: number; cta: number };
  words: { word: string; n: number }[];
  /* v1.98.0 — demand vs supply */
  intents?: { asking: number; selling: number; other: number };
  ask_words?: { word: string; n: number }[];
}
type Intent = "asking" | "selling" | "other";
interface Quota { used: number; left: number; cap: number }

/* v1.99.0 — two sections. Overview and Library showed the connected
   account's OWN posts and numbers; the CEO: "remove library since this is
   not supposed to view by my staff". Connection is management's. */
type Section = "study" | "connection";

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

  const [section, setSection] = useState<Section>("study");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [configured, setConfigured] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [pending, setPending] = useState(false);
  const [accLoaded, setAccLoaded] = useState(false);
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
  /* v1.97.0 (CEO: "search and filter the Threads post by malaysia users") —
     on by default: the study is for Malaysian marketing, so the Malaysian
     posts are the reading and "All" is the check. Threads carries no
     country, so "Malaysian" means the post itself says so. */
  const [onlyMy, setOnlyMy] = useState(true);
  const [myTotal, setMyTotal] = useState(0);
  /* v1.98.0 (CEO: "find if there is anyone users in Malaysia looking for the
     keywords") — asking / selling / all. Demand is the asking posts. */
  const [intent, setIntent] = useState<Intent | null>(null);
  const [intents, setIntents] = useState<{ asking: number; selling: number; other: number } | null>(null);
  const [studyTotal, setStudyTotal] = useState(0);
  const [newTopic, setNewTopic] = useState({ label: "", query: "", search_type: "keyword" });
  const [searching, setSearching] = useState(false);
  const [openStudy, setOpenStudy] = useState<number | null>(null);
  /* v1.96.2 — why a search cannot be spent right now, known before the
     button is pressed: no account, or a token from before search existed. */
  const [searchBlocker, setSearchBlocker] = useState<"no_account" | "needs_reconnect" | null>(null);
  /* v1.99.0 — what the database holds right now; the week is a figure on
     screen, not a promise. */
  const [storage, setStorage] = useState<{ posts: number; searches: number; topics: number; oldest: string | null; keep_days: number; posts_per_topic: number; max_topics: number } | null>(null);

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

  const loadTopics = useCallback(async () => {
    const r = await api<{ topics: Topic[]; quota: Quota; can_manage?: boolean; search_blocker?: "no_account" | "needs_reconnect" | null;
      storage?: { posts: number; searches: number; topics: number; oldest: string | null; keep_days: number; posts_per_topic: number; max_topics: number } }>(`/topics`);
    if (r.ok && r.data) {
      setTopics(r.data.topics ?? []);
      setQuota(r.data.quota ?? null);
      setSearchBlocker(r.data.search_blocker ?? null);
      setStorage(r.data.storage ?? null);
      setTopic((t) => (t || r.data!.topics?.[0]?.id) ?? 0);
    }
    setTopicsLoaded(true);
  }, []);
  useEffect(() => { if (section === "study") void loadTopics(); }, [section, loadTopics]);

  const loadStudy = useCallback(async () => {
    if (!topic) { setStudyPosts([]); setFindings(null); setStudyLoaded(true); return; }
    setStudyLoaded(false);
    const r = await api<{ posts: StudyPost[]; findings: Findings; total?: number; my_total?: number; intents?: { asking: number; selling: number; other: number } }>(
      `/study?topic=${topic}${onlyMy ? "&my=1" : ""}${intent ? `&intent=${intent}` : ""}${studyQ ? `&q=${encodeURIComponent(studyQ)}` : ""}`,
    );
    if (r.ok && r.data) {
      setStudyPosts(r.data.posts ?? []); setFindings(r.data.findings ?? null);
      setMyTotal(r.data.my_total ?? 0); setStudyTotal(r.data.total ?? 0); setIntents(r.data.intents ?? null);
    } else { setStudyPosts([]); setFindings(null); }
    setStudyLoaded(true);
  }, [topic, studyQ, onlyMy, intent]);
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
      [`# ${L("Generated", "Dijana")} ${csvStampMyt()} — ${studyPosts.length} ${L("public posts", "hantaran awam")}${onlyMy ? ` — ${L("Malaysian posts only (the text itself says so)", "Hantaran Malaysia sahaja (teksnya sendiri menunjukkannya)")}` : ""}`],
      [`# ${L("Public posts carry no view counts — these are the words, not the reach", "Hantaran awam tiada kiraan tontonan — ini perkataannya, bukan jangkauannya")}`],
      [],
      [L("Published (MYT)", "Disiarkan (MYT)"), L("Account", "Akaun"), L("Type", "Jenis"), L("Language", "Bahasa"),
       L("Characters", "Aksara"), L("Number hook", "Cangkuk nombor"), L("Question hook", "Cangkuk soalan"),
       L("Call to action", "Ajakan bertindak"), L("Malaysian", "Malaysia"), L("Why", "Sebab"), L("Asking or selling", "Bertanya atau menjual"), L("Link", "Pautan"), L("Text", "Teks")],
      ...studyPosts.map((p) => [
        dmyMYT(p.published_at), p.username ? `@${p.username}` : "", typeLabel(p.media_type ?? ""),
        p.language_guess ?? "", p.char_count,
        p.has_number_hook ? "yes" : "", p.has_question_hook ? "yes" : "", p.has_cta ? "yes" : "",
        p.my_signal ? "yes" : "", p.my_reasons ?? "", p.intent ?? "",
        p.permalink ?? "", p.text ?? "",
      ]),
    ]);
  };

  const disconnect = async (a: Account) => {
    const ok = await confirm({
      title: L(`Disconnect @${a.username}?`, `Putuskan @${a.username}?`),
      message: L("The token is removed, so no search can be run until an account is connected again. Study topics and what they found stay until their week is up.", "Token dibuang, jadi tiada carian boleh dijalankan sehingga akaun disambung semula. Topik kajian dan hasilnya kekal sehingga minggunya tamat."),
      confirmLabel: L("Disconnect", "Putuskan"),
      variant: "danger",
    });
    if (!ok) return;
    const r = await api<{ ok: boolean; error?: { message?: string } }>(`/accounts/${a.id}/disconnect`, { method: "POST" });
    if (r.ok) toast(L("Disconnected", "Diputuskan"), `@${a.username}`);
    else toast(L("Not disconnected", "Tidak diputuskan"), r.data?.error?.message ?? "", "notice");
    await loadAccounts();
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
              {L("Study cases from public Threads posts: what people in a niche ask for and offer, kept for seven days.", "Kajian kes daripada hantaran Threads awam: apa yang orang dalam sesuatu niche cari dan tawarkan, disimpan tujuh hari.")}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {([
            ["study", L("Study", "Kajian")],
            ...(canManage ? [["connection", L("Connection", "Sambungan")] as [Section, string]] : []),
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
              <span className="flex flex-wrap items-center gap-1.5">
              {storage && (
                <span className="bg-secondary text-muted-foreground rounded-full px-2.5 py-1 text-[11px] font-medium"
                  title={L(`A found post is deleted ${storage.keep_days} days after it was found; a topic holds at most ${storage.posts_per_topic} posts; at most ${storage.max_topics} topics. The worker purges on every tick.`,
                           `Hantaran yang ditemui dipadam ${storage.keep_days} hari selepas ditemui; satu topik memuatkan paling banyak ${storage.posts_per_topic} hantaran; paling banyak ${storage.max_topics} topik. Pelayan membersihkan pada setiap kitaran.`)}>
                  {L("Kept", "Disimpan")} {storage.keep_days} {L("days", "hari")} · {storage.posts} {L("posts on file", "hantaran dalam simpanan")}
                </span>
              )}
              {quota && (
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${quota.left <= 25 ? "bg-danger-soft text-danger" : quota.left <= 100 ? "bg-warning-soft text-warning" : "bg-secondary text-muted-foreground"}`}
                  title={L("Threads rations keyword searches per rolling 7 days, for the whole app. One run spends two: the top posts, then the newest.", "Threads mencatu carian kata kunci setiap 7 hari bergolek, untuk keseluruhan aplikasi. Satu larian guna dua: hantaran teratas, kemudian terbaharu.")}>
                  {quota.left} / {quota.cap} {L("searches left this week", "carian tinggal minggu ini")}
                </span>
              )}
              </span>
            </div>

            {topicsLoaded && searchBlocker && (
              /* v1.96.2 — said before a search is spent, in words that name
                 the fix. Meta's own answer to this state is "An unknown
                 error occurred". */
              <div className="bg-warning-soft text-warning mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs" role="status">
                <span>
                  {searchBlocker === "no_account"
                    ? L("No Threads account is connected - a search needs a credential to ask with.", "Tiada akaun Threads disambung - carian perlukan kelayakan untuk bertanya.")
                    : L("The connected account was authorised before search was added, so it cannot search yet. Reconnect it once - the same Connect button on the Connection section.",
                        "Akaun yang disambung diberi kuasa sebelum carian ditambah, jadi ia belum boleh mencari. Sambung semula sekali - butang Sambung yang sama pada bahagian Sambungan.")}
                </span>
                <button type="button" className={rowBtn} onClick={() => setSection("connection")}>
                  {L("Open Connection", "Buka Sambungan")}
                </button>
              </div>
            )}

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
                  placeholder={L("Search for — e.g. tudung bawal, hotel murah", "Cari — cth. tudung bawal, hotel murah")}
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
            {canManage && (
              /* v1.97.0 — the search has no country filter, so the words are
                 the filter: Malay words return Malaysian posts. Said once,
                 here, where the words are typed. */
              <p className="text-muted-foreground mt-1.5 text-[11px]">
                {L("Tip: Threads cannot filter by country, so search in the words Malaysians use — \u201chotel murah\u201d, \u201ctudung bawal\u201d, \u201cstaycation KL\u201d. The Malaysia switch below then keeps the posts whose own text says so.",
                   "Petua: Threads tidak boleh menapis mengikut negara, jadi cari dengan perkataan yang digunakan rakyat Malaysia — \u201chotel murah\u201d, \u201ctudung bawal\u201d, \u201cstaycation KL\u201d. Suis Malaysia di bawah kemudian mengekalkan hantaran yang teksnya sendiri menunjukkannya.")}
              </p>
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
                    {t.posts > 0 ? ` · ${t.my_posts ?? 0} ${L("of", "daripada")} ${t.posts} ${L("read as Malaysian", "dibaca sebagai Malaysia")}` : ""}
                    {t.posts > 0 ? ` · ${t.asking_posts ?? 0} ${L("asking", "bertanya")}` : ""}
                  </span>
                  {canManage && (
                    <>
                      <button type="button" className={rowBtn} disabled={searching || (quota?.left ?? 1) <= 0 || Boolean(searchBlocker)}
                        title={searchBlocker ? L("Search is not available yet - see the notice above", "Carian belum tersedia - lihat notis di atas") : undefined}
                        onClick={() => void runSearch(t)}>
                        {searching ? <Skel className="inline-block h-3 w-16" /> : L("Search now", "Cari sekarang")}
                      </button>
                      <button type="button" className={rowBtnDanger} onClick={() => void removeTopic(t)}>{L("Remove", "Buang")}</button>
                    </>
                  )}
                  {t.last_error && <span className="text-danger">{t.last_error}</span>}
                  {t.last_note && !t.last_error && (
                    /* v1.98.0 — an observation, not an error: amber, in full. */
                    <span className="bg-warning-soft text-warning basis-full rounded-lg px-2.5 py-1.5" role="status">{t.last_note}</span>
                  )}
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
                    {findings.intents && (
                      <div>
                        <p className="mb-1 font-medium">{L("Asking or selling", "Bertanya atau menjual")}</p>
                        <ul className="space-y-1">
                          <Bar label={L("asking for it", "mencarinya")} n={findings.intents.asking} of={findings.posts} />
                          <Bar label={L("selling it", "menjualnya")} n={findings.intents.selling} of={findings.posts} />
                          <Bar label={L("just mention", "sekadar sebut")} n={findings.intents.other} of={findings.posts} />
                        </ul>
                        {(findings.ask_words?.length ?? 0) > 0 && (
                          <>
                            <p className="text-muted-foreground mt-1.5 mb-1">{L("What the asking posts say", "Apa kata hantaran yang bertanya")}</p>
                            <div className="flex flex-wrap gap-1">
                              {findings.ask_words!.slice(0, 16).map((w) => (
                                <button key={w.word} type="button" className="bg-warning-soft text-warning rounded-full px-2 py-0.5 text-[11px]"
                                  onClick={() => { setIntent("asking"); setStudyQ(w.word); }} title={`${w.n}×`}>
                                  {w.word} <span className="opacity-70">{w.n}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
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
                          <Bar key={l.code} label={l.code === "ms" ? L("Malay", "Melayu") : l.code === "en" ? L("English", "Inggeris") : l.code === "id" ? L("Indonesian", "Indonesia") : L("unclear", "tidak jelas")} n={l.n} of={findings.posts} />
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
                  <span className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{L("The posts", "Hantaran")}</p>
                    {/* v1.97.0 — Malaysian posts first. Threads does not say where a
                        person is; a post is "Malaysian" when its own words say so -
                        Malay wording, an RM price, a Malaysian place - and each row
                        carries the reason. */}
                    <span className="bg-secondary inline-flex rounded-full p-0.5 text-[11px]" role="group" aria-label={L("Which posts", "Hantaran mana")}
                      title={L("Threads carries no country. A post counts as Malaysian when the text itself gives it away: Malay wording, a price in RM, a Malaysian place.",
                               "Threads tiada negara. Hantaran dikira Malaysia apabila teksnya sendiri menunjukkannya: bahasa Melayu, harga dalam RM, tempat di Malaysia.")}>
                      <button type="button" aria-pressed={onlyMy} onClick={() => setOnlyMy(true)}
                        className={`rounded-full px-2.5 py-1 font-medium transition-colors ${onlyMy ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                        {L("Malaysia", "Malaysia")} {studyLoaded ? `(${myTotal})` : ""}
                      </button>
                      <button type="button" aria-pressed={!onlyMy} onClick={() => setOnlyMy(false)}
                        className={`rounded-full px-2.5 py-1 font-medium transition-colors ${!onlyMy ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                        {L("All", "Semua")} {studyLoaded ? `(${studyTotal})` : ""}
                      </button>
                    </span>
                    {/* v1.98.0 — demand vs supply. "Asking" is the posts where somebody
                        wants the thing; "Selling" where somebody offers it. */}
                    <span className="bg-secondary inline-flex rounded-full p-0.5 text-[11px]" role="group" aria-label={L("Asking or selling", "Bertanya atau menjual")}
                      title={L("Asking: the writer is looking for it - a question with an ask in it (ada tak, any recommendation, berapa harga). Selling: the writer offers it - a price, ready stock, a way to order.",
                               "Bertanya: penulis mencarinya - soalan dengan permintaan (ada tak, any recommendation, berapa harga). Menjual: penulis menawarkannya - harga, ready stock, cara memesan.")}>
                      {([["asking", L("Asking", "Bertanya")], ["selling", L("Selling", "Menjual")], [null, L("Any", "Mana-mana")]] as [Intent | null, string][]).map(([k, label]) => (
                        <button key={String(k)} type="button" aria-pressed={intent === k} onClick={() => setIntent(k)}
                          className={`rounded-full px-2.5 py-1 font-medium transition-colors ${intent === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                          {label} {studyLoaded && intents ? `(${k ? intents[k] : intents.asking + intents.selling + intents.other})` : ""}
                        </button>
                      ))}
                    </span>
                  </span>
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
                      : intent && (intents ? intents.asking + intents.selling + intents.other : 0) > 0
                        ? (intent === "asking"
                            ? L("Nobody in this harvest is asking for it - every post either sells it or just mentions it. That is a finding too: demand is not showing on Threads for these words yet.",
                                "Tiada siapa dalam hasil ini yang bertanya - setiap hantaran menjual atau sekadar menyebutnya. Itu juga penemuan: permintaan belum kelihatan di Threads untuk perkataan ini.")
                            : L("No post here reads as selling.", "Tiada hantaran di sini dibaca sebagai menjual."))
                      : onlyMy && studyTotal > 0 ? L(`None of the ${studyTotal} posts reads as Malaysian. Switch to All to see them, or search in Malay words - the words themselves pick Malaysian posts.`,
                                                     `Tiada satu pun daripada ${studyTotal} hantaran dibaca sebagai Malaysia. Tukar ke Semua untuk melihatnya, atau cari dengan perkataan Melayu - perkataan itu sendiri memilih hantaran Malaysia.`)
                      : L("Nothing collected yet — press Search now.", "Belum ada yang dikumpul — tekan Cari sekarang.")}
                  </p>
                ) : (
                  <ul className="divide-border mt-2 max-h-[32rem] divide-y overflow-y-auto">
                    {studyPosts.map((p) => (
                      <li key={p.id} className="py-2">
                        <button type="button" className="w-full text-left" aria-expanded={openStudy === p.id}
                          onClick={() => setOpenStudy(openStudy === p.id ? null : p.id)}>
                          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                            <span className="flex items-center gap-1.5 text-xs font-medium">
                              {p.username ? `@${p.username}` : L("unknown", "tidak diketahui")}
                              {p.my_signal ? (
                                <span className="bg-success-soft text-success rounded-full px-1.5 py-px text-[10px] font-semibold" title={p.my_reasons || undefined}>MY</span>
                              ) : null}
                              {p.intent === "asking" ? (
                                <span className="bg-warning-soft text-warning rounded-full px-1.5 py-px text-[10px] font-semibold">{L("asking", "bertanya")}</span>
                              ) : p.intent === "selling" ? (
                                <span className="bg-secondary text-muted-foreground rounded-full px-1.5 py-px text-[10px] font-semibold">{L("selling", "menjual")}</span>
                              ) : null}
                            </span>
                            <span className="text-muted-foreground text-[11px]">
                              {p.published_at ? dmyMYT(p.published_at) : ""} · {typeLabel(p.media_type ?? "")} · {p.char_count} {L("chars", "aksara")}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-sm">{excerpt(p.text, 160) || <span className="text-muted-foreground">{L("(no text)", "(tiada teks)")}</span>}</span>
                        </button>
                        {openStudy === p.id && (
                          <>
                            <PostBody p={{ text: p.text, permalink: p.permalink }} />
                            {p.my_reasons ? (
                              <p className="text-muted-foreground mt-1 text-[11px]">
                                {p.my_signal ? L("Reads as Malaysian:", "Dibaca sebagai Malaysia:") : L("Not counted as Malaysian:", "Tidak dikira Malaysia:")} {p.my_reasons}
                              </p>
                            ) : null}
                          </>
                        )}
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
                        {" · "}{a.can_search ? L("can search", "boleh mencari") : L("cannot search yet - connect again to grant it", "belum boleh mencari - sambung semula untuk membenarkannya")}
                      </p>
                      <p className={`mt-0.5 text-[11px] ${tokenTone}`}>
                        {left == null
                          ? L("No token — connect again", "Tiada token — sambung semula")
                          : left < 0 ? L("Token expired — connect again", "Token luput — sambung semula")
                          : `${L("Token expires in", "Token luput dalam")} ${left} ${L("days", "hari")}`}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1.5">
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

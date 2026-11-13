"use client";

/**
 * THE DESK — v1.293.0, CONSOLIDATED (the CEO's directive "A2Z OS — Desk
 * Consolidation & UI/UX Redesign", 12-11-2026, decisions K1-K4 and D1-D6;
 * claude/DESK-CONSOLIDATION-BLUEPRINT.md).
 *
 * Five tabs became TWO:
 *
 *   Overview      a greeting line; four figures (Pending My Decisions,
 *                 Overdue Actions, Active Alerts - management only, D2 - and
 *                 My Open Tasks); Priority Actions (five, overdue first);
 *                 Alerts & Watchers (one row per rule: count and oldest, no
 *                 severity - none is recorded, K3); My Tasks (three, one link
 *                 to Tasks). No Quick Actions card (K1); the two that lived
 *                 nowhere else - Introduce a lead, Report a problem - are two
 *                 links on the greeting line (D1).
 *   Action Inbox  ONE list: All / Awaiting My Decision / Requires My Response
 *                 / Alerts (management) / Completed, with search, a module
 *                 filter, a sort and pages.
 *
 * Watcher Settings moved whole to System -> Automation & Rules (D4).
 *
 * WHAT THE DESK STILL DOES NOT DO (K2, D6). It approves, rejects, returns or
 * edits nothing. Every row's button OPENS THE RECORD in its module - the exact
 * record where the module can open one (Leave, Claims, Tasks, a Sales
 * quotation, News, an Inventory item), otherwise the module at the right
 * list - where the evidence, the remarks, the hierarchy, the self-approval
 * rule and the audit already are. There is no second approval engine.
 *
 * WHERE THE FIGURES COME FROM. Three reads, all shared: `/staff/desk` (the
 * same cached request the Dashboard and the bell make), `/staff/watchers`
 * (management) and, only when the Completed filter is chosen,
 * `/staff/desk/completed` - the person's own decisions of the last 30 days
 * (D5), read only. Every figure is the length of the list it opens.
 */

import { useMemo, useState } from "react";
import { DeskRow, deskAnchor, deskBucketWord, splitDesk, useDeskData, waited, type DeskItem } from "@/components/portal/one-desk";
import { WATCHER_ROLES, useWatcherData, watcherIcon, watcherLabel, type Finding } from "@/components/portal/watchers-card";
import { ViewSwitch } from "@/components/portal/executive-cards";
import { usePortal } from "@/components/portal/portal-provider";
import { revealAnchor } from "@/components/portal/page-shared";
import { ReportProblem } from "@/components/portal/support-card";
import { IntroduceLeadAction } from "@/components/portal/week-target-card";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { LineTabs } from "@/components/ui/line-tabs";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { SkelRows } from "@/components/ui/skeleton";
import type { TabName } from "@/lib/portal-tabs";
import { useCachedApi } from "@/lib/cached-api";
import { dmy, dmyMYT } from "@/lib/format";
import { useTabViewAddress } from "@/lib/tab-view";
import { btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, selectClassSm } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import css from "./desk-page.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type View = "overview" | "inbox";
export type InboxFilter = "all" | "decide" | "respond" | "alerts" | "done";
/* module-level, so the address hook's effect never re-runs on a render */
const isDeskView = (v: string | null): v is View => v === "overview" || v === "inbox";
const FILTERS: readonly InboxFilter[] = ["all", "decide", "respond", "alerts", "done"];
/** how many Priority Actions the Overview shows (the directive: up to five) */
const PRIORITY = 5;
/** how many of my tasks the Overview shows (the directive: up to three) */
const MY_TASKS = 3;
/** rows per inbox page */
const PAGE = 20;

/* ------------------------------------------------------------------ */
/* opening the record itself                                           */
/* ------------------------------------------------------------------ */
/** The record focus a module understands, from a desk item's stable id.
    Modules with no record view (overtime, punches, follow-ups, HR steps,
    advisory) open at their list instead. */
export function recordOf(id: string): { tab: TabName; kind: string; id: number } | null {
  const m = /^([a-z-]+):(\d+)/.exec(id);
  if (!m) return null;
  const n = Number(m[2]);
  switch (m[1]) {
    case "leave": return { tab: "Leave", kind: "leave", id: n };
    case "claim": return { tab: "Claims", kind: "claim", id: n };
    case "task": case "task-close": return { tab: "Tasks", kind: "task", id: n };
    case "quote": return { tab: "Sales", kind: "document", id: n };
    case "announcement": return { tab: "Announcements", kind: "announcement", id: n };
    case "stock": return { tab: "Inventory", kind: "stock", id: n };
    default: return null;
  }
}
/** "Leave #12" - the reference a person can say out loud, from the stable id */
export function refOf(id: string): string {
  const m = /^([a-z-]+):(\d+)(?::(.+))?/.exec(id);
  if (!m) return id;
  const word: Record<string, [string, string]> = {
    leave: ["Leave", "Cuti"], claim: ["Claim", "Tuntutan"], ot: ["Overtime", "Kerja lebih masa"], punch: ["Punch", "Ketukan"],
    task: ["Task", "Tugasan"], "task-close": ["Task", "Tugasan"], quote: ["Quotation", "Sebut harga"], announcement: ["News", "Berita"],
    followup: ["Follow-up", "Susulan"], recurring: ["Recurring invoice", "Invois berulang"], probation: ["Probation", "Percubaan"],
    joining: ["Joining", "Kemasukan"], leaving: ["Leaving", "Keluar"], "fa-review": ["Review", "Semakan"], stock: ["Stock", "Stok"],
  };
  const w = word[m[1]!];
  if (m[1] === "ot" && m[3]) return `${L("Overtime", "Kerja lebih masa")} · ${dmy(m[3])}`;
  return w ? `${L(w[0], w[1])} #${m[2]}` : id;
}

/* the module a tab name reads as, in the reader's language */
const MODULE_MS: Record<string, string> = {
  Leave: "Cuti", Claims: "Tuntutan", Attendance: "Kehadiran", Tasks: "Tugasan", Sales: "Jualan", Announcements: "Berita",
  HR: "HR", "Financial Advisory": "Nasihat Kewangan", Inventory: "Inventori", Assets: "Aset", Enquiries: "Pertanyaan",
};
const moduleWord = (tab: string) => (tab === "Announcements" ? L("News", "Berita") : L(tab, MODULE_MS[tab] ?? tab));
const BUCKET_ICON: Partial<Record<DeskItem["bucket"], AppIconName>> = {
  leave: "date", claims: "receipt", ot: "time", punches: "time", tasks: "documents", news: "content",
  followups: "users", billing: "documents", people: "users", quotes: "documents", advisory: "documents",
};

/* overdue first, then the longest waiting */
const byPriority = (a: DeskItem, b: DeskItem) => (a.overdue === b.overdue ? (a.since ?? "").localeCompare(b.since ?? "") : a.overdue ? -1 : 1);

/* one inbox row, whatever it came from */
interface InboxRow {
  key: string; title: string; ref: string; tab: string; who: string | null; since: string | null;
  priority: "overdue" | "pending" | "alert"; status: string; next: string;
  kind: "decide" | "respond" | "alert";
  open: () => void;
}

export function DeskPage({ user, go, startView }: {
  user: { id: number; role: string; name?: string };
  go: (tab: string) => void;
  /** a link's or Back's start view: overview, inbox, or one of the inbox filters */
  startView?: string;
}) {
  const startFilter = (v?: string): InboxFilter => (FILTERS.includes(v as InboxFilter) ? (v as InboxFilter) : "all");
  const [view, setView] = useState<View>(startView === "overview" || !startView ? "overview" : "inbox");
  const [filter, setFilter] = useState<InboxFilter>(startFilter(startView));
  useTabViewAddress("Desk", view, setView, isDeskView);
  /* a later link or Back with a start view moves the page to it (adjusted
     while rendering, React's pattern for state that follows a prop) */
  const [seenStart, setSeenStart] = useState(startView);
  if (startView !== seenStart) {
    setSeenStart(startView);
    if (startView === "overview") setView("overview");
    else if (startView) {
      setView("inbox");
      if (FILTERS.includes(startView as InboxFilter)) setFilter(startView as InboxFilter);
    }
  }

  const { openRecord } = usePortal();
  const desk = useDeskData();
  const known = !desk.loading;
  const items = useMemo(() => desk.data?.items ?? [], [desk.data]);
  const { decide, attention, myTasks } = useMemo(() => splitDesk(items), [items]);
  const exec = WATCHER_ROLES.includes(user.role);
  const watch = useWatcherData(user.role);
  const findings: Finding[] = useMemo(() => (exec ? watch.data?.open ?? [] : []), [exec, watch.data]);
  const rules = useMemo(() => watch.data?.watchers ?? [], [watch.data]);
  const watchKnown = !exec || !watch.loading;

  /* open the record itself where the module can (K2); else the module at its list */
  const openItem = (id: string, tab: string, bucket?: DeskItem["bucket"]) => {
    const r = recordOf(id);
    if (r) { openRecord(r.tab, r.kind, r.id); go(r.tab); return; }
    go(tab);
    if (bucket) revealAnchor(deskAnchor(bucket));
  };

  const work = [...decide, ...attention].sort(byPriority);
  const overdueN = work.filter((i) => i.overdue).length;
  const oldestDecision = decide.length > 0 ? waited([...decide].sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""))[0]?.since ?? null) : "";
  const tasksOverdue = myTasks.filter((t) => t.overdue).length;
  /* alerts, one group per rule: how many and the oldest */
  const groups = useMemo(() => {
    const by = new Map<string, Finding[]>();
    for (const f of findings) by.set(f.watcher, [...(by.get(f.watcher) ?? []), f]);
    return [...by.entries()].map(([key, list]) => {
      const w = rules.find((r) => r.key === key);
      const oldest = [...list].sort((a, b) => a.first_seen.localeCompare(b.first_seen))[0]!;
      return { key, label: watcherLabel(w?.label ?? key), tab: w?.tab ?? "Dashboard", n: list.length, oldest: oldest.first_seen };
    }).sort((a, b) => a.oldest.localeCompare(b.oldest));
  }, [findings, rules]);
  const oldestAlert = groups.length > 0 ? waited(groups[0]!.oldest) : "";

  const toInbox = (f: InboxFilter) => { setFilter(f); setView("inbox"); };

  /* ---------------- the inbox rows ---------------- */
  const fromItem = (i: DeskItem, kind: "decide" | "respond"): InboxRow => ({
    key: i.id, title: i.title, ref: refOf(i.id), tab: i.tab, who: i.who ?? null, since: i.since,
    priority: i.overdue ? "overdue" : "pending", status: i.sub, next: i.next ?? "", kind,
    open: () => openItem(i.id, i.tab, i.bucket),
  });
  const fromFinding = (f: Finding): InboxRow => {
    const w = rules.find((r) => r.key === f.watcher);
    const tab = w?.tab ?? "Dashboard";
    return {
      key: `finding:${f.ref}`, title: f.title, ref: `${watcherLabel(w?.label ?? f.watcher)} · ${refOf(f.ref)}`, tab, who: null, since: f.first_seen,
      priority: "alert", status: L("Open finding", "Dapatan terbuka"), next: L(`Fix it in ${moduleWord(tab)}`, `Selesaikan dalam ${moduleWord(tab)}`), kind: "alert",
      open: () => openItem(f.ref, tab),
    };
  };
  const rows: InboxRow[] = [...decide.map((i) => fromItem(i, "decide")), ...attention.map((i) => fromItem(i, "respond")), ...findings.map(fromFinding)];

  /* ---------------- the view bar ---------------- */
  const inboxCount = known ? work.length + findings.length : null;

  return (
    <TabPage className={css.page}>
      <div className="erp-desktop-only" data-testid="desk-tabs">
        <LineTabs value={view} onChange={setView} label={L("Desk", "Meja")} tabs={[
          ["overview", L("Overview", "Gambaran")],
          ["inbox", L("Action Inbox", "Peti Tindakan"), inboxCount],
        ]} />
      </div>
      <div className={`erp-phone-only ${css.viewBar}`} data-testid="desk-view-bar">
        <ViewSwitch value={view} onChange={setView} options={[
          ["overview", L("Overview", "Gambaran"), L("What needs you, at a glance", "Apa yang perlu anda, sepintas lalu")],
          ["inbox", L("Action Inbox", "Peti Tindakan"), inboxCount ? L(`${inboxCount} waiting`, `${inboxCount} menunggu`) : L("Everything to work", "Semua untuk diuruskan")],
        ] as const} />
      </div>
      {view === "overview" ? (
        <Overview user={user} known={known} watchKnown={watchKnown} exec={exec} decide={decide} overdueN={overdueN} oldestDecision={oldestDecision}
          findings={findings.length} rulesN={groups.length} oldestAlert={oldestAlert} myTasks={myTasks} tasksOverdue={tasksOverdue}
          work={work} groups={groups} toInbox={toInbox} go={go} openItem={openItem} />
      ) : (
        /* the tab concept's caption: what the list is, never the card's own title again */
        <TabZone label={filter === "done" ? L("Decided by you · last 30 days", "Diputuskan oleh anda · 30 hari lepas") : L("Waiting on you", "Menunggu anda")}>
          <Inbox rows={rows} known={known && watchKnown} exec={exec} filter={filter} setFilter={setFilter} go={go} openRecord={openRecord} />
        </TabZone>
      )}
    </TabPage>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
function Overview(p: {
  user: { name?: string }; known: boolean; watchKnown: boolean; exec: boolean;
  decide: DeskItem[]; overdueN: number; oldestDecision: string; findings: number; rulesN: number; oldestAlert: string;
  myTasks: DeskItem[]; tasksOverdue: number; work: DeskItem[];
  groups: { key: string; label: string; tab: string; n: number; oldest: string }[];
  toInbox: (f: InboxFilter) => void; go: (tab: string) => void; openItem: (id: string, tab: string, bucket?: DeskItem["bucket"]) => void;
}) {
  const workN = p.work.length;
  const [opened] = useState(() => Date.now()); // the moment the Overview opened: the greeting does not tick
  const myt = new Date(opened + 8 * 3600 * 1000);
  const hour = myt.getUTCHours();
  const hello = hour < 12 ? L("Good morning", "Selamat pagi") : hour < 18 ? L("Good afternoon", "Selamat petang") : L("Good evening", "Selamat malam");
  const first = (p.user.name ?? "").trim().split(/\s+/)[0] ?? "";
  const today = myt.toLocaleDateString(getLang() === "ms" ? "ms-MY" : "en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const figure = (key: string, icon: AppIconName, tone: "gold" | "bad" | "info" | "ok", value: number | null, label: string, line: string, onClick: () => void) => (
    <button key={key} type="button" className={`${card} ${css.figure}`} onClick={onClick} data-testid={`desk-fig-${key}`}>
      <span className={`${css.well} ${css[`w_${tone}`]}`}><AppIcon name={icon} /></span>
      <span className={css.figBody}>
        <span className={css.figLabel}>{label}</span>
        <span className={css.figValue} aria-busy={value == null}>{value == null ? "···" : value}</span>
        <span className={css.figLine}>{line}</span>
      </span>
    </button>
  );
  const linkBtn = (label: string, onClick: () => void) => <button type="button" className={css.textLink} onClick={onClick}>{label}</button>;
  return (
    <div className={css.body}>
      <div className={css.greet} data-testid="desk-greet">
        <p className={css.greetLine}>
          <strong>{first ? `${hello}, ${first}` : hello}</strong>
          <span> · {today}</span>
          {p.known && <span> · {workN === 0 ? L("nothing waits on you", "tiada apa menunggu anda") : L(`${workN} waiting on you${p.overdueN ? `, ${p.overdueN} overdue` : ""}`, `${workN} menunggu anda${p.overdueN ? `, ${p.overdueN} lewat` : ""}`)}</span>}
        </p>
        {/* D1 - the two former Quick Actions that live nowhere else */}
        <p className={css.greetLinks}>
          <IntroduceLeadAction trigger={(open) => linkBtn(L("Introduce a lead", "Perkenalkan petunjuk"), open)} />
          <span aria-hidden> · </span>
          <ReportProblem tab="Desk" trigger={(open) => linkBtn(L("Report a problem", "Laporkan masalah"), open)} />
        </p>
      </div>

      <TabZone label={L("At a glance", "Sepintas lalu")}>
      <div className={css.figures} data-figures={p.exec ? 4 : 3} data-testid="desk-figures">
        {figure("decide", "orders", "gold", p.known ? p.decide.length : null, L("Pending My Decisions", "Keputusan Saya Menunggu"),
          p.decide.length === 0 ? L("Nothing waits on your decision", "Tiada keputusan menunggu anda") : L(`Oldest waiting ${p.oldestDecision}`, `Terlama menunggu ${p.oldestDecision}`), () => p.toInbox("decide"))}
        {figure("overdue", "time", "bad", p.known ? p.overdueN : null, L("Overdue Actions", "Tindakan Lewat"),
          p.overdueN === 0 ? L("Nothing is overdue", "Tiada yang lewat") : L("Past their module's window", "Melepasi tempoh modulnya"), () => p.toInbox("all"))}
        {/* D2 - management only: a person who may not read the rules sees no figure, never a 0 */}
        {p.exec && figure("alerts", "warning", "info", p.watchKnown ? p.findings : null, L("Active Alerts", "Amaran Aktif"),
          p.findings === 0 ? L("No rule finds anything", "Tiada peraturan menemui apa-apa") : L(`${p.rulesN} rule${p.rulesN === 1 ? "" : "s"} · oldest ${p.oldestAlert}`, `${p.rulesN} peraturan · terlama ${p.oldestAlert}`), () => p.toInbox("alerts"))}
        {figure("tasks", "success", "ok", p.known ? p.myTasks.length : null, L("My Open Tasks", "Tugasan Terbuka Saya"),
          p.myTasks.length === 0 ? L("Nothing assigned to you", "Tiada tugasan untuk anda") : p.tasksOverdue ? L(`${p.tasksOverdue} overdue`, `${p.tasksOverdue} lewat`) : L("None overdue", "Tiada yang lewat"), () => p.go("Tasks"))}
      </div>
      </TabZone>

      <div className={css.grid}>
        <section className={`${card} ${css.panel}`} aria-label={L("Priority Actions", "Tindakan Keutamaan")} data-testid="priority-actions">
          <div className={css.head}>
            <h2 className={css.title}>{L("Priority Actions", "Tindakan Keutamaan")}</h2>
            {workN > 0 && <button type="button" className={css.headLink} onClick={() => p.toInbox("all")}>{L(`Open Action Inbox (${workN})`, `Buka Peti Tindakan (${workN})`)} <AppIcon name="next" /></button>}
          </div>
          {!p.known ? <SkelRows rows={3} /> : workN === 0 ? (
            <p className={css.quiet} role="status"><AppIcon name="success" />{L("Nothing is waiting on you.", "Tiada apa yang menunggu anda.")}</p>
          ) : (
            <ul className={css.rows}>
              {p.work.slice(0, PRIORITY).map((i) => (
                <li key={i.id} className={css.prow} data-testid="priority-row">
                  <span className={css.rowIcon} aria-hidden><AppIcon name={BUCKET_ICON[i.bucket] ?? "documents"} /></span>
                  <span className={css.rowText}>
                    <strong>{i.title}</strong>
                    <span>{[i.who && !i.title.startsWith(i.who) ? i.who : null, moduleWord(i.tab), deskBucketWord(i.bucket) !== moduleWord(i.tab) ? deskBucketWord(i.bucket) : null, i.since ? L(`waiting ${waited(i.since)}`, `menunggu ${waited(i.since)}`) : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={css.rowEnd}>
                    <span className={i.overdue ? chipSmDanger : chipSmWarn}>{i.overdue ? L("Overdue", "Lewat") : L("Pending", "Menunggu")}</span>
                    <button type="button" className={btnSm} onClick={() => p.openItem(i.id, i.tab, i.bucket)} title={i.next}>{L("Open", "Buka")}</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className={css.col}>
          {p.exec && (
            <section className={`${card} ${css.panel}`} aria-label={L("Alerts & Watchers", "Amaran & Pemerhati")} data-testid="alert-summary">
              <div className={css.head}>
                <h2 className={css.title}>{L("Alerts & Watchers", "Amaran & Pemerhati")}</h2>
                <button type="button" className={css.headLink} onClick={() => p.go("Automation & Rules")}>{L("Automation & Rules", "Automasi & Peraturan")} <AppIcon name="next" /></button>
              </div>
              {!p.watchKnown ? <SkelRows rows={2} /> : p.groups.length === 0 ? (
                <p className={css.quiet} role="status"><AppIcon name="success" />{L("No rule finds anything right now.", "Tiada peraturan menemui apa-apa sekarang.")}</p>
              ) : (
                <ul className={css.rows}>
                  {p.groups.map((g) => (
                    <li key={g.key} className={css.prow} data-testid="alert-row">
                      <span className={css.rowIcon} aria-hidden><AppIcon name={watcherIcon(g.key)} /></span>
                      <span className={css.rowText}>
                        <strong>{g.label} — {g.n}</strong>
                        <span>{moduleWord(g.tab)} · {L(`oldest ${waited(g.oldest)}`, `terlama ${waited(g.oldest)}`)}</span>
                      </span>
                      <span className={css.rowEnd}>
                        <button type="button" className={btnSm} onClick={() => p.go(g.tab)}>{L("Open", "Buka")}</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <section className={`${card} ${css.panel}`} aria-label={L("My Tasks", "Tugasan Saya")} data-testid="my-tasks">
            <div className={css.head}>
              <h2 className={css.title}>{L("My Tasks", "Tugasan Saya")}</h2>
              <button type="button" className={css.headLink} onClick={() => p.go("Tasks")}>{L("Open Tasks", "Buka Tugasan")} <AppIcon name="next" /></button>
            </div>
            {!p.known ? <SkelRows rows={2} /> : p.myTasks.length === 0 ? (
              <div className={css.empty}>
                <AppIcon name="success" />
                <strong>{L("No open tasks", "Tiada tugasan terbuka")}</strong>
                <span>{L("New tasks you are given will show here.", "Tugasan baharu untuk anda akan dipaparkan di sini.")}</span>
              </div>
            ) : (
              /* read-only rows: each OPENS the task in Tasks, where it is worked */
              <ul className={css.taskList}>
                {p.myTasks.slice(0, MY_TASKS).map((t) => <DeskRow key={t.id} item={t} go={(tab) => p.openItem(t.id, tab, t.bucket)} />)}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Action Inbox                                                        */
/* ------------------------------------------------------------------ */
interface Done { id: string; tab: string; title: string; who: string | null; decision: string; at: string; record: { kind: string; id: number } | null }
const DECISION: Record<string, [string, string, string]> = {
  approved: ["Approved", "Diluluskan", chipSmSuccess], rejected: ["Rejected", "Ditolak", chipSmDanger], returned: ["Returned", "Dikembalikan", chipSmWarn],
  reviewed: ["Reviewed", "Disemak", chipSmInfo], verified: ["Verified", "Disahkan", chipSmSuccess], flagged: ["Flagged", "Ditanda", chipSmWarn],
  decided: ["Decided", "Diputuskan", chipSmNeutral], overridden: ["Overridden", "Diatasi", chipSmWarn],
};

function Inbox({ rows, known, exec, filter, setFilter, go, openRecord }: {
  rows: InboxRow[]; known: boolean; exec: boolean; filter: InboxFilter; setFilter: (f: InboxFilter) => void;
  go: (tab: string) => void; openRecord: (tab: TabName, kind: string, id: number) => void;
}) {
  const [q, setQ] = useState("");
  const [mod, setMod] = useState("");
  const [sort, setSort] = useState<"overdue" | "oldest" | "newest">("overdue");
  const [page, setPage] = useState(1);
  /* Completed is read only when it is chosen (D5) */
  const done = useCachedApi<{ items: Done[]; days: number }>("/staff/desk/completed", filter === "done", ["leave", "claims", "attendance", "quotes", "people"]);

  const count = (f: InboxFilter) => f === "all" ? rows.length : f === "decide" ? rows.filter((r) => r.kind === "decide").length
    : f === "respond" ? rows.filter((r) => r.kind === "respond").length : f === "alerts" ? rows.filter((r) => r.kind === "alert").length : null;
  const pills: [InboxFilter, string][] = [
    ["all", L("All", "Semua")], ["decide", L("Awaiting My Decision", "Menunggu Keputusan Saya")], ["respond", L("Requires My Response", "Perlu Respons Saya")],
    ...(exec ? ([["alerts", L("Alerts", "Amaran")]] as [InboxFilter, string][]) : []), ["done", L("Completed", "Selesai")],
  ];

  const needle = q.trim().toLowerCase();
  const list = rows
    .filter((r) => filter === "all" || (filter === "decide" && r.kind === "decide") || (filter === "respond" && r.kind === "respond") || (filter === "alerts" && r.kind === "alert"))
    .filter((r) => !mod || r.tab === mod)
    .filter((r) => !needle || `${r.title} ${r.ref} ${r.who ?? ""} ${r.status}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === "newest") return (b.since ?? "").localeCompare(a.since ?? "");
      if (sort === "overdue" && (a.priority === "overdue") !== (b.priority === "overdue")) return a.priority === "overdue" ? -1 : 1;
      return (a.since ?? "").localeCompare(b.since ?? "");
    });
  const doneList = (done.data?.items ?? [])
    .filter((d) => !mod || d.tab === mod)
    .filter((d) => !needle || `${d.title} ${d.who ?? ""}`.toLowerCase().includes(needle));
  const total = filter === "done" ? doneList.length : list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const cur = Math.min(page, pages);
  const modules = [...new Set(filter === "done" ? (done.data?.items ?? []).map((d) => d.tab) : rows.map((r) => r.tab))].sort();
  const chip = (pr: InboxRow["priority"]) => pr === "overdue" ? <span className={chipSmDanger}>{L("Overdue", "Lewat")}</span>
    : pr === "alert" ? <span className={chipSmInfo}>{L("Alert", "Amaran")}</span> : <span className={chipSmWarn}>{L("Pending", "Menunggu")}</span>;
  const openDone = (d: Done) => {
    if (d.record) openRecord(d.tab as TabName, d.record.kind, d.record.id);
    go(d.tab);
  };

  return (
    <section className={`${card} ${css.inbox}`} aria-label={L("Action Inbox", "Peti Tindakan")} data-testid="action-inbox" data-filter={filter}>
      <div className={css.pills} role="group" aria-label={L("Show", "Tunjuk")}>
        {pills.map(([k, label]) => {
          const n = count(k);
          return (
            <button key={k} type="button" aria-pressed={filter === k} data-testid={`inbox-${k}`} onClick={() => { setFilter(k); setPage(1); setMod(""); }}>
              {label}{n != null && known && <span className={css.pillN}>{n}</span>}
            </button>
          );
        })}
      </div>
      <div className={css.tools}>
        <label className={css.search}>
          <AppIcon name="search" />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder={L("Search request, reference or person…", "Cari permohonan, rujukan atau orang…")} aria-label={L("Search the inbox", "Cari peti tindakan")} />
        </label>
        <select className={`${selectClassSm} ${css.pick}`} value={mod} onChange={(e) => { setMod(e.target.value); setPage(1); }} aria-label={L("Module", "Modul")} data-testid="inbox-module">
          <option value="">{L("All modules", "Semua modul")}</option>
          {modules.map((m) => <option key={m} value={m}>{moduleWord(m)}</option>)}
        </select>
        {filter !== "done" && (
          <select className={`${selectClassSm} ${css.pick}`} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label={L("Order", "Susunan")}>
            <option value="overdue">{L("Overdue first", "Lewat dahulu")}</option>
            <option value="oldest">{L("Oldest first", "Terlama dahulu")}</option>
            <option value="newest">{L("Newest first", "Terbaru dahulu")}</option>
          </select>
        )}
      </div>

      {filter === "done" ? (
        done.loading ? <SkelRows rows={4} /> : done.failed && !done.data ? (
          <p className={css.quiet} role="alert"><AppIcon name="warning" />{L("Your completed decisions could not be read. Try again in a moment.", "Keputusan selesai anda tidak dapat dibaca. Cuba lagi sebentar.")}</p>
        ) : doneList.length === 0 ? (
          <p className={css.quiet} role="status"><AppIcon name="success" />{L("You have decided nothing in the last 30 days.", "Anda tidak memutuskan apa-apa dalam 30 hari lepas.")}</p>
        ) : (
          <div className={`${css.table} ${css.doneTable}`} role="table" aria-label={L("Completed", "Selesai")}>
            <div className={`${css.trow} ${css.thead}`} role="row">
              <span role="columnheader">{L("Request", "Permohonan")}</span><span role="columnheader">{L("Module", "Modul")}</span>
              <span role="columnheader">{L("Requester", "Pemohon")}</span><span role="columnheader">{L("Your decision", "Keputusan anda")}</span>
              <span role="columnheader">{L("Decided", "Diputuskan")}</span><span role="columnheader" className={css.act}><span className="erp-sr-only">{L("Open", "Buka")}</span></span>
            </div>
            {doneList.slice((cur - 1) * PAGE, cur * PAGE).map((d) => {
              const w = DECISION[d.decision] ?? DECISION.decided!;
              return (
                <div key={d.id} className={css.trow} role="row" data-testid="done-row">
                  <span role="cell" className={css.cTitle}><strong>{d.title}</strong></span>
                  <span role="cell" className={css.cMod}>{moduleWord(d.tab)}</span>
                  <span role="cell" className={css.cWho}>{d.who ?? "—"}</span>
                  <span role="cell" className={css.cPri}><span className={w[2]}>{L(w[0], w[1])}</span></span>
                  <span role="cell" className={`${css.cWhen} erp-num`}>{dmyMYT(d.at)}</span>
                  <span role="cell" className={css.act}><button type="button" className={btnSm} onClick={() => openDone(d)}>{L("Open", "Buka")}</button></span>
                </div>
              );
            })}
          </div>
        )
      ) : !known ? <SkelRows rows={5} /> : list.length === 0 ? (
        <p className={css.quiet} role="status"><AppIcon name="success" />{rows.length === 0 ? L("Nothing is waiting on you.", "Tiada apa yang menunggu anda.") : L("Nothing matches.", "Tiada yang sepadan.")}</p>
      ) : (
        <div className={css.table} role="table" aria-label={L("Action Inbox", "Peti Tindakan")}>
          <div className={`${css.trow} ${css.thead}`} role="row">
            <span role="columnheader">{L("Request", "Permohonan")}</span><span role="columnheader">{L("Module", "Modul")}</span>
            <span role="columnheader">{L("Requester / owner", "Pemohon / pemilik")}</span><span role="columnheader">{L("Submitted", "Dihantar")}</span>
            <span role="columnheader">{L("Waiting", "Menunggu")}</span><span role="columnheader">{L("Priority", "Keutamaan")}</span>
            <span role="columnheader">{L("Status", "Status")}</span><span role="columnheader" className={css.act}>{L("Next action", "Tindakan seterusnya")}</span>
          </div>
          {list.slice((cur - 1) * PAGE, cur * PAGE).map((r) => (
            <div key={r.key} className={css.trow} role="row" data-testid="inbox-row" data-kind={r.kind}>
              <span role="cell" className={css.cTitle}><strong>{r.title}</strong><small>{r.ref}</small></span>
              <span role="cell" className={css.cMod}>{moduleWord(r.tab)}</span>
              <span role="cell" className={css.cWho} title={r.who ?? undefined}>{r.who ?? "—"}</span>
              <span role="cell" className={`${css.cWhen} erp-num`}>{r.since ? dmyMYT(r.since).slice(0, 10) : "—"}</span>
              <span role="cell" className={`${css.cWait} erp-num`}>{r.since ? waited(r.since) : "—"}</span>
              <span role="cell" className={css.cPri}>{chip(r.priority)}</span>
              <span role="cell" className={css.cStatus} title={r.status}>{r.status}</span>
              <span role="cell" className={css.act}>
                {r.next && <small className={css.next}>{r.next}</small>}
                <button type="button" className={btnSm} onClick={r.open}>{L("Open", "Buka")}</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {pages > 1 && (
        <nav className={css.pager} aria-label={L("Pages", "Halaman")}>
          <span className="erp-meta">{L(`${(cur - 1) * PAGE + 1}–${Math.min(cur * PAGE, total)} of ${total}`, `${(cur - 1) * PAGE + 1}–${Math.min(cur * PAGE, total)} daripada ${total}`)}</span>
          <button type="button" className={btnSm} disabled={cur <= 1} onClick={() => setPage(cur - 1)}>{L("Previous", "Sebelum")}</button>
          <button type="button" className={btnSm} disabled={cur >= pages} onClick={() => setPage(cur + 1)}>{L("Next", "Seterusnya")}</button>
        </nav>
      )}
      <p className={css.note}>{filter === "done"
        ? L("Read only: decisions you made yourself in the last 30 days, from each module's own record.", "Baca sahaja: keputusan yang anda buat sendiri dalam 30 hari lepas, daripada rekod setiap modul.")
        : L("Each row opens the record in its module, where it is approved, answered or fixed. The Desk changes nothing.", "Setiap baris membuka rekod dalam modulnya, di mana ia diluluskan, dijawab atau dibaiki. Meja tidak mengubah apa-apa.")}</p>
    </section>
  );
}

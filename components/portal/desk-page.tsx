"use client";

/**
 * THE DESK — v1.176.0. The main queue for decisions and operational
 * exceptions, and the one place either is worked.
 *
 * The owner, 22-09-2026: the Dashboard was showing the whole queue, the phone
 * bar's "Desk" stop was the Dashboard scrolled to a zone (so the header said
 * "Today" while he looked at his queue), and his own open tasks appeared in
 * six different places. A queue you reach through another page's anchor is not
 * a destination; it is a bookmark.
 *
 * v1.190.0 — FIVE TABS (the owner's brief and reference, 22-10-2026: "a clean,
 * premium, actionable work center"), over the same two requests:
 *
 *   Overview            three figures (your decisions, what needs attention,
 *                       your open tasks), the first few things waiting on you,
 *                       the first few watcher findings, your tasks, and the
 *                       ways in. A PREVIEW: every list ends in "View all".
 *   My Actions          the full queue - Needs your decision, then Needs
 *                       attention - with the per-module doors.
 *   Alerts & Watchers   what the company's rules currently find true, grouped
 *                       by rule (WATCHER_ROLES only, as before).
 *   My Tasks            the tasks assigned to you, read-only: title, deadline
 *                       or status, age. Every row OPENS the Tasks tab - Tasks
 *                       still owns the detail, the checklist and the progress
 *                       actions; the Desk performs none of them.
 *   Watcher Settings    the rules, who they tell and the line each watches
 *                       (WATCHER_ROLES see it; only the CEO - and the super
 *                       admin, the worker's own rule - can change one).
 *
 * Every body stays mounted and is hidden, never unmounted. Nothing here is
 * new data: `/staff/desk` and `/staff/watchers`, both read through
 * `useCachedApi`, which keys on the path - the Dashboard's summary card, these
 * five tabs and the bell's counts are one request each and cannot disagree.
 *
 * WHAT IT STILL DOES NOT OWN. It performs no approval: every row opens the
 * record where the evidence is (see one-desk.tsx for why). It runs no task.
 *
 * v1.176.1 — the attention figure counts the desk's own exceptions PLUS what
 * the rules find, because the owner read "Needs attention 0" above
 * "Watchers — 4 open"; that figure is the Overview's second card.
 */

import { useState, type ReactNode } from "react";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { DeskBucketChips, DeskQueue, DeskRow, splitDesk, useDeskData, waited } from "@/components/portal/one-desk";
import { WATCHER_ROLES, WatchersCard, useWatcherOpenCount } from "@/components/portal/watchers-card";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { LineTabs } from "@/components/ui/line-tabs";
import { Skel } from "@/components/ui/skeleton";
import { btnSm, btnSmPrimary, card, chipSmNeutral, chipSmWarn } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import css from "./desk-page.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** "Needs your decision" + the count, as ONE caption. The count is what the
    reader came for and the card below no longer repeats the words. */
const withCount = (label: string, n: number | null) => (n == null ? label : `${label} — ${n}`);

type View = "overview" | "actions" | "alerts" | "tasks" | "settings";
/** how many rows an Overview preview shows before "View all" */
const PREVIEW = 5;

export function DeskPage({ user, go }: {
  user: { id: number; role: string };
  go: (tab: string) => void;
}) {
  const [view, setView] = useState<View>("overview");
  const desk = useDeskData();
  const items = desk.data?.items ?? [];
  const { decide, attention, myTasks } = splitDesk(items);
  const exec = WATCHER_ROLES.includes(user.role);
  const watching = useWatcherOpenCount(user.role);
  /* one figure for what needs attention: the desk's own exceptions PLUS what
     the company's rules currently find true */
  const attentionCount = watching == null ? null : attention.length + watching;
  /* the oldest thing waiting on a decision — the one number that says whether
     this queue is under control */
  const oldest = decide.length > 0 ? waited(decide[decide.length - 1]?.since ?? null) : "";
  const known = !desk.loading;
  const overdue = myTasks.filter((t) => t.overdue).length;
  const queue = [...decide, ...attention];

  const tabs: readonly (readonly [View, string])[] = [
    ["overview", L("Overview", "Gambaran")],
    ["actions", L("My Actions", "Tindakan Saya")],
    ...(exec ? ([["alerts", L("Alerts & Watchers", "Amaran & Pemerhati")]] as const) : []),
    ["tasks", L("My Tasks", "Tugasan Saya")],
    ...(exec ? ([["settings", L("Watcher Settings", "Tetapan Pemerhati")]] as const) : []),
  ];

  /* one figure card on the Overview; pressing it opens the tab that lists it */
  const figure = (icon: AppIconName, tone: "gold" | "green" | "navy", value: number | null, label: string, line: string, to: View) => (
    <button type="button" className={`${card} ${css.figure}`} onClick={() => setView(to)}
      title={L("Open the list", "Buka senarai")}>
      <span className={`${css.well} ${css[tone]}`}><AppIcon name={icon} /></span>
      <span className={css.figBody}>
        <span className={css.figValue} aria-busy={value == null}>{value == null ? "···" : value}</span>
        <span className={css.figLabel}>{label}</span>
        <span className={css.figLine}>{line}</span>
      </span>
    </button>
  );

  /* a card head: glyph, title, one line, an action on the right */
  const head = (icon: AppIconName, title: string, sub: string, action?: ReactNode) => (
    <div className={css.head}>
      <div className={css.lead}>
        <span className={`${css.well} ${css.small} ${css.gold}`}><AppIcon name={icon} /></span>
        <div className={css.headText}>
          <p className={css.title}>{title}</p>
          <p className={css.sub}>{sub}</p>
        </div>
      </div>
      {action}
    </div>
  );

  const busyRows = (
    <div className={css.skel} aria-busy="true"><Skel className={css.skelRow} /><Skel className={css.skelRow} /><Skel className={css.skelRow} /></div>
  );

  const tasksCard = (all: boolean) => (
    <section className={card}>
      {head("documents", withCount(L("Your tasks", "Tugasan anda"), known ? myTasks.length : null),
        myTasks.length === 0
          ? L("Nothing assigned to you is open.", "Tiada tugasan anda yang terbuka.")
          : L(`${overdue > 0 ? `${overdue} overdue. ` : ""}They are worked on the Tasks tab.`,
              `${overdue > 0 ? `${overdue} lewat. ` : ""}Ia diuruskan pada tab Tugasan.`),
        <button type="button" className={btnSmPrimary} onClick={() => go("Tasks")}>{L("Open Tasks", "Buka Tugasan")}</button>)}
      {!known ? busyRows : myTasks.length === 0 ? (
        <div className={css.empty}>
          <AppIcon name="documents" />
          <p className={css.emptyTitle}>{L("No open tasks", "Tiada tugasan terbuka")}</p>
          <p className={css.sub}>{L("You're all caught up. New tasks will appear here.", "Semua sudah selesai. Tugasan baharu akan dipaparkan di sini.")}</p>
        </div>
      ) : (
        <>
          {all && (
            <div className={css.chips}>
              <span className={chipSmNeutral}>{L(`${myTasks.length} open`, `${myTasks.length} terbuka`)}</span>
              {overdue > 0 && <span className={chipSmWarn}>{L(`${overdue} overdue`, `${overdue} lewat`)}</span>}
            </div>
          )}
          {/* read-only rows: each one OPENS the Tasks tab, where the task is
              worked - the Desk never starts, finishes or ticks a task */}
          <ul className={css.list}>
            {(all ? myTasks : myTasks.slice(0, 3)).map((t) => <DeskRow key={t.id} item={t} go={go} />)}
          </ul>
          {!all && myTasks.length > 3 && (
            <button type="button" className={`${btnSm} ${css.more}`} onClick={() => setView("tasks")}>
              {L(`View all ${myTasks.length}`, `Lihat semua ${myTasks.length}`)}
            </button>
          )}
        </>
      )}
    </section>
  );

  const quick = (icon: AppIconName, tone: "gold" | "navy" | "green", title: string, sub: string, onClick: () => void) => (
    <button type="button" className={css.qa} onClick={onClick}>
      <span className={`${css.well} ${css.small} ${css[tone]}`}><AppIcon name={icon} /></span>
      <span className={css.qaText}>
        <span className={css.qaTitle}>{title}</span>
        <span className={css.sub}>{sub}</span>
      </span>
    </button>
  );

  return (
    <TabPage className={css.page}>
      <LineTabs value={view} onChange={setView} tabs={tabs} label={L("Desk", "Meja")} />

      {/* ================= Overview ================= */}
      <div hidden={view !== "overview"} className={css.body}>
        <div className={css.figures}>
          {figure("orders", "gold", known ? decide.length : null, L("Needs your decision", "Perlu keputusan anda"),
            decide.length === 0 ? L("No decisions are waiting on you.", "Tiada keputusan menunggu anda.")
              : L(`Nobody else can move these${oldest ? ` · oldest ${oldest}` : ""}.`, `Tiada orang lain boleh menggerakkannya${oldest ? ` · terlama ${oldest}` : ""}.`),
            "actions")}
          {figure("warning", "gold", known ? attentionCount : null, L("Needs attention", "Perlu perhatian"),
            (attentionCount ?? 0) === 0 ? L("Nothing needs your attention.", "Tiada apa memerlukan perhatian anda.")
              : L("Items and watcher findings that need follow-up.", "Perkara dan dapatan pemerhati yang perlu disusuli."),
            exec && attention.length === 0 && (watching ?? 0) > 0 ? "alerts" : "actions")}
          {figure("success", "green", known ? myTasks.length : null, L("Your open tasks", "Tugasan terbuka anda"),
            myTasks.length === 0 ? L("Nothing assigned to you.", "Tiada tugasan untuk anda.")
              : overdue > 0 ? L(`${overdue} overdue.`, `${overdue} lewat.`) : L("None overdue.", "Tiada yang lewat."),
            "tasks")}
        </div>

        <div className={css.grid}>
          <section className={card}>
            {head("orders", withCount(L("Needs your action", "Perlu tindakan anda"), known ? queue.length : null),
              L("Decisions first, then what to answer or acknowledge.", "Keputusan dahulu, kemudian yang perlu dijawab atau diakui."),
              queue.length > 0 ? <button type="button" className={btnSm} onClick={() => setView("actions")}>{L("View all", "Lihat semua")}</button> : undefined)}
            {!known ? busyRows : queue.length === 0 ? (
              <p className={css.quiet} role="status"><span aria-hidden className={css.okDot} />{L("Nothing is waiting on you.", "Tiada apa yang menunggu anda.")}</p>
            ) : (
              <ul className={css.list}>
                {queue.slice(0, PREVIEW).map((i) => <DeskRow key={i.id} item={i} go={go} />)}
              </ul>
            )}
          </section>
          {exec
            ? <WatchersCard role={user.role} go={go} section="findings" limit={4} onViewAll={() => setView("alerts")} />
            : tasksCard(false)}
        </div>

        <div className={css.grid}>
          {exec && tasksCard(false)}
          <section className={`${card} ${exec ? "" : css.wide}`}>
            {head("fast", L("Quick actions", "Tindakan pantas"), L("The ways into the work.", "Jalan masuk ke kerja."))}
            <div className={css.qaGrid}>
              {quick("documents", "navy", L("Open Tasks", "Buka Tugasan"), L("View and manage your open tasks", "Lihat dan urus tugasan terbuka"), () => go("Tasks"))}
              {quick("orders", "gold", L("My Actions", "Tindakan Saya"), L("Everything waiting on you", "Semua yang menunggu anda"), () => setView("actions"))}
              {exec && quick("preview", "navy", L("View all watchers", "Lihat semua pemerhati"), L("What the rules find true now", "Apa yang peraturan dapati sekarang"), () => setView("alerts"))}
              {exec && quick("access", "gold", L("Watcher settings", "Tetapan pemerhati"), L("Rules, thresholds and who is told", "Peraturan, ambang dan siapa diberitahu"), () => setView("settings"))}
            </div>
          </section>
        </div>
      </div>

      {/* ================= My Actions ================= */}
      <div hidden={view !== "actions"} className={css.body}>
        <TabZone label={L("By module", "Ikut modul")}>
          <DeskBucketChips go={go} />
        </TabZone>
        <TabZone label={withCount(L("Needs your decision", "Perlu keputusan anda"), known ? decide.length : null)}>
          <DeskQueue go={go} which="decide" bare />
        </TabZone>
        <TabZone label={withCount(L("Needs attention", "Perlu perhatian"), known ? attention.length : null)}>
          <DeskQueue go={go} which="attention" bare />
        </TabZone>
      </div>

      {/* ================= Alerts & Watchers ================= */}
      {exec && (
        <div hidden={view !== "alerts"} className={css.body}>
          <TabZone label={withCount(L("Watcher findings", "Dapatan pemerhati"), watching)}>
            {/* what the company's rules currently find true, grouped by rule */}
            <WatchersCard role={user.role} go={go} section="findings" />
          </TabZone>
        </div>
      )}

      {/* ================= My Tasks ================= */}
      <div hidden={view !== "tasks"} className={css.body}>
        <TabZone label={L("Assigned to you", "Diberikan kepada anda")}>
          {tasksCard(true)}
        </TabZone>
      </div>

      {/* ================= Watcher Settings ================= */}
      {exec && (
        <div hidden={view !== "settings"} className={css.body}>
          <TabZone label={L("Watcher rules", "Peraturan pemerhati")}>
            {/* Management configuration: which rules run, who they tell, and at
                what threshold - a rule is changed once a quarter, not once a
                day, so it has a tab of its own and stays out of the queue. */}
            <section className={card}>
              {head("access", L("Watcher rules", "Peraturan pemerhati"),
                L("What the company watches for, who it tells, and the line it watches. Only the CEO changes a rule.",
                  "Apa yang syarikat perhatikan, siapa diberitahu, dan had yang diperhatikan. Hanya CEO mengubah peraturan."))}
              <WatchersCard role={user.role} go={go} section="rules" bare />
            </section>
          </TabZone>
        </div>
      )}
    </TabPage>
  );
}

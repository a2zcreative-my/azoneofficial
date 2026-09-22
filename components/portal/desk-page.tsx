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
 * WHAT THIS PAGE OWNS
 *   the figures        how many decisions, how many exceptions, how long the
 *                      oldest has waited — and the per-module doors
 *   Needs your decision  approvals that cannot move until this person signs
 *   Needs attention      operational exceptions the company's rules found, and
 *                        the things that clear when this person answers them
 *   Your tasks         a COUNT and a link. Tasks owns the list, the detail and
 *                      the progress actions; a queue that also runs a to-do
 *                      list is two products in one scroll.
 *   Setup              the watcher rules. Management configuration, kept out
 *                      of the everyday queue and last on the page, which is
 *                      the tab concept's figures → work → records → setup.
 *
 * WHAT IT DOES NOT OWN. It performs no approval: every decision row opens the
 * record where the evidence is (see one-desk.tsx for why). It runs no task. It
 * is drawn entirely from `/staff/desk` and `/staff/watchers`, both of which the
 * Dashboard's summary card already reads — `useCachedApi` keys on the path, so
 * this page costs no extra request and the two can never disagree.
 */

import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { DeskBucketChips, DeskQueue, splitDesk, useDeskData, waited } from "@/components/portal/one-desk";
import { SummaryStat, SummaryStrip } from "@/components/portal/tab-concept";
import { WATCHER_ROLES, WatchersCard } from "@/components/portal/watchers-card";
import { PanelTitle } from "@/components/ui/app-icon";
import { btnSm, card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export function DeskPage({ user, go }: {
  user: { id: number; role: string };
  go: (tab: string) => void;
}) {
  const desk = useDeskData();
  const items = desk.data?.items ?? [];
  const { decide, attention, myTasks } = splitDesk(items);
  const exec = WATCHER_ROLES.includes(user.role);
  /* the oldest thing waiting on a decision — the one number that says whether
     this queue is under control, and the only place the page states it */
  const oldest = decide.length > 0 ? waited(decide[decide.length - 1]?.since ?? null) : "";

  return (
    <TabPage>
      <TabZone label={L("At a glance", "Sepintas lalu")}>
        <SummaryStrip cols={3} ariaLabel={L("Desk summary", "Ringkasan meja")}>
          <SummaryStat
            label={L("Needs your decision", "Perlu keputusan anda")}
            value={decide.length}
            tone={decide.length > 0 ? "warning" : "neutral"}
            busy={desk.loading}
            hint={oldest ? L(`oldest ${oldest}`, `terlama ${oldest}`) : undefined}
          />
          <SummaryStat
            label={L("Needs attention", "Perlu perhatian")}
            value={attention.length}
            tone={attention.length > 0 ? "brand" : "neutral"}
            busy={desk.loading}
          />
          <SummaryStat
            label={L("Your tasks", "Tugasan anda")}
            value={myTasks.length}
            busy={desk.loading}
            onClick={() => go("Tasks")}
            title={L("Open Tasks — the full list lives there", "Buka Tugasan — senarai penuh ada di sana")}
          />
        </SummaryStrip>
        <DeskBucketChips go={go} />
      </TabZone>

      <TabZone label={L("Needs your decision", "Perlu keputusan anda")}>
        <DeskQueue go={go} userId={user.id} which="decide" />
      </TabZone>

      <TabZone label={L("Needs attention", "Perlu perhatian")}>
        <DeskQueue go={go} userId={user.id} which="attention" />
        {/* what the company's rules currently find true, grouped by rule */}
        {exec && <WatchersCard role={user.role} go={go} section="findings" />}
      </TabZone>

      <TabZone label={L("Your tasks", "Tugasan anda")}>
        {/* v1.176.0 — a COUNT AND A LINK, never the list. Tasks owns the list,
            the detail, the scope checklist and the progress actions; repeating
            them here is how the same task ended up on six screens. */}
        <div className={card}>
          <PanelTitle icon="assignment">{L("Your tasks", "Tugasan anda")}</PanelTitle>
          <p className="erp-meta">
            {myTasks.length === 0
              ? L("Nothing assigned to you is open.", "Tiada tugasan anda yang terbuka.")
              : L(`${myTasks.length} open${myTasks.filter((t) => t.overdue).length > 0 ? `, ${myTasks.filter((t) => t.overdue).length} overdue` : ""}. They are worked on the Tasks tab.`,
                  `${myTasks.length} terbuka${myTasks.filter((t) => t.overdue).length > 0 ? `, ${myTasks.filter((t) => t.overdue).length} lewat` : ""}. Ia diuruskan pada tab Tugasan.`)}
          </p>
          <button type="button" className={`${btnSm} erp-mt-2`} onClick={() => go("Tasks")}>
            {L("Open Tasks", "Buka Tugasan")}
          </button>
        </div>
      </TabZone>

      {exec && (
        <TabZone label={L("Setup", "Persediaan")}>
          {/* Management configuration: which rules run, who they tell, and at
              what threshold. Deliberately at the foot of the page and out of
              the queue — a rule is changed once a quarter, not once a day. */}
          <div className={card}>
            <PanelTitle icon="access">{L("Watcher rules", "Peraturan pemerhati")}</PanelTitle>
            <p className="erp-meta">
              {L("What the company watches for, who it tells, and the line it watches. Only the CEO changes a rule.",
                 "Apa yang syarikat perhatikan, siapa diberitahu, dan had yang diperhatikan. Hanya CEO mengubah peraturan.")}
            </p>
            <WatchersCard role={user.role} go={go} section="rules" bare />
          </div>
        </TabZone>
      )}
    </TabPage>
  );
}

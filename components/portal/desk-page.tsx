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
 *
 * v1.176.1 — TWO THINGS THE OWNER CAUGHT ON THE PHONE.
 *   1. Every zone printed its name twice: the small-caps zone caption, then
 *      the card's own title one line below it ("NEEDS YOUR DECISION" over
 *      "Needs your decision — 1"). The COUNT is the only part the caption was
 *      missing, so the caption carries it and the cards are `bare`.
 *   2. "NEEDS ATTENTION 0" sat directly above "Watchers — 4 open". The figure
 *      counted the desk's own items and ignored the findings rendered beneath
 *      it. One number now covers everything in the zone.
 */

import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { DeskBucketChips, DeskQueue, splitDesk, useDeskData, waited } from "@/components/portal/one-desk";
import { SummaryStat, SummaryStrip } from "@/components/portal/tab-concept";
import { WATCHER_ROLES, WatchersCard, useWatcherOpenCount } from "@/components/portal/watchers-card";
import { PanelTitle } from "@/components/ui/app-icon";
import { btnSm, card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** "Needs your decision" + the count, as ONE caption. The count is what the
    reader came for and the card below no longer repeats the words. */
const withCount = (label: string, n: number | null) => (n == null ? label : `${label} — ${n}`);

export function DeskPage({ user, go }: {
  user: { id: number; role: string };
  go: (tab: string) => void;
}) {
  const desk = useDeskData();
  const items = desk.data?.items ?? [];
  const { decide, attention, myTasks } = splitDesk(items);
  const exec = WATCHER_ROLES.includes(user.role);
  const watching = useWatcherOpenCount(user.role);
  /* one figure for the whole zone: the desk's own exceptions PLUS what the
     company's rules currently find true, because both are rendered in it */
  const attentionCount = watching == null ? null : attention.length + watching;
  /* the oldest thing waiting on a decision — the one number that says whether
     this queue is under control, and the only place the page states it */
  const oldest = decide.length > 0 ? waited(decide[decide.length - 1]?.since ?? null) : "";
  const known = !desk.loading;
  const overdue = myTasks.filter((t) => t.overdue).length;

  return (
    <TabPage>
      <TabZone label={L("At a glance", "Sepintas lalu")}>
        {/* two figures, two columns: a three-tile strip on a 390px phone wraps
            to 2 + 1 and leaves the third stranded on a row of its own. The
            tasks count is not a third tile — it is stated once, in its own
            zone caption below. */}
        <SummaryStrip cols={2} ariaLabel={L("Desk summary", "Ringkasan meja")}>
          <SummaryStat
            label={L("Needs your decision", "Perlu keputusan anda")}
            value={decide.length}
            tone={decide.length > 0 ? "warning" : "neutral"}
            busy={desk.loading}
            hint={oldest ? L(`oldest ${oldest}`, `terlama ${oldest}`) : undefined}
          />
          <SummaryStat
            label={L("Needs attention", "Perlu perhatian")}
            value={attentionCount ?? 0}
            tone={(attentionCount ?? 0) > 0 ? "brand" : "neutral"}
            busy={desk.loading || attentionCount == null}
          />
        </SummaryStrip>
        <DeskBucketChips go={go} />
      </TabZone>

      <TabZone label={withCount(L("Needs your decision", "Perlu keputusan anda"), known ? decide.length : null)}>
        <DeskQueue go={go} userId={user.id} which="decide" bare />
      </TabZone>

      <TabZone label={withCount(L("Needs attention", "Perlu perhatian"), known ? attentionCount : null)}>
        <DeskQueue go={go} userId={user.id} which="attention" bare />
        {/* what the company's rules currently find true, grouped by rule */}
        {exec && <WatchersCard role={user.role} go={go} section="findings" />}
      </TabZone>

      <TabZone label={withCount(L("Your tasks", "Tugasan anda"), known ? myTasks.length : null)}>
        {/* v1.176.0 — a COUNT AND A LINK, never the list. Tasks owns the list,
            the detail, the scope checklist and the progress actions; repeating
            them here is how the same task ended up on six screens. */}
        <div className={card}>
          <p className="erp-meta">
            {myTasks.length === 0
              ? L("Nothing assigned to you is open.", "Tiada tugasan anda yang terbuka.")
              : L(`${overdue > 0 ? `${overdue} overdue. ` : ""}They are worked on the Tasks tab.`,
                  `${overdue > 0 ? `${overdue} lewat. ` : ""}Ia diuruskan pada tab Tugasan.`)}
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

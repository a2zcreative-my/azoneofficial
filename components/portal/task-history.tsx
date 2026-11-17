"use client";

/* v1.337.0 - TASKS > REPORTS & ARCHIVE > TASK HISTORY (the CEO, 17-11-2026:
   "Reorganize Reports & Archive into focused views: Submitted Reports, Team
   Performance, Completed Tasks and Task History"). Until now this view was a
   note saying a per-task timeline was "proposed, not built". The read exists:
   GET /staff/tasks/:id/activity (tasks-progress.ts taskActivity) - the task's
   whole recorded story, oldest first, each event once, behind the server's own
   taskAccess (a comment only for the people on the task). This view lists the
   tasks the board already holds beside the chosen task's story. It writes
   nothing and decides nothing. */

import { useEffect, useMemo, useState } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { PillSwitch } from "@/components/ui/panel";
import { SkelRows } from "@/components/ui/skeleton";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { stamp } from "@/components/portal/task-progress";
import { type PageSize } from "@/components/ui/pagination-controls";
import { api } from "@/lib/api";
import { chipSmNeutral, chipSmSuccess, chipSmInfo } from "@/lib/ui-styles";
import css from "./task-history.module.css";

export interface HistoryTask { id: number; title: string; assignee?: string | null; status: string; stage?: string | null; deadline?: string | null }
type Ev = { key: string; at: string; kind: string; text: string; by: string | null; photo_key?: string | null; quote?: string | null; muted?: boolean };

const stateChip = (t: HistoryTask) => t.stage === "cancelled" ? <span className={chipSmNeutral}>{L("Cancelled", "Dibatalkan")}</span>
  : t.status === "completed" ? <span className={chipSmSuccess}>{L("Closed", "Ditutup")}</span>
  : <span className={chipSmInfo}>{t.status === "in_progress" ? L("In progress", "Sedang dibuat") : L("Open", "Terbuka")}</span>;

export function TaskHistory({ tasks, loading, onOpenTask }: { tasks: HistoryTask[]; loading: boolean; onOpenTask: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "open" | "closed">("all");
  const [picked, setPicked] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(10);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => tasks.filter((t) => (show === "all" || (show === "closed" ? t.status === "completed" : t.status !== "completed"))
    && (!needle || [t.title, t.assignee ?? ""].some((x) => x.toLowerCase().includes(needle)))), [tasks, show, needle]);
  const fkey = `${needle}|${show}`;
  const [seenKey, setSeenKey] = useState(fkey);
  if (fkey !== seenKey) { setSeenKey(fkey); setPage(1); }
  const shown = rows.find((t) => t.id === picked) ?? rows[0] ?? null;

  const [story, setStory] = useState<{ id: number; events: Ev[] | null; error: string } | null>(null);
  useEffect(() => {
    if (!shown) return;
    let alive = true;
    void api<{ activity: Ev[]; error?: { message?: string } }>(`/staff/tasks/${shown.id}/activity`).then((r) => {
      if (!alive) return;
      setStory({ id: shown.id, events: r.ok && r.data ? r.data.activity : null, error: r.ok ? "" : (r.data?.error?.message ?? L("The history could not be read.", "Sejarah tidak dapat dibaca.")) });
    });
    return () => { alive = false; };
  }, [shown]);
  const current = story && shown && story.id === shown.id ? story : null;
  const events = current?.events ? [...current.events].sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key)) : null;

  const cols: TableCol<HistoryTask>[] = [
    { key: "task", label: L("Task", "Tugasan"), main: true, cell: (t) => <span className={css.cellText}><strong>{t.title}</strong><small>{t.assignee ?? "—"}</small></span> },
    { key: "state", label: L("Status", "Status"), cell: stateChip },
  ];
  return (
    <WorkspaceSplit testid="history-split" ratio="50-50">
      <SplitPane testid="history-list" title={L("Task History", "Sejarah Tugasan")} label={L("Tasks", "Tugasan")}
        sub={L("Choose a task to read its recorded story.", "Pilih tugasan untuk membaca kisah yang direkodkan.")}
        toolbar={<>
          <label className={css.search}><AppIcon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search tasks…", "Cari tugasan…")} aria-label={L("Search tasks", "Cari tugasan")} data-testid="history-search" /></label>
          <PillSwitch testid="history-show" label={L("Show", "Papar")} value={show} onChange={setShow} options={[["all", L("All", "Semua")], ["open", L("Open", "Terbuka")], ["closed", L("Closed", "Ditutup")]] as const} />
        </>}>
        <CompactTaskTable rows={rows} cols={cols} label={L("Tasks", "Tugasan")} loading={loading} record="task" testid="history-table" dense
          onOpen={setPicked} picked={shown?.id ?? null} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }}
          empty={<p className={css.empty}>{L("No task matches that.", "Tiada tugasan yang sepadan.")}</p>} />
      </SplitPane>
      <SplitPane testid="history-story" title={shown ? shown.title : L("Activity", "Aktiviti")} label={L("Task activity", "Aktiviti tugasan")}
        sub={shown ? L("Every recorded event, newest first.", "Setiap peristiwa yang direkodkan, terbaru dahulu.") : undefined}
        actions={shown ? <button type="button" className="erp-button erp-button-secondary erp-button-compact" onClick={() => onOpenTask(shown.id)} data-testid="history-open">{L("Open task", "Buka tugasan")}</button> : undefined}>
        {!shown ? <p className={css.empty}>{loading ? "" : L("No tasks yet.", "Belum ada tugasan.")}</p>
          : !current ? <SkelRows rows={5} />
          : current.error ? <p className={css.empty} role="alert">{current.error}</p>
          : !events?.length ? <p className={css.empty}>{L("Nothing recorded yet.", "Belum ada rekod.")}</p> : (
            <ol className={css.feed} data-testid="history-feed">
              {events.map((e) => (
                <li key={e.key} className={e.muted ? css.muted : undefined}>
                  <Avatar name={e.by ?? "A2Z OS"} photoKey={e.photo_key ?? null} size="sm" />
                  <span className={css.cellText}>
                    <strong>{e.text}</strong>
                    {e.quote && <span className={css.quote}>{e.quote}</span>}
                    <small>{e.by ?? L("A2Z OS", "A2Z OS")} · {stamp(e.at)}</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
      </SplitPane>
    </WorkspaceSplit>
  );
}

/* v1.319.0 - TASKS 2.0, STAGE 1 (claude/TASKS-2.0-STAGE-0-AUDIT.md, T2-5,
   T2-6, T2-14): what a task's stored status and stage MEAN on the screen,
   worked out in one place and with no React, so the same answer is drawn on
   every row and can be run by tests/tasks2.mjs.

     flowOf       the step of the four a task stands on: To Do, In Progress,
                  Review, Done. A cancelled task stands on none.
     tagKeyOf     Waiting for Client, Blocked, Cancelled - a TAG beside the
                  word, never a fifth status.
     rowFacts     overdue (a marker, not a status - T2-6), due soon, done.
     byUrgency2   overdue first, then due today, then the higher priority,
                  then the sooner due - the Overview's order.
     staffPerformance / weeklyDone
                  the Overview's two counted cards, from the task rows.

   NOTHING IS STORED for any of this: tasks.status and tasks.stage are read
   as they are. */

export type FlowKey = "todo" | "in_progress" | "review" | "done";
export const FLOW: readonly FlowKey[] = ["todo", "in_progress", "review", "done"];
export type TagKey = "blocked" | "waiting_client" | "cancelled";

export function flowOf(status: string, stage: string | null | undefined): FlowKey | null {
  if (status === "completed") return stage === "cancelled" ? null : "done";
  if (stage === "review") return "review";
  return status === "in_progress" ? "in_progress" : "todo";
}
export function tagKeyOf(status: string, stage: string | null | undefined): TagKey | null {
  if (status === "completed") return stage === "cancelled" ? "cancelled" : null;
  return stage === "blocked" ? "blocked" : stage === "waiting_client" ? "waiting_client" : null;
}

export interface FlowTask {
  id: number; status: string; stage?: string | null; priority: string; deadline: string | null; progress: number;
  assigned_to?: number; assignee?: string; assignee_photo?: string | null; created_at?: string; closed_at?: string | null;
}

export const addDays = (d: string, k: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
/** the Monday of that day's week */
export const mondayOf2 = (iso: string): string => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
/** a stored UTC stamp as its day in Malaysia (UTC+8); "" when there is none */
export const mytDay = (v: string | null | undefined): string => {
  if (!v) return "";
  const ms = Date.parse(v.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? "" : "Z"));
  return Number.isNaN(ms) ? "" : new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
};

/** days within which an open task counts as "due soon" */
export const SOON_DAYS = 3;
export function rowFacts(t: FlowTask, today: string): { flow: FlowKey | null; overdue: boolean; soon: boolean; done: boolean; pct: number } {
  const done = t.status === "completed";
  const overdue = !done && !!t.deadline && t.deadline < today;
  const soon = !done && !overdue && !!t.deadline && t.deadline <= addDays(today, SOON_DAYS);
  return { flow: flowOf(t.status, t.stage), overdue, soon, done, pct: Math.max(0, Math.min(100, Math.round(t.progress ?? 0))) };
}

const RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
export function byUrgency2<T extends FlowTask>(rows: readonly T[], today: string): T[] {
  const k = (t: T): [number, number, number, number, string] => [t.status === "completed" ? 1 : 0, t.deadline && t.deadline < today ? 0 : 1, t.deadline === today ? 0 : 1, RANK[t.priority] ?? 9, t.deadline ?? "9999"];
  return [...rows].sort((a, b) => {
    const x = k(a), y = k(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3] || x[4].localeCompare(y[4]) || b.id - a.id;
  });
}

/* STAFF PERFORMANCE (T2-14) - the rule said on the card: of the tasks a
   person HELD this week (assigned to them and open at any time from Monday
   to today), how many they CLOSED this week. A task closed before Monday
   was not held this week; a cancelled task is left out altogether. */
export interface StaffScore { id: number; name: string; photo: string | null; held: number; closed: number; pct: number }
export function staffPerformance(tasks: readonly FlowTask[], today: string): StaffScore[] {
  const mon = mondayOf2(today);
  const m = new Map<number, StaffScore>();
  for (const t of tasks) {
    if (t.assigned_to == null || t.stage === "cancelled") continue;
    const closedDay = t.status === "completed" ? mytDay(t.closed_at) : "";
    if (t.status === "completed" && (!closedDay || closedDay < mon)) continue;
    if (mytDay(t.created_at) > today) continue;
    const cur = m.get(t.assigned_to) ?? { id: t.assigned_to, name: t.assignee ?? `#${t.assigned_to}`, photo: t.assignee_photo ?? null, held: 0, closed: 0, pct: 0 };
    cur.held += 1;
    if (t.status === "completed") cur.closed += 1;
    m.set(t.assigned_to, cur);
  }
  return [...m.values()].map((p) => ({ ...p, pct: p.held ? Math.round((p.closed / p.held) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct || b.closed - a.closed || a.name.localeCompare(b.name));
}

/** tasks closed on each day of this week, Monday first (a cancelled task is not a closure) */
export function weeklyDone(tasks: readonly FlowTask[], today: string): { day: string; n: number }[] {
  const mon = mondayOf2(today);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i)).map((d) => ({ day: d, n: tasks.filter((t) => t.status === "completed" && t.stage !== "cancelled" && mytDay(t.closed_at) === d).length }));
}
/** closed (not cancelled) since Monday of this week, by the Malaysian day of the closure */
export const closedThisWeek = (tasks: readonly FlowTask[], today: string): number => weeklyDone(tasks, today).reduce((a, r) => a + r.n, 0);

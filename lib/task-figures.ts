/* v1.203.0 - THE TASK FIGURES, ONE RULE FOR TWO SCREENS. The Tasks page
   (components/portal/tasks.tsx) and the Dashboard's Task Overview both draw
   Open, Pending, Closed and Overdue; they read them from here so the two can
   never disagree about the same board. Moved, not rewritten: these are the
   lines tasks.tsx has used since v1.173.0 (overdue = a deadline before today
   and not completed, the rule the list paints red with since v1.42.0). */

export interface TaskLike {
  status: string;
  deadline?: string | null;
}

export function taskFigures<T extends TaskLike>(tasks: readonly T[], todayISO: string) {
  const openTasks = tasks.filter((t) => t.status !== "completed");
  const overdueCount = openTasks.filter((t) => !!t.deadline && t.deadline < todayISO).length;
  const pendingCount = openTasks.filter((t) => t.status === "in_progress").length;
  const doneCount = tasks.length - openTasks.length;
  return { openTasks, overdueCount, pendingCount, doneCount };
}

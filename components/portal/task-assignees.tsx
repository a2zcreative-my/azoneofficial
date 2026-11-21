"use client";

/* 21-11-2026 - A SHARED TEAM TASK IS SHOWN ONCE (the CEO's brief and reference
   picture, "Approve stages 1-2"). A task has ONE person responsible
   (tasks.assigned_to) and may have helpers (task_assistants); the list sends
   both. This draws the Assignee cell for every list and board of the Tasks tab:

   - one person: exactly the markup the cell always had (photo + name), so a
     single-person task looks as it did;
   - a team task: the responsible person's photo first, then the helpers',
     at most TWO photos and "+N" for the rest, and the names after them.

   Reading only: it never decides who may do what (taskAccess does) and never
   merges tasks - two separate tasks stay two rows. */

import { Avatar } from "@/components/ui/avatar";
import { AppIcon } from "@/components/ui/app-icon";
import { chipSmNeutral } from "@/lib/ui-styles";
import { L, type Task } from "./page-shared";
import s from "./task-assignees.module.css";

/** the photos drawn before "+N" */
const SHOWN = 2;

/** The helpers still on the task, in the order they were added. */
export const helpersOf = (t: Pick<Task, "assistants">) => t.assistants ?? [];
/** A team task: one person responsible plus at least one helper. */
export const isTeamTask = (t: Pick<Task, "assistants">) => helpersOf(t).length > 0;

export function TaskAssignees({ t, whoClass, mutedClass }: { t: Task; whoClass?: string; mutedClass?: string }) {
  if (!t.assignee) return <span className={mutedClass}>—</span>;
  const helpers = helpersOf(t);
  if (helpers.length === 0) {
    return <span className={whoClass}><Avatar name={t.assignee} photoKey={t.assignee_photo} size="sm" /><span>{t.assignee}</span></span>;
  }
  const people = [{ id: t.assigned_to ?? 0, name: t.assignee, photo: t.assignee_photo }, ...helpers.map((h) => ({ id: h.id, name: h.short ?? h.name, photo: h.photo_key }))];
  const extra = people.length - SHOWN;
  const names = people.map((p) => p.name).join(", ");
  return (
    <span className={`${whoClass ?? ""} ${s.team}`} title={names} data-testid="task-assignees" data-people={people.length}>
      <span className={s.stack} aria-hidden>
        {people.slice(0, SHOWN).map((p) => <span key={p.id} className={s.face}><Avatar name={p.name} photoKey={p.photo ?? null} userId={p.id || null} size="sm" /></span>)}
        {extra > 0 && <span className={s.more}>+{extra}</span>}
      </span>
      <span className={s.names}>{names}</span>
    </span>
  );
}

/** The reference picture's "Team Task" chip, beside the task's other chips. */
export function TeamTaskChip({ t }: { t: Task }) {
  if (!isTeamTask(t)) return null;
  return (
    <span className={chipSmNeutral} data-testid="team-task-chip" title={L(`${helpersOf(t).length + 1} people on this task`, `${helpersOf(t).length + 1} orang pada tugasan ini`)}>
      <AppIcon name="users" />{L("Team Task", "Tugasan Pasukan")}
    </span>
  );
}

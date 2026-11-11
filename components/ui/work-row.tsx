"use client";

/* v1.276.0 - A2Z OS 3.0: ONE WORK ROW (claude/UIUX-3.0-BLUEPRINT.md, approved
   by the CEO 10-11-2026). A row of work says what it is (title), the one fact
   that matters (meta), where it stands (status) and the ONE thing to do now
   (action) - the Desk, Sales, Tasks, Leave and the Dashboard draw their work
   the same way. Opening the row is the title's button; the action is its own
   button, so a tap on one never fires the other. It only draws: the caller
   decides what may be done and passes nothing it should not show. */

import type { ReactNode } from "react";
import css from "./ui3.module.css";

export function WorkRow({ lead, title, meta, status, action, onOpen, openLabel, testId }: {
  /** an avatar, an icon well - optional */
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** a StatusChip */
  status?: ReactNode;
  /** the ONE action for this row (a small button) */
  action?: ReactNode;
  /** opens the record (its drawer or page) */
  onOpen?: () => void;
  /** the opener's accessible name when the title alone is not enough */
  openLabel?: string;
  testId?: string;
}) {
  const body = (
    <>
      <span className={css.title}>{title}</span>
      {meta ? <span className={css.meta}>{meta}</span> : null}
    </>
  );
  return (
    <div className={`${css.row} ${lead ? "" : css.rowNoLead}`} data-testid={testId}>
      {lead ? <span aria-hidden>{lead}</span> : null}
      {onOpen
        ? <button type="button" className={css.main} onClick={onOpen} aria-label={openLabel}>{body}</button>
        : <span className={css.main}>{body}</span>}
      {status ? <span className={css.status}>{status}</span> : <span />}
      {action ? <span className={css.action}>{action}</span> : null}
    </div>
  );
}

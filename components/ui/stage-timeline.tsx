"use client";

/* v1.252.0 - ONE STAGE TIMELINE (the owner, 02-11-2026: "Reuse the existing
   Payroll Timeline visual pattern"; claude/LEAVE-TIMELINE-AUDIT.md section
   8). The Payroll Timeline was drawn inline in payroll-panel.tsx; it is this
   component now, and the Leave approval timeline is the same component -
   one look, one markup, no copy. It only draws: every state, name and time
   comes from the module that owns the process (for leave, the server's
   leave-chain.ts). */

import { Fragment, type ReactNode } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import css from "./stage-timeline.module.css";

export type StageState = "done" | "now" | "todo" | "skipped" | "rejected" | "withdrawn" | "returned" | "off";
export interface Stage {
  key: string;
  title: ReactNode;
  /** who and when, or what the stage is */
  sub?: ReactNode;
  state: StageState;
  /** words a person wrote at this stage (a question, a reason) */
  note?: ReactNode;
  /** a fact to act on (a released payroll month) */
  warn?: ReactNode;
  /** the right-hand line: a time, "Currently waiting", a count */
  aside?: ReactNode;
}

export function StageTimeline({ stages, label, testId }: { stages: Stage[]; label: string; testId?: string }) {
  return (
    <ol className={css.list} aria-label={label} data-testid={testId}>
      {stages.map((s, i) => (
        <li key={s.key} className={`${css.step} ${css[s.state] ?? ""}`} data-state={s.state} data-stage={s.key}>
          <span className={css.no} aria-hidden="true">
            {s.state === "done" ? <AppIcon name="success" /> : s.state === "rejected" ? <AppIcon name="error" /> : i + 1}
          </span>
          <span className={css.text}>
            <span className={css.title}>{s.title}</span>
            {s.sub ? <span className={css.sub}>{s.sub}</span> : null}
            {s.note ? <span className={css.note}>{s.note}</span> : null}
            {s.warn ? <span className={css.warn}>{s.warn}</span> : null}
          </span>
          {s.aside ? <span className={css.aside}>{s.state === "now" || s.state === "returned" ? <span className={css.chipNow}>{s.aside}</span> : s.aside}</span> : <span />}
        </li>
      ))}
    </ol>
  );
}

/** The compact line for a list cell or a card: one dot per stage. */
export function StageDots({ states, label }: { states: StageState[]; label: string }) {
  return (
    <span className={css.dots} role="img" aria-label={label} data-testid="stage-dots">
      {states.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className={`${css.dotLink} ${states[i - 1] === "done" && (s === "done" || s === "now" || s === "returned") ? css.done : ""}`} aria-hidden="true" />}
          <span className={`${css.dot} ${css[s] ?? ""}`} aria-hidden="true" />
        </Fragment>
      ))}
    </span>
  );
}

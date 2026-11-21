"use client";

/* v1.320.0 - THE FLOW STRIP (Sales 2.0 Stage 1, the design foundation): the
   row of steps with chevrons between them that the 2.0 pictures draw - the
   Sales Pipeline (Enquiry → ... → Closed Sale), the Payment Flow, the Tasks,
   Claims and Leave workflows.

   A step shows its icon, its word, an optional line under it and an
   optional count. A step with `onClick` is a button (S2-5: pressing a
   pipeline step filters the list under it); `pressed` says it is the one in
   force. A step with no count shows none - never an invented zero.
   On a phone the strip scrolls sideways inside itself; the page never does.

   One component so the modules cannot drift apart. It fetches nothing.

   v1.342.0 - `arrows` (the CEO, 17-11-2026, the Sales Pipeline picture): the
   steps join into one row of chevrons, each tinted by its tone, the icon
   beside the word with the count under it and a ">" when the step can be
   pressed. Layout only: the same steps, counts and presses. */

import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import css from "./flow-strip.module.css";

export type FlowTone = "neutral" | "gold" | "blue" | "green" | "purple" | "red";
export interface FlowStep {
  key: string; icon: AppIconName; label: ReactNode; sub?: ReactNode; tone?: FlowTone;
  /** how many records stand on this step now; undefined draws no number */
  count?: number | null;
  onClick?: () => void; pressed?: boolean;
}

export function FlowStrip({ steps, label, testid, compact = false, arrows = false }: {
  steps: readonly FlowStep[]; label: string; testid?: string;
  /** one line per step, the count under the word; otherwise icon over the words */
  compact?: boolean;
  /** with compact: the steps join into one row of tinted chevrons (the Sales Pipeline) */
  arrows?: boolean;
}) {
  return (
    <div className={arrows ? `${css.scroll} ${css.scrollArrows}` : css.scroll}>
      <ol className={`${css.strip} ${arrows ? css.arrows : compact ? css.compact : css.stacked}`} aria-label={label} data-testid={testid}>
        {steps.map((s) => {
          const body = (
            <>
              <span className={css.icon} aria-hidden><AppIcon name={s.icon} /></span>
              <span className={css.words}>
                <strong>{s.label}</strong>
                {s.sub && <small>{s.sub}</small>}
                {compact && s.count != null && <span className={css.count} data-testid="flow-count">{s.count}</span>}
              </span>
              {!compact && s.count != null && <span className={css.count} data-testid="flow-count">{s.count}</span>}
              {arrows && s.onClick && <span className={css.go} aria-hidden><AppIcon name="next" /></span>}
            </>
          );
          return (
            <li key={s.key} className={css.step} data-tone={s.tone ?? "neutral"} data-step={s.key}>
              {s.onClick
                ? <button type="button" className={css.box} onClick={s.onClick} aria-pressed={s.pressed ?? false}>{body}</button>
                : <span className={css.box}>{body}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

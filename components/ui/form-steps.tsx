"use client";

/* v1.326.0 - THE FORM STEPPER (the CEO's "Improve Leave → Apply Leave",
   16-11-2026). One clean row of numbered steps for a form that is filled in
   stages - Leave Details → Review → Submitted, Claim Details → Attachments →
   Review & Submit: a circle per step joined by a line, gold for the step in
   hand and the steps done (a tick), the step in hand underlined. It says where
   the person is; it decides nothing - the form keeps its own step and checks.
   Drawn in a drawer's step row through DrawerSteps (side-drawer.tsx), or on a
   page as it is. Tokens only (styles/erp-v3.css .erp-steps). */

import { AppIcon } from "@/components/ui/app-icon";

export function FormSteps({ steps, current, label, testid }: {
  steps: readonly string[];
  /** 1-based: the step in hand */
  current: number;
  label: string;
  testid?: string;
}) {
  return (
    <ol className="erp-steps" aria-label={label} data-testid={testid}>
      {steps.map((s, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "now" : "todo";
        return (
          <li key={s} data-state={state} aria-current={state === "now" ? "step" : undefined}>
            <span className="erp-step-num" aria-hidden>{state === "done" ? <AppIcon name="success" /> : n}</span>
            <span className="erp-step-label">{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

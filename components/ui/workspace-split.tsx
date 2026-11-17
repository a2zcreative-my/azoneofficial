"use client";

/* v1.327.0 - THE TWO-PANE WORKSPACE (the CEO's Users & Security brief,
   16-11-2026: "Follow the attached Roles & Permissions MASTER STYLE" - a
   register on the left, the chosen record on the right, both inside one
   screen). The shape My Tasks proved in 1.326.0, made shared:

     WorkspaceSplit   the two panes on ONE flex line, held to the screen by
                      FillPanel from 1024px (a single flex line takes the
                      held height exactly; a grid's rows would grow past it).
                      One column below 1024px, where the page scrolls.
     SplitPane        one pane: its head (title, one line, the commands),
                      an optional toolbar, the body that scrolls inside when
                      the split is held, and an optional foot (a pager).

   Layout only: it fetches nothing and decides nothing. Tokens only. */

import type { ReactNode } from "react";
import { FillPanel } from "@/components/ui/fill-panel";
import css from "./workspace-split.module.css";

export function WorkspaceSplit({ children, testid, ratio = "60-40" }: {
  children: ReactNode;
  testid?: string;
  /** the register's share : the detail's share */
  ratio?: "60-40" | "55-45" | "50-50" | "35-65";
}) {
  return <FillPanel exact className={`${css.split} ${css[`r${ratio.replace("-", "_")}`] ?? ""}`} testid={testid}>{children}</FillPanel>;
}

/** a column of panes inside the split (two panes stacked on one side): each takes an equal share of the held height */
export function SplitColumn({ children, testid }: { children: ReactNode; testid?: string }) {
  return <div className={css.column} data-testid={testid}>{children}</div>;
}

export function SplitPane({ title, sub, actions, toolbar, children, foot, testid, label, fit = false }: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  testid?: string;
  label?: string;
  /** v1.337.0 - in a SplitColumn, this pane takes its own height and the others share the rest
      (a short fact list above a preview), instead of an equal share */
  fit?: boolean;
}) {
  return (
    <section className={`erp-card ${css.pane}`} data-testid={testid} aria-label={label} data-fit={fit ? "" : undefined}>
      <header className={css.head}>
        <div className={css.headText}>
          <h3 className={css.title}>{title}</h3>
          {sub && <p className={css.sub}>{sub}</p>}
        </div>
        {actions && <div className={css.actions}>{actions}</div>}
      </header>
      {toolbar && <div className={css.toolbar}>{toolbar}</div>}
      <div className={css.body}>{children}</div>
      {foot && <div className={css.foot}>{foot}</div>}
    </section>
  );
}

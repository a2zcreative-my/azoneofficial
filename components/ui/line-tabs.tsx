"use client";

/* v1.190.0 - THE UNDERLINE TABS. The owner's reference screens for Users
   (v1.189.0) and Desk (v1.190.0) draw a page's sections as a row of words
   with a gold rule under the open one, not as the pill row. One component, so
   the two pages cannot drift apart; every other page keeps SectionTabs.
   Bodies are the caller's: render every one and hide the closed ones, so a
   search typed or a form half filled survives a look at another tab. */

import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import css from "./line-tabs.module.css";

export function LineTabs<T extends string>({ value, onChange, tabs, label, aside }: {
  value: T;
  onChange: (v: T) => void;
  tabs: readonly (readonly [T, string])[];
  /** the tablist's accessible name */
  label: string;
  /** something that sits at the right end of the row (a filter, a period) */
  aside?: ReactNode;
}) {
  return (
    <div className={css.bar}>
      <div role="tablist" aria-label={label} className={css.tabs}>
        {tabs.map(([k, text]) => (
          <button key={k} type="button" role="tab" aria-selected={value === k}
            className={css.tab} onClick={() => onChange(k)}>
            {text}
          </button>
        ))}
      </div>
      {aside ? <div className={css.aside}>{aside}</div> : null}
    </div>
  );
}

/* v1.191.0 - the two things the owner's photos put at the right end of the
   tab row: the period being shown (a plain label - it is not a picker unless
   the page can really change its period) and the page's one main action, in
   the gold the photos give it (navy text: white on this gold fails contrast). */
export function TabPeriod({ children }: { children: ReactNode }) {
  return <span className={css.period}><AppIcon name="date" />{children}</span>;
}
export function TabAction({ icon, children, onClick, disabled }: { icon: AppIconName; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={css.action} onClick={onClick} disabled={disabled}>
      <AppIcon name={icon} />{children}
    </button>
  );
}
export function TabAside({ children }: { children: ReactNode }) {
  return <span className={css.asideRow}>{children}</span>;
}

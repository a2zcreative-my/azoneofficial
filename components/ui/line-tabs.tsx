"use client";

/* v1.190.0 - THE UNDERLINE TABS. The owner's reference screens for Users
   (v1.189.0) and Desk (v1.190.0) draw a page's sections as a row of words
   with a gold rule under the open one, not as the pill row. One component, so
   the two pages cannot drift apart; every other page keeps SectionTabs.
   Bodies are the caller's: render every one and hide the closed ones, so a
   search typed or a form half filled survives a look at another tab.

   v1.356.0 (the CEO, 18-11-2026: "tabs should follow like a dashboard ...
   globally"): on a PHONE the row becomes the Dashboard's view switch - one
   navy pill naming the open section ("Overview ▾"), a menu of every section
   with its count and a tick on the open one. A row of words ran off a 390px
   screen on most pages ("Customers & Agent", "Audit & Histo", "Re"). From
   768px the underline row is unchanged. Both are drawn and CSS shows one, so
   the page never jumps after it loads; the bodies stay the caller's. */

import { useId, useState, type ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import css from "./line-tabs.module.css";
import { getLang } from "@/lib/i18n";

export function LineTabs<T extends string>({ value, onChange, tabs, label, aside, testid }: {
  value: T;
  onChange: (v: T) => void;
  /** [key, label] or, v1.276.0 (A2Z OS 3.0), [key, label, count]: a count
      says how much waits behind the tab (Payments 2); 0 or null draws none.
      v1.281.0 - a fourth item is the phone's shorter word for the tab */
  tabs: readonly (readonly [T, string] | readonly [T, string, number | null | undefined] | readonly [T, string, number | null | undefined, string])[];
  /** the tablist's accessible name */
  label: string;
  /** something that sits at the right end of the row (a filter, a period) */
  aside?: ReactNode;
  /** v1.324.0 - each tab's test id is `${testid}-${key}` (a row moved onto LineTabs keeps its ids) */
  testid?: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const cur = tabs.find((t) => t[0] === value) ?? tabs[0];
  const ms = getLang() === "ms";
  return (
    <div className={css.bar}>
      {/* the phone's view switch (Dashboard "CEO View ▾") */}
      {cur ? (
        <div className={css.switch} onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
          <button type="button" className={css.chip} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
            aria-label={`${label}: ${cur[1]}`} data-testid={testid ? `${testid}-switch` : undefined}>
            <span className={css.chipText}>{cur[3] ?? cur[1]}</span>
            {cur[2] ? <span className={css.chipCount}>{cur[2]}</span> : null}
            <AppIcon name="expand" />
          </button>
          {open && (
            <div role="menu" aria-label={label} className={css.menu}>
              {tabs.map(([k, text, n]) => (
                <button key={k} type="button" role="menuitemradio" aria-checked={k === value} className={css.item}
                  onClick={() => { setOpen(false); if (k !== value) onChange(k); }} data-testid={testid ? `${testid}-menu-${k}` : undefined}>
                  <span aria-hidden className={css.tick}>{k === value ? "✓" : ""}</span>
                  <span className={css.itemText}>{text}</span>
                  {n ? <span className={css.count}>{n}<span className="erp-sr-only"> {ms ? "menunggu" : "waiting"}</span></span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      <div role="tablist" aria-label={label} className={css.tabs}>
        {tabs.map(([k, text, n, short]) => (
          /* v1.281.0 - the tab's NAME is the word it shows ("Payments", or
             "Documents" on a phone), so "click Payments" works by voice and
             by script whatever waits behind it; the count is its
             description ("1 waiting"), read from the hidden badge */
          <button key={k} type="button" role="tab" aria-selected={value === k}
            aria-describedby={n ? `${uid}-${k}-n` : undefined}
            className={css.tab} onClick={() => onChange(k)} data-testid={testid ? `${testid}-${k}` : undefined}>
            {/* v1.281.0 - a shorter word on a phone (Sales: "Documents") */}
            {short ? <><span className="erp-desktop-only">{text}</span><span className="erp-phone-only">{short}</span></> : text}
            {n ? <span className={css.count} id={`${uid}-${k}-n`} aria-hidden="true">{n}<span className="erp-sr-only"> {getLang() === "ms" ? "menunggu" : "waiting"}</span></span> : null}
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

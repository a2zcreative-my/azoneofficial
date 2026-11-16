"use client";

/* v1.321.0 - FILTERS BEHIND ONE BUTTON, shared (the CEO's Tasks Unified
   Workspace brief: "One command toolbar", "FilterPopover"). The toolbar
   keeps the search and the one or two filters people use every day; the
   rest sit behind "Filters (n)", where n is how many are in force. Open, the
   filters lie in a panel directly under the toolbar - in the page's own flow,
   so nothing covers the list and nothing traps the keyboard; Escape or Done
   closes it, Clear resets every filter it holds. */

import { useEffect, useState, type ReactNode } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { getLang } from "@/lib/i18n";
import css from "./filter-popover.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export function FilterPopover({ count, children, onClear, label, testid = "filters" }: {
  /** how many of the filters inside are in force */
  count: number; children: ReactNode; onClear: () => void; label?: string; testid?: string;
}) {
  const [open, setOpen] = useState(false);
  /* Escape closes the panel from anywhere on the page while it is open */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className={css.btn} aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={`${testid}-btn`} data-on={count > 0 || undefined}>
        <AppIcon name="search" />{label ?? L("Filters", "Penapis")}{count > 0 && <span className={css.badge}>{count}</span>}
      </button>
      {open && (
        <div className={css.panel} role="region" aria-label={label ?? L("Filters", "Penapis")} data-testid={testid}>
          <div className={css.fields}>{children}</div>
          <div className={css.foot}>
            <button type="button" className={css.link} onClick={onClear} disabled={count === 0}>{L("Clear filters", "Kosongkan penapis")}</button>
            <button type="button" className={css.done} onClick={() => setOpen(false)}>{L("Done", "Selesai")}</button>
          </div>
        </div>
      )}
    </>
  );
}

/** one labelled field inside the panel */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={css.field}><span>{label}</span>{children}</label>;
}

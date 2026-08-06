"use client";

/**
 * v1.4.249 — the minimalist row, as one shared pair of primitives.
 *
 * The standard (CEO: "my objective is globally and standardize"):
 *
 *   IDENTITY on the row · ACTIONS on the row · EVERYTHING ELSE one tap away.
 *
 * The identifier — document number, claim number, company, amount — is the
 * only thing you click to open a record. Buttons stay outside the panel so
 * nothing has to be opened before it can be done, and one record is open at a
 * time so a list can never grow taller than the screen.
 *
 * Usage:
 *   const [open, setOpen] = useState<number | null>(null);
 *   <RecordToggle open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)}>
 *     {r.doc_number}
 *   </RecordToggle>
 *   {open === r.id && <DetailGrid items={[{ label: "Date", value: … }]} />}
 *
 * NOT for tables. Inventory, Payroll and Attendance are dense on purpose and
 * are read by scanning and sorting columns — collapsing their rows would take
 * away the thing that makes them useful.
 */

import type { ReactNode } from "react";

export function RecordToggle({
  open, onToggle, title, className = "", children,
}: {
  open: boolean;
  onToggle: () => void;
  /** overrides the default show/hide tooltip */
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      title={title ?? (open ? "Hide the details" : "Show the details")}
      className={`font-medium underline decoration-dotted underline-offset-4 hover:decoration-solid ${className}`}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}

export interface DetailItem {
  label: string;
  value: ReactNode;
  /** spans both columns — for long values like an address or a note */
  wide?: boolean;
}

export function DetailGrid({ items }: { items: DetailItem[] }) {
  const shown = items.filter((i) => i.value !== null && i.value !== undefined && i.value !== "" && i.value !== false);
  if (shown.length === 0) return null;
  return (
    <dl className="bg-secondary/40 mt-2 grid gap-x-6 gap-y-1 rounded-lg px-3 py-2.5 text-xs sm:grid-cols-2">
      {shown.map((i) => (
        <div key={i.label} className={`flex justify-between gap-3 sm:justify-start ${i.wide ? "sm:col-span-2" : ""}`}>
          <dt className="text-muted-foreground sm:w-28 sm:shrink-0">{i.label}</dt>
          <dd className="min-w-0 font-medium">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

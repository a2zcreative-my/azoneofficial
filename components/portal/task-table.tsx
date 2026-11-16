"use client";

/* v1.321.0 - THE COMPACT TASK TABLE AND ITS TOOLBAR (the CEO's Tasks Unified
   Workspace brief: "Use one compact table", "Sortable columns", "Optional
   column visibility", "Pagination", "Row click opens a task detail drawer",
   "One command toolbar").

   CompactTaskTable draws rows it is given with the columns it is given; it
   sorts nothing and fetches nothing - the Tasks tab keeps its own filters,
   sort and rows, so the list and the figures above it stay one count. A
   header that can sort is a button saying which way it sorts; a column
   marked optional can be hidden from Columns; a row opens its task. */

import { useState, type ReactNode } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { PaginationControls, type PageSize } from "@/components/ui/pagination-controls";
import { SkelRows } from "@/components/ui/skeleton";
import { L } from "@/components/portal/page-shared";
import tt from "./task-table.module.css";

export type SortDir = "asc" | "desc";
export type TableCol<T> = {
  key: string; label: string;
  /** the sort key this header sets, when it can sort */
  sort?: string;
  /** may be hidden from Columns */
  optional?: boolean;
  cell: (row: T) => ReactNode;
  /** the column the row's name sits in (wider, left) */
  main?: boolean;
  /** stops the row's click (row commands) */
  cmds?: boolean;
};

export function CompactTaskTable<T extends { id: number }>({ rows, cols, label, loading, empty, hidden, sort, dir, onSort, onOpen, rowClass, page, size, onPage, onSize, testid = "task-table", picked, dense = false, fill = false, record = "task" }: {
  rows: T[]; cols: TableCol<T>[]; label: string; loading?: boolean; empty?: ReactNode;
  hidden?: ReadonlySet<string>;
  sort?: string; dir?: SortDir; onSort?: (key: string) => void;
  onOpen: (id: number) => void; rowClass?: (row: T) => string;
  page?: number; size?: number; onPage?: (p: number) => void; onSize?: (s: PageSize) => void;
  testid?: string;
  /** v1.326.0 - a pick list (My Tasks beside its task): the row on show is marked, as the Project Register marks its row */
  picked?: number | null;
  /** v1.326.0 - the narrow list beside a task: tighter cells, no wide first column */
  dense?: boolean;
  /** v1.326.0 - the table takes the height its column is given (My Tasks beside its task, held to the screen by
      the split's FillPanel): the rows scroll inside under the pinned header, the pager stays under them */
  fill?: boolean;
  /** v1.327.0 - what a row is (data-record, data-testid): the register is shared beyond tasks (the audit trail, accounts) */
  record?: string;
}) {
  const shown = cols.filter((c) => !hidden?.has(c.key));
  const paged = page != null && size != null;
  const cur = paged ? Math.min(Math.max(1, page), Math.max(1, Math.ceil(rows.length / size))) : 1;
  const slice = paged ? rows.slice((cur - 1) * size, cur * size) : rows;
  if (loading) return <SkelRows rows={6} />;
  if (rows.length === 0) return <>{empty ?? <p className={tt.empty}><AppIcon name="success" />{L("No tasks.", "Tiada tugasan.")}</p>}</>;
  return (
    <div className={`${tt.wrap} ${dense ? tt.dense : ""} ${fill ? tt.fill : ""}`} data-testid={testid}>
      <div className={tt.scroll}>
        <table className={tt.table} aria-label={label}>
          <thead>
            <tr>
              {shown.map((c) => (
                <th key={c.key} scope="col" className={c.main ? tt.main : c.cmds ? tt.cmdsHead : ""} aria-sort={c.sort && sort === c.sort ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort && onSort ? (
                    <button type="button" className={tt.sortBtn} onClick={() => onSort(c.sort!)} data-testid={`sort-${c.key}`} data-on={sort === c.sort || undefined}>
                      {c.label}<AppIcon name={sort === c.sort ? (dir === "asc" ? "up" : "down") : "expand"} className={tt.sortIcon} />
                    </button>
                  ) : c.cmds ? <span className="erp-sr-only">{c.label}</span> : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id} data-record={`${record}:${r.id}`} className={rowClass?.(r) ?? ""} onClick={() => onOpen(r.id)}
                tabIndex={-1} data-testid={`${record}-row`} aria-current={picked != null && picked === r.id ? "true" : undefined}>
                {shown.map((c) => (
                  <td key={c.key} data-label={c.label} className={c.main ? tt.main : c.cmds ? tt.cmds : ""} onClick={c.cmds ? (e) => e.stopPropagation() : undefined}>{c.cell(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paged && onPage && <PaginationControls page={cur} total={rows.length} size={size} onPage={onPage} onSize={onSize} label={L(`${label} pages`, `Halaman ${label}`)} />}
    </div>
  );
}

/** v1.326.0 - a row's name as a button: the keyboard opens the row the way a click on it does */
export function TaskRowTitle({ title, onOpen, late = false }: { title: string; onOpen: () => void; late?: boolean }) {
  return <button type="button" className={tt.rowTitle} data-late={late || undefined} onClick={(e) => { e.stopPropagation(); onOpen(); }}>{title}</button>;
}

/** the line under a row's name: its project, its due day */
export function TaskRowSub({ children }: { children: ReactNode }) { return <span className={tt.sub}>{children}</span>; }

/** Columns: which optional columns the table shows */
export function ColumnPicker({ cols, hidden, onToggle }: { cols: { key: string; label: string; optional?: boolean }[]; hidden: ReadonlySet<string>; onToggle: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const opt = cols.filter((c) => c.optional);
  if (opt.length === 0) return null;
  return (
    <span className={tt.colWrap}>
      <button type="button" className={tt.toolBtn} aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="columns-btn"
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
        <AppIcon name="preview" />{L("Columns", "Lajur")}{hidden.size > 0 && <span className={tt.badge}>{opt.length - [...hidden].filter((k) => opt.some((c) => c.key === k)).length}/{opt.length}</span>}
      </button>
      {open && (
        <span className={tt.colMenu} role="group" aria-label={L("Columns shown", "Lajur dipaparkan")} data-testid="columns"
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          {opt.map((c) => (
            <label key={c.key} className={tt.colItem}>
              <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />{c.label}
            </label>
          ))}
        </span>
      )}
    </span>
  );
}

/** TaskToolbar: the search, the one or two filters used every day, then the rest (Filters, Columns, views) */
export function TaskToolbar({ q, onQ, placeholder, children, aside, testid = "task-toolbar" }: {
  q: string; onQ: (v: string) => void; placeholder: string; children?: ReactNode; aside?: ReactNode; testid?: string;
}) {
  return (
    <div className={tt.toolbar} role="search" data-testid={testid}>
      <label className={tt.search}>
        <AppIcon name="search" />
        <input type="search" value={q} aria-label={L("Search tasks", "Cari tugasan")} placeholder={placeholder} onChange={(e) => onQ(e.target.value)} />
      </label>
      {children}
      {aside}
    </div>
  );
}

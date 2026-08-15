"use client";

/* v1.18.0 — the ERP data table (UI-REDESIGN Phase 2; the DZI reference's
 * entries-per-page / search / sort / pagination pattern).
 *
 * The audit found ELEVEN hand-pasted sortable-header renderers and nine
 * duplicated sort-state hook pairs across the panels. This is the one
 * implementation new modules use (and existing panels migrate to, panel by
 * panel — not in one big-bang sweep).
 *
 * Client-side on purpose: every list this system shows is bounded (orders,
 * entries, claims for ONE small company), the API already returns whole
 * lists, and the static-export architecture has no server to page on. If a
 * table ever crosses ~2,000 rows the module should paginate at the API and
 * pass `rows` per page — the chrome here stays the same.
 *
 * No generics gymnastics: columns access their row through `render`, sorting
 * through `sortValue`. Both receive the raw row; the table never inspects
 * row shape beyond `id`.
 */

import { useMemo, useState, type ReactNode } from "react";

import { btnSm, inputClassSm, td, tdR2, th, thR2 } from "@/lib/ui-styles";

export interface DataColumn<T> {
  key: string;
  label: string;
  /** Right-aligned tabular numerals (uses the v1.4.198 numeric-cell tokens). */
  numeric?: boolean;
  /** Cell renderer. Defaults to `String(row[key] ?? "")`. */
  render?: (row: T) => ReactNode;
  /** Sort value. Defaults to the rendered string; supply for dates/amounts. */
  sortValue?: (row: T) => string | number;
  /** Set false for action columns. Default true. */
  sortable?: boolean;
}

export function DataTable<T extends { id: number | string }>({
  columns, rows, searchText, defaultSort, defaultDir = "desc",
  pageSizes = [10, 25, 50], empty = "No records yet.", footer,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  /** Row → haystack for the search box. Omit to hide the search box. */
  searchText?: (row: T) => string;
  /** Initial sort column key. Omit for API order. */
  defaultSort?: string;
  defaultDir?: "asc" | "desc";
  pageSizes?: number[];
  empty?: string;
  /** Left slot of the footer row (e.g. a total). */
  footer?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<string | null>(defaultSort ?? null);
  const [dir, setDir] = useState<"asc" | "desc">(defaultDir);
  const [per, setPer] = useState(pageSizes[0] ?? 10);
  const [page, setPage] = useState(1);

  const shaped = useMemo(() => {
    let out = rows;
    if (q && searchText) {
      const needle = q.toLowerCase();
      out = out.filter((r) => searchText(r).toLowerCase().includes(needle));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort);
      if (col) {
        const val = (r: T) => col.sortValue ? col.sortValue(r) : String((r as Record<string, unknown>)[col.key] ?? "");
        out = [...out].sort((a, b) => {
          const [va, vb] = [val(a), val(b)];
          const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
          return dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return out;
  }, [rows, q, sort, dir, columns, searchText]);

  const pages = Math.max(1, Math.ceil(shaped.length / per));
  const cur = Math.min(page, pages); // deleting the last row of the last page must not strand you
  const slice = shaped.slice((cur - 1) * per, cur * per);
  const arrow = (key: string) => (sort === key ? (dir === "asc" ? " ↑" : " ↓") : "");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <select className={inputClassSm} value={per}
            onChange={(e) => { setPer(Number(e.target.value)); setPage(1); }} aria-label="Entries per page">
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          entries per page
        </label>
        {searchText && (
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            Search:
            <input className={inputClassSm} value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search this table" />
          </label>
        )}
      </div>

      {/* min-w + overflow: ERP tables have 8+ columns; phones scroll the table
          sideways instead of crushing every cell to one word per line. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false;
                return (
                  <th key={c.key} className={c.numeric ? thR2 : th}
                    aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                    {sortable ? (
                      <button type="button" className="hover:text-foreground font-semibold tracking-wide uppercase"
                        onClick={() => {
                          if (sort === c.key) setDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setSort(c.key); setDir(c.numeric ? "desc" : "asc"); }
                          setPage(1);
                        }}>
                        {c.label}{arrow(c.key)}
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr><td colSpan={columns.length} className="text-muted-foreground px-3 py-8 text-center text-sm">
                {q ? "Nothing matches that search." : empty}
              </td></tr>
            ) : slice.map((r) => (
              <tr key={r.id} className="border-border hover:bg-secondary/50 border-t transition-colors">
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? tdR2 : td}>
                    {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {footer ?? (shaped.length === 0 ? "Showing 0 entries"
            : `Showing ${(cur - 1) * per + 1} to ${Math.min(cur * per, shaped.length)} of ${shaped.length} entries`)}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <button type="button" className={btnSm} disabled={cur === 1} onClick={() => setPage(1)} aria-label="First page">«</button>
            <button type="button" className={btnSm} disabled={cur === 1} onClick={() => setPage(cur - 1)} aria-label="Previous page">‹</button>
            <span className="text-muted-foreground px-1.5 tabular-nums">{cur} / {pages}</span>
            <button type="button" className={btnSm} disabled={cur === pages} onClick={() => setPage(cur + 1)} aria-label="Next page">›</button>
            <button type="button" className={btnSm} disabled={cur === pages} onClick={() => setPage(pages)} aria-label="Last page">»</button>
          </div>
        )}
      </div>
    </div>
  );
}

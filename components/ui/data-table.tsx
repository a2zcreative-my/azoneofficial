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

import { EmptyState } from "@/components/ui/empty-state";
import { Skel } from "@/components/ui/skeleton";
import { btnSm, inputClassSm, td, tdR2, th, thR2 } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

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
  pageSizes = [10, 25, 50], empty, emptyHint, emptyAction, loading = false, footer,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  /** Row → haystack for the search box. Omit to hide the search box. */
  searchText?: (row: T) => string;
  /** Initial sort column key. Omit for API order. */
  defaultSort?: string;
  defaultDir?: "asc" | "desc";
  pageSizes?: number[];
  /** WHAT is empty (v1.170.0: rendered through the shared EmptyState). */
  empty?: string;
  /** WHY it is likely empty and what fills it. */
  emptyHint?: string;
  /** The one thing they can do about it. */
  emptyAction?: ReactNode;
  /** v1.170.0 - the answer is not known yet: skeleton rows in the table's own
      shape, so the chrome does not jump when the data lands. Never render a
      confident "No records yet." while a request is still in flight. */
  loading?: boolean;
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
            onChange={(e) => { setPer(Number(e.target.value)); setPage(1); }} aria-label={L("Entries per page", "Entri setiap halaman")}>
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {L("entries per page", "entri setiap halaman")}
        </label>
        {searchText && (
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            {L("Search:", "Cari:")}
            <input className={inputClassSm} value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label={L("Search this table", "Cari dalam jadual ini")} />
          </label>
        )}
      </div>

      {/* min-w + overflow: ERP tables have 8+ columns; phones scroll the table
          sideways instead of crushing every cell to one word per line.
          v1.170.0 - the frame owns the scroll in BOTH directions and the header
          stays put (styles/globals.css .erp-table), so a long list is read
          against its column names rather than from memory. */}
      <div className="erp-table-wrap" aria-busy={loading || undefined}>
        <table className="erp-table min-w-[640px]">
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
            {loading ? (
              Array.from({ length: Math.min(per, 6) }, (_, i) => (
                <tr key={`skel-${i}`} aria-hidden>
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? tdR2 : td}>
                      <Skel className={`h-3.5 ${c.numeric ? "ml-auto w-14" : i % 2 ? "w-2/3" : "w-1/2"}`} />
                    </td>
                  ))}
                </tr>
              ))
            ) : slice.length === 0 ? (
              <tr><td colSpan={columns.length} className="p-0">
                {q ? (
                  <EmptyState icon="search"
                    title={L("Nothing matches that search.", "Tiada padanan untuk carian itu.")}
                    hint={L("Try fewer words, or clear the search to see every row again.", "Cuba kurangkan perkataan, atau kosongkan carian untuk melihat semua baris semula.")}
                    action={<button type="button" className={btnSm} onClick={() => { setQ(""); setPage(1); }}>{L("Clear search", "Kosongkan carian")}</button>} />
                ) : (
                  <EmptyState title={empty ?? L("No records yet.", "Tiada rekod lagi.")} hint={emptyHint} action={emptyAction} />
                )}
              </td></tr>
            ) : slice.map((r) => (
              <tr key={r.id} className="transition-colors">
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
          {/* the house rule (tests/skeleton-loading.mjs): a shape, never a word about waiting */}
          {footer ?? (loading ? <Skel className="inline-block h-3 w-40 align-middle" /> : shaped.length === 0 ? L("Showing 0 entries", "Memaparkan 0 entri")
            : L(`Showing ${(cur - 1) * per + 1} to ${Math.min(cur * per, shaped.length)} of ${shaped.length} entries`,
              `Memaparkan ${(cur - 1) * per + 1} hingga ${Math.min(cur * per, shaped.length)} daripada ${shaped.length} entri`))}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <button type="button" className={btnSm} disabled={cur === 1} onClick={() => setPage(1)} aria-label={L("First page", "Halaman pertama")}>«</button>
            <button type="button" className={btnSm} disabled={cur === 1} onClick={() => setPage(cur - 1)} aria-label={L("Previous page", "Halaman sebelumnya")}>‹</button>
            <span className="text-muted-foreground px-1.5 tabular-nums">{cur} / {pages}</span>
            <button type="button" className={btnSm} disabled={cur === pages} onClick={() => setPage(cur + 1)} aria-label={L("Next page", "Halaman seterusnya")}>›</button>
            <button type="button" className={btnSm} disabled={cur === pages} onClick={() => setPage(pages)} aria-label={L("Last page", "Halaman terakhir")}>»</button>
          </div>
        )}
      </div>
    </div>
  );
}

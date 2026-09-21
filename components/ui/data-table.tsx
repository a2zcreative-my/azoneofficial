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
 *
 * v1.172.0 (Portal UI V2) — the same table, more of it, all opt-in:
 *   filters       quick-filter chips over the loaded rows, active-filter
 *                 chips with ✕ and one Clear all; every filter is a real
 *                 predicate the caller supplies - nothing here pretends
 *   selectable    a checkbox column; the selection is announced above the
 *                 table in a contextual action bar that offers ONLY the
 *                 bulkActions the caller passes (and the built-in CSV export
 *                 when csvExport is given: selected rows if any, else the
 *                 rows on screen - the v1.74.0 rule, tests/csv-export.mjs)
 *   onRowClick    the row opens something (a drawer, a detail); rows become
 *                 keyboard stops - Up/Down walk them, Enter/Space open
 *   density       comfortable or compact, remembered per table `id`
 *   columns menu  hide and show columns, remembered per table `id`
 *   rowActions    a trailing cell of per-row commands, never sorted
 * Sticky header, framed scroll, skeleton and empty states are as before
 * (styles/globals.css .erp-table*).
 * v1.172.2 (Tailwind retired): the component's own chrome is
 * data-table.module.css; no utility class is left in this file.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Skel } from "@/components/ui/skeleton";
import { downloadCsv } from "@/lib/csv";
import { btnSm, btnSmDanger, inputClassSm, menuCard, selectClassSm, tabPill, tabPillOn, td, tdR2, th, thR2 } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import s from "./data-table.module.css";

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
  /** v1.172.0 - set false to keep a column out of the Columns menu (an
      identifier the row makes no sense without). Default true. */
  hideable?: boolean;
}

/** v1.172.0 - one quick filter: a label, its options and the predicate that
    decides whether a row matches a chosen option. */
export interface TableFilter<T> {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  test: (row: T, value: string) => boolean;
}

/** v1.172.0 - a command over the selected rows. Only what the caller can
    really do belongs here; the bar draws nothing on its own. */
export interface BulkAction<T> {
  label: string;
  run: (rows: T[]) => void | Promise<void>;
  tone?: "default" | "danger";
}

/** v1.172.0 - a CSV of the table: selected rows if any are selected,
    otherwise the rows on screen after search, filters and sort. */
export interface CsvExport<T> {
  /** File name without the extension; the MYT stamp is appended by lib/csv. */
  name: string;
  headers: string[];
  row: (r: T) => (string | number | null | undefined)[];
}

type Density = "comfortable" | "compact";

const storageKey = (id: string | undefined, what: string) => (id ? `azone-table:${id}:${what}` : null);
function readPref<V>(key: string | null, parse: (raw: string) => V | null): V | null {
  if (!key) return null;
  try { const raw = localStorage.getItem(key); return raw === null ? null : parse(raw); } catch { return null; }
}
function writePref(key: string | null, value: string): void {
  if (!key) return;
  try { localStorage.setItem(key, value); } catch { /* a convenience, not state */ }
}
const parseHidden = (raw: string): string[] | null => {
  try { const a: unknown = JSON.parse(raw); return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : null; } catch { return null; }
};

export function DataTable<T extends { id: number | string }>({
  columns, rows, searchText, defaultSort, defaultDir = "desc",
  pageSizes = [10, 25, 50], empty, emptyHint, emptyAction, loading = false, footer,
  id, filters = [], selectable = false, bulkActions = [], csvExport, onRowClick, rowActions, rowActionsLabel,
  toolbar,
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
  /** v1.172.0 - a stable name for this table; density and hidden columns are
      remembered under it on this device. Omit and nothing is remembered. */
  id?: string;
  /** v1.172.0 - quick filters over the loaded rows. */
  filters?: TableFilter<T>[];
  /** v1.172.0 - a checkbox column and the contextual action bar. */
  selectable?: boolean;
  bulkActions?: BulkAction<T>[];
  csvExport?: CsvExport<T>;
  /** v1.172.0 - the row opens something. Rows become keyboard stops. */
  onRowClick?: (row: T) => void;
  /** v1.172.0 - per-row commands in a trailing, unsorted cell. */
  rowActions?: (row: T) => ReactNode;
  rowActionsLabel?: string;
  /** v1.172.0 - extra controls at the right of the toolbar (module-specific). */
  toolbar?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<string | null>(defaultSort ?? null);
  const [dir, setDir] = useState<"asc" | "desc">(defaultDir);
  const [per, setPer] = useState(pageSizes[0] ?? 10);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<number | string>>(() => new Set());
  const [density, setDensity] = useState<Density>(() => readPref(storageKey(id, "density"), (r) => (r === "compact" ? "compact" : "comfortable")) ?? "comfortable");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(readPref(storageKey(id, "hidden"), parseHidden) ?? []));
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement | null>(null);

  /* The Columns menu closes on an outside press or Escape, like any menu. */
  useEffect(() => {
    if (!colsOpen) return;
    const away = (e: MouseEvent) => { if (!colsRef.current?.contains(e.target as Node)) setColsOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setColsOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [colsOpen]);

  const shown = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);

  const shaped = useMemo(() => {
    let out = rows;
    if (q && searchText) {
      const needle = q.toLowerCase();
      out = out.filter((r) => searchText(r).toLowerCase().includes(needle));
    }
    for (const f of filters) {
      const v = active[f.key];
      if (v) out = out.filter((r) => f.test(r, v));
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
  }, [rows, q, sort, dir, columns, searchText, filters, active]);

  const pages = Math.max(1, Math.ceil(shaped.length / per));
  const cur = Math.min(page, pages); // deleting the last row of the last page must not strand you
  const slice = shaped.slice((cur - 1) * per, cur * per);
  const arrow = (key: string) => (sort === key ? (dir === "asc" ? " ↑" : " ↓") : "");

  /* Selection lives on ids; rows that left the list (a filter, a refetch)
     drop out of the count silently rather than being acted on unseen. */
  const selectedRows = useMemo(() => (selectable ? shaped.filter((r) => selected.has(r.id)) : []), [selectable, shaped, selected]);
  const allOnPage = slice.length > 0 && slice.every((r) => selected.has(r.id));
  const someOnPage = slice.some((r) => selected.has(r.id));
  const toggleRow = (rid: number | string) => setSelected((s) => { const n = new Set(s); if (n.has(rid)) n.delete(rid); else n.add(rid); return n; });
  const togglePage = () => setSelected((s) => { const n = new Set(s); if (allOnPage) slice.forEach((r) => n.delete(r.id)); else slice.forEach((r) => n.add(r.id)); return n; });
  const clearSelection = () => setSelected(new Set());
  const headCheck = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (headCheck.current) headCheck.current.indeterminate = someOnPage && !allOnPage; }, [someOnPage, allOnPage]);

  const activeChips = filters.flatMap((f) => (active[f.key] ? [{ key: f.key, label: f.label, value: f.options.find((o) => o.value === active[f.key])?.label ?? active[f.key] }] : []));
  const clearAll = () => { setActive({}); setQ(""); setPage(1); };

  const exportCsv = () => {
    if (!csvExport) return;
    const src = selectedRows.length > 0 ? selectedRows : shaped;
    downloadCsv(csvExport.name, [csvExport.headers, ...src.map((r) => csvExport.row(r))]);
  };

  const setDensityPref = (d: Density) => { setDensity(d); writePref(storageKey(id, "density"), d); };
  const toggleColumn = (key: string) => setHidden((h) => {
    const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key);
    writePref(storageKey(id, "hidden"), JSON.stringify([...n]));
    return n;
  });

  /* Rows as keyboard stops when they open something. */
  const onRowKey = useCallback((e: KeyboardEvent<HTMLTableRowElement>, r: T) => {
    if (!onRowClick) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(r); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const trs = Array.from(bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]") ?? []);
      const at = trs.indexOf(e.currentTarget);
      trs[e.key === "ArrowDown" ? Math.min(at + 1, trs.length - 1) : Math.max(at - 1, 0)]?.focus();
    }
  }, [onRowClick]);

  const hasTools = filters.length > 0 || !!id || !!csvExport || !!toolbar;
  /* v1.172.1 (Interface System V3): the toolbar, the filter chips and the
     action bar are named classes in styles/erp-v3.css; the bar redefines
     the button tokens on itself, so the same btnSm reads on navy. */
  const chipBtn = "erp-filter-chip";
  const barBtn = btnSm;

  return (
    <div>
      <div className="erp-toolbar">
        <label className={s.toolLabel}>
          <select className={selectClassSm} value={per}
            onChange={(e) => { setPer(Number(e.target.value)); setPage(1); }} aria-label={L("Entries per page", "Entri setiap halaman")}>
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {L("entries per page", "entri setiap halaman")}
        </label>
        <div className="erp-toolbar-group">
          {searchText && (
            <label className={s.toolLabel}>
              {L("Search:", "Cari:")}
              <input type="search" className={inputClassSm} value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label={L("Search this table", "Cari dalam jadual ini")} />
            </label>
          )}
          {hasTools && (
            <div className="erp-toolbar-group">
              {toolbar}
              {csvExport && (
                <button type="button" className={btnSm} onClick={exportCsv} disabled={loading || shaped.length === 0}
                  title={L("Download these rows as a CSV file", "Muat turun baris ini sebagai fail CSV")}>
                  {L("Export CSV", "Eksport CSV")}
                </button>
              )}
              {id && (
                <>
                  <button type="button" className={btnSm} aria-pressed={density === "compact"}
                    onClick={() => setDensityPref(density === "compact" ? "comfortable" : "compact")}
                    title={L("Row density", "Ketumpatan baris")}>
                    {density === "compact" ? L("Compact", "Padat") : L("Comfortable", "Selesa")}
                  </button>
                  <div ref={colsRef} className={s.colsAnchor}>
                    <button type="button" className={btnSm} aria-haspopup="menu" aria-expanded={colsOpen} onClick={() => setColsOpen((v) => !v)}>
                      {L("Columns", "Lajur")}{hidden.size > 0 ? ` (${shown.length}/${columns.length})` : ""}
                    </button>
                    {colsOpen && (
                      <div role="menu" aria-label={L("Show or hide columns", "Tunjuk atau sembunyi lajur")}
                        className={`${menuCard} ${s.colsMenu}`}>
                        {columns.map((c) => {
                          const locked = c.hideable === false;
                          return (
                            <label key={c.key} role="menuitemcheckbox" aria-checked={!hidden.has(c.key)}
                              className={`${s.colsItem} ${locked ? s.colsItemLocked : ""}`}>
                              <input type="checkbox" className="erp-check" checked={!hidden.has(c.key)} disabled={locked} onChange={() => toggleColumn(c.key)} />
                              <span className="erp-grow erp-truncate">{c.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* v1.172.0 - quick filters. Chips when a filter has a handful of
          options, a select when it has many; the chosen values repeat below
          as removable chips so the table is never quietly narrowed. */}
      {filters.length > 0 && (
        <div className={s.filters}>
          {filters.map((f) => (
            <div key={f.key} className={s.filterRow}>
              <span className={s.filterLabel}>{f.label}</span>
              {f.options.length <= 6 ? (
                <>
                  <button type="button" className={active[f.key] ? tabPill : tabPillOn} aria-pressed={!active[f.key]}
                    onClick={() => { setActive((a) => { const n = { ...a }; delete n[f.key]; return n; }); setPage(1); }}>
                    {L("All", "Semua")}
                  </button>
                  {f.options.map((o) => (
                    <button key={o.value} type="button" className={active[f.key] === o.value ? tabPillOn : tabPill} aria-pressed={active[f.key] === o.value}
                      onClick={() => { setActive((a) => ({ ...a, [f.key]: o.value })); setPage(1); }}>
                      {o.label}
                    </button>
                  ))}
                </>
              ) : (
                <select className={selectClassSm} value={active[f.key] ?? ""} aria-label={f.label}
                  onChange={(e) => { const v = e.target.value; setActive((a) => { const n = { ...a }; if (v) n[f.key] = v; else delete n[f.key]; return n; }); setPage(1); }}>
                  <option value="">{L("All", "Semua")}</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
          ))}
          {(activeChips.length > 0 || q) && (
            <div className={s.filterRow} aria-live="polite">
              <span className="erp-meta">{L("Filtered by", "Ditapis mengikut")}</span>
              {q && (
                <button type="button" className={chipBtn} onClick={() => { setQ(""); setPage(1); }}
                  aria-label={L(`Clear search "${q}"`, `Kosongkan carian "${q}"`)}>
                  “{q}” <span aria-hidden>×</span>
                </button>
              )}
              {activeChips.map((c) => (
                <button key={c.key} type="button" className={chipBtn}
                  onClick={() => { setActive((a) => { const n = { ...a }; delete n[c.key]; return n; }); setPage(1); }}
                  aria-label={L(`Remove filter ${c.label}: ${c.value}`, `Buang tapisan ${c.label}: ${c.value}`)}>
                  {c.label}: {c.value} <span aria-hidden>×</span>
                </button>
              ))}
              <button type="button" className={s.clearAll} onClick={clearAll}>{L("Clear all", "Kosongkan semua")}</button>
            </div>
          )}
        </div>
      )}

      {/* v1.172.0 - the contextual action bar: present only while something
          is selected, offering only what the caller can really do. */}
      {selectable && selectedRows.length > 0 && (
        <div role="region" aria-label={L("Selected rows", "Baris dipilih")} aria-live="polite"
          className={`erp-action-bar ${s.bar}`}>
          <span className={s.barCount}>{selectedRows.length}</span>
          <span className={s.barWord}>{L("selected", "dipilih")}</span>
          <span className={s.barRule} aria-hidden />
          {csvExport && <button type="button" className={barBtn} onClick={exportCsv}>{L("Export CSV", "Eksport CSV")}</button>}
          {bulkActions.map((a) => (
            <button key={a.label} type="button"
              className={a.tone === "danger" ? btnSmDanger : barBtn}
              onClick={() => void a.run(selectedRows)}>
              {a.label}
            </button>
          ))}
          <button type="button" className={s.clearSelection} onClick={clearSelection}>{L("Clear selection", "Kosongkan pilihan")}</button>
        </div>
      )}

      {/* min-w + overflow: ERP tables have 8+ columns; phones scroll the table
          sideways instead of crushing every cell to one word per line.
          v1.170.0 - the frame owns the scroll in BOTH directions and the header
          stays put (styles/globals.css .erp-table), so a long list is read
          against its column names rather than from memory. */}
      <div className="erp-table-wrap" aria-busy={loading || undefined}>
        <table className={`erp-table ${s.table} ${density === "compact" ? "erp-table-compact" : ""}`}>
          <thead>
            <tr>
              {selectable && (
                <th className={`${th} ${s.checkCol}`}>
                  <input ref={headCheck} type="checkbox" className="erp-check" checked={allOnPage} onChange={togglePage}
                    aria-label={allOnPage ? L("Deselect every row on this page", "Nyahpilih setiap baris di halaman ini") : L("Select every row on this page", "Pilih setiap baris di halaman ini")} />
                </th>
              )}
              {shown.map((c) => {
                const sortable = c.sortable !== false;
                return (
                  <th key={c.key} className={c.numeric ? thR2 : th}
                    aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                    {sortable ? (
                      <button type="button" className={s.sortButton}
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
              {rowActions && <th className={`${thR2} ${s.actionsCol}`}>{rowActionsLabel ?? <span className="erp-sr-only">{L("Actions", "Tindakan")}</span>}</th>}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {loading ? (
              Array.from({ length: Math.min(per, 6) }, (_, i) => (
                <tr key={`skel-${i}`} aria-hidden>
                  {selectable && <td className={td}><Skel h={14} w={14} /></td>}
                  {shown.map((c) => (
                    <td key={c.key} className={c.numeric ? tdR2 : td}>
                      <Skel className={c.numeric ? s.skelRight : ""} h={14} w={c.numeric ? 56 : i % 2 ? "66.666667%" : "50%"} />
                    </td>
                  ))}
                  {rowActions && <td className={tdR2}><Skel className={s.skelRight} h={14} w={40} /></td>}
                </tr>
              ))
            ) : slice.length === 0 ? null : slice.map((r) => {
              const isSel = selectable && selected.has(r.id);
              return (
                <tr key={r.id} data-row data-selected={isSel || undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  onKeyDown={onRowClick ? (e) => onRowKey(e, r) : undefined}
                  className={`${s.row} ${onRowClick ? "erp-row-click" : ""}`}>
                  {selectable && (
                    <td className={td} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="erp-check" checked={!!isSel} onChange={() => toggleRow(r.id)}
                        aria-label={L("Select row", "Pilih baris")} />
                    </td>
                  )}
                  {shown.map((c) => (
                    <td key={c.key} className={c.numeric ? tdR2 : td}>
                      {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                    </td>
                  ))}
                  {rowActions && <td className={`${tdR2} ${s.actionsCell}`} onClick={(e) => e.stopPropagation()}>{rowActions(r)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* v1.171.0 - the empty state sits UNDER the table, in the frame's own
            width, not in a cell spanning a 640 px table: inside the cell it
            centred on the table and a phone saw "No cash flow entries yet —
            paid" cut at the frame's edge, the rest a sideways scroll away. */}
        {!loading && slice.length === 0 && (
          <div className={s.emptyFrame}>
            {q || activeChips.length > 0 ? (
              <EmptyState icon="search"
                title={L("Nothing matches that search.", "Tiada padanan untuk carian itu.")}
                hint={L("Try fewer words, or clear the search to see every row again.", "Cuba kurangkan perkataan, atau kosongkan carian untuk melihat semua baris semula.")}
                action={<button type="button" className={btnSm} onClick={clearAll}>{L("Clear search", "Kosongkan carian")}</button>} />
            ) : (
              <EmptyState title={empty ?? L("No records yet.", "Tiada rekod lagi.")} hint={emptyHint} action={emptyAction} />
            )}
          </div>
        )}
      </div>

      <div className={s.foot}>
        <span className={s.footNote}>
          {/* the house rule (tests/skeleton-loading.mjs): a shape, never a word about waiting */}
          {footer ?? (loading ? <Skel className={s.footSkel} h={12} w={160} /> : shaped.length === 0 ? L("Showing 0 entries", "Memaparkan 0 entri")
            : L(`Showing ${(cur - 1) * per + 1} to ${Math.min(cur * per, shaped.length)} of ${shaped.length} entries`,
              `Memaparkan ${(cur - 1) * per + 1} hingga ${Math.min(cur * per, shaped.length)} daripada ${shaped.length} entri`))}
        </span>
        {pages > 1 && (
          <div className={s.pager}>
            <button type="button" className={btnSm} disabled={cur === 1} onClick={() => setPage(1)} aria-label={L("First page", "Halaman pertama")}>«</button>
            <button type="button" className={btnSm} disabled={cur === 1} onClick={() => setPage(cur - 1)} aria-label={L("Previous page", "Halaman sebelumnya")}>‹</button>
            <span className={s.pagerCount}>{cur} / {pages}</span>
            <button type="button" className={btnSm} disabled={cur === pages} onClick={() => setPage(cur + 1)} aria-label={L("Next page", "Halaman seterusnya")}>›</button>
            <button type="button" className={btnSm} disabled={cur === pages} onClick={() => setPage(pages)} aria-label={L("Last page", "Halaman terakhir")}>»</button>
          </div>
        )}
      </div>
    </div>
  );
}

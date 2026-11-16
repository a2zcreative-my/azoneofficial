"use client";

/* v1.321.0 - PAGINATION, shared (the CEO's Tasks Unified Workspace brief:
   "Pagination: default 10 or 15 rows, selectable 25 or 50"). "Showing 1-15
   of 42", the pages with the current one marked, and the rows-per-page
   choice. A list of one page shows only the count. */

import { AppIcon } from "@/components/ui/app-icon";
import { getLang } from "@/lib/i18n";
import css from "./pagination-controls.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export const PAGE_SIZES = [10, 15, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** the pages to draw: the first, the last, and the two around the current one */
export function pageList(page: number, pages: number): (number | "gap")[] {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const n of [...want].sort((a, b) => a - b)) { if (n - prev > 1) out.push("gap"); out.push(n); prev = n; }
  return out;
}

export function PaginationControls({ page, total, size, onPage, onSize, label, testid = "pagination" }: {
  page: number; total: number; size: number; onPage: (p: number) => void; onSize?: (s: PageSize) => void; label: string; testid?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const cur = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (cur - 1) * size + 1, to = Math.min(total, cur * size);
  return (
    <nav className={css.bar} aria-label={label} data-testid={testid}>
      <span className={css.count} data-testid="page-count">{L(`Showing ${from}–${to} of ${total}`, `Menunjukkan ${from}–${to} daripada ${total}`)}</span>
      {pages > 1 && (
        <span className={css.pages}>
          <button type="button" className={css.btn} disabled={cur <= 1} onClick={() => onPage(cur - 1)} aria-label={L("Previous page", "Halaman sebelum")}><AppIcon name="previous" /></button>
          {pageList(cur, pages).map((n, i) => n === "gap"
            ? <span key={`g${i}`} className={css.gap} aria-hidden>…</span>
            : <button key={n} type="button" className={css.btn} aria-current={n === cur ? "page" : undefined} onClick={() => onPage(n)}>{n}</button>)}
          <button type="button" className={css.btn} disabled={cur >= pages} onClick={() => onPage(cur + 1)} aria-label={L("Next page", "Halaman seterusnya")}><AppIcon name="next" /></button>
        </span>
      )}
      {onSize && (
        <label className={css.size}>
          <span>{L("Rows", "Baris")}</span>
          <select value={size} onChange={(e) => onSize(Number(e.target.value) as PageSize)} aria-label={L("Rows per page", "Baris setiap halaman")} data-testid="page-size">
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
    </nav>
  );
}

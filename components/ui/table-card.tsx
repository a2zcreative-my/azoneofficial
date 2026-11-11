"use client";

/* v1.276.0 - A2Z OS 3.0: ONE TABLE CARD (claude/UIUX-3.0-BLUEPRINT.md,
   approved by the CEO 10-11-2026). The chrome every list shares: a head
   (title, count, a line of what it holds, its actions), a filter bar, the
   table scrolling sideways INSIDE the card (never the page), and the three
   states a list can be in - loading (a skeleton, never a false zero), failed
   (ErrorState with Retry) and empty (EmptyState with the next valid action).
   The table itself stays the caller's markup: no query, sort or column moves
   into this component, and no money column is hidden by it. */

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkelTable } from "@/components/ui/skeleton";
import { card } from "@/lib/ui-styles";
import css from "./ui3.module.css";

export function TableCard({ title, count, sub, actions, filters, loading = false, error = false, onRetry, empty, isEmpty = false, foot, children, testId }: {
  title: ReactNode;
  /** how many rows match (shown beside the title) */
  count?: number | null;
  sub?: ReactNode;
  /** the card's own actions (Export, View all) - the page's ONE primary stays in the page frame */
  actions?: ReactNode;
  filters?: ReactNode;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** the empty state: what is empty, why, the next valid action */
  empty?: { title: string; hint?: string; action?: ReactNode };
  isEmpty?: boolean;
  /** under the table (paging, a total, "showing 25 of 140") */
  foot?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className={`${card} ${css.card}`} data-testid={testId} aria-busy={loading || undefined}>
      <div className={css.head}>
        <div className={css.headText}>
          <h3 className={css.headTitle}>
            {title}
            {count != null && !loading ? <span className={css.count}>{count}</span> : null}
          </h3>
          {sub ? <p className={css.headSub}>{sub}</p> : null}
        </div>
        {actions ? <div className={css.headActions}>{actions}</div> : null}
      </div>
      {filters ? <div className={css.filters}>{filters}</div> : null}
      {loading ? <SkelTable rows={5} cols={4} />
        : error ? <ErrorState onRetry={onRetry} />
        : isEmpty && empty ? <EmptyState title={empty.title} hint={empty.hint} action={empty.action} />
        : <div className={css.scroll}>{children}</div>}
      {foot && !loading && !error ? <div className={css.foot}>{foot}</div> : null}
    </section>
  );
}

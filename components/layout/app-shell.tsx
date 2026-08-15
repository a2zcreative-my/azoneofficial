"use client";

/* v1.14.0 — the canvas app shell.
 *
 * HISTORY, so the next person doesn't undo this by accident:
 *   v1.12.0  canvas + icon rail (reference set A)
 *   v1.13.0  replaced by a grouped labelled sidebar (reference set B / DZI)
 *   v1.14.0  back to the canvas + icon rail — the CEO reviewed both built and
 *            chose set A, adding the context panel and right rail.
 * `side-nav.tsx` is kept, unused, rather than deleted: it is the working
 * grouped-sidebar implementation and the module count is still climbing.
 *
 * Desktop layout:
 *
 *   backdrop (bg-shell-backdrop, p-5)
 *     └ canvas (rounded-shell, bg-background, shadow-shell, flex)
 *         ├ gutter (bg-brand, w-14, rounded-l-shell) → sticky icon rail
 *         ├ context panel (w-[264px], optional, own scroll)
 *         ├ main content (flex-1, min-w-0)
 *         └ right rail (w-[292px], optional, own scroll)
 *
 * PHONE: every rule below is `md:`-prefixed and the two side columns are
 * `hidden md:flex`, so this renders `children` in bare wrappers. The v1.11.1
 * bottom nav, More sheet and safe-area insets are untouched to the pixel.
 *
 * The gutter is a separate element from the rail on purpose: the rail is
 * sticky and one viewport tall, the gutter is as tall as the canvas. Without
 * it a long page shows white below the rail and the navy edge stops at the
 * fold. Nothing here may use `overflow-hidden` — it would kill the sticky.
 */

import type { ReactNode } from "react";

export function AppShell({
  rail, contextPanel, rightRail, children,
  maxWidth = "md:max-w-[1440px]",
}: {
  rail?: ReactNode;
  /** Left context column — mini calendar, "today at a glance". Desktop only. */
  contextPanel?: ReactNode;
  /** Right column — queues, availability, ops. Desktop only. */
  rightRail?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="md:bg-shell-backdrop md:min-h-screen md:p-5">
      <div className={`md:rounded-shell md:bg-background md:shadow-shell md:mx-auto md:flex ${maxWidth}`}>
        {rail ? (
          <div className="bg-brand rounded-l-shell hidden w-14 shrink-0 md:block">{rail}</div>
        ) : null}

        {contextPanel ? (
          <aside className="border-border bg-secondary hidden w-[264px] shrink-0 flex-col gap-3 overflow-y-auto border-r p-4 md:flex md:max-h-screen md:sticky md:top-5">
            {contextPanel}
          </aside>
        ) : null}

        <div className="min-w-0 md:flex-1">{children}</div>

        {rightRail ? (
          <aside className="border-border bg-secondary rounded-r-shell hidden w-[292px] shrink-0 flex-col gap-3 overflow-y-auto border-l p-4 md:flex md:max-h-screen md:sticky md:top-5">
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

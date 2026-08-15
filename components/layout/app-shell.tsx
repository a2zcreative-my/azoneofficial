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
 * v1.21.1 (CEO: "make the overfloat scrollable inside the UI/UX instead of
 * the outside UI/UX"): the shell is now FIXED to the viewport on desktop —
 * backdrop h-dvh, canvas h-full, and the CONTENT COLUMN is the scroll
 * container. The page itself never scrolls; the rounded canvas and both
 * side columns stay put like an app window. This retires the old sticky
 * dance entirely (rail/columns are simply full-height flex children), so
 * `overflow-hidden` on the canvas is now safe — and needed, to clip the
 * scrolling content to the rounded corners.
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
    <div className="md:bg-shell-backdrop md:h-dvh md:overflow-hidden md:p-5">
      <div className={`md:rounded-shell md:bg-background md:shadow-shell md:mx-auto md:flex md:h-full md:overflow-hidden ${maxWidth}`}>
        {rail ? (
          <div className="bg-brand rounded-l-shell hidden w-14 shrink-0 md:block">{rail}</div>
        ) : null}

        {contextPanel ? (
          <aside className="border-border bg-secondary hidden w-[264px] shrink-0 flex-col gap-3 overflow-y-auto border-r p-4 md:flex md:h-full">
            {contextPanel}
          </aside>
        ) : null}

        {/* THE scroll container on desktop — everything the tabs render
            scrolls inside here, under the sticky in-content header. The id
            lets the portal reset scrollTop on tab change (a new tab must
            open at its top, not wherever the last one was left). */}
        <div id="shell-scroll" className="min-w-0 md:h-full md:flex-1 md:overflow-y-auto">{children}</div>

        {rightRail ? (
          <aside className="border-border bg-secondary rounded-r-shell hidden w-[292px] shrink-0 flex-col gap-3 overflow-y-auto border-l p-4 md:flex md:h-full">
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

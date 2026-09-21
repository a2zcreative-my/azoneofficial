"use client";

/* v1.14.0 — the canvas app shell.
 *
 * HISTORY, so the next person doesn't undo this by accident:
 *   v1.12.0  canvas + icon rail (reference set A)
 *   v1.13.0  replaced by a grouped labelled sidebar (reference set B / DZI)
 *   v1.14.0  back to the canvas + icon rail — the CEO reviewed both built and
 *            chose set A, adding the context panel and right rail.
 * v1.164.0: the portal uses `navigation` with side-nav.tsx and a full-width
 * neutral workspace. The framed rail layout below remains for legacy callers.
 * v1.172.2: Tailwind retired - the layout is app-shell.module.css (one class
 * per box, the desktop rules behind the 768px query); nothing about the
 * geometry changed. tests/shell-scroll.mjs reads the containing-block rule
 * there now.
 *
 * Desktop layout:
 *
 *   backdrop (.backdropCanvas: shell backdrop, 1.25rem padding)
 *     └ canvas (.canvasFrameCanvas: 26px radius, page ground, shell shadow, flex, full width)
 *         ├ gutter (.gutter: brand navy, 3.5rem, rounded left) → sticky icon rail
 *         ├ context panel (.columnLeft: 264px, optional, own scroll)
 *         ├ main content (.scroll: flex 1, min-width 0)
 *         └ right rail (.columnRight: 292px, optional, own scroll)
 *
 * PHONE: every desktop rule in the module is behind `min-width: 768px` and
 * the two side columns are display:none below it, so this renders `children`
 * in bare wrappers. The v1.11.1 bottom nav, More sheet and safe-area insets
 * are untouched to the pixel.
 *
 * v1.21.1 (CEO: "make the overfloat scrollable inside the UI/UX instead of
 * the outside UI/UX"): the shell is now FIXED to the viewport on desktop —
 * backdrop 100dvh, canvas 100%, and the CONTENT COLUMN is the scroll
 * container. The page itself never scrolls; the rounded canvas and both
 * side columns stay put like an app window. This retires the old sticky
 * dance entirely (rail/columns are simply full-height flex children), so
 * `overflow: hidden` on the canvas is now safe — and needed, to clip the
 * scrolling content to the rounded corners.
 *
 * v1.88.1 (CEO, screenshot of the Leave tab: the canvas ending two-thirds
 * down the window with a white void below it and a SECOND scrollbar on the
 * page itself). Two holes in the v1.21.1 model, closed here:
 *
 *   1. The canvas was `overflow: hidden` but NOT `position: relative`. An absolutely
 *      positioned descendant with no positioned ancestor is laid out against
 *      the initial containing block — the document — so it grows the
 *      document's scrollable area straight through the clip. The clip never
 *      saw it. `position: relative` makes the canvas that element's containing block,
 *      and then the clip does its job.
 *   2. Nothing actually FORBADE the document from scrolling on desktop; the
 *      model relied on nothing ever escaping. `html.shell-locked` now does
 *      forbid it while the shell is mounted at md+, and is removed on unmount
 *      so the marketing pages and the phone layout are untouched.
 *
 * Both are belt and braces on purpose: (1) is the mechanism this screenshot
 * points at, (2) makes the symptom impossible whatever the next mechanism
 * turns out to be. And because "impossible" is a claim, the portal's
 * overflow self-report (v1.23.8, phones) now runs on desktop too, for HEIGHT:
 * if the document is still taller than the viewport it names the element and
 * writes it to the error_log, so the next occurrence carries its own cause.
 */

import { useEffect, type ReactNode } from "react";
import s from "./app-shell.module.css";

export function AppShell({
  rail, navigation, contextPanel, rightRail, children,
  /* v1.74.0 (CEO: "I want it full fit to the website width... dont change
     the interface layout or any new. just make it fit only") — the canvas
     capped at 1440px, so on a 1920 monitor a 370px band of backdrop sat down
     each side and the app read as a window that had failed to maximise.
     Nothing about the layout changes: the rounded canvas, the p-5 backdrop
     that makes it a canvas at all, the icon rail and both side columns are
     exactly as they were. Only the ceiling is gone, so the canvas takes the
     window it is given. A caller can still pass a class if a screen ever
     wants a cap (v1.172.2: a CSS Module class, not a utility). */
  maxWidth = "",
}: {
  rail?: ReactNode;
  /** Full-height labeled navigation; mutually exclusive with the legacy icon rail. */
  navigation?: ReactNode;
  /** Left context column — mini calendar, "today at a glance". Desktop only. */
  contextPanel?: ReactNode;
  /** Right column — queues, availability, ops. Desktop only. */
  rightRail?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
}) {
  /* v1.88.1 — the document does not scroll while the shell is on screen at
     md+. The rule lives in the <style> below, WITH the component that needs
     it: a class whose CSS sits in another file is a class that stops working
     the day that file is tidied. Behind a media query, so the phone layout
     (which scrolls the document by design) is untouched.

     v1.124.0 — this is the ONLY place in the app that overrides <html>
     overflow. The default owner is `html { overflow-y: scroll }` in
     styles/globals.css, which carries the full ownership note; if you are
     about to add a third owner, read that note first. Modals and drawers lock
     BODY, never <html>. tests/scroll-ownership.mjs holds the pair together. */
  useEffect(() => {
    document.documentElement.classList.add("shell-locked");
    return () => document.documentElement.classList.remove("shell-locked");
  }, []);
  return (
    <div className={navigation ? `erp-workspace ${s.workspace} ${s.backdrop}` : `${s.backdrop} ${s.backdropCanvas}`}>
      <style>{`@media (min-width: 768px) { html.shell-locked, html.shell-locked body { overflow: hidden; height: 100%; } }`}</style>
      <div className={`${s.canvasFrame} ${navigation ? s.canvasFrameWorkspace : s.canvasFrameCanvas} ${maxWidth}`}>
        {navigation}
        {!navigation && rail ? (
          <div className={s.gutter}>{rail}</div>
        ) : null}

        {contextPanel ? (
          <aside className={`${s.column} ${s.columnLeft}`}>
            {contextPanel}
          </aside>
        ) : null}

        {/* THE scroll container on desktop — everything the tabs render
            scrolls inside here, under the sticky in-content header. The id
            lets the portal reset scrollTop on tab change (a new tab must
            open at its top, not wherever the last one was left). */}
        {/* v1.23.4 (CEO: "Still overflow for Attendance"): the phone-width
            overflow-x: clip in the module is the STRUCTURAL guarantee — even
            if a future card is wider than the phone, it clips instead of
            panning the whole page sideways. `clip` (not hidden) so it
            creates no scroll container and the sticky mobile header keeps
            sticking. Desktop untouched. */}
        <div id="shell-scroll" className={s.scroll}>{children}</div>

        {rightRail ? (
          <aside className={`${s.column} ${s.columnRight}`}>
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

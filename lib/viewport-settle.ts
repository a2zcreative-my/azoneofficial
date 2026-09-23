/**
 * v1.181.4 - THE PAGE COMES BACK WHEN THE KEYBOARD GOES.
 *
 * The CEO's iPhone, 23-09-2026, on Profile after typing a new password: the
 * bottom bar floating a third of the way up the screen, the topbar gone off
 * the top, the page carrying on underneath the bar and a grey void past the
 * end of it.
 *
 * On a phone the portal scrolls the DOCUMENT; the topbar is sticky and the
 * bottom bar is `position: fixed`. Both are pinned to the LAYOUT viewport.
 * When the iOS keyboard opens, Safari shrinks the VISUAL viewport - the part
 * you actually see - and slides it down inside the layout viewport to keep
 * the field in view. When the keyboard closes it is meant to slide it back.
 * In an installed PWA it sometimes does not: `visualViewport.offsetTop`
 * stays at roughly the keyboard's height, so everything pinned to the layout
 * viewport is drawn that far UP. The bar in the screenshot sits exactly one
 * keyboard-height above the bottom.
 *
 * The cure is to scroll the layout viewport to where the person is actually
 * looking. The content stays put (or as close as the document's end allows)
 * and the offset collapses to zero, so the bars return to the edges. It runs
 * only when nothing editable is focused - with a field focused the keyboard
 * is up and the offset is Safari doing its job - and never under a pinch
 * zoom, where the offset is the person's own.
 *
 * Pure decision + a tiny installer, so tests/viewport-settle.mjs can RUN it
 * against a fake window instead of reading it.
 */

export interface ViewportLike {
  offsetTop: number;
  height: number;
  scale: number;
}

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/** Where the document should scroll to, or null to leave it alone. */
export function settleTarget(vv: ViewportLike | null | undefined, editableFocused: boolean, scrollY: number): number | null {
  if (!vv || editableFocused) return null;
  if (vv.scale > 1.01) return null;            // a pinch zoom is the person's own offset
  if (!(vv.offsetTop > 0.5)) return null;      // already where it belongs
  return Math.round(scrollY + vv.offsetTop);
}

type WinLike = Pick<Window, "scrollX" | "scrollY" | "scrollTo" | "setTimeout" | "clearTimeout" | "requestAnimationFrame" | "cancelAnimationFrame"> & {
  visualViewport: (ViewportLike & Pick<EventTarget, "addEventListener" | "removeEventListener">) | null;
  document: Pick<Document, "addEventListener" | "removeEventListener"> & { activeElement: Element | null };
};

/** Start watching; returns the cleanup. A browser without visualViewport
    (old Android WebViews) has nothing to settle and gets a no-op. */
export function installViewportSettle(win: WinLike): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  let raf = 0;
  const timers: number[] = [];

  const settle = () => {
    win.cancelAnimationFrame(raf);
    raf = win.requestAnimationFrame(() => {
      const a = win.document.activeElement;
      const editing = !!a && typeof (a as Element).matches === "function" && (a as Element).matches(EDITABLE);
      const to = settleTarget(vv, editing, win.scrollY);
      if (to !== null) win.scrollTo(win.scrollX, to);
    });
  };
  /* focusout fires while the keyboard is still sliding away; look again
     once it has gone (Safari's keyboard animation is ~250 ms). */
  const onFocusOut = () => {
    timers.push(win.setTimeout(settle, 80), win.setTimeout(settle, 400));
  };

  vv.addEventListener("resize", settle);
  win.document.addEventListener("focusout", onFocusOut);
  return () => {
    vv.removeEventListener("resize", settle);
    win.document.removeEventListener("focusout", onFocusOut);
    win.cancelAnimationFrame(raf);
    for (const t of timers) win.clearTimeout(t);
  };
}

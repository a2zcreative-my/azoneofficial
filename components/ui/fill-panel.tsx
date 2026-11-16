"use client";

/* v1.323.0 - THE PRIMARY PANEL FILLS THE SCREEN (the CEO's Global UI System
   brief, D-4, approved 16-11-2026; claude/UI-SYSTEM-STAGE-0-AUDIT.md §5).
   On a desktop (from 1024px) a view's one primary panel takes the height that
   is left under the header, the tabs and the figures, and its own records
   scroll inside it - the page frame stays where it is. It never hides a
   record and never clips one: when the room left is too small to be useful
   (a short window, 200% text) it lets the page scroll as before. On a phone
   and a tablet it does nothing: the page owns the up-and-down gesture there
   (CLAUDE.md v1.176.1 - never a scroller nested in the page on a phone). */

import { useEffect, useRef, useState, type ReactNode } from "react";
import css from "./fill-panel.module.css";

/** the smallest panel worth constraining; below it the page scrolls instead */
const MIN_PX = 320;
/** the breathing room kept under the panel and whatever follows it */
const FOOT_PX = 8;

const scrollerOf = (el: HTMLElement): HTMLElement => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.clientHeight > 0) return p;
  }
  return document.scrollingElement as HTMLElement;
};

export function FillPanel({ children, className = "", testid, label }: { children: ReactNode; className?: string; testid?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const measure = () => {
      if (!wide.matches) { setH(null); return; }
      if (el.getClientRects().length === 0) return; // a hidden tab: measured when it shows
      const sc = scrollerOf(el);
      const scTop = sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
      const box = el.getBoundingClientRect();
      const top = box.top - scTop + sc.scrollTop;
      /* what follows the panel stays on the screen too: at each level up to the
         scroller, the siblings BELOW it (its pager, a note - never a column beside
         it) and the level's own bottom padding and border. None of it changes
         with the panel's height, so two panels side by side never chase each other */
      let tail = 0;
      for (let node: HTMLElement = el; node.parentElement && node !== sc; node = node.parentElement) {
        const nb = node.getBoundingClientRect().bottom;
        let below = nb;
        for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
          const r = sib.getBoundingClientRect();
          if (r.height > 0 && r.top >= nb - 1) below = Math.max(below, r.bottom);
        }
        /* a sibling below already carries the margin between; the last one's own
           bottom margin still takes room (counted whole - never short) */
        tail += below > nb ? below - nb : parseFloat(getComputedStyle(node).marginBottom) || 0;
        const pcs = getComputedStyle(node.parentElement);
        tail += (parseFloat(pcs.paddingBottom) || 0) + (parseFloat(pcs.borderBottomWidth) || 0);
        if (node.parentElement === sc) break;
      }
      const room = sc.clientHeight - top - tail - FOOT_PX;
      setH(room >= MIN_PX ? Math.floor(room) : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    ro.observe(el);
    const sc0 = scrollerOf(el);
    ro.observe(sc0);
    if (sc0.firstElementChild) ro.observe(sc0.firstElementChild);
    wide.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); wide.removeEventListener("change", measure); window.removeEventListener("resize", measure); };
  }, []);
  return (
    <div ref={ref} className={`${css.fill} ${className}`} data-testid={testid} data-fill={h != null ? "on" : "off"}
      role={label ? "region" : undefined} aria-label={label} tabIndex={h != null && label ? 0 : undefined}
      style={h != null ? { maxHeight: `${h}px` } : undefined}>
      {children}
    </div>
  );
}

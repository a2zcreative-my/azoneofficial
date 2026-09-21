"use client";

/* v1.172.0 (Portal UI V2) — the contextual drawer.
 *
 * A record's detail and the commands that act on it, beside the list it came
 * from, without leaving the list: a right-hand panel on a desktop or tablet,
 * a bottom sheet on a phone. One component, so every module that opens a
 * row opens it the same way.
 *
 * What it guarantees, because a panel that only LOOKS modal is the classic
 * accessibility hole: it is a real dialog (role, aria-modal, labelled by its
 * own title); focus moves into it on open and back to the opener on close;
 * Tab cycles inside it; Escape and the backdrop close it; the page behind it
 * does not scroll. Motion is framer-motion, already a dependency, and stops
 * for prefers-reduced-motion. Colours are the semantic tokens only.
 *
 * It renders nothing when closed - the caller keeps the state - and it is
 * NOT the place for business rules: the children decide what may be done.
 */

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* Which way the panel slides: in from the right on a tablet or desktop, up
   from the bottom on a phone. Read from the viewport as an external store so
   the answer is right on the very first frame and follows a rotation. */
const SIDE_QUERY = "(min-width: 768px)";
const subscribeSide = (cb: () => void) => {
  const mq = window.matchMedia(SIDE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const readSide = () => window.matchMedia(SIDE_QUERY).matches;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SideDrawer({
  open, onClose, title, subtitle, children, footer, wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Commands that belong to the whole record, pinned to the bottom. */
  footer?: ReactNode;
  /** A wider panel for detail with two columns. */
  wide?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const fromSide = useSyncExternalStore(subscribeSide, readSide, () => true);
  const offscreen = fromSide ? { x: "100%", y: 0 } : { x: 0, y: "100%" };
  const panelRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  /* Focus in on open, back out on close; lock the page's scroll meanwhile. */
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("[data-drawer-close]") ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      const back = opener.current;
      if (back instanceof HTMLElement && document.contains(back)) back.focus();
    };
  }, [open]);

  /* Escape closes; Tab stays inside. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || !panelRef.current.contains(activeEl))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && activeEl === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="drawer"
          className="erp-drawer-backdrop"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button type="button" aria-label={L("Close", "Tutup")} tabIndex={-1} onClick={onClose}
            className="erp-drawer-scrim" />
          <motion.div
            ref={panelRef}
            role="dialog" aria-modal="true" aria-labelledby={titleId}
            initial={reduceMotion ? false : offscreen}
            animate={{ x: 0, y: 0 }}
            exit={reduceMotion ? undefined : offscreen}
            transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.8 }}
            className={`erp-drawer ${wide ? "erp-drawer-wide" : ""}`}
          >
            {/* v1.172.1 (Interface System V3): the panel, head, body and foot
                are named classes in styles/erp-v3.css. */}
            <div className="erp-drawer-head">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="erp-drawer-title">{title}</h2>
                {subtitle && <p className="erp-drawer-sub">{subtitle}</p>}
              </div>
              <button type="button" data-drawer-close onClick={onClose} aria-label={L("Close", "Tutup")}
                className="erp-icon-button text-muted-foreground -mr-2 shrink-0">
                <X aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="erp-drawer-body">{children}</div>
            {footer && <div className="erp-drawer-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

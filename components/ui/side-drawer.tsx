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

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { getLang } from "@/lib/i18n";
import { btnSm } from "@/lib/ui-styles";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { FormSteps } from "@/components/ui/form-steps";
import css from "./ui3.module.css";

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

/* v1.326.0 - THE FORM DRAWER (the CEO's "Improve Leave → Apply Leave", 16-11-2026:
   "reuse the improved drawer structure for other eligible system forms").
   A form inside the drawer puts its stepper and its buttons in the drawer's
   own rows - DrawerSteps under the title, DrawerFoot pinned at the bottom -
   so the steps and Cancel / Review never scroll away, without the form
   giving its state to the page. Both are portals into the drawer's slots:
   the form keeps its state, its checks and its handlers. Outside a drawer
   they draw in place. */
const DrawerSlots = createContext<{ foot: HTMLElement | null; steps: HTMLElement | null; close: () => void } | null>(null);

/** the drawer's own close (the X): a form's Cancel uses it, so half-typed work still asks before it is thrown away */
export function useDrawerClose(): (() => void) | null {
  return useContext(DrawerSlots)?.close ?? null;
}

/** the form's buttons, pinned to the drawer's foot (Cancel, Back, Review, Submit) */
export function DrawerFoot({ children, testid }: { children: ReactNode; testid?: string }) {
  const slots = useContext(DrawerSlots);
  const node = <div className="erp-drawer-actions" data-testid={testid}>{children}</div>;
  if (!slots) return node;
  return slots.foot ? createPortal(node, slots.foot) : null;
}

/** the form's stepper, in the drawer's step row under the title */
export function DrawerSteps({ steps, current, label, testid }: { steps: readonly string[]; current: number; label: string; testid?: string }) {
  const slots = useContext(DrawerSlots);
  const node = <FormSteps steps={steps} current={current} label={label} testid={testid} />;
  if (!slots) return node;
  return slots.steps ? createPortal(node, slots.steps) : null;
}

/** the two columns of a form drawer: the fields, and beside them what the form
    tells the person as they type (a balance, a route, the rules). Side by side
    when the DRAWER is wide enough (a container query, never the screen), one
    column otherwise - the aside under the fields. */
export function DrawerForm({ children, aside, testid }: { children: ReactNode; aside?: ReactNode; testid?: string }) {
  return (
    <div className="erp-drawer-layout" data-testid={testid}>
      <div className="erp-drawer-cols" data-aside={aside ? "" : undefined}>
        <div className="erp-drawer-main">{children}</div>
        {aside && <div className="erp-drawer-aside">{aside}</div>}
      </div>
    </div>
  );
}

/** one panel of a form drawer's aside: a title with its icon, one line under it, the content */
export function DrawerPanel({ icon, title, sub, children, testid, label }: { icon: AppIconName; title: ReactNode; sub?: ReactNode; children: ReactNode; testid?: string; label?: string }) {
  return (
    <section className="erp-drawer-panel" aria-label={label} data-testid={testid}>
      <div className="erp-drawer-panel-head">
        <span className="erp-drawer-panel-icon" aria-hidden><AppIcon name={icon} /></span>
        <span className="erp-drawer-panel-text"><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      </div>
      {children}
    </section>
  );
}

export function SideDrawer({
  open, onClose, title, subtitle, children, footer, wide = false, full = false, dirty: dirtyIn = false, icon, form = false,
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
  /** v1.212.0 - on a phone, the whole screen rather than a sheet (a record
      read on the move: the Ecommerce order). The desktop panel is unchanged. */
  full?: boolean;
  /** v1.276.0 (A2Z OS 3.0) - the form inside holds unsaved typing: closing
      (the X, Escape, the backdrop) first asks "Discard your changes?" in the
      drawer itself, so a slip of the hand never loses the work.
      v1.323.0 (the CEO's Global UI brief: "warn before discarding unsaved
      changes") - "auto": the drawer itself notices typing in its fields (not a
      search box, a checkbox or a radio) and asks before closing; a fresh open
      starts clean. A form that knows its own state passes a boolean
      (v1.325.0: either, from one expression - "auto" until it is saved). */
  dirty?: boolean | "auto";
  /** v1.326.0 - the record's icon, in a soft gold well beside the title (a form drawer) */
  icon?: AppIconName;
  /** v1.326.0 - a form with a side column (DrawerForm): the widest panel on a desktop, the whole screen on a phone */
  form?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const fromSide = useSyncExternalStore(subscribeSide, readSide, () => true);
  const offscreen = fromSide ? { x: "100%", y: 0 } : { x: 0, y: "100%" };
  const panelRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState(false);
  const [footEl, setFootEl] = useState<HTMLDivElement | null>(null);
  const [stepsEl, setStepsEl] = useState<HTMLDivElement | null>(null);
  const dirty = dirtyIn === "auto" ? typed : dirtyIn;
  /* a fresh open, or the form saved (no longer dirty), drops the question */
  const [seen, setSeen] = useState({ open, dirty });
  if (seen.open !== open || seen.dirty !== dirty) {
    setSeen({ open, dirty });
    if (!open || !dirty) setAsking(false);
    if (seen.open !== open) setTyped(false);
  }
  /* "auto": typing in a field of the form marks the drawer dirty */
  const noticeTyping = (e: { target: EventTarget }) => {
    if (dirtyIn !== "auto" || typed) return;
    const t = e.target as HTMLInputElement;
    if (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && !["search", "checkbox", "radio", "hidden", "button", "submit"].includes(t.type))) setTyped(true);
  };
  const requestClose = () => { if (dirty) setAsking(true); else onClose(); };

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
      if (e.key === "Escape") { e.preventDefault(); if (dirty) setAsking(true); else onClose(); return; }
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
  }, [open, onClose, dirty]);

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
          <button type="button" aria-label={L("Close", "Tutup")} tabIndex={-1} onClick={requestClose}
            className="erp-drawer-scrim" />
          <motion.div
            ref={panelRef}
            role="dialog" aria-modal="true" aria-labelledby={titleId}
            initial={reduceMotion ? false : offscreen}
            animate={{ x: 0, y: 0 }}
            exit={reduceMotion ? undefined : offscreen}
            transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.8 }}
            className={`erp-drawer ${wide ? "erp-drawer-wide" : ""} ${full || form ? "erp-drawer-full" : ""} ${form ? "erp-drawer-form" : ""}`}
            onInputCapture={noticeTyping}
          >
            {/* v1.172.1 (Interface System V3): the panel, head, body and foot
                are named classes in styles/erp-v3.css. v1.172.2: so are the
                heading cell and the close button - no utilities left here. */}
            <div className="erp-drawer-head">
              {icon && <span className="erp-drawer-icon" aria-hidden><AppIcon name={icon} /></span>}
              <div className="erp-grow">
                <h2 id={titleId} className="erp-drawer-title">{title}</h2>
                {subtitle && <p className="erp-drawer-sub">{subtitle}</p>}
              </div>
              <button type="button" data-drawer-close onClick={requestClose} aria-label={L("Close", "Tutup")}
                className="erp-icon-button erp-drawer-close">
                <X aria-hidden className="erp-icon" strokeWidth={1.75} />
              </button>
            </div>
            {/* v1.326.0 - the step row (DrawerSteps): empty, it takes no room */}
            <div className="erp-drawer-steps" ref={setStepsEl} />
            <DrawerSlots.Provider value={{ foot: footEl, steps: stepsEl, close: requestClose }}>
              <div className="erp-drawer-body">{children}</div>
            </DrawerSlots.Provider>
            {/* v1.326.0 - the form's own buttons (DrawerFoot), pinned; set aside while the discard question asks */}
            <div className="erp-drawer-foot erp-drawer-slot" ref={setFootEl} hidden={asking} />
            {asking ? (
              <div className="erp-drawer-foot">
                <div className={css.discard} role="alertdialog" aria-label={L("Discard your changes?", "Buang perubahan anda?")} data-testid="drawer-discard">
                  <span>{L("Discard your changes?", "Buang perubahan anda?")}</span>
                  <span className={css.discardActions}>
                    <button type="button" className={btnSm} autoFocus onClick={() => setAsking(false)}>{L("Keep editing", "Terus mengedit")}</button>
                    <button type="button" className="erp-button erp-button-danger erp-button-compact" onClick={() => { setAsking(false); onClose(); }}>{L("Discard", "Buang")}</button>
                  </span>
                </div>
              </div>
            ) : footer && <div className="erp-drawer-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

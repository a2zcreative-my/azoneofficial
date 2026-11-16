"use client";

/* v1.329.0 - ONE FEEDBACK MODAL (the CEO, 16-11-2026: "Perform everything" -
   F-1 ... F-5 of claude/FEEDBACK-MODAL-STAGE-0-AUDIT.md as recommended, and
   1.328.0's ruling that a result is a compact CENTRED modal, never a bottom
   sheet).

   Every "it worked / it did not" in the portal is this one card:

     FeedbackModal     the card: a status well, the title, one line, an
                       optional facts strip and chip, the actions and the X
     FeedbackProvider  mounted ONCE (the portal layout), so two results can
                       never stack; a newer result replaces an older one,
                       except that a routine success never replaces an error
     useFeedback()     show({ variant, title, description, facts, chip,
                       actions, acknowledge }), processing(title), close()

   THE RULES (F-2, F-4):
     - a routine save (success / info / warning without `acknowledge`) is
       PASSIVE: it closes itself after the time its words take to read and
       never blocks a click (the page under it stays live); its X closes it
     - an ERROR, and anything shown with `acknowledge` (a decision, money,
       the clock, a submission), waits for OK: a dialog, focus on OK, Escape
       and the X close it, focus goes back where it was
     - PROCESSING has no button and cannot be closed while the request is out
     - nothing here retries: an action offers "Try again" only where the
       caller passes one, and callers pass one only where a retry is already
       once-only safe
     - the words and the facts are the caller's, from the server's answer;
       this file decides nothing about what happened

   useSaveToast() (save-toast.tsx) is a door onto this provider, so the 70
   panels that call it take this card without being rewritten. */

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { getLang } from "@/lib/i18n";
import { modalCard, toastCard } from "@/lib/ui-styles"; // the house surfaces: a card that waits is a modal, a passive one a toast
import css from "./feedback-modal.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export type FeedbackVariant = "success" | "error" | "warning" | "info" | "processing";
export interface FeedbackFact { icon?: AppIconName; label: string; value: ReactNode }
export interface FeedbackAction { label: string; onClick?: () => void; primary?: boolean; testid?: string }
export interface FeedbackOptions {
  variant: FeedbackVariant;
  title: string;
  description?: string;
  /** up to three facts on the soft strip (a date, a time and duration, a reference) */
  facts?: FeedbackFact[];
  /** the outcome as its own chip (e.g. "Replacement leave · ½ day") */
  chip?: { label: string; tone?: "success" | "warning" | "danger" | "info" | "neutral" };
  /** OK is always offered on a card that waits; these come before it */
  actions?: FeedbackAction[];
  /** wait for OK even though it is not an error (decisions, money, the clock, submissions) */
  acknowledge?: boolean;
  /** how long a passive card stays (ms); defaults to the time its words take to read */
  holdMs?: number;
  testid?: string;
}

/** How long a passive card stays: "Saved" reads in a glance; a thirty-word notice needs longer (v1.181.4). */
export function feedbackHoldMs(title: string, sub = "", variant: FeedbackVariant = "success"): number {
  if (variant === "success") return 2600;
  return Math.min(9000, Math.max(2600, 1200 + (title.length + sub.length) * 45));
}

/** a card that waits for OK (an error, an acknowledged result, processing) */
export const waitsForOk = (o: FeedbackOptions) => o.variant === "error" || o.variant === "processing" || o.acknowledge === true;

const ICON: Record<FeedbackVariant, AppIconName> = { success: "success", error: "error", warning: "warning", info: "info", processing: "pending" };
const CHIP: Record<string, string> = { success: "erp-chip erp-chip-sm erp-chip-success", warning: "erp-chip erp-chip-sm erp-chip-warning", danger: "erp-chip erp-chip-sm erp-chip-danger", info: "erp-chip erp-chip-sm erp-chip-info", neutral: "erp-chip erp-chip-sm erp-chip-neutral" };

/* ------------------------------ the card ------------------------------ */

export function FeedbackModal({ options, onClose }: { options: FeedbackOptions; onClose: () => void }) {
  const o = options;
  const blocking = waitsForOk(o);
  const ok = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  useEffect(() => {
    if (!blocking) return;
    opener.current = document.activeElement;
    ok.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && o.variant !== "processing") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      const back = opener.current as HTMLElement | null;
      if (back && typeof back.focus === "function" && document.contains(back)) back.focus();
    };
  }, [blocking, o.variant, onClose]);

  const card = (
    <div className={`${blocking ? modalCard : toastCard} ${css.card}`} data-variant={o.variant} data-testid={o.testid ?? "feedback-modal"} data-waits={blocking ? "" : undefined}
      role={blocking ? (o.variant === "error" ? "alertdialog" : "dialog") : "status"} aria-modal={blocking ? true : undefined}
      aria-labelledby={titleId} aria-live={blocking ? undefined : "polite"} aria-busy={o.variant === "processing" ? true : undefined}
      onClick={(e) => e.stopPropagation()}>
      {o.variant !== "processing" && (
        <button type="button" className={css.close} onClick={onClose} aria-label={L("Close", "Tutup")} data-testid="feedback-close"><span aria-hidden>✕</span></button>
      )}
      <span className={css.well} aria-hidden>
        {o.variant === "processing" ? <span className={css.ring} /> : <AppIcon name={ICON[o.variant]} />}
      </span>
      <h2 id={titleId} className={css.title}>{o.title}</h2>
      {o.description && <p className={css.line}>{o.description}</p>}
      {o.chip && <span className={CHIP[o.chip.tone ?? "neutral"]} data-testid="feedback-chip">{o.chip.label}</span>}
      {o.facts && o.facts.length > 0 && (
        <dl className={css.facts} data-testid="feedback-facts">
          {o.facts.slice(0, 3).map((f, i) => (
            <div key={i}><dt>{f.icon && <AppIcon name={f.icon} />}{f.label}</dt><dd>{f.value}</dd></div>
          ))}
        </dl>
      )}
      {blocking && o.variant !== "processing" && (
        <div className={css.actions}>
          {(o.actions ?? []).map((a, i) => (
            <button key={i} type="button" className={`erp-button ${a.primary ? "erp-button-accent" : "erp-button-secondary"} ${css.action}`}
              onClick={() => { onClose(); a.onClick?.(); }} data-testid={a.testid}>{a.label}</button>
          ))}
          <button ref={ok} type="button" className={`erp-button erp-button-accent ${css.action}`} onClick={onClose} data-testid="feedback-ok">{L("OK", "OK")}</button>
        </div>
      )}
    </div>
  );
  return (
    <div className={css.layer} data-blocking={blocking ? "" : undefined} onClick={blocking && o.variant !== "processing" ? onClose : undefined}>
      {card}
    </div>
  );
}

/* ------------------------------ the service ------------------------------ */

export interface FeedbackApi {
  show: (o: FeedbackOptions) => void;
  processing: (title: string, description?: string) => void;
  close: () => void;
}
const FeedbackCtx = createContext<FeedbackApi | null>(null);

/** one result on the screen at a time; the state and its timer */
function useFeedbackState(): { api: FeedbackApi; node: ReactNode } {
  const [cur, setCur] = useState<(FeedbackOptions & { key: number }) | null>(null);
  const curRef = useRef<FeedbackOptions | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const close = useCallback(() => { window.clearTimeout(timer.current); curRef.current = null; setCur(null); }, []);
  const show = useCallback((o: FeedbackOptions) => {
    /* a routine success never takes an error's place before it was read */
    const now = curRef.current;
    if (now && now.variant === "error" && !waitsForOk(o)) return;
    window.clearTimeout(timer.current);
    curRef.current = o;
    seq.current += 1;
    setCur({ ...o, key: seq.current });
    if (!waitsForOk(o)) {
      const hold = o.holdMs ?? feedbackHoldMs(o.title, o.description ?? "", o.variant);
      timer.current = window.setTimeout(() => { if (curRef.current === o) close(); }, hold);
    }
  }, [close]);
  const processing = useCallback((title: string, description?: string) => show({ variant: "processing", title, description }), [show]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show, processing, close }), [show, processing, close]);
  const node = cur ? <FeedbackModal key={cur.key} options={cur} onClose={close} /> : null;
  return { api, node };
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { api, node } = useFeedbackState();
  return (
    <FeedbackCtx.Provider value={api}>
      {children}
      {node}
    </FeedbackCtx.Provider>
  );
}

/** The one feedback service. Under the provider (the portal) `node` is null -
    the provider draws the card; elsewhere (a page without it) the caller
    renders `node` itself, so the same call works everywhere. */
export function useFeedback(): FeedbackApi & { node: ReactNode } {
  const ctx = useContext(FeedbackCtx);
  const local = useFeedbackState();
  return ctx ? { ...ctx, node: null } : { ...local.api, node: local.node };
}

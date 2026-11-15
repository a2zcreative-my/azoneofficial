"use client";

/* v1.318.0 - ONE RESULT SHEET. The card that says "this is being recorded"
   and the sheet that says "this was recorded" (first used by On Shift's
   clock-in / clock-out confirmation, punch-receipt.tsx).

   A bottom sheet on a phone - full width, the home-indicator inset under its
   last control, scrolling inside itself at any height - and a centred card
   from 640px. Escape, the backdrop and the X close it; the page behind does
   not scroll under it. What goes inside is the caller's. It lives here, with
   the other dialogs, so no screen hand-makes a dialog of its own
   (tests/design-tokens.mjs). */

import { useEffect, type ReactNode } from "react";
import { getLang } from "@/lib/i18n";
import css from "./result-sheet.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** The waiting card: centred, announced politely, not a dialog (there is nothing to answer). */
export function WaitCard({ children, testid }: { children: ReactNode; testid?: string }) {
  return (
    <div className={css.layer} data-testid={testid}>
      <div className={css.waitCard} role="status" aria-live="polite">
        {children}
        <span className={css.ring} aria-hidden />
      </div>
    </div>
  );
}

export function ResultSheet({ titleId, head, onClose, children, testid, kind }: {
  /** the id of the heading inside `children` that names the sheet */
  titleId: string;
  /** what stands at the top left, beside the X (the company's logo) */
  head?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testid?: string;
  /** carried as data-kind, for the caller's own colouring and tests */
  kind?: string;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    /* the page behind does not scroll under the sheet */
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className={css.layer} data-testid={testid} data-kind={kind} onClick={onClose}>
      <div className={css.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className={css.top}>
          {head ?? <span />}
          <button type="button" className={css.close} onClick={onClose} aria-label={L("Close", "Tutup")}><span aria-hidden>✕</span></button>
        </div>
        {children}
      </div>
    </div>
  );
}

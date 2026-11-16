"use client";

/**
 * v1.4.87 — shared save-confirmation toast: one hook so every tab's Save can
 * confirm itself identically.
 *
 * v1.329.0 — A DOOR ONTO THE ONE FEEDBACK MODAL (F-1, the CEO 16-11-2026).
 * `useSaveToast()` keeps its name and its arguments, so the 70 panels that
 * call it take the new card (components/ui/feedback-modal.tsx) without being
 * rewritten; the words of every message are exactly what the caller passes.
 *
 *   show(title, sub)              success - passive, closes itself (F-2)
 *   show(title, sub, "notice")    warning - passive, stays for the time its
 *                                 words take to read (v1.181.4)
 *   show(title, sub, "error")     error   - WAITS FOR OK (F-2, F-P3): a
 *                                 refusal is never gone before it is read
 *
 * Under the portal's FeedbackProvider `node` is null (the provider draws the
 * card, one at a time); on a page without it (/admin, /account, /login) the
 * hook keeps its own card and `node` draws it, as before.
 */

import { useCallback } from "react";
import { feedbackHoldMs, useFeedback } from "@/components/ui/feedback-modal";

export type ToastVariant = "success" | "notice" | "error";

/** v1.181.4 - how long a toast stays: kept for callers that read it (the modal's own rule). */
export function toastHoldMs(title: string, sub = "", variant: ToastVariant = "success"): number {
  return feedbackHoldMs(title, sub, variant === "success" ? "success" : variant === "error" ? "error" : "warning");
}

export function useSaveToast() {
  const fb = useFeedback();
  const { show: fbShow } = fb;
  const show = useCallback((title: string, sub = "", variant: ToastVariant = "success") => {
    fbShow({ variant: variant === "success" ? "success" : variant === "error" ? "error" : "warning", title, description: sub || undefined, testid: "save-toast" });
  }, [fbShow]);
  return { show, node: fb.node };
}

"use client";

/**
 * v1.4.142 — branded confirmation dialog, same visual family as the
 * PunchToast/SaveToast cards (navy on card, gold-accented, rounded-2xl,
 * pop-in animation). Replaces the browser's native window.confirm(), which
 * the CEO rejected as off-brand.
 *
 * Usage (mirrors useSaveToast):
 *   const { confirm, node: confirmNode } = useConfirm();
 *   ...
 *   if (!(await confirm({ title, message, confirmLabel }))) return;
 *   ...
 *   return (<div>{confirmNode} ...</div>);
 */

import { useCallback, useRef, useState } from "react";

interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger paints the confirm button red (deletes); default navy */
  variant?: "default" | "danger";
}

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOpts): Promise<boolean> => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };

  const node = opts ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={() => close(false)}
    >
      <style>{`
        @keyframes confirm-pop { 0% { opacity: 0; transform: scale(.9) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
      <div
        className="bg-card border-border w-full max-w-md rounded-2xl border p-5 shadow-2xl md:p-6"
        style={{ animation: "confirm-pop .22s cubic-bezier(.2,.9,.3,1.1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="from-gold to-gold h-1 w-10 rounded-full bg-gradient-to-r" aria-hidden="true" />
        <p id="confirm-title" className="mt-3 text-base font-semibold">{opts.title}</p>
        {opts.message && (
          <p className="text-muted-foreground mt-1.5 text-sm whitespace-pre-line">{opts.message}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="border-border hover:bg-secondary inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium"
            onClick={() => close(false)}
          >
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            autoFocus
            className={`inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-white ${
              opts.variant === "danger" ? "bg-red-700 hover:bg-red-800" : "bg-primary hover:opacity-90"
            }`}
            onClick={() => close(true)}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, node };
}

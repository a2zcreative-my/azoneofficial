"use client";

/**
 * v1.4.248 — branded single-field prompt, the missing member of the
 * PunchToast / SaveToast / ConfirmDialog family. The v1.4.240 sweep replaced
 * every window.confirm() but left one window.prompt() standing — the payment
 * reference box on the Sales tab — which still raised the browser's own
 * "azoneofficial.com says" panel the CEO rejected.
 *
 * Usage (mirrors useConfirm):
 *   const { prompt, node: promptNode } = usePrompt();
 *   const ref = await prompt({ title: "…", label: "…" });   // null = cancelled
 *   return (<div>{promptNode} …</div>);
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface PromptOpts {
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** false (the default) lets the user submit an empty value */
  required?: boolean;
}

export function usePrompt() {
  const [opts, setOpts] = useState<PromptOpts | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const prompt = useCallback((o: PromptOpts): Promise<string | null> => {
    setValue(o.initial ?? "");
    setOpts(o);
    return new Promise<string | null>((resolve) => { resolver.current = resolve; });
  }, []);

  useEffect(() => { if (opts) input.current?.focus(); }, [opts]);

  const close = (v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  const submit = () => {
    if (opts?.required && !value.trim()) return;
    close(value.trim());
  };

  const node = opts ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      role="dialog" aria-modal="true" aria-labelledby="prompt-title" onClick={() => close(null)}>
      <style>{`
        @keyframes prompt-pop { 0% { opacity: 0; transform: scale(.9) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
      <div className="bg-card border-border w-full max-w-md rounded-2xl border p-5 shadow-2xl md:p-6"
        style={{ animation: "prompt-pop .22s cubic-bezier(.2,.9,.3,1.1) both" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="from-gold to-gold h-1 w-10 rounded-full bg-gradient-to-r" aria-hidden="true" />
        <p id="prompt-title" className="mt-3 text-base font-semibold">{opts.title}</p>
        {opts.message && <p className="text-muted-foreground mt-1.5 text-sm whitespace-pre-line">{opts.message}</p>}
        <label className="mt-4 block">
          {opts.label && <span className="text-muted-foreground mb-1 block text-xs">{opts.label}</span>}
          <input ref={input} className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
            placeholder={opts.placeholder} value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submit(); }
              if (e.key === "Escape") close(null);
            }} />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="border-border hover:bg-secondary inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium"
            onClick={() => close(null)}>{opts.cancelLabel ?? "Cancel"}</button>
          <button type="button"
            className="bg-primary inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            disabled={!!opts.required && !value.trim()} onClick={submit}>
            {opts.confirmLabel ?? "Save"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { prompt, node };
}

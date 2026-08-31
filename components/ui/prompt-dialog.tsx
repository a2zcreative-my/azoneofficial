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
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

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
  /* v1.4.250 (CEO: "a calendar for me to pick which date they make the
     payment for accurate tracking"): an optional second field, a real date
     input so the phone raises its own picker. */
  date?: { label: string; initial?: string; max?: string; required?: boolean };
  /* v1.77.0 — a dialog that asks ONLY for a date. Offboarding needs the last
     day and nothing else, and an empty text box above it would be a field
     nobody can fill in correctly. Defaults to true, so every existing caller
     is untouched. */
  text?: boolean;
  /** danger paints the confirm button red, as in useConfirm. */
  variant?: "default" | "danger";
}

export interface PromptResult { value: string; date: string }

export function usePrompt() {
  const [opts, setOpts] = useState<PromptOpts | null>(null);
  const [value, setValue] = useState("");
  const [date, setDate] = useState("");
  const resolver = useRef<((v: PromptResult | null) => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const prompt = useCallback((o: PromptOpts): Promise<PromptResult | null> => {
    setValue(o.initial ?? "");
    setDate(o.date?.initial ?? "");
    setOpts(o);
    return new Promise<PromptResult | null>((resolve) => { resolver.current = resolve; });
  }, []);

  useEffect(() => { if (opts) input.current?.focus(); }, [opts]);

  const close = (v: PromptResult | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  /* v1.77.0 — whichever fields are actually on screen have to be filled.
     A date-only dialog whose OK button ignores an empty date would submit
     "no date", and the server would fall back to today, which is the exact
     bug this option exists to fix. */
  const incomplete =
    (opts?.text !== false && !!opts?.required && !value.trim()) ||
    (!!opts?.date?.required && !date);

  const submit = () => {
    if (incomplete) return;
    close({ value: opts?.text === false ? "" : value.trim(), date });
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
        {opts.text !== false && (
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
        )}
        {opts.date && (
          <label className={opts.text === false ? "mt-4 block" : "mt-3 block"}>
            <span className="text-muted-foreground mb-1 block text-xs">{opts.date.label}</span>
            <input type="date" autoFocus={opts.text === false}
              className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
              value={date} max={opts.date.max}
              onChange={(e) => setDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submit(); }
                if (e.key === "Escape") close(null);
              }} />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="border-border hover:bg-secondary inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium"
            onClick={() => close(null)}>{opts.cancelLabel ?? L("Cancel", "Batal")}</button>
          <button type="button"
            className={`inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-40 ${
              opts.variant === "danger" ? "bg-red-700 hover:bg-red-800" : "bg-primary hover:opacity-90"
            }`}
            disabled={incomplete} onClick={submit}>
            {opts.confirmLabel ?? L("Save", "Simpan")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { prompt, node };
}

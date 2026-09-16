"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { btnHdr } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

/** A focused record view: desktop side sheet, full-screen phone, native focus trap. */
export function RecordDetail({ title, children, onClose }: {
  title: string; children: ReactNode; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const label = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const marker = crypto.randomUUID();
    // Delay the history entry until after React's development effect replay.
    let pushed = false;
    const entry = window.setTimeout(() => {
      window.history.pushState({ ...window.history.state, recordDetail: marker }, "");
      pushed = true;
    }, 0);
    const back = () => { if (window.history.state?.recordDetail !== marker) close.current(); };
    window.addEventListener("popstate", back);
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => {
      window.removeEventListener("popstate", back);
      window.clearTimeout(entry);
      node.close();
      document.body.style.overflow = overflow;
      if (pushed && window.history.state?.recordDetail === marker) window.history.back();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby={label}
      className="bg-card text-foreground fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 p-0 backdrop:bg-black/30 md:ml-auto md:w-[420px] md:border-l md:border-border"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="flex h-full flex-col">
        <header className="border-border flex shrink-0 items-start gap-3 border-b p-4" style={{ paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))" }}>
          <button type="button" className={btnHdr} onClick={onClose} aria-label={getLang() === "ms" ? "Kembali ke senarai" : "Back to list"}>
            <ArrowLeft aria-hidden className="h-4 w-4" />
          </button>
          <h2 id={label} className="min-w-0 py-2 text-base font-semibold break-words">{title}</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}>{children}</div>
      </div>
    </dialog>
  );
}

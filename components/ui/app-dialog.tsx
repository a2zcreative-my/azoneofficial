"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft } from "lucide-react";
import { getLang } from "@/lib/i18n";

let activeDispose: (() => void) | undefined;

/** A top-layer viewer retains the current page, its drafts and scroll position. */
export function openAppDialog(title: string, content: ReactNode): void {
  activeDispose?.();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const dispose = () => {
    root.unmount();
    host.remove();
    if (activeDispose === dispose) activeDispose = undefined;
  };
  activeDispose = dispose;
  root.render(
    <AppDialog title={title} onDispose={dispose}>
      {content}
    </AppDialog>
  );
}

function AppDialog({
  title,
  children,
  onDispose,
}: {
  title: string;
  children: ReactNode;
  onDispose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef<() => void>(() => {});
  useEffect(() => {
    const dialog = ref.current!;
    const focused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const marker = history.state?.a2zPreview ?? crypto.randomUUID();
    if (!history.state?.a2zPreview)
      history.pushState({ ...history.state, a2zPreview: marker }, "");
    document.body.style.overflow = "hidden";
    dialog.showModal();
    let closing = false;
    close.current = () => {
      if (closing) return;
      closing = true;
      if (history.state?.a2zPreview === marker) history.back();
      else onDispose();
    };
    const pop = () => onDispose();
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, [onDispose]);
  const back = getLang() === "ms" ? "Kembali" : "Back";
  return (
    <dialog
      ref={ref}
      aria-labelledby="app-viewer-title"
      className="app-viewer"
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
    >
      <header className="app-viewer-header">
        <button
          type="button"
          onClick={() => close.current()}
          className="app-viewer-back"
          title={back}
        >
          <ArrowLeft aria-hidden size={20} />
          {back}
        </button>
        <h2
          id="app-viewer-title"
          className="min-w-0 text-sm font-semibold break-words"
        >
          {title}
        </h2>
      </header>
      <div className="app-viewer-content">{children}</div>
    </dialog>
  );
}

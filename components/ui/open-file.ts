"use client";

import type { MouseEvent } from "react";
import { openDocumentPreview } from "@/components/ui/document-preview";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/**
 * v1.391.0 - open a file the portal holds (a screenshot, a task or project file, a leave
 * attachment, a receipt) INSIDE the page, in the shared viewer: Back returns to the record
 * exactly as it was. A picture or a PDF is shown; any other file offers Download. Never a
 * new tab - the owner: "review in the same tab and return after review".
 */
export function openFile(url: string, name?: string | null): void {
  const title = name || L("Attachment", "Lampiran");
  openDocumentPreview(title, async (signal) => {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store", signal });
    if (!res.ok)
      throw new Error(
        res.status === 401
          ? L("Your session expired. Sign in again.", "Sesi anda tamat. Log masuk semula.")
          : L("The file could not be loaded. Try again.", "Fail tidak dapat dimuatkan. Cuba lagi.")
      );
    const blob = await res.blob();
    const ext = blob.type.includes("pdf") ? "pdf" : blob.type.split("/")[1]?.split(";")[0] || "bin";
    return { blob, filename: name || `attachment.${ext}` };
  });
}

/**
 * The click handler for a link to a file: a plain click opens the viewer; a modified click
 * (Ctrl, Cmd, Shift, middle button) keeps the browser's own behaviour, so the href stays.
 */
export function viewFile(url: string, name?: string | null) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openFile(url, name);
  };
}

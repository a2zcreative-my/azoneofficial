"use client";

/**
 * v1.4.244 — the page a CUSTOMER opens (CEO: "if I click on PDF button I want
 * the format can be deliver to my customer using mobile instead of I need to
 * download using web view").
 *
 * The portal mints a share link; the customer taps it in WhatsApp and lands
 * here. No sign-in, no download, no app — the document renders on their phone
 * exactly as it prints, with one button to save it as a PDF if they want the
 * file. The long random token in ?t= is the only credential, and clearing it
 * in the portal kills the link.
 *
 * The token is read from window.location rather than useSearchParams so the
 * page stays a plain static export (no CSR bailout, no Suspense wrapper).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { buildDocHtml, type DocFull } from "@/lib/doc-template";

// A4 at 96dpi — the width the template is designed against.
const PAGE_W = 794;
const PAGE_H = 1123;

export default function PublicDocPage() {
  const [html, setHtml] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "gone">("loading");
  const [label, setLabel] = useState("Document");
  const [scale, setScale] = useState(1);
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("t") ?? "";
    if (!/^[a-f0-9]{32}$/.test(token)) { setState("gone"); return; }
    (async () => {
      try {
        const res = await fetch(`/api/v1/public/doc/${token}`);
        if (!res.ok) { setState("gone"); return; }
        const { doc } = (await res.json()) as { doc: DocFull };
        setHtml(buildDocHtml(doc, false)); // never auto-print at the customer
        setLabel(`${{ QT: "Quotation", INV: "Invoice", DO: "Delivery Order" }[doc.doc_type] ?? "Document"} ${doc.doc_number}`);
        document.title = `${doc.doc_number} — AZ ONE OFFICIAL`;
        setState("ready");
      } catch { setState("gone"); }
    })();
  }, []);

  // Fit the A4 page to the phone's width instead of making them pinch-zoom.
  useEffect(() => {
    const fit = () => {
      const w = box.current?.clientWidth ?? PAGE_W;
      setScale(Math.min(1, w / PAGE_W));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [state]);

  const savePdf = useCallback(() => {
    // The iframe prints itself, so the browser's own "Save as PDF" produces
    // the real A4 document rather than a screenshot of this page.
    frame.current?.contentWindow?.focus();
    frame.current?.contentWindow?.print();
  }, []);

  const share = useCallback(async () => {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title: label, url }); return; } catch { /* dismissed */ }
    }
    try { await navigator.clipboard.writeText(url); alert("Link copied"); } catch { /* no clipboard */ }
  }, [label]);

  return (
    <main className="min-h-screen bg-[#f4f6fb] pb-10">
      <header className="sticky top-0 z-10 border-b border-[#e8ebf1] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[850px] flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-[#1a2946]">AZ ONE OFFICIAL</p>
            <p className="truncate text-xs text-[#8a93a6]">{label}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={savePdf} disabled={state !== "ready"}
              className="inline-flex h-9 items-center rounded-lg bg-[#1a2946] px-4 text-sm font-medium text-white disabled:opacity-40">
              Save as PDF
            </button>
            <button type="button" onClick={share} disabled={state !== "ready"}
              className="inline-flex h-9 items-center rounded-lg border border-[#1a2946] px-4 text-sm font-medium text-[#1a2946] disabled:opacity-40">
              Share
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[850px] px-3 pt-4">
        {state === "loading" && <p className="py-16 text-center text-sm text-[#8a93a6]">Loading the document…</p>}
        {state === "gone" && (
          <div className="rounded-2xl border border-[#e8ebf1] bg-white p-8 text-center">
            <p className="text-base font-semibold text-[#1a2946]">This link is no longer valid</p>
            <p className="mt-2 text-sm text-[#5b6472]">
              Please ask AZ ONE OFFICIAL for a new one — WhatsApp{" "}
              <a className="underline" href="https://wa.me/60123834821">+60 12-383 4821</a>.
            </p>
          </div>
        )}
        {state === "ready" && (
          <div ref={box} className="overflow-hidden" style={{ height: PAGE_H * scale }}>
            <iframe
              ref={frame}
              title={label}
              srcDoc={html}
              sandbox="allow-same-origin allow-modals"
              className="rounded-xl bg-white shadow-sm"
              style={{
                width: PAGE_W, height: PAGE_H, border: 0,
                transformOrigin: "top left", transform: `scale(${scale})`,
              }}
            />
          </div>
        )}
        {state === "ready" && (
          <p className="mt-4 text-center text-xs text-[#8a93a6]">
            Tap <strong>Save as PDF</strong> and choose “Save to Files” (iPhone) or “Save as PDF” (Android) to keep a copy.
          </p>
        )}
      </div>
    </main>
  );
}

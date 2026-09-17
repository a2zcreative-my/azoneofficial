"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  RefreshCw,
  Share2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { openAppDialog } from "@/components/ui/app-dialog";
import { getLang } from "@/lib/i18n";
import { btnClass, btnGhost } from "@/lib/ui-styles";
import { Skel, SkelRows } from "@/components/ui/skeleton";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
export type PreviewDocument = { html?: string; blob?: Blob; filename?: string };
type Source = string | ((signal: AbortSignal) => Promise<PreviewDocument>);

export function openDocumentPreview(title: string, source: Source): void {
  openAppDialog(title, <DocumentPreview source={source} />);
}

export function openPrintPreview(html: string): void {
  const doc = new DOMParser().parseFromString(html, "text/html");
  openDocumentPreview(doc.title || L("Document", "Dokumen"), html);
}

export function openAttachment(
  url: string,
  title = L("Attachment", "Lampiran")
): void {
  openDocumentPreview(title, async (signal) => {
    const res = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (!res.ok)
      throw new Error(
        res.status === 401
          ? L(
              "Your session expired. Sign in again.",
              "Sesi anda tamat. Log masuk semula."
            )
          : L(
              "The attachment could not be loaded. Try again.",
              "Lampiran tidak dapat dimuatkan. Cuba lagi."
            )
      );
    const blob = await res.blob();
    if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)(;|$)/i.test(blob.type))
      throw new Error(
        L("This file cannot be previewed.", "Fail ini tidak boleh dipratonton.")
      );
    const extension = blob.type.includes("pdf")
      ? "pdf"
      : blob.type.split("/")[1]?.split(";")[0] || "jpg";
    return { blob, filename: `attachment.${extension}` };
  });
}

function prepareHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Templates are trusted, but their old auto-print handlers must not run in a preview.
  doc.querySelectorAll("script,base").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes])
      if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
  });
  return "<!doctype html>" + doc.documentElement.outerHTML;
}

function DocumentPreview({ source }: { source: Source }) {
  const [data, setData] = useState<PreviewDocument>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState("");
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setData(undefined);
    setReady(false);
    void (async () => {
      try {
        const result =
          typeof source === "string"
            ? { html: source }
            : await source(controller.signal);
        if (!controller.signal.aborted)
          setData({
            ...result,
            html: result.html ? prepareHtml(result.html) : undefined,
          });
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : L("Could not open document.", "Tidak dapat membuka dokumen.")
          );
      }
    })();
    return () => controller.abort();
  }, [source, attempt]);
  useEffect(() => {
    if (!data?.blob) return;
    const objectUrl = URL.createObjectURL(data.blob);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl("");
    };
  }, [data]);
  const share = async () => {
    if (!data?.blob) return;
    const file = new File([data.blob], data.filename || "document.pdf", {
      type: data.blob.type,
    });
    try {
      if (!navigator.canShare?.({ files: [file] })) return;
      await navigator.share({ files: [file] });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(
          L(
            "Sharing failed. You can download the file instead.",
            "Perkongsian gagal. Anda boleh memuat turun fail."
          )
        );
    }
  };
  return (
    <>
      <div className="app-viewer-tools">
        {data?.html && (
          <button
            type="button"
            className={btnGhost}
            disabled={!ready}
            onClick={() => {
              try {
                frame.current?.contentWindow?.focus();
                frame.current?.contentWindow?.print();
              } catch {
                setError(
                  L(
                    "Printing is unavailable in this browser.",
                    "Cetakan tidak tersedia dalam pelayar ini."
                  )
                );
              }
            }}
          >
            <Printer size={18} aria-hidden />
            {L("Print", "Cetak")}
          </button>
        )}
        {url && (
          <a
            className={btnGhost}
            href={url}
            download={data?.filename || "document.pdf"}
          >
            <Download size={18} aria-hidden />
            {L("Download", "Muat turun")}
          </a>
        )}
        {data?.blob &&
          typeof navigator.share === "function" &&
          navigator.canShare?.({
            files: [
              new File([data.blob], data.filename || "document.pdf", {
                type: data.blob.type,
              }),
            ],
          }) && (
            <button
              type="button"
              className={btnGhost}
              onClick={() => void share()}
            >
              <Share2 size={18} aria-hidden />
              {L("Share", "Kongsi")}
            </button>
          )}
      </div>
      {error && (
        <div role="alert" className="p-4 text-sm">
          <p>{error}</p>
          <button
            type="button"
            className={`${btnClass} mt-3`}
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RefreshCw size={16} aria-hidden />
            {L("Try again", "Cuba lagi")}
          </button>
        </div>
      )}
      {!data && !error && (
        <div
          aria-busy="true"
          aria-label={L("Document", "Dokumen")}
          className="mx-auto max-w-3xl space-y-6 p-6"
        >
          <Skel className="h-8 w-1/2" />
          <SkelRows rows={8} />
        </div>
      )}
      {data?.html ? (
        <HtmlPaper
          html={data.html}
          frame={frame}
          onReady={() => setReady(true)}
        />
      ) : data?.blob?.type.startsWith("image/") && url ? (
        <img
          className="mx-auto block h-auto max-w-full"
          src={url}
          alt={L("Attachment", "Lampiran")}
          onError={() =>
            setError(
              L(
                "The image could not be displayed.",
                "Imej tidak dapat dipaparkan."
              )
            )
          }
        />
      ) : data?.blob?.type.includes("pdf") ? (
        <PdfPaper blob={data.blob} />
      ) : null}
    </>
  );
}

function HtmlPaper({
  html,
  frame,
  onReady,
}: {
  html: string;
  frame: React.RefObject<HTMLIFrameElement | null>;
  onReady: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(794);
  const [height, setHeight] = useState(1123);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      setWidth(box.current?.clientWidth || 794)
    );
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  const scale = zoom ? 1 : Math.min(1, width / 794);
  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (doc)
      setHeight(
        Math.max(1123, doc.body.scrollHeight, doc.documentElement.scrollHeight)
      );
  };
  return (
    <div ref={box} className="min-w-0">
      <div className="px-3 pb-2">
        <button
          type="button"
          className={btnGhost}
          aria-pressed={zoom}
          title={
            zoom
              ? L("Fit to screen", "Muat pada skrin")
              : L("Actual size", "Saiz sebenar")
          }
          aria-label={
            zoom
              ? L("Fit to screen", "Muat pada skrin")
              : L("Actual size", "Saiz sebenar")
          }
          onClick={() => setZoom(!zoom)}
        >
          {zoom ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
        </button>
      </div>
      <div className="overflow-auto">
        <div
          style={{
            width: zoom ? 794 : "100%",
            height: height * scale,
            position: "relative",
          }}
        >
          <iframe
            ref={frame}
            title={L("Document preview", "Pratonton dokumen")}
            srcDoc={html}
            sandbox="allow-same-origin allow-modals"
            style={{
              width: 794,
              height,
              border: 0,
              background: "white",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
            onLoad={() => {
              measure();
              const images = [
                ...(frame.current?.contentDocument?.images || []),
              ];
              void Promise.all(
                images.map((img) => img.decode().catch(() => {}))
              ).then(() => {
                measure();
                onReady();
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function PdfPaper({ blob }: { blob: Blob }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let task: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
        const bytes = await blob.arrayBuffer();
        if (cancelled) return;
        task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
        const pdf = await task.promise;
        if (cancelled) return;
        setPages(pdf.numPages);
        const sheet = await pdf.getPage(page);
        if (cancelled || !canvas.current) return;
        const viewport = sheet.getViewport({ scale: 1.5 });
        const el = canvas.current;
        el.width = viewport.width;
        el.height = viewport.height;
        const context = el.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        await sheet.render({ canvasContext: context, viewport }).promise;
      } catch {
        if (!cancelled)
          setError(
            L(
              "Preview unavailable. Download the PDF to open it.",
              "Pratonton tidak tersedia. Muat turun PDF untuk membukanya."
            )
          );
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [blob, page]);
  return (
    <div>
      {!pages && !error && (
        <div aria-busy="true" className="p-6">
          <SkelRows rows={8} />
        </div>
      )}
      {error && (
        <p role="alert" className="p-4 text-sm">
          {error}
        </p>
      )}
      {pages > 1 && (
        <div className="app-viewer-tools">
          <button
            type="button"
            className={btnGhost}
            disabled={page === 1}
            title={L("Previous page", "Halaman sebelumnya")}
            aria-label={L("Previous page", "Halaman sebelumnya")}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm">
            {page} / {pages}
          </span>
          <button
            type="button"
            className={btnGhost}
            disabled={page === pages}
            title={L("Next page", "Halaman seterusnya")}
            aria-label={L("Next page", "Halaman seterusnya")}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
      <canvas
        ref={canvas}
        className="mx-auto block h-auto max-w-full"
        aria-label={L("PDF preview", "Pratonton PDF")}
      />
    </div>
  );
}

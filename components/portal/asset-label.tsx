"use client";
/* 19-11-2026 - THE ASSET'S QR LABEL (the CEO: "I want to have a QR code for the asset which is
   easier for me to print and paste it to the physical. this QR must visible on the card details
   instead of outside"). It lives INSIDE the asset drawer: the code, the tag under it and one
   Print label button. The code holds only a link to the asset in the portal
   (/portal?tab=Assets&asset=<id>) - no price, no holder, no serial - so a phone camera opens
   this asset's drawer after the usual sign-in, and every rule on who may see it stays the
   server's. The QR is drawn here (lib/qr.ts); printing writes a small label page into a
   hidden frame and prints it, so nothing leaves the browser. */
import { useMemo } from "react";
import { qrMatrix, qrPath } from "@/lib/qr";
import { btnSm } from "@/lib/ui-styles";
import { AppIcon } from "@/components/ui/app-icon";
import { getLang } from "@/lib/i18n";
import av from "./assets-page.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The address the code holds: this asset in the portal of the site it was printed from. */
export function assetLink(id: number, origin = typeof window === "undefined" ? "https://a2zcreative.my" : window.location.origin): string {
  return `${origin}/portal?tab=Assets&asset=${id}`;
}

function QrSvg({ text, label }: { text: string; label: string }) {
  const { size, d } = useMemo(() => { const m = qrMatrix(text); return { size: m.length + 8, d: qrPath(m) }; }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges" className={av.qrSvg} data-testid="asset-qr">
      <rect width={size} height={size} fill="white" />
      <path d={d} fill="black" />
    </svg>
  );
}

/** One label, printed on its own: the code, the tag, the name and the company. */
function printLabel(a: { id: number; asset_tag: string; name: string }, company: string | null) {
  const m = qrMatrix(assetLink(a.id));
  const size = m.length + 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${qrPath(m)}" fill="black"/></svg>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.asset_tag)}</title><style>
@page { size: auto; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Poppins, Arial, sans-serif; color: black; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.label { display: flex; align-items: center; gap: 3mm; width: 70mm; height: 35mm; padding: 2.5mm; border: 0.3mm dashed gray; }
.qr { width: 30mm; height: 30mm; flex: none; }
.qr svg { width: 100%; height: 100%; display: block; }
.text { min-width: 0; display: flex; flex-direction: column; gap: 1mm; }
.co { font-size: 6.5pt; font-weight: 700; letter-spacing: 0.02em; }
.tag { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11pt; font-weight: 700; }
.name { font-size: 8pt; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.hint { font-size: 5.5pt; color: dimgray; }
</style></head><body><div class="label"><div class="qr">${svg}</div><div class="text">${company ? `<div class="co">${esc(company)}</div>` : ""}<div class="tag">${esc(a.asset_tag)}</div><div class="name">${esc(a.name)}</div><div class="hint">${esc(L("Company asset - scan to open in A2Z OS", "Aset syarikat - imbas untuk buka di A2Z OS"))}</div></div></div></body></html>`;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) { done(); return; }
    w.addEventListener("afterprint", done);
    w.focus();
    w.print();
    setTimeout(done, 60_000);
  };
  frame.srcdoc = html;
}

export function AssetLabel({ asset, company }: { asset: { id: number; asset_tag: string; name: string }; company: string | null }) {
  return (
    <section className={`${av.detailSec} ${av.qrCard}`} aria-label={L("QR label", "Label QR")} data-testid="asset-label">
      <QrSvg text={assetLink(asset.id)} label={L(`QR code for ${asset.asset_tag}`, `Kod QR untuk ${asset.asset_tag}`)} />
      <div className={av.qrText}>
        <p className={av.title}>{L("QR label", "Label QR")}</p>
        <p className={av.qrTag}>{asset.asset_tag}</p>
        <p className={av.sub}>{L("Print it and stick it on the item. A phone camera opens this asset in A2Z OS after sign-in; the code holds only the link, never the price or the holder.",
          "Cetak dan tampal pada barang. Kamera telefon membuka aset ini di A2Z OS selepas log masuk; kod hanya mengandungi pautan, bukan harga atau pemegang.")}</p>
        <button type="button" className={btnSm} onClick={() => printLabel(asset, company)} data-testid="asset-label-print">
          <AppIcon name="print" />{L("Print label", "Cetak label")}
        </button>
      </div>
    </section>
  );
}

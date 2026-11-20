"use client";
/* eslint-disable @next/next/no-img-element -- the QR is an inline data image, not a page asset */

/* 20-11-2026 - SHARE PORTFOLIO (the CEO: "A2Z Creative - Add Portfolio Sharing to Existing Web &
   PWA"). One component for every published staff portfolio - it takes the page's own published
   portfolio and shares ONLY its published address (p.url, from the API), never the browser's.
     - wide screens (768px up): a "Share Portfolio" button beside "Work with me" opens a small
       popover anchored to it (drawn on the body and fixed to the viewport, because the hero clips and stacks what is inside it);
       a click outside or Escape closes it and focus returns to the button
     - phones and the installed PWA: a Share button in the dock opens a native bottom sheet
       (<dialog>: focus, Escape and the backdrop come with it), inside the safe areas
   The six ways:
     1. Share via Device   navigator.share() called straight from the tap, so the system sheet
                           opens (AirDrop on Apple, Quick Share on Android, where the device has
                           them - nothing here pretends to talk to either). A cancel is silent;
                           with no share sheet, the other ways are offered instead.
     2. Copy Portfolio Link  the published address
     3. Show QR Code       the SAME QR the studio prints (lib/portfolio-render qrSvg / qrPng over
                           lib/qr.ts) for the SAME published address - no second destination
     4. Share via WhatsApp  wa.me with the name, position and the address
     5. Download Digital Card (PDF)  the approved card, drawn by the studio's own pdfOf from the
                           published copy (cardDataOfPublic) - the card itself is not changed
     6. Save Contact (vCard)  vcardOf: name, position, A2Z Creative Marketing, the approved
                           business email and phone (else A2Z's), the address - no HR data
   The card code loads only when a download is asked for. Styles: staff.module.css (this page's
   own module), on the site's tokens. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Contact, Copy, Download, Link2, MessageCircle, QrCode, Share2, Upload, X } from "lucide-react";
import type { PublicPortfolioCard } from "@/lib/portfolio-render";
import css from "./staff.module.css";

type L = (en: string, ms: string) => string;
type View = "menu" | "qr";
/** what the page already shows as the contact (the approved one, else A2Z's) */
export interface ShareContact { email: string; phone: string }

const canNativeShare = () => typeof navigator !== "undefined" && typeof (navigator as Navigator & { share?: unknown }).share === "function";
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
const fileBase = (slug: string) => `A2Z-portfolio-${slug}`;

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* older Safari / no permission: the textarea way */ }
  try {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok;
  } catch { return false; }
}

/** the list of ways, the QR view and the status line - the same body in the popover and the sheet */
function ShareBody({ p, name, contact, L, view, setView, onDone, idp }: {
  p: PublicPortfolioCard; name: string; contact: ShareContact; L: L; view: View; setView: (v: View) => void; onDone: () => void; idp: string;
}) {
  const [status, setStatus] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<"pdf" | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const native = canNativeShare();
  const title = `${name}${p.position ? ` - ${p.position}` : ""} | A2Z Creative Marketing`;

  /* the QR is drawn from the published address only when it is asked for */
  useEffect(() => {
    if (view !== "qr" || qr) return;
    void import("@/lib/portfolio-render").then(({ qrSvg }) => setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(p.url))}`));
  }, [view, qr, p.url]);

  /* 1 - the device's own share sheet: called straight from the tap (no await before it) */
  const shareDevice = () => {
    if (!native) { setStatus({ tone: "info", text: L("This browser has no share sheet - copy the link, use WhatsApp or show the QR code below.", "Pelayar ini tiada lembaran kongsi - salin pautan, guna WhatsApp atau tunjuk kod QR di bawah.") }); return; }
    navigator.share({ title, text: L(`${name}'s portfolio at A2Z Creative Marketing`, `Portfolio ${name} di A2Z Creative Marketing`), url: p.url })
      .then(() => { setStatus({ tone: "ok", text: L("Shared.", "Dikongsi.") }); })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === "AbortError") return; // the person closed the sheet: nothing to say
        setStatus({ tone: "err", text: L("The share sheet could not open - copy the link instead.", "Lembaran kongsi tidak dapat dibuka - salin pautan sahaja.") });
      });
  };
  const copy = async () => {
    const ok = await copyText(p.url);
    setStatus(ok ? { tone: "ok", text: L("Link copied.", "Pautan disalin.") } : { tone: "err", text: L(`Could not copy - the link is ${p.url}`, `Tidak dapat salin - pautannya ${p.url}`) });
  };
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(L(`${title}\n${p.url}`, `${title}\n${p.url}`))}`;
  const pdf = async () => {
    if (busy) return;
    setBusy("pdf"); setStatus({ tone: "info", text: L("Preparing the card...", "Menyediakan kad...") });
    try {
      const r = await import("@/lib/portfolio-render");
      if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
      const [logo, portrait] = await Promise.all([
        r.loadLogo(),
        p.has_photo ? r.fetchBlob(`/api/v1/public/portfolio/${p.slug}/portrait`).then((b) => (b ? r.decodePortrait(b).catch(() => null) : null)) : Promise.resolve(null),
      ]);
      const blob = r.pdfOf("story", r.cardDataOfPublic(p), { logo, portrait, crop: p.photo_crop ?? { zoom: 1, x: 0, y: 0 } });
      download(blob, `${fileBase(p.slug)}.pdf`);
      setStatus({ tone: "ok", text: L("Digital card downloaded.", "Kad digital dimuat turun.") });
    } catch {
      setStatus({ tone: "err", text: L("The card could not be made on this device - try again, or copy the link.", "Kad tidak dapat dibuat pada peranti ini - cuba lagi, atau salin pautan.") });
    } finally { setBusy(null); }
  };
  const vcard = async () => {
    const { vcardOf } = await import("@/lib/portfolio-render");
    download(new Blob([vcardOf({ name, position: p.position, url: p.url, email: contact.email, phone: contact.phone })], { type: "text/vcard;charset=utf-8" }), `${fileBase(p.slug)}.vcf`);
    setStatus({ tone: "ok", text: L("Contact saved - open the file to add it.", "Kenalan disimpan - buka fail untuk menambahnya.") });
  };
  const qrPng = async () => {
    const { qrPng: png } = await import("@/lib/portfolio-render");
    download(await png(p.url), `${fileBase(p.slug)}-qr.png`);
    setStatus({ tone: "ok", text: L("QR code downloaded.", "Kod QR dimuat turun.") });
  };

  if (view === "qr") {
    return (
      <div className={css.shareQr} data-testid="share-qr">
        <button type="button" className={css.shareBack} onClick={() => setView("menu")}><ChevronRight aria-hidden className={css.flipX} />{L("All sharing options", "Semua pilihan kongsi")}</button>
        {qr ? <img src={qr} alt={L(`QR code for ${name}'s portfolio`, `Kod QR untuk portfolio ${name}`)} width={220} height={220} data-testid="share-qr-img" /> : <span className={css.shareQrWait} aria-hidden />}
        <p className={css.shareUrl}>{p.url.replace(/^https?:\/\//, "")}</p>
        <p className={css.shareHint}>{L("Scan with a phone camera to open this portfolio.", "Imbas dengan kamera telefon untuk membuka portfolio ini.")}</p>
        <button type="button" className={css.shareItem} onClick={() => void qrPng()}><Download aria-hidden /><span>{L("Download QR code (PNG)", "Muat turun kod QR (PNG)")}</span></button>
        {status && <p className={status.tone === "err" ? css.shareErr : css.shareOk} role="status">{status.tone === "ok" && <Check aria-hidden />}{status.text}</p>}
      </div>
    );
  }
  return (
    <>
      <ul className={css.shareList} aria-labelledby={`${idp}-share-title`}>
        <li><button type="button" className={`${css.shareItem} ${css.shareItemMain}`} onClick={shareDevice} data-testid="share-device">
          <Upload aria-hidden /><span><strong>{L("Share via Device", "Kongsi melalui Peranti")}</strong><small>{L("AirDrop (iOS) or Quick Share (Android), where available", "AirDrop (iOS) atau Quick Share (Android), jika ada")}</small></span><ChevronRight aria-hidden className={css.shareChev} />
        </button></li>
        <li><button type="button" className={css.shareItem} onClick={() => void copy()} data-testid="share-copy"><Link2 aria-hidden /><span>{L("Copy Portfolio Link", "Salin Pautan Portfolio")}</span><Copy aria-hidden className={css.shareChev} /></button></li>
        <li><button type="button" className={css.shareItem} onClick={() => { setStatus(null); setView("qr"); }} data-testid="share-qr-open"><QrCode aria-hidden /><span>{L("Show QR Code", "Tunjuk Kod QR")}</span><ChevronRight aria-hidden className={css.shareChev} /></button></li>
        <li><a className={css.shareItem} href={whatsapp} target="_blank" rel="noopener" onClick={() => onDone()} data-testid="share-whatsapp"><MessageCircle aria-hidden className={css.shareWa} /><span>{L("Share via WhatsApp", "Kongsi melalui WhatsApp")}</span><ChevronRight aria-hidden className={css.shareChev} /></a></li>
        <li><button type="button" className={css.shareItem} onClick={() => void pdf()} disabled={busy === "pdf"} aria-busy={busy === "pdf"} data-testid="share-pdf"><Download aria-hidden /><span>{busy === "pdf" ? L("Preparing the card...", "Menyediakan kad...") : L("Download Digital Card (PDF)", "Muat Turun Kad Digital (PDF)")}</span><ChevronRight aria-hidden className={css.shareChev} /></button></li>
        <li><button type="button" className={css.shareItem} onClick={() => void vcard()} data-testid="share-vcard"><Contact aria-hidden /><span>{L("Save Contact (vCard)", "Simpan Kenalan (vCard)")}</span><ChevronRight aria-hidden className={css.shareChev} /></button></li>
      </ul>
      <p className={status ? (status.tone === "err" ? css.shareErr : css.shareOk) : css.srLabel} role="status" aria-live="polite" data-testid="share-status">{status?.tone === "ok" && <Check aria-hidden />}{status?.text ?? ""}</p>
    </>
  );
}

function ShareHead({ name, L, onClose, idp }: { name: string; L: L; onClose: () => void; idp: string }) {
  return (
    <div className={css.shareHead}>
      <span className={css.shareIcon} aria-hidden><Share2 /></span>
      <div>
        <h2 id={`${idp}-share-title`}>{L("Share Portfolio", "Kongsi Portfolio")}</h2>
        <p>{L(`Share ${name}'s professional portfolio with clients and collaborators.`, `Kongsi portfolio profesional ${name} dengan pelanggan dan rakan kerjasama.`)}</p>
      </div>
      <button type="button" className={css.shareClose} onClick={onClose} aria-label={L("Close", "Tutup")}><X aria-hidden /></button>
    </div>
  );
}

/** "Share Portfolio": the hero button (popover) on a wide screen, the dock button (bottom sheet) on a phone */
export function SharePortfolio({ p, name, contact, L, place }: { p: PublicPortfolioCard; name: string; contact: ShareContact; L: L; place: "hero" | "dock" }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [pos, setPos] = useState<{ top: number; left: number; side: "right" | "below" } | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const pop = useRef<HTMLDialogElement | null>(null);
  const sheet = useRef<HTMLDialogElement | null>(null);
  const idp = place;

  const close = useCallback(() => {
    setOpen(false); setView("menu"); setPos(null);
    if (sheet.current?.open) sheet.current.close();
    btn.current?.focus();
  }, []);
  const toggle = () => {
    if (open) { close(); return; }
    setView("menu");
    if (place === "dock" || isPhone()) { setOpen(true); sheet.current?.showModal(); return; }
    setOpen(true);
  };

  /* the popover sits beside the button when there is room, else under it - always inside the viewport */
  useLayoutEffect(() => {
    if (!open || place !== "hero") return;
    const place1 = () => {
      const b = btn.current?.getBoundingClientRect(); const el = pop.current;
      if (!b || !el) return;
      const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, gap = 12, edge = 12;
      const bar = (document.querySelector("header") as HTMLElement | null)?.getBoundingClientRect().bottom ?? 0;
      if (b.right + gap + w <= vw - edge) {
        const top = Math.min(Math.max(b.top + b.height / 2 - h / 2, bar + edge), vh - h - edge);
        setPos({ top, left: b.right + gap, side: "right" });
      } else {
        setPos({ top: Math.min(b.bottom + gap, vh - h - edge), left: Math.min(Math.max(b.left, edge), vw - w - edge), side: "below" });
      }
    };
    place1();
    window.addEventListener("resize", place1); window.addEventListener("scroll", place1, true);
    return () => { window.removeEventListener("resize", place1); window.removeEventListener("scroll", place1, true); };
  }, [open, place, view]);

  /* outside click and Escape close the popover; focus goes into it on open */
  const placed = pos !== null;
  useEffect(() => {
    if (!open || place !== "hero" || !placed) return; // it is invisible until placed, and cannot take focus
    pop.current?.querySelector<HTMLElement>("ul button, ul a")?.focus(); // the first way to share, not the close button
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open, place, close, placed]);

  const body = <ShareBody p={p} name={name} contact={contact} L={L} view={view} setView={setView} onDone={close} idp={idp} />;

  return (
    <>
      {place === "hero"
        ? <button ref={btn} type="button" className={css.ctaGhost} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${idp}-share`} onClick={toggle} data-testid="portfolio-share"><Share2 aria-hidden />{L("Share Portfolio", "Kongsi Portfolio")}</button>
        : <button ref={btn} type="button" className={css.dockShare} aria-haspopup="dialog" aria-expanded={open} aria-label={L("Share Portfolio", "Kongsi Portfolio")} onClick={toggle} data-testid="portfolio-dock-share"><Share2 aria-hidden /></button>}

      {/* drawn on the body: the hero's own stacking (and its overflow) would hide it under the expertise strip */}
      {place === "hero" && open && createPortal(
        /* a native, non-modal <dialog open>: the browser gives it the dialog role (no hand-made role) */
        <dialog open ref={pop} id={`${idp}-share`} aria-labelledby={`${idp}-share-title`}
          className={`${css.sharePop} ${pos?.side === "below" ? css.sharePopBelow : css.sharePopRight}`}
          style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }} data-testid="share-popover">
          <ShareHead name={name} L={L} onClose={close} idp={idp} />
          {body}
        </dialog>,
        document.body,
      )}
      {place === "dock" && (
        <dialog ref={sheet} id={`${idp}-share`} className={css.sheet} aria-labelledby={`${idp}-share-title`} data-testid="share-sheet"
          onClose={() => { setOpen(false); setView("menu"); }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          {open && (
            <div className={css.sheetBody}>
              <span className={css.grab} aria-hidden />
              <ShareHead name={name} L={L} onClose={close} idp={idp} />
              {body}
            </div>
          )}
        </dialog>
      )}
    </>
  );
}

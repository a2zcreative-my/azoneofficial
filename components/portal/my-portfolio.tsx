"use client";

/* v1.389.0 - Profile -> My portfolio card (the CEO, 19-11-2026: "Staff can download and share their
   portfolio card with clients"). Read-only: the card exactly as it was approved, with Download,
   Copy link and Share. Nothing is drawn until there is a portfolio, and the downloads open only
   once it is published (the QR on the back needs a page behind it). */

import { useEffect, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/ui/app-icon";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { makeApi } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { cardDataOf, decodePortrait, fetchBlob, fileBase, loadLogo, mediaUrl, paint, pdfOf, pngOf, saveBlob, shareCard, type LoadedPortrait, type PortfolioDetail } from "@/lib/portfolio-render";
import { btnSm, card } from "@/lib/ui-styles";
import css from "./portfolio-studio.module.css";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export function MyPortfolioCard() {
  const { show, node } = useSaveToast();
  const [d, setD] = useState<PortfolioDetail | null | undefined>(undefined);
  const [portrait, setPortrait] = useState<LoadedPortrait | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    void api<PortfolioDetail | { portfolio: null }>("/portfolios/mine").then((r) => setD(r.ok && r.data && r.data.portfolio ? (r.data as PortfolioDetail) : null));
    void loadLogo().then(setLogo);
  }, []);
  const key = d ? (d.portfolio.portrait_key && !d.portfolio.portrait_stale ? d.portfolio.portrait_key : d.staff.photo_key) : null;
  useEffect(() => {
    if (!key) { setPortrait(null); return; }
    void fetchBlob(mediaUrl(key)).then((b) => (b ? decodePortrait(b).then(setPortrait).catch(() => null) : null));
  }, [key]);
  const data = useMemo(() => (d ? cardDataOf(d) : null), [d]);
  const assets = useMemo(() => ({ logo, portrait, crop: d?.portfolio.photo_crop ?? { zoom: 1, x: 0, y: 0 } }), [logo, portrait, d]);
  useEffect(() => { if (ref.current && data) paint(ref.current, "front", "story", data, assets); }, [data, assets]);

  if (d === undefined) return <section className={card} aria-busy="true"><SkelRows rows={3} /></section>;
  if (!d) return null; // no portfolio for this person (not loading)
  const published = d.portfolio.state === "published";
  return (
    <section className={card} aria-label={L("My portfolio card", "Kad portfolio saya")} data-testid="my-portfolio">
      {node}
      <p className="erp-heading"><AppIcon name="identification" /> {L("My portfolio card", "Kad portfolio saya")}</p>
      <p className="erp-meta">{published ? L("Approved and public. Download it or share it with a client.", "Diluluskan dan awam. Muat turun atau kongsi dengan pelanggan.") : L("Being prepared - it can be shared once it is published.", "Sedang disediakan - boleh dikongsi selepas diterbitkan.")}</p>
      <div className={css.canvasWrap} style={{ maxWidth: "12rem", aspectRatio: "1080 / 1920" }}>
        <canvas ref={ref} className={css.canvas} width={1080} height={1920} aria-label={L("My portfolio card", "Kad portfolio saya")} />
      </div>
      {published && data && (
        <div className={css.actions}>
          <button type="button" className={btnSm} onClick={async () => saveBlob(await pngOf("front", "story", data, assets), `${fileBase(d)}-front.png`)}><AppIcon name="download" />{L("Front", "Depan")}</button>
          <button type="button" className={btnSm} onClick={async () => saveBlob(await pngOf("back", "story", data, assets), `${fileBase(d)}-back.png`)}><AppIcon name="download" />{L("Back", "Belakang")}</button>
          <button type="button" className={btnSm} onClick={() => saveBlob(pdfOf("story", data, assets), `${fileBase(d)}.pdf`)}><AppIcon name="document" />PDF</button>
          <button type="button" className={btnSm} onClick={async () => { try { await navigator.clipboard.writeText(d.portfolio.public_url!); show(L("Link copied", "Pautan disalin"), d.portfolio.public_url!); } catch { show(d.portfolio.public_url!, "", "notice"); } }}><AppIcon name="link" />{L("Copy link", "Salin pautan")}</button>
          <button type="button" className={btnSm} onClick={async () => { const b = await pngOf("front", "story", data, assets); if (!(await shareCard(b, `${fileBase(d)}-front.png`, d.portfolio.public_url, d.staff.name))) saveBlob(b, `${fileBase(d)}-front.png`); }}><AppIcon name="send" />{L("Share", "Kongsi")}</button>
        </div>
      )}
    </section>
  );
}

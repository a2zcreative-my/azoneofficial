"use client";

/* v1.389.0 - Profile -> My portfolio card (the CEO, 19-11-2026: "Staff can download and share their
   portfolio card with clients"). Read-only: the card exactly as it was approved, with Download,
   Copy link and Share. Nothing is drawn until there is a portfolio, and the downloads open only
   once it is published (the QR on the back needs a page behind it).
   v1.390.0 (the CEO, 19-11-2026: "Portfolios should be able to visible by the staff for them to
   generate and download it by themselves"): every person on staff sees this card. With no portfolio
   it offers "Create my portfolio"; with one, "Edit my portfolio" opens the SAME editor the Staff ->
   Portfolios view uses, for their own portfolio only, ending in "Send for approval". The approver
   still publishes - the downloads open then, as before. */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/ui/app-icon";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { makeApi } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { cardDataOf, reviewWords, decodePortrait, fetchBlob, fileBase, loadLogo, mediaUrl, paint, pdfOf, pngOf, saveBlob, shareCard, type LoadedPortrait, type PortfolioDetail } from "@/lib/portfolio-render";
import { btnSm, btnSmPrimary, card } from "@/lib/ui-styles";
import css from "./portfolio-studio.module.css";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
/* the one portfolio editor, loaded only when it is opened */
const fetchMine = () => api<PortfolioDetail | { portfolio: null }>("/portfolios/mine").then((r) => (r.ok && r.data && r.data.portfolio ? (r.data as PortfolioDetail) : null));
const PortfolioEditor = lazy(() => import("@/components/portal/portfolio-studio").then((m) => ({ default: m.PortfolioEditor })));

export function MyPortfolioCard() {
  const { show, node } = useSaveToast();
  const [d, setD] = useState<PortfolioDetail | null | undefined>(undefined);
  const [portrait, setPortrait] = useState<LoadedPortrait | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLCanvasElement | null>(null);

  const load = useCallback(async () => setD(await fetchMine()), []);
  useEffect(() => {
    void fetchMine().then(setD);
    void loadLogo().then(setLogo);
  }, []);
  const create = async () => {
    setCreating(true);
    const r = await api<{ id: number }>("/portfolios/mine", { method: "POST", body: "{}" });
    setCreating(false);
    if (r.ok && r.data?.id) { await load(); setOpenId(r.data.id); }
    else show(L("Could not create your portfolio", "Portfolio anda tidak dapat dicipta"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? "", "error");
  };
  const key = d ? (d.portfolio.portrait_key && !d.portfolio.portrait_stale ? d.portfolio.portrait_key : d.staff.photo_key) : null;
  useEffect(() => {
    if (!key) { setPortrait(null); return; }
    void fetchBlob(mediaUrl(key)).then((b) => (b ? decodePortrait(b).then(setPortrait).catch(() => null) : null));
  }, [key]);
  const data = useMemo(() => (d ? cardDataOf(d) : null), [d]);
  const assets = useMemo(() => ({ logo, portrait, crop: d?.portfolio.photo_crop ?? { zoom: 1, x: 0, y: 0 } }), [logo, portrait, d]);
  useEffect(() => { if (ref.current && data) paint(ref.current, "front", "story", data, assets); }, [data, assets]);

  if (d === undefined) return <section className={card} aria-busy="true"><SkelRows rows={3} /></section>;
  if (!d) return (
    <section className={card} aria-label={L("My portfolio card", "Kad portfolio saya")} data-testid="my-portfolio">
      {node}
      <p className="erp-heading"><AppIcon name="identification" /> {L("My portfolio card", "Kad portfolio saya")}</p>
      <p className="erp-meta">{L("Make your own portfolio card and public page: your photo, specialties and work. Once it is approved you can download it and share it with clients.", "Buat kad portfolio dan halaman awam anda sendiri: foto, kepakaran dan kerja anda. Selepas diluluskan anda boleh memuat turun dan berkongsi dengan pelanggan.")}</p>
      <div className={css.actions}>
        <button type="button" className={btnSmPrimary} disabled={creating} onClick={() => void create()} data-testid="my-portfolio-create"><AppIcon name="add" />{creating ? L("Creating...", "Mencipta...") : L("Create my portfolio", "Cipta portfolio saya")}</button>
      </div>
    </section>
  );
  const published = d.portfolio.state === "published";
  const pendingChanges = published && Boolean(d.portfolio.unpublished_changes);
  return (
    <section className={card} aria-label={L("My portfolio card", "Kad portfolio saya")} data-testid="my-portfolio">
      {node}
      <p className="erp-heading"><AppIcon name="identification" /> {L("My portfolio card", "Kad portfolio saya")}</p>
      <p className="erp-meta">{published
        ? (pendingChanges ? L("Approved and public. Your latest changes wait for approval - the download below is the approved card.", "Diluluskan dan awam. Perubahan terkini menunggu kelulusan - muat turun di bawah ialah kad yang diluluskan.") : L("Approved and public. Download it or share it with a client.", "Diluluskan dan awam. Muat turun atau kongsi dengan pelanggan."))
        : d.portfolio.state === "unpublished" ? L("Taken off the public page by the approver. Edit it and send it for approval again.", "Ditarik balik daripada halaman awam. Sunting dan hantar semula untuk kelulusan.")
        : L("Draft - edit it, then send it for approval. Downloads open once it is published.", "Draf - sunting, kemudian hantar untuk kelulusan. Muat turun dibuka selepas diterbitkan.")}</p>
      <div className={css.canvasWrap} style={{ maxWidth: "12rem", aspectRatio: "1080 / 1920" }}>
        <canvas ref={ref} className={css.canvas} width={1080} height={1920} aria-label={L("My portfolio card", "Kad portfolio saya")} />
      </div>
      {d.review && <p className="erp-meta" data-testid="my-portfolio-review"><strong>{L("Review:", "Semakan:")}</strong> {reviewWords(d.review, getLang() === "ms")}</p>}
      <div className={css.actions}>
        {d.can.edit && <button type="button" className={published ? btnSm : btnSmPrimary} onClick={() => setOpenId(d.portfolio.id)} data-testid="my-portfolio-edit"><AppIcon name="edit" />{L("Edit my portfolio", "Sunting portfolio saya")}</button>}
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
      {openId && (
        <Suspense fallback={null}>
          <PortfolioEditor id={openId} onClose={() => { setOpenId(null); void load(); }} notify={show} />
        </Suspense>
      )}
    </section>
  );
}

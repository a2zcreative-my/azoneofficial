"use client";

/* v1.394.0 - DIGITAL CARDS, Stage 5 (the CEO 21-11-2026): Editable Content and the preview.

   - CardPageView: one page drawn by lib/card-render.ts (pageBoxes + boxStyle + frameStyle) - the
     SAME boxes renderPageHTML writes for AZ ONE, so the preview is the customer's card. Overlays
     (the safe area, field outlines) are drawn on top and are never part of the card.
   - ZonesStep: step 4 of the template editor. The designer adds fields (text, several lines, date,
     photo), drags and resizes them on the artwork - always inside the safe area (clampZone) - and
     sets the font, size, colour, alignment, length and sample. A page's fields are saved with
     PUT /staff/card-templates/:id/zones and checked by the server with lib/card-templates.ts.
   - CardPreview: every page in a phone frame or on a desktop stage, with the safe area, the field
     outlines, the longest allowed text, and the card's language - for everyone who opens Digital
     Cards, read-only.

   The card fonts are self-hosted (public/card-fonts, SIL OFL) and loaded once by CardPageView. */

import { useEffect, useRef, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { PillSwitch } from "@/components/ui/panel";
import { DrawerFoot, DrawerForm, DrawerPanel, SideDrawer } from "@/components/ui/side-drawer";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { api, type ApiResult } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { btnClass, btnGhost, btnSm, chipSmNeutral, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { ALIGNS, CARD_FONTS, FONT_KEYS, boxStyle, frameStyle, pageBoxes, weightFor, type CardFont, type CardZone, type ZoneAlign, type ZoneKind } from "@/lib/card-render";
import { ZONE_LIMITS, clampZone, newZone } from "@/lib/card-templates";
import type { CardFormat } from "@/lib/card-rules";
import css from "./card-zones.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
interface ZPage { id: number; position: number; title: string; title_ms: string | null; has_file: boolean; sha256: string | null; required: boolean }
interface ZEditor { format: CardFormat | null; pages: ZPage[]; zones: CardZone[]; zones_missing: string[]; missing: string[] }
interface ZTemplate { id: number; version: number; name: string; language: "en" | "ms" | "both" }
type Detail = { template: ZTemplate; editor: ZEditor; error?: { code?: string; message?: string } };
const ptitle = (p: { title: string; title_ms: string | null }) => (getLang() === "ms" && p.title_ms ? p.title_ms : p.title);
export const pageArt = (templateId: number, p: { id: number; sha256: string | null }) =>
  `/api/v1/staff/card-templates/${templateId}/pages/${p.id}/image?v=${(p.sha256 ?? "").slice(0, 16)}`;
const KIND_LABEL: Record<ZoneKind, () => string> = { text: () => L("Text", "Teks"), multiline: () => L("Several lines", "Beberapa baris"), date: () => L("Date", "Tarikh"), image: () => L("Photo", "Foto") };

/** one page of a card: the artwork and its fields, drawn by lib/card-render.ts */
export function CardPageView({ art, format, zones, lang, longest, safe, outlines, selected, onPointer }: {
  art: string | null; format: CardFormat; zones: CardZone[]; lang?: "en" | "ms"; longest?: boolean; safe?: boolean; outlines?: boolean;
  selected?: string | null; onPointer?: (e: React.PointerEvent, key: string, mode: "move" | "resize") => void;
}) {
  const page = { width: format.width_px, height: format.height_px };
  const boxes = pageBoxes(page, zones, {}, { mode: "preview", lang, longest });
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  return (
    <div className={css.frame} style={frameStyle(page)} data-testid="dc-card-page">
      {/* eslint-disable-next-line @next/next/no-css-tags -- the card fonts load only where a card is drawn; React hoists and dedupes it (precedence) */}
      <link rel="stylesheet" href="/card-fonts/card-fonts.css" precedence="default" />
      {/* eslint-disable-next-line @next/next/no-img-element -- a private, staff-only file; the static export has no image optimiser */}
      {art ? <img src={art} alt="" className={css.art} draggable={false} /> : <span className={css.noArt}>{L("No artwork yet", "Belum ada seni")}</span>}
      {boxes.map((b) => (
        <div key={b.key} style={boxStyle(b) as React.CSSProperties} className={b.placeholder ? css.photo : undefined} data-testid={`dc-zone-${b.key}`}>
          {b.placeholder ? b.label : b.text}
        </div>
      ))}
      {safe && <div className={css.safe} aria-hidden style={{ left: pct(format.margin_left, format.width_px), top: pct(format.margin_top, format.height_px), right: pct(format.margin_right, format.width_px), bottom: pct(format.margin_bottom, format.height_px) }} />}
      {(outlines || onPointer) && boxes.map((b, i) => (
        <div key={`o-${b.key}`} className={`${css.outline} ${selected === b.key ? css.outlineOn : ""} ${onPointer ? css.movable : ""}`}
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
          onPointerDown={onPointer ? (e) => onPointer(e, b.key, "move") : undefined} aria-hidden={!onPointer}>
          <span className={css.tag}>{zones[i]?.label}</span>
          {onPointer && selected === b.key && <span className={css.handle} onPointerDown={(e) => { e.stopPropagation(); onPointer(e, b.key, "resize"); }} />}
        </div>
      ))}
    </div>
  );
}

/** one page's fields, saved (a pressed button, never on mount) */
const saveZones = (templateId: number, version: number, pageId: number, zones: CardZone[]) =>
  api<Detail>(`/staff/card-templates/${templateId}/zones`, { method: "PUT", body: JSON.stringify({ version, page_id: pageId, zones }) });

/** step 4 of the editor: the fields on each page */
export function ZonesStep({ t, e, take, onBack, onDone, onPreview }: {
  t: ZTemplate; e: ZEditor; take: (r: ApiResult<Detail>) => boolean; onBack: () => void; onDone: () => void; onPreview: () => void;
}) {
  const f = e.format!;
  const [pageId, setPageId] = useState(e.pages[0]?.id ?? 0);
  const saved = e.zones.filter((z) => z.page_id === pageId);
  const [draft, setDraft] = useState<CardZone[]>(saved);
  const [sel, setSel] = useState<string | null>(saved[0]?.key ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, node: confirmNode } = useConfirm();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; mode: "move" | "resize"; sx: number; sy: number; z: CardZone; scale: number } | null>(null);
  const page = e.pages.find((p) => p.id === pageId) ?? e.pages[0];
  const z = draft.find((x) => x.key === sel) ?? null;
  const usedKeys = [...e.zones.filter((x) => x.page_id !== pageId).map((x) => x.key), ...draft.map((x) => x.key)];

  const save = async (): Promise<boolean> => {
    setBusy(true); setError(null);
    const r = await saveZones(t.id, t.version, pageId, draft);
    setBusy(false);
    if (r.ok) { take(r); return true; }
    setError(r.data?.error?.message ?? L("Not saved - try again.", "Tidak disimpan - cuba lagi."));
    if (r.status === 409) take(r);
    return false;
  };
  const goPage = async (id: number) => {
    if (id === pageId) return;
    if (dirty && !(await save())) return;
    const next = e.zones.filter((x) => x.page_id === id);
    setPageId(id); setDraft(next); setSel(next[0]?.key ?? null);
  };
  /* after a save the server's copy is the draft */
  useEffect(() => { setDraft(e.zones.filter((x) => x.page_id === pageId)); }, [e.zones, pageId]);

  const patch = (p: Partial<CardZone>) => setDraft((d) => d.map((x) => (x.key === sel ? { ...x, ...p } : x)));
  const add = (kind: ZoneKind) => { const n = newZone(kind, pageId, f, usedKeys); setDraft((d) => [...d, n]); setSel(n.key); };
  const remove = async () => {
    if (!z || !(await confirm({ title: L(`Remove ${z.label}?`, `Buang ${z.label}?`), message: L("The customer will not fill this in. Save the page to keep the change.", "Pelanggan tidak akan mengisi ini. Simpan halaman untuk mengekalkan perubahan."), confirmLabel: L("Remove", "Buang"), variant: "danger" }))) return;
    setDraft((d) => d.filter((x) => x.key !== z.key)); setSel(null);
  };
  const onPointer = (ev: React.PointerEvent, key: string, mode: "move" | "resize") => {
    const rect = frameRef.current?.getBoundingClientRect();
    const cur = draft.find((x) => x.key === key);
    if (!rect || !cur) return;
    setSel(key);
    drag.current = { key, mode, sx: ev.clientX, sy: ev.clientY, z: cur, scale: f.width_px / rect.width };
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  };
  useEffect(() => {
    const move = (ev: PointerEvent) => {
      const d = drag.current; if (!d) return;
      const dx = (ev.clientX - d.sx) * d.scale, dy = (ev.clientY - d.sy) * d.scale;
      const box = d.mode === "move" ? { x: d.z.x + dx, y: d.z.y + dy, w: d.z.w, h: d.z.h } : { x: d.z.x, y: d.z.y, w: d.z.w + dx, h: d.z.h + dy };
      const c = clampZone(box, f);
      setDraft((all) => all.map((x) => (x.key === d.key ? { ...x, ...c } : x)));
    };
    const up = () => { drag.current = null; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [f]);
  const num = (k: "x" | "y" | "w" | "h", v: string) => z && patch(clampZone({ ...z, [k]: Number(v) }, f));
  const lang: "en" | "ms" = t.language === "ms" ? "ms" : "en";

  return (
    <DrawerForm testid="dc-zones" aside={
      <>
        <DrawerPanel icon="edit" title={z ? z.label : L("Fields", "Medan")} sub={z ? `${KIND_LABEL[z.kind]()} · ${z.key}` : L("Select a field on the page, or add one", "Pilih medan pada halaman, atau tambah satu")} testid="dc-zone-form">
          {z ? (
            <div className={css.form}>
              <label className="erp-field"><span className="erp-label" data-required="">{L("Label (what the customer sees)", "Label (yang pelanggan lihat)")}</span>
                <input className={inputClassSm} value={z.label} maxLength={ZONE_LIMITS.label} onChange={(ev) => patch({ label: ev.target.value })} data-testid="dc-z-label" /></label>
              <label className="erp-field"><span className="erp-label">{L("Label in BM", "Label dalam BM")}</span>
                <input className={inputClassSm} value={z.label_ms ?? ""} maxLength={ZONE_LIMITS.label} onChange={(ev) => patch({ label_ms: ev.target.value || null })} /></label>
              {z.kind !== "image" && (
                <>
                  <div className={css.two}>
                    <label className="erp-field"><span className="erp-label">{L("Font", "Fon")}</span>
                      <select className={selectClassSm} value={z.font} onChange={(ev) => { const font = ev.target.value as CardFont; patch({ font, weight: weightFor(font, z.weight) }); }} data-testid="dc-z-font">
                        {FONT_KEYS.map((k) => <option key={k} value={k}>{CARD_FONTS[k].label}</option>)}
                      </select></label>
                    <label className="erp-field"><span className="erp-label">{L("Weight", "Ketebalan")}</span>
                      <select className={selectClassSm} value={z.weight} onChange={(ev) => patch({ weight: Number(ev.target.value) })}>
                        {CARD_FONTS[z.font].weights.map((w) => <option key={w} value={w}>{w >= 600 ? L("Bold", "Tebal") : L("Regular", "Biasa")} ({w})</option>)}
                      </select></label>
                  </div>
                  <div className={css.three}>
                    <label className="erp-field"><span className="erp-label">{L("Size (px)", "Saiz (px)")}</span>
                      <input type="number" className={inputClassSm} min={ZONE_LIMITS.size[0]} max={ZONE_LIMITS.size[1]} value={z.size} onChange={(ev) => patch({ size: Number(ev.target.value) })} data-testid="dc-z-size" /></label>
                    <label className="erp-field"><span className="erp-label">{L("Colour", "Warna")}</span>
                      <input type="color" className={css.colour} value={z.colour} onChange={(ev) => patch({ colour: ev.target.value })} data-testid="dc-z-colour" /></label>
                    <label className="erp-field"><span className="erp-label">{L("Align", "Jajaran")}</span>
                      <select className={selectClassSm} value={z.align} onChange={(ev) => patch({ align: ev.target.value as ZoneAlign })}>
                        {ALIGNS.map((a) => <option key={a} value={a}>{{ left: L("Left", "Kiri"), center: L("Centre", "Tengah"), right: L("Right", "Kanan") }[a]}</option>)}
                      </select></label>
                  </div>
                  <label className="erp-field"><span className="erp-label" data-required="">{L("Sample (shown until the customer types)", "Contoh (dipapar sehingga pelanggan menaip)")}</span>
                    {z.kind === "multiline" ? <textarea className="erp-input erp-textarea" rows={3} value={z.sample} maxLength={z.max_chars} onChange={(ev) => patch({ sample: ev.target.value })} data-testid="dc-z-sample" />
                      : <input className={inputClassSm} value={z.sample} maxLength={z.max_chars} onChange={(ev) => patch({ sample: ev.target.value })} data-testid="dc-z-sample" />}</label>
                  {t.language !== "en" && <label className="erp-field"><span className="erp-label">{L("Sample in BM", "Contoh dalam BM")}</span>
                    <input className={inputClassSm} value={z.sample_ms ?? ""} maxLength={z.max_chars} onChange={(ev) => patch({ sample_ms: ev.target.value || null })} /></label>}
                  <label className="erp-field"><span className="erp-label">{L("Most characters the customer may type", "Aksara terbanyak yang pelanggan boleh taip")}</span>
                    <input type="number" className={inputClassSm} min={ZONE_LIMITS.chars[0]} max={ZONE_LIMITS.chars[1]} value={z.max_chars} onChange={(ev) => patch({ max_chars: Number(ev.target.value) })} data-testid="dc-z-max" /></label>
                </>
              )}
              <div className={css.four}>
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <label key={k} className="erp-field"><span className="erp-label">{{ x: "X", y: "Y", w: L("Width", "Lebar"), h: L("Height", "Tinggi") }[k]}</span>
                    <input type="number" className={inputClassSm} value={z[k]} onChange={(ev) => num(k, ev.target.value)} /></label>
                ))}
              </div>
              <label className="erp-flex"><input type="checkbox" className="erp-check" checked={z.required} onChange={(ev) => patch({ required: ev.target.checked })} /> {L("The customer must fill this in", "Pelanggan mesti mengisi ini")}</label>
              <button type="button" className={btnGhost} onClick={() => void remove()} data-testid="dc-z-remove">{L("Remove field", "Buang medan")}</button>
            </div>
          ) : <p className="erp-help">{L("Names, dates, the venue and photos are fields - never part of the artwork - so every customer gets their own words in the same design.", "Nama, tarikh, tempat dan foto ialah medan - bukan sebahagian seni - jadi setiap pelanggan mendapat perkataan sendiri dalam reka bentuk yang sama.")}</p>}
        </DrawerPanel>
        {e.zones_missing.length > 0 && (
          <DrawerPanel icon="warning" title={L("Still to finish", "Belum selesai")} testid="dc-zones-missing">
            <ul className={css.list}>{e.zones_missing.map((x) => <li key={x}>{x}</li>)}</ul>
          </DrawerPanel>
        )}
      </>
    }>
      <div className={css.pagePick} role="group" aria-label={L("Pages", "Halaman")}>
        {e.pages.map((p) => {
          const n = e.zones.filter((x) => x.page_id === p.id).length;
          return (
            <button key={p.id} type="button" className={`${btnSm} ${p.id === pageId ? css.pageOn : ""}`} aria-pressed={p.id === pageId} disabled={busy} onClick={() => void goPage(p.id)} data-testid={`dc-zpage-${p.position}`}>
              {p.position}. {ptitle(p)} {n > 0 && <span className={chipSmNeutral}>{n}</span>}
            </button>
          );
        })}
      </div>
      <div className={css.adds}>
        {(["text", "multiline", "date", "image"] as const).map((k) => (
          <button key={k} type="button" className={btnSm} disabled={busy || draft.length >= ZONE_LIMITS.per_page} onClick={() => add(k)} data-testid={`dc-z-add-${k}`}><AppIcon name="add" /> {KIND_LABEL[k]()}</button>
        ))}
      </div>
      <div className={css.stage} ref={frameRef}>
        {page && <CardPageView art={page.has_file ? pageArt(t.id, page) : null} format={f} zones={draft} lang={lang} safe selected={sel} onPointer={onPointer} />}
      </div>
      <p className="erp-help">{L("Drag a field to move it; drag its corner to resize. Fields stay inside the safe area (the dashed line).", "Seret medan untuk mengalihkannya; seret bucunya untuk mengubah saiz. Medan kekal dalam kawasan selamat (garis putus-putus).")}</p>
      {error && <p className="erp-error" role="alert" data-testid="dc-zones-error">{error}</p>}
      {dirty && <p className="erp-help" role="status" data-testid="dc-zones-dirty"><AppIcon name="warning" /> {L("This page has changes that are not saved yet.", "Halaman ini ada perubahan yang belum disimpan.")}</p>}
      <DrawerFoot testid="dc-zones-actions">
        <button type="button" className={btnGhost} onClick={onBack} disabled={busy}>{L("Back", "Kembali")}</button>
        <button type="button" className={btnSm} onClick={async () => { if (!dirty || (await save())) onPreview(); }} disabled={busy} data-testid="dc-zones-preview"><AppIcon name="preview" /> {L("Preview", "Pratonton")}</button>
        <button type="button" className={btnClass} disabled={busy} data-testid="dc-zones-save"
          onClick={async () => { if (dirty) { if (await save()) return; return; } onDone(); }}>
          {busy ? L("Saving…", "Menyimpan…") : dirty ? L("Save page", "Simpan halaman") : L("Save and close", "Simpan dan tutup")}</button>
      </DrawerFoot>
      {confirmNode}
    </DrawerForm>
  );
}

/** the whole card, as the customer will see it - phone frame or desktop stage, page by page */
export function CardPreview({ templateId, onClose }: { templateId: number; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const [i, setI] = useState(0);
  const [safe, setSafe] = useState(false);
  const [outlines, setOutlines] = useState(false);
  const [longest, setLongest] = useState(false);
  const [lang, setLang] = useState<"en" | "ms">("en");
  useEffect(() => {
    void api<Detail>(`/staff/card-templates/${templateId}`).then((r) => {
      if (r.ok && r.data?.editor) { setD(r.data); setLang(r.data.template.language === "ms" ? "ms" : "en"); } else setFailed(true);
    });
  }, [templateId]);
  const e = d?.editor, f = e?.format;
  const pages = e?.pages ?? [];
  const page = pages[Math.min(i, Math.max(0, pages.length - 1))];
  return (
    <SideDrawer open onClose={onClose} wide icon="preview" title={L(`Preview: ${d?.template.name ?? ""}`, `Pratonton: ${d?.template.name ?? ""}`)}
      subtitle={L("As the customer will see it - fields show their samples", "Seperti yang pelanggan akan lihat - medan menunjukkan contoh")}>
      {!d ? (failed ? <p className="erp-error" role="alert">{L("The template could not be read.", "Templat tidak dapat dibaca.")}</p> : <SkelRows rows={6} />) : !f || !page ? (
        <p className="erp-help">{L("There are no pages to preview yet.", "Belum ada halaman untuk dipratonton.")}</p>
      ) : (
        <div className={css.preview} data-testid="dc-preview">
          <div className={css.controls}>
            <PillSwitch value={device} onChange={(v) => setDevice(v as "phone" | "desktop")} label={L("Device", "Peranti")} testid="dc-pv-device"
              options={[["phone", L("Phone", "Telefon")], ["desktop", L("Desktop", "Desktop")]] as const} />
            {d.template.language === "both" && <PillSwitch value={lang} onChange={(v) => setLang(v as "en" | "ms")} label={L("Card language", "Bahasa kad")} testid="dc-pv-lang"
              options={[["en", "English"], ["ms", "BM"]] as const} />}
            <label className="erp-flex"><input type="checkbox" className="erp-check" checked={safe} onChange={(ev) => setSafe(ev.target.checked)} data-testid="dc-pv-safe" /> {L("Safe area", "Kawasan selamat")}</label>
            <label className="erp-flex"><input type="checkbox" className="erp-check" checked={outlines} onChange={(ev) => setOutlines(ev.target.checked)} /> {L("Field outlines", "Garis medan")}</label>
            <label className="erp-flex"><input type="checkbox" className="erp-check" checked={longest} onChange={(ev) => setLongest(ev.target.checked)} data-testid="dc-pv-longest" /> {L("Longest text", "Teks terpanjang")}</label>
          </div>
          {longest && <p className="erp-help" role="status" data-testid="dc-pv-longest-note">{L("Every field shows the most characters it allows. Text cut off at an edge means the box is too small or allows too many characters.", "Setiap medan menunjukkan aksara terbanyak yang dibenarkan. Teks yang terpotong di tepi bermakna kotak terlalu kecil atau membenarkan terlalu banyak aksara.")}</p>}
          {e.missing.length > 0 && <p className="erp-help" role="status"><AppIcon name="warning" /> {L("Some pages are not finished: ", "Beberapa halaman belum siap: ")}{e.missing.join(" · ")}</p>}
          <div className={device === "phone" ? css.phone : css.desktop} data-testid={`dc-pv-${device}`}>
            <div className={device === "phone" ? css.phoneScreen : css.desktopPage}>
              <CardPageView art={page.has_file ? pageArt(d.template.id, page) : null} format={f} zones={e.zones.filter((z) => z.page_id === page.id)} lang={lang} longest={longest} safe={safe} outlines={outlines} />
            </div>
          </div>
          <div className={css.pager}>
            <button type="button" className={btnSm} disabled={i <= 0} onClick={() => setI(i - 1)} data-testid="dc-pv-prev"><AppIcon name="previous" /> {L("Previous", "Sebelum")}</button>
            <span className={css.pageName}>{L(`Page ${i + 1} of ${pages.length}`, `Halaman ${i + 1} daripada ${pages.length}`)} · {ptitle(page)} {page.required && <span className={chipSmWarn}>{L("Required", "Wajib")}</span>}</span>
            <button type="button" className={btnSm} disabled={i >= pages.length - 1} onClick={() => setI(i + 1)} data-testid="dc-pv-next">{L("Next", "Seterusnya")} <AppIcon name="next" /></button>
          </div>
        </div>
      )}
    </SideDrawer>
  );
}

/* v1.389.0 - what the portfolio screens share: turning a portfolio into the card's words, loading
   its pictures, and saving the card as PNG / PDF / QR. The portal (Staff -> Portfolios, Profile)
   and nothing else uses this; the public page draws HTML, not the card. */

import { CONTACT } from "@/constants/content";
import { A2Z_CREATIVE } from "@/lib/issuers";
import { CARD_SIZES, alphaBox, drawBack, drawFront, isCutout, type CardAssets, type CardCrop, type CardData, type CardSize, type CardTemplate } from "@/lib/portfolio-card";
import type { CardIcon } from "@/lib/card-icons";
import { imagesToPdf, MM_TO_PT } from "@/lib/image-pdf";
import { qrMatrix, qrPath } from "@/lib/qr";

export interface PortfolioDetail {
  portfolio: {
    id: number; user_id: number; slug: string; state: "draft" | "published" | "unpublished"; template: CardTemplate;
    tagline: string | null; intro: string | null; specialties: string[]; expertise: string[];
    /** 0217 - a nickname for the card and the page; empty = the staff record's full name */
    display_name?: string | null;
    /** 0218 - capitals or normal letters for the name */
    name_case?: "upper" | "normal";
    /** 0220 - the BM words; null = English only */
    content_ms?: PortfolioMs | null;
    experience: string | null; contact_email: string | null; contact_phone: string | null; show_email: boolean; show_phone: boolean;
    socials: Record<string, string>; portrait_key: string | null; photo_crop: CardCrop | null; portrait_stale: boolean; portrait_own?: boolean;
    version: number; published_at: string | null; unpublished_at: string | null; updated_at: string | null;
    public_url: string | null; address: string; unpublished_changes: boolean | null; live_photo_differs: boolean;
  };
  staff: { id: number; name: string; position: string | null; department: string | null; photo_key: string | null; email: string | null; phone: string | null; current: boolean };
  /** the person's responsibilities (Staff -> Departments & Roles): only the Public ones reach a card */
  duties: { public: string[]; key: string[]; all: number };
  items: { id: number; kind: "image" | "video"; title: string; description: string | null; media_key: string | null; media_type: string | null; video_url: string | null; featured: boolean; sort_order: number }[];
  can: { edit: boolean; publish: boolean; upload_staff_photo: boolean; /** v1.390.0 - the owner sends it for approval */ submit?: boolean; /** 0219 - you are its pre-checker */ precheck?: boolean };
  /** 0219 - where the review stands: null = not sent, or published since */
  review?: PortfolioReview | null;
}
/** 0220 - a portfolio's words in Bahasa Melayu: lists are a phrase map (English -> BM) */
export interface PortfolioMs {
  tagline?: string; intro?: string; experience?: string;
  phrases?: Record<string, string>;
  items?: Record<string, { title?: string; description?: string }>;
}
export interface PortfolioReview {
  stage: "precheck" | "approval" | "returned"; version: number; at: string; note: string | null; by: string | null;
  prechecker: { name: string | null; role: string | null } | null; prechecked_by: string | null; changed_since: boolean; mine_to_precheck: boolean;
}
const ROLE_WORD: Record<string, string> = { coo: "COO", cco: "CCO", ceo: "CEO" };
/** the review in words, for the editor, the list and Profile */
export function reviewWords(r: PortfolioReview | { stage: string; prechecker: { name: string | null; role: string | null } | null; prechecked_by?: string | null; note?: string | null; by?: string | null }, ms: boolean): string {
  const who = r.prechecker ? `${r.prechecker.name ?? ""}${r.prechecker.role && ROLE_WORD[r.prechecker.role] ? ` (${ROLE_WORD[r.prechecker.role]})` : ""}` : "";
  if (r.stage === "precheck") return ms ? `Menunggu semakan awal oleh ${who}` : `Waiting for pre-check by ${who}`;
  if (r.stage === "returned") return ms ? `Dikembalikan oleh ${r.by ?? ""}${r.note ? `: ${r.note}` : ""}` : `Returned by ${r.by ?? ""}${r.note ? `: ${r.note}` : ""}`;
  return "prechecked_by" in r && r.prechecked_by
    ? (ms ? `Disemak awal oleh ${r.prechecked_by} - menunggu kelulusan CEO` : `Pre-checked by ${r.prechecked_by} - waiting for the CEO's approval`)
    : (ms ? "Menunggu kelulusan CEO" : "Waiting for the CEO's approval");
}

const SOCIAL_KINDS: Record<string, CardIcon> = { instagram: "instagram", tiktok: "tiktok", facebook: "facebook", linkedin: "linkedin", youtube: "youtube" };
const handleOf = (url: string) => { const m = /\/(@?[A-Za-z0-9._-]+)\/?$/.exec(url.replace(/\?.*$/, "")); return m ? (m[1]!.startsWith("@") ? m[1]! : `@${m[1]}`) : null; };

/** the words on the card: the staff record's name / position / department, the portfolio's own
    words, and the contact the approver ticked - otherwise the company's */
export function cardDataOf(d: PortfolioDetail, draft: Partial<PortfolioDetail["portfolio"]> = {}): CardData {
  const p = { ...d.portfolio, ...draft };
  const own = Object.entries(p.socials ?? {}).filter(([k, v]) => SOCIAL_KINDS[k] && v);
  const socials = own.length
    ? own.map(([k]) => ({ kind: SOCIAL_KINDS[k]!, label: k }))
    : [{ kind: "instagram" as CardIcon, label: "instagram" }, { kind: "tiktok" as CardIcon, label: "tiktok" }, { kind: "facebook" as CardIcon, label: "facebook" }];
  const firstOwn = own.find(([k]) => k === "instagram" || k === "tiktok")?.[1];
  return {
    name: p.display_name?.trim() || d.staff.name, nameCase: p.name_case === "upper" ? "upper" : "normal", position: d.staff.position ?? "", department: d.staff.department,
    tagline: p.tagline ?? null, specialties: p.specialties ?? [], responsibilities: d.duties.public.slice(0, 5),
    expertise: p.expertise ?? [], experience: p.experience ?? null,
    email: p.show_email && p.contact_email ? p.contact_email : CONTACT.email,
    phone: p.show_phone && p.contact_phone ? p.contact_phone : `+${A2Z_CREATIVE.whatsapp.replace(/^\+/, "")}`,
    location: "Johor Bahru, Malaysia", website: "a2zcreative.my",
    socials, socialHandle: (firstOwn && handleOf(firstOwn)) || handleOf(CONTACT.socials.instagram),
    /* a QR only for a page that exists: the published address */
    qrUrl: d.portfolio.state === "published" ? d.portfolio.public_url : null,
    template: (p.template ?? "navy") as CardTemplate,
  };
}

export type LoadedPortrait = NonNullable<CardAssets["portrait"]>;
export async function decodePortrait(blob: Blob): Promise<LoadedPortrait> {
  const bmp = await createImageBitmap(blob);
  const cut = isCutout(bmp, bmp.width, bmp.height);
  return { img: bmp, w: bmp.width, h: bmp.height, cutout: cut, box: cut ? alphaBox(bmp, bmp.width, bmp.height) : undefined };
}
export async function fetchBlob(url: string): Promise<Blob | null> {
  try { const r = await fetch(url, { credentials: "include" }); return r.ok ? await r.blob() : null; } catch { return null; }
}
export const mediaUrl = (key: string) => `/api/v1/media/file/${encodeURIComponent(key)}`;
let logoP: Promise<HTMLImageElement | null> | null = null;
export function loadLogo(): Promise<HTMLImageElement | null> {
  logoP ??= new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = "/logo.png"; });
  return logoP;
}

/** v1.390.1 (the CEO 20-11-2026: "make sure that the portfolio is on the high spec resolution") -
    every download is drawn at TWICE the card's size: 2160 x 3840 (digital) and 2160 x 3440 (the
    54 x 86 mm print, about 1000 dpi). The same drawing, scaled - text, icons and the QR are drawn
    fresh at that size, never enlarged; the on-screen preview stays at 1x. */
export const EXPORT_SCALE = 2;
export function paint(canvas: HTMLCanvasElement, side: "front" | "back", size: CardSize, data: CardData, assets: CardAssets, scale = 1) {
  const { w, h } = CARD_SIZES[size];
  if (canvas.width !== w * scale) canvas.width = w * scale;
  if (canvas.height !== h * scale) canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  if (side === "front") drawFront(ctx, data, assets, size); else drawBack(ctx, data, size);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function canvasOf(side: "front" | "back", size: CardSize, data: CardData, assets: CardAssets, scale = EXPORT_SCALE) {
  const c = document.createElement("canvas");
  paint(c, side, size, data, assets, scale);
  return c;
}
export const toBlob = (c: HTMLCanvasElement, type = "image/png", q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), type, q));

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const fileBase = (d: PortfolioDetail) => `A2Z-portfolio-${d.portfolio.slug}`;

export async function pngOf(side: "front" | "back", size: CardSize, data: CardData, assets: CardAssets): Promise<Blob> {
  return toBlob(canvasOf(side, size, data, assets));
}
/** both sides, one page each: the digital card at 540 x 960 pt, the printed card at 54 x 86 mm -
    each page an image at EXPORT_SCALE (2160 px wide), so it stays sharp when zoomed or printed */
export function pdfOf(size: CardSize, data: CardData, assets: CardAssets): Blob {
  const { w, h, mm } = CARD_SIZES[size];
  const pages = (["front", "back"] as const).map((s) => ({ jpeg: canvasOf(s, size, data, assets).toDataURL("image/jpeg", 0.95), w: w * EXPORT_SCALE, h: h * EXPORT_SCALE }));
  const page = mm ? { w: mm[0] * MM_TO_PT, h: mm[1] * MM_TO_PT } : { w: w / 2, h: h / 2 };
  return imagesToPdf(pages, page);
}

/** the QR on its own: an SVG (crisp at any print size) or a PNG */
export function qrSvg(url: string): string {
  const m = qrMatrix(url);
  const n = m.length + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="1024" height="1024" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#ffffff"/><path d="${qrPath(m, 4)}" fill="#000000"/></svg>`;
}
export async function qrPng(url: string, px = 1024): Promise<Blob> {
  const m = qrMatrix(url);
  const n = m.length + 8;
  const c = document.createElement("canvas");
  c.width = px; c.height = px;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, px, px);
  const cell = px / n;
  x.fillStyle = "#000000";
  for (let r = 0; r < m.length; r++) for (let col = 0; col < m.length; col++) if (m[r]![col]) x.fillRect(Math.floor((col + 4) * cell), Math.floor((r + 4) * cell), Math.ceil(cell), Math.ceil(cell));
  return toBlob(c);
}

/** read the QR back off the card the way a phone would (the browser's own barcode reader, where it has one) */
export async function testScan(blob: Blob): Promise<string | null | "unsupported"> {
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (i: ImageBitmapSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (!BD) return "unsupported";
  try {
    const bmp = await createImageBitmap(blob);
    const found = await new BD({ formats: ["qr_code"] }).detect(bmp);
    return found[0]?.rawValue ?? null;
  } catch { return "unsupported"; }
}

/** the phone's own share sheet with the card image; false when the device cannot share files */
export async function shareCard(blob: Blob, name: string, url: string | null, title: string): Promise<boolean> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const data: ShareData = { files: [file], title, text: url ? `${title} - ${url}` : title };
  if (nav.share && (!nav.canShare || nav.canShare(data))) { try { await nav.share(data); return true; } catch { return true; } }
  if (nav.share && url) { try { await nav.share({ title, url }); return true; } catch { return true; } }
  return false;
}

/* v1.391.0 - DIGITAL CARD RULES, the one copy (Digital Cards Stage 2, the CEO 20-11-2026).
   Pure functions, no imports: the worker (worker/src/card-rules.ts) validates every save
   with them and the portal (components/portal/digital-cards.tsx) draws the Guidelines
   from them, so the safe area on the screen is the safe area the server enforces.
   tests/card-rules.mjs imports this file directly.

   What a rule is:
   - a FORMAT is a fixed design canvas in pixels (1080 x 1920 ...) with a safe margin on
     each side, the file types it takes and the size limit per page. Digital cards are for
     screens, so DPI is not a rule (owner decision D9) and is never checked.
   - a CATEGORY says how many pages a card has (1-10) and suggests them, in order, each
     required or optional. The first page is always the Cover and always required (D9). */

export const CARD_TYPES = ["image/png", "image/jpeg"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const TYPE_LABEL: Record<CardType, string> = { "image/png": "PNG", "image/jpeg": "JPG" };

export const LIMITS = {
  side: [320, 6000] as const, // canvas width / height in px
  bytes: [102400, 26214400] as const, // 100 KB .. 25 MB per page
  pages: [1, 10] as const,
  name: 40,
  pageTitle: 40,
  reason: 8, // a save's reason, at least this many characters
} as const;

export interface CardFormat {
  id: number; code: string; name: string; name_ms: string | null;
  width_px: number; height_px: number;
  margin_top: number; margin_right: number; margin_bottom: number; margin_left: number;
  accepted_types: CardType[]; max_bytes: number; sort: number; active: boolean; version: number;
  updated_at: string | null; updated_by_name?: string | null;
}
export interface CardPage { title: string; title_ms: string | null; required: boolean }
export interface CardCategory {
  id: number; code: string; name: string; name_ms: string | null;
  min_pages: number; max_pages: number; pages: CardPage[]; allow_reorder: boolean;
  sort: number; active: boolean; version: number; updated_at: string | null; updated_by_name?: string | null;
}

/* ---- arithmetic the screen and the server share ---- */
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** "9:16" for 1080 x 1920; a ratio that does not reduce small reads as a decimal ("1.33:1") */
export function aspectLabel(w: number, h: number): string {
  if (!(w > 0 && h > 0)) return "";
  const g = gcd(Math.round(w), Math.round(h));
  const a = Math.round(w) / g, b = Math.round(h) / g;
  if (a <= 32 && b <= 32) return `${a}:${b}`;
  return w >= h ? `${(w / h).toFixed(2)}:1` : `1:${(h / w).toFixed(2)}`;
}
/** the safe content region in canvas pixels */
export function safeArea(f: Pick<CardFormat, "width_px" | "height_px" | "margin_top" | "margin_right" | "margin_bottom" | "margin_left">) {
  return { x: f.margin_left, y: f.margin_top, w: f.width_px - f.margin_left - f.margin_right, h: f.height_px - f.margin_top - f.margin_bottom };
}
export function orientationOf(w: number, h: number): "portrait" | "landscape" | "square" {
  return w === h ? "square" : w > h ? "landscape" : "portrait";
}
/** "10 MB", "1.5 MB", "800 KB" - binary units, as a file manager shows them */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1048576) { const m = bytes / 1048576; return `${Number.isInteger(m) ? m : m.toFixed(1)} MB`; }
  return `${Math.round(bytes / 1024)} KB`;
}
export const requiredCount = (pages: readonly CardPage[]) => pages.filter((p) => p.required).length;

/* ---- validation: one answer for the screen and the server ---- */
export type Problems = Record<string, string>;
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const optText = (v: unknown, max: number): string | null | undefined => (v == null || v === "" ? null : typeof v === "string" && v.trim().length <= max ? v.trim() : undefined);

export type FormatInput = Omit<CardFormat, "id" | "code" | "version" | "updated_at" | "updated_by_name">;
/** a format as the client sent it -> the clean values, or the problems by field */
export function checkFormat(raw: Record<string, unknown>): { value: FormatInput | null; problems: Problems } {
  const p: Problems = {};
  const name = text(raw.name, LIMITS.name); if (!name) p.name = `A name of 1-${LIMITS.name} characters`;
  const name_ms = optText(raw.name_ms, LIMITS.name); if (name_ms === undefined) p.name_ms = `At most ${LIMITS.name} characters`;
  const w = int(raw.width_px), h = int(raw.height_px);
  const [lo, hi] = LIMITS.side;
  if (w == null || w < lo || w > hi) p.width_px = `A whole number of pixels from ${lo} to ${hi}`;
  if (h == null || h < lo || h > hi) p.height_px = `A whole number of pixels from ${lo} to ${hi}`;
  const m = { margin_top: int(raw.margin_top), margin_right: int(raw.margin_right), margin_bottom: int(raw.margin_bottom), margin_left: int(raw.margin_left) };
  for (const [k, v] of Object.entries(m)) if (v == null || v < 0) p[k] = "A whole number of pixels, 0 or more";
  if (w != null && m.margin_left != null && m.margin_right != null && m.margin_left + m.margin_right >= w * 0.5) p.margin_left = p.margin_right = "Left and right margins together must leave at least half the width";
  if (h != null && m.margin_top != null && m.margin_bottom != null && m.margin_top + m.margin_bottom >= h * 0.5) p.margin_top = p.margin_bottom = "Top and bottom margins together must leave at least half the height";
  const types = Array.isArray(raw.accepted_types) ? [...new Set(raw.accepted_types.map(String))] : [];
  if (!types.length || !types.every((t) => (CARD_TYPES as readonly string[]).includes(t))) p.accepted_types = "Choose PNG, JPG or both";
  const max = int(raw.max_bytes);
  if (max == null || max < LIMITS.bytes[0] || max > LIMITS.bytes[1]) p.max_bytes = `From ${sizeLabel(LIMITS.bytes[0])} to ${sizeLabel(LIMITS.bytes[1])} per page`;
  const sort = int(raw.sort) ?? 0;
  const active = raw.active === undefined ? true : raw.active === true || raw.active === 1;
  if (Object.keys(p).length) return { value: null, problems: p };
  return { value: { name: name!, name_ms: name_ms ?? null, width_px: w!, height_px: h!, margin_top: m.margin_top!, margin_right: m.margin_right!, margin_bottom: m.margin_bottom!, margin_left: m.margin_left!,
    accepted_types: (CARD_TYPES as readonly string[]).filter((t) => types.includes(t)) as CardType[], max_bytes: max!, sort, active }, problems: p };
}

export type CategoryInput = Omit<CardCategory, "id" | "code" | "version" | "updated_at" | "updated_by_name">;
export function checkCategory(raw: Record<string, unknown>): { value: CategoryInput | null; problems: Problems } {
  const p: Problems = {};
  const name = text(raw.name, LIMITS.name); if (!name) p.name = `A name of 1-${LIMITS.name} characters`;
  const name_ms = optText(raw.name_ms, LIMITS.name); if (name_ms === undefined) p.name_ms = `At most ${LIMITS.name} characters`;
  const min = int(raw.min_pages), max = int(raw.max_pages);
  const [plo, phi] = LIMITS.pages;
  if (min == null || min < plo || min > phi) p.min_pages = `From ${plo} to ${phi}`;
  if (max == null || max < plo || max > phi) p.max_pages = `From ${plo} to ${phi}`;
  if (min != null && max != null && min > max) p.min_pages = "The least can't be more than the most";
  const list = Array.isArray(raw.pages) ? raw.pages : [];
  const pages: CardPage[] = [];
  list.forEach((x, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const t = text(o.title, LIMITS.pageTitle), tm = optText(o.title_ms, LIMITS.pageTitle);
    if (!t || tm === undefined) { p[`pages.${i}`] = `Page ${i + 1} needs a title of 1-${LIMITS.pageTitle} characters`; return; }
    pages.push({ title: t, title_ms: tm ?? null, required: i === 0 ? true : o.required === true });
  });
  if (!list.length) p.pages = "List at least the Cover page";
  else if (pages.length && pages[0]!.title.toLowerCase() !== "cover") p.pages = "The first page is always the Cover";
  const titles = pages.map((x) => x.title.toLowerCase());
  if (titles.some((t, i) => titles.indexOf(t) !== i)) p.pages = "Two pages have the same title";
  if (max != null && pages.length > max) p.pages = `${pages.length} pages are listed but the most is ${max}`;
  if (min != null && requiredCount(pages) > min) p.min_pages = `${requiredCount(pages)} pages are required, so the least must be at least ${requiredCount(pages)}`;
  const sort = int(raw.sort) ?? 0;
  const active = raw.active === undefined ? true : raw.active === true || raw.active === 1;
  const allow_reorder = raw.allow_reorder === true || raw.allow_reorder === 1;
  if (Object.keys(p).length) return { value: null, problems: p };
  return { value: { name: name!, name_ms: name_ms ?? null, min_pages: min!, max_pages: max!, pages, allow_reorder, sort, active }, problems: p };
}

/** a new rule's code from its name: "Open House 2" -> "open-house-2" */
export function codeOf(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

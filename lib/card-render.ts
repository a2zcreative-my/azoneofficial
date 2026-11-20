/* v1.394.0 - THE CARD RENDERER (Digital Cards Stage 5, the CEO 21-11-2026).
 *
 * ONE drawing of a card page, used by the A2Z OS preview now and copied byte for byte into the
 * AZ ONE storefront in Stage 7, so the customer's card is the designer's preview. No imports, no
 * framework, no data fetching, no measuring: a page is its artwork plus editable zones placed in
 * CANVAS PIXELS and scaled with the frame (container query units), so a phone and a desktop draw
 * the same layout at different sizes - the text wraps at the same words because the box and the
 * type scale together.
 *
 *   pageBoxes(page, zones, values, opts)        -> where and how each zone is drawn (React draws these)
 *   renderPageHTML(artUrl, page, zones, values, opts) -> the same page as an HTML string (AZ ONE, SSR)
 *   fontFaceCss(base)                           -> the @font-face rules for CARD_FONTS (self-hosted files)
 *
 * A zone never spills: its box clips. Customer text is escaped. Colours are the designer's data.
 */

export const CARD_FONTS = {
  playfair: { family: "A2Z Card Playfair", label: "Playfair Display", file: "playfair-display", weights: [400, 700] },
  cormorant: { family: "A2Z Card Cormorant", label: "Cormorant Garamond", file: "cormorant-garamond", weights: [500, 700] },
  greatvibes: { family: "A2Z Card Great Vibes", label: "Great Vibes (script)", file: "great-vibes", weights: [400] },
  dancing: { family: "A2Z Card Dancing Script", label: "Dancing Script (script)", file: "dancing-script", weights: [600] },
  montserrat: { family: "A2Z Card Montserrat", label: "Montserrat", file: "montserrat", weights: [400, 600] },
  poppins: { family: "A2Z Card Poppins", label: "Poppins", file: "poppins", weights: [400, 600] },
} as const;
export type CardFont = keyof typeof CARD_FONTS;
export const FONT_KEYS = Object.keys(CARD_FONTS) as CardFont[];

export const ZONE_KINDS = ["text", "multiline", "date", "image"] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];
export const ALIGNS = ["left", "center", "right"] as const;
export type ZoneAlign = (typeof ALIGNS)[number];

export interface CardZone {
  key: string; page_id: number; kind: ZoneKind; label: string; label_ms: string | null;
  x: number; y: number; w: number; h: number;
  font: CardFont; weight: number; size: number; colour: string; align: ZoneAlign;
  max_chars: number; required: boolean; sample: string; sample_ms: string | null;
}
export interface CardPageSize { width: number; height: number }
export interface RenderOpts {
  /** preview draws an empty image zone as a labelled placeholder; output draws nothing there */
  mode?: "preview" | "output";
  lang?: "en" | "ms";
  /** fill every text zone with its longest allowed text, to check nothing is cut off */
  longest?: boolean;
}
export interface ZoneBox {
  key: string; kind: ZoneKind; label: string;
  left: string; top: string; width: string; height: string;
  fontFamily: string; fontWeight: number; fontSize: string; color: string; align: ZoneAlign;
  multiline: boolean; text: string; image: string | null; placeholder: boolean;
}

const pct = (n: number, of: number) => `${Math.round((n / of) * 1e6) / 1e4}%`;
/** the type size in container units: a size in canvas pixels, scaled with the frame's width */
const cq = (px: number, width: number) => `${Math.round((px / width) * 1e6) / 1e4}cqw`;

/** the value a zone shows: the customer's, else (in preview) the sample in the card's language */
function textOf(z: CardZone, values: Record<string, string>, o: RenderOpts): string {
  if (o.longest && z.kind !== "image") return "M".repeat(Math.min(z.max_chars, 400)).replace(/(.{12})/g, z.kind === "multiline" ? "$1 " : "$1");
  const v = values[z.key];
  if (typeof v === "string" && v.trim()) return v.slice(0, z.max_chars);
  if (o.mode === "output") return "";
  return ((o.lang === "ms" && z.sample_ms) || z.sample || "").slice(0, z.max_chars);
}

export function pageBoxes(page: CardPageSize, zones: readonly CardZone[], values: Record<string, string> = {}, o: RenderOpts = {}): ZoneBox[] {
  return zones.map((z) => {
    const f = CARD_FONTS[z.font] ?? CARD_FONTS.poppins;
    const img = z.kind === "image" ? (values[z.key] || null) : null;
    return {
      key: z.key, kind: z.kind, label: (o.lang === "ms" && z.label_ms) || z.label,
      left: pct(z.x, page.width), top: pct(z.y, page.height), width: pct(z.w, page.width), height: pct(z.h, page.height),
      fontFamily: `"${f.family}", serif`, fontWeight: z.weight, fontSize: cq(z.size, page.width), color: z.colour, align: z.align,
      multiline: z.kind === "multiline", text: z.kind === "image" ? "" : textOf(z, values, o),
      image: img, placeholder: z.kind === "image" && !img && o.mode !== "output",
    };
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const safeUrl = (u: string) => (/^(https?:\/\/|\/)[^\s"'<>]*$/.test(u) ? u : "");
const safeColour = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#000000");

/** the box style both renderers use - one place, so the portal and AZ ONE cannot drift */
export function boxStyle(b: ZoneBox): Record<string, string> {
  return {
    position: "absolute", left: b.left, top: b.top, width: b.width, height: b.height, overflow: "hidden",
    display: "flex", alignItems: "center", justifyContent: b.align === "left" ? "flex-start" : b.align === "right" ? "flex-end" : "center",
    textAlign: b.align, fontFamily: b.fontFamily, fontWeight: String(b.fontWeight), fontSize: b.fontSize, lineHeight: "1.2",
    color: safeColour(b.color), whiteSpace: b.multiline ? "pre-line" : "nowrap", overflowWrap: "break-word", boxSizing: "border-box",
  };
}
/** the frame: the artwork's own ratio; its width is the unit every size is measured in */
export const frameStyle = (page: CardPageSize): Record<string, string> => ({
  position: "relative", width: "100%", aspectRatio: `${page.width} / ${page.height}`, containerType: "inline-size", overflow: "hidden",
});

const css = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`).join(";");

export function renderPageHTML(artUrl: string, page: CardPageSize, zones: readonly CardZone[], values: Record<string, string> = {}, o: RenderOpts = {}): string {
  const boxes = pageBoxes(page, zones, values, o).map((b) => {
    if (b.kind === "image") {
      if (b.image && safeUrl(b.image)) return `<div style="${css({ ...boxStyle(b), display: "block" })}"><img src="${esc(safeUrl(b.image))}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></div>`;
      return b.placeholder ? `<div style="${css(boxStyle(b))};border:2px dashed currentColor;opacity:.6">${esc(b.label)}</div>` : "";
    }
    return `<div style="${css(boxStyle(b))}">${esc(b.text)}</div>`;
  });
  return `<div class="a2z-card-page" style="${css(frameStyle(page))}"><img src="${esc(safeUrl(artUrl))}" alt="" style="position:absolute;inset:0;width:100%;height:100%;display:block">${boxes.join("")}</div>`;
}

/** the @font-face rules for the card fonts; public/card-fonts/card-fonts.css is exactly this with base "/card-fonts/" */
export function fontFaceCss(base = "/card-fonts/"): string {
  return FONT_KEYS.flatMap((k) => CARD_FONTS[k].weights.map((w) =>
    `@font-face{font-family:"${CARD_FONTS[k].family}";font-style:normal;font-weight:${w};font-display:swap;src:url("${base}${CARD_FONTS[k].file}-latin-${w}-normal.woff2") format("woff2")}`,
  )).join("\n") + "\n";
}

/** the nearest weight a font has (a zone keeps a weight the font can draw) */
export const weightFor = (font: CardFont, weight: number) =>
  [...CARD_FONTS[font].weights].sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight))[0]!;

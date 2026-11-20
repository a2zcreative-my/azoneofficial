import { ALIGNS, FONT_KEYS, ZONE_KINDS, weightFor, type CardFont, type CardZone, type ZoneAlign, type ZoneKind } from "./card-render";
/* v1.392.0 - DIGITAL CARD TEMPLATES, the one copy of the template rules shared by the worker
   (worker/src/card-templates.ts) and the portal (components/portal/digital-cards.tsx).
   Digital Cards Stage 3 (the CEO 21-11-2026). Pure functions, no imports, imported directly by
   tests/card-templates.mjs.

   A template moves draft -> in review -> published (later stages), and may be returned to its
   designer, unpublished or archived. Nothing is ever deleted. Only the designer edits their own
   draft or returned template; the information is checked here.

   v1.393.0 (Stage 4) - the editor: the step a draft reached, the Design Specs confirmation tied to
   the rule versions it was given (specsKey), and the page plan (checkPagePlan / pagesReady). The
   files themselves are read by lib/card-image.ts. */

export const TEMPLATE_STATES = ["draft", "in_review", "returned", "published", "unpublished", "archived"] as const;
export type TemplateState = (typeof TEMPLATE_STATES)[number];
export const EDITABLE_STATES: readonly TemplateState[] = ["draft", "returned"];
export const LANGUAGES = ["en", "ms", "both"] as const;
export type TemplateLanguage = (typeof LANGUAGES)[number];
/** the AZ ONE packages a design is offered under (owner decision D2: Silver, Gold, Diamond) */
export const PACKAGES = ["silver", "gold", "diamond"] as const;
export type TemplatePackage = (typeof PACKAGES)[number];
export const TEMPLATE_LIMITS = { name: 60, description: 400, reason: 8 } as const;

/** the four figures on the Digital Cards strip, and what each counts (archived counts nowhere) */
export const KPI_OF: Record<"total" | "drafts" | "in_review" | "published", readonly TemplateState[]> = {
  total: ["draft", "in_review", "returned", "published", "unpublished"],
  drafts: ["draft", "returned"],
  in_review: ["in_review"],
  published: ["published"],
};

export interface TemplateInfo {
  name: string; description: string | null; category_id: number; format_id: number;
  language: TemplateLanguage; packages: TemplatePackage[];
}
export type InfoProblems = Record<string, string>;

/** template information as the client sent it -> the clean values, or the problems by field.
    `categories` / `formats` are the ids that are switched on now; a draft cannot choose one that is off. */
export function checkTemplateInfo(raw: Record<string, unknown>, active: { categories: readonly number[]; formats: readonly number[] }): { value: TemplateInfo | null; problems: InfoProblems } {
  const p: InfoProblems = {};
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > TEMPLATE_LIMITS.name) p.name = `A name of 1-${TEMPLATE_LIMITS.name} characters`;
  const d = raw.description == null ? "" : typeof raw.description === "string" ? raw.description.trim() : null;
  if (d === null || d.length > TEMPLATE_LIMITS.description) p.description = `At most ${TEMPLATE_LIMITS.description} characters`;
  const category_id = Number(raw.category_id), format_id = Number(raw.format_id);
  if (!Number.isInteger(category_id) || !active.categories.includes(category_id)) p.category_id = "Choose a category that is switched on";
  if (!Number.isInteger(format_id) || !active.formats.includes(format_id)) p.format_id = "Choose a format that is switched on";
  const language = (LANGUAGES as readonly string[]).includes(String(raw.language)) ? (raw.language as TemplateLanguage) : null;
  if (!language) p.language = "Choose English, Bahasa Melayu or both";
  const pk = Array.isArray(raw.packages) ? [...new Set(raw.packages.map(String))] : [];
  if (!pk.length || !pk.every((x) => (PACKAGES as readonly string[]).includes(x))) p.packages = "Choose at least one package";
  if (Object.keys(p).length) return { value: null, problems: p };
  return { value: { name, description: d || null, category_id, format_id, language: language!, packages: PACKAGES.filter((x) => pk.includes(x)) }, problems: p };
}

/** who may change a template's information: its designer, while it is a draft or was returned */
export const canEditTemplate = (t: { state: string; designer_id: number }, userId: number, canManage: boolean) =>
  canManage && t.designer_id === userId && (EDITABLE_STATES as readonly string[]).includes(t.state);

/** a stable code from the name: "Elegant Navy Wedding" -> "elegant-navy-wedding" */
export function templateCode(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "template";
}

/* ============================ v1.393.0 - THE EDITOR (Stage 4) ============================ */

/** the editor's steps built so far; Review & Publish is a later stage */
export const EDITOR_STEPS = 4; // v1.394.0 - Stage 5 adds Editable Content
export const PAGE_TITLE_MAX = 40;

/** the rule versions a designer confirmed on Design Specs. A rule changed since -> confirm again. */
export const specsKey = (f: { id: number; version: number }, c: { id: number; version: number }) => `${f.id}:${f.version}:${c.id}:${c.version}`;

export interface PlanPage { id: number | null; title: string; title_ms: string | null; required: boolean }
export interface PlanRule { min_pages: number; max_pages: number; allow_reorder: boolean; pages: { title: string; title_ms: string | null; required: boolean }[] }

/** the first plan of a template: the category's pages in its order (the Cover first), up to the maximum */
export const initialPlan = (rule: PlanRule): PlanPage[] =>
  rule.pages.slice(0, rule.max_pages).map((p) => ({ id: null, title: p.title, title_ms: p.title_ms ?? null, required: p.required }));

const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

/** a new order / set of pages, as the client sent it, against the plan that exists.
    Required pages stay, keep their title, and the Cover stays first; an optional page may be added,
    renamed or removed; the order moves only where the category allows it. */
export function checkPagePlan(current: readonly PlanPage[], raw: unknown, rule: PlanRule): { value: PlanPage[] | null; problem: string | null } {
  const bad = (problem: string) => ({ value: null, problem });
  if (!Array.isArray(raw) || !raw.length) return bad("A template has at least one page");
  if (raw.length > rule.max_pages) return bad(`This category allows at most ${rule.max_pages} pages`);
  if (raw.length < rule.min_pages) return bad(`This category needs at least ${rule.min_pages} pages`);
  const byId = new Map(current.filter((p) => p.id != null).map((p) => [p.id!, p]));
  const seen = new Set<number>();
  const out: PlanPage[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const id = item && item.id != null ? Number(item.id) : null;
    if (id != null) {
      const was = byId.get(id);
      if (!was || seen.has(id)) return bad("That page is not part of this template - reload and try again");
      seen.add(id);
      if (was.required) { out.push({ ...was }); continue; } // a required page keeps its title
      const title = clean(item.title) || was.title;
      if (title.length > PAGE_TITLE_MAX) return bad(`A page title is at most ${PAGE_TITLE_MAX} characters`);
      const title_ms = item.title_ms === undefined ? was.title_ms : clean(item.title_ms) || null;
      if (title_ms && title_ms.length > PAGE_TITLE_MAX) return bad(`A page title is at most ${PAGE_TITLE_MAX} characters`);
      out.push({ id, title, title_ms, required: false });
    } else {
      const title = clean(item?.title);
      if (!title || title.length > PAGE_TITLE_MAX) return bad(`Give the new page a title of 1-${PAGE_TITLE_MAX} characters`);
      const title_ms = clean(item?.title_ms) || null;
      if (title_ms && title_ms.length > PAGE_TITLE_MAX) return bad(`A page title is at most ${PAGE_TITLE_MAX} characters`);
      out.push({ id: null, title, title_ms, required: false });
    }
  }
  for (const p of current) if (p.required && p.id != null && !seen.has(p.id)) return bad(`${p.title} is a required page and cannot be removed`);
  const firstRequired = current.find((p) => p.required);
  if (firstRequired && out[0]?.id !== firstRequired.id) return bad(`${firstRequired.title} stays the first page`);
  if (!rule.allow_reorder) {
    const before = current.filter((p) => p.id != null && seen.has(p.id)).map((p) => p.id);
    const after = out.filter((p) => p.id != null).map((p) => p.id);
    if (before.join() !== after.join()) return bad("This category keeps its pages in order - add new pages at the end");
  }
  const titles = out.map((p) => p.title.toLowerCase());
  if (new Set(titles).size !== titles.length) return bad("Two pages have the same title");
  return { value: out, problem: null };
}

/** what still stops Upload Pages being complete - empty when every page is in and fits */
export function pagesReady(pages: readonly { title: string; has_file: boolean; problems: readonly string[] }[], rule: { min_pages: number; max_pages: number }): string[] {
  const out: string[] = [];
  if (pages.length < rule.min_pages) out.push(`At least ${rule.min_pages} pages`);
  if (pages.length > rule.max_pages) out.push(`At most ${rule.max_pages} pages`);
  for (const p of pages) {
    if (!p.has_file) out.push(`${p.title}: no artwork uploaded yet`);
    else if (p.problems.length) out.push(`${p.title}: ${p.problems[0]}`);
  }
  return out;
}

/* ======================= v1.394.0 - EDITABLE CONTENT (Stage 5) ======================= */

export const ZONE_LIMITS = { label: 40, sample: 200, chars: [1, 400] as const, size: [12, 400] as const, min_box: 24, per_page: 20 } as const;
/** the zone's key, the name its value is stored under on a customer card: "Bride's name" -> "brides_name" */
export const zoneKey = (label: string) => label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "field";

interface ZoneFormat { width_px: number; height_px: number; margin_top: number; margin_right: number; margin_bottom: number; margin_left: number }
/** the safe area every zone must sit inside (the same rectangle lib/card-rules.ts safeArea draws) */
const safeOf = (f: ZoneFormat) => ({ x: f.margin_left, y: f.margin_top, r: f.width_px - f.margin_right, b: f.height_px - f.margin_bottom });

/** the zones of ONE page as the client sent them -> clean zones, or the problem. `otherKeys` are the keys
    used on the template's other pages: a key names one value across the whole card. */
export function checkZones(raw: unknown, pageId: number, f: ZoneFormat, otherKeys: readonly string[] = []): { value: CardZone[] | null; problem: string | null } {
  const bad = (problem: string) => ({ value: null, problem });
  if (!Array.isArray(raw)) return bad("Send the zones of the page");
  if (raw.length > ZONE_LIMITS.per_page) return bad(`At most ${ZONE_LIMITS.per_page} editable fields on one page`);
  const s = safeOf(f);
  const keys = new Set(otherKeys);
  const out: CardZone[] = [];
  for (const [i, z] of (raw as Record<string, unknown>[]).entries()) {
    const n = i + 1;
    const label = typeof z?.label === "string" ? z.label.trim().replace(/\s+/g, " ") : "";
    if (!label || label.length > ZONE_LIMITS.label) return bad(`Field ${n}: a label of 1-${ZONE_LIMITS.label} characters`);
    const key = typeof z.key === "string" && /^[a-z0-9_]{1,32}$/.test(z.key) ? z.key : zoneKey(label);
    if (keys.has(key)) return bad(`${label}: another field already uses the name "${key}" - give it a different label`);
    keys.add(key);
    const kind = (ZONE_KINDS as readonly string[]).includes(String(z.kind)) ? (z.kind as ZoneKind) : null;
    if (!kind) return bad(`${label}: choose text, several lines, date or photo`);
    const x = Math.round(Number(z.x)), y = Math.round(Number(z.y)), w = Math.round(Number(z.w)), h = Math.round(Number(z.h));
    if (![x, y, w, h].every((v) => Number.isFinite(v))) return bad(`${label}: the position is missing`);
    if (w < ZONE_LIMITS.min_box || h < ZONE_LIMITS.min_box) return bad(`${label}: the box is too small (at least ${ZONE_LIMITS.min_box} px each way)`);
    if (x < s.x || y < s.y || x + w > s.r || y + h > s.b) return bad(`${label}: the box goes outside the safe area`);
    const font = (FONT_KEYS as readonly string[]).includes(String(z.font)) ? (z.font as CardFont) : null;
    if (!font) return bad(`${label}: choose one of the card fonts`);
    const weight = weightFor(font, Number(z.weight) || 400);
    const size = Math.round(Number(z.size));
    if (!(size >= ZONE_LIMITS.size[0] && size <= ZONE_LIMITS.size[1])) return bad(`${label}: a text size of ${ZONE_LIMITS.size[0]}-${ZONE_LIMITS.size[1]} px`);
    const colour = typeof z.colour === "string" && /^#[0-9a-fA-F]{6}$/.test(z.colour) ? z.colour.toLowerCase() : null;
    if (!colour) return bad(`${label}: choose a colour`);
    const align = (ALIGNS as readonly string[]).includes(String(z.align)) ? (z.align as ZoneAlign) : "center";
    const max_chars = kind === "image" ? 1 : Math.round(Number(z.max_chars));
    if (kind !== "image" && !(max_chars >= ZONE_LIMITS.chars[0] && max_chars <= ZONE_LIMITS.chars[1])) return bad(`${label}: allow ${ZONE_LIMITS.chars[0]}-${ZONE_LIMITS.chars[1]} characters`);
    const sample = typeof z.sample === "string" ? z.sample.trim().slice(0, ZONE_LIMITS.sample) : "";
    const sample_ms = typeof z.sample_ms === "string" && z.sample_ms.trim() ? z.sample_ms.trim().slice(0, ZONE_LIMITS.sample) : null;
    if (kind !== "image" && !sample) return bad(`${label}: give a sample, shown in the preview until the customer types`);
    if (kind !== "image" && (sample.length > max_chars || (sample_ms?.length ?? 0) > max_chars)) return bad(`${label}: the sample is longer than the ${max_chars} characters allowed`);
    const label_ms = typeof z.label_ms === "string" && z.label_ms.trim() ? z.label_ms.trim().slice(0, ZONE_LIMITS.label) : null;
    out.push({ key, page_id: pageId, kind, label, label_ms, x, y, w, h, font, weight, size, colour, align, max_chars, required: z.required === true, sample, sample_ms });
  }
  return { value: out, problem: null };
}

/** what stops Editable Content being complete: at least one field on the card, every field still inside the safe area */
export function zonesReady(zones: readonly CardZone[], f: ZoneFormat): string[] {
  const out: string[] = [];
  if (!zones.length) out.push("Add at least one field the customer fills in");
  const s = safeOf(f);
  for (const z of zones) if (z.x < s.x || z.y < s.y || z.x + z.w > s.r || z.y + z.h > s.b) out.push(`${z.label}: now outside the safe area`);
  return out;
}

/** a new field of a kind, centred in the safe area, with a key no other field on the card uses */
export function newZone(kind: ZoneKind, pageId: number, f: ZoneFormat, used: readonly string[]): CardZone {
  const s = safeOf(f);
  const sw = s.r - s.x, sh = s.b - s.y;
  const base = { text: "Name", multiline: "Message", date: "Date", image: "Photo" }[kind];
  const baseMs = { text: "Nama", multiline: "Mesej", date: "Tarikh", image: "Foto" }[kind];
  let label = base, n = 1;
  while (used.includes(zoneKey(label))) label = `${base} ${++n}`;
  const w = Math.round(sw * (kind === "image" ? 0.5 : 0.8)), h = Math.round(kind === "image" ? w : kind === "multiline" ? sh * 0.18 : Math.max(ZONE_LIMITS.min_box, sh * 0.07));
  return {
    key: zoneKey(label), page_id: pageId, kind, label, label_ms: n > 1 ? `${baseMs} ${n}` : baseMs,
    x: Math.round(s.x + (sw - w) / 2), y: Math.round(s.y + (sh - h) / 2), w, h,
    font: kind === "text" ? "playfair" : "montserrat", weight: kind === "text" ? 700 : 400, size: Math.round(f.width_px * (kind === "text" ? 0.06 : 0.035)),
    colour: "#1f2a44", align: "center", max_chars: kind === "multiline" ? 240 : kind === "image" ? 1 : 40, required: kind !== "image",
    sample: { text: "Aiman & Nadia", multiline: "Together with our families, we invite you to celebrate with us", date: "Saturday, 12 December 2026", image: "" }[kind],
    sample_ms: { text: "Aiman & Nadia", multiline: "Bersama keluarga, kami menjemput anda meraikan bersama kami", date: "Sabtu, 12 Disember 2026", image: "" }[kind] || null,
  };
}
/** keep a moved or resized box inside the safe area (the server refuses one outside) */
export function clampZone(z: { x: number; y: number; w: number; h: number }, f: ZoneFormat) {
  const s = safeOf(f);
  const w = Math.max(ZONE_LIMITS.min_box, Math.min(Math.round(z.w), s.r - s.x)), h = Math.max(ZONE_LIMITS.min_box, Math.min(Math.round(z.h), s.b - s.y));
  return { x: Math.min(Math.max(Math.round(z.x), s.x), s.r - w), y: Math.min(Math.max(Math.round(z.y), s.y), s.b - h), w, h };
}

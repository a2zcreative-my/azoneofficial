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

/** the editor's steps this stage builds; later stages add Editable Content and Review & Publish */
export const EDITOR_STEPS = 3;
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

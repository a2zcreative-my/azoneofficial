/* v1.392.0 - DIGITAL CARD TEMPLATES, the one copy of the template rules shared by the worker
   (worker/src/card-templates.ts) and the portal (components/portal/digital-cards.tsx).
   Digital Cards Stage 3 (the CEO 21-11-2026). Pure functions, no imports, imported directly by
   tests/card-templates.mjs.

   A template moves draft -> in review -> published (later stages), and may be returned to its
   designer, unpublished or archived. Nothing is ever deleted. Only the designer edits their own
   draft or returned template; the information is checked here, the pages in a later stage. */

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

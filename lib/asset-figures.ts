/* v1.303.0 - ASSETS WORKSPACE 4.0: THE ONE FIGURE SOURCE (the CEO, 14-11-2026,
   claude/ASSETS-WORKSPACE-4.0-BLUEPRINT.md section 7). The Overview and every
   report read their counts and costs from here - nothing is summed twice.

   Rules (the directive's, tested in tests/assets4.mjs):
     - the money is the RECORDED PURCHASE COST, as typed in the register - not
       a value and never a net book value (A2Z OS keeps cash-basis books with no
       depreciation);
     - an asset with no price is NOT RM 0: it is counted as "without a price"
       and left out of the cost, and every total says how many;
     - lost and disposed stay in the counts, out of the ACTIVE cost;
     - the two companies are never added together: a company line each, and a
       line for assets whose company is not set yet. */

export interface FigAsset {
  id: number; status: string; category: string; location: string | null;
  purchase_price_cents: number | null; assigned_to: number | null; assigned_name: string | null;
  issuer_code?: string | null; shared_label?: string | null;
  serial_no?: string | null; purchase_date?: string | null; warranty_until?: string | null;
}
export const STATUS_ORDER = ["in_use", "spare", "repair", "lost", "disposed"] as const;
export const isActive = (a: Pick<FigAsset, "status">) => a.status !== "disposed" && a.status !== "lost";

export interface Line { key: string; count: number; cost_cents: number; priced: number; unpriced: number; active: number; active_cost_cents: number }
/** one line of figures for a group of assets */
export function lineOf(key: string, list: FigAsset[]): Line {
  let cost = 0, priced = 0, activeN = 0, activeCost = 0;
  for (const a of list) {
    if (isActive(a)) activeN++;
    if (a.purchase_price_cents == null) continue;
    priced++; cost += a.purchase_price_cents;
    if (isActive(a)) activeCost += a.purchase_price_cents;
  }
  return { key, count: list.length, cost_cents: cost, priced, unpriced: list.length - priced, active: activeN, active_cost_cents: activeCost };
}
/** the assets grouped by a key, each group one line, largest first */
export function groupLines<T extends FigAsset>(list: T[], keyOf: (a: T) => string): Line[] {
  const m = new Map<string, T[]>();
  for (const a of list) { const k = keyOf(a); m.set(k, [...(m.get(k) ?? []), a]); }
  return [...m.entries()].map(([k, v]) => lineOf(k, v)).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
/** the five statuses, always in their order, empty ones included */
export function statusLines(list: FigAsset[]): Line[] {
  return STATUS_ORDER.map((k) => lineOf(k, list.filter((a) => a.status === k)));
}
export const COMPANY_NOT_SET = "not_set";
export const companyKey = (a: FigAsset) => (a.issuer_code === "a2z" || a.issuer_code === "azoo" ? a.issuer_code : COMPANY_NOT_SET);
/** by company: A2Z, AZ ONE and "not set" - three separate lines, never one mixed total */
export function companyLines(list: FigAsset[]): Line[] {
  return ["a2z", "azoo", COMPANY_NOT_SET].map((k) => lineOf(k, list.filter((a) => companyKey(a) === k))).filter((l) => l.count > 0 || l.key !== COMPANY_NOT_SET);
}
/** who keeps it: a person, a shared team or place, or nobody named */
export const custodyKey = (a: FigAsset) => (a.assigned_to != null ? `p:${a.assigned_to}` : a.shared_label ? `s:${a.shared_label}` : "none");
export const share = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

export type MissingField = "price" | "serial" | "company" | "purchase_date" | "warranty_ended";
/** what a register row is missing - the Missing information report */
export function missingOf(a: FigAsset, today: string): MissingField[] {
  const out: MissingField[] = [];
  if (a.purchase_price_cents == null) out.push("price");
  if (!a.serial_no) out.push("serial");
  if (companyKey(a) === COMPANY_NOT_SET) out.push("company");
  if (!a.purchase_date) out.push("purchase_date");
  if (isActive(a) && a.warranty_until && a.warranty_until < today) out.push("warranty_ended");
  return out;
}

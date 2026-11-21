/* v1.399.0 - THE SALES PIPELINE, the words and the one value rule (Sales Command Center Phase 3;
   worker/src/deals.ts holds the same keys). Imports nothing, so the worker and the screen share it. */

export const OPEN_STAGES = ["new", "qualified", "proposal", "negotiation"] as const;
export const STAGES = [...OPEN_STAGES, "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_WORD: Record<Stage, [string, string]> = {
  new: ["New", "Baharu"],
  qualified: ["Qualified", "Layak"],
  proposal: ["Proposal sent", "Cadangan dihantar"],
  negotiation: ["Negotiation", "Rundingan"],
  won: ["Won", "Berjaya"],
  lost: ["Lost", "Gagal"],
};
export const LOST_REASONS = ["price", "timing", "competitor", "no_budget", "no_response", "not_fit", "other"] as const;
export const LOST_WORD: Record<(typeof LOST_REASONS)[number], [string, string]> = {
  price: ["Price", "Harga"],
  timing: ["Timing", "Masa"],
  competitor: ["Chose a competitor", "Pilih pesaing"],
  no_budget: ["No budget", "Tiada bajet"],
  no_response: ["No response", "Tiada maklum balas"],
  not_fit: ["Not a fit", "Tidak sesuai"],
  other: ["Other", "Lain-lain"],
};
export const WON_WORD: Record<"acceptance" | "invoice" | "override", [string, string]> = {
  acceptance: ["Won on the customer's acceptance", "Berjaya atas penerimaan pelanggan"],
  invoice: ["Won on its invoice", "Berjaya atas invoisnya"],
  override: ["Won by a manager's decision", "Berjaya atas keputusan pengurus"],
};
export const PRIORITY_WORD: Record<"low" | "normal" | "high", [string, string]> = {
  low: ["Low", "Rendah"], normal: ["Normal", "Biasa"], high: ["High", "Tinggi"],
};
/** decision 5: a deal is Stuck after this many days in one stage with no activity */
export const STUCK_DAYS = 14;

export interface DealQuote { id: number; revision: number; total_cents: number; created_at: string; linked_at: string }
/** Decision 2: a deal's value is counted ONCE - the latest revision total of its most recent
    live linked quotation; the estimate only while no quotation is linked. Never both. */
export function dealValue(est: number | null, quotes: readonly DealQuote[]): { cents: number | null; basis: "quotation" | "estimate" | "none" } {
  if (quotes.length) {
    const latest = [...quotes].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0]!;
    return { cents: latest.total_cents, basis: "quotation" };
  }
  return est === null ? { cents: null, basis: "none" } : { cents: est, basis: "estimate" };
}

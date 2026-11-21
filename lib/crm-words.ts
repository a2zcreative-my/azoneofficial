/* v1.398.0 - LEADS & CRM, the words (Sales Command Center Phase 2; worker/src/crm.ts holds
   the same keys). One place, so the list, the record and the Action Center say the same. */

export const LEAD_SOURCE_WORD: Record<string, [string, string]> = {
  website: ["Website", "Laman web"],
  growth_check: ["Business Growth Check", "Semakan Pertumbuhan Bisnes"],
  agent: ["Agent", "Ejen"],
  referral: ["Referral", "Rujukan"],
  walk_in: ["Walk-in", "Datang sendiri"],
  social: ["Social media", "Media sosial"],
  tiktok: ["TikTok", "TikTok"],
  existing: ["Existing customer", "Pelanggan sedia ada"],
  other: ["Other", "Lain-lain"],
};

/** set by staff, never worked out from invoices (decision 3) */
export const LEAD_STATUS_WORD: Record<string, [string, string]> = {
  new_lead: ["New lead", "Prospek baharu"],
  contacted: ["Contacted", "Telah dihubungi"],
  qualified: ["Qualified", "Layak"],
  customer: ["Customer", "Pelanggan"],
  inactive: ["Inactive", "Tidak aktif"],
  disqualified: ["Disqualified", "Tidak layak"],
};
export type LeadTone = "info" | "gold" | "success" | "neutral" | "danger";
export const LEAD_STATUS_TONE: Record<string, LeadTone> = {
  new_lead: "info", contacted: "info", qualified: "gold", customer: "success", inactive: "neutral", disqualified: "danger",
};
/** a status that ends the work on a lead needs a reason (the server checks the same) */
export const STATUS_NEEDS_REASON = new Set(["inactive", "disqualified"]);

export const ACTIVITY_WORD: Record<string, [string, string]> = {
  call: ["Call", "Panggilan"],
  whatsapp: ["WhatsApp", "WhatsApp"],
  email: ["Email", "E-mel"],
  meeting: ["Meeting", "Mesyuarat"],
  note: ["Note", "Nota"],
  proposal: ["Proposal", "Cadangan"],
  followup: ["Follow-up closed", "Susulan ditutup"],
};

export const OWNER_EVENT_WORD: Record<string, [string, string]> = {
  assign: ["Assigned", "Ditetapkan"],
  reassign: ["Reassigned", "Ditukar"],
  unassign: ["Owner removed", "Pemilik dibuang"],
  suggestion: ["Suggested owner confirmed", "Pemilik dicadangkan disahkan"],
  convert: ["Owner from the enquiry", "Pemilik daripada pertanyaan"],
};

/** "pkg:12" -> the package's name; "other:words" -> the words */
export function serviceName(key: string, packages: readonly { id: number; name: string }[]): string {
  const m = /^pkg:(\d+)$/.exec(key);
  if (m) return packages.find((p) => p.id === Number(m[1]))?.name ?? `#${m[1]}`;
  return key.startsWith("other:") ? key.slice(6) : key;
}

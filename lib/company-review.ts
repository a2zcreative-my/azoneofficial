import { AZ_ONE, A2Z_CREATIVE } from "./issuers";

export const COMPANY_CODES = ["azoo", "a2z"] as const;
export type CompanyCode = (typeof COMPANY_CODES)[number];
export const COMPANY_NAMES: Record<CompanyCode, string> = {
  azoo: AZ_ONE.name,
  a2z: A2Z_CREATIVE.name,
};

export const REVIEW_KINDS = {
  expenses: { en: "Expenses", ms: "Perbelanjaan", tab: "Finance" },
  purchase_orders: { en: "Purchase orders", ms: "Pesanan belian", tab: "Purchasing" },
  bank_accounts: { en: "Bank accounts", ms: "Akaun bank", tab: "Finance" },
  cashflow_entries: { en: "Bank movements", ms: "Pergerakan bank", tab: "Finance" },
  reconciliations: { en: "Reconciliations", ms: "Penyesuaian", tab: "Reconciliation" },
  inventory_items: { en: "Stock items", ms: "Item stok", tab: "Inventory" },
  manual_stockouts: { en: "Stock movements", ms: "Pergerakan stok", tab: "Inventory" },
  stock_ledger: { en: "Stock ledger", ms: "Lejar stok", tab: "Inventory" },
  journal_entries: { en: "Journal entries", ms: "Catatan jurnal", tab: "Accounting" },
} as const;
export type ReviewKind = keyof typeof REVIEW_KINDS;
export type ReviewState = "unassigned" | "proposed" | "deferred" | "stale";
export interface ReviewDecision {
  proposed_company: CompanyCode | null;
  reason: string;
  version: number;
  reviewed_at: string;
  reviewed_by_name: string | null;
  source_json: string;
}
export interface ReviewRecord {
  id: number;
  title: string;
  date: string | null;
  amount_cents: number | null;
  quantity: number | null;
  state: ReviewState;
  decision: ReviewDecision | null;
}
export interface ReviewDetail extends ReviewRecord {
  kind: ReviewKind;
  snapshot: string;
  source: Record<string, unknown>;
  related: { kind: ReviewKind; id: number; title: string; proposed_company: CompanyCode | null; stale: boolean }[];
  related_truncated: boolean;
  history: { actor_name: string | null; created_at: string; after_json: string }[];
}
export interface CompanyMembership { company_code: CompanyCode; access_mode: "read" | "write" }
export interface CompanyStaffSetup {
  id: number;
  name: string;
  role: string;
  is_active: number;
  employer_code: CompanyCode | null;
  memberships: CompanyMembership[];
  version: number;
}
export function isCompanyCode(value: unknown): value is CompanyCode {
  return value === "azoo" || value === "a2z";
}

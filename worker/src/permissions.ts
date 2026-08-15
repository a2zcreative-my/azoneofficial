export type Role =
  | "super_admin" | "admin"
  | "editor" | "marketing" | "live_host"
  | "hr_admin" | "sales_marketing"
  | "ceo" | "coo" | "cco"
  | "customer";

export const PERMS: Record<string, readonly Role[]> = {
  // === index.ts ===
  content_manage: ["super_admin", "admin"],
  enquiry_manage: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
  sync_manage: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],

  // === staff.ts ===
  hr_manage: ["super_admin", "admin", "hr_admin", "ceo"],
  team_manage: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"],
  events_manage: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"],
  claims_submit: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco", "sales_marketing", "editor", "marketing", "live_host"],
  claims_decide: ["super_admin", "ceo"],
  revenue_view: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
  expenses: ["super_admin", "admin", "ceo", "coo"],
  sales: ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"],
  finance: ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"],
  task_reports: ["super_admin", "admin", "hr_admin", "coo", "cco"],
  inventory: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
  task_view: ["super_admin", "admin", "coo", "cco"],
  payroll_export: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"],
  exec_view: ["super_admin", "admin", "ceo", "coo", "cco"],

  // === erp.ts (v1.18.0 — programme phases 4–7). The client's TAB_ROLES
  // mirrors these; this matrix is the one that is actually enforced. ===
  orders_manage: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing"],
  cashflow_manage: ["super_admin", "admin", "ceo", "coo"],
  reconcile_manage: ["super_admin", "admin", "ceo", "coo", "sales_marketing"],
  commission_view: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"],
  commission_decide: ["super_admin", "ceo"],
  adsfund_manage: ["super_admin", "admin", "ceo", "coo"],
  adsfund_claim: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing"],
  purchasing_manage: ["super_admin", "admin", "ceo", "coo"],
  accounting_manage: ["super_admin", "admin", "ceo"],
};

export function can(role: Role | string | undefined | null, perm: keyof typeof PERMS): boolean {
  if (!role) return false;
  return PERMS[perm]!.includes(role as Role);
}

// Privileged roles that must have 2FA enabled.
// v1.5.0: cco added — it holds team_manage / payroll_export / exec_view /
// finance (strictly more than hr_admin, which was already on the list);
// leaving it off was a transposition oversight.
export const MANDATORY_2FA_ROLES: Role[] = ["ceo", "super_admin", "admin", "coo", "cco", "hr_admin"];

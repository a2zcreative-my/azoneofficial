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
};

export function can(role: Role | string | undefined | null, perm: keyof typeof PERMS): boolean {
  if (!role) return false;
  return PERMS[perm]!.includes(role as Role);
}

// Privileged roles that must have 2FA enabled
export const MANDATORY_2FA_ROLES: Role[] = ["ceo", "super_admin", "admin", "coo", "hr_admin"];

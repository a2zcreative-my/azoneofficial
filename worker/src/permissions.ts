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
  task_reports: ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo"], // v1.40.0 (AUDIT M14): the HR tab is visible to the CEO, whose submitted report was silently 403d
  inventory: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
  task_view: ["super_admin", "admin", "coo", "cco"],
  payroll_export: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"],
  exec_view: ["super_admin", "admin", "ceo", "coo", "cco"],
  /* v1.62.0 (CEO: "I as CEO can change or update their leave entitle to all
     the staff so that I can control their Annual Leave entitlement which is
     no abuse!") — how many days a person is owed is the CEO's decision, not
     an HR data-entry field. Deliberately NARROWER than hr_manage: hr_admin
     and admin process leave and see balances, but cannot raise anyone's
     entitlement, including their own. Every change is written to audit_log
     with the old and new figure. */
  leave_entitlement: ["super_admin", "ceo"],

  /* v1.72.0 (CEO: "I want to have an option for me to delete which is roles
     CEO only to have this fuction access") — deleting a task destroys its
     scope, its comments, its acknowledgement and the days already booked
     for it on the roster. Everything else about a task is recoverable;
     this is not, so it sits with claims_decide and leave_entitlement in the
     narrow set that only the CEO holds. Managers still close, reassign and
     edit a task - which is what "this is finished" or "this was wrong"
     usually means. */
  task_delete: ["super_admin", "ceo"],
  /* v1.72.0 — recording an unpaid day is a pay decision, not attendance
     data entry: it removes one twenty-sixth of a month wage. Same reasoning
     as claims_decide. Admin and hr_admin keep every other correction on the
     Attendance tab. */
  unpaid_leave: ["super_admin", "ceo"],
  /* v1.91.0 (CEO: "Staff attendance — corrections & back-entry I want hr
     admin has access on it which is ceo, coo, cco and hr admin has this
     authorized to access") — adding a missed punch, moving a wrong one,
     removing a duplicate, and reading anyone's register to do it. It was
     CEO + admin tier since v1.4.28. Still NOT unpaid days (unpaid_leave)
     or approving a forgotten punch: those create or remove pay and stay
     with the CEO. */
  attendance_correct: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"],

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

  // === threads.ts (v1.89.0 — the Threads workspace). The client's
  // TAB_ROLES.Threads mirrors threads_view. Connecting, syncing and
  // disconnecting an account is handling a credential, so it sits with the
  // management tier that authorises TikTok Shop.
  threads_view: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "editor"],
  threads_manage: ["super_admin", "admin", "ceo", "coo"],

  /* === hotels.ts (v1.100.0 — the hotel directory). CEO, 05-09-2026:
     "Tabs only visible for ceo, cco, coo, hr_admin, super admin, admin".
     The list is a sales asset — 442 hotels with named people, their mobiles
     and their emails — so seeing it and changing it are the SAME tier here;
     there is no reading-only audience the CEO named. The client's
     TAB_ROLES.Hotels mirrors hotels_view. */
  hotels_view: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"],
  hotels_manage: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"],

  /* === the organisation chart (v1.101.0). CEO, 05-09-2026: "I want to add
     infographic for each staff reported to who which is either CEO, COO or
     CCO. I will assigned by myself and organized it based on who is their
     HOD to make it like organisation."

     Deliberately NARROWER than hr_manage, and deliberately without admin and
     super_admin: who a person answers to is a statement about how the company
     is run, and the CEO said he assigns it himself. He named the three who
     may - the same three the lines terminate at. hr_admin fills in records;
     it does not decide reporting lines. Everyone who can already see the
     Staff tab SEES the chart, because a chart nobody may look at organises
     nothing. Every change is audited with both names. */
  org_assign: ["ceo", "coo", "cco"],
};

export function can(role: Role | string | undefined | null, perm: keyof typeof PERMS): boolean {
  if (!role) return false;
  return PERMS[perm]!.includes(role as Role);
}

// Roles that must have 2FA enabled.
// v1.5.0: cco added — it holds team_manage / payroll_export / exec_view /
// finance (strictly more than hr_admin, which was already on the list);
// leaving it off was a transposition oversight.
// v1.23.1 (CEO decision): EVERY staff role — the portal holds attendance,
// payroll and inventory, so "staff flow" means 2FA for all of it, whether
// they sign in with a password or with Google. Customers stay exempt.
export const MANDATORY_2FA_ROLES: Role[] = [
  "ceo", "super_admin", "admin", "coo", "cco", "hr_admin",
  "editor", "marketing", "sales_marketing", "live_host",
];

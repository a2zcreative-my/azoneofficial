export type Role =
  | "super_admin" | "admin"
  | "editor" | "marketing" | "live_host"
  | "hr_admin" | "sales_marketing"
  | "ceo" | "coo" | "cco"
  | "customer";

export const PERMS: Record<string, readonly Role[]> = {
  company_review: ["super_admin", "ceo"],
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
  /* v1.231.0 - the owner, 30-10-2026: master sales packages (create, edit,
     re-price, archive) are CEO, COO, CCO and super admin. Everybody with
     "sales" reads the active ones and applies them to a quotation. Must stay
     equal to PACKAGE_MANAGE_ROLES in lib/packages.ts (tests/sales-packages.mjs). */
  packages_manage: ["super_admin", "ceo", "coo", "cco"],
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
  /* v1.219.0 - Finance 2.0 corrections (cashbook.ts): reverse a movement,
     say which account it went through, mark an exception reviewed, set an
     opening balance. NARROWER than cashflow_manage, never wider: the CEO, the
     COO and super admin (the Finance audit, 28-10-2026). Nobody gains access
     they did not have. */
  cashbook_correct: ["super_admin", "ceo", "coo"],
  /* v1.224.0 (the owner, 29-10-2026, Commission brief: "Only CEO/COO/admins
     mark paid"). Saying an invoice's money arrived - mark paid, unpaid or
     overdue, create it already paid, record or void a part payment - is
     NARROWER than `finance`: the CCO, sales consultants and HR admin keep
     reading invoices and their payments but no longer change them. The CEO
     or COO's Confirm Paid (staff.ts CONFIRM_PAID_ROLES) stays a second,
     separate step. */
  /* v1.234.0 - the owner, 30-10-2026 (claude/USERS-ACCESS-AUDIT.md, "CEO,
     COO, Super Admin only"): the system Admin account no longer says money
     arrived. Narrower, never wider. Refunds and credit notes keep their
     own door below (credit_refund), unchanged. */
  invoice_payment: ["super_admin", "ceo", "coo"],
  /* v1.234.0 - refunds and credit notes were behind invoice_payment; they
     keep exactly the roles they had (nobody gains or loses them here). */
  credit_refund: ["super_admin", "admin", "ceo", "coo"],
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
  /* v1.174.0 (CEO, 21-09-2026: "I want to add Roles and Responsibilities of
     the staff that currently working for me. I need to make sure that I can
     edit the roles and responsibilities in staff tabs") - who may write a
     person's role title and responsibilities. The CEO chose the HR tier:
     the same four roles as hr_manage, so whoever maintains the record can
     write what the person is answerable for. Its own name, not hr_manage,
     because it is its own door (PUT /users/:id/responsibilities, no
     fill-once lock - a job description is meant to change) and so a later
     narrowing does not have to touch every other staff field. NOT coo / cco:
     they read; they set reporting lines (org_assign), not duties. */
  responsibilities_edit: ["super_admin", "admin", "hr_admin", "ceo"],

  /* === the role on the staff record (v1.157.0). CEO, 13-09-2026, on Nurul's
     record: "I want to have a roles assigned for me to assigned her role.
     this is only visible for CEO and COO to update the roles."

     The v1.4.157 rule ("ONLY the super_admin may change roles") stands for
     every tier it was written to protect: ceo, coo, cco, customer and the
     admin tier can still only be set - or touched - by the super_admin. What
     the CEO and COO get is the WORKING roles: editor, marketing, live_host,
     hr_admin and sales_marketing - the ones that decide which tabs a person
     sees and whether the Sales Performance register measures them. Staff
     accounts only, never their own, and every change is audited with the
     old role, the new role and who made it. Not the CCO: the CEO named two. */
  role_assign: ["ceo", "coo"],

  /* === sales-performance.ts (v1.155.0 - the Sales Performance register).
     CEO, 11-09-2026: one page that answers whether a staff member actually
     worked on sales today - "no evidence means no automatic KPI credit".

       sales_perf_view    - open the page, submit OWN evidence (posts,
                            engagements, promotions, other activities,
                            shipments, the daily closing) and read own
                            figures. The selling roles - sales_marketing
                            and live_host (full or part time) - plus the
                            management tier below, who open it to verify. TAB_ROLES["Sales Performance"] in
                            lib/portal-tabs.ts mirrors THIS list. A person
                            with only this permission sees ONLY their own
                            rows; the handler filters by user id server-side.
                            The CEO, 12-09-2026: "Admin, Editor, ceo, coo,
                            cco doest not relate to this sales performance"
                            and "marketing should not perform any sales" -
                            editor and marketing are OFF the tab, and
                            ceo/coo/cco/admin open it without being measured
                            (worker MEASURED_ROLES is the register).
       sales_perf_manage  - verify or reject evidence, correct a verified
                            record (reason required, diff audited), keep the
                            approved-accounts list, set targets, and read
                            every staff member. Management only - and even
                            a manager may NOT verify their own submission;
                            the handler refuses that regardless of role. */
  sales_perf_view: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "live_host"],
  sales_perf_manage: ["super_admin", "admin", "ceo", "coo", "cco"],

  /* === hankeis.ts (v1.163.0) - Hankei's ordering and MANUAL payment
     verification. There is no bank API: a person opens Maybank, finds the
     transaction and allocates it. So the permission that matters is
     hankeis_verify, and it is deliberately NARROW.

       hankeis_view     - the section at all: dashboard, orders, customers.
       hankeis_orders   - sales and support: raise and amend an order, quote
                          shipping, ask a customer for clarification, reject
                          a receipt as unusable evidence. NOT verify.
       hankeis_verify   - finance: allocate a bank transaction and mark a
                          payment verified; correct an extraction; resolve an
                          exception; request and confirm a refund. This is the
                          only permission that can move money-state forward,
                          and no integration credential can ever hold it -
                          the API surface it would need does not exist.
       hankeis_fulfil   - packing: see eligible orders and record a shipment.
                          Gated on payment_state='verified' in code as well.
       hankeis_settings - owner: the QR, the recipient name, the receiving
                          account, prices, packages, integration credentials.
                          Changing a payment DESTINATION is audited and the
                          other officers are notified. */
  hankeis_view: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing"],
  hankeis_orders: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing"],
  hankeis_verify: ["super_admin", "admin", "ceo", "coo"],
  hankeis_fulfil: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing"],
  hankeis_settings: ["super_admin", "ceo"],
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

/* ------------------------------------------------------------------ */
/* v1.234.0 - THE ACCESS POLICY, PUBLISHED (the owner, 30-10-2026:
   "ONE AUTHORIZATION SOURCE. ONE ROLE PERMISSION MANAGEMENT INTERFACE";
   claude/USERS-ACCESS-AUDIT.md). This is NOT a second definition: each row
   names a capability above (`cap`) or one of the named role lists the
   handlers themselves use (`list`, resolved in staff.ts from the very
   constants they check - CONFIRM_PAID_ROLES, PAYROLL_RELEASE_ROLES, ...).
   GET /staff/access/policy reads it; nothing here grants anything, and an
   action is changed only by changing the code that enforces it.
   tests/access-policy.mjs holds every row to a real constant. */
export type PolicyList =
  | "CONFIRM_PAID" | "PAYROLL_PROCESS" | "PAYROLL_RELEASE" | "BANK_RUN"
  | "COMMISSION_VIEW_ALL" | "COMMISSION_DRAFT" | "COMMISSION_APPROVE" | "COMMISSION_DECIDE"
  | "GEOFENCE" | "ROLE_ANY" | "TAB_ACCESS_EDIT";
export interface PolicyAction {
  module: string; key: string; en: string; ms: string;
  cap?: keyof typeof PERMS; list?: PolicyList;
  note_en?: string; note_ms?: string;
}
export const ACTION_CATALOGUE: readonly PolicyAction[] = [
  { module: "Sales", key: "sales_view", en: "View quotations, invoices and orders", ms: "Lihat sebut harga, invois dan pesanan", cap: "sales" },
  { module: "Sales", key: "packages", en: "Manage sales packages", ms: "Urus pakej jualan", cap: "packages_manage" },
  { module: "Sales", key: "mark_paid", en: "Mark paid / record part payments", ms: "Tanda dibayar / rekod bayaran sebahagian", cap: "invoice_payment" },
  { module: "Sales", key: "confirm_paid", en: "Confirm Paid", ms: "Sahkan Dibayar", list: "CONFIRM_PAID", note_en: "Never on their own sale", note_ms: "Tidak pada jualan sendiri" },
  { module: "Sales", key: "credit_refund", en: "Credit notes and refunds", ms: "Nota kredit dan bayaran balik", cap: "credit_refund" },
  { module: "Finance", key: "expenses", en: "View and record expenses", ms: "Lihat dan rekod perbelanjaan", cap: "expenses" },
  { module: "Finance", key: "cashflow", en: "Manage cash flow", ms: "Urus aliran tunai", cap: "cashflow_manage" },
  { module: "Finance", key: "cashbook_correct", en: "Correct the cash book", ms: "Betulkan buku tunai", cap: "cashbook_correct" },
  { module: "Finance", key: "bank_run", en: "Record the payroll bank run", ms: "Rekod pembayaran gaji bank", list: "BANK_RUN" },
  { module: "Accounting", key: "accounting", en: "View and post the ledger", ms: "Lihat dan catat lejar", cap: "accounting_manage" },
  { module: "Payroll", key: "payroll_process", en: "View and process payroll", ms: "Lihat dan proses gaji", list: "PAYROLL_PROCESS" },
  { module: "Payroll", key: "payroll_release", en: "Release payslips", ms: "Keluarkan slip gaji", list: "PAYROLL_RELEASE" },
  { module: "Payroll", key: "payroll_export", en: "Export payroll", ms: "Eksport gaji", cap: "payroll_export" },
  { module: "Commission", key: "commission_all", en: "See everyone's commission", ms: "Lihat komisen semua", list: "COMMISSION_VIEW_ALL", note_en: "Sales staff see their own", note_ms: "Jurujual melihat milik sendiri" },
  { module: "Commission", key: "commission_draft", en: "Draft a commission policy", ms: "Draf polisi komisen", list: "COMMISSION_DRAFT" },
  { module: "Commission", key: "commission_approve", en: "Approve a commission policy", ms: "Luluskan polisi komisen", list: "COMMISSION_APPROVE" },
  { module: "Commission", key: "commission_decide", en: "Decide reviews, settle leavers, payroll switch", ms: "Putuskan semakan, selesaikan bekas staf, suis gaji", list: "COMMISSION_DECIDE" },
  { module: "Claims", key: "claims_submit", en: "Submit claims", ms: "Hantar tuntutan", cap: "claims_submit" },
  { module: "Claims", key: "claims_decide", en: "Approve claims", ms: "Luluskan tuntutan", cap: "claims_decide" },
  { module: "Leave", key: "leave_entitlement", en: "Set leave entitlement", ms: "Tetapkan kelayakan cuti", cap: "leave_entitlement" },
  { module: "Leave", key: "unpaid_leave", en: "Record unpaid days", ms: "Rekod hari tanpa gaji", cap: "unpaid_leave" },
  { module: "Attendance", key: "attendance_correct", en: "Correct attendance records", ms: "Betulkan rekod kehadiran", cap: "attendance_correct" },
  { module: "Attendance", key: "geofence", en: "Set the office geofence", ms: "Tetapkan geofence pejabat", list: "GEOFENCE" },
  { module: "Tasks", key: "task_reports", en: "Read task reports", ms: "Baca laporan tugasan", cap: "task_reports" },
  { module: "Tasks", key: "task_delete", en: "Delete a task", ms: "Padam tugasan", cap: "task_delete" },
  { module: "Staff Details", key: "hr_manage", en: "Manage staff records", ms: "Urus rekod kakitangan", cap: "hr_manage" },
  { module: "Staff Details", key: "org_assign", en: "Set reporting lines", ms: "Tetapkan garis pelaporan", cap: "org_assign" },
  { module: "Staff Details", key: "role_assign", en: "Change working roles", ms: "Tukar peranan kerja", cap: "role_assign" },
  { module: "Staff Details", key: "responsibilities", en: "Write roles and responsibilities", ms: "Tulis peranan dan tanggungjawab", cap: "responsibilities_edit" },
  { module: "Inventory", key: "inventory", en: "Manage inventory", ms: "Urus inventori", cap: "inventory" },
  { module: "Ecommerce", key: "orders", en: "Manage orders", ms: "Urus pesanan", cap: "orders_manage" },
  { module: "Hotels", key: "hotels", en: "Manage the hotel directory", ms: "Urus direktori hotel", cap: "hotels_manage" },
  { module: "Companies", key: "company_review", en: "Review company ownership", ms: "Semak pemilikan syarikat", cap: "company_review" },
  { module: "Users", key: "role_any", en: "Assign any role (executives, customers)", ms: "Tetapkan sebarang peranan (eksekutif, pelanggan)", list: "ROLE_ANY", note_en: "Admin-tier accounts only in /admin", note_ms: "Akaun pentadbir hanya di /admin" },
  { module: "Users", key: "tab_access", en: "Edit tab visibility and exceptions", ms: "Sunting keterlihatan tab dan pengecualian", list: "TAB_ACCESS_EDIT" },
];
/** The roles the policy view shows, in company order. Customers are never
    staff and hold none of these. */
export const POLICY_ROLES: readonly Role[] = ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host", "admin", "super_admin"];

export type Role =
  | "super_admin" | "admin"
  | "editor" | "marketing" | "live_host"
  | "hr_admin" | "sales_marketing"
  | "ceo" | "coo" | "cco"
  | "customer"
  /* v1.249.0 - an Agent helps the sales team win clients: their own tasks, the
     active packages, their own package requests - nothing else (0164) */
  | "agent";

export const PERMS: Record<string, readonly Role[]> = {
  /* v1.249.0 - the Agent role (claude/TASK-UPDATES-AGENT-AUDIT.md, approved 01-11-2026) */
  agent_portal: ["agent"],
  agent_requests_view: ["super_admin", "ceo", "coo", "cco", "sales_marketing"],
  agent_requests_manage: ["super_admin", "ceo", "coo", "cco"],
  /* v1.249.0 - the CEO writes to staff about their tasks; COO and CCO read the log (task_reports) */
  task_mail_send: ["super_admin", "ceo"],
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
  /* v1.239.0 - set weekly sales targets and goals, review recovery plans (was
     the inline WEEK_TARGET_ROLES list in weekly-sales.ts; now a matrix cell) */
  sales_week_target: ["super_admin", "ceo", "coo"],
  finance: ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"],
  task_reports: ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo"], // v1.40.0 (AUDIT M14): the HR tab is visible to the CEO, whose submitted report was silently 403d
  inventory: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
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
  /* v1.245.0 - Project Workspace (the owner, 31-10-2026; claude/PROJECT-
     WORKSPACE-AUDIT.md, decisions P-1 to P-6). Seeing a project's shared
     fields is every staff role (never a customer); managing any project is
     CEO, COO, CCO; naming the Project Owner and confirming Completed are CEO
     and COO (P-2, P-3). The Project Owner and the assigned team get their
     rights per project from the database (worker/src/projects.ts), not from
     a role. None of these reaches invoice Paid, payroll or commission. */
  project_view: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "editor", "live_host"],
  project_manage: ["super_admin", "ceo", "coo", "cco"],
  project_owner_assign: ["super_admin", "ceo", "coo"],
  project_complete: ["super_admin", "ceo", "coo"],
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
  /* v1.235.0 - the owner, 30-10-2026 (claude/ELFIA-STORE-AUDIT.md: "CEO,
     COO, Super Admin only"): what the LIVE ELFIA shop charges or shows -
     publish/unpublish, web price, discount, bulk discount/price, flash sale
     and "Update the shop now". Descriptions, collections and photos stay
     with `inventory` ("Yes, they keep content"). */
  elfia_publish: ["super_admin", "ceo", "coo"],
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

  /* === v1.236.0 - THE COMPANY OWNER (the owner, 30-10-2026, "CEO = FULL
     AUTHORIZED COMPANY ADMINISTRATIVE ACCESS. SUPER ADMIN = TECHNICAL /
     RECOVERY ADMINISTRATION."; claude/CEO-OWNER-ACCESS-AUDIT.md). These were
     rank checks against the super admin (ROLE_RANK 4) that no permission could
     name, so the policy matrix could not show them and the CEO, who shares
     rank 3 with the Admin account, could never pass them. Each is now a
     named capability. The ROLE lists stay super admin only: the verified
     company owner holds the three in OWNER_GRANTS below, through allows(),
     never through the ceo role - a second CEO-role account gains nothing. */
  /** create, edit, reset the password of, offboard or sign out a COO, CCO or Admin account */
  exec_accounts: ["super_admin"],
  /** assign or revoke the COO, CCO and customer roles (was the ROLE_ANY literal) */
  role_any: ["super_admin"],
  /** grant or revoke the technical Admin role (company email required) */
  tech_admin_grant: ["super_admin"],
  /** download the database backup - it holds password hashes and 2FA secrets */
  backup_download: ["super_admin"],
  /** name, change or clear the company owner - the recovery procedure */
  owner_designate: ["super_admin"],
  /** v1.249.2 (the owner, 01-11-2026: "for CEO I want in the user I can update
      roles like super_admin in /admin ... Only me as CEO can do this with
      Super_Admin"; asked, he chose Super Admin AND CEO) - give or take the
      Super Admin and CEO roles. The super admin by role, the verified company
      owner by OWNER_GRANTS; a locked cell, so no matrix edit hands it to
      anyone else. Code + reason, never on your own account. */
  role_top: ["super_admin"],
  /** read the full system audit log (was atLeast(user, "admin") - the same three roles) */
  audit_read: ["super_admin", "admin", "ceo"],

  /* === v1.237.0 - THE NAMED LISTS, NOW PERMISSIONS (the owner, 31-10-2026:
     the Roles & Permissions matrix "require to be editable for me as a CEO";
     claude/EDITABLE-PERMISSIONS-AUDIT.md). These lived as constants inside
     staff.ts and commission.ts, which no screen could change. Moved here
     with EXACTLY the roles they had, so nothing changes until the owner or
     the super admin edits a cell. */
  /** confirm that a paid invoice's money arrived (never on your own sale - a rule in the route) */
  confirm_paid: ["ceo", "coo"],
  /* === v1.272.0 - SALES PAYMENT VERIFICATION (the CEO, 10-11-2026,
     claude/PAYMENT-VERIFICATION-AUDIT.md P1-P3, all as recommended). Live only
     while the owner's switch (business_settings.payment_verification) is on.
     Report: the COO and CCO on every invoice, any other role given it only
     on invoices where they are the salesperson (a rule in the route).
     Verify: the CEO alone, never a report of their own until another person
     has checked its bank evidence (evidence). */
  /** report a payment received, with its proof */
  payment_report: ["ceo", "coo", "cco", "sales_marketing"],
  /** verify, reject or reverse a reported payment - the only step that makes it money */
  payment_verify: ["ceo"],
  /** check the bank evidence of a payment the verifier reported themselves */
  payment_evidence: ["coo"],
  /* === v1.284.0 - FINANCIAL ADVISORY (the CEO, 11-11-2026, F3 as proposed:
     CEO all; COO decide and criteria; Sales and the CCO their own cases).
     The route also checks the case's own scope: owner, members, or fa_decide. */
  /** open the Financial Advisory module and the cases in your scope */
  fa_view: ["ceo", "coo", "cco", "sales_marketing"],
  /** open cases and record a client's profile, figures, documents and banker feedback */
  fa_edit: ["ceo", "coo", "cco", "sales_marketing"],
  /** every case; official bank decisions; pre-screen overrides; reassignment */
  fa_decide: ["ceo", "coo", "cco"], // v1.288.0 - the CCO reviews too (the CEO, decision D1 of DSR blueprint v1.2)
  /** verify and publish bank criteria; manage banker relations */
  fa_criteria: ["ceo", "coo"],
  fa_registry: ["ceo", "coo"], // v1.286.0 - add and verify banks, branches and bankers (blueprint v1.1, B9)
  fa_allocate: ["ceo", "coo"], // v1.288.0 - approve a banker allocation (banker blueprint v1.1, B9)
  fa_priority: ["ceo", "coo", "cco"], // v1.299.0 - override a case's priority with a reason (FA 2.0 blueprint, D-6)
  /** view and process payroll (was PAYROLL_PROC) */
  payroll_process: ["super_admin", "admin", "ceo", "coo"],
  /** release payslips (was PAYROLL_RELEASE_ROLES) */
  payroll_release: ["super_admin", "ceo", "coo"],
  /** record the payroll bank run (was BANK_RUN_ROLES) */
  bank_run: ["super_admin", "ceo", "coo"],
  /** see everyone's commission (was commission.ts VIEW_ALL) */
  commission_view_all: ["super_admin", "admin", "ceo", "coo", "cco"],
  /** draft a commission policy (was DRAFT_ROLES) */
  commission_draft: ["super_admin", "ceo", "coo"],
  /** approve a commission policy (was APPROVE_ROLES) */
  commission_approve: ["super_admin", "ceo"],
  /** decide reviews, settle leavers, the payroll switch (was DECIDE_ROLES) */
  commission_settle: ["super_admin", "ceo"],
  /** set the office geofence (was GEOFENCE_ADMIN_ROLES) */
  geofence_admin: ["super_admin", "ceo", "coo"],

  /* === v1.238.0 - ACCOUNT MANAGEMENT AND RECOVERY (the owner, 31-10-2026,
     claude/ACCOUNT-RECOVERY-AUDIT.md: "Owner + Super Admin" - each with an
     authenticator code and a reason). The super admin by role, the verified
     company owner through OWNER_GRANTS; the account itself is still judged
     by canManageAccount (CEO and super admin accounts stay the super
     admin's). */
  /** change a staff member's login email (pending until verified) */
  account_email: ["super_admin"],
  /** reset 2FA (re-enrol), set-password links, suspend or restore, sign out devices, unlink Google, the account's security history */
  account_recovery: ["super_admin"],
};

/* v1.237.0 - THE OWNER'S EDITS, applied INSIDE can() (the owner, 31-10-2026;
   answers: the owner and the super admin edit; no locks; approval chains stay
   fixed). PERMS above is the DEFAULT; system_meta.role_permissions holds the
   cells the owner or the super admin changed, and every one of the server's
   can() checks reads them - there is no second engine and no second list.
   index.ts getSessionUser loads them on every signed-in request
   (setPermissionOverrides); an unreadable record means "no edits". */
let OVERRIDES: Partial<Record<string, readonly Role[]>> = {};
export const POLICY_ROLE_SET: readonly string[] = ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host", "admin", "super_admin"];
/** Keep only real capabilities and staff roles - a customer is never given a staff permission here. */
export function cleanOverrides(raw: unknown): Record<string, Role[]> {
  const out: Record<string, Role[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in PERMS) || !Array.isArray(v)) continue;
    out[k] = [...new Set(v.map(String).filter((r) => POLICY_ROLE_SET.includes(r)))] as Role[];
  }
  return out;
}
/* v1.242.0 (go-live audit A6, the owner's decision D-6 of 31-10-2026) - THREE
   LOCKED CELLS. The matrix stays editable, except: owner_designate and
   backup_download stay super-admin only (naming the owner is the recovery
   procedure; the backup holds password hashes and 2FA secrets), and the
   super admin always keeps exec_view (the one account that can review
   everything cannot be blinded by an edit). Enforced on save AND on read, so
   a record written before this release cannot grant them either. */
export const LOCKED_CELLS: readonly { cap: keyof typeof PERMS; rule: "super_admin_only" | "super_admin_keeps"; why: string }[] = [
  { cap: "owner_designate", rule: "super_admin_only", why: "Naming the owner is the recovery procedure: super admin only, always." },
  { cap: "role_top", rule: "super_admin_only", why: "The Super Admin and CEO roles: the super admin, and the company owner by grant - never anyone else through the matrix." },
  { cap: "backup_download", rule: "super_admin_only", why: "The backup holds password hashes and 2FA secrets: super admin only, always." },
  { cap: "exec_view", rule: "super_admin_keeps", why: "The super admin always keeps the executive view - the one account that reviews everything cannot be blinded." },
];
export function lockedCellViolation(cap: string, roles: readonly string[]): string | null {
  for (const l of LOCKED_CELLS) {
    if (l.cap !== cap) continue;
    if (l.rule === "super_admin_only" && (roles.length !== 1 || roles[0] !== "super_admin")) return l.why;
    if (l.rule === "super_admin_keeps" && !roles.includes("super_admin")) return l.why;
  }
  return null;
}
export function setPermissionOverrides(raw: unknown): void {
  const cleaned = cleanOverrides(raw);
  for (const l of LOCKED_CELLS) {
    const v = cleaned[l.cap];
    if (!v) continue;
    if (l.rule === "super_admin_only") delete cleaned[l.cap]; // the default is super_admin only
    else if (!v.includes("super_admin")) cleaned[l.cap] = [...v, "super_admin"] as Role[];
  }
  OVERRIDES = cleaned;
}
/** The roles that hold a capability right now: the saved edit, else the default. */
export function rolesFor(perm: keyof typeof PERMS): readonly Role[] { return OVERRIDES[perm] ?? PERMS[perm]!; }

/* v1.236.0 - what the VERIFIED COMPANY OWNER holds beyond the ceo role.
   The owner is one account: role ceo, active, 2FA on, and named in
   system_meta.company_owner by a super admin (index.ts getSessionUser sets
   is_owner - nothing a person can type into a profile). The owner's answers:
   "One designated owner"; "Admin role only" (super admin accounts and the
   ceo role stay with the super admin); roles stay code-defined. */
export const OWNER_GRANTS: readonly (keyof typeof PERMS)[] = ["exec_accounts", "role_any", "tech_admin_grant", "account_email", "account_recovery", "role_top"];

/* v1.236.0 - every capability the super admin holds and the CEO does not
   must be in OWNER_GRANTS or here, with the reason, or the build fails
   (tests/owner-coverage.mjs). A new permission is classified once, on
   purpose - the CEO can no longer lose a door by accident. */
export const TECHNICAL_ONLY: Readonly<Record<string, string>> = {
  content_manage: "The website editor and media library in /admin are the content team's console; the owner did not ask for it (30-10-2026).",
  backup_download: "The backup holds password hashes and 2FA secrets - 'Do not automatically expose secret credentials'.",
  owner_designate: "Naming the owner is the recovery procedure; nobody may name themselves.",
};

/** A signed-in actor, as getSessionUser builds it. */
export interface Actor { id?: number; role: Role | string; is_owner?: boolean }

/** THE one authorization decision for a person (not just a role): the role's
    own capabilities, plus OWNER_GRANTS for the verified company owner. */
export function allows(actor: Actor | null | undefined, perm: keyof typeof PERMS): boolean {
  if (!actor) return false;
  if (can(actor.role, perm)) return true;
  return actor.is_owner === true && actor.role === "ceo" && OWNER_GRANTS.includes(perm);
}

export const WORKING_ROLES: readonly string[] = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing"];

/** Which door a role sits behind - to grant it OR to take it away. */
export function roleDoor(r: string): keyof typeof PERMS | "super_only" {
  if (r === "super_admin" || r === "ceo") return "super_only";
  if (r === "admin") return "tech_admin_grant";
  if (r === "coo" || r === "cco" || r === "customer" || r === "agent") return "role_any"; // v1.249.0 - the owner gives and takes the Agent role
  return "role_assign";
}

/** May this actor give someone `role` (or take it from them)? */
export function mayGrant(actor: Actor, role: string): boolean {
  const d = roleDoor(role);
  if (d === "super_only") return allows(actor, "role_top"); // v1.249.2 - the super admin, or the verified owner
  if (d === "role_assign") return actor.role === "super_admin" || allows(actor, "role_assign");
  return allows(actor, d);
}

/** May this actor manage (edit, reset, offboard, sign out) an account holding `role`? */
export function canManageAccount(actor: Actor, role: string): boolean {
  if (role === "super_admin" || role === "ceo") return actor.role === "super_admin";
  if (role === "admin" || role === "coo" || role === "cco") return allows(actor, "exec_accounts");
  return true;
}

export type RoleChange =
  | { ok: true; privileged: boolean }
  | { ok: false; status: 400 | 403; code: string; message: string };

/** v1.236.0 - THE role-change rule, for BOTH doors (/api/v1/users/:id and
    /staff/users/:id/role) - they used to keep a rule each. Privileged =
    an executive, admin or customer role is given or taken. */
export function roleChangeRule(actor: Actor & { id: number }, target: { id: number; role: string }, to: string): RoleChange {
  if (actor.id === target.id) return { ok: false, status: 400, code: "self_change", message: "You can't change your own role - ask another authorised account." };
  for (const r of [target.role, to]) {
    if (mayGrant(actor, r)) continue;
    const d = roleDoor(r);
    return { ok: false, status: 403, code: "forbidden", message:
      d === "super_only" ? (r === "ceo" ? "The CEO role is given or taken only by the company owner or the super admin" : "The Super Admin role is given or taken only by the company owner or the super admin")
      : d === "tech_admin_grant" ? "Only the company owner or the super admin grants or revokes technical admin access"
      : d === "role_any" ? "Executive and customer accounts can only be re-assigned by the company owner or the system super admin"
      : "Only the CEO, the COO or the system super admin can change a staff role - this keeps sign-ups from ever escalating themselves" };
  }
  return { ok: true, privileged: roleDoor(target.role) !== "role_assign" || roleDoor(to) !== "role_assign" };
}

export function can(role: Role | string | undefined | null, perm: keyof typeof PERMS): boolean {
  if (!role) return false;
  return rolesFor(perm).includes(role as Role);
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
  "agent", // v1.249.0 - an agent sees tasks, packages and clients
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
/* v1.237.0 - one list is left: who edits this matrix and the tab matrix.
   It is the editor itself, not a cell, so it cannot be edited away. */
export type PolicyList = "TAB_ACCESS_EDIT";
export interface PolicyAction {
  module: string; key: string; en: string; ms: string;
  cap?: keyof typeof PERMS; list?: PolicyList;
  note_en?: string; note_ms?: string;
  /** v1.236.0 - roles allowed only under a stated rule (shown "Conditional"),
      or seeing their own share only. */
  cond?: Partial<Record<Role, readonly [string, string]>>;
  /** v1.236.0 - roles the action does not apply to by design ("Not applicable"). */
  na?: readonly Role[];
  /** v1.237.0 - the route also checks this capability first: giving the
      action alone is not enough (the matrix review says so). */
  needs?: keyof typeof PERMS;
}
export const ACTION_CATALOGUE: readonly PolicyAction[] = [
  { module: "Sales", key: "sales_view", en: "View quotations, invoices and orders", ms: "Lihat sebut harga, invois dan pesanan", cap: "sales" },
  { module: "Sales", key: "packages", en: "Manage sales packages", ms: "Urus pakej jualan", cap: "packages_manage" },
  { module: "Sales", key: "week_target", en: "Set weekly sales targets and goals; review recovery plans", ms: "Tetapkan sasaran dan matlamat jualan mingguan; semak pelan pemulihan", cap: "sales_week_target", note_en: "A reason for every change; history kept", note_ms: "Sebab bagi setiap perubahan; sejarah disimpan" },
  { module: "Sales", key: "mark_paid", en: "Mark paid / record part payments", ms: "Tanda dibayar / rekod bayaran sebahagian", cap: "invoice_payment" },
  { module: "Sales", key: "confirm_paid", en: "Confirm Paid", ms: "Sahkan Dibayar", cap: "confirm_paid", note_en: "Never on their own sale", note_ms: "Tidak pada jualan sendiri", cond: { ceo: ["Never on their own sale", "Tidak pada jualan sendiri"], coo: ["Never on their own sale", "Tidak pada jualan sendiri"] }, na: ["super_admin", "admin"] },
  { module: "Sales", key: "payment_report", en: "Report a payment received (with proof)", ms: "Lapor bayaran diterima (dengan bukti)", cap: "payment_report", note_en: "Own invoices only, except COO and CCO", note_ms: "Invois sendiri sahaja, kecuali COO dan CCO" },
  { module: "Sales", key: "payment_verify", en: "Verify a reported payment", ms: "Sahkan bayaran yang dilaporkan", cap: "payment_verify", note_en: "The company owner only; his own Paid is final (v1.285.0)", note_ms: "Pemilik syarikat sahaja; tanda dibayar beliau muktamad (v1.285.0)" },
  { module: "Sales", key: "payment_evidence", en: "Check the bank evidence of the verifier's own report", ms: "Semak bukti bank laporan pengesah sendiri", cap: "payment_evidence", note_en: "Not needed since v1.285.0: the CEO's own Paid is final", note_ms: "Tidak diperlukan sejak v1.285.0: tanda dibayar CEO muktamad" },
  { module: "Financial Advisory", key: "fa_view", en: "Open Financial Advisory (own cases)", ms: "Buka Nasihat Kewangan (kes sendiri)", cap: "fa_view" },
  { module: "Financial Advisory", key: "fa_edit", en: "Record client profiles, figures, documents and banker feedback", ms: "Rekod profil, angka, dokumen dan maklum balas bank pelanggan", cap: "fa_edit", note_en: "Own cases only, unless fa_decide", note_ms: "Kes sendiri sahaja, kecuali fa_decide" },
  { module: "Financial Advisory", key: "fa_decide", en: "Every case; management review decisions; official bank decisions; pre-screen overrides", ms: "Semua kes; keputusan semakan pengurusan; keputusan rasmi bank; mengatasi saringan awal", cap: "fa_decide", note_en: "Never on a review they submitted themselves (the owner apart)", note_ms: "Tidak pada semakan yang dihantar sendiri (kecuali pemilik)" },
  { module: "Financial Advisory", key: "fa_criteria", en: "Verify bank criteria", ms: "Sahkan kriteria bank", cap: "fa_criteria" },
  { module: "Financial Advisory", key: "fa_registry", en: "Add and verify banks, branches and bankers", ms: "Tambah dan sahkan bank, cawangan dan pegawai bank", cap: "fa_registry", note_en: "Never a banker they registered themselves (the owner apart)", note_ms: "Tidak pegawai bank yang didaftar sendiri (kecuali pemilik)" },
  { module: "Financial Advisory", key: "fa_allocate", en: "Approve a banker allocation for a case", ms: "Luluskan peruntukan pegawai bank untuk kes", cap: "fa_allocate", note_en: "After a management Proceed; never on an allocation they proposed (the owner apart)", note_ms: "Selepas keputusan Teruskan; tidak pada peruntukan yang dicadang sendiri (kecuali pemilik)" },
  { module: "Financial Advisory", key: "fa_priority", en: "Override a case's priority, with a reason", ms: "Mengatasi keutamaan kes, dengan sebab", cap: "fa_priority", note_en: "The computed priority stays visible beside it; never on a case they own (the owner apart)", note_ms: "Keutamaan dikira kekal kelihatan; tidak pada kes milik sendiri (kecuali pemilik)" },
  { module: "Sales", key: "credit_refund", en: "Credit notes and refunds", ms: "Nota kredit dan bayaran balik", cap: "credit_refund" },
  { module: "Finance", key: "expenses", en: "View and record expenses", ms: "Lihat dan rekod perbelanjaan", cap: "expenses" },
  { module: "Finance", key: "cashflow", en: "Manage cash flow", ms: "Urus aliran tunai", cap: "cashflow_manage" },
  { module: "Finance", key: "cashbook_correct", en: "Correct the cash book", ms: "Betulkan buku tunai", cap: "cashbook_correct" },
  { module: "Finance", key: "bank_run", en: "Record the payroll bank run", ms: "Rekod pembayaran gaji bank", cap: "bank_run", needs: "expenses" },
  { module: "Accounting", key: "accounting", en: "View and post the ledger", ms: "Lihat dan catat lejar", cap: "accounting_manage" },
  { module: "Payroll", key: "payroll_process", en: "View and process payroll", ms: "Lihat dan proses gaji", cap: "payroll_process" },
  { module: "Payroll", key: "payroll_release", en: "Release payslips", ms: "Keluarkan slip gaji", cap: "payroll_release", needs: "payroll_process" },
  { module: "Payroll", key: "payroll_export", en: "Export payroll", ms: "Eksport gaji", cap: "payroll_export" },
  { module: "Commission", key: "commission_all", en: "See everyone's commission", ms: "Lihat komisen semua", cap: "commission_view_all", note_en: "Sales staff see their own", note_ms: "Jurujual melihat milik sendiri", cond: { cco: ["Reviews only - no decisions", "Semak sahaja - tiada keputusan"], sales_marketing: ["Their own entries only", "Entri sendiri sahaja"] } },
  { module: "Commission", key: "commission_draft", en: "Draft a commission policy", ms: "Draf polisi komisen", cap: "commission_draft" },
  { module: "Commission", key: "commission_approve", en: "Approve a commission policy", ms: "Luluskan polisi komisen", cap: "commission_approve" },
  { module: "Commission", key: "commission_decide", en: "Decide reviews, settle leavers, payroll switch", ms: "Putuskan semakan, selesaikan bekas staf, suis gaji", cap: "commission_settle" },
  { module: "Commission", key: "commission_closer", en: "Correct the closer of a sale", ms: "Betulkan penutup jualan", cap: "commission_decide" },
  { module: "Claims", key: "claims_submit", en: "Submit claims", ms: "Hantar tuntutan", cap: "claims_submit" },
  { module: "Claims", key: "claims_decide", en: "Approve claims", ms: "Luluskan tuntutan", cap: "claims_decide" },
  { module: "Leave", key: "leave_entitlement", en: "Set leave entitlement", ms: "Tetapkan kelayakan cuti", cap: "leave_entitlement" },
  { module: "Leave", key: "unpaid_leave", en: "Record unpaid days", ms: "Rekod hari tanpa gaji", cap: "unpaid_leave" },
  { module: "Attendance", key: "attendance_correct", en: "Correct attendance records", ms: "Betulkan rekod kehadiran", cap: "attendance_correct" },
  { module: "Attendance", key: "geofence", en: "Set the office geofence", ms: "Tetapkan geofence pejabat", cap: "geofence_admin" },
  { module: "Tasks", key: "task_mail_send", en: "Send a task update email to staff", ms: "Hantar e-mel kemas kini tugasan kepada kakitangan", cap: "task_mail_send", note_en: "Each person gets their own open tasks; COO and CCO read the log", note_ms: "Setiap orang menerima tugasan terbuka sendiri; COO dan CCO membaca log" },
  { module: "Agents", key: "agent_requests_view", en: "See agents' package requests", ms: "Lihat permintaan pakej ejen", cap: "agent_requests_view" },
  { module: "Agents", key: "agent_requests_manage", en: "Edit agents' requests: status, follow-up person, notes", ms: "Sunting permintaan ejen: status, orang susulan, nota", cap: "agent_requests_manage" },
  { module: "Agents", key: "agent_portal", en: "Agent: own tasks, packages to promote, submit clients", ms: "Ejen: tugasan sendiri, pakej untuk dipromosi, hantar pelanggan", cap: "agent_portal", note_en: "No other module, no staff data", note_ms: "Tiada modul lain, tiada data kakitangan" },
  { module: "Tasks", key: "task_reports", en: "Read task reports", ms: "Baca laporan tugasan", cap: "task_reports" },
  { module: "Tasks", key: "task_delete", en: "Delete a task", ms: "Padam tugasan", cap: "task_delete", note_en: "Never a project task (reassign or complete it)", note_ms: "Bukan tugasan projek (agih semula atau selesaikan)" },
  { module: "Projects", key: "project_view", en: "View shared project information", ms: "Lihat maklumat projek yang dikongsi", cap: "project_view", note_en: "Prices and contact details need more", note_ms: "Harga dan butiran hubungan memerlukan lebih" },
  { module: "Projects", key: "project_manage", en: "Edit any project, assign its tasks, change its status", ms: "Sunting mana-mana projek, agih tugasan, tukar status", cap: "project_manage", note_en: "The Project Owner can for their own project", note_ms: "Pemilik Projek boleh untuk projek sendiri" },
  { module: "Projects", key: "project_owner", en: "Assign or transfer the Project Owner", ms: "Tetapkan atau pindah Pemilik Projek", cap: "project_owner_assign", note_en: "Never changes the closer or commission", note_ms: "Tidak menukar penutup jualan atau komisen" },
  { module: "Projects", key: "project_complete", en: "Confirm a project Completed", ms: "Sahkan projek Selesai", cap: "project_complete", note_en: "The owner requests it", note_ms: "Pemilik memohonnya" },
  { module: "Staff Details", key: "hr_manage", en: "Manage staff records", ms: "Urus rekod kakitangan", cap: "hr_manage" },
  { module: "Staff Details", key: "org_assign", en: "Set reporting lines", ms: "Tetapkan garis pelaporan", cap: "org_assign", na: ["super_admin", "admin"] },
  { module: "Staff Details", key: "role_assign", en: "Change working roles", ms: "Tukar peranan kerja", cap: "role_assign" },
  { module: "Staff Details", key: "responsibilities", en: "Write roles and responsibilities", ms: "Tulis peranan dan tanggungjawab", cap: "responsibilities_edit" },
  { module: "Inventory", key: "inventory", en: "Manage inventory", ms: "Urus inventori", cap: "inventory" },
  { module: "Ecommerce", key: "orders", en: "Manage orders", ms: "Urus pesanan", cap: "orders_manage" },
  { module: "Hotels", key: "hotels", en: "Manage the hotel directory", ms: "Urus direktori hotel", cap: "hotels_manage" },
  { module: "Companies", key: "company_review", en: "Review company ownership", ms: "Semak pemilikan syarikat", cap: "company_review" },
  { module: "ELFIA Store", key: "elfia_publish", en: "Publish, price, discount, bulk changes, Update the shop now", ms: "Terbit, harga, diskaun, perubahan pukal, Kemas kini kedai", cap: "elfia_publish" },
  { module: "ELFIA Store", key: "elfia_content", en: "Descriptions, collections and photos", ms: "Penerangan, koleksi dan foto", cap: "inventory" },
  { module: "Users", key: "role_any", en: "Assign and revoke COO, CCO, Agent and customer roles", ms: "Tetapkan dan tarik balik peranan COO, CCO, Ejen dan pelanggan", cap: "role_any", note_en: "Authenticator code and a reason; never your own", note_ms: "Kod pengesah dan sebab; tidak pada diri sendiri" },
  { module: "Users", key: "role_top", en: "Give and take the Super Admin and CEO roles (/admin > Users)", ms: "Beri dan tarik peranan Super Admin dan CEO (/admin > Pengguna)", cap: "role_top", note_en: "Authenticator code and a reason; never your own; the last super admin with 2FA stays", note_ms: "Kod pengesah dan sebab; tidak pada diri sendiri; super admin terakhir dengan 2FA kekal" },
  { module: "Users", key: "exec_accounts", en: "Create, edit, reset, offboard or sign out COO, CCO and Admin accounts", ms: "Cipta, sunting, set semula, tamatkan atau log keluar akaun COO, CCO dan Admin", cap: "exec_accounts", note_en: "Authenticator code for every change", note_ms: "Kod pengesah untuk setiap perubahan" },
  { module: "Users", key: "tech_admin", en: "Grant or revoke technical Admin access", ms: "Beri atau tarik balik akses Admin teknikal", cap: "tech_admin_grant", note_en: "Company email; authenticator code and a reason", note_ms: "E-mel syarikat; kod pengesah dan sebab" },
  { module: "Users", key: "account_email", en: "Change a staff login email", ms: "Tukar e-mel log masuk kakitangan", cap: "account_email", note_en: "Pending until the new address is verified; same account, history kept", note_ms: "Menunggu sehingga alamat baharu disahkan; akaun sama, sejarah kekal" },
  { module: "Users", key: "account_recovery", en: "Account recovery: reset 2FA, set-password link, suspend, sign out devices", ms: "Pemulihan akaun: set semula 2FA, pautan kata laluan, gantung, log keluar peranti", cap: "account_recovery", note_en: "Authenticator code and a reason; never your own", note_ms: "Kod pengesah dan sebab; tidak pada diri sendiri" },
  { module: "Users", key: "tab_access", en: "Edit tab visibility and exceptions", ms: "Sunting keterlihatan tab dan pengecualian", list: "TAB_ACCESS_EDIT" },
  { module: "System", key: "audit_read", en: "Read the full system audit log", ms: "Baca log audit sistem penuh", cap: "audit_read" },
  { module: "System", key: "owner_designate", en: "Name the company owner; manage Super Admin and CEO accounts (password, sign-in, suspend)", ms: "Namakan pemilik syarikat; urus akaun Super Admin dan CEO (kata laluan, log masuk, gantung)", cap: "owner_designate", note_en: "Recovery procedure", note_ms: "Prosedur pemulihan" },
  { module: "System", key: "backup", en: "Download the database backup", ms: "Muat turun sandaran pangkalan data", cap: "backup_download", note_en: "Holds password hashes and 2FA secrets", note_ms: "Mengandungi cincang kata laluan dan rahsia 2FA" },
];
/** The roles the policy view shows, in company order. Customers are never
    staff and hold none of these. */
export const POLICY_ROLES: readonly Role[] = ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host", "agent", "admin", "super_admin"];

/**
 * THE TAB REGISTRY — one list, v1.79.0.
 *
 * CEO, 31-08-2026: *"🔐 Tab access control should update all the tabs
 * available to make it up-to-date."*
 *
 * He had asked this once before, at v1.21.4, and it was answered by
 * hand-copying the list into the card with a comment saying "keep the two in
 * sync whenever a tab is added or retired". A comment is not a mechanism. By
 * this release the copy had drifted again — the card listed the tabs in a
 * different order from the portal itself, and its DEFAULTS map had the Users
 * tab down as CEO + COO when the portal has allowed `admin` since v1.40.0.
 * So the card confidently displayed a permission the system does not apply.
 *
 * There were FOUR copies of this knowledge: ALL_TABS + TAB_ROLES in
 * page.tsx, TABS + DEFAULTS in tab-access-card.tsx, TAB_ACCESS_TABS in the
 * worker, and TAB_ICON in nav-icons. tests/registry-parity.mjs policed the
 * tab NAMES across them, which is why the names stayed right and the ROLES
 * quietly went wrong — the guard checked the half that was easy to check.
 *
 * Two of those copies are now one. This module is the source: the portal
 * filters its tab strip from it, and the access card renders from it, so the
 * card cannot list a tab that does not exist, miss one that does, show them
 * in a different order, or describe a default the portal will not honour.
 * The worker keeps its own list — it is a separate deployable and must
 * validate input on its own — and the parity guard still holds it to this
 * one.
 */

/** Tab order IS the product. v1.22.0, the CEO's own sequence: the phone
    bottom bar shows the first FOUR tabs a role can see, so this list decides
    every role's thumb row. Do not reorder without asking him. */
export const ALL_TABS = [
  "Dashboard",
  "Attendance",
  "Ecommerce",
  "Inventory",
  "ELFIA Store",
  "Web Orders",
  "ELFIA Traffic",
  "Sales",
  "Announcements",
  "HR",
  "Staff Details",
  "Leave",
  "Claims",
  "Payroll",
  "Finance",
  "Tasks",
  "Content",
  "Reconciliation",
  "Commission",
  "Ads Fund",
  "Purchasing",
  "Accounting",
  "Stokis",
  "Assets",
  "Profile",
  "Users",
] as const;

export type TabName = (typeof ALL_TABS)[number];

/** Home and identity. Never hidden, never overridable — clocking in and
    reading your own payslip are not permissions. */
export const ALWAYS_VISIBLE: readonly string[] = ["Dashboard", "Profile"];

/** Every tab the 🔐 card governs, in the portal's own order. */
export const GOVERNABLE_TABS: readonly TabName[] = ALL_TABS.filter(
  (t) => !ALWAYS_VISIBLE.includes(t),
);

/** The role chips the card offers. super_admin is deliberately absent: it
    bypasses overrides entirely (see `canSeeTab`), and offering a checkbox
    that does nothing is worse than offering none. */
export const ASSIGNABLE_ROLES: readonly [string, string][] = [
  ["admin", "admin"],
  ["ceo", "ceo"],
  ["coo", "coo"],
  ["cco", "cco"],
  ["hr_admin", "hr admin"],
  ["sales_marketing", "sales marketing"],
  ["marketing", "marketing"],
  ["editor", "editor"],
  ["live_host", "live host"],
];

export const SALES_ROLES: readonly string[] = [
  "super_admin",
  "admin",
  "hr_admin",
  "coo",
  "cco",
  "ceo",
  "sales_marketing",
];

/**
 * Built-in defaults. A tab absent from this map is open to every staff role.
 * The API enforces the same matrix — this decides what is DRAWN, never what
 * is allowed: a role granted a tab it has no server permission for sees the
 * tab and gets "access required" on its data (AUDIT M13).
 */
export const TAB_ROLES: Partial<Record<TabName, readonly string[]>> = {
  // HR pipeline: docs (QT/DO/INV), leave, attendance + payroll CSV.
  HR: ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
  Payroll: ["ceo", "coo", "super_admin", "admin"],
  // v1.4.75 / v1.4.106: every staff role claims; the CEO decides.
  Claims: [
    "ceo", "coo", "cco", "hr_admin", "sales_marketing",
    "editor", "marketing", "live_host", "super_admin", "admin",
  ],
  // Company money (v1.4.87): CEO and COO per spec.
  Finance: ["ceo", "coo", "super_admin", "admin"],
  /* v1.79.0 — Sales was the one tab whose default lived OUTSIDE this map, as
     a special case in the filter reading `SALES_ROLES.includes(role) ||
     role === "ceo"`. SALES_ROLES already contains "ceo", so the second half
     had never once changed an answer; it read as though it did, which is
     how a special case earns its keep long after it stops meaning anything.
     Written out as an ordinary entry, it disappears. */
  Sales: SALES_ROLES,
  Inventory: [
    "super_admin", "admin", "ceo", "coo", "cco",
    "sales_marketing", "marketing", "hr_admin",
  ],
  // Employee records: IDs, position, department, staff list, birth dates.
  "Staff Details": ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
  // v1.4.213: asset register — same tier as Staff Details (HR keeps it).
  Assets: ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
  Users: ["super_admin", "admin", "ceo", "coo"], // v1.40.0 (AUDIT M14)
  /* v1.18.0 — ERP modules. These mirror worker/src/permissions.ts; the
     worker matrix is the one actually enforced. */
  /* v1.22.0 (CEO: "without anyone populate or access tabs that not
     authorize for them"): Ecommerce was open to EVERY staff role — the one
     loose default left. Editors and live hosts are out; the tab is the
     revenue/orders view. */
  Ecommerce: [
    "super_admin", "admin", "ceo", "coo", "cco",
    "hr_admin", "sales_marketing", "marketing",
  ],
  /* v1.45.0: runs the ELFIA store catalogue. Same tier as Inventory — its
     routes ARE the inventory routes. */
  "ELFIA Store": [
    "super_admin", "admin", "ceo", "coo", "cco",
    "sales_marketing", "marketing", "hr_admin",
  ],
  // v1.37.0: mirrors the /staff/web-orders check (sales|inventory|exec).
  "Web Orders": [
    "super_admin", "admin", "ceo", "coo", "cco",
    "hr_admin", "sales_marketing", "marketing",
  ],
  // v1.43.0: anonymous visitor map — mirrors revenue_view on /web-traffic.
  "ELFIA Traffic": [
    "super_admin", "admin", "ceo", "coo", "cco",
    "hr_admin", "sales_marketing", "marketing",
  ],
  Reconciliation: ["super_admin", "admin", "ceo", "coo", "sales_marketing"],
  Commission: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"],
  "Ads Fund": [
    "super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing",
  ],
  Purchasing: ["super_admin", "admin", "ceo", "coo"],
  Accounting: ["super_admin", "admin", "ceo"],
  // v1.7.0: Content is open to the team that makes it.
  Content: [
    "super_admin", "admin", "ceo", "coo", "cco", "hr_admin",
    "sales_marketing", "marketing", "editor", "live_host",
  ],
  Stokis: [
    "super_admin", "admin", "ceo", "coo", "cco",
    "hr_admin", "sales_marketing", "marketing",
  ],
};

/** One line saying what a tab is for, shown under its name in the 🔐 card.
    Tabs whose name says it all are absent rather than padded. */
export const TAB_HINTS: Partial<Record<TabName, { en: string; ms: string }>> = {
  Attendance: { en: "punches + roster", ms: "rekod kehadiran + roster" },
  Ecommerce: { en: "TikTok + map", ms: "TikTok + peta" },
  "ELFIA Store": { en: "store catalogue", ms: "katalog kedai" },
  "Web Orders": { en: "ELFIA store orders", ms: "pesanan kedai ELFIA" },
  "ELFIA Traffic": { en: "store visitor map", ms: "peta pelawat kedai" },
  Sales: { en: "enquiries + documents", ms: "pertanyaan + dokumen" },
  Announcements: { en: "feed + publish", ms: "suapan + terbit" },
  HR: { en: "docs, leave admin", ms: "dokumen, pentadbiran cuti" },
  "Staff Details": { en: "records + birthdays", ms: "rekod + hari lahir" },
  Payroll: { en: "salaries — keep tight", ms: "gaji — kawal ketat" },
  Finance: { en: "cash flow + P&L", ms: "aliran tunai + P&L" },
  Content: { en: "production pipeline", ms: "saluran produksi" },
  Reconciliation: { en: "channel settlements", ms: "penyelesaian saluran" },
  Purchasing: { en: "suppliers + POs", ms: "pembekal + PO" },
  Accounting: { en: "GL — keep tight", ms: "GL — kawal ketat" },
  Stokis: { en: "reseller network", ms: "rangkaian pengedar" },
  Assets: { en: "equipment register", ms: "daftar peralatan" },
  Users: { en: "accounts — keep tight", ms: "akaun — kawal ketat" },
};

/** The roles a tab is shown to out of the box. `null` = every staff role. */
export function defaultRolesFor(tab: string): readonly string[] | null {
  return TAB_ROLES[tab as TabName] ?? null;
}

/**
 * THE one visibility rule, used by the portal to build its tab strip and by
 * the 🔐 card to say what a setting means. Both answers come from here, so
 * the card can never describe a rule the portal does not follow.
 *
 * `overrides` is the CEO's saved map from the card; a tab absent from it
 * falls back to the built-in default.
 */
export function canSeeTab(
  role: string | null | undefined,
  tab: string,
  overrides: Record<string, string[]> = {},
): boolean {
  if (!role) return true; // pre-auth render: the strip is skeleton anyway
  if (ALWAYS_VISIBLE.includes(tab)) return true;
  // The escape hatch: an override that locks everyone out (even the CEO)
  // must still leave one account able to undo it.
  if (role === "super_admin") return true;
  const ov = overrides[tab];
  if (ov !== undefined) return ov.includes(role);
  const allowed = defaultRolesFor(tab);
  return !allowed || allowed.includes(role);
}

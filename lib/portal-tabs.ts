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
    every role's thumb row. Do not reorder without asking him.
 *
 *  v1.102.0 - he re-sorted it himself, 05-09-2026, writing the whole list out
 *  in the order he wants to read it. It now runs: home, then what the company
 *  SELLS (Ecommerce through Threads), then the ELFIA store's own three, then
 *  the PEOPLE stack, then the MONEY stack, then your own account. The two
 *  names in his list that are not the keys below - "News" and "Staff" - are
 *  what these two tabs have DISPLAYED since lib/i18n.ts got its DICT: the
 *  long keys are internal and renaming them would only orphan the tab-access
 *  overrides saved under them, for no visible gain.
 *
 *  components/layout/side-nav.tsx cuts this same sequence into labelled
 *  sections without resequencing it, so the desktop rail and the phone bar
 *  read in one order. */
export const ALL_TABS = [
  "Dashboard",
  "Ecommerce",
  "Inventory",
  "Sales",
  "Assets",
  "Hotels",
  "Threads",
  "ELFIA Store",
  "Web Orders",
  "ELFIA Traffic",
  "HR",
  "Attendance",
  "Tasks",
  "Announcements",
  "Staff Details",
  "Leave",
  "Claims",
  "Payroll",
  "Finance",
  "Reconciliation",
  "Commission",
  "Ads Fund",
  "Purchasing",
  "Accounting",
  "Profile",
  "Users",
  "Stokis",
  "Content",
] as const;

export type TabName = (typeof ALL_TABS)[number];

/** Home and identity. Never hidden, never overridable — clocking in and
    reading your own payslip are not permissions. */
export const ALWAYS_VISIBLE: readonly string[] = ["Dashboard", "Profile"];

/**
 * PARKED — built, kept, and shown to nobody.
 *
 * CEO, 05-09-2026, at the end of his tab list: *"Stokis - inactive this for
 * future usage. Content - inactive this for future usage."*
 *
 * Not deleted, because both are finished features he intends to switch on;
 * deleting them would mean writing them twice. Not merely unticked in the 🔐
 * card either, because an unticked tab is one press from being on and its
 * defaults are still sitting in TAB_ROLES below, ready to reappear the day
 * somebody resets an override.
 *
 * So this is a rail, in the same place as the other two: `canSeeTab` answers
 * NO for a parked tab before it consults an override, a person's own grant,
 * or the super_admin bypass. Nobody sees them, nobody can be given them, and
 * the worker's whitelist drops them so the API refuses to grant one either.
 * Their panels, routes, roles and hints all stay exactly where they are -
 * un-parking is deleting a name from this list.
 */
export const PARKED_TABS: readonly string[] = ["Stokis", "Content"];

/** Every tab the 🔐 card governs, in the portal's own order. A parked tab is
    not offered: a checkbox that cannot change what anyone sees is worse than
    no checkbox. */
export const GOVERNABLE_TABS: readonly TabName[] = ALL_TABS.filter(
  (t) => !ALWAYS_VISIBLE.includes(t) && !PARKED_TABS.includes(t),
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
  /* v1.89.0 — the Threads workspace. Mirrors threads_view in
     worker/src/permissions.ts; connecting an account is threads_manage
     (management tier) and is gated inside the tab, not here. */
  Threads: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "editor"],
  /* v1.100.0 (CEO: "Tabs only visible for ceo, cco, coo, hr_admin, super
     admin, admin") — the hotel directory. Mirrors hotels_view in
     worker/src/permissions.ts, which is the matrix actually enforced. */
  Hotels: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"],
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
  Threads: { en: "posts + insights", ms: "hantaran + analisis" },
  Hotels: { en: "sales list by state", ms: "senarai jualan ikut negeri" },
  Reconciliation: { en: "channel settlements", ms: "penyelesaian saluran" },
  Purchasing: { en: "suppliers + POs", ms: "pembekal + PO" },
  Accounting: { en: "GL — keep tight", ms: "GL — kawal ketat" },
  /* v1.102.0 - Content and Stokis are PARKED, not gone. Their hints stay so
     that un-parking is one deletion from PARKED_TABS and nothing else. */
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
  person: PersonAccess | null = null,
): boolean {
  if (!role) return true; // pre-auth render: the strip is skeleton anyway
  if (ALWAYS_VISIBLE.includes(tab)) return true;
  /* v1.102.0 - the parked rail, and it sits ABOVE the super_admin bypass on
     purpose. A tab the CEO has taken off the product should not still be
     there for one account: that is how a half-finished feature gets used and
     becomes a support question. It also sits above the override and the
     per-person grant, so a stale row in system_meta naming a parked tab
     cannot bring it back. */
  if (PARKED_TABS.includes(tab)) return false;
  // The escape hatch: an override that locks everyone out (even the CEO)
  // must still leave one account able to undo it.
  if (role === "super_admin") return true;
  /* v1.90.0 — a person's own grant or refusal sits above the role. Deny
     wins over allow, so a tab can be taken from one person without
     touching the eight others who share the role, and given to one
     person without giving it to the role. */
  if (person?.deny?.includes(tab)) return false;
  if (person?.allow?.includes(tab)) return true;
  const ov = overrides[tab];
  if (ov !== undefined) return ov.includes(role);
  const allowed = defaultRolesFor(tab);
  return !allowed || allowed.includes(role);
}

/**
 * v1.90.0 — ONE PERSON, ABOVE THE ROLE.
 *
 * CEO, 04-09-2026, a screenshot of a staff phone: *"for some of the access I
 * want to also review what they can see and what they cant see which is for
 * me to authorize them to access it in users tabs."*
 *
 * The 🔐 card governs tabs by ROLE, which answers "who sees Payroll" and
 * cannot answer "what does Aina see" — you would have to read all
 * twenty-six rows and know her role. And it cannot give ONE marketing
 * person the Sales tab without giving it to every marketing person.
 *
 * So a person may carry a list of tabs granted to them and a list refused,
 * kept in system_meta under tab_access_people, keyed by user id. Deny beats
 * allow; both beat the role. Dashboard and Profile cannot be refused, and
 * super_admin cannot be governed — the same two rails as the role rule.
 *
 * This decides what is DRAWN. The data inside a tab is still gated by the
 * worker per role (AUDIT M13): a person granted a tab beyond their role
 * sees the tab and gets "access required" on anything the server does not
 * let that role read. The review card says so.
 */
export interface PersonAccess {
  allow: string[];
  deny: string[];
}

/** What a person's tab strip is, and why each tab is where it is. */
export type TabReason = "always" | "role" | "granted" | "refused" | "role_hidden" | "parked";

export function accessOf(
  role: string | null | undefined,
  overrides: Record<string, string[]> = {},
  person: PersonAccess | null = null,
): { tab: TabName; sees: boolean; reason: TabReason }[] {
  return ALL_TABS.map((tab) => {
    const sees = canSeeTab(role, tab, overrides, person);
    let reason: TabReason;
    if (ALWAYS_VISIBLE.includes(tab)) reason = "always";
    /* v1.102.0 - a parked tab is still LISTED here, and says why. The review
       card is the CEO asking "what does this person see"; answering it by
       quietly omitting two tabs, or by calling them hidden-by-role when the
       role has nothing to do with it, is answering a different question. */
    else if (PARKED_TABS.includes(tab)) reason = "parked";
    else if (role !== "super_admin" && person?.deny?.includes(tab)) reason = "refused";
    else if (role !== "super_admin" && person?.allow?.includes(tab) && !canSeeTab(role, tab, overrides, null)) reason = "granted";
    else reason = sees ? "role" : "role_hidden";
    return { tab, sees, reason };
  });
}

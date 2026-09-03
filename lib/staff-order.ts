/**
 * ONE order for staff, everywhere they are listed — v1.78.0.
 *
 * CEO, 31-08-2026: *"payroll should ascending with position which is CEO,
 * COO, CCO, HR_admin, Sales Executive, Sales Marketing, Marketing Designer
 * and lastly Live host and Part time last host."*
 *
 * The Payroll tab sorted alphabetically, so the CEO appeared second and the
 * part-time host fourth — a salary run reads top-down, and reading it
 * top-down told you nothing about the company.
 *
 * A RANK ORDER ALREADY EXISTED, inlined in staff-directory.tsx, and it was
 * nearly this: it flattened editor / marketing / live_host into one bucket
 * and knew nothing about part-time. Rather than add a second order that
 * would drift from the first, that one moves here, gains the two levels the
 * CEO named, and is now what both the Staff tab and Payroll read. The worker
 * mirrors it in SQL (`STAFF_ORDER_SQL` in staff.ts) so the M2E salary file
 * and the payroll export come out in the same order as the screen;
 * tests/staff-order.mjs fails the build if the two ever disagree.
 *
 * ROLE IS PRIMARY because it is structured data. `position` is free text
 * somebody types, so it only ever breaks a tie between people of the same
 * role — which is what separates the CEO's "Sales Executive" from his
 * "Sales Marketing" and "Marketing Designer".
 */

/** Lower sorts first. Gaps are deliberate: a new role can be slotted between
    two existing ones without renumbering the file. */
export const ROLE_RANK: Record<string, number> = {
  ceo: 10,
  coo: 20,
  cco: 30,
  hr_admin: 40,
  sales_marketing: 50,
  /* `admin` is a system tier rather than a job title, and it sat here — after
     sales_marketing — in the order this replaces. Left where it was: nobody
     asked for it to move, and a reshuffle nobody asked for is how a list
     stops matching what the person expects to see. */
  admin: 55,
  marketing: 60,
  editor: 70,
  live_host: 80,
};

/** Everything not named above, so an unknown role lands last instead of
    first (a missing key reading as 0 would put a typo'd role above the CEO). */
export const ROLE_RANK_OTHER = 90;

/** WHO IS AN EMPLOYEE — v1.78.0.
 *
 * CEO, 31-08-2026: *"Take note, super_Admin is not a staff. Super_admin is
 * system controller which is handling everything about the system."*
 *
 * `customer` is a shopper on the ELFIA store; `super_admin` is the system
 * account. Neither draws a salary, takes leave, or owes the company a
 * clock-in — so neither belongs in a staff list, however many permissions
 * super_admin holds. It had been appearing in the absence scan with nineteen
 * missing days because those queries asked for "not a customer" rather than
 * for staff. The worker has the matching predicate (`staffRolesSql`). */
export const NON_STAFF_ROLES: readonly string[] = ["customer", "super_admin"];

export const isStaffRole = (role?: string | null): boolean =>
  Boolean(role) && !NON_STAFF_ROLES.includes(role as string);

/** A part-time contract sorts after the same role's full-timers — the CEO's
    "and lastly Live host and Part time last host". +5 keeps it inside its
    own role's gap, so a part-time host never overtakes a full-time anybody. */
export const PART_TIME_OFFSET = 5;

/** Free-text tiebreaker within one role: sales, then marketing, then design.
    Anything unrecognised sits in the middle rather than at either end —
    being wrong about an unknown job title should not move somebody to the
    top or the bottom of a salary run. */
export function positionRank(position?: string | null): number {
  const p = (position ?? "").toLowerCase();
  if (/\bsales\b/.test(p)) return 1;
  if (/design/.test(p)) return 3;
  if (/marketing/.test(p)) return 2;
  return 2;
}

export interface Rankable {
  role?: string | null;
  position?: string | null;
  employment_status?: string | null;
}

/** The single number a staff row sorts on. */
export function staffRank(u: Rankable): number {
  const base = ROLE_RANK[u.role ?? ""] ?? ROLE_RANK_OTHER;
  const pt = u.employment_status === "part_time" ? PART_TIME_OFFSET : 0;
  return (base + pt) * 10 + positionRank(u.position);
}

/**
 * Comparator for any staff list. `name` is the last tiebreaker so two people
 * of the same role and job title keep a stable, predictable order rather
 * than whatever the database happened to return.
 */
export function bySeniority<T extends Rankable & { name?: string | null; full_name?: string | null }>(
  a: T,
  b: T,
): number {
  return staffRank(a) - staffRank(b)
    || (a.full_name || a.name || "").localeCompare(b.full_name || b.name || "");
}

/** STILL ON STAFF TODAY — v1.87.0.
 *
 * CEO, 03-09-2026: *"If staff already resigned after that day, the day after
 * it no more listed the staff on task, payroll after their payroll released
 * and etc except staff tabs which is for recording purposes."*
 *
 * The worker has the matching predicate (`currentStaffSql`), and most lists
 * are filtered there. `/users` cannot be: it feeds BOTH the Staff directory,
 * which must keep every leaver because it is the record, and the people
 * pickers, which must not. So that one list is filtered here, at the two
 * places that pick a person rather than read a record.
 *
 * THE LAST DAY IS A WORKING DAY — `left_on` is the last paid day, so somebody
 * leaving on the 30th is on staff on the 30th and gone on the 1st. And a
 * re-joiner is back: `rejoined_on` has meant that since v1.4.101.
 */
export function isCurrentStaff(
  u: { left_on?: string | null; rejoined_on?: string | null },
  today: string = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
): boolean {
  if (!u.left_on) return true;
  if (u.left_on.slice(0, 10) >= today) return true;
  return Boolean(u.rejoined_on && u.rejoined_on.slice(0, 10) <= today);
}

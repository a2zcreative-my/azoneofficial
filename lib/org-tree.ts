/**
 * THE SHAPE OF AN ORGANISATION — v1.101.0.
 *
 * The pure half of the org chart: the tree, the division walk and the
 * loop-safety, with no React and no imports at all. It lives apart from
 * components/staff/org-chart.tsx for one reason - tests/org-chart.mjs RUNS
 * these functions, on real cyclic data, rather than reading regexes off a
 * .tsx file it cannot import. (v1.230.0: one import, the staff rule from
 * lib/staff-order.ts - plain TypeScript too, so the guard still bundles it.) A renderer that must survive bad data is a
 * renderer whose survival can be tested.
 *
 * CEO, 05-09-2026: *"I want to add infographic for each staff reported to who
 * which is either CEO, COO or CCO. I will assigned by myself and organized it
 * based on who is their HOD to make it like organisation."*
 */
import { isCurrentStaff } from "./staff-order";

/** The subset of a staff record a chart needs. Structural, so the directory
    hands its own richer Staff straight in without a conversion step. */
export interface OrgPerson {
  id: number;
  name: string;
  full_name?: string | null;
  role: string;
  position?: string | null;
  department?: string | null;
  photo_key?: string | null;
  employment_status?: string | null;
  left_on?: string | null;
  rejoined_on?: string | null;
  reports_to?: number | null;
}

export interface OrgNode { u: OrgPerson; children: OrgNode[]; depth: number }

/* v1.230.0 - "still here" is the one staff rule (lib/staff-order.ts
   isCurrentStaff, the worker's currentStaffSql): someone serving notice is on
   the chart until their last day, a re-joiner is back. It read the status
   alone, so both were drawn as gone. */
export const isHere = (u: OrgPerson): boolean => isCurrentStaff(u);

/** The three the CEO named, in the order the company reads them. */
export const DIVISION_ROLES = ["ceo", "coo", "cco"] as const;

/** Who may SET a line. The same three, and it must stay the same three as
    PERMS.org_assign in the worker - tests/org-chart.mjs compares them, because
    a client that offers a control the server refuses is worse than one that
    hides it. The server is the authority either way. */
export const ORG_ASSIGN_ROLES: readonly string[] = ["ceo", "coo", "cco"];

/** v1.157.0 - who may set a person's ROLE from the staff record. CEO,
    13-09-2026: "this is only visible for CEO and COO to update the roles".
    Must stay equal to PERMS.role_assign in the worker (tests/role-assign.mjs
    compares them). The five roles they may hand out are the WORKING roles;
    ceo/coo/cco, customer and the admin tier stay with the super_admin, as
    they have since v1.4.157. */
export const ROLE_ASSIGN_ROLES: readonly string[] = ["ceo", "coo"];
export const WORKING_ROLES: readonly string[] = ["sales_marketing", "live_host", "marketing", "editor", "hr_admin"];

/**
 * The tree, from a flat list.
 *
 * Root: the CEO. Failing a CEO record, whoever is first in the list the
 * caller passed (it arrives in company order), so the chart still draws for a
 * company that has not filled that role in.
 *
 * A person whose reports_to points at somebody who has left, or at an id that
 * is not in the list at all, is treated as unassigned rather than dropped —
 * losing a person off the chart is worse than showing them waiting.
 */
export function buildOrg(list: OrgPerson[]): { root: OrgNode | null; unassigned: OrgPerson[] } {
  const here = list.filter(isHere);
  if (here.length === 0) return { root: null, unassigned: [] };
  const byId = new Map(here.map((u) => [u.id, u]));
  const root = here.find((u) => u.role === "ceo") ?? here[0]!;

  const kids = new Map<number, OrgPerson[]>();
  const unassigned: OrgPerson[] = [];
  for (const u of here) {
    if (u.id === root.id) continue;
    const m = u.reports_to ?? null;
    if (m === null || m === u.id || !byId.has(m)) { unassigned.push(u); continue; }
    const arr = kids.get(m);
    if (arr) arr.push(u); else kids.set(m, [u]);
  }

  /* WHY THIS DESCENT CANNOT LOOP, and why that is not the same as safe.
     Each person has exactly ONE reports_to, so `kids` is a forest, not a
     graph; and the root is skipped when kids is built, so the root is nobody
     child. Together those mean a cycle is always a component the descent
     never reaches - no visited-set is needed here, and pretending one is
     needed would be untestable code guarding nothing.

     What a cycle DOES do is strand everyone in it: five people pointing round
     at each other are on no chart at all. Losing them off the page is the
     real failure, so the last line sweeps up everybody the descent did not
     reach and puts them in the tray, where they are visible and one press
     from being placed. */
  const seen = new Set<number>();
  const descend = (u: OrgPerson, depth: number): OrgNode => {
    seen.add(u.id);
    return { u, depth, children: (kids.get(u.id) ?? []).map((c) => descend(c, depth + 1)) };
  };
  const tree = descend(root, 0);
  for (const u of here) if (!seen.has(u.id) && !unassigned.some((x) => x.id === u.id)) unassigned.push(u);
  return { root: tree, unassigned };
}

/** Which of CEO/COO/CCO a person sits under — self counts, so the COO's own
    division is the COO's. The hop limit is the same belt and braces as the
    worker's: this must end even on data it should never see. */
export function divisionOf(u: OrgPerson, byId: Map<number, OrgPerson>): string | null {
  let cur: OrgPerson | undefined = u;
  for (let hop = 0; cur && hop < 64; hop++) {
    if ((DIVISION_ROLES as readonly string[]).includes(cur.role)) return cur.role;
    const next: number | null = cur.reports_to ?? null;
    cur = next === null ? undefined : byId.get(next);
  }
  return null;
}

/** Everyone below a person, so the "reports to" picker cannot offer a choice
    that closes a loop. The server refuses one anyway; an option that is
    always rejected is a trap, not a safeguard. */
export function descendantsOf(id: number, list: OrgPerson[]): Set<number> {
  const kids = new Map<number, number[]>();
  for (const u of list) {
    const m = u.reports_to ?? null;
    if (m === null) continue;
    const a = kids.get(m);
    if (a) a.push(u.id); else kids.set(m, [u.id]);
  }
  const out = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const k of kids.get(cur) ?? []) {
      if (out.has(k)) continue;
      out.add(k);
      stack.push(k);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/**
 * ONE PERSON'S REPORTING LINE — v1.233.0.
 *
 * The owner, 30-10-2026 (claude/REPORTING-LINE-AUDIT.md): "CEO = TOP OF
 * INTERNAL OPERATIONAL HIERARCHY. NO ASSIGNED SUPERVISOR. NO ASSIGNED HOD."
 * Answers: the HOD comes from the reporting lines ("use reported"); the
 * Organisation decides ("I want to use the Organisation instead").
 *
 * So this reads the SAME tree the Organisation chart draws (buildOrg) and
 * nothing else: a supervisor is your parent on that chart. Whatever is
 * stored on the CEO's own record is never read - the chart roots at the CEO
 * and skips them when it builds, so the CEO has no parent here either. A
 * line that points at a leaver, a missing record or round a loop is "not
 * assigned yet", exactly as the chart's tray says.
 *
 * The HOD, from the reporting lines alone: walk up from you to the first
 * executive (CEO, COO or CCO). The person just below that executive heads
 * the department you sit in. If that is you and people report to you, you
 * are the HOD. If you report straight to an executive and lead nobody, the
 * executive is your HOD as well as your supervisor. An executive has no HOD
 * (they lead a division); the CEO has neither.
 *
 * Executive = the organisation role (users.role ceo/coo/cco), never an
 * account privilege: a super admin is not on this chart.
 */
export type LineKind = "ceo" | "staff" | "system" | "gone";
export interface DeptSummary { name: string; people: number; heads: OrgPerson[] }
export interface ReportingLine {
  kind: LineKind;
  me: OrgPerson;
  /** on the chart (false = not assigned yet; never false for the CEO) */
  placed: boolean;
  executive: boolean;
  supervisor: OrgPerson | null;
  hod: OrgPerson | null;
  hodIsSupervisor: boolean;
  youAreHod: boolean;
  directReports: OrgPerson[];
  /** everyone below, at any depth */
  below: number;
  /** CEO only: the departments under them, by the records */
  departments: DeptSummary[];
}
const SYSTEM_ROLES = ["admin", "super_admin", "customer"];
const isExec = (u: OrgPerson) => (DIVISION_ROLES as readonly string[]).includes(u.role);

export function reportingLine(list: OrgPerson[], meId: number): ReportingLine | null {
  const meRec = list.find((u) => u.id === meId);
  if (!meRec) return null;
  const empty = { placed: false, executive: false, supervisor: null, hod: null, hodIsSupervisor: false, youAreHod: false, directReports: [], below: 0, departments: [] };
  if (SYSTEM_ROLES.includes(meRec.role)) return { kind: "system", me: meRec, ...empty };
  if (!isHere(meRec)) return { kind: "gone", me: meRec, ...empty };
  const { root } = buildOrg(list);
  const parent = new Map<number, OrgPerson>();
  const nodeOf = new Map<number, OrgNode>();
  const walk = (n: OrgNode) => { nodeOf.set(n.u.id, n); for (const c of n.children) { parent.set(c.u.id, n.u); walk(c); } };
  if (root) walk(root);
  const count = (n: OrgNode): number => n.children.reduce((a, c) => a + 1 + count(c), 0);
  const node = nodeOf.get(meId) ?? null;
  const directReports = node ? node.children.map((c) => c.u) : [];
  const below = node ? count(node) : 0;

  /* the HOD of a placed person, by the walk described above */
  const hodOf = (id: number): OrgPerson | null => {
    const path: OrgPerson[] = [];
    let cur: OrgPerson | undefined = nodeOf.get(id)?.u;
    for (let hop = 0; cur && hop < 64; hop++) { path.push(cur); cur = parent.get(cur.id); }
    if (!path.length || isExec(path[0]!)) return null;
    const k = path.findIndex(isExec);
    if (k < 0) return null; // a chart with no executive above: nobody to name
    const head = path[k - 1]!;
    if (head.id === id && (nodeOf.get(id)?.children.length ?? 0) === 0) return path[k]!; // reports straight to an executive, leads nobody
    return head;
  };

  if (meRec.role === "ceo" && root?.u.id === meId) {
    /* the departments under the CEO, by the verified records: every placed
       person below the CEO, grouped by their department as written */
    const groups = new Map<string, OrgPerson[]>();
    for (const n of nodeOf.values()) {
      if (n.u.id === meId) continue;
      const k = (n.u.department ?? "").trim();
      groups.set(k, [...(groups.get(k) ?? []), n.u]);
    }
    const departments = [...groups].map(([name, ppl]) => ({
      name, people: ppl.length,
      heads: ppl.filter((p) => !isExec(p) && hodOf(p.id)?.id === p.id),
    })).sort((a, b) => (a.name === "" ? 1 : b.name === "" ? -1 : b.people - a.people || a.name.localeCompare(b.name)));
    return { kind: "ceo", me: meRec, placed: true, executive: true, supervisor: null, hod: null, hodIsSupervisor: false, youAreHod: false, directReports, below, departments };
  }
  const supervisor = parent.get(meId) ?? null;
  const executive = isExec(meRec);
  const hod = node && !executive ? hodOf(meId) : null;
  return {
    kind: "staff", me: meRec, placed: Boolean(node && supervisor), executive, supervisor,
    hod: hod && hod.id === meId ? null : hod,
    hodIsSupervisor: Boolean(hod && supervisor && hod.id === supervisor.id),
    youAreHod: Boolean(hod && hod.id === meId),
    directReports, below, departments: [],
  };
}

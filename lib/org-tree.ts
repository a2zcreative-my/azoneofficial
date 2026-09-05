/**
 * THE SHAPE OF AN ORGANISATION — v1.101.0.
 *
 * The pure half of the org chart: the tree, the division walk and the
 * loop-safety, with no React and no imports at all. It lives apart from
 * components/staff/org-chart.tsx for one reason - tests/org-chart.mjs RUNS
 * these functions, on real cyclic data, rather than reading regexes off a
 * .tsx file it cannot import. A renderer that must survive bad data is a
 * renderer whose survival can be tested.
 *
 * CEO, 05-09-2026: *"I want to add infographic for each staff reported to who
 * which is either CEO, COO or CCO. I will assigned by myself and organized it
 * based on who is their HOD to make it like organisation."*
 */

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
  reports_to?: number | null;
}

export interface OrgNode { u: OrgPerson; children: OrgNode[]; depth: number }

const HAS_LEFT = ["resigned", "terminated"];
export const isHere = (u: OrgPerson): boolean => !HAS_LEFT.includes(u.employment_status ?? "");

/** The three the CEO named, in the order the company reads them. */
export const DIVISION_ROLES = ["ceo", "coo", "cco"] as const;

/** Who may SET a line. The same three, and it must stay the same three as
    PERMS.org_assign in the worker - tests/org-chart.mjs compares them, because
    a client that offers a control the server refuses is worse than one that
    hides it. The server is the authority either way. */
export const ORG_ASSIGN_ROLES: readonly string[] = ["ceo", "coo", "cco"];

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

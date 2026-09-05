"use client";

/**
 * THE ORGANISATION CHART — v1.101.0.
 *
 * CEO, 05-09-2026: *"I want to add infographic for each staff reported to who
 * which is either CEO, COO or CCO. I will assigned by myself and organized it
 * based on who is their HOD to make it like organisation."*
 *
 * WHY A TREE AND NOT THREE COLUMNS. The literal reading of that sentence is
 * three buckets — CEO's people, COO's people, CCO's people — and it draws a
 * chart that cannot say the second half of the sentence. "Organized it based
 * on who is their HOD" means an HOD has their own people, and their own people
 * are not the COO's direct reports; they are the HOD's. So each person points
 * at ONE OTHER PERSON (users.reports_to, migration 0113) and the three
 * divisions are read by walking UP the line rather than stored beside it. A
 * two-level chart is a special case of this one, not a different thing.
 *
 * THE CEO IS THE ROOT WHETHER OR NOT ANYONE SAYS SO. On the day this ships
 * every reports_to is NULL. If "no manager" meant "root", the first render
 * would be the whole company in one flat row — a chart that looks broken and
 * teaches nothing. So the CEO is the root by role, and everybody else with no
 * line yet waits in a TRAY under the chart, which is both honest about the
 * state and exactly the worklist for filling it in.
 *
 * A LOOP IS THE ONLY FATAL SHAPE. The chart is drawn by descending and the
 * division is read by ascending, so A-reports-to-B-reports-to-A is not a
 * wrong picture, it is a page that never finishes rendering. The worker
 * refuses to write one; this file still descends with a `seen` set and
 * ascends with a hop limit, because a renderer that trusts its data is one
 * bad row away from a white screen.
 *
 * LEAVERS ARE NOT ON IT. Somebody resigned is not in the organisation. They
 * stay in the directory and in the circle, faded; here they would be a box
 * with live people hanging off it.
 *
 * WHO MAY ASSIGN: the CEO, the COO and the CCO — org_assign in the worker.
 * Everyone who can already open the Staff tab can LOOK at the chart.
 */

import { useMemo, useState } from "react";
import { displayName, givenNames } from "@/lib/names";
import { Skel } from "@/components/ui/skeleton";
import { getLang } from "@/lib/i18n";
import { card, inputClassSm } from "@/lib/ui-styles";
/* The tree, the division walk and the loop-safety live in lib/org-tree.ts,
   with no React in them, so tests/org-chart.mjs can RUN them against a cycle
   instead of reading regexes off this file. Re-exported here so the one
   import in staff-directory.tsx still reaches everything. */
import {
  type OrgPerson, type OrgNode, isHere, DIVISION_ROLES, ORG_ASSIGN_ROLES,
  buildOrg, divisionOf, descendantsOf,
} from "@/lib/org-tree";
export {
  type OrgPerson, type OrgNode, isHere, DIVISION_ROLES, ORG_ASSIGN_ROLES,
  buildOrg, divisionOf, descendantsOf,
};

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* The division accent. Three colours mixed FROM the brand rather than picked
   beside it, so a re-brand carries them and both themes get the same
   contrast. --success / --danger / --info are deliberately not used: they
   mean pass and fail everywhere else in this portal, and a division is
   neither. */
const DIVISION_INK: Record<string, string> = {
  ceo: "var(--gold-solid)",
  coo: "var(--primary)",
  cco: "color-mix(in oklab, var(--gold-solid) 45%, var(--primary))",
};
const inkFor = (division: string | null): string => DIVISION_INK[division ?? ""] ?? "var(--border)";

const ROLE_LABEL = (role: string) => role.replace(/_/g, " ");

function Face({ u, size }: { u: OrgPerson; size: number }) {
  const initials = displayName(u).split(" ")
    .filter((w) => !/^(bin|binti|bt\.?|b\.|a\/l|a\/p)$/i.test(w))
    .map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase();
  const photo = u.photo_key ? `/api/v1/media/file/${encodeURIComponent(u.photo_key)}` : "";
  return (
    <span className="ring-card bg-brand inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-white ring-2"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {photo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photo} alt="" className="h-full w-full object-cover" />
        : <span className="font-bold">{initials}</span>}
    </span>
  );
}

/** One box. The stripe down its left is the division; the number on the right
    is how many people are under it, counting the whole subtree - a manager of
    two who each manage four is not a manager of two. */
function OrgCard({ node, ink, headcount, onOpen, isRoot }: {
  node: OrgNode; ink: string; headcount: number; onOpen: (u: OrgPerson) => void; isRoot: boolean;
}) {
  const u = node.u;
  return (
    <button type="button" onClick={() => onOpen(u)}
      title={`${displayName(u)}${u.position ? ` · ${u.position}` : ""} — ${L("press to open the record", "tekan untuk buka rekod")}`}
      className={`bg-card border-border/70 relative flex items-center gap-2.5 rounded-xl border py-2 pr-3 pl-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none ${isRoot ? "min-w-[13rem]" : "min-w-[11rem]"}`}>
      <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-full" style={{ background: ink }} />
      <Face u={u} size={isRoot ? 44 : 34} />
      <span className="min-w-0">
        <span className={`block truncate font-semibold ${isRoot ? "text-sm" : "text-xs"}`}>{givenNames(displayName(u))}</span>
        <span className="text-muted-foreground block truncate text-[10px] leading-4">
          {u.position || ROLE_LABEL(u.role)}
        </span>
      </span>
      {headcount > 0 && (
        <span className="bg-secondary text-foreground/75 ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
          title={L(`${headcount} people below`, `${headcount} orang di bawah`)}>
          {headcount}
        </span>
      )}
    </button>
  );
}

/** A branch draws itself and then its children, which is the one place in
    this portal recursion is the honest shape. The connector lines are CSS on
    the children (see the <style> block in OrgChart), not SVG, so the tree
    reflows with the text and needs no measuring pass. */
function OrgBranch({ node, byId, counts, onOpen }: {
  node: OrgNode; byId: Map<number, OrgPerson>; counts: Map<number, number>; onOpen: (u: OrgPerson) => void;
}) {
  const ink = inkFor(divisionOf(node.u, byId));
  return (
    <div className="org-branch">
      <OrgCard node={node} ink={ink} headcount={counts.get(node.u.id) ?? 0} onOpen={onOpen} isRoot={node.depth === 0} />
      {node.children.length > 0 && (
        <>
          <span aria-hidden className="org-drop" />
          <div className="org-kids">
            {node.children.map((c) => (
              <OrgBranch key={c.u.id} node={c} byId={byId} counts={counts} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The picker: everyone who could be this person's manager. Self and anyone
    below them are left out, because those are the two ways to close a loop. */
function ManagerPicker({ person, people, disabled, onPick }: {
  person: OrgPerson; people: OrgPerson[]; disabled: boolean; onPick: (managerId: number | null) => void;
}) {
  const banned = useMemo(() => {
    const b = descendantsOf(person.id, people);
    b.add(person.id);
    return b;
  }, [person.id, people]);
  return (
    <select className={`${inputClassSm} w-full`} disabled={disabled}
      value={person.reports_to ?? ""}
      aria-label={L(`Who ${displayName(person)} reports to`, `Siapa ${displayName(person)} melapor kepada`)}
      onChange={(e) => onPick(e.target.value === "" ? null : Number(e.target.value))}>
      <option value="">{L("— not assigned —", "— belum ditetapkan —")}</option>
      {people.filter((p) => !banned.has(p.id) && isHere(p)).map((p) => (
        <option key={p.id} value={p.id}>
          {displayName(p)}{p.position ? ` · ${p.position}` : ` · ${ROLE_LABEL(p.role)}`}
        </option>
      ))}
    </select>
  );
}

export function OrgChart({ people, loaded, canAssign, saving, onAssign, onOpen }: {
  people: OrgPerson[];
  loaded: boolean;
  canAssign: boolean;
  /** the id currently being written, so its row can say so */
  saving: number | null;
  onAssign: (personId: number, managerId: number | null) => void;
  onOpen: (u: OrgPerson) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const { root, unassigned } = useMemo(() => buildOrg(people), [people]);
  const byId = useMemo(() => new Map(people.filter(isHere).map((u) => [u.id, u])), [people]);

  /* Subtree size per person, computed once. */
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    const walk = (n: OrgNode): number => {
      let total = 0;
      for (const c of n.children) total += 1 + walk(c);
      m.set(n.u.id, total);
      return total;
    };
    if (root) walk(root);
    return m;
  }, [root]);

  const placed = useMemo(() => {
    const n: number[] = [];
    const walk = (x: OrgNode) => { n.push(x.u.id); x.children.forEach(walk); };
    if (root) walk(root);
    return n.length;
  }, [root]);

  const depth = useMemo(() => {
    const walk = (x: OrgNode): number => (x.children.length ? 1 + Math.max(...x.children.map(walk)) : 1);
    return root ? walk(root) : 0;
  }, [root]);

  const perDivision = useMemo(() => {
    const m: Record<string, number> = { ceo: 0, coo: 0, cco: 0 };
    for (const u of byId.values()) {
      const d = divisionOf(u, byId);
      if (d && d in m) m[d] = (m[d] ?? 0) + 1;
    }
    return m;
  }, [byId]);

  if (!loaded) {
    return (
      <div className={card}>
        <Skel className="h-4 w-40" />
        <div className="mt-4 flex flex-col items-center gap-6">
          <Skel className="h-14 w-52 rounded-xl" />
          <div className="flex gap-4">
            <Skel className="h-12 w-44 rounded-xl" />
            <Skel className="h-12 w-44 rounded-xl" />
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {Array.from({ length: 5 }, (_, i) => <Skel key={i} className="h-12 w-40 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <style>{`
        .org-branch { display: flex; flex-direction: column; align-items: center; }
        .org-drop { display: block; width: 1px; height: 16px; background: var(--border); }
        .org-kids { display: flex; align-items: flex-start; justify-content: center; }
        .org-kids > .org-branch { position: relative; padding: 16px 8px 0; }
        .org-kids > .org-branch::before,
        .org-kids > .org-branch::after { content: ""; position: absolute; top: 0; width: 50%; height: 16px; }
        .org-kids > .org-branch::before { right: 50%; border-top: 1px solid var(--border); }
        .org-kids > .org-branch::after { left: 50%; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
        .org-kids > .org-branch:first-child::before { border-top: 0 }
        .org-kids > .org-branch:last-child::after { border-top: 0 }
      `}</style>

      {/* ================= THE CHART ================= */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{L("Organisation", "Organisasi")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("Who each person answers to. The stripe is the division; the number is how many sit below.",
                 "Setiap orang melapor kepada siapa. Jalur ialah bahagian; nombor ialah bilangan di bawahnya.")}
            </p>
          </div>
          <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="bg-secondary text-muted-foreground rounded-full px-2.5 py-1 font-medium">
              {placed} {L("on the chart", "pada carta")} · {depth} {L("levels", "peringkat")}
            </span>
            {DIVISION_ROLES.map((r) => (
              <span key={r} className="bg-secondary text-foreground/80 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: DIVISION_INK[r] }} />
                {r.toUpperCase()} {perDivision[r] ?? 0}
              </span>
            ))}
            {unassigned.length > 0 && (
              <span className="bg-warning-soft text-warning rounded-full px-2.5 py-1 font-medium">
                {unassigned.length} {L("not assigned", "belum ditetapkan")}
              </span>
            )}
          </span>
        </div>

        {root ? (
          /* The tree is as wide as the widest level, which on a growing
             company is wider than a laptop. It scrolls in its own box so the
             page never does. */
          <div className="mt-4 overflow-x-auto pb-2">
            <div className="flex min-w-max justify-center px-2">
              <OrgBranch node={root} byId={byId} counts={counts} onOpen={onOpen} />
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground mt-4 text-xs">{L("No active staff to chart yet.", "Belum ada kakitangan aktif untuk dicartakan.")}</p>
        )}
      </div>

      {/* ================= THE TRAY ================= */}
      {unassigned.length > 0 && (
        <div className={card}>
          <p className="text-sm font-semibold">{L("Not on the chart yet", "Belum berada pada carta")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {canAssign
              ? L("Choose who each of them reports to and they move onto the chart.",
                  "Pilih siapa yang mereka lapor kepada dan mereka akan berpindah ke carta.")
              : L("The CEO, COO or CCO places these.", "CEO, COO atau CCO yang menetapkannya.")}
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {unassigned.map((u) => (
              <li key={u.id} className="border-border/70 flex items-center gap-2.5 rounded-xl border p-2">
                <Face u={u} size={34} />
                <span className="min-w-0 flex-1">
                  <button type="button" className="block max-w-full truncate text-xs font-semibold hover:underline" onClick={() => onOpen(u)}>
                    {givenNames(displayName(u))}
                  </button>
                  <span className="text-muted-foreground block truncate text-[10px] leading-4">{u.position || ROLE_LABEL(u.role)}</span>
                  {canAssign && (
                    <span className="mt-1 block">
                      <ManagerPicker person={u} people={people} disabled={saving === u.id}
                        onPick={(m) => onAssign(u.id, m)} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ================= MOVING SOMEBODY ALREADY PLACED ================= */}
      {canAssign && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{L("Reporting lines", "Garis pelaporan")}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {L("Every active person and who they answer to. Changing one moves them on the chart at once.",
                   "Setiap orang aktif dan kepada siapa mereka melapor. Menukarnya akan memindahkan mereka pada carta serta-merta.")}
              </p>
            </div>
            <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? L("Hide", "Sembunyi") : L("Show", "Papar")}
            </button>
          </div>
          {showAll && (
            <ul className="mt-3 divide-border/70 divide-y">
              {people.filter(isHere).map((u) => {
                const isRoot = root?.u.id === u.id;
                return (
                  <li key={u.id} className="grid grid-cols-1 items-center gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: inkFor(divisionOf(u, byId)) }} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">{displayName(u)}</span>
                        <span className="text-muted-foreground block truncate text-[10px] leading-4">{u.position || ROLE_LABEL(u.role)}</span>
                      </span>
                    </span>
                    {isRoot ? (
                      <span className="text-muted-foreground text-[11px]">
                        {L("The top of the chart — reports to nobody.", "Puncak carta — tidak melapor kepada sesiapa.")}
                      </span>
                    ) : (
                      <ManagerPicker person={u} people={people} disabled={saving === u.id}
                        onPick={(m) => onAssign(u.id, m)} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

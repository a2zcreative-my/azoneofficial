"use client";

/* v1.308.0 - STAFF WORKSPACE 4.0, TEAM MAP (the CEO, 15-11-2026, reference
   image 04; claude/STAFF-WORKSPACE-4.0-BLUEPRINT.md section 4.4).

   A VISUALISATION, not an engine: everybody on it is a row of the one staff
   list (GET /staff/users) the Directory and Organisation read, by the same
   id - there is no Team Map membership to keep. Department sectors around
   the CEO; a face and its name per person; pressing a face opens the same
   profile as everywhere else.

     header   Total Staff · Active Staff · Next Birthdays (7 days) · On Leave today
     left     Departments (a colour and a count - press to focus) · Quick View
     centre   the CEO, then one sector per department, faces on one or two
              rings sized so no two cells overlap; a sector too full says +n
     right    Next Birthdays (day and month only - never the year or an age)
              and On Leave today (names only, from Leave's own calendar)

   On a phone the circle is a pile, so it is department chips over a grid of
   faces with names - an accessible list, the same people. Nothing here
   writes, and nothing invents a relationship from a position on the circle. */

import { useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile, type KpiTone } from "@/components/ui/kpi-tile";
import { Skel } from "@/components/ui/skeleton";
import { displayName, givenNames } from "@/lib/names";
import { getLang } from "@/lib/i18n";
import { card } from "@/lib/ui-styles";
import tm from "./team-map.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MapPerson {
  id: number; name: string; full_name?: string | null; role: string;
  position?: string | null; department?: string | null; photo_key?: string | null;
}
type Birthday = { days: number; next: string } | null;

function Face({ u, big = false, faded = false }: { u: MapPerson; big?: boolean; faded?: boolean }) {
  const photo = u.photo_key ? `/api/v1/media/file/${encodeURIComponent(u.photo_key)}` : "";
  const initials = displayName(u).split(" ").filter((w) => !/^(bin|binti|bt\.?|b\.|a\/l|a\/p)$/i.test(w))
    .map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase();
  return (
    <span className={`${tm.face} ${big ? tm.faceBig : ""} ${faded ? tm.faded : ""}`} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo ? <img src={photo} alt="" /> : <span>{initials}</span>}
    </span>
  );
}

/** Where each face sits: the CEO at the centre, each department a sector
    sized by its headcount, one ring (or two) of evenly spaced cells inside
    it. Percent of a square field. */
function layout(groups: [string, MapPerson[]][], fieldPx: number) {
  const out: { u: MapPerson; left: number; top: number; dept: string }[] = [];
  const more: { dept: string; n: number; left: number; top: number }[] = [];
  const total = groups.reduce((n, [, l]) => n + l.length, 0) || 1;
  const CELL = 96; // a face and its two-line name
  const rings = [0.31, 0.43];
  let a0 = -Math.PI / 2;
  const sectors: { dept: string; a0: number; a1: number }[] = [];
  for (const [dept, list] of groups) {
    const span = (2 * Math.PI * list.length) / total;
    const a1 = a0 + span;
    sectors.push({ dept, a0, a1 });
    let rest = [...list];
    for (const r of rings) {
      if (rest.length === 0) break;
      const cap = Math.max(1, Math.floor((span * r * fieldPx) / CELL));
      const here = rest.slice(0, cap);
      rest = rest.slice(cap);
      here.forEach((u, i) => {
        const a = a0 + (span * (i + 0.5)) / here.length;
        out.push({ u, dept, left: 50 + r * 100 * Math.cos(a), top: 50 + r * 100 * Math.sin(a) });
      });
    }
    if (rest.length > 0) {
      const a = (a0 + a1) / 2;
      more.push({ dept, n: rest.length, left: 50 + 0.49 * 100 * Math.cos(a), top: 50 + 0.49 * 100 * Math.sin(a) });
    }
    a0 = a1;
  }
  return { out, more, sectors };
}

export function TeamMap({ people, gone, loaded, colorOf, birthdayOf, onLeave, activeCount, onOpen, onShowDept, goOrg, goDirectory, goRoles }: {
  people: MapPerson[];
  gone: (u: MapPerson) => boolean;
  loaded: boolean;
  /** the department's colour, the same one the Overview's donut uses */
  colorOf: (dept: string) => string;
  birthdayOf: (u: MapPerson) => Birthday;
  /** ids on approved leave today (Leave's calendar; never the type or the reason) */
  onLeave: Set<number>;
  activeCount: number;
  onOpen: (u: MapPerson) => void;
  onShowDept: (dept: string) => void;
  goOrg: () => void;
  goDirectory: () => void;
  goRoles: () => void;
}) {
  const [dept, setDept] = useState("");
  const [withLeft, setWithLeft] = useState(false);
  const deptOf = (u: MapPerson) => (u.department ?? "").trim();
  const shown = people.filter((u) => withLeft || !gone(u));
  const ceo = shown.find((u) => u.role === "ceo" && !gone(u)) ?? null;
  const rest = shown.filter((u) => u !== ceo);
  const groups = [...rest.reduce((m, u) => m.set(deptOf(u), [...(m.get(deptOf(u)) ?? []), u]), new Map<string, MapPerson[]>())]
    .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : b[1].length - a[1].length || a[0].localeCompare(b[0])));
  const allDepts = [...shown.reduce((m, u) => m.set(deptOf(u), (m.get(deptOf(u)) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : b[1] - a[1] || a[0].localeCompare(b[0])));
  const noDept = L("No department", "Tiada jabatan");
  const { out, more, sectors } = layout(groups, 560);
  const birthdays = people.filter((u) => !gone(u)).map((u) => ({ u, b: birthdayOf(u) }))
    .filter((x): x is { u: MapPerson; b: NonNullable<Birthday> } => Boolean(x.b) && x.b!.days <= 7)
    .sort((a, b) => a.b.days - b.b.days);
  const leaveToday = people.filter((u) => onLeave.has(u.id) && !gone(u));
  const dayMonth = (next: string) => { const [d, m] = next.split("-"); return `${Number(d)} ${MON[Number(m) - 1] ?? ""}`; };
  /* the conic sector washes behind the faces, one per department */
  const wash = sectors.length === 0 ? "transparent" : `conic-gradient(from 0deg, ${sectors.map((sc) => {
    const from = ((sc.a0 + Math.PI / 2) * 180) / Math.PI, to = ((sc.a1 + Math.PI / 2) * 180) / Math.PI;
    const c = `color-mix(in oklab, ${colorOf(sc.dept)} ${dept && dept !== sc.dept ? 3 : 11}%, transparent)`;
    return `${c} ${from}deg ${to}deg`;
  }).join(", ")})`;
  const pick = (k: string) => setDept(dept === k ? "" : k);
  const dim = (u: MapPerson) => dept !== "" && deptOf(u) !== dept;

  /* v1.338.0 - the CEO's strict KPI strip: four segments of the one strip */
  const stat = (icon: Parameters<typeof AppIcon>[0]["name"], tone: KpiTone, label: string, value: number | string, sub: string) => (
    <KpiTile key={label} icon={icon} tone={tone} label={label} value={value} busy={!loaded} sub={sub} />
  );

  return (
    <section className={card} aria-label={L("Team Map", "Peta Pasukan")} data-testid="team-map">
      <div className={tm.top}>
        <div className={tm.intro}>
          <span className={tm.introIcon} aria-hidden><AppIcon name="users" /></span>
          <span><strong className={tm.title}>{L("Team Map", "Peta Pasukan")}</strong><span className={tm.sub}>{L("The whole team at a glance.", "Seluruh pasukan sepintas lalu.")}</span></span>
        </div>
        <div className={tm.stats} data-testid="team-stats">
          <KpiRow label={L("The team at a glance", "Pasukan sepintas lalu")}>
            {stat("users", "navy", L("Total Staff", "Jumlah Kakitangan"), people.length, L("on the staff list", "dalam senarai kakitangan"))}
            {stat("success", "green", L("Active Staff", "Kakitangan Aktif"), activeCount, loaded ? L(`${people.length ? Math.round((activeCount * 100) / people.length) : 0}% of staff`, `${people.length ? Math.round((activeCount * 100) / people.length) : 0}% kakitangan`) : "")}
            {stat("cake", "gold", L("Next Birthdays", "Hari Lahir Seterusnya"), birthdays.length, L("in 7 days", "dalam 7 hari"))}
            {stat("holiday", "blue", L("On Leave", "Bercuti"), leaveToday.length, L("today", "hari ini"))}
          </KpiRow>
        </div>
      </div>

      <div className={tm.body}>
        <aside className={tm.side}>
          <div className={`${tm.panel} erp-desktop-only`}>
            <p className={tm.panelTitle}>{L(`Departments (${allDepts.filter(([k]) => k).length})`, `Jabatan (${allDepts.filter(([k]) => k).length})`)}</p>
            <ul className={tm.deptList}>
              {allDepts.map(([k, n]) => (
                <li key={k || "none"}>
                  <button type="button" aria-pressed={dept === k} onClick={() => pick(k)}>
                    <span className={tm.dot} style={{ background: colorOf(k) }} aria-hidden />
                    <span>{k || noDept}</span><strong>{n}</strong>
                  </button>
                </li>
              ))}
            </ul>
            <label className={tm.check}>
              <input type="checkbox" checked={withLeft} onChange={(e) => setWithLeft(e.target.checked)} />
              {L("Include staff who have left", "Termasuk kakitangan yang telah keluar")}
            </label>
          </div>
          <div className={`${tm.panel} erp-desktop-only`}>
            <p className={tm.panelTitle}>{L("Quick View", "Paparan Pantas")}</p>
            <ul className={tm.quick}>
              <li><button type="button" onClick={goOrg}><AppIcon name="chart" /><span><strong>{L("Organisation", "Organisasi")}</strong><span>{L("View company structure", "Lihat struktur syarikat")}</span></span><AppIcon name="next" /></button></li>
              <li><button type="button" onClick={goDirectory}><AppIcon name="users" /><span><strong>{L("Staff Directory", "Direktori Kakitangan")}</strong><span>{L("Find and manage staff", "Cari dan urus kakitangan")}</span></span><AppIcon name="next" /></button></li>
              <li><button type="button" onClick={goRoles}><AppIcon name="store" /><span><strong>{L("Departments & Roles", "Jabatan & Peranan")}</strong><span>{L("View departments and roles", "Lihat jabatan dan peranan")}</span></span><AppIcon name="next" /></button></li>
            </ul>
          </div>
        </aside>

        {/* the circle - a tablet and up */}
        <div className={`${tm.mapWrap} erp-desktop-only`}>
          <div className={tm.field} style={{ background: wash }} data-testid="team-field">
            {!loaded && <span className={tm.centre}><Skel className={tm.skelBig} /></span>}
            {loaded && sectors.map((sc) => {
              const a = (sc.a0 + sc.a1) / 2;
              return (
                <button key={`lbl-${sc.dept}`} type="button" className={tm.sectorLabel} aria-pressed={dept === sc.dept}
                  style={{ left: `${50 + 49 * Math.cos(a)}%`, top: `${50 + 49 * Math.sin(a)}%` }} onClick={() => pick(sc.dept)}>
                  <span className={tm.dot} style={{ background: colorOf(sc.dept) }} aria-hidden />
                  {sc.dept || noDept} ({allDepts.find(([k]) => k === sc.dept)?.[1] ?? 0})
                </button>
              );
            })}
            {loaded && ceo && (
              <button type="button" className={`${tm.person} ${tm.centre} ${dim(ceo) ? tm.dim : ""}`} onClick={() => onOpen(ceo)}
                aria-label={L(`${displayName(ceo)}, CEO - open the profile`, `${displayName(ceo)}, CEO - buka profil`)}>
                <Face u={ceo} big />
                <span className={tm.name}><strong>{displayName(ceo)}</strong><span className={tm.ceoTag}><AppIcon name="trophy" />CEO</span></span>
              </button>
            )}
            {loaded && out.map(({ u, left, top }) => (
              <button key={u.id} type="button" className={`${tm.person} ${dim(u) ? tm.dim : ""}`} style={{ left: `${left}%`, top: `${top}%` }}
                onClick={() => onOpen(u)} aria-label={L(`${displayName(u)} - open the profile`, `${displayName(u)} - buka profil`)}
                title={[u.position, deptOf(u)].filter(Boolean).join(" · ")}>
                <Face u={u} faded={gone(u)} />
                <span className={tm.name}><strong>{givenNames(displayName(u))}</strong></span>
              </button>
            ))}
            {loaded && more.map((m) => (
              <button key={`more-${m.dept}`} type="button" className={tm.more} style={{ left: `${m.left}%`, top: `${m.top}%` }} onClick={() => onShowDept(m.dept)}>
                +{m.n}
              </button>
            ))}
            {loaded && people.length === 0 && <p className={tm.empty}>{L("No staff records yet.", "Belum ada rekod kakitangan.")}</p>}
          </div>
        </div>

        {/* a phone: department chips over a grid of faces with names */}
        <div className={`${tm.phone} erp-phone-only`}>
          <div className={tm.chips} role="group" aria-label={L("Department", "Jabatan")}>
            <button type="button" aria-pressed={dept === ""} onClick={() => setDept("")}>{L("Everyone", "Semua")}</button>
            {allDepts.map(([k, n]) => (
              <button key={k || "none"} type="button" aria-pressed={dept === k} onClick={() => pick(k)}>
                <span className={tm.dot} style={{ background: colorOf(k) }} aria-hidden />{k || noDept} ({n})
              </button>
            ))}
          </div>
          <label className={tm.check}>
            <input type="checkbox" checked={withLeft} onChange={(e) => setWithLeft(e.target.checked)} />
            {L("Include staff who have left", "Termasuk kakitangan yang telah keluar")}
          </label>
          <ul className={tm.grid}>
            {!loaded && Array.from({ length: 6 }, (_, i) => <li key={i} aria-hidden><Skel className={tm.skelFace} /></li>)}
            {loaded && [...(ceo ? [ceo] : []), ...rest].filter((u) => !dim(u)).map((u) => (
              <li key={u.id}>
                <button type="button" className={tm.gridPerson} onClick={() => onOpen(u)}>
                  <Face u={u} big={u === ceo} faded={gone(u)} />
                  <strong>{givenNames(displayName(u))}</strong>
                  <span>{u === ceo ? "CEO" : deptOf(u) || noDept}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <aside className={tm.side}>
          <div className={tm.panel} data-testid="team-birthdays">
            <p className={tm.panelTitle}><AppIcon name="cake" />{L(`Next Birthdays (${birthdays.length})`, `Hari Lahir Seterusnya (${birthdays.length})`)}</p>
            {birthdays.length === 0 ? <p className={tm.muted}>{L("No birthday in the next 7 days.", "Tiada hari lahir dalam 7 hari.")}</p> : (
              <ul className={tm.miniList}>
                {birthdays.map(({ u, b }) => (
                  <li key={u.id}><button type="button" onClick={() => onOpen(u)}>
                    <Face u={u} />
                    <span><strong>{displayName(u)}</strong><span><AppIcon name="date" />{b.days === 0 ? L("today", "hari ini") : L(`in ${b.days} day${b.days === 1 ? "" : "s"} (${dayMonth(b.next)})`, `dalam ${b.days} hari (${dayMonth(b.next)})`)}</span></span>
                  </button></li>
                ))}
              </ul>
            )}
          </div>
          <div className={tm.panel} data-testid="team-leave">
            <p className={tm.panelTitle}><AppIcon name="holiday" />{L(`On Leave (${leaveToday.length})`, `Bercuti (${leaveToday.length})`)}</p>
            {leaveToday.length === 0 ? <p className={tm.muted}>{L("Nobody is on leave today.", "Tiada sesiapa bercuti hari ini.")}</p> : (
              <ul className={tm.miniList}>
                {leaveToday.map((u) => (
                  <li key={u.id}><button type="button" onClick={() => onOpen(u)}>
                    <Face u={u} />
                    <span><strong>{displayName(u)}</strong><span><AppIcon name="date" />{L("Today", "Hari ini")}</span></span>
                    <span className={tm.leaveTag}>{L("Leave", "Cuti")}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

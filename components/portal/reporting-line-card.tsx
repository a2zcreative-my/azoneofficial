"use client";

/* v1.233.0 - MY REPORTING LINE / EXECUTIVE LEADERSHIP (the owner's CEO
   top-level hierarchy brief and answers, 30-10-2026;
   claude/REPORTING-LINE-AUDIT.md). "CEO = TOP OF INTERNAL OPERATIONAL
   HIERARCHY. NO ASSIGNED SUPERVISOR. NO ASSIGNED HOD."

   Reads /staff/reporting-line and nothing else: the worker answers from the
   Organisation chart's own tree (lib/org-tree.ts reportingLine), so this
   card and the chart can never disagree. The CEO sees Executive Leadership -
   Not applicable for supervisor and HOD, never "missing". Everyone else sees
   their supervisor and HOD from the reporting lines; one box when they are
   the same person. A system account (admin, super admin) is not on the
   chart and sees no card. Nothing here writes. */

import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useCachedApi } from "@/lib/cached-api";
import { getLang } from "@/lib/i18n";
import { card } from "@/lib/ui-styles";
import css from "./reporting-line.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Person { id: number; name: string; position: string | null; role: string; department: string | null; photo_key: string | null }
interface Line {
  kind: "ceo" | "staff" | "system" | "gone";
  me?: Person; placed?: boolean; executive?: boolean;
  supervisor?: Person | null; hod?: Person | null; hod_is_supervisor?: boolean; you_are_hod?: boolean;
  direct_reports?: Person[]; below?: number;
  departments?: { name: string | null; people: number; heads: Person[] }[];
}

const ROLE_POS: Record<string, [string, string]> = {
  ceo: ["Chief Executive Officer (CEO)", "Ketua Pegawai Eksekutif (CEO)"],
  coo: ["Chief Operating Officer (COO)", "Ketua Pegawai Operasi (COO)"],
  cco: ["Chief Commercial Officer (CCO)", "Ketua Pegawai Komersial (CCO)"],
};
const posOf = (p: Person) => p.position?.trim() || (ROLE_POS[p.role] ? L(ROLE_POS[p.role]![0], ROLE_POS[p.role]![1]) : "");

function Cell({ icon, label, children, faded = false }: { icon: AppIconName; label: string; children: ReactNode; faded?: boolean }) {
  return (
  <div className={`${css.cell} ${faded ? css.na : ""}`}>
    <span className={css.well} aria-hidden><AppIcon name={icon} /></span>
    <span className={css.cellText}><span className={css.label}>{label}</span>{children}</span>
  </div>
  );
}
function PersonCell({ p, label, note, tag }: { p: Person; label: string; note: string; tag?: string }) {
  return (
  <div className={css.cell}>
    <Avatar name={p.name} photoKey={p.photo_key} size="lg" />
    <span className={css.cellText}>
      <span className={css.label}>{label}</span>
      <strong className={css.name}>{p.name}</strong>
      {posOf(p) && <span className={css.pos}>{posOf(p)}</span>}
      <span className={css.note}>{note}</span>
      {tag && <span className={css.tag}>{tag}</span>}
    </span>
  </div>
  );
}

/** v1.239.0 (the owner's weekly-target brief, 31-10-2026: "Do not restore
    the oversized Executive Leadership card"; the reference: "Maklumat
    jawatan dan hierarki CEO diringkaskan ... Maklumat repetitif dialihkan ke
    modul Staff / Organisation"). The Dashboard shows the reporting line as
    ONE line; the CEO sees none (no supervisor or HOD is shown for the CEO).
    The full card, the drawers and the chart stay in Staff -> Organisation. */
export function ReportingLineStrip({ canOpenOrg, openOrg }: { canOpenOrg: boolean; openOrg: () => void }) {
  const { data } = useCachedApi<Line>("/staff/reporting-line");
  if (!data || data.kind !== "staff" || !data.me) return null;
  const hodName = data.you_are_hod ? L("you", "anda") : data.executive ? null : data.hod_is_supervisor ? null : data.hod?.name ?? null;
  return (
    <p className={css.strip} aria-label={L("My reporting line", "Garis pelaporan saya")}>
      <AppIcon name="users" />
      <span>
        {data.supervisor ? L(`Reports to ${data.supervisor.name}`, `Melapor kepada ${data.supervisor.name}`) : L("Supervisor not assigned yet", "Penyelia belum ditetapkan")}
        {data.hod_is_supervisor && !data.executive ? L(" (also your HOD)", " (juga HOD anda)") : ""}
        {hodName ? L(` · HOD: ${hodName}`, ` · HOD: ${hodName}`) : ""}
        {data.me.department ? ` · ${data.me.department}` : ""}
      </span>
      {canOpenOrg && <button type="button" className={css.stripLink} onClick={openOrg}>{L("Organisation", "Organisasi")}</button>}
    </p>
  );
}

export function ReportingLineCard({ canOpenOrg, openOrg }: { canOpenOrg: boolean; openOrg: () => void }) {
  const { data, failed } = useCachedApi<Line>("/staff/reporting-line");
  const [drawer, setDrawer] = useState<"" | "reports" | "departments" | "team">("");
  if (data && (data.kind === "system" || data.kind === "gone")) return null;
  if (failed && !data) return null; // the Dashboard never breaks over this card

  const people = (xs: Person[], empty: string) => xs.length === 0 ? <p className={css.empty}>{empty}</p> : (
    <ul className={css.people}>{xs.map((p) => (
      <li key={p.id}><Avatar name={p.name} photoKey={p.photo_key} size="md" /><span className={css.cellText}><strong className={css.name}>{p.name}</strong><span className={css.pos}>{[posOf(p), p.department].filter(Boolean).join(" · ")}</span></span></li>
    ))}</ul>
  );

  const isCeo = data?.kind === "ceo";
  const me = data?.me;
  const reports = data?.direct_reports ?? [];
  const depts = data?.departments ?? [];
  const title = isCeo ? L("Executive Leadership", "Kepimpinan Eksekutif") : L("My Reporting Line", "Garis Pelaporan Saya");

  return (
    <section className={`${card} ${css.card}`} aria-label={title}>
      <div className={css.head}>
        <span className={css.headIcon} aria-hidden><AppIcon name="users" /></span>
        <h3 className={css.title}>{title}</h3>
      </div>
      {!data || !me ? <SkelRows rows={2} /> : isCeo ? (
        <div className={css.row}>
          <div className={css.cell}>
            <Avatar name={me.name} photoKey={me.photo_key} size="lg" />
            <span className={css.cellText}>
              <span className={css.label}>{L("Position", "Jawatan")}</span>
              <strong className={css.name}>{L(ROLE_POS.ceo![0], ROLE_POS.ceo![1])}</strong>
              <span className={css.pos}>{L("Hierarchy: Top-level Executive", "Hierarki: Eksekutif peringkat tertinggi")}</span>
              <span className={css.note}>{L("Scope", "Skop")}: {me.department ?? L("Company-wide", "Seluruh syarikat")}</span>
            </span>
          </div>
          <Cell icon="person" label={L("Direct Supervisor", "Penyelia Langsung")} faded>
            <strong className={css.name}>{L("Not applicable", "Tidak berkenaan")}</strong>
            <span className={css.note}>{L("You are the highest authority", "Anda autoriti tertinggi")}</span>
          </Cell>
          <Cell icon="users" label={L("Head of Department", "Ketua Jabatan")} faded>
            <strong className={css.name}>{L("Not applicable", "Tidak berkenaan")}</strong>
            <span className={css.note}>{L("You oversee the entire company", "Anda menyelia seluruh syarikat")}</span>
          </Cell>
          <div className={css.actions}>
            {canOpenOrg && <button type="button" className={css.action} onClick={openOrg}><AppIcon name="chart" /><span>{L("View Organisation Chart", "Lihat Carta Organisasi")}</span><AppIcon name="next" /></button>}
            <button type="button" className={css.action} onClick={() => setDrawer("reports")}><AppIcon name="person" /><span>{L(`Direct Reports (${reports.length})`, `Melapor Terus (${reports.length})`)}</span><AppIcon name="next" /></button>
            <button type="button" className={css.action} onClick={() => setDrawer("departments")}><AppIcon name="folder" /><span>{L(`Departments (${depts.filter((d) => d.name).length})`, `Jabatan (${depts.filter((d) => d.name).length})`)}</span><AppIcon name="next" /></button>
          </div>
        </div>
      ) : (
        <div className={`${css.row} ${data.hod_is_supervisor && !data.executive && !data.you_are_hod ? css.three : ""}`}>
          <Cell icon="folder" label={L("Department", "Jabatan")}>
            <strong className={css.name}>{me.department ?? L("Not set", "Belum ditetapkan")}</strong>
            <span className={css.note}>{L("Your current department", "Jabatan semasa anda")}</span>
          </Cell>
          {data.supervisor ? (
            <PersonCell p={data.supervisor} label={L("Your Direct Supervisor", "Penyelia Langsung Anda")} note={L("You report to this person", "Anda melapor kepada individu ini")}
              tag={data.hod_is_supervisor ? L("Also your Head of Department", "Juga Ketua Jabatan anda") : undefined} />
          ) : (
            <Cell icon="person" label={L("Your Direct Supervisor", "Penyelia Langsung Anda")} faded>
              <strong className={css.name}>{L("Not assigned yet", "Belum ditetapkan")}</strong>
              <span className={css.note}>{L("The CEO, COO or CCO sets it on the Organisation chart", "CEO, COO atau CCO menetapkannya pada carta Organisasi")}</span>
            </Cell>
          )}
          {data.executive ? (
            <Cell icon="users" label={L("Head of Department", "Ketua Jabatan")} faded>
              <strong className={css.name}>{L("Not applicable", "Tidak berkenaan")}</strong>
              <span className={css.note}>{L(`You lead the ${me.role.toUpperCase()} division · ${data.below ?? 0} below you`, `Anda memimpin bahagian ${me.role.toUpperCase()} · ${data.below ?? 0} di bawah anda`)}</span>
            </Cell>
          ) : data.you_are_hod ? (
            <Cell icon="users" label={L("Head of Department", "Ketua Jabatan")}>
              <strong className={css.name}>{me.name}</strong>
              <span className={css.tag}>{L("You are the HOD for this department", "Anda Ketua Jabatan ini")}</span>
              <span className={css.note}>{L(`${reports.length} report to you directly · ${data.below ?? 0} in your team`, `${reports.length} melapor terus · ${data.below ?? 0} dalam pasukan anda`)}</span>
            </Cell>
          ) : data.hod && !data.hod_is_supervisor ? (
            <PersonCell p={data.hod} label={L("Head of Department (HOD)", "Ketua Jabatan (HOD)")} note={L("Department head responsible for your team", "Ketua jabatan yang bertanggungjawab atas pasukan anda")} />
          ) : !data.hod ? (
            <Cell icon="users" label={L("Head of Department", "Ketua Jabatan")} faded>
              <strong className={css.name}>{L("Not assigned yet", "Belum ditetapkan")}</strong>
              <span className={css.note}>{L("Follows from your reporting line", "Mengikut garis pelaporan anda")}</span>
            </Cell>
          ) : null}
          <div className={css.actions}>
            <button type="button" className={css.action} onClick={() => (canOpenOrg ? openOrg() : setDrawer("team"))}>
              <AppIcon name="chart" /><span>{canOpenOrg ? L("View Organisation Chart", "Lihat Carta Organisasi") : L("View Team Structure", "Lihat Struktur Pasukan")}</span><AppIcon name="next" />
            </button>
            {canOpenOrg && <button type="button" className={css.action} onClick={() => setDrawer("team")}><AppIcon name="users" /><span>{L("My team", "Pasukan saya")}</span><AppIcon name="next" /></button>}
          </div>
        </div>
      )}

      <SideDrawer open={drawer !== ""} onClose={() => setDrawer("")}
        title={drawer === "reports" ? L("Direct Reports", "Melapor Terus") : drawer === "departments" ? L("Departments", "Jabatan") : L("My Team Structure", "Struktur Pasukan Saya")}
        subtitle={L("From the Organisation chart", "Daripada carta Organisasi")}>
        {drawer === "reports" && people(reports, L("Nobody reports to you directly yet.", "Belum ada yang melapor terus kepada anda."))}
        {drawer === "departments" && (depts.length === 0 ? <p className={css.empty}>{L("Nobody is on the chart under you yet.", "Belum ada sesiapa di bawah anda pada carta.")}</p> : (
          <ul className={css.depts}>{depts.map((d) => (
            <li key={d.name ?? ""}>
              <span className={css.cellText}>
                <strong className={css.name}>{d.name ?? L("No department recorded", "Tiada jabatan direkod")}</strong>
                <span className={css.pos}>{d.heads.length ? L(`HOD: ${d.heads.map((h) => h.name).join(", ")}`, `HOD: ${d.heads.map((h) => h.name).join(", ")}`) : L("No HOD in the reporting lines", "Tiada HOD dalam garis pelaporan")}</span>
              </span>
              <span className={css.count}>{d.people}</span>
            </li>
          ))}</ul>
        ))}
        {drawer === "team" && data && me && (
          <div className={css.chain}>
            {data.hod && !data.hod_is_supervisor && !data.you_are_hod && <><p className={css.label}>{L("Head of Department", "Ketua Jabatan")}</p>{people([data.hod], "")}</>}
            <p className={css.label}>{L("Your Direct Supervisor", "Penyelia Langsung Anda")}{data.hod_is_supervisor ? ` · ${L("also your HOD", "juga HOD anda")}` : ""}</p>
            {data.supervisor ? people([data.supervisor], "") : <p className={css.empty}>{L("Not assigned yet", "Belum ditetapkan")}</p>}
            <p className={css.label}>{L("You", "Anda")}</p>
            {people([me], "")}
            <p className={css.label}>{L("Reporting to you", "Melapor kepada anda")}</p>
            {people(reports, L("Nobody yet.", "Belum ada."))}
          </div>
        )}
      </SideDrawer>
    </section>
  );
}

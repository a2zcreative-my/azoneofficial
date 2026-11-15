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

import { AppIcon } from "@/components/ui/app-icon";
import { useCachedApi } from "@/lib/cached-api";
import { getLang } from "@/lib/i18n";
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

/* v1.317.0 (the duplicate-function audit, D-9) - ReportingLineCard left: nothing drew it any more */

"use client";

/* v1.293.0 - SYSTEM -> AUTOMATION & RULES (the Desk consolidation, the CEO,
   12-11-2026, K3 / D4). The watcher RULES, moved whole out of the Desk's old
   Watcher Settings tab: which rules run, who each tells, the line each
   watches, and "Run now". The same card, the same reads and writes
   (/staff/watchers), the same server rule - the CEO and the super admin
   change a rule, the COO, CCO and admin read them. What the rules FIND is
   worked in the Desk's Action Inbox (Alerts); rules and findings stay apart. */

import { useState } from "react";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { LineTabs } from "@/components/ui/line-tabs";
import { TaskEmailLog, TaskEmailSettings } from "@/components/portal/task-mail-panel"; // v1.337.0 - task email settings live here, not under Tasks
import { SkelRows } from "@/components/ui/skeleton";
import { useCachedApi } from "@/lib/cached-api";
import { WatchersCard } from "@/components/portal/watchers-card";
import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import css from "./automation-rules.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* v1.307.0 - ATTENDANCE 4.0 (the CEO, 14-11-2026, A-1 / A-5 / A-12): the
   attendance rule, READ-ONLY, from the worker's own constants
   (GET /staff/attendance/policy) - nothing here edits it, and nothing is
   copied: a grace change is a dated code change, so a past day keeps the
   rule it was judged by. The geofence stays in Users. */
type Policy = { grace: { from: string; minutes: number }[]; grace_today: number; missing_out_after_minutes: number; ot_auto_approved: boolean; ot_to_leave_automatic: boolean };
const dmyOf = (d: string) => d.split("-").reverse().join("-");

function AttendancePolicyCard() {
  const p = useCachedApi<Policy>("/staff/attendance/policy");
  return (
    <section className={`${card} ${css.card}`} data-testid="attendance-policy" aria-label={L("Attendance policy", "Polisi kehadiran")}>
      {!p.data ? (p.failed ? <p className={css.lead}>{L("The policy could not be read. Try again later.", "Polisi tidak dapat dibaca. Cuba lagi nanti.")}</p> : <SkelRows rows={4} />) : (
        <ul className={css.policy}>
          <li><span className={css.policyKey}>{L("Late after", "Lewat selepas")}</span>
            <span className={css.policyVal}>{p.data.grace.length === 0 ? L("Shift start - no grace", "Mula syif - tiada tempoh tenggang") : p.data.grace.map((g) => L(`Shift start + ${g.minutes} min, from ${dmyOf(g.from)}`, `Mula syif + ${g.minutes} min, dari ${dmyOf(g.from)}`)).join(" · ")}
              {" "}({L(`today: ${p.data.grace_today} min`, `hari ini: ${p.data.grace_today} min`)})</span></li>
          <li><span className={css.policyKey}>{L("Not clocked in", "Belum daftar masuk")}</span>
            <span className={css.policyVal}>{L("Only on a working day, after the shift start and grace, with no approved leave, holiday or rest day. Before that the day is “not due yet”; after the shift ends it is absent.", "Hanya pada hari bekerja, selepas mula syif dan tempoh tenggang, tanpa cuti diluluskan, cuti umum atau hari rehat. Sebelum itu hari itu “belum tiba”; selepas syif tamat ia tidak hadir.")}</span></li>
          <li><span className={css.policyKey}>{L("Missing clock-out", "Tiada daftar keluar")}</span>
            <span className={css.policyVal}>{L(`${p.data.missing_out_after_minutes} min after the shift ends, with no clock-out.`, `${p.data.missing_out_after_minutes} min selepas syif tamat, tanpa daftar keluar.`)}</span></li>
          <li><span className={css.policyKey}>{L("Forgotten punches", "Ketukan terlupa")}</span>
            <span className={css.policyVal}>{L("Count nowhere until approved in Attendance → Exceptions & Approvals.", "Tidak dikira di mana-mana sehingga diluluskan di Kehadiran → Pengecualian & Kelulusan.")}</span></li>
          <li><span className={css.policyKey}>{L("Overtime", "Kerja lebih masa")}</span>
            <span className={css.policyVal}>{L("Extra time is never approved automatically and never turns into leave by itself - a decider approves it, as pay or as a replacement day.", "Masa tambahan tidak pernah diluluskan secara automatik dan tidak bertukar menjadi cuti dengan sendirinya - pelulus meluluskannya, sebagai bayaran atau hari ganti.")}</span></li>
          <li><span className={css.policyKey}>{L("Location", "Lokasi")}</span>
            <span className={css.policyVal}>{L("Managers see the check result (verified, outside, low accuracy); raw coordinates are the CEO's. The geofence is set in Users.", "Pengurus melihat hasil semakan (disahkan, di luar, ketepatan rendah); koordinat mentah untuk CEO. Pagar geo ditetapkan dalam Pengguna.")}</span></li>
        </ul>
      )}
    </section>
  );
}

/* v1.337.0 - FOUR VIEWS, ONE AT A TIME (the CEO, 17-11-2026: "Keep email
   configuration in an appropriate authorized settings workspace"). Task Email
   and its Delivery Log moved here from the foot of Tasks > Reports & Archive -
   the same panel, the same routes, the same gates: they are drawn for the CEO,
   COO, CCO and super admin, as on Tasks (the server answers 403 to anyone
   else); the Admin account keeps the watcher rules and the attendance policy.
   Each body stays mounted once opened and is hidden, never unmounted. */
type AutoView = "email" | "log" | "rules" | "policy";
const MAIL_ROLES = ["ceo", "coo", "cco", "super_admin"];

export function AutomationRulesPage({ role, go, initialView }: { role: string; go: (tab: string) => void; initialView?: string }) {
  const canEdit = role === "ceo" || role === "super_admin";
  const mail = MAIL_ROLES.includes(role);
  const views: (readonly [AutoView, string])[] = [
    ...(mail ? [["email", L("Task Email", "E-mel Tugasan")] as const, ["log", L("Delivery Log", "Log Penghantaran")] as const] : []),
    ["rules", L("Watcher Rules", "Peraturan Pemerhati")],
    ["policy", L("Attendance Policy", "Polisi Kehadiran")],
  ];
  const first = views[0]![0];
  const [view, setView] = useState<AutoView>(() => (views.some(([k]) => k === initialView) ? initialView as AutoView : first));
  const [seen, setSeen] = useState<Record<string, boolean>>({ [view]: true });
  const open = (v: AutoView) => { setView(v); setSeen((s) => (s[v] ? s : { ...s, [v]: true })); };
  return (
    <TabPage>
      <LineTabs value={view} onChange={open} label={L("Automation & Rules views", "Paparan Automasi & Peraturan")} testid="auto-view" tabs={views} />
      {mail && (
        <div hidden={view !== "email"}>
          <TabZone label={L("Task email", "E-mel tugasan")}>{seen.email && <TaskEmailSettings />}</TabZone>
        </div>
      )}
      {mail && (
        <div hidden={view !== "log"}>
          <TabZone label={L("Delivery log", "Log penghantaran")}>{seen.log && <TaskEmailLog />}</TabZone>
        </div>
      )}
      <div hidden={view !== "rules"}>
        <p className={css.lead}>
          {L("The rules the company watches its own data with. A rule finds records; what it finds appears in each person's Desk → Action Inbox → Alerts. ",
            "Peraturan yang syarikat gunakan untuk memerhati datanya sendiri. Peraturan menemui rekod; dapatannya muncul dalam Meja → Peti Tindakan → Amaran setiap orang. ")}
          {canEdit ? L("Only you and the super admin can change a rule.", "Hanya anda dan pentadbir super boleh mengubah peraturan.")
            : L("Only the CEO changes a rule; you can read them.", "Hanya CEO mengubah peraturan; anda boleh membacanya.")}
        </p>
        <TabZone label={L("Watcher rules", "Peraturan pemerhati")}>
          <section className={`${card} ${css.card}`} data-testid="automation-rules">
            <WatchersCard role={role} go={go} section="rules" bare />
          </section>
        </TabZone>
      </div>
      <div hidden={view !== "policy"}>
        <TabZone label={L("Attendance policy", "Polisi kehadiran")} hint={L("The one status rule every attendance view uses. Read-only.", "Satu peraturan status yang digunakan setiap paparan kehadiran. Baca sahaja.")}>
          <AttendancePolicyCard />
        </TabZone>
      </div>
    </TabPage>
  );
}

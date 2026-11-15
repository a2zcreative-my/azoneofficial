"use client";

/* v1.307.0 - EXCEPTIONS & APPROVALS, ATTENDANCE WORKSPACE 4.0 (reference
   image 5; A-6: the existing single decisions, through the same routes the
   Desk uses - no new chain, no new engine).

     forgotten punches   GET /staff/attendance/pending; decided by the CEO
                         (POST /staff/attendance/pending/decide - the time
                         may be set first; the server refuses anyone's own,
                         the verified owner's own is recorded and the COO is
                         told)
     overtime            GET /staff/attendance/ot/pending; decided by the CEO,
                         COO or an admin (POST /staff/attendance/ot/decide):
                         approve (paid), a replacement day (an explicit
                         choice, A-12) or reject. Never your own. Never
                         approved by itself.

   Approve on the Desk or here and both clear - it is one record. The
   anchors the Desk and the bell reveal (#pending-punches, #ot-approvals) are
   on this view. Below the queue, for the roles that may correct records,
   the correction and back-entry card (moved from Attendance Settings). */

import { useState } from "react";
import { L, type User } from "@/components/portal/page-shared";
import { AttendanceAdminPanel } from "@/components/portal/lazy-panels";
import { TabZone } from "@/components/portal/tab-concept";
import { AppIcon } from "@/components/ui/app-icon";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { useSaveToast } from "@/components/ui/save-toast";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { holds } from "@/lib/caps";
import { useCachedApi } from "@/lib/cached-api";
import { dmy, mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnSm, btnSmPrimary, card, chipSmInfo, chipSmWarn, inputClassSm } from "@/lib/ui-styles";
import { mytHm } from "./attendance-shared";
import css from "./attendance4.module.css";

type Punch = { id: number; user_id: number; type: string; created_at: string; offline_sent_at?: string | null; name: string };
type Ot = { user_id: number; name: string; d: string; ot_in: string | null; ot_out: string | null; minutes: number; stretches: number; assigned: string | null };
type Item = { key: string; kind: "punch" | "ot"; user_id: number; name: string; day: string; what: string; since: string; punch?: Punch; ot?: Ot };
const OT_ROLES = ["ceo", "coo", "super_admin", "admin"];
const CORRECT_ROLES = ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"];
const dur = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const utcToMyt = (utc: string) => new Date(Date.parse(`${utc.replace(" ", "T")}Z`) + 8 * 3600 * 1000).toISOString().slice(0, 16);
const daysSince = (day: string) => Math.round((Date.parse(`${mytToday()}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);

export function AttendanceExceptions({ user }: { user: User }) {
  const canPunch = holds("unpaid_leave", ["ceo", "super_admin"].includes(user.role));
  const canOt = OT_ROLES.includes(user.role);
  const canCorrect = holds("attendance_correct", CORRECT_ROLES.includes(user.role));
  const punches = useCachedApi<{ pending?: Punch[] }>(canCorrect ? "/staff/attendance/pending" : null, true, ["attendance"]);
  const ots = useCachedApi<{ pending?: Ot[]; can_replace?: boolean }>(canOt ? "/staff/attendance/ot/pending" : null, true, ["attendance"]);
  const decided = useCachedApi<{ decided_today: number }>("/staff/attendance/decided-today", true, ["attendance"]);
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const [kind, setKind] = useState<"all" | "punch" | "ot">("all");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [fix, setFix] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const items: Item[] = [
    ...(punches.data?.pending ?? []).map((p): Item => ({ key: `p${p.id}`, kind: "punch", user_id: p.user_id, name: p.name, day: utcToMyt(p.created_at).slice(0, 10), what: L(`Forgotten ${p.type === "clock_in" ? "clock-in" : "clock-out"} · claimed ${mytHm(p.created_at)}`, `${p.type === "clock_in" ? "Daftar masuk" : "Daftar keluar"} terlupa · dituntut ${mytHm(p.created_at)}`), since: utcToMyt(p.created_at).slice(0, 10), punch: p })),
    ...(ots.data?.pending ?? []).map((o): Item => ({ key: `o${o.user_id}:${o.d}`, kind: "ot", user_id: o.user_id, name: o.name, day: o.d, what: `${o.ot_in ?? "?"}–${o.ot_out ?? "?"} (${dur(o.minutes)})${o.assigned ? L(` · assigned: ${o.assigned}`, ` · ditugaskan: ${o.assigned}`) : ""}`, since: o.d, ot: o })),
  ].sort((a, b) => b.day.localeCompare(a.day));
  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => (kind === "all" || i.kind === kind) && (!needle || `${i.name} ${i.day} ${i.what}`.toLowerCase().includes(needle)));
  const open = items.find((i) => i.key === openKey) ?? null;
  const waitingLong = items.filter((i) => daysSince(i.since) > 2).length;
  const loading = (canCorrect && !punches.data) || (canOt && !ots.data);
  const refresh = () => { punches.refresh(); ots.refresh(); decided.refresh(); };

  const decidePunch = async (action: "approve" | "reject") => {
    const p = open?.punch; if (!p) return;
    if (action === "reject" && !(await confirm({ title: L("Reject this forgotten punch?", "Tolak ketukan terlupa ini?"), message: L("The claimed punch is removed from the day; the audit log keeps what was claimed. The staff member is told.", "Ketukan yang dituntut dibuang daripada hari itu; log audit menyimpan tuntutannya. Kakitangan dimaklumkan."), confirmLabel: L("Reject", "Tolak"), variant: "danger" }))) return;
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>("/staff/attendance/pending/decide", { method: "POST", body: JSON.stringify(action === "approve" ? { id: p.id, action, myt: (fix || utcToMyt(p.created_at)).replace("T", " ") } : { id: p.id, action }) });
    setBusy(false);
    if (!r.ok) { toast(L("Not decided", "Tidak diputuskan"), r.data?.error?.message ?? L("Please try again", "Sila cuba lagi"), "notice"); return; }
    toast(action === "approve" ? L("Approved — it now counts", "Diluluskan — kini dikira") : L("Rejected", "Ditolak"), properName(p.name)); setOpenKey(null); refresh();
  };
  const decideOt = async (decision: "approved" | "replacement" | "rejected", days?: 0.5 | 1) => {
    const o = open?.ot; if (!o) return;
    const msg = decision === "approved" ? L("Approved overtime goes to the payroll. The staff member is told.", "OT yang diluluskan masuk ke gaji. Kakitangan dimaklumkan.")
      : decision === "replacement" ? L(`Not paid as overtime: ${days === 1 ? "one day" : "half a day"} is added to their replacement-leave balance instead.`, `Tidak dibayar sebagai OT: ${days === 1 ? "sehari" : "setengah hari"} ditambah ke baki cuti gantian.`)
      : L("The overtime is not paid. The staff member is told.", "OT tidak dibayar. Kakitangan dimaklumkan.");
    if (!(await confirm({ title: `${properName(o.name)} · ${dmy(o.d)}`, message: msg, confirmLabel: decision === "approved" ? L("Approve OT", "Luluskan OT") : decision === "replacement" ? L("Credit replacement leave", "Kreditkan cuti gantian") : L("Reject OT", "Tolak OT"), variant: decision === "rejected" ? "danger" : "default" }))) return;
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>("/staff/attendance/ot/decide", { method: "POST", body: JSON.stringify({ user_id: o.user_id, date: o.d, decision, ...(decision === "replacement" ? { replacement_days: days } : {}), note: note || undefined }) });
    setBusy(false);
    if (!r.ok) { toast(L("Not decided", "Tidak diputuskan"), r.data?.error?.message ?? L("Please try again", "Sila cuba lagi"), "notice"); return; }
    toast(L("Decided", "Diputuskan"), properName(o.name)); setOpenKey(null); setNote(""); refresh();
  };

  const own = open ? open.user_id === user.id : false;
  return (
    <>
      {toastNode}{confirmNode}
      <KpiRow label={L("Exceptions", "Pengecualian")}>
        <KpiTile icon="pending" tone="gold" label={L("Pending Review", "Menunggu Semakan")} value={items.length} busy={loading} sub={L("Requires your action", "Memerlukan tindakan anda")} />
        <KpiTile icon="success" tone="green" label={L("Decided Today", "Diputuskan Hari Ini")} value={decided.data?.decided_today ?? 0} busy={!decided.data} sub={L("Punches and overtime", "Ketukan dan OT")} />
        <KpiTile icon="warning" tone="red" label={L("Waiting Over 2 Days", "Menunggu Lebih 2 Hari")} value={waitingLong} busy={loading} sub={L("Needs attention", "Perlu perhatian")} />
      </KpiRow>
      <section className={card} aria-label={L("Exceptions and approvals", "Pengecualian dan kelulusan")} data-testid="att-exceptions">
        <span id="pending-punches" />
        <span id="ot-approvals" />
        <div className={css.legend} role="group" aria-label={L("Type", "Jenis")}>
          {([["all", L("All", "Semua"), items.length], ["punch", L("Missing punches", "Ketukan tertinggal"), items.filter((i) => i.kind === "punch").length], ["ot", L("Overtime", "OT"), items.filter((i) => i.kind === "ot").length]] as const).map(([k, l, n]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`exc-${k}`}>{l} ({n})</button>
          ))}
        </div>
        <div className={css.filters}>
          <input type="search" className={`${inputClassSm} ${css.wide}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search staff, date or detail…", "Cari kakitangan, tarikh atau butiran…")} aria-label={L("Search", "Cari")} />
        </div>
        {loading ? <SkelRows rows={4} /> : shown.length === 0 ? <p className={css.empty}>{L("Nothing waiting for a decision.", "Tiada yang menunggu keputusan.")}</p> : (
          <ul className={css.list}>
            {shown.map((i) => (
              <li key={i.key} data-testid="exc-row">
                <span className={css.listText}><strong>{properName(i.name)}</strong><span className={css.sub}>{dmy(i.day)}</span></span>
                <span className={i.kind === "punch" ? chipSmWarn : chipSmInfo}>{i.kind === "punch" ? L("Missing punch", "Ketukan tertinggal") : L("Overtime", "OT")}</span>
                <span className={css.listText}><span>{i.what}</span><span className={css.sub}>{i.kind === "punch" ? L("Decided by the CEO", "Diputuskan oleh CEO") : L("Decided by the CEO, COO or an admin", "Diputuskan oleh CEO, COO atau admin")}{daysSince(i.since) > 2 ? L(` · waiting ${daysSince(i.since)} days`, ` · menunggu ${daysSince(i.since)} hari`) : ""}</span></span>
                <button type="button" className={btnSm} onClick={() => { setOpenKey(i.key); setFix(i.punch ? utcToMyt(i.punch.created_at) : ""); setNote(""); }} data-testid="exc-open">{L("Review", "Semak")}</button>
              </li>
            ))}
          </ul>
        )}
        {!canCorrect && !canOt && <p className={css.boundary}>{L("Decisions are made by the CEO (forgotten punches) and the CEO, COO or an admin (overtime).", "Keputusan dibuat oleh CEO (ketukan terlupa) dan CEO, COO atau admin (OT).")}</p>}
      </section>

      {canCorrect && (
        <TabZone label={L("Corrections & back-entry", "Pembetulan & kemasukan lampau")} hint={L("Find a record, add a day worked before the system, or amend an overtime stretch - each is marked and audit-logged.", "Cari rekod, tambah hari bekerja sebelum sistem, atau pinda OT - setiap satu ditanda dan dilog audit.")}>
          <AttendanceAdminPanel role={user.role} areas={["find", "add", "ot"]} showPending={false} />
        </TabZone>
      )}

      <SideDrawer open={!!open} onClose={() => setOpenKey(null)} title={open ? (open.kind === "punch" ? L("Forgotten punch", "Ketukan terlupa") : L("Overtime request", "Permohonan OT")) : ""} subtitle={open ? `${properName(open.name)} · ${dmy(open.day)}` : undefined}>
        {open && (
          <div className={css.drawer} data-testid="exc-drawer">
            <div>
              <div className={css.kv}><span>{L("Date", "Tarikh")}</span><strong>{dmy(open.day)}</strong></div>
              {open.punch && <>
                <div className={css.kv}><span>{L("Punch", "Ketukan")}</span><strong>{open.punch.type === "clock_in" ? L("Clock in", "Daftar masuk") : L("Clock out", "Daftar keluar")}</strong></div>
                <div className={css.kv}><span>{L("Claimed time", "Masa dituntut")}</span><strong>{mytHm(open.punch.created_at)}</strong></div>
                {open.punch.offline_sent_at && <div className={css.kv}><span>{L("Delivered (no signal before)", "Dihantar (tiada isyarat sebelum)")}</span><strong>{mytHm(open.punch.offline_sent_at)}</strong></div>}
              </>}
              {open.ot && <>
                <div className={css.kv}><span>{L("Overtime period", "Tempoh OT")}</span><strong>{open.ot.ot_in ?? "?"}–{open.ot.ot_out ?? "?"} ({dur(open.ot.minutes)})</strong></div>
                <div className={css.kv}><span>{L("Stretches", "Bahagian")}</span><strong>{open.ot.stretches}</strong></div>
                <div className={css.kv}><span>{L("Assigned work", "Kerja ditugaskan")}</span><strong>{open.ot.assigned ?? "—"}</strong></div>
              </>}
            </div>
            <p className={css.sectionTitle}>{L("Decision", "Keputusan")}</p>
            {own && open.kind === "ot" ? <p className={css.boundary}>{L("This is your own request — another approver decides it.", "Ini permohonan anda sendiri — pelulus lain memutuskannya.")}</p>
              : open.kind === "punch" ? (canPunch ? (
                <>
                  <label className={css.kv}><span>{L("The real time (Malaysia)", "Masa sebenar (Malaysia)")}</span><input type="datetime-local" className={inputClassSm} value={fix} onChange={(e) => setFix(e.target.value)} data-testid="exc-time" /></label>
                  {own && <p className={css.sub}>{L("This is your own punch: the server refuses it for anyone but the verified owner, whose own decision is recorded and the COO is told.", "Ini ketukan anda sendiri: pelayan menolaknya kecuali pemilik yang disahkan, dan keputusannya direkod serta COO dimaklumkan.")}</p>}
                  <span className={css.introRight}>
                    <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void decidePunch("approve")} data-testid="exc-approve">{L("Approve", "Luluskan")}</button>
                    <button type="button" className={btnSm} disabled={busy} onClick={() => void decidePunch("reject")} data-testid="exc-reject">{L("Reject", "Tolak")}</button>
                  </span>
                </>
              ) : <p className={css.boundary}>{L("A forgotten punch is decided by the CEO.", "Ketukan terlupa diputuskan oleh CEO.")}</p>)
              : canOt ? (
                <>
                  <input className={inputClassSm} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("Note (optional)", "Nota (pilihan)")} aria-label={L("Note", "Nota")} />
                  <span className={css.introRight}>
                    <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void decideOt("approved")} data-testid="exc-approve">{L("Approve", "Luluskan")}</button>
                    {ots.data?.can_replace && <button type="button" className={btnSm} disabled={busy} onClick={() => void decideOt("replacement", 1)}>{L("Replacement day", "Hari gantian")}</button>}
                    {ots.data?.can_replace && <button type="button" className={btnSm} disabled={busy} onClick={() => void decideOt("replacement", 0.5)}>{L("Half replacement day", "Separuh hari gantian")}</button>}
                    <button type="button" className={btnSm} disabled={busy} onClick={() => void decideOt("rejected")} data-testid="exc-reject">{L("Reject", "Tolak")}</button>
                  </span>
                </>
              ) : <p className={css.boundary}>{L("Overtime is decided by the CEO, COO or an admin.", "OT diputuskan oleh CEO, COO atau admin.")}</p>}
            <p className={css.sub}><AppIcon name="info" /> {L("The same decision is on the Desk: decide it in either place and both clear. You cannot approve your own request.", "Keputusan yang sama ada di Meja: putuskan di mana-mana, kedua-duanya selesai. Anda tidak boleh meluluskan permohonan sendiri.")}</p>
          </div>
        )}
      </SideDrawer>
    </>
  );
}

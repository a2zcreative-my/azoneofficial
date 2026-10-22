"use client";
import { openPrintPreview } from "@/components/ui/document-preview";

/**
 * HR / payroll administration (v1.4.16), for the admin Staff area (and,
 * since v1.192.0, the HR page's Calendar & Holidays and Payroll & Payslips
 * tabs - the same two cards):
 *   - Public holidays / company calendar (feeds leave day-counting)
 *   - Payslip: attendance + approved-leave summary for a month, printable
 */

import { makeApi } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
const api = makeApi("/staff");
import { useCallback, useEffect, useState } from "react";
import { esc } from "@/lib/escape-html";
import { btnSm, btnSmPrimary, card, chipSmInfo, chipSmNeutral, chipSmWarn, fieldLabel, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { dmy, mytToday } from "@/lib/format";
import { AppIcon } from "@/components/ui/app-icon";
import { rowBtnDanger } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
/* v1.28.0 — the printed HR report is an operational artefact issued today,
   so its letterhead names the CURRENT operator (lib/issuers.ts). */
import { DOCUMENT_ISSUER } from "@/lib/issuers";
import { getLang } from "@/lib/i18n";
import { Skel } from "@/components/ui/skeleton"; // v1.77.0
/* v1.124.0 — the paper palette has one owner (lib/doc-theme.ts). This
   document is written into a separate window/iframe that cannot see the
   app stylesheet, so it needs literal hex, not var(--doc-*). */
import { DOC } from "@/lib/doc-theme";
import css from "./hr-admin-panel.module.css";
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);



const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Display-only BM labels for API values — the values themselves never change.
const HOLIDAY_KIND_MS: Record<string, string> = {
  public: "umum", company: "syarikat", replacement: "gantian",
};

interface Staff { id: number; name: string; role: string; employee_id?: string | null; position?: string | null; department?: string | null }
interface Holiday { id: number; holiday_date: string; name: string; kind: string }


/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

export function HrAdminPanel() {
  /* v1.192.0 - the two cards are their own components now, so the HR page can
     put each under its own tab (Calendar & Holidays, Payroll & Payslips). The
     admin page still shows both here, one after the other, as before. */
  return (
    <div className={css.stack}>
      <HolidaysCard />
      <PayslipCard />
    </div>
  );
}

const KIND_CHIP: Record<string, string> = { public: chipSmInfo, company: chipSmNeutral, replacement: chipSmWarn };

/** Public holidays & company calendar: add and remove, the existing rules
    (a weekend public holiday auto-creates its Monday replacement, server-side). */
export function HolidaysCard() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loaded, setLoaded] = useState(false); // v1.77.0 — first fetch settled (ok or not)
  const [holDraft, setHolDraft] = useState({ holiday_date: "", name: "", kind: "public" });
  /* v1.145.0 - the holidays list is fetched for the current year. */
  const [entYear] = useState(new Date().getFullYear());
  const today = mytToday();

  /* a write bumps the tick; the read is set from its promise, never
     synchronously from the effect */
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    void api<{ holidays: Holiday[] }>(`/holidays?year=${entYear}`).then((h) => {
      if (!live) return;
      if (h.data) setHolidays(h.data.holidays ?? []);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [entYear, tick]);

  const upcoming = holidays.filter((h) => h.holiday_date >= today).length;
  return (
    <section className={card} aria-label={L("Public holidays & company calendar", "Cuti umum & kalendar syarikat")}>
      {toastNode}
      <div className={css.head}>
        <span className={`${css.well} ${css.red}`}><AppIcon name="holiday" /></span>
        <div className={css.headText}>
          <p className={css.title}>{L("Public holidays & company calendar", "Cuti umum & kalendar syarikat")} <span className={css.muted}>· {entYear}</span></p>
          <p className={css.sub}>
            {L(
              "Used so leave day-counting, attendance and payroll don't treat a holiday as a working day — and shown in red on everyone's events calendar. Adding a public holiday on a Saturday/Sunday auto-creates its Monday replacement (next free working day if Monday is taken); pick kind \"replacement\" to add one manually, or Remove an auto row you don't want.",
              "Digunakan supaya kiraan hari cuti, kehadiran dan gaji tidak menganggap hari cuti sebagai hari bekerja — dan dipaparkan merah pada kalendar acara semua orang. Menambah cuti umum pada Sabtu/Ahad akan mencipta gantian Isnin secara automatik (hari bekerja kosong berikutnya jika Isnin sudah diambil); pilih jenis \"gantian\" untuk menambah secara manual, atau Buang baris auto yang anda tidak mahu.",
            )}
          </p>
        </div>
        {loaded && <span className={chipSmNeutral}>{L(`${upcoming} upcoming`, `${upcoming} akan datang`)}</span>}
      </div>
      <div className={css.form}>
        <label className={css.field}><span className={fieldLabel}>{L("Date", "Tarikh")}</span>
          <input type="date" className={inputClassSm} value={holDraft.holiday_date}
            onChange={(e) => setHolDraft((d) => ({ ...d, holiday_date: e.target.value }))} />
        </label>
        <label className={`${css.field} ${css.grow}`}><span className={fieldLabel}>{L("Holiday name", "Nama cuti")}</span>
          <input className={inputClassSm} placeholder={L("Holiday name", "Nama cuti")} value={holDraft.name}
            onChange={(e) => setHolDraft((d) => ({ ...d, name: e.target.value }))} />
        </label>
        <label className={css.field}><span className={fieldLabel}>{L("Kind", "Jenis")}</span>
          <select className={selectClassSm} value={holDraft.kind}
            onChange={(e) => setHolDraft((d) => ({ ...d, kind: e.target.value }))}>
            {["public", "company", "replacement"].map((k) => <option key={k} value={k}>{L(k, HOLIDAY_KIND_MS[k] ?? k)}</option>)}
          </select>
        </label>
        <button type="button" className={btnSmPrimary}
          onClick={async () => {
            if (!holDraft.holiday_date || !holDraft.name.trim()) {
              showToast(L("No changes", "Tiada perubahan"), L("A holiday needs both a date and a name", "Cuti memerlukan tarikh dan nama"), "notice");
              return;
            }
            const r = await api(`/holidays`, { method: "POST", body: JSON.stringify(holDraft) });
            if (!r.ok) { showToast(L("No changes", "Tiada perubahan"), L("Could not add that holiday — try again", "Tidak dapat menambah cuti itu — cuba lagi"), "notice"); return; }
            showToast(L("Saved", "Disimpan"), `${holDraft.name} ${L("added — payroll working days recount from this", "ditambah — hari bekerja gaji dikira semula dari ini")}`);
            setHolDraft({ holiday_date: "", name: "", kind: "public" });
            void load();
          }}><AppIcon name="add" />{L("Add", "Tambah")}</button>
      </div>
      <ul className={css.holidays} aria-label={L("Holidays this year", "Cuti tahun ini")}>
        {/* v1.77.0 — skeleton until the first fetch lands */}
        {!loaded && Array.from({ length: 6 }, (_, i) => (
          <li key={`skel-${i}`} className={css.holiday} aria-busy="true">
            <Skel className={css.skelLine} />
          </li>
        ))}
        {holidays.map((h) => (
          <li key={h.id} className={`${css.holiday} ${h.holiday_date < today ? css.past : ""}`}>
            <span className={css.badge} aria-hidden>
              <span className={css.badgeDay}>{h.holiday_date.slice(8, 10)}</span>
              <span className={css.badgeMon}>{MON[Number(h.holiday_date.slice(5, 7)) - 1] ?? ""}</span>
            </span>
            <span className={css.hName}>
              <span className={css.hTitle}>{h.name}</span>
              <span className={css.muted}>{dmy(h.holiday_date)}</span>
            </span>
            <span className={KIND_CHIP[h.kind] ?? chipSmNeutral}>{L(h.kind, HOLIDAY_KIND_MS[h.kind] ?? h.kind)}</span>
            <button type="button" className={rowBtnDanger}
              onClick={async () => {
                const r = await api(`/holidays/${h.id}`, { method: "DELETE" });
                showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"),
                  r.ok ? `${h.name} ${L("removed — payroll working days recount", "dibuang — hari bekerja gaji dikira semula")}` : L("Could not remove that holiday", "Tidak dapat membuang cuti itu"),
                  r.ok ? undefined : "notice");
                void load();
              }}>
              {L("Remove", "Buang")}
            </button>
          </li>
        ))}
        {loaded && holidays.length === 0 && <li className={css.empty}>{L("No holidays yet.", "Belum ada cuti lagi.")}</li>}
      </ul>
    </section>
  );
}

/* v1.145.0 - THE ENTITLEMENT EDITOR LIVED HERE TWICE.
   The CEO, 09-09-2026: *"Leave entitlement (2026) seem appear double
   which is Leave entitlement also appear. I want only Leave entitlement
   in the Leave tabs."*

   It was not a second way in - it was a DEAD card. `leave_entitlement`
   is ["super_admin", "ceo"] in the permissions matrix and every
   entitlement route answers everyone else with "Only the CEO can view
   or change leave entitlements", so hr_admin and admin could see this
   control and never use it. The editor that remains is the one in the
   Leave tab, gated client-side on the same two roles the worker enforces. */

/** Payslip / payroll summary: a person and a month, attendance and approved
    leave, printable. GET /staff/payslip (payroll_export) - unchanged. */
export function PayslipCard() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [payUser, setPayUser] = useState(0);
  const [payMonth, setPayMonth] = useState(() => mytToday().slice(0, 7));
  const [payslip, setPayslip] = useState<PayslipData | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void api<{ users?: Staff[], staff?: Staff[] }>(`/users`).then((u) => {
      if (!live) return;
      if (u.data) {
        const list = u.data.users ?? u.data.staff ?? [];
        setStaff(list.filter((x) => x.role !== "customer"));
      }
      setLoaded(true);
    });
    return () => { live = false; };
  }, []);

  return (
    <section className={card} aria-label={L("Payslip / payroll summary", "Slip gaji / ringkasan gaji")}>
      <div className={css.head}>
        <span className={`${css.well} ${css.gold}`}><AppIcon name="pay" /></span>
        <div className={css.headText}>
          <p className={css.title}>{L("Payslip / payroll summary", "Slip gaji / ringkasan gaji")}</p>
          <p className={css.sub}>
            {L("Attendance and approved leave for a month — printable for payroll.", "Kehadiran dan cuti diluluskan untuk sebulan — boleh dicetak untuk gaji.")}
          </p>
        </div>
      </div>
      <div className={css.form}>
        <label className={`${css.field} ${css.grow}`}><span className={fieldLabel}>{L("Staff", "Kakitangan")}</span>
          {!loaded ? <Skel className={css.skelLine} /> : (
            <select className={selectClassSm} value={payUser}
              onChange={(e) => { setPayUser(Number(e.target.value)); setPayslip(null); setFailed(false); }}>
              <option value={0}>{L("Select staff…", "Pilih kakitangan…")}</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
        </label>
        <label className={css.field}><span className={fieldLabel}>{L("Month", "Bulan")}</span>
          <input type="month" className={inputClassSm} value={payMonth} onChange={(e) => { setPayMonth(e.target.value); setPayslip(null); setFailed(false); }} />
        </label>
        <button type="button" className={btnSmPrimary} disabled={!payUser || busy}
          onClick={async () => {
            if (!payUser) return;
            setBusy(true);
            const r = await api<PayslipData>(`/payslip?user_id=${payUser}&month=${payMonth}`);
            setBusy(false);
            /* a refused or incomplete answer draws a sentence, never a crash */
            setPayslip(r.ok && r.data?.attendance ? r.data : null);
            setFailed(!(r.ok && r.data?.attendance));
          }}>{busy ? L("Generating…", "Menjana…") : L("Generate", "Jana")}</button>
        {payslip && (
          <button type="button" className={btnSm}
            onClick={() => printPayslip(payslip)}><AppIcon name="print" />{L("Print", "Cetak")}</button>
        )}
      </div>
      {payslip ? (
        <div className={css.figures}>
          {[
            [L("Days present", "Hari hadir"), payslip.attendance.days_present],
            [L("On time", "Tepat masa"), payslip.attendance.on_time],
            [L("Late", "Lewat"), payslip.attendance.late],
            [L("Half days", "Separuh hari"), payslip.attendance.half_days],
            [L("Early outs", "Keluar awal"), payslip.attendance.early_outs],
            [L("Approved leave", "Cuti diluluskan"), payslip.approved_leave_days],
          ].map(([label, v]) => (
            <div key={label as string} className={css.fig}>
              <p className={css.figLabel}>{label}</p>
              <p className={css.figValue}>{v as number}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className={css.empty}>{failed
          ? L("That summary could not be generated - check the person and the month, or your payroll access.", "Ringkasan itu tidak dapat dijana - semak orang dan bulan, atau akses gaji anda.")
          : L("Pick a person and a month, then Generate.", "Pilih orang dan bulan, kemudian Jana.")}</p>
      )}
    </section>
  );
}

interface PayslipData {
  month: string;
  staff: { name: string; email: string; employee_id?: string; position?: string; department?: string };
  attendance: { days_present: number; on_time: number; late: number; half_days: number; early_outs: number };
  approved_leave_days: number;
}

function printPayslip(p: PayslipData) {
  /* v1.45.0 (security audit C7): payslip values are staff records someone
     typed and this document is a STRING, so React's escaping never runs on
     it. esc() is what stops a name or position containing markup from being
     parsed as markup in the print window. */
  const row = (k: string, v: string | number) =>
    `<tr><td style="padding:4px 8px;color:${DOC.inkSoft}">${esc(k)}</td><td style="padding:4px 8px;font-weight:600;text-align:right">${esc(v)}</td></tr>`;
  openPrintPreview(`<!doctype html><html><head><meta charset="utf-8"><title>${L("Payslip", "Slip gaji")} ${esc(p.staff.name)} ${esc(p.month)}</title>
  <style>/* v1.4.242: this report is a staff TABLE that can run to several pages,
  so it keeps a real @page margin — page 2+ would otherwise print edge to edge.
  Trade-off accepted: the browser's own header/footer strip may appear here. */
  @page{size:A4;margin:18mm}*{-webkit-print-color-adjust: exact; print-color-adjust: exact;}body{font-family:Arial,Helvetica,sans-serif;color:${DOC.navy}}
  h1{font-size:16px;margin:0}small{color:${DOC.muted};letter-spacing:.3em;font-size:9px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  .hd{border-bottom:2px solid ${DOC.navy};padding-bottom:8px;margin-bottom:12px}
  .sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#b8912f;margin-top:16px}</style>
  </head><body onload="window.print()">
  <div class="hd"><small>${DOCUMENT_ISSUER.name}</small><h1>${L("Attendance &amp; Payroll Summary", "Ringkasan Kehadiran &amp; Gaji")}</h1>
  <div style="color:${DOC.inkSoft};font-size:12px;margin-top:4px">${esc(p.month)}</div></div>
  <table>
    ${row(L("Name", "Nama"), p.staff.name)}
    ${row(L("Employee ID", "ID pekerja"), p.staff.employee_id || "—")}
    ${row(L("Position", "Jawatan"), p.staff.position || "—")}
    ${row(L("Department", "Jabatan"), p.staff.department || "—")}
  </table>
  <div class="sec">${L("Attendance", "Kehadiran")}</div>
  <table>
    ${row(L("Days present", "Hari hadir"), p.attendance.days_present)}
    ${row(L("On time", "Tepat masa"), p.attendance.on_time)}
    ${row(L("Late", "Lewat"), p.attendance.late)}
    ${row(L("Half days", "Separuh hari"), p.attendance.half_days)}
    ${row(L("Early outs", "Keluar awal"), p.attendance.early_outs)}
  </table>
  <div class="sec">${L("Leave", "Cuti")}</div>
  <table>${row(L("Approved leave days", "Hari cuti diluluskan"), p.approved_leave_days)}</table>
  <p style="margin-top:24px;font-size:10px;color:${DOC.muted}">${L("Generated", "Dijana")} ${(() => { const i = new Date(Date.now() + 8 * 3600 * 1000).toISOString(); return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)}`; })()} · ${DOCUMENT_ISSUER.registration} · ${L("This is an attendance summary, not a statement of wages.", "Ini ialah ringkasan kehadiran, bukan penyata gaji.")}</p>
  </body></html>`);
}

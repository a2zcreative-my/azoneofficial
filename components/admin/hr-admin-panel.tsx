"use client";

/**
 * HR / payroll administration (v1.4.16), for the admin Staff area:
 *   - Public holidays / company calendar (feeds leave day-counting)
 *   - Leave entitlement editor per staff per year (what balances deduct from)
 *   - Payslip: attendance + approved-leave summary for a month, printable
 */

import { makeApi } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
const api = makeApi("/staff");
import { useCallback, useEffect, useState } from "react";
import { card } from "@/lib/ui-styles";
import { dmy } from "@/lib/format";
import { rowBtnDanger } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { getLang } from "@/lib/i18n";
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);



const input = "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const btn = "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium";

const LEAVE_TYPES = ["annual", "medical", "emergency", "unpaid", "replacement"];
// Display-only BM labels for API values — the values themselves never change.
const LEAVE_TYPE_MS: Record<string, string> = {
  annual: "tahunan", medical: "perubatan", emergency: "kecemasan",
  unpaid: "tanpa gaji", replacement: "gantian",
};
const HOLIDAY_KIND_MS: Record<string, string> = {
  public: "umum", company: "syarikat", replacement: "gantian",
};

interface Staff { id: number; name: string; role: string; employee_id?: string | null; position?: string | null; department?: string | null }
interface Holiday { id: number; holiday_date: string; name: string; kind: string }


/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

export function HrAdminPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holDraft, setHolDraft] = useState({ holiday_date: "", name: "", kind: "public" });

  const [entUser, setEntUser] = useState(0);
  const [entYear] = useState(new Date().getFullYear());
  const [ent, setEnt] = useState<Record<string, number>>({});

  const [payUser, setPayUser] = useState(0);
  const [payMonth, setPayMonth] = useState(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7));
  const [payslip, setPayslip] = useState<PayslipData | null>(null);

  const load = useCallback(async () => {
    const u = await api<{ users?: Staff[], staff?: Staff[] }>(`/users`);
    const h = await api<{ holidays: Holiday[] }>(`/holidays?year=${entYear}`);
    if (u.data) {
      const list = u.data.users ?? u.data.staff ?? [];
      setStaff(list.filter((x) => x.role !== "customer"));
    }
    if (h.data) setHolidays(h.data.holidays ?? []);
  }, [entYear]);
  useEffect(() => {
    void load();
  }, [load]);

  const loadEnt = useCallback(async (uid: number) => {
    if (!uid) return setEnt({});
    const r = await api<{ entitlement: Record<string, number> }>(`/leave/entitlement?user_id=${uid}&year=${entYear}`);
    setEnt(r.data?.entitlement ?? {});
  }, [entYear]);
  useEffect(() => {
    void loadEnt(entUser);
  }, [entUser, loadEnt]);

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}
      {/* Holidays */}
      <div className={card}>
        <p className="text-sm font-semibold">{L("Public holidays & company calendar", "Cuti umum & kalendar syarikat")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Used so leave day-counting, attendance and payroll don't treat a holiday as a working day — and shown in red on everyone's events calendar. Adding a public holiday on a Saturday/Sunday auto-creates its Monday replacement (next free working day if Monday is taken); pick kind \"replacement\" to add one manually, or Remove an auto row you don't want.",
            "Digunakan supaya kiraan hari cuti, kehadiran dan gaji tidak menganggap hari cuti sebagai hari bekerja — dan dipaparkan merah pada kalendar acara semua orang. Menambah cuti umum pada Sabtu/Ahad akan mencipta gantian Isnin secara automatik (hari bekerja kosong berikutnya jika Isnin sudah diambil); pilih jenis \"gantian\" untuk menambah secara manual, atau Buang baris auto yang anda tidak mahu.",
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input type="date" className={`${input} max-w-40`} value={holDraft.holiday_date}
            onChange={(e) => setHolDraft((d) => ({ ...d, holiday_date: e.target.value }))} />
          <input className={`${input} max-w-56`} placeholder={L("Holiday name", "Nama cuti")} value={holDraft.name}
            onChange={(e) => setHolDraft((d) => ({ ...d, name: e.target.value }))} />
          <select className={`${input} max-w-36`} value={holDraft.kind}
            onChange={(e) => setHolDraft((d) => ({ ...d, kind: e.target.value }))}>
            {["public", "company", "replacement"].map((k) => <option key={k} value={k}>{L(k, HOLIDAY_KIND_MS[k] ?? k)}</option>)}
          </select>
          <button type="button" className={btn}
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
            }}>{L("Add", "Tambah")}</button>
        </div>
        <ul className="mt-3 grid grid-cols-1 max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {holidays.map((h) => (
            <li key={h.id} className="border-border flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-sm">
              <span>{dmy(h.holiday_date)} · {h.name}</span>
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
          {holidays.length === 0 && <li className="text-muted-foreground text-sm">{L("No holidays yet.", "Belum ada cuti lagi.")}</li>}
        </ul>
      </div>

      {/* Leave entitlement */}
      <div className={card}>
        <p className="text-sm font-semibold">{L("Leave entitlement", "Kelayakan cuti")} ({entYear})</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Days granted per type. Balances deduct approved leave from these numbers.", "Hari yang diberikan mengikut jenis. Baki menolak cuti yang diluluskan daripada angka ini.")}
        </p>
        <select className={`${input} mt-3 max-w-72`} value={entUser} onChange={(e) => setEntUser(Number(e.target.value))}>
          <option value={0}>{L("Select staff…", "Pilih kakitangan…")}</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
        </select>
        {entUser > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {LEAVE_TYPES.map((t) => (
              <label key={t} className="block">
                <span className="text-muted-foreground mb-0.5 block text-[11px] capitalize">{L(t, LEAVE_TYPE_MS[t] ?? t)}</span>
                <input type="number" min={0} step={0.5} className={input}
                  value={ent[t] ?? 0}
                  onChange={(e) => setEnt((s) => ({ ...s, [t]: Number(e.target.value) }))}
                  onBlur={async () => {
                    await api(`/leave/entitlement`, {
                      method: "PUT",
                      body: JSON.stringify({ user_id: entUser, year: entYear, type: t, entitled: ent[t] ?? 0 }),
                    });
                  }} />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Payslip */}
      <div className={card}>
        <p className="text-sm font-semibold">{L("Payslip / payroll summary", "Slip gaji / ringkasan gaji")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Attendance and approved leave for a month — printable for payroll.", "Kehadiran dan cuti diluluskan untuk sebulan — boleh dicetak untuk gaji.")}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <select className={`${input} max-w-64`} value={payUser} onChange={(e) => setPayUser(Number(e.target.value))}>
            <option value={0}>{L("Select staff…", "Pilih kakitangan…")}</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input type="month" className={`${input} max-w-40`} value={payMonth} onChange={(e) => setPayMonth(e.target.value)} />
          <button type="button" className={btn}
            onClick={async () => {
              if (!payUser) return;
              const r = await api<PayslipData>(`/payslip?user_id=${payUser}&month=${payMonth}`);
              setPayslip(r.data);
            }}>{L("Generate", "Jana")}</button>
          {payslip && (
            <button type="button" className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
              onClick={() => printPayslip(payslip)}>{L("Print", "Cetak")}</button>
          )}
        </div>
        {payslip && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 text-sm">
            {[
              [L("Days present", "Hari hadir"), payslip.attendance.days_present],
              [L("On time", "Tepat masa"), payslip.attendance.on_time],
              [L("Late", "Lewat"), payslip.attendance.late],
              [L("Half days", "Separuh hari"), payslip.attendance.half_days],
              [L("Early outs", "Keluar awal"), payslip.attendance.early_outs],
              [L("Approved leave", "Cuti diluluskan"), payslip.approved_leave_days],
            ].map(([label, v]) => (
              <div key={label as string} className="border-border rounded-lg border px-2.5 py-2">
                <p className="text-muted-foreground text-[11px]">{label}</p>
                <p className="text-lg font-semibold">{v as number}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface PayslipData {
  month: string;
  staff: { name: string; email: string; employee_id?: string; position?: string; department?: string };
  attendance: { days_present: number; on_time: number; late: number; half_days: number; early_outs: number };
  approved_leave_days: number;
}

function printPayslip(p: PayslipData) {
  const w = window.open("", "_blank", "width=800,height=1000");
  if (!w) return;
  const row = (k: string, v: string | number) =>
    `<tr><td style="padding:4px 8px;color:#5b6472">${k}</td><td style="padding:4px 8px;font-weight:600;text-align:right">${v}</td></tr>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${L("Payslip", "Slip gaji")} ${p.staff.name} ${p.month}</title>
  <style>/* v1.4.242: this report is a staff TABLE that can run to several pages,
  so it keeps a real @page margin — page 2+ would otherwise print edge to edge.
  Trade-off accepted: the browser's own header/footer strip may appear here. */
  @page{size:A4;margin:18mm}*{-webkit-print-color-adjust: exact; print-color-adjust: exact;}body{font-family:Arial,Helvetica,sans-serif;color:#1a2946}
  h1{font-size:16px;margin:0}small{color:#8a93a6;letter-spacing:.3em;font-size:9px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  .hd{border-bottom:2px solid #1a2946;padding-bottom:8px;margin-bottom:12px}
  .sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#b8912f;margin-top:16px}</style>
  </head><body onload="window.print()">
  <div class="hd"><small>AZ ONE OFFICIAL</small><h1>${L("Attendance &amp; Payroll Summary", "Ringkasan Kehadiran &amp; Gaji")}</h1>
  <div style="color:#5b6472;font-size:12px;margin-top:4px">${p.month}</div></div>
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
  <p style="margin-top:24px;font-size:10px;color:#8a93a6">${L("Generated", "Dijana")} ${(() => { const i = new Date(Date.now() + 8 * 3600 * 1000).toISOString(); return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)}`; })()} · SSM 202603168673 (JM1046169-H) · ${L("This is an attendance summary, not a statement of wages.", "Ini ialah ringkasan kehadiran, bukan penyata gaji.")}</p>
  </body></html>`);
  w.document.close();
}

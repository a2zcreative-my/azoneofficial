"use client";

/**
 * HR / payroll administration (v1.4.16), for the admin Staff area:
 *   - Public holidays / company calendar (feeds leave day-counting)
 *   - Leave entitlement editor per staff per year (what balances deduct from)
 *   - Payslip: attendance + approved-leave summary for a month, printable
 */

import { useCallback, useEffect, useState } from "react";

const API = "/api/v1/staff";

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
    return { ok: res.ok, status: res.status, data: (res.status === 204 ? null : await res.json()) as T | null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const card = "rounded-lg border border-border bg-card p-3.5 md:p-4";
const input = "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const btn = "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium";

const LEAVE_TYPES = ["annual", "medical", "emergency", "unpaid", "replacement"];

interface Staff { id: number; name: string; role: string; employee_id?: string | null; position?: string | null; department?: string | null }
interface Holiday { id: number; holiday_date: string; name: string; kind: string }


/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */
function dmy(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return iso;
  const date = `${d[2]}-${d[1]}-${d[0]}`;
  const time = iso.length >= 16 ? ` ${iso.slice(11, 16)}` : "";
  return date + time;
}

export function HrAdminPanel() {
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
      {/* Holidays */}
      <div className={card}>
        <p className="text-sm font-semibold">Public holidays &amp; company calendar</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Used so leave day-counting, attendance and payroll don&apos;t treat a
          holiday as a working day — and shown in red on everyone&apos;s events
          calendar. Adding a public holiday on a Saturday/Sunday auto-creates
          its Monday replacement (next free working day if Monday is taken);
          pick kind &quot;replacement&quot; to add one manually, or Remove an
          auto row you don&apos;t want.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input type="date" className={`${input} max-w-40`} value={holDraft.holiday_date}
            onChange={(e) => setHolDraft((d) => ({ ...d, holiday_date: e.target.value }))} />
          <input className={`${input} max-w-56`} placeholder="Holiday name" value={holDraft.name}
            onChange={(e) => setHolDraft((d) => ({ ...d, name: e.target.value }))} />
          <select className={`${input} max-w-36`} value={holDraft.kind}
            onChange={(e) => setHolDraft((d) => ({ ...d, kind: e.target.value }))}>
            {["public", "company", "replacement"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="button" className={btn}
            onClick={async () => {
              if (!holDraft.holiday_date || !holDraft.name.trim()) return;
              await api(`/holidays`, { method: "POST", body: JSON.stringify(holDraft) });
              setHolDraft({ holiday_date: "", name: "", kind: "public" });
              void load();
            }}>Add</button>
        </div>
        <ul className="mt-3 grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {holidays.map((h) => (
            <li key={h.id} className="border-border flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-sm">
              <span>{dmy(h.holiday_date)} · {h.name}</span>
              <button type="button" className="text-destructive text-xs underline"
                onClick={async () => { await api(`/holidays/${h.id}`, { method: "DELETE" }); void load(); }}>
                Remove
              </button>
            </li>
          ))}
          {holidays.length === 0 && <li className="text-muted-foreground text-sm">No holidays yet.</li>}
        </ul>
      </div>

      {/* Leave entitlement */}
      <div className={card}>
        <p className="text-sm font-semibold">Leave entitlement ({entYear})</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Days granted per type. Balances deduct approved leave from these numbers.
        </p>
        <select className={`${input} mt-3 max-w-72`} value={entUser} onChange={(e) => setEntUser(Number(e.target.value))}>
          <option value={0}>Select staff…</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
        </select>
        {entUser > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {LEAVE_TYPES.map((t) => (
              <label key={t} className="block">
                <span className="text-muted-foreground mb-0.5 block text-[11px] capitalize">{t}</span>
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
        <p className="text-sm font-semibold">Payslip / payroll summary</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Attendance and approved leave for a month — printable for payroll.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <select className={`${input} max-w-64`} value={payUser} onChange={(e) => setPayUser(Number(e.target.value))}>
            <option value={0}>Select staff…</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input type="month" className={`${input} max-w-40`} value={payMonth} onChange={(e) => setPayMonth(e.target.value)} />
          <button type="button" className={btn}
            onClick={async () => {
              if (!payUser) return;
              const r = await api<PayslipData>(`/payslip?user_id=${payUser}&month=${payMonth}`);
              setPayslip(r.data);
            }}>Generate</button>
          {payslip && (
            <button type="button" className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
              onClick={() => printPayslip(payslip)}>Print</button>
          )}
        </div>
        {payslip && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 text-sm">
            {[
              ["Days present", payslip.attendance.days_present],
              ["On time", payslip.attendance.on_time],
              ["Late", payslip.attendance.late],
              ["Half days", payslip.attendance.half_days],
              ["Early outs", payslip.attendance.early_outs],
              ["Approved leave", payslip.approved_leave_days],
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
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${p.staff.name} ${p.month}</title>
  <style>/* v1.4.242: this report is a staff TABLE that can run to several pages,
  so it keeps a real @page margin — page 2+ would otherwise print edge to edge.
  Trade-off accepted: the browser's own header/footer strip may appear here. */
  @page{size:A4;margin:18mm}*{-webkit-print-color-adjust: exact; print-color-adjust: exact;}body{font-family:Arial,Helvetica,sans-serif;color:#1a2946}
  h1{font-size:16px;margin:0}small{color:#8a93a6;letter-spacing:.3em;font-size:9px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  .hd{border-bottom:2px solid #1a2946;padding-bottom:8px;margin-bottom:12px}
  .sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#b8912f;margin-top:16px}</style>
  </head><body onload="window.print()">
  <div class="hd"><small>AZ ONE OFFICIAL</small><h1>Attendance &amp; Payroll Summary</h1>
  <div style="color:#5b6472;font-size:12px;margin-top:4px">${p.month}</div></div>
  <table>
    ${row("Name", p.staff.name)}
    ${row("Employee ID", p.staff.employee_id || "—")}
    ${row("Position", p.staff.position || "—")}
    ${row("Department", p.staff.department || "—")}
  </table>
  <div class="sec">Attendance</div>
  <table>
    ${row("Days present", p.attendance.days_present)}
    ${row("On time", p.attendance.on_time)}
    ${row("Late", p.attendance.late)}
    ${row("Half days", p.attendance.half_days)}
    ${row("Early outs", p.attendance.early_outs)}
  </table>
  <div class="sec">Leave</div>
  <table>${row("Approved leave days", p.approved_leave_days)}</table>
  <p style="margin-top:24px;font-size:10px;color:#8a93a6">Generated ${(() => { const i = new Date(Date.now() + 8 * 3600 * 1000).toISOString(); return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)}`; })()} · SSM 202603168673 (JM1046169-H) · This is an attendance summary, not a statement of wages.</p>
  </body></html>`);
  w.document.close();
}

"use client";

/**
 * Payroll processing (v1.4.36).
 *
 * Month picker → every staff member with Basic / Commission / Allowance /
 * Deduction amounts (RM). Save upserts one entry per person per month;
 * Payslip prints a branded AZ ONE OFFICIAL A4 payslip. Processed by the CEO
 * or hr_admin (hr_manage); COO/CCO see it read-only via exec view.
 */

import { useCallback, useEffect, useState } from "react";

const API = "/api/v1/staff";

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: null };
  }
}

const card = "rounded-lg border border-border bg-card p-5";
const inputSm =
  "rounded-lg border border-input bg-background px-2 py-1 text-xs w-24";

const COMPANY = {
  name: "AZ ONE OFFICIAL",
  ssm: "SSM Registration No. 202603168673 (JM1046169-H)",
  location: "Setia Tropika, Johor Bahru, Malaysia",
};

interface StaffRow {
  id: number;
  name: string;
  role: string;
  employee_id?: string | null;
  position?: string | null;
  department?: string | null;
}

interface Entry {
  user_id: number;
  basic_cents: number;
  commission_cents: number;
  allowance_cents: number;
  deduction_cents: number;
  note?: string | null;
}

function rm(cents: number): string {
  return `RM ${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "YYYY-MM" → "MM-YYYY" for display. */
function monthDMY(m: string): string {
  const p = m.split("-");
  return p.length === 2 ? `${p[1]}-${p[0]}` : m;
}

export function PayrollPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [entries, setEntries] = useState<Record<number, Entry>>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [u, p] = await Promise.all([
      api<{ users?: StaffRow[]; staff?: StaffRow[] }>(`/users`),
      api<{ entries: (Entry & { name: string })[] }>(`/payroll?month=${month}`),
    ]);
    const list = (u.data?.users ?? u.data?.staff ?? []).filter(
      (x) => x.role !== "customer" && x.role !== "super_admin",
    );
    const RANK: Record<string, number> = {
      ceo: 1, coo: 2, cco: 3, hr_admin: 4, sales_marketing: 5,
      admin: 6, editor: 7, marketing: 7, live_host: 7,
    };
    list.sort((a, b) => (RANK[a.role] ?? 9) - (RANK[b.role] ?? 9) || a.name.localeCompare(b.name));
    setStaff(list);
    const map: Record<number, Entry> = {};
    for (const e of p.data?.entries ?? []) map[e.user_id] = e;
    setEntries(map);
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  const entry = (id: number): Entry =>
    entries[id] ?? { user_id: id, basic_cents: 0, commission_cents: 0, allowance_cents: 0, deduction_cents: 0 };

  const setField = (id: number, key: keyof Entry, rmValue: string) => {
    const cents = Math.max(0, Math.round(Number(rmValue || 0) * 100));
    setEntries((m) => ({ ...m, [id]: { ...entry(id), [key]: cents } }));
  };

  const save = async (id: number) => {
    setMsg("");
    const res = await api<{ error?: { message?: string } }>(`/payroll`, {
      method: "POST",
      body: JSON.stringify({ ...entry(id), month }),
    });
    setMsg(res.ok ? "Saved." : (res.data?.error?.message ?? "Save failed"));
    window.setTimeout(() => setMsg(""), 2500);
    void load();
  };

  const printSlip = (u: StaffRow) => {
    const e = entry(u.id);
    const net = e.basic_cents + e.commission_cents + e.allowance_cents - e.deduction_cents;
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Payslip ${u.name} ${monthDMY(month)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #16202e; margin: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1a2946; padding-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand img { height: 46px; }
  .brand .n { font-size: 18px; font-weight: 700; color: #1a2946; letter-spacing: .5px; }
  .brand .s { font-size: 10px; color: #5b6472; }
  h1 { font-size: 16px; color: #1a2946; margin: 0; text-align: right; }
  .muted { color: #5b6472; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e3e6ea; }
  th { background: #f2f4f7; color: #1a2946; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  td.amt, th.amt { text-align: right; font-variant-numeric: tabular-nums; }
  .net { background: #1a2946; color: #fff; font-weight: 700; font-size: 13px; }
  .net td { border: none; padding: 10px; }
  .foot { margin-top: 26px; font-size: 10px; color: #5b6472; border-top: 1px solid #e3e6ea; padding-top: 8px; }
</style></head><body>
  <div class="head">
    <div class="brand">
      <img src="${window.location.origin}/logo.png" alt="" onerror="this.style.display='none'">
      <div>
        <div class="n">${COMPANY.name}</div>
        <div class="s">${COMPANY.ssm}<br>${COMPANY.location}</div>
      </div>
    </div>
    <div>
      <h1>PAYSLIP</h1>
      <div class="muted" style="text-align:right">Month: ${monthDMY(month)}</div>
    </div>
  </div>

  <table>
    <tr><th style="width:30%">Employee</th><td>${u.name}</td></tr>
    <tr><th>Employee ID</th><td>${u.employee_id ?? "—"}</td></tr>
    <tr><th>Position</th><td>${u.position ?? "—"}${u.department ? " · " + u.department : ""}</td></tr>
  </table>

  <table>
    <tr><th>Earnings</th><th class="amt">Amount</th></tr>
    <tr><td>Basic salary</td><td class="amt">${rm(e.basic_cents)}</td></tr>
    <tr><td>Commission</td><td class="amt">${rm(e.commission_cents)}</td></tr>
    <tr><td>Allowance</td><td class="amt">${rm(e.allowance_cents)}</td></tr>
    <tr><th>Deductions</th><th class="amt"></th></tr>
    <tr><td>Deductions</td><td class="amt">− ${rm(e.deduction_cents)}</td></tr>
  </table>

  <table class="net"><tr><td>NET PAY</td><td class="amt" style="text-align:right">${rm(Math.max(0, net))}</td></tr></table>
  ${e.note ? `<p class="muted">Note: ${e.note}</p>` : ""}

  <div class="foot">
    Computer-generated payslip issued by ${COMPANY.name}. No statutory
    deductions (EPF / SOCSO / EIS) are applied at present — the basic salary is
    paid in full. This will be revised if the company's statutory obligations change.
    Generated ${new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).split("-").reverse().join("-")} (MYT).
  </div>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
    w.document.close();
  };

  return (
    <div className={`${card} mt-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Payroll processing</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Basic + commission + allowance − deductions = net. One entry per
            person per month; Payslip prints the branded A4 slip.
          </p>
        </div>
        <input
          type="month"
          className="border-input bg-background rounded-lg border px-2 py-1 text-sm"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}

      <div className="mt-3 max-h-[30rem] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Staff</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Basic (RM)</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Commission</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Allowance</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Deduction</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Net</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => {
              const e = entry(u.id);
              const net = e.basic_cents + e.commission_cents + e.allowance_cents - e.deduction_cents;
              return (
                <tr key={u.id} className="border-border border-b last:border-0">
                  <td className="px-2 py-1.5">
                    <span className="font-medium">{u.name}</span>{" "}
                    <span className="text-muted-foreground text-xs">{u.position ?? u.role}</span>
                  </td>
                  {(["basic_cents", "commission_cents", "allowance_cents", "deduction_cents"] as const).map((k) => (
                    <td key={k} className="px-2 py-1.5">
                      <input
                        type="number" min={0} step="0.01"
                        className={inputSm}
                        disabled={readOnly}
                        value={e[k] ? (e[k] / 100).toString() : ""}
                        placeholder="0.00"
                        onChange={(ev) => setField(u.id, k, ev.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 font-medium whitespace-nowrap">{rm(Math.max(0, net))}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {!readOnly && (
                      <button type="button" className="text-xs underline" onClick={() => void save(u.id)}>
                        Save
                      </button>
                    )}
                    <button type="button" className="ml-2 text-xs underline" onClick={() => printSlip(u)}>
                      Payslip
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

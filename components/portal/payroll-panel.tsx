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

const _COMPANY = {
  name: "AZ ONE OFFICIAL",
  ssm: "SSM Registration No. 202603168673 (JM1046169-H)",
  location: "Setia Tropika, Johor Bahru, Malaysia",
};

interface StaffRow {
  id: number;
  name: string;
  full_name?: string | null;
  role: string;
  employee_id?: string | null;
  position?: string | null;
  department?: string | null;
  employment_status?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  joined_on?: string | null;
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

/** Branded A4 payslip print — shared by the processing panel and every
    staff member's read-only "My payslip" card. */
export function printPayslip(
  u: StaffRow & { employment_status?: string | null },
  e: Entry,
  month: string,
  x?: { working_day: number; public_holiday: number; annual_leave: number; medical_leave: number; annual_bal: number; sick_bal: number } | null,
) {
  const gross = e.basic_cents + e.commission_cents + e.allowance_cents;
  const net = Math.max(0, gross - e.deduction_cents);
  const [yy, mm] = month.split("-");
  const lastDay = new Date(Number(yy), Number(mm), 0).getDate();
  const period = { from: `01-${mm}-${yy}`, to: `${String(lastDay).padStart(2, "0")}-${mm}-${yy}` };
  const amt = (c: number) => (c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n2 = (v: number) => v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Earnings: basic always; commission/allowance only when present.
  const earn: [string, number][] = [["BASIC PAY", e.basic_cents]];
  if (e.commission_cents > 0) earn.push(["COMMISSION", e.commission_cents]);
  if (e.allowance_cents > 0) earn.push(["ALLOWANCE", e.allowance_cents]);
  // Deductions appear ONLY when late — the deduction field records lateness.
  const dedRows = e.deduction_cents > 0
    ? `<tr><td>LATE DEDUCTION</td><td class="amt">${amt(e.deduction_cents)}</td></tr>`
    : `<tr><td class="muted">NO DEDUCTION</td><td class="amt"></td></tr>`;
  const othersRows = x
    ? `<tr><td>WORKING DAY</td><td class="amt">${n2(x.working_day)}</td></tr>
       <tr><td>PUBLIC HOLIDAY</td><td class="amt">${n2(x.public_holiday)}</td></tr>
       <tr><td>ANNUAL LEAVE</td><td class="amt">${n2(x.annual_leave)}</td></tr>
       <tr><td>MEDICAL LEAVE</td><td class="amt">${n2(x.medical_leave)}</td></tr>`
    : "";

  const w = window.open("", "_blank", "width=900,height=950");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Payslip ${u.name} ${monthDMY(month)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; font-size: 12px; }
  .sheet { border: 1.5px solid #000; }
  .info { width: 100%; border-collapse: collapse; }
  .info td { padding: 3px 8px; vertical-align: top; }
  .info .l { font-weight: bold; white-space: nowrap; }
  .cols { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .cols th { border: 1px solid #000; padding: 4px; text-align: center; }
  .cols > tbody > tr.main > td { border: 1px solid #000; padding: 0; vertical-align: top; height: 230px; }
  .cols > tbody > tr.totals > td { border: 1px solid #000; padding: 0; }
  .inner { width: 100%; border-collapse: collapse; }
  .inner td { padding: 3px 8px; }
  .inner .amt { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #444; }
  .total td { font-weight: bold; }
  .bottom { width: 100%; border-collapse: collapse; }
  .bottom td { border: 1px solid #000; padding: 5px 8px; }
  .nett { font-weight: bold; font-size: 13px; }
  .company { margin-top: 8px; font-weight: bold; font-size: 13px; }
  .company span { font-weight: normal; font-size: 11px; }
</style></head><body>
  <div class="sheet">
    <table class="info">
      <tr>
        <td class="l">EMP'EE #/NAME</td><td>: ${u.employee_id ?? "—"} / ${(u.full_name || u.name).toUpperCase()}</td>
        <td class="l">DEPT./SECTION</td><td>: ${(u.department ?? "—").toUpperCase()} / ${(u.position ?? "—").toUpperCase()}</td>
      </tr>
      <tr>
        <td class="l">STATUS</td><td>: ${(u.employment_status ?? "—").replace("_", " ").toUpperCase()}</td>
        <td class="l">PERIOD</td><td>: ${period.from} &nbsp;TO&nbsp; ${period.to}</td>
      </tr>
      <tr>
        <td class="l">BANK</td><td>: ${(u.bank_name ?? "—").toUpperCase()}${u.bank_account ? " · " + u.bank_account : ""}</td>
        <td></td><td></td>
      </tr>
    </table>
    <table class="cols">
      <thead>
        <tr><th style="width:38%">EARNINGS / INCOME</th><th style="width:31%">DEDUCTIONS</th><th style="width:31%">OTHERS</th></tr>
      </thead>
      <tbody>
        <tr class="main">
          <td><table class="inner">
            ${earn.map(([label, c]) => `<tr><td>${label}</td><td class="amt">${amt(c)}</td></tr>`).join("")}
          </table></td>
          <td><table class="inner">${dedRows}</table></td>
          <td><table class="inner">${othersRows}</table></td>
        </tr>
        <tr class="totals">
          <td><table class="inner"><tr class="total"><td>TOTAL :</td><td class="amt">${amt(gross)}</td></tr></table></td>
          <td><table class="inner"><tr class="total"><td>TOTAL :</td><td class="amt">${amt(e.deduction_cents)}</td></tr></table></td>
          <td><table class="inner">
            <tr><td>ANNL. BAL. :</td><td class="amt">${x ? n2(x.annual_bal) : "—"}</td></tr>
            <tr><td>SICK BAL. :</td><td class="amt">${x ? n2(x.sick_bal) : "—"}</td></tr>
          </table></td>
        </tr>
      </tbody>
    </table>
    <table class="bottom">
      <tr>
        <td style="width:69%">${e.note ? "NOTE : " + e.note : ""}</td>
        <td class="nett" style="width:31%">NETT PAY : <span style="float:right">${amt(net)}</span></td>
      </tr>
    </table>
  </div>
  <p class="company">AZ ONE OFFICIAL <span>(SSM 202603168673 / JM1046169-H) · Setia Tropika, Johor Bahru, Malaysia · Computer-generated payslip — no signature required.</span></p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
  w.document.close();
}

export function PayrollPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [entries, setEntries] = useState<Record<number, Entry>>({});
  const [msg, setMsg] = useState("");
  // Working-day proration (v1.4.43): Malaysia counts working days per month
  // (e.g. July 2026 = 26). Enter the month's working days once, a person's
  // days worked on their row, and Prorate computes basic × worked/total —
  // e.g. RM2100 basic, joined 20 July (10 of 26 days) → RM807.69.
  const [monthDays, setMonthDays] = useState(26);
  const [workedDays, setWorkedDays] = useState<Record<number, number>>({});

  const prorate = (id: number) => {
    const d = workedDays[id];
    if (!d || !monthDays) return;
    const e = entry(id);
    if (!e.basic_cents) return;
    const prorated = Math.round((e.basic_cents * Math.min(d, monthDays)) / monthDays);
    setEntries((m) => ({ ...m, [id]: { ...e, basic_cents: prorated } }));
  };

  const saveAll = async () => {
    setMsg("");
    let n = 0;
    for (const u of staff) {
      const e = entries[u.id];
      if (!e) continue;
      const res = await api(`/payroll`, { method: "POST", body: JSON.stringify({ ...e, month }) });
      if (res.ok) n += 1;
    }
    setMsg(`Saved ${n} ${n === 1 ? "entry" : "entries"} for ${month}.`);
    window.setTimeout(() => setMsg(""), 3000);
    void load();
  };

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

  const printSlip = async (u: StaffRow) => {
    const d = await api<{ extras: Parameters<typeof printPayslip>[3] }>(`/payroll/detail?user_id=${u.id}&month=${month}`);
    printPayslip(u, entry(u.id), month, d.data?.extras ?? null);
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
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-muted-foreground text-xs">
            Working days this month{" "}
            <input
              type="number" min={1} max={31}
              className="border-input bg-background w-16 rounded-lg border px-2 py-1 text-sm"
              value={monthDays}
              onChange={(e) => setMonthDays(Math.max(1, Number(e.target.value)))}
            />
          </label>
          <input
            type="month"
            className="border-input bg-background rounded-lg border px-2 py-1 text-sm"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <button
            type="button"
            className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
            onClick={() => void saveAll()}
          >
            Save all
          </button>
        </div>
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
                      <>
                        <input
                          type="number" min={0} max={31}
                          className="border-input bg-background w-12 rounded border px-1 py-0.5 text-xs"
                          placeholder="d"
                          title={`Days worked (of ${monthDays})`}
                          value={workedDays[u.id] ?? ""}
                          onChange={(ev) => setWorkedDays((m) => ({ ...m, [u.id]: Number(ev.target.value) }))}
                        />
                        <button type="button" className="ml-1 text-xs underline" title="Basic × days / working days"
                          onClick={() => prorate(u.id)}>
                          Prorate
                        </button>
                        <button type="button" className="ml-2 text-xs underline" onClick={() => void save(u.id)}>
                          Save
                        </button>
                      </>
                    )}
                    <button type="button" className="ml-2 text-xs underline" onClick={() => void printSlip(u)}>
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

/**
 * "My payslip" (v1.4.40): every staff member can view and PRINT their own
 * payslip for a chosen month — amounts are display-only, editing lives with
 * the payroll processors (CEO/COO). No entry yet → clearly says so.
 */
export function MyPayslip() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [entry, setEntry] = useState<(Entry & StaffRow) | null>(null);
  const [extras, setExtras] = useState<Parameters<typeof printPayslip>[3]>(null);
  const [joinedOn, setJoinedOn] = useState<string | null>(null);

  useEffect(() => {
    void api<{ entry: (Entry & StaffRow) | null; extras: Parameters<typeof printPayslip>[3]; joined_on?: string | null }>(
      `/payroll/self?month=${month}`,
    ).then((r) => {
      setEntry(r.data?.entry ?? null);
      setExtras(r.data?.extras ?? null);
      setJoinedOn(r.data?.joined_on ?? null);
    });
  }, [month]);

  // Months before the person joined AZ ONE OFFICIAL have no payslip — the
  // button greys out instead of pretending one could exist.
  const beforeJoining = Boolean(joinedOn && month < joinedOn.slice(0, 7));

  const net = entry
    ? entry.basic_cents + entry.commission_cents + entry.allowance_cents - entry.deduction_cents
    : 0;

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">My payslip</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            View and print your payslip. Amounts are set by payroll processing
            and cannot be edited here.
          </p>
        </div>
        <input
          type="month"
          className="border-input bg-background rounded-lg border px-2 py-1 text-sm"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>
      {beforeJoining ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            You joined AZ ONE OFFICIAL on {joinedOn!.split("-").reverse().join("-")} — no payslip exists for this month.
          </p>
          <button
            type="button"
            disabled
            className="inline-flex h-8 cursor-not-allowed items-center rounded-lg bg-gray-300 px-3 text-xs font-medium text-gray-500"
          >
            Print payslip
          </button>
        </div>
      ) : entry ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Basic {rm(entry.basic_cents)} · Commission {rm(entry.commission_cents)} ·
            Allowance {rm(entry.allowance_cents)} · Deduction {rm(entry.deduction_cents)} ·{" "}
            <span className="font-semibold">Net {rm(Math.max(0, net))}</span>
          </span>
          <button
            type="button"
            className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
            onClick={() => printPayslip(entry, entry, month, extras)}
          >
            Print payslip
          </button>
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">
          No payslip for this month yet — it appears once payroll is processed.
        </p>
      )}
    </div>
  );
}

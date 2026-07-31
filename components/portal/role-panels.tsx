"use client";

/**
 * Role-specific portal modules (v1.4.4).
 *
 * One panel per business function, matching the role matrix in
 * docs/ADMIN_GUIDE.md:
 *   HrPanel         — hr_admin: attendance verification table, task reports,
 *                     leave administration, birthdays. (Docs live in the
 *                     existing Sales tab, which hr_admin can also see.)
 *   InventoryPanel  — sales_marketing: stock, postage tracking, materials.
 *   CommercialPanel — cco: BD pipeline (open / pending / KIV / closed) + strategy.
 *   OperationsPanel — coo: daily operational + sales report, strategy note.
 *   OverviewPanel   — ceo: read-only monitor across every module.
 *
 * All data flows through /api/v1/staff/* with server-side permission checks —
 * these panels are conveniences, not the security boundary.
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
    return {
      ok: res.ok,
      status: res.status,
      data: (res.status === 204 ? null : await res.json()) as T | null,
    };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const btnClass =
  "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50";
const card = "rounded-lg border border-border bg-card p-5";
const th = "px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase text-muted-foreground";
const td = "px-3 py-2 text-sm";

function Badge({ value }: { value: string }) {
  const tone =
    ["late", "early_out", "out_of_stock", "closed_lost", "rejected", "returned"].includes(value)
      ? "bg-destructive/10 text-destructive"
      : ["ok", "delivered", "closed_won", "done", "in_stock", "approved"].includes(value)
        ? "bg-green-600/10 text-green-700"
        : "bg-secondary text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

/* ================= HR & Administrative ================= */

interface AttendanceRow {
  name: string;
  email: string;
  user_id: number;
  type: string;
  myt_time: string;
  flag: string;
  workday: boolean;
}

export function HrPanel() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [shift, setShift] = useState("");
  const [reports, setReports] = useState<
    { id: number; period: string; report_date: string; content: string; author: string }[]
  >([]);
  const [draft, setDraft] = useState({
    period: "daily",
    report_date: new Date().toISOString().slice(0, 10),
    content: "",
  });
  const [birthdays, setBirthdays] = useState<{ name: string; birthday: string }[]>([]);

  const load = useCallback(async () => {
    const [a, r, b] = await Promise.all([
      api<{ shift: string; records: AttendanceRow[] }>(`/attendance/report?month=${month}`),
      api<{ reports: typeof reports }>(`/task-reports`),
      api<{ birthdays: typeof birthdays }>(`/birthdays`),
    ]);
    if (a.data) {
      setRows(a.data.records);
      setShift(a.data.shift);
    }
    if (r.data) setReports(r.data.reports);
    if (b.data) setBirthdays(b.data.birthdays);
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  const submitReport = async () => {
    if (!draft.content.trim()) return;
    await api(`/task-reports`, { method: "POST", body: JSON.stringify(draft) });
    setDraft((d) => ({ ...d, content: "" }));
    void load();
  };

  return (
    <div className="space-y-6">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Attendance verification</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Company accounts · shift {shift || "10:00–18:00 MYT, Monday–Friday"} · CSV export for payroll
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="month"
              className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            <a
              href={`/api/v1/staff/attendance/export?month=${month}`}
              className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium"
            >
              Export CSV
            </a>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>Staff</th>
                <th className={th}>Email</th>
                <th className={th}>Event</th>
                <th className={th}>Time (MYT)</th>
                <th className={th}>Shift check</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} text-muted-foreground`} colSpan={5}>
                    No attendance records for this month yet.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="border-border border-b last:border-0">
                  <td className={`${td} font-medium`}>{r.name}</td>
                  <td className={`${td} text-muted-foreground`}>{r.email}</td>
                  <td className={td}>{r.type.replace(/_/g, " ")}</td>
                  <td className={td}>{r.myt_time}</td>
                  <td className={td}>
                    <Badge value={r.flag} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">Task report</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Daily, weekly, or monthly — visible to management.
          </p>
          <div className="mt-3 flex gap-2">
            <select
              className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.period}
              onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <input
              type="date"
              className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.report_date}
              onChange={(e) => setDraft((d) => ({ ...d, report_date: e.target.value }))}
            />
          </div>
          <textarea
            className={`${inputClass} mt-2 min-h-24`}
            placeholder="What was completed, what is pending, what needs attention…"
            value={draft.content}
            onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          />
          <button type="button" className={`${btnClass} mt-2`} onClick={() => void submitReport()}>
            Submit report
          </button>
          <ul className="mt-4 space-y-2">
            {reports.slice(0, 5).map((r) => (
              <li key={r.id} className="border-border rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium capitalize">{r.period}</span>{" "}
                <span className="text-muted-foreground">· {r.report_date} · {r.author}</span>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{r.content}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">Staff birthdays</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Maintained in the staff directory (birthday field). Sorted by month and day.
          </p>
          <ul className="mt-3 space-y-1.5">
            {birthdays.length === 0 && (
              <li className="text-muted-foreground text-sm">
                No birthdays recorded yet — add them via the staff directory.
              </li>
            )}
            {birthdays.map((b) => (
              <li key={b.name} className="flex justify-between text-sm">
                <span>{b.name}</span>
                <span className="text-muted-foreground">{b.birthday}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-4 text-xs">
            Leave administration (annual / medical / emergency) is in the{" "}
            <span className="font-medium">Leave</span> tab — HR sees every request there and can
            approve or reject. Quotations, DO and invoices are in the{" "}
            <span className="font-medium">Sales</span> tab with the QT-AZOODDMMYY-X numbering.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================= Sales & Marketing ================= */

interface InvItem {
  id: number;
  sku: string;
  name: string;
  stock: number;
  status: string;
  updated_by_name?: string;
}
interface PostRec {
  id: number;
  order_ref: string;
  courier?: string;
  tracking_no?: string;
  status: string;
}
interface Material {
  id: number;
  title: string;
  status: string;
  requested_by_name?: string;
}

export function InventoryPanel() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [postage, setPostage] = useState<PostRec[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [invDraft, setInvDraft] = useState({ sku: "", name: "", stock: 0 });
  const [postDraft, setPostDraft] = useState({ order_ref: "", courier: "", tracking_no: "" });
  const [matDraft, setMatDraft] = useState("");

  const load = useCallback(async () => {
    const [i, p, m] = await Promise.all([
      api<{ items: InvItem[] }>(`/inventory`),
      api<{ records: PostRec[] }>(`/postage`),
      api<{ materials: Material[] }>(`/materials`),
    ]);
    if (i.data) setItems(i.data.items);
    if (p.data) setPostage(p.data.records);
    if (m.data) setMaterials(m.data.materials);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className={card}>
        <p className="text-sm font-semibold">Inventory — live status &amp; stock</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className={`${inputClass} max-w-32`} placeholder="SKU" value={invDraft.sku}
            onChange={(e) => setInvDraft((d) => ({ ...d, sku: e.target.value }))} />
          <input className={`${inputClass} max-w-56`} placeholder="Item name" value={invDraft.name}
            onChange={(e) => setInvDraft((d) => ({ ...d, name: e.target.value }))} />
          <input type="number" min={0} className={`${inputClass} max-w-24`} value={invDraft.stock}
            onChange={(e) => setInvDraft((d) => ({ ...d, stock: Number(e.target.value) }))} />
          <button type="button" className={btnClass}
            onClick={async () => {
              await api(`/inventory`, { method: "POST", body: JSON.stringify(invDraft) });
              setInvDraft({ sku: "", name: "", stock: 0 });
              void load();
            }}>
            Add item
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>SKU</th><th className={th}>Item</th>
                <th className={th}>Stock</th><th className={th}>Status</th><th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-border border-b last:border-0">
                  <td className={`${td} font-mono text-xs`}>{it.sku}</td>
                  <td className={`${td} font-medium`}>{it.name}</td>
                  <td className={td}>{it.stock}</td>
                  <td className={td}><Badge value={it.status} /></td>
                  <td className={td}>
                    <span className="flex items-center gap-1">
                      <button type="button" className="rounded border border-border px-2 text-xs"
                        onClick={async () => {
                          await api(`/inventory/${it.id}`, { method: "PATCH", body: JSON.stringify({ stock: Math.max(0, it.stock - 1) }) });
                          void load();
                        }}>−</button>
                      <button type="button" className="rounded border border-border px-2 text-xs"
                        onClick={async () => {
                          await api(`/inventory/${it.id}`, { method: "PATCH", body: JSON.stringify({ stock: it.stock + 1 }) });
                          void load();
                        }}>+</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">Postage tracking</p>
          <div className="mt-3 space-y-2">
            <input className={inputClass} placeholder="Order reference" value={postDraft.order_ref}
              onChange={(e) => setPostDraft((d) => ({ ...d, order_ref: e.target.value }))} />
            <div className="flex gap-2">
              <input className={inputClass} placeholder="Courier" value={postDraft.courier}
                onChange={(e) => setPostDraft((d) => ({ ...d, courier: e.target.value }))} />
              <input className={inputClass} placeholder="Tracking no." value={postDraft.tracking_no}
                onChange={(e) => setPostDraft((d) => ({ ...d, tracking_no: e.target.value }))} />
            </div>
            <button type="button" className={btnClass}
              onClick={async () => {
                if (!postDraft.order_ref.trim()) return;
                await api(`/postage`, { method: "POST", body: JSON.stringify(postDraft) });
                setPostDraft({ order_ref: "", courier: "", tracking_no: "" });
                void load();
              }}>
              Add record
            </button>
          </div>
          <ul className="mt-4 space-y-2">
            {postage.slice(0, 8).map((r) => (
              <li key={r.id} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{r.order_ref}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {r.courier ?? "—"} · {r.tracking_no ?? "no tracking yet"}
                  </span>
                </span>
                <select
                  className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                  value={r.status}
                  onChange={async (e) => {
                    await api(`/postage/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) });
                    void load();
                  }}
                >
                  {["preparing", "shipped", "in_transit", "delivered", "returned"].map((st) => (
                    <option key={st} value={st}>{st.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">Marketing materials</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Track what sales needs — request new material, mark it done when produced.
          </p>
          <div className="mt-3 flex gap-2">
            <input className={inputClass} placeholder="e.g. Raya campaign product cards" value={matDraft}
              onChange={(e) => setMatDraft(e.target.value)} />
            <button type="button" className={btnClass}
              onClick={async () => {
                if (!matDraft.trim()) return;
                await api(`/materials`, { method: "POST", body: JSON.stringify({ title: matDraft }) });
                setMatDraft("");
                void load();
              }}>
              Request
            </button>
          </div>
          <ul className="mt-4 space-y-2">
            {materials.map((m) => (
              <li key={m.id} className="border-border flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium">{m.title}</span>
                <select
                  className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                  value={m.status}
                  onChange={async (e) => {
                    await api(`/materials/${m.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) });
                    void load();
                  }}
                >
                  {["requested", "in_progress", "done", "rejected"].map((st) => (
                    <option key={st} value={st}>{st.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ================= Chief Commercial Officer ================= */

interface Deal {
  id: number;
  client: string;
  status: string;
  value_note?: string;
  strategy?: string;
  next_action?: string;
  owner_name?: string;
}

export function CommercialPanel() {
  const [pipeline, setPipeline] = useState<Deal[]>([]);
  const [draft, setDraft] = useState({ client: "", value_note: "", strategy: "", next_action: "" });

  const load = useCallback(async () => {
    const r = await api<{ pipeline: Deal[] }>(`/bd`);
    if (r.data) setPipeline(r.data.pipeline);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className={card}>
        <p className="text-sm font-semibold">New business development entry</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className={inputClass} placeholder="Client / prospect" value={draft.client}
            onChange={(e) => setDraft((d) => ({ ...d, client: e.target.value }))} />
          <input className={inputClass} placeholder="Deal size / scope (optional)" value={draft.value_note}
            onChange={(e) => setDraft((d) => ({ ...d, value_note: e.target.value }))} />
          <input className={inputClass} placeholder="Next action" value={draft.next_action}
            onChange={(e) => setDraft((d) => ({ ...d, next_action: e.target.value }))} />
          <input className={inputClass} placeholder="Strategy note" value={draft.strategy}
            onChange={(e) => setDraft((d) => ({ ...d, strategy: e.target.value }))} />
        </div>
        <button type="button" className={`${btnClass} mt-3`}
          onClick={async () => {
            if (!draft.client.trim()) return;
            await api(`/bd`, { method: "POST", body: JSON.stringify(draft) });
            setDraft({ client: "", value_note: "", strategy: "", next_action: "" });
            void load();
          }}>
          Add to pipeline
        </button>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">Pipeline</p>
        <div className="mt-3 max-h-[26rem] overflow-x-auto overflow-y-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>Client</th><th className={th}>Status</th>
                <th className={th}>Next action</th><th className={th}>Strategy</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.length === 0 && (
                <tr><td className={`${td} text-muted-foreground`} colSpan={4}>Pipeline is empty.</td></tr>
              )}
              {pipeline.map((deal) => (
                <tr key={deal.id} className="border-border border-b align-top last:border-0">
                  <td className={`${td} font-medium`}>
                    {deal.client}
                    {deal.value_note && (
                      <span className="text-muted-foreground block text-xs">{deal.value_note}</span>
                    )}
                  </td>
                  <td className={td}>
                    <select
                      className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                      value={deal.status}
                      onChange={async (e) => {
                        await api(`/bd/${deal.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) });
                        void load();
                      }}
                    >
                      {["open", "pending", "kiv", "closed_won", "closed_lost"].map((st) => (
                        <option key={st} value={st}>{st.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </td>
                  <td className={`${td} text-muted-foreground`}>{deal.next_action ?? "—"}</td>
                  <td className={`${td} text-muted-foreground max-w-64`}>{deal.strategy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ================= Chief Operation Officer ================= */

interface OpsReport {
  id: number;
  report_date: string;
  operational_summary: string;
  sales_summary?: string;
  strategy_note?: string;
  author?: string;
}

export function OperationsPanel() {
  const [reports, setReports] = useState<OpsReport[]>([]);
  const [draft, setDraft] = useState({
    report_date: new Date().toISOString().slice(0, 10),
    operational_summary: "",
    sales_summary: "",
    strategy_note: "",
  });

  const load = useCallback(async () => {
    const r = await api<{ reports: OpsReport[] }>(`/ops-reports`);
    if (r.data) setReports(r.data.reports);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className={card}>
        <p className="text-sm font-semibold">Daily operational report</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          One per day — submitting again for the same date updates it.
        </p>
        <input type="date" className="mt-3 rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          value={draft.report_date}
          onChange={(e) => setDraft((d) => ({ ...d, report_date: e.target.value }))} />
        <textarea className={`${inputClass} mt-2 min-h-20`} placeholder="Operational status today…"
          value={draft.operational_summary}
          onChange={(e) => setDraft((d) => ({ ...d, operational_summary: e.target.value }))} />
        <textarea className={`${inputClass} mt-2 min-h-16`} placeholder="Sales results today…"
          value={draft.sales_summary}
          onChange={(e) => setDraft((d) => ({ ...d, sales_summary: e.target.value }))} />
        <textarea className={`${inputClass} mt-2 min-h-16`}
          placeholder="Operation strategy for sales & marketing…"
          value={draft.strategy_note}
          onChange={(e) => setDraft((d) => ({ ...d, strategy_note: e.target.value }))} />
        <button type="button" className={`${btnClass} mt-3`}
          onClick={async () => {
            if (!draft.operational_summary.trim()) return;
            await api(`/ops-reports`, { method: "POST", body: JSON.stringify(draft) });
            setDraft((d) => ({ ...d, operational_summary: "", sales_summary: "", strategy_note: "" }));
            void load();
          }}>
          Submit report
        </button>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">Recent reports</p>
        <ul className="mt-3 space-y-3">
          {reports.length === 0 && (
            <li className="text-muted-foreground text-sm">No reports yet.</li>
          )}
          {reports.slice(0, 10).map((r) => (
            <li key={r.id} className="border-border rounded-lg border px-3 py-2">
              <p className="text-sm font-medium">
                {r.report_date}
                {r.author && <span className="text-muted-foreground font-normal"> · {r.author}</span>}
              </p>
              <p className="mt-1 text-sm">{r.operational_summary}</p>
              {r.sales_summary && (
                <p className="text-muted-foreground mt-1 text-xs">Sales: {r.sales_summary}</p>
              )}
              {r.strategy_note && (
                <p className="text-muted-foreground mt-1 text-xs">Strategy: {r.strategy_note}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ================= Chief Executive Officer ================= */

interface Overview {
  date: string;
  clocked_in_today: number;
  pending_leave: number;
  documents: { doc_type: string; n: number }[];
  low_stock_items: number;
  bd_pipeline: { status: string; n: number }[];
  latest_ops_report: {
    report_date: string;
    operational_summary: string;
    sales_summary?: string;
  } | null;
  task_summary?: { status: string; n: number }[];
  task_by_staff?: { name: string; role: string; open_tasks: number; done_tasks: number }[];
  inventory_status?: { status: string; n: number }[];
}

export function OverviewPanel() {
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    void api<Overview>(`/overview`).then((r) => {
      if (r.data) setData(r.data);
    });
  }, []);

  if (!data) return <p className="text-muted-foreground text-sm">Loading overview…</p>;

  const stat = (label: string, value: string | number) => (
    <div className={card}>
      <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stat("Clocked in today", data.clocked_in_today)}
        {stat("Pending leave requests", data.pending_leave)}
        {stat("Low / out-of-stock items", data.low_stock_items)}
        {stat(
          "Open BD deals",
          data.bd_pipeline.filter((b) => ["open", "pending", "kiv"].includes(b.status))
            .reduce((sum, b) => sum + b.n, 0),
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">Sales documents issued to clients</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            How many quotations, delivery orders and invoices the team has
            created in the Sales module — a quick read on client activity.
          </p>
          <ul className="mt-3 space-y-1.5">
            {data.documents.length === 0 && (
              <li className="text-muted-foreground text-sm">None yet — created documents will count here.</li>
            )}
            {data.documents.map((doc) => (
              <li key={doc.doc_type} className="flex justify-between text-sm">
                <span>{({ QT: "Quotations", DO: "Delivery orders", INV: "Invoices" } as Record<string, string>)[doc.doc_type] ?? doc.doc_type}</span>
                <span className="font-medium">{doc.n}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold mt-5">BD pipeline</p>
          <ul className="mt-2 space-y-1.5">
            {data.bd_pipeline.map((entry) => (
              <li key={entry.status} className="flex justify-between text-sm">
                <span><Badge value={entry.status} /></span>
                <span className="font-medium">{entry.n}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">Latest operational report</p>
          {data.latest_ops_report ? (
            <div className="mt-2">
              <p className="text-muted-foreground text-xs">{data.latest_ops_report.report_date}</p>
              <p className="mt-1 text-sm">{data.latest_ops_report.operational_summary}</p>
              {data.latest_ops_report.sales_summary && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Sales: {data.latest_ops_report.sales_summary}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">No report submitted yet.</p>
          )}
          <p className="text-muted-foreground mt-4 text-xs">
            Read-only view. Attendance detail, leave, documents, inventory, and the
            full pipeline are in their own tabs — everything here is visible without
            edit rights.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">Task progress (company-wide)</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[["open", "Open"], ["in_progress", "Pending"], ["completed", "Closed"]].map(([k, lbl]) => {
              const n = data.task_summary?.find((t) => t.status === k)?.n ?? 0;
              return (
                <div key={k} className="border-border rounded-lg border py-2">
                  <p className="text-xl font-semibold">{n}</p>
                  <p className="text-muted-foreground text-[11px]">{lbl}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 max-h-64 overflow-x-auto overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className={th}>Staff</th>
                  <th className={th}>Open</th>
                  <th className={th}>Done</th>
                </tr>
              </thead>
              <tbody>
                {(data.task_by_staff ?? []).length === 0 && (
                  <tr><td className={`${td} text-muted-foreground`} colSpan={3}>No tasks yet.</td></tr>
                )}
                {(data.task_by_staff ?? []).map((r) => (
                  <tr key={r.name} className="border-border border-b last:border-0">
                    <td className={td}>{r.name} <span className="text-muted-foreground text-xs">· {r.role.replace(/_/g, " ")}</span></td>
                    <td className={`${td} font-medium`}>{r.open_tasks}</td>
                    <td className={`${td} text-muted-foreground`}>{r.done_tasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">Inventory status (monitoring)</p>
          <ul className="mt-3 space-y-1.5">
            {(data.inventory_status ?? []).length === 0 && (
              <li className="text-muted-foreground text-sm">No inventory items.</li>
            )}
            {(data.inventory_status ?? []).map((r) => (
              <li key={r.status} className="flex items-center justify-between text-sm">
                <Badge value={r.status} />
                <span className="font-medium">{r.n}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-4 text-xs">
            {data.low_stock_items} item{data.low_stock_items === 1 ? "" : "s"} low or out of stock.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================= Birthdays (CEO + HR tier) ================= */

/**
 * Dedicated birthday manager. HR tier reaches birthdays via the HR tab, but
 * the CEO — read-only elsewhere — has an explicit birthday exception, so this
 * gives the CEO (and HR/COO/CCO) a place to set and see them. Writes go through
 * PATCH /staff/users/:id with only the birthday field, which the API permits
 * for the CEO by policy.
 */
export function BirthdaysPanel() {
  const [staff, setStaff] = useState<{ id: number; name: string; role: string; birthday?: string | null }[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ users?: { id: number; name: string; role: string; birthday?: string | null }[], staff?: { id: number; name: string; role: string; birthday?: string | null }[] }>(`/users`);
    if (r.data) {
      const list = r.data.users ?? r.data.staff ?? [];
      setStaff(list.filter((u) => u.role !== "customer"));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const [birthdayMsg, setBirthdayMsg] = useState("");
  const save = async (id: number) => {
    const v = draft[id];
    if (v === undefined) return;
    setBirthdayMsg("");
    const res = await api<{ error?: { message?: string } }>(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ birthday: v }) });
    if (res.ok) {
      setSaved(id);
      window.setTimeout(() => setSaved(null), 2500);
      void load();
    } else {
      // A set birthday is locked — amendments happen in /admin (v1.4.22 policy).
      setBirthdayMsg(res.data?.error?.message ?? "Save failed — check access");
    }
  };

  // Sort by month-day for an "upcoming" feel.
  const sorted = [...staff].sort((a, b) =>
    (a.birthday?.slice(5) ?? "99").localeCompare(b.birthday?.slice(5) ?? "99"));

  return (
    <div className={card}>
      <p className="text-sm font-semibold">Staff birthdays</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Set each person&apos;s birthday (YYYY-MM-DD). Sorted by month and day.
        Once saved, a birthday locks — corrections are made by an admin.
      </p>
      {birthdayMsg && <p className="text-destructive mt-2 text-xs font-medium">{birthdayMsg}</p>}
      <ul className="mt-3 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
        {sorted.map((u) => (
          <li key={u.id} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
            <span className="text-sm font-medium">
              {u.name} <span className="text-muted-foreground font-normal">· {u.role.replace(/_/g, " ")}</span>
            </span>
            <span className="flex items-center gap-2">
              <input
                type="date"
                className="border-input bg-background rounded-lg border px-2 py-1 text-xs"
                defaultValue={u.birthday ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [u.id]: e.target.value }))}
              />
              <button
                type="button"
                className="bg-primary text-primary-foreground rounded-lg px-2.5 py-1 text-xs font-medium"
                onClick={() => void save(u.id)}
              >
                Save
              </button>
              {saved === u.id && <span className="text-xs font-medium text-green-700">✓</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ================= Attendance corrections (CEO + admin) ================= */

interface AttRecord {
  id: number;
  name: string;
  user_id: number;
  type: string;
  created_at: string;
  myt_time?: string;
  flag?: string;
  manual_by?: number | null;
  amended_by?: number | null;
}

/** UTC "YYYY-MM-DD HH:MM:SS" → MYT "YYYY-MM-DDTHH:MM" for datetime-local. */
function utcToMytLocal(utc: string): string {
  const d = new Date(new Date(utc.replace(" ", "T") + "Z").getTime() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

/**
 * The CEO's attendance exception: view every punch, correct a wrong one, or
 * add clock in/out for days worked before this system existed. Every change
 * is marked (manual/amended) and audit-logged with the actor.
 */
export function AttendanceAdminPanel() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<AttRecord[]>([]);
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([]);
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [add, setAdd] = useState({ user_id: 0, type: "clock_in", date: "", time: "" });

  const load = useCallback(async () => {
    const [r, u] = await Promise.all([
      api<{ records: AttRecord[] }>(`/attendance/report?month=${month}`),
      api<{ users?: { id: number; name: string; role: string }[]; staff?: { id: number; name: string; role: string }[] }>(`/users`),
    ]);
    if (r.data) setRows(r.data.records ?? []);
    const list = u.data?.users ?? u.data?.staff ?? [];
    setStaff(list.filter((x) => x.role !== "customer"));
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, init: RequestInit, okMsg: string) => {
    setMsg("");
    const res = await api<{ error?: { message?: string } }>(path, init);
    if (res.ok) {
      setMsg(okMsg);
      window.setTimeout(() => setMsg(""), 3000);
      void load();
    } else {
      setMsg(res.data?.error?.message ?? "Action failed — check access");
    }
  };

  return (
    <div className={`${card} mt-6`}>
      <p className="text-sm font-semibold">Staff attendance — corrections &amp; back-entry</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Amend a wrong punch or add clock in/out for days worked before this
        system existed. Times are Malaysia time. Manual and amended records are
        marked and audit-logged.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <select className={inputClass} style={{ maxWidth: "14rem" }} value={add.user_id}
          onChange={(e) => setAdd((d) => ({ ...d, user_id: Number(e.target.value) }))}>
          <option value={0}>Add record: select staff…</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className={inputClass} style={{ maxWidth: "8rem" }} value={add.type}
          onChange={(e) => setAdd((d) => ({ ...d, type: e.target.value }))}>
          <option value="clock_in">Clock in</option>
          <option value="clock_out">Clock out</option>
        </select>
        <input type="date" className={inputClass} style={{ maxWidth: "10rem" }} value={add.date}
          onChange={(e) => setAdd((d) => ({ ...d, date: e.target.value }))} />
        <input type="time" className={inputClass} style={{ maxWidth: "7rem" }} value={add.time}
          onChange={(e) => setAdd((d) => ({ ...d, time: e.target.value }))} />
        <button type="button"
          className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium disabled:opacity-50"
          disabled={!add.user_id || !add.date || !add.time}
          onClick={() => void act(`/attendance/manual`, {
            method: "POST",
            body: JSON.stringify({ user_id: add.user_id, type: add.type, myt: `${add.date} ${add.time}` }),
          }, "Record added.")}>
          Add
        </button>
        <input type="month" className={inputClass} style={{ maxWidth: "10rem", marginLeft: "auto" }} value={month}
          onChange={(e) => setMonth(e.target.value)} />
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}

      <div className="mt-3 max-h-[26rem] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className={th}>Staff</th>
              <th className={th}>Type</th>
              <th className={th}>Time (MYT)</th>
              <th className={th}>Mark</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className={`${td} text-muted-foreground`} colSpan={5}>No records this month.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-border border-b last:border-0">
                <td className={td}>{r.name}</td>
                <td className={td}>{r.type === "clock_in" ? "In" : "Out"}</td>
                <td className={td}>
                  <input
                    type="datetime-local"
                    className="border-input bg-background rounded-lg border px-2 py-1 text-xs"
                    value={edit[r.id] ?? utcToMytLocal(r.created_at)}
                    onChange={(e) => setEdit((s) => ({ ...s, [r.id]: e.target.value }))}
                  />
                </td>
                <td className={`${td} text-muted-foreground text-xs`}>
                  {r.manual_by ? "manual" : r.amended_by ? "amended" : "punch"}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <button type="button" className="text-xs underline"
                    onClick={() => void act(`/attendance/${r.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ myt: (edit[r.id] ?? utcToMytLocal(r.created_at)).replace("T", " ") }),
                    }, "Record updated.")}>
                    Save
                  </button>
                  <button type="button" className="text-destructive ml-2 text-xs underline"
                    onClick={() => void act(`/attendance/${r.id}`, { method: "DELETE" }, "Record removed.")}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

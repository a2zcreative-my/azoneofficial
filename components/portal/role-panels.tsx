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
import { compressImage } from "@/lib/compress-image";
import { useSaveToast } from "@/components/ui/save-toast";

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
const card = "rounded-lg border border-border bg-card p-4 md:p-5";

/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */
function dmy(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return iso;
  const date = `${d[2]}-${d[1]}-${d[0]}`;
  const time = iso.length >= 16 ? ` ${iso.slice(11, 16)}` : "";
  return date + time;
}

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
  const [month, setMonth] = useState(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7));
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [shift, setShift] = useState("");
  const [reports, setReports] = useState<
    { id: number; period: string; report_date: string; content: string; author: string }[]
  >([]);
  const [draft, setDraft] = useState({
    period: "daily",
    report_date: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
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
    <div className="space-y-4 md:space-y-6">
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
                  <td className={td}>{dmy(r.myt_time ?? "")}</td>
                  <td className={td}>
                    <Badge value={r.flag} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
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
                <span className="text-muted-foreground">· {dmy(r.report_date)} · {r.author}</span>
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
                <span className="text-muted-foreground">{dmy(b.birthday)}</span>
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

/**
 * TikTok Orders (v1.4.65) — lives in the INVENTORY tab: TikTok orders move
 * stock, so the tracker belongs beside the stock it moves. Status line
 * explains any pending setup; Sync backfills the last 30 days.
 */
function TikTokOrdersCard({ role, onChanged }: { role: string; onChanged: () => void }) {
  interface TtStatus { configured: boolean; authorized: boolean; last_event_at: string | null; last_event_verified: boolean | null }
  interface TtOrder { id: number; order_ref: string; status: string; note?: string | null; created_at: string; items_label?: string | null; courier?: string | null; tracking_no?: string | null; buyer_city?: string | null }
  const [ttStatus, setTtStatus] = useState<TtStatus | null>(null);
  const [ttOrders, setTtOrders] = useState<TtOrder[]>([]);
  const [ttMsg, setTtMsg] = useState("");
  // v1.4.70 — status filter: TikTok statuses land as preparing (new) / shipped / delivered / returned.
  const [ttFilter, setTtFilter] = useState<"all" | "preparing" | "shipped" | "delivered">("all");
  const canSync = ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"].includes(role);

  // Integrations endpoints sit outside the /staff base this file's api()
  // helper prefixes, so the card carries its own minimal fetcher.
  const tiktokApi = useCallback(async <T,>(path: string, init?: RequestInit) => {
    try {
      const res = await fetch(`/api/v1/integrations/tiktok${path}`, {
        credentials: "include",
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
        ...init,
      });
      return { ok: res.ok, data: (await res.json().catch(() => null)) as T | null };
    } catch {
      return { ok: false, data: null as T | null };
    }
  }, []);

  const loadTikTok = useCallback(async () => {
    const st = await tiktokApi<TtStatus>(`/status`);
    if (st.ok) setTtStatus(st.data);
    const pr = await api<{ records: TtOrder[] }>(`/postage`);
    setTtOrders((pr.data?.records ?? []).filter((r) => r.order_ref?.startsWith("TT-")).slice(0, 100));
  }, [tiktokApi]);

  useEffect(() => { void loadTikTok(); }, [loadTikTok]);

  const syncTikTok = async () => {
    setTtMsg("Syncing from TikTok…");
    const res = await tiktokApi<{ imported: number; skipped: number; problems: string[]; error?: { message?: string } }>(
      `/sync`, { method: "POST", body: JSON.stringify({}) },
    );
    if (res.ok && res.data) {
      const probs = res.data.problems?.length ? ` · ${res.data.problems.join(" · ")}` : "";
      setTtMsg(`Imported ${res.data.imported} (${res.data.skipped} already in)${probs}`);
      void loadTikTok();
      onChanged();
    } else {
      setTtMsg(res.data?.error?.message ?? "Sync failed — check the TikTok setup");
    }
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">TikTok Orders</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {!ttStatus?.configured
              ? "Not configured — set the app secret and deploy the worker."
              : !ttStatus?.authorized
                ? "Not authorized yet — activate the shop/order scopes, publish the app in Partner Center, then authorize the shop. Sync pulls existing orders once live."
                : ttStatus.last_event_at
                  ? `Connected · last webhook ${dmy(ttStatus.last_event_at)}${ttStatus.last_event_verified === false ? " (signature FAILED — check app secret)" : ""}`
                  : "Connected · auto-sync runs every 30 minutes; Sync pulls now."}
          </p>
        </div>
        {canSync && (
          <button
            type="button"
            className="border-border inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-secondary"
            onClick={() => void syncTikTok()}
          >
            Sync from TikTok
          </button>
        )}
      </div>
      {ttMsg && <p className="mt-2 text-xs font-medium text-amber-700">{ttMsg}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {([["all", "All"], ["preparing", "New"], ["shipped", "Shipped"], ["delivered", "Delivered"]] as const).map(([v, label]) => {
          const n = v === "all" ? ttOrders.length : ttOrders.filter((o) => o.status === v).length;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setTtFilter(v)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                ttFilter === v ? "border-transparent bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
              }`}
            >
              {label} ({n})
            </button>
          );
        })}
      </div>
      <div className="mt-3 max-h-72 overflow-y-auto">
        {ttOrders.length === 0 && <p className="text-muted-foreground text-sm">No TikTok orders yet.</p>}
        {ttOrders.length > 0 && ttOrders.every((o) => ttFilter !== "all" && o.status !== ttFilter) && (
          <p className="text-muted-foreground text-sm">No orders with this status.</p>
        )}
        {ttOrders.filter((o) => ttFilter === "all" || o.status === ttFilter).map((o) => (
          <div key={o.id} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span className="min-w-0">
              <span className="font-medium">{o.order_ref}</span>
              <span className="text-muted-foreground"> · {dmy(o.created_at)}</span>
              {o.buyer_city && <span className="text-muted-foreground"> · 📍 {o.buyer_city}</span>}
              {o.items_label ? (
                <span className="block text-xs font-medium">{o.items_label}</span>
              ) : (
                <span className="text-muted-foreground block text-xs">No stock movement recorded</span>
              )}
              {o.tracking_no ? (
                <span className="block text-xs">
                  Tracking: <span className="font-semibold tracking-wide">{o.tracking_no}</span>
                  {o.courier ? <span className="text-muted-foreground"> · {o.courier}</span> : null}
                </span>
              ) : (
                <span className="text-muted-foreground block text-xs">No tracking number yet</span>
              )}
              {o.note && <span className="text-muted-foreground block text-xs">{o.note}</span>}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{o.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InventoryPanel({ role = "" }: { role?: string }) {
  const [items, setItems] = useState<InvItem[]>([]);
  const [postage, setPostage] = useState<PostRec[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [invDraft, setInvDraft] = useState({ sku: "", name: "", stock: 0 });
  const [postDraft, setPostDraft] = useState({ order_ref: "", courier: "", tracking_no: "" });
  const [postLines, setPostLines] = useState<{ inventory_item_id: number; qty: number }[]>([]);
  const [postMsg, setPostMsg] = useState("");
  const [matDraft, setMatDraft] = useState("");
  const [adjQty, setAdjQty] = useState<Record<number, number>>({});
  const [invMsg, setInvMsg] = useState("");

  const adjust = async (id: number, delta: number) => {
    setInvMsg("");
    const res = await api<{ error?: { message?: string } }>(`/inventory/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify({ delta }),
    });
    if (!res.ok) setInvMsg(res.data?.error?.message ?? "Adjustment failed");
    void load();
  };

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
    <div className="space-y-4 md:space-y-6">
      <TikTokOrdersCard role={role} onChanged={() => void load()} />
      <div className={card}>
        <p className="text-sm font-semibold">Inventory — live status &amp; stock</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Stock moves automatically: a postage record with an item deducts it;
          a returned shipment adds it back. Use In/Out for manual corrections.
          Status recomputes on every movement (0 = out of stock · ≤5 = low).
        </p>
        {invMsg && <p className="text-destructive mt-1 text-xs font-medium">{invMsg}</p>}
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
                      <input type="number" min={1} className="border-input bg-background w-14 rounded border px-1.5 py-0.5 text-xs"
                        value={adjQty[it.id] ?? 1}
                        onChange={(e) => setAdjQty((q) => ({ ...q, [it.id]: Math.max(1, Number(e.target.value)) }))} />
                      <button type="button" className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                        title="Stock in (restock)"
                        onClick={() => void adjust(it.id, adjQty[it.id] ?? 1)}>In +</button>
                      <button type="button" className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                        title="Stock out (manual deduction)"
                        onClick={() => void adjust(it.id, -(adjQty[it.id] ?? 1))}>Out −</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">Postage tracking — non-TikTok orders</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            TikTok orders arrive automatically (webhook + 30-minute sync) with
            their items and tracking. Use this form only for other channels —
            Shopee, WhatsApp/direct sales, replacements.
          </p>
          <div className="mt-3 space-y-2">
            <input className={inputClass} placeholder="Order reference" value={postDraft.order_ref}
              onChange={(e) => setPostDraft((d) => ({ ...d, order_ref: e.target.value }))} />
            <div className="flex gap-2">
              <input className={inputClass} placeholder="Courier" value={postDraft.courier}
                onChange={(e) => setPostDraft((d) => ({ ...d, courier: e.target.value }))} />
              <input className={inputClass} placeholder="Tracking no." value={postDraft.tracking_no}
                onChange={(e) => setPostDraft((d) => ({ ...d, tracking_no: e.target.value }))} />
            </div>
            {postLines.map((line, idx) => (
              <div key={idx} className="flex gap-2">
                <select className={inputClass} value={line.inventory_item_id}
                  onChange={(e) => setPostLines((ls) => ls.map((l, i) => i === idx ? { ...l, inventory_item_id: Number(e.target.value) } : l))}>
                  <option value={0}>Select item…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.sku} · {it.name} ({it.stock} in stock)</option>
                  ))}
                </select>
                <input type="number" min={1} className={`${inputClass} max-w-20`} value={line.qty}
                  title="Quantity shipped"
                  onChange={(e) => setPostLines((ls) => ls.map((l, i) => i === idx ? { ...l, qty: Math.max(1, Number(e.target.value)) } : l))} />
                <button type="button" className="text-destructive text-xs underline"
                  onClick={() => setPostLines((ls) => ls.filter((_, i) => i !== idx))}>Remove</button>
              </div>
            ))}
            <button type="button" className="text-xs underline"
              onClick={() => setPostLines((ls) => [...ls, { inventory_item_id: 0, qty: 1 }])}>
              + Add item line {postLines.length === 0 ? "(deducts stock automatically)" : ""}
            </button>
            {postMsg && <p className="text-destructive text-xs font-medium">{postMsg}</p>}
            <button type="button" className={btnClass}
              onClick={async () => {
                if (!postDraft.order_ref.trim()) return;
                const lines = postLines.filter((l) => l.inventory_item_id > 0);
                if (postLines.length > 0 && lines.length !== postLines.length) {
                  setPostMsg("Pick an item for every line, or remove empty lines.");
                  return;
                }
                setPostMsg("");
                const res = await api<{ error?: { message?: string } }>(`/postage`, {
                  method: "POST",
                  body: JSON.stringify({ ...postDraft, items: lines.length > 0 ? lines : undefined }),
                });
                if (!res.ok) {
                  setPostMsg(res.data?.error?.message ?? "Could not add record");
                } else {
                  setPostDraft({ order_ref: "", courier: "", tracking_no: "" });
                  setPostLines([]);
                }
                void load();
              }}>
              Add record
            </button>
          </div>
          <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
            {postage.filter((r) => !r.order_ref?.startsWith("TT-")).length === 0 && (
              <li className="text-muted-foreground text-sm">No non-TikTok postage records yet.</li>
            )}
            {postage.filter((r) => !r.order_ref?.startsWith("TT-")).map((r) => (
              <li key={r.id} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{r.order_ref}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {r.courier ?? "—"} · {r.tracking_no ?? "no tracking yet"}
                    {(r as PostRec & { items_label?: string }).items_label
                      ? ` · ${(r as PostRec & { items_label?: string }).items_label}`
                      : (r as PostRec & { item_name?: string; qty?: number }).item_name
                        ? ` · ${(r as PostRec & { qty?: number }).qty}× ${(r as PostRec & { item_name?: string }).item_name}`
                        : ""}
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
    <div className="space-y-4 md:space-y-6">
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
    report_date: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
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
    <div className="space-y-4 md:space-y-6">
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
                {dmy(r.report_date)}
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
  upcoming_events?: { id: number; title: string; category: string; event_date: string; start_time?: string | null; location?: string | null }[];
  upcoming_events_30d?: number;
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
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {stat("Clocked in today", data.clocked_in_today)}
        {stat("Pending leave requests", data.pending_leave)}
        {stat("Low / out-of-stock items", data.low_stock_items)}
        {stat("Events next 30 days", data.upcoming_events_30d ?? 0)}
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
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
          <p className="text-sm font-semibold mt-5">Upcoming events</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Trainings, classes and company dates — add them from the Dashboard;
            every staff member is notified. (The BD deal pipeline still lives in
            the CCO&apos;s Commercial tab.)
          </p>
          <ul className="mt-2 space-y-1.5">
            {(data.upcoming_events ?? []).length === 0 && (
              <li className="text-muted-foreground text-sm">Nothing scheduled in the next 60 days.</li>
            )}
            {(data.upcoming_events ?? []).map((ev) => (
              <li key={ev.id} className="flex justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{ev.title}</span>{" "}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{ev.category}</span>
                </span>
                <span className="text-muted-foreground text-xs whitespace-nowrap">
                  {dmy(ev.event_date)}{ev.start_time ? ` ${ev.start_time}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">Latest operational report</p>
          {data.latest_ops_report ? (
            <div className="mt-2">
              <p className="text-muted-foreground text-xs">{dmy(data.latest_ops_report.report_date)}</p>
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

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
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
  const [month, setMonth] = useState(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7));
  const [rows, setRows] = useState<AttRecord[]>([]);
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([]);
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [add, setAdd] = useState({ user_id: 0, type: "clock_in", date: "", time: "" });
  // v1.4.80: click a column HEADER to sort (▲ asc / ▼ desc); click again to
  // flip. Default = the API's chronological order.
  const [sortKey, setSortKey] = useState<"name" | "type" | "time" | "mark" | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  // v1.4.78: find one specific staff member instead of scanning the full list.
  const [filterId, setFilterId] = useState(0);
  const { show: showToast, node: toastNode } = useSaveToast();
  const clickSort = (k: "name" | "type" | "time" | "mark") => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  };
  const markOf = (r: AttRecord) => (r.manual_by ? "manual" : r.amended_by ? "amended" : "punch");

  const load = useCallback(async () => {
    const [r, u] = await Promise.all([
      api<{ records: AttRecord[] }>(`/attendance/report?month=${month}`),
      api<{ users?: { id: number; name: string; role: string }[]; staff?: { id: number; name: string; role: string }[] }>(`/users`),
    ]);
    if (r.data) setRows(r.data.records ?? []);
    const list = u.data?.users ?? u.data?.staff ?? [];
    setStaff(list.filter((x) => x.role !== "customer" && x.role !== "super_admin"));
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, init: RequestInit, okMsg: string) => {
    setMsg("");
    const res = await api<{ error?: { message?: string } }>(path, init);
    if (res.ok) {
      showToast("Saved", okMsg);
      void load();
    } else {
      setMsg(res.data?.error?.message ?? "Action failed — check access");
    }
  };

  return (
    <div className={`${card} mt-4 md:mt-6`}>
      {toastNode}
      <p className="text-sm font-semibold">Staff attendance — corrections &amp; back-entry</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Amend a wrong punch or add clock in/out for days worked before this
        system existed. Times are Malaysia time. Manual and amended records are
        marked and audit-logged.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-muted-foreground mb-0.5 block text-[11px] font-semibold tracking-wide uppercase">Add record</span>
        <select className={inputClass} style={{ maxWidth: "14rem" }} value={add.user_id}
          onChange={(e) => setAdd((d) => ({ ...d, user_id: Number(e.target.value) }))}>
          <option value={0}>Select staff…</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        </label>
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
        <select className={inputClass} style={{ maxWidth: "13rem", marginLeft: "auto" }} value={filterId}
          title="Show one staff member's records only"
          onChange={(e) => setFilterId(Number(e.target.value))}>
          <option value={0}>Find staff: everyone</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="month" className={inputClass} style={{ maxWidth: "10rem" }} value={month}
          onChange={(e) => setMonth(e.target.value)} />
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}

      <div className="mt-3 max-h-[26rem] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              {([["name", "Staff"], ["type", "Type"], ["time", "Time (MYT)"], ["mark", "Mark"]] as const).map(([k, label]) => (
                <th key={k} className={`${th} cursor-pointer select-none hover:underline`}
                  title="Click to sort — click again to reverse"
                  onClick={() => clickSort(k)}>
                  {label}{sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className={`${td} text-muted-foreground`} colSpan={5}>No records this month.</td></tr>
            )}
            {rows.length > 0 && filterId !== 0 && rows.filter((r) => r.user_id === filterId).length === 0 && (
              <tr><td className={`${td} text-muted-foreground`} colSpan={5}>No records for this staff member this month.</td></tr>
            )}
            {(() => {
              const visible = filterId === 0 ? rows : rows.filter((r) => r.user_id === filterId);
              if (!sortKey) return visible;
              const val = (r: AttRecord) =>
                sortKey === "name" ? (r.name ?? "") :
                sortKey === "type" ? r.type :
                sortKey === "mark" ? markOf(r) : r.created_at;
              return [...visible].sort(
                (a, b) => (val(a).localeCompare(val(b)) || a.created_at.localeCompare(b.created_at)) * sortDir,
              );
            })().map((r) => (
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
                    onClick={() => {
                      const current = edit[r.id] ?? utcToMytLocal(r.created_at);
                      if (current === utcToMytLocal(r.created_at)) {
                        showToast("No changes", `${r.name} — time unchanged`, "notice");
                        return;
                      }
                      void act(`/attendance/${r.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ myt: current.replace("T", " ") }),
                      }, `${r.name} — record updated`);
                    }}>
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


/* ================= Expense claims (v1.4.75) ================= */

interface Claim {
  id: number;
  user_id: number;
  claim_date: string;
  category: string;
  amount_cents: number;
  description?: string | null;
  receipt_key?: string | null;
  status: string;
  claimant?: string | null;
  claimant_full?: string | null;
  claimant_position?: string | null;
  claimant_department?: string | null;
  decided_by_name?: string | null;
  decision_note?: string | null;
  decided_at?: string | null;
  created_at: string;
}

/** v1.4.92: printable Employee Claim Form — modelled on the CEO's
    AZOO-HR-CLM-001 template. HR prints the PDF, signatures are collected in
    wet ink; the SYSTEM approval (CEO decides in the Claims tab) remains the
    authoritative one, and its outcome is stamped on the form. */
function printClaimForm(c: Claim) {
  const rmv = (cents: number) => (cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const claimNo = `AZOO-CLM-${String(c.id).padStart(4, "0")}`;
  const sysLine = c.status === "approved"
    ? `APPROVED IN SYSTEM${c.decided_by_name ? " by " + c.decided_by_name : ""}${c.decided_at ? " on " + dmy(c.decided_at) : ""}`
    : c.status === "rejected"
      ? `REJECTED IN SYSTEM${c.decided_by_name ? " by " + c.decided_by_name : ""}`
      : "PENDING SYSTEM APPROVAL";
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${claimNo} — Employee Claim Form</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a2946; font-size: 12px; margin: 0; padding: 12px; max-width: 210mm; margin-inline: auto; }
    h1 { text-align: center; margin: 4px 0 0; font-size: 19px; letter-spacing: .04em; }
    h1 small { display: block; font-size: 8px; letter-spacing: .32em; color: #C9A227; font-weight: 700; margin-top: 2px; }
    h2 { text-align: center; margin: 6px 0 14px; font-size: 14px; font-weight: 600; }
    .goldbar { height: 5px; background: linear-gradient(90deg, #C9A227, #E8CB6B, #C9A227); border-radius: 3px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    .meta td { border: 1px solid #1a2946; padding: 5px 8px; }
    .meta .k { width: 21%; font-weight: 700; background: #f2f4f8; }
    .meta .v { width: 29%; }
    .sect { margin: 12px 0 4px; font-weight: 700; }
    .det th { border: 1px solid #1a2946; background: #1a2946; color: #fff; padding: 5px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    .det td { border: 1px solid #1a2946; padding: 6px 8px; height: 22px; }
    .det td.r { text-align: right; font-variant-numeric: tabular-nums; }
    .total { margin-top: 10px; font-weight: 700; }
    .decl { margin-top: 12px; font-size: 11px; }
    .sys { margin-top: 6px; font-weight: 800; color: ${c.status === "approved" ? "#15803d" : c.status === "rejected" ? "#b91c1c" : "#b45309"}; }
    .sig td { border: 1px solid #1a2946; padding: 6px 8px; vertical-align: top; width: 33.33%; }
    .sig .hd2 { font-weight: 700; background: #f2f4f8; }
    .sig .body { height: 78px; }
    .cut { margin-top: 18px; text-align: center; color: #8a93a6; font-size: 10px; letter-spacing: .06em; }
    .foot { margin-top: 10px; font-size: 8.5px; color: #8a93a6; text-align: center; }
    @media print { body { padding: 0; } }
  </style></head><body onload="window.print()">
  <div class="goldbar"></div>
  <h1>AZ ONE OFFICIAL<small>LIVE &nbsp;·&nbsp; CONNECT &nbsp;·&nbsp; GROW</small></h1>
  <h2>Employee Claim Form</h2>
  <table class="meta">
    <tr><td class="k">Document No.</td><td class="v">AZOO-HR-CLM-001</td><td class="k">Version</td><td class="v">002</td></tr>
    <tr><td class="k">Claim No.</td><td class="v">${claimNo}</td><td class="k">Date</td><td class="v">${dmy(c.created_at)}</td></tr>
    <tr><td class="k">Employee</td><td class="v">${(c.claimant_full || c.claimant || "").toUpperCase()}</td><td class="k">Department</td><td class="v">${(c.claimant_department ?? "").toUpperCase()}</td></tr>
    <tr><td class="k">Position</td><td class="v">${(c.claimant_position ?? "").toUpperCase()}</td><td class="k">Purpose</td><td class="v">${c.description ?? ""}</td></tr>
    <tr><td class="k">Receipt</td><td class="v" colspan="3">${c.receipt_key ? "☑ Yes (attached in system)" : "☐ Yes"} ${c.receipt_key ? "☐ No" : "☑ No"}</td></tr>
  </table>
  <p class="sect">Claim Details</p>
  <table class="det">
    <thead><tr><th style="width:18%">Date</th><th style="width:20%">Category</th><th>Description</th><th style="width:18%">Amount (RM)</th></tr></thead>
    <tbody>
      <tr><td>${dmy(c.claim_date)}</td><td style="text-transform:capitalize">${c.category}</td><td>${c.description ?? ""}</td><td class="r">${rmv(c.amount_cents)}</td></tr>
      <tr><td></td><td></td><td></td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td></tr>
    </tbody>
  </table>
  <p class="total">Total Claimed: RM ${rmv(c.amount_cents)}</p>
  <p class="decl">Declaration: I certify the above expenses were incurred for official Company business.</p>
  <p class="sys">System status: ${sysLine}${c.decision_note ? " · Note: " + c.decision_note : ""}</p>
  <table class="sig" style="margin-top:10px">
    <tr>
      <td class="hd2">Employee</td>
      <td class="hd2">Administrative or<br/>Head of Department (COO / CCO)</td>
      <td class="hd2">Chief Executive Officer (CEO)</td>
    </tr>
    <tr>
      <td class="body">Name: ${(c.claimant_full || c.claimant || "")}<br/>Signature:<br/><br/><br/>Date:</td>
      <td class="body">Name:<br/>Signature:<br/><br/><br/>Date:</td>
      <td class="body">Name:${c.status !== "pending" && c.decided_by_name ? " " + c.decided_by_name : ""}<br/>Signature:<br/><br/><br/>Date:</td>
    </tr>
  </table>
  <p class="cut">✂ ————————————————————————— CUT HERE —————————————————————————</p>
  <p class="foot">AZ ONE OFFICIAL · SSM 202603168673 (JM1046169-H) · Setia Tropika, Johor Bahru · This form accompanies the system record ${claimNo}; the in-system decision is authoritative.</p>
  </body></html>`);
  w.document.close();
}

const CLAIM_CATEGORIES = ["travel", "meal", "accommodation", "equipment", "medical", "other"] as const;

/** Expense claims — CEO, COO, CCO and HR submit; per the CEO's instruction
    EVERY decision is made by the CEO. Claimants attach a receipt (image/PDF);
    the CEO sees a pending queue with Approve / Reject and an optional note.
    Both sides are bell-notified. */
export function ClaimsPanel() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState({ claim_date: "", category: "travel", amount: "", description: "" });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const { show: showToast, node: toastNode } = useSaveToast();

  const load = useCallback(async () => {
    const res = await api<{ claims: Claim[]; can_decide: boolean }>(`/claims`);
    if (res.ok && res.data) { setClaims(res.data.claims); setCanDecide(res.data.can_decide); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rmc = (c: number) => `RM ${(c / 100).toFixed(2)}`;

  const submit = async () => {
    if (!draft.claim_date || !Number(draft.amount)) { setMsg("Date and amount are required."); return; }
    setMsg("");
    const res = await api<{ id?: number; error?: { message?: string } }>(`/claims`, {
      method: "POST",
      body: JSON.stringify({ ...draft, amount: Number(draft.amount), description: draft.description || undefined }),
    });
    if (!res.ok || !res.data?.id) { setMsg(res.data?.error?.message ?? "Could not submit the claim"); return; }
    if (receipt) {
      const compressed = await compressImage(receipt); // PDFs pass through untouched
      await fetch(`/api/v1/staff/claims/${res.data.id}/receipt`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": compressed.type || receipt.type || "image/jpeg" },
        body: compressed,
      });
    }
    setDraft({ claim_date: "", category: "travel", amount: "", description: "" });
    setReceipt(null);
    showToast("Saved", "Claim submitted — the CEO has been notified");
    void load();
  };

  const decide = async (id: number, action: "approve" | "reject") => {
    await api(`/claims/${id}/decide`, { method: "POST", body: JSON.stringify({ action, note: note[id] || undefined }) });
    showToast("Saved", `Claim ${action === "approve" ? "approved" : "rejected"} — claimant notified`);
    void load();
  };

  const badgeCls: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };
  const pending = claims.filter((c) => c.status === "pending");
  const decided = claims.filter((c) => c.status !== "pending");

  const claimRow = (c: Claim, actions: boolean) => (
    <div key={c.id} className="border-border rounded-lg border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {c.claimant && <span className="font-medium">{c.claimant} · </span>}
          <span className="font-semibold">{rmc(c.amount_cents)}</span>{" "}
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{c.category}</span>{" "}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeCls[c.status] ?? "bg-secondary"}`}>{c.status}</span>
        </p>
        <p className="text-muted-foreground text-xs">Expense date {dmy(c.claim_date)}</p>
      </div>
      {c.description && <p className="text-muted-foreground mt-1 text-xs">{c.description}</p>}
      <p className="text-muted-foreground mt-1 text-xs">
        {c.receipt_key
          ? <a className="underline" href={`/api/v1/staff/claims/${c.id}/receipt`} target="_blank" rel="noreferrer">View receipt</a>
          : "No receipt attached"}
        {" · "}
        <button type="button" className="underline" title="AZOO-HR-CLM-001 form as PDF — HR prints it, signatures are collected in ink; the system decision stays authoritative"
          onClick={() => printClaimForm(c)}>
          Print claim form
        </button>
        {c.decided_by_name && <> · decided by {c.decided_by_name}{c.decision_note ? ` — ${c.decision_note}` : ""}</>}
      </p>
      {actions && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className="border-input bg-background h-8 flex-1 rounded-lg border px-2 text-xs" placeholder="Note (optional — sent to the claimant)"
            value={note[c.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [c.id]: e.target.value }))} />
          <button type="button" className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
            onClick={() => void decide(c.id, "approve")}>Approve</button>
          <button type="button" className="border-border text-destructive inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            onClick={() => void decide(c.id, "reject")}>Reject</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}
      <div className={card}>
        <p className="text-sm font-semibold">Submit a claim</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Expense claims from CEO, COO, CCO and HR — every claim is approved or
          rejected by the CEO, who is notified the moment you submit.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input type="date" className="border-input bg-background h-9 max-w-44 rounded-lg border px-2 text-sm" title="Expense date"
            value={draft.claim_date} onChange={(e) => setDraft((d) => ({ ...d, claim_date: e.target.value }))} />
          <select className="border-input bg-background h-9 max-w-44 rounded-lg border px-2 text-sm capitalize" value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
            {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="number" min={0} step="0.01" className="border-input bg-background h-9 max-w-36 rounded-lg border px-2 text-sm" placeholder="Amount (RM)"
            value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} />
        </div>
        <input className="border-input bg-background mt-2 h-9 w-full rounded-lg border px-2 text-sm" placeholder="What was this for? (optional)"
          value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="border-border inline-flex h-9 cursor-pointer items-center rounded-lg border px-3 text-sm hover:bg-secondary">
            {receipt ? `Receipt: ${receipt.name}` : "Attach receipt (image/PDF)"}
            <input type="file" accept="image/*,application/pdf" className="hidden"
              onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
            onClick={() => void submit()}>Submit claim</button>
        </div>
        {msg && <p className="mt-2 text-xs font-medium text-amber-700">{msg}</p>}
      </div>

      {canDecide && (
        <div className={card}>
          <p className="text-sm font-semibold">
            Pending approvals
            {pending.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{pending.length}</span>
            )}
          </p>
          <div className="mt-3 space-y-2">
            {pending.length === 0 && <p className="text-muted-foreground text-sm">Nothing awaiting your decision.</p>}
            {pending.map((c) => claimRow(c, true))}
          </div>
        </div>
      )}

      <div className={card}>
        <p className="text-sm font-semibold">{canDecide ? "All claims" : "My claims"}</p>
        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
          {(canDecide ? decided : claims).length === 0 && <p className="text-muted-foreground text-sm">No claims yet.</p>}
          {(canDecide ? decided : claims).map((c) => claimRow(c, false))}
        </div>
      </div>
    </div>
  );
}


/* ================= Company expenses (v1.4.87) ================= */

interface ExpenseRec {
  id: number;
  expense_date: string;
  category: string;
  amount_cents: number;
  vendor?: string | null;
  description?: string | null;
  recurring?: number;
  due_day?: number | null;
  paid_at?: string | null;
  created_by_name?: string | null;
}

const EXPENSE_CATEGORIES = ["rent", "utilities", "software", "marketing", "equipment", "logistics", "supplies", "other"] as const;

/** Company operating expenses — CEO and COO record what the company spends
    (rent, software, ads, logistics …). Separate from CLAIMS, which are staff
    reimbursements routed to the CEO for approval. */
export function ExpensesPanel() {
  const [month, setMonth] = useState(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7));
  const [rows, setRows] = useState<ExpenseRec[]>([]);
  const [draft, setDraft] = useState({ expense_date: "", category: "software", amount: "", vendor: "", description: "", recurring: false, due_day: "" });
  const [msg, setMsg] = useState("");
  const { show: showToast, node: toastNode } = useSaveToast();
  // v1.4.88: recurring expenses from earlier months not yet recorded in the
  // viewed month, plus the payroll due line.
  const [upcoming, setUpcoming] = useState<ExpenseRec[]>([]);
  const [payrollDue, setPayrollDue] = useState<{ month: string; by: string; released: boolean } | null>(null);
  // v1.4.91: the previous month's payroll total (net, same formula as the
  // payslips) — paid during this month, so it belongs in this month's total.
  const [staffPayroll, setStaffPayroll] = useState<{ month: string; cents: number } | null>(null);
  // Inline edit for typo fixes (staff payroll excluded — computed in Payroll).
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState({ expense_date: "", category: "other", amount: "", vendor: "", description: "" });

  const load = useCallback(async () => {
    const res = await api<{ expenses: ExpenseRec[]; upcoming?: ExpenseRec[]; staff_payroll?: { month: string; cents: number } | null }>(`/expenses?month=${month}`);
    if (res.ok && res.data) {
      setRows(res.data.expenses);
      setUpcoming(res.data.upcoming ?? []);
      setStaffPayroll(res.data.staff_payroll ?? null);
    }
    // Payroll is the biggest recurring commitment — show its due date the
    // same way (previous month's payroll, payable by the release moment).
    const prev = (() => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y!, m! - 2, 1)); return d.toISOString().slice(0, 7); })();
    const pr = await api<{ release?: { available_from: string; released: { released_at: string } | null } }>(`/payroll?month=${prev}`);
    if (pr.ok && pr.data?.release) {
      setPayrollDue({ month: prev, by: pr.data.release.available_from, released: Boolean(pr.data.release.released) });
    }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const rmc = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const total = rows.reduce((a, r) => a + r.amount_cents, 0);

  const addExpense = async () => {
    if (!draft.expense_date || !Number(draft.amount)) { setMsg("Date and amount are required."); return; }
    setMsg("");
    const res = await api<{ id?: number; error?: { message?: string } }>(`/expenses`, {
      method: "POST",
      body: JSON.stringify({
        ...draft,
        amount: Number(draft.amount),
        vendor: draft.vendor || undefined,
        description: draft.description || undefined,
        recurring: draft.recurring,
        due_day: draft.due_day ? Number(draft.due_day) : undefined,
      }),
    });
    if (!res.ok) { setMsg(res.data?.error?.message ?? "Could not record the expense"); return; }
    showToast("Saved", `Expense recorded — ${rmc(Math.round(Number(draft.amount) * 100))}`);
    setDraft({ expense_date: "", category: "software", amount: "", vendor: "", description: "", recurring: false, due_day: "" });
    void load();
  };

  return (
    <div className="space-y-4">
      {toastNode}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Company expenses</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Operating costs the company pays — rent, software, ads, logistics.
              Staff reimbursements belong in Claims (approved by the CEO), not here.
            </p>
          </div>
          <input type="month" className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
            value={month} max={new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7)}
            onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input type="date" className="border-input bg-background h-9 max-w-44 rounded-lg border px-2 text-sm" title="Expense date"
            value={draft.expense_date} onChange={(e) => setDraft((d) => ({ ...d, expense_date: e.target.value }))} />
          <select className="border-input bg-background h-9 max-w-40 rounded-lg border px-2 text-sm capitalize" value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="number" min={0} step="0.01" className="border-input bg-background h-9 max-w-36 rounded-lg border px-2 text-sm" placeholder="Amount (RM)"
            value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} />
          <input className="border-input bg-background h-9 max-w-52 flex-1 rounded-lg border px-2 text-sm" placeholder="Vendor (optional)"
            value={draft.vendor} onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value }))} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className="border-input bg-background h-9 min-w-0 flex-1 rounded-lg border px-2 text-sm" placeholder="What was this for? (optional)"
            value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          <label className="flex items-center gap-1.5 text-sm whitespace-nowrap" title="A recurring expense reappears every month as due until you record it">
            <input type="checkbox" checked={draft.recurring} onChange={(e) => setDraft((d) => ({ ...d, recurring: e.target.checked }))} />
            Monthly recurring
          </label>
          <label className="flex items-center gap-1.5 text-sm whitespace-nowrap" title="Day of the month the payment must be made by">
            Due day
            <input type="number" min={1} max={31} className="border-input bg-background h-9 w-16 rounded-lg border px-2 text-sm" placeholder="—"
              value={draft.due_day} onChange={(e) => setDraft((d) => ({ ...d, due_day: e.target.value }))} />
          </label>
          <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
            onClick={() => void addExpense()}>Record expense</button>
        </div>
        {msg && <p className="text-destructive mt-2 text-xs font-medium">{msg}</p>}
      </div>

      {(payrollDue || upcoming.length > 0 || rows.some((r) => r.due_day && !r.paid_at)) && (
        <div className={card}>
          <p className="text-sm font-semibold">💳 Payments due — {month.split("-").reverse().join("-")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Commit each payment before its due date. Recurring expenses from
            earlier months appear here until recorded for this month.
          </p>
          <div className="mt-3 space-y-2">
            {payrollDue && (
              <div className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-semibold">
                    Staff payroll — {payrollDue.month.split("-").reverse().join("-")}
                    {staffPayroll && staffPayroll.month === payrollDue.month && (
                      <span className="ml-2">{rmc(staffPayroll.cents)}</span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Pay by <span className="font-medium">{payrollDue.by.split(" ")[0]!.split("-").reverse().join("-")}, {payrollDue.by.split(" ")[1]} MYT</span> (payslips release then) — figures from the Payroll tab
                  </p>
                </div>
                {payrollDue.released
                  ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">RELEASED</span>
                  : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">DUE</span>}
              </div>
            )}
            {upcoming.map((r) => {
              const [yy, mm] = month.split("-").map(Number);
              const lastD = new Date(Date.UTC(yy!, mm!, 0)).getUTCDate();
              const dueISO = `${month}-${String(Math.min(r.due_day ?? 1, lastD)).padStart(2, "0")}`;
              return (
                <div key={`u-${r.id}`} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-semibold">{rmc(r.amount_cents)}</span>{" "}
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{r.category}</span>
                      {r.vendor && <span className="text-muted-foreground"> · {r.vendor}</span>}
                      <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">↻ recurring</span>
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {r.due_day ? `Due ${dueISO.split("-").reverse().join("-")}` : "No due day set"}
                      {r.description ? ` · ${r.description}` : ""} · last recorded {dmy(r.expense_date)}
                    </p>
                  </div>
                  <button type="button" className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
                    onClick={async () => {
                      const res = await api(`/expenses`, { method: "POST", body: JSON.stringify({
                        expense_date: dueISO, category: r.category, amount: r.amount_cents / 100,
                        vendor: r.vendor || undefined, description: r.description || undefined,
                        recurring: true, due_day: r.due_day ?? undefined,
                      }) });
                      if (res.ok) { showToast("Saved", `Recorded for ${month.split("-").reverse().join("-")} — mark it paid once committed`); void load(); }
                    }}>
                    Record for this month
                  </button>
                </div>
              );
            })}
            {rows.filter((r) => r.due_day && !r.paid_at).map((r) => {
              const [yy, mm] = month.split("-").map(Number);
              const lastD = new Date(Date.UTC(yy!, mm!, 0)).getUTCDate();
              const dueISO = `${month}-${String(Math.min(r.due_day ?? 1, lastD)).padStart(2, "0")}`;
              const todayISO = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
              const overdue = todayISO > dueISO;
              return (
                <div key={`d-${r.id}`} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-semibold">{rmc(r.amount_cents)}</span>{" "}
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{r.category}</span>
                      {r.vendor && <span className="text-muted-foreground"> · {r.vendor}</span>}
                    </p>
                    <p className="mt-0.5 text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {overdue ? "OVERDUE" : "DUE"} {dueISO.split("-").reverse().join("-")}
                      </span>
                    </p>
                  </div>
                  <button type="button" className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
                    onClick={async () => { await api(`/expenses/${r.id}/paid`, { method: "POST" }); showToast("Saved", `${rmc(r.amount_cents)} marked paid`); void load(); }}>
                    Mark paid
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{month.split("-").reverse().join("-")} expenses</p>
          <div className="text-right">
            <p className="text-sm font-semibold">Total {rmc(total + (staffPayroll?.cents ?? 0))}</p>
            {staffPayroll && staffPayroll.cents > 0 && (
              <p className="text-muted-foreground text-xs">
                incl. staff payroll {rmc(staffPayroll.cents)} ({staffPayroll.month.split("-").reverse().join("-")}) + expenses {rmc(total)}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
          {rows.length === 0 && <p className="text-muted-foreground text-sm">No expenses recorded this month.</p>}
          {rows.map((r) => editId === r.id ? (
            <div key={r.id} className="border-border rounded-lg border px-3 py-2">
              <div className="flex flex-wrap gap-2">
                <input type="date" className="border-input bg-background h-8 max-w-40 rounded-lg border px-2 text-sm"
                  value={edit.expense_date} onChange={(e) => setEdit((d) => ({ ...d, expense_date: e.target.value }))} />
                <select className="border-input bg-background h-8 max-w-36 rounded-lg border px-2 text-sm capitalize"
                  value={edit.category} onChange={(e) => setEdit((d) => ({ ...d, category: e.target.value }))}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="number" min={0} step="0.01" className="border-input bg-background h-8 max-w-32 rounded-lg border px-2 text-sm"
                  placeholder="Amount (RM)" value={edit.amount} onChange={(e) => setEdit((d) => ({ ...d, amount: e.target.value }))} />
                <input className="border-input bg-background h-8 max-w-48 flex-1 rounded-lg border px-2 text-sm" placeholder="Vendor"
                  value={edit.vendor} onChange={(e) => setEdit((d) => ({ ...d, vendor: e.target.value }))} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input className="border-input bg-background h-8 min-w-0 flex-1 rounded-lg border px-2 text-sm" placeholder="Description"
                  value={edit.description} onChange={(e) => setEdit((d) => ({ ...d, description: e.target.value }))} />
                <button type="button" className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
                  onClick={async () => {
                    const unchanged = edit.expense_date === r.expense_date && edit.category === r.category
                      && Math.round(Number(edit.amount) * 100) === r.amount_cents
                      && edit.vendor === (r.vendor ?? "") && edit.description === (r.description ?? "");
                    if (unchanged) { showToast("No changes", "Nothing to save", "notice"); setEditId(null); return; }
                    if (!edit.expense_date || !Number(edit.amount)) return;
                    const res = await api(`/expenses/${r.id}`, { method: "PATCH", body: JSON.stringify({
                      expense_date: edit.expense_date, category: edit.category, amount: Number(edit.amount),
                      vendor: edit.vendor, description: edit.description,
                    }) });
                    if (res.ok) { showToast("Saved", "Expense updated"); setEditId(null); void load(); }
                  }}>Save</button>
                <button type="button" className="text-xs underline" onClick={() => setEditId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div key={r.id} className="border-border flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-semibold">{rmc(r.amount_cents)}</span>{" "}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{r.category}</span>
                  {r.vendor && <span className="text-muted-foreground"> · {r.vendor}</span>}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {dmy(r.expense_date)}
                  {r.description ? ` · ${r.description}` : ""}
                  {r.created_by_name ? ` · by ${r.created_by_name}` : ""}
                  {r.recurring === 1 && <span className="ml-1 rounded-full bg-sky-100 px-1.5 py-0.5 font-medium text-sky-700">↻</span>}
                  {r.paid_at
                    ? <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 font-semibold text-green-700">PAID</span>
                    : r.due_day
                      ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">DUE {String(r.due_day).padStart(2, "0")}-{month.split("-")[1]}</span>
                      : null}
                </p>
              </div>
              <span className="flex items-center gap-2">
                <button type="button" className="text-xs underline"
                  onClick={() => {
                    setEditId(r.id);
                    setEdit({ expense_date: r.expense_date, category: r.category, amount: (r.amount_cents / 100).toString(), vendor: r.vendor ?? "", description: r.description ?? "" });
                  }}>Edit</button>
                <button type="button" className="text-destructive text-xs underline" onClick={async () => { await api(`/expenses/${r.id}`, { method: "DELETE" }); showToast("Saved", "Expense removed"); void load(); }}>Remove</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

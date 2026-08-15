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

import { makeApi, getCsrfToken } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
const api = makeApi("/staff");
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DetailsToggle } from "@/components/ui/details-toggle";
import { properName, firstName, displayName } from "@/lib/names";
import { compressImage } from "@/lib/compress-image";
import { SITE_CONFIG } from "@/constants/site";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { RecordToggle, DetailGrid } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowBtnGood, rowBtnPrimary, rowActions } from "@/components/ui/row-button";
import { buildClaimPdf } from "@/lib/form-pdf";
import { sharePdfFile } from "@/lib/doc-pdf";
import { card, inputClass, btnClass, fieldRow, th, td, thR2, tdR2 } from "@/lib/ui-styles";
import { MiniBar, accentRowDanger, accentCellDanger } from "@/components/ui/stat-card";
import { dmy, dmyMYT, fmtRM, rm as rmBare } from "@/lib/format";




/** v1.4.139: subhead label above placeholder fields (portal-wide pattern). */
function SubR({ t, children, className = "" }: { t: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{t}</span>
      {children}
    </label>
  );
}


/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

/** v1.4.156: DB timestamps are UTC — full timestamps shown in the UI must be
    shifted to Malaysia time (+8) before formatting. Date-only values are
    already business dates and pass through untouched. (The TikTok Orders card
    showed webhook/order times 8 hours behind — the CEO spotted it.) */

// v1.4.198 (CEO: "properly aligned the text in table"): numeric columns —
// right-aligned header/cells with tabular figures so digits line up.

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
        {/* v1.4.190 (CEO): the verification list scrolls inside the card
            like every other long table — sticky subheads per v1.4.189. */}
        <div className="mt-4 max-h-[28rem] overflow-x-auto overflow-y-auto">
          <table className="tbl-sticky w-full min-w-[640px] border-collapse">
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
                  <td className={`${td} font-medium`}>{properName(r.name)}</td>
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
  unit_price_cents?: number; // v1.4.101
  live_rebate_cents?: number; // v1.4.164 — TikTok Live rebate
  updated_by_name?: string;
}
interface ManualOut { // v1.4.170 — traceability row for a manual stock out
  id: number; item_id: number; sku: string; item_name: string; qty: number;
  unit_sale_cents?: number | null; remark: string;
  created_at: string; created_by_name?: string | null;
  out_date?: string | null; reverted?: number | null; // v1.4.172
  direction?: string | null; // v1.4.251 — 'in' | 'out' (absent = out)
}

interface TtOut { // v1.4.165 — per-item stock OUT via TikTok orders
  id: number; sku: string; name: string; stock: number;
  today_qty: number; month_qty: number; total_qty: number; last_at: string | null;
  unit_price_cents?: number | null;   // v1.4.166
  avg_sale_cents?: number | null;     // v1.4.166 — actual avg sold price/unit
  month_value_cents?: number | null;  // v1.4.166 — qty × sold price this month
}

interface SupplierReturn { // v1.4.148
  id: number;
  sku: string;
  item_name: string;
  qty: number;
  unit_cost_cents: number;
  total_cents: number;
  supplier: string;
  reason?: string | null;
  return_date: string;
  status: string; // outstanding | credited | replaced (v1.4.149)
  credited_cents?: number | null;
  credited_at?: string | null;
  replaced_qty?: number | null; // v1.4.149
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
export function TikTokOrdersCard({ role, onChanged }: { role: string; onChanged: () => void }) { // v1.4.214: exported — MOVED to the Ecommerce tab
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
      const isMutating = init?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method);
      const headers = new Headers(init?.headers as Record<string, string> ?? {});
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      if (isMutating) {
        const csrf = getCsrfToken();
        if (csrf) headers.set("X-CSRF-Token", csrf);
      }
      const res = await fetch(`/api/v1/integrations/tiktok${path}`, {
        credentials: "include",
        ...init,
        headers,
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
                  ? `Connected · last webhook ${dmyMYT(ttStatus.last_event_at)} MYT${ttStatus.last_event_verified === false ? " (signature FAILED — check app secret)" : ""}`
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
      {/* v1.4.196 (CEO): order rows hide behind one click — minimalist view */}
      <DetailsToggle label="Show orders">
      <div className="mt-1 max-h-72 overflow-y-auto">
        {ttOrders.length === 0 && <p className="text-muted-foreground text-sm">No TikTok orders yet.</p>}
        {ttOrders.length > 0 && ttOrders.every((o) => ttFilter !== "all" && o.status !== ttFilter) && (
          <p className="text-muted-foreground text-sm">No orders with this status.</p>
        )}
        {ttOrders.filter((o) => ttFilter === "all" || o.status === ttFilter).map((o) => (
          <div key={o.id} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span className="min-w-0">
              <span className="font-medium">{o.order_ref}</span>
              <span className="text-muted-foreground"> · {dmyMYT(o.created_at)}</span>
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
      </DetailsToggle>
    </div>
  );
}

const rmR = fmtRM; // v1.4.272: global

export function InventoryPanel({ role: _role = "" }: { role?: string }) {
  const [items, setItems] = useState<InvItem[]>([]);
  const [postage, setPostage] = useState<PostRec[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [invDraft, setInvDraft] = useState({ sku: "", name: "", stock: 0, unit_price: "" });
  const [postDraft, setPostDraft] = useState({ order_ref: "", courier: "", tracking_no: "", order_amount: "" }); // v1.4.169 += amount
  const [postLines, setPostLines] = useState<{ inventory_item_id: number; qty: number }[]>([]);
  const [postMsg, setPostMsg] = useState("");
  const [matDraft, setMatDraft] = useState("");
  const [adjQty, setAdjQty] = useState<Record<number, number>>({});
  const [invMsg, setInvMsg] = useState("");
  // v1.4.148: supplier returns (reject → claim back)
  const [returns, setReturns] = useState<SupplierReturn[]>([]);
  const [retTotals, setRetTotals] = useState<{ total_cents: number; credited_cents: number; replaced_cents?: number; outstanding_cents: number } | null>(null);
  const [retDraft, setRetDraft] = useState({ item_id: 0, qty: 1, unit_cost: "", supplier: "", reason: "", return_date: "" });
  const [retMsg, setRetMsg] = useState("");
  const [creditingId, setCreditingId] = useState<number | null>(null);
  const [creditAmt, setCreditAmt] = useState("");
  const [replacingId, setReplacingId] = useState<number | null>(null); // v1.4.149
  const [replaceQty, setReplaceQty] = useState("");
  // v1.4.164: edit an outstanding return (qty/cost/supplier/date/reason)
  const [retEditId, setRetEditId] = useState<number | null>(null);
  const [retEditDraft, setRetEditDraft] = useState({ qty: "", unit_cost: "", supplier: "", return_date: "", reason: "" });
  const [ttOut, setTtOut] = useState<TtOut[]>([]); // v1.4.165
  const { confirm: invConfirm, node: invConfirmNode } = useConfirm(); // v1.4.148
  const { show: invToast, node: invToastNode } = useSaveToast(); // v1.4.162
  // v1.4.162: fix a wrongly inserted item — inline SKU/name edit + delete.
  const [invEditId, setInvEditId] = useState<number | null>(null);
  const [invEditDraft, setInvEditDraft] = useState({ sku: "", name: "" });
  // v1.4.170: sort controls (SKU natural / A→Z / Z→A) for both stock tables,
  // the manual stock-out MODAL (item, qty, Sold @, mandatory remark), and the
  // traceability list.
  // v1.4.199 (CEO: "remove sort button, I want to click A to Z or Z to A by
  // the subhead table instead"): sorting lives in the column HEADERS now —
  // click SKU / Item (and Out today on the stock-out card) to sort, click
  // again to reverse. Defaults unchanged: inventory by SKU 1→end; stock-out
  // by today's hot sales first.
  // v1.4.281: all-column sort — col + asc/desc direction.
  type InvCol = "sku" | "name" | "price" | "net" | "stock";
  const [invSort, setInvSort] = useState<{ col: InvCol; asc: boolean }>({ col: "sku", asc: true });
  const cycleInv = (col: InvCol) =>
    setInvSort((s) => s.col === col ? { col, asc: !s.asc } : { col, asc: true });
  type TtCol = "sku" | "name" | "hot" | "month" | "total" | "price" | "value" | "stock" | "last";
  const [ttSort, setTtSort] = useState<{ col: TtCol; asc: boolean }>({ col: "hot", asc: false });
  const cycleTt = (col: TtCol) =>
    setTtSort((s) => s.col === col ? { col, asc: !s.asc } : { col, asc: col !== "hot" && col !== "month" && col !== "total" && col !== "value" && col !== "stock" && col !== "last" });
  // edit_id null = new stock out; set = editing that traceability row.
  /* v1.4.251 (CEO: "In + seem doesnt popup notifications … if I want to
     adjust the variance … what should remark I need to indicate?"): the SAME
     modal now handles both directions, and the reason is a picked list rather
     than a blank box — so a variance is always described the same way and can
     be reported on later. */
  const REASONS: Record<"in" | "out", string[]> = {
    out: ["Stock count variance — missing", "Damaged / defective", "Sample or giveaway",
          "Internal use", "Sold offline", "Data entry correction", "Other"],
    in: ["Stock count variance — found extra", "Restock from supplier", "Customer return",
         "Returned from sample / event", "Data entry correction", "Other"],
  };
  const [outModal, setOutModal] = useState<{ dir: "in" | "out"; edit_id: number | null; item_id: number; qty: string; price: string; reason: string; remark: string; out_date: string } | null>(null);
  /* v1.4.252 (CEO: "I want the details inside while the button outside for me
     to know what is this details for"): these two audit lists packed date,
     SKU, item, qty and the whole remark onto one truncated line, so on a
     phone every row read "06-08…" and nothing else. Same fix as v1.4.249 —
     the date + SKU identify the row, the rest opens underneath. */
  const [openMove, setOpenMove] = useState<number | null>(null);
  const [openRet, setOpenRet] = useState<number | null>(null);
  const todayMYT = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const [manualOuts, setManualOuts] = useState<ManualOut[]>([]);

  // v1.4.169/170: an Out − goes through the modal — mandatory remark for
  // traceability, optional Sold @ that records it as a SALE in the totals.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const adjust = async (id: number, delta: number, salePrice?: string, remark?: string) => {
    setInvMsg("");
    const sale = delta < 0 && salePrice !== undefined && salePrice.trim() !== "" ? Number(salePrice) : undefined;
    if (sale !== undefined && (!Number.isFinite(sale) || sale < 0)) { invToast("Not saved", "Sold @ must be a valid RM amount", "notice"); return false; }
    const res = await api<{ error?: { message?: string }; sale_recorded?: boolean; stock?: number }>(`/inventory/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify({ delta, ...(sale !== undefined ? { sale_price: sale } : {}), ...(remark ? { remark } : {}) }),
    });
    if (!res.ok) { invToast("Not saved", res.data?.error?.message ?? "Adjustment failed", "notice"); void load(); return false; }
    /* v1.4.251: an IN used to save in silence — no toast at all — so there was
       no way to know the stock had actually moved. Every movement now says so,
       and quotes the NEW stock level the server came back with. */
    const level = typeof res.data?.stock === "number" ? ` — now ${res.data.stock} in stock` : "";
    if (res.data?.sale_recorded) invToast("Sale recorded", `${-delta} × RM ${rmBare(Math.round(sale! * 100))} — counted in total sales${level}`);
    else if (delta < 0) invToast("Stock out recorded", `${-delta} pcs${level} — logged with your remark`);
    else invToast("Stock in recorded", `${delta} pcs${level} — logged with your remark`);
    void load();
    return true;
  };
  // v1.4.172: create-path wrapper adding the backdatable date.
  // v1.4.251: signed — the same path records a stock IN.
  const adjust2 = async (id: number, qty: number, price: string, remark: string, outDate: string, dir: "in" | "out" = "out") => {
    setInvMsg("");
    const sale = dir === "out" && price.trim() !== "" ? Number(price) : undefined;
    if (sale !== undefined && (!Number.isFinite(sale) || sale < 0)) { invToast("Not saved", "Sold @ must be a valid RM amount", "notice"); return false; }
    const res = await api<{ error?: { message?: string }; sale_recorded?: boolean; stock?: number }>(`/inventory/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify({ delta: dir === "out" ? -qty : qty, ...(sale !== undefined ? { sale_price: sale } : {}), remark, ...(outDate ? { out_date: outDate } : {}) }),
    });
    if (!res.ok) { invToast("Not saved", res.data?.error?.message ?? "Adjustment failed", "notice"); void load(); return false; }
    const level = typeof res.data?.stock === "number" ? ` — now ${res.data.stock} in stock` : "";
    if (res.data?.sale_recorded) invToast("Sale recorded", `${qty} × RM ${rmBare(Math.round(sale! * 100))} — counted in total sales${level}`);
    else invToast(dir === "in" ? "Stock in recorded" : "Stock out recorded", `${qty} pcs${level} — logged with your remark`);
    void load();
    return true;
  };
  // v1.4.170: natural SKU compare — ELFIA001 < ELFIA002 < … < ELFIA012.
  const bySku = (a: { sku: string }, b: { sku: string }) => a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" });
  const maxStock = Math.max(1, ...items.map((x) => x.stock)); // v1.4.270 row bars
  const sortedItems = [...items].sort((a, b) => {
    const dir = invSort.asc ? 1 : -1;
    switch (invSort.col) {
      case "sku":   return dir * bySku(a, b);
      case "name":  return dir * a.name.localeCompare(b.name);
      case "price": return dir * ((a.unit_price_cents ?? 0) - (b.unit_price_cents ?? 0));
      case "net":   return dir * (Math.max(0, (a.unit_price_cents ?? 0) - (a.live_rebate_cents ?? 0)) - Math.max(0, (b.unit_price_cents ?? 0) - (b.live_rebate_cents ?? 0)));
      case "stock": return dir * (a.stock - b.stock);
      default:      return 0;
    }
  });
  // Hot = today's sales first (ties: month, then SKU) — deterministic.
  const byToday = (a: TtOut, b: TtOut) => (b.today_qty - a.today_qty) || (b.month_qty - a.month_qty) || bySku(a, b);
  const sortedTtOut = [...ttOut].sort((a, b) => {
    const dir = ttSort.asc ? 1 : -1;
    switch (ttSort.col) {
      case "sku":   return dir * bySku(a, b);
      case "name":  return dir * a.name.localeCompare(b.name);
      case "hot":   return dir * -byToday(a, b);
      case "month": return dir * (a.month_qty - b.month_qty);
      case "total": return dir * (a.total_qty - b.total_qty);
      case "price": return dir * ((a.avg_sale_cents ?? 0) - (b.avg_sale_cents ?? 0));
      case "value": return dir * ((a.month_value_cents ?? 0) - (b.month_value_cents ?? 0));
      case "stock": return dir * (a.stock - b.stock);
      case "last":  return dir * (a.last_at ?? "").localeCompare(b.last_at ?? "");
      default:      return 0;
    }
  });

  const load = useCallback(async () => {
    const [i, p, m, r, t, mo] = await Promise.all([
      api<{ items: InvItem[] }>(`/inventory`),
      api<{ records: PostRec[] }>(`/postage`),
      api<{ materials: Material[] }>(`/materials`),
      api<{ returns: SupplierReturn[]; totals: { total_cents: number; credited_cents: number; replaced_cents?: number; outstanding_cents: number } }>(`/inventory/returns`),
      api<{ items: TtOut[] }>(`/inventory/tiktok-out`), // v1.4.165
      api<{ outs: ManualOut[] }>(`/inventory/manual-outs`), // v1.4.170
    ]);
    if (i.data) setItems(i.data.items);
    if (p.data) setPostage(p.data.records);
    if (m.data) setMaterials(m.data.materials);
    if (r.data?.returns) { setReturns(r.data.returns); setRetTotals(r.data.totals); }
    if (t.data?.items) setTtOut(t.data.items);
    if (mo.data?.outs) setManualOuts(mo.data.outs);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 md:space-y-6">
      {invConfirmNode}
      {invToastNode}
      {/* v1.4.170 (CEO): manual stock-out MODAL — pick SKU/item, quantity,
          optional Sold @ (makes it a sale in the totals), and a MANDATORY
          remark for traceability. House card pattern + save-toast. */}
      {outModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOutModal(null)}>
          <div className="bg-background w-full max-w-md rounded-xl border p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">
              {outModal.edit_id ? "Edit manual stock movement" : outModal.dir === "in" ? "Manual stock in" : "Manual stock out"}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              The reason is required — every manual movement is logged with who,
              when and why.{outModal.dir === "out" ? " Fill Sold @ only when this out is a sale" : ""}
              {outModal.edit_id ? "; clearing it removes the sale from the totals. A qty change moves stock by the difference." : "."}
            </p>
            <div className="mt-3 space-y-2">
              <SubR t="SKU · Item">
                <select className={inputClass} value={outModal.item_id} disabled={!!outModal.edit_id}
                  title={outModal.edit_id ? "The item can't change on an existing record — delete and re-record instead" : undefined}
                  onChange={(e) => setOutModal((m) => m && ({ ...m, item_id: Number(e.target.value) }))}>
                  {[...items].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" })).map((it) => (
                    <option key={it.id} value={it.id}>{it.sku} · {it.name} ({it.stock} in stock)</option>
                  ))}
                </select>
              </SubR>
              <div className="grid grid-cols-2 gap-2">
                <SubR t={outModal.dir === "in" ? "Quantity in" : "Quantity out"}>
                  <input type="number" min={1} className={inputClass} value={outModal.qty}
                    onChange={(e) => setOutModal((m) => m && ({ ...m, qty: e.target.value }))} />
                </SubR>
                {/* nothing is sold on the way IN, so the price box only exists
                    on an out (v1.4.169: a price is what makes an out a sale). */}
                {outModal.dir === "out" ? (
                  <SubR t="Sold @ (RM/unit, optional)">
                    <input type="number" min={0} step="0.01" className={inputClass} placeholder="empty = correction"
                      value={outModal.price}
                      onChange={(e) => setOutModal((m) => m && ({ ...m, price: e.target.value }))} />
                  </SubR>
                ) : <span />}
              </div>
              {/* v1.4.172 (CEO): the DATE the stock went out — backdatable;
                  sales totals follow this date. */}
              <SubR t={outModal.dir === "in" ? "Date of stock in" : "Date of stock out"}>
                <input type="date" className={`${inputClass} sm:max-w-44`} value={outModal.out_date}
                  onChange={(e) => setOutModal((m) => m && ({ ...m, out_date: e.target.value }))} />
              </SubR>
              {/* v1.4.251: a picked reason, so a stock-count variance is
                  always worded the same way and can be reported on later;
                  the note underneath carries the specifics. */}
              {!outModal.edit_id && (
                <SubR t="Reason *">
                  <select className={inputClass} value={outModal.reason}
                    onChange={(e) => setOutModal((m) => m && ({ ...m, reason: e.target.value }))}>
                    <option value="">— pick a reason —</option>
                    {REASONS[outModal.dir].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </SubR>
              )}
              <SubR t={outModal.edit_id ? "Remark *" : "Note — the specifics (optional)"}>
                <textarea className={inputClass} rows={2}
                  placeholder={outModal.edit_id ? "Reason for this movement"
                    : outModal.dir === "in" ? "e.g. counted 21, system said 20 — 1 found on the top shelf"
                    : "e.g. counted 19, system said 21 — 2 missing after the JB event"}
                  value={outModal.remark}
                  onChange={(e) => setOutModal((m) => m && ({ ...m, remark: e.target.value }))} />
              </SubR>
              <div className="flex items-center gap-2">
                <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
                  onClick={async () => {
                    const qtyN = Math.floor(Number(outModal.qty));
                    if (!qtyN || qtyN <= 0) { invToast("Not saved", "Quantity must be at least 1", "notice"); return; }
                    if (!outModal.edit_id && !outModal.reason) { invToast("Not saved", "Pick a reason — it is what makes the movement traceable", "notice"); return; }
                    if (outModal.edit_id && !outModal.remark.trim()) { invToast("Not saved", "The remark (reason) is required for traceability", "notice"); return; }
                    // reason first, specifics after — one readable line in the trail
                    const note = outModal.remark.trim();
                    const full = outModal.edit_id ? note : note ? `${outModal.reason} — ${note}` : outModal.reason;
                    if (!outModal.edit_id) {
                      const ok = await adjust2(outModal.item_id, qtyN, outModal.price, full, outModal.out_date, outModal.dir);
                      if (ok) setOutModal(null);
                      return;
                    }
                    // v1.4.172: edit an existing record — server moves stock
                    // by the qty difference and keeps the sale totals in step.
                    const res = await api<{ error?: { message?: string } }>(`/inventory/manual-outs/${outModal.edit_id}/edit`, {
                      method: "POST",
                      body: JSON.stringify({
                        qty: qtyN, sale_price: outModal.price.trim() === "" ? "" : Number(outModal.price),
                        remark: full, out_date: outModal.out_date || undefined,
                      }),
                    });
                    if (!res.ok) { invToast("Not saved", res.data?.error?.message ?? "Edit failed", "notice"); return; }
                    invToast("Saved", "Stock-out record updated — stock and sales totals adjusted");
                    setOutModal(null);
                    void load();
                  }}>
                  {outModal.edit_id ? "Save changes" : outModal.dir === "in" ? "Record stock in" : "Record stock out"}
                </button>
                <button type="button" className="text-xs underline" onClick={() => setOutModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* v1.4.214 (CEO reorg): TikTok Orders moved to the new Ecommerce
          tab with the rest of the TikTok cards. Inventory keeps the stock
          views; the tracker follows the channel. */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Inventory — live status &amp; stock</p>
          {/* v1.4.229 (CEO: "csv button to download the inventory list for
              me to perform Stock Count"): client-side CSV of the current
              list in its on-screen sort, PLUS the three columns a physical
              stock count needs — Counted qty / Variance / Note — left
              blank for the person walking the shelves. */}
          <button type="button" className="border-border inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium hover:bg-secondary"
            onClick={() => {
              const esc = (v: string | number) => {
                const t = String(v);
                return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
              };
              const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
              const stamp = `${now.slice(8, 10)}-${now.slice(5, 7)}-${now.slice(0, 4)} ${now.slice(11, 16)} MYT`;
              const lines: string[] = [
                `# AZ ONE OFFICIAL — Inventory stock count sheet`,
                `# Generated ${stamp} — system stock as of this moment; count, write Counted qty, note variances`,
                ["SKU", "Item", "Price/unit (RM)", "Live rebate (RM)", "Net (RM)", "System stock", "Status", "Counted qty", "Variance", "Note"].join(","),
              ];
              let units = 0;
              for (const it of sortedItems) {
                const price = it.unit_price_cents ?? 0;
                const rebate = it.live_rebate_cents ?? 0;
                const net = Math.max(0, price - rebate);
                units += it.stock;
                lines.push([
                  esc(it.sku), esc(it.name), rmBare(price),
                  rebate > 0 ? `-${rmBare(rebate)}` : "",
                  rmBare(net), it.stock, it.status ?? "", "", "", "",
                ].join(","));
              }
              lines.push(["TOTAL", "", "", "", "", units, "", "", "", ""].join(","));
              const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `azoo-stock-count-${now.slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}>
            ⬇ CSV — stock count
          </button>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Stock moves automatically: a postage record with an item deducts it;
          a returned shipment adds it back. Use In/Out for manual corrections.
          Status recomputes on every movement (0 = out of stock · ≤5 = low).
        </p>
        {invMsg && <p className="text-destructive mt-1 text-xs font-medium">{invMsg}</p>}
        {/* v1.4.150: app-standard widths — a 2-up grid on phones (full-width
            fields, full-width button), the tidy inline row from sm: up. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <SubR t="SKU">
            <input className={`${inputClass} sm:max-w-40`} placeholder="must match TikTok" value={invDraft.sku}
              onChange={(e) => setInvDraft((d) => ({ ...d, sku: e.target.value }))} />
          </SubR>
          <SubR t="Item name">
            <input className={`${inputClass} sm:max-w-56`} placeholder="e.g. Tudung Sarah XL" value={invDraft.name}
              onChange={(e) => setInvDraft((d) => ({ ...d, name: e.target.value }))} />
          </SubR>
          <SubR t="Opening stock">
            <input type="number" min={0} className={`${inputClass} sm:max-w-24`} title="Opening stock" value={invDraft.stock}
              onChange={(e) => setInvDraft((d) => ({ ...d, stock: Number(e.target.value) }))} />
          </SubR>
          <SubR t="Price/unit (RM)">
            <input type="number" min={0} step="0.01" className={`${inputClass} sm:max-w-32`} placeholder="0.00" value={invDraft.unit_price}
              onChange={(e) => setInvDraft((d) => ({ ...d, unit_price: e.target.value }))} />
          </SubR>
          <button type="button" className={`${btnClass} col-span-2 justify-center sm:col-span-1 sm:h-[38px] sm:justify-start`}
            onClick={async () => {
              await api(`/inventory`, { method: "POST", body: JSON.stringify({ ...invDraft, unit_price: Number(invDraft.unit_price) || 0 }) });
              setInvDraft({ sku: "", name: "", stock: 0, unit_price: "" });
              void load();
            }}>
            Add item
          </button>
        </div>
        {items.length === 0 && (
          <p className="text-muted-foreground mt-3 text-sm">No items yet — add your first above; TikTok orders will start moving its stock automatically.</p>
        )}
        {items.length > 0 && (
        <>
        {/* v1.4.199 (CEO): pills removed — click the SKU / Item headers to
            sort, click again to reverse. */}
        <div className="mt-3 max-h-96 overflow-x-auto overflow-y-auto pr-1">
          <table className="tbl-sticky w-full min-w-[780px] border-collapse">
            <thead>
              <tr className="border-border border-b">
                {/* v1.4.281: all columns are sortable — click to asc, click again to desc */}
                {([
                  ["sku",  "SKU",               th],
                  ["name", "Item",              th],
                ] as [string, string, string][]).map(([col, label, cls]) => (
                  <th key={col} className={`${cls} cursor-pointer select-none whitespace-nowrap`}
                    title={`Sort by ${label} — click again to reverse`}
                    onClick={() => cycleInv(col as "sku" | "name")}>
                    {label}{invSort.col === col ? (invSort.asc ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th className={`${thR2} cursor-pointer select-none whitespace-nowrap`}
                  title="Sort by price — click again to reverse"
                  onClick={() => cycleInv("price")}>
                  Price/unit{invSort.col === "price" ? (invSort.asc ? " ▲" : " ▼") : ""}
                </th>
                {/* v1.4.166: rebate is AUTO — list price − the actual sold
                    price from the latest TikTok firm order (never typed in) */}
                <th className={thR2}>Live rebate (auto)</th>
                <th className={`${thR2} cursor-pointer select-none whitespace-nowrap`}
                  title="Sort by net (live) price — click again to reverse"
                  onClick={() => cycleInv("net")}>
                  Net (live){invSort.col === "net" ? (invSort.asc ? " ▲" : " ▼") : ""}
                </th>
                <th className={`${thR2} cursor-pointer select-none whitespace-nowrap`}
                  title="Sort by stock qty — click again to reverse"
                  onClick={() => cycleInv("stock")}>
                  Stock{invSort.col === "stock" ? (invSort.asc ? " ▲" : " ▼") : ""}
                </th>
                <th className={th}>Status</th>
                {/* v1.4.162: these two columns had no subheads (CEO spotted it) */}
                <th className={th}>Manual in / out</th><th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((it) => (
                /* v1.4.270: urgency tint — a stock line at the alert level
                   reads red before anyone reads the number. */
                <tr key={it.id} className={`border-border border-b last:border-0 ${it.stock <= 5 ? accentRowDanger : ""}`}>
                  <td className={`${td} font-mono text-xs ${it.stock <= 5 ? accentCellDanger : ""}`}>
                    {invEditId === it.id
                      ? <input className="border-input bg-background w-24 rounded border px-1.5 py-0.5 font-mono text-xs" value={invEditDraft.sku}
                          title="SKU — must match TikTok (or the item name will be used to match)"
                          onChange={(e) => setInvEditDraft((d) => ({ ...d, sku: e.target.value }))} />
                      : it.sku}
                  </td>
                  <td className={`${td} font-medium`}>
                    {invEditId === it.id
                      ? <input className="border-input bg-background w-36 rounded border px-1.5 py-0.5 text-xs" value={invEditDraft.name}
                          onChange={(e) => setInvEditDraft((d) => ({ ...d, name: e.target.value }))} />
                      : it.name}
                  </td>
                  <td className={tdR2}>
                    <input type="number" min={0} step="0.01" className="border-input bg-background w-20 rounded border px-1.5 py-0.5 text-right text-xs"
                      title="Price per unit (RM) — saves on change"
                      defaultValue={it.unit_price_cents ? rmBare(it.unit_price_cents) : ""}
                      onBlur={async (e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v < 0 || Math.round(v * 100) === (it.unit_price_cents ?? 0)) return;
                        await api(`/inventory/${it.id}`, { method: "PATCH", body: JSON.stringify({ stock: it.stock, unit_price: v }) });
                        void load();
                      }} />
                  </td>
                  <td className={tdR2}
                    title="AUTO — computed from the latest TikTok firm order: list price − actual sold price. Updates itself as orders sync; not manually editable (per the CEO, v1.4.166).">
                    {it.live_rebate_cents
                      ? <span className="font-medium text-amber-700 dark:text-amber-400">− {rmBare(it.live_rebate_cents)}</span>
                      : <span className="text-muted-foreground text-xs">auto</span>}
                  </td>
                  <td className={`${tdR2} font-medium ${it.live_rebate_cents ? "text-green-700 dark:text-green-400" : ""}`}
                    title="Effective price during TikTok Live = price/unit − live rebate">
                    {(() => { const n = Math.max(0, (it.unit_price_cents ?? 0) - (it.live_rebate_cents ?? 0)); return rmBare(n); })()}
                  </td>
                  {/* v1.4.270: the stock figure becomes comparable at a
                      glance — bar vs the list's own largest stock, red ≤5
                      (the low-stock alert line), amber ≤10. */}
                  <td className={tdR2}>
                    <span className="inline-flex flex-col items-end gap-0.5">
                      {it.stock}
                      <MiniBar className="w-14" pct={maxStock > 0 ? (it.stock / maxStock) * 100 : 0}
                        tone={it.stock <= 5 ? "red" : it.stock <= 10 ? "muted" : "gold"} />
                    </span>
                  </td>
                  <td className={td}><Badge value={it.status} /></td>
                  <td className={td}>
                    <span className="flex items-center gap-1">
                      <input type="number" min={1} className="border-input bg-background w-14 rounded border px-1.5 py-0.5 text-xs"
                        value={adjQty[it.id] ?? 1}
                        onChange={(e) => setAdjQty((q) => ({ ...q, [it.id]: Math.max(1, Number(e.target.value)) }))} />
                      {/* v1.4.251: an IN is a movement like any other — same
                          form, same mandatory reason, same confirmation. */}
                      <button type="button" className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                        title="Stock in — opens the form (reason required for traceability)"
                        onClick={() => setOutModal({ dir: "in", edit_id: null, item_id: it.id, qty: String(adjQty[it.id] ?? 1), price: "", reason: "", remark: "", out_date: todayMYT() })}>In +</button>
                      {/* v1.4.170 (CEO): Out goes through the modal — item,
                          qty, optional Sold @, MANDATORY remark. */}
                      <button type="button" className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                        title="Stock out — opens the form (remark required for traceability)"
                        onClick={() => setOutModal({ dir: "out", edit_id: null, item_id: it.id, qty: String(adjQty[it.id] ?? 1), price: "", reason: "", remark: "", out_date: todayMYT() })}>Out −</button>
                    </span>
                  </td>
                  <td className={td}>
                    {/* v1.4.162: fix wrongly inserted items — branded confirm +
                        save-toast, same standard as everywhere else. */}
                    <span className="flex items-center gap-1.5">
                      {invEditId === it.id ? (
                        <>
                          <button type="button" className="bg-primary text-primary-foreground rounded px-2 py-0.5 text-xs font-medium"
                            onClick={async () => {
                              const sku = invEditDraft.sku.trim(); const name = invEditDraft.name.trim();
                              if (!sku || !name) { invToast("No changes", "SKU and item name are both required", "notice"); return; }
                              if (sku === it.sku && name === it.name) { invToast("No changes", "Nothing was edited", "notice"); setInvEditId(null); return; }
                              const res = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/edit`, {
                                method: "POST", body: JSON.stringify({ sku, name }),
                              });
                              if (!res.ok) { invToast("Not saved", res.data?.error?.message ?? "Edit failed", "notice"); return; }
                              invToast("Saved", `${sku} — ${name} updated`);
                              setInvEditId(null);
                              void load();
                            }}>Save</button>
                          <button type="button" className="text-xs underline" onClick={() => setInvEditId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className={rowBtn} title="Edit SKU / item name"
                            onClick={() => { setInvEditId(it.id); setInvEditDraft({ sku: it.sku, name: it.name }); }}>Edit</button>
                          <button type="button" className={rowBtnDanger} title="Delete a wrongly inserted item"
                            onClick={async () => {
                              if (!(await invConfirm({
                                title: "Delete this item?",
                                message: `${it.sku} — ${it.name} (${it.stock} in stock) will be removed from the stock list. Items with shipment or supplier-return history can't be deleted — edit those instead.`,
                                confirmLabel: "Delete item", variant: "danger",
                              }))) return;
                              const res = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/delete`, { method: "POST", body: JSON.stringify({}) });
                              if (!res.ok) { invToast("Not deleted", res.data?.error?.message ?? "Delete failed", "notice"); return; }
                              invToast("Deleted", `${it.sku} — ${it.name} removed`);
                              void load();
                            }}>Delete</button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* v1.4.188 (CEO: "I want to have the total of inventory prices
                for me to monitor how much that Stock I have for me to clear
                off"): bold TOTAL — units on hand, value at list price, and
                value at net (live) after auto rebates (what clearing it on
                Live would actually bring in). Same footer standard as the
                stock-out card (v1.4.172). */}
            <tfoot>
              {(() => {
                const tot = sortedItems.reduce(
                  (a, it) => {
                    const price = it.unit_price_cents ?? 0;
                    const net = Math.max(0, price - (it.live_rebate_cents ?? 0));
                    a.units += it.stock;
                    a.value += it.stock * price;
                    a.net += it.stock * net;
                    return a;
                  },
                  { units: 0, value: 0, net: 0 },
                );
                return (
                  <tr className="border-border border-t-2 font-semibold">
                    <td className={td} colSpan={2}>TOTAL — stock on hand</td>
                    <td className={tdR2} title="Σ stock × price/unit — the value sitting in stock at list price">
                      RM {rmBare(tot.value)}
                    </td>
                    <td className={td}></td>
                    <td className={`${tdR2} text-green-700 dark:text-green-400`}
                      title="Σ stock × net (live) — what clearing everything on TikTok Live would bring in after the auto rebates">
                      RM {rmBare(tot.net)}
                    </td>
                    <td className={tdR2}>{tot.units}</td>
                    <td className={td} colSpan={3}></td>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
        </>
        )}
      </div>

      {/* v1.4.165 (CEO): which items went OUT through TikTok Live sales —
          straight from the stock deductions the sync/webhook recorded on
          TT- orders (returned orders excluded). Times are MYT. */}
      <div className={card}>
        <p className="text-sm font-semibold">📉 TikTok Live — stock out</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Units deducted by TikTok orders, per item — so you can see what
          moved during today&apos;s live and across the month. Counted from the
          actual stock movements (returned orders excluded). &quot;Avg sold @&quot;
          is the real price buyers paid (TikTok sale price) — the amber figure
          beside it is the auto-computed rebate vs your list price.
        </p>
        {ttOut.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            No TikTok stock movements yet — they appear here as soon as an
            order deducts stock (SKU or item-name match).
          </p>
        ) : (
          <>
          {/* v1.4.199 (CEO): pills removed — click Out today / SKU / Item
              headers to sort; default stays hottest-today-first. */}
          <div className="mt-3 max-h-80 overflow-x-auto overflow-y-auto pr-1">
            <table className="tbl-sticky w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-border border-b">
                  {([
                    ["sku",   "SKU",       th],
                    ["name",  "Item",      th],
                    ["hot",   "Out today", thR2],
                    ["month", "This month", thR2],
                    ["total", "All time",  thR2],
                    ["price", "Avg sold @", thR2],
                    ["value", "Sold value (month)", thR2],
                    ["stock", "Left in stock", thR2],
                    ["last",  "Last order", thR2],
                  ] as [TtCol, string, string][]).map(([col, label, cls]) => (
                    <th key={col} className={`${cls} cursor-pointer select-none whitespace-nowrap`}
                      title={`Sort by ${label} — click again to reverse`}
                      onClick={() => cycleTt(col)}>
                      {label}{ttSort.col === col ? (ttSort.asc ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTtOut.map((t) => (
                  <tr key={t.id} className="border-border border-b last:border-0">
                    <td className={`${td} font-mono text-xs`}>{t.sku}</td>
                    <td className={`${td} font-medium`}>{t.name}</td>
                    <td className={tdR2}>
                      {t.today_qty > 0
                        ? <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold whitespace-nowrap text-green-800">🔥 {t.today_qty}</span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className={tdR2}>{t.month_qty}</td>
                    <td className={tdR2}>{t.total_qty}</td>
                    <td className={tdR2}
                      title={t.avg_sale_cents != null && t.unit_price_cents ? `List RM ${rmBare(t.unit_price_cents)} − sold RM ${rmBare(t.avg_sale_cents)} = rebate RM ${rmBare(Math.max(0, (t.unit_price_cents ?? 0) - t.avg_sale_cents))}/unit` : "No sold price captured yet — arrives with the next synced order"}>
                      {t.avg_sale_cents != null
                        ? <>RM {rmBare(t.avg_sale_cents)}{t.unit_price_cents && t.unit_price_cents > t.avg_sale_cents
                            ? <span className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-400">(− {rmBare(t.unit_price_cents - t.avg_sale_cents)})</span>
                            : null}</>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className={tdR2}>{t.month_value_cents ? `RM ${rmBare(t.month_value_cents)}` : <span className="text-muted-foreground text-xs">—</span>}</td>
                    <td className={tdR2}>{t.stock}</td>
                    <td className={`${tdR2} text-muted-foreground text-xs`}>{t.last_at ? dmyMYT(t.last_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              {/* v1.4.171 (CEO): TOTAL row — sums across every item; the
                  Avg sold @ total is WEIGHTED by units (Σ price×qty ÷ Σ qty),
                  not a simple average of the row averages. v1.4.207: moved
                  into a real tfoot so the sticky-total CSS pins it to the
                  bottom of the scroll area like the Inventory card. */}
              <tfoot>
                {(() => {
                  const sum = (f: (t: TtOut) => number) => ttOut.reduce((a, t) => a + f(t), 0);
                  const today = sum((t) => t.today_qty);
                  const month = sum((t) => t.month_qty);
                  const all = sum((t) => t.total_qty);
                  const monthVal = sum((t) => t.month_value_cents ?? 0);
                  const stock = sum((t) => t.stock);
                  const pricedUnits = sum((t) => (t.avg_sale_cents != null ? t.total_qty : 0));
                  const pricedValue = sum((t) => (t.avg_sale_cents != null ? t.avg_sale_cents * t.total_qty : 0));
                  const wAvg = pricedUnits > 0 ? pricedValue / pricedUnits : null;
                  return (
                    <tr className="border-border border-t-2 font-semibold">
                      <td className={td} colSpan={2}>TOTAL</td>
                      <td className={tdR2}>{today > 0 ? <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold whitespace-nowrap text-green-800">🔥 {today}</span> : "—"}</td>
                      <td className={tdR2}>{month}</td>
                      <td className={tdR2}>{all}</td>
                      <td className={tdR2} title="Weighted by units sold (Σ price × qty ÷ Σ qty)">{wAvg != null ? `RM ${rmBare(wAvg)}` : "—"}</td>
                      <td className={tdR2}>RM {rmBare(monthVal)}</td>
                      <td className={tdR2}>{stock}</td>
                      <td className={td}></td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
          </>
        )}
      </div>

      {/* v1.4.170 (CEO): the traceability card — every manual stock out with
          the mandatory remark, who and when. Scrollable like the rest. */}
      <div className={card}>
        <p className="text-sm font-semibold">🛠 Manual stock movements — traceability</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Every manual In + and Out − with its reason, recorded by whom and
          when. Rows with a sold price also count in Total sales (Manual sales
          channel); rows without are corrections — excluded from sales by
          design. To settle a stock count, record the difference here: pick
          <span className="font-medium"> Stock count variance</span> and write
          what you counted against what the system said.
        </p>
        {manualOuts.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">No manual stock outs yet — they appear here the moment one is recorded.</p>
        ) : (
          /* v1.4.196 (CEO): audit-trail rows hide behind one click — minimalist view */
          <DetailsToggle label={`Show records (${manualOuts.length})`}>
          <div className="mt-1 max-h-72 space-y-0 overflow-y-auto pr-1">
            {manualOuts.map((o) => (
              <div key={o.id} className={`border-border border-b py-1.5 text-sm last:border-0 ${o.reverted ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <span className={`min-w-0 ${o.reverted ? "line-through" : ""}`}>
                  {/* v1.4.172: the movement DATE leads (backdatable) and, with
                      the SKU, is what identifies the row — v1.4.252 makes the
                      pair the toggle so the item, reason and who recorded it
                      open underneath instead of being truncated away. */}
                  <RecordToggle open={openMove === o.id} title="Item, reason, and who recorded it"
                    onToggle={() => setOpenMove(openMove === o.id ? null : o.id)}>
                    {o.out_date ? dmy(o.out_date) : dmyMYT(o.created_at)} · {o.sku}
                  </RecordToggle>
                  {/* v1.4.251: direction is the first thing you should see */}
                  <span className={o.direction === "in" ? "font-medium text-green-700" : ""}> · {o.direction === "in" ? "+" : "−"}{o.qty} pcs</span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  {o.reverted ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">↩ reverted — stock restored</span>
                  ) : o.unit_sale_cents != null
                    ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Sold @ RM {rmBare(o.unit_sale_cents)}</span>
                    : <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">correction</span>}
                  {o.created_by_name && <span className="text-muted-foreground text-[10px]">by {o.created_by_name.split(" ")[0]}</span>}
                  {/* v1.4.172: lifecycle — Edit / ↩ Revert (keeps the row for
                      the audit trail) / Delete (wrong record: stock back +
                      sale removed + row gone). */}
                  {!o.reverted && (
                    <>
                      <button type="button" className={rowBtn} title="Edit qty / Sold @ / remark / date — stock and sales totals follow"
                        onClick={() => setOutModal({
                          dir: (o as ManualOut & { direction?: string }).direction === "in" ? "in" : "out",
                          edit_id: o.id, item_id: o.item_id, qty: String(o.qty),
                          price: o.unit_sale_cents != null ? rmBare(o.unit_sale_cents) : "",
                          reason: "", remark: o.remark, out_date: (o.out_date ?? o.created_at.slice(0, 10)),
                        })}>Edit</button>
                      <button type="button" className={rowBtn} title="Put the stock back on the shelf; a sale is removed from the totals; the row stays for the audit trail"
                        onClick={async () => {
                          if (!(await invConfirm({
                            title: "Revert this stock out?",
                            message: `${o.qty} × ${o.sku} goes back into stock${o.unit_sale_cents != null ? ` and the RM ${rmBare(o.unit_sale_cents * o.qty)} sale is removed from the totals` : ""}. The record stays here marked ↩ reverted.`,
                            confirmLabel: "Revert",
                          }))) return;
                          const res = await api<{ error?: { message?: string } }>(`/inventory/manual-outs/${o.id}/revert`, { method: "POST", body: JSON.stringify({}) });
                          if (!res.ok) { invToast("Not reverted", res.data?.error?.message ?? "Revert failed", "notice"); return; }
                          invToast("Reverted", `${o.qty} × ${o.sku} back in stock`);
                          void load();
                        }}>↩ Revert</button>
                    </>
                  )}
                  <button type="button" className={rowBtnDanger} title="Wrong record: stock restored (unless already reverted), any sale removed, row deleted"
                    onClick={async () => {
                      if (!(await invConfirm({
                        title: "Delete this stock-out record?",
                        message: o.reverted
                          ? "The stock was already restored by the revert — only the record itself is removed."
                          : `${o.qty} × ${o.sku} goes back into stock${o.unit_sale_cents != null ? `, the sale is removed from the totals` : ""}, and the record is deleted. For a normal undo, use ↩ Revert instead — it keeps the trail.`,
                        confirmLabel: "Delete record", variant: "danger",
                      }))) return;
                      const res = await api<{ error?: { message?: string } }>(`/inventory/manual-outs/${o.id}/delete`, { method: "POST", body: JSON.stringify({}) });
                      if (!res.ok) { invToast("Not deleted", res.data?.error?.message ?? "Delete failed", "notice"); return; }
                      invToast("Deleted", "Record removed");
                      void load();
                    }}>Delete</button>
                </span>
              </div>
              {openMove === o.id && (
                <DetailGrid items={[
                  { label: "Item", wide: true, value: `${o.sku} — ${o.item_name}` },
                  { label: "Movement", value: `${o.direction === "in" ? "Stock in" : "Stock out"} · ${o.qty} pcs` },
                  { label: "Date", value: o.out_date ? dmy(o.out_date) : dmyMYT(o.created_at) },
                  { label: "Sold @", value: o.unit_sale_cents != null ? `RM ${rmBare(o.unit_sale_cents)} — counts as a sale` : "— correction, not a sale" },
                  { label: "Recorded by", value: o.created_by_name ?? "" },
                  { label: "Recorded at", value: dmyMYT(o.created_at) },
                  { label: "Reason", wide: true, value: o.remark },
                  { label: "State", wide: true, value: o.reverted ? "↩ Reverted — the stock was put back" : "" },
                ]} />
              )}
              </div>
            ))}
          </div>
          </DetailsToggle>
        )}
      </div>

      {/* v1.4.148: rejected stock back to the supplier, costing tracked for
          the claim-back. Recording a return deducts stock immediately. */}
      <div className={card}>
        <p className="text-sm font-semibold">Supplier returns — rejects to claim back</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Record rejected/defective items sent back to the supplier. Stock is
          deducted on record. The supplier settles either way: mark the row
          credited when money comes back, or replaced when replacement goods
          arrive (stock returns automatically) — the outstanding figure is what
          the supplier still owes the company.
        </p>
        {retTotals && retTotals.total_cents > 0 && (
          <div className="border-border bg-secondary/40 mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs">
            <span className="font-semibold">Returned {rmR(retTotals.total_cents)}</span>
            <span className="text-green-800">Credited back {rmR(retTotals.credited_cents)}</span>
            {(retTotals.replaced_cents ?? 0) > 0 && <span className="text-blue-800">Replaced in goods {rmR(retTotals.replaced_cents ?? 0)}</span>}
            <span className={retTotals.outstanding_cents > 0 ? "font-medium text-amber-700" : "text-muted-foreground"}>
              Outstanding {rmR(retTotals.outstanding_cents)}
            </span>
          </div>
        )}
        {retMsg && <p className="text-destructive mt-1.5 text-xs font-medium">{retMsg}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <SubR t="Item" className="col-span-2 sm:col-span-1">
            <select className={`${inputClass} sm:max-w-64`} value={retDraft.item_id}
              onChange={(e) => {
                const id = Number(e.target.value);
                const it = items.find((x) => x.id === id);
                setRetDraft((d) => ({ ...d, item_id: id, unit_cost: it?.unit_price_cents ? rmBare(it.unit_price_cents) : d.unit_cost }));
              }}>
              <option value={0}>Select item…</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name} ({it.stock} in stock)</option>)}
            </select>
          </SubR>
          <SubR t="Qty rejected">
            <input type="number" min={1} className={`${inputClass} sm:max-w-24`} value={retDraft.qty}
              onChange={(e) => setRetDraft((d) => ({ ...d, qty: Number(e.target.value) }))} />
          </SubR>
          <SubR t="Unit cost (RM)">
            <input type="number" min={0} step="0.01" className={`${inputClass} sm:max-w-28`} placeholder="0.00" value={retDraft.unit_cost}
              onChange={(e) => setRetDraft((d) => ({ ...d, unit_cost: e.target.value }))} />
          </SubR>
          <SubR t="Supplier">
            <input className={`${inputClass} sm:max-w-44`} placeholder="e.g. Tekstil Maju Sdn Bhd" value={retDraft.supplier}
              onChange={(e) => setRetDraft((d) => ({ ...d, supplier: e.target.value }))} />
          </SubR>
          <SubR t="Return date">
            <input type="date" className={`${inputClass} sm:max-w-40`} value={retDraft.return_date}
              onChange={(e) => setRetDraft((d) => ({ ...d, return_date: e.target.value }))} />
          </SubR>
          <SubR t="Reason (defect etc.)" className="col-span-2 sm:col-span-1">
            <input className={`${inputClass} sm:max-w-52`} placeholder="e.g. stitching defect, wrong colour" value={retDraft.reason}
              onChange={(e) => setRetDraft((d) => ({ ...d, reason: e.target.value }))} />
          </SubR>
          <button type="button" className={`${btnClass} col-span-2 justify-center sm:col-span-1 sm:h-[38px] sm:justify-start`}
            onClick={async () => {
              setRetMsg("");
              const res = await api<{ error?: { message?: string } }>(`/inventory/returns`, {
                method: "POST",
                body: JSON.stringify({
                  item_id: retDraft.item_id, qty: retDraft.qty,
                  unit_cost: retDraft.unit_cost === "" ? undefined : Number(retDraft.unit_cost),
                  supplier: retDraft.supplier, reason: retDraft.reason, return_date: retDraft.return_date,
                }),
              });
              if (!res.ok) { setRetMsg(res.data?.error?.message ?? "Could not record the return"); return; }
              setRetDraft({ item_id: 0, qty: 1, unit_cost: "", supplier: "", reason: "", return_date: "" });
              void load();
            }}>
            Record return
          </button>
        </div>
        {/* v1.4.196 (CEO): the history list hides behind one click — minimalist view */}
        <DetailsToggle label="Returns history">
        <div className="mt-1 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {returns.length === 0 && <p className="text-muted-foreground text-sm">No supplier returns recorded.</p>}
          {returns.map((r) => (
            <div key={r.id} className="border-border border-b py-1.5 text-sm last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                {/* v1.4.252: date + SKU identify the return; the item, supplier
                    and defect reason open underneath. */}
                <RecordToggle open={openRet === r.id} title="Item, supplier and the defect reason"
                  onToggle={() => setOpenRet(openRet === r.id ? null : r.id)}>
                  {dmy(r.return_date)} · {r.sku}
                </RecordToggle>
                {" · "}<span className="font-semibold">{rmR(r.total_cents)}</span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                {r.status === "credited" ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    Credited {rmR(r.credited_cents ?? r.total_cents)}
                  </span>
                ) : r.status === "replaced" ? (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                    Replaced {r.qty} pcs
                  </span>
                ) : (
                  <>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Outstanding{(r.replaced_qty ?? 0) > 0 ? ` (${r.replaced_qty}/${r.qty} replaced)` : ""}
                    </span>
                    {creditingId === r.id ? (
                      <span className="flex items-center gap-1">
                        <input type="number" min={0} step="0.01" autoFocus
                          className={`${inputClass} h-7 max-w-24 text-xs`}
                          placeholder={rmBare(r.total_cents)}
                          value={creditAmt}
                          onChange={(e) => setCreditAmt(e.target.value)} />
                        <button type="button" className="text-xs font-medium underline"
                          onClick={async () => {
                            await api(`/inventory/returns/${r.id}/credit`, { method: "POST", body: JSON.stringify({ credited: creditAmt.trim() === "" ? undefined : Number(creditAmt) }) });
                            setCreditingId(null); setCreditAmt("");
                            void load();
                          }}>
                          Save
                        </button>
                        <button type="button" className="text-muted-foreground text-xs underline" onClick={() => { setCreditingId(null); setCreditAmt(""); }}>cancel</button>
                      </span>
                    ) : replacingId === r.id ? (
                      <span className="flex items-center gap-1">
                        <input type="number" min={1} max={r.qty - (r.replaced_qty ?? 0)} autoFocus
                          className={`${inputClass} h-7 max-w-20 text-xs`}
                          placeholder={String(r.qty - (r.replaced_qty ?? 0))}
                          value={replaceQty}
                          onChange={(e) => setReplaceQty(e.target.value)} />
                        <button type="button" className="text-xs font-medium underline"
                          onClick={async () => {
                            await api(`/inventory/returns/${r.id}/replace`, { method: "POST", body: JSON.stringify({ qty: replaceQty.trim() === "" ? undefined : Number(replaceQty) }) });
                            setReplacingId(null); setReplaceQty("");
                            void load();
                          }}>
                          Save
                        </button>
                        <button type="button" className="text-muted-foreground text-xs underline" onClick={() => { setReplacingId(null); setReplaceQty(""); }}>cancel</button>
                      </span>
                    ) : (
                      <>
                        <button type="button" className={rowBtn} title="Enter the amount the supplier refunded (blank = full amount)"
                          onClick={() => { setCreditingId(r.id); setCreditAmt(""); }}>
                          Mark credited
                        </button>
                        <button type="button" className={rowBtn} title="Replacement goods arrived — qty goes back into stock (blank = all remaining)"
                          onClick={() => { setReplacingId(r.id); setReplaceQty(""); }}>
                          Replaced
                        </button>
                      </>
                    )}
                    {(r.replaced_qty ?? 0) === 0 && retEditId !== r.id && (
                      <button type="button" className={rowBtn} title="Fix a wrongly entered return — qty change moves stock by the difference"
                        onClick={() => {
                          setRetEditId(r.id);
                          setRetEditDraft({
                            qty: String(r.qty), unit_cost: rmBare(r.unit_cost_cents),
                            supplier: r.supplier, return_date: r.return_date.slice(0, 10), reason: r.reason ?? "",
                          });
                        }}>Edit</button>
                    )}
                    {(r.replaced_qty ?? 0) === 0 && <button type="button" className={rowBtnDanger}
                      onClick={async () => {
                        if (!(await invConfirm({
                          title: "Delete this supplier return?",
                          message: `${r.qty} × ${r.sku} goes back into stock and the ${rmR(r.total_cents)} claim record is removed.`,
                          confirmLabel: "Delete return", variant: "danger",
                        }))) return;
                        await api(`/inventory/returns/${r.id}/delete`, { method: "POST", body: JSON.stringify({}) });
                        void load();
                      }}>
                      Delete
                    </button>}
                  </>
                )}
              </span>
              {/* v1.4.164: inline editor for outstanding returns — standard
                  subheaded fields + save-toast; qty change moves stock by the
                  difference (server-enforced). */}
              {retEditId === r.id && (
                <div className="grid w-full grid-cols-2 items-end gap-2 rounded-lg bg-secondary/40 p-2 sm:flex sm:flex-wrap">
                  <SubR t="Qty rejected">
                    <input type="number" min={1} className={`${inputClass} sm:max-w-24`} value={retEditDraft.qty}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, qty: e.target.value }))} />
                  </SubR>
                  <SubR t="Unit cost (RM)">
                    <input type="number" min={0} step="0.01" className={`${inputClass} sm:max-w-28`} value={retEditDraft.unit_cost}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, unit_cost: e.target.value }))} />
                  </SubR>
                  <SubR t="Supplier">
                    <input className={`${inputClass} sm:max-w-44`} value={retEditDraft.supplier}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, supplier: e.target.value }))} />
                  </SubR>
                  <SubR t="Return date">
                    <input type="date" className={`${inputClass} sm:max-w-40`} value={retEditDraft.return_date}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, return_date: e.target.value }))} />
                  </SubR>
                  <SubR t="Reason" className="col-span-2 sm:max-w-52">
                    <input className={inputClass} value={retEditDraft.reason}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, reason: e.target.value }))} />
                  </SubR>
                  <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium"
                    onClick={async () => {
                      const qtyN = Math.floor(Number(retEditDraft.qty));
                      const costN = Number(retEditDraft.unit_cost);
                      if (!qtyN || qtyN <= 0 || !Number.isFinite(costN) || costN < 0 || !retEditDraft.supplier.trim() || !retEditDraft.return_date) {
                        invToast("No changes", "Qty (>0), unit cost, supplier and date are required", "notice"); return;
                      }
                      const res = await api<{ error?: { message?: string } }>(`/inventory/returns/${r.id}/edit`, {
                        method: "POST",
                        body: JSON.stringify({
                          qty: qtyN, unit_cost: costN, supplier: retEditDraft.supplier.trim(),
                          return_date: retEditDraft.return_date, reason: retEditDraft.reason.trim() || undefined,
                        }),
                      });
                      if (!res.ok) { invToast("Not saved", res.data?.error?.message ?? "Edit failed", "notice"); return; }
                      invToast("Saved", `Return updated — ${qtyN} × RM ${rmBare(Math.round(costN * 100))}${qtyN !== r.qty ? " (stock adjusted by the difference)" : ""}`);
                      setRetEditId(null);
                      void load();
                    }}>Save</button>
                  <button type="button" className="text-xs underline" onClick={() => setRetEditId(null)}>Cancel</button>
                </div>
              )}
            </div>
            {openRet === r.id && (
              <DetailGrid items={[
                { label: "Item", wide: true, value: `${r.sku} — ${r.item_name}` },
                { label: "Quantity", value: `${r.qty} pcs` },
                { label: "Unit cost", value: rmR(r.unit_cost_cents) },
                { label: "Total claim", value: rmR(r.total_cents) },
                { label: "Supplier", value: r.supplier },
                { label: "Returned on", value: dmy(r.return_date) },
                { label: "Replaced", value: (r.replaced_qty ?? 0) > 0 ? `${r.replaced_qty} of ${r.qty} pcs` : "" },
                { label: "Credited", value: r.credited_cents != null ? rmR(r.credited_cents) : "" },
                { label: "Reason", wide: true, value: r.reason ?? "" },
              ]} />
            )}
            </div>
          ))}
        </div>
        </DetailsToggle>
      </div>

      <div className="grid items-start gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">Postage tracking — non-TikTok orders</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            TikTok orders arrive automatically (webhook + 30-minute sync) with
            their items and tracking. Use this form only for other channels —
            Shopee, WhatsApp/direct sales, replacements.
          </p>
          <div className="mt-3 space-y-2">
            <SubR t="Order reference">
            <input className={inputClass} placeholder="e.g. SHP-10023 / WA order" value={postDraft.order_ref}
              onChange={(e) => setPostDraft((d) => ({ ...d, order_ref: e.target.value }))} /></SubR>
            <div className={fieldRow}>
              <SubR t="Courier">
              <input className={inputClass} placeholder="e.g. J&T, Pos Laju" value={postDraft.courier}
                onChange={(e) => setPostDraft((d) => ({ ...d, courier: e.target.value }))} /></SubR>
              <SubR t="Tracking no.">
              <input className={inputClass} placeholder="e.g. MY123456789" value={postDraft.tracking_no}
                onChange={(e) => setPostDraft((d) => ({ ...d, tracking_no: e.target.value }))} /></SubR>
              {/* v1.4.169: sales value of the non-TikTok order — counts in
                  Total sales + KPI (leave empty for RM 0 shipments like
                  replacements, which stay out of the totals) */}
              <SubR t="Order amount (RM)" className="col-span-2 sm:col-span-1">
              <input type="number" min={0} step="0.01" className={`${inputClass} sm:max-w-32`} placeholder="0.00"
                title="What the customer paid for this order — counted in Total sales. Leave empty for replacements / non-sales shipments."
                value={postDraft.order_amount}
                onChange={(e) => setPostDraft((d) => ({ ...d, order_amount: e.target.value }))} /></SubR>
            </div>
            {postLines.map((line, idx) => (
              <div key={idx} className={fieldRow}>
                <select className={`${inputClass} col-span-2 sm:col-span-1 sm:flex-1`} value={line.inventory_item_id}
                  onChange={(e) => setPostLines((ls) => ls.map((l, i) => i === idx ? { ...l, inventory_item_id: Number(e.target.value) } : l))}>
                  <option value={0}>Select item…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.sku} · {it.name} ({it.stock} in stock)</option>
                  ))}
                </select>
                <input type="number" min={1} className={`${inputClass} sm:max-w-20`} value={line.qty}
                  title="Quantity shipped"
                  onChange={(e) => setPostLines((ls) => ls.map((l, i) => i === idx ? { ...l, qty: Math.max(1, Number(e.target.value)) } : l))} />
                <button type="button" className="text-destructive text-xs underline"
                  onClick={() => setPostLines((ls) => ls.filter((_, i) => i !== idx))}>Remove</button>
              </div>
            ))}
            {/* v1.4.155: block, not inline — as an inline button it shared its
                line box with the inline-flex Add record button below, so the
                link and the button rendered jammed together on one line. */}
            <button type="button" className="block text-left text-xs underline"
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
                  body: JSON.stringify({
                    ...postDraft,
                    order_amount: postDraft.order_amount.trim() === "" ? undefined : Number(postDraft.order_amount),
                    items: lines.length > 0 ? lines : undefined,
                  }),
                });
                if (!res.ok) {
                  setPostMsg(res.data?.error?.message ?? "Could not add record");
                } else {
                  setPostDraft({ order_ref: "", courier: "", tracking_no: "", order_amount: "" });
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
          {/* v1.4.155: items-end + matched button height (38px input vs 36px
              btn) so Request sits flush beside the field instead of floating
              at label height; the input takes the remaining width so its
              placeholder isn't clipped. */}
          <div className="mt-3 flex items-end gap-2">
            <SubR t="Material needed" className="min-w-0 flex-1">
            <input className={inputClass} placeholder="e.g. Raya campaign product cards" value={matDraft}
              onChange={(e) => setMatDraft(e.target.value)} /></SubR>
            <button type="button" className={`${btnClass} h-[38px] whitespace-nowrap`}
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

/* v1.19.0 (consolidation C1): four panels removed —
   CommercialPanel + OperationsPanel (exported but rendered by NO tab; their
   /bd and /ops-reports routes are gone too), the private PnlCard copy (the
   page-level PnlCard on the Finance tab is the one P&L), and OverviewPanel
   (the Overview tab is retired; its two unique cards live on in
   components/portal/company-monitor.tsx on the Tasks and Inventory tabs). */

/* ================= Birthdays (CEO + HR tier) ================= */

/**
 * Dedicated birthday manager. HR tier reaches birthdays via the HR tab, but
 * the CEO — read-only elsewhere — has an explicit birthday exception, so this
 * gives the CEO (and HR/COO/CCO) a place to set and see them. Writes go through
 * PATCH /staff/users/:id with only the birthday field, which the API permits
 * for the CEO by policy.
 */
export function BirthdaysPanel() {
  const [staff, setStaff] = useState<{ id: number; name: string; full_name?: string | null; role: string; birthday?: string | null }[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ users?: { id: number; name: string; full_name?: string | null; role: string; birthday?: string | null }[], staff?: { id: number; name: string; full_name?: string | null; role: string; birthday?: string | null }[] }>(`/users`);
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
              {/* v1.4.261: the legal name, same rule as the register and
                  payroll — /users always carried full_name; this panel's local
                  type just never declared it, so the fallback was invisible. */}
              {displayName(u)} <span className="text-muted-foreground font-normal">· {u.role.replace(/_/g, " ")}</span>
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
  role?: string;
  type: string;
  created_at: string;
  myt_time?: string;
  flag?: string;
  manual_by?: number | null;
  amended_by?: number | null;
  gps?: string | null;
}

/* v1.21.0 (allow-but-flag geofence): where the punch happened, against HQ.
   Staff outside radius + min(acc,150) grace show RED; CEO/COO/CCO are
   exempt from the flag (distance shows neutrally); manual/amended rows and
   pre-GPS history show nothing. Same maths as the server gate. */
function attLoc(r: AttRecord): { text: string; tone: "ok" | "flag" | "muted" } | null {
  if (r.manual_by || r.amended_by) return null; // typed by HR, no device GPS
  const m = r.gps ? /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?/.exec(r.gps) : null;
  const exempt = ["ceo", "coo", "cco"].includes(r.role ?? "");
  // No stored location: history predates the GPS requirement (v1.18.1) —
  // muted, not red, or July would read as a wall of violations.
  if (!m) return r.gps === undefined ? null : { text: "no location", tone: "muted" };
  const o = SITE_CONFIG.office;
  const [lat, lng] = [Number(m[1]), Number(m[2])];
  const acc = m[3] ? Math.min(Number(m[3]), 150) : 0;
  const rad = Math.PI / 180;
  const dLat = (o.lat - lat) * rad, dLng = (o.lng - lng) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(o.lat * rad) * Math.sin(dLng / 2) ** 2;
  const dist = Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  const near = dist <= o.radiusM + acc;
  const shown = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`;
  if (exempt) return { text: shown, tone: "muted" };
  return near ? { text: `at office (${shown})`, tone: "ok" } : { text: `OUTSIDE (${shown})`, tone: "flag" };
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
  const [staff, setStaff] = useState<{ id: number; name: string; full_name?: string | null }[]>([]);
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
      api<{ users?: { id: number; name: string; full_name?: string | null; role: string }[]; staff?: { id: number; name: string; full_name?: string | null; role: string }[] }>(`/users`),
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

      {/* v1.4.186 mobile audit: this row predated the v1.4.154 width
          standard (inline maxWidth styles escaped the class sweep) and
          wrapped raggedly on phones. Phones now use the standard 2-up
          full-width grid — staff select spanning, type|date, time|Add,
          then the filter row; desktop keeps the capped inline row. */}
      <span className="text-muted-foreground mt-3 block text-[11px] font-semibold tracking-wide uppercase">Add record</span>
      <div className="mt-1 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <select className={`${inputClass} col-span-2 w-full sm:max-w-56`} value={add.user_id}
          onChange={(e) => setAdd((d) => ({ ...d, user_id: Number(e.target.value) }))}>
          <option value={0}>Select staff…</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)}</option>)}
        </select>
        <select className={`${inputClass} w-full sm:max-w-32`} value={add.type}
          onChange={(e) => setAdd((d) => ({ ...d, type: e.target.value }))}>
          <option value="clock_in">Clock in</option>
          <option value="clock_out">Clock out</option>
        </select>
        <input type="date" className={`${inputClass} w-full min-w-0 sm:max-w-40`} value={add.date}
          onChange={(e) => setAdd((d) => ({ ...d, date: e.target.value }))} />
        <input type="time" className={`${inputClass} w-full min-w-0 sm:max-w-28`} value={add.time}
          onChange={(e) => setAdd((d) => ({ ...d, time: e.target.value }))} />
        <button type="button"
          className="bg-primary text-primary-foreground inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium disabled:opacity-50 sm:h-8"
          disabled={!add.user_id || !add.date || !add.time}
          onClick={() => void act(`/attendance/manual`, {
            method: "POST",
            body: JSON.stringify({ user_id: add.user_id, type: add.type, myt: `${add.date} ${add.time}` }),
          }, "Record added.")}>
          Add
        </button>
        <select className={`${inputClass} col-span-2 w-full sm:ml-auto sm:max-w-52`} value={filterId}
          title="Show one staff member's records only"
          onChange={(e) => setFilterId(Number(e.target.value))}>
          <option value={0}>Find staff: everyone</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)}</option>)}
        </select>
        <input type="month" className={`${inputClass} col-span-2 w-full min-w-0 sm:max-w-40`} value={month}
          onChange={(e) => setMonth(e.target.value)} />
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}

      <div className="mt-3 max-h-[26rem] overflow-x-auto overflow-y-auto">
        <table className="tbl-sticky w-full min-w-[560px] border-collapse text-sm">
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
                <td className={td}>{properName(r.name)}</td>
                <td className={td}>{r.type === "clock_in" ? "In" : "Out"}</td>
                <td className={td}>
                  <input
                    type="datetime-local"
                    className="border-input bg-background rounded-lg border px-2 py-1 text-xs"
                    value={edit[r.id] ?? utcToMytLocal(r.created_at)}
                    onChange={(e) => setEdit((s) => ({ ...s, [r.id]: e.target.value }))}
                  />
                </td>
                <td className={`${td} text-xs`}>
                  <span className="text-muted-foreground">{r.manual_by ? "manual" : r.amended_by ? "amended" : "punch"}</span>
                  {(() => {
                    const loc = attLoc(r);
                    if (!loc) return null;
                    const cls = loc.tone === "ok" ? "text-success" : loc.tone === "flag" ? "text-danger font-semibold" : "text-muted-foreground";
                    return <span className={`ml-1.5 whitespace-nowrap ${cls}`}>· {loc.text}</span>;
                  })()}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <button type="button" className={rowBtn}
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
  payee_user_id?: number | null;   // v1.4.173 — internal payment remark
  payee_name?: string | null;
  payee_full?: string | null;
  payee_role?: string | null;      // v1.4.175 — drives conflict-waived stages
  claimant_position?: string | null;
  claimant_department?: string | null;
  decided_by_name?: string | null;
  decided_by_full?: string | null; // v1.4.125: CEO's FULL name for the printed form
  pre_approved_by_full?: string | null; // v1.4.133: pre-approver identity for the middle cell
  pre_approved_by_role?: string | null;
  pre_approved_at?: string | null;
  decision_note?: string | null;
  decided_at?: string | null;
  items?: string | null; // v1.4.95: JSON [{claim_date, category, description, amount_cents}]
  paid_at?: string | null; // v1.4.101: CEO marked the claim as paid
  claimant_role?: string | null;        // v1.4.106 chain fields
  hr_reviewed_at?: string | null;
  hr_reviewed_by_name?: string | null;
  pre_approved_by_name?: string | null;
  day_seq?: number | null; // v1.4.118: running number within the creation day
  payment_proof_key?: string | null; // v1.4.118: CEO's payout proof (bank slip)
  created_at: string;
}

/* v1.4.118 (CEO's numbering): CLM-AZOO{DDMMYY}-{running no. that day},
   matching the {TYPE}-AZOO{DDMMYY}-{X} scheme used by QT/DO/INV. */
const claimNoOf = (c: Claim) => {
  const d = c.created_at.slice(0, 10);
  const ddmmyy = `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(2, 4)}`;
  return `CLM-AZOO${ddmmyy}-${c.day_seq ?? c.id}`;
};

/* v1.4.110: receipt size limit + the message staff see when a photo is too
   big. The WhatsApp trick is the easiest compressor everyone already has:
   send the photo to yourself (or any chat), save it back from the chat —
   WhatsApp compresses hard — then upload that copy. */
const MAX_RECEIPT_MB = 8;
const RECEIPT_TOO_BIG = `Receipt too large — the maximum is ${MAX_RECEIPT_MB} MB. Easy fix: send the photo to yourself on WhatsApp, save it from the chat back to your gallery (WhatsApp shrinks it a lot), then upload that copy.`;

/* v1.4.106: which chain a claimant's role follows (mirrors the leave chain). */
const claimChainOf = (role?: string | null): "staff" | "hr" | "exec" | "top" =>
  ["marketing", "sales_marketing", "editor", "live_host"].includes(role ?? "") ? "staff"
    : role === "hr_admin" ? "hr"
      : ["coo", "cco"].includes(role ?? "") ? "exec" : "top";

/** v1.4.92: printable Employee Claim Form — modelled on the CEO's
    AZOO-HR-CLM-001 template. HR prints the PDF, signatures are collected in
    wet ink; the SYSTEM approval (CEO decides in the Claims tab) remains the
    authoritative one, and its outcome is stamped on the form. */
/* v1.4.246: build the AZOO-HR-CLM-001 form as a real PDF and hand it to the
   share sheet — same three rungs as the sales documents (share the file,
   otherwise download it). */
async function sendClaimPdf(c: Claim) {
  const no = claimNoOf(c);
  const blob = await buildClaimPdf(c, no);
  await sharePdfFile(blob, `${no}.pdf`, `Claim form ${no}`);
}

async function printClaimForm(c: Claim) {
  const rmv = rmBare; // v1.4.272: global (bare number, caller places "RM")
  const claimNo = claimNoOf(c); // v1.4.118: CLM-AZOO{DDMMYY}-{n}
  // v1.4.137: one signature file per role — used for the EMPLOYEE cell too
  // when the claimant's role has an uploaded signature; script e-sig is the
  // fallback for roles without one.
  const SIG_FILE: Record<string, string> = {
    ceo: "ceo-sign.png", coo: "coo-sign.png", cco: "cco-sign.png",
    hr_admin: "hr-admin-sign.png", sales_marketing: "sales-marketing-sign.png",
  };
  const empSig = SIG_FILE[c.claimant_role ?? ""] ?? null;
  // v1.4.127: DB timestamps are UTC — every printed time must be Malaysia
  // time (+8), matching the system-wide MYT convention.
  const mytStamp = (iso: string | null | undefined): string => {
    if (!iso) return "";
    if (iso.length <= 10) return dmy(iso); // date-only: no shift needed
    const d = new Date(new Date(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z")).getTime() + 8 * 3600 * 1000);
    if (Number.isNaN(d.getTime())) return dmy(iso);
    const i = d.toISOString();
    return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)}`;
  };
  const chainLine = [
    c.hr_reviewed_by_name ? `HR reviewed by ${c.hr_reviewed_by_name}` : null,
    c.pre_approved_by_name ? `Pre-approved by ${c.pre_approved_by_name}` : null,
  ].filter(Boolean).join(" · ");
  // v1.4.102: the uploaded receipt prints ON the form (bottom right) when it
  // is an image — fetched as a blob so it is fully loaded before printing.
  // PDF receipts can't be inlined into the page; the form says so instead.
  // The window opens FIRST (inside the click) so popup blockers stay quiet.
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.write("<p style=\"font-family:Arial;padding:20px;color:#5b6472\">Preparing claim form…</p>");
  let receiptImg = "";
  let receiptNote = "";
  if (c.receipt_key) {
    try {
      const rr = await fetch(`/api/v1/staff/claims/${c.id}/receipt`, { credentials: "include" });
      const ct = rr.headers.get("content-type") ?? "";
      if (rr.ok && ct.startsWith("image/")) {
        const blobUrl = URL.createObjectURL(await rr.blob());
        receiptImg = `<div class="receiptbox"><p class="bt">RECEIPT (UPLOADED BY STAFF)</p><img src="${blobUrl}" alt="Receipt" /></div>`;
      } else if (rr.ok) {
        receiptNote = `<p class="tiny" style="text-align:right;margin-top:10px">Receipt attached as PDF in the system — printed separately.</p>`;
      }
    } catch { /* form still prints without the receipt */ }
  }
  const sysLine = c.status === "approved"
    ? `APPROVED IN SYSTEM${c.decided_by_name ? " by " + c.decided_by_name : ""}${c.decided_at ? " on " + mytStamp(c.decided_at) + " MYT" : ""}`
    : c.status === "rejected"
      ? `REJECTED IN SYSTEM${c.decided_by_name ? " by " + c.decided_by_name : ""}`
      : "PENDING SYSTEM APPROVAL";
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${claimNo} — Employee Claim Form</title>
  <style>
    /* v1.4.117: the whole form — receipt included — fits ONE A4 page. */
    @page { size: A4; margin: 0; } /* v1.4.239 — margin moved to @media print */
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a2946; font-size: 11.5px; margin: 0; padding: 10px; max-width: 210mm; margin-inline: auto;
           display: flex; flex-direction: column; min-height: 274mm; /* A4 297mm − 2×9mm page margin − rounding safety */ }
    h1 { text-align: center; margin: 2px 0 0; font-size: 18px; letter-spacing: .04em; }
    h1 small { display: block; font-size: 8px; letter-spacing: .32em; color: #C9A227; font-weight: 700; margin-top: 2px; }
    h2 { text-align: center; margin: 4px 0 9px; font-size: 13px; font-weight: 600; }
    .goldbar { height: 5px; background: linear-gradient(90deg, #C9A227, #E8CB6B, #C9A227); border-radius: 3px; margin-bottom: 7px; }
    table { width: 100%; border-collapse: collapse; }
    .meta td { border: 1px solid #1a2946; padding: 4px 8px; }
    .meta .k { width: 21%; font-weight: 700; background: #f2f4f8; }
    .meta .v { width: 29%; }
    .sect { margin: 8px 0 3px; font-weight: 700; }
    .det th { border: 1px solid #1a2946; background: #1a2946; color: #fff; padding: 5px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    .det td { border: 1px solid #1a2946; padding: 4px 8px; height: 18px; }
    .det td.r { text-align: right; font-variant-numeric: tabular-nums; }
    .total { margin-top: 7px; font-weight: 700; }
    .decl { margin-top: 8px; font-size: 10.5px; }
    .sys { margin-top: 6px; font-weight: 800; color: ${c.status === "approved" ? "#15803d" : c.status === "rejected" ? "#b91c1c" : "#b45309"}; }
    .sig td { border: 1px solid #1a2946; padding: 6px 8px; vertical-align: top; width: 33.33%; }
    .sig .hd2 { font-weight: 700; background: #f2f4f8; }
    .sig .body { height: 108px; vertical-align: top; } /* stays a TABLE CELL — flex lives on .cw inside */
    .sig .cw { display: flex; flex-direction: column; height: 100%; }
    .sig .nm { min-height: 26px; }        /* room for two-line names — same in every cell */
    .sig .sg { height: 52px; }            /* signature zone identical across cells */
    .sig .dt { margin-top: auto; }        /* Date pinned to the same baseline everywhere */
    .esig { font-family: "Brush Script MT", "Segoe Script", cursive; font-size: 15px; }
    .esub { display: block; font-size: 8px; color: #8a93a6; }
    /* v1.4.137: every printed signature occupies the SAME box regardless of
       the source image's dimensions — standardized like the CEO/COO look. */
    .sigimg { height: 46px; max-width: 150px; object-fit: contain; object-position: left center; display: block; margin-top: 1px; }
    .receiptwrap { display: flex; justify-content: flex-end; margin-top: 8px; page-break-inside: avoid; break-inside: avoid; }
    .receiptbox { border: 1px solid #1a2946; border-radius: 6px; padding: 6px 8px; max-width: 78mm; text-align: center; page-break-inside: avoid; break-inside: avoid; }
    .receiptbox .bt { margin: 0 0 4px; font-size: 8.5px; letter-spacing: .18em; color: #8a93a6; font-weight: 700; text-align: left; }
    .receiptbox img { max-width: 72mm; max-height: 58mm; object-fit: contain; display: block; margin: 0 auto; }
    .foot { margin-top: auto; padding-top: 6px; font-size: 8px; color: #8a93a6; text-align: center; page-break-inside: avoid; break-inside: avoid; }
    @media print { body { padding: 9mm; min-height: 296mm; } } /* v1.4.239 */
  </style></head><body onload="setTimeout(function(){window.print()}, 350)">
  <div class="goldbar"></div>
  <h1>AZ ONE OFFICIAL<small>LIVE &nbsp;·&nbsp; CONNECT &nbsp;·&nbsp; GROW</small></h1>
  <h2>Employee Claim Form</h2>
  <table class="meta">
    <tr><td class="k">Document No.</td><td class="v">AZOO-HR-CLM-001</td><td class="k">Version</td><td class="v">002</td></tr>
    <tr><td class="k">Claim No.</td><td class="v">${claimNo}</td><td class="k">Date</td><td class="v">${mytStamp(c.created_at)}${c.created_at && c.created_at.length > 10 ? " MYT" : ""}</td></tr>
    <tr><td class="k">Employee</td><td class="v">${(c.claimant_full || c.claimant || "").toUpperCase()}</td><td class="k">Department</td><td class="v">${(c.claimant_department ?? "").toUpperCase()}</td></tr>
    <tr><td class="k">Position</td><td class="v">${(c.claimant_position ?? "").toUpperCase()}</td><td class="k">Purpose</td><td class="v">${c.description ?? ""}</td></tr>
    <tr><td class="k">Receipt</td><td class="v" colspan="3">${c.receipt_key ? "☑ Yes (attached in system)" : "☐ Yes"} ${c.receipt_key ? "☐ No" : "☑ No"}</td></tr>
  </table>
  <p class="sect">Claim Details</p>
  <table class="det">
    <thead><tr><th style="width:18%">Date</th><th style="width:20%">Category</th><th>Description</th><th style="width:18%">Amount (RM)</th></tr></thead>
    <tbody>
      ${(() => {
        let its: { claim_date: string; category: string; description?: string; amount_cents: number }[] = [];
        try { its = c.items ? JSON.parse(c.items) : []; } catch { its = []; }
        if (its.length === 0) its = [{ claim_date: c.claim_date, category: c.category, description: c.description ?? "", amount_cents: c.amount_cents }];
        const rows = its.map((it) => `<tr><td>${dmy(it.claim_date)}</td><td style="text-transform:capitalize">${it.category}</td><td>${it.description ?? ""}</td><td class="r">${rmv(it.amount_cents)}</td></tr>`);
        while (rows.length < 4) rows.push("<tr><td></td><td></td><td></td><td></td></tr>");
        return rows.join("");
      })()}
    </tbody>
  </table>
  <p class="total">Total Claimed: RM ${rmv(c.amount_cents)}</p>
  <p class="decl">Declaration: I certify the above expenses were incurred for official Company business.</p>
  <p class="sys">System status: ${sysLine}${c.decision_note ? " · Note: " + c.decision_note : ""}${chainLine ? " · " + chainLine : ""}</p>
  <table class="sig" style="margin-top:10px">
    <tr>
      <td class="hd2">Employee</td>
      <td class="hd2">Administrative or<br/>Head of Department (COO / CCO)</td>
      <td class="hd2">Chief Executive Officer (CEO)</td>
    </tr>
    <tr>
      <td class="body"><div class="cw"><div class="nm">Name: ${(c.claimant_full || c.claimant || "")}</div>
        <div class="sg">Signature:${empSig
          ? `<img class="sigimg" src="/signatures/${empSig}" alt="" onerror="this.style.display='none'"/><span class="esub">(submitted in system)</span>`
          : ` <span class="esig">${(c.claimant_full || c.claimant || "")}</span><span class="esub">(submitted in system)</span>`}</div>
        <div class="dt">Date: ${mytStamp(c.created_at)}${c.created_at && c.created_at.length > 10 ? " MYT" : ""}</div></div></td>
      <td class="body"><div class="cw">${c.pre_approved_by_full || c.pre_approved_by_name
        ? `<div class="nm">Name: ${(c.pre_approved_by_full || c.pre_approved_by_name || "").toUpperCase()}</div>
           <div class="sg">Signature:<img class="sigimg" src="/signatures/${c.pre_approved_by_role === "coo" ? "coo" : "cco"}-sign.png" alt="" onerror="this.style.display='none'"/></div>
           <div class="dt">Date: ${c.pre_approved_at ? mytStamp(c.pre_approved_at) + " MYT" : ""}</div>`
        : `<div class="nm">Name:</div><div class="sg">Signature:</div><div class="dt">Date:</div>`}</div></td>
      <td class="body"><div class="cw"><div class="nm">Name: ${(c.decided_by_full || c.decided_by_name || "").toUpperCase()}</div>
        <div class="sg">Signature:${c.status === "approved" ? `<img class="sigimg" src="/signatures/ceo-sign.png" alt="" onerror="this.style.display='none'"/>` : ""}</div>
        <div class="dt">Date: ${c.status === "approved" && c.decided_at ? mytStamp(c.decided_at) + " MYT" : ""}</div></div></td>
    </tr>
  </table>
  ${receiptImg ? `<div class="receiptwrap">${receiptImg}</div>` : receiptNote}
  <p class="foot">AZ ONE OFFICIAL · SSM 202603168673 (JM1046169-H) · 34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor · This form accompanies the system record ${claimNo}; the in-system decision is authoritative.</p>
  </body></html>`);
  w.document.close();
}

const CLAIM_CATEGORIES = ["travel", "meal", "client meeting", "stationery", "accommodation", "equipment", "medical", "other"] as const;

/** Expense claims — CEO, COO, CCO and HR submit; per the CEO's instruction
    EVERY decision is made by the CEO. Claimants attach a receipt (image/PDF);
    the CEO sees a pending queue with Approve / Reject and an optional note.
    Both sides are bell-notified. */
export function ClaimsPanel({ userId = 0, role = "" }: { userId?: number; role?: string }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [msg, setMsg] = useState("");
  // v1.4.95: one claim form, several expense lines — like the paper form.
  const emptyItem = { claim_date: "", category: "travel", description: "", amount: "" };
  const [purpose, setPurpose] = useState("");
  const [items, setItems] = useState([{ ...emptyItem }]);
  // v1.4.95: minimalist list — rows collapsed, Details ▾ per claim.
  const [expanded, setExpanded] = useState<number | null>(null);
  // v1.4.104: edit-before-approval / resubmit-after-rejection.
  const [editingClaim, setEditingClaim] = useState<{ id: number; no: string; wasRejected: boolean } | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const { show: showToast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm(); // v1.4.142: branded dialog
  /* v1.4.173 (CEO): the PAYEE remark — when HR raises a claim on behalf of
     a staff member, pick who the payment actually goes to. Internal only:
     CEO/admin tier pay by it, hr_admin keeps it for records; it is NEVER
     printed on the claim form and other roles never receive the field. */
  const canPayee = ["hr_admin", "ceo", "super_admin", "admin"].includes(role);
  const [payeeId, setPayeeId] = useState(0);
  const [staffOptions, setStaffOptions] = useState<{ id: number; name: string; full_name?: string | null; role: string }[]>([]);
  // v1.4.176: inline payee editor on an existing claim (set/change/clear).
  const [payeeEdit, setPayeeEdit] = useState<{ claimId: number; value: number } | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ claims: Claim[]; can_decide: boolean }>(`/claims`);
    if (res.ok && res.data) { setClaims(res.data.claims); setCanDecide(res.data.can_decide); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canPayee) return;
    void api<{ users: { id: number; name: string; full_name?: string | null; role: string; is_active?: number }[] }>(`/users`).then((r) => {
      if (r.ok && r.data?.users) {
        setStaffOptions(r.data.users.filter((u) => u.role !== "customer" && !["super_admin", "admin"].includes(u.role) && u.is_active !== 0));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPayee]);

  const rmc = (c: number) => `RM ${rmBare(c)}`;

  const submit = async () => {
    const filled = items.filter((i) => i.claim_date || Number(i.amount) || i.description.trim());
    if (filled.length === 0) { setMsg("Add at least one item (date + amount)."); return; }
    if (filled.some((i) => !i.claim_date || !Number(i.amount))) { setMsg("Every item needs a date and an amount."); return; }
    setMsg("");
    const payloadC = {
      purpose: purpose || undefined,
      items: filled.map((i) => ({ claim_date: i.claim_date, category: i.category, description: i.description || undefined, amount: Number(i.amount) })),
      // v1.4.173: 0 on edit explicitly clears the remark; undefined on create = none
      ...(canPayee ? { payee_user_id: editingClaim ? payeeId : (payeeId > 0 ? payeeId : undefined) } : {}),
    };
    if (editingClaim) {
      const resE = await api<{ ok?: boolean; resubmitted?: boolean; error?: { message?: string } }>(`/claims/${editingClaim.id}/edit`, {
        method: "POST", body: JSON.stringify(payloadC),
      });
      if (!resE.ok) { setMsg(resE.data?.error?.message ?? "Could not update the claim"); return; }
      if (receipt) {
        const compressedE = await compressImage(receipt);
        if (compressedE.size > MAX_RECEIPT_MB * 1024 * 1024) {
          showToast("No changes", `Claim updated WITHOUT the receipt. ${RECEIPT_TOO_BIG}`, "notice");
        } else {
          const up = await fetch(`/api/v1/staff/claims/${editingClaim.id}/receipt`, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": compressedE.type || receipt.type || "image/jpeg" },
            body: compressedE,
          });
          if (!up.ok) showToast("No changes", `Claim updated, but the receipt failed to upload. ${RECEIPT_TOO_BIG}`, "notice");
        }
      }
      showToast("Saved", resE.data?.resubmitted ? "Claim resubmitted — CEO notified for approval" : "Claim updated — still awaiting CEO approval");
      setPurpose(""); setItems([{ ...emptyItem }]); setReceipt(null); setEditingClaim(null); setPayeeId(0);
      void load();
      return;
    }
    const res = await api<{ id?: number; error?: { message?: string } }>(`/claims`, {
      method: "POST",
      body: JSON.stringify(payloadC),
    });
    if (!res.ok || !res.data?.id) { setMsg(res.data?.error?.message ?? "Could not submit the claim"); return; }
    if (receipt) {
      const compressed = await compressImage(receipt); // PDFs pass through untouched
      if (compressed.size > MAX_RECEIPT_MB * 1024 * 1024) {
        showToast("No changes", `Claim submitted WITHOUT the receipt. ${RECEIPT_TOO_BIG} Then use Edit on your claim to attach it.`, "notice");
      } else {
      const up = await fetch(`/api/v1/staff/claims/${res.data.id}/receipt`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": compressed.type || receipt.type || "image/jpeg" },
        body: compressed,
      });
      if (!up.ok) showToast("No changes", `Claim submitted, but the receipt failed to upload. ${RECEIPT_TOO_BIG} Then use Edit on your claim to attach it.`, "notice");
      }
    }
    setPurpose(""); setItems([{ ...emptyItem }]); setPayeeId(0);
    setReceipt(null);
    showToast("Saved", "Claim submitted — the CEO has been notified");
    void load();
  };

  const decide = async (id: number, action: "approve" | "reject") => {
    // v1.4.107: the CEO can approve past an incomplete chain — but only after
    // confirming, and the bypass is recorded on the claim + audit log.
    if (action === "approve") {
      const cl = claims.find((x) => x.id === id);
      const ch = claimChainOf(cl?.claimant_role);
      /* v1.4.175: a missing stage whose approver IS the payee is WAIVED by
         design (they are forbidden from acting) — that is the normal route
         to the CEO, so no scary bypass dialog. Only genuinely skipped
         stages still get the override confirm. */
      const pr = cl?.payee_role ?? null;
      const missingSkipped: string[] = [];
      let anyWaived = false;
      if (cl && cl.status === "pending") {
        if (ch === "staff") {
          if (!cl.hr_reviewed_at) { if (pr === "hr_admin") anyWaived = true; else missingSkipped.push("HR review"); }
          if (!cl.pre_approved_at) { if (pr === "coo") anyWaived = true; else missingSkipped.push("COO pre-approval"); }
        } else if (ch === "hr" && !cl.pre_approved_at) {
          if (pr === "cco") anyWaived = true; else missingSkipped.push("CCO pre-approval");
        }
      }
      if (missingSkipped.length > 0) {
        if (!(await confirm({
          title: "Approve past the incomplete chain?",
          message: "The approval chain has not finished for this claim.\nThe bypass will be recorded on the claim and in the audit log.",
          confirmLabel: "Approve as CEO",
        }))) return;
      } else if (anyWaived) {
        if (!(await confirm({
          title: "Approve directly?",
          message: "The pre-approver of this claim is its PAYEE, so their stage is waived (conflict of interest) — your direct decision is the designed route.\nThe waiver is recorded on the claim and in the audit log.",
          confirmLabel: "Approve as CEO",
        }))) return;
      }
    }
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/claims/${id}/decide`, { method: "POST", body: JSON.stringify({ action, note: note[id] || undefined }) });
    if (!res.ok) { showToast("No changes", res.data?.error?.message ?? "Decision failed", "notice"); return; }
    showToast("Saved", `Claim ${action === "approve" ? "approved" : "rejected"} — claimant notified`);
    void load();
  };
  // v1.4.106: chain stage actions.
  const hrReview = async (id: number) => {
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/claims/${id}/review`, { method: "POST", body: JSON.stringify({}) });
    if (!res.ok) { showToast("No changes", res.data?.error?.message ?? "Review failed", "notice"); return; }
    showToast("Saved", "HR review recorded — COO notified for pre-approval");
    void load();
  };
  const preApprove = async (id: number) => {
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/claims/${id}/preapprove`, { method: "POST", body: JSON.stringify({}) });
    if (!res.ok) { showToast("No changes", res.data?.error?.message ?? "Pre-approval failed", "notice"); return; }
    showToast("Saved", "Pre-approved — CEO notified for final approval");
    void load();
  };

  const badgeCls: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };
  const pending = claims.filter((c) => c.status === "pending");
  const decided = claims.filter((c) => c.status !== "pending");
  // v1.4.121: HR's read-only APPROVED history (incl. paid) for printing the
  // claim form + payout proof for compilation. Their main list stays personal.
  const hrHistory = role === "hr_admin" ? claims.filter((c) => c.status === "approved") : [];
  const mainList = role === "hr_admin" ? claims.filter((c) => c.user_id === userId || c.status !== "approved") : claims;

  const claimItems = (c: Claim): { claim_date: string; category: string; description?: string; amount_cents: number }[] => {
    try {
      const its = c.items ? JSON.parse(c.items) : [];
      if (Array.isArray(its) && its.length > 0) return its;
    } catch { /* fall through */ }
    return [{ claim_date: c.claim_date, category: c.category, description: c.description ?? "", amount_cents: c.amount_cents }];
  };

  // v1.4.95: minimalist rows — one line collapsed; Details ▾ opens items,
  // receipt, print form and the decision trail.
  const claimRow = (c: Claim, actions: boolean) => (
    <div key={c.id} className="border-border rounded-lg border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {/* v1.4.249 (CEO: "globally and standardize"): the claim number is
              the identifier and the only thing you click to open the record —
              same affordance as a document number or a company name. */}
          <RecordToggle open={expanded === c.id} title="Purpose, items, receipt and decision"
            onToggle={() => setExpanded((e) => e === c.id ? null : c.id)}>{claimNoOf(c)}</RecordToggle>{" · "}
          {c.claimant && <span className="font-medium">{properName(c.claimant)} · </span>}
          <span className="font-semibold">{rmc(c.amount_cents)}</span>{" "}
          {claimItems(c).length > 1
            ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{claimItems(c).length} items</span>
            : <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{c.category}</span>}{" "}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeCls[c.status] ?? "bg-secondary"}`}>{c.status}</span>
          {c.status === "pending" && claimChainOf(c.claimant_role) === "staff" && (
            <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800"
              title="Chain: HR review → COO pre-approval → CEO final approval">
              {c.pre_approved_at ? "HR ✓ · COO ✓ — CEO next" : c.hr_reviewed_at ? "HR ✓ — awaiting COO" : "awaiting HR review"}
            </span>
          )}
          {c.status === "pending" && claimChainOf(c.claimant_role) === "hr" && (
            <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800"
              title="Chain: CCO pre-approval → CEO final approval">
              {c.pre_approved_at ? "CCO ✓ — CEO next" : "awaiting CCO"}
            </span>
          )}
          {(c as Claim & { paid_at?: string | null }).paid_at && (
            <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700"
              title="Payment released by the CEO">💸 PAID {dmy((c as Claim & { paid_at?: string | null }).paid_at!.slice(0, 10))}</span>
          )}
        </p>
        {/* v1.4.253: date on the left, real buttons in the standard wrapping
            group — no more underlined words strung together with dots. */}
        <div className={`${rowActions} text-muted-foreground mt-1.5 justify-start text-xs`}>
          <span>{dmy(c.claim_date)}</span>
          {c.user_id === userId && ["pending", "rejected"].includes(c.status) && !c.receipt_key && (
            <>
              <label className={`${rowBtn} cursor-pointer`} title="Attach the receipt photo/PDF directly — no need to edit the claim">
                📎 Attach receipt
                <input type="file" accept="image/*,application/pdf" className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    if (f.type === "application/pdf" && f.size > MAX_RECEIPT_MB * 1024 * 1024) { showToast("No changes", RECEIPT_TOO_BIG, "notice"); return; }
                    if (f.size > 40 * 1024 * 1024) { showToast("No changes", RECEIPT_TOO_BIG, "notice"); return; }
                    const comp = await compressImage(f);
                    if (comp.size > MAX_RECEIPT_MB * 1024 * 1024) { showToast("No changes", RECEIPT_TOO_BIG, "notice"); return; }
                    const up = await fetch(`/api/v1/staff/claims/${c.id}/receipt`, {
                      method: "POST", credentials: "include",
                      headers: { "Content-Type": comp.type || f.type || "image/jpeg" }, body: comp,
                    });
                    if (up.ok) {
                      let resub = false;
                      try { resub = Boolean(((await up.json()) as { resubmitted?: boolean })?.resubmitted); } catch { /* body optional */ }
                      showToast("Saved", resub ? "Receipt attached — claim RESUBMITTED for approval" : "Receipt attached to your claim");
                      void load();
                    }
                    else {
                      let m = "";
                      try { m = ((await up.json()) as { error?: { message?: string } })?.error?.message ?? ""; } catch { /* not JSON */ }
                      showToast("No changes", m || RECEIPT_TOO_BIG, "notice");
                    }
                  }} />
              </label>
            </>
          )}
          {c.user_id === userId && ["pending", "rejected"].includes(c.status) && (
            <>
              <button type="button" className={rowBtnDanger} title="Delete this claim — allowed while pending or rejected; approved/paid claims are permanent records"
                onClick={async () => {
                  if (!(await confirm({
                    title: `Delete claim ${claimNoOf(c)}?`,
                    message: `RM ${rmBare(c.amount_cents)} — this cannot be undone. The attached receipt is removed too.`,
                    confirmLabel: "Delete claim", variant: "danger",
                  }))) return;
                  const r = await api<{ error?: { message?: string } }>(`/claims/${c.id}/delete`, { method: "POST", body: JSON.stringify({}) });
                  if (r.ok) { showToast("Saved", `Claim ${claimNoOf(c)} deleted`); void load(); }
                  else showToast("No changes", r.data?.error?.message ?? "Delete failed", "notice");
                }}>
                Delete
              </button>
              <button type="button" className={rowBtn} title={c.status === "rejected" ? "Fix and resubmit for CEO approval" : "Edit — allowed until the CEO decides"}
                onClick={() => {
                  setEditingClaim({ id: c.id, no: claimNoOf(c), wasRejected: c.status === "rejected" });
                  setPayeeId(c.payee_user_id ?? 0); // v1.4.173
                  setPurpose(c.description ?? "");
                  setItems(claimItems(c).map((it) => ({ claim_date: it.claim_date, category: it.category, description: it.description ?? "", amount: (it.amount_cents / 100).toString() })));
                  setReceipt(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}>
                {c.status === "rejected" ? "Edit & resubmit" : "Edit"}
              </button>
            </>
          )}
          {/* the payee mark stays visible without opening the record */}
          {c.payee_user_id === userId
            ? <span className="rounded-full bg-green-100 px-1.5 py-px text-[10px] font-medium text-green-800" title="This claim was raised on your behalf — the payment comes to you; track its status here">💰 pays to you</span>
            : c.payee_name ? <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800" title={`Pay to ${properName(c.payee_full || c.payee_name)} — internal remark`}>💰 → {firstName(c.payee_name)}</span> : null}
        </div>
      </div>
      {expanded === c.id && (
        <>
          {/* v1.4.173/174: internal payment remark — the server sends the
              field to the CEO/admin tier + hr_admin, AND to the payee on
              their own rows; never on the printed form.
              v1.4.176 (CEO: "I want to know who is the payees and to insert
              the payees"): the question is ALWAYS answered for CEO/HR — no
              payee set = pay the submitter, said explicitly — and ✎ lets
              them set/change it on any claim, incl. pre-payee approved ones. */}
          {canPayee && payeeEdit?.claimId === c.id ? (
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <select className="border-input bg-background h-8 rounded-lg border px-2 text-xs" value={payeeEdit.value}
                onChange={(e) => setPayeeEdit({ claimId: c.id, value: Number(e.target.value) })}>
                <option value={0}>— pay the submitter ({properName(c.claimant_full || c.claimant || "")}) —</option>
                {staffOptions.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)} · {u.role.replace(/_/g, " ")}</option>)}
              </select>
              <button type="button" className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
                onClick={async () => {
                  const res = await api<{ ok?: boolean; unchanged?: boolean; error?: { message?: string } }>(`/claims/${c.id}/payee`, {
                    method: "POST", body: JSON.stringify({ payee_user_id: payeeEdit.value }),
                  });
                  if (!res.ok) { showToast("No changes", res.data?.error?.message ?? "Could not save the payee", "notice"); return; }
                  showToast(res.data?.unchanged ? "No changes" : "Saved", res.data?.unchanged ? "Payee is already set to that" : "Payee updated — recorded in the audit log");
                  setPayeeEdit(null);
                  void load();
                }}>Save payee</button>
              <button type="button" className="text-xs underline" onClick={() => setPayeeEdit(null)}>cancel</button>
            </span>
          ) : c.payee_user_id === userId ? (
            <p className="mt-1 rounded-lg border border-green-300 bg-green-100 px-2 py-1 text-xs font-semibold text-green-900">
              💰 This claim was raised on your behalf by {properName(c.claimant_full || c.claimant || "")} — the payment comes to YOU once the CEO approves. Follow the status chip above.
              {canPayee && <button type="button" className="ml-1.5 underline" onClick={() => setPayeeEdit({ claimId: c.id, value: c.payee_user_id ?? 0 })}>✎ change</button>}
            </p>
          ) : c.payee_name ? (
            <p className="mt-1 rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900"
              title="Internal remark for the CEO (payment) and HR (records) — not printed on the claim form">
              💰 Pay this claim to: {properName(c.payee_full || c.payee_name)}
              {canPayee && <button type="button" className="ml-1.5 underline" onClick={() => setPayeeEdit({ claimId: c.id, value: c.payee_user_id ?? 0 })}>✎ change</button>}
            </p>
          ) : canPayee && (
            <p className="mt-1 rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900"
              title="No separate payee set — the payment goes to whoever submitted the claim">
              💰 Pay to: {properName(c.claimant_full || c.claimant || "")} (the submitter — no separate payee)
              <button type="button" className="ml-1.5 underline" onClick={() => setPayeeEdit({ claimId: c.id, value: 0 })}>✎ set payee</button>
            </p>
          )}
          {c.description && <p className="text-muted-foreground mt-1 text-xs">Purpose: {c.description}</p>}
          <div className="mt-1 space-y-0.5">
            {claimItems(c).map((it, i) => (
              <p key={i} className="text-muted-foreground text-xs">
                {dmy(it.claim_date)} · <span className="capitalize">{it.category}</span>
                {it.description ? ` · ${it.description}` : ""} · {rmc(it.amount_cents)}
              </p>
            ))}
          </div>
          {/* v1.4.253 (CEO: "Claim also need to use global button but ensure
              that minimalist"): the record's actions are real buttons in the
              standard row group, not a run-on sentence of underlined words —
              an underlined word has no tap target on a phone. */}
          <div className={`${rowActions} mt-1.5 justify-start`}>
            {c.receipt_key
              ? <a className={rowBtn} href={`/api/v1/staff/claims/${c.id}/receipt`} target="_blank" rel="noreferrer">View receipt</a>
              : <span className="text-muted-foreground text-xs">No receipt attached</span>}
            <button type="button" className={rowBtn} title="AZOO-HR-CLM-001 form as PDF — HR prints it, signatures are collected in ink; the system decision stays authoritative"
              onClick={() => void printClaimForm(c)}>Print form</button>
            {/* v1.4.246: the real PDF file, straight into the phone's share sheet. */}
            <button type="button" className={rowBtn} title="Send the claim form as a PDF file"
              onClick={() => void sendClaimPdf(c)}>Send PDF</button>
          </div>
          {c.decided_by_name && (
            <p className="text-muted-foreground mt-1 text-xs">
              Decided by {properName(c.decided_by_name)}{c.decision_note ? ` — ${c.decision_note}` : ""}
            </p>
          )}
          {canDecide && c.paid_at && !c.payment_proof_key && (
            <label className="border-border mt-2 inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
              title="Attach the bank-transfer slip as payout proof — the claimant is notified">
              📎 Attach payment receipt (bank slip)
              <input type="file" accept="image/*,application/pdf" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (f.size > 40 * 1024 * 1024) { showToast("No changes", "Payment proof too large — maximum 8 MB.", "notice"); return; }
                  const comp = await compressImage(f);
                  if (comp.size > 8 * 1024 * 1024) { showToast("No changes", "Payment proof too large — maximum 8 MB.", "notice"); return; }
                  const up = await fetch(`/api/v1/staff/claims/${c.id}/payment-proof`, {
                    method: "POST", credentials: "include",
                    headers: { "Content-Type": comp.type || f.type || "image/jpeg" }, body: comp,
                  });
                  if (up.ok) { showToast("Saved", "Payment receipt attached — claimant notified"); void load(); }
                  else showToast("No changes", "Payment proof upload failed", "notice");
                }} />
            </label>
          )}
          {c.payment_proof_key && (c.user_id === userId || canDecide || role === "hr_admin") && (
            <p className="mt-1 text-xs">
              <a className="underline" href={`/api/v1/staff/claims/${c.id}/payment-proof`} target="_blank" rel="noreferrer">View payment receipt (payout proof)</a>
            </p>
          )}
          {canDecide && c.status === "approved" && !c.paid_at && (
            <button type="button" className="bg-primary text-primary-foreground mt-2 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
              onClick={async () => {
                const res = await api(`/claims/${c.id}/paid`, { method: "POST", body: JSON.stringify({}) });
                if (res.ok) { showToast("Saved", "Claim marked PAID — claimant notified"); void load(); }
              }}>
              💸 Mark paid (money released)
            </button>
          )}
        </>
      )}
      {actions && canDecide && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className="border-input bg-background h-8 flex-1 rounded-lg border px-2 text-xs" placeholder="Note (optional — sent to the claimant)"
            value={note[c.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [c.id]: e.target.value }))} />
          <button type="button" className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
            title={claimChainOf(c.claimant_role) === "staff" && !c.pre_approved_at ? "Chain (HR → COO) not finished — approving now is a recorded CEO override" : claimChainOf(c.claimant_role) === "hr" && !c.pre_approved_at ? "CCO pre-approval not done — approving now is a recorded CEO override" : "Final approval"}
            onClick={() => void decide(c.id, "approve")}>Approve</button>
          <button type="button" className="border-border text-destructive inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            onClick={() => void decide(c.id, "reject")}>Reject</button>
        </div>
      )}
      {/* v1.4.106 stage actions — HR review, COO/CCO pre-approval. No self-review.
          v1.4.175: no self-approval for the PAYEE either — instead of a dead
          button that the server would refuse, the payee-reviewer sees why the
          claim skips them. */}
      {c.status === "pending" && c.user_id !== userId && c.payee_user_id === userId && ["hr_admin", "coo", "cco"].includes(role) && (
        <p className="text-muted-foreground mt-2 text-xs">
          ⚖ Your stage is waived on this claim — it pays to you, so the CEO decides it directly.
        </p>
      )}
      {c.status === "pending" && c.user_id !== userId && c.payee_user_id !== userId && (
        <>
          {["hr_admin", "admin", "super_admin"].includes(role) && claimChainOf(c.claimant_role) === "staff" && !c.hr_reviewed_at && (
            <button type="button" className="bg-primary text-primary-foreground mt-2 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
              onClick={() => void hrReview(c.id)}>✔ HR review OK — pass to COO</button>
          )}
          {(role === "coo" || ["admin", "super_admin"].includes(role)) && claimChainOf(c.claimant_role) === "staff" && c.hr_reviewed_at && !c.pre_approved_at && (
            <button type="button" className="bg-primary text-primary-foreground mt-2 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
              onClick={() => void preApprove(c.id)}>✔ Pre-approve — pass to CEO</button>
          )}
          {(role === "cco" || ["admin", "super_admin"].includes(role)) && claimChainOf(c.claimant_role) === "hr" && !c.pre_approved_at && (
            <button type="button" className="bg-primary text-primary-foreground mt-2 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
              onClick={() => void preApprove(c.id)}>✔ Pre-approve — pass to CEO</button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}
      {confirmNode}
      <div className={card}>
        <p className="text-sm font-semibold">
          {editingClaim
            ? <>Editing {editingClaim.no}{editingClaim.wasRejected ? " (rejected — will resubmit)" : ""} <button type="button" className="ml-1 text-xs font-normal underline" onClick={() => { setEditingClaim(null); setPurpose(""); setItems([{ ...emptyItem }]); setReceipt(null); setPayeeId(0); }}>cancel</button></>
            : "Submit a claim"}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Expense claims from CEO, COO, CCO and HR — every claim is approved or
          rejected by the CEO, who is notified the moment you submit.
        </p>
        <label className="mt-3 block"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Purpose (shown on the printed form, optional)</span>
        <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" placeholder="e.g. Office pantry restock"
          value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label>
        {/* v1.4.173 (CEO): who the payment actually goes to when this claim
            is raised on behalf of someone. Internal remark — CEO pays by it,
            HR keeps it for records; NEVER printed on the claim form. */}
        {canPayee && (
          <label className="mt-2 block sm:max-w-md">
            <span className="text-muted-foreground mb-0.5 block text-[11px]">💰 Pay claim to (optional — only when raised on behalf of someone; remark for CEO &amp; HR, not printed on the form)</span>
            <select className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" value={payeeId}
              onChange={(e) => setPayeeId(Number(e.target.value))}>
              <option value={0}>— pay the submitter (normal claim) —</option>
              {staffOptions.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)} · {u.role.replace(/_/g, " ")}</option>)}
            </select>
          </label>
        )}
        <div className="text-muted-foreground mt-2 hidden gap-2 text-xs sm:grid sm:grid-cols-[8.5rem_7rem_1fr_6.5rem_auto]">
          <span>Date</span><span>Category</span><span>Description</span><span>Amount (RM)</span><span />
        </div>
        {items.map((it, i) => (
          <div key={i} className="border-border mt-2 grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:mt-1 sm:grid-cols-[8.5rem_7rem_1fr_6.5rem_auto] sm:rounded-none sm:border-0 sm:p-0">
            <label className="text-muted-foreground block text-[11px] sm:hidden">Date
              <input type="date" className="border-input bg-background mt-0.5 h-9 w-full rounded-lg border px-2 text-sm"
                value={it.claim_date} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, claim_date: e.target.value } : x))} />
            </label>
            <input type="date" className="border-input bg-background hidden h-9 rounded-lg border px-2 text-sm sm:block"
              value={it.claim_date} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, claim_date: e.target.value } : x))} />
            <label className="text-muted-foreground block text-[11px] sm:hidden">Category
              <select className="border-input bg-background mt-0.5 h-9 w-full rounded-lg border px-2 text-sm capitalize" value={it.category}
                onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, category: e.target.value } : x))}>
                {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <select className="border-input bg-background hidden h-9 rounded-lg border px-2 text-sm capitalize sm:block" value={it.category}
              onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, category: e.target.value } : x))}>
              {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="text-muted-foreground col-span-2 block text-[11px] sm:hidden">Description
              <input className="border-input bg-background mt-0.5 h-9 w-full min-w-0 rounded-lg border px-2 text-sm" placeholder="e.g. Grab to client meeting"
                value={it.description} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x))} />
            </label>
            <input className="border-input bg-background hidden h-9 min-w-0 rounded-lg border px-2 text-sm sm:block" placeholder="e.g. Grab to client meeting"
              value={it.description} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x))} />
            <label className="text-muted-foreground block text-[11px] sm:hidden">Amount (RM)
              <input type="number" min={0} step="0.01" className="border-input bg-background mt-0.5 h-9 w-full rounded-lg border px-2 text-sm" placeholder="0.00"
                value={it.amount} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))} />
            </label>
            <input type="number" min={0} step="0.01" className="border-input bg-background hidden h-9 rounded-lg border px-2 text-sm sm:block" placeholder="0.00"
              value={it.amount} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))} />
            {items.length > 1
              ? <button type="button" className="text-destructive justify-self-end text-xs underline sm:justify-self-auto" onClick={() => setItems((a) => a.filter((_, xi) => xi !== i))}>✕ Remove</button>
              : <span className="hidden sm:block" />}
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="text-xs underline" onClick={() => setItems((a) => [...a, { ...emptyItem }])}>+ Add item</button>
          <p className="text-sm font-semibold">
            Total: RM {rmBare(Math.round(items.reduce((a, i) => a + (Number(i.amount) || 0), 0) * 100))}
          </p>
        </div>
        <div className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="border-border inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm hover:bg-secondary sm:justify-start">
            {receipt ? `Receipt: ${receipt.name}` : "Attach receipt (image/PDF)"}
            <input type="file" accept="image/*,application/pdf" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                // v1.4.110: PDFs can't be compressed client-side — hard limit
                // now. Oversized photos get a chance: compression runs on
                // submit, and only if still too big is the upload refused.
                if (f && f.type === "application/pdf" && f.size > MAX_RECEIPT_MB * 1024 * 1024) {
                  showToast("No changes", RECEIPT_TOO_BIG, "notice");
                  e.target.value = "";
                  setReceipt(null);
                  return;
                }
                if (f && f.size > 40 * 1024 * 1024) {
                  showToast("No changes", RECEIPT_TOO_BIG, "notice");
                  e.target.value = "";
                  setReceipt(null);
                  return;
                }
                setReceipt(f);
              }} />
          </label>
          <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium sm:justify-start"
            onClick={() => void submit()}>{editingClaim ? (editingClaim.wasRejected ? "Resubmit for approval" : "Update claim") : "Submit claim"}</button>
        </div>
        {msg && <p className="mt-2 text-xs font-medium text-amber-700">{msg}</p>}
      </div>

      {(canDecide || ["hr_admin", "coo", "cco", "admin", "super_admin"].includes(role)) && (
        <div className={card}>
          <p className="text-sm font-semibold">
            Pending approvals
            {pending.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{pending.length}</span>
            )}
          </p>
          <div className="mt-3 space-y-2">
            {pending.filter((c) => canDecide || c.user_id !== userId).length === 0 && <p className="text-muted-foreground text-sm">Nothing awaiting your action.</p>}
            {pending.filter((c) => canDecide || c.user_id !== userId).map((c) => claimRow(c, true))}
          </div>
        </div>
      )}

      <div className={card}>
        <p className="text-sm font-semibold">{canDecide ? "All claims" : "My claims"}</p>
        {(() => {
          // v1.4.147: overall of the present month, by CLAIM DATE (the same
          // month-attribution rule the Expenses tab uses).
          const nowMyt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
          const scope = canDecide ? claims : claims.filter((c) => c.user_id === userId);
          const mine = scope.filter((c) => (c.claim_date ?? "").slice(0, 7) === nowMyt);
          if (mine.length === 0) return null;
          const sum = (list: typeof mine) => list.reduce((a, c) => a + c.amount_cents, 0);
          const fmt = fmtRM; // v1.4.272: global
          const approved = mine.filter((c) => c.status === "approved");
          const paid = approved.filter((c) => c.paid_at);
          const pending = mine.filter((c) => c.status === "pending");
          const rejected = mine.filter((c) => c.status === "rejected");
          return (
            <div className="border-border bg-secondary/40 mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs">
              <span className="font-semibold">{dmy(nowMyt)} · {mine.length} claim{mine.length === 1 ? "" : "s"} · {fmt(sum(mine))}</span>
              <span className="text-green-800">Approved {approved.length} · {fmt(sum(approved))}</span>
              <span className="text-green-800">— of which paid {paid.length} · {fmt(sum(paid))}</span>
              <span className="text-amber-700">Pending {pending.length} · {fmt(sum(pending))}</span>
              {rejected.length > 0 && <span className="text-red-700">Rejected {rejected.length} · {fmt(sum(rejected))}</span>}
              <span className="text-muted-foreground">by claim date — matches the Expenses month figure</span>
            </div>
          );
        })()}
        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
          {(canDecide ? decided : mainList).length === 0 && <p className="text-muted-foreground text-sm">No claims yet.</p>}
          {(canDecide ? decided : mainList).map((c) => claimRow(c, false))}
        </div>
      </div>

      {role === "hr_admin" && (
        <div className={card}>
          <p className="text-sm font-semibold">Approved claims history — compilation</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Read-only: every CEO-approved claim, for printing the claim form and
            the payment receipt (payout proof) for HR records.
          </p>
          <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
            {hrHistory.length === 0 && <p className="text-muted-foreground text-sm">No approved claims yet.</p>}
            {hrHistory.map((c) => (
              <div key={`hrh-${c.id}`} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{claimNoOf(c)}</span>
                  <span className="text-muted-foreground"> · {properName(c.claimant_full || c.claimant || "")} · {rmc(c.amount_cents)}</span>
                  {c.paid_at
                    ? <span className="ml-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">PAID {dmy(c.paid_at)}</span>
                    : <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">payment due</span>}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2 text-xs">
                  <button type="button" className={rowBtn} onClick={() => void printClaimForm(c)}>Print form</button>
                  <button type="button" className={rowBtn} onClick={() => void sendClaimPdf(c)}>Send PDF</button>
                  {c.payment_proof_key && <a className={rowBtn} href={`/api/v1/staff/claims/${c.id}/payment-proof`} target="_blank" rel="noreferrer">Payment proof</a>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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

/* v1.4.227 (CEO: "pie chart for the expenses category for me to monitor on
   each month… include the marketing expenses"): pure-SVG donut — the
   system has no chart library by design. Slices = this month's expense
   ROWS by category (payroll and claims have their own lines above and
   would drown the categories). Marketing already existed in the category
   list end-to-end; it now gets a slice like everything else. */
const PIE_COLORS: Record<string, string> = {
  rent: "#1A2946", utilities: "#C9A227", software: "#3B82F6", marketing: "#E1568E",
  equipment: "#0E9F6E", logistics: "#F97316", supplies: "#8B5CF6", other: "#94A3B8",
};
/* v1.4.228 (CEO: "more beautiful… professional and also graphic and I can
   click the pie to get details and suitable with the Mobile Apps view"):
   interactive donut — gap-separated slices, active slice grows while the
   rest dim, centre shows the month total (or the selected category), every
   slice is a real button. Pure SVG, no library. */
function ExpensePie({ slices, active, onSelect, centerTop, centerBottom }: {
  slices: [string, number][];
  active: string | null;
  onSelect: (cat: string) => void;
  centerTop: string;
  centerBottom: string;
}) {
  const total = slices.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return null;
  const R = 44, C = 60;
  const GAP = slices.length > 1 ? 0.035 : 0; // radians of breathing room per edge
  let acc = 0;
  const arcs = slices.map(([cat, v]) => {
    const f0 = acc / total, f1 = (acc + v) / total;
    acc += v;
    const a0 = f0 * 2 * Math.PI - Math.PI / 2 + GAP;
    const a1 = f1 * 2 * Math.PI - Math.PI / 2 - GAP;
    if (a1 <= a0) return null; // sliver thinner than the gap
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
    const d = v === total
      ? `M ${C + R} ${C} A ${R} ${R} 0 1 1 ${C - R} ${C} A ${R} ${R} 0 1 1 ${C + R} ${C}`
      : `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`;
    const isActive = active === cat;
    const dimmed = active !== null && !isActive;
    /* v1.4.230 (CEO: "why it is looks like this???!"): two artifacts fixed —
       (1) round linecaps EXTEND strokeWidth/2 past the slice's angles, so
           neighbouring slices smeared into each other at the joins → butt
           caps; the gap angle provides the clean separation instead.
       (2) the clicked path took browser focus and Chrome drew the default
           focus RECTANGLE around its bounding box — its edge was the black
           vertical line through the donut → outline none; selection is
           already shown by the slice growing + the centre readout.
       Dimming softened 0.3 → 0.45 so inactive slices stay recognisable. */
    return (
      <path key={cat} d={d} fill="none"
        stroke={PIE_COLORS[cat] ?? PIE_COLORS.other}
        strokeWidth={isActive ? 26 : 19}
        strokeLinecap="butt"
        opacity={dimmed ? 0.45 : 1}
        role="button" tabIndex={0} aria-label={`${cat} details`} aria-pressed={isActive}
        style={{ cursor: "pointer", outline: "none", transition: "stroke-width 150ms, opacity 150ms" }}
        onClick={() => onSelect(cat)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(cat); }} />
    );
  });
  return (
    <svg viewBox="0 0 120 120" className="h-40 w-40 shrink-0 sm:h-44 sm:w-44" role="img" aria-label="Expenses by category">
      {arcs}
      <text x={C} y={C - 3} textAnchor="middle" style={{ fontSize: 9, fontWeight: 600, fill: "currentColor", textTransform: "capitalize" }}>{centerTop}</text>
      <text x={C} y={C + 9} textAnchor="middle" style={{ fontSize: 8.5, fill: "currentColor", opacity: 0.65 }}>{centerBottom}</text>
    </svg>
  );
}

/** Company operating expenses — CEO and COO record what the company spends
    (rent, software, ads, logistics …). Separate from CLAIMS, which are staff
    reimbursements routed to the CEO for approval. */
interface ClaimExp { id: number; amount_cents: number; paid_at?: string | null; decided_at?: string | null; claim_date?: string | null; claimant?: string | null }

export function ExpensesPanel() {
  const [openExp, setOpenExp] = useState<number | null>(null);
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
  const [staffPayroll, setStaffPayroll] = useState<{ month: string; cents: number; paid_at?: string | null; entries?: { name: string; cents: number; saved_net: boolean }[] } | null>(null);
  // v1.4.109: staff claims are expenses too — paid claims join the month,
  // approved-unpaid ones appear under Payments due.
  const [staffClaims, setStaffClaims] = useState<{ in_month: ClaimExp[]; paid: ClaimExp[]; due: ClaimExp[] }>({ in_month: [], paid: [], due: [] });
  const [loadError, setLoadError] = useState("");
  // Inline edit for typo fixes (staff payroll excluded — computed in Payroll).
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState({ expense_date: "", category: "other", amount: "", vendor: "", description: "" });
  const [pieCat, setPieCat] = useState<string | null>(null); // v1.4.228 pie drill-down

  const load = useCallback(async () => {
    const res = await api<{ expenses: ExpenseRec[]; upcoming?: ExpenseRec[]; staff_payroll?: { month: string; cents: number; paid_at?: string | null; entries?: { name: string; cents: number; saved_net: boolean }[] } | null; staff_claims?: { in_month: ClaimExp[]; paid: ClaimExp[]; due: ClaimExp[] } }>(`/expenses?month=${month}`);
    // v1.4.114: a failed load must SAY SO — a silent empty list looks like
    // data loss (the CEO's screenshot).
    setLoadError(res.ok ? "" : ((res.data as { error?: { message?: string } } | null)?.error?.message ?? "Server error — expenses could not be loaded. If this version was just deployed, apply migrations 0037 + 0038 first."));
    if (res.ok && res.data) {
      setRows(res.data.expenses);
      setUpcoming(res.data.upcoming ?? []);
      setStaffPayroll(res.data.staff_payroll ?? null);
      setStaffClaims(res.data.staff_claims ?? { in_month: [], paid: [], due: [] });
    }
    // Payroll is the biggest recurring commitment — show its due date the
    // same way (previous month's payroll, payable by the release moment).
    const prev = (() => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y || 0, (m || 0) - 2, 1)); return d.toISOString().slice(0, 7); })();
    const pr = await api<{ release?: { available_from: string; released: { released_at: string } | null } }>(`/payroll?month=${prev}`);
    if (pr.ok && pr.data?.release) {
      setPayrollDue({ month: prev, by: pr.data.release.available_from, released: Boolean(pr.data.release.released) });
    }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const rmc = fmtRM; // v1.4.272: global
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
        {/* v1.4.154: standard widths — 2-up full-width grid on phones, capped
            inline row from sm: (portal-wide pattern). */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <label className="block"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Expense date</span>
          <input type="date" className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:max-w-44" title="Expense date"
            value={draft.expense_date} onChange={(e) => setDraft((d) => ({ ...d, expense_date: e.target.value }))} /></label>
          <label className="block"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Category</span>
          <select className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm capitalize sm:max-w-40" value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
          <label className="block"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Amount (RM)</span>
          <input type="number" min={0} step="0.01" className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:max-w-36" placeholder="0.00"
            value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
          <label className="block sm:max-w-52 sm:flex-1"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Vendor (optional)</span>
          <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" placeholder="e.g. TNB, Shopee"
            value={draft.vendor} onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value }))} /></label>
        </div>
        {/* v1.4.186 mobile audit: on phones the description was squeezed to a
            sliver sharing one line with recurring + due day. Phone layout is
            now the v1.4.154 grid — description full-width on its own row,
            recurring/due-day a clean row, button full-width centred; from sm:
            the original single inline row returns. */}
        <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <label className="col-span-2 block min-w-0 sm:flex-1"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Description (optional)</span>
          <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" placeholder="What was this for?"
            value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></label>
          <label className="flex h-9 items-center gap-1.5 text-sm whitespace-nowrap" title="A recurring expense reappears every month as due until you record it">
            <input type="checkbox" checked={draft.recurring} onChange={(e) => setDraft((d) => ({ ...d, recurring: e.target.checked }))} />
            Monthly recurring
          </label>
          <label className="flex h-9 items-center justify-end gap-1.5 text-sm whitespace-nowrap sm:justify-start" title="Day of the month the payment must be made by">
            Due day
            <input type="number" min={1} max={31} className="border-input bg-background h-9 w-16 rounded-lg border px-2 text-sm" placeholder="—"
              value={draft.due_day} onChange={(e) => setDraft((d) => ({ ...d, due_day: e.target.value }))} />
          </label>
          <button type="button" className="bg-primary text-primary-foreground col-span-2 inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium sm:col-span-1"
            onClick={() => void addExpense()}>Record expense</button>
        </div>
        {msg && <p className="text-destructive mt-2 text-xs font-medium">{msg}</p>}
      </div>

      {(payrollDue || upcoming.length > 0 || staffClaims.due.length > 0 || rows.some((r) => r.due_day && !r.paid_at)) && (
        <div className={card}>
          <p className="text-sm font-semibold">💳 Payments due — {dmy(month)}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Commit each payment before its due date. Recurring expenses from
            earlier months appear here until recorded for this month.
          </p>
          <div className="mt-3 space-y-2">
            {payrollDue && (
              <div className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-semibold">
                    Staff payroll — {dmy(payrollDue.month)}
                    {staffPayroll && staffPayroll.month === payrollDue.month && (
                      staffPayroll.cents > 0
                        ? <span className="ml-2">{rmc(staffPayroll.cents)}</span>
                        : <span className="text-muted-foreground ml-2 text-xs font-normal">(figure appears once {dmy(payrollDue.month)} payroll is processed in the Payroll tab — it counts in THIS month&apos;s total)</span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Pay by <span className="font-medium">{dmy(payrollDue.by.split(" ")[0])}, {payrollDue.by.split(" ")[1]} MYT</span> (payslips release then) · sum of SAVED payslip nets — after any change in the Payroll tab, press Save all there so this figure matches
                  </p>
                  {(staffPayroll?.entries?.length ?? 0) > 0 && staffPayroll?.month === payrollDue.month && (
                    <details className="mt-1 text-xs">
                      <summary className="text-muted-foreground cursor-pointer select-none">
                        Breakdown — {staffPayroll!.entries!.length} saved {staffPayroll!.entries!.length === 1 ? "entry" : "entries"} (compare with the Payroll tab: extra or missing names / different figures = rows not yet re-saved)
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {staffPayroll!.entries!.map((r, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>{properName(r.name)}{!r.saved_net && <span className="text-amber-700" title="Saved before the net-storing update — figure recomputed by the server. Press Save all in the Payroll tab to store the exact net."> · recomputed ⚠</span>}</span>
                            <span className="tabular-nums">{rmc(r.cents)}</span>
                          </li>
                        ))}
                      </ul>
                      <button type="button"
                        className="border-border mt-1.5 inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium hover:bg-secondary"
                        title="Server-side repair: recomputes this month's working days from the holiday calendar and re-stores every entry's net — no Save all needed"
                        onClick={async () => {
                          const r = await api<{ working_days?: number; rows?: number; error?: { message?: string } }>(`/payroll/recompute`, {
                            method: "POST", body: JSON.stringify({ month: staffPayroll!.month }),
                          });
                          if (r.ok) { showToast("Saved", `Recomputed ${r.data?.rows ?? 0} entries at ${r.data?.working_days ?? "?"} working days — figures now match everywhere`); void load(); }
                          else showToast("No changes", r.data?.error?.message ?? "Recompute failed", "notice");
                        }}>
                        🔧 Fix discrepancy now (recompute on server)
                      </button>
                      <button type="button"
                        className="border-border ml-2 mt-1.5 inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium hover:bg-secondary"
                        title="Downloads the official Maybank2E template ALREADY FILLED (Home sheet + salary rows). Needs the one-time ⚙ M2E setup in the Payroll tab. Open → enable macros → generate → upload → approve → Mark paid here"
                        onClick={async () => {
                          const res = await fetch(`/api/v1/staff/payroll/m2e-file?month=${staffPayroll!.month}`, { credentials: "include" });
                          if (!res.ok) {
                            const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
                            showToast("No file", j?.error?.message ?? "M2E file failed — check ⚙ M2E setup in the Payroll tab", "notice");
                            return;
                          }
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url; a.download = `azoo-m2e-salary-${staffPayroll!.month}.xlsm`; a.click();
                          URL.revokeObjectURL(url);
                          showToast("Saved", "M2E workbook downloaded — open, enable macros, generate + upload");
                        }}>
                        💳 M2E salary file
                      </button>
                    </details>
                  )}
                </div>
                <span className="flex items-center gap-1.5">
                  {staffPayroll?.paid_at
                    ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700"
                        title={`Payment recorded ${dmy(staffPayroll.paid_at.slice(0, 10))}`}>💸 PAID</span>
                    : (
                      <>
                        {payrollDue.released
                          ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">RELEASED</span>
                          : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">DUE</span>}
                        <button type="button" className={rowBtnPrimary}
                          title="Record that the salary bank run is done — the DUE pill clears and the payment moves to Payments completed"
                          onClick={async () => {
                            const res = await api(`/payroll/paid`, { method: "POST", body: JSON.stringify({ month: payrollDue.month }) });
                            if (res.ok) { showToast("Saved", "Payroll payment recorded"); void load(); }
                          }}>Mark paid</button>
                      </>
                    )}
                </span>
              </div>
            )}
            {staffClaims.due.map((c) => (
              <div key={`clm-${c.id}`} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold">{rmc(c.amount_cents)}</span>{" "}
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">staff claim</span>
                    {c.claimant && <span className="text-muted-foreground"> · {properName(c.claimant)}</span>}
                  </p>
                  <p className="text-muted-foreground text-xs">Approved{c.decided_at ? ` ${dmy(c.decided_at.slice(0, 10))}` : ""} — pay the claimant, then press 💸 Mark paid on the Claims tab</p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">DUE</span>
              </div>
            ))}
            {upcoming.map((r) => {
              const [yy, mm] = month.split("-").map(Number);
              const lastD = new Date(Date.UTC(yy || 0, mm || 0, 0)).getUTCDate();
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
                      {r.due_day ? `Due ${dmy(dueISO)}` : "No due day set"}
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
                      if (res.ok) { showToast("Saved", `Recorded for ${dmy(month)} — mark it paid once committed`); void load(); }
                    }}>
                    Record for this month
                  </button>
                </div>
              );
            })}
            {rows.filter((r) => r.due_day && !r.paid_at).map((r) => {
              const [yy, mm] = month.split("-").map(Number);
              const lastD = new Date(Date.UTC(yy || 0, mm || 0, 0)).getUTCDate();
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
                        {overdue ? "OVERDUE" : "DUE"} {dmy(dueISO)}
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
        {(() => {
          // v1.4.101: payments COMPLETED this month — what was actually
          // released: paid expenses + the payroll run once marked paid.
          const done = rows.filter((r) => r.paid_at);
          const payrollDone = staffPayroll?.paid_at ? staffPayroll : null;
          if (done.length === 0 && !payrollDone && staffClaims.paid.length === 0) return null;
          const doneTotal = done.reduce((a, r) => a + r.amount_cents, 0) + (payrollDone?.cents ?? 0) + staffClaims.paid.reduce((a, r) => a + r.amount_cents, 0);
          return (
            <div className="border-border mb-4 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">✅ Payments completed — {dmy(month)}</p>
                <p className="text-sm font-semibold">{rmc(doneTotal)}</p>
              </div>
              <div className="mt-2 space-y-1">
                {payrollDone && (
                  <p className="text-muted-foreground text-xs">
                    💸 <span className="text-foreground font-medium">{rmc(payrollDone.cents)}</span> · Staff payroll ({dmy(payrollDone.month)}) · released {dmy(payrollDone.paid_at!.slice(0, 10))}
                  </p>
                )}
                {staffClaims.paid.map((c) => (
                  <p key={`clmdone-${c.id}`} className="text-muted-foreground text-xs">
                    🧾 <span className="text-foreground font-medium">{rmc(c.amount_cents)}</span> · Staff claim{c.claimant ? ` — ${properName(c.claimant)}` : ""} · paid {c.paid_at ? dmy(c.paid_at.slice(0, 10)) : ""}
                  </p>
                ))}
                {done.map((r) => (
                  <p key={`done-${r.id}`} className="text-muted-foreground text-xs">
                    <span className="text-foreground font-medium">{rmc(r.amount_cents)}</span> · <span className="capitalize">{r.category}</span>
                    {r.vendor ? ` · ${r.vendor}` : ""}{r.description ? ` · ${r.description}` : ""} · paid {dmy(r.paid_at!.slice(0, 10))}
                  </p>
                ))}
              </div>
            </div>
          );
        })()}
        {(() => {
          /* v1.4.227: category donut + legend for the month on screen. */
          const byCat = new Map<string, number>();
          for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount_cents);
          const slices = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
          const totalPie = slices.reduce((a, [, v]) => a + v, 0);
          const catRows = pieCat ? rows.filter((r) => r.category === pieCat) : [];
          const catTotal = catRows.reduce((a, r) => a + r.amount_cents, 0);
          return totalPie > 0 ? (
            <div className="border-border mb-3 rounded-lg border p-3">
              <p className="text-sm font-semibold">📊 Expenses by category — {dmy(month)}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">Tap a slice or a category for its records.</p>
              <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
                <ExpensePie slices={slices} active={pieCat}
                  onSelect={(c) => setPieCat((cur) => (cur === c ? null : c))}
                  centerTop={pieCat ?? "Total"}
                  centerBottom={rmc(pieCat ? catTotal : totalPie)} />
                <div className="grid w-full gap-1 text-xs sm:w-auto">
                  {slices.map(([cat, v]) => (
                    <button key={cat} type="button"
                      onClick={() => setPieCat((cur) => (cur === cat ? null : cat))}
                      className={
                        "flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 text-left " +
                        (pieCat === cat ? "bg-secondary font-semibold" : "hover:bg-secondary/60")
                      }>
                      <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: PIE_COLORS[cat] ?? PIE_COLORS.other }} />
                      <span className="font-medium capitalize">{cat}</span>
                      <span className="text-muted-foreground ml-auto tabular-nums">{rmc(v)} · {((v / totalPie) * 100).toFixed(v / totalPie < 0.1 ? 1 : 0)}%</span>
                    </button>
                  ))}
                  <p className="text-muted-foreground mt-1 px-2">Expense records only — payroll and claims have their own lines above.</p>
                </div>
              </div>
              {pieCat && (
                <div className="border-border mt-2 rounded-lg border p-2">
                  <p className="text-xs font-semibold capitalize">{pieCat} — {catRows.length} record{catRows.length === 1 ? "" : "s"} · {rmc(catTotal)}</p>
                  <div className="mt-1 grid gap-1 text-xs">
                    {catRows.map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-x-2">
                        <span className="font-semibold tabular-nums">{rmc(r.amount_cents)}</span>
                        <span>{r.vendor || r.description || "—"}</span>
                        <span className="text-muted-foreground">{dmy(r.expense_date)}</span>
                        {r.paid_at
                          ? <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">PAID</span>
                          : <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">outstanding</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null;
        })()}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{dmy(month)} expenses</p>
          <div className="text-right">
            <p className="text-sm font-semibold">Total {rmc(total + (staffPayroll?.cents ?? 0) + staffClaims.in_month.reduce((a, r) => a + r.amount_cents, 0))}</p>
            {staffPayroll && staffPayroll.cents > 0 && (
              <p className="text-muted-foreground text-xs">
                incl. staff payroll {rmc(staffPayroll.cents)} ({dmy(staffPayroll.month)}) + expenses {rmc(total)}{staffClaims.in_month.length > 0 ? ` + staff claims ${rmc(staffClaims.in_month.reduce((a, r) => a + r.amount_cents, 0))} (${staffClaims.in_month.length}, by claim date)` : ""}
              </p>
            )}
            {/* v1.4.208 (CEO): what's cleared vs what's still to pay this
                month — across expense rows, the payroll run, and approved
                claims (each keeps its own Mark paid). */}
            {(() => {
              const expPaid = rows.filter((r) => r.paid_at).reduce((a, r) => a + r.amount_cents, 0);
              const expOutN = rows.filter((r) => !r.paid_at).length;
              const payrollOut = staffPayroll && staffPayroll.cents > 0 && !staffPayroll.paid_at ? staffPayroll.cents : 0;
              const claimsOutRows = staffClaims.in_month.filter((c) => !c.paid_at);
              const claimsOut = claimsOutRows.reduce((a, c) => a + c.amount_cents, 0);
              const outstanding = (total - expPaid) + payrollOut + claimsOut;
              const grand = total + (staffPayroll?.cents ?? 0) + staffClaims.in_month.reduce((a, r) => a + r.amount_cents, 0);
              const items = expOutN + (payrollOut > 0 ? 1 : 0) + claimsOutRows.length;
              return outstanding > 0 ? (
                <p className="mt-0.5 text-xs">
                  <span className="font-medium text-green-700">Paid {rmc(grand - outstanding)}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="font-bold text-amber-700">Outstanding {rmc(outstanding)}</span>
                  <span className="text-muted-foreground"> ({items} to clear)</span>
                </p>
              ) : (
                <p className="mt-0.5 text-xs font-medium text-green-700">✅ All cleared — {rmc(grand)} paid</p>
              );
            })()}
          </div>
        </div>
        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
          {loadError && <p className="mb-2 text-sm font-medium text-amber-700">⚠ {loadError}</p>}
          {rows.length === 0 && !loadError && (
            <p className="text-muted-foreground text-sm">
              No expenses recorded for this month. This tab shows ONE month at a
              time — earlier records (e.g. July) are under the month picker at
              the top right.
            </p>
          )}
          {rows.map((r) => editId === r.id ? (
            <div key={r.id} className="border-border rounded-lg border px-3 py-2">
              <div className="flex flex-wrap gap-2">
                <input type="date" className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm sm:w-auto sm:max-w-40"
                  value={edit.expense_date} onChange={(e) => setEdit((d) => ({ ...d, expense_date: e.target.value }))} />
                <select className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm capitalize sm:w-auto sm:max-w-36"
                  value={edit.category} onChange={(e) => setEdit((d) => ({ ...d, category: e.target.value }))}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="number" min={0} step="0.01" className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm sm:w-auto sm:max-w-32"
                  placeholder="Amount (RM)" value={edit.amount} onChange={(e) => setEdit((d) => ({ ...d, amount: e.target.value }))} />
                <input className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm sm:max-w-48 sm:flex-1" placeholder="Vendor"
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
            <div key={r.id} className="border-border flex flex-wrap items-start justify-between gap-x-2 gap-y-1 rounded-lg border px-3 py-2 [&>dl]:basis-full">
              <div className="min-w-0">
                <p className="text-sm">
                  {/* v1.4.249: the amount opens the record — date, description,
                      who recorded it and the recurring mark live in the panel;
                      the paid state stays on the row because it is the thing
                      being tracked (v1.4.208). */}
                  <RecordToggle open={openExp === r.id} title="Date, description and who recorded it"
                    className="font-semibold" onToggle={() => setOpenExp(openExp === r.id ? null : r.id)}>{rmc(r.amount_cents)}</RecordToggle>{" "}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{r.category}</span>
                  {r.vendor && <span className="text-muted-foreground"> · {r.vendor}</span>}
                  {r.paid_at
                    ? <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700">✓ PAID {dmy(r.paid_at.slice(0, 10))}</span>
                    : r.due_day
                      ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">DUE {String(r.due_day).padStart(2, "0")}-{month.split("-")[1]}</span>
                      : null}
                </p>
              </div>
              <span className={rowActions}>
                {/* v1.4.208 (CEO: "track that I have paid and how many more
                    outstanding … remaining amount I should clear off"):
                    paid state is set right on the row; Undo covers a
                    misclick (toggle route). */}
                {r.paid_at ? (
                  <button type="button" className={rowBtn} title="Clear the paid mark (misclick)"
                    onClick={async () => { const res = await api(`/expenses/${r.id}/paid`, { method: "POST", body: JSON.stringify({ paid: false }) }); if (res.ok) { showToast("Saved", "Paid mark cleared — back to outstanding"); void load(); } }}>Undo paid</button>
                ) : (
                  <button type="button" className={rowBtnGood} title="Record that this expense has been paid"
                    onClick={async () => { const res = await api(`/expenses/${r.id}/paid`, { method: "POST", body: JSON.stringify({}) }); if (res.ok) { showToast("Saved", "Marked paid ✓"); void load(); } }}>Mark paid</button>
                )}
                {/* v1.4.258: these two sat beside a bordered Mark paid as bare
                    underlined words — the same row, two different controls. */}
                <button type="button" className={rowBtn}
                  onClick={() => {
                    setEditId(r.id);
                    setEdit({ expense_date: r.expense_date, category: r.category, amount: (r.amount_cents / 100).toString(), vendor: r.vendor ?? "", description: r.description ?? "" });
                  }}>Edit</button>
                <button type="button" className={rowBtnDanger} onClick={async () => { await api(`/expenses/${r.id}`, { method: "DELETE" }); showToast("Saved", "Expense removed"); void load(); }}>Remove</button>
              </span>
              {openExp === r.id && (
                <DetailGrid items={[
                  { label: "Date", value: dmy(r.expense_date) },
                  { label: "Category", value: <span className="capitalize">{r.category}</span> },
                  { label: "Vendor", value: r.vendor ?? "" },
                  { label: "Recorded by", value: r.created_by_name ?? "" },
                  { label: "Recurring", value: r.recurring === 1 ? `Yes${r.due_day ? ` · due day ${r.due_day}` : ""}` : "" },
                  { label: "Description", wide: true, value: r.description ?? "" },
                ]} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

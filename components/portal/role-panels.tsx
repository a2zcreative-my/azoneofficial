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

import { makeApi, getCsrfToken, csrfFetch } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
const api = makeApi("/staff");
import { useCallback, useEffect, useState } from "react";
import { esc } from "@/lib/escape-html";
import { DetailsToggle } from "@/components/ui/details-toggle";
import { SubR } from "@/components/ui/sub-label"; // v1.79.0 - the portal-wide field label, shared
import { properName, firstName, displayName } from "@/lib/names";
import { compressImage } from "@/lib/compress-image";
import { SITE_CONFIG } from "@/constants/site";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { RecordToggle, DetailGrid } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowBtnGood, rowBtnPrimary, rowActions } from "@/components/ui/row-button";
import { buildClaimPdf } from "@/lib/form-pdf";
import { downloadCsv, csvStampMyt } from "@/lib/csv";
import { sharePdfFile } from "@/lib/doc-pdf";
/* v1.28.0 — the printed claim form follows the issuer STAMPED on its row
   (resolveIssuer); operational artefacts issued today (the stock-count
   sheet) carry the current operator, DOCUMENT_ISSUER. */
import { DOCUMENT_ISSUER, resolveIssuer } from "@/lib/issuers";
/* v1.78.0 — the attendance card's control rows were hand-rolled widths and
   bare literals; they now use the same tokens as the rest of the portal. */
import { card, inputClass, inputClassSm, btnClass, chipNeutral, fieldRow, th, td, thR2, tdR2 } from "@/lib/ui-styles";
import { MiniBar, accentRowDanger, accentCellDanger } from "@/components/ui/stat-card";
import { dmy, dmyMYT, fmtRM, rm as rmBare } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { Skel, SkelRows, SkelTable, SkelText } from "@/components/ui/skeleton"; // v1.77.0 — skeletons until the first fetch lands

/* v1.26 BM sweep: display-time translation ONLY — stored values, API payloads
   and compared strings stay English. */
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
/* Status/category/reason values live in the DB in English — these maps swap
   the DISPLAYED word only; the underlying value never changes. */
const STATUS_MS: Record<string, string> = {
  late: "Lewat", early_out: "Keluar awal", out_of_stock: "Habis stok",
  closed_lost: "Tutup — kalah", rejected: "Ditolak", returned: "Dipulangkan",
  ok: "OK", delivered: "Terhantar", closed_won: "Tutup — menang", done: "Selesai",
  in_stock: "Ada stok", low_stock: "Stok rendah", approved: "Diluluskan",
  preparing: "Sedang disediakan", shipped: "Dihantar", in_transit: "Dalam penghantaran",
  requested: "Diminta", in_progress: "Dalam proses", pending: "Menunggu",
};
const statusLabel = (v: string) => (getLang() === "ms" ? (STATUS_MS[v] ?? v.replace(/_/g, " ")) : v.replace(/_/g, " "));
const CAT_MS: Record<string, string> = {
  travel: "Perjalanan", meal: "Makan", "client meeting": "Mesyuarat pelanggan",
  stationery: "Alat tulis", accommodation: "Penginapan", equipment: "Peralatan",
  medical: "Perubatan", other: "Lain-lain", rent: "Sewa", utilities: "Utiliti",
  software: "Perisian", marketing: "Pemasaran", logistics: "Logistik", supplies: "Bekalan",
};
const catLabel = (c: string) => (getLang() === "ms" ? (CAT_MS[c] ?? c) : c);
const REASON_MS: Record<string, string> = {
  "Stock count variance — missing": "Varians kiraan stok — hilang",
  "Damaged / defective": "Rosak / cacat",
  "Sample or giveaway": "Sampel atau hadiah",
  "Internal use": "Kegunaan dalaman",
  "Sold offline": "Dijual luar talian",
  "Data entry correction": "Pembetulan kemasukan data",
  "Other": "Lain-lain",
  "Stock count variance — found extra": "Varians kiraan stok — jumpa lebih",
  "Restock from supplier": "Stok semula daripada pembekal",
  "Customer return": "Pemulangan pelanggan",
  "Returned from sample / event": "Dipulangkan daripada sampel / acara",
};
const reasonLabel = (r: string) => (getLang() === "ms" ? (REASON_MS[r] ?? r) : r);




/* v1.79.0 — SubR moved to components/ui/sub-label.tsx. It was private to
   this file, so every other file that wanted a labelled field wrote its own
   or shipped bare placeholders; the document form's unit-price and
   line-discount boxes were two unlabelled "0.00"s side by side because of
   it. Imported at the top of this file now. */


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
      {statusLabel(value)}
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
  /* v1.77.0 — skeleton until the first fetch lands (lists start [] so an
     empty month cannot be told from one still loading). */
  const [loaded, setLoaded] = useState(false);

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
    setLoaded(true);
  }, [month]);
  useEffect(() => {
    void load().finally(() => setLoaded(true)); // a failed request clears the skeleton too
  }, [load]);

  const submitReport = async () => {
    if (!draft.content.trim()) return;
    /* v1.40.0 (AUDIT M14): a 403 here used to clear the draft and say
       nothing — the CEO typed a report and it silently vanished. A failed
       submit now KEEPS the draft and says why. */
    const res = await api<{ error?: { message?: string } }>(`/task-reports`, { method: "POST", body: JSON.stringify(draft) });
    if (!res.ok) {
      window.alert(res.data?.error?.message ?? L("Report was not saved — you may not have access to task reports.", "Laporan tidak disimpan — anda mungkin tiada akses kepada laporan tugasan."));
      return;
    }
    setDraft((d) => ({ ...d, content: "" }));
    void load();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{L("Attendance verification", "Pengesahan kehadiran")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("Company accounts · shift", "Akaun syarikat · syif")} {shift || L("10:00–18:00 MYT, Monday–Friday", "10:00–18:00 MYT, Isnin–Jumaat")} {L("· CSV export for payroll", "· eksport CSV untuk gaji")}
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
              {L("Export CSV", "Eksport CSV")}
            </a>
          </div>
        </div>
        {/* v1.4.190 (CEO): the verification list scrolls inside the card
            like every other long table — sticky subheads per v1.4.189. */}
        <div className="mt-4 max-h-[28rem] overflow-x-auto overflow-y-auto">
          <table className="tbl-sticky w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>{L("Staff", "Kakitangan")}</th>
                <th className={th}>{L("Email", "E-mel")}</th>
                <th className={th}>{L("Event", "Acara")}</th>
                <th className={th}>{L("Time (MYT)", "Masa (MYT)")}</th>
                <th className={th}>{L("Shift check", "Semakan syif")}</th>
              </tr>
            </thead>
            <tbody>
              {/* v1.77.0 — skeleton until the first fetch lands: five columns, like the real rows. */}
              {!loaded && Array.from({ length: 5 }, (_, i) => (
                <tr key={`skel-${i}`} className="border-border border-b last:border-0" aria-hidden>
                  <td className={td}><Skel className="h-4 w-28" /></td>
                  <td className={td}><Skel className="h-4 w-40" /></td>
                  <td className={td}><Skel className="h-4 w-16" /></td>
                  <td className={td}><Skel className="h-4 w-32" /></td>
                  <td className={td}><Skel className="h-5 w-16 rounded-full" /></td>
                </tr>
              ))}
              {loaded && rows.length === 0 && (
                <tr>
                  <td className={`${td} text-muted-foreground`} colSpan={5}>
                    {L("No attendance records for this month yet.", "Tiada rekod kehadiran untuk bulan ini lagi.")}
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="border-border border-b last:border-0">
                  <td className={`${td} font-medium`}>{properName(r.name)}</td>
                  <td className={`${td} text-muted-foreground`}>{r.email}</td>
                  <td className={td}>{r.type === "clock_in" ? L("clock in", "daftar masuk") : r.type === "clock_out" ? L("clock out", "daftar keluar") : r.type.replace(/_/g, " ")}</td>
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

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">{L("Task report", "Laporan tugasan")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Daily, weekly, or monthly — visible to management.", "Harian, mingguan atau bulanan — dilihat oleh pengurusan.")}
          </p>
          <div className="mt-3 flex gap-2">
            <select
              className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.period}
              onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))}
            >
              <option value="daily">{L("Daily", "Harian")}</option>
              <option value="weekly">{L("Weekly", "Mingguan")}</option>
              <option value="monthly">{L("Monthly", "Bulanan")}</option>
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
            placeholder={L("What was completed, what is pending, what needs attention…", "Apa yang telah siap, apa yang tertunda, apa yang perlu perhatian…")}
            value={draft.content}
            onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          />
          <button type="button" className={`${btnClass} mt-2`} onClick={() => void submitReport()}>
            {L("Submit report", "Hantar laporan")}
          </button>
          <ul className="mt-4 space-y-2">
            {/* v1.77.0 — skeleton until the first fetch lands: three report cards. */}
            {!loaded && Array.from({ length: 3 }, (_, i) => (
              <li key={`skel-${i}`} className="border-border rounded-lg border px-3 py-2" aria-hidden>
                <Skel className="h-4 w-48 max-w-full" />
                <SkelText lines={2} className="mt-2" />
              </li>
            ))}
            {reports.slice(0, 5).map((r) => (
              <li key={r.id} className="border-border rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium capitalize">{r.period === "daily" ? L("daily", "harian") : r.period === "weekly" ? L("weekly", "mingguan") : r.period === "monthly" ? L("monthly", "bulanan") : r.period}</span>{" "}
                <span className="text-muted-foreground">· {dmy(r.report_date)} · {r.author}</span>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{r.content}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">{L("Staff birthdays", "Hari lahir kakitangan")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Maintained in the staff directory (birthday field). Sorted by month and day.", "Diselenggara dalam direktori kakitangan (medan hari lahir). Disusun mengikut bulan dan hari.")}
          </p>
          <ul className="mt-3 space-y-1.5">
            {/* v1.77.0 — skeleton until the first fetch lands: name left, date right. */}
            {!loaded && Array.from({ length: 4 }, (_, i) => (
              <li key={`skel-${i}`} className="flex justify-between py-0.5" aria-hidden>
                <Skel className="h-4 w-32" />
                <Skel className="h-4 w-20" />
              </li>
            ))}
            {loaded && birthdays.length === 0 && (
              <li className="text-muted-foreground text-sm">
                {L("No birthdays recorded yet — add them via the staff directory.", "Tiada hari lahir direkodkan lagi — tambah melalui direktori kakitangan.")}
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
            {L("Leave administration (annual / medical / emergency) is in the", "Pentadbiran cuti (tahunan / sakit / kecemasan) berada dalam tab")}{" "}
            <span className="font-medium">{L("Leave", "Cuti")}</span>{L(" tab — HR sees every request there and can approve or reject. Quotations, DO and invoices are in the", " — HR melihat setiap permohonan di sana dan boleh meluluskan atau menolaknya. Sebut harga, DO dan invois berada dalam tab")}{" "}
            <span className="font-medium">{L("Sales", "Jualan")}</span>{L(" tab with the QT-AZOODDMMYY-X numbering.", " dengan penomboran QT-AZOODDMMYY-X.")}
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
  bridge_enabled?: number | null; // v1.35.0 — published to the ELFIA web store
  elfia_price_cents?: number | null; // v1.35.0 — explicit web price (empty = list price)
  updated_by_name?: string;
}
interface BridgeHealth { // v1.36.0 — the ELFIA bridge's pulse
  key_configured: boolean; last_event_at?: string | null; last_poll_at?: string | null;
  applied_24h: number; unknown_24h: number;
  unknown: { sku: string; n: number; last_at: string }[];
  pending_migration?: boolean;
  /** v1.38.1 — the route could not be reached or refused us; every field
      above then means nothing and MUST NOT be reported as bridge state. */
  unavailable?: boolean;
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

  /* v1.77.0 — skeleton until the first fetch lands. `ttStatus` starts null
     but a failed /status also leaves it null, and `ttOrders` starts [] —
     so one flag, set once both requests have settled. */
  const [loaded, setLoaded] = useState(false);
  const loadTikTok = useCallback(async () => {
    const st = await tiktokApi<TtStatus>(`/status`);
    if (st.ok) setTtStatus(st.data);
    const pr = await api<{ records: TtOrder[] }>(`/postage`);
    setTtOrders((pr.data?.records ?? []).filter((r) => r.order_ref?.startsWith("TT-")).slice(0, 100));
    setLoaded(true);
  }, [tiktokApi]);

  useEffect(() => { void loadTikTok().finally(() => setLoaded(true)); }, [loadTikTok]);

  const syncTikTok = async () => {
    setTtMsg(L("Syncing from TikTok…", "Menyegerak dari TikTok…"));
    const res = await tiktokApi<{ imported: number; skipped: number; problems: string[]; error?: { message?: string } }>(
      `/sync`, { method: "POST", body: JSON.stringify({}) },
    );
    if (res.ok && res.data) {
      const probs = res.data.problems?.length ? ` · ${res.data.problems.join(" · ")}` : "";
      setTtMsg(`${L("Imported", "Diimport")} ${res.data.imported} (${res.data.skipped} ${L("already in", "sudah ada")})${probs}`);
      void loadTikTok();
      onChanged();
      /* v1.24.1 (CEO: "Operations map — orders by state should be updated
         accordingly when I click on button sync from TikTok"): tell every
         listening card fresh order data just landed. */
      try { window.dispatchEvent(new CustomEvent("azone:tiktok-synced")); } catch { /* SSR-safe */ }
    } else {
      setTtMsg(res.data?.error?.message ?? L("Sync failed — check the TikTok setup", "Segerakan gagal — semak tetapan TikTok"));
    }
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{L("TikTok Orders", "Pesanan TikTok")}</p>
          {/* v1.77.0 — skeleton until the first fetch lands: the status line
              would otherwise read "Not configured" while /status is in flight. */}
          {!loaded ? <Skel className="mt-1 h-3 w-64 max-w-full" /> : (
          <p className="text-muted-foreground mt-0.5 text-xs">
            {!ttStatus?.configured
              ? L("Not configured — set the app secret and deploy the worker.", "Belum dikonfigurasi — tetapkan app secret dan deploy worker.")
              : !ttStatus?.authorized
                ? L("Not authorized yet — activate the shop/order scopes, publish the app in Partner Center, then authorize the shop. Sync pulls existing orders once live.", "Belum diberi kebenaran — aktifkan skop shop/order, terbitkan aplikasi dalam Partner Center, kemudian benarkan kedai. Segerak menarik pesanan sedia ada setelah aktif.")
                : ttStatus.last_event_at
                  ? `${L("Connected · last webhook", "Bersambung · webhook terakhir")} ${dmyMYT(ttStatus.last_event_at)} MYT${ttStatus.last_event_verified === false ? L(" (signature FAILED — check app secret)", " (tandatangan GAGAL — semak app secret)") : ""}`
                  : L("Connected · auto-sync runs every 30 minutes; Sync pulls now.", "Bersambung · auto-segerak berjalan setiap 30 minit; Segerak menarik sekarang.")}
          </p>
          )}
        </div>
        {canSync && (
          <button
            type="button"
            className="border-border inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-secondary"
            onClick={() => void syncTikTok()}
          >
            {L("Sync from TikTok", "Segerak dari TikTok")}
          </button>
        )}
      </div>
      {ttMsg && <p className="mt-2 text-xs font-medium text-amber-700">{ttMsg}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {([["all", L("All", "Semua")], ["preparing", L("New", "Baru")], ["shipped", L("Shipped", "Dihantar")], ["delivered", L("Delivered", "Sampai")]] as const).map(([v, label]) => {
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
      <DetailsToggle label={L("Show orders", "Tunjuk pesanan")}>
      <div className="mt-1 max-h-72 overflow-y-auto">
        {/* v1.77.0 — skeleton until the first fetch lands. */}
        {!loaded && <SkelRows rows={3} />}
        {loaded && ttOrders.length === 0 && <p className="text-muted-foreground text-sm">{L("No TikTok orders yet.", "Tiada pesanan TikTok lagi.")}</p>}
        {ttOrders.length > 0 && ttOrders.every((o) => ttFilter !== "all" && o.status !== ttFilter) && (
          <p className="text-muted-foreground text-sm">{L("No orders with this status.", "Tiada pesanan dengan status ini.")}</p>
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
                <span className="text-muted-foreground block text-xs">{L("No stock movement recorded", "Tiada pergerakan stok direkodkan")}</span>
              )}
              {o.tracking_no ? (
                <span className="block text-xs">
                  {L("Tracking:", "Penjejakan:")} <span className="font-semibold tracking-wide">{o.tracking_no}</span>
                  {o.courier ? <span className="text-muted-foreground"> · {o.courier}</span> : null}
                </span>
              ) : (
                <span className="text-muted-foreground block text-xs">{L("No tracking number yet", "Tiada nombor penjejakan lagi")}</span>
              )}
              {o.note && <span className="text-muted-foreground block text-xs">{o.note}</span>}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{statusLabel(o.status)}</span>
          </div>
        ))}
      </div>
      </DetailsToggle>
    </div>
  );
}

const rmR = fmtRM; // v1.4.272: global

export function InventoryPanel({ role = "" }: { role?: string }) {
  /* v1.21.7 (CEO): deleting a stock-movement record is CEO/COO only. */
  const canDeleteMovements = ["super_admin", "ceo", "coo"].includes(role);
  const [items, setItems] = useState<InvItem[]>([]);
  const [postage, setPostage] = useState<PostRec[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [invDraft, setInvDraft] = useState({ sku: "", name: "", stock: 0, unit_price: "" });
  const [bridgeHealth, setBridgeHealth] = useState<BridgeHealth | null>(null); // v1.36.0
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
  /* v1.77.0 — skeleton until the first fetch lands. Every list above starts
     [] so "no items yet" cannot be told from "still loading"; this flag can. */
  const [loaded, setLoaded] = useState(false);

  // v1.4.169/170: an Out − goes through the modal — mandatory remark for
  // traceability, optional Sold @ that records it as a SALE in the totals.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const adjust = async (id: number, delta: number, salePrice?: string, remark?: string) => {
    setInvMsg("");
    const sale = delta < 0 && salePrice !== undefined && salePrice.trim() !== "" ? Number(salePrice) : undefined;
    if (sale !== undefined && (!Number.isFinite(sale) || sale < 0)) { invToast(L("Not saved", "Tidak disimpan"), L("Sold @ must be a valid RM amount", "Dijual @ mesti amaun RM yang sah"), "notice"); return false; }
    const res = await api<{ error?: { message?: string }; sale_recorded?: boolean; stock?: number }>(`/inventory/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify({ delta, ...(sale !== undefined ? { sale_price: sale } : {}), ...(remark ? { remark } : {}) }),
    });
    if (!res.ok) { invToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Adjustment failed", "Pelarasan gagal"), "notice"); void load(); return false; }
    /* v1.4.251: an IN used to save in silence — no toast at all — so there was
       no way to know the stock had actually moved. Every movement now says so,
       and quotes the NEW stock level the server came back with. */
    const level = typeof res.data?.stock === "number" ? ` ${L("— now", "— kini")} ${res.data.stock} ${L("in stock", "dalam stok")}` : "";
    if (res.data?.sale_recorded) invToast(L("Sale recorded", "Jualan direkodkan"), `${-delta} × RM ${rmBare(Math.round(sale! * 100))} ${L("— counted in total sales", "— dikira dalam jumlah jualan")}${level}`);
    else if (delta < 0) invToast(L("Stock out recorded", "Stok keluar direkodkan"), `${-delta} pcs${level} ${L("— logged with your remark", "— dilog dengan catatan anda")}`);
    else invToast(L("Stock in recorded", "Stok masuk direkodkan"), `${delta} pcs${level} ${L("— logged with your remark", "— dilog dengan catatan anda")}`);
    void load();
    return true;
  };
  // v1.4.172: create-path wrapper adding the backdatable date.
  // v1.4.251: signed — the same path records a stock IN.
  const adjust2 = async (id: number, qty: number, price: string, remark: string, outDate: string, dir: "in" | "out" = "out") => {
    setInvMsg("");
    const sale = dir === "out" && price.trim() !== "" ? Number(price) : undefined;
    if (sale !== undefined && (!Number.isFinite(sale) || sale < 0)) { invToast(L("Not saved", "Tidak disimpan"), L("Sold @ must be a valid RM amount", "Dijual @ mesti amaun RM yang sah"), "notice"); return false; }
    const res = await api<{ error?: { message?: string }; sale_recorded?: boolean; stock?: number }>(`/inventory/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify({ delta: dir === "out" ? -qty : qty, ...(sale !== undefined ? { sale_price: sale } : {}), remark, ...(outDate ? { out_date: outDate } : {}) }),
    });
    if (!res.ok) { invToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Adjustment failed", "Pelarasan gagal"), "notice"); void load(); return false; }
    const level = typeof res.data?.stock === "number" ? ` ${L("— now", "— kini")} ${res.data.stock} ${L("in stock", "dalam stok")}` : "";
    if (res.data?.sale_recorded) invToast(L("Sale recorded", "Jualan direkodkan"), `${qty} × RM ${rmBare(Math.round(sale! * 100))} ${L("— counted in total sales", "— dikira dalam jumlah jualan")}${level}`);
    else invToast(dir === "in" ? L("Stock in recorded", "Stok masuk direkodkan") : L("Stock out recorded", "Stok keluar direkodkan"), `${qty} pcs${level} ${L("— logged with your remark", "— dilog dengan catatan anda")}`);
    void load();
    return true;
  };
  // v1.4.170: natural SKU compare — ELFIA001 < ELFIA002 < … < ELFIA012.
  // v1.22.7: null-safe — ONE item saved without a SKU used to crash the whole
  // portal here ("Application error" for anyone whose last tab was Inventory).
  const bySku = (a: { sku: string | null }, b: { sku: string | null }) => (a.sku ?? "").localeCompare(b.sku ?? "", undefined, { numeric: true, sensitivity: "base" });
  const maxStock = Math.max(1, ...items.map((x) => x.stock)); // v1.4.270 row bars
  const sortedItems = [...items].sort((a, b) => {
    const dir = invSort.asc ? 1 : -1;
    switch (invSort.col) {
      case "sku":   return dir * bySku(a, b);
      case "name":  return dir * (a.name ?? "").localeCompare(b.name ?? "");
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
      case "name":  return dir * (a.name ?? "").localeCompare(b.name ?? "");
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
    const [i, p, m, r, t, mo, bh] = await Promise.all([
      api<{ items: InvItem[] }>(`/inventory`),
      api<{ records: PostRec[] }>(`/postage`),
      api<{ materials: Material[] }>(`/materials`),
      api<{ returns: SupplierReturn[]; totals: { total_cents: number; credited_cents: number; replaced_cents?: number; outstanding_cents: number } }>(`/inventory/returns`),
      api<{ items: TtOut[] }>(`/inventory/tiktok-out`), // v1.4.165
      api<{ outs: ManualOut[] }>(`/inventory/manual-outs`), // v1.4.170
      api<BridgeHealth>(`/inventory/bridge-health`), // v1.36.0
    ]);
    /* v1.22.7 (a staff member's Inventory tab white-screened: "Application
       error: a client-side exception"): D1 can hand back NULL in columns the
       UI treats as text/number — one item saved without a SKU crashed the
       SKU sort and unmounted the entire portal. Every list is sanitised
       HERE, at the boundary, so a bad row can never take the page down. */
    if (i.data?.items) setItems(i.data.items.map((x) => ({ ...x, sku: x.sku ?? "", name: x.name ?? "", stock: Number(x.stock) || 0, status: x.status ?? "" })));
    if (p.data?.records) setPostage(p.data.records.map((x) => ({ ...x, order_ref: x.order_ref ?? "", status: x.status ?? "" })));
    if (m.data?.materials) setMaterials(m.data.materials.map((x) => ({ ...x, title: x.title ?? "", status: x.status ?? "" })));
    if (r.data?.returns) {
      setReturns(r.data.returns.map((x) => ({ ...x, sku: x.sku ?? "", item_name: x.item_name ?? "", qty: Number(x.qty) || 0, supplier: x.supplier ?? "", status: x.status ?? "", return_date: x.return_date ?? "" })));
      setRetTotals(r.data.totals ?? null);
    }
    if (t.data?.items) setTtOut(t.data.items.map((x) => ({ ...x, sku: x.sku ?? "", name: x.name ?? "", stock: Number(x.stock) || 0, today_qty: Number(x.today_qty) || 0, month_qty: Number(x.month_qty) || 0, total_qty: Number(x.total_qty) || 0 })));
    if (mo.data?.outs) setManualOuts(mo.data.outs.map((x) => ({ ...x, sku: x.sku ?? "", item_name: x.item_name ?? "", qty: Number(x.qty) || 0, remark: x.remark ?? "", created_at: x.created_at ?? "" })));
    /* v1.38.1: `if (bh.data)` was wrong — an ERROR body is truthy too, so a
       404 (the API worker being older than this page: the two workers deploy
       independently, AUTO-DEPLOY.md) or a 403 landed here with
       key_configured undefined, and the card announced "Key not set" — a
       specific, confident, WRONG diagnosis that sends someone off to set a
       secret that may already be set. Only a real payload counts as health;
       anything else is "could not ask", said out loud (the run-guards rule:
       a check that cannot run must never read like one that ran). */
    setBridgeHealth(
      bh.ok && bh.data && typeof (bh.data as BridgeHealth).key_configured === "boolean"
        ? (bh.data as BridgeHealth)
        : { unavailable: true, key_configured: false, applied_24h: 0, unknown_24h: 0, unknown: [] },
    );
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load().finally(() => setLoaded(true)); // v1.77.0 — a failed request clears the skeleton too
  }, [load]);

  return (
    <div className="space-y-4 md:space-y-6">
      {invConfirmNode}
      {invToastNode}
      {/* v1.36.0: the ELFIA bridge's pulse — is the store connected, when did
          it last report a sale, and (the part a human must act on) SKUs it
          sent that the portal does not hold. Compact strip, reads before the
          table like the status strip above it. */}
      {/* v1.77.0 — skeleton until the first fetch lands: the strip's real
          card so the table below does not jump up when the pulse arrives. */}
      {!loaded && (
        <div className={card} aria-hidden>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Skel className="h-4 w-24" />
            <Skel className="h-3 w-40" />
            <Skel className="h-3 w-24" />
            <Skel className="h-3 w-36" />
          </div>
        </div>
      )}
      {bridgeHealth && (
        <div className={card}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold">{L("ELFIA bridge", "Jambatan ELFIA")}</span>
            {bridgeHealth.unavailable && (
              <span className="text-muted-foreground">
                {L("Status unavailable — this page could not reach the bridge route. Usually the API worker is older than the site (they deploy separately): deploy azoneofficial-api, then reload.",
                   "Status tidak tersedia — halaman ini tidak dapat menghubungi laluan jambatan. Biasanya pekerja API lebih lama daripada laman (ia digunakan secara berasingan): deploy azoneofficial-api, kemudian muat semula.")}
              </span>
            )}
            {!bridgeHealth.unavailable && !bridgeHealth.key_configured && (
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {L("Key not set — the store cannot connect (ELFIA_BRIDGE_KEY)", "Kunci belum ditetapkan — kedai tidak boleh sambung (ELFIA_BRIDGE_KEY)")}
              </span>
            )}
            {!bridgeHealth.unavailable && bridgeHealth.key_configured && bridgeHealth.pending_migration && (
              <span className="text-muted-foreground">{L("Waiting for migration 0078", "Menunggu migrasi 0078")}</span>
            )}
            {!bridgeHealth.unavailable && bridgeHealth.key_configured && !bridgeHealth.pending_migration && (
              <>
                <span className="text-muted-foreground">
                  {L("Last sale reported:", "Jualan terakhir dilaporkan:")}{" "}
                  {bridgeHealth.last_event_at ? bridgeHealth.last_event_at.slice(0, 16) : L("never", "belum ada")}
                </span>
                <span className="text-muted-foreground">
                  {L("Applied 24h:", "Digunakan 24j:")} {bridgeHealth.applied_24h}
                </span>
                <span className="text-muted-foreground">
                  {L("Orders pulled:", "Pesanan ditarik:")}{" "}
                  {bridgeHealth.last_poll_at ? bridgeHealth.last_poll_at.slice(0, 16) : L("never", "belum ada")}
                </span>
              </>
            )}
          </div>
          {bridgeHealth.unknown.length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-700 dark:bg-amber-950/40">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                {L("The store sent SKUs the portal does not hold — these sales are NOT deducted until a human resolves them:", "Kedai menghantar SKU yang tiada dalam portal — jualan ini TIDAK ditolak sehingga diselesaikan:")}
              </p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {bridgeHealth.unknown.map((u) => (
                  <li key={u.sku} className="rounded border border-amber-300 px-1.5 py-0.5 font-mono text-xs dark:border-amber-700">
                    {u.sku} ×{u.n}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs">
                {L("Fix: rename the item's SKU here to match the store (Edit), or add the item — the store retries nothing; reconcile the count manually after.", "Penyelesaian: namakan semula SKU barang di sini agar sepadan dengan kedai (Sunting), atau tambah barang itu — kedai tidak mencuba semula; selaraskan kiraan secara manual selepas itu.")}
              </p>
            </div>
          )}
        </div>
      )}
      {/* v1.4.170 (CEO): manual stock-out MODAL — pick SKU/item, quantity,
          optional Sold @ (makes it a sale in the totals), and a MANDATORY
          remark for traceability. House card pattern + save-toast. */}
      {outModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOutModal(null)}>
          <div className="bg-background w-full max-w-md rounded-xl border p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">
              {outModal.edit_id ? L("Edit manual stock movement", "Sunting pergerakan stok manual") : outModal.dir === "in" ? L("Manual stock in", "Stok masuk manual") : L("Manual stock out", "Stok keluar manual")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("The reason is required — every manual movement is logged with who, when and why.", "Sebab diperlukan — setiap pergerakan manual dilog dengan siapa, bila dan mengapa.")}{outModal.dir === "out" ? L(" Fill Sold @ only when this out is a sale", " Isi Dijual @ hanya apabila keluaran ini adalah jualan") : ""}
              {outModal.edit_id ? L("; clearing it removes the sale from the totals. A qty change moves stock by the difference.", "; mengosongkannya membuang jualan itu daripada jumlah. Perubahan kuantiti menggerakkan stok mengikut perbezaannya.") : "."}
            </p>
            <div className="mt-3 space-y-2">
              <SubR t={L("SKU · Item", "SKU · Barang")}>
                <select className={inputClass} value={outModal.item_id} disabled={!!outModal.edit_id}
                  title={outModal.edit_id ? L("The item can't change on an existing record — delete and re-record instead", "Barang tidak boleh ditukar pada rekod sedia ada — padam dan rekod semula") : undefined}
                  onChange={(e) => setOutModal((m) => m && ({ ...m, item_id: Number(e.target.value) }))}>
                  {[...items].sort(bySku).map((it) => (
                    <option key={it.id} value={it.id}>{it.sku} · {it.name} ({it.stock} {L("in stock", "dalam stok")})</option>
                  ))}
                </select>
              </SubR>
              <div className="grid grid-cols-2 gap-2">
                <SubR t={outModal.dir === "in" ? L("Quantity in", "Kuantiti masuk") : L("Quantity out", "Kuantiti keluar")}>
                  <input type="number" min={1} className={inputClass} value={outModal.qty}
                    onChange={(e) => setOutModal((m) => m && ({ ...m, qty: e.target.value }))} />
                </SubR>
                {/* nothing is sold on the way IN, so the price box only exists
                    on an out (v1.4.169: a price is what makes an out a sale). */}
                {outModal.dir === "out" ? (
                  <SubR t={L("Sold @ (RM/unit, optional)", "Dijual @ (RM/unit, pilihan)")}>
                    <input type="number" min={0} step="0.01" className={inputClass} placeholder={L("empty = correction", "kosong = pembetulan")}
                      value={outModal.price}
                      onChange={(e) => setOutModal((m) => m && ({ ...m, price: e.target.value }))} />
                  </SubR>
                ) : <span />}
              </div>
              {/* v1.4.172 (CEO): the DATE the stock went out — backdatable;
                  sales totals follow this date. */}
              <SubR t={outModal.dir === "in" ? L("Date of stock in", "Tarikh stok masuk") : L("Date of stock out", "Tarikh stok keluar")}>
                <input type="date" className={`${inputClass} sm:max-w-44`} value={outModal.out_date}
                  onChange={(e) => setOutModal((m) => m && ({ ...m, out_date: e.target.value }))} />
              </SubR>
              {/* v1.4.251: a picked reason, so a stock-count variance is
                  always worded the same way and can be reported on later;
                  the note underneath carries the specifics. */}
              {!outModal.edit_id && (
                <SubR t={L("Reason *", "Sebab *")}>
                  <select className={inputClass} value={outModal.reason}
                    onChange={(e) => setOutModal((m) => m && ({ ...m, reason: e.target.value }))}>
                    <option value="">{L("— pick a reason —", "— pilih sebab —")}</option>
                    {REASONS[outModal.dir].map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
                  </select>
                </SubR>
              )}
              <SubR t={outModal.edit_id ? L("Remark *", "Catatan *") : L("Note — the specifics (optional)", "Nota — butiran (pilihan)")}>
                <textarea className={inputClass} rows={2}
                  placeholder={outModal.edit_id ? L("Reason for this movement", "Sebab pergerakan ini")
                    : outModal.dir === "in" ? L("e.g. counted 21, system said 20 — 1 found on the top shelf", "cth. kira 21, sistem kata 20 — 1 dijumpai di rak atas")
                    : L("e.g. counted 19, system said 21 — 2 missing after the JB event", "cth. kira 19, sistem kata 21 — 2 hilang selepas acara JB")}
                  value={outModal.remark}
                  onChange={(e) => setOutModal((m) => m && ({ ...m, remark: e.target.value }))} />
              </SubR>
              <div className="flex items-center gap-2">
                <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
                  onClick={async () => {
                    const qtyN = Math.floor(Number(outModal.qty));
                    if (!qtyN || qtyN <= 0) { invToast(L("Not saved", "Tidak disimpan"), L("Quantity must be at least 1", "Kuantiti mesti sekurang-kurangnya 1"), "notice"); return; }
                    if (!outModal.edit_id && !outModal.reason) { invToast(L("Not saved", "Tidak disimpan"), L("Pick a reason — it is what makes the movement traceable", "Pilih sebab — itulah yang menjadikan pergerakan boleh dijejak"), "notice"); return; }
                    if (outModal.edit_id && !outModal.remark.trim()) { invToast(L("Not saved", "Tidak disimpan"), L("The remark (reason) is required for traceability", "Catatan (sebab) diperlukan untuk kebolehjejakan"), "notice"); return; }
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
                    if (!res.ok) { invToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Edit failed", "Suntingan gagal"), "notice"); return; }
                    invToast(L("Saved", "Disimpan"), L("Stock-out record updated — stock and sales totals adjusted", "Rekod stok keluar dikemas kini — stok dan jumlah jualan dilaraskan"));
                    setOutModal(null);
                    void load();
                  }}>
                  {outModal.edit_id ? L("Save changes", "Simpan perubahan") : outModal.dir === "in" ? L("Record stock in", "Rekod stok masuk") : L("Record stock out", "Rekod stok keluar")}
                </button>
                <button type="button" className="text-xs underline" onClick={() => setOutModal(null)}>{L("Cancel", "Batal")}</button>
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
          <p className="text-sm font-semibold">{L("Inventory — live status & stock", "Inventori — status semasa & stok")}</p>
          {/* v1.4.229 (CEO: "csv button to download the inventory list for
              me to perform Stock Count"): client-side CSV of the current
              list in its on-screen sort, PLUS the three columns a physical
              stock count needs — Counted qty / Variance / Note — left
              blank for the person walking the shelves. */}
          <button type="button" className="border-border inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium hover:bg-secondary"
            onClick={() => {
              /* v1.74.0: was a hand-rolled CSV with its own escaper. Same
                 file, now through the one builder — rows of CELLS rather
                 than pre-joined strings, which is what lets the builder
                 quote correctly and defuse a leading =, + or @ that Excel
                 would otherwise run as a formula. */
              const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
              const rows: (string | number)[][] = [
                [`# ${DOCUMENT_ISSUER.name} — ${L("Inventory stock count sheet", "Helaian kiraan stok inventori")}`],
                [`# ${L("Generated", "Dijana")} ${csvStampMyt()} ${L("— system stock as of this moment; count, write Counted qty, note variances", "— stok sistem pada saat ini; kira, tulis Kuantiti dikira, catat varians")}`],
                ["SKU", L("Item", "Barang"), L("Price/unit (RM)", "Harga/unit (RM)"), L("Live rebate (RM)", "Rebat live (RM)"), L("Net (RM)", "Bersih (RM)"), L("System stock", "Stok sistem"), "Status", L("Counted qty", "Kuantiti dikira"), L("Variance", "Varians"), L("Note", "Nota")],
              ];
              let units = 0;
              for (const it of sortedItems) {
                const price = it.unit_price_cents ?? 0;
                const rebate = it.live_rebate_cents ?? 0;
                const net = Math.max(0, price - rebate);
                units += it.stock;
                rows.push([
                  it.sku, it.name, rmBare(price),
                  rebate > 0 ? `-${rmBare(rebate)}` : "",
                  rmBare(net), it.stock, it.status ?? "", "", "", "",
                ]);
              }
              rows.push([L("TOTAL", "JUMLAH"), "", "", "", "", units, "", "", "", ""]);
              downloadCsv(`azoo-stock-count-${now.slice(0, 10)}`, rows);
            }}>
            {L("⬇ CSV — stock count", "⬇ CSV — kiraan stok")}
          </button>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Stock moves automatically: a postage record with an item deducts it; a returned shipment adds it back. Use In/Out for manual corrections. Status recomputes on every movement (0 = out of stock · ≤5 = low).", "Stok bergerak secara automatik: rekod pos dengan barang menolaknya; penghantaran yang dipulangkan menambahnya semula. Guna In/Out untuk pembetulan manual. Status dikira semula pada setiap pergerakan (0 = habis stok · ≤5 = rendah).")}
        </p>
        {invMsg && <p className="text-destructive mt-1 text-xs font-medium">{invMsg}</p>}
        {/* v1.4.150: app-standard widths — a 2-up grid on phones (full-width
            fields, full-width button), the tidy inline row from sm: up. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <SubR t="SKU">
            <input className={`${inputClass} sm:max-w-40`} placeholder={L("must match TikTok", "mesti sepadan dengan TikTok")} value={invDraft.sku}
              onChange={(e) => setInvDraft((d) => ({ ...d, sku: e.target.value }))} />
          </SubR>
          <SubR t={L("Item name", "Nama barang")}>
            <input className={`${inputClass} sm:max-w-56`} placeholder={L("e.g. Tudung Sarah XL", "cth. Tudung Sarah XL")} value={invDraft.name}
              onChange={(e) => setInvDraft((d) => ({ ...d, name: e.target.value }))} />
          </SubR>
          <SubR t={L("Opening stock", "Stok permulaan")}>
            <input type="number" min={0} className={`${inputClass} sm:max-w-24`} title={L("Opening stock", "Stok permulaan")} value={invDraft.stock}
              onChange={(e) => setInvDraft((d) => ({ ...d, stock: Number(e.target.value) }))} />
          </SubR>
          <SubR t={L("Price/unit (RM)", "Harga/unit (RM)")}>
            <input type="number" min={0} step="0.01" className={`${inputClass} sm:max-w-32`} placeholder="0.00" value={invDraft.unit_price}
              onChange={(e) => setInvDraft((d) => ({ ...d, unit_price: e.target.value }))} />
          </SubR>
          <button type="button" className={`${btnClass} col-span-2 justify-center sm:col-span-1 sm:h-[38px] sm:justify-start`}
            onClick={async () => {
              await api(`/inventory`, { method: "POST", body: JSON.stringify({ ...invDraft, unit_price: Number(invDraft.unit_price) || 0 }) });
              setInvDraft({ sku: "", name: "", stock: 0, unit_price: "" });
              void load();
            }}>
            {L("Add item", "Tambah barang")}
          </button>
        </div>
        {/* v1.77.0 — skeleton until the first fetch lands: the stock table's
            ten columns, so "No items yet" is never shown for a list still loading. */}
        {!loaded && (
          <div className="mt-3 overflow-x-auto pr-1">
            <SkelTable rows={6} cols={10} className="min-w-[920px]" />
          </div>
        )}
        {loaded && items.length === 0 && (
          <p className="text-muted-foreground mt-3 text-sm">{L("No items yet — add your first above; TikTok orders will start moving its stock automatically.", "Tiada barang lagi — tambah yang pertama di atas; pesanan TikTok akan mula menggerakkan stoknya secara automatik.")}</p>
        )}
        {items.length > 0 && (
        <>
        {/* v1.4.199 (CEO): pills removed — click the SKU / Item headers to
            sort, click again to reverse. */}
        <div className="mt-3 max-h-96 overflow-x-auto overflow-y-auto pr-1">
          <table className="tbl-sticky w-full min-w-[920px] border-collapse">
            <thead>
              <tr className="border-border border-b">
                {/* v1.4.281: all columns are sortable — click to asc, click again to desc */}
                {([
                  ["sku",  "SKU",               th],
                  ["name", L("Item", "Barang"),              th],
                ] as [string, string, string][]).map(([col, label, cls]) => (
                  <th key={col} className={`${cls} cursor-pointer select-none whitespace-nowrap`}
                    title={`${L("Sort by", "Susun ikut")} ${label} ${L("— click again to reverse", "— klik lagi untuk terbalik")}`}
                    onClick={() => cycleInv(col as "sku" | "name")}>
                    {label}{invSort.col === col ? (invSort.asc ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th className={`${thR2} cursor-pointer select-none whitespace-nowrap`}
                  title={L("Sort by price — click again to reverse", "Susun ikut harga — klik lagi untuk terbalik")}
                  onClick={() => cycleInv("price")}>
                  {L("Price/unit", "Harga/unit")}{invSort.col === "price" ? (invSort.asc ? " ▲" : " ▼") : ""}
                </th>
                {/* v1.4.166: rebate is AUTO — list price − the actual sold
                    price from the latest TikTok firm order (never typed in) */}
                <th className={thR2}>{L("Live rebate (auto)", "Rebat live (auto)")}</th>
                <th className={`${thR2} cursor-pointer select-none whitespace-nowrap`}
                  title={L("Sort by net (live) price — click again to reverse", "Susun ikut harga bersih (live) — klik lagi untuk terbalik")}
                  onClick={() => cycleInv("net")}>
                  {L("Net (live)", "Bersih (live)")}{invSort.col === "net" ? (invSort.asc ? " ▲" : " ▼") : ""}
                </th>
                {/* v1.35.0: which items the ELFIA store sees, and its web
                    price. Tick = published (stock + price sync every 5 min);
                    price empty = the shop charges the list price/unit. The
                    live rebate NEVER applies online. */}
                <th className={th} title={L("Publish to the ELFIA web store — it pulls stock and price every 5 minutes", "Terbit ke kedai web ELFIA — ia menarik stok dan harga setiap 5 minit")}>
                  {L("ELFIA web", "Web ELFIA")}
                </th>
                <th className={`${thR2} cursor-pointer select-none whitespace-nowrap`}
                  title={L("Sort by stock qty — click again to reverse", "Susun ikut kuantiti stok — klik lagi untuk terbalik")}
                  onClick={() => cycleInv("stock")}>
                  {L("Stock", "Stok")}{invSort.col === "stock" ? (invSort.asc ? " ▲" : " ▼") : ""}
                </th>
                <th className={th}>Status</th>
                {/* v1.4.162: these two columns had no subheads (CEO spotted it) */}
                <th className={th}>{L("Manual in / out", "Masuk / keluar manual")}</th><th className={th}>{L("Actions", "Tindakan")}</th>
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
                          title={L("SKU — must match TikTok (or the item name will be used to match)", "SKU — mesti sepadan dengan TikTok (atau nama barang akan digunakan untuk padanan)")}
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
                      title={L("Price per unit (RM) — saves on change", "Harga seunit (RM) — disimpan apabila diubah")}
                      defaultValue={it.unit_price_cents ? rmBare(it.unit_price_cents) : ""}
                      onBlur={async (e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v < 0 || Math.round(v * 100) === (it.unit_price_cents ?? 0)) return;
                        await api(`/inventory/${it.id}`, { method: "PATCH", body: JSON.stringify({ stock: it.stock, unit_price: v }) });
                        void load();
                      }} />
                  </td>
                  <td className={tdR2}
                    title={L("AUTO — computed from the latest TikTok firm order: list price − actual sold price. Updates itself as orders sync; not manually editable (per the CEO, v1.4.166).", "AUTO — dikira daripada pesanan TikTok muktamad terkini: harga senarai − harga jualan sebenar. Dikemas kini sendiri apabila pesanan disegerak; tidak boleh disunting secara manual (arahan CEO, v1.4.166).")}>
                    {it.live_rebate_cents
                      ? <span className="font-medium text-amber-700 dark:text-amber-400">− {rmBare(it.live_rebate_cents)}</span>
                      : <span className="text-muted-foreground text-xs">auto</span>}
                  </td>
                  <td className={`${tdR2} font-medium ${it.live_rebate_cents ? "text-green-700 dark:text-green-400" : ""}`}
                    title={L("Effective price during TikTok Live = price/unit − live rebate", "Harga efektif semasa TikTok Live = harga/unit − rebat live")}>
                    {(() => { const n = Math.max(0, (it.unit_price_cents ?? 0) - (it.live_rebate_cents ?? 0)); return rmBare(n); })()}
                  </td>
                  {/* v1.35.0: ELFIA bridge controls. The checkbox saves at
                      once; the web-price box saves on blur like the price
                      column, and shows the LIST price greyed as a placeholder
                      so "what will the shop charge" is answered either way. */}
                  <td className={td}>
                    <span className="flex items-center gap-1.5">
                      <input type="checkbox" checked={(it.bridge_enabled ?? 0) === 1}
                        title={L("Publish this item to the ELFIA web store", "Terbitkan barang ini ke kedai web ELFIA")}
                        onChange={async (e) => {
                          const on = e.target.checked;
                          const res = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/bridge`, {
                            method: "PATCH", body: JSON.stringify({ bridge_enabled: on }),
                          });
                          if (!res.ok) { invToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice"); return; }
                          invToast(L("Saved", "Disimpan"), on
                            ? `${it.sku} ${L("now published to the ELFIA store", "kini diterbitkan ke kedai ELFIA")}`
                            : `${it.sku} ${L("withdrawn from the ELFIA store", "ditarik daripada kedai ELFIA")}`);
                          void load();
                        }} />
                      {(it.bridge_enabled ?? 0) === 1 && (
                        <input type="number" min={0} step="0.01"
                          className="border-input bg-background w-20 rounded border px-1.5 py-0.5 text-right text-xs"
                          placeholder={it.unit_price_cents ? rmBare(it.unit_price_cents) : "0.00"}
                          title={L("Web price (RM) — what the ELFIA store charges. Empty = the list price/unit. The live rebate never applies online.", "Harga web (RM) — yang dicaj oleh kedai ELFIA. Kosong = harga senarai/unit. Rebat live tidak sekali-kali terpakai dalam talian.")}
                          defaultValue={it.elfia_price_cents ? rmBare(it.elfia_price_cents) : ""}
                          onBlur={async (e) => {
                            const raw = e.target.value.trim();
                            const cur = it.elfia_price_cents ?? null;
                            const next = raw === "" ? null : Math.round(Number(raw) * 100);
                            if (raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) <= 0)) {
                              invToast(L("Not saved", "Tidak disimpan"), L("Web price must be a positive RM amount — or empty to use the list price", "Harga web mesti amaun RM positif — atau kosong untuk guna harga senarai"), "notice");
                              return;
                            }
                            if (next === cur) return;
                            const res = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/bridge`, {
                              method: "PATCH", body: JSON.stringify({ elfia_price: raw === "" ? "" : Number(raw) }),
                            });
                            if (!res.ok) { invToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice"); return; }
                            invToast(L("Saved", "Disimpan"), next === null
                              ? `${it.sku} — ${L("web price cleared, the shop charges the list price", "harga web dikosongkan, kedai mencaj harga senarai")}`
                              : `${it.sku} — ${L("web price", "harga web")} RM ${rmBare(next)}`);
                            void load();
                          }} />
                      )}
                    </span>
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
                        title={L("Stock in — opens the form (reason required for traceability)", "Stok masuk — buka borang (sebab diperlukan untuk kebolehjejakan)")}
                        onClick={() => setOutModal({ dir: "in", edit_id: null, item_id: it.id, qty: String(adjQty[it.id] ?? 1), price: "", reason: "", remark: "", out_date: todayMYT() })}>In +</button>
                      {/* v1.4.170 (CEO): Out goes through the modal — item,
                          qty, optional Sold @, MANDATORY remark. */}
                      <button type="button" className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                        title={L("Stock out — opens the form (remark required for traceability)", "Stok keluar — buka borang (catatan diperlukan untuk kebolehjejakan)")}
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
                              if (!sku || !name) { invToast(L("No changes", "Tiada perubahan"), L("SKU and item name are both required", "SKU dan nama barang kedua-duanya diperlukan"), "notice"); return; }
                              if (sku === it.sku && name === it.name) { invToast(L("No changes", "Tiada perubahan"), L("Nothing was edited", "Tiada apa yang disunting"), "notice"); setInvEditId(null); return; }
                              const res = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/edit`, {
                                method: "POST", body: JSON.stringify({ sku, name }),
                              });
                              if (!res.ok) { invToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Edit failed", "Suntingan gagal"), "notice"); return; }
                              invToast(L("Saved", "Disimpan"), `${sku} — ${name} ${L("updated", "dikemas kini")}`);
                              setInvEditId(null);
                              void load();
                            }}>{L("Save", "Simpan")}</button>
                          <button type="button" className="text-xs underline" onClick={() => setInvEditId(null)}>{L("Cancel", "Batal")}</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className={rowBtn} title={L("Edit SKU / item name", "Sunting SKU / nama barang")}
                            onClick={() => { setInvEditId(it.id); setInvEditDraft({ sku: it.sku, name: it.name }); }}>{L("Edit", "Sunting")}</button>
                          <button type="button" className={rowBtnDanger} title={L("Delete a wrongly inserted item", "Padam barang yang tersalah masuk")}
                            onClick={async () => {
                              if (!(await invConfirm({
                                title: L("Delete this item?", "Padam barang ini?"),
                                message: `${it.sku} — ${it.name} (${it.stock} ${L("in stock", "dalam stok")}) ${L("will be removed from the stock list. Items with shipment or supplier-return history can't be deleted — edit those instead.", "akan dibuang daripada senarai stok. Barang dengan sejarah penghantaran atau pemulangan pembekal tidak boleh dipadam — sunting sahaja.")}`,
                                confirmLabel: L("Delete item", "Padam barang"), variant: "danger",
                              }))) return;
                              const res = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/delete`, { method: "POST", body: JSON.stringify({}) });
                              if (!res.ok) { invToast(L("Not deleted", "Tidak dipadam"), res.data?.error?.message ?? L("Delete failed", "Padaman gagal"), "notice"); return; }
                              invToast(L("Deleted", "Dipadam"), `${it.sku} — ${it.name} ${L("removed", "dibuang")}`);
                              void load();
                            }}>{L("Delete", "Padam")}</button>
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
                    <td className={td} colSpan={2}>{L("TOTAL — stock on hand", "JUMLAH — stok dalam tangan")}</td>
                    <td className={tdR2} title={L("Σ stock × price/unit — the value sitting in stock at list price", "Σ stok × harga/unit — nilai stok pada harga senarai")}>
                      RM {rmBare(tot.value)}
                    </td>
                    <td className={td}></td>
                    <td className={`${tdR2} text-green-700 dark:text-green-400`}
                      title={L("Σ stock × net (live) — what clearing everything on TikTok Live would bring in after the auto rebates", "Σ stok × bersih (live) — hasil jika semuanya dijual habis di TikTok Live selepas rebat auto")}>
                      RM {rmBare(tot.net)}
                    </td>
                    <td className={td}></td>{/* v1.35.0: ELFIA column */}
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
        <p className="text-sm font-semibold">{L("📉 TikTok Live — stock out", "📉 TikTok Live — stok keluar")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Units deducted by TikTok orders, per item — so you can see what moved during today's live and across the month. Counted from the actual stock movements (returned orders excluded). \"Avg sold @\" is the real price buyers paid (TikTok sale price) — the amber figure beside it is the auto-computed rebate vs your list price.", "Unit yang ditolak oleh pesanan TikTok, mengikut barang — supaya anda nampak apa yang bergerak semasa live hari ini dan sepanjang bulan. Dikira daripada pergerakan stok sebenar (pesanan dipulangkan dikecualikan). \"Avg sold @\" ialah harga sebenar yang dibayar pembeli (harga jualan TikTok) — angka kuning di sebelahnya ialah rebat auto berbanding harga senarai anda.")}
        </p>
        {/* v1.77.0 — skeleton until the first fetch lands (nine columns, like the real table). */}
        {!loaded ? (
          <div className="mt-3 overflow-x-auto pr-1">
            <SkelTable rows={4} cols={9} className="min-w-[560px]" />
          </div>
        ) : ttOut.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {L("No TikTok stock movements yet — they appear here as soon as an order deducts stock (SKU or item-name match).", "Tiada pergerakan stok TikTok lagi — ia muncul di sini sebaik sahaja pesanan menolak stok (padanan SKU atau nama barang).")}
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
                    ["name",  L("Item", "Barang"),      th],
                    ["hot",   L("Out today", "Keluar hari ini"), thR2],
                    ["month", L("This month", "Bulan ini"), thR2],
                    ["total", L("All time", "Sepanjang masa"),  thR2],
                    ["price", L("Avg sold @", "Purata dijual @"), thR2],
                    ["value", L("Sold value (month)", "Nilai jualan (bulan)"), thR2],
                    ["stock", L("Left in stock", "Baki stok"), thR2],
                    ["last",  L("Last order", "Pesanan terakhir"), thR2],
                  ] as [TtCol, string, string][]).map(([col, label, cls]) => (
                    <th key={col} className={`${cls} cursor-pointer select-none whitespace-nowrap`}
                      title={`${L("Sort by", "Susun ikut")} ${label} ${L("— click again to reverse", "— klik lagi untuk terbalik")}`}
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
                      title={t.avg_sale_cents != null && t.unit_price_cents ? `${L("List", "Senarai")} RM ${rmBare(t.unit_price_cents)} − ${L("sold", "dijual")} RM ${rmBare(t.avg_sale_cents)} = ${L("rebate", "rebat")} RM ${rmBare(Math.max(0, (t.unit_price_cents ?? 0) - t.avg_sale_cents))}/unit` : L("No sold price captured yet — arrives with the next synced order", "Tiada harga jualan direkod lagi — tiba dengan pesanan segerak seterusnya")}>
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
                      <td className={td} colSpan={2}>{L("TOTAL", "JUMLAH")}</td>
                      <td className={tdR2}>{today > 0 ? <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold whitespace-nowrap text-green-800">🔥 {today}</span> : "—"}</td>
                      <td className={tdR2}>{month}</td>
                      <td className={tdR2}>{all}</td>
                      <td className={tdR2} title={L("Weighted by units sold (Σ price × qty ÷ Σ qty)", "Wajaran mengikut unit dijual (Σ harga × kuantiti ÷ Σ kuantiti)")}>{wAvg != null ? `RM ${rmBare(wAvg)}` : "—"}</td>
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
        <p className="text-sm font-semibold">{L("🛠 Manual stock movements — traceability", "🛠 Pergerakan stok manual — kebolehjejakan")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Every manual In + and Out − with its reason, recorded by whom and when. Rows with a sold price also count in Total sales (Manual sales channel); rows without are corrections — excluded from sales by design. To settle a stock count, record the difference here: pick", "Setiap In + dan Out − manual dengan sebabnya, direkodkan oleh siapa dan bila. Baris dengan harga jualan turut dikira dalam Jumlah jualan (saluran jualan Manual); baris tanpa harga ialah pembetulan — dikecualikan daripada jualan secara reka bentuk. Untuk menyelesaikan kiraan stok, rekodkan perbezaannya di sini: pilih")}
          <span className="font-medium"> {L("Stock count variance", "Varians kiraan stok")}</span> {L("and write what you counted against what the system said.", "dan tulis apa yang anda kira berbanding apa yang sistem kata.")}
        </p>
        {/* v1.77.0 — skeleton until the first fetch lands: the collapsed
            toggle line the real card opens with. */}
        {!loaded ? (
          <Skel className="mt-3 h-4 w-40" />
        ) : manualOuts.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">{L("No manual stock outs yet — they appear here the moment one is recorded.", "Tiada stok keluar manual lagi — ia muncul di sini sebaik sahaja direkodkan.")}</p>
        ) : (
          /* v1.4.196 (CEO): audit-trail rows hide behind one click — minimalist view */
          <DetailsToggle label={`${L("Show records", "Tunjuk rekod")} (${manualOuts.length})`}>
          <div className="mt-1 max-h-72 space-y-0 overflow-y-auto pr-1">
            {manualOuts.map((o) => (
              <div key={o.id} className={`border-border border-b py-1.5 text-sm last:border-0 ${o.reverted ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <span className={`min-w-0 ${o.reverted ? "line-through" : ""}`}>
                  {/* v1.4.172: the movement DATE leads (backdatable) and, with
                      the SKU, is what identifies the row — v1.4.252 makes the
                      pair the toggle so the item, reason and who recorded it
                      open underneath instead of being truncated away. */}
                  <RecordToggle open={openMove === o.id} title={L("Item, reason, and who recorded it", "Barang, sebab, dan siapa yang merekodkannya")}
                    onToggle={() => setOpenMove(openMove === o.id ? null : o.id)}>
                    {o.out_date ? dmy(o.out_date) : dmyMYT(o.created_at)} · {o.sku}
                  </RecordToggle>
                  {/* v1.4.251: direction is the first thing you should see */}
                  <span className={o.direction === "in" ? "font-medium text-green-700" : ""}> · {o.direction === "in" ? "+" : "−"}{o.qty} pcs</span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  {o.reverted ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">{L("↩ reverted — stock restored", "↩ dikembalikan — stok dipulihkan")}</span>
                  ) : o.unit_sale_cents != null
                    ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">{L("Sold @ RM", "Dijual @ RM")} {rmBare(o.unit_sale_cents)}</span>
                    : <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">{L("correction", "pembetulan")}</span>}
                  {o.created_by_name && <span className="text-muted-foreground text-[10px]">{L("by", "oleh")} {o.created_by_name.split(" ")[0]}</span>}
                  {/* v1.4.172: lifecycle — Edit / ↩ Revert (keeps the row for
                      the audit trail) / Delete (wrong record: stock back +
                      sale removed + row gone). */}
                  {!o.reverted && (
                    <>
                      <button type="button" className={rowBtn} title={L("Edit qty / Sold @ / remark / date — stock and sales totals follow", "Sunting kuantiti / Dijual @ / catatan / tarikh — stok dan jumlah jualan mengikut")}
                        onClick={() => setOutModal({
                          dir: (o as ManualOut & { direction?: string }).direction === "in" ? "in" : "out",
                          edit_id: o.id, item_id: o.item_id, qty: String(o.qty),
                          price: o.unit_sale_cents != null ? rmBare(o.unit_sale_cents) : "",
                          reason: "", remark: o.remark, out_date: (o.out_date ?? o.created_at.slice(0, 10)),
                        })}>{L("Edit", "Sunting")}</button>
                      <button type="button" className={rowBtn} title={L("Put the stock back on the shelf; a sale is removed from the totals; the row stays for the audit trail", "Kembalikan stok ke rak; jualan dibuang daripada jumlah; baris kekal untuk jejak audit")}
                        onClick={async () => {
                          if (!(await invConfirm({
                            title: L("Revert this stock out?", "Kembalikan stok keluar ini?"),
                            message: `${o.qty} × ${o.sku} ${L("goes back into stock", "kembali ke dalam stok")}${o.unit_sale_cents != null ? ` ${L("and the", "dan jualan")} RM ${rmBare(o.unit_sale_cents * o.qty)} ${L("sale is removed from the totals", "dibuang daripada jumlah")}` : ""}${L(". The record stays here marked ↩ reverted.", ". Rekod kekal di sini bertanda ↩ dikembalikan.")}`,
                            confirmLabel: L("Revert", "Kembalikan"),
                          }))) return;
                          const res = await api<{ error?: { message?: string } }>(`/inventory/manual-outs/${o.id}/revert`, { method: "POST", body: JSON.stringify({}) });
                          if (!res.ok) { invToast(L("Not reverted", "Tidak dikembalikan"), res.data?.error?.message ?? L("Revert failed", "Pengembalian gagal"), "notice"); return; }
                          invToast(L("Reverted", "Dikembalikan"), `${o.qty} × ${o.sku} ${L("back in stock", "kembali dalam stok")}`);
                          void load();
                        }}>{L("↩ Revert", "↩ Kembalikan")}</button>
                    </>
                  )}
                  {/* v1.21.7 (CEO: "I want to have access to delete it from my
                      inventory and database. only roles CEO & COO"): Delete is
                      back, gated to CEO/COO (+super_admin). It removes the
                      record and its linked sale from the database — the shelf
                      quantity is NEVER touched (the v1.21.4 rule stands:
                      ↩ Revert is the only way stock moves back). */}
                  {canDeleteMovements && (
                    <button type="button" className={rowBtnDanger} title={L("CEO/COO only: remove this record from the database — stock quantity is NOT changed", "CEO/COO sahaja: buang rekod ini daripada pangkalan data — kuantiti stok TIDAK diubah")}
                      onClick={async () => {
                        if (!(await invConfirm({
                          title: L("Delete this movement record?", "Padam rekod pergerakan ini?"),
                          message: `${L("The record", "Rekod")} (${o.qty} × ${o.sku}${o.unit_sale_cents != null ? ` ${L("and its", "dan jualan")} RM ${rmBare(o.unit_sale_cents * o.qty)}${L(" sale", "")}` : ""}) ${L("is removed from the database permanently. Stock stays exactly as it is — nothing goes back on the shelf. This is logged under your name.", "dibuang daripada pangkalan data secara kekal. Stok kekal seperti sedia ada — tiada apa kembali ke rak. Ini dilog atas nama anda.")}`,
                          confirmLabel: L("Delete record", "Padam rekod"), variant: "danger",
                        }))) return;
                        const res = await api<{ error?: { message?: string } }>(`/inventory/manual-outs/${o.id}/delete`, { method: "POST", body: JSON.stringify({}) });
                        if (!res.ok) { invToast(L("Not deleted", "Tidak dipadam"), res.data?.error?.message ?? L("Delete failed", "Padaman gagal"), "notice"); return; }
                        invToast(L("Deleted", "Dipadam"), L("Record removed — stock untouched", "Rekod dibuang — stok tidak disentuh"));
                        void load();
                      }}>{L("Delete", "Padam")}</button>
                  )}
                </span>
              </div>
              {openMove === o.id && (
                <DetailGrid items={[
                  { label: L("Item", "Barang"), wide: true, value: `${o.sku} — ${o.item_name}` },
                  { label: L("Movement", "Pergerakan"), value: `${o.direction === "in" ? L("Stock in", "Stok masuk") : L("Stock out", "Stok keluar")} · ${o.qty} pcs` },
                  { label: L("Date", "Tarikh"), value: o.out_date ? dmy(o.out_date) : dmyMYT(o.created_at) },
                  { label: L("Sold @", "Dijual @"), value: o.unit_sale_cents != null ? `RM ${rmBare(o.unit_sale_cents)} ${L("— counts as a sale", "— dikira sebagai jualan")}` : L("— correction, not a sale", "— pembetulan, bukan jualan") },
                  { label: L("Recorded by", "Direkod oleh"), value: o.created_by_name ?? "" },
                  { label: L("Recorded at", "Direkod pada"), value: dmyMYT(o.created_at) },
                  { label: L("Reason", "Sebab"), wide: true, value: o.remark },
                  { label: L("State", "Keadaan"), wide: true, value: o.reverted ? L("↩ Reverted — the stock was put back", "↩ Dikembalikan — stok telah dipulangkan") : "" },
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
        <p className="text-sm font-semibold">{L("Supplier returns — rejects to claim back", "Pemulangan pembekal — barang ditolak untuk dituntut semula")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Record rejected/defective items sent back to the supplier. Stock is deducted on record. The supplier settles either way: mark the row credited when money comes back, or replaced when replacement goods arrive (stock returns automatically) — the outstanding figure is what the supplier still owes the company.", "Rekod barang ditolak/cacat yang dihantar semula kepada pembekal. Stok ditolak semasa direkod. Pembekal menyelesaikan sama ada cara: tanda baris sebagai dikredit apabila wang kembali, atau diganti apabila barang gantian tiba (stok kembali secara automatik) — angka tertunggak ialah apa yang pembekal masih berhutang kepada syarikat.")}
        </p>
        {retTotals && retTotals.total_cents > 0 && (
          <div className="border-border bg-secondary/40 mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs">
            <span className="font-semibold">{L("Returned", "Dipulangkan")} {rmR(retTotals.total_cents)}</span>
            <span className="text-green-800">{L("Credited back", "Dikredit semula")} {rmR(retTotals.credited_cents)}</span>
            {(retTotals.replaced_cents ?? 0) > 0 && <span className="text-blue-800">{L("Replaced in goods", "Diganti dalam barangan")} {rmR(retTotals.replaced_cents ?? 0)}</span>}
            <span className={retTotals.outstanding_cents > 0 ? "font-medium text-amber-700" : "text-muted-foreground"}>
              {L("Outstanding", "Tertunggak")} {rmR(retTotals.outstanding_cents)}
            </span>
          </div>
        )}
        {retMsg && <p className="text-destructive mt-1.5 text-xs font-medium">{retMsg}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <SubR t={L("Item", "Barang")} className="col-span-2 sm:col-span-1">
            <select className={`${inputClass} sm:max-w-64`} value={retDraft.item_id}
              onChange={(e) => {
                const id = Number(e.target.value);
                const it = items.find((x) => x.id === id);
                setRetDraft((d) => ({ ...d, item_id: id, unit_cost: it?.unit_price_cents ? rmBare(it.unit_price_cents) : d.unit_cost }));
              }}>
              <option value={0}>{L("Select item…", "Pilih barang…")}</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name} ({it.stock} {L("in stock", "dalam stok")})</option>)}
            </select>
          </SubR>
          <SubR t={L("Qty rejected", "Kuantiti ditolak")}>
            <input type="number" min={1} className={`${inputClass} sm:max-w-24`} value={retDraft.qty}
              onChange={(e) => setRetDraft((d) => ({ ...d, qty: Number(e.target.value) }))} />
          </SubR>
          <SubR t={L("Unit cost (RM)", "Kos seunit (RM)")}>
            <input type="number" min={0} step="0.01" className={`${inputClass} sm:max-w-28`} placeholder="0.00" value={retDraft.unit_cost}
              onChange={(e) => setRetDraft((d) => ({ ...d, unit_cost: e.target.value }))} />
          </SubR>
          <SubR t={L("Supplier", "Pembekal")}>
            <input className={`${inputClass} sm:max-w-44`} placeholder={L("e.g. Tekstil Maju Sdn Bhd", "cth. Tekstil Maju Sdn Bhd")} value={retDraft.supplier}
              onChange={(e) => setRetDraft((d) => ({ ...d, supplier: e.target.value }))} />
          </SubR>
          <SubR t={L("Return date", "Tarikh pemulangan")}>
            <input type="date" className={`${inputClass} sm:max-w-40`} value={retDraft.return_date}
              onChange={(e) => setRetDraft((d) => ({ ...d, return_date: e.target.value }))} />
          </SubR>
          <SubR t={L("Reason (defect etc.)", "Sebab (kecacatan dll.)")} className="col-span-2 sm:col-span-1">
            <input className={`${inputClass} sm:max-w-52`} placeholder={L("e.g. stitching defect, wrong colour", "cth. kecacatan jahitan, warna salah")} value={retDraft.reason}
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
              if (!res.ok) { setRetMsg(res.data?.error?.message ?? L("Could not record the return", "Tidak dapat merekodkan pemulangan")); return; }
              setRetDraft({ item_id: 0, qty: 1, unit_cost: "", supplier: "", reason: "", return_date: "" });
              void load();
            }}>
            {L("Record return", "Rekod pemulangan")}
          </button>
        </div>
        {/* v1.4.196 (CEO): the history list hides behind one click — minimalist view */}
        <DetailsToggle label={L("Returns history", "Sejarah pemulangan")}>
        <div className="mt-1 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {/* v1.77.0 — skeleton until the first fetch lands. */}
          {!loaded && <SkelRows rows={2} />}
          {loaded && returns.length === 0 && <p className="text-muted-foreground text-sm">{L("No supplier returns recorded.", "Tiada pemulangan pembekal direkodkan.")}</p>}
          {returns.map((r) => (
            <div key={r.id} className="border-border border-b py-1.5 text-sm last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                {/* v1.4.252: date + SKU identify the return; the item, supplier
                    and defect reason open underneath. */}
                <RecordToggle open={openRet === r.id} title={L("Item, supplier and the defect reason", "Barang, pembekal dan sebab kecacatan")}
                  onToggle={() => setOpenRet(openRet === r.id ? null : r.id)}>
                  {dmy(r.return_date)} · {r.sku}
                </RecordToggle>
                {" · "}<span className="font-semibold">{rmR(r.total_cents)}</span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                {r.status === "credited" ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    {L("Credited", "Dikredit")} {rmR(r.credited_cents ?? r.total_cents)}
                  </span>
                ) : r.status === "replaced" ? (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                    {L("Replaced", "Diganti")} {r.qty} pcs
                  </span>
                ) : (
                  <>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {L("Outstanding", "Tertunggak")}{(r.replaced_qty ?? 0) > 0 ? ` (${r.replaced_qty}/${r.qty} ${L("replaced", "diganti")})` : ""}
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
                            /* v1.77.0 — money coming back from a supplier,
                               recorded in silence. It says so now. */
                            const res = await api<{ error?: { message?: string } }>(`/inventory/returns/${r.id}/credit`, { method: "POST", body: JSON.stringify({ credited: creditAmt.trim() === "" ? undefined : Number(creditAmt) }) });
                            invToast(res.ok ? L("Credit recorded", "Kredit direkodkan") : L("Not recorded", "Tidak direkodkan"),
                              res.ok ? L("The return is credited against the supplier.", "Pemulangan dikreditkan kepada pembekal.")
                                     : (res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya")),
                              res.ok ? undefined : "notice");
                            setCreditingId(null); setCreditAmt("");
                            void load();
                          }}>
                          {L("Save", "Simpan")}
                        </button>
                        <button type="button" className="text-muted-foreground text-xs underline" onClick={() => { setCreditingId(null); setCreditAmt(""); }}>{L("cancel", "batal")}</button>
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
                            /* v1.77.0 — a replacement moves stock. Silence
                               here meant nobody knew whether it had. */
                            const res = await api<{ error?: { message?: string } }>(`/inventory/returns/${r.id}/replace`, { method: "POST", body: JSON.stringify({ qty: replaceQty.trim() === "" ? undefined : Number(replaceQty) }) });
                            invToast(res.ok ? L("Replacement recorded", "Gantian direkodkan") : L("Not recorded", "Tidak direkodkan"),
                              res.ok ? L("Stock has been put back for the replaced pieces.", "Stok dipulangkan bagi barang yang diganti.")
                                     : (res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya")),
                              res.ok ? undefined : "notice");
                            setReplacingId(null); setReplaceQty("");
                            void load();
                          }}>
                          {L("Save", "Simpan")}
                        </button>
                        <button type="button" className="text-muted-foreground text-xs underline" onClick={() => { setReplacingId(null); setReplaceQty(""); }}>{L("cancel", "batal")}</button>
                      </span>
                    ) : (
                      <>
                        <button type="button" className={rowBtn} title={L("Enter the amount the supplier refunded (blank = full amount)", "Masukkan amaun yang dipulangkan pembekal (kosong = amaun penuh)")}
                          onClick={() => { setCreditingId(r.id); setCreditAmt(""); }}>
                          {L("Mark credited", "Tanda dikredit")}
                        </button>
                        <button type="button" className={rowBtn} title={L("Replacement goods arrived — qty goes back into stock (blank = all remaining)", "Barang gantian tiba — kuantiti kembali ke dalam stok (kosong = semua baki)")}
                          onClick={() => { setReplacingId(r.id); setReplaceQty(""); }}>
                          {L("Replaced", "Diganti")}
                        </button>
                      </>
                    )}
                    {(r.replaced_qty ?? 0) === 0 && retEditId !== r.id && (
                      <button type="button" className={rowBtn} title={L("Fix a wrongly entered return — qty change moves stock by the difference", "Betulkan pemulangan yang tersalah masuk — perubahan kuantiti menggerakkan stok mengikut perbezaan")}
                        onClick={() => {
                          setRetEditId(r.id);
                          setRetEditDraft({
                            qty: String(r.qty), unit_cost: rmBare(r.unit_cost_cents),
                            supplier: r.supplier, return_date: r.return_date.slice(0, 10), reason: r.reason ?? "",
                          });
                        }}>{L("Edit", "Sunting")}</button>
                    )}
                    {(r.replaced_qty ?? 0) === 0 && <button type="button" className={rowBtnDanger}
                      onClick={async () => {
                        if (!(await invConfirm({
                          title: L("Delete this supplier return?", "Padam pemulangan pembekal ini?"),
                          message: `${r.qty} × ${r.sku} ${L("goes back into stock and the", "kembali ke dalam stok dan rekod tuntutan")} ${rmR(r.total_cents)} ${L("claim record is removed.", "dibuang.")}`,
                          confirmLabel: L("Delete return", "Padam pemulangan"), variant: "danger",
                        }))) return;
                        /* v1.77.0 — the dialog above promises that stock moves
                           and a claim record disappears. Doing all of that and
                           then saying nothing is the worst of both. */
                        const res = await api<{ error?: { message?: string } }>(`/inventory/returns/${r.id}/delete`, { method: "POST", body: JSON.stringify({}) });
                        invToast(res.ok ? L("Return deleted", "Pemulangan dipadam") : L("Not deleted", "Tidak dipadam"),
                          res.ok ? `${r.qty} × ${r.sku} ${L("is back in stock", "kembali dalam stok")}`
                                 : (res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya")),
                          res.ok ? undefined : "notice");
                        void load();
                      }}>
                      {L("Delete", "Padam")}
                    </button>}
                  </>
                )}
              </span>
              {/* v1.4.164: inline editor for outstanding returns — standard
                  subheaded fields + save-toast; qty change moves stock by the
                  difference (server-enforced). */}
              {retEditId === r.id && (
                <div className="grid w-full grid-cols-2 items-end gap-2 rounded-lg bg-secondary/40 p-2 sm:flex sm:flex-wrap">
                  <SubR t={L("Qty rejected", "Kuantiti ditolak")}>
                    <input type="number" min={1} className={`${inputClass} sm:max-w-24`} value={retEditDraft.qty}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, qty: e.target.value }))} />
                  </SubR>
                  <SubR t={L("Unit cost (RM)", "Kos seunit (RM)")}>
                    <input type="number" min={0} step="0.01" className={`${inputClass} sm:max-w-28`} value={retEditDraft.unit_cost}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, unit_cost: e.target.value }))} />
                  </SubR>
                  <SubR t={L("Supplier", "Pembekal")}>
                    <input className={`${inputClass} sm:max-w-44`} value={retEditDraft.supplier}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, supplier: e.target.value }))} />
                  </SubR>
                  <SubR t={L("Return date", "Tarikh pemulangan")}>
                    <input type="date" className={`${inputClass} sm:max-w-40`} value={retEditDraft.return_date}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, return_date: e.target.value }))} />
                  </SubR>
                  <SubR t={L("Reason", "Sebab")} className="col-span-2 sm:max-w-52">
                    <input className={inputClass} value={retEditDraft.reason}
                      onChange={(e) => setRetEditDraft((d) => ({ ...d, reason: e.target.value }))} />
                  </SubR>
                  <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium"
                    onClick={async () => {
                      const qtyN = Math.floor(Number(retEditDraft.qty));
                      const costN = Number(retEditDraft.unit_cost);
                      if (!qtyN || qtyN <= 0 || !Number.isFinite(costN) || costN < 0 || !retEditDraft.supplier.trim() || !retEditDraft.return_date) {
                        invToast(L("No changes", "Tiada perubahan"), L("Qty (>0), unit cost, supplier and date are required", "Kuantiti (>0), kos seunit, pembekal dan tarikh diperlukan"), "notice"); return;
                      }
                      const res = await api<{ error?: { message?: string } }>(`/inventory/returns/${r.id}/edit`, {
                        method: "POST",
                        body: JSON.stringify({
                          qty: qtyN, unit_cost: costN, supplier: retEditDraft.supplier.trim(),
                          return_date: retEditDraft.return_date, reason: retEditDraft.reason.trim() || undefined,
                        }),
                      });
                      if (!res.ok) { invToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Edit failed", "Suntingan gagal"), "notice"); return; }
                      invToast(L("Saved", "Disimpan"), `${L("Return updated —", "Pemulangan dikemas kini —")} ${qtyN} × RM ${rmBare(Math.round(costN * 100))}${qtyN !== r.qty ? L(" (stock adjusted by the difference)", " (stok dilaraskan mengikut perbezaan)") : ""}`);
                      setRetEditId(null);
                      void load();
                    }}>{L("Save", "Simpan")}</button>
                  <button type="button" className="text-xs underline" onClick={() => setRetEditId(null)}>{L("Cancel", "Batal")}</button>
                </div>
              )}
            </div>
            {openRet === r.id && (
              <DetailGrid items={[
                { label: L("Item", "Barang"), wide: true, value: `${r.sku} — ${r.item_name}` },
                { label: L("Quantity", "Kuantiti"), value: `${r.qty} pcs` },
                { label: L("Unit cost", "Kos seunit"), value: rmR(r.unit_cost_cents) },
                { label: L("Total claim", "Jumlah tuntutan"), value: rmR(r.total_cents) },
                { label: L("Supplier", "Pembekal"), value: r.supplier },
                { label: L("Returned on", "Dipulangkan pada"), value: dmy(r.return_date) },
                { label: L("Replaced", "Diganti"), value: (r.replaced_qty ?? 0) > 0 ? `${r.replaced_qty} ${L("of", "daripada")} ${r.qty} pcs` : "" },
                { label: L("Credited", "Dikredit"), value: r.credited_cents != null ? rmR(r.credited_cents) : "" },
                { label: L("Reason", "Sebab"), wide: true, value: r.reason ?? "" },
              ]} />
            )}
            </div>
          ))}
        </div>
        </DetailsToggle>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">{L("Postage tracking — non-TikTok orders", "Penjejakan pos — pesanan bukan TikTok")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("TikTok orders arrive automatically (webhook + 30-minute sync) with their items and tracking. Use this form only for other channels — Shopee, WhatsApp/direct sales, replacements.", "Pesanan TikTok tiba secara automatik (webhook + segerak 30 minit) dengan barang dan penjejakannya. Guna borang ini hanya untuk saluran lain — Shopee, jualan WhatsApp/terus, penggantian.")}
          </p>
          <div className="mt-3 space-y-2">
            <SubR t={L("Order reference", "Rujukan pesanan")}>
            <input className={inputClass} placeholder={L("e.g. SHP-10023 / WA order", "cth. SHP-10023 / pesanan WA")} value={postDraft.order_ref}
              onChange={(e) => setPostDraft((d) => ({ ...d, order_ref: e.target.value }))} /></SubR>
            <div className={fieldRow}>
              <SubR t={L("Courier", "Kurier")}>
              <input className={inputClass} placeholder={L("e.g. J&T, Pos Laju", "cth. J&T, Pos Laju")} value={postDraft.courier}
                onChange={(e) => setPostDraft((d) => ({ ...d, courier: e.target.value }))} /></SubR>
              <SubR t={L("Tracking no.", "No. penjejakan")}>
              <input className={inputClass} placeholder={L("e.g. MY123456789", "cth. MY123456789")} value={postDraft.tracking_no}
                onChange={(e) => setPostDraft((d) => ({ ...d, tracking_no: e.target.value }))} /></SubR>
              {/* v1.4.169: sales value of the non-TikTok order — counts in
                  Total sales + KPI (leave empty for RM 0 shipments like
                  replacements, which stay out of the totals) */}
              <SubR t={L("Order amount (RM)", "Amaun pesanan (RM)")} className="col-span-2 sm:col-span-1">
              <input type="number" min={0} step="0.01" className={`${inputClass} sm:max-w-32`} placeholder="0.00"
                title={L("What the customer paid for this order — counted in Total sales. Leave empty for replacements / non-sales shipments.", "Apa yang pelanggan bayar untuk pesanan ini — dikira dalam Jumlah jualan. Biarkan kosong untuk penggantian / penghantaran bukan jualan.")}
                value={postDraft.order_amount}
                onChange={(e) => setPostDraft((d) => ({ ...d, order_amount: e.target.value }))} /></SubR>
            </div>
            {postLines.map((line, idx) => (
              <div key={idx} className={fieldRow}>
                <select className={`${inputClass} col-span-2 sm:col-span-1 sm:flex-1`} value={line.inventory_item_id}
                  onChange={(e) => setPostLines((ls) => ls.map((l, i) => i === idx ? { ...l, inventory_item_id: Number(e.target.value) } : l))}>
                  <option value={0}>{L("Select item…", "Pilih barang…")}</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.sku} · {it.name} ({it.stock} {L("in stock", "dalam stok")})</option>
                  ))}
                </select>
                <input type="number" min={1} className={`${inputClass} sm:max-w-20`} value={line.qty}
                  title={L("Quantity shipped", "Kuantiti dihantar")}
                  onChange={(e) => setPostLines((ls) => ls.map((l, i) => i === idx ? { ...l, qty: Math.max(1, Number(e.target.value)) } : l))} />
                <button type="button" className="text-destructive text-xs underline"
                  onClick={() => setPostLines((ls) => ls.filter((_, i) => i !== idx))}>{L("Remove", "Buang")}</button>
              </div>
            ))}
            {/* v1.4.155: block, not inline — as an inline button it shared its
                line box with the inline-flex Add record button below, so the
                link and the button rendered jammed together on one line. */}
            <button type="button" className="block text-left text-xs underline"
              onClick={() => setPostLines((ls) => [...ls, { inventory_item_id: 0, qty: 1 }])}>
              {L("+ Add item line", "+ Tambah baris barang")} {postLines.length === 0 ? L("(deducts stock automatically)", "(menolak stok secara automatik)") : ""}
            </button>
            {postMsg && <p className="text-destructive text-xs font-medium">{postMsg}</p>}
            <button type="button" className={btnClass}
              onClick={async () => {
                if (!postDraft.order_ref.trim()) return;
                const lines = postLines.filter((l) => l.inventory_item_id > 0);
                if (postLines.length > 0 && lines.length !== postLines.length) {
                  setPostMsg(L("Pick an item for every line, or remove empty lines.", "Pilih barang untuk setiap baris, atau buang baris kosong."));
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
                  setPostMsg(res.data?.error?.message ?? L("Could not add record", "Tidak dapat menambah rekod"));
                } else {
                  setPostDraft({ order_ref: "", courier: "", tracking_no: "", order_amount: "" });
                  setPostLines([]);
                }
                void load();
              }}>
              {L("Add record", "Tambah rekod")}
            </button>
          </div>
          <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
            {/* v1.77.0 — skeleton until the first fetch lands: bordered rows, ref left, status right. */}
            {!loaded && Array.from({ length: 3 }, (_, i) => (
              <li key={`skel-${i}`} className="border-border flex items-center justify-between gap-2 rounded-lg border px-3 py-2" aria-hidden>
                <Skel className="h-4 w-48 max-w-full" />
                <Skel className="h-6 w-24" />
              </li>
            ))}
            {loaded && postage.filter((r) => !r.order_ref?.startsWith("TT-")).length === 0 && (
              <li className="text-muted-foreground text-sm">{L("No non-TikTok postage records yet.", "Tiada rekod pos bukan TikTok lagi.")}</li>
            )}
            {postage.filter((r) => !r.order_ref?.startsWith("TT-")).map((r) => (
              <li key={r.id} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{r.order_ref}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {r.courier ?? "—"} · {r.tracking_no ?? L("no tracking yet", "tiada penjejakan lagi")}
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
                    <option key={st} value={st}>{statusLabel(st)}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">{L("Marketing materials", "Bahan pemasaran")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Track what sales needs — request new material, mark it done when produced.", "Jejak apa yang jualan perlukan — minta bahan baharu, tanda selesai apabila dihasilkan.")}
          </p>
          {/* v1.4.155: items-end + matched button height (38px input vs 36px
              btn) so Request sits flush beside the field instead of floating
              at label height; the input takes the remaining width so its
              placeholder isn't clipped. */}
          <div className="mt-3 flex items-end gap-2">
            <SubR t={L("Material needed", "Bahan diperlukan")} className="min-w-0 flex-1">
            <input className={inputClass} placeholder={L("e.g. Raya campaign product cards", "cth. kad produk kempen Raya")} value={matDraft}
              onChange={(e) => setMatDraft(e.target.value)} /></SubR>
            <button type="button" className={`${btnClass} h-[38px] whitespace-nowrap`}
              onClick={async () => {
                if (!matDraft.trim()) return;
                await api(`/materials`, { method: "POST", body: JSON.stringify({ title: matDraft }) });
                setMatDraft("");
                void load();
              }}>
              {L("Request", "Minta")}
            </button>
          </div>
          <ul className="mt-4 space-y-2">
            {/* v1.77.0 — skeleton until the first fetch lands. */}
            {!loaded && Array.from({ length: 2 }, (_, i) => (
              <li key={`skel-${i}`} className="border-border flex items-center justify-between gap-2 rounded-lg border px-3 py-2" aria-hidden>
                <Skel className="h-4 w-40 max-w-full" />
                <Skel className="h-6 w-24" />
              </li>
            ))}
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
                    <option key={st} value={st}>{statusLabel(st)}</option>
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
  /* v1.77.0 — skeleton until the first fetch lands (`staff` starts []). */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ users?: { id: number; name: string; full_name?: string | null; role: string; birthday?: string | null }[], staff?: { id: number; name: string; full_name?: string | null; role: string; birthday?: string | null }[] }>(`/users`);
    if (r.data) {
      const list = r.data.users ?? r.data.staff ?? [];
      setStaff(list.filter((u) => u.role !== "customer"));
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load().finally(() => setLoaded(true)); // a failed request clears the skeleton too
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
      setBirthdayMsg(res.data?.error?.message ?? L("Save failed — check access", "Simpanan gagal — semak akses"));
    }
  };

  // Sort by month-day for an "upcoming" feel.
  const sorted = [...staff].sort((a, b) =>
    (a.birthday?.slice(5) ?? "99").localeCompare(b.birthday?.slice(5) ?? "99"));

  return (
    <div className={card}>
      <p className="text-sm font-semibold">{L("Staff birthdays", "Hari lahir kakitangan")}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L("Set each person's birthday (YYYY-MM-DD). Sorted by month and day. Once saved, a birthday locks — corrections are made by an admin.", "Tetapkan hari lahir setiap orang (YYYY-MM-DD). Disusun mengikut bulan dan hari. Setelah disimpan, hari lahir dikunci — pembetulan dibuat oleh admin.")}
      </p>
      {birthdayMsg && <p className="text-destructive mt-2 text-xs font-medium">{birthdayMsg}</p>}
      <ul className="mt-3 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
        {/* v1.77.0 — skeleton until the first fetch lands: name left, date box + Save right. */}
        {!loaded && Array.from({ length: 6 }, (_, i) => (
          <li key={`skel-${i}`} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2" aria-hidden>
            <Skel className="h-4 w-44 max-w-full" />
            <span className="flex items-center gap-2">
              <Skel className="h-7 w-32" />
              <Skel className="h-7 w-12" />
            </span>
          </li>
        ))}
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
                {L("Save", "Simpan")}
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
  /* v1.76.0 — resolved per person per date on the server. `rest_day` is what
     makes weekend answerable for somebody whose pattern works Saturday. */
  day_kind?: "workday" | "rest_day";
  shift_label?: string;
  pending?: boolean;
  /* v1.80.0 — a punch outside the pattern that a live session or a roster
     block vouches for. The CEO: *"if yes, then it is consider their working
     time."* `assigned_what` names the job so the register answers "why is
     there a punch at 21:00" without opening another tab. */
  assigned_kind?: "live" | "task" | null;
  assigned_what?: string | null;
  scheduled_minutes?: number;
}

/* v1.21.0 (allow-but-flag geofence): where the punch happened, against HQ.
   Staff outside radius + min(acc,150) grace show RED; CEO/COO/CCO are
   exempt from the flag (distance shows neutrally); manual/amended rows and
   pre-GPS history show nothing. Same maths as the server gate. */
function attLoc(r: AttRecord): { text: string; tone: "ok" | "flag" | "muted" } | null {
  if (r.manual_by || r.amended_by) return null; // typed by HR, no device GPS
  /* v1.25.3: a punch taken while the phone blocked location is stored as
     "no_location:<reason>" — that is an EXCEPTION and reads red, unlike the
     muted blank of records that predate the GPS requirement. */
  if (r.gps?.startsWith("no_location:")) {
    const why = r.gps.slice("no_location:".length);
    return { text: why === "denied" ? L("NO LOCATION — phone blocked it", "TIADA LOKASI — telefon menyekatnya") : `${L("NO LOCATION —", "TIADA LOKASI —")} ${why}`, tone: "flag" };
  }
  const m = r.gps ? /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?/.exec(r.gps) : null;
  const exempt = ["ceo", "coo", "cco"].includes(r.role ?? "");
  // No stored location: history predates the GPS requirement (v1.18.1) —
  // muted, not red, or July would read as a wall of violations.
  if (!m) return r.gps === undefined ? null : { text: L("no location", "tiada lokasi"), tone: "muted" };
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
  return near ? { text: `${L("at office", "di pejabat")} (${shown})`, tone: "ok" } : { text: `${L("OUTSIDE", "DI LUAR")} (${shown})`, tone: "flag" };
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
/* v1.76.0 — working hours, and the punches waiting on the CEO. */
type ShiftPattern = {
  id: number; name: string; half_day_minutes: number; is_default: number;
  [k: string]: number | string | null;
};
type ShiftAssignment = {
  id: number; user_id: number; name: string; pattern_id: number;
  pattern_name: string; effective_from: string;
};
type PendingPunch = { id: number; user_id: number; name: string; type: string; created_at: string };

const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"],
              ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]] as const;

/** "10:00" <-> minutes since midnight. NULL/"" = a rest day. */
const toMins = (v: string): number | null => {
  if (!/^\d{2}:\d{2}$/.test(v)) return null;
  return Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
};
const toTime = (m: number | null | undefined): string =>
  m === null || m === undefined ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** One weekday in the pattern editor: up to two blocks, blank = not worked. */
type DayEdit = { start: string; end: string; start2: string; end2: string };
const EMPTY_DAY: DayEdit = { start: "", end: "", start2: "", end2: "" };

/** Minutes a day adds up to across both blocks — the number the CEO is
    actually counting when he says the day should come to eight hours. A block
    with only one end contributes nothing, the same rule the server applies. */
const blockSpan = (a: string, b: string): number => {
  const s = toMins(a), e = toMins(b);
  return s === null || e === null || e <= s ? 0 : e - s;
};
const daySpan = (d: DayEdit | undefined): number =>
  blockSpan(d?.start ?? "", d?.end ?? "") + blockSpan(d?.start2 ?? "", d?.end2 ?? "");

/** v1.81.0 — WHAT THE DAY IS OWED, which is the schedule minus lunch. Mirrors
    `workMinutes` + `breakFor` in the worker: the break comes off ONCE, and
    only when a block runs longer than five hours (Employment Act 1955
    s.60A(1)(a)) — so a six-hour afternoon earns it and the two-hour evening
    block beside it does not earn a second one. tests/shift-schedule.mjs fails
    the build if the two sides ever stop agreeing. */
const BREAK_AFTER_MINUTES = 5 * 60;
const dayMinutes = (d: DayEdit | undefined, brk = 0): number => {
  const earnsBreak = brk > 0 && (
    blockSpan(d?.start ?? "", d?.end ?? "") > BREAK_AFTER_MINUTES ||
    blockSpan(d?.start2 ?? "", d?.end2 ?? "") > BREAK_AFTER_MINUTES
  );
  return Math.max(0, daySpan(d) - (earnsBreak ? brk : 0));
};
/** "8h", "7h30" — short enough to sit at the end of a row without wrapping. */
const hLabel = (mins: number): string =>
  mins === 0 ? "—" : mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;

/* v1.78.0 — the UnpaidDay row type left with the month's unpaid-day list: this
   card records a day, the Staff tab is where the recorded days are reviewed. */

export function AttendanceAdminPanel({ role = "" }: { role?: string }) {
  const [month, setMonth] = useState(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7));
  const [rows, setRows] = useState<AttRecord[]>([]);
  const [staff, setStaff] = useState<{ id: number; name: string; full_name?: string | null }[]>([]);
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [add, setAdd] = useState({ user_id: 0, type: "clock_in", date: "", time: "" });
  /* v1.72.0 (CEO: "I also want to have a option for me to update their
     attendance to Unpaid Leave which is for payroll") — recorded here, but
     stored as an APPROVED unpaid leave request, which is what payroll has
     always read. Nothing in the payslip had to change: the UNPAID LEAVE line
     and the 1/26 statutory rate were already there, waiting for a day to
     count. CEO only, matching the server. */
  const canUnpaid = ["ceo", "super_admin"].includes(role);
  /* v1.78.0 — the month's recorded unpaid days moved to the Staff tab, so this
     card no longer holds (or fetches) a list it does not show. */
  /* v1.81.1 (CEO: "unpaid should have option half day unpaid or full day
     unpaid") — the form always sent a whole day. The server has taken a
     fractional `days` since v1.75.0, and the Staff tab already prints the
     fraction; there was simply no way to say it. */
  const [ul, setUl] = useState({ user_id: 0, date: "", reason: "", days: 1 });
  /* v1.76.0 — schedules, and the forgotten punches waiting on the CEO. */
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [pending, setPending] = useState<PendingPunch[]>([]);
  const [fixTime, setFixTime] = useState<Record<number, string>>({});
  /* v1.80.0 — a day is TWO optional blocks now (CEO: "require 8 hours, 11:00am
     to 5:00pm then continue work at 8:30pm to 10:30pm"). `start`/`end` stay
     the first block, so an existing pattern loads and saves unchanged. */
  const [editP, setEditP] = useState<{ id?: number; name: string; half: string; brk: number; days: Record<string, DayEdit> } | null>(null);
  /* v1.80.0 (CEO: "bulk choose day for me to update easily") — the days ticked
     in the editor, and the times about to be applied to all of them. Typing
     the same 11:00-17:00 into five rows is how a Thursday ends up at 11:00-
     17:30 and nobody notices until somebody is flagged late. */
  const [bulkDays, setBulkDays] = useState<string[]>([]);
  const [bulk, setBulk] = useState({ start: "", end: "", start2: "", end2: "" });
  /* v1.80.0 (CEO: "I want minimalist interface for me to easier to choose
     which area that I want to update") — four full forms were stacked open at
     once and the card ran off the screen before the records began. One area
     at a time, chosen from the row of buttons at the top. */
  const [section, setSection] = useState<"find" | "add" | "unpaid" | "hours">("find");
  const [assign, setAssign] = useState({ user_id: 0, pattern_id: 0, effective_from: "" });
  // v1.4.80: click a column HEADER to sort (▲ asc / ▼ desc); click again to
  // flip. Default = the API's chronological order.
  const [sortKey, setSortKey] = useState<"name" | "type" | "time" | "mark" | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  /* v1.77.0 — skeleton until the first fetch lands. `rows` starts [] so
     "No records this month" cannot be told from a month still loading. */
  const [loaded, setLoaded] = useState(false);
  /* v1.72.2 (CEO: "I want to have the search box for me to find the staff and
     to filter based on what I want to view either in or out or anything") —
     the v1.4.78 single-staff dropdown becomes a filter bar: typed search on
     the name, In/Out, how the record got there, off-site punches only, and
     one specific day. Every filter is applied in the browser to the month
     already loaded, so it is instant and costs no request. */
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState<"all" | "clock_in" | "clock_out">("all");
  const [markF, setMarkF] = useState<"all" | "punch" | "manual" | "amended" | "offsite" | "rest_day" | "pending" | "assigned">("all");
  const [dayF, setDayF] = useState("");
  const filtersOn = q.trim() !== "" || typeF !== "all" || markF !== "all" || dayF !== "";
  /* ONE definition of "the rows on screen", used by the table AND by the CSV
     button. Two definitions would drift the moment somebody adds a filter,
     and the export would quietly disagree with what was being looked at —
     which is the whole thing the CEO asked for. */
  const exportRows = (): AttRecord[] => {
    const visible = filtersOn ? rows.filter(matches) : rows;
    if (!sortKey) return visible;
    const val = (r: AttRecord) =>
      sortKey === "name" ? (r.name ?? "") :
      sortKey === "type" ? r.type :
      sortKey === "mark" ? markOf(r) : r.created_at;
    return [...visible].sort(
      (a, b) => (val(a).localeCompare(val(b)) || a.created_at.localeCompare(b.created_at)) * sortDir,
    );
  };
  const clearFilters = () => { setQ(""); setTypeF("all"); setMarkF("all"); setDayF(""); };
  const matches = (r: AttRecord) => {
    if (q.trim() && !properName(r.name).toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (typeF !== "all" && r.type !== typeF) return false;
    if (markF === "offsite") { if (attLoc(r)?.tone !== "flag") return false; }
    else if (markF === "rest_day") { if (r.day_kind !== "rest_day") return false; }
    else if (markF === "pending") { if (!r.pending) return false; }
    else if (markF === "assigned") { if (!r.assigned_what) return false; }
    else if (markF !== "all" && markOf(r) !== markF) return false;
    if (dayF && utcToMytLocal(r.created_at).slice(0, 10) !== dayF) return false;
    return true;
  };
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.80.1 — removing a pattern is not undoable, so it asks first. */
  const { confirm: askPat, node: askPatNode } = useConfirm();
  const clickSort = (k: "name" | "type" | "time" | "mark") => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  };
  const markOf = (r: AttRecord) => (r.manual_by ? "manual" : r.amended_by ? "amended" : "punch");

  const loadShifts = useCallback(async () => {
    const [sp, pp] = await Promise.all([
      api<{ patterns: ShiftPattern[]; assignments: ShiftAssignment[] }>(`/shift-patterns`),
      api<{ pending: PendingPunch[] }>(`/attendance/pending`),
    ]);
    setPatterns(sp.data?.patterns ?? []);
    setAssignments(sp.data?.assignments ?? []);
    setPending(pp.data?.pending ?? []);
  }, []);

  const load = useCallback(async () => {
    void loadShifts();
    const [r, u] = await Promise.all([
      api<{ records: AttRecord[] }>(`/attendance/report?month=${month}`),
      api<{ users?: { id: number; name: string; full_name?: string | null; role: string }[]; staff?: { id: number; name: string; full_name?: string | null; role: string }[] }>(`/users`),
    ]);
    if (r.data) setRows(r.data.records ?? []);
    const list = u.data?.users ?? u.data?.staff ?? [];
    setStaff(list.filter((x) => x.role !== "customer" && x.role !== "super_admin"));
    setLoaded(true);
  }, [month, loadShifts]);
  useEffect(() => {
    void load().finally(() => setLoaded(true)); // v1.77.0 — a failed request clears the skeleton too
  }, [load]);

  /* v1.80.1 (CEO: "there is a issue to update pattern name!") — HIS RENAME
     WAS FAILING AND THE CARD WAS TELLING HIM IN GREEN, OFF-SCREEN.
     A failure only ever set `msg`, which renders as one green line near the
     TOP of the card — and this card is now long enough that Working hours
     sits well below the fold. So a rejected save (a missing migration, an
     expired session, a name the server would not take) looked exactly like
     nothing happening at all: no toast, and the only explanation rendered in
     the colour of success, several screens up.
     Failures now go through the SAME toast as successes, which appears where
     the eye is regardless of scroll, and `msg` is red when it is bad news. */
  const [msgBad, setMsgBad] = useState(false);
  const act = async (path: string, init: RequestInit, okMsg: string) => {
    setMsg("");
    const res = await api<{ error?: { message?: string } }>(path, init);
    if (res.ok) {
      setMsgBad(false);
      showToast(L("Saved", "Disimpan"), okMsg);
      void load();
    } else {
      const why = res.data?.error?.message ?? L("Action failed — check access", "Tindakan gagal — semak akses");
      setMsgBad(true);
      setMsg(why);
      showToast(L("Not saved", "Tidak disimpan"), why, "notice");
    }
  };

  return (
    <div className={`${card} mt-4 md:mt-6`}>
      {toastNode}
      {askPatNode}
      <p className="text-sm font-semibold">{L("Staff attendance — corrections & back-entry", "Kehadiran kakitangan — pembetulan & kemasukan lampau")}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L("Amend a wrong punch or add clock in/out for days worked before this system existed. Times are Malaysia time. Manual and amended records are marked and audit-logged.", "Pinda ketukan yang salah atau tambah daftar masuk/keluar untuk hari bekerja sebelum sistem ini wujud. Masa ialah waktu Malaysia. Rekod manual dan pindaan ditanda dan dilog audit.")}
      </p>

      {/* v1.78.0 (CEO: "Working hour pattern seem like not so professional
          with that interface which is to me ugly! use globally format
          coding!") — every control row on this card was a hand-rolled flex
          with per-input sm:max-w-* guesses and no labels, so on a wide screen
          the date blew out to full width while the selects stayed tiny and
          the row read as a broken ladder. All four rows are now the portal's
          own labelled field grid: a SubR label per control, the shared
          inputClass, and the COLUMN deciding the width. */}
      {/* v1.80.0 (CEO: "I want minimalist interface for me to easier to choose
          which area that I want to update") — Add record, Unpaid leave,
          Working hours and Find & filter were four full forms stacked open at
          once: eighteen controls before the first attendance row, and the
          records he came to look at were off the bottom of the screen. One
          area at a time now, chosen here. Find & filter opens by default
          because it is the one that decides what the table below shows. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {([
          ["find", L("Find & filter", "Cari & tapis")],
          ["add", L("Add record", "Tambah rekod")],
          ...(canUnpaid ? [["unpaid", L("Unpaid leave", "Cuti tanpa gaji")] as const,
                           ["hours", L("Working hours", "Waktu bekerja")] as const] : []),
        ] as [typeof section, string][]).map(([key, label]) => (
          <button key={key} type="button"
            className={section === key
              ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium"
              : "border-border text-muted-foreground hover:bg-secondary/70 rounded-full border px-3 py-1 text-xs"}
            onClick={() => setSection(key)}>
            {label}
          </button>
        ))}
      </div>

      {section === "add" && (
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SubR t={L("Staff", "Kakitangan")}>
          <select className={inputClass} value={add.user_id}
            onChange={(e) => setAdd((d) => ({ ...d, user_id: Number(e.target.value) }))}>
            <option value={0}>{L("Select staff…", "Pilih kakitangan…")}</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)}</option>)}
          </select>
        </SubR>
        <SubR t={L("Type", "Jenis")}>
          <select className={inputClass} value={add.type}
            onChange={(e) => setAdd((d) => ({ ...d, type: e.target.value }))}>
            <option value="clock_in">{L("Clock in", "Daftar masuk")}</option>
            <option value="clock_out">{L("Clock out", "Daftar keluar")}</option>
          </select>
        </SubR>
        <SubR t={L("Date", "Tarikh")}>
          <input type="date" className={inputClass} value={add.date}
            onChange={(e) => setAdd((d) => ({ ...d, date: e.target.value }))} />
        </SubR>
        <SubR t={L("Time (MYT)", "Masa (MYT)")}>
          <input type="time" className={inputClass} value={add.time}
            onChange={(e) => setAdd((d) => ({ ...d, time: e.target.value }))} />
        </SubR>
        <div className="flex items-end sm:col-span-2 lg:col-span-1">
          <button type="button"
            className={btnClass}
            disabled={!add.user_id || !add.date || !add.time}
            onClick={() => void act(`/attendance/manual`, {
              method: "POST",
              body: JSON.stringify({ user_id: add.user_id, type: add.type, myt: `${add.date} ${add.time}` }),
            }, L("Record added.", "Rekod ditambah."))}>
            {L("Add", "Tambah")}
          </button>
        </div>
      </div>
      )}
      {msg && <p className={`mt-2 text-xs font-medium ${msgBad ? "text-danger" : "text-green-700"}`}>{msg}</p>}

      {/* v1.76.0 (CEO: "if they forget to clock in or clock out... The
          approval will be require CEO for approval then CEO will update the
          clock in/out time during the approval"). The punch is already
          recorded — it just counts for nothing until this. Correct the time
          in the box before approving; leaving it blank accepts the time
          claimed. */}
      {canUnpaid && pending.length > 0 && (
        <>
          <span className="text-warning mt-4 block text-[11px] font-semibold tracking-wide uppercase">
            {L(`Forgotten punches waiting for you (${pending.length})`, `Ketukan terlupa menunggu anda (${pending.length})`)}
          </span>
          <div className="border-warning/40 bg-warning-soft/40 mt-1 space-y-2 rounded-xl border p-3">
            {pending.map((pp) => (
              <div key={pp.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{properName(pp.name)}</span>
                <span className="text-muted-foreground">
                  {pp.type === "clock_in" ? L("clock in", "daftar masuk") : L("clock out", "daftar keluar")} ·
                  {" "}{L("claimed", "didakwa")} {utcToMytLocal(pp.created_at).replace("T", " ")}
                </span>
                <input type="datetime-local" className="border-input bg-background rounded border px-1.5 py-1"
                  value={fixTime[pp.id] ?? utcToMytLocal(pp.created_at)}
                  title={L("The real time — this is what gets recorded", "Masa sebenar — ini yang akan direkodkan")}
                  onChange={(e) => setFixTime((f) => ({ ...f, [pp.id]: e.target.value }))} />
                <button type="button" className={rowBtnGood}
                  onClick={() => void act(`/attendance/pending/decide`, {
                    method: "POST",
                    body: JSON.stringify({
                      id: pp.id, action: "approve",
                      myt: (fixTime[pp.id] ?? utcToMytLocal(pp.created_at)).replace("T", " "),
                    }),
                  }, L("Approved — it counts now.", "Diluluskan — ia dikira sekarang."))}>
                  {L("Approve", "Luluskan")}
                </button>
                <button type="button" className={rowBtnDanger}
                  title={L("The punch is deleted — a rejected claim is not a record of anything", "Ketukan akan dipadam — dakwaan yang ditolak bukan rekod apa-apa")}
                  onClick={() => void act(`/attendance/pending/decide`, {
                    method: "POST", body: JSON.stringify({ id: pp.id, action: "reject" }),
                  }, L("Rejected and removed.", "Ditolak dan dikeluarkan."))}>
                  {L("Reject", "Tolak")}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {canUnpaid && section === "unpaid" && (
        <>
          <span className="text-muted-foreground mt-4 block text-[11px] font-semibold tracking-wide uppercase">
            {L("Unpaid leave — deducted from pay", "Cuti tanpa gaji — dipotong daripada gaji")}
          </span>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "Mark a day nobody applied for — absent, or agreed unpaid time off, a full day or half of one. The payslip deducts it at the statutory rate (monthly wage ÷ 26 per full day, Employment Act 1955 s.60I), shows it as its own line, and leaves Basic full. The staff member is notified the moment you record it, and the day is excluded from the incomplete-month proration so nothing is deducted twice. Undo removes it from that month's pay.",
              "Tandakan hari yang tiada permohonan — tidak hadir, atau cuti tanpa gaji yang dipersetujui, sehari penuh atau setengah hari. Slip gaji memotong pada kadar statutori (gaji bulanan ÷ 26 sehari penuh, Akta Kerja 1955 s.60I), menunjukkannya sebagai baris tersendiri, dan mengekalkan Gaji pokok penuh. Kakitangan dimaklumkan sebaik sahaja anda merekodkannya, dan hari itu dikecualikan daripada pengiraan bulan tidak lengkap supaya tiada potongan dua kali. Buat asal mengeluarkannya daripada gaji bulan tersebut."
            )}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SubR t={L("Staff", "Kakitangan")}>
              <select className={inputClass} value={ul.user_id}
                onChange={(e) => setUl((d) => ({ ...d, user_id: Number(e.target.value) }))}>
                <option value={0}>{L("Select staff…", "Pilih kakitangan…")}</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)}</option>)}
              </select>
            </SubR>
            <SubR t={L("Date", "Tarikh")}>
              <input type="date" className={inputClass} value={ul.date}
                onChange={(e) => setUl((d) => ({ ...d, date: e.target.value }))} />
            </SubR>
            {/* v1.81.1 (CEO: "unpaid should have option half day unpaid or
                full day unpaid"). A SELECT rather than two buttons: the
                amount is a property of the record being made, and it must be
                visible while the date is chosen — two buttons would put the
                decision in the click, where nobody can check it first. */}
            <SubR t={L("How much", "Berapa banyak")}>
              <select className={inputClass} value={ul.days}
                title={L("A full day is deducted at monthly wage ÷ 26. A half day is half of that.", "Sehari penuh dipotong pada gaji bulanan ÷ 26. Setengah hari ialah separuh daripadanya.")}
                onChange={(e) => setUl((d) => ({ ...d, days: Number(e.target.value) }))}>
                <option value={1}>{L("Full day", "Sehari penuh")}</option>
                <option value={0.5}>{L("Half day", "Setengah hari")}</option>
              </select>
            </SubR>
            <SubR t={L("Reason (optional)", "Sebab (pilihan)")}>
              <input className={inputClass} value={ul.reason}
                placeholder={L("Reason (optional)", "Sebab (pilihan)")}
                onChange={(e) => setUl((d) => ({ ...d, reason: e.target.value }))} />
            </SubR>
            <div className="flex items-end sm:col-span-2 lg:col-span-1">
              <button type="button"
                className={btnClass}
                disabled={!ul.user_id || !ul.date}
                /* The button says WHICH — the one control whose setting the
                   press cannot be taken back from. */
                onClick={() => {
                  const half = ul.days === 0.5;
                  void act(`/attendance/unpaid`, {
                    method: "POST",
                    body: JSON.stringify({ user_id: ul.user_id, date: ul.date, days: ul.days, reason: ul.reason || undefined }),
                  }, half
                    ? L("Recorded as HALF a day unpaid — payroll will deduct it.", "Direkod sebagai SETENGAH hari tanpa gaji — gaji akan dipotong.")
                    : L("Recorded as a FULL day unpaid — payroll will deduct it.", "Direkod sebagai SEHARI PENUH tanpa gaji — gaji akan dipotong."));
                  setUl({ user_id: 0, date: "", reason: "", days: 1 });
                }}>
                {ul.days === 0.5 ? L("Mark half day unpaid", "Tanda setengah hari") : L("Mark unpaid", "Tanda tanpa gaji")}
              </button>
            </div>
          </div>
          {/* v1.78.0 (CEO: "Unpaid leave should not appear all the list of
              during that month which is the record should be recorded into
              staff table") — recording a day stays here, because this is the
              attendance card; the month's recorded days, and undoing one, now
              live with the staff member on the Staff tab. */}
          <p className="text-muted-foreground mt-1.5 text-xs">
            {L("Recorded days are listed on the Staff tab, where they can be undone.", "Hari yang direkodkan disenaraikan pada tab Kakitangan, di mana ia boleh dibuat asal.")}
          </p>
        </>
      )}

      {/* v1.76.0 (CEO: "I want to have the working hour schedule for me to
          setup their working hours so that system able to capture their
          working hours without everything dump into 1 working hour"). A
          PATTERN is named and shared, so moving the whole company's Friday
          finish is one edit rather than one per person — which is exactly the
          change that had already happened by announcement and that the code
          never knew about. Assignments carry the date they start, so fixing
          somebody's hours today does not re-flag a month already paid. */}
      {canUnpaid && section === "hours" && (
        <>
          <span className="text-muted-foreground mt-4 block text-[11px] font-semibold tracking-wide uppercase">
            {L("Working hours", "Waktu bekerja")}
          </span>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Every late and early-out flag, the payroll export and the short-day scan are measured against these. A day left blank is a rest day for that pattern — that is how the system tells a weekend from a working day per person, rather than assuming Saturday and Sunday.", "Setiap penanda lewat dan balik awal, eksport gaji dan imbasan hari pendek diukur berdasarkan ini. Hari yang dibiarkan kosong ialah hari rehat bagi corak itu — begitulah sistem membezakan hujung minggu daripada hari bekerja bagi setiap orang.")}
          </p>

          <div className="mt-2 flex flex-wrap gap-2">
            {patterns.map((pt) => (
              <button key={pt.id} type="button"
                className={`${chipNeutral} hover:bg-secondary/70`}
                title={L("Edit this pattern", "Sunting corak ini")}
                onClick={() => { setBulkDays([]); setBulk({ start: "", end: "", start2: "", end2: "" }); setEditP({
                  id: pt.id, name: pt.name, half: toTime(pt.half_day_minutes as number),
                  /* Absent on a pre-0103 row. 60 is what 0103 gives every
                     existing pattern, so the editor shows what the server
                     will apply rather than a zero it would then overwrite. */
                  brk: (pt.break_minutes as number | null) ?? 60,
                  days: Object.fromEntries(DAYS.map(([k]) => [k, {
                    start: toTime(pt[`${k}_start`] as number | null),
                    end: toTime(pt[`${k}_end`] as number | null),
                    /* Absent on a pre-0102 row, which reads as a day with one
                       block — the same thing it has always been. */
                    start2: toTime(pt[`${k}_start2`] as number | null),
                    end2: toTime(pt[`${k}_end2`] as number | null),
                  }])),
                }); }}>
                {pt.name}{pt.is_default ? ` · ${L("default", "lalai")}` : ""}
              </button>
            ))}
            <button type="button"
              className={`${chipNeutral} border-border hover:bg-secondary/70 border border-dashed bg-transparent`}
              onClick={() => { setBulkDays([]); setBulk({ start: "", end: "", start2: "", end2: "" }); setEditP({
                name: "", half: "12:00", brk: 60,
                days: Object.fromEntries(DAYS.map(([k]) => [k, { ...EMPTY_DAY }])),
              }); }}>
              {L("+ New pattern", "+ Corak baharu")}
            </button>
          </div>

          {editP && (
            <div className="border-border mt-2 rounded-xl border p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <SubR t={L("Pattern name", "Nama corak")} className="sm:col-span-2">
                  <input className={inputClass} value={editP.name} maxLength={60}
                    placeholder={L("e.g. Late shift (11:00-19:00)", "cth. Syif lewat (11:00-19:00)")}
                    onChange={(e) => setEditP({ ...editP, name: e.target.value })} />
                </SubR>
                <SubR t={L("Half day after", "Separuh hari selepas")}>
                  <input type="time" className={inputClass} value={editP.half}
                    title={L("Arriving after this counts the day as a half day", "Tiba selepas ini dikira sebagai separuh hari")}
                    onChange={(e) => setEditP({ ...editP, half: e.target.value })} />
                </SubR>
                {/* v1.81.0 (CEO: "this one should exclude of lunch time of 1
                    hour") — the totals on every row below are NET of this, so
                    a 10:00-18:00 day reads 7h, which is what the person is
                    owed and what the short-day scan measures against. */}
                <SubR t={L("Unpaid break (min)", "Rehat tanpa gaji (min)")}>
                  <input type="number" min={0} max={240} step={15} className={inputClass}
                    value={editP.brk}
                    title={L("Lunch. Taken off a day ONCE, and only when a block runs longer than five hours — Employment Act 1955 s.60A(1)(a). A two-hour evening block earns none.", "Makan tengah hari. Ditolak SEKALI sehari, dan hanya apabila satu blok melebihi lima jam — Akta Kerja 1955 s.60A(1)(a). Blok malam dua jam tidak mendapatnya.")}
                    onChange={(e) => setEditP({ ...editP, brk: Math.max(0, Math.min(240, Number(e.target.value || 0))) })} />
                </SubR>
              </div>
              {/* v1.80.0 (CEO: "bulk choose day for me to update easily") —
                  tick the days that share a schedule, type it once, Apply.
                  Five rows typed by hand is five chances to put 17:30 where
                  17:00 belongs, and the only symptom is somebody flagged late
                  on a Thursday three weeks later. */}
              <div className="border-border bg-secondary/30 mt-3 rounded-lg border p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-[11px] font-medium">{L("Apply to", "Guna pada")}</span>
                  {DAYS.map(([k, label]) => {
                    const on = bulkDays.includes(k);
                    return (
                      <button key={k} type="button"
                        className={on
                          ? "bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[11px] font-medium"
                          : "border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]"}
                        onClick={() => setBulkDays((d) => (on ? d.filter((x) => x !== k) : [...d, k]))}>
                        {label}
                      </button>
                    );
                  })}
                  <button type="button" className="text-muted-foreground ml-1 text-[11px] underline"
                    onClick={() => setBulkDays(bulkDays.length === 5 && DAYS.slice(0, 5).every(([k]) => bulkDays.includes(k)) ? [] : DAYS.slice(0, 5).map(([k]) => k))}>
                    {L("Mon-Fri", "Isn-Jum")}
                  </button>
                  <button type="button" className="text-muted-foreground text-[11px] underline"
                    onClick={() => setBulkDays(bulkDays.length === DAYS.length ? [] : DAYS.map(([k]) => k))}>
                    {L("All", "Semua")}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-2">
                  <SubR t={L("Block 1", "Blok 1")}>
                    <span className="flex items-center gap-1">
                      <input type="time" className={inputClassSm} value={bulk.start}
                        onChange={(e) => setBulk((b) => ({ ...b, start: e.target.value }))} />
                      <span className="text-muted-foreground">-</span>
                      <input type="time" className={inputClassSm} value={bulk.end}
                        onChange={(e) => setBulk((b) => ({ ...b, end: e.target.value }))} />
                    </span>
                  </SubR>
                  <SubR t={L("Block 2 (optional)", "Blok 2 (pilihan)")}>
                    <span className="flex items-center gap-1">
                      <input type="time" className={inputClassSm} value={bulk.start2}
                        onChange={(e) => setBulk((b) => ({ ...b, start2: e.target.value }))} />
                      <span className="text-muted-foreground">-</span>
                      <input type="time" className={inputClassSm} value={bulk.end2}
                        onChange={(e) => setBulk((b) => ({ ...b, end2: e.target.value }))} />
                    </span>
                  </SubR>
                  <span className="flex items-center gap-2 pb-0.5">
                    <button type="button" className={rowBtnPrimary}
                      disabled={bulkDays.length === 0 || !bulk.start || !bulk.end}
                      title={L("Write these times into every ticked day", "Tulis masa ini ke setiap hari yang ditanda")}
                      onClick={() => setEditP({
                        ...editP,
                        days: {
                          ...editP.days,
                          ...Object.fromEntries(bulkDays.map((k) => [k, { ...bulk }])),
                        },
                      })}>
                      {L(`Apply to ${bulkDays.length || 0} day${bulkDays.length === 1 ? "" : "s"}`, `Guna pada ${bulkDays.length || 0} hari`)}
                    </button>
                    <button type="button" className={rowBtn}
                      disabled={bulkDays.length === 0}
                      title={L("Make every ticked day a rest day", "Jadikan setiap hari yang ditanda hari rehat")}
                      onClick={() => setEditP({
                        ...editP,
                        days: {
                          ...editP.days,
                          ...Object.fromEntries(bulkDays.map((k) => [k, { ...EMPTY_DAY }])),
                        },
                      })}>
                      {L("Clear those days", "Kosongkan hari itu")}
                    </button>
                  </span>
                </div>
                {bulk.start && bulk.end && (
                  <p className="text-muted-foreground mt-1.5 text-[11px]">
                    {L(`Each ticked day becomes ${hLabel(dayMinutes({ ...bulk }, editP.brk))} of work${dayMinutes({ ...bulk }, editP.brk) < daySpan({ ...bulk }) ? ` (${hLabel(daySpan({ ...bulk }))} less the ${editP.brk}-minute break)` : ""}.`,
                        `Setiap hari yang ditanda menjadi ${hLabel(dayMinutes({ ...bulk }, editP.brk))} kerja${dayMinutes({ ...bulk }, editP.brk) < daySpan({ ...bulk }) ? ` (${hLabel(daySpan({ ...bulk }))} tolak rehat ${editP.brk} minit)` : ""}.`)}
                  </p>
                )}
              </div>

              {/* One row per day: block 1, block 2, and what the day comes to.
                  The total is on the row because eight hours split across two
                  blocks is not a sum anybody should be doing in their head. */}
              <div className="mt-3 space-y-1">
                <div className="text-muted-foreground hidden gap-2 px-1 text-[11px] sm:grid sm:grid-cols-[3rem_1fr_1fr_3.5rem]">
                  <span />
                  <span>{L("Block 1", "Blok 1")}</span>
                  <span>{L("Block 2 (optional)", "Blok 2 (pilihan)")}</span>
                  <span className="text-right">{L("Total", "Jumlah")}</span>
                </div>
                {DAYS.map(([k, label]) => {
                  const d = editP.days[k] ?? EMPTY_DAY;
                  const set = (patch: Partial<DayEdit>) =>
                    setEditP({ ...editP, days: { ...editP.days, [k]: { ...EMPTY_DAY, ...d, ...patch } } });
                  const mins = dayMinutes(d, editP.brk);
                  return (
                    <div key={k} className="grid grid-cols-1 items-center gap-x-2 gap-y-1 text-xs sm:grid-cols-[3rem_1fr_1fr_3.5rem]">
                      <span className="text-muted-foreground font-medium">{label}</span>
                      <span className="flex items-center gap-1">
                        <input type="time" className={inputClassSm} value={d.start}
                          onChange={(e) => set({ start: e.target.value })} />
                        <span className="text-muted-foreground">-</span>
                        <input type="time" className={inputClassSm} value={d.end}
                          onChange={(e) => set({ end: e.target.value })} />
                      </span>
                      <span className="flex items-center gap-1">
                        <input type="time" className={inputClassSm} value={d.start2}
                          disabled={!d.start}
                          title={d.start ? L("A second block on the same day, for example an evening broadcast", "Blok kedua pada hari yang sama, contohnya siaran malam") : L("Fill the first block first", "Isi blok pertama dahulu")}
                          onChange={(e) => set({ start2: e.target.value })} />
                        <span className="text-muted-foreground">-</span>
                        <input type="time" className={inputClassSm} value={d.end2}
                          disabled={!d.start}
                          onChange={(e) => set({ end2: e.target.value })} />
                      </span>
                      <span className={`text-right text-[11px] ${mins > 0 ? "font-medium" : "text-muted-foreground"}`}
                        title={mins < daySpan(d) ? L(`${hLabel(daySpan(d))} scheduled, less the ${editP.brk}-minute unpaid break`, `${hLabel(daySpan(d))} berjadual, tolak rehat tanpa gaji ${editP.brk} minit`) : undefined}>
                        {hLabel(mins)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span>{L("Leave both boxes empty for a rest day. A second block is for a day worked in two parts — 11:00-17:00, then 20:30-22:30. Totals are hours of WORK: the unpaid break is already taken off.", "Biarkan kedua-dua kotak kosong untuk hari rehat. Blok kedua untuk hari yang dikerjakan dalam dua bahagian — 11:00-17:00, kemudian 20:30-22:30. Jumlah ialah jam KERJA: rehat tanpa gaji sudah ditolak.")}</span>
                <span className="font-medium whitespace-nowrap">
                  {L(`Week: ${hLabel(DAYS.reduce((n, [k]) => n + dayMinutes(editP.days[k], editP.brk), 0))}`,
                     `Minggu: ${hLabel(DAYS.reduce((n, [k]) => n + dayMinutes(editP.days[k], editP.brk), 0))}`)}
                </span>
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" className={rowBtnPrimary} disabled={!editP.name.trim()}
                  onClick={() => {
                    const payload: Record<string, unknown> = {
                      ...(editP.id ? { id: editP.id } : {}),
                      name: editP.name.trim(),
                      half_day_minutes: toMins(editP.half) ?? 720,
                      break_minutes: editP.brk,
                    };
                    for (const [k] of DAYS) {
                      payload[k] = {
                        start: toMins(editP.days[k]?.start ?? ""),
                        end: toMins(editP.days[k]?.end ?? ""),
                        start2: toMins(editP.days[k]?.start2 ?? ""),
                        end2: toMins(editP.days[k]?.end2 ?? ""),
                      };
                    }
                    void act(`/shift-patterns`, { method: editP.id ? "PATCH" : "POST", body: JSON.stringify(payload) },
                      L("Working hours saved.", "Waktu bekerja disimpan."));
                    setEditP(null);
                  }}>
                  {L("Save pattern", "Simpan corak")}
                </button>
                <button type="button" className={rowBtn} onClick={() => setEditP(null)}>
                  {L("Cancel", "Batal")}
                </button>
                {/* v1.80.1 (CEO: "option to remove this pattern") — only for a
                    pattern that EXISTS: there is nothing to delete about one
                    being typed. The server refuses the default and refuses any
                    pattern somebody is still on, and says which people, so the
                    answer to a refusal is actionable rather than mysterious. */}
                {editP.id && (
                  <button type="button" className={`${rowBtnDanger} ml-auto`}
                    title={L("Remove this pattern. Refused if it is the default, or if anybody is still assigned to it.", "Buang corak ini. Ditolak jika ia lalai, atau jika ada sesiapa masih ditetapkan padanya.")}
                    onClick={async () => {
                      const yes = await askPat({
                        title: L("Remove this pattern?", "Buang corak ini?"),
                        message: L(
                          `"${editP.name || L("Untitled", "Tanpa nama")}" will be removed. Anybody still assigned to it must be moved to another pattern first — the system will say so and change nothing if they are.`,
                          `"${editP.name || "Tanpa nama"}" akan dibuang. Sesiapa yang masih ditetapkan padanya perlu dipindahkan ke corak lain dahulu — sistem akan memberitahu dan tidak mengubah apa-apa jika ada.`,
                        ),
                        confirmLabel: L("Remove", "Buang"),
                        variant: "danger",
                      });
                      if (!yes) return;
                      await act(`/shift-patterns/${editP.id}`, { method: "DELETE" },
                        L("Pattern removed.", "Corak dibuang."));
                      setEditP(null);
                    }}>
                    {L("Remove pattern", "Buang corak")}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SubR t={L("Staff", "Kakitangan")}>
              <select className={inputClass} value={assign.user_id}
                onChange={(e) => setAssign((d) => ({ ...d, user_id: Number(e.target.value) }))}>
                <option value={0}>{L("Assign to staff…", "Tetapkan kepada kakitangan…")}</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)}</option>)}
              </select>
            </SubR>
            <SubR t={L("Pattern", "Corak")}>
              <select className={inputClass} value={assign.pattern_id}
                onChange={(e) => setAssign((d) => ({ ...d, pattern_id: Number(e.target.value) }))}>
                <option value={0}>{L("Pattern…", "Corak…")}</option>
                {patterns.map((pt) => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
              </select>
            </SubR>
            <SubR t={L("Effective from", "Berkuat kuasa dari")}>
              <input type="date" className={inputClass} value={assign.effective_from}
                title={L("From this date onwards — earlier months keep the hours they were flagged against", "Dari tarikh ini — bulan terdahulu kekal dengan waktu asalnya")}
                onChange={(e) => setAssign((d) => ({ ...d, effective_from: e.target.value }))} />
            </SubR>
            <div className="flex items-end sm:col-span-2 lg:col-span-1">
              <button type="button"
                className={btnClass}
                disabled={!assign.user_id || !assign.pattern_id || !assign.effective_from}
                onClick={() => {
                  void act(`/staff-shifts`, { method: "POST", body: JSON.stringify(assign) },
                    L("Hours assigned — the staff member has been told.", "Waktu ditetapkan — kakitangan telah dimaklumkan."));
                  setAssign({ user_id: 0, pattern_id: 0, effective_from: "" });
                }}>
                {L("Assign", "Tetapkan")}
              </button>
            </div>
          </div>
          {assignments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {assignments.map((a) => (
                <span key={a.id} className={chipNeutral}>
                  <span className="font-medium">{properName(a.name)}</span>
                  <span className="text-muted-foreground"> · {a.pattern_name} · {L("from", "dari")} {a.effective_from}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {section === "find" && (
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SubR t={L("Search", "Cari")}>
          <input type="search" className={inputClass} value={q}
            placeholder={L("Search staff name…", "Cari nama kakitangan…")}
            aria-label={L("Search staff", "Cari kakitangan")}
            onChange={(e) => setQ(e.target.value)} />
        </SubR>
        <SubR t={L("Direction", "Arah")}>
          <select className={inputClass} value={typeF}
            aria-label={L("In or out", "Masuk atau keluar")}
            onChange={(e) => setTypeF(e.target.value as typeof typeF)}>
            <option value="all">{L("In & out", "Masuk & keluar")}</option>
            <option value="clock_in">{L("In only", "Masuk sahaja")}</option>
            <option value="clock_out">{L("Out only", "Keluar sahaja")}</option>
          </select>
        </SubR>
        <SubR t={L("Record type", "Jenis rekod")}>
          <select className={inputClass} value={markF}
            aria-label={L("Record kind", "Jenis rekod")}
            onChange={(e) => setMarkF(e.target.value as typeof markF)}>
            <option value="all">{L("Any record", "Semua rekod")}</option>
            <option value="punch">{L("Punched by staff", "Ketukan kakitangan")}</option>
            <option value="manual">{L("Added manually", "Ditambah manual")}</option>
            <option value="amended">{L("Time amended", "Masa dipinda")}</option>
            <option value="offsite">{L("Off-site (flagged)", "Luar tapak (ditanda)")}</option>
            <option value="rest_day">{L("Weekend / rest day", "Hujung minggu / hari rehat")}</option>
            <option value="assigned">{L("Outside hours, assigned work", "Luar waktu, kerja ditugaskan")}</option>
            <option value="pending">{L("Waiting for approval", "Menunggu kelulusan")}</option>
          </select>
        </SubR>
        <SubR t={L("Day", "Hari")}>
          <input type="date" className={inputClass} value={dayF}
            aria-label={L("One day only", "Satu hari sahaja")}
            title={L("Show one day only", "Tunjuk satu hari sahaja")}
            onChange={(e) => setDayF(e.target.value)} />
        </SubR>
        <SubR t={L("Month", "Bulan")}>
          <input type="month" className={inputClass} value={month}
            aria-label={L("Month", "Bulan")}
            onChange={(e) => setMonth(e.target.value)} />
        </SubR>
        {/* v1.74.0 (CEO: "I want to generate in excel csv by follow to the
            filter that I want or a month that I want") — the export takes
            the rows this table is SHOWING, in the order it is showing them.
            Not the month, not the unfiltered set: what you filtered to is
            what lands in Excel, which is the only behaviour that never
            surprises anyone. Built in the browser from data already loaded,
            so it is instant and needs no round trip. */}
        <button type="button"
          className="border-border hover:bg-secondary inline-flex h-9 items-center justify-center self-end rounded-lg border px-3 text-xs font-medium disabled:opacity-50 sm:col-span-2 lg:col-span-1"
          disabled={exportRows().length === 0}
          title={L("Download these rows as a CSV for Excel", "Muat turun baris ini sebagai CSV untuk Excel")}
          onClick={() => {
            const rows = exportRows();
            const active = [
              q.trim() ? `${L("search", "cari")}: ${q.trim()}` : "",
              typeF === "all" ? "" : typeF === "clock_in" ? L("in only", "masuk sahaja") : L("out only", "keluar sahaja"),
              markF === "all" ? "" : markF,
              dayF ? dayF : "",
            ].filter(Boolean);
            downloadCsv(
              /* The filename says what narrowed it — a folder of
                 attendance(3).csv is a folder nobody can use. */
              ["attendance", month, q.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
               typeF === "all" ? "" : typeF, markF === "all" ? "" : markF, dayF]
                .filter(Boolean).join("-"),
              [
                [`# ${L("Staff attendance", "Kehadiran kakitangan")} — ${month}`],
                [`# ${L("Generated", "Dijana")} ${csvStampMyt()}${active.length ? ` — ${L("filters", "tapisan")}: ${active.join(" · ")}` : ` — ${L("no filters", "tiada tapisan")}`}`],
                [`# ${rows.length} ${L("records", "rekod")}`],
                [],
                [L("Staff", "Kakitangan"), L("Type", "Jenis"), L("Date (MYT)", "Tarikh (MYT)"),
                 L("Time (MYT)", "Masa (MYT)"), L("Mark", "Tanda"), L("Day", "Hari"),
                 L("Scheduled hours", "Waktu berjadual"), L("Approval", "Kelulusan"),
                 L("Location", "Lokasi"), "Record ID"],
                ...rows.map((r) => {
                  const local = utcToMytLocal(r.created_at); // YYYY-MM-DDTHH:MM
                  return [
                    properName(r.name),
                    r.type === "clock_in" ? L("In", "Masuk") : L("Out", "Keluar"),
                    local.slice(0, 10),
                    local.slice(11, 16),
                    markOf(r),
                    r.day_kind === "rest_day" ? L("rest day", "hari rehat") : L("working day", "hari bekerja"),
                    r.shift_label ?? "",
                    r.pending ? L("waiting CEO", "menunggu CEO") : L("counted", "dikira"),
                    attLoc(r)?.text ?? L("no location", "tiada lokasi"),
                    r.id,
                  ];
                }),
              ],
            );
          }}>
          {L(`⬇ CSV — ${exportRows().length} rows`, `⬇ CSV — ${exportRows().length} baris`)}
        </button>
        <span className="text-muted-foreground flex items-end text-xs sm:col-span-2 lg:col-span-3">
          {(() => {
            const n = rows.filter(matches).length;
            return filtersOn
              ? L(`${n} of ${rows.length} records`, `${n} daripada ${rows.length} rekod`)
              : L(`${rows.length} records`, `${rows.length} rekod`);
          })()}
          {filtersOn && (
            <button type="button" className="ml-2 underline" onClick={clearFilters}>
              {L("Clear", "Kosongkan")}
            </button>
          )}
        </span>
      </div>
      )}

      {/* The records themselves are always here — the chooser above decides
          which FORM is open, never whether he can see the month. */}
      <div className="mt-3 max-h-[26rem] overflow-x-auto overflow-y-auto">
        <table className="tbl-sticky w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              {([["name", L("Staff", "Kakitangan")], ["type", L("Type", "Jenis")], ["time", L("Time (MYT)", "Masa (MYT)")], ["mark", L("Mark", "Tanda")]] as const).map(([k, label]) => (
                <th key={k} className={`${th} cursor-pointer select-none hover:underline`}
                  title={L("Click to sort — click again to reverse", "Klik untuk susun — klik lagi untuk terbalik")}
                  onClick={() => clickSort(k)}>
                  {label}{sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {/* v1.77.0 — skeleton until the first fetch lands: five columns
                (staff, type, time box, mark, actions), like the real rows. */}
            {!loaded && Array.from({ length: 6 }, (_, i) => (
              <tr key={`skel-${i}`} className="border-border border-b last:border-0" aria-hidden>
                <td className={td}><Skel className="h-4 w-28" /></td>
                <td className={td}><Skel className="h-4 w-10" /></td>
                <td className={td}><Skel className="h-7 w-44" /></td>
                <td className={td}><Skel className="h-3 w-14" /></td>
                <td className={td}><Skel className="h-7 w-24" /></td>
              </tr>
            ))}
            {loaded && rows.length === 0 && (
              <tr><td className={`${td} text-muted-foreground`} colSpan={5}>{L("No records this month.", "Tiada rekod bulan ini.")}</td></tr>
            )}
            {rows.length > 0 && filtersOn && rows.filter(matches).length === 0 && (
              <tr><td className={`${td} text-muted-foreground`} colSpan={5}>{L("Nothing matches these filters this month.", "Tiada yang sepadan dengan tapisan ini bulan ini.")}</td></tr>
            )}
            {exportRows().map((r) => (
              <tr key={r.id} className="border-border border-b last:border-0">
                <td className={td}>{properName(r.name)}</td>
                <td className={td}>{r.type === "clock_in" ? L("In", "Masuk") : L("Out", "Keluar")}</td>
                <td className={td}>
                  <input
                    type="datetime-local"
                    className="border-input bg-background rounded-lg border px-2 py-1 text-xs"
                    value={edit[r.id] ?? utcToMytLocal(r.created_at)}
                    onChange={(e) => setEdit((s) => ({ ...s, [r.id]: e.target.value }))}
                  />
                </td>
                <td className={`${td} text-xs`}>
                  <span className="text-muted-foreground">{r.manual_by ? L("manual", "manual") : r.amended_by ? L("amended", "dipinda") : L("punch", "ketuk")}</span>
                  {/* v1.76.0 — a rest-day punch is not an early-out against
                      hours that do not apply, and a pending one is a claim,
                      not a record. Both say so where the eye already is. */}
                  {r.day_kind === "rest_day" && (
                    <span className="text-info ml-1.5 whitespace-nowrap font-medium"
                      title={L("Outside this person's working days", "Di luar hari bekerja orang ini")}>
                      · {L("rest day", "hari rehat")}
                    </span>
                  )}
                  {/* v1.80.0 — outside the pattern, but on the roster or the
                      live board. Green because it is the good case: the
                      person was where they were told to be. */}
                  {r.assigned_what && (
                    <span className="text-success ml-1.5 font-medium"
                      title={L(`Outside the scheduled hours, but ${r.assigned_kind === "live" ? "a live session" : "a task on the roster"} covers this time — it counts as working time`, `Di luar waktu berjadual, tetapi ${r.assigned_kind === "live" ? "sesi LIVE" : "tugasan pada roster"} meliputi masa ini — ia dikira sebagai waktu bekerja`)}>
                      · {L("assigned", "ditugaskan")}: {r.assigned_what}
                    </span>
                  )}
                  {r.pending && (
                    <span className="text-warning ml-1.5 whitespace-nowrap font-semibold"
                      title={L("Forgotten punch — counts for nothing until the CEO approves it", "Ketukan terlupa — tidak dikira sehingga CEO meluluskannya")}>
                      · {L("waiting CEO", "menunggu CEO")}
                    </span>
                  )}
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
                        showToast(L("No changes", "Tiada perubahan"), `${r.name} ${L("— time unchanged", "— masa tidak berubah")}`, "notice");
                        return;
                      }
                      void act(`/attendance/${r.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ myt: current.replace("T", " ") }),
                      }, `${r.name} ${L("— record updated", "— rekod dikemas kini")}`);
                    }}>
                    {L("Save", "Simpan")}
                  </button>
                  <button type="button" className="text-destructive ml-2 text-xs underline"
                    onClick={() => void act(`/attendance/${r.id}`, { method: "DELETE" }, L("Record removed.", "Rekod dibuang."))}>
                    {L("Remove", "Buang")}
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
  /* v1.28.0 — per-document legal issuer (migration 0073). NULL/absent =
     legacy row = AZ ONE OFFICIAL; 'a2z' = A2Z CREATIVE MARKETING. */
  issuer_code?: string | null;
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
const receiptTooBig = () => L(`Receipt too large — the maximum is ${MAX_RECEIPT_MB} MB. Easy fix: send the photo to yourself on WhatsApp, save it from the chat back to your gallery (WhatsApp shrinks it a lot), then upload that copy.`, `Resit terlalu besar — maksimum ${MAX_RECEIPT_MB} MB. Cara mudah: hantar foto itu kepada diri sendiri di WhatsApp, simpan semula dari sembang ke galeri (WhatsApp memampatkannya banyak), kemudian muat naik salinan itu.`);

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
  await sharePdfFile(blob, `${no}.pdf`, `${L("Claim form", "Borang tuntutan")} ${no}`);
}

async function printClaimForm(c: Claim) {
  /* v1.28.0: the form names the EMPLOYER, so it forever carries the issuer
     stamped on the row — a legacy print stays AZ ONE OFFICIAL with its
     AZOO-HR-CLM document number; an A2Z form is a different controlled
     document with its own number and version (see lib/issuers.ts). */
  const issuer = resolveIssuer(c.issuer_code);
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
  w.document.write(`<p style="font-family:Arial;padding:20px;color:#5b6472">${L("Preparing claim form…", "Menyediakan borang tuntutan…")}</p>`);
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
  <title>${esc(claimNo)} — Employee Claim Form</title>
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
  <h1>${issuer.name}<small>LIVE &nbsp;·&nbsp; CONNECT &nbsp;·&nbsp; GROW</small></h1>
  <h2>Employee Claim Form</h2>
  <table class="meta">
    <tr><td class="k">Document No.</td><td class="v">${issuer.claimFormNo}</td><td class="k">Version</td><td class="v">${issuer.claimFormVersion}</td></tr>
    <tr><td class="k">Claim No.</td><td class="v">${esc(claimNo)}</td><td class="k">Date</td><td class="v">${mytStamp(c.created_at)}${c.created_at && c.created_at.length > 10 ? " MYT" : ""}</td></tr>
    <tr><td class="k">Employee</td><td class="v">${esc((c.claimant_full || c.claimant || "").toUpperCase())}</td><td class="k">Department</td><td class="v">${esc((c.claimant_department ?? "").toUpperCase())}</td></tr>
    <tr><td class="k">Position</td><td class="v">${esc((c.claimant_position ?? "").toUpperCase())}</td><td class="k">Purpose</td><td class="v">${esc(c.description ?? "")}</td></tr>
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
        const rows = its.map((it) => `<tr><td>${esc(dmy(it.claim_date))}</td><td style="text-transform:capitalize">${esc(it.category)}</td><td>${esc(it.description ?? "")}</td><td class="r">${rmv(it.amount_cents)}</td></tr>`);
        while (rows.length < 4) rows.push("<tr><td></td><td></td><td></td><td></td></tr>");
        return rows.join("");
      })()}
    </tbody>
  </table>
  <p class="total">Total Claimed: RM ${rmv(c.amount_cents)}</p>
  <p class="decl">Declaration: I certify the above expenses were incurred for official Company business.</p>
  <p class="sys">System status: ${esc(sysLine)}${c.decision_note ? " · Note: " + esc(c.decision_note) : ""}${chainLine ? " · " + esc(chainLine) : ""}</p>
  <table class="sig" style="margin-top:10px">
    <tr>
      <td class="hd2">Employee</td>
      <td class="hd2">Administrative or<br/>Head of Department (COO / CCO)</td>
      <td class="hd2">Chief Executive Officer (CEO)</td>
    </tr>
    <tr>
      <td class="body"><div class="cw"><div class="nm">Name: ${esc(c.claimant_full || c.claimant || "")}</div>
        <div class="sg">Signature:${empSig
          ? `<img class="sigimg" src="/api/v1/staff/claims/${c.id}/signature/emp" alt="" onerror="this.style.display='none'"/><span class="esub">(submitted in system)</span>`
          : ` <span class="esig">${esc(c.claimant_full || c.claimant || "")}</span><span class="esub">(submitted in system)</span>`}</div>
        <div class="dt">Date: ${mytStamp(c.created_at)}${c.created_at && c.created_at.length > 10 ? " MYT" : ""}</div></div></td>
      <td class="body"><div class="cw">${c.pre_approved_by_full || c.pre_approved_by_name
        ? `<div class="nm">Name: ${esc((c.pre_approved_by_full || c.pre_approved_by_name || "").toUpperCase())}</div>
           <div class="sg">Signature:<img class="sigimg" src="/api/v1/staff/claims/${c.id}/signature/pre" alt="" onerror="this.style.display='none'"/></div>
           <div class="dt">Date: ${c.pre_approved_at ? mytStamp(c.pre_approved_at) + " MYT" : ""}</div>`
        : `<div class="nm">Name:</div><div class="sg">Signature:</div><div class="dt">Date:</div>`}</div></td>
      <td class="body"><div class="cw"><div class="nm">Name: ${esc((c.decided_by_full || c.decided_by_name || "").toUpperCase())}</div>
        <div class="sg">Signature:${c.status === "approved" ? `<img class="sigimg" src="/api/v1/staff/claims/${c.id}/signature/ceo" alt="" onerror="this.style.display='none'"/>` : ""}</div>
        <div class="dt">Date: ${c.status === "approved" && c.decided_at ? mytStamp(c.decided_at) + " MYT" : ""}</div></div></td>
    </tr>
  </table>
  ${receiptImg ? `<div class="receiptwrap">${receiptImg}</div>` : receiptNote}
  <p class="foot">${issuer.name} · ${issuer.registration} · ${issuer.address.replace(/, Malaysia$/, "")} · This form accompanies the system record ${claimNo}; the in-system decision is authoritative.</p>
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

  /* v1.77.0 — skeleton until the first fetch lands (`claims` starts []). */
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const res = await api<{ claims: Claim[]; can_decide: boolean }>(`/claims`);
    if (res.ok && res.data) { setClaims(res.data.claims); setCanDecide(res.data.can_decide); }
    setLoaded(true);
  }, []);
  useEffect(() => { void load().finally(() => setLoaded(true)); }, [load]);
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
    if (filled.length === 0) { setMsg(L("Add at least one item (date + amount).", "Tambah sekurang-kurangnya satu item (tarikh + amaun).")); return; }
    if (filled.some((i) => !i.claim_date || !Number(i.amount))) { setMsg(L("Every item needs a date and an amount.", "Setiap item perlukan tarikh dan amaun.")); return; }
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
      if (!resE.ok) { setMsg(resE.data?.error?.message ?? L("Could not update the claim", "Tidak dapat mengemas kini tuntutan")); return; }
      if (receipt) {
        const compressedE = await compressImage(receipt);
        if (compressedE.size > MAX_RECEIPT_MB * 1024 * 1024) {
          showToast(L("No changes", "Tiada perubahan"), `${L("Claim updated WITHOUT the receipt.", "Tuntutan dikemas kini TANPA resit.")} ${receiptTooBig()}`, "notice");
        } else {
          const up = await csrfFetch(`/api/v1/staff/claims/${editingClaim.id}/receipt`, {
            method: "POST",
            headers: { "Content-Type": compressedE.type || receipt.type || "image/jpeg" },
            body: compressedE,
          });
          if (!up.ok) showToast(L("No changes", "Tiada perubahan"), `${L("Claim updated, but the receipt failed to upload.", "Tuntutan dikemas kini, tetapi resit gagal dimuat naik.")} ${receiptTooBig()}`, "notice");
        }
      }
      showToast(L("Saved", "Disimpan"), resE.data?.resubmitted ? L("Claim resubmitted — CEO notified for approval", "Tuntutan dihantar semula — CEO dimaklumkan untuk kelulusan") : L("Claim updated — still awaiting CEO approval", "Tuntutan dikemas kini — masih menunggu kelulusan CEO"));
      setPurpose(""); setItems([{ ...emptyItem }]); setReceipt(null); setEditingClaim(null); setPayeeId(0);
      void load();
      return;
    }
    const res = await api<{ id?: number; error?: { message?: string } }>(`/claims`, {
      method: "POST",
      body: JSON.stringify(payloadC),
    });
    if (!res.ok || !res.data?.id) { setMsg(res.data?.error?.message ?? L("Could not submit the claim", "Tidak dapat menghantar tuntutan")); return; }
    if (receipt) {
      const compressed = await compressImage(receipt); // PDFs pass through untouched
      if (compressed.size > MAX_RECEIPT_MB * 1024 * 1024) {
        showToast(L("No changes", "Tiada perubahan"), `${L("Claim submitted WITHOUT the receipt.", "Tuntutan dihantar TANPA resit.")} ${receiptTooBig()} ${L("Then use Edit on your claim to attach it.", "Kemudian guna Sunting pada tuntutan anda untuk melampirkannya.")}`, "notice");
      } else {
      const up = await csrfFetch(`/api/v1/staff/claims/${res.data.id}/receipt`, {
        method: "POST",
        headers: { "Content-Type": compressed.type || receipt.type || "image/jpeg" },
        body: compressed,
      });
      if (!up.ok) showToast(L("No changes", "Tiada perubahan"), `${L("Claim submitted, but the receipt failed to upload.", "Tuntutan dihantar, tetapi resit gagal dimuat naik.")} ${receiptTooBig()} ${L("Then use Edit on your claim to attach it.", "Kemudian guna Sunting pada tuntutan anda untuk melampirkannya.")}`, "notice");
      }
    }
    setPurpose(""); setItems([{ ...emptyItem }]); setPayeeId(0);
    setReceipt(null);
    showToast(L("Saved", "Disimpan"), L("Claim submitted — the CEO has been notified", "Tuntutan dihantar — CEO telah dimaklumkan"));
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
          title: L("Approve past the incomplete chain?", "Luluskan melangkaui rantaian yang belum lengkap?"),
          message: L("The approval chain has not finished for this claim.\nThe bypass will be recorded on the claim and in the audit log.", "Rantaian kelulusan belum selesai untuk tuntutan ini.\nPintasan ini akan direkodkan pada tuntutan dan dalam log audit."),
          confirmLabel: L("Approve as CEO", "Luluskan sebagai CEO"),
        }))) return;
      } else if (anyWaived) {
        if (!(await confirm({
          title: L("Approve directly?", "Luluskan terus?"),
          message: L("The pre-approver of this claim is its PAYEE, so their stage is waived (conflict of interest) — your direct decision is the designed route.\nThe waiver is recorded on the claim and in the audit log.", "Pra-pelulus tuntutan ini ialah PENERIMA BAYARANNYA, jadi peringkat mereka diketepikan (konflik kepentingan) — keputusan terus anda ialah laluan yang direka.\nPengecualian ini direkodkan pada tuntutan dan dalam log audit."),
          confirmLabel: L("Approve as CEO", "Luluskan sebagai CEO"),
        }))) return;
      }
    }
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/claims/${id}/decide`, { method: "POST", body: JSON.stringify({ action, note: note[id] || undefined }) });
    if (!res.ok) { showToast(L("No changes", "Tiada perubahan"), res.data?.error?.message ?? L("Decision failed", "Keputusan gagal"), "notice"); return; }
    showToast(L("Saved", "Disimpan"), `${L("Claim", "Tuntutan")} ${action === "approve" ? L("approved", "diluluskan") : L("rejected", "ditolak")} ${L("— claimant notified", "— penuntut dimaklumkan")}`);
    void load();
  };
  // v1.4.106: chain stage actions.
  const hrReview = async (id: number) => {
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/claims/${id}/review`, { method: "POST", body: JSON.stringify({}) });
    if (!res.ok) { showToast(L("No changes", "Tiada perubahan"), res.data?.error?.message ?? L("Review failed", "Semakan gagal"), "notice"); return; }
    showToast(L("Saved", "Disimpan"), L("HR review recorded — COO notified for pre-approval", "Semakan HR direkodkan — COO dimaklumkan untuk pra-kelulusan"));
    void load();
  };
  const preApprove = async (id: number) => {
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/claims/${id}/preapprove`, { method: "POST", body: JSON.stringify({}) });
    if (!res.ok) { showToast(L("No changes", "Tiada perubahan"), res.data?.error?.message ?? L("Pre-approval failed", "Pra-kelulusan gagal"), "notice"); return; }
    showToast(L("Saved", "Disimpan"), L("Pre-approved — CEO notified for final approval", "Pra-diluluskan — CEO dimaklumkan untuk kelulusan akhir"));
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
          <RecordToggle open={expanded === c.id} title={L("Purpose, items, receipt and decision", "Tujuan, item, resit dan keputusan")}
            onToggle={() => setExpanded((e) => e === c.id ? null : c.id)}>{claimNoOf(c)}</RecordToggle>{" · "}
          {c.claimant && <span className="font-medium">{properName(c.claimant)} · </span>}
          <span className="font-semibold">{rmc(c.amount_cents)}</span>{" "}
          {claimItems(c).length > 1
            ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{claimItems(c).length} {L("items", "item")}</span>
            : <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{catLabel(c.category)}</span>}{" "}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeCls[c.status] ?? "bg-secondary"}`}>{statusLabel(c.status)}</span>
          {c.status === "pending" && claimChainOf(c.claimant_role) === "staff" && (
            <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800"
              title={L("Chain: HR review → COO pre-approval → CEO final approval", "Rantaian: semakan HR → pra-kelulusan COO → kelulusan akhir CEO")}>
              {c.pre_approved_at ? L("HR ✓ · COO ✓ — CEO next", "HR ✓ · COO ✓ — CEO seterusnya") : c.hr_reviewed_at ? L("HR ✓ — awaiting COO", "HR ✓ — menunggu COO") : L("awaiting HR review", "menunggu semakan HR")}
            </span>
          )}
          {c.status === "pending" && claimChainOf(c.claimant_role) === "hr" && (
            <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800"
              title={L("Chain: CCO pre-approval → CEO final approval", "Rantaian: pra-kelulusan CCO → kelulusan akhir CEO")}>
              {c.pre_approved_at ? L("CCO ✓ — CEO next", "CCO ✓ — CEO seterusnya") : L("awaiting CCO", "menunggu CCO")}
            </span>
          )}
          {(c as Claim & { paid_at?: string | null }).paid_at && (
            <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700"
              title={L("Payment released by the CEO", "Bayaran dilepaskan oleh CEO")}>{L("💸 PAID", "💸 DIBAYAR")} {dmy((c as Claim & { paid_at?: string | null }).paid_at!.slice(0, 10))}</span>
          )}
        </p>
        {/* v1.4.253: date on the left, real buttons in the standard wrapping
            group — no more underlined words strung together with dots. */}
        <div className={`${rowActions} text-muted-foreground mt-1.5 justify-start text-xs`}>
          <span>{dmy(c.claim_date)}</span>
          {c.user_id === userId && ["pending", "rejected"].includes(c.status) && !c.receipt_key && (
            <>
              <label className={`${rowBtn} cursor-pointer`} title={L("Attach the receipt photo/PDF directly — no need to edit the claim", "Lampirkan foto/PDF resit terus — tidak perlu sunting tuntutan")}>
                {L("📎 Attach receipt", "📎 Lampirkan resit")}
                <input type="file" accept="image/*,application/pdf" className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    if (f.type === "application/pdf" && f.size > MAX_RECEIPT_MB * 1024 * 1024) { showToast(L("No changes", "Tiada perubahan"), receiptTooBig(), "notice"); return; }
                    if (f.size > 40 * 1024 * 1024) { showToast(L("No changes", "Tiada perubahan"), receiptTooBig(), "notice"); return; }
                    const comp = await compressImage(f);
                    if (comp.size > MAX_RECEIPT_MB * 1024 * 1024) { showToast(L("No changes", "Tiada perubahan"), receiptTooBig(), "notice"); return; }
                    const up = await csrfFetch(`/api/v1/staff/claims/${c.id}/receipt`, {
                      method: "POST",
                      headers: { "Content-Type": comp.type || f.type || "image/jpeg" }, body: comp,
                    });
                    if (up.ok) {
                      let resub = false;
                      try { resub = Boolean(((await up.json()) as { resubmitted?: boolean })?.resubmitted); } catch { /* body optional */ }
                      showToast(L("Saved", "Disimpan"), resub ? L("Receipt attached — claim RESUBMITTED for approval", "Resit dilampirkan — tuntutan DIHANTAR SEMULA untuk kelulusan") : L("Receipt attached to your claim", "Resit dilampirkan pada tuntutan anda"));
                      void load();
                    }
                    else {
                      let m = "";
                      try { m = ((await up.json()) as { error?: { message?: string } })?.error?.message ?? ""; } catch { /* not JSON */ }
                      showToast(L("No changes", "Tiada perubahan"), m || receiptTooBig(), "notice");
                    }
                  }} />
              </label>
            </>
          )}
          {c.user_id === userId && ["pending", "rejected"].includes(c.status) && (
            <>
              <button type="button" className={rowBtnDanger} title={L("Delete this claim — allowed while pending or rejected; approved/paid claims are permanent records", "Padam tuntutan ini — dibenarkan semasa menunggu atau ditolak; tuntutan diluluskan/dibayar ialah rekod kekal")}
                onClick={async () => {
                  if (!(await confirm({
                    title: `${L("Delete claim", "Padam tuntutan")} ${claimNoOf(c)}?`,
                    message: `RM ${rmBare(c.amount_cents)} ${L("— this cannot be undone. The attached receipt is removed too.", "— ini tidak boleh dibatalkan. Resit yang dilampirkan turut dibuang.")}`,
                    confirmLabel: L("Delete claim", "Padam tuntutan"), variant: "danger",
                  }))) return;
                  const r = await api<{ error?: { message?: string } }>(`/claims/${c.id}/delete`, { method: "POST", body: JSON.stringify({}) });
                  if (r.ok) { showToast(L("Saved", "Disimpan"), `${L("Claim", "Tuntutan")} ${claimNoOf(c)} ${L("deleted", "dipadam")}`); void load(); }
                  else showToast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Delete failed", "Padaman gagal"), "notice");
                }}>
                {L("Delete", "Padam")}
              </button>
              <button type="button" className={rowBtn} title={c.status === "rejected" ? L("Fix and resubmit for CEO approval", "Betulkan dan hantar semula untuk kelulusan CEO") : L("Edit — allowed until the CEO decides", "Sunting — dibenarkan sehingga CEO membuat keputusan")}
                onClick={() => {
                  setEditingClaim({ id: c.id, no: claimNoOf(c), wasRejected: c.status === "rejected" });
                  setPayeeId(c.payee_user_id ?? 0); // v1.4.173
                  setPurpose(c.description ?? "");
                  setItems(claimItems(c).map((it) => ({ claim_date: it.claim_date, category: it.category, description: it.description ?? "", amount: (it.amount_cents / 100).toString() })));
                  setReceipt(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}>
                {c.status === "rejected" ? L("Edit & resubmit", "Sunting & hantar semula") : L("Edit", "Sunting")}
              </button>
            </>
          )}
          {/* the payee mark stays visible without opening the record */}
          {c.payee_user_id === userId
            ? <span className="rounded-full bg-green-100 px-1.5 py-px text-[10px] font-medium text-green-800" title={L("This claim was raised on your behalf — the payment comes to you; track its status here", "Tuntutan ini dibuat bagi pihak anda — bayaran datang kepada anda; jejak statusnya di sini")}>{L("💰 pays to you", "💰 dibayar kepada anda")}</span>
            : c.payee_name ? <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800" title={`${L("Pay to", "Bayar kepada")} ${properName(c.payee_full || c.payee_name)} ${L("— internal remark", "— catatan dalaman")}`}>💰 → {firstName(c.payee_name)}</span> : null}
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
                <option value={0}>{`${L("— pay the submitter", "— bayar penghantar")} (${properName(c.claimant_full || c.claimant || "")}) —`}</option>
                {staffOptions.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)} · {u.role.replace(/_/g, " ")}</option>)}
              </select>
              <button type="button" className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
                onClick={async () => {
                  const res = await api<{ ok?: boolean; unchanged?: boolean; error?: { message?: string } }>(`/claims/${c.id}/payee`, {
                    method: "POST", body: JSON.stringify({ payee_user_id: payeeEdit.value }),
                  });
                  if (!res.ok) { showToast(L("No changes", "Tiada perubahan"), res.data?.error?.message ?? L("Could not save the payee", "Tidak dapat menyimpan penerima bayaran"), "notice"); return; }
                  showToast(res.data?.unchanged ? L("No changes", "Tiada perubahan") : L("Saved", "Disimpan"), res.data?.unchanged ? L("Payee is already set to that", "Penerima bayaran sudah ditetapkan begitu") : L("Payee updated — recorded in the audit log", "Penerima bayaran dikemas kini — direkodkan dalam log audit"));
                  setPayeeEdit(null);
                  void load();
                }}>{L("Save payee", "Simpan penerima bayaran")}</button>
              <button type="button" className="text-xs underline" onClick={() => setPayeeEdit(null)}>{L("cancel", "batal")}</button>
            </span>
          ) : c.payee_user_id === userId ? (
            <p className="mt-1 rounded-lg border border-green-300 bg-green-100 px-2 py-1 text-xs font-semibold text-green-900">
              {L("💰 This claim was raised on your behalf by", "💰 Tuntutan ini dibuat bagi pihak anda oleh")} {properName(c.claimant_full || c.claimant || "")} {L("— the payment comes to YOU once the CEO approves. Follow the status chip above.", "— bayaran datang kepada ANDA setelah CEO meluluskan. Ikuti cip status di atas.")}
              {canPayee && <button type="button" className="ml-1.5 underline" onClick={() => setPayeeEdit({ claimId: c.id, value: c.payee_user_id ?? 0 })}>{L("✎ change", "✎ tukar")}</button>}
            </p>
          ) : c.payee_name ? (
            <p className="mt-1 rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900"
              title={L("Internal remark for the CEO (payment) and HR (records) — not printed on the claim form", "Catatan dalaman untuk CEO (bayaran) dan HR (rekod) — tidak dicetak pada borang tuntutan")}>
              {L("💰 Pay this claim to:", "💰 Bayar tuntutan ini kepada:")} {properName(c.payee_full || c.payee_name)}
              {canPayee && <button type="button" className="ml-1.5 underline" onClick={() => setPayeeEdit({ claimId: c.id, value: c.payee_user_id ?? 0 })}>{L("✎ change", "✎ tukar")}</button>}
            </p>
          ) : canPayee && (
            <p className="mt-1 rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900"
              title={L("No separate payee set — the payment goes to whoever submitted the claim", "Tiada penerima bayaran berasingan — bayaran pergi kepada penghantar tuntutan")}>
              {L("💰 Pay to:", "💰 Bayar kepada:")} {properName(c.claimant_full || c.claimant || "")} {L("(the submitter — no separate payee)", "(penghantar — tiada penerima bayaran berasingan)")}
              <button type="button" className="ml-1.5 underline" onClick={() => setPayeeEdit({ claimId: c.id, value: 0 })}>{L("✎ set payee", "✎ tetapkan penerima bayaran")}</button>
            </p>
          )}
          {c.description && <p className="text-muted-foreground mt-1 text-xs">{L("Purpose:", "Tujuan:")} {c.description}</p>}
          <div className="mt-1 space-y-0.5">
            {claimItems(c).map((it, i) => (
              <p key={i} className="text-muted-foreground text-xs">
                {dmy(it.claim_date)} · <span className="capitalize">{catLabel(it.category)}</span>
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
              ? <a className={rowBtn} href={`/api/v1/staff/claims/${c.id}/receipt`} target="_blank" rel="noreferrer">{L("View receipt", "Lihat resit")}</a>
              : <span className="text-muted-foreground text-xs">{L("No receipt attached", "Tiada resit dilampirkan")}</span>}
            <button type="button" className={rowBtn} title={L("Claim form as PDF — HR prints it, signatures are collected in ink; the system decision stays authoritative", "Borang tuntutan sebagai PDF — HR mencetaknya, tandatangan dikumpul dengan dakwat; keputusan sistem kekal muktamad")}
              onClick={() => void printClaimForm(c)}>{L("Print form", "Cetak borang")}</button>
            {/* v1.4.246: the real PDF file, straight into the phone's share sheet. */}
            <button type="button" className={rowBtn} title={L("Send the claim form as a PDF file", "Hantar borang tuntutan sebagai fail PDF")}
              onClick={() => void sendClaimPdf(c)}>{L("Send PDF", "Hantar PDF")}</button>
          </div>
          {c.decided_by_name && (
            <p className="text-muted-foreground mt-1 text-xs">
              {L("Decided by", "Diputuskan oleh")} {properName(c.decided_by_name)}{c.decision_note ? ` — ${c.decision_note}` : ""}
            </p>
          )}
          {canDecide && c.paid_at && !c.payment_proof_key && (
            <label className="border-border mt-2 inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
              title={L("Attach the bank-transfer slip as payout proof — the claimant is notified", "Lampirkan slip pindahan bank sebagai bukti bayaran — penuntut dimaklumkan")}>
              {L("📎 Attach payment receipt (bank slip)", "📎 Lampirkan resit bayaran (slip bank)")}
              <input type="file" accept="image/*,application/pdf" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (f.size > 40 * 1024 * 1024) { showToast(L("No changes", "Tiada perubahan"), L("Payment proof too large — maximum 8 MB.", "Bukti bayaran terlalu besar — maksimum 8 MB."), "notice"); return; }
                  const comp = await compressImage(f);
                  if (comp.size > 8 * 1024 * 1024) { showToast(L("No changes", "Tiada perubahan"), L("Payment proof too large — maximum 8 MB.", "Bukti bayaran terlalu besar — maksimum 8 MB."), "notice"); return; }
                  const up = await csrfFetch(`/api/v1/staff/claims/${c.id}/payment-proof`, {
                    method: "POST",
                    headers: { "Content-Type": comp.type || f.type || "image/jpeg" }, body: comp,
                  });
                  if (up.ok) { showToast(L("Saved", "Disimpan"), L("Payment receipt attached — claimant notified", "Resit bayaran dilampirkan — penuntut dimaklumkan")); void load(); }
                  else showToast(L("No changes", "Tiada perubahan"), L("Payment proof upload failed", "Muat naik bukti bayaran gagal"), "notice");
                }} />
            </label>
          )}
          {c.payment_proof_key && (c.user_id === userId || canDecide || role === "hr_admin") && (
            <p className="mt-1 text-xs">
              <a className="underline" href={`/api/v1/staff/claims/${c.id}/payment-proof`} target="_blank" rel="noreferrer">{L("View payment receipt (payout proof)", "Lihat resit bayaran (bukti bayaran)")}</a>
            </p>
          )}
          {canDecide && c.status === "approved" && !c.paid_at && (
            <button type="button" className="bg-primary text-primary-foreground mt-2 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
              onClick={async () => {
                const res = await api(`/claims/${c.id}/paid`, { method: "POST", body: JSON.stringify({}) });
                if (res.ok) { showToast(L("Saved", "Disimpan"), L("Claim marked PAID — claimant notified", "Tuntutan ditanda DIBAYAR — penuntut dimaklumkan")); void load(); }
              }}>
              {L("💸 Mark paid (money released)", "💸 Tanda dibayar (wang dilepaskan)")}
            </button>
          )}
        </>
      )}
      {actions && canDecide && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className="border-input bg-background h-8 flex-1 rounded-lg border px-2 text-xs" placeholder={L("Note (optional — sent to the claimant)", "Nota (pilihan — dihantar kepada penuntut)")}
            value={note[c.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [c.id]: e.target.value }))} />
          <button type="button" className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
            title={claimChainOf(c.claimant_role) === "staff" && !c.pre_approved_at ? L("Chain (HR → COO) not finished — approving now is a recorded CEO override", "Rantaian (HR → COO) belum selesai — meluluskan sekarang ialah pintasan CEO yang direkodkan") : claimChainOf(c.claimant_role) === "hr" && !c.pre_approved_at ? L("CCO pre-approval not done — approving now is a recorded CEO override", "Pra-kelulusan CCO belum dibuat — meluluskan sekarang ialah pintasan CEO yang direkodkan") : L("Final approval", "Kelulusan akhir")}
            onClick={() => void decide(c.id, "approve")}>{L("Approve", "Luluskan")}</button>
          <button type="button" className="border-border text-destructive inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            onClick={() => void decide(c.id, "reject")}>{L("Reject", "Tolak")}</button>
        </div>
      )}
      {/* v1.4.106 stage actions — HR review, COO/CCO pre-approval. No self-review.
          v1.4.175: no self-approval for the PAYEE either — instead of a dead
          button that the server would refuse, the payee-reviewer sees why the
          claim skips them. */}
      {c.status === "pending" && c.user_id !== userId && c.payee_user_id === userId && ["hr_admin", "coo", "cco"].includes(role) && (
        <p className="text-muted-foreground mt-2 text-xs">
          {L("⚖ Your stage is waived on this claim — it pays to you, so the CEO decides it directly.", "⚖ Peringkat anda diketepikan pada tuntutan ini — ia dibayar kepada anda, jadi CEO memutuskannya terus.")}
        </p>
      )}
      {c.status === "pending" && c.user_id !== userId && c.payee_user_id !== userId && (
        <>
          {["hr_admin", "admin", "super_admin"].includes(role) && claimChainOf(c.claimant_role) === "staff" && !c.hr_reviewed_at && (
            <button type="button" className="bg-primary text-primary-foreground mt-2 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
              onClick={() => void hrReview(c.id)}>{L("✔ HR review OK — pass to COO", "✔ Semakan HR OK — serah kepada COO")}</button>
          )}
          {(role === "coo" || ["admin", "super_admin"].includes(role)) && claimChainOf(c.claimant_role) === "staff" && c.hr_reviewed_at && !c.pre_approved_at && (
            <button type="button" className="bg-primary text-primary-foreground mt-2 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
              onClick={() => void preApprove(c.id)}>{L("✔ Pre-approve — pass to CEO", "✔ Pra-lulus — serah kepada CEO")}</button>
          )}
          {(role === "cco" || ["admin", "super_admin"].includes(role)) && claimChainOf(c.claimant_role) === "hr" && !c.pre_approved_at && (
            <button type="button" className="bg-primary text-primary-foreground mt-2 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
              onClick={() => void preApprove(c.id)}>{L("✔ Pre-approve — pass to CEO", "✔ Pra-lulus — serah kepada CEO")}</button>
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
            ? <>{L("Editing", "Menyunting")} {editingClaim.no}{editingClaim.wasRejected ? L(" (rejected — will resubmit)", " (ditolak — akan dihantar semula)") : ""} <button type="button" className="ml-1 text-xs font-normal underline" onClick={() => { setEditingClaim(null); setPurpose(""); setItems([{ ...emptyItem }]); setReceipt(null); setPayeeId(0); }}>{L("cancel", "batal")}</button></>
            : L("Submit a claim", "Hantar tuntutan")}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Expense claims from CEO, COO, CCO and HR — every claim is approved or rejected by the CEO, who is notified the moment you submit.", "Tuntutan perbelanjaan daripada CEO, COO, CCO dan HR — setiap tuntutan diluluskan atau ditolak oleh CEO, yang dimaklumkan sebaik sahaja anda hantar.")}
        </p>
        <label className="mt-3 block"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{L("Purpose (shown on the printed form, optional)", "Tujuan (dipapar pada borang bercetak, pilihan)")}</span>
        <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" placeholder={L("e.g. Office pantry restock", "cth. Tambah stok pantri pejabat")}
          value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label>
        {/* v1.4.173 (CEO): who the payment actually goes to when this claim
            is raised on behalf of someone. Internal remark — CEO pays by it,
            HR keeps it for records; NEVER printed on the claim form. */}
        {canPayee && (
          <label className="mt-2 block sm:max-w-md">
            <span className="text-muted-foreground mb-0.5 block text-[11px]">{L("💰 Pay claim to (optional — only when raised on behalf of someone; remark for CEO & HR, not printed on the form)", "💰 Bayar tuntutan kepada (pilihan — hanya apabila dibuat bagi pihak seseorang; catatan untuk CEO & HR, tidak dicetak pada borang)")}</span>
            <select className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" value={payeeId}
              onChange={(e) => setPayeeId(Number(e.target.value))}>
              <option value={0}>{L("— pay the submitter (normal claim) —", "— bayar penghantar (tuntutan biasa) —")}</option>
              {staffOptions.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)} · {u.role.replace(/_/g, " ")}</option>)}
            </select>
          </label>
        )}
        <div className="text-muted-foreground mt-2 hidden gap-2 text-xs sm:grid sm:grid-cols-[8.5rem_7rem_1fr_6.5rem_auto]">
          <span>{L("Date", "Tarikh")}</span><span>{L("Category", "Kategori")}</span><span>{L("Description", "Keterangan")}</span><span>{L("Amount (RM)", "Amaun (RM)")}</span><span />
        </div>
        {items.map((it, i) => (
          <div key={i} className="border-border mt-2 grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:mt-1 sm:grid-cols-[8.5rem_7rem_1fr_6.5rem_auto] sm:rounded-none sm:border-0 sm:p-0">
            <label className="text-muted-foreground block text-[11px] sm:hidden">{L("Date", "Tarikh")}
              <input type="date" className="border-input bg-background mt-0.5 h-9 w-full rounded-lg border px-2 text-sm"
                value={it.claim_date} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, claim_date: e.target.value } : x))} />
            </label>
            <input type="date" className="border-input bg-background hidden h-9 rounded-lg border px-2 text-sm sm:block"
              value={it.claim_date} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, claim_date: e.target.value } : x))} />
            <label className="text-muted-foreground block text-[11px] sm:hidden">{L("Category", "Kategori")}
              <select className="border-input bg-background mt-0.5 h-9 w-full rounded-lg border px-2 text-sm capitalize" value={it.category}
                onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, category: e.target.value } : x))}>
                {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
              </select>
            </label>
            <select className="border-input bg-background hidden h-9 rounded-lg border px-2 text-sm capitalize sm:block" value={it.category}
              onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, category: e.target.value } : x))}>
              {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
            <label className="text-muted-foreground col-span-2 block text-[11px] sm:hidden">{L("Description", "Keterangan")}
              <input className="border-input bg-background mt-0.5 h-9 w-full min-w-0 rounded-lg border px-2 text-sm" placeholder={L("e.g. Grab to client meeting", "cth. Grab ke mesyuarat pelanggan")}
                value={it.description} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x))} />
            </label>
            <input className="border-input bg-background hidden h-9 min-w-0 rounded-lg border px-2 text-sm sm:block" placeholder={L("e.g. Grab to client meeting", "cth. Grab ke mesyuarat pelanggan")}
              value={it.description} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x))} />
            <label className="text-muted-foreground block text-[11px] sm:hidden">{L("Amount (RM)", "Amaun (RM)")}
              <input type="number" min={0} step="0.01" className="border-input bg-background mt-0.5 h-9 w-full rounded-lg border px-2 text-sm" placeholder="0.00"
                value={it.amount} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))} />
            </label>
            <input type="number" min={0} step="0.01" className="border-input bg-background hidden h-9 rounded-lg border px-2 text-sm sm:block" placeholder="0.00"
              value={it.amount} onChange={(e) => setItems((a) => a.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))} />
            {items.length > 1
              ? <button type="button" className="text-destructive justify-self-end text-xs underline sm:justify-self-auto" onClick={() => setItems((a) => a.filter((_, xi) => xi !== i))}>{L("✕ Remove", "✕ Buang")}</button>
              : <span className="hidden sm:block" />}
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="text-xs underline" onClick={() => setItems((a) => [...a, { ...emptyItem }])}>{L("+ Add item", "+ Tambah item")}</button>
          <p className="text-sm font-semibold">
            {L("Total: RM", "Jumlah: RM")} {rmBare(Math.round(items.reduce((a, i) => a + (Number(i.amount) || 0), 0) * 100))}
          </p>
        </div>
        <div className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="border-border inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm hover:bg-secondary sm:justify-start">
            {receipt ? `${L("Receipt:", "Resit:")} ${receipt.name}` : L("Attach receipt (image/PDF)", "Lampirkan resit (imej/PDF)")}
            <input type="file" accept="image/*,application/pdf" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                // v1.4.110: PDFs can't be compressed client-side — hard limit
                // now. Oversized photos get a chance: compression runs on
                // submit, and only if still too big is the upload refused.
                if (f && f.type === "application/pdf" && f.size > MAX_RECEIPT_MB * 1024 * 1024) {
                  showToast(L("No changes", "Tiada perubahan"), receiptTooBig(), "notice");
                  e.target.value = "";
                  setReceipt(null);
                  return;
                }
                if (f && f.size > 40 * 1024 * 1024) {
                  showToast(L("No changes", "Tiada perubahan"), receiptTooBig(), "notice");
                  e.target.value = "";
                  setReceipt(null);
                  return;
                }
                setReceipt(f);
              }} />
          </label>
          <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium sm:justify-start"
            onClick={() => void submit()}>{editingClaim ? (editingClaim.wasRejected ? L("Resubmit for approval", "Hantar semula untuk kelulusan") : L("Update claim", "Kemas kini tuntutan")) : L("Submit claim", "Hantar tuntutan")}</button>
        </div>
        {msg && <p className="mt-2 text-xs font-medium text-amber-700">{msg}</p>}
      </div>

      {(canDecide || ["hr_admin", "coo", "cco", "admin", "super_admin"].includes(role)) && (
        <div className={card}>
          <p className="text-sm font-semibold">
            {L("Pending approvals", "Kelulusan menunggu")}
            {pending.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{pending.length}</span>
            )}
          </p>
          <div className="mt-3 space-y-2">
            {/* v1.77.0 — skeleton until the first fetch lands. */}
            {!loaded && <SkelRows rows={2} />}
            {loaded && pending.filter((c) => canDecide || c.user_id !== userId).length === 0 && <p className="text-muted-foreground text-sm">{L("Nothing awaiting your action.", "Tiada apa menunggu tindakan anda.")}</p>}
            {pending.filter((c) => canDecide || c.user_id !== userId).map((c) => claimRow(c, true))}
          </div>
        </div>
      )}

      <div className={card}>
        <p className="text-sm font-semibold">{canDecide ? L("All claims", "Semua tuntutan") : L("My claims", "Tuntutan saya")}</p>
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
              <span className="font-semibold">{dmy(nowMyt)} · {mine.length} {L("claim", "tuntutan")}{mine.length === 1 ? "" : L("s", "")} · {fmt(sum(mine))}</span>
              <span className="text-green-800">{L("Approved", "Diluluskan")} {approved.length} · {fmt(sum(approved))}</span>
              <span className="text-green-800">{L("— of which paid", "— daripadanya dibayar")} {paid.length} · {fmt(sum(paid))}</span>
              <span className="text-amber-700">{L("Pending", "Menunggu")} {pending.length} · {fmt(sum(pending))}</span>
              {rejected.length > 0 && <span className="text-red-700">{L("Rejected", "Ditolak")} {rejected.length} · {fmt(sum(rejected))}</span>}
              <span className="text-muted-foreground">{L("by claim date — matches the Expenses month figure", "ikut tarikh tuntutan — sepadan dengan angka bulan Perbelanjaan")}</span>
            </div>
          );
        })()}
        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
          {/* v1.77.0 — skeleton until the first fetch lands. */}
          {!loaded && <SkelRows rows={4} />}
          {loaded && (canDecide ? decided : mainList).length === 0 && <p className="text-muted-foreground text-sm">{L("No claims yet.", "Tiada tuntutan lagi.")}</p>}
          {(canDecide ? decided : mainList).map((c) => claimRow(c, false))}
        </div>
      </div>

      {role === "hr_admin" && (
        <div className={card}>
          <p className="text-sm font-semibold">{L("Approved claims history — compilation", "Sejarah tuntutan diluluskan — kompilasi")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Read-only: every CEO-approved claim, for printing the claim form and the payment receipt (payout proof) for HR records.", "Baca sahaja: setiap tuntutan yang diluluskan CEO, untuk mencetak borang tuntutan dan resit bayaran (bukti bayaran) untuk rekod HR.")}
          </p>
          <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
            {/* v1.77.0 — skeleton until the first fetch lands. */}
            {!loaded && <SkelRows rows={3} />}
            {loaded && hrHistory.length === 0 && <p className="text-muted-foreground text-sm">{L("No approved claims yet.", "Tiada tuntutan diluluskan lagi.")}</p>}
            {hrHistory.map((c) => (
              <div key={`hrh-${c.id}`} className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{claimNoOf(c)}</span>
                  <span className="text-muted-foreground"> · {properName(c.claimant_full || c.claimant || "")} · {rmc(c.amount_cents)}</span>
                  {c.paid_at
                    ? <span className="ml-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">{L("PAID", "DIBAYAR")} {dmy(c.paid_at)}</span>
                    : <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{L("payment due", "bayaran perlu dibuat")}</span>}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2 text-xs">
                  <button type="button" className={rowBtn} onClick={() => void printClaimForm(c)}>{L("Print form", "Cetak borang")}</button>
                  <button type="button" className={rowBtn} onClick={() => void sendClaimPdf(c)}>{L("Send PDF", "Hantar PDF")}</button>
                  {c.payment_proof_key && <a className={rowBtn} href={`/api/v1/staff/claims/${c.id}/payment-proof`} target="_blank" rel="noreferrer">{L("Payment proof", "Bukti bayaran")}</a>}
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
        role="button" tabIndex={0} aria-label={`${cat} ${L("details", "butiran")}`} aria-pressed={isActive}
        style={{ cursor: "pointer", outline: "none", transition: "stroke-width 150ms, opacity 150ms" }}
        onClick={() => onSelect(cat)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(cat); }} />
    );
  });
  return (
    <svg viewBox="0 0 120 120" className="h-40 w-40 shrink-0 sm:h-44 sm:w-44" role="img" aria-label={L("Expenses by category", "Perbelanjaan mengikut kategori")}>
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
  /* v1.77.0 — skeleton until the first fetch lands. `rows` starts [] so
     "No expenses recorded" and "Total RM 0.00" cannot be told from a month
     still loading; this flag flips once the expenses request settles. */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ expenses: ExpenseRec[]; upcoming?: ExpenseRec[]; staff_payroll?: { month: string; cents: number; paid_at?: string | null; entries?: { name: string; cents: number; saved_net: boolean }[] } | null; staff_claims?: { in_month: ClaimExp[]; paid: ClaimExp[]; due: ClaimExp[] } }>(`/expenses?month=${month}`);
    // v1.4.114: a failed load must SAY SO — a silent empty list looks like
    // data loss (the CEO's screenshot).
    setLoadError(res.ok ? "" : ((res.data as { error?: { message?: string } } | null)?.error?.message ?? L("Server error — expenses could not be loaded. If this version was just deployed, apply migrations 0037 + 0038 first.", "Ralat pelayan — perbelanjaan tidak dapat dimuatkan. Jika versi ini baru digunakan, laksanakan migrasi 0037 + 0038 dahulu.")));
    if (res.ok && res.data) {
      setRows(res.data.expenses);
      setUpcoming(res.data.upcoming ?? []);
      setStaffPayroll(res.data.staff_payroll ?? null);
      setStaffClaims(res.data.staff_claims ?? { in_month: [], paid: [], due: [] });
    }
    setLoaded(true); // the list is drawn from THIS response; the payroll due-date below is a side card
    // Payroll is the biggest recurring commitment — show its due date the
    // same way (previous month's payroll, payable by the release moment).
    const prev = (() => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y || 0, (m || 0) - 2, 1)); return d.toISOString().slice(0, 7); })();
    const pr = await api<{ release?: { available_from: string; released: { released_at: string } | null } }>(`/payroll?month=${prev}`);
    if (pr.ok && pr.data?.release) {
      setPayrollDue({ month: prev, by: pr.data.release.available_from, released: Boolean(pr.data.release.released) });
    }
  }, [month]);
  useEffect(() => { void load().finally(() => setLoaded(true)); }, [load]); // v1.77.0 — a failed request clears the skeleton too

  const rmc = fmtRM; // v1.4.272: global
  const total = rows.reduce((a, r) => a + r.amount_cents, 0);

  const addExpense = async () => {
    if (!draft.expense_date || !Number(draft.amount)) { setMsg(L("Date and amount are required.", "Tarikh dan amaun diperlukan.")); return; }
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
    if (!res.ok) { setMsg(res.data?.error?.message ?? L("Could not record the expense", "Tidak dapat merekodkan perbelanjaan")); return; }
    showToast(L("Saved", "Disimpan"), `${L("Expense recorded —", "Perbelanjaan direkodkan —")} ${rmc(Math.round(Number(draft.amount) * 100))}`);
    setDraft({ expense_date: "", category: "software", amount: "", vendor: "", description: "", recurring: false, due_day: "" });
    void load();
  };

  return (
    <div className="space-y-4">
      {toastNode}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{L("Company expenses", "Perbelanjaan syarikat")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("Operating costs the company pays — rent, software, ads, logistics. Staff reimbursements belong in Claims (approved by the CEO), not here.", "Kos operasi yang dibayar syarikat — sewa, perisian, iklan, logistik. Pembayaran balik kakitangan tergolong dalam Tuntutan (diluluskan oleh CEO), bukan di sini.")}
            </p>
          </div>
          <input type="month" className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
            value={month} max={new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7)}
            onChange={(e) => setMonth(e.target.value)} />
        </div>
        {/* v1.4.154: standard widths — 2-up full-width grid on phones, capped
            inline row from sm: (portal-wide pattern). */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <label className="block"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{L("Expense date", "Tarikh perbelanjaan")}</span>
          <input type="date" className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:max-w-44" title={L("Expense date", "Tarikh perbelanjaan")}
            value={draft.expense_date} onChange={(e) => setDraft((d) => ({ ...d, expense_date: e.target.value }))} /></label>
          <label className="block"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{L("Category", "Kategori")}</span>
          <select className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm capitalize sm:max-w-40" value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
          </select></label>
          <label className="block"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{L("Amount (RM)", "Amaun (RM)")}</span>
          <input type="number" min={0} step="0.01" className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:max-w-36" placeholder="0.00"
            value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
          <label className="block sm:max-w-52 sm:flex-1"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{L("Vendor (optional)", "Vendor (pilihan)")}</span>
          <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" placeholder={L("e.g. TNB, Shopee", "cth. TNB, Shopee")}
            value={draft.vendor} onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value }))} /></label>
        </div>
        {/* v1.4.186 mobile audit: on phones the description was squeezed to a
            sliver sharing one line with recurring + due day. Phone layout is
            now the v1.4.154 grid — description full-width on its own row,
            recurring/due-day a clean row, button full-width centred; from sm:
            the original single inline row returns. */}
        <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <label className="col-span-2 block min-w-0 sm:flex-1"><span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{L("Description (optional)", "Keterangan (pilihan)")}</span>
          <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" placeholder={L("What was this for?", "Untuk apa perbelanjaan ini?")}
            value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></label>
          <label className="flex h-9 items-center gap-1.5 text-sm whitespace-nowrap" title={L("A recurring expense reappears every month as due until you record it", "Perbelanjaan berulang muncul semula setiap bulan sebagai perlu dibayar sehingga anda merekodkannya")}>
            <input type="checkbox" checked={draft.recurring} onChange={(e) => setDraft((d) => ({ ...d, recurring: e.target.checked }))} />
            {L("Monthly recurring", "Berulang bulanan")}
          </label>
          <label className="flex h-9 items-center justify-end gap-1.5 text-sm whitespace-nowrap sm:justify-start" title={L("Day of the month the payment must be made by", "Hari dalam bulan bayaran mesti dibuat")}>
            {L("Due day", "Hari akhir bayaran")}
            <input type="number" min={1} max={31} className="border-input bg-background h-9 w-16 rounded-lg border px-2 text-sm" placeholder="—"
              value={draft.due_day} onChange={(e) => setDraft((d) => ({ ...d, due_day: e.target.value }))} />
          </label>
          <button type="button" className="bg-primary text-primary-foreground col-span-2 inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium sm:col-span-1"
            onClick={() => void addExpense()}>{L("Record expense", "Rekod perbelanjaan")}</button>
        </div>
        {msg && <p className="text-destructive mt-2 text-xs font-medium">{msg}</p>}
      </div>

      {(payrollDue || upcoming.length > 0 || staffClaims.due.length > 0 || rows.some((r) => r.due_day && !r.paid_at)) && (
        <div className={card}>
          <p className="text-sm font-semibold">{L("💳 Payments due —", "💳 Bayaran perlu dibuat —")} {dmy(month)}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Commit each payment before its due date. Recurring expenses from earlier months appear here until recorded for this month.", "Buat setiap bayaran sebelum tarikh akhirnya. Perbelanjaan berulang dari bulan terdahulu muncul di sini sehingga direkodkan untuk bulan ini.")}
          </p>
          <div className="mt-3 space-y-2">
            {payrollDue && (
              <div className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-semibold">
                    {L("Staff payroll —", "Gaji kakitangan —")} {dmy(payrollDue.month)}
                    {staffPayroll && staffPayroll.month === payrollDue.month && (
                      staffPayroll.cents > 0
                        ? <span className="ml-2">{rmc(staffPayroll.cents)}</span>
                        : <span className="text-muted-foreground ml-2 text-xs font-normal">{L("(figure appears once", "(angka muncul setelah gaji")} {dmy(payrollDue.month)} {L("payroll is processed in the Payroll tab — it counts in THIS month's total)", "diproses dalam tab Gaji — ia dikira dalam jumlah bulan INI)")}</span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {L("Pay by", "Bayar sebelum")} <span className="font-medium">{dmy(payrollDue.by.split(" ")[0])}, {payrollDue.by.split(" ")[1]} MYT</span> {L("(payslips release then) · sum of SAVED payslip nets — after any change in the Payroll tab, press Save all there so this figure matches", "(slip gaji dikeluarkan ketika itu) · jumlah bersih slip gaji TERSIMPAN — selepas sebarang perubahan dalam tab Gaji, tekan Simpan semua di sana supaya angka ini sepadan")}
                  </p>
                  {(staffPayroll?.entries?.length ?? 0) > 0 && staffPayroll?.month === payrollDue.month && (
                    <details className="mt-1 text-xs">
                      <summary className="text-muted-foreground cursor-pointer select-none">
                        {L("Breakdown —", "Pecahan —")} {staffPayroll!.entries!.length} {L("saved", "tersimpan")} {staffPayroll!.entries!.length === 1 ? L("entry", "entri") : L("entries", "entri")} {L("(compare with the Payroll tab: extra or missing names / different figures = rows not yet re-saved)", "(bandingkan dengan tab Gaji: nama lebih atau hilang / angka berbeza = baris belum disimpan semula)")}
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {staffPayroll!.entries!.map((r, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>{properName(r.name)}{!r.saved_net && <span className="text-amber-700" title={L("Saved before the net-storing update — figure recomputed by the server. Press Save all in the Payroll tab to store the exact net.", "Disimpan sebelum kemas kini penyimpanan bersih — angka dikira semula oleh pelayan. Tekan Simpan semua dalam tab Gaji untuk menyimpan bersih yang tepat.")}>{L(" · recomputed ⚠", " · dikira semula ⚠")}</span>}</span>
                            <span className="tabular-nums">{rmc(r.cents)}</span>
                          </li>
                        ))}
                      </ul>
                      <button type="button"
                        className="border-border mt-1.5 inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium hover:bg-secondary"
                        title={L("Server-side repair: recomputes this month's working days from the holiday calendar and re-stores every entry's net — no Save all needed", "Pembaikan di pelayan: mengira semula hari bekerja bulan ini daripada kalendar cuti dan menyimpan semula bersih setiap entri — tiada Simpan semua diperlukan")}
                        onClick={async () => {
                          const r = await api<{ working_days?: number; rows?: number; error?: { message?: string } }>(`/payroll/recompute`, {
                            method: "POST", body: JSON.stringify({ month: staffPayroll!.month }),
                          });
                          if (r.ok) { showToast(L("Saved", "Disimpan"), `${L("Recomputed", "Dikira semula")} ${r.data?.rows ?? 0} ${L("entries at", "entri pada")} ${r.data?.working_days ?? "?"} ${L("working days — figures now match everywhere", "hari bekerja — angka kini sepadan di mana-mana")}`); void load(); }
                          else showToast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Recompute failed", "Pengiraan semula gagal"), "notice");
                        }}>
                        {L("🔧 Fix discrepancy now (recompute on server)", "🔧 Betulkan percanggahan sekarang (kira semula di pelayan)")}
                      </button>
                      <button type="button"
                        className="border-border ml-2 mt-1.5 inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium hover:bg-secondary"
                        title={L("Downloads the official Maybank2E template ALREADY FILLED (Home sheet + salary rows). Needs the one-time ⚙ M2E setup in the Payroll tab. Open → enable macros → generate → upload → approve → Mark paid here", "Muat turun templat rasmi Maybank2E yang SUDAH DIISI (helaian Home + baris gaji). Perlukan tetapan ⚙ M2E sekali sahaja dalam tab Gaji. Buka → benarkan makro → jana → muat naik → lulus → Tanda dibayar di sini")}
                        onClick={async () => {
                          const res = await fetch(`/api/v1/staff/payroll/m2e-file?month=${staffPayroll!.month}`, { credentials: "include" });
                          if (!res.ok) {
                            const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
                            showToast(L("No file", "Tiada fail"), j?.error?.message ?? L("M2E file failed — check ⚙ M2E setup in the Payroll tab", "Fail M2E gagal — semak tetapan ⚙ M2E dalam tab Gaji"), "notice");
                            return;
                          }
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url; a.download = `azoo-m2e-salary-${staffPayroll!.month}.xlsm`; a.click();
                          URL.revokeObjectURL(url);
                          showToast(L("Saved", "Disimpan"), L("M2E workbook downloaded — open, enable macros, generate + upload", "Buku kerja M2E dimuat turun — buka, benarkan makro, jana + muat naik"));
                        }}>
                        {L("💳 M2E salary file", "💳 Fail gaji M2E")}
                      </button>
                    </details>
                  )}
                </div>
                <span className="flex items-center gap-1.5">
                  {staffPayroll?.paid_at
                    ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700"
                        title={`${L("Payment recorded", "Bayaran direkodkan")} ${dmy(staffPayroll.paid_at.slice(0, 10))}`}>{L("💸 PAID", "💸 DIBAYAR")}</span>
                    : (
                      <>
                        {payrollDue.released
                          ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">{L("RELEASED", "DILEPASKAN")}</span>
                          : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{L("DUE", "PERLU DIBAYAR")}</span>}
                        <button type="button" className={rowBtnPrimary}
                          title={L("Record that the salary bank run is done — the DUE pill clears and the payment moves to Payments completed", "Rekodkan bahawa bayaran gaji bank telah dibuat — pil PERLU DIBAYAR hilang dan bayaran berpindah ke Bayaran selesai")}
                          onClick={async () => {
                            const res = await api(`/payroll/paid`, { method: "POST", body: JSON.stringify({ month: payrollDue.month }) });
                            if (res.ok) { showToast(L("Saved", "Disimpan"), L("Payroll payment recorded", "Bayaran gaji direkodkan")); void load(); }
                          }}>{L("Mark paid", "Tanda dibayar")}</button>
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
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{L("staff claim", "tuntutan kakitangan")}</span>
                    {c.claimant && <span className="text-muted-foreground"> · {properName(c.claimant)}</span>}
                  </p>
                  <p className="text-muted-foreground text-xs">{L("Approved", "Diluluskan")}{c.decided_at ? ` ${dmy(c.decided_at.slice(0, 10))}` : ""}{L(" — pay the claimant, then press 💸 Mark paid on the Claims tab", " — bayar penuntut, kemudian tekan 💸 Tanda dibayar pada tab Tuntutan")}</p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{L("DUE", "PERLU DIBAYAR")}</span>
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
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{catLabel(r.category)}</span>
                      {r.vendor && <span className="text-muted-foreground"> · {r.vendor}</span>}
                      <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">{L("↻ recurring", "↻ berulang")}</span>
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {r.due_day ? `${L("Due", "Perlu dibayar")} ${dmy(dueISO)}` : L("No due day set", "Tiada hari akhir ditetapkan")}
                      {r.description ? ` · ${r.description}` : ""}{L(" · last recorded ", " · terakhir direkod ")}{dmy(r.expense_date)}
                    </p>
                  </div>
                  <button type="button" className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
                    onClick={async () => {
                      const res = await api(`/expenses`, { method: "POST", body: JSON.stringify({
                        expense_date: dueISO, category: r.category, amount: r.amount_cents / 100,
                        vendor: r.vendor || undefined, description: r.description || undefined,
                        recurring: true, due_day: r.due_day ?? undefined,
                      }) });
                      if (res.ok) { showToast(L("Saved", "Disimpan"), `${L("Recorded for", "Direkodkan untuk")} ${dmy(month)} ${L("— mark it paid once committed", "— tanda dibayar setelah bayaran dibuat")}`); void load(); }
                    }}>
                    {L("Record for this month", "Rekod untuk bulan ini")}
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
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{catLabel(r.category)}</span>
                      {r.vendor && <span className="text-muted-foreground"> · {r.vendor}</span>}
                    </p>
                    <p className="mt-0.5 text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {overdue ? L("OVERDUE", "TERTUNGGAK") : L("DUE", "PERLU DIBAYAR")} {dmy(dueISO)}
                      </span>
                    </p>
                  </div>
                  <button type="button" className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
                    onClick={async () => { await api(`/expenses/${r.id}/paid`, { method: "POST" }); showToast(L("Saved", "Disimpan"), `${rmc(r.amount_cents)} ${L("marked paid", "ditanda dibayar")}`); void load(); }}>
                    {L("Mark paid", "Tanda dibayar")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={card}>
        {/* v1.77.0 — skeleton until the first fetch lands: the month heading
            with its total on the right, then the expense rows — so neither
            "Total RM 0.00" nor "No expenses recorded" shows while loading. */}
        {!loaded ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2" aria-hidden>
              <Skel className="h-4 w-40" />
              <div className="space-y-1.5">
                <Skel className="ml-auto h-4 w-32" />
                <Skel className="ml-auto h-3 w-48 max-w-full" />
              </div>
            </div>
            <SkelRows rows={5} className="mt-3" />
          </>
        ) : (
          <>
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
                <p className="text-sm font-semibold">{L("✅ Payments completed —", "✅ Bayaran selesai —")} {dmy(month)}</p>
                <p className="text-sm font-semibold">{rmc(doneTotal)}</p>
              </div>
              <div className="mt-2 space-y-1">
                {payrollDone && (
                  <p className="text-muted-foreground text-xs">
                    💸 <span className="text-foreground font-medium">{rmc(payrollDone.cents)}</span> {L("· Staff payroll", "· Gaji kakitangan")} ({dmy(payrollDone.month)}) {L("· released", "· dilepaskan")} {dmy(payrollDone.paid_at!.slice(0, 10))}
                  </p>
                )}
                {staffClaims.paid.map((c) => (
                  <p key={`clmdone-${c.id}`} className="text-muted-foreground text-xs">
                    🧾 <span className="text-foreground font-medium">{rmc(c.amount_cents)}</span> {L("· Staff claim", "· Tuntutan kakitangan")}{c.claimant ? ` — ${properName(c.claimant)}` : ""} {L("· paid", "· dibayar")} {c.paid_at ? dmy(c.paid_at.slice(0, 10)) : ""}
                  </p>
                ))}
                {done.map((r) => (
                  <p key={`done-${r.id}`} className="text-muted-foreground text-xs">
                    <span className="text-foreground font-medium">{rmc(r.amount_cents)}</span> · <span className="capitalize">{catLabel(r.category)}</span>
                    {r.vendor ? ` · ${r.vendor}` : ""}{r.description ? ` · ${r.description}` : ""}{L(" · paid ", " · dibayar ")}{dmy(r.paid_at!.slice(0, 10))}
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
              <p className="text-sm font-semibold">{L("📊 Expenses by category —", "📊 Perbelanjaan mengikut kategori —")} {dmy(month)}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">{L("Tap a slice or a category for its records.", "Ketik hirisan atau kategori untuk rekodnya.")}</p>
              <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
                <ExpensePie slices={slices} active={pieCat}
                  onSelect={(c) => setPieCat((cur) => (cur === c ? null : c))}
                  centerTop={pieCat ? catLabel(pieCat) : L("Total", "Jumlah")}
                  centerBottom={rmc(pieCat ? catTotal : totalPie)} />
                <div className="grid grid-cols-1 w-full gap-1 text-xs sm:w-auto">
                  {slices.map(([cat, v]) => (
                    <button key={cat} type="button"
                      onClick={() => setPieCat((cur) => (cur === cat ? null : cat))}
                      className={
                        "flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 text-left " +
                        (pieCat === cat ? "bg-secondary font-semibold" : "hover:bg-secondary/60")
                      }>
                      <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: PIE_COLORS[cat] ?? PIE_COLORS.other }} />
                      <span className="font-medium capitalize">{catLabel(cat)}</span>
                      <span className="text-muted-foreground ml-auto tabular-nums">{rmc(v)} · {((v / totalPie) * 100).toFixed(v / totalPie < 0.1 ? 1 : 0)}%</span>
                    </button>
                  ))}
                  <p className="text-muted-foreground mt-1 px-2">{L("Expense records only — payroll and claims have their own lines above.", "Rekod perbelanjaan sahaja — gaji dan tuntutan ada barisnya sendiri di atas.")}</p>
                </div>
              </div>
              {pieCat && (
                <div className="border-border mt-2 rounded-lg border p-2">
                  <p className="text-xs font-semibold capitalize">{catLabel(pieCat)} — {catRows.length} {L("record", "rekod")}{catRows.length === 1 ? "" : L("s", "")} · {rmc(catTotal)}</p>
                  <div className="mt-1 grid grid-cols-1 gap-1 text-xs">
                    {catRows.map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-x-2">
                        <span className="font-semibold tabular-nums">{rmc(r.amount_cents)}</span>
                        <span>{r.vendor || r.description || "—"}</span>
                        <span className="text-muted-foreground">{dmy(r.expense_date)}</span>
                        {r.paid_at
                          ? <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">{L("PAID", "DIBAYAR")}</span>
                          : <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{L("outstanding", "tertunggak")}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null;
        })()}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{dmy(month)} {L("expenses", "perbelanjaan")}</p>
          <div className="text-right">
            <p className="text-sm font-semibold">{L("Total", "Jumlah")} {rmc(total + (staffPayroll?.cents ?? 0) + staffClaims.in_month.reduce((a, r) => a + r.amount_cents, 0))}</p>
            {staffPayroll && staffPayroll.cents > 0 && (
              <p className="text-muted-foreground text-xs">
                {L("incl. staff payroll", "termasuk gaji kakitangan")} {rmc(staffPayroll.cents)} ({dmy(staffPayroll.month)}) {L("+ expenses", "+ perbelanjaan")} {rmc(total)}{staffClaims.in_month.length > 0 ? ` ${L("+ staff claims", "+ tuntutan kakitangan")} ${rmc(staffClaims.in_month.reduce((a, r) => a + r.amount_cents, 0))} (${staffClaims.in_month.length}${L(", by claim date", ", ikut tarikh tuntutan")})` : ""}
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
                  <span className="font-medium text-green-700">{L("Paid", "Dibayar")} {rmc(grand - outstanding)}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="font-bold text-amber-700">{L("Outstanding", "Tertunggak")} {rmc(outstanding)}</span>
                  <span className="text-muted-foreground"> ({items} {L("to clear", "untuk dijelaskan")})</span>
                </p>
              ) : (
                <p className="mt-0.5 text-xs font-medium text-green-700">{L("✅ All cleared —", "✅ Semua dijelaskan —")} {rmc(grand)} {L("paid", "dibayar")}</p>
              );
            })()}
          </div>
        </div>
        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
          {loadError && <p className="mb-2 text-sm font-medium text-amber-700">⚠ {loadError}</p>}
          {rows.length === 0 && !loadError && (
            <p className="text-muted-foreground text-sm">
              {L("No expenses recorded for this month. This tab shows ONE month at a time — earlier records (e.g. July) are under the month picker at the top right.", "Tiada perbelanjaan direkodkan untuk bulan ini. Tab ini menunjukkan SATU bulan pada satu masa — rekod terdahulu (cth. Julai) berada di bawah pemilih bulan di penjuru kanan atas.")}
            </p>
          )}
          {rows.map((r) => editId === r.id ? (
            <div key={r.id} className="border-border rounded-lg border px-3 py-2">
              <div className="flex flex-wrap gap-2">
                <input type="date" className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm sm:w-auto sm:max-w-40"
                  value={edit.expense_date} onChange={(e) => setEdit((d) => ({ ...d, expense_date: e.target.value }))} />
                <select className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm capitalize sm:w-auto sm:max-w-36"
                  value={edit.category} onChange={(e) => setEdit((d) => ({ ...d, category: e.target.value }))}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                </select>
                <input type="number" min={0} step="0.01" className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm sm:w-auto sm:max-w-32"
                  placeholder={L("Amount (RM)", "Amaun (RM)")} value={edit.amount} onChange={(e) => setEdit((d) => ({ ...d, amount: e.target.value }))} />
                <input className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm sm:max-w-48 sm:flex-1" placeholder={L("Vendor", "Vendor")}
                  value={edit.vendor} onChange={(e) => setEdit((d) => ({ ...d, vendor: e.target.value }))} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input className="border-input bg-background h-8 min-w-0 flex-1 rounded-lg border px-2 text-sm" placeholder={L("Description", "Keterangan")}
                  value={edit.description} onChange={(e) => setEdit((d) => ({ ...d, description: e.target.value }))} />
                <button type="button" className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
                  onClick={async () => {
                    const unchanged = edit.expense_date === r.expense_date && edit.category === r.category
                      && Math.round(Number(edit.amount) * 100) === r.amount_cents
                      && edit.vendor === (r.vendor ?? "") && edit.description === (r.description ?? "");
                    if (unchanged) { showToast(L("No changes", "Tiada perubahan"), L("Nothing to save", "Tiada apa untuk disimpan"), "notice"); setEditId(null); return; }
                    if (!edit.expense_date || !Number(edit.amount)) return;
                    const res = await api(`/expenses/${r.id}`, { method: "PATCH", body: JSON.stringify({
                      expense_date: edit.expense_date, category: edit.category, amount: Number(edit.amount),
                      vendor: edit.vendor, description: edit.description,
                    }) });
                    if (res.ok) { showToast(L("Saved", "Disimpan"), L("Expense updated", "Perbelanjaan dikemas kini")); setEditId(null); void load(); }
                  }}>{L("Save", "Simpan")}</button>
                <button type="button" className="text-xs underline" onClick={() => setEditId(null)}>{L("Cancel", "Batal")}</button>
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
                  <RecordToggle open={openExp === r.id} title={L("Date, description and who recorded it", "Tarikh, keterangan dan siapa yang merekodkannya")}
                    className="font-semibold" onToggle={() => setOpenExp(openExp === r.id ? null : r.id)}>{rmc(r.amount_cents)}</RecordToggle>{" "}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{catLabel(r.category)}</span>
                  {r.vendor && <span className="text-muted-foreground"> · {r.vendor}</span>}
                  {r.paid_at
                    ? <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700">{L("✓ PAID", "✓ DIBAYAR")} {dmy(r.paid_at.slice(0, 10))}</span>
                    : r.due_day
                      ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">{L("DUE", "PERLU DIBAYAR")} {String(r.due_day).padStart(2, "0")}-{month.split("-")[1]}</span>
                      : null}
                </p>
              </div>
              <span className={rowActions}>
                {/* v1.4.208 (CEO: "track that I have paid and how many more
                    outstanding … remaining amount I should clear off"):
                    paid state is set right on the row; Undo covers a
                    misclick (toggle route). */}
                {r.paid_at ? (
                  <button type="button" className={rowBtn} title={L("Clear the paid mark (misclick)", "Kosongkan tanda dibayar (tersilap klik)")}
                    onClick={async () => { const res = await api(`/expenses/${r.id}/paid`, { method: "POST", body: JSON.stringify({ paid: false }) }); if (res.ok) { showToast(L("Saved", "Disimpan"), L("Paid mark cleared — back to outstanding", "Tanda dibayar dikosongkan — kembali tertunggak")); void load(); } }}>{L("Undo paid", "Buat asal dibayar")}</button>
                ) : (
                  <button type="button" className={rowBtnGood} title={L("Record that this expense has been paid", "Rekodkan bahawa perbelanjaan ini telah dibayar")}
                    onClick={async () => { const res = await api(`/expenses/${r.id}/paid`, { method: "POST", body: JSON.stringify({}) }); if (res.ok) { showToast(L("Saved", "Disimpan"), L("Marked paid ✓", "Ditanda dibayar ✓")); void load(); } }}>{L("Mark paid", "Tanda dibayar")}</button>
                )}
                {/* v1.4.258: these two sat beside a bordered Mark paid as bare
                    underlined words — the same row, two different controls. */}
                <button type="button" className={rowBtn}
                  onClick={() => {
                    setEditId(r.id);
                    setEdit({ expense_date: r.expense_date, category: r.category, amount: (r.amount_cents / 100).toString(), vendor: r.vendor ?? "", description: r.description ?? "" });
                  }}>{L("Edit", "Sunting")}</button>
                <button type="button" className={rowBtnDanger} onClick={async () => { await api(`/expenses/${r.id}`, { method: "DELETE" }); showToast(L("Saved", "Disimpan"), L("Expense removed", "Perbelanjaan dibuang")); void load(); }}>{L("Remove", "Buang")}</button>
              </span>
              {openExp === r.id && (
                <DetailGrid items={[
                  { label: L("Date", "Tarikh"), value: dmy(r.expense_date) },
                  { label: L("Category", "Kategori"), value: <span className="capitalize">{catLabel(r.category)}</span> },
                  { label: L("Vendor", "Vendor"), value: r.vendor ?? "" },
                  { label: L("Recorded by", "Direkod oleh"), value: r.created_by_name ?? "" },
                  { label: L("Recurring", "Berulang"), value: r.recurring === 1 ? `${L("Yes", "Ya")}${r.due_day ? ` ${L("· due day", "· hari akhir")} ${r.due_day}` : ""}` : "" },
                  { label: L("Description", "Keterangan"), wide: true, value: r.description ?? "" },
                ]} />
              )}
            </div>
          ))}
        </div>
          </>
        )}
      </div>
    </div>
  );
}

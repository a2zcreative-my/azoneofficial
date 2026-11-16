"use client";

/* v1.312.0 - FINANCE WORKSPACE 5.0 (the CEO's directive and "approve as per
 * recommend", 15-11-2026; claude/FINANCE-WORKSPACE-5.0-BLUEPRINT.md). The
 * Finance tab is one page with exactly five views, each at its own address
 * (/portal?tab=Finance&view=overview|transactions|expenses|reconciliation|
 * reports, Back/Forward), drawn to the five reference images:
 *
 *   01 Overview        the cash-basis banner, four figures, Cash Trend and
 *                      Money Out by Category, then Account Balances, Recent
 *                      Transactions (latest 3) and Attention Items
 *   02 Transactions    one auditable cash ledger: header card (Export CSV,
 *                      Add Transaction), five filters and search, nine
 *                      columns, a detail drawer with the item's history
 *   03 Expenses        Add Expense, Due Payments / Scheduled Expenses (never
 *                      cash), Monthly Expense Impact and Monthly Summary; the
 *                      expense lifecycle (approve, authorise, pay, cancel)
 *   04 Reconciliation  the two figures (mismatches, total difference =
 *                      source - cash book), the out-of-step records with
 *                      Open Record / Reverse / Mark Reviewed and their review
 *                      history; the other checks below, collapsed
 *   05 Reports         one report selector, one period, an account filter,
 *                      three figures, the selected report, and the category,
 *                      account and source summaries; every export is the
 *                      report on screen
 *
 * Every figure is the server's (GET /staff/erp/cashbook, worker/src/
 * cashbook.ts) for ONE company - A2Z CREATIVE MARKETING or AZ ONE OFFICIAL -
 * or, only when chosen, both together (labelled "consolidated"). Money In is
 * what the CEO verified; the rest waits, shown. The P&L (accrual) is
 * Accounting's, not here. Replaces the Finance 2.0 page of v1.219.0, whose
 * drawers (entry, accounts, item) are kept and extended.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { FillPanel } from "@/components/ui/fill-panel"; // v1.324.0 - D-4
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { SideDrawer } from "@/components/ui/side-drawer";
import { PillSwitch } from "@/components/ui/panel";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { usePortal } from "@/components/portal/portal-provider";
import { ViewSwitch } from "@/components/portal/executive-cards";
import { useTabViewAddress } from "@/lib/tab-view";
import { csrfFetch, makeApi } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { fmtRM, mytToday } from "@/lib/format";
import { resolveIssuer } from "@/lib/issuers"; // v1.220.2 - the account printed on each invoice
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, btnSmPrimary, card, chipDanger, chipGold, chipInfo, chipNeutral, chipSuccess, chipWarn, fieldLabel, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./finance.module.css";
import fx from "./finance5.module.css";

const api = makeApi("/staff/erp");
const staffApi = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* ------------------------------------------------------------------ *
 * The server's view (worker/src/cashbook.ts).
 * ------------------------------------------------------------------ */

type Company = "a2z" | "azoo";
type CompanyPick = Company | "all";
type Source = "sales" | "part" | "elfia" | "live" | "claims" | "advance" | "payroll" | "expenses" | "commission" | "manual" | "transfer" | "reversal";
type Status = "verified" | "unverified" | "recorded" | "manual" | "transfer" | "reversed" | "reversal";
interface CashItem {
  key: string; row_id: number | null; date: string; booked_on: string | null; type: "in" | "out"; amount_cents: number;
  category: string; group: string; source: Source; status: Status; description: string; ref: string;
  link: { kind: "invoice" | "claim" | "payroll" | "expense" | "elfia"; id: number | string } | null;
  bank_id: number | null; bank_name: string | null; counts: "in" | "out" | null; sign: 1 | -1;
  reversal_of: number | null; reversed_by: number | null; reverse_reason: string | null; transfer_id: string | null; payment_ref: string | null;
  issuer?: string | null; company: Company | null; awaiting: boolean;
}
interface Bank { id: number; name: string; bank: string; number_masked: string; active: number; opening_balance_cents: number | null; opening_on: string | null; book_balance_cents: number | null; company: Company | null }
type ExKind = "unverified" | "no_bank" | "no_reference" | "out_of_step" | "duplicate" | "elfia_cancelled" | "not_booked";
interface Exception {
  kind: ExKind; key: string; item_key: string; date: string; title: string; detail: string; amount_cents: number; type: "in" | "out";
  row_id: number | null; link: CashItem["link"]; actions: ("bank" | "reverse" | "review" | "book" | "confirm" | "accept")[];
  source_cents: number | null; booked_cents: number | null; difference_cents: number | null; mismatch: "amount" | "status" | null;
  state: "open" | "reviewed"; reviewed: { note: string | null; at: string | null; by: number | null } | null; company: Company | null;
}
interface CashbookView {
  period: { from: string; to: string; today: string };
  company: CompanyPick; consolidated: boolean;
  totals: { in_cents: number; out_cents: number; net_cents: number; count: number; awaiting_cents: number; awaiting_count: number; difference_cents: number; no_company: number };
  groups: { in: { group: string; cents: number }[]; out: { group: string; cents: number }[] };
  trend: { month: string; in_cents: number; out_cents: number }[];
  items: CashItem[];
  banks: Bank[];
  exceptions: Exception[];
  can_correct: boolean;
  can_enter: boolean;
  can_accept: boolean;
  expense_caps?: { record: boolean; approve: boolean; authorise: boolean; pay: boolean };
  me?: { id: number; role: string };
  pending_migration: boolean;
  pending_company?: boolean;
}
interface DueItem { key: string; kind: "expense" | "recurring" | "claims" | "payroll"; title: string; sub: string; due_on: string | null; amount_cents: number; stage: string; company: Company | null; id: number | string | null }
interface Expense {
  id: number; expense_date: string; category: string; amount_cents: number; vendor: string | null; description: string | null; status: string | null;
  paid_at: string | null; company: string | null; due_on: string | null; created_by: number | null; created_by_name?: string | null;
  approved_by: number | null; authorised_by: number | null; receipt_key: string | null; bank_id: number | null; payment_ref: string | null; recurring: number; cancel_reason: string | null;
}
interface HistoryEvent { id: number; action: string; entity_id: string; detail: string | null; created_at: string; who: string | null; who_role: string | null }

/* ------------------------------------------------------------------ *
 * Words.
 * ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthWord = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
const dmy = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "—");
const dmyT = (utc: string | null) => {
  if (!utc) return "—";
  const ms = Date.parse(`${utc.replace(" ", "T").slice(0, 19)}Z`);
  if (!Number.isFinite(ms)) return utc;
  const t = new Date(ms + 8 * 3600 * 1000).toISOString();
  return `${dmy(t.slice(0, 10))} ${t.slice(11, 16)}`;
};
/** a figure in the axis: RM 12k, RM 1.2M */
const rmShort = (c: number) => {
  const rm = Math.abs(c) / 100;
  const s = rm >= 1_000_000 ? `${(rm / 1_000_000).toFixed(1)}M` : rm >= 1000 ? `${Math.round(rm / 1000)}k` : `${Math.round(rm)}`;
  return `${c < 0 ? "-" : ""}RM ${s}`;
};
/** a signed figure: −RM 5.00 */
const fmtSigned = (c: number) => (c < 0 ? `−${fmtRM(-c)}` : fmtRM(c));
const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "—");

const COMPANY: Record<Company, string> = { a2z: "A2Z Creative Marketing", azoo: "AZ ONE Official" };
const companyWord = (c: Company | null | undefined) => (c ? COMPANY[c] : L("No company yet", "Belum ada syarikat"));

const GROUP: Record<string, [string, string]> = {
  sales: ["Sales invoices", "Invois jualan"],
  elfia: ["ELFIA web orders", "Pesanan web ELFIA"],
  live: ["Live sales", "Jualan live"],
  payroll: ["Payroll", "Gaji"],
  claims: ["Staff claims", "Tuntutan kakitangan"],
  advances: ["Salary advances", "Pendahuluan gaji"],
  agent_commission: ["Agent commission", "Komisen ejen"],
  gl6000: ["Marketing & ads", "Pemasaran & iklan"],
  gl6100: ["Salaries (expenses)", "Gaji (perbelanjaan)"],
  gl6200: ["Rent & utilities", "Sewa & utiliti"],
  gl6300: ["Platform fees", "Yuran platform"],
  gl6900: ["Other expenses", "Perbelanjaan lain"],
  other_in: ["Other money in", "Tunai masuk lain"],
  other_out: ["Other money out", "Tunai keluar lain"],
};
const groupWord = (g: string) => (g.startsWith("manual:") ? g.slice(7) : GROUP[g] ? L(GROUP[g]![0], GROUP[g]![1]) : g);

const SOURCE: Record<Source, [string, string]> = {
  sales: ["Sales", "Jualan"], part: ["Sales (part)", "Jualan (separa)"], elfia: ["ELFIA", "ELFIA"], live: ["Live sales", "Jualan live"],
  claims: ["Claims", "Tuntutan"], advance: ["Salary advance", "Pendahuluan gaji"], payroll: ["Payroll", "Gaji"], expenses: ["Expenses", "Perbelanjaan"],
  commission: ["Commission", "Komisen"], manual: ["Manual", "Manual"], transfer: ["Transfer", "Pindahan"], reversal: ["Reversal", "Pembalikan"],
};
const sourceWord = (s: Source) => L(SOURCE[s][0], SOURCE[s][1]);

const STATUS: Record<Status, [string, string, string]> = {
  verified: ["Verified", "Disahkan", chipSuccess],
  unverified: ["Awaiting verification", "Menunggu pengesahan", chipWarn],
  recorded: ["Recorded", "Direkod", chipInfo],
  manual: ["Manual", "Manual", chipGold],
  transfer: ["Transfer", "Pindahan", chipNeutral],
  reversed: ["Reversed", "Dibalikkan", chipNeutral],
  reversal: ["Reversal", "Pembalikan", chipNeutral],
};
const StatusChip = ({ s }: { s: Status }) => <span className={STATUS[s][2]}>{L(STATUS[s][0], STATUS[s][1])}</span>;

const EXP_CATS: [string, string, string][] = [
  ["rent", "Rent", "Sewa"], ["utilities", "Utilities", "Utiliti"], ["software", "Software & subscriptions", "Perisian & langganan"], ["marketing", "Marketing", "Pemasaran"],
  ["equipment", "Equipment", "Peralatan"], ["logistics", "Logistics", "Logistik"], ["supplies", "Supplies", "Bekalan"], ["other", "Other", "Lain-lain"],
];
const expCatWord = (c: string) => { const f = EXP_CATS.find((x) => x[0] === c); return f ? L(f[1], f[2]) : c; };
const STAGE: Record<string, [string, string, string]> = {
  recorded: ["Awaiting approval", "Menunggu kelulusan", chipWarn],
  approved: ["Approved", "Diluluskan", chipInfo],
  scheduled: ["Scheduled", "Dijadualkan", chipInfo],
  authorised: ["Payment authorised", "Bayaran dibenarkan", chipGold],
  paid: ["Paid", "Dibayar", chipSuccess],
  cancelled: ["Cancelled", "Dibatalkan", chipNeutral],
  to_record: ["To record", "Untuk direkod", chipNeutral],
  released: ["Released", "Dikeluarkan", chipInfo],
};
const stageOf = (e: { status: string | null; paid_at?: string | null; due_on?: string | null }) => {
  const s = e.status ?? (e.paid_at ? "paid" : "recorded");
  return s === "approved" && e.due_on ? "scheduled" : s;
};
const StageChip = ({ s }: { s: string }) => <span className={STAGE[s]?.[2] ?? chipNeutral}>{STAGE[s] ? L(STAGE[s]![0], STAGE[s]![1]) : s}</span>;

/* v1.220.2 - THE ACCOUNTS THE COMPANY ALREADY PRINTS: every invoice's
   letterhead names the account the customer pays into (lib/issuers.ts). One
   button adds them (masked, no balance), each with its company (v1.312.0). */
const last4 = (t: string) => t.replace(/\D/g, "").slice(-4);
const INVOICE_ACCOUNTS = (["a2z", "azoo"] as Company[]).map((code) => {
  const i = resolveIssuer(code);
  const bankWord = i.bank.split(/\s+/)[0] ?? "";
  return { code, name: `${i.name} - ${bankWord.charAt(0)}${bankWord.slice(1).toLowerCase()}`, bank: `${bankWord.charAt(0)}${bankWord.slice(1).toLowerCase()}`, number_masked: `•••• ${last4(i.bank)}`, last4: last4(i.bank) };
});
/** The company account printed on this receipt's invoice, when it is set up here. */
function suggestedBank(it: CashItem | undefined, banks: Bank[]): Bank | null {
  if (!it || (it.source !== "sales" && it.source !== "part")) return null;
  const want = last4(resolveIssuer(it.issuer ?? null).bank);
  return banks.find((b) => b.active && last4(b.number_masked) === want) ?? null;
}

const EX: Record<ExKind, [string, string, string, string]> = {
  unverified: ["Awaiting CEO verification", "Menunggu pengesahan CEO", "Recorded as received, not yet verified by the CEO. Not counted as Money In until verified (Sales).", "Direkod sebagai diterima, belum disahkan oleh CEO. Tidak dikira sebagai Tunai Masuk sehingga disahkan (Jualan)."],
  no_bank: ["No account", "Tiada akaun", "Which of the company's accounts did this money move through? Assign it from the bank statement - the account names its company.", "Melalui akaun syarikat yang mana wang ini bergerak? Tetapkan daripada penyata bank - akaun menentukan syarikatnya."],
  no_reference: ["No payment reference", "Tiada rujukan bayaran", "A receipt with nothing to find it by on the statement.", "Penerimaan tanpa rujukan untuk dicari pada penyata."],
  out_of_step: ["Out of step (mismatch)", "Tidak sepadan", "The cash book and source record do not match. Review and take action.", "Buku tunai dan rekod sumber tidak sepadan. Semak dan ambil tindakan."],
  duplicate: ["Possible duplicates", "Kemungkinan pendua", "A typed movement on the same day, in the same direction and for the same amount as one the system booked.", "Pergerakan yang ditaip pada hari, arah dan amaun yang sama dengan yang direkod sistem."],
  elfia_cancelled: ["ELFIA cancelled after payment", "ELFIA dibatalkan selepas bayaran", "The money stays in until the refund is decided.", "Wang kekal masuk sehingga bayaran balik diputuskan."],
  not_booked: ["Paid but not in the cash book", "Dibayar tetapi tiada dalam buku tunai", "Marked paid in its module, with no cash movement. Book them, dated the day they were paid.", "Ditanda dibayar dalam modulnya, tanpa pergerakan tunai. Rekodkan, bertarikh hari ia dibayar."],
};
const MISMATCH: ExKind[] = ["out_of_step", "not_booked", "elfia_cancelled"];
const OTHER: ExKind[] = ["unverified", "no_bank", "no_reference", "duplicate"];

/* ------------------------------------------------------------------ *
 * The period: one picker, every figure on the page obeys it.
 * ------------------------------------------------------------------ */

type Preset = "this_month" | "last_month" | "this_quarter" | "this_year" | "custom";
const firstOf = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
const lastOf = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
function periodOf(p: Preset, today: string, custom: { from: string; to: string }): { from: string; to: string } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  if (p === "last_month") return { from: firstOf(y, m - 1), to: lastOf(y, m - 1) };
  if (p === "this_quarter") return { from: firstOf(y, m - (m % 3)), to: lastOf(y, m - (m % 3) + 2) };
  if (p === "this_year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (p === "custom" && custom.from && custom.to && custom.from <= custom.to) return custom;
  return { from: firstOf(y, m), to: lastOf(y, m) };
}
const periodWord = (from: string, to: string) => {
  if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01") && to === lastOf(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1)) return monthWord(from.slice(0, 7));
  return `${dmy(from)} – ${dmy(to)}`;
};

export type FinanceView = "overview" | "transactions" | "expenses" | "reconciliation" | "reports";
export const FINANCE_VIEWS: readonly FinanceView[] = ["overview", "transactions", "expenses", "reconciliation", "reports"];
export const isFinanceView = (v: string | null): v is FinanceView => FINANCE_VIEWS.includes(v as FinanceView);

/* ================================================================== *
 * The page.
 * ================================================================== */

export function FinancePage({ startView }: { startView?: string }) {
  const { canOpen, openRecord, setTab } = usePortal();
  const today = mytToday();
  const [view, setView] = useState<FinanceView>(() => (isFinanceView(startView ?? null) ? startView as FinanceView : "overview"));
  useTabViewAddress("Finance", view, setView, isFinanceView);
  const open = (v: FinanceView) => { setView(v); window.scrollTo({ top: 0 }); };
  const [preset, setPreset] = useState<Preset>("this_month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  /* v1.312.0 (CEO-2) - one company at a time; both only when chosen */
  const [company, setCompany] = useState<CompanyPick>("a2z");
  const period = useMemo(() => periodOf(preset, today, custom), [preset, today, custom]);
  const [data, setData] = useState<CashbookView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const [opened, setOpened] = useState<CashItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [accounts, setAccounts] = useState(false);
  const { show: toast, node: toastNode } = useSaveToast();
  const { prompt, node: promptNode } = usePrompt();

  useEffect(() => {
    let live = true;
    void api<CashbookView & { error?: { code?: string; message?: string } }>(`/cashbook?from=${period.from}&to=${period.to}&months=12&company=${company}`).then((r) => {
      if (!live) return;
      if (r.ok && r.data?.period) { setData(r.data); setFailed(null); return; }
      const why = r.status === 403 ? L("Your role has no access to Finance.", "Peranan anda tiada akses Kewangan.")
        : r.status === 404 ? L("The API worker is older than this page - run PUSH.bat again so the worker deploys, then reload.", "Worker API lebih lama daripada halaman ini - jalankan PUSH.bat semula supaya worker dilancarkan, kemudian muat semula.")
        : r.data?.error?.message ? `${r.data.error.message} (HTTP ${r.status}${r.data.error.code ? `, ${r.data.error.code}` : ""})`
        : L(`Finance could not be read (HTTP ${r.status || "no connection"}). Try again.`, `Kewangan tidak dapat dibaca (HTTP ${r.status || "tiada sambungan"}). Cuba lagi.`);
      setFailed(why);
    });
    return () => { live = false; };
  }, [period.from, period.to, company, tick]);

  const v = data?.period && data.period.from === period.from && data.period.to === period.to && (data.company ?? "all") === company ? data : null;

  /* the record behind an item, opened where it lives */
  const openSource = (link: CashItem["link"]) => {
    if (!link) return;
    if (link.kind === "invoice" && canOpen("Sales")) openRecord("Sales", "document", Number(link.id));
    else if (link.kind === "claim" && canOpen("Claims")) openRecord("Claims", "claim", Number(link.id));
    else if (link.kind === "payroll" && canOpen("Payroll")) setTab("Payroll");
    else if (link.kind === "expense") open("expenses");
  };

  /* ---- corrections (the server decides who; the screen only offers) ---- */
  const reverse = async (rowId: number, label: string) => {
    const r0 = await prompt({ title: L("Reverse this movement?", "Balikkan pergerakan ini?"), message: L(`${label}. A movement the other way is added, with your reason; the original stays in the book.`, `${label}. Pergerakan arah bertentangan ditambah, dengan sebab anda; yang asal kekal dalam buku.`), label: L("Reason", "Sebab"), required: true, confirmLabel: L("Reverse", "Balikkan"), variant: "danger" });
    if (!r0) return;
    const r = await api<{ error?: { message?: string } }>(`/cashbook/rows/${rowId}/reverse`, { method: "POST", body: JSON.stringify({ reason: r0.value }) });
    if (r.ok) { toast(L("Reversed", "Dibalikkan"), L("The reversal is in the book, with your reason", "Pembalikan ada dalam buku, dengan sebab anda")); setOpened(null); reload(); }
    else toast(L("Not reversed", "Tidak dibalikkan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const review = async (x: Exception) => {
    const mismatch = MISMATCH.includes(x.kind);
    const r0 = await prompt({ title: L("Mark as reviewed", "Tanda sudah disemak"), message: mismatch ? L(`${x.title}. Reviewed is not resolved: it stays listed until the records agree, or the CEO accepts the difference.`, `${x.title}. Disemak bukan selesai: ia kekal disenaraikan sehingga rekod sepadan, atau CEO menerima perbezaan.`) : x.title, label: L("What did you check?", "Apa yang anda semak?"), required: true, confirmLabel: L("Mark reviewed", "Tanda disemak") });
    if (!r0) return;
    const r = await api<{ error?: { message?: string } }>(`/cashbook/review`, { method: "POST", body: JSON.stringify({ key: `${x.kind}|${x.key}`, note: r0.value }) });
    if (r.ok) { toast(L("Reviewed", "Disemak"), mismatch ? L("Your note is in its history; it stays open until resolved", "Catatan anda dalam sejarahnya; ia kekal terbuka sehingga selesai") : L("It leaves the list; the note is kept", "Ia keluar dari senarai; catatan disimpan")); reload(); }
    else toast(L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const accept = async (x: Exception) => {
    const r0 = await prompt({ title: L("Accept this difference?", "Terima perbezaan ini?"), message: L(`${x.title}: the records still differ by ${fmtSigned(x.difference_cents ?? 0)}. Accepting resolves it as it stands, with your reason, in its history.`, `${x.title}: rekod masih berbeza ${fmtSigned(x.difference_cents ?? 0)}. Menerima menyelesaikannya seadanya, dengan sebab anda, dalam sejarahnya.`), label: L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)"), required: true, confirmLabel: L("Accept difference", "Terima perbezaan"), variant: "danger" });
    if (!r0) return;
    const r = await api<{ error?: { message?: string } }>(`/cashbook/accept`, { method: "POST", body: JSON.stringify({ key: `${x.kind}|${x.key}`, reason: r0.value }) });
    if (r.ok) { toast(L("Accepted", "Diterima"), L("Resolved as it stands; the reason is in its history", "Diselesaikan seadanya; sebab dalam sejarahnya")); reload(); }
    else toast(L("Not accepted", "Tidak diterima"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const assignBank = async (itemKey: string, bankId: number) => {
    const r = await api<{ error?: { message?: string } }>(`/cashbook/assign-bank`, { method: "POST", body: JSON.stringify({ item_key: itemKey, bank_id: bankId }) });
    if (r.ok) { toast(L("Account assigned", "Akaun ditetapkan"), L("Recorded with your name", "Direkod dengan nama anda")); setOpened(null); reload(); }
    else toast(L("Not assigned", "Tidak ditetapkan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const assignMany = async (keys: string[], bankId: number) => {
    const r = await api<{ assigned?: number; skipped?: number; error?: { message?: string } }>(`/cashbook/assign-bank`, { method: "POST", body: JSON.stringify({ item_keys: keys, bank_id: bankId }) });
    if (r.ok) { toast(L("Accounts assigned", "Akaun ditetapkan"), L(`${r.data?.assigned ?? 0} movement(s), recorded with your name${r.data?.skipped ? ` (${r.data.skipped} skipped)` : ""}`, `${r.data?.assigned ?? 0} pergerakan, direkod dengan nama anda${r.data?.skipped ? ` (${r.data.skipped} dilangkau)` : ""}`)); reload(); }
    else toast(L("Not assigned", "Tidak ditetapkan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const bookMissing = async () => {
    const r = await api<{ created?: number; error?: { message?: string } }>(`/cashflow/backfill`, { method: "POST", body: JSON.stringify({}) });
    if (r.ok) { toast(L("Booked", "Direkod"), L(`${r.data?.created ?? 0} movement(s), dated the day each was paid`, `${r.data?.created ?? 0} pergerakan, bertarikh hari setiap satu dibayar`)); reload(); }
    else toast(L("Not booked", "Tidak direkod"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };

  const TABS: readonly (readonly [FinanceView, string, string])[] = [
    ["overview", L("Overview", "Gambaran"), L("Cash health, flow and actions", "Kesihatan tunai, aliran dan tindakan")],
    ["transactions", L("Transactions", "Transaksi"), L("The cash ledger by date, account and status", "Lejar tunai ikut tarikh, akaun dan status")],
    ["expenses", L("Expenses", "Perbelanjaan"), L("Company spending, due payments and cash impact", "Perbelanjaan syarikat, bayaran akan datang & impak tunai")],
    ["reconciliation", L("Reconciliation", "Penyelarasan"), L("Mismatches, exceptions and actions", "Ketidaksepadanan, pengecualian & tindakan")],
    ["reports", L("Reports", "Laporan"), L("Monthly, category, account and source", "Bulanan, kategori, akaun & sumber")],
  ];

  const periodPick = (
    <span className={css.periodPick}>
      <AppIcon name="date" />
      <select aria-label={L("Period", "Tempoh")} value={preset} onChange={(e) => setPreset(e.target.value as Preset)} data-testid="finance-period">
        <option value="this_month">{L("This month", "Bulan ini")} ({monthWord(today.slice(0, 7))})</option>
        <option value="last_month">{L("Last month", "Bulan lepas")}</option>
        <option value="this_quarter">{L("This quarter", "Suku ini")}</option>
        <option value="this_year">{L("This year", "Tahun ini")}</option>
        <option value="custom">{L("Custom…", "Pilih sendiri…")}</option>
      </select>
    </span>
  );
  const companyPick = (
    <select className={selectClassSm} aria-label={L("Company", "Syarikat")} value={company} onChange={(e) => setCompany(e.target.value as CompanyPick)} data-testid="finance-company">
      <option value="a2z">{COMPANY.a2z}</option>
      <option value="azoo">{COMPANY.azoo}</option>
      <option value="all">{L("Both companies (consolidated)", "Kedua-dua syarikat (gabungan)")}</option>
    </select>
  );
  const addAction = v?.can_enter ? <TabAction icon="add" onClick={() => setAdding(true)}>{L("Add transaction", "Tambah transaksi")}</TabAction> : null;

  return (
    <TabPage className={css.page}>
      {toastNode}{promptNode}
      <div className="erp-desktop-only">
        <LineTabs value={view} onChange={open} tabs={TABS.map(([k, t]) => [k, t] as const)} label={L("Finance", "Kewangan")}
          aside={<TabAside>{companyPick}{view !== "transactions" && view !== "reports" && periodPick}{view === "reconciliation" && addAction}</TabAside>} />
      </div>
      <div className="erp-phone-only">
        <div className={fx.viewBar} data-testid="finance-view-bar">
          <ViewSwitch value={view} onChange={(k) => open(k)} label={L("Finance view", "Paparan kewangan")} options={TABS} />
          {view === "reconciliation" ? addAction : null}
        </div>
        <div className={fx.phonePicks}>{companyPick}{view !== "transactions" && view !== "reports" && periodPick}</div>
      </div>
      {preset === "custom" && (
        <div className={css.customRow}>
          <label><span className={fieldLabel}>{L("From", "Dari")}</span><input type="date" className={inputClass} value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
          <label><span className={fieldLabel}>{L("To", "Hingga")}</span><input type="date" className={inputClass} value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
        </div>
      )}
      {v?.consolidated && <p className={fx.consolidated} data-testid="finance-consolidated"><AppIcon name="info" /><span>{L("Consolidated view: A2Z Creative Marketing and AZ ONE Official together. Each company's own figures are under its name above.", "Paparan gabungan: A2Z Creative Marketing dan AZ ONE Official bersama. Angka setiap syarikat di bawah namanya di atas.")}{v.totals.no_company > 0 ? L(` ${v.totals.no_company} movement(s) in this period have no company yet - assign their account under Reconciliation.`, ` ${v.totals.no_company} pergerakan dalam tempoh ini belum ada syarikat - tetapkan akaunnya di Penyelarasan.`) : ""}</span></p>}
      {v?.pending_migration && <p className={css.warn}>{L("Migration 0147 is not applied yet - run PUSH.bat.", "Migrasi 0147 belum digunakan - jalankan PUSH.bat.")}</p>}
      {v?.pending_company && <p className={css.warn}>{L("Migrations 0197 and 0198 are not applied yet - run PUSH.bat. Until then movements have no company and expenses cannot move through their steps.", "Migrasi 0197 dan 0198 belum digunakan - jalankan PUSH.bat. Sehingga itu pergerakan tiada syarikat dan perbelanjaan tidak boleh melalui langkahnya.")}</p>}
      {failed && !v && <p className={css.warn}>{failed} <button type="button" className={btnSm} onClick={reload}>{L("Retry", "Cuba lagi")}</button></p>}

      {view === "overview" && <Overview v={v} onOpenItem={setOpened} open={open} openSales={() => { if (canOpen("Sales")) setTab("Sales"); }} onAccounts={() => setAccounts(true)} />}
      {view === "transactions" && <Transactions v={v} periodPick={periodPick} period={period} onOpen={setOpened} onAdd={() => setAdding(true)} />}
      {view === "expenses" && <Expenses v={v} period={period} company={company} toast={toast} onChanged={reload} />}
      {view === "reconciliation" && (
        !v ? <SkelRows rows={4} /> : (
          <Reconciliation v={v} onReverse={(x) => x.row_id && void reverse(x.row_id, x.title)} onReview={(x) => void review(x)} onAccept={(x) => void accept(x)}
            onBank={(x, b) => void assignBank(x.item_key, b)} onBulk={(keys, b) => void assignMany(keys, b)} onSetup={() => setAccounts(true)}
            onBook={() => void bookMissing()} onOpen={openSource} />
        )
      )}
      {view === "reports" && <Reports v={v} period={period} periodPick={periodPick} />}

      {/* ---- drawers ---- */}
      <ItemDrawer item={opened} view={v} onClose={() => setOpened(null)} onSource={openSource}
        onReverse={(it) => it.row_id && void reverse(it.row_id, it.description || it.ref)} onBank={(it, b) => void assignBank(it.key, b)}
        onSetup={() => { setOpened(null); setAccounts(true); }} />
      {v && adding && <AddDrawer view={v} company={company} onClose={() => setAdding(false)} onSaved={(t, s) => { toast(t, s); setAdding(false); reload(); }} onError={(m) => toast(L("Not saved", "Tidak disimpan"), m, "notice")} />}
      {v && accounts && <AccountsDrawer view={v} onClose={() => setAccounts(false)} onSavedToast={(t) => { toast(L("Saved", "Disimpan"), t); reload(); }} onError={(m) => toast(L("Not saved", "Tidak disimpan"), m, "notice")} />}
    </TabPage>
  );
}

/* ================================================================== *
 * Shared pieces.
 * ================================================================== */

function Banner({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "info" }) {
  return <p className={tone === "warn" ? fx.bannerWarn : fx.bannerInfo}><AppIcon name="info" /><span>{children}</span></p>;
}

function CardHead({ icon, title, aside, sub }: { icon: AppIconName; title: ReactNode; aside?: ReactNode; sub?: ReactNode }) {
  return (
    <div className={fx.cardHead}>
      <span className={fx.cardIcon} aria-hidden><AppIcon name={icon} /></span>
      <span className={fx.cardTitle}><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      {aside && <span className={fx.cardAside}>{aside}</span>}
    </div>
  );
}

/* ================================================================== *
 * 01 Overview (reference 01).
 * ================================================================== */

function Overview({ v, onOpenItem, open, openSales, onAccounts }: { v: CashbookView | null; onOpenItem: (i: CashItem) => void; open: (v: FinanceView) => void; openSales: () => void; onAccounts: () => void }) {
  const busy = !v;
  const mism = v ? v.exceptions.filter((x) => MISMATCH.includes(x.kind)) : [];
  const attention: { key: string; icon: AppIconName; tone: string | undefined; text: string; on: () => void }[] = v ? [
    ...(v.totals.awaiting_count > 0 ? [{ key: "awaiting", icon: "pending" as AppIconName, tone: fx.toneWarn, text: L(`${v.totals.awaiting_count} receipt(s) awaiting CEO verification - ${fmtRM(v.totals.awaiting_cents)}, not yet counted as Money In`, `${v.totals.awaiting_count} penerimaan menunggu pengesahan CEO - ${fmtRM(v.totals.awaiting_cents)}, belum dikira sebagai Tunai Masuk`), on: openSales }] : []),
    ...(mism.length ? [{ key: "mismatch", icon: "warning" as AppIconName, tone: fx.toneBad, text: L(`${mism.length} record(s) out of step - difference ${fmtSigned(v.totals.difference_cents)}`, `${mism.length} rekod tidak sepadan - perbezaan ${fmtSigned(v.totals.difference_cents)}`), on: () => open("reconciliation") }] : []),
    ...(["no_bank", "no_reference", "duplicate"] as ExKind[]).map((k) => ({ k, n: v.exceptions.filter((x) => x.kind === k).length })).filter((r) => r.n > 0)
      .map((r) => ({ key: r.k, icon: "info" as AppIconName, tone: fx.toneInfo, text: `${r.n} · ${L(EX[r.k][0], EX[r.k][1])}`, on: () => open("reconciliation") })),
  ] : [];
  const banks = v ? v.banks.filter((b) => b.active) : [];
  return (
    <div className={fx.stack} data-testid="finance-overview">
      <Banner><strong>{L("Cash Basis View", "Paparan Asas Tunai")}</strong> — {L("This view follows actual money moved (cash in/out), not profit and loss. It shows cash received, cash paid, the net cash movement, and items that need your attention.", "Paparan ini mengikut wang sebenar yang bergerak (tunai masuk/keluar), bukan untung rugi. Ia menunjukkan tunai diterima, tunai dibayar, pergerakan tunai bersih dan perkara yang perlu perhatian anda.")}</Banner>
      <KpiRow label={L("Cash in the period", "Tunai dalam tempoh")}>
        <KpiTile icon="up" tone="green" label={L("Money In", "Tunai Masuk")} value={v ? fmtRM(v.totals.in_cents) : ""} busy={busy} sub={L("Actual receipts (verified)", "Penerimaan sebenar (disahkan)")} />
        <KpiTile icon="down" tone="red" label={L("Money Out", "Tunai Keluar")} value={v ? fmtRM(v.totals.out_cents) : ""} busy={busy} sub={L("Actual payments", "Pembayaran sebenar")} />
        <KpiTile icon="balance" tone="blue" label={L("Net Cash Movement", "Pergerakan Tunai Bersih")} value={v ? fmtSigned(v.totals.net_cents) : ""} busy={busy} sub={L("Inflow – Outflow", "Masuk – Keluar")} />
        <KpiTile icon="warning" tone="gold" label={L("Needs Attention", "Perlu Perhatian")} value={v ? String(v.exceptions.length) : ""} busy={busy} sub={L("Items to review", "Perkara untuk disemak")}
          onClick={() => open("reconciliation")} title={L("Open Reconciliation", "Buka Penyelarasan")} />
      </KpiRow>
      <div className={fx.split21}>
        <section className={card} aria-label={L("Cash Trend (Monthly)", "Trend Tunai (Bulanan)")} data-testid="finance-trend">
          <CardHead icon="chart" title={L("Cash Trend (Monthly)", "Trend Tunai (Bulanan)")} />
          {busy ? <Skel className={css.chartSkel} /> : <TrendChart months={v!.trend.slice(-6)} />}
        </section>
        <section className={card} aria-label={L("Money Out by Category", "Tunai Keluar ikut Kategori")} data-testid="finance-out-by-category">
          <CardHead icon="money" title={L("Money Out by Category", "Tunai Keluar ikut Kategori")} aside={v && <strong className={fx.num}>{fmtRM(v.totals.out_cents)}</strong>} />
          {busy ? <Skel className={css.chartSkel} /> : <GroupBars groups={v!.groups.out} total={v!.totals.out_cents} empty={L("Nothing paid out in this period.", "Tiada pembayaran dalam tempoh ini.")} />}
        </section>
      </div>
      <div className={fx.split3o}>
        <section className={card} aria-label={L("Account Balances", "Baki Akaun")} data-testid="finance-accounts">
          <CardHead icon="pay" title={L("Account Balances", "Baki Akaun")} sub={L("Book balance - not bank-verified", "Baki buku - tidak disahkan bank")} />
          {busy ? <SkelRows rows={2} /> : banks.length === 0 ? (
            <div className={fx.emptyBox}>
              <p className={fx.empty}>{v!.consolidated ? L("No company account yet.", "Belum ada akaun syarikat.") : L("No account for this company yet.", "Belum ada akaun untuk syarikat ini.")}</p>
              {v!.can_enter && <button type="button" className={btnSmPrimary} onClick={onAccounts}>{L("Set up accounts", "Sediakan akaun")}</button>}
            </div>
          ) : (
            <ul className={fx.kv}>
              {banks.map((b) => (
                <li key={b.id}>
                  <span>{b.name}{v!.consolidated && <small>{companyWord(b.company)}</small>}</span>
                  {b.book_balance_cents != null
                    ? <strong className={b.book_balance_cents < 0 ? fx.neg : fx.pos}>{fmtSigned(b.book_balance_cents)}</strong>
                    : <span className={fx.muted}>{L("No verified balance", "Tiada baki disahkan")}</span>}
                </li>
              ))}
            </ul>
          )}
          {!busy && banks.length > 0 && v!.can_enter && <button type="button" className={fx.more} onClick={onAccounts}>{L("Manage accounts", "Urus akaun")} <AppIcon name="next" /></button>}
        </section>
        <section className={card} aria-label={L("Recent Transactions", "Transaksi Terkini")} data-testid="finance-recent">
          <CardHead icon="receipt" title={<>{L("Recent Transactions", "Transaksi Terkini")} <span className={fx.muted}>{L("(Latest 3)", "(3 Terkini)")}</span></>} />
          {busy ? <SkelRows rows={3} /> : v!.items.length === 0 ? <p className={fx.empty}>{L("No money moved in this period.", "Tiada wang bergerak dalam tempoh ini.")}</p> : (
            <div className={fx.tWrap}>
              <table className={`${fx.t} ${fx.tCompact}`}>
                <thead><tr><th>{L("Date", "Tarikh")}</th><th>{L("Description", "Keterangan")}</th><th>{L("Category", "Kategori")}</th><th className={fx.r}>{L("Amount", "Amaun")}</th></tr></thead>
                <tbody>{v!.items.slice(0, 3).map((i) => (
                  <tr key={i.key} data-testid="recent-row">
                    <td className={fx.num}>{dmy(i.date)}</td>
                    <td><button type="button" className={`${fx.link} ${fx.clip}`} onClick={() => onOpenItem(i)}>{i.description || groupWord(i.group)}</button></td>
                    <td>{groupWord(i.group)}</td>
                    <td className={`${fx.r} ${fx.num} ${i.type === "in" ? fx.pos : fx.neg}`}>{i.type === "in" ? "" : "−"}{fmtRM(i.amount_cents)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <button type="button" className={fx.more} onClick={() => open("transactions")}>{L("View all transactions", "Lihat semua transaksi")} <AppIcon name="next" /></button>
        </section>
        <section className={card} aria-label={L("Attention Items", "Perkara Perhatian")} data-testid="finance-attention">
          <CardHead icon="warning" title={L("Attention Items", "Perkara Perhatian")} />
          {busy ? <SkelRows rows={2} /> : attention.length === 0 ? <p className={fx.empty}>{L("Nothing needs your attention in this period.", "Tiada yang perlu perhatian anda dalam tempoh ini.")}</p> : (
            <ul className={fx.attn}>
              {attention.map((a) => (
                <li key={a.key}>
                  <button type="button" className={fx.attnBtn} onClick={a.on} data-attention={a.key}>
                    <span className={`${fx.attnIcon} ${a.tone}`} aria-hidden><AppIcon name={a.icon} /></span>
                    <span>{a.text}</span>
                    <AppIcon name="next" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Money in and out, month by month: two lines on one axis, a hover per
    month with both figures and the net. */
function TrendChart({ months }: { months: CashbookView["trend"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 190, PL = 66, PR = 14, PT = 12, PB = 28;
  const max = Math.max(1, ...months.flatMap((m) => [m.in_cents, m.out_cents]));
  const step = (() => { const raw = max / 3; const p = 10 ** Math.floor(Math.log10(raw)); return Math.ceil(raw / p) * p; })();
  const top = step * 3;
  const x = (i: number) => PL + (months.length <= 1 ? 0 : (i / (months.length - 1)) * (W - PL - PR));
  const y = (val: number) => PT + (1 - Math.max(0, val) / top) * (H - PT - PB);
  const path = (k: "in_cents" | "out_cents") => months.map((m, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(m[k]).toFixed(1)}`).join("");
  const area = (k: "in_cents" | "out_cents") => months.length ? `${path(k)}L${x(months.length - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z` : "";
  const h = hover != null ? months[hover] : null;
  return (
    <div className={css.trend}>
      <ul className={css.legend}>
        <li><span className={css.dotIn} />{L("Money In", "Tunai Masuk")}</li>
        <li><span className={css.dotOut} />{L("Money Out", "Tunai Keluar")}</li>
      </ul>
      <div className={css.chartWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={css.chart} role="img"
          aria-label={months.map((m) => `${monthWord(m.month)}: in ${fmtRM(m.in_cents)}, out ${fmtRM(m.out_cents)}`).join("; ")}>
          {[0, 1, 2, 3].map((k) => (
            <g key={k}>
              <line x1={PL} x2={W - PR} y1={y(step * k)} y2={y(step * k)} className={k === 0 ? css.axis : css.grid} />
              <text x={PL - 6} y={y(step * k) + 4} textAnchor="end" className={css.tick}>{rmShort(step * k)}</text>
            </g>
          ))}
          <path d={area("in_cents")} className={css.areaIn} />
          <path d={path("in_cents")} className={css.lineIn} />
          <path d={path("out_cents")} className={css.lineOut} />
          {months.map((m, i) => (
            <g key={m.month}>
              <text x={x(i)} y={H - 8} textAnchor="middle" className={css.tick}>{MONTHS[Number(m.month.slice(5, 7)) - 1]}</text>
              {(hover === i || i === months.length - 1) && <>
                <circle cx={x(i)} cy={y(m.in_cents)} r={4} className={css.markIn} />
                <circle cx={x(i)} cy={y(m.out_cents)} r={4} className={css.markOut} />
              </>}
              {hover === i && <line x1={x(i)} x2={x(i)} y1={PT} y2={y(0)} className={css.cross} />}
              <rect x={x(i) - (W - PL - PR) / Math.max(1, months.length - 1) / 2} y={0} width={(W - PL - PR) / Math.max(1, months.length - 1)} height={H}
                fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                tabIndex={0} aria-label={`${monthWord(m.month)}: ${fmtRM(m.in_cents)} / ${fmtRM(m.out_cents)}`} />
            </g>
          ))}
        </svg>
        {h && (
          <div className={css.tip} style={{ left: `${(x(hover!) / W) * 100}%` }} role="status">
            <strong>{monthWord(h.month)}</strong>
            <span><i className={css.dotIn} />{fmtRM(h.in_cents)}</span>
            <span><i className={css.dotOut} />{fmtRM(h.out_cents)}</span>
            <span className={css.tipNet}>{L("Net", "Bersih")} {fmtSigned(h.in_cents - h.out_cents)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shares of one total as a sorted list of bars (a reversal can make a
    group negative: it is shown, never hidden). */
function GroupBars({ groups, total, empty }: { groups: { group: string; cents: number }[]; total: number; empty: string }) {
  if (!groups.length) return <p className={fx.empty}>{empty}</p>;
  const max = Math.max(1, ...groups.map((g) => Math.abs(g.cents)));
  return (
    <ul className={fx.bars}>
      {groups.slice(0, 6).map((g) => (
        <li key={g.group}>
          <span className={fx.barTop}><span>{groupWord(g.group)}</span><strong className={fx.num}>{fmtSigned(g.cents)}</strong><span className={fx.muted}>{pct(g.cents, total)}</span></span>
          <span className={fx.barTrack} aria-hidden><span style={{ width: `${Math.max(2, (Math.abs(g.cents) / max) * 100)}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}

/* ================================================================== *
 * 02 Transactions (reference 02).
 * ================================================================== */

function Transactions({ v, periodPick, period, onOpen, onAdd }: { v: CashbookView | null; periodPick: ReactNode; period: { from: string; to: string }; onOpen: (i: CashItem) => void; onAdd: () => void }) {
  const [dir, setDir] = useState("");
  const [src, setSrc] = useState("");
  const [st, setSt] = useState("");
  const [acc, setAcc] = useState("");
  const [q, setQ] = useState("");
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(1);
  const size = 25;
  const items = useMemo(() => v?.items ?? [], [v]);
  const mismatched = useMemo(() => new Set((v?.exceptions ?? []).filter((x) => MISMATCH.includes(x.kind)).map((x) => x.item_key)), [v]);
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = items.filter((i) => (!dir || i.type === dir) && (!src || i.source === src) && (!st || i.status === st)
      && (!acc || (acc === "none" ? !i.bank_id : String(i.bank_id ?? "") === acc))
      && (!ql || `${i.description} ${i.ref} ${i.category} ${i.bank_name ?? ""} ${i.payment_ref ?? ""}`.toLowerCase().includes(ql)));
    return asc ? [...list].reverse() : list;
  }, [items, dir, src, st, acc, q, asc]);
  const filterKey = `${dir}|${src}|${st}|${acc}|${q}|${period.from}|${period.to}`;
  const [pageKey, setPageKey] = useState(filterKey);
  if (pageKey !== filterKey) { setPageKey(filterKey); setPage(1); }
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages);
  const rows = shown.slice((cur - 1) * size, cur * size);
  const csv = () => downloadCsv(`a2z-transactions-${v?.consolidated ? "consolidated" : v?.company ?? "a2z"}-${period.from}-to-${period.to}`, [
    ["Company", "Date", "Booked on", "Description", "Category", "Direction", "Amount (RM)", "Account", "Source", "Reference", "Payment ref", "Status", "Counted"],
    ...shown.map((i) => [companyWord(i.company), i.date, i.booked_on ?? "", i.description, groupWord(i.group), i.type === "in" ? "In" : "Out", (i.amount_cents / 100).toFixed(2), i.bank_name ?? "", sourceWord(i.source), i.ref, i.payment_ref ?? "", STATUS[i.status][0], i.counts ? "Yes" : "No"]),
  ]);
  const active = [dir, src, st, acc, q].filter(Boolean).length;
  const filters = (
    <>
      <label className={fx.filter}><span>{L("Direction", "Arah")}</span>
        <select className={selectClassSm} value={dir} onChange={(e) => setDir(e.target.value)} data-testid="tx-direction"><option value="">{L("All", "Semua")}</option><option value="in">{L("In", "Masuk")}</option><option value="out">{L("Out", "Keluar")}</option></select></label>
      <label className={fx.filter}><span>{L("Source", "Sumber")}</span>
        <select className={selectClassSm} value={src} onChange={(e) => setSrc(e.target.value)} data-testid="tx-source"><option value="">{L("All", "Semua")}</option>{(Object.keys(SOURCE) as Source[]).filter((s) => items.some((i) => i.source === s)).map((s) => <option key={s} value={s}>{sourceWord(s)}</option>)}</select></label>
      <label className={fx.filter}><span>{L("Status", "Status")}</span>
        <select className={selectClassSm} value={st} onChange={(e) => setSt(e.target.value)} data-testid="tx-status"><option value="">{L("All", "Semua")}</option>{(Object.keys(STATUS) as Status[]).filter((s) => items.some((i) => i.status === s)).map((s) => <option key={s} value={s}>{L(STATUS[s][0], STATUS[s][1])}</option>)}</select></label>
      <label className={fx.filter}><span>{L("Account", "Akaun")}</span>
        <select className={selectClassSm} value={acc} onChange={(e) => setAcc(e.target.value)} data-testid="tx-account"><option value="">{L("All", "Semua")}</option><option value="none">{L("No account", "Tiada akaun")}</option>{(v?.banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className={`${fx.filter} ${fx.filterWide}`}><span>{L("Date", "Tarikh")}</span>{periodPick}</label>
      <label className={`${fx.filter} ${fx.search}`}><span>{L("Search", "Cari")}</span><input type="search" className={inputClassSm} placeholder={L("Search invoice, description or reference…", "Cari invois, keterangan atau rujukan…")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="tx-search" /></label>
    </>
  );
  return (
    <div className={fx.stack} data-testid="finance-transactions-view">
      <section className={`${card} ${fx.headCard}`} data-testid="finance-transactions-head">
        <span className={fx.headIcon} aria-hidden><AppIcon name="balance" /></span>
        <span className={fx.headText}>
          <strong>{L("Transactions", "Transaksi")}</strong>
          <small>{L("Cash movement ledger by money-moved date — records of money in (inflow) and money out (outflow) with source, status and account.", "Lejar pergerakan tunai ikut tarikh wang bergerak — rekod tunai masuk dan tunai keluar dengan sumber, status dan akaun.")}</small>
        </span>
        <span className={fx.headActs}>
          <button type="button" className={btnSm} onClick={csv} disabled={!v || shown.length === 0} data-testid="tx-export"><AppIcon name="download" />{L("Export CSV", "Eksport CSV")}</button>
          {v?.can_enter && <button type="button" className={btnSmPrimary} onClick={onAdd} data-testid="tx-add"><AppIcon name="add" />{L("Add Transaction", "Tambah Transaksi")}</button>}
        </span>
      </section>
      <section className={`${card} ${fx.filterCard} ${fx.deskOnly}`} aria-label={L("Filters", "Penapis")} data-testid="finance-filters">{filters}</section>
      <details className={`${card} ${fx.phoneOnly} ${fx.fold}`} data-testid="finance-filters-phone">
        <summary>{L("Filters", "Penapis")}{active ? ` (${active})` : ""}</summary>
        <div className={fx.filterCard}>{filters}</div>
      </details>
      <section className={card} aria-label={L("Transactions", "Transaksi")} data-testid="finance-transactions">
        {!v ? <SkelRows rows={6} /> : shown.length === 0 ? <p className={fx.empty}>{L("No money moved for these filters in this period.", "Tiada wang bergerak untuk penapis ini dalam tempoh ini.")}</p> : (
          <>
            {/* v1.324.0 (Global UI System D-4) - the ledger fills the screen on a desktop and scrolls inside, its header pinned */}
            <FillPanel testid="tx-fill" className={`${fx.tWrap} ${fx.deskOnly} ${fx.pinHead}`}>
              <table className={fx.t}>
                <thead><tr>
                  <th><button type="button" className={fx.sortBtn} onClick={() => setAsc((a) => !a)} aria-label={L("Sort by date", "Isih ikut tarikh")}>{L("Date", "Tarikh")} <span aria-hidden>{asc ? "↑" : "↓"}</span></button></th>
                  <th>{L("Description", "Keterangan")}</th><th>{L("Category", "Kategori")}</th><th>{L("Direction", "Arah")}</th><th className={fx.r}>{L("Amount", "Amaun")}</th>
                  <th>{L("Account", "Akaun")}</th><th>{L("Source", "Sumber")}</th><th>{L("Reference", "Rujukan")}</th><th>{L("Status", "Status")}</th>
                </tr></thead>
                <tbody>{rows.map((i) => (
                  <tr key={i.key} data-testid="tx-row">
                    <td className={fx.num}>{dmy(i.date)}</td>
                    <td><button type="button" className={`${fx.link} ${i.status === "reversed" || i.status === "reversal" ? css.struckText : ""}`} onClick={() => onOpen(i)}>{i.description || "—"}</button></td>
                    <td>{i.transfer_id ? sourceWord("transfer") : groupWord(i.group)}</td>
                    <td><span className={i.type === "in" ? chipSuccess : chipDanger}>{i.type === "in" ? L("In", "Masuk") : L("Out", "Keluar")}</span></td>
                    <td className={`${fx.r} ${fx.num}`}>{fmtRM(i.amount_cents)}</td>
                    <td>{i.bank_name ?? <span className={fx.muted}>—</span>}</td>
                    <td>{sourceWord(i.source)}</td>
                    <td className={fx.num}>{i.ref || "—"}</td>
                    <td><span className={fx.chips}><StatusChip s={i.status} />{mismatched.has(i.key) && <span className={chipDanger}>{L("Out of step", "Tidak sepadan")}</span>}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </FillPanel>
            <ul className={`${fx.cards} ${fx.phoneOnly}`} data-testid="tx-cards">{rows.map((i) => (
              <li key={i.key}><button type="button" className={fx.cardBtn} onClick={() => onOpen(i)}>
                <span className={fx.cardTop}><span className={fx.num}>{dmy(i.date)}</span><strong className={i.type === "in" ? fx.pos : fx.neg}>{i.type === "in" ? L("In", "Masuk") : L("Out", "Keluar")} {fmtRM(i.amount_cents)}</strong></span>
                <span>{i.description || groupWord(i.group)}</span>
                <span className={fx.cardTop}><span className={fx.muted}>{sourceWord(i.source)} · {i.bank_name ?? L("No account", "Tiada akaun")}</span><StatusChip s={i.status} /></span>
              </button></li>
            ))}</ul>
            <div className={fx.foot}>
              <span className={fx.muted} data-testid="tx-count">{L(`Showing ${(cur - 1) * size + 1} to ${Math.min(cur * size, shown.length)} of ${shown.length} entries.`, `Menunjukkan ${(cur - 1) * size + 1} hingga ${Math.min(cur * size, shown.length)} daripada ${shown.length} entri.`)}</span>
              {pages > 1 && (
                <span className={fx.pager}>
                  <button type="button" className={btnSm} disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label={L("Previous page", "Halaman sebelum")}><AppIcon name="previous" /></button>
                  <span className={fx.num}>{cur} / {pages}</span>
                  <button type="button" className={btnSm} disabled={cur >= pages} onClick={() => setPage(cur + 1)} aria-label={L("Next page", "Halaman seterusnya")}><AppIcon name="next" /></button>
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** Choose the account a movement went through; the invoice's own account is
    pre-chosen when it is set up, and says so. Nothing is saved until Assign. */
function AssignRow({ banks, suggested, onAssign }: { banks: Bank[]; suggested: Bank | null; onAssign: (bankId: number) => void }) {
  const [bank, setBank] = useState(suggested ? String(suggested.id) : "");
  return (
    <span className={css.assign}>
      {suggested && String(suggested.id) === bank && <span className={css.hint}>{L("Printed on the invoice", "Tercetak pada invois")}</span>}
      <select className={inputClass} value={bank} onChange={(e) => setBank(e.target.value)} aria-label={L("Account", "Akaun")}>
        <option value="">{L("Choose account…", "Pilih akaun…")}</option>
        {banks.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <button type="button" className={btnSmPrimary} disabled={!bank} onClick={() => onAssign(Number(bank))}>{L("Assign", "Tetapkan")}</button>
    </span>
  );
}

const ACTION_WORD: Record<string, [string, string]> = {
  "cashbook.reverse": ["Reversed", "Dibalikkan"], "cashbook.auto_reverse": ["Reversed by its source", "Dibalikkan oleh sumbernya"],
  "cashbook.assign_bank": ["Account assigned", "Akaun ditetapkan"], "cashbook.review": ["Reviewed", "Disemak"], "cashbook.accept": ["Difference accepted", "Perbezaan diterima"],
  "cashbook.transfer": ["Transfer recorded", "Pindahan direkod"], "erp.cashflow_create": ["Entered by hand", "Dimasukkan secara manual"], "erp.cashflow_manual": ["Entered by hand", "Dimasukkan secara manual"],
};
const noteOf = (detail: string | null) => {
  try { const d = JSON.parse(detail ?? "{}") as Record<string, unknown>; return String(d.note ?? d.reason ?? "").slice(0, 200); } catch { return ""; }
};
const actionWord = (a: string) => (ACTION_WORD[a] ? L(ACTION_WORD[a]![0], ACTION_WORD[a]![1]) : a);

function HistoryList({ events }: { events: HistoryEvent[] | null }) {
  if (!events) return <SkelRows rows={2} />;
  if (!events.length) return <p className={fx.muted}>{L("Nothing recorded on it yet.", "Belum ada yang direkod padanya.")}</p>;
  return (
    <ul className={fx.history}>
      {events.map((e) => (
        <li key={e.id}><span className={fx.num}>{dmyT(e.created_at)}</span><span><strong>{actionWord(e.action)}</strong>{noteOf(e.detail) && ` · ${noteOf(e.detail)}`}</span><span className={fx.muted}>{e.who ?? "—"}{e.who_role ? ` (${e.who_role.toUpperCase()})` : ""}</span></li>
      ))}
    </ul>
  );
}

/** An item's history (audit log), newest first: who booked, assigned,
    reviewed, accepted or reversed it. */
function useHistory(key: string | null, rev = 0) {
  const [s, setS] = useState<{ k: string; events: HistoryEvent[] } | null>(null);
  const want = key ? `${key}#${rev}` : null;
  useEffect(() => {
    if (!key || !want) return;
    let live = true;
    void api<{ events?: HistoryEvent[] }>(`/cashbook/history?key=${encodeURIComponent(key)}`).then((r) => { if (live) setS({ k: want, events: r.ok ? r.data?.events ?? [] : [] }); });
    return () => { live = false; };
  }, [key, want]);
  return s && s.k === want ? s.events : null;
}

function ItemDrawer({ item, view, onClose, onSource, onReverse, onBank, onSetup }: {
  item: CashItem | null; view: CashbookView | null; onClose: () => void; onSource: (l: CashItem["link"]) => void;
  onReverse: (i: CashItem) => void; onBank: (i: CashItem, bankId: number) => void; onSetup: () => void;
}) {
  const i = item;
  const history = useHistory(i ? i.key : null);
  const canFix = Boolean(view?.can_correct);
  const reversible = Boolean(i && i.row_id && canFix && i.status !== "reversal" && i.status !== "reversed");
  const assignable = Boolean(i && canFix && !i.bank_id && i.status !== "reversal" && /^(CF|PART|INV):\d+$/.test(i.key) && !i.transfer_id);
  const choices = view ? view.banks.filter((b) => b.active && (!i?.company || !b.company || b.company === i.company)) : [];
  const rows: [string, ReactNode][] = i ? [
    [L("Company", "Syarikat"), companyWord(i.company)],
    [L("Money moved on", "Wang bergerak pada"), dmy(i.date)],
    [L("Booked on", "Direkod pada"), i.booked_on ? dmy(i.booked_on) : L("Read from the invoice", "Dibaca daripada invois")],
    [L("Direction", "Arah"), i.type === "in" ? L("Money in", "Tunai masuk") : L("Money out", "Tunai keluar")],
    [L("Amount", "Amaun"), fmtRM(i.amount_cents)],
    [L("Category", "Kategori"), groupWord(i.group)],
    [L("Source", "Sumber"), sourceWord(i.source)],
    [L("Source record", "Rekod sumber"), i.link ? <button type="button" className={css.linkBtn} onClick={() => { onSource(i.link); onClose(); }}>{i.ref || L("Open", "Buka")} →</button> : (i.ref || "—")],
    [L("Payment reference", "Rujukan bayaran"), i.payment_ref || "—"],
    [L("Account", "Akaun"), i.bank_name ?? L("Not assigned", "Belum ditetapkan")],
    [L("Verification", "Pengesahan"), <StatusChip key="s" s={i.status} />],
    [L("Counted in the totals", "Dikira dalam jumlah"), i.counts ? L("Yes", "Ya") : i.awaiting ? L("Not until the CEO verifies it", "Tidak sehingga CEO mengesahkannya") : L("No (transfer or reversal pair)", "Tidak (pindahan atau pasangan pembalikan)")],
    ...(i.reverse_reason ? [[L("Reason", "Sebab"), i.reverse_reason] as [string, ReactNode]] : []),
  ] : [];
  return (
    <SideDrawer open={Boolean(i)} onClose={onClose} title={i ? (i.description || groupWord(i.group)) : ""} subtitle={i ? `${i.type === "in" ? "+" : "−"}${fmtRM(i.amount_cents)}` : undefined}
      footer={i && (reversible || assignable) ? (
        <div className={css.drawerFoot}>
          {assignable && view && (choices.length
            ? <AssignRow key={i.key} banks={choices} suggested={suggestedBank(i, choices)} onAssign={(b) => onBank(i, b)} />
            : (
              <span className={css.assignNone}>
                {L("No account of this company to choose yet.", "Belum ada akaun syarikat ini untuk dipilih.")}
                {view.can_enter && <button type="button" className={btnSmPrimary} onClick={onSetup}>{L("Set up accounts", "Sediakan akaun")}</button>}
              </span>
            ))}
          {reversible && <button type="button" className={btnSm} onClick={() => onReverse(i)}>{L("Reverse…", "Balikkan…")}</button>}
        </div>
      ) : undefined}>
      {i && (
        <div data-testid="item-drawer">
          <dl className={css.facts}>
            {rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}
          </dl>
          <p className={css.subhead}>{L("History", "Sejarah")}</p>
          <HistoryList events={history} />
        </div>
      )}
    </SideDrawer>
  );
}

/** A movement the system cannot see - capital in, a cash top-up - or a
    transfer between two of one company's accounts (v1.312.0: the CEO or COO
    only, with its company and reason; the reference is the server's; sent
    once, whatever the network does). */
function AddDrawer({ view, company, onClose, onSaved, onError }: { view: CashbookView; company: CompanyPick; onClose: () => void; onSaved: (t: string, s: string) => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState<"move" | "transfer">("move");
  const [d, setD] = useState({ company: company === "all" ? "" : company, entry_date: "", type: "out", category: "", bank_id: "", amount: "", ref: "", description: "", reason: "", from: "", to: "" });
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`));
  const [busy, setBusy] = useState(false);
  const [confirmDup, setConfirmDup] = useState(false);
  const banks = view.banks.filter((b) => b.active && (!d.company || b.company === d.company));
  const cents = Math.round(Number(d.amount) * 100);
  const twin = mode === "move" && d.entry_date && cents > 0
    ? view.items.find((i) => i.date === d.entry_date && i.type === d.type && i.amount_cents === cents && i.status !== "reversed" && i.status !== "reversal") : undefined;
  const save = async () => {
    if (twin && !confirmDup) { setConfirmDup(true); return; }
    setBusy(true);
    const r = mode === "move"
      ? await api<{ error?: { message?: string } }>(`/cashflow`, { method: "POST", body: JSON.stringify({ company: d.company, entry_date: d.entry_date, type: d.type, category: d.category, bank_id: d.bank_id ? Number(d.bank_id) : undefined, amount: Number(d.amount), ref: d.ref, description: d.description, reason: d.reason, idempotency_key: key }) })
      : await api<{ error?: { message?: string } }>(`/cashbook/transfer`, { method: "POST", body: JSON.stringify({ date: d.entry_date, from_bank_id: Number(d.from), to_bank_id: Number(d.to), amount: Number(d.amount), description: d.description }) });
    setBusy(false);
    if (r.ok) onSaved(L("Saved", "Disimpan"), mode === "move" ? L("The movement is in the cash book", "Pergerakan ada dalam buku tunai") : L("The transfer is in both accounts", "Pindahan ada dalam kedua-dua akaun"));
    else onError(r.data?.error?.message ?? L("Check the fields", "Semak medan"));
  };
  const ready = d.company && d.entry_date && Number(d.amount) > 0 && (mode === "move" ? d.reason.trim().length >= 5 : (d.from && d.to && d.from !== d.to));
  return (
    <SideDrawer open onClose={onClose} title={L("Add transaction", "Tambah transaksi")}
      subtitle={L("Only money the system cannot see: capital in, cash top-ups, transfers between one company's accounts. Sales, claims, payroll, commission and expenses book themselves.", "Hanya wang yang sistem tidak nampak: modal masuk, tambah nilai tunai, pindahan antara akaun satu syarikat. Jualan, tuntutan, gaji, komisen dan perbelanjaan direkod sendiri.")}
      footer={<div className={css.drawerFoot}><button type="button" className={btnClass} disabled={busy || !ready} onClick={() => void save()} data-testid="add-save">{confirmDup ? L("Save anyway", "Simpan juga") : L("Save", "Simpan")}</button></div>}>
      <div className={css.form}>
        {/* v1.324.0 (Global UI System D-2) - the one switch */}
        <PillSwitch testid="add-kind" label={L("Kind", "Jenis")} value={mode} onChange={setMode}
          options={[["move", L("Money in or out", "Tunai masuk atau keluar")], ["transfer", L("Transfer between accounts", "Pindahan antara akaun")]] as const}
          disabled={banks.length < 2 ? { transfer: L("Needs two accounts of one company", "Perlu dua akaun satu syarikat") } : undefined} />
        <label><span className={fieldLabel}>{L("Company", "Syarikat")}</span>
          <select className={inputClass} value={d.company} onChange={(e) => setD((x) => ({ ...x, company: e.target.value, bank_id: "", from: "", to: "" }))} data-testid="add-company">
            <option value="">{L("Choose…", "Pilih…")}</option><option value="a2z">{COMPANY.a2z}</option><option value="azoo">{COMPANY.azoo}</option>
          </select></label>
        <label><span className={fieldLabel}>{L("Date the money moved", "Tarikh wang bergerak")}</span><input type="date" className={inputClass} max={view.period.today} value={d.entry_date} onChange={(e) => { setConfirmDup(false); setD((x) => ({ ...x, entry_date: e.target.value })); }} /></label>
        {mode === "move" ? (
          <>
            <label><span className={fieldLabel}>{L("Direction", "Arah")}</span>
              <select className={inputClass} value={d.type} onChange={(e) => { setConfirmDup(false); setD((x) => ({ ...x, type: e.target.value })); }}>
                <option value="in">{L("Money in", "Tunai masuk")}</option><option value="out">{L("Money out", "Tunai keluar")}</option>
              </select></label>
            <label><span className={fieldLabel}>{L("Category", "Kategori")}</span><input className={inputClass} placeholder={L("Capital / Cash top-up / Bank charges…", "Modal / Tambah nilai tunai / Caj bank…")} value={d.category} onChange={(e) => setD((x) => ({ ...x, category: e.target.value }))} /></label>
            <label><span className={fieldLabel}>{L("Account", "Akaun")}</span>
              <select className={inputClass} value={d.bank_id} onChange={(e) => setD((x) => ({ ...x, bank_id: e.target.value }))}>
                <option value="">—</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
            <label><span className={fieldLabel}>{L("Bank reference (optional)", "Rujukan bank (pilihan)")}</span><input className={inputClass} value={d.ref} onChange={(e) => setD((x) => ({ ...x, ref: e.target.value }))} /></label>
          </>
        ) : (
          <>
            <label><span className={fieldLabel}>{L("From account", "Dari akaun")}</span>
              <select className={inputClass} value={d.from} onChange={(e) => setD((x) => ({ ...x, from: e.target.value }))}><option value="">—</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label><span className={fieldLabel}>{L("To account", "Ke akaun")}</span>
              <select className={inputClass} value={d.to} onChange={(e) => setD((x) => ({ ...x, to: e.target.value }))}><option value="">—</option>{banks.filter((b) => String(b.id) !== d.from).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          </>
        )}
        <label><span className={fieldLabel}>{L("Amount (RM)", "Amaun (RM)")}</span><input type="number" min="0.01" step="0.01" inputMode="decimal" className={inputClass} value={d.amount} onChange={(e) => { setConfirmDup(false); setD((x) => ({ ...x, amount: e.target.value })); }} /></label>
        <label><span className={fieldLabel}>{L("Description", "Keterangan")}</span><input className={inputClass} value={d.description} onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))} /></label>
        {mode === "move" && <label><span className={fieldLabel}>{L("Why is it entered by hand?", "Mengapa ia dimasukkan secara manual?")}</span><input className={inputClass} value={d.reason} onChange={(e) => setD((x) => ({ ...x, reason: e.target.value }))} data-testid="add-reason" /></label>}
        {twin && (
          <p className={css.warn}>{L(`This looks like a movement already booked on that day: ${twin.description || twin.ref} (${fmtRM(twin.amount_cents)}, ${sourceWord(twin.source)}). Save only if it is a different payment.`, `Ini seperti pergerakan yang sudah direkod pada hari itu: ${twin.description || twin.ref} (${fmtRM(twin.amount_cents)}, ${sourceWord(twin.source)}). Simpan hanya jika ia bayaran berlainan.`)}</p>
        )}
      </div>
    </SideDrawer>
  );
}

/** The company's accounts: each belongs to one company (v1.312.0). Add one,
    and - for the CEO and COO - set its company (once), names, active, and
    the opening balance a book balance is counted from. */
function AccountsDrawer({ view, onClose, onSavedToast, onError }: { view: CashbookView; onClose: () => void; onSavedToast: (t: string) => void; onError: (m: string) => void }) {
  const [nb, setNb] = useState({ name: "", bank: "", number_masked: "", company: "" });
  const [edit, setEdit] = useState<Record<number, { opening: string; on: string }>>({});
  const [adding, setAdding] = useState(false);
  /* v1.312.1 (the CEO, 15-11-2026: "Finance account add is saved, but it
     doesn't reflect") - the drawer lists EVERY company account, not only the
     company the page is showing: an AZ ONE account added while A2Z was
     chosen was saved but hidden, and its Add button stayed, so it could be
     added again. The book balance comes from the page's view where the
     account is in it; another company's balance is read under its own name. */
  const [all, setAll] = useState<{ banks: Bank[]; failed: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void api<{ banks: Bank[] }>(`/banks`).then((r) => { if (alive) setAll({ banks: r.ok ? r.data?.banks ?? [] : [], failed: !r.ok }); });
    return () => { alive = false; };
  }, [tick]);
  const banks: Bank[] = (!all || all.failed ? view.banks : all.banks).map((b) => ({ ...b, book_balance_cents: view.banks.find((x) => x.id === b.id)?.book_balance_cents ?? null }));
  const shownHere = (b: Bank) => view.banks.some((x) => x.id === b.id);
  const add = async () => {
    const r = await api<{ error?: { message?: string } }>(`/banks`, { method: "POST", body: JSON.stringify(nb) });
    if (r.ok) { setNb({ name: "", bank: "", number_masked: "", company: "" }); setTick((n) => n + 1); onSavedToast(L("Account added", "Akaun ditambah")); }
    else onError(r.data?.error?.message ?? L("The account needs a name and a company", "Akaun perlu nama dan syarikat"));
  };
  const addInvoiceAccount = async (a: (typeof INVOICE_ACCOUNTS)[number]) => {
    setAdding(true);
    const r = await api<{ error?: { message?: string } }>(`/banks`, { method: "POST", body: JSON.stringify({ name: a.name, bank: a.bank, number_masked: a.number_masked, company: a.code }) });
    setAdding(false);
    if (r.ok) { setTick((n) => n + 1); onSavedToast(L(`${a.name} added`, `${a.name} ditambah`)); } else onError(r.data?.error?.message ?? L("Try again", "Cuba lagi"));
  };
  const patch = async (id: number, body: Record<string, unknown>, done: string) => {
    const r = await api<{ error?: { message?: string } }>(`/cashbook/banks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (r.ok) { setTick((n) => n + 1); onSavedToast(done); } else onError(r.data?.error?.message ?? L("Try again", "Cuba lagi"));
  };
  return (
    <SideDrawer open onClose={onClose} title={L("Company accounts", "Akaun syarikat")} subtitle={L("Masked numbers only. Each account belongs to one company. A book balance is shown only from an opening balance you enter - it is not bank-verified.", "Nombor bertopeng sahaja. Setiap akaun milik satu syarikat. Baki buku dipaparkan hanya dari baki pembukaan yang anda masukkan - ia tidak disahkan bank.")}>
      <div className={css.form}>
        {view.can_correct && (
          <div className={css.accEdit}>
            <p className={css.subhead}>{L("Accounts printed on your invoices", "Akaun yang tercetak pada invois anda")}</p>
            <ul className={css.invAcc}>
              {INVOICE_ACCOUNTS.map((a) => {
                const have = banks.some((b) => b.active && b.company === a.code && last4(b.number_masked) === a.last4);
                return (
                  <li key={a.code}>
                    <span><strong>{a.name}</strong><small>{a.number_masked} · {COMPANY[a.code]}</small></span>
                    {have ? <span className={chipSuccess}>{L("Added", "Ditambah")}</span>
                      : <button type="button" className={btnSmPrimary} disabled={adding} onClick={() => void addInvoiceAccount(a)}>{L("Add", "Tambah")}</button>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {all === null ? <SkelRows rows={3} /> : banks.length === 0 && <p className={fx.empty}>{L("No accounts yet.", "Tiada akaun lagi.")}</p>}
        {all !== null && banks.map((b) => {
          const e = edit[b.id] ?? { opening: b.opening_balance_cents != null ? (b.opening_balance_cents / 100).toFixed(2) : "", on: b.opening_on ?? "" };
          return (
            <div key={b.id} className={css.accEdit} data-testid={`account-${b.id}`}>
              <p className={css.accName}>{b.name}{!b.active && <span className={chipNeutral}>{L("Inactive", "Tidak aktif")}</span>}<small>{[b.bank, b.number_masked, companyWord(b.company)].filter(Boolean).join(" · ")}</small></p>
              {view.can_correct ? (
                <>
                  {!b.company && (
                    <label><span className={fieldLabel}>{L("Company (set once)", "Syarikat (ditetapkan sekali)")}</span>
                      <select className={inputClass} defaultValue="" onChange={(ev) => { if (ev.target.value) void patch(b.id, { company: ev.target.value }, L("Company set", "Syarikat ditetapkan")); }} data-testid={`account-company-${b.id}`}>
                        <option value="">{L("Choose…", "Pilih…")}</option><option value="a2z">{COMPANY.a2z}</option><option value="azoo">{COMPANY.azoo}</option>
                      </select></label>
                  )}
                  <div className={css.pair}>
                    <label><span className={fieldLabel}>{L("Opening balance (RM)", "Baki pembukaan (RM)")}</span><input type="number" step="0.01" inputMode="decimal" className={inputClass} value={e.opening} onChange={(ev) => setEdit((x) => ({ ...x, [b.id]: { ...e, opening: ev.target.value } }))} /></label>
                    <label><span className={fieldLabel}>{L("True on", "Benar pada")}</span><input type="date" className={inputClass} max={view.period.today} value={e.on} onChange={(ev) => setEdit((x) => ({ ...x, [b.id]: { ...e, on: ev.target.value } }))} /></label>
                  </div>
                  <div className={css.rowBtns}>
                    <button type="button" className={btnSmPrimary} disabled={!e.opening || !e.on} onClick={() => void patch(b.id, { opening_balance: Number(e.opening), opening_on: e.on }, L("Opening balance saved", "Baki pembukaan disimpan"))}>{L("Save opening balance", "Simpan baki pembukaan")}</button>
                    <button type="button" className={btnSm} onClick={() => void patch(b.id, { active: !b.active }, b.active ? L("Account set inactive", "Akaun dinyahaktifkan") : L("Account active again", "Akaun aktif semula"))}>{b.active ? L("Set inactive", "Nyahaktifkan") : L("Set active", "Aktifkan")}</button>
                  </div>
                </>
              ) : (
                <p className={css.meta}>{!shownHere(b) ? L(`Choose ${companyWord(b.company)} above to see its book balance.`, `Pilih ${companyWord(b.company)} di atas untuk melihat baki bukunya.`) : b.book_balance_cents != null ? `${fmtSigned(b.book_balance_cents)} · ${L("book balance (not bank-verified)", "baki buku (tidak disahkan bank)")}` : L("No opening balance. The CEO or COO enters it.", "Tiada baki pembukaan. CEO atau COO memasukkannya.")}</p>
              )}
            </div>
          );
        })}
        {view.can_correct && (
          <>
            <p className={css.subhead}>{L("Add an account", "Tambah akaun")}</p>
            <label><span className={fieldLabel}>{L("Company", "Syarikat")}</span>
              <select className={inputClass} value={nb.company} onChange={(e) => setNb((x) => ({ ...x, company: e.target.value }))}>
                <option value="">{L("Choose…", "Pilih…")}</option><option value="a2z">{COMPANY.a2z}</option><option value="azoo">{COMPANY.azoo}</option>
              </select></label>
            <label><span className={fieldLabel}>{L("Account name", "Nama akaun")}</span><input className={inputClass} value={nb.name} onChange={(e) => setNb((x) => ({ ...x, name: e.target.value }))} /></label>
            <div className={css.pair}>
              <label><span className={fieldLabel}>Bank</span><input className={inputClass} placeholder="Maybank" value={nb.bank} onChange={(e) => setNb((x) => ({ ...x, bank: e.target.value }))} /></label>
              <label><span className={fieldLabel}>{L("Number (masked)", "Nombor (bertopeng)")}</span><input className={inputClass} placeholder="•••• 1234" value={nb.number_masked} onChange={(e) => setNb((x) => ({ ...x, number_masked: e.target.value }))} /></label>
            </div>
            <button type="button" className={btnSm} disabled={!nb.name.trim() || !nb.company} onClick={() => void add()}>{L("Add account", "Tambah akaun")}</button>
          </>
        )}
      </div>
    </SideDrawer>
  );
}

/* ================================================================== *
 * 03 Expenses (reference 03).
 * ================================================================== */

const prevMonthOf = (ym: string) => { const [y, m] = ym.split("-").map(Number) as [number, number]; return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };
type Toast = (t: string, s: string, k?: "notice") => void;

function Expenses({ v, period, company, toast, onChanged }: { v: CashbookView | null; period: { from: string; to: string }; company: CompanyPick; toast: Toast; onChanged: () => void }) {
  const today = mytToday();
  const caps = v?.expense_caps ?? { record: false, approve: false, authorise: false, pay: false };
  const me = v?.me;
  const [rev, setRev] = useState(0);
  const refresh = () => { setRev((n) => n + 1); onChanged(); };
  const [due, setDue] = useState<{ k: string; list: DueItem[] } | null>(null);
  const [exps, setExps] = useState<{ k: string; list: Expense[] } | null>(null);
  const month = period.to.slice(0, 7);
  const dueKey = `${company}|${rev}`;
  const expKey = `${company}|${month}|${rev}`;
  useEffect(() => {
    let live = true;
    void api<{ due?: DueItem[] }>(`/cashbook/due?company=${company}`).then((r) => { if (live) setDue({ k: dueKey, list: r.ok ? r.data?.due ?? [] : [] }); });
    return () => { live = false; };
  }, [company, dueKey]);
  useEffect(() => {
    let live = true;
    void staffApi<{ expenses?: Expense[] }>(`/expenses?month=${month}${company !== "all" ? `&company=${company}` : ""}`).then((r) => { if (live) setExps({ k: expKey, list: r.ok ? r.data?.expenses ?? [] : [] }); });
    return () => { live = false; };
  }, [company, month, expKey]);
  const dueList = due?.k === dueKey ? due.list : null;
  const expList = exps?.k === expKey ? exps.list : null;
  const [all, setAll] = useState(false);
  const [paying, setPaying] = useState<Expense | null>(null);
  const { prompt, node: promptNode } = usePrompt();

  /* ---- the steps (the server checks each again) ---- */
  const step = async (id: number, s: "approve" | "authorise") => {
    const r = s === "approve"
      ? await staffApi<{ error?: { message?: string } }>(`/expenses/${id}/approve`, { method: "POST", body: JSON.stringify({}) })
      : await staffApi<{ error?: { message?: string } }>(`/expenses/${id}/authorise`, { method: "POST", body: JSON.stringify({}) });
    if (r.ok) { toast(s === "approve" ? L("Approved", "Diluluskan") : L("Payment authorised", "Bayaran dibenarkan"), L("Recorded with your name", "Direkod dengan nama anda")); refresh(); }
    else toast(L("Not done", "Tidak dibuat"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const cancel = async (e: Expense) => {
    const r0 = await prompt({ title: L("Cancel this expense?", "Batalkan perbelanjaan ini?"), message: `${e.vendor || e.description || expCatWord(e.category)} · ${fmtRM(e.amount_cents)}`, label: L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)"), required: true, confirmLabel: L("Cancel expense", "Batalkan perbelanjaan"), variant: "danger" });
    if (!r0) return;
    const r = await staffApi<{ error?: { message?: string } }>(`/expenses/${e.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: r0.value }) });
    if (r.ok) { toast(L("Cancelled", "Dibatalkan"), L("It stays in the records, with your reason", "Ia kekal dalam rekod, dengan sebab anda")); refresh(); }
    else toast(L("Not cancelled", "Tidak dibatalkan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const actionsFor = (e: Expense, compact = false) => {
    const s = e.status ?? (e.paid_at ? "paid" : "recorded");
    const mine = me?.id === e.created_by;
    return (
      <span className={fx.rowActs}>
        {s === "recorded" && caps.approve && !mine && <button type="button" className={btnSm} onClick={() => void step(e.id, "approve")} data-testid="exp-approve">{L("Approve", "Luluskan")}</button>}
        {s === "approved" && caps.authorise && <button type="button" className={btnSm} onClick={() => void step(e.id, "authorise")} data-testid="exp-authorise">{L("Authorise payment", "Benarkan bayaran")}</button>}
        {s === "authorised" && caps.pay && me?.id !== e.authorised_by && <button type="button" className={btnSmPrimary} onClick={() => setPaying(e)} data-testid="exp-pay">{L("Pay…", "Bayar…")}</button>}
        {!compact && !["paid", "cancelled"].includes(s) && (caps.approve || caps.authorise || mine) && <button type="button" className={btnSm} onClick={() => void cancel(e)}>{L("Cancel…", "Batal…")}</button>}
        {!compact && e.receipt_key && <a className={btnSm} href={`/api/v1/staff/expenses/${e.id}/evidence`} target="_blank" rel="noreferrer">{L("Evidence", "Bukti")}</a>}
      </span>
    );
  };
  const expOf = (id: number | string | null) => (expList ?? []).find((e) => e.id === Number(id));

  /* ---- Monthly Expense Impact: actual money out, against the month before ---- */
  const outNow = v?.totals.out_cents ?? 0;
  const prevOut = (v?.trend ?? []).find((t) => t.month === prevMonthOf(month))?.out_cents ?? null;
  const change = prevOut && prevOut > 0 ? ((outNow - prevOut) / prevOut) * 100 : null;
  const top = v?.groups.out[0] ?? null;

  return (
    <div className={fx.stack} data-testid="finance-expenses">
      {promptNode}
      <h2 className={fx.pageTitle}>{L("Expenses", "Perbelanjaan")} <span>— {L("company spending, upcoming payments & cash impact", "Perbelanjaan syarikat, bayaran akan datang & impak tunai")}</span></h2>
      <Banner><strong>{L("Cash basis:", "Asas tunai:")}</strong> {L("an expense affects cash only when its payment is completed (the bank date). Recorded, approved and scheduled expenses are commitments, never cash.", "perbelanjaan memberi kesan kepada tunai hanya apabila bayarannya selesai (tarikh bank). Perbelanjaan yang direkod, diluluskan dan dijadualkan ialah komitmen, bukan tunai.")}</Banner>
      {caps.record && <AddExpense v={v} company={company} toast={toast} onSaved={refresh} />}
      <div className={fx.split21}>
        <section className={card} aria-label={L("Due Payments / Scheduled Expenses", "Bayaran Perlu / Perbelanjaan Berjadual")} data-testid="expense-due">
          <CardHead icon="date" title={L("Due Payments / Scheduled Expenses", "Bayaran Perlu / Perbelanjaan Berjadual")} aside={<button type="button" className={btnSm} onClick={() => setAll(true)} data-testid="expense-view-all"><AppIcon name="add" />{L("View All", "Lihat Semua")}</button>} />
          {!dueList ? <SkelRows rows={3} /> : dueList.length === 0 ? <p className={fx.empty}>{L("No payment due. Approved claims, payroll due, approved expenses and recurring expenses appear here.", "Tiada bayaran perlu. Tuntutan diluluskan, gaji perlu, perbelanjaan diluluskan dan berulang dipaparkan di sini.")}</p> : (
            <ul className={fx.dueList}>
              {dueList.slice(0, 6).map((d) => {
                const e = d.kind === "expense" ? expOf(d.id) : undefined;
                return (
                  <li key={d.key} data-testid="due-item" data-kind={d.kind}>
                    <span className={fx.dueIcon} aria-hidden><AppIcon name={d.kind === "claims" ? "users" : d.kind === "payroll" ? "pay" : d.kind === "recurring" ? "refresh" : "receipt"} /></span>
                    <span className={fx.dueMain}><strong>{d.title}</strong><small>{d.sub}{d.kind === "expense" || d.kind === "recurring" ? ` · ${companyWord(d.company)}` : ""}</small></span>
                    <span className={fx.dueDate}>{d.due_on ? <><AppIcon name="date" />{L("Due", "Tamat")} {dmy(d.due_on)}</> : <StageChip s={d.kind === "expense" ? stageOf({ status: d.stage, due_on: d.due_on }) : d.stage} />}</span>
                    <strong className={`${fx.duePill} ${fx.num}`}>{fmtRM(d.amount_cents)}</strong>
                    {e && <span className={fx.dueActs}>{actionsFor(e, true)}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className={card} aria-label={L("Monthly Expense Impact", "Impak Perbelanjaan Bulanan")} data-testid="expense-impact">
          <CardHead icon="chart" title={<>{L("Monthly Expense Impact", "Impak Perbelanjaan Bulanan")} <span className={fx.muted}>({periodWord(period.from, period.to)})</span></>} />
          {!v ? <SkelRows rows={3} /> : (
            <dl className={fx.impact}>
              <div><dt>{L("Total Expenses", "Jumlah Perbelanjaan")}</dt><dd className={fx.big}>{fmtRM(outNow)}</dd></div>
              <div><dt>{L("vs Last Month", "berbanding Bulan Lepas")}</dt><dd>{change == null ? <span className={fx.muted}>—</span> : <span className={change <= 0 ? fx.goodPill : fx.badPill}>{change <= 0 ? "↓" : "↑"} {Math.abs(change).toFixed(1)}%</span>}</dd></div>
              <div><dt>{L("Top Category", "Kategori Utama")}</dt><dd><strong>{top ? `${groupWord(top.group)} (${pct(top.cents, outNow)})` : "—"}</strong></dd></div>
            </dl>
          )}
        </section>
      </div>
      <section className={card} aria-label={L("Monthly Summary", "Ringkasan Bulanan")} data-testid="expense-summary">
        <CardHead icon="chart" title={<>{L("Monthly Summary", "Ringkasan Bulanan")} <span className={fx.muted}>({periodWord(period.from, period.to)})</span></>} />
        {!v ? <SkelRows rows={3} /> : v.groups.out.length === 0 ? <p className={fx.empty}>{L("Nothing paid out in this period.", "Tiada pembayaran dalam tempoh ini.")}</p> : (
          <div className={fx.tWrap}>
            <table className={fx.t}>
              <thead><tr><th>{L("Category", "Kategori")}</th><th className={fx.r}>{L("Amount (RM)", "Amaun (RM)")}</th><th className={fx.r}>{L("% of Total", "% daripada Jumlah")}</th></tr></thead>
              <tbody>{v.groups.out.map((g) => <tr key={g.group}><td>{groupWord(g.group)}</td><td className={`${fx.r} ${fx.num}`}>{fmtSigned(g.cents)}</td><td className={`${fx.r} ${fx.num}`}>{pct(g.cents, outNow)}</td></tr>)}</tbody>
              <tfoot><tr className={fx.totalRow}><td>{L("Total Expenses", "Jumlah Perbelanjaan")}</td><td className={`${fx.r} ${fx.num}`}>{fmtRM(outNow)}</td><td className={`${fx.r} ${fx.num}`}>{outNow > 0 ? "100.0%" : "—"}</td></tr></tfoot>
            </table>
          </div>
        )}
      </section>

      <SideDrawer open={all} onClose={() => setAll(false)} title={L("Expenses", "Perbelanjaan")} subtitle={`${monthWord(month)} · ${company === "all" ? L("both companies", "kedua-dua syarikat") : COMPANY[company]}`}>
        {!expList ? <SkelRows rows={4} /> : expList.length === 0 ? <p className={fx.empty}>{L("No expense recorded in this month.", "Tiada perbelanjaan direkod bulan ini.")}</p> : (
          <ul className={fx.expList} data-testid="expense-list">
            {expList.map((e) => (
              <li key={e.id} data-testid={`expense-${e.id}`}>
                <span className={fx.cardTop}><strong>{e.vendor || e.description || expCatWord(e.category)}</strong><strong className={fx.num}>{fmtRM(e.amount_cents)}</strong></span>
                <span className={fx.muted}>{dmy(e.expense_date)} · {expCatWord(e.category)} · {companyWord((e.company as Company | null) ?? null)}{e.created_by_name ? ` · ${L("recorded by", "direkod oleh")} ${e.created_by_name}` : ""}</span>
                <span className={fx.cardTop}><StageChip s={stageOf(e)} />{actionsFor(e)}</span>
                {e.cancel_reason && <span className={fx.muted}>{L("Cancelled:", "Dibatalkan:")} {e.cancel_reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </SideDrawer>
      {paying && v && <PayDrawer e={paying} v={v} today={today} onClose={() => setPaying(null)} onDone={() => { setPaying(null); toast(L("Paid", "Dibayar"), L("One cash movement, dated the bank date", "Satu pergerakan tunai, bertarikh tarikh bank")); refresh(); }} onError={(m) => toast(L("Not paid", "Tidak dibayar"), m, "notice")} />}
    </div>
  );
}

/** Add Expense (reference 03): the reference's row, then the directive's -
    company, payee, payment account and evidence. Recording never books cash. */
function AddExpense({ v, company, toast, onSaved }: { v: CashbookView | null; company: CompanyPick; toast: Toast; onSaved: () => void }) {
  const blank = (co: string) => ({ description: "", category: "", amount: "", expense_date: mytToday(), recurring: false, company: co, vendor: "", bank_id: "" });
  const [d, setD] = useState(() => blank(company === "all" ? "" : company));
  const [seenCo, setSeenCo] = useState(company);
  if (seenCo !== company) { setSeenCo(company); setD((x) => ({ ...x, company: company === "all" ? x.company : company, bank_id: "" })); }
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  /* v1.324.0 (Global UI System, inline forms to drawers) - the form opens on demand in the drawer,
     on a desktop and a phone alike; the fields, the checks and the POST are unchanged */
  const [openForm, setOpenForm] = useState(false);
  const banks = (v?.banks ?? []).filter((b) => b.active && b.company === d.company);
  const ready = d.description.trim() && d.category && Number(d.amount) > 0 && d.expense_date && d.company;
  const save = async () => {
    setBusy(true);
    const r = await staffApi<{ id?: number; error?: { message?: string } }>(`/expenses`, { method: "POST", body: JSON.stringify({ description: d.description.trim(), category: d.category, amount: Number(d.amount), expense_date: d.expense_date, recurring: d.recurring, due_day: d.recurring ? Number(d.expense_date.slice(8, 10)) : undefined, company: d.company, vendor: d.vendor.trim() || undefined, bank_id: d.bank_id ? Number(d.bank_id) : undefined }) });
    if (r.ok && r.data?.id && file) {
      const up = await csrfFetch(`/api/v1/staff/expenses/${r.data.id}/evidence`, { method: "POST", headers: { "content-type": file.type || "application/pdf" }, body: file, credentials: "include" }).catch(() => null);
      if (!up?.ok) toast(L("Recorded - evidence not attached", "Direkod - bukti tidak dilampirkan"), L("Attach it at payment", "Lampirkan semasa bayaran"), "notice");
    }
    setBusy(false);
    if (r.ok) { toast(L("Expense recorded", "Perbelanjaan direkod"), L("Awaiting approval - nothing is paid yet", "Menunggu kelulusan - belum dibayar")); setD(blank(company === "all" ? "" : company)); setFile(null); setOpenForm(false); onSaved(); }
    else toast(L("Not recorded", "Tidak direkod"), r.data?.error?.message ?? L("Check the fields", "Semak medan"), "notice");
  };
  return (
    <section className={card} aria-label={L("Add Expense", "Tambah Perbelanjaan")} data-testid="expense-form">
      <CardHead icon="document" title={L("Add Expense", "Tambah Perbelanjaan")}
        aside={<button type="button" className={btnSmPrimary} onClick={() => setOpenForm(true)} data-testid="expense-open"><AppIcon name="add" />{L("Add expense", "Tambah perbelanjaan")}</button>} />
      <SideDrawer open={openForm} onClose={() => setOpenForm(false)} dirty="auto" wide title={L("Add Expense", "Tambah Perbelanjaan")}
        subtitle={L("Recording never books cash: it waits for approval and payment.", "Merekod tidak membuku tunai: ia menunggu kelulusan dan bayaran.")}>
      <div className={fx.drawerForm}>
      <div className={fx.formRow}>
        <label className={fx.f2}><span className={fieldLabel}>{L("Description", "Keterangan")} *</span><input className={inputClass} placeholder={L("e.g. Office rental, software", "cth. Sewa pejabat, perisian")} value={d.description} onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))} data-testid="expense-description" /></label>
        <label><span className={fieldLabel}>{L("Category", "Kategori")} *</span>
          <select className={inputClass} value={d.category} onChange={(e) => setD((x) => ({ ...x, category: e.target.value }))} data-testid="expense-category"><option value="">{L("Select category", "Pilih kategori")}</option>{EXP_CATS.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
        <label><span className={fieldLabel}>{L("Amount (RM)", "Amaun (RM)")} *</span><input type="number" min="0.01" step="0.01" inputMode="decimal" className={inputClass} placeholder="0.00" value={d.amount} onChange={(e) => setD((x) => ({ ...x, amount: e.target.value }))} data-testid="expense-amount" /></label>
        <label><span className={fieldLabel}>{L("Date", "Tarikh")} *</span><input type="date" className={inputClass} value={d.expense_date} onChange={(e) => setD((x) => ({ ...x, expense_date: e.target.value }))} /></label>
        <label className={fx.toggle}><span className={fieldLabel}>{L("Recurring expense", "Perbelanjaan berulang")} <span className={fx.muted}>({L("optional", "pilihan")})</span></span>
          <span className={fx.toggleRow}><input type="checkbox" role="switch" checked={d.recurring} onChange={(e) => setD((x) => ({ ...x, recurring: e.target.checked }))} /> {L("Repeat monthly (e.g. rent, subscription)", "Ulang bulanan (cth. sewa, langganan)")}</span></label>
      </div>
      <div className={fx.formRow}>
        <label><span className={fieldLabel}>{L("Company", "Syarikat")} *</span>
          <select className={inputClass} value={d.company} onChange={(e) => setD((x) => ({ ...x, company: e.target.value, bank_id: "" }))} data-testid="expense-company"><option value="">{L("Choose…", "Pilih…")}</option><option value="a2z">{COMPANY.a2z}</option><option value="azoo">{COMPANY.azoo}</option></select></label>
        <label><span className={fieldLabel}>{L("Vendor or payee", "Vendor atau penerima")}</span><input className={inputClass} value={d.vendor} onChange={(e) => setD((x) => ({ ...x, vendor: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Payment account", "Akaun bayaran")}</span>
          <select className={inputClass} value={d.bank_id} onChange={(e) => setD((x) => ({ ...x, bank_id: e.target.value }))} disabled={!d.company}><option value="">{L("Decided at payment", "Ditentukan semasa bayaran")}</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label><span className={fieldLabel}>{L("Supporting evidence", "Bukti sokongan")}</span><input type="file" accept="application/pdf,image/jpeg,image/png" className={inputClass} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <span className={fx.formBtns}>
          <button type="button" className={btnSm} onClick={() => { setD(blank(company === "all" ? "" : company)); setFile(null); }}>{L("Clear", "Kosongkan")}</button>
          <button type="button" className={btnSmPrimary} disabled={busy || !ready} onClick={() => void save()} data-testid="expense-record">{L("Record Expense", "Rekod Perbelanjaan")}</button>
        </span>
      </div>
      </div>
      </SideDrawer>
    </section>
  );
}

/** Complete a payment (Finance, the COO): the bank date, the account of the
    expense's company, the bank reference and the evidence. */
function PayDrawer({ e, v, today, onClose, onDone, onError }: { e: Expense; v: CashbookView; today: string; onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [d, setD] = useState({ paid_on: today, bank_id: e.bank_id ? String(e.bank_id) : "", payment_ref: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const banks = v.banks.filter((b) => b.active && b.company === e.company);
  const pay = async () => {
    setBusy(true);
    if (file) {
      const up = await csrfFetch(`/api/v1/staff/expenses/${e.id}/evidence`, { method: "POST", headers: { "content-type": file.type || "application/pdf" }, body: file, credentials: "include" }).catch(() => null);
      if (!up?.ok) { setBusy(false); onError(L("The evidence could not be attached", "Bukti tidak dapat dilampirkan")); return; }
    }
    const r = await staffApi<{ error?: { message?: string } }>(`/expenses/${e.id}/pay`, { method: "POST", body: JSON.stringify({ paid_on: d.paid_on, bank_id: Number(d.bank_id), payment_ref: d.payment_ref }) });
    setBusy(false);
    if (r.ok) onDone(); else onError(r.data?.error?.message ?? L("Check the fields", "Semak medan"));
  };
  const ready = d.paid_on && d.bank_id && d.payment_ref.trim().length >= 3 && (e.receipt_key || file);
  return (
    <SideDrawer open onClose={onClose} title={L("Complete payment", "Lengkapkan bayaran")} subtitle={`${e.vendor || e.description || expCatWord(e.category)} · ${fmtRM(e.amount_cents)} · ${companyWord((e.company as Company | null) ?? null)}`}
      footer={<div className={css.drawerFoot}><button type="button" className={btnClass} disabled={busy || !ready} onClick={() => void pay()} data-testid="pay-confirm">{L("Record payment", "Rekod bayaran")}</button></div>}>
      <div className={css.form}>
        <label><span className={fieldLabel}>{L("Bank date", "Tarikh bank")}</span><input type="date" className={inputClass} max={today} value={d.paid_on} onChange={(ev) => setD((x) => ({ ...x, paid_on: ev.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Paid from account", "Dibayar dari akaun")}</span>
          <select className={inputClass} value={d.bank_id} onChange={(ev) => setD((x) => ({ ...x, bank_id: ev.target.value }))}><option value="">{L("Choose…", "Pilih…")}</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label><span className={fieldLabel}>{L("Bank reference", "Rujukan bank")}</span><input className={inputClass} value={d.payment_ref} onChange={(ev) => setD((x) => ({ ...x, payment_ref: ev.target.value }))} /></label>
        <label><span className={fieldLabel}>{e.receipt_key ? L("Replace evidence (optional)", "Ganti bukti (pilihan)") : L("Evidence (required)", "Bukti (wajib)")}</span><input type="file" accept="application/pdf,image/jpeg,image/png" className={inputClass} onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} /></label>
        {banks.length === 0 && <p className={css.warn}>{L("This company has no active account yet - the CEO or COO adds it under Manage accounts.", "Syarikat ini belum ada akaun aktif - CEO atau COO menambahnya di Urus akaun.")}</p>}
      </div>
    </SideDrawer>
  );
}

/* ================================================================== *
 * 04 Reconciliation (reference 04).
 * ================================================================== */

function MismatchCard({ x, v, onReverse, onReview, onAccept, onOpen }: { x: Exception; v: CashbookView; onReverse: (x: Exception) => void; onReview: (x: Exception) => void; onAccept: (x: Exception) => void; onOpen: (l: CashItem["link"]) => void }) {
  const events = useHistory(`${x.kind}|${x.key}`, x.state === "reviewed" ? 1 : 0);
  const [more, setMore] = useState(false);
  const [full, setFull] = useState(false);
  const latest = events?.[0];
  return (
    <li className={fx.recCard} data-testid="recon-card" data-state={x.state}>
      <div className={fx.recTop}>
        <span className={fx.recTitle}><strong>{x.title}</strong><small>{dmy(x.date)} · {x.detail}</small></span>
        <span className={x.state === "reviewed" ? chipInfo : chipDanger}>{x.state === "reviewed" ? L("Reviewed - still open", "Disemak - masih terbuka") : L("Out of Step (Mismatch)", "Tidak Sepadan")}</span>
      </div>
      <div className={fx.recBody}>
        <div className={fx.recMain}>
          <p>{L("The cash book and source record do not match. Review and take action.", "Buku tunai dan rekod sumber tidak sepadan. Semak dan ambil tindakan.")}</p>
          <dl className={fx.recFigs}>
            <div><dt>{L("Source record", "Rekod sumber")}</dt><dd className={fx.num}>{x.source_cents != null ? fmtRM(x.source_cents) : "—"}</dd></div>
            <div><dt>{L("Cash book", "Buku tunai")}</dt><dd className={fx.num}>{x.booked_cents != null ? fmtRM(x.booked_cents) : "—"}</dd></div>
            {v.consolidated && <div><dt>{L("Company", "Syarikat")}</dt><dd>{companyWord(x.company)}</dd></div>}
          </dl>
          <div className={fx.recActs}>
            {x.link && <button type="button" className={btnSm} onClick={() => onOpen(x.link)}><AppIcon name="external" />{L("Open Record", "Buka Rekod")}</button>}
            {v.can_correct && x.actions.includes("reverse") && x.row_id && <button type="button" className={btnSm} onClick={() => onReverse(x)}><AppIcon name="previous" />{L("Reverse", "Balikkan")}</button>}
            {v.can_correct && x.state === "open" && <button type="button" className={`${btnSm} ${fx.goldBtn}`} onClick={() => onReview(x)} data-testid="recon-review"><AppIcon name="success" />{L("Mark Reviewed", "Tanda Disemak")}</button>}
            {v.can_accept && (
              <span className={fx.moreWrap}>
                <button type="button" className={btnSm} aria-expanded={more} onClick={() => setMore((m) => !m)}>{L("More", "Lagi")} <AppIcon name="expand" /></button>
                {more && <span className={fx.moreMenu} role="menu"><button type="button" role="menuitem" onClick={() => { setMore(false); onAccept(x); }}>{L("Accept the difference (CEO)…", "Terima perbezaan (CEO)…")}</button></span>}
              </span>
            )}
          </div>
        </div>
        <div className={fx.recDiff}><small>{L("Difference", "Perbezaan")}</small><strong className={(x.difference_cents ?? 0) < 0 ? fx.neg : fx.pos} data-testid="recon-card-difference">{x.difference_cents != null ? fmtSigned(x.difference_cents) : "—"}</strong><small className={fx.muted}>{L("Source − cash book", "Sumber − buku tunai")}</small></div>
      </div>
      <div className={fx.recHistory}>
        <button type="button" className={fx.historyBtn} onClick={() => setFull((f) => !f)} aria-expanded={full}><AppIcon name="time" />{L("Review History", "Sejarah Semakan")}</button>
        {!events ? <span className={fx.muted}>…</span> : !latest ? <span className={fx.muted}>{L("Listed when the mismatch was detected; no action yet.", "Disenaraikan apabila ketidaksepadanan dikesan; belum ada tindakan.")}</span> : <span>{dmyT(latest.created_at)} · {actionWord(latest.action)}{noteOf(latest.detail) && ` - ${noteOf(latest.detail)}`} · {latest.who ?? "—"}</span>}
      </div>
      {full && <HistoryList events={events} />}
    </li>
  );
}

function Reconciliation({ v, onReverse, onReview, onAccept, onBank, onBulk, onSetup, onBook, onOpen }: {
  v: CashbookView; onReverse: (x: Exception) => void; onReview: (x: Exception) => void; onAccept: (x: Exception) => void; onBank: (x: Exception, bankId: number) => void;
  onBulk: (keys: string[], bankId: number) => void; onSetup: () => void; onBook: () => void; onOpen: (l: CashItem["link"]) => void;
}) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [bulkBank, setBulkBank] = useState("");
  const pickRow = (key: string, on: boolean) => setSel((s0) => new Set(on ? [...s0, key] : [...s0].filter((k) => k !== key)));
  const noAccounts = !v.banks.some((b) => b.active);
  const itemOf = (key: string) => v.items.find((i) => i.key === key);
  const mism = v.exceptions.filter((x) => MISMATCH.includes(x.kind));
  const others = OTHER.filter((k) => v.exceptions.some((x) => x.kind === k));
  const byInvoice = v.exceptions.filter((x) => x.kind === "no_bank").map((x) => ({ x, b: suggestedBank(itemOf(x.item_key), v.banks) })).filter((r) => r.b);
  const notBooked = mism.some((x) => x.kind === "not_booked");
  return (
    <div className={fx.stack} data-testid="finance-recon">
      <Banner tone="info">{L("Compares cash book entries with their source records and flags out-of-step records (mismatches) for your review and action. No bank statement is imported: this is not bank-statement reconciliation.", "Membandingkan catatan buku tunai dengan rekod sumbernya dan menanda rekod tidak sepadan untuk semakan dan tindakan anda. Tiada penyata bank diimport: ini bukan penyelarasan penyata bank.")}</Banner>
      {/* v1.324.0 (Global UI System R-1) - the two figures are the one KPI strip */}
      <KpiRow label={L("Reconciliation figures", "Angka penyelarasan")} testid="recon-figures">
        <KpiTile testid="recon-mismatch-count" icon="warning" tone="red" label={L("Out of Step (Mismatch)", "Tidak Sepadan")} value={mism.length}
          sub={L("Cash book entries that do not match their source record.", "Catatan buku tunai yang tidak sepadan dengan rekod sumbernya.")} />
        <KpiTile testid="recon-difference" icon="money" tone={v.totals.difference_cents === 0 ? "green" : "gold"} label={L("Total Difference", "Jumlah Perbezaan")}
          value={<span className={v.totals.difference_cents < 0 ? fx.neg : v.totals.difference_cents > 0 ? fx.pos : ""} data-testid="recon-difference-value">{fmtSigned(v.totals.difference_cents)}</span>}
          sub={L("Source − cash book, over the amount mismatches. Negative: the cash book holds more.", "Sumber − buku tunai, bagi ketidaksepadanan amaun. Negatif: buku tunai memegang lebih.")} />
      </KpiRow>
      <section className={card} aria-label={L("Out of Step Records", "Rekod Tidak Sepadan")} data-testid="recon-records">
        <CardHead icon="database" title={L(`Out of Step Records (${mism.length})`, `Rekod Tidak Sepadan (${mism.length})`)} aside={notBooked && v.can_correct ? <button type="button" className={btnSmPrimary} onClick={onBook}>{L("Book all missing", "Rekod semua yang tiada")}</button> : undefined} />
        {mism.length === 0 ? <p className={fx.empty}>{L("Nothing out of step. Every movement matches its record.", "Tiada yang tidak sepadan. Setiap pergerakan sepadan dengan rekodnya.")}</p> : (
          <ul className={fx.recList}>{mism.map((x) => <MismatchCard key={`${x.kind}|${x.key}`} x={x} v={v} onReverse={onReverse} onReview={onReview} onAccept={onAccept} onOpen={onOpen} />)}</ul>
        )}
      </section>
      <TabZone label={L("Other checks", "Semakan lain")}>
      <details className={`${card} ${fx.fold}`} data-testid="recon-other">
        <summary>{L("Other checks", "Semakan lain")} · {v.exceptions.filter((x) => OTHER.includes(x.kind)).length}</summary>
        {noAccounts && v.can_enter && (
          <div className={css.setup}>
            <p className={css.meta}>{L("Matching each movement to the account it went through needs the accounts - each belongs to one company.", "Memadankan setiap pergerakan dengan akaunnya memerlukan akaun - setiap satu milik satu syarikat.")}</p>
            <button type="button" className={btnSmPrimary} onClick={onSetup}>{L("Set up accounts", "Sediakan akaun")}</button>
          </div>
        )}
        {others.length === 0 ? <p className={fx.empty}>{L("Nothing else to check in this period.", "Tiada lagi untuk disemak dalam tempoh ini.")}</p> : others.map((k) => {
          const list = v.exceptions.filter((x) => x.kind === k);
          return (
            <div key={k} className={fx.otherGroup}>
              <p className={fx.otherHead}><strong>{L(EX[k][0], EX[k][1])}</strong> <span className={chipNeutral}>{list.length}</span></p>
              <p className={css.meta}>{L(EX[k][2], EX[k][3])}</p>
              {k === "no_bank" && v.can_correct && (
                <div className={css.bulk}>
                  {byInvoice.length > 0 && (
                    <button type="button" className={btnSmPrimary} onClick={() => { const groups = new Map<number, string[]>(); for (const r of byInvoice) groups.set(r.b!.id, [...(groups.get(r.b!.id) ?? []), r.x.item_key]); for (const [b, keys] of groups) onBulk(keys, b); }}>
                      {L(`Use the account printed on each invoice (${byInvoice.length})`, `Guna akaun yang tercetak pada setiap invois (${byInvoice.length})`)}
                    </button>
                  )}
                  <label className={css.check}><input type="checkbox" checked={list.length > 0 && list.slice(0, 100).every((x) => sel.has(x.item_key))}
                    onChange={(e) => setSel(e.target.checked ? new Set(list.slice(0, 100).map((x) => x.item_key)) : new Set())} /> {L("Select all", "Pilih semua")}</label>
                  <span className={css.assign}>
                    <select className={inputClass} aria-label={L("Account for the selected", "Akaun untuk yang dipilih")} value={bulkBank} onChange={(e) => setBulkBank(e.target.value)}>
                      <option value="">{L("Account…", "Akaun…")}</option>
                      {v.banks.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <button type="button" className={btnSm} disabled={!bulkBank || sel.size === 0} onClick={() => { onBulk([...sel], Number(bulkBank)); setSel(new Set()); }}>{L(`Assign selected (${sel.size})`, `Tetapkan yang dipilih (${sel.size})`)}</button>
                  </span>
                </div>
              )}
              <ul className={css.exList}>
                {list.slice(0, 100).map((x) => (
                  <li key={`${x.kind}|${x.key}`}>
                    <span className={css.exMain}>
                      <span className={css.exTitle}>
                        {k === "no_bank" && v.can_correct && (
                          <input type="checkbox" className={css.rowCheck} aria-label={L(`Select ${x.title}`, `Pilih ${x.title}`)} checked={sel.has(x.item_key)} onChange={(e) => pickRow(x.item_key, e.target.checked)} />
                        )}
                        {x.title}
                      </span>
                      <span className={css.meta}>{dmy(x.date)} · {x.detail}</span>
                    </span>
                    <span className={x.type === "in" ? css.amtIn : css.amtOut}>{x.type === "in" ? "+" : "−"}{fmtRM(x.amount_cents)}</span>
                    <span className={css.exActs}>
                      {x.link && <button type="button" className={btnSm} onClick={() => onOpen(x.link)}>{x.actions.includes("confirm") ? L("Open to verify", "Buka untuk sahkan") : L("Open record", "Buka rekod")}</button>}
                      {v.can_correct && x.actions.includes("bank") && (
                        <span className={css.assign}>
                          <select className={inputClass} aria-label={L("Account", "Akaun")} value={pick[x.key] ?? String(suggestedBank(itemOf(x.item_key), v.banks)?.id ?? "")} onChange={(e) => setPick((p) => ({ ...p, [x.key]: e.target.value }))}>
                            <option value="">{L("Account…", "Akaun…")}</option>
                            {v.banks.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                          <button type="button" className={btnSm} disabled={!(pick[x.key] ?? suggestedBank(itemOf(x.item_key), v.banks)?.id)} onClick={() => onBank(x, Number(pick[x.key] ?? suggestedBank(itemOf(x.item_key), v.banks)?.id))}>{L("Assign", "Tetapkan")}</button>
                        </span>
                      )}
                      {v.can_correct && x.actions.includes("reverse") && x.row_id && <button type="button" className={btnSm} onClick={() => onReverse(x)}>{L("Reverse…", "Balikkan…")}</button>}
                      {v.can_correct && x.actions.includes("review") && <button type="button" className={btnSm} onClick={() => onReview(x)}>{L("Mark reviewed…", "Tanda disemak…")}</button>}
                    </span>
                  </li>
                ))}
              </ul>
              {list.length > 100 && <p className={css.meta}>{L(`And ${list.length - 100} more - narrow the period.`, `Dan ${list.length - 100} lagi - kecilkan tempoh.`)}</p>}
            </div>
          );
        })}
      </details>
      </TabZone>
    </div>
  );
}

/* ================================================================== *
 * 05 Reports (reference 05).
 * ================================================================== */

type ReportKind = "monthly" | "in_category" | "out_category" | "accounts" | "sources" | "detail";
const REPORTS: [ReportKind, string, string][] = [
  ["monthly", "Monthly Cash Flow", "Aliran Tunai Bulanan"], ["in_category", "Money In by Category", "Tunai Masuk ikut Kategori"], ["out_category", "Money Out by Category", "Tunai Keluar ikut Kategori"],
  ["accounts", "Account Summary", "Ringkasan Akaun"], ["sources", "Source Summary", "Ringkasan Sumber"], ["detail", "Detailed Transaction Export", "Eksport Transaksi Terperinci"],
];

function Reports({ v, period, periodPick }: { v: CashbookView | null; period: { from: string; to: string }; periodPick: ReactNode }) {
  const [kind, setKind] = useState<ReportKind>("monthly");
  const [acc, setAcc] = useState("");
  if (!v) return <div className={fx.stack} data-testid="finance-reports"><SkelRows rows={6} /></div>;
  /* the account filter narrows the movements (category, source, detail) - never an account's balance */
  const items = v.items.filter((i) => !acc || (acc === "none" ? !i.bank_id : String(i.bank_id ?? "") === acc));
  const counted = items.filter((i) => i.counts);
  const sumBy = (dir: "in" | "out") => {
    const m = new Map<string, number>();
    for (const i of counted) if (i.counts === dir) m.set(i.group, (m.get(i.group) ?? 0) + i.sign * i.amount_cents);
    return m;
  };
  const inG = sumBy("in"), outG = sumBy("out");
  const inT = [...inG.values()].reduce((a, c) => a + c, 0), outT = [...outG.values()].reduce((a, c) => a + c, 0);
  const cats = [...new Set([...inG.keys(), ...outG.keys()])].map((g) => ({ g, in: inG.get(g) ?? 0, out: outG.get(g) ?? 0 })).sort((a, b) => (b.in + b.out) - (a.in + a.out));
  /* a reversal counts against the source it reverses (its sign), as in the totals */
  const srcOf = (i: CashItem): Source => (i.source === "reversal" ? "reversal" : i.source);
  const sources = (Object.keys(SOURCE) as Source[]).map((s) => {
    const list = counted.filter((i) => srcOf(i) === s);
    return { s, n: list.length, in: list.filter((i) => i.counts === "in").reduce((a, i) => a + i.sign * i.amount_cents, 0), out: list.filter((i) => i.counts === "out").reduce((a, i) => a + i.sign * i.amount_cents, 0) };
  }).filter((r) => r.n > 0);
  const banks = v.banks.filter((b) => b.active);
  const unassigned = counted.filter((i) => !i.bank_id);
  const months = [...v.trend].reverse();
  const coWord = v.consolidated ? "consolidated" : v.company;
  const stamp = `${coWord}-${period.from}-to-${period.to}${acc ? `-acct-${acc}` : ""}`;
  const exportReport = () => {
    if (kind === "monthly") downloadCsv(`a2z-cash-flow-${coWord}-${v.period.to.slice(0, 7)}`, [["Company", "Month", "Money In (RM)", "Money Out (RM)", "Net (RM)"], ...months.map((m) => [coWord, m.month, (m.in_cents / 100).toFixed(2), (m.out_cents / 100).toFixed(2), ((m.in_cents - m.out_cents) / 100).toFixed(2)])]);
    else if (kind === "in_category" || kind === "out_category") {
      const g = kind === "in_category" ? inG : outG, t = kind === "in_category" ? inT : outT;
      downloadCsv(`a2z-${kind === "in_category" ? "money-in" : "money-out"}-by-category-${stamp}`, [["Company", "Category", "Amount (RM)", "% of total"], ...[...g.entries()].map(([k, c]) => [coWord, groupWord(k), (c / 100).toFixed(2), pct(c, t)]), [coWord, "Total", (t / 100).toFixed(2), t ? "100.0%" : ""]]);
    } else if (kind === "accounts") downloadCsv(`a2z-account-summary-${coWord}-${v.period.today}`, [["Company", "Account", "Book balance (RM, not bank-verified)"], ...banks.map((b) => [companyWord(b.company), b.name, b.book_balance_cents != null ? (b.book_balance_cents / 100).toFixed(2) : "No opening balance"])]);
    else if (kind === "sources") downloadCsv(`a2z-source-summary-${stamp}`, [["Company", "Source", "Count", "Money In (RM)", "Money Out (RM)"], ...sources.map((r) => [coWord, sourceWord(r.s), String(r.n), (r.in / 100).toFixed(2), (r.out / 100).toFixed(2)])]);
    else downloadCsv(`a2z-transactions-${stamp}`, [["Company", "Date", "Booked on", "Description", "Category", "Direction", "Amount (RM)", "Account", "Source", "Reference", "Payment ref", "Status", "Counted"],
      ...items.map((i) => [companyWord(i.company), i.date, i.booked_on ?? "", i.description, groupWord(i.group), i.type === "in" ? "In" : "Out", (i.amount_cents / 100).toFixed(2), i.bank_name ?? "", sourceWord(i.source), i.ref, i.payment_ref ?? "", STATUS[i.status][0], i.counts ? "Yes" : "No"])]);
  };
  const catTable = (dir: "in" | "out" | "both") => (
    <div className={fx.tWrap}>
      <table className={fx.t}>
        <thead><tr><th>{L("Category", "Kategori")}</th>{dir !== "out" && <th className={fx.r}>{L("Money In", "Tunai Masuk")}</th>}{dir !== "in" && <th className={fx.r}>{L("Money Out", "Tunai Keluar")}</th>}<th className={fx.r}>{dir === "in" ? L("% of In", "% Masuk") : L("% of Out", "% Keluar")}</th></tr></thead>
        <tbody>{cats.filter((c) => (dir === "in" ? c.in : dir === "out" ? c.out : true)).map((c) => (
          <tr key={c.g}><td>{groupWord(c.g)}</td>{dir !== "out" && <td className={`${fx.r} ${fx.num}`}>{fmtSigned(c.in)}</td>}{dir !== "in" && <td className={`${fx.r} ${fx.num}`}>{fmtSigned(c.out)}</td>}<td className={`${fx.r} ${fx.num}`}>{dir === "in" ? pct(c.in, inT) : pct(c.out, outT)}</td></tr>
        ))}</tbody>
        <tfoot><tr className={fx.totalRow}><td>{L("Total", "Jumlah")}</td>{dir !== "out" && <td className={`${fx.r} ${fx.num}`}>{fmtSigned(inT)}</td>}{dir !== "in" && <td className={`${fx.r} ${fx.num}`}>{fmtSigned(outT)}</td>}<td className={`${fx.r} ${fx.num}`}>{(dir === "in" ? inT : outT) ? "100.0%" : "—"}</td></tr></tfoot>
      </table>
    </div>
  );
  const accountTable = (
    <div className={fx.tWrap}>
      <table className={fx.t}>
        <thead><tr><th>{L("Account", "Akaun")}</th><th className={fx.r}>{L("Balance (RM)", "Baki (RM)")}</th></tr></thead>
        <tbody>
          {banks.map((b) => <tr key={b.id}><td>{b.name}{v.consolidated && <small className={fx.muted}> · {companyWord(b.company)}</small>}</td><td className={`${fx.r} ${fx.num}`}>{b.book_balance_cents != null ? fmtSigned(b.book_balance_cents) : <span className={fx.muted}>{L("No opening balance", "Tiada baki pembukaan")}</span>}</td></tr>)}
          <tr><td>{L("Not assigned", "Belum ditetapkan")}</td><td className={`${fx.r} ${fx.muted}`}>{L(`${unassigned.length} movement(s)`, `${unassigned.length} pergerakan`)}</td></tr>
        </tbody>
        {!v.consolidated && banks.some((b) => b.book_balance_cents != null) && (
          <tfoot><tr className={fx.totalRow}><td>{L("Total book balance", "Jumlah baki buku")}</td><td className={`${fx.r} ${fx.num}`}>{fmtSigned(banks.reduce((a, b) => a + (b.book_balance_cents ?? 0), 0))}</td></tr></tfoot>
        )}
      </table>
      <p className={fx.note}>{L("Book balances from an opening balance a person entered - not bank-verified. Never summed across the two companies.", "Baki buku dari baki pembukaan yang dimasukkan - tidak disahkan bank. Tidak dijumlahkan merentas dua syarikat.")}</p>
    </div>
  );
  const sourceTable = (
    <div className={fx.tWrap}>
      <table className={fx.t}>
        <thead><tr><th>{L("Source", "Sumber")}</th><th className={fx.r}>#</th><th className={fx.r}>{L("Money In", "Tunai Masuk")}</th><th className={fx.r}>{L("Money Out", "Tunai Keluar")}</th></tr></thead>
        <tbody>{sources.map((r) => <tr key={r.s}><td>{sourceWord(r.s)}</td><td className={`${fx.r} ${fx.num}`}>{r.n}</td><td className={`${fx.r} ${fx.num}`}>{fmtSigned(r.in)}</td><td className={`${fx.r} ${fx.num}`}>{fmtSigned(r.out)}</td></tr>)}</tbody>
        <tfoot><tr className={fx.totalRow}><td>{L("Total", "Jumlah")}</td><td className={`${fx.r} ${fx.num}`}>{sources.reduce((a, r) => a + r.n, 0)}</td><td className={`${fx.r} ${fx.num}`}>{fmtSigned(sources.reduce((a, r) => a + r.in, 0))}</td><td className={`${fx.r} ${fx.num}`}>{fmtSigned(sources.reduce((a, r) => a + r.out, 0))}</td></tr></tfoot>
      </table>
    </div>
  );
  const rk = REPORTS.find((r) => r[0] === kind)!;
  return (
    <div className={fx.stack} data-testid="finance-reports">
      <section className={`${card} ${fx.reportBar}`} aria-label={L("Report", "Laporan")}>
        <label className={fx.reportPick}><span>{L("Report", "Laporan")}</span>
          <select className={selectClassSm} value={kind} onChange={(e) => setKind(e.target.value as ReportKind)} data-testid="report-select">{REPORTS.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
        <label className={fx.reportPick}><span>{L("Period", "Tempoh")}</span>{periodPick}</label>
        <label className={fx.reportPick}><span>{L("Account", "Akaun")}</span>
          <select className={selectClassSm} value={acc} onChange={(e) => setAcc(e.target.value)} data-testid="report-account"><option value="">{L("All accounts", "Semua akaun")}</option><option value="none">{L("Not assigned", "Belum ditetapkan")}</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <button type="button" className={`${btnSmPrimary} ${fx.reportExport}`} onClick={exportReport} data-testid="report-export"><AppIcon name="download" />{L("Export", "Eksport")}</button>
      </section>
      <KpiRow label={L("Cash in the period", "Tunai dalam tempoh")}>
        <KpiTile icon="up" tone="green" label={L("Money In", "Tunai Masuk")} value={fmtRM(acc ? inT : v.totals.in_cents)} />
        <KpiTile icon="down" tone="red" label={L("Money Out", "Tunai Keluar")} value={fmtRM(acc ? outT : v.totals.out_cents)} />
        <KpiTile icon="balance" tone="blue" label={L("Net Cash Movement", "Pergerakan Tunai Bersih")} value={fmtSigned(acc ? inT - outT : v.totals.net_cents)} />
      </KpiRow>
      <section className={card} aria-label={L(rk[1], rk[2])} data-testid="report-main">
        <CardHead icon="chart" title={kind === "monthly" ? L(`Monthly Cash Flow Summary (${monthWord(v.period.to.slice(0, 7))})`, `Ringkasan Aliran Tunai Bulanan (${monthWord(v.period.to.slice(0, 7))})`) : L(rk[1], rk[2])}
          sub={kind === "monthly" ? L("Money in, money out and net cash movement by month (Malaysia time).", "Tunai masuk, tunai keluar dan pergerakan tunai bersih ikut bulan (waktu Malaysia).") : periodWord(period.from, period.to)} />
        {kind === "monthly" && (
          <ul className={`${fx.monthList} ${fx.phoneOnly}`} data-testid="report-months-phone">{months.map((m) => {
            const net = m.in_cents - m.out_cents;
            return <li key={m.month}><span className={fx.cardTop}><strong>{monthWord(m.month)}</strong><span className={net > 0 ? fx.goodPill : net < 0 ? fx.badPill : fx.zeroPill}>{fmtSigned(net)}</span></span><span className={fx.muted}>{L("In", "Masuk")} {fmtRM(m.in_cents)} · {L("Out", "Keluar")} {fmtRM(m.out_cents)}</span></li>;
          })}</ul>
        )}
        {kind === "monthly" && (
          <FillPanel testid="report-months-fill" className={`${fx.tWrap} ${fx.deskOnly} ${fx.pinHead}`}>
            <table className={fx.t}>
              <thead><tr><th>{L("Month", "Bulan")}</th><th className={fx.r}>{L("Money In", "Tunai Masuk")}</th><th className={fx.r}>{L("Money Out", "Tunai Keluar")}</th><th className={fx.r}>{L("Net Cash Movement", "Pergerakan Tunai Bersih")}</th></tr></thead>
              <tbody>{months.map((m) => {
                const net = m.in_cents - m.out_cents;
                return <tr key={m.month}><td>{monthWord(m.month)}</td><td className={`${fx.r} ${fx.num}`}>{fmtRM(m.in_cents)}</td><td className={`${fx.r} ${fx.num}`}>{fmtRM(m.out_cents)}</td><td className={fx.r}><span className={net > 0 ? fx.goodPill : net < 0 ? fx.badPill : fx.zeroPill}>{fmtSigned(net)}</span></td></tr>;
              })}</tbody>
            </table>
          </FillPanel>
        )}
        {kind === "in_category" && catTable("in")}
        {kind === "out_category" && catTable("out")}
        {kind === "accounts" && accountTable}
        {kind === "sources" && sourceTable}
        {kind === "detail" && (
          <>
            <p className={fx.note}>{L(`${items.length} movement(s) in the period${acc ? " for this account" : ""}. Export gives every column, with the company and whether each is counted.`, `${items.length} pergerakan dalam tempoh${acc ? " untuk akaun ini" : ""}. Eksport memberi setiap lajur, dengan syarikat dan sama ada setiap satu dikira.`)}</p>
            <div className={fx.tWrap}>
              <table className={fx.t}>
                <thead><tr><th>{L("Date", "Tarikh")}</th><th>{L("Description", "Keterangan")}</th><th>{L("Source", "Sumber")}</th><th className={fx.r}>{L("Amount", "Amaun")}</th></tr></thead>
                <tbody>{items.slice(0, 10).map((i) => <tr key={i.key}><td className={fx.num}>{dmy(i.date)}</td><td>{i.description || groupWord(i.group)}</td><td>{sourceWord(i.source)}</td><td className={`${fx.r} ${fx.num}`}>{i.type === "in" ? "" : "−"}{fmtRM(i.amount_cents)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <TabZone label={L("Summaries", "Ringkasan")}>
      <div className={fx.split3}>
        <section className={card} aria-label={L("Money In / Money Out by Category", "Tunai Masuk / Keluar ikut Kategori")} data-testid="report-category">
          <CardHead icon="chart" title={L("Money In / Money Out by Category", "Tunai Masuk / Tunai Keluar ikut Kategori")} sub={periodWord(period.from, period.to)} />
          {cats.length === 0 ? <p className={fx.empty}>{L("Nothing in this period.", "Tiada dalam tempoh ini.")}</p> : catTable("both")}
        </section>
        <section className={card} aria-label={L("Account Summary", "Ringkasan Akaun")} data-testid="report-accounts">
          <CardHead icon="pay" title={L("Account Summary", "Ringkasan Akaun")} sub={L(`As at ${dmy(v.period.today)}`, `Pada ${dmy(v.period.today)}`)} />
          {accountTable}
        </section>
        <section className={card} aria-label={L("Source Summary", "Ringkasan Sumber")} data-testid="report-sources">
          <CardHead icon="database" title={L("Source Summary", "Ringkasan Sumber")} sub={periodWord(period.from, period.to)} />
          {sources.length === 0 ? <p className={fx.empty}>{L("Nothing in this period.", "Tiada dalam tempoh ini.")}</p> : sourceTable}
        </section>
      </div>
      </TabZone>
      <p className={fx.note}>{L("Cash basis: by the day money moved; receipts awaiting the CEO's verification and scheduled expenses are not counted. Each export is the report on screen - the same company, period and account. The profit and loss (accrual) is in Accounting.", "Asas tunai: ikut hari wang bergerak; penerimaan menunggu pengesahan CEO dan perbelanjaan berjadual tidak dikira. Setiap eksport ialah laporan di skrin - syarikat, tempoh dan akaun yang sama. Untung rugi (akruan) di Perakaunan.")}</p>
    </div>
  );
}

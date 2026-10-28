"use client";

/* v1.219.0 - FINANCE & CASH FLOW 2.0 (the owner's brief and answers,
 * 28-10-2026; the audit is claude/FINANCE-AUDIT.md). The Finance tab is one
 * page with five tabs - Overview, Transactions, Expenses, Reconciliation,
 * Reports ("Own Expenses tab") - all drawn from ONE read of the server's
 * cash book view (GET /staff/erp/cashbook, worker/src/cashbook.ts):
 *
 *   - money in follows the Sales rule ("Same as Sales"): part payments on the
 *     day they landed, the rest of a paid invoice on its paid day;
 *   - every movement sits on the day its money moved ("Show true dates, flag
 *     issues"), and what is out of step is listed under Reconciliation;
 *   - a period's in minus out is "Net cash movement", never a balance; an
 *     account shows a book balance only from an opening balance a person
 *     entered;
 *   - nothing is added up here: every figure is the server's.
 *
 * It replaces the v1.18.0 Cash Flow panel, which lived in this file: its
 * entry form, banks list, filters and CSV are all still here (the form in a
 * drawer). Retired v1.172.0 Reconciliation (marketplace estimates) stays
 * retired; the new Reconciliation tab checks the portal's own records only.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { DataTable } from "@/components/ui/data-table";
import { SideDrawer } from "@/components/ui/side-drawer";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel } from "@/components/ui/skeleton";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { usePortal } from "@/components/portal/portal-provider";
import { makeApi } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { fmtRM, mytToday } from "@/lib/format";
import { resolveIssuer } from "@/lib/issuers"; // v1.220.2 - the account printed on each invoice
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, btnSmPrimary, card, chipDanger, chipGold, chipInfo, chipNeutral, chipSuccess, chipWarn, fieldLabel, inputClass } from "@/lib/ui-styles";
import css from "./finance.module.css";

const api = makeApi("/staff/erp");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* ------------------------------------------------------------------ *
 * The server's view (worker/src/cashbook.ts).
 * ------------------------------------------------------------------ */

type Source = "sales" | "part" | "elfia" | "live" | "claims" | "advance" | "payroll" | "expenses" | "manual" | "transfer" | "reversal";
type Status = "verified" | "unverified" | "recorded" | "manual" | "transfer" | "reversed" | "reversal";
interface CashItem {
  key: string; row_id: number | null; date: string; booked_on: string | null; type: "in" | "out"; amount_cents: number;
  category: string; group: string; source: Source; status: Status; description: string; ref: string;
  link: { kind: "invoice" | "claim" | "payroll" | "expense" | "elfia"; id: number | string } | null;
  bank_id: number | null; bank_name: string | null; counts: "in" | "out" | null; sign: 1 | -1;
  reversal_of: number | null; reversed_by: number | null; reverse_reason: string | null; transfer_id: string | null; payment_ref: string | null;
  issuer?: string | null;
}
interface Bank { id: number; name: string; bank: string; number_masked: string; active: number; opening_balance_cents: number | null; opening_on: string | null; book_balance_cents: number | null }
type ExKind = "unverified" | "no_bank" | "no_reference" | "out_of_step" | "duplicate" | "elfia_cancelled" | "not_booked";
interface Exception {
  kind: ExKind; key: string; item_key: string; date: string; title: string; detail: string; amount_cents: number; type: "in" | "out";
  row_id: number | null; link: CashItem["link"]; actions: ("bank" | "reverse" | "review" | "book" | "confirm")[];
}
interface CashbookView {
  period: { from: string; to: string; today: string };
  totals: { in_cents: number; out_cents: number; net_cents: number; count: number };
  groups: { in: { group: string; cents: number }[]; out: { group: string; cents: number }[] };
  trend: { month: string; in_cents: number; out_cents: number }[];
  items: CashItem[];
  banks: Bank[];
  exceptions: Exception[];
  can_correct: boolean;
  can_enter: boolean;
  pending_migration: boolean;
}

/* ------------------------------------------------------------------ *
 * Words.
 * ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthWord = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
const dmy = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "—");
/** a figure in the axis: RM 12k, RM 1.2M */
const rmShort = (c: number) => {
  const rm = Math.abs(c) / 100;
  const s = rm >= 1_000_000 ? `${(rm / 1_000_000).toFixed(1)}M` : rm >= 1000 ? `${Math.round(rm / 1000)}k` : `${Math.round(rm)}`;
  return `${c < 0 ? "-" : ""}RM ${s}`;
};

const GROUP: Record<string, [string, string]> = {
  sales: ["Sales invoices", "Invois jualan"],
  elfia: ["ELFIA web orders", "Pesanan web ELFIA"],
  live: ["Live sales", "Jualan live"],
  payroll: ["Payroll", "Gaji"],
  claims: ["Staff claims", "Tuntutan kakitangan"],
  advances: ["Salary advances", "Pendahuluan gaji"],
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
  manual: ["Manual", "Manual"], transfer: ["Transfer", "Pindahan"], reversal: ["Reversal", "Pembalikan"],
};
const sourceWord = (s: Source) => L(SOURCE[s][0], SOURCE[s][1]);

const STATUS: Record<Status, [string, string, string]> = {
  verified: ["Verified", "Disahkan", chipSuccess],
  unverified: ["Unverified", "Belum disahkan", chipWarn],
  recorded: ["Recorded", "Direkod", chipInfo],
  manual: ["Manual", "Manual", chipGold],
  transfer: ["Transfer", "Pindahan", chipNeutral],
  reversed: ["Reversed", "Dibalikkan", chipNeutral],
  reversal: ["Reversal", "Pembalikan", chipNeutral],
};
const StatusChip = ({ s }: { s: Status }) => <span className={STATUS[s][2]}>{L(STATUS[s][0], STATUS[s][1])}</span>;

/* v1.220.2 - THE ACCOUNTS THE COMPANY ALREADY PRINTS (the owner, 28-10-2026:
   "no account appear on the drop box ... check the flow"). Every invoice's
   letterhead names the account the customer pays into (lib/issuers.ts, the
   CEO-supplied numbers). Finance starts from those two instead of an empty
   list: one button adds them (masked, no balance), and an invoice receipt is
   OFFERED the account its own invoice printed - still assigned by a person,
   because a customer can pay elsewhere. */
const last4 = (t: string) => t.replace(/\D/g, "").slice(-4);
const INVOICE_ACCOUNTS = ["a2z", "azoo"].map((code) => {
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
  unverified: ["Unverified receipts", "Penerimaan belum disahkan", "Recorded as received, not yet confirmed by the CEO or COO. Confirm it on the invoice in Sales.", "Direkod sebagai diterima, belum disahkan oleh CEO atau COO. Sahkan pada invois di Jualan."],
  no_bank: ["No account", "Tiada akaun", "Which of the company's accounts did this money move through? Assign it from the bank statement.", "Melalui akaun syarikat yang mana wang ini bergerak? Tetapkan daripada penyata bank."],
  no_reference: ["No payment reference", "Tiada rujukan bayaran", "A receipt with nothing to find it by on the statement.", "Penerimaan tanpa rujukan untuk dicari pada penyata."],
  out_of_step: ["Out of step with its record", "Tidak sepadan dengan rekodnya", "The cash book and the record it came from disagree. Reverse it, or note why it stands.", "Buku tunai dan rekod asalnya tidak sepadan. Balikkan, atau catat sebab ia kekal."],
  duplicate: ["Possible duplicates", "Kemungkinan pendua", "A typed movement on the same day, in the same direction and for the same amount as one the system booked.", "Pergerakan yang ditaip pada hari, arah dan amaun yang sama dengan yang direkod sistem."],
  elfia_cancelled: ["ELFIA cancelled after payment", "ELFIA dibatalkan selepas bayaran", "The money stays in until the refund is decided.", "Wang kekal masuk sehingga bayaran balik diputuskan."],
  not_booked: ["Paid but not in the cash book", "Dibayar tetapi tiada dalam buku tunai", "Marked paid in its module, with no cash movement. Book them, dated the day they were paid.", "Ditanda dibayar dalam modulnya, tanpa pergerakan tunai. Rekodkan, bertarikh hari ia dibayar."],
};
const EX_ORDER: ExKind[] = ["out_of_step", "not_booked", "duplicate", "elfia_cancelled", "unverified", "no_bank", "no_reference"];

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

type View = "overview" | "transactions" | "expenses" | "reconciliation" | "reports";

/* ================================================================== *
 * The page.
 * ================================================================== */

export function FinancePage({ expenses }: { expenses: ReactNode }) {
  const { canOpen, openRecord, setTab } = usePortal();
  const today = mytToday();
  const [view, setView] = useState<View>("overview");
  const [preset, setPreset] = useState<Preset>("this_month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const period = useMemo(() => periodOf(preset, today, custom), [preset, today, custom]);
  const [data, setData] = useState<CashbookView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);
  const [open, setOpen] = useState<CashItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [accounts, setAccounts] = useState(false);
  const [exFilter, setExFilter] = useState<ExKind | "">("");
  const { show: toast, node: toastNode } = useSaveToast();
  const { prompt, node: promptNode } = usePrompt();

  useEffect(() => {
    let live = true;
    void api<CashbookView & { error?: { code?: string; message?: string } }>(`/cashbook?from=${period.from}&to=${period.to}&months=12`).then((r) => {
      if (!live) return;
      if (r.ok && r.data?.period) { setData(r.data); setFailed(null); return; }
      /* v1.220.1 - say WHY (the live tab once answered only "could not be
         read"): no access, a worker older than the site, or the server's own
         sentence with its code and the HTTP status */
      const why = r.status === 403 ? L("Your role has no access to Finance.", "Peranan anda tiada akses Kewangan.")
        : r.status === 404 ? L("The API worker is older than this page - run PUSH.bat again so the worker deploys, then reload.", "Worker API lebih lama daripada halaman ini - jalankan PUSH.bat semula supaya worker dilancarkan, kemudian muat semula.")
        : r.data?.error?.message ? `${r.data.error.message} (HTTP ${r.status}${r.data.error.code ? `, ${r.data.error.code}` : ""})`
        : L(`Finance could not be read (HTTP ${r.status || "no connection"}). Try again.`, `Kewangan tidak dapat dibaca (HTTP ${r.status || "tiada sambungan"}). Cuba lagi.`);
      setFailed(why);
    });
    return () => { live = false; };
  }, [period.from, period.to, tick]);

  const view_ = data?.period && data.period.from === period.from && data.period.to === period.to ? data : null;
  const busy = !view_;

  /* the record behind an item, opened where it lives */
  const openSource = (link: CashItem["link"]) => {
    if (!link) return;
    if (link.kind === "invoice" && canOpen("Sales")) openRecord("Sales", "document", Number(link.id));
    else if (link.kind === "claim" && canOpen("Claims")) openRecord("Claims", "claim", Number(link.id));
    else if (link.kind === "payroll" && canOpen("Payroll")) setTab("Payroll");
    else if (link.kind === "expense") setView("expenses");
  };

  /* ---- corrections (the server decides who; the screen only offers) ---- */
  const reverse = async (rowId: number, label: string) => {
    const r0 = await prompt({ title: L("Reverse this movement?", "Balikkan pergerakan ini?"), message: L(`${label}. A movement the other way is added, with your reason; the original stays in the book.`, `${label}. Pergerakan arah bertentangan ditambah, dengan sebab anda; yang asal kekal dalam buku.`), label: L("Reason", "Sebab"), required: true, confirmLabel: L("Reverse", "Balikkan"), variant: "danger" });
    if (!r0) return;
    const r = await api<{ error?: { message?: string } }>(`/cashbook/rows/${rowId}/reverse`, { method: "POST", body: JSON.stringify({ reason: r0.value }) });
    if (r.ok) { toast(L("Reversed", "Dibalikkan"), L("The reversal is in the book, with your reason", "Pembalikan ada dalam buku, dengan sebab anda")); setOpen(null); reload(); }
    else toast(L("Not reversed", "Tidak dibalikkan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const review = async (x: Exception) => {
    const r0 = await prompt({ title: L("Mark as reviewed", "Tanda sudah disemak"), message: x.title, label: L("What did you check?", "Apa yang anda semak?"), required: true, confirmLabel: L("Mark reviewed", "Tanda disemak") });
    if (!r0) return;
    const r = await api<{ error?: { message?: string } }>(`/cashbook/review`, { method: "POST", body: JSON.stringify({ key: `${x.kind}|${x.key}`, note: r0.value }) });
    if (r.ok) { toast(L("Reviewed", "Disemak"), L("It leaves the list; the note is kept", "Ia keluar dari senarai; catatan disimpan")); reload(); }
    else toast(L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const assignBank = async (itemKey: string, bankId: number) => {
    const r = await api<{ error?: { message?: string } }>(`/cashbook/assign-bank`, { method: "POST", body: JSON.stringify({ item_key: itemKey, bank_id: bankId }) });
    if (r.ok) { toast(L("Account assigned", "Akaun ditetapkan"), L("Recorded with your name", "Direkod dengan nama anda")); setOpen(null); reload(); }
    else toast(L("Not assigned", "Tidak ditetapkan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const assignMany = async (keys: string[], bankId: number) => {
    const r = await api<{ assigned?: number; skipped?: number; error?: { message?: string } }>(`/cashbook/assign-bank`, { method: "POST", body: JSON.stringify({ item_keys: keys, bank_id: bankId }) });
    if (r.ok) { toast(L("Accounts assigned", "Akaun ditetapkan"), L(`${r.data?.assigned ?? 0} movement(s), recorded with your name`, `${r.data?.assigned ?? 0} pergerakan, direkod dengan nama anda`)); reload(); }
    else toast(L("Not assigned", "Tidak ditetapkan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const bookMissing = async () => {
    const r = await api<{ created?: number; error?: { message?: string } }>(`/cashflow/backfill`, { method: "POST", body: JSON.stringify({}) });
    if (r.ok) { toast(L("Booked", "Direkod"), L(`${r.data?.created ?? 0} movement(s), dated the day each was paid`, `${r.data?.created ?? 0} pergerakan, bertarikh hari setiap satu dibayar`)); reload(); }
    else toast(L("Not booked", "Tidak direkod"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };

  const tabs: [View, string][] = [
    ["overview", L("Overview", "Gambaran")],
    ["transactions", L("Transactions", "Transaksi")],
    ["expenses", L("Expenses", "Perbelanjaan")],
    ["reconciliation", L("Reconciliation", "Penyelarasan")],
    ["reports", L("Reports", "Laporan")],
  ];
  const attention = view_?.exceptions.length ?? 0;

  return (
    <TabPage className={css.page}>
      {toastNode}{promptNode}
      <LineTabs value={view} onChange={setView} tabs={tabs} label={L("Finance", "Kewangan")}
        aside={
          <TabAside>
            {view !== "expenses" && (
              <span className={css.periodPick}>
                <AppIcon name="date" />
                <select aria-label={L("Period", "Tempoh")} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
                  <option value="this_month">{L("This month", "Bulan ini")} ({monthWord(today.slice(0, 7))})</option>
                  <option value="last_month">{L("Last month", "Bulan lepas")}</option>
                  <option value="this_quarter">{L("This quarter", "Suku ini")}</option>
                  <option value="this_year">{L("This year", "Tahun ini")}</option>
                  <option value="custom">{L("Custom…", "Pilih sendiri…")}</option>
                </select>
              </span>
            )}
            {view_?.can_enter && view !== "expenses" && <TabAction icon="add" onClick={() => setAdding(true)}>{L("Add transaction", "Tambah transaksi")}</TabAction>}
          </TabAside>
        } />
      {preset === "custom" && view !== "expenses" && (
        <div className={css.customRow}>
          <label><span className={fieldLabel}>{L("From", "Dari")}</span><input type="date" className={inputClass} value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
          <label><span className={fieldLabel}>{L("To", "Hingga")}</span><input type="date" className={inputClass} value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
        </div>
      )}
      {view !== "expenses" && (
        <p className={css.periodLine}>
          {L("Showing", "Menunjukkan")} <strong>{periodWord(period.from, period.to)}</strong> · {L("Malaysia time, by the day the money moved. Cash basis - not profit and loss.", "Waktu Malaysia, ikut hari wang bergerak. Asas tunai - bukan untung rugi.")}
        </p>
      )}
      {view_?.pending_migration && <p className={css.warn}>{L("Migration 0147 is not applied yet - run PUSH.bat. Figures show; reversals, transfers and opening balances wait for it.", "Migrasi 0147 belum digunakan - jalankan PUSH.bat. Angka dipaparkan; pembalikan, pindahan dan baki pembukaan menunggunya.")}</p>}
      {failed && !view_ && <p className={css.warn}>{failed} <button type="button" className={btnSm} onClick={reload}>{L("Retry", "Cuba lagi")}</button></p>}

      {/* ================= OVERVIEW ================= */}
      <div hidden={view !== "overview"} className={css.body}>
        <KpiRow label={L("Cash in the period", "Tunai dalam tempoh")}>
          <KpiTile icon="down" tone="green" label={L("Money in", "Tunai masuk")} value={view_ ? fmtRM(view_.totals.in_cents) : ""} busy={busy} sub={L("Actual receipts", "Penerimaan sebenar")} />
          <KpiTile icon="up" tone="red" label={L("Money out", "Tunai keluar")} value={view_ ? fmtRM(view_.totals.out_cents) : ""} busy={busy} sub={L("Actual payments", "Pembayaran sebenar")} />
          <KpiTile icon="balance" tone="navy" label={L("Net cash movement", "Pergerakan tunai bersih")} value={view_ ? fmtRM(view_.totals.net_cents) : ""} busy={busy} sub={L("In less out, this period - not a bank balance", "Masuk tolak keluar, tempoh ini - bukan baki bank")} />
          <KpiTile icon="warning" tone="gold" label={L("Needs attention", "Perlu perhatian")} value={view_ ? attention : ""} busy={busy}
            sub={view_ ? L(`${view_.totals.count} transactions in the period`, `${view_.totals.count} transaksi dalam tempoh`) : undefined}
            onClick={() => { setExFilter(""); setView("reconciliation"); }} title={L("Open Reconciliation", "Buka Penyelarasan")} />
        </KpiRow>

        <div className={css.two}>
          <section className={card} aria-label={L("Cash flow trend", "Trend aliran tunai")}>
            <div className={css.head}><PanelTitle icon="chart">{L("Cash flow trend", "Trend aliran tunai")}</PanelTitle><span className={css.meta}>{L("Last 6 months", "6 bulan terakhir")}</span></div>
            {busy ? <Skel className={css.chartSkel} /> : <TrendChart months={view_!.trend.slice(-6)} />}
          </section>
          <section className={card} aria-label={L("Money out by category", "Tunai keluar ikut kategori")}>
            <div className={css.head}><PanelTitle icon="money">{L("Money out by category", "Tunai keluar ikut kategori")}</PanelTitle>{view_ && <strong className={css.big}>{fmtRM(view_.totals.out_cents)}</strong>}</div>
            {busy ? <Skel className={css.chartSkel} /> : <GroupBars groups={view_!.groups.out} total={view_!.totals.out_cents} empty={L("Nothing paid out in this period.", "Tiada pembayaran dalam tempoh ini.")} />}
          </section>
        </div>

        <div className={css.two}>
          <section className={card} aria-label={L("Accounts", "Akaun")}>
            <div className={css.head}>
              <PanelTitle icon="pay">{L("Accounts", "Akaun")}</PanelTitle>
              {view_?.can_enter && <button type="button" className={btnSm} onClick={() => setAccounts(true)}>{L("Manage accounts", "Urus akaun")}</button>}
            </div>
            {busy ? <Skel className={css.listSkel} /> : <AccountList banks={view_!.banks} onSetup={view_!.can_enter ? () => setAccounts(true) : undefined} />}
          </section>
          <section className={card} aria-label={L("Needs attention", "Perlu perhatian")}>
            <div className={css.head}><PanelTitle icon="warning">{L("Needs attention", "Perlu perhatian")}</PanelTitle></div>
            {busy ? <Skel className={css.listSkel} /> : attention === 0 ? <p className={css.empty}>{L("Nothing out of step in this period.", "Tiada yang tidak sepadan dalam tempoh ini.")}</p> : (
              <ul className={css.attn}>
                {EX_ORDER.filter((k) => view_!.exceptions.some((x) => x.kind === k)).map((k) => (
                  <li key={k}>
                    <button type="button" onClick={() => { setExFilter(k); setView("reconciliation"); }}>
                      <span>{L(EX[k][0], EX[k][1])}</span>
                      <strong>{view_!.exceptions.filter((x) => x.kind === k).length}</strong>
                      <AppIcon name="next" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className={card} aria-label={L("Recent transactions", "Transaksi terkini")}>
          <div className={css.head}>
            <PanelTitle icon="receipt">{L("Recent transactions", "Transaksi terkini")}</PanelTitle>
            <button type="button" className={css.linkBtn} onClick={() => setView("transactions")}>{L("View all", "Lihat semua")} →</button>
          </div>
          {busy ? <Skel className={css.listSkel} /> : <ItemCards items={view_!.items.slice(0, 5)} onOpen={setOpen} empty={L("No money moved in this period.", "Tiada wang bergerak dalam tempoh ini.")} />}
        </section>
      </div>

      {/* ================= TRANSACTIONS ================= */}
      <div hidden={view !== "transactions"} className={css.body}>
        <TabZone label={L("Every movement", "Setiap pergerakan")} hint={L("Booked by Sales, Claims, Payroll, Expenses and ELFIA, or typed here. Press a row for its details.", "Direkod oleh Jualan, Tuntutan, Gaji, Perbelanjaan dan ELFIA, atau ditaip di sini. Tekan baris untuk butirannya.")}>
          {busy ? <Skel className={css.listSkel} /> : <Transactions items={view_!.items} banks={view_!.banks} onOpen={setOpen} />}
        </TabZone>
      </div>

      {/* ================= EXPENSES (the panel as it was) ================= */}
      <div hidden={view !== "expenses"} className={css.body}>
        <p className={css.periodLine}>{L("The P&L card counts expenses and claims when they are recorded or approved, and payroll by its month (accrual) - it is not cash. Cash is on Overview.", "Kad P&L mengira perbelanjaan dan tuntutan apabila direkod atau diluluskan, dan gaji ikut bulannya (akruan) - ia bukan tunai. Tunai di Gambaran.")}</p>
        {expenses}
      </div>

      {/* ================= RECONCILIATION ================= */}
      <div hidden={view !== "reconciliation"} className={css.body}>
        <TabZone label={L("Checks on the portal's own records", "Semakan ke atas rekod portal sendiri")} hint={L("No bank connection or import: each list compares the cash book with the record it came from. Out of step, possible duplicates and not booked look at all time; the rest at the period.", "Tiada sambungan atau import bank: setiap senarai membandingkan buku tunai dengan rekod asalnya. Tidak sepadan, kemungkinan pendua dan belum direkod melihat semua masa; selebihnya ikut tempoh.")}>
          {busy ? <Skel className={css.listSkel} /> : (
            <Reconciliation view={view_!} filter={exFilter} setFilter={setExFilter}
              onReverse={(x) => x.row_id && void reverse(x.row_id, x.title)} onReview={(x) => void review(x)}
              onBank={(x, b) => void assignBank(x.item_key, b)} onBulk={(keys, b) => void assignMany(keys, b)} onSetup={() => setAccounts(true)}
              onBook={() => void bookMissing()} onOpen={openSource} />
          )}
        </TabZone>
      </div>

      {/* ================= REPORTS ================= */}
      <div hidden={view !== "reports"} className={css.body}>
        {busy ? <Skel className={css.listSkel} /> : <Reports view={view_!} period={period} openTab={(t) => (t === "Expenses" ? setView("expenses") : canOpen(t) && setTab(t))} canBooks={canOpen("Accounting")} />}
      </div>

      {/* ---- drawers ---- */}
      <ItemDrawer item={open} view={view_} onClose={() => setOpen(null)} onSource={openSource}
        onReverse={(it) => it.row_id && void reverse(it.row_id, it.description || it.ref)} onBank={(it, b) => void assignBank(it.key, b)}
        onSetup={() => { setOpen(null); setAccounts(true); }} />
      {view_ && adding && <AddDrawer view={view_} onClose={() => setAdding(false)} onSaved={(t, s) => { toast(t, s); setAdding(false); reload(); }} onError={(m) => toast(L("Not saved", "Tidak disimpan"), m, "notice")} />}
      {view_ && accounts && <AccountsDrawer view={view_} onClose={() => setAccounts(false)} onSaved={(t) => { toast(L("Saved", "Disimpan"), t); reload(); }} onError={(m) => toast(L("Not saved", "Tidak disimpan"), m, "notice")} />}
    </TabPage>
  );
}

/* ================================================================== *
 * Overview pieces.
 * ================================================================== */

/** Money in and out, month by month: two lines on one axis, a hover per
    month with both figures and the net. */
function TrendChart({ months }: { months: CashbookView["trend"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 190, PL = 66, PR = 14, PT = 12, PB = 28;
  const max = Math.max(1, ...months.flatMap((m) => [m.in_cents, m.out_cents]));
  const step = (() => { const raw = max / 3; const p = 10 ** Math.floor(Math.log10(raw)); return Math.ceil(raw / p) * p; })();
  const top = step * 3;
  const x = (i: number) => PL + (months.length <= 1 ? 0 : (i / (months.length - 1)) * (W - PL - PR));
  const y = (v: number) => PT + (1 - Math.max(0, v) / top) * (H - PT - PB);
  const path = (k: "in_cents" | "out_cents") => months.map((m, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(m[k]).toFixed(1)}`).join("");
  const area = (k: "in_cents" | "out_cents") => months.length ? `${path(k)}L${x(months.length - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z` : "";
  const h = hover != null ? months[hover] : null;
  return (
    <div className={css.trend}>
      <ul className={css.legend}>
        <li><span className={css.dotIn} />{L("Money in", "Tunai masuk")}</li>
        <li><span className={css.dotOut} />{L("Money out", "Tunai keluar")}</li>
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
          {/* one light fill under money in only: two overlapping fills read as a third colour */}
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
            <span className={css.tipNet}>{L("Net", "Bersih")} {fmtRM(h.in_cents - h.out_cents)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shares of one total as a sorted list of bars (a reversal can make a
    group negative: it is shown, never hidden). */
function GroupBars({ groups, total, empty }: { groups: { group: string; cents: number }[]; total: number; empty: string }) {
  if (!groups.length) return <p className={css.empty}>{empty}</p>;
  const max = Math.max(1, ...groups.map((g) => Math.abs(g.cents)));
  const shown = groups.slice(0, 6);
  const rest = groups.slice(6).reduce((a, g) => a + g.cents, 0);
  const rows = rest ? [...shown, { group: "other_out", cents: rest }] : shown;
  return (
    <ul className={css.bars}>
      {rows.map((g) => (
        <li key={g.group}>
          <span className={css.barLabel}>{groupWord(g.group)}</span>
          <span className={css.barTrack} aria-hidden><span className={css.barFill} style={{ width: `${Math.max(2, (Math.abs(g.cents) / max) * 100)}%` }} /></span>
          <span className={css.barValue}>{fmtRM(g.cents)}</span>
          <span className={css.barPct}>{total > 0 ? `${Math.round((g.cents / total) * 100)}%` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function AccountList({ banks, onSetup }: { banks: Bank[]; onSetup?: () => void }) {
  const live = banks.filter((b) => b.active);
  if (!live.length) return (
    <div className={css.setup}>
      <p className={css.empty}>{L("No company accounts yet. Start with the accounts printed on your invoices, then match each movement to the account it went through.", "Tiada akaun syarikat lagi. Mulakan dengan akaun yang tercetak pada invois anda, kemudian padankan setiap pergerakan dengan akaunnya.")}</p>
      {onSetup && <button type="button" className={btnSmPrimary} onClick={onSetup}>{L("Set up accounts", "Sediakan akaun")}</button>}
    </div>
  );
  return (
    <ul className={css.accounts}>
      {live.map((b) => (
        <li key={b.id}>
          <span className={css.accName}>{b.name}<small>{[b.bank, b.number_masked].filter(Boolean).join(" · ")}</small></span>
          {b.book_balance_cents != null ? (
            <span className={css.accBal}>{fmtRM(b.book_balance_cents)}<small>{L(`Book balance, from ${dmy(b.opening_on)}`, `Baki buku, dari ${dmy(b.opening_on)}`)}</small></span>
          ) : (
            <span className={css.accNone}>{L("No opening balance", "Tiada baki pembukaan")}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A movement as a card - the phone's table, and the Overview's recent list. */
function ItemCards({ items, onOpen, empty }: { items: CashItem[]; onOpen: (i: CashItem) => void; empty: string }) {
  if (!items.length) return <p className={css.empty}>{empty}</p>;
  return (
    <ul className={css.cards}>
      {items.map((i) => (
        <li key={i.key}>
          <button type="button" onClick={() => onOpen(i)} className={i.status === "reversed" || i.status === "reversal" ? css.struck : undefined}>
            <span className={css.cardTop}>
              <span className={css.cardDate}>{dmy(i.date)}</span>
              <span className={i.type === "in" ? css.amtIn : css.amtOut}>{i.type === "in" ? "+" : "−"}{fmtRM(i.amount_cents)}</span>
            </span>
            <span className={css.cardDesc}>{i.description || groupWord(i.group)}</span>
            <span className={css.cardChips}>
              <span className={chipNeutral}>{sourceWord(i.source)}</span>
              <StatusChip s={i.status} />
              {i.bank_name && <span className={css.cardBank}>{i.bank_name}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ================================================================== *
 * Transactions.
 * ================================================================== */

function Transactions({ items, banks, onOpen }: { items: CashItem[]; banks: Bank[]; onOpen: (i: CashItem) => void }) {
  const [q, setQ] = useState("");
  const [dir, setDir] = useState("");
  const [more, setMore] = useState(20);
  const phone = items.filter((i) => (!dir || i.type === dir) && (!q || `${i.description} ${i.ref} ${i.category} ${i.bank_name ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className={css.desk}>
        <DataTable
          id="finance-transactions"
          rows={items.map((i) => ({ ...i, id: i.key }))}
          searchText={(i) => `${i.description} ${i.ref} ${i.category} ${i.bank_name ?? ""} ${i.payment_ref ?? ""}`}
          defaultSort="date"
          onRowClick={(i) => onOpen(i)}
          pageSizes={[25, 50, 100]}
          filters={[
            { key: "type", label: L("Direction", "Arah"), options: [{ value: "in", label: L("In", "Masuk") }, { value: "out", label: L("Out", "Keluar") }], test: (i, v) => i.type === v },
            { key: "source", label: L("Source", "Sumber"), options: (Object.keys(SOURCE) as Source[]).filter((s) => items.some((i) => i.source === s)).map((s) => ({ value: s, label: sourceWord(s) })), test: (i, v) => i.source === v },
            { key: "status", label: L("Status", "Status"), options: (Object.keys(STATUS) as Status[]).filter((s) => items.some((i) => i.status === s)).map((s) => ({ value: s, label: L(STATUS[s][0], STATUS[s][1]) })), test: (i, v) => i.status === v },
            { key: "bank", label: L("Account", "Akaun"), options: [{ value: "none", label: L("No account", "Tiada akaun") }, ...banks.map((b) => ({ value: String(b.id), label: b.name }))], test: (i, v) => (v === "none" ? !i.bank_id : String(i.bank_id ?? "") === v) },
          ]}
          csvExport={{
            name: "finance-transactions",
            headers: [L("Date", "Tarikh"), L("Booked on", "Direkod pada"), L("Direction", "Arah"), L("Amount (RM)", "Amaun (RM)"), L("Category", "Kategori"), L("Source", "Sumber"), L("Reference", "Rujukan"), L("Payment ref", "Ruj. bayaran"), L("Account", "Akaun"), L("Status", "Status"), L("Description", "Keterangan")],
            row: (i) => [i.date, i.booked_on ?? "", i.type, (i.amount_cents / 100).toFixed(2), groupWord(i.group), sourceWord(i.source), i.ref, i.payment_ref ?? "", i.bank_name ?? "", L(STATUS[i.status][0], STATUS[i.status][1]), i.description],
          }}
          columns={[
            { key: "date", label: L("Date", "Tarikh"), render: (i) => <span className={css.num}>{dmy(i.date)}</span>, sortValue: (i) => i.date },
            { key: "description", label: L("Description", "Keterangan"), render: (i) => <span className={i.status === "reversed" || i.status === "reversal" ? css.struckText : undefined}>{i.description || "—"}</span> },
            { key: "group", label: L("Category", "Kategori"), render: (i) => (i.transfer_id ? sourceWord("transfer") : groupWord(i.group)) },
            { key: "type", label: L("Direction", "Arah"), render: (i) => <span className={i.type === "in" ? chipSuccess : chipDanger}>{i.type === "in" ? L("In", "Masuk") : L("Out", "Keluar")}</span> },
            { key: "amount_cents", label: L("Amount", "Amaun"), numeric: true, sortValue: (i) => i.amount_cents, render: (i) => fmtRM(i.amount_cents) },
            { key: "bank_name", label: L("Account", "Akaun"), render: (i) => i.bank_name ?? <span className={css.muted}>—</span> },
            { key: "source", label: L("Source", "Sumber"), render: (i) => sourceWord(i.source) },
            { key: "ref", label: L("Reference", "Rujukan"), render: (i) => <span className={css.num}>{i.ref || "—"}</span> },
            { key: "status", label: L("Status", "Status"), render: (i) => <StatusChip s={i.status} /> },
          ]}
          empty={L("No money moved in this period.", "Tiada wang bergerak dalam tempoh ini.")}
          emptyHint={L("Choose another period above, or add a movement the system cannot see.", "Pilih tempoh lain di atas, atau tambah pergerakan yang sistem tidak nampak.")}
        />
      </div>
      <div className={css.phone}>
        <div className={css.phoneTools}>
          <input type="search" className={inputClass} placeholder={L("Search", "Cari")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L("Search transactions", "Cari transaksi")} />
          <select className={inputClass} value={dir} onChange={(e) => setDir(e.target.value)} aria-label={L("Direction", "Arah")}>
            <option value="">{L("In and out", "Masuk dan keluar")}</option>
            <option value="in">{L("Money in", "Tunai masuk")}</option>
            <option value="out">{L("Money out", "Tunai keluar")}</option>
          </select>
        </div>
        <ItemCards items={phone.slice(0, more)} onOpen={onOpen} empty={L("No money moved in this period.", "Tiada wang bergerak dalam tempoh ini.")} />
        {phone.length > more && <button type="button" className={btnSm} onClick={() => setMore((n) => n + 20)}>{L(`Show more (${phone.length - more})`, `Tunjuk lagi (${phone.length - more})`)}</button>}
      </div>
    </>
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

function ItemDrawer({ item, view, onClose, onSource, onReverse, onBank, onSetup }: {
  item: CashItem | null; view: CashbookView | null; onClose: () => void; onSource: (l: CashItem["link"]) => void;
  onReverse: (i: CashItem) => void; onBank: (i: CashItem, bankId: number) => void; onSetup: () => void;
}) {
  const i = item;
  const canFix = Boolean(view?.can_correct);
  const reversible = Boolean(i && i.row_id && canFix && i.status !== "reversal" && i.status !== "reversed");
  const assignable = Boolean(i && canFix && !i.bank_id && i.status !== "reversal" && /^(CF|PART|INV):\d+$/.test(i.key) && !i.transfer_id);
  const rows: [string, ReactNode][] = i ? [
    [L("Money moved on", "Wang bergerak pada"), dmy(i.date)],
    [L("Booked on", "Direkod pada"), i.booked_on ? dmy(i.booked_on) : L("Read from the invoice", "Dibaca daripada invois")],
    [L("Direction", "Arah"), i.type === "in" ? L("Money in", "Tunai masuk") : L("Money out", "Tunai keluar")],
    [L("Amount", "Amaun"), fmtRM(i.amount_cents)],
    [L("Category", "Kategori"), groupWord(i.group)],
    [L("Source", "Sumber"), sourceWord(i.source)],
    [L("Reference", "Rujukan"), i.link ? <button type="button" className={css.linkBtn} onClick={() => { onSource(i.link); onClose(); }}>{i.ref || L("Open", "Buka")} →</button> : (i.ref || "—")],
    [L("Payment reference", "Rujukan bayaran"), i.payment_ref || "—"],
    [L("Account", "Akaun"), i.bank_name ?? L("Not assigned", "Belum ditetapkan")],
    [L("Status", "Status"), <StatusChip key="s" s={i.status} />],
    ...(i.reverse_reason ? [[L("Reason", "Sebab"), i.reverse_reason] as [string, ReactNode]] : []),
  ] : [];
  return (
    <SideDrawer open={Boolean(i)} onClose={onClose} title={i ? (i.description || groupWord(i.group)) : ""} subtitle={i ? `${i.type === "in" ? "+" : "−"}${fmtRM(i.amount_cents)}` : undefined}
      footer={i && (reversible || assignable) ? (
        <div className={css.drawerFoot}>
          {assignable && view && (view.banks.some((b) => b.active)
            ? <AssignRow key={i.key} banks={view.banks} suggested={suggestedBank(i, view.banks)} onAssign={(b) => onBank(i, b)} />
            : (
              <span className={css.assignNone}>
                {L("No company account to choose yet.", "Belum ada akaun syarikat untuk dipilih.")}
                {view.can_enter && <button type="button" className={btnSmPrimary} onClick={onSetup}>{L("Set up accounts", "Sediakan akaun")}</button>}
              </span>
            ))}
          {reversible && <button type="button" className={btnSm} onClick={() => onReverse(i)}>{L("Reverse…", "Balikkan…")}</button>}
        </div>
      ) : undefined}>
      {i && (
        <dl className={css.facts}>
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
    </SideDrawer>
  );
}

/** The v1.18.0 entry form, in a drawer, plus a transfer between two of the
    company's own accounts. A movement that looks like one the system
    already booked is said before it is saved. */
function AddDrawer({ view, onClose, onSaved, onError }: { view: CashbookView; onClose: () => void; onSaved: (t: string, s: string) => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState<"move" | "transfer">("move");
  const [d, setD] = useState({ entry_date: "", type: "out", category: "", bank_id: "", amount: "", description: "", from: "", to: "" });
  const [busy, setBusy] = useState(false);
  const [confirmDup, setConfirmDup] = useState(false);
  const banks = view.banks.filter((b) => b.active);
  const cents = Math.round(Number(d.amount) * 100);
  const twin = mode === "move" && d.entry_date && cents > 0
    ? view.items.find((i) => i.date === d.entry_date && i.type === d.type && i.amount_cents === cents && i.status !== "reversed" && i.status !== "reversal") : undefined;
  const save = async () => {
    if (twin && !confirmDup) { setConfirmDup(true); return; }
    setBusy(true);
    const r = mode === "move"
      ? await api<{ error?: { message?: string } }>(`/cashflow`, { method: "POST", body: JSON.stringify({ entry_date: d.entry_date, type: d.type, category: d.category, bank_id: d.bank_id ? Number(d.bank_id) : undefined, amount: Number(d.amount), description: d.description }) })
      : await api<{ error?: { message?: string } }>(`/cashbook/transfer`, { method: "POST", body: JSON.stringify({ date: d.entry_date, from_bank_id: Number(d.from), to_bank_id: Number(d.to), amount: Number(d.amount), description: d.description }) });
    setBusy(false);
    if (r.ok) onSaved(L("Saved", "Disimpan"), mode === "move" ? L("The movement is in the cash book", "Pergerakan ada dalam buku tunai") : L("The transfer is in both accounts", "Pindahan ada dalam kedua-dua akaun"));
    else onError(r.data?.error?.message ?? L("Check the fields", "Semak medan"));
  };
  const ready = d.entry_date && Number(d.amount) > 0 && (mode === "move" || (d.from && d.to && d.from !== d.to));
  return (
    <SideDrawer open onClose={onClose} title={L("Add transaction", "Tambah transaksi")}
      subtitle={L("Only money the system cannot see: capital in, cash top-ups, transfers. Sales, claims, payroll and expenses book themselves.", "Hanya wang yang sistem tidak nampak: modal masuk, tambah nilai tunai, pindahan. Jualan, tuntutan, gaji dan perbelanjaan direkod sendiri.")}
      footer={<div className={css.drawerFoot}><button type="button" className={btnClass} disabled={busy || !ready} onClick={() => void save()}>{confirmDup ? L("Save anyway", "Simpan juga") : L("Save", "Simpan")}</button></div>}>
      <div className={css.form}>
        <div className={css.seg} role="group" aria-label={L("Kind", "Jenis")}>
          <button type="button" aria-pressed={mode === "move"} onClick={() => setMode("move")}>{L("Money in or out", "Tunai masuk atau keluar")}</button>
          <button type="button" aria-pressed={mode === "transfer"} onClick={() => setMode("transfer")} disabled={banks.length < 2} title={banks.length < 2 ? L("Needs two accounts", "Perlu dua akaun") : undefined}>{L("Transfer between accounts", "Pindahan antara akaun")}</button>
        </div>
        <label><span className={fieldLabel}>{L("Date the money moved", "Tarikh wang bergerak")}</span><input type="date" className={inputClass} max={view.period.today} value={d.entry_date} onChange={(e) => { setConfirmDup(false); setD((x) => ({ ...x, entry_date: e.target.value })); }} /></label>
        {mode === "move" ? (
          <>
            <label><span className={fieldLabel}>{L("Direction", "Arah")}</span>
              <select className={inputClass} value={d.type} onChange={(e) => { setConfirmDup(false); setD((x) => ({ ...x, type: e.target.value })); }}>
                <option value="in">{L("Money in", "Tunai masuk")}</option><option value="out">{L("Money out", "Tunai keluar")}</option>
              </select></label>
            <label><span className={fieldLabel}>{L("Category", "Kategori")}</span><input className={inputClass} placeholder={L("Capital / Cash top-up / Rent…", "Modal / Tambah nilai tunai / Sewa…")} value={d.category} onChange={(e) => setD((x) => ({ ...x, category: e.target.value }))} /></label>
            <label><span className={fieldLabel}>{L("Account", "Akaun")}</span>
              <select className={inputClass} value={d.bank_id} onChange={(e) => setD((x) => ({ ...x, bank_id: e.target.value }))}>
                <option value="">—</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
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
        {twin && (
          <p className={css.warn}>{L(`This looks like a movement already booked on that day: ${twin.description || twin.ref} (${fmtRM(twin.amount_cents)}, ${sourceWord(twin.source)}). Save only if it is a different payment.`, `Ini seperti pergerakan yang sudah direkod pada hari itu: ${twin.description || twin.ref} (${fmtRM(twin.amount_cents)}, ${sourceWord(twin.source)}). Simpan hanya jika ia bayaran berlainan.`)}</p>
        )}
      </div>
    </SideDrawer>
  );
}

/** The company's accounts: add one (as before), and - for the CEO and COO -
    edit its names, set it inactive, and enter its opening balance. */
function AccountsDrawer({ view, onClose, onSaved, onError }: { view: CashbookView; onClose: () => void; onSaved: (t: string) => void; onError: (m: string) => void }) {
  const [nb, setNb] = useState({ name: "", bank: "", number_masked: "" });
  const [edit, setEdit] = useState<Record<number, { opening: string; on: string }>>({});
  const add = async () => {
    const r = await api<{ error?: { message?: string } }>(`/banks`, { method: "POST", body: JSON.stringify(nb) });
    if (r.ok) { setNb({ name: "", bank: "", number_masked: "" }); onSaved(L("Account added", "Akaun ditambah")); }
    else onError(r.data?.error?.message ?? L("The account needs a name", "Akaun perlu ada nama"));
  };
  const [adding, setAdding] = useState(false);
  const addInvoiceAccount = async (a: (typeof INVOICE_ACCOUNTS)[number]) => {
    setAdding(true);
    const r = await api<{ error?: { message?: string } }>(`/banks`, { method: "POST", body: JSON.stringify({ name: a.name, bank: a.bank, number_masked: a.number_masked }) });
    setAdding(false);
    if (r.ok) onSaved(L(`${a.name} added`, `${a.name} ditambah`)); else onError(r.data?.error?.message ?? L("Try again", "Cuba lagi"));
  };
  const patch = async (id: number, body: Record<string, unknown>, done: string) => {
    const r = await api<{ error?: { message?: string } }>(`/cashbook/banks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (r.ok) onSaved(done); else onError(r.data?.error?.message ?? L("Try again", "Cuba lagi"));
  };
  return (
    <SideDrawer open onClose={onClose} title={L("Company accounts", "Akaun syarikat")} subtitle={L("Masked numbers only. A book balance is shown only from an opening balance you enter - the portal never guesses one.", "Nombor bertopeng sahaja. Baki buku dipaparkan hanya dari baki pembukaan yang anda masukkan - portal tidak meneka.")}>
      <div className={css.form}>
        <div className={css.accEdit}>
          <p className={css.subhead}>{L("Accounts printed on your invoices", "Akaun yang tercetak pada invois anda")}</p>
          <p className={css.meta}>{L("Customers are told to pay into these. Add them here so receipts can be matched to them.", "Pelanggan diminta membayar ke akaun ini. Tambah di sini supaya penerimaan boleh dipadankan.")}</p>
          <ul className={css.invAcc}>
            {INVOICE_ACCOUNTS.map((a) => {
              const have = view.banks.some((b) => last4(b.number_masked) === a.last4);
              return (
                <li key={a.code}>
                  <span><strong>{a.name}</strong><small>{a.number_masked}</small></span>
                  {have ? <span className={chipSuccess}>{L("Added", "Ditambah")}</span>
                    : <button type="button" className={btnSmPrimary} disabled={adding} onClick={() => void addInvoiceAccount(a)}>{L("Add", "Tambah")}</button>}
                </li>
              );
            })}
          </ul>
        </div>
        {view.banks.length === 0 && <p className={css.empty}>{L("No accounts yet.", "Tiada akaun lagi.")}</p>}
        {view.banks.map((b) => {
          const e = edit[b.id] ?? { opening: b.opening_balance_cents != null ? (b.opening_balance_cents / 100).toFixed(2) : "", on: b.opening_on ?? "" };
          return (
            <div key={b.id} className={css.accEdit}>
              <p className={css.accName}>{b.name}{!b.active && <span className={chipNeutral}>{L("Inactive", "Tidak aktif")}</span>}<small>{[b.bank, b.number_masked].filter(Boolean).join(" · ")}</small></p>
              {view.can_correct ? (
                <>
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
                <p className={css.meta}>{b.book_balance_cents != null ? `${fmtRM(b.book_balance_cents)} · ${L("book balance", "baki buku")}` : L("No opening balance. The CEO or COO enters it.", "Tiada baki pembukaan. CEO atau COO memasukkannya.")}</p>
              )}
            </div>
          );
        })}
        <p className={css.subhead}>{L("Add an account", "Tambah akaun")}</p>
        <label><span className={fieldLabel}>{L("Account name", "Nama akaun")}</span><input className={inputClass} value={nb.name} onChange={(e) => setNb((x) => ({ ...x, name: e.target.value }))} /></label>
        <div className={css.pair}>
          <label><span className={fieldLabel}>Bank</span><input className={inputClass} placeholder="Maybank" value={nb.bank} onChange={(e) => setNb((x) => ({ ...x, bank: e.target.value }))} /></label>
          <label><span className={fieldLabel}>{L("Number (masked)", "Nombor (bertopeng)")}</span><input className={inputClass} placeholder="•••• 1234" value={nb.number_masked} onChange={(e) => setNb((x) => ({ ...x, number_masked: e.target.value }))} /></label>
        </div>
        <button type="button" className={btnSm} disabled={!nb.name.trim()} onClick={() => void add()}>{L("Add account", "Tambah akaun")}</button>
      </div>
    </SideDrawer>
  );
}

/* ================================================================== *
 * Reconciliation.
 * ================================================================== */

function Reconciliation({ view, filter, setFilter, onReverse, onReview, onBank, onBulk, onSetup, onBook, onOpen }: {
  view: CashbookView; filter: ExKind | ""; setFilter: (k: ExKind | "") => void;
  onReverse: (x: Exception) => void; onReview: (x: Exception) => void; onBank: (x: Exception, bankId: number) => void;
  onBulk: (keys: string[], bankId: number) => void; onSetup: () => void; onBook: () => void; onOpen: (l: CashItem["link"]) => void;
}) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [bulkBank, setBulkBank] = useState("");
  /* a tick only chooses rows on this screen; nothing is saved until "Assign selected" */
  const pickRow = (key: string, on: boolean) => setSel((s0) => new Set(on ? [...s0, key] : [...s0].filter((k) => k !== key)));
  const noAccounts = !view.banks.some((b) => b.active);
  const kinds = EX_ORDER.filter((k) => view.exceptions.some((x) => x.kind === k));
  const itemOf = (key: string) => view.items.find((i) => i.key === key);
  /* the no-account receipts whose invoice names an account that is set up */
  const byInvoice = view.exceptions.filter((x) => x.kind === "no_bank").map((x) => ({ x, b: suggestedBank(itemOf(x.item_key), view.banks) })).filter((r) => r.b);
  const setup = noAccounts && view.can_enter ? (
    <section className={`${card} ${css.setup}`} aria-label={L("Set up accounts", "Sediakan akaun")}>
      <PanelTitle icon="pay">{L("First, the company's accounts", "Pertama, akaun syarikat")}</PanelTitle>
      <p className={css.meta}>{L("Matching each movement to the account it went through needs the accounts. Start with the two printed on your invoices.", "Memadankan setiap pergerakan dengan akaunnya memerlukan akaun itu. Mulakan dengan dua yang tercetak pada invois anda.")}</p>
      <button type="button" className={btnSmPrimary} onClick={onSetup}>{L("Set up accounts", "Sediakan akaun")}</button>
    </section>
  ) : null;
  if (!kinds.length) return <div className={css.recon}>{setup}<p className={css.empty}>{L("Nothing out of step. Every movement matches its record.", "Tiada yang tidak sepadan. Setiap pergerakan sepadan dengan rekodnya.")}</p></div>;
  const shown = filter ? kinds.filter((k) => k === filter) : kinds;
  return (
    <div className={css.recon}>
      {setup}
      <div className={css.pills} role="group" aria-label={L("Show", "Tunjuk")}>
        <button type="button" aria-pressed={!filter} onClick={() => setFilter("")}>{L("All", "Semua")} · {view.exceptions.length}</button>
        {kinds.map((k) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{L(EX[k][0], EX[k][1])} · {view.exceptions.filter((x) => x.kind === k).length}</button>)}
      </div>
      {shown.map((k) => {
        const list = view.exceptions.filter((x) => x.kind === k);
        return (
          <section key={k} className={card} aria-label={L(EX[k][0], EX[k][1])}>
            <div className={css.head}>
              <PanelTitle icon="warning">{L(EX[k][0], EX[k][1])} <span className={chipNeutral}>{list.length}</span></PanelTitle>
              {k === "not_booked" && view.can_enter && <button type="button" className={btnSmPrimary} onClick={onBook}>{L("Book all missing", "Rekod semua yang tiada")}</button>}
            </div>
            <p className={css.meta}>{L(EX[k][2], EX[k][3])}</p>
            {k === "no_bank" && view.can_correct && (
              /* v1.220.2 - many at once: the receipts whose invoice printed an
                 account that is set up, or any ticked rows to one account */
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
                    {view.banks.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                      {k === "no_bank" && view.can_correct && (
                        <input type="checkbox" className={css.rowCheck} aria-label={L(`Select ${x.title}`, `Pilih ${x.title}`)} checked={sel.has(x.item_key)}
                          onChange={(e) => pickRow(x.item_key, e.target.checked)} />
                      )}
                      {x.title}
                    </span>
                    <span className={css.meta}>{dmy(x.date)} · {x.detail}</span>
                  </span>
                  <span className={x.type === "in" ? css.amtIn : css.amtOut}>{x.type === "in" ? "+" : "−"}{fmtRM(x.amount_cents)}</span>
                  <span className={css.exActs}>
                    {x.link && <button type="button" className={btnSm} onClick={() => onOpen(x.link)}>{x.actions.includes("confirm") ? L("Open to confirm", "Buka untuk sahkan") : L("Open record", "Buka rekod")}</button>}
                    {view.can_correct && x.actions.includes("bank") && (
                      <span className={css.assign}>
                        <select className={inputClass} aria-label={L("Account", "Akaun")} value={pick[x.key] ?? String(suggestedBank(itemOf(x.item_key), view.banks)?.id ?? "")} onChange={(e) => setPick((p) => ({ ...p, [x.key]: e.target.value }))}>
                          <option value="">{L("Account…", "Akaun…")}</option>
                          {view.banks.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                        <button type="button" className={btnSm} disabled={!(pick[x.key] ?? suggestedBank(itemOf(x.item_key), view.banks)?.id)} onClick={() => onBank(x, Number(pick[x.key] ?? suggestedBank(itemOf(x.item_key), view.banks)?.id))}>{L("Assign", "Tetapkan")}</button>
                      </span>
                    )}
                    {view.can_correct && x.actions.includes("reverse") && x.row_id && <button type="button" className={btnSm} onClick={() => onReverse(x)}>{L("Reverse…", "Balikkan…")}</button>}
                    {view.can_correct && x.actions.includes("review") && <button type="button" className={btnSm} onClick={() => onReview(x)}>{L("Mark reviewed…", "Tanda disemak…")}</button>}
                  </span>
                </li>
              ))}
            </ul>
            {list.length > 100 && <p className={css.meta}>{L(`And ${list.length - 100} more - narrow the period.`, `Dan ${list.length - 100} lagi - kecilkan tempoh.`)}</p>}
          </section>
        );
      })}
    </div>
  );
}

/* ================================================================== *
 * Reports - all from the same read; nothing computed twice on the server.
 * ================================================================== */

function Reports({ view, period, openTab, canBooks }: { view: CashbookView; period: { from: string; to: string }; openTab: (t: "Expenses" | "Accounting") => void; canBooks: boolean }) {
  const counted = view.items.filter((i) => i.counts);
  const bySource = (Object.keys(SOURCE) as Source[]).map((s) => {
    const list = view.items.filter((i) => i.source === s);
    return { s, n: list.length, in: list.filter((i) => i.type === "in").reduce((a, i) => a + i.amount_cents, 0), out: list.filter((i) => i.type === "out").reduce((a, i) => a + i.amount_cents, 0) };
  }).filter((r) => r.n > 0);
  const perBank = view.banks.map((b) => {
    const list = view.items.filter((i) => i.bank_id === b.id);
    return { b, in: list.filter((i) => i.type === "in").reduce((a, i) => a + i.amount_cents, 0), out: list.filter((i) => i.type === "out").reduce((a, i) => a + i.amount_cents, 0) };
  });
  const unassigned = counted.filter((i) => !i.bank_id);
  /* the shared exporter (lib/csv.ts): BOM, CRLF and formula defusing */
  const csv = () => downloadCsv(`a2z-cash-${period.from}-to-${period.to}`, [
    ["Date", "Booked on", "Direction", "Amount (RM)", "Category", "Source", "Reference", "Payment ref", "Account", "Status", "Description"],
    ...view.items.map((i) => [i.date, i.booked_on ?? "", i.type, (i.amount_cents / 100).toFixed(2), groupWord(i.group), sourceWord(i.source), i.ref, i.payment_ref ?? "", i.bank_name ?? "", STATUS[i.status][0], i.description]),
  ]);
  return (
    <>
      <TabZone label={L("Monthly cash flow", "Aliran tunai bulanan")} hint={L("The last 12 months, by the day the money moved (Malaysia time).", "12 bulan terakhir, ikut hari wang bergerak (waktu Malaysia).")}>
        <section className={card}>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead><tr><th>{L("Month", "Bulan")}</th><th>{L("Money in", "Tunai masuk")}</th><th>{L("Money out", "Tunai keluar")}</th><th>{L("Net", "Bersih")}</th></tr></thead>
              <tbody>{[...view.trend].reverse().map((m) => (
                <tr key={m.month}><td>{monthWord(m.month)}</td><td>{fmtRM(m.in_cents)}</td><td>{fmtRM(m.out_cents)}</td><td className={m.in_cents - m.out_cents < 0 ? css.neg : undefined}>{fmtRM(m.in_cents - m.out_cents)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </TabZone>
      <TabZone label={L("By category", "Ikut kategori")} hint={periodWord(period.from, period.to)} cols={2}>
        <section className={card}>
          <PanelTitle icon="down">{L("Money in", "Tunai masuk")}</PanelTitle>
          <GroupTable groups={view.groups.in} total={view.totals.in_cents} />
        </section>
        <section className={card}>
          <PanelTitle icon="up">{L("Money out", "Tunai keluar")}</PanelTitle>
          <GroupTable groups={view.groups.out} total={view.totals.out_cents} />
        </section>
      </TabZone>
      <TabZone label={L("Accounts and sources", "Akaun dan sumber")} hint={periodWord(period.from, period.to)} cols={2}>
        <section className={card}>
          <PanelTitle icon="pay">{L("Account summary", "Ringkasan akaun")}</PanelTitle>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead><tr><th>{L("Account", "Akaun")}</th><th>{L("In", "Masuk")}</th><th>{L("Out", "Keluar")}</th><th>{L("Book balance", "Baki buku")}</th></tr></thead>
              <tbody>
                {perBank.map(({ b, in: i, out: o }) => <tr key={b.id}><td>{b.name}</td><td>{fmtRM(i)}</td><td>{fmtRM(o)}</td><td>{b.book_balance_cents != null ? fmtRM(b.book_balance_cents) : "—"}</td></tr>)}
                <tr><td>{L("Not assigned", "Belum ditetapkan")}</td><td>{fmtRM(unassigned.filter((i) => i.type === "in").reduce((a, i) => a + i.amount_cents, 0))}</td><td>{fmtRM(unassigned.filter((i) => i.type === "out").reduce((a, i) => a + i.amount_cents, 0))}</td><td>—</td></tr>
              </tbody>
            </table>
          </div>
        </section>
        <section className={card}>
          <PanelTitle icon="database">{L("Where it came from", "Dari mana ia datang")}</PanelTitle>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead><tr><th>{L("Source", "Sumber")}</th><th>#</th><th>{L("In", "Masuk")}</th><th>{L("Out", "Keluar")}</th></tr></thead>
              <tbody>{bySource.map((r) => <tr key={r.s}><td>{sourceWord(r.s)}</td><td>{r.n}</td><td>{fmtRM(r.in)}</td><td>{fmtRM(r.out)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className={css.meta}>{L("Rows here are as booked - reversals and transfers included - so they can differ from Money in and out above.", "Baris di sini seperti direkod - termasuk pembalikan dan pindahan - jadi ia boleh berbeza daripada Tunai masuk dan keluar di atas.")}</p>
        </section>
      </TabZone>
      <TabZone label={L("Exports and other reports", "Eksport dan laporan lain")}>
        <section className={card}>
          <div className={css.rowBtns}>
            <button type="button" className={btnSm} onClick={csv}><AppIcon name="download" /> {L("Transactions CSV (this period)", "CSV transaksi (tempoh ini)")}</button>
            <button type="button" className={btnSm} onClick={() => openTab("Expenses")}>{L("P&L (accrual - not cash)", "P&L (akruan - bukan tunai)")} →</button>
            {canBooks && <button type="button" className={btnSm} onClick={() => openTab("Accounting")}>{L("Books and trial balance", "Buku dan imbangan duga")} →</button>}
          </div>
        </section>
      </TabZone>
    </>
  );
}

function GroupTable({ groups, total }: { groups: { group: string; cents: number }[]; total: number }) {
  if (!groups.length) return <p className={css.empty}>{L("Nothing in this period.", "Tiada dalam tempoh ini.")}</p>;
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <tbody>{groups.map((g) => <tr key={g.group}><td>{groupWord(g.group)}</td><td>{fmtRM(g.cents)}</td><td>{total > 0 ? `${Math.round((g.cents / total) * 100)}%` : ""}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

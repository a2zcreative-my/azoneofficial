"use client";

/* v1.18.0 — Accounting (programme phase 7): chart of accounts, a
 * balanced-only journal (the server refuses an entry whose debits ≠ credits —
 * the invariant lives where it cannot be bypassed) and a trial balance
 * computed from the journal.
 *
 * v1.172.0 — this file was purchasing-panels.tsx and carried the Purchasing
 * module too. Purchasing is retired; only the Accounting half moved here.
 *
 * v1.222.0 — ACCOUNTING 2.0 (the owner's brief and answers, 28-10-2026;
 * claude/ACCOUNTING-AUDIT.md): four tabs over the ONE ledger that exists -
 * Overview, General Ledger, Financial Reports, Month-End & Audit. Every
 * figure is a sum of journal lines (worker/src/ledger.ts), read on the day
 * the money moved. The books are CASH BASIS and every view says so; Bank -
 * operating is the net of what the portal booked, never called a bank
 * balance; no balance sheet is drawn ("report the gap"). Corrections are
 * mirror entries with a reason; nothing is edited or deleted.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs, TabAside } from "@/components/ui/line-tabs";
import { SideDrawer } from "@/components/ui/side-drawer";
import { BooksPanel } from "@/components/portal/books-panel"; // v1.181.15
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { makeApi, type ApiResult } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, btnSmPrimary, card, chipGold, chipInfo, chipNeutral, chipSuccess, chipWarn, fieldLabel, inputClass } from "@/lib/ui-styles";
import css from "./accounting.module.css";

const api = makeApi("/staff/erp");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const message = (r: ApiResult<unknown>) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Connection failed. Retry when online.", "Sambungan gagal. Cuba semula apabila dalam talian.");

type Normal = "debit" | "credit";
type AccType = "asset" | "liability" | "equity" | "income" | "expense";
type Source = "sales" | "expenses" | "claims" | "payroll" | "finance" | "channel" | "elfia" | "reversal" | "manual";
interface GlAccount { id: number; code: string; name: string; type: AccType; active?: number; normal?: Normal; debit_cents?: number; credit_cents?: number; balance_cents?: number }
interface Brief { id: number; ref: string; memo: string; eff: string; entry_date: string; created_at: string; who: string | null; amount_cents: number; lines: number; source: Source; reversed_by?: number | null }
interface Overview {
  period: { from: string; to: string; today: string }; basis: "cash";
  accounts: { total: number; used: number };
  trial: { debit_cents: number; credit_cents: number; balanced: boolean; difference_cents: number };
  money: { in_cents: number; out_cents: number; net_cents: number };
  trend: { month: string; in_cents: number; out_cents: number; net_cents: number }[];
  top_expenses: { id: number; code: string; name: string; cents: number }[];
  balances: GlAccount[];
  bank: { code: string; name: string; balance_cents: number } | null;
  exceptions: {
    unbalanced: { id: number; ref: string; debit_cents: number; credit_cents: number; lines: number }[];
    duplicates: { ref: string; ids: number[] }[];
    unjournaled: { id: number; ref: string; type: string; amount_cents: number; date: string }[];
    payroll_drift: { month: string; booked_cents: number; payroll_cents: number }[];
    part_payments: { count: number; cents: number };
  };
  recent: Brief[]; entries: number;
}
interface Check { key: "balanced" | "posting" | "reconciliation" | "payroll" | "part_payments" | "ownership"; level: "block" | "warn" | "info"; ok: boolean; detail: Record<string, unknown> }
interface MonthEnd {
  month: string; from: string; to: string; ended: boolean; checks: Check[]; ready: boolean;
  close: { id: number; closed_at: string; by: string | null; note: string | null } | null;
  adjustments: (Brief & { reason: string | null })[];
  figures: { in_cents: number; out_cents: number; net_cents: number; entries: number };
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
const monthWord = (m: string) => `${(getLang() === "ms" ? MONTHS_MS : MONTHS_LONG)[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;
const shortMonth = (m: string) => MONTHS_SHORT[Number(m.slice(5, 7)) - 1] ?? m;
const shiftMonth = (m: string, k: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1)).toISOString().slice(0, 7);
const monthLast = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const SOURCES: [Source, string, string][] = [
  ["sales", "Sales", "Jualan"], ["expenses", "Expenses", "Perbelanjaan"], ["claims", "Claims", "Tuntutan"], ["payroll", "Payroll", "Gaji"],
  ["finance", "Finance", "Kewangan"], ["channel", "Channel settlement", "Penyelesaian saluran"], ["elfia", "ELFIA web order", "Pesanan web ELFIA"],
  ["reversal", "Reversal", "Pembalikan"], ["manual", "Manual entry", "Catatan manual"],
];
const sourceWord = (s: Source) => { const x = SOURCES.find((r) => r[0] === s); return x ? L(x[1], x[2]) : s; };
const TYPES: [AccType, string, string][] = [["asset", "Asset", "Aset"], ["liability", "Liability", "Liabiliti"], ["equity", "Equity", "Ekuiti"], ["income", "Income", "Pendapatan"], ["expense", "Expense", "Perbelanjaan"]];
const typeWord = (t: string) => { const x = TYPES.find((r) => r[0] === t); return x ? L(x[1], x[2]) : t; };
/** A balance on its account's normal side, written Dr/Cr - never a minus on income. */
function sided(cents: number, normal: Normal = "debit") {
  if (cents === 0) return fmtRM(0);
  const side = (cents > 0) === (normal === "debit") ? "Dr" : "Cr";
  return `${fmtRM(Math.abs(cents))} ${side}`;
}
const normalOf = (t: AccType): Normal => (t === "asset" || t === "expense" ? "debit" : "credit");
const onDebit = (a: GlAccount) => { const b = a.balance_cents ?? 0; return b !== 0 && (b > 0) === (a.normal === "debit"); };

/* ============================ Overview ============================ */

function Trend({ rows }: { rows: Overview["trend"] }) {
  const [hover, setHover] = useState<number | null>(null);
  /* a round top for the scale (1, 2, 2.5 or 5 x 10^n ringgit), so every
     tick names a value the chart really reaches */
  const top = Math.max(1, ...rows.flatMap((r) => [r.in_cents, r.out_cents])) / 100;
  const pow = 10 ** Math.floor(Math.log10(top));
  const max = ([1, 2, 2.5, 5, 10].map((k) => k * pow).find((v) => v >= top) ?? 10 * pow) * 100;
  const W = 560, H = 200, P = 40, B = 24, step = (W - P) / Math.max(1, rows.length), bw = Math.min(26, step / 3);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const y = (v: number) => H - B - (v / max) * (H - B - 10);
  const label = (c: number) => (c >= 100000 ? `${Number((c / 100000).toFixed(1))}k` : `${Math.round(c / 100)}`);
  const h = hover !== null ? rows[hover] : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={css.chart} role="img" aria-label={L("Money in and money out by month", "Wang masuk dan keluar mengikut bulan")}>
        {ticks.map((t, i) => <g key={i}><line className={css.grid} x1={P} x2={W} y1={y(t)} y2={y(t)} /><text x={P - 6} y={y(t) + 4} textAnchor="end">{label(t)}</text></g>)}
        {rows.map((r, i) => {
          const x = P + i * step + step / 2;
          return (
            <g key={r.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${monthWord(r.month)}: ${fmtRM(r.in_cents)} / ${fmtRM(r.out_cents)}`}>
              <rect x={x - step / 2} y={0} width={step} height={H} fill="transparent" />
              <rect className={css.barIn} x={x - bw - 2} y={y(r.in_cents)} width={bw} height={Math.max(0, H - B - y(r.in_cents))} rx={3} />
              <rect className={css.barOut} x={x + 2} y={y(r.out_cents)} width={bw} height={Math.max(0, H - B - y(r.out_cents))} rx={3} />
              <text x={x} y={H - 6} textAnchor="middle">{shortMonth(r.month)}</text>
            </g>
          );
        })}
      </svg>
      <div className={css.legend}><span><i className={css.dotIn} />{L("Money in (income accounts)", "Wang masuk (akaun pendapatan)")}</span><span><i className={css.dotOut} />{L("Money out (expense accounts)", "Wang keluar (akaun perbelanjaan)")}</span></div>
      <p className={css.tip} role="status">{h ? `${monthWord(h.month)} · ${L("In", "Masuk")} ${fmtRM(h.in_cents)} · ${L("Out", "Keluar")} ${fmtRM(h.out_cents)} · ${L("Net", "Bersih")} ${fmtRM(h.net_cents)}` : L("Point at a month for its figures.", "Tuding pada bulan untuk angkanya.")}</p>
    </div>
  );
}

function EntryRows({ rows, onOpen, empty }: { rows: Brief[]; onOpen: (id: number) => void; empty: string }) {
  if (!rows.length) return <p className={css.empty}>{empty}</p>;
  return (
    <>
      <div className={`${css.desk} ${css.tableWrap}`}>
        <table className={`${css.table} ${css.click}`} aria-label={L("Journal entries", "Catatan jurnal")}>
          <thead><tr><th>{L("Money moved", "Wang bergerak")}</th><th>{L("Entry", "Catatan")}</th><th>{L("Source", "Sumber")}</th><th className={css.num}>{L("Amount", "Amaun")}</th><th>{L("By", "Oleh")}</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} onClick={() => onOpen(e.id)}>
                <td className={css.nowrap}>{dmy(e.eff)}</td>
                <td><span className={css.memo}>{e.memo || L("(no memo)", "(tiada memo)")}</span><span className={css.refLine}>#{e.id}{e.ref ? ` · ${e.ref}` : ""}{e.reversed_by ? ` · ${L("reversed", "dibalikkan")}` : ""}</span></td>
                <td><span className={e.source === "manual" ? chipGold : e.source === "reversal" ? chipWarn : chipNeutral}>{sourceWord(e.source)}</span></td>
                <td className={css.num}>{fmtRM(e.amount_cents)}</td>
                <td className={css.muted}>{e.who ?? (e.source === "elfia" ? L("ELFIA sync", "Segerak ELFIA") : "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={css.phone} aria-label={L("Journal entries", "Catatan jurnal")}>
        {rows.map((e) => (
          <li key={e.id}><button type="button" onClick={() => onOpen(e.id)}>
            <span className={css.cardTop}><span>{dmy(e.eff)} · #{e.id}</span><strong>{fmtRM(e.amount_cents)}</strong></span>
            <span className={css.memo}>{e.memo || e.ref || L("(no memo)", "(tiada memo)")}</span>
            <span className={css.refLine}>{sourceWord(e.source)}{e.ref ? ` · ${e.ref}` : ""}</span>
          </button></li>
        ))}
      </ul>
    </>
  );
}

function ExceptionList({ x, onOpen }: { x: Overview["exceptions"]; onOpen: (id: number) => void }) {
  const unjSum = x.unjournaled.reduce((s, r) => s + r.amount_cents, 0);
  const items: { key: string; ok: boolean; level: "bad" | "look" | "info"; title: string; detail: ReactNode }[] = [
    { key: "unbalanced", ok: x.unbalanced.length === 0, level: "bad", title: L("Every entry balances and has two lines or more", "Setiap catatan seimbang dan ada dua baris atau lebih"),
      detail: x.unbalanced.length ? <>{x.unbalanced.slice(0, 5).map((u) => <span key={u.id}><button type="button" className={css.linkBtn} onClick={() => onOpen(u.id)}>#{u.id} {u.ref}</button>{" "}</span>)}{L(`${x.unbalanced.length} entry(ies) out of balance or half-written.`, `${x.unbalanced.length} catatan tidak seimbang atau separuh ditulis.`)}</> : L("None found.", "Tiada.") },
    { key: "duplicates", ok: x.duplicates.length === 0, level: "bad", title: L("No event posted twice", "Tiada peristiwa diposkan dua kali"),
      detail: x.duplicates.length ? x.duplicates.slice(0, 5).map((d) => `${d.ref} (${d.ids.map((i) => `#${i}`).join(", ")})`).join(" · ") : L("Every reference is posted once.", "Setiap rujukan diposkan sekali.") },
    { key: "unjournaled", ok: x.unjournaled.length === 0, level: "look", title: L("Every cash movement is in the books", "Setiap pergerakan tunai ada dalam buku"),
      detail: x.unjournaled.length ? L(`${x.unjournaled.length} movement(s) in Finance have no journal entry, totalling ${fmtRM(unjSum)}. Oldest: ${x.unjournaled[0]?.ref || `#${x.unjournaled[0]?.id}`} on ${dmy(x.unjournaled[0]?.date)}.`, `${x.unjournaled.length} pergerakan dalam Kewangan tiada catatan jurnal, berjumlah ${fmtRM(unjSum)}.`) : L("Each movement has its entry.", "Setiap pergerakan ada catatannya.") },
    { key: "payroll", ok: x.payroll_drift.length === 0, level: "look", title: L("Payroll in the books matches payroll", "Gaji dalam buku sepadan dengan gaji"),
      detail: x.payroll_drift.length ? x.payroll_drift.map((p) => L(`${monthWord(p.month)}: booked ${fmtRM(p.booked_cents)}, payroll now ${fmtRM(p.payroll_cents)}`, `${monthWord(p.month)}: direkod ${fmtRM(p.booked_cents)}, gaji kini ${fmtRM(p.payroll_cents)}`)).join(" · ") : L("No payroll changed after its bank run.", "Tiada gaji berubah selepas bayaran bank.") },
    { key: "parts", ok: x.part_payments.count === 0, level: "info", title: L("Part payments not yet in the books", "Bayaran separa belum dalam buku"),
      detail: x.part_payments.count ? L(`${x.part_payments.count} part payment(s), ${fmtRM(x.part_payments.cents)}, received on invoices not yet paid in full. They enter the books when the invoice is marked paid.`, `${x.part_payments.count} bayaran separa, ${fmtRM(x.part_payments.cents)}, pada invois yang belum dibayar penuh. Ia masuk buku apabila invois ditanda dibayar.`) : L("None outstanding.", "Tiada.") },
  ];
  return (
    <ul className={css.checks} aria-label={L("Posting checks", "Semakan pengeposan")}>
      {items.map((i) => (
        <li key={i.key} className={i.ok ? css.ok : i.level === "bad" ? css.bad : i.level === "look" ? css.look : css.info}>
          <AppIcon name={i.ok ? "success" : i.level === "info" ? "info" : "warning"} />
          <span className={css.checkText}><strong>{i.title}</strong><span>{i.detail}</span></span>
          <span className={i.ok ? chipSuccess : i.level === "info" ? chipInfo : chipWarn}>{i.ok ? L("OK", "OK") : i.level === "info" ? L("Note", "Nota") : L("Look", "Semak")}</span>
        </li>
      ))}
    </ul>
  );
}

/* ============================ one journal entry ============================ */

interface EntryDetail {
  entry: Brief & { credit_cents: number };
  lines: { account_id: number; code: string; name: string; type: string; debit_cents: number; credit_cents: number }[];
  manual: boolean; tab: string | null; detail: Record<string, string | number | null> | null;
  reversed_by: { id: number; ref: string; eff: string } | null; reverses: number | null; post_close_reason: string | null;
}
function EntryDrawer({ id, onClose, onOpen, onChanged }: { id: number | null; onClose: () => void; onOpen: (id: number) => void; onChanged: () => void }) {
  const [got, setGot] = useState<{ key: string; d: EntryDetail | null; error: string } | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${id}|${tick}`;
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();
  useEffect(() => {
    if (id === null) return;
    const c = new AbortController();
    void api<EntryDetail>(`/gl/journal/${id}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ key, d: r.ok && r.data ? r.data : null, error: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [id, key]);
  const mine = got?.key === key ? got : null;
  const d = mine?.d ?? null;
  const reverse = async () => {
    if (!d) return;
    const r0 = await prompt({ title: L("Reverse this entry?", "Balikkan catatan ini?"), message: L(`Entry #${d.entry.id}, ${fmtRM(d.entry.amount_cents)}. A mirror entry is posted today with your reason; the original stays as it is.`, `Catatan #${d.entry.id}, ${fmtRM(d.entry.amount_cents)}. Catatan cermin diposkan hari ini dengan sebab anda; yang asal kekal.`), label: L("Reason (at least 8 characters)", "Sebab (sekurang-kurangnya 8 aksara)"), required: true, confirmLabel: L("Reverse", "Balikkan"), variant: "danger" });
    if (!r0) return;
    const r = await api<{ id?: number }>(`/gl/journal/${d.entry.id}/reverse`, { method: "POST", body: JSON.stringify({ reason: r0.value }) });
    if (r.ok) { toast(L("Reversed", "Dibalikkan"), L("The mirror entry is in the journal, with your reason", "Catatan cermin ada dalam jurnal, dengan sebab anda")); setTick((t) => t + 1); onChanged(); }
    else toast(L("Not reversed", "Tidak dibalikkan"), message(r), "notice");
  };
  const facts: [string, ReactNode][] = d ? [
    [L("Money moved on", "Wang bergerak pada"), dmy(d.entry.eff)],
    [L("Booked on", "Direkod pada"), `${dmy(d.entry.entry_date)} · ${L("posted", "diposkan")} ${dmyMYT(d.entry.created_at)}`],
    [L("Posted by", "Diposkan oleh"), d.entry.who ?? (d.entry.source === "elfia" ? L("ELFIA sync", "Segerak ELFIA") : "-")],
    [L("Source", "Sumber"), <>{sourceWord(d.entry.source)}{d.entry.ref ? ` · ${d.entry.ref}` : ""}{d.tab && <> · <a className={css.linkBtn} href={`/portal?tab=${encodeURIComponent(d.tab)}`} target="_blank" rel="noopener noreferrer">{L(`Open ${d.tab}`, `Buka ${d.tab}`)}</a></>}</>],
    ...(d.detail ? Object.entries(d.detail).filter(([, v]) => v !== null && v !== "").map(([k, v]) => [k.replaceAll("_", " "), k.endsWith("_cents") ? fmtRM(Number(v)) : String(v)] as [string, ReactNode]) : []),
    ...(d.entry.source === "sales" && d.detail && !d.detail.confirmed_on ? [[L("Confirmation", "Pengesahan"), <span key="c" className={chipWarn}>{L("Not yet confirmed by the CEO or COO", "Belum disahkan oleh CEO atau COO")}</span>] as [string, ReactNode]] : []),
    ...(d.post_close_reason ? [[L("Posted after the month closed", "Diposkan selepas bulan ditutup"), d.post_close_reason] as [string, ReactNode]] : []),
  ] : [];
  return (
    <SideDrawer open={id !== null} onClose={onClose} wide title={d ? (d.entry.memo || d.entry.ref || `#${d.entry.id}`) : id ? `#${id}` : ""} subtitle={d ? `${L("Journal entry", "Catatan jurnal")} #${d.entry.id} · ${fmtRM(d.entry.amount_cents)}` : undefined}
      footer={d && d.manual && !d.reversed_by ? <button type="button" className={btnSm} onClick={() => void reverse()}><AppIcon name="refresh" />{L("Reverse…", "Balikkan…")}</button> : undefined}>
      {promptNode}{toastNode}
      {mine?.error ? <p role="alert" className={css.error}>{mine.error}</p> : !d ? <SkelRows rows={6} /> : (
        <div className={css.drawerBody}>
          <dl className={css.facts}>{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {d.reversed_by && <p className={`${css.basis} ${css.warn}`}><AppIcon name="warning" /><span>{L("Reversed by", "Dibalikkan oleh")} <button type="button" className={css.linkBtn} onClick={() => onOpen(d.reversed_by!.id)}>#{d.reversed_by.id}</button> · {dmy(d.reversed_by.eff)}.</span></p>}
          {d.reverses && <p className={css.basis}><AppIcon name="info" /><span>{L("This entry reverses", "Catatan ini membalikkan")} <button type="button" className={css.linkBtn} onClick={() => onOpen(d.reverses!)}>#{d.reverses}</button>.</span></p>}
          <div className={css.tableWrap}>
            <table className={css.table} aria-label={L("Entry lines", "Baris catatan")}>
              <thead><tr><th>{L("Account", "Akaun")}</th><th className={css.num}>Debit</th><th className={css.num}>{L("Credit", "Kredit")}</th></tr></thead>
              <tbody>{d.lines.map((l, i) => <tr key={i}><td>{l.code} · {l.name}</td><td className={css.num}>{l.debit_cents ? fmtRM(l.debit_cents) : ""}</td><td className={css.num}>{l.credit_cents ? fmtRM(l.credit_cents) : ""}</td></tr>)}</tbody>
              <tfoot><tr><td>{L("Total", "Jumlah")}</td><td className={css.num}>{fmtRM(d.entry.amount_cents)}</td><td className={css.num}>{fmtRM(d.entry.credit_cents)}</td></tr></tfoot>
            </table>
          </div>
          {!d.manual && <p className={css.sub}>{L("Booked by its source record. To correct it, undo or reverse it there (Finance > Transactions), so the cash book and the books stay in step.", "Direkod oleh rekod sumbernya. Untuk membetulkannya, batalkan atau balikkan di sana (Kewangan > Transaksi), supaya buku tunai dan buku akaun kekal sepadan.")}</p>}
        </div>
      )}
    </SideDrawer>
  );
}

/* ============================ an account's ledger ============================ */

interface LedgerResp { account: GlAccount & { normal: Normal }; period: { from: string | null; to: string }; opening_cents: number; closing_cents: number; debit_cents: number; credit_cents: number; lines: { line_id: number; entry_id: number; ref: string; memo: string; eff: string; source: Source; debit_cents: number; credit_cents: number; balance_cents: number }[]; total: number; page: number }
function AccountLedger({ accountId, from, to, onOpen }: { accountId: number; from: string; to: string; onOpen: (id: number) => void }) {
  const [page, setPage] = useState(0);
  const key = `${accountId}|${from}|${to}|${page}`;
  const [got, setGot] = useState<{ key: string; d: LedgerResp | null; error: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const [acc, f, t, p] = key.split("|");
    const q = new URLSearchParams({ account_id: acc!, page: p!, ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) });
    void api<LedgerResp>(`/gl/ledger?${q.toString()}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ key, d: r.ok && r.data ? r.data : null, error: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [key]);
  const mine = got?.key === key ? got : null;
  const d = mine?.d;
  if (mine?.error) return <p role="alert" className={css.error}>{mine.error}</p>;
  if (!d) return <SkelRows rows={6} />;
  const n = d.account.normal;
  const csv = () => downloadCsv(`ledger-${d.account.code}`, [["Date (money moved)", "Entry", "Reference", "Memo", "Source", "Debit (RM)", "Credit (RM)", `Balance (${n === "debit" ? "Dr" : "Cr"} RM)`], ...d.lines.map((l) => [l.eff, l.entry_id, l.ref, l.memo, l.source, (l.debit_cents / 100).toFixed(2), (l.credit_cents / 100).toFixed(2), (l.balance_cents / 100).toFixed(2)])]);
  return (
    <div className={css.drawerBody}>
      <dl className={css.facts}>
        <div><dt>{L("Opening", "Pembukaan")}{d.period.from ? ` (${dmy(d.period.from)})` : ""}</dt><dd>{sided(d.opening_cents, n)}</dd></div>
        <div><dt>{L("Debits / credits", "Debit / kredit")}</dt><dd>{fmtRM(d.debit_cents)} / {fmtRM(d.credit_cents)}</dd></div>
        <div><dt>{L("Closing", "Penutup")} ({dmy(d.period.to)})</dt><dd><strong>{sided(d.closing_cents, n)}</strong></dd></div>
      </dl>
      {d.lines.length === 0 ? <p className={css.empty}>{L("No lines in this range.", "Tiada baris dalam julat ini.")}</p> : (
        <div className={css.tableWrap}>
          <table className={`${css.table} ${css.click}`} aria-label={L("Account ledger", "Lejar akaun")}>
            <thead><tr><th>{L("Date", "Tarikh")}</th><th>{L("Entry", "Catatan")}</th><th className={css.num}>Debit</th><th className={css.num}>{L("Credit", "Kredit")}</th><th className={css.num}>{L("Balance", "Baki")}</th></tr></thead>
            <tbody>{d.lines.map((l) => <tr key={l.line_id} onClick={() => onOpen(l.entry_id)}><td className={css.nowrap}>{dmy(l.eff)}</td><td><span className={css.memo}>{l.memo || sourceWord(l.source)}</span><span className={css.refLine}>#{l.entry_id}{l.ref ? ` · ${l.ref}` : ""}</span></td><td className={css.num}>{l.debit_cents ? fmtRM(l.debit_cents) : ""}</td><td className={css.num}>{l.credit_cents ? fmtRM(l.credit_cents) : ""}</td><td className={css.num}>{sided(l.balance_cents, n)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div className={css.pager}>
        <span>{d.total} {L("lines", "baris")} · {L("page", "halaman")} {page + 1} / {Math.max(1, Math.ceil(d.total / 50))}</span>
        <div className={css.pagerBtns}>
          <button type="button" className={btnSm} onClick={csv} disabled={!d.lines.length}><AppIcon name="download" />CSV</button>
          <button type="button" className={btnSm} aria-label={L("Previous page", "Halaman sebelumnya")} disabled={page === 0} onClick={() => setPage((p) => p - 1)}><AppIcon name="previous" /></button>
          <button type="button" className={btnSm} aria-label={L("Next page", "Halaman seterusnya")} disabled={(page + 1) * 50 >= d.total} onClick={() => setPage((p) => p + 1)}><AppIcon name="next" /></button>
        </div>
      </div>
    </div>
  );
}

function NewAccountDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(""), [name, setName] = useState(""), [type, setType] = useState<AccType>("expense");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    const r = await api(`/gl/accounts`, { method: "POST", body: JSON.stringify({ code: code.trim(), name: name.trim(), type }) });
    setBusy(false);
    if (r.ok) onSaved(); else setError(message(r));
  };
  return (
    <SideDrawer open onClose={onClose} title={L("New account", "Akaun baharu")} subtitle={L("Added to the chart; it starts with no lines.", "Ditambah ke carta; ia bermula tanpa baris.")}>
      <fieldset className={css.form} disabled={busy}>
        <label>{L("Code (4 digits)", "Kod (4 digit)")}<input className={inputClass} inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
        <label>{L("Name", "Nama")}<input className={inputClass} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>{L("Type", "Jenis")}<select className={inputClass} value={type} onChange={(e) => setType(e.target.value as AccType)}>{TYPES.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
        <div className={css.formRow}><button type="button" className={btnClass} disabled={!/^\d{4}$/.test(code) || !name.trim()} onClick={() => void save()}><AppIcon name="save" />{L("Add account", "Tambah akaun")}</button></div>
        {error && <p role="alert" className={css.error}>{error}</p>}
      </fieldset>
    </SideDrawer>
  );
}

/* ============================ Financial reports ============================ */

interface PnlRow { id: number; code: string; name: string; cents: number; prev_cents: number }
interface Pnl { basis: "cash"; period: { from: string; to: string }; previous: { from: string; to: string }; income: PnlRow[]; expense: PnlRow[]; totals: { income_cents: number; expense_cents: number; net_cents: number; prev_income_cents: number; prev_expense_cents: number; prev_net_cents: number } }
interface Trial { as_of: string; accounts: GlAccount[]; debit_cents: number; credit_cents: number; balanced: boolean; difference_cents: number }
const ENTITIES = "AZ ONE OFFICIAL · A2Z CREATIVE MARKETING";

function Reports({ month, accounts, onOpen, active }: { month: string; accounts: GlAccount[]; onOpen: (id: number) => void; active: boolean }) {
  const [rep, setRep] = useState<"trial" | "pnl" | "ledger" | "balance">("trial");
  const today = mytToday();
  const from = `${month}-01`, to = monthLast(month) > today ? today : monthLast(month);
  const key = `${rep}|${from}|${to}`;
  const [trial, setTrial] = useState<{ key: string; d: Trial | null; e: string } | null>(null);
  const [pnl, setPnl] = useState<{ key: string; d: Pnl | null; e: string } | null>(null);
  const [acc, setAcc] = useState<number>(0);
  useEffect(() => {
    const c = new AbortController();
    const [r, f, t] = key.split("|");
    if (r === "trial") void api<Trial>(`/gl/trial-balance?as_of=${t}`, { signal: c.signal }).then((x) => { if (!c.signal.aborted) setTrial({ key, d: x.ok && x.data ? x.data : null, e: x.ok ? "" : message(x) }); });
    if (r === "pnl") void api<Pnl>(`/gl/pnl?from=${f}&to=${t}`, { signal: c.signal }).then((x) => { if (!c.signal.aborted) setPnl({ key, d: x.ok && x.data ? x.data : null, e: x.ok ? "" : message(x) }); });
    return () => c.abort();
  }, [key]);
  const t = trial?.key === key ? trial : null, p = pnl?.key === key ? pnl : null;
  const tabs: [typeof rep, string][] = [["trial", L("Trial balance", "Imbangan duga")], ["pnl", L("Profit & Loss", "Untung & Rugi")], ["ledger", L("General ledger", "Lejar am")], ["balance", L("Balance sheet", "Kunci kira-kira")]];
  const change = (now: number, prev: number) => (prev === 0 ? "" : `${now >= prev ? "+" : "−"}${Math.abs(Math.round(((now - prev) / Math.abs(prev)) * 100))}%`);
  const shown = (t?.d?.accounts ?? []).filter((a) => (a.balance_cents ?? 0) !== 0);
  const drTotal = shown.reduce((s, a) => s + (onDebit(a) ? Math.abs(a.balance_cents ?? 0) : 0), 0);
  const crTotal = shown.reduce((s, a) => s + (!onDebit(a) ? Math.abs(a.balance_cents ?? 0) : 0), 0);
  const csvTrial = () => t?.d && downloadCsv(`trial-balance-${t.d.as_of}`, [["Code", "Account", "Type", "Debit (RM)", "Credit (RM)"], ...shown.map((a) => [a.code, a.name, a.type, onDebit(a) ? (Math.abs(a.balance_cents ?? 0) / 100).toFixed(2) : "", !onDebit(a) ? (Math.abs(a.balance_cents ?? 0) / 100).toFixed(2) : ""])]);
  const csvPnl = () => p?.d && downloadCsv(`profit-and-loss-${p.d.period.from}-${p.d.period.to}`, [["Section", "Code", "Account", `${p.d.period.from} to ${p.d.period.to} (RM)`, `${p.d.previous.from} to ${p.d.previous.to} (RM)`], ...p.d.income.map((r) => ["Income", r.code, r.name, (r.cents / 100).toFixed(2), (r.prev_cents / 100).toFixed(2)]), ...p.d.expense.map((r) => ["Expense", r.code, r.name, (r.cents / 100).toFixed(2), (r.prev_cents / 100).toFixed(2)]), ["Net (cash basis)", "", "", (p.d.totals.net_cents / 100).toFixed(2), (p.d.totals.prev_net_cents / 100).toFixed(2)]]);
  return (
    <div className={card}>
      <div className={`${css.head} ${css.noPrint}`}>
        <div className={css.pills} role="tablist" aria-label={L("Reports", "Laporan")}>{tabs.map(([k, w]) => <button key={k} type="button" role="tab" aria-selected={rep === k} className={css.pill} onClick={() => setRep(k)}>{w}</button>)}</div>
        <div className={css.headTools}>
          {rep === "trial" && <button type="button" className={btnSm} onClick={csvTrial} disabled={!t?.d}><AppIcon name="download" />CSV</button>}
          {rep === "pnl" && <button type="button" className={btnSm} onClick={csvPnl} disabled={!p?.d}><AppIcon name="download" />CSV</button>}
          {(rep === "trial" || rep === "pnl") && <button type="button" className={btnSm} onClick={() => window.print()}><AppIcon name="print" />{L("Print / PDF", "Cetak / PDF")}</button>}
        </div>
      </div>
      {/* printing shows only the report - and only while this tab is the one open */}
      <div className={active ? css.printArea : undefined}>
        {rep === "trial" && (t?.e ? <p role="alert" className={css.error}>{t.e}</p> : !t?.d ? <SkelRows rows={8} /> : (
          <>
            <div className={css.reportHead}><p className={css.co}>{ENTITIES}</p><p className={css.title}>{L("Trial balance", "Imbangan duga")}</p><p className={css.sub}>{L(`As at ${dmy(t.d.as_of)} · cash basis · one ledger for both companies`, `Pada ${dmy(t.d.as_of)} · asas tunai · satu lejar untuk kedua-dua syarikat`)}</p></div>
            {shown.length === 0 ? <p className={css.empty}>{L("Nothing booked by this date.", "Tiada direkod pada tarikh ini.")}</p> : (
              <div className={css.tableWrap}>
                <table className={css.table} aria-label={L("Trial balance report", "Laporan imbangan duga")}>
                  <thead><tr><th>{L("Code", "Kod")}</th><th>{L("Account", "Akaun")}</th><th className={css.num}>Debit (RM)</th><th className={css.num}>{L("Credit (RM)", "Kredit (RM)")}</th></tr></thead>
                  <tbody>{shown.map((a) => <tr key={a.id}><td className={css.nowrap}>{a.code}</td><td>{a.name}</td><td className={css.num}>{onDebit(a) ? fmtRM(Math.abs(a.balance_cents ?? 0)) : "—"}</td><td className={css.num}>{!onDebit(a) ? fmtRM(Math.abs(a.balance_cents ?? 0)) : "—"}</td></tr>)}</tbody>
                  <tfoot><tr><td colSpan={2}>{L("Total", "Jumlah")}{drTotal !== crTotal ? ` · ${L("OUT OF BALANCE", "TIDAK SEIMBANG")}` : ""}</td><td className={css.num}>{fmtRM(drTotal)}</td><td className={css.num}>{fmtRM(crTotal)}</td></tr></tfoot>
                </table>
              </div>
            )}
            <p className={css.sub}>{L("Each account's balance on the side it falls, dated by when the money moved (a manual entry by its own date).", "Baki setiap akaun pada sisinya, bertarikh apabila wang bergerak (catatan manual mengikut tarikhnya).")}</p>
          </>
        ))}
        {rep === "pnl" && (p?.e ? <p role="alert" className={css.error}>{p.e}</p> : !p?.d ? <SkelRows rows={8} /> : (
          <>
            <div className={css.reportHead}><p className={css.co}>{ENTITIES}</p><p className={css.title}>{L("Profit & Loss - cash basis", "Untung & Rugi - asas tunai")}</p><p className={css.sub}>{dmy(p.d.period.from)} – {dmy(p.d.period.to)} · {L("compared with", "berbanding")} {dmy(p.d.previous.from)} – {dmy(p.d.previous.to)}</p></div>
            <div className={css.tableWrap}>
              <table className={css.table} aria-label={L("Profit and loss", "Untung dan rugi")}>
                <thead><tr><th>{L("Account", "Akaun")}</th><th className={css.num}>{L("This period", "Tempoh ini")}</th><th className={css.num}>{L("Previous", "Sebelumnya")}</th><th className={css.num}>{L("Change", "Perubahan")}</th></tr></thead>
                <tbody>
                  <tr className={css.sectionRow}><td colSpan={4}>{L("Income", "Pendapatan")}</td></tr>
                  {p.d.income.length === 0 && <tr><td colSpan={4} className={css.muted}>{L("No income booked.", "Tiada pendapatan direkod.")}</td></tr>}
                  {p.d.income.map((r) => <tr key={r.id}><td>{r.code} · {r.name}</td><td className={css.num}>{fmtRM(r.cents)}</td><td className={css.num}>{fmtRM(r.prev_cents)}</td><td className={`${css.num} ${r.cents >= r.prev_cents ? css.up : css.down}`}>{change(r.cents, r.prev_cents)}</td></tr>)}
                  <tr><td><strong>{L("Total income", "Jumlah pendapatan")}</strong></td><td className={css.num}><strong>{fmtRM(p.d.totals.income_cents)}</strong></td><td className={css.num}>{fmtRM(p.d.totals.prev_income_cents)}</td><td className={css.num}>{change(p.d.totals.income_cents, p.d.totals.prev_income_cents)}</td></tr>
                  <tr className={css.sectionRow}><td colSpan={4}>{L("Expenses", "Perbelanjaan")}</td></tr>
                  {p.d.expense.length === 0 && <tr><td colSpan={4} className={css.muted}>{L("No expense booked.", "Tiada perbelanjaan direkod.")}</td></tr>}
                  {p.d.expense.map((r) => <tr key={r.id}><td>{r.code} · {r.name}</td><td className={css.num}>{fmtRM(r.cents)}</td><td className={css.num}>{fmtRM(r.prev_cents)}</td><td className={`${css.num} ${r.cents <= r.prev_cents ? css.up : css.down}`}>{change(r.cents, r.prev_cents)}</td></tr>)}
                  <tr><td><strong>{L("Total expenses", "Jumlah perbelanjaan")}</strong></td><td className={css.num}><strong>{fmtRM(p.d.totals.expense_cents)}</strong></td><td className={css.num}>{fmtRM(p.d.totals.prev_expense_cents)}</td><td className={css.num}>{change(p.d.totals.expense_cents, p.d.totals.prev_expense_cents)}</td></tr>
                </tbody>
                <tfoot><tr><td>{L("Net (cash basis)", "Bersih (asas tunai)")}</td><td className={`${css.num} ${p.d.totals.net_cents >= 0 ? css.up : css.down}`}>{fmtRM(p.d.totals.net_cents)}</td><td className={css.num}>{fmtRM(p.d.totals.prev_net_cents)}</td><td /></tr></tfoot>
              </table>
            </div>
            <p className={css.sub}>{L("From the ledger's income and expense accounts, on the day the money moved. Finance > Expenses shows a P&L by expense date and payroll month; the two differ by timing, not by records.", "Daripada akaun pendapatan dan perbelanjaan lejar, pada hari wang bergerak. Kewangan > Perbelanjaan menunjukkan U&R mengikut tarikh perbelanjaan dan bulan gaji; perbezaannya masa, bukan rekod.")}</p>
          </>
        ))}
      </div>
      {rep === "ledger" && (
        <div className={css.drawerBody}>
          <label className={css.form}><span className={fieldLabel}>{L("Account", "Akaun")}</span>
            <select aria-label={L("Ledger account", "Akaun lejar")} className={inputClass} value={acc} onChange={(e) => setAcc(Number(e.target.value))}>
              <option value={0}>{L("Choose an account…", "Pilih akaun…")}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select></label>
          {acc ? <AccountLedger accountId={acc} from={from} to={to} onOpen={onOpen} /> : <p className={css.empty}>{L(`Every line of one account for ${monthWord(month)}, with its running balance.`, `Setiap baris satu akaun untuk ${monthWord(month)}, dengan baki berjalan.`)}</p>}
        </div>
      )}
      {rep === "balance" && (
        <div className={css.gap} role="note" aria-label={L("Balance sheet not supported", "Kunci kira-kira tidak disokong")}>
          <strong>{L("A balance sheet is not drawn - the ledger cannot support one yet.", "Kunci kira-kira tidak dilukis - lejar belum boleh menyokongnya.")}</strong>
          <ul>
            <li>{L("No opening balances are posted: Bank - operating starts at zero on the first movement the portal booked, so it is not your bank balance.", "Tiada baki pembukaan diposkan: Bank - operasi bermula sifar pada pergerakan pertama, jadi ia bukan baki bank anda.")}</li>
            <li>{L("No equity is posted (3000 Owner equity is unused).", "Tiada ekuiti diposkan (3000 Ekuiti pemilik tidak digunakan).")}</li>
            <li>{L("Receivables and payables are not posted - the books are cash basis. Who owes what is under Month-End & Audit > Position, read from the invoices and bills themselves.", "Penghutang dan pemiutang tidak diposkan - buku asas tunai. Siapa berhutang ada di Hujung Bulan & Audit > Kedudukan, daripada invois dan bil sendiri.")}</li>
            <li>{L("Both companies share one ledger; a balance sheet belongs to one company.", "Kedua-dua syarikat berkongsi satu lejar; kunci kira-kira milik satu syarikat.")}</li>
          </ul>
          <p className={css.sub}>{L("What it would take: opening balances from the bank statements as at a start date, entered as journal entries you approve. Nothing is estimated here.", "Yang diperlukan: baki pembukaan daripada penyata bank pada tarikh mula, dimasukkan sebagai catatan jurnal yang anda luluskan. Tiada anggaran di sini.")}</p>
        </div>
      )}
    </div>
  );
}

/* ============================ Month-End & Audit ============================ */

const CHECK_WORDS: Record<Check["key"], [string, string]> = {
  balanced: ["Trial balance is in balance", "Imbangan duga seimbang"],
  posting: ["Every entry is whole, posted once, and every cash movement is in the books", "Setiap catatan lengkap, diposkan sekali, dan setiap pergerakan tunai ada dalam buku"],
  reconciliation: ["Finance reconciliation is clear for the month", "Penyelarasan Kewangan bersih untuk bulan ini"],
  payroll: ["Payroll is paid and booked as calculated", "Gaji dibayar dan direkod seperti dikira"],
  part_payments: ["Part payments still outside the books", "Bayaran separa masih di luar buku"],
  ownership: ["Money records reviewed for their company", "Rekod wang disemak untuk syarikatnya"],
};
const KIND_WORDS: Record<string, [string, string]> = {
  unverified: ["not confirmed by the CEO/COO", "belum disahkan CEO/COO"], no_bank: ["no bank account", "tiada akaun bank"], no_reference: ["no payment reference", "tiada rujukan bayaran"],
  out_of_step: ["out of step with its record", "tidak sepadan dengan rekodnya"], duplicate: ["possible duplicate", "kemungkinan pendua"], elfia_cancelled: ["ELFIA order cancelled", "pesanan ELFIA dibatalkan"], not_booked: ["not booked", "belum direkod"],
};
function checkDetail(c: Check): string {
  const d = c.detail as { debit_cents: number; credit_cents: number; difference_cents: number; unbalanced: number; duplicates: number; unjournaled: number; readable: boolean; total: number; by_kind: Record<string, number>; count: number; cents: number; unassigned: number };
  switch (c.key) {
    case "balanced": return `Dr ${fmtRM(d.debit_cents)} · Cr ${fmtRM(d.credit_cents)}${d.difference_cents ? ` · ${L("out by", "beza")} ${fmtRM(Math.abs(d.difference_cents))}` : ""}`;
    case "posting": return L(`${d.unbalanced} half-written or unbalanced · ${d.duplicates} posted twice · ${d.unjournaled} movement(s) this month without an entry`, `${d.unbalanced} tidak seimbang · ${d.duplicates} diposkan dua kali · ${d.unjournaled} pergerakan tanpa catatan`);
    case "reconciliation": return !d.readable ? L("Finance could not be read.", "Kewangan tidak dapat dibaca.") : d.total === 0 ? L("Nothing open in Finance > Reconciliation.", "Tiada perkara terbuka dalam Kewangan > Penyelarasan.") : `${d.total} ${L("open in Finance > Reconciliation", "terbuka dalam Kewangan > Penyelarasan")}: ${Object.entries(d.by_kind ?? {}).map(([k, n]) => `${n} ${KIND_WORDS[k] ? L(KIND_WORDS[k][0], KIND_WORDS[k][1]) : k}`).join(" · ")}`;
    case "payroll": {
      const p = c.detail as unknown as { saved: number; paid: boolean; drift: { booked_cents: number; payroll_cents: number } | null };
      return p.saved === 0 ? L("No payroll saved for this month.", "Tiada gaji disimpan untuk bulan ini.") : !p.paid ? L(`${p.saved} payroll line(s) saved; the bank run is not marked done yet.`, `${p.saved} baris gaji; bayaran bank belum ditanda selesai.`) : p.drift ? L(`Booked ${fmtRM(p.drift.booked_cents)} but payroll now says ${fmtRM(p.drift.payroll_cents)}.`, `Direkod ${fmtRM(p.drift.booked_cents)} tetapi gaji kini ${fmtRM(p.drift.payroll_cents)}.`) : L("Paid, and the books match payroll.", "Dibayar, dan buku sepadan dengan gaji.");
    }
    case "part_payments": return d.count ? L(`${d.count} received this month, ${fmtRM(d.cents)}, on invoices not yet paid in full - they enter the books when the invoice is paid.`, `${d.count} diterima, ${fmtRM(d.cents)}, pada invois belum dibayar penuh.`) : L("None.", "Tiada.");
    case "ownership": return !d.readable ? L("Company review not available on this database.", "Semakan syarikat tiada.") : d.unassigned ? L(`${d.unassigned} expense, cash and bank records have no company decision yet (Companies > Ownership Review).`, `${d.unassigned} rekod belum ada keputusan syarikat (Syarikat > Semakan Pemilikan).`) : L("All reviewed.", "Semua disemak.");
  }
}

function MonthEndView({ month, onOpen }: { month: string; onOpen: (id: number) => void }) {
  const [got, setGot] = useState<{ m: string; d: MonthEnd | null; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<MonthEnd>(`/gl/month-end?month=${month}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ m: month, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [month]);
  const mine = got?.m === month ? got : null;
  const d = mine?.d;
  if (mine?.e) return <div className={card}><p role="alert" className={css.error}>{mine.e}</p></div>;
  if (!d) return <div className={card}><SkelRows rows={8} /></div>;
  const block = d.checks.filter((c) => c.level === "block"), warn = d.checks.filter((c) => c.level === "warn");
  const step1 = block.every((c) => c.ok), step2 = step1 && warn.every((c) => c.ok), closed = Boolean(d.close);
  const steps: [string, string, boolean, boolean][] = [
    [L("Review balances", "Semak baki"), step1 ? L("Completed", "Selesai") : L("Needs attention", "Perlu perhatian"), step1, !step1],
    [L("Check exceptions", "Semak pengecualian"), step2 ? L("Completed", "Selesai") : L(`${warn.filter((c) => !c.ok).length} to look at`, `${warn.filter((c) => !c.ok).length} untuk disemak`), step2, step1 && !step2],
    [L("Final review", "Semakan akhir"), closed ? L("Completed", "Selesai") : d.ended ? L("Yours to do", "Tugas anda") : L("After the month ends", "Selepas bulan tamat"), closed, step2 && !closed],
    [L("Close month", "Tutup bulan"), closed ? L(`Closed ${dmyMYT(d.close!.closed_at)}`, `Ditutup ${dmyMYT(d.close!.closed_at)}`) : L("Below, under Month end", "Di bawah, di Hujung bulan"), closed, false],
  ];
  return (
    <>
      <div className={card}>
        <ol className={css.steps} aria-label={L("Month-end steps", "Langkah hujung bulan")}>
          {steps.map(([t, s, done, now], i) => <li key={t} className={done ? css.stepDone : now ? css.stepNow : undefined}><span className={css.stepNo}>{done ? "✓" : i + 1}</span><span>{t}</span><span className={done ? chipSuccess : now ? chipInfo : chipNeutral}>{s}</span></li>)}
        </ol>
      </div>
      <div className={css.two}>
        <div className={card}>
          <div className={css.head}><h3>{L(`Closing checklist (${monthWord(d.month)})`, `Senarai semak penutupan (${monthWord(d.month)})`)}</h3><p className={css.sub}>{L(`In ${fmtRM(d.figures.in_cents)} · out ${fmtRM(d.figures.out_cents)} · ${d.figures.entries} entries`, `Masuk ${fmtRM(d.figures.in_cents)} · keluar ${fmtRM(d.figures.out_cents)} · ${d.figures.entries} catatan`)}</p></div>
          <ul className={css.checks} aria-label={L("Closing checklist", "Senarai semak penutupan")}>
            {d.checks.map((c) => (
              <li key={c.key} className={c.ok ? css.ok : c.level === "block" ? css.bad : c.level === "warn" ? css.look : css.info}>
                <AppIcon name={c.ok ? "success" : c.level === "info" ? "info" : "warning"} />
                <span className={css.checkText}><strong>{L(CHECK_WORDS[c.key][0], CHECK_WORDS[c.key][1])}</strong><span>{checkDetail(c)}</span></span>
                <span className={c.ok ? chipSuccess : c.level === "block" ? chipWarn : c.level === "warn" ? chipGold : chipNeutral}>{c.ok ? L("OK", "OK") : c.level === "block" ? L("Fix first", "Betulkan dahulu") : c.level === "warn" ? L("Look", "Semak") : L("Note", "Nota")}</span>
              </li>
            ))}
          </ul>
          <p className={css.sub}>{L("Closing keeps a copy of the month's figures, the ledger's included. Nothing is locked: a manual entry dated in a closed month asks why, and is listed as a post-close adjustment.", "Menutup menyimpan salinan angka bulan, termasuk lejar. Tiada dikunci: catatan manual bertarikh dalam bulan ditutup memerlukan sebab, dan disenaraikan sebagai pelarasan selepas tutup.")}</p>
        </div>
        <div className={card}>
          <div className={css.head}><h3>{L("Post-close adjustments", "Pelarasan selepas tutup")}</h3><p className={css.sub}>{closed ? L(`Entries belonging to ${monthWord(d.month)} posted after it closed.`, `Catatan milik ${monthWord(d.month)} yang diposkan selepas ditutup.`) : L("Listed once the month is closed.", "Disenaraikan selepas bulan ditutup.")}</p></div>
          {!closed ? <p className={css.empty}>{L("This month is not closed.", "Bulan ini belum ditutup.")}</p> : d.adjustments.length === 0 ? <p className={css.empty}>{L("None - the month is as it was closed.", "Tiada - bulan kekal seperti ditutup.")}</p> : (
            <ul className={css.checks} aria-label={L("Post-close adjustments", "Pelarasan selepas tutup")}>
              {d.adjustments.map((a) => <li key={a.id} className={css.look}><AppIcon name="edit" /><span className={css.checkText}><button type="button" className={css.linkBtn} onClick={() => onOpen(a.id)}>#{a.id} {a.memo || a.ref}</button><span>{dmy(a.eff)} · {L("posted", "diposkan")} {dmyMYT(a.created_at)} · {a.who ?? "-"}{a.reason ? ` · ${a.reason}` : ""}</span></span><strong className={css.nowrap}>{fmtRM(a.amount_cents)}</strong></li>)}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

/* ============================ the page ============================ */

type View = "overview" | "ledger" | "reports" | "close";

export function AccountingPanel() {
  const today = mytToday();
  const [view, setView] = useState<View>("overview");
  const [seen, setSeen] = useState<Record<View, boolean>>({ overview: true, ledger: false, reports: false, close: false });
  const open = (v: View) => { setView(v); setSeen((s) => ({ ...s, [v]: true })); };
  const [month, setMonth] = useState(today.slice(0, 7));
  const [closeMonth, setCloseMonth] = useState(shiftMonth(today.slice(0, 7), -1));
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const [entry, setEntry] = useState<number | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();

  /* the chart of accounts and its all-time trial balance (the existing reads) */
  const [chart, setChart] = useState<{ rev: number; accounts: GlAccount[]; trial: GlAccount[]; pending: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const a = await api<{ accounts: GlAccount[]; pending_migration?: boolean }>(`/gl/accounts`);
      const t = await api<{ accounts: GlAccount[] }>(`/gl/trial-balance`);
      if (live) setChart({ rev: revision, accounts: a.data?.accounts ?? [], trial: t.data?.accounts ?? [], pending: a.data?.pending_migration === true });
    })();
    return () => { live = false; };
  }, [revision]);

  /* the overview for the chosen month */
  const ovKey = `${month}|${revision}`;
  const [ov, setOv] = useState<{ key: string; d: Overview | null; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const m = ovKey.split("|")[0]!;
    const to = monthLast(m) > mytToday() ? mytToday() : monthLast(m);
    void api<Overview>(`/gl/overview?from=${m}-01&to=${to}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setOv({ key: ovKey, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [ovKey]);
  const o = ov?.key === ovKey ? ov.d : null;
  const ovError = ov?.key === ovKey ? ov.e : "";

  /* the journal list */
  const [jq, setJq] = useState(""), [jqApplied, setJqApplied] = useState(""), [jsrc, setJsrc] = useState(""), [jfrom, setJfrom] = useState(""), [jto, setJto] = useState(""), [jpage, setJpage] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setJqApplied(jq.trim()); setJpage(0); }, 300); return () => clearTimeout(t); }, [jq]);
  const jParams = new URLSearchParams({ page: String(jpage), ...(jqApplied ? { q: jqApplied } : {}), ...(jsrc ? { source: jsrc } : {}), ...(jfrom ? { from: jfrom } : {}), ...(jto ? { to: jto } : {}) }).toString();
  const jKey = `${jParams}#${revision}`;
  const [jl, setJl] = useState<{ key: string; rows: Brief[] | null; total: number; e: string } | null>(null);
  useEffect(() => {
    if (!seen.ledger) return;
    const c = new AbortController();
    void api<{ entries: Brief[]; total: number }>(`/gl/journal?${jKey.split("#")[0]}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setJl({ key: jKey, rows: r.ok && r.data ? r.data.entries : null, total: r.data?.total ?? 0, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [seen.ledger, jKey]);
  const jlist = jl?.key === jKey ? jl : null;

  /* chart of accounts filters */
  const [aq, setAq] = useState(""), [atype, setAtype] = useState<"" | AccType>("");
  const [accOpen, setAccOpen] = useState<GlAccount | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => (chart?.trial ?? []).map((a) => ({ ...a, normal: normalOf(a.type), balance_cents: normalOf(a.type) === "debit" ? (a.debit_cents ?? 0) - (a.credit_cents ?? 0) : (a.credit_cents ?? 0) - (a.debit_cents ?? 0) }))
    .filter((a) => (!atype || a.type === atype) && (!aq.trim() || `${a.code} ${a.name} ${a.type}`.toLowerCase().includes(aq.trim().toLowerCase()))), [chart, aq, atype]);
  const csvChart = () => downloadCsv("chart-of-accounts", [["Code", "Account", "Type", "Debit (RM)", "Credit (RM)", "Balance (RM)", "Side"], ...rows.map((a) => [a.code, a.name, a.type, ((a.debit_cents ?? 0) / 100).toFixed(2), ((a.credit_cents ?? 0) / 100).toFixed(2), (Math.abs(a.balance_cents) / 100).toFixed(2), a.balance_cents === 0 ? "" : (a.balance_cents > 0) === (a.normal === "debit") ? "Dr" : "Cr"])]);

  const tabs: [View, string][] = [["overview", L("Overview", "Gambaran")], ["ledger", L("General Ledger", "Lejar Am")], ["reports", L("Financial Reports", "Laporan Kewangan")], ["close", L("Month-End & Audit", "Hujung Bulan & Audit")]];
  const months = Array.from({ length: 12 }, (_, k) => shiftMonth(today.slice(0, 7), -k));
  const exceptions = o ? o.exceptions.unbalanced.length + o.exceptions.duplicates.length + o.exceptions.unjournaled.length + o.exceptions.payroll_drift.length : 0;

  return (
    <TabPage className={css.page}>
      {toastNode}
      <LineTabs value={view} onChange={open} tabs={tabs} label={L("Accounting", "Perakaunan")}
        aside={view === "overview" || view === "reports" ? (
          <TabAside>
            <span className={css.periodPick}><AppIcon name="date" />
              <select aria-label={L("Period", "Tempoh")} value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthWord(m)}</option>)}</select>
            </span>
          </TabAside>
        ) : view === "close" ? (
          <TabAside>
            <span className={css.periodPick}><AppIcon name="date" />
              <select aria-label={L("Month to close", "Bulan untuk ditutup")} value={closeMonth} onChange={(e) => setCloseMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthWord(m)}</option>)}</select>
            </span>
          </TabAside>
        ) : undefined} />
      {chart?.pending && <p className={`${css.basis} ${css.warn}`}><AppIcon name="warning" /><span>{L("The ERP tables are not migrated yet — run PUSH.bat so the migrations apply, then reload.", "Jadual ERP belum dimigrasi — jalankan PUSH.bat supaya migrasi digunakan, kemudian muat semula.")}</span></p>}

      {/* ================= Overview ================= */}
      <div className={css.body} hidden={view !== "overview"}>
        <p className={css.basis}><AppIcon name="info" /><span><strong>{L("Cash basis.", "Asas tunai.")}</strong> {L("Entries post when money moves, dated the day it moved. Bank - operating is the net of what the portal booked across your bank accounts - not a bank balance: no opening balance has been posted. Both companies share this ledger.", "Catatan diposkan apabila wang bergerak, bertarikh hari ia bergerak. Bank - operasi ialah bersih daripada apa yang portal rekod merentasi akaun bank anda - bukan baki bank: tiada baki pembukaan diposkan. Kedua-dua syarikat berkongsi lejar ini.")}</span></p>
        {ovError && <p role="alert" className={css.error}>{ovError}</p>}
        <TabZone label={L("At a glance", "Sepintas lalu")}>
          <KpiRow label={L("Accounting at a glance", "Perakaunan sepintas lalu")}>
            <KpiTile icon="balance" tone={!o ? "navy" : o.trial.balanced ? "green" : "red"} busy={!o} label={L("Trial balance", "Imbangan duga")} value={!o ? "" : o.trial.balanced ? L("Balanced", "Seimbang") : L("Out of balance", "Tidak seimbang")} sub={o ? (o.trial.balanced ? `Dr ${fmtRM(o.trial.debit_cents)} = Cr ${fmtRM(o.trial.credit_cents)}` : L(`Out by ${fmtRM(Math.abs(o.trial.difference_cents))}`, `Beza ${fmtRM(Math.abs(o.trial.difference_cents))}`)) : undefined} />
            <KpiTile icon="up" tone="green" busy={!o} label={L("Money in", "Wang masuk")} period={monthWord(month)} value={o ? fmtRM(o.money.in_cents) : ""} sub={L("income accounts", "akaun pendapatan")} />
            <KpiTile icon="down" tone="red" busy={!o} label={L("Money out", "Wang keluar")} period={monthWord(month)} value={o ? fmtRM(o.money.out_cents) : ""} sub={o ? L(`net ${fmtRM(o.money.net_cents)}`, `bersih ${fmtRM(o.money.net_cents)}`) : undefined} />
            <KpiTile icon="warning" tone={exceptions ? "gold" : "blue"} busy={!o} label={L("Posting exceptions", "Pengecualian pengeposan")} value={o ? exceptions : 0} sub={o ? L(`${o.accounts.used} of ${o.accounts.total} accounts in use · ${o.entries} entries`, `${o.accounts.used} daripada ${o.accounts.total} akaun digunakan · ${o.entries} catatan`) : undefined} onClick={() => document.getElementById("acc-exceptions")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
          </KpiRow>
        </TabZone>
        <TabZone label={L("Movement", "Pergerakan")}>
          <div className={css.two}>
            <div className={card}>
              <div className={css.head}><h3>{L("Money in vs money out", "Wang masuk vs wang keluar")}</h3><p className={css.sub}>{L("Six months to", "Enam bulan hingga")} {monthWord(month)}</p></div>
              {o ? <Trend rows={o.trend} /> : <SkelRows rows={6} />}
            </div>
            <div className={card}>
              <div className={css.head}><h3>{L("Top expense accounts", "Akaun perbelanjaan utama")}</h3><p className={css.sub}>{monthWord(month)}</p></div>
              {!o ? <SkelRows rows={5} /> : o.top_expenses.length === 0 ? <p className={css.empty}>{L("No expense booked this month.", "Tiada perbelanjaan direkod bulan ini.")}</p> : (
                <ul className={css.bars} aria-label={L("Top expense accounts", "Akaun perbelanjaan utama")}>
                  {o.top_expenses.slice(0, 6).map((t) => { const total = o.top_expenses.reduce((s, x) => s + x.cents, 0) || 1; const pct = Math.round((t.cents / total) * 100); return (
                    <li key={t.id}><span className={css.barTop}><span>{t.code} · {t.name}</span><strong>{fmtRM(t.cents)}</strong></span><span className={css.track}><span className={css.fill} style={{ width: `${Math.max(2, pct)}%` }} /></span><span className={css.sub}>{pct}%</span></li>
                  ); })}
                </ul>
              )}
              <button type="button" className={css.linkBtn} onClick={() => open("ledger")}>{L("View all accounts", "Lihat semua akaun")} →</button>
            </div>
          </div>
        </TabZone>
        <TabZone label={L("Checks", "Semakan")} id="acc-exceptions">
          <div className={card}>
            <div className={css.head}><h3>{L("Posting exceptions", "Pengecualian pengeposan")}</h3><p className={css.sub}>{L("Read from the ledger and the cash book; nothing here changes a figure.", "Dibaca daripada lejar dan buku tunai; tiada angka diubah di sini.")}</p></div>
            {o ? <ExceptionList x={o.exceptions} onOpen={setEntry} /> : <SkelRows rows={5} />}
          </div>
        </TabZone>
        <TabZone label={L("Recent journal entries", "Catatan jurnal terkini")}>
          <div className={card}>
            {o ? <EntryRows rows={o.recent} onOpen={setEntry} empty={L("No journal entries yet.", "Tiada catatan jurnal lagi.")} /> : <SkelRows rows={6} />}
            <button type="button" className={css.linkBtn} onClick={() => open("ledger")}>{L("View all", "Lihat semua")} →</button>
          </div>
        </TabZone>
      </div>

      {/* ================= General Ledger ================= */}
      <div className={css.body} hidden={view !== "ledger"}>
        <TabZone label={L("Chart of accounts", "Carta akaun")} hint={L("Balances for all time, each on its own side (Dr or Cr). Open an account for its ledger.", "Baki sepanjang masa, setiap satu pada sisinya (Dr atau Cr). Buka akaun untuk lejarnya.")}>
          <div className={card}>
            <div className={css.head}><h3>{L("Trial balance", "Imbangan duga")}</h3>
              <div className={css.headTools}>
                <button type="button" className={btnSmPrimary} onClick={() => setAdding(true)}><AppIcon name="add" />{L("New account", "Akaun baharu")}</button>
                <button type="button" className={btnSm} onClick={csvChart} disabled={!rows.length}><AppIcon name="download" />CSV</button>
              </div>
            </div>
            <div className={css.filters}>
              <label className={css.wide}><span className={fieldLabel}>{L("Search", "Cari")}</span><input type="search" aria-label={L("Search accounts", "Cari akaun")} className={inputClass} placeholder={L("Code, name or type", "Kod, nama atau jenis")} value={aq} onChange={(e) => setAq(e.target.value)} /></label>
              <label><span className={fieldLabel}>{L("Type", "Jenis")}</span><select aria-label={L("Account type", "Jenis akaun")} className={inputClass} value={atype} onChange={(e) => setAtype(e.target.value as "" | AccType)}><option value="">{L("All types", "Semua jenis")}</option>{TYPES.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
            </div>
            {!chart ? <SkelRows rows={8} /> : (
              <div className={css.tableWrap}>
                <table className={`${css.table} ${css.click}`} aria-label={L("Chart of accounts", "Carta akaun")}>
                  <thead><tr><th>{L("Code", "Kod")}</th><th>{L("Account", "Akaun")}</th><th>{L("Type", "Jenis")}</th><th className={css.num}>Debit (RM)</th><th className={css.num}>{L("Credit (RM)", "Kredit (RM)")}</th><th className={css.num}>{L("Balance", "Baki")}</th></tr></thead>
                  <tbody>{rows.map((a) => <tr key={a.id} onClick={() => setAccOpen(a)}><td className={css.nowrap}>{a.code}</td><td>{a.name}</td><td><span className={chipNeutral}>{typeWord(a.type)}</span></td><td className={css.num}>{fmtRM(a.debit_cents ?? 0)}</td><td className={css.num}>{fmtRM(a.credit_cents ?? 0)}</td><td className={css.num}>{sided(a.balance_cents, a.normal)}</td></tr>)}</tbody>
                  <tfoot><tr><td colSpan={3}>{L("Total", "Jumlah")}</td><td className={css.num}>{fmtRM(rows.reduce((s, a) => s + (a.debit_cents ?? 0), 0))}</td><td className={css.num}>{fmtRM(rows.reduce((s, a) => s + (a.credit_cents ?? 0), 0))}</td><td /></tr></tfoot>
                </table>
              </div>
            )}
          </div>
        </TabZone>
        <TabZone label={L("Journal", "Jurnal")} hint={L("Every entry, newest first by the day the money moved. Open one for its lines and its source.", "Setiap catatan, terbaru dahulu mengikut hari wang bergerak. Buka untuk baris dan sumbernya.")}>
          <div className={card}>
            <div className={css.filters}>
              <label className={css.wide}><span className={fieldLabel}>{L("Search", "Cari")}</span><input type="search" aria-label={L("Search journal", "Cari jurnal")} className={inputClass} placeholder={L("Reference, memo or #id", "Rujukan, memo atau #id")} value={jq} onChange={(e) => setJq(e.target.value)} /></label>
              <label><span className={fieldLabel}>{L("Source", "Sumber")}</span><select aria-label={L("Journal source", "Sumber jurnal")} className={inputClass} value={jsrc} onChange={(e) => { setJsrc(e.target.value); setJpage(0); }}><option value="">{L("All sources", "Semua sumber")}</option>{SOURCES.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
              <label><span className={fieldLabel}>{L("From", "Dari")}</span><input type="date" aria-label={L("Journal from", "Jurnal dari")} className={inputClass} value={jfrom} max={jto || undefined} onChange={(e) => { setJfrom(e.target.value); setJpage(0); }} /></label>
              <label><span className={fieldLabel}>{L("To", "Hingga")}</span><input type="date" aria-label={L("Journal to", "Jurnal hingga")} className={inputClass} value={jto} min={jfrom || undefined} onChange={(e) => { setJto(e.target.value); setJpage(0); }} /></label>
            </div>
            {jlist?.e ? <p role="alert" className={css.error}>{jlist.e}</p> : !jlist?.rows ? <SkelRows rows={8} /> : <EntryRows rows={jlist.rows} onOpen={setEntry} empty={L("No entries match.", "Tiada catatan sepadan.")} />}
            {jlist?.rows && <div className={css.pager}><span>{jlist.total} {L("entries", "catatan")} · {L("page", "halaman")} {jpage + 1} / {Math.max(1, Math.ceil(jlist.total / 25))}</span><div className={css.pagerBtns}><button type="button" className={btnSm} aria-label={L("Previous page", "Halaman sebelumnya")} disabled={jpage === 0} onClick={() => setJpage((p) => p - 1)}><AppIcon name="previous" /></button><button type="button" className={btnSm} aria-label={L("Next page", "Halaman seterusnya")} disabled={(jpage + 1) * 25 >= jlist.total} onClick={() => setJpage((p) => p + 1)}><AppIcon name="next" /></button></div></div>}
          </div>
        </TabZone>
        <TabZone label={L("Adjustments", "Pelarasan")}>
          <Composer accounts={chart?.accounts ?? []} onPosted={(id) => { reload(); if (id) setEntry(id); }} />
        </TabZone>
      </div>

      {/* ================= Financial Reports ================= */}
      <div className={css.body} hidden={view !== "reports"}>
        <TabZone label={L("Reports", "Laporan")} hint={L("From the ledger only, cash basis. A statement the ledger cannot support is not drawn.", "Daripada lejar sahaja, asas tunai. Penyata yang tidak disokong lejar tidak dilukis.")}>
          {seen.reports && <Reports key={revision} month={month} accounts={chart?.accounts ?? []} onOpen={setEntry} active={view === "reports"} />}
        </TabZone>
      </div>

      {/* ================= Month-End & Audit ================= */}
      <div className={css.body} hidden={view !== "close"}>
        <TabZone label={L("Month-end closing", "Penutupan hujung bulan")} hint={L("Checks read from the ledger, Finance and Payroll; the close itself is below.", "Semakan dibaca daripada lejar, Kewangan dan Gaji; penutupan di bawah.")}>
          {seen.close && <MonthEndView key={`${closeMonth}|${revision}`} month={closeMonth} onOpen={setEntry} />}
        </TabZone>
        {/* v1.181.15 (ERP roadmap phase 3) - month end, position and the audit
            trail. Reads, plus a snapshot when a month is closed; nothing locks. */}
        <TabZone label={L("Month end", "Hujung bulan")}>
          {seen.close && <BooksPanel />}
        </TabZone>
      </div>

      <EntryDrawer id={entry} onClose={() => setEntry(null)} onOpen={setEntry} onChanged={reload} />
      {accOpen && (
        <SideDrawer open onClose={() => setAccOpen(null)} wide title={`${accOpen.code} · ${accOpen.name}`} subtitle={`${typeWord(accOpen.type)} · ${L("ledger, all time", "lejar, sepanjang masa")}`}>
          <AccountLedger accountId={accOpen.id} from="" to={today} onOpen={(id) => { setAccOpen(null); setEntry(id); }} />
        </SideDrawer>
      )}
      {adding && <NewAccountDrawer onClose={() => setAdding(false)} onSaved={() => { setAdding(false); toast(L("Account added", "Akaun ditambah"), L("It is in the chart, with no lines yet", "Ia dalam carta, belum ada baris")); reload(); }} />}
    </TabPage>
  );
}

/* ============================ Adjustments ============================ */

/* Journal entry — the server refuses unbalanced entries; the button mirrors
   that rule so nobody types a whole entry to be told no. */
interface JournalLineDraft { account_id: string; debit: string; credit: string }
const blankDraft = () => ({ entry_date: "", memo: "", lines: [{ account_id: "", debit: "", credit: "" }, { account_id: "", debit: "", credit: "" }] as JournalLineDraft[] });
function Composer({ accounts, onPosted }: { accounts: GlAccount[]; onPosted: (id: number) => void }) {
  const [draft, setDraft] = useState(blankDraft);
  const [busy, setBusy] = useState(false);
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();
  const totalDebit = draft.lines.reduce((a, l) => a + (l.debit ? Number(l.debit) : 0), 0);
  const totalCredit = draft.lines.reduce((a, l) => a + (l.credit ? Number(l.credit) : 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;
  const setLine = (i: number, patch: Partial<JournalLineDraft>) => setDraft((d) => ({ ...d, lines: d.lines.map((l, x) => (x === i ? { ...l, ...patch } : l)) }));
  const post = async (postCloseReason?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    let retry: string | null = null;
    try {
      const r = await api<{ id?: number; error?: { code?: string; message?: string } }>(`/gl/journal`, {
        method: "POST",
        body: JSON.stringify({
          entry_date: draft.entry_date, memo: draft.memo, ...(postCloseReason ? { post_close_reason: postCloseReason } : {}),
          lines: draft.lines.filter((l) => l.account_id && (l.debit || l.credit)).map((l) => ({ account_id: Number(l.account_id), debit: l.debit ? Number(l.debit) : 0, credit: l.credit ? Number(l.credit) : 0 })),
        }),
      });
      if (r.ok) { setDraft(blankDraft()); toast(L("Saved", "Disimpan"), L("Journal entry posted", "Catatan jurnal diposkan")); onPosted(r.data?.id ?? 0); return; }
      /* v1.222.0 "Soft control": a month that has been closed asks why */
      if (r.status === 409 && r.data?.error?.code === "closed_period" && !postCloseReason) {
        const got = await prompt({ title: L("This month has been closed", "Bulan ini telah ditutup"), message: r.data.error.message ?? "", label: L("Why does this entry belong in it?", "Mengapa catatan ini milik bulan itu?"), required: true, confirmLabel: L("Post as a post-close adjustment", "Pos sebagai pelarasan selepas tutup") });
        if (got) retry = got.value;
        return;
      }
      toast(L("Not posted", "Tidak diposkan"), message(r), "notice");
    } finally { setBusy(false); if (retry) void post(retry); }
  };
  return (
    <div className={card}>
      {promptNode}{toastNode}
      <div className={css.head}><h3>{L("New journal entry", "Catatan jurnal baharu")}</h3><p className={css.sub}>{L("For adjustments only - bank movements post here by themselves. The server refuses an entry whose debits and credits differ.", "Untuk pelarasan sahaja - pergerakan bank diposkan sendiri. Pelayan menolak catatan yang debit dan kreditnya berbeza.")}</p></div>
      <fieldset className={css.form} disabled={busy}>
        <div className={css.lineRow}>
          <label><span className={fieldLabel}>Memo</span><input className={inputClass} placeholder={L("August TikTok payout banked", "Bayaran TikTok Ogos dibankkan")} value={draft.memo} onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))} /></label>
          <label><span className={fieldLabel}>{L("Date", "Tarikh")}</span><input type="date" className={inputClass} value={draft.entry_date} onChange={(e) => setDraft((d) => ({ ...d, entry_date: e.target.value }))} /></label>
        </div>
        {draft.lines.map((l, i) => (
          <div key={i} className={css.lineRow}>
            <label><span className={fieldLabel}>{L("Account", "Akaun")}</span>
              <select className={inputClass} value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select></label>
            <label><span className={fieldLabel}>Debit (RM)</span><input type="number" min="0" step="0.01" className={inputClass} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })} /></label>
            <label><span className={fieldLabel}>{L("Credit (RM)", "Kredit (RM)")}</span><input type="number" min="0" step="0.01" className={inputClass} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })} /></label>
          </div>
        ))}
        <div className={css.formRow}>
          <button type="button" className={btnSm} onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { account_id: "", debit: "", credit: "" }] }))}>{L("+ Line", "+ Baris")}</button>
          <button type="button" className={btnClass} disabled={!draft.entry_date || !balanced} onClick={() => void post()}>{L("Post entry", "Pos catatan")}</button>
          <span className={balanced ? css.balanced : css.unbalanced}>Dr {totalDebit.toFixed(2)} / Cr {totalCredit.toFixed(2)} {balanced ? L("— balanced ✓", "— seimbang ✓") : L("— must match", "— mesti sepadan")}</span>
        </div>
      </fieldset>
    </div>
  );
}

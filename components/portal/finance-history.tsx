"use client";

/* 18-11-2026 - FINANCE HISTORICAL RECOVERY (the CEO: "proceed as per recommend" on
   docs/FINANCE-HISTORY-GATE.md, steps H2-H5). Three views inside Finance > Reconciliation (a
   PillSwitch, never a new tab) and one report:

     History     every receipt since 01-06-2026, by the month it was PAID, this company's;
                 filters month / status / account / kind; 10 a page; a Review drawer. A receipt
                 paid before 01-11-2026 is verified as CASH ONLY (POST /cashbook/cash-verify,
                 the CEO owner, one at a time, a fresh code) - it never writes Confirm paid, so it
                 can never earn commission. A later one points to Confirm paid / verification.
     Unassigned  every movement that belongs to no company (both company views reach it; it is
                 in neither company's total); Assign account is the existing mark, the company
                 comes from the account, never a guess.
     Report      the monthly reconciliation since 01-06-2026, by company and Unassigned, from
                 the same one read - each sen in one line.

   Every figure is the server's GET /staff/erp/cashbook (worker/src/cashbook.ts); nothing here
   computes Money In for itself beyond grouping the server's items. */

import { useEffect, useMemo, useState } from "react";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { PaginationControls, type PageSize } from "@/components/ui/pagination-controls";
import { AppIcon } from "@/components/ui/app-icon";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { withStepUp } from "@/components/portal/page-shared";
import { makeApi } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, card, chipInfo, chipNeutral, chipSuccess, chipWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import fx from "./finance5.module.css";
import hx from "./finance-history.module.css";

const api = makeApi("/staff/erp");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
export const HISTORY_FROM = "2026-06-01";

type Company = "a2z" | "azoo";
export interface HItem {
  key: string; row_id: number | null; date: string; type: "in" | "out"; amount_cents: number; category: string; group: string;
  source: string; status: string; description: string; ref: string; bank_id: number | null; bank_name: string | null;
  counts: "in" | "out" | null; sign: 1 | -1; payment_ref: string | null; company: Company | null; awaiting: boolean;
  historical?: boolean; cash_verified?: boolean; link: { kind: string; id: number | string } | null;
}
interface HBank { id: number; name: string; active: number; company: Company | null }
interface HView {
  items: HItem[]; banks: HBank[]; history_end?: string; can_cash_verify?: boolean; cash_verify_ready?: boolean; can_correct: boolean;
  exceptions: { kind: string; item_key: string }[];
}
const COMPANY: Record<Company, string> = { a2z: "A2Z Creative Marketing", azoo: "AZ ONE Official" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthWord = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
const dmy = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "—");
const isReceipt = (i: HItem) => i.source === "sales" || i.source === "part";
const live = (i: HItem) => i.status !== "reversal" && i.status !== "reversed";

/** one read of everything since 01-06-2026, for one company (or all) */
export function useHistoryRead(company: Company | "all", tick: number) {
  const [v, setV] = useState<HView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api<HView & { error?: { message?: string } }>(`/cashbook?from=${HISTORY_FROM}&to=${mytToday()}&months=12&company=${company}`).then((r) => {
      if (!alive) return;
      if (r.ok && r.data?.items) { setV(r.data); setFailed(null); } else setFailed(r.data?.error?.message ?? L("The history could not be read.", "Sejarah tidak dapat dibaca."));
    });
    return () => { alive = false; };
  }, [company, tick]);
  return { v, failed };
}

/* ------------------------------------------------------------------ *
 * History - the historical verification queue.
 * ------------------------------------------------------------------ */
export function HistoryView({ company, toast, onOpen, onChanged }: { company: Company | "all"; toast: (t: string, s: string, k?: "notice") => void; onOpen: (l: HItem["link"]) => void; onChanged: () => void }) {
  const [tick, setTick] = useState(0);
  const { v, failed } = useHistoryRead(company, tick);
  const [month, setMonth] = useState("");
  const [st, setSt] = useState<"awaiting" | "verified" | "all">("awaiting");
  const [acc, setAcc] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(10);
  const [opened, setOpened] = useState<HItem | null>(null);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { prompt, node: promptNode } = usePrompt();
  const end = v?.history_end ?? "2026-11-01";
  const receipts = useMemo(() => (v?.items ?? []).filter((i) => isReceipt(i) && i.date >= HISTORY_FROM), [v]);
  const months = [...new Set(receipts.map((i) => i.date.slice(0, 7)))].sort().reverse();
  const rows = receipts.filter((i) => (!month || i.date.startsWith(month)) && (st === "all" || (st === "awaiting" ? i.awaiting : !i.awaiting))
    && (!acc || (acc === "none" ? !i.bank_id : String(i.bank_id ?? "") === acc)));
  const pages = Math.max(1, Math.ceil(rows.length / size)), cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * size, cur * size);
  const awaiting = receipts.filter((i) => i.awaiting);
  const verified = receipts.filter((i) => i.counts === "in");
  const noBank = (v?.items ?? []).filter((i) => i.date >= HISTORY_FROM && (i.counts || i.awaiting) && !i.bank_id && live(i)).length;
  const dups = (v?.exceptions ?? []).filter((x) => x.kind === "duplicate").length;
  const reset = () => setPage(1);
  const openOne = (i: HItem) => { setOpened(i); setChecked(false); setNote(""); };
  const reload = () => { setTick((n) => n + 1); onChanged(); };

  const verify = async (i: HItem) => {
    setBusy(true);
    const r = await withStepUp<{ error?: { message?: string } }>((totp) => api(`/cashbook/cash-verify`, { method: "POST", body: JSON.stringify({ key: i.key, checked: true, note: note.trim() || undefined, ...(totp ? { totp } : {}) }) }), prompt,
      { title: L("Verify this receipt", "Sahkan penerimaan ini"), label: L("Your 6-digit authenticator code", "Kod pengesah 6 digit anda") });
    setBusy(false);
    if (r.ok) { toast(L("Receipt verified", "Penerimaan disahkan"), L(`${fmtRM(i.amount_cents)} now counts as Money In for ${monthWord(i.date.slice(0, 7))} - the month it was paid. No commission.`, `${fmtRM(i.amount_cents)} kini dikira Tunai Masuk bagi ${monthWord(i.date.slice(0, 7))} - bulan ia dibayar. Tiada komisen.`)); setOpened(null); reload(); }
    else toast(L("Not verified", "Tidak disahkan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  const takeBack = async (i: HItem) => {
    const r0 = await prompt({ title: L("Take back this verification?", "Tarik balik pengesahan ini?"), message: L(`${i.description}. It returns to awaiting verification; the verification and your reason stay in its history.`, `${i.description}. Ia kembali menunggu pengesahan; pengesahan dan sebab anda kekal dalam sejarahnya.`), label: L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)"), required: true, confirmLabel: L("Take back", "Tarik balik"), variant: "danger" });
    if (!r0) return;
    setBusy(true);
    const r = await withStepUp<{ error?: { message?: string } }>((totp) => api(`/cashbook/cash-verify/revoke`, { method: "POST", body: JSON.stringify({ key: i.key, reason: r0.value, ...(totp ? { totp } : {}) }) }), prompt);
    setBusy(false);
    if (r.ok) { toast(L("Taken back", "Ditarik balik"), L("It waits for verification again", "Ia menunggu pengesahan semula")); setOpened(null); reload(); }
    else toast(L("Not taken back", "Tidak ditarik balik"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };

  if (failed && !v) return <p className={fx.empty}>{failed}</p>;
  if (!v) return <SkelRows rows={6} />;
  const hist = opened ? opened.date < end : false;
  return (
    <div className={fx.stack} data-testid="finance-history">
      {promptNode}
      <KpiRow label={L("Historical receipts", "Penerimaan lampau")} testid="history-figures">
        <KpiTile icon="pending" tone="gold" label={L("Awaiting verification", "Menunggu pengesahan")} value={`${awaiting.length} · ${fmtRM(awaiting.reduce((a, i) => a + i.amount_cents, 0))}`} sub={L(`Since ${dmy(HISTORY_FROM)} · not Money In`, `Sejak ${dmy(HISTORY_FROM)} · bukan Tunai Masuk`)} onClick={() => { setSt("awaiting"); reset(); }} pressed={st === "awaiting"} cell="awaiting" />
        <KpiTile icon="success" tone="green" label={L("Verified receipts", "Penerimaan disahkan")} value={fmtRM(verified.reduce((a, i) => a + i.sign * i.amount_cents, 0))} sub={L("Money In, in the month paid", "Tunai Masuk, pada bulan dibayar")} onClick={() => { setSt("verified"); reset(); }} pressed={st === "verified"} cell="verified" />
        <KpiTile icon="pay" tone="blue" label={L("No bank account", "Tiada akaun bank")} value={noBank} sub={L("Receipts and payments", "Penerimaan dan pembayaran")} />
        <KpiTile icon="warning" tone="red" label={L("Duplicate risk", "Risiko pendua")} value={dups} sub={L("Same day, amount, direction", "Hari, amaun, arah sama")} />
      </KpiRow>
      <section className={card} aria-label={L("Historical verification queue", "Barisan pengesahan lampau")}>
        <div className={hx.bar}>
          <select className={selectClassSm} value={month} onChange={(e) => { setMonth(e.target.value); reset(); }} aria-label={L("Month paid", "Bulan dibayar")} data-testid="history-month">
            <option value="">{L("All months", "Semua bulan")}</option>{months.map((m) => <option key={m} value={m}>{monthWord(m)}</option>)}
          </select>
          <select className={selectClassSm} value={st} onChange={(e) => { setSt(e.target.value as typeof st); reset(); }} aria-label={L("Status", "Status")} data-testid="history-status">
            <option value="awaiting">{L("Awaiting verification", "Menunggu pengesahan")}</option><option value="verified">{L("Verified", "Disahkan")}</option><option value="all">{L("All receipts", "Semua penerimaan")}</option>
          </select>
          <select className={selectClassSm} value={acc} onChange={(e) => { setAcc(e.target.value); reset(); }} aria-label={L("Account", "Akaun")}>
            <option value="">{L("All accounts", "Semua akaun")}</option><option value="none">{L("No account", "Tiada akaun")}</option>
            {v.banks.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span className={hx.count}>{L(`${rows.length} receipt(s)`, `${rows.length} penerimaan`)}</span>
        </div>
        {rows.length === 0 ? <p className={fx.empty}>{st === "awaiting" ? L("Nothing awaits verification for these filters.", "Tiada yang menunggu pengesahan untuk penapis ini.") : L("No receipt for these filters.", "Tiada penerimaan untuk penapis ini.")}</p> : (
          <>
            <div className={`${fx.tWrap} erp-desktop-only`}>
              <table className={`${fx.t} ${fx.tCompact}`} data-testid="history-table">
                <thead><tr><th>{L("Month paid", "Bulan dibayar")}</th><th>{L("Receipt", "Penerimaan")}</th><th>{L("Company", "Syarikat")}</th><th className={fx.r}>{L("Amount", "Amaun")}</th><th>{L("Paid on", "Dibayar pada")}</th><th>{L("Payment ref", "Rujukan bayaran")}</th><th>{L("Account", "Akaun")}</th><th>{L("Status", "Status")}</th><th><span className="erp-sr-only">{L("Open", "Buka")}</span></th></tr></thead>
                <tbody>{shown.map((i) => (
                  <tr key={i.key} data-testid="history-row">
                    <td>{monthWord(i.date.slice(0, 7))}</td>
                    <td><span className={hx.who}><strong>{i.ref}</strong>{i.source === "part" && <span className={chipNeutral}>{L("part", "separa")}</span>}</span></td>
                    <td>{i.company ? COMPANY[i.company] : "—"}</td>
                    <td className={`${fx.r} ${fx.num}`}>{fmtRM(i.amount_cents)}</td>
                    <td className={fx.num}>{dmy(i.date)}</td>
                    <td>{i.payment_ref?.trim() || "—"}</td>
                    <td>{i.bank_name ?? "—"}</td>
                    <td>{i.awaiting ? <span className={chipWarn}>{L("Awaiting", "Menunggu")}</span> : <span className={chipSuccess}>{i.cash_verified ? L("Verified (cash)", "Disahkan (tunai)") : L("Verified", "Disahkan")}</span>}</td>
                    <td><button type="button" className={btnSm} onClick={() => openOne(i)} data-testid="history-review">{i.awaiting ? L("Review", "Semak") : L("View", "Lihat")}</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <ul className={`${hx.cards} erp-phone-only`}>
              {shown.map((i) => (
                <li key={i.key}><button type="button" className={hx.card} onClick={() => openOne(i)} data-testid="history-card">
                  <span className={hx.cardTop}><strong>{i.ref}</strong>{i.awaiting ? <span className={chipWarn}>{L("Awaiting", "Menunggu")}</span> : <span className={chipSuccess}>{L("Verified", "Disahkan")}</span>}</span>
                  <span className={hx.cardMeta}>{L("Paid", "Dibayar")} {dmy(i.date)} · {fmtRM(i.amount_cents)}{i.payment_ref ? ` · ${i.payment_ref}` : ""}{i.bank_name ? ` · ${i.bank_name}` : ""}</span>
                </button></li>
              ))}
            </ul>
            <PaginationControls page={cur} total={rows.length} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} label={L("History pages", "Halaman sejarah")} testid="history-pages" />
          </>
        )}
        <p className={hx.note}>{L(`Each receipt sits in the month it was PAID. The company is the invoice's issuer (before 19-08-2026: AZ ONE OFFICIAL) or the account it went into.`, `Setiap penerimaan berada pada bulan ia DIBAYAR. Syarikat ialah pengeluar invois (sebelum 19-08-2026: AZ ONE OFFICIAL) atau akaun yang menerimanya.`)}</p>
      </section>

      <SideDrawer open={!!opened} onClose={() => !busy && setOpened(null)} title={opened ? (opened.awaiting ? L(`Verify receipt · ${opened.ref}`, `Sahkan penerimaan · ${opened.ref}`) : opened.ref) : ""}
        subtitle={opened ? L(`Paid on ${dmy(opened.date)} (stays the cash date) · ${opened.company ? COMPANY[opened.company] : "no company"}`, `Dibayar pada ${dmy(opened.date)} (kekal tarikh tunai) · ${opened.company ? COMPANY[opened.company] : "tiada syarikat"}`) : undefined}
        footer={opened && (
          <div className={hx.foot}>
            <button type="button" className={btnSm} disabled={busy} onClick={() => setOpened(null)}>{L("Back", "Kembali")}</button>
            {opened.awaiting && hist && v.can_cash_verify && (
              <button type="button" className={btnSmPrimary} disabled={busy || !checked || !v.cash_verify_ready} onClick={() => void verify(opened)} data-testid="history-verify">{busy ? L("Verifying…", "Mengesahkan…") : L("Verify receipt", "Sahkan penerimaan")}</button>
            )}
            {opened.cash_verified && v.can_cash_verify && <button type="button" className={btnSm} disabled={busy} onClick={() => void takeBack(opened)} data-testid="history-revoke">{L("Take back…", "Tarik balik…")}</button>}
          </div>
        )}>
        {opened && (
          <div className={hx.drawer} data-testid="history-drawer">
            <dl className={hx.kv}>
              <div><dt>{L("Receipt", "Penerimaan")}</dt><dd>{opened.description}</dd></div>
              <div><dt>{L("This receipt", "Penerimaan ini")}</dt><dd><strong>{fmtRM(opened.amount_cents)}</strong>{opened.source === "part" ? L(" (a part payment)", " (bayaran separa)") : L(" (the invoice balance)", " (baki invois)")}</dd></div>
              <div><dt>{L("Paid on", "Dibayar pada")}</dt><dd>{dmy(opened.date)}</dd></div>
              <div><dt>{L("Payment reference", "Rujukan bayaran")}</dt><dd>{opened.payment_ref?.trim() || L("None recorded", "Tiada direkod")}</dd></div>
              <div><dt>{L("Account", "Akaun")}</dt><dd>{opened.bank_name ?? L("Not assigned", "Belum ditetapkan")}</dd></div>
              <div><dt>{L("Status", "Status")}</dt><dd>{opened.awaiting ? L("Awaiting verification - not Money In", "Menunggu pengesahan - bukan Tunai Masuk") : opened.cash_verified ? L("Verified as cash (historical)", "Disahkan sebagai tunai (lampau)") : L("Verified", "Disahkan")}</dd></div>
            </dl>
            {hist
              ? <p className={hx.band} data-testid="history-commission"><AppIcon name="info" />{L(`Commission: not eligible - paid before ${dmy(end)}. Verifying writes no commission and does not change the invoice.`, `Komisen: tidak layak - dibayar sebelum ${dmy(end)}. Pengesahan tidak menulis komisen dan tidak mengubah invois.`)}</p>
              : opened.awaiting && <p className={hx.band}><AppIcon name="info" />{L(`Paid on or after ${dmy(end)}: it is verified with Confirm paid (Sales > Closed Sales) or payment verification, as usual.`, `Dibayar pada atau selepas ${dmy(end)}: ia disahkan dengan Sahkan dibayar (Jualan > Jualan Ditutup) atau pengesahan bayaran, seperti biasa.`)}</p>}
            {opened.awaiting && hist && v.can_cash_verify && (
              <>
                {!v.cash_verify_ready && <p className={hx.warn}>{L("Migration 0214 is not applied yet - run PUSH.bat.", "Migrasi 0214 belum digunakan - jalankan PUSH.bat.")}</p>}
                <label className={hx.check}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} data-testid="history-checked" /> {L("I checked this money arrived in the bank on that day.", "Saya telah menyemak wang ini masuk ke bank pada hari itu.")}</label>
                <label className={hx.field}><span>{L("Note (optional) - where you checked", "Catatan (pilihan) - di mana anda menyemak")}</span><input className={inputClassSm} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("e.g. Maybank statement, Oct 2026", "cth. Penyata Maybank, Okt 2026")} /></label>
              </>
            )}
            {opened.awaiting && hist && !v.can_cash_verify && <p className={hx.note}>{L("Only the CEO (the company owner) verifies a historical receipt.", "Hanya CEO (pemilik syarikat) mengesahkan penerimaan lampau.")}</p>}
            {opened.link && <button type="button" className={btnSm} onClick={() => onOpen(opened.link)}><AppIcon name="external" />{L("Open the invoice", "Buka invois")}</button>}
          </div>
        )}
      </SideDrawer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Unassigned - movements that belong to no company.
 * ------------------------------------------------------------------ */
export function UnassignedView({ toast, onChanged, canCorrect }: { toast: (t: string, s: string, k?: "notice") => void; onChanged: () => void; canCorrect: boolean }) {
  const [tick, setTick] = useState(0);
  const { v, failed } = useHistoryRead("all", tick);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(10);
  const [busy, setBusy] = useState<string | null>(null);
  if (failed && !v) return <p className={fx.empty}>{failed}</p>;
  if (!v) return <SkelRows rows={5} />;
  const rows = v.items.filter((i) => !i.company && (i.counts || i.awaiting) && live(i));
  const pages = Math.max(1, Math.ceil(rows.length / size)), cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * size, cur * size);
  const banks = v.banks.filter((b) => b.active && b.company);
  const sum = (d: "in" | "out") => rows.filter((i) => i.counts === d).reduce((a, i) => a + i.sign * i.amount_cents, 0);
  const assign = async (i: HItem) => {
    const b = Number(pick[i.key]);
    if (!b) return;
    setBusy(i.key);
    const r = await api<{ error?: { message?: string } }>(`/cashbook/assign-bank`, { method: "POST", body: JSON.stringify({ item_key: i.key, bank_id: b }) });
    setBusy(null);
    if (r.ok) { const bank = banks.find((x) => x.id === b); toast(L("Account assigned", "Akaun ditetapkan"), L(`It now belongs to ${bank?.company ? COMPANY[bank.company] : "the account's company"} - recorded with your name`, `Ia kini milik ${bank?.company ? COMPANY[bank.company] : "syarikat akaun"} - direkod dengan nama anda`)); setTick((n) => n + 1); onChanged(); }
    else toast(L("Not assigned", "Tidak ditetapkan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  return (
    <div className={fx.stack} data-testid="finance-unassigned">
      <KpiRow label={L("Unassigned movements", "Pergerakan tanpa syarikat")} testid="unassigned-figures">
        <KpiTile icon="warning" tone="gold" label={L("Unassigned movements", "Pergerakan tanpa syarikat")} value={rows.length} sub={L("Counted in neither company", "Tidak dikira dalam mana-mana syarikat")} />
        <KpiTile icon="down" tone="red" label={L("Money out, unassigned", "Tunai keluar, tanpa syarikat")} value={fmtRM(sum("out"))} sub={L("Kept apart from company totals", "Diasingkan dari jumlah syarikat")} />
        <KpiTile icon="up" tone="green" label={L("Money in, unassigned", "Tunai masuk, tanpa syarikat")} value={fmtRM(sum("in"))} sub={L("Kept apart from company totals", "Diasingkan dari jumlah syarikat")} />
      </KpiRow>
      <section className={card} aria-label={L("Unassigned transactions", "Transaksi tanpa syarikat")}>
        <p className={hx.note}>{L("The company comes ONLY from the account the money moved through - choose the account; nothing is guessed from a description. The movement is never rewritten: the choice is a mark with your name, in its history.", "Syarikat datang HANYA dari akaun wang itu bergerak - pilih akaun; tiada tekaan dari keterangan. Pergerakan tidak ditulis semula: pilihan ialah tanda dengan nama anda, dalam sejarahnya.")}</p>
        {banks.length === 0 && <p className={hx.warn}>{L("No account has a company yet - set the company on each account first (Finance > Overview > Manage accounts).", "Belum ada akaun dengan syarikat - tetapkan syarikat setiap akaun dahulu (Kewangan > Gambaran > Urus akaun).")}</p>}
        {rows.length === 0 ? <p className={fx.empty}>{L("Every movement belongs to a company.", "Setiap pergerakan milik satu syarikat.")}</p> : (
          <>
            <div className={fx.tWrap}>
              <table className={`${fx.t} ${fx.tCompact}`} data-testid="unassigned-table">
                <thead><tr><th>{L("Date", "Tarikh")}</th><th>{L("Movement", "Pergerakan")}</th><th className={fx.r}>{L("Amount", "Amaun")}</th><th>{L("Direction", "Arah")}</th><th>{L("Account", "Akaun")}</th></tr></thead>
                <tbody>{shown.map((i) => (
                  <tr key={i.key} data-testid="unassigned-row">
                    <td className={fx.num}>{dmy(i.date)}</td>
                    <td><span className={hx.who}><strong>{i.description || i.ref}</strong><span className={fx.muted}>{i.ref}</span></span></td>
                    <td className={`${fx.r} ${fx.num}`}>{fmtRM(i.amount_cents)}</td>
                    <td>{i.type === "in" ? <span className={chipSuccess}>{L("In", "Masuk")}</span> : <span className={chipInfo}>{L("Out", "Keluar")}</span>}</td>
                    <td>{canCorrect ? (
                      <span className={hx.assign}>
                        <select className={selectClassSm} aria-label={L(`Account for ${i.description || i.ref}`, `Akaun untuk ${i.description || i.ref}`)} value={pick[i.key] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [i.key]: e.target.value }))}>
                          <option value="">{L("Account…", "Akaun…")}</option>
                          {banks.map((b) => <option key={b.id} value={b.id}>{b.name} · {COMPANY[b.company!]}</option>)}
                        </select>
                        <button type="button" className={btnSm} disabled={!pick[i.key] || busy === i.key} onClick={() => void assign(i)} data-testid="unassigned-assign">{L("Assign", "Tetapkan")}</button>
                      </span>
                    ) : <span className={fx.muted}>{L("Not set", "Belum ditetapkan")}</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <PaginationControls page={cur} total={rows.length} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} label={L("Unassigned pages", "Halaman tanpa syarikat")} testid="unassigned-pages" />
          </>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The monthly reconciliation since 01-06-2026 (Reports).
 * ------------------------------------------------------------------ */
type Line = { month: string; co: Company | "none"; verified: number; awaiting: number; awaitingN: number; moneyIn: number; moneyOut: number; transfers: number; refunds: number; noBank: number };
export function HistoryReport() {
  const { v, failed } = useHistoryRead("all", 0);
  if (failed && !v) return <p className={fx.empty}>{failed}</p>;
  if (!v) return <SkelRows rows={6} />;
  const lines = new Map<string, Line>();
  const at = (m: string, co: Company | "none") => {
    const k = `${m}|${co}`;
    if (!lines.has(k)) lines.set(k, { month: m, co, verified: 0, awaiting: 0, awaitingN: 0, moneyIn: 0, moneyOut: 0, transfers: 0, refunds: 0, noBank: 0 });
    return lines.get(k)!;
  };
  /* each item lands in exactly ONE line: its month and its company (or Unassigned) */
  for (const i of v.items) {
    if (i.date < HISTORY_FROM || !live(i)) continue;
    const l = at(i.date.slice(0, 7), i.company ?? "none");
    if (i.source === "transfer") { l.transfers += i.amount_cents; continue; }
    if (isReceipt(i)) { if (i.awaiting) { l.awaiting += i.amount_cents; l.awaitingN++; } else if (i.counts === "in") l.verified += i.sign * i.amount_cents; }
    if (i.counts === "in") l.moneyIn += i.sign * i.amount_cents;
    if (i.counts === "out") { l.moneyOut += i.sign * i.amount_cents; if (i.ref.startsWith("CN-")) l.refunds += i.sign * i.amount_cents; }
    if ((i.counts || i.awaiting) && !i.bank_id) l.noBank++;
  }
  const list = [...lines.values()].sort((a, b) => (a.month === b.month ? String(a.co).localeCompare(String(b.co)) : a.month < b.month ? -1 : 1));
  const coWord = (c: Company | "none") => (c === "none" ? L("Unassigned", "Tanpa syarikat") : COMPANY[c]);
  const csv = () => downloadCsv(`a2z-finance-reconciliation-${HISTORY_FROM}-to-${mytToday()}`, [
    ["Month", "Company", "Verified receipts (RM)", "Awaiting verification (RM)", "Awaiting (count)", "Money In (RM)", "Money Out (RM)", "of which refunds (RM)", "Transfers (RM, outside in/out)", "No bank account (count)"],
    ...list.map((l) => [l.month, coWord(l.co), (l.verified / 100).toFixed(2), (l.awaiting / 100).toFixed(2), l.awaitingN, (l.moneyIn / 100).toFixed(2), (l.moneyOut / 100).toFixed(2), (l.refunds / 100).toFixed(2), (l.transfers / 100).toFixed(2), l.noBank]),
  ]);
  return (
    <section className={card} aria-label={L("Monthly reconciliation", "Penyelarasan bulanan")} data-testid="history-report">
      <div className={hx.bar}>
        <p className={hx.note}>{L(`From ${dmy(HISTORY_FROM)} to today, by the month money moved: each company apart, and the movements with no company on their own line. Each sen is in one line. Awaiting receipts are never in Money In.`, `Dari ${dmy(HISTORY_FROM)} hingga hari ini, ikut bulan wang bergerak: setiap syarikat berasingan, dan pergerakan tanpa syarikat pada barisnya sendiri. Setiap sen dalam satu baris. Penerimaan menunggu tidak pernah dalam Tunai Masuk.`)}</p>
        <button type="button" className={btnSm} onClick={csv}><AppIcon name="download" />{L("Export (CSV)", "Eksport (CSV)")}</button>
      </div>
      <div className={fx.tWrap}>
        <table className={`${fx.t} ${fx.tCompact}`}>
          <thead><tr><th>{L("Month", "Bulan")}</th><th>{L("Company", "Syarikat")}</th><th className={fx.r}>{L("Verified receipts", "Penerimaan disahkan")}</th><th className={fx.r}>{L("Awaiting", "Menunggu")}</th><th className={fx.r}>{L("Money In", "Tunai Masuk")}</th><th className={fx.r}>{L("Money Out", "Tunai Keluar")}</th><th className={fx.r}>{L("Transfers", "Pindahan")}</th><th className={fx.r}>{L("No account", "Tiada akaun")}</th></tr></thead>
          <tbody>{list.map((l) => (
            <tr key={`${l.month}|${l.co}`} className={l.co === "none" ? hx.unassignedRow : undefined}>
              <td>{monthWord(l.month)}</td><td>{coWord(l.co)}</td>
              <td className={`${fx.r} ${fx.num}`}>{fmtRM(l.verified)}</td>
              <td className={`${fx.r} ${fx.num}`}>{l.awaiting ? `${fmtRM(l.awaiting)} (${l.awaitingN})` : "—"}</td>
              <td className={`${fx.r} ${fx.num}`}>{fmtRM(l.moneyIn)}</td>
              <td className={`${fx.r} ${fx.num}`}>{fmtRM(l.moneyOut)}</td>
              <td className={`${fx.r} ${fx.num}`}>{l.transfers ? fmtRM(l.transfers) : "—"}</td>
              <td className={`${fx.r} ${fx.num}`}>{l.noBank || "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className={hx.note}>{L("Invoices issued and outstanding balances are Sales figures (Sales > Reports); this report is cash only.", "Invois dikeluarkan dan baki tertunggak ialah angka Jualan (Jualan > Laporan); laporan ini tunai sahaja.")}</p>
    </section>
  );
}

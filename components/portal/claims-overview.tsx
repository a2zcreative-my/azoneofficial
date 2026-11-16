"use client";

/* v1.310.0 - CLAIMS WORKSPACE 4.0 (the CEO, 15-11-2026: "approve as
   recommended", C-0 ... C-13 in claude/CLAIMS-WORKSPACE-4.0-BLUEPRINT.md).
   The Overview is reference 1: five figures for the month by claim date
   (Total = Pending + Approved, awaiting payment + Paid + Rejected - approval
   and payment are two facts, C-5), the month by category, what requires
   attention and the recent claims. The Reports are the SERVER's
   (GET /staff/claims/report, C-10): by claim date or by the bank date the
   money left, each payment with its Finance status. Nothing here is a figure
   from the reference pictures.

   v1.194.0 - THE CLAIMS OVERVIEW AND REPORTS, laid out as the owner's
   reference photo (22-10-2026). Both are drawn from the one list the Claims
   panel already loads (GET /staff/claims - every claim for a decider, your
   own for everyone else, as the worker decides): they fetch nothing, write
   nothing, and every sum is the panel's own rule - a claim belongs to the
   month of its claim date, an approved claim is paid once it has paid_at.

     Overview   the recent claims (approval and payment shown apart), what
                needs attention, the month by status and by category
     Reports    a chosen month: approved against paid, what is still due,
                salary advances and the payroll month that recovers them, the
                payment records with their proof, and a CSV of the month

   No figure from the mockup is used. */

import { useEffect, useState, type ReactNode } from "react";
import { PillSwitch } from "@/components/ui/panel"; // v1.325.0 - D-2
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { Donut } from "@/components/ui/donut";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { downloadCsv, csvStampMyt } from "@/lib/csv";
import { dmy, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { properName } from "@/lib/names";
import { makeApi } from "@/lib/api";
import { btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, selectClassSm } from "@/lib/ui-styles";
import css from "./claims-overview.module.css";
import c4 from "./claims4.module.css";

const api = makeApi("/staff");

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export type ClaimsView = "overview" | "submit" | "mine" | "approvals" | "reports";

export type OvClaim = {
  id: number; user_id: number; claim_date: string; category: string; amount_cents: number;
  description?: string | null; status: string; claimant?: string | null; claimant_full?: string | null;
  paid_at?: string | null; payment_proof_key?: string | null; claim_type?: "reimbursement" | "salary_advance";
  payroll_month?: string | null; created_at: string; items?: string | null;
  receipt_key?: string | null; payee_user_id?: number | null; return_open?: boolean;
};
type Item = { claim_date: string; category: string; amount_cents: number };

/* approval and payment are two facts, shown as two chips */
export function approvalChip(status: string): [string, string] {
  if (status === "approved") return [chipSmSuccess, L("Approved", "Diluluskan")];
  if (status === "rejected") return [chipSmDanger, L("Rejected", "Ditolak")];
  if (status === "pending") return [chipSmWarn, L("Pending", "Menunggu")];
  return [chipSmNeutral, status];
}
export function paymentChip(c: OvClaim): [string, string] | null {
  if (c.paid_at) return [chipSmInfo, L(`Paid ${dmy(c.paid_at.slice(0, 10))}`, `Dibayar ${dmy(c.paid_at.slice(0, 10))}`)];
  if (c.status === "approved") return [chipSmWarn, L("Payment due", "Bayaran perlu dibuat")];
  return null;
}
const sum = (l: readonly OvClaim[]) => l.reduce((a, c) => a + c.amount_cents, 0);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
export const monthName = (ym: string) => { const m = Number(ym.slice(5, 7)) - 1; return `${L(MONTHS[m] ?? "", MONTHS_MS[m] ?? "")} ${ym.slice(0, 4)}`; };

function Head({ icon, tone, title, sub, children }: { icon: AppIconName; tone: string | undefined; title: ReactNode; sub?: string; children?: ReactNode }) {
  return (
    <div className={css.head}>
      <div className={css.lead}>
        <span className={`${css.well} ${tone ?? ""}`}><AppIcon name={icon} /></span>
        <div className={css.headText}>
          <p className={css.title}>{title}</p>
          {sub && <p className={css.sub}>{sub}</p>}
        </div>
      </div>
      {children && <div className={css.actions}>{children}</div>}
    </div>
  );
}

/* the category palette: theme tokens only, the same order everywhere */
const CAT_TONES = ["var(--gold-solid)", "var(--info)", "var(--success)", "var(--warning)", "var(--danger)", "var(--primary)", "var(--muted-foreground)", "var(--border)"];

export function ClaimsOverview({ scope, mine, month, loaded, showStaff, waiting, toPay, noOf, catOf, itemsOf, onView, onSubmit, onApprovals, onPayments, onMine, onTile }: {
  /** the claims the month figures count: every claim this person reads for a
      manager (the server's scope), their own and those paid to them otherwise */
  scope: readonly OvClaim[];
  /** their own claims and the claims paid to them (C-4) */
  mine: readonly OvClaim[];
  month: string;
  loaded: boolean;
  showStaff: boolean;
  /** claims at this person's own stage (never their own, never paid to them) */
  waiting: readonly OvClaim[];
  /** approved claims this person may mark paid (the server's "pay" action) */
  toPay: readonly OvClaim[];
  noOf: (c: OvClaim) => string;
  catOf: (k: string) => string;
  itemsOf: (c: OvClaim) => Item[];
  onView: (c: OvClaim) => void;
  onSubmit: () => void;
  onApprovals: () => void;
  onPayments: () => void;
  onMine: () => void;
  /** a figure opens the claims it counts */
  onTile: (k: "" | "pending" | "approved" | "paid" | "rejected") => void;
}) {
  const recent = [...scope].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
  const m = scope.filter((c) => (c.claim_date ?? "").slice(0, 7) === month);
  const pending = m.filter((c) => c.status === "pending");
  const approvedDue = m.filter((c) => c.status === "approved" && !c.paid_at);
  const paid = m.filter((c) => c.status === "approved" && c.paid_at);
  const rejected = m.filter((c) => c.status === "rejected");
  /* the month by category, from each claim's own lines, rejected left out */
  const byCat = new Map<string, number>();
  for (const c of m.filter((x) => x.status !== "rejected")) for (const it of itemsOf(c)) byCat.set(it.category, (byCat.get(it.category) ?? 0) + it.amount_cents);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const catTotal = cats.reduce((a, [, v]) => a + v, 0);
  /* C-8 - a reimbursement waits for its receipt; a mileage-only claim and a
     salary advance need none (the server's own rule) */
  const missing = mine.filter((c) => c.status !== "approved" && c.claim_type !== "salary_advance" && !c.receipt_key
    && !itemsOf(c).every((it) => Number((it as Item & { km?: number }).km) > 0));
  const returned = mine.filter((c) => c.status === "pending" && c.return_open);
  const myRejected = mine.filter((c) => c.status === "rejected" && (c.claim_date ?? "").slice(0, 7) >= month);
  const rows: { key: string; tone: string; icon: AppIconName; title: string; sub: string; action: { label: string; onClick: () => void } }[] = [];
  if (waiting.length) rows.push({ key: "waiting", tone: css.noteWarn ?? "", icon: "pending", title: L("Waiting for your approval", "Menunggu kelulusan anda"), sub: `${waiting.length} · ${fmtRM(sum(waiting))}`, action: { label: L("Review", "Semak"), onClick: onApprovals } });
  if (toPay.length) rows.push({ key: "pay", tone: css.noteInfo ?? "", icon: "pay", title: L("Ready for payment", "Sedia untuk dibayar"), sub: L(`${toPay.length} approved · ${fmtRM(sum(toPay))} · not paid yet`, `${toPay.length} diluluskan · ${fmtRM(sum(toPay))} · belum dibayar`), action: { label: L("Payments", "Bayaran"), onClick: onPayments } });
  if (missing.length) rows.push({ key: "receipt", tone: css.noteDanger ?? "", icon: "attach", title: L("Missing receipt", "Resit tiada"), sub: L(`${missing.length} of your claims cannot be approved until the receipt is attached`, `${missing.length} tuntutan anda tidak boleh diluluskan sehingga resit dilampirkan`), action: { label: L("Attach", "Lampirkan"), onClick: onMine } });
  if (returned.length) rows.push({ key: "returned", tone: css.noteWarn ?? "", icon: "chat", title: L("Question from the approver", "Soalan daripada pelulus"), sub: L(`${returned.length} of your claims waits for your answer`, `${returned.length} tuntutan anda menunggu jawapan anda`), action: { label: L("Answer", "Jawab"), onClick: onMine } });
  if (myRejected.length) rows.push({ key: "rejected", tone: css.noteNeutral ?? "", icon: "warning", title: L("Rejected this month", "Ditolak bulan ini"), sub: L(`${myRejected.length} of your claims - edit and resubmit from My Claims`, `${myRejected.length} tuntutan anda - sunting dan hantar semula dari Tuntutan Saya`), action: { label: L("My Claims", "Tuntutan Saya"), onClick: onMine } });
  const tileSub = (l: readonly OvClaim[]) => L(`${l.length} claim${l.length === 1 ? "" : "s"}`, `${l.length} tuntutan`);

  return (
    <>
      <KpiRow label={L(`Claims dated ${monthName(month)}`, `Tuntutan bertarikh ${monthName(month)}`)}>
        <KpiTile icon="documents" tone="navy" label={L("Total Claims", "Jumlah Tuntutan")} value={fmtRM(sum(m))} busy={!loaded} sub={tileSub(m)}
          onClick={() => onTile("")} title={L("Every claim dated this month", "Setiap tuntutan bertarikh bulan ini")} />
        <KpiTile icon="pending" tone="gold" label={L("Pending Approval", "Menunggu Kelulusan")} value={fmtRM(sum(pending))} busy={!loaded} sub={tileSub(pending)}
          onClick={() => onTile("pending")} title={L("Show only pending claims", "Tunjuk tuntutan menunggu sahaja")} />
        <KpiTile icon="success" tone="green" label={L("Approved", "Diluluskan")} value={fmtRM(sum(approvedDue))} busy={!loaded} sub={L(`${approvedDue.length} awaiting payment`, `${approvedDue.length} menunggu bayaran`)}
          onClick={() => onTile("approved")} title={L("Approved, not yet paid", "Diluluskan, belum dibayar")} />
        <KpiTile icon="paid" tone="blue" label={L("Paid", "Dibayar")} value={fmtRM(sum(paid))} busy={!loaded} sub={tileSub(paid)}
          onClick={() => onTile("paid")} title={L("Show only paid claims", "Tunjuk tuntutan dibayar sahaja")} />
        <KpiTile icon="error" tone="red" label={L("Rejected", "Ditolak")} value={fmtRM(sum(rejected))} busy={!loaded} sub={tileSub(rejected)}
          onClick={() => onTile("rejected")} title={L("Show only rejected claims", "Tunjuk tuntutan ditolak sahaja")} />
      </KpiRow>

      <div className={c4.split}>
        <section className={card} aria-label={L("Claims by category", "Tuntutan mengikut kategori")}>
          <Head icon="chart" tone={css.gold} title={<>{L("Claims by Category", "Tuntutan mengikut Kategori")} <span className={css.muted}>({monthName(month)})</span></>}
            sub={showStaff ? L("Every claim line this month that you manage, rejected left out.", "Setiap baris tuntutan bulan ini di bawah anda, yang ditolak tidak dikira.") : L("Your claim lines this month, rejected left out.", "Baris tuntutan anda bulan ini, yang ditolak tidak dikira.")} />
          {!loaded ? <SkelRows rows={3} /> : cats.length === 0 ? (
            <p className={css.empty}>{L("No claim lines this month.", "Tiada baris tuntutan bulan ini.")}</p>
          ) : (
            <div className={css.donutRow} data-testid="claims-by-category">
              <Donut size={132} hideLegend centerLabel={fmtRM(catTotal)} centerSub={L("this month", "bulan ini")}
                slices={cats.map(([k, v], i) => ({ label: catOf(k), value: v, color: CAT_TONES[i % CAT_TONES.length] ?? "var(--border)" }))} />
              <ul className={css.legend}>
                {cats.map(([k, v], i) => (
                  <li key={k}>
                    <span className={css.dot} style={{ background: CAT_TONES[i % CAT_TONES.length] }} aria-hidden />
                    <span className={`${css.legendLabel} ${css.cap}`}>{catOf(k)}</span>
                    <span className={css.num}>{catTotal > 0 ? `${Math.round((v * 100) / catTotal)}%` : "—"}</span>
                    <span className={css.num}>{fmtRM(v)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className={card} aria-label={L("Requires attention", "Perlu perhatian")} data-testid="claims-attention">
          <Head icon="info" tone={css.blue} title={L("Requires Attention", "Perlu Perhatian")} sub={L("Decisions, payments, receipts and questions.", "Keputusan, bayaran, resit dan soalan.")} />
          {!loaded ? <SkelRows rows={2} /> : rows.length === 0 ? (
            <p className={css.empty}>{L("Nothing needs you right now.", "Tiada yang memerlukan anda sekarang.")}</p>
          ) : (
            <ul className={css.notes}>
              {rows.map((n) => (
                <li key={n.key} className={`${css.note} ${n.tone}`} data-attention={n.key}>
                  <AppIcon name={n.icon} />
                  <span className={c4.noteText}><strong>{n.title}</strong><span>{n.sub}</span></span>
                  <button type="button" className={btnSm} onClick={n.action.onClick}>{n.action.label}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={card} aria-label={L("Recent claims", "Tuntutan terkini")}>
        <Head icon="receipt" tone={css.gold} title={L("Recent Claims", "Tuntutan Terkini")}
          sub={showStaff ? L("The latest claims you manage, with approval and payment apart.", "Tuntutan terkini di bawah anda, kelulusan dan bayaran berasingan.") : L("Your latest claims, with approval and payment apart.", "Tuntutan terkini anda, kelulusan dan bayaran berasingan.")}>
          <button type="button" className={btnSm} onClick={showStaff ? onApprovals : onMine}>{L("View all", "Lihat semua")}</button>
          <button type="button" className={btnSmPrimary} onClick={onSubmit}><AppIcon name="add" />{L("Submit Claim", "Hantar Tuntutan")}</button>
        </Head>
        <div className={css.tWrap}>
          <table className={css.t}>
            <thead>
              <tr>
                <th>{L("Claim No.", "No. Tuntutan")}</th><th>{L("Date", "Tarikh")}</th>
                {showStaff && <th>{L("Staff", "Kakitangan")}</th>}
                <th>{L("Category", "Kategori")}</th><th>{L("Description", "Keterangan")}</th>
                <th className={css.num}>{L("Amount (RM)", "Amaun (RM)")}</th><th>{L("Approval", "Kelulusan")}</th><th>{L("Payment", "Bayaran")}</th><th>{L("Action", "Tindakan")}</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? <tr><td colSpan={showStaff ? 9 : 8}><SkelRows rows={4} /></td></tr>
                : recent.length === 0 ? <tr><td colSpan={showStaff ? 9 : 8} className={css.empty}>{L("No claims yet - Submit Claim starts the first one.", "Belum ada tuntutan - Hantar Tuntutan untuk memulakan.")}</td></tr>
                : recent.map((c) => {
                  const its = itemsOf(c);
                  const ap = approvalChip(c.status);
                  const pay = paymentChip(c);
                  const who = properName(c.claimant_full || c.claimant || "");
                  return (
                    <tr key={c.id}>
                      <td className={css.mono}>{noOf(c)}</td>
                      <td className={css.muted}>{dmy(c.claim_date)}</td>
                      {showStaff && <td><span className={css.who}><Avatar name={who || "?"} userId={c.user_id} size="sm" /><span className={css.name}>{who || "—"}</span></span></td>}
                      <td>{c.claim_type === "salary_advance" ? L("Salary advance", "Pendahuluan gaji") : its.length > 1 ? L(`${its.length} items`, `${its.length} item`) : <span className={css.cap}>{catOf(c.category)}</span>}</td>
                      <td className={css.desc}>{c.description || "—"}</td>
                      <td className={css.num}>{(c.amount_cents / 100).toFixed(2)}</td>
                      <td><span className={ap[0]}>{ap[1]}</span></td>
                      <td>{pay ? <span className={pay[0]}>{pay[1]}</span> : <span className={css.muted}>—</span>}</td>
                      <td><button type="button" className={btnSm} onClick={() => onView(c)}>{L("View", "Lihat")}</button></td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ---- Reports & Payments: the server's report (C-10) ---- */
type RepClaim = {
  id: number; claim_no: string; claimant: string | null; user_id: number; claim_date: string; amount_cents: number; status: string;
  claim_type: string | null; category: string; paid_at: string | null; pay_day: string | null;
  finance: "booked" | "reversed" | "not_booked" | null; proof: boolean; payroll_month: string | null;
};
type Tot = { n: number; cents: number };
export type ClaimsReport = {
  month: string;
  by_claim_date: { submitted: Tot; approved: Tot; paid: Tot; due: Tot; pending: Tot; rejected: Tot; categories: { category: string; approved_cents: number; paid_cents: number }[]; claims: RepClaim[] };
  by_payment_date: { paid: Tot; payments: RepClaim[] };
  advances: RepClaim[];
  reads_others: boolean;
};
const financeChip = (f: RepClaim["finance"]): [string, string] =>
  f === "booked" ? [chipSmSuccess, L("Booked in Finance", "Direkod di Kewangan")]
    : f === "reversed" ? [chipSmDanger, L("Reversed in Finance", "Dibatalkan di Kewangan")]
      : [chipSmWarn, L("Not in the cash book", "Tiada dalam buku tunai")];

export function ClaimsReports({ month, months, onMonth, version, catOf, canSeeProof, openProof, onView }: {
  month: string;
  months: readonly string[];
  onMonth: (m: string) => void;
  /** bumps when the panel reloads its claims, so the report follows a decision */
  version: number;
  catOf: (k: string) => string;
  canSeeProof: (c: { id: number; user_id: number }) => boolean;
  openProof: (id: number) => void;
  onView: (id: number) => void;
}) {
  const [basis, setBasis] = useState<"claim" | "bank">("claim");
  const [rep, setRep] = useState<{ key: string; data: ClaimsReport | null; failed: boolean } | null>(null);
  const key = `${month}#${version}`;
  useEffect(() => {
    let live = true;
    void api<ClaimsReport>(`/claims/report?month=${month}`).then((r) => { if (live) setRep({ key, data: r.ok ? r.data ?? null : null, failed: !r.ok }); });
    return () => { live = false; };
  }, [month, key]);
  const cur = rep && rep.key === key ? rep : null;
  const loaded = cur !== null;
  const d = cur?.data ?? null;
  const showStaff = d?.reads_others ?? false;
  const cd = d?.by_claim_date;
  const pays = d?.by_payment_date.payments ?? [];
  const list = basis === "claim" ? (cd?.claims ?? []) : pays;
  const csv = () => {
    if (!d) return;
    const rows: (string | number)[][] = [
      [`# ${L("Claims", "Tuntutan")} — ${monthName(month)} — ${basis === "claim" ? L("by claim date", "ikut tarikh tuntutan") : L("by bank date (the day the money left)", "ikut tarikh bank (hari wang keluar)")} — ${L("Generated", "Dijana")} ${csvStampMyt()}`],
      [L("Claim no.", "No. tuntutan"), L("Claim date", "Tarikh tuntutan"), L("Bank date", "Tarikh bank"), ...(showStaff ? [L("Staff", "Kakitangan")] : []), L("Type", "Jenis"), L("Category", "Kategori"), L("Amount (RM)", "Amaun (RM)"), L("Approval", "Kelulusan"), L("Finance", "Kewangan"), L("Payroll month", "Bulan gaji")],
    ];
    for (const c of list) {
      rows.push([c.claim_no, c.claim_date, c.pay_day ?? "", ...(showStaff ? [properName(c.claimant ?? "")] : []),
        c.claim_type === "salary_advance" ? L("Salary advance", "Pendahuluan gaji") : L("Reimbursement", "Bayaran balik"),
        catOf(c.category), (c.amount_cents / 100).toFixed(2), c.status, c.finance ? financeChip(c.finance)[1] : "", c.payroll_month ?? ""]);
    }
    rows.push([L("TOTAL", "JUMLAH"), "", "", ...(showStaff ? [""] : []), "", "", (list.reduce((a, c) => a + c.amount_cents, 0) / 100).toFixed(2), "", "", ""]);
    downloadCsv(`claims-${month}-${basis === "claim" ? "claim-date" : "bank-date"}`, rows);
  };

  return (
    <>
      <div className={css.toolbar}>
        <label className={css.monthPick}>
          <span className={css.sub}>{L("Month", "Bulan")}</span>
          <select className={selectClassSm} value={month} onChange={(e) => onMonth(e.target.value)}>
            {months.map((mm) => <option key={mm} value={mm}>{monthName(mm)}</option>)}
          </select>
        </label>
        <PillSwitch testid="claims-basis" label={L("Report basis", "Asas laporan")} value={basis} onChange={setBasis}
          options={[["claim", L("By claim date", "Ikut tarikh tuntutan")], ["bank", L("By bank date", "Ikut tarikh bank")]] as const} />
        <button type="button" className={btnSm} disabled={!loaded || list.length === 0} onClick={csv}><AppIcon name="download" />{L("CSV", "CSV")}</button>
      </div>
      {cur?.failed && <p className={css.empty}>{L("The report could not be loaded. Try again in a moment.", "Laporan tidak dapat dimuatkan. Cuba sebentar lagi.")}</p>}
      {basis === "claim" ? (
        <KpiRow label={L("The month's claims, by claim date", "Tuntutan bulan ini, ikut tarikh tuntutan")}>
          <KpiTile icon="documents" tone="navy" label={L("Submitted", "Dihantar")} value={fmtRM(cd?.submitted.cents ?? 0)} busy={!loaded} sub={L(`${cd?.submitted.n ?? 0} claims · ${cd?.pending.n ?? 0} pending · ${cd?.rejected.n ?? 0} rejected`, `${cd?.submitted.n ?? 0} tuntutan · ${cd?.pending.n ?? 0} menunggu · ${cd?.rejected.n ?? 0} ditolak`)} />
          <KpiTile icon="success" tone="green" label={L("Approved", "Diluluskan")} value={fmtRM(cd?.approved.cents ?? 0)} busy={!loaded} sub={L(`${cd?.approved.n ?? 0} claims`, `${cd?.approved.n ?? 0} tuntutan`)} />
          <KpiTile icon="paid" tone="blue" label={L("Paid", "Dibayar")} value={fmtRM(cd?.paid.cents ?? 0)} busy={!loaded} sub={L(`${cd?.paid.n ?? 0} of ${cd?.approved.n ?? 0} approved`, `${cd?.paid.n ?? 0} daripada ${cd?.approved.n ?? 0} diluluskan`)}
            bar={{ pct: (cd?.approved.cents ?? 0) > 0 ? ((cd?.paid.cents ?? 0) / (cd?.approved.cents ?? 1)) * 100 : 0, tone: "blue" }} />
          <KpiTile icon="pending" tone="gold" label={L("Approved, Not Paid", "Diluluskan, Belum Dibayar")} value={fmtRM(cd?.due.cents ?? 0)} busy={!loaded} sub={L(`${cd?.due.n ?? 0} to pay`, `${cd?.due.n ?? 0} untuk dibayar`)} />
        </KpiRow>
      ) : (
        <KpiRow label={L("The month's payments, by bank date", "Bayaran bulan ini, ikut tarikh bank")}>
          <KpiTile icon="paid" tone="blue" label={L("Paid out", "Dibayar keluar")} value={fmtRM(d?.by_payment_date.paid.cents ?? 0)} busy={!loaded} sub={L(`${d?.by_payment_date.paid.n ?? 0} payments, by the day the money left`, `${d?.by_payment_date.paid.n ?? 0} bayaran, ikut hari wang keluar`)} />
          <KpiTile icon="success" tone="green" label={L("Booked in Finance", "Direkod di Kewangan")} value={pays.filter((c) => c.finance === "booked").length} busy={!loaded} sub={L("with a live cash book row", "dengan baris buku tunai yang sah")} />
          <KpiTile icon="warning" tone="red" label={L("Needs Finance", "Perlu Kewangan")} value={pays.filter((c) => c.finance !== "booked").length} busy={!loaded} sub={L("not booked, or reversed", "belum direkod, atau dibatalkan")} />
        </KpiRow>
      )}

      <div className={css.split2}>
        {basis === "claim" ? (
          <section className={card} aria-label={L("Approved against paid, by category", "Diluluskan berbanding dibayar, mengikut kategori")}>
            <Head icon="chart" tone={css.gold} title={L("Approved vs Paid by Category", "Diluluskan vs Dibayar mengikut Kategori")} sub={L("Approved claim lines dated this month.", "Baris tuntutan diluluskan bertarikh bulan ini.")} />
            <div className={css.tWrap}>
              <table className={css.t}>
                <thead><tr><th>{L("Category", "Kategori")}</th><th className={css.num}>{L("Approved", "Diluluskan")}</th><th className={css.num}>{L("Paid", "Dibayar")}</th><th className={css.num}>{L("Still due", "Belum dibayar")}</th></tr></thead>
                <tbody>
                  {!loaded ? <tr><td colSpan={4}><SkelRows rows={3} /></td></tr>
                    : (cd?.categories.length ?? 0) === 0 ? <tr><td colSpan={4} className={css.empty}>{L("No approved claims dated this month.", "Tiada tuntutan diluluskan bertarikh bulan ini.")}</td></tr>
                    : cd!.categories.map((v) => (
                      <tr key={v.category}><td className={css.cap}>{catOf(v.category)}</td><td className={css.num}>{fmtRM(v.approved_cents)}</td><td className={css.num}>{fmtRM(v.paid_cents)}</td><td className={css.num}>{fmtRM(v.approved_cents - v.paid_cents)}</td></tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className={card} aria-label={L("How the payments are recorded", "Cara bayaran direkod")}>
            <Head icon="info" tone={css.blue} title={L("Bank date", "Tarikh bank")} sub={L("A payment counts in the month the money left the bank - the date given with Mark paid, kept on the claim's one cash book row. A reversed row is shown as reversed, never as paid.", "Bayaran dikira pada bulan wang keluar dari bank - tarikh yang diberi dengan Tanda dibayar, disimpan pada satu baris buku tunai tuntutan. Baris yang dibatalkan ditunjuk sebagai dibatalkan, bukan dibayar.")} />
          </section>
        )}

        <section className={card} aria-label={L("Salary advances", "Pendahuluan gaji")}>
          <Head icon="money" tone={css.purple} title={L("Salary Advances", "Pendahuluan Gaji")} sub={L(`Recovered by Payroll from the ${monthName(month)} payslip.`, `Dipotong oleh Gaji daripada slip gaji ${monthName(month)}.`)} />
          {!loaded ? <SkelRows rows={2} /> : (d?.advances.length ?? 0) === 0 ? (
            <p className={css.empty}>{L("No salary advance is recovered from this month's payroll.", "Tiada pendahuluan gaji dipotong daripada gaji bulan ini.")}</p>
          ) : (
            <ul className={css.rows}>
              {d!.advances.map((c) => {
                const ap = approvalChip(c.status);
                return (
                  <li key={c.id} className={css.row}>
                    <span className={css.rowMain}><span className={css.name}>{showStaff ? properName(c.claimant ?? "") : c.claim_no}</span><span className={css.sub}>{showStaff ? `${c.claim_no} · ` : ""}{L("asked", "dipohon")} {dmy(c.claim_date)}</span></span>
                    <span className={ap[0]}>{ap[1]}</span>
                    <span className={c.paid_at ? chipSmInfo : chipSmNeutral}>{c.paid_at ? L("Paid out", "Dibayar") : L("Not paid out", "Belum dibayar")}</span>
                    <span className={css.num}>{fmtRM(c.amount_cents)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className={card} aria-label={basis === "claim" ? L("Claims of the month", "Tuntutan bulan ini") : L("Payment records", "Rekod bayaran")} data-testid="claims-report-list">
        <Head icon="paid" tone={css.blue} title={basis === "claim" ? L("Claims of the Month", "Tuntutan Bulan Ini") : L("Payment Records", "Rekod Bayaran")}
          sub={basis === "claim" ? L(`Claims dated ${monthName(month)}, with the bank date of any payment.`, `Tuntutan bertarikh ${monthName(month)}, dengan tarikh bank bagi sebarang bayaran.`) : L(`Payments whose money left the bank in ${monthName(month)}.`, `Bayaran yang wangnya keluar dari bank pada ${monthName(month)}.`)} />
        <div className={css.tWrap}>
          <table className={css.t}>
            <thead><tr>
              {basis === "bank" && <th>{L("Bank date", "Tarikh bank")}</th>}
              <th>{L("Claim No.", "No. Tuntutan")}</th>{showStaff && <th>{L("Staff", "Kakitangan")}</th>}<th>{L("Claim date", "Tarikh tuntutan")}</th>
              <th className={css.num}>{L("Amount", "Amaun")}</th>{basis === "claim" && <th>{L("Approval", "Kelulusan")}</th>}{basis === "claim" && <th>{L("Bank date", "Tarikh bank")}</th>}
              <th>{L("Finance", "Kewangan")}</th><th>{L("Proof", "Bukti")}</th><th />
            </tr></thead>
            <tbody>
              {!loaded ? <tr><td colSpan={9}><SkelRows rows={3} /></td></tr>
                : list.length === 0 ? <tr><td colSpan={9} className={css.empty}>{basis === "claim" ? L("No claims dated this month.", "Tiada tuntutan bertarikh bulan ini.") : L("No claim payments left the bank this month.", "Tiada bayaran tuntutan keluar dari bank bulan ini.")}</td></tr>
                : list.map((c) => {
                  const ap = approvalChip(c.status);
                  const fin = c.finance ? financeChip(c.finance) : null;
                  return (
                    <tr key={c.id}>
                      {basis === "bank" && <td className={css.muted}>{c.pay_day ? dmy(c.pay_day) : "—"}</td>}
                      <td className={css.mono}>{c.claim_no}</td>
                      {showStaff && <td className={css.name}>{properName(c.claimant ?? "") || "—"}</td>}
                      <td className={css.muted}>{dmy(c.claim_date)}</td>
                      <td className={css.num}>{fmtRM(c.amount_cents)}</td>
                      {basis === "claim" && <td><span className={ap[0]}>{c.status === "approved" && !c.paid_at ? L("Payment due", "Bayaran perlu dibuat") : ap[1]}</span></td>}
                      {basis === "claim" && <td className={css.muted}>{c.pay_day ? dmy(c.pay_day) : "—"}</td>}
                      <td>{fin ? <span className={fin[0]}>{fin[1]}</span> : <span className={css.muted}>—</span>}</td>
                      <td>{c.proof && canSeeProof(c)
                        ? <button type="button" className={btnSm} onClick={() => openProof(c.id)}>{L("Payment proof", "Bukti bayaran")}</button>
                        : c.paid_at ? <span className={c.proof ? chipSmSuccess : chipSmWarn}>{c.proof ? L("Attached", "Dilampirkan") : L("No proof yet", "Tiada bukti lagi")}</span> : <span className={css.muted}>—</span>}</td>
                      <td><button type="button" className={btnSm} onClick={() => onView(c.id)}>{L("View", "Lihat")}</button></td>
                    </tr>
                  );
                })}
            </tbody>
            {loaded && list.length > 0 && <tfoot><tr><td colSpan={(basis === "bank" ? 2 : 1) + (showStaff ? 1 : 0) + 1}>{L("Total", "Jumlah")}</td><td className={css.num}>{fmtRM(list.reduce((a, c) => a + c.amount_cents, 0))}</td><td colSpan={basis === "claim" ? 5 : 3} /></tr></tfoot>}
          </table>
        </div>
      </section>
    </>
  );
}

"use client";

/* v1.194.0 - THE CLAIMS OVERVIEW AND REPORTS, laid out as the owner's
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

import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { Donut } from "@/components/ui/donut";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { downloadCsv, csvStampMyt } from "@/lib/csv";
import { dmy, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { properName } from "@/lib/names";
import { btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, selectClassSm } from "@/lib/ui-styles";
import css from "./claims-overview.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export type ClaimsView = "overview" | "submit" | "mine" | "approvals" | "reports";

export type OvClaim = {
  id: number; user_id: number; claim_date: string; category: string; amount_cents: number;
  description?: string | null; status: string; claimant?: string | null; claimant_full?: string | null;
  paid_at?: string | null; payment_proof_key?: string | null; claim_type?: "reimbursement" | "salary_advance";
  payroll_month?: string | null; created_at: string; items?: string | null;
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

export function ClaimsOverview({ scope, mine, month, loaded, showStaff, waitingOnMe, noOf, catOf, itemsOf, onView, onSubmit, onApprovals, onMine, onReports }: {
  /** the claims the month figures count: every claim for a decider, your own otherwise */
  scope: readonly OvClaim[];
  mine: readonly OvClaim[];
  month: string;
  loaded: boolean;
  showStaff: boolean;
  /** pending claims this account can act on, or null when it approves nothing */
  waitingOnMe: number | null;
  noOf: (c: OvClaim) => string;
  catOf: (k: string) => string;
  itemsOf: (c: OvClaim) => Item[];
  onView: (c: OvClaim) => void;
  onSubmit: () => void;
  onApprovals: () => void;
  onMine: () => void;
  onReports: () => void;
}) {
  const recent = [...scope].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
  const monthScope = scope.filter((c) => (c.claim_date ?? "").slice(0, 7) === month);
  /* the month by category, from each claim's own lines */
  const byCat = new Map<string, number>();
  for (const c of monthScope.filter((x) => x.status !== "rejected")) for (const it of itemsOf(c)) byCat.set(it.category, (byCat.get(it.category) ?? 0) + it.amount_cents);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const catMax = Math.max(1, ...cats.map(([, v]) => v));
  /* your own month, by status */
  const myMonth = mine.filter((c) => (c.claim_date ?? "").slice(0, 7) === month);
  const myApproved = myMonth.filter((c) => c.status === "approved");
  const myPaid = myApproved.filter((c) => c.paid_at);
  const myPending = myMonth.filter((c) => c.status === "pending");
  const myRejected = myMonth.filter((c) => c.status === "rejected");
  /* what needs a look */
  const dueToPay = scope.filter((c) => c.status === "approved" && !c.paid_at);
  const myToFix = mine.filter((c) => c.status === "rejected" && (c.claim_date ?? "").slice(0, 7) >= month);
  const myWaiting = mine.filter((c) => c.status === "pending");
  const notes: { tone: string; icon: AppIconName; text: string; action?: { label: string; onClick: () => void } }[] = [];
  if (waitingOnMe) notes.push({ tone: css.noteWarn ?? "", icon: "pending", text: L(`${waitingOnMe} claim${waitingOnMe === 1 ? "" : "s"} waiting for your decision`, `${waitingOnMe} tuntutan menunggu keputusan anda`), action: { label: L("Open approvals", "Buka kelulusan"), onClick: onApprovals } });
  if (showStaff && dueToPay.length) notes.push({ tone: css.noteInfo ?? "", icon: "pay", text: L(`${dueToPay.length} approved claim${dueToPay.length === 1 ? "" : "s"} still to pay · ${fmtRM(sum(dueToPay))}`, `${dueToPay.length} tuntutan diluluskan belum dibayar · ${fmtRM(sum(dueToPay))}`), action: { label: L("Payments", "Bayaran"), onClick: onReports } });
  if (myToFix.length) notes.push({ tone: css.noteDanger ?? "", icon: "warning", text: L(`${myToFix.length} of your claims ${myToFix.length === 1 ? "was" : "were"} rejected this month - edit and resubmit from My Claims`, `${myToFix.length} tuntutan anda ditolak bulan ini - sunting dan hantar semula dari Tuntutan Saya`), action: { label: L("My claims", "Tuntutan saya"), onClick: onMine } });
  if (myWaiting.length) notes.push({ tone: css.noteNeutral ?? "", icon: "time", text: L(`${myWaiting.length} of your claims ${myWaiting.length === 1 ? "is" : "are"} waiting for approval · ${fmtRM(sum(myWaiting))}`, `${myWaiting.length} tuntutan anda menunggu kelulusan · ${fmtRM(sum(myWaiting))}`) });

  return (
    <>
      <section className={card} aria-label={L("Recent claims", "Tuntutan terkini")}>
        <Head icon="receipt" tone={css.gold} title={L("Recent Claims", "Tuntutan Terkini")}
          sub={showStaff ? L("The latest claims across the company, with approval and payment apart.", "Tuntutan terkini seluruh syarikat, kelulusan dan bayaran berasingan.") : L("Your latest claims, with approval and payment apart.", "Tuntutan terkini anda, kelulusan dan bayaran berasingan.")}>
          <button type="button" className={btnSm} onClick={showStaff ? onApprovals : onMine}>{L("View all claims", "Lihat semua tuntutan")}</button>
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
                      {showStaff && <td><span className={css.who}><Avatar name={who || "?"} size="sm" /><span className={css.name}>{who || "—"}</span></span></td>}
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

      <div className={css.split}>
        <section className={card} aria-label={L("Needs attention", "Perlu perhatian")}>
          <Head icon="info" tone={css.blue} title={L("Needs Attention", "Perlu Perhatian")} sub={L("Decisions, payments and claims to fix.", "Keputusan, bayaran dan tuntutan untuk dibetulkan.")} />
          {!loaded ? <SkelRows rows={2} /> : notes.length === 0 ? (
            <p className={css.empty}>{L("Nothing needs you right now.", "Tiada yang memerlukan anda sekarang.")}</p>
          ) : (
            <ul className={css.notes}>
              {notes.map((n) => (
                <li key={n.text} className={`${css.note} ${n.tone}`}>
                  <AppIcon name={n.icon} />
                  <span className={css.noteText}>{n.text}</span>
                  {n.action && <button type="button" className={btnSm} onClick={n.action.onClick}>{n.action.label}</button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-label={L("My claim summary", "Ringkasan tuntutan saya")}>
          <Head icon="chart" tone={css.green} title={<>{L("My Claim Summary", "Ringkasan Tuntutan Saya")} <span className={css.muted}>({monthName(month)})</span></>} />
          {!loaded ? <SkelRows rows={3} /> : myMonth.length === 0 ? (
            <p className={css.empty}>{L("You have no claims dated this month.", "Anda tiada tuntutan bertarikh bulan ini.")}</p>
          ) : (
            <div className={css.donutRow}>
              <Donut size={128} hideLegend centerLabel={String(myMonth.length)} centerSub={L("claims", "tuntutan")} slices={[
                { label: L("Approved, unpaid", "Diluluskan, belum dibayar"), value: myApproved.length - myPaid.length, color: "var(--success)" },
                { label: L("Paid", "Dibayar"), value: myPaid.length, color: "var(--info)" },
                { label: L("Pending", "Menunggu"), value: myPending.length, color: "var(--warning)" },
                { label: L("Rejected", "Ditolak"), value: myRejected.length, color: "var(--danger)" },
              ]} />
              <ul className={css.legend}>
                {([
                  [L("Approved", "Diluluskan"), myApproved, "var(--success)"],
                  [L("of which paid", "daripadanya dibayar"), myPaid, "var(--info)"],
                  [L("Pending", "Menunggu"), myPending, "var(--warning)"],
                  [L("Rejected", "Ditolak"), myRejected, "var(--danger)"],
                ] as [string, OvClaim[], string][]).map(([label, list, color]) => (
                  <li key={label}>
                    <span className={css.dot} style={{ background: color }} aria-hidden />
                    <span className={css.legendLabel}>{label}</span>
                    <span className={css.num}>{list.length}</span>
                    <span className={css.num}>{fmtRM(sum(list))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className={card} aria-label={L("Claim categories", "Kategori tuntutan")}>
          <Head icon="documents" tone={css.gold} title={<>{L("Claim Categories", "Kategori Tuntutan")} <span className={css.muted}>({monthName(month)})</span></>}
            sub={showStaff ? L("Every claim line this month, rejected left out.", "Setiap baris tuntutan bulan ini, yang ditolak tidak dikira.") : L("Your claim lines this month, rejected left out.", "Baris tuntutan anda bulan ini, yang ditolak tidak dikira.")} />
          {!loaded ? <SkelRows rows={3} /> : cats.length === 0 ? (
            <p className={css.empty}>{L("No claim lines this month.", "Tiada baris tuntutan bulan ini.")}</p>
          ) : (
            <ul className={css.bars}>
              {cats.map(([k, v]) => (
                <li key={k} className={css.barRow}>
                  <span className={`${css.barLabel} ${css.cap}`}>{catOf(k)}</span>
                  <span className={css.track}><span className={css.fill} style={{ width: `${Math.max(2, Math.round((v / catMax) * 100))}%` }} /></span>
                  <span className={css.num}>{fmtRM(v)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export function ClaimsReports({ scope, month, months, onMonth, loaded, showStaff, noOf, catOf, itemsOf, canSeeProof, openProof, onView }: {
  scope: readonly OvClaim[];
  month: string;
  months: readonly string[];
  onMonth: (m: string) => void;
  loaded: boolean;
  showStaff: boolean;
  noOf: (c: OvClaim) => string;
  catOf: (k: string) => string;
  itemsOf: (c: OvClaim) => Item[];
  canSeeProof: (c: OvClaim) => boolean;
  openProof: (c: OvClaim) => void;
  onView: (c: OvClaim) => void;
}) {
  const inMonth = scope.filter((c) => (c.claim_date ?? "").slice(0, 7) === month);
  const submitted = inMonth;
  const approved = inMonth.filter((c) => c.status === "approved");
  const paid = approved.filter((c) => c.paid_at);
  const due = approved.filter((c) => !c.paid_at);
  const pending = inMonth.filter((c) => c.status === "pending");
  const rejected = inMonth.filter((c) => c.status === "rejected");
  /* salary advances recovered by THIS payroll month, whatever their date */
  const advances = scope.filter((c) => c.claim_type === "salary_advance" && c.status !== "rejected" && c.payroll_month === month);
  /* payments released this month, by the day they were paid */
  const payments = scope.filter((c) => c.paid_at && c.paid_at.slice(0, 7) === month).sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""));
  const byCat = new Map<string, { approved: number; paid: number }>();
  for (const c of approved) for (const it of itemsOf(c)) {
    const cur = byCat.get(it.category) ?? { approved: 0, paid: 0 };
    cur.approved += it.amount_cents; if (c.paid_at) cur.paid += it.amount_cents;
    byCat.set(it.category, cur);
  }
  const csv = () => {
    const rows: (string | number)[][] = [
      [`# ${L("Claims", "Tuntutan")} — ${monthName(month)} — ${L("by claim date", "ikut tarikh tuntutan")} — ${L("Generated", "Dijana")} ${csvStampMyt()}`],
      [L("Claim no.", "No. tuntutan"), L("Claim date", "Tarikh tuntutan"), ...(showStaff ? [L("Staff", "Kakitangan")] : []), L("Type", "Jenis"), L("Category", "Kategori"), L("Description", "Keterangan"), L("Amount (RM)", "Amaun (RM)"), L("Approval", "Kelulusan"), L("Paid on", "Dibayar pada"), L("Payroll month", "Bulan gaji")],
    ];
    for (const c of [...inMonth].sort((a, b) => a.claim_date.localeCompare(b.claim_date))) {
      const its = itemsOf(c);
      rows.push([noOf(c), c.claim_date, ...(showStaff ? [properName(c.claimant_full || c.claimant || "")] : []),
        c.claim_type === "salary_advance" ? L("Salary advance", "Pendahuluan gaji") : L("Reimbursement", "Bayaran balik"),
        its.length > 1 ? its.map((i) => catOf(i.category)).join(" / ") : catOf(c.category), c.description ?? "", (c.amount_cents / 100).toFixed(2),
        c.status, c.paid_at ? c.paid_at.slice(0, 10) : "", c.payroll_month ?? ""]);
    }
    rows.push([L("TOTAL", "JUMLAH"), "", ...(showStaff ? [""] : []), "", "", "", (sum(inMonth) / 100).toFixed(2), "", "", ""]);
    downloadCsv(`claims-${month}`, rows);
  };
  const who = (c: OvClaim) => properName(c.claimant_full || c.claimant || "");

  return (
    <>
      <div className={css.toolbar}>
        <label className={css.monthPick}>
          <span className={css.sub}>{L("Month (by claim date)", "Bulan (ikut tarikh tuntutan)")}</span>
          <select className={selectClassSm} value={month} onChange={(e) => onMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        <button type="button" className={btnSm} disabled={!loaded || inMonth.length === 0} onClick={csv}><AppIcon name="download" />{L("CSV — this month", "CSV — bulan ini")}</button>
      </div>
      <KpiRow label={L("The month's claims", "Tuntutan bulan ini")}>
        <KpiTile icon="documents" tone="navy" label={L("Submitted", "Dihantar")} value={fmtRM(sum(submitted))} busy={!loaded} sub={L(`${submitted.length} claims · ${pending.length} pending · ${rejected.length} rejected`, `${submitted.length} tuntutan · ${pending.length} menunggu · ${rejected.length} ditolak`)} />
        <KpiTile icon="success" tone="green" label={L("Approved", "Diluluskan")} value={fmtRM(sum(approved))} busy={!loaded} sub={L(`${approved.length} claims`, `${approved.length} tuntutan`)} />
        <KpiTile icon="paid" tone="blue" label={L("Paid", "Dibayar")} value={fmtRM(sum(paid))} busy={!loaded} sub={L(`${paid.length} of ${approved.length} approved`, `${paid.length} daripada ${approved.length} diluluskan`)}
          bar={{ pct: sum(approved) > 0 ? (sum(paid) / sum(approved)) * 100 : 0, tone: "blue" }} />
        <KpiTile icon="pending" tone="gold" label={L("Approved, Not Paid", "Diluluskan, Belum Dibayar")} value={fmtRM(sum(due))} busy={!loaded} sub={L(`${due.length} claim${due.length === 1 ? "" : "s"} to pay`, `${due.length} tuntutan untuk dibayar`)} />
      </KpiRow>

      <div className={css.split2}>
        <section className={card} aria-label={L("Approved against paid, by category", "Diluluskan berbanding dibayar, mengikut kategori")}>
          <Head icon="chart" tone={css.gold} title={L("Approved vs Paid by Category", "Diluluskan vs Dibayar mengikut Kategori")} sub={L("Approved claim lines of the month.", "Baris tuntutan diluluskan bulan ini.")} />
          <div className={css.tWrap}>
            <table className={css.t}>
              <thead><tr><th>{L("Category", "Kategori")}</th><th className={css.num}>{L("Approved", "Diluluskan")}</th><th className={css.num}>{L("Paid", "Dibayar")}</th><th className={css.num}>{L("Still due", "Belum dibayar")}</th></tr></thead>
              <tbody>
                {!loaded ? <tr><td colSpan={4}><SkelRows rows={3} /></td></tr>
                  : byCat.size === 0 ? <tr><td colSpan={4} className={css.empty}>{L("No approved claims dated this month.", "Tiada tuntutan diluluskan bertarikh bulan ini.")}</td></tr>
                  : [...byCat.entries()].sort((a, b) => b[1].approved - a[1].approved).map(([k, v]) => (
                    <tr key={k}><td className={css.cap}>{catOf(k)}</td><td className={css.num}>{fmtRM(v.approved)}</td><td className={css.num}>{fmtRM(v.paid)}</td><td className={css.num}>{fmtRM(v.approved - v.paid)}</td></tr>
                  ))}
              </tbody>
              {loaded && byCat.size > 0 && <tfoot><tr><td>{L("Total", "Jumlah")}</td><td className={css.num}>{fmtRM(sum(approved))}</td><td className={css.num}>{fmtRM(sum(paid))}</td><td className={css.num}>{fmtRM(sum(due))}</td></tr></tfoot>}
            </table>
          </div>
        </section>

        <section className={card} aria-label={L("Salary advances", "Pendahuluan gaji")}>
          <Head icon="money" tone={css.purple} title={L("Salary Advances", "Pendahuluan Gaji")} sub={L(`Recovered from the ${monthName(month)} payslip - the payroll run deducts them.`, `Dipotong daripada slip gaji ${monthName(month)} - larian gaji memotongnya.`)} />
          {!loaded ? <SkelRows rows={2} /> : advances.length === 0 ? (
            <p className={css.empty}>{L("No salary advance is recovered from this month's payroll.", "Tiada pendahuluan gaji dipotong daripada gaji bulan ini.")}</p>
          ) : (
            <ul className={css.rows}>
              {advances.map((c) => {
                const ap = approvalChip(c.status);
                return (
                  <li key={c.id} className={css.row}>
                    <span className={css.rowMain}><span className={css.name}>{showStaff ? who(c) : noOf(c)}</span><span className={css.sub}>{showStaff ? `${noOf(c)} · ` : ""}{L("asked", "dipohon")} {dmy(c.claim_date)}</span></span>
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

      <section className={card} aria-label={L("Payment records", "Rekod bayaran")}>
        <Head icon="paid" tone={css.blue} title={L("Payment Records", "Rekod Bayaran")} sub={L(`Claims paid in ${monthName(month)}, by the day the payment was released.`, `Tuntutan dibayar pada ${monthName(month)}, ikut hari bayaran dilepaskan.`)} />
        <div className={css.tWrap}>
          <table className={css.t}>
            <thead><tr><th>{L("Paid on", "Dibayar pada")}</th><th>{L("Claim No.", "No. Tuntutan")}</th>{showStaff && <th>{L("Staff", "Kakitangan")}</th>}<th>{L("Claim date", "Tarikh tuntutan")}</th><th className={css.num}>{L("Amount", "Amaun")}</th><th>{L("Proof", "Bukti")}</th><th /></tr></thead>
            <tbody>
              {!loaded ? <tr><td colSpan={7}><SkelRows rows={3} /></td></tr>
                : payments.length === 0 ? <tr><td colSpan={7} className={css.empty}>{L("No claim payments released this month.", "Tiada bayaran tuntutan dilepaskan bulan ini.")}</td></tr>
                : payments.map((c) => (
                  <tr key={c.id}>
                    <td className={css.muted}>{dmy((c.paid_at ?? "").slice(0, 10))}</td>
                    <td className={css.mono}>{noOf(c)}</td>
                    {showStaff && <td className={css.name}>{who(c) || "—"}</td>}
                    <td className={css.muted}>{dmy(c.claim_date)}</td>
                    <td className={css.num}>{fmtRM(c.amount_cents)}</td>
                    <td>{c.payment_proof_key && canSeeProof(c)
                      ? <button type="button" className={btnSm} onClick={() => openProof(c)}>{L("Payment proof", "Bukti bayaran")}</button>
                      : <span className={c.payment_proof_key ? chipSmSuccess : chipSmWarn}>{c.payment_proof_key ? L("Attached", "Dilampirkan") : L("No proof yet", "Tiada bukti lagi")}</span>}</td>
                    <td><button type="button" className={btnSm} onClick={() => onView(c)}>{L("View", "Lihat")}</button></td>
                  </tr>
                ))}
            </tbody>
            {loaded && payments.length > 0 && <tfoot><tr><td colSpan={showStaff ? 4 : 3}>{L("Total paid", "Jumlah dibayar")}</td><td className={css.num}>{fmtRM(sum(payments))}</td><td colSpan={2} /></tr></tfoot>}
          </table>
        </div>
      </section>
    </>
  );
}

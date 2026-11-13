"use client";

/* v1.292.0 - SALES WORKSPACE 4.0: what the Overview's strip and worklist and
   the Customers & Follow-ups view show, ARRANGED from records Sales already
   holds (moved out of sales.tsx, which keeps to its size budget). Nothing
   here reads, writes or works out a figure the server did not send:
     - the strip: the week engine's sales and target, the documents'
       outstanding (the summary route's), the Payments queue's pending;
     - the worklist: unpaid invoices (their one payment action is the payment
       engine's own, actionFor), open quotations that need someone (the week
       engine's list: its recorded contact and follow-up), follow-ups due,
       new enquiries - each row opens the ORIGINAL record;
     - the board: the same records in the column their own state puts them in. */

import type { ReactNode } from "react";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import sc from "@/components/portal/sales-docs.module.css";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { actionFor, type PayActor } from "@/components/portal/payment-parts";
import { oppStatus, type WeekDash } from "@/components/portal/week-target-card";
import type { Opportunity } from "@/components/portal/sales-discipline";
import type { Enquiry } from "@/components/portal/sales-enquiries";
import type { SalesSummary, WsDoc, WsFollowUp, WsScope } from "@/components/portal/sales-workspace";
import { ScopeSwitch, SalesReportPart } from "@/components/portal/sales-workspace";
import { SalesPerformanceCard } from "@/components/portal/executive-cards";
import { shortDmy, type BoardColumn, type CustomerNeed, type ReportDef, type StripCell, type WorkRow } from "@/components/portal/sales-shell";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type Doc = WsDoc & { payment_status: string | null; customer_id?: number };
type Pv = { on: boolean; inv: Record<number, { verified_cents: number; pending_cents: number; can_report: boolean }>; pend?: { cents: number; n: number } } | null;
export interface SalesViewInput<D extends Doc = Doc> {
  unpaidInv: D[]; sDocs: D[]; overdueInv: D[]; dueFollow: WsFollowUp[]; sFollowups: WsFollowUp[];
  opps: Opportunity[]; enquiries: Enquiry[];
  pv: Pv; partPaid: Record<number, number>; payWho: PayActor; paysByReport: boolean;
  weekDash: WeekDash | null | undefined; sm: SalesSummary | null; scope: WsScope; loaded: boolean; today: string; monthKey: string;
  toPayment: (id: number, record: boolean) => void;
  openDocRow: (d: D) => void; openDocById: (id: number) => void;
  followCustomer: (customerId: number, company: string) => void; toEnquiries: () => void;
  setWsView: (v: "payments" | "reports" | "customers") => void;
  setCustFilter: (f: "followups" | "enquiries") => void;
  openOutstanding: () => void;
}
export function buildSalesViews<D extends Doc>(p: SalesViewInput<D>): { stripCells: StripCell[]; workRows: WorkRow[]; custNeeds: CustomerNeed[]; boardColumns: BoardColumn[] } {
  const { unpaidInv, sDocs, overdueInv, dueFollow, sFollowups, opps, enquiries, pv, partPaid, payWho, paysByReport, weekDash, sm, scope, loaded, today, monthKey,
    toPayment, openDocRow, openDocById, followCustomer, toEnquiries, setWsView, setCustFilter } = p;
    /* ---- the strip: four figures, each the module's own ---- */
    const wkMe = weekDash?.me ?? null;
    const pending = pv?.on && pv.pend ? pv.pend : null;
    const stripCells: StripCell[] = [
      weekDash?.outlook && scope === "all"
        ? { key: "week", icon: "money", tone: "ok", label: L("Sales (this week)", "Jualan (minggu ini)"), value: fmtRM(weekDash.company.basis_cents),
            sub: weekDash.company.basis_kind === "all_channels" ? L("all channels · sales, not cash received", "semua saluran · jualan, bukan tunai diterima") : L("invoices paid in full", "invois dibayar penuh"), onClick: () => setWsView("reports") }
        : { key: "week", icon: "money", tone: "ok", label: L("My sales (this week)", "Jualan saya (minggu ini)"), busy: !weekDash, value: wkMe ? fmtRM(wkMe.basis_cents) : "—",
            sub: L("my invoices paid in full", "invois saya dibayar penuh"), onClick: () => setWsView("reports") },
      weekDash?.outlook && scope === "all"
        ? { key: "target", icon: "target", tone: "gold", label: L("Weekly target", "Sasaran mingguan"), value: weekDash.company.target_cents === null ? L("Not set", "Belum ditetapkan") : fmtRM(weekDash.company.target_cents),
            sub: weekDash.company.pct === null ? undefined : L(`${weekDash.company.pct}% achieved · ${weekDash.outlook.days_left} working day(s) left`, `${weekDash.company.pct}% dicapai · ${weekDash.outlook.days_left} hari bekerja lagi`), onClick: () => setWsView("reports") }
        : { key: "target", icon: "target", tone: "gold", label: L("My weekly target", "Sasaran mingguan saya"), busy: !weekDash, value: wkMe?.target_cents != null ? fmtRM(wkMe.target_cents) : L("Not set", "Belum ditetapkan"),
            sub: wkMe?.pct != null ? L(`${wkMe.pct}% achieved`, `${wkMe.pct}% dicapai`) : undefined, onClick: () => setWsView("reports") },
      { key: "owed", icon: "pending", tone: "bad", label: pv?.on ? L("Verified outstanding", "Tertunggak disahkan") : L("Outstanding", "Tertunggak"), busy: !loaded,
        value: fmtRM(sm ? sm.outstanding.balance_cents : unpaidInv.reduce((x, d) => x + d.total_cents, 0)),
        sub: pv?.on ? L(`${sm ? sm.outstanding.n : unpaidInv.length} invoice(s) · less verified payments`, `${sm ? sm.outstanding.n : unpaidInv.length} invois · tolak bayaran disahkan`)
          : L(`${sm ? sm.outstanding.n : unpaidInv.length} invoice(s) · ${overdueInv.length} overdue`, `${sm ? sm.outstanding.n : unpaidInv.length} invois · ${overdueInv.length} lewat`),
        onClick: p.openOutstanding, title: L("Open the outstanding report", "Buka laporan tertunggak") },
      pending
        ? { key: "pending", icon: "verify", tone: "info", label: L("Pending payment verification", "Bayaran menunggu pengesahan"), value: fmtRM(pending.cents),
            sub: L(`${pending.n} payment(s) wait for the CEO · not money yet`, `${pending.n} bayaran menunggu CEO · belum wang`), onClick: () => setWsView("payments") }
        : { key: "followups", icon: "date", tone: "info", label: L("Follow-ups due", "Susulan perlu dibuat"), busy: !loaded, value: dueFollow.length,
            sub: L(`today or earlier · ${sFollowups.filter((f) => f.due_on < today).length} overdue`, `hari ini atau lebih awal · ${sFollowups.filter((f) => f.due_on < today).length} lewat`), onClick: () => { setCustFilter("followups"); setWsView("customers"); } },
    ];

    /* ---- the worklist: what needs someone, each row the record itself ---- */
    const invRows = unpaidInv.filter((d) => d.payment_status !== "void").map((d): WorkRow => {
      const v = pv?.inv[d.id];
      const who = { owner: d.salesperson_name ?? null, ownerId: d.salesperson_id ?? null };
      if (pv?.on && v && v.pending_cents > 0) {
        /* a payment reported and not yet verified: the owner reviews it, everyone else may look */
        const mineToVerify = payWho === "owner";
        return { key: `pay-${d.id}`, kind: "payment", customer: d.company, ref: `${d.doc_number} · ${L("payment reported", "bayaran dilaporkan")}`, cents: v.pending_cents, ...who,
          status: { label: mineToVerify ? L("Verify (CEO)", "Sahkan (CEO)") : L("Pending CEO verification", "Menunggu pengesahan CEO"), tone: "warn" }, overdue: false, rank: `1${d.created_at}`,
          action: { label: mineToVerify ? L("Review", "Semak") : L("View", "Lihat"), primary: mineToVerify, on: () => toPayment(d.id, false) }, open: () => toPayment(d.id, false) };
      }
      const paidSoFar = v?.verified_cents ?? partPaid[d.id] ?? 0;
      const late = d.payment_status === "overdue";
      /* the invoice's one action is the payment engine's own (actionFor): report it only where the server says so */
      const a = v && pv?.on && paysByReport ? actionFor({ total_cents: d.total_cents, verified_cents: v.verified_cents, pending_cents: v.pending_cents, can_report: v.can_report === true }, false, payWho) : null;
      return { key: `inv-${d.id}`, kind: "invoice", customer: d.company, ref: `${d.doc_number} · ${L(`raised ${shortDmy(d.created_at)}`, `dikeluarkan ${shortDmy(d.created_at)}`)}`, cents: Math.max(0, d.total_cents - paidSoFar), ...who,
        status: late ? { label: L("Overdue", "Lewat"), tone: "bad" } : paidSoFar > 0 ? { label: L("Partially paid", "Dibayar separa"), tone: "warn" } : { label: L("Unpaid", "Belum dibayar"), tone: "neutral" },
        overdue: late, rank: `${late ? "0" : "3"}${d.created_at}`,
        action: a && (a.kind === "report" || a.kind === "report_remaining") ? { label: a.label, on: () => toPayment(d.id, true) } : { label: L("Open", "Buka"), on: () => openDocRow(d) },
        open: () => openDocRow(d) };
    });
    /* an open quotation needs someone when it is accepted (invoice it), its follow-up is due, or nothing is booked */
    const qtRows = opps.filter((o) => !!o.acceptance?.current || !o.next || o.next.due_on <= today).map((o): WorkRow => {
      const late = !!o.next && o.next.due_on < today, accepted = !!o.acceptance?.current;
      return { key: `qt-${o.id}`, kind: "quotation", customer: o.company ?? o.doc_number, ref: `${o.doc_number} · ${L(`${o.age_days} day(s) open`, `${o.age_days} hari terbuka`)}`, cents: o.total_cents,
        owner: o.owner.name, ownerId: o.owner.id, status: { label: oppStatus(o, today)[0], tone: accepted ? "ok" : late ? "bad" : "warn" }, overdue: late,
        rank: late ? `0${o.next!.due_on}` : accepted || o.next ? "1" : `2${String(100000 - Math.min(99999, o.age_days))}`,
        action: accepted ? { label: L("Open", "Buka"), on: () => openDocById(o.id) } : { label: L("Follow up", "Susuli"), on: () => followCustomer(o.customer_id, o.company ?? o.doc_number) },
        open: () => openDocById(o.id) };
    });
    const linkedFollow = new Set(opps.flatMap((o) => (o.next ? [o.next.id] : [])));
    /* a follow-up booked on a listed quotation is said once, on that quotation's row */
    const fuRows = dueFollow.filter((f) => !linkedFollow.has(f.id)).map((f): WorkRow => {
      const late = f.due_on < today;
      return { key: `fu-${f.id}`, kind: "followup", customer: f.company, ref: f.note ?? L("Follow-up", "Susulan"), cents: null, owner: f.owner_name, ownerId: f.owner_id,
        status: late ? { label: L("Follow-up overdue", "Susulan lewat"), tone: "bad" } : { label: L("Follow-up today", "Susulan hari ini"), tone: "warn" }, overdue: late, rank: `${late ? "0" : "1"}${f.due_on}`,
        action: { label: L("Follow up", "Susuli"), on: () => followCustomer(f.customer_id, f.company) }, open: () => followCustomer(f.customer_id, f.company) };
    });
    /* contacted and qualified enquiries are being worked; the new ones wait */
    const enqRows = enquiries.filter((e) => e.status === "new").map((e): WorkRow => ({ key: `enq-${e.id}`, kind: "enquiry", customer: (e.company ?? "").trim() || e.name, ref: e.message.length > 70 ? `${e.message.slice(0, 70)}…` : e.message, cents: null,
      owner: e.assigned_name, ownerId: e.assigned_to, status: e.overdue ? { label: L(`Waiting ${e.hours_waiting ?? 0} h`, `Menunggu ${e.hours_waiting ?? 0} j`), tone: "bad" } : { label: L("New", "Baharu"), tone: "info" },
      overdue: !!e.overdue, rank: `${e.overdue ? "0" : "2"}${e.created_at}`, action: { label: e.assigned_to === null ? L("Take it", "Ambil") : L("Open", "Buka"), on: toEnquiries }, open: toEnquiries }));
    const workRows: WorkRow[] = [...invRows, ...qtRows, ...fuRows, ...enqRows];

    /* ---- Customers & Follow-ups: who needs action, and the same records as a board ---- */
    const custNeeds: CustomerNeed[] = [
      ...enquiries.filter((e) => e.status === "new").map((e): CustomerNeed => ({ key: `e-${e.id}`, customer: (e.company ?? "").trim() || e.name, kindWord: L("Enquiry", "Pertanyaan"),
        linked: e.message.length > 80 ? `${e.message.slice(0, 80)}…` : e.message, last: L(`${shortDmy(e.created_at)} · enquiry received`, `${shortDmy(e.created_at)} · pertanyaan diterima`),
        next: e.overdue ? { label: L(`Waiting ${e.hours_waiting ?? 0} h`, `Menunggu ${e.hours_waiting ?? 0} j`), tone: "bad", sub: e.assigned_to === null ? L("nobody has taken it", "belum diambil sesiapa") : undefined } : { label: L("New", "Baharu"), tone: "info", sub: e.assigned_to === null ? L("nobody has taken it", "belum diambil sesiapa") : undefined },
        owner: e.assigned_name, action: { label: e.assigned_to === null ? L("Take it", "Ambil") : L("Reply", "Balas"), on: () => setCustFilter("enquiries") }, open: () => setCustFilter("enquiries"), rank: `${e.overdue ? "0" : "2"}${e.created_at}` })),
      ...dueFollow.map((f): CustomerNeed => {
        const o = opps.find((x) => x.next?.id === f.id) ?? null;
        const late = f.due_on < today;
        return { key: `f-${f.id}`, customer: f.company, kindWord: L("Client", "Pelanggan"),
          linked: o ? `${o.doc_number} · ${fmtRM(o.total_cents)}` : f.note ?? L("Follow-up", "Susulan"),
          last: o?.last_contact?.at ? L(`${shortDmy(o.last_contact.at)} · last contact`, `${shortDmy(o.last_contact.at)} · hubungan terakhir`) : L("no contact recorded", "tiada hubungan direkodkan"),
          next: late ? { label: L("Follow-up overdue", "Susulan lewat"), tone: "bad", sub: L(`was due ${shortDmy(f.due_on)}`, `sepatutnya ${shortDmy(f.due_on)}`) } : { label: L("Follow-up today", "Susulan hari ini"), tone: "warn" },
          owner: f.owner_name, action: { label: L("Follow up", "Susuli"), primary: late, on: () => followCustomer(f.customer_id, f.company) }, open: () => followCustomer(f.customer_id, f.company), rank: `${late ? "0" : "1"}${f.due_on}` };
      }),
    ];
    const paidThisMonthDocs = sDocs.filter((d) => d.doc_type === "INV" && d.payment_status === "paid" && (d.paid_at ?? "").slice(0, 7) === monthKey);
    const oppCard = (o: Opportunity) => ({ key: `q-${o.id}`, title: o.company ?? o.doc_number, cents: o.total_cents, sub: `${o.doc_number} · ${oppStatus(o, today)[0]}`, open: () => openDocById(o.id) });
    const boardColumns: BoardColumn[] = [
      { key: "enquiry", cards: enquiries.map((e) => ({ key: `e-${e.id}`, title: (e.company ?? "").trim() || e.name, cents: null, sub: `${shortDmy(e.created_at)} · ${e.assigned_name ?? L("not taken", "belum diambil")}`, open: () => setCustFilter("enquiries") })) },
      { key: "quotation", cards: opps.filter((o) => !o.acceptance?.current && o.last_contact?.outcome !== "negotiating").map(oppCard) },
      { key: "negotiating", cards: opps.filter((o) => !o.acceptance?.current && o.last_contact?.outcome === "negotiating").map(oppCard) },
      { key: "accepted", cards: opps.filter((o) => !!o.acceptance?.current).map(oppCard) },
      { key: "closed", cards: paidThisMonthDocs.map((d) => ({ key: `c-${d.id}`, title: d.company, cents: d.total_cents, sub: `${d.doc_number} · ${L("paid", "dibayar")} ${shortDmy(d.paid_at ?? d.created_at)}`, open: () => openDocRow(d) })) },
    ];
  return { stripCells, workRows, custNeeds, boardColumns };
}

/** v1.292.0 - Reports -> Sales Performance: the month's figures the Overview
    carried before 4.0, unchanged (the same tiles, the same words, the same
    sums), and the one-line month summary. Moved here, not rewritten. */
export function SalesMonthFigures<D extends Doc>(p: {
  sm: SalesSummary | null; pv: Pv; loaded: boolean; today: string;
  paidThisMonth: D[]; lastPaid: D[]; unpaidInv: D[]; overdueInv: D[]; openQt: D[]; monthQt: D[]; monthInv: D[];
  dueFollow: WsFollowUp[]; sFollowups: WsFollowUp[];
  onClosed: () => void; onPayments: () => void; onOutstanding: () => void; onOpenQuotations: () => void; onFollowups: () => void;
}) {
  const { sm, pv, loaded, today, paidThisMonth, lastPaid, unpaidInv, overdueInv, openQt, monthQt, monthInv, dueFollow, sFollowups } = p;
  const cents = (list: D[]) => list.reduce((a, d) => a + d.total_cents, 0);
  const vsLast = (now: number, before: number): { pct: number | null; text: string; vs: string } | undefined => {
    if (!before) return undefined;
    const pct = Math.round(((now - before) / before) * 100);
    return { pct, text: `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%`, vs: L("vs last month", "berbanding bulan lepas") };
  };
  return (
    <>
    <div className={sc.tiles}>
      <KpiRow label={L("Sales this month", "Jualan bulan ini")}>
      {/* v1.281.0 - the photo's five: Collected (Verified when the CEO
          verifies payments), what waits for the CEO, what is owed, the
          open quotations and the follow-ups due */}
      <KpiTile icon="paid" tone="green" label={pv?.on ? L("Collected (Verified)", "Dikutip (Disahkan)") : L("Collected", "Dikutip")} value={fmtRM(sm ? sm.collected.cents : cents(paidThisMonth))} busy={!loaded}
        sub={L(`This month · ${sm ? sm.collected.n : paidThisMonth.length} paid in full, by payment date`, `Bulan ini · ${sm ? sm.collected.n : paidThisMonth.length} dibayar penuh, ikut tarikh bayaran`)}
        delta={sm ? vsLast(sm.collected.cents, sm.collected_last.cents) : vsLast(cents(paidThisMonth), cents(lastPaid))}
        onClick={p.onClosed} title={L("Open the closed sales", "Buka jualan ditutup")} />
      {pv?.on && pv.pend ? (
        <KpiTile icon="time" tone="gold" label={L("Reported, not verified", "Dilaporkan, belum disahkan")} value={fmtRM(pv.pend.cents)}
          sub={L(`${pv.pend.n} payment${pv.pend.n === 1 ? "" : "s"} wait${pv.pend.n === 1 ? "s" : ""} for the CEO`, `${pv.pend.n} bayaran menunggu CEO`)}
          onClick={p.onPayments} title={L("Open Payments", "Buka Bayaran")} />
      ) : sm ? (
        <KpiTile icon="money" tone="green" label={L("Cash received", "Wang diterima")} value={fmtRM(sm.cash_cents)}
          sub={L("This month · part payments included", "Bulan ini · termasuk bayaran separa")} delta={vsLast(sm.cash_cents, sm.cash_last_cents)}
          title={L("Money received this month: part payments on the day they arrived, and what was left on each invoice marked paid this month. Collected is unchanged: it counts an invoice once it is paid in full.", "Wang diterima bulan ini: bayaran separa pada hari ia tiba, dan baki setiap invois yang ditanda dibayar bulan ini. Dikutip tidak berubah: ia mengira invois setelah dibayar penuh.")} />
      ) : null}
      <KpiTile icon="pending" tone="red" label={L("Outstanding", "Tertunggak")} value={fmtRM(sm ? sm.outstanding.balance_cents : cents(unpaidInv))} busy={!loaded}
        sub={sm ? L(`${sm.outstanding.n} invoice${sm.outstanding.n === 1 ? "" : "s"} · ${overdueInv.length} overdue · ${fmtRM(sm.outstanding.total_cents)} invoiced · any month${sm.to_invoice?.n ? ` · + ${fmtRM(sm.to_invoice.cents)} not yet invoiced` : ""}`, `${sm.outstanding.n} invois · ${overdueInv.length} lewat · ${fmtRM(sm.outstanding.total_cents)} diinvois · mana-mana bulan${sm.to_invoice?.n ? ` · + ${fmtRM(sm.to_invoice.cents)} belum diinvois` : ""}`)
          : L(`${unpaidInv.length} invoice${unpaidInv.length === 1 ? "" : "s"} · ${overdueInv.length} overdue · any month`, `${unpaidInv.length} invois · ${overdueInv.length} lewat · mana-mana bulan`)}
        onClick={p.onOutstanding} title={L("Open the outstanding report", "Buka laporan tertunggak")} />
      <KpiTile icon="document" tone="purple" label={L("Open Quotations", "Sebut Harga Terbuka")} value={openQt.length} busy={!loaded}
        sub={L(`${fmtRM(cents(openQt))} · not yet invoiced`, `${fmtRM(cents(openQt))} · belum diinvois`)}
        onClick={p.onOpenQuotations} title={L("Open the quotations not yet invoiced", "Buka sebut harga yang belum diinvois")} />
      <KpiTile icon="date" tone="blue" label={L("Follow-ups due", "Susulan perlu dibuat")} value={dueFollow.length} busy={!loaded}
        sub={L(`Today or earlier · ${sFollowups.filter((f) => f.due_on < today).length} overdue`, `Hari ini atau lebih awal · ${sFollowups.filter((f) => f.due_on < today).length} lewat`)}
        onClick={p.onFollowups} title={L("Open the customers and follow-ups", "Buka pelanggan dan susulan")} />
    </KpiRow>
    </div>
    <p className="erp-meta" data-testid="sales-month-line">{L(`This month: ${sm ? sm.quotations.n : monthQt.length} quotation${(sm ? sm.quotations.n : monthQt.length) === 1 ? "" : "s"} (${fmtRM(sm ? sm.quotations.cents : cents(monthQt))}) · ${sm ? sm.invoiced.n : monthInv.length} invoice${(sm ? sm.invoiced.n : monthInv.length) === 1 ? "" : "s"} raised (${fmtRM(sm ? sm.invoiced.cents : cents(monthInv))})`,
        `Bulan ini: ${sm ? sm.quotations.n : monthQt.length} sebut harga (${fmtRM(sm ? sm.quotations.cents : cents(monthQt))}) · ${sm ? sm.invoiced.n : monthInv.length} invois dikeluarkan (${fmtRM(sm ? sm.invoiced.cents : cents(monthInv))})`)}</p>
    </>
  );
}

/** v1.292.0 - Reports: every one existed on the Overview or in Reports before
    4.0; shown ONE AT A TIME (ReportPicker), the same components and reads. */
export function salesReportDefs<D extends Doc>(p: {
  sDocs: D[]; partPaid: Record<number, number>; monthKey: string; today: string; sm: SalesSummary | null; scope: WsScope; setScope: (s: WsScope) => void;
  pv: Pv; loaded: boolean; paidThisMonth: D[]; lastPaid: D[]; unpaidInv: D[]; overdueInv: D[]; openQt: D[]; monthQt: D[]; monthInv: D[];
  dueFollow: WsFollowUp[]; sFollowups: WsFollowUp[]; companyView: boolean; weekDash: WeekDash | null | undefined; extra?: ReportDef[];
  openDocById: (id: number) => void; setWsView: (v: "closed" | "payments" | "customers") => void; setCustFilter: (f: "followups") => void;
  openDocs: (t: "QT" | "INV", status: "all" | "open") => void; openOutstanding: () => void;
}): ReportDef[] {
  const { sDocs, partPaid, monthKey, today, sm, scope, setScope, pv, loaded, paidThisMonth, lastPaid, unpaidInv, overdueInv, openQt, monthQt, monthInv, dueFollow, sFollowups, companyView, weekDash, openDocById, setWsView, setCustFilter } = p;
  const reportPart = (part: "team" | "commission" | "collected" | "ageing") => (
    <SalesReportPart part={part} docs={sDocs} partPaid={partPaid} monthKey={monthKey} today={today} summary={sm} scope={scope}
      onOpenDocs={(t) => p.openDocs(t, "all")}
      onOpenDoc={(d) => openDocById(d.id)} onClosed={() => setWsView("closed")} />
  );
  return [
    { key: "performance", label: L("Sales Performance", "Prestasi Jualan"), hint: L("This month's figures, and the company's week for management.", "Angka bulan ini, dan minggu syarikat untuk pengurusan."), node: (
      <>
        <div className={sc.scopeRow}><ScopeSwitch scope={scope} onChange={setScope} /></div>
        <SalesMonthFigures sm={sm} pv={pv} loaded={loaded} today={today} paidThisMonth={paidThisMonth} lastPaid={lastPaid} unpaidInv={unpaidInv} overdueInv={overdueInv} openQt={openQt}
          monthQt={monthQt} monthInv={monthInv} dueFollow={dueFollow} sFollowups={sFollowups} onClosed={() => setWsView("closed")} onPayments={() => setWsView("payments")}
          onOutstanding={p.openOutstanding} onOpenQuotations={() => p.openDocs("QT", "open")}
          onFollowups={() => { setCustFilter("followups"); setWsView("customers"); }} />
        {companyView && <SalesPerformanceCard onOpen={() => setWsView("closed")} pace={weekDash?.outlook ? { cents: weekDash.outlook.required_per_day_cents, allChannels: weekDash.company.basis_kind === "all_channels" } : undefined} />}
      </>
    ) },
    { key: "team", label: L("Consultant Performance & Weekly Target", "Prestasi Perunding & Sasaran Mingguan"), hint: L("The weekly target, the team, the sales advice and the open quotations in full.", "Sasaran mingguan, pasukan, nasihat jualan dan sebut harga terbuka sepenuhnya."), node: reportPart("team") },
    { key: "ageing", label: L("Quotation Ageing", "Usia Sebut Harga"), node: reportPart("ageing") },
    { key: "collected", label: L("Collected by Month & Latest Invoices", "Kutipan Bulanan & Invois Terkini"), node: reportPart("collected") },
    { key: "commission", label: L("Commission", "Komisen"), hint: L("Estimated, eligible and paid commission; the detail is in the Commission module.", "Komisen anggaran, layak dan dibayar; butiran di modul Komisen."), node: reportPart("commission") },
    ...(p.extra ?? []),
  ];
}
export type { ReactNode };

"use client";

/* v1.397.0 - SALES COMMAND CENTER, PHASE 1 (the CEO, 21-11-2026: "make A2Z OS actively
   guide the Sales Team toward consistent prospecting, timely follow-ups, better
   conversion, and measurable revenue performance").

   The parts of Sales > Overview that read GET /staff/sales/today (worker/src/sales-today.ts):
     ActionCenter        My Sales Action Center - the day's actions, most urgent first,
                         each the record itself with one action, and the Done today list
     RecentActivities    the latest records (sales, follow-ups, payments, enquiries),
                         with the CEO's five filters - Recent Payment Activity lives here now
     TeamPerformance     managers only: activity and results kept in separate column groups
     WeeklyTargetPanel   the week's target from the SAME figures the KPI strip shows

   SCREENS ONLY. Nothing here writes, completes or counts anything on its own: an action
   leaves the list when its record changes (a follow-up closed with what the customer said,
   a next follow-up booked, an enquiry answered). Call and WhatsApp open the phone's own
   apps and are never recorded as a contact - staff record what the customer said. */

import { useMemo, useState, type ReactNode } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Panel, PillSwitch } from "@/components/ui/panel";
import { SkelRows } from "@/components/ui/skeleton";
import { useCachedApi } from "@/lib/cached-api";
import { fmtRM } from "@/lib/format";
import { btnSm, btnSmPrimary, btnSmQuiet, iconBtnQuiet, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import {
  FLAG_TONE, FLAG_WORD, actionCounts, matchesFilter,
  type ActionFilter, type ActivityGroup, type SalesAction, type SalesActivity, type SalesDone, type SalesTone,
} from "@/lib/sales-priority";
import { RowMenu } from "@/components/portal/sales-shell";
import css from "./sales-today.module.css";

export type TodayScope = "mine" | "all";
export interface TeamRow { user_id: number; name: string; enquiries: number | null; followups_done: number; quotations: number; paid_invoices: number; collected_cents: number; target_cents: number | null; pct: number | null }
export interface SalesToday {
  today: string; scope: TodayScope;
  items: SalesAction[]; counts: ReturnType<typeof actionCounts>; verify: number | null;
  done: SalesDone[]; progress: { done: number; open: number };
  recent: SalesActivity[];
  team: { period: "week" | "month"; from: string; to: string; rows: TeamRow[]; total: Omit<TeamRow, "user_id" | "name"> } | null;
}

/** the topics that change the list: the same records Sales already watches */
const TOPICS = ["docs", "sales", "followups", "customers", "enquiries", "business-growth", "payments"];
export function useSalesToday(scope: TodayScope, period: "week" | "month") {
  return useCachedApi<SalesToday>(`/staff/sales/today?scope=${scope}&period=${period}`, true, TOPICS);
}

/* ---------------- the words ---------------- */
const TONE_CHIP: Record<SalesTone, string> = { red: chipSmDanger, amber: chipSmWarn, blue: chipSmInfo, grey: chipSmNeutral, green: chipSmSuccess };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const KIND_WORD: Record<SalesAction["kind"], [string, string]> = {
  followup: ["Follow-up", "Susulan"], quotation: ["Quotation", "Sebut harga"], invoice: ["Invoice", "Invois"],
  enquiry: ["Website enquiry", "Pertanyaan laman web"], growth: ["Business Growth Check", "Semakan Pertumbuhan Bisnes"],
  lead: ["Lead", "Prospek"], // v1.398.0 - an owned lead in Leads & CRM with nothing booked next
  opportunity: ["Deal", "Urusan"], // v1.399.0 - an open deal in the Sales Pipeline
};
const DONE_WORD: Record<SalesDone["kind"], [string, string]> = {
  followup_done: ["Follow-up completed", "Susulan selesai"], next_booked: ["Next follow-up booked", "Susulan seterusnya ditetapkan"],
  enquiry_replied: ["Enquiry answered", "Pertanyaan dijawab"], growth_recorded: ["Growth Check recorded", "Semakan Pertumbuhan direkod"],
  quotation_issued: ["Quotation issued", "Sebut harga dikeluarkan"], payment_reported: ["Payment reported", "Bayaran dilaporkan"],
  activity_logged: ["Contact logged", "Hubungan direkod"], // v1.398.0 - a call, WhatsApp, email, meeting, note or proposal in Leads & CRM
  deal_moved: ["Deal moved", "Urusan dialih"], // v1.399.0 - a deal moved, won or lost in the Sales Pipeline
};
/** the tone's words for a screen reader beside the chip's own words */
export function FlagChip({ item }: { item: Pick<SalesAction, "flag"> }) {
  const w = FLAG_WORD[item.flag];
  return <span className={TONE_CHIP[FLAG_TONE[item.flag]]} data-tone={FLAG_TONE[item.flag]} data-testid="action-flag" data-flag={item.flag}>{L(w[0], w[1])}</span>;
}
/** a quotation's or invoice's age: a grey fact, never "late" */
function AgeChip({ days }: { days: number }) {
  return <span className={chipSmNeutral} data-tone="grey" data-testid="action-age">{L(`Open ${days} day${days === 1 ? "" : "s"}`, `Terbuka ${days} hari`)}</span>;
}
function phoneHref(raw: string | null): { tel: string; wa: string } | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length < 7) return null;
  if (d.startsWith("0")) d = `6${d}`;
  return { tel: `tel:+${d}`, wa: `https://wa.me/${d}` };
}

/* the one action of a row, in words; what it opens is handed in by Sales */
function actionLabel(i: SalesAction): string {
  if (i.kind === "followup") return i.flag === "overdue" ? L("Follow up now", "Susuli sekarang") : L("Follow up", "Susuli");
  if (i.kind === "quotation") return i.flag === "ready" ? L("Invoice it", "Buat invois") : L("Book follow-up", "Tetapkan susulan");
  if (i.kind === "invoice") return L("Follow up payment", "Susuli bayaran");
  if (i.kind === "enquiry") return i.owner_id === null ? L("Take & reply", "Ambil & balas") : L("Reply", "Balas");
  if (i.kind === "lead") return L("Book next step", "Tetapkan langkah seterusnya");
  if (i.kind === "opportunity") return i.flag === "ready" ? L("Mark won or invoice", "Tanda berjaya atau invois") : i.flag === "no_next" ? L("Set next action", "Tetapkan tindakan seterusnya") : L("Open deal", "Buka urusan");
  return i.owner_id === null ? L("Pick up", "Ambil") : L("Open", "Buka");
}

export interface ActionHandlers {
  /** the row's one action - the record's own place in Sales */
  act: (i: SalesAction) => void;
  /** the document itself, when the row has one */
  openDoc: (docId: number) => void;
  openDone: (d: SalesDone) => void;
  toPayments: () => void;
  /** v1.418.0 - the CEO removes a test Business Growth Check entry (growth_mark_test); absent for everyone else */
  markTest?: (i: SalesAction) => void;
}

/* ================= My Sales Action Center ================= */
export function ActionCenter({ state, scope, scopeSwitch, filter, onFilter, h }: {
  state: { data: SalesToday | null; loading: boolean; failed: boolean };
  scope: TodayScope; scopeSwitch: ReactNode;
  filter: ActionFilter; onFilter: (f: ActionFilter) => void;
  h: ActionHandlers;
}) {
  const d = state.data;
  const [shown, setShown] = useState(8);
  /* v1.407.0 - the colour key sits behind one (i) beside the title, open on request */
  const [keyOpen, setKeyOpen] = useState(false);
  const keyBtn = <button type="button" className={iconBtnQuiet} aria-expanded={keyOpen} aria-controls="sales-action-key" data-testid="action-key"
    aria-label={L("What the labels mean", "Maksud label")} title={L("What the labels mean", "Maksud label")} onClick={() => setKeyOpen((v) => !v)}>
    <AppIcon name="info" />
        </button>;
  const items = useMemo(() => (d?.items ?? []).filter((i) => filter !== "done" && matchesFilter(i, filter)), [d, filter]);
  const c = d?.counts;
  const late = c?.overdue ?? 0;
  const doneN = d?.done.length ?? 0;
  const total = doneN + (c?.total ?? 0);
  const pct = total > 0 ? Math.round((doneN / total) * 100) : 0;
  const counts: Partial<Record<ActionFilter, number | null>> = d ? {
    all: c!.total, overdue: c!.overdue, today: d.items.filter((i) => matchesFilter(i, "today")).length, no_next: c!.no_next,
    enquiries: d.items.filter((i) => matchesFilter(i, "enquiries")).length, done: doneN,
  } : {};
  return (
    <Panel icon="target" tone="gold" testid="action-center" className={css.center}
      title={scope === "mine" ? L("My Sales Action Center", "Pusat Tindakan Jualan Saya") : L("Sales Action Center - everyone", "Pusat Tindakan Jualan - semua")}
      count={d ? c!.total : null}
      sub={d ? (late > 0
        ? L(`${late} overdue - start with these. Then today's, then anything with no next action.`, `${late} lewat - mulakan dengan ini. Kemudian hari ini, kemudian yang tiada tindakan seterusnya.`)
        : c!.total > 0 ? L("Nothing overdue. Work down the list: today's first, then anything with no next action.", "Tiada yang lewat. Ikut senarai: hari ini dahulu, kemudian yang tiada tindakan seterusnya.")
          : L("Nothing waits on you today.", "Tiada yang menunggu anda hari ini.")) : L("What needs you today, most urgent first.", "Apa yang perlu anda hari ini, paling segera dahulu.")}
      aside={<span className={`${css.asideRow} ${css.wideOnly}`}>{keyBtn}{scopeSwitch}</span>}>
      <span id="sales-action-center" className={css.anchor} aria-hidden />
      {/* on a phone the switch sits under the title, so the title keeps the width (both drawn; CSS picks one) */}
      <div className={`${css.narrowOnly} ${css.narrowRow}`}>{scopeSwitch}{keyBtn}</div>
      {/* the day's progress: activity recorded today beside what is still open - never a ticked box */}
      <div className={css.progress} data-testid="action-progress">
        <div className={css.progressText}>
          <strong>{d ? L(`${doneN} done today`, `${doneN} selesai hari ini`) : "—"}</strong>
          <span>{d ? L(`${c!.total} still to do`, `${c!.total} lagi perlu dibuat`) : ""}</span>
        </div>
        <span className={css.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={L("Done today", "Selesai hari ini")}>
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
      {d && d.verify !== null && d.verify > 0 && (
        <button type="button" className={css.verify} onClick={h.toPayments} data-testid="action-verify">
          <AppIcon name="verify" />
          <span>{L(`${d.verify} payment(s) wait for your verification`, `${d.verify} bayaran menunggu pengesahan anda`)}</span>
          <span className={css.verifyGo}>{L("Open Payments", "Buka Bayaran")}<AppIcon name="next" /></span>
        </button>
      )}
      <PillSwitch value={filter} onChange={(f) => { onFilter(f); setShown(8); }} label={L("Show", "Tunjuk")} testid="action-filter" counts={counts}
        options={[["all", L("All", "Semua")], ["overdue", L("Overdue", "Lewat")], ["today", L("Today", "Hari ini")], ["no_next", L("No next action", "Tiada tindakan")], ["enquiries", L("Enquiries", "Pertanyaan")], ["done", L("Done today", "Selesai")]] as const} />
      {keyOpen && <Legend />}
      {state.loading && !d ? <SkelRows rows={5} /> : state.failed && !d ? (
        <p className={css.empty} role="alert"><AppIcon name="warning" />{L("The action list could not be loaded. It will try again.", "Senarai tindakan tidak dapat dimuatkan. Ia akan cuba lagi.")}</p>
      ) : filter === "done" ? (
        <DoneList done={d?.done ?? []} open={h.openDone} />
      ) : items.length === 0 ? (
        <p className={css.empty} data-testid="action-empty"><AppIcon name="success" />{filter === "all" ? L("All clear - nothing waits on you today.", "Semua selesai - tiada yang menunggu anda hari ini.") : L("Nothing here.", "Tiada di sini.")}</p>
      ) : (
        <>
          <ul className={css.list} data-testid="action-list">
            {items.slice(0, shown).map((i) => <ActionRow key={i.key} i={i} scope={scope} h={h} today={d!.today} />)}
          </ul>
          {items.length > shown && (
            <button type="button" className={`${btnSmQuiet} ${css.more}`} onClick={() => setShown((n) => n + 8)} data-testid="action-more">
              {L(`Show ${Math.min(8, items.length - shown)} more of ${items.length - shown}`, `Tunjuk ${Math.min(8, items.length - shown)} lagi daripada ${items.length - shown}`)}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

/** the indicators, once, in words - so nobody has to guess what a colour means */
function Legend() {
  return (
    <ul id="sales-action-key" className={css.legend} data-testid="action-legend" aria-label={L("What the labels mean", "Maksud label")}>
      <li><span className={chipSmDanger}>{L("Overdue", "Lewat")}</span>{L("a follow-up date has passed", "tarikh susulan telah lepas")}</li>
      <li><span className={chipSmWarn}>{L("No next action", "Tiada tindakan")}</span>{L("nothing is booked next", "tiada yang dijadualkan")}</li>
      <li><span className={chipSmNeutral}>{L("Days open", "Hari terbuka")}</span>{L("the quotation's age, not late", "usia sebut harga, bukan lewat")}</li>
      <li><span className={chipSmSuccess}>{L("Done", "Selesai")}</span>{L("recorded today", "direkod hari ini")}</li>
    </ul>
  );
}

function ActionRow({ i, scope, h, today }: { i: SalesAction; scope: TodayScope; h: ActionHandlers; today: string }) {
  const ph = phoneHref(i.phone);
  const when = i.due_on ? (i.due_on < today ? L(`was due ${day(i.due_on)}`, `sepatutnya ${day(i.due_on)}`) : L("due today", "hari ini"))
    : i.waited_hours !== null ? L(`waiting ${i.waited_hours} h`, `menunggu ${i.waited_hours} j`) : null;
  return (
    <li className={`${css.row} ${css.actionRow}`} data-testid="action-row" data-key={i.key} data-tone={FLAG_TONE[i.flag]}>
      {/* v1.407.0 (the CEO's Overview picture) - two lines: what it is and who, then the details beside the actions */}
      <span className={css.head}>
        <FlagChip item={i} />
        {i.age_days !== null && <AgeChip days={i.age_days} />}
        {i.accepted && <span className={chipSmInfo}>{L("Accepted", "Diterima")}</span>}
        <strong className={css.customer}>{i.customer}</strong>
      </span>
      {i.cents !== null && <span className={css.amt}>{fmtRM(i.cents)}</span>}
      <span className={css.info}>
        <span className={css.meta}>
          {[L(KIND_WORD[i.kind][0], KIND_WORD[i.kind][1]), i.ref, when, scope === "all" ? (i.owner_name ?? L("not taken", "belum diambil")) : null].filter(Boolean).join(" · ")}
        </span>
        {i.note && <span className={css.note}>{i.note}</span>}
      </span>
      <span className={css.actions}>
        <button type="button" className={i.flag === "overdue" || i.flag === "waiting" || i.flag === "payment_overdue" ? btnSmPrimary : btnSm} onClick={() => h.act(i)} data-testid="action-go">{actionLabel(i)}</button>
        {ph && <a className={btnSmQuiet} href={ph.tel} aria-label={L(`Call ${i.customer}`, `Telefon ${i.customer}`)} data-testid="action-call">{L("Call", "Telefon")}</a>}
        {ph && <a className={btnSmQuiet} href={ph.wa} target="_blank" rel="noopener noreferrer" aria-label={L(`WhatsApp ${i.customer}`, `WhatsApp ${i.customer}`)} data-testid="action-wa"><AppIcon name="chat" />WhatsApp</a>}
        {/* the record's other action, behind More - the same handler as before */}
        {i.doc_id !== null && i.kind !== "quotation" && (
          <RowMenu label={L(`More for ${i.customer}`, `Lagi untuk ${i.customer}`)}>
            <button type="button" className={btnSmQuiet} onClick={() => h.openDoc(i.doc_id!)} data-testid="action-doc">{L("Open document", "Buka dokumen")}</button>
          </RowMenu>
        )}
        {i.kind === "growth" && h.markTest && (
          <RowMenu label={L(`More for ${i.customer}`, `Lagi untuk ${i.customer}`)}>
            <button type="button" className={btnSmQuiet} onClick={() => h.markTest!(i)} data-testid="action-mark-test">{L("Remove test entry", "Keluarkan entri ujian")}</button>
          </RowMenu>
        )}
      </span>
    </li>
  );
}

function DoneList({ done, open }: { done: SalesDone[]; open: (d: SalesDone) => void }) {
  if (done.length === 0) return <p className={css.empty} data-testid="done-empty"><AppIcon name="info" />{L("Nothing recorded yet today. A follow-up closed with what the customer said, a next step booked or an enquiry answered appears here.", "Belum ada yang direkod hari ini. Susulan yang ditutup dengan jawapan pelanggan, langkah seterusnya atau pertanyaan yang dijawab akan muncul di sini.")}</p>;
  return (
    <ul className={css.list} data-testid="done-list">
      {done.map((x) => (
        <li key={x.key} className={css.row} data-tone="green" data-testid="done-row">
          <span className={css.rowMain}>
            <span className={css.rowTop}><span className={chipSmSuccess} data-tone="green">{L("Done", "Selesai")}</span></span>
            <strong className={css.customer}>{x.customer || "—"}</strong>
            <span className={css.meta}>{[L(DONE_WORD[x.kind][0], DONE_WORD[x.kind][1]), x.ref, x.detail ? x.detail.replace(/_/g, " ") : null, clock(x.at)].filter(Boolean).join(" · ")}</span>
          </span>
          <span className={css.actions}><button type="button" className={btnSm} onClick={() => open(x)}>{L("Open", "Buka")}</button></span>
        </li>
      ))}
    </ul>
  );
}

/** a stored UTC time, shown in Malaysia */
function clock(ts: string): string {
  const t = Date.parse(ts.replace(" ", "T") + (/[zZ]$/.test(ts) ? "" : "Z"));
  if (Number.isNaN(t)) return ts.slice(0, 16);
  const m = new Date(t + 8 * 3600 * 1000);
  return `${m.getUTCDate()} ${MON[m.getUTCMonth()]}, ${String(m.getUTCHours()).padStart(2, "0")}:${String(m.getUTCMinutes()).padStart(2, "0")}`;
}

/* ================= Recent Activities ================= */
const ACT_WORD: Record<SalesActivity["kind"], [string, string]> = {
  quotation: ["Quotation created", "Sebut harga dibuat"], invoice: ["Invoice raised", "Invois dikeluarkan"],
  followup_done: ["Follow-up completed", "Susulan selesai"], payment_reported: ["Payment reported", "Bayaran dilaporkan"],
  payment_verified: ["Payment verified by the CEO", "Bayaran disahkan CEO"], enquiry: ["New website enquiry", "Pertanyaan laman web baharu"],
  growth: ["New Business Growth Check", "Semakan Pertumbuhan Bisnes baharu"],
  activity: ["Contact logged", "Hubungan direkod"],
};
const ACT_ICON: Record<SalesActivity["kind"], "document" | "receipt" | "success" | "upload" | "verify" | "chat" | "target"> = {
  quotation: "document", invoice: "receipt", followup_done: "success", payment_reported: "upload", payment_verified: "verify", enquiry: "chat", growth: "target", activity: "chat",
};
export function RecentActivities({ items, loading, open }: { items: SalesActivity[] | null; loading: boolean; open: (a: SalesActivity) => void }) {
  const [group, setGroup] = useState<"all" | ActivityGroup>("all");
  const rows = (items ?? []).filter((a) => group === "all" || a.group === group);
  const n = (g: ActivityGroup) => (items ?? []).filter((a) => a.group === g).length;
  return (
    <Panel icon="chart" tone="navy" title={L("Recent Activities", "Aktiviti Terkini")} testid="recent-activities"
      sub={L("The latest records in the last 30 days - payments included; use the Payments filter to see only those.", "Rekod terkini dalam 30 hari - termasuk bayaran; guna penapis Bayaran untuk melihatnya sahaja.")}>
      <PillSwitch value={group} onChange={setGroup} label={L("Show", "Tunjuk")} testid="recent-filter"
        counts={items ? { all: items.length, sales: n("sales"), followups: n("followups"), payments: n("payments"), enquiries: n("enquiries") } : {}}
        options={[["all", L("All Activities", "Semua Aktiviti")], ["sales", L("Sales & Quotations", "Jualan & Sebut Harga")], ["followups", L("Follow-ups", "Susulan")], ["payments", L("Payments", "Bayaran")], ["enquiries", L("Enquiries", "Pertanyaan")]] as const} />
      {loading && !items ? <SkelRows rows={4} /> : rows.length === 0 ? (
        <p className={css.empty}><AppIcon name="info" />{L("Nothing recorded here in the last 30 days.", "Tiada rekod di sini dalam 30 hari.")}</p>
      ) : (
        <ul className={css.feed} data-testid="recent-list">
          {rows.slice(0, 10).map((a) => (
            <li key={a.key}>
              <button type="button" className={css.feedItem} onClick={() => open(a)} data-testid="recent-row" data-group={a.group}>
                <span className={css.feedIcon} data-kind={a.kind} aria-hidden><AppIcon name={ACT_ICON[a.kind]} /></span>
                <span className={css.feedText}>
                  <strong>{L(ACT_WORD[a.kind][0], ACT_WORD[a.kind][1])} · {a.title}</strong>
                  <small>{[a.customer, a.cents !== null ? fmtRM(a.cents) : null, a.detail ? a.detail.replace(/_/g, " ") : null].filter(Boolean).join(" · ")}</small>
                </span>
                <span className={css.feedTime}>{clock(a.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ================= Team Sales Performance (managers) ================= */
export function TeamPerformance({ team, loading, period, onPeriod, toReports }: { team: SalesToday["team"]; loading: boolean; period: "week" | "month"; onPeriod: (p: "week" | "month") => void;
  /** v1.407.0 - View Full Report opens the existing Reports tab */
  toReports?: () => void }) {
  return (
    <Panel icon="users" tone="gold" title={L("Team Sales Performance", "Prestasi Jualan Pasukan")} testid="team-performance" flush
      sub={L("Activity is what each person did; results are invoices paid in full by the closer - the weekly engine's own figures.", "Aktiviti ialah apa yang dibuat; hasil ialah invois dibayar penuh oleh penutup - angka enjin mingguan.")}
      aside={<span className={css.asideRow}>
        <PillSwitch value={period} onChange={onPeriod} label={L("Period", "Tempoh")} testid="team-period" options={[["week", L("This Week", "Minggu Ini")], ["month", L("This Month", "Bulan Ini")]] as const} />
        {toReports && <button type="button" className={btnSm} onClick={toReports} data-testid="team-report">{L("View Full Report", "Lihat Laporan Penuh")}<AppIcon name="next" /></button>}
      </span>}>
      {loading && !team ? <SkelRows rows={4} /> : !team || team.rows.length === 0 ? (
        <p className={css.empty}><AppIcon name="info" />{L("No consultant on the books for this period.", "Tiada perunding untuk tempoh ini.")}</p>
      ) : (
        <div className="erp-table-scroll">
          <table className={css.table} data-testid="team-table">
            <caption className="erp-sr-only">{L("Team sales performance", "Prestasi jualan pasukan")} {team.from} - {team.to}</caption>
            <thead>
              <tr className={css.groups}>
                <th scope="col" />
                <th scope="colgroup" colSpan={3}>{L("Activity", "Aktiviti")}</th>
                <th scope="colgroup" colSpan={4} className={css.results}>{L("Results", "Hasil")}</th>
              </tr>
              <tr>
                <th scope="col">{L("Salesperson", "Jurujual")}</th>
                <th scope="col" className={css.num}>{L("Enquiries", "Pertanyaan")}</th>
                <th scope="col" className={css.num}>{L("Follow-ups done", "Susulan selesai")}</th>
                <th scope="col" className={css.num}>{L("Quotations", "Sebut harga")}</th>
                <th scope="col" className={`${css.num} ${css.results}`}>{L("Paid in full", "Dibayar penuh")}</th>
                <th scope="col" className={css.num}>{L("Collected", "Dikutip")}</th>
                <th scope="col" className={css.num}>{L("Target", "Sasaran")}</th>
                <th scope="col">{L("Achievement", "Pencapaian")}</th>
              </tr>
            </thead>
            <tbody>
              {team.rows.map((r) => <TeamLine key={r.user_id} r={r} />)}
            </tbody>
            <tfoot>
              <TeamLine r={{ ...team.total, user_id: 0, name: L("Team total", "Jumlah pasukan") }} total />
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}
function TeamLine({ r, total = false }: { r: TeamRow; total?: boolean }) {
  const pct = r.pct;
  return (
    <tr className={total ? css.totalRow : undefined}>
      <th scope="row" className={css.name}>{r.name}</th>
      <td className={css.num}>{r.enquiries ?? "—"}</td>
      <td className={css.num}>{r.followups_done}</td>
      <td className={css.num}>{r.quotations}</td>
      <td className={`${css.num} ${css.results}`}>{r.paid_invoices}</td>
      <td className={css.num}>{fmtRM(r.collected_cents)}</td>
      <td className={css.num}>{r.target_cents !== null ? fmtRM(r.target_cents) : L("Not set", "Belum ditetapkan")}</td>
      <td>
        {pct === null ? <span className={css.muted}>—</span> : (
          <span className={css.ach}>
            <span>{pct}%</span>
            <span className={css.achBar} aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></span>
          </span>
        )}
      </td>
    </tr>
  );
}

/** Team Sales Performance (managers) beside Recent Activities from a wide screen; Recent alone otherwise */
export function OverviewLower({ team, recent }: { team: ReactNode; recent: ReactNode }) {
  return <div className={css.lower} data-team={team ? "" : undefined} data-testid="overview-lower">{team}{recent}</div>;
}

/* ================= Weekly Target Progress ================= */
/** the week's target, achieved and remaining - the SAME figures the KPI strip shows, so they can never differ */
export function WeeklyTargetPanel({ mine, week, target, toReports }: {
  mine: boolean;
  week: { cents: number | null; sub: string } | null;
  target: { cents: number | null; pct: number | null; left_cents: number | null } | null;
  toReports: () => void;
}) {
  const known = week !== null && target !== null;
  const pct = target?.pct ?? null;
  return (
    <Panel icon="target" tone="gold" level={3} testid="weekly-target"
      title={mine ? L("My Weekly Target Progress", "Kemajuan Sasaran Mingguan Saya") : L("Weekly Target Progress", "Kemajuan Sasaran Mingguan")}
      aside={<button type="button" className={btnSm} onClick={toReports}>{L("Details", "Butiran")}<AppIcon name="next" /></button>}>
      {!known ? <SkelRows rows={2} /> : target!.cents === null ? (
        <p className={css.empty}><AppIcon name="info" />{L("No weekly target is set. The CEO or COO sets it in Reports.", "Tiada sasaran mingguan. CEO atau COO menetapkannya dalam Laporan.")}</p>
      ) : (
        <div className={css.target}>
          <div className={css.targetHead}>
            <strong>{fmtRM(week!.cents ?? 0)}</strong>
            <span>/ {fmtRM(target!.cents)}</span>
            <b>{pct !== null ? `${pct}%` : "—"}</b>
          </div>
          <span className={css.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct ?? 0)} aria-label={L("Weekly target achieved", "Sasaran mingguan dicapai")}>
            <span style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
          </span>
          <dl className={css.targetFacts}>
            <div><dt>{L("Target", "Sasaran")}</dt><dd>{fmtRM(target!.cents)}</dd></div>
            <div><dt>{L("Achieved", "Dicapai")}</dt><dd>{fmtRM(week!.cents ?? 0)}</dd></div>
            <div><dt>{L("Remaining", "Baki")}</dt><dd>{fmtRM(Math.max(0, target!.left_cents ?? 0))}</dd></div>
          </dl>
          <small className={css.muted}>{week!.sub}</small>
        </div>
      )}
    </Panel>
  );
}

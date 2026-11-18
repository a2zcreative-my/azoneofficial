"use client";

/* v1.368.0 - LIVE REPORTS (the CEO's directive and picture, 18-11-2026;
   claude/LIVE-REPORTS-AUDIT-REV-18NOV.md, decisions C1-C3):

   Lives inside Roster & Scheduling -> Live Reports (C1: no new sidebar item),
   laid out as the picture: the month's figures, the reports table, the latest
   live and its rule-based analysis, then the workflow, the screenshot AI and
   the key rules. One report per live, shared by everyone who took part; a
   live not on the roster is reported from its project; the AI only reads
   figures, staff confirm them, and it is never needed to submit. Review is
   one step by the CEO, COO or CCO who did not take part (C3). The AI usage
   is ALSO shown in the existing System health (C2). */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { DrawerFoot, DrawerForm, DrawerPanel, SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { api, csrfFetch } from "@/lib/api";
import { useFeedback as useFeedbackModal } from "@/components/ui/feedback-modal";
import { btnSm, btnSmAccent, btnSmQuiet, card, companyBadge, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import css from "./live-reports.module.css";

/* ---------------- shapes from worker/src/live-reports.ts ---------------- */
type Person = { user_id: number; role: string; name: string; photo_key: string | null };
type Row = {
  id: number; session_id: number; state: string; session_date: string; start_time: string; end_time: string | null; platform: string;
  project_id: number | null; project_title: string | null; project_client: string | null; client_name: string | null; company: string | null; unplanned: number;
  qt_number: string | null; inv_number: string | null;
  gmv_cents: number | null; draft_gmv_cents: number | null; duration_min: number | null; viewers: number | null; orders: number | null;
  thumb_file_id: number | null; participants: Person[];
};
type OpenLive = { id: number; session_date: string; start_time: string; end_time: string | null; platform: string; client_name: string | null; project_title: string | null; unplanned: number; project_id?: number | null; qt_number?: string | null; inv_number?: string | null };
type List = { reports: Row[]; sessions_to_report: OpenLive[]; can_review: boolean; me: number };
type Flag = { key: string; title: string; detail: string; tips: string[] };
type Analysis = { gmv_per_hour_cents: number | null; conversion: number | null; aov_cents: number | null; flags: Flag[] };
type Figures = { lives: number; reported: number; gmv_cents: number | null; viewers: number | null; orders: number | null; conversion: number | null; avg_watch_sec: number | null };
type Overview = { month: string; figures: Figures; previous: Figures; latest_report_id: number | null; latest_analysis: Analysis | null; waiting_review: number | null; can_review: boolean };
type AiUsage = { enabled: boolean; bound: boolean; cap: number; ceiling: number; free_neurons_a_day: number; screenshots: number; neurons: number; refused: number; failed: number; fallback: string | null; manual_entry: boolean; can_set?: boolean; model: string };
type Project = { id: number; title: string; client: string | null; company: "a2z" | "azoo"; status: string; qt_number?: string | null; inv_number?: string | null };
type Detail = {
  report: Record<string, number | string | null> & { id: number; state: string; session_id: number; company: string | null };
  session: { id: number; session_date: string; start_time: string; end_time: string | null; platform: string; host_user_id: number; project_id: number | null; unplanned: number } | null;
  project: Project | null; participants: Person[];
  versions: (Record<string, number | string | null> & { version: number; by_name: string | null; submitted_at: string })[];
  files: { id: number; version: number | null; file_name: string | null }[];
  readings: { id: number; file_id: number; figures: string | null; outcome: string; neurons: number | null; created_at: string }[];
  reviews: { id: number; version: number; action: string; note: string | null; by_name: string | null; created_at: string }[];
  analysis: Analysis | null; ai: AiUsage | null; can: { edit: boolean; participate: boolean; review: boolean };
};

/* the ten figures: request key, label, unit, the draft column, the version column */
const FIGS = [
  ["gmv", "GMV (RM)", "rm", "draft_gmv_cents", "gmv_cents"],
  ["viewers", "Viewers", "count", "draft_viewers", "viewers"],
  ["peak_viewers", "Peak viewers", "count", "draft_peak_viewers", "peak_viewers"],
  ["avg_watch_sec", "Average watch time (sec)", "seconds", "draft_avg_watch_sec", "avg_watch_sec"],
  ["orders", "Orders", "count", "draft_orders", "orders"],
  ["items_sold", "Items sold", "count", "draft_items_sold", "items_sold"],
  ["product_clicks", "Product clicks", "count", "draft_product_clicks", "product_clicks"],
  ["ctr", "CTR (%)", "percent", "draft_ctr_bp", "ctr_bp"],
  ["conversion", "Conversion (%)", "percent", "draft_conversion_bp", "conversion_bp"],
  ["duration_min", "Duration (min)", "minutes", "draft_duration_min", "duration_min"],
] as const;
const toForm = (unit: string, v: unknown) => (v === null || v === undefined ? "" : unit === "rm" || unit === "percent" ? String(Number(v) / 100) : String(v));

const rm = (cents: number | null | undefined) => (cents === null || cents === undefined ? "-" : `RM ${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const num = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n.toLocaleString("en-MY"));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${(x * 100).toFixed(2)}%`);
const mmss = (s: number | null | undefined) => (s === null || s === undefined ? "-" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
const hms = (min: number | null | undefined) => (min === null || min === undefined ? null : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`);
const dateWord = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const t12 = (t: string | null) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`; };
const PLATFORM: Record<string, string> = { tiktok: "TikTok", shopee: "Shopee Live", other: "Other" };
const ROLE: Record<string, string> = { host: "Host", co_host: "Co-host", assistant: "Assistant", sales: "Sales" };
const COMPANY: Record<string, string> = { a2z: "A2Z", azoo: "AZ ONE" };
const STATE: Record<string, [string, string, string]> = {
  draft: [chipSmNeutral, "Draft", "Draf"], submitted: [chipSmWarn, "Pending Review", "Menunggu Semakan"], reviewed: [chipSmInfo, "Reviewed", "Disemak"],
  accepted: [chipSmSuccess, "Accepted", "Diterima"], returned: [chipSmDanger, "Returned", "Dipulangkan"],
};
const stateWord = (k: string) => (STATE[k] ? L(STATE[k]![1], STATE[k]![2]) : k);
const fileSrc = (rid: number, fid: number) => `/api/v1/staff/live-reports/${rid}/files/${fid}`;
const delta = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : { pct: ((now - before) / before) * 100, text: `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}%`, vs: L("vs last month", "vs bulan lepas") });

/** the ONE feedback modal (v1.329.0), in three words */
function useFeedback() {
  const f = useFeedbackModal();
  return {
    done: (title: string) => f.show({ variant: "success", title }),
    error: (title: string) => f.show({ variant: "error", title }),
    notice: (title: string) => f.show({ variant: "warning", title }),
  };
}

function useLoad<T>(path: string | null, tick: number): T | null {
  const [d, setD] = useState<T | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    void api<T>(path).then((r) => { if (alive && r.ok && r.data) setD(r.data); });
    return () => { alive = false; };
  }, [path, tick]);
  return d;
}

/* v1.369.0 - the CEO (18-11-2026): every live carries its PLATFORM and its project's DOCUMENT as
   tags, so staff see at a glance they picked the right live and the right project. The document is
   the live invoice of the project's quotation when there is one, else the quotation; a live with no
   project yet is flagged. Words and numbers come from the records (worker DOC_COLS). */
function PlatformTag({ platform }: { platform: string }) {
  const tone = platform === "tiktok" ? css.pfTiktok : platform === "shopee" ? css.pfShopee : css.pfOther;
  return <span className={`${css.tag} ${tone}`} data-testid="live-tag-platform"><AppIcon name="live" />{PLATFORM[platform] ?? platform}</span>;
}
/* v1.385.0 - the project is optional (the CEO, 18-11-2026): a live with no project is an OWN live, not an error */
function DocTag({ project, qt, inv }: { project: boolean; qt?: string | null; inv?: string | null }) {
  if (!project) return <span className={`${css.tag} ${css.docOwn}`} data-testid="live-tag-doc" title={L("No project - the company's own live", "Tiada projek - live syarikat sendiri")}><AppIcon name="live" />{L("Own live", "Live sendiri")}</span>;
  if (inv) return <span className={`${css.tag} ${css.docInv}`} data-testid="live-tag-doc" title={L("The project's quotation has been invoiced", "Sebut harga projek telah diinvois")}><AppIcon name="document" />{L("Invoice", "Invois")} {inv}</span>;
  if (qt) return <span className={`${css.tag} ${css.docQt}`} data-testid="live-tag-doc" title={L("The project's quotation (not invoiced yet)", "Sebut harga projek (belum diinvois)")}><AppIcon name="document" />{L("Quotation", "Sebut harga")} {qt}</span>;
  return null;
}
const docWord = (p: { qt_number?: string | null; inv_number?: string | null }) => (p.inv_number ? ` · ${L("Invoice", "Invois")} ${p.inv_number}` : p.qt_number ? ` · ${L("Quotation", "Sebut harga")} ${p.qt_number}` : "");

function Faces({ people, max = 2 }: { people: Person[]; max?: number }) {
  return (
    <span className={css.faces} title={people.map((p) => `${p.name} (${ROLE[p.role] ?? p.role})`).join(", ")}>
      {people.slice(0, max).map((p) => <Avatar key={p.user_id} name={p.name} photoKey={p.photo_key} userId={p.user_id} />)}
      {people.length > max && <span className={css.more}>+{people.length - max}</span>}
    </span>
  );
}

function Thumb({ row }: { row: Pick<Row, "id" | "thumb_file_id" | "duration_min"> }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={css.thumb}>
      {row.thumb_file_id && !broken ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={fileSrc(row.id, row.thumb_file_id)} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : <AppIcon name="live" />}
      <span className={css.liveTag}>LIVE</span>
      {hms(row.duration_min) && <span className={css.timeTag}>{hms(row.duration_min)}</span>}
    </span>
  );
}

/* ======================================================================= */

export function LiveReports() {
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const ov = useLoad<Overview>("/staff/live-reports/overview", tick);
  const list = useLoad<List>("/staff/live-reports", tick);
  const ai = useLoad<AiUsage>(ov?.can_review ? "/staff/live-reports/ai" : null, tick);
  const [open, setOpen] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "mine" | "waiting">("all");
  const rows = useMemo(() => (list?.reports ?? []).filter((r) => filter === "all" ? true : filter === "waiting" ? r.state === "submitted" : r.participants.some((p) => p.user_id === list?.me)), [list, filter]);
  const latest = list?.reports.find((r) => r.id === ov?.latest_report_id) ?? null;
  const f = ov?.figures, p = ov?.previous;

  return (
    <div className={css.page} data-testid="live-reports">
      <KpiRow cols={6} label={L("Live performance this month", "Prestasi live bulan ini")} testid="live-kpis">
        <KpiTile icon="live" tone="blue" label={L("Total Lives", "Jumlah Live")} value={f ? num(f.lives) : "-"} busy={!ov} sub={f ? L(`${f.reported} reported`, `${f.reported} dilaporkan`) : undefined} />
        <KpiTile icon="chart" tone="green" label="GMV" value={rm(f?.gmv_cents)} busy={!ov} delta={f && p ? delta(f.gmv_cents, p.gmv_cents) : null} />
        <KpiTile icon="users" tone="green" label={L("Viewers", "Penonton")} value={num(f?.viewers)} busy={!ov} delta={f && p ? delta(f.viewers, p.viewers) : null} />
        <KpiTile icon="cart" tone="gold" label={L("Orders", "Pesanan")} value={num(f?.orders)} busy={!ov} delta={f && p ? delta(f.orders, p.orders) : null} />
        <KpiTile icon="target" tone="red" label={L("Conversion", "Penukaran")} value={pct(f?.conversion)} busy={!ov}
          delta={f?.conversion != null && p?.conversion != null ? { pct: (f.conversion - p.conversion) * 100, text: `${f.conversion >= p.conversion ? "+" : ""}${((f.conversion - p.conversion) * 100).toFixed(2)} pp`, vs: L("vs last month", "vs bulan lepas") } : null} />
        <KpiTile icon="time" tone="blue" label={L("Avg. Watch Time", "Purata Masa Tonton")} value={mmss(f?.avg_watch_sec)} busy={!ov} delta={f && p ? delta(f.avg_watch_sec, p.avg_watch_sec) : null} />
      </KpiRow>

      <div className={css.main}>
        <section className={`${card} ${css.listCard}`} aria-label={L("Live reports", "Laporan live")}>
          <div className={css.head}>
            <div className={css.headText}>
              <h2 className={css.title}>{L("Live Reports", "Laporan Live")}</h2>
              <p className={css.sub}>{L("All live performance reports - own lives and lives for a project, roster and unplanned.", "Semua laporan prestasi live - live sendiri dan live untuk projek, roster dan tidak dirancang.")}</p>
            </div>
            <div className={css.headActions}>
              <button type="button" className={btnSmAccent} onClick={() => setNewOpen(true)} data-testid="live-new"><AppIcon name="add" />{L("New Report", "Laporan Baharu")}</button>
              <label className={css.filter}>
                <AppIcon name="filter" />
                <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={L("Filter reports", "Tapis laporan")} data-testid="live-filter">
                  <option value="all">{L("All", "Semua")}</option>
                  <option value="mine">{L("Lives I took part in", "Live saya")}</option>
                  {list?.can_review && <option value="waiting">{L("Pending review", "Menunggu semakan")}</option>}
                </select>
              </label>
            </div>
          </div>
          {!list ? <SkelRows rows={4} /> : rows.length === 0 ? (
            <p className={css.empty} data-testid="live-empty">{list.reports.length ? L("No report matches the filter.", "Tiada laporan sepadan.") : L("No live report yet. Press New Report after a live - from the roster, or as an unplanned own live or live for a project.", "Belum ada laporan live. Tekan Laporan Baharu selepas live - dari roster, atau sebagai live sendiri atau live untuk projek yang tidak dirancang.")}</p>
          ) : (
            <>
              <div className={`erp-table-scroll ${css.tableWrap}`}>
              <table className={css.table} data-testid="live-table">
                <thead><tr><th aria-label={L("Screenshot", "Tangkapan skrin")} /><th>{L("Date, Time & Platform", "Tarikh, Masa & Platform")}</th><th>{L("Project", "Projek")}</th><th>{L("Participants", "Peserta")}</th><th className={css.r}>GMV</th><th>{L("Status", "Status")}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} data-testid={`live-row-${r.id}`}>
                      <td><Thumb row={r} /></td>
                      <td className={css.when}><strong>{dateWord(r.session_date)}</strong><small>{t12(r.start_time)}{r.end_time ? ` - ${t12(r.end_time)}` : ""}</small><span className={css.chips}><PlatformTag platform={r.platform} /></span></td>
                      <td><strong>{r.project_title ?? r.client_name ?? L("Own live", "Live sendiri")}</strong>
                        <span className={css.chips}>{r.company && <span className={companyBadge(r.company)}>{COMPANY[r.company]}</span>}<DocTag project={Boolean(r.project_id)} qt={r.qt_number} inv={r.inv_number} />{r.unplanned ? <span className={css.unplanned}>{L("Unplanned", "Tidak dirancang")}</span> : null}</span></td>
                      <td><Faces people={r.participants} /></td>
                      <td className={css.r}><strong>{rm(r.gmv_cents ?? r.draft_gmv_cents)}</strong></td>
                      <td className={css.stateCell}><span className={STATE[r.state]?.[0] ?? chipSmNeutral}>{stateWord(r.state)}</span>
                        <button type="button" className={btnSm} onClick={() => setOpen(r.id)} data-testid={`live-view-${r.id}`}>{L("View", "Lihat")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <ul className={css.cards} aria-label={L("Live reports", "Laporan live")}>
                {rows.map((r) => (
                  <li key={r.id}>
                    <button type="button" className={css.cardRow} onClick={() => setOpen(r.id)} data-testid={`live-card-${r.id}`}>
                      <Thumb row={r} />
                      <span className={css.cardText}>
                        <strong>{r.project_title ?? r.client_name ?? L("Own live", "Live sendiri")}</strong>
                        <small>{dateWord(r.session_date)} · {t12(r.start_time)}</small>
                        <span className={css.chips}><PlatformTag platform={r.platform} /><DocTag project={Boolean(r.project_id)} qt={r.qt_number} inv={r.inv_number} /></span>
                        <span className={css.cardFoot}><strong>{rm(r.gmv_cents ?? r.draft_gmv_cents)}</strong><span className={STATE[r.state]?.[0] ?? chipSmNeutral}>{stateWord(r.state)}</span></span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className={css.side}>
          <section className={card} aria-label={L("Latest live", "Live terkini")} data-testid="live-latest">
            <div className={css.head}><h2 className={css.title}>{L("Live Performance (Latest)", "Prestasi Live (Terkini)")}</h2>
              {latest && <button type="button" className="erp-icon-button" onClick={() => setOpen(latest.id)} aria-label={L("Open the latest report", "Buka laporan terkini")}><AppIcon name="next" /></button>}</div>
            {!ov || !list ? <SkelRows rows={3} /> : !latest ? <p className={css.empty}>{L("No submitted live yet.", "Belum ada live dihantar.")}</p> : (
              <div className={css.latest}>
                <div className={css.latestTop}>
                  <span className={css.big}><Thumb row={latest} /></span>
                  <div className={css.latestText}>
                    <strong>{latest.project_title ?? latest.client_name ?? L("Own live", "Live sendiri")}</strong>
                    {latest.company && <span className={companyBadge(latest.company)}>{COMPANY[latest.company]}</span>}
                    <small>{dateWord(latest.session_date)}</small>
                    <span className={css.chips}><PlatformTag platform={latest.platform} /><DocTag project={Boolean(latest.project_id)} qt={latest.qt_number} inv={latest.inv_number} /></span>
                    <span className={css.gmvBox}><small>GMV</small><strong>{rm(latest.gmv_cents)}</strong></span>
                  </div>
                </div>
                <dl className={css.facts}>
                  <div><dt><AppIcon name="users" />{L("Viewers", "Penonton")}</dt><dd>{num(latest.viewers)}</dd></div>
                  <div><dt><AppIcon name="time" />{L("Duration", "Tempoh")}</dt><dd>{hms(latest.duration_min) ?? "-"}</dd></div>
                  <div><dt><AppIcon name="cart" />{L("Orders", "Pesanan")}</dt><dd>{num(latest.orders)}</dd></div>
                  <div><dt><AppIcon name="target" />{L("Conversion", "Penukaran")}</dt><dd>{pct(ov.latest_analysis?.conversion)}</dd></div>
                </dl>
              </div>
            )}
          </section>
          <section className={card} aria-label={L("Performance analysis", "Analisis prestasi")} data-testid="live-analysis">
            <div className={css.head}><h2 className={css.title}>{L("Performance Analysis (Rule-Based)", "Analisis Prestasi (Berasaskan Peraturan)")}</h2></div>
            <AnalysisView a={ov?.latest_analysis ?? null} loading={!ov} />
          </section>
        </div>
      </div>

      <div className={css.bottom}>
        <section className={`${card} ${css.info}`} aria-label={L("Live report workflow", "Aliran kerja laporan live")}>
          <h2 className={css.infoTitle}><AppIcon name="assignment" />{L("Live Report Workflow", "Aliran Kerja Laporan Live")}</h2>
          <ol className={css.flow}>
            <li><span className={css.flowIcon}><AppIcon name="preview" /></span><strong>{L("Any Staff Submit Report", "Mana-mana Staf Hantar Laporan")}</strong><small>{L("Host / Co-host / Assistant / Sales", "Hos / Hos bersama / Pembantu / Jualan")}</small></li>
            <li><span className={css.flowIcon}><AppIcon name="document" /></span><strong>{L("One Report per Live", "Satu Laporan setiap Live")}</strong><small>{L("Shared by all participants", "Dikongsi semua peserta")}</small></li>
            <li><span className={css.flowIcon}><AppIcon name="verify" /></span><strong>{L("Review", "Semakan")}</strong><small>{L("CEO, COO or CCO (not a participant of the live)", "CEO, COO atau CCO (bukan peserta live)")}</small></li>
          </ol>
        </section>
        <section className={`${card} ${css.info}`} aria-label={L("Screenshot AI", "AI tangkapan skrin")} data-testid="live-ai-card">
          <h2 className={css.infoTitle}><AppIcon name="cloud" />{L("AI Screenshot (Cloudflare Workers AI)", "AI Tangkapan Skrin (Cloudflare Workers AI)")}</h2>
          <ul className={css.ticks}>
            <li>{L("Reads figures only (GMV, viewers, peak, watch time, orders, items sold, clicks, CTR, conversion, duration)", "Membaca angka sahaja (GMV, penonton, puncak, masa tonton, pesanan, item dijual, klik, CTR, penukaran, tempoh)")}</li>
            <li>{L("Free-tier only (no external AI, no new API key)", "Peringkat percuma sahaja (tiada AI luar, tiada kunci API baharu)")}</li>
            <li>{L(`Daily cap set by CEO${ai ? ` (${ai.cap} screenshots)` : ""}`, `Had harian ditetapkan CEO${ai ? ` (${ai.cap} tangkapan skrin)` : ""}`)}</li>
            <li>{L("If cap reached or AI fails → manual entry (always allowed)", "Jika had dicapai atau AI gagal → isi sendiri (sentiasa dibenarkan)")}</li>
            <li>{L("AI usage shown in System Health", "Penggunaan AI dipaparkan dalam System Health")}</li>
          </ul>
          {ai && <AiStatus ai={ai} onSaved={reload} />}
        </section>
        <section className={`${card} ${css.info}`} aria-label={L("Key rules", "Peraturan utama")}>
          <h2 className={css.infoTitle}><AppIcon name="verify" />{L("Key Rules (18 Nov 2026)", "Peraturan Utama (18 Nov 2026)")}</h2>
          <ul className={css.ticks}>
            <li>{L("Project is optional: an own live chooses its company; a live for a project takes client & company from the project", "Projek pilihan: live sendiri memilih syarikatnya; live untuk projek ambil pelanggan & syarikat daripada projek")}</li>
            <li>{L("Roster or unplanned live (system creates \"Unplanned\" roster)", "Live roster atau tidak dirancang (sistem cipta roster \"Tidak dirancang\")")}</li>
            <li>{L("Report stores both AI reading and staff-confirmed figures", "Laporan simpan bacaan AI dan angka yang disahkan staf")}</li>
            <li>{L("Analysis is rule-based (GMV/hour, conversion, AOV, trend)", "Analisis berasaskan peraturan (GMV/jam, penukaran, AOV, trend)")}</li>
            <li>{L("Staff only access (customers & agents not allowed)", "Akses staf sahaja (pelanggan & ejen tidak dibenarkan)")}</li>
            <li>{L("Reported GMV is not verified sales, cash, invoice or commission", "GMV dilaporkan bukan jualan disahkan, tunai, invois atau komisen")}</li>
          </ul>
        </section>
      </div>

      <NewReport open={newOpen} onClose={() => setNewOpen(false)} openLive={list?.sessions_to_report ?? []} onOpened={(id) => { setNewOpen(false); reload(); setOpen(id); }} />
      <ReportDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}

function AnalysisView({ a, loading }: { a: Analysis | null; loading?: boolean }) {
  if (loading) return <SkelRows rows={3} />;
  if (!a) return <p className={css.empty}>{L("The analysis appears once a live is submitted.", "Analisis dipaparkan selepas live dihantar.")}</p>;
  return (
    <div className={css.analysis}>
      <dl className={css.metrics}>
        <div><dt>{L("GMV / hour", "GMV / jam")}</dt><dd>{rm(a.gmv_per_hour_cents)}</dd></div>
        <div><dt>{L("Conversion", "Penukaran")}</dt><dd>{pct(a.conversion)}</dd></div>
        <div><dt>{L("Avg. order value", "Purata nilai pesanan")}</dt><dd>{rm(a.aov_cents)}</dd></div>
      </dl>
      {a.flags.length === 0 ? <p className={css.ok}><AppIcon name="verify" />{L("No flag: this live is in line with the earlier ones.", "Tiada bendera: live ini selari dengan sebelumnya.")}</p> : a.flags.map((f) => (
        <div key={f.key} className={css.flag} data-testid={`live-flag-${f.key}`}>
          <p className={css.flagHead}><AppIcon name="warning" /><strong>{f.title}</strong></p>
          <p className={css.flagDetail}>{f.detail}</p>
          <p className={css.tipsHead}><AppIcon name="idea" />{L("Suggested Actions", "Tindakan Dicadangkan")}</p>
          <ul className={css.tips}>{f.tips.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

function AiStatus({ ai, onSaved }: { ai: AiUsage; onSaved: () => void }) {
  const fb = useFeedback();
  const [cap, setCap] = useState(String(ai.cap));
  const [licence, setLicence] = useState(false);
  const word = !ai.bound ? L("Not connected on this server", "Tidak disambung pada pelayan ini") : !ai.enabled ? L("Off - staff type the figures", "Dimatikan - staf isi angka sendiri")
    : ai.fallback === "cap_reached" ? L("Cap reached - manual entry today", "Had dicapai - isi sendiri hari ini") : ai.fallback === "ceiling_reached" ? L("Free allowance guard reached - manual entry", "Had peruntukan percuma dicapai - isi sendiri") : L("On", "Hidup");
  const save = async (enabled: boolean) => {
    const r = await api<{ error?: { message?: string } }>("/staff/live-reports/ai", { method: "PUT", body: JSON.stringify({ enabled, cap: Number(cap), accept_licence: licence }) });
    if (r.ok) { fb.done(enabled ? L("Screenshot AI is on", "AI tangkapan skrin dihidupkan") : L("Screenshot AI is off", "AI tangkapan skrin dimatikan")); onSaved(); }
    else fb.error((r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Not saved", "Tidak disimpan"));
  };
  return (
    <div className={css.aiStatus} data-testid="live-ai-status">
      <p><strong>{L("Today", "Hari ini")}:</strong> {ai.screenshots} / {ai.cap} {L("screenshots", "tangkapan skrin")} · {ai.neurons.toLocaleString("en-MY")} / {ai.ceiling.toLocaleString("en-MY")} Neurons · {word}</p>
      {ai.can_set && (
        <div className={css.aiSet}>
          <label>{L("Daily cap", "Had harian")} <input className="erp-input erp-input-sm" type="number" min={0} max={200} value={cap} onChange={(e) => setCap(e.target.value)} /></label>
          {!ai.enabled && <label className={css.licence}><input type="checkbox" checked={licence} onChange={(e) => setLicence(e.target.checked)} data-testid="live-ai-licence" />{L("I accept the Meta Llama 3.2 licence of the Workers AI model", "Saya menerima lesen Meta Llama 3.2 model Workers AI")}</label>}
          <span className={css.aiBtns}>
            {ai.enabled ? <><button type="button" className={btnSm} onClick={() => void save(true)}>{L("Save cap", "Simpan had")}</button><button type="button" className={btnSmQuiet} onClick={() => void save(false)}>{L("Turn off", "Matikan")}</button></>
              : <button type="button" className={btnSmAccent} disabled={!licence || !ai.bound} onClick={() => void save(true)} data-testid="live-ai-on">{L("Turn on", "Hidupkan")}</button>}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------------- New report: a live I took part in, or an unplanned live ---------------- */
function NewReport({ open, onClose, openLive, onOpened }: { open: boolean; onClose: () => void; openLive: OpenLive[]; onOpened: (id: number) => void }) {
  const fb = useFeedback();
  const [mode, setMode] = useState<"roster" | "unplanned">("roster");
  const projects = useLoad<{ projects: Project[] }>(open ? "/staff/live-reports/projects" : null, open ? 1 : 0);
  const roster = useLoad<{ sessions: (OpenLive & { host_name: string })[] }>(open ? "/staff/live-reports/recent-lives" : null, open ? 1 : 0);
  const [today] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  /* v1.385.0 - an unplanned live is an OWN live (the company chosen) or a live FOR a project */
  const [form, setForm] = useState({ kind: "own" as "own" | "project", company: "", project_id: "", session_date: today, start_time: "", end_time: "", platform: "tiktok", role: "host" });
  const [joinRole, setJoinRole] = useState("co_host");
  const [existing, setExisting] = useState<{ session_id: number; id: number | null } | null>(null);
  /* v1.370.0 - the CEO (18-11-2026): nothing starts until the person has seen WHICH live it is -
     its date, project, platform and document - and pressed Yes */
  const [confirm, setConfirm] = useState<{ live: OpenLive & { host_name?: string }; join: boolean } | null>(null);
  const start = async (sid: number) => {
    const r = await api<{ id?: number; error?: { message?: string } }>("/staff/live-reports", { method: "POST", body: JSON.stringify({ session_id: sid }) });
    if (r.ok && r.data?.id) onOpened(r.data.id); else fb.error(r.data?.error?.message ?? L("Could not start the report", "Laporan tidak dapat dimulakan"));
  };
  const join = async (sid: number) => {
    const j = await api<{ error?: { code?: string; message?: string } }>(`/staff/live-reports/sessions/${sid}/participants`, { method: "POST", body: JSON.stringify({ role: joinRole }) });
    if (!j.ok && j.data?.error?.code !== "already") { fb.error(j.data?.error?.message ?? L("Could not join", "Tidak dapat menyertai")); return; }
    await start(sid);
  };
  const unplanned = async () => {
    const r = await api<{ id?: number; existing?: boolean; session_id?: number; error?: { message?: string } }>("/staff/live-reports/unplanned", { method: "POST", body: JSON.stringify({ session_date: form.session_date, start_time: form.start_time, end_time: form.end_time, platform: form.platform, role: form.role,
      ...(form.kind === "project" ? { project_id: Number(form.project_id) } : { project_id: null, company: form.company }) }) });
    if (r.ok && r.data?.id) { onOpened(r.data.id); return; }
    if (r.status === 409 && r.data?.existing && r.data.session_id) { setExisting({ session_id: r.data.session_id, id: r.data.id ?? null }); return; }
    fb.error(r.data?.error?.message ?? L("Could not record the live", "Live tidak dapat direkodkan"));
  };
  const others = roster?.sessions ?? [];
  return (
    <SideDrawer open={open} onClose={() => { setExisting(null); setConfirm(null); onClose(); }} form icon="live" title={L("New Live Report", "Laporan Live Baharu")}
      subtitle={L("One report per live - everyone who took part works on the same one.", "Satu laporan setiap live - semua peserta mengisi laporan yang sama.")}>
      <DrawerForm>
        <div className={css.modeRow} role="radiogroup" aria-label={L("Which live", "Live mana")}>
          <button type="button" role="radio" aria-checked={mode === "roster"} className={mode === "roster" ? btnSmAccent : btnSm} onClick={() => setMode("roster")} data-testid="live-mode-roster">{L("A live on the roster", "Live dalam roster")}</button>
          <button type="button" role="radio" aria-checked={mode === "unplanned"} className={mode === "unplanned" ? btnSmAccent : btnSm} onClick={() => setMode("unplanned")} data-testid="live-mode-unplanned">{L("Unplanned live", "Live tidak dirancang")}</button>
        </div>
        {mode === "roster" && confirm ? (
          <DrawerPanel icon="warning" title={L("Check this is the right live", "Semak ini live yang betul")} sub={L("Read it before you continue - a report belongs to one live only.", "Baca sebelum teruskan - satu laporan untuk satu live sahaja.")}>
            <div className={css.confirm} data-testid="live-confirm">
              <dl className={css.confirmList}>
                <div><dt>{L("Date & time", "Tarikh & masa")}</dt><dd>{dateWord(confirm.live.session_date)} · {t12(confirm.live.start_time)}{confirm.live.end_time ? ` - ${t12(confirm.live.end_time)}` : ""}</dd></div>
                <div><dt>{L("Project", "Projek")}</dt><dd>{confirm.live.project_title ?? confirm.live.client_name ?? L("Own live", "Live sendiri")}</dd></div>
                {confirm.live.host_name && <div><dt>{L("Host", "Hos")}</dt><dd>{confirm.live.host_name}</dd></div>}
                <div><dt>{L("Platform", "Platform")}</dt><dd><PlatformTag platform={confirm.live.platform} /></dd></div>
                <div><dt>{L("Document", "Dokumen")}</dt><dd><DocTag project={Boolean(confirm.live.project_id)} qt={confirm.live.qt_number} inv={confirm.live.inv_number} /></dd></div>
                {confirm.join && <div><dt>{L("Your role", "Peranan anda")}</dt><dd>{ROLE[joinRole]}</dd></div>}
              </dl>
              {!confirm.live.project_id && <p className={css.confirmWarn}>{L("This live has no project - it is reported as an own live. Choose its company in the report, or link a project if it was for one.", "Live ini tiada projek - ia dilaporkan sebagai live sendiri. Pilih syarikatnya dalam laporan, atau pautkan projek jika ia untuk projek.")}</p>}
              <span className={css.aiBtns}>
                <button type="button" className={btnSm} onClick={() => setConfirm(null)} data-testid="live-confirm-back">{L("Back", "Kembali")}</button>
                <button type="button" className={btnSmAccent} data-testid="live-confirm-yes"
                  onClick={() => { const c = confirm; setConfirm(null); void (c.join ? join(c.live.id) : start(c.live.id)); }}>
                  {confirm.join ? L("Yes, I took part - report it", "Ya, saya terlibat - laporkan") : L("Yes, report this live", "Ya, laporkan live ini")}</button>
              </span>
            </div>
          </DrawerPanel>
        ) : mode === "roster" ? (
          <>
            <DrawerPanel icon="live" title={L("Your lives waiting for a report", "Live anda menunggu laporan")} sub={L("Last 30 days", "30 hari lepas")}>
              {openLive.length === 0 ? <p className={css.empty}>{L("None waiting.", "Tiada yang menunggu.")}</p> : (
                <ul className={css.pick}>{openLive.map((s) => (
                  <li key={s.id}><span><strong>{dateWord(s.session_date)} · {t12(s.start_time)}</strong><small>{s.project_title ?? s.client_name ?? L("Own live", "Live sendiri")}</small>
                    <span className={css.chips}><PlatformTag platform={s.platform} /><DocTag project={Boolean(s.project_id)} qt={s.qt_number} inv={s.inv_number} /></span></span>
                    <button type="button" className={btnSmAccent} onClick={() => setConfirm({ live: s, join: false })} data-testid={`live-start-${s.id}`}>{L("Report", "Lapor")}</button></li>
                ))}</ul>
              )}
            </DrawerPanel>
            <DrawerPanel icon="users" title={L("A live you performed but are not listed in", "Live yang anda lakukan tetapi tidak disenaraikan")} sub={L("Add yourself, then report it", "Tambah diri anda, kemudian laporkan")}>
              <label className={css.inline}>{L("Your role", "Peranan anda")}
                <select className="erp-input erp-input-sm" value={joinRole} onChange={(e) => setJoinRole(e.target.value)}>
                  <option value="co_host">{ROLE.co_host}</option><option value="assistant">{ROLE.assistant}</option><option value="sales">{ROLE.sales}</option>
                </select></label>
              {!roster ? <SkelRows rows={2} /> : others.length === 0 ? <p className={css.empty}>{L("No other live on the roster in the last 30 days.", "Tiada live lain dalam roster 30 hari lepas.")}</p> : (
                <ul className={css.pick}>{others.map((s) => (
                  <li key={s.id}><span><strong>{dateWord(s.session_date)} · {t12(s.start_time)}</strong><small>{s.project_title ?? s.client_name ?? L("Own live", "Live sendiri")} · {L("Host", "Hos")}: {s.host_name}</small>
                    <span className={css.chips}><PlatformTag platform={s.platform} /><DocTag project={Boolean(s.project_id)} qt={s.qt_number} inv={s.inv_number} /></span></span>
                    <button type="button" className={btnSm} onClick={() => setConfirm({ live: s, join: true })} data-testid={`live-join-${s.id}`}>{L("I took part", "Saya terlibat")}</button></li>
                ))}</ul>
              )}
            </DrawerPanel>
          </>
        ) : (
          <DrawerPanel icon="folder" title={L("Unplanned live", "Live tidak dirancang")} sub={L("An own live, or a live for a project - the system adds it to the roster as Unplanned.", "Live sendiri, atau live untuk projek - sistem menambahnya ke roster sebagai Tidak dirancang.")}>
            <div className={css.modeRow} role="radiogroup" aria-label={L("What the live was for", "Live untuk apa")}>
              <button type="button" role="radio" aria-checked={form.kind === "own"} className={form.kind === "own" ? btnSmAccent : btnSm} onClick={() => setForm({ ...form, kind: "own" })} data-testid="live-u-kind-own">{L("Own live", "Live sendiri")}</button>
              <button type="button" role="radio" aria-checked={form.kind === "project"} className={form.kind === "project" ? btnSmAccent : btnSm} onClick={() => setForm({ ...form, kind: "project" })} data-testid="live-u-kind-project">{L("Live for a project", "Live untuk projek")}</button>
            </div>
            <div className={css.formGrid}>
              {form.kind === "project" ? (
                <label className={css.wide}>{L("Project (active)", "Projek (aktif)")}
                  <select className="erp-input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} data-testid="live-u-project">
                    <option value="">{L("Choose a project", "Pilih projek")}</option>
                    {(projects?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}{p.client ? ` · ${p.client}` : ""} ({COMPANY[p.company]}){docWord(p)}</option>)}
                  </select></label>
              ) : (
                <label className={css.wide}>{L("Company (whose live)", "Syarikat (live siapa)")}
                  <select className="erp-input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} data-testid="live-u-company">
                    <option value="">{L("Choose the company", "Pilih syarikat")}</option>
                    <option value="a2z">A2Z Creative Marketing</option><option value="azoo">AZ ONE Official</option>
                  </select></label>
              )}
              <label>{L("Date", "Tarikh")}<input className="erp-input" type="date" max={today} value={form.session_date} onChange={(e) => setForm({ ...form, session_date: e.target.value })} data-testid="live-u-date" /></label>
              <label>{L("Platform", "Platform")}<select className="erp-input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                <option value="tiktok">TikTok</option><option value="shopee">Shopee Live</option><option value="other">{L("Other", "Lain-lain")}</option></select></label>
              <label>{L("Start", "Mula")}<input className="erp-input" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} data-testid="live-u-start" /></label>
              <label>{L("End", "Tamat")}<input className="erp-input" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} data-testid="live-u-end" /></label>
              <label>{L("Your role", "Peranan anda")}<select className="erp-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </div>
            {(() => { const pj = form.kind === "project" ? (projects?.projects ?? []).find((p) => String(p.id) === form.project_id) : undefined; return (
              <p className={css.check} data-testid="live-u-check"><strong>{L("Check before you record:", "Semak sebelum merekod:")}</strong>
                <PlatformTag platform={form.platform} />{form.kind === "own" && form.company ? <span className={companyBadge(form.company)}>{COMPANY[form.company]}</span> : null}<DocTag project={Boolean(pj)} qt={pj?.qt_number} inv={pj?.inv_number} /></p>); })()}
            {existing && (
              <div className={css.notice} role="alert" data-testid="live-u-existing">
                <p>{L("This live is already recorded (same project or company, platform and time). Join it instead of adding another - its GMV is counted once.", "Live ini sudah direkodkan (projek atau syarikat, platform dan masa sama). Sertai sahaja - GMV dikira sekali.")}</p>
                <button type="button" className={btnSmAccent} onClick={() => void join(existing.session_id)}>{L("Join this live", "Sertai live ini")}</button>
              </div>
            )}
          </DrawerPanel>
        )}
      </DrawerForm>
      {mode === "unplanned" && (
        <DrawerFoot>
          <button type="button" className={btnSm} onClick={onClose}>{L("Cancel", "Batal")}</button>
          <button type="button" className={btnSmAccent} disabled={(form.kind === "project" ? !form.project_id : !form.company) || !form.start_time || !form.end_time} onClick={() => void unplanned()} data-testid="live-u-create">{L("Record and report", "Rekod dan lapor")}</button>
        </DrawerFoot>
      )}
    </SideDrawer>
  );
}

/* ---------------- One report ---------------- */
function ReportDrawer({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const fb = useFeedback();
  const [tick, setTick] = useState(0);
  const d = useLoad<Detail>(id ? `/staff/live-reports/${id}` : null, tick + (id ?? 0) * 1000);
  const projects = useLoad<{ projects: Project[] }>(d?.can.edit ? "/staff/live-reports/projects" : null, id ?? 0);
  const people = useLoad<{ people: { id: number; name: string }[] }>(d?.can.edit ? "/staff/live-reports/people" : null, id ?? 0);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [add, setAdd] = useState({ user_id: "", role: "co_host" });
  const r = d?.report;
  useEffect(() => {
    if (!r || !d) return;
    const v = d.versions[0];
    const draft = d.can.edit;
    const next: Record<string, string> = {};
    for (const [k, , unit, dcol, vcol] of FIGS) next[k] = toForm(unit, draft ? r[dcol] : v?.[vcol]);
    next.highlights = String((draft ? r.draft_highlights : v?.highlights) ?? "");
    next.blockers = String((draft ? r.draft_blockers : v?.blockers) ?? "");
    next.next_actions = String((draft ? r.draft_next_actions : v?.next_actions) ?? "");
    setForm(next);
  }, [d, r]);
  if (!id) return null;
  const refresh = () => { setTick((t) => t + 1); onChanged(); };
  const reading = d?.readings.find((x) => x.outcome === "read" && x.figures);
  const aiFig: Record<string, number | null> = reading?.figures ? JSON.parse(reading.figures) as Record<string, number | null> : {};
  const call = async (key: string, path: string, method: string, body?: unknown, okWord?: string): Promise<boolean> => {
    setBusy(key);
    const res = await api<{ error?: { message?: string } }>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(null);
    if (!res.ok) { fb.error(res.data?.error?.message ?? L("Not saved", "Tidak disimpan")); return false; }
    if (okWord) fb.done(okWord);
    refresh(); return true;
  };
  const saveDraft = (okWord?: string) => call("save", `/staff/live-reports/${id}/draft`, "PUT", Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v])), okWord);
  const upload = async (file: File) => {
    setBusy("upload");
    const res = await csrfFetch(`/api/v1/staff/live-reports/${id}/files`, { method: "POST", body: file, headers: { "Content-Type": file.type, "X-File-Name": file.name } });
    setBusy(null);
    if (!res.ok) { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; fb.error(j?.error?.message ?? L("Not uploaded", "Tidak dimuat naik")); return; }
    refresh();
  };
  const readAi = async (fid: number) => {
    setBusy(`ai${fid}`);
    const res = await api<{ manual: boolean; reason: string | null; detail?: string | null; figures?: Record<string, number | null> }>(`/staff/live-reports/${id}/files/${fid}/read`, { method: "POST", body: "{}" });
    setBusy(null);
    if (!res.ok || !res.data) { fb.error(L("The AI could not read it - type the figures", "AI tidak dapat membaca - isi angka sendiri")); return; }
    if (res.data.manual) {
      const why: Record<string, string> = { off: L("The screenshot AI is off", "AI tangkapan skrin dimatikan"), not_bound: L("The screenshot AI is not connected", "AI tangkapan skrin tidak disambung"), cap_reached: L("Today's AI cap is reached", "Had AI hari ini telah dicapai"), ceiling_reached: L("The free AI allowance guard is reached", "Had peruntukan AI percuma dicapai"), unreadable: L("The AI could not find figures on this screenshot", "AI tidak menemui angka pada tangkapan skrin ini"), timeout: L("The AI was too slow", "AI terlalu perlahan"), failed: L("The AI failed", "AI gagal") };
      const cf = res.data.reason === "failed" && res.data.detail ? ` (Cloudflare: ${res.data.detail.slice(0, 120)})` : "";
      fb.notice(`${why[res.data.reason ?? "failed"] ?? why.failed} - ${L("type the figures below", "isi angka di bawah")}${cf}`);
    } else fb.done(L("Figures read - check and confirm each one", "Angka dibaca - semak dan sahkan setiap satu"));
    refresh();
  };
  const useAi = () => setForm((fm) => { const n = { ...fm }; for (const [k] of FIGS) if (aiFig[k] !== null && aiFig[k] !== undefined) n[k] = String(aiFig[k]); return n; });
  const edit = Boolean(d?.can.edit);
  const s = d?.session;
  return (
    <SideDrawer open={id !== null} onClose={onClose} form icon="live" title={L("Live Report", "Laporan Live")}
      subtitle={s ? `${dateWord(s.session_date)} · ${t12(s.start_time)}${s.end_time ? ` - ${t12(s.end_time)}` : ""} · ${PLATFORM[s.platform] ?? s.platform}${s.unplanned ? ` · ${L("Unplanned", "Tidak dirancang")}` : ""}` : undefined}>
      {!d || !r ? <SkelRows rows={6} /> : (
        <DrawerForm testid="live-detail" aside={(
          <>
            <DrawerPanel icon="chart" title={L("Analysis (rule-based)", "Analisis (berasaskan peraturan)")}><AnalysisView a={d.analysis} /></DrawerPanel>
            <DrawerPanel icon="time" title={L("History", "Sejarah")}>
              <ul className={css.history}>
                {d.versions.map((v) => <li key={`v${v.version}`}>{L(`Version ${v.version} submitted by ${v.by_name ?? "-"}`, `Versi ${v.version} dihantar oleh ${v.by_name ?? "-"}`)} · {String(v.submitted_at).slice(0, 16)}</li>)}
                {d.reviews.map((w) => <li key={`w${w.id}`}>{reviewWord(w.action)} · {w.by_name ?? "-"}{w.note ? `: ${w.note}` : ""} · {w.created_at.slice(0, 16)}</li>)}
                {d.versions.length + d.reviews.length === 0 && <li>{L("Not submitted yet.", "Belum dihantar.")}</li>}
              </ul>
            </DrawerPanel>
          </>
        )}>
          <div className={css.status}><span className={STATE[r.state]?.[0] ?? chipSmNeutral}>{stateWord(r.state)}</span>
            <span className="erp-meta">{L("Reported GMV is the staff's own figure - never verified sales, cash, an invoice or commission.", "GMV dilaporkan ialah angka staf sendiri - bukan jualan disahkan, tunai, invois atau komisen.")}</span></div>

          <Section icon="folder" title={L("Project (optional)", "Projek (pilihan)")}>
            {edit ? (
              <select className="erp-input" value={d.project?.id ?? ""} onChange={(e) => void call("project", `/staff/live-reports/${id}/draft`, "PUT", { project_id: e.target.value === "" ? null : Number(e.target.value) })} data-testid="live-project">
                <option value="">{L("No project - own live", "Tiada projek - live sendiri")}</option>
                {(projects?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}{p.client ? ` · ${p.client}` : ""} ({COMPANY[p.company]}){docWord(p)}</option>)}
              </select>
            ) : <p>{d.project ? `${d.project.title}${d.project.client ? ` · ${d.project.client}` : ""}` : L("No project - own live", "Tiada projek - live sendiri")}</p>}
            {d.project && <p className="erp-meta">{L("Client", "Pelanggan")}: {d.project.client ?? "-"} · {L("Company", "Syarikat")}: {COMPANY[d.project.company]}</p>}
            {!d.project && (edit ? (
              <label className={css.inline}>{L("Company (required)", "Syarikat (wajib)")}
                <select className="erp-input erp-input-sm" value={r.company ?? ""} onChange={(e) => void call("company", `/staff/live-reports/${id}/draft`, "PUT", { company: e.target.value === "" ? null : e.target.value })} data-testid="live-company">
                  <option value="">{L("Choose the company", "Pilih syarikat")}</option>
                  <option value="a2z">A2Z Creative Marketing</option><option value="azoo">AZ ONE Official</option>
                </select></label>
            ) : <p className="erp-meta">{L("Company", "Syarikat")}: {r.company ? COMPANY[r.company] : "-"}</p>)}
            <span className={css.chips} data-testid="live-detail-tags">{s && <PlatformTag platform={s.platform} />}<DocTag project={Boolean(d.project)} qt={d.project?.qt_number} inv={d.project?.inv_number} />{s?.unplanned ? <span className={css.unplanned}>{L("Unplanned", "Tidak dirancang")}</span> : null}</span>
          </Section>

          <Section icon="users" title={L("Who took part", "Siapa yang terlibat")}>
            <ul className={css.people} data-testid="live-participants">
              {d.participants.map((p) => (
                <li key={p.user_id}><Avatar name={p.name} photoKey={p.photo_key} userId={p.user_id} /><span className={css.who}><strong>{p.name}</strong><small>{ROLE[p.role] ?? p.role}</small></span>
                  {edit && p.role !== "host" && <button type="button" className={btnSmQuiet} onClick={() => void call(`rm${p.user_id}`, `/staff/live-reports/${id}/participants/${p.user_id}/remove`, "POST", {})}>{L("Remove", "Buang")}</button>}</li>
              ))}
            </ul>
            {edit && (
              <div className={css.inline}>
                <select className="erp-input erp-input-sm" value={add.user_id} onChange={(e) => setAdd({ ...add, user_id: e.target.value })} aria-label={L("Colleague", "Rakan sekerja")} data-testid="live-add-person">
                  <option value="">{L("Add a colleague who took part", "Tambah rakan yang terlibat")}</option>
                  {(people?.people ?? []).filter((p) => !d.participants.some((x) => x.user_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="erp-input erp-input-sm" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })} aria-label={L("Role", "Peranan")}>
                  <option value="co_host">{ROLE.co_host}</option><option value="assistant">{ROLE.assistant}</option><option value="sales">{ROLE.sales}</option>
                </select>
                <button type="button" className={btnSm} disabled={!add.user_id || busy !== null} onClick={async () => { if (await call("add", `/staff/live-reports/${id}/participants`, "POST", { user_id: Number(add.user_id), role: add.role })) setAdd({ user_id: "", role: "co_host" }); }}>{L("Add", "Tambah")}</button>
              </div>
            )}
          </Section>

          <Section icon="preview" title={L("GMV screenshots", "Tangkapan skrin GMV")}>
            <ul className={css.shots}>
              {d.files.filter((f) => edit ? f.version === null : f.version === Number(r.current_version)).map((f) => {
                const rd = d.readings.find((x) => x.file_id === f.id);
                return (
                  <li key={f.id}>
                    <a href={fileSrc(id, f.id)} target="_blank" rel="noopener noreferrer" className={css.shot}>
                      <ShotImg src={fileSrc(id, f.id)} alt={f.file_name ?? L("Screenshot", "Tangkapan skrin")} />
                    </a>
                    {edit && <button type="button" className={btnSm} disabled={busy !== null || Boolean(d.ai?.manual_entry)} onClick={() => void readAi(f.id)} data-testid={`live-ai-read-${f.id}`}>
                      <AppIcon name="cloud" />{busy === `ai${f.id}` ? L("Reading...", "Membaca...") : L("Read figures with AI", "Baca angka dengan AI")}</button>}
                    {rd && <small className="erp-meta">{rd.outcome === "read" ? L("AI read it", "AI telah membaca") : L("AI found no figures", "AI tiada angka")}</small>}
                  </li>
                );
              })}
            </ul>
            {edit && (
              <label className={css.upload}>
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} data-testid="live-upload" />
                <span className={btnSm}><AppIcon name="add" />{busy === "upload" ? L("Uploading...", "Memuat naik...") : L("Add a screenshot (up to 4)", "Tambah tangkapan skrin (sehingga 4)")}</span>
              </label>
            )}
            {edit && d.ai && <p className="erp-meta" data-testid="live-ai-line">{d.ai.manual_entry ? L("Screenshot AI is not available now - type the figures (always allowed).", "AI tangkapan skrin tidak tersedia - isi angka sendiri (sentiasa dibenarkan).") : L(`Screenshot AI on · ${d.ai.screenshots}/${d.ai.cap} today`, `AI tangkapan skrin hidup · ${d.ai.screenshots}/${d.ai.cap} hari ini`)}</p>}
          </Section>

          <Section icon="chart" title={L("Figures (confirmed by staff)", "Angka (disahkan staf)")}
            action={edit && reading ? <button type="button" className={btnSm} onClick={useAi} data-testid="live-use-ai">{L("Use the AI reading", "Guna bacaan AI")}</button> : undefined}>
            <div className={css.figs}>
              {FIGS.map(([k, label, unit]) => (
                <label key={k} className={css.fig}>
                  <span>{label}</span>
                  <input className="erp-input" inputMode="decimal" type="number" min={0} step={unit === "rm" || unit === "percent" ? "0.01" : "1"} value={form[k] ?? ""} disabled={!edit}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-testid={`live-fig-${k}`} />
                  {aiFig[k] !== undefined && aiFig[k] !== null && <small className={String(aiFig[k]) === (form[k] ?? "") ? css.aiSame : css.aiDiff}>{L("AI read", "Bacaan AI")}: {aiFig[k]}</small>}
                </label>
              ))}
            </div>
          </Section>

          <Section icon="edit" title={L("Notes", "Catatan")}>
            {(["highlights", "blockers", "next_actions"] as const).map((k) => (
              <label key={k} className={css.note}><span>{k === "highlights" ? L("What went well", "Apa yang berjalan baik") : k === "blockers" ? L("What went wrong", "Apa yang tidak kena") : L("Next time", "Lain kali")}</span>
                <textarea className="erp-input" rows={2} maxLength={2000} value={form[k] ?? ""} disabled={!edit} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
            ))}
          </Section>

          {d.can.review && ["submitted", "reviewed", "accepted"].includes(r.state) && (
            <Section icon="verify" title={L("Review", "Semakan")}>
              <textarea className="erp-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("Note (required to return or reopen, 10+ characters)", "Nota (wajib untuk pulangkan atau buka semula, 10+ aksara)")} data-testid="live-review-note" />
            </Section>
          )}
        </DrawerForm>
      )}
      {d && r && (
        <DrawerFoot>
          {edit && <button type="button" className={btnSm} disabled={busy !== null} onClick={() => void saveDraft(L("Draft saved", "Draf disimpan"))} data-testid="live-save">{L("Save draft", "Simpan draf")}</button>}
          {edit && <button type="button" className={btnSmAccent} disabled={busy !== null} data-testid="live-submit"
            onClick={async () => { if (await saveDraft()) await call("submit", `/staff/live-reports/${id}/submit`, "POST", {}, L("Report submitted for review", "Laporan dihantar untuk semakan")); }}>{L("Submit", "Hantar")}</button>}
          {d.can.review && r.state === "submitted" && <button type="button" className={btnSm} onClick={() => void call("rv", `/staff/live-reports/${id}/review`, "POST", { action: "review", note }, L("Marked reviewed", "Ditanda disemak"))}>{L("Mark reviewed", "Tanda disemak")}</button>}
          {d.can.review && ["submitted", "reviewed"].includes(r.state) && <button type="button" className={btnSm} onClick={() => void call("ret", `/staff/live-reports/${id}/review`, "POST", { action: "return", note }, L("Returned for correction", "Dipulangkan untuk pembetulan"))}>{L("Return", "Pulangkan")}</button>}
          {d.can.review && ["submitted", "reviewed"].includes(r.state) && <button type="button" className={btnSmAccent} onClick={() => void call("acc", `/staff/live-reports/${id}/review`, "POST", { action: "accept", note }, L("Report accepted", "Laporan diterima"))} data-testid="live-accept">{L("Accept", "Terima")}</button>}
          {d.can.review && r.state === "accepted" && <button type="button" className={btnSm} onClick={() => void call("reo", `/staff/live-reports/${id}/review`, "POST", { action: "reopen", note }, L("Reopened", "Dibuka semula"))}>{L("Reopen", "Buka semula")}</button>}
        </DrawerFoot>
      )}
    </SideDrawer>
  );
}

const reviewWord = (a: string): string => ({ review: L("Reviewed", "Disemak"), accept: L("Accepted", "Diterima"), return: L("Returned", "Dipulangkan"), reopen: L("Reopened", "Dibuka semula") } as Record<string, string>)[a] ?? a;

function ShotImg({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  /* eslint-disable-next-line @next/next/no-img-element */
  return broken ? <AppIcon name="preview" /> : <img src={src} alt={alt} onError={() => setBroken(true)} />;
}

function Section({ icon, title, action, children }: { icon: AppIconName; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={css.section}>
      <div className={css.sectionHead}><h3><AppIcon name={icon} />{title}</h3>{action}</div>
      {children}
    </section>
  );
}

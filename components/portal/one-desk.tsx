"use client";

/**
 * ONE DESK — v1.106.0 (roadmap phase 04), two lists since v1.175.0.
 *
 * The reason to open the portal in the morning: everything waiting on the
 * person looking, from every module, in one place, oldest first, overdue on
 * top. What it lists is the WORKER's decision (worker/src/desk.ts), by the
 * same rules the acting routes enforce — this card only draws. It is
 * remembered on the device (lib/cached-api) and refetches when any of its
 * topics moves, so a claim decided on another phone leaves this desk within
 * seconds.
 *
 * v1.175.0 — TWO LISTS, BECAUSE THEY ARE TWO DIFFERENT JOBS.
 *   "Your decision"  someone else's item that cannot move until you sign it:
 *                    leave, claims, overtime, a forgotten punch, commission,
 *                    a task of yours whose scope is finished. Nobody else can
 *                    clear these.
 *   "Your work"      your own tasks, news you have not acknowledged, and the
 *                    enquiries you are answering — things that clear when you
 *                    do them.
 * Merged, a CEO with nine of his own tasks could not see the two approvals
 * holding other people up. Each row now also says, in words, what the next
 * action IS — "Approve or reject", "Review as HR" — so the desk answers the
 * question without being opened.
 *
 * WHY ONLY ONE ROW ACTS IN PLACE. An unassigned new enquiry can be TAKEN from
 * here: the row shows everything that decision needs (who wrote in, what
 * about, that nobody owns it), taking is not an approval, and it is undone by
 * reassigning. Every other bucket is an approval whose evidence — the leave
 * dates and who covers the shift, the claim's receipt, the overtime pair, the
 * punch's context — is NOT in a one-line row, so those rows only ever open
 * the record where the evidence is. A desk that approves what it cannot show
 * is worse than a desk that links.
 *
 * WHEN THERE IS NOTHING, it says so in one quiet line and takes no room. A
 * desk that shows an empty box with a heading is a desk asking to be
 * ignored; the whole value is that when it has something, it is the first
 * thing you see.
 */

import { useMemo, useState } from "react";
import { useCachedApi } from "@/lib/cached-api";
import { applyVersions, getVersion } from "@/lib/live";
import { makeApi } from "@/lib/api";
import { Skel, StaleHint } from "@/components/ui/skeleton";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { btnSm, btnSmQuiet, card, chipAction, chipNeutral } from "@/lib/ui-styles";
import { revealAnchor } from "@/components/portal/page-shared";
import { getLang } from "@/lib/i18n";
import css from "./one-desk.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const api = makeApi(""); // the enquiries door is /api/v1/enquiries, not /staff

export interface DeskItem {
  bucket: "leave" | "claims" | "ot" | "punches" | "commission" | "tasks" | "news" | "enquiries";
  id: string; title: string; sub: string; since: string | null; tab: string; overdue: boolean;
  /** v1.175.0 — which list it belongs in; see the worker */
  kind?: "decide" | "do";
  who?: string | null;
  next?: string;
  takeable?: true;
}
interface DeskData { items: DeskItem[]; counts: Record<string, number>; total: number; missing: string[] }

/* v1.154.0 - where inside the tab the decision is made. The tab alone left
   the CEO at the top of Attendance with five cards between him and the OT
   he had pressed. Buckets without an anchor land on the tab top, which is
   where their pending list already is. */
const ANCHOR: Partial<Record<DeskItem["bucket"], string>> = {
  ot: "ot-approvals",
  punches: "pending-punches",
  claims: "claims-pending",
};
const BUCKET: Record<DeskItem["bucket"], [string, string]> = {
  leave: ["Leave", "Cuti"],
  claims: ["Claims", "Tuntutan"],
  ot: ["Overtime", "Kerja lebih masa"],
  punches: ["Punches", "Ketukan"],
  commission: ["Commission", "Komisen"],
  tasks: ["Tasks", "Tugasan"],
  news: ["News", "Berita"],
  enquiries: ["Enquiries", "Pertanyaan"], // v1.112.0
};

/* v1.175.0 - a desk cached by an older build, or served by a worker that has
   not been deployed yet, has no `kind`. Rather than dropping every approval
   into "your work", read it from the bucket the same way the worker does. */
const DECIDE_BUCKETS: readonly string[] = ["leave", "claims", "ot", "punches", "commission"];
const kindOf = (i: DeskItem): "decide" | "do" =>
  i.kind ?? (DECIDE_BUCKETS.includes(i.bucket) || i.id.startsWith("task-close:") ? "decide" : "do");

/** "3d", "5h", "just now" — how long it has waited, in one glance. */
function waited(since: string | null): string {
  if (!since) return "";
  const t = new Date(since.replace(" ", "T") + (since.endsWith("Z") ? "" : "Z")).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return L("just now", "baru sahaja");
  if (m < 60 * 24) return `${Math.round(m / 60)}${L("h", "j")}`;
  return `${Math.round(m / 1440)}${L("d", "h")}`;
}

const SHOW_FIRST = 8;

/* v1.171.0 - `bare`: drawn inside a frame the Dashboard owns (the executive
   tier's "Waiting on me" card, shared with the watchers), so the desk brings
   no card of its own. Everything else - the quiet line, the list, the
   order - is the same. */
export function OneDesk({ go, userId, bare = false }: { go: (tab: string) => void; userId?: number; bare?: boolean }) {
  /* the topics every bucket can move on - a write anywhere here refetches */
  const desk = useCachedApi<DeskData>("/staff/desk", true,
    ["leave", "claims", "attendance", "tasks", "announcements", "erp", "users", "enquiries"]);
  const [all, setAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [failWhy, setFailWhy] = useState("");
  const items = useMemo(() => desk.data?.items ?? [], [desk.data]);
  const counts = desk.data?.counts ?? {};
  const decide = useMemo(() => items.filter((i) => kindOf(i) === "decide"), [items]);
  const mine = useMemo(() => items.filter((i) => kindOf(i) !== "decide"), [items]);

  /* v1.175.0 - the one action the desk performs. It is the enquiries panel's
     own call (PATCH /enquiries/:id { assigned_to }), so there is one way to
     take an enquiry, not two. On success the `enquiries` topic is moved
     forward locally: this desk and the Enquiries tab both subscribe to it, so
     the counts and the list correct themselves without a reload. On failure
     nothing is lost - the row stays, the reason is shown, and the button
     becomes Try again. */
  const take = async (i: DeskItem) => {
    if (!userId || busyId) return;
    const enquiryId = Number(i.id.split(":")[1]);
    if (!Number.isFinite(enquiryId)) return;
    setBusyId(i.id); setFailedId(null); setFailWhy("");
    const r = await api<{ ok?: boolean; error?: { message?: string } }>(
      `/enquiries/${enquiryId}`, { method: "PATCH", body: JSON.stringify({ assigned_to: userId }) },
    );
    setBusyId(null);
    if (r.ok) { applyVersions({ enquiries: getVersion("enquiries") + 1 }); desk.refresh(); return; }
    setFailedId(i.id);
    setFailWhy(r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"));
  };

  if (desk.loading) {
    return (
      <div className={bare ? "" : card} aria-busy="true">
        <Skel className="h-4 w-44" />
        <div className="mt-3 space-y-2">
          <Skel className="h-9 rounded-lg" /><Skel className="h-9 rounded-lg" /><Skel className="h-9 rounded-lg" />
        </div>
      </div>
    );
  }

  if (desk.failed && !desk.data) {
    return (
      <div className={bare ? "" : card} role="alert">
        <p className="text-danger text-sm font-semibold">
          {L("Your work queue could not be loaded.", "Senarai kerja anda tidak dapat dimuatkan.")}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {L("Nothing has been marked complete. Try loading the queue again.", "Tiada kerja ditandakan selesai. Cuba muatkan senarai sekali lagi.")}
        </p>
        <button type="button" className={`${btnSm} mt-3`} onClick={desk.refresh}>
          {L("Try again", "Cuba lagi")}
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 px-1 text-xs" role="status">
        <span aria-hidden className="bg-success inline-block h-1.5 w-1.5 rounded-full" />
        {L("Nothing is waiting on you.", "Tiada apa yang menunggu anda.")}
        <StaleHint show={desk.stale} />
      </p>
    );
  }

  const overdue = items.filter((i) => i.overdue).length;

  const row = (i: DeskItem) => {
    const open = () => { go(i.tab); revealAnchor(ANCHOR[i.bucket]); };
    const canTake = Boolean(i.takeable && userId);
    return (
      <li key={i.id} className="erp-list-row">
        <button type="button" onClick={open} className={`erp-row-lead ${css.open}`}
          title={L(`Open in ${i.tab}`, `Buka dalam ${i.tab}`)}>
          <span aria-hidden className={`erp-dot ${i.overdue ? "erp-dot-warning" : "erp-dot-brand"}`} />
          <span className={css.lines}>
            <span className={css.title}>{i.title}</span>
            <span className="erp-meta">{i.sub}</span>
            {i.next && <span className={css.next}>{i.next}</span>}
          </span>
        </button>
        <span className="erp-row-actions">
          <span className={`erp-num erp-nowrap erp-text-xs ${i.overdue ? "erp-warning erp-medium" : "erp-muted"}`}>
            {waited(i.since)}
          </span>
          {canTake && (
            <button type="button" className={btnSmQuiet} disabled={busyId === i.id} aria-busy={busyId === i.id}
              onClick={() => void take(i)}
              title={L("Assign this enquiry to you — it stays on your desk until you answer it", "Tetapkan pertanyaan ini kepada anda — ia kekal di meja anda sehingga dijawab")}>
              {busyId === i.id ? L("Taking…", "Mengambil…") : failedId === i.id ? L("Try again", "Cuba lagi") : L("Take it", "Ambil")}
            </button>
          )}
          {!canTake && <AppIcon name="next" className="erp-muted" />}
          {failedId === i.id && (
            <span className="erp-error" role="alert">{L("Not taken", "Tidak diambil")} — {failWhy}</span>
          )}
        </span>
      </li>
    );
  };

  const group = (label: string, hint: string, list: DeskItem[]) => {
    if (list.length === 0) return null;
    const shown = all ? list : list.slice(0, SHOW_FIRST);
    return (
      <section className="erp-mt-3">
        <p className="erp-eyebrow">{label} — {list.length}</p>
        <p className="erp-meta">{hint}</p>
        <ul className="erp-mt-2">{shown.map(row)}</ul>
      </section>
    );
  };

  return (
    <div className={bare ? "" : `${card} border-l-4`} style={bare ? undefined : { borderLeftColor: overdue ? "var(--warning)" : "var(--gold-solid)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <PanelTitle icon="orders" className="flex-wrap">
            {L(`Waiting on you — ${items.length}`, `Menunggu anda — ${items.length}`)}
            <StaleHint show={desk.stale} className="ml-2" />
          </PanelTitle>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {overdue > 0
              ? L(`${overdue} of these have waited longer than they should.`, `${overdue} daripadanya telah menunggu lebih lama daripada sepatutnya.`)
              : L("Pending review and action", "Menunggu semakan dan tindakan")}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {(Object.keys(BUCKET) as DeskItem["bucket"][]).filter((b) => counts[b]).map((b) => (
            <button key={b} type="button"
              className={`${chipNeutral} ${chipAction} text-foreground/80 tabular-nums hover:bg-secondary/70`}
              onClick={() => { go(items.find((i) => i.bucket === b)?.tab ?? "Dashboard"); revealAnchor(ANCHOR[b]); }}
              title={L(`Open ${BUCKET[b][0]}`, `Buka ${BUCKET[b][1]}`)}>
              {L(BUCKET[b][0], BUCKET[b][1])} {counts[b]}
            </button>
          ))}
        </span>
      </div>

      {group(
        L("Your decision", "Keputusan anda"),
        L("Nobody else can move these.", "Tiada orang lain boleh menggerakkannya."),
        decide,
      )}
      {group(
        L("Your work", "Kerja anda"),
        L("Yours to do, answer or acknowledge.", "Untuk anda lakukan, jawab atau akui."),
        mine,
      )}

      {(decide.length > SHOW_FIRST || mine.length > SHOW_FIRST) && (
        <button type="button" className={`${btnSm} mt-3`} onClick={() => setAll((v) => !v)}>
          {all ? L("Show fewer", "Tunjuk kurang") : L(`Show all ${items.length}`, `Tunjuk semua ${items.length}`)}
        </button>
      )}
    </div>
  );
}

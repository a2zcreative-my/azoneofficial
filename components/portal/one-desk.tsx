"use client";

/**
 * ONE DESK — v1.106.0 (roadmap phase 04). A PAGE since v1.176.0.
 *
 * What is waiting on the person looking, from every module, by the same rules
 * the acting routes enforce (worker/src/desk.ts) — this file only draws. It is
 * remembered on the device (lib/cached-api) and refetches when any of its
 * topics moves, so a claim decided on another phone leaves within seconds.
 *
 * v1.176.0 — ONE QUEUE, ONE HOME, THREE VIEWS OF THE SAME DATA.
 * The owner, 22-09-2026, on duplicated information: the Dashboard was showing
 * the whole queue, the Desk stop was the Dashboard scrolled down (so the
 * header said "Today"), and his own open tasks appeared in six places. So:
 *
 *   `useDeskData()`  the ONE request. Everything below reads it; the shared
 *                    cache means a second view costs no second fetch.
 *   `DeskSummary`    the Dashboard's compact card — counts and at most two
 *                    previews, then "Open the Desk". Never the whole queue.
 *   `DeskQueue`      the Desk page's lists.
 *   `DeskRow`        one row, used by both, so a status can only be written
 *                    once.
 *
 * THE TWO LISTS, which are two different jobs:
 *   "Needs your decision"  someone else's item that cannot move until you
 *                          sign it. Nobody else can clear these.
 *   "Needs attention"      operational exceptions and things that clear when
 *                          you answer them.
 * Your own tasks are NOT listed here at all — Tasks owns them, and this page
 * shows a count and a link. A queue that also runs your to-do list is two
 * products in one scroll.
 *
 * ONE STATUS, ONE NEXT ACTION per row: the worker's `sub` says what the item
 * is and what state it is in, `next` says what you do. Never both.
 *
 * WHY ONLY ONE ROW ACTS IN PLACE. An unassigned new enquiry can be TAKEN from
 * here: the row shows everything that decision needs (who wrote in, what
 * about, that nobody owns it), taking is not an approval, and it is undone by
 * reassigning. Every other bucket is an approval whose evidence — the leave
 * dates and who covers the shift, the claim's receipt, the overtime pair, the
 * punch's context — is NOT in a one-line row, so those rows only ever open
 * the record where the evidence is. A desk that approves what it cannot show
 * is worse than a desk that links.
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
export interface DeskData { items: DeskItem[]; counts: Record<string, number>; total: number; missing: string[] }

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
   into the wrong list, read it from the bucket the same way the worker does. */
const DECIDE_BUCKETS: readonly string[] = ["leave", "claims", "ot", "punches", "commission"];
export const kindOf = (i: DeskItem): "decide" | "do" =>
  i.kind ?? (DECIDE_BUCKETS.includes(i.bucket) || i.id.startsWith("task-close:") ? "decide" : "do");

/** "3d", "5h", "just now" — how long it has waited, in one glance. */
export function waited(since: string | null): string {
  if (!since) return "";
  const t = new Date(since.replace(" ", "T") + (since.endsWith("Z") ? "" : "Z")).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return L("just now", "baru sahaja");
  if (m < 60 * 24) return `${Math.round(m / 60)}${L("h", "j")}`;
  return `${Math.round(m / 1440)}${L("d", "h")}`;
}

/**
 * THE ONE REQUEST. Both the Dashboard summary and the Desk page call this;
 * `useCachedApi` keys on the path, so the second caller is served from the
 * same cache entry and the same live subscription — one fetch, two views,
 * and they cannot disagree.
 */
export function useDeskData() {
  /* the topics every bucket can move on - a write anywhere here refetches */
  return useCachedApi<DeskData>("/staff/desk", true,
    ["leave", "claims", "attendance", "tasks", "announcements", "erp", "users", "enquiries"]);
}

/** The three lists the surfaces need, split once so they cannot drift apart. */
export function splitDesk(items: readonly DeskItem[]) {
  const decide = items.filter((i) => kindOf(i) === "decide");
  /* "attention": operational exceptions and things that clear when answered.
     Your OWN tasks are deliberately absent - Tasks owns them, and the Desk
     shows a count and a link instead of a second to-do list. */
  const attention = items.filter((i) => kindOf(i) === "do" && i.bucket !== "tasks");
  const myTasks = items.filter((i) => kindOf(i) === "do" && i.bucket === "tasks");
  return { decide, attention, myTasks };
}

/* ===================== one row ===================== */

export function DeskRow({ item, go, onTake, busy, failed, failWhy }: {
  item: DeskItem;
  go: (tab: string) => void;
  onTake?: (i: DeskItem) => void;
  busy?: boolean;
  failed?: boolean;
  failWhy?: string;
}) {
  const i = item;
  const canTake = Boolean(i.takeable && onTake);
  return (
    <li className="erp-list-row">
      <button type="button" className={`erp-row-lead ${css.open}`}
        onClick={() => { go(i.tab); revealAnchor(ANCHOR[i.bucket]); }}
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
          <button type="button" className={btnSmQuiet} disabled={busy} aria-busy={busy}
            onClick={() => onTake?.(i)}
            title={L("Assign this enquiry to you — it stays on your desk until you answer it", "Tetapkan pertanyaan ini kepada anda — ia kekal di meja anda sehingga dijawab")}>
            {busy ? L("Taking…", "Mengambil…") : failed ? L("Try again", "Cuba lagi") : L("Take it", "Ambil")}
          </button>
        )}
        {!canTake && <AppIcon name="next" className="erp-muted" />}
        {failed && <span className="erp-error" role="alert">{L("Not taken", "Tidak diambil")} — {failWhy}</span>}
      </span>
    </li>
  );
}

/* v1.175.0 - the one action the desk performs, shared by every view of it. It
   is the enquiries panel's own call (PATCH /enquiries/:id { assigned_to }), so
   there is one way to take an enquiry, not two. On success the `enquiries`
   topic is moved forward locally: every subscriber - this desk, the Dashboard
   summary and the Enquiries tab - corrects itself without a reload. On failure
   nothing is lost: the row stays, the reason is shown, the button says Try
   again, and a second press while in flight is refused. */
export function useTakeEnquiry(userId: number | undefined, refresh: () => void) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [failWhy, setFailWhy] = useState("");
  const take = async (i: DeskItem) => {
    if (!userId || busyId) return;
    const enquiryId = Number(i.id.split(":")[1]);
    if (!Number.isFinite(enquiryId)) return;
    setBusyId(i.id); setFailedId(null); setFailWhy("");
    const r = await api<{ ok?: boolean; error?: { message?: string } }>(
      `/enquiries/${enquiryId}`, { method: "PATCH", body: JSON.stringify({ assigned_to: userId }) },
    );
    setBusyId(null);
    if (r.ok) { applyVersions({ enquiries: getVersion("enquiries") + 1 }); refresh(); return; }
    setFailedId(i.id);
    setFailWhy(r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"));
  };
  return { take: userId ? take : undefined, busyId, failedId, failWhy };
}

/* ===================== the Dashboard's compact card ===================== */

/**
 * v1.176.0 — THE DASHBOARD SHOWS A SUMMARY, NOT A COPY. Counts, the two
 * oldest things waiting, and a way in. The full queue lives on the Desk page,
 * and the person should not have to decide which of two identical lists is
 * the real one.
 */
export function DeskSummary({ go, bare = false }: { go: (tab: string) => void; bare?: boolean }) {
  const desk = useDeskData();
  const items = useMemo(() => desk.data?.items ?? [], [desk.data]);
  const { decide, attention, myTasks } = useMemo(() => splitDesk(items), [items]);
  const overdue = items.filter((i) => i.overdue).length;

  if (desk.loading) {
    return (
      <div className={bare ? "" : card} aria-busy="true">
        <Skel className="h-4 w-44" />
        <div className="mt-3 space-y-2"><Skel className="h-9 rounded-lg" /><Skel className="h-9 rounded-lg" /></div>
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

  /* the two oldest things waiting, decisions first - a preview, not a list */
  const preview = [...decide, ...attention].slice(0, 2);
  return (
    <div className={bare ? "" : `${card} border-l-4`} style={bare ? undefined : { borderLeftColor: overdue ? "var(--warning)" : "var(--gold-solid)" }}>
      <PanelTitle icon="orders" className="flex-wrap">
        {L("Waiting on you", "Menunggu anda")}
        <StaleHint show={desk.stale} className="ml-2" />
      </PanelTitle>
      <div className="erp-tiles erp-tiles-3 erp-mt-2">
        <button type="button" className={`erp-stat erp-stat-button ${decide.length > 0 ? "erp-stat-warning" : ""}`}
          onClick={() => go("Desk")} title={L("Open the Desk", "Buka Meja")}>
          <span className="erp-stat-value">{decide.length}</span>
          <span className="erp-stat-label">{L("Decisions", "Keputusan")}</span>
        </button>
        <button type="button" className="erp-stat erp-stat-button"
          onClick={() => go("Desk")} title={L("Open the Desk", "Buka Meja")}>
          <span className="erp-stat-value">{attention.length}</span>
          <span className="erp-stat-label">{L("Attention", "Perhatian")}</span>
        </button>
        <button type="button" className="erp-stat erp-stat-button"
          onClick={() => go("Tasks")} title={L("Open Tasks", "Buka Tugasan")}>
          <span className="erp-stat-value">{myTasks.length}</span>
          <span className="erp-stat-label">{L("My tasks", "Tugasan saya")}</span>
        </button>
      </div>
      {preview.length > 0 && (
        <ul className="erp-mt-2">
          {preview.map((i) => <DeskRow key={i.id} item={i} go={go} />)}
        </ul>
      )}
      <button type="button" className={`${btnSm} mt-3`} onClick={() => go("Desk")}>
        {L(`Open the Desk — ${decide.length + attention.length}`, `Buka Meja — ${decide.length + attention.length}`)}
      </button>
    </div>
  );
}

/* ===================== the Desk page's queue ===================== */

const SHOW_FIRST = 8;

/** One list, with its caption and its "show all". */
function Group({ label, hint, list, go, take, busyId, failedId, failWhy }: {
  label: string; hint: string; list: DeskItem[];
  go: (tab: string) => void;
  take?: (i: DeskItem) => void;
  busyId: string | null; failedId: string | null; failWhy: string;
}) {
  const [all, setAll] = useState(false);
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, SHOW_FIRST);
  return (
    <div className={card}>
      <PanelTitle icon="orders">{label} — {list.length}</PanelTitle>
      <p className="erp-meta">{hint}</p>
      <ul className="erp-mt-2">
        {shown.map((i) => (
          <DeskRow key={i.id} item={i} go={go} onTake={take}
            busy={busyId === i.id} failed={failedId === i.id} failWhy={failWhy} />
        ))}
      </ul>
      {list.length > SHOW_FIRST && (
        <button type="button" className={`${btnSm} mt-3`} onClick={() => setAll((v) => !v)}>
          {all ? L("Show fewer", "Tunjuk kurang") : L(`Show all ${list.length}`, `Tunjuk semua ${list.length}`)}
        </button>
      )}
    </div>
  );
}

/** The Desk page's two lists. The page owns the zones around them. */
export function DeskQueue({ go, userId, which }: { go: (tab: string) => void; userId?: number; which: "decide" | "attention" }) {
  const desk = useDeskData();
  const items = useMemo(() => desk.data?.items ?? [], [desk.data]);
  const { decide, attention } = useMemo(() => splitDesk(items), [items]);
  const { take, busyId, failedId, failWhy } = useTakeEnquiry(userId, desk.refresh);

  if (desk.loading) {
    return (
      <div className={card} aria-busy="true">
        <Skel className="h-4 w-44" />
        <div className="mt-3 space-y-2"><Skel className="h-9 rounded-lg" /><Skel className="h-9 rounded-lg" /><Skel className="h-9 rounded-lg" /></div>
      </div>
    );
  }
  if (desk.failed && !desk.data) {
    return (
      <div className={card} role="alert">
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

  const list = which === "decide" ? decide : attention;
  if (list.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 px-1 text-xs" role="status">
        <span aria-hidden className="bg-success inline-block h-1.5 w-1.5 rounded-full" />
        {which === "decide"
          ? L("No decisions are waiting on you.", "Tiada keputusan menunggu anda.")
          : L("Nothing needs your attention.", "Tiada apa memerlukan perhatian anda.")}
        <StaleHint show={desk.stale} />
      </p>
    );
  }
  return which === "decide"
    ? <Group label={L("Needs your decision", "Perlu keputusan anda")}
        hint={L("Nobody else can move these.", "Tiada orang lain boleh menggerakkannya.")}
        list={decide} go={go} busyId={busyId} failedId={failedId} failWhy={failWhy} />
    : <Group label={L("Needs attention", "Perlu perhatian")}
        hint={L("Answer, acknowledge or take these.", "Jawab, akui atau ambil yang ini.")}
        list={attention} go={go} take={take} busyId={busyId} failedId={failedId} failWhy={failWhy} />;
}

/** The bucket chips — one door per module, on the Desk page's figures zone. */
export function DeskBucketChips({ go }: { go: (tab: string) => void }) {
  const desk = useDeskData();
  const items = desk.data?.items ?? [];
  const counts = desk.data?.counts ?? {};
  const keys = (Object.keys(BUCKET) as DeskItem["bucket"][]).filter((b) => counts[b]);
  if (keys.length === 0) return null;
  return (
    <span className="erp-pill-row erp-mt-2">
      {keys.map((b) => (
        <button key={b} type="button"
          className={`${chipNeutral} ${chipAction} text-foreground/80 tabular-nums hover:bg-secondary/70`}
          onClick={() => { go(items.find((i) => i.bucket === b)?.tab ?? "Dashboard"); revealAnchor(ANCHOR[b]); }}
          title={L(`Open ${BUCKET[b][0]}`, `Buka ${BUCKET[b][1]}`)}>
          {L(BUCKET[b][0], BUCKET[b][1])} {counts[b]}
        </button>
      ))}
    </span>
  );
}

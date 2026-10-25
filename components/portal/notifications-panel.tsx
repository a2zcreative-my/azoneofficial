"use client";

/* v1.205.0 - THE BELL, SORTED (the owner's Global Search & Notifications
   brief, 25-10-2026). One component for the two places it is read: the
   panel under the top bar and the rail beside the Global Search page.

   WHAT IT IS, unchanged since v1.176.0: the bell is for UPDATES WITH LINKS.
   It says a thing happened and takes you to the record. Nothing is decided
   here; the badge counts unread MESSAGES.

   WHAT IS NEW:
   - chips by what the update is about - Tasks, Leave, Claims, and System
     (every other kind: announcements, attendance, overtime, stock, lives,
     events, watchers) - each with its count, from the same 7-day list;
   - APPROVALS is the Desk's own "waiting on you to decide" list
     (useDeskData, the one request the Desk and the Dashboard already share),
     shown read-only: each line opens its record, the decision is made where
     it always is. No second queue, no second count;
   - a press opens the RECORD, not just the tab (lib/record-focus.ts): the
     notification's `ref` ("leave:12", "claim:7", "task:5:...") names it,
     and the module that owns it opens it. A ref that names a day or nothing
     a module can open alone keeps the v1.176.0 tab-and-section link.
   - Mark all as read, which is the existing POST, also clears the dots on
     screen at once instead of on the next refresh. */

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import type { TabName } from "@/lib/portal-tabs";
import { recordOfRef, TAB_OF_KIND } from "@/lib/record-focus";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Skel } from "@/components/ui/skeleton";
import { L, revealAnchor, type Notification } from "@/components/portal/page-shared";
import { usePortal } from "@/components/portal/portal-provider";
import { useDeskData, splitDesk, deskAnchor, waited, type DeskItem } from "@/components/portal/one-desk";
import nc from "./notifications.module.css";

/* WHERE AN UPDATE IS READ when its ref names no single record (v1.176.0,
   moved here from portal-shell.tsx with the bell). Kinds come from
   worker/src/staff.ts `notify(...)`. */
export const NOTIF_WHERE: Record<string, { tab: string; anchor?: string }> = {
  announcement: { tab: "Announcements" },
  ot: { tab: "Attendance", anchor: "ot-approvals" },
  attendance: { tab: "Attendance", anchor: "pending-punches" },
  claim: { tab: "Claims", anchor: "claims-pending" },
  leave: { tab: "Leave" },
  task: { tab: "Tasks" },
  watch: { tab: "Desk" },
  stock: { tab: "Inventory" },
  live: { tab: "Attendance" },
  /* v1.183.0 - "enquiry" and "commission" kinds have no tab any more: an
     old row of either kind opens nothing. */
};

type Cat = "all" | "approvals" | "tasks" | "leave" | "claims" | "system";
/** the chip a kind sits under; everything not named is System */
export const catOfKind = (kind: string): Exclude<Cat, "all" | "approvals"> =>
  kind === "task" ? "tasks" : kind === "leave" ? "leave" : kind === "claim" ? "claims" : "system";

/* the line each kind of update is headed with - the kind, said plainly */
const KIND_HEAD: Record<string, [string, string, AppIconName]> = {
  task: ["Task", "Tugasan", "orders"],
  leave: ["Leave", "Cuti", "holiday"],
  claim: ["Claim", "Tuntutan", "receipt"],
  announcement: ["Announcement", "Pengumuman", "info"],
  attendance: ["Attendance", "Kehadiran", "time"],
  ot: ["Overtime", "Kerja lebih masa", "time"],
  stock: ["Stock", "Stok", "inventory"],
  live: ["Live session", "Sesi live", "live"],
  event: ["Event", "Acara", "date"],
  watch: ["Watcher", "Pemerhati", "preview"],
  birthday: ["Birthday", "Hari jadi", "cake"],
  sales: ["Sales", "Jualan", "chart"],
  brief: ["Brief", "Taklimat", "documents"],
};
const headOf = (kind: string): [string, AppIconName] => {
  const h = KIND_HEAD[kind];
  return h ? [L(h[0], h[1]), h[2]] : [L("Update", "Kemas kini"), "info"];
};

/** "10 min ago", "3 h ago", "2 d ago" - from the worker's UTC stamp */
function ago(utc: string, now: number): string {
  const t = new Date(utc.replace(" ", "T") + (utc.endsWith("Z") ? "" : "Z")).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return L("just now", "baru sahaja");
  if (m < 60) return L(`${m} min ago`, `${m} min lalu`);
  if (m < 60 * 24) return L(`${Math.round(m / 60)} h ago`, `${Math.round(m / 60)} j lalu`);
  if (m < 60 * 24 * 7) return L(`${Math.round(m / 1440)} d ago`, `${Math.round(m / 1440)} h lalu`);
  return dmy(utc);
}

export function NotificationsPanel({ variant, onDone }: {
  /** "drop": the panel under the top bar; "rail": beside the Global Search page */
  variant: "drop" | "rail";
  /** called after a line was opened (the drop panel closes itself) */
  onDone?: () => void;
}) {
  const { notifs, setNotifs, unread, setTab, openRecord, canOpen } = usePortal();
  const [cat, setCat] = useState<Cat>("all");
  /* the clock the "ago" lines read, taken once when the panel opens (render stays pure) */
  const [now] = useState(() => Date.now());
  const desk = useDeskData();
  const decide = useMemo(() => splitDesk(desk.data?.items ?? []).decide, [desk.data]);

  const counts = useMemo(() => {
    const c: Record<Cat, number> = { all: notifs.length, approvals: decide.length, tasks: 0, leave: 0, claims: 0, system: 0 };
    for (const n of notifs) c[catOfKind(n.kind)] += 1;
    return c;
  }, [notifs, decide]);
  const shown = cat === "all" ? notifs : cat === "approvals" ? [] : notifs.filter((n) => catOfKind(n.kind) === cat);

  const markAll = () => {
    if (!unread) return;
    void api("/staff/notifications/read", { method: "POST", body: JSON.stringify({}) });
    setNotifs((list) => list.map((n) => ({ ...n, is_read: 1 })));
  };
  /* one door to a record: the focus when the ref names one this person may
     open, the v1.176.0 tab-and-section link otherwise */
  const go = (ref: string | null | undefined, fallbackTab: string | undefined, anchor?: string) => {
    const rec = recordOfRef(ref);
    const tab = rec ? TAB_OF_KIND[rec.kind] : undefined;
    if (rec && tab && canOpen(tab)) openRecord(tab, rec.kind, rec.id);
    else if (fallbackTab) { setTab(fallbackTab as TabName); if (anchor) revealAnchor(anchor); }
  };
  const openNotif = (n: Notification) => {
    const where = NOTIF_WHERE[n.kind];
    go(n.ref, where?.tab, where?.anchor);
    markAll();
    onDone?.();
  };
  const openDesk = (i: DeskItem) => {
    go(i.id, i.tab, deskAnchor(i.bucket));
    onDone?.();
  };
  const linkable = (n: Notification) => Boolean(NOTIF_WHERE[n.kind]) || Boolean(recordOfRef(n.ref));

  const CHIPS: [Cat, string, string?][] = [
    ["all", L("All", "Semua")],
    ["approvals", L("Approvals", "Kelulusan"), L("Waiting on you to decide - the Desk's list", "Menunggu keputusan anda - senarai Meja")],
    ["tasks", L("Tasks", "Tugasan")],
    ["leave", L("Leave", "Cuti")],
    ["claims", L("Claims", "Tuntutan")],
    ["system", L("System", "Sistem"), L("Announcements, attendance, overtime, stock, lives, events and watchers", "Pengumuman, kehadiran, kerja lebih masa, stok, live, acara dan pemerhati")],
  ];

  return (
    <section className={`${nc.panel} ${variant === "rail" ? nc.rail : nc.drop}`} aria-label={L("Notifications", "Pemberitahuan")}>
      <div className={nc.head}>
        <h2 className={nc.title}>{L("Notifications", "Pemberitahuan")}</h2>
        {unread > 0 && <button type="button" className={nc.markAll} onClick={markAll}>{L("Mark all as read", "Tanda semua dibaca")}</button>}
      </div>
      <div className={nc.chips} role="group" aria-label={L("Show notifications about", "Tunjuk pemberitahuan tentang")}>
        {CHIPS.map(([k, label, hint]) => (
          <button key={k} type="button" aria-pressed={cat === k} title={hint} onClick={() => setCat(k)}>
            {label} <span className={nc.count}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {cat === "approvals" ? (
        <>
          {desk.loading && !desk.data && (
            <div aria-hidden>
              {[0, 1].map((i) => <div key={i} className={nc.skelRow}><Skel w={36} h={36} /><span className={nc.skelText}><Skel w={160} h={14} /><Skel w={112} h={12} /></span></div>)}
            </div>
          )}
          {desk.data && decide.length === 0 && <p className={nc.empty}><AppIcon name="success" />{L("Nothing is waiting on you to decide.", "Tiada yang menunggu keputusan anda.")}</p>}
          <ul className={nc.list}>
            {decide.map((i) => (
              <li key={i.id}>
                <button type="button" className={nc.row} onClick={() => openDesk(i)}>
                  <span className={`${nc.icon} ${nc.iconGold}`} aria-hidden><AppIcon name="pending" /></span>
                  <span className={nc.text}>
                    <strong>{i.title}</strong>
                    <span>{[i.who, i.sub].filter(Boolean).join(" · ")}</span>
                    <span className={nc.meta}>{i.overdue ? <span className={nc.late}>{L("Overdue", "Tertunggak")}</span> : null}{i.since ? L(`waiting ${waited(i.since)}`, `menunggu ${waited(i.since)}`) : ""}</span>
                  </span>
                  <AppIcon name="next" className={nc.chev} />
                </button>
              </li>
            ))}
          </ul>
          <p className={nc.foot}>{L("Decisions are made on the record itself; this list is the Desk's.", "Keputusan dibuat pada rekod itu sendiri; senarai ini milik Meja.")}</p>
        </>
      ) : (
        <>
          {shown.length === 0 && <p className={nc.empty}><AppIcon name="success" />{cat === "all" ? L("Nothing in the last 7 days.", "Tiada apa-apa dalam 7 hari terakhir.") : L("Nothing of this kind in the last 7 days.", "Tiada jenis ini dalam 7 hari terakhir.")}</p>}
          <ul className={nc.list}>
            {shown.map((n) => {
              const [head, icon] = headOf(n.kind);
              const body = (
                <>
                  <span className={`${nc.icon} ${nc[`i_${catOfKind(n.kind)}`] ?? ""}`} aria-hidden><AppIcon name={icon} /></span>
                  <span className={nc.text}>
                    <strong>{head}</strong>
                    <span className={nc.msg}>{n.message}</span>
                    <span className={nc.meta}>{!n.is_read && <span className={nc.dot} aria-label={L("unread", "belum dibaca")} />}{ago(n.created_at, now)}</span>
                  </span>
                </>
              );
              return (
                <li key={n.id} className={n.is_read ? "" : nc.unread}>
                  {linkable(n) ? (
                    <button type="button" className={nc.row} onClick={() => openNotif(n)}>
                      {body}<AppIcon name="next" className={nc.chev} />
                    </button>
                  ) : <div className={nc.row}>{body}</div>}
                </li>
              );
            })}
          </ul>
          <p className={nc.foot}>{L("Last 7 days. Older notifications clear automatically.", "7 hari terakhir. Pemberitahuan lama dipadam secara automatik.")}</p>
        </>
      )}
    </section>
  );
}

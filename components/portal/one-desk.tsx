"use client";

/**
 * ONE DESK — v1.106.0 (roadmap phase 04).
 *
 * The first card on the Dashboard, and the reason to open the portal in the
 * morning: everything waiting on the person looking, from every module, in
 * one list, oldest first, overdue on top. Pressing an item goes to the tab
 * where it is acted on; the desk itself decides nothing.
 *
 * What it lists is the WORKER's decision (worker/src/desk.ts), by the same
 * rules the acting routes enforce - this card only draws. It is remembered
 * on the device (lib/cached-api) and refetches when any of its topics moves,
 * so a claim decided on another phone leaves this desk within seconds.
 *
 * WHEN THERE IS NOTHING, it says so in one quiet line and takes no room. A
 * desk that shows an empty box with a heading is a desk asking to be
 * ignored; the whole value is that when it has something, it is the first
 * thing you see.
 */

import { useMemo, useState } from "react";
import { useCachedApi } from "@/lib/cached-api";
import { Skel, StaleHint } from "@/components/ui/skeleton";
import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface DeskItem {
  bucket: "leave" | "claims" | "ot" | "punches" | "commission" | "tasks" | "news";
  id: string; title: string; sub: string; since: string | null; tab: string; overdue: boolean;
}
interface DeskData { items: DeskItem[]; counts: Record<string, number>; total: number; missing: string[] }

const BUCKET: Record<DeskItem["bucket"], [string, string]> = {
  leave: ["Leave", "Cuti"],
  claims: ["Claims", "Tuntutan"],
  ot: ["Overtime", "Kerja lebih masa"],
  punches: ["Punches", "Ketukan"],
  commission: ["Commission", "Komisen"],
  tasks: ["Tasks", "Tugasan"],
  news: ["News", "Berita"],
};

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

export function OneDesk({ go }: { go: (tab: string) => void }) {
  /* the topics every bucket can move on - a write anywhere here refetches */
  const desk = useCachedApi<DeskData>("/staff/desk", true,
    ["leave", "claims", "attendance", "tasks", "announcements", "erp", "users"]);
  const [all, setAll] = useState(false);
  const items = useMemo(() => desk.data?.items ?? [], [desk.data]);
  const counts = desk.data?.counts ?? {};
  const shown = all ? items : items.slice(0, SHOW_FIRST);

  if (desk.loading) {
    return (
      <div className={card} aria-busy="true">
        <Skel className="h-4 w-44" />
        <div className="mt-3 space-y-2">
          <Skel className="h-9 rounded-lg" /><Skel className="h-9 rounded-lg" /><Skel className="h-9 rounded-lg" />
        </div>
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
  return (
    <div className={`${card} border-l-4`} style={{ borderLeftColor: overdue ? "var(--warning)" : "var(--gold-solid)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {L(`Waiting on you — ${items.length}`, `Menunggu anda — ${items.length}`)}
            <StaleHint show={desk.stale} className="ml-2" />
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {overdue > 0
              ? L(`${overdue} of these have waited longer than they should.`, `${overdue} daripadanya telah menunggu lebih lama daripada sepatutnya.`)
              : L("Oldest first. Press one to go where it is decided.", "Yang terlama dahulu. Tekan satu untuk ke tempat ia diputuskan.")}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {(Object.keys(BUCKET) as DeskItem["bucket"][]).filter((b) => counts[b]).map((b) => (
            <button key={b} type="button"
              className="bg-secondary text-foreground/80 hover:bg-secondary/70 rounded-full px-2.5 py-1 font-medium tabular-nums"
              onClick={() => go(items.find((i) => i.bucket === b)?.tab ?? "Dashboard")}
              title={L(`Open ${BUCKET[b][0]}`, `Buka ${BUCKET[b][1]}`)}>
              {L(BUCKET[b][0], BUCKET[b][1])} {counts[b]}
            </button>
          ))}
        </span>
      </div>

      <ul className="divide-border/70 mt-3 divide-y">
        {shown.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => go(i.tab)}
              className="hover:bg-secondary/50 flex w-full items-center gap-3 rounded-lg px-1.5 py-2 text-left transition-colors">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${i.overdue ? "bg-warning" : "bg-gold-solid"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{i.title}</span>
                <span className="text-muted-foreground block truncate text-xs">{i.sub}</span>
              </span>
              <span className={`shrink-0 text-[11px] tabular-nums ${i.overdue ? "text-warning font-semibold" : "text-muted-foreground"}`}>
                {waited(i.since)}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs" aria-hidden>›</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > SHOW_FIRST && (
        <button type="button" className="text-muted-foreground mt-2 text-xs underline" onClick={() => setAll((v) => !v)}>
          {all ? L("Show fewer", "Tunjuk kurang") : L(`Show all ${items.length}`, `Tunjuk semua ${items.length}`)}
        </button>
      )}
    </div>
  );
}

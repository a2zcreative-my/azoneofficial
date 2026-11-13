"use client";

/* v1.295.0 - NEWS v2.0, RELEASE N1 (CEO directive "A2Z OS - NEWS v2.0",
   12-11-2026; "approve continuously", 13-11-2026; claude/NEWS-V2-AUDIT.md).

   The pieces every News tab shares, so the four tabs cannot drift apart:
   one badge, one acknowledgement state, one announcement card, one filter
   row, one stat strip, one empty state. They only draw what the
   announcement record says (GET /staff/announcements); nothing here
   writes, and nothing here acknowledges - acknowledging is the reader's
   button in announcements.tsx, alone. */

import { useState, type ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile, type KpiTone } from "@/components/ui/kpi-tile";
import { Announcement, L } from "@/components/portal/page-shared";
import { dmyMYT } from "@/lib/format";
import { inputClass } from "@/lib/ui-styles";
import css from "./announcements.module.css";

/* v1.4.215 (CEO pasted his real internal memo): Malay month names for the
   memo's default Tarikh line. */
export const MS_MONTHS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
export const todayMalay = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCDate()} ${MS_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/* v1.4.215: renders an announcement body the way the CEO's memo reads -
   "Label: value" lines get a bold label, consecutive "* " lines become a
   real bullet list, everything else stays a paragraph. Text nodes only. */
export function MemoBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length > 0) {
      out.push(<ul key={`ul${out.length}`} className={css.bullets}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
      bullets = [];
    }
  };
  lines.forEach((ln, i) => {
    const bullet = ln.match(/^\s*[*•-]\s+(.*)$/);
    if (bullet) { bullets.push(bullet[1]!); return; }
    flush();
    const label = ln.match(/^([A-Za-z][A-Za-z\s()\/&]{1,30}):\s+(.+)$/);
    if (label && !label[2]!.startsWith("//")) out.push(<p key={i}><span className={css.label}>{label[1]}:</span> {label[2]}</p>);
    else if (ln.trim() === "") out.push(<div key={i} className={css.gap} />);
    else out.push(<p key={i}>{ln}</p>);
  });
  flush();
  return <div className={css.body}>{out}</div>;
}

export const CATS = ["news", "meeting", "holiday", "kpi", "training", "memo"] as const;
const CAT_LABEL: Record<string, [string, string]> = {
  news: ["News", "Berita"], meeting: ["Meeting", "Mesyuarat"], holiday: ["Holiday", "Cuti umum"],
  kpi: ["KPI", "KPI"], training: ["Training", "Latihan"], memo: ["Memo", "Memo"],
};
export const catL = (c: string) => L(...(CAT_LABEL[c] ?? [c, c]));

/** the post waits on this person: required of them, and the version that stands is not acknowledged */
export const needs = (a: Announcement) => (a.required ?? 1) === 1 && !a.acked;
export const preview = (body: string) => body.replace(/^(To|From|Kepada|Daripada|Tarikh|Perkara):.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 180);

/* ---- the badge: one look for every tab (gold pinned, red important, blue category, green done, amber waiting, grey history) ---- */
export type Tone = "gold" | "red" | "green" | "blue" | "grey" | "amber";
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  const cls = { gold: "erp-chip-warning", amber: "erp-chip-warning", red: "erp-chip-danger", green: "erp-chip-success", blue: "erp-chip-info", grey: "erp-chip-neutral" }[tone];
  return <span className={`erp-chip erp-chip-sm ${cls}`} data-tone={tone}>{children}</span>;
}

/** Where this post stands for the person reading, in words (colour is never the only sign). */
export type AckWord = "acked" | "again" | "required" | "own" | "previous" | "not_required";
export function ackWord(a: Announcement, me?: number): AckWord {
  if (a.acked) return "acked";
  if ((a.required ?? 1) === 1) return (a.my_last_version ?? 0) > 0 ? "again" : "required";
  if (me !== undefined && a.created_by === me) return "own";
  if ((a.my_last_version ?? 0) > 0) return "previous";
  return "not_required";
}
export function AckState({ a, me, quiet = false }: { a: Announcement; me?: number; quiet?: boolean }) {
  const w = ackWord(a, me);
  if (w === "acked") return <Chip tone="green"><AppIcon name="success" />{L(`Acknowledged ${dmyMYT(a.acked_at ?? "").slice(0, 10)}`, `Diperakui ${dmyMYT(a.acked_at ?? "").slice(0, 10)}`)}</Chip>;
  if (w === "again") return <Chip tone="amber">{L(`Updated to v${a.version ?? 1} - acknowledge again`, `Dikemas kini ke v${a.version ?? 1} - perakui semula`)}</Chip>;
  if (w === "required") return <Chip tone="amber">{L("Requires acknowledgement", "Perlu diperakui")}</Chip>;
  if (quiet) return null;
  if (w === "own") return <Chip tone="grey">{L("Your post - not required", "Hantaran anda - tidak diperlukan")}</Chip>;
  if (w === "previous") return <Chip tone="grey">{L(`Previously acknowledged (v${a.my_last_version})`, `Pernah diperakui (v${a.my_last_version})`)}</Chip>;
  return <Chip tone="grey">{L("Not required", "Tidak diperlukan")}</Chip>;
}

/* ---- the announcement card ---- */
export function PostCard({ a, me, selected = false, onOpen }: { a: Announcement; me: number; selected?: boolean; onOpen: () => void }) {
  return (
    <li className={`${css.post} ${needs(a) ? css.waiting : ""} ${a.pinned ? css.pinnedPost : ""}`} data-record={`announcement:${a.id}`} data-testid="news-card" aria-current={selected ? "true" : undefined}>
      <div className={css.postTop}>
        {a.pinned ? <Chip tone="gold"><AppIcon name="star" />{L("Pinned", "Disemat")}</Chip> : null}
        {a.important ? <Chip tone="red">{L("Important", "Penting")}</Chip> : null}
        <Chip tone="blue">{catL(a.category)}</Chip>
        <AckState a={a} me={me} quiet />
      </div>
      <button type="button" className={css.postOpen} onClick={onOpen}>
        <strong className={css.postTitle}>{a.title}</strong>
        <span className={css.preview}>{preview(a.body)}</span>
      </button>
      <div className={css.postMeta}>
        <span className={css.byline}><strong>{a.publisher_name ?? L("Management", "Pengurusan")}</strong>{a.publisher_position ? ` · ${a.publisher_position}` : ""}</span>
        <span>{dmyMYT(a.created_at)}</span>
        {(a.version ?? 1) > 1 && <span>{L(`Updated · v${a.version}`, `Dikemas kini · v${a.version}`)}</span>}
        {a.audience && a.audience.length > 0 && <span>{L(`For ${a.audience.join(", ")}`, `Untuk ${a.audience.join(", ")}`)}</span>}
        {(a.files?.length ?? 0) > 0 && <span><AppIcon name="attach" /> {a.files!.length}</span>}
        <button type="button" className={needs(a) ? "erp-button erp-button-primary erp-button-compact" : "erp-button erp-button-secondary erp-button-compact"} onClick={onOpen}>
          {needs(a) ? L("Read & acknowledge", "Baca & perakui") : L("View details", "Lihat butiran")}
        </button>
      </div>
    </li>
  );
}

/* ---- the stat strip: each tab passes ITS figures, never the same four.
   The portal's shared KpiRow / KpiTile, so News looks like every module. ---- */
export interface Stat { key: string; icon: AppIconName; tone: KpiTone; value: number | string; label: string; sub?: string; onClick?: () => void }
export function NewsStats({ stats, label, busy }: { stats: Stat[]; label: string; busy?: boolean }) {
  return (
    <div className={css.kpis} data-testid="news-stats" data-count={stats.length}>
      <KpiRow label={label}>
        {stats.map((s) => (
          <KpiTile key={s.key} icon={s.icon} tone={s.tone} label={s.label} value={s.value} busy={busy} sub={s.sub} onClick={s.onClick} />
        ))}
      </KpiRow>
    </div>
  );
}

/* ---- the filter row: search plus whichever selects the tab needs ---- */
export interface FilterSelect { key: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][] }
export function NewsFilterBar({ q, onQ, placeholder, selects, children }: { q: string; onQ: (v: string) => void; placeholder: string; selects: FilterSelect[]; children?: ReactNode }) {
  /* on a phone the selects fold behind one Filters button, so the posts are not pushed off the screen */
  const [open, setOpen] = useState(false);
  const active = selects.filter((s) => s.value !== (s.options[0]?.[0] ?? "")).length;
  return (
    <div className={css.filterBar} data-testid="news-filters" data-open={open ? "" : undefined}>
      <div className={css.searchRow}>
        <label className={css.search}>
          <AppIcon name="search" />
          <input className={inputClass} type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        </label>
        {selects.length > 0 && (
          <button type="button" className={css.filterToggle} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="news-filter-toggle">
            <AppIcon name="target" />{L("Filters", "Penapis")}{active ? ` (${active})` : ""}
          </button>
        )}
      </div>
      {selects.map((s) => (
        <select key={s.key} className={`${inputClass} ${css.filterSelect}`} value={s.value} onChange={(e) => s.onChange(e.target.value)} aria-label={s.label} data-testid={`news-filter-${s.key}`}>
          {s.options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      ))}
      {children}
    </div>
  );
}

export function NewsEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className={css.emptyState} role="status"><AppIcon name="content" /><p>{children}</p>{action}</div>;
}

/** Ten at a time, with a page line: a long feed never loads as one wall. */
export function NewsPager({ page, pages, total, per, onPage }: { page: number; pages: number; total: number; per: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className={css.pager} data-testid="news-pager">
      <span>{L(`${page * per + 1}–${Math.min(total, page * per + per)} of ${total}`, `${page * per + 1}–${Math.min(total, page * per + per)} daripada ${total}`)}</span>
      <button type="button" className="erp-button erp-button-ghost erp-button-compact" disabled={page === 0} onClick={() => onPage(page - 1)}>{L("Previous", "Sebelum")}</button>
      <button type="button" className="erp-button erp-button-ghost erp-button-compact" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>{L("Next", "Seterusnya")}</button>
    </div>
  );
}

/** Within N days of now (MYT is irrelevant for a day count). */
export const within = (at: string, days: number) => Date.now() - Date.parse(`${at.replace(" ", "T")}Z`) <= days * 86400000;

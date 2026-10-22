"use client";

/* v1.173.0 — THE TAB CONCEPT.
 *
 * The CEO, 21-09-2026: *"All the tabs should responsive with PWA and also
 * Web view and the tabs should work like Dashboard concept style designed"*,
 * choosing all three of its habits: zones with a card grid, the summary
 * first with the detail below, and a pill row instead of a stack of cards.
 *
 * The Dashboard (components/portal/dashboard.tsx) has read this way since
 * v1.116.0: a body that is a stack of ZONES, each opened by one small-caps
 * caption (MY DAY, WAITING ON ME, MY MONTH, AROUND ME), each zone a tight
 * stack or a grid of cards, the figures before the records, and a card that
 * holds several things (Work overview) showing one at a time behind a pill
 * row. These four components make that shape a thing a tab can be BUILT
 * FROM rather than a thing it has to imitate:
 *
 *   <TabPage>                       the body - one rhythm of zones
 *     <TabZone label="Today">       a captioned zone (a grid with `cols`)
 *       <SummaryStrip>              the figures, 2 → 3 → 4/6 across
 *         <SummaryStat />           one figure, one label
 *     <TabZone label="The work" cols={2}>
 *       <PillCard tabs=…>           several things, one at a time
 *
 * The contract is docs/INTERFACE-SYSTEM-V3.md §8 and tests/tab-concept.mjs
 * (guard #94) holds every tab to it. Nothing here fetches or decides: these
 * are layout only - a tab's data, verbs and rules stay in its own panel.
 *
 * Bodies behind a pill row are HIDDEN, never unmounted (v1.123.0): a pane
 * that lost its half-typed form on every switch would be a worse card than
 * the stack it replaced. The `hidden` attribute is what the Work overview
 * uses, so the same gesture means the same thing everywhere.
 *
 * Styling: styles/erp-v3.css (.erp-stack, .erp-stack-tight, .erp-zone,
 * .erp-zone-grid-*, .erp-tiles, .erp-stat, .erp-card-head, .erp-pane) and tokens.
 * No utility classes - v1.172.2 retired them (CLAUDE.md).
 */

import type { ReactNode } from "react";
import { AppIcon, PanelTitle, type AppIconName } from "@/components/ui/app-icon";
import { SectionTabs, ZoneLabel } from "@/components/portal/page-shared";

const COLS = { 1: "", 2: "erp-zone-grid-2", 3: "erp-zone-grid-3" } as const;
const TILES = { 2: "erp-tiles erp-tiles-2", 3: "erp-tiles erp-tiles-3", 4: "erp-tiles", 5: "erp-tiles erp-tiles-5", 6: "erp-tiles erp-tiles-6" } as const;

/** The body of a tab: a stack of zones with the Dashboard's rhythm. */
export function TabPage({ children, id, className = "" }: { children: ReactNode; id?: string; className?: string }) {
  return <div id={id} className={`erp-stack erp-tab-page ${className}`}>{children}</div>;
}

/** One captioned zone. `cols` lays its cards out side by side from 1024px;
    on a phone every zone is one column. The caption is the same small caps
    the Dashboard's zones use (ZoneLabel, page-shared.tsx). */
export function TabZone({ label, children, cols = 1, id, className = "", hint }: {
  label: ReactNode;
  children: ReactNode;
  cols?: keyof typeof COLS;
  id?: string;
  className?: string;
  /** One quiet line under the caption - what this zone is for. */
  hint?: ReactNode;
}) {
  return (
    <section id={id} className={`erp-stack-tight erp-tab-zone ${className}`}>
      <ZoneLabel>{label}</ZoneLabel>
      {hint ? <p className="erp-meta erp-zone-hint">{hint}</p> : null}
      {cols === 1 ? children : <div className={COLS[cols]}>{children}</div>}
    </section>
  );
}

/** The summary tier: figures before records. Two across on a phone, three
    from 640px, `cols` from 1024px. Children are SummaryStat or StatTile. */
export function SummaryStrip({ children, cols = 4, className = "", ariaLabel }: {
  children: ReactNode;
  cols?: keyof typeof TILES;
  className?: string;
  ariaLabel?: string;
}) {
  return <div className={`${TILES[cols]} ${className}`} role={ariaLabel ? "group" : undefined} aria-label={ariaLabel}>{children}</div>;
}

export type SummaryTone = "neutral" | "success" | "warning" | "danger" | "brand";
const STAT_TONE: Record<SummaryTone, string> = {
  neutral: "",
  success: "erp-stat-success",
  warning: "erp-stat-warning",
  danger: "erp-stat-danger",
  brand: "erp-stat-brand",
};

/** One figure, one label. A button when something is behind it (v1.88.0:
    "clickable data without me need to open another new tabs"). */
export function SummaryStat({ label, value, hint, tone = "neutral", onClick, title, active, busy, icon, badge, spark, detail, info }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: SummaryTone;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  /** The figure is not known yet - show a placeholder, never a false zero. */
  busy?: boolean;
  /* v1.182.0 - THE FIGURE TILE (the owner's reference, 22-10-2026): a
     label on top, an icon well beside a large figure, a tone chip after it,
     a small bar run under them and a "See details" control. All four are
     optional; a tile that passes none reads exactly as before. */
  /** An icon in a tinted well beside the figure. */
  icon?: AppIconName;
  /** A short chip after the figure: a share, a delta, a count. */
  badge?: { text: ReactNode; tone?: SummaryTone };
  /** Up to 14 values drawn as small bars (the last one emphasised). */
  spark?: readonly number[];
  /** A quiet control in the tile's corner, usually the way into the records. */
  detail?: { label: ReactNode; onClick: () => void; title?: string };
  /** v1.191.0 - what the figure counts, behind an (i) after the label */
  info?: string;
}) {
  const rich = Boolean(icon || badge || spark || detail);
  const body = rich ? (
    <>
      <span className="erp-stat-top">
        <span className="erp-stat-label">{label}{info ? <span className="erp-stat-info" title={info} aria-label={info} role="img"><AppIcon name="info" /></span> : null}</span>
        {detail ? (
          <button type="button" className="erp-stat-detail" onClick={(e) => { e.stopPropagation(); detail.onClick(); }} title={detail.title}>
            {detail.label}
          </button>
        ) : null}
      </span>
      <span className="erp-stat-row">
        {icon ? <span className={`erp-stat-icon ${STAT_TONE[tone]}`} aria-hidden><AppIcon name={icon} /></span> : null}
        <span className="erp-stat-value">{busy ? <span className="erp-stat-busy" aria-hidden>···</span> : value}</span>
        {badge && !busy ? <span className={`erp-chip erp-chip-sm ${CHIP_TONE[badge.tone ?? tone]}`}>{badge.text}</span> : null}
      </span>
      <span className="erp-stat-foot">
        {spark && spark.length > 1 ? <Spark values={spark} /> : null}
        {hint ? <span className="erp-stat-hint">{hint}</span> : null}
      </span>
    </>
  ) : (
    <>
      <span className="erp-stat-value">{busy ? <span className="erp-stat-busy" aria-hidden>···</span> : value}</span>
      <span className="erp-stat-label">{label}</span>
      {hint ? <span className="erp-stat-hint">{hint}</span> : null}
    </>
  );
  const cls = `erp-stat ${STAT_TONE[tone]}${active ? " erp-stat-active" : ""}${rich ? " erp-stat-rich" : ""}`;
  if (!onClick) return <div className={cls} aria-busy={busy || undefined}>{body}</div>;
  return (
    <button type="button" className={`${cls} erp-stat-button`} onClick={onClick} title={title} aria-pressed={active} aria-busy={busy || undefined}>
      {body}
    </button>
  );
}

const CHIP_TONE: Record<SummaryTone, string> = {
  neutral: "erp-chip-neutral",
  success: "erp-chip-success",
  warning: "erp-chip-warning",
  danger: "erp-chip-danger",
  brand: "erp-chip-info",
};

/** A run of small bars, each the height of its value against the largest;
    the last bar is the current period and carries the tone. Decorative:
    the figure beside it is the number a reader relies on. */
function Spark({ values }: { values: readonly number[] }) {
  const max = Math.max(1, ...values);
  return (
    <span className="erp-spark" aria-hidden>
      {values.slice(-14).map((v, i, all) => (
        <span key={i} className={`erp-spark-bar${i === all.length - 1 ? " erp-spark-now" : ""}`} style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%` }} />
      ))}
    </span>
  );
}

/** Several things in one card, one at a time: a title row with a pill row
    beside it, then one pane per pill. Panes are hidden, never unmounted. */
export function PillCard<T extends string>({ title, icon, lead, tabs, value, onChange, panes, commands, id, className = "", children }: {
  title: ReactNode;
  icon?: AppIconName;
  /** One quiet line under the title. */
  lead?: ReactNode;
  tabs: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  /** One pane per pill key; a missing pane renders nothing for that pill. */
  panes: Partial<Record<T, ReactNode>>;
  /** Buttons for the title row's right side, before the pills. */
  commands?: ReactNode;
  id?: string;
  className?: string;
  /** Anything that belongs to every pane (a shared filter, a footer). */
  children?: ReactNode;
}) {
  return (
    <div id={id} className={`erp-card erp-pill-card ${className}`}>
      <div className="erp-card-head erp-pill-card-head">
        <div className="erp-min0">
          {icon ? <PanelTitle icon={icon}>{title}</PanelTitle> : <p className="erp-panel-title">{title}</p>}
          {lead ? <p className="erp-meta erp-mt-half">{lead}</p> : null}
        </div>
        <div className="erp-flex erp-flex-wrap erp-gap-2">
          {commands}
          <SectionTabs value={value} onChange={onChange} tabs={tabs} />
        </div>
      </div>
      {children}
      {tabs.map(([k]) => (
        <div key={k} hidden={value !== k} className="erp-pane">{panes[k]}</div>
      ))}
    </div>
  );
}

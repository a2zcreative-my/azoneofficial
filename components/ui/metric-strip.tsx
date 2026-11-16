"use client";

/* v1.321.0 - THE COMPACT SUMMARY STRIP, shared (the CEO's "Tasks Module
   Unified Workspace Redesign", 16-11-2026). Moved from sales-shell (v1.292.0);
   sales-shell.tsx re-exports it unchanged.

   v1.323.0 - ONE STRIP (the CEO's Global UI System brief, approved
   16-11-2026; claude/UI-SYSTEM-STAGE-0-AUDIT.md R-2): MetricStrip is the same
   strip as KpiRow / KpiTile (components/ui/kpi-tile.tsx), fed a list instead
   of children - one stylesheet, one segment, one look on every page. Its
   tones are the strip's own tints under the names Sales and Tasks use. It
   fetches nothing and invents nothing. */

import type { ReactNode } from "react";
import type { AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile, type KpiTone } from "@/components/ui/kpi-tile";

export type StripTone = "gold" | "ok" | "bad" | "info" | "neutral";
export interface StripCell {
  key: string; icon: AppIconName; tone: StripTone; label: string; value: ReactNode; sub?: ReactNode;
  busy?: boolean; onClick?: () => void; title?: string;
  /** v1.321.0 - the cell is the filter in force */
  pressed?: boolean;
}
const TONE: Record<StripTone, KpiTone> = { gold: "gold", ok: "green", bad: "red", info: "blue", neutral: "navy" };

export function MetricStrip({ cells, label, testid = "metric-strip" }: { cells: StripCell[]; label: string; testid?: string }) {
  return (
    <KpiRow label={label} testid={testid}>
      {cells.map((c) => (
        <KpiTile key={c.key} cell={c.key} icon={c.icon} tone={TONE[c.tone]} label={c.label} value={c.value} sub={c.sub} busy={c.busy}
          onClick={c.onClick} title={c.title} pressed={c.pressed} />
      ))}
    </KpiRow>
  );
}

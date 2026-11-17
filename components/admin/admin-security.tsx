"use client";

/* v1.351.0 - SECURITY & AUDIT (Phase 3 of the /admin plan the CEO approved,
   17-11-2026). Two views behind one underline tab row, each with ONE KPI strip:
     Audit Trail       the AuditPanel as it is (its own strip, register and details)
     Backups & Errors  a strip from GET /system/health and GET /system/security,
                       then the existing SystemHealthCard (Back up now, the
                       off-site copy, the recent errors) - unchanged
   Nothing here writes; the backup buttons are the card's own, as before. */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { dmy } from "@/lib/format";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { LineTabs } from "@/components/ui/line-tabs";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { AuditPanel } from "@/components/admin/audit-panel";
import { SystemHealthCard } from "@/components/admin/system-health";
import css from "./admin-console.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Health { last_backup: { uploaded: string; size: number } | null; last_offsite?: string | null; migrations_pending?: string[] }
type Read<T> = T | "failed" | null;
type View = "trail" | "backups";

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime()) / 86_400_000);

/** the strip above the backup card: every figure is the server's own answer */
function BackupStrip() {
  const [health, setHealth] = useState<Read<Health>>(null);
  const [errors, setErrors] = useState<Read<number>>(null);
  useEffect(() => {
    void api<Health>("/system/health").then((r) => setHealth(r.ok && r.data ? r.data : "failed"));
    void api<{ platform: { errors_24h: number } }>("/system/security").then((r) => setErrors(r.ok && r.data ? r.data.platform.errors_24h : "failed"));
  }, []);
  if (health === null && errors === null) return <SkelRows rows={2} />; // neither read has answered: the strip's own shape
  const h = health && health !== "failed" ? health : null;
  const na = L("Not available", "Tiada data");
  const bDays = h?.last_backup ? daysSince(h.last_backup.uploaded) : null;
  const oDays = h?.last_offsite ? daysSince(h.last_offsite) : null;
  const pending = h?.migrations_pending ?? null;
  return (
    <KpiRow label={L("Backup and error figures", "Angka sandaran dan ralat")} testid="backup-strip">
      <KpiTile icon="database" tone={bDays === null ? "gold" : bDays <= 2 ? "green" : "red"} label={L("Nightly Backup", "Sandaran Malam")} busy={health === null} testid="tile-backup"
        value={health === "failed" ? na : h?.last_backup ? dmy(h.last_backup.uploaded.slice(0, 10)) : L("None", "Tiada")}
        sub={bDays === null ? undefined : bDays === 0 ? L("Today", "Hari ini") : L(`${bDays} day(s) ago`, `${bDays} hari lalu`)} />
      <KpiTile icon="download" tone={oDays === null ? "gold" : oDays <= 30 ? "green" : "red"} label={L("Off-site Copy", "Salinan Luar Tapak")} busy={health === null} testid="tile-offsite"
        value={health === "failed" ? na : h?.last_offsite ? dmy(h.last_offsite.slice(0, 10)) : L("None recorded", "Tiada direkodkan")}
        sub={oDays === null ? L("Downloaded to your own drive", "Dimuat turun ke pemacu anda") : L(`${oDays} day(s) ago`, `${oDays} hari lalu`)} />
      <KpiTile icon="warning" tone={typeof errors === "number" && errors > 0 ? "red" : "green"} label={L("Errors (24 h)", "Ralat (24 jam)")} busy={errors === null} testid="tile-errors"
        value={errors === "failed" ? na : errors ?? "—"} sub={L("Recorded by the server", "Direkodkan oleh pelayan")} />
      <KpiTile icon="refresh" tone={pending && pending.length ? "gold" : "green"} label={L("Database Updates", "Kemas Kini Pangkalan Data")} busy={health === null} testid="tile-migrations"
        value={health === "failed" ? na : pending === null ? "—" : pending.length ? L(`${pending.length} pending`, `${pending.length} belum`) : L("Up to date", "Terkini")} />
    </KpiRow>
  );
}

export function AdminSecurity() {
  const [view, setView] = useState<View>("trail");
  return (
    <TabPage className={css.page}>
      <LineTabs<View> value={view} onChange={setView} label={L("Security and audit", "Keselamatan dan audit")} testid="security-view"
        tabs={[["trail", L("Audit Trail", "Jejak Audit")], ["backups", L("Backups & Errors", "Sandaran & Ralat")]]} />
      {/* both views stay mounted (hidden, never unmounted): a filter set in the trail survives a look at the backups */}
      <div hidden={view !== "trail"} data-testid="view-trail"><AuditPanel /></div>
      <div hidden={view !== "backups"} data-testid="view-backups">
        <TabPage>
          <TabZone label={L("Backups and errors", "Sandaran dan ralat")}><BackupStrip /></TabZone>
          <TabZone label={L("System health", "Kesihatan sistem")}><div id="system-health"><SystemHealthCard /></div></TabZone>
        </TabPage>
      </div>
    </TabPage>
  );
}

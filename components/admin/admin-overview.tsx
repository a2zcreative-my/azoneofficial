"use client";

/* v1.349.0 - THE SUPER ADMIN'S OVERVIEW (Phase 2 of the /admin plan the CEO
   approved, 17-11-2026). It replaces the content counts (enquiries, posts,
   portfolio, testimonials) with the console's own state, every figure from a
   read that already exists - nothing is computed that the server did not say:
     Accounts / Super Admins   GET /users (every account) + GET /staff/users (2FA)
     Last Backup / Db updates  GET /system/health (the backup and the migrations)
     Errors (24 h)             GET /system/security (platform.errors_24h)
     Recent Account Activity   GET /dashboard/summary (the newest audit rows)
   A figure whose read failed says so; it never shows a guess. */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { dmy, dmyMYT } from "@/lib/format";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SplitColumn, SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { SkelRows } from "@/components/ui/skeleton";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { eventWord } from "@/components/portal/security-status";
import { btnSm, chipSmDanger, chipSmNeutral, chipSmWarn } from "@/lib/ui-styles";
import css from "./admin-console.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Acct { id: number; email: string; name: string; role: string; is_active: number; created_at: string }
interface Health { last_backup: { uploaded: string } | null; migrations_pending?: string[] }
interface Activity { action: string; entity: string | null; entity_id: string | null; created_at: string; user_name: string | null }
type Read<T> = T | "failed" | null;

const SEV_CHIP = { high: chipSmDanger, medium: chipSmWarn, low: chipSmNeutral } as const;
const SEV_WORD = { high: ["High", "Tinggi"], medium: ["Medium", "Sederhana"], low: ["Info", "Info"] } as const;

/** days since a stored UTC time, whole days */
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime()) / 86_400_000);

export function AdminOverview({ onOpen }: { onOpen: (tab: string) => void }) {
  const [accts, setAccts] = useState<Read<Acct[]>>(null);
  const [totp, setTotp] = useState<Read<Map<number, boolean>>>(null);
  const [health, setHealth] = useState<Read<Health>>(null);
  const [errors, setErrors] = useState<Read<number>>(null);
  const [activity, setActivity] = useState<Read<Activity[]>>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    void api<{ users: Acct[] }>("/users").then((r) => setAccts(r.ok && r.data ? r.data.users : "failed"));
    void api<{ users?: { id: number; totp_enabled?: number }[]; staff?: { id: number; totp_enabled?: number }[] }>("/staff/users")
      .then((r) => setTotp(r.ok && r.data ? new Map((r.data.users ?? r.data.staff ?? []).map((u) => [u.id, !!u.totp_enabled])) : "failed"));
    void api<Health>("/system/health").then((r) => setHealth(r.ok && r.data ? r.data : "failed"));
    void api<{ platform: { errors_24h: number } }>("/system/security").then((r) => setErrors(r.ok && r.data ? r.data.platform.errors_24h : "failed"));
    void api<{ activity?: Activity[] }>("/dashboard/summary").then((r) => setActivity(r.ok && r.data ? r.data.activity ?? [] : "failed"));
  }, []);

  const list = Array.isArray(accts) ? accts : [];
  const active = list.filter((u) => u.is_active);
  const supers = active.filter((u) => u.role === "super_admin");
  const map = totp instanceof Map ? totp : null;
  const supersWith2fa = map ? supers.filter((u) => map.get(u.id)).length : null;
  const h = health && health !== "failed" ? health : null;
  const backupDays = h?.last_backup ? daysSince(h.last_backup.uploaded) : null;
  const pending = h?.migrations_pending ?? null;
  /* a known security action in words (eventWord); any other audit action as its own name, made readable - never re-worded into something it is not */
  const word = (action: string) => { const w = eventWord(action); return w.text === action ? { ...w, text: action.replace(/[._]+/g, " ").replace(/^./, (c) => c.toUpperCase()) } : w; };
  const rows = (Array.isArray(activity) ? activity : []).map((a, i) => ({ ...a, id: i + 1, w: word(a.action) }));
  type Row = (typeof rows)[number];
  const cols: TableCol<Row>[] = [
    { key: "when", label: L("Time (MYT)", "Masa (MYT)"), cell: (a) => <span className={css.nowrap}>{dmyMYT(a.created_at)}</span> },
    { key: "event", label: L("Event", "Peristiwa"), main: true, cell: (a) => (
      <span className={css.cell}><strong>{a.w.text}</strong><span>{a.entity ? `${a.entity}${a.entity_id ? ` #${a.entity_id}` : ""}` : a.action}</span></span>
    ) },
    { key: "who", label: L("By", "Oleh"), cell: (a) => a.user_name ?? L("System", "Sistem") },
    { key: "sev", label: L("Level", "Tahap"), cell: (a) => <span className={SEV_CHIP[a.w.sev]}>{L(SEV_WORD[a.w.sev][0], SEV_WORD[a.w.sev][1])}</span> },
  ];
  const link = (icon: AppIconName, title: string, sub: string, tab: string, testid: string) => (
    <li className={css.row} data-testid={testid}>
      <span className={css.rowIcon} aria-hidden><AppIcon name={icon} /></span>
      <span className={css.rowText}><strong>{title}</strong><span>{sub}</span></span>
      <span className={css.rowEnd}><button type="button" className={btnSm} onClick={() => onOpen(tab)}>{L("Open", "Buka")}</button></span>
    </li>
  );

  return (
    <TabPage className={css.page}>
      <TabZone label={L("Console", "Konsol")}>
        <KpiRow label={L("Super Admin overview figures", "Angka gambaran Super Admin")} testid="admin-strip">
          <KpiTile icon="users" tone="navy" label={L("Active Accounts", "Akaun Aktif")} busy={accts === null} testid="tile-accounts"
            value={accts === "failed" ? L("Not available", "Tiada data") : active.length}
            sub={accts === "failed" ? L("Could not be read", "Tidak dapat dibaca") : L(`${list.length} in all · ${list.length - active.length} suspended`, `${list.length} semuanya · ${list.length - active.length} digantung`)}
            onClick={() => onOpen("Users")} />
          <KpiTile icon="verify" tone={supersWith2fa !== null && supersWith2fa < supers.length ? "red" : "green"} label={L("Super Admins", "Super Admin")} busy={accts === null} testid="tile-supers"
            value={accts === "failed" ? "—" : supers.length}
            sub={supersWith2fa === null ? (totp === "failed" ? L("2FA could not be read", "2FA tidak dapat dibaca") : undefined) : L(`${supersWith2fa} of ${supers.length} with 2FA`, `${supersWith2fa} daripada ${supers.length} dengan 2FA`)} />
          <KpiTile icon="database" tone={backupDays === null ? "gold" : backupDays <= 2 ? "green" : "red"} label={L("Last Backup", "Sandaran Terakhir")} busy={health === null} testid="tile-backup"
            value={health === "failed" ? L("Not available", "Tiada data") : h?.last_backup ? dmy(h.last_backup.uploaded.slice(0, 10)) : L("None", "Tiada")}
            sub={backupDays === null ? (health === "failed" ? L("Could not be read", "Tidak dapat dibaca") : L("No backup recorded", "Tiada sandaran direkodkan")) : backupDays === 0 ? L("Today", "Hari ini") : L(`${backupDays} day(s) ago`, `${backupDays} hari lalu`)}
            onClick={() => onOpen("Audit")} />
          <KpiTile icon="warning" tone={typeof errors === "number" && errors > 0 ? "red" : "green"} label={L("Errors (24 h)", "Ralat (24 jam)")} busy={errors === null} testid="tile-errors"
            value={errors === "failed" ? L("Not available", "Tiada data") : errors ?? "—"}
            sub={errors === "failed" ? L("Could not be read", "Tidak dapat dibaca") : L("Recorded by the server", "Direkodkan oleh pelayan")}
            onClick={() => onOpen("Audit")} />
          <KpiTile icon="refresh" tone={pending && pending.length ? "gold" : "green"} label={L("Database Updates", "Kemas Kini Pangkalan Data")} busy={health === null} testid="tile-migrations"
            value={health === "failed" ? L("Not available", "Tiada data") : pending === null ? "—" : pending.length ? L(`${pending.length} pending`, `${pending.length} belum`) : L("Up to date", "Terkini")}
            sub={pending && pending.length ? L("Applied by the next release", "Dipasang oleh keluaran seterusnya") : undefined} />
        </KpiRow>
      </TabZone>
      <TabZone label={L("Activity and console", "Aktiviti dan konsol")}>
        <WorkspaceSplit testid="admin-overview-split" ratio="60-40">
          <SplitPane testid="admin-activity" title={L("Recent Account Activity", "Aktiviti Akaun Terkini")} sub={L("The newest entries in the audit history", "Catatan terbaharu dalam sejarah audit")}
            actions={<button type="button" className={btnSm} onClick={() => onOpen("Audit")}>{L("Full audit", "Audit penuh")}</button>}>
            {activity === null ? <SkelRows rows={6} /> : activity === "failed"
              ? <p className={css.muted} role="alert">{L("The activity could not be read.", "Aktiviti tidak dapat dibaca.")}</p>
              : <CompactTaskTable rows={rows} cols={cols} label={L("Recent account activity", "Aktiviti akaun terkini")} loading={activity === null} record="activity" testid="activity-table"
                  onOpen={() => onOpen("Audit")} page={page} size={6} onPage={setPage} dense
                  empty={<p className={css.muted}>{L("No activity yet.", "Belum ada aktiviti.")}</p>} />}
          </SplitPane>
          <SplitColumn>
            <SplitPane testid="admin-console" title={L("Super Admin Console", "Konsol Super Admin")} sub={L("Where each control lives", "Di mana setiap kawalan berada")}>
              <p className={css.note}>{L("Only Super Admin accounts open this console, and the server refuses its content to every other role.", "Hanya akaun Super Admin membuka konsol ini, dan pelayan menolak kandungannya kepada peranan lain.")}</p>
              <ul className={css.rows}>
                {link("users", L("Users", "Pengguna"), L("Accounts, roles, suspension, sign-outs, the company owner", "Akaun, peranan, penggantungan, log keluar, pemilik syarikat"), "Users", "go-users")}
                {link("verify", L("Signatures", "Tandatangan"), L("Officer signatures and company stamps", "Tandatangan pegawai dan cop syarikat"), "Signatures", "go-signatures")}
                {link("database", L("Security & Audit", "Keselamatan & Audit"), L("Backups, database updates, errors and the full trail", "Sandaran, kemas kini pangkalan data, ralat dan jejak penuh"), "Audit", "go-audit")}
                {link("document", L("Website", "Laman Web"), L("The public website's text and content", "Teks dan kandungan laman web awam"), "Website", "go-website")}
                {link("lock", L("My Account", "Akaun Saya"), L("Your own password, 2FA, passkeys and recovery", "Kata laluan, 2FA, kunci laluan dan pemulihan anda"), "Account", "go-account")}
              </ul>
            </SplitPane>
          </SplitColumn>
        </WorkspaceSplit>
      </TabZone>
    </TabPage>
  );
}

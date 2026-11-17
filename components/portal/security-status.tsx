"use client";

/* v1.341.0 - SECURITY & SESSIONS: THE STATUS READ AND ITS TWO SURFACES (the
   CEO's brief and picture, 17-11-2026).

   useSecurityStatus() reads GET /system/security once (worker
   security-status.ts) - the Overview strip and System health share it, so the
   two can never disagree. Every value is what the server read:
     sessions     the sessions table (unexpired, staff accounts that are on)
     bot check    Cloudflare Turnstile before every sign-in - on only when its
                  keys exist; refusals and outages counted per day (MYT)
     cloudflare   the zone's firewall events, requests and threats for 24 h -
                  ONLY with a read-only token; otherwise "Not connected"
     files        the upload rules as they are: size limit + file-type
                  signature. Not antivirus, and it says so.
     backup       the newest nightly backup and the off-site copy
   A source the server cannot read is shown as that, never as "OK". */

import { useEffect, useState } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile, type KpiTone } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { api } from "@/lib/api";
import { properName } from "@/lib/names";
import { roleLabel } from "@/components/portal/users-shared";
import { chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, listBox } from "@/lib/ui-styles";
import css from "./security-status.module.css";

export interface SessionRow { user_id: number; name: string; role: string; user_agent: string | null; last_seen_at: string | null; created_at: string | null; expires_at: string }
type Cf =
  | { connected: false }
  | { connected: true; ok: false; error: string }
  | { connected: true; ok: true; requests_24h: number; threats_24h: number; firewall_24h: number; firewall_by_action: { action: string; count: number }[] };
export interface SecurityStatus {
  as_of: string;
  sessions: { count: number; active_30m: number; people: number; rows: SessionRow[]; error: string | null };
  bot_check: { enabled: boolean; refused: { today: number; yesterday: number }; outage: { today: number; yesterday: number }; on_outage: "allow" };
  cloudflare: Cf;
  files: { antivirus: false; type_signature: boolean; size_cap: boolean; note: string };
  platform: { errors_24h: number };
  backup: { last: { uploaded: string; size: number } | null; retention_runs: number; offsite_last: string | null; bucket_bound: boolean };
}
export type StatusRead = SecurityStatus | "denied" | "failed" | null;

export function useSecurityStatus(enabled: boolean, tick = 0): StatusRead {
  const [s, setS] = useState<StatusRead>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void api<SecurityStatus>("/system/security").then((r) => {
      if (!live) return;
      setS(r.ok && r.data ? r.data : r.status === 403 ? "denied" : "failed");
    });
    return () => { live = false; };
  }, [enabled, tick]);
  return s;
}

/* ---- helpers shared by the two surfaces ---- */
const hoursSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? (Date.now() - t) / 3600_000 : null;
};
const mytWhen = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t + 8 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const ago = (iso: string | null | undefined): string => {
  const h = hoursSince(iso);
  if (h === null) return "—";
  if (h < 1 / 60) return L("just now", "baru sahaja");
  if (h < 1) return L(`${Math.round(h * 60)} min ago`, `${Math.round(h * 60)} min lalu`);
  if (h < 48) return L(`${Math.round(h)} h ago`, `${Math.round(h)} jam lalu`);
  return L(`${Math.round(h / 24)} days ago`, `${Math.round(h / 24)} hari lalu`);
};
const fmt = (n: number) => n.toLocaleString("en-MY");
/** "Chrome · Windows" from a user agent; nothing more is kept or shown */
export function deviceOf(ua: string | null): string {
  if (!ua) return L("Device not recorded", "Peranti tidak direkodkan");
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : L("Browser", "Pelayar");
  const o = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return o ? `${b} · ${o}` : b;
}

/** the bot check in one word for a tile */
export function botWord(s: SecurityStatus): { value: string; sub: string; tone: KpiTone } {
  if (!s.bot_check.enabled) return { value: L("Off", "Mati"), sub: L("Cloudflare Turnstile keys not set", "Kunci Cloudflare Turnstile belum ditetapkan"), tone: "gold" };
  const r = s.bot_check.refused.today;
  return { value: L("On", "Hidup"), sub: r ? L(`${r} refused today`, `${r} ditolak hari ini`) : L("Every sign-in checked", "Setiap log masuk disemak"), tone: "green" };
}
/** the newest backup for a tile */
export function backupWord(s: SecurityStatus): { value: string; sub: string; tone: KpiTone } {
  const h = hoursSince(s.backup.last?.uploaded);
  if (h === null) return { value: L("None", "Tiada"), sub: L("No backup found", "Tiada sandaran ditemui"), tone: "red" };
  return h <= 48
    ? { value: L("OK", "OK"), sub: L(`Last: ${mytWhen(s.backup.last?.uploaded)}`, `Terakhir: ${mytWhen(s.backup.last?.uploaded)}`), tone: "green" }
    : { value: L("Late", "Lewat"), sub: L(`Last: ${mytWhen(s.backup.last?.uploaded)}`, `Terakhir: ${mytWhen(s.backup.last?.uploaded)}`), tone: "red" };
}

/** the active sessions, newest activity first (the Overview pane and its drawer) */
export function SessionsList({ rows, limit, onManage }: { rows: SessionRow[]; limit?: number; onManage?: (id: number) => void }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  if (!rows.length) return <p className={css.muted}>{L("Nobody is signed in right now.", "Tiada sesiapa log masuk sekarang.")}</p>;
  return (
    <ul className={`${listBox} ${css.sessions}`} data-testid="sessions-list">
      {shown.map((r, i) => {
        const fresh = (hoursSince(r.last_seen_at) ?? 99) <= 0.5;
        return (
          <li key={`${r.user_id}-${i}`}>
            <span className={css.sessWho}><strong>{properName(r.name)}</strong>
              <small>{roleLabel(r.role)} · {deviceOf(r.user_agent)} · {r.last_seen_at ? ago(r.last_seen_at) : L(`signed in ${ago(r.created_at)}`, `log masuk ${ago(r.created_at)}`)}</small></span>
            <span className={css.sessEnd}>
              <span className={fresh ? chipSmSuccess : chipSmNeutral}>{fresh ? L("Active", "Aktif") : L("Idle", "Melahu")}</span>
              {onManage && <button type="button" className={css.link} onClick={() => onManage(r.user_id)}>{L("Devices", "Peranti")}</button>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ================= System health: the strip and the two lists ================= */
export function SecurityHealth({ s, onAudit }: { s: StatusRead; onAudit?: () => void }) {
  if (s === null) return <SkelRows rows={4} />;
  if (s === "denied") return <p className={css.muted}>{L("The CEO and the Super Admin see the security status.", "CEO dan Super Admin melihat status keselamatan.")}</p>;
  if (s === "failed") return <p className={css.muted} role="alert">{L("The security status could not be read - the server may need the latest release.", "Status keselamatan tidak dapat dibaca - pelayan mungkin memerlukan keluaran terkini.")}</p>;
  const cf = s.cloudflare;
  const bot = botWord(s);
  const bk = backupWord(s);
  const cfTile: { value: string; sub: string; tone: KpiTone } = !cf.connected
    ? { value: L("Not connected", "Tidak disambung"), sub: L("Add a read-only Cloudflare token", "Tambah token Cloudflare baca sahaja"), tone: "gold" }
    : !cf.ok ? { value: L("Read failed", "Gagal dibaca"), sub: cf.error, tone: "red" }
    : { value: fmt(cf.firewall_24h), sub: L("Firewall events, last 24 h", "Peristiwa firewall, 24 jam"), tone: "blue" };
  const row = (icon: AppIconName, title: string, sub: string, chip: React.ReactNode, testid: string) => (
    <li data-testid={testid}><span className={css.rowIcon} aria-hidden><AppIcon name={icon} /></span>
      <span className={css.rowText}><strong>{title}</strong><small>{sub}</small></span>{chip}</li>
  );
  return (
    <div className={css.stack} data-testid="security-health">
      <KpiRow label={L("System health figures", "Angka kesihatan sistem")} testid="health-strip">
        <KpiTile icon="success" tone={s.platform.errors_24h ? "red" : "green"} label={L("Platform", "Platform")} value={s.platform.errors_24h ? L(`${s.platform.errors_24h} errors`, `${s.platform.errors_24h} ralat`) : L("Healthy", "Sihat")} sub={L("Recorded errors, last 24 h", "Ralat direkodkan, 24 jam")} />
        <KpiTile icon="verify" tone={bot.tone} label={L("Bot check", "Semakan bot")} value={bot.value} sub={bot.sub} />
        <KpiTile icon="connection" tone={cfTile.tone} label={L("Cloudflare firewall", "Firewall Cloudflare")} value={cfTile.value} sub={cfTile.sub} />
        <KpiTile icon="warning" tone={cf.connected && cf.ok && cf.threats_24h ? "red" : "blue"} label={L("Threats seen", "Ancaman dikesan")}
          value={cf.connected && cf.ok ? fmt(cf.threats_24h) : "—"} sub={cf.connected && cf.ok ? L(`of ${fmt(cf.requests_24h)} requests, 24 h`, `daripada ${fmt(cf.requests_24h)} permintaan, 24 jam`) : L("Needs the Cloudflare token", "Perlu token Cloudflare")} />
        <KpiTile icon="document" tone="gold" label={L("File checks", "Semakan fail")} value={L("Type + size", "Jenis + saiz")} sub={L("Not antivirus scanning", "Bukan imbasan antivirus")} />
        <KpiTile icon="database" tone={bk.tone} label={L("Backup", "Sandaran")} value={bk.value} sub={bk.sub} />
      </KpiRow>
      <WorkspaceSplit testid="health-split" ratio="60-40">
        <SplitPane testid="infra-protection" title={L("Infrastructure & Protection", "Infrastruktur & Perlindungan")} sub={L("Each line is what the server read just now.", "Setiap baris ialah apa yang pelayan baca sebentar tadi.")} label={L("Infrastructure and protection", "Infrastruktur dan perlindungan")}>
          <ul className={`${listBox} ${css.rows}`}>
            {row("verify", L("Bot check before sign-in (Cloudflare Turnstile)", "Semakan bot sebelum log masuk (Cloudflare Turnstile)"),
              s.bot_check.enabled
                ? L(`Password, Google, passkey and set-password are checked. Refused today ${s.bot_check.refused.today}, yesterday ${s.bot_check.refused.yesterday}. If Cloudflare's check is down, sign-in continues with the rate limits and 2FA (outages today: ${s.bot_check.outage.today}).`, `Kata laluan, Google, kunci laluan dan tetapan kata laluan disemak. Ditolak hari ini ${s.bot_check.refused.today}, semalam ${s.bot_check.refused.yesterday}. Jika semakan Cloudflare tergendala, log masuk diteruskan dengan had cubaan dan 2FA (gangguan hari ini: ${s.bot_check.outage.today}).`)
                : L("Off until the Turnstile site key and secret are set on the server.", "Mati sehingga kunci tapak dan rahsia Turnstile ditetapkan pada pelayan."),
              <span className={s.bot_check.enabled ? chipSmSuccess : chipSmWarn}>{s.bot_check.enabled ? L("Active", "Aktif") : L("Off", "Mati")}</span>, "infra-bot")}
            {row("lock", L("Sign-in limits", "Had log masuk"), L("10 failed tries per account and 30 per network in 15 minutes; 2FA for every staff role.", "10 cubaan gagal setiap akaun dan 30 setiap rangkaian dalam 15 minit; 2FA untuk setiap peranan kakitangan."),
              <span className={chipSmSuccess}>{L("Active", "Aktif")}</span>, "infra-limits")}
            {row("connection", L("Cloudflare firewall (WAF) events", "Peristiwa firewall Cloudflare (WAF)"),
              !cf.connected ? L("Not connected - the WAF itself runs at Cloudflare; the portal reads its events only with a read-only token.", "Tidak disambung - WAF sendiri berjalan di Cloudflare; portal membaca peristiwanya hanya dengan token baca sahaja.")
                : !cf.ok ? cf.error
                : cf.firewall_by_action.length ? cf.firewall_by_action.slice(0, 4).map((a) => `${a.action} ${fmt(a.count)}`).join(" · ") : L("No firewall events in 24 h", "Tiada peristiwa firewall dalam 24 jam"),
              <span className={!cf.connected ? chipSmNeutral : cf.ok ? chipSmSuccess : chipSmWarn}>{!cf.connected ? L("Not connected", "Tidak disambung") : cf.ok ? L("Reading", "Dibaca") : L("Read failed", "Gagal")}</span>, "infra-waf")}
            {row("document", L("Upload checks", "Semakan muat naik"), L("Every upload is held to its size limit and its first bytes must match its type. Files are not scanned for viruses.", "Setiap muat naik dihadkan saiznya dan bait pertamanya mesti sepadan dengan jenisnya. Fail tidak diimbas untuk virus."),
              <span className={chipSmInfo}>{L("Type + size", "Jenis + saiz")}</span>, "infra-files")}
            {row("database", L("Database backup", "Sandaran pangkalan data"),
              L(`Nightly, newest ${s.backup.retention_runs} kept${s.backup.bucket_bound ? " in the backups bucket" : ""}. Last: ${mytWhen(s.backup.last?.uploaded)}. Off-site copy: ${s.backup.offsite_last ? mytWhen(s.backup.offsite_last) : "none recorded"}.`, `Setiap malam, ${s.backup.retention_runs} terbaru disimpan${s.backup.bucket_bound ? " dalam baldi sandaran" : ""}. Terakhir: ${mytWhen(s.backup.last?.uploaded)}. Salinan luar: ${s.backup.offsite_last ? mytWhen(s.backup.offsite_last) : "tiada direkodkan"}.`),
              <span className={bk.tone === "green" ? chipSmSuccess : chipSmWarn}>{bk.value}</span>, "infra-backup")}
          </ul>
        </SplitPane>
        <SplitPane testid="cf-traffic" title={L("Cloudflare, last 24 hours", "Cloudflare, 24 jam terakhir")} label={L("Cloudflare traffic", "Trafik Cloudflare")}
          sub={cf.connected && cf.ok ? L(`Read ${mytWhen(s.as_of)} MYT`, `Dibaca ${mytWhen(s.as_of)} MYT`) : undefined}>
          {cf.connected && cf.ok ? (
            <dl className={css.figs}>
              <div><dt>{L("Requests", "Permintaan")}</dt><dd>{fmt(cf.requests_24h)}</dd></div>
              <div><dt>{L("Threats", "Ancaman")}</dt><dd>{fmt(cf.threats_24h)}</dd></div>
              <div><dt>{L("Firewall events", "Peristiwa firewall")}</dt><dd>{fmt(cf.firewall_24h)}</dd></div>
            </dl>
          ) : (
            <p className={css.muted}>{!cf.connected
              ? L("Add a read-only Cloudflare API token (Zone · Analytics · Read) and the zone id on the server to see requests, threats and firewall events here. Until then nothing is shown rather than a guess.", "Tambah token API Cloudflare baca sahaja (Zone · Analytics · Read) dan id zon pada pelayan untuk melihat permintaan, ancaman dan peristiwa firewall di sini. Sehingga itu tiada apa dipaparkan, bukan tekaan.")
              : cf.error}</p>
          )}
          {onAudit && <button type="button" className={css.link} onClick={onAudit}>{L("Detailed events: Audit History", "Peristiwa terperinci: Sejarah Audit")}</button>}
        </SplitPane>
      </WorkspaceSplit>
    </div>
  );
}

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
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { L } from "@/components/portal/page-shared";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile, type KpiTone } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { SplitColumn, SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { api } from "@/lib/api";
import { properName } from "@/lib/names";
import { roleLabel } from "@/components/portal/users-shared";
import { btnSm, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, listBox } from "@/lib/ui-styles";
import css from "./security-status.module.css";

export interface SessionRow { user_id: number; name: string; role: string; user_agent: string | null; last_seen_at: string | null; created_at: string | null; expires_at: string }
/* v1.341.2 - the two Cloudflare figures arrive separately: one refused never hides the other */
type Part<T> = { ok: true; value: T } | { ok: false; error: string };
type Cf =
  | { connected: false }
  | { connected: true; traffic: Part<{ requests_24h: number; threats_24h: number }>; firewall: Part<{ total_24h: number; by_action: { action: string; count: number }[] }>;
      daily?: Part<{ date: string; requests: number; threats: number }[]> };
export interface SecEvent { id: number; action: string; created_at: string; user_name: string | null; entity_id: string | null }
/** Cloudflare's refusal in plain words: a dataset this zone's plan or this token may not read */
const cfWhy = (e: string) => (/does not have access to the path/i.test(e)
  ? L("Not available to this token or this Cloudflare plan", "Tidak tersedia untuk token atau pelan Cloudflare ini")
  : e);
export interface SecurityStatus {
  as_of: string;
  sessions: { count: number; active_30m: number; people: number; rows: SessionRow[]; error: string | null };
  bot_check: { enabled: boolean; refused: { today: number; yesterday: number }; outage: { today: number; yesterday: number }; on_outage: "allow" };
  cloudflare: Cf;
  files: { antivirus: false; type_signature: boolean; size_cap: boolean; note: string };
  platform: { errors_24h: number };
  /** v1.344.0 - what the server refused or recorded in the last seven days (audit_log) */
  events?: SecEvent[];
  backup: { last: { uploaded: string; size: number } | null; retention_runs: number; offsite_last: string | null; bucket_bound: boolean;
    /* v1.375.0 - written only by scripts/restore-test.mjs (PUSH.bat restore-test) */
    restore_test?: { at: string; ok: boolean; source: string; tables: number; rows: number; mismatched: number; reason: string | null; seconds: number; by: string } | null };
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

/* ================= System health (image 02, 17-11-2026) =================
   A strip of five, then two columns: Infrastructure & Protection over the
   Recent Security Events register (left); Threat Monitoring (seven days) over
   File Protection & Recovery (right). Every value is the status read's; a
   source that is not connected or not available says so, never a number. */
const EVENT_WORD: [RegExp, string, string, "high" | "medium" | "low"][] = [
  [/^security\.denied/, "A request was refused (no access)", "Permintaan ditolak (tiada akses)", "medium"],
  [/^auth\.exec_recovery_executed/, "Executive account recovered", "Akaun eksekutif dipulihkan", "high"],
  [/^auth\.exec_recovery/, "Executive recovery step", "Langkah pemulihan eksekutif", "high"],
  [/^auth\.exec_panel/, "Recovery panel changed", "Panel pemulihan diubah", "high"],
  [/^owner\./, "Company owner changed", "Pemilik syarikat diubah", "high"],
  [/passkey_refused/, "Passkey sign-in refused", "Log masuk kunci laluan ditolak", "medium"],
  [/google.*refused|refused.*google/, "Google connection refused", "Sambungan Google ditolak", "low"],
  [/refused|denied/, "Refused by the server", "Ditolak oleh pelayan", "low"],
];
export const eventWord = (a: string): { text: string; sev: "high" | "medium" | "low" } => {
  const m = EVENT_WORD.find(([re]) => re.test(a));
  return m ? { text: L(m[1], m[2]), sev: m[3] } : { text: a, sev: "low" };
};
const SEV_CHIP = { high: chipSmDanger, medium: chipSmWarn, low: chipSmNeutral } as const;
const SEV_WORD = { high: ["High", "Tinggi"], medium: ["Medium", "Sederhana"], low: ["Low", "Rendah"] } as const;

/* v1.368.0 - the Live Reports screenshot AI's use today (decision C2: shown HERE, in the
   existing System health, from GET /staff/live-reports/ai - the server's own counters) */
type LiveAi = { enabled: boolean; bound: boolean; cap: number; ceiling: number; free_neurons_a_day: number; screenshots: number; neurons: number; refused: number; failed: number; fallback: string | null };

export function SecurityHealth({ s, onAudit }: { s: StatusRead; onAudit?: () => void }) {
  const [evPage, setEvPage] = useState(1);
  const [liveAi, setLiveAi] = useState<LiveAi | null | "none">(null);
  useEffect(() => {
    let live = true;
    void api<LiveAi>("/staff/live-reports/ai").then((r) => { if (live) setLiveAi(r.ok && r.data ? r.data : "none"); });
    return () => { live = false; };
  }, []);
  if (s === null) return <SkelRows rows={4} />;
  if (s === "denied") return <p className={css.muted}>{L("The CEO and the Super Admin see the security status.", "CEO dan Super Admin melihat status keselamatan.")}</p>;
  if (s === "failed") return <p className={css.muted} role="alert">{L("The security status could not be read - the server may need the latest release.", "Status keselamatan tidak dapat dibaca - pelayan mungkin memerlukan keluaran terkini.")}</p>;
  const cf = s.cloudflare;
  const fw = cf.connected ? cf.firewall : null;
  const tr = cf.connected ? cf.traffic : null;
  const daily = cf.connected ? cf.daily ?? null : null;
  const bk = backupWord(s);
  const bot = botWord(s);
  const waf: { value: string; sub: string; tone: KpiTone } = !cf.connected
    ? { value: L("Not connected", "Tidak disambung"), sub: L("Add the read-only Cloudflare token", "Tambah token Cloudflare baca sahaja"), tone: "gold" }
    : fw?.ok ? { value: L("Reading", "Dibaca"), sub: L(`${fmt(fw.value.total_24h)} firewall events, 24 h`, `${fmt(fw.value.total_24h)} peristiwa firewall, 24 jam`), tone: "green" }
    : tr?.ok ? { value: L("Connected", "Disambung"), sub: L("Firewall events not on this plan", "Peristiwa firewall tiada pada pelan ini"), tone: "blue" }
    : { value: L("Read failed", "Gagal dibaca"), sub: cfWhy(tr && !tr.ok ? tr.error : fw && !fw.ok ? fw.error : ""), tone: "red" };
  const events = (s.events ?? []).map((e) => ({ ...e, w: eventWord(e.action) }));
  type EvRow = (typeof events)[number];
  const evCols: TableCol<EvRow>[] = [
    { key: "when", label: L("Time", "Masa"), cell: (e) => <span className="erp-nowrap">{mytWhen(e.created_at)}</span> },
    { key: "event", label: L("Event", "Peristiwa"), main: true, cell: (e) => <span className={css.evText}><strong>{e.w.text}</strong>{e.user_name && <small>{properName(e.user_name)}</small>}</span> },
    { key: "sev", label: L("Severity", "Keterukan"), cell: (e) => <span className={SEV_CHIP[e.w.sev]}>{L(SEV_WORD[e.w.sev][0], SEV_WORD[e.w.sev][1])}</span> },
    { key: "src", label: L("Source", "Sumber"), cell: () => <span className={css.muted}>{L("Server audit", "Audit pelayan")}</span> },
  ];
  const maxT = daily?.ok ? Math.max(1, ...daily.value.map((d) => d.threats)) : 1;
  const row = (icon: AppIconName, title: string, sub: string, chip: React.ReactNode, testid: string) => (
    <li data-testid={testid}><span className={css.rowIcon} aria-hidden><AppIcon name={icon} /></span>
      <span className={css.rowText}><strong>{title}</strong><small>{sub}</small></span>{chip}</li>
  );
  /* v1.375.0 (the CEO, 18-11-2026) - the last restore test, as scripts/restore-test.mjs recorded it: a full
     export restored into a TEMPORARY database, every table counted, the temporary database deleted.
     Older than 45 days reads "Due" - the test is monthly. */
  const rt = s.backup.restore_test ?? null;
  const rtAge = rt ? hoursSince(rt.at) : null;
  const rtDue = rtAge !== null && rtAge > 45 * 24;
  const rtSub = !rt ? L("No restore test is recorded yet - run PUSH.bat restore-test on the office PC (monthly)", "Tiada ujian pemulihan direkodkan lagi - jalankan PUSH.bat restore-test pada PC pejabat (bulanan)")
    : rt.ok ? L(`${mytWhen(rt.at)} - ${rt.tables} tables, ${rt.rows.toLocaleString("en-MY")} rows restored into a temporary database and counted; it was then deleted`, `${mytWhen(rt.at)} - ${rt.tables} jadual, ${rt.rows.toLocaleString("ms-MY")} baris dipulihkan ke pangkalan data sementara dan dikira; kemudian dipadam`)
    : L(`${mytWhen(rt.at)} - failed: ${rt.reason ?? "see backups\\restore-test.log"}`, `${mytWhen(rt.at)} - gagal: ${rt.reason ?? "lihat backups\\restore-test.log"}`);
  const rtChip = !rt ? <span className={chipSmWarn}>{L("Not recorded", "Tidak direkodkan")}</span>
    : !rt.ok ? <span className={chipSmDanger}>{L("Failed", "Gagal")}</span>
    : rtDue ? <span className={chipSmWarn}>{L("Due", "Perlu diuji")}</span>
    : <span className={chipSmSuccess}>{L("Passed", "Lulus")}</span>;
  return (
    <div className={css.stack} data-testid="security-health">
      <KpiRow label={L("System health figures", "Angka kesihatan sistem")} testid="health-strip">
        <KpiTile icon="connection" tone={waf.tone} label={L("Cloudflare WAF", "WAF Cloudflare")} value={waf.value} sub={waf.sub} />
        <KpiTile icon="warning" tone={tr?.ok && tr.value.threats_24h ? "red" : "blue"} label={L("Threat Events", "Peristiwa Ancaman")}
          value={tr?.ok ? fmt(tr.value.threats_24h) : "—"} sub={tr?.ok ? L(`of ${fmt(tr.value.requests_24h)} requests, 24 h`, `daripada ${fmt(tr.value.requests_24h)} permintaan, 24 jam`) : tr ? cfWhy(tr.error) : L("Needs the Cloudflare token", "Perlu token Cloudflare")} />
        <KpiTile icon="refresh" tone={s.platform.errors_24h ? "red" : "green"} label={L("API Health", "Kesihatan API")} value={s.platform.errors_24h ? L(`${s.platform.errors_24h} errors`, `${s.platform.errors_24h} ralat`) : L("Healthy", "Sihat")} sub={L(`Recorded errors, 24 h · bot check ${bot.value.toLowerCase()}`, `Ralat direkodkan, 24 jam · semakan bot ${bot.value.toLowerCase()}`)} />
        <KpiTile icon="document" tone="gold" label={L("Malware Scan", "Imbasan Perisian Hasad")} value={L("Not scanning", "Tiada imbasan")} sub={L("Type + size checks only", "Semakan jenis + saiz sahaja")} />
        <KpiTile icon="database" tone={bk.tone} label={L("Backup & Restore", "Sandaran & Pemulihan")} value={bk.value} sub={bk.sub} />
      </KpiRow>
      <WorkspaceSplit testid="health-split" ratio="55-45" hold={false}>
        <SplitColumn>
          <SplitPane testid="infra-protection" title={L("Infrastructure & Protection", "Infrastruktur & Perlindungan")} sub={L("Cloudflare, sign-in, file uploads and database checks", "Cloudflare, log masuk, muat naik fail dan semakan pangkalan data")} label={L("Infrastructure and protection", "Infrastruktur dan perlindungan")}>
            <ul className={`${listBox} ${css.rows}`}>
              {row("connection", L("Cloudflare WAF, DDoS and bot protection", "WAF, DDoS dan perlindungan bot Cloudflare"),
                s.bot_check.enabled ? L(`Bot check on every sign-in: ${s.bot_check.refused.today} refused today, ${s.bot_check.refused.yesterday} yesterday. ${!cf.connected ? "Firewall figures: not connected." : fw?.ok ? `Firewall: ${fw.value.by_action.slice(0, 3).map((a) => `${a.action} ${fmt(a.count)}`).join(" · ") || "no events in 24 h"}.` : "Firewall events are not available on this plan."}`, `Semakan bot pada setiap log masuk: ${s.bot_check.refused.today} ditolak hari ini, ${s.bot_check.refused.yesterday} semalam.`)
                  : L("The bot check before sign-in is off until its keys are set.", "Semakan bot sebelum log masuk dimatikan sehingga kuncinya ditetapkan."),
                <span className={s.bot_check.enabled ? chipSmSuccess : chipSmWarn}>{s.bot_check.enabled ? L("Active", "Aktif") : L("Off", "Mati")}</span>, "infra-waf")}
              {row("lock", L("Rate limiting and API security", "Had kadar dan keselamatan API"), L("10 failed tries per account and 30 per network in 15 minutes; 2FA for every staff role; every request checked on the server.", "10 cubaan gagal setiap akaun dan 30 setiap rangkaian dalam 15 minit; 2FA untuk setiap peranan kakitangan; setiap permintaan disemak pada pelayan."),
                <span className={chipSmSuccess}>{L("Active", "Aktif")}</span>, "infra-limits")}
              {row("document", L("File malware scanning", "Imbasan perisian hasad fail"), L("Not in place. Every upload is held to its size limit and its first bytes must match its type; files are not scanned for viruses.", "Belum ada. Setiap muat naik dihadkan saiznya dan bait pertamanya mesti sepadan dengan jenisnya; fail tidak diimbas untuk virus."),
                <span className={chipSmWarn}>{L("Not scanning", "Tiada imbasan")}</span>, "infra-files")}
              {row("database", L("Database backup and restore", "Sandaran dan pemulihan pangkalan data"), L(`Nightly, newest ${s.backup.retention_runs} kept. Last: ${mytWhen(s.backup.last?.uploaded)}. Off-site copy: ${s.backup.offsite_last ? mytWhen(s.backup.offsite_last) : "none recorded"}.`, `Setiap malam, ${s.backup.retention_runs} terbaru disimpan. Terakhir: ${mytWhen(s.backup.last?.uploaded)}. Salinan luar: ${s.backup.offsite_last ? mytWhen(s.backup.offsite_last) : "tiada direkodkan"}.`),
                <span className={bk.tone === "green" ? chipSmSuccess : chipSmWarn}>{bk.value}</span>, "infra-backup")}
              {liveAi && liveAi !== "none" && row("cloud", L("Live screenshot AI (Cloudflare Workers AI)", "AI tangkapan skrin live (Cloudflare Workers AI)"),
                !liveAi.bound ? L("Not connected on this server - staff type the figures.", "Tidak disambung pada pelayan ini - staf isi angka sendiri.")
                  : L(`Today: ${liveAi.screenshots} of ${liveAi.cap} screenshots, ${fmt(liveAi.neurons)} of ${fmt(liveAi.ceiling)} Neurons (free allowance ${fmt(liveAi.free_neurons_a_day)} a day). Refused ${liveAi.refused}, failed ${liveAi.failed}. Manual entry is always allowed.`,
                      `Hari ini: ${liveAi.screenshots} daripada ${liveAi.cap} tangkapan skrin, ${fmt(liveAi.neurons)} daripada ${fmt(liveAi.ceiling)} Neuron (peruntukan percuma ${fmt(liveAi.free_neurons_a_day)} sehari). Ditolak ${liveAi.refused}, gagal ${liveAi.failed}. Isi sendiri sentiasa dibenarkan.`),
                <span className={!liveAi.bound || !liveAi.enabled ? chipSmNeutral : liveAi.fallback ? chipSmWarn : chipSmSuccess}>{!liveAi.bound ? L("Not connected", "Tidak disambung") : !liveAi.enabled ? L("Off", "Mati") : liveAi.fallback ? L("Manual today", "Manual hari ini") : L("On", "Hidup")}</span>, "infra-live-ai")}
            </ul>
          </SplitPane>
          <SplitPane fit testid="security-events" title={L("Recent Security Events", "Peristiwa Keselamatan Terkini")} sub={L("What the server refused or recorded, last 7 days", "Apa yang pelayan tolak atau rekod, 7 hari terakhir")} label={L("Recent security events", "Peristiwa keselamatan terkini")}
            actions={onAudit ? <button type="button" className={btnSm} onClick={onAudit}>{L("Audit History", "Sejarah Audit")}</button> : undefined}>
            <CompactTaskTable rows={events} cols={evCols} label={L("Recent security events", "Peristiwa keselamatan terkini")} record="event" testid="events-table" onOpen={() => onAudit?.()} dense
              page={evPage} size={3} onPage={setEvPage}
              empty={<p className={css.muted}>{L("Nothing refused or recorded in the last 7 days.", "Tiada apa ditolak atau direkodkan dalam 7 hari terakhir.")}</p>} />
          </SplitPane>
        </SplitColumn>
        <SplitColumn>
          <SplitPane testid="threat-monitoring" title={L("Threat Monitoring", "Pemantauan Ancaman")} sub={L("Threats Cloudflare saw each day, last 7 days", "Ancaman yang Cloudflare lihat setiap hari, 7 hari terakhir")} label={L("Threat monitoring", "Pemantauan ancaman")}>
            {daily?.ok && daily.value.length ? (
              <div className={css.bars} role="img" aria-label={L("Threats per day, last 7 days", "Ancaman sehari, 7 hari terakhir")} data-testid="threat-bars">
                {daily.value.map((d) => (
                  <div key={d.date} className={css.barCol} data-day={d.date} title={L(`${d.date}: ${fmt(d.threats)} threats of ${fmt(d.requests)} requests`, `${d.date}: ${fmt(d.threats)} ancaman daripada ${fmt(d.requests)} permintaan`)}>
                    <span className={css.barVal}>{fmt(d.threats)}</span>
                    <span className={css.bar} style={{ height: `${Math.max(4, (d.threats / maxT) * 100)}%` }} />
                    <span className={css.barDay}>{d.date.slice(8, 10)}-{d.date.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={css.note}>{!cf.connected
                ? L("Connect the read-only Cloudflare token to show a real timeline. No invented counts.", "Sambungkan token Cloudflare baca sahaja untuk paparan sebenar. Tiada kiraan rekaan.")
                : daily && !daily.ok ? cfWhy(daily.error) : L("No daily figures returned yet.", "Belum ada angka harian.")}</p>
            )}
          </SplitPane>
          <SplitPane testid="file-recovery" title={L("File Protection & Recovery", "Perlindungan Fail & Pemulihan")} sub={L("Upload checks and restore readiness", "Semakan muat naik dan kesediaan pemulihan")} label={L("File protection and recovery", "Perlindungan fail dan pemulihan")}>
            <ul className={`${listBox} ${css.rows}`}>
              {row("upload", L("Upload scanning", "Imbasan muat naik"), L("Size limit and file-type check before a file is stored", "Had saiz dan semakan jenis fail sebelum disimpan"), <span className={chipSmInfo}>{L("Type + size", "Jenis + saiz")}</span>, "file-upload")}
              {row("blocked", L("Quarantine records", "Rekod kuarantin"), L("No quarantine exists - a file that fails the checks is refused, not kept", "Tiada kuarantin - fail yang gagal semakan ditolak, bukan disimpan"), <span className={chipSmNeutral}>{L("None kept", "Tiada disimpan")}</span>, "file-quarantine")}
              {row("database", L("Last successful backup", "Sandaran terakhir berjaya"), mytWhen(s.backup.last?.uploaded), <span className={bk.tone === "green" ? chipSmSuccess : chipSmWarn}>{bk.value}</span>, "file-backup")}
              {row("refresh", L("Last restore test", "Ujian pemulihan terakhir"), rtSub, rtChip, "file-restore")}
            </ul>
          </SplitPane>
        </SplitColumn>
      </WorkspaceSplit>
    </div>
  );
}

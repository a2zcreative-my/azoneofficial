"use client";

/* v1.327.0 - USERS & SECURITY → SECURITY & SESSIONS (the CEO's brief and
   picture, 16-11-2026: "2FA, passkeys, recovery panel, active sessions and
   security monitoring. Preserve all existing verification and recovery
   safeguards").

   A layout over what already exists - every figure is a read the portal
   already makes, every control is the existing panel opened in place:
     2FA            the accounts list (totp_enabled) - required for every
                    staff role by the server; it is not a switch, so none is drawn
     passkeys       GET /auth/passkeys (the company's rollout stage); the
                    person's own passkeys open in PasskeysPanel
     recovery       GET /staff/recovery - the owner, the panel and the Super
                    Admin read it (the server refuses anyone else, and that
                    is said); RecoveryPanel opens in place with every rule
                    of worker/src/recovery.ts
     sign-ins       GET /staff/users/activity (the last 60 account events)
     devices        per account (Manage account → Devices signed in): there
                    is no company-wide session list, so none is invented

   Nothing here writes: every action is the existing panel's, with its own
   reason, authenticator code and audit entry.

   v1.341.0 (the CEO's picture, 17-11-2026) - the strip is the photo's six:
   2FA, recent sign-ins, ACTIVE SESSIONS (the sessions table, a drawer of who
   and on what), the BOT CHECK before sign-in (Cloudflare Turnstile), the
   BACKUP and the alerts - the last three from GET /system/security
   (security-status.tsx), so nothing is assumed. The recovery panel stays in
   Authentication Controls. The principles pane gives way to Active Sessions
   (its one rule is kept as the pane's note); no card is added. */

import { useEffect, useMemo, useState } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { TabZone } from "@/components/portal/tab-concept";
import { PillSwitch } from "@/components/ui/panel";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SplitColumn, SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { RecoveryPanel } from "@/components/security/recovery-panel";
import { PasskeysPanel } from "@/components/security/passkeys-panel";
import { SignInSettingsPanel } from "@/components/security/signin-settings-panel";
import { api } from "@/lib/api";
import { properName } from "@/lib/names";
import { btnSm, listBox, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, selectClassSm } from "@/lib/ui-styles";
import { eventLabel, eventTone, mytStamp2, type Account, type AuthEvent } from "@/components/portal/users-shared";
import { SessionsList, backupWord, type StatusRead } from "@/components/portal/security-status";
import css from "./security-sessions.module.css";

type Stage = "off" | "A" | "B" | "C";
type Recovery = { panel: { id: number; name: string; role: string; active: boolean }[]; available: boolean; requests: { id: number; target_name: string; status: string }[] };
const TONE = { success: chipSmSuccess, info: chipSmInfo, warn: chipSmWarn, neutral: chipSmNeutral } as const;
type Drawer = "recovery" | "passkeys" | "signin" | "sessions" | null;

export function SecuritySessions({ staff, loaded, events, eventsLoaded, canSettings, onManage, onStaffAccounts, onAudit, status = null, onHealth, tabs = null, overview = true, onOverview, children = null }: {
  /** the staff accounts the Users tab already holds */
  staff: Account[];
  loaded: boolean;
  events: AuthEvent[];
  eventsLoaded: boolean;
  /** the CEO and the Super Admin keep the sign-in methods (Google, passkey rollout) */
  canSettings: boolean;
  /** Manage account (devices, 2FA reset) - only where the server lets this person */
  onManage?: (id: number) => void;
  onStaffAccounts: () => void;
  onAudit?: () => void;
  /** v1.341.0 - GET /system/security, read by the Users panel (null while reading) */
  status?: StatusRead;
  /** v1.341.0 - System health, for the protection line's View details */
  onHealth?: () => void;
  /** strip above the sub-tabs - the sub-tab row (LineTabs), drawn under the strip */
  tabs?: React.ReactNode;
  /** strip above the sub-tabs - the Overview part is open (its body is hidden, never unmounted, otherwise) */
  overview?: boolean;
  /** strip above the sub-tabs - open the Overview (the Recent Sign-ins tile filters its log) */
  onOverview?: () => void;
  /** strip above the sub-tabs - the other parts, under the sub-tab row */
  children?: React.ReactNode;
}) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [rec, setRec] = useState<Recovery | "denied" | null>(null);
  const [open, setOpen] = useState<Drawer>(null);
  const [who, setWho] = useState("");
  const [kind, setKind] = useState<"all" | "signin" | "twofa" | "other">("all");
  const [page, setPage] = useState(1);
  useEffect(() => {
    let live = true;
    void api<{ stage: Stage }>("/auth/passkeys").then((r) => { if (live) setStage(r.ok && r.data ? r.data.stage : "off"); });
    void api<Recovery>("/staff/recovery").then((r) => { if (live) setRec(r.ok && r.data ? r.data : "denied"); });
    return () => { live = false; };
  }, [open]);

  const active = staff.filter((u) => u.is_active);
  const no2fa = active.filter((u) => !u.totp_enabled);
  const alerts = events.filter((e) => eventTone(e.action) === "warn");
  const signins = events.filter((e) => /^auth\.login/.test(e.action));
  const openRequests = rec && rec !== "denied" ? rec.requests.filter((r) => ["requested", "approved"].includes(r.status)) : [];
  const st = status && typeof status === "object" ? status : null;
  const botOff = st ? !st.bot_check.enabled : false;
  const bk = st ? backupWord(st) : null;
  const backupLate = bk ? bk.tone === "red" : false;
  const alertCount = alerts.length + no2fa.length + openRequests.length + (botOff ? 1 : 0) + (backupLate ? 1 : 0);
  const notShown = status === "denied" ? L("The CEO and the Super Admin see it", "CEO dan Super Admin melihatnya") : status === "failed" ? L("Could not be read", "Tidak dapat dibaca") : "";
  const stageWord = stage === null ? "…" : stage === "off" ? L("Not enabled", "Belum dihidupkan") : stage === "A" ? L("Owner only", "Pemilik sahaja") : stage === "B" ? L("Pilot", "Perintis") : L("Everyone", "Semua");
  const recWord = rec === null ? "…" : rec === "denied" ? L("Not shown to you", "Tidak dipaparkan kepada anda") : rec.available ? L("Ready", "Sedia") : L("Not ready", "Belum sedia");

  /* the sign-in log: the same 60 events, narrowed */
  const rows = useMemo(() => events.map((e, i) => ({ ...e, id: i + 1 })).filter((e) => (!who || e.email === who)
    && (kind === "all" || (kind === "signin" ? /^auth\.login/.test(e.action) : kind === "twofa" ? /2fa/.test(e.action) && !/^auth\.login/.test(e.action) : !/^auth\.login|2fa/.test(e.action)))), [events, who, kind]);
  const fkey = `${who}|${kind}`;
  const [seen, setSeen] = useState(fkey);
  if (fkey !== seen) { setSeen(fkey); setPage(1); }
  const cols: TableCol<AuthEvent & { id: number }>[] = [
    { key: "who", label: L("Account", "Akaun"), main: true, cell: (e) => <span className={css.who}><strong>{properName(e.name ?? "")}</strong><small>{e.email ?? ""}</small></span> },
    { key: "event", label: L("Event", "Peristiwa"), cell: (e) => <span className={TONE[eventTone(e.action)]}>{eventLabel(e.action)}</span> },
    { key: "when", label: L("When (MYT)", "Bila (MYT)"), cell: (e) => <span className={css.when}>{mytStamp2(e.created_at)}</span> },
  ];

  const control = (icon: AppIconName, title: string, sub: string, state: React.ReactNode, act?: React.ReactNode, testid?: string) => (
    <li className={css.control} data-testid={testid}>
      <span className={css.controlIcon} aria-hidden><AppIcon name={icon} /></span>
      <span className={css.controlText}><strong>{title}</strong><small>{sub}</small></span>
      <span className={css.controlState}>{state}{act}</span>
    </li>
  );

  /* strip above the sub-tabs (the CEO 21-11-2026: "Strip KPI card should above the sub tabs") - the page's ONE strip, then the
     sub-tab row, then the parts: the order Company Access, Payments and /admin's Security already draw, the strip
     kept on every part. The Overview body stays mounted (hidden) on the other parts; nothing reads twice. */
  return (
    <div className={css.page} data-testid="security-page">
      <KpiRow label={L("Security figures", "Angka keselamatan")} testid="security-strip">
        <KpiTile icon="verify" tone="green" label={L("2FA Protection", "Perlindungan 2FA")} busy={!loaded}
          value={no2fa.length === 0 ? L("All on", "Semua hidup") : `${active.length - no2fa.length}/${active.length}`}
          sub={no2fa.length === 0 ? L("Every active staff account", "Setiap akaun kakitangan aktif") : L(`${no2fa.length} active without 2FA`, `${no2fa.length} aktif tanpa 2FA`)} />
        <KpiTile icon="access" tone="blue" label={L("Recent Sign-ins", "Log Masuk Terkini")} busy={!eventsLoaded} value={signins.length}
          sub={L("In the last 60 account events", "Dalam 60 peristiwa akaun terakhir")} onClick={() => { setKind("signin"); onOverview?.(); }} pressed={overview && kind === "signin"} />
        <KpiTile icon="users" tone="gold" label={L("Recovery Panel", "Panel Pemulihan")} busy={rec === null} value={recWord} testid="tile-recovery"
          sub={rec && rec !== "denied" ? L(`${rec.panel.filter((m) => m.active).length} of ${rec.panel.length} member(s) can act`, `${rec.panel.filter((m) => m.active).length} daripada ${rec.panel.length} ahli boleh bertindak`) : L("The owner, the panel and the Super Admin see it", "Pemilik, panel dan Super Admin melihatnya")}
          onClick={rec && rec !== "denied" ? () => setOpen("recovery") : undefined} />
        <KpiTile icon="warning" tone="red" label={L("Security Alerts", "Amaran Keselamatan")} busy={!eventsLoaded || !loaded} value={alertCount} testid="tile-alerts"
          sub={alertCount ? L("Requires review", "Perlu disemak") : L("Nothing to review", "Tiada untuk disemak")} />
      </KpiRow>

      {tabs}

      <div hidden={!overview} data-testid="security-sessions">
      <TabZone label={L("Security", "Keselamatan")}>
      <WorkspaceSplit testid="security-split" ratio="60-40">
        <SplitColumn>
          <SplitPane testid="auth-controls" title={L("Authentication Controls", "Kawalan Pengesahan")} sub={L("What protects a sign-in, and who changes it.", "Apa yang melindungi log masuk, dan siapa yang mengubahnya.")} label={L("Authentication controls", "Kawalan pengesahan")}>
            <ul className={css.controls}>
              {control("verify", L("Two-Factor Authentication (2FA)", "Pengesahan Dua Faktor (2FA)"), L("Required for every staff role - nothing opens until it is on", "Diwajibkan untuk setiap peranan kakitangan - tiada apa dibuka sehingga ia hidup"),
                <span className={no2fa.length ? chipSmWarn : chipSmSuccess}>{no2fa.length ? L(`Required · ${no2fa.length} without`, `Wajib · ${no2fa.length} tanpa`) : L("Required · all on", "Wajib · semua hidup")}</span>, undefined, "control-2fa")}
              {control("access", L("Passkeys", "Kunci Laluan"), L("Turned on in stages, only after the recovery panel can act", "Dihidupkan berperingkat, hanya selepas panel pemulihan boleh bertindak"),
                <span className={stage && stage !== "off" ? chipSmSuccess : chipSmWarn}>{stageWord}</span>,
                <button type="button" className={btnSm} onClick={() => setOpen("passkeys")} data-testid="open-passkeys">{L("My passkeys", "Kunci laluan saya")}</button>, "control-passkeys")}
              {control("users", L("Executive Recovery Panel", "Panel Pemulihan Eksekutif"), L("Two members, a second approval and a 12-hour wait before a recovery runs", "Dua ahli, kelulusan kedua dan menunggu 12 jam sebelum pemulihan berjalan"),
                <span className={rec && rec !== "denied" && rec.available ? chipSmInfo : chipSmNeutral}>{recWord}</span>,
                rec && rec !== "denied" ? <button type="button" className={btnSm} onClick={() => setOpen("recovery")} data-testid="open-recovery">{L("Open", "Buka")}</button> : undefined, "control-recovery")}
              {control("lock", L("Sensitive Security Changes", "Perubahan Keselamatan Sensitif"), L("Roles, recovery, sign-outs and permissions ask for a reason and an authenticator code, and are kept in Audit History", "Peranan, pemulihan, log keluar dan kebenaran meminta sebab dan kod pengesah, dan disimpan dalam Sejarah Audit"),
                <span className={chipSmInfo}>{L("Protected", "Dilindungi")}</span>, onAudit ? <button type="button" className={btnSm} onClick={onAudit}>{L("Audit History", "Sejarah Audit")}</button> : undefined, "control-sensitive")}
              {canSettings && control("connection", L("Sign-in Methods", "Kaedah Log Masuk"), L("Google sign-in and the passkey rollout - the CEO and the Super Admin", "Log masuk Google dan pelancaran kunci laluan - CEO dan Super Admin"),
                <span className={chipSmNeutral}>{L("Settings", "Tetapan")}</span>, <button type="button" className={btnSm} onClick={() => setOpen("signin")} data-testid="open-signin">{L("Open", "Buka")}</button>, "control-signin")}
            </ul>
          </SplitPane>
          <SplitPane testid="signin-log" title={L("Sign-in Log", "Log Log Masuk")} label={L("Sign-in log", "Log log masuk")}
            sub={L("The last 60 account events.", "60 peristiwa akaun terakhir.")}
            toolbar={<>
              <select className={selectClassSm} aria-label={L("Filter by account", "Tapis mengikut akaun")} value={who} onChange={(e) => setWho(e.target.value)} data-testid="log-who">
                <option value="">{L("Every account", "Semua akaun")}</option>
                {[...new Set(events.map((e) => e.email ?? ""))].filter(Boolean).map((em) => <option key={em} value={em}>{em}</option>)}
              </select>
              <PillSwitch testid="log-kind" label={L("Event type", "Jenis peristiwa")} value={kind} onChange={setKind}
                options={[["all", L("All", "Semua")], ["signin", L("Sign-ins", "Log masuk")], ["twofa", L("2FA", "2FA")], ["other", L("Other", "Lain")]] as const} />
            </>}>
            <CompactTaskTable rows={rows} cols={cols} label={L("Sign-in log", "Log log masuk")} loading={!eventsLoaded} record="event" testid="signin-table" onOpen={() => {}} dense
              page={page} size={10} onPage={setPage}
              empty={<p className={css.muted}>{L("No events recorded yet.", "Tiada peristiwa direkodkan lagi.")}</p>} />
          </SplitPane>
        </SplitColumn>
        <SplitColumn>
          <SplitPane testid="security-attention" title={L("Security Attention", "Perhatian Keselamatan")} sub={L("What needs an authorised decision.", "Apa yang memerlukan keputusan yang diberi kuasa.")} label={L("Security attention", "Perhatian keselamatan")}>
            {/* v1.344.0 (image 01) - only confirmed items (the server's own state), never an inferred threat; each opens its record */}
            <p className={css.note}>{L("Confirmed items only; each opens its record.", "Perkara disahkan sahaja; setiap satu membuka rekodnya.")}</p>
            {(!loaded || !eventsLoaded) ? <SkelRows rows={3} /> : alertCount === 0 ? (
              <p className={css.calm}><AppIcon name="success" />{L("Nothing needs a decision.", "Tiada apa yang memerlukan keputusan.")}</p>
            ) : (
              <ul className={`${listBox} ${css.attention}`} data-testid="attention-list">
                {botOff && (
                  <li key="bot"><span className={css.attIcon}><AppIcon name="verify" /></span>
                    <span className={css.controlText}><strong>{L("Bot check before sign-in is off", "Semakan bot sebelum log masuk dimatikan")}</strong><small>{L("Set the Cloudflare Turnstile site key and secret on the server to turn it on", "Tetapkan kunci tapak dan rahsia Cloudflare Turnstile pada pelayan untuk menghidupkannya")}</small></span>
                    {onHealth ? <button type="button" className={btnSm} onClick={onHealth}>{L("Details", "Butiran")}</button> : <span className={chipSmWarn}>{L("Review", "Semak")}</span>}</li>
                )}
                {backupLate && bk && (
                  <li key="backup"><span className={css.attIcon}><AppIcon name="database" /></span>
                    <span className={css.controlText}><strong>{L("The nightly backup is late", "Sandaran malam lewat")}</strong><small>{bk.sub}</small></span>
                    {onHealth ? <button type="button" className={btnSm} onClick={onHealth}>{L("Details", "Butiran")}</button> : <span className={chipSmWarn}>{L("Review", "Semak")}</span>}</li>
                )}
                {openRequests.map((r) => (
                  <li key={`r${r.id}`}><span className={css.attIcon}><AppIcon name="access" /></span>
                    <span className={css.controlText}><strong>{L(`Recovery for ${properName(r.target_name)}`, `Pemulihan untuk ${properName(r.target_name)}`)}</strong><small>{r.status === "requested" ? L("Waiting for a second member", "Menunggu ahli kedua") : L("Approved - runs after the wait", "Diluluskan - berjalan selepas menunggu")}</small></span>
                    <button type="button" className={btnSm} onClick={() => setOpen("recovery")}>{L("Review", "Semak")}</button></li>
                ))}
                {no2fa.map((u) => (
                  <li key={`u${u.id}`}><span className={css.attIcon}><AppIcon name="warning" /></span>
                    <span className={css.controlText}><strong>{properName(u.full_name || u.name)}</strong><small>{L("Active without 2FA - nothing opens for them until it is on", "Aktif tanpa 2FA - tiada apa dibuka untuk mereka sehingga ia hidup")}</small></span>
                    {onManage ? <button type="button" className={btnSm} onClick={() => onManage(u.id)}>{L("Manage", "Urus")}</button> : <span className={chipSmWarn}>{L("Review", "Semak")}</span>}</li>
                ))}
                {alerts.slice(0, 8).map((e, i) => (
                  <li key={`e${i}`}><span className={css.attIcon}><AppIcon name="warning" /></span>
                    <span className={css.controlText}><strong>{eventLabel(e.action)}</strong><small>{properName(e.name ?? "")} · {mytStamp2(e.created_at)}</small></span>
                    <span className={chipSmWarn}>{L("Review", "Semak")}</span></li>
                ))}
              </ul>
            )}
            <ul className={css.controls} data-testid="attention-links">
              {control("connection", L("Cloudflare, file protection and backups", "Cloudflare, perlindungan fail dan sandaran"), st ? L(`Bot check ${st.bot_check.enabled ? "on" : "off"} · backup ${bk ? bk.value : "—"} · details on System health`, `Semakan bot ${st.bot_check.enabled ? "hidup" : "mati"} · sandaran ${bk ? bk.value : "—"} · butiran pada Kesihatan sistem`) : L("Detailed monitoring belongs on System health", "Pemantauan terperinci di Kesihatan sistem"),
                null, onHealth ? <button type="button" className={btnSm} onClick={onHealth} data-testid="open-health">{L("Open System health", "Buka Kesihatan sistem")}</button> : undefined, "att-health")}
              {control("access", L("Role and permission changes", "Perubahan peranan dan kebenaran"), L("Reviewed in the existing Audit History", "Disemak dalam Sejarah Audit sedia ada"),
                null, onAudit ? <button type="button" className={btnSm} onClick={onAudit}>{L("View audit", "Lihat audit")}</button> : undefined, "att-audit")}
            </ul>
          </SplitPane>
          {/* v1.344.0 (image 01) - Security Principles: the rule, then where each review lives (the active sessions open in their drawer) */}
          <SplitPane testid="security-principles" title={L("Security Principles", "Prinsip Keselamatan")} sub={L("Existing safeguards remain enforced", "Perlindungan sedia ada kekal dikuatkuasakan")} label={L("Security principles", "Prinsip keselamatan")}>
            <p className={css.note}>{L("CEO rights never bypass identity checks, recovery safeguards or the server.", "Hak CEO tidak memintas semakan identiti, perlindungan pemulihan atau pelayan.")}</p>
            <ul className={css.controls}>
              {control("document", L("Review security events", "Semak peristiwa keselamatan"), L("Every sign-in, refusal and change is in Audit History", "Setiap log masuk, penolakan dan perubahan ada dalam Sejarah Audit"),
                null, onAudit ? <button type="button" className={btnSm} onClick={onAudit}>{L("Audit History", "Sejarah Audit")}</button> : undefined, "pr-audit")}
              {control("users", st ? L(`Review active sessions (${st.sessions.count})`, `Semak sesi aktif (${st.sessions.count})`) : L("Review active sessions", "Semak sesi aktif"),
                st ? L(`${st.sessions.people} people signed in · ${st.sessions.active_30m} active in the last 30 min`, `${st.sessions.people} orang log masuk · ${st.sessions.active_30m} aktif dalam 30 min`) : notShown || L("Reading…", "Membaca…"),
                null, st ? <button type="button" className={btnSm} onClick={() => setOpen("sessions")} data-testid="open-sessions">{L("Open sessions", "Buka sesi")}</button> : undefined, "pr-sessions")}
              {control("person", L("A person's devices and 2FA", "Peranti dan 2FA seseorang"), L("Staff Accounts → Manage account → Devices signed in", "Akaun Kakitangan → Urus akaun → Peranti yang log masuk"),
                null, <button type="button" className={btnSm} onClick={onStaffAccounts}>{L("Staff Accounts", "Akaun Kakitangan")}</button>, "pr-devices")}
            </ul>
          </SplitPane>
        </SplitColumn>
      </WorkspaceSplit>
      </TabZone>
      </div>

      {children}

      <SideDrawer open={open === "sessions"} onClose={() => setOpen(null)} wide title={st ? L(`Active sessions (${st.sessions.count})`, `Sesi aktif (${st.sessions.count})`) : L("Active sessions", "Sesi aktif")}
        subtitle={L("Unexpired sign-ins of staff accounts that are on. Device from the browser's own description; no location is stored.", "Log masuk yang belum tamat bagi akaun kakitangan yang aktif. Peranti daripada keterangan pelayar; tiada lokasi disimpan.")}>
        {st ? <SessionsList rows={st.sessions.rows} onManage={onManage ? (id) => { setOpen(null); onManage(id); } : undefined} /> : null}
      </SideDrawer>
      <SideDrawer open={open === "recovery"} onClose={() => setOpen(null)} wide title={L("Executive Recovery Panel", "Panel Pemulihan Eksekutif")} subtitle={L("Every rule is the server's: two members, a second approval, a 12-hour wait", "Setiap peraturan adalah pelayan: dua ahli, kelulusan kedua, menunggu 12 jam")}>
        <RecoveryPanel />
      </SideDrawer>
      <SideDrawer open={open === "passkeys"} onClose={() => setOpen(null)} wide title={L("My passkeys", "Kunci laluan saya")}>
        <PasskeysPanel wrap={(n) => n ?? <p className={css.muted}>{L("Passkeys are not on for your account.", "Kunci laluan tidak hidup untuk akaun anda.")}</p>} />
      </SideDrawer>
      {canSettings && (
        <SideDrawer open={open === "signin"} onClose={() => setOpen(null)} wide title={L("Sign-in methods", "Kaedah log masuk")}>
          <SignInSettingsPanel />
        </SideDrawer>
      )}
    </div>
  );
}

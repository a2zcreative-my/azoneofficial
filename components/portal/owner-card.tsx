"use client";

/* v1.236.0 - THE COMPANY OWNER (the owner, 30-10-2026; claude/CEO-OWNER-
   ACCESS-AUDIT.md: "Use a documented, authorized privileged administration
   or recovery procedure for the initial CEO permission correction").

   Management sees who the owner is and whether the account still qualifies
   (CEO role, active, 2FA on). Only a super admin names, changes or clears
   it: a reason, then the super admin's authenticator code (the same step-up
   retry the final leave and claim signatures use). The worker decides every
   part of it - GET/POST /staff/owner - and audits it as owner.designate /
   owner.clear. Nothing here grants anything. */

import { useCallback, useEffect, useState } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile"; // v1.344.0
import { SplitColumn, SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split"; // v1.344.0
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table"; // v1.344.0
import { SideDrawer } from "@/components/ui/side-drawer"; // v1.344.0
import { RecoveryPanel } from "@/components/security/recovery-panel"; // v1.344.0
import { SkelRows } from "@/components/ui/skeleton";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { L, withStepUp } from "@/components/portal/page-shared";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import { btnClass, btnSm, card, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, listBox, selectClassSm } from "@/lib/ui-styles";
import css from "./access-policy.module.css";
import oc from "./owner-page.module.css"; // v1.344.0

interface OwnerState {
  owner: { user_id: number; name: string; verified: boolean; why_not: "not_ceo" | "inactive" | "no_2fa" | null; set_at: string; set_by_name: string | null; reason: string } | null;
  can_designate: boolean;
  candidates: { id: number; name: string; totp: boolean }[];
  me_owner: boolean;
}
const WHY: Record<string, [string, string]> = {
  not_ceo: ["no longer holds the CEO role", "tidak lagi memegang peranan CEO"],
  inactive: ["the account is not active", "akaun tidak aktif"],
  no_2fa: ["two-factor sign-in is off", "log masuk dua faktor dimatikan"],
};

export function useOwner(enabled: boolean, tick = 0) {
  const [got, setGot] = useState<{ d: OwnerState | null; e: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    void api<OwnerState>("/staff/owner", { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setGot({ d: r.ok && r.data ? r.data : null, e: r.ok ? "" : L("The owner record needs the latest server.", "Rekod pemilik memerlukan pelayan terkini.") });
    });
    return () => c.abort();
  }, [enabled, tick]);
  return got;
}

export function OwnerCard({ state, onChanged }: { state: { d: OwnerState | null; e: string } | null; onChanged: () => void }) {
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();
  const d = state?.d ?? null;
  const [pick, setPick] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = pick || d?.candidates.find((c) => c.totp)?.id || 0;

  const send = useCallback(async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setError("");
    const r = await withStepUp<{ error?: { message?: string } }>(
      (totp) => api("/staff/owner", { method: "POST", body: JSON.stringify({ ...body, ...(totp ? { totp } : {}) }) }),
      prompt,
      { title: L("Confirm with your authenticator", "Sahkan dengan pengesah anda"), label: L("Your 6-digit authenticator code - this changes who holds the owner's rights", "Kod pengesah 6 digit anda - ini menukar siapa memegang hak pemilik") },
    );
    setBusy(false);
    if (r.ok) { toast(L("Saved", "Disimpan"), done); setReason(""); onChanged(); }
    else setError(r.data?.error?.message ?? L("The server refused the change.", "Pelayan menolak perubahan."));
  }, [prompt, toast, onChanged]);

  return (
    <section className={card} aria-label={L("Company owner", "Pemilik syarikat")}>
      {toastNode}{promptNode}
      <div className={css.head}>
        <div>
          <h3 className={css.title}>{L("Company owner", "Pemilik syarikat")}</h3>
          <p className={css.sub}>{L("The one CEO account that holds the owner's rights on top of the CEO role: executive, customer and Admin accounts and roles - each change with an authenticator code and a reason. Named by a super admin; the CEO role and super admin accounts stay with the super admin.", "Satu akaun CEO yang memegang hak pemilik di atas peranan CEO: akaun dan peranan eksekutif, pelanggan dan Admin - setiap perubahan dengan kod pengesah dan sebab. Dinamakan oleh super admin; peranan CEO dan akaun super admin kekal dengan super admin.")}</p>
        </div>
      </div>
      {state?.e ? <p role="alert" className={css.error}>{state.e}</p> : !d ? <SkelRows rows={2} /> : (
        <>
          {d.owner ? (
            <ul className={css.controls}>
              <li>
                <span className={css.main}>
                  <strong>{d.owner.name}{d.me_owner ? ` · ${L("you", "anda")}` : ""}</strong>
                  <span>{L(`Named ${dmy(d.owner.set_at.slice(0, 10))}${d.owner.set_by_name ? ` by ${d.owner.set_by_name}` : ""} · ${d.owner.reason}`, `Dinamakan ${dmy(d.owner.set_at.slice(0, 10))}${d.owner.set_by_name ? ` oleh ${d.owner.set_by_name}` : ""} · ${d.owner.reason}`)}</span>
                </span>
                {d.owner.verified
                  ? <span className={chipSmSuccess}>{L("Verified", "Disahkan")}</span>
                  : <span className={chipSmWarn}>{L(`Not verified - ${WHY[d.owner.why_not ?? ""]?.[0] ?? ""}`, `Tidak disahkan - ${WHY[d.owner.why_not ?? ""]?.[1] ?? ""}`)}</span>}
              </li>
            </ul>
          ) : (
            <p className={css.warn}><AppIcon name="warning" />{L("No company owner is named. The CEO holds the CEO role's rights only, exactly as before.", "Tiada pemilik syarikat dinamakan. CEO memegang hak peranan CEO sahaja, sama seperti sebelum ini.")}</p>
          )}
          {d.can_designate && (
            <fieldset className={css.form} disabled={busy}>
              <div className={css.formRow}>
                <label>{L("CEO account", "Akaun CEO")}
                  <select className={selectClassSm} value={chosen} onChange={(e) => setPick(Number(e.target.value))}>
                    {d.candidates.length === 0 && <option value={0}>{L("No active CEO account", "Tiada akaun CEO aktif")}</option>}
                    {d.candidates.map((c) => <option key={c.id} value={c.id} disabled={!c.totp}>{c.name}{c.totp ? "" : ` - ${L("2FA off", "2FA mati")}`}</option>)}
                  </select>
                </label>
              </div>
              <label className={css.wide}>{L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}
                <input className={inputClassSm} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              {error && <p role="alert" className={css.error}>{error}</p>}
              <div className={css.formRow}>
                <button type="button" className={btnClass} disabled={!chosen || reason.trim().length < 10 || d.owner?.user_id === chosen}
                  onClick={() => void send({ user_id: chosen, reason: reason.trim() }, L("Company owner named", "Pemilik syarikat dinamakan"))}>
                  <AppIcon name="verify" />{d.owner ? L("Change the owner", "Tukar pemilik") : L("Name as company owner", "Namakan sebagai pemilik syarikat")}
                </button>
                {d.owner && (
                  <button type="button" className={btnSm} disabled={reason.trim().length < 10}
                    onClick={() => void send({ clear: true, reason: reason.trim() }, L("Owner cleared - the CEO is back to the CEO role's rights", "Pemilik dikosongkan - CEO kembali kepada hak peranan CEO"))}>
                    {L("Clear the owner", "Kosongkan pemilik")}
                  </button>
                )}
              </div>
              <p className={css.sub}>{L("Clearing it is the rollback: the owner's extra doors close at once, nothing else changes.", "Mengosongkannya ialah pemulangan: pintu tambahan pemilik ditutup serta-merta, tiada lain berubah.")}</p>
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}

/* ================= v1.344.0 - THE COMPANY OWNER PAGE (image 04, the CEO 17-11-2026) =================
   Users & Security > Security & Sessions > Company owner. A strip of four (the
   owner, recovery member 1 and 2, panel readiness), then Ownership & Control
   over Protected Security Actions (left) and the Executive Recovery Panel over
   the Ownership & Recovery Audit (right). Every value is read: GET /staff/owner
   (OwnerCard's read), GET /staff/recovery (the panel the server keeps - its
   member states are the server's memberBlock reasons), GET /audit (owner.* and
   auth.exec_*). Nothing here writes: naming the owner is OwnerCard (a reason and
   the super admin's code), a recovery is RecoveryPanel, each in its drawer with
   every rule it had. Ready is shown only when the server says two members can act. */
interface RecMember { id: number; user_id: number; name: string; role: string; accepted: boolean; effective_at: string; active: boolean; why: string | null }
interface RecRead { panel: RecMember[]; available: boolean; requests: { id: number; target_name: string; status: string }[] }
interface AuditRow { id: number; action: string; created_at: string; user_name: string | null }
const MEMBER_WHY: Record<string, [string, string]> = {
  not_accepted: ["Has not accepted yet", "Belum menerima"], not_yet_effective: ["Accepted - waiting period running", "Diterima - tempoh menunggu berjalan"],
  account_not_active: ["Account not active", "Akaun tidak aktif"], no_two_factor: ["Two-factor sign-in is off", "Log masuk dua faktor dimatikan"], role_changed: ["No longer COO or CCO", "Bukan lagi COO atau CCO"],
};
const AUDIT_WORD: Record<string, [string, string]> = {
  "owner.designate": ["Company owner named", "Pemilik syarikat dinamakan"], "owner.clear": ["Company owner cleared", "Pemilik syarikat dikosongkan"],
  "auth.exec_panel_added": ["Recovery member added", "Ahli pemulihan ditambah"], "auth.exec_panel_removed": ["Recovery member removed", "Ahli pemulihan dikeluarkan"],
  "auth.exec_panel_accepted": ["Recovery member accepted", "Ahli pemulihan menerima"], "auth.exec_recovery_requested": ["Recovery requested", "Pemulihan diminta"],
  "auth.exec_recovery_approved": ["Recovery approved", "Pemulihan diluluskan"], "auth.exec_recovery_executed": ["Recovery carried out", "Pemulihan dilaksanakan"],
  "auth.exec_recovery_cancelled": ["Recovery cancelled", "Pemulihan dibatalkan"], "auth.exec_recovery_reviewed": ["Recovery reviewed", "Pemulihan disemak"], "auth.exec_recovery_unlocked": ["Recovery unlocked", "Pemulihan dibuka"],
};
const stamp = (s: string) => { const t = Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`); if (!Number.isFinite(t)) return "—"; const d = new Date(t + 8 * 3600_000); return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

export function OwnerPage({ state, onChanged, onRoles, onStaff, onAudit }: {
  state: { d: OwnerState | null; e: string } | null;
  onChanged: () => void;
  onRoles: () => void;
  onStaff: () => void;
  onAudit?: () => void;
}) {
  const [rec, setRec] = useState<RecRead | "denied" | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | "denied" | null>(null);
  const [drawer, setDrawer] = useState<"owner" | "recovery" | null>(null);
  useEffect(() => {
    let live = true;
    void api<RecRead>("/staff/recovery").then((r) => { if (live) setRec(r.ok && r.data ? r.data : "denied"); });
    void Promise.all([api<{ rows?: AuditRow[]; entries?: AuditRow[] }>("/audit?action=owner.&limit=10"), api<{ rows?: AuditRow[]; entries?: AuditRow[] }>("/audit?action=auth.exec_&limit=20")]).then(([a, b]) => {
      if (!live) return;
      if (!a.ok && !b.ok) { setAudit("denied"); return; }
      const rows = [...(a.data?.rows ?? a.data?.entries ?? []), ...(b.data?.rows ?? b.data?.entries ?? [])].sort((x, y) => y.id - x.id).slice(0, 12);
      setAudit(rows);
    });
    return () => { live = false; };
  }, [drawer, state]);
  const d = state?.d ?? null;
  const owner = d?.owner ?? null;
  const members = rec && rec !== "denied" ? rec.panel : [];
  const m1 = members[0] ?? null;
  const m2 = members[1] ?? null;
  const memberTile = (m: RecMember | null, n: 1 | 2) => (
    <KpiTile icon="person" tone={m ? (m.active ? "green" : "gold") : "navy"} label={L(`Recovery Member ${n}`, `Ahli Pemulihan ${n}`)} busy={rec === null} testid={`tile-member-${n}`}
      value={rec === "denied" ? "—" : m ? m.role.toUpperCase() : L("Not added", "Belum ditambah")}
      sub={rec === "denied" ? L("The owner, the panel and the Super Admin see it", "Pemilik, panel dan Super Admin melihatnya") : m ? `${m.name} · ${m.active ? L("can act", "boleh bertindak") : L(MEMBER_WHY[m.why ?? ""]?.[0] ?? "Cannot act yet", MEMBER_WHY[m.why ?? ""]?.[1] ?? "Belum boleh bertindak")}` : L("Two COO/CCO members are needed", "Dua ahli COO/CCO diperlukan")} />
  );
  const row = (icon: AppIconName, title: string, sub: string, end: React.ReactNode, testid: string) => (
    <li data-testid={testid}><span className={oc.rowIcon} aria-hidden><AppIcon name={icon} /></span>
      <span className={oc.rowText}><strong>{title}</strong><small>{sub}</small></span><span className={oc.rowEnd}>{end}</span></li>
  );
  const needsNaming = !owner?.verified && !!d?.can_designate;
  type ARow = AuditRow & { w: string };
  const auditRows: ARow[] = Array.isArray(audit) ? audit.map((a) => ({ ...a, w: AUDIT_WORD[a.action] ? L(AUDIT_WORD[a.action]![0], AUDIT_WORD[a.action]![1]) : a.action })) : [];
  const auditCols: TableCol<ARow>[] = [
    { key: "event", label: L("Event", "Peristiwa"), main: true, cell: (a) => <strong className={oc.cellStrong}>{a.w}</strong> },
    { key: "actor", label: L("Actor", "Pelaku"), cell: (a) => <span>{a.user_name ?? "—"}</span> },
    { key: "when", label: L("Time (MYT)", "Masa (MYT)"), cell: (a) => <span className="erp-nowrap">{stamp(a.created_at)}</span> },
  ];
  if (state?.e) return <p role="alert" className={css.error}>{state.e}</p>;
  return (
    <div className={oc.ownerPage} data-testid="owner-page">
      <KpiRow label={L("Ownership and recovery figures", "Angka pemilikan dan pemulihan")} testid="owner-strip">
        <KpiTile icon="star" tone={owner?.verified ? "gold" : "red"} label={L("Company Owner", "Pemilik Syarikat")} busy={state === null} testid="tile-owner"
          value={!owner ? L("Not named", "Belum dinamakan") : owner.verified ? "CEO" : L("Not verified", "Belum disahkan")}
          sub={owner ? `${owner.name}${owner.verified ? "" : L(` · ${WHY[owner.why_not ?? ""]?.[0] ?? "does not qualify"}`, ` · ${WHY[owner.why_not ?? ""]?.[1] ?? "tidak layak"}`)}` : L("The Super Admin names the owner", "Super Admin menamakan pemilik")} />
        {memberTile(m1, 1)}
        {memberTile(m2, 2)}
        <KpiTile icon="verify" tone={rec && rec !== "denied" && rec.available ? "green" : "gold"} label={L("Panel Readiness", "Kesediaan Panel")} busy={rec === null} testid="tile-panel"
          value={rec === "denied" ? "—" : rec?.available ? L("Ready", "Sedia") : L("Not ready", "Belum sedia")}
          sub={rec === "denied" ? "—" : rec?.available ? L("Two members can act", "Dua ahli boleh bertindak") : L(`${members.filter((m) => m.active).length} of 2 can act`, `${members.filter((m) => m.active).length} daripada 2 boleh bertindak`)}
          onClick={rec && rec !== "denied" ? () => setDrawer("recovery") : undefined} />
      </KpiRow>
      <WorkspaceSplit testid="owner-split" ratio="55-45">
        <SplitColumn>
          <SplitPane testid="ownership-control" title={L("Ownership & Control", "Pemilikan & Kawalan")} sub={L("The CEO keeps the company's highest authority", "CEO memegang kuasa tertinggi syarikat")} label={L("Ownership and control", "Pemilikan dan kawalan")}>
            <p className={oc.note}>{L("The owner's administrative access is kept. Recovery and other irreversible actions still need the approved verification: a reason and an authenticator code, audited.", "Akses pentadbiran pemilik dikekalkan. Pemulihan dan tindakan lain yang tidak boleh diundur masih memerlukan pengesahan yang diluluskan: sebab dan kod pengesah, diaudit.")}</p>
            {needsNaming ? (
              /* v1.252.1 kept: until an owner is verified the naming form is the first thing the Super Admin sees */
              <div data-testid="owner-zone"><OwnerCard state={state} onChanged={onChanged} /></div>
            ) : (
              <ul className={`${listBox} ${oc.rows}`}>
                {row("star", L("Company ownership", "Pemilikan syarikat"), owner ? L(`${owner.name} · named ${dmy(owner.set_at)}${owner.set_by_name ? ` by ${owner.set_by_name}` : ""}`, `${owner.name} · dinamakan ${dmy(owner.set_at)}${owner.set_by_name ? ` oleh ${owner.set_by_name}` : ""}`) : L("No owner named", "Tiada pemilik dinamakan"),
                  <>{owner && <span className={owner.verified ? chipSmSuccess : chipSmWarn}>{owner.verified ? L("Protected", "Dilindungi") : L("Not verified", "Belum disahkan")}</span>}
                    {d?.can_designate && <button type="button" className={btnSm} onClick={() => setDrawer("owner")} data-testid="manage-owner">{L("Manage", "Urus")}</button>}</>, "own-company")}
                {row("access", L("CEO account recovery", "Pemulihan akaun CEO"), L("Two panel members, a second approval and a 12-hour wait", "Dua ahli panel, kelulusan kedua dan menunggu 12 jam"),
                  rec && rec !== "denied" ? <button type="button" className={btnSm} onClick={() => setDrawer("recovery")} data-testid="review-policy">{L("Review policy", "Semak dasar")}</button> : <span className={chipSmNeutral}>{L("Panel members only", "Ahli panel sahaja")}</span>, "own-recovery")}
                {row("lock", L("Administrator permissions", "Kebenaran pentadbir"), L("Enforced on the server; the screen cannot bypass it", "Dikuatkuasakan pada pelayan; skrin tidak boleh memintasnya"),
                  <button type="button" className={btnSm} onClick={onRoles}>{L("Roles & Permissions", "Peranan & Kebenaran")}</button>, "own-roles")}
              </ul>
            )}
          </SplitPane>
          <SplitPane testid="protected-actions" title={L("Protected Security Actions", "Tindakan Keselamatan Dilindungi")} sub={L("Sensitive changes ask for a reason and an authenticator code", "Perubahan sensitif meminta sebab dan kod pengesah")} label={L("Protected security actions", "Tindakan keselamatan dilindungi")}>
            <ul className={`${listBox} ${oc.rows}`}>
              {row("edit", L("Change an account's login email", "Tukar e-mel log masuk akaun"), L("The owner or the Super Admin, with verification", "Pemilik atau Super Admin, dengan pengesahan"), <button type="button" className={btnSm} onClick={onStaff}>{L("Staff Accounts", "Akaun Kakitangan")}</button>, "pa-email")}
              {row("users", L("Modify high-privilege roles", "Ubah peranan berkeistimewaan tinggi"), L("No accidental privilege escalation - every change audited", "Tiada peningkatan keistimewaan tidak sengaja - setiap perubahan diaudit"), <button type="button" className={btnSm} onClick={onRoles}>{L("Review", "Semak")}</button>, "pa-roles")}
              {row("verify", L("Passkeys, stage by stage", "Kunci laluan, peringkat demi peringkat"), L("Only after the recovery panel is ready", "Hanya selepas panel pemulihan sedia"), <span className={rec && rec !== "denied" && rec.available ? chipSmSuccess : chipSmWarn}>{rec && rec !== "denied" && rec.available ? L("Allowed", "Dibenarkan") : L("Waits for the panel", "Menunggu panel")}</span>, "pa-passkeys")}
            </ul>
          </SplitPane>
        </SplitColumn>
        <SplitColumn>
          <SplitPane fit testid="recovery-panel" title={L("Executive Recovery Panel", "Panel Pemulihan Eksekutif")} sub={L("Two members, their acceptance and whether each can act", "Dua ahli, penerimaan mereka dan sama ada setiap satu boleh bertindak")} label={L("Executive recovery panel", "Panel pemulihan eksekutif")}>
            {rec === null ? <SkelRows rows={2} /> : rec === "denied" ? <p className={css.sub}>{L("The owner, the panel members and the Super Admin see the panel.", "Pemilik, ahli panel dan Super Admin melihat panel.")}</p> : (
              <>
                <ul className={`${listBox} ${oc.rows}`}>
                  {members.length === 0 ? <li><span className={oc.rowText}><small>{L("No member added yet.", "Belum ada ahli ditambah.")}</small></span></li>
                    : members.map((m) => row("person", `${m.role.toUpperCase()} — ${m.name}`, m.active ? L("Accepted, two-factor on, can act", "Diterima, dua faktor hidup, boleh bertindak") : L(MEMBER_WHY[m.why ?? ""]?.[0] ?? "Cannot act yet", MEMBER_WHY[m.why ?? ""]?.[1] ?? "Belum boleh bertindak"),
                      <span className={m.active ? chipSmSuccess : chipSmWarn}>{m.active ? L("Can act", "Boleh bertindak") : L("Not yet", "Belum")}</span>, `member-${m.id}`))}
                </ul>
                <p className={rec.available ? oc.okNote : oc.warnNote}>{rec.available ? L("Panel ready: two members can act.", "Panel sedia: dua ahli boleh bertindak.") : L("Panel Ready is shown only after both members can act.", "Panel Sedia dipaparkan hanya selepas kedua-dua ahli boleh bertindak.")}</p>
              </>
            )}
          </SplitPane>
          <SplitPane testid="owner-audit" title={L("Ownership & Recovery Audit", "Audit Pemilikan & Pemulihan")} sub={L("Read-only history, never editable", "Sejarah baca sahaja, tidak boleh diubah")} label={L("Ownership and recovery audit", "Audit pemilikan dan pemulihan")}
            actions={onAudit ? <button type="button" className={btnSm} onClick={onAudit}>{L("Audit History", "Sejarah Audit")}</button> : undefined}>
            {audit === null ? <SkelRows rows={3} /> : audit === "denied" ? <p className={css.sub}>{L("Audit History is for the CEO, Admin and Super Admin.", "Sejarah Audit untuk CEO, Admin dan Super Admin.")}</p> : (
              <CompactTaskTable rows={auditRows} cols={auditCols} label={L("Ownership and recovery audit", "Audit pemilikan dan pemulihan")} record="audit" testid="owner-audit-table" onOpen={() => onAudit?.()} dense
                empty={<p className={css.sub}>{L("No ownership or recovery change recorded yet.", "Belum ada perubahan pemilikan atau pemulihan direkodkan.")}</p>} />
            )}
          </SplitPane>
        </SplitColumn>
      </WorkspaceSplit>
      {d?.can_designate && (
        <SideDrawer open={drawer === "owner"} onClose={() => setDrawer(null)} wide title={L("Company owner", "Pemilik syarikat")} subtitle={L("A reason and the Super Admin's authenticator code, kept in the audit history", "Sebab dan kod pengesah Super Admin, disimpan dalam sejarah audit")}>
          <OwnerCard state={state} onChanged={() => { onChanged(); setDrawer(null); }} />
        </SideDrawer>
      )}
      <SideDrawer open={drawer === "recovery"} onClose={() => setDrawer(null)} wide title={L("Executive Recovery Panel", "Panel Pemulihan Eksekutif")} subtitle={L("Every rule is the server's: two members, a second approval, a 12-hour wait", "Setiap peraturan adalah pelayan: dua ahli, kelulusan kedua, menunggu 12 jam")}>
        <RecoveryPanel />
      </SideDrawer>
    </div>
  );
}

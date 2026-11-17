"use client";

/* v1.331.0 - ROLES & PERMISSIONS, A ROLE AT A TIME (the CEO, 17-11-2026:
   "REPLACE LEGACY ROLES & PERMISSIONS UI ... DO NOT reuse or restyle this
   old layout"). This REPLACES the old wide Access policy matrix
   (AccessPolicyCard, every role across every module, then "Who sees each
   tab" and "Per-user exceptions" stacked under it) on the same route,
   Users & Security -> Roles & Permissions.

     the strip       Total roles · Assigned users · Modules controlled ·
                     Edited permissions · CEO access - read from
                     /staff/access/policy, never invented
     Role Directory  (35%) every role the server knows, search, a filter,
                     each with its active headcount and how many actions it
                     may do
     the editor      (65%) the chosen role only: Permissions (module x
                     View/Create/Edit/Approve/Delete/Export/Manage, each verb
                     a group of the server's own catalogue actions) ·
                     Assigned Users · Role Details · Access Preview
     drawers         Per-user exceptions, Tab visibility, Access review and
                     the Save review - one press away, never stacked

   NOTHING HERE DECIDES ACCESS. Every cell is the catalogue action the
   routes check (worker/src/permissions.ts ACTION_CATALOGUE); a change is
   saved ONLY through POST /staff/access/policy (the verified company owner
   or the super admin, a reason and the authenticator code, audited cell by
   cell, enforced by can() from the next request); a person's role changes
   ONLY through the existing role door (the caller's onAssign). Locked cells
   (owner, backup, the Super Admin and CEO roles) cannot be toggled - the
   server refuses them too. The roles are the server's fixed set: creating,
   duplicating, disabling or deleting a role needs a server change that is
   waiting for the owner's approval, so no such control is drawn. */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs } from "@/components/ui/line-tabs";
import { PillSwitch } from "@/components/ui/panel";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { Switch } from "@/components/ui/switch";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { withStepUp } from "@/components/portal/page-shared";
import { roleLabel, type Account } from "@/components/portal/users-shared";
import { actionStatus, type Policy, type PolicyAction } from "@/components/portal/access-policy";
import { api } from "@/lib/api";
import { setCaps } from "@/lib/caps";
import { dmy } from "@/lib/format";
import { getLang, t } from "@/lib/i18n";
import { properName } from "@/lib/names";
import { btnSm, btnSmPrimary, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./roles-permissions.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* ---------------- the verbs: a way to READ the catalogue, never a rule ---------------- */
export const VERBS = ["view", "create", "edit", "approve", "delete", "export", "manage"] as const;
export type Verb = (typeof VERBS)[number];
const VERB_WORD: Record<Verb, [string, string]> = {
  view: ["View", "Lihat"], create: ["Create", "Cipta"], edit: ["Edit", "Sunting"], approve: ["Approve", "Lulus"],
  delete: ["Delete", "Padam"], export: ["Export", "Eksport"], manage: ["Manage", "Urus"],
};
/* each catalogue action (by key) under the one verb that says what it does;
   anything not listed reads as Manage. A new catalogue action needs no entry. */
const VERB_OF: Record<string, Verb> = {
  sales_view: "view", fa_view: "view", asset_view: "view", asset_self: "view", attendance_location_raw: "view", accounting: "view",
  commission_all: "view", agent_requests_view: "view", task_reports: "view", project_view: "view", audit_read: "view", agent_portal: "view",
  payment_report: "create", fa_edit: "create", claims_submit: "create", commission_draft: "create", fa_templates: "create",
  accounting_post: "create", expenses: "create", task_mail_send: "create",
  mark_paid: "edit", cashbook_correct: "edit", attendance_correct: "edit", task_rename: "edit", project_manage: "edit", hr_manage: "edit",
  org_assign: "edit", role_assign: "edit", responsibilities: "edit", elfia_content: "edit", commission_closer: "edit",
  asset_company_change: "edit", account_email: "edit", fa_priority: "edit", leave_entitlement: "edit", unpaid_leave: "edit", agent_requests_manage: "edit",
  confirm_paid: "approve", payment_verify: "approve", payment_evidence: "approve", fa_decide: "approve", fa_criteria: "approve", fa_allocate: "approve",
  fa_templates_publish: "approve", asset_dispose_approve: "approve", cashbook_accept: "approve", expense_approve: "approve", expense_authorise: "approve",
  books_close: "approve", payroll_release: "approve", commission_approve: "approve", commission_decide: "approve", claims_decide: "approve",
  live_report_review: "approve", project_complete: "approve", company_review: "approve", elfia_publish: "approve",
  task_delete: "delete",
  payroll_export: "export", backup: "export",
};
export const verbOf = (key: string): Verb => VERB_OF[key] ?? "manage";

/* the directory's groups (a filter, not a permission) */
type Group = "all" | "exec" | "staff" | "tech" | "ext";
const GROUP_OF: Record<string, Exclude<Group, "all">> = {
  ceo: "exec", coo: "exec", cco: "exec",
  hr_admin: "staff", sales_marketing: "staff", marketing: "staff", editor: "staff", live_host: "staff",
  admin: "tech", super_admin: "tech", agent: "ext",
};
const GROUP_WORD: Record<Exclude<Group, "all">, [string, string]> = {
  exec: ["Executive", "Eksekutif"], staff: ["Staff", "Kakitangan"], tech: ["Technical", "Teknikal"], ext: ["External", "Luaran"],
};

type St = "on" | "off" | "part" | "cond" | "none";
/** a cell that cannot be toggled: every role of a super-admin-only cap; the super admin's own cell of a keeps cap (the server's LOCKED_CELLS) */
export function cellLocked(a: PolicyAction, role: string): boolean {
  if (!a.locked) return false;
  return a.locked.rule === "super_admin_only" || role === "super_admin";
}
const editableFor = (a: PolicyAction, role: string) => !!a.cap && !!a.editable && !cellLocked(a, role);
function stateOf(acts: PolicyAction[], role: string): St {
  const sts = acts.map((a) => actionStatus(a, role).st).filter((x) => x !== "na");
  if (sts.length === 0) return "none";
  if (sts.every((x) => x === "allow")) return "on";
  if (sts.every((x) => x === "deny")) return "off";
  if (!sts.includes("deny")) return "cond";
  return "part";
}
const ST_WORD: Record<St, [string, string]> = {
  on: ["Allowed", "Dibenarkan"], off: ["Not allowed", "Tidak dibenarkan"], part: ["Some actions", "Sebahagian tindakan"],
  cond: ["Conditional", "Bersyarat"], none: ["No such action in this module", "Tiada tindakan ini dalam modul"],
};

/** one toggle: the house Switch (components/ui/switch.tsx) for one action or a group - "mixed" when only some are on */
function Toggle({ st, label, onPress, disabled, testid }: { st: St; label: string; onPress?: () => void; disabled?: boolean; testid?: string }) {
  const word = `${label}: ${L(ST_WORD[st][0], ST_WORD[st][1])}`;
  return (
    <span className={css.cellSwitch}>
      <Switch checked={st === "on"} mixed={st === "part" || st === "cond"} onChange={() => onPress?.()} disabled={disabled || !onPress}
        label={<span className="erp-sr-only">{word}</span>} showState={false} title={word} testid={testid} />
    </span>
  );
}
/** the read-only mark for a cell nobody here may change */
function Mark({ st, locked, why }: { st: St; locked?: boolean; why?: string }) {
  const word = `${L(ST_WORD[st][0], ST_WORD[st][1])}${why ? ` - ${why}` : ""}`;
  if (st === "none") return <span className={css.none} aria-label={word} title={word}>—</span>;
  return (
    <span className={css.mark} data-st={st} role="img" aria-label={word} title={word}>
      <AppIcon name={locked ? "lock" : st === "on" ? "success" : st === "off" ? "error" : st === "cond" ? "info" : "pending"} />
    </span>
  );
}

type RoleRow = { id: number; role: string; group: Exclude<Group, "all">; people: number; allowed: number };
type View = "perms" | "users" | "details" | "preview";

export function RolesPermissions({ policy, onChanged, staff, loaded, canAssign, assignable, onAssign, exceptions, tabVisibility, exceptionCount, onReview }: {
  policy: { d: Policy | null; e: string } | null;
  onChanged: () => void;
  /** every staff account (customers and agents are never staff) */
  staff: Account[];
  loaded: boolean;
  /** the role door may be offered (the owner or the super admin - the server's roleChangeRule decides) */
  canAssign: boolean;
  /** the roles the role door gives from this page */
  assignable: readonly string[];
  onAssign: (u: Account, role: string) => Promise<boolean>;
  /** the Per-user exceptions card, drawn in its drawer (null = not for this person) */
  exceptions: ReactNode | null;
  /** the Tab visibility card, drawn in its drawer */
  tabVisibility: ReactNode;
  exceptionCount: number | null;
  /** opens the Access review drawer (null = not for this person) */
  onReview: (() => void) | null;
}) {
  const d0 = policy?.d ?? null;
  const canEdit = !!d0?.can_edit_actions;
  const [picked, setPicked] = useState(1); // CEO first: the role the owner asked about
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const [view, setView] = useState<View>("perms");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [drawer, setDrawer] = useState<"" | "save" | "exceptions" | "tabs">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [assignId, setAssignId] = useState(0);
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();

  /* every row of a capability shows the draft (two rows can share one cap) */
  const acts: PolicyAction[] = useMemo(() => (d0?.actions ?? []).map((a) => (a.cap && draft[a.cap]
    ? { ...a, roles: draft[a.cap]!, owner_grant: !!a.owner_grant && !draft[a.cap]!.includes("ceo") } : a)), [d0, draft]);
  const current = useCallback((cap: string) => d0?.actions.find((a) => a.cap === cap)?.roles ?? [], [d0]);
  const pending = Object.entries(draft).filter(([cap, rs]) => rs.join() !== current(cap).join());
  const roles = useMemo(() => d0?.roles ?? [], [d0]);
  const owner = d0?.owner ?? null;

  const roleRows: RoleRow[] = useMemo(() => roles.map((r, i) => ({
    id: i + 1, role: r, group: GROUP_OF[r] ?? "staff", people: d0?.counts?.[r] ?? 0,
    allowed: acts.filter((a) => actionStatus(a, r).st === "allow").length,
  })), [roles, d0, acts]);
  const needle = q.trim().toLowerCase();
  const shownRows = roleRows.filter((x) => (group === "all" || x.group === group) && (!needle || roleLabel(x.role).toLowerCase().includes(needle) || x.role.includes(needle)));
  const sel = roleRows.find((x) => x.id === picked) ?? roleRows[0] ?? null;
  const role = sel?.role ?? "";
  const pick = (id: number) => { setPicked(id); setErr(""); };

  /* ---- the strip ---- */
  const modules = [...new Set(acts.map((a) => a.module))];
  const assignedTotal = Object.values(d0?.counts ?? {}).reduce((n, v) => n + v, 0);
  /* CEO access, against the super admin, from the published cells: what the super admin may do that the CEO may not,
     beyond the owner's grants (when an owner is verified) and the protected cells (locked: the owner, the backup) */
  const saOnly = acts.filter((a) => a.roles.includes("super_admin") && !a.roles.includes("ceo"));
  const ownerOk = !!owner?.verified;
  const protectedActs = saOnly.filter((a) => a.locked?.rule === "super_admin_only" && !a.owner_grant);
  const ownerActs = saOnly.filter((a) => a.owner_grant && !protectedActs.includes(a));
  const gapActs = saOnly.filter((a) => !protectedActs.includes(a) && !(ownerOk && a.owner_grant));
  const gapFixable = gapActs.filter((a) => editableFor(a, "ceo") && !a.owner_grant);

  /* ---- drafting ---- */
  const setFor = (cap: string, base: string[], r: string, on: boolean) => {
    const next = on ? (base.includes(r) ? base : [...base, r]) : base.filter((x) => x !== r);
    return roles.filter((y) => next.includes(y)).concat(next.filter((y) => !roles.includes(y)));
  };
  const toggleActs = (list: PolicyAction[], r: string, on: boolean) => {
    setDraft((x) => {
      const out = { ...x };
      for (const a of list) if (editableFor(a, r)) out[a.cap!] = setFor(a.cap!, out[a.cap!] ?? current(a.cap!), r, on);
      return out;
    });
  };
  const copyFrom = (src: string) => {
    if (!src || !role) return;
    setDraft((x) => {
      const out = { ...x };
      for (const a of d0?.actions ?? []) {
        if (!editableFor(a, role)) continue;
        const has = (out[a.cap!] ?? current(a.cap!)).includes(src);
        out[a.cap!] = setFor(a.cap!, out[a.cap!] ?? current(a.cap!), role, has);
      }
      return out;
    });
  };
  const backToDefault = () => {
    setDraft((x) => {
      const out = { ...x };
      for (const a of d0?.actions ?? []) if (editableFor(a, role) && a.default_roles) out[a.cap!] = setFor(a.cap!, out[a.cap!] ?? current(a.cap!), role, a.default_roles.includes(role));
      return out;
    });
  };
  const matchSuperAdmin = () => toggleActs(gapFixable, "ceo", true);

  const send = useCallback(async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setErr("");
    const r = await withStepUp<{ error?: { message?: string } }>(
      (totp) => api("/staff/access/policy", { method: "POST", body: JSON.stringify({ ...body, ...(totp ? { totp } : {}) }) }),
      prompt,
      { title: L("Confirm with your authenticator", "Sahkan dengan pengesah anda"), label: L("Your 6-digit authenticator code - this changes what roles may do, on the server, at once", "Kod pengesah 6 digit anda - ini menukar apa yang peranan boleh lakukan, di pelayan, serta-merta") },
    );
    setBusy(false);
    if (!r.ok) { setErr(r.data?.error?.message ?? L("The server refused the change.", "Pelayan menolak perubahan.")); return false; }
    toast(L("Saved", "Disimpan"), done);
    setDraft({}); setReason(""); setDrawer("");
    /* the editor's own screens follow at once */
    void api<{ user: { caps?: string[] } }>("/auth/me").then((m) => { if (m.ok && m.data) setCaps(m.data.user.caps); });
    onChanged();
    return true;
  }, [prompt, toast, onChanged]);
  const resetAll = async () => {
    const r = await prompt({ title: L("Reset every edited cell to its default?", "Set semula setiap sel yang disunting kepada asal?"), label: L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)"), required: true });
    if (!r?.value || r.value.trim().length < 10) { if (r) setErr(L("Give a reason of at least 10 characters.", "Beri sebab sekurang-kurangnya 10 aksara.")); return; }
    await send({ reset_all: true, reason: r.value.trim() }, L("Every role is back to its default", "Setiap peranan kembali kepada asal"));
  };

  /* ---- the directory ---- */
  const cols: TableCol<RoleRow>[] = [
    { key: "role", label: L("Role", "Peranan"), main: true, cell: (x) => (
      <span className={css.roleCell}>
        <span className={css.roleIcon} data-group={x.group} aria-hidden><AppIcon name={x.role === "ceo" ? "star" : x.group === "tech" ? "lock" : x.group === "exec" ? "verify" : x.group === "ext" ? "connection" : "users"} /></span>
        <span className={css.roleText}>
          <strong>{roleLabel(x.role)}</strong>
          <small>{L(GROUP_WORD[x.group][0], GROUP_WORD[x.group][1])} · {L(`${x.allowed} of ${acts.length} actions`, `${x.allowed} daripada ${acts.length} tindakan`)}</small>
        </span>
      </span>
    ) },
    { key: "kind", label: L("Type", "Jenis"), cell: () => <span className={chipSmNeutral}>{L("System", "Sistem")}</span> },
    { key: "people", label: L("Users", "Pengguna"), cell: (x) => <span className={css.num}>{x.people}</span> },
  ];

  /* ---- the chosen role ---- */
  const people = staff.filter((u) => u.role === role).sort((a, b) => b.is_active - a.is_active || properName(a.full_name || a.name).localeCompare(properName(b.full_name || b.name)));
  const others = staff.filter((u) => u.is_active && u.role !== role && assignable.includes(u.role));
  const mayAssign = canAssign && assignable.includes(role);
  const sees = (d0?.tabs ?? []).filter((x) => x.always || x.sees.includes(role));
  const hidden = (d0?.tabs ?? []).filter((x) => !(x.always || x.sees.includes(role)));
  const editedHere = (d0?.actions ?? []).filter((a) => a.edited && a.cap);
  const lockedHere = (d0?.actions ?? []).filter((a) => cellLocked(a, role));
  const draftForRole = pending.filter(([cap]) => current(cap).includes(role) !== (draft[cap] ?? []).includes(role)).length;

  const modTable = (
    <div className={css.perm} role="table" aria-label={L(`What a ${roleLabel(role)} may do, by module`, `Apa yang ${roleLabel(role)} boleh lakukan, mengikut modul`)} data-testid="role-perms">
      <div className={`${css.pRow} ${css.pHead}`} role="row">
        <span role="columnheader" className={css.pMod}>{L("Module", "Modul")}</span>
        {VERBS.map((v) => <span key={v} role="columnheader" className={css.pCell}>{L(VERB_WORD[v][0], VERB_WORD[v][1])}</span>)}
      </div>
      {modules.map((m) => {
        const mActs = acts.filter((a) => a.module === m);
        const isOpen = !!open[m];
        return (
          <div key={m} className={css.pGroup} data-testid={`perm-mod-${m}`}>
            <div className={css.pRow} role="row">
              <span role="rowheader" className={css.pMod}>
                <button type="button" className={css.modBtn} aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [m]: !isOpen }))}>
                  <AppIcon name="next" className={`${css.chev} ${isOpen ? css.chevOpen : ""}`} />
                  <span>{t(m, getLang())}</span>
                  <small>{L(`${mActs.filter((a) => actionStatus(a, role).st === "allow").length}/${mActs.length}`, `${mActs.filter((a) => actionStatus(a, role).st === "allow").length}/${mActs.length}`)}</small>
                </button>
              </span>
              {VERBS.map((v) => {
                const vs = mActs.filter((a) => verbOf(a.key) === v);
                const st = stateOf(vs, role);
                const can = canEdit && vs.some((a) => editableFor(a, role));
                return (
                  <span key={v} role="cell" className={css.pCell} data-none={st === "none" ? "" : undefined}>
                    <span className={css.verbName} aria-hidden>{L(VERB_WORD[v][0], VERB_WORD[v][1])}</span>
                    {st === "none" ? <Mark st="none" /> : can
                      ? <Toggle st={st} label={`${t(m, getLang())} - ${L(VERB_WORD[v][0], VERB_WORD[v][1])}`} onPress={() => toggleActs(vs, role, st !== "on")} testid={`perm-${m}-${v}`} />
                      : <Mark st={st} locked={vs.every((a) => cellLocked(a, role))} why={vs.find((a) => cellLocked(a, role))?.locked?.why} />}
                  </span>
                );
              })}
            </div>
            {isOpen && (
              <ul className={css.acts} aria-label={L(`${t(m, getLang())} actions`, `Tindakan ${t(m, getLang())}`)}>
                {mActs.map((a) => {
                  const s = actionStatus(a, role);
                  const st: St = s.st === "allow" ? "on" : s.st === "deny" ? "off" : s.st === "na" ? "none" : "cond";
                  const needRow = a.needs ? acts.find((x) => x.cap === a.needs) : null;
                  const needMissing = !!needRow && a.roles.includes(role) && !needRow.roles.includes(role);
                  return (
                    <li key={a.key} data-testid={`act-${a.key}`}>
                      <span className={css.actText}>
                        <strong>{L(a.en, a.ms)}</strong>
                        <span className={css.tags}>
                          <span className={chipSmNeutral}>{L(VERB_WORD[verbOf(a.key)][0], VERB_WORD[verbOf(a.key)][1])}</span>
                          {a.edited && <span className={chipSmInfo} title={a.edit_meta ? `${a.edit_meta.by_name} · ${a.edit_meta.at} · ${a.edit_meta.reason}` : undefined}>{L("Edited", "Disunting")}</span>}
                          {cellLocked(a, role) && <span className={chipSmWarn} title={a.locked!.why}><AppIcon name="lock" />{L("Protected", "Dilindungi")}</span>}
                          {!a.cap && <span className={chipSmWarn}><AppIcon name="lock" />{L("Fixed in code", "Tetap dalam kod")}</span>}
                        </span>
                        {(s.note || a.note_en) && <small>{s.note || L(a.note_en ?? "", a.note_ms ?? a.note_en ?? "")}</small>}
                        {needMissing && <small className={css.warnText}>{L(`Also needs "${needRow!.en}" - without it the server still refuses.`, `Juga memerlukan "${needRow!.ms}" - tanpanya pelayan tetap menolak.`)}</small>}
                      </span>
                      {canEdit && editableFor(a, role)
                        ? <Toggle st={st} label={L(a.en, a.ms)} onPress={() => toggleActs([a], role, !a.roles.includes(role))} testid={`act-toggle-${a.key}`} />
                        : <Mark st={st} locked={cellLocked(a, role) || !a.cap} why={cellLocked(a, role) ? a.locked!.why : undefined} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );

  const review = (
    <div className={css.review}>
      <ul className={css.list}>
        {pending.map(([cap, to]) => {
          const from = current(cap);
          const gain = to.filter((r) => !from.includes(r));
          const lose = from.filter((r) => !to.includes(r));
          const rowsOf = (d0?.actions ?? []).filter((a) => a.cap === cap);
          const who = (rs: string[]) => rs.map((r) => `${roleLabel(r)} (${d0?.counts?.[r] ?? 0})`).join(", ");
          return (
            <li key={cap} data-testid={`review-${cap}`}>
              <span className={css.actText}>
                <strong>{rowsOf.map((a) => `${t(a.module, getLang())} — ${L(a.en, a.ms)}`).join(" · ")}</strong>
                {gain.length > 0 && <small className={css.gain}>{L("Gains", "Mendapat")}: {who(gain)}</small>}
                {lose.length > 0 && <small className={css.warnText}>{L("Loses", "Kehilangan")}: {who(lose)}</small>}
                {to.length === 0 && <small className={css.warnText}>{L("Nobody will be able to do this.", "Tiada siapa akan dapat melakukan ini.")}</small>}
                {rowsOf.map((a) => {
                  if (!a.needs) return null;
                  const needRow = (d0?.actions ?? []).find((x) => x.cap === a.needs);
                  const needHas = draft[a.needs] ?? needRow?.roles ?? [];
                  const missing = gain.filter((r) => !needHas.includes(r));
                  return missing.length ? <small key={a.key} className={css.warnText}>{L(`Also needs "${needRow ? needRow.en : a.needs}" for ${missing.map(roleLabel).join(", ")} - turn it on too, or this will still be refused.`, `Juga memerlukan "${needRow ? needRow.ms : a.needs}" untuk ${missing.map(roleLabel).join(", ")} - hidupkan juga, atau ia tetap ditolak.`)}</small> : null;
                })}
              </span>
            </li>
          );
        })}
      </ul>
      <label className={css.field}>{L("Reason (at least 10 characters, kept in the audit history)", "Sebab (sekurang-kurangnya 10 aksara, disimpan dalam sejarah audit)")}
        <input className={inputClassSm} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="perm-reason" /></label>
      {err && <p role="alert" className={css.error}>{err}</p>}
    </div>
  );

  const editor = !sel ? null : (
    <>
      <div className={css.selHead}>
        <span className={css.roleIcon} data-group={sel.group} aria-hidden><AppIcon name={sel.role === "ceo" ? "star" : sel.group === "tech" ? "lock" : sel.group === "exec" ? "verify" : sel.group === "ext" ? "connection" : "users"} /></span>
        <span className={css.roleText}>
          <strong className={css.big} data-testid="role-title">{roleLabel(role)}</strong>
          <small>{L(GROUP_WORD[sel.group][0], GROUP_WORD[sel.group][1])} · {L(`${sel.people} active`, `${sel.people} aktif`)} · {L(`${sel.allowed} of ${acts.length} actions`, `${sel.allowed} daripada ${acts.length} tindakan`)}</small>
        </span>
        <span className={css.tags}>
          <span className={chipSmNeutral}>{L("System role", "Peranan sistem")}</span>
          {role === "ceo" && ownerOk && <span className={chipSmSuccess}>{L("Owner verified", "Pemilik disahkan")}</span>}
          {draftForRole > 0 && <span className={chipSmWarn} data-testid="role-unsaved">{L(`${draftForRole} unsaved`, `${draftForRole} belum disimpan`)}</span>}
        </span>
      </div>
      <LineTabs value={view} onChange={setView} label={L("Role parts", "Bahagian peranan")} testid="role-part" tabs={[
        ["perms", L("Permissions", "Kebenaran"), null, L("Permissions", "Kebenaran")],
        ["users", role === "agent" ? L("Assigned Users", "Pengguna Ditetapkan") : L(`Assigned Users (${people.length})`, `Pengguna Ditetapkan (${people.length})`), null, role === "agent" ? L("Users", "Pengguna") : L(`Users (${people.length})`, `Pengguna (${people.length})`)],
        ["details", L("Role Details", "Butiran Peranan"), null, L("Details", "Butiran")],
        ["preview", L("Access Preview", "Pratonton Akses"), null, L("Preview", "Pratonton")],
      ] as const} />

      <div hidden={view !== "perms"} className={css.part}>
        <div className={css.partBar}>
          <p className={css.muted}>{canEdit
            ? L("Turn a switch to allow or deny it for this role. Nothing changes until you save with a reason and your authenticator code; the server then enforces it on every request.", "Tukar suis untuk membenarkan atau menolak bagi peranan ini. Tiada apa berubah sehingga anda simpan dengan sebab dan kod pengesah; pelayan kemudian menguatkuasakannya pada setiap permintaan.")
            : L("What this role may do, as the server enforces it. The company owner and the super admin change it.", "Apa yang peranan ini boleh lakukan, seperti dikuatkuasa pelayan. Pemilik syarikat dan super admin menukarnya.")}</p>
          {canEdit && (
            <span className={css.inline}>
              <select className={selectClassSm} aria-label={L("Set from template", "Tetapkan daripada templat")} value="" data-testid="perm-template"
                onChange={(e) => copyFrom(e.target.value)}>
                <option value="">{L("Set from template…", "Tetapkan daripada templat…")}</option>
                {roles.filter((r) => r !== role).map((r) => <option key={r} value={r}>{L(`Same as ${roleLabel(r)}`, `Sama seperti ${roleLabel(r)}`)}</option>)}
              </select>
              <button type="button" className={btnSm} onClick={backToDefault} data-testid="perm-default">{L("Role defaults", "Asal peranan")}</button>
            </span>
          )}
        </div>
        {role === "ceo" && canEdit && gapFixable.length > 0 && (
          <p className={css.notice}><AppIcon name="info" />
            <span>{L(`The Super Admin may do ${gapFixable.length} thing(s) the CEO may not, outside the protected cells.`, `Super Admin boleh melakukan ${gapFixable.length} perkara yang CEO tidak boleh, di luar sel dilindungi.`)}</span>
            <button type="button" className={btnSm} onClick={matchSuperAdmin} data-testid="ceo-match">{L("Match the Super Admin", "Sama seperti Super Admin")}</button>
          </p>
        )}
        {modTable}
      </div>

      <div hidden={view !== "users"} className={css.part} data-testid="role-users">
        {mayAssign && (
          <div className={css.inline}>
            <select className={selectClassSm} aria-label={L("Account to give this role", "Akaun untuk diberi peranan ini")} value={assignId} onChange={(e) => setAssignId(Number(e.target.value))} data-testid="assign-pick">
              <option value={0}>{L("Choose a staff account…", "Pilih akaun kakitangan…")}</option>
              {others.map((u) => <option key={u.id} value={u.id}>{properName(u.full_name || u.name)} · {roleLabel(u.role)}</option>)}
            </select>
            <button type="button" className={btnSmPrimary} disabled={!assignId || busy} data-testid="assign-go"
              onClick={async () => { const u = others.find((x) => x.id === assignId); if (!u) return; setBusy(true); const ok = await onAssign(u, role); setBusy(false); if (ok) setAssignId(0); }}>
              <AppIcon name="add" />{L(`Assign to ${roleLabel(role)}`, `Tetapkan kepada ${roleLabel(role)}`)}</button>
          </div>
        )}
        {!mayAssign && <p className={css.muted}>{role === "agent" ? L("Agent access is given and revoked in Customers & Agents (a proven email, the same account).", "Akses ejen diberi dan ditarik di Pelanggan & Ejen (e-mel yang dibuktikan, akaun yang sama).") : role === "super_admin" ? L("Super Admin accounts are kept by the Super Admin in /admin.", "Akaun Super Admin disimpan oleh Super Admin di /admin.") : L("The company owner or the Super Admin gives a role; the server decides each change.", "Pemilik syarikat atau Super Admin memberi peranan; pelayan memutuskan setiap perubahan.")}</p>}
        {role === "agent" ? null : !loaded ? <SkelRows rows={3} /> : people.length === 0 ? <p className={css.muted}>{L("Nobody holds this role.", "Tiada siapa memegang peranan ini.")}</p> : (
          <ul className={css.list}>
            {people.map((u) => (
              <li key={u.id} data-testid={`role-user-${u.id}`}>
                <span className={css.who}><Avatar name={properName(u.full_name || u.name)} photoKey={u.photo_key} size="sm" />
                  <span className={css.actText}><strong>{properName(u.full_name || u.name)}</strong><small>{u.email}</small></span></span>
                <span className={css.tags}>
                  {u.is_active ? <span className={chipSmSuccess}>{L("Active", "Aktif")}</span> : <span className={chipSmDanger}>{L("Inactive", "Tidak aktif")}</span>}
                  {!u.totp_enabled && u.is_active ? <span className={chipSmWarn}>{L("2FA off", "2FA mati")}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div hidden={view !== "details"} className={css.part} data-testid="role-details">
        <dl className={css.facts}>
          <div><dt>{L("Role key", "Kunci peranan")}</dt><dd>{role}</dd></div>
          <div><dt>{L("Type", "Jenis")}</dt><dd>{L("System role - fixed in the server's code", "Peranan sistem - tetap dalam kod pelayan")}</dd></div>
          <div><dt>{L("Group", "Kumpulan")}</dt><dd>{L(GROUP_WORD[sel.group][0], GROUP_WORD[sel.group][1])}</dd></div>
          <div><dt>{L("Active accounts", "Akaun aktif")}</dt><dd>{sel.people}</dd></div>
        </dl>
        {role === "ceo" && (
          <div className={css.block} data-testid="ceo-vs-sa">
            <p className={css.label}>{L("CEO and Super Admin", "CEO dan Super Admin")}</p>
            <p className={css.muted}>{ownerOk
              ? L(`${owner!.name} is the verified company owner: the CEO role's rights plus the owner's administrative rights, each with an authenticator code.`, `${owner!.name} ialah pemilik syarikat yang disahkan: hak peranan CEO serta hak pentadbiran pemilik, setiap satu dengan kod pengesah.`)
              : L("No verified company owner: the owner's administrative rights are closed until a super admin names the CEO (Security & Sessions → Company owner) and 2FA is on.", "Tiada pemilik syarikat yang disahkan: hak pentadbiran pemilik ditutup sehingga super admin menamakan CEO (Keselamatan & Sesi → Pemilik syarikat) dan 2FA hidup.")}</p>
            {ownerActs.length > 0 && <p className={css.muted}><strong>{L("Owner rights", "Hak pemilik")}: </strong>{ownerActs.map((a) => L(a.en, a.ms)).join(" · ")}</p>}
            {protectedActs.length > 0 && <p className={css.muted}><strong>{L("Protected - the Super Admin only", "Dilindungi - Super Admin sahaja")}: </strong>{protectedActs.map((a) => L(a.en, a.ms)).join(" · ")}</p>}
          </div>
        )}
        <div className={css.block}>
          <p className={css.label}>{L(`Edited permissions (${editedHere.length})`, `Kebenaran disunting (${editedHere.length})`)}</p>
          {editedHere.length === 0 ? <p className={css.muted}>{L("Every permission is at its default.", "Setiap kebenaran pada asalnya.")}</p> : (
            <ul className={css.list}>{editedHere.map((a) => (
              <li key={a.key}><span className={css.actText}><strong>{t(a.module, getLang())} — {L(a.en, a.ms)}</strong>
                <small>{a.roles.map(roleLabel).join(", ") || L("Nobody", "Tiada siapa")}{a.edit_meta ? ` · ${a.edit_meta.by_name} · ${dmy(a.edit_meta.at.slice(0, 10))} · ${a.edit_meta.reason}` : ""}</small></span></li>
            ))}</ul>
          )}
          {canEdit && (d0?.edited_count ?? 0) > 0 && <div className={css.inline}><button type="button" className={btnSm} disabled={busy} onClick={() => void resetAll()} data-testid="perm-reset-all">{L(`Reset all to default (${d0!.edited_count})`, `Set semula semua (${d0!.edited_count})`)}</button></div>}
        </div>
        {lockedHere.length > 0 && (
          <div className={css.block}>
            <p className={css.label}>{L("Protected for this role", "Dilindungi untuk peranan ini")}</p>
            <ul className={css.list}>{lockedHere.map((a) => <li key={a.key}><span className={css.actText}><strong>{L(a.en, a.ms)}</strong><small>{a.locked!.why}</small></span></li>)}</ul>
          </div>
        )}
      </div>

      <div hidden={view !== "preview"} className={css.part} data-testid="role-preview">
        <p className={css.label}>{L(`Sees ${sees.length} tab(s)`, `Melihat ${sees.length} tab`)}</p>
        <span className={css.chipWrap}>{sees.map((x) => <span key={x.tab} className={chipSmSuccess}>{t(x.tab, getLang())}</span>)}</span>
        {hidden.length > 0 && <>
          <p className={css.label}>{L(`Does not see ${hidden.length}`, `Tidak melihat ${hidden.length}`)}</p>
          <span className={css.chipWrap}>{hidden.map((x) => <span key={x.tab} className={chipSmNeutral}>{t(x.tab, getLang())}</span>)}</span>
        </>}
        <p className={css.muted}>{L("Seeing a tab is never a permission: the server checks every action on its own. One person's tabs can differ only through a per-user exception.", "Melihat tab bukan kebenaran: pelayan menyemak setiap tindakan sendiri. Tab seseorang boleh berbeza hanya melalui pengecualian setiap pengguna.")}</p>
      </div>
    </>
  );

  return (
    <div className={css.page} data-testid="roles-permissions">
      {toastNode}{promptNode}
      <KpiRow label={L("Roles and permissions figures", "Angka peranan dan kebenaran")} testid="roles-strip">
        <KpiTile icon="users" tone="navy" label={L("Total Roles", "Jumlah Peranan")} value={roles.length} busy={!d0} sub={L("System roles", "Peranan sistem")} cell="roles" />
        <KpiTile icon="person" tone="blue" label={L("Assigned Users", "Pengguna Ditetapkan")} value={assignedTotal} busy={!d0} sub={L("Active staff accounts", "Akaun kakitangan aktif")} cell="assigned" />
        <KpiTile icon="folder" tone="purple" label={L("Modules Controlled", "Modul Dikawal")} value={modules.length} busy={!d0} sub={L(`${acts.length} server-checked actions`, `${acts.length} tindakan disemak`)} cell="modules" />
        <KpiTile icon="edit" tone="gold" label={L("Edited Permissions", "Kebenaran Disunting")} value={d0?.edited_count ?? 0} busy={!d0} sub={L("Reason and code each", "Sebab dan kod setiap satu")} cell="edited" />
        <KpiTile icon="verify" tone={gapActs.length === 0 ? "green" : "red"} label={L("CEO Access", "Akses CEO")} busy={!d0} cell="ceo"
          value={gapActs.length === 0 ? L("Equivalent", "Setara") : L(`${gapActs.length} gap(s)`, `${gapActs.length} jurang`)}
          sub={gapActs.length === 0 ? L(`Except ${protectedActs.length} protected`, `Kecuali ${protectedActs.length} dilindungi`) : !ownerOk ? L("Owner not verified", "Pemilik belum disahkan") : L("See CEO → Role Details", "Lihat CEO → Butiran")}
          onClick={() => { const i = roleRows.find((x) => x.role === "ceo"); if (i) { pick(i.id); setView("details"); } }} />
      </KpiRow>
      {policy?.e ? <p role="alert" className={css.error}>{policy.e}</p> : (
        <WorkspaceSplit testid="roles-split" ratio="35-65">
          <SplitPane testid="role-directory" title={L(`Role Directory (${roles.length})`, `Direktori Peranan (${roles.length})`)} label={L("Role directory", "Direktori peranan")}
            sub={L("Choose a role to see and change what it may do.", "Pilih peranan untuk melihat dan menukar apa yang boleh dilakukan.")}
            toolbar={<>
              <label className={css.search}><AppIcon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search roles", "Cari peranan")} aria-label={L("Find a role", "Cari peranan")} data-testid="roles-search" /></label>
              <PillSwitch testid="roles-group" label={L("Show", "Papar")} value={group} onChange={setGroup}
                options={[["all", L("All roles", "Semua")], ["exec", L("Executive", "Eksekutif")], ["staff", L("Staff", "Kakitangan")], ["tech", L("Technical", "Teknikal")], ...(roleRows.some((x) => x.group === "ext") ? [["ext", L("External", "Luaran")] as const] : [])] as const} />
            </>}
            >
            <CompactTaskTable rows={shownRows} cols={cols} label={L("Roles", "Peranan")} loading={!d0} record="role" testid="roles-table" dense
              onOpen={pick} picked={sel?.id ?? null}
              empty={<p className={css.muted}>{L("No role matches that.", "Tiada peranan yang sepadan.")}</p>} />
          </SplitPane>
          <SplitPane testid="role-editor" title={L("Role Permissions", "Kebenaran Peranan")} label={L("Chosen role", "Peranan dipilih")}
            actions={<>
              {exceptions !== null && <button type="button" className={btnSm} onClick={() => setDrawer("exceptions")} data-testid="open-exceptions"><AppIcon name="person" />{L(`Per-user exceptions${exceptionCount !== null ? ` (${exceptionCount})` : ""}`, `Pengecualian pengguna${exceptionCount !== null ? ` (${exceptionCount})` : ""}`)}</button>}
              <button type="button" className={btnSm} onClick={() => setDrawer("tabs")} data-testid="open-tab-visibility"><AppIcon name="preview" />{L("Tab visibility", "Keterlihatan tab")}</button>
              {onReview && <button type="button" className={btnSm} onClick={onReview}><AppIcon name="verify" />{L("Access review", "Semakan akses")}</button>}
            </>}
            foot={canEdit && pending.length > 0 ? (
              <span className={css.footRow}>
                <span className={css.muted} data-testid="perm-pending">{L(`${pending.length} unsaved change(s)`, `${pending.length} perubahan belum disimpan`)}</span>
                <span className={css.inline}>
                  <button type="button" className={btnSm} onClick={() => { setDraft({}); setErr(""); }} data-testid="perm-reset">{L("Reset", "Set semula")}</button>
                  <button type="button" className={btnSmPrimary} onClick={() => { setErr(""); setDrawer("save"); }} data-testid="perm-save"><AppIcon name="save" />{L("Save Changes", "Simpan Perubahan")}</button>
                </span>
              </span>
            ) : undefined}>
            {!d0 ? <SkelRows rows={8} /> : editor}
          </SplitPane>
        </WorkspaceSplit>
      )}

      <SideDrawer open={drawer === "save"} onClose={() => setDrawer("")} title={L(`Review ${pending.length} change(s)`, `Semak ${pending.length} perubahan`)}
        subtitle={L("Who gains and who loses - saved on the server with your reason and authenticator code", "Siapa mendapat dan siapa kehilangan - disimpan di pelayan dengan sebab dan kod pengesah anda")}
        footer={<span className={css.inline}>
          <button type="button" className={btnSm} onClick={() => setDrawer("")}>{L("Back", "Kembali")}</button>
          <button type="button" className={btnSmPrimary} disabled={busy || reason.trim().length < 10 || pending.length === 0} data-testid="perm-confirm"
            onClick={() => void send({ changes: pending.map(([cap, r]) => ({ cap, roles: r })), reason: reason.trim() }, L(`${pending.length} permission(s) changed`, `${pending.length} kebenaran ditukar`))}>
            <AppIcon name="save" />{L("Save changes", "Simpan perubahan")}</button>
        </span>}>
        {review}
      </SideDrawer>
      {exceptions !== null && (
        <SideDrawer open={drawer === "exceptions"} onClose={() => setDrawer("")} wide title={L("Per-user exceptions", "Pengecualian setiap pengguna")}
          subtitle={L("One person's tabs differing from their role - each with its reason, who and when", "Tab seseorang berbeza daripada peranannya - setiap satu dengan sebab, siapa dan bila")}>
          {exceptions}
        </SideDrawer>
      )}
      <SideDrawer open={drawer === "tabs"} onClose={() => setDrawer("")} wide title={L("Tab visibility", "Keterlihatan tab")}
        subtitle={L("Which roles see each tab - never a permission", "Peranan mana melihat setiap tab - bukan kebenaran")}>
        {tabVisibility}
      </SideDrawer>
    </div>
  );
}

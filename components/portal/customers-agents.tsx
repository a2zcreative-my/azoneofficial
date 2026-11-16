"use client";

/* v1.327.0 - USERS & SECURITY → CUSTOMERS & AGENTS (the CEO's brief,
   16-11-2026: "Customer/agent directory, account status, portal access
   management and authorized Grant/Revoke Agent Access").

   The same accounts the Users tab already reads (GET /staff/users: role
   customer or agent), drawn as a directory beside the chosen account. Every
   action is the existing one, with its existing gate:
     Grant Agent Access    POST /staff/users/:id/role {role: "agent"} - the
                           owner or the Super Admin, a reason and the code;
                           the server refuses an email nobody has proven
     Revoke Agent Access   the same route back to "customer", the same rule
     Recover sign-in       the customer recovery sheet (identity check first)
     Manage account        the account sheet (devices, 2FA) for an agent
     Promote               the role editor the list always had
   The page decides nothing: the server's roleChangeRule decides each change. */

import { useMemo, useState, type ReactNode } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PillSwitch } from "@/components/ui/panel";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { type PageSize } from "@/components/ui/pagination-controls";
import { properName } from "@/lib/names";
import { btnSm, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess } from "@/lib/ui-styles";
import type { Account } from "@/components/portal/users-shared";
import css from "./customers-agents.module.css";

type Show = "all" | "customer" | "agent" | "suspended";

export function CustomersAgents({ accounts, loaded, busy, canGrant, canRecover, canPromote, editor, onGrant, onRevoke, onRecover, onManage, onPromote, onAudit }: {
  accounts: Account[];
  loaded: boolean;
  busy: boolean;
  /** Grant / Revoke Agent Access: the owner or the Super Admin (the server's role door decides) */
  canGrant: boolean;
  /** sign-in recovery (account_recovery / account_email) */
  canRecover: boolean;
  /** the role editor (Promote) */
  canPromote: boolean;
  /** the role editor for the chosen account, when it is open */
  editor?: (u: Account) => ReactNode;
  onGrant: (u: Account) => void;
  onRevoke: (u: Account) => void;
  onRecover: (id: number) => void;
  onManage: (id: number) => void;
  onPromote: (u: Account) => void;
  onAudit?: (u: Account) => void;
}) {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(10);
  const [picked, setPicked] = useState<number | null>(null);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => accounts.filter((u) => (!needle || [u.email, u.full_name ?? "", u.name].some((x) => x.toLowerCase().includes(needle)))
    && (show === "all" || (show === "suspended" ? !u.is_active : u.role === show && Boolean(u.is_active)))), [accounts, needle, show]);
  const fkey = `${needle}|${show}`;
  const [seen, setSeen] = useState(fkey);
  if (fkey !== seen) { setSeen(fkey); setPage(1); }
  const shown = rows.find((u) => u.id === picked) ?? rows[0] ?? null;
  const n = {
    customers: accounts.filter((u) => u.role === "customer").length,
    agents: accounts.filter((u) => u.role === "agent").length,
    active: accounts.filter((u) => u.is_active).length,
    suspended: accounts.filter((u) => !u.is_active).length,
  };
  const name = (u: Account) => properName(u.full_name || u.name);
  const typeChip = (u: Account) => u.role === "agent" ? <span className={chipSmInfo}>{L("Agent", "Ejen")}</span> : <span className={chipSmNeutral}>{L("Customer", "Pelanggan")}</span>;
  const statusChip = (u: Account) => u.is_active ? <span className={chipSmSuccess}>{L("Active", "Aktif")}</span> : <span className={chipSmDanger}>{L("Suspended", "Digantung")}</span>;
  const access = (u: Account) => !u.is_active ? L("No access - suspended", "Tiada akses - digantung")
    : u.role === "agent" ? L("Agent workspace (Agents, Profile)", "Ruang kerja ejen (Ejen, Profil)") : L("Customer pages (My account)", "Halaman pelanggan (Akaun saya)");

  const cols: TableCol<Account>[] = [
    { key: "who", label: L("Account", "Akaun"), main: true, cell: (u) => (
      <span className={css.who}><Avatar name={name(u)} photoKey={u.photo_key} size="sm" /><span className={css.whoText}><strong>{name(u)}</strong><small>{u.email}</small></span></span>
    ) },
    { key: "type", label: L("Type", "Jenis"), cell: typeChip },
    { key: "status", label: L("Status", "Status"), cell: statusChip },
  ];

  const detail = shown && (
    <div className={css.detail} data-testid="account-detail" data-record={`account:${shown.id}`}>
      <div className={css.detailHead}>
        <Avatar name={name(shown)} photoKey={shown.photo_key} size="md" />
        <span className={css.whoText}><strong className={css.big}>{name(shown)}</strong><small>{shown.email}</small></span>
        <span className={css.chips}>{typeChip(shown)}{statusChip(shown)}</span>
      </div>
      <dl className={css.facts}>
        <div><dt>{L("Account type", "Jenis akaun")}</dt><dd>{shown.role === "agent" ? L("Agent", "Ejen") : L("Customer", "Pelanggan")}</dd></div>
        <div><dt>{L("Status", "Status")}</dt><dd>{shown.is_active ? L("Active", "Aktif") : L("Suspended", "Digantung")}</dd></div>
        <div><dt>{L("Portal access", "Akses portal")}</dt><dd data-testid="portal-access">{access(shown)}</dd></div>
        <div><dt>{L("Staff access", "Akses kakitangan")}</dt><dd>{L("None - customers and agents are never staff", "Tiada - pelanggan dan ejen bukan kakitangan")}</dd></div>
      </dl>
      <div className={css.block}>
        <p className={css.label}>{L("Agent access", "Akses ejen")}</p>
        <p className={css.muted}>{shown.role === "agent"
          ? L("This account signs in to the Agents workspace. Revoking returns it to a customer account; its history stays with the same account.", "Akaun ini log masuk ke ruang kerja Ejen. Menarik balik mengembalikannya kepada akaun pelanggan; sejarahnya kekal pada akaun yang sama.")
          : L("The same account becomes an agent - no second user. Only an email the person has proven (Google or a verify link) can be given agent access.", "Akaun yang sama menjadi ejen - tiada pengguna kedua. Hanya e-mel yang telah dibuktikan (Google atau pautan pengesahan) boleh diberi akses ejen.")}</p>
        <div className={css.actions}>
          {canGrant && shown.role === "customer" && <button type="button" className={btnSm} disabled={busy} onClick={() => onGrant(shown)} data-testid={`grant-agent-${shown.id}`}><AppIcon name="users" />{L("Grant Agent Access", "Beri Akses Ejen")}</button>}
          {canGrant && shown.role === "agent" && <button type="button" className={btnSm} disabled={busy} onClick={() => onRevoke(shown)} data-testid={`revoke-agent-${shown.id}`}><AppIcon name="blocked" />{L("Revoke Agent Access", "Tarik Akses Ejen")}</button>}
          {!canGrant && <span className={chipSmNeutral}>{L("The company owner or the Super Admin gives and revokes it", "Pemilik syarikat atau Super Admin memberi dan menariknya")}</span>}
        </div>
      </div>
      <div className={css.block}>
        <p className={css.label}>{L("Sign-in and account", "Log masuk dan akaun")}</p>
        <div className={css.actions}>
          {canRecover && shown.role === "customer" && <button type="button" className={btnSm} onClick={() => onRecover(shown.id)} data-testid={`recover-${shown.id}`}><AppIcon name="access" />{L("Recover sign-in", "Pulihkan log masuk")}</button>}
          {canRecover && shown.role === "agent" && <button type="button" className={btnSm} onClick={() => onManage(shown.id)} data-testid={`manage-${shown.id}`}><AppIcon name="access" />{L("Manage account", "Urus akaun")}</button>}
          {canPromote && <button type="button" className={btnSm} onClick={() => onPromote(shown)} data-testid={`promote-${shown.id}`}><AppIcon name="edit" />{L("Promote to a staff role", "Naik taraf ke peranan kakitangan")}</button>}
          {onAudit && <button type="button" className={btnSm} onClick={() => onAudit(shown)}><AppIcon name="document" />{L("Audit trail", "Jejak audit")}</button>}
          {!canRecover && !canPromote && !onAudit && <span className={css.muted}>{L("No account actions for your role.", "Tiada tindakan akaun untuk peranan anda.")}</span>}
        </div>
        {editor?.(shown)}
      </div>
    </div>
  );

  return (
    <div className={css.page} data-testid="customers-agents">
      <KpiRow label={L("Customer and agent figures", "Angka pelanggan dan ejen")} testid="customers-strip">
        <KpiTile icon="cart" tone="blue" label={L("Customers", "Pelanggan")} value={n.customers} busy={!loaded} sub={L("Google and self sign-ups", "Pendaftaran Google dan sendiri")} onClick={() => setShow("customer")} pressed={show === "customer"} />
        <KpiTile icon="users" tone="purple" label={L("Agents", "Ejen")} value={n.agents} busy={!loaded} sub={L("Agent workspace access", "Akses ruang kerja ejen")} onClick={() => setShow("agent")} pressed={show === "agent"} />
        <KpiTile icon="success" tone="green" label={L("Active", "Aktif")} value={n.active} busy={!loaded} sub={L("Can sign in", "Boleh log masuk")} />
        <KpiTile icon="blocked" tone="red" label={L("Suspended", "Digantung")} value={n.suspended} busy={!loaded} sub={L("No access until restored", "Tiada akses sehingga dipulihkan")} onClick={() => setShow("suspended")} pressed={show === "suspended"} />
      </KpiRow>
      <WorkspaceSplit testid="customers-split" ratio="55-45">
        <SplitPane testid="customer-directory" title={L(`Customer & Agent Directory (${accounts.length})`, `Direktori Pelanggan & Ejen (${accounts.length})`)} label={L("Customer and agent directory", "Direktori pelanggan dan ejen")}
          sub={L("Every customer and agent account, its status and its access.", "Setiap akaun pelanggan dan ejen, statusnya dan aksesnya.")}
          toolbar={<>
            <label className={css.search}><AppIcon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search name or email", "Cari nama atau e-mel")} aria-label={L("Find an account", "Cari akaun")} data-testid="customers-search" /></label>
            <PillSwitch testid="customers-show" label={L("Show", "Papar")} value={show} onChange={setShow}
              options={[["all", L("All", "Semua")], ["customer", L("Customers", "Pelanggan")], ["agent", L("Agents", "Ejen")], ["suspended", L("Suspended", "Digantung")]] as const} />
          </>}>
          <CompactTaskTable rows={rows} cols={cols} label={L("Customer and agent accounts", "Akaun pelanggan dan ejen")} loading={!loaded} record="account" testid="customers-table"
            onOpen={setPicked} picked={shown?.id ?? null} dense page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }}
            empty={<p className={css.muted}>{accounts.length === 0 ? L("No customer accounts yet.", "Tiada akaun pelanggan lagi.") : L("No account matches that.", "Tiada akaun yang sepadan.")}</p>} />
        </SplitPane>
        <SplitPane testid="customer-selected" title={L("Account & Access", "Akaun & Akses")} sub={L("The chosen account, what it can open, and the authorised actions.", "Akaun dipilih, apa yang boleh dibuka, dan tindakan yang dibenarkan.")} label={L("Chosen account", "Akaun dipilih")}>
          {!loaded ? null : detail ?? <p className={css.muted}>{L("Choose an account in the directory.", "Pilih akaun dalam direktori.")}</p>}
        </SplitPane>
      </WorkspaceSplit>
    </div>
  );
}

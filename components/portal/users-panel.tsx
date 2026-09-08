"use client";

/* USER ACCOUNTS — v1.137.0.
 *
 * The CEO, 08-09-2026: *"review Users UI/UX for webview and mobile apps view
 * which is globally css/style use."*
 *
 * This panel was moved verbatim out of the 605 KB portal page in v1.114.0 and
 * never adopted the shared vocabulary that arrived with it. It imported ONE
 * token (`card`) and hand-rolled the rest: eight chips at a size no other
 * panel uses, a Save button that was `btnClass` minus its hover and disabled
 * states, `fieldLabel` retyped twice, and two selects in a spelling found
 * nowhere else — because until v1.137.0 there was no `selectClass` to use.
 *
 * The phone view had never been designed at all, only inherited:
 *   - the only edit control was a bare ✎ inside an 11px underlined button,
 *     about 12x14 px of target, unlabelled, beside three chips;
 *   - name and email shared one truncated line, so the email — the thing that
 *     tells two accounts apart — was the half that got cut;
 *   - three scroll regions nested inside the page scroll;
 *   - the role editor opened INSIDE a flex-wrap row and reflowed it.
 *
 * What this file is now: every surface, chip, field and button from
 * lib/ui-styles.ts; one filtered list drawn twice (tabs on a phone,
 * side-by-side from lg:); a 44px labelled row action; and the editor as the
 * house bottom sheet on a phone, inline from md: up.
 *
 * Held by tests/users-ui.mjs.
 */
import { L, SectionTabs } from "@/components/portal/page-shared";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import { firstName, properName } from "@/lib/names";
import {
  btnClass, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn,
  fieldLabel, iconBtn, inputClassSm, listBox, selectClass, sheetCard,
} from "@/lib/ui-styles";
import { useCallback, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";

/** v1.4.153: audit timestamps arrive as UTC "YYYY-MM-DD HH:MM:SS" — show MYT. */
export function mytStamp2(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  const m = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(m.getUTCDate())}-${p(m.getUTCMonth() + 1)}-${m.getUTCFullYear()} ${p(m.getUTCHours())}:${p(m.getUTCMinutes())} MYT`;
}

interface Account {
  id: number;
  name: string;
  full_name?: string | null;
  email: string;
  role: string;
  employment_status?: string | null;
  is_active: number;
  left_on?: string | null;
  rejoined_on?: string | null;
  totp_enabled?: number;
}

/* v1.137.0 - `capitalize` title-cased every word, so the CEO's own chip read
   "Ceo" and the HR account read "Hr Admin". A role is a name, not a sentence:
   the acronyms are spelled, and everything else gets one capital. */
const ROLE_LABEL: Record<string, string> = {
  ceo: "CEO", coo: "COO", cco: "CCO", hr_admin: "HR Admin",
  sales_marketing: "Sales & Marketing", live_host: "Live Host",
  editor: "Editor", marketing: "Marketing", customer: "Customer",
};
const roleLabel = (r: string) => ROLE_LABEL[r] ?? r.replace(/_/g, " ");
const statusLabel = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

interface AuthEvent { action: string; created_at: string; name?: string | null; email?: string | null }

export function UsersPanel({ role }: { role: string }) {
  const [rows, setRows] = useState<Account[]>([]);
  const [msg, setMsg] = useState("");
  // v1.4.153: user log (recent sign-ins + account events) for monitoring
  const [events, setEvents] = useState<AuthEvent[]>([]);
  // v1.4.157 (CEO): role changes are SUPER_ADMIN ONLY — Google sign-ups
  // always land as customer, and keeping promotion out of every business
  // account (including the CEO's) means a breached sign-in can't escalate.
  const canEdit = role === "super_admin";
  const ROLE_OPTIONS = ["customer", "live_host", "editor", "marketing", "sales_marketing", "hr_admin", "cco", "coo", "ceo"];
  const EMP_OPTIONS = ["permanent", "contract", "part_time", "probation"];
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ role: string; employment_status: string }>({ role: "live_host", employment_status: "part_time" });
  const [saving, setSaving] = useState(false);
  /* v1.137.0 - one find box over both lists. The customer list is Google
     sign-ups and only grows; finding a person was scrolling. */
  const [q, setQ] = useState("");
  /* v1.137.0 - a phone shows ONE list at a time. Two lists of their own
     height, stacked inside the page scroll, was two scroll traps to get past
     before the log; from lg: up they still sit side by side. */
  const [tab, setTab] = useState<"staff" | "customers">("staff");
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.77.0 — skeleton until the first fetch lands (accounts and activity
     are two requests; each region clears its own skeleton). */
  const [loaded, setLoaded] = useState(false);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const load = useCallback(() => {
    void api<{ users?: Account[]; staff?: Account[] }>(`/staff/users`).then((r) => {
      if (r.ok && r.data) setRows((r.data.users ?? r.data.staff ?? []).filter((u) => !["super_admin", "admin"].includes(u.role)));
      else setMsg(L("Could not load user accounts — check access.", "Tidak dapat memuatkan akaun pengguna — semak akses."));
      setLoaded(true);
    });
    void api<{ events: AuthEvent[] }>(`/staff/users/activity`).then((r) => {
      if (r.ok && r.data) setEvents(r.data.events);
      setEventsLoaded(true);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(["users"], load);

  const saveRole = async (u: { id: number; name: string; email: string }) => {
    if (saving) return; // v1.137.0 - the button had no busy state and could be pressed twice
    setSaving(true);
    const res = await api<{ role?: string; employment_status?: string; error?: { message?: string } }>(
      `/staff/users/${u.id}/role`,
      { method: "POST", body: JSON.stringify({ role: draft.role, employment_status: draft.employment_status }) },
    );
    setSaving(false);
    if (res.ok) {
      showToast(L("Saved", "Disimpan"),
        `${firstName(u.name)} → ${roleLabel(draft.role)} (${statusLabel(res.data?.employment_status ?? draft.employment_status)})`);
      setEditId(null);
      load();
    } else {
      showToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Role change failed", "Penukaran peranan gagal"), "notice");
    }
  };

  /* The two fields and their Save, without a wrapper: the same markup is the
     inline panel on a desk and the body of the bottom sheet on a phone, so
     the two can never offer different choices. */
  const roleFields = (u: Account) => (
    <>
      <label className="block">
        <span className={fieldLabel}>{L("Role", "Peranan")}</span>
        <select className={selectClass} value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
      </label>
      <label className="block">
        <span className={fieldLabel}>{L("Employment status", "Status pekerjaan")}</span>
        <select className={selectClass} value={draft.employment_status}
          onChange={(e) => setDraft((d) => ({ ...d, employment_status: e.target.value }))}>
            {/* A status the CEO cannot set from here (resigned, terminated)
              still has to be SHOWN, or saving would silently change it. */}
          {(EMP_OPTIONS.includes(draft.employment_status) ? EMP_OPTIONS : [draft.employment_status, ...EMP_OPTIONS])
            .map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </label>
      <button type="button" className={`${btnClass} col-span-1 justify-center`} disabled={saving} onClick={() => void saveRole(u)}>
        {saving ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}
      </button>
      <button type="button" className="inline-flex h-9 items-center text-xs underline" onClick={() => setEditId(null)}>{L("Cancel", "Batal")}</button>
      {!u.email.toLowerCase().endsWith("@azoneofficial.com") && draft.role !== "customer" && (
        <p className="text-muted-foreground col-span-2 w-full text-[11px]">
          {L("Personal-email (Google) account — staff roles are saved as", "Akaun e-mel peribadi (Google) — peranan kakitangan disimpan sebagai")}{" "}
          <span className="font-medium">{L("part time", "separuh masa")}</span>
          {L("; permanent staff need an @azoneofficial.com account.", "; kakitangan tetap memerlukan akaun @azoneofficial.com.")}
        </p>
      )}
    </>
  );

  const needle = q.trim().toLowerCase();
  /* v1.139.0 - BOTH names, and the role as it is written on screen. Testing
     `full_name || name` missed the other one, and matching the raw key meant
     typing what the chip says ("Sales & Marketing") found nobody. */
  const match = (u: Account) =>
    !needle || u.email.toLowerCase().includes(needle)
    || (u.full_name ?? "").toLowerCase().includes(needle)
    || (u.name ?? "").toLowerCase().includes(needle)
    || roleLabel(u.role).toLowerCase().includes(needle)
    || u.role.replace(/_/g, " ").includes(needle);
  const allStaff = rows.filter((u) => u.role !== "customer");
  const allCustomers = rows.filter((u) => u.role === "customer");
  const staffRows = allStaff.filter(match);
  const customerRows = allCustomers.filter(match);
  /* "3 of 12" while a search is on, plain "12" otherwise: a heading that only
     ever says 3 cannot be told from a list that lost nine rows. */
  const countOf = (shown: number, all: number) => (needle && shown !== all ? `${shown}/${all}` : `${all}`);

  /* One row, drawn the same in both lists. Name on its own line and the email
     under it: on a 390px screen they cannot share one without the email —
     which is what tells two accounts apart — being the half that is cut. */
  const accountRow = (u: Account, kind: "staff" | "customer") => (
    <li key={u.id} className="px-3 py-2">
      {/* v1.137.0 (second pass, after looking at it at 390px) - the chips
          were `shrink-0` beside a `flex-1` identity, so four of them squeezed
          the name to "Siti N..." and the email to "siti.nu...". On a phone
          the chips take a line of their OWN under the identity (basis-full);
          from sm: up, where there is room, they sit back on the row. The
          action stays at the top right in both. */}
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{properName(u.full_name || u.name)}</p>
          <p className="text-muted-foreground truncate text-xs">{u.email}</p>
          {/* v1.137.0 - these dates were a title= tooltip, which a phone
              cannot show at all. The house rule is that the reason is on
              screen. */}
          {(u.left_on || u.rejoined_on) && (
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {u.left_on ? L(`Left ${dmy(u.left_on)}`, `Berhenti ${dmy(u.left_on)}`) : ""}
              {u.left_on && u.rejoined_on ? " · " : ""}
              {u.rejoined_on ? L(`rejoined ${dmy(u.rejoined_on)}`, `kembali ${dmy(u.rejoined_on)}`) : ""}
            </p>
          )}
        </div>
        <div className="order-3 flex w-full flex-wrap items-center gap-1 sm:order-1 sm:w-auto sm:flex-none sm:justify-end">
          {kind === "staff" && <span className={chipSmNeutral}>{roleLabel(u.role)}</span>}
          {kind === "staff" && (u.employment_status ?? "permanent") !== "permanent" && (
            <span className={["resigned", "terminated"].includes(u.employment_status ?? "") ? chipSmDanger : chipSmNeutral}>
              {statusLabel(u.employment_status ?? "")}
            </span>
          )}
          {!u.is_active && <span className={chipSmDanger}>{L("Disabled", "Dinyahaktif")}</span>}
          {kind === "staff" && !u.totp_enabled && <span className={chipSmWarn}>{L("No 2FA", "Tiada 2FA")}</span>}
        </div>
        {canEdit && (
          <div className="order-2 shrink-0">
            <button type="button" className={iconBtn}
              aria-label={kind === "staff"
                ? L(`Change role for ${properName(u.full_name || u.name)}`, `Tukar peranan untuk ${properName(u.full_name || u.name)}`)
                : L(`Promote ${properName(u.full_name || u.name)}`, `Naik taraf ${properName(u.full_name || u.name)}`)}
              title={kind === "staff" ? L("Change role", "Tukar peranan") : L("Promote", "Naik taraf")}
              onClick={() => {
                setEditId(u.id);
                /* v1.139.0 - a LEAVER keeps their status. Falling back to
                   "permanent" for resigned/terminated meant that changing a
                   leaver's role quietly brought them back into every staff
                   picker and onto payroll, because the route COALESCEs
                   whatever the form sends. */
                setDraft(kind === "staff"
                  ? { role: u.role, employment_status: u.employment_status ?? "permanent" }
                  : { role: "live_host", employment_status: "part_time" });
              }}>
              <AppIcon name="edit" />
            </button>
          </div>
        )}
      </div>
      {/* The desk panel. `hidden` is the ONLY base display class here — the
          v1.15.0 lesson: two unprefixed display utilities on one element let
          the stylesheet order decide, and it decided wrong. */}
      {editId === u.id && (
        <div className="bg-secondary/40 mt-2 hidden w-full grid-cols-2 items-end gap-2 rounded-lg p-2 md:grid lg:flex lg:flex-wrap">
          {roleFields(u)}
        </div>
      )}
    </li>
  );

  const editing = rows.find((u) => u.id === editId) ?? null;
  /* v1.139.0 - the phone sheet behaves like the house sheet: the page behind
     it does not scroll, Escape closes it, and focus moves into it. Without
     the lock a drag on the dimmed area scrolled the list underneath, and a
     keyboard user had no way out at all. */
  useEffect(() => {
    if (!editing || !canEdit) return;
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 767px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditId(null); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [editing, canEdit]);

  return (
    <div className={card}>
      {toastNode}
      <p className="text-sm font-semibold">{L("User accounts", "Akaun pengguna")}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {canEdit
          ? L("Change role sets the account's role and employment status — part-time staff are not OT-eligible. Passwords and deactivation stay in /admin.",
              "Tukar peranan menetapkan peranan dan status pekerjaan akaun — kakitangan separuh masa tidak layak OT. Kata laluan dan penyahaktifan kekal di /admin.")
          : L("Read-only here — role changes are made by the system super admin only, so no signed-in business account (or breached Google sign-in) can ever escalate a role.",
              "Baca sahaja di sini — penukaran peranan dibuat oleh super admin sistem sahaja, jadi tiada akaun perniagaan yang log masuk (atau log masuk Google yang dicerobohi) boleh menaikkan peranan.")}
      </p>
      {msg && <p className="text-destructive mt-2 text-xs font-medium">{msg}</p>}

      {/* v1.137.0 - the find box, over BOTH lists at once, and the phone's
          list switch beside it. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-64">
          <AppIcon name="search" className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" />
          <input className={`${inputClassSm} w-full pl-7`} value={q} placeholder={L("Find by name, email or role", "Cari ikut nama, e-mel atau peranan")}
            aria-label={L("Find an account", "Cari akaun")} onChange={(e) => setQ(e.target.value)} />
        </label>
        <SectionTabs className="lg:hidden" value={tab} onChange={setTab}
          tabs={[["staff", `${L("Staff", "Kakitangan")} ${countOf(staffRows.length, allStaff.length)}`],
                 ["customers", `${L("Customers", "Pelanggan")} ${countOf(customerRows.length, allCustomers.length)}`]] as const} />
      </div>

      {/* v1.4.161: staff + customer lists sit side-by-side on desktop to cut
          the scroll in half; on a phone the tabs above choose one. */}
      <div className="mt-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
        <div className={`${tab === "staff" ? "" : "hidden"} lg:block`}>
          {/* v1.4.167: both columns carry the same heading + one-line description
              structure so the two list boxes top-align. */}
          <p className="text-sm font-semibold">
            {L("Staff accounts", "Akaun kakitangan")}{" "}
            <span className="text-muted-foreground font-normal">{countOf(staffRows.length, allStaff.length)}</span>
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Role always shows — chips flag exceptions only (part-time, disabled, missing 2FA).",
               "Peranan sentiasa dipaparkan — cip menanda pengecualian sahaja (separuh masa, dinyahaktif, tiada 2FA).")}
          </p>
          <ul className={`${listBox} mt-2 max-h-[60vh] max-h-[60svh] md:max-h-80`}>
            {/* v1.77.0 — skeleton until the first fetch lands. */}
            {!loaded && <SkelRows rows={6} className="px-3" />}
            {loaded && staffRows.length === 0 && (
              <li className="text-muted-foreground px-3 py-2 text-sm">
                {allStaff.length === 0
                  ? L("No staff accounts yet.", "Tiada akaun kakitangan lagi.")
                  : L("No staff account matches that.", "Tiada akaun kakitangan yang sepadan.")}
              </li>
            )}
            {loaded && staffRows.map((u) => accountRow(u, "staff"))}
          </ul>
          {allStaff.some((u) => !u.totp_enabled && u.is_active) && (
            <p className="text-warning mt-2 text-xs font-medium">
              <AppIcon name="warning" className="mr-1 h-3.5 w-3.5" />
              {(() => {
                const no2fa = allStaff.filter((u) => !u.totp_enabled && u.is_active);
                return `${no2fa.length} ${no2fa.length === 1
                  ? L("active account without 2FA — worth chasing:", "akaun aktif tanpa 2FA — perlu dikejar:")
                  : L("active accounts without 2FA — worth chasing:", "akaun aktif tanpa 2FA — perlu dikejar:")} ${no2fa.map((u) => firstName(u.name)).join(", ")}`;
              })()}
            </p>
          )}
        </div>

        {/* v1.4.156: Google sign-ups land here as customers — the CEO promotes
            them into part-time roles (e.g. part-time live host) from this list. */}
        <div className={`${tab === "customers" ? "" : "hidden"} mt-4 lg:mt-0 lg:block`}>
          <p className="text-sm font-semibold">
            {L("Customer accounts — Google & self sign-ups", "Akaun pelanggan — Google & daftar sendiri")}{" "}
            <span className="text-muted-foreground font-normal">{countOf(customerRows.length, allCustomers.length)}</span>
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {canEdit
              ? L("Promote here when someone joins — personal emails hold part-time roles only.",
                  "Naik taraf di sini apabila seseorang menyertai — e-mel peribadi memegang peranan separuh masa sahaja.")
              : L("Sign-ups land here with zero staff access — promotions by the super admin only.",
                  "Pendaftaran mendarat di sini tanpa akses kakitangan — naik taraf oleh super admin sahaja.")}
          </p>
          <ul className={`${listBox} mt-2 max-h-[60vh] max-h-[60svh] md:max-h-80`}>
            {/* v1.77.0 — skeleton until the first fetch lands. */}
            {!loaded && <SkelRows rows={4} className="px-3" />}
            {loaded && customerRows.length === 0 && (
              <li className="text-muted-foreground px-3 py-2 text-sm">
                {allCustomers.length === 0
                  ? L("No customer accounts yet.", "Tiada akaun pelanggan lagi.")
                  : L("No customer account matches that.", "Tiada akaun pelanggan yang sepadan.")}
              </li>
            )}
            {loaded && customerRows.map((u) => accountRow(u, "customer"))}
          </ul>
        </div>
      </div>

      <div className="border-border mt-4 border-t pt-3">
        <p className="text-sm font-semibold">{L("User log — recent sign-ins & account events", "Log pengguna — log masuk & peristiwa akaun terkini")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Last 60 authentication events from the audit trail — sign-ins (password, 2FA, Google) and 2FA changes. The full audit lives in /admin.",
             "60 peristiwa pengesahan terakhir daripada jejak audit — log masuk (kata laluan, 2FA, Google) dan perubahan 2FA. Audit penuh berada di /admin.")}
        </p>
        <div className="mt-2 max-h-56 overflow-y-auto overscroll-contain pr-1">
          {/* v1.137.0 — the skeleton is the shape of what arrives: these are
              divided rows, not a table, and SkelTable drew three columns that
              never appeared. */}
          {!eventsLoaded && <SkelRows rows={5} />}
          {eventsLoaded && events.length === 0 && (
            <p className="text-muted-foreground text-sm">{L("No events recorded yet.", "Tiada peristiwa direkodkan lagi.")}</p>
          )}
          {eventsLoaded && events.map((e, i) => (
            /* v1.137.0 - on a phone the identity took what was left of the
               line after a chip and a timestamp, which was "Nurul Ai...". It
               gets the line to itself below sm:, and shares one from sm: up. */
            <div key={i} className="border-border flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b py-1.5 text-xs last:border-0">
              <span className="w-full min-w-0 truncate sm:w-auto sm:flex-1">
                <span className="font-medium">{properName(e.name ?? "")}</span>
                <span className="text-muted-foreground"> · {e.email ?? ""}</span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span className={e.action.includes("2fa_enabled") ? chipSmSuccess
                  : e.action.includes("2fa") ? chipSmInfo
                  : e.action.includes("password") ? chipSmWarn : chipSmNeutral}>
                  {e.action.replace("auth.", "").replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground">{mytStamp2(e.created_at)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* v1.137.0 — THE PHONE'S EDITOR. Two selects and a Save inside a
          flex-wrap list row reflowed the row they belonged to; as the house
          bottom sheet (app/portal/page.tsx) they sit over the page, full
          width, with the row still visible behind them. md: and up use the
          inline panel above, so only one of the two is ever displayed. */}
      {editing && canEdit && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true"
          aria-label={L("Change role", "Tukar peranan")}>
          <button type="button" aria-label={L("Close", "Tutup")} className="absolute inset-0 cursor-pointer bg-black/40"
            onClick={() => setEditId(null)} />
          <div className={sheetCard}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{properName(editing.full_name || editing.name)}</p>
                <p className="text-muted-foreground truncate text-xs">{editing.email}</p>
              </div>
              <button type="button" aria-label={L("Close", "Tutup")}
                className="border-border text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-base"
                onClick={() => setEditId(null)}>✕</button>
            </div>
            <div className="grid grid-cols-2 items-end gap-2">{roleFields(editing)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

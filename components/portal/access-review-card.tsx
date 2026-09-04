"use client";

/**
 * Who sees what — v1.90.0.
 *
 * CEO, 04-09-2026, a screenshot of a staff phone with Dashboard, Attendance,
 * Ecommerce and Inventory on its bottom bar: *"for some of the access I want
 * to also review what they can see and what they cant see which is for me to
 * authorize them to access it in users tabs."*
 *
 * The 🔐 card above answers "who sees Payroll". This card answers the other
 * question — "what does this person see" — and lets the answer be changed
 * for that ONE person, without touching everybody who shares the role.
 *
 * Pick a person. Two rows of chips: what they see, what they do not. Press
 * a chip to move it to the other row. A chip that sits where it does because
 * of a personal grant or refusal is marked; pressing it again returns the tab
 * to the role's rule. Dashboard and Profile are shown but cannot be moved
 * (always visible — same rail as the role card). The first four tabs a
 * person sees are their phone bottom bar, and the card says which four,
 * because that is what the screenshot was of.
 *
 * Every press reports (guard #25). Every press is audited on the worker.
 *
 * WHAT THIS DOES NOT DO: it does not change what the server lets a role read.
 * A tab granted beyond the role is drawn, and the data inside it still
 * answers "access required" where the worker's permission matrix says so.
 * The card says this in one line rather than pretending otherwise.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { card, inputClassSm } from "@/lib/ui-styles";
import { Skel } from "@/components/ui/skeleton";
import { rowBtn } from "@/components/ui/row-button";
import { properName } from "@/lib/names";
import { bySeniority, isCurrentStaff, isStaffRole } from "@/lib/staff-order";
import { getLang, t } from "@/lib/i18n";
import { accessOf, type PersonAccess, type TabReason } from "@/lib/portal-tabs";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const roleLabel = (r: string) => r.replace("_", " ");

interface Person { id: number; name: string; full_name?: string | null; role: string; position?: string | null; is_active: number; left_on?: string | null; rejoined_on?: string | null }

/** One tab chip. Module scope (guard #30). */
function TabChip({ tab, reason, onPress }: { tab: string; reason: TabReason; onPress?: () => void }) {
  const lang = getLang();
  const label = t(tab, lang);
  const mark = reason === "granted" ? " +" : reason === "refused" ? " −" : "";
  const tone =
    reason === "always" ? "bg-secondary text-muted-foreground"
    : reason === "granted" ? "bg-success-soft text-success"
    : reason === "refused" ? "bg-danger-soft text-danger"
    : reason === "role" ? "border-border border bg-card"
    : "border-border text-muted-foreground border border-dashed";
  const hint =
    reason === "always" ? L("Always visible — cannot be refused", "Sentiasa kelihatan — tidak boleh ditolak")
    : reason === "granted" ? L("Granted to this person beyond the role — press to return to the role rule", "Diberi kepada orang ini melebihi peranan — tekan untuk kembali kepada peraturan peranan")
    : reason === "refused" ? L("Refused for this person — press to return to the role rule", "Ditolak untuk orang ini — tekan untuk kembali kepada peraturan peranan")
    : reason === "role" ? L("Seen because of the role — press to refuse it for this person only", "Kelihatan kerana peranan — tekan untuk menolaknya bagi orang ini sahaja")
    : L("Hidden by the role — press to grant it to this person only", "Tersembunyi oleh peranan — tekan untuk memberikannya kepada orang ini sahaja");
  if (!onPress) return <span className={`rounded-full px-2.5 py-1 text-xs ${tone}`} title={hint}>{label}</span>;
  return (
    <button type="button" className={`rounded-full px-2.5 py-1 text-xs transition hover:opacity-80 ${tone}`} title={hint} onClick={onPress}>
      {label}{mark}
    </button>
  );
}

export function AccessReviewCard() {
  const { show: toast, node: toastNode } = useSaveToast();
  const [people, setPeople] = useState<Person[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [personal, setPersonal] = useState<Record<string, PersonAccess>>({});
  const [loaded, setLoaded] = useState(false);
  const [who, setWho] = useState<number | 0>(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [u, a, p] = await Promise.all([
      api<{ users: Person[] }>(`/staff/users`),
      api<{ overrides: Record<string, string[]> }>(`/staff/tabs/access`),
      api<{ people: Record<string, PersonAccess> }>(`/staff/tabs/access/people`),
    ]);
    if (u.ok && u.data?.users) {
      setPeople(u.data.users.filter((x) => x.is_active && isStaffRole(x.role) && isCurrentStaff(x)).sort(bySeniority));
    }
    if (a.ok && a.data?.overrides) setOverrides(a.data.overrides);
    if (p.ok && p.data?.people) setPersonal(p.data.people);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const person = people.find((p) => p.id === who) ?? null;
  const mine = person ? personal[String(person.id)] ?? null : null;
  const rows = person ? accessOf(person.role, overrides, mine) : [];
  const sees = rows.filter((r) => r.sees);
  const hidden = rows.filter((r) => !r.sees);
  const hasPersonal = Boolean(mine && (mine.allow.length || mine.deny.length));
  const name = person ? properName(person.full_name || person.name) : "";

  const change = async (tab: string, mode: "allow" | "deny" | "clear" | "reset") => {
    if (!person) return;
    setBusy(true);
    const r = await api<{ ok: boolean; person: PersonAccess | null; error?: { message?: string } }>(`/staff/tabs/access/person`, {
      method: "POST",
      body: JSON.stringify({ user_id: person.id, tab, mode }),
    });
    setBusy(false);
    if (r.ok) {
      setPersonal((m) => {
        const next = { ...m };
        if (r.data?.person) next[String(person.id)] = r.data.person; else delete next[String(person.id)];
        return next;
      });
      const lbl = t(tab, getLang());
      toast(
        mode === "allow" ? L(`${lbl} granted`, `${lbl} diberi`)
        : mode === "deny" ? L(`${lbl} refused`, `${lbl} ditolak`)
        : mode === "clear" ? L(`${lbl} back to the role rule`, `${lbl} kembali kepada peraturan peranan`)
        : L("Back to the role rule", "Kembali kepada peraturan peranan"),
        L(`${name} only — nobody else changes`, `${name} sahaja — orang lain tidak berubah`),
      );
    } else {
      toast(L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("The worker refused the change", "Pelayan menolak perubahan"), "notice");
    }
  };

  /* Pressing a chip moves it to the other row, or — if it is already a
     personal grant/refusal — clears it back to the role rule. */
  const press = (tab: string, reason: TabReason) => {
    if (reason === "granted" || reason === "refused") return change(tab, "clear");
    if (reason === "role") return change(tab, "deny");
    return change(tab, "allow");
  };

  return (
    <div className={card}>
      {toastNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{L("Who sees what", "Siapa nampak apa")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Pick a person to see their tabs. Press a tab to move it — for that person only; the role stays as the card above sets it.", "Pilih seseorang untuk melihat tab mereka. Tekan tab untuk mengalihkannya — bagi orang itu sahaja; peranan kekal seperti yang ditetapkan kad di atas.")}
          </p>
        </div>
        {!loaded ? <Skel className="h-8 w-48" /> : (
          <select className={inputClassSm} value={who} onChange={(e) => setWho(Number(e.target.value))} aria-label={L("Staff", "Kakitangan")}>
            <option value={0}>{L("Choose a person", "Pilih seseorang")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {properName(p.full_name || p.name)} · {roleLabel(p.role)}{personal[String(p.id)] ? " •" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {person && (
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-medium">{name}</span> · {roleLabel(person.role)}
            {person.position ? ` · ${person.position}` : ""}
            {" · "}{L("phone bar", "bar telefon")}: {sees.slice(0, 4).map((r) => t(r.tab, getLang())).join(", ")}
          </p>
          <div>
            <p className="mb-1.5 text-xs font-medium">{L("Can see", "Boleh lihat")} <span className="text-muted-foreground">({sees.length})</span></p>
            <div className="flex flex-wrap gap-1.5">
              {sees.map((r) => (
                <TabChip key={r.tab} tab={r.tab} reason={r.reason}
                  onPress={r.reason === "always" || busy ? undefined : () => void press(r.tab, r.reason)} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium">{L("Cannot see", "Tidak boleh lihat")} <span className="text-muted-foreground">({hidden.length})</span></p>
            <div className="flex flex-wrap gap-1.5">
              {hidden.length === 0 && <span className="text-muted-foreground text-xs">{L("Every tab.", "Semua tab.")}</span>}
              {hidden.map((r) => (
                <TabChip key={r.tab} tab={r.tab} reason={r.reason} onPress={busy ? undefined : () => void press(r.tab, r.reason)} />
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-[11px]">
              {L("+ granted beyond the role · − refused for this person. A granted tab is drawn; the data inside still needs the role's server permission.", "+ diberi melebihi peranan · − ditolak untuk orang ini. Tab yang diberi dipaparkan; data di dalamnya masih memerlukan kebenaran pelayan peranan itu.")}
            </p>
            {hasPersonal && (
              <button type="button" className={rowBtn} disabled={busy} onClick={() => void change("", "reset")}>
                {L("Back to role defaults", "Kembali kepada lalai peranan")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

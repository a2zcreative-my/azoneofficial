"use client";

/* v1.322.0 - THE POSITIONS LIST (the CEO, 16-11-2026; his choice "Position list
   (Recommended)", claude/POSITIONS-STAGE-0-AUDIT.md P-1 to P-7).

   PositionsCard - the CEO and the Super Admin keep the list: add, rename,
   re-link to an access level, retire and restore, with each position's history.
   Everyone else never sees it; the server refuses them anyway (positions.ts).

   PositionPicker - the staff record's Position: the list as suggestions, and
   "Other - type it" still allowed (P-2: the record keeps its position as text).
   PositionHint - says when the typed position is not on the list, and when the
   position's access level differs from the person's role. It changes nothing:
   the role changes only through the record's own Role & Access door (P-4). */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { roleLabel } from "@/components/portal/users-shared";
import { btnSm, btnSmPrimary, card, chipSmNeutral, chipSmWarn, inputClass, selectClass } from "@/lib/ui-styles";
import ps from "./positions.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface Position {
  id: number; name: string; access_role: string; department: string | null; sort_order: number;
  created_at: string; updated_at: string | null; retired_at: string | null; holders: number;
}
type ListData = { positions: Position[]; not_on_list: { name: string; n: number }[]; can_manage: boolean; access_roles: string[] };
type Change = { id: number; action: string; old_name: string | null; new_name: string | null; old_access_role: string | null; new_access_role: string | null; note: string | null; actor: string | null; created_at: string };

/** the positions list, read once by the Staff tab (everyone on staff may read it) */
export function usePositions(all = false) {
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void api<ListData & { error?: { message?: string } }>(`/staff/positions${all ? "?all=1" : ""}`).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) { setData(r.data); setError(""); }
      else setError(r.data?.error?.message ?? L("The positions list could not be read.", "Senarai jawatan tidak dapat dibaca."));
    });
    return () => { alive = false; };
  }, [all, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, reload };
}

const onList = (list: Position[] | undefined, v: string) => (list ?? []).find((p) => !p.retired_at && p.name.toLowerCase() === v.trim().toLowerCase()) ?? null;

/** the record's Position field: the list as suggestions, any other title still allowed */
export const POSITIONS_DATALIST = "staff-positions-list";
export function PositionsDatalist({ list }: { list: Position[] | undefined }) {
  return (
    <datalist id={POSITIONS_DATALIST}>
      {(list ?? []).filter((p) => !p.retired_at).map((p) => <option key={p.id} value={p.name}>{roleLabel(p.access_role)}</option>)}
    </datalist>
  );
}

/** says what the typed position means - and changes nothing */
export function PositionHint({ value, role, list, onRole }: { value: string; role?: string; list: Position[] | undefined; onRole?: () => void }) {
  if (!list || !value.trim()) return null;
  const p = onList(list, value);
  if (!p) return <span className={ps.hint} data-testid="position-hint" data-kind="off">{L("Not on the positions list - kept as typed.", "Tiada dalam senarai jawatan - disimpan seperti ditaip.")}</span>;
  if (role && p.access_role !== role) {
    return (
      <span className={ps.hint} data-testid="position-hint" data-kind="differs">
        {L(`This position is normally ${roleLabel(p.access_role)} access; this person is ${roleLabel(role)}. Their access does not change by itself.`,
          `Jawatan ini biasanya akses ${roleLabel(p.access_role)}; orang ini ${roleLabel(role)}. Akses mereka tidak berubah dengan sendiri.`)}
        {onRole && <button type="button" className={ps.link} onClick={onRole} data-testid="position-role-door">{L("Review the role", "Semak peranan")}</button>}
      </span>
    );
  }
  return <span className={ps.hint} data-testid="position-hint" data-kind="ok">{L(`On the list · ${roleLabel(p.access_role)} access`, `Dalam senarai · akses ${roleLabel(p.access_role)}`)}</span>;
}

/* ---------------- the CEO's and Super Admin's card ---------------- */
type Draft = { name: string; access_role: string; department: string };
const blank: Draft = { name: "", access_role: "", department: "" };

export function PositionsCard({ onChanged }: { onChanged?: () => void }) {
  const [showRetired, setShowRetired] = useState(false);
  const { data, error, reload } = usePositions(true);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<{ id: number; d: Draft; holders: number; moveHolders: boolean } | null>(null);
  const [history, setHistory] = useState<{ id: number; rows: Change[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (data && !data.can_manage) return null;
  const roles = data?.access_roles ?? [];
  const list = (data?.positions ?? []).filter((p) => showRetired || !p.retired_at);
  const retiredN = (data?.positions ?? []).filter((p) => p.retired_at).length;
  const done = (text: string) => { setMsg({ ok: true, text }); reload(); onChanged?.(); };
  const fail = (r: { data: unknown }) => setMsg({ ok: false, text: (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Not saved - try again.", "Tidak disimpan - cuba lagi.") });
  const run = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); setMsg(null); try { await fn(); } finally { setBusy(false); } };
  const add = () => run(async () => {
    if (draft.name.trim().length < 2 || !draft.access_role) { setMsg({ ok: false, text: L("Name the position and link it to an access level.", "Namakan jawatan dan pautkan ke tahap akses.") }); return; }
    const r = await api(`/staff/positions`, { method: "POST", body: JSON.stringify({ name: draft.name, access_role: draft.access_role, department: draft.department }) });
    if (!r.ok) { fail(r); return; }
    setDraft(blank); done(L(`Added "${draft.name.trim()}".`, `"${draft.name.trim()}" ditambah.`));
  });
  const save = () => run(async () => {
    if (!editing) return;
    const r = await api<{ moved?: number; holders_with_other_access?: number }>(`/staff/positions/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.d.name, access_role: editing.d.access_role, department: editing.d.department, rename_holders: editing.moveHolders }) });
    if (!r.ok) { fail(r); return; }
    const moved = r.data?.moved ?? 0, differ = r.data?.holders_with_other_access ?? 0;
    setEditing(null);
    done([L("Saved.", "Disimpan."), moved ? L(`${moved} staff record(s) now read the new name.`, `${moved} rekod kakitangan kini membaca nama baharu.`) : "",
      differ ? L(`${differ} person(s) holding it have another access level - nobody's access was changed.`, `${differ} orang yang memegangnya mempunyai tahap akses lain - akses sesiapa tidak diubah.`) : ""].filter(Boolean).join(" "));
  });
  const retire = (p: Position) => run(async () => {
    const r = await api(`/staff/positions/${p.id}/${p.retired_at ? "restore" : "retire"}`, { method: "POST", body: JSON.stringify({}) });
    if (!r.ok) { fail(r); return; }
    done(p.retired_at ? L(`"${p.name}" is back on the list.`, `"${p.name}" kembali dalam senarai.`) : L(`"${p.name}" retired - the people who hold it keep it.`, `"${p.name}" dibersarakan - pemegangnya mengekalkannya.`));
  });
  const seed = () => run(async () => {
    const r = await api<{ added?: string[] }>(`/staff/positions/seed`, { method: "POST", body: JSON.stringify({}) });
    if (!r.ok) { fail(r); return; }
    done(L(`Added ${r.data?.added?.length ?? 0} position(s) from the staff records.`, `${r.data?.added?.length ?? 0} jawatan ditambah daripada rekod kakitangan.`));
  });
  const openHistory = async (id: number) => {
    if (history?.id === id) { setHistory(null); return; }
    setHistory({ id, rows: null });
    const r = await api<{ changes: Change[] }>(`/staff/positions/${id}/changes`);
    setHistory({ id, rows: r.data?.changes ?? [] });
  };
  const ACTION: Record<string, string> = {
    create: L("Added", "Ditambah"), rename: L("Renamed", "Dinamakan semula"), relink: L("Access level changed", "Tahap akses ditukar"),
    rename_relink: L("Renamed and access level changed", "Dinamakan semula dan tahap akses ditukar"), edit: L("Edited", "Disunting"),
    retire: L("Retired", "Dibersarakan"), restore: L("Restored", "Dipulihkan"),
  };
  const roleSelect = (value: string, onChange: (v: string) => void, label: string, testid?: string) => (
    <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} data-testid={testid}>
      <option value="">{L("— access level —", "— tahap akses —")}</option>
      {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
    </select>
  );

  return (
    <section className={`${card} ${ps.card}`} aria-label={L("Positions", "Jawatan")} data-testid="positions-card">
      <header className={ps.head}>
        <span className={ps.well} aria-hidden><AppIcon name="identification" /></span>
        <span className={ps.headText}>
          <strong>{L("Positions", "Jawatan")}{data && <span className={ps.count}>{(data.positions ?? []).filter((p) => !p.retired_at).length}</span>}</strong>
          <small>{L("The positions staff are given, each linked to an access level. Choosing a position never changes anybody's access - the role changes only on the person's Role & Access.", "Jawatan yang diberi kepada kakitangan, setiap satu dipautkan ke tahap akses. Memilih jawatan tidak sekali-kali menukar akses sesiapa - peranan hanya berubah pada Peranan & Akses orang itu.")}</small>
        </span>
        {retiredN > 0 && (
          <label className={ps.toggle}><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} data-testid="positions-show-retired" />{L(`Show retired (${retiredN})`, `Tunjuk yang dibersarakan (${retiredN})`)}</label>
        )}
      </header>

      {/* add */}
      <div className={ps.addRow} data-testid="positions-add">
        <input className={inputClass} value={draft.name} maxLength={80} placeholder={L("New position, e.g. Senior Graphic Designer", "Jawatan baharu, cth. Pereka Grafik Kanan")} aria-label={L("Position name", "Nama jawatan")}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="positions-new-name" />
        {roleSelect(draft.access_role, (v) => setDraft({ ...draft, access_role: v }), L("Access level", "Tahap akses"), "positions-new-role")}
        <input className={inputClass} value={draft.department} maxLength={80} placeholder={L("Department (optional)", "Jabatan (pilihan)")} aria-label={L("Department", "Jabatan")}
          onChange={(e) => setDraft({ ...draft, department: e.target.value })} />
        <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void add()} data-testid="positions-add-btn"><AppIcon name="add" />{L("Add position", "Tambah jawatan")}</button>
      </div>
      {msg && <p className={msg.ok ? ps.ok : ps.bad} role={msg.ok ? "status" : "alert"} data-testid="positions-msg">{msg.text}</p>}
      {error && <p className={ps.bad} role="alert">{error}</p>}

      {!data && !error ? <SkelRows rows={4} /> : data && list.length === 0 ? (
        <p className={ps.empty}><AppIcon name="info" />{L("No positions on the list yet. Add the first one above, or start from the positions already typed on staff records.", "Belum ada jawatan dalam senarai. Tambah yang pertama di atas, atau mula daripada jawatan yang sudah ditaip pada rekod kakitangan.")}</p>
      ) : data && (
        <ul className={ps.list} data-testid="positions-list">
          {list.map((p) => {
            const ed = editing?.id === p.id ? editing : null;
            return (
              <li key={p.id} data-position={p.id} data-retired={p.retired_at ? "1" : undefined}>
                {ed ? (
                  <div className={ps.editRow} data-testid="positions-edit">
                    <input className={inputClass} value={ed.d.name} maxLength={80} aria-label={L("Position name", "Nama jawatan")} onChange={(e) => setEditing({ ...ed, d: { ...ed.d, name: e.target.value } })} data-testid="positions-edit-name" />
                    {roleSelect(ed.d.access_role, (v) => setEditing({ ...ed, d: { ...ed.d, access_role: v } }), L("Access level", "Tahap akses"), "positions-edit-role")}
                    <input className={inputClass} value={ed.d.department} maxLength={80} placeholder={L("Department (optional)", "Jabatan (pilihan)")} aria-label={L("Department", "Jabatan")} onChange={(e) => setEditing({ ...ed, d: { ...ed.d, department: e.target.value } })} />
                    {ed.d.name.trim() !== p.name && ed.holders > 0 && (
                      <label className={ps.toggle}><input type="checkbox" checked={ed.moveHolders} onChange={(e) => setEditing({ ...ed, moveHolders: e.target.checked })} data-testid="positions-move-holders" />
                        {L(`Also update the ${ed.holders} staff record(s) that read "${p.name}"`, `Kemas kini juga ${ed.holders} rekod kakitangan yang membaca "${p.name}"`)}</label>
                    )}
                    {ed.d.access_role !== p.access_role && ed.holders > 0 && (
                      <p className={ps.note}>{L(`Changing the access level changes nobody's role: the ${ed.holders} person(s) holding it keep theirs.`, `Menukar tahap akses tidak menukar peranan sesiapa: ${ed.holders} orang yang memegangnya mengekalkan peranan mereka.`)}</p>
                    )}
                    <span className={ps.cmds}>
                      <button type="button" className={btnSm} onClick={() => setEditing(null)}>{L("Cancel", "Batal")}</button>
                      <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void save()} data-testid="positions-save">{L("Save", "Simpan")}</button>
                    </span>
                  </div>
                ) : (
                  <div className={ps.row}>
                    <span className={ps.name}><strong>{p.name}</strong>{p.department && <small>{p.department}</small>}</span>
                    <span className={chipSmNeutral} data-testid="positions-level">{roleLabel(p.access_role)}</span>
                    <span className={ps.holders}>{L(`${p.holders} holding it`, `${p.holders} memegangnya`)}</span>
                    {p.retired_at && <span className={chipSmWarn}>{L("Retired", "Dibersarakan")}</span>}
                    <span className={ps.cmds}>
                      {!p.retired_at && <button type="button" className={btnSm} onClick={() => setEditing({ id: p.id, d: { name: p.name, access_role: p.access_role, department: p.department ?? "" }, holders: p.holders, moveHolders: true })} aria-label={L(`Edit ${p.name}`, `Sunting ${p.name}`)} data-testid="positions-edit-btn"><AppIcon name="edit" />{L("Edit", "Sunting")}</button>}
                      <button type="button" className={btnSm} disabled={busy} onClick={() => void retire(p)} aria-label={`${p.retired_at ? L("Restore", "Pulihkan") : L("Retire", "Bersarakan")} ${p.name}`} data-testid={p.retired_at ? "positions-restore" : "positions-retire"}>{p.retired_at ? L("Restore", "Pulihkan") : L("Retire", "Bersarakan")}</button>
                      <button type="button" className={btnSm} onClick={() => void openHistory(p.id)} aria-expanded={history?.id === p.id} aria-label={L(`History of ${p.name}`, `Sejarah ${p.name}`)} data-testid="positions-history-btn"><AppIcon name="time" /></button>
                    </span>
                  </div>
                )}
                {history?.id === p.id && (
                  <ol className={ps.history} data-testid="positions-history">
                    {history.rows === null ? <li><SkelRows rows={2} /></li> : history.rows.map((c) => (
                      <li key={c.id}>
                        <strong>{ACTION[c.action] ?? c.action}</strong>
                        <span>{[c.old_name && c.new_name && c.old_name !== c.new_name ? `${c.old_name} → ${c.new_name}` : "", c.old_access_role && c.new_access_role && c.old_access_role !== c.new_access_role ? `${roleLabel(c.old_access_role)} → ${roleLabel(c.new_access_role)}` : "", c.note ?? ""].filter(Boolean).join(" · ")}</span>
                        <small>{c.actor ?? "—"} · {c.created_at.slice(0, 16).replace("T", " ")}</small>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* the positions typed on records that are not on the list (P-2) */}
      {data && data.not_on_list.length > 0 && (
        <div className={ps.off} data-testid="positions-off">
          <p className={ps.offHead}><strong>{L("Typed on staff records, not on the list", "Ditaip pada rekod kakitangan, tiada dalam senarai")}</strong>
            {(data.positions ?? []).length === 0 && <button type="button" className={btnSm} disabled={busy} onClick={() => void seed()} data-testid="positions-seed">{L("Start from current positions", "Mula daripada jawatan semasa")}</button>}
          </p>
          <ul className={ps.offList}>
            {data.not_on_list.map((o) => (
              <li key={o.name}>
                <span>{o.name} <small>({o.n})</small></span>
                <button type="button" className={ps.link} onClick={() => setDraft({ ...draft, name: o.name })}>{L("Add to the list", "Tambah ke senarai")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

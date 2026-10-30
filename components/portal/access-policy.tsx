"use client";

/* v1.234.0 - ROLES & PERMISSIONS, ONE PLACE (the owner, 30-10-2026:
   "ONE AUTHORIZATION SOURCE. ONE ROLE PERMISSION MANAGEMENT INTERFACE. NO
   CONFLICTING USER OVERRIDES."; claude/USERS-ACCESS-AUDIT.md). Answers:
   keep per-user exceptions inside Roles & Permissions; the Admin account
   no longer releases payslips, marks paid or records the bank run; the
   geofence stays in Users; build, with the export in the review.

   Three pieces, all reading the server:
     AccessPolicyCard   what each role may DO - /staff/access/policy, every
                        row resolved from the constant its route checks.
                        Read-only: an action changes only with the code.
     ExceptionsCard     per-user exceptions (was "Who sees what" under
                        Security & Settings): each with its reason, who,
                        when and an optional end date; a verdict for old
                        ones. It can hide a tab or show one the role can
                        already read - the server refuses anything else.
     AccessReviewDrawer the before-and-after export: overrides, exceptions,
                        every person's tab strip, the access history -
                        downloadable as JSON and CSV.
   The tab-visibility matrix (tab-access-card.tsx) stays as it is. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import { getLang, t } from "@/lib/i18n";
import { GOVERNABLE_TABS } from "@/lib/portal-tabs";
import { btnClass, btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { roleLabel } from "@/components/portal/users-shared";
import css from "./access-policy.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Policy {
  roles: string[];
  actions: { module: string; key: string; en: string; ms: string; note_en: string | null; note_ms: string | null; roles: string[] }[];
  tabs: { tab: string; always: boolean; overridden: boolean; sees: string[]; reads: string[] | null }[];
  can_edit_tabs: boolean;
}
type Verdict = "shows_tab" | "hides_only" | "redundant" | "hollow" | "expired" | "no_account";
interface Exception { user_id: number; name: string | null; role: string | null; active: boolean; tab: string; kind: "grant" | "refuse"; reason: string | null; by_name: string | null; at: string | null; expires_on: string | null; needs_review: boolean; verdict: Verdict }
interface Review {
  generated_at: string; today: string; overrides: Record<string, string[]>; exceptions: Exception[];
  people: { id: number; name: string; role: string; tabs: string[] }[];
  history: { id: number; action: string; entity_id: string | null; detail: string | null; created_at: string; who: string | null }[];
}

const VERDICT: Record<Verdict, [string, string, string, string]> = {
  shows_tab: ["Shows a tab", "Papar tab", chipSmInfo, ""],
  hides_only: ["Hides a tab only", "Sembunyi tab sahaja", chipSmNeutral, ""],
  redundant: ["Same as the role", "Sama seperti peranan", chipSmNeutral, ""],
  hollow: ["Server refuses this role", "Pelayan menolak peranan ini", chipSmDanger, ""],
  expired: ["Ended", "Tamat", chipSmNeutral, ""],
  no_account: ["No such account", "Tiada akaun", chipSmWarn, ""],
};

/* ------------------------------------------------------------------ */
export function usePolicy(enabled: boolean) {
  const [got, setGot] = useState<{ d: Policy | null; e: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    void api<Policy>("/staff/access/policy", { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setGot({ d: r.ok && r.data ? r.data : null, e: r.ok ? "" : L("The access policy needs the latest server.", "Polisi akses memerlukan pelayan terkini.") });
    });
    return () => c.abort();
  }, [enabled]);
  return got;
}

export function useReview(enabled: boolean, tick: number) {
  const [got, setGot] = useState<{ k: number; d: Review | null; e: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    void api<Review>("/staff/access/review", { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setGot({ k: tick, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : L("The access review needs the latest server.", "Semakan akses memerlukan pelayan terkini.") });
    });
    return () => c.abort();
  }, [enabled, tick]);
  return got;
}

/** What each role may DO, by module - read from the server's own rules. */
export function AccessPolicyCard({ policy }: { policy: { d: Policy | null; e: string } | null }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("ceo");
  const d = policy?.d ?? null;
  const needle = q.trim().toLowerCase();
  const rows = (d?.actions ?? []).filter((a) => !needle || a.module.toLowerCase().includes(needle) || L(a.en, a.ms).toLowerCase().includes(needle));
  const modules = [...new Set(rows.map((a) => a.module))];
  const cell = (on: boolean) => on
    ? <span className={chipSmSuccess}>{L("Allowed", "Dibenarkan")}</span>
    : <span className={chipSmDanger}>{L("Denied", "Ditolak")}</span>;
  return (
    <section className={card} aria-label={L("Access policy matrix", "Matriks polisi akses")}>
      <div className={css.head}>
        <div>
          <h3 className={css.title}>{L("Access policy matrix", "Matriks polisi akses")}</h3>
          <p className={css.sub}>{L("What each role may do, read from the rules the server enforces on every request. Changing an action is a code change the CEO approves; hiding a tab never changes these.", "Apa yang setiap peranan boleh lakukan, dibaca daripada peraturan yang dikuatkuasa pelayan pada setiap permintaan. Menukar tindakan ialah perubahan kod yang diluluskan CEO; menyembunyikan tab tidak mengubahnya.")}</p>
        </div>
      </div>
      <div className={css.filters}>
        <input type="search" className={inputClassSm} aria-label={L("Search resource or action", "Cari sumber atau tindakan")} placeholder={L("Search resource or action", "Cari sumber atau tindakan")} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className={css.phoneOnly}>
          <select className={selectClassSm} aria-label={L("Role to show", "Peranan untuk dipaparkan")} value={role} onChange={(e) => setRole(e.target.value)}>
            {(d?.roles ?? []).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select></label>
      </div>
      {policy?.e ? <p role="alert" className={css.error}>{policy.e}</p> : !d ? <SkelRows rows={6} /> : (
        <>
          <div className={`${css.tableWrap} ${css.desk}`}>
            <table className={css.table} aria-label={L("Actions by role", "Tindakan mengikut peranan")}>
              <thead><tr><th>{L("Resource / action", "Sumber / tindakan")}</th>{d.roles.map((r) => <th key={r} className={css.c}>{roleLabel(r)}</th>)}</tr></thead>
              <tbody>
                {modules.map((m) => (
                  <PolicyGroup key={m} module={m} rows={rows.filter((a) => a.module === m)} roles={d.roles} cell={cell} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className={`${css.phoneList} ${css.phone}`} aria-label={L(`What a ${roleLabel(role)} may do`, `Apa yang ${roleLabel(role)} boleh lakukan`)}>
            {rows.map((a) => (
              <li key={a.key}><span className={css.main}><strong>{t(a.module, getLang())} — {L(a.en, a.ms)}</strong>{a.note_en && <span>{L(a.note_en, a.note_ms ?? a.note_en)}</span>}</span>{cell(a.roles.includes(role))}</li>
            ))}
          </ul>
        </>
      )}
      <p className={css.foot}>{L("Super admin is the system recovery account: strong sign-in and 2FA, every change audited; it cannot confirm Paid.", "Super admin ialah akaun pemulihan sistem: log masuk kukuh dan 2FA, setiap perubahan diaudit; ia tidak boleh mengesahkan Dibayar.")}</p>
    </section>
  );
}
function PolicyGroup({ module, rows, roles, cell }: { module: string; rows: Policy["actions"]; roles: string[]; cell: (on: boolean) => React.ReactNode }) {
  return (
    <>
      <tr className={css.group}><th colSpan={roles.length + 1} scope="colgroup">{t(module, getLang())}</th></tr>
      {rows.map((a) => (
        <tr key={a.key}>
          <th scope="row" className={css.rowHead}><span>{L(a.en, a.ms)}</span>{a.note_en && <small>{L(a.note_en, a.note_ms ?? a.note_en)}</small>}</th>
          {roles.map((r) => <td key={r} className={css.c}>{cell(a.roles.includes(r))}</td>)}
        </tr>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/** Per-user exceptions - the one place a person's tabs differ from their role. */
export function ExceptionsCard({ review, canEdit, onChanged, people }: {
  review: { d: Review | null; e: string } | null; canEdit: boolean; onChanged: () => void;
  people: { id: number; name: string; role: string }[];
}) {
  const { show: toast, node: toastNode } = useSaveToast();
  const [form, setForm] = useState<{ user_id: number; tab: string; mode: "allow" | "deny"; reason: string; expires_on: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = review?.d ?? null;
  const list = d?.exceptions ?? [];
  const pending = list.filter((x) => x.needs_review || x.verdict === "hollow");
  const strip = form ? d?.people.find((p) => p.id === form.user_id) : null;

  const send = async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setError("");
    const r = await api<{ error?: { message?: string } }>("/staff/tabs/access/person", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { toast(L("Saved", "Disimpan"), done); setForm(null); onChanged(); }
    else setError(r.data?.error?.message ?? L("The server refused the change.", "Pelayan menolak perubahan."));
  };
  return (
    <section className={card} aria-label={L("Per-user exceptions", "Pengecualian setiap pengguna")}>
      {toastNode}
      <div className={css.head}>
        <div>
          <h3 className={css.title}>{L("Per-user exceptions", "Pengecualian setiap pengguna")}</h3>
          <p className={css.sub}>{L("The only place one person's tabs differ from their role. An exception hides a tab, or shows one the role can already read - it never adds a permission the server refuses.", "Satu-satunya tempat tab seseorang berbeza daripada peranannya. Pengecualian menyembunyikan tab, atau memaparkan tab yang peranan itu sudah boleh baca - ia tidak menambah kebenaran yang ditolak pelayan.")}</p>
        </div>
        {canEdit && !form && <button type="button" className={btnSm} onClick={() => setForm({ user_id: people[0]?.id ?? 0, tab: GOVERNABLE_TABS[0]!, mode: "deny", reason: "", expires_on: "" })}><AppIcon name="add" />{L("Add exception", "Tambah pengecualian")}</button>}
      </div>
      {pending.length > 0 && (
        <p className={css.warn}><AppIcon name="warning" />{L(`${pending.length} to review: saved before reasons were recorded, or showing a tab the server refuses. Nothing is removed until you decide.`, `${pending.length} untuk disemak: disimpan sebelum sebab direkod, atau memaparkan tab yang ditolak pelayan. Tiada apa dibuang sehingga anda memutuskan.`)}</p>
      )}
      {form && (
        <fieldset className={css.form} disabled={busy}>
          <div className={css.formRow}>
            <label>{L("Person", "Orang")}<select className={selectClassSm} value={form.user_id} onChange={(e) => setForm({ ...form, user_id: Number(e.target.value) })}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {roleLabel(p.role)}</option>)}</select></label>
            <label>{L("Tab", "Tab")}<select className={selectClassSm} value={form.tab} onChange={(e) => setForm({ ...form, tab: e.target.value })}>
              {GOVERNABLE_TABS.map((tb) => <option key={tb} value={tb}>{t(tb, getLang())}</option>)}</select></label>
            <label>{L("Exception", "Pengecualian")}<select className={selectClassSm} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "allow" | "deny" })}>
              <option value="deny">{L("Hide this tab", "Sembunyikan tab ini")}</option><option value="allow">{L("Show this tab", "Paparkan tab ini")}</option></select></label>
            <label>{L("Ends (optional)", "Tamat (pilihan)")}<input type="date" className={inputClassSm} min={d?.today} value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} /></label>
          </div>
          <label className={css.wide}>{L("Reason (approved by you, kept in the history)", "Sebab (diluluskan anda, disimpan dalam sejarah)")}<input className={inputClassSm} maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          {strip && <p className={css.sub}>{L("Sees today", "Melihat hari ini")}: {strip.tabs.map((tb) => t(tb, getLang())).join(", ")}</p>}
          {error && <p role="alert" className={css.error}>{error}</p>}
          <div className={css.formRow}>
            <button type="button" className={btnClass} disabled={form.reason.trim().length < 10 || !form.user_id}
              onClick={() => void send({ user_id: form.user_id, tab: form.tab, mode: form.mode, reason: form.reason.trim(), expires_on: form.expires_on || null }, L("Exception recorded", "Pengecualian direkod"))}>
              {L("Save exception", "Simpan pengecualian")}</button>
            <button type="button" className={btnSm} onClick={() => { setForm(null); setError(""); }}>{L("Cancel", "Batal")}</button>
          </div>
        </fieldset>
      )}
      {review?.e ? <p role="alert" className={css.error}>{review.e}</p> : !d ? <SkelRows rows={3} /> : list.length === 0 ? (
        <p className={css.empty}>{L("No exceptions - everyone sees exactly what their role shows.", "Tiada pengecualian - semua melihat tepat seperti peranan mereka.")}</p>
      ) : (
        <ul className={css.exList}>
          {list.map((x) => (
            <li key={`${x.user_id}-${x.tab}`}>
              <span className={css.main}>
                <strong>{x.name ?? `#${x.user_id}`} · {x.kind === "grant" ? L("shows", "papar") : L("hides", "sembunyi")} {t(x.tab, getLang())}</strong>
                <span>{x.role ? roleLabel(x.role) : "—"}{x.reason ? ` · ${x.reason}` : ""}{x.by_name ? ` · ${x.by_name}` : ""}{x.at ? ` · ${dmy(x.at.slice(0, 10))}` : ""}{x.expires_on ? ` · ${L("ends", "tamat")} ${dmy(x.expires_on)}` : ""}</span>
              </span>
              <span className={css.chips}>
                {x.needs_review && <span className={chipSmWarn}>{L("Needs review", "Perlu disemak")}</span>}
                <span className={VERDICT[x.verdict][2]}>{L(VERDICT[x.verdict][0], VERDICT[x.verdict][1])}</span>
                {canEdit && <button type="button" className={btnSm} disabled={busy} onClick={() => void send({ user_id: x.user_id, tab: x.tab, mode: "clear" }, L("Back to the role rule", "Kembali kepada peraturan peranan"))}>{L("Remove", "Buang")}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const ACTION_WORD: Record<string, [string, string]> = {
  "staff.role_change": ["Role changed", "Peranan ditukar"], "tabs.access_change": ["Tab rule changed", "Peraturan tab ditukar"],
  "tabs.person_access": ["Exception changed", "Pengecualian ditukar"], "staff.reports_to": ["Reporting line set", "Garis pelaporan ditetapkan"],
  "attendance.geofence_set": ["Geofence set", "Geofence ditetapkan"], "attendance.geofence_clear": ["Geofence cleared", "Geofence dikosongkan"],
};
const detailOf = (raw: string | null) => {
  try {
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return [o.name ?? o.staff_name, o.from && o.to ? `${String(o.from)} → ${String(o.to)}` : null, o.tab, o.mode, o.reason, o.to_name ? `→ ${String(o.to_name)}` : null]
      .filter(Boolean).map(String).join(" · ");
  } catch { return ""; }
};

/** The before-and-after export, and who changed access when. */
export function AccessReviewDrawer({ open, onClose, review }: { open: boolean; onClose: () => void; review: { d: Review | null; e: string } | null }) {
  const d = review?.d ?? null;
  const csv = useMemo(() => !d ? "" : [
    ["section", "person", "role", "tab", "detail", "reason", "by", "at", "ends", "verdict"].join(","),
    ...Object.entries(d.overrides).map(([tab, roles]) => ["tab_rule", "", roles.join(" "), tab, "role override", "", "", "", "", ""].map(csvCell).join(",")),
    ...d.exceptions.map((x) => ["exception", x.name, x.role, x.tab, x.kind, x.reason, x.by_name, x.at, x.expires_on, x.verdict].map(csvCell).join(",")),
    ...d.people.map((p) => ["sees", p.name, p.role, "", p.tabs.join(" "), "", "", "", "", ""].map(csvCell).join(",")),
  ].join("\n"), [d]);
  const stamp = d ? d.generated_at.slice(0, 16).replace(/[:T]/g, "-") : "";
  const save = useCallback((kind: "json" | "csv") => {
    if (!d) return;
    if (kind === "json") download(`access-review-${stamp}.json`, JSON.stringify(d, null, 2), "application/json");
    else download(`access-review-${stamp}.csv`, csv, "text/csv");
  }, [d, csv, stamp]);
  return (
    <SideDrawer open={open} onClose={onClose} wide title={L("Access review", "Semakan akses")} subtitle={L("Read-only - save it before and after any change and compare", "Baca sahaja - simpan sebelum dan selepas sebarang perubahan dan bandingkan")}
      footer={d ? <div className={css.formRow}><button type="button" className={btnSm} onClick={() => save("csv")}><AppIcon name="download" />CSV</button><button type="button" className={btnSm} onClick={() => save("json")}><AppIcon name="download" />JSON</button></div> : undefined}>
      {review?.e ? <p role="alert" className={css.error}>{review.e}</p> : !d ? <SkelRows rows={6} /> : (
        <div className={css.drawer}>
          <p className={css.sub}>{L(`Taken ${d.generated_at.slice(0, 16).replace("T", " ")} UTC · ${Object.keys(d.overrides).length} tab rule(s) · ${d.exceptions.length} exception(s) · ${d.people.length} people`, `Diambil ${d.generated_at.slice(0, 16).replace("T", " ")} UTC · ${Object.keys(d.overrides).length} peraturan tab · ${d.exceptions.length} pengecualian · ${d.people.length} orang`)}</p>
          <h4 className={css.h4}>{L("Who sees what today", "Siapa nampak apa hari ini")}</h4>
          <ul className={css.exList}>{d.people.map((p) => (
            <li key={p.id}><span className={css.main}><strong>{p.name} · {roleLabel(p.role)}</strong><span>{p.tabs.map((tb) => t(tb, getLang())).join(", ")}</span></span></li>
          ))}</ul>
          <h4 className={css.h4}>{L("Access history", "Sejarah akses")}</h4>
          {d.history.length === 0 ? <p className={css.empty}>{L("Nothing recorded yet.", "Belum ada rekod.")}</p> : (
            <ul className={css.exList}>{d.history.map((h) => (
              <li key={h.id}><span className={css.main}><strong>{ACTION_WORD[h.action] ? L(ACTION_WORD[h.action]![0], ACTION_WORD[h.action]![1]) : h.action} · {h.who ?? "—"}</strong><span>{h.created_at.slice(0, 16)} UTC{detailOf(h.detail) ? ` · ${detailOf(h.detail)}` : ""}</span></span></li>
            ))}</ul>
          )}
        </div>
      )}
    </SideDrawer>
  );
}

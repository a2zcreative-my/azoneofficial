"use client";

/**
 * v1.268.0 - EXECUTIVE RECOVERY (Secure Authentication 2.0, Phase R;
 * claude/PHASE-R-GOVERNANCE.md revision 2). Profile -> Security for the CEO,
 * the Super Admin, the COO and the CCO; the admin console's Account tab.
 *
 *   the owner    names the panel (COO, CCO) with a reason and a code
 *   a member     accepts with their own code; asks for a recovery of the
 *                owner or the Super Admin (identity check, reason, code);
 *                a DIFFERENT member approves; it runs 12 hours later
 *   anyone here  can cancel an open request with their code
 *   the person   recovered reviews their recent activity, then confirms
 *
 * Every rule is the worker's (worker/src/recovery.ts); this card only asks.
 */

import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { card, btnClass, btnGhost, inputClass, chipSuccess, chipNeutral, chipWarn, chipDanger } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import { Skel, SkelHead, SkelText } from "@/components/ui/skeleton";
import g from "./google-connect-panel.module.css";
import css from "./recovery-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type Member = { id: number; user_id: number; name: string; role: string; accepted: boolean; effective_at: string; active: boolean; why: string | null };
type Req = { id: number; target_id: number; target_name: string; requested_by_name: string; approved_by_name: string | null; reason: string; identity_checked: string; identity_method: string; unlink_google: boolean; status: string; created_at: string; approve_by: string; approved_at: string | null; execute_after: string | null; executed_at: string | null; cancelled_at: string | null; cancel_reason: string | null; can_approve: boolean; can_cancel: boolean };
type State = {
  me: { is_owner: boolean; member: { accepted: boolean; effective_at: string; can_act: boolean; why: string | null } | null; is_target: boolean };
  panel: Member[]; available: boolean; eligible: { id: number; name: string; role: string }[]; targets: { id: number; name: string; role: string }[];
  locked: { target_id: number; count: number }[]; requests: Req[];
};
type Review = { required: boolean; two_factor_on: boolean; history: { action: string; created_at: string }[] };
type Form =
  | { kind: "add"; user_id: number; reason: string }
  | { kind: "remove"; id: number; reason: string }
  | { kind: "accept" }
  | { kind: "request"; target_id: number; reason: string; identity_checked: string; identity_method: string; unlink_google: boolean }
  | { kind: "approve"; id: number; identity_confirmed: string }
  | { kind: "cancel"; id: number; reason: string }
  | { kind: "unlock"; target_id: number; reason: string }
  | { kind: "review" };

const WHY: Record<string, [string, string]> = {
  not_accepted: ["waiting for them to accept", "menunggu mereka menerima"],
  not_yet_effective: ["counts 24 hours after being named", "dikira 24 jam selepas dinamakan"],
  account_not_active: ["account not active", "akaun tidak aktif"],
  no_two_factor: ["two-factor is off", "dua faktor mati"],
  role_changed: ["no longer COO or CCO", "bukan lagi COO atau CCO"],
};
const STATUS: Record<string, [string, string, string]> = {
  requested: ["Waiting for a second member", "Menunggu ahli kedua", chipWarn],
  approved: ["Approved - runs after the wait", "Diluluskan - berjalan selepas tempoh menunggu", chipWarn],
  executed: ["Carried out", "Dilaksanakan", chipSuccess],
  cancelled: ["Cancelled", "Dibatalkan", chipNeutral],
  lapsed: ["Lapsed (not approved in 24 h)", "Luput (tidak diluluskan dalam 24 jam)", chipNeutral],
};
const dt = (s: string | null) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)} ${s.slice(11, 16)} UTC` : "");

export function RecoveryPanel() {
  const [s, setS] = useState<State | null>(null);
  const [rev, setRev] = useState<Review | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([api<State>("/staff/recovery"), api<Review>("/staff/recovery/review")]).then(([a, b]) => {
      if (!live) return;
      setS(a.ok && a.data ? a.data : null);
      setRev(b.ok && b.data ? b.data : null);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [tick]);

  if (!loaded) {
    return (
      <div className={`${card} ${g.panel}`} aria-hidden>
        <div className={g.head}><SkelHead sub={false} /></div>
        <SkelText lines={3} />
        <Skel className={g.skelBtn} />
      </div>
    );
  }
  if (!s && !rev?.required) return null;

  const open = (f: Form) => { setForm(f); setTotp(""); setMsg(null); };
  const send = async () => {
    if (!form) return;
    const map: Record<Form["kind"], [string, Record<string, unknown>]> = {
      add: ["/staff/recovery/panel", form.kind === "add" ? { user_id: form.user_id, reason: form.reason } : {}],
      remove: [form.kind === "remove" ? `/staff/recovery/panel/${form.id}/remove` : "", form.kind === "remove" ? { reason: form.reason } : {}],
      accept: ["/staff/recovery/panel/accept", {}],
      request: ["/staff/recovery/requests", form.kind === "request" ? { target_id: form.target_id, reason: form.reason, identity_checked: form.identity_checked, identity_method: form.identity_method, unlink_google: form.unlink_google } : {}],
      approve: [form.kind === "approve" ? `/staff/recovery/requests/${form.id}/approve` : "", form.kind === "approve" ? { identity_confirmed: form.identity_confirmed } : {}],
      cancel: [form.kind === "cancel" ? `/staff/recovery/requests/${form.id}/cancel` : "", form.kind === "cancel" ? { reason: form.reason } : {}],
      unlock: ["/staff/recovery/unlock", form.kind === "unlock" ? { target_id: form.target_id, reason: form.reason } : {}],
      review: ["/staff/recovery/review", {}],
    };
    const [path, body] = map[form.kind];
    setBusy(true);
    const r = await api(path, { method: "POST", body: JSON.stringify({ ...body, totp }) });
    setBusy(false); setTotp("");
    if (r.ok) { setForm(null); setMsg({ tone: "good", text: L("Done.", "Selesai.") }); setTick((t) => t + 1); }
    else setMsg({ tone: "bad", text: (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("That did not work - try again.", "Itu tidak berjaya - cuba lagi.") });
  };
  const codeOk = /^\d{6}$/.test(totp);
  const ready = !!form && codeOk && (
    form.kind === "add" ? form.user_id > 0 && form.reason.trim().length >= 10
      : form.kind === "remove" || form.kind === "unlock" ? form.reason.trim().length >= 10
        : form.kind === "request" ? form.target_id > 0 && form.reason.trim().length >= 10 && form.identity_checked.trim().length >= 10 && !!form.identity_method
          : form.kind === "approve" ? form.identity_confirmed.trim().length >= 10
            : form.kind === "cancel" ? form.reason.trim().length >= 5 : true);
  const codeRow = (label: string) => (
    <div className={css.buttons}>
      <label>{L("Your authenticator code", "Kod pengesah anda")}
        <input className={`${inputClass} ${css.code}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      </label>
      <button type="button" className={btnClass} disabled={busy || !ready} onClick={() => void send()}>{busy ? L("Working…", "Sedang diproses…") : label}</button>
      <button type="button" className={btnGhost} onClick={() => { setForm(null); setMsg(null); }}>{L("Cancel", "Batal")}</button>
    </div>
  );
  const reasonField = (value: string, set: (v: string) => void, label = L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")) => (
    <label>{label}<input className={inputClass} value={value} maxLength={300} onChange={(e) => set(e.target.value)} /></label>
  );

  return (
    <section className={`${card} ${g.panel}`} aria-label={L("Executive recovery", "Pemulihan eksekutif")}>
      <div className={g.head}>
        <p className={g.title}>{L("Executive recovery", "Pemulihan eksekutif")}</p>
        {s && <span className={s.available ? chipSuccess : chipDanger}>{s.available ? L("Panel ready", "Panel sedia") : L("Panel not ready", "Panel belum sedia")}</span>}
      </div>
      {msg && <p className={g.note} data-tone={msg.tone} role="status">{msg.text}</p>}

      {rev?.required && (
        <div className={css.form}>
          <p className={g.title}>{L("Your account was recovered", "Akaun anda telah dipulihkan")}</p>
          <p className={css.meta}>{rev.two_factor_on
            ? L("Check this recent activity. If anything is not yours, tell the CEO and the COO now.", "Semak aktiviti terkini ini. Jika ada yang bukan milik anda, beritahu CEO dan COO sekarang.")
            : L("Set up two-factor again first (above).", "Tetapkan semula dua faktor dahulu (di atas).")}</p>
          <ul className={css.list}>{rev.history.slice(0, 10).map((h, i) => <li key={i} className={css.meta}>{dt(h.created_at)} - {h.action.replace(/^auth\./, "").replace(/_/g, " ")}</li>)}</ul>
          {rev.two_factor_on && (form?.kind === "review" ? codeRow(L("I have reviewed it", "Saya telah menyemaknya")) : <div className={css.buttons}><button type="button" className={btnClass} onClick={() => open({ kind: "review" })}>{L("I have reviewed it", "Saya telah menyemaknya")}</button></div>)}
        </div>
      )}

      {s && (
        <>
          <p className={g.line}>{L(
            "If the CEO or the Super Admin loses every way to sign in, two panel members - one asks, the other approves, each with their own code - reset that account's two-factor and sign it out everywhere. It runs 12 hours after approval; anyone here can cancel. It never changes roles, ownership, permissions, payroll or finance.",
            "Jika CEO atau Super Admin kehilangan semua cara log masuk, dua ahli panel - seorang meminta, seorang lagi meluluskan, masing-masing dengan kod sendiri - menetapkan semula dua faktor akaun itu dan melog keluarnya di semua tempat. Ia berjalan 12 jam selepas kelulusan; sesiapa di sini boleh membatalkannya. Ia tidak pernah mengubah peranan, pemilikan, kebenaran, gaji atau kewangan.",
          )}</p>

          <p className={g.title}>{L("Panel", "Panel")}</p>
          {s.panel.length === 0 ? <p className={css.meta}>{L("No one named yet.", "Belum ada yang dinamakan.")}</p> : (
            <ul className={css.list}>
              {s.panel.map((m) => (
                <li key={m.id} className={css.item}>
                  <div className={css.top}>
                    <strong>{m.name}</strong><span className={chipNeutral}>{m.role.toUpperCase()}</span>
                    <span className={m.active ? chipSuccess : chipWarn}>{m.active ? L("Active", "Aktif") : L(...(WHY[m.why ?? ""] ?? ["not active", "tidak aktif"]))}</span>
                  </div>
                  {s.me.is_owner && (form?.kind === "remove" && form.id === m.id ? (
                    <div className={css.form}>{reasonField(form.reason, (v) => setForm({ ...form, reason: v }))}{codeRow(L("Remove from the panel", "Keluarkan daripada panel"))}</div>
                  ) : <div className={css.buttons}><button type="button" className={btnGhost} onClick={() => open({ kind: "remove", id: m.id, reason: "" })}>{L("Remove", "Keluarkan")}</button></div>)}
                </li>
              ))}
            </ul>
          )}
          {s.me.is_owner && s.eligible.length > 0 && (form?.kind === "add" ? (
            <div className={css.form}>
              <label>{L("Who", "Siapa")}
                <select className={inputClass} value={form.user_id || ""} onChange={(e) => setForm({ ...form, user_id: Number(e.target.value) })}>
                  <option value="">{L("Choose", "Pilih")}</option>
                  {s.eligible.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.role.toUpperCase()})</option>)}
                </select>
              </label>
              {reasonField(form.reason, (v) => setForm({ ...form, reason: v }))}
              {codeRow(L("Name to the panel", "Namakan ke panel"))}
            </div>
          ) : <div className={css.buttons}><button type="button" className={btnGhost} onClick={() => open({ kind: "add", user_id: 0, reason: "" })}>{L("Name a panel member", "Namakan ahli panel")}</button></div>)}
          {s.me.member && !s.me.member.accepted && (form?.kind === "accept" ? (
            <div className={css.form}><p className={css.meta}>{L("You were named to the recovery panel. Accept with your own code - only then do you count.", "Anda telah dinamakan ke panel pemulihan. Terima dengan kod anda sendiri - hanya selepas itu anda dikira.")}</p>{codeRow(L("Accept", "Terima"))}</div>
          ) : <div className={css.buttons}><button type="button" className={btnClass} onClick={() => open({ kind: "accept" })}>{L("Accept the panel role", "Terima peranan panel")}</button></div>)}

          {s.locked.length > 0 && s.locked.map((l) => {
            const t = s.targets.find((x) => x.id === l.target_id);
            /* the owner reviews; for the owner's own account, the Super Admin (neither owner nor member here) - the worker decides */
            const canUnlock = t?.role === "ceo" ? !s.me.is_owner && !s.me.member : s.me.is_owner;
            return (
              <div key={l.target_id} className={css.form}>
                <p className={css.meta}>{L(`Recovery for ${t?.name ?? "#" + l.target_id} is locked: ${l.count} requests were cancelled or lapsed in 30 days.`, `Pemulihan untuk ${t?.name ?? "#" + l.target_id} dikunci: ${l.count} permintaan dibatalkan atau luput dalam 30 hari.`)}</p>
                {canUnlock && (form?.kind === "unlock" && form.target_id === l.target_id
                  ? <>{reasonField(form.reason, (v) => setForm({ ...form, reason: v }))}{codeRow(L("Reopen after review", "Buka semula selepas semakan"))}</>
                  : <div className={css.buttons}><button type="button" className={btnGhost} onClick={() => open({ kind: "unlock", target_id: l.target_id, reason: "" })}>{L("Review and reopen", "Semak dan buka semula")}</button></div>)}
              </div>
            );
          })}

          <p className={g.title}>{L("Requests", "Permintaan")}</p>
          {s.requests.length === 0 ? <p className={css.meta}>{L("None.", "Tiada.")}</p> : (
            <ul className={css.list}>
              {s.requests.map((r) => {
                const st = STATUS[r.status] ?? [r.status, r.status, chipNeutral];
                return (
                  <li key={r.id} className={css.item} data-status={r.status}>
                    <div className={css.top}><strong>#{r.id} {r.target_name}</strong><span className={st[2]}>{L(st[0], st[1])}</span></div>
                    <p className={css.meta}>{L(`Asked by ${r.requested_by_name} on ${dt(r.created_at)}: ${r.reason}`, `Diminta oleh ${r.requested_by_name} pada ${dt(r.created_at)}: ${r.reason}`)}</p>
                    <p className={css.meta}>{L(`Identity: ${r.identity_method === "in_person" ? "in person" : "video call"} - ${r.identity_checked}`, `Identiti: ${r.identity_method === "in_person" ? "bersemuka" : "panggilan video"} - ${r.identity_checked}`)}{r.unlink_google ? L(" · also disconnects Google", " · juga memutuskan Google") : ""}</p>
                    {r.status === "requested" && <p className={css.meta}>{L(`Needs approval by ${dt(r.approve_by)}.`, `Perlu kelulusan sebelum ${dt(r.approve_by)}.`)}</p>}
                    {r.status === "approved" && <p className={css.meta}>{L(`Approved by ${r.approved_by_name}. Runs after ${dt(r.execute_after)}.`, `Diluluskan oleh ${r.approved_by_name}. Berjalan selepas ${dt(r.execute_after)}.`)}</p>}
                    {r.status === "cancelled" && r.cancel_reason && <p className={css.meta}>{r.cancel_reason}</p>}
                    {form && (form.kind === "approve" || form.kind === "cancel") && form.id === r.id ? (
                      <div className={css.form}>
                        {form.kind === "approve"
                          ? <label>{L("How YOU checked who they are (independently)", "Bagaimana ANDA menyemak siapa mereka (secara berasingan)")}<input className={inputClass} value={form.identity_confirmed} maxLength={200} onChange={(e) => setForm({ ...form, identity_confirmed: e.target.value })} /></label>
                          : reasonField(form.reason, (v) => setForm({ ...form, reason: v }))}
                        {codeRow(form.kind === "approve" ? L("Approve", "Luluskan") : L("Cancel the request", "Batalkan permintaan"))}
                      </div>
                    ) : (r.can_approve || r.can_cancel) && (
                      <div className={css.buttons}>
                        {r.can_approve && <button type="button" className={btnClass} onClick={() => open({ kind: "approve", id: r.id, identity_confirmed: "" })}>{L("Approve", "Luluskan")}</button>}
                        {r.can_cancel && <button type="button" className={btnGhost} onClick={() => open({ kind: "cancel", id: r.id, reason: "" })}>{L("Cancel", "Batal")}</button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {s.me.member?.can_act && (form?.kind === "request" ? (
            <div className={css.form}>
              <label>{L("Whose account", "Akaun siapa")}
                <select className={inputClass} value={form.target_id || ""} onChange={(e) => setForm({ ...form, target_id: Number(e.target.value) })}>
                  <option value="">{L("Choose", "Pilih")}</option>
                  {s.targets.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.role === "ceo" ? "CEO" : "Super Admin"})</option>)}
                </select>
              </label>
              {reasonField(form.reason, (v) => setForm({ ...form, reason: v }))}
              <div className={css.radios} role="radiogroup" aria-label={L("How you checked who they are", "Cara anda menyemak siapa mereka")}>
                <label><input type="radio" name="idm" checked={form.identity_method === "in_person"} onChange={() => setForm({ ...form, identity_method: "in_person" })} />{L("In person", "Bersemuka")}</label>
                <label><input type="radio" name="idm" checked={form.identity_method === "video_call"} onChange={() => setForm({ ...form, identity_method: "video_call" })} />{L("Video call", "Panggilan video")}</label>
              </div>
              <label>{L("What you checked (ID document seen, by whom)", "Apa yang anda semak (dokumen pengenalan dilihat, oleh siapa)")}<input className={inputClass} value={form.identity_checked} maxLength={200} onChange={(e) => setForm({ ...form, identity_checked: e.target.value })} /></label>
              <label className={css.inline}><input type="checkbox" checked={form.unlink_google} onChange={(e) => setForm({ ...form, unlink_google: e.target.checked })} />{L("Also disconnect their Google account (if it may be compromised)", "Juga putuskan akaun Google mereka (jika mungkin dikompromi)")}</label>
              {codeRow(L("Ask for the recovery", "Minta pemulihan"))}
            </div>
          ) : <div className={css.buttons}><button type="button" className={btnGhost} onClick={() => open({ kind: "request", target_id: 0, reason: "", identity_checked: "", identity_method: "", unlink_google: false })}>{L("Ask for an executive recovery", "Minta pemulihan eksekutif")}</button></div>)}
          {!s.available && <p className={css.meta}>{L("Two active panel members are needed. Until then only the Level 2 procedure (docs/BREAKGLASS.md) applies.", "Dua ahli panel aktif diperlukan. Sehingga itu hanya prosedur Tahap 2 (docs/BREAKGLASS.md) terpakai.")}</p>}
        </>
      )}
    </section>
  );
}

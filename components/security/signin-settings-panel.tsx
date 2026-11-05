"use client";

/**
 * v1.266.0 - SIGN-IN SETTINGS, the company owner's (Secure Authentication 2.0,
 * Phase 1c; claude/AUTH-2.0-AUDIT.md rev 3 sec. 10, R10, R11, Q7). Profile ->
 * Security, for the CEO and the super admin; only the company owner changes
 * anything, each change with a reason and a fresh authenticator code
 * (PUT /staff/auth/settings), audited before and after.
 *   - Google sign-in on / off (the kill switch: password + authenticator stay on)
 *   - customer sign-up with Google on / off
 *   - the legacy link window for the Google-created customers from before
 *     1.238.0 (its last day, 90 days at most), and the notice that tells them:
 *     the exact words are shown; it is sent only when the owner presses Send.
 * There is no setting that links Google accounts by email.
 */

import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { card, btnClass, btnGhost, inputClass, chipSuccess, chipNeutral, chipWarn } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import { Skel, SkelHead, SkelText } from "@/components/ui/skeleton";
import css from "./google-connect-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type Settings = {
  google: { enabled: boolean; customer_signup: boolean; legacy_link_until: string | null; updated_at?: string | null; updated_by?: string | null };
  legacy: { remaining: number; told: number; window_open: boolean; legacy_link_until: string | null };
  can_set: boolean;
};
type Notice = { remaining: number; not_yet_told: number; window_open: boolean; subject: string; text: string; can_send: boolean };
const dmy = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : "");

export function SignInSettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<{ enabled: boolean; customer_signup: boolean; until: string } | null>(null);
  const [reason, setReason] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    void api<Settings>("/staff/auth/settings").then((r) => {
      if (!live) return;
      if (r.ok && r.data) { setS(r.data); setDraft({ enabled: r.data.google.enabled, customer_signup: r.data.google.customer_signup, until: r.data.google.legacy_link_until ?? "" }); }
      setLoaded(true);
    });
    return () => { live = false; };
  }, [tick]);

  if (!loaded) {
    return (
      <div className={`${card} ${css.panel}`} aria-hidden>
        <div className={css.head}><SkelHead sub={false} /></div>
        <SkelText lines={3} />
        <Skel className={css.skelBtn} />
      </div>
    );
  }
  if (!s || !draft) return null;
  const changed = draft.enabled !== s.google.enabled || draft.customer_signup !== s.google.customer_signup || (draft.until || null) !== s.google.legacy_link_until;
  const err = (r: { data: unknown }) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("That did not work - try again.", "Itu tidak berjaya - cuba lagi.");

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await api("/staff/auth/settings", { method: "PUT", body: JSON.stringify({
      /* the window only when it changes (a lapsed date is kept, never re-sent) */
      google: { enabled: draft.enabled, customer_signup: draft.customer_signup, ...((draft.until || null) !== s.google.legacy_link_until ? { legacy_link_until: draft.until || null } : {}) },
      reason, totp,
    }) });
    setBusy(false); setTotp("");
    if (r.ok) { setReason(""); setMsg({ tone: "good", text: L("Saved.", "Disimpan.") }); setNotice(null); setTick((t) => t + 1); }
    else setMsg({ tone: "bad", text: err(r) });
  };
  const preview = async () => {
    setMsg(null);
    const r = await api<Notice>("/staff/auth/legacy-notice", { method: "POST", body: JSON.stringify({}) });
    if (r.ok && r.data) setNotice(r.data); else setMsg({ tone: "bad", text: err(r) });
  };
  const send = async () => {
    setSending(true); setMsg(null);
    const r = await api<{ sent: number; failed: number }>("/staff/auth/legacy-notice", { method: "POST", body: JSON.stringify({ send: true, reason, totp }) });
    setSending(false); setTotp("");
    if (r.ok && r.data) { setReason(""); setMsg({ tone: "good", text: L(`Sent to ${r.data.sent} customer(s)${r.data.failed ? `, ${r.data.failed} could not be sent` : ""}.`, `Dihantar kepada ${r.data.sent} pelanggan${r.data.failed ? `, ${r.data.failed} tidak dapat dihantar` : ""}.`) }); setTick((t) => t + 1); void preview(); }
    else setMsg({ tone: "bad", text: err(r) });
  };
  const proofOk = reason.trim().length >= 5 && /^\d{6}$/.test(totp);

  return (
    <section className={`${card} ${css.panel}`} aria-label={L("Sign-in settings", "Tetapan log masuk")}>
      <div className={css.head}>
        <p className={css.title}>{L("Sign-in settings", "Tetapan log masuk")}</p>
        <span className={s.google.enabled ? chipSuccess : chipWarn}>{s.google.enabled ? L("Google on", "Google hidup") : L("Google off", "Google mati")}</span>
        <span className={s.legacy.window_open ? chipSuccess : chipNeutral}>{s.legacy.window_open ? L(`Legacy window to ${dmy(s.legacy.legacy_link_until)}`, `Tetingkap legasi hingga ${dmy(s.legacy.legacy_link_until)}`) : L("Legacy window closed", "Tetingkap legasi ditutup")}</span>
      </div>
      <p className={css.line}>{L(
        "Password and authenticator sign-in are always on. Google accounts are never linked by email - each person connects their own.",
        "Log masuk dengan kata laluan dan pengesah sentiasa hidup. Akaun Google tidak pernah dipautkan melalui e-mel - setiap orang menyambungkan akaun mereka sendiri.",
      )}{s.google.updated_by ? L(` Last changed by ${s.google.updated_by}.`, ` Terakhir diubah oleh ${s.google.updated_by}.`) : ""}</p>
      {msg && <p className={css.note} data-tone={msg.tone} role="status">{msg.text}</p>}

      <fieldset className={css.panel} disabled={!s.can_set || busy}>
        <label className={css.check}><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />{L("Google sign-in", "Log masuk Google")}</label>
        <label className={css.check}><input type="checkbox" checked={draft.customer_signup} onChange={(e) => setDraft({ ...draft, customer_signup: e.target.checked })} />{L("New customers may sign up with Google", "Pelanggan baharu boleh mendaftar dengan Google")}</label>
        <div className={css.row}>
          <label className={css.field}>
            {L("Legacy link window - last day (empty: closed)", "Tetingkap pautan legasi - hari terakhir (kosong: ditutup)")}
            <input className={inputClass} type="date" value={draft.until} onChange={(e) => setDraft({ ...draft, until: e.target.value })} />
          </label>
          {draft.until && <button type="button" className={btnGhost} onClick={() => setDraft({ ...draft, until: "" })}>{L("Close the window", "Tutup tetingkap")}</button>}
        </div>
      </fieldset>
      <p className={css.line}>{L(
        `${s.legacy.remaining} customer(s) created by Google sign-in before 31-10-2026 still need to sign in with Google once; ${s.legacy.told} told so far. Closing the window never locks anyone out: they are recovered in person.`,
        `${s.legacy.remaining} pelanggan yang dicipta melalui log masuk Google sebelum 31-10-2026 masih perlu log masuk dengan Google sekali; ${s.legacy.told} telah dimaklumkan. Menutup tetingkap tidak pernah mengunci sesiapa: mereka dipulihkan secara bersemuka.`,
      )}</p>

      {s.can_set && (
        <div className={css.row}>
          <label className={`${css.field} ${css.wide}`}>
            {L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}
            <input className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className={css.field}>
            {L("Authenticator code", "Kod pengesah")}
            <input className={`${inputClass} ${css.code}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </label>
          <button type="button" className={btnClass} disabled={busy || !changed || !proofOk} onClick={() => void save()}>{busy ? L("Saving…", "Menyimpan…") : L("Save settings", "Simpan tetapan")}</button>
        </div>
      )}
      {!s.can_set && <p className={css.line}>{L("Only the company owner changes these.", "Hanya pemilik syarikat yang mengubah tetapan ini.")}</p>}

      <div className={css.row}>
        <button type="button" className={btnGhost} onClick={() => void preview()}>{L("Read the legacy notice", "Baca notis legasi")}</button>
        {notice?.can_send && notice.window_open && notice.not_yet_told > 0 && (
          <button type="button" className={btnClass} disabled={sending || !proofOk} onClick={() => void send()}>
            {sending ? L("Sending…", "Menghantar…") : L(`Send to ${notice.not_yet_told} customer(s)`, `Hantar kepada ${notice.not_yet_told} pelanggan`)}
          </button>
        )}
      </div>
      {notice && (
        <>
          {!notice.window_open && <p className={css.line}>{L("Open the window first - the email names its last day.", "Buka tetingkap dahulu - e-mel menyebut hari terakhirnya.")}</p>}
          <pre className={css.letter} aria-label={L("The legacy notice", "Notis legasi")}>{`${notice.subject}\n\n${notice.text}`}</pre>
        </>
      )}
    </section>
  );
}

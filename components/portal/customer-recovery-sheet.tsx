"use client";

/**
 * v1.266.0 - CUSTOMER RECOVERY (Secure Authentication 2.0, Phase 1c;
 * claude/AUTH-2.0-AUDIT.md rev 3 R9, sec. 6.3 row 11). Users -> Customers &
 * Agents, for the company owner and the super admin. A customer who cannot
 * sign in: first record WHO checked their identity and HOW (a WhatsApp video
 * call, the registered company contact, or in person - nothing else is
 * stored), a reason and your authenticator code; then one of:
 *   - a set-password link to the address on file (shown once to hand over if
 *     email sending is not set up);
 *   - disconnect Google (only when they have a password);
 *   - suspend (recovery never lifts a suspension).
 * The login email is never changed here. Three actions a customer a day.
 * The worker decides everything (GET/POST /staff/customer-accounts/:id).
 */

import { useEffect, useState } from "react";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { L, withStepUp } from "@/components/portal/page-shared";
import { api } from "@/lib/api";
import { btnClass, btnSm, chipSmDanger, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm } from "@/lib/ui-styles";
import css from "./account-sheet.module.css";

type Acct = { id: number; name: string; email: string; is_active: boolean; has_password: boolean; google_connected: boolean; email_verified: boolean; legacy: boolean; created_at: string | null };
type Sheet = { account: Acct; history: { action: string; created_at: string; who: string | null }[]; mail_ready: boolean };
type Act = "password-link" | "google-unlink" | "suspend";
const METHODS: [string, string, string][] = [
  ["whatsapp_video", "WhatsApp video call", "Panggilan video WhatsApp"],
  ["registered_contact", "The registered company contact", "Kenalan syarikat yang berdaftar"],
  ["in_person", "In person", "Bersemuka"],
];

export function CustomerRecoverySheet({ userId, open, onClose, onChanged }: { userId: number | null; open: boolean; onClose: () => void; onChanged?: () => void }) {
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();
  const [data, setData] = useState<{ d: Sheet | null; e: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [act, setAct] = useState<{ kind: Act; checked: string; method: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    const c = new AbortController();
    void api<Sheet>(`/staff/customer-accounts/${userId}`, { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setData({ d: r.ok && r.data ? r.data : null, e: r.ok ? "" : ((r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Could not open this customer.", "Tidak dapat membuka pelanggan ini.")) });
    });
    return () => c.abort();
  }, [open, userId, tick]);

  const a = data?.d?.account;
  const run = async () => {
    if (!act || !a) return;
    setBusy(true); setError("");
    const r = await withStepUp<{ error?: { message?: string }; link?: string; emailed?: boolean }>(
      (totp) => api(act.kind === "password-link" ? `/staff/customer-accounts/${a.id}/password-link` : act.kind === "google-unlink" ? `/staff/customer-accounts/${a.id}/google-unlink` : `/staff/customer-accounts/${a.id}/suspend`, { method: "POST", body: JSON.stringify({ reason: act.reason.trim(), identity_checked: act.checked.trim(), identity_method: act.method, ...(totp ? { totp } : {}) }) }),
      prompt, { title: L(`Confirm for ${a.name}`, `Sahkan untuk ${a.name}`), label: L("Your 6-digit authenticator code - this changes how this customer signs in", "Kod pengesah 6 digit anda - ini menukar cara pelanggan ini log masuk") },
    );
    setBusy(false);
    if (!r.ok) { setError(r.data?.error?.message ?? L("The server refused it.", "Pelayan menolaknya.")); return; }
    const done: Record<Act, [string, string]> = {
      "password-link": [r.data?.emailed ? "Set-password link emailed to the address on file" : "Set-password link made - hand it over now, it is shown once", r.data?.emailed ? "Pautan kata laluan dihantar ke alamat dalam rekod" : "Pautan kata laluan dibuat - serahkan sekarang, ia dipaparkan sekali"],
      "google-unlink": ["Google disconnected", "Google diputuskan"],
      suspend: ["Suspended - signed out everywhere", "Digantung - dilog keluar di semua tempat"],
    };
    toast(L("Done", "Selesai"), L(...done[act.kind]));
    if (act.kind === "password-link" && r.data?.link) setLink(r.data.link);
    setAct(null); setTick((n) => n + 1); onChanged?.();
  };
  const ready = !!act && act.checked.trim().length >= 3 && !!act.method && act.reason.trim().length >= 10;
  const label: Record<Act, [string, string]> = {
    "password-link": ["Send a set-password link", "Hantar pautan tetapkan kata laluan"],
    "google-unlink": ["Disconnect Google", "Putuskan Google"],
    suspend: ["Suspend", "Gantung"],
  };

  return (
    <SideDrawer open={open} onClose={() => { setAct(null); setLink(null); setError(""); onClose(); }} wide
      title={a ? a.name : L("Customer recovery", "Pemulihan pelanggan")}
      subtitle={a ? `${L("Customer", "Pelanggan")} #${a.id} · ${a.email}` : undefined}>
      {toastNode}{promptNode}
      {data?.e ? <p role="alert" className={css.error}>{data.e}</p> : !a ? <SkelRows rows={6} /> : (
        <div className={css.sheet}>
          <div className={css.chips}>
            <span className={a.is_active ? chipSmSuccess : chipSmDanger}>{a.is_active ? L("Active", "Aktif") : L("Suspended", "Digantung")}</span>
            <span className={chipSmNeutral}>{a.has_password ? L("Email + password", "E-mel + kata laluan") : L("Google only", "Google sahaja")}</span>
            {a.google_connected ? <span className={chipSmSuccess}>{L("Google connected", "Google disambungkan")}</span> : a.legacy ? <span className={chipSmWarn}>{L("Legacy Google customer - not yet linked", "Pelanggan Google legasi - belum dipautkan")}</span> : null}
            <span className={a.email_verified ? chipSmSuccess : chipSmNeutral}>{a.email_verified ? L("Address proven", "Alamat dibuktikan") : L("Address not proven", "Alamat belum dibuktikan")}</span>
          </div>

          {link && (
            <div className={css.linkBox} role="status">
              <p><strong>{L("Hand this link to the customer now (WhatsApp or in person). It works once, for 24 hours, and is not shown again.", "Serahkan pautan ini kepada pelanggan sekarang (WhatsApp atau bersemuka). Ia berfungsi sekali, selama 24 jam, dan tidak dipaparkan lagi.")}</strong></p>
              <input className={inputClassSm} value={link} readOnly aria-label={L("Set-password link", "Pautan tetapkan kata laluan")} />
            </div>
          )}

          <section className={css.block} aria-label={L("Recover access", "Pulihkan akses")}>
            <p className={css.label}>{L("Recover access", "Pulihkan akses")}</p>
            <p className={css.muted}>{L("First check who they are - never by email alone. The login email is never changed here; three actions a customer a day.", "Semak dahulu siapa mereka - jangan melalui e-mel sahaja. E-mel log masuk tidak ditukar di sini; tiga tindakan bagi setiap pelanggan sehari.")}</p>
            {!act && (
              <div className={css.actions}>
                <button type="button" className={btnSm} disabled={!a.is_active} onClick={() => { setError(""); setAct({ kind: "password-link", checked: "", method: "", reason: "" }); }}>{L(...label["password-link"])}</button>
                <button type="button" className={btnSm} disabled={!a.google_connected || !a.has_password} onClick={() => { setError(""); setAct({ kind: "google-unlink", checked: "", method: "", reason: "" }); }}>{L(...label["google-unlink"])}</button>
                <button type="button" className={btnSm} disabled={!a.is_active} onClick={() => { setError(""); setAct({ kind: "suspend", checked: "", method: "", reason: "" }); }}>{L(...label.suspend)}</button>
              </div>
            )}
            {!act && a.google_connected && !a.has_password && <p className={css.muted}>{L("Google is their only way in: send a set-password link first, then Google can be disconnected.", "Google ialah satu-satunya cara mereka masuk: hantar pautan kata laluan dahulu, kemudian Google boleh diputuskan.")}</p>}
            {act && (
              <fieldset className={css.form} disabled={busy}>
                <p className={css.label}>{L(...label[act.kind])}</p>
                <label>{L("Who checked their identity", "Siapa yang menyemak identiti mereka")}<input className={inputClassSm} value={act.checked} maxLength={120} onChange={(e) => setAct({ ...act, checked: e.target.value })} /></label>
                <div role="radiogroup" aria-label={L("How the identity was checked", "Cara identiti disemak")} className={css.routes}>
                  {METHODS.map(([v, en, ms]) => (
                    <label key={v} className={css.radio}>
                      <input type="radio" name="idm" value={v} checked={act.method === v} onChange={() => setAct({ ...act, method: v })} />
                      <span><strong>{L(en, ms)}</strong></span>
                    </label>
                  ))}
                </div>
                <label>{L("Reason (at least 10 characters, kept in the audit history)", "Sebab (sekurang-kurangnya 10 aksara, disimpan dalam sejarah audit)")}<input className={inputClassSm} value={act.reason} maxLength={300} onChange={(e) => setAct({ ...act, reason: e.target.value })} /></label>
                {act.kind === "password-link" && !data?.d?.mail_ready && <p className={css.warnText}>{L("Email sending is not set up: the link is shown here once, to hand over yourself.", "Penghantaran e-mel belum disediakan: pautan dipaparkan di sini sekali, untuk anda serahkan sendiri.")}</p>}
                {error && <p role="alert" className={css.error}>{error}</p>}
                <div className={css.row}>
                  <button type="button" className={btnClass} disabled={!ready || busy} onClick={() => void run()}>{L(...label[act.kind])}</button>
                  <button type="button" className={btnSm} onClick={() => { setAct(null); setError(""); }}>{L("Cancel", "Batal")}</button>
                </div>
              </fieldset>
            )}
          </section>

          <section className={css.block} aria-label={L("Sign-in history", "Sejarah log masuk")}>
            <p className={css.label}>{L("Sign-in history", "Sejarah log masuk")}</p>
            {data!.d!.history.length === 0 ? <p className={css.muted}>{L("Nothing recorded yet.", "Belum ada rekod.")}</p> : (
              <ul className={css.list}>
                {data!.d!.history.map((h, i) => <li key={i}><strong>{h.action.replace(/^(auth|user)\./, "").replace(/_/g, " ")}</strong> <span className={css.muted}>· {h.created_at}{h.who ? ` · ${h.who}` : ""}</span></li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </SideDrawer>
  );
}

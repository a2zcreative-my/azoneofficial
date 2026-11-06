"use client";

/**
 * v1.269.0 - PASSKEYS (Secure Authentication 2.0, Phase 2A). Profile ->
 * Security. Stage A: the company owner's account only, and only after the
 * owner switches passkeys on (Sign-in settings). Adding one needs a fresh
 * authenticator code; the device then asks for Face ID, a fingerprint or its
 * PIN. Removing one needs a fresh code too, ends the devices it signed in,
 * and is kept in the history. The worker (worker/src/passkeys.ts) decides
 * every rule; this panel only shows them.
 */

import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { card, btnClass, btnGhost, btnSmQuiet, btnSmDanger, inputClass, chipSuccess, chipNeutral } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import { Skel, SkelHead, SkelText } from "@/components/ui/skeleton";
import { createPasskey, passkeysSupported, cancelled, type CreateOptionsJSON } from "@/lib/passkey";
import css from "./google-connect-panel.module.css";
import pk from "./passkeys-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Passkey = { id: number; name: string; created_at: string; last_used_at: string | null; synced: boolean; transports: string[] };
type State = { stage: "off" | "A"; can_add: boolean; eligible: boolean; limit: number; this_session: number | null; passkeys: Passkey[]; removed: { id: number; name: string; revoked_at: string; revoked_reason: string | null }[] };
const dmy = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : "");
const errOf = (r: { data: unknown }) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("That did not work - try again.", "Itu tidak berjaya - cuba lagi.");

export function PasskeysPanel() {
  const [s, setS] = useState<State | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [totp, setTotp] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    void api<State>("/auth/passkeys").then((r) => {
      if (!live) return;
      setS(r.ok && r.data ? r.data : null);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [tick]);

  if (!loaded) {
    return (
      <div className={`${card} ${css.panel}`} aria-hidden>
        <div className={css.head}><SkelHead sub={false} /></div>
        <SkelText lines={2} />
        <Skel className={css.skelBtn} />
      </div>
    );
  }
  /* nothing to show to anyone who has none and cannot add one */
  if (!s || (!s.eligible && s.passkeys.length === 0)) return null;
  const supported = passkeysSupported();
  const codeOk = /^\d{6}$/.test(totp);

  const add = async () => {
    setBusy(true); setMsg(null);
    const o = await api<{ publicKey: CreateOptionsJSON }>("/auth/passkey/register/options", { method: "POST", body: JSON.stringify({ totp }) });
    setTotp("");
    if (!o.ok || !o.data) { setBusy(false); setMsg({ tone: "bad", text: errOf(o) }); return; }
    let credential: Record<string, unknown>;
    try { credential = await createPasskey(o.data.publicKey); } catch (e) {
      setBusy(false);
      setMsg({ tone: "bad", text: cancelled(e) ? L("No passkey was added.", "Tiada kunci laluan ditambah.") : L("This device could not create a passkey.", "Peranti ini tidak dapat mencipta kunci laluan.") });
      return;
    }
    const v = await api<{ name: string }>("/auth/passkey/register/verify", { method: "POST", body: JSON.stringify({ credential, name: name.trim() }) });
    setBusy(false);
    if (v.ok) { setName(""); setMsg({ tone: "good", text: L(`Passkey "${v.data?.name ?? ""}" added.`, `Kunci laluan "${v.data?.name ?? ""}" ditambah.`) }); setTick((t) => t + 1); }
    else setMsg({ tone: "bad", text: errOf(v) });
  };
  const remove = async (id: number) => {
    setBusy(true); setMsg(null);
    const r = await api<{ sessions_ended: number }>(`/auth/passkeys/${id}/remove`, { method: "POST", body: JSON.stringify({ totp }) });
    setBusy(false); setTotp("");
    if (r.ok) {
      setRemoving(null);
      if (s.this_session === id) { window.location.replace("/login"); return; }
      setMsg({ tone: "good", text: L("Passkey removed.", "Kunci laluan dibuang.") }); setTick((t) => t + 1);
    } else setMsg({ tone: "bad", text: errOf(r) });
  };
  const rename = async () => {
    if (!renaming) return;
    setBusy(true); setMsg(null);
    const r = await api(`/auth/passkeys/${renaming.id}/rename`, { method: "POST", body: JSON.stringify({ name: renaming.name }) });
    setBusy(false);
    if (r.ok) { setRenaming(null); setTick((t) => t + 1); } else setMsg({ tone: "bad", text: errOf(r) });
  };
  const codeField = (
    <label className={css.field}>
      {L("Authenticator code", "Kod pengesah")}
      <input className={`${inputClass} ${css.code}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
    </label>
  );

  return (
    <section className={`${card} ${css.panel}`} aria-label={L("Passkeys", "Kunci laluan")}>
      <div className={css.head}>
        <p className={css.title}>{L("Passkeys", "Kunci laluan")}</p>
        <span className={s.stage === "A" ? chipSuccess : chipNeutral}>{s.stage === "A" ? L("On - owner only", "Hidup - pemilik sahaja") : L("Switched off", "Dimatikan")}</span>
      </div>
      <p className={css.line}>{L(
        "Sign in with Face ID, a fingerprint or your device PIN instead of typing a password and code. Your password and authenticator keep working.",
        "Log masuk dengan Face ID, cap jari atau PIN peranti dan bukannya menaip kata laluan dan kod. Kata laluan dan pengesah anda terus berfungsi.",
      )}</p>
      {msg && <p className={css.note} data-tone={msg.tone} role="status">{msg.text}</p>}

      {s.passkeys.length > 0 && (
        <ul className={pk.list} aria-label={L("Your passkeys", "Kunci laluan anda")}>
          {s.passkeys.map((p) => (
            <li key={p.id} className={pk.item}>
              {renaming?.id === p.id ? (
                <div className={`${css.row} ${pk.full}`}>
                  <input className={inputClass} aria-label={L("Passkey name", "Nama kunci laluan")} maxLength={60} value={renaming.name} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} />
                  <button type="button" className={btnSmQuiet} disabled={busy || !renaming.name.trim()} onClick={() => void rename()}>{L("Save", "Simpan")}</button>
                  <button type="button" className={btnSmQuiet} onClick={() => setRenaming(null)}>{L("Cancel", "Batal")}</button>
                </div>
              ) : (
                <>
                  <div className={pk.what}>
                    <p className={pk.name}>{p.name}{s.this_session === p.id ? L(" (this device)", " (peranti ini)") : ""}</p>
                    <p className={css.line}>{L(`Added ${dmy(p.created_at)}`, `Ditambah ${dmy(p.created_at)}`)}{p.last_used_at ? L(` - last used ${dmy(p.last_used_at)}`, ` - terakhir digunakan ${dmy(p.last_used_at)}`) : L(" - not used yet", " - belum digunakan")}{p.synced ? L(" - synced to your account's devices", " - diselaraskan ke peranti akaun anda") : ""}</p>
                  </div>
                  <div className={pk.actions}>
                    <button type="button" className={btnSmQuiet} onClick={() => setRenaming({ id: p.id, name: p.name })}>{L("Rename", "Namakan semula")}</button>
                    <button type="button" className={btnSmDanger} onClick={() => { setRemoving(p.id); setTotp(""); }}>{L("Remove", "Buang")}</button>
                  </div>
                </>
              )}
              {removing === p.id && (
                <div className={`${css.row} ${pk.full}`}>
                  <p className={css.line}>{L("Removing it signs out every device it signed in. It stays in your history.", "Membuangnya melog keluar setiap peranti yang dilog masuk olehnya. Ia kekal dalam sejarah anda.")}</p>
                  {codeField}
                  <button type="button" className={btnSmDanger} disabled={busy || !codeOk} onClick={() => void remove(p.id)}>{L("Remove passkey", "Buang kunci laluan")}</button>
                  <button type="button" className={btnSmQuiet} onClick={() => setRemoving(null)}>{L("Keep it", "Simpan")}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {s.stage !== "A" && s.eligible && <p className={css.line}>{L("Passkeys are built but switched off. Turn them on in Sign-in settings once the recovery panel is ready.", "Kunci laluan telah dibina tetapi dimatikan. Hidupkannya dalam Tetapan log masuk apabila panel pemulihan sedia.")}</p>}
      {s.can_add && !supported && <p className={css.line}>{L("This browser does not offer passkeys.", "Pelayar ini tidak menawarkan kunci laluan.")}</p>}
      {s.can_add && supported && removing === null && (
        <div className={css.row}>
          <label className={`${css.field} ${css.wide}`}>
            {L("Name (e.g. iPhone 15, office laptop)", "Nama (cth. iPhone 15, komputer riba pejabat)")}
            <input className={inputClass} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {codeField}
          <button type="button" className={btnClass} disabled={busy || !codeOk} onClick={() => void add()}>{busy ? L("Waiting for your device…", "Menunggu peranti anda…") : L("Add a passkey", "Tambah kunci laluan")}</button>
        </div>
      )}
      {s.passkeys.length >= s.limit && <p className={css.line}>{L(`You have the most passkeys allowed (${s.limit}).`, `Anda mempunyai jumlah maksimum kunci laluan (${s.limit}).`)}</p>}

      {s.removed.length > 0 && (
        <details className={pk.history}>
          <summary className={btnGhost}>{L(`Removed passkeys (${s.removed.length})`, `Kunci laluan dibuang (${s.removed.length})`)}</summary>
          <ul className={pk.list}>
            {s.removed.map((r) => (
              <li key={r.id} className={pk.item}><p className={css.line}>{r.name} - {L("removed", "dibuang")} {dmy(r.revoked_at)}{r.revoked_reason ? ` (${r.revoked_reason})` : ""}</p></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

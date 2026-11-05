"use client";

/**
 * v1.265.0 - CONNECTED GOOGLE ACCOUNT (Secure Authentication 2.0, Phase 1b;
 * claude/AUTH-2.0-AUDIT.md rev 3 sec. 3.3). Profile -> Security, the admin
 * console's Account tab and (v1.266.0, Phase 1c) the customer account page.
 *
 * Since 1.264.0 Google is never attached to an account because an email
 * matches. Here the person connects their own Google account, signed in:
 *   staff     with their authenticator code;
 *   customer  with their password and a six-digit code emailed to them.
 * The worker sends them to Google with PKCE and a nonce, and on the way back
 * links the Google account ONLY into the same signed-in session's account.
 * v1.266.0 (R8): they can also disconnect it themselves while another
 * verified way in remains (staff: a password and two-factor; customers: a
 * password). The page never sees a Google id.
 */

import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { card, btnClass, btnGhost, inputClass, chipSuccess, chipNeutral } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import { Skel, SkelHead, SkelText } from "@/components/ui/skeleton";
import css from "./google-connect-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type GStatus = { linked: boolean; proof?: "totp" | "password_email" | "password_google"; can_connect: boolean; can_disconnect?: boolean; why?: string | null };
type Status = { enabled: boolean; google?: GStatus };
type Action = "connect" | "disconnect";

/* what the worker's callback says when it sends the person back */
const OUTCOME: Record<string, { tone: "good" | "bad"; en: string; ms: string }> = {
  connected: { tone: "good", en: "Google is connected. Next time you can sign in with Google.", ms: "Google telah disambungkan. Lain kali anda boleh log masuk dengan Google." },
  already: { tone: "good", en: "That Google account was already connected to your account.", ms: "Akaun Google itu sudah disambungkan ke akaun anda." },
  refused: { tone: "bad", en: "That Google account could not be connected - it may belong to another A2Z account, or (when you confirmed with your password only) it is not this account's own Gmail address. Nothing was changed.", ms: "Akaun Google itu tidak dapat disambungkan - ia mungkin milik akaun A2Z lain, atau (jika anda sahkan dengan kata laluan sahaja) ia bukan alamat Gmail akaun ini. Tiada apa-apa diubah." },
  failed: { tone: "bad", en: "Google did not confirm the connection, so nothing was changed. Try again from this page.", ms: "Google tidak mengesahkan sambungan, jadi tiada apa-apa diubah. Cuba lagi dari halaman ini." },
  off: { tone: "bad", en: "Google sign-in is switched off for now. Nothing was changed.", ms: "Log masuk Google dimatikan buat masa ini. Tiada apa-apa diubah." },
  disconnected: { tone: "good", en: "Google is disconnected. Sign in with your email and password from now on.", ms: "Google telah diputuskan. Log masuk dengan e-mel dan kata laluan anda mulai sekarang." },
};

const WHY: Record<string, [string, string]> = {
  twofa_off: ["Turn on two-factor above first - Google is connected with your authenticator code.", "Aktifkan dua faktor di atas dahulu - Google disambungkan dengan kod pengesah anda."],
  google_off: ["Google sign-in is switched off for now.", "Log masuk Google dimatikan buat masa ini."],
  google_only: ["Google is your only way to sign in, so it stays connected. To change that, contact A2Z Creative Marketing.", "Google ialah satu-satunya cara anda log masuk, jadi ia kekal disambungkan. Untuk mengubahnya, hubungi A2Z Creative Marketing."],
  mail_unavailable: ["This cannot be done online yet. Contact A2Z Creative Marketing.", "Ini belum boleh dilakukan dalam talian. Hubungi A2Z Creative Marketing."],
};

export function GoogleConnectPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState(""); // a customer's code went to this (masked) address
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void api<Status>("/auth/2fa/status").then((r) => { if (!live) return; if (r.ok && r.data) setStatus(r.data); setLoaded(true); });
    return () => { live = false; };
  }, [tick]);
  useEffect(() => {
    /* the answer from Google's round trip, read once and taken off the address */
    const u = new URL(window.location.href);
    const g = u.searchParams.get("google");
    if (g) {
      /* after this frame, so the page around it (Profile, the admin console)
         has read the same answer and opened the right tab first */
      requestAnimationFrame(() => {
        u.searchParams.delete("google");
        window.history.replaceState(null, "", u.pathname + (u.search ? u.search : "") + u.hash);
        setOutcome(OUTCOME[g] ? g : "failed");
      });
    }
  }, []);

  /* the real card's shape until the answer lands: title and pill, two lines, one button */
  if (!loaded) {
    return (
      <div className={`${card} ${css.panel}`} aria-hidden>
        <div className={css.head}><SkelHead sub={false} /><Skel className={css.skelPill} /></div>
        <SkelText lines={2} />
        <Skel className={css.skelBtn} />
      </div>
    );
  }
  if (!status?.google) return null;
  const g = status.google;
  const customer = g.proof === "password_email" || g.proof === "password_google";
  /* v1.267.0 - no email sending yet, a Gmail address: the password now, then
     a Google account with this same address (the worker checks it) */
  const viaGoogle = g.proof === "password_google" && action === "connect";
  const msg = (r: { data: unknown }) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("That did not work - try again.", "Itu tidak berjaya - cuba lagi.");

  const reset = () => { setAction(null); setCode(""); setPassword(""); setSentTo(""); setErr(""); setBusy(false); };
  const open = (a: Action) => { reset(); setOutcome(null); setAction(a); };

  const connectWithPassword = async () => {
    setErr(""); setBusy(true);
    const r = await api<{ url?: string }>("/auth/google/connect", { method: "POST", body: JSON.stringify({ password }) });
    setPassword("");
    if (r.ok && r.data?.url) { window.location.assign(r.data.url); return; } // to Google; it comes back here
    setBusy(false); setErr(msg(r));
  };
  /* a customer's first step: the password, which emails the code */
  const askCode = async () => {
    setErr(""); setBusy(true);
    const r = await api<{ sent?: boolean; to?: string }>("/auth/google/code", { method: "POST", body: JSON.stringify({ purpose: action, password }) });
    setPassword(""); setBusy(false);
    if (r.ok && r.data?.sent) setSentTo(r.data.to ?? "");
    else setErr(msg(r));
  };
  const finish = async () => {
    setErr(""); setBusy(true);
    const proof = customer ? { code } : { totp: code };
    if (action === "connect") {
      const r = await api<{ url?: string }>("/auth/google/connect", {
        method: "POST",
        body: JSON.stringify(customer ? proof : { ...proof, return_to: window.location.pathname.startsWith("/admin") ? "admin" : "portal" }),
      });
      setCode("");
      if (r.ok && r.data?.url) { window.location.assign(r.data.url); return; } // to Google; it comes back here
      setBusy(false); setErr(msg(r));
      return;
    }
    const r = await api<{ ok?: boolean }>("/auth/google/disconnect", { method: "POST", body: JSON.stringify(proof) });
    setCode("");
    if (r.ok) { reset(); setOutcome("disconnected"); setTick((t) => t + 1); return; }
    setBusy(false); setErr(msg(r));
  };

  const codeField = (label: string) => (
    <label className={css.field}>
      {label}
      <input className={`${inputClass} ${css.code}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus />
    </label>
  );
  const go = action === "connect" ? L("Continue to Google", "Teruskan ke Google") : L("Disconnect Google", "Putuskan Google");

  const o = outcome ? OUTCOME[outcome] : null;
  return (
    <section className={`${card} ${css.panel}`} aria-label={L("Connected Google account", "Akaun Google yang disambungkan")}>
      <div className={css.head}>
        <p className={css.title}>{L("Connected Google account", "Akaun Google yang disambungkan")}</p>
        <span className={g.linked ? chipSuccess : chipNeutral}>{g.linked ? L("Connected", "Disambungkan") : L("Not connected", "Tidak disambungkan")}</span>
      </div>
      {o && <p className={css.note} data-tone={o.tone} role="status">{L(o.en, o.ms)}</p>}
      <p className={css.line}>{g.linked
        ? customer
          ? L("You can sign in with Google.", "Anda boleh log masuk dengan Google.")
          : L("You can sign in with Google. Your authenticator code is still asked for.", "Anda boleh log masuk dengan Google. Kod pengesah anda masih diminta.")
        : g.proof === "password_google"
          ? L("Sign in with Google next time. You confirm with your password, then choose the Google account with this same Gmail address - another Google account is refused. Only that Google account is connected, and only to you.", "Log masuk dengan Google lain kali. Anda sahkan dengan kata laluan, kemudian pilih akaun Google dengan alamat Gmail yang sama ini - akaun Google lain ditolak. Hanya akaun Google itu disambungkan, dan hanya kepada anda.")
        : customer
          ? L("Sign in with Google next time. You confirm with your password and a code we email you, then choose your Google account. Only that Google account is connected, and only to you.", "Log masuk dengan Google lain kali. Anda sahkan dengan kata laluan dan kod yang kami e-melkan, kemudian pilih akaun Google anda. Hanya akaun Google itu disambungkan, dan hanya kepada anda.")
          : L("Sign in with Google next time. You confirm with your authenticator code, then choose your Google account. Only that Google account is connected, and only to you.", "Log masuk dengan Google lain kali. Anda sahkan dengan kod pengesah, kemudian pilih akaun Google anda. Hanya akaun Google itu disambungkan, dan hanya kepada anda.")}</p>

      {!action && (g.linked ? g.can_disconnect : g.can_connect) && (
        <div className={css.row}>
          <button type="button" className={g.linked ? btnGhost : btnClass} onClick={() => open(g.linked ? "disconnect" : "connect")}>
            {g.linked ? L("Disconnect Google", "Putuskan Google") : L("Connect Google", "Sambungkan Google")}
          </button>
        </div>
      )}
      {!action && !(g.linked ? g.can_disconnect : g.can_connect) && g.why && WHY[g.why] && <p className={css.line}>{L(...WHY[g.why]!)}</p>}

      {action && customer && !sentTo && (
        <form className={css.row} onSubmit={(e) => { e.preventDefault(); if (!busy && password) void (viaGoogle ? connectWithPassword() : askCode()); }}>
          <label className={css.field}>
            {L("Your password", "Kata laluan anda")}
            <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <button type="submit" className={btnClass} disabled={busy || !password}>{viaGoogle
            ? (busy ? L("Opening Google…", "Membuka Google…") : L("Continue to Google", "Teruskan ke Google"))
            : (busy ? L("Sending…", "Menghantar…") : L("Email me a code", "E-melkan kod kepada saya"))}</button>
          <button type="button" className={btnGhost} onClick={reset}>{L("Cancel", "Batal")}</button>
        </form>
      )}
      {action && (!customer || sentTo) && (
        <form className={css.row} onSubmit={(e) => { e.preventDefault(); if (!busy && /^\d{6}$/.test(code)) void finish(); }}>
          {customer && <p className={css.line}>{L(`We emailed a 6-digit code to ${sentTo}. It works for 10 minutes, in this browser.`, `Kami telah e-melkan kod 6 digit ke ${sentTo}. Ia sah selama 10 minit, dalam pelayar ini.`)}</p>}
          {codeField(customer ? L("Code from the email", "Kod daripada e-mel") : L("Authenticator code", "Kod pengesah"))}
          <button type="submit" className={btnClass} disabled={busy || !/^\d{6}$/.test(code)}>{busy ? L("Working…", "Sedang diproses…") : go}</button>
          <button type="button" className={btnGhost} onClick={reset}>{L("Cancel", "Batal")}</button>
        </form>
      )}
      {err && <p className={css.error} role="alert">{err}</p>}
    </section>
  );
}

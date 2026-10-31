"use client";

/* v1.238.0 - THE TWO SINGLE-USE LINK PAGES (the owner, 31-10-2026; claude/
   ACCOUNT-RECOVERY-AUDIT.md: "Send a single-use, time-limited verification
   link ... Never send plaintext passwords to staff").

   /verify-email  confirms a new login email (POST /auth/email-verify)
   /set-password  lets the person choose their own password (POST
                  /auth/set-password) - nobody else ever knows it

   The token rides in the URL FRAGMENT (#token=...), which a browser never
   sends to a server, so it is in no request line and no access log; the page
   reads it, clears it from the address bar, and posts it in a body. Both
   requests go without cookies: a link works the same signed in or out, and a
   session in this browser has no say in it. Nothing is claimed until the
   server has answered. */

import Link from "next/link";
import { type FormEvent, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { btnClassBlock, inputClassLg } from "@/lib/ui-styles";
import css from "./link-page.module.css";

const tr = () => { const ms = getLang() === "ms"; return (en: string, m: string) => (ms ? m : en); };

/** Read #token=... once and take it off the address bar. Read as an
    external store: undefined while prerendering, then the token or null. */
let LINK_TOKEN: string | null | undefined;
function readLinkToken(): string | null {
  if (LINK_TOKEN === undefined) {
    const m = /(?:^|[#&])token=([0-9a-f]{64})(?:&|$)/.exec(window.location.hash);
    const q = /[?&]token=([0-9a-f]{64})(?:&|$)/.exec(window.location.search); // an older link
    LINK_TOKEN = m?.[1] ?? q?.[1] ?? null;
  }
  return LINK_TOKEN;
}
const noSubscribe = () => () => {};
export function useLinkToken(): string | null | undefined {
  const tok = useSyncExternalStore(noSubscribe, readLinkToken, () => undefined);
  useEffect(() => {
    if (tok && (window.location.hash || window.location.search)) window.history.replaceState(null, "", window.location.pathname);
  }, [tok]);
  return tok;
}

export async function postLink<T>(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: (T & { error?: { message?: string } }) | null }> {
  /* the shared helper (CSRF header when a session cookie exists), with the
     cookies left behind: credentials "omit" overrides its "include" */
  return api<T & { error?: { message?: string } }>(path, { method: "POST", credentials: "omit", body: JSON.stringify(body) });
}

export function LinkCard({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  const L = tr();
  return (
    <main className={css.page}>
      <section className={css.card} aria-labelledby="link-title">
        <Link href="/" aria-label="A2Z CREATIVE MARKETING">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="A2Z CREATIVE MARKETING" className={css.logo} />
        </Link>
        <span className={css.rule} aria-hidden="true" />
        <h1 id="link-title" className={css.title}>{title}</h1>
        {lede && <p className={css.lede}>{lede}</p>}
        {children}
        <p className={css.foot}><Link href="/login">{L("Go to sign in", "Pergi ke log masuk")}</Link></p>
      </section>
    </main>
  );
}

export function Note({ kind, children }: { kind: "ok" | "error"; children: ReactNode }) {
  return <p role={kind === "error" ? "alert" : "status"} className={kind === "ok" ? css.ok : css.error}>{children}</p>;
}

const NO_NET: [string, string] = ["No connection - nothing changed. Try the link again when you are online.", "Tiada sambungan - tiada apa berubah. Cuba pautan sekali lagi apabila dalam talian."];
const BAD: [string, string] = ["This link is not valid any more - it was used, it expired, or it was replaced. Ask A2Z for a new one.", "Pautan ini tidak sah lagi - ia telah digunakan, tamat tempoh, atau diganti. Minta pautan baharu daripada A2Z."];

export function VerifyEmail() {
  const L = tr();
  const tok = useLinkToken();
  const [state, setState] = useState<{ busy: boolean; done: string | null; error: string }>({ busy: false, done: null, error: "" });
  const confirm = async () => {
    if (!tok) return;
    setState({ busy: true, done: null, error: "" });
    const r = await postLink<{ email?: string }>("/auth/email-verify", { token: tok });
    if (r.ok && r.data?.email) setState({ busy: false, done: r.data.email, error: "" });
    else setState({ busy: false, done: null, error: r.status === 0 ? L(...NO_NET) : (r.data?.error?.message ?? L(...BAD)) });
  };
  return (
    <LinkCard title={L("Confirm your new login email", "Sahkan e-mel log masuk baharu anda")}
      lede={state.done ? undefined : L("Press Confirm to make this address the login email of your A2Z OS account. Your account, records and permissions stay exactly as they are.", "Tekan Sahkan untuk menjadikan alamat ini e-mel log masuk akaun A2Z OS anda. Akaun, rekod dan kebenaran anda kekal seperti sedia ada.")}>
      {tok === undefined ? null : tok === null ? <Note kind="error">{L(...BAD)}</Note> : state.done ? (
        <Note kind="ok">{L(`Done. Your login email is now ${state.done}. You were signed out everywhere - sign in again with the new address.`, `Selesai. E-mel log masuk anda kini ${state.done}. Anda telah dilog keluar di semua peranti - log masuk semula dengan alamat baharu.`)}</Note>
      ) : (
        <div className={css.form}>
          {state.error && <Note kind="error">{state.error}</Note>}
          <button type="button" className={btnClassBlock} disabled={state.busy} onClick={() => void confirm()}>
            {state.busy ? L("Confirming…", "Mengesahkan…") : L("Confirm", "Sahkan")}
          </button>
          <p className={css.hint}>{L("Did not ask for this? Close this page - nothing changes.", "Tidak meminta ini? Tutup halaman ini - tiada apa berubah.")}</p>
        </div>
      )}
    </LinkCard>
  );
}

export function SetPassword() {
  const L = tr();
  const tok = useLinkToken();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [state, setState] = useState<{ busy: boolean; done: boolean; error: string }>({ busy: false, done: false, error: "" });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!tok) return;
    if (pw.length < 10) { setState({ busy: false, done: false, error: L("Choose at least 10 characters.", "Pilih sekurang-kurangnya 10 aksara.") }); return; }
    if (pw !== pw2) { setState({ busy: false, done: false, error: L("The two passwords are not the same.", "Kedua-dua kata laluan tidak sama.") }); return; }
    setState({ busy: true, done: false, error: "" });
    const r = await postLink<{ ok?: boolean }>("/auth/set-password", { token: tok, password: pw });
    if (r.ok) { setPw(""); setPw2(""); setState({ busy: false, done: true, error: "" }); }
    else setState({ busy: false, done: false, error: r.status === 0 ? L(...NO_NET) : (r.data?.error?.message ?? L(...BAD)) });
  };
  return (
    <LinkCard title={L("Choose your password", "Pilih kata laluan anda")}
      lede={state.done ? undefined : L("Only you will know it - nobody at A2Z can see it. Your authenticator stays as it is.", "Hanya anda yang tahu - tiada sesiapa di A2Z boleh melihatnya. Pengesah anda kekal seperti sedia ada.")}>
      {tok === undefined ? null : tok === null ? <Note kind="error">{L(...BAD)}</Note> : state.done ? (
        <Note kind="ok">{L("Your password is set. You were signed out everywhere - sign in with it now.", "Kata laluan anda telah ditetapkan. Anda telah dilog keluar di semua peranti - log masuk dengannya sekarang.")}</Note>
      ) : (
        <form className={css.form} onSubmit={(e) => void save(e)}>
          <div className={css.field}>
            <label htmlFor="pw1">{L("New password", "Kata laluan baharu")}</label>
            <input id="pw1" type="password" autoComplete="new-password" className={inputClassLg} value={pw} minLength={10} maxLength={200} required onChange={(e) => setPw(e.target.value)} />
            <p className={css.hint}>{L("At least 10 characters.", "Sekurang-kurangnya 10 aksara.")}</p>
          </div>
          <div className={css.field}>
            <label htmlFor="pw2">{L("Type it again", "Taip sekali lagi")}</label>
            <input id="pw2" type="password" autoComplete="new-password" className={inputClassLg} value={pw2} minLength={10} maxLength={200} required onChange={(e) => setPw2(e.target.value)} />
          </div>
          {state.error && <Note kind="error">{state.error}</Note>}
          <button type="submit" className={btnClassBlock} disabled={state.busy}>
            {state.busy ? L("Saving…", "Menyimpan…") : L("Set password", "Tetapkan kata laluan")}
          </button>
        </form>
      )}
    </LinkCard>
  );
}

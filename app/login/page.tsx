"use client";

/**
 * General login (/login) — one door for everyone, into A2Z CREATIVE
 * MARKETING's portals. After sign-in, people are routed by role:
 *   customer -> /account · staff roles -> /portal · CMS roles -> /admin
 *
 * v1.27.0 — the page is bilingual now. It was the last monolingual surface in
 * the whole authenticated app, which meant a BM-speaking staff member met
 * English at the one screen she cannot skip. The language comes from the
 * device (localStorage azone-lang) via state rather than a module-scope
 * getLang() read: /login is part of the STATIC EXPORT, so a direct read would
 * render "en" into login.html and "ms" on the client and break hydration.
 * Same shape as /account.
 */

import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import Link from "next/link";
import { useEffect, useState } from "react";
import { getLang, type Lang } from "@/lib/i18n";
import { inputClass, btnClassBlock as btnClass } from "@/lib/ui-styles";
import { APP_VERSION } from "@/lib/version";

const API = "/api/v1";

interface User { id: number; email: string; name: string; role: string }

// Roles whose workplace is the staff portal. Content roles (admin, editor,
// marketing) work in /admin; everyone here goes to /portal. Keep in sync with
// PORTAL_ROLES in app/admin/page.tsx and the Worker's login destination.
// Everyone except super_admin/admin (→ /admin) and customer (→ /account)
// works in /portal. editor & marketing are now portal roles too.
const STAFF_ONLY = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco"];

function destinationFor(role: string): string {
  if (role === "customer") return "/account";
  if (STAFF_ONLY.includes(role)) return "/portal";
  return "/admin";
}




export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { setLangState(getLang()); }, []);
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);

  const verifyCode = async () => {
    setBusy(true);
    setError("");
    const res = await api<{ user: User }>("/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge, code }),
    });
    setBusy(false);
    if (res.ok && res.data?.user) {
      window.location.replace(destinationFor(res.data.user.role));
    } else if (res.status === 429) {
      setError(L("Too many attempts — try again in 15 minutes.", "Terlalu banyak percubaan — cuba lagi dalam 15 minit."));
    } else {
      setError(L(
        "That code is not correct. Check your authenticator app, or use a backup code.",
        "Kod itu tidak betul. Semak aplikasi pengesah anda, atau gunakan kod sandaran.",
      ));
    }
  };
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    /* v1.23.1: Google sign-in with 2FA enabled no longer mints a session —
       the callback drops a 5-minute challenge cookie and lands here with
       ?2fa=1. Read it, clear it, and show the same code screen password
       sign-in uses. The session is created only after a valid code. */
    /* This effect can fire before the `lang` state above has landed, so it
       reads the device language directly rather than closing over "en". */
    const lg = getLang();
    const LE = (en: string, ms: string) => (lg === "ms" ? ms : en);
    const q = new URLSearchParams(window.location.search);
    if (q.get("2fa") === "1") {
      const m = document.cookie.match(/(?:^|; )twofa_challenge=([^;]*)/);
      if (m?.[1]) {
        setChallenge(m[1]);
        document.cookie = "twofa_challenge=; Secure; SameSite=Lax; Path=/; Max-Age=0";
        return; // no /auth/me probe — there is deliberately no session yet
      }
      setError(LE("This sign-in attempt expired — please sign in again.", "Percubaan log masuk ini telah tamat tempoh — sila log masuk semula."));
    }
    // Already signed in? Route straight to the right place.
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data?.user) window.location.replace(destinationFor(r.data.user.role));
    });
    if (q.get("error") === "oauth") setError(LE("Google sign-in didn't complete — please try again.", "Log masuk Google tidak selesai — sila cuba lagi."));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");

    if (mode === "register") {
      const res = await api<{ user?: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, name, password }),
      });
      setBusy(false);
      if (res.ok && res.data?.user) {
        window.location.replace(destinationFor(res.data.user.role));
      } else if (res.status === 409) {
        setError(L(
          "An account with this email already exists — sign in instead.",
          "Akaun dengan e-mel ini sudah wujud — sila log masuk.",
        ));
      } else if (res.status === 429) {
        setError(L("Too many registrations — try again later.", "Terlalu banyak pendaftaran — cuba lagi kemudian."));
      } else if (res.status === 400) {
        // Show the real reason from the API instead of guessing
        const msg = (res.data as { error?: { message?: string } } | null)?.error?.message;
        setError(msg ?? L("Please check the details and try again.", "Sila semak butiran dan cuba lagi."));
      } else if (res.status === 0 || res.status === 404) {
        setError(L(
          "Can't reach the sign-up service. The API Worker may not be deployed yet — please contact your administrator.",
          "Tidak dapat menghubungi perkhidmatan pendaftaran. API Worker mungkin belum digunakan — sila hubungi pentadbir anda.",
        ));
      } else {
        setError(L("Sign-up failed — please try again in a moment.", "Pendaftaran gagal — sila cuba lagi sebentar nanti."));
      }
      return;
    }

    const res = await api<{ user: User; twofa_required?: boolean; challenge?: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok && res.data?.twofa_required && res.data.challenge) {
      // Password accepted; no session yet — ask for the authenticator code.
      setChallenge(res.data.challenge);
      setError("");
      return;
    }
    if (res.ok && res.data?.user) {
      window.location.replace(destinationFor(res.data.user.role));
    } else if (res.status === 429) {
      setError(L("Too many attempts — try again in 15 minutes.", "Terlalu banyak percubaan — cuba lagi dalam 15 minit."));
    } else if (res.status === 0) {
      setError(L(
        "Can't reach the server just now — please try again shortly.",
        "Tidak dapat menghubungi pelayan buat masa ini — sila cuba lagi sebentar nanti.",
      ));
    } else {
      setError(L(
        "Email or password is incorrect, or the account is inactive.",
        "E-mel atau kata laluan tidak betul, atau akaun tidak aktif.",
      ));
    }
  };

  return (
    /* v1.29.2 (CEO, from his phone: "Sign in page I want to fit well for
       mobile apps view"): the page was a fixed mt-24 block, which on a phone
       spent 96px of a ~700px viewport on empty space and pushed the Sign in
       button below the fold — with Safari's bottom bar sitting over it. It is
       now a centred column measured in svh (the SMALL viewport height, i.e.
       with the browser chrome showing), so the whole form lands on one screen
       whether or not the URL bar is expanded, and the safe-area inset keeps
       the button clear of the home indicator. Desktop is unchanged: from sm:
       up it is the same top-anchored card at the same width. */
    <div className="mx-auto flex min-h-[100svh] w-full max-w-sm flex-col justify-center px-6 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:block sm:min-h-0 sm:justify-start sm:pt-24 sm:pb-16">
      <Link href="/" className="inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="A2Z CREATIVE MARKETING" className="h-8 w-auto" />
      </Link>
      {challenge ? (
        <div className="mt-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            {L("Two-factor verification", "Pengesahan dua faktor")}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {L(
              "Enter the 6-digit code from your authenticator app. You can also use one of your backup codes.",
              "Masukkan kod 6 digit daripada aplikasi pengesah anda. Anda juga boleh menggunakan salah satu kod sandaran anda.",
            )}
          </p>
          <input
            className="border-input bg-background mt-4 w-full rounded-lg border px-3 py-2 text-center text-lg tracking-[0.3em]"
            inputMode="numeric"
            autoFocus
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && code.length >= 6 && void verifyCode()}
          />
          {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
          <button
            type="button"
            disabled={busy || code.length < 6}
            className="bg-primary text-primary-foreground mt-4 w-full rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            onClick={() => void verifyCode()}
          >
            {busy ? L("Verifying…", "Mengesahkan…") : L("Verify and sign in", "Sahkan dan log masuk")}
          </button>
          <button
            type="button"
            className="text-muted-foreground mt-3 w-full text-xs underline"
            onClick={() => { setChallenge(""); setCode(""); setError(""); }}
          >
            {L("Back to sign in", "Kembali ke log masuk")}
          </button>
        </div>
      ) : (
      <>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:mt-8">
        {mode === "login" ? L("Sign in", "Log masuk") : L("Create your account", "Buat akaun anda")}
      </h1>
      <p className="text-muted-foreground mt-1.5 text-sm sm:mt-2">
        {L(
          "One login for everyone at A2Z CREATIVE MARKETING — you'll be taken to your own area automatically.",
          "Satu log masuk untuk semua di A2Z CREATIVE MARKETING — anda akan dibawa ke ruangan anda sendiri secara automatik.",
        )}
      </p>

      <div
        role="tablist"
        aria-label={L("Sign in or create an account", "Log masuk atau buat akaun")}
        className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary p-1 sm:mt-6"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mode === "login"}
          onClick={() => { setMode("login"); setError(""); }}
          className={
            mode === "login"
              ? "rounded-md bg-background px-4 py-2 text-sm font-medium shadow-sm"
              : "text-muted-foreground rounded-md px-4 py-2 text-sm font-medium hover:text-foreground"
          }
        >
          {L("Sign in", "Log masuk")}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mode === "register"}
          onClick={() => { setMode("register"); setError(""); }}
          className={
            mode === "register"
              ? "rounded-md bg-background px-4 py-2 text-sm font-medium shadow-sm"
              : "text-muted-foreground rounded-md px-4 py-2 text-sm font-medium hover:text-foreground"
          }
        >
          {L("Create account", "Buat akaun")}
        </button>
      </div>

      <a
        href={`${API}/auth/google`}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium transition-colors hover:bg-secondary sm:mt-8"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.2C12.3 13.6 17.7 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.4 6.9-17.7z"/>
          <path fill="#FBBC05" d="M10.4 28.7a14.6 14.6 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z"/>
          <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/>
        </svg>
        {L("Continue with Google", "Teruskan dengan Google")}
      </a>

      <div className="my-4 flex items-center gap-3 sm:my-6">
        <span className="h-px flex-1 bg-border" />
        <span className="text-muted-foreground text-xs">{L("or with email", "atau dengan e-mel")}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-3 sm:space-y-4">
        {mode === "register" && (
          <input className={inputClass} placeholder={L("Your name", "Nama anda")} value={name}
            onChange={(e) => setName(e.target.value)} autoComplete="name" />
        )}
        <input className={inputClass} placeholder={L("Email", "E-mel")} type="email" value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <div className="relative">
          <input
            className={`${inputClass} pr-11`}
            placeholder={mode === "register" ? L("Password (10+ characters)", "Kata laluan (10+ aksara)") : L("Password", "Kata laluan")}
            type={showPw ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? L("Hide password", "Sembunyikan kata laluan") : L("Show password", "Tunjukkan kata laluan")}
            aria-pressed={showPw}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg focus:outline-none focus-visible:ring-2"
          >
            {showPw ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        </div>
        {mode === "register" && password.length > 0 && (
          <p className={`text-xs ${password.length >= 10 ? "text-muted-foreground" : "text-destructive"}`}>
            {password.length >= 10
              ? L(`Password length OK (${password.length} characters)`, `Panjang kata laluan OK (${password.length} aksara)`)
              : L(
                  `${password.length} of 10 characters — ${10 - password.length} more needed`,
                  `${password.length} daripada 10 aksara — ${10 - password.length} lagi diperlukan`,
                )}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="button"
          className={btnClass}
          disabled={
            busy ||
            !email ||
            !password ||
            (mode === "register" && (!name || password.length < 10))
          }
          onClick={() => void submit()}
        >
          {busy ? L("Please wait…", "Sila tunggu…") : mode === "login" ? L("Sign in", "Log masuk") : L("Create account", "Buat akaun")}
        </button>
        {mode === "register" && (
          <p className="text-muted-foreground text-xs">
            {L(
              "Registration creates a customer account with access to your own details and enquiries. Staff and admin access is assigned by A2Z CREATIVE MARKETING administrators.",
              "Pendaftaran mencipta akaun pelanggan dengan akses kepada butiran dan pertanyaan anda sendiri. Akses kakitangan dan admin diberikan oleh pentadbir A2Z CREATIVE MARKETING.",
            )}
          </p>
        )}
      </div>
      </>
      )}
      {/* v1.23.4: visible build stamp — one glance answers "is the live
          site on the new version?" */}
      <p className="text-muted-foreground/60 mt-4 text-center text-[10px] tabular-nums sm:mt-8">v{APP_VERSION}</p>
    </div>
  );
}

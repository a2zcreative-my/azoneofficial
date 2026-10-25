"use client";

/**
 * SIGN IN (/login) - the one door into A2Z CREATIVE MARKETING's portals.
 * After sign-in the server's answer decides where a person goes; the page
 * never decides what anyone may see.
 *
 * v1.211.0 (the owner's sign-in brief, 25-10-2026: "MINIMAL PUBLIC
 * INFORMATION. STRONG SERVER-SIDE SECURITY. EXISTING AUTHENTICATION
 * PRESERVED. NO DUPLICATION."). This page is shared by staff, customers and
 * clients, and is open to anyone, so it says only what a visitor needs to
 * sign in:
 *   - the navy panel is the mark, "Welcome to A2Z." and the copyright - no
 *     list of what is inside, no "staff and customer portal";
 *   - no build number;
 *   - every failed sign-in, by password or by Google, says the same
 *     sentence, so the page never tells anyone whether an account exists,
 *     is switched off, or has left;
 *   - "Forgot password?" says to contact A2Z, not how accounts are run;
 *   - no Create account (the owner: hide it from the page).
 * Password, Google and two-factor sign-in are exactly what they were, and
 * the server decides every one of them (worker/src/index.ts, /auth/*).
 *
 * Kept from v1.156.0: a real <form> (Enter submits, password managers
 * fill), labelled 16px fields, the live button that says what is missing,
 * Caps Lock, show/hide password, the one-time-code box that signs in on the
 * sixth digit, EN/BM on the page, and the phone column measured in svh with
 * the safe-area inset (v1.29.2). The language is read in an effect: /login
 * is part of the static export (v1.27.0). Every component is module scope
 * (house rule #30).
 */

import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getLang, setLang, type Lang } from "@/lib/i18n";
import { inputClassLg, btnClassBlock } from "@/lib/ui-styles";
import css from "./login.module.css";

const API = "/api/v1";

interface User { id: number; email: string; name: string; role: string }

/* Where the SERVER's answer sends a person after sign-in. This only picks a
   page; every page and every API asks the server again who you are. */
const STAFF_ONLY = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco"];

function destinationFor(role: string): string {
  if (role === "customer") return "/account";
  if (STAFF_ONLY.includes(role)) return "/portal";
  return "/admin";
}

/** the page's own translator, made from whichever language the device holds */
const tr = (lang: Lang) => (en: string, ms: string) => (lang === "ms" ? ms : en);

/** v1.211.0 - THE ONE SENTENCE for any sign-in that did not work, by
    password or by Google: it never says which part was wrong, or whether
    the account exists. */
const FAILED: [string, string] = ["Unable to sign in with the provided credentials.", "Tidak dapat log masuk dengan maklumat yang diberikan."];

/* ── module-scope pieces (house rule #30) ──────────────────────────────── */

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.2C12.3 13.6 17.7 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.4 6.9-17.7z"/>
      <path fill="#FBBC05" d="M10.4 28.7a14.6 14.6 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z"/>
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/>
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

/** EN | BM, on the one screen nobody can skip. Writes the same key the
    portal, the admin and the public site all read. */
function LangSwitch({ lang, onPick }: { lang: Lang; onPick: (l: Lang) => void }) {
  return (
    <div className={css.lang} role="group" aria-label="Language / Bahasa">
      <button type="button" aria-pressed={lang === "en"} onClick={() => onPick("en")}>EN</button>
      <button type="button" aria-pressed={lang === "ms"} onClick={() => onPick("ms")}>BM</button>
    </div>
  );
}

/** A labelled field. The label is visible and tied to the input by id -
    a placeholder is a hint, never a name. */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className={css.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className={css.hint}>{hint}</p>}
    </div>
  );
}

/** Anything that went wrong, announced to a screen reader the moment it
    appears rather than sitting there as a red line nobody is told about. */
function ErrorNote({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className={css.error}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12" y2="16.5" />
      </svg>
      <span>{message}</span>
    </p>
  );
}

/** The navy half, from 1024px. The mark, one welcome, the copyright - and
    nothing about what is inside (v1.211.0). Decorative only, which is why a
    phone never draws it. */
function BrandPanel({ lang }: { lang: Lang }) {
  const L = tr(lang);
  return (
    <aside className={css.brand} aria-label="A2Z CREATIVE MARKETING">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="A2Z CREATIVE MARKETING" className={css.brandLogo} />
        <span className={css.brandRule} aria-hidden />
      </div>
      <div className={css.welcome}>
        <h2>{L("Welcome to A2Z.", "Selamat datang ke A2Z.")}</h2>
        <p>{L("A connected experience, designed for you.", "Pengalaman yang bersambung, direka untuk anda.")}</p>
      </div>
      <p className={css.copyright}>© A2Z Creative Marketing</p>
    </aside>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lang, setLangState] = useState<Lang>("en");
  const emailRef = useRef<HTMLInputElement>(null);
  const verifying = useRef(false);
  useEffect(() => { setLangState(getLang()); }, []);
  const L = tr(lang);
  const pickLang = (l: Lang) => { setLang(l); setLangState(l); };

  /* The keyboard should not open by itself on a phone - it swallows half the
     screen before anyone has decided what to do. On a desk it saves a click. */
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches) emailRef.current?.focus();
  }, []);

  const verifyCode = async (value: string) => {
    if (verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError("");
    const res = await api<{ user: User }>("/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge, code: value }),
    });
    setBusy(false);
    verifying.current = false;
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

  /** Typed, pasted or autofilled: keep the digits, six at most, and sign in
      by itself once the sixth lands. */
  const onCode = (raw: string) => {
    const next = raw.replace(/\D/g, "").slice(0, 6);
    setCode(next);
    if (next.length === 6 && !busy) void verifyCode(next);
  };

  useEffect(() => {
    /* v1.23.1: Google sign-in with 2FA enabled no longer mints a session —
       the callback drops a 5-minute challenge cookie and lands here with
       ?2fa=1. Read it, clear it, and show the same code screen password
       sign-in uses. The session is created only after a valid code. */
    /* This effect can fire before the `lang` state above has landed, so it
       reads the device language directly rather than closing over "en". */
    const LE = tr(getLang());
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
    /* v1.211.0 - every Google sign-in that did not end in a session comes
       back here (worker: OAUTH_FAILED), and says the one sentence */
    if (q.get("error") === "oauth") setError(LE(...FAILED));
  }, []);

  const submit = async () => {
    /* v1.156.0 - the button is never born disabled, so what is missing is
       said here rather than left for the reader to deduce from a grey slab. */
    if (!email.trim()) {
      setError(L("Please enter your email address.", "Sila masukkan alamat e-mel anda."));
      return;
    }
    if (!password) {
      setError(L("Please enter your password.", "Sila masukkan kata laluan anda."));
      return;
    }

    setBusy(true);
    setError("");
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
      /* v1.211.0 - one sentence, whatever the reason */
      setError(L(...FAILED));
    }
  };

  /* skeleton: none — the mount-time /auth/me probe only redirects a user who is already signed in; the sign-in form draws nothing from it and renders in full from the first frame (v1.77.0) */
  return (
    <div className={css.page}>
      <BrandPanel lang={lang} />

      {/* v1.29.2 (CEO, from his phone): a centred column measured in svh with
          the safe-area inset, so the whole form lands on one screen whether
          or not the URL bar is expanded; the right half on a desk. */}
      <main className={css.formSide}>
        <div className={css.topRow}>
          <Link href="/" className={css.phoneLogo} aria-label="A2Z CREATIVE MARKETING">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="A2Z CREATIVE MARKETING" />
          </Link>
          <LangSwitch lang={lang} onPick={pickLang} />
        </div>

        {challenge ? (
          <div>
            <h1 className={css.title}>
              {L("Two-factor verification", "Pengesahan dua faktor")}
            </h1>
            <p className={css.lede}>
              {L(
                "Enter the 6-digit code from your authenticator app. You can also use one of your backup codes.",
                "Masukkan kod 6 digit daripada aplikasi pengesah anda. Anda juga boleh menggunakan salah satu kod sandaran anda.",
              )}
            </p>
            <form
              className={css.form}
              onSubmit={(e) => { e.preventDefault(); if (!busy && code.length >= 6) void verifyCode(code); }}
            >
              <div className={css.divider} aria-hidden />
              <Field id="code" label={L("Authenticator code", "Kod pengesah")}
                hint={L("It signs you in by itself once the sixth digit is in.", "Ia log masuk dengan sendirinya sebaik digit keenam dimasukkan.")}>
                <input
                  id="code"
                  className={`${inputClassLg} ${css.codeInput}`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoFocus
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "code-error" : undefined}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => onCode(e.target.value)}
                />
              </Field>
              {error && <ErrorNote id="code-error" message={error} />}
              <button type="submit" disabled={busy || code.length < 6} className={btnClassBlock}>
                {busy ? L("Verifying…", "Mengesahkan…") : L("Verify and sign in", "Sahkan dan log masuk")}
              </button>
            </form>
            <div className={css.help}>
              <button type="button" className={css.linkBtn}
                onClick={() => { setChallenge(""); setCode(""); setError(""); }}>
                {L("Back to sign in", "Kembali ke log masuk")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className={css.title}>{L("Sign in", "Log masuk")}</h1>
            <p className={css.lede}>{L("Securely access your account.", "Akses akaun anda dengan selamat.")}</p>

            <a href={`${API}/auth/google`} className={css.google}>
              <GoogleMark />
              {L("Continue with Google", "Teruskan dengan Google")}
            </a>

            <hr className={css.divider} />

            <form className={css.form} noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }}>
              <Field id="email" label={L("Email", "E-mel")}>
                <input
                  id="email"
                  ref={emailRef}
                  className={inputClassLg}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  placeholder={L("Enter your email", "Masukkan e-mel anda")}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "form-error" : undefined}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <Field id="password" label={L("Password", "Kata laluan")}
                hint={caps ? L("Caps Lock is on.", "Caps Lock dihidupkan.") : undefined}>
                <div className={css.pwWrap}>
                  <input
                    id="password"
                    className={inputClassLg}
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder={L("Enter your password", "Masukkan kata laluan anda")}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "form-error" : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
                    onBlur={() => setCaps(false)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? L("Hide password", "Sembunyikan kata laluan") : L("Show password", "Tunjukkan kata laluan")}
                    aria-pressed={showPw}
                    className={css.eye}
                  >
                    <EyeIcon off={showPw} />
                  </button>
                </div>
              </Field>

              {error && <ErrorNote id="form-error" message={error} />}

              <button type="submit" className={btnClassBlock} disabled={busy}>
                {busy ? L("Please wait…", "Sila tunggu…") : L("Sign in", "Log masuk")}
              </button>
            </form>

            <div className={css.help}>
              <button type="button" className={css.linkBtn}
                aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
                {L("Forgot password?", "Lupa kata laluan?")}
              </button>
              {helpOpen && (
                <p className={css.helpNote}>
                  {L(
                    "To reset your password, please contact A2Z Creative Marketing.",
                    "Untuk menetapkan semula kata laluan anda, sila hubungi A2Z Creative Marketing.",
                  )}
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

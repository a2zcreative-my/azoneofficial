"use client";

/**
 * SIGN IN (/login) — one door for everyone, into A2Z CREATIVE MARKETING's
 * portals. After sign-in people are routed by role:
 *   customer -> /account · staff roles -> /portal · CMS roles -> /admin
 *
 * v1.156.0 (CEO, 12-09-2026: *"provide me implementation for the better
 * UI/UX on the login page webview and mobile apps view"*).
 *
 * WHAT WAS WRONG, and what each change answers:
 *
 *   THE DESKTOP WAS A PHONE FORM ON A 1440px SCREEN. A 384px column floated
 *   in the middle of an empty white page: no brand, no anchor, nothing to
 *   read. From `lg` up the page is now TWO HALVES — the navy brand panel
 *   (logo, one sentence, what is actually inside the portal) and the form,
 *   centred in its own half. Below `lg` nothing splits: it stays the single
 *   centred column a phone wants, measured in svh with the safe-area inset,
 *   which is the v1.29.2 fix and is kept exactly.
 *
 *   THE FIELDS WERE PLACEHOLDER-ONLY. A placeholder is not a label: it
 *   disappears the moment you type, so a half-filled form stops saying what
 *   its boxes are, and screen readers are left guessing. Every field now has
 *   a real <label>, and the inputs are `inputClassLg` — 16px text on a phone,
 *   which is also what stops iOS zooming the page in when a field is tapped.
 *
 *   IT WAS NOT A FORM. Enter worked in the password box only (a hand-rolled
 *   keydown), password managers had no form to fill, and the browser had no
 *   submit to offer. It is a real <form onSubmit> now: Enter submits from any
 *   field, and the managers behave.
 *
 *   THE BUTTON WAS BORN DEAD. Disabled until both boxes had text, so the
 *   first thing anyone saw was a grey slab. It is live from the first frame
 *   and says what is missing when pressed — you can always press it, and it
 *   always tells you something.
 *
 *   YOU COULD NOT CHOOSE THE LANGUAGE AT THE ONE SCREEN YOU CANNOT SKIP.
 *   The language came from the device and the EN/BM switch lived inside the
 *   portal, so a BM-speaking staff member met English at sign-in. The switch
 *   is on this page now and writes the same `azone-lang` key the rest of the
 *   app reads.
 *
 *   A FORGOTTEN PASSWORD WAS A DEAD END. There is no self-service reset in
 *   this system - an administrator sets a new password on the Users tab - so
 *   the page says exactly that instead of leaving people to guess.
 *
 *   THE 2FA BOX FOUGHT THE PHONE. No one-time-code autofill, no paste
 *   cleanup, and you had to hunt for the button after typing six digits. It
 *   autofills, accepts a pasted code, and signs in by itself on the sixth
 *   digit.
 *
 * The language still comes from state rather than a module-scope getLang()
 * read: /login is part of the STATIC EXPORT, so a direct read would render
 * "en" into login.html and "ms" on the client and break hydration (v1.27.0).
 * Every component here is module scope (house rule #30).
 */

import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getLang, setLang, type Lang } from "@/lib/i18n";
import { inputClassLg, btnClassBlock } from "@/lib/ui-styles";
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

/** the page's own translator, made from whichever language the device holds */
const tr = (lang: Lang) => (en: string, ms: string) => (lang === "ms" ? ms : en);

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
  const pill = (on: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      on ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground"
    }`;
  return (
    <div className="border-border inline-flex items-center gap-0.5 rounded-full border p-0.5" role="group" aria-label="Language / Bahasa">
      <button type="button" className={pill(lang === "en")} aria-pressed={lang === "en"} onClick={() => onPick("en")}>EN</button>
      <button type="button" className={pill(lang === "ms")} aria-pressed={lang === "ms"} onClick={() => onPick("ms")}>BM</button>
    </div>
  );
}

/** A labelled field. The label is visible and tied to the input by id -
    a placeholder is a hint, never a name. */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-muted-foreground mt-1.5 text-xs">{hint}</p>}
    </div>
  );
}

/** Anything that went wrong, announced to a screen reader the moment it
    appears rather than sitting there as a red line nobody is told about. */
function ErrorNote({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="bg-danger-soft text-danger flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12" y2="16.5" />
      </svg>
      <span>{message}</span>
    </p>
  );
}

/** The navy half, from `lg` up. It is what fills the empty screen: the mark,
    one sentence, and the four things the portal is actually for. Decorative
    only - nothing here is needed to sign in, which is why a phone never
    draws it. */
function BrandPanel({ lang }: { lang: Lang }) {
  const L = tr(lang);
  const lines: [string, string][] = [
    ["Clock in, shifts and leave", "Masuk kerja, syif dan cuti"],
    ["Sales, orders and invoices", "Jualan, pesanan dan invois"],
    ["Claims, payroll and payslips", "Tuntutan, gaji dan slip gaji"],
    ["Your targets and today's figures", "Sasaran anda dan angka hari ini"],
  ];
  return (
    <div className="bg-brand relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      {/* decorative: one soft gold wash, no texture library, no image */}
      <span aria-hidden className="bg-gold/10 pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full blur-3xl" />
      <span aria-hidden className="bg-gold/10 pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full blur-3xl" />
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="A2Z CREATIVE MARKETING" className="h-10 w-auto" />
        <span className="bg-gold mt-6 block h-px w-16" aria-hidden />
      </div>
      <div className="relative max-w-md">
        <h2 className="text-3xl font-semibold tracking-tight xl:text-4xl">
          {L("Everything your day needs, in one place.", "Segala keperluan hari anda, di satu tempat.")}
        </h2>
        <ul className="mt-8 space-y-3">
          {lines.map(([en, ms]) => (
            <li key={en} className="flex items-center gap-3 text-sm text-white/85">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gold shrink-0" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {L(en, ms)}
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-xs text-white/55">
        {L("A2Z CREATIVE MARKETING · staff and customer portal", "A2Z CREATIVE MARKETING · portal kakitangan dan pelanggan")}
      </p>
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
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
    if (q.get("error") === "oauth") setError(LE("Google sign-in didn't complete — please try again.", "Log masuk Google tidak selesai — sila cuba lagi."));
  }, []);

  const submit = async () => {
    /* v1.156.0 - the button is never born disabled, so what is missing is
       said here rather than left for the reader to deduce from a grey slab. */
    if (mode === "register" && !name.trim()) {
      setError(L("Please enter your name.", "Sila masukkan nama anda."));
      return;
    }
    if (!email.trim()) {
      setError(L("Please enter your email address.", "Sila masukkan alamat e-mel anda."));
      return;
    }
    if (!password) {
      setError(L("Please enter your password.", "Sila masukkan kata laluan anda."));
      return;
    }
    if (mode === "register" && password.length < 10) {
      setError(L("Your password needs at least 10 characters.", "Kata laluan anda perlu sekurang-kurangnya 10 aksara."));
      return;
    }

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

  const tab = (on: boolean) =>
    on
      ? "bg-background h-10 rounded-md px-4 text-sm font-medium shadow-sm"
      : "text-muted-foreground hover:text-foreground h-10 rounded-md px-4 text-sm font-medium";

  /* skeleton: none — the mount-time /auth/me probe only redirects a user who is already signed in; the sign-in form draws nothing from it and renders in full from the first frame (v1.77.0) */
  return (
    <div className="lg:grid lg:min-h-[100svh] lg:grid-cols-2">
      <BrandPanel lang={lang} />

      {/* v1.29.2 (CEO, from his phone: "Sign in page I want to fit well for
          mobile apps view"): a centred column measured in svh (the SMALL
          viewport height, i.e. with the browser chrome showing), so the whole
          form lands on one screen whether or not the URL bar is expanded, and
          the safe-area inset keeps the button clear of the home indicator.
          v1.156.0 keeps that exactly and lets it be the right half on a desk. */}
      <div className="mx-auto flex min-h-[100svh] w-full max-w-sm flex-col justify-center px-6 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:max-w-md lg:px-10">
        <div className="flex items-center justify-between gap-4 lg:justify-end">
          <Link href="/" className="inline-block lg:hidden" aria-label="A2Z CREATIVE MARKETING">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="A2Z CREATIVE MARKETING" className="h-8 w-auto" />
          </Link>
          <LangSwitch lang={lang} onPick={pickLang} />
        </div>

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
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => { e.preventDefault(); if (!busy && code.length >= 6) void verifyCode(code); }}
            >
              <Field id="code" label={L("Authenticator code", "Kod pengesah")}
                hint={L("It signs you in by itself once the sixth digit is in.", "Ia log masuk dengan sendirinya sebaik digit keenam dimasukkan.")}>
                <input
                  id="code"
                  className={`${inputClassLg} text-center text-2xl tracking-[0.4em] tabular-nums`}
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
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground mt-4 w-full text-xs underline"
              onClick={() => { setChallenge(""); setCode(""); setError(""); }}
            >
              {L("Back to sign in", "Kembali ke log masuk")}
            </button>
          </div>
        ) : (
          <>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
              {mode === "login" ? L("Sign in", "Log masuk") : L("Create your account", "Buat akaun anda")}
            </h1>
            <p className="text-muted-foreground mt-1.5 text-sm">
              {L(
                "One login for everyone at A2Z CREATIVE MARKETING — you'll be taken to your own area automatically.",
                "Satu log masuk untuk semua di A2Z CREATIVE MARKETING — anda akan dibawa ke ruangan anda sendiri secara automatik.",
              )}
            </p>

            <div
              role="tablist"
              aria-label={L("Sign in or create an account", "Log masuk atau buat akaun")}
              className="border-border bg-secondary mt-6 grid grid-cols-2 gap-1 rounded-lg border p-1"
            >
              <button role="tab" type="button" aria-selected={mode === "login"} className={tab(mode === "login")}
                onClick={() => { setMode("login"); setError(""); }}>
                {L("Sign in", "Log masuk")}
              </button>
              <button role="tab" type="button" aria-selected={mode === "register"} className={tab(mode === "register")}
                onClick={() => { setMode("register"); setError(""); }}>
                {L("Create account", "Buat akaun")}
              </button>
            </div>

            <a
              href={`${API}/auth/google`}
              className="border-border hover:bg-secondary mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors sm:h-11"
            >
              <GoogleMark />
              {L("Continue with Google", "Teruskan dengan Google")}
            </a>

            <div className="my-5 flex items-center gap-3">
              <span className="bg-border h-px flex-1" />
              <span className="text-muted-foreground text-xs">{L("or with email", "atau dengan e-mel")}</span>
              <span className="bg-border h-px flex-1" />
            </div>

            <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }}>
              {mode === "register" && (
                <Field id="name" label={L("Your name", "Nama anda")}>
                  <input id="name" className={inputClassLg} value={name} autoComplete="name"
                    placeholder={L("e.g. Nurul Aina", "cth. Nurul Aina")}
                    onChange={(e) => setName(e.target.value)} />
                </Field>
              )}

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
                  placeholder="you@a2zcreative.my"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "form-error" : undefined}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <Field
                id="password"
                label={L("Password", "Kata laluan")}
                hint={
                  mode === "register"
                    ? password.length === 0
                      ? L("At least 10 characters.", "Sekurang-kurangnya 10 aksara.")
                      : password.length >= 10
                        ? L(`Long enough (${password.length} characters).`, `Cukup panjang (${password.length} aksara).`)
                        : L(`${password.length} of 10 characters — ${10 - password.length} more needed.`, `${password.length} daripada 10 aksara — ${10 - password.length} lagi diperlukan.`)
                    : caps
                      ? L("Caps Lock is on.", "Caps Lock dihidupkan.")
                      : undefined
                }
              >
                <div className="relative">
                  <input
                    id="password"
                    className={`${inputClassLg} pr-12`}
                    type={showPw ? "text" : "password"}
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    placeholder={L("Your password", "Kata laluan anda")}
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
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg focus:outline-none focus-visible:ring-2"
                  >
                    <EyeIcon off={showPw} />
                  </button>
                </div>
              </Field>

              {error && <ErrorNote id="form-error" message={error} />}

              <button type="submit" className={btnClassBlock} disabled={busy}>
                {busy ? L("Please wait…", "Sila tunggu…") : mode === "login" ? L("Sign in", "Log masuk") : L("Create account", "Buat akaun")}
              </button>
            </form>

            {mode === "login" ? (
              <div className="mt-4">
                <button type="button" className="text-muted-foreground hover:text-foreground text-xs underline"
                  aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
                  {L("Forgot your password?", "Lupa kata laluan anda?")}
                </button>
                {helpOpen && (
                  <p className="text-muted-foreground bg-secondary mt-2 rounded-lg px-3 py-2.5 text-xs">
                    {L(
                      "There is no self-service reset on this system. Ask an administrator (or the CEO) to set a new password for you on the Users tab — you will be signed out everywhere and can sign in again with the new one.",
                      "Tiada tetapan semula layan diri pada sistem ini. Minta pentadbir (atau CEO) menetapkan kata laluan baharu untuk anda di tab Users — anda akan dilog keluar di semua peranti dan boleh log masuk semula dengan kata laluan baharu itu.",
                    )}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground mt-4 text-xs">
                {L(
                  "Registration creates a customer account with access to your own details and enquiries. Staff and admin access is assigned by A2Z CREATIVE MARKETING administrators.",
                  "Pendaftaran mencipta akaun pelanggan dengan akses kepada butiran dan pertanyaan anda sendiri. Akses kakitangan dan admin diberikan oleh pentadbir A2Z CREATIVE MARKETING.",
                )}
              </p>
            )}
          </>
        )}

        {/* v1.23.4: visible build stamp — one glance answers "is the live
            site on the new version?" */}
        <p className="text-muted-foreground/60 mt-8 text-center text-[10px] tabular-nums">v{APP_VERSION}</p>
      </div>
    </div>
  );
}

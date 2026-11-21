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
 *   - "Forgot password?" emails a staff member a one-hour reset link (19-11-2026) and
 *     answers the same whatever the email is;
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
import { useEffect, useRef, useState, type PointerEvent as KeyPointerEvent, type ReactNode, type RefObject } from "react";
import { getLang, setLang, type Lang } from "@/lib/i18n";
import { inputClassLg, btnClassBlock } from "@/lib/ui-styles";
import { getPasskey, passkeysSupported, cancelled, type GetOptionsJSON } from "@/lib/passkey"; // v1.269.0 - Phase 2A
import { useBotCheck, type BotState } from "@/components/security/bot-check"; // v1.341.0 - Cloudflare bot check before sign-in
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import css from "./login.module.css";

const API = "/api/v1";

interface User { id: number; email: string; name: string; role: string }

/* Where the SERVER's answer sends a person after sign-in. This only picks a
   page; every page and every API asks the server again who you are. */
const STAFF_ONLY = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco"];

function destinationFor(role: string): string {
  if (role === "customer") return "/account";
  if (STAFF_ONLY.includes(role)) {
    /* v1.247.0 - back to the task a notification email pointed at, when the
       person had to sign in first. Our own /portal path only; used once. */
    try {
      const back = window.sessionStorage.getItem("azone-return");
      window.sessionStorage.removeItem("azone-return");
      if (back && /^\/portal\?[A-Za-z0-9=&%._-]*$/.test(back)) return back;
    } catch { /* private mode */ }
    return "/portal";
  }
  return "/admin";
}

/** the page's own translator, made from whichever language the device holds */
const tr = (lang: Lang) => (en: string, ms: string) => (lang === "ms" ? ms : en);

/** v1.211.0 - THE ONE SENTENCE for any sign-in that did not work, by
    password or by Google: it never says which part was wrong, or whether
    the account exists. */
const FAILED: [string, string] = ["Unable to sign in with the provided credentials.", "Tidak dapat log masuk dengan maklumat yang diberikan."];
/* v1.341.0 - the Cloudflare bot check refused this try; a fresh check is already running */
const BOT_FAILED: [string, string] = ["The security check did not pass. Please wait for it to finish and try again.", "Semakan keselamatan tidak lulus. Sila tunggu ia selesai dan cuba lagi."];
/* v1.264.0 - Google switched off by the owner: say so, and point at the way in that stays */
const GOOGLE_OFF: [string, string] = ["Google sign-in is switched off for now. Sign in with your email and password.", "Log masuk Google dimatikan buat masa ini. Log masuk dengan e-mel dan kata laluan anda."];
const EXPIRED: [string, string] = ["This sign-in attempt expired — please sign in again.", "Percubaan log masuk ini telah tamat tempoh — sila log masuk semula."];
/* v1.264.0 (G4) - a Google sign-in leaves its challenge in an HttpOnly
   cookie the worker reads itself; the page only knows that one is waiting */
const VIA_COOKIE = "via-cookie";

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

/** v1.345.0 - the gold wave (the CEO's two references, 17-11-2026). Decoration only:
    "panel" sits at the foot of the navy half, "phone" at the foot of the phone page. */
function Waves({ variant }: { variant: "panel" | "phone" }) {
  const g = `login-gold-${variant}`;
  return variant === "panel" ? (
    <svg className={css.panelWave} viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" className={css.goldStop} stopOpacity="0" />
          <stop offset="0.55" className={css.goldStop} stopOpacity="1" />
          <stop offset="1" className={css.goldStop} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className={css.softWave} d="M0 190 C 160 130, 320 170, 600 70 L600 300 L0 300 Z" />
      <path className={css.softWave} d="M0 250 C 210 190, 390 270, 600 160 L600 300 L0 300 Z" />
      <path className={css.goldGlow} d="M250 300 C 360 240, 450 140, 600 95" stroke={`url(#${g})`} />
      <path className={css.goldLine} d="M250 300 C 360 240, 450 140, 600 95" stroke={`url(#${g})`} />
    </svg>
  ) : (
    <svg className={css.phoneWave} viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" className={css.goldStop} stopOpacity="0" />
          <stop offset="0.6" className={css.goldStop} stopOpacity="1" />
          <stop offset="1" className={css.goldStop} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <path className={css.navyWaveSoft} d="M0 52 C 110 28, 210 70, 400 14 L400 120 L0 120 Z" />
      <path className={css.navyWave} d="M0 70 C 120 40, 230 96, 400 34 L400 120 L0 120 Z" />
      <path className={css.goldLine} d="M170 84 C 250 82, 330 48, 400 22" stroke={`url(#${g})`} />
    </svg>
  );
}

/** One security highlight on the navy half: generic words about protection,
    never what is inside (v1.211.0). */
function Highlight({ icon, title, sub }: { icon: AppIconName; title: string; sub: string }) {
  return (
    <li className={css.highlight}>
      <span className={css.highlightIcon}><AppIcon name={icon} /></span>
      <span className={css.highlightText}><strong>{title}</strong><span>{sub}</span></span>
    </li>
  );
}

/** The navy half, from 1024px. The mark, the welcome, three security
    highlights, the wave and the copyright - and nothing about what is inside
    (v1.211.0). Decorative only, which is why a phone never draws it. */
function BrandPanel({ lang }: { lang: Lang }) {
  const L = tr(lang);
  return (
    <aside className={css.brand} aria-label="A2Z CREATIVE MARKETING">
      <div className={css.brandTop}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="A2Z CREATIVE MARKETING" className={css.brandLogo} />
        <span className={css.brandRule} aria-hidden />
      </div>
      <div className={css.welcome}>
        <h2>{L("Welcome to", "Selamat datang ke")}<span className={css.brandName}>A2Z OS</span></h2>
        <p>{L("A connected workspace, designed for you.", "Ruang kerja yang bersambung, direka untuk anda.")}</p>
        <ul className={css.highlights}>
          <Highlight icon="verify" title={L("Secure Access", "Akses Selamat")} sub={L("Keep your account and data protected.", "Akaun dan data anda kekal dilindungi.")} />
          <Highlight icon="cloud" title={L("Cloud Protected", "Dilindungi Awan")} sub={L("Verified and secured by Cloudflare.", "Disahkan dan dilindungi oleh Cloudflare.")} />
          <Highlight icon="devices" title={L("Web + PWA Ready", "Sedia Web + PWA")} sub={L("A smooth experience on desktop and mobile.", "Pengalaman lancar di desktop dan telefon.")} />
        </ul>
      </div>
      <p className={css.copyright}>© A2Z Creative Marketing</p>
      <Waves variant="panel" />
    </aside>
  );
}

/** v1.345.0 - Protected by Cloudflare. The status line is the bot check's REAL state
    (useBotCheck): nothing while the check is off, "Checking" only while Cloudflare is
    checking, "Verified" only once Cloudflare has handed a token. Never a made-up state. */
function CloudflareNotice({ lang, state, widget }: { lang: Lang; state: BotState; widget: ReactNode }) {
  const L = tr(lang);
  const status = state === "checking" ? L("Checking your browser…", "Menyemak pelayar anda…")
    : state === "ready" ? L("Browser verified.", "Pelayar disahkan.")
    : state === "unavailable" ? L("The security check could not load. You can still try to sign in.", "Semakan keselamatan tidak dapat dimuatkan. Anda masih boleh cuba log masuk.")
    : null;
  return (
    <section className={css.notice} aria-label={L("Protected by Cloudflare", "Dilindungi oleh Cloudflare")} data-testid="cf-notice" data-state={state}>
      <span className={css.noticeIcon}><AppIcon name="verify" /></span>
      <div className={css.noticeText}>
        <strong>{L("Protected by Cloudflare", "Dilindungi oleh Cloudflare")}</strong>
        <span>{L("A security check may occur, such as browser verification or bot protection, to keep your account safe.", "Semakan keselamatan mungkin berlaku, seperti pengesahan pelayar atau perlindungan bot, untuk memastikan akaun anda selamat.")}</span>
        {status && <span className={css.noticeStatus} role="status" data-state={state}>{state === "ready" && <AppIcon name="success" />}{status}</span>}
        {widget}
      </div>
    </section>
  );
}

/** v1.414.0 - the six boxes. They are DRAWING only: one real input lies over them
    (transparent, never display:none), so a tap gives the system keyboard, long-press
    Paste and the phone's code autofill, and a screen reader meets one labelled field. */
function CodeBoxes({ lang, value, onDigits, inputRef, disabled, invalid, describedBy }: {
  lang: Lang; value: string; onDigits: (raw: string) => void;
  inputRef: RefObject<HTMLInputElement | null>; disabled: boolean; invalid: boolean; describedBy: string;
}) {
  const L = tr(lang);
  const active = Math.min(value.length, 5);
  return (
    <div className={css.boxes} data-testid="code-boxes">
      <label htmlFor="code" className={css.srOnly}>{L("Authenticator code, 6 digits", "Kod pengesah, 6 digit")}</label>
      <input
        id="code"
        ref={inputRef}
        className={css.boxInput}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        value={value}
        /* a paste is read whole BEFORE maxlength can cut it: "123 456" and a backup code both arrive intact */
        onPaste={(e) => { e.preventDefault(); onDigits(e.clipboardData.getData("text")); }}
        onChange={(e) => onDigits(e.target.value)}
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={css.box} aria-hidden="true" data-filled={value[i] ? "1" : undefined} data-active={i === active && value.length < 6 ? "1" : undefined}>
          {value[i] ?? ""}
          {i === active && value.length < 6 && <span className={css.caret} />}
        </span>
      ))}
    </div>
  );
}

/** v1.414.0 - the keypad: 1-9, Clear, 0, Delete. A key never takes the focus (pointerdown is
    held), so on a desk the input keeps the keyboard, on a phone the system keyboard never
    opens over the keypad, and no digit is entered twice. Enter / Space press a focused key. */
function Keypad({ lang, disabled, onKey, onClear, onDelete }: {
  lang: Lang; disabled: boolean; onKey: (d: string) => void; onClear: () => void; onDelete: () => void;
}) {
  const L = tr(lang);
  const hold = (e: KeyPointerEvent) => e.preventDefault();
  return (
    <div className={css.keypad} role="group" aria-label={L("Number keypad", "Pad nombor")} data-testid="code-keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} type="button" className={css.key} disabled={disabled} onPointerDown={hold} onClick={() => onKey(d)} data-testid={`key-${d}`}>{d}</button>
      ))}
      <button type="button" className={`${css.key} ${css.keySoft}`} disabled={disabled} onPointerDown={hold} onClick={onClear} data-testid="key-clear">{L("Clear", "Kosongkan")}</button>
      <button type="button" className={css.key} disabled={disabled} onPointerDown={hold} onClick={() => onKey("0")} data-testid="key-0">0</button>
      <button type="button" className={`${css.key} ${css.keySoft}`} disabled={disabled} onPointerDown={hold} onClick={onDelete}
        aria-label={L("Delete the last digit", "Padam digit terakhir")} data-testid="key-delete">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" /><line x1="17" y1="9" x2="12" y2="14" /><line x1="12" y1="9" x2="17" y2="14" />
        </svg>
      </button>
    </div>
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
  /* v1.414.0 - authenticator digits or a backup code: two inputs, never one box for both */
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [backup, setBackup] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  /* the digits as they are THIS moment: two key presses inside one frame both read it, so neither is lost */
  const codeLive = useRef("");
  const putCode = (v: string) => { codeLive.current = v; setCode(v); };
  const [busy, setBusy] = useState(false);
  /* v1.341.0 - the Cloudflare bot check (the worker sends the public site key; none = off) */
  const [botKey, setBotKey] = useState<string | null>(null);
  const bot = useBotCheck(botKey, "signin");
  const [helpOpen, setHelpOpen] = useState(false);
  /* 19-11-2026 - forgot password: the staff member asks for a reset link by email */
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState("");
  /* v1.264.0 - the worker says which ways in are on (GET /auth/methods);
     until it answers the Google button shows, as it always has */
  const [googleOn, setGoogleOn] = useState(true);
  /* v1.269.0 - Phase 2A: shown only when the worker says passkeys are on AND this browser offers them */
  const [passkeyOn, setPasskeyOn] = useState(false);
  /* v1.266.0 (R11) - after a failed Google sign-in, one line for everybody (it
     says nothing about any account): the old Google customers are helped in person */
  const [oauthHint, setOauthHint] = useState(false);
  /* v1.266.1 - the worker's reference for a failed Google sign-in (a stage
     letter and a code also kept in the audit history); it says nothing about
     any account, so it is shown to everybody */
  const [oauthRef, setOauthRef] = useState("");
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
      body: JSON.stringify(challenge === VIA_COOKIE ? { code: value } : { challenge, code: value }),
    });
    setBusy(false);
    verifying.current = false;
    const why = (res.data as { error?: { code?: string } } | null)?.error?.code;
    if (res.ok && res.data?.user) {
      window.location.replace(destinationFor(res.data.user.role));
    } else if (why === "challenge_expired" || why === "too_many_attempts" || why === "changed_meanwhile") {
      /* the attempt is over - back to the sign-in form, which says why */
      setChallenge(""); resetCode();
      setError(why === "too_many_attempts"
        ? L("Too many incorrect codes — please sign in again.", "Terlalu banyak kod yang salah — sila log masuk semula.")
        : why === "changed_meanwhile"
          ? L("Your account changed while you were signing in, so nothing was linked or changed. Please sign in again.", "Akaun anda berubah semasa anda log masuk, jadi tiada apa-apa dipautkan atau diubah. Sila log masuk semula.")
          : L(...EXPIRED));
    } else if (res.status === 429) {
      setError(L("Too many attempts — try again in 15 minutes.", "Terlalu banyak percubaan — cuba lagi dalam 15 minit."));
    } else {
      /* v1.414.0 - a wrong authenticator code empties the six boxes for the next try; a backup code stays to be corrected */
      if (/^\d{6}$/.test(value)) putCode("");
      setError(L(
        "That code is not correct. Check your authenticator app, or use a backup code.",
        "Kod itu tidak betul. Semak aplikasi pengesah anda, atau gunakan kod sandaran.",
      ));
    }
  };

  /* v1.414.0 - the code screen focuses its input on a desk only. On a phone the keypad comes first and the
     system keyboard stays shut until the boxes are tapped (that tap is the way to paste and autofill). */
  useEffect(() => {
    if (challenge && mode === "totp" && window.matchMedia?.("(min-width: 1024px)").matches) codeRef.current?.focus();
  }, [challenge, mode]);

  /** v1.414.0 (the CEO's keypad reference, 21-11-2026, "As recommended") - the
      AUTHENTICATOR code: six digits, typed, pasted, autofilled or tapped on the
      keypad, kept in ONE real input under six drawn boxes. Leading zeros stay
      (it is text). Something with letters in it is a backup code: the screen
      moves to backup mode with it filled in, so a pasted backup code is never
      cut down to digits and lost. The sixth digit signs in by itself, as it
      always has (v1.241.0 A1). */
  const onDigits = (raw: string) => {
    if (/[A-Za-z]/.test(raw)) { setError(""); setMode("backup"); putCode(""); onBackup(raw); return; }
    const next = raw.replace(/\D/g, "").slice(0, 6);
    putCode(next);
    if (/^\d{6}$/.test(next) && !busy) void verifyCode(next);
  };
  /** A BACKUP code (v1.241.0 go-live audit A1): ten letters and digits with a
      dash (ABCDE-FGHIJ, worker index.ts makeBackupCodes) - or, issued before
      v1.5.0, eight DIGITS, so digits are kept too. Eleven characters at most,
      upper-cased as the server compares them; never sent on its own. */
  const onBackup = (raw: string) => {
    let next = raw.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 11);
    /* a backup code typed without its dash (ABCDEFGHIJ) gets it back, since
       the server compares the code exactly as it was issued */
    if (/[A-Z]/.test(next) && !next.includes("-") && next.length > 5) next = `${next.slice(0, 5)}-${next.slice(5, 10)}`;
    setBackup(next);
  };
  /** six digits in authenticator mode; a backup code of at least six characters in backup mode */
  const codeReady = mode === "totp" ? /^\d{6}$/.test(code) : backup.replace(/-/g, "").length >= 6;
  const codeValue = mode === "totp" ? code : backup;
  /** back to a clean authenticator screen (a new attempt, or Back to sign in) */
  const resetCode = () => { putCode(""); setBackup(""); setMode("totp"); };

  useEffect(() => {
    /* v1.23.1: Google sign-in with 2FA enabled no longer mints a session —
       the callback keeps a 5-minute challenge and lands here with ?2fa=1, and
       the same code screen as password sign-in shows. The session is created
       only after a valid code.
       v1.264.0 (G4): the challenge is in an HttpOnly cookie now, which this
       script cannot read and never needs to - /auth/2fa/verify reads it. If
       it has lapsed, the worker answers challenge_expired and the form says
       so. The old script-readable cookie is cleared if one is left over. */
    /* This effect can fire before the `lang` state above has landed, so it
       reads the device language directly rather than closing over "en". */
    const LE = tr(getLang());
    const q = new URLSearchParams(window.location.search);
    void api<{ google?: boolean; passkeys?: boolean; bot_check?: { site_key: string } | null }>("/auth/methods").then((r) => {
      if (r.ok && r.data?.bot_check?.site_key) setBotKey(r.data.bot_check.site_key);
      if (r.ok && r.data && r.data.google === false) setGoogleOn(false);
      if (r.ok && r.data?.passkeys === true && passkeysSupported()) setPasskeyOn(true);
    });
    if (q.get("2fa") === "1") {
      if (document.cookie.includes("twofa_challenge=")) document.cookie = "twofa_challenge=; Secure; SameSite=Lax; Path=/; Max-Age=0";
      requestAnimationFrame(() => setChallenge(VIA_COOKIE)); // after the first paint, like every other state this effect sets
      return; // no /auth/me probe — there is deliberately no session yet
    }
    // Already signed in? Route straight to the right place.
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data?.user) window.location.replace(destinationFor(r.data.user.role));
    });
    /* v1.211.0 - every Google sign-in that did not end in a session comes
       back here (worker: OAUTH_FAILED), and says the one sentence */
    const why = q.get("error");
    if (why === "bot") requestAnimationFrame(() => setError(LE(...BOT_FAILED))); // v1.341.0 - the Google door refused the bot check
    if (why === "oauth" || why === "google_off") requestAnimationFrame(() => {
      if (why === "google_off") setGoogleOn(false);
      else {
        setOauthHint(true);
        const r = q.get("ref") ?? "";
        if (/^[SGTA]-[0-9A-F]{6}$/.test(r)) setOauthRef(r);
      }
      setError(LE(...(why === "google_off" ? GOOGLE_OFF : FAILED)));
    });
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

    if (!bot.canSend) {
      setError(L("Please wait - Cloudflare is still checking your browser.", "Sila tunggu - Cloudflare masih menyemak pelayar anda."));
      return;
    }
    setBusy(true);
    setError("");
    const res = await api<{ user: User; twofa_required?: boolean; challenge?: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, bot_token: bot.token }),
    });
    bot.spend(); // a token is good for one try
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
    } else if (res.status === 403 && /^bot_check/.test(String((res.data as { error?: { code?: string } } | undefined)?.error?.code ?? ""))) {
      setError(L(...BOT_FAILED));
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

  /* 19-11-2026 - ask for a reset link. The server answers the same whatever the email is,
     so the page says the same thing too - it never tells whether an account exists. */
  const requestReset = async () => {
    const e = resetEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setResetError(L("Enter the email you sign in with.", "Masukkan e-mel yang anda gunakan untuk log masuk."));
      return;
    }
    if (!bot.canSend) {
      setResetError(L("Please wait - Cloudflare is still checking your browser.", "Sila tunggu - Cloudflare masih menyemak pelayar anda."));
      return;
    }
    setResetBusy(true);
    setResetError("");
    const res = await api<{ ok: boolean }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: e, bot_token: bot.token }),
    });
    bot.spend(); // a token is good for one try
    setResetBusy(false);
    if (res.ok) { setResetSent(true); return; }
    if (res.status === 429) setResetError(L("Too many requests - try again in 15 minutes.", "Terlalu banyak permintaan - cuba lagi dalam 15 minit."));
    else if (res.status === 403) setResetError(L(...BOT_FAILED));
    else if (res.status === 0) setResetError(L("Can't reach the server just now - please try again shortly.", "Tidak dapat menghubungi pelayan buat masa ini - sila cuba lagi sebentar nanti."));
    else setResetError(L("Enter the email you sign in with.", "Masukkan e-mel yang anda gunakan untuk log masuk."));
  };

  /* v1.269.0 - sign in with a passkey: the worker binds the challenge to this
     browser (an HttpOnly cookie), the device asks for Face ID, a fingerprint
     or its PIN, and the worker decides. Any refusal is the same one sentence. */
  const passkeySignIn = async () => {
    if (!bot.canSend) { setError(L("Please wait - Cloudflare is still checking your browser.", "Sila tunggu - Cloudflare masih menyemak pelayar anda.")); return; }
    setBusy(true); setError("");
    const o = await api<{ publicKey: GetOptionsJSON }>("/auth/passkey/login/options", { method: "POST", body: JSON.stringify({ bot_token: bot.token }) });
    bot.spend();
    if (!o.ok || !o.data) {
      setBusy(false);
      setError(o.status === 429 ? L("Too many attempts — try again in 15 minutes.", "Terlalu banyak percubaan — cuba lagi dalam 15 minit.") : o.status === 403 ? L(...BOT_FAILED) : L(...FAILED));
      return;
    }
    let credential: Record<string, unknown>;
    try { credential = await getPasskey(o.data.publicKey); } catch (e) {
      setBusy(false);
      if (!cancelled(e)) setError(L(...FAILED));
      return;
    }
    const res = await api<{ user: User }>("/auth/passkey/login/verify", { method: "POST", body: JSON.stringify({ credential }) });
    setBusy(false);
    if (res.ok && res.data?.user) window.location.replace(destinationFor(res.data.user.role));
    else setError(res.status === 429 ? L("Too many attempts — try again in 15 minutes.", "Terlalu banyak percubaan — cuba lagi dalam 15 minit.") : L(...FAILED));
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
            <span className={css.brandRule} aria-hidden />
          </Link>
          <LangSwitch lang={lang} onPick={pickLang} />
        </div>

        {challenge ? (
          /* v1.414.0 (the CEO's keypad reference, 21-11-2026) - six boxes over one input and a keypad for the
             authenticator code; a separate box for a backup code. Same /auth/2fa/verify, same rules. */
          <div className={css.codeScreen} data-testid="code-screen" data-mode={mode}>
            <span className={css.codeIcon} aria-hidden="true"><AppIcon name={mode === "totp" ? "verify" : "lock"} /></span>
            <h1 className={css.title}>
              {mode === "totp" ? L("Two-factor verification", "Pengesahan dua faktor") : L("Use a backup code", "Guna kod sandaran")}
            </h1>
            <p className={css.lede}>
              {mode === "totp"
                ? L("Enter the 6-digit code from your authenticator app.", "Masukkan kod 6 digit daripada aplikasi pengesah anda.")
                : L("Enter one of your backup codes to sign in.", "Masukkan salah satu kod sandaran anda untuk log masuk.")}
            </p>
            <form
              className={css.form}
              noValidate
              onSubmit={(e) => { e.preventDefault(); if (!busy && codeReady) void verifyCode(codeValue); }}
            >
              {mode === "totp" ? (
                <>
                  <CodeBoxes lang={lang} value={code} onDigits={onDigits} inputRef={codeRef} disabled={busy} invalid={Boolean(error)} describedBy={error ? "code-error" : "code-hint"} />
                  <p id="code-hint" className={css.codeHint}>{L("Tap the boxes to paste or use your keyboard.", "Ketik kotak untuk tampal atau guna papan kekunci anda.")}</p>
                  <Keypad lang={lang} disabled={busy}
                    onKey={(d) => { if (codeLive.current.length < 6) onDigits(codeLive.current + d); }}
                    onClear={() => putCode("")}
                    onDelete={() => putCode(codeLive.current.slice(0, -1))} />
                </>
              ) : (
                <>
                  <Field id="backup-code" label={L("Backup code", "Kod sandaran")}>
                    <input
                      id="backup-code"
                      className={`${inputClassLg} ${css.backupInput}`}
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={11}
                      autoFocus
                      disabled={busy}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? "code-error" : "backup-about"}
                      placeholder={L("e.g. ABCDE-FGHIJ", "cth. ABCDE-FGHIJ")}
                      value={backup}
                      onPaste={(e) => { e.preventDefault(); onBackup(e.clipboardData.getData("text")); }}
                      onChange={(e) => onBackup(e.target.value)}
                    />
                  </Field>
                  <div id="backup-about" className={css.backupAbout}>
                    <AppIcon name="info" />
                    <span><strong>{L("About backup codes", "Tentang kod sandaran")}</strong>
                      {L("A backup code is a one-time code you saved when setting up two-factor authentication.", "Kod sandaran ialah kod sekali guna yang anda simpan semasa menyediakan pengesahan dua faktor.")}</span>
                  </div>
                </>
              )}
              {error && <ErrorNote id="code-error" message={error} />}
              <button type="submit" disabled={busy || !codeReady} className={btnClassBlock} data-testid="code-verify">
                {busy ? L("Verifying…", "Mengesahkan…") : L("Verify and sign in", "Sahkan dan log masuk")}
              </button>
            </form>
            <div className={css.help}>
              <button type="button" className={css.linkBtn} data-testid="code-mode"
                onClick={() => { setError(""); if (mode === "totp") { putCode(""); setMode("backup"); } else { setBackup(""); setMode("totp"); } }}>
                {mode === "totp" ? L("Use a backup code instead", "Guna kod sandaran") : L("Use authenticator code instead", "Guna kod pengesah")}
              </button>
              <button type="button" className={css.backLink}
                onClick={() => { setChallenge(""); resetCode(); setError(""); }}>
                <AppIcon name="previous" />{L("Back to sign in", "Kembali ke log masuk")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className={css.title}>{L("Sign in", "Log masuk")}</h1>
            <p className={css.lede}>{L("Securely access your A2Z OS account.", "Akses akaun A2Z OS anda dengan selamat.")}</p>

            {/* v1.345.0 - Google, then the Cloudflare notice on a desk; the notice first on a phone (CSS order) */}
            <div className={css.lead}>
            {googleOn && (
              <a href={`${API}/auth/google${bot.token ? `?bt=${encodeURIComponent(bot.token)}` : ""}`} className={css.google}
                aria-disabled={!bot.canSend || undefined}
                onClick={(e) => { if (!bot.canSend) { e.preventDefault(); setError(L("Please wait - Cloudflare is still checking your browser.", "Sila tunggu - Cloudflare masih menyemak pelayar anda.")); } }}>
                <GoogleMark />
                {L("Continue with Google", "Teruskan dengan Google")}
              </a>
            )}
            {passkeyOn && (
              <button type="button" className={`${css.google} ${css.passkey}`} disabled={busy} onClick={() => void passkeySignIn()}>
                {L("Continue with passkey", "Teruskan dengan kunci laluan")}
              </button>
            )}

            <CloudflareNotice lang={lang} state={bot.state} widget={bot.widgetNode} />
            </div>

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
              {oauthHint && error && (
                <>
                  <p className={css.hint}>{L("Staff: sign in with your email, password and authenticator code, then connect Google once from Profile -> Security. Google is no longer connected by email alone.", "Kakitangan: log masuk dengan e-mel, kata laluan dan kod pengesah, kemudian sambungkan Google sekali dari Profil -> Keselamatan. Google tidak lagi disambungkan melalui e-mel sahaja.")}</p>
                  <p className={css.hint}>{L("Used to sign in with Google and cannot now? Contact A2Z Creative Marketing - we will help you in person.", "Dahulu log masuk dengan Google dan kini tidak boleh? Hubungi A2Z Creative Marketing - kami akan membantu anda secara bersemuka.")}</p>
                  {oauthRef && <p className={css.hint}>{L(`Reference: ${oauthRef}`, `Rujukan: ${oauthRef}`)}</p>}
                </>
              )}

              <button type="submit" className={btnClassBlock} disabled={busy}>
                {busy ? L("Please wait…", "Sila tunggu…") : L("Sign in", "Log masuk")}
              </button>
            </form>

            <div className={css.help}>
              <button type="button" className={css.linkBtn}
                aria-expanded={helpOpen} aria-controls="forgot-panel"
                onClick={() => { setHelpOpen((v) => !v); setResetEmail((v) => v || email); setResetError(""); }}>
                {L("Forgot password?", "Lupa kata laluan?")}
              </button>
              {helpOpen && (
                <div id="forgot-panel" className={css.forgot} data-testid="forgot-panel">
                  {resetSent ? (
                    <p className={css.forgotDone} role="status" data-testid="forgot-sent">
                      {L(
                        "If this email belongs to an A2Z OS staff account, we have sent a link to choose a new password. It works once, for 1 hour - check your inbox and spam folder.",
                        "Jika e-mel ini milik akaun kakitangan A2Z OS, kami telah menghantar pautan untuk memilih kata laluan baharu. Ia berfungsi sekali, selama 1 jam - semak peti masuk dan folder spam anda.",
                      )}
                    </p>
                  ) : (
                    <form className={css.forgotForm} noValidate onSubmit={(e) => { e.preventDefault(); if (!resetBusy) void requestReset(); }}>
                      <p className={css.forgotLede}>
                        {L(
                          "Enter the email you sign in with. We will email you a link to choose a new password.",
                          "Masukkan e-mel yang anda gunakan untuk log masuk. Kami akan menghantar pautan untuk memilih kata laluan baharu.",
                        )}
                      </p>
                      <Field id="reset-email" label={L("Your work email", "E-mel kerja anda")}>
                        <input
                          id="reset-email"
                          className={inputClassLg}
                          type="email"
                          inputMode="email"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          autoComplete="username"
                          placeholder={L("Enter your work email", "Masukkan e-mel kerja anda")}
                          aria-invalid={resetError ? true : undefined}
                          aria-describedby={resetError ? "reset-error" : undefined}
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                        />
                      </Field>
                      {resetError && <ErrorNote id="reset-error" message={resetError} />}
                      <button type="submit" className={css.forgotBtn} disabled={resetBusy} data-testid="forgot-send">
                        {resetBusy ? L("Sending…", "Menghantar…") : L("Email me a reset link", "Hantar pautan tetapan semula")}
                      </button>
                      <p className={css.forgotNote}>
                        {L(
                          "Your authenticator code is still asked when you sign in. No access to this email? Contact A2Z Creative Marketing.",
                          "Kod pengesah anda masih diminta semasa log masuk. Tiada akses ke e-mel ini? Hubungi A2Z Creative Marketing.",
                        )}
                      </p>
                    </form>
                  )}
                </div>
              )}
            </div>
            <p className={css.pwaTag}><AppIcon name="devices" /><strong>{L("A2Z PWA", "A2Z PWA")}</strong><span>{L("Mobile experience", "Pengalaman mudah alih")}</span></p>
          </>
        )}
      </main>
      <Waves variant="phone" />
    </div>
  );
}

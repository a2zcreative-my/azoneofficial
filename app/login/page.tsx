"use client";

/**
 * General login (/login) — one door for everyone.
 * After sign-in, people are routed by role:
 *   customer -> /account · staff roles -> /portal · CMS roles -> /admin
 */

import { useEffect, useState } from "react";

const API = "/api/v1";

interface User { id: number; email: string; name: string; role: string }

const STAFF_ONLY = ["coo", "business_dev", "finance_admin", "live_manager", "live_host"];

function destinationFor(role: string): string {
  if (role === "customer") return "/account";
  if (STAFF_ONLY.includes(role)) return "/portal";
  return "/admin";
}

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => null)) as T | null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const btnClass =
  "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors disabled:opacity-50";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Already signed in? Route straight to the right place.
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data?.user) window.location.replace(destinationFor(r.data.user.role));
    });
    const q = new URLSearchParams(window.location.search);
    if (q.get("error") === "oauth") setError("Google sign-in didn't complete — please try again.");
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
        setError("An account with this email already exists — sign in instead.");
      } else if (res.status === 429) {
        setError("Too many registrations — try again later.");
      } else if (res.status === 400) {
        // Show the real reason from the API instead of guessing
        const msg = (res.data as { error?: { message?: string } } | null)?.error?.message;
        setError(msg ?? "Please check the details and try again.");
      } else if (res.status === 0 || res.status === 404) {
        setError("Can't reach the sign-up service. The API Worker may not be deployed yet — please contact your administrator.");
      } else {
        setError("Sign-up failed — please try again in a moment.");
      }
      return;
    }

    const res = await api<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok && res.data?.user) {
      window.location.replace(destinationFor(res.data.user.role));
    } else if (res.status === 429) {
      setError("Too many attempts — try again in 15 minutes.");
    } else if (res.status === 0) {
      setError("Can't reach the server just now — please try again shortly.");
    } else {
      setError("Email or password is incorrect, or the account is inactive.");
    }
  };

  return (
    <div className="mx-auto mt-24 w-full max-w-sm px-6 pb-16">
      <a href="/" className="inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="AZ ONE OFFICIAL" className="h-8 w-auto" />
      </a>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">
        {mode === "login" ? "Sign in" : "Create your account"}
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        One login for everyone — you&apos;ll be taken to your own area
        automatically.
      </p>

      <div
        role="tablist"
        aria-label="Sign in or create an account"
        className="mt-6 grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary p-1"
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
          Sign in
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
          Create account
        </button>
      </div>

      <a
        href={`${API}/auth/google`}
        className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium transition-colors hover:bg-secondary"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.2C12.3 13.6 17.7 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.4 6.9-17.7z"/>
          <path fill="#FBBC05" d="M10.4 28.7a14.6 14.6 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z"/>
          <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/>
        </svg>
        Continue with Google
      </a>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-muted-foreground text-xs">or with email</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-4">
        {mode === "register" && (
          <input className={inputClass} placeholder="Your name" value={name}
            onChange={(e) => setName(e.target.value)} autoComplete="name" />
        )}
        <input className={inputClass} placeholder="Email" type="email" value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <div className="relative">
          <input
            className={`${inputClass} pr-11`}
            placeholder={mode === "register" ? "Password (10+ characters)" : "Password"}
            type={showPw ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
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
              ? `Password length OK (${password.length} characters)`
              : `${password.length} of 10 characters — ${10 - password.length} more needed`}
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
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        {mode === "register" && (
          <p className="text-muted-foreground text-xs">
            Registration creates a customer account with access to your own
            details and enquiries. Staff and admin access is assigned by AZ ONE
            OFFICIAL administrators.
          </p>
        )}
      </div>
    </div>
  );
}

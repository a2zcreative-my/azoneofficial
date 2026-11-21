"use client";

/* v1.408.0 - THE SIGNED-OUT CARD (the CEO, 21-11-2026, "A2Z OS - Logout &
   Authentication Page UI Improvement"). One card for /portal, /admin and
   /account, in three states that are only ever drawn from a verified fact:

   - "signed_out" - the server answered POST /auth/logout with OK on THIS tab.
     Held in React state only, never in the address, so a refresh or a copied
     link can never claim a sign-out that did not happen (it reads "required").
   - "expired"    - this tab HAD a signed-in person and the server then refused
     the session (a 401 confirmed by a fresh /auth/me). Only /portal knows this.
   - "required"   - everything else: a cold visit with no session. We do not
     guess an expiry we cannot prove.

   Pure presentation: no request, no redirect (so no redirect loop), no user
   detail. The links are the real login route and the public home page; the
   return-to-task path is the existing `azone-return` (validated by the login
   page against /portal only) - nothing new is passed here. Styling: the shared
   .erp-card surface, the shared .erp-button classes, tokens from globals.css. */

import Link from "next/link";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Check, Clock3, House, LockKeyhole, LogIn, LogOut, ShieldOk } from "@/components/layout/nav-icons";
import { btnGhost, card } from "@/lib/ui-styles";
import css from "./auth-state-card.module.css";

export type AuthCardState = "signed_out" | "expired" | "required";
export type AuthCardSurface = "portal" | "admin" | "account";

const SURFACE: Record<AuthCardSurface, { en: string; ms: string }> = {
  portal: { en: "Staff Portal", ms: "Portal Kakitangan" },
  admin: { en: "Admin Console", ms: "Konsol Admin" },
  account: { en: "Client Portal", ms: "Portal Klien" },
};

export function AuthStateCard({ state, surface, L }: {
  state: AuthCardState;
  surface: AuthCardSurface;
  /** the page's own EN/BM helper (same per-device store everywhere) */
  L: (en: string, ms: string) => string;
}) {
  const where = L(SURFACE[surface].en, SURFACE[surface].ms);
  const staff = surface !== "account";

  const heading =
    state === "signed_out" ? L("You've signed out", "Anda telah log keluar")
    : state === "expired" ? L("Your session has expired", "Sesi anda telah tamat tempoh")
    : L("Sign in to A2Z OS", "Log masuk ke A2Z OS");

  const text =
    state === "signed_out"
      ? L(`Your A2Z OS session has ended successfully. Sign in again to access your ${where}.`,
          `Sesi A2Z OS anda telah berjaya ditamatkan. Log masuk semula untuk mengakses ${where} anda.`)
    : state === "expired"
      ? L("For your security, please sign in again to continue using A2Z OS.",
          "Demi keselamatan anda, sila log masuk semula untuk terus menggunakan A2Z OS.")
    : surface === "portal"
      ? L("This Staff Portal is available to authorized A2Z CREATIVE MARKETING employees only.",
          "Portal Kakitangan ini hanya untuk pekerja A2Z CREATIVE MARKETING yang diberi kuasa.")
    : surface === "admin"
      ? L("The Admin Console is available to authorized A2Z CREATIVE MARKETING administrators only.",
          "Konsol Admin hanya untuk pentadbir A2Z CREATIVE MARKETING yang diberi kuasa.")
      : L("The Client Portal is available to A2Z CREATIVE MARKETING clients with an account.",
          "Portal Klien tersedia untuk klien A2Z CREATIVE MARKETING yang mempunyai akaun.");

  const primary = state === "required" ? L("Go to Login", "Pergi ke Log Masuk") : L("Sign In Again", "Log Masuk Semula");
  const Icon = state === "signed_out" ? LogOut : state === "expired" ? Clock3 : LockKeyhole;

  return (
    <main className={css.page} data-testid="auth-state" data-state={state}>
      <section className={`${card} ${css.card}`} aria-labelledby="auth-state-title">
        <header className={css.brand}>
          {/* v1.414.0 (the CEO, 21-11-2026: "remove A2Z OS since there is a A2Z logo there") - the logo names the company; no second wordmark */}
          <BrandLogo />
          <p className={css.company}>A2Z CREATIVE MARKETING</p>
          <p className={css.surface}>{where}</p>
        </header>

        <div className={css.mark} aria-hidden>
          <Icon className={css.markIcon} strokeWidth={1.75} />
          {state === "signed_out" && (
            <span className={css.markBadge}><Check className={css.badgeIcon} strokeWidth={2.5} /></span>
          )}
        </div>

        {/* role="status" so a screen reader announces the result when the
            card replaces the page after a sign-out or an expiry */}
        <div role="status" aria-live="polite">
          <h1 id="auth-state-title" className={css.title}>{heading}</h1>
          <p className={css.text}>{text}</p>
        </div>

        <div className={css.actions}>
          <Link href="/login" className={`erp-button erp-button-accent erp-button-block ${css.action}`} data-testid="auth-state-login">
            <LogIn aria-hidden className="erp-icon" strokeWidth={1.75} />{primary}
          </Link>
          <Link href="/" className={`${btnGhost} erp-button-block ${css.action}`} data-testid="auth-state-website">
            <House aria-hidden className="erp-icon" strokeWidth={1.75} />{L("Back to Website", "Kembali ke Laman Web")}
          </Link>
        </div>

        {staff && (
          <p className={css.foot}>
            <ShieldOk aria-hidden className="erp-icon" strokeWidth={1.75} />
            {L("Authorized staff access only", "Akses kakitangan yang diberi kuasa sahaja")}
          </p>
        )}
      </section>
    </main>
  );
}

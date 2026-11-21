"use client";

/**
 * A2Z CREATIVE MARKETING — Admin Portal (v0, modest)
 * Static-exported client app talking to the API Worker at /api/v1
 * (same origin via the azoneofficial.com/api/* route).
 */

import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { signOutRequest } from "@/lib/push-client"; // v1.226.0: signing out unbinds this device's push
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { useEffect, useState } from "react";
import { AdminOverview } from "@/components/admin/admin-overview"; // v1.349.0 - Phase 2
import { AdminUsers } from "@/components/admin/admin-users"; // v1.349.0 - Phase 2
import { AdminSecurity } from "@/components/admin/admin-security"; // v1.351.0 - Phase 3
import { AdminAccount } from "@/components/admin/admin-account"; // v1.351.0 - Phase 3
import { AdminWebsite } from "@/components/admin/admin-website"; // v1.352.0 - Phase 4
import { SignaturesPanel } from "@/components/admin/signatures-panel"; // v1.38.0 (S-1)
import { card } from "@/lib/ui-styles";
import { PortalSkeleton } from "@/components/portal/portal-skeleton"; // v1.228.0
import { ConsoleShell } from "@/components/layout/console-shell"; // v1.228.0 - the portal chrome
import { getLang, type Lang } from "@/lib/i18n";
import { AuthStateCard } from "@/components/auth/auth-state-card"; // v1.408.0 - the signed-out card
import { useFeedback } from "@/components/ui/feedback-modal"; // v1.408.0 - a failed sign-out is said
import { clearApiCache } from "@/lib/cached-api";


/* v1.25.7 — EN/BM for the admin console. Same storage as the portal
   (localStorage azone-lang, lib/i18n). L() re-reads per render, so the
   header toggle's re-render flips the whole page. Display-point only:
   role/status/tab VALUES stay English — they are compared and sent to
   the API — and map to BM labels only where they are shown. */
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  requires_2fa?: boolean;
  is_owner?: boolean; // v1.249.2 - the verified company owner (server-set)
}

/* ---------------- Website Content: components/admin/admin-website.tsx (v1.352.0) ---------------- */

/* ---------------- Account (every admin user) ---------------- */

/* ---------------- My Account: components/admin/admin-account.tsx (v1.351.0) ---------------- */

/* ---------------- Users: components/admin/admin-users.tsx (v1.349.0) ---------------- */

/* ---------------- Shell ---------------- */

/* v1.348.0 (the CEO, 17-11-2026: "/Admin are totally super admin control") -
   Enquiries and Staff are retired here (Sales → Customers & Follow-ups, and the
   portal's Staff, Leave and HR own them); the signature vault, which lives
   nowhere else, is its own tab. */
/* v1.352.0 - Phase 4: Website, Portfolio, Testimonials, Posts, Media and Advanced are ONE tab, Website Content */
const TABS = [
  "Dashboard",
  "Website",
  "Users",
  "Signatures",
  "Audit",
  "Account",
] as const;
type Tab = (typeof TABS)[number];

/* BM labels for the tab KEYS above — display only. The Tab values themselves
   drive routing, icon lookup and role gating, so they stay English. */
const TAB_MS: Record<Tab, string> = {
  Dashboard: "Gambaran Keseluruhan",
  Website: "Kandungan Laman Web",
  Users: "Pengguna",
  Signatures: "Tandatangan",
  Audit: "Keselamatan & Audit",
  Account: "Akaun Saya",
};
/* v1.351.0 - the plan's names on screen; the keys (routing, icons, guards) stay as they were */
const TAB_EN: Partial<Record<Tab, string>> = { Dashboard: "Overview", Website: "Website Content", Audit: "Security & Audit", Account: "My Account" };
const tabLabel = (t: Tab) => L(TAB_EN[t] ?? t, TAB_MS[t]);
/* v1.228.0 - how the rail and the More sheet group the admin tabs (the
   portal's grouped-rail pattern, components/layout/side-nav.tsx) */
const ADMIN_SECTIONS = [
  { title: "Overview", tabs: ["Dashboard"] },
  { title: "Content", tabs: ["Website"] },
  { title: "People", tabs: ["Users"] },
  { title: "System", tabs: ["Signatures", "Audit"] },
  { title: "Account", tabs: ["Account"] },
];

/* v1.11.0: the mobile bottom nav shows an icon per tab, exactly like /portal.
   v1.16.0: the local emoji map is gone — admin's tab names live in the shared
   SVG map (components/layout/nav-icons.tsx) alongside the portal's, so the
   surfaces speak one icon language and get tintable strokes. */


/** Plain-language purpose line shown under the tab bar. */
const TAB_HELP: Record<Tab, string> = {
  Dashboard: "The console's state: accounts, backups, errors, database updates and recent activity.",
  Website: "The public website: its text, posts, portfolio, testimonials, media and content keys.",
  Users: "Staff and customer accounts — roles, suspension, force logout.",
  Signatures: "Officer signatures and company stamps for each issuing company.",
  Audit: "The full audit trail, backups, errors and database updates.",
  Account: "Your own password, two-factor, Google sign-in, passkeys and recovery.",
};

/* BM twin of TAB_HELP — same keys, display only. */
const TAB_HELP_MS: Record<Tab, string> = {
  Dashboard: "Keadaan konsol: akaun, sandaran, ralat, kemas kini pangkalan data dan aktiviti terkini.",
  Website: "Laman web awam: teks, kiriman, portfolio, testimoni, media dan kunci kandungannya.",
  Users: "Akaun kakitangan dan pelanggan — peranan, penggantungan, paksa log keluar.",
  Signatures: "Tandatangan pegawai dan cop syarikat bagi setiap syarikat pengeluar.",
  Audit: "Jejak audit penuh, sandaran, ralat dan kemas kini pangkalan data.",
  Account: "Kata laluan, dua faktor, log masuk Google, kunci laluan dan pemulihan anda sendiri.",
};

/* v1.77.0 — the console's first paint while /auth/me answers (and while a
   redirect to /login, /portal or /account is on its way). Pure presentational:
   the SAME shell (full-width canvas since v1.88.2, navy rail, header row, house cards in
   the Dashboard's own layout, bottom nav on phones), so nothing jumps when the
   real console takes over. No hooks, no fetch. */
function AdminPageSkeleton() {
  /* v1.228.0 - the portal's own first paint: the same rail, header and bar
     the console shell draws, so nothing jumps when the page takes over */
  return <PortalSkeleton />;
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<Tab>("Dashboard");
  /* v1.265.0 - back from Connect Google (?google=...): the Account tab, where the panel says how it went */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("google")) requestAnimationFrame(() => setTab("Account" as Tab));
  }, []);
  /* v1.25.7: EN/BM toggle — same storage as /portal. State lives here so
     flipping it re-renders the whole console (L() re-reads per render).
     Hydrated in an effect because localStorage is client-only. */
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { setLangState(getLang()); }, []);

  // v1.228.0 - the More sheet (and its scroll lock) lives in ConsoleShell now.

  /* v1.241.0 (go-live audit A3) - also re-read after the 2FA gate's
     enrolment, so the gate clears without a sign-out. */
  const loadMe = () =>
    api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data) setUser(r.data.user);
      setChecked(true);
    });
  useEffect(() => {
    void loadMe();
  }, []);
  /* v1.408.0 - a page restored from the back/forward cache asks the server
     again before it is trusted (Back after signing out elsewhere) */
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) void loadMe(); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  /* v1.408.0 - "signed_out" only after POST /auth/logout answered OK on this
     tab (state, never the address). /admin cannot prove an expiry, so it
     never claims one: no user and no confirmed sign-out = "Sign in". */
  const [signedOut, setSignedOut] = useState(false);
  const feedback = useFeedback();
  const signOut = () => {
    const failed = () =>
      feedback.show({
        variant: "error",
        title: L("Sign out did not complete", "Log keluar tidak selesai"),
        description: L("You are still signed in. Check your connection and try again.",
          "Anda masih log masuk. Semak sambungan anda dan cuba lagi."),
        testid: "signout-failed",
      });
    void signOutRequest()
      .then((r) => {
        if (!r.ok || r.queued) return failed();
        clearApiCache();
        setUser(null);
        setSignedOut(true);
      })
      .catch(failed);
  };

  /* v1.77.0 — skeleton until the first fetch lands. The auth check used to
     return null (a blank screen with a name); the page-shaped shell paints
     instead, and stays up while any redirect below is on its way. */
  if (!checked) return <AdminPageSkeleton />;
  /* v1.408.0 - no session: the card, not a jump to /login (no redirect loop,
     and the person is told what happened) */
  if (!user) return <AuthStateCard state={signedOut ? "signed_out" : "required"} surface="admin" L={L} />;
  // Data-integrity boundary: /admin is the content-management interface for
  // admin/editor/marketing only. Staff roles work in /portal — even though
  // the API also enforces this, they should never see this surface at all.
  /* v1.249.2 (the owner, 01-11-2026) - the verified company owner opens
     /admin for one thing: Users, to give and take every role. Any other CEO
     account, and every other portal role, still goes to /portal. */
  /* v1.348.0 (the CEO, 17-11-2026) - /admin is the SUPER ADMIN's console and
     nobody else's: the company owner gives and takes roles in portal Users
     (the same server rule, roleChangeRule), the admin role and every other
     staff role work in /portal, a customer in /account. The server refuses the
     website content to everyone but the super admin as well (content_manage). */
  if (user.role === "customer") {
    if (typeof window !== "undefined") window.location.replace("/account");
    return <AdminPageSkeleton />;
  }
  if (user.role !== "super_admin") {
    if (typeof window !== "undefined") window.location.replace("/portal");
    return <AdminPageSkeleton />;
  }

  if (user.requires_2fa) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-12 md:py-24">
        <div className={card}>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
            {L("Two-Factor Authentication Required", "Pengesahan Dua Faktor Diperlukan")}
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">
            {L("Your role requires two-factor authentication to be enabled before you can access the A2Z CREATIVE MARKETING Admin Portal. Please set it up now.",
              "Peranan anda memerlukan pengesahan dua faktor diaktifkan sebelum anda boleh mengakses Portal Admin A2Z CREATIVE MARKETING. Sila tetapkannya sekarang.")}
          </p>
          <TwoFactorPanel onEnabled={() => void loadMe()} />
          {feedback.node}
          <div className="mt-8 flex justify-end border-t border-border pt-6">
            <button
              onClick={() => {
                /* v1.5.0 fix: azone_session is HttpOnly — document.cookie
                   could never clear it, so this button bounced users straight
                   back here. A real server-side logout now. */
                signOut(); // v1.408.0 - the one verified sign-out
              }}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {L("Sign out", "Log keluar")}
            </button>
          </div>
        </div>
      </div>
    );
  }



  /* v1.164.1: phone bottom spacing follows the shared PWA nav clearance used
     by /portal and /account. */
  /* v1.22.8 (CEO: "/admin and /account also I found doesnt follow UI/UX as
     /portal"): the admin console now sits on the SAME shell as the portal —
     navy backdrop, rounded canvas, internal scroll on desktop — and every
     section renders inside a house card. Phones untouched (md:-prefixed).
     v1.23.0 (CEO: "Where is the sidebar for /account and /admin as same as
     /portal?"): the navy ICON RAIL too — same SidebarNav component, fed the
     admin tabs. The desktop pill row is gone (the rail replaces it, exactly
     like /portal); phones keep the bottom navigation. */
  const visibleTabs: Tab[] = [...TABS]; // v1.348.0 - one person reaches this page: the super admin
  const tabNow: Tab = visibleTabs.includes(tab) ? tab : visibleTabs[0]!;
  /* v1.228.0 (the owner, 30-10-2026: "/admin and /account should follow the
     interface of /portal"): the console now wears the portal's chrome -
     the light grouped rail, the .erp-topbar header, the tinted phone bar and
     the More sheet - through components/layout/console-shell.tsx. The tabs,
     their order, the role gates and every panel below are unchanged. */
  return (
    <ConsoleShell
      eyebrow={L("A2Z Admin Console", "Konsol Admin A2Z")}
      items={visibleTabs.map((t) => ({ name: t, label: tabLabel(t) }))}
      sections={ADMIN_SECTIONS}
      active={tabNow}
      onSelect={(t) => setTab(t as Tab)}
      title={tabLabel(tabNow)}
      phoneTitle={tabLabel(tabNow)}
      user={user}
      lang={lang}
      onLang={setLangState}
      onSignOut={signOut}
    >
      {feedback.node}
      <main key={tabNow} className="screen-enter mt-4 md:mt-8">
        <p className="text-muted-foreground -mt-2 mb-4 text-xs">{L(TAB_HELP[tabNow], TAB_HELP_MS[tabNow])}</p>
        {/* v1.22.8: bare sections now render inside the house card, exactly
            like every /portal module. Staff/Audit/Account tabs already use
            card components of their own. */}
        {tabNow === "Dashboard" && <AdminOverview onOpen={(t) => setTab(t as Tab)} />}
        {tabNow === "Website" && <AdminWebsite />}
        {tabNow === "Users" && <AdminUsers me={user} />}
        {/* v1.4.192: standard multi-card spacing wrapper (was ad-hoc mt-6 divs) */}
        {tabNow === "Signatures" && <SignaturesPanel />}
        {tabNow === "Audit" && <AdminSecurity />}
        {tabNow === "Account" && <AdminAccount onReload={() => void loadMe()} />}
      </main>
    </ConsoleShell>
  );
}

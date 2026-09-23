/**
 * PORTAL ROUTING — the policy over the registry's URL data. P1.0, v1.180.0.
 *
 * `lib/portal-tabs.ts` says WHICH tabs exist, who may see them and what each
 * one's slug is. This file says what a URL MEANS, and it is deliberately
 * nothing but pure functions: no React, no storage, no fetch, no router. The
 * page reads the address and the storage and hands the values in; everything
 * here can therefore be RUN by a guard rather than read by a human, which is
 * the only way the precedence rules below stay true.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ENTRY IS NOT HOME.
 *
 *   /portal        the ENTRY RESOLVER. Never a destination, never linked to
 *                  by the product. It looks at a legacy ?tab=, then the
 *                  remembered tab, then the shift flag, and REPLACES the
 *                  address with a canonical one.
 *
 *   /portal/home   the Dashboard. Consults nothing at all.
 *
 * The first draft of the P1 architecture made `/portal` both, and the owner
 * found what that costs: a person standing on /portal/sales, with Sales in
 * sessionStorage, presses Home, arrives at /portal, and the resolver sends
 * them back to Sales. Home did nothing. The same trap closes on anyone who
 * deliberately leaves On Shift while `launch_shift` is set.
 *
 * Two URLs, two jobs, and the bug cannot be written.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ROUTING IS NOT AUTHORIZATION. Every function here that can name a tab
 * takes the ALREADY permission-filtered list and can only return something
 * from it. It has no access to the unfiltered registry, so there is no way
 * to call it that bypasses `canSeeTab` — and underneath all of it the worker
 * still gates every byte per endpoint (AUDIT M13). A URL decides what is
 * DRAWN. It has never decided what is allowed and it does not start here.
 */

import { ALL_TABS, TAB_ROUTE, canSeeTab, type PersonAccess, type TabName } from "@/lib/portal-tabs";

/** The entry resolver. Not a destination — see the header. */
export const PORTAL_ENTRY = "/portal";

/** The Dashboard. Everything that means "take me home" points here: the
    rail, the phone bar's Home stop, the command palette, the logo, and
    app/portal/error.tsx's crash recovery. */
export const PORTAL_HOME = "/portal/home";

/** The slug for a tab, or null when it has none (a parked tab). */
export function slugOf(tab: TabName): string | null {
  return TAB_ROUTE[tab]?.slug ?? null;
}

/** The canonical path for a tab, or null when it has no route. */
export function pathOf(tab: TabName): string | null {
  const slug = slugOf(tab);
  return slug ? `${PORTAL_ENTRY}/${slug}` : null;
}

/**
 * The tab a slug names, or null.
 *
 * Built once, from TAB_ROUTE, so it cannot disagree with it. A slug that is
 * not in the registry — a typo, a retired module, a parked one, or something
 * a stranger typed — is null, and null is always handled as "go home".
 */
const BY_SLUG: ReadonlyMap<string, TabName> = new Map(
  (Object.entries(TAB_ROUTE) as [TabName, { slug: string }][])
    .map(([tab, route]) => [route.slug, tab] as const),
);

export function tabOfSlug(slug: string): TabName | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * The tab a pathname names, or null.
 *
 * `/portal` itself is null: it is the resolver, not a module. A path with
 * anything after the slug is null too — records are addressed by query
 * string, never by a second segment, because a static export cannot
 * pre-render a D1 id.
 */
export function tabOfPath(pathname: string): TabName | null {
  if (typeof pathname !== "string") return null;
  const clean = (pathname.split("?")[0] ?? "").split("#")[0]?.replace(/\/+$/, "") ?? "";
  if (clean === PORTAL_ENTRY || clean === "") return null;
  if (!clean.startsWith(`${PORTAL_ENTRY}/`)) return null;
  const rest = clean.slice(PORTAL_ENTRY.length + 1);
  if (rest === "" || rest.includes("/")) return null;
  return tabOfSlug(rest);
}

/** Is this address inside the portal at all? */
export function isPortalPath(pathname: string): boolean {
  if (typeof pathname !== "string") return false;
  const clean = (pathname.split("?")[0] ?? "").split("#")[0]?.replace(/\/+$/, "") ?? "";
  return clean === PORTAL_ENTRY || clean.startsWith(`${PORTAL_ENTRY}/`);
}

/* =====================================================================
   THE LEGACY ?tab= RESOLVER.

   v1.105.0 taught the worker to deep-link a push notification as
   `/portal?tab=Leave`, and those links are in people's notification
   shades, in emails and in bookmarks. They keep working, for ever, through
   this one function.
   ===================================================================== */

export type LegacyResolution =
  | { kind: "route"; tab: TabName; href: string }
  | { kind: "home"; href: typeof PORTAL_HOME };

const GO_HOME: LegacyResolution = { kind: "home", href: PORTAL_HOME };

/**
 * What a `?tab=` value should become.
 *
 * | input                    | result                                    |
 * |--------------------------|-------------------------------------------|
 * | valid + permitted        | that module's canonical path              |
 * | `Dashboard`              | /portal/home — an ordinary module now     |
 * | valid + NOT permitted    | home, silently (today's clamp, unchanged) |
 * | parked (Threads…)        | home — parked outranks an address too     |
 * | retired (Purchasing…)    | home — not in ALL_TABS; a typo, and right |
 * | unknown / junk / null    | home — never interpolated into a path     |
 *
 * `permitted` is the caller's already-filtered list. The returned `href` is
 * built from TAB_ROUTE, never from `raw`, so no input can reach the address
 * bar.
 */
/** Does this name a tab that exists? Parked counts as existing — it is in
    ALL_TABS — which is what makes `?tab=Threads` an instruction that is
    answered (with home) rather than junk that falls through. */
export function isKnownTab(raw: string | null | undefined): raw is TabName {
  return typeof raw === "string" && raw !== "" && (ALL_TABS as readonly string[]).includes(raw);
}

export function resolveLegacyTab(
  raw: string | null | undefined,
  permitted: readonly TabName[],
): LegacyResolution {
  if (typeof raw !== "string" || raw === "") return GO_HOME;
  if (!(ALL_TABS as readonly string[]).includes(raw)) return GO_HOME;
  const tab = raw as TabName;
  if (!permitted.includes(tab)) return GO_HOME;
  const href = pathOf(tab);
  if (!href) return GO_HOME; // parked: no route, and no way to reach one
  return { kind: "route", tab, href };
}

/* =====================================================================
   THE ENTRY RESOLVER — what a bare /portal does.

   THE ORDER IS v1.179.0's ORDER. app/portal/page.tsx:203-239 already puts a
   legacy ?tab= above the remembered tab, and the remembered tab above the
   `launch_shift` fetch. Reordering any of it would change who lands where on
   a shift morning, which is a product change wearing a routing costume.

   The only thing P1 changes is the last line: instead of rendering the
   Dashboard in place, it REPLACES the address with /portal/home, so that
   after the redirect the resolver is not in the history at all and Back does
   not bounce the person forward again.
   ===================================================================== */

export interface EntryInput {
  /** the ?tab= value on /portal, if any */
  legacyTab?: string | null;
  /** sessionStorage azone-tab:{id} — a TAB NAME, not a slug, so an entry
      written by v1.179.0 still resolves after the upgrade */
  remembered?: string | null;
  /** today_shift.entry.launch_shift from /staff/attendance */
  launchShift?: boolean;
  /** the already permission-filtered list */
  permitted: readonly TabName[];
}

export interface EntryResolution {
  href: string;
  tab: TabName | null;
  /** which rule decided, so the guard can assert the ORDER and not merely
      the destination — two rules can agree on an answer by accident */
  reason: "legacy" | "remembered" | "launch_shift" | "home";
}

export function resolveEntry(input: EntryInput): EntryResolution {
  const permitted = input.permitted ?? [];
  const home: EntryResolution = { href: PORTAL_HOME, tab: null, reason: "home" };

  /* 1. a legacy deep link wins: somebody or something sent the person HERE.

        "Wins" means: a ?tab= NAMING A REAL TAB is answered, and the
        remembered tab is not consulted - even when the person may not open
        it, in which case the answer is home. That is v1.179.0's behaviour
        exactly (page.tsx:207-215: the branch is entered on
        `ALL_TABS.includes(wanted)` and RETURNS, and the render-time clamp
        then sends an unauthorised tab to the Dashboard).

        A ?tab= naming NOTHING - a typo, a retired module, junk - is not an
        instruction at all, and falls through to the remembered tab, which is
        also what v1.179.0 does. The browser probe caught this: the first
        draft consumed it, which would have sent a person with a stale
        bookmark home instead of back to where they were. */
  if (isKnownTab(input.legacyTab)) {
    const legacy = resolveLegacyTab(input.legacyTab, permitted);
    return legacy.kind === "route"
      ? { href: legacy.href, tab: legacy.tab, reason: "legacy" }
      : home;
  }

  /* 2. where they were, if they may still be there. A remembered tab that is
        parked, retired, unknown or no longer permitted simply falls through;
        the CALLER deletes the stored entry. It is never rewritten to
        Dashboard and stored, which would overwrite a good memory because of
        one revoked permission. */
  if (typeof input.remembered === "string" && input.remembered !== "") {
    const back = resolveLegacyTab(input.remembered, permitted);
    if (back.kind === "route") {
      return { href: back.href, tab: back.tab, reason: "remembered" };
    }
  }

  /* 3. the shift flag, exactly as v1.179.0 applies it: only when nothing
        above decided, and only towards On Shift. */
  if (input.launchShift) {
    const shift = resolveLegacyTab("On Shift", permitted);
    if (shift.kind === "route") {
      return { href: shift.href, tab: shift.tab, reason: "launch_shift" };
    }
  }

  return home;
}

/**
 * Should a remembered value be thrown away?
 *
 * True when it names nothing this person may open right now. The caller
 * deletes the sessionStorage entry when this says so — see resolveEntry's
 * step 2 for why deletion and not rewriting.
 */
export function rememberedIsStale(
  remembered: string | null | undefined,
  permitted: readonly TabName[],
): boolean {
  if (typeof remembered !== "string" || remembered === "") return false;
  return resolveLegacyTab(remembered, permitted).kind !== "route";
}

/**
 * The permission-filtered tab list, from the same rule the 🔐 card renders
 * from. Every routing decision in P1 starts here, so there is exactly one
 * place where "may this person open this" is answered on the client — and it
 * is the place that already answered it.
 */
export function permittedTabs(
  role: string | null | undefined,
  overrides: Record<string, string[]> = {},
  person: PersonAccess | null = null,
): TabName[] {
  return ALL_TABS.filter((t) => canSeeTab(role, t, overrides, person));
}

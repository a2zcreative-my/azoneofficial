#!/usr/bin/env node
/* Guard #57 — v1.129.0: the Cards tab belongs to the three officers.
 *
 * CEO, 06-09-2026: *"only ceo, coo, cco can share their business card to
 * client and the other staff cant access this tabs to share the link or to
 * generate any of the business card of CEO, COO and CCO."*
 *
 * WHAT THIS GUARD IS ACTUALLY ABOUT, and it is worth being exact because the
 * word "access" can mean two things here.
 *
 * It is an ORGANISATIONAL boundary: no staff member outside the three is
 * offered a way, in the portal, to share a director's card. It is NOT a
 * secrecy boundary and cannot be: a2zcreative.my/farhan is a static page on a
 * CDN, printed on paper, with a QR code on it. There is no API behind this
 * tab and nothing for a server-side gate to protect — the three records are
 * static and the page is a link away for anybody on earth.
 *
 * That distinction is the reason for check 5 below. A tab that looks like a
 * lock but is not one is worse than no tab, so the panel has to SAY what the
 * restriction is, on screen, in both languages.
 *
 * The visibility check runs the REAL rule. Every other tab's roles are
 * asserted by reading a list; this one imports canSeeTab and asks it about
 * every role in the system, so a future change to the rule itself — a new
 * bypass, a reordered rail — is caught here rather than agreeing with a list
 * that no longer decides anything.
 *
 * Run: node --experimental-strip-types tests/cards-tab.mjs
 *
 * Negative-tested by: adding marketing to the Cards roles; removing the CCO;
 * dropping the public-pages sentence from the panel; making the QR lock
 * <html> instead of BODY; loading the panel statically in page.tsx.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* v1.139.1 - fileURLToPath, NOT .pathname.
   On Windows `new URL("..", import.meta.url).pathname` is "/C:/Users/..." -
   a URL path with a leading slash, not a file path - so join() produced
   "\\C:\\Users\\..." and every read failed with "C:\\C:\\Users\\...". These
   guards had only ever run in Cloudflare's Linux build container, where the
   two happen to be the same string; the day PUSH.bat started running them on
   the CEO's own PC, 49 of them failed at once on a bug that was never about
   the code they check. */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const tabs = await import(pathToFileURL(join(root, "lib/portal-tabs.ts")).href);
const panel = read("components/portal/cards-panel.tsx");
const page = read("app/portal/page.tsx");

/* ---- 1. the tab exists, and is governable like every other ---------- */
ok("Cards is a tab", tabs.ALL_TABS.includes("Cards"));
ok("Cards is not parked", !tabs.PARKED_TABS.includes("Cards"));
ok("Cards can be granted and revoked from the access card",
   tabs.GOVERNABLE_TABS.includes("Cards"),
   "a tab the CEO cannot change his mind about is a tab he has to ask for a deploy to change");
/* The phone bottom bar shows the first FOUR tabs a role CAN SEE, so a new tab
   near the front silently pushes somebody's fourth thumb-row tab off. Asked
   as the property rather than as a position: parked tabs never draw, so
   counting places in ALL_TABS would answer a slightly different question than
   the one that matters. */
const thumbRow = (role) =>
  tabs.ALL_TABS.filter((x) => tabs.canSeeTab(role, x)).slice(0, 4);
const displaced = [...tabs.ASSIGNABLE_ROLES.map(([r]) => r), "super_admin"]
  .filter((r) => thumbRow(r).includes("Cards"));
ok("Cards is in nobody's phone thumb row", displaced.length === 0,
   `it would take a bottom-bar slot from: ${displaced.join(", ")}`);

/* ---- 2. exactly the three officers, by the REAL rule ---------------- */
/* Every role the system has. If a role is added and not listed here, check 3
   catches it: the registry's own chip list is compared against this. */
const OFFICERS = ["ceo", "coo", "cco"];
const OTHERS = ["admin", "hr_admin", "sales_marketing", "marketing", "editor", "live_host"];
for (const r of OFFICERS) {
  ok(`${r} can see the Cards tab`, tabs.canSeeTab(r, "Cards") === true);
}
for (const r of OTHERS) {
  ok(`${r} cannot see the Cards tab`, tabs.canSeeTab(r, "Cards") === false,
     "the CEO asked for the three officers and nobody else");
}
/* super_admin bypasses every override by design (it is the escape hatch that
   lets a lock-out be undone). Asserted so the exception is deliberate and
   documented rather than looking like a hole. */
ok("super_admin still sees it — the documented escape hatch",
   tabs.canSeeTab("super_admin", "Cards") === true);

/* 3. the role list this guard checks is the whole role list. */
const chips = tabs.ASSIGNABLE_ROLES.map(([r]) => r);
const untested = chips.filter((r) => ![...OFFICERS, ...OTHERS].includes(r));
ok("every assignable role was tested against the Cards tab",
   untested.length === 0, `not tested: ${untested.join(", ")}`);

/* ---- 4. the panel arrives only when the tab is opened --------------- */
ok("the panel is lazy-loaded like every other",
   /export const CardsPanel = lazy\(/.test(read("components/portal/lazy-panels.tsx")));
ok("page.tsx imports it from lazy-panels, never statically",
   !/from "@\/components\/portal\/cards-panel"/.test(page),
   "a static import puts the whole panel in every staff member's bundle - including the eight who cannot open it");
ok("the panel is rendered for the Cards tab, and given the role",
   /activeTab === "Cards" && <CardsPanel role=\{user\.role\}/.test(page));

/* ---- 5. the panel says what the restriction IS --------------------- */
/* The honest sentence, in both languages. Somebody will otherwise read this
   tab as making the cards private, and act on that belief. */
ok("the panel tells the reader the cards are public pages",
   /public pages/.test(panel) && /halaman awam/.test(panel),
   "a tab that looks like a lock but is not one is worse than no tab");
ok("it says what the tab does control",
   /who shares them from the portal/.test(panel));

/* ---- 6. the share actions the CEO asked for ------------------------ */
ok("copy link", /clipboard\.writeText\(url\)/.test(panel));
ok("send on WhatsApp, with the link in the message",
   /wa\.me\/\?text=\$\{encodeURIComponent\(shareText/.test(panel));
ok("show the QR", /QrScreen/.test(panel) && /-qr\.png/.test(panel));
ok("download the preview image", /-og\.png/.test(panel));
ok("a copy that the browser refuses says so",
   /Not copied/.test(panel),
   "a button that silently does nothing is the worst outcome in front of a client");

/* ---- 7. his own card first ----------------------------------------- */
ok("the signed-in officer's own card is first and marked",
   /OWN_SLUG/.test(panel) && /a\.slug === own \? -1/.test(panel) && /mine=\{m\.slug === own\}/.test(panel));
const own = (panel.match(/OWN_SLUG: Record<string, string> = \{([^}]*)\}/) ?? [])[1] ?? "";
for (const [role, slug] of [["ceo", "farhan"], ["coo", "zoll"], ["cco", "izz"]]) {
  ok(`${role} maps to the right card`, new RegExp(`${role}:\\s*"${slug}"`).test(own));
}

/* ---- 8. the house rules this panel could have broken ---------------- */
/* v1.124.0 wrote down one scroll-ownership model: a modal locks BODY, never
   <html>. The full-screen QR is the first modal written since. */
ok("the full-screen QR locks BODY, not <html>",
   /document\.body\.style\.overflow = "hidden"/.test(panel)
   && !/documentElement\.style\.overflow/.test(panel),
   "styles/globals.css names the two owners of the document scroll; a third is a bug");
ok("it restores the scroll it took", /document\.body\.style\.overflow = prev/.test(panel));
ok("the QR closes on Escape as well as a tap", /e\.key === "Escape"/.test(panel));
/* v1.126.0: icons come from the one map. v1.125.0: surfaces come from names. */
ok("the panel draws icons from AppIcon, not emoji",
   /<AppIcon name=/.test(panel) && !/[\u{1F300}-\u{1FAFF}]/u.test(panel.replace(/\/\*[\s\S]*?\*\//g, "")));
ok("the panel's surfaces come from lib/ui-styles.ts",
   /\{card\}/.test(panel) && /\{insetCard\}/.test(panel));
/* v1.9.0: the portal is bilingual chrome. */
ok("every string in the panel is bilingual",
   (panel.match(/\bL\(/g) ?? []).length >= 12,
   "a half-translated tab is worse than an honest English one");

console.log(`${failed ? "✗" : "✓"} cards-tab: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

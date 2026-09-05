/**
 * Shell-scroll guard (v1.88.1) — guard #32.
 *
 * CEO, 03-09-2026, a screenshot of the Leave tab: the app canvas ending
 * two-thirds of the way down the window, a white void beneath it, and a
 * SECOND scrollbar on the page itself. *"Still got bug and defects!"*
 *
 * The v1.21.1 model is that the shell is fixed to the viewport on desktop
 * and the content column is the only thing that scrolls. That model had two
 * holes, and this guard holds both shut:
 *
 *   1. The canvas is `overflow-hidden` but was not `relative`. An absolutely
 *      positioned descendant with no positioned ancestor is laid out against
 *      the DOCUMENT, and grows it straight through a clip that never sees it.
 *   2. Nothing forbade the document from scrolling. The model relied on
 *      nothing ever escaping — which is a hope, not a rule.
 *
 * And because "the document cannot scroll" is a claim, the portal now checks
 * it on every real desktop screen and writes the offending element to the
 * error_log. A fix for a bug you could not reproduce must carry its own
 * evidence the next time.
 *
 *   node tests/shell-scroll.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

const shell = read("components/layout/app-shell.tsx");
const page = read("app/portal/page.tsx");
const staff = read("worker/src/staff.ts");

ok("the canvas is a containing block, not just a clip",
   /md:relative md:h-dvh md:overflow-hidden/.test(shell),
   "without `relative`, an absolute descendant is positioned against the document and grows it through the clip");
ok("the document is locked while the shell is mounted",
   /classList\.add\("shell-locked"\)/.test(shell) && /classList\.remove\("shell-locked"\)/.test(shell),
   "the v1.21.1 model relied on nothing ever escaping - a hope, not a rule");
ok("the lock is desktop-only",
   /@media \(min-width: 768px\) \{ html\.shell-locked, html\.shell-locked body \{ overflow: hidden/.test(shell),
   "the phone layout scrolls the document by design and must not be locked");
ok("the lock rule ships with the component that needs it",
   /<style>\{`@media/.test(shell),
   "a class whose CSS lives in another file stops working the day that file is tidied");
ok("the desktop height self-report exists",
   /const key = `azone-ovfy:\$\{APP_VERSION\}:\$\{tab\}`;/.test(page),
   "a fix for a bug that could not be reproduced must carry its own evidence next time");
ok("it ignores content that is merely below the fold inside the shell",
   /if \(h\.closest\("#shell-scroll"\)\) return;/.test(page),
   "content scrolled below the fold inside the scroller is normal - content below the CANVAS is the bug");
ok("it reports fixed elements as nothing",
   /if \(cs\.display === "none" \|\| cs\.position === "fixed"\) return;[\s\S]{0,300}?r\.bottom <= vh \+ 1/.test(page),
   "a fixed toast at the bottom of the viewport is not overflow");
ok("the worker records which axis the report is about",
   /const axis = body\?\.axis === "y" \? "y" : "x";/.test(staff) && /axis=\$\{axis\}/.test(staff),
   "two kinds of overflow read as one is a log nobody can act on");

/* ---- v1.88.2: one shell, one width ----
   The CEO: "on /admin the UI/UX should same width as /portal. same goes to
   other. everything must follow like /portal UI/UX". /portal has filled the
   window since v1.74.0; /admin was capped at 1152px, /account at 896px, and
   /admin/permissions had no shell at all - a bare column on the page
   background. On the same monitor the consoles were three different widths
   and read as three products. The public documents (/doc, /report) and the
   sign-in page are NOT app views and are deliberately not listed here. */
{
  const APP_VIEWS = ["app/portal/page.tsx", "app/admin/page.tsx", "app/admin/permissions/page.tsx", "app/account/page.tsx"];
  for (const f of APP_VIEWS) {
    const src = read(f);
    ok(`${f} renders the shell`, /<AppShell/.test(src),
       "an app view outside the shell is a page that looks like leaving the product");
    ok(`${f} does not cap the canvas`, !/maxWidth="md:max-w-(?!none)/.test(src),
       "/portal fills the window - a narrower console beside it reads as a different product");
    ok(`${f} does not cap its content column either`, !/className="mx-auto w-full max-w-\d?xl px-4 py-4/.test(src),
       "lifting the canvas cap and leaving the column capped moves the gutters inside the canvas");
  }
}

/* v1.109.1 — INSTALLED, THE STATUS BAR IS OURS TO CLEAR. The CEO, 05-09-2026,
   the portal on his Android Home Screen: the clock, signal and battery drawn
   over the avatar and "Today". viewport-fit=cover (app/layout.tsx) means an
   installed app runs edge to edge, so every sticky mobile header must pad
   its top by env(safe-area-inset-top) - zero in a browser tab, the bar's
   height when installed. The bottom bar has done this for its inset since
   v1.10.0. Negative-tested by removing the style from the portal header. */
{
  ok("the viewport still asks for edge to edge", /viewportFit: "cover"/.test(read("app/layout.tsx")),
     "without it the fix below is harmless and the app keeps a browser-coloured bar");
  for (const f of ["app/portal/page.tsx", "app/admin/page.tsx", "app/account/page.tsx"]) {
    const src = read(f);
    const headers = [...src.matchAll(/<header className="[^"]*sticky top-0[^"]*"(?:\s*\n?\s*style=\{\{[^}]*\}\})?/g)].map((m) => m[0]);
    ok(`${f} has sticky mobile headers to check`, headers.length > 0);
    for (const h of headers) {
      ok(`${f}: a sticky top-0 header clears the status bar`, /env\(safe-area-inset-top, 0px\)/.test(h),
         "installed on a phone, the clock and battery are drawn over it");
      ok(`${f}: the header keeps its own top padding on top of the inset`, /calc\(var\(--hdr-pt\) \+ env\(safe-area-inset-top/.test(h) && /\[--hdr-pt:/.test(h),
         "the inset is added to the padding, not swapped for it - in a browser tab the header must look exactly as before");
    }
  }
  ok("the connection line clears it too", /paddingTop: "env\(safe-area-inset-top, 0px\)"/.test(read("components/ui/offline-banner.tsx")));
}

console.log(
  fails.length === 0
    ? `PASS — on desktop the shell scrolls and the document does not (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);

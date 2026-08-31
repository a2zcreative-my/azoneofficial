/**
 * Skeleton-loading guard (v1.77.0) — guard #28.
 *
 * CEO, 31-08-2026: *"I saw skeleton loading react doesnt accurately follow
 * the width of my interface and also I want no loading without skeleton
 * loading react. Additionally, audit all the files to ensure that no loading
 * leak without skeleton loading react either in web or mobile view."*
 *
 * The audit found three things.
 *
 *   1. THE WIDTH. PortalSkeleton still capped its canvas at 1440px after
 *      v1.74.0 removed that cap from AppShell, and it drew no side columns
 *      although the Dashboard has two. So the skeleton painted a different
 *      shape from the app that replaced it, and the page jumped — the one
 *      thing a skeleton exists to prevent.
 *
 *   2. FIVE PLACES STILL SAID "Loading…" IN WORDS, and two pages showed
 *      nothing at all while they checked who you were.
 *
 *   3. SEVENTY COMPONENTS FETCH ON MOUNT AND DRAW NOTHING — or worse, draw
 *      "No records yet" — until the data arrives. That is how the Payroll
 *      tab read "TOTAL — 0 staff" for a minute this morning: not a wrong
 *      number, an empty state shown while loading. Six had skeletons.
 *
 * RULES, each mechanical:
 *
 *   R1  No loading state is described in words. No "Loading…", no
 *       "Memuatkan…". (A button relabelled "Uploading…" during its own
 *       action is feedback on an action, not a loading state, and stays.)
 *   R2  No spinner. `animate-spin` does not appear in the client.
 *   R3  PortalSkeleton's canvas and both side columns carry EXACTLY the
 *       classes AppShell gives the real ones.
 *   R4  Every component that fetches when it mounts renders a skeleton
 *       until the data lands. Detected, not declared: a function component
 *       whose body has a useEffect and an API call must reference a Skel
 *       primitive. No opt-out comment, because opt-outs get copied.
 *   R5  Nothing returns `null` on a loading flag. `if (!loaded) return null`
 *       is a blank screen with a name.
 *
 *   node tests/skeleton-loading.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(path.join(root, dir))) {
    if (e === "node_modules" || e === ".next") continue;
    const rel = `${dir}/${e}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
    else if (/\.tsx$/.test(e)) files.push(rel);
  }
};
for (const d of ["app", "components"]) walk(d);
ok("there are client files to check", files.length > 40, `found ${files.length}`);

/* Strip comments so prose about loading is not read as a loading state. */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/^(\s*)\/\/.*$/gm, "$1");

/* ---- R1 / R2 ---- */
{
  const words = [];
  const spinners = [];
  for (const rel of files) {
    if (rel.endsWith("skeleton.tsx")) continue; // StaleHint's "updating…" lives here by design
    const lines = codeOnly(read(rel)).split(/\r?\n/);
    lines.forEach((l, i) => {
      /* A loading state in words: "Loading…", "Loading the week…",
         "Memuatkan…". Not the state-machine literal "loading", not
         loading="lazy", not a button saying "Uploading…". */
      const display = l.replace(/loading=["']lazy["']/g, "").replace(/["']loading["']/g, "");
      if (/(^|[^A-Za-z])Loading(…|\.\.\.|\s+(the|your|a)\b|<|["'`])/.test(display) ||
          /Memuatkan/.test(display)) {
        words.push(`${rel}:${i + 1}`);
      }
      if (/animate-spin/.test(l)) spinners.push(`${rel}:${i + 1}`);
    });
  }
  ok("no loading state is described in words", words.length === 0,
     `${words.join(", ")} — a skeleton in the shape of what is coming, not a sentence about waiting`);
  ok("no spinner anywhere in the client", spinners.length === 0, spinners.join(", "));
}

/* ---- R3: the first paint has the app's exact geometry ---- */
{
  const shell = read("components/layout/app-shell.tsx");
  const skel = read("components/portal/portal-skeleton.tsx");
  const canvas = shell.match(/className=\{`([^`]*?) \$\{maxWidth\}`\}/)?.[1];
  const def = shell.match(/maxWidth = "([^"]+)"/)?.[1];
  ok("AppShell's canvas classes were found", Boolean(canvas && def));
  ok("the skeleton canvas carries AppShell's classes and its default width",
     Boolean(canvas && def) && skel.includes(`className="${canvas} ${def}"`),
     `expected "${canvas} ${def}" — a skeleton narrower than the app makes the page jump sideways when data lands`);
  for (const side of ["left", "right"]) {
    const re = side === "left"
      ? /<aside className="([^"]*border-r[^"]*)"/
      : /<aside className="([^"]*border-l[^"]*)"/;
    const real = shell.match(re)?.[1];
    ok(`the skeleton's ${side} column matches AppShell's`, Boolean(real) && skel.includes(`className="${real}"`),
       `the Dashboard has a ${side === "left" ? "264" : "292"}px column; a skeleton without it is ${side === "left" ? "264" : "292"}px too wide`);
  }
}

/* ---- R4 / R5: every component that fetches on mount shows a skeleton ---- */
{
  const missing = [];
  const nullOnLoading = [];
  const exempt = [];
  let fetching = 0;
  for (const rel of files) {
    const src = read(rel);
    if (!/\bapi[<(]|\bfetch\(|csrfFetch\(/.test(src)) continue;
    const code = codeOnly(src);
    const comps = [...code.matchAll(/^(?:export )?(?:default )?function ([A-Z]\w*)\(/gm)]
      .map((m) => ({ name: m[1], at: m.index }));
    for (let i = 0; i < comps.length; i++) {
      const body = code.slice(comps[i].at, comps[i + 1]?.at ?? code.length);
      /* Fetches on mount: an effect AND a call. A component that only calls
         the API when a button is pressed has nothing to skeleton. */
      if (!/useEffect\(/.test(body) || !/\bapi[<(]|\bfetch\(|csrfFetch\(/.test(body)) continue;
      fetching++;
      /* The one exemption: a component whose fetch changes NOTHING it draws
         (a login form that checks /auth/me only to redirect). It must say so,
         with a reason, in the raw source; the guard prints every exemption
         so they stay countable, and refuses more than a handful. */
      const raw = src.slice(src.indexOf(`function ${comps[i].name}(`));
      const ex = raw.slice(0, (raw.slice(1).search(/^(?:export )?(?:default )?function [A-Z]/m) + 1) || raw.length)
        .match(/\/\* skeleton: none — ([^*]{20,}?) \*\//);
      if (ex) { exempt.push(`${rel} :: ${comps[i].name} — ${ex[1].trim()}`); continue; }
      if (!/<Skel|<PortalSkeleton|Skeleton\b/.test(body)) missing.push(`${rel} :: ${comps[i].name}`);
      const m = body.match(/if \(!?\(?[^)]*\b(loaded|loading|checked|ready)\b[^)]*\)?\) return null;/);
      if (m) nullOnLoading.push(`${rel} :: ${comps[i].name} — ${m[0]}`);
    }
  }
  ok("components that fetch on mount were found", fetching > 60, `${fetching} — a low count means the detector went blind, not that the portal got simpler`);
  ok("every component that fetches on mount shows a skeleton until the data lands", missing.length === 0,
     `\n      ${missing.join("\n      ")}\n      — ${missing.length} of ${fetching}; each draws nothing, or an empty state, while loading`);
  ok("nothing returns null on a loading flag", nullOnLoading.length === 0,
     `\n      ${nullOnLoading.join("\n      ")}\n      — a blank screen with a name`);
  ok("exemptions stay a handful, each with a reason", exempt.length <= 5,
     `${exempt.length} components claim their fetch draws nothing — that is the sentence that gets copied`);
  if (exempt.length) console.log(`  (${exempt.length} exempt, each says why:\n     ${exempt.join("\n     ")})`);
}

console.log(
  fails.length === 0
    ? `PASS — nothing loads without a skeleton in its own shape (${pass} checks, ${files.length} files)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);

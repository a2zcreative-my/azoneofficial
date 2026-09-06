#!/usr/bin/env node
/* Guard #52 — v1.124.0: the browser's own chrome follows the theme.
 *
 * The audit found <meta name="theme-color"> pinned to the brand navy in
 * app/layout.tsx. That is right for the public site (light only) and wrong
 * for the portal, which the CEO installs to the home screen: switching to
 * dark repainted every pixel of the app except the phone's status bar, which
 * kept glowing navy — brighter than the app beneath it, on the one surface a
 * build-time meta tag cannot follow.
 *
 * The fix keeps ONE source for the colour and two consumers of it:
 *
 *   --browser-theme-color in styles/globals.css   the source, with a value in
 *                                                 the light block and one in
 *                                                 .dark, each beside the
 *                                                 background it has to match.
 *   app/layout.tsx      the build-time tag. It must be a LITERAL — the
 *                       viewport export is serialised before any stylesheet
 *                       exists — so this guard pins that literal to the light
 *                       value instead of trusting them to stay in step.
 *   lib/theme-color.ts  the runtime rewrite. It must READ the variable, not
 *                       carry its own copy, or a future theme gets the wrong
 *                       chrome and nothing says so.
 *
 * Negative-tested by: changing the light --browser-theme-color without
 * changing layout.tsx; hard-coding a hex inside lib/theme-color.ts; deleting
 * the .dark value; removing the syncThemeColor() call from the portal's theme
 * effect.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const css = read("styles/globals.css");
const layout = read("app/layout.tsx");
const lib = read("lib/theme-color.ts");
const portal = read("app/portal/page.tsx");

/* ---- the source declares one value per theme ------------------------- */
const decls = [...css.matchAll(/--browser-theme-color:\s*(#[0-9a-fA-F]{6});/g)].map((m) => m[1].toLowerCase());
ok("the colour is declared for both themes", decls.length === 2, `${decls.length} declarations`);
ok("light and dark are actually different", new Set(decls).size === 2, decls.join(" / "));

const darkAt = css.indexOf(".dark {");
const darkDecl = css.slice(darkAt).match(/--browser-theme-color:\s*(#[0-9a-fA-F]{6});/);
ok(".dark declares its own chrome colour", !!darkDecl);
/* It has to match the dark page ground, or the band across the top is still
   visible — just a different wrong colour than before. */
const darkBg = css.slice(darkAt).match(/--background:\s*(#[0-9a-fA-F]{6});/);
ok("the dark chrome matches the dark page ground",
   !!darkDecl && !!darkBg && darkDecl[1].toLowerCase() === darkBg[1].toLowerCase(),
   darkDecl && darkBg ? `${darkDecl[1]} vs ${darkBg[1]}` : "");

/* ---- the build-time tag agrees with the light value ------------------ */
const lightDecl = css.slice(0, darkAt).match(/--browser-theme-color:\s*(#[0-9a-fA-F]{6});/);
const meta = layout.match(/themeColor:\s*"(#[0-9a-fA-F]{6})"/);
ok("app/layout.tsx still sets a themeColor", !!meta);
ok("the build-time tag is the LIGHT value — a first paint never shows the wrong theme",
   !!meta && !!lightDecl && meta[1].toLowerCase() === lightDecl[1].toLowerCase(),
   meta && lightDecl ? `${meta[1]} vs ${lightDecl[1]}` : "");

/* ---- the runtime reads the variable, it does not copy it ------------- */
ok("lib/theme-color.ts reads --browser-theme-color at runtime",
   /getPropertyValue\("--browser-theme-color"\)/.test(lib));
const libBody = lib.replace(/\/\*[\s\S]*?\*\//g, "");
ok("lib/theme-color.ts carries no colour of its own",
   !/#[0-9a-fA-F]{6}/.test(libBody),
   (libBody.match(/#[0-9a-fA-F]{6}/g) ?? []).join(","));
ok("it writes the unconditional tag, leaving any media-scoped one alone",
   /meta\[name="theme-color"\]:not\(\[media\]\)/.test(lib));

/* ---- the portal calls it when the theme changes ---------------------- */
const effect = portal.match(/classList\.toggle\("dark", dark\);[\s\S]{0,600}?\}, \[dark\]\);/);
ok("the portal's theme effect was found", !!effect);
ok("the theme effect repaints the browser chrome too",
   !!effect && /syncThemeColor\(\)/.test(effect[0]));
ok("syncThemeColor runs AFTER the class is applied — it reads computed style",
   !!effect && effect[0].indexOf("classList.toggle") < effect[0].indexOf("syncThemeColor()"));

console.log(`${failed ? "✗" : "✓"} theme-color: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

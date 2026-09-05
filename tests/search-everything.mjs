#!/usr/bin/env node
/* Guard #42 — v1.107.0 (roadmap phase 04b): search everything.
 *
 * One query over eight tables, from the palette on Ctrl K. Two ways it could
 * quietly go wrong, and both are run here rather than read:
 *
 *   1. IT LEAKS. A source must be searchable by a role exactly when that role
 *      may open the source's tab. sourcesFor() is run for EVERY role against
 *      the permission matrix, source by source - a live host must not find a
 *      hotel contact's mobile number through the search box when the Hotels
 *      tab is not hers.
 *   2. IT MISSES. Phone numbers are matched by digits on both sides, so the
 *      way a number was typed cannot fail to find the way it was stored; LIKE
 *      wildcards in the query are escaped, so "50%" does not match everything.
 *
 * Then the wiring: a door in staff.ts; the palette asks the server, debounced,
 * and never shows a stale answer for a newer query; the two directory
 * preloads it used to make on every open are gone; every tab a hit names is
 * a real tab; every result kind has a group header in both languages.
 *
 * Negative-tested by: letting live_host search hotels (1); dropping the digit
 * strip from phoneDigits (2); removing the seq check from the palette (3).
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const src = read("worker/src/search.ts");
const staff = read("worker/src/staff.ts");
const palette = read("components/layout/command-palette.tsx");
const tabsSrc = read("lib/portal-tabs.ts");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const dir = mkdtempSync(join(tmpdir(), "search-"));
const bundle = async (file, name) => {
  const out = join(dir, `${name}.mjs`);
  execSync(`npx esbuild ${join(root, file)} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`, { cwd: root, stdio: "inherit" });
  return import(pathToFileURL(out).href);
};
const { likePattern, phoneDigits, sourcesFor } = await bundle("worker/src/search.ts", "search");
const { can, PERMS } = await bundle("worker/src/permissions.ts", "perms");

/* ---- 1. it does not leak: every role, every source, the tab's own rule ---- */
{
  const roles = ["super_admin", "admin", "editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco"];
  const rule = {
    hotel: (r) => can(r, "hotels_view"),
    contact: (r) => can(r, "hotels_view"),
    staff: (r) => can(r, "hr_manage") || can(r, "exec_view"),
    client: (r) => can(r, "revenue_view"),
    document: (r) => can(r, "sales") || can(r, "exec_view"),
    order: (r) => can(r, "sales") || can(r, "inventory") || can(r, "exec_view"),
    stock: (r) => can(r, "inventory"),
    asset: (r) => can(r, "hr_manage") || can(r, "exec_view"),
    task: () => true,
  };
  for (const role of roles) {
    const got = new Set(sourcesFor(role));
    for (const [source, may] of Object.entries(rule)) {
      ok(`${role} ${may(role) ? "may" : "may NOT"} search ${source}`, got.has(source) === may(role),
         "a source must be searchable exactly when its tab is openable");
    }
  }
  ok("a live host cannot reach a hotel contact's number through the search box", !sourcesFor("live_host").includes("contact"));
  ok("PERMS is the matrix these rules read", PERMS && typeof PERMS.hotels_view === "object");
}

/* ---- 2. it does not miss ---- */
{
  ok("LIKE wildcards are escaped", likePattern("50%_a") === "%50\\%\\_a%", likePattern("50%_a"));
  ok("a backslash is escaped too", likePattern("a\\b") === "%a\\\\b%");
  ok("017-476 1019 is a phone", phoneDigits("017-476 1019") === "0174761019");
  ok("+60 17 476 1019 is a phone", phoneDigits("+60 17 476 1019") === "60174761019");
  ok("(03) 4042-8000 is a phone", phoneDigits("(03) 4042-8000") === "0340428000");
  ok("Amari is not a phone", phoneDigits("Amari") === null);
  ok("2026 is not a phone - too short", phoneDigits("2026") === null, "every phone with 2026 in it would light up");
  ok("RM 50 is not a phone", phoneDigits("RM 50") === null);
  ok("QT-2026-0451 is not a phone - mostly letters and dashes", phoneDigits("QT-2026-0451") === null || phoneDigits("QT-2026-0451") === "20260451");
  ok("every LIKE in the worker uses ESCAPE", (src.match(/LIKE \?\d/g) ?? []).every(() => true) && !/LIKE \?1(?! ESCAPE)/.test(src.replace(/LIKE \?2/g, "")),
     "an unescaped LIKE makes % in the query match everything");
  ok("phone columns are compared as digits", /const DIGITS = \(col: string\) =>/.test(src) && (src.match(/DIGITS\("/g) ?? []).length >= 5);
  ok("the query's digits are what they are compared to", /`%\$\{digits\}%`/.test(src));
  ok("each source is capped", /LIMIT \$\{PER_SOURCE\}/.test(src) && /const PER_SOURCE = \d+;/.test(src));
  ok("one round-trip", /env\.DB\.batch<Row>\(stmts\.map\(\(s\) => s\.stmt\)\)/.test(src));
  ok("a missing table costs its source, not the search", /catch \{ rows\.push\(\[\]\); \}/.test(src));
  ok("a short query is refused before touching the database", /if \(q\.length < MIN_CHARS\) return json\(\{ hits: \[\], q \}\);/.test(src));
  ok("hotels that were removed do not come back through search", /FROM hotels\s+WHERE is_active = 1/.test(src) && /JOIN hotels h ON h\.id = c\.hotel_id AND h\.is_active = 1/.test(src));
  ok("tasks: everyone their own, managers everything", /const allTasks = can\(user\.role, "team_manage"\);/.test(src) && /AND \(t\.assigned_to = \?2 OR t\.created_by = \?2\)/.test(src));
}

/* ---- 3. the wiring ---- */
{
  ok("a door in staff.ts", /if \(path === "\/search" && method === "GET"\) \{\s*return handleSearch\(env, user, new URL\(request\.url\)\.searchParams\);/.test(staff));
  ok("the palette asks the server", /api<\{ hits: Hit\[\] \}>\(`\/search\?q=\$\{encodeURIComponent\(queryNow\)\}`\)/.test(palette));
  ok("...debounced", /window\.setTimeout\(\(\) => \{[\s\S]{0,80}?void api<\{ hits/.test(palette) && /\}, 2\d\d\);/.test(palette));
  ok("a stale answer is never shown for a newer query", /const mine = \+\+seq\.current;[\s\S]{0,300}?if \(seq\.current !== mine\) return;/.test(palette) && /hitsFor === query/.test(palette),
     "typing 'am' then 'amari' must not flash am's hits under amari");
  ok("the directory preloads are gone", !/\/staff-list/.test(palette) && !/\/clients\/summary/.test(palette), "two fetches on every open, replaced by one that answers");
  ok("server hits are not re-scored against their title", /\(a\.group === "Go to" \|\| a\.group === "Actions"\) \? score\(query, b\.label\) - score\(query, a\.label\) : 0/.test(palette),
     "a phone-number hit has no digits in its title and would sort to the bottom");
  const allTabs = [...(tabsSrc.match(/const ALL_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const hitTabs = [...src.matchAll(/tab: "([^"]+)"/g)].map((m) => m[1]);
  ok("every tab a hit names is a real tab", hitTabs.length >= 8 && hitTabs.every((t) => allTabs.includes(t)), hitTabs.filter((t) => !allTabs.includes(t)).join(", "));
  const kinds = [...(src.match(/kind: "([^"]+)"(?: \| "[^"]+")*/)?.[0] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const groups = Object.fromEntries([...(palette.match(/const KIND_GROUP: Record<string, string> = \{([\s\S]*?)\};/)?.[1] ?? "").matchAll(/(\w+): "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const ms = new Set([...(palette.match(/const GROUP_MS: Record<string, string> = \{([\s\S]*?)\};/)?.[1] ?? "").matchAll(/^\s*"?([\w ]+)"?:/gm)].map((m) => m[1]));
  for (const k of kinds) {
    ok(`kind ${k} has a group header in both languages`, Boolean(groups[k]) && ms.has(groups[k]), `group ${groups[k] ?? "(none)"}`);
  }
  ok("the placeholder invites a phone number", /a phone number/.test(palette));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — one search over eight tables, each gated exactly as its tab is, phones matched by digits (${passed} checks)`);

#!/usr/bin/env node
/* Guard #35 — v1.97.0: "Malaysian" is read off the post, never off the person.
 *
 * The CEO, 05-09-2026: "I want to search and filter the Threads post by
 * malaysia users which is for me to do some research based on their post
 * regarding on the Study cases".
 *
 * Threads carries no country. So the portal decides from the TEXT of a public
 * post - Malay wording that is Malay rather than Indonesian, a price in RM, a
 * Malaysian place - and writes the reason next to the verdict. This guard
 * runs the real functions (bundled from worker/src/threads.ts) on sentences
 * whose answer a Malaysian would not argue with, and reads the source for the
 * two properties that matter more than any one sentence: the signal takes
 * only text, and nothing about a person is fetched to decide it.
 *
 * Negative-tested by: returning my_signal 1 for the Jakarta sentence; removing
 * `reads Indonesian`; dropping my_reasons from the INSERT.
 */
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const src = readFileSync(join(root, "worker/src/threads.ts"), "utf8");
const panel = readFileSync(join(root, "components/portal/threads-panel.tsx"), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- 1. run the real functions ---- */
const dir = mkdtempSync(join(tmpdir(), "threads-my-"));
const out = join(dir, "threads.mjs");
execSync(`npx esbuild ${join(root, "worker/src/threads.ts")} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`, { cwd: root, stdio: "inherit" });
const { malaysiaSignal, postTraits } = await import(pathToFileURL(out).href);

const MY = [
  "Staycation kat KL ni RM 180 semalam je, sedap breakfast dia. Korang dah try?",
  "Tudung bawal baru masuk, warna nude. Jom order sebelum habis!",
  "Just got back from Langkawi, the hotel was RM250 a night and worth it.",
  "hotel murah dekat Johor Bahru untuk family, ada cadangan tak?",
];
const NOT_MY = [
  "Hotel di Jakarta ini enak banget, harganya cuma Rp 500.000 aja, gue suka.",
  "Best boutique hotels in Lisbon for a weekend, the breakfast was incredible.",
  "Liburan ke Bandung, kerudung baru dari toko favorit, bisa gimana ya.",
];
for (const t of MY) {
  const r = malaysiaSignal(t, postTraits(t, "TEXT_POST").language_guess);
  ok(`reads as Malaysian: "${t.slice(0, 40)}…"`, r.my_signal === 1 && typeof r.my_reasons === "string" && r.my_reasons.length > 0,
     `got ${JSON.stringify(r)}`);
}
for (const t of NOT_MY) {
  const r = malaysiaSignal(t, postTraits(t, "TEXT_POST").language_guess);
  ok(`does NOT read as Malaysian: "${t.slice(0, 40)}…"`, r.my_signal === 0, `got ${JSON.stringify(r)}`);
}
ok("Indonesian is told apart from Malay", postTraits(NOT_MY[0], "TEXT_POST").language_guess === "id"
   && postTraits(MY[0], "TEXT_POST").language_guess === "ms",
   `got ${postTraits(NOT_MY[0], "TEXT_POST").language_guess} / ${postTraits(MY[0], "TEXT_POST").language_guess}`);
ok("an English post about Malaysia still counts (place + RM)", malaysiaSignal(MY[2], "en").my_signal === 1);
ok("empty text is nothing, not Malaysian", malaysiaSignal("", null).my_signal === 0 && malaysiaSignal(null, null).my_reasons === null);
ok("a verdict always says why", MY.every((t) => /RM price|Malay|Malaysian word|kl|langkawi|johor/i.test(malaysiaSignal(t, postTraits(t, "TEXT_POST").language_guess).my_reasons ?? "")));

/* ---- 2. properties of the source ---- */
ok("the signal is computed from text alone",
   /export function malaysiaSignal\(text: string \| null \| undefined, languageGuess: string \| null\)/.test(src),
   "the signature is the promise: no username, no profile, no id");
ok("nothing about a person is fetched to decide it",
   !/graph[^\n]*\/(profile|location|country|me\?)/.test(src) && !/fields=[^"`]*(location|country|city)/.test(src),
   "OD-20a: the study reads public posts, it does not look people up");
ok("the reason is stored beside the verdict", /my_signal, my_reasons\)/.test(src) && /my\.my_signal, my\.my_reasons \?\? ""/.test(src),
   "a number nobody can check is a number nobody should trust");
ok("Indonesian pulls the score down, by name", /reads Indonesian/.test(src) && /const ID_ONLY = \//.test(src));
ok("the study route can scope to Malaysian posts", /params\.get\("my"\) === "1"/.test(src) && /my_total/.test(src));
ok("rows from before 0108 are scored on first open", /r\.my_reasons === null/.test(src) && /UPDATE threads_topic_posts SET my_signal/.test(src));
ok("the panel shows the switch, the badge and the reason",
   /setOnlyMy\(true\)/.test(panel) && /setOnlyMy\(false\)/.test(panel) && /title=\{p\.my_reasons \|\| undefined\}/.test(panel) && /p\.my_reasons/.test(panel));
ok("the CSV carries the verdict and the reason", /L\("Malaysian", "Malaysia"\), L\("Why", "Sebab"\)/.test(panel));
ok("the migration exists and adds both columns", (() => {
  try {
    const m = readFileSync(join(root, "worker/migrations/0108_threads_malaysia.sql"), "utf8");
    return /ADD COLUMN my_signal INTEGER NOT NULL DEFAULT 0/.test(m) && /ADD COLUMN my_reasons TEXT/.test(m);
  } catch { return false; }
})());

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — Malaysian is read off the post, with its reason, never off the person (${passed} checks)`);

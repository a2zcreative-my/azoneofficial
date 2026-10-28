#!/usr/bin/env node
/* Guard - v1.218.0: ONE OFFICIAL PROFILE. ONE PUBLIC CARD SOURCE. MULTIPLE
 * SHARING METHODS. NO DUPLICATION.
 *
 * The owner's Digital Business Cards 2.0 brief (28-10-2026) and his answers
 * to claude/CARDS-AUDIT.md: fix the images and add a card image, a full
 * redesign of the public card at the same URLs, website only (no social
 * links), and a read-only mismatch warning against the staff record.
 *
 *   1. THE PRINTED QR IS NEVER REDRAWN: scripts/card-og.py only draws a QR
 *      that is missing; it reads the bilingual records (it matched none from
 *      v1.128.0 to v1.217.0, which left Izz's preview reading "Director /
 *      CCO"); it draws a portrait card image for every card.
 *   2. THE PUBLIC CARD SHOWS ONLY THE RECORD: it imports nothing from the
 *      portal, the API or the staff data; it has no form, input or edit
 *      control; it shares through the phone's own sheet or the clipboard; it
 *      pads for the notch and the home bar; no social links or invented copy.
 *   3. THE STAFF CHECK ONLY READS FOUR FIELDS: management only, the officers'
 *      name, position, phone and whether a photo exists - never the IC, bank,
 *      address, staff ID or anything else - and it writes nothing.
 *   4. THE TAB PREVIEWS THE REAL CARD (the same component, embedded) and its
 *      only request is that read.
 *
 * Negative-tested by: the QR drawn unconditionally (1); the old one-string
 * parser (1); an api() call in the card (2); an <input> on the card (2); a
 * social link (2); ic_number in the check (3); a POST from the panel (4).
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

const py = read("scripts/card-og.py");
const view = strip(read("components/cards/card-view.tsx"));
const viewCss = read("components/cards/card-view.module.css");
const panel = strip(read("components/portal/cards-panel.tsx"));
const staff = strip(read("worker/src/staff.ts"));
const { TEAM } = await import(pathToFileURL(join(root, "constants/team.ts")).href).catch(() => ({ TEAM: null }));
const slugs = TEAM ? TEAM.map((m) => m.slug) : ["farhan", "izz", "zoll"];

/* ---- 1. the images ---- */
ok("an existing QR is never redrawn", /qr_path = os\.path\.join\(OUT, "%s-qr\.png" % slug\)\s*\n\s*if not os\.path\.exists\(qr_path\):/.test(py)
   && (py.match(/\.save\(qr_path/g) ?? []).length === 1);
ok("the generator reads the bilingual records", /pair\("known"\)/.test(py) && /pair\("role"\)/.test(py) && !/known:\\s\*"\(\[\^"\]\+\)"/.test(py));
for (const s of slugs) {
  const p = join(root, `public/cards/${s}-card.png`);
  ok(`${s}: the card image exists`, existsSync(p) && statSync(p).size > 20000, "run: python scripts/card-og.py");
}
if (TEAM) ok("Izz is the CCO and Zoll the COO, as the record says", /CCO/.test(TEAM.find((m) => m.slug === "izz")?.role.en ?? "") && /COO/.test(TEAM.find((m) => m.slug === "zoll")?.role.en ?? ""));

/* ---- 2. the public card ---- */
const imports = [...view.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
ok("the card reads only the record, the copy and the site constants", imports.every((i) => ["lucide-react", "next/link", "react", "@/constants/card-copy", "@/constants/site", "@/constants/team", "./card-view.module.css"].includes(i)), imports.join(", "));
ok("no fetch, no API", !/\bfetch\(|api<|api\(/.test(view));
ok("no edit control on the public card", !/<input|<textarea|<select|<form|contentEditable/i.test(view));
ok("Share this card: the phone's sheet, or the link copied", /nav\.share\(/.test(view) && /clipboard\.writeText\(cardUrl\)/.test(view) && /CARD_COPY\.share/.test(view));
ok("Save contact is the vCard; WhatsApp, call, email, website and location are the record's", /href=\{`\/cards\/\$\{m\.slug\}\.vcf`\}/.test(view) && /CARD_COPY\.website/.test(view) && /CARD_COPY\.location/.test(view));
ok("the page pads for the notch and the home bar", /env\(safe-area-inset-top/.test(viewCss) && /env\(safe-area-inset-bottom/.test(viewCss));
ok("no social links and no invented copy", !/facebook|instagram|tiktok|youtube|linkedin|Your Creative Marketing Partner/i.test(view + panel));

/* ---- 3. the staff check ---- */
const rawStaff = read("worker/src/staff.ts");
const route = rawStaff.slice(rawStaff.indexOf('if (path === "/cards/profile-check" && method === "GET") {'), rawStaff.indexOf("/* ---- announcements ----"));
ok("the staff check is management-only", /if \(!can\(user\.role, "exec_view"\)\) return err\("forbidden"/.test(route));
ok("...reads four fields of the three officers, nothing else", /SELECT role, COALESCE\(NULLIF\(TRIM\(full_name\), ''\), name\) AS name, position, phone,\s*CASE WHEN photo_key/.test(route)
   && !/ic_number|bank_|address|employee_id|email|birthday|epf|socso|tax_no|emergency/.test(route) && /role IN \('ceo', 'coo', 'cco'\)/.test(route));
ok("...and writes nothing", route.length > 100 && !/\b(INSERT|UPDATE|DELETE)\b/.test(route));

/* ---- 4. the tab ---- */
const calls = [...panel.matchAll(/api(?:<[^>]*>)?\(\s*`([^`]+)`([^)]*)\)/g)];
ok("the tab's only request is the staff check, a read", calls.length === 1 && calls[0][1] === "/staff/cards/profile-check" && !/method/.test(calls[0][2]));
ok("the preview is the public card itself, embedded", /<CardView m=\{preview\} embedded \/>/.test(panel));
ok("Download image is the card image", /href=\{`\/cards\/\$\{m\.slug\}-card\.png`\} download=/.test(panel));

ok("the guard is registered", /\["cards-public", "/.test(read("scripts/run-guards.mjs")));
console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }

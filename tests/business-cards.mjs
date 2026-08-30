/**
 * Business-card guard (v1.71.0) — guard #19.
 *
 * These pages are the one URL a client types after meeting somebody, off a
 * piece of card they are holding. Paper cannot be redeployed, so every way
 * this can quietly stop working is checked here:
 *
 *   1. A SLUG COLLISION. `/farhan` sits at the root of the site, one level
 *      away from `/about` and `/contact`. Adding a real page called
 *      `app/izz/` later would shadow a card that is already printed, and
 *      nothing would fail — the wrong page would just start rendering. So
 *      the slugs are checked against the real app/ directory, the real
 *      public/ directory and a reserved list, and the BUILD fails.
 *   2. The `.vcf` drifting from constants/team.ts. Save-to-contacts is the
 *      whole feature; a stale number in it is worse than no card, because
 *      the client believes they have the right one. The file is rebuilt
 *      here and compared byte-for-byte — `node tests/business-cards.mjs
 *      --write` regenerates all three from the constants.
 *   3. The printed number and the dialled number disagreeing. `mobile` is
 *      what a client reads off the paper; `mobileE164` is what tel: and
 *      WhatsApp actually use. A typo in one of them is invisible on screen.
 *   4. Line endings. vCard is a CRLF format and `* text=auto` in
 *      .gitattributes would rewrite these files to LF on the Linux build
 *      container, AFTER this guard had approved them. `*.vcf text eol=crlf`
 *      is therefore part of the contract and is asserted.
 *   5. The role aliases (/ceo, /coo, /cco) still redirecting, and as 302 —
 *      a 301 is cached by the browser forever, and roles change hands.
 *
 *   node tests/business-cards.mjs           # check
 *   node tests/business-cards.mjs --write   # regenerate the .vcf files
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WRITE = process.argv.includes("--write");
const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");
const at = (p) => path.join(root, p);

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- 1. the people, parsed straight out of the source ---- */
const teamSrc = read("constants/team.ts");
const TEAM = [
  ...teamSrc.matchAll(
    /\{\s*slug:\s*"([a-z0-9-]+)",\s*name:\s*"([^"]+)",\s*known:\s*"([^"]+)",\s*role:\s*"([^"]+)",\s*roleSlugs:\s*\[([^\]]*)\],\s*email:\s*"([^"]+)",\s*mobile:\s*"([^"]+)",\s*mobileE164:\s*"([^"]+)",\s*monogram:\s*"([^"]*)",\s*photo:\s*"([^"]*)",/g,
  ),
].map((m) => ({
  slug: m[1],
  name: m[2],
  known: m[3],
  role: m[4],
  roleSlugs: [...m[5].matchAll(/"([a-z0-9-]+)"/g)].map((r) => r[1]),
  email: m[6],
  mobile: m[7],
  mobileE164: m[8],
  monogram: m[9],
  photo: m[10],
}));

ok("constants/team.ts parses", TEAM.length >= 3, `parsed ${TEAM.length} card(s)`);
if (TEAM.length === 0) {
  console.log(`\n  ✗ ${fails.join("\n  ✗ ")}\n`);
  process.exit(1);
}

const site = read("constants/site.ts");
const ORG = (site.match(/name:\s*"([^"]+)"/) ?? [])[1] ?? "";
const SITE_URL = (site.match(/url:\s*"(https:\/\/[^"]+)"/) ?? [])[1] ?? "";
const ADDRESS = (site.match(/\n  address:\s*\n?\s*"([^"]+)"/) ?? [])[1] ?? "";
const COMPANY_EMAIL =
  (teamSrc.match(/CARD_COMPANY[\s\S]*?email:\s*"([^"]+)"/) ?? [])[1] ?? "";

ok("the org name, site url, address and company email all resolved",
   Boolean(ORG && SITE_URL && ADDRESS && COMPANY_EMAIL),
   `org=${ORG} url=${SITE_URL} addr=${ADDRESS.slice(0, 20)} email=${COMPANY_EMAIL}`);

/* ---- 2. slugs cannot collide with anything the site already serves ---- */
const appDirs = readdirSync(at("app")).filter((e) => statSync(at(`app/${e}`)).isDirectory());
const publicTop = readdirSync(at("public"));
/* Words a future route is likely to want, plus the ones Cloudflare and Next
   own. Cheap to reserve now; impossible to reclaim once printed. */
const RESERVED = new Set([
  "api", "app", "assets", "cards", "cdn", "go", "images", "img", "media", "static",
  "_next", "public", "sitemap", "robots", "manifest", "sw", "favicon", "index",
  "home", "shop", "store", "cart", "checkout", "search", "news", "team", "people",
  "jobs", "job", "pricing", "price", "support", "help", "legal", "policy", "policies",
]);
const seen = new Set();
for (const m of TEAM) {
  for (const s of [m.slug, ...m.roleSlugs]) {
    ok(`slug "${s}" is url-safe`, /^[a-z][a-z0-9-]{1,30}$/.test(s));
    ok(`slug "${s}" is not already an app/ route`, !appDirs.includes(s),
       `app/${s}/ exists — the printed card would silently open that page instead`);
    ok(`slug "${s}" does not collide with a public/ file`,
       !publicTop.includes(s) && !publicTop.includes(`${s}.png`) && !publicTop.includes(`${s}.html`));
    ok(`slug "${s}" is not a reserved word`, !RESERVED.has(s),
       "a future route will want this name, and a printed card cannot be recalled");
    ok(`slug "${s}" is used once`, !seen.has(s));
    seen.add(s);
  }
}

/* ---- 3. printed number vs dialled number ---- */
for (const m of TEAM) {
  const printed = m.mobile.replace(/\D/g, "");
  const dialled = m.mobileE164.replace(/\D/g, "");
  ok(`${m.slug}: mobileE164 is Malaysian E.164`, /^\+60\d{8,10}$/.test(m.mobileE164), m.mobileE164);
  ok(`${m.slug}: the printed number and the dialled number are the same number`,
     dialled === `60${printed.replace(/^0/, "")}`,
     `card reads ${m.mobile}, tel: dials ${m.mobileE164} — one of them is a typo, and neither is visible on screen`);
  ok(`${m.slug}: the monogram is set`, /^[A-Z]{1,2}$/.test(m.monogram),
     `"${m.monogram}" — the disc is the first thing on the page; deriving initials from the full name gives nobody's initials`);
  ok(`${m.slug}: email is on a company domain`, /@a2zcreative\.my$/.test(m.email), m.email);
}

/* ---- 4. the vCard, rebuilt from the constants and compared ---- */
/* RFC 6350 §3.4: , ; and \ are structural inside a value and must be escaped,
   or "34-02, Jalan ..." splits into two address components on import. */
const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");

/* The structured address, checked against the ONE address string the rest of
   the company prints (constants/site.ts, which matches lib/issuers.ts). */
const ADR = {
  street: "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika",
  city: "Johor Bahru",
  region: "Johor",
  post: "81200",
  country: "Malaysia",
};
for (const [k, v] of Object.entries(ADR)) {
  ok(`the vCard address part "${k}" appears in the site address`, ADRcontains(v),
     `"${v}" is not in constants/site.ts address — the card would give a client a different address from the invoice`);
}
function ADRcontains(v) {
  return ADDRESS.includes(v);
}

const vcardFor = (m) =>
  [
    "BEGIN:VCARD",
    "VERSION:3.0",
    /* Given name only, no surname field: Malay names do not invert, and a
       phone that decides "MOHD" is a surname sorts the contact wrongly and
       greets them by it. */
    `N:;${esc(m.name)};;;`,
    `FN:${esc(m.name)}`,
    `ORG:${esc(ORG)}`,
    `TITLE:${esc(m.role)}`,
    `TEL;TYPE=CELL,VOICE:${m.mobileE164}`,
    `EMAIL;TYPE=WORK,INTERNET:${m.email}`,
    `EMAIL;TYPE=WORK,INTERNET:${COMPANY_EMAIL}`,
    `ADR;TYPE=WORK:;;${esc(ADR.street)};${esc(ADR.city)};${esc(ADR.region)};${esc(ADR.post)};${esc(ADR.country)}`,
    `URL:${SITE_URL}/${m.slug}`,
    `NOTE:${esc(`${m.known} - ${ORG}`)}`,
    "END:VCARD",
    "",
  ].join("\r\n");

for (const m of TEAM) {
  const rel = `public/cards/${m.slug}.vcf`;
  const want = vcardFor(m);
  if (WRITE) {
    writeFileSync(at(rel), want, "utf8");
    console.log(`  wrote ${rel}`);
    continue;
  }
  if (!existsSync(at(rel))) {
    fails.push(`${rel} does not exist — "Save to contacts" would download nothing`);
    continue;
  }
  const got = readFileSync(at(rel), "utf8");
  ok(`${rel} matches constants/team.ts`, got === want,
     got.replace(/\r/g, "") === want.replace(/\r/g, "")
       ? "same text, wrong line endings — vCard is CRLF (check .gitattributes)"
       : "run: node tests/business-cards.mjs --write");
  ok(`${rel} is CRLF`, /\r\n/.test(got));
}
if (WRITE) {
  console.log(`\nRegenerated ${TEAM.length} vCard(s) from constants/team.ts.`);
  process.exit(0);
}

/* ---- 5. line endings survive the checkout that builds the site ---- */
const gitattrs = read(".gitattributes");
ok(".gitattributes pins *.vcf to CRLF", /\*\.vcf\s+text\s+eol=crlf/.test(gitattrs),
   "`* text=auto` would rewrite the vCards to LF on the Linux build container, after this guard passed");

/* ---- 6. the route renders exactly these people, statically ---- */
const page = read("app/[card]/page.tsx");
ok("the card route builds its paths from TEAM",
   /generateStaticParams[\s\S]{0,200}?TEAM\.map/.test(page));
ok("an unknown path is a plain 404", /dynamicParams = false/.test(page),
   "without this, a static export can behave unpredictably for paths that are not cards");
ok("the card page ships no client JavaScript of its own", !/^"use client"/m.test(page),
   "the one URL a client types after meeting you should be a file on a CDN, not an app");
ok("the page links the vCard as a download", /download=\{`\$\{m\.slug\}/.test(page));
ok("the page carries Person structured data", /"@type": "Person"/.test(page));

/* ---- 7. the assets each card needs ---- */
for (const m of TEAM) {
  for (const [rel, why] of [
    [`public/cards/${m.slug}-og.png`, "forwarding the link in WhatsApp would show a bare URL"],
    [`public/cards/${m.slug}-qr.png`, "the on-page QR would be a broken image"],
  ]) {
    const there = existsSync(at(rel));
    ok(`${rel} exists`, there, why);
    if (there) ok(`${rel} is a real image`, statSync(at(rel)).size > 2000, "suspiciously small");
  }
  if (m.photo) {
    ok(`${m.slug}: the photo file exists`, existsSync(at(`public${m.photo}`)),
       `${m.photo} is set in constants/team.ts but not in public/`);
  }
}

/* ---- 8. the role aliases ---- */
const redirects = read("public/_redirects");
for (const m of TEAM) {
  for (const r of m.roleSlugs) {
    const line = redirects.split(/\r?\n/).find((l) => l.trim().startsWith(`/${r}`));
    ok(`/${r} redirects`, Boolean(line), `no /${r} line in public/_redirects`);
    if (!line) continue;
    ok(`/${r} points at /${m.slug}`, new RegExp(`\\s/${m.slug}\\s`).test(line), line.trim());
    ok(`/${r} is a 302`, /\s302\s*$/.test(line.trim()),
       "a 301 is cached by the browser forever, and a role changes hands");
  }
}

/* ---- 9. the cards are findable, and served as vCards ---- */
const sitemap = read("app/sitemap.ts");
ok("the sitemap lists the cards from TEAM", /TEAM\.map/.test(sitemap),
   "a card that is not in the sitemap is a page only somebody holding the paper can find");

const headers = read("public/_headers");
ok("public/_headers serves .vcf as text/vcard",
   /\/cards\/\*\.vcf[\s\S]{0,200}?Content-Type:\s*text\/vcard/.test(headers),
   "served as octet-stream, some phones save the contact as a file instead of opening it");

console.log(
  fails.length === 0
    ? `PASS — ${TEAM.length} cards, no slug collisions, vCards match the constants, aliases redirect (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);

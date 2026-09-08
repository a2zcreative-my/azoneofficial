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
 *   python scripts/card-og.py               # regenerate the QR + OG images
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WRITE = process.argv.includes("--write");
import { fileURLToPath } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname.
   On Windows `new URL("..", import.meta.url).pathname` is "/C:/Users/..." -
   a URL path with a leading slash, not a file path - so join() produced
   "\\C:\\Users\\..." and every read failed with "C:\\C:\\Users\\...". These
   guards had only ever run in Cloudflare's Linux build container, where the
   two happen to be the same string; the day PUSH.bat started running them on
   the CEO's own PC, 49 of them failed at once on a bug that was never about
   the code they check. */
const root = fileURLToPath(new URL("..", import.meta.url));
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
/* v1.128.0 — `known` and `role` became { en, ms } pairs when the cards went
   bilingual. The parser follows the data, and the checks below now assert the
   thing that actually matters: BOTH halves exist and neither is blank. A card
   that silently loses one language reads as a broken page in that language,
   which is worse than a card that was never translated. */
const TEAM = [
  ...teamSrc.matchAll(
    /\{\s*slug:\s*"([a-z0-9-]+)",\s*name:\s*"([^"]+)",\s*known:\s*\{\s*en:\s*"([^"]*)",\s*ms:\s*"([^"]*)"\s*\},\s*role:\s*\{\s*en:\s*"([^"]*)",\s*ms:\s*"([^"]*)"\s*\},\s*roleSlugs:\s*\[([^\]]*)\],\s*email:\s*"([^"]+)",\s*mobile:\s*"([^"]+)",\s*mobileE164:\s*"([^"]+)",\s*monogram:\s*"([^"]*)",\s*photo:\s*"([^"]*)",/g,
  ),
].map((m) => ({
  slug: m[1],
  name: m[2],
  known: { en: m[3], ms: m[4] },
  role: { en: m[5], ms: m[6] },
  roleSlugs: [...m[7].matchAll(/"([a-z0-9-]+)"/g)].map((r) => r[1]),
  email: m[8],
  mobile: m[9],
  mobileE164: m[10],
  monogram: m[11],
  photo: m[12],
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
    /* v1.128.0 — a vCard carries ONE title and the cards are bilingual, so
       this is a choice, not a fallback: the MALAY one (CEO, 06-09-2026),
       matching what the card opens in, what the preview image shows and what
       schema.org publishes. Every one-string artefact on this card agrees. */
    `TITLE:${esc(m.role.ms)}`,
    `TEL;TYPE=CELL,VOICE:${m.mobileE164}`,
    `EMAIL;TYPE=WORK,INTERNET:${m.email}`,
    `EMAIL;TYPE=WORK,INTERNET:${COMPANY_EMAIL}`,
    `ADR;TYPE=WORK:;;${esc(ADR.street)};${esc(ADR.city)};${esc(ADR.region)};${esc(ADR.post)};${esc(ADR.country)}`,
    `URL:${SITE_URL}/${m.slug}`,
    `NOTE:${esc(`${m.known.ms} - ${ORG}`)}`,
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
/* v1.128.0 — the readable body moved to components/cards/card-view.tsx so the
   BM/EN switcher could hold state. These checks are about THE CARD, not about
   which file a line ended up in, so they read both as one text. */
const page = read("app/[card]/page.tsx") + "\n" + read("components/cards/card-view.tsx");
ok("the card route builds its paths from TEAM",
   /generateStaticParams[\s\S]{0,200}?TEAM\.map/.test(page));
ok("an unknown path is a plain 404", /dynamicParams = false/.test(page),
   "without this, a static export can behave unpredictably for paths that are not cards");
/* v1.128.0 — this used to read "no client JavaScript of its own", and the
   BM/EN switcher needs state, so it would now be a guard failing on a change
   that was asked for. What it MEANT is that a printed URL must resolve on a
   bad day: no data fetch, no API, still a static file. So it asks that.

   The routing half stays absolute — app/[card]/page.tsx itself must remain a
   server component, because generateStaticParams and generateMetadata cannot
   live in one that holds state. */
const routeSrc = read("app/[card]/page.tsx");
ok("the route file is still a server component",
   !/^"use client"/m.test(routeSrc),
   "generateStaticParams and generateMetadata cannot live in a client component");
ok("the card still fetches nothing at runtime",
   !/\bfetch\(|useSWR|api</.test(page),
   "the one URL a client types after meeting you has to resolve on a bad day - it is a file on a CDN, not an app");
/* Count the DECLARATIONS, not the word — the import line says useState too. */
ok("the card's only state is the language",
   (page.match(/=\s*useState[<(]/g) ?? []).length === 1,
   "a card that grew a second piece of state has grown into an app");
ok("the page links the vCard as a download", /download=\{`\$\{m\.slug\}/.test(page));
ok("the page carries Person structured data", /"@type": "Person"/.test(page));

/* ---- 7. the assets each card needs ---- */
for (const m of TEAM) {
  for (const [rel, why] of [
    [`public/cards/${m.slug}-og.png`, "forwarding the link in WhatsApp would show a bare URL - run: python scripts/card-og.py"],
    [`public/cards/${m.slug}-qr.png`, "the on-page QR would be a broken image - run: python scripts/card-og.py"],
  ]) {
    const there = existsSync(at(rel));
    ok(`${rel} exists`, there, why);
    if (there) ok(`${rel} is a real image`, statSync(at(rel)).size > 2000, "suspiciously small");
  }
  /* A photo is optional. When one IS set the page stops drawing the monogram
     and shows it instead, so a missing or broken file turns the first thing a
     client sees into a grey box. */
  if (m.photo) {
    const there = existsSync(at(`public${m.photo}`));
    ok(`${m.slug}: the photo file exists`, there,
       `${m.photo} is set in constants/team.ts but not in public/`);
    ok(`${m.slug}: the photo is a web image format`, /\.(jpe?g|png|webp)$/i.test(m.photo), m.photo);
    if (there) {
      ok(`${m.slug}: the photo is a real image`, statSync(at(`public${m.photo}`)).size > 5000,
         "suspiciously small - a placeholder or a failed export?");
      ok(`${m.slug}: the photo lives with the other card assets`, m.photo.startsWith("/cards/"),
         "keep them together, so one folder is the whole feature");
    }
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

/* ---- 8b. BILINGUAL (v1.128.0) ----------------------------------------
   The CEO asked for a switcher that actually switches, on all three cards,
   defaulting to Malay. The checks below are the properties that make that
   true, rather than the spelling of any one string.

   Negative-tested by: blanking one half of a role pair; renaming the storage
   key so the card kept a private preference; defaulting the component to
   English; dropping data-no-translate so the site-wide runtime walked the
   card as well. */
const cardCopySrc = read("constants/card-copy.ts");
const viewSrc = read("components/cards/card-view.tsx");

/* 1. Every readable field carries BOTH languages, and neither half is blank.
      A missing half is invisible in the language you are not testing in. */
for (const m of TEAM) {
  for (const [field, pair] of [["known", m.known], ["role", m.role]]) {
    ok(`${m.slug}: ${field} is written in both languages`,
       Boolean(pair.en?.trim()) && Boolean(pair.ms?.trim()),
       `en="${pair.en}" ms="${pair.ms}"`);
    ok(`${m.slug}: ${field} is not the same string twice`,
       pair.en.trim() !== pair.ms.trim(),
       "one language was pasted into both halves");
  }
}
/* lead and duties are multi-line in the source, so they are checked by shape
   rather than parsed: every record needs an en and an ms under each. */
for (const m of TEAM) {
  const rec = teamSrc.slice(teamSrc.indexOf(`slug: "${m.slug}"`));
  const block = rec.slice(0, rec.indexOf("\n  },"));
  for (const field of ["lead", "duties"]) {
    const at = block.indexOf(`${field}: {`);
    ok(`${m.slug}: ${field} has both languages`, at > -1
       && /en:/.test(block.slice(at, at + 1400)) && /ms:/.test(block.slice(at, at + 1400)));
  }
  const dutiesAt = block.indexOf("duties: {");
  const dutyLines = (block.slice(dutiesAt).match(/^\s{8}"/gm) ?? []).length;
  ok(`${m.slug}: the responsibilities list is filled in for both languages`,
     dutyLines >= 8, `${dutyLines} lines across en+ms`);
}

/* 2. The switcher is real: two labelled controls, current state visible,
      no navigation. A link would reload the page and lose the choice. */
ok("the card offers BM and EN as two labelled controls",
   /\bBM\b/.test(viewSrc) && /\bEN\b/.test(viewSrc)
   && (viewSrc.match(/<button[\s\S]{0,400}?aria-pressed/g) ?? []).length === 2,
   "two buttons, each announcing whether it is the one in force");
ok("which language is active is announced, not only coloured",
   /aria-pressed=\{lang === "ms"\}/.test(viewSrc) && /aria-pressed=\{lang === "en"\}/.test(viewSrc),
   "colour alone is not a state a screen reader or a colour-blind reader can read");
ok("switching does not navigate", !/<Link[^>]*lang=|href="\?lang/.test(viewSrc),
   "a link would reload the card and drop the choice");

/* 3. Malay is the default, and the default is what the static HTML holds --
      that is what makes the common case flash-free and hydration-safe. */
ok("the card renders Malay first", /useState<CardLang>\("ms"\)/.test(viewSrc),
   "any other initial value makes the server HTML and the first client render disagree");
ok("only an explicit English choice moves it off Malay",
   /getItem\(KEY\) === "en"/.test(viewSrc),
   "reading it the other way round would make English the default whenever storage is empty");

/* 4. ONE language preference per device. The site has had a toggle since
      v1.32.0; a second private key would be two switchers disagreeing. */
const runtime = read("components/live/lang-runtime.tsx");
const keyOf = (src) => (src.match(/const KEY = "([^"]+)"/) ?? [])[1];
const evOf = (src) => (src.match(/const EVENT = "([^"]+)"/) ?? [])[1];
ok("the card shares the site's language key",
   Boolean(keyOf(viewSrc)) && keyOf(viewSrc) === keyOf(runtime),
   `card=${keyOf(viewSrc)} site=${keyOf(runtime)}`);
ok("the card shares the site's change event",
   Boolean(evOf(viewSrc)) && evOf(viewSrc) === evOf(runtime),
   `card=${evOf(viewSrc)} site=${evOf(runtime)}`);
/* On the ELEMENT, not merely mentioned in a comment: the comment explaining
   why it is there survives its removal, which is exactly when this check has
   to fail. */
ok("the card is skipped by the site-wide text-swap runtime",
   /<main[^>]*\sdata-no-translate/.test(viewSrc) && /data-no-translate/.test(runtime),
   "two mechanisms editing the same text nodes is how half-Malay sentences happen");

/* 5. Nothing readable is hard-coded in the view: every string comes from a
      pair, which is the structure the CEO asked for. */
const CHROME = ["save", "call", "email", "responsibilities", "direct", "visit", "mobile", "office", "outOfCards"];
for (const k of CHROME) {
  ok(`"${k}" is in the copy file, in both languages`,
     new RegExp(`${k}: \\{ en: "[^"]+", ms: "[^"]+" \\}`).test(cardCopySrc));
  ok(`"${k}" is read from the copy file, not typed into the view`,
     new RegExp(`CARD_COPY\\.${k}`).test(viewSrc));
}

/* 6. What must NOT change. The CEO was explicit: contact details, numbers,
      addresses and URLs stay exactly as they are. */
ok("the contact details are still the record's, untranslated",
   /\{m\.mobile\}/.test(viewSrc) && /\{m\.email\}/.test(viewSrc)
   && /SITE_CONFIG\.address/.test(viewSrc) && /CARD_COMPANY\.email/.test(viewSrc));
ok("the dialled number, WhatsApp and mailto are unchanged",
   /tel:\$\{m\.mobileE164\}/.test(viewSrc)
   && /wa\.me\/\$\{m\.mobileE164\.replace/.test(viewSrc)
   && /mailto:\$\{m\.email\}/.test(viewSrc));

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

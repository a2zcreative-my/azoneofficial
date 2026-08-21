/* v1.30.0 — the brand-separation guard.
 *
 * CEO: "how to make sure that AZONE official and ELFIA is not in my A2Z
 * system?" The answer is enforced here, so it survives future edits:
 *
 *  1. constants/brands.ts is the ONLY place a sister company's or a client's
 *     domain is written. No component may hardcode one — a domain change has
 *     to be one edit, not a hunt.
 *  2. ELFIA is kind: "client". A client is never listed among "our
 *     companies", because a shared logo row silently claims ownership.
 *  3. A client with no written permission on file renders NOWHERE public
 *     (the standing rule since v1.27.0, when the client strip came out of
 *     the hero).
 *  4. Every /go/<code> short link in public/_redirects points at the same
 *     URL the config declares — printed links must not rot.
 *  5. The A2Z site does not describe itself with a client's name.
 *
 * Run: node tests/brands-guard.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const errors = [];
const brandsSrc = readFileSync('constants/brands.ts', 'utf8');

/* --- 1. parse the declared brands out of the source (no TS runtime here) --- */
const entries = [...brandsSrc.matchAll(/\{\s*code:\s*"([a-z0-9-]+)",[\s\S]*?kind:\s*"(company|client)",[\s\S]*?url:\s*"([^"]+)",[\s\S]*?\}/g)]
  .map((m) => ({ code: m[1], kind: m[2], url: m[3] }));

if (entries.length < 3) errors.push(`expected at least 3 brands in constants/brands.ts, parsed ${entries.length}`);

const a2z = entries.find((b) => b.code === 'a2z');
const azone = entries.find((b) => b.code === 'azone');
const elfia = entries.find((b) => b.code === 'elfia');

if (a2z?.url !== 'https://a2zcreative.my') errors.push(`a2z url must be https://a2zcreative.my, got ${a2z?.url}`);
if (azone?.url !== 'https://azoneofficial.com') errors.push(`azone url must be https://azoneofficial.com, got ${azone?.url}`);
if (elfia?.url !== 'https://elfiaofficialstore.my') errors.push(`elfia url must be https://elfiaofficialstore.my (the canonical shop — the .com redirects to it), got ${elfia?.url}`);

/* --- 2. ELFIA is a client, never a company --- */
if (elfia?.kind !== 'client') {
  errors.push('ELFIA is marked as a company. It is a CLIENT of A2Z — listing it among our companies claims we own it.');
}
if (azone?.kind !== 'company') errors.push('AZ ONE OFFICIAL must be kind "company" — it is your own entity, a separate SSM registration.');

/* --- 3. permission gate exists and is honest --- */
if (!/permissionOnFile\?:\s*boolean/.test(brandsSrc)) {
  errors.push('the permissionOnFile gate is gone from the Brand type — client marks would publish without permission');
}
if (!/PUBLISHABLE_CLIENTS[\s\S]*?permissionOnFile === true/.test(brandsSrc)) {
  errors.push('PUBLISHABLE_CLIENTS no longer filters on permissionOnFile === true');
}
if (!/OUR_COMPANIES[\s\S]*?kind === "company"/.test(brandsSrc)) {
  errors.push('OUR_COMPANIES no longer filters on kind === "company" — a client could leak into the companies row');
}

/* --- 4. /go/<code> short links agree with the config --- */
const redirects = readFileSync('public/_redirects', 'utf8');
for (const b of entries) {
  if (b.code === 'a2z') continue; // we are a2zcreative.my; no short link to ourselves
  const line = redirects.split(/\r?\n/).find((l) => l.trim().startsWith(`/go/${b.code}`));
  if (!line) { errors.push(`public/_redirects has no /go/${b.code} short link`); continue; }
  if (!line.includes(b.url)) errors.push(`/go/${b.code} points somewhere other than ${b.url}: ${line.trim()}`);
  if (/\s301\s*$/.test(line)) errors.push(`/go/${b.code} is a 301 — browsers cache that forever. Use 302 so a future move still works.`);
}

/* --- 5. nobody hardcodes the other domains --- */
const ALLOW = new Set([
  'constants/brands.ts',            // the source of truth for MARKETING links
  /* lib/issuers.ts is the second legitimate source: a legal letterhead. Each
     entity prints its OWN website there, and an issued document must keep
     the address it was issued with. Its values are asserted explicitly
     below rather than being scanned for. */
  'lib/issuers.ts',
  'public/_redirects',              // the short links
  'worker/wrangler.toml',           // routes + origins (infrastructure)
  'tests/brands-guard.mjs',
  'tests/origins-guard.mjs',
]);
const SCAN_DIRS = ['app', 'components', 'lib', 'constants'];
const offenders = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(p)) continue;
    if (ALLOW.has(p)) continue;
    const src = readFileSync(p, 'utf8');
    /* Comments may name these domains freely — the rule is about CODE. That
       needs a real block-comment tracker, not a per-line prefix test: the
       v1.4.240 note in the Sales tab wraps onto a line that begins with a
       quote, and a prefix test flagged it as a hardcoded URL. */
    let inBlock = false;
    for (const raw of src.split(/\r?\n/)) {
      const wasInBlock = inBlock;
      const opens = (raw.match(/\/\*/g) ?? []).length;
      const closes = (raw.match(/\*\//g) ?? []).length;
      if (opens > closes) inBlock = true;
      else if (closes > opens) inBlock = false;
      if (wasInBlock) continue;
      /* Strip a trailing line comment — but NOT the "//" inside a URL.
         The naive /\/\/.*$/ turned `const x = "https://elfiaofficialstore.my"`
         into `const x = "https:` and the scanner found nothing, which is the
         exact case this guard exists to catch. Only a "//" at line start or
         after whitespace begins a comment. */
      const line = raw.replace(/(^|\s)\/\/.*$/, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/^\s*(\/\/|\*|\/\*)/.test(raw)) continue;
      if (/elfiaofficialstore|azoneofficial\.com/.test(line)) {
        /* the staff MAILBOX domain and the frozen calendar UID namespace are
           legitimately azoneofficial.com and are checked by origins-guard */
        if (/@azoneofficial\.com/.test(line)) continue;
        offenders.push(`${p}: ${line.trim().slice(0, 110)}`);
      }
    }
  }
};
for (const d of SCAN_DIRS) walk(d);
if (offenders.length) {
  errors.push('a sister/client domain is hardcoded outside constants/brands.ts:\n     - ' + offenders.join('\n     - '));
}

/* --- 5b. each entity's letterhead prints ITS OWN website --- */
const issuers = readFileSync('lib/issuers.ts', 'utf8');
const azOneBlock = issuers.slice(issuers.indexOf('export const AZ_ONE'), issuers.indexOf('export const A2Z_CREATIVE'));
const a2zBlock = issuers.slice(issuers.indexOf('export const A2Z_CREATIVE'), issuers.indexOf('export const DOCUMENT_ISSUER'));
if (!/website:\s*"azoneofficial\.com"/.test(azOneBlock)) {
  errors.push("AZ ONE's letterhead website changed — its documents must keep its own address");
}
if (!/website:\s*"a2zcreative\.my"/.test(a2zBlock)) {
  errors.push("A2Z's letterhead prints a website that is not a2zcreative.my — an invoice would send the client to the wrong (or a dead) address");
}
if (!/email:\s*"admin@azoneofficial\.com"/.test(a2zBlock)) {
  errors.push("A2Z's letterhead email moved off @azoneofficial.com — the Google Workspace mailboxes have not moved, so that address would bounce");
}

/* --- 6. the A2Z site does not sell itself using a client's name --- */
const siteConfig = readFileSync('constants/site.ts', 'utf8');
if (/elfia/i.test(siteConfig)) errors.push("constants/site.ts names a client — A2Z's own identity must not lean on a client brand");

/* v1.33.0 — every brand needs BOTH a light-surface and a dark-surface mark,
   and the footer must use the dark-surface one. ELFIA's maroon wordmark
   shipped onto the navy footer once and was nearly invisible. */
{
  const brands = readFileSync('constants/brands.ts', 'utf8');
  if (!/logoOnDark:\s*string;/.test(brands)) {
    errors.push('constants/brands.ts: the logoOnDark field is gone — a coloured mark would end up on the navy footer');
  }
  const entries = (brands.match(/logo:\s*"/g) || []).length;
  const darks = (brands.match(/logoOnDark:\s*"/g) || []).length;
  if (entries !== darks) {
    errors.push(`constants/brands.ts: ${entries} logo entries but ${darks} logoOnDark — every brand needs both`);
  }
  for (const [file, why] of [
    ['components/layout/footer.tsx', 'the navy footer must render b.logoOnDark, not b.logo'],
  ]) {
    let src = '';
    try { src = readFileSync(file, 'utf8'); } catch { /* file gone — other checks cover that */ }
    if (/src=\{b\.logo\}/.test(src)) errors.push(`${file}: ${why}`);
  }
}

if (errors.length) { console.log('FAIL\n - ' + errors.join('\n - ')); process.exit(1); }
console.log(`PASS — ${entries.length} brands from one source, ELFIA is a client, permission gate intact, /go short links match, no hardcoded domains`);

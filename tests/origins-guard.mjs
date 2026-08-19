/* v1.29.2 — single-domain guard (was the two-domain transition guard).

   CEO's decision, 19-08-2026: "No more API under azoneofficial.com." The
   contract this file enforces changed with it:
   1) the worker routes carry a2zcreative.my and its www twin, and NOTHING
      else — a stray old-domain route reappearing means someone re-added it
      in the dashboard, which is how the site worker ended up hijacking
      /api/* and 500-ing every signed-in page on 19-08;
   2) ALLOWED_ORIGINS names a2zcreative.my first, and the legacy
      single-value ALLOWED_ORIGIN agrees with it — a mismatch means an older
      Worker build would mint links on a domain we no longer serve;
   3) the public site's canonical URL is the new domain;
   4) COMPANY_DOMAIN stays azoneofficial.com — it is the staff EMAIL domain
      (Google Workspace), not the website, and it gates who may hold a staff
      role. Changing it with the website would lock every existing staff
      member out of their own role edits;
   5) the calendar UID domain stays azoneofficial.com FOREVER — an opaque
      event-identity namespace; changing it duplicates every shift already
      sitting in staff phone calendars.
   Run: node tests/origins-guard.mjs */
import { readFileSync } from 'node:fs';

const errors = [];
const toml = readFileSync('worker/wrangler.toml', 'utf8');

for (const pat of ['a2zcreative.my/api/*', 'www.a2zcreative.my/api/*']) {
  if (!toml.includes(`"${pat}"`)) errors.push(`worker route missing: ${pat}`);
}
const patterns = [...toml.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
for (const p of patterns) {
  if (!/^(www\.)?a2zcreative\.my\/api\/\*$/.test(p)) {
    errors.push(`unexpected worker route "${p}" — this config serves ONE domain. Restoring the old domain is a deliberate edit here, never a dashboard click.`);
  }
}
if (patterns.length !== 2) errors.push(`expected exactly 2 routes, found ${patterns.length}`);

const origins = /ALLOWED_ORIGINS\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? '';
if (!origins.startsWith('https://a2zcreative.my')) {
  errors.push(`ALLOWED_ORIGINS must list https://a2zcreative.my FIRST (every link we mint uses it). Got: ${origins}`);
}
const legacy = /ALLOWED_ORIGIN\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? '';
if (legacy !== 'https://a2zcreative.my') {
  errors.push(`ALLOWED_ORIGIN (legacy single value) is "${legacy}" — it must match the primary origin, or an older Worker build mints links on a dead domain`);
}

/* v1.29.3 — the consultancy site's one door. It must be its OWN variable:
   the day azoneofficial.com appears in ALLOWED_ORIGINS instead, that domain
   can sign people in again, which is not what "separate entity, separate
   site" means. */
const formOrigins = /PUBLIC_FORM_ORIGINS\s*=\s*"([^"]*)"/.exec(toml)?.[1] ?? '';
if (!formOrigins.includes('https://azoneofficial.com')) {
  errors.push('PUBLIC_FORM_ORIGINS no longer admits https://azoneofficial.com — the consultancy site\'s contact form would 403');
}
if (origins.includes('azoneofficial.com')) {
  errors.push('azoneofficial.com is back in ALLOWED_ORIGINS — that grants it sign-in, not just the enquiry form. Use PUBLIC_FORM_ORIGINS.');
}
if (formOrigins.includes('elfiaofficialstore')) {
  errors.push('ELFIA is a CLIENT brand — its store must not be able to post into the A2Z enquiry inbox');
}
const idxForm = readFileSync('worker/src/index.ts', 'utf8');
if (!/path === "\/api\/v1\/enquiries" && \(request\.method === "POST" \|\| request\.method === "OPTIONS"\)/.test(idxForm)) {
  errors.push('the public-form origin exception is no longer scoped to POST/OPTIONS /api/v1/enquiries — it must never widen to the whole API');
}

const site = readFileSync('constants/site.ts', 'utf8');
if (!site.includes('url: "https://a2zcreative.my"')) errors.push('SITE_CONFIG.url is not the canonical domain');

if (!/COMPANY_DOMAIN\s*=\s*"azoneofficial\.com"/.test(toml)) {
  errors.push('COMPANY_DOMAIN moved off azoneofficial.com — that is the staff MAILBOX domain, not the website. Until Google Workspace moves, changing it blocks every staff-role edit.');
}

const ics = readFileSync('lib/event-ics.ts', 'utf8');
if (!ics.includes('@azoneofficial.com')) errors.push('lib/event-ics.ts UID domain changed — this duplicates every event already in staff calendars. It is frozen at azoneofficial.com BY DESIGN.');

const idx = readFileSync('worker/src/index.ts', 'utf8');
if (!idx.includes('ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN')) errors.push('allowedOrigins() no longer honours the ALLOWED_ORIGINS list');
if (!/const oauthBase = allowedOrigins\(env\)\.includes\(selfOrigin\)/.test(idx)) errors.push('Google OAuth redirect is no longer host-aware');
/* v1.29.1 outage: route() has no `url` — that identifier belongs to fetch().
   The compile gate catches it properly; this is the cheap text backstop. */
if (/^\s*const selfOrigin = `\$\{url\./m.test(idx)) errors.push('route() references `url`, which does not exist there — this is the v1.29.0 outage bug');

if (errors.length) { console.log('FAIL\n - ' + errors.join('\n - ')); process.exit(1); }
console.log('PASS — one domain routed (a2zcreative.my), consultancy site limited to the enquiry form, canonical set, COMPANY_DOMAIN untouched, .ics UID frozen, OAuth host-aware');

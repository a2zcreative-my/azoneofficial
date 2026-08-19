/* v1.29.0 — domain-migration guard. Enforces the transition contract:
   1) BOTH domains stay wired: worker routes carry a2zcreative.my AND
      azoneofficial.com (+ www twins) — dropping the old domain breaks every
      customer share link ever sent and the TikTok Partner Center callback;
   2) ALLOWED_ORIGINS lists the new domain FIRST (links we mint) and keeps
      the old one (stale tabs, transition sign-ins);
   3) the public site's canonical URL is the new domain;
   4) the calendar UID domain stays azoneofficial.com FOREVER — it is an
      opaque event-identity namespace; changing it duplicates every shift
      already sitting in staff phone calendars.
   Run: node tests/origins-guard.mjs */
import { readFileSync } from 'node:fs';

const errors = [];
const toml = readFileSync('worker/wrangler.toml', 'utf8');
for (const pat of ['a2zcreative.my/api/*', 'www.a2zcreative.my/api/*', 'azoneofficial.com/api/*', 'www.azoneofficial.com/api/*']) {
  if (!toml.includes(`"${pat}"`)) errors.push(`worker route missing: ${pat}`);
}
const origins = /ALLOWED_ORIGINS\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? '';
if (!origins.startsWith('https://a2zcreative.my')) errors.push(`ALLOWED_ORIGINS must list https://a2zcreative.my FIRST (links we generate use it). Got: ${origins}`);
if (!origins.includes('https://azoneofficial.com')) errors.push('ALLOWED_ORIGINS dropped https://azoneofficial.com — stale tabs and the transition would break');

const site = readFileSync('constants/site.ts', 'utf8');
if (!site.includes('url: "https://a2zcreative.my"')) errors.push('SITE_CONFIG.url is not the new canonical domain');

const ics = readFileSync('lib/event-ics.ts', 'utf8');
if (!ics.includes('@azoneofficial.com')) errors.push('lib/event-ics.ts UID domain changed — this duplicates every event already in staff calendars. It is frozen at azoneofficial.com BY DESIGN.');

const idx = readFileSync('worker/src/index.ts', 'utf8');
if (!idx.includes('ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN')) errors.push('allowedOrigins() no longer honours the ALLOWED_ORIGINS list');
if (!/const oauthBase = allowedOrigins\(env\)\.includes\(selfOrigin\)/.test(idx)) errors.push('Google OAuth redirect is no longer host-aware — sign-in would break on one of the two domains');

if (errors.length) { console.log('FAIL\n - ' + errors.join('\n - ')); process.exit(1); }
console.log('PASS — both domains routed, a2zcreative.my primary, canonical flipped, .ics UID frozen, OAuth host-aware');

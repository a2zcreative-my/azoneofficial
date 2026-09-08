/* v1.26.3 — the Android "NO LOCATION (blocked)" mystery was OUR OWN header:
   public/_headers shipped `Permissions-Policy: … geolocation=()` (v1.23.5),
   which tells the browser to forbid the Geolocation API site-wide. Android
   Chrome/Samsung Internet enforce it (instant PERMISSION_DENIED regardless
   of user grants); iPhone Safari ignores the directive — hence "only the
   android phone". Three releases hunted phone settings for a build bug.

   This guard makes that class of regression impossible to ship quietly:
   1) public/_headers must allow geolocation for self (and keep camera/mic
      locked — nothing in the app uses them);
   2) the client must carry the featurePolicy self-diagnosis, so if a build
      ever forbids geolocation again the portal says "site build blocked it
      — redeploy" instead of blaming the phone.
   Run: node tests/permissions-policy.mjs */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));

const errors = [];
const headers = readFileSync('public/_headers', 'utf8');
const policyLine = headers.split('\n').find((l) => /^\s*Permissions-Policy:/.test(l));
if (!policyLine) errors.push('public/_headers no longer sets Permissions-Policy at all');
else {
  if (!/geolocation=\(self\)/.test(policyLine)) errors.push(`Permissions-Policy must allow geolocation=(self) — staff clock-in needs it. Line: ${policyLine.trim()}`);
  if (!/camera=\(\)/.test(policyLine)) errors.push('camera should stay locked: camera=()');
  if (!/microphone=\(\)/.test(policyLine)) errors.push('microphone should stay locked: microphone=()');
}
const headerLines = headers.split('\n').filter((l) => !/^\s*#/.test(l)); // comments may cite the old bug
if (headerLines.some((l) => /geolocation=\(\)/.test(l))) errors.push('geolocation=() found on a live header line — this exact directive blocked every Android clock-in (v1.23.5–v1.26.2)');

// No comment lines inside rule blocks — the _headers parser can misread an
// indented "# …" line as a header. Comments belong above the first rule.
const firstRule = headers.split('\n').findIndex((l) => /^\S/.test(l) && !/^\s*#/.test(l) && l.trim() !== '');
const afterRules = headers.split('\n').slice(firstRule);
if (afterRules.some((l) => /^\s+#/.test(l) || (/^#/.test(l) && afterRules.indexOf(l) > 0))) {
  errors.push('comment line found inside/after a rule block in public/_headers — move comments above the first rule');
}

/* v1.139.1 - THE PUNCH FLOW, WHEREVER IT LIVES.
   This read app/portal/page.tsx by name. v1.114.0 split that 605 KB page into
   fourteen domain files and the clock went with it, so both checks below have
   been failing since - invisibly, because run-guards only ever ran inside the
   Cloudflare build and nothing has deployed since 27 August. The diagnosis is
   alive and correct in components/portal/dashboard.tsx; the guard was asking
   the wrong file. Assert the PROPERTY, and let the file move. */
const punchFiles = [
  'app/portal/page.tsx',
  ...readdirSync(join(root, 'components/portal')).filter((f) => /\.tsx$/.test(f)).map((f) => `components/portal/${f}`),
].filter((f) => existsSync(join(root, f)));
const punchSrc = punchFiles.map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
if (!punchSrc.includes('allowsFeature("geolocation")')) errors.push('the featurePolicy self-diagnosis is gone from the portal — a policy-blocked build would again masquerade as a phone problem');
if (!/reason: "policy"/.test(punchSrc)) errors.push('the "policy" GpsFail reason is gone from the punch flow');


/* v1.27.0 — the Android self-help step names the installed app by its
   home-screen caption. That caption is public/manifest.json short_name. If a
   rebrand moves one and not the other, staff are told to look for an app that
   does not exist on their phone — which is exactly the dead end the v1.26.3
   fix existed to remove. Keep them in lockstep. */
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const help = readFileSync('components/portal/location-help.tsx', 'utf8');
const shortName = manifest.short_name;
if (!shortName) errors.push('public/manifest.json has no short_name');
else {
  const steps = help.split('\n').filter((l) => /Settings → Apps → find|Tetapan Android → Apl → cari/.test(l));
  if (steps.length !== 2) errors.push(`expected 2 Android "find <app>" steps (EN+BM) in location-help.tsx, found ${steps.length}`);
  for (const line of steps) {
    if (!line.includes(shortName)) errors.push(`location-help step does not name the PWA short_name "${shortName}": ${line.trim().slice(0, 90)}`);
  }
}

if (errors.length) { console.log('FAIL\n - ' + errors.join('\n - ')); process.exit(1); }
console.log(`PASS — geolocation allowed for self, camera/mic locked, policy self-diagnosis in place, Android help names "${shortName}"`);

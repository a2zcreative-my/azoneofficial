import { chromium } from 'playwright-core';
const LISTY = ['claims','leaves','tasks','announcements','users','entries','lines','cities','sessions','requests','hosts','records','items','banks','movements','invoices','orders','products','assets','prospects','notes','birthdays','punches','holidays','expenses','payslips','targets','user_targets','team_targets','rules','buckets','categories','accounts','suppliers','alerts','logs','events','comments','files','sales','days','rows','rates','staff','members','videos','contents','posts','stokis','codes','returns','stockouts','conflicts','free_today','unassigned','customers','docs','clients','credit_notes','packages','receipts','reconciliations','leave','enquiries','materials','outs'];
/* v1.139.0 - REWRITTEN FOR THE SHIFT-BASED CLOCK.
   The fixture was oldest-first, but /staff/attendance answers ORDER BY
   created_at DESC, and since v1.133.0 the dashboard reads today[0] as the
   LATEST punch. And the assertion was the one-pair rule this guard was
   written under: "a clock-in exists, so the card must say Clocked in". A day
   is a list of shifts now - after clocking out of the afternoon, the honest
   card says "Clocked out" and offers Clock in for the evening, so the old
   check would have failed CORRECT code.
   What this guard is still for is unchanged, and is the thing that matters:
   while the punches are unknown the card must not CLAIM anything. */
// HIS EXACT SITUATION: clocked in 09:13, clocked out 18:50 — server is slow.
const TODAY = new Date(Date.now() + 8*3600*1000).toISOString().slice(0,10);
// the API returns SQLite datetimes ("YYYY-MM-DD HH:MM:SS", UTC, no Z) —
// 01:13Z = 09:13 MYT, 10:50Z = 18:50 MYT, exactly the recording.
const ATT = { records: [
  { type: "clock_out", created_at: `${TODAY} 10:50:00` },
  { type: "clock_in",  created_at: `${TODAY} 01:13:00` },
], ot: [], ot_eligible: false,
  today_shift: {
    kind: "workday", label: "09:00-18:00", windows: [{ start: "09:00", end: "18:00" }],
    slots: [{ start: "09:00", end: "18:00", what: null, claimed: true }],
    slots_label: "09:00-18:00", can_clock_in: false, why_not: "all_claimed", can_ot: false,
  } };
/* v1.139.0 - the binary, the port and the screenshot folder come from the
   environment, with the old values as defaults, so this can run somewhere
   other than the machine it was written on. */
const BIN = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const PORT = process.env.PORTAL_PORT ?? '8931';
const SHOTS = process.env.SHOTS_DIR ?? '/root/azone/shots';
const b = await chromium.launch({ executablePath: BIN });
async function run(label, ctx) {
  const p = await ctx.newPage();
  const violations = [];
  await p.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()).pathname;
    await new Promise(r => setTimeout(r, url.includes('/auth/me') ? 50 : 1800)); // slow server
    let body = {}; for (const k of LISTY) body[k] = []; body.has_rules = false; body.days = 7; body.total_cents = 0;
    if (url.includes('/auth/me')) body = { user: { id: 42, email: "d@a.com", name: "Dini", role: "live_host" } };
    else if (url.includes('/staff/attendance')) body = ATT;
    else if (url.includes('/staff/revenue') && !url.includes('/lines')) body = { month: "2026-08", tiktok: { this_cents: 0, this_orders: 0, last_cents: 0, last_orders: 0 }, invoiced: { this_cents: 0, this_docs: 0, last_cents: 0, last_docs: 0 } };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p.goto(`http://localhost:${PORT}/portal.html`, { waitUntil: 'domcontentloaded' });
  // poll every 100ms through the whole slow load, looking for the false claim
  for (let t = 0; t < 2600; t += 100) {
    await p.waitForTimeout(100);
    const txt = await p.evaluate(() => document.body.innerText);
    if (txt.includes('No attendance recorded today')) violations.push(`${t}ms: "No attendance recorded today." while punches unknown`);
    /* v1.126.0: this matched the button by its 📍 pin, which is an <AppIcon>
       now and does not appear in innerText at all. `txt` is RENDERED text, so
       the honest test is the label itself: the offer is on screen while the
       person is already clocked in. */
    /* v1.139.0 - the false CLAIM is the violation, not the offer. With every
       shift clocked the button is disabled and reads "All shifts clocked",
       so an enabled "Clock in · next shift" while the answer is unknown is
       what this looks for. */
    if (/Clock in · next shift/.test(txt) && !/Clocked out ✓|Clocked in ✓/.test(txt)) violations.push(`${t}ms: "Clock in · next shift" offered while the day is unknown`);
    if (txt.includes('Not clocked in yet')) violations.push(`${t}ms: "Not clocked in yet"`);
  }
  const final = await p.evaluate(() => document.body.innerText);
  console.log(`${label}: violations=${violations.length}${violations.length ? ' → ' + violations[0] : ''}`);
  /* The day is over: the card says so, shows both times, and does not offer
     a clock-in for a shift that has been clocked. */
  const endsRight = final.includes('Clocked out ✓') && /09:13/.test(final) && /18:50/.test(final);
  if (!endsRight) violations.push(`final: expected "Clocked out ✓" with 09:13 and 18:50`);
  console.log(`${label}: ends correct → ${endsRight}`);
  await p.screenshot({ path: `${SHOTS}/noflash-${label}.png` }).catch(() => {});
  return violations.length;
}
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const v1 = await run('first-visit', ctx);
const v2 = await run('repeat-visit', ctx); // same context → remembered data
await b.close();
console.log(v1 === 0 && v2 === 0 ? '\nPASS — the portal never states a wrong attendance answer' : '\nFAIL');

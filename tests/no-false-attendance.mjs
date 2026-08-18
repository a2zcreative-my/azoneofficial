import { chromium } from 'playwright-core';
const LISTY = ['claims','leaves','tasks','announcements','users','entries','lines','cities','sessions','requests','hosts','records','items','banks','movements','invoices','orders','products','assets','prospects','notes','birthdays','punches','holidays','expenses','payslips','targets','user_targets','team_targets','rules','buckets','categories','accounts','suppliers','alerts','logs','events','comments','files','sales','days','rows','rates','staff','members','videos','contents','posts','stokis','codes','returns','stockouts','conflicts','free_today','unassigned','customers','docs','clients','credit_notes','packages','receipts','reconciliations','leave','enquiries','materials','outs'];
// HIS EXACT SITUATION: clocked in 09:13, clocked out 18:50 — server is slow.
const TODAY = new Date(Date.now() + 8*3600*1000).toISOString().slice(0,10);
// the API returns SQLite datetimes ("YYYY-MM-DD HH:MM:SS", UTC, no Z) —
// 01:13Z = 09:13 MYT, 10:50Z = 18:50 MYT, exactly the recording.
const ATT = { records: [
  { type: "clock_in",  created_at: `${TODAY} 01:13:00` },
  { type: "clock_out", created_at: `${TODAY} 10:50:00` },
], ot: [], ot_eligible: false };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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
  await p.goto('http://localhost:8931/portal.html', { waitUntil: 'domcontentloaded' });
  // poll every 100ms through the whole slow load, looking for the false claim
  for (let t = 0; t < 2600; t += 100) {
    await p.waitForTimeout(100);
    const txt = await p.evaluate(() => document.body.innerText);
    if (txt.includes('No attendance recorded today')) violations.push(`${t}ms: "No attendance recorded today." while punches unknown`);
    if (/📍\s*Clock in/.test(txt) && !txt.includes('Clocked in')) violations.push(`${t}ms: green "Clock in" offered though already clocked in`);
    if (txt.includes('Not clocked in yet')) violations.push(`${t}ms: "Not clocked in yet"`);
  }
  const final = await p.evaluate(() => document.body.innerText);
  console.log(`${label}: violations=${violations.length}${violations.length ? ' → ' + violations[0] : ''}`);
  console.log(`${label}: ends correct → "Clocked in ✓": ${final.includes('Clocked in ✓')} | shows 09:13/18:50: ${/09:13/.test(final) && /18:50/.test(final)}`);
  await p.screenshot({ path: `/root/azone/shots/noflash-${label}.png` });
  return violations.length;
}
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const v1 = await run('first-visit', ctx);
const v2 = await run('repeat-visit', ctx); // same context → remembered data
await b.close();
console.log(v1 === 0 && v2 === 0 ? '\nPASS — the portal never states a wrong attendance answer' : '\nFAIL');

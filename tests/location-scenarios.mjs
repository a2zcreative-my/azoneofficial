import { chromium } from 'playwright-core';
const LISTY = ['claims','leaves','tasks','announcements','users','entries','lines','cities','sessions','requests','hosts','records','items','banks','movements','invoices','orders','products','assets','prospects','notes','birthdays','punches','holidays','expenses','payslips','targets','user_targets','team_targets','rules','buckets','categories','accounts','suppliers','alerts','logs','events','comments','files','sales','days','rows','rates','staff','members','videos','contents','posts','stokis','codes','returns','stockouts','conflicts','free_today','unassigned','customers','docs','clients','credit_notes','packages','receipts','reconciliations','leave','enquiries','materials','outs'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function scenario(name, geoScript) {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  let punchBody = null;
  await p.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()).pathname;
    if (url.includes('/staff/attendance') && route.request().method() === 'POST') {
      punchBody = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); return;
    }
    let body = {}; for (const k of LISTY) body[k] = []; body.has_rules=false; body.days=7; body.total_cents=0;
    if (url.includes('/auth/me')) body = { user: { id: 9, email:"s@a.com", name:"Staff", role:"live_host" } };
    else if (url.includes('/attendance/geofence') && !url.includes('check')) body = { configured:true, radius_m:120, label:"AZ ONE HQ" };
    else if (url.includes('/staff/attendance')) body = { records: [], ot: [], ot_eligible:false };
    else if (url.includes('/staff/revenue')) body = { month:"2026-08", tiktok:{this_cents:0,this_orders:0,last_cents:0,last_orders:0}, invoiced:{this_cents:0,this_docs:0,last_cents:0,last_docs:0} };
    route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(body) });
  });
  await p.addInitScript(geoScript);
  await p.goto('http://localhost:8931/portal.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(1500);
  const pre = await p.evaluate(()=>document.body.innerText);
  if (!/Clock in/.test(pre)) { console.log(name, '-> CRASH detail:', (pre.match(/Detail for support:[^\n]*/)||['(none)'])[0]); await p.close(); return; }
  await p.locator('button:has-text("Clock in") >> visible=true').first().click();
  await p.waitForTimeout(3000);
  const txt = await p.evaluate(()=>document.body.innerText);
  console.log(`${name}\n   punch: ${punchBody ? 'SENT gps=' + JSON.stringify(punchBody.gps ?? null) + ' reason=' + JSON.stringify(punchBody.no_location_reason ?? null) : 'NO PUNCH'}`);
  const toast = txt.match(/(Location needed|Clocked in — without location|Clocked out — without location)[\s\S]{0,170}/);
  if (toast) console.log('   toast:', toast[0].split('\n').slice(0,3).join(' | ').trim().slice(0,150));
  await p.close();
}
// A: indoors — high accuracy TIMES OUT (the real staff situation), network works
await scenario('A. indoors: satellite times out, network works (the staff case)', () => {
  navigator.geolocation.getCurrentPosition = (ok, fail, opts) => {
    if (opts && opts.enableHighAccuracy) { setTimeout(()=>fail({code:3, message:'Timeout'}), 200); return; }
    setTimeout(()=>ok({ coords:{ latitude:1.544418, longitude:103.710033, accuracy:35 } }), 150);
  };
});
// B: permission genuinely denied
await scenario('B. permission actually denied', () => {
  navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(()=>fail({code:1, message:'Denied'}), 100);
});
// C: no signal at all
await scenario('C. no signal at all (both stages fail)', () => {
  navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(()=>fail({code:3, message:'Timeout'}), 100);
});
await b.close();

/* v1.29.1 — proves the CEO's complaint is fixed against the REAL built
   portal: clicking "Mark completed" on a roster chip must raise the same
   centred save-toast the rest of the portal uses, and a REJECTED patch must
   raise the "No change" variant instead of silently pretending. */
import { chromium } from 'playwright-core';

const LISTY = ['claims','leaves','tasks','announcements','users','entries','lines','cities','sessions','requests','hosts','records','items','banks','movements','invoices','orders','products','assets','prospects','notes','birthdays','punches','holidays','expenses','payslips','targets','user_targets','team_targets','rules','buckets','categories','accounts','suppliers','alerts','logs','events','comments','files','sales','days','rows','rates','staff','members','videos','contents','posts','stokis','codes','returns','stockouts','conflicts','free_today','unassigned','customers','docs','clients','credit_notes','packages','receipts','reconciliations','leave','enquiries','materials','outs','media','activity','balances','approvals','journal','journals','pos','allocations','spends','statements','runs','history','tabs','fences','documents','ot','batches','vault_docs','notifications'];
const OBJY  = ['by_status','by_courier','summary','totals','stats','counts','connection','health','by_state','geo','pipeline','breakdown','settings','config','balance','company'];

const SESSIONS = [{
  id: 501, session_date: '2026-08-19', start_time: '20:30', end_time: '22:30',
  platform: 'tiktok', status: 'scheduled', client: 'ELFIA', notes: null,
  host_user_id: 7, host_name: 'NUR DINI FARHANA BINTI NAZARUDIN', photo_key: null,
}];
const roster = () => ({
  week_start: '2026-08-17',
  days: ['2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22','2026-08-23'],
  manager: true, sessions: SESSIONS, on_leave: [], conflicts: [], requests: [],
  available_today: [], staff: [], hosts: [], free_today: [], unassigned: [],
});

const mode = process.argv[2] === 'fail' ? 'fail' : 'ok';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
await p.addInitScript(() => { try { sessionStorage.clear(); localStorage.setItem('azone-lang', 'en'); } catch {} });

let patched = null;
const errs = [];
p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));

await p.route('**/api/v1/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url()).pathname;

  if (/\/staff\/live-sessions\/\d+$/.test(url) && req.method() === 'PATCH') {
    patched = { url, body: req.postData() };
    if (mode === 'fail') {
      return route.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'forbidden', message: 'Manager access required' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  }

  const body = {};
  for (const k of LISTY) body[k] = [];
  for (const k of OBJY) body[k] = {};
  Object.assign(body, { has_rules: false, total_cents: 0, month: '2026-08', reports: [], shift: '', report: null });
  if (url.includes('/staff/roster')) Object.assign(body, roster());
  else if (url.includes('/staff/revenue') && !url.includes('/lines')) Object.assign(body, { month: '2026-08', tiktok: { this_cents: 0, this_orders: 0, last_cents: 0, last_orders: 0 }, invoiced: { this_cents: 0, this_docs: 0, last_cents: 0, last_docs: 0 } });
  else if (url.includes('/attendance/report')) Object.assign(body, { shift: '', records: [] });
  else if (url.includes('/auth/me')) body.user = { id: 1, email: 'ceo@a.com', name: 'Alif', role: 'ceo' };
  else if (url.includes('/staff/staff-list')) body.staff = [{ id: 7, name: 'NUR DINI FARHANA BINTI NAZARUDIN' }];
  else if (url.includes('/attendance/monitor')) Object.assign(body, { date: '2026-08-19', staff: [] });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await p.goto('http://localhost:8931/portal.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
await p.locator('button[aria-label="Attendance"]').first().click({ timeout: 8000 });
await p.waitForTimeout(1800);

// open the session chip -> detail card
const chip = p.locator('text=20:30').first();
await chip.click({ timeout: 8000 });
await p.waitForTimeout(700);

const markBtn = p.locator('button', { hasText: 'Mark completed' }).first();
const seenBtn = await markBtn.count();
await markBtn.click({ timeout: 8000 });
await p.waitForTimeout(900);

const text = await p.evaluate(() => document.body.innerText);
const toastRole = await p.locator('[role="status"]').count();
const has = (s) => text.includes(s);

const report = {
  mode,
  markButtonFound: seenBtn > 0,
  patchFired: patched !== null,
  patchBody: patched?.body ?? null,
  toastNodePresent: toastRole > 0,
  saysCompleted: has('Session completed'),
  saysNoChange: has('No change'),
  saysReason: has('Manager access required'),
  showsClientAndWhen: has('ELFIA') && has('19-08-2026'),
  pageErrors: errs.slice(0, 3),
};
console.log(JSON.stringify(report, null, 1));

const pass = mode === 'ok'
  ? report.patchFired && report.toastNodePresent && report.saysCompleted && !report.saysNoChange
  : report.patchFired && report.toastNodePresent && report.saysNoChange && report.saysReason && !report.saysCompleted;
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);

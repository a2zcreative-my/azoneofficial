/* v1.29.5 — multiple hosts on one slot, proven against the built portal.
   Picks a primary host, adds two more, schedules, and asserts that THREE
   sessions were created — same date/slot/client, one per host — and that the
   button promised that number before the click. */
import { chromium } from 'playwright-core';

const LISTY = ['claims','leaves','tasks','announcements','users','entries','lines','cities','sessions','requests','hosts','records','items','banks','movements','invoices','orders','products','assets','prospects','notes','birthdays','punches','holidays','expenses','payslips','targets','user_targets','team_targets','rules','buckets','categories','accounts','suppliers','alerts','logs','events','comments','files','sales','days','rows','rates','staff','members','videos','contents','posts','stokis','codes','returns','stockouts','conflicts','free_today','unassigned','customers','docs','clients','credit_notes','packages','receipts','reconciliations','leave','enquiries','materials','outs','media','activity','balances','approvals','journal','journals','pos','allocations','spends','statements','runs','history','tabs','fences','documents','ot','batches','vault_docs','notifications'];
const OBJY = ['by_status','by_courier','summary','totals','stats','counts','connection','health','by_state','geo','pipeline','breakdown','settings','config','balance','company'];

const STAFF = [
  { id: 7,  name: 'NUR DINI FARHANA BINTI NAZARUDIN' },
  { id: 8,  name: 'NUR NASUHA BINTI ZAINAL' },
  { id: 9,  name: 'NURFARAH SUAIDAH BINTI OTHMAN' },
  { id: 10, name: 'ZUL HISYAM BIN AMIR' },
];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
await p.addInitScript(() => { try { sessionStorage.clear(); localStorage.setItem('azone-lang', 'en'); } catch {} });

const created = [];
const errs = [];
p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));

await p.route('**/api/v1/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url()).pathname;
  if (url.endsWith('/staff/live-sessions') && req.method() === 'POST') {
    created.push(JSON.parse(req.postData() ?? '{}'));
    return route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
  }
  const body = {};
  for (const k of LISTY) body[k] = [];
  for (const k of OBJY) body[k] = {};
  Object.assign(body, { has_rules: false, total_cents: 0, month: '2026-08', reports: [], shift: '', report: null });
  if (url.includes('/staff/roster')) Object.assign(body, {
    week_start: '2026-08-17',
    days: ['2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22','2026-08-23'],
    manager: true, sessions: [], on_leave: [], conflicts: [], requests: [], available_today: [],
  });
  else if (url.includes('/staff/revenue') && !url.includes('/lines')) Object.assign(body, { month: '2026-08', tiktok: { this_cents: 0, this_orders: 0, last_cents: 0, last_orders: 0 }, invoiced: { this_cents: 0, this_docs: 0, last_cents: 0, last_docs: 0 } });
  else if (url.includes('/attendance/report')) Object.assign(body, { shift: '', records: [] });
  else if (url.includes('/auth/me')) body.user = { id: 1, email: 'ceo@a.com', name: 'Alif', role: 'ceo' };
  else if (url.includes('/staff/staff-list')) body.staff = STAFF;
  else if (url.includes('/attendance/monitor')) Object.assign(body, { date: '2026-08-19', staff: [] });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await p.goto('http://localhost:8931/portal.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
await p.locator('button[aria-label="Attendance"]').first().click({ timeout: 8000 });
await p.waitForTimeout(1500);
await p.locator('button', { hasText: 'New assignment' }).first().click({ timeout: 8000 });
await p.waitForTimeout(600);

const dialog = p.locator('text=New assignment').first();
await dialog.waitFor({ timeout: 5000 });

// client + primary host
await p.locator('input[placeholder="client / brand"]').fill('ELFIA');
const selects = p.locator('select');
await p.locator('select').first().selectOption({ label: STAFF[0].name });   // Host *
// add two more via the "+ Add another host" picker
const adder = p.locator('select[aria-label="Add another host"]');
const adderFound = await adder.count();
await adder.selectOption({ label: STAFF[1].name });
await p.waitForTimeout(250);
await adder.selectOption({ label: STAFF[2].name });
await p.waitForTimeout(350);

const chipsText = await p.locator('.mb-1\\.5.flex.flex-wrap').first().innerText().catch(() => '');
/* remove-then-readd: every chip must be removable, and taking out the one in
   the main picker must promote the next host rather than emptying the form */
await p.locator(`button[aria-label="Remove ${STAFF[0].name.split(' ').slice(0,2).join(' ')}"]`).first().click();
await p.waitForTimeout(300);
const afterRemove = await p.locator('button', { hasText: /^Schedule/ }).first().innerText();
const pickerAfterRemove = await p.locator('select').first().inputValue();
await p.locator('select[aria-label="Add another host"]').selectOption({ label: STAFF[0].name });
await p.waitForTimeout(300);
const btnLabel = await p.locator('button', { hasText: /^Schedule/ }).first().innerText();

await p.screenshot({ path: '/root/deliver/multi-host.png' });
await p.locator('button', { hasText: /^Schedule/ }).first().click();
await p.waitForTimeout(1200);
const toast = await p.evaluate(() => document.body.innerText);

const hosts = created.map((c) => c.host_user_id).sort((a, b2) => a - b2);
const sameSlot = created.every((c) => c.session_date === created[0]?.session_date && c.start_time === created[0]?.start_time && c.client_name === 'ELFIA');
const report = {
  adderRendered: adderFound === 1,
  chips: chipsText.replace(/\n+/g, ' | '),
  buttonPromised: btnLabel.trim(),
  afterRemovingPickedHost: afterRemove.trim(),
  pickerPromotedTo: pickerAfterRemove,
  sessionsCreated: created.length,
  hostIds: hosts,
  distinctHosts: new Set(hosts).size,
  allSameSlotAndClient: sameSlot,
  toastSaysThree: /Scheduled 3 sessions/.test(toast),
  pageErrors: errs.slice(0, 3),
};
console.log(JSON.stringify(report, null, 1));
const pass = report.adderRendered && report.sessionsCreated === 3 && report.distinctHosts === 3
  && report.allSameSlotAndClient && /3 sessions/.test(report.buttonPromised)
  && /2 sessions/.test(report.afterRemovingPickedHost) && report.pickerPromotedTo === String(STAFF[1].id)
  && report.pageErrors.length === 0;
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);

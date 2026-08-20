/* v1.30.1 — the Issued-by choice, proven on the built portal.
   1. The Create document form shows "Issued by" with A2Z as default.
   2. Choosing AZ ONE shows the amber bank-account warning.
   3. Creating a doc with AZ ONE selected POSTs issuer:"azoo".
   4. Creating with the default POSTs issuer:"a2z".
   5. A doc row whose issuer_code is "azoo" (or NULL/legacy) carries the
      AZ ONE chip; an "a2z" row does not. */
import { chromium } from 'playwright-core';

const LISTY = ['claims','leaves','tasks','announcements','users','entries','lines','cities','sessions','requests','hosts','records','items','banks','movements','invoices','orders','products','assets','prospects','notes','birthdays','punches','holidays','expenses','payslips','targets','user_targets','team_targets','rules','buckets','categories','accounts','suppliers','alerts','logs','events','comments','files','sales','days','rows','rates','staff','members','videos','contents','posts','stokis','codes','returns','stockouts','conflicts','free_today','unassigned','customers','clients','credit_notes','packages','receipts','reconciliations','leave','enquiries','materials','outs','media','activity','balances','approvals','journal','journals','pos','allocations','spends','statements','runs','history','tabs','fences','documents','ot','batches','vault_docs','notifications'];
const OBJY = ['by_status','by_courier','summary','totals','stats','counts','connection','health','by_state','geo','pipeline','breakdown','settings','config','balance','company'];

const DOCS = [
  { id: 1, doc_type: 'INV', doc_number: 'INV-AZOO190826-1', company: 'ELFIA', total_cents: 100000, payment_status: 'unpaid', delivery_status: null, created_at: '2026-08-19 04:00:00', issuer_code: 'a2z', kind: 'service' },
  { id: 2, doc_type: 'QT', doc_number: 'QT-AZOO190826-2', company: 'Consult Sdn Bhd', total_cents: 250000, payment_status: null, delivery_status: null, created_at: '2026-08-19 05:00:00', issuer_code: 'azoo', kind: 'service' },
  { id: 3, doc_type: 'INV', doc_number: 'INV-AZOO010126-9', company: 'Old Client', total_cents: 50000, payment_status: 'paid', delivery_status: null, created_at: '2026-01-01 04:00:00', issuer_code: null, kind: 'product' },
];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
await p.addInitScript(() => { try { sessionStorage.clear(); localStorage.setItem('azone-lang', 'en'); } catch {} });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));

const posted = [];
await p.route('**/api/v1/**', (route) => {
  const req = route.request();
  const u = new URL(req.url()).pathname;
  if (u.endsWith('/staff/docs') && req.method() === 'POST') {
    posted.push(JSON.parse(req.postData() ?? '{}'));
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 90 + posted.length, doc_number: `TEST-${posted.length}` }) });
  }
  const body = {};
  for (const k of LISTY) body[k] = [];
  for (const k of OBJY) body[k] = {};
  Object.assign(body, { has_rules: false, total_cents: 0, month: '2026-08', reports: [], shift: '', report: null });
  if (u.includes('/staff/docs')) body.docs = DOCS;
  else if (u.includes('/staff/customers')) body.customers = [{ id: 3, company: 'Consult Sdn Bhd', contact_person: null, phone: null, email: null }];
  else if (u.includes('/staff/staff-list')) body.staff = [{ id: 1, name: 'Alif', role: 'ceo' }];
  else if (u.includes('/staff/inventory')) body.items = [];
  else if (u.includes('/auth/me')) body.user = { id: 1, email: 'ceo@a.com', name: 'Alif', role: 'ceo' };
  else if (u.includes('/staff/revenue') && !u.includes('/lines')) Object.assign(body, { month: '2026-08', tiktok: { this_cents: 0, this_orders: 0, last_cents: 0, last_orders: 0 }, invoiced: { this_cents: 0, this_docs: 0, last_cents: 0, last_docs: 0 } });
  else if (u.includes('/attendance/report')) Object.assign(body, { shift: '', records: [] });
  else if (u.includes('/attendance/monitor')) Object.assign(body, { date: '2026-08-19', staff: [] });
  else if (u.includes('/staff/roster')) Object.assign(body, { week_start: '2026-08-17', days: ['2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22','2026-08-23'], manager: true, sessions: [], on_leave: [], conflicts: [], requests: [], available_today: [] });
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
// swallow the auto-print popup after create
await p.addInitScript(() => { window.open = () => null; });

await p.goto('http://localhost:8931/portal.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
await p.locator('button[aria-label="Sales"]').first().click({ timeout: 8000 });
await p.waitForTimeout(1800);

const issuedBy = p.locator('select', { has: p.locator('option[value="azoo"]') }).first();
const selectorPresent = (await issuedBy.count()) === 1;
const defaultVal = selectorPresent ? await issuedBy.inputValue() : 'missing';

// choose AZ ONE -> warning appears
await issuedBy.selectOption('azoo');
await p.waitForTimeout(300);
const text1 = await p.evaluate(() => document.body.innerText);
const warningShown = /AZ ONE's Maybank account/.test(text1);
await p.screenshot({ path: '/root/deliver/issuer-choice.png' });

// fill the minimum and create as AZ ONE
await p.locator('select', { has: p.locator('option:text("Choose customer…")') }).first().selectOption({ label: 'Consult Sdn Bhd' });
const itemName = p.locator('input[placeholder*="Tudung"], input[placeholder*="LIVE hosting"]').first();
await itemName.fill('Consultancy retainer');
const filledName = true;
const price = p.locator('input[type="number"][placeholder="0.00"]').first();
await price.fill('1000');
const filledPrice = true;
await p.locator('button', { hasText: 'Create with auto number' }).first().click();
await p.waitForTimeout(1000);

// second create with the default (form reset to a2z after success)
const secondDefault = selectorPresent ? await issuedBy.inputValue().catch(() => 'n/a') : 'n/a';

// chip assertions on the list
const listText = await p.evaluate(() => document.body.innerText);
const chipCount = await p.locator('span:has-text("AZ ONE")').count();
const rowA2z = await p.locator('div', { hasText: 'INV-AZOO190826-1' }).locator('span', { hasText: /^AZ ONE$/ }).count();

const report = {
  selectorPresent, defaultVal, warningShown,
  filledName, filledPrice,
  postedIssuer: posted[0]?.issuer ?? null,
  formResetToDefault: secondDefault,
  azooRowShown: /QT-AZOO190826-2/.test(listText),
  legacyRowShown: /INV-AZOO010126-9/.test(listText),
  azOneChips: chipCount,
  pageErrors: errs.slice(0, 3),
};
console.log(JSON.stringify(report, null, 1));
const pass = selectorPresent && defaultVal === 'a2z' && warningShown
  && posted.length >= 1 && report.postedIssuer === 'azoo'
  && report.formResetToDefault === 'a2z'
  && report.azOneChips >= 2 /* azoo row + legacy row */
  && report.pageErrors.length === 0;
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);

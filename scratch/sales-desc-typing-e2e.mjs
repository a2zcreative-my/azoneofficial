/* v1.33.3 — you can type a space in a sales document.

   CEO: "The desc on sales cant be space?! Whyyy" — he typed "Testing Testing"
   into a line's detail box and the saved value read "TestingTesting".

   Cause: the box round-trips its text through a string[] on every keystroke,
   and the change handler normalised on the way IN —
     .map(s => s.trim())   ate the space the instant it was typed
     .filter(Boolean)      deleted a new blank line the instant Enter was hit
     .slice(0, 10)         silently dropped a pasted line 11 and beyond
   None of that is visible when you set a value programmatically, which is why
   it survived this long: only real keystrokes, one character at a time,
   reproduce it. So this test TYPES.

   It checks the two fields on a document line that take prose — the item
   description and the detail box — and then the fields around them, because
   the same round-trip pattern could be added to any of them later. */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8931';
const PHRASE = 'Testing Testing';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));

/* The portal's own stub, lifted verbatim from tests/bm-coverage.mjs. A
   thinner one is not enough: the Sales tab reads several of these keys and
   crashes the whole screen on the first undefined .filter(). */
const LISTY = ['claims','leaves','tasks','announcements','users','entries','lines','cities','sessions','requests','hosts','records','items','banks','movements','invoices','orders','products','assets','prospects','notes','birthdays','punches','holidays','expenses','payslips','targets','user_targets','team_targets','rules','buckets','categories','accounts','suppliers','alerts','logs','events','comments','files','sales','days','rows','rates','staff','members','videos','contents','posts','stokis','codes','returns','stockouts','conflicts','free_today','unassigned','customers','docs','clients','credit_notes','packages','receipts','reconciliations','leave','enquiries','materials','outs','media','activity','balances','approvals','journal','journals','pos','allocations','spends','statements','runs','history','tabs','fences','documents','ot','batches','vault_docs'];
const OBJY = ['by_status','by_courier','summary','totals','stats','counts','connection','health','by_state','geo','pipeline','breakdown','settings','config','balance','company'];
await page.route('**/api/v1/**', (route) => {
  const url = new URL(route.request().url()).pathname;
  let body = {};
  for (const k of LISTY) body[k] = [];
  for (const k of OBJY) body[k] = {};
  body.has_rules = false; body.total_cents = 0; body.month = '2026-08';
  body.reports = []; body.shift = ''; body.report = null;
  if (url.includes('/staff/attendance/monitor')) body = { date: '2026-08-18', staff: [] };
  else if (url.includes('/attendance/report')) body = { shift: '', records: [] };
  else if (url.includes('/staff/roster')) body = { week_start: '2026-08-17', days: ['2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22','2026-08-23'], manager: true, sessions: [], on_leave: [], requests: [], available_today: [], staff: [], hosts: [], conflicts: [], free_today: [], unassigned: [] };
  else if (url.includes('/staff/revenue') && !url.includes('/lines')) body = { month: '2026-08', tiktok: { this_cents: 0, this_orders: 0, last_cents: 0, last_orders: 0 }, invoiced: { this_cents: 0, this_docs: 0, last_cents: 0, last_docs: 0 } };
  else if (url.includes('/auth/me')) body = { user: { id: 1, email: 'ceo@a.com', name: 'Alif', role: 'ceo' } };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.goto(`${BASE}/portal.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const problems = [];
const opened = await page.locator('button[aria-label="Sales"]').first()
  .click({ timeout: 8000 }).then(() => true).catch(() => false);
if (!opened) problems.push('could not open the Sales tab');
await page.waitForTimeout(1500);

/* The detail box is identified by its placeholder, which is the only stable
   handle on it — it has no id and its classes are utility soup. */
const detail = page.locator('textarea[placeholder*="Detail lines"]').first();
const nameBox = page.locator('input[placeholder^="e.g. Tudung Bawal"], input[placeholder^="e.g. TikTok LIVE"]').first();

const found = (await detail.count()) > 0;
if (!found) problems.push('the detail-lines box is not on the Sales tab — form did not render');

const results = {};
if (found) {
  // ---- 1. a space, typed one character at a time ----
  await detail.click();
  await detail.type(PHRASE, { delay: 25 });
  results.typedDetail = await detail.inputValue();
  if (results.typedDetail !== PHRASE) {
    problems.push(`detail box: typed ${JSON.stringify(PHRASE)}, got ${JSON.stringify(results.typedDetail)}`);
  }

  // ---- 2. Enter starts a second line, and it survives ----
  await detail.press('Enter');
  await detail.type('Second line here', { delay: 25 });
  results.twoLines = await detail.inputValue();
  if (results.twoLines !== `${PHRASE}\nSecond line here`) {
    problems.push(`detail box: two lines came back as ${JSON.stringify(results.twoLines)}`);
  }

  // ---- 3. a trailing space mid-edit is not eaten ----
  await detail.press('End');
  await detail.type(' ', { delay: 25 });
  results.trailingSpaceKept = (await detail.inputValue()).endsWith(' ');
  if (!results.trailingSpaceKept) problems.push('detail box: a trailing space is still being eaten');

  // ---- 4. the item description beside it ----
  if ((await nameBox.count()) > 0) {
    await nameBox.click();
    await nameBox.type(PHRASE, { delay: 25 });
    results.typedName = await nameBox.inputValue();
    if (results.typedName !== PHRASE) {
      problems.push(`item description: typed ${JSON.stringify(PHRASE)}, got ${JSON.stringify(results.typedName)}`);
    }
  } else {
    problems.push('the item description input was not found');
  }

  /* ---- 5. every OTHER prose box on this form ----
     The bug was one handler out of many, and the same round-trip pattern
     could be added to any of the others tomorrow. So sweep them: type "a b"
     into each and report the ones that will not keep the space. Scoped to the
     document card — the portal's global search box is not part of this form
     and typing into it opens a palette. */
  const scoped = await page.evaluate(() => {
    const t = document.querySelector('textarea[placeholder*="Detail lines"]');
    let el = t;
    while (el && !el.querySelector('input[placeholder="e.g. PO-2608"]')) el = el.parentElement;
    if (!el) return [];
    el.setAttribute('data-test-scope', 'sales-doc');
    return [...el.querySelectorAll('input, textarea')]
      .filter((n) => !['number', 'date', 'checkbox', 'radio', 'hidden'].includes(n.type))
      .map((n) => n.placeholder || n.getAttribute('aria-label') || '?');
  });
  const refusing = [];
  for (const ph of scoped) {
    const box = page.locator(`[data-test-scope="sales-doc"] :is(input,textarea)[placeholder="${ph.replace(/"/g, '\\"')}"]`).first();
    if ((await box.count()) === 0) continue;
    if (!(await box.isVisible().catch(() => false))) continue;
    if (!(await box.isEditable().catch(() => false))) continue;
    await box.fill('');
    await box.type('a b', { delay: 20 });
    const got = await box.inputValue();
    // UOM deliberately uppercases; only the SPACE is under test here
    if (!got.toLowerCase().includes('a b')) refusing.push(`${ph.slice(0, 40)} → ${JSON.stringify(got)}`);
    await box.fill('');
  }
  results.proseFieldsChecked = scoped.length;
  results.fieldsThatRefuseASpace = refusing;
  if (!scoped.length) problems.push('could not scope the sweep to the document card — sweep proved nothing');
  if (refusing.length) problems.push(`fields that will not take a space: ${refusing.join(' | ')}`);
}

/* ---- 6. the tidying MOVED, it did not disappear ----
   Typing is raw now, so blank lines and stray spaces exist in state while he
   edits. They must not reach the document: an empty detail line prints as an
   empty bullet on the PDF. Fill a valid document, submit it, and read what
   actually went over the wire. */
if (found) {
  await detail.fill('  Line one  \n\n   \n  Line two  ');
  await nameBox.fill('Spaced  Service Name');
  const price = page.locator('[data-test-scope="sales-doc"] input[type="number"]').nth(1);
  await price.fill('150');
  const customer = page.locator('select').filter({ hasText: 'Walk-in' }).first();
  await customer.selectOption({ label: '🚶 Walk-in / general buy' }).catch(async () => {
    await customer.selectOption({ index: 1 });
  });
  await page.waitForTimeout(300);

  let posted = null;
  await page.route('**/api/v1/staff/docs', (route) => {
    if (route.request().method() === 'POST') {
      try { posted = JSON.parse(route.request().postData() ?? '{}'); } catch { posted = 'UNPARSEABLE'; }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: 1, doc_number: 'INV-TEST', stock: null }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"docs":[]}' });
  });

  await page.locator('button', { hasText: /^Create with auto number$/ }).first().click();
  await page.waitForTimeout(1200);

  if (!posted || posted === 'UNPARSEABLE') {
    problems.push('the document was never submitted — cannot check what gets saved');
  } else {
    const item = (posted.items ?? [])[0] ?? {};
    results.savedSub = item.sub;
    results.savedName = item.name;
    const expected = ['Line one', 'Line two'];
    if (JSON.stringify(item.sub) !== JSON.stringify(expected)) {
      problems.push(`saved detail lines are ${JSON.stringify(item.sub)}, expected ${JSON.stringify(expected)} — blanks/padding must be tidied AT SAVE`);
    }
    if (item.name !== 'Spaced  Service Name') {
      problems.push(`saved item name is ${JSON.stringify(item.name)} — only the ends should be trimmed`);
    }
  }
}

if (errs.length) problems.push(`page errors: ${errs.slice(0, 2).join(' | ')}`);

console.log(JSON.stringify({ results, problems }, null, 1));
const pass = problems.length === 0;
console.log(pass ? 'PASS' : 'FAIL');
await browser.close();
process.exit(pass ? 0 : 1);

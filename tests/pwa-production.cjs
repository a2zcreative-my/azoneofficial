// Browser regression: intercepted business APIs, no production data or writes.
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3212';
const output = join(tmpdir(), 'a2z-pwa-production-audit');
const registry = readFileSync('lib/portal-tabs.ts', 'utf8').match(/const ALL_TABS = \[([\s\S]*?)\] as const/)[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const tabs = [...registry.matchAll(/"([^"]+)"/g)].map(m => m[1]);
const listKeys = 'records tasks leave leaves announcements events sessions items rows findings open watchers notifications users versions materials returns outs birthdays holidays lines buckets staff customers docs clients hosts cities orders rules user_targets team_targets months corrections patterns assignments pending unpaid decisions entries hours assets hotels states reports claims expenses suppliers pos accounts rates allocations days base journals journal banks reconciliations products enquiries prospects requests comments files sales movements alerts logs invoices targets user_targets team_targets members posts contents stokis credit_notes receipts staff_claims'.split(' ');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const event = { id: 700, title: 'Production calendar review', event_date: date, start_time: '23:00', end_time: '01:00', category: 'meeting', details: 'Overnight review', location: 'HQ' };
const claim = { id: 800, user_id: 9001, claimant: 'Review Employee', claimant_full: 'Review Employee', claimant_department: 'Operations', claimant_position: 'Staff', claim_date: date, created_at: `${date} 02:00:00`, category: 'meal', description: 'Review expense', amount_cents: 15345, status: 'pending', receipt_key: 'fixture.png', issuer_code: 'a2z' };
const invoice = { id: 900, doc_type: 'INV', doc_number: 'INV-REVIEW-900', company: 'Review Customer', items: '[{"name":"Review product","qty":1,"unit_price_cents":1000}]', discount_cents: 0, tax_percent: 0, total_cents: 1000, created_at: `${date} 02:00:00`, issuer_code: 'a2z', payment_status: 'unpaid' };

async function fixture(context, control) {
  await context.addInitScript(() => {
    localStorage.setItem('azone-install-dismissed', '1');
    localStorage.setItem('azone-lang', 'en');
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await context.route('**/api/v1/**', async route => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace('/api/v1', '');
    if (req.resourceType() === 'eventsource') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (/\/claims\/800\/(receipt|signature)/.test(p)) {
      if (control.receiptError) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: control.pdf ? 'application/pdf' : 'image/png', body: control.pdf || image });
    }
    if (/signature|\/media\/file/.test(p)) return route.fulfill({ status: 404, body: '' });
    if (p === '/staff/events' && req.method() === 'POST') {
      control.eventWrites++;
      await new Promise(resolve => setTimeout(resolve, 400));
      return route.fulfill({ status: control.failSave ? 503 : 200, contentType: 'application/json', body: control.failSave ? '{"error":{"message":"Test save unavailable"}}' : '{"id":701}' });
    }
    const data = Object.fromEntries(listKeys.map(key => [key, []]));
    Object.assign(data, { summary: {}, totals: {}, counts: {}, stats: {}, config: {}, by_status: {}, by_state: {}, balance: {}, balances: {}, people: {}, versions: {}, can_decide: true, packages: null, month: date.slice(0,7), total_cents: 0, can_manage: true, me: 9001, today: date, ranges: [], range: { from: date, to: date, label: 'today' } });
    if (p === '/auth/me') data.user = { id: 9001, role: control.role || 'ceo', name: 'Review Employee', email: 'review@example.test', status: 'active' };
    if (p === '/auth/me' && control.anonymous) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    if (p === '/staff/tabs/access') Object.assign(data, { overrides: {}, mine: { allow: tabs, deny: [] } });
    if (p === '/staff/desk') Object.assign(data, { total: 0, missing: [] });
    if (p === '/staff/attendance') Object.assign(data, { as_of: date, today_shift: { kind: 'rest', label: 'Rest day', windows: [], slots: [], entry: { launch_shift: false, clocked_in: false } }, ot: [] });
    if (p === '/staff/attendance/geofence') data.configured = false;
    if (p === '/staff/attendance/monitor') data.date = date;
    if (p === '/staff/revenue') Object.assign(data, { tiktok: { this_cents:0, this_orders:0, last_cents:0, last_orders:0 }, invoiced: { this_cents:0, this_docs:0, last_cents:0, last_docs:0 } });
    if (p === '/staff/roster') Object.assign(data, { week_start: date, manager: true, on_leave: [], conflicts: [], available_today: [], task_blocks: [], unscheduled: [] });
    if (p === '/staff/events') data.events = [event];
    if (p === '/staff/claims') data.claims = [claim];
    if (p === '/staff/claims/mileage-rate') Object.assign(data, { cents_per_km: 70, can_set: true });
    if (p === '/staff/expenses') data.staff_claims = { in_month: [], paid: [], due: [] };
    if (p === '/staff/payroll') data.release = { available_from: `${date} 10:00:00`, released: null, employer: 'A2Z Creative Marketing' };
    if (p === '/staff/sales-performance/overview') Object.assign(data, { days: 1, tiktok_orders: [] });
    if (p === '/staff/docs') data.docs = [invoice];
    if (p === '/staff/docs/900' || p.startsWith('/public/doc/')) data.doc = invoice;
    if (p === '/staff/companies') Object.assign(data, { companies: [], review: [], totals: {} });
    if (p === '/staff/threads') Object.assign(data, { connected: false, posts: [], profile: null });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

async function main() {
  mkdirSync(output, { recursive: true });
  const engine = process.env.PW_ENGINE || 'chromium';
  const browser = await pw[engine].launch(engine === 'chromium' ? { channel: 'msedge', headless: true } : { headless: true });
  const results = [], failures = [];
  try {
    for (const width of (process.env.REVIEW_WIDTHS || '390,1440').split(',').map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 768, serviceWorkers: 'block', acceptDownloads: true, ignoreHTTPSErrors: new URL(base).hostname === '127.0.0.1' });
      const control = { eventWrites: 0, failSave: false, receiptError: false };
      await fixture(context, control);
      let page = await context.newPage();
      const appPages = () => context.pages().filter(p => !p.url().startsWith('edge://'));
      page.setDefaultTimeout(15000);
      let errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const freshPage = async () => {
        // Isolate route renders from pending requests on the previous document.
        page.removeAllListeners('pageerror');
        await page.close();
        page = await context.newPage();
        page.setDefaultTimeout(15000);
        errors = [];
        page.on('pageerror', e => errors.push(e.message));
      };
      const go = async tab => {
        await freshPage();
        await page.goto(`${base}/portal?tab=${encodeURIComponent(tab)}`, { waitUntil: 'networkidle', timeout: 120000 });
        await page.addStyleTag({ content: 'nextjs-portal { display:none !important }' });
      };
      if (process.env.FOCUSED_ONLY !== '1') for (const tab of tabs) {
        try {
          await go(tab);
          await page.locator('header h1:visible').waitFor();
          await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'), { timeout: 10000 }).catch(() => {});
          const heading = (await page.locator('header h1:visible').innerText()).trim();
          const expected = { Dashboard: width < 768 ? 'Today' : 'Dashboard', Stokis: width < 768 ? 'Today' : 'Dashboard', Content: width < 768 ? 'Today' : 'Dashboard', Announcements: 'News', 'Staff Details': 'Staff' }[tab] || tab;
          assert.equal(heading, expected, `${tab} redirected to ${heading}`);
          assert(!await page.getByText('Something went wrong on this screen', { exact: true }).isVisible(), 'Error boundary displayed');
          assert.deepEqual(errors, [], 'Uncaught runtime error');
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal page overflow');
          results.push(`PASS ${tab} ${width}px`);
        } catch(e) { failures.push(`${tab} ${width}px: ${e.message}`); await page.screenshot({ path: join(output, `failure-${tab.replaceAll(' ', '-')}-${width}.png`) }); }
        console.log(results.at(-1)?.includes(`${tab} ${width}px`) ? results.at(-1) : failures.at(-1));
      }
      try {
        await go('Dashboard');
        const events = page.locator('#upcoming-events');
        await events.getByRole('button', { name: 'list', exact: true }).click();
        await events.getByRole('button', { name: 'Add to my calendar', exact: true }).click();
        let dialog = page.getByRole('dialog');
        await dialog.waitFor();
        assert.equal(appPages().length, 1, 'Calendar opened a blank popup');
        const google = new URL(await dialog.getByRole('link', { name: 'Google Calendar', exact: true }).getAttribute('href'));
        assert.equal(google.searchParams.get('text'), event.title);
        assert.equal(google.searchParams.get('dates').split('/').length, 2);
        const downloadPromise = page.waitForEvent('download');
        await dialog.getByRole('link', { name: /Download calendar file/ }).click();
        const download = await downloadPromise;
        const text = readFileSync(await download.path(), 'utf8');
        assert(text.includes('SUMMARY:Production calendar review'));
        assert(text.includes('DTSTART:') && text.includes('DTEND:'));
        assert(!await page.getByText('Calendar opened', { exact: true }).isVisible());
        await page.screenshot({ path: join(output, `calendar-${engine}-${width}.png`) });
        await dialog.getByRole('button', { name: 'Back', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert(await events.getByRole('button', { name: 'Add to my calendar', exact: true }).isVisible());
        await events.getByRole('button', { name: '+ Add event', exact: true }).click();
        const titleInput = events.getByPlaceholder('e.g. TikTok Live hosting training');
        await titleInput.fill('Draft must survive failed save');
        await events.locator('input[type="date"]').fill(date);
        control.failSave = true;
        const save = events.getByRole('button', { name: 'Save event', exact: false });
        await save.evaluate(el => { el.click(); el.click(); });
        await events.getByText('Test save unavailable', { exact: true }).waitFor();
        assert.equal(control.eventWrites, 1, 'Repeated tap created duplicate requests');
        assert.equal(await titleInput.inputValue(), 'Draft must survive failed save');
        control.failSave = false;
        await go('Claims');
        dialog = page.getByRole('dialog');
        await page.getByTitle('Purpose, items, receipt and decision', { exact: true }).first().click();
        const print = page.getByRole('button', { name: 'Print form', exact: true }).first();
        await print.focus();
        await print.press('Enter');
        await dialog.waitFor();
        await page.frameLocator('dialog iframe').getByText('Employee Claim Form', { exact: true }).waitFor();
        assert.equal(appPages().length, 1, `Print form escaped to a popup: ${appPages().map(p => p.url()).join(', ')}`);
        const backBox = await dialog.getByRole('button', { name: 'Back', exact: true }).boundingBox();
        assert(backBox.y >= 0 && backBox.height >= 44, 'Back is clipped or too small');
        await page.screenshot({ path: join(output, `claim-${engine}-${width}.png`) });
        const claimDownload = page.waitForEvent('download');
        await dialog.getByRole('link', { name: 'Download', exact: true }).click();
        const claimPdf = await claimDownload;
        const pdfBytes = readFileSync(await claimPdf.path());
        assert(pdfBytes.subarray(0, 5).toString() === '%PDF-');
        await page.goBack();
        await dialog.waitFor({ state: 'hidden' });
        assert(await print.isVisible(), 'Back lost the expanded claim');
        assert(await print.evaluate(el => el === document.activeElement), 'Back did not restore focus');
        await page.getByRole('button', { name: 'View receipt', exact: true }).first().click();
        await dialog.getByRole('img', { name: 'Attachment', exact: true }).waitFor();
        await page.screenshot({ path: join(output, `receipt-${engine}-${width}.png`) });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        control.receiptError = true;
        await page.getByRole('button', { name: 'View receipt', exact: true }).first().click();
        await dialog.getByRole('alert').waitFor();
        control.receiptError = false;
        await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
        await dialog.getByRole('img', { name: 'Attachment', exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Back', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        control.pdf = pdfBytes;
        await page.getByRole('button', { name: 'View receipt', exact: true }).first().click();
        await page.waitForFunction(() => {
          const canvas = document.querySelector('dialog canvas');
          if (!canvas || canvas.width <= 300) return false;
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] < 230) ink++;
          return ink > 100;
        });
        await page.screenshot({ path: join(output, `pdf-receipt-${engine}-${width}.png`) });
        await dialog.getByRole('button', { name: 'Back', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        control.pdf = null;
        assert.equal(appPages().length, 1);
        assert.deepEqual(errors, []);
        results.push(`PASS calendar export, claim print, receipt, back, Escape, retry ${engine} ${width}px`);
        console.log(results.at(-1));
      } catch(e) { failures.push(`Flows ${engine} ${width}px: ${e.stack}`); await page.screenshot({ path: join(output, `flow-failure-${engine}-${width}.png`) }); console.log(failures.at(-1)); }
      if (process.env.FOCUSED_ONLY !== '1') {
        const pages = readdirSync('app', { recursive: true }).filter(p => /(^|[\\/])page\.tsx$/.test(p) && !p.includes('[')).map(p => '/' + p.replace(/\\/g, '/').replace(/(^|\/)page\.tsx$/, ''));
        for (const route of pages.filter(p => p !== '/portal')) {
          try {
            await freshPage();
            control.anonymous = !route.startsWith('/admin') && route !== '/account';
            control.role = route.startsWith('/admin') ? 'super_admin' : 'customer';
            await page.goto(base + route + (route === '/doc' ? '?t=' + 'a'.repeat(32) : ''), { waitUntil: 'networkidle', timeout: 120000 });
            await page.addStyleTag({ content: 'nextjs-portal { display:none !important }' });
            assert((await page.locator('body').innerText()).trim().length > 20, 'Page is blank');
            assert.deepEqual(errors, [], 'Page runtime error');
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflows');
            results.push(`PASS route ${route} ${width}px`); console.log(results.at(-1));
          } catch(e) { failures.push(`Route ${route} ${width}px: ${e.message}`); console.log(failures.at(-1)); }
        }
      }
      await context.close();
    }
  } finally { await browser.close(); }
  writeFileSync(join(output, `results-${engine}${process.env.FOCUSED_ONLY === '1' ? '-focused' : ''}.json`), JSON.stringify({ results, failures }, null, 2));
  console.log(`Screenshots and report: ${output}`);
  assert.equal(failures.length, 0, failures.join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; });

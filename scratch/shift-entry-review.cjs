// Browser-only fixture. All business API requests are intercepted locally.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3210';
const output = join(tmpdir(), 'erp-shift-entry-review');

(async () => {
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [360, 390, 768, 1440]) {
      for (const scenario of ['scheduled', 'clocked', 'failed', 'pending', 'offline', 'rest', 'deep_link', 'remembered']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block',
          geolocation: { latitude: 3.14, longitude: 101.69 }, permissions: ['geolocation'] });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        let clocked = scenario === 'clocked' || scenario === 'deep_link';
        const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await page.addInitScript(scenario => {
          localStorage.setItem('azone-install-dismissed', '1');
          if (scenario === 'remembered') sessionStorage.setItem('azone-tab:9002', 'Leave');
        }, scenario);
        await page.route('**/api/v1/**', route => {
          const request = route.request();
          const p = new URL(request.url()).pathname.replace('/api/v1', '');
          if (request.resourceType() === 'eventsource') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' });
          let data = { records: [], tasks: [], leave: [], announcements: [], events: [], sessions: [], items: [], rows: [], findings: [], open: [], watchers: [], notifications: [], users: [], versions: {}, birthdays: [], holidays: [], staff: [], balances: {}, pending: [], patterns: [], assignments: [], ot: [] };
          if (p === '/auth/me') data = { user: { id: 9002, name: 'Review Employee', role: 'editor', email: 'review@example.test' } };
          if (p === '/staff/tabs/access') data = { overrides: {}, mine: { allow: [], deny: [] } };
          if (p === '/staff/desk') data = { items: [], counts: {}, total: 0, missing: [] };
          if (p === '/staff/attendance/geofence') data = { configured: false };
          if (p === '/staff/attendance' && request.method() === 'POST') {
            if (scenario === 'offline') return route.abort();
            if (scenario === 'pending') data = { ok: true, pending: true };
            else { clocked = true; data = { ok: true, flag: 'ok', clocked_in: true }; }
          } else if (p === '/staff/attendance') {
            if (scenario === 'failed') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"Test unavailable"}}' });
            data = { as_of: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), records: clocked ? [{ type: 'clock_in', created_at: stamp }] : [], ot: [], ot_eligible: false,
              today_shift: { kind: 'workday', label: '09:00 - 18:00', windows: [{ start: '09:00', end: '18:00' }],
                slots: [{ start: '09:00', end: '18:00', claimed: clocked, what: null }], slots_label: '09:00 - 18:00', can_clock_in: !clocked,
                entry: { launch_shift: !clocked && scenario !== 'rest', clocked_in: clocked, open_since: clocked ? stamp : null,
                  clock_out_at: clocked ? new Date(Date.now() + 25 * 60000).toISOString() : null, leave_review: false } } };
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(base + '/portal' + (scenario === 'deep_link' ? '?tab=On%20Shift' : ''), { waitUntil: 'networkidle', timeout: 120000 });
        await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
        const title = page.locator('header h1:visible');
        if (scenario === 'scheduled' || scenario === 'pending' || scenario === 'offline') {
          await page.getByRole('button', { name: 'Clock in', exact: true }).waitFor();
          assert.equal((await title.innerText()).trim(), 'On Shift');
          assert.equal(await page.getByText('Waiting on me', { exact: true }).count(), 0);
          await page.screenshot({ path: join(output, `on-shift-${scenario}-${width}.png`), fullPage: true });
          await page.getByRole('button', { name: 'Clock in', exact: true }).click();
          if (scenario === 'scheduled') {
            await title.filter({ hasText: width < 768 ? /^Today$/ : /^Dashboard$/ }).waitFor();
            await page.reload({ waitUntil: 'networkidle' });
            assert.equal((await title.innerText()).trim(), width < 768 ? 'Today' : 'Dashboard');
          }
          else {
            await page.getByText(scenario === 'offline' ? 'Kept — no signal' : 'Sent to the CEO', { exact: true }).waitFor();
            assert.equal((await title.innerText()).trim(), 'On Shift');
          }
        } else if (scenario === 'deep_link' || scenario === 'remembered') {
          assert.equal((await title.innerText()).trim(), scenario === 'deep_link' ? 'On Shift' : 'Leave');
        } else {
          assert.equal((await title.innerText()).trim(), width < 768 ? 'Today' : 'Dashboard');
          if (scenario === 'failed') {
            await page.getByText(/Attendance could not be refreshed/).waitFor();
            assert.equal(await page.getByRole('button', { name: 'Clock in', exact: true }).count(), 0);
          } else if (scenario === 'clocked') await page.getByText(/Don't forget to clock out/).waitFor();
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert(!overflow, `${scenario} overflows at ${width}`);
        assert.deepEqual(errors, [], `Runtime errors: ${scenario}/${width}`);
        await context.close();
        console.log(`PASS ${scenario} ${width}px`);
      }
    }
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

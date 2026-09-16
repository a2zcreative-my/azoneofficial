// Local visual regression fixture. All API requests are intercepted; no live writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3210';
const output = process.env.REVIEW_OUTPUT || path.join(require('node:os').tmpdir(), 'erp-interface-review');
const items = [
  { id: 1, sku: 'ELFIA001', name: 'ELFIA Premium product with a long bilingual description', stock: 4, status: 'low', unit_cost_cents: 2400, unit_price_cents: 4500, category: 'elfia' },
  { id: 2, sku: 'ELFIA002', name: 'ELFIA Daily care', stock: 30, status: 'in_stock', unit_cost_cents: 1200, unit_price_cents: 2400, category: 'elfia' },
];
const queue = [{ id: 'task:1', bucket: 'tasks', title: 'Check inventory delivery and verify the supporting documents', sub: 'Nur Aisyah - Operations team', since: '2026-09-14 08:00:00', tab: 'Tasks', overdue: true }];
async function main() {
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const results = [];
  try {
    for (const width of (process.env.REVIEW_WIDTHS || '390,768,1440').split(',').map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', hasTouch: width < 1280 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') console.log(m.text()); });
      await page.addInitScript(({ lang, dark }) => {
        localStorage.setItem('azone-install-dismissed', '1');
        localStorage.setItem('azone-lang', lang);
        localStorage.setItem('azone-theme', dark ? 'dark' : 'light');
      }, { lang: process.env.REVIEW_LANG || 'en', dark: process.env.REVIEW_DARK === '1' });
      await page.route('**/api/v1/**', route => {
        const p = new URL(route.request().url()).pathname.replace('/api/v1', '');
        if (route.request().resourceType() === 'eventsource') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' });
        let data = { records: [], tasks: [], leave: [], announcements: [], events: [], sessions: [], items: [], rows: [], findings: [], open: [], watchers: [], notifications: [], users: [], versions: {}, materials: [], returns: [], outs: [], birthdays: [], holidays: [], lines: [], buckets: [] };
        if (p === '/staff/revenue') data = { month: '2026-09', last_month: '2026-08', tiktok: { this_cents: 125000, this_orders: 20, last_cents: 110000, last_orders: 18 }, invoiced: { this_cents: 200000, this_docs: 4, last_cents: 140000, last_docs: 3 } };
        if (p === '/auth/me') data = { user: { id: 9001, name: 'Nur Aisyah Operations', role: 'hr_admin', email: 'fixture@example.test', status: 'active' } };
        if (p === '/staff/tabs/access') data = { overrides: {}, mine: { allow: ['Inventory', 'Sales'], deny: [] } };
        if (p === '/staff/desk') data = { items: queue, counts: { tasks: 1 }, total: 1, missing: [] };
        if (p === '/staff/overview') data = { inventory_status: [{ status: 'in_stock', n: 1 }, { status: 'low', n: 1 }], task_summary: [] };
        if (p === '/staff/inventory') data = { items };
        if (p === '/staff/inventory/bridge-health') data = { key_configured: true, applied_24h: 0, unknown_24h: 0, unknown: [] };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto(base + '/portal', { waitUntil: 'networkidle', timeout: 120000 });
      await page.getByText('Check inventory delivery and verify the supporting documents', { exact: true }).waitFor().catch(async e => {
        await page.screenshot({ path: path.join(output, `failure-${width}.png`) });
        console.log(JSON.stringify({ errors, text: (await page.locator('body').innerText()).slice(0, 4000) })); throw e;
      });
      const measure = () => page.evaluate(() => {
        const shell = document.querySelector('#shell-scroll');
        const header = document.querySelector('header');
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, mainWidth: shell.getBoundingClientRect().width,
          headerWidth: header.getBoundingClientRect().width, headerScrollWidth: header.scrollWidth,
          primaryTargets: [...header.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => ({ label: b.getAttribute('aria-label'), height: b.getBoundingClientRect().height })) };
      });
      const dashboard = await measure();
      if (width >= 768 && width < 1280) {
        await page.getByRole('button', { name: /Expand navigation|Buka navigasi/ }).click();
        const expanded = await measure();
        assert(expanded.headerScrollWidth <= expanded.headerWidth + 1, 'Expanded tablet toolbar overflows');
        assert(await page.locator('header h1:visible').evaluate(e => e.scrollWidth <= e.clientWidth), 'Tablet title is clipped');
        await page.screenshot({ path: path.join(output, `expanded-tablet-${width}.png`) });
        await page.getByRole('button', { name: /Collapse navigation|Kecilkan navigasi/ }).click();
      }
      assert.equal(await page.locator('.rounded-card').first().evaluate(e => getComputedStyle(e).borderRadius), '8px');
      assert(await page.locator('.rounded-panel').evaluateAll(nodes => nodes.every(e => getComputedStyle(e).borderRadius === '8px')), 'Panel radius differs from cards');
      assert(dashboard.documentWidth <= width, 'Document overflows');
      assert(dashboard.mainWidth >= (width < 768 ? width - 20 : 480), 'Main content too narrow');
      if (width < 768) assert(dashboard.primaryTargets.every(b => b.height >= 44), 'Header touch targets too small');
      await page.screenshot({ path: path.join(output, `dashboard-${width}.png`) });
      if (width < 768) {
        await page.getByRole('button', { name: /^(More|Lagi)$/ }).click();
        await page.getByRole('dialog', { name: /^(More|Lagi)$/ }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('navigation', { name: /Portal sections|Bahagian portal/ }).getByRole('button', { name: /^(Inventory|Inventori)$/ }).click();
      } else await page.getByRole('complementary', { name: /Main navigation|Navigasi utama/ }).getByRole('button', { name: /^(Inventory|Inventori)$/ }).click();
      const low = page.getByRole('button', { name: /^1\s+(low|rendah)$/i });
      await low.waitFor({ timeout: 60000 });
      await low.click();
      await page.getByText(/^(low items|barang rendah)$/).waitFor();
      assert.equal(await low.getAttribute('aria-expanded'), 'true');
      if (width < 768) assert((await low.boundingBox()).height >= 44, 'Stock touch target too small');
      await page.screenshot({ path: path.join(output, `inventory-${width}.png`) });
      const inventory = await measure();
      assert(inventory.documentWidth <= width, 'Inventory document overflows');
      const search = page.getByRole('textbox', { name: /Find an item|Cari barang/ });
      assert((await search.boundingBox()).width >= 200, 'Search input is squeezed');
      await page.getByRole('button', { name: items[0].name }).filter({ visible: true }).click();
      const detail = page.getByRole('dialog', { name: items[0].name });
      await detail.waitFor();
      await page.screenshot({ path: path.join(output, `detail-${width}.png`) });
      assert((await detail.boundingBox()).width <= width, 'Detail overflows');
      await page.goBack();
      await detail.waitFor({ state: 'hidden' });
      assert.equal(await low.getAttribute('aria-expanded'), 'true', 'Back lost expanded status');
      const itemButton = page.getByRole('button', { name: items[0].name }).filter({ visible: true });
      await itemButton.click();
      await detail.waitFor();
      await page.keyboard.press('Escape');
      await detail.waitFor({ state: 'hidden' });
      assert(await itemButton.evaluate(e => e === document.activeElement), 'Detail did not restore focus');
      results.push({ width, dashboard, inventory, errors });
      assert.equal(errors.length, 0, errors.join('\n'));
      await context.close();
    }
  } finally {
    writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify({ output, results }, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });

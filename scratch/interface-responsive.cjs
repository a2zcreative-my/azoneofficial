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
      page.on('console', m => { if (m.type() === 'error') { console.log(m.text()); if (/TypeError|ReferenceError|error occurred in the|hydration error/i.test(m.text())) errors.push(m.text()); } });
      await page.addInitScript(({ lang, dark }) => {
        localStorage.setItem('azone-install-dismissed', '1');
        localStorage.setItem('azone-lang', lang);
        localStorage.setItem('azone-theme', dark ? 'dark' : 'light');
      }, { lang: process.env.REVIEW_LANG || 'en', dark: process.env.REVIEW_DARK === '1' });
      await page.route('**/api/v1/**', route => {
        const p = new URL(route.request().url()).pathname.replace('/api/v1', '');
        if (route.request().resourceType() === 'eventsource') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' });
        let data = { records: [], tasks: [], leave: [], announcements: [], events: [], sessions: [], items: [], rows: [], findings: [], open: [], watchers: [], notifications: [], users: [], versions: {}, materials: [], returns: [], outs: [], birthdays: [], holidays: [], lines: [], buckets: [], staff: [], customers: [], docs: [], clients: [], hosts: [], packages: null, cities: [], orders: [], rules: [], user_targets: [], team_targets: [], people: {}, months: [], corrections: [], patterns: [], assignments: [], pending: [], unpaid: [], decisions: [], entries: [], hours: [] };
        if (process.env.REVIEW_ROLLOUT === '1') Object.assign(data, { assets: [], hotels: [], states: [], by_state: {}, reports: [], claims: [], can_decide: true, expenses: [], suppliers: [], pos: [], accounts: [], rates: [], allocations: [], balances: {}, days: [], base: [] });
        if (p === '/staff/revenue') data = { month: '2026-09', last_month: '2026-08', tiktok: { this_cents: 125000, this_orders: 20, last_cents: 110000, last_orders: 18 }, invoiced: { this_cents: 200000, this_docs: 4, last_cents: 140000, last_docs: 3 } };
        if (p === '/auth/me') data = { user: { id: 9001, name: 'Nur Aisyah Operations', role: process.env.REVIEW_ROLE || 'hr_admin', email: 'fixture@example.test', status: 'active' } };
        if (p === '/staff/tabs/access') data = { overrides: {}, mine: { allow: ['Inventory', 'Sales', 'Ecommerce', 'Attendance', 'Users'], deny: [] } };
        if (process.env.REVIEW_ROLLOUT === '1' && p === '/staff/tabs/access') data.mine.allow.push('Assets', 'Hotels', 'HR', 'Tasks', 'Announcements', 'Leave', 'Claims', 'Payroll', 'Finance', 'Reconciliation', 'Commission', 'Ads Fund', 'Purchasing', 'Accounting', 'Sales Performance');
        if (process.env.REVIEW_ROLLOUT === '1' && p === '/staff/sales-performance/overview') Object.assign(data, { me: 9001, can_manage: true, today: '2026-09-16', days: 1, tiktok_orders: [], range: { from: '2026-09-16', to: '2026-09-16', label: 'today' } });
        if (process.env.REVIEW_ROLLOUT === '1' && p === '/staff/tasks') data = { tasks: [
          { id: 41, title: 'ROLLOUT active task', description: 'Check supporting documents', priority: 'normal', status: 'open', assigned_to: 9001, created_by: 9001 },
          { id: 42, title: 'ROLLOUT completed task', description: 'Previously checked', priority: 'normal', status: 'completed', assigned_to: 9001, created_by: 9001 },
        ] };
        if (process.env.REVIEW_ROLLOUT === '1' && p === '/staff/announcements') data = { announcements: [
          { id: 41, title: 'ROLLOUT current announcement', body: 'Team review is ready.', category: 'news', created_at: '2026-09-16 08:00:00', acked: false },
          { id: 42, title: 'ROLLOUT acknowledged announcement', body: 'Previous team update.', category: 'news', created_at: '2026-09-15 08:00:00', acked: true },
        ] };
        if (process.env.REVIEW_ROLLOUT === '1' && p === '/staff/payroll') data = { entries: [], release: { available_from: '2026-10-05 10:00:00', released: null, employer: 'A2Z Creative Marketing' } };
        if (process.env.REVIEW_ROLLOUT === '1' && p === '/staff/assets') data = { assets: [{ id: 41, asset_tag: 'TEST-041', name: 'ROLLOUT studio light', category: 'studio', status: 'in_use', purchase_price_cents: 25000 }], can_remove: false };
        if (p === '/staff/desk') data = { items: queue, counts: { tasks: 1 }, total: 1, missing: [] };
        if (p === '/staff/overview') data = { inventory_status: [{ status: 'in_stock', n: 1 }, { status: 'low', n: 1 }], task_summary: [] };
        if (p === '/staff/inventory') data = { items };
        if (p === '/staff/inventory/bridge-health') data = { key_configured: true, applied_24h: 0, unknown_24h: 0, unknown: [] };
        if (p === '/staff/fulfilment/summary') data = { month: '2026-09', by_status: { preparing: 2, shipped: 3 }, oldest_preparing: null, orders: [] };
        if (p === '/staff/roster') data = { week_start: '2026-09-14', days: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'], manager: true, sessions: [], on_leave: [], conflicts: [], requests: [], available_today: [], task_blocks: [], unscheduled: [] };
        if (p === '/staff/attendance/monitor') data = { date: '2026-09-16', staff: [] };
        if (p === '/staff/reports/outstanding') data = { invoices: [], total_cents: 0 };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto(base + '/portal', { waitUntil: 'networkidle', timeout: 120000 });
      // Dev-only launcher overlaps the phone's first navigation item.
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
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
      assert((await page.getByText('Check inventory delivery and verify the supporting documents', { exact: true }).boundingBox()).y < (await page.getByText(/^(My summary|Ringkasan saya)$/).boundingBox()).y, 'Queue must precede personal metrics');
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
      if (process.env.REVIEW_PILOT === '1') {
        const navigate = async (en, ms) => {
          const name = en === 'Announcements' ? /^(News|Berita)$/ : new RegExp(`^(${en}|${ms})(?:\\s+\\d+)?$`);
          if (width < 768) {
            const bottom = page.getByRole('navigation', { name: /Portal sections|Bahagian portal/ });
            if (await bottom.getByRole('button', { name }).count()) await bottom.getByRole('button', { name }).click();
            else {
              await bottom.getByRole('button', { name: /^(More|Lagi)$/ }).click();
              await page.getByRole('dialog', { name: /^(More|Lagi)$/ }).getByRole('button', { name }).click();
            }
          } else await page.getByRole('complementary', { name: /Main navigation|Navigasi utama/ }).getByRole('button', { name }).click();
          await page.waitForLoadState('networkidle');
        };
        const before = async (first, second) => {
          await first.waitFor(); await second.waitFor();
          assert((await first.boundingBox()).y < (await second.boundingBox()).y, 'Card order is incorrect');
        };
        await before(page.getByRole('tab', { name: /Manual stock movements|Pergerakan stok manual/ }), page.locator('#inventory-bridge'));
        for (const [en, ms] of [['Sales', 'Jualan'], ['Ecommerce', 'E-dagang'], ['Attendance', 'Kehadiran'], ['Users', 'Pengguna']]) {
          await navigate(en, ms);
          if (en === 'Sales') {
            await before(page.locator('#sales-work'), page.locator('#sales-customers'));
            assert.equal(await page.getByRole('tab', { name: /^(Documents|Dokumen)$/ }).getAttribute('aria-selected'), 'true');
            await page.getByRole('tab', { name: /^(Create document|Buat dokumen)$/ }).click();
            const reference = page.getByPlaceholder(/their PO no.|no. PO mereka/);
            await reference.fill('PILOT-DRAFT');
            await page.getByRole('tab', { name: /^(Documents|Dokumen)$/ }).click();
            await page.getByRole('tab', { name: /^(Create document|Buat dokumen)$/ }).click();
            assert.equal(await reference.inputValue(), 'PILOT-DRAFT', 'Changing Sales views lost the draft');
            await page.getByRole('tab', { name: /^(Documents|Dokumen)$/ }).click();
          }
          if (en === 'Ecommerce') await before(page.getByText(/^(TikTok Orders|Pesanan TikTok)$/), page.getByText(/^(The longer view|Pandangan lebih jauh)$/));
          if (en === 'Attendance') await before(page.locator('main').getByText(/^(My attendance|Kehadiran saya)$/), page.getByText(/^(Schedule & Roster|Jadual & Roster)$/));
          if (en === 'Users' && process.env.REVIEW_ROLE === 'ceo') await before(page.getByText(/^(User accounts|Akaun pengguna)$/), page.getByText(/^(Who sees what|Siapa nampak apa)$/));
          await page.screenshot({ path: path.join(output, `${en.toLowerCase()}-${width}.png`) });
          assert((await measure()).documentWidth <= width, `${en} overflows`);
          assert.equal(errors.length, 0, errors.join('\n'));
        }
        if (process.env.REVIEW_ROLLOUT === '1') {
          for (const [en, ms] of [['Assets', 'Aset'], ['Hotels', 'Hotel'], ['HR', 'HR'], ['Tasks', 'Tugasan'], ['Announcements', 'Pengumuman'], ['Leave', 'Cuti'], ['Claims', 'Tuntutan'], ['Payroll', 'Gaji'], ['Finance', 'Kewangan'], ['Reconciliation', 'Penyelarasan'], ['Commission', 'Komisen'], ['Ads Fund', 'Dana Iklan'], ['Purchasing', 'Pembelian'], ['Accounting', 'Perakaunan'], ['Sales Performance', 'Prestasi Jualan']]) {
            console.log(`Reviewing ${en} at ${width}`);
            await navigate(en, ms);
            if (en === 'Assets') {
              await before(page.getByText(/^(Register|Daftar)$/), page.locator('#asset-form'));
              await page.getByRole('button', { name: /^(Edit|Sunting)$/ }).click();
              assert.equal(await page.getByLabel(/Asset name|Nama aset/).inputValue(), 'ROLLOUT studio light');
              await page.waitForFunction(() => {
                const field = document.querySelector('#asset-form input:not([disabled])').getBoundingClientRect();
                const header = document.querySelector('header').getBoundingClientRect();
                return field.top >= header.bottom && field.bottom <= innerHeight - (innerWidth < 768 ? 80 : 0);
              });
            }
            if (en === 'Sales Performance') {
              await before(page.locator('#sp-shipments'), page.locator('#sp-closing'));
              await before(page.locator('#sp-closing'), page.getByText(/^(Per staff|Setiap staf)/).first());
              await before(page.getByText(/^(Per staff|Setiap staf)/).first(), page.locator('#sp-trend'));
            }
            if (en === 'Hotels') await before(page.getByRole('textbox', { name: /Search the directory|Cari direktori/ }), page.getByText(/^(Hotels by state|Hotel mengikut negeri)$/));
            if (en === 'HR') {
              await before(page.getByText(/^(Task report|Laporan tugasan)$/), page.getByText(/^(Public holidays & company calendar|Cuti umum & kalendar syarikat)$/));
              await before(page.getByText(/^(Payslip \/ payroll summary|Slip gaji \/ ringkasan gaji)$/), page.getByText(/^(Staff birthdays|Hari lahir kakitangan)$/));
            }
            if (en === 'Tasks') {
              await before(page.getByText('ROLLOUT active task', { exact: true }), page.getByText(/^(Create \/ assign a task|Buat \/ agih tugasan)$/));
              assert(!(await page.getByText('ROLLOUT completed task', { exact: true }).isVisible()), 'Completed task crowds active work');
              await page.locator('summary').filter({ hasText: /Completed tasks|Tugasan selesai/ }).click();
              await page.getByText('ROLLOUT completed task', { exact: true }).waitFor();
              const draft = page.getByPlaceholder(/e.g. Prepare LIVE rundown|cth. Sediakan rundown LIVE/);
              await draft.fill('ROLLOUT-DRAFT');
              await page.locator('summary').filter({ hasText: /Completed tasks|Tugasan selesai/ }).click();
              assert.equal(await draft.inputValue(), 'ROLLOUT-DRAFT');
            }
            if (en === 'Announcements') {
              await before(page.getByText('ROLLOUT current announcement', { exact: false }).first(), page.getByText(/^(Publish news|Terbit berita)$/));
              assert(!(await page.getByText('ROLLOUT acknowledged announcement', { exact: false }).isVisible()), 'Acknowledged announcement crowds current work');
              await page.locator('summary').filter({ hasText: /Acknowledged announcements|Pengumuman diperakui/ }).click();
              await page.getByText('ROLLOUT acknowledged announcement', { exact: false }).waitFor();
            }
            if (en === 'Claims') {
              await before(page.locator('#claims-pending'), page.locator('#claim-form'));
              await page.locator('a[href="#claim-form"]').click();
            }
            if (en === 'Payroll') {
              await before(page.locator('table').first(), page.getByRole('button', { name: /^(Save all|Simpan semua)$/ }));
              await page.getByRole('button', { name: /^(Base salaries|Gaji asas)$/ }).click();
              await page.locator('#payroll-base').waitFor();
            }
            if (en === 'Purchasing') {
              await before(page.getByText(/No purchase orders yet|Tiada pesanan pembelian lagi/), page.getByText(/^(New purchase order|Pesanan pembelian baharu)$/));
              await page.getByRole('button', { name: /^(Suppliers|Pembekal) \(/ }).click();
              await page.locator('#purchasing-suppliers').waitFor();
            }
            if (en === 'Accounting') await before(page.getByText(/^(Trial balance|Imbangan duga)$/), page.getByText(/^(New journal entry|Catatan jurnal baharu)$/));
            if (en === 'Commission') {
              await before(page.getByText(/No commission entries yet|Tiada catatan komisen lagi/), page.getByRole('button', { name: /Compute entry|Kira catatan/ }));
              await page.getByRole('button', { name: /^(Rates|Kadar) \(/ }).click();
              await page.locator('#commission-rates').waitFor();
            }
            await page.evaluate(async () => {
              document.querySelector('#shell-scroll').scrollTo({ top: 0, behavior: 'instant' });
              window.scrollTo({ top: 0, behavior: 'instant' });
              document.querySelectorAll('main *').forEach(el => { if (el.scrollLeft) el.scrollLeft = 0; });
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            await page.screenshot({ path: path.join(output, `${en.toLowerCase().replaceAll(' ', '-')}-${width}.png`) });
            assert((await measure()).documentWidth <= width, `${en} overflows`);
            assert.equal(errors.length, 0, errors.join('\n'));
          }
        }
        await navigate('Dashboard', 'Papan Pemuka');
        await page.getByRole('button', { name: /^(Create quotation|Buat sebut harga)$/ }).click();
        await page.locator('#sales-work').waitFor();
        assert.equal(await page.getByRole('tab', { name: /^(Create document|Buat dokumen)$/ }).getAttribute('aria-selected'), 'true', 'Quotation shortcut lost its intent');
        for (let attempt = 0; attempt < 2; attempt++) {
          await page.getByRole('tab', { name: /^(Documents|Dokumen)$/ }).click();
          await page.locator('header').getByRole('button', { name: /Search the portal|Cari dalam portal/ }).filter({ visible: true }).click();
          const query = process.env.REVIEW_LANG === 'ms' ? 'Buat sebut harga' : 'Create quotation';
          await page.getByPlaceholder(/Search anything|Cari apa sahaja/).fill(query);
          await page.getByRole('button', { name: /Create quotation.*action|Buat sebut harga.*tindakan/ }).click();
          await page.getByPlaceholder(/their PO no.|no. PO mereka/).waitFor();
          assert.equal(await page.getByRole('tab', { name: /^(Create document|Buat dokumen)$/ }).getAttribute('aria-selected'), 'true', 'Palette creation did not open the form');
        }
      }
      results.push({ width, dashboard, inventory, errors });
      assert.equal(errors.length, 0, errors.join('\n'));
      await context.close();
    }
  } catch (error) {
    const page = browser.contexts().at(-1)?.pages().at(-1);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, 'failure-final.png') });
      console.error((await page.locator('body').innerText()).slice(-6000));
    }
    throw error;
  } finally {
    writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify({ output, results }, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });

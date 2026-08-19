/* v1.30.0 — the client's own brand, end to end on the built pages.
 *
 * 1. /account — a client with a website and a logo on file sees THEIR mark,
 *    and clicking it goes to THEIR domain. A client with neither sees no
 *    brand card at all (the v1.27.0 rule: never advertise one client to
 *    another).
 * 2. the public footer — "Our companies" lists A2Z and AZ ONE only; ELFIA
 *    (a client, no permission on file) appears nowhere.
 */
import { chromium } from 'playwright-core';

const BRAND = { company: 'ELFIA', website: 'https://elfiaofficialstore.my', logo_key: 'uploads/client-logos/12-1.png' };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));

let withBrand = true;
await p.route('**/api/v1/**', (route) => {
  const u = new URL(route.request().url()).pathname;
  if (u.includes('/media/file/')) {
    // 1x1 transparent PNG so the <img> resolves without a real R2 object
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  }
  let body = {};
  if (u.includes('/auth/me')) body = { user: { id: 5, email: 'client@elfia.my', name: 'ELFIA', role: 'customer' } };
  else if (u.includes('/account/enquiries')) body = { enquiries: [] };
  else if (u.includes('/account/orders')) body = { locked: false, docs: [], lives: [], brand: withBrand ? BRAND : null };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await p.goto('http://localhost:8931/account.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
const accountText = await p.evaluate(() => document.body.innerText);
const brandLink = await p.locator('a[href="https://elfiaofficialstore.my"]').count();
const shotOk = { yourBrand: /Your brand/i.test(accountText), companyShown: /ELFIA/.test(accountText), linkCount: brandLink };
await p.screenshot({ path: '/root/deliver/client-brand-account.png' });

// same page, client with nothing on file -> no card at all
withBrand = false;
await p.goto('http://localhost:8931/account.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2200);
const bare = await p.evaluate(() => document.body.innerText);
const shotBare = { yourBrand: /Your brand/i.test(bare) };

// public footer
const p2 = await ctx.newPage();
await p2.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await p2.goto('http://localhost:8931/index.html', { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(1500);
const footer = await p2.locator('#site-footer').innerText();
const azoneLink = await p2.locator('#site-footer a[href="https://azoneofficial.com"]').count();
const elfiaAnywhere = await p2.locator('a[href*="elfiaofficialstore"]').count();
await p2.locator('#site-footer').screenshot({ path: '/root/deliver/footer-companies.png' });

const report = {
  account_withBrand: shotOk,
  account_withoutBrand: shotBare,
  footer_hasOurCompanies: /Our companies/i.test(footer),
  footer_azoneLinks: azoneLink,
  footer_namesAzOne: /AZ ONE OFFICIAL/.test(footer),
  elfiaLinksOnPublicSite: elfiaAnywhere,
  pageErrors: errs.slice(0, 3),
};
console.log(JSON.stringify(report, null, 1));
const pass = shotOk.yourBrand && shotOk.companyShown && shotOk.linkCount >= 1
  && !shotBare.yourBrand
  && report.footer_hasOurCompanies && report.footer_azoneLinks === 1 && report.footer_namesAzOne
  && report.elfiaLinksOnPublicSite === 0
  && report.pageErrors.length === 0;
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);

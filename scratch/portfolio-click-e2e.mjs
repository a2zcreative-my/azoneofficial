/* "When I click on portfolio does it redirect to their website?"
   Answered by actually clicking, not by reading the markup.

   Checks, for BOTH cards:
     - the WHOLE card is one link (clicking the description works, not just
       the logo or the name)
     - it opens the brand's own site in a NEW TAB, leaving a2zcreative.my
       still open in the original tab
     - the destination URL is the right one for that brand
   And separately: the "Portfolio" item in the NAV is internal — it must NOT
   leave the site. */
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:8949';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
// the outbound sites are real; stub them so the test is offline-safe
await ctx.route(/elfiaofficialstore\.my|azoneofficial\.com/, (r) =>
  r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>brand site</h1>' }));

// --- the nav item: internal, same tab ---
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(400);
const navHref = await page.locator('nav a', { hasText: /^Portfolio$/ }).first().getAttribute('href');

await page.goto(`${BASE}/portfolio.html`, { waitUntil: 'load' });
await page.waitForTimeout(500);

const results = [];
for (const [brand, expect] of [
  ['ELFIA', 'elfiaofficialstore.my'],
  ['AZ ONE OFFICIAL', 'azoneofficial.com'],
]) {
  const card = page.locator(`main a[aria-label="${brand} — visit site"]`);
  const exists = (await card.count()) === 1;
  const target = await card.getAttribute('target');
  const rel = await card.getAttribute('rel');
  const href = await card.getAttribute('href');
  // click the PARAGRAPH inside the card, i.e. the least obvious spot
  const [popup] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null),
    card.locator('p').last().click(),
  ]);
  const openedUrl = popup ? popup.url() : null;
  const originalStillHere = page.url().includes('/portfolio');
  if (popup) await popup.close();
  results.push({
    brand, exists, href, target, rel,
    wholeCardClickable: Boolean(popup),
    openedUrl,
    goesToRightSite: Boolean(openedUrl && openedUrl.includes(expect)),
    originalTabStays: originalStillHere,
  });
}

const report = { navPortfolioHref: navHref, navIsInternal: navHref === '/portfolio', cards: results };
console.log(JSON.stringify(report, null, 1));
const pass = report.navIsInternal && results.every((r) =>
  r.exists && r.target === '_blank' && (r.rel ?? '').includes('noopener') &&
  r.wholeCardClickable && r.goesToRightSite && r.originalTabStays);
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);

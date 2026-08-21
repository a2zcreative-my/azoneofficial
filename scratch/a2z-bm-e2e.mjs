/* v1.32.0 — EN/BM toggle across the whole public site, plus the two named
   portfolio entries. Runs against the BUILT static export.

   What it proves:
     1. The toggle exists on every public page and switching to BM actually
        changes the visible copy (not just a label somewhere).
     2. BM survives navigation — the choice is remembered per device.
     3. A returning BM visitor gets BM on FIRST PAINT (the pre-hydration
        boot script), not after a flash of English.
     4. Switching back to EN restores the exact original English.
     5. The staff portal is untouched by the public translator.
     6. The portfolio names ELFIA and AZ ONE OFFICIAL and shows both marks. */
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:8949';
const PAGES = ['index', 'about', 'services', 'packages', 'portfolio', 'contact', 'faq', 'case-studies', 'careers', 'blog'];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`${new URL(page.url()).pathname} :: ${e.message.slice(0, 90)}`));
await page.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

// ---- 1. every public page translates ----
const perPage = {};
for (const name of PAGES) {
  await page.goto(`${BASE}/${name}.html`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.setItem('azone-lang', 'en'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  const en = await bodyText();
  const toggle = page.locator('button[aria-pressed]', { hasText: /^BM$/ }).first();
  const hasToggle = (await toggle.count()) > 0;
  if (!hasToggle) { perPage[name] = { hasToggle: false }; continue; }
  await toggle.click();
  await page.waitForTimeout(500);
  const ms = await bodyText();
  // how much of the page actually changed
  const enWords = new Set(en.split(' '));
  const msWords = ms.split(' ');
  const changed = msWords.filter((w) => !enWords.has(w)).length;
  perPage[name] = { hasToggle: true, changed, differs: ms !== en, msHasMalay: /\b(kami|anda|yang|untuk|dan|jenama|perkhidmatan)\b/i.test(ms) };
}

// ---- 2 + 3. BM persists across navigation; the veil hides the swap ----
await page.goto(`${BASE}/services.html`, { waitUntil: 'load' });
await page.waitForTimeout(400);
const persisted = /\b(kami|perkhidmatan|jenama)\b/i.test(await bodyText());
const htmlLang = await page.evaluate(() => document.documentElement.lang);
// the anti-flash veil: inline boot script + the CSS rule that acts on it
const veilWired = await page.evaluate(() => {
  const inline = [...document.querySelectorAll('script:not([src])')].some((s) => s.textContent.includes('ms-pending'));
  const css = [...document.styleSheets].some((sheet) => {
    try { return [...sheet.cssRules].some((r) => r.cssText.includes('ms-pending') && r.cssText.includes('visibility')); }
    catch { return false; }
  });
  return { inline, css };
});
// FAILSAFE: with every script file blocked (so React never mounts), a BM
// visitor must still end up looking at a visible page, not a blank one.
const broken = await ctx.newPage();
await broken.route('**/*.js', (r) => r.abort());
await broken.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
await broken.waitForTimeout(2000);
const visibleAfterFailure = await broken.evaluate(() => getComputedStyle(document.body).visibility === 'visible');
await broken.close();

// ---- 4. back to EN restores the original exactly ----
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(500);
const msHome = await bodyText();
await page.locator('button[aria-pressed]', { hasText: /^EN$/ }).first().click();
await page.waitForTimeout(500);
const backToEn = await bodyText();
await page.evaluate(() => localStorage.setItem('azone-lang', 'en'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
const freshEn = await bodyText();
const restoresExactly = backToEn === freshEn && msHome !== freshEn;

// ---- 5. the staff portal must be left alone ----
await page.evaluate(() => localStorage.setItem('azone-lang', 'ms'));
await page.goto(`${BASE}/portal.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const portalToggleAbsent = (await page.locator('div[role="group"][aria-label="Language / Bahasa"]').count()) === 0;

// ---- 6. the named portfolio ----
await page.evaluate(() => localStorage.setItem('azone-lang', 'en'));
await page.goto(`${BASE}/portfolio.html`, { waitUntil: 'load' });
await page.waitForTimeout(600);
const pf = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('main img')].map((i) => ({ alt: i.alt, src: i.getAttribute('src'), w: i.naturalWidth }));
  return { text: document.body.innerText, imgs };
});
// a literal \uXXXX on the page means a JS escape leaked through a JSX
// attribute (they are not processed there) — it happened once, in this intro
const noRawEscapes = !/\\u[0-9a-fA-F]{4}/.test(pf.text);
const namesElfia = /ELFIA/.test(pf.text);
const namesAzOne = /AZ ONE OFFICIAL/.test(pf.text);
const logosLoad = ['ELFIA', 'AZ ONE OFFICIAL'].every((n) => {
  const hit = pf.imgs.find((i) => i.alt === n);
  return hit && hit.w > 0;
});
const linksOut = (await page.locator('a[href="https://elfiaofficialstore.my"]').count()) > 0
              && (await page.locator('a[href="https://azoneofficial.com"]').count()) > 0;

const report = {
  perPage,
  everyPageTranslates: Object.values(perPage).every((p) => p.hasToggle && p.differs && p.msHasMalay && p.changed >= 8),
  persistsAcrossNav: persisted,
  veilWired, visibleAfterFailure,
  htmlLangMs: htmlLang === 'ms',
  restoresExactly,
  portalUntouched: portalToggleAbsent,
  namesElfia, namesAzOne, logosLoad, linksOut, noRawEscapes,
  /* The portal is only visited to prove the public translator leaves it
     alone. It throws under this test's blanket {} API stub (it expects a real
     /auth/me), which is a property of the stub, not of the site — so the
     zero-error rule covers the PUBLIC pages, which is what changed here. */
  publicPageErrors: errs.filter((e) => !e.startsWith('/portal')).slice(0, 3),
  portalStubErrors: errs.filter((e) => e.startsWith('/portal')).length,
};
console.log(JSON.stringify(report, null, 1));
const pass = report.everyPageTranslates && persisted && veilWired.inline && veilWired.css && visibleAfterFailure && report.htmlLangMs && restoresExactly
  && portalToggleAbsent && namesElfia && namesAzOne && logosLoad && linksOut && noRawEscapes && report.publicPageErrors.length === 0;
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);

/* Measure, don't guess: how wide does the desktop header row actually need
   to be in EN and in BM, and where does it collide? */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8947';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const WIDTHS = [1024, 1120, 1200, 1280, 1366, 1440, 1600];
const page = await ctx.newPage();
await page.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

for (const lang of ['en', 'ms']) {
 for (const W of WIDTHS) {
  await page.setViewportSize({ width: W, height: 900 });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await page.evaluate((l) => localStorage.setItem('azone-lang', l), lang);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const nav = document.querySelector('header nav');
    if (!nav) return null;
    const kids = [...nav.children];
    const boxes = kids.map((k) => {
      const r = k.getBoundingClientRect();
      return { tag: k.tagName, w: Math.round(r.width), x: Math.round(r.left), right: Math.round(r.right),
               visible: getComputedStyle(k).display !== 'none' };
    }).filter((k) => k.visible);
    // natural width each group WANTS (sum of children's scrollWidth)
    const wanted = kids.filter((k) => getComputedStyle(k).display !== 'none')
      .map((k) => Math.round(k.scrollWidth));
    /* Multi-line detection that works for buttons too: a Range over the
       element's own text reports one client rect per LINE BOX. Comparing
       heights fails here because the CTA is deliberately 40px tall. */
    const lines = (el) => {
      const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (!t) return 1;
      const r = document.createRange(); r.selectNodeContents(t);
      return r.getClientRects().length;
    };
    const wrapped = [...nav.querySelectorAll('a')]
      .filter((el) => lines(el) > 1)
      .map((el) => el.textContent.trim().slice(0, 26));
    // do any two visible groups overlap?
    const rects = kids.filter((k) => getComputedStyle(k).display !== 'none').map((k) => k.getBoundingClientRect());
    let collide = false;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], z = rects[j];
      if (!(a.right <= z.left + 0.5 || z.right <= a.left + 0.5)) collide = true;
    }
    return { navWidth: Math.round(nav.getBoundingClientRect().width), boxes, wanted,
             wantedTotal: wanted.reduce((a, c) => a + c, 0), wrapped, collide };
  });
  const bad = m.collide || m.wrapped.length > 0;
  console.log(`${lang.toUpperCase()} @${String(W).padStart(4)}  row=${m.navWidth}  wants=${m.wantedTotal}  ${bad ? 'BROKEN' : 'ok'}` +
    (m.collide ? '  [overlap]' : '') + (m.wrapped.length ? `  [wrapped: ${m.wrapped.join(' | ')}]` : ''));
 }
}
await b.close();

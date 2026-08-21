/* v1.32.1 — the header must survive BOTH languages at EVERY width.

   The CEO photographed the BM navbar with "Tentang Kami" printed through the
   logo, "Log Masuk" on two lines and the CTA wrapped. Cause: Bahasa Melayu
   labels are ~15% wider than English, and the desktop row switched on at md
   (768px) where they cannot fit. This locks the fix in place.

   At each width × language it asserts:
     - no nav link or button wraps onto a second line (Range client rects,
       which works for the 40px-tall CTA where a height check does not)
     - no two header groups overlap horizontally
     - the page has no sideways scroll
     - below the desktop breakpoint: the hamburger AND the language toggle are
       both visible (a BM reader must never have to open a menu to find their
       own language), and the menu opens with every destination in it
     - at desktop width: all seven links are visible                        */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8948';
const WIDTHS = [390, 768, 1024, 1120, 1279, 1280, 1440, 1600];
const DESKTOP_FROM = 1280; // the xl breakpoint the navbar uses

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

const rows = [];
for (const lang of ['en', 'ms']) {
  for (const W of WIDTHS) {
    await page.setViewportSize({ width: W, height: 900 });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await page.evaluate((l) => localStorage.setItem('azone-lang', l), lang);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(450);

    const m = await page.evaluate(() => {
      const nav = document.querySelector('header nav');
      const shown = [...nav.children].filter((k) => getComputedStyle(k).display !== 'none');
      const lines = (el) => {
        const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
        if (!t) return 1;
        const r = document.createRange();
        r.selectNodeContents(t);
        return r.getClientRects().length;
      };
      const wrapped = [...nav.querySelectorAll('a')].filter((el) => lines(el) > 1)
        .map((el) => el.textContent.trim().slice(0, 26));
      const rects = shown.map((k) => k.getBoundingClientRect());
      let overlap = false;
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++)
          if (!(rects[i].right <= rects[j].left + 0.5 || rects[j].right <= rects[i].left + 0.5)) overlap = true;
      /* There are TWO toggles in the markup — one in the desktop group, one
         beside the hamburger — and only one is displayed at a given width.
         Counting VISIBLE ones (not "the first one") is the honest check: it
         also catches the opposite bug, both showing at once. */
      const visibleCount = (sel) => [...document.querySelectorAll(sel)]
        .filter((el) => el.getClientRects().length && getComputedStyle(el).display !== 'none').length;
      const vis = (sel) => visibleCount(sel) > 0;
      return {
        wrapped, overlap,
        hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        burger: vis('header button[aria-label="Open menu"]'),
        toggles: visibleCount('header div[role="group"][aria-label="Language / Bahasa"]'),
        desktopLinks: [...nav.querySelectorAll('ul a')].filter((a) => a.getClientRects().length).length,
      };
    });

    const desktop = W >= DESKTOP_FROM;
    const problems = [];
    if (m.wrapped.length) problems.push(`wrapped: ${m.wrapped.join(' | ')}`);
    if (m.overlap) problems.push('groups overlap');
    if (m.hScroll) problems.push('horizontal scroll');
    if (m.toggles === 0) problems.push('language toggle not visible');
    if (m.toggles > 1) problems.push(`${m.toggles} language toggles visible at once`);
    if (desktop && m.desktopLinks !== 7) problems.push(`only ${m.desktopLinks}/7 links visible`);
    if (!desktop && !m.burger) problems.push('no hamburger below the desktop breakpoint');

    // below the breakpoint, the menu must still reach every destination
    if (!desktop && m.burger) {
      await page.locator('header button[aria-label="Open menu"]').click();
      await page.waitForTimeout(250);
      const items = await page.locator('#mobile-menu a').count();
      if (items < 9) problems.push(`menu has only ${items} links (7 nav + Login + CTA expected)`);
      await page.locator('header button[aria-label="Close menu"]').click().catch(() => {});
    }
    rows.push({ lang, W, ok: problems.length === 0, problems });
  }
}

for (const r of rows) {
  console.log(`${r.lang.toUpperCase()} @${String(r.W).padStart(4)}  ${r.ok ? 'ok' : 'BROKEN — ' + r.problems.join('; ')}`);
}
const pass = rows.every((r) => r.ok);
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);

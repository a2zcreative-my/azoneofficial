/* How much vertical space does the footer actually eat, and how much of the
   screen is that? Numbers before/after, not adjectives. */
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://localhost:8949';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [w, h] of [[1280, 900], [768, 1024], [390, 844]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  await p.route('**/api/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.goto(`${BASE}/packages.html`, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  const m = await p.evaluate(() => {
    const f = document.getElementById('site-footer');
    return { footer: Math.round(f.getBoundingClientRect().height),
             doc: Math.round(document.documentElement.scrollHeight) };
  });
  console.log(`@${String(w).padStart(4)}  footer=${String(m.footer).padStart(4)}px  page=${m.doc}px  footer is ${(100*m.footer/m.doc).toFixed(0)}% of the page, ${(m.footer/h).toFixed(1)} screens tall`);
}
await b.close();

/* v1.29.2 — does /login fit a phone screen without scrolling?
   Measures against the CEO's actual device profile (iPhone 16 Pro Max,
   Safari, URL bar showing) plus the smallest phone we still support. */
import { chromium } from 'playwright-core';

const DEVICES = [
  { name: 'iphone16promax', width: 440, height: 700 },  // svh with Safari chrome
  { name: 'iphone-se',      width: 375, height: 555 },
  { name: 'desktop',        width: 1400, height: 900 },
];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const out = [];
for (const d of DEVICES) {
  const ctx = await b.newContext({ viewport: { width: d.width, height: d.height }, deviceScaleFactor: 2, isMobile: d.width < 800, hasTouch: d.width < 800 });
  const p = await ctx.newPage();
  await p.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.goto('http://localhost:8931/login.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  const m = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const signIn = btns.find((x) => /^(Sign in|Log masuk)$/.test(x.textContent.trim()) && x.className.includes('w-full')) ?? btns[btns.length - 1];
    const r = signIn.getBoundingClientRect();
    const fab = document.querySelector('a[href*="wa.me"], a[aria-label*="WhatsApp" i]');
    const fabBox = fab ? fab.getBoundingClientRect() : null;
    const overlaps = fabBox ? !(fabBox.right < r.left || fabBox.left > r.right || fabBox.bottom < r.top || fabBox.top > r.bottom) : false;
    return {
      docHeight: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
      signInBottom: Math.round(r.bottom),
      signInVisible: r.bottom <= window.innerHeight + 1 && r.top >= 0,
      whatsappPresent: !!fab,
      whatsappOverlapsButton: overlaps,
    };
  });
  m.fitsWithoutScrolling = m.docHeight <= m.viewport + 2;
  out.push({ device: d.name, ...m });
  await p.screenshot({ path: `/root/deliver/login-${d.name}.png` });
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
const phones = out.filter((o) => o.device !== 'desktop');
const pass = phones.every((o) => o.signInVisible && o.fitsWithoutScrolling && !o.whatsappPresent);
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);

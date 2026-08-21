/* v1.33.1 — the minimalist footer.

   CEO: "footer web should minimalist instead of consume so much space."
   Measured before the rewrite: 1080px at 1280 and 1208px at 390 — 32–37% of
   every page, more than a full screen of scrolling on its own.

   "Minimal" is easy to claim and easy to lose one commit at a time, so this
   test holds the two halves of it at once:

     A. SMALL — a hard height budget at three widths.
     B. STILL COMPLETE — nothing was thrown away to hit the budget. Every
        destination is still linked, the address, email and CTA are still
        there, the social links still have accessible names now that their
        visible labels are gone, and Our-companies is still a separate group
        from Clients (merging them would quietly claim we own our clients).

   Plus the things v1.33.0 fixed, which must stay fixed: the mark loads and
   is legible; every mark on the navy panel is a dark-surface variant; the
   email is never split mid-word; and the fixed WhatsApp button does not sit
   on top of the legal line.

   v1.33.2: the CEO chose the LEFT-ALIGNED layout, so the alignment assertion
   flipped with it — the mark now has to sit on the container's left edge, not
   its centre line. Same idea, opposite axis: the mark must be deliberately
   placed, never drifting. */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8949';

/* Budgets, not aspirations. Set just above the measured result so a real
   regression trips them but noise does not. The record, at 1280/768/390:

     v1.32.1  the original, left-aligned      1080 / 1080 / 1208
     v1.33.1  centred rows, most compact       433 /  451 /  647
     v1.33.2  left-aligned again, as chosen    458 /  491 /  839

   v1.33.2 is the CEO's choice of layout. It costs more on a phone than the
   centred version did, and that is inherent: at 390px a left-aligned brand
   block and its link columns cannot share a row, so they stack. Still 31%
   below the original on a phone and 58% below it on desktop. */
const BUDGET = { 1280: 500, 768: 540, 390: 890 };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

const problems = [];
const heights = {};

for (const W of [1280, 768, 390]) {
  await page.setViewportSize({ width: W, height: W === 390 ? 844 : 900 });
  await page.goto(`${BASE}/packages.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  /* Scroll to the very end FIRST. The WhatsApp button is fixed to the
     viewport, so an overlap check run at the top of the page compares the
     button against a footer that is 2000px below the fold and passes without
     testing anything. The end of the page is the only place the two can
     collide, so that is where the measurement has to happen. */
  /* The site sets `scroll-behavior: smooth`, so one scrollTo() only STARTS
     the journey. Poll until the position stops moving, then confirm below
     that we really are at the end before trusting the overlap result. */
  await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const before = window.scrollY;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 50));
      if (Math.abs(window.scrollY - before) < 1 && i > 2) break;
    }
  });
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    const f = document.getElementById('site-footer');
    const inner = f.querySelector(':scope > div');
    const axis = inner.getBoundingClientRect().left + inner.getBoundingClientRect().width / 2;
    void axis;

    const logo = f.querySelector('img[src="/logo-white.png"]');
    const lb = logo?.getBoundingClientRect();

    const lineBoxes = (el) => {
      const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (!t) return 1;
      const r = document.createRange(); r.selectNodeContents(t);
      return r.getClientRects().length;
    };

    const imgs = [...f.querySelectorAll('img')].map((i) => ({
      src: i.getAttribute('src'), loaded: i.naturalWidth > 0,
    }));

    // --- completeness ---
    const hrefs = [...f.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    /* v1.33.2 — the social links show their names again, so an aria-label
       count is the wrong test: it would read 0 and call a correct footer
       broken. What actually matters is that each one HAS an accessible name,
       whether that comes from visible text (now) or an aria-label (as it did
       in v1.33.1). Take whichever is present. */
    const socials = [...f.querySelectorAll('a[href]')]
      .filter((a) => a.querySelector('svg') && /tiktok|instagram|facebook/i.test(a.href + ' ' + a.textContent + ' ' + (a.getAttribute('aria-label') ?? '')))
      .map((a) => (a.getAttribute('aria-label') || a.textContent.trim()))
      .filter(Boolean);

    const companies = [...(f.querySelector('[data-footer="companies"]')?.querySelectorAll('img') ?? [])]
      .map((i) => i.getAttribute('alt'));
    const clients = [...(f.querySelector('[data-footer="clients"]')?.querySelectorAll('img') ?? [])]
      .map((i) => i.getAttribute('alt'));

    /* The floating WhatsApp button. It is SUPPOSED to fade out whenever the
       footer is on screen (v1.2.18) because the footer carries the same CTA
       — that is what lets the footer use its full width at the end of the
       page. Assert the fade, and only treat a geometric overlap as a fault
       when the button is actually visible: an opacity-0 element still
       reports a box, so a naive rect test reads as a false failure. */
    const fab = [...document.querySelectorAll('a')].find((a) => getComputedStyle(a).position === 'fixed');
    const fabStyle = fab ? getComputedStyle(fab) : null;
    const fabVisible = fabStyle ? Number(fabStyle.opacity) > 0.05 : false;
    const fabBox = fab && fabVisible ? fab.getBoundingClientRect() : null;
    const atPageEnd = Math.abs(
      (window.scrollY + window.innerHeight) - document.documentElement.scrollHeight
    ) < 3;
    const overlapsFab = fabBox
      ? [...f.querySelectorAll('p, li, span[data-footer]')].filter((el) => {
          if (!el.textContent.trim()) return false;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          return !(r.right <= fabBox.left || fabBox.right <= r.left
                || r.bottom <= fabBox.top || fabBox.bottom <= r.top);
        }).map((el) => el.textContent.trim().slice(0, 34))
      : [];

    const mail = f.querySelector('a[href^="mailto:"]');

    return {
      height: Math.round(f.getBoundingClientRect().height),
      pageHeight: Math.round(document.documentElement.scrollHeight),
      logoLoaded: (logo?.naturalWidth ?? 0) > 0,
      logoHeight: Math.round(lb?.height ?? 0),
      logoLeftAligned: lb ? Math.abs(lb.left - inner.getBoundingClientRect().left) < 2 : false,
      brokenImages: imgs.filter((i) => !i.loaded).map((i) => i.src),
      darkVariantsOnly: imgs.filter((i) => /\/brands\//.test(i.src ?? ''))
        .every((i) => /-white\.png$/.test(i.src ?? '')),
      hrefs, socials, companies, clients,
      emailPresent: Boolean(mail),
      emailOnOneLine: mail ? lineBoxes(mail) === 1 : false,
      ctaPresent: [...f.querySelectorAll('a[href]')].some((a) => /wa\.me|whatsapp/.test(a.getAttribute('href') ?? '')),
      addressPresent: f.innerText.includes('Setia Tropika'),
      overlapsFab, atPageEnd, fabFound: Boolean(fab),
      fabVisibleOverFooter: fabVisible,
      fabInert: fab ? (fab.getAttribute('aria-hidden') === 'true' && fabStyle.pointerEvents === 'none') : false,
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  heights[W] = m.height;
  const at = `@${W}`;
  if (m.height > BUDGET[W]) problems.push(`${at} footer is ${m.height}px, over the ${BUDGET[W]}px budget`);
  if (!m.logoLoaded) problems.push(`${at} the mark did not load`);
  if (m.logoHeight < 38) problems.push(`${at} the mark is only ${m.logoHeight}px tall`);
  if (!m.logoLeftAligned) problems.push(`${at} the mark is not on the container's left edge`);
  if (m.brokenImages.length) problems.push(`${at} broken images: ${m.brokenImages.join(', ')}`);
  if (!m.darkVariantsOnly) problems.push(`${at} a brand mark on the navy panel is not the -white variant`);
  if (!m.emailPresent) problems.push(`${at} the email is gone`);
  if (!m.emailOnOneLine) problems.push(`${at} the email is split across lines`);
  if (!m.ctaPresent) problems.push(`${at} the WhatsApp CTA is gone`);
  if (!m.addressPresent) problems.push(`${at} the address is gone`);
  if (m.hScroll) problems.push(`${at} horizontal scroll`);
  if (m.overlapsFab.length) problems.push(`${at} the WhatsApp button covers: ${m.overlapsFab.join(' | ')}`);
  /* Guard the guard: if the page were not scrolled to the end, or the button
     were not found, the overlap check above would pass by doing nothing. */
  if (!m.atPageEnd) problems.push(`${at} overlap check ran without being at the page end — it proves nothing`);
  if (!m.fabFound) problems.push(`${at} the fixed WhatsApp button was not found — overlap check proves nothing`);
  /* The footer only gets to use its full width because the button yields. If
     that ever stops being true, the footer must go back to working around it,
     so the yielding itself is the thing under test. */
  if (m.fabVisibleOverFooter) problems.push(`${at} the WhatsApp button is still visible over the footer`);
  if (!m.fabInert) problems.push(`${at} the faded WhatsApp button is still focusable/clickable over the footer`);

  // every destination, and the two brand groups, checked once at desktop
  if (W === 1280) {
    const need = ['/about', '/services', '/consultancy', '/packages', '/portfolio', '/blog', '/contact',
                  '/faq', '/case-studies', '/careers', '/privacy', '/terms', '/login'];
    const missing = need.filter((h) => !m.hrefs.includes(h));
    if (missing.length) problems.push(`links dropped from the footer: ${missing.join(', ')}`);
    if (m.socials.length !== 3) problems.push(`${m.socials.length}/3 social links carry an accessible name — got [${m.socials.join(', ')}]`);
    if (!m.companies.includes('AZ ONE OFFICIAL')) problems.push('AZ ONE OFFICIAL missing from Our companies');
    if (!m.clients.includes('ELFIA')) problems.push('ELFIA missing from Clients');
    if (m.companies.includes('ELFIA')) problems.push('ELFIA is listed as one of OUR COMPANIES — it is a client');
    if (m.clients.length !== 1) problems.push(`${m.clients.length} client marks shown; only ELFIA has permission on file`);
  }
}

console.log(JSON.stringify({ heights, budget: BUDGET, problems }, null, 1));
const pass = problems.length === 0;
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);

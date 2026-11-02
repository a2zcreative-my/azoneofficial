"""v1.249.1 - THE OVERFLOW SWEEP: every tab, at desktop (1440, 1024), tablet
(820) and phone (390) for the CEO, and at phone width for a salesperson, a
live host, the HR admin and an agent. On each screen: the page never scrolls
sideways, nothing in the header or the page sits past the screen edge unless it
is inside its own horizontal scroller, and nothing covers the phone bar.

The owner, 01-11-2026: "ensure that my UI/UX are standardize globally and no
overflow issue". Found on its first run: the Leave tab slid sideways on every
phone (a screen-reader label at the end of a wide table widened the page).

Servers (servers.txt): 4177 ceo, 4182 sales_marketing, 4180 live_host,
4181 hr_admin, 4222 agent."""
import sys, json, urllib.parse
from playwright.sync_api import sync_playwright
PROBE = """() => {
  const vw = document.documentElement.clientWidth;
  const page = document.documentElement.scrollWidth > vw + 1;
  const bad = [];
  const scrollsX = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (['auto','scroll','hidden','clip'].includes(s.overflowX) && p !== document.body && p !== document.documentElement) return true; } return false; };
  for (const e of document.querySelectorAll('main *, header *')) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(e).position === 'fixed') continue;
    if (r.right > vw + 1 && !scrollsX(e)) bad.push((e.getAttribute('data-testid') || e.className || e.tagName).toString().slice(0, 60) + ' @' + Math.round(r.right));
  }
  /* the phone bar must stay on top: what is under the middle of each stop? */
  let covered = [];
  for (const it of document.querySelectorAll('.erp-bottom-nav-item')) {
    const r = it.getBoundingClientRect(); if (!r.width) continue;
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (el && !it.contains(el) && !el.closest('.erp-bottom-nav')) covered.push((el.className || el.tagName).toString().slice(0, 50));
  }
  return { page, bad: [...new Set(bad)].slice(0, 4), covered: [...new Set(covered)] };
}"""
NAMES = ["Dashboard","Desk","Ecommerce","Sales","Agents","Inventory","Assets","Hotels","ELFIA Store","ELFIA Traffic","HR","Attendance","On Shift","Tasks","Announcements","Staff Details","Leave","Claims","Payroll","Finance","Accounting","Commission","Companies","Cards","Profile","Users"]
CASES = [(4177, 1440), (4177, 1024), (4177, 820), (4177, 390), (4182, 390), (4180, 390), (4181, 390), (4222, 390)]
results = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for port, w in CASES:
        ctx = b.new_context(viewport={"width": w, "height": 860}, is_mobile=w < 500, has_touch=w < 500)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
        for n in NAMES:
            pg.goto(f"http://127.0.0.1:{port}/portal?tab={urllib.parse.quote(n)}"); pg.wait_for_timeout(1700)
            active = pg.evaluate("() => document.querySelector('.erp-topbar-title, h1')?.textContent ?? ''")
            r = pg.evaluate(PROBE)
            results.append({"port": port, "w": w, "tab": n, "title": active.strip()[:30], **r})
            # v1.251.0 - and every view inside Users and Companies (the first-view-only sweep missed them)
            if n in ("Users", "Companies") and w <= 820:
                for t in pg.locator("[role=tablist] [role=tab]").all_inner_texts():
                    tb = pg.get_by_role("tab", name=t.strip(), exact=True)
                    if not t.strip() or tb.count() == 0: continue
                    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
                    tb.first.click(force=True); pg.wait_for_timeout(1200)
                    results.append({"port": port, "w": w, "tab": f"{n} > {t.strip()}", "title": active.strip()[:30], **pg.evaluate(PROBE)})
        if errs: print("PAGEERRORS", port, w, errs[:3])
        ctx.close()
    b.close()
seen = len(results)
bad = [r for r in results if r["page"] or r["bad"] or r["covered"]]
for r in bad: print("FAIL " + json.dumps(r))
titles = {(r["port"], r["w"]): set() for r in results}
for r in results: titles[(r["port"], r["w"])].add(r["title"])
print(f"overflow-sweep: {seen - len(bad)} of {seen} screens clean ({sum(len(v) for v in titles.values())} distinct page titles across {len(titles)} role/width runs)")
sys.exit(1 if bad else 0)

"""THE ONE KPI STRIP, ENFORCED (v1.338.0, the CEO's "Strict Global KPI Strip
Enforcement", 17-11-2026). The Tasks strip (KpiRow / KpiTile,
components/ui/kpi-tile.tsx) is the only approved figure design. This probe
walks every tab and every view and FAILS when a row of figures is still drawn
as separate cards: two or more sibling card-like boxes (a radius and a border,
shadow or their own ground) each holding a figure (a short text with a digit,
18px+ and bold) outside [data-kpi-strip]. It also checks every strip on screen
is one card with zero gap.

  PREVIEW=http://127.0.0.1:4177  OUT=/tmp/shots  python3 tests/browser/kpi-strip-sweep.py
"""
from playwright.sync_api import sync_playwright
import json, os, re, sys, urllib.parse, urllib.request

BASE = os.environ.get("PREVIEW", "http://127.0.0.1:4177")
OUT = os.environ.get("OUT", "")
TABS = [t for t in os.environ.get("TABS", "").split(",") if t] or [
    "Dashboard", "Desk", "Announcements", "Sales", "Ecommerce", "Agents", "Financial Advisory", "Projects", "Tasks", "Inventory", "Assets",
    "Hotels", "HR", "Staff Details", "Attendance", "On Shift", "Roster & Scheduling", "Leave", "Claims", "Payroll", "Finance", "Accounting",
    "Commission", "ELFIA Store", "ELFIA Traffic", "Companies", "Users", "Automation & Rules", "Cards", "Profile"]

FIND = r"""() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden],[aria-hidden=true],[role=dialog]'); };
  const bgOf = (e) => { for (let p = e; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return ''; };
  const cardish = (e) => { const c = getComputedStyle(e); const rad = parseFloat(c.borderTopLeftRadius) || 0; const bw = parseFloat(c.borderTopWidth) || 0;
    const own = c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== bgOf(e.parentElement);
    return rad >= 6 && (bw > 0 || c.boxShadow !== 'none' || own); };
  /* a figure reads as a number: digits, money, a time or a ratio, at most a short unit -
     never an ID ("A2Z-001") or a title's "(3)" */
  const NUMERIC = /^(RM\s?)?[−+\-]?[\d.,:/%\s–]+(\s?[a-zA-Z]{1,4})?$/;
  const figs = [...document.querySelectorAll('main *')].filter((e) => {
    if (!vis(e) || e.closest('[data-kpi-strip],table,svg,nav')) return false;
    const t = e.textContent.trim(); const c = getComputedStyle(e);
    if (!/\d/.test(t) || !NUMERIC.test(t) || t.length > 18 || parseFloat(c.fontSize) < 15.5 || +c.fontWeight < 600) return false;
    return ![...e.children].some((k) => k.textContent.trim() === t);
  });
  const groups = new Map();
  for (const f of figs) {
    let card = null, p = f.parentElement;
    for (let i = 0; p && i < 5 && p.tagName !== 'MAIN'; i++, p = p.parentElement) { if (cardish(p)) { card = p; break; } }
    /* a figure card is figure-sized: a panel, a post or a form holding a number is not one */
    if (!card || !card.parentElement || card.innerText.trim().length > 120) continue;
    const row = card.parentElement;
    if (!groups.has(row)) groups.set(row, new Set());
    groups.get(row).add(card);
  }
  const out = [];
  for (const [row, set] of groups) {
    if (set.size < 2) continue;
    const cards = [...set];
    out.push({ row: (row.className && String(row.className).slice(0, 90)) || row.tagName, testid: row.dataset.testid || '',
      cls: String(cards[0].className).slice(0, 90), n: cards.length,
      texts: cards.slice(0, 6).map((c) => c.innerText.replace(/\s+/g, ' ').trim().slice(0, 40)) });
  }
  const strips = [...document.querySelectorAll('[data-kpi-strip]')].filter(vis).map((s) => { const c = getComputedStyle(s);
    return { id: s.dataset.testid || s.getAttribute('aria-label') || '?', gap: [c.columnGap, c.rowGap].every((g) => g === 'normal' || parseFloat(g) === 0),
      cells: +s.dataset.cells, kids: [...s.children].filter(vis).length,
      cardKids: [...s.children].filter((k) => vis(k) && (parseFloat(getComputedStyle(k).borderTopLeftRadius) || 0) > 0).length }; });
  /* a hand-made figure ROW (not cards): three or more siblings in a grid or flex row, each holding a figure */
  const rows = new Map();
  for (const f of figs) {
    let k = f;
    for (let i = 0; k.parentElement && i < 4; i++) { const pc = getComputedStyle(k.parentElement);
      if ((pc.display.includes('grid') || pc.display.includes('flex')) && k.parentElement.children.length >= 3) break; k = k.parentElement; }
    const par = k.parentElement; if (!par || k.innerText.trim().length > 80) continue;
    if (!rows.has(par)) rows.set(par, new Set()); rows.get(par).add(k);
  }
  const plain = [];
  for (const [par, set] of rows) if (set.size >= 3 && !groups.has(par)) plain.push({ row: String(par.className).slice(0, 90) || par.tagName, n: set.size,
    texts: [...set].slice(0, 4).map((c) => c.innerText.replace(/\s+/g, ' ').trim().slice(0, 30)) });
  return { cards: out, plain, strips, wide: document.scrollingElement.scrollWidth > innerWidth + 1 };
}"""

res, report = [], {}
def check(n, ok, x=""):
    res.append(ok); print(("PASS " if ok else "FAIL ") + n + ("" if ok else f"  [{str(x)[:600]}]"), flush=True)

def views_of(pg):
    tl = pg.locator("main [role=tablist]").first
    if not tl.count(): return tl, []
    return tl, [re.sub(r"\s*\d+$", "", t.split("\n")[0]).strip() for t in tl.locator("[role=tab]").all_inner_texts()][:9]

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, phone in [(1440, 900, False), (390, 844, True)]:
        for tab in TABS:
            try: urllib.request.urlopen(f"{BASE}/__reset").read()
            except Exception: pass
            ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
            pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
            pg.goto(f"{BASE}/portal?tab={urllib.parse.quote(tab)}"); pg.wait_for_timeout(2600)
            pg.add_style_tag(content="[data-testid=update-available]{display:none!important}")
            if "?tab=" in pg.url and pg.locator("main").count() == 0:
                ctx.close(); continue
            tl, names = views_of(pg)
            if phone: names = names[:1]
            for n in (names or ["(single)"]):
                if n != "(single)" and not phone:
                    t = tl.locator("[role=tab]").filter(has_text=n).first
                    try:
                        if t.is_visible(): t.click(timeout=4000)
                        else: continue
                    except Exception: continue
                    pg.wait_for_timeout(1300)
                r = pg.evaluate(FIND)
                key = f"{w} {tab} / {n}"
                report[key] = r
                check(f"{key}: no figure drawn as a separate card", not r["cards"], r["cards"])
                check(f"{key}: no hand-made figure row beside the strip", not r["plain"], r["plain"])
                badS = [s for s in r["strips"] if not s["gap"] or s["cardKids"] or s["cells"] != s["kids"]]
                check(f"{key}: every strip one card, zero gap", not badS, badS)
                check(f"{key}: no sideways page", not r["wide"])
                if OUT and not phone:
                    pg.screenshot(path=os.path.join(OUT, re.sub(r"[^A-Za-z0-9]+", "-", f"{tab}-{n}").strip("-").lower() + ".png"))
                if OUT and phone and n == (names or ["(single)"])[0]:
                    pg.screenshot(path=os.path.join(OUT, "phone-" + re.sub(r"[^A-Za-z0-9]+", "-", tab).strip("-").lower() + ".png"))
            check(f"{w} {tab}: no page error", not errs, errs)
            ctx.close()
    b.close()
if os.environ.get("REPORT"): json.dump(report, open(os.environ["REPORT"], "w"), indent=1)
print(f"{sum(res)}/{len(res)} passed")
sys.exit(0 if all(res) else 1)

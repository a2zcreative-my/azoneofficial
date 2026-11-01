"""PACKAGE CLEAR SELECTION (v1.246.1) - the owner, 01-11-2026: "when I click
on Clear selection, the desc was not clear off also. this is incorrect!"

Create quotation -> pick a package -> its line, inclusions and discount fill
the form -> Clear selection -> they leave the form (one blank line, discount
0), and the line typed BEFORE applying with "Add after them" comes back.

Server: ROLE=ceo node tests/browser/serve.mjs out 4208
    xvfb-run -a python3 tests/browser/package-clear.py
"""
from playwright.sync_api import sync_playwright
import sys, urllib.request

res = []
def check(n, c, x=""): res.append(("PASS " if c else "FAIL ") + n + (f" - {x}" if x and not c else ""))
PORT = 4208

def open_create(b):
    urllib.request.urlopen(f"http://127.0.0.1:{PORT}/__reset").read()
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/portal"); pg.wait_for_timeout(2500)
    pg.get_by_role("button", name="Sales", exact=True).filter(visible=True).first.click(); pg.wait_for_timeout(1800)
    pg.get_by_role("button", name="Create document").filter(visible=True).first.click(); pg.wait_for_timeout(1500)
    return ctx, pg, errs

def form_text(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('input,textarea')].filter(e => e.offsetParent).map(e => e.value).join(' | ')""")

with sync_playwright() as p:
    b = p.chromium.launch()
    # 1. empty form -> apply -> clear
    ctx, pg, errs = open_create(b)
    pick = pg.get_by_label("Package (optional)")
    check("1 the package picker is on the Create quotation form", pick.count() > 0)
    pick.select_option("71"); pg.wait_for_timeout(800)
    t = form_text(pg)
    check("2 applying fills the line and its inclusions", "Fixture video content" in t and "Fixture concept line" in t, t[:200])
    check("3 the applied bar shows", pg.get_by_text("Package applied: Fixture Video Pack").count() > 0)
    pg.get_by_role("button", name="Clear selection").click(); pg.wait_for_timeout(800)
    t = form_text(pg)
    check("4 Clear selection removes the line name", "Fixture video content" not in t, t[:200])
    check("5 Clear selection removes the description (inclusions)", "Fixture concept line" not in t and "Fixture editing line" not in t, t[:200])
    check("6 the applied bar is gone", pg.get_by_text("Package applied:").count() == 0)
    check("7 the package discount is taken back out", "50.00" not in t and "50" not in t.split(" | "), t[:300])
    check("8 the form keeps one blank line to type into", pg.get_by_placeholder("Description").count() >= 1 or "Add line" in pg.content())
    check("9 a toast says what happened", pg.get_by_text("Package cleared").count() > 0)
    check("10 no page errors", not errs, "; ".join(errs)[:200])
    ctx.close()
    # 2. edited after applying -> asks first; Cancel keeps the lines
    ctx, pg, errs = open_create(b)
    pg.get_by_label("Package (optional)").select_option("71"); pg.wait_for_timeout(800)
    name = pg.locator("input[value='Fixture video content']").first
    name.fill("Fixture video content EDITED"); pg.wait_for_timeout(300)
    pg.get_by_role("button", name="Clear selection").click(); pg.wait_for_timeout(600)
    dlg = pg.get_by_role("dialog").filter(has_text="Remove the package lines?")
    check("11 edited lines: Clear asks first", dlg.count() > 0)
    if dlg.count():
        dlg.get_by_role("button", name="Cancel").click(); pg.wait_for_timeout(500)
    check("12 Cancel keeps the edited lines and the package", "EDITED" in form_text(pg) and pg.get_by_text("Package applied:").count() > 0)
    pg.get_by_role("button", name="Clear selection").click(); pg.wait_for_timeout(600)
    pg.get_by_role("dialog").get_by_role("button", name="Clear package").click(); pg.wait_for_timeout(700)
    check("13 confirming removes them", "EDITED" not in form_text(pg) and "Fixture concept line" not in form_text(pg))
    ctx.close()
    b.close()

for r in res: print(r)
fails = [r for r in res if r.startswith("FAIL")]
print(f"package-clear: {len(res) - len(fails)} of {len(res)} passed")
sys.exit(1 if fails else 0)

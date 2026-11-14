"""v1.273.0 - deposit billing on screen (the CEO, 10-11-2026: "Build deposit
billing"; any % or amount, service quotations only).

What the server decides is proven by direct request in tests/deposit-billing.mjs.
Here: a half-invoiced service quotation says "Partly invoiced · 50% · RM
2,250.00 left" on its row; it offers Invoice part and Invoice balance; Invoice
balance posts no amount (the server bills what is left); Invoice part asks
for a percent or an amount and posts share_bp or amount_cents; anything else
posts nothing; on a phone the row fits without a sideways page.

Servers (servers):
    ROLE=ceo DEPOSIT=1 node tests/browser/serve.mjs out 4263
Invented people only."""
import json, urllib.request
import re
from playwright.sync_api import sync_playwright

PORT = 4263
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def posts():
    return [x for x in json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/__payments").read())["posts"] if x["path"].endswith("/convert")]


def sales_view(pg, wide, short):
    """v1.292.0 (Sales Workspace 4.0) - a Sales view: the tab on a wide screen, the Views selector on a phone"""
    t = pg.get_by_test_id("sales-tabs").get_by_role("tab", name=wide, exact=True)
    if t.count() and t.first.is_visible():
        t.first.click()
    else:
        pg.get_by_test_id("view-switch").filter(visible=True).first.click(); pg.wait_for_timeout(250)
        pg.get_by_role("menuitemradio", name=re.compile("^" + re.escape(short))).first.click()


def open_more(r):
    """v1.292.0 (Sales Workspace 4.0) - a document row keeps one action; the rest are under its ⋯ menu, opened here"""
    m = r.get_by_test_id("row-more")
    if r.page.get_by_test_id("row-menu").count() and m.count() and m.first.get_attribute("aria-expanded") != "true":
        r.page.keyboard.press("Escape"); r.page.wait_for_timeout(150)  # another row's menu is open: close it first, as a person would
    if m.count() and m.first.get_attribute("aria-expanded") != "true":
        m.first.click(); r.page.wait_for_timeout(250)
    return r

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(1440, 1000, "desktop"), (402, 874, "phone")]:
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}/__reset").read()
        ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{PORT}/portal?tab=Sales"); pg.wait_for_timeout(2600)
        pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
        sales_view(pg, "Quotations & Invoices", "Documents"); pg.wait_for_timeout(1200)
        chip = pg.get_by_test_id("qt-partly").first
        check(f"{tag}: the half-invoiced quotation says Partly invoiced, 50%, RM 2,250.00 left", chip.count() == 1 and "Partly invoiced" in chip.inner_text() and "50%" in chip.inner_text() and "2,250.00" in chip.inner_text(), chip.inner_text() if chip.count() else "no chip")
        bal = pg.get_by_role("button", name="Invoice balance RM 2,250.00").first
        qrow = lambda: pg.locator("[role=row]").filter(has=pg.get_by_test_id("qt-partly")).first
        open_more(qrow()); part = pg.get_by_role("button", name="Invoice part").first
        check(f"{tag}: it offers Invoice balance and Invoice part", bal.count() == 1 and part.count() == 1)
        # v1.300.0 (the CEO, 13-11-2026: "only 1 invoice appear recorded while the other one was not appear")
        both = pg.locator("[role=row]").filter(has_text="QT-AZOO091126-1").get_by_test_id("qt-invoiced")
        bt = both.first.inner_text() if both.count() else ""
        check(f"{tag}: a quotation billed in two invoices names BOTH, oldest first", "INV-AZOO091126-1" in bt and "INV-AZOO111126-1" in bt and bt.index("INV-AZOO091126-1") < bt.index("INV-AZOO111126-1") and "(2)" in bt, bt)
        check(f"{tag}: no sideways page", pg.evaluate("document.scrollingElement.scrollWidth <= window.innerWidth + 1"))
        bal.scroll_into_view_if_needed(); bal.click(); pg.wait_for_timeout(900)
        pc = posts()
        check(f"{tag}: Invoice balance posts no amount - the server bills what is left", pc and pc[-1]["body"] == {}, pc)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        open_more(qrow()); part = pg.get_by_role("button", name="Invoice part").first
        part.scroll_into_view_if_needed(); part.click(); pg.wait_for_timeout(500)
        dlg = pg.get_by_role("dialog").last
        check(f"{tag}: the dialog says what is left and asks for a percent or an amount", "2,250.00" in dlg.inner_text() and "percent" in dlg.inner_text().lower(), dlg.inner_text()[:300])
        dlg.locator("input").first.fill("50%")
        dlg.get_by_role("button", name="Create invoice").click(); pg.wait_for_timeout(900)
        pc = posts()
        check(f"{tag}: 50% posts share_bp 5000", pc and pc[-1]["body"] == {"share_bp": 5000}, pc[-1:] if pc else pc)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        n = len(posts())
        open_more(qrow()); part = pg.get_by_role("button", name="Invoice part").first
        part.click(); pg.wait_for_timeout(500)
        dlg = pg.get_by_role("dialog").last
        dlg.locator("input").first.fill("1,125.50")
        dlg.get_by_role("button", name="Create invoice").click(); pg.wait_for_timeout(900)
        pc = posts()
        check(f"{tag}: RM 1,125.50 posts amount_cents 112550", len(pc) == n + 1 and pc[-1]["body"] == {"amount_cents": 112550}, pc[-1:])
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        n = len(posts())
        open_more(qrow()); pg.get_by_role("button", name="Invoice part").first.click(); pg.wait_for_timeout(500)
        dlg = pg.get_by_role("dialog").last
        dlg.locator("input").first.fill("half")
        dlg.get_by_role("button", name="Create invoice").click(); pg.wait_for_timeout(700)
        check(f"{tag}: a word that is not a percent or an amount posts nothing", len(posts()) == n)
        check(f"{tag}: no page errors", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\ndeposit-billing: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

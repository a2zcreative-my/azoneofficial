"""ACCOUNTING WORKSPACE 5.0 (v1.314.0), Phase A - in a browser (the CEO's
"Approved as per recommendations both", 15-11-2026;
claude/ACCOUNTING-WORKSPACE-5.0-BLUEPRINT.md). The four tabs and their
addresses, the words that say what the books are (arithmetic, cash basis,
combined - not consolidated), the trial balance band, the Balance Sheet still
not supported, Close month only on a month whose checks passed, the phone's
view switch, and the eight widths with no sideways page. The fixture's
figures are invented (tests/browser/fixture.mjs).

Servers: 4177 ceo
"""
from playwright.sync_api import sync_playwright
import re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO = 4177
VIEWS = ["overview", "ledger", "reports", "close"]
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, w=1440, h=1000, view=None):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{CEO}/portal?tab=Accounting" + (f"&view={view}" if view else "")); pg.wait_for_timeout(3500)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None

def main_text(pg):
    return pg.locator("main").inner_text()

with sync_playwright() as p:
    b = p.chromium.launch()

    ctx, pg, errs = open_page(b)
    tabs = [t.strip() for t in pg.get_by_role("tab").filter(visible=True).all_inner_texts()]
    check("four tabs in the reference's order", tabs == ["Overview", "General Ledger", "Financial Reports", "Month-End & Audit"], tabs)
    check("arriving writes view=overview", view_of(pg) == "overview", pg.url)
    for k, n in [("ledger", "General Ledger"), ("reports", "Financial Reports"), ("close", "Month-End & Audit")]:
        pg.get_by_role("tab", name=n, exact=True).click(); pg.wait_for_timeout(1200)
        check(f"the {n} tab writes view={k}", view_of(pg) == k, pg.url)
    pg.go_back(); pg.wait_for_timeout(1200)
    check("Back returns to Financial Reports", view_of(pg) == "reports", pg.url)
    ctx.close()
    check("no page error (tabs)", not errs, errs)

    ctx, pg, errs = open_page(b, view="overview")
    t = main_text(pg)
    check("Trial Balance Status: debits = credits, arithmetic only, with the exceptions beside it", "Trial Balance Status" in t and "arithmetic only" in t and "exception(s) to check" in t, t[:400])
    check("Money In and Money Out are labelled cash basis", "Money In (cash basis)" in t and "Money Out (cash basis)" in t)
    check("Posting Exceptions counts movements, unbalanced and twice-posted - not accounts in use", "not in the books" in t and "accounts in use" not in t)
    check("the chart and the checks say what they are", "not recognised income and expenses" in t and "does not prove the books are complete" in t)
    ctx.close()
    check("no page error (Overview)", not errs, errs)

    ctx, pg, errs = open_page(b, view="reports")
    t = main_text(pg)
    check("reports: combined, one ledger, not a consolidated statement (AC-4)", "AZ ONE OFFICIAL + A2Z CREATIVE MARKETING" in t and "not a consolidated statement" in t, t[:500])
    band = pg.get_by_test_id("tb-totals")
    check("the trial balance band: Total Debit, Total Credit, Balanced (arithmetic)", band.count() == 1 and all(w in band.inner_text() for w in ["Total Debit", "Total Credit", "Balanced (arithmetic)"]), band.inner_text() if band.count() else "")
    pg.get_by_role("tab", name="Profit & Loss").first.click(); pg.wait_for_timeout(1500)
    check("the P&L is a cash-basis receipts-and-payments statement", "cash basis (receipts and payments)" in main_text(pg))
    pg.get_by_role("tab", name="Balance sheet").first.click(); pg.wait_for_timeout(900)
    check("the Balance Sheet stays not supported (AC-5)", pg.get_by_role("note", name="Balance sheet not supported").count() == 1)
    ctx.close()
    check("no page error (Reports)", not errs, errs)

    ctx, pg, errs = open_page(b, view="ledger")
    pg.get_by_label("Search accounts").first.fill("Pay"); pg.wait_for_timeout(600)
    check("a filtered chart never calls its sum the ledger total", "not the ledger total" in main_text(pg))
    ctx.close()

    ctx, pg, errs = open_page(b, view="close")
    pg.wait_for_timeout(1500)
    rows_close = pg.get_by_test_id("close-month").count()
    rows_review = pg.get_by_test_id("close-review").count()
    check("Close month only on a month whose checks passed (the fixture's month has a failing check)", rows_close == 0 and rows_review >= 1, f"close={rows_close} review={rows_review}")
    check("the screen still says nothing is locked", "Nothing is locked" in main_text(pg))
    ctx.close()
    check("no page error (Month-End)", not errs, errs)

    ctx, pg, errs = open_page(b, w=390)
    check("phone: the view switch, not the tab row", pg.locator('[data-testid="accounting-view-bar"]:visible').count() == 1 and pg.get_by_role("tab").filter(visible=True).count() == 0)
    pg.get_by_test_id("accounting-view-bar").get_by_test_id("view-switch").click(); pg.wait_for_timeout(300)
    pg.get_by_role("menuitemradio", name=re.compile("Financial Reports")).click(); pg.wait_for_timeout(1200)
    check("phone: the switch opens Financial Reports and writes the address", view_of(pg) == "reports", pg.url)
    ctx.close()

    for w in WIDTHS:
        bad = []
        for k in VIEWS:
            ctx, pg, errs = open_page(b, w=w, view=k)
            if not no_hscroll(pg): bad.append(k)
            if errs: bad.append(k + ":error")
            ctx.close()
        check(f"{w}px: no sideways page on any of the four views", not bad, bad)
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

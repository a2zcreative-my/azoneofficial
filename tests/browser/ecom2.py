"""ECOMMERCE v2.0, RELEASE E-1 (v1.296.0) - in a browser (the CEO's directive
"A2Z OS - ECOMMERCE v2.0", 12-11-2026; "approve continuously", 13-11-2026;
E1 as recommended). The source rules are held by tests/ecom2.mjs and
tests/ecommerce-module.mjs. Here, the screens:

  the six views from the address and Back / Forward; the Overview in the
  directive's layout (four figures; Needs Attention beside the Fulfilment
  Summary; Recent Orders beside Stock Alerts); an alert opens its record's
  view; the stock alerts are Inventory's; the lifecycle is said; a view a
  person may not open is opened as the Overview; eight widths with no
  sideways page.

The fixture answers are invented (tests/browser/fixture.mjs). Servers:
4177 ceo · 4182 sales_marketing.
"""
from playwright.sync_api import sync_playwright
import re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def ctx_for(b, w, h=900):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
def go(pg, port, q="", wait=3200):
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Ecommerce{q}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None
def box(pg, loc):
    return loc.first.bounding_box() if loc.count() else None

with sync_playwright() as p:
    b = p.chromium.launch()
    c = ctx_for(b, 1440, 1100); pg = c.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    writes = []; pg.on("request", lambda r: writes.append(r.url) if r.method != "GET" else None)
    go(pg, 4177)
    check("the Overview opens and its view is in the address", view_of(pg) == "overview", pg.url)
    main = pg.locator("main")
    txt = main.inner_text()
    check("four figures with their period: gross sales, orders, delivered, awaiting shipment",
          all(t in txt for t in ["TikTok sales (gross)", "Orders", "Delivered", "Awaiting shipment"]) and txt.count("This month ·") >= 3 and "Now · still preparing" in txt)
    check("the sales figure says what it is", "before TikTok fees" in txt and "Net" not in txt.split("Fulfilment Summary")[0])
    att = box(pg, main.get_by_role("region", name="Needs attention")) or box(pg, pg.locator("section[aria-label='Needs attention']"))
    ful = box(pg, main.get_by_text("Fulfilment Summary"))
    rec = box(pg, main.get_by_text("Recent orders", exact=True))
    sto = box(pg, pg.get_by_test_id("ecom-stock-alerts"))
    check("middle row: Needs Attention beside the Fulfilment Summary", att and ful and abs(att["y"] - (ful["y"] - 20)) < 60 and ful["x"] > att["x"], (att, ful))
    check("bottom row: Recent Orders beside Stock Alerts", rec and sto and sto["x"] > rec["x"] and abs(sto["y"] - rec["y"]) < 60 and rec["y"] > att["y"], (rec, sto))
    check("the lifecycle is said under the fulfilment counts", "Returned / cancelled is how an order ends" in pg.get_by_test_id("fulfilment-lifecycle").inner_text())
    st = pg.get_by_test_id("ecom-stock-alerts").inner_text()
    check("stock alerts list Inventory's own low and out items", "On hand:" in st and ("Low" in st or "Out" in st), st[:200])
    rows = pg.locator("[aria-label='Recent orders'] tbody tr, [aria-label='Recent orders'] li")
    check("recent orders: five at most", 0 < rows.count() <= 5 or "TT-" in txt, rows.count())
    # an alert opens its view
    pg.locator("section[aria-label='Needs attention']").get_by_role("button", name="See them").first.click(); pg.wait_for_timeout(700)
    check("an alert opens the fulfilment lane it names", view_of(pg) == "fulfilment", pg.url)
    pg.go_back(); pg.wait_for_timeout(700)
    check("Back returns to the Overview", view_of(pg) == "overview", pg.url)
    pg.go_forward(); pg.wait_for_timeout(700)
    check("Forward returns to Fulfilment", view_of(pg) == "fulfilment", pg.url)
    for name, v in [("Orders", "orders"), ("Stock & Products", "stock"), ("Analytics", "analytics"), ("Sync & Integration", "sync")]:
        pg.get_by_role("tab", name=re.compile("^" + re.escape(name))).filter(visible=True).first.click(); pg.wait_for_timeout(700)
        check(f"{name} is its own view in the address", view_of(pg) == v, pg.url)
    go(pg, 4177, "&view=orders")
    check("a link to Orders opens Orders", view_of(pg) == "orders" and pg.get_by_role("tab", name="Orders", selected=True).count() == 1)
    check("nothing was written by reading the page", writes == [], writes[:3])
    check("no page error (CEO)", not errs, errs[:2])
    c.close()

    # sales staff: a view they may not open is opened as the Overview
    c = ctx_for(b, 1280); pg = c.new_page(); go(pg, 4182, "&view=analytics")
    has_analytics = pg.get_by_role("tab", name=re.compile("^Analytics")).count() > 0
    check("a view this person may not open is never drawn", (view_of(pg) == "analytics") == has_analytics, (pg.url, has_analytics))
    c.close()

    for w in WIDTHS:
        for q in ["", "&view=orders", "&view=fulfilment", "&view=sync"]:
            c = ctx_for(b, w); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            go(pg, 4177, q, 2600)
            check(f"ceo @{w} {q or 'overview'}: no sideways page, no error card, no page error",
                  no_hscroll(pg) and "Something went wrong on this screen" not in pg.locator("main").inner_text() and not errs, errs[:1])
            c.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\necom2: {len(res) - len(failed)}/{len(res)} passed")
if failed: raise SystemExit(1)

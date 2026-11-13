"""v1.275.0 - the company weekly target counts every channel, on screen (the
CEO, 10-11-2026: "option 2" - company only, this week onward, every channel
the Dashboard counts).

What the server decides is proven by direct request in tests/weekly-dashboard.mjs.
Here: the Dashboard tile is "Company sales" with "% of target · all channels"
and "sales per working day"; the target & pace card says "all channels" (its
height kept, the parts in its title); the Sales weekly scorecard says the parts (invoices · TikTok · other) to a revenue reader; a
reader without revenue access is told what is counted, never the TikTok
amount; a person's own week still says Collected; no sideways page on a phone.

Servers (servers):
    ROLE=ceo CHANNELS=1 node tests/browser/serve.mjs out 4264
    ROLE=live_host CHANNELS=1 node tests/browser/serve.mjs out 4265
    ROLE=ceo node tests/browser/serve.mjs out 4231      (the rule before 10-11-2026)
Invented people only."""
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

PARTS = "This week · invoices RM 4,000.00 · TikTok RM 700.00 · other RM 165.00"

def open_page(b, port, w, h, tab=None):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal" + (f"?tab={tab}" if tab else "")); pg.wait_for_timeout(2800)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def no_sideways(pg):
    return pg.evaluate("document.scrollingElement.scrollWidth <= window.innerWidth + 1")

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(1440, 1000, "desktop"), (402, 874, "phone")]:
        # ---- the CEO: a revenue reader ----
        ctx, pg, errs = open_page(b, 4264, w, h)
        body = pg.inner_text("body")
        check(f"{tag}: the Dashboard tile is Company sales, the whole figure", "Company sales" in body and "RM 4,865.00" in body, body[:600])
        check(f"{tag}: ...its line says % of target · all channels", "32% of target · all channels" in body)
        check(f"{tag}: the pace says sales per working day", "sales per working day" in body)
        lines = [x.inner_text() for x in pg.get_by_test_id("company-basis").all()]
        card = pg.get_by_test_id("company-basis").first
        check(f"{tag}: the target & pace card says all channels, the parts in its title", card.count() == 1 and "all channels" in card.inner_text() and card.get_attribute("title") == PARTS, [lines, card.get_attribute("title") if card.count() else None])
        check(f"{tag}: no sideways page (Dashboard)", no_sideways(pg))
        # v1.292.0 (Sales Workspace 4.0, S5) - the weekly scorecard is Reports -> Consultant Performance & Weekly Target;
        # the month tiles are Reports -> Sales Performance: both are read
        pg.goto("http://127.0.0.1:4264/portal?tab=Sales&view=reports"); pg.wait_for_timeout(2800)
        body = pg.inner_text("body")
        pg.get_by_test_id("report-type").select_option("team"); pg.wait_for_timeout(1800)
        body += "\n" + pg.inner_text("body")
        pg.get_by_test_id("report-type").select_option("collected"); pg.wait_for_timeout(1500)  # the month's collected trend says what it leaves out
        body += "\n" + pg.inner_text("body")
        pg.get_by_test_id("report-type").select_option("team"); pg.wait_for_timeout(1500)
        lines = [x.inner_text() for x in pg.get_by_test_id("company-basis").all()]
        check(f"{tag}: the Sales weekly scorecard names the same parts", PARTS in lines, lines)
        check(f"{tag}: ...and says the company target counts every channel", "the company target counts every channel" in body)
        check(f"{tag}: ...a person's week still reads Collected = invoices", "Collected = invoices paid in full, by closer" in body)
        check(f"{tag}: ...the CEO/COO confirmation is named as invoices", "Invoices confirmed by CEO/COO" in body)
        check(f"{tag}: the Sales month tile says the weekly target adds TikTok", "the company weekly target add TikTok" in body)
        check(f"{tag}: no sideways page (Sales)", no_sideways(pg))
        check(f"{tag}: no page errors (CEO)", not errs, errs)
        ctx.close()

        # ---- a live host: no revenue access ----
        ctx, pg, errs = open_page(b, 4265, w, h)
        html = pg.content()
        check(f"{tag}: a reader without revenue access never gets the TikTok amount", "RM 700.00" not in html and "RM 165.00" not in html)
        check(f"{tag}: no page errors (live host)", not errs, errs)
        ctx.close()

        # ---- before 10-11-2026: the old words ----
        ctx, pg, errs = open_page(b, 4231, w, h)
        body = pg.inner_text("body")
        check(f"{tag}: a week measured on invoices keeps the word Collected", "Collected" in body and "Company sales" not in body and "all channels" not in body, body[:400])
        check(f"{tag}: no page errors (before)", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\ncompany-channels: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

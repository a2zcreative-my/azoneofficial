"""v1.281.0 - A2Z OS MINIMAL EXECUTIVE WORKSPACE, phase E3: the Sales
Overview in the photo's layout (the CEO approved the photo and all eight
decisions, 11-11-2026; claude/MINIMAL-EXECUTIVE-WORKSPACE-BLUEPRINT.md
sections 5.4 - 5.5). The source half is tests/executive-workspace.mjs.

Here, in a browser:
  the tabs say what waits behind them (documents to settle, payments for the
  CEO, follow-ups due), and on a phone the documents tab reads "Documents"
  and the main action "Create";
  the five figures are the photo's: Collected (Verified while the CEO
  verifies payments), Reported not verified, Outstanding, Open Quotations,
  Follow-ups due; the month's quotations and invoices are said in one line;
  Needs action lists the unpaid invoices and the follow-ups due, the overdue
  first, each with its one action - Report payment opens Payments with that
  invoice's sheet (the 1.272 rules), Follow up opens the customer's file;
  management on Everyone sees the company's week beside it, never on Mine,
  and a salesperson never; without verification the tile says Collected and
  a row offers Open, not Report payment; no sideways page; no page errors.

Servers (servers.txt): 4266 ROLE=coo PAYV=1 PAYDOCS=1 (the documents list's own
invoice is in Payments), 4262 ROLE=ceo OWNER=1 PAYV=1, 4261 ROLE=sales_marketing
PAYV=1, 4267 ROLE=coo. Invented people only."""
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def page(b, port, w, h):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales"); pg.wait_for_timeout(3000)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

TILES_JS = "() => [...document.querySelectorAll('[aria-label=\"Sales this month\"] [class*=kpi-tile_label]')].map(e => e.innerText.trim())"
def tab(pg, name): return pg.get_by_role("tab", name=name).first

with sync_playwright() as p:
    b = p.chromium.launch()
    # ================= the CEO, verification on =================
    ctx, pg, errs = page(b, 4262, 1440, 900)
    tiles = pg.evaluate(TILES_JS)
    check("the five figures are the photo's", tiles == ["Collected (Verified)", "Reported, not verified", "Outstanding", "Open Quotations", "Follow-ups due"], tiles)
    row = pg.locator("[aria-label='Sales this month']")
    check("Reported, not verified is what waits for the CEO (the Payments queue)", "RM 600.00" in row.inner_text() and "1 payment waits for the CEO" in row.inner_text(), row.inner_text()[:300])
    tops = {round(t.bounding_box()["y"]) for t in row.locator(":scope > *").all()}
    check("...five across on a laptop", len(tops) == 1, tops)
    check("the month's quotations and invoices are said in one line", "This month:" in pg.get_by_test_id("sales-month-line").inner_text())
    need = pg.get_by_test_id("needs-action")
    rows = need.locator("tbody tr")
    texts = [r.inner_text() for r in rows.all()]
    check("Needs action lists the unpaid invoices and the follow-ups due, with a count", rows.count() >= 2 and "Needs action" in need.inner_text() and f"({rows.count()})" in need.inner_text(), texts)
    check("...the overdue first", "overdue" in texts[0].lower() or "Overdue" in texts[0], texts)
    desc = lambda name: tab(pg, name).evaluate("e => { const id = e.getAttribute('aria-describedby'); return id ? document.getElementById(id).textContent.trim() : ''; }")
    docs_n = desc("Quotations & Invoices")
    pay_n = desc("Payments")
    inv_rows = [t for t in texts if t.startswith("INV")]
    check("the documents tab counts what waits behind it", any(ch.isdigit() for ch in docs_n), docs_n)
    check("the Payments tab counts the payments waiting for the CEO (its badge, read as '1 waiting')", pay_n == "1 waiting", pay_n)
    check("...and a tab's name stays its word, so 'Payments' finds it whatever waits", pg.get_by_role("tab", name="Payments", exact=True).count() == 1)
    check("an invoice Payments does not hold offers Open, never a Record payment that leads nowhere", need.locator("tbody tr").filter(has_text="INV-AZO200826-4").get_by_role("button", name="Open").count() == 1, texts)
    ctx.close()
    ctx, pg, errs = page(b, 4266, 1440, 900)
    need = pg.get_by_test_id("needs-action")
    # v1.285.0 (the CEO, 12-11-2026) - the COO's button requests Paid; the CEO verifies it
    rec = need.locator("tbody tr").filter(has_text="INV-AZO050926-3").get_by_role("button", name="Request paid")
    check("an unpaid invoice Payments holds offers Request paid (the COO, verification on)", rec.count() == 1, [r.inner_text() for r in need.locator("tbody tr").all()])
    rec.click(); pg.wait_for_timeout(1500)
    dlg = pg.get_by_role("dialog").last
    check("...which opens Payments with that invoice's report sheet", tab(pg, "Payments").get_attribute("aria-selected") == "true" and dlg.count() == 1 and "INV-AZO050926-3" in dlg.inner_text(), dlg.inner_text()[:200] if dlg.count() else "none")
    check("...still asking for the reference (then the proof) before it moves on (1.272 rules)", dlg.get_by_role("button", name="Next: proof").count() == 1 and dlg.get_by_role("button", name="Next: proof").is_disabled())
    dlg.get_by_role("button", name="Close").first.click(); pg.wait_for_timeout(400)
    tab(pg, "Overview").click(); pg.wait_for_timeout(800)
    fu = pg.get_by_test_id("needs-action").get_by_role("button", name="Follow up").first
    check("a follow-up due offers Follow up", fu.count() == 1)
    fu.click(); pg.wait_for_timeout(1500)
    check("...which opens the customer's file", pg.get_by_role("dialog").count() >= 1, pg.get_by_role("dialog").last.inner_text()[:150] if pg.get_by_role("dialog").count() else "none")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(600)
    check("management on Everyone sees the company's week beside it", pg.get_by_test_id("sales-performance").count() == 1)
    pg.get_by_role("radio", name="Mine").or_(pg.get_by_role("button", name="Mine", exact=True)).first.click(); pg.wait_for_timeout(1500)
    check("...never on Mine (the company figure is not 'your sales')", pg.get_by_test_id("sales-performance").count() == 0)
    check("no sideways page (desktop)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    check("no page errors (desktop)", not errs, errs)
    ctx.close()

    ctx, pg, errs = page(b, 4262, 390, 844)
    check("on a phone the documents tab reads Documents, with its count", tab(pg, "Documents").count() == 1 and tab(pg, "Documents").is_visible())
    check("...and the main action reads Create", pg.get_by_role("button", name="Create", exact=True).is_visible())
    xs = {round(t.bounding_box()["x"]) for t in pg.locator("[aria-label='Sales this month'] > *").all()}
    check("...the figures two across", len(xs) == 2, xs)
    wells = pg.evaluate("() => [...document.querySelectorAll('[aria-label=\"Sales this month\"] [class*=kpi-tile_well]')].filter(e => e.offsetParent).length")
    check("...each with its icon well, as the photo", wells == 5, wells)
    pg.get_by_test_id("needs-action").scroll_into_view_if_needed()
    check("Needs action reads as cards on a phone (no table head)", pg.evaluate("getComputedStyle(document.querySelector('[data-testid=needs-action] thead')).display") == "none")
    check("no sideways page (CEO phone)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    check("no page errors (CEO phone)", not errs, errs)
    ctx.close()

    # ================= a salesperson =================
    ctx, pg, errs = page(b, 4261, 1440, 900)
    tiles = pg.evaluate(TILES_JS)
    check("a salesperson is not shown the CEO's payment queue tile", "Reported, not verified" not in tiles, tiles)
    check("...nor the company's week", pg.get_by_test_id("sales-performance").count() == 0)
    need = pg.get_by_test_id("needs-action")
    check("...and their invoices offer Open, never Report payment (the invoice_payment roles only)", need.get_by_role("button", name="Report payment").count() == 0 and need.get_by_role("button", name="Report remaining payment").count() == 0 and need.get_by_role("button", name="Mark paid").count() == 0 and need.get_by_role("button", name="Request paid").count() == 0)
    check("no page errors (salesperson)", not errs, errs)
    ctx.close()

    # ================= the COO, verification off =================
    ctx, pg, errs = page(b, 4267, 1440, 900)
    tiles = pg.evaluate(TILES_JS)
    check("verification off: the tile says Collected, not Verified", tiles[:1] == ["Collected"] and "Reported, not verified" not in tiles, tiles)
    check("...and a row offers Open, not Report payment", pg.get_by_test_id("needs-action").get_by_role("button", name="Report payment").count() == 0 and pg.get_by_test_id("needs-action").get_by_role("button", name="Report remaining payment").count() == 0 and pg.get_by_test_id("needs-action").get_by_role("button", name="Request paid").count() == 0)
    check("no page errors (COO)", not errs, errs)
    ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nsales-e3: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

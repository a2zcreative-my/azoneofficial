"""SALES COMMAND CENTER, PHASE 5: COLLECTIONS (v1.401.0) - in a browser.

  Payments      a Collections tab: unpaid invoices with the balance by verified money, a reported payment
                beside it ("waiting for the CEO"), the age, the collector and the next collection action in
                words (Overdue / No collection follow-up / Due today); age pills; Mine by default, Everyone
                for management; Book follow-up in a drawer; WhatsApp with the reminder written
  Documents     More -> Outstanding opens Payments -> Collections
  Pipeline      a won deal shows its payment status
  Phones        no sideways page at 390; BM words

The fixture's records are invented (tests/browser/fixture.mjs, "/staff/collections").
Servers: ROLE=ceo 4177 · ROLE=sales_marketing 4182   (node tests/browser/serve.mjs out <port>)
Screenshots go to SHOTS (default /tmp/collections-shots).
"""
from playwright.sync_api import sync_playwright
import os, re, urllib.parse

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, SALES = 4177, 4182
SHOTS = os.environ.get("SHOTS", "/tmp/collections-shots"); os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, port, view, w=1440, h=1000, lang="en"):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    ctx.add_init_script(f"try{{localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang','{lang}')}}catch(e){{}}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales&view={view}"); pg.wait_for_timeout(4000)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def to_collections(pg):
    t = pg.get_by_test_id("pay-tab-collections").filter(visible=True)
    if t.count(): t.first.click()
    else:
        pg.get_by_test_id("pay-tab-switch").filter(visible=True).first.click(); pg.wait_for_timeout(300)
        pg.get_by_test_id("pay-tab-menu-collections").filter(visible=True).first.click()
    pg.wait_for_timeout(1200)

row = lambda pg, num: pg.get_by_test_id("col-table").locator("tr, [role=row]").filter(has_text=num)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    ctx, pg, errs = open_page(b, CEO, "payments")
    to_collections(pg)
    check("Payments has a Collections tab", pg.get_by_test_id("collections").count() == 1)
    sm = pg.get_by_test_id("col-summary").inner_text()
    check("the summary counts verified money, and says a reported payment is not paid", "still owed by verified money" in sm and "not counted as paid" in sm, sm)
    check("Mine is the default: only the CEO's own invoices", pg.get_by_test_id("col-scope-mine").get_attribute("aria-pressed") == "true" and pg.get_by_test_id("col-flag").count() == 2)
    pg.get_by_test_id("col-scope-all").click(); pg.wait_for_timeout(1200)
    check("Everyone lists every unpaid invoice", pg.get_by_test_id("col-flag").count() == 4)
    r3, r4, r72 = row(pg, "INV-AZO050926-3"), row(pg, "INV-AZO200826-4"), row(pg, "INV-AZO010526-72")
    check("a reported payment waits beside the balance", "5,900.00" in r3.inner_text() and "400.00 waiting for the CEO" in r3.inner_text(), r3.inner_text()[:200])
    check("no collection follow-up is amber, in words, with Book follow-up", r3.locator("[data-flag=no_next]").count() == 1 and r3.get_by_test_id("col-book").count() == 1)
    check("an overdue follow-up is red, in words", r4.locator("[data-flag=overdue]").count() == 1 and "Overdue" in r4.inner_text())
    check("a follow-up due today is blue", r72.locator("[data-flag=today]").count() == 1)
    check("the age is shown, with past due", "140 days" in r72.inner_text() and "past due" in r72.inner_text())
    check("the collector is named", "Hakim Rosli" in r72.inner_text())
    wa = r3.get_by_test_id("col-wa").get_attribute("href") or ""
    txt = urllib.parse.unquote(wa)
    check("WhatsApp opens with the reminder: the invoice, the verified balance and the issuer's bank", wa.startswith("https://wa.me/60123456789") and "INV-AZO050926-3" in txt and "5,900.00" in txt and "A/C" in txt, txt[:200])
    pg.screenshot(path=f"{SHOTS}/01-ceo-collections-everyone-1440.png", full_page=False)

    pg.get_by_test_id("col-bucket-90_plus").click(); pg.wait_for_timeout(400)
    check("the 90+ pill narrows to the oldest", pg.get_by_test_id("col-flag").count() == 1 and row(pg, "INV-AZO010526-72").count() == 1)
    pg.get_by_test_id("col-bucket-any").click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("col-flag-filter").select_option("no_next"); pg.wait_for_timeout(300)
    check("No collection follow-up narrows to those with nothing booked", pg.get_by_test_id("col-flag").count() == 1)
    pg.get_by_test_id("col-flag-filter").select_option(""); pg.wait_for_timeout(300)

    r3.get_by_test_id("col-book").click(); pg.wait_for_timeout(700)
    check("Book follow-up opens the drawer, with who follows up for a manager", pg.get_by_test_id("col-book-date").count() == 1 and pg.get_by_test_id("col-book-owner").count() == 1 and "never changes the invoice" in pg.locator("body").inner_text())
    pg.screenshot(path=f"{SHOTS}/02-ceo-book-followup-1440.png", full_page=False)
    pg.get_by_test_id("col-book-save").click(); pg.wait_for_timeout(1200)
    check("booking says so", "Collection follow-up booked" in pg.locator("body").inner_text())
    check("no page errors (CEO)", not errs, errs[:2])
    ctx.close()

    # Documents -> More -> Outstanding
    ctx, pg, errs = open_page(b, CEO, "documents")
    pg.get_by_test_id("docs-more").filter(visible=True).first.select_option("outstanding"); pg.wait_for_timeout(1800)
    check("Documents -> More -> Outstanding opens Payments -> Collections", "view=payments" in pg.url and pg.get_by_test_id("collections").count() == 1, pg.url)
    ctx.close()

    # a won deal's payment
    ctx, pg, errs = open_page(b, CEO, "pipeline")
    pg.get_by_test_id("pipeline-scope-all").click(); pg.wait_for_timeout(1000)
    pg.get_by_test_id("pipeline-layout-list").click(); pg.wait_for_timeout(500)
    pg.locator("[data-testid=pipeline-strip] button").filter(has_text="Won this month").click(); pg.wait_for_timeout(500)
    pg.get_by_test_id("pipeline-table").get_by_text("Hari Raya photoshoot").first.click(); pg.wait_for_timeout(1500)
    dp = pg.get_by_test_id("deal-payment")
    check("a won deal shows its payment: Paid (CEO verified)", dp.count() == 1 and "Paid (CEO verified)" in dp.inner_text(), dp.inner_text() if dp.count() else "none")
    pg.screenshot(path=f"{SHOTS}/03-ceo-won-deal-payment-1440.png", full_page=False)
    ctx.close()

    # a consultant
    ctx, pg, errs = open_page(b, SALES, "payments")
    to_collections(pg)
    check("a consultant sees their own invoices, with no Everyone switch", pg.get_by_test_id("col-scope").count() == 0 and pg.get_by_test_id("col-flag").count() == 2)
    r3 = row(pg, "INV-AZO050926-3")
    r3.get_by_test_id("col-book").click(); pg.wait_for_timeout(600)
    check("a consultant books for themselves (no owner choice)", pg.get_by_test_id("col-book-owner").count() == 0 and pg.get_by_test_id("col-book-date").count() == 1)
    check("no page errors (consultant)", not errs, errs[:2])
    ctx.close()

    # phone + BM
    ctx, pg, errs = open_page(b, CEO, "payments", w=390, h=860)
    to_collections(pg)
    check("390px: no sideways page", no_hscroll(pg))
    pg.screenshot(path=f"{SHOTS}/04-ceo-390-collections.png", full_page=True)
    ctx.close()
    ctx, pg, errs = open_page(b, CEO, "payments", lang="ms")
    to_collections(pg)
    t = pg.get_by_test_id("collections").inner_text()
    check("BM words", "Kutipan" in t and "Tiada susulan kutipan" in t and "menunggu CEO" in t, t[:300])
    ctx.close()
    b.close()

bad = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(bad)}/{len(res)} passed")
raise SystemExit(1 if bad else 0)

"""SALES COMMAND CENTER, PHASE 4: QUOTATIONS & INVOICES (v1.400.0) - in a browser.

  Documents    each open quotation says where it stands: Open N days / Accepted · rev N / Expires in N days /
               Expired, and Follow-up booked or No follow-up under it; four filters narrow to them;
               a search reaches documents older than the newest 200; Load 25 older pages the rest
  Create       the customer is picked by searching every customer (no list cut at 300); a quotation for a
               customer with an open deal offers "Deal (optional)"; Create quotation on a deal arrives with
               that deal chosen
  Phones       no sideways page at 390 on Documents and Create

The fixture's records are invented (tests/browser/fixture.mjs, "qstate", "/staff/docs/more").
Servers: ROLE=ceo QSTATE=1 4185 · ROLE=sales_marketing 4182   (node tests/browser/serve.mjs out <port>)
Screenshots go to SHOTS (default /tmp/quotations-shots).
"""
from playwright.sync_api import sync_playwright
import os, re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

QS, SALES = 4185, 4182
SHOTS = os.environ.get("SHOTS", "/tmp/quotations-shots"); os.makedirs(SHOTS, exist_ok=True)
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

def row(pg, num):
    return pg.locator("[data-record^='document:']").filter(has_text=num)

def status_select(pg):
    return pg.locator("select:has(option[value=expired])").filter(visible=True).first

def open_create(pg):
    btn = pg.get_by_role("button", name=re.compile("^(Create document|Create)$")).filter(visible=True)
    btn.first.click(); pg.wait_for_timeout(900)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    ctx, pg, errs = open_page(b, QS, "documents")
    pg.get_by_test_id("docs-tab-QT").filter(visible=True).first.click(); pg.wait_for_timeout(700)
    r81, r82, r83, r84 = (row(pg, n) for n in ["QT-AZO010926-81", "QT-AZO020926-82", "QT-AZO030926-83", "QT-AZO040926-84"])
    st = lambda r: r.locator("[data-testid=qt-state]").get_attribute("data-state") if r.count() else None
    check("an open quotation says how long it has been open", st(r81) == "open" and re.search(r"Open \d+ days", r81.inner_text()), r81.inner_text()[:200] if r81.count() else "missing")
    check("…and that no follow-up is booked", r81.locator("[data-testid=qt-followup][data-booked='0']").count() == 1 and "No follow-up" in r81.inner_text())
    check("a quotation past its validity says Expired", st(r82) == "expired" and "Expired" in r82.inner_text())
    check("one about to expire says so, with its booked follow-up", st(r83) == "expiring" and "Expires in 3 days" in r83.inner_text() and "Follow-up booked" in r83.inner_text(), r83.inner_text()[:200] if r83.count() else "")
    check("an accepted quotation names the revision accepted, and asks for no follow-up", st(r84) == "accepted" and "Accepted · rev 2" in r84.inner_text() and r84.locator("[data-testid=qt-followup]").count() == 0)
    pg.screenshot(path=f"{SHOTS}/01-ceo-quotation-states-1440.png", full_page=False)

    sel = status_select(pg)
    opts = sel.locator("option").all_inner_texts()
    check("four quotation filters", all(o in opts for o in ["Quotations needing a follow-up", "Accepted, not invoiced", "Expiring within 7 days", "Expired quotations"]), opts)
    for val, want, nots in [("expired", "82", ["81", "83", "84"]), ("needs_followup", "81", ["82", "83", "84"]), ("accepted", "84", ["81", "82", "83"]), ("expiring", "83", ["81", "82", "84"])]:
        sel.select_option(val); pg.wait_for_timeout(400)
        check(f"filter {val}: shows QT-{want} and not the others", row(pg, f"0926-{want}").count() == 1 and all(row(pg, f"0926-{x}").count() == 0 for x in nots))
    sel.select_option("expired"); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{SHOTS}/02-ceo-filter-expired-1440.png", full_page=False)
    sel.select_option("all"); pg.wait_for_timeout(300)

    pg.get_by_test_id("docs-tab-all").filter(visible=True).first.click(); pg.wait_for_timeout(500)
    shown = lambda: int(re.search(r"of (\d+) documents", pg.locator("main").inner_text()).group(1))
    before = shown()
    pg.get_by_test_id("docs-older").click(); pg.wait_for_timeout(1500)
    check("Load 25 older adds the next 25 documents from the server", shown() == before + 25, f"{before} -> {shown()}")
    pg.get_by_test_id("docs-older").click(); pg.wait_for_timeout(1500)
    check("…and says when that is every document", shown() == before + 40 and pg.get_by_test_id("docs-older-end").count() == 1, f"{shown()}")
    pg.screenshot(path=f"{SHOTS}/03-ceo-older-documents-1440.png", full_page=False)
    ctx.close()

    ctx, pg, errs = open_page(b, QS, "documents")
    pg.locator("input[type=search][aria-label='Search documents']").filter(visible=True).first.fill("OLD-007"); pg.wait_for_timeout(1600)
    check("a search finds a document older than the newest 200", row(pg, "QT-OLD-007").count() == 1)
    check("no page errors (documents)", not errs, errs[:2])
    ctx.close()

    # ---- the Create form ----
    ctx, pg, errs = open_page(b, QS, "documents")
    open_create(pg)
    check("the customer is picked by searching, not from a list", pg.get_by_test_id("cust-picker-q").filter(visible=True).count() == 1
          and pg.locator("select[aria-label=Customer]").count() == 0)
    pg.get_by_test_id("cust-picker-q").filter(visible=True).first.fill("Aina"); pg.wait_for_timeout(1300)
    check("typing searches every customer", pg.get_by_test_id("cust-picker-52").count() == 1 and pg.get_by_test_id("cust-picker-walkin").count() == 1)
    pg.screenshot(path=f"{SHOTS}/04-ceo-customer-search-1440.png", full_page=False)
    pg.get_by_test_id("cust-picker-52").click(); pg.wait_for_timeout(1500)
    check("the chosen customer is shown, with Change", "Aina Boutique (Melaka)" in pg.get_by_test_id("cust-picker-chosen").inner_text() and pg.get_by_test_id("cust-picker-change").count() == 1)
    deal = pg.get_by_test_id("doc-deal-select")
    check("a quotation for a customer with an open deal offers Deal (optional), not chosen", deal.count() == 1 and deal.input_value() == "" and "Raya live campaign" in deal.inner_text(), deal.inner_text() if deal.count() else "none")
    check("…and says it is never marked won by this", "never marked won" in pg.get_by_test_id("doc-deal").inner_text())
    deal.select_option("71"); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{SHOTS}/05-ceo-create-with-deal-1440.png", full_page=False)
    check("no page errors (create)", not errs, errs[:2])
    ctx.close()

    # ---- Create quotation from a deal ----
    ctx, pg, errs = open_page(b, QS, "pipeline")
    pg.get_by_test_id("pipeline-scope-all").click(); pg.wait_for_timeout(1000)
    pg.locator("[data-deal='72'] [data-testid=deal-open]").click(); pg.wait_for_timeout(1300)
    pg.get_by_test_id("deal-quote").click(); pg.wait_for_timeout(2500)
    d2 = pg.get_by_test_id("doc-deal-select")
    check("Create quotation on a deal opens the form with that deal chosen", d2.count() == 1 and d2.input_value() == "72", d2.input_value() if d2.count() else "none")
    pg.screenshot(path=f"{SHOTS}/06-ceo-quotation-from-deal-1440.png", full_page=False)
    ctx.close()

    # ---- a consultant ----
    ctx, pg, errs = open_page(b, SALES, "documents")
    open_create(pg)
    pg.get_by_test_id("cust-picker-q").filter(visible=True).first.fill("Aina"); pg.wait_for_timeout(1300)
    pg.get_by_test_id("cust-picker-52").click(); pg.wait_for_timeout(1500)
    check("a consultant is offered their own deal", "Raya live campaign" in (pg.get_by_test_id("doc-deal-select").inner_text() if pg.get_by_test_id("doc-deal-select").count() else ""))
    check("no page errors (consultant)", not errs, errs[:2])
    ctx.close()

    # ---- phones ----
    for view in ["documents"]:
        ctx, pg, errs = open_page(b, QS, view, w=390, h=860)
        check(f"390px {view}: no sideways page", no_hscroll(pg))
        pg.screenshot(path=f"{SHOTS}/07-ceo-390-{view}.png", full_page=True)
        open_create(pg)
        pg.get_by_test_id("cust-picker-q").filter(visible=True).first.fill("Aina"); pg.wait_for_timeout(1300)
        check("390px create: the customer search and its list fit", no_hscroll(pg) and pg.get_by_test_id("cust-picker-52").count() == 1)
        pg.screenshot(path=f"{SHOTS}/08-ceo-390-customer-search.png", full_page=False)
        ctx.close()
    ctx, pg, errs = open_page(b, QS, "documents", lang="ms")
    pg.get_by_test_id("docs-tab-QT").filter(visible=True).first.click(); pg.wait_for_timeout(600)
    t = pg.locator("main").inner_text()
    check("BM words", "Tamat tempoh" in t and "Tiada susulan" in t and "Diterima · sem 2" in t, t[:300])
    ctx.close()
    b.close()

bad = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(bad)}/{len(res)} passed")
raise SystemExit(1 if bad else 0)

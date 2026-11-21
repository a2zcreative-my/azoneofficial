"""SALES COMMAND CENTER, PHASE 3: THE SALES PIPELINE (v1.399.0) - in a browser.

  The views     seven, in the CEO's order: Overview, Leads & CRM, Sales Pipeline, Quotations &
                Invoices, Payments, Closed Sales, Reports; New deal is the one gold action here
  The page      one figure strip (open deals, pipeline value "not revenue", stuck, no next action,
                won and lost this month); the board's four open stages, or the list
  A card        its value says quoted or estimate; red for an overdue next action, amber for none
                or Stuck, blue for today; Move to on every card the person may move
  The deal      stages, value, owner, next action; Mark won (the evidence, or the override for the
                CEO, COO and CCO with a reason; a consultant without evidence is told why); Mark
                lost with a reason; Link quotation; history
  Suggested     a manager's list of open quotations, made only after a tick and a reason
  Phones        no sideways page 320-1440 (the board scrolls inside itself); light and dark; BM

The fixture's deals are invented (tests/browser/fixture.mjs, "deals").
Servers: ROLE=ceo 4177 · ROLE=sales_marketing 4182 · ROLE=super_admin 4184   (node tests/browser/serve.mjs out <port>)
Screenshots go to SHOTS (default /tmp/pipeline-shots).
"""
from playwright.sync_api import sync_playwright
import os, re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, SALES, ROOT = 4177, 4182, 4184
SHOTS = os.environ.get("SHOTS", "/tmp/pipeline-shots"); os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, port, w=1440, h=1000, lang="en", theme="light"):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    ctx.add_init_script(f"try{{localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang','{lang}');localStorage.setItem('azone-theme','{theme}')}}catch(e){{}}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales&view=pipeline"); pg.wait_for_timeout(4500)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def everyone(pg):
    pg.get_by_test_id("pipeline-scope-all").click(); pg.wait_for_timeout(1200)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    ctx, pg, errs = open_page(b, CEO)
    tabs = pg.get_by_test_id("sales-tabs").inner_text()
    order = ["Overview", "Leads & CRM", "Sales Pipeline", "Quotations & Invoices", "Payments", "Closed Sales", "Reports"]
    pos = [tabs.find(t) for t in order]
    check("seven views in the CEO's order", all(x >= 0 for x in pos) and pos == sorted(pos), tabs)
    check("the Sales Pipeline view is open from its address", pg.get_by_test_id("sales-pipeline").count() == 1)
    check("New deal is the gold action on the Pipeline", "New deal" in pg.get_by_test_id("sales-tabs").inner_text())
    check("the view opens on Mine", pg.get_by_test_id("pipeline-scope-mine").get_attribute("aria-pressed") == "true")
    everyone(pg)
    strip = pg.get_by_test_id("pipeline-strip")
    st = strip.inner_text()
    check("one figure strip: open deals, pipeline value, stuck, no next action, won and lost this month",
          strip.locator(":scope > *").count() == 6 and all(wd in st for wd in ["Open deals", "Pipeline value", "Stuck", "No next action", "Won this month", "Lost this month"]), st[:300])
    check("the pipeline value says it is not revenue", "Not revenue" in st, st[:300])
    check("the value is counted once: RM 11,800.00 = 4,500 + 2,800 quoted + 900 + 3,600 estimated", "11,800.00" in st, st[:300])
    hd = pg.get_by_test_id("pipeline-list").inner_text()
    check("the board says what is quoted and what is estimated, never both", "7,300.00 quoted" in hd and "4,500.00 estimated" in hd, hd[:200])
    check("the board takes the whole width while no deal is open", pg.get_by_test_id("pipeline-help").count() == 0 and pg.get_by_test_id("pipeline-col-negotiation").is_visible())
    board = pg.get_by_test_id("pipeline-board")
    check("the board has the four open stages", all(pg.get_by_test_id(f"pipeline-col-{s}").count() == 1 for s in ["new", "qualified", "proposal", "negotiation"]))
    check("closed deals are not on the board", pg.get_by_test_id("deal-card").count() == 4, pg.get_by_test_id("deal-card").count())
    late = pg.locator("[data-testid=deal-card][data-deal='71']")
    check("an overdue next action is red and in words", late.locator("[data-flag=late]").count() == 1 and "Overdue" in late.inner_text())
    check("no next action and Stuck are amber, in words", pg.locator("[data-deal='73'] [data-flag=no_next]").count() == 1 and pg.locator("[data-deal='74'] [data-flag=stuck]").count() == 1)
    check("due today is blue", pg.locator("[data-deal='72'] [data-flag=today]").count() == 1)
    check("a value says whether it is quoted or an estimate", pg.locator("[data-deal='71'] [data-basis=quotation]").count() == 1 and pg.locator("[data-deal='73'] [data-basis=estimate]").count() == 1)
    check("every card the CEO may move has Move to", pg.get_by_test_id("deal-move").count() == 4)
    check("cards can be dragged", pg.locator("[data-testid=deal-card][draggable=true]").count() == 4)
    pg.screenshot(path=f"{SHOTS}/01-ceo-board-1440.png", full_page=True)

    pg.locator("[data-deal='71'] [data-testid=deal-move]").select_option("proposal"); pg.wait_for_timeout(1200)
    check("Move to tells the person where it went", "Moved to Proposal sent" in pg.locator("body").inner_text())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

    pg.locator("[data-deal='71'] [data-testid=deal-open]").click(); pg.wait_for_timeout(1300)
    rec = pg.get_by_test_id("deal-record"); rt = rec.inner_text() if rec.count() else ""
    check("on the board, choosing a deal opens it in the drawer (the board keeps the whole width)", rec.count() == 1 and pg.get_by_role("dialog").filter(has_text="Raya live campaign").count() >= 1, rt[:200])
    check("the deal shows its stages, value, owner, next action and quotations",
          pg.get_by_test_id("deal-steps").count() == 1 and all(wd in rt for wd in ["Value", "Owner", "Next action", "QT-0042", "4,500.00"]), rt[:400])
    check("the deal's history is there", pg.get_by_test_id("deal-event").count() == 3)
    pg.screenshot(path=f"{SHOTS}/02-ceo-deal-selected-1440.png", full_page=False)

    pg.get_by_test_id("deal-won-btn").click(); pg.wait_for_timeout(600)
    body = pg.locator("body").inner_text()
    check("Won says it is not revenue, a payment or commission", "Won records the decision only" in body)
    check("with no accepted or invoiced quotation the CEO is asked why before it saves", pg.get_by_test_id("won-no-evidence").count() == 1 and pg.get_by_test_id("won-save").is_disabled())
    pg.get_by_test_id("won-reason").fill("Signed on paper at the meeting")
    check("…and may save once a reason is given", not pg.get_by_test_id("won-save").is_disabled())
    pg.screenshot(path=f"{SHOTS}/03-ceo-won-override-1440.png", full_page=False)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    if pg.get_by_role("button", name=re.compile("Discard")).count(): pg.get_by_role("button", name=re.compile("Discard")).first.click(); pg.wait_for_timeout(300)

    pg.get_by_test_id("deal-lost-btn").click(); pg.wait_for_timeout(500)
    check("Lost asks why: seven reasons", pg.get_by_test_id("lost-reasons").locator("input").count() == 7 and pg.get_by_test_id("lost-save").is_disabled())
    pg.get_by_test_id("lost-other").check(); pg.wait_for_timeout(200)
    check("Other needs words before it saves", pg.get_by_test_id("lost-save").is_disabled())
    pg.get_by_test_id("lost-price").check(); pg.wait_for_timeout(200)
    check("…a listed reason saves", not pg.get_by_test_id("lost-save").is_disabled())
    pg.screenshot(path=f"{SHOTS}/04-ceo-lost-1440.png", full_page=False)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    if pg.get_by_role("button", name=re.compile("Discard")).count(): pg.get_by_role("button", name=re.compile("Discard")).first.click(); pg.wait_for_timeout(300)

    pg.get_by_test_id("deal-link-btn").click(); pg.wait_for_timeout(500)
    check("Link quotation offers this customer's quotations with no deal", pg.get_by_test_id("link-49").count() == 1 and pg.get_by_test_id("link-save").is_disabled())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)  # the deal's drawer
    check("closing the deal leaves the board", pg.get_by_role("dialog").count() == 0 and pg.get_by_test_id("pipeline-board").count() == 1)

    pg.get_by_test_id("deal-suggest-open").click(); pg.wait_for_timeout(1200)
    # v1.406.0 - every quotation on no deal, grouped: invoiced (Won on its invoice), open, expired; nothing ticked from the board
    check("Suggested deals lists every quotation on no deal, grouped, and waits for a tick and a reason",
          pg.get_by_test_id("deal-suggest-row").count() == 4 and pg.locator("[data-testid=deal-suggest-group-open] [data-testid=deal-suggest-row]").count() == 2
          and pg.locator("[data-testid=deal-suggest-group-invoiced] [data-testid=deal-suggest-row]").count() == 1 and pg.locator("[data-testid=deal-suggest-group-expired] [data-testid=deal-suggest-row]").count() == 1
          and pg.get_by_test_id("deal-suggest-confirm").is_disabled())
    pg.get_by_test_id("deal-suggest-41").check(); pg.get_by_test_id("deal-suggest-reason").fill("Pipeline start")
    check("…then Make 1 deal is ready", not pg.get_by_test_id("deal-suggest-confirm").is_disabled() and "Make 1 deal" in pg.get_by_test_id("deal-suggest-confirm").inner_text())
    pg.screenshot(path=f"{SHOTS}/05-ceo-suggested-deals-1440.png", full_page=False)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    if pg.get_by_role("button", name=re.compile("Discard")).count(): pg.get_by_role("button", name=re.compile("Discard")).first.click(); pg.wait_for_timeout(300)

    pg.get_by_test_id("pipeline-layout-list").click(); pg.wait_for_timeout(800)
    check("the list shows the same open and recently closed deals", pg.get_by_test_id("pipeline-table").locator("[data-record^='deal:']").count() == 6 or pg.get_by_test_id("pipeline-table").locator("tbody tr").count() == 6,
          pg.get_by_test_id("pipeline-table").inner_text()[:200])
    pg.locator("[data-testid=pipeline-strip] button").filter(has_text="Won this month").click(); pg.wait_for_timeout(500)
    check("Won this month narrows to the won deal, with how it was won", "Hari Raya photoshoot" in pg.get_by_test_id("pipeline-list").inner_text() and pg.get_by_test_id("deal-card").count() == 0)
    pg.screenshot(path=f"{SHOTS}/06-ceo-list-won-1440.png", full_page=True)

    pg.get_by_test_id("sales-tabs").get_by_role("button", name="New deal").click(); pg.wait_for_timeout(600)
    check("New deal opens the form, and Create waits for a customer and a name", pg.get_by_test_id("deal-save").count() == 1 and pg.get_by_test_id("deal-save").is_disabled())
    pg.get_by_test_id("deal-customer-q").fill("Ai"); pg.wait_for_timeout(1200)
    pg.get_by_test_id("deal-customer-52").check()
    pg.wait_for_timeout(300)
    check("…a customer from the CRM fills the name and is ready", not pg.get_by_test_id("deal-save").is_disabled())
    pg.screenshot(path=f"{SHOTS}/07-ceo-new-deal-1440.png", full_page=False)
    check("no page errors (CEO)", not errs, errs[:2])
    ctx.close()

    # a consultant
    ctx, pg, errs = open_page(b, SALES)
    check("Mine shows the consultant's own deals", pg.get_by_test_id("deal-card").count() == 2, pg.get_by_test_id("deal-card").count())
    everyone(pg)
    check("a consultant moves only their own deals", pg.get_by_test_id("deal-move").count() == 2 and pg.locator("[data-deal='74'] [data-testid=deal-move]").count() == 0)
    check("no Suggested deals for a consultant", pg.get_by_test_id("deal-suggest-open").count() == 0)
    pg.locator("[data-deal='71'] [data-testid=deal-open]").click(); pg.wait_for_timeout(1300)
    pg.get_by_test_id("deal-won-btn").click(); pg.wait_for_timeout(600)
    check("without evidence a consultant is told why, and cannot override", pg.get_by_test_id("won-blocked").count() == 1 and pg.get_by_test_id("won-reason").count() == 0 and pg.get_by_test_id("won-save").is_disabled())
    pg.screenshot(path=f"{SHOTS}/08-sales-exec-won-blocked-1440.png", full_page=False)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    pg.locator("[data-testid=pipeline-strip] button").filter(has_text="Won this month").click(); pg.wait_for_timeout(500)
    pg.get_by_test_id("pipeline-table").get_by_text("Hari Raya photoshoot").first.click(); pg.wait_for_timeout(1200)
    t = pg.get_by_test_id("deal-record").inner_text()
    check("a won deal says how it was won; only a manager reopens", "Won on the customer's acceptance" in t and pg.get_by_test_id("deal-reopen-btn").count() == 0, t[:300])
    check("no page errors (consultant)", not errs, errs[:2])
    ctx.close()

    # the super admin: manages, never overrides
    ctx, pg, errs = open_page(b, ROOT)
    everyone(pg)
    pg.locator("[data-deal='73'] [data-testid=deal-open]").click(); pg.wait_for_timeout(1300)
    pg.get_by_test_id("deal-won-btn").click(); pg.wait_for_timeout(600)
    check("the super admin cannot decide Won without evidence", pg.get_by_test_id("won-blocked").count() == 1)
    ctx.close()

    # the Board in Leads & CRM is retired; an old link lands on the Pipeline
    ctx, pg, errs = open_page(b, CEO)
    pg.goto(f"http://127.0.0.1:{CEO}/portal?tab=Sales&view=customers"); pg.wait_for_timeout(3500)
    check("Leads & CRM no longer has a Board", pg.get_by_test_id("cust-board").count() == 0 and pg.get_by_test_id("customer-board").count() == 0)
    ctx.close()

    for w in WIDTHS:
        ctx, pg, errs = open_page(b, CEO, w=w, h=900)
        everyone(pg)
        check(f"no sideways page at {w}px", no_hscroll(pg))
        if w in (390, 768):
            pg.screenshot(path=f"{SHOTS}/09-ceo-{w}.png", full_page=True)
        if w == 390:
            sw = pg.get_by_test_id("pipeline-board").evaluate("e => e.scrollWidth > e.clientWidth")
            check("on a phone the board scrolls sideways inside itself", sw)
            pg.locator("[data-deal='72'] [data-testid=deal-open]").click(); pg.wait_for_timeout(1200)
            check("on a phone the deal opens full screen", pg.get_by_role("dialog").filter(has_text="Photo booth").count() >= 1)
            check("…with no sideways page", no_hscroll(pg))
            pg.screenshot(path=f"{SHOTS}/10-ceo-390-deal.png", full_page=False)
        ctx.close()
    for port, nm in ((CEO, "ceo"), (SALES, "sales-exec")):
        ctx, pg, errs = open_page(b, port, theme="dark", lang="ms")
        t = pg.locator("main").inner_text()
        check(f"{nm}: Malay words in dark theme", "Saluran Jualan" in t and "Urusan terbuka saya" in t and "bukan hasil" in t.lower(), t[:300])
        pg.screenshot(path=f"{SHOTS}/11-{nm}-1440-dark-ms.png", full_page=True)
        ctx.close()
    b.close()

bad = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(bad)}/{len(res)} passed")
raise SystemExit(1 if bad else 0)

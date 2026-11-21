"""SALES COMMAND CENTER, PHASE 2: LEADS & CRM (v1.398.0) - in a browser.

  The tab       "Leads & CRM" (was Customers & Follow-ups); All Leads, My Leads, Unassigned,
                New Enquiries, Active Customers, Follow-ups, Board - no Needs Action
  The page      one figure strip; the list beside the selected lead; every open lead without
                an owner or a next action is flagged in words
  The lead      owner, next action, source, services, contact log, history; Log contact,
                Change status, Source & services open the shared drawer; Assign only for a
                manager; Suggested owners only for a manager, on Unassigned
  Enquiries     Convert to lead on a website enquiry for Sales
  Phones        no sideways page 320-1440; light and dark; English and BM

The fixture's records are invented (tests/browser/fixture.mjs, "crm").
Servers: ROLE=ceo 4177 · ROLE=sales_marketing 4182   (node tests/browser/serve.mjs out <port>)
Screenshots go to SHOTS (default /tmp/crm-shots).
"""
from playwright.sync_api import sync_playwright
import os, re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, SALES = 4177, 4182
SHOTS = os.environ.get("SHOTS", "/tmp/crm-shots"); os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, port, w=1440, h=1000, lang="en", theme="light"):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    ctx.add_init_script(f"try{{localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang','{lang}');localStorage.setItem('azone-theme','{theme}')}}catch(e){{}}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales&view=customers"); pg.wait_for_timeout(4500)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    ctx, pg, errs = open_page(b, CEO)
    main = pg.locator("main").inner_text()
    check("the view is called Leads & CRM", "Leads & CRM" in main and "Customers & Follow-ups" not in main, main[:200])
    bar = " ".join(t.inner_text() for t in pg.locator("[data-testid^=cust-]").filter(visible=True).all())
    check("the lead views and the inboxes are one tab row, without Needs Action",
          all(wd in bar for wd in ["All Leads", "My Leads", "Unassigned", "New Enquiries", "Active Customers", "Follow-ups", "Board"]) and "Needs Action" not in bar, bar)
    strip = pg.get_by_test_id("crm-strip")
    st = strip.inner_text()
    check("one figure strip: open leads, new this week, unassigned, no next action, follow-ups overdue, active customers",
          strip.locator(":scope > *").count() == 6 and all(wd in st for wd in ["Open leads", "New this week", "Unassigned", "No next action", "Follow-ups overdue", "Active customers"]), st[:300])
    rows = pg.get_by_test_id("lead-row")
    check("the list shows the leads", rows.count() == 5, rows.count())
    check("an unowned lead says so in words", pg.get_by_test_id("lead-no-owner").count() >= 1)
    check("an open lead with nothing booked says No next action", pg.get_by_test_id("lead-no-next").count() >= 1)
    check("a late next action says Overdue", "Overdue" in pg.get_by_test_id("crm-table").inner_text())
    check("the help pane explains the rule until a lead is chosen", pg.get_by_test_id("crm-rules").count() == 1)
    pg.screenshot(path=f"{SHOTS}/01-ceo-all-leads-1440.png", full_page=True)

    rows.first.click(); pg.wait_for_timeout(1200)
    rec = pg.get_by_test_id("lead-record")
    rt = rec.inner_text() if rec.count() else ""
    check("choosing a lead shows it beside the list", rec.count() == 1 and "Aina Boutique (Melaka)" in rt, rt[:200])
    check("the lead shows its owner, next action, source and services", all(wd in rt for wd in ["Owner", "Next action", "Source", "Interested in", "Live Selling Starter"]), rt[:400])
    check("the contact log and the history are there", pg.get_by_test_id("lead-activity").count() == 3 and pg.get_by_test_id("lead-event").count() == 4)
    check("a manager may assign", pg.get_by_test_id("lead-assign-btn").count() == 1)
    check("no package price on the lead", "4,500.00" in rt and "Live Selling Starter" in rt and not re.search(r"Live Selling Starter[^\n]*RM", rt), rt[:300])
    pg.screenshot(path=f"{SHOTS}/02-ceo-lead-selected-1440.png", full_page=True)

    pg.get_by_test_id("lead-log").click(); pg.wait_for_timeout(600)
    save = pg.get_by_test_id("activity-save")
    check("Log contact opens the drawer, and Save waits for what happened", save.count() == 1 and save.is_disabled())
    pg.get_by_test_id("activity-note").fill("Called, she will confirm the October live dates on Monday")
    check("…then Save is ready", not save.is_disabled())
    pg.screenshot(path=f"{SHOTS}/03-ceo-log-contact-1440.png", full_page=False)
    save.click(); pg.wait_for_timeout(1200)
    check("saving tells the person it was logged", "Contact logged" in pg.locator("body").inner_text())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

    pg.get_by_test_id("lead-status-btn").click(); pg.wait_for_timeout(500)
    pg.get_by_test_id("status-disqualified").check(); pg.wait_for_timeout(200)
    check("Disqualified asks why before it saves", pg.get_by_test_id("status-save").is_disabled())
    pg.get_by_test_id("status-reason").fill("Closed their shop in October")
    check("…and saves once a reason is given", not pg.get_by_test_id("status-save").is_disabled())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    if pg.get_by_role("button", name=re.compile("Discard")).count(): pg.get_by_role("button", name=re.compile("Discard")).first.click(); pg.wait_for_timeout(300)

    pg.get_by_test_id("cust-unassigned").filter(visible=True).first.click(); pg.wait_for_timeout(1500)
    check("Unassigned lists only unowned leads", pg.get_by_test_id("lead-row").count() == 1)
    check("a manager sees Suggested owners on Unassigned", pg.get_by_test_id("crm-suggest-open").count() == 1)
    pg.get_by_test_id("crm-suggest-open").click(); pg.wait_for_timeout(1200)
    check("the suggestions wait for a tick and a reason", pg.get_by_test_id("suggest-row").count() == 1 and pg.get_by_test_id("suggest-confirm").is_disabled())
    pg.get_by_test_id("suggest-row").first.check(); pg.get_by_test_id("suggest-reason").fill("Owners for the CRM start")
    check("…then Confirm is ready", not pg.get_by_test_id("suggest-confirm").is_disabled())
    pg.screenshot(path=f"{SHOTS}/04-ceo-suggested-owners-1440.png", full_page=False)
    check("no page errors (CEO)", not errs, errs[:2])
    ctx.close()

    # a consultant
    ctx, pg, errs = open_page(b, SALES)
    pg.get_by_test_id("lead-row").first.click(); pg.wait_for_timeout(1200)
    check("a consultant logs contact but does not assign", pg.get_by_test_id("lead-log").count() == 1 and pg.get_by_test_id("lead-assign-btn").count() == 0)
    pg.get_by_test_id("cust-unassigned").filter(visible=True).first.click(); pg.wait_for_timeout(1200)
    check("no Suggested owners for a consultant", pg.get_by_test_id("crm-suggest-open").count() == 0)
    pg.get_by_test_id("cust-my_leads").filter(visible=True).first.click(); pg.wait_for_timeout(1200)
    check("My Leads shows the consultant's own", pg.get_by_test_id("lead-row").count() == 2)
    pg.get_by_test_id("cust-enquiries").filter(visible=True).first.click(); pg.wait_for_timeout(1500)
    check("a website enquiry offers Convert to lead to Sales", pg.locator("[data-testid^=convert-enquiry-]").count() >= 1)
    pg.screenshot(path=f"{SHOTS}/05-sales-exec-enquiries-1440.png", full_page=True)
    check("no page errors (consultant)", not errs, errs[:2])
    ctx.close()

    for w in WIDTHS:
        ctx, pg, errs = open_page(b, SALES, w=w, h=900)
        check(f"no sideways page at {w}px", no_hscroll(pg))
        if w in (390, 768):
            pg.screenshot(path=f"{SHOTS}/06-sales-exec-{w}.png", full_page=True)
        if w == 390:
            pg.get_by_test_id("lead-row").first.click(); pg.wait_for_timeout(1200)
            check("on a phone the lead opens full screen", pg.get_by_role("dialog").filter(has_text="Aina Boutique").count() >= 1)
            check("…with no sideways page", no_hscroll(pg))
            pg.screenshot(path=f"{SHOTS}/07-sales-exec-390-lead.png", full_page=False)
        ctx.close()
    for port, nm in ((CEO, "ceo"), (SALES, "sales-exec")):
        ctx, pg, errs = open_page(b, port, theme="dark", lang="ms")
        t = pg.locator("main").inner_text()
        check(f"{nm}: Malay words in dark theme", "Prospek & CRM" in t and "Semua Prospek" in t and "Tiada pemilik" in t, t[:200])
        pg.get_by_test_id("lead-row").first.click(); pg.wait_for_timeout(1000)
        pg.screenshot(path=f"{SHOTS}/08-{nm}-1440-dark-ms.png", full_page=True)
        ctx.close()
    b.close()

bad = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(bad)}/{len(res)} passed")
raise SystemExit(1 if bad else 0)

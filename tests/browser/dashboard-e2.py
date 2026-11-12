"""v1.280.0 - A2Z OS MINIMAL EXECUTIVE WORKSPACE, phase E2: the Dashboard
(the CEO approved the photo and all eight decisions, 11-11-2026; claude/
MINIMAL-EXECUTIVE-WORKSPACE-BLUEPRINT.md sections 5.1 - 5.3). The figures'
source is proven by tests/company-performance.mjs (the route, against the
whole worker) and tests/executive-workspace.mjs (the source).

v1.291.0 - the CEO's half is re-pointed to EXECUTIVE COMMAND CENTER 4.0
(tests/browser/ecc4.py holds the new screens); every behaviour below is
still checked where it lives now.

Here, in a browser:
  the CEO's desktop is the photo: five figures (Weekly Target, Collected,
  Invoices, Outstanding, Open Quotations), Sales Performance beside My Tasks,
  Follow-ups, Approvals, Today's Schedule, Quick Actions, then More;
  Sales Performance says the same figure as the Collected tile, draws the
  week as a running total against the target, says a day to come is still
  to come, and switches to the month and the year (Left / Right too);
  a failed read says so with Retry, never a false zero;
  the tick opens the task's update sheet and changes nothing;
  Create Invoice, Record Payment and Add Client open Sales where that work
  is done; the date pill shows another day's schedule and Back to today;
  More holds the cards of before;
  the CEO's phone leads with the target, then Needs your decision, then four
  figures two by two; a salesperson's phone leads with their target and the
  next best action, and Snooze hides it on that device until tomorrow;
  a salesperson and a live host never see the company's Sales Performance;
  no sideways page; no page errors.

Servers (servers.txt): 4177 ceo, 4182 sales_marketing, 4180 live_host,
4268 ROLE=ceo PERF=fail. Invented people only."""
import json, urllib.request
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def page(b, port, w, h, tab="Dashboard"):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab={tab}"); pg.wait_for_timeout(2800)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

TILES_JS = "() => [...document.querySelectorAll('[data-row=figures] [class*=kpi-tile_label]')].filter(e => e.offsetParent).map(e => e.innerText.trim())"
ORDER_JS = """() => [...document.querySelector('[data-layout]').children].filter(e => getComputedStyle(e).display !== 'none' && e.offsetHeight > 0)
  .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(e => (e.querySelector('[data-testid]')?.dataset.testid) || e.dataset.row || e.dataset.testid || '?')"""
fx = lambda port, path: json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())

with sync_playwright() as p:
    b = p.chromium.launch()
    # ================= the CEO, desktop =================
    # v1.291.0 (EXECUTIVE COMMAND CENTER 4.0, the CEO's "approve" 12-11-2026):
    # the five figures, the chart beside My Tasks and the More drawer are
    # retired for management (claude/EXECUTIVE-COMMAND-CENTER-4.0-BLUEPRINT.md);
    # tests/browser/ecc4.py holds the new screens at eight widths. What this
    # file held still holds, each where it lives now: the week / month / YTD
    # chart in Sales, My Tasks / Follow-ups / Today's Schedule on My Day, the
    # decisions in Needs My Decision, the cards of More in their modules.
    ctx, pg, errs = page(b, 4177, 1440, 900)
    check("the CEO reads the executive layout", pg.locator("[data-layout=executive]").count() == 1)
    tiles = pg.evaluate(TILES_JS)
    check("four figures (4.0): Weekly target, Company sales, Outstanding, Pending decisions", tiles == ["Weekly target", "Company sales", "Outstanding", "Pending decisions"], tiles)
    fig = pg.locator("[data-row=figures]")
    col = fig.locator("[class*=kpi-tile_tile]").nth(1).inner_text()
    check("the Company sales tile carries the change as a pill, against the same point last week", "+25%" in col and "vs last week to date" in col, col)
    check("Outstanding is the route's figure", "RM 11,100.00" in fig.locator("[class*=kpi-tile_tile]").nth(2).inner_text())
    well = pg.evaluate("() => document.querySelector('[data-row=figures] [class*=kpi-tile_well]').getBoundingClientRect()")
    tile = pg.evaluate("() => document.querySelector('[data-row=figures] [class*=kpi-tile_tile]').getBoundingClientRect()")
    check("the tile is the photo's: the well beside the words, not above them", abs(well["top"] - tile["top"]) < 30 and well["width"] >= 43, {"well": well, "tile": tile})
    summ = pg.get_by_test_id("sales-summary")
    check("Sales Performance says the same figure as the Company sales tile - one engine", "RM 4,000.00" in summ.inner_text() and "RM 4,000.00" in col)
    check("...and the week's required pace (the engine's gap over the days left)", "Needed per working day" in summ.inner_text() and "RM 11,000.00" in summ.inner_text(), summ.inner_text()[:300])
    appr = pg.get_by_test_id("decision-queue")
    check("Needs My Decision lists what waits for the CEO, with its word (Pending / Overdue)", "Needs My Decision" in appr.inner_text() and ("Pending" in appr.inner_text() or "Overdue" in appr.inner_text()))
    qa = pg.get_by_test_id("quick-actions")
    acts = [x.strip() for x in qa.locator("button").all_inner_texts()]
    check("Quick Actions are the CEO's four, each a workflow that exists", acts == ["Create Quotation", "Create Invoice", "Report Payment", "Open Desk"], acts)
    qa.get_by_role("button", name="Create Invoice").click(); pg.wait_for_timeout(1800)
    check("Create Invoice opens Sales' own create form, set to Invoice", pg.locator("h1.erp-topbar-title").first.inner_text().strip() == "Sales" and pg.evaluate("() => [...document.querySelectorAll('#sales-work select')].some(s => s.value === 'INV')"))
    pg.goto("http://127.0.0.1:4177/portal?tab=Dashboard"); pg.wait_for_timeout(2600)
    pg.get_by_test_id("quick-actions").get_by_role("button", name="Report Payment").click(); pg.wait_for_timeout(1800)
    check("Report Payment opens Sales > Payments", pg.get_by_role("tab", name="Payments", exact=True).first.get_attribute("aria-selected") == "true")
    pg.goto("http://127.0.0.1:4177/portal?tab=Dashboard"); pg.wait_for_timeout(2600)
    check("no More drawer for management - its cards live in their modules", pg.locator("#dash-more").count() == 0 and pg.get_by_role("button", name="More: sales pace").count() == 0)
    check("no sideways page (CEO desktop)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    # ---- My Day: My Tasks (the tick opens the update sheet, changes nothing), Follow-ups, the schedule ----
    pg.get_by_role("tab", name="My Day").click(); pg.wait_for_timeout(1200)
    before = fx(4177, "/__tasks")["posts"]
    tasks = pg.get_by_test_id("my-tasks")
    tick = tasks.get_by_role("button", name="Add an update to").first
    check("My Tasks (My Day): each task has a tick that names what it does", tick.count() == 1, tasks.inner_text()[:200])
    name = tick.get_attribute("aria-label")
    tick.click(); pg.wait_for_timeout(1800)
    check("the tick opens Tasks with that task's sheet", pg.locator("h1.erp-topbar-title").first.inner_text().strip() == "Tasks" and pg.get_by_role("dialog").count() >= 1, name)
    check("...and closed nothing: no task was changed", fx(4177, "/__tasks")["posts"] == before)
    pg.goto("http://127.0.0.1:4177/portal?tab=Dashboard"); pg.wait_for_timeout(2600)
    pg.get_by_role("tab", name="My Day").click(); pg.wait_for_timeout(1200)
    fol = pg.get_by_test_id("follow-ups")
    check("Follow-ups (My Day): my own follow-up and its quotation", "Aina Boutique (Melaka)" in fol.inner_text() and "QT-0042" in fol.inner_text(), fol.inner_text()[:200])
    sch = pg.get_by_test_id("schedule")
    check("Today's Schedule says when nothing is on", "Today's Schedule" in sch.inner_text())
    pill = pg.get_by_test_id("date-pill")
    check("the header's date pill is there, on the Dashboard", pill.count() == 1 and "2026" in pill.inner_text())
    pill.locator("input[type=date]").fill("2026-09-22"); pg.wait_for_timeout(600)
    check("choosing a day shows that day's schedule", "Management meeting" in sch.inner_text() and "6:00 PM" in sch.inner_text() and "22 Sep" in sch.inner_text(), sch.inner_text()[:200])
    sch.get_by_role("button", name="Back to today").click(); pg.wait_for_timeout(400)
    check("...and Back to today returns", "Today's Schedule" in sch.inner_text())
    check("no page errors (CEO desktop)", not errs, errs)
    ctx.close()

    # ---- the week / month / YTD chart: Sales' own (sales.tsx, management on Everyone) ----
    ctx, pg, errs = page(b, 4177, 1440, 900, tab="Sales")
    perf = pg.get_by_test_id("sales-performance")
    if perf.count() == 0:
        ev = pg.get_by_role("radio", name="Everyone")
        if ev.count(): ev.first.click(); pg.wait_for_timeout(1500)
        perf = pg.get_by_test_id("sales-performance")
    check("the Sales Performance chart is in Sales", perf.count() == 1)
    labels = pg.evaluate("() => [...document.querySelectorAll('[data-testid=sales-performance] svg text')].map(t => t.textContent)")
    check("the week is drawn by day, Monday to Sunday", all(d in labels for d in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]), labels)
    rows = pg.evaluate("() => [...document.querySelectorAll('[data-testid=sales-performance] table tbody tr')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
    check("...as a running total: Friday's bar is the week so far", any(r.startswith("Fri") and "RM 4,000.00" in r for r in rows), rows)
    check("...and a day to come says so, never a zero", any(r.startswith("Sat") and "still to come" in r for r in rows), rows)
    check("the legend has the target and what is still owed", "Target" in perf.inner_text() and "RM 15,000.00" in perf.inner_text() and "Outstanding" in perf.inner_text())
    radios = perf.get_by_role("radio")
    check("the period is a radio group: This Week chosen", radios.count() == 3 and perf.get_by_role("radio", name="This Week").get_attribute("aria-checked") == "true")
    perf.get_by_role("radio", name="This Month").click(); pg.wait_for_timeout(900)
    t = perf.inner_text()
    check("This Month: the month so far and its change against last month to date", "RM 9,300.00" in t and "7%" in t and "vs last month to date" in t and "Target" not in t, t[:300])
    perf.get_by_role("radio", name="This Month").press("ArrowRight"); pg.wait_for_timeout(900)
    t = perf.inner_text()
    check("Right arrow moves to YTD, which says when there is nothing to compare", perf.get_by_role("radio", name="YTD").get_attribute("aria-checked") == "true" and "RM 93,300.00" in t and "Nothing at this point last period" in t, t[:300])
    check("no page errors (Sales)", not errs, errs)
    ctx.close()

    # ================= a failed read =================
    ctx, pg, errs = page(b, 4268, 1440, 900)
    owed = pg.locator("[data-row=figures] [class*=kpi-tile_tile]").nth(2).inner_text()
    check("a failed read says so, with Retry - never a false zero", "Not available" in owed and "Retry" in owed and "RM 0.00" not in owed, owed)
    ctx.close()

    # ================= the CEO, phone =================
    ctx, pg, errs = page(b, 4177, 390, 844)
    order = [o for o in pg.evaluate(ORDER_JS) if o != "alert-band"]
    check("the CEO's phone (the photo): My Performance, then My Priority Actions, then My Work", order[:3] == ["sales-summary", "decision-queue", "my-work"], order)
    check("the decisions say My Priority Actions on a phone, with the count banner", "My Priority Actions" in pg.get_by_test_id("decision-queue").inner_text() and pg.get_by_test_id("decision-banner").is_visible())
    check("...and there is no figure row on a phone (its figures are in My Performance)", pg.evaluate(TILES_JS) == [])
    check("no sideways page (CEO phone)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    check("no page errors (CEO phone)", not errs, errs)
    ctx.close()

    # ================= a salesperson =================
    ctx, pg, errs = page(b, 4182, 390, 844)
    order = pg.evaluate(ORDER_JS)
    check("a salesperson's phone: their target first, then the next best action, then My Tasks", order[:3] == ["hero-target", "next-best-action", "my-tasks"], order)
    nba = pg.get_by_test_id("next-best-action")
    check("the next best action is their most urgent own work, with its one button", nba.count() == 1 and nba.get_by_role("button").count() == 2, nba.inner_text()[:200] if nba.count() else "")
    first = nba.inner_text()
    nba.get_by_role("button", name="Snooze").click(); pg.wait_for_timeout(400)
    after = pg.get_by_test_id("next-best-action")
    check("Snooze moves past it (the next one, or none)", after.count() == 0 or after.inner_text() != first)
    pg.reload(); pg.wait_for_timeout(2800)
    again = pg.get_by_test_id("next-best-action")
    check("...and it stays snoozed on this device after a reload", again.count() == 0 or again.inner_text() != first)
    check("a salesperson never sees the company's Sales Performance", pg.get_by_test_id("sales-performance").count() == 0)
    check("no page errors (salesperson phone)", not errs, errs)
    ctx.close()
    ctx, pg, errs = page(b, 4182, 1440, 900)
    check("...nor on a wide screen, where their layout is My Day's", pg.locator("[data-layout=my-day]").count() == 1 and pg.get_by_test_id("sales-performance").count() == 0)
    check("no sideways page (salesperson desktop)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    check("no page errors (salesperson desktop)", not errs, errs)
    ctx.close()

    # ================= a live host =================
    ctx, pg, errs = page(b, 4180, 1440, 900)
    qa = [x.strip() for x in pg.get_by_test_id("quick-actions").filter(visible=True).first.locator("button").all_inner_texts()]
    check("a live host is offered only the actions they may take (no quotation, invoice, payment or client)", not ({"Create Quotation", "Create Invoice", "Report Payment", "Add Client"} & set(qa)) and len(qa) >= 1, qa)
    check("...and no company figures or follow-ups", pg.get_by_test_id("sales-performance").count() == 0 and pg.get_by_test_id("follow-ups").count() == 0)
    check("no page errors (live host)", not errs, errs)
    ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\ndashboard-e2: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

"""SALES DISCIPLINE, PHASE 1 (v1.262.0; v1.263.0 the lists live in Sales) - the client side, in a browser.

v1.263.0 (claude/COMPACT-DASHBOARD-AUDIT.md, approved 05-11-2026): the
Dashboard shows the summary (tests/browser/compact-dashboard.py); the full
advice, the open quotations and their outcomes, the allocation and Copy last
week are checked HERE, in Sales -> the team's week, their one home.

claude/SALES-RECOVERY-AUDIT.md revision 2, sec. 10 (the CEO's "Phase by
Phase", 05-11-2026): on the Dashboard's Weekly Sales Target card, management
sees the command strip (Invoiced, Open quotations, the required pace, the
best week, forecast confidence "Not enough data", sales recovery risk with
its evidence), the Sales advice worst first with one Do it each, the open
quotations with what the customer said, the weekly rhythm and the Cash Watch
placeholder; Allocate opens the week allocation with its reconciliation line
and Copy last week (a dry run first, then a reason). A seller sees only
their own advice and quotations and no strip; My week says why the target
applies. Nothing is wider than the screen at 1440 / 390 / 320 px.

What the server decides is proven by direct request in tests/go-live-w.mjs;
here the answers are the fixture's (tests/browser/fixture.mjs, the shapes
weekly-sales.ts sends). Invented people and amounts only.

    ROLE=ceo node tests/browser/serve.mjs out 4231
    ROLE=sales_marketing node tests/browser/serve.mjs out 4232
    python3 tests/browser/sales-discipline.py
"""
from playwright.sync_api import sync_playwright
import json, urllib.request

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
def get(port, path): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())
CEO, SELLER = 4231, 4232
FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
INSIDE = "(w) => { const d = [...document.querySelectorAll('[role=dialog]')].filter((x) => x.offsetParent !== null).pop(); return d ? [...d.querySelectorAll('*')].filter((e) => !e.closest('table') && !e.closest('[class*=tableWrap]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1; }).length : -1; }"

def page(b, port, w=1440, h=1000, dark=False):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500, reduced_motion="reduce", color_scheme="dark" if dark else "light")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    # v1.292.0 (Sales Workspace 4.0, S5) - the team's week is Sales -> Reports -> Consultant Performance & Weekly Target
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales&view=reports"); pg.wait_for_timeout(3000)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    if pg.get_by_test_id("report-type").count():
        pg.get_by_test_id("report-type").select_option("team"); pg.wait_for_timeout(1800)
    return ctx, pg, errs

def card(pg):
    return pg.locator("section[aria-label='This week']").first

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the CEO, Sales -> the team's week ----
    ctx, pg, errs = page(b, CEO)
    c = card(pg)
    c.scroll_into_view_if_needed()
    t = c.inner_text() if c.count() else ""
    check("Sales -> the team's week is there", c.count() == 1 and "Weekly sales - the team" in t, t[:200])
    strip = c.locator("[aria-label='This week at a glance']")
    st = strip.inner_text() if strip.count() else ""
    check("the command strip in full: Invoiced, Open quotations, Required pace, Best week, Forecast confidence, Sales recovery risk", all(x in st for x in ["Invoiced", "Open quotations", "Required pace", "Best week", "Forecast confidence", "Sales recovery risk"]), st[:400])
    check("...confidence reads Not enough data with what it still needs; risk with its evidence", "Not enough data" in st and "2 of 8 weeks with a target" in st and "0.71× the gap" in st, st)
    check("Invoiced is its own figure: no 'Sales booked'", "Sales booked" not in t)
    box = pg.locator("#sales-week-advice")
    bt = box.inner_text() if box.count() else ""
    adv = box.locator("li[data-severity]")
    check("all six advice cards in full, worst first", adv.count() == 6 and adv.first.get_attribute("data-severity") == "critical", adv.count())
    first_qt = adv.filter(has_text="QT-AZOO060826-1")
    ft = first_qt.inner_text() if first_qt.count() else ""
    check("a card names its evidence, risk, owner and due day", all(x in ft for x in ["86 days old", "no contact recorded", "no follow-up scheduled", "Risk", "Hakim Rosli", "Due"]), ft)
    check("low conversion and margin say they are not active (no data)", "Not active yet (no data)" in bt)
    check("the weekly rhythm lives here now", "Allocate - targets and goals" in bt)
    before = len(get(CEO, "/__sales")["posts"])
    first_qt.get_by_role("button", name="Schedule follow-up").click(); pg.wait_for_timeout(900)
    first_qt.get_by_role("button", name="Schedule follow-up").click(); pg.wait_for_timeout(500)
    posts = [x for x in get(CEO, "/__sales")["posts"][before:] if x["p"].endswith("/advisory/act")]
    check("Do it sends only the card's key - the server works the card out again", len(posts) == 2 and all(set(x["body"].keys()) == {"key"} and x["body"]["key"] == "qt:41" for x in posts), posts)
    check("...and a second press says the follow-up is already in hand (no duplicate)", pg.get_by_text("Already in hand").count() >= 1)
    opp = box.locator("li").filter(has_text="Wants the price split")
    check("the open quotations show owner, age, last contact, next follow-up, the outcome and the obstacle", opp.count() >= 1 and "Negotiating" in opp.first.inner_text() and "Obstacle" in opp.first.inner_text(), opp.first.inner_text() if opp.count() else bt[-600:])
    row = box.locator("li").filter(has_text="QT-0042").filter(has=pg.get_by_role("button", name="Record what they said"))
    row.get_by_role("button", name="Record what they said").click(); pg.wait_for_timeout(800)
    dlg = pg.locator("[role=dialog]").filter(has_text="What did the customer say?")
    check("Record what they said opens the outcome sheet with the quotation's codes", dlg.count() == 1 and all(x in dlg.inner_text() for x in ["Interested", "Negotiating", "Waiting for decision", "Accepted", "Lost", "No response yet"]), dlg.inner_text()[:300] if dlg.count() else "")
    dlg.get_by_label("Lost").check(); pg.wait_for_timeout(200)
    save = dlg.get_by_role("button", name="Record and close the follow-up")
    check("lost needs the reason before it can be saved", save.is_disabled())
    dlg.locator("input:not([type=radio])").first.fill("Chose a cheaper printer"); pg.wait_for_timeout(200)
    save.click(); pg.wait_for_timeout(900)
    done = [x for x in get(CEO, "/__sales")["posts"][before:] if x["p"].endswith("/done")]
    check("...and sends the outcome and the reason with the follow-up - the quotation is not touched", len(done) == 1 and done[0]["body"].get("outcome") == "lost" and done[0]["body"].get("obstacle") == "Chose a cheaper printer" and "/staff/followups/612/done" in done[0]["p"], done)
    # the allocation
    c.get_by_role("button", name="Week allocation").click(); pg.wait_for_timeout(1200)
    al = pg.locator("[role=dialog]").filter(has_text="Week allocation")
    at = al.inner_text() if al.count() else ""
    check("Week allocation opens with its reconciliation line", "Company target RM 15,000.00 = revenue targets RM 11,000.00 + Unallocated (management) RM 4,000.00" in at, at[:400])
    check("...each person's kind, why it applies, and the records' suggestion; the CEO holds the unallocated line", all(x in at for x in ["Revenue target", "Contribution goal", "Operational KPIs", "Holds the unallocated line", "Records suggest"]), at[:600])
    al.get_by_label("Revenue target for Farid Zulkifli").fill("2000"); pg.wait_for_timeout(200)
    check("typing an amount moves the reconciliation live (RM 13,000.00 + RM 2,000.00)", "revenue targets RM 13,000.00 + Unallocated (management) RM 2,000.00" in al.inner_text(), al.inner_text()[:200])
    al.get_by_label("Revenue target for Hakim Rosli").fill("6000"); pg.wait_for_timeout(200)
    check("over-allocation is warned, never blocked", "Over-allocated by RM 1,000.00" in al.inner_text(), al.inner_text()[:300])
    al.get_by_label("Revenue target for Hakim Rosli").fill("3000.00"); pg.wait_for_timeout(200)
    savebtn = al.get_by_role("button").filter(has_text="changed target")
    check("saving needs a reason", savebtn.is_disabled())
    al.locator("textarea").first.fill("September allocation by the CEO"); pg.wait_for_timeout(200)
    savebtn.click(); pg.wait_for_timeout(1200)
    tp = [x for x in get(CEO, "/__sales")["posts"][before:] if x["p"].endswith("/sales/week/targets")]
    check("...one target row per changed person, with the reason (nothing else written)", len(tp) == 1 and tp[0]["body"] == {"scope": "person", "user_id": 9005, "week_from": "2026-09-14", "target_cents": 200000, "reason": "September allocation by the CEO"}, tp)
    al.get_by_role("button", name="Copy last week").click(); pg.wait_for_timeout(900)
    cp = [x for x in get(CEO, "/__sales")["posts"][before:] if x["p"].endswith("/targets/copy")]
    check("Copy last week runs a dry run first and lists what it would write", len(cp) == 1 and cp[0]["body"].get("dry_run") is True and "Farid Zulkifli" in al.inner_text() and "Confirm copy" in al.inner_text(), [cp, al.inner_text()[-300:]])
    ctx.close()
    check("no page error in Sales (CEO)", not errs, errs)

    # ---- the seller: own only ----
    ctx, pg, errs = page(b, SELLER)
    box = pg.locator("#sales-week-advice")
    t = box.inner_text() if box.count() else ""
    check("a seller's Sales week shows only their own advice and quotation (QT-0042), not a colleague's customer", "QT-0042" in t and "Jaya Makmur" not in t and "Kedai Runcit" not in t, t[:500])
    check("...and no rhythm or inactive-rules notice (management's)", "Allocate - targets and goals" not in t and "Not active yet" not in t)
    ctx.close()
    check("no page error in Sales (seller)", not errs, errs)

    # ---- phones and widths, both themes ----
    for port, w, dark in [(CEO, 390, False), (CEO, 320, True), (SELLER, 390, True), (CEO, 1440, True)]:
        ctx, pg, errs = page(b, port, w, 900 if w < 500 else 1000, dark)
        check(f"Sales {w}px {'dark' if dark else 'light'} ({'CEO' if port == CEO else 'seller'}): no sideways page", pg.evaluate(FITS), pg.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]"))
        if port == CEO and w < 500:
            c = card(pg); c.scroll_into_view_if_needed()
            c.get_by_role("button", name="Week allocation").click(); pg.wait_for_timeout(1200)
            check(f"{w}px: the allocation drawer fits (only its table scrolls, inside its own box)", pg.evaluate(INSIDE, w) == 0, pg.evaluate(INSIDE, w))
            pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
            row = pg.locator("#sales-week-advice li").filter(has_text="QT-0042").filter(has=pg.get_by_role("button", name="Record what they said"))
            if row.count():
                row.get_by_role("button", name="Record what they said").click(); pg.wait_for_timeout(800)
                check(f"{w}px: the outcome sheet fits", pg.evaluate(INSIDE, w) == 0, pg.evaluate(INSIDE, w))
        ctx.close()
        check(f"{w}px: no page error", not errs, errs)
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nsales-discipline: {len(results) - len(failed)} of {len(results)} passed")
raise SystemExit(1 if failed else 0)

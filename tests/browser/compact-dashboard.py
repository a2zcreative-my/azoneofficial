"""COMPACT EXECUTIVE DASHBOARD (v1.263.0) - the client side, in a browser.

claude/COMPACT-DASHBOARD-AUDIT.md revision 1 and the CEO's "approved"
(05-11-2026; D1-D4 as recommended): row 1 six compact KPI tiles; row 2
Sales target & pace (220-300 px), Pipeline & quotations (the top three,
View all opens Sales -> Documents filtered to open quotations), Financial
health (cash "Data not available", never A2Z and AZ ONE together); row 3
Sales advice (the top three, one button each), Today's focus, Upcoming &
pending; row 4 Task overview, Team performance, Sales performance; the rest
below - behind More on a phone. No duplicated sales buttons; the full lists
live in Sales. A seller sees only their own. Nothing is wider than the
screen at 1440 / 390 / 320 px.

v1.280.0 - the Minimal Executive Workspace (the CEO's "Approve for all",
11-11-2026) puts the photo's five figures and work cards on top
(tests/browser/dashboard-e2.py) and keeps every compact card below ONE
click deeper, behind More, on every width. These checks open More first
and hold those cards to the same rules; the top row is the photo's five.

The answers are the fixture's (tests/browser/fixture.mjs, the shapes
weekly-sales.ts sends; who may see what is proven by direct request in
tests/go-live-w.mjs). Invented people and amounts only.

    ROLE=ceo node tests/browser/serve.mjs out 4231
    ROLE=sales_marketing node tests/browser/serve.mjs out 4232
    python3 tests/browser/compact-dashboard.py
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
BOX = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), bottom: Math.round(r.bottom + scrollY) }; }"

def page(b, port, w=1440, h=1000, dark=False, tab=None):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500, reduced_motion="reduce", color_scheme="dark" if dark else "light")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal" + (f"?tab={tab}" if tab else "")); pg.wait_for_timeout(2800)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the CEO, desktop ----
    ctx, pg, errs = page(b, CEO)
    kp = pg.locator("[aria-label='At a glance']").first
    tiles = kp.locator(":scope > *")
    labels = kp.inner_text()
    check("row 1: the photo's five figures - Weekly Target, Collected, Invoices, Outstanding, Open Quotations",
          tiles.count() == 5 and all(x in labels for x in ["Weekly Target", "Collected", "Invoices", "Outstanding", "Open Quotations"]), labels[:300])
    tops = {round(tiles.nth(i).bounding_box()["y"]) for i in range(tiles.count())}
    check("...on one line at 1440 px", len(tops) == 1, tops)
    check("...the target says how far it is and the days left (the engine's: 27%, 1 working day)", "27% of target" in labels and "1 working day(s) left" in labels, labels)
    sched = pg.evaluate(BOX, "[data-testid=schedule]")
    k0 = pg.evaluate(BOX, "[aria-label='At a glance']")
    check("the photo's rows - the figures to the day's schedule - end within 900 px of the figures", sched and k0 and sched["bottom"] - k0["top"] <= 900, [k0, sched])
    pg.get_by_role("button", name="More: sales pace").click(); pg.wait_for_timeout(500)
    sp = pg.evaluate(BOX, "[data-testid=sales-pace]")
    check("row 2: the sales summary is 220-300 px tall", sp and 220 <= sp["h"] <= 300, sp)
    act = pg.evaluate(BOX, "[data-row=actions]")
    cmd = pg.evaluate(BOX, "[data-row=command]")
    check("behind More, the command and actions rows stay compact (720 px together, as before)", act and cmd and act["bottom"] - cmd["top"] <= 720, [cmd, act])
    pace = pg.get_by_test_id("sales-pace").inner_text()
    check("Sales target & pace: one bar, the risk chip, invoiced, best week, confidence, pipeline cover", all(x in pace for x in ["Risk: High", "Invoiced this week", "Best week", "Not enough data", "0.71× the gap", "View sales details", "Manage targets"]), pace)
    pipe = pg.get_by_test_id("pipeline")
    pt = pipe.inner_text()
    check("Pipeline & quotations: the count and value, and only the top three", "3 · RM 7,800.00" in pt and pipe.locator("li").count() == 3, pt)
    check("...each status is only what is recorded (No follow-up, Follow-up today, Negotiating)", all(x in pt for x in ["No follow-up", "Follow-up today", "Negotiating"]), pt)
    fin = pg.get_by_test_id("finance-health").inner_text()
    check("Financial health: cash Data not available, banks Not set up, never A2Z and AZ ONE together", "Data not available" in fin and "Not set up" in fin and "never added together" in fin, fin)
    adv = pg.get_by_test_id("advice")
    at = adv.inner_text()
    check("Sales advice: the top three of six, one line and one button each", adv.locator("li").count() == 3 and "3 of 6" in at and adv.locator("li").first.locator("button").count() == 1, at)
    check("...no long paragraphs: no evidence sentences, no inactive-rules notice", "Not active yet" not in at and "Risk:" not in at, at)
    check("Today's focus: my follow-up due today and my sales tasks", "Confirm the status of QT-0042" in pg.get_by_test_id("today-focus").inner_text())
    check("Upcoming & pending: three items at most", pg.locator("section[aria-label='Upcoming and pending'] li").count() <= 3)
    tp = pg.get_by_test_id("team-performance")
    check("row 4: Team performance shows four people with their status", tp.locator("li").count() == 4 and all(li.locator("span[class*=chip], span[class*=erp-chip]").count() >= 1 for li in tp.locator("li").all()), tp.inner_text()[:300])
    whole = pg.locator("main").first.inner_text() if pg.locator("main").count() else pg.inner_text("body")
    check("no duplicated sales actions on the Dashboard: no Follow up customers, Sales pipeline, Record acceptance, Record what they said",
          not any(x in whole for x in ["Follow up customers", "Sales pipeline (", "Record acceptance", "Record what they said", "Schedule follow-up"]), [x for x in ["Follow up customers", "Sales pipeline (", "Record acceptance", "Record what they said", "Schedule follow-up"] if x in whole])
    check("...New Quotation once (the Quick Actions strip)", pg.get_by_role("button", name="New Quotation").count() == 1, pg.get_by_role("button", name="New Quotation").count())
    before = len(get(CEO, "/__sales")["posts"])
    adv.locator("li").filter(has_text="Very old quotation").get_by_role("button", name="Follow up").click(); pg.wait_for_timeout(900)
    posts = [x for x in get(CEO, "/__sales")["posts"][before:] if x["p"].endswith("/advisory/act")]
    check("Follow up is the same Do it: only the card's key goes to the server", len(posts) == 1 and posts[0]["body"] == {"key": "qt:41"}, posts)
    pipe.get_by_role("button", name="View all").click(); pg.wait_for_timeout(2200)
    f = pg.evaluate("() => [...document.querySelectorAll('select')].map((s) => s.value)")
    check("Pipeline View all opens Sales -> Documents with its own Open quotations filter", "open" in f and "QT" in f and pg.locator("#sales-work").count() == 1, f)
    ctx.close()
    check("no page error (CEO)", not errs, errs)

    # Sales advice View all -> Sales, where the full list lives
    ctx, pg, errs = page(b, CEO)
    pg.get_by_role("button", name="More: sales pace").click(); pg.wait_for_timeout(500)
    pg.get_by_test_id("advice").get_by_role("button", name="View all").click(); pg.wait_for_timeout(2600)
    full = pg.locator("#sales-week-advice li[data-severity]")
    check("Sales advice View all lands on Sales, with all six cards in full (evidence, risk, owner, due)", full.count() == 6 and "Risk" in full.first.inner_text(), full.count())
    check("...and the open quotations with Record what they said live there", pg.locator("#sales-week-advice").get_by_role("button", name="Record what they said").count() >= 1)
    ctx.close()
    check("no page error (Sales)", not errs, errs)

    # ---- the seller ----
    ctx, pg, errs = page(b, SELLER)
    labels = pg.locator("[aria-label='At a glance']").first.inner_text()
    check("a seller's KPI strip is their own: my weekly target, follow-ups due, my open tasks, waiting on me, my leave", all(x in labels for x in ["My weekly target", "Follow-ups due", "My open tasks", "Waiting on me", "My leave"]) and "Remaining gap" not in labels, labels)
    pg.get_by_role("button", name="More: sales pace").click(); pg.wait_for_timeout(500)
    mw = pg.get_by_test_id("sales-pace").inner_text()
    check("...My week: my target, why it applies to my role", "My week" in mw and "You close deals" in mw, mw)
    check("...no Financial health, no Team performance, no company pace", pg.get_by_test_id("finance-health").count() == 0 and pg.get_by_test_id("team-performance").count() == 0 and "Required pace" not in labels)
    st = pg.inner_text("body")
    check("...only their own quotation and advice - no colleague's customer", "My open quotations" in st and "QT-0042" in st and "Jaya Makmur" not in st and "INV-0061" not in st and "Klinik Gigi" not in st, st[:300])
    ctx.close()
    check("no page error (seller)", not errs, errs)

    # ---- phones and widths ----
    for port, w, dark in [(CEO, 390, False), (CEO, 320, True), (SELLER, 390, True), (CEO, 1280, True)]:
        ctx, pg, errs = page(b, port, w, 844 if w < 500 else 900, dark)
        who = "CEO" if port == CEO else "seller"
        check(f"{w}px {'dark' if dark else 'light'} ({who}): no sideways page", pg.evaluate(FITS), pg.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]"))
        if w < 500:
            kp = pg.locator("[aria-label='At a glance']").first
            # v1.280.0 - the target tile leads above the row on a phone (its copy in the row is hidden)
            xs = {round(bb["x"]) for bb in (kp.locator(":scope > *").nth(i).bounding_box() for i in range(kp.locator(":scope > *").count())) if bb}
            check(f"{w}px: the KPI tiles are two columns", len(xs) == 2, xs)
            more = pg.get_by_role("button", name="More: sales pace")
            check(f"{w}px: the cards of before are behind More (touch-sized)", more.count() == 1 and more.bounding_box()["height"] >= 40 and not pg.locator("section[aria-label='Upcoming and pending']").is_visible())
            more.click(); pg.wait_for_timeout(400)
            check(f"{w}px: More opens them", pg.locator("section[aria-label='Upcoming and pending']").is_visible())
            btns = [x for x in pg.locator("[data-row] button").all() if x.is_visible()]
            small = [x.inner_text()[:20] for x in btns if x.bounding_box() and x.bounding_box()["height"] < 32]
            check(f"{w}px: the row buttons are touch-friendly (32 px or more)", not small, small)
            pg.screenshot(path=f"/tmp/cd-{w}-{'dark' if dark else 'light'}-{who}.png", full_page=True)
        else:
            more = pg.get_by_role("button", name="More: sales pace")
            check(f"{w}px: on a wide screen too the cards of before are one click deeper, behind More (the approved photo)", more.is_visible() and not pg.locator("section[aria-label='Upcoming and pending']").is_visible())
            more.click(); pg.wait_for_timeout(400)
            check(f"{w}px: ...and More opens them", pg.locator("section[aria-label='Upcoming and pending']").is_visible())
        ctx.close()
        check(f"{w}px: no page error", not errs, errs)
    b.close()

status = get(CEO, "/__fixture-status"); status2 = get(SELLER, "/__fixture-status")
# /staff/receipts and /staff/signing/my-preview are asked by Sales -> Documents (where View all lands), a gap of the fixture that predates this release
ours = [m for m in status["missing"] + status2["missing"] if m.startswith("/staff/sales/week") or m.startswith("/staff/dashboard") or m.startswith("/staff/tasks") or m.startswith("/staff/desk")]
check("the fixture answered every Dashboard request (no unknown endpoint)", not ours, [status["missing"], status2["missing"]])
failed = [n for n, ok in results if not ok]
print(f"\ncompact-dashboard: {len(results) - len(failed)} of {len(results)} passed")
raise SystemExit(1 if failed else 0)

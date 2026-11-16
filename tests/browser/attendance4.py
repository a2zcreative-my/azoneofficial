"""ATTENDANCE WORKSPACE 4.0 (v1.307.0) in a browser - the CEO, 14-11-2026:
"approve as the recommendation and correct it the error issue"
(claude/ATTENDANCE-WORKSPACE-4.0-BLUEPRINT.md, A-0 ... A-12). The verdict and
the routes are held by tests/attendance4.mjs; here, on the shared fixture's
invented people:

  five views from the address, Back / Forward, no On Shift or Settings tab;
  the Overview's figures, Requires Attention and Today's Attendance from the
  day verdict; a Saturday / Sunday register where nobody is "not clocked in"
  and the 09-11 holiday; one person's day in the drawer (details, punches,
  corrections, audit); the Shift Roster week and month, rest days and the
  holiday, and Shift Templates; Exceptions & Approvals with the forgotten
  punches and the overtime; Reports with the figures as filters, the trend
  and the dates; the roster board in Roster & Scheduling (v1.328.0); unpaid days in Leave;
  the policy card in Automation & Rules; Team On Shift reads the verdict;
  the COO sees no raw coordinates; a phone gets the view switch, never a
  cut-off tab row, at eight widths with no sideways page.

Servers: 4177 CEO · 4179 COO (the shared fixture).
"""
from playwright.sync_api import sync_playwright
import re, urllib.request

CEO, COO = 4177, 4179
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def ctx_for(b, w, h=900):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
def go(pg, port, q="", wait=2600, tab="Attendance"):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    pg.goto(f"http://127.0.0.1:{port}/portal?tab={tab}{q}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None
def visible_text(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('main *')].filter(e => e.offsetParent !== null && e.children.length === 0).map(e => e.textContent).join(' | ')""")

with sync_playwright() as p:
    b = p.chromium.launch()
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO)
    # v1.328.0 - R-1: Shift Roster moved to People > Roster & Scheduling
    names = ["Overview", "Attendance Records", "Exceptions & Approvals", "Reports"]
    check("four views, in the reference's order; no Shift Roster", pg.get_by_role("tab", name="Shift Roster", exact=True).count() == 0 and all(pg.get_by_role("tab", name=n, exact=True).count() == 1 for n in names), [pg.get_by_role("tab").all_inner_texts()])
    check("no On Shift and no Settings tab", pg.get_by_role("tab", name="On Shift", exact=True).count() == 0 and pg.get_by_role("tab", name="Settings", exact=True).count() == 0)
    check("the Overview opens and its view is in the address", view_of(pg) == "overview", pg.url)
    ov = pg.get_by_test_id("att-overview").inner_text()
    check("Overview: the four figures, Requires Attention, Today's Schedule and Today's Attendance", all(s in ov for s in ["Present Today", "Late Arrivals", "Missing Punches", "On Leave Today", "Requires Attention", "Today's Schedule", "Today's Attendance"]), ov[:400])
    check("none of the reference's illustrative labels", "Illustrative" not in ov and "UI reference only" not in ov)

    # the records: the day register from the verdict
    pg.get_by_role("tab", name="Attendance Records", exact=True).click(); pg.wait_for_timeout(1200)
    check("Records is in the address", view_of(pg) == "records", pg.url)
    rec = pg.get_by_test_id("att-records")
    def set_day(d):
        pg.get_by_test_id("att-date").fill(d); pg.get_by_test_id("att-date").dispatch_event("change"); pg.wait_for_timeout(900)
    row_text = lambda: " | ".join(rec.get_by_test_id("att-row").all_inner_texts())
    set_day("2026-11-14")
    t = row_text()
    check("Saturday 14-11: everyone on a rest day - nobody 'not clocked in', nobody absent", rec.get_by_test_id("att-row").count() == 7 and t.count("Rest day") == 7 and "Not clocked in" not in t and "Absent" not in t, t[:500])
    set_day("2026-11-09")
    t = row_text()
    check("09-11: the Deepavali replacement holiday for everyone, nobody absent", rec.get_by_test_id("att-row").count() == 7 and "Absent" not in t and "Not clocked in" not in t and t.count("Holiday") == 7, t[:400])
    set_day("2026-11-12")
    t = row_text()
    check("a working day: late, present, on shift, pending, leave, absent, not yet due", all(s in t for s in ["Late", "Present", "On shift", "Pending approval", "Absent", "Not yet due"]) and ("Medical leave" in t or "On leave" in t), t[:600])
    check("the register lists the day's seven people", rec.get_by_text(re.compile("nur nasuha binti zainal abidin", re.I)).count() >= 1 and rec.get_by_text(re.compile("aina sofea", re.I)).count() >= 1)
    rec.get_by_test_id("att-row").nth(1).get_by_role("button").first.click(); pg.wait_for_timeout(900)
    dr = pg.get_by_test_id("att-drawer")
    check("a person's day opens in the drawer", dr.count() == 1 and dr.is_visible() and "Attendance Details" in dr.inner_text(), dr.inner_text()[:300] if dr.count() else "")
    pg.get_by_test_id("att-drawer-punches").click(); pg.wait_for_timeout(400)
    check("the drawer's punch history, the amended clock-out marked", pg.get_by_test_id("att-punches").count() == 1 and pg.get_by_test_id("att-punches").locator("li").count() >= 2, pg.get_by_test_id("att-punches").inner_text()[:200] if pg.get_by_test_id("att-punches").count() else "")
    pg.get_by_test_id("att-drawer-audit").click(); pg.wait_for_timeout(900)
    au = pg.get_by_test_id("att-audit")
    check("the drawer's audit: that person's attendance events", au.count() == 1 and "Punch amended" in au.inner_text() and "Forgotten punch approved" in au.inner_text(), au.inner_text()[:300] if au.count() else "")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

    # the roster (v1.328.0: Roster & Scheduling > Shift Roster; the old address still reaches it)
    go(pg, CEO, "&view=roster", 3200)
    ro = pg.get_by_test_id("roster")
    check("the old Attendance roster address opens Roster & Scheduling > Shift Roster, a week by default", view_of(pg) == "shifts" and pg.get_by_test_id("roster-table").count() == 1, pg.url)
    rt = pg.get_by_test_id("roster-table").inner_text()
    if "Public holiday" not in rt:  # the fixture's holiday is 09-11-2026: from 16-11 it is in the week before
        ro.get_by_role("button", name="Previous").click(); pg.wait_for_timeout(1400)
        rt = pg.get_by_test_id("roster-table").inner_text()
    check("the roster says the weekend as days off and the 09-11 holiday as a holiday, never a missed shift", rt.count("Off") >= 14 and "Public holiday" in rt, rt[:400])
    pg.get_by_test_id("roster-month").click(); pg.wait_for_timeout(1200)
    check("the month view draws the whole month", pg.get_by_test_id("roster-table").count() == 1 and pg.get_by_test_id("roster-row").count() >= 7)
    check("the roster has no live sessions, task blocks or sales duty (A-3)", not any(s in pg.get_by_test_id("roster-table").inner_text() for s in ["Live session", "Task block", "Sales duty"]) and "scheduled on the Roster Board" in ro.inner_text())
    pg.get_by_test_id("roster-templates").click(); pg.wait_for_timeout(1500)
    check("Shift Templates opens the working-hours editor (its own view now)", view_of(pg) == "templates" and ("working hours" in visible_text(pg).lower()), visible_text(pg)[:300])
    go(pg, CEO, "&view=overview", 2600)

    # exceptions
    pg.get_by_role("tab", name="Exceptions & Approvals", exact=True).click(); pg.wait_for_timeout(1500)
    ex = pg.get_by_test_id("att-exceptions").inner_text()
    check("Exceptions: the forgotten punches and the overtime, in one queue", all(s in ex.lower() for s in ["mohamad izzudin bin amdan", "nur nasuha binti zainal abidin"]) and pg.get_by_test_id("exc-row").count() >= 4, ex[:400])
    check("Exceptions: decided today and the corrections card", "Decided Today" in visible_text(pg) and "Corrections" in visible_text(pg), ex[:300])
    pg.get_by_test_id("exc-open").first.click(); pg.wait_for_timeout(700)
    check("an exception opens with the existing decisions (approve / reject), nothing new", pg.get_by_test_id("exc-drawer").count() == 1 and pg.get_by_test_id("exc-approve").count() == 1 and pg.get_by_test_id("exc-reject").count() == 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

    # reports
    pg.get_by_role("tab", name="Reports", exact=True).click(); pg.wait_for_timeout(2200)
    rp = visible_text(pg)
    check("Reports: the month figures, the report, the trend and the breakdown", all(s in rp for s in ["Scheduled Days", "Verified Working Hours", "Late Arrivals", "Absences", "On Leave", "Exceptions"]) and pg.get_by_test_id("rep-trend").count() == 1, rp[:400])
    n_all = pg.get_by_test_id("rep-row").count()
    pg.get_by_role("button", name=re.compile("Absences")).first.click(); pg.wait_for_timeout(500)
    n_abs = pg.get_by_test_id("rep-row").count()
    check("a figure is the filter: Absences shows only those absent, with their dates", 0 < n_abs < n_all and "Absent:" in pg.get_by_test_id("rep-table").inner_text(), f"{n_all} -> {n_abs}")
    check("...and a row that does not add up says so", "This row does not add up" in pg.get_by_test_id("rep-table").inner_text())
    check("no page error (CEO)", not errs, errs[:2])

    # the Desk's anchor lands on Exceptions
    go(pg, CEO, "&view=exceptions", 3000)
    check("the exceptions address opens Exceptions & Approvals", view_of(pg) == "exceptions" and pg.get_by_test_id("att-exceptions").count() == 1, pg.url)
    pg.go_back(); pg.wait_for_timeout(500)

    # the roster board lives in Roster & Scheduling (v1.328.0, R-1)
    go(pg, CEO, "&view=board", 3600, tab="Roster%20%26%20Scheduling")
    check("Roster & Scheduling > Roster Board holds the roster board", pg.locator("#roster-board").count() == 1 and "Roster board" in visible_text(pg), visible_text(pg)[:300])
    go(pg, CEO, "&view=today", 3200, tab="Roster%20%26%20Scheduling")
    check("...and Today holds today's assignments", "Assignments today" in visible_text(pg), visible_text(pg)[:300])
    # unpaid days in Leave (CEO)
    go(pg, CEO, "&view=manage", 3200, tab="Leave")
    check("Leave > The company holds the unpaid-day card (moved from Attendance Settings)", "Unpaid leave days" in visible_text(pg), visible_text(pg)[:300])
    # the policy card
    go(pg, CEO, "", 2600, tab="Automation %26 Rules")
    pol = pg.get_by_test_id("attendance-policy")
    check("Automation & Rules: the attendance policy, read-only", pol.count() == 1 and all(s in pol.inner_text() for s in ["Shift start + 10 min, from 16-11-2026", "never approved automatically"]) and pol.locator("input, select, textarea").count() == 0, pol.inner_text()[:300] if pol.count() else pg.url)
    c.close()

    # the COO: no raw coordinates on screen
    c = ctx_for(b, 1440, 1100); pg = c.new_page()
    go(pg, COO, "&view=records", 3000)
    pg.get_by_test_id("att-date").fill("2026-11-12"); pg.get_by_test_id("att-date").dispatch_event("change"); pg.wait_for_timeout(900)
    check("the COO reads where a punch was made as a word, never the coordinates", "103.72" not in pg.locator("main").inner_text() and ("Outside" in pg.locator("main").inner_text() or "Verified" in pg.locator("main").inner_text()))
    c.close()

    # a phone: the view switch, no sideways page, at eight widths
    for w in WIDTHS:
        c = ctx_for(b, w, 900); pg = c.new_page(); perrs = []; pg.on("pageerror", lambda e: perrs.append(str(e)))
        go(pg, CEO, "", 2400)
        bad = []
        for v in ["overview", "records", "exceptions", "reports"]:
            pg.goto(f"http://127.0.0.1:{CEO}/portal?tab=Attendance&view={v}"); pg.wait_for_timeout(1600)
            if not no_hscroll(pg): bad.append(v)
        phone = w < 768
        bar = pg.get_by_test_id("att-view-bar")
        check(f"{w}px: no sideways page on any view" + (" and the view switch, not a tab row" if phone else ""), not bad and (not phone or bar.is_visible()) and not perrs, (bad, perrs[:1]))
        c.close()
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

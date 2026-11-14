"""HR WORKSPACE 4.0 (v1.306.0) in a browser - the CEO, 14-11-2026: "REMOVE
DUPLICATION", "proceed as per recommend" (claude/HR-WORKSPACE-4.0-BLUEPRINT.md).
The server and source rules are held by tests/hr4.mjs; here, on the shared
fixture's invented people:

  four tabs from the address, Back / Forward; the Overview's figures, the
  lifecycle worklist and the people milestones, with the boundary note and
  no leave / claims / payroll tiles; Employee Lifecycle's five segments and
  the joining checklist editor; Calendar & Holidays = the one company
  calendar + the holiday controls + the holiday list; HR Policies & Settings
  = the library, the four module links, the HR audit history; the old
  ?view=reports address opens Tasks > Reports & Archive with the written
  reports; the COO sees no lifecycle actions and no audit history; a phone
  gets the view switch, never a cut-off tab row, at eight widths with no
  sideways page. Also the Sales worklist at 344 px (the ui_overflow report
  of 14-11-2026 05:31).

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
def go(pg, port, q="", wait=2600, tab="HR"):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    pg.goto(f"http://127.0.0.1:{port}/portal?tab={tab}{q}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None

with sync_playwright() as p:
    b = p.chromium.launch()
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO)
    tabs = [pg.get_by_role("tab", name=n) for n in ["Overview", "Employee Lifecycle", "Calendar & Holidays", "HR Policies & Settings"]]
    check("four tabs, in the reference's order, and nothing else", all(t.count() == 1 for t in tabs) and pg.get_by_role("tab", name="Reports").count() == 0 and pg.get_by_role("tab", name="Payroll & Payslips").count() == 0 and pg.get_by_role("tab", name="HR Administration").count() == 0)
    check("the Overview opens and its view is in the address", view_of(pg) == "overview", pg.url)
    main = pg.locator("main").inner_text()
    check("Overview: the three figures from the real records", all(s in main for s in ["Staff on record", "Probation reviews due", "Leaving / exit records", "From the Staff record"]), main[:300])
    check("Overview: no leave, claims or payroll tiles, no approve or payroll buttons", not any(s in main for s in ["Leave Requests", "Approve Leave", "Approve Claims", "Process Payroll", "Payroll Items", "Submit report"]), main[:400])
    wl = pg.get_by_test_id("hr-worklist").inner_text()
    check("the lifecycle worklist: joining checklist (4/6), probation review, offboarding record, templates", all(s in wl for s in ["Employee joining checklist", "4/6", "Probation review", "Employee offboarding record", "Employment document templates"]), wl[:400])
    check("the boundary note names Leave, Attendance and Tasks > Reports & Archive", "Tasks → Reports & Archive" in pg.get_by_test_id("hr-boundary").inner_text())
    ms = pg.get_by_test_id("hr-milestones").inner_text()
    check("upcoming people milestones: probation, joining & leaving dates, birthdays", all(s in ms for s in ["Probation & confirmation", "Joining & leaving dates", "Employee birthdays"]), ms[:300])
    check("none of the reference's illustrative labels", "Illustrative" not in main and "UI reference only" not in main)
    pg.get_by_test_id("hr-worklist").get_by_role("button", name=re.compile("^View record")).first.click(); pg.wait_for_timeout(600)
    check("a worklist row opens Employee Lifecycle (in the address)", view_of(pg) == "lifecycle", pg.url)
    lc = pg.get_by_test_id("hr-lifecycle")
    check("Lifecycle: five segments", all(lc.get_by_role("tab", name=re.compile(f"^{n}")).count() == 1 or lc.get_by_role("button", name=re.compile(f"^{n}")).count() >= 1 for n in ["Joining", "Probation", "Letters", "Training", "Leaving"]), lc.inner_text()[:300])
    jn = pg.get_by_test_id("hr-joining")
    check("Joining: the checklist is ticked here (the one editor), with the person's progress", jn.get_by_test_id("hr-joining-step").count() == 6 and "4/6" in jn.inner_text() and "stay in the person's Staff record" in jn.inner_text(), jn.inner_text()[:300])
    jn.get_by_test_id("hr-joining-pick").select_option("9002"); pg.wait_for_timeout(600)
    check("anyone else's checklist, read from their record, with their document count", jn.get_by_test_id("hr-joining-step").count() == 12 and "1 document(s) in their Staff record" in jn.inner_text(), jn.inner_text()[-300:])
    pg.go_back(); pg.wait_for_timeout(500)
    check("Back returns to the Overview", view_of(pg) == "overview", pg.url)
    pg.get_by_role("tab", name="Calendar & Holidays").click(); pg.wait_for_timeout(1500)
    cal = pg.get_by_test_id("hr-calendar").inner_text()
    check("Calendar: the one company calendar, the holiday controls, the holiday list", all(s in cal for s in ["Holiday controls", "Applicable state / workplace", "Johor", "Public holiday sources", "Replacement day policy"]) and pg.get_by_test_id("hr-holiday-controls").is_visible(), cal[:400])
    pg.get_by_role("tab", name="HR Policies & Settings").click(); pg.wait_for_timeout(600)
    lib = pg.get_by_test_id("hr-library").inner_text(); links = pg.get_by_test_id("hr-module-links").inner_text()
    check("Policies: the library as it exists, marked built-in (no invented versions)", all(s in lib for s in ["Employment letter templates", "Joining & leaving checklists", "Probation & review standards", "Training and certification", "Built-in"]) and "Versioned" not in lib, lib[:300])
    check("Policies: the four authoritative module links", all(s in links for s in ["Open Leave", "Open Payroll", "Open Attendance", "Open Users"]), links)
    pg.get_by_test_id("hr-audit-open").click(); pg.wait_for_timeout(600)
    au = pg.get_by_test_id("hr-audit").inner_text()
    check("Policies: the HR audit history - HR events only", all(s in au for s in ["Letter issued", "Holiday added", "Joining checklist updated"]), au[:300])
    check("no page error (CEO)", not errs, errs[:2])
    # the old Reports address goes to Tasks
    go(pg, CEO, "&view=reports", 3200)
    check("the old HR Reports address opens Tasks > Reports & Archive", "tab=Tasks" in pg.url or pg.get_by_test_id("task-reports").count() == 1, pg.url)
    tr = pg.get_by_test_id("task-reports")
    check("...with the written reports and the submit form, as they were", tr.is_visible() and "Called 6 hotels" in tr.inner_text() and tr.get_by_role("button", name="Submit report").count() == 1, tr.inner_text()[:300] if tr.count() else "missing")
    c.close()

    c = ctx_for(b, 1280, 900); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, COO, "&view=lifecycle")
    check("the COO: no lifecycle actions (hr_manage, unchanged)", pg.get_by_test_id("hr-joining").count() == 0)
    go(pg, COO, "&view=policies")
    check("the COO: no audit history button", pg.get_by_test_id("hr-audit-open").count() == 0)
    check("no page error (COO)", not errs, errs[:2])
    c.close()

    for w in WIDTHS:
        for q in ["", "&view=lifecycle", "&view=calendar", "&view=policies"]:
            c = ctx_for(b, w); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            go(pg, CEO, q, 2200)
            if w < 768 and q == "":
                check(f"phone {w}: the view switch, not the tab row", pg.get_by_test_id("hr-view-bar").is_visible() and not pg.get_by_role("tab", name="Employee Lifecycle").is_visible())
            check(f"ceo @{w} {q or 'overview'}: no sideways page, no error card, no page error", no_hscroll(pg) and "Something went wrong on this screen" not in pg.locator("main").inner_text() and not errs, errs[:1])
            c.close()
    for w in (320, 344, 360):
        c = ctx_for(b, w); pg = c.new_page()
        go(pg, CEO, "", 2600, "Sales")
        over = pg.evaluate("() => { const W = document.documentElement.clientWidth; return [...document.querySelectorAll('[data-testid=sales-worklist] *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > W + 1; }).map(e => e.tagName).slice(0, 5); }")
        check(f"Sales worklist @{w}: nothing past the screen's edge (the 14-11 ui_overflow report)", not over, over)
        c.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\nhr4: {len(res) - len(failed)}/{len(res)} passed")
if failed: raise SystemExit(1)

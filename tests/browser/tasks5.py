"""TASKS WORKSPACE 5.0 (v1.313.0), Gate 3 - in a browser (the CEO's "Approved
as per recommendations both", 15-11-2026; claude/TASKS-WORKSPACE-5.0-BLUEPRINT.md).
The six tabs against the five board images (and TK-2 for the Overview):
the figures, the register columns, the preview beside My Tasks, the four
cards under it, the All Tasks side column with Edit, the Project Register
and the project beside it, the work calendar (Sunday first, no Client
Meetings - TK-10), Reports & Archive with the Live Host card marked for
Gate 4 (since v1.368.0 Live Reports in Roster & Scheduling) (no pretended form), the phone's view switch and agenda, and the
eight widths with no sideways page. Fixture data is invented
(tests/browser/fixture.mjs); no production figure is used.

Servers (from servers.txt):
    4177 ceo · 4180 live_host
"""
from playwright.sync_api import sync_playwright
import re, json, urllib.request, urllib.parse

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, HOST = 4177, 4180
VIEWS = ["overview", "mine", "all", "projects", "calendar", "reports"]
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, port, w=1440, h=1000, view=None, tab="Tasks"):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab={urllib.parse.quote(tab)}" + (f"&view={view}" if view else "")); pg.wait_for_timeout(3200)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def vis(pg, tid):
    return pg.locator(f'[data-testid="{tid}"]:visible').count() > 0

def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None

def zone_text(pg):
    return pg.locator("section.erp-tab-zone:visible").all_inner_texts()

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- the six tabs and the address ----------------
    ctx, pg, errs = open_page(b, CEO)
    tabs = [t.strip() for t in pg.get_by_role("tablist", name="Tasks").get_by_role("tab").filter(visible=True).all_inner_texts()]  # v1.323.0 - the page's own tab row (the Overview panel has its own)
    check("exactly six tabs in the board's order", tabs == ["Overview", "My Tasks", "All Tasks", "Projects", "Calendar", "Reports & Archive"], tabs)
    check("Create Task is the tab row's action", pg.get_by_role("tablist", name="Tasks").locator("xpath=..").get_by_role("button", name=re.compile("Create Task")).filter(visible=True).count() == 1)
    names = {"mine": "My Tasks", "all": "All Tasks", "projects": "Projects", "calendar": "Calendar", "reports": "Reports & Archive"}
    for k, n in names.items():
        pg.get_by_role("tab", name=n, exact=True).click(); pg.wait_for_timeout(900)
        check(f"the {n} tab writes view={k}", view_of(pg) == k, pg.url)
    pg.go_back(); pg.wait_for_timeout(900)
    check("Back returns to Calendar", view_of(pg) == "calendar" and vis(pg, "work-calendar"), pg.url)
    ctx.close()
    check("no page error (tabs)", not errs, errs)

    # ---------------- 01 Overview (v1.319.0 - Tasks 2.0 Stage 1, picture 5) ----------------
    ctx, pg, errs = open_page(b, CEO, view="overview")
    t = " ".join(zone_text(pg))
    check("Overview: the five figures - Total Tasks, Overdue, In Progress, Awaiting Review, Done", all(w in t for w in ["Total Tasks", "Overdue", "In Progress", "Awaiting Review", "Done"]), t[:300])
    # v1.321.0 - the Unified Workspace: one panel beside the queue, switched between three; every card still in it
    check("Overview: the queue, and beside it Staff Performance (management) with the week", all(vis(pg, k) for k in ["overview-list", "staff-performance", "weekly-summary"]))
    pg.get_by_test_id("overview-panel-switch").get_by_role("tab", name="Activity", exact=True).click(); pg.wait_for_timeout(300)
    check("…Activity: Recent Activity", vis(pg, "progress-overview"))
    pg.get_by_test_id("overview-panel-switch").get_by_role("tab", name="Actions", exact=True).click(); pg.wait_for_timeout(300)
    check("…Actions: Quick Links and the workflow", vis(pg, "quick-links") and vis(pg, "workflow-strip"))
    first = pg.get_by_test_id("overview-table").locator("tbody tr").first
    check("the list leads with the most pressing: overdue first (the urgent overdue task)", first.count() == 1 and "Approve the October content plan" in first.inner_text() and first.get_by_test_id("overdue-mark").count() == 1, first.inner_text() if first.count() else "")
    check("Overview repeats nothing: no status donut, no recently-closed list, no team table", "Recently Closed Tasks" not in t and "Task Progress — Company Wide" not in t)
    first.get_by_role("button").first.click(); pg.wait_for_timeout(1500)
    check("a row opens the task itself, in the task drawer", pg.locator("[data-testid=task-workspace][data-layout=drawer]:visible").count() == 1 and pg.get_by_role("dialog").count() >= 1)
    ctx.close()
    ctx, pg, errs2 = open_page(b, HOST, view="overview")
    check("a live host sees no Staff Performance; My Tasks (Today) takes its place", not vis(pg, "staff-performance") and vis(pg, "my-today"))
    ctx.close()
    check("no page error (Overview)", not errs and not errs2, errs + errs2)

    # ---------------- 02 My Tasks (v1.319.0 - pictures 2 and 3) ----------------
    ctx, pg, errs = open_page(b, CEO, view="mine")
    t = " ".join(zone_text(pg))
    check("My Tasks: Assigned Tasks, In Progress, Due Soon, Done This Week", all(w in t for w in ["Assigned Tasks", "In Progress", "Due Soon", "Done This Week"]), t[:300])
    # v1.326.0 - from 1024px the list is the register (a compact table), the row on show marked gold
    cards = pg.get_by_test_id("mine-table").locator("tbody tr")
    check("1440px: the list is the register on the left, the first task shown beside it", cards.count() >= 2 and cards.first.get_attribute("aria-current") == "true" and pg.locator("[data-testid=task-workspace][data-layout=pane]:visible").count() == 1)
    pc = pg.get_by_test_id("task-workspace").get_by_test_id("prio-chip").first
    check("priority reads High / Medium / Low (T2-10; an urgent task is High with its flag)", pc.count() == 1 and re.match(r"^(High|Medium|Low)( · Urgent)?$", pc.inner_text().strip()) is not None, pc.inner_text() if pc.count() else "")
    title = cards.nth(1).locator("td button").first.inner_text()
    cards.nth(1).click(); pg.wait_for_timeout(1500)
    ws = pg.get_by_test_id("task-workspace")
    check("choosing a row shows that task beside the list", title in ws.get_by_test_id("task-title").inner_text() and cards.nth(1).get_attribute("aria-current") == "true", title)
    pg.get_by_test_id("my-day").locator("summary").click(); pg.wait_for_timeout(400)
    check("My Day, folded under the list, opens on the four cards: My Focus, Today's Agenda, Upcoming Deadlines, Recent Updates", all(vis(pg, k) for k in ["my-focus", "my-agenda", "my-deadlines", "my-recent"]))
    check("Today's Agenda reads today's task block from the roster", "09:30" in pg.get_by_test_id("my-agenda").inner_text() and "Sign the hotel partnership letter" in pg.get_by_test_id("my-agenda").inner_text(), pg.get_by_test_id("my-agenda").inner_text())
    ctx.close()
    ctx, pg, errs2 = open_page(b, CEO, w=1024, view="mine")
    check("1024px: the register (about two fifths) and the task beside it (about three fifths)", pg.locator("[data-testid=task-workspace][data-layout=pane]:visible").count() == 1 and 0.36 <= pg.get_by_test_id("mine-list").bounding_box()["width"] / pg.get_by_test_id("mine-split").bounding_box()["width"] <= 0.44)
    ctx.close()
    ctx, pg, errs3 = open_page(b, CEO, w=900, view="mine")
    check("below 1024px: the card list has the width, no task beside it", vis(pg, "mine-list") and vis(pg, "my-cards") and pg.locator("[data-testid=task-workspace]:visible").count() == 0)
    errs2 = errs2 + errs3
    ctx.close()
    check("no page error (My Tasks)", not errs and not errs2, errs + errs2)

    # ---------------- 03 All Tasks (image 3) ----------------
    ctx, pg, errs = open_page(b, CEO, view="all")
    t = " ".join(zone_text(pg))
    check("All Tasks: Open Tasks, In Progress, Waiting Review, Overdue, Closed This Week", all(w in t for w in ["Open Tasks", "In Progress", "Waiting Review", "Overdue", "Closed This Week"]), t[:300])
    heads = [h.strip() for h in pg.locator("table:visible").first.locator("thead th").all_inner_texts()]
    check("the register has the Department column", "Department" in heads, heads)
    check("a department is read from the person's record", "Sales" in pg.locator("table:visible").first.inner_text())
    check("Insights is closed to start; the register has the width", not vis(pg, "workload-card") and not vis(pg, "all-insights"))
    pg.get_by_test_id("insights-btn").click(); pg.wait_for_timeout(400)
    check("Insights: Workload Balance, Department Breakdown, Quick Approvals", all(vis(pg, k) for k in ["workload-card", "department-card", "quick-approvals"]))
    edit = pg.locator('[data-testid="row-edit"]:visible').first
    check("Edit on each open row", edit.count() == 1)
    edit.click(); pg.wait_for_timeout(1200)
    check("Edit opens the task with its edit form (title, dates, priority, assignee)", pg.get_by_role("button", name=re.compile("^Save")).filter(visible=True).count() >= 1)
    ctx.close()
    ctx, pg, errs2 = open_page(b, HOST)
    tabs = [t.strip() for t in pg.get_by_role("tablist", name="Tasks").get_by_role("tab").filter(visible=True).all_inner_texts()]  # v1.323.0 - the page's own tab row (the Overview panel has its own)
    check("a live host has no All Tasks tab (the server answers ?all=1 for management only)", "All Tasks" not in tabs, tabs)
    ctx.close()
    check("no page error (All Tasks)", not errs and not errs2, errs + errs2)

    # ---------------- 04 Projects (image 4) ----------------
    ctx, pg, errs = open_page(b, CEO, view="projects")
    t = " ".join(zone_text(pg))
    check("Projects: Active Projects, At Risk, Completed This Month, Due This Week", all(w in t for w in ["Active Projects", "At Risk", "Completed This Month", "Due This Week"]), t[:300])
    reg = pg.locator('[data-testid="project-register"]:visible')
    check("the Project Register: Project & Client, Owner, Stage, Progress, Tasks, Health", reg.count() == 1 and [h.strip().lower() for h in reg.locator("thead th").all_inner_texts()] == ["project & client", "owner", "stage", "progress", "tasks", "health"])
    check("1440px: the chosen project beside the register (stages, deliverables, team, next task)", vis(pg, "project-summary") and "Quotation Accepted" in pg.get_by_test_id("project-summary").inner_text())
    summ = pg.get_by_test_id("project-summary")
    check("Gate 4 (TK-9): the deliverables are ticked rows, kept apart from tasks", summ.get_by_test_id("deliverable-rows").locator("input[type=checkbox]").count() == 2 and "(1/2)" in summ.inner_text(), summ.inner_text()[:300])
    check("Gate 4 (TK-15): the client's acceptance - not recorded yet, required before completion", "required before the project is closed" in summ.get_by_test_id("client-acceptance").inner_text() and summ.get_by_test_id("record-client-acceptance").count() == 1)
    ctx.close()
    check("no page error (Projects)", not errs, errs)

    # ---------------- 05 Calendar (image 2, TK-10) ----------------
    ctx, pg, errs = open_page(b, CEO, view="calendar")
    t = " ".join(zone_text(pg))
    check("Calendar: Events Today, Due This Week, Reviews, Milestones This Month", all(w in t for w in ["Events Today", "Due This Week", "Reviews", "Milestones This Month"]), t[:300])
    dows = [d.strip() for d in pg.locator('[data-testid="cal-grid"] [role=columnheader]').all_inner_texts()]
    check("the month starts on Sunday, as the board", dows[:2] == ["Sun", "Mon"], dows)
    chips = [c.strip() for c in pg.get_by_test_id("cal-filters").locator("button[aria-pressed]").all_inner_texts()]
    # v1.328.0 - R-2: the lives left with the roster; task blocks stay as Booked work, off by default
    check("type filters Booked work (off), Deadlines, Reviews, Milestones - no live, no Client Meetings", chips == ["Booked work", "Deadlines", "Reviews", "Milestones"] and "Client Meetings" not in t
          and pg.get_by_test_id("cal-type-task").get_attribute("aria-pressed") == "false", chips)
    check("Month, Week and List", all(vis(pg, f"cal-mode-{k}") for k in ["month", "week", "list"]))
    panel = pg.get_by_test_id("cal-day-panel").inner_text()
    check("the day panel: no booked work until it is turned on, and never the live (it is the roster's)", "09:30" not in panel and "14:00" not in panel, panel[:300])
    pg.get_by_test_id("cal-type-task").click(); pg.wait_for_timeout(300)
    panel = pg.get_by_test_id("cal-day-panel").inner_text()
    check("...Booked work turned on shows today's task block", "09:30" in panel and "14:00" not in panel, panel[:300])
    check("Overdue Carry-Overs lists the overdue work", "Overdue Carry-Overs" in panel and pg.locator('[data-testid="cal-overdue"] li').count() >= 1)
    pg.get_by_test_id("cal-type-task").click(); pg.wait_for_timeout(300)
    check("a type turns off", "09:30" not in pg.get_by_test_id("cal-day-panel").inner_text())
    pg.get_by_test_id("cal-mode-week").click(); pg.wait_for_timeout(600)
    check("Week shows seven days", pg.locator('[data-testid="cal-grid"] [role=gridcell]').count() == 7)
    check("the roster board left the Calendar for Roster & Scheduling (R-1); one line points there", pg.locator("#roster-board").count() == 0 and vis(pg, "cal-roster-link"))
    ctx.close()
    ctx, pg, errs2 = open_page(b, CEO, w=390, view="calendar")
    check("phone: a date agenda, not the shrunk grid", vis(pg, "cal-agenda") and not vis(pg, "cal-grid"))
    ctx.close()
    check("no page error (Calendar)", not errs and not errs2, errs + errs2)

    # ---------------- 06 Reports & Archive (image 5) ----------------
    ctx, pg, errs = open_page(b, CEO, view="reports")
    t = " ".join(zone_text(pg))
    check("Reports: Reports Submitted, Awaiting Review, Archived - the Live Host figure left with its card", all(w in t for w in ["Reports Submitted", "Awaiting Review", "Archived"]) and "Live Host Sessions" not in t and "Gate 4" not in t, t[:300])
    check("the operational reports; the Live Host card is not here (R-4)", vis(pg, "task-reports") and pg.get_by_test_id("live-host-card").count() == 0)
    rep = pg.get_by_test_id("task-reports")
    check("Gate 4: an operational report shows its status and management can mark it reviewed", "Reviewed" in rep.inner_text() and "Submitted" in rep.inner_text() and rep.get_by_test_id("report-review").count() >= 1)
    check("the archive of closed tasks is kept", pg.locator("#task-archive").count() == 1)
    ctx.close()
    # v1.328.0 - R-4: the live report is Roster & Scheduling > Live Reports
    # v1.368.0 - now the CEO's picture: one report per live, shared by everyone who took part
    ctx, pg, errs = open_page(b, CEO, view="reports", tab="Roster & Scheduling")
    pg.wait_for_selector("[data-testid=live-table]", timeout=15000)
    check("Live Reports is in Roster & Scheduling > Live Reports (figures, table, analysis)", vis(pg, "live-reports") and vis(pg, "live-kpis") and vis(pg, "live-table") and vis(pg, "live-analysis"))
    check("Gate 4: the page says reported GMV is never verified sales, cash, an invoice or commission", "not verified sales, cash" in pg.get_by_test_id("live-reports").inner_text())
    check("Gate 4: the reviewer sees the reports, Farid's submitted one first", vis(pg, "live-row-11") and "RM 2,480.50" in pg.get_by_test_id("live-row-11").inner_text())
    pg.get_by_test_id("live-view-11").click(); pg.wait_for_selector("[data-testid=live-detail]", timeout=10000); pg.wait_for_timeout(600)
    det = pg.get_by_test_id("live-detail")
    check("…opening one shows the GMV, the screenshot and Accept", pg.get_by_test_id("live-fig-gmv").input_value() == "2480.5" and vis(pg, "live-accept") and det.locator("a[href*='/live-reports/11/files/']").count() >= 1, det.inner_text()[:300])
    check("…who took part, host and co-host", "Farid Zul" in pg.get_by_test_id("live-participants").inner_text() and "Co-host" in pg.get_by_test_id("live-participants").inner_text())
    before = len(json.loads(urllib.request.urlopen(f"http://127.0.0.1:{CEO}/__tasks").read())["posts"])
    pg.get_by_test_id("live-accept").click(); pg.wait_for_timeout(900)
    posts = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{CEO}/__tasks").read())["posts"][before:]
    check("…Accept sends the one review to that report", any(x["p"] == "/staff/live-reports/11/review" and '"accept"' in str(x["body"]) for x in posts), posts)
    check("…the history shows the submitted version", "Version 1 submitted" in det.inner_text())
    ctx.close()
    # ---- someone who took part (a live host on a phone): a returned report, then a new one ----
    ctx, pg, errs3 = open_page(b, HOST, w=390, view="reports", tab="Roster & Scheduling")
    pg.wait_for_selector("[data-testid=live-reports]", timeout=15000); pg.wait_for_timeout(800)
    check("host: cards on a phone, not the table", vis(pg, "live-card-13") and not vis(pg, "live-table"))
    pg.get_by_test_id("live-card-13").click(); pg.wait_for_selector("[data-testid=live-detail]", timeout=10000); pg.wait_for_timeout(600)
    check("…the correction asked for is shown", "cut off" in pg.get_by_test_id("live-detail").inner_text())
    check("…the form: project, figures, screenshot, Submit / Save draft", all(vis(pg, k) for k in ["live-project", "live-fig-gmv", "live-fig-duration_min", "live-submit", "live-save"]) and pg.get_by_test_id("live-upload").count() == 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    pg.get_by_test_id("live-new").click(); pg.wait_for_timeout(600)
    pg.get_by_test_id("live-start-72").click(); pg.wait_for_timeout(1200)
    posts = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{HOST}/__tasks").read())["posts"]
    check("host: choosing a live on the roster starts its report (the session, never the host's id)", any(x["p"] == "/staff/live-reports" and '"session_id": 72' in str(x["body"]).replace('"session_id":72', '"session_id": 72') for x in posts), posts[-3:])
    check("no sideways page (host, phone)", no_hscroll(pg))
    ctx.close()
    check("no page error (host)", not errs3, errs3)
    check("no page error (Reports)", not errs, errs)

    # ---------------- the phone ----------------
    ctx, pg, errs = open_page(b, CEO, w=390)
    check("phone: the view switch and Create Task, not the tab row", vis(pg, "tasks-view-bar") and pg.get_by_role("tablist", name="Tasks").get_by_role("tab").filter(visible=True).count() == 0)
    pg.get_by_test_id("tasks-view-bar").get_by_test_id("view-switch").click(); pg.wait_for_timeout(300)
    pg.get_by_role("menuitemradio", name=re.compile("My Tasks")).click(); pg.wait_for_timeout(900)
    check("phone: the switch opens My Tasks and writes the address", view_of(pg) == "mine", pg.url)
    ctx.close()
    check("no page error (phone)", not errs, errs)

    # ---------------- eight widths, every view: no sideways page ----------------
    for w in WIDTHS:
        bad = []
        for k in VIEWS:
            ctx, pg, errs = open_page(b, CEO, w=w, view=k)
            if not no_hscroll(pg): bad.append(k)
            if errs: bad.append(k + ":error")
            ctx.close()
        check(f"{w}px: no sideways page on any of the six views", not bad, bad)

    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

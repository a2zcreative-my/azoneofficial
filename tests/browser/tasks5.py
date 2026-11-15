"""TASKS WORKSPACE 5.0 (v1.313.0), Gate 3 - in a browser (the CEO's "Approved
as per recommendations both", 15-11-2026; claude/TASKS-WORKSPACE-5.0-BLUEPRINT.md).
The six tabs against the five board images (and TK-2 for the Overview):
the figures, the register columns, the preview beside My Tasks, the four
cards under it, the All Tasks side column with Edit, the Project Register
and the project beside it, the work calendar (Sunday first, no Client
Meetings - TK-10), Reports & Archive with the Live Host card marked for
Gate 4 (no pretended form), the phone's view switch and agenda, and the
eight widths with no sideways page. Fixture data is invented
(tests/browser/fixture.mjs); no production figure is used.

Servers (from servers.txt):
    4177 ceo · 4180 live_host
"""
from playwright.sync_api import sync_playwright
import re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, HOST = 4177, 4180
VIEWS = ["overview", "mine", "all", "projects", "calendar", "reports"]
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, port, w=1440, h=1000, view=None):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Tasks" + (f"&view={view}" if view else "")); pg.wait_for_timeout(3200)
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
    tabs = [t.strip() for t in pg.get_by_role("tab").filter(visible=True).all_inner_texts()]
    check("exactly six tabs in the board's order", tabs == ["Overview", "My Tasks", "All Tasks", "Projects", "Calendar", "Reports & Archive"], tabs)
    check("Create Task is the tab row's action", pg.get_by_role("button", name=re.compile("Create Task")).filter(visible=True).count() == 1)
    names = {"mine": "My Tasks", "all": "All Tasks", "projects": "Projects", "calendar": "Calendar", "reports": "Reports & Archive"}
    for k, n in names.items():
        pg.get_by_role("tab", name=n, exact=True).click(); pg.wait_for_timeout(900)
        check(f"the {n} tab writes view={k}", view_of(pg) == k, pg.url)
    pg.go_back(); pg.wait_for_timeout(900)
    check("Back returns to Calendar", view_of(pg) == "calendar" and vis(pg, "work-calendar"), pg.url)
    ctx.close()
    check("no page error (tabs)", not errs, errs)

    # ---------------- 01 Overview (TK-2) ----------------
    ctx, pg, errs = open_page(b, CEO, view="overview")
    t = " ".join(zone_text(pg))
    check("Overview: the four figures - My Open Tasks, In Progress, Overdue, Awaiting Review", all(w in t for w in ["My Open Tasks", "In Progress", "Overdue", "Awaiting Review"]), t[:300])
    check("Overview: My Priority Work, Team Attention (management) and Recent Progress", vis(pg, "priority-work") and vis(pg, "team-attention") and vis(pg, "progress-overview"))
    first = pg.get_by_test_id("priority-work").locator("li button").first
    check("My Priority Work: overdue first (the urgent overdue task leads)", first.count() == 1 and "Approve the October content plan" in first.inner_text(), first.inner_text() if first.count() else "")
    check("Overview repeats nothing: no status donut, no recently-closed list, no team table", "Recently Closed Tasks" not in t and "Task Progress — Company Wide" not in t)
    first.click(); pg.wait_for_timeout(1200)
    check("a priority row opens the task itself", pg.locator("[data-record^='task:']:visible").count() > 0 or pg.get_by_role("dialog").count() > 0)
    ctx.close()
    ctx, pg, errs2 = open_page(b, HOST, view="overview")
    check("a live host sees no Team Attention; Recent Progress takes its place", not vis(pg, "team-attention") and vis(pg, "progress-overview"))
    ctx.close()
    check("no page error (Overview)", not errs and not errs2, errs + errs2)

    # ---------------- 02 My Tasks (image 1) ----------------
    ctx, pg, errs = open_page(b, CEO, view="mine")
    t = " ".join(zone_text(pg))
    check("My Tasks: Assigned Today, Due Soon, Overdue, Completed This Week", all(w in t for w in ["Assigned Today", "Due Soon", "Overdue", "Completed This Week"]), t[:300])
    heads = [h.strip() for h in pg.locator("table:visible").first.locator("thead th").all_inner_texts()]
    check("the list's columns are the board's", heads[:8] == ["Task & Context", "Status", "Priority", "Due Date", "Assignee", "Progress", "Subtasks", "Actions"], heads)
    check("priority reads High / Medium / Low / Urgent (TK-3)", "Medium" in pg.locator("table:visible").first.inner_text())
    check("1440px: the chosen task is shown beside the list", vis(pg, "task-preview"))
    row = pg.locator("table:visible tbody tr").nth(1)
    title = row.locator("td").first.locator("button").first.inner_text()
    row.locator("td").nth(4).click(); pg.wait_for_timeout(600)
    check("choosing a row shows that task beside the list", title in pg.get_by_test_id("task-preview").inner_text(), title)
    check("the four cards under it: My Focus, Today's Agenda, Upcoming Deadlines, Recent Updates", all(vis(pg, k) for k in ["my-focus", "my-agenda", "my-deadlines", "my-recent"]))
    check("Today's Agenda reads today's task block from the roster", "09:30" in pg.get_by_test_id("my-agenda").inner_text() and "Sign the hotel partnership letter" in pg.get_by_test_id("my-agenda").inner_text(), pg.get_by_test_id("my-agenda").inner_text())
    ctx.close()
    ctx, pg, errs2 = open_page(b, CEO, w=1024, view="mine")
    check("1024px: the preview steps aside and the list has the width", not vis(pg, "task-preview") and no_hscroll(pg))
    ctx.close()
    check("no page error (My Tasks)", not errs and not errs2, errs + errs2)

    # ---------------- 03 All Tasks (image 3) ----------------
    ctx, pg, errs = open_page(b, CEO, view="all")
    t = " ".join(zone_text(pg))
    check("All Tasks: Open Tasks, In Progress, Waiting Review, Overdue, Closed This Week", all(w in t for w in ["Open Tasks", "In Progress", "Waiting Review", "Overdue", "Closed This Week"]), t[:300])
    heads = [h.strip() for h in pg.locator("table:visible").first.locator("thead th").all_inner_texts()]
    check("the register has the Department column", "Department" in heads, heads)
    check("a department is read from the person's record", "Sales" in pg.locator("table:visible").first.inner_text())
    check("the side column: Workload Balance, Department Breakdown, Quick Approvals", all(vis(pg, k) for k in ["workload-card", "department-card", "quick-approvals"]))
    edit = pg.locator('[data-testid="row-edit"]:visible').first
    check("Edit on each open row", edit.count() == 1)
    edit.click(); pg.wait_for_timeout(1200)
    check("Edit opens the task with its edit form (title, dates, priority, assignee)", pg.get_by_role("button", name=re.compile("^Save")).filter(visible=True).count() >= 1)
    ctx.close()
    ctx, pg, errs2 = open_page(b, HOST)
    tabs = [t.strip() for t in pg.get_by_role("tab").filter(visible=True).all_inner_texts()]
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
    ctx.close()
    check("no page error (Projects)", not errs, errs)

    # ---------------- 05 Calendar (image 2, TK-10) ----------------
    ctx, pg, errs = open_page(b, CEO, view="calendar")
    t = " ".join(zone_text(pg))
    check("Calendar: Events Today, Due This Week, Reviews, Milestones This Month", all(w in t for w in ["Events Today", "Due This Week", "Reviews", "Milestones This Month"]), t[:300])
    dows = [d.strip() for d in pg.locator('[data-testid="cal-grid"] [role=columnheader]').all_inner_texts()]
    check("the month starts on Sunday, as the board", dows[:2] == ["Sun", "Mon"], dows)
    chips = [c.strip() for c in pg.get_by_test_id("cal-filters").locator("button[aria-pressed]").all_inner_texts()]
    check("type filters Tasks, Deadlines, Reviews, Live Sessions, Milestones - no Client Meetings (nothing records one)", chips == ["Tasks", "Deadlines", "Reviews", "Live Sessions", "Milestones"] and "Client Meetings" not in t, chips)
    check("Month, Week and List", all(vis(pg, f"cal-mode-{k}") for k in ["month", "week", "list"]))
    panel = pg.get_by_test_id("cal-day-panel").inner_text()
    check("the day panel: today's schedule with the task block and the live", "09:30" in panel and "14:00" in panel, panel[:300])
    check("Overdue Carry-Overs lists the overdue work", "Overdue Carry-Overs" in panel and pg.locator('[data-testid="cal-overdue"] li').count() >= 1)
    pg.get_by_test_id("cal-type-live").click(); pg.wait_for_timeout(300)
    check("a type turns off", "14:00" not in pg.get_by_test_id("cal-day-panel").inner_text())
    pg.get_by_test_id("cal-mode-week").click(); pg.wait_for_timeout(600)
    check("Week shows seven days", pg.locator('[data-testid="cal-grid"] [role=gridcell]').count() == 7)
    check("the roster board stays on Calendar (A-3)", pg.locator("#roster-board").count() == 1)
    ctx.close()
    ctx, pg, errs2 = open_page(b, CEO, w=390, view="calendar")
    check("phone: a date agenda, not the shrunk grid", vis(pg, "cal-agenda") and not vis(pg, "cal-grid"))
    ctx.close()
    check("no page error (Calendar)", not errs and not errs2, errs + errs2)

    # ---------------- 06 Reports & Archive (image 5) ----------------
    ctx, pg, errs = open_page(b, CEO, view="reports")
    t = " ".join(zone_text(pg))
    check("Reports: Reports Submitted, Awaiting Review, Archived, Live Host Sessions", all(w in t for w in ["Reports Submitted", "Awaiting Review", "Archived", "Live Host Sessions"]), t[:300])
    check("the operational reports beside the Live Host card", vis(pg, "task-reports") and vis(pg, "live-host-card"))
    lh = pg.get_by_test_id("live-host-card").inner_text()
    check("the Live Host card says Gate 4 and pretends no form or GMV figure", "Gate 4" in lh and "Phase 2" in lh and pg.get_by_test_id("live-host-card").locator("input, textarea").count() == 0, lh[:300])
    check("the archive of closed tasks is kept", pg.locator("#task-archive").count() == 1)
    ctx.close()
    check("no page error (Reports)", not errs, errs)

    # ---------------- the phone ----------------
    ctx, pg, errs = open_page(b, CEO, w=390)
    check("phone: the view switch and Create Task, not the tab row", vis(pg, "tasks-view-bar") and pg.get_by_role("tab").filter(visible=True).count() == 0)
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

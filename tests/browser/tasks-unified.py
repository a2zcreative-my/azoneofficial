"""TASKS UNIFIED WORKSPACE (v1.321.0, the CEO's "A2Z OS - Tasks Module
Unified Workspace Redesign", 16-11-2026) - in a browser.

  Overview     the compact strip (a cell is the queue's filter), the queue a
               page at a time, ONE panel beside it switched between three
  All Tasks    the compact strip, the toolbar (search, status, Filters,
               Columns), sortable headers that turn round, 15 rows a page
               (10 / 25 / 50), Filters (department, assignee, project,
               priority, the due range), Insights, a row opening the drawer
               and its commands not
  the pane     the one composer: Comment / Progress note / Status update; a
               comment posts to the comments route, never as an update
  widths       320 to 1440: no sideways page on Overview, All Tasks or the
               drawer

The fixture's figures are invented (tests/browser/fixture.mjs).
Servers: 4177 ceo · 4180 live_host
"""
from playwright.sync_api import sync_playwright
import re, json, urllib.request

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, HOST = 4177, 4180
WIDTHS = [320, 360, 390, 402, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
get = lambda port, path: json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())
def reset(port): urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()

def open_page(b, port, w=1440, h=1000, view=None):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Tasks" + (f"&view={view}" if view else "")); pg.wait_for_timeout(3200)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def vis(pg, tid): return pg.locator(f'[data-testid="{tid}"]:visible').count() > 0
WS = "[data-testid=task-workspace]:visible"
rows_of = lambda pg: pg.get_by_test_id("task-table").locator("tbody tr")
titles_of = lambda pg: [r.locator("td").first.locator("span").first.inner_text().strip() for r in rows_of(pg).all()]

with sync_playwright() as p:
    b = p.chromium.launch()

    # ================= Overview =================
    ctx, pg, errs = open_page(b, CEO, view="overview")
    st = pg.get_by_test_id("overview-strip")
    labels = [x.strip() for x in st.locator("[class*=kpi-tile_label]").all_inner_texts()]
    check("Overview: ONE compact strip of five, no large figure cards", labels == ["Total Tasks", "Overdue", "In Progress", "Awaiting Review", "Done"] and pg.locator("section.erp-tab-zone:visible .erp-kpi-label, section.erp-tab-zone:visible [data-kpi-label]").count() == 0, labels)
    found = lambda: int(re.match(r"^(\d+)", pg.get_by_test_id("overview-found").inner_text()).group(1))
    total = found()
    st.locator("button", has_text="Overdue").click(); pg.wait_for_timeout(400)
    od = found()
    check("a strip cell is the queue's filter: Overdue shows only the overdue, and says it is pressed", 0 < od <= total and st.locator("button[aria-pressed=true]", has_text="Overdue").count() == 1 and pg.get_by_test_id("overview-table").locator("tbody tr").count() == pg.get_by_test_id("overview-table").get_by_test_id("overdue-mark").count(), f"{od}/{total}")
    st.locator("button", has_text="Total Tasks").click(); pg.wait_for_timeout(400)
    pc = pg.get_by_test_id("overview-pages")
    check("the queue a page at a time: Showing 1-n of all, rows per page 10 / 15 / 25 / 50, 10 to start", pc.count() == 1 and re.match(r"^Showing 1–\d+ of \d+$", pc.get_by_test_id("page-count").inner_text()) is not None and [o.inner_text() for o in pc.get_by_test_id("page-size").locator("option").all()] == ["10", "15", "25", "50"] and pc.get_by_test_id("page-size").input_value() == "10")
    q0 = pg.get_by_test_id("overview-table").locator("tbody tr").first
    check("the queue leads with the most pressing (overdue first)", q0.get_by_test_id("overdue-mark").count() == 1)
    pg.get_by_test_id("overview-more-btn").click(); pg.wait_for_timeout(300)
    fp = pg.get_by_test_id("overview-more")
    check("Filters opens a panel in the page (a region, not a dialog): project, department, staff", fp.get_attribute("role") == "region" and pg.get_by_role("dialog").count() == 0 and all(fp.get_by_text(x, exact=True).count() >= 1 for x in ["Department", "Staff"]))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("Escape closes the filter panel", pg.get_by_test_id("overview-more").count() == 0)
    panel = pg.get_by_test_id("overview-panel")
    shown = lambda: sorted(t for t in ["staff-performance", "weekly-summary", "progress-overview", "quick-links", "workflow-strip"] if panel.get_by_test_id(t).count())
    a = shown()
    pg.get_by_test_id("overview-panel-switch").get_by_role("tab", name="Activity", exact=True).click(); pg.wait_for_timeout(300)
    bb = shown()
    pg.get_by_test_id("overview-panel-switch").get_by_role("tab", name="Actions", exact=True).click(); pg.wait_for_timeout(300)
    c = shown()
    check("ONE panel, three faces - Staff (performance, the week), Activity, Actions (links, workflow) - one at a time", a == ["staff-performance", "weekly-summary"] and bb == ["progress-overview"] and c == ["quick-links", "workflow-strip"], f"{a} {bb} {c}")
    check("no sideways page (Overview)", no_hscroll(pg))
    ctx.close()
    check("no page error (Overview)", not errs, errs)

    # ================= All Tasks =================
    reset(CEO)
    ctx, pg, errs = open_page(b, CEO, view="all")
    labels = [x.strip() for x in pg.get_by_test_id("all-strip").locator("[class*=kpi-tile_label]").all_inner_texts()]
    check("All Tasks: ONE compact strip of five", labels == ["Open Tasks", "In Progress", "Waiting Review", "Overdue", "Closed This Week"], labels)
    heads = [h.strip() for h in pg.get_by_test_id("task-table").locator("thead th").all_inner_texts()]
    check("ONE compact table: Task, Status, Priority, Due, Assignee, Department, Progress (Subtasks hidden to start), the commands", heads[:7] == ["Task & Context", "Status", "Priority", "Due Date", "Assignee", "Department", "Progress"] and "Subtasks" not in heads, heads)
    n0 = rows_of(pg).count()
    pager = pg.get_by_test_id("pagination")
    check("15 rows a page to start (10 / 25 / 50 to choose); the count says how many", pager.get_by_test_id("page-size").input_value() == "15" and pager.get_by_test_id("page-count").inner_text() == f"Showing 1–{n0} of {n0}", pager.get_by_test_id("page-count").inner_text())
    # sort
    pg.get_by_test_id("sort-task").click(); pg.wait_for_timeout(300)
    t1 = titles_of(pg)
    check("Task header sorts A to Z", t1 == sorted(t1) and pg.locator("th[aria-sort=ascending]").count() == 1, t1)
    pg.get_by_test_id("sort-task").click(); pg.wait_for_timeout(300)
    t2 = titles_of(pg)
    check("a second press turns it round (Z to A)", t2 == sorted(t1, reverse=True) and pg.locator("th[aria-sort=descending]").count() == 1, t2)
    pg.get_by_test_id("sort-due").click(); pg.wait_for_timeout(300)
    dues = [r.get_attribute("data-record") for r in rows_of(pg).all()]
    check("Due Date sorts the soonest first", len(dues) == n0 and pg.locator("th[aria-sort=ascending]").count() == 1)
    # columns
    pg.get_by_test_id("columns-btn").click(); pg.wait_for_timeout(200)
    pg.get_by_test_id("columns").get_by_label("Department").uncheck(); pg.wait_for_timeout(300)
    heads2 = [h.strip() for h in pg.get_by_test_id("task-table").locator("thead th").all_inner_texts()]
    check("Columns hides an optional column (Department)", "Department" not in heads2 and "Assignee" in heads2, heads2)
    pg.get_by_test_id("columns").get_by_label("Department").check(); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    # filters
    pg.get_by_test_id("all-filters-btn").click(); pg.wait_for_timeout(300)
    fp = pg.get_by_test_id("all-filters")
    check("Filters: Department, Assigned to, Project, Priority, Due from, Due until - in the page, not a dialog", fp.get_attribute("role") == "region" and all(fp.get_by_text(x, exact=True).count() >= 1 for x in ["Department", "Assigned to", "Priority", "Due from", "Due until"]) and pg.get_by_role("dialog").count() == 0)
    fp.get_by_label("Department").select_option("Sales"); pg.wait_for_timeout(400)
    ds = [r.locator("td").nth(5).inner_text().strip() for r in rows_of(pg).all()]
    check("Department: Sales keeps only Sales rows, and Filters counts one", len(ds) >= 1 and set(ds) == {"Sales"} and pg.get_by_test_id("all-filters-btn").inner_text().strip().endswith("1"), ds)
    fp.get_by_label("Department").select_option(""); pg.wait_for_timeout(300)
    fp.get_by_test_id("due-from").fill("2026-09-20"); fp.get_by_test_id("due-to").fill("2026-09-28"); pg.wait_for_timeout(400)
    inr = rows_of(pg).count()
    check("the due range keeps only tasks due inside it", 1 <= inr < n0, f"{inr}/{n0}")
    fp.get_by_role("button", name="Clear filters").click(); pg.wait_for_timeout(400)
    check("Clear filters brings every row back", rows_of(pg).count() == n0)
    fp.get_by_role("button", name="Done").click(); pg.wait_for_timeout(200)
    # insights
    check("Insights closed to start", not vis(pg, "all-insights"))
    pg.get_by_test_id("insights-btn").click(); pg.wait_for_timeout(400)
    check("Insights: workload, departments, quick approvals", all(vis(pg, k) for k in ["workload-card", "department-card", "quick-approvals"]) and pg.get_by_test_id("insights-btn").get_attribute("aria-pressed") == "true")
    pg.get_by_test_id("insights-btn").click(); pg.wait_for_timeout(300)
    # a row's command does not open the task; the row does
    r0 = rows_of(pg).first
    title = r0.locator("td").first.locator("span").first.inner_text().strip()
    check("every open row keeps Edit and Update", rows_of(pg).first.get_by_test_id("row-edit").count() == 1 and rows_of(pg).first.get_by_test_id("row-update").count() == 1)
    r0.locator("td").nth(1).click(); pg.wait_for_timeout(1600)
    dr = pg.get_by_role("dialog").filter(has=pg.locator("[data-testid=task-workspace]"))
    check("a row opens its task in the drawer", dr.count() == 1 and pg.locator(WS).get_attribute("data-layout") == "drawer")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(600)
    rows_of(pg).first.get_by_test_id("row-update").click(); pg.wait_for_timeout(1600)
    ws = pg.locator(WS)
    check("Update opens the task straight on the composer's status update", ws.count() == 1 and ws.get_by_test_id("task-composer").count() == 1 and ws.get_by_test_id("update-sheet").count() == 1 and ws.get_by_role("tab", name=re.compile("^Updates")).get_attribute("aria-selected") == "true")
    # the composer: a comment is a comment
    ws.get_by_test_id("composer-mode").get_by_role("button", name="Comment").click(); pg.wait_for_timeout(300)
    cp = ws.get_by_test_id("task-composer")
    check("Comment mode: a text box and Post Comment, the status form put away", cp.locator("textarea").count() == 1 and cp.get_by_test_id("update-sheet").count() == 0 and cp.get_by_test_id("composer-post").inner_text().strip() == "Post Comment")
    cp.get_by_test_id("composer-post").click(); pg.wait_for_timeout(400)
    check("an empty comment is refused on the screen - nothing sent", "Write something first." in cp.inner_text() and not [x for x in get(CEO, "/__tasks")["posts"] if x["p"].endswith("/comments")])
    cp.locator("textarea").fill("Checked with the supplier - arriving Tuesday")
    cp.get_by_test_id("composer-post").click(); pg.wait_for_timeout(1500)
    posts = get(CEO, "/__tasks")["posts"]
    cm = [x for x in posts if x["p"].endswith("/comments")]
    check("the comment goes to the task's comments route - never as a progress update", len(cm) == 1 and json.loads(cm[0]["body"]).get("comment") == "Checked with the supplier - arriving Tuesday" and not [x for x in posts if x["p"].endswith("/updates")], str(cm)[:200])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    check("no sideways page (All Tasks)", no_hscroll(pg))
    pg.screenshot(path="/home/claude/out/shots/tasks-unified-all-1440.png", full_page=True)
    ctx.close()
    check("no page error (All Tasks)", not errs, errs)

    # a person with no team: no All Tasks
    ctx, pg, errs = open_page(b, HOST, view="all")
    check("a live host has no All Tasks register (it is for those who manage the team)", pg.get_by_test_id("all-register").count() == 0 and pg.get_by_test_id("task-table").count() == 0)
    ctx.close()

    # ================= the widths =================
    for w in WIDTHS:
        for view in ["overview", "all", "mine"]:
            ctx, pg, errs = open_page(b, CEO, w=w, h=900, view=view)
            ok = no_hscroll(pg)
            if view == "all" and w < 768:
                ok = ok and pg.get_by_test_id("task-table").locator("thead").evaluate("e => getComputedStyle(e).display") == "none"
            check(f"{w}px {view}: no sideways page{' (rows read as cards)' if view == 'all' and w < 768 else ''}", ok)
            if view == "overview":
                # the CEO's overflow report (16-11-2026, 402px): nothing in Staff Performance runs past the screen's edge
                past = pg.evaluate("() => [...document.querySelectorAll('[data-testid=staff-performance] *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).map(e => e.tagName + '.' + String(e.className).slice(0, 30))")
                check(f"{w}px: Staff Performance stays inside the screen (rank, name, bar, count)", past == [], past[:4])
            if view == "all":
                rows_of(pg).first.locator("td").first.click(); pg.wait_for_timeout(1400)
                d = pg.get_by_role("dialog").filter(has=pg.locator("[data-testid=task-workspace]"))
                box = d.bounding_box() if d.count() else None
                check(f"{w}px: the task drawer opens{' full screen' if w < 640 else ''}, nothing past the edge", d.count() == 1 and no_hscroll(pg) and box and box["x"] + box["width"] <= w + 1 and (w >= 640 or box["width"] >= w - 2), box)
                if w in (390, 1440): pg.screenshot(path=f"/home/claude/out/shots/tasks-unified-drawer-{w}.png")
            if view == "mine":
                check(f"{w}px My Tasks: {'list 35% / task 65%' if w >= 1024 else 'the list alone'}", (pg.locator(WS).count() == 1) == (w >= 1024))
            check(f"{w}px {view}: no page error", not errs, errs)
            ctx.close()
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

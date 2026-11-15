"""TASKS 2.0, STAGE 1 (v1.319.0) - in a browser (the CEO's seven pictures and
"Proceed the recommend", 15-11-2026; claude/TASKS-2.0-STAGE-0-AUDIT.md).

  Overview (picture 5)   five figures; the list as a Table or a Board with
                         its own filters; Staff Performance for management,
                         My Tasks (Today) for everyone else; Quick Links;
                         Recent Activity; the workflow; the week's closures
  My Tasks (pictures 2, 3)  the card list with the chosen task beside it
                         from 1280px - its four steps, Task Information, the
                         Current Stage, the update form always open, Notes /
                         Files / Activity; the four-column board
  The task page (picture 4)  the facts strip, the sections, Back to the list;
                         the browser's Back closes it; no record in the
                         address
  The words (T2-5)       To Do, In Progress, Review, Done; tags beside them
  A phone                the drawer, as before; no sideways page at any of
                         the eight widths, in any of the three shapes

The fixture's figures are invented (tests/browser/fixture.mjs).

Servers (from servers.txt):
    4177 ceo · 4180 live_host
"""
from playwright.sync_api import sync_playwright
import re, json, urllib.request

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, HOST = 4177, 4180
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
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
OVER = """(sel) => { const d = document.querySelector(sel); if (!d) return ['none']; const bad = [];
  const scrolls = (el) => { for (let x = el.parentElement; x && x !== d.parentElement; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  for (const el of d.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (b.width && b.right > window.innerWidth + 1 && !scrolls(el)) bad.push(el.tagName + '.' + String(el.className).slice(0, 30)); } return bad.slice(0, 5); }"""

with sync_playwright() as p:
    b = p.chromium.launch()

    # ================= Overview (picture 5) =================
    ctx, pg, errs = open_page(b, CEO, view="overview")
    tiles = [t.strip() for t in pg.locator("section.erp-tab-zone:visible [data-kpi-label], section.erp-tab-zone:visible .erp-kpi-label").all_inner_texts()]
    zone = pg.locator("section.erp-tab-zone:visible").first.inner_text()
    check("five figures in the picture's order: Total Tasks, Overdue, In Progress, Awaiting Review, Done", all(w in zone for w in ["Total Tasks", "Overdue", "In Progress", "Awaiting Review", "Done"]) and zone.index("Total Tasks") < zone.index("Overdue") < zone.index("Awaiting Review"), zone[:200])
    rows = pg.get_by_test_id("overview-table").locator("tbody tr")
    n = rows.count()
    found = pg.get_by_test_id("overview-found").inner_text()
    check("the list says how many tasks it found, and shows the most pressing eight at most", re.match(r"^\d+ task\(s\) found$", found) is not None and 1 <= n <= 8, f"{found} / {n}")
    heads = [h.strip() for h in pg.get_by_test_id("overview-table").locator("thead th").all_inner_texts()]
    check("the table's columns are the picture's", heads == ["Task Title", "Project / Client", "Assigned To", "Priority", "Due Date", "Status", "Progress"], heads)
    r0 = rows.first
    check("a row: the title with its task number, a priority chip, the status word and a progress bar", re.search(r"TSK-\d{6}", r0.inner_text()) is not None and r0.get_by_test_id("prio-chip").count() == 1 and r0.get_by_test_id("state-chip").count() == 1 and r0.locator("[role=progressbar]").count() == 1, r0.inner_text()[:160])
    words = set(c.inner_text().strip().split("\n")[0] for c in pg.get_by_test_id("overview-table").get_by_test_id("state-chip").all())
    check("status reads in the four words only (T2-5)", words <= {"To Do", "In Progress", "Review", "Done", "Cancelled"} and len(words) >= 1, words)
    check("an overdue task wears a red Overdue marker and keeps its own status word (T2-6)", r0.get_by_test_id("overdue-mark").count() == 1 and r0.get_by_test_id("state-chip").count() == 1)
    # the status filter narrows the list; the tile is the same filter
    total = int(re.match(r"^(\d+)", found).group(1))
    sel = pg.get_by_test_id("overview-filters").get_by_label("Status", exact=True)
    sel.select_option("done"); pg.wait_for_timeout(400)
    dn = int(re.match(r"^(\d+)", pg.get_by_test_id("overview-found").inner_text()).group(1))
    dw = set(c.get_attribute("data-flow") for c in pg.get_by_test_id("overview-table").get_by_test_id("state-chip").all()) if dn else {"done"}
    check("Status: Done shows only done tasks, fewer than all", dn < total and dw == {"done"}, f"{dn}/{total} {dw}")
    sel.select_option(""); pg.wait_for_timeout(300)
    # Table / Board
    pg.get_by_test_id("overview-mode").get_by_role("button", name="Board").click(); pg.wait_for_timeout(500)
    cols = [c.get_attribute("data-flow") for c in pg.get_by_test_id("flow-board").locator("section[data-flow]").all()]
    check("Board: four columns - To Do, In Progress, Review, Done", cols == ["todo", "in_progress", "review", "done"] and pg.get_by_test_id("overview-table").count() == 0, cols)
    counts = [int(c.inner_text()) for c in pg.get_by_test_id("flow-board").locator("header strong span").all()]
    check("the four columns hold every task of the list between them (a cancelled task stands in none)", 0 < sum(counts) <= total, f"{counts} of {total}")
    pg.get_by_test_id("overview-mode").get_by_role("button", name="Table").click(); pg.wait_for_timeout(400)
    # the rail
    sp = pg.get_by_test_id("staff-performance")
    check("Staff Performance (management): ranked people, each closed / held with the share, and the rule said in words", sp.count() == 1 and "Closed this week ÷ tasks held this week" in pg.get_by_test_id("perf-rule").inner_text() and (sp.locator("ol li").count() == 0 or re.search(r"\d+ / \d+ \(\d+%\)", sp.inner_text()) is not None), sp.inner_text()[:200])
    ql = [x.strip() for x in pg.get_by_test_id("quick-links").locator("button").all_inner_texts()]
    check("Quick Links: Create Task, Projects, Staff Tasks, Reports", ql == ["Create Task", "Projects", "Staff Tasks", "Reports"], ql)
    wf = [li.get_attribute("data-flow") for li in pg.get_by_test_id("workflow-strip").locator("li").all()]
    wt = pg.get_by_test_id("workflow-strip").inner_text()
    check("the workflow strip is the real flow - no HOD, the review by whoever set it, the Project Owner or management", wf == ["todo", "in_progress", "review", "done"] and "HOD" not in wt and "Project Owner or management" in wt, wt[:200])
    wk = pg.get_by_test_id("weekly-summary")
    check("Weekly Summary: seven days, Monday first", [x.strip() for x in wk.locator("ol li small").all_inner_texts()] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    check("no trend is drawn without its history (no '+12%')", re.search(r"[+\-]\d+%", zone) is None, zone[:200])
    pg.get_by_test_id("ql-create").click(); pg.wait_for_timeout(700)
    check("Quick Links: Create Task opens the one create form", pg.get_by_role("dialog").filter(has_text=re.compile("Create / assign a task|Create a task")).count() == 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    check("no sideways page (Overview, 1440)", no_hscroll(pg))
    pg.screenshot(path="/home/claude/out/shots/tasks2-overview-1440.png", full_page=True)

    # ================= the task page (picture 4) =================
    title = r0.get_by_role("button").first.inner_text().strip()
    before = pg.url
    r0.get_by_role("button").first.click(); pg.wait_for_timeout(1800)
    ws = pg.locator(WS)
    check("a row opens the task as a full page - the tab row steps aside, no drawer", ws.count() == 1 and ws.get_attribute("data-layout") == "page" and pg.get_by_role("dialog").count() == 0 and pg.get_by_role("tab", name="Overview", exact=True).filter(visible=True).count() == 0)
    check("the address carries no record (the tab and the view only)", pg.url == before and "task" not in pg.url.split("?", 1)[1].lower().replace("tab=tasks", ""), pg.url)
    strip = [d.strip() for d in ws.get_by_test_id("ws-strip").locator("dt").all_inner_texts()]
    check("the facts strip: Current Status, Priority, Due Date, Assigned To, Project / Category", strip == ["Current Status", "Priority", "Due Date", "Assigned To", "Project / Category"], strip)
    heads = [h.inner_text().strip() for h in ws.locator("section h3").all()]
    check("the sections of the picture: Task information (the description, with Edit), the checklist, Attachments, Flow & Progress, Recent Activity, Comments & Discussion", "Task information" in ws.get_by_test_id("ws-info").inner_text() and "Description" in ws.get_by_test_id("ws-info").inner_text() and ws.get_by_test_id("ws-checklist").count() == 1
          and all(any(h.startswith(w) for h in heads) for w in ["Attachments (", "Flow & Progress", "Recent Activity", "Comments & Discussion ("]), heads)
    al = ws.get_by_test_id("ws-activity-all")
    check("Recent Activity shows the latest five at most, with View all to open the rest in place", al.count() == 1 and ws.get_by_test_id("ws-activity").locator("ol > li:visible").count() <= 5 and al.get_attribute("aria-expanded") == "false")
    fs = ws.get_by_test_id("flow-steps").first
    steps = [(li.get_attribute("data-step"), li.get_attribute("data-state")) for li in fs.locator("li[data-step]").all()]
    check("the four steps, the task standing on exactly one", [s[0] for s in steps] == ["todo", "in_progress", "review", "done"] and [s[1] for s in steps].count("now") == 1, steps)
    check("the crumb and the title: Tasks > Task Detail, the task's own number", "Task Detail" in ws.inner_text() and re.search(r"TSK-\d{6}", ws.get_by_test_id("task-title-bar").inner_text()) is not None and title in ws.get_by_test_id("task-title").inner_text())
    form = ws.get_by_test_id("update-sheet")
    check("the one update form is on the page, open", form.count() == 1 and form.get_attribute("data-inline") == "true" and form.get_by_test_id("post-update").is_visible())
    sm = ws.get_by_test_id("status-menu")
    opts = [o.inner_text().strip() for o in sm.locator("option").all()] if sm.count() else []
    check("the status menu shows the current word, then only the moves this person may make (T2-7)", sm.count() == 1 and opts[0] in {"To Do", "In Progress", "Review"} and set(opts[1:]) <= {"In Progress", "Waiting for Client", "On Hold / Blocked", "Submit for Review", "Mark Done", "Approve & Mark Done"} and len(opts) >= 2, opts)
    sm.select_option("blocked"); pg.wait_for_timeout(500)
    check("choosing a move sets the form to it and sends nothing", form.get_by_label("Status", exact=True).input_value() == "blocked" and not [x for x in get(CEO, "/__tasks")["posts"] if x["p"].endswith("/updates")])
    check("no sideways page (the task page, 1440)", no_hscroll(pg) and pg.evaluate(OVER, "[data-testid=task-workspace]") == [], pg.evaluate(OVER, "[data-testid=task-workspace]"))
    pg.screenshot(path="/home/claude/out/shots/tasks2-page-1440.png", full_page=True)
    pg.go_back(); pg.wait_for_timeout(900)
    check("the browser's Back closes the page and returns to the Overview", pg.locator(WS).count() == 0 and vis(pg, "overview-list") and "view=overview" in pg.url, pg.url)
    rows.first.get_by_role("button").first.click(); pg.wait_for_timeout(1500)
    pg.get_by_test_id("ws-back").click(); pg.wait_for_timeout(900)
    check("Back to the list does the same, and leaves the Overview where it was", pg.locator(WS).count() == 0 and vis(pg, "overview-list") and pg.get_by_role("tab", name="Overview", exact=True).get_attribute("aria-selected") == "true")
    pg.go_back(); pg.wait_for_timeout(700)
    check("…with no stale step left behind in the history (one Back leaves Tasks' Overview, not a closed page)", pg.locator(WS).count() == 0)
    ctx.close()
    check("no page error (Overview and the page)", not errs, errs)

    # ================= My Tasks (pictures 2 and 3) =================
    reset(CEO)
    ctx, pg, errs = open_page(b, CEO, view="mine")
    cards = pg.get_by_test_id("my-cards").locator("li button")
    ws = pg.locator(WS)
    check("1440px: the card list on the left, the first task beside it", cards.count() >= 2 and ws.count() == 1 and ws.get_attribute("data-layout") == "beside" and cards.first.get_attribute("aria-pressed") == "true")
    lb = pg.get_by_test_id("mine-split").locator("> *").first.bounding_box(); wb = ws.bounding_box()
    check("the list is the narrow column on the left, the task the wide one on the right", lb["x"] < wb["x"] and lb["width"] < wb["width"], f"{lb['width']} / {wb['width']}")
    c0 = cards.first
    check("a card: the title, the status word, the due date and the progress", c0.locator("strong").count() >= 1 and c0.get_by_test_id("state-chip").count() == 1 and ("Due:" in c0.inner_text() or "No due date" in c0.inner_text()) and c0.locator("[role=progressbar]").count() == 1, c0.inner_text()[:150])
    for tid, what in [("ws-info", "Task Information"), ("ws-stage", "the Current Stage with its progress"), ("ws-update", "the Update Task form"), ("ws-side", "Notes / Files / Activity")]:
        check(f"beside the list: {what}", ws.get_by_test_id(tid).is_visible())
    st = ws.get_by_test_id("ws-stage")
    check("the Current Stage names the step, the percentage and the one next step", re.search(r"\d+%", st.inner_text()) is not None and st.get_by_test_id("next-step").count() == 1, st.inner_text()[:200])
    tabs = [t.strip().split("\n")[0] for t in ws.get_by_test_id("ws-side").get_by_role("tab").all_inner_texts()]
    check("the record's tabs: Notes, Files, Activity", [re.sub(r"\s*\d+.*$", "", t) for t in tabs] == ["Notes", "Files", "Activity"], tabs)
    form = ws.get_by_test_id("update-sheet")
    btns = [x.strip() for x in ws.get_by_test_id("inline-actions").locator("button").all_inner_texts()]
    check("the form's buttons are the picture's - Update Task first, then what this person may also do", btns[0] == "Update Task" and set(btns[1:]) <= {"Submit for Review", "Mark Done", "Approve & Mark Done"}, btns)
    form.get_by_test_id("post-update").click(); pg.wait_for_timeout(600)
    check("an empty update is refused on the screen - nothing sent", "Write the update." in form.inner_text() and not [x for x in get(CEO, "/__tasks")["posts"] if x["p"].endswith("/updates")])
    form.get_by_test_id("sheet-text").fill("Draft sent to the client for comments")
    form.get_by_test_id("post-update").click(); pg.wait_for_timeout(1800)
    ups = [x for x in get(CEO, "/__tasks")["posts"] if x["p"].endswith("/updates")]
    ub = json.loads(ups[0]["body"]) if ups else {}
    check("Update Task posts ONE update through the task's own route, once-only", len(ups) == 1 and ub.get("kind") == "progress" and ub.get("body") == "Draft sent to the client for comments" and bool(ups[0]["key"] or ub.get("client_key")), str(ups)[:300])
    check("…and the form is clean again, the task still beside the list", pg.locator(WS).get_by_test_id("sheet-text").input_value() == "" and pg.locator(WS).get_attribute("data-layout") == "beside")
    if pg.locator(WS).get_by_test_id("post-done").count():
        pg.locator(WS).get_by_test_id("post-done").click(); pg.wait_for_timeout(700)
        f2 = pg.locator(WS).get_by_test_id("update-sheet")
        check("Mark Done asks for the completion summary first - nothing is closed by one press", f2.get_by_label("Status", exact=True).input_value() == "closed" and ("Write the completion summary" in f2.inner_text() or "Tick the open deliverables first" in f2.inner_text()) and not [x for x in get(CEO, "/__tasks")["posts"] if x["p"].endswith("/close")], f2.inner_text()[-300:])
    t1 = cards.nth(1).locator("strong").first.inner_text()
    cards.nth(1).click(); pg.wait_for_timeout(1500)
    check("choosing another card shows that task; one card is pressed", t1 in pg.locator(WS).get_by_test_id("task-title").inner_text() and pg.get_by_test_id("my-cards").locator("li button[aria-pressed=true]").count() == 1, t1)
    check("no sideways page (My Tasks, 1440)", no_hscroll(pg) and pg.evaluate(OVER, "[data-testid=mine-split]") == [], pg.evaluate(OVER, "[data-testid=mine-split]"))
    pg.screenshot(path="/home/claude/out/shots/tasks2-mine-1440.png", full_page=True)
    pg.locator(WS).get_by_test_id("ws-full").click(); pg.wait_for_timeout(1200)
    check("Open the full page shows the same task as a page", pg.locator(WS).get_attribute("data-layout") == "page" and t1 in pg.locator(WS).get_by_test_id("task-title").inner_text())
    pg.get_by_test_id("ws-back").click(); pg.wait_for_timeout(900)
    check("Back returns to My Tasks with the same task beside the list", pg.locator(WS).get_attribute("data-layout") == "beside" and t1 in pg.locator(WS).get_by_test_id("task-title").inner_text())
    # the board (picture 3)
    pg.get_by_test_id("mine-mode").get_by_role("button", name="Board").click(); pg.wait_for_timeout(700)
    bd = pg.get_by_test_id("flow-board")
    check("Board: the four columns, and the task beside the list steps away", [c.get_attribute("data-flow") for c in bd.locator("section[data-flow]").all()] == ["todo", "in_progress", "review", "done"] and pg.locator(WS).count() == 0)
    card = bd.locator("article").first
    check("a board card: the title, the priority or its done state, and the date", card.count() == 1 and card.get_by_role("button").count() >= 1 and (card.get_by_test_id("prio-chip").count() == 1 or card.get_by_test_id("state-chip").count() >= 1), card.inner_text()[:120] if card.count() else "")
    check("no status dropdown on a card - a status changes inside the task (T2-7)", bd.locator("select").count() == 0)
    pg.screenshot(path="/home/claude/out/shots/tasks2-board-1440.png", full_page=True)
    card.get_by_role("button").first.click(); pg.wait_for_timeout(1500)
    check("a board card opens the task as a full page", pg.locator(WS).count() == 1 and pg.locator(WS).get_attribute("data-layout") == "page")
    pg.get_by_test_id("ws-back").click(); pg.wait_for_timeout(800)
    pg.get_by_role("tab", name="All Tasks", exact=True).click(); pg.wait_for_timeout(900)
    check("leaving My Tasks takes no task along: All Tasks opens as a list", pg.locator(WS).count() == 0 and pg.get_by_role("dialog").count() == 0)
    ctx.close()
    check("no page error (My Tasks)", not errs, errs)

    # a person with no team: their own figures, no ranking
    ctx, pg, errs = open_page(b, HOST, view="overview")
    check("a live host: My Tasks (Today) in place of Staff Performance; no staff or department filter", vis(pg, "my-today") and not vis(pg, "staff-performance") and pg.get_by_test_id("overview-filters").get_by_label("Staff", exact=True).count() == 0 and pg.get_by_test_id("overview-filters").get_by_label("Department", exact=True).count() == 0)
    heads = [h.strip() for h in pg.get_by_test_id("overview-table").locator("thead th").all_inner_texts()] if pg.get_by_test_id("overview-table").count() else []
    check("…and the table has no Assigned To column (every row is theirs)", "Assigned To" not in heads, heads)
    ctx.close()
    check("no page error (live host)", not errs, errs)

    # ================= a phone: the drawer, as before =================
    ctx, pg, errs = open_page(b, HOST, w=390, h=844, view="mine")
    check("390px My Tasks: the list, no task beside it", pg.locator(WS).count() == 0 and no_hscroll(pg))
    tb = pg.locator("[data-record^='task:']:visible").first.get_by_role("button").first
    tname = tb.inner_text().strip()
    tb.click(); pg.wait_for_timeout(1800)
    dr = pg.get_by_role("dialog").filter(has_text=tname).first
    check("390px: a task opens in the drawer (the PWA sheet), not as a page", dr.count() == 1 and dr.is_visible() and pg.locator(WS).count() == 0)
    check("390px: the status chip inside reads in the four words", dr.get_by_test_id("state-chip").count() >= 1)
    pg.screenshot(path="/home/claude/out/shots/tasks2-drawer-390.png")
    ctx.close()
    check("no page error (phone)", not errs, errs)

    # ================= the eight widths: Overview, My Tasks (list and board), the task =================
    for w in WIDTHS:
        ctx, pg, errs = open_page(b, CEO, w=w, h=900, view="overview")
        check(f"{w}px Overview: no sideways page", no_hscroll(pg) and pg.evaluate(OVER, "section.erp-tab-zone:not([hidden])") in ([], ["none"]), pg.evaluate(OVER, "section.erp-tab-zone:not([hidden])"))
        if w in (390, 768): pg.screenshot(path=f"/home/claude/out/shots/tasks2-overview-{w}.png", full_page=True)
        if w >= 768:
            pg.get_by_test_id("overview-mode").get_by_role("button", name="Board").click(); pg.wait_for_timeout(400)
            check(f"{w}px Overview board: no sideways page", no_hscroll(pg))
            pg.get_by_test_id("overview-mode").get_by_role("button", name="Table").click(); pg.wait_for_timeout(300)
        t = pg.locator("[data-testid=overview-table] tbody tr").first.get_by_role("button").first
        t.click(); pg.wait_for_timeout(1500)
        shape = "page" if w >= 768 else "drawer"
        okshape = (pg.locator(WS).count() == 1 and pg.locator(WS).get_attribute("data-layout") == "page") if w >= 768 else (pg.get_by_role("dialog").count() >= 1 and pg.locator(WS).count() == 0)
        check(f"{w}px: a task opens as the {shape}, nothing past the screen's edge", okshape and no_hscroll(pg) and (w < 768 or pg.evaluate(OVER, "[data-testid=task-workspace]") == []), pg.evaluate(OVER, "[data-testid=task-workspace]") if w >= 768 else "")
        if w == 768: pg.screenshot(path="/home/claude/out/shots/tasks2-page-768.png", full_page=True)
        ctx.close()
        ctx, pg, errs2 = open_page(b, CEO, w=w, h=900, view="mine")
        beside = pg.locator(WS).count() == 1
        check(f"{w}px My Tasks: {'the task beside the list' if w >= 1280 else 'the list alone'}, no sideways page", beside == (w >= 1280) and no_hscroll(pg))
        if w == 390: pg.screenshot(path="/home/claude/out/shots/tasks2-mine-390.png", full_page=True)
        pg.get_by_test_id("mine-mode").get_by_role("button", name="Board").click(); pg.wait_for_timeout(500)
        check(f"{w}px My Tasks board: no sideways page", no_hscroll(pg) and pg.get_by_test_id("flow-board").count() == 1)
        if w == 390: pg.screenshot(path="/home/claude/out/shots/tasks2-board-390.png", full_page=True)
        ctx.close()
        check(f"{w}px: no page error", not errs and not errs2, errs + errs2)
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

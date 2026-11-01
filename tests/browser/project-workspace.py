"""PROJECT WORKSPACE (v1.245.0; v1.246.0 picture 01 layout) - the client side, in a browser.

The owner's three reference pictures: the quotation page with its seven tabs
and the Project Task tab (desk), the permission rules as each role meets them,
and the phone: the compact task list, the Update Task Status sheet (status,
Update / Comment with a 500 counter, Attach File, Update Status) and the
Project Activity timeline. The project answers are the REAL worker's
(tests/browser/project-fixture.json, captured by tests/go-live-p.mjs).

Servers (tests/browser/serve.mjs on a production build in out/):
    ROLE=ceo node tests/browser/serve.mjs out 4208
    ROLE=ceo PROJECT=none node tests/browser/serve.mjs out 4209
    ROLE=live_host node tests/browser/serve.mjs out 4210
    ROLE=editor node tests/browser/serve.mjs out 4211
    ROLE=sales_marketing node tests/browser/serve.mjs out 4212

    xvfb-run -a python3 tests/browser/project-workspace.py
"""
from playwright.sync_api import sync_playwright
import json, re, sys, urllib.request

S = "/home/claude/work"
res = []
def check(n, c, x=""): res.append(("PASS " if c else "FAIL ") + n + (f" — {x}" if x and not c else ""))
def get(port, path): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())

def page(b, port, w=1440, h=1000):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data, r.headers)))
    pg.goto(f"http://127.0.0.1:{port}/portal"); pg.wait_for_timeout(2500)
    return ctx, pg, errs, reqs

def tab(pg, name):
    btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count() == 0:
        m = pg.get_by_role("button", name="More").filter(visible=True)
        if m.count(): m.first.click(); pg.wait_for_timeout(500)
        btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count(): btn.first.click(); pg.wait_for_timeout(1800); return True
    return False

def open_quotation(pg):
    tab(pg, "Sales")
    pg.get_by_role("tab", name="Quotations & Invoices", exact=True).first.click(); pg.wait_for_timeout(1500)
    row = pg.locator("[role='row']:has-text('QT-AZO150926-1')").first
    btn = row.get_by_test_id("open-quotation")
    ok = btn.count() == 1
    if ok: btn.click(); pg.wait_for_timeout(2200)
    return ok

def no_hscroll(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- the CEO: the quotation page, desk ----------------
    ctx, pg, errs, reqs = page(b, 4208)
    check("a quotation row in Sales offers Open", open_quotation(pg))
    qp = pg.get_by_test_id("quotation-page")
    check("Open shows the quotation page", qp.count() == 1 and qp.is_visible())
    crumbs = qp.get_by_role("navigation", name="Breadcrumb").inner_text() if qp.count() else ""
    check("the breadcrumb reads Sales > Quotations & Invoices > the number", re.sub(r"\s+", " ", crumbs).strip() == "Sales › Quotations & Invoices › QT-AZO150926-1", crumbs)
    tabs = [t.inner_text().strip() for t in qp.get_by_role("tablist", name="Quotation sections").get_by_role("tab").all()]
    check("six tabs in picture 01's order", tabs == ["Overview", "Client Details", "Items & Package", "Financial", "Project & Tasks", "Activity Log"], str(tabs))
    check("Project & Tasks is the open tab", qp.get_by_role("tab", name="Project & Tasks", exact=True).get_attribute("aria-selected") == "true")
    for name in ["Edit Quotation", "Revise", "PDF"]:
        check(f"the header offers {name}", qp.get_by_role("button", name=re.compile(f"^{re.escape(name)}")).count() >= 1 or qp.get_by_role("button", name="Open the PDF").count() == 1)
    check("the header offers Convert to Invoice (the list's own press)", qp.get_by_role("button", name=re.compile("Convert to Invoice")).count() == 1)
    check("the documents list is kept mounted, hidden (a half-written search survives)", pg.locator("[role='row']:has-text('INV-AZO050926-3')").count() >= 1 and not pg.locator("[role='row']:has-text('INV-AZO050926-3')").first.is_visible())
    ws = pg.get_by_test_id("project-workspace")
    check("the Project Task tab shows the project workspace", ws.count() == 1)
    body = ws.inner_text() if ws.count() else ""
    for want in ["Project: Social Media Management", "From Quotation QT-AZO150926-1", "Aina Boutique", "Aina Rahman", "Design & content creation", "Client review & feedback", "Content strategy & plan", "Aina Seller", "Start Date", "Due Date"]:
        check(f"the workspace shows {want}", want in body)
    check("management sees the client's phone and email", "0123456789" in body and "ahmad@abc.test" in body)
    subs = [t.inner_text().strip() for t in ws.get_by_role("tablist", name="Project sections").get_by_role("tab").all()]
    check("picture 01's sub-tabs: Tasks (n) · Updates · Files (n) · Team · Project Brief", len(subs) == 5 and subs[0].startswith("Tasks (3)") and subs[1] == "Updates" and subs[2].startswith("Files (") and subs[3] == "Team" and subs[4] == "Project Brief", str(subs))
    ws.get_by_role("tab", name="Project Brief", exact=True).click(); pg.wait_for_timeout(300)
    check("management sees the prices in the Project Brief", "RM" in ws.inner_text())
    ws.get_by_role("tab", name=re.compile("^Tasks")).click(); pg.wait_for_timeout(300)
    for name in ["Add Task", "Project Settings", "View Gantt"]:
        check(f"management has {name}", ws.get_by_role("button", name=re.compile(f"^{re.escape(name)}")).count() >= 1)
    ws.get_by_role("button", name="Project Settings").click(); pg.wait_for_timeout(300)
    check("Project Settings holds Edit project, Change owner and Project status", all(pg.get_by_role("menuitem", name=n).count() == 1 for n in ["Edit project", "Change owner", "Project status…"]))
    ws.get_by_role("button", name="Project Settings").click(); pg.wait_for_timeout(200)
    # v1.246.4 - the owner: "require pick date of due date ... Start date and also Due date"
    check("the Start Date and Due Date facts each have a Set / Change link for management", ws.get_by_test_id("fact-start").count() == 1 and ws.get_by_test_id("fact-due").count() == 1)
    ws.get_by_test_id("fact-due").click(); pg.wait_for_timeout(600)
    ds = pg.get_by_test_id("dates-sheet")
    check("it opens the two date pickers", ds.count() == 1 and ds.get_by_label("Start date").get_attribute("type") == "date" and ds.get_by_label("Due date").get_attribute("type") == "date")
    ds.get_by_label("Start date").fill("2026-11-02"); ds.get_by_label("Due date").fill("2026-11-01")
    pg.get_by_test_id("save-dates").click(); pg.wait_for_timeout(500)
    check("a due date before the start date is refused on the sheet", "before the start date" in ds.inner_text())
    ds.get_by_label("Due date").fill("2026-12-15")
    pg.get_by_test_id("save-dates").click(); pg.wait_for_timeout(900)
    pats = [r for r in reqs if r[0] == "PATCH" and re.search(r"/staff/projects/\d+$", r[1])]
    check("Save dates sends both dates with the project's version", bool(pats) and '"start_date":"2026-11-02"' in (pats[-1][2] or "") and '"due_date":"2026-12-15"' in (pats[-1][2] or "") and '"version"' in (pats[-1][2] or ""), (pats[-1][2] if pats else "no patch")[:200])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("the task table has three rows", ws.locator("[role='table'] [data-task]").count() == 3)
    check("the task table's columns are the picture's", [c.inner_text().strip().lower() for c in ws.get_by_role("columnheader").all()][:6] == ["task", "assigned to", "status", "progress", "due date", "latest update"])
    lu = ws.locator("[role='table'] [data-task]").first.inner_text()
    check("the Latest update column shows the report's text and time", ("PM" in lu or "AM" in lu) or "No progress report yet" in lu, lu[:200])
    fills = ws.locator("[role='table'] [data-progress]").evaluate_all("ts => ts.map(t => [t.firstElementChild.getBoundingClientRect().width / t.getBoundingClientRect().width, +t.dataset.progress])")
    check("each progress bar is drawn to its percent", all(abs(f - p / 100) < 0.05 for f, p in fills), str(fills))
    pg.screenshot(path=f"{S}/pw-desk-ceo.png", full_page=False)
    ws.get_by_role("button", name="View Gantt").click(); pg.wait_for_timeout(500)
    check("View Gantt draws a bar per task", ws.get_by_test_id("project-gantt").count() == 1 and ws.locator("[data-gantt-row]").count() == 3)
    pg.screenshot(path=f"{S}/pw-gantt.png")
    ws.get_by_role("button", name="View List").click(); pg.wait_for_timeout(400)

    # a task row opens the task itself (task-progress.tsx): picture 02's tabs, Add Update -> picture 03
    ws.get_by_role("button", name="Actions for Design & content creation").click(); pg.wait_for_timeout(300)
    pg.get_by_role("menuitem", name=re.compile("^Open")).click(); pg.wait_for_timeout(1500)
    dr = pg.get_by_role("dialog").filter(has_text="Design & content creation")
    check("the row opens the task drawer", dr.count() >= 1 and dr.first.get_by_test_id("task-progress").count() == 1)
    dtabs = [t.inner_text().strip() for t in dr.first.get_by_role("tablist", name="Task sections").get_by_role("tab").all()]
    check("the drawer has Details · Updates & Comments · Files · Activity", len(dtabs) == 4 and dtabs[0] == "Details" and dtabs[1].startswith("Updates & Comments") and dtabs[2].startswith("Files") and dtabs[3] == "Activity", str(dtabs))
    dr.first.get_by_test_id("add-update").click(); pg.wait_for_timeout(600)
    dlg = pg.get_by_role("dialog").filter(has_text="Add Status Update").last
    check("Add Update opens picture 03's Add Status Update", dlg.is_visible() and dlg.get_by_label("Status", exact=True).count() == 1 and "Update / Comment" in dlg.inner_text() and dlg.get_by_role("button", name="Post Update").count() == 1)
    dlg.get_by_role("button", name="Post Update").click(); pg.wait_for_timeout(400)
    check("an empty update is refused on the spot, nothing sent", "Write the update." in dlg.inner_text() and not [r for r in reqs if r[0] == "POST" and "/updates" in r[1]])
    txt = "Design untuk minggu 1 & 2 sudah siap.\nMenunggu feedback client."
    dlg.locator("textarea").first.fill(txt); pg.wait_for_timeout(200)
    check("the counter counts to 500", f"{len(txt)}/500" in dlg.inner_text())
    dlg.get_by_label("Status", exact=True).select_option("waiting_client")
    dlg.get_by_role("button", name="Post Update").click(); pg.wait_for_timeout(1500)
    posts = [r for r in reqs if r[0] == "POST" and re.search(r"/staff/tasks/\d+/updates$", r[1])]
    sent = json.loads(posts[0][2]) if posts else {}
    check("one POST to the TASK's own updates, with the text and the stage", len(posts) == 1 and sent.get("body") == txt and sent.get("kind") == "waiting_client", str(sent)[:200])
    check("the update carries an Idempotency-Key (a replay lands once)", bool(posts and posts[0][3].get("idempotency-key")))
    check("the update never names its author (the server takes the signed-in person)", "author_id" not in sent)
    check("no PATCH of the task's status from the sheet - the update moves it on the server", not [r for r in reqs if r[0] == "PATCH" and "/staff/tasks/" in r[1]])
    check("the toast says it stays on the record", "stays on the task's record" in pg.inner_text("body"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

    # the other tabs
    qp.get_by_role("tab", name="Overview", exact=True).click(); pg.wait_for_timeout(500)
    ov = qp.inner_text()
    check("Overview: client, sales person, total, project status", "Aina Boutique" in ov and "Nur Aisyah" in ov and "4,500.00" in ov and "In Progress" in ov, ov[:300])
    qp.get_by_role("tab", name="Items & Package", exact=True).click(); pg.wait_for_timeout(400)
    it = qp.inner_text()
    check("Items & Package: the quotation's two lines with amounts", "TikTok LIVE hosting - 8 sessions" in it and "Product photography - 20 photos" in it and "3,000.00" in it and "1,500.00" in it)
    qp.get_by_role("tab", name="Financial", exact=True).click(); pg.wait_for_timeout(400)
    fi = qp.inner_text()
    check("Financial: subtotal and total, and where payments are recorded", "Subtotal" in fi and "4,500.00" in fi and "Payments are recorded on the invoice" in fi)
    qp.get_by_role("tab", name="Project & Tasks", exact=True).click(); pg.wait_for_timeout(800)
    pg.get_by_test_id("project-workspace").get_by_role("tab", name=re.compile("^Files")).click(); pg.wait_for_timeout(1500)
    fl = pg.get_by_test_id("project-files")
    check("Files: the project's files (team and restricted)", fl.count() == 1 and "brief.pdf" in fl.inner_text() and "contract.pdf" in fl.inner_text(), fl.inner_text()[:200] if fl.count() else "")
    check("Files: management may add a restricted file", fl.get_by_label("Who may open it").count() == 1)
    qp.get_by_role("tab", name="Activity Log", exact=True).click(); pg.wait_for_timeout(1500)
    al = pg.get_by_test_id("project-activity")
    altext = al.inner_text() if al.count() else ""
    check("Activity Log: the project's timeline and the quotation's own events", al.count() == 1 and "QT-AZO150926-1 created" in altext and "Attached contract.pdf" in altext, altext[:300])
    qp.get_by_role("tab", name="Client Details", exact=True).click(); pg.wait_for_timeout(1500)
    check("Client Details: the customer file (contacts, follow-ups)", "Contacts" in qp.inner_text() and "Aina Rahman · Owner" in qp.inner_text())
    pg.screenshot(path=f"{S}/pw-client.png")
    qp.get_by_role("navigation", name="Breadcrumb").get_by_role("button", name="Quotations & Invoices").click(); pg.wait_for_timeout(800)
    check("the breadcrumb goes back to the list", pg.get_by_test_id("quotation-page").count() == 0 and pg.locator("[role='row']:has-text('INV-AZO050926-3')").first.is_visible())
    check("no page errors (CEO desk)", not errs, str(errs)[:300])
    missing = [m for m in get(4208, "/__fixture-status")["missing"] if "project" in m]
    check("every project endpoint the page reads is fixtured", not missing, str(missing))
    ctx.close()

    # ---------------- the CEO on a phone (picture 3) ----------------
    ctx, pg, errs, reqs = page(b, 4208, 390, 844)
    check("phone: a quotation opens", open_quotation(pg))
    ws = pg.get_by_test_id("project-workspace")
    check("phone: the compact task list, not the table", ws.locator("[role='table']").first.is_visible() is False and ws.get_by_role("button", name=re.compile("^Design & content creation")).first.is_visible())
    check("phone: no sideways scroll on the page", no_hscroll(pg))
    pg.screenshot(path=f"{S}/pw-phone-list.png")
    ws.get_by_role("button", name=re.compile("^Design & content creation")).first.click(); pg.wait_for_timeout(1500)
    dr = pg.get_by_role("dialog").filter(has_text="Design & content creation").first
    check("phone: a tap opens the task full-screen (picture 03, Task Details)", dr.is_visible() and dr.evaluate("e => { const r = e.getBoundingClientRect(); return r.x <= 1 && r.width >= window.innerWidth - 20; }"))
    pg.screenshot(path=f"{S}/pw-phone-task.png")
    pg.get_by_test_id("add-update").click(); pg.wait_for_timeout(700)
    dlg = pg.get_by_role("dialog").filter(has_text="Add Status Update").last
    check("phone: Add Update opens Add Status Update", dlg.is_visible())
    check("phone: the sheet fits the screen", dlg.evaluate("e => e.getBoundingClientRect().width <= window.innerWidth + 1"))
    pg.screenshot(path=f"{S}/pw-phone-sheet.png")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    pg.get_by_test_id("quotation-page").get_by_role("tab", name="Activity Log", exact=True).click(); pg.wait_for_timeout(1500)
    check("phone: Project Activity timeline", pg.get_by_test_id("project-activity").is_visible())
    check("phone: still no sideways scroll", no_hscroll(pg))
    pg.screenshot(path=f"{S}/pw-phone-activity.png")
    check("no page errors (phone)", not errs, str(errs)[:300])
    ctx.close()

    # ---------------- no brief yet: Create on a press (P-1) ----------------
    ctx, pg, errs, reqs = page(b, 4209)
    open_quotation(pg)
    cb = pg.get_by_test_id("create-brief")
    check("P-1 no project until the press: the Create project brief card", cb.count() == 1 and "No project brief yet" in cb.inner_text())
    check("the suggested owner is named and marked as not confirmed", "Suggested Project Owner" in cb.inner_text() and "the CEO or COO confirms" in cb.inner_text())
    check("nothing was created by opening the page", get(4209, "/__projects")["made"] is False)
    cb.get_by_role("button", name="Create project brief").click(); pg.wait_for_timeout(800)
    # v1.246.4 - starting asks for the dates first; nothing is created until they are confirmed
    st = pg.get_by_test_id("start-sheet")
    check("Create asks for the start date (today by default) and the due date before anything is created", st.count() == 1 and st.get_by_label("Start date").input_value() != "" and st.get_by_label("Due date").input_value() == "" and get(4209, "/__projects")["made"] is False)
    pg.get_by_test_id("confirm-start").click(); pg.wait_for_timeout(500)
    check("the due date is required", "Pick the due date" in st.inner_text() and get(4209, "/__projects")["made"] is False)
    st.get_by_label("Due date").fill("2026-12-31")
    pg.get_by_test_id("confirm-start").click(); pg.wait_for_timeout(2500)
    pj = get(4209, "/__projects")
    created = [x for x in pj["posts"] if x["p"] == "/staff/projects"]
    sentc = json.loads(created[0]["body"]) if created else {}
    check("one POST /staff/projects with the quotation id and the picked dates, with an Idempotency-Key", len(created) == 1 and sentc.get("quotation_id") == 1 and sentc.get("due_date") == "2026-12-31" and bool(sentc.get("start_date")) and bool(created[0]["key"]), str(created))
    check("the workspace opens after the press", pg.get_by_test_id("project-workspace").count() == 1)
    check("no page errors (create)", not errs, str(errs)[:300])
    ctx.close()

    # ---------------- an assigned team member (live host): Tasks > Projects ----------------
    ctx, pg, errs, reqs = page(b, 4210)
    check("a live host has no Sales tab (projects reach her through Tasks)", pg.get_by_role("button", name="Sales", exact=True).filter(visible=True).count() == 0)
    tab(pg, "Tasks")
    ptab = pg.get_by_role("tab", name="Projects", exact=True)
    check("Tasks has a Projects tab", ptab.count() == 1)
    ptab.click(); pg.wait_for_timeout(1500)
    check("no new sidebar item called Projects", pg.locator("nav").get_by_role("button", name="Projects", exact=True).count() == 0)
    rowb = pg.get_by_role("button", name=re.compile("Social Media Management")).first
    check("the project is listed", rowb.count() == 1)
    rowb.click(); pg.wait_for_timeout(1800)
    ws = pg.get_by_test_id("project-workspace")
    body = ws.inner_text() if ws.count() else ""
    check("assigned: the shared fields are there", "Aina Boutique" in body and "Design & content creation" in body)
    check("assigned: the client's phone (decision P-6)", "0123456789" in body)
    check("assigned: no prices anywhere in the workspace", "RM" not in body, re.findall(r"RM[\s\d,.]+", body)[:3])
    for name in ["Add Task", "Project Settings"]:
        check(f"assigned: no {name}", ws.get_by_role("button", name=name, exact=True).count() == 0)
    check("assigned: no Set / Change on the dates", ws.get_by_test_id("fact-start").count() == 0 and ws.get_by_test_id("fact-due").count() == 0)
    ws.get_by_role("button", name="Actions for Design & content creation").click(); pg.wait_for_timeout(300)
    check("assigned: her task's menu opens it to add an update - and offers no Reassign", pg.get_by_role("menuitem", name=re.compile("^Open · add an update")).count() == 1 and pg.get_by_role("menuitem", name="Reassign").count() == 0)
    pg.get_by_role("menuitem", name=re.compile("^Open")).click(); pg.wait_for_timeout(1500)
    check("assigned: the task drawer offers her Add Update", pg.get_by_test_id("add-update").count() == 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    pg.screenshot(path=f"{S}/pw-assigned.png")
    check("no page errors (assigned)", not errs, str(errs)[:300])
    ctx.close()

    # ---------------- staff who are neither: read, offer help ----------------
    ctx, pg, errs, reqs = page(b, 4211)
    tab(pg, "Tasks")
    pg.get_by_role("tab", name="Projects", exact=True).click(); pg.wait_for_timeout(1500)
    pg.get_by_role("button", name=re.compile("Social Media Management")).first.click(); pg.wait_for_timeout(1800)
    ws = pg.get_by_test_id("project-workspace")
    body = ws.inner_text() if ws.count() else ""
    check("other staff: read the shared fields", "Aina Boutique" in body and "Content strategy & plan" in body)
    check("other staff: no phone, no email, no prices", "0123456789" not in body and "ahmad@abc.test" not in body and "RM" not in body)
    ws.get_by_role("tab", name="Updates", exact=True).click(); pg.wait_for_timeout(300)
    check("other staff: may offer to help, nothing else", ws.get_by_role("button", name="Offer to help").count() == 1 and ws.get_by_role("button", name="Post a project note").count() == 0 and ws.get_by_role("button", name="Add Task").count() == 0 and ws.get_by_role("button", name="Project Settings").count() == 0)
    check("no page errors (other)", not errs, str(errs)[:300])
    ctx.close()

    # ---------------- the Project Owner (a salesperson) ----------------
    ctx, pg, errs, reqs = page(b, 4212)
    open_quotation(pg)
    ws = pg.get_by_test_id("project-workspace")
    ws.get_by_role("button", name="Project Settings").click(); pg.wait_for_timeout(300)
    check("owner: Add Task, and Edit project in Project Settings", ws.get_by_role("button", name="Add Task").count() == 1 and pg.get_by_role("menuitem", name="Edit project").count() == 1)
    check("owner: cannot assign or change the owner (P-2)", pg.get_by_role("menuitem", name=re.compile("owner$")).count() == 0)
    pg.get_by_role("menuitem", name="Project status…").click(); pg.wait_for_timeout(600)
    sd = pg.get_by_role("dialog")
    check("owner: Completed is not offered to her (P-3, CEO/COO confirm)", sd.count() >= 1 and sd.get_by_role("radio", name=re.compile("^Completed")).count() == 0 and "Completed" not in [o.inner_text().strip() for o in sd.locator("option").all()])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    ws.get_by_role("button", name="Add Task").click(); pg.wait_for_timeout(1200)
    td = pg.get_by_role("dialog").filter(has_text="Add Task")
    check("Add Task offers the scope lines as suggestions and the staff list", td.count() == 1 and td.locator("select").count() >= 1)
    pg.screenshot(path=f"{S}/pw-owner-add.png")
    check("no page errors (owner)", not errs, str(errs)[:300])
    ctx.close()
    b.close()

fails = [r for r in res if r.startswith("FAIL")]
print("\n".join(res))
print(f"\n{len(res) - len(fails)} of {len(res)} passed")
sys.exit(1 if fails else 0)

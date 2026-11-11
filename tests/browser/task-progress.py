"""TASK PROGRESS (v1.246.0) - the client side, in a browser.

The owner's brief "Task Assignment, Progress Reporting, Comments & Quotation
Project Integration" (decisions T-1 to T-9) and reference pictures 02 and 03:
the Tasks drawer's Details / Updates & Comments / Files / Activity, the review
bar, the Latest update column and the filters, the Overview's progress
reports, and the phone's Add Status Update. The task answers are the REAL
worker's (tests/browser/task-fixture.json, captured by tests/go-live-t.mjs).

Servers (tests/browser/serve.mjs on a production build in out/):
    ROLE=ceo TASKP=1 node tests/browser/serve.mjs out 4213
    ROLE=live_host TASKP=1 node tests/browser/serve.mjs out 4214
    ROLE=editor TASKP=1 node tests/browser/serve.mjs out 4215

    xvfb-run -a python3 tests/browser/task-progress.py
"""
from playwright.sync_api import sync_playwright
import json, re, sys, urllib.request

S = "/home/claude/work"
res = []
def check(n, c, x=""):
    res.append(("PASS " if c else "FAIL ") + n + (f" — {x}" if x and not c else ""))
    if not c: print(res[-1], flush=True)
def get(port, path): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())
TITLE = "Financing application - Maybank SME"

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

def open_task(pg, view, title):
    pg.get_by_role("tab", name=view, exact=True).first.click(); pg.wait_for_timeout(1000)
    row = pg.locator(f"tr:has-text('{title}')").first
    row.get_by_role("button", name=title).first.click(); pg.wait_for_timeout(2000)
    return pg.get_by_role("dialog").filter(has_text=title).first, row

def no_hscroll(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- the CEO: the reviewer ----------------
    ctx, pg, errs, reqs = page(b, 4213)
    tab(pg, "Tasks")
    ov = pg.get_by_test_id("progress-overview")
    check("Overview: progress reports - waiting for review, blocked, gone quiet", ov.count() == 1 and "Waiting for review" in ov.inner_text() and "Blocked" in ov.inner_text() and "No recent update" in ov.inner_text())
    check("Overview: the newest progress report is listed with its task", TITLE in ov.inner_text() and "Submitted to the bank" in ov.inner_text(), ov.inner_text()[:300])
    pg.get_by_role("tab", name="All Tasks", exact=True).click(); pg.wait_for_timeout(1000)
    row = pg.locator(f"tr:has-text('{TITLE}')").first
    rt = row.inner_text()
    check("All Tasks: the Latest update column shows the report, who and when", "Submitted to the bank, reference MBB-SME-2207" in rt and "Farid Zulkifli" in rt and re.search(r"\d{1,2}:\d\d (AM|PM)", rt), rt[:300])
    check("All Tasks: the stage shows - Ready for Review", "Ready for Review" in rt)
    check("All Tasks: the header names the column", pg.locator("th", has_text="Latest update").count() >= 1)
    # v1.256.0 (TASK-CLOSURE-AUDIT D4) - the row's status dropdown is gone: the state, and one Update action into the task
    check("the row shows the state and one Update action - no status dropdown that could close it (T-2, D4)", row.locator("select").count() == 0 and row.get_by_role("button", name=re.compile("^Update status")).count() == 1, rt[:200])
    st = pg.get_by_label("Status", exact=True).filter(visible=True).first
    st.select_option("review"); pg.wait_for_timeout(400)
    check("filter: Waiting for review keeps the task", pg.locator(f"tr:has-text('{TITLE}')").count() == 1)
    st.select_option("blocked"); pg.wait_for_timeout(400)
    check("filter: Blocked leaves it out", pg.locator(f"tr:has-text('{TITLE}')").count() == 0)
    st.select_option("active"); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{S}/tp-all-tasks.png")

    dr, _ = open_task(pg, "All Tasks", TITLE)
    # v1.282.0 - the photo's tabs: the tab's name is its word, the count its badge (read as its description)
    tl = dr.get_by_role("tablist", name="Task sections").get_by_role("tab")
    tabs = [t.evaluate("e => [...e.childNodes].filter(n => n.nodeType === 3 || (n.nodeType === 1 && getComputedStyle(n).display !== 'none' && !n.getAttribute('aria-hidden'))).map(n => n.textContent).join('').trim()") for t in tl.all()]
    counts = [t.evaluate("e => { const id = e.getAttribute('aria-describedby'); return id ? document.getElementById(id)?.textContent.trim() : null; }") for t in tl.all()]
    check("the drawer: Details · Updates & Comments · Files · Activity, Updates and Files with their counts", len(tabs) == 4 and tabs[0] == "Details" and tabs[1] == "Updates & Comments" and tabs[2] == "Files" and tabs[3] == "Activity"
          and re.match(r"\d+ waiting", counts[1] or "") and re.match(r"\d+ waiting", counts[2] or ""), str([tabs, counts]))
    bar = dr.get_by_test_id("review-bar")
    sl = dr.get_by_test_id("summary-latest")  # v1.258.0 - the latest report moved from the bar's one line into the status summary, in full
    check("Details: the review bar says it waits for review, the status summary carries the latest report", bar.count() == 1 and "Ready for Review" in bar.inner_text() and sl.count() == 1 and "Submitted to the bank" in sl.inner_text())
    check("Details: the reviewer has Approve and Return", bar.get_by_role("button", name="Approve").count() == 1 and bar.get_by_role("button", name="Return").count() == 1)
    det = dr.inner_text()
    check("Details: acknowledged time, helpers, the checklist and the task information kept", "Acknowledged" in det and "Helping" in det and "Deliverables checklist" in det and "Task information" in det)
    pg.screenshot(path=f"{S}/tp-drawer-details.png")
    bar.get_by_role("button", name="Return").click(); pg.wait_for_timeout(500)
    pd = pg.get_by_role("dialog").filter(has_text="Return for more work").last
    check("Return asks for the reason", pd.count() == 1)
    pd.get_by_label(re.compile("Reason")).fill("Attach the bank's acknowledgement slip")
    pd.get_by_role("button", name="Return", exact=True).last.click(); pg.wait_for_timeout(1500)
    rv = [x for x in get(4213, "/__tasks")["posts"] if x["p"].endswith("/review")]
    check("one POST /review: return, with the reason", len(rv) == 1 and json.loads(rv[0]["body"]) == {"decision": "return", "reason": "Attach the bank's acknowledgement slip"}, str(rv))
    # v1.256.0 - Approve & close opens the one form on Closed (inside the drawer); posting it is the closure
    bar.get_by_role("button", name="Approve & close").click(); pg.wait_for_timeout(700)
    sh0 = dr.get_by_test_id("update-sheet")
    check("Approve & close opens Add Status Update inside the same drawer, on Closed", sh0.count() == 1 and sh0.get_by_label("Status", exact=True).input_value() == "closed" and pg.get_by_role("dialog").count() == 1)
    out = sh0.get_by_test_id("sheet-outstanding")
    check("3 of 5 deliverables are open: they are named and closing is held (Test B)", out.count() == 1 and "3 deliverable(s) still open" in out.inner_text() and sh0.get_by_test_id("post-update").is_disabled(), out.inner_text()[:200] if out.count() else "")
    out.get_by_role("checkbox").check(); pg.wait_for_timeout(200)
    sh0.get_by_label("Reason for the exception *").fill("The bank accepted the application without the last two steps")
    sh0.get_by_test_id("post-update").click(); pg.wait_for_timeout(1500)
    cl = [x for x in get(4213, "/__tasks")["posts"] if x["p"].endswith("/close")]
    cb = json.loads(cl[0]["body"]) if cl else {}
    check("the CEO closes it as a management exception: one POST /close with the reason, and the toast says so", len(cl) == 1 and cb.get("exception") is True and "bank accepted" in cb.get("exception_reason", "") and "Task closed" in pg.inner_text("body"), str(cb))

    dr.get_by_role("tab", name=re.compile("^Updates( & Comments)?$")).click(); pg.wait_for_timeout(1500)
    feed = dr.get_by_test_id("task-feed")
    kinds = [li.get_attribute("data-kind") for li in feed.locator("li").all()]
    check("Updates & Comments: updates and comments in one feed, typed", {"progress", "blocker", "review_request", "comment"} <= set(kinds), str(kinds))
    check("…each with its author and time", "Farid Zulkifli" in feed.inner_text() and re.search(r"\d{1,2}:\d\d (AM|PM)", feed.inner_text()))
    check("…the structured parts shown (done, blocking, next)", "Next:" in feed.inner_text() and "Blocking:" in feed.inner_text())
    dr.get_by_role("button", name="Comments", exact=True).click(); pg.wait_for_timeout(300)
    check("the Comments filter shows only comments", set(li.get_attribute("data-kind") for li in feed.locator("li").all()) == {"comment"})
    dr.get_by_role("button", name="All", exact=True).click(); pg.wait_for_timeout(300)
    qb = dr.get_by_test_id("quick-update")
    qb.locator("textarea").fill("@Farid please attach the slip from the bank")
    qb.get_by_role("button", name="Post Update").click(); pg.wait_for_timeout(1500)
    cm = [x for x in get(4213, "/__tasks")["posts"] if x["p"].endswith("/comments")]
    body = json.loads(cm[0]["body"]) if cm else {}
    check("Quick Update posts a COMMENT by default, with the @mention resolved to the person", len(cm) == 1 and body.get("comment", "").startswith("@Farid") and 14 in body.get("mentions", []), str(body))
    check("…carrying an Idempotency-Key", bool(cm and cm[0]["key"]))
    pg.screenshot(path=f"{S}/tp-drawer-updates.png")

    dr.get_by_role("tab", name=re.compile("^Files")).click(); pg.wait_for_timeout(1200)
    fl = dr.get_by_test_id("task-files")
    link = fl.get_by_role("link", name="statements.pdf")
    check("Files: the evidence, opened through the task (private)", link.count() == 1 and re.search(r"/api/v1/staff/tasks/801/files/\d+$", link.get_attribute("href") or ""))
    dr.get_by_role("tab", name="Activity", exact=True).click(); pg.wait_for_timeout(1200)
    act = dr.get_by_test_id("task-activity").inner_text()
    for want in ["Created the task", "Reassigned", "Ticked", "Unticked", "Submitted for review", "Reported a blocker", "Attached statements.pdf", "Commented", "Changed deadline"]:
        check(f"Activity: {want}", want in act, act[:200])
    pg.screenshot(path=f"{S}/tp-drawer-activity.png")
    check("no page errors (CEO)", not errs, str(errs)[:300])
    missing = [m for m in get(4213, "/__fixture-status")["missing"] if "/tasks" in m]
    check("every task endpoint the drawer reads is fixtured", not missing, str(missing))
    ctx.close()

    # ---------------- the assignee (live host) ----------------
    ctx, pg, errs, reqs = page(b, 4214)
    tab(pg, "Tasks")
    dr, row = open_task(pg, "My Tasks", TITLE)
    bar = dr.get_by_test_id("review-bar")
    check("assignee: no Approve on his own work", bar.get_by_role("button", name="Approve").count() == 0)
    dr.get_by_test_id("add-update").click(); pg.wait_for_timeout(600)
    sh = pg.get_by_test_id("update-sheet")
    opts = [o.inner_text().strip() for o in sh.get_by_label("Status", exact=True).locator("option").all()]
    check("the sheet's statuses: In Progress, Waiting for Client, On Hold / Blocked (already in review: not offered again)", opts == ["In Progress", "Waiting for Client", "On Hold / Blocked"], str(opts))
    check("progress comes from the checklist - shown, not typed (2/5 = 40%)", "From the checklist (2/5)" in sh.inner_text() and sh.locator("input[type='range']").count() == 0)
    sh.locator("textarea").fill("Bank asked for the director's IC copy.")
    sh.get_by_label("Status", exact=True).select_option("blocked")
    sh.locator("input[type='file']").set_input_files([{"name": "ic-request.png", "mimeType": "image/png", "buffer": b"\x89PNG\r\n\x1a\n0000"}])
    check("the sheet says how many files are attached", "1 file(s) attached" in sh.inner_text())
    pg.get_by_test_id("post-update").click(); pg.wait_for_timeout(2000)
    posts = get(4214, "/__tasks")["posts"]
    up = [x for x in posts if x["p"].endswith("/updates")]
    fu = [x for x in posts if x["p"].endswith("/files")]
    sent = json.loads(up[0]["body"]) if up else {}
    check("one POST /updates: a blocker with the text, no typed progress", len(up) == 1 and sent.get("kind") == "blocker" and sent.get("body") == "Bank asked for the director's IC copy." and "progress" not in sent, str(sent))
    check("…then the file, attached to THAT update", len(fu) == 1 and fu[0]["update"] == "951" and fu[0]["name"] == "ic-request.png", str(fu))
    check("the toast only after the server answered", "Update saved" in pg.inner_text("body"))
    check("no page errors (assignee)", not errs, str(errs)[:300])
    ctx.close()

    # ---------------- the assignee on a phone (picture 03) ----------------
    ctx, pg, errs, reqs = page(b, 4214, 390, 844)
    tab(pg, "Tasks")
    pg.get_by_role("tab", name="My Tasks", exact=True).first.click(); pg.wait_for_timeout(1000)
    pg.get_by_role("button", name=TITLE).first.click(); pg.wait_for_timeout(2000)
    dr = pg.get_by_role("dialog").filter(has_text=TITLE).first
    check("phone: the task opens, its tabs and Update status in reach", dr.is_visible() and dr.get_by_test_id("add-update").is_visible())
    check("phone: no sideways scroll", no_hscroll(pg))
    pg.screenshot(path=f"{S}/tp-phone-task.png")
    dr.get_by_test_id("add-update").click(); pg.wait_for_timeout(700)
    sh = pg.get_by_role("dialog").filter(has_text="Add Status Update").last
    check("phone: Add Status Update fills the screen, no sideways scroll", sh.is_visible() and sh.evaluate("e => e.getBoundingClientRect().width <= window.innerWidth + 1") and no_hscroll(pg))
    pg.screenshot(path=f"{S}/tp-phone-sheet.png")
    check("no page errors (phone)", not errs, str(errs)[:300])
    ctx.close()

    # ---------------- a helper (editor) on a project task ----------------
    ctx, pg, errs, reqs = page(b, 4215)
    tab(pg, "Tasks")
    pg.get_by_role("tab", name="My Tasks", exact=True).first.click(); pg.wait_for_timeout(1000)
    st = pg.get_by_label("Status", exact=True).filter(visible=True).first
    st.select_option("assisting"); pg.wait_for_timeout(400)
    check("filter: I am helping on lists the project task", pg.locator("tr:has-text('Design & content creation')").count() == 1)
    pg.get_by_role("button", name="Design & content creation").first.click(); pg.wait_for_timeout(2000)
    dr = pg.get_by_role("dialog").filter(has_text="Design & content creation").first
    bar = dr.get_by_test_id("review-bar")
    check("helper: Add Update, but no Approve, Return or Cancel", dr.get_by_test_id("add-update").count() == 1 and bar.get_by_role("button", name=re.compile("^(Approve|Return|Cancel task)$")).count() == 0)
    check("helper: the project, quotation and customer are named", "Aina Boutique" in dr.inner_text() and "QT-AZO150926-1" in dr.inner_text())
    check("no page errors (helper)", not errs, str(errs)[:300])
    ctx.close()

    # ---------------- v1.246.2: a task under a quotation; the checklist edited ----------------
    ctx, pg, errs, reqs = page(b, 4213)
    tab(pg, "Tasks")
    pg.get_by_role("button", name="Create Task").filter(visible=True).first.click(); pg.wait_for_timeout(1200)
    sel = pg.get_by_label("For a quotation (optional)").filter(visible=True).first
    opts = [o.inner_text().strip() for o in sel.locator("option").all()]
    check("Create Task: a quotation can be picked (the live ones, 'new project' marked)", sel.count() == 1 and any("QT-AZO160926-2" in o and "new project" in o for o in opts) and any("QT-AZO150926-1" in o for o in opts), str(opts))
    sel.select_option("2"); pg.wait_for_timeout(300)
    check("Create Task: picking one says the task becomes a project task", "becomes a project task" in pg.get_by_role("dialog").last.inner_text())
    pg.get_by_role("dialog").last.get_by_placeholder("e.g. Prepare LIVE rundown").fill("Kick-off call"); pg.wait_for_timeout(200)
    pg.get_by_role("dialog").last.get_by_role("button", name="Create task").click(); pg.wait_for_timeout(1200)
    posts = [r for r in reqs if r[0] == "POST" and r[1].endswith("/staff/tasks")]
    check("Create Task: the quotation goes with the task (quotation_id)", bool(posts) and '"quotation_id":2' in (posts[-1][2] or ""), (posts[-1][2] if posts else "no post")[:200])
    pg.get_by_role("tab", name="Projects", exact=True).first.click(); pg.wait_for_timeout(1200)
    un = pg.get_by_test_id("unstarted-quotations")
    check("Projects: quotations without a project are listed", un.count() == 1 and "QT-AZO160926-2" in un.inner_text() and "QT-AZO170926-3" in un.inner_text(), un.inner_text()[:200] if un.count() else "absent")
    # v1.246.3 - the owner: acceptance first, then Start project
    row2 = un.locator("[data-quotation='2']"); row3 = un.locator("[data-quotation='3']")
    check("an open quotation offers Record acceptance, not Start project", row2.get_by_role("button", name="Record acceptance").count() == 1 and row2.get_by_role("button", name="Start project").count() == 0)
    check("an invoiced (or accepted) quotation offers Start project", row3.get_by_role("button", name="Start project").count() == 1 and row3.get_by_role("button", name="Record acceptance").count() == 0)
    row2.get_by_role("button", name="Record acceptance").click(); pg.wait_for_timeout(700)
    sheet = pg.get_by_test_id("acceptance-sheet")
    check("Record acceptance opens a sheet: who agreed (the contact prefilled), position, how, a note", sheet.count() == 1 and sheet.get_by_label("Who agreed (customer side)").input_value() == "Siti Zainab" and sheet.get_by_label("How they agreed").count() == 1)
    sheet.get_by_label("How they agreed").select_option("signed"); sheet.get_by_label("Reference or note (optional)").fill("PO 4471")
    pg.get_by_test_id("record-acceptance").click(); pg.wait_for_timeout(1200)
    accs = [r for r in reqs if r[0] == "POST" and r[1].endswith("/staff/docs/2/acceptance")]
    check("recording posts who, how and the note against that quotation", bool(accs) and '"channel":"signed"' in (accs[-1][2] or "") and "PO 4471" in (accs[-1][2] or "") and "Siti Zainab" in (accs[-1][2] or ""), (accs[-1][2] if accs else "no post")[:200])
    check("the sheet closes and a toast says the project can start now", pg.get_by_test_id("acceptance-sheet").count() == 0 and pg.get_by_text("Acceptance recorded").count() >= 1)
    dr, _ = open_task(pg, "All Tasks", "Financing application - Maybank SME")
    add = dr.get_by_test_id("item-add")
    check("the checklist can be edited: an Add a deliverable box, rename and remove on each item", add.count() == 1 and dr.get_by_role("button", name=re.compile("^Rename ")).count() >= 1 and dr.get_by_role("button", name=re.compile("^Remove ")).count() >= 1)
    add.get_by_role("textbox").fill("Scan the signed form"); pg.wait_for_timeout(200)
    add.get_by_role("button", name="Add").click(); pg.wait_for_timeout(1000)
    items_posts = [r for r in reqs if r[0] == "POST" and re.search(r"/staff/tasks/\d+/items$", r[1])]
    check("Add posts the deliverable to the task's checklist", bool(items_posts) and "Scan the signed form" in (items_posts[-1][2] or ""))
    dr.get_by_role("button", name=re.compile("^Rename ")).first.click(); pg.wait_for_timeout(300)
    ed = dr.get_by_label("Deliverable", exact=True)
    check("Rename opens the wording in place with Save and Cancel", ed.count() == 1 and dr.get_by_role("button", name="Cancel").count() >= 1)
    ed.fill("Collect the statements (3 months)"); dr.get_by_role("button", name="Save").first.click(); pg.wait_for_timeout(800)
    patches = [r for r in reqs if r[0] == "PATCH" and re.search(r"/staff/tasks/\d+/items/\d+$", r[1])]
    check("Save sends the new wording", bool(patches) and "3 months" in (patches[-1][2] or ""))
    dr.get_by_role("button", name=re.compile("^Remove ")).first.click(); pg.wait_for_timeout(500)
    cd = pg.get_by_role("dialog").filter(has_text="Remove this deliverable?").last
    check("Remove asks first", cd.count() == 1)
    if cd.count(): cd.get_by_role("button", name="Remove", exact=True).last.click(); pg.wait_for_timeout(800)
    dels = [r for r in reqs if r[0] == "DELETE" and re.search(r"/staff/tasks/\d+/items/\d+$", r[1])]
    check("confirming removes it on the server", bool(dels))
    # v1.246.2 - the staff photo beside the name, from the photo book (the owner: "should staff photo appear!")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    pg.get_by_role("tab", name="All Tasks", exact=True).first.click(); pg.wait_for_timeout(1200)
    row = pg.locator("tr:has-text('Check inventory delivery')").first
    imgs = row.locator("img[src*='/api/v1/media/file/']")
    check("All Tasks: the assignee's photo shows beside the name (photo book, not initials)", imgs.count() >= 1 and "9002-aisyah.jpg" in (imgs.first.get_attribute("src") or ""), row.inner_text()[:120])
    tab(pg, "Claims")
    pg.wait_for_timeout(1500)
    cl = pg.locator("tr:has-text('Nur Aisyah')").first
    check("Claims: the same photo beside the staff name", cl.count() == 1 and cl.locator("img[src*='/api/v1/media/file/']").count() >= 1, cl.inner_text()[:120] if cl.count() else "no row")
    # v1.247.0 - task emails: Reports & Archive panel, and Send reminder on a task drawer
    tab(pg, "Tasks")
    pg.get_by_role("tab", name="Reports & Archive", exact=True).first.click(); pg.wait_for_timeout(1500)
    mp = pg.get_by_test_id("task-mail-panel")
    mt = mp.inner_text() if mp.count() else ""
    check("Reports & Archive: the Task Email panel shows the sender, the triggers and the log", mp.count() == 1 and "hello@a2zcreative.my" in mt and "New task assigned" in mt and "Overdue" in mt and "Delivery log" in mt, mt[:200])
    check("the log shows the provider's own answer for a send that failed, and offers Retry to the CEO", "550 5.1.1 mailbox unavailable" in mt and mp.get_by_role("button", name="Retry").count() == 1)
    check("the digest switch is off by default (the owner's answer)", mp.get_by_role("switch", name="Daily digest").get_attribute("aria-checked") == "false")
    check("the preview is the real template in a sandboxed frame", mp.get_by_test_id("mail-preview").get_attribute("sandbox") == "")
    mp.get_by_role("switch", name="Daily digest").click(); pg.wait_for_timeout(200)
    pg.get_by_test_id("mail-save").click(); pg.wait_for_timeout(900)
    puts = get(4213, "/__tasks")["posts"]
    check("Save sends the settings with the digest on", any(x.get("p") == "/staff/tasks/mail-settings" and '"digest_on":true' in (x.get("body") or "") for x in puts), str(puts)[-300:])
    dr, _ = open_task(pg, "All Tasks", "Financing application - Maybank SME")
    rb = dr.get_by_test_id("send-reminder")
    check("the task drawer offers Send reminder to the person who set it", rb.count() == 1)
    if rb.count():
        rb.click(); pg.wait_for_timeout(500)
        pd = pg.get_by_role("dialog").filter(has_text="Send a reminder").last
        check("Send reminder asks for the reason first", pd.count() == 1)
        pd.get_by_role("textbox").fill("The bank needs it by Friday"); pd.get_by_role("button", name="Send reminder").click(); pg.wait_for_timeout(900)
        puts = get(4213, "/__tasks")["posts"]
        check("it posts the reason to the task's reminder route, and says the email is queued", any(x.get("p", "").endswith("/remind") and "Friday" in (x.get("body") or "") for x in puts) and pg.get_by_text("Reminder sent").count() >= 1)
    check("no page errors (quotation task, checklist, photos, task emails)", not errs, str(errs)[:300])
    ctx.close()
    # v1.254.2 (the owner's iPhone PWA screenshot, 02-11-2026: the task drawer
    # ran past the right edge). Measured INSIDE the drawer: a fixed panel's
    # overflow never shows on the page's own scroll width.
    DRAWER_FITS = """(w) => { const d = [...document.querySelectorAll('[role=dialog]')].filter((x) => x.offsetParent !== null).pop(); if (!d) return ['no drawer'];
      return [...d.querySelectorAll('*')].filter((e) => !e.closest('[class*=line-tabs_tabs]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1; }).map((e) => (e.className || '').toString().slice(0, 40)); }"""
    for w in [320, 375, 393, 430]:
        urllib.request.urlopen("http://127.0.0.1:4213/__reset").read()
        ctx = b.new_context(viewport={"width": w, "height": 852}, is_mobile=True, has_touch=True, reduced_motion="reduce"); pg = ctx.new_page()
        pg.goto("http://127.0.0.1:4213/portal?tab=Tasks"); pg.wait_for_timeout(2500)
        pg.get_by_role("tab", name="All Tasks", exact=True).first.click(); pg.wait_for_timeout(900)
        pg.get_by_text(TITLE).filter(visible=True).first.click(); pg.wait_for_timeout(1800)
        bad = pg.evaluate(DRAWER_FITS, w)
        check(f"phone {w}px: nothing in the task drawer runs past the screen's right edge", bad == [], bad[:5])
        ctx.close()
    b.close()

fails = [r for r in res if r.startswith("FAIL")]
print("\n".join(res))
print(f"\n{len(res) - len(fails)} of {len(res)} passed")
sys.exit(1 if fails else 0)

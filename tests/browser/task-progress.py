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
    opts = [o.inner_text().strip() for o in row.locator("select").first.locator("option").all()]
    check("the row's status control does not offer Closed on a task somebody else set (T-2)", "Closed" not in opts, str(opts))
    st = pg.get_by_label("Status", exact=True).filter(visible=True).first
    st.select_option("review"); pg.wait_for_timeout(400)
    check("filter: Waiting for review keeps the task", pg.locator(f"tr:has-text('{TITLE}')").count() == 1)
    st.select_option("blocked"); pg.wait_for_timeout(400)
    check("filter: Blocked leaves it out", pg.locator(f"tr:has-text('{TITLE}')").count() == 0)
    st.select_option("active"); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{S}/tp-all-tasks.png")

    dr, _ = open_task(pg, "All Tasks", TITLE)
    tabs = [t.inner_text().strip() for t in dr.get_by_role("tablist", name="Task sections").get_by_role("tab").all()]
    check("the drawer: Details · Updates & Comments (n) · Files (n) · Activity", len(tabs) == 4 and tabs[0] == "Details" and re.match(r"Updates & Comments \(\d+\)", tabs[1]) and re.match(r"Files \(\d+\)", tabs[2]) and tabs[3] == "Activity", str(tabs))
    bar = dr.get_by_test_id("review-bar")
    check("Details: the review bar says it waits for review, with the latest report", bar.count() == 1 and "Ready for Review" in bar.inner_text() and "Submitted to the bank" in bar.inner_text())
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
    bar.get_by_role("button", name="Approve").click(); pg.wait_for_timeout(1500)
    rv = [x for x in get(4213, "/__tasks")["posts"] if x["p"].endswith("/review")]
    check("Approve: one POST /review approve, and the toast says so", len(rv) == 2 and json.loads(rv[1]["body"])["decision"] == "approve" and "Approved" in pg.inner_text("body"))

    dr.get_by_role("tab", name=re.compile("^Updates & Comments")).click(); pg.wait_for_timeout(1500)
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
    check("phone: the task opens, its tabs and Add Update in reach", dr.is_visible() and dr.get_by_test_id("add-update").is_visible())
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
    b.close()

fails = [r for r in res if r.startswith("FAIL")]
print("\n".join(res))
print(f"\n{len(res) - len(fails)} of {len(res)} passed")
sys.exit(1 if fails else 0)

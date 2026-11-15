"""TASK CLOSURE & REOPEN (v1.256.0) - the client side, in a browser.

The owner's "Task Progress Timeline 2.1, Status Updates, Closure & Reopen
Workflow" (claude/TASK-CLOSURE-AUDIT.md, D1-D4 approved 03-11-2026) and his
two mockups: a task at 100% says what is left and offers Close task; Add
Status Update opens inside the task drawer (one layer) with Closed among
its statuses and a completion summary; a closed task shows who, when, the
summary and how late, its timeline ends in Closed, and offers Reopen with a
reason; the board's status dropdown is gone; nothing is wider than the
screen inside or outside the drawer. The task answers are the REAL
worker's (tests/browser/task-closure-fixture.json, captured by
tests/go-live-o.mjs). Who may do what is proven by direct request there.

    ROLE=ceo TASKP=1 node tests/browser/serve.mjs out 4213
    python3 tests/browser/task-closure.py
"""
from playwright.sync_api import sync_playwright
import json, re, urllib.request

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
def get(port, path): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())
READY = "Send the quotation to Zainab Kitchen"
CLOSED = "Brochure posted to Zainab Kitchen"
EDITS = "MARA - DANANITA DEHANA"
PORT = 4213

def page(b, w=1440, h=1000):
    urllib.request.urlopen(f"http://127.0.0.1:{PORT}/__reset").read()
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/portal"); pg.wait_for_timeout(2500)
    return ctx, pg, errs

def tab(pg, name):
    btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count() == 0:
        m = pg.get_by_role("button", name="More").filter(visible=True)
        if m.count(): m.first.click(); pg.wait_for_timeout(500)
        btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count(): btn.first.click(); pg.wait_for_timeout(1800); return True
    return False

# v1.319.0 (Tasks 2.0 Stage 1, T2-4) - WHERE A TASK OPENS: beside the My Tasks
# list from 1280px (picture 2), as a full page from 768px (picture 4), in the
# drawer on a phone. The same pieces in each, so the same checks hold.
PANEL = "[data-testid=task-workspace]:visible, [role=dialog]:visible"
def panel(pg, title):
    return pg.locator(PANEL).filter(has_text=title).first
def leave_task(pg):
    back = pg.get_by_test_id("ws-back").filter(visible=True)
    if back.count(): back.first.click(); pg.wait_for_timeout(800)
    else: pg.keyboard.press("Escape"); pg.wait_for_timeout(600)
def part(pg, dr, pat):
    t = dr.get_by_role("tab", name=pat)
    if t.count(): t.first.click(); pg.wait_for_timeout(1500)
def stages(dr):
    """the drawer's stage timeline (a phone); the four steps (the page and beside the list)"""
    st = dr.get_by_test_id("task-stages")
    if st.count() == 0: st = dr.get_by_test_id("flow-steps")
    return [li.get_attribute("data-state") for li in st.locator("li[data-state]").all()] if st.count() else []
def view(pg, name):
    """a Tasks view: the tab row at desk width, the view switch on a phone (v1.313.0)"""
    t = pg.get_by_role("tab", name=name, exact=True).filter(visible=True)
    if t.count(): t.first.click()
    else:
        pg.get_by_test_id("tasks-view-bar").get_by_test_id("view-switch").click(); pg.wait_for_timeout(300)
        pg.get_by_role("menuitemradio", name=re.compile("^" + name)).click()
    pg.wait_for_timeout(1000)
def open_task(pg, title):
    view(pg, "My Tasks")
    pg.get_by_role("button", name=title).filter(visible=True).first.click(); pg.wait_for_timeout(2000)
    return panel(pg, title)

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
# past the drawer's right edge - except inside a strip made to scroll sideways (the tab row)
INSIDE = """d => { const r = d.getBoundingClientRect(); let bad = 0;
  const scrolls = (el) => { for (let x = el.parentElement; x && x !== d; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  for (const el of d.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (b.width && b.right > r.right + 1 && !scrolls(el)) bad++; } return bad; }"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (1440, 390, 320):
        ctx, pg, errs = page(b, w, 900)
        tab(pg, "Tasks")
        # ---- the board: no dropdown, the state and Update ----
        view(pg, "My Tasks")
        body = pg.locator("main").inner_text() if pg.locator("main").count() else pg.inner_text("body")
        check(f"{w}px: the board has no status dropdown - the state and one Update action", pg.locator("select[aria-label^='Status — ']").count() == 0 and (pg.get_by_test_id("my-cards").locator(f"li:has-text('{READY}')").count() == 1 if w >= 1280 else pg.get_by_role("button", name=f"Update status — {READY}").filter(visible=True).count() >= 1))
        # ---- a task at 100%: what is left, Close task ----
        dr = open_task(pg, READY)
        nxt = dr.get_by_test_id("next-step")
        check(f"{w}px: at 100% the task says what is left - close it with a summary; nothing closes it by itself", nxt.count() == 1 and "Close the task with a short completion summary" in nxt.inner_text(), nxt.inner_text() if nxt.count() else "")
        states = stages(dr)
        # the drawer (a phone): Created done, In progress now, Closed to come. The page: the four steps, the task on exactly one, Done to come
        check(f"{w}px: the stages: where the task stands now, and the last still to come", (states.count("now") == 1 and states[-1] == "todo") if w >= 768 else (states[:1] == ["done"] and "now" in states and states[-1] == "todo"), str(states))
        check(f"{w}px: the drawer is not wider than the screen", dr.evaluate(INSIDE) == 0 and pg.evaluate(FITS), dr.evaluate(INSIDE))
        dr.get_by_test_id("close-task").click(); pg.wait_for_timeout(700)
        sh = dr.get_by_test_id("update-sheet")
        opts = [o.inner_text().strip() for o in sh.get_by_label("Status", exact=True).locator("option").all()] if sh.count() else []
        check(f"{w}px: Close task opens Add Status Update INSIDE the task drawer (one layer), on Closed", sh.count() == 1 and pg.get_by_role("dialog").count() == (0 if w >= 768 else 1) and sh.get_by_label("Status", exact=True).input_value() == "closed", str(opts))
        check(f"{w}px: the statuses: In Progress, Waiting for Client, On Hold / Blocked, Done (a self-set task has no reviewer)", opts == ["In Progress", "Waiting for Client", "On Hold / Blocked", "Done"], str(opts))
        check(f"{w}px: closing asks for a completion summary and explains Closed", "Completion summary *" in sh.inner_text() and "marks the task complete and final" in sh.inner_text())
        check(f"{w}px: the form is not wider than the screen", dr.evaluate(INSIDE) == 0 and pg.evaluate(FITS), dr.evaluate(INSIDE))
        post = sh.get_by_test_id("post-update")
        check(f"{w}px: the Close button is on screen, above the phone's bottom bar", post.is_visible() and post.evaluate("e => e.getBoundingClientRect().bottom <= window.innerHeight"))
        post.click(); pg.wait_for_timeout(800)
        check(f"{w}px: an empty summary is refused on the screen - nothing sent", "Write the completion summary" in sh.inner_text() and not [x for x in get(PORT, "/__tasks")["posts"] if x["p"].endswith("/close")])
        sh.get_by_test_id("sheet-text").fill("Sent QT-2026-0019 by email and WhatsApp")
        post.click(); pg.wait_for_timeout(1500)
        cl = [x for x in get(PORT, "/__tasks")["posts"] if x["p"].endswith("/close")]
        cb = json.loads(cl[0]["body"]) if cl else {}
        check(f"{w}px: one POST /close with the summary and a once-only key; the toast says Task closed", len(cl) == 1 and cb.get("summary") == "Sent QT-2026-0019 by email and WhatsApp" and (cl[0]["key"] or cb.get("client_key")) and "Task closed" in pg.inner_text("body"), str(cl))
        leave_task(pg)
        # ---- a closed task: who, when, summary, late; Reopen with a reason ----
        view(pg, "All Tasks")
        pg.get_by_label("Status", exact=True).filter(visible=True).first.select_option("any"); pg.wait_for_timeout(600)
        pg.get_by_role("button", name=CLOSED).filter(visible=True).first.click(); pg.wait_for_timeout(2000)
        dr = panel(pg, CLOSED)
        cz = dr.get_by_test_id("closure")
        ct = cz.inner_text() if cz.count() else ""
        check(f"{w}px: a closed task shows Closed, who, when, the summary and how late", "Closed" in ct and "Delivered the signed forms" in ct and "day(s) after the due date" in ct, ct[:200])
        states = stages(dr)
        check(f"{w}px: its timeline ends in Closed, done", states and states[-1] == "done", str(states))
        sl = dr.get_by_test_id("summary-latest")
        check(f"{w}px: the status summary leads with the closure and its summary", sl.count() == 1 and "Closed" in sl.inner_text() and "Delivered the signed forms" in sl.inner_text(), sl.inner_text()[:200] if sl.count() else "")
        hdr = panel(pg, CLOSED).inner_text()
        check(f"{w}px: a closed task is never labelled Overdue - it says how late it closed", "Overdue" not in hdr and "closed" in hdr.lower(), hdr[:200])
        check(f"{w}px: no update form on a closed task", dr.get_by_test_id("add-update").count() == 0 and dr.get_by_test_id("update-sheet").count() == 0)
        dr.get_by_test_id("reopen-task").click(); pg.wait_for_timeout(500)
        pd = pg.get_by_role("dialog").filter(has_text="Reopen this task").last
        check(f"{w}px: Reopen asks for the reason and says the history stays", pd.count() == 1 and "closing record, the checklist and the progress stay" in pd.inner_text())
        pd.get_by_label(re.compile("Reason")).fill("Zainab asked for a revised quotation")
        pd.get_by_role("button", name="Reopen task").click(); pg.wait_for_timeout(1500)
        ro = [x for x in get(PORT, "/__tasks")["posts"] if x["p"].endswith("/reopen")]
        check(f"{w}px: one POST /reopen with the reason", len(ro) == 1 and json.loads(ro[0]["body"]).get("reason") == "Zainab asked for a revised quotation", str(ro))
        # ---- the timeline feed ----
        part(pg, dr, re.compile("^(Updates( & Comments)?|Notes)$"))
        feed = dr.get_by_test_id("task-feed")
        kinds = [li.get_attribute("data-kind") for li in feed.locator("li").all()]
        check(f"{w}px: the timeline shows the closure and the task's creation - real events only", "closed" in kinds and kinds[-1] == "created", str(kinds))
        ft = feed.inner_text()
        check(f"{w}px: each reported progress says where it came from (the checklist at that time)", "the checklist at that time" in ft or "reported" in ft, ft[:200])
        for f in ["All", "Updates", "Progress", "Status change"]:
            check(f"{w}px: the {f} filter is there", dr.get_by_role("button", name=f, exact=True).count() == 1)
        dr.get_by_role("button", name="Status change", exact=True).click(); pg.wait_for_timeout(300)
        check(f"{w}px: Status change shows only status moves", set(li.get_attribute("data-kind") for li in feed.locator("li").all()) <= {"closed", "closed_with_exception", "reopened", "review_request", "review_approved", "review_returned", "cancel", "blocker", "waiting_client"})
        check(f"{w}px: the feed is not wider than the screen", dr.evaluate(INSIDE) == 0 and pg.evaluate(FITS), dr.evaluate(INSIDE))
        # ---- v1.257.0: edit and withdraw with the history kept; a reported % beside the checklist ----
        leave_task(pg)
        view(pg, "All Tasks")
        pg.get_by_label("Status", exact=True).filter(visible=True).first.select_option("any"); pg.wait_for_timeout(600)
        pg.get_by_role("button", name=EDITS).filter(visible=True).first.click(); pg.wait_for_timeout(2000)
        dr = panel(pg, EDITS)
        rl = dr.get_by_test_id("reported-line")
        check(f"{w}px: Details shows the last reported % beside the checklist figure", rl.count() == 1 and "last reported 60%" in rl.inner_text(), rl.inner_text() if rl.count() else "")
        # ---- v1.258.0: the status summary on Details ----
        sm = dr.get_by_test_id("status-summary")
        st = sm.inner_text() if sm.count() else ""
        lt = sm.get_by_test_id("summary-latest").inner_text() if sm.count() else ""
        check(f"{w}px: Details carries a status summary with the latest update in full", sm.count() == 1 and "Status summary" in st and "Documentation submitted to MARA Johor" in lt and "Farid Zulkifli" in lt, st[:300])
        check(f"{w}px: the summary's latest update shows its reported %, that it was edited, and its next action", "Reported 60%" in lt and "Edited by" in lt and "Wait for the officer" in lt, lt[:300])
        check(f"{w}px: the withdrawn entry stays out of the summary", "683768" not in st, st[:300])
        fx = sm.get_by_test_id("summary-facts").inner_text() if sm.count() else ""
        check(f"{w}px: where it stands - done so far, next action, blocking, progress - from the record only", "Not reported yet" in fx and "Wait for the officer" in fx and "Not blocked" in fx and "0% (checklist)" in fx and "reported 60%" in fx, fx[:300])
        check(f"{w}px: the summary sits inside the drawer, nothing past its edge", dr.evaluate(INSIDE) == 0 and pg.evaluate(FITS), dr.evaluate(INSIDE))
        sm.get_by_test_id("summary-all").click(); pg.wait_for_timeout(1200)
        check(f"{w}px: See all updates opens the Updates & Comments tab", dr.get_by_test_id("task-feed").count() == 1 and dr.get_by_test_id("task-feed").is_visible())
        part(pg, dr, re.compile("^(Updates( & Comments)?|Notes)$"))
        feed = dr.get_by_test_id("task-feed")
        wd = feed.locator("li[data-withdrawn='1']")
        check(f"{w}px: the mistaken entry is withdrawn - who and why shown, the number itself gone from the timeline", wd.count() == 1 and "withdrawn by" in wd.inner_text() and "Typed my authenticator code by mistake" in wd.inner_text() and "683768" not in feed.inner_text(), feed.inner_text()[:300])
        wd.get_by_role("button", name="Show original").click(); pg.wait_for_timeout(300)
        check(f"{w}px: Show original brings the withdrawn words back, marked as withdrawn", "683768" in feed.inner_text() and "Original - withdrawn by" in feed.inner_text())
        ft = feed.inner_text()
        check(f"{w}px: the edited update shows its new text and who edited it", "Documentation submitted to MARA Johor" in ft and "Edited by" in ft, ft[:300])
        check(f"{w}px: its reported % is labelled against the official checklist", "Reported 60% · the checklist then 0% (official)" in ft, ft[:300])
        mark = feed.get_by_test_id("edited-mark").filter(has_text="Edited by").first
        mark.get_by_role("button", name="Show original").click(); pg.wait_for_timeout(300)
        check(f"{w}px: Show original shows the words as first written", "Original, as first written" in feed.inner_text() and "Documentation submitted to MARA Johor" not in feed.locator("li", has_text="Original, as first written").first.inner_text())
        eb = feed.get_by_test_id("edit-btn")
        check(f"{w}px: Edit and Withdraw are offered on the update the server allows", eb.count() == 1 and feed.get_by_test_id("withdraw-btn").count() == 1)
        eb.first.click(); pg.wait_for_timeout(300)
        box = feed.get_by_test_id("edit-update")
        box.locator("textarea").fill("Documentation submitted to MARA Johor on 3 Nov")
        box.get_by_role("button", name="Save edit").click(); pg.wait_for_timeout(1500)
        pe = [x for x in get(PORT, "/__tasks")["posts"] if x["p"].endswith("/edit")]
        check(f"{w}px: Save edit sends one edit of that update, once-only", len(pe) == 1 and json.loads(pe[0]["body"]).get("body") == "Documentation submitted to MARA Johor on 3 Nov" and pe[0]["key"], str(pe))
        feed.get_by_test_id("withdraw-btn").first.click(); pg.wait_for_timeout(500)
        pd = pg.get_by_role("dialog").filter(has_text="Withdraw this update").last
        check(f"{w}px: Withdraw asks the reason and says the status and progress stay", pd.count() == 1 and "status and progress stay" in pd.inner_text())
        pd.get_by_label(re.compile("Reason")).fill("Posted on the wrong task")
        pd.get_by_role("button", name="Withdraw", exact=True).click(); pg.wait_for_timeout(1500)
        pw = [x for x in get(PORT, "/__tasks")["posts"] if x["p"].endswith("/withdraw")]
        check(f"{w}px: one POST /withdraw with the reason", len(pw) == 1 and json.loads(pw[0]["body"]).get("reason") == "Posted on the wrong task", str(pw))
        part(pg, dr, "Details")
        if dr.get_by_test_id("add-update").count(): dr.get_by_test_id("add-update").click(); pg.wait_for_timeout(700)
        rp = dr.get_by_test_id("reported-progress")
        check(f"{w}px: on a checklist task the form offers a reported %, the checklist staying official", rp.count() == 1 and "official progress stays the checklist" in dr.get_by_test_id("update-sheet").inner_text())
        check(f"{w}px: the edit and withdraw views are not wider than the screen", dr.evaluate(INSIDE) == 0 and pg.evaluate(FITS), dr.evaluate(INSIDE))
        check(f"{w}px: no script errors", not errs, str(errs)[:300])
        ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"task-closure: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

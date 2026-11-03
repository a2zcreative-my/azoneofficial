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

def open_task(pg, title):
    pg.get_by_role("tab", name="My Tasks", exact=True).first.click(); pg.wait_for_timeout(1000)
    pg.get_by_role("button", name=title).filter(visible=True).first.click(); pg.wait_for_timeout(2000)
    return pg.get_by_role("dialog").filter(has_text=title).first

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
        pg.get_by_role("tab", name="My Tasks", exact=True).first.click(); pg.wait_for_timeout(1000)
        body = pg.locator("main").inner_text() if pg.locator("main").count() else pg.inner_text("body")
        check(f"{w}px: the board has no status dropdown - the state and one Update action", pg.locator("select[aria-label^='Status — ']").count() == 0 and pg.get_by_role("button", name=f"Update status — {READY}").filter(visible=True).count() >= 1)
        # ---- a task at 100%: what is left, Close task ----
        dr = open_task(pg, READY)
        nxt = dr.get_by_test_id("next-step")
        check(f"{w}px: at 100% the task says what is left - close it with a summary; nothing closes it by itself", nxt.count() == 1 and "Close the task with a short completion summary" in nxt.inner_text(), nxt.inner_text() if nxt.count() else "")
        st = dr.get_by_test_id("task-stages")
        states = [li.get_attribute("data-state") for li in st.locator("li").all()] if st.count() else []
        check(f"{w}px: the stage timeline (the Leave/Claims component): Created done, In progress now, Closed still to come", states[:1] == ["done"] and "now" in states and states[-1] == "todo", str(states))
        check(f"{w}px: the drawer is not wider than the screen", dr.evaluate(INSIDE) == 0 and pg.evaluate(FITS), dr.evaluate(INSIDE))
        dr.get_by_test_id("close-task").click(); pg.wait_for_timeout(700)
        sh = dr.get_by_test_id("update-sheet")
        opts = [o.inner_text().strip() for o in sh.get_by_label("Status", exact=True).locator("option").all()] if sh.count() else []
        check(f"{w}px: Close task opens Add Status Update INSIDE the task drawer (one layer), on Closed", sh.count() == 1 and pg.get_by_role("dialog").count() == 1 and sh.get_by_label("Status", exact=True).input_value() == "closed", str(opts))
        check(f"{w}px: the statuses: In Progress, Waiting for Client, On Hold / Blocked, Closed (a self-set task has no reviewer)", opts == ["In Progress", "Waiting for Client", "On Hold / Blocked", "Closed"], str(opts))
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
        pg.keyboard.press("Escape"); pg.wait_for_timeout(600)
        # ---- a closed task: who, when, summary, late; Reopen with a reason ----
        pg.get_by_role("tab", name="All Tasks", exact=True).first.click(); pg.wait_for_timeout(1000)
        pg.get_by_label("Status", exact=True).filter(visible=True).first.select_option("any"); pg.wait_for_timeout(600)
        pg.get_by_role("button", name=CLOSED).filter(visible=True).first.click(); pg.wait_for_timeout(2000)
        dr = pg.get_by_role("dialog").filter(has_text=CLOSED).first
        cz = dr.get_by_test_id("closure")
        ct = cz.inner_text() if cz.count() else ""
        check(f"{w}px: a closed task shows Closed, who, when, the summary and how late", "Closed" in ct and "Delivered the signed forms" in ct and "day(s) after the due date" in ct, ct[:200])
        st = dr.get_by_test_id("task-stages")
        states = [li.get_attribute("data-state") for li in st.locator("li").all()] if st.count() else []
        check(f"{w}px: its timeline ends in Closed, done", states and states[-1] == "done", str(states))
        hdr = pg.get_by_role("dialog").filter(has_text=CLOSED).first.inner_text()
        check(f"{w}px: a closed task is never labelled Overdue - it says how late it closed", "Overdue" not in hdr and "closed" in hdr.lower(), hdr[:200])
        check(f"{w}px: no Update status on a closed task", dr.get_by_test_id("add-update").count() == 0)
        dr.get_by_test_id("reopen-task").click(); pg.wait_for_timeout(500)
        pd = pg.get_by_role("dialog").filter(has_text="Reopen this task").last
        check(f"{w}px: Reopen asks for the reason and says the history stays", pd.count() == 1 and "closing record, the checklist and the progress stay" in pd.inner_text())
        pd.get_by_label(re.compile("Reason")).fill("Zainab asked for a revised quotation")
        pd.get_by_role("button", name="Reopen task").click(); pg.wait_for_timeout(1500)
        ro = [x for x in get(PORT, "/__tasks")["posts"] if x["p"].endswith("/reopen")]
        check(f"{w}px: one POST /reopen with the reason", len(ro) == 1 and json.loads(ro[0]["body"]).get("reason") == "Zainab asked for a revised quotation", str(ro))
        # ---- the timeline feed ----
        dr.get_by_role("tab", name=re.compile("^Updates & Comments")).click(); pg.wait_for_timeout(1500)
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
        check(f"{w}px: no script errors", not errs, str(errs)[:300])
        ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"task-closure: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

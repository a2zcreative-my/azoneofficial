"""EDIT TASK TITLE (v1.289.0) - in a browser (the CEO, 12-11-2026, image 02;
claude/TASK-TITLE-BLUEPRINT.md). The rules are proven by direct request in
tests/task-title.mjs; here, the screens: the Edit Title control in the task
drawer (desktop and phone), Save sends ONLY the title, Cancel and Escape send
nothing, the helper sees no control, no sideways page. The task answers are
the REAL worker's (tests/browser/task-fixture.json, captured by go-live-t).

Servers: the task-progress set (TASKP=1)
    ROLE=ceo TASKP=1 node tests/browser/serve.mjs out 4213
    ROLE=live_host TASKP=1 node tests/browser/serve.mjs out 4214
    ROLE=editor TASKP=1 node tests/browser/serve.mjs out 4215
"""
from playwright.sync_api import sync_playwright
import json, urllib.request

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)
def get(port, path): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())
TITLE = "Financing application - Maybank SME"
HELP = "Design & content creation"

def page(b, port, w=1440, h=1000):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Tasks"); pg.wait_for_timeout(2800)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def open_task(pg, title):
    at = pg.get_by_role("tab", name="All Tasks", exact=True)
    if at.count(): at.first.click(); pg.wait_for_timeout(1000)
    row = pg.locator(f"tr:has-text('{title}')").first
    if row.count() and row.is_visible():
        row.get_by_role("button", name=title).first.click()
    else:
        pg.get_by_role("button", name=title).filter(visible=True).first.click()
    pg.wait_for_timeout(2000)
    return pg.get_by_role("dialog").filter(has_text=title).first

def patches(port): return [x for x in get(port, "/__tasks")["posts"] if x["method"] == "PATCH"]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

with sync_playwright() as p:
    b = p.chromium.launch()
    for port, who, w in [(4213, "CEO (reviewer)", 1440), (4214, "Assignee", 1280), (4213, "CEO phone", 390), (4214, "Assignee phone", 360)]:
        tag = f"{who} {w}"
        ctx, pg, errs = page(b, port, w, 900 if w > 500 else 800)
        dr = open_task(pg, TITLE)
        bar = dr.get_by_test_id("task-title-bar")
        check(f"{tag}: the drawer shows the title bar with the task ID and Edit Title", bar.count() == 1 and "TSK-" in bar.inner_text() and bar.get_by_test_id("edit-title").count() == 1, bar.inner_text() if bar.count() else "")
        before = len(patches(port))
        bar.get_by_test_id("edit-title").click(); pg.wait_for_timeout(300)
        inp = bar.get_by_test_id("title-input")
        check(f"{tag}: the field opens with the current title, focused", inp.count() == 1 and inp.input_value() == TITLE and inp.evaluate("e => e === document.activeElement"))
        inp.fill("Something else"); inp.press("Escape"); pg.wait_for_timeout(300)
        check(f"{tag}: Escape cancels and sends nothing", bar.get_by_test_id("title-input").count() == 0 and len(patches(port)) == before)
        bar.get_by_test_id("edit-title").click(); pg.wait_for_timeout(200)
        bar.get_by_test_id("title-input").fill("   ")
        check(f"{tag}: an empty title cannot be saved", bar.get_by_test_id("save-title").is_disabled())
        bar.get_by_test_id("title-input").fill("Financing application")
        if w < 500:
            hb = [bar.get_by_test_id(t).bounding_box()["height"] for t in ("save-title", "cancel-title")]
            check(f"{tag}: Save and Cancel are at least 44 px on a phone", min(hb) >= 43.5, hb)
        bar.get_by_test_id("save-title").click(); pg.wait_for_timeout(1200)
        pt = patches(port)[before:]
        body = json.loads(pt[0]["body"]) if pt else {}
        check(f"{tag}: Save sends ONE PATCH with only the title", len(pt) == 1 and pt[0]["p"].startswith("/staff/tasks/") and body == {"title": "Financing application"}, pt)
        check(f"{tag}: the field closes after saving", bar.get_by_test_id("title-input").count() == 0)
        check(f"{tag}: no sideways page", no_hscroll(pg))
        if w < 500:
            eb = bar.get_by_test_id("edit-title").bounding_box()["height"]
            check(f"{tag}: Edit Title is at least 44 px on a phone", eb >= 43.5, eb)
        pg.screenshot(path=f"/tmp/task-title-{port}-{w}.png")
        check(f"{tag}: no page error", not errs, errs)
        ctx.close()

    # the helper: no Edit Title (the server says can.edit false)
    for w in (1280, 390):
        ctx, pg, errs = page(b, 4215, w, 900)
        dr = open_task(pg, HELP)
        bar = dr.get_by_test_id("task-title-bar")
        check(f"Helper {w}: the title is shown, with no Edit Title", bar.count() == 1 and HELP in bar.inner_text() and bar.get_by_test_id("edit-title").count() == 0, bar.inner_text() if bar.count() else "")
        check(f"Helper {w}: no page error", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\ntask-title: {len(res) - len(failed)}/{len(res)} passed")
if failed: raise SystemExit(1)

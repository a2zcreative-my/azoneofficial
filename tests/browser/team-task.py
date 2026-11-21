"""A SHARED TEAM TASK IS ONE ROW (21-11-2026, the CEO's brief and reference
picture, "Approve stages 1-2"). The rules are proven by direct request in
tests/go-live-t.mjs (TEAM checks); here, the screens: All Tasks lists the team
task once with the person responsible and its helpers (two photos, "+1", the
names) and the Team Task chip; a one-person task keeps its old cell; the board
card draws the same people; Create Task sends the extra people with ONE POST;
no sideways page on a phone.

Server (the fixture's team task, id 8):
    ROLE=ceo TEAMTASK=1 node tests/browser/serve.mjs out 4230
"""
from playwright.sync_api import sync_playwright
import json, urllib.request

PORT = 4230
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)
def get(path): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}").read())
TEAM = "Shop floor team meeting"
SOLO = "Check inventory delivery"
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def page(b, w, h):
    urllib.request.urlopen(f"http://127.0.0.1:{PORT}/__reset").read()
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/portal?tab=Tasks&view=all"); pg.wait_for_timeout(2800)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (1440, 390):
        tag = f"CEO {w}"
        ctx, pg, errs = page(b, w, 900 if w > 500 else 800)
        rows = pg.locator(f"[data-record='task:8']:visible")
        check(f"{tag}: All Tasks lists the team task ONCE", rows.count() == 1, rows.count())
        who = rows.first.get_by_test_id("task-assignees")
        txt = who.inner_text() if who.count() else ""
        check(f"{tag}: its Assignee cell holds all three people - two photos, +1, the names in order", who.count() == 1 and who.get_attribute("data-people") == "3" and "+1" in txt and "Farid Zul, Nur Aisyah, Mei Ling" in txt, txt)
        check(f"{tag}: ...and the Team Task chip", rows.first.get_by_test_id("team-task-chip").count() == 1)
        solo = pg.locator("[data-record='task:1']:visible").first
        check(f"{tag}: a one-person task keeps its old cell (no stack, no chip)", solo.count() == 1 and solo.get_by_test_id("task-assignees").count() == 0 and solo.get_by_test_id("team-task-chip").count() == 0 and "Nur Aisyah" in solo.inner_text())
        check(f"{tag}: no sideways page", no_hscroll(pg))
        pg.screenshot(path=f"/tmp/team-task-{w}.png")
        check(f"{tag}: no page error", not errs, errs)
        ctx.close()

    # the board draws the same people on the card
    ctx, pg, errs = page(b, 1440, 900)
    bd = pg.get_by_role("button", name="Board", exact=True)
    if bd.count(): bd.first.click(); pg.wait_for_timeout(800)
    card = pg.locator("article[data-record='task:8']:visible")
    check("Board: the team task is one card, with its three people", card.count() == 1 and card.first.get_by_test_id("task-assignees").get_attribute("data-people") == "3", card.count())
    ctx.close()

    # Create Task: the extra people go with the ONE create
    ctx, pg, errs = page(b, 1440, 900)
    before = len(get("/__tasks")["posts"])
    pg.get_by_role("button", name="Create Task").filter(visible=True).first.click(); pg.wait_for_timeout(800)
    dlg = pg.locator("[role=dialog]:visible").first
    dlg.get_by_label("Title", exact=False).first.fill("Team task from the browser")
    pick = dlg.get_by_test_id("create-helper-pick")
    pick.select_option(label="Nur Aisyah"); pg.wait_for_timeout(200)
    pick.select_option(label="Farid Zul"); pg.wait_for_timeout(200)
    chips = dlg.get_by_test_id("create-helpers")
    check("Create: the chosen people show as chips with the team count", chips.count() == 1 and "Nur Aisyah" in chips.inner_text() and "Farid Zul" in chips.inner_text() and "3 people" in chips.inner_text(), chips.inner_text() if chips.count() else "")
    dlg.get_by_role("button", name="Create Task").last.click(); pg.wait_for_timeout(1500)
    posts = [x for x in get("/__tasks")["posts"][before:] if x["method"] == "POST" and x["p"] == "/staff/tasks"]
    body = json.loads(posts[0]["body"]) if posts else {}
    check("Create: ONE POST, the extra people as assistants (never a POST per person)", len(posts) == 1 and sorted(body.get("assistants", [])) == [9002, 9003], posts)
    check("Create: no page error", not errs, errs)
    ctx.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\nteam-task: {len(res) - len(failed)} of {len(res)} passed")
raise SystemExit(1 if failed else 0)

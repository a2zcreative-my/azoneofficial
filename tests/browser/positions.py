"""THE POSITIONS LIST (v1.322.0, the CEO's "Position list (Recommended)",
16-11-2026; claude/POSITIONS-STAGE-0-AUDIT.md) - in a browser.

  the CEO         the Positions card on Departments & Roles: add (linked to an
                  access level), rename with the holders carried across, a
                  re-link that says nobody's access changes, retire and Show
                  retired, the history, the titles typed on records
  the record      Position offers the list and still takes any title; the hint
                  says "not on the list", or that the position's level differs
                  from the person's role - and changes nothing; Review the role
                  opens Role & Access
  the others      the COO and the HR admin read the list (the picker) but have
                  no card; the server refuses them anyway (tests/positions.mjs)
  widths          320 to 1440: the card stays inside the screen

Invented fixtures (tests/browser/fixture.mjs, serve.mjs). Servers: 4300 ceo,
4301 coo, 4302 hr_admin (STAFF4=1), 4183 super_admin.
"""
from playwright.sync_api import sync_playwright
import re, json, urllib.request

CEO, COO, HR, SA = 4300, 4301, 4302, 4183
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
get = lambda port, path: json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())
def go(b, port, view="roles", w=1440, h=1100):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Staff%20Details&view={view}"); pg.wait_for_timeout(2800)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs
def listed(pg):
    return [li.locator("strong").first.inner_text().strip() for li in pg.get_by_test_id("positions-list").locator(":scope > li").all()]

with sync_playwright() as p:
    b = p.chromium.launch()

    # ================= the CEO keeps the list =================
    ctx, pg, errs = go(b, CEO)
    card = pg.get_by_test_id("positions-card")
    check("the CEO: the Positions card on Departments & Roles, with the two on the list", card.count() == 1 and listed(pg) == ["Sales Executive", "Live Host"], listed(pg) if card.count() else "no card")
    check("each position shows its access level and how many hold it", "Sales & Marketing" in card.inner_text() and "2 holding it" in card.inner_text())
    check("it says a position never changes anybody's access", "never changes anybody's access" in card.inner_text())
    off = pg.get_by_test_id("positions-off")
    check("the titles typed on records but not on the list are named", off.count() == 1 and "HR Executive" in off.inner_text() and "Graphic Designer" in off.inner_text())
    # add
    pg.get_by_test_id("positions-add-btn").click(); pg.wait_for_timeout(400)
    check("an empty add is refused on the screen - nothing sent", "Name the position" in pg.get_by_test_id("positions-msg").inner_text() and not get(CEO, "/__positions")["posts"])
    off.get_by_role("button", name="Add to the list").last.click(); pg.wait_for_timeout(200)
    check("Add to the list puts the typed title in the form", pg.get_by_test_id("positions-new-name").input_value() == "Graphic Designer")
    pg.get_by_test_id("positions-new-role").select_option("editor")
    pg.get_by_test_id("positions-add-btn").click(); pg.wait_for_timeout(900)
    posts = get(CEO, "/__positions")["posts"]
    check("Add posts the name and its access level", len(posts) == 1 and posts[0]["method"] == "POST" and posts[0]["body"].get("name") == "Graphic Designer" and posts[0]["body"].get("access_role") == "editor", posts)
    check("…the list now holds it, and it leaves the typed-on-records list", "Graphic Designer" in listed(pg) and "Graphic Designer" not in pg.get_by_test_id("positions-off").inner_text())
    # rename with holders, re-link
    li = pg.get_by_test_id("positions-list").locator(":scope > li").first
    li.get_by_test_id("positions-edit-btn").click(); pg.wait_for_timeout(300)
    ed = pg.get_by_test_id("positions-edit")
    ed.get_by_test_id("positions-edit-name").fill("Sales Consultant")
    mv = ed.get_by_test_id("positions-move-holders")
    check("renaming offers to update the 2 records that hold the old name (ticked)", mv.count() == 1 and mv.is_checked() and "2 staff record(s)" in ed.inner_text())
    ed.get_by_test_id("positions-edit-role").select_option("marketing"); pg.wait_for_timeout(200)
    check("changing the level says nobody's role changes", "changes nobody's role" in ed.inner_text())
    ed.get_by_test_id("positions-save").click(); pg.wait_for_timeout(900)
    pt = get(CEO, "/__positions")["posts"][-1]
    check("Save sends the rename, the new level and 'carry the holders across'", pt["method"] == "PATCH" and pt["path"].endswith("/positions/1") and pt["body"] == {"name": "Sales Consultant", "access_role": "marketing", "department": "Sales", "rename_holders": True}, pt)
    check("…and says the records moved and nobody's access was changed", "2 staff record(s) now read the new name" in pg.get_by_test_id("positions-msg").inner_text())
    # retire, show retired, restore
    li2 = pg.get_by_test_id("positions-list").locator(":scope > li", has_text="Live Host")
    li2.get_by_test_id("positions-retire").click(); pg.wait_for_timeout(900)
    check("Retire takes it off the list; the holders keep it", "Live Host" not in listed(pg) and "keep it" in pg.get_by_test_id("positions-msg").inner_text())
    pg.get_by_test_id("positions-show-retired").check(); pg.wait_for_timeout(300)
    check("Show retired brings it back, marked Retired, with Restore", "Live Host" in listed(pg) and pg.get_by_test_id("positions-restore").count() == 1)
    pg.get_by_test_id("positions-restore").click(); pg.wait_for_timeout(900)
    check("Restore puts it back on the list", pg.get_by_test_id("positions-restore").count() == 0 and "Live Host" in listed(pg))
    pg.get_by_test_id("positions-history-btn").first.click(); pg.wait_for_timeout(700)
    check("History shows who added it and when", "Added" in pg.get_by_test_id("positions-history").inner_text() and "Fixture Person" in pg.get_by_test_id("positions-history").inner_text())
    check("no sideways page (the card, 1440)", no_hscroll(pg))
    pg.screenshot(path="/home/claude/out/shots/positions-card-1440.png", full_page=True)
    ctx.close()
    check("no page error (CEO card)", not errs, errs)

    # ================= the record: the picker and the hint =================
    ctx, pg, errs = go(b, CEO, view="records")
    pg.get_by_test_id("rec-pick").nth(0).click(); pg.wait_for_timeout(1200)
    rec = pg.get_by_test_id("staff-record")
    rec.get_by_role("tab", name=re.compile("Employment")).click(); pg.wait_for_timeout(300)
    rec.get_by_test_id("rec-edit").click(); pg.wait_for_timeout(300)
    pos = rec.get_by_label("Position")
    check("Position offers the list (suggestions) and still takes any title", pos.get_attribute("list") == "staff-positions-list" and pg.locator("#staff-positions-list option").count() == 2)
    hint = rec.get_by_test_id("position-hint")
    check("a title not on the list is kept as typed, and said so", hint.count() == 1 and hint.get_attribute("data-kind") == "off", hint.inner_text() if hint.count() else "")
    pos.fill("Sales Executive"); pg.wait_for_timeout(200)
    check("a listed position with another level: the hint says so and that access does not change by itself", hint.get_attribute("data-kind") == "differs" and "does not change by itself" in hint.inner_text(), hint.inner_text())
    rec.get_by_test_id("position-role-door").click(); pg.wait_for_timeout(400)
    check("Review the role opens Role & Access - nothing is sent", rec.get_by_role("tab", name=re.compile("Role & Access")).get_attribute("aria-selected") == "true" and not get(CEO, "/__positions")["posts"])
    ctx.close()
    check("no page error (the record)", not errs, errs)

    # ================= the others read, never keep =================
    for who, port in [("the COO", COO), ("the HR admin", HR)]:
        ctx, pg, errs = go(b, port)
        check(f"{who}: no Positions card", pg.get_by_test_id("positions-card").count() == 0)
        check(f"{who}: the list is still read for the picker", pg.locator("#staff-positions-list option").count() == 2)
        ctx.close()
        check(f"no page error ({who})", not errs, errs)
    ctx, pg, errs = go(b, SA)
    check("the Super Admin keeps the list too", pg.get_by_test_id("positions-card").count() == 1)
    ctx.close()

    # ================= the widths =================
    for w in [320, 360, 390, 430, 768, 1024, 1280, 1440]:
        ctx, pg, errs = go(b, CEO, w=w, h=900)
        past = pg.evaluate("() => [...document.querySelectorAll('[data-testid=positions-card] *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).map(e => e.tagName).slice(0, 4)")
        check(f"{w}px: the Positions card stays inside the screen", pg.get_by_test_id("positions-card").count() == 1 and no_hscroll(pg) and past == [], past)
        if w == 390: pg.screenshot(path="/home/claude/out/shots/positions-card-390.png", full_page=True)
        ctx.close()
        check(f"{w}px: no page error", not errs, errs)
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

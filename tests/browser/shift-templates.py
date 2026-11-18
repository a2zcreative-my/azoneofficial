"""v1.373.0 - Roster & Scheduling -> Shift Templates, bulk assignment, on screen.

Servers (serve.mjs over out/): ROLE=ceo OWNER=1 SHIFTS=1 on 4370. The fixture
(shift-fixture.mjs) mirrors the preview and the save; the worker's own rules are
proven by tests/shift-bulk.mjs.  SHOTS=dir writes the screenshots."""
import json, os, re, urllib.request
from playwright.sync_api import sync_playwright

SHOTS = os.environ.get("SHOTS", "")
PORT = 4370
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
def shot(pg, name, full=False):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name), full_page=full)
def fits(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def t(pg, i): return pg.get_by_test_id(i)
def state(): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/__shifts").read())
def reset(): urllib.request.urlopen(f"http://127.0.0.1:{PORT}/__shifts-reset").read()
URL = "/portal?tab=Roster%20%26%20Scheduling&view=templates"

def page(b, w, h):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    ctx.add_init_script("try { localStorage.setItem('azone-lang', 'en') } catch (e) {}")
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{PORT}{URL}"); pg.wait_for_timeout(2500)
    return ctx, pg, errs, reqs

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    reset()
    ctx, pg, errs, reqs = page(b, 1440, 1000)
    check("the tab opens on Shift Templates", t(pg, "shift-templates").is_visible(), pg.url)
    tabs = [x.strip() for x in pg.get_by_role("tab").all_inner_texts()]
    check("the Roster & Scheduling tabs are unchanged", tabs[:5] == ["Today", "Roster Board", "Shift Roster", "Shift Templates", "Live Reports"], tabs)
    check("pattern cards: every pattern plus New Pattern", t(pg, "st-cards").locator("[role=radio]").count() == 5 and t(pg, "st-new-pattern").is_visible())
    check("the default pattern is chosen first and shows its Friday exception", t(pg, "st-card-1").get_attribute("aria-checked") == "true" and "09:00 – 17:00 (Fri 16:30)" in t(pg, "st-card-1").inner_text(), t(pg, "st-card-1").inner_text())
    check("no Import, no Export, no KPI cards", pg.get_by_role("button", name=re.compile("^(Import|Export)$")).count() == 0 and t(pg, "shift-templates").locator("[data-cell]").count() == 0)
    heads = [x.strip() for x in t(pg, "st-table").locator("thead th").all_inner_texts()]
    check("table: select, staff, department, current pattern, working hours, effective from, status", [h.lower() for h in heads[1:]] == ["staff name", "department", "current pattern", "working hours", "effective from", "status"], heads)
    check("ten rows a page, twelve staff", t(pg, "st-table").locator("tbody tr").count() == 10 and "of 12 staff" in t(pg, "shift-templates").inner_text())
    t(pg, "st-search").fill("Farah"); pg.wait_for_timeout(300)
    check("search finds a person; a planned change is shown in Status", t(pg, "st-table").locator("tbody tr").count() == 1 and "Office from" in t(pg, "st-row-9011").inner_text(), t(pg, "st-table").inner_text())
    t(pg, "st-search").fill(""); pg.wait_for_timeout(300)
    check("the effective date starts tomorrow at the earliest", t(pg, "st-from").get_attribute("min") == pg.evaluate("new Date(Date.now()+8*3600e3+864e5).toISOString().slice(0,10)"))
    check("Review is off until somebody is chosen", t(pg, "st-review").is_disabled())
    shot(pg, "st-desktop-empty.png")
    # filter + select all visible
    t(pg, "st-dept").select_option("Sales"); pg.wait_for_timeout(300)
    check("filter by department", t(pg, "st-table").locator("tbody tr").count() == 3)
    t(pg, "st-all").check(); pg.wait_for_timeout(200)
    check("select all visible picks the three shown", "3 staff selected" in t(pg, "st-count").inner_text(), t(pg, "st-count").inner_text())
    t(pg, "st-dept").select_option(""); pg.wait_for_timeout(300)
    check("the selection is kept when the filter changes", "3 staff selected" in t(pg, "st-count").inner_text())
    t(pg, "st-check-9003").check(); t(pg, "st-check-9008").check()
    check("one more ticked: 5 selected", "5 staff selected" in t(pg, "st-count").inner_text())
    t(pg, "st-card-2").click(); pg.wait_for_timeout(200)
    check("choosing a card sets the one pattern", t(pg, "st-pattern").input_value() == "2")
    d = pg.evaluate("new Date(Date.now()+8*3600e3+7*864e5).toISOString().slice(0,10)")
    t(pg, "st-from").fill(d)
    check("Review & Assign (5)", "Review & Assign (5)" in t(pg, "st-review").inner_text())
    check("desktop: no sideways scroll", fits(pg))
    shot(pg, "st-desktop-selected.png")
    n0 = len(state()["assignments"])
    t(pg, "st-review").click(); pg.wait_for_timeout(1200)
    dr = t(pg, "st-drawer")
    check("the review drawer opens", dr.is_visible())
    check("the review saved nothing", len(state()["assignments"]) == n0)
    txt = dr.inner_text()
    check("summary: 5 staff, Morning with its hours, the date, history preserved", "5 staff" in txt and "Morning" in txt and "Preserved" in txt, txt[:300])
    check("Kavitha is already on Morning: No change", t(pg, "st-prev-9007").get_attribute("data-state") == "no_change" and "No change" in t(pg, "st-prev-9007").inner_text())
    check("Aina: Office -> Morning, Change", t(pg, "st-prev-9002").get_attribute("data-state") == "change" and "Office" in t(pg, "st-prev-9002").inner_text())
    check("Farah has Office planned later: a warning that it still takes over", "will still take over" in t(pg, "st-prev-9011").inner_text())
    check("Confirm counts only the changes", "Confirm bulk assignment (4)" in t(pg, "st-confirm").inner_text(), t(pg, "st-confirm").inner_text())
    shot(pg, "st-review-drawer.png")
    t(pg, "st-confirm").click(); pg.wait_for_timeout(1500)
    sent = [json.loads(r[2] or "{}") for r in reqs if r[0] == "POST" and "/staff-shifts/bulk" in r[1]]
    check("two requests: the preview, then the explicit confirm", len(sent) == 2 and sent[0].get("dry_run") is True and sent[1].get("dry_run") is False, sent)
    check("one pattern and one date for the whole selection", all(s["pattern_id"] == 2 and s["effective_from"] == d and sorted(s["user_ids"]) == [9002, 9003, 9007, 9008, 9011] for s in sent))
    after = state()["assignments"]
    check("four saved, the older history kept", len(after) == n0 + 4 and all(any(a["id"] == i for a in after) for i in range(1, 7)))
    check("the result line says what happened", "4 assigned Morning" in t(pg, "st-result").inner_text() and "1 no change" in t(pg, "st-result").inner_text(), t(pg, "st-result").inner_text())
    check("the selection is cleared after saving", "0 staff selected" in t(pg, "st-count").inner_text())
    shot(pg, "st-desktop-done.png")
    # a same-day conflict
    t(pg, "st-check-9002").check(); t(pg, "st-card-3").click(); t(pg, "st-from").fill(d)
    t(pg, "st-review").click(); pg.wait_for_timeout(1200)
    check("Afternoon on the same day as the new Morning is a Conflict", t(pg, "st-prev-9002").get_attribute("data-state") == "conflict" and t(pg, "st-confirm").is_disabled())
    shot(pg, "st-review-conflict.png")
    t(pg, "st-back").click(); pg.wait_for_timeout(400)
    # the existing tools
    t(pg, "st-tools").click(); pg.wait_for_timeout(1500)
    tools = t(pg, "st-tools-drawer")
    check("the existing editor, single assign and history open in a drawer", tools.is_visible() and "New pattern" in tools.inner_text() and "Assign" in tools.inner_text(), tools.inner_text()[:200])
    shot(pg, "st-tools-drawer.png")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    check("desktop: no page error", not errs, errs)
    ctx.close()

    # phone
    reset()
    ctx, pg, errs, reqs = page(b, 390, 844)
    check("phone: fits 390px", fits(pg), pg.evaluate("document.documentElement.scrollWidth"))
    check("phone: the wide columns step aside, the pattern rides under the name", t(pg, "st-row-9002").locator("td").filter(visible=True).count() == 2)
    t(pg, "st-check-9002").check(); t(pg, "st-check-9006").check()
    check("phone: the selection bar shows the count", "2 staff selected" in t(pg, "st-count").inner_text())
    shot(pg, "st-phone.png")
    t(pg, "st-review").click(); pg.wait_for_timeout(1200)
    check("phone: the review drawer opens and fits", t(pg, "st-drawer").is_visible() and fits(pg))
    shot(pg, "st-phone-review.png")
    check("phone: no page error", not errs, errs)
    ctx.close()
    b.close()

fails = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(fails)} of {len(results)} passed")
if fails: raise SystemExit(1)

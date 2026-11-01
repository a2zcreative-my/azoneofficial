"""UI CORRECTIONS (v1.247.1) - the owner's screenshots of 01-11-2026:
Tasks (All Tasks, a project), and Companies. Each check measures the page.

Servers: ROLE=ceo TASKP=1 node tests/browser/serve.mjs out 4213, ROLE=editor TASKP=1 ... 4215
         ROLE=ceo node tests/browser/serve.mjs out 4208
    xvfb-run -a python3 tests/browser/ui-corrections.py
"""
from playwright.sync_api import sync_playwright
import sys, re, urllib.request

res = []
def check(n, c, x=""): res.append(("PASS " if c else "FAIL ") + n + (f" - {x}" if x and not c else ""))

def page(b, port):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, pg, errs

def tab(pg, name):
    pg.get_by_role("button", name=name, exact=True).filter(visible=True).first.click(); pg.wait_for_timeout(1800)

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---- Companies ----
    ctx, pg, errs = page(b, 4208)
    pg.goto("http://127.0.0.1:4208/portal?tab=Companies"); pg.wait_for_timeout(3500)
    gap = pg.evaluate("""() => { const n = document.querySelector('[role=status]'); const k = n && n.nextElementSibling; return n && k ? k.getBoundingClientRect().top - n.getBoundingClientRect().bottom : -1 }""")
    check("Companies: the notice no longer touches the figures under it", gap >= 12, f"gap {gap}")
    tops = pg.evaluate("""() => [...document.querySelectorAll('[class*="kpi-tile_label"]')].slice(0, 4).map(e => Math.round(e.getBoundingClientRect().top))""")
    check("Companies: the four figure tiles' labels line up", len(tops) == 4 and max(tops) - min(tops) <= 1, str(tops))
    body = pg.locator("main").inner_text()
    check("Companies: the operating company comes first", body.find("A2Z CREATIVE MARKETING") < body.find("AZ ONE OFFICIAL"))
    check("Companies: the access tile shows a figure (readiness), with the state in words", "Company access readiness" in body and re.search(r"\d+ / \d+", body) is not None and "Not active - roles still decide" in body)
    check("no page errors (Companies)", not errs, str(errs)[:200])
    ctx.close()
    # ---- Tasks ----
    ctx, pg, errs = page(b, 4213)
    pg.goto("http://127.0.0.1:4213/portal"); pg.wait_for_timeout(2500)
    tab(pg, "Tasks")
    pg.get_by_role("tab", name="All Tasks", exact=True).first.click(); pg.wait_for_timeout(1200)
    over = pg.evaluate("""() => [...document.querySelectorAll('td [class*="tasks-page_who"]')].filter(w => { const td = w.closest('td'); return w.getBoundingClientRect().right > td.getBoundingClientRect().right + 1 }).length""")
    check("All Tasks: no assignee name runs into the next column", over == 0, f"{over} overflowing")
    status = [o.inner_text().strip() for o in pg.locator("tbody select").first.locator("option").all()]
    check("All Tasks: in_progress reads In progress (the project table's word), not Pending", "In progress" in status and "Pending" not in status, str(status))
    check("no page errors (Tasks)", not errs, str(errs)[:200])
    ctx.close()
    # a project task, seen by the editor helping on it (the CEO fixture list has none)
    ctx, pg, errs = page(b, 4215)
    pg.goto("http://127.0.0.1:4215/portal"); pg.wait_for_timeout(2500)
    tab(pg, "Tasks"); pg.wait_for_timeout(1200)
    chip = pg.locator('button[title="Open the project"]').first
    ct = chip.inner_text() if chip.count() else ""
    check("All Tasks: a project task names its project, not 'Project #n'", chip.count() >= 1 and not re.match(r"^Project #\d+$", ct.strip()) and len(ct.strip()) > 3, ct)
    check("no page errors (Tasks, editor)", not errs, str(errs)[:200])
    ctx.close()
    # ---- a project's facts ----
    ctx, pg, errs = page(b, 4208)
    pg.goto("http://127.0.0.1:4208/portal"); pg.wait_for_timeout(2500)
    tab(pg, "Tasks")
    pg.get_by_role("tab", name="Projects", exact=True).first.click(); pg.wait_for_timeout(1200)
    pg.get_by_role("button", name=re.compile("Social Media Management")).first.click(); pg.wait_for_timeout(1800)
    lefts = pg.evaluate("""() => ['fact-start', 'fact-due'].map(id => { const b = document.querySelector(`[data-testid=${id}]`); const v = b && b.parentElement; return b && v ? [Math.round(b.getBoundingClientRect().left - v.getBoundingClientRect().left), Math.round(b.getBoundingClientRect().width)] : null })""")
    check("Project: Set / Change sit at the left edge under the date, not floating in the middle", all(x and x[0] <= 1 for x in lefts) and all(x and x[1] < 140 for x in lefts), str(lefts))
    check("no page errors (Project)", not errs, str(errs)[:200])
    ctx.close()
    b.close()

for r in res: print(r)
fails = [r for r in res if r.startswith("FAIL")]
print(f"ui-corrections: {len(res) - len(fails)} of {len(res)} passed")
sys.exit(1 if fails else 0)

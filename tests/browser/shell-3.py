"""v1.276.0 / v1.277.0 - A2Z OS 3.0 C1 + C2 on screen (the CEO approved the
3.0 blueprint, 10-11-2026; claude/UIUX-3.0-BLUEPRINT.md).

What the registry decides is proven by tests/registry-parity.mjs and
tests/portal-experience.mjs. Here, in a browser:
  the rail's groups read Home, Revenue, Operations, ELFIA, People, Finance,
  System; Tasks sits under Operations; Cards and Profile are at the foot;
  (v1.279.0 - the Minimal Executive Workspace rail, approved 11-11-2026:
  the photo's groups Home, Revenue, Operations, People, Finance and then
  More, which holds ELFIA and System; Cards and Profile are on the name
  card's menu at the foot - tests/browser/shell-e1.py holds the rest);
  a group folds and stays folded after a reload; the group holding the open
  tab cannot fold; the icon-only rail still lists every tab;
  the phone bar is Dashboard, Desk, On Shift, Tasks, More for a CEO, a
  salesperson and a live host;
  a KPI figure is never larger than the one tile size (22 px) on Sales,
  Tasks and the Dashboard; no sideways page; no page errors.

Servers (servers.txt): 4177 ceo, 4182 sales_marketing, 4180 live_host.
Invented people only."""
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def page(b, port, w, h, tab=None):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal" + (f"?tab={tab}" if tab else "")); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

GROUPS_JS = "() => [...document.querySelectorAll('.erp-rail-nav .erp-rail-group')].map(g => g.dataset.group)"
MAX_KPI_JS = "() => Math.max(0, ...[...document.querySelectorAll('[class*=kpi-tile_value]')].map(e => parseFloat(getComputedStyle(e).fontSize)))"

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- desktop rail (CEO) ----------
    ctx, pg, errs = page(b, 4177, 1440, 900)
    groups = pg.evaluate(GROUPS_JS)
    # v1.287.0 - the CEO's navigation directive (12-11-2026)
    check("the rail's groups are Workspace, Revenue, Operations, People, Finance, ELFIA, System - no More", groups == ["Workspace", "Revenue", "Operations", "People", "Finance", "ELFIA", "System"], groups)
    ops = pg.locator(".erp-rail-group[data-group=Operations]")
    check("Tasks sits under Operations", ops.get_by_role("button", name="Tasks", exact=True).count() == 1)
    foot = pg.locator(".erp-rail-foot")
    foot.get_by_role("button", name="Your account: Fixture Person").click(); pg.wait_for_timeout(300)
    check("Cards and Profile are at the rail's foot (on the name card's menu)", foot.get_by_role("button", name="Profile", exact=True).count() == 1 and foot.get_by_role("button", name="Cards", exact=True).count() == 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    home = pg.locator(".erp-rail-group[data-group=Workspace] > button")
    check("the group holding the open tab cannot fold", home.is_disabled())
    check("a group's fold button is named as a group, so the Finance TAB keeps the name Finance to itself",
          pg.locator(".erp-rail").get_by_role("button", name="Finance", exact=True).count() == 1 and pg.locator(".erp-rail").get_by_role("button", name="Finance group", exact=True).count() == 1)
    fin = pg.locator(".erp-rail-group[data-group=Finance] > button")
    fin.click(); pg.wait_for_timeout(300)
    check("a group folds: its items leave the rail", fin.get_attribute("aria-expanded") == "false" and pg.locator(".erp-rail-group[data-group=Finance] li").count() == 0)
    pg.reload(); pg.wait_for_timeout(2600)
    fin = pg.locator(".erp-rail-group[data-group=Finance] > button")
    check("...and stays folded after a reload", fin.get_attribute("aria-expanded") == "false")
    fin.click(); pg.wait_for_timeout(300)
    check("...and opens again", pg.locator(".erp-rail-group[data-group=Finance] li").count() >= 3)
    pg.get_by_role("button", name="Collapse navigation").click(); pg.wait_for_timeout(400)
    check("the icon-only rail is one icon per group (v1.287.0, the CEO's choice D2)", pg.locator(".erp-rail-nav button[data-group-icon]").count() == 7)
    pg.get_by_role("button", name="Expand navigation").click(); pg.wait_for_timeout(400)
    for tab in ["Sales", "Tasks"]:
        # v1.292.0 (Sales Workspace 4.0) - Sales' KPI tiles are Reports -> Sales Performance; the Overview's strip is held to the same ceiling
        pg.goto(f"http://127.0.0.1:4177/portal?tab={tab}" + ("&view=reports" if tab == "Sales" else "")); pg.wait_for_timeout(2600)
        size = pg.evaluate(MAX_KPI_JS)
        check(f"{tab}: no KPI figure above the one tile size (22 px)", 0 < size <= 22.01, size)
        check(f"{tab}: no sideways page", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    pg.goto("http://127.0.0.1:4177/portal?tab=Sales&view=overview"); pg.wait_for_timeout(2600)
    strip = pg.evaluate("() => Math.max(0, ...[...document.querySelectorAll('[data-testid=metric-strip] [class*=cellValue]')].map(e => parseFloat(getComputedStyle(e).fontSize)))")
    check("Sales Overview: the strip's figures stay under the one tile size (22 px)", 0 < strip <= 22.01, strip)
    check("no page errors (desktop)", not errs, errs)
    ctx.close()

    # ---------- phone bar: the same five for everyone ----------
    for port, who in [(4177, "CEO"), (4182, "salesperson"), (4180, "live host")]:
        ctx, pg, errs = page(b, port, 390, 844)
        labels = pg.evaluate("() => [...document.querySelectorAll('.erp-bottom-nav a, .erp-bottom-nav button')].map(e => (e.getAttribute('aria-label') || e.innerText || '').trim().split('\\n')[0])")
        check(f"{who}: the phone bar is Dashboard, Desk, On Shift, Tasks, More", labels[:5] == ["Dashboard", "Desk", "On Shift", "Tasks", "More"], labels)
        size = pg.evaluate(MAX_KPI_JS)
        check(f"{who}: phone KPI figures stay at or under the tile size", size <= 22.01, size)
        check(f"{who}: no sideways page (phone)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
        check(f"{who}: no page errors (phone)", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nshell-3: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

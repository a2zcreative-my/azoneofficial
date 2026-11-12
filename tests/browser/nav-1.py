"""v1.287.0 - GLOBAL NAVIGATION in a browser (the CEO approved the blueprint,
12-11-2026: "Do as per your recommendation"; claude/NAVIGATION-BLUEPRINT.md).
The source half is tests/navigation.mjs. Here, the CEO's acceptance tests:

  - every role's rail draws exactly the modules that role may open (the
    1.286.0 defaults), each ONCE, in the seven groups, with no empty group
    and no desktop More; an agent keeps the agent workspace only;
  - the CEO opens all 26 modules from the rail (and Profile and Cards from
    the name card); each becomes the ONE gold item, its group stays open,
    the title follows; a refresh keeps it; a ?tab= deep link opens it;
  - a group folds, stays folded after a reload, opens again; the group of
    the open page cannot fold;
  - collapsed: one icon per group, the open page's group in gold; a click
    opens a labelled flyout; a choice navigates and closes it; the keyboard
    opens it, moves in it, and Escape returns to the icon;
  - the phone keeps Dashboard, Desk, On Shift, Tasks, More; More lists the
    same groups without repeating the bar, with Projects in Operations and
    Sign out reachable; a module from More marks More on the bar;
  - Desk's Open Tasks still works;
  - no sideways page and no clipped rail label at 320, 360, 390, 430, 768,
    1024, 1280 and 1440.
Servers (servers): 4177 CEO, 4179 COO, 4185 CCO, 4181 HR, 4182 Sales,
4291 marketing, 4194 editor, 4180 live host, 4222 agent.
Invented fixture data only."""
import json, re, urllib.parse
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

LABEL = {"Announcements": "News", "Staff Details": "Staff", "Users": "Users & Security"}
GROUPS = [("Workspace", ["Dashboard", "Desk", "Announcements"]), ("Revenue", ["Sales", "Ecommerce", "Agents", "Financial Advisory"]),
          ("Operations", ["Tasks", "Inventory", "Assets", "Hotels"]), ("People", ["HR", "Staff Details", "Attendance", "On Shift", "Leave", "Claims", "Payroll"]),
          ("Finance", ["Finance", "Accounting", "Commission"]), ("ELFIA", ["ELFIA Store", "ELFIA Traffic"]), ("System", ["Companies", "Users"])]
ROLES = ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host"]
# the 1.286.0 defaults (tests/navigation.mjs holds the same, from the registry itself)
M = {"Dashboard": "YYYYYYYY", "Desk": "YYYYYYYY", "Announcements": "YYYYYYYY", "Sales": "YYYYY---", "Ecommerce": "YYYYYY--", "Agents": "YYY-Y---",
     "Financial Advisory": "YYY-Y---", "Tasks": "YYYYYYYY", "Inventory": "YYYYYY--", "Assets": "YYYY----", "Hotels": "YYYY----", "HR": "YYYY----",
     "Staff Details": "YYYY----", "Attendance": "YYYYYYYY", "On Shift": "YYYYYYYY", "Leave": "YYYYYYYY", "Claims": "YYYYYYYY", "Payroll": "YY------",
     "Finance": "YY------", "Accounting": "Y-------", "Commission": "YYY-Y---", "ELFIA Store": "YYYYYY--", "ELFIA Traffic": "YYYYYY--",
     "Companies": "YYY-----", "Users": "YY------"}
PORT = {"ceo": 4177, "coo": 4179, "cco": 4185, "hr_admin": 4181, "sales_marketing": 4182, "marketing": 4291, "editor": 4194, "live_host": 4180}
RAIL_JS = """() => [...document.querySelectorAll('.erp-rail-nav .erp-rail-group')].map(g => [g.dataset.group,
  [...g.querySelectorAll('button[data-nav-item]')].map(b => b.innerText.trim())])"""
CLIP_JS = """() => [...document.querySelectorAll('.erp-rail-item-label, .erp-rail-group-label span')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.innerText)"""
sideways = lambda pg: pg.evaluate("document.scrollingElement.scrollWidth <= window.innerWidth + 1")
title = lambda pg: pg.locator("h1.erp-topbar-title, h1").first.inner_text().strip()
gold = lambda pg: [t.strip() for t in pg.locator(".erp-rail-nav .erp-rail-item[aria-current=page]").all_inner_texts()]

def open_(b, port, w, h=900, tab=None, collapsed=False):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    if collapsed:
        pg.add_init_script("try { localStorage.setItem('azone-nav-collapsed', '1') } catch (e) {}")
    pg.goto(f"http://127.0.0.1:{port}/portal" + (f"?tab={urllib.parse.quote(tab)}" if tab else "")); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------- every role: exactly what they may open, once, grouped ----------
    for i, role in enumerate(ROLES):
        ctx, pg, errs = open_(b, PORT[role], 1440)
        rail = pg.evaluate(RAIL_JS)
        want = []
        for g, tabs in GROUPS:
            items = [LABEL.get(t, t) for t in tabs if M[t][i] == "Y"]
            if items: want.append([g, items])
        got = [[g, [x for x in items if x != "Projects"]] for g, items in rail]
        check(f"{role}: the rail is exactly their modules, once each, in the seven groups (no empty group, no More)", got == want, f"{got} != {want}")
        flat = [x for _, items in rail for x in items]
        check(f"{role}: no module twice", len(flat) == len(set(flat)), flat)
        card = pg.get_by_role("button", name=re.compile("^Your account:"))
        card.click(); pg.wait_for_timeout(300)
        menu = pg.locator("#rail-account-menu")
        check(f"{role}: Profile and Sign out are on the name card's menu", menu.get_by_role("button", name="Profile", exact=True).count() == 1 and menu.get_by_role("button", name="Sign out").count() == 1)
        check(f"{role}: Cards there only for those who may open it", (menu.get_by_role("button", name="Cards", exact=True).count() == 1) == (role in ("ceo", "coo", "cco")))
        check(f"{role}: no page errors", not errs, errs)
        ctx.close()
    ctx, pg, errs = open_(b, 4222, 1440)
    flat = [x for _, items in pg.evaluate(RAIL_JS) for x in items]
    check("agent: the staff navigation is never drawn - the agent workspace only", "Dashboard" not in flat and "Sales" not in flat and "Users & Security" not in flat, flat)
    ctx.close()

    # ---------- the CEO opens every module from the rail ----------
    ctx, pg, errs = open_(b, 4177, 1440)
    rail = pg.locator("aside.erp-rail")
    for g, tabs in GROUPS:
        for t in tabs:
            lab = LABEL.get(t, t)
            rail.get_by_role("button", name=lab, exact=True).click(); pg.wait_for_timeout(1100)
            on = gold(pg)
            grp_open = pg.locator(f".erp-rail-group[data-group='{g}'] .erp-rail-item[aria-current=page]").count() == 1
            check(f"CEO: {lab} opens from {g} and is the one gold item", on == [lab] and grp_open and title(pg) in (lab, t, "News" if t == "Announcements" else lab), f"{on} title={title(pg)}")
    pg.reload(); pg.wait_for_timeout(2600)
    check("a refresh keeps the open module (Users & Security)", gold(pg) == ["Users & Security"] and "Users" in title(pg), gold(pg))
    for t in ("Assets", "Hotels", "Staff Details", "On Shift", "Companies", "ELFIA Traffic", "Announcements", "Financial Advisory"):
        pg.goto(f"http://127.0.0.1:4177/portal?tab={urllib.parse.quote(t)}"); pg.wait_for_timeout(2200)
        check(f"the existing deep link ?tab={t} still opens it, gold in its group", gold(pg) == [LABEL.get(t, t)], gold(pg))
    # Profile and Cards from the name card
    for t in ("Profile", "Cards"):
        pg.get_by_role("button", name=re.compile("^Your account:")).click(); pg.wait_for_timeout(300)
        pg.locator("#rail-account-menu").get_by_role("button", name=t, exact=True).click(); pg.wait_for_timeout(1200)
        check(f"{t} opens from the name card", title(pg) == t, title(pg))
    # folding
    pg.goto("http://127.0.0.1:4177/portal?tab=Desk"); pg.wait_for_timeout(2400)
    ws = pg.locator(".erp-rail-group[data-group=Workspace] > button")
    check("the group of the open page cannot fold (Workspace on Desk)", ws.is_disabled())
    fin = pg.locator(".erp-rail-group[data-group=Finance] > button")
    check("a group fold button says it is a group and its state", fin.get_attribute("aria-label") == "Finance group" and fin.get_attribute("aria-expanded") == "true")
    fin.click(); pg.wait_for_timeout(300)
    check("a group folds", fin.get_attribute("aria-expanded") == "false" and pg.locator(".erp-rail-group[data-group=Finance] li").count() == 0)
    pg.reload(); pg.wait_for_timeout(2600)
    fin = pg.locator(".erp-rail-group[data-group=Finance] > button")
    check("...stays folded after a reload", fin.get_attribute("aria-expanded") == "false")
    pg.goto("http://127.0.0.1:4177/portal?tab=Accounting"); pg.wait_for_timeout(2400)
    check("...and opens by itself when one of its modules is the open page", pg.locator(".erp-rail-group[data-group=Finance] .erp-rail-item[aria-current=page]").count() == 1)
    pg.goto("http://127.0.0.1:4177/portal?tab=Desk"); pg.wait_for_timeout(2400)
    pg.locator(".erp-rail-group[data-group=Finance] > button").click(); pg.wait_for_timeout(300)
    check("...and opens again on a click", pg.locator(".erp-rail-group[data-group=Finance] li").count() == 3)
    # Desk's own actions
    pg.get_by_role("button", name="Open Tasks", exact=True).first.click(); pg.wait_for_timeout(1500)
    check("Desk's Open Tasks still opens Tasks", title(pg) == "Tasks" and gold(pg) == ["Tasks"], title(pg))
    # keyboard along the rail
    rail.get_by_role("button", name="Dashboard", exact=True).focus(); pg.keyboard.press("ArrowDown")
    check("the arrow keys walk the rail", pg.evaluate("document.activeElement?.innerText?.trim()") == "Desk")
    check("no page errors (CEO desktop)", not errs, errs)
    ctx.close()

    # ---------- collapsed: group icons and flyouts ----------
    ctx, pg, errs = open_(b, 4177, 1440, tab="Assets", collapsed=True)
    icons = pg.locator("aside.erp-rail button[data-group-icon]")
    check("collapsed: one icon per group, seven", icons.count() == 7, icons.count())
    on = pg.locator("aside.erp-rail button[data-holds-active]")
    check("collapsed: the group of the open page (Operations) wears the gold", on.count() == 1 and on.get_attribute("aria-label") == "Operations group"
          and "201, 162, 39" in pg.evaluate("getComputedStyle(document.querySelector('[data-holds-active]')).backgroundColor"))
    check("collapsed: every icon is named and says it opens a list", all(icons.nth(i).get_attribute("aria-label").endswith(" group") and icons.nth(i).get_attribute("aria-haspopup") == "true" for i in range(7)))
    pg.get_by_role("button", name="People group").click(); pg.wait_for_timeout(300)
    fly = pg.get_by_test_id("rail-flyout")
    check("a click opens the People flyout with every People module named", fly.count() == 1 and [t.strip() for t in fly.locator("button").all_inner_texts()] == ["HR", "Staff", "Attendance", "On Shift", "Leave", "Claims", "Payroll"],
          fly.locator("button").all_inner_texts() if fly.count() else "none")
    check("...and the icon says it is open", pg.get_by_role("button", name="People group").get_attribute("aria-expanded") == "true")
    fly.get_by_role("button", name="Leave", exact=True).click(); pg.wait_for_timeout(1300)
    check("a choice opens the module and closes the flyout", title(pg) == "Leave" and pg.get_by_test_id("rail-flyout").count() == 0
          and pg.locator("[data-holds-active]").get_attribute("aria-label") == "People group")
    pg.get_by_role("button", name="Operations group").click(); pg.wait_for_timeout(300)
    check("Operations' flyout has the Projects shortcut", pg.get_by_test_id("rail-flyout").get_by_role("button", name="Projects").count() == 1)
    pg.mouse.click(900, 500); pg.wait_for_timeout(300)
    check("a click outside closes it", pg.get_by_test_id("rail-flyout").count() == 0)
    btn = pg.get_by_role("button", name="Finance group"); btn.focus(); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    check("the keyboard opens it and focus lands on its first module", pg.evaluate("document.activeElement?.innerText?.trim()") == "Finance")
    pg.keyboard.press("ArrowDown")
    check("arrow keys move inside it", pg.evaluate("document.activeElement?.innerText?.trim()") == "Accounting")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    check("Escape closes it and returns to the group icon", pg.get_by_test_id("rail-flyout").count() == 0 and pg.evaluate("document.activeElement?.getAttribute('aria-label')") == "Finance group")
    check("the name card is still there (account and Sign out never hidden)", pg.get_by_role("button", name=re.compile("^Your account:")).count() == 1)
    pg.get_by_role("button", name="Expand navigation").click(); pg.wait_for_timeout(400)
    check("the rail opens again from the same control, Leave still gold", gold(pg) == ["Leave"])
    check("no page errors (collapsed)", not errs, errs)
    ctx.close()

    # ---------- every width: no sideways page, no clipped label ----------
    for w in (1440, 1280, 1024, 768, 430, 390, 360, 320):
        ctx, pg, errs = open_(b, 4177, w, 800 if w < 500 else 900, tab="Desk")
        check(f"{w}: no sideways page", sideways(pg))
        if w >= 1024: check(f"{w}: no clipped rail label", not pg.evaluate(CLIP_JS), pg.evaluate(CLIP_JS))
        check(f"{w}: no page errors", not errs, errs)
        ctx.close()

    # ---------- phone ----------
    for w in (390, 320):
        ctx, pg, errs = open_(b, 4177, w, 800, tab="Desk")
        bar = [t.strip() for t in pg.locator("nav.erp-bottom-nav button, .erp-bottom-nav button").all_inner_texts() if t.strip()]
        check(f"phone {w}: the bar is still Dashboard, Desk, On Shift, Tasks, More", bar[:5] == ["Dashboard", "Desk", "On Shift", "Tasks", "More"], bar)
        pg.get_by_role("button", name="More").last.click(); pg.wait_for_timeout(700)
        sheet = pg.locator("#portal-more-menu")
        heads = [t.strip().upper() for t in sheet.locator("section > p").all_inner_texts()]
        check(f"phone {w}: More lists the same groups, then Account", heads == ["WORKSPACE", "REVENUE", "OPERATIONS", "PEOPLE", "FINANCE", "ELFIA", "SYSTEM", "ACCOUNT"], heads)
        tiles = sheet.locator("section").all_inner_texts()
        txt = " | ".join(tiles)
        check(f"phone {w}: the bar's four are not repeated in More", not any(re.search(rf"(^|\n){x}(\n|$)", t) for t in tiles for x in ("Dashboard", "Desk", "On Shift", "Tasks")), txt[:300])
        check(f"phone {w}: Projects sits in Operations", sheet.get_by_test_id("more-projects").count() == 1)
        check(f"phone {w}: Sign out is in the sheet", sheet.get_by_role("button", name="Sign out").count() == 1)
        check(f"phone {w}: no sideways page in the sheet", sideways(pg))
        sheet.get_by_role("button", name="Assets", exact=True).click(); pg.wait_for_timeout(1300)
        more_btn = pg.get_by_role("button", name="More").last
        check(f"phone {w}: a module from More opens, and More is marked on the bar", title(pg) == "Assets" and pg.locator("#portal-more-menu").count() == 0
              and (more_btn.get_attribute("aria-current") is not None or "On" in (more_btn.get_attribute("class") or "") or pg.evaluate("(()=>{const b=[...document.querySelectorAll('button')].filter(x=>x.innerText.trim()==='More').pop(); return getComputedStyle(b).fontWeight})()") in ("600", "700")))
        pg.get_by_role("button", name="More").last.click(); pg.wait_for_timeout(600)
        pg.locator("#portal-more-menu").get_by_test_id("more-projects").click(); pg.wait_for_timeout(1500)
        check(f"phone {w}: Projects opens Tasks on its Projects view", title(pg) == "Tasks" and pg.get_by_role("tab", name="Projects", exact=True).first.get_attribute("aria-selected") == "true")
        check(f"phone {w}: no page errors", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nnav-1: {len(results) - len(failed)}/{len(results)} passed")
if failed: raise SystemExit(1)

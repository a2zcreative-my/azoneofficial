"""v1.279.0 - A2Z OS MINIMAL EXECUTIVE WORKSPACE, phase E1 (tokens and
shell) on screen. The CEO approved the photo and all eight decisions,
11-11-2026 ("Approve for all"; claude/MINIMAL-EXECUTIVE-WORKSPACE-BLUEPRINT.md).
The source half is tests/executive-workspace.mjs.

Here, in a browser:
  the rail (v1.287.0, the CEO's navigation directive): the A2Z OS wordmark;
  WORKSPACE, REVENUE, OPERATIONS, PEOPLE, FINANCE, ELFIA, SYSTEM with every
  module in its own group and no More; the name card;
  the current tab is a gold pill with navy ink at AA contrast;
  Projects opens Tasks on its Projects tab and Tasks is the current item;
  a salesperson's rail shows only what they may open, and no empty group;
  the header has search, the bell, Help and dark mode and nothing else;
  the name card's menu has Profile, Cards, the four settings with On / Off,
  and Sign out; a setting flips and the menu stays open; Escape closes it;
  Help opens a sheet and closes; the phone header has no avatar and the
  phone's More sheet still has every setting, Sign out and Help;
  the KPI tile's well is 52px and its figure 22px; no sideways page; no
  page errors.

Servers (servers.txt): 4177 ceo, 4182 sales_marketing.
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

RAIL_JS = """() => [...document.querySelectorAll('.erp-rail-nav .erp-rail-group')].map(g => [g.dataset.group,
  [...g.querySelectorAll(':scope > ul > li > button[data-nav-item]')].map(b => b.innerText.trim())])"""
CONTRAST_JS = """(sel) => { const e = document.querySelector(sel); const cs = getComputedStyle(e);
  const rgb = s => s.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }"""

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- the CEO's rail ----------
    ctx, pg, errs = page(b, 4177, 1440, 900)
    rail = pg.evaluate(RAIL_JS)
    # v1.287.0 - the CEO's navigation directive (12-11-2026): seven groups, every module in its own, no More
    want = [["Workspace", ["Dashboard", "Desk", "News"]], ["Revenue", ["Sales", "Ecommerce", "Agents", "Financial Advisory"]],
            ["Operations", ["Projects", "Tasks", "Inventory", "Assets", "Hotels"]],
            ["People", ["HR", "Staff", "Attendance", "On Shift", "Leave", "Claims", "Payroll"]], ["Finance", ["Finance", "Accounting", "Commission"]],
            ["ELFIA", ["ELFIA Store", "ELFIA Traffic"]], ["System", ["Companies", "Users & Security", "Automation & Rules"]]]  # v1.293.0 (D4)
    check("the CEO's rail is the seven groups with every module in its own place, and no More", rail == want, rail)
    check("the wordmark reads A2Z OS", "A2Z OS" in pg.locator(".erp-rail-brand").inner_text())
    check("the Workspace group has a visible heading", pg.locator(".erp-rail-group[data-group=Workspace] > button").inner_text().strip().upper() == "WORKSPACE")
    act = pg.locator(".erp-rail-item[aria-current=page]")
    check("the current tab is Dashboard, a gold pill", act.inner_text().strip() == "Dashboard" and "201, 162, 39" in pg.evaluate("getComputedStyle(document.querySelector('.erp-rail-item[aria-current=page]')).backgroundColor"))
    ratio = pg.evaluate(CONTRAST_JS, ".erp-rail-item[aria-current=page]")
    check("...with navy ink at AA contrast (decision 5), never white on gold", ratio >= 4.5, round(ratio, 2))
    check("there is no More on the desktop rail", pg.locator("aside.erp-rail").get_by_role("button", name="More").count() == 0)
    pg.locator(".erp-rail").get_by_role("button", name="Users & Security", exact=True).click(); pg.wait_for_timeout(1500)
    check("a System module opens as the current item, its group open", pg.locator(".erp-rail-group[data-group=System] .erp-rail-item[aria-current=page]").inner_text().strip() == "Users & Security")
    pg.locator(".erp-rail").get_by_role("button", name="Projects", exact=True).click(); pg.wait_for_timeout(1800)
    check("Projects opens Tasks on its Projects tab", pg.locator("h1.erp-topbar-title").first.inner_text().strip() == "Tasks"
          and pg.get_by_role("tab", name="Projects", exact=True).first.get_attribute("aria-selected") == "true")
    check("...and Tasks is the current rail item (Projects is a way in, not a tab)", pg.locator(".erp-rail-item[aria-current=page]").inner_text().strip() == "Tasks"
          and pg.locator(".erp-rail").get_by_role("button", name="Projects", exact=True).get_attribute("aria-current") is None)
    # ---------- the header ----------
    tools = pg.evaluate("() => [...document.querySelectorAll('header.erp-topbar button')].filter(b => b.offsetParent).map(b => b.getAttribute('aria-label'))")
    check("the header carries search, the bell, Help and dark mode - nothing else", tools[:1] == ["Search the portal"] and tools[1].startswith("Notifications") and tools[2:] == ["Help", "Toggle dark mode"], tools)
    check("no avatar in the header", pg.locator("header.erp-topbar img").count() == 0)
    title = pg.evaluate("getComputedStyle(document.querySelector('h1.erp-topbar-title')).fontSize")
    check("the page title is 27px", title == "27px", title)
    pg.get_by_role("button", name="Help", exact=True).first.click(); pg.wait_for_timeout(600)
    dlg = pg.get_by_role("dialog").last
    check("Help opens a sheet that says how to get around and where the settings went", dlg.count() == 1 and "Getting around" in dlg.inner_text() and "Your name at the foot of the sidebar" in dlg.inner_text())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(1200)
    check("...and closes", pg.get_by_role("dialog").filter(has_text="Getting around").count() == 0)
    # ---------- the name card ----------
    card = pg.get_by_role("button", name="Your account: Fixture Person")
    check("the name card shows the person and their role", "Fixture Person" in card.inner_text() and "ceo" in card.inner_text().lower())
    card.click(); pg.wait_for_timeout(300)
    menu = pg.locator("#rail-account-menu")
    names = ["Cards", "Profile", "Notification sound", "Bahasa Melayu", "Plum & Rose colours", "Sign out"]
    labels = menu.locator("button").all_inner_texts()
    check("the menu has Profile, Cards, the four settings and Sign out (last)", all(menu.get_by_role("button", name=n).count() == 1 for n in names) and "Sign out" in labels[-1], labels)
    snd = menu.get_by_role("button", name="Notification sound")
    before = snd.get_attribute("aria-pressed")
    snd.click(); pg.wait_for_timeout(300)
    check("a setting flips, says so, and the menu stays open", menu.count() == 1 and snd.get_attribute("aria-pressed") != before and ("On" in snd.inner_text() or "Off" in snd.inner_text()))
    snd.click(); pg.wait_for_timeout(200)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("Escape closes the menu and gives focus back to the card", pg.locator("#rail-account-menu").count() == 0 and pg.evaluate("document.activeElement?.getAttribute('aria-label')") == "Your account: Fixture Person")
    # ---------- the KPI tile ----------
    # v1.292.0 (Sales Workspace 4.0) - Sales' row of five is Reports -> Sales Performance
    pg.goto("http://127.0.0.1:4177/portal?tab=Sales&view=reports"); pg.wait_for_timeout(2600)
    well = pg.evaluate("() => { const w = document.querySelector('[class*=kpi-tile_well]'); return w ? w.getBoundingClientRect().width : 0; }")
    fig = pg.evaluate("() => Math.max(...[...document.querySelectorAll('[class*=kpi-tile_value]')].map(e => parseFloat(getComputedStyle(e).fontSize)))")
    # v1.281.0 - Sales is five across now (the photo's Sales Overview): a tile that narrow keeps its well beside the words at 44px
    check("the KPI tile's well is the photo's: 52px with room, 44px in a row of five, never the old 40px", 43.5 <= well <= 53, well)
    check("...and no figure is above 22px", 0 < fig <= 22.01, fig)
    check("no sideways page (desktop)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    check("no page errors (CEO desktop)", not errs, errs)
    ctx.close()

    # ---------- a salesperson's rail: only what they may open ----------
    ctx, pg, errs = page(b, 4182, 1440, 900)
    allowed = pg.evaluate("() => [...document.querySelectorAll('.erp-rail-nav button[data-nav-item]')].map(b => b.innerText.trim())")
    check("a salesperson's rail never offers a module they may not open (no Payroll, Accounting, Users, Companies)", not ({"Payroll", "Accounting", "Users & Security", "Companies"} & set(allowed)), allowed)
    groups = pg.evaluate("() => [...document.querySelectorAll('.erp-rail-nav .erp-rail-group')].map(g => g.dataset.group)")
    check("...and draws no group they have nothing in (no System)", "System" not in groups and "More" not in groups, groups)
    check("no page errors (salesperson)", not errs, errs)
    ctx.close()

    # ---------- phone ----------
    ctx, pg, errs = page(b, 4177, 390, 844)
    check("the phone header has no avatar", pg.locator("header.erp-topbar img, header.erp-topbar [class*=avatar]").count() == 0)
    pg.locator(".erp-bottom-nav").get_by_role("button", name="More").first.click(); pg.wait_for_timeout(600)
    sheet = pg.locator("#portal-more-menu")
    txt = sheet.inner_text()
    check("the phone's More sheet still has every setting, Sign out and Help", all(w in txt for w in ["Sound on" if "Sound on" in txt else "Muted", "English" if "English" in txt else "Bahasa", "Navy" if "Navy" in txt else "Plum", "Sign out", "Help"]), txt[-300:])
    sheet.get_by_role("button", name="Help").click(); pg.wait_for_timeout(700)
    check("...and Help opens from it", pg.get_by_role("dialog").filter(has_text="Getting around").count() == 1)
    check("no sideways page (phone)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    check("no page errors (phone)", not errs, errs)
    ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nshell-e1: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

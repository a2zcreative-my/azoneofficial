"""DESK CONSOLIDATION (v1.293.0) - in a browser (the CEO's directive,
12-11-2026, K1-K4 and D1-D6; claude/DESK-CONSOLIDATION-BLUEPRINT.md). The
source rules are held by tests/desk5.mjs; here, the screens:

  the two views, each from the address (?tab=Desk&view=...), at the eight
  widths, with no sideways page, no page error and no error card; tabs on a
  wide screen, one selector on a phone; Back and Forward between the views;
  the Overview's greeting line with Introduce a lead and Report a problem (D1),
  four figures for management and three for staff (D2), Priority Actions (at
  most five, overdue first), Alerts & Watchers by rule, My Tasks (at most
  three) and no Quick Actions; the Action Inbox's filters whose counts are the
  rows they show, search, the module filter, Completed (read only); a row's
  Open lands on the record's own module; System -> Automation & Rules for
  management only, read-only for the COO.

The fixture answers are invented (tests/browser/serve.mjs); no production
record is used. Servers (servers.txt): 4177 ceo · 4179 coo · 4182 sales_marketing
· 4180 live_host.
"""
from playwright.sync_api import sync_playwright
import re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def ctx_for(b, w, h=900):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)

def go(pg, port, q, wait=2800):
    pg.goto(f"http://127.0.0.1:{port}/portal?{q}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")

def vis(pg, tid):
    return pg.get_by_test_id(tid).filter(visible=True).count() > 0

def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None

def title(pg):
    t = pg.locator("h1.erp-topbar-title").first
    return t.inner_text().strip() if t.count() else ""

def error_card(pg):
    return "Something went wrong on this screen" in pg.locator("main").inner_text()

def pick(pg, phone, name):
    if phone:
        pg.get_by_test_id("view-switch").filter(visible=True).first.click(); pg.wait_for_timeout(250)
        pg.get_by_role("menuitemradio", name=re.compile("^" + re.escape(name))).first.click()
    else:
        pg.get_by_test_id("desk-tabs").get_by_role("tab", name=re.compile("^" + re.escape(name))).first.click()
    pg.wait_for_timeout(800)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ================= every width, both views =================
    for w in WIDTHS:
        phone = w < 768
        ctx = ctx_for(b, w); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        for key, name in [("overview", "Overview"), ("inbox", "Action Inbox")]:
            go(pg, 4177, f"tab=Desk&view={key}")
            tag = f"CEO {w} {key}"
            check(f"{tag}: the address keeps the view", view_of(pg) == key, pg.url)
            check(f"{tag}: no sideways page, no error card", no_hscroll(pg) and not error_card(pg))
            if phone:
                vs = pg.get_by_test_id("view-switch").filter(visible=True)
                check(f"{tag}: a phone has the one selector, naming the view; no tab row", vis(pg, "desk-view-bar") and not vis(pg, "desk-tabs") and vs.first.inner_text().strip().startswith(name))
            else:
                sel = pg.get_by_test_id("desk-tabs").get_by_role("tab", selected=True)
                check(f"{tag}: two tabs, this one selected; no selector", pg.get_by_test_id("desk-tabs").get_by_role("tab").count() == 2 and sel.count() == 1
                      and sel.inner_text().strip().startswith(name) and not vis(pg, "desk-view-bar"))
            if key == "overview":
                main = pg.locator("main").inner_text()
                check(f"{tag}: no Quick Actions card (K1)", "Quick actions" not in main)
                check(f"{tag}: Introduce a lead and Report a problem on the greeting line (D1)",
                      pg.get_by_test_id("desk-greet").get_by_role("button", name="Introduce a lead").is_visible() and pg.get_by_test_id("desk-greet").get_by_role("button", name="Report a problem").is_visible())
                figs = pg.get_by_test_id("desk-figures").locator("button")
                labels = [t.split("\n")[0].strip() for t in figs.all_inner_texts()]
                check(f"{tag}: four figures for management", labels == ["Pending My Decisions", "Overdue Actions", "Active Alerts", "My Open Tasks"], labels)
                if w >= 1024:
                    ys = {round(f.bounding_box()["y"]) for f in figs.all()}
                    check(f"{tag}: the four figures sit in one row", len(ys) == 1, ys)
                else:
                    xs = [round(f.bounding_box()["x"]) for f in figs.all()]
                    check(f"{tag}: the four figures are 2 + 2, never one alone", len(set(xs)) == 2 and xs.count(xs[0]) == 2, xs)
                pr = pg.get_by_test_id("priority-row")
                first = pr.first.inner_text() if pr.count() else ""
                check(f"{tag}: Priority Actions: at most five, overdue first", 0 < pr.count() <= 5 and "Overdue" in first, [pr.count(), first[:80]])
                check(f"{tag}: Alerts & Watchers by rule, with count and oldest", pg.get_by_test_id("alert-row").count() >= 1 and re.search(r"— \d+", pg.get_by_test_id("alert-summary").inner_text()) is not None and "oldest" in pg.get_by_test_id("alert-summary").inner_text())
                check(f"{tag}: My Tasks: at most three", 0 < pg.get_by_test_id("my-tasks").locator("li").count() <= 3)
                if phone:
                    small = pg.evaluate("""() => [...document.querySelectorAll('[data-testid=priority-actions] button, [data-testid=desk-greet] button, [data-testid=my-tasks] .headLink, [data-testid=desk-view-bar] button')]
                      .filter(e => e.offsetParent).filter(e => e.getBoundingClientRect().height < 44).map(e => e.innerText.trim().slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().height))""")
                    check(f"{tag}: the Overview's buttons are 44 px touch targets", not small, small)
            else:
                rows = pg.get_by_test_id("inbox-row")
                check(f"{tag}: the inbox lists the rows", rows.count() >= 5, rows.count())
                if phone:
                    small = pg.evaluate("""() => [...document.querySelectorAll('[data-testid=action-inbox] button, [data-testid=action-inbox] select, [data-testid=action-inbox] input')]
                      .filter(e => e.offsetParent).filter(e => e.getBoundingClientRect().height < 44).map(e => (e.innerText || e.tagName).trim().slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().height))""")
                    check(f"{tag}: the inbox's controls are 44 px touch targets", not small, small)
        check(f"CEO {w}: no page errors", not errs, errs[:3])
        ctx.close()

    # ================= Back and Forward =================
    for w in [1440, 390]:
        phone = w < 768
        ctx = ctx_for(b, w); pg = ctx.new_page()
        go(pg, 4177, "tab=Desk")
        check(f"Back {w}: the Desk opens on the Overview, said in the address", view_of(pg) == "overview", pg.url)
        pick(pg, phone, "Action Inbox")
        check(f"Back {w}: a new view is a new address", view_of(pg) == "inbox" and vis(pg, "action-inbox"), pg.url)
        pg.go_back(); pg.wait_for_timeout(900)
        check(f"Back {w}: Back returns to the Overview", view_of(pg) == "overview" and vis(pg, "desk-figures"), pg.url)
        pg.go_forward(); pg.wait_for_timeout(900)
        check(f"Back {w}: Forward goes to the inbox again", view_of(pg) == "inbox" and vis(pg, "action-inbox"), pg.url)
        ctx.close()

    # ================= the inbox: counts, filters, search, Completed =================
    ctx = ctx_for(b, 1440); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, 4177, "tab=Desk&view=inbox")
    for k in ["all", "decide", "respond", "alerts"]:
        btn = pg.get_by_test_id(f"inbox-{k}")
        btn.click(); pg.wait_for_timeout(300)
        n = re.search(r"(\d+)\s*$", btn.inner_text().strip())
        rows = pg.get_by_test_id("inbox-row").count()
        check(f"Inbox: the {k} count is the rows it shows", n is not None and int(n.group(1)) == rows, [btn.inner_text(), rows])
    pg.get_by_test_id("inbox-decide").click(); pg.wait_for_timeout(300)
    kinds = set(pg.get_by_test_id("inbox-row").evaluate_all("els => els.map(e => e.dataset.kind)"))
    check("Inbox: Awaiting My Decision shows decisions only", kinds == {"decide"}, kinds)
    pg.get_by_test_id("inbox-all").click(); pg.wait_for_timeout(300)
    pg.get_by_role("searchbox", name="Search the inbox").fill("annual leave"); pg.wait_for_timeout(300)
    rows = pg.get_by_test_id("inbox-row")
    check("Inbox: search narrows to the matching request", rows.count() == 1 and "annual leave" in rows.first.inner_text(), rows.count())
    pg.get_by_role("searchbox", name="Search the inbox").fill(""); pg.wait_for_timeout(200)
    pg.get_by_test_id("inbox-module").select_option("Inventory"); pg.wait_for_timeout(300)
    mods = set(r.split("\n")[2].strip() if len(r.split("\n")) > 2 else "?" for r in pg.get_by_test_id("inbox-row").all_inner_texts())
    check("Inbox: the module filter keeps one module", pg.get_by_test_id("inbox-row").count() >= 1 and all("Inventory" in t for t in pg.get_by_test_id("inbox-row").locator("[role=cell]:nth-child(2)").all_inner_texts()), mods)
    pg.get_by_test_id("inbox-module").select_option(""); pg.wait_for_timeout(200)
    check("Inbox: every row has one Open button and no approve or reject control",
          pg.get_by_test_id("inbox-row").locator("button").count() == pg.get_by_test_id("inbox-row").count()
          and pg.get_by_test_id("action-inbox").get_by_role("button", name=re.compile("^(Approve|Reject|Decline)")).count() == 0)
    pg.get_by_test_id("inbox-done").click(); pg.wait_for_timeout(1500)
    done = pg.get_by_test_id("done-row")
    check("Completed: your own decisions, read only", done.count() == 3 and "Approved" in done.first.inner_text() and pg.get_by_test_id("action-inbox").get_by_role("button", name=re.compile("^(Approve|Reject|Undo)")).count() == 0, done.all_inner_texts()[:2])
    check("no page errors (inbox)", not errs, errs[:3])
    ctx.close()

    # ================= a row opens the record's own module =================
    for label, wanted in [("annual leave", "Leave"), ("RM 1,240.00", "Claims"), ("overtime", "Attendance")]:
        ctx = ctx_for(b, 1440); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, 4177, "tab=Desk&view=inbox")
        pg.get_by_test_id("inbox-row").filter(has_text=label).first.get_by_role("button", name="Open").click(); pg.wait_for_timeout(2200)
        check(f"Open ({label}) lands in {wanted}", title(pg) == wanted and not error_card(pg) and not errs, [title(pg), errs[:2]])
        ctx.close()
    ctx = ctx_for(b, 1440); pg = ctx.new_page()
    go(pg, 4177, "tab=Desk&view=alerts")
    check("a link to the Alerts filter opens the inbox at Alerts", view_of(pg) in ("inbox", "alerts") and pg.get_by_test_id("action-inbox").get_attribute("data-filter") == "alerts")
    pg.get_by_test_id("inbox-row").first.get_by_role("button", name="Open").click(); pg.wait_for_timeout(2200)
    check("an alert's Open lands where it is fixed (Inventory)", title(pg) == "Inventory" and not error_card(pg), title(pg))
    ctx.close()

    # ================= D1 links work =================
    ctx = ctx_for(b, 1440); pg = ctx.new_page()
    go(pg, 4177, "tab=Desk")
    pg.get_by_test_id("desk-greet").get_by_role("button", name="Report a problem").click(); pg.wait_for_timeout(700)
    check("Report a problem opens its form", pg.get_by_role("dialog").count() >= 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    pg.get_by_test_id("desk-greet").get_by_role("button", name="Introduce a lead").click(); pg.wait_for_timeout(700)
    check("Introduce a lead opens its form", pg.get_by_role("dialog").count() >= 1)
    ctx.close()

    # ================= staff: three figures, no alerts =================
    for w in [1440, 390]:
        ctx = ctx_for(b, w); pg = ctx.new_page()
        go(pg, 4182, "tab=Desk")
        figs = pg.get_by_test_id("desk-figures").locator("button")
        labels = [t.split("\n")[0].strip() for t in figs.all_inner_texts()]
        check(f"Sales {w}: three figures, no Active Alerts (D2)", labels == ["Pending My Decisions", "Overdue Actions", "My Open Tasks"], labels)
        check(f"Sales {w}: no Alerts card", pg.get_by_test_id("alert-summary").count() == 0)
        if w >= 768:
            ys = {round(f.bounding_box()["y"]) for f in figs.all()}
            check(f"Sales {w}: the three figures in one row", len(ys) == 1, ys)
        else:
            xs = {round(f.bounding_box()["x"]) for f in figs.all()}
            check(f"Sales {w}: the three figures one column, never 2 + 1", len(xs) == 1, xs)
        go(pg, 4182, "tab=Desk&view=inbox")
        check(f"Sales {w}: no Alerts filter in the inbox", pg.get_by_test_id("inbox-alerts").count() == 0 and pg.get_by_test_id("inbox-done").count() == 1)
        ctx.close()

    # ================= System -> Automation & Rules =================
    ctx = ctx_for(b, 1440); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, 4177, "tab=Desk")
    nav = pg.locator(".erp-rail-group[data-group=system]")
    check("CEO: Automation & Rules is in the System group", "Automation & Rules" in (nav.inner_text() if nav.count() else pg.locator("nav").first.inner_text()))
    go(pg, 4177, "tab=Automation%20%26%20Rules")
    card = pg.get_by_test_id("automation-rules")
    check("CEO: the rules page shows the watcher rules", title(pg) == "Automation & Rules" and card.count() == 1 and "Stock below the line" in card.inner_text(), title(pg))
    check("CEO: the rules can be changed here (switches or thresholds)", card.locator("input, [role=switch], button").count() >= 3)
    check("no page errors (rules)", not errs and no_hscroll(pg), errs[:2])
    ctx.close()
    ctx = ctx_for(b, 1440); pg = ctx.new_page()
    go(pg, 4179, "tab=Automation%20%26%20Rules")
    card = pg.get_by_test_id("automation-rules")
    check("COO: reads the rules, cannot change them", card.count() == 1 and card.locator("input:not([disabled]), [role=switch]:not([disabled])").count() == 0, card.inner_text()[:200] if card.count() else "none")
    ctx.close()
    for port, who in [(4182, "Sales"), (4180, "Live host")]:
        ctx = ctx_for(b, 1440); pg = ctx.new_page()
        go(pg, port, "tab=Automation%20%26%20Rules")
        check(f"{who}: Automation & Rules is not drawn and not in the menu", pg.get_by_test_id("automation-rules").count() == 0 and "Automation & Rules" not in pg.locator("aside, nav").first.inner_text(), title(pg))
        ctx.close()
    b.close()

failed = [n for n, c in res if not c]
print(f"\ndesk5: {len(res) - len(failed)}/{len(res)} passed")
raise SystemExit(1 if failed else 0)

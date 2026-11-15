"""COMMISSION WORKSPACE 5.0 (v1.311.0) - in a browser (the CEO's "approve as
per recommend", 15-11-2026; claude/COMMISSION-WORKSPACE-5.0-BLUEPRINT.md).
The rules are proven by direct request in tests/commission5.mjs; here, the
six views as the CEO, the COO and a salesperson, their own addresses and
Back/Forward, the phone's view switch, no tab ever cut off, no sideways page
from 320 to 1440 px, and the Dashboard's four figures filling their row (the
CEO's screenshot of 15-11-2026). The fixture answers are invented
(tests/browser/fixture.mjs); no production figure is used.

Servers (servers.txt): 4177 ROLE=ceo, 4179 ROLE=coo, 4182 ROLE=sales_marketing.
"""
from playwright.sync_api import sync_playwright

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, COO, SALES = 4177, 4179, 4182
VIEWS = {"overview": "commission-overview", "transactions": "commission-transactions", "agents": "agents-table", "policy": "policy-structure", "payroll": "payroll-sync", "audit": "commission-audit"}
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def page(b, w, h=1000):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, pg, errs

def go(pg, port, view=None, wait=2800, tab="Commission"):
    pg.goto(f"http://127.0.0.1:{port}/portal?tab={tab}" + (f"&view={view}" if view else "")); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")

def vis(pg, tid):
    loc = pg.get_by_test_id(tid).filter(visible=True)
    return loc.count() > 0

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------- the CEO, desktop: the six views ----------
    ctx, pg, errs = page(b, 1440)
    go(pg, CEO)
    tabs = pg.locator("[role=tablist]").filter(visible=True).first
    names = [t.strip() for t in tabs.locator("[role=tab]").all_inner_texts()]
    check("the six tabs, in the directive's order", names == ["Overview", "Transactions", "Agent Deals", "Policy Settings", "Payroll Sync", "Audit History"], names)
    cut = pg.evaluate("""(() => { const l = [...document.querySelectorAll('[role=tablist]')].find(e => e.offsetParent); const r = l.getBoundingClientRect();
        return [...l.querySelectorAll('[role=tab]')].filter(t => { const b = t.getBoundingClientRect(); return b.right > r.right + 1 || b.left < r.left - 1; }).map(t => t.textContent) })()""")
    check("1440px: no tab is cut off (the filters sit on their own row)", not cut, cut)
    check("the toolbar: month, company and New Deal", vis(pg, "commission-toolbar") and vis(pg, "commission-month") and vis(pg, "commission-company") and pg.get_by_test_id("commission-toolbar").get_by_role("button", name="New Deal").count() == 1)
    check("Overview: the four figures, Commission by Role, Performance, Needs Attention", all(vis(pg, t) for t in ["commission-overview", "commission-by-role", "commission-performance", "commission-attention"]))
    att = pg.get_by_test_id("commission-attention").inner_text()
    check("Needs Attention names the CEO's verification", "CEO" in att and "verification" in att, att[:200])
    for v, tid in VIEWS.items():
        go(pg, CEO, v, wait=2200)
        check(f"?view={v} opens its own view", vis(pg, tid) and f"view={v}" in pg.url, pg.url)
    go(pg, CEO, "agents", wait=2200)
    check("Agent Deals: the rate in force, the agents with their salesperson, the hold card", vis(pg, "agent-rate-in-force") and "Nur Aisyah" in pg.get_by_test_id("agents-table").inner_text() and vis(pg, "agent-hold"))
    check("Agent Deals: one New Deal (in the toolbar), Add Agent beside the rate", pg.get_by_role("button", name="New Deal").filter(visible=True).count() == 1 and pg.get_by_role("button", name="Add Agent").filter(visible=True).count() == 1)
    hold = pg.get_by_test_id("agent-hold").inner_text()
    check("K-1 the switch is worded as a hold", "Hold new agent sales" in hold, hold[:160])
    go(pg, CEO, "policy", wait=2200)
    pol = pg.locator("main").inner_text()
    check("Policy: the structure in force, the CEO verifies, only the CEO approves", vis(pg, "policy-structure") and "Direct Sales (No Agent)" in pol and "verified by the CEO (the owner)" in pol and "The CEO only" in pol and "super admin" not in pol.lower(), pol[:200])
    go(pg, CEO, "payroll", wait=2200)
    emp = pg.get_by_test_id("payroll-employees").inner_text()
    check("Payroll Sync: employees only, never an agent", "Nur Aisyah" in emp and "Zul Agent" not in emp, emp[:200])
    check("Payroll Sync as the CEO: authorise is offered, settle is not", pg.get_by_role("button", name="Authorise payout").filter(visible=True).count() >= 1 and pg.get_by_role("button", name="Mark settled").filter(visible=True).count() == 0)
    go(pg, CEO, "audit", wait=2200)
    au = pg.get_by_test_id("commission-audit").inner_text()
    check("Audit History: date, action, details and who (with the role)", "(CEO)" in au and "(COO)" in au and "Policy approved" in au, au[:200])
    # tabs change the address; Back and Forward walk it
    go(pg, CEO, "overview", wait=2200)
    pg.locator("[role=tablist]").filter(visible=True).first.get_by_role("tab", name="Transactions").click(); pg.wait_for_timeout(900)
    pg.locator("[role=tablist]").filter(visible=True).first.get_by_role("tab", name="Payroll Sync").click(); pg.wait_for_timeout(900)
    u2 = pg.url
    pg.go_back(); pg.wait_for_timeout(900); u1 = pg.url
    pg.go_forward(); pg.wait_for_timeout(900)
    check("each tab has its address; Back and Forward walk the views", "view=payroll" in u2 and "view=transactions" in u1 and "view=payroll" in pg.url and vis(pg, "payroll-sync"), [u1, u2, pg.url])
    check("no page errors (CEO)", not errs, errs)
    ctx.close()

    # ---------- the COO: Finance settles, never authorises ----------
    ctx, pg, errs = page(b, 1280)
    go(pg, COO, "payroll")
    check("COO Payroll Sync: may sync, settles, never authorises", vis(pg, "sync-to-payroll") and pg.get_by_role("button", name="Authorise payout").filter(visible=True).count() == 0, pg.locator("main").inner_text()[:200])
    check("no page errors (COO)", not errs, errs)
    ctx.close()

    # ---------- a salesperson: My commission only ----------
    ctx, pg, errs = page(b, 1280)
    go(pg, SALES)
    body = pg.locator("main").inner_text()
    tl = pg.locator("[role=tablist]").filter(visible=True)
    names = [t.strip() for t in tl.first.locator("[role=tab]").all_inner_texts()] if tl.count() else []
    check("a salesperson: one view, My commission", names == ["My commission"], names)
    check("a salesperson sees her own figures and never the agent, the attention list or another view", vis(pg, "commission-transactions") and not vis(pg, "commission-attention") and not vis(pg, "agents-table") and "Zul Agent" not in body, body[:200])
    go(pg, SALES, "payroll")
    check("a salesperson asking for Payroll Sync gets her own view, never a blank page", vis(pg, "commission-transactions") and not vis(pg, "payroll-sync"))
    check("no page errors (salesperson)", not errs, errs)
    ctx.close()

    # ---------- the phone: the view switch ----------
    ctx, pg, errs = page(b, 390, 844)
    go(pg, CEO)
    check("390px: the view switch and New Deal replace the tab row", vis(pg, "commission-view-bar") and vis(pg, "view-switch") and not vis(pg, "commission-toolbar"))
    check("390px: Recent Commission as cards", vis(pg, "commission-recent-cards"))
    pg.get_by_test_id("view-switch").filter(visible=True).first.click(); pg.wait_for_timeout(300)
    pg.get_by_role("menuitemradio", name="Payroll Sync").click(); pg.wait_for_timeout(1800)
    check("390px: the switch opens Payroll Sync at its address", vis(pg, "payroll-sync") and "view=payroll" in pg.url, pg.url)
    check("no page errors (phone)", not errs, errs)
    ctx.close()

    # ---------- every width: no sideways page ----------
    for w in WIDTHS:
        ctx, pg, errs = page(b, w, 900)
        bad = []
        for v in VIEWS:
            go(pg, CEO, v, wait=1700)
            if not no_hscroll(pg): bad.append(v)
        check(f"{w}px: no Commission view scrolls sideways", not bad, bad)
        check(f"no page errors ({w}px)", not errs, errs)
        ctx.close()

    # ---------- the Dashboard (the CEO's screenshot): four figures fill the row ----------
    for w in [1024, 1280, 1440]:
        ctx, pg, errs = page(b, w, 1000)
        go(pg, CEO, tab="Dashboard", wait=3200)
        g = pg.evaluate("""(() => { const k = document.querySelector('[data-view=overview] [class*=kpis4] > div'); if (!k) return null;
            const tiles = [...k.children].map(c => c.getBoundingClientRect()); const r = k.getBoundingClientRect();
            const page = document.querySelector('[data-view=overview]').getBoundingClientRect();
            const s = document.querySelector('[data-view=overview] > [class*=span2]'), d = document.querySelector('[data-view=overview] > [class*=sideCol]');
            const sr = s && s.getBoundingClientRect(), dr = d && d.getBoundingClientRect();
            return { n: tiles.length, widths: tiles.map(t => Math.round(t.width)), tops: tiles.map(t => Math.round(t.top)), rowR: Math.round(r.right), lastR: Math.round(tiles[tiles.length-1].right), pageR: Math.round(page.right),
                     t2r: Math.round(tiles[1].right), sR: sr && Math.round(sr.right), dL: dr && Math.round(dr.left), t3l: Math.round(tiles[2].left), sH: sr && Math.round(sr.height), dH: dr && Math.round(dr.height) } })()""")
        ok = g and g["n"] == 4 and len(set(g["tops"])) == 1 and max(g["widths"]) - min(g["widths"]) <= 1 and abs(g["lastR"] - g["pageR"]) <= 1
        check(f"Dashboard {w}px: the four figures share one row, equal widths, filling it to the edge", ok, g)
        al = g and abs(g["sR"] - g["t2r"]) <= 1 and abs(g["dL"] - g["t3l"]) <= 1 and abs(g["sH"] - g["dH"]) <= 1
        check(f"Dashboard {w}px: Sales Performance under figures 1-2, Needs My Decision under 3-4, equal heights", al, g)
        check(f"Dashboard {w}px: no sideways page, no page errors", no_hscroll(pg) and not errs, errs)
        ctx.close()
    b.close()

passed = sum(1 for _, ok in res if ok)
print(f"commission5: {passed} of {len(res)} passed")
raise SystemExit(0 if passed == len(res) else 1)

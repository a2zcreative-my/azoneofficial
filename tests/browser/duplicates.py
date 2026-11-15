"""THE DUPLICATE-FUNCTION AUDIT, FIXED (v1.317.0) - in a browser
(claude/DUPLICATION-AUDIT-1.316.0.md; the CEO, 15-11-2026: "fix the issue as
per recommended"). The server's rules are proven by tests/duplicates.mjs; this
holds what a person sees:

  D-2  the Dashboard's company card (the HR Admin's My Day) opens no copy of
       another tab: Clients opens Sales; no Active stokis figure
  D-3  Sales > Packages: one list. The CEO sees what the public page shows and
       marks a package for it (a prompt says what goes public); the COO manages
       packages and has no public control; no second "rate card" editor
  D-4  Inventory: a row whose store price is not its list price says so, and
       opens ELFIA Store
  D-7  Accounting > General Ledger still draws its chart of accounts

The fixture's figures are invented (tests/browser/fixture.mjs).

Servers: 4177 ceo, 4179 coo, 4181 hr_admin
"""
from playwright.sync_api import sync_playwright
import json, re, urllib.request

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, COO, HR = 4177, 4179, 4181
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, port, path, w=1440, h=950, wait=3200):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?{path}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def posts(port):
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/__tasks").read())["posts"]

def open_packages(pg):
    dm = pg.get_by_test_id("docs-more").filter(visible=True).first
    dm.select_option("packages"); pg.wait_for_timeout(1300)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------- D-3: one package list ----------
    urllib.request.urlopen(f"http://127.0.0.1:{CEO}/__reset").read()
    for w in [1440, 390]:
        ctx, pg, errs = open_page(b, CEO, "tab=Sales&view=documents", w=w)
        open_packages(pg)
        main = pg.locator("main").inner_text()
        note = pg.get_by_test_id("public-page-note").filter(visible=True)
        check(f"D-3 {w}: the CEO is told what the public page shows (the earlier card, until a package is marked)", note.count() == 1 and "earlier rate card (3 tier(s))" in note.first.inner_text(), main[:300])
        check(f"D-3 {w}: no second editor - no 'Public rate card' form, no tier fields", re.search(r"Public rate card|Add tier|Price label \(e\.g", main) is None, main[:300])
        tog = pg.get_by_test_id("pkg-public-toggle").filter(visible=True)
        check(f"D-3 {w}: an active package offers 'Public page' to the CEO", tog.count() >= 1 and tog.first.inner_text().strip() == "Public page")
        tog.first.click(); pg.wait_for_timeout(500)
        dlg = pg.get_by_role("dialog").filter(visible=True)
        t = dlg.first.inner_text() if dlg.count() else ""
        check(f"D-3 {w}: before it goes public, the dialog says what anyone will read", "Anyone can read it there" in t and "item name(s)" in t and "RM 650.00" in t, t[:300])
        dlg.first.locator("input").first.fill("From RM 650 / month")
        dlg.first.get_by_role("button", name="Show on public page").click(); pg.wait_for_timeout(900)
        sent = [x for x in posts(CEO) if x["p"].endswith("/public")]
        body = sent[-1]["body"] if sent else {}
        if isinstance(body, str): body = json.loads(body or "{}")
        check(f"D-3 {w}: marking sends the package and its label to the one route", len(sent) >= 1 and sent[-1]["p"] == "/staff/packages/71/public" and body.get("on") is True and body.get("price_label") == "From RM 650 / month", sent[-1:])
        check(f"D-3 {w}: no sideways page", no_hscroll(pg))
        ctx.close()
        check(f"D-3 {w}: no page error", not errs, errs)

    ctx, pg, errs = open_page(b, COO, "tab=Sales&view=documents")
    open_packages(pg)
    check("D-3 the COO manages packages and is offered no public control", pg.get_by_role("button", name="Create package").count() >= 1 and pg.get_by_test_id("pkg-public-toggle").count() == 0 and pg.get_by_test_id("public-page-note").count() == 0)
    ctx.close()

    # ---------- D-4: the store's price on the Inventory row ----------
    for w in [1440, 390]:
        ctx, pg, errs = open_page(b, CEO, "tab=Inventory", w=w, wait=3800)
        tab = pg.get_by_role("tab", name="Stock Inventory", exact=True).filter(visible=True)
        if tab.count():
            tab.first.click()
        else:
            sel = pg.locator("select").filter(has=pg.locator("option", has_text="Stock Inventory")).filter(visible=True)
            if sel.count(): sel.first.select_option(label="Stock Inventory")
        pg.wait_for_timeout(1800)
        ch = pg.get_by_test_id("elfia-charges").filter(visible=True)
        txt = ch.first.inner_text() if ch.count() else ""
        check(f"D-4 {w}: a row whose store price is not its list price says what the store charges", ch.count() >= 1 and "The store charges RM 18.00, not this list price." in txt, txt or pg.locator("main").inner_text()[:300])
        if ch.count():
            ch.first.scroll_into_view_if_needed()
            ch.first.get_by_role("button", name=re.compile("ELFIA Store")).click(); pg.wait_for_timeout(1500)
            head = pg.locator("h1").filter(visible=True).first.inner_text() if pg.locator("h1").filter(visible=True).count() else ""
            check(f"D-4 {w}: …and opens ELFIA Store", "ELFIA" in (pg.url.upper() + head.upper()), [pg.url, head])
        check(f"D-4 {w}: no sideways page", no_hscroll(pg))
        ctx.close()
        check(f"D-4 {w}: no page error", not errs, errs)

    # ---------- D-2: the company card opens home tabs, draws no copy ----------
    ctx, pg, errs = open_page(b, HR, "tab=Dashboard", wait=4200)
    day = pg.get_by_role("tab", name="My Day")
    if day.count(): day.first.click(); pg.wait_for_timeout(1500)
    more = pg.get_by_text(re.compile(r"More figures"))
    if more.count(): more.first.click(); pg.wait_for_timeout(500)
    tiles = pg.get_by_test_id("pulse-home-tile")
    labels = [x.strip().replace("\n", " ") for x in tiles.all_inner_texts()]
    check("D-2 the company card's linked figures are there (Clients, Lives today)", any("clients" in x.lower() for x in labels) and any("lives today" in x.lower() for x in labels), labels)
    check("D-2 no Active stokis figure (Stokis is parked)", "active stokis" not in pg.locator("main").inner_text().lower())
    homes = pg.evaluate("[...document.querySelectorAll('[data-testid=pulse-home-tile]')].map(e => [e.tagName, e.dataset.home || '', e.innerText.replace(/\\n/g,' ')])")
    check("D-2 each linked figure is a button to its home tab, or a plain figure when that tab is not this person's", all((t == "BUTTON" and h) or (t == "DIV" and not h) for t, h, _ in homes) and any(h == "Sales" for _, h, _ in homes), homes)
    cl = tiles.filter(has_text=re.compile("clients", re.I)).first
    cl.click(); pg.wait_for_timeout(1800)
    check("D-2 pressing Clients opens Sales - no pop-up copy of the client list", ("tab=Sales" in pg.url or "/sales" in pg.url) and pg.get_by_role("dialog").filter(visible=True).count() == 0, pg.url)
    ctx.close()
    check("D-2 no page error", not errs, errs)

    # ---------- D-7: the chart of accounts still draws ----------
    ctx, pg, errs = open_page(b, CEO, "tab=Accounting&view=ledger")
    chart = pg.get_by_role("table", name="Chart of accounts")
    check("D-7 General Ledger draws its chart of accounts from the one trial balance", chart.count() == 1 and chart.locator("tbody tr").count() >= 3, chart.count())
    ctx.close()
    check("D-7 no page error", not errs, errs)
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

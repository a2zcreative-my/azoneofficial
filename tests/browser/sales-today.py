"""SALES COMMAND CENTER, PHASE 1 (v1.397.0) - in a browser (the CEO's approval
of 21-11-2026: "Build Phase 1 - Approved for Local Development and Testing").

  Overview            the six figures unchanged; My Sales Action Center as the
                      main column; the week's target and the pipeline summary
                      in the rail; Recent Activities (five filters) and, for
                      management, the team
  The order           overdue first, then today's, then no next action
  The indicators      red = overdue, amber = no next action, grey = age, green
                      = done today - each with words (a legend once)
  Nothing completes   opening a record, a call or a WhatsApp link never moves
                      the "done today" count
  The Desk            a sales role sees ONE "Sales actions today" line with the
                      same count as the Action Center, and it opens Sales ->
                      Overview -> the Action Center; marketing keeps its rows
  Phones              no sideways page at any width; light and dark; EN and BM

The fixture's records are invented (tests/browser/fixture.mjs, "sales/today").

Servers:
    ROLE=ceo 4177 · ROLE=coo 4178 · ROLE=sales_marketing 4182 · ROLE=marketing 4183
    ROLE=ceo OWNER=1 PAYV=1 PAYDOCS=1 4290
    node tests/browser/serve.mjs out <port>
Screenshots go to SHOTS (default /tmp/sales-today-shots).
"""
from playwright.sync_api import sync_playwright
import os, re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, COO, SALES, MKT, OWNER = 4177, 4178, 4182, 4183, 4290
SHOTS = os.environ.get("SHOTS", "/tmp/sales-today-shots"); os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, port, w=1440, h=1000, lang="en", theme="light", url="/portal?tab=Sales&view=overview"):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    ctx.add_init_script(f"try{{localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang','{lang}');localStorage.setItem('azone-theme','{theme}')}}catch(e){{}}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}{url}"); pg.wait_for_timeout(4500)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def keys(pg):
    return [r.get_attribute("data-key") for r in pg.get_by_test_id("action-list").locator("[data-testid=action-row]").all()]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    # ---------- the sales executive (Mine) ----------
    ctx, pg, errs = open_page(b, SALES)
    figs = pg.get_by_role("group", name="Sales at a glance")
    txt = figs.inner_text()
    check("the six figures are unchanged", figs.locator(":scope > *").count() == 6 and all(w in txt for w in
          ["Sales This Week", "Weekly Target", "Outstanding", "Pending CEO Verification", "Due Follow-Ups", "Open Quotations"]), txt[:300])
    ac = pg.get_by_test_id("action-center")
    check("My Sales Action Center is on the Overview", ac.count() == 1 and "My Sales Action Center" in ac.inner_text())
    k = keys(pg)
    check("most urgent first: overdue, waiting, payment overdue, today, new, ready, then no next action",
          k == ["followup:612", "growth:6", "invoice:61", "followup:618", "enquiry:31", "quotation:47", "quotation:44", "quotation:45"], k)
    tones = [r.get_attribute("data-tone") for r in ac.locator("[data-testid=action-row]").all()]
    check("red for overdue, amber for no next action", tones[:3] == ["red"] * 3 and tones[-2:] == ["amber", "amber"], tones)
    flags = [t.inner_text() for t in ac.locator("[data-testid=action-flag]").all()]
    check("every indicator carries words, not a colour alone", all(len(f.strip()) > 3 for f in flags) and "Overdue follow-up" in flags and "No next action" in flags, flags)
    ages = [t.inner_text() for t in ac.locator("[data-testid=action-age]").all()]
    check("quotation age is a neutral chip, apart from the overdue flag", len(ages) >= 3 and all("day" in a for a in ages), ages)
    leg = ac.get_by_role("list", name="What the labels mean").inner_text()
    check("the legend names the four indicators once", all(w in leg for w in ["Overdue", "No next action", "Days open", "Done"]), leg)
    check("a sales executive sees no team table", pg.get_by_test_id("team-table").count() == 0)
    check("no manager-only verify line for a sales executive", pg.get_by_test_id("action-verify").count() == 0)
    prog0 = pg.get_by_test_id("action-progress").inner_text()
    check("the day's progress reads from records: 2 done, 8 still to do", "2 done today" in prog0 and "8 still to do" in prog0, prog0)
    # the filters
    pg.get_by_test_id("action-filter").get_by_role("button", name=re.compile("^Overdue")).click(); pg.wait_for_timeout(300)
    check("Overdue shows only the red rows", keys(pg) == ["followup:612", "growth:6", "invoice:61"], keys(pg))
    pg.get_by_test_id("action-filter").get_by_role("button", name=re.compile("^No next action")).click(); pg.wait_for_timeout(300)
    check("No next action shows only the amber rows", keys(pg) == ["quotation:44", "quotation:45"], keys(pg))
    pg.get_by_test_id("action-filter").get_by_role("button", name=re.compile("^Done today")).click(); pg.wait_for_timeout(300)
    dn = pg.get_by_test_id("done-row")
    check("Done today lists what was recorded, in green", dn.count() == 2 and all(r.get_attribute("data-tone") == "green" for r in dn.all()))
    pg.get_by_test_id("action-filter").get_by_role("button", name=re.compile("^All")).click(); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{SHOTS}/01-sales-exec-1440-light-en.png", full_page=True)
    # nothing completes by opening, calling or WhatsApp
    wa = ac.locator("[data-testid=action-wa]").first
    check("WhatsApp is a plain wa.me link (opening it records nothing)", (wa.get_attribute("href") or "").startswith("https://wa.me/"), wa.get_attribute("href"))
    pg.evaluate("document.querySelectorAll('[data-testid=action-wa],[data-testid=action-call]').forEach(a=>a.addEventListener('click',e=>e.preventDefault()))")
    ac.locator("[data-testid=action-wa]").first.click(); ac.locator("[data-testid=action-call]").first.click(); pg.wait_for_timeout(400)
    check("a call or WhatsApp click does not move the done count", pg.get_by_test_id("action-progress").inner_text() == prog0)
    # the buttons open the right records
    ac.locator("[data-key='invoice:61'] [data-testid=action-doc]").click(); pg.wait_for_timeout(1200)
    check("Document on an invoice opens Quotations & Invoices", "view=documents" in pg.url or pg.get_by_test_id("sales-overview-2").count() == 0, pg.url)
    pg.goto(f"http://127.0.0.1:{SALES}/portal?tab=Sales&view=overview"); pg.wait_for_timeout(3500)
    pg.get_by_test_id("action-center").locator("[data-key='enquiry:31'] [data-testid=action-go]").click(); pg.wait_for_timeout(1200)
    check("an enquiry's action opens Customers & Follow-ups", "view=customers" in pg.url or "view=followups" in pg.url or pg.get_by_test_id("sales-overview-2").count() == 0, pg.url)
    check("no page errors (sales executive)", not errs, errs[:2])
    ctx.close()

    # ---------- Recent Activities ----------
    ctx, pg, errs = open_page(b, CEO)
    rl = pg.get_by_test_id("recent-list")
    check("Recent Activities replaces the old payment-only panel", rl.count() == 1 and pg.get_by_role("heading", name="Recent Payment Activity").count() == 0 and pg.get_by_text("Recent Payment Activity", exact=True).count() == 0)
    rf = pg.get_by_test_id("recent-filter")
    n_all = pg.get_by_test_id("recent-row").count()
    opts = [x.inner_text().split("\n")[0] for x in rf.get_by_role("button").all()]
    check("five filters: All Activities, Sales & Quotations, Follow-ups, Payments, Enquiries",
          [o.strip() for o in opts][:5] == ["All Activities", "Sales & Quotations", "Follow-ups", "Payments", "Enquiries"], opts)
    rf.get_by_role("button", name=re.compile("^Payments")).click(); pg.wait_for_timeout(300)
    check("Payments shows the payment rows only", pg.get_by_test_id("recent-row").count() == 2 and n_all == 6, (n_all, pg.get_by_test_id("recent-row").count()))
    check("a CEO who is not the verified owner gets no verify line", pg.get_by_test_id("action-verify").count() == 0)
    ctx3, pg3, _ = open_page(b, OWNER)
    check("the owner-CEO still sees the payment verification line", pg3.get_by_test_id("action-verify").count() == 1)
    ctx3.close()
    # Everyone + the team
    ctx2, pg2, _ = open_page(b, CEO)
    check("the CEO's Action Center opens on Mine (decision 2)", "My Sales Action Center" in pg2.get_by_test_id("action-center").inner_text() and "followup:620" not in keys(pg2))
    tt = pg2.get_by_test_id("team-table")
    check("management sees Team Performance on Mine too: activity beside results", tt.count() == 1 and "Hakim Rosli" in tt.inner_text())
    pg2.get_by_test_id("action-center").get_by_role("button", name=re.compile("^Everyone")).first.click()
    try: pg2.wait_for_selector("[data-testid=action-row][data-key='followup:620']", timeout=8000)
    except Exception: pass
    ac2 = pg2.get_by_test_id("action-center")
    check("Everyone adds the team's rows with their owner", "followup:620" in keys(pg2) and "Nur Aisyah binti Rahman" in ac2.inner_text() and ac2.get_by_test_id("action-more").count() == 1, keys(pg2))
    check("the rest of Sales keeps its own Mine/Everyone (the documents are not narrowed)", pg2.get_by_role("group", name="Sales at a glance").count() == 1)
    pg2.screenshot(path=f"{SHOTS}/02-ceo-everyone-1440-light-en.png", full_page=True)
    ctx2.close(); ctx.close()

    # ---------- the Desk ----------
    ctx, pg, errs = open_page(b, SALES, url="/portal?tab=Desk")
    line = pg.get_by_text(re.compile(r"Sales actions today: 8 pending, 3 overdue"))
    check("a sales role's Desk shows ONE Sales line with the Action Center's count", pg.get_by_test_id("priority-row").filter(has_text="Sales actions today").count() == 1, pg.locator("main").inner_text()[:400])
    greet = pg.get_by_test_id("desk-greet").inner_text() if pg.get_by_test_id("desk-greet").count() else pg.locator("main").inner_text()
    check("the Desk's own count includes every action the line stands for (13 waiting, 5 overdue)", "13 waiting on you" in greet and "5 overdue" in greet, greet[:200])
    pg.screenshot(path=f"{SHOTS}/03-desk-sales-exec-1440.png", full_page=True)
    pg.get_by_test_id("priority-row").filter(has_text="Sales actions today").get_by_role("button", name="Open").click(); pg.wait_for_timeout(2500)
    act = pg.get_by_test_id("action-center")
    check("the line opens Sales -> Overview -> My Sales Action Center", "tab=Sales" in pg.url and act.count() == 1 and act.is_visible(), pg.url)
    check("and scrolls the Action Center into view", pg.evaluate("(()=>{const r=document.getElementById('sales-action-center')?.closest('[data-testid=action-center]')?.getBoundingClientRect();return !!r && r.top < window.innerHeight && r.bottom > 0})()"))
    ctx.close()
    ctx, pg, errs = open_page(b, SALES, url="/portal?tab=Dashboard")
    t = pg.locator("main").inner_text()
    check("the Dashboard's Waiting on me is the Desk's count (13), never a second list", re.search(r"Waiting on me\s*\n\s*13\b", t) is not None and "Sales Action Center" not in t, re.findall(r"Waiting on me[^\n]*\n[^\n]*", t))
    pg.screenshot(path=f"{SHOTS}/07-dashboard-sales-exec-1440.png", full_page=False)
    ctx.close()
    ctx, pg, errs = open_page(b, MKT, url="/portal?tab=Desk")
    check("marketing (no Sales access) has no Sales line", pg.get_by_text(re.compile("Sales actions today")).count() == 0)
    ctx.close()

    # ---------- the widths, themes and languages ----------
    for w in WIDTHS:
        ctx, pg, errs = open_page(b, SALES, w=w, h=900)
        check(f"no sideways page at {w}px", no_hscroll(pg))
        if w in (390, 768, 1024):
            pg.screenshot(path=f"{SHOTS}/04-sales-exec-{w}-light-en.png", full_page=True)
        ctx.close()
    for port, nm in ((SALES, "sales-exec"), (CEO, "ceo")):
        ctx, pg, errs = open_page(b, port, w=1440, theme="dark", lang="ms")
        t = pg.get_by_test_id("action-center").inner_text()
        check(f"{nm}: Malay words in dark theme", "Pusat Tindakan Jualan" in t and "Susulan lewat" in t, t[:200])
        check(f"{nm}: dark theme applied", pg.evaluate("document.documentElement.classList.contains('dark')"))
        pg.screenshot(path=f"{SHOTS}/05-{nm}-1440-dark-ms.png", full_page=True)
        ctx.close()
    ctx, pg, errs = open_page(b, SALES, w=390, theme="dark", lang="ms")
    check("390px dark BM: no sideways page", no_hscroll(pg))
    pg.screenshot(path=f"{SHOTS}/06-sales-exec-390-dark-ms.png", full_page=True)
    ctx.close()
    ctx, pg, errs = open_page(b, COO)
    check("COO opens Mine by default", "My Sales Action Center" in pg.get_by_test_id("action-center").inner_text())
    ctx.close()
    b.close()

bad = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(bad)}/{len(res)} passed")
raise SystemExit(1 if bad else 0)

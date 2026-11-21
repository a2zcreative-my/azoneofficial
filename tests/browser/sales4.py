"""SALES WORKSPACE 4.0 (v1.292.0) - in a browser (the CEO's "approve",
12-11-2026; claude/SALES-WORKSPACE-4.0-BLUEPRINT.md, decisions S1-S7). The
source rules are held by tests/sales4.mjs; here, the screens:

  the seven views (v1.399.0), each reached from the address (?tab=Sales&view=...), at the
  directive's eight widths, with no sideways page and no page error; tabs on a
  wide screen, one selector on a phone; Back and Forward move between views;
  the Overview is picture 01 (v1.320.0: six figures, the pipeline, the worklist and its rail); the figures' words follow
  Payment Verification (Verified outstanding and Pending payment verification
  only while it is on); a reported payment is Review for the owner account
  and View for the COO; a document row has one action and the rest under its
  menu (Escape closes it); Packages is under Documents -> More; Customers'
  filters (v1.399.0: the read-only Board retired - the Sales Pipeline is the board); Reports shows one report at a time (the
  map only for Sales by State); Closed Sales has its strip, its four facts
  (the payout is the Commission ledger's own word, and a consultant reads
  only their own) and an Export; a live host cannot open Sales by address.

The fixture answers are invented (tests/browser/serve.mjs); no production
figure is used. Servers (servers.txt):
    4177 ceo · 4179 coo · 4180 live_host · 4182 sales_marketing
    4290 ceo OWNER PAYV PAYDOCS · 4266 coo PAYV PAYDOCS
"""
from playwright.sync_api import sync_playwright
import json, re, urllib.request

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
# v1.398.0 - the customers view is called Leads & CRM (was Customers & Follow-ups)
# v1.399.0 (Phase 3, decision 6) - seven views in the CEO's order; the Sales Pipeline is new
VIEWS = [("overview", "Overview", "Overview"), ("customers", "Leads & CRM", "Leads & CRM"), ("pipeline", "Sales Pipeline", "Sales Pipeline"),
         ("documents", "Quotations & Invoices", "Documents"), ("payments", "Payments", "Payments"),
         ("closed", "Closed Sales", "Closed Sales"), ("reports", "Reports", "Reports")]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def post(port, path, body):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(), method="POST", headers={"content-type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req).read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"status": e.code}

def reset(port):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()

def ctx_for(b, w, h=900):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone, accept_downloads=True)

def go(pg, port, view=None, wait=2600):
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales" + (f"&view={view}" if view else "")); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")

def vis(pg, tid):
    loc = pg.get_by_test_id(tid).filter(visible=True)
    return loc.count() > 0

def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None

def pick_view(pg, phone, wide, short):
    if phone:
        pg.get_by_test_id("view-switch").filter(visible=True).first.click(); pg.wait_for_timeout(250)
        pg.get_by_role("menuitemradio", name=re.compile("^" + re.escape(short))).first.click()
    else:
        pg.get_by_test_id("sales-tabs").get_by_role("tab", name=re.compile("^" + re.escape(wide))).first.click()
    pg.wait_for_timeout(900)

def small_targets(pg, scope_tid):
    """buttons and selects in a block that are visible and under 44 px tall (a phone's touch target)"""
    return pg.evaluate("""(tid) => [...document.querySelectorAll(`[data-testid="${tid}"] button, [data-testid="${tid}"] select`)]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
      .filter(e => e.getBoundingClientRect().height < 44).map(e => (e.innerText || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().height))""", scope_tid)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ================= the CEO, verification off: every width, every view =================
    for w in WIDTHS:
        phone = w < 768
        ctx = ctx_for(b, w); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        for key, wide, short in VIEWS:
            go(pg, 4177, key)
            tag = f"CEO {w} {key}"
            check(f"{tag}: the address keeps the view", view_of(pg) == key, pg.url)
            check(f"{tag}: no sideways page", no_hscroll(pg))
            check(f"{tag}: the screen drew (no error card)", "Something went wrong on this screen" not in pg.locator("main").inner_text())
            if phone:
                check(f"{tag}: a phone has the one selector, naming the view; no tab row", vis(pg, "sales-view-bar") and not vis(pg, "sales-tabs")
                      and pg.get_by_test_id("view-switch").filter(visible=True).first.inner_text().strip().startswith(short),
                      pg.get_by_test_id("view-switch").filter(visible=True).first.inner_text() if vis(pg, "view-switch") else "no switch")
            else:
                sel = pg.get_by_test_id("sales-tabs").get_by_role("tab", selected=True)
                check(f"{tag}: a wide screen has the seven tabs, this one selected; no selector", vis(pg, "sales-tabs") and not vis(pg, "sales-view-bar")
                      and pg.get_by_test_id("sales-tabs").get_by_role("tab").count() == 7 and sel.count() == 1 and sel.inner_text().strip().startswith(wide),
                      sel.all_inner_texts() if sel.count() else "none")
            gold = pg.locator("main button[class*=line-tabs_action]").filter(visible=True)
            want = {"overview": 1, "documents": 1, "payments": 1, "customers": 1, "pipeline": 1, "closed": 0, "reports": 0}[key]
            check(f"{tag}: {want} gold action for the view", gold.count() == want, gold.all_inner_texts())
            if key == "overview":
                # v1.320.0 (Sales 2.0 Stage 2, picture 01, approved) - six figures; with verification off the figure says so and shows no amount
                strip = pg.get_by_role("group", name="Sales at a glance").filter(visible=True)
                txt = strip.first.inner_text() if strip.count() else ""
                check(f"{tag}: six figures: the week's sales, the weekly target, Outstanding, Pending CEO Verification (off), Due Follow-Ups, Open Quotations",
                      strip.count() == 1 and strip.first.get_attribute("data-cols") == "6" and "Sales This Week" in txt and "Weekly Target" in txt
                      and "Outstanding" in txt and "Verified" not in txt and "Payment verification is off" in txt and "Due Follow-Ups" in txt and "Open Quotations" in txt, txt[:300])
                # v1.397.0 - the one worklist is My Sales Action Center; Important Follow-Ups lives inside it
                wl = pg.get_by_test_id("action-center").filter(visible=True)
                check(f"{tag}: then the Action Center, the pipeline summary and the week - and nothing else (no chart, no report, no advice)",
                      wl.count() == 1 and vis(pg, "sales-pipeline") and pg.get_by_test_id("sales-worklist").count() == 0 and pg.get_by_test_id("sales-reports").count() == 0 and pg.locator("main svg[aria-label*='Sales performance' i]").count() == 0
                      and "Weekly sales" not in pg.locator("main").inner_text(), pg.locator("main").inner_text()[:200])
                if phone:
                    small = small_targets(pg, "action-list")
                    check(f"{tag}: the Action Center's controls are 44 px touch targets on a phone", not small, small)
            if key == "reports":
                rt = pg.get_by_test_id("report-type")
                check(f"{tag}: Reports: one selector, Sales Performance first", rt.count() == 1 and rt.input_value() == "performance")
        if phone:
            small = small_targets(pg, "sales-view-bar")
            check(f"CEO {w}: the view selector and the gold action are 44 px touch targets", not small, small)
        check(f"CEO {w}: no page errors", not errs, errs[:3])
        ctx.close()

    # ================= Back and Forward =================
    for w in [1440, 390]:
        phone = w < 768
        ctx = ctx_for(b, w); pg = ctx.new_page()
        go(pg, 4177)
        check(f"Back {w}: Sales opens on the Overview, said in the address", view_of(pg) == "overview", pg.url)
        pick_view(pg, phone, "Payments", "Payments")
        check(f"Back {w}: a new view is a new address", view_of(pg) == "payments", pg.url)
        pick_view(pg, phone, "Reports", "Reports")
        pg.go_back(); pg.wait_for_timeout(900)
        check(f"Back {w}: Back returns to Payments", view_of(pg) == "payments" and pg.get_by_test_id("sales-reports").count() == 0, pg.url)
        pg.go_back(); pg.wait_for_timeout(900)
        check(f"Back {w}: Back again returns to the Overview", view_of(pg) == "overview" and vis(pg, "action-center"), pg.url)
        pg.go_forward(); pg.wait_for_timeout(900)
        check(f"Back {w}: Forward goes to Payments again", view_of(pg) == "payments" and not vis(pg, "action-center"), pg.url)
        ctx.close()

    # ================= an Action Center row opens the record itself =================
    # v1.397.0 - the one worklist is My Sales Action Center (sales-today.tsx); its buttons go to the records
    for w in [1440, 390]:
        ctx = ctx_for(b, w); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, 4177)
        ac = pg.get_by_test_id("action-center")
        ac.locator("[data-key='followup:612'] [data-testid=action-go]").click(); pg.wait_for_timeout(1500)
        dlg = pg.get_by_role("dialog").last
        check(f"Work {w}: an overdue follow-up's action opens its customer's file", dlg.count() == 1 and "Aina Boutique (Melaka)" in dlg.inner_text(), dlg.inner_text()[:200] if dlg.count() else "none")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
        ac.locator("[data-key='invoice:61'] [data-testid=action-doc]").click(); pg.wait_for_timeout(1500)
        check(f"Work {w}: an invoice's Document goes to Quotations & Invoices", view_of(pg) == "documents", pg.url)
        check(f"Work {w}: no page errors and no error card", not errs and "Something went wrong on this screen" not in pg.locator("main").inner_text(), errs[:3])
        ctx.close()

    # ================= Documents: one action per row, the rest under its menu; More =================
    for w in [1440, 390]:
        ctx = ctx_for(b, w); pg = ctx.new_page()
        go(pg, 4177, "documents")
        more = pg.get_by_test_id("row-more").filter(visible=True)
        check(f"Docs {w}: each document row has its ⋯ menu", more.count() >= 4, more.count())
        more.first.click(); pg.wait_for_timeout(300)
        menu = pg.get_by_test_id("row-menu").filter(visible=True)
        items = menu.first.locator("button").all_inner_texts() if menu.count() else []
        check(f"Docs {w}: the menu holds the row's other actions", menu.count() == 1 and len(items) >= 2, items)
        if w < 768:
            bh = [round(x.bounding_box()["height"]) for x in menu.first.locator("button").all()]
            check(f"Docs {w}: the menu's items are 44 px touch targets", all(h >= 44 for h in bh), bh)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(250)
        check(f"Docs {w}: Escape closes the menu", pg.get_by_test_id("row-menu").filter(visible=True).count() == 0)
        dm = pg.get_by_test_id("docs-more").filter(visible=True).first
        opts = dm.locator("option").all_inner_texts()
        check(f"Docs {w}: More holds Delivery orders, Receipts, Credit notes, Outstanding, Packages", all(any(o.startswith(x) for o in opts) for x in ["Delivery orders", "Receipts", "Credit notes", "Outstanding", "Packages"]), opts)
        dm.select_option("packages"); pg.wait_for_timeout(1200)
        main = pg.locator("main").inner_text()
        # v1.317.0 (the duplicate-function audit, D-3) - one package list: the public page is set on the package, no second editor
        check(f"Docs {w}: Packages opens inside Quotations & Invoices, and says what the public page shows", view_of(pg) == "documents" and pg.get_by_test_id("public-page-note").filter(visible=True).count() == 1 and pg.get_by_test_id("pkg-public-toggle").filter(visible=True).count() >= 1, main[:400])
        check(f"Docs {w}: no sideways page with Packages open", no_hscroll(pg))
        ctx.close()

    # ================= Leads & CRM (was Customers & Follow-ups): filters and the Board =================
    # v1.398.0 (Phase 2, decision 5) - Needs Action is retired (My Sales Action Center owns it); the lead
    # views open the Leads & CRM workspace; the Board stays until Phase 3; Add customer opens the form
    def pick_cust(pg, key):
        tab = pg.get_by_test_id(f"cust-{key}").filter(visible=True)
        if tab.count(): tab.first.click()
        else:
            pg.get_by_test_id("cust-switch").filter(visible=True).first.click(); pg.wait_for_timeout(300)
            pg.get_by_test_id(f"cust-menu-{key}").filter(visible=True).first.click()
        pg.wait_for_timeout(900)
    for w in [1440, 390]:
        ctx = ctx_for(b, w); pg = ctx.new_page()
        go(pg, 4177, "customers")
        # v1.399.0 (Phase 3, decision 7) - the read-only Board is retired: the Sales Pipeline is the board
        check(f"Cust {w}: the filters: All Leads, My Leads, Unassigned, New Enquiries, Active Customers, Follow-ups - no Needs Action, no Board",
              all(pg.get_by_test_id(f"cust-{k}").count() == 1 for k in ["all_leads", "my_leads", "unassigned", "enquiries", "active", "followups"])
              and pg.get_by_test_id("cust-action").count() == 0 and pg.get_by_test_id("cust-board").count() == 0 and pg.get_by_test_id("cust-menu-board").count() == 0)
        check(f"Cust {w}: All Leads opens the Leads & CRM workspace", vis(pg, "crm-leads") and not vis(pg, "customer-needs"))
        check(f"Cust {w}: no read-only Board anywhere in Leads & CRM", pg.get_by_test_id("customer-board").count() == 0)
        add = pg.get_by_role("button", name=re.compile("Add customer")).filter(visible=True)
        if add.count(): add.first.click(); pg.wait_for_timeout(700)
        check(f"Cust {w}: Add customer opens the customer form", pg.locator("#sales-customers").is_visible())
        ctx.close()

    # ================= Reports: one at a time =================
    ctx = ctx_for(b, 1440); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, 4177, "reports")
    rt = pg.get_by_test_id("report-type")
    keys = [o.get_attribute("value") for o in rt.locator("option").all()]
    check("Reports: the eight report types, the map and Live-hour Economics among them", keys == ["performance", "team", "ageing", "collected", "commission", "state", "live"] or (len(keys) >= 7 and {"state", "live", "team"} <= set(keys)), keys)
    check("Reports: the map is not drawn until Sales by State is chosen", pg.get_by_role("radiogroup", name="Layer").count() == 0)
    rt.select_option("state"); pg.wait_for_timeout(1500)
    check("Reports: Sales by State draws the map, alone", pg.get_by_test_id("sales-reports").get_attribute("data-report") == "state" and "Sales Performance" not in pg.get_by_test_id("sales-reports").locator(":scope > div").last.inner_text())
    rt.select_option("team"); pg.wait_for_timeout(1500)
    rep = pg.get_by_test_id("sales-reports").inner_text()
    check("Reports: Consultant Performance & Weekly Target holds the week, the team and the advice", "eekly" in rep and pg.get_by_role("radiogroup", name="Layer").count() == 0, rep[:300])
    check("Reports: no page errors", not errs, errs[:3])
    ctx.close()

    # ================= Closed Sales: the strip, four facts, export =================
    for port, who, inv2 in [(4177, "CEO", "Eligible"), (4182, "Sales", None)]:
        ctx = ctx_for(b, 1440); pg = ctx.new_page()
        go(pg, port, "closed")
        pg.get_by_role("button", name="All", exact=True).click(); pg.wait_for_timeout(1200)
        strip = pg.get_by_test_id("metric-strip").filter(visible=True).first.inner_text()
        check(f"Closed {who}: the strip: Paid in full, Confirmed for commission, Awaiting confirmation", all(x in strip for x in ["Paid in full", "Confirmed for commission", "Awaiting confirmation"]), strip)
        ths = [t.strip() for t in pg.locator("main table thead th").all_inner_texts()]
        check(f"Closed {who}: four separate facts: Settlement, Closer, Commission eligibility, Payout", all(x in ths for x in ["Settlement", "Closer", "Commission eligibility", "Payout"]), ths)
        if inv2:
            row = pg.locator("main table tbody tr").filter(has_text="INV-AZO100926-2")
            cell = row.get_by_test_id("closed-payout").inner_text().strip() if row.count() else "no row"
            check(f"Closed {who}: the payout is the Commission ledger's own word (management reads everyone's)", cell == inv2, cell)
        else:
            cells = [c.strip() for c in pg.locator("main table tbody [data-testid=closed-payout]").all_inner_texts()]
            led = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/staff/commission/entries?scope=all").read())
            check(f"Closed {who}: a consultant asking for everyone's ledger is answered with their own only (the server decides)",
                  led.get("scope") == "mine" and all(e.get("user_id") == 9001 for e in led.get("entries", [])), led.get("scope"))
            check(f"Closed {who}: so no other closer's payout is shown", all(c == "—" for c in cells) and cells, cells)
        check(f"Closed {who}: no commission amount on Closed Sales", "RM 280.00" not in pg.locator("main table").inner_text())
        with pg.expect_download() as dl:
            pg.get_by_test_id("closed-export").click()
        path = dl.value.path()
        head = open(path, encoding="utf-8-sig").readline().strip()
        check(f"Closed {who}: Export CSV writes what the columns say", head.replace('"', "") == "Invoice,Customer,Closer,Total (RM),Settlement,Paid on,Commission eligibility,Payout", head)
        ctx.close()

    # ================= Payment Verification on: owner Review, COO View =================
    for port in [4290, 4266]:
        reset(port)
        r = post(port, "/api/v1/staff/docs/3/payment-reports", {"amount_cents": 100000, "received_on": "2026-11-05", "method": "bank_transfer", "reference": "MBB 9999"})
        check(f"PAYV {port}: the fixture took a reported payment on the list's own invoice", r.get("ok") is True, r)
    for port, who, w in [(4290, "CEO owner", 1440), (4290, "CEO owner", 390), (4266, "COO", 1440), (4266, "COO", 390)]:
        ctx = ctx_for(b, w); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, port, "overview", 3200)
        txt = pg.get_by_role("group", name="Sales at a glance").filter(visible=True).first.inner_text()
        check(f"PAYV {who} {w}: the figures say Verified Outstanding and Pending CEO Verification, waiting for the CEO",
              "Verified Outstanding" in txt and "Pending CEO Verification" in txt and "waiting for the CEO" in txt and "verification is off" not in txt, txt[:300])
        # v1.397.0 - a reported payment is the verifier's line at the top of the Action Center; nobody else gets a verify action
        vl = pg.get_by_test_id("action-verify").filter(visible=True)
        if who == "COO":
            check(f"PAYV {who} {w}: no verify action for the COO - verification stays the owner-CEO's", vl.count() == 0 and "Verify" not in pg.get_by_test_id("action-center").inner_text())
        else:
            check(f"PAYV {who} {w}: the owner account sees the payment waiting for verification", vl.count() == 1 and "verification" in vl.inner_text(), vl.count())
            vl.first.click(); pg.wait_for_timeout(1500)
            check(f"PAYV {who} {w}: it opens Payments (the payment engine), said in the address", view_of(pg) == "payments", pg.url)
        check(f"PAYV {who} {w}: no sideways page; no page errors", no_hscroll(pg) and not errs, errs[:3])
        ctx.close()
    for port in [4290, 4266]:
        reset(port)

    # ================= roles =================
    ctx = ctx_for(b, 1440); pg = ctx.new_page()
    go(pg, 4182, "overview")
    txt = pg.get_by_role("group", name="Sales at a glance").filter(visible=True).first.inner_text()
    check("Sales consultant: the figures are theirs: My Sales This Week, My Weekly Target; no team panel", "My Sales This Week" in txt and "My Weekly Target" in txt and pg.get_by_test_id("team-table").count() == 0, txt[:200])
    go(pg, 4179, "reports")
    check("COO: Reports opens from the address", pg.get_by_test_id("report-type").count() == 1 and view_of(pg) == "reports")
    go(pg, 4180, "payments")
    check("Live host: Sales cannot be opened by address (no Sales views drawn)", pg.get_by_test_id("sales-tabs").count() == 0 and pg.get_by_test_id("action-center").count() == 0, pg.url)
    ctx.close()
    b.close()

failed = [n for n, c in res if not c]
print(f"\nsales4: {len(res) - len(failed)}/{len(res)} passed")
raise SystemExit(1 if failed else 0)

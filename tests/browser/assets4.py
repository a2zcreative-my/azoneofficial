"""ASSETS WORKSPACE 4.0, PHASE 1 (v1.303.0) in a browser - the CEO, 14-11-2026:
"approve as recommendation" (claude/ASSETS-WORKSPACE-4.0-BLUEPRINT.md). The
server rules are held by tests/assets4.mjs; here, on the fixture's invented
assets:

  the five tabs from the address and Back / Forward; a phone gets the
  Dashboard's view switch with + Add, never the cut-off tab row; the Overview's
  status strip, donut, RECORDED PURCHASE COST with "n without a price" and
  recent activities from the asset history; the register's Company column and
  filter, shared use, "No price" (never RM 0), cards on a phone; the Asset
  Detail's Assignment / History; Shared Use on Assignments; one report
  selector, each company its own cost column, Missing Information, CSV and PDF
  exports; the COO edits, the CCO reads only; eight widths with no sideways
  page and nothing under the bottom bar.

  v1.305.0 Phase 3 (maintenance and disposal): the board's three counts,
  what waits (an open issue, a disposal to decide - the CEO decides the
  COO's), + Report Issue, the four sub-tabs, the asset's Maintenance tab
  (no plain status change into repair, lost or disposed), the two history
  reports, the CCO reports but neither repairs nor decides, My assets has
  Report issue / Report lost.

  v1.304.0 Phase 2 (custody): the keepers' queue (not acknowledged, requests
  to approve or decline), My assets with Acknowledge, the register's "Waiting
  for acknowledgement", Transfer / Return / Cancel in the asset's detail (a
  transfer needs its reason), the holder not editable in the form; Sales and
  a manager open Assets on My assets (the manager with the team and a request
  form), no register, no cost.

Servers: 4177 CEO · 4179 COO · 4185 CCO · 4182 Sales · 4195 Sales HOD (the shared fixture).
"""
from playwright.sync_api import sync_playwright
import re, urllib.request

CEO, COO, CCO = 4177, 4179, 4185
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def ctx_for(b, w, h=900):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone, accept_downloads=True)
def go(pg, port, q="", wait=2600):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Assets{q}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None
def zone(pg, label):
    return pg.locator(f"section[aria-label='{label}']").first

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- desktop: the CEO ----------------
    c = ctx_for(b, 1440, 1100); pg = c.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO)
    check("the Overview opens and its view is in the address", view_of(pg) == "overview", pg.url)
    check("desktop: the tab row, not the phone switch", pg.get_by_role("tab", name="Asset Register").is_visible() and not pg.get_by_test_id("asset-view-bar").is_visible())
    main = pg.locator("main").inner_text()
    check("Overview: the status strip - total and the five statuses", all(s in main for s in ["Total Assets", "In use", "Spare", "In repair", "Lost", "Disposed"]), main[:300])
    cost = pg.get_by_test_id("asset-cost").inner_text()
    check("Overview: RECORDED PURCHASE COST, never 'Total Asset Value', and not a book value", "Recorded purchase cost" in cost and "Not a book value" in cost and "Total Asset Value" not in main, cost)
    check("Overview: the asset without a price is counted apart, not as RM 0", "1 without a price" in cost, cost)
    act = pg.get_by_test_id("asset-activity").inner_text()
    check("Overview: recent activities from the asset history (company move, before and after)", "Company moved" in act and "In use → In repair" in act and "consultancy studio" in act, act[:500])
    check("Overview: quick actions (phase 3: Report Maintenance)", all(s in main for s in ["Register Asset", "Assign Asset", "Report Maintenance", "View Reports"]))
    # tabs and the address
    for name, v in [("Asset Register", "register"), ("Assignments", "assign"), ("Maintenance & Disposal", "care"), ("Reports & Audit", "reports")]:
        pg.get_by_role("tab", name=name).click(); pg.wait_for_timeout(350)
        check(f"{name} is in the address", view_of(pg) == v, pg.url)
    pg.go_back(); pg.wait_for_timeout(400)
    check("Back returns to Maintenance & Disposal", view_of(pg) == "care", pg.url)
    pg.go_forward(); pg.wait_for_timeout(400)
    check("Forward returns to Reports & Audit", view_of(pg) == "reports", pg.url)
    # Register
    go(pg, CEO, "&view=register")
    reg = pg.locator("table").filter(has_text="Purchase cost (RM)").first
    rt = reg.inner_text()
    check("Register: Company column; A2Z / AZ ONE / not set", "Company" in rt and "A2Z" in rt and "AZ ONE" in rt and "Not set" in rt, rt[:400])
    check("Register: shared use shows the team, not a person", "Shared · Studio team" in rt, rt[:400])
    pg.get_by_test_id("asset-company-filter").select_option("azoo"); pg.wait_for_timeout(300)
    rows = reg.locator("tbody tr").count()
    check("Register: the company filter narrows to AZ ONE's assets", rows == 2, rows)
    pg.get_by_test_id("asset-company-filter").select_option(""); pg.wait_for_timeout(200)
    pg.locator("label", has_text="Rows").locator("select").first.select_option("25"); pg.wait_for_timeout(200)
    check("Register: an asset with no price says No price - never RM 0.00", "No price" in reg.inner_text() and "TOTAL — recorded purchase cost" in reg.inner_text(), reg.inner_text()[-300:])
    # the Asset Detail
    reg.get_by_role("button", name=re.compile("^Open A2Z-TRP-04")).click(); pg.wait_for_timeout(500)
    dr = pg.get_by_role("dialog").inner_text()
    check("Asset Detail: company and recorded purchase cost", "AZ ONE OFFICIAL" in dr and "Recorded purchase cost" in dr, dr[:400])
    check("Asset Detail: Assignment says shared use", "Shared use · Studio team" in dr, dr[:500])
    pg.get_by_role("dialog").get_by_role("button", name="History", exact=True).click(); pg.wait_for_timeout(400)
    check("Asset Detail: the History tab", pg.get_by_role("dialog").get_by_role("button", name="History", exact=True).get_attribute("aria-pressed") == "true")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    # the form: company
    go(pg, CEO, "&view=register")
    pg.get_by_role("button", name="Add asset").first.click(); pg.wait_for_timeout(400)
    check("Add: the company is chosen by a person (not set by default)", pg.get_by_test_id("asset-company").input_value() == "")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    # Assignments
    go(pg, CEO, "&view=assign")
    sh = pg.get_by_test_id("asset-shared").inner_text()
    check("Assignments: Shared Use lists the team and its asset", "Studio team" in sh and "A2Z-TRP-04" in sh, sh[:300])
    # Reports
    go(pg, CEO, "&view=reports")
    picks = pg.get_by_test_id("asset-report-pick")
    check("Reports: one selector with the ten reports (phase 3 adds the two histories)", picks.count() == 10 and all(s in pg.locator("nav[aria-label='Reports']").inner_text() for s in ["Asset Status Summary", "Assets by Category", "Assets by Location", "Assets by Company", "Assignment Summary", "Missing Information", "Warranty", "Maintenance History", "Lost & Disposal", "Audit Trail"]))
    t = pg.get_by_test_id("asset-report-table").inner_text()
    check("Status summary: each company its own cost column, never one mixed total", "A2Z (RM)" in t and "AZ ONE (RM)" in t and "not set (RM)" in t and "each company's recorded purchase cost" in pg.get_by_test_id("asset-report").inner_text(), t[:300])
    picks.filter(has_text="Assets by Company").click(); pg.wait_for_timeout(300)
    t = pg.get_by_test_id("asset-report-table").inner_text()
    check("By company: A2Z, AZ ONE and Company not set on their own lines", "A2Z CREATIVE MARKETING" in t and "AZ ONE OFFICIAL" in t and "Company not set" in t, t[:300])
    pg.get_by_test_id("asset-report-company").select_option("a2z"); pg.wait_for_timeout(300)
    t = pg.get_by_test_id("asset-report-table").inner_text()
    check("A company filter shows one company only", "AZ ONE OFFICIAL" not in t and "A2Z CREATIVE MARKETING" in t, t[:300])
    pg.get_by_test_id("asset-report-company").select_option(""); pg.wait_for_timeout(200)
    picks.filter(has_text="Missing Information").click(); pg.wait_for_timeout(300)
    t = pg.get_by_test_id("asset-report").inner_text()
    check("Missing information: the display rack's missing price and company", "AZOA-010" in t and "no purchase price" in t and "company not set" in t, t[:400])
    with pg.expect_download() as dl:
        pg.get_by_test_id("asset-export-csv").click()
    csv = open(dl.value.path(), encoding="utf-8-sig").read()
    check("CSV export: the same rows the screen shows", dl.value.suggested_filename.startswith("assets-missing") and "AZOA-010" in csv and "no purchase price" in csv, csv[:200])
    picks.filter(has_text="Asset Status Summary").click(); pg.wait_for_timeout(300)
    with pg.expect_download() as dl:
        pg.get_by_test_id("asset-export-pdf").click()
    pdf = open(dl.value.path(), "rb").read()
    check("PDF export: a real PDF of the report", pdf[:5] == b"%PDF-" and b"Assets - Asset Status Summary" in pdf, dl.value.suggested_filename)
    picks.filter(has_text="Audit Trail").click(); pg.wait_for_timeout(300)
    t = pg.get_by_test_id("asset-report").inner_text()
    check("Audit trail: asset events, with a company move's reason", "Company moved" in t and "consultancy studio" in t, t[:400])
    check("no page error (CEO)", not errs, errs[:2])
    c.close()

    # ---------------- the COO edits; the CCO reads ----------------
    c = ctx_for(b, 1280, 1000); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, COO, "&view=register")
    check("COO: Add asset is offered (A3)", pg.get_by_role("button", name="Add asset").count() >= 1)
    c.close()
    c = ctx_for(b, 1280, 1000); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CCO, "&view=register")
    check("CCO: reads the register, no Add / Edit (D-1)", pg.get_by_role("button", name="Add asset").count() == 0 and pg.get_by_role("button", name="Edit", exact=True).count() == 0 and "Purchase cost" in pg.locator("main").inner_text())
    go(pg, CCO, "&view=reports"); pg.get_by_test_id("asset-report-pick").filter(has_text="Audit Trail").click(); pg.wait_for_timeout(300)
    check("CCO: the asset audit trail is open (D-7)", "Company moved" in pg.get_by_test_id("asset-report").inner_text())
    check("no page error (COO, CCO)", not errs, errs[:2])
    c.close()

    # ---------------- the phone ----------------
    for w in (390, 360):
        c = ctx_for(b, w, 800); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, CEO)
        bar = pg.get_by_test_id("asset-view-bar")
        check(f"phone {w}: the view switch with + Add, not the tab row", bar.is_visible() and not pg.get_by_role("tab", name="Asset Register").is_visible())
        add = pg.get_by_test_id("asset-add-phone").bounding_box()
        check(f"phone {w}: + Add is a 44 px target", add and add["height"] >= 43.5, add)
        bar.get_by_test_id("view-switch").click(); pg.wait_for_timeout(200)
        pg.get_by_role("menuitemradio", name=re.compile("^Asset Register")).click(); pg.wait_for_timeout(500)
        check(f"phone {w}: the switch opens the register (in the address)", view_of(pg) == "register", pg.url)
        cards = pg.locator("ul[aria-label='Assets']").first
        check(f"phone {w}: the register is cards, not a sideways table", cards.is_visible() and no_hscroll(pg))
        go(pg, CEO, "&view=reports")
        check(f"phone {w}: one report picker, no sideways page", pg.get_by_test_id("asset-report-select").is_visible() and no_hscroll(pg))
        check(f"phone {w}: no page error", not errs, errs[:2])
        c.close()

    # ---------------- v1.304.0 - Phase 2: custody ----------------
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO, "&view=assign")
    qu = pg.get_by_test_id("custody-queue").inner_text()
    check("P2 queue: the hand-over not yet acknowledged, and the manager's request", "MacBook Air M3" in qu and "Not acknowledged" in qu and "Fixture Manager asks" in qu and "Farid Zul" in qu, qu[:400])
    check("P2 queue: the keepers approve or decline (decline needs a reason)", pg.get_by_test_id("custody-approve").count() == 1 and pg.get_by_test_id("custody-queue").get_by_role("button", name="Decline").is_disabled())
    my = pg.get_by_test_id("my-assets").inner_text()
    check("P2 My assets for the keeper too: what they hold, waiting for their acknowledgement", "Company car" in my and "Waiting for your acknowledgement" in my and pg.get_by_test_id("asset-ack").count() == 1, my[:300])
    pg.get_by_test_id("asset-ack").click(); pg.wait_for_timeout(200)
    check("P2 acknowledging asks the condition it came in", pg.get_by_test_id("asset-custody-save").is_visible() and "Condition when received" in pg.get_by_test_id("my-assets").inner_text())
    go(pg, CEO, "&view=register")
    reg = pg.locator("table").filter(has_text="Purchase cost (RM)").first
    check("P2 register: the asset waiting for acknowledgement says so", "Waiting for acknowledgement" in reg.inner_text())
    reg.get_by_role("button", name=re.compile("^Open A2Z-LAP-02")).click(); pg.wait_for_timeout(800)
    cp = pg.get_by_test_id("custody-panel")
    check("P2 detail: Transfer, Return and Cancel hand-over for the keepers, and the custody steps", cp.get_by_test_id("custody-handover").inner_text().strip() == "Transfer" and cp.get_by_test_id("custody-return").count() == 1 and cp.get_by_test_id("custody-cancel").count() == 1 and "Handed over" in cp.get_by_test_id("custody-steps").inner_text(), cp.inner_text()[:300])
    cp.get_by_test_id("custody-handover").click(); pg.wait_for_timeout(200)
    cp.get_by_test_id("custody-to").select_option(index=1)
    check("P2 a transfer needs its reason before it can be sent", cp.get_by_test_id("custody-save").is_disabled())
    cp.get_by_test_id("custody-reason").fill("Moving to the studio team for the launch")
    check("P2 ...and then it can", cp.get_by_test_id("custody-save").is_enabled())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    go(pg, CEO, "&view=register")
    pg.locator("table").filter(has_text="Purchase cost (RM)").first.get_by_role("button", name="Edit", exact=True).first.click(); pg.wait_for_timeout(400)
    check("P2 edit: the holder is changed only through custody (D-5)", pg.locator("#asset-form select").nth(1).is_disabled() and "changes with Assign, Transfer or Return" in pg.locator("#asset-form").inner_text())
    check("no page error (P2 CEO)", not errs, errs[:2])
    c.close()
    for port, who in [(4182, "Sales"), (4195, "a manager (HOD)")]:
        for w in (1280, 390):
            c = ctx_for(b, w, 900); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            go(pg, port)
            main = pg.locator("main").inner_text()
            check(f"P2 {who} @{w}: Assets opens on My assets - no register, no tabs, no cost", pg.get_by_test_id("my-assets").is_visible() and pg.get_by_role("tab", name="Asset Register").count() == 0 and "Purchase cost" not in main and "Company car" in main, main[:300])
            if port == 4195:
                ta = pg.get_by_test_id("team-assets").inner_text()
                check(f"P2 {who} @{w}: the team's assets and a request form (the keepers decide)", "Nur Aisyah" in ta and "Request a hand-over" in ta and pg.get_by_test_id("asset-request-send").is_disabled() and "Waiting" in ta, ta[:300])
            else:
                check(f"P2 {who} @{w}: no team section without a team", pg.get_by_test_id("team-assets").count() == 0)
            short = pg.evaluate("[...document.querySelectorAll('[data-testid=my-assets] button, [data-testid=team-assets] button')].filter(x => x.offsetParent && x.getBoundingClientRect().height < 43.5).length") if w < 500 else 0
            check(f"P2 {who} @{w}: no sideways page; 44 px buttons on a phone", no_hscroll(pg) and short == 0, short)
            check(f"P2 {who} @{w}: no page error", not errs, errs[:2])
            c.close()

    # ---------------- v1.305.0 - Phase 3: maintenance and disposal ----------------
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO, "&view=care")
    main = pg.locator("main").inner_text()
    check("P3 board: the three counts", all(s in main for s in ["In Repair", "Lost", "Disposed"]) and pg.get_by_test_id("care-board").is_visible(), main[:300])
    wt = pg.get_by_test_id("care-waiting").inner_text()
    check("P3 waiting: the open issue and the disposal to decide", "Fan noise" in wt and "Disposal to decide" in wt and "Display rack" in wt and "proceeds (note)" in wt, wt[:400])
    check("P3 the CEO decides the COO's request", pg.get_by_test_id("care-decide").count() == 1)
    pg.get_by_test_id("care-decide").click(); pg.wait_for_timeout(200)
    check("P3 a rejection needs its reason; approve is ready", pg.get_by_test_id("care-reject").is_disabled() and pg.get_by_test_id("care-approve").is_enabled())
    bd = pg.get_by_test_id("care-board")
    check("P3 In Repair: the repairer, the reference, the passed expected date", all(s in bd.inner_text() for s in ["Fixture Repair Shop", "JOB-118", "Past its expected date"]), bd.inner_text()[:300])
    pg.get_by_test_id("care-sub-lost").click(); pg.wait_for_timeout(200)
    check("P3 Lost: where it was last seen", "Melaka hotel ballroom" in bd.inner_text())
    pg.get_by_test_id("care-sub-disposed").click(); pg.wait_for_timeout(200)
    check("P3 Disposed: how, who asked and who approved", all(s in bd.inner_text() for s in ["Scrapped", "asked by Mei Ling", "approved by Fixture Person"]), bd.inner_text()[:300])
    pg.get_by_test_id("care-sub-history").click(); pg.wait_for_timeout(200)
    check("P3 Service History: every record, newest first", all(s in bd.inner_text() for s in ["Sent for repair", "Issue reported", "Reported lost", "Disposal approved"]))
    pg.get_by_test_id("care-new").click(); pg.wait_for_timeout(200)
    pg.get_by_test_id("care-asset").select_option("1"); pg.wait_for_timeout(200)
    check("P3 + Report Issue: pick the asset, say what is wrong (10 characters)", pg.get_by_test_id("care-send").is_disabled())
    pg.get_by_test_id("care-text").fill("Lens cap missing and dusty")
    check("P3 ...then it can be sent", pg.get_by_test_id("care-send").is_enabled())
    go(pg, CEO, "&view=register")
    reg = pg.locator("table").filter(has_text="Purchase cost (RM)").first
    reg.get_by_role("button", name=re.compile("^Open A2Z-LGT-03")).click(); pg.wait_for_timeout(800)
    pg.get_by_test_id("asset-tab-care").click(); pg.wait_for_timeout(600)
    cp = pg.get_by_test_id("care-panel")
    check("P3 detail Maintenance tab: back from repair offered, not a second send; its records", cp.get_by_test_id("care-back").count() == 1 and cp.get_by_test_id("care-sent").count() == 0 and "Sent for repair" in cp.inner_text(), cp.inner_text()[:300])
    cp.get_by_test_id("care-back").click(); pg.wait_for_timeout(200)
    cp.get_by_test_id("care-outcome").select_option("not_repairable")
    check("P3 not repairable needs the reason; the cost is a note", cp.get_by_test_id("care-save").is_disabled() and "nothing is posted from here" in cp.inner_text())
    check("P3 no Change status for an asset in repair", pg.get_by_role("button", name="Change status").count() == 0)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    reg.get_by_role("button", name=re.compile("^Open AZOA-005")).click(); pg.wait_for_timeout(800)
    pg.get_by_role("button", name="Change status").click(); pg.wait_for_timeout(300)
    opts = pg.locator("input[name=asset-status]").count()
    check("P3 Change status offers only In use and Spare", opts == 2 and "Maintenance tab" in pg.locator("body").inner_text(), opts)
    go(pg, CEO, "&view=reports")
    pg.get_by_test_id("asset-report-pick").filter(has_text="Maintenance History").click(); pg.wait_for_timeout(800)
    rt = pg.get_by_test_id("asset-report").inner_text()
    check("P3 report: Maintenance History from the records", "Fixture Repair Shop" in rt and "Reported lost" not in rt and "Sent for repair" in rt, rt[:300])
    pg.get_by_test_id("asset-report-pick").filter(has_text="Lost & Disposal").click(); pg.wait_for_timeout(500)
    rt = pg.get_by_test_id("asset-report").inner_text()
    check("P3 report: Lost & Disposal", "Reported lost" in rt and "Disposal approved" in rt and "Sent for repair" not in rt, rt[:300])
    check("no page error (P3 CEO)", not errs, errs[:2])
    c.close()
    c = ctx_for(b, 1280, 1000); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CCO, "&view=care")
    check("P3 the CCO reads the board and reports, but neither repairs nor decides", pg.get_by_test_id("care-new").is_visible() and pg.get_by_test_id("care-decide").count() == 0)
    check("no page error (P3 CCO)", not errs, errs[:2])
    c.close()
    for w in (1280, 390):
        c = ctx_for(b, w, 900); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, 4182)
        my = pg.get_by_test_id("my-assets")
        check(f"P3 Sales @{w}: Report issue and Report lost on their own assets", my.get_by_test_id("my-asset-issue").count() >= 1 and my.get_by_test_id("my-asset-lost").count() >= 1)
        my.get_by_test_id("my-asset-lost").first.click(); pg.wait_for_timeout(200)
        check(f"P3 Sales @{w}: a loss asks what happened, last seen where and when", pg.get_by_test_id("care-lost-form").is_visible() and pg.get_by_test_id("care-send").is_disabled() and no_hscroll(pg))
        check(f"P3 Sales @{w}: no page error", not errs, errs[:2])
        c.close()
    for w in (390, 320):
        c = ctx_for(b, w, 900); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, CEO, "&view=care")
        short = pg.evaluate("[...document.querySelectorAll('[data-testid=care-board] button, [data-testid=care-waiting] button')].filter(x => x.offsetParent && x.getBoundingClientRect().height < 43.5).length")
        check(f"P3 phone {w}: the board, no sideways page, 44 px buttons", pg.get_by_test_id("care-board").is_visible() and no_hscroll(pg) and short == 0, short)
        check(f"P3 phone {w}: no page error", not errs, errs[:2])
        c.close()

    for w in WIDTHS:
        for q in ["", "&view=register", "&view=assign", "&view=care", "&view=reports"]:
            c = ctx_for(b, w); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            go(pg, CEO, q, 2200)
            check(f"ceo @{w} {q or 'overview'}: no sideways page, no error card, no page error",
                  no_hscroll(pg) and "Something went wrong on this screen" not in pg.locator("main").inner_text() and not errs, errs[:1])
            c.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\nassets4: {len(res) - len(failed)}/{len(res)} passed")
if failed: raise SystemExit(1)

"""LEAVE WORKSPACE 4.0 (v1.309.0) in a browser - the CEO, 15-11-2026: "approve
as recommend and make sure it is correct flow" (claude/LEAVE-WORKSPACE-4.0-
BLUEPRINT.md, L-0 ... L-15). The server rules are held by tests/leave4.mjs;
here, on the fixture (LEAVE4=1 adds a routed request at the CEO's final step):

  five views from the address, Back / Forward, a view not offered falls back
  to the Overview; the Overview's five figures, what waits on you, team
  availability, today and the next seven days, no balance; Apply's three
  steps - the server's count (a holiday named, not counted), the balance
  before and after, the route, the reason and the medical certificate, a
  half day, the body sent without a days figure; My Leave's three balances,
  the ledger and credits, the history's Request # and Last update and its
  menu; one Team Calendar with availability, who is away and the by-person
  view; Approvals' tiles, policy, Manage Policy, the queue (approve, send
  back), a register with no decision buttons; the override for the owner
  only, in the drawer; staff and the COO; eight widths with no sideways page.

Servers: 4310 CEO (owner) · 4311 staff (sales_marketing) · 4312 COO (all LEAVE4=1).
"""
from playwright.sync_api import sync_playwright
import re, json, urllib.request

CEO, STAFF, COO = 4310, 4311, 4312
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def ctx_for(b, w, h=1000):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
def go(pg, port, view="overview", wait=2600, reset=True):
    if reset: urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Leave&view={view}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None
def posts(port):
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/__leave").read())["posts"]
def visible_text(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('main *')].filter(e => e.offsetParent !== null && e.children.length === 0).map(e => e.textContent).join(' | ')""")

with sync_playwright() as p:
    b = p.chromium.launch()
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO)
    # v1.325.0 (Global UI System D-3, the CEO's approval) - Apply Leave is a button that opens the drawer, not a view
    names = ["Overview", "My Leave", "Team Calendar", "Approvals & Management"]
    check("four views in the references' order, and Apply Leave as the row's button", [t.strip() for t in pg.get_by_role("tab").all_inner_texts()][:4] == names and pg.get_by_role("button", name="Apply Leave").filter(visible=True).count() == 1, pg.get_by_role("tab").all_inner_texts())
    check("the Overview is in the address", view_of(pg) == "overview", pg.url)
    t = visible_text(pg)
    check("Overview: Applications, Approved, Pending, Rejected, On Leave Today (of 7 staff)", all(s in t for s in ["Applications", "Approved", "Pending", "Rejected", "On Leave Today", "of 7 staff"]), t[:300])
    pend = pg.get_by_test_id("ov-pending").inner_text()
    check("Pending Requests: what waits on the CEO (Siti, Medical) with Review", "Siti Nur Hidayah" in pend and "Medical Leave" in pend and "Review" in pend, pend[:300])
    check("Team Availability from the day verdict: 5/7 available, on leave, off day", "5/7" in pg.locator("[data-testid=team-availability]:visible").first.inner_text() and "Off Day / Holiday" in pg.locator("[data-testid=team-availability]:visible").first.inner_text())
    check("Today's Leave and the next 7 days are on the Overview", pg.get_by_test_id("ov-today").is_visible() and pg.get_by_test_id("ov-upcoming").is_visible())
    check("D-1: no balance on the Overview - My Leave only", not pg.get_by_test_id("my-balance").is_visible() and "Annual Leave balance" not in t)
    check("no legacy / organisation switch anywhere", pg.get_by_test_id("approval-route").count() == 0 and not re.search(r"previous approval rules|Approval by Organisation is on", t))

    # Back / Forward between views
    pg.get_by_role("tab", name="My Leave", exact=True).click(); pg.wait_for_timeout(600)
    pg.get_by_role("tab", name="Team Calendar", exact=True).click(); pg.wait_for_timeout(600)
    pg.go_back(); pg.wait_for_timeout(600)
    check("Back returns to My Leave", view_of(pg) == "mine" and pg.get_by_test_id("my-balance").is_visible(), pg.url)
    pg.go_forward(); pg.wait_for_timeout(600)
    check("Forward to the Team Calendar", view_of(pg) == "calendar", pg.url)

    # ---------- Apply ----------
    go(pg, CEO, "apply")
    nxt = pg.get_by_test_id("apply-next")
    check("Apply: three steps - Leave Details, Review, Submitted", all(s in pg.get_by_test_id("apply4").inner_text() for s in ["Leave Details", "Review", "Submitted"]))
    check("Review is not offered before the dates and the reason", nxt.is_disabled() and "Choose the dates" in pg.get_by_test_id("apply-missing").inner_text())
    check("there is no days box to type into", pg.locator("[data-testid=apply4] input[type=number]").count() == 0)
    pg.get_by_test_id("apply-start").fill("2026-09-14"); pg.get_by_test_id("apply-end").fill("2026-09-18"); pg.wait_for_timeout(900)
    check("L-3: Mon 14 to Fri 18 September is 4 working days - the server's count", "4 days" in pg.get_by_test_id("apply-days").inner_text(), pg.get_by_test_id("apply-days").inner_text())
    check("...and what was not counted is named (Malaysia Day)", "Malaysia Day" in pg.get_by_test_id("apply-excluded").inner_text())
    imp = pg.get_by_test_id("apply-impact").inner_text()
    check("Leave Balance Impact: before 12, this request -4, after 8", "12 days" in imp and "4 days" in imp and pg.get_by_test_id("impact-after").inner_text().startswith("8"), imp)
    check("the CEO's route is an Executive Leave Record", pg.get_by_test_id("route-exec").is_visible())
    check("...still no Review without the reason", nxt.is_disabled())
    pg.get_by_test_id("apply-reason").fill("Family matters in Melaka"); pg.wait_for_timeout(300)
    check("the reason counts its characters", "24 / 500" in pg.get_by_test_id("apply4").inner_text())
    check("Review is offered once all is in", nxt.is_enabled())
    nxt.click(); pg.wait_for_timeout(400)
    check("step 2: the fields are read-only and Submit appears", pg.get_by_test_id("apply-reason").is_disabled() and pg.get_by_test_id("apply-submit").is_visible())
    pg.get_by_test_id("apply-back").click(); pg.wait_for_timeout(300)
    check("Back returns to the details with the reason kept", pg.get_by_test_id("apply-reason").input_value() == "Family matters in Melaka")
    nxt.click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("apply-submit").click(); pg.wait_for_timeout(1200)
    sent = [x for x in posts(CEO) if x["p"] == "/staff/leave" and x["method"] == "POST"]
    body = sent[-1]["body"] if sent else {}
    check("submitted: the body carries no days figure - the server counts", sent and "days" not in body and body.get("day_part") == "full" and body.get("reason") == "Family matters in Melaka" and body.get("start_date") == "2026-09-14", body)
    check("step 3 says it was submitted and where it waits", pg.get_by_test_id("apply-done").is_visible() and "submitted" in pg.get_by_test_id("apply-done").inner_text().lower())
    pg.get_by_role("button", name="Apply for another").click(); pg.wait_for_timeout(400)
    # medical needs the certificate
    pg.get_by_test_id("apply-type").select_option("medical")
    pg.get_by_test_id("apply-start").fill("2026-09-21"); pg.get_by_test_id("apply-end").fill("2026-09-21"); pg.get_by_test_id("apply-reason").fill("Flu, doctor's rest"); pg.wait_for_timeout(900)
    check("L-4: medical leave waits for the certificate", nxt.is_disabled() and "medical certificate" in pg.get_by_test_id("apply-missing").inner_text())
    pg.get_by_test_id("apply-file").set_input_files({"name": "mc.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4\n" + b"0" * 2000}); pg.wait_for_timeout(900)
    up = [x for x in posts(CEO) if x["p"] == "/staff/leave/attachment"]
    check("the certificate uploads as a raw file and shows as a chip", up and up[-1]["name"] == "mc.pdf" and "application/pdf" in (up[-1]["type"] or "") and pg.get_by_test_id("apply-file-chip").is_visible(), up)
    check("...then Review is offered", nxt.is_enabled())
    check("a one-day range offers a half day", pg.get_by_test_id("apply-half-first_half").is_visible())
    pg.get_by_test_id("apply-half-first_half").click(); pg.wait_for_timeout(900)
    check("a first half is 0.5 day", "0.5" in pg.get_by_test_id("apply-days").inner_text(), pg.get_by_test_id("apply-days").inner_text())
    nxt.click(); pg.wait_for_timeout(300); pg.get_by_test_id("apply-submit").click(); pg.wait_for_timeout(1200)
    body = [x for x in posts(CEO) if x["p"] == "/staff/leave" and x["method"] == "POST"][-1]["body"]
    check("...sent as first_half with the certificate's id", body.get("day_part") == "first_half" and body.get("mc_media_id") == 77 and "days" not in body, body)

    # ---------- My Leave ----------
    go(pg, CEO, "mine")
    bal = pg.get_by_test_id("my-balance").inner_text()
    check("My Leave: Annual, Medical and Replacement as available / entitled", all(s in bal for s in ["Annual Leave", "Medical Leave", "Replacement Leave"]) and re.search(r"12\s*/\s*14", bal), bal[:300])
    check("the unpaid types say what they cost, not a balance", "no limit" in pg.get_by_test_id("bal-unpaid").inner_text())
    pg.get_by_role("button", name="View details").click(); pg.wait_for_timeout(900)
    led = pg.get_by_test_id("ledger").inner_text()
    check("View details: the ledger (entitled, adjust, approved, pending, available) and the replacement credits", all(s in led for s in ["Entitled", "Approved", "Pending", "Available", "Replacement credits", "Rest day worked"]), led[:300])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    hist = pg.get_by_test_id("leave-history").inner_text()
    check("Leave History: Request #, Leave type, Period, Days, Status, Last update", all(s in hist.upper() for s in ["REQUEST #", "LEAVE TYPE", "PERIOD", "DAYS", "STATUS", "LAST UPDATE"]), hist[:200])
    pg.get_by_test_id("leave-history").locator("summary").first.click(); pg.wait_for_timeout(300)
    check("the row's further actions sit behind one menu (Print form, Send PDF)", pg.get_by_role("button", name="Print form").first.is_visible() and pg.get_by_role("button", name="Send PDF").first.is_visible())

    # ---------- Team Calendar ----------
    go(pg, CEO, "calendar")
    tt = pg.locator("main").inner_text()
    check("one Team Calendar: Team Leave, Public Holiday, Pending Leave, Today", all(s in tt for s in ["Team Leave", "Public Holiday", "Pending Leave", "Today"]), tt[:300])
    check("beside it: Team Availability and Who's Away by Department", pg.locator("[data-testid=team-availability]:visible").first.is_visible() and pg.get_by_test_id("away-by-dept").is_visible())
    pg.get_by_test_id("cal-by-person").click(); pg.wait_for_timeout(900)
    check("managers may switch the month to the person-by-day strip", pg.get_by_test_id("cal-by-person").get_attribute("aria-pressed") == "true")

    # ---------- Approvals & Management ----------
    go(pg, CEO, "manage")
    tiles = pg.get_by_test_id("mgmt-tiles").inner_text()
    check("Leave Management: pending on you, approved this year, routing needs configuration (no invented 'routes' count)", all(s in tiles for s in ["Pending approvals", "Approved", "Routing needs configuration"]), tiles)
    pol = pg.get_by_test_id("mgmt-policy").inner_text()
    check("Leave Policy & Entitlements from the rules: Annual 14, Medical 14, Replacement earned", "14 days / year" in pol and "Earned from rest days worked" in pol, pol)
    pg.get_by_role("button", name="Manage Policy").click(); pg.wait_for_timeout(900)
    check("Manage Policy opens the entitlement editor in a drawer", pg.get_by_role("dialog").filter(has_text="Leave entitlement").count() >= 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    q = pg.get_by_test_id("approval-queue")
    rows = q.get_by_test_id("queue-row")
    check("the Approval Queue holds what is the CEO's to decide (Siti, step 2 of 2, final) and what needs routing", rows.count() >= 1 and "Siti Nur Hidayah" in q.inner_text() and "Step 2 of 2" in q.inner_text(), q.inner_text()[:300])
    check("...with View, Approve, Reject and Send back", all(q.get_by_role("button", name=n).count() >= 1 for n in ["View", "Approve", "Reject", "Send back"]))
    reg = pg.get_by_role("table", name="Leave — whole company")
    check("the register lists only - no decision buttons on its rows", reg.count() == 1 and reg.get_by_role("button", name=re.compile(r"^(Approve|Reject|Approve now|Final approve|Pre-approve|Mark reviewed)$")).count() == 0)
    q.get_by_test_id("queue-approve").first.click(); pg.wait_for_timeout(900)
    pa = [x for x in posts(CEO) if x["method"] == "PATCH"]
    check("Approve in the queue sends the decision to the one route", pa and pa[-1]["p"] == "/staff/leave/9" and pa[-1]["body"].get("action") == "approve", pa[-1:] if pa else pa)
    q.get_by_test_id("queue-return").first.click(); pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog")
    dlg.locator("textarea, input").first.fill("Please attach the clinic's letter."); pg.wait_for_timeout(200)
    dlg.get_by_role("button").filter(has_text=re.compile("OK|Confirm|Send|Return|Save", re.I)).last.click(); pg.wait_for_timeout(900)
    pa = [x for x in posts(CEO) if x["method"] == "PATCH"]
    check("Send back asks the question and sends a return", pa and pa[-1]["body"].get("action") == "return" and "clinic" in pa[-1]["body"].get("comment", ""), pa[-1:] if pa else pa)
    # the drawer: the attachment, and the override for the owner only
    q.get_by_role("button", name="View").first.click(); pg.wait_for_timeout(900)
    check("the drawer opens the attachment through its gated route", pg.get_by_test_id("leave-attachment").get_attribute("href") == "/api/v1/staff/leave/9/attachment")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    pg.locator("[data-record='leave:7'] button").first.click(); pg.wait_for_timeout(900)
    check("L-12: the owner may decide in the approver's place - in the drawer only", pg.get_by_role("button", name="Approve now").count() == 1)
    check("no page errors (CEO)", not errs, errs[:2])
    c.close()

    # ---------- staff ----------
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, STAFF)
    check("staff see three views - no Approvals & Management", [t.strip() for t in pg.get_by_role("tab").all_inner_texts()][:4] == names[:3], pg.get_by_role("tab").all_inner_texts())
    go(pg, STAFF, "manage")
    check("a view not offered falls back to the Overview - never a blank page", view_of(pg) == "overview" and pg.get_by_test_id("leave-overview4").is_visible(), pg.url)
    check("staff's Overview speaks of their own pending requests", "My Pending Requests" in pg.get_by_test_id("ov-pending").inner_text())
    go(pg, STAFF, "apply")
    pg.get_by_test_id("apply-start").fill("2026-09-21"); pg.get_by_test_id("apply-end").fill("2026-09-22"); pg.wait_for_timeout(900)
    steps = pg.get_by_test_id("route-steps").inner_text()
    check("staff's route before submitting: the COO, then the CEO (final), HR's check information only", "Zulkifli Ops" in steps and "final approval" in steps and "information only" in steps, steps)
    check("no Approve now for anyone but the owner", pg.get_by_role("button", name="Approve now").count() == 0)
    check("no page errors (staff)", not errs, errs[:2])
    c.close()

    # ---------- COO ----------
    c = ctx_for(b, 1440, 1100); pg = c.new_page()
    go(pg, COO, "manage")
    check("the COO has Approvals & Management (the chain reads the company)", view_of(pg) == "manage" and pg.get_by_test_id("approval-queue").is_visible())
    pg.locator("[data-record='leave:7'] button").first.click(); pg.wait_for_timeout(900)
    check("L-12: the COO is never offered the override", pg.get_by_role("button", name="Approve now").count() == 0)
    check("Manage Policy is the entitlement holders' only", pg.get_by_role("button", name="Manage Policy").count() == 0)
    c.close()

    # ---------- widths ----------
    bad = []
    for w in WIDTHS:
        c = ctx_for(b, w); pg = c.new_page()
        for v in ["overview", "apply", "mine", "calendar", "manage"]:
            go(pg, CEO, v, 1800, reset=(v == "overview"))
            if not no_hscroll(pg): bad.append(f"{w}:{v}")
        if w < 768:
            go(pg, CEO, "overview", 1500, reset=False)
            if not pg.get_by_test_id("leave-view-bar").is_visible(): bad.append(f"{w}:no-switch")
        c.close()
    check("eight widths x five views: no sideways page; the phone has the view switch", not bad, bad)
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

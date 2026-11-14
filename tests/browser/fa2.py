"""FINANCIAL ADVISORY 2.0, PHASE 1 (v1.298.0) in a browser - the CEO, 13-11-2026:
"approve as per recommendation, fees switched without waiting for lawyer"
(claude/FINANCIAL-ADVISORY-2.0-BLUEPRINT.md). The source rules are held by
tests/fa2.mjs; the older FA suites (fa-1, fa-2, fa-3) still run. Here:

  v1.299.0 Phase 2: the priority on every case, High priority and Ready for
  authorized submission, the nine case tabs, the case update (one request,
  each part in the history), the management priority override (CEO yes,
  Sales no), 44 px targets in the update form on a phone. Phase 1:
  the six views from the address, Back / Forward; a phone gets the Dashboard's
  view switch with + DSR beside it (44 px), never the tab row; the Overview's
  four figures and one list (next step, who, when); Clients & Cases quick
  filters, counts and today's follow-up (the case's own task); the DSR's two
  columns, the directive's words and the flat / reducing rate; Bank Criteria's
  counts and fallback; Agreements with the fee on and the agreement off; eight
  widths with no sideways page and nothing under the bottom bar.

  v1.302.0 Phase 5: the agreement builder beside its preview (fields from the
  records, the IC masked, a typed IC checked, missing fields listed, the DRAFT
  PDF, e-sign locked); the fee after a recorded disbursement handed to Sales;
  the library (states, hash, legal basis; the CEO publishes, Sales see only
  published versions); phones at 390 / 360.

The fixture answers are invented (tests/browser/fa-fixture.mjs). Servers:
4280 CEO · 4282 Sales & Marketing (FA=1).
"""
from playwright.sync_api import sync_playwright
import json, re, urllib.request

CEO, SALES = 4280, 4282
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def ctx_for(b, w, h=900):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
def go(pg, port, q="", wait=2800):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Financial%20Advisory{q}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None
def posts(port): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/__fixture-status").read())["fa_posts"]

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- desktop: the CEO ----------------
    c = ctx_for(b, 1440, 1100); pg = c.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO)
    check("the Overview opens and its view is in the address", view_of(pg) == "overview", pg.url)
    check("desktop: the tab row, not the phone switch", pg.get_by_test_id("fa-tabs").is_visible() and not pg.get_by_test_id("fa-view-bar").is_visible())
    main = pg.get_by_test_id("fa-panel"); txt = main.inner_text()
    check("Overview: the directive's four figures", all(s in txt for s in ["Active cases", "Cases requiring action", "Management reviews", "Banker responses pending"]) and "Official bank decisions" not in txt, txt[:300])
    al = pg.get_by_test_id("fa-action-list"); rows = al.get_by_test_id("fa-action-row")
    check("Overview: one list to act on, with the review and today's follow-up", rows.count() == 2 and "Management review of the DSR" in al.inner_text() and "Collect the latest payslip" in al.inner_text(), al.inner_text()[:400])
    check("Overview: each row says who and by when", "CEO, COO or CCO" in rows.first.inner_text() and "Fixture Person" in rows.nth(1).inner_text() and "Today" in rows.nth(1).inner_text(), [rows.nth(i).inner_text() for i in range(rows.count())])
    lg = pg.get_by_test_id("fa-legal").inner_text()
    check("Overview: one legal line - agreements and commission off, the fee on after a disbursement", "switched off" in lg and "fee is ON" in lg and "disbursement" in lg, lg)
    check("Overview: no calculator and no directory", pg.get_by_test_id("fa-dsr").count() == 0 and pg.get_by_test_id("fa-registry").count() == 0)
    for name, v in [("DSR Pre-Check", "dsr"), ("Clients & Cases", "clients"), ("Bankers", "bankers"), ("Bank Criteria", "criteria"), ("Agreements", "agreements")]:
        pg.get_by_test_id("fa-tabs").get_by_role("tab", name=re.compile("^" + re.escape(name))).first.click(); pg.wait_for_timeout(800)
        check(f"{name} is its own view in the address", view_of(pg) == v, pg.url)
    pg.go_back(); pg.wait_for_timeout(700)
    check("Back returns to Bank Criteria", view_of(pg) == "criteria", pg.url)
    pg.go_forward(); pg.wait_for_timeout(700)
    check("Forward returns to Agreements", view_of(pg) == "agreements", pg.url)

    # Agreements: the fee on, the agreement off
    fee = pg.get_by_test_id("fa-fee").inner_text(); ag = pg.get_by_test_id("fa-agreements").inner_text()
    check("Agreements: the fee is on by the CEO's decision, rate set on the template, billed after a disbursement", "On - CEO decision 13-11-2026" in fee and "never written in the system's code" in fee and "after a disbursement" in fee, fee[:400])
    check("Agreements: sending and signing stay off", "Sending and signing switched off" in ag, ag[:200])
    check("Agreements: no button sends, signs or bills", pg.get_by_test_id("fa-fee").get_by_role("button").count() == 0 and pg.get_by_test_id("fa-agreements").get_by_role("button").count() == 0)

    # Bank Criteria: counted, and the fallback
    go(pg, CEO, "&view=criteria")
    t = pg.get_by_test_id("fa-panel").inner_text()
    check("a link to Bank Criteria opens it", view_of(pg) == "criteria" and pg.get_by_test_id("fa-criteria").count() == 1)
    check("Criteria: four counts from the records", all(s in t for s in ["Verified rules", "Draft rules", "Need re-check", "Banks covered"]), t[:300])
    fb = pg.get_by_test_id("fa-fallback").inner_text()
    check("Criteria: the seven fallback steps, Unknown never a yes", "Unknown - never a yes" in fb and fb.count("\n") >= 6, fb)

    # Clients & Cases
    go(pg, CEO, "&view=clients")
    q = pg.get_by_test_id("fa-quick")
    check("Cases: the quick filters", all(s in q.inner_text() for s in ["My cases", "All authorized", "Follow-up today", "Waiting for client", "Waiting for banker", "Management review", "Closed / archived"]), q.inner_text())
    rows = pg.get_by_test_id("fa-pipeline").get_by_test_id("fa-case-row")
    check("Cases: every open case is listed, the follow-up today first", rows.count() == 3 and "FA-000003" in rows.first.inner_text(), [rows.nth(i).inner_text()[:40] for i in range(rows.count())])
    q.get_by_role("button", name=re.compile("^Waiting for banker")).click(); pg.wait_for_timeout(300)
    check("Cases: Waiting for banker shows the case under the banker's review", rows.count() == 1 and "FA-000001" in rows.first.inner_text())
    q.get_by_role("button", name=re.compile("^Management review")).click(); pg.wait_for_timeout(300)
    check("Cases: Management review shows the case waiting for a decision", rows.count() == 1 and "FA-000002" in rows.first.inner_text())
    q.get_by_role("button", name=re.compile("^My cases")).click(); pg.wait_for_timeout(300)
    check("Cases: the CEO owns none of the fixture's cases", rows.count() == 0)
    td = pg.get_by_test_id("fa-today").inner_text()
    check("Cases: today's follow-up is the case's own task, with who holds it", "Collect the latest payslip" in td and "Fixture Person" in td and "Today" in td, td)
    box_list = pg.locator("section[aria-label='Client cases']").bounding_box(); box_today = pg.get_by_test_id("fa-today").bounding_box()
    check("Cases: today's follow-ups sit beside the list on a wide screen", box_today["x"] > box_list["x"] + box_list["width"] - 5, (box_list, box_today))

    # DSR: two columns, the words, the flat / reducing rate
    go(pg, CEO, "&view=dsr")
    ws = pg.get_by_test_id("fa-dsr")
    ws.get_by_test_id("dsr-mode-quick").click(); pg.wait_for_timeout(200)
    ws.get_by_test_id("dsr-gross").fill("6500"); ws.get_by_test_id("dsr-epf").fill("715"); ws.get_by_label("Seen on a payslip").check()
    ws.get_by_test_id("dsr-commitment").first.get_by_label("Monthly amount (RM)").fill("1120")
    ws.get_by_test_id("dsr-amount").fill("30000"); ws.get_by_test_id("dsr-rate").fill("7"); pg.wait_for_timeout(1300)
    check("DSR: the rate is flat by default, and the flat instalment is (30,000 + 10,500) / 60 = 675.00", ws.get_by_test_id("dsr-rate-type").input_value() == "flat" and ws.get_by_test_id("dsr-instalment").input_value() == "675.00", ws.get_by_test_id("dsr-instalment").input_value())
    ws.get_by_test_id("dsr-rate-type").select_option("reducing"); pg.wait_for_timeout(1300)
    check("DSR: reducing balance gives the annuity instead (594.04)", ws.get_by_test_id("dsr-instalment").input_value() == "594.04", ws.get_by_test_id("dsr-instalment").input_value())
    pv = [x for x in posts(CEO) if x["path"] == "/staff/fa/preview"]
    check("DSR: the rate type goes to the server's engine", pv and pv[-1]["body"]["proposal"].get("rate_type") == "reducing", pv[-1]["body"] if pv else None)
    res_txt = ws.get_by_test_id("dsr-result").inner_text()
    check("DSR: the result never says Proceed, approved or eligible", not re.search(r"proceed|approv|eligib", res_txt, re.I), res_txt[:400])
    check("DSR: the bank fit snapshot and the missing-evidence block are there", "Bank fit snapshot" in res_txt and ws.get_by_test_id("dsr-missing").count() == 1)
    check("no page error (CEO)", not errs, errs[:2])
    c.close()

    # ---------------- the phone: the Dashboard's view switch ----------------
    c = ctx_for(b, 390, 844); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO)
    check("phone: the view switch is shown and the tab row is not", pg.get_by_test_id("fa-view-bar").is_visible() and not pg.get_by_test_id("fa-tabs").is_visible())
    sw = pg.get_by_test_id("fa-view-bar").get_by_test_id("view-switch")
    check("phone: the switch names the view", "Overview" in sw.inner_text(), sw.inner_text())
    nb = pg.get_by_test_id("fa-new-dsr-phone").bounding_box()
    check("phone: + DSR sits beside the switch, a 44 px target", nb and nb["height"] >= 43.5, nb)
    sw.click(); pg.wait_for_timeout(250)
    items = pg.get_by_role("menuitemradio")
    check("phone: the six views are in the switch", items.count() == 6, items.count())
    pg.get_by_role("menuitemradio", name=re.compile("^Clients & Cases")).click(); pg.wait_for_timeout(800)
    check("phone: picking Clients & Cases opens it, in the address", view_of(pg) == "clients" and "Clients & Cases" in pg.get_by_test_id("fa-view-bar").get_by_test_id("view-switch").inner_text(), pg.url)
    small = pg.evaluate("[...document.querySelectorAll('[data-testid=fa-quick] button')].filter(x => x.getBoundingClientRect().height < 43.5).length")
    check("phone: every quick filter is a 44 px target", small == 0, small)
    pg.get_by_test_id("fa-new-dsr-phone").click(); pg.wait_for_timeout(900)
    check("phone: + DSR opens the DSR Pre-Check at step 1", view_of(pg) == "dsr" and "Step 1 / 5" in pg.get_by_test_id("fa-dsr").inner_text())
    check("no page error (phone)", not errs, errs[:2])
    c.close()

    # Sales: their own cases under My cases
    c = ctx_for(b, 1280); pg = c.new_page(); go(pg, SALES, "&view=clients")
    pg.get_by_test_id("fa-quick").get_by_role("button", name=re.compile("^My cases")).click(); pg.wait_for_timeout(300)
    check("Sales: My cases lists the cases they own", pg.get_by_test_id("fa-pipeline").get_by_test_id("fa-case-row").count() == 3)
    c.close()

    # ---------------- v1.299.0 - Phase 2: priority, the case update, the nine case tabs ----------------
    import datetime
    later = (datetime.datetime.utcnow() + datetime.timedelta(hours=8, days=2)).strftime("%Y-%m-%d")
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO, "&view=clients")
    pr = pg.get_by_test_id("fa-pipeline").get_by_test_id("fa-row-priority")
    check("P2 cases: every open case shows its priority", pr.count() == 3, pr.all_inner_texts())
    q = pg.get_by_test_id("fa-quick")
    check("P2 cases: High priority and Ready for authorized submission are quick filters", "High priority" in q.inner_text() and "Ready for authorized submission" in q.inner_text())
    q.get_by_role("button", name=re.compile("^High priority")).click(); pg.wait_for_timeout(300)
    hp = pg.get_by_test_id("fa-pipeline").get_by_test_id("fa-case-row")
    check("P2 cases: High priority lists the review waiting and today's follow-up, not the Normal case", hp.count() == 2 and "FA-000001" not in pg.get_by_test_id("fa-pipeline").inner_text(), hp.all_inner_texts())
    t5 = pg.get_by_test_id("fa-panel").inner_text()
    check("P2 cases: the photo's five counts", all(s in t5 for s in ["Needs follow-up today", "High priority", "Waiting on client", "Waiting on banker", "Ready to submit"]))
    q.get_by_role("button", name=re.compile("^All authorized")).click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("fa-case-row").filter(has_text="FA-000001").first.click(); pg.wait_for_timeout(1300)
    sheet = pg.get_by_test_id("fa-case")
    tabs = [x.split("\n")[0].strip() for x in sheet.get_by_role("tablist").first.get_by_role("tab").all_inner_texts()]
    want = ["Client profile", "Financial profile", "DSR assessment history", "Banker matching", "Kelayakan notes", "Management decisions", "Documents & agreements", "Follow-ups", "Activity timeline"]
    check("P2 case: the directive's nine tabs, in order", [re.sub(r"\d+$", "", x).strip() for x in tabs] == want, tabs)
    check("P2 case: Client profile keeps the consents", "Privacy notice" in sheet.inner_text() or "privacy" in sheet.inner_text().lower())
    check("P2 case: the header shows the priority", "Priority: Normal" in pg.get_by_test_id("fa-statuses").inner_text(), pg.get_by_test_id("fa-statuses").inner_text())
    sheet.get_by_role("tab", name=re.compile("^Follow-ups")).first.click(); pg.wait_for_timeout(400)
    fm = pg.get_by_test_id("fa-update-form")
    fm.get_by_test_id("fa-update-comment").fill("Fixture: called the client, EPF next week")
    fm.get_by_test_id("fa-update-fu").fill(later)
    check("P2 update: a follow-up without what it is cannot be saved", fm.get_by_test_id("fa-update-save").is_disabled())
    fm.get_by_test_id("fa-update-fu-title").fill("Collect the EPF statement")
    fm.get_by_test_id("fa-update-waiting").select_option("client")
    fm.get_by_test_id("fa-update-next").fill("Run the DSR again with EPF")
    n0 = len(posts(CEO))
    fm.get_by_test_id("fa-update-save").click(); pg.wait_for_timeout(1300)
    sent = [x for x in posts(CEO)[n0:] if x["path"] == "/staff/fa/cases/1/updates"]
    check("P2 update: one request carries the comment, the follow-up, waiting-on and the next action", len(sent) == 1 and sent[0]["body"].get("follow_up_on") == later and sent[0]["body"].get("waiting_on") == "client" and sent[0]["body"].get("comment") and sent[0]["body"].get("next_action"), sent)
    hist = pg.get_by_test_id("fa-updates").inner_text()
    check("P2 update: the history shows each part with its author and time", all(s in hist for s in ["Comment", "Follow-up set", "Waiting on", "Next action", "Fixture Person"]), hist[:400])
    check("P2 update: the follow-up is listed as an open follow-up (a task)", "Collect the EPF statement" in pg.get_by_test_id("fa-followups").inner_text())
    check("P2 update: the header now says waiting for the client", "Waiting for the client" in pg.get_by_test_id("fa-statuses").inner_text())
    sheet.get_by_role("tab", name=re.compile("^Management decisions")).first.click(); pg.wait_for_timeout(400)
    pf = pg.get_by_test_id("fa-priority-form")
    check("P2 priority: the CEO sees the override form, and the computed level with its reasons", pf.count() == 1 and "Worked out from the records" in pg.get_by_test_id("fa-priority-box").inner_text())
    pf.locator("select").select_option("low"); pf.get_by_test_id("fa-priority-reason").fill("short")
    check("P2 priority: a reason under 10 characters cannot be saved", pf.get_by_test_id("fa-priority-save").is_disabled())
    pf.get_by_test_id("fa-priority-reason").fill("Fixture: client asked us to wait until December")
    n0 = len(posts(CEO)); pf.get_by_test_id("fa-priority-save").click(); pg.wait_for_timeout(1200)
    sp = [x for x in posts(CEO)[n0:] if x["path"] == "/staff/fa/cases/1/priority"]
    check("P2 priority: the override is sent with its reason (PUT)", len(sp) == 1 and sp[0]["method"] == "PUT" and sp[0]["body"] == {"priority": "low", "reason": "Fixture: client asked us to wait until December"}, sp)
    st = pg.get_by_test_id("fa-statuses").inner_text()
    check("P2 priority: the header shows the override and who set it; the computed level stays in the box", "Priority: Low" in st and "set by" in st and "Normal" in pg.get_by_test_id("fa-priority-box").inner_text(), st)
    check("no page error (P2 CEO)", not errs, errs[:2])
    c.close()

    c = ctx_for(b, 1280); pg = c.new_page(); go(pg, SALES, "&view=clients")
    pg.get_by_test_id("fa-case-row").filter(has_text="FA-000001").first.click(); pg.wait_for_timeout(1300)
    pg.get_by_test_id("fa-case").get_by_role("tab", name=re.compile("^Management decisions")).first.click(); pg.wait_for_timeout(400)
    check("P2 Sales: no priority override form", pg.get_by_test_id("fa-priority-form").count() == 0 and pg.get_by_test_id("fa-priority-box").count() == 1)
    pg.get_by_test_id("fa-case").get_by_role("tab", name=re.compile("^Follow-ups")).first.click(); pg.wait_for_timeout(400)
    opts = pg.get_by_test_id("fa-update-waiting").locator("option").all_inner_texts()
    check("P2 Sales: cannot pause a case", not any("Paused" in o for o in opts), opts)
    c.close()

    for w in (390, 360):
        c = ctx_for(b, w, 800); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, CEO, "&view=clients")
        pg.get_by_test_id("fa-case-row").filter(has_text="FA-000001").first.click(); pg.wait_for_timeout(1300)
        pg.get_by_test_id("fa-case").get_by_role("tab", name=re.compile("^Follow-ups")).first.click(); pg.wait_for_timeout(400)
        short = pg.evaluate("[...document.querySelectorAll('[data-testid=fa-update-form] button, [data-testid=fa-update-form] select, [data-testid=fa-update-form] input:not([type=checkbox])')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5).map(b => (b.innerText || b.tagName) + ':' + Math.round(b.getBoundingClientRect().height)).slice(0, 6)")
        check(f"P2 phone {w}: the update form's controls are 44 px targets", not short, short)
        check(f"P2 phone {w}: no sideways page in the case sheet", no_hscroll(pg))
        check(f"P2 phone {w}: no page error", not errs, errs[:2])
        c.close()

    # ---------------- v1.300.0 - Phase 3 (photo 3): the directory beside client-to-banker matching ----------------
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO, "&view=bankers")
    bt = pg.get_by_test_id("fa-panel").inner_text()
    check("P3 bankers: the photo's counts (total, ready, on hold, needs verification)", all(s in bt for s in ["Total bankers", "Ready", "On hold", "Needs verification"]), bt[:300])
    d0 = pg.get_by_test_id("fa-directory").bounding_box(); m0 = pg.get_by_test_id("fa-match-panel").bounding_box()
    check("P3 bankers: the directory on the left, client-to-banker matching on the right", d0 and m0 and m0["x"] > d0["x"] + d0["width"] - 5 and abs(m0["y"] - d0["y"]) < 80, (d0, m0))
    rp = pg.get_by_test_id("fa-banker-reply").all_inner_texts()
    check("P3 bankers: a MEASURED reply time, only with enough history - never an estimate", any("~5 h after an enquiry (median of 4)" in x for x in rp) and any("Not enough history (1 of 3" in x for x in rp), rp)
    mp = pg.get_by_test_id("fa-match-panel")
    mp.get_by_test_id("fa-match-case").select_option("1"); pg.wait_for_timeout(1300)
    mt = mp.inner_text()
    check("P3 matching: the case header (client, case type, DSR, banker)", "Fixture Client Satu" in pg.get_by_test_id("fa-match-head").inner_text() and "50.0%" in pg.get_by_test_id("fa-match-head").inner_text())
    check("P3 matching: the case's own banker matching runs here (the one matching screen)", mp.get_by_test_id("fa-matching").count() == 1, mt[:300])
    claims = re.sub(r"never a match percentage or an approval chance\.?", "", mt, flags=re.I)  # the panel's own promise is not a claim
    check("P3 matching: no match percentage and no approval chance anywhere", not re.search(r"\d+\s*%\s*match|approval (rate|chance|success)|probab", claims, re.I), claims[:500])
    picks = pg.get_by_test_id("fa-compare-pick")
    picks.nth(0).check(); picks.nth(1).check(); pg.wait_for_timeout(200)
    pg.get_by_test_id("fa-compare-open").click(); pg.wait_for_timeout(600)
    cmp = pg.get_by_test_id("fa-compare").inner_text() if pg.get_by_test_id("fa-compare").count() else ""
    check("P3 compare: two bankers side by side, registry facts only - no score, no approval rate", "Reply time (measured)" in cmp and "Verification" in cmp and not re.search(r"score|approval rate|\d+\s*% match", cmp, re.I), cmp[:400])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    pg.get_by_test_id("fa-banker").filter(has_text="Banker Satu").first.click(); pg.wait_for_timeout(1000)
    check("P3 bankers: choosing a banker shows the profile on the right", pg.get_by_test_id("fa-banker-record").count() == 1)
    check("no page error (P3 CEO)", not errs, errs[:2])
    c.close()
    for w in (390, 768):
        c = ctx_for(b, w, 844); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, CEO, "&view=bankers")
        check(f"P3 @{w}: matching sits under the directory, no sideways page", pg.get_by_test_id("fa-match-panel").count() == 1 and no_hscroll(pg))
        small = pg.evaluate("[...document.querySelectorAll('[data-testid=fa-compare-pick]')].map(x => x.closest('label').getBoundingClientRect().height).filter(h => h < 43.5).length")
        check(f"P3 @{w}: the compare tick is a 44 px target", w >= 768 or small == 0, small)
        check(f"P3 @{w}: no page error", not errs, errs[:2])
        c.close()

    # ---------------- v1.301.0 - Phase 4 (photo 4): Bank Criteria 2.0 ----------------
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO, "&view=criteria")
    rows = pg.get_by_test_id("fa-criterion")
    states = [x.strip() for x in pg.get_by_test_id("fa-crit-state").all_inner_texts()]
    check("P4: the repository shows each rule's state - Verified, Draft, Indicative", rows.count() == 3 and "Verified" in states and "Draft" in states and any("Indicative" in s for s in states), states)
    ind = rows.filter(has_text="Banker-indicative").first
    it = ind.inner_text() if ind.count() else ""
    check("P4: an indicative rule shows the banker, the day, the channel and their own words", "Fixture Banker Satu" in it and "10-11-2026" in it and "Work phone" in it and "usually accepts up to 70%" in it, it[:300])
    check("P4: an indicative rule offers no Verify (a banker's words are never published as the bank's rule)", ind.get_by_role("button", name="Verify", exact=True).count() == 0)
    check("P4: every rule shows its confidence and who approved or proposed it", all(any(k in x for k in ("High", "Medium", "Low")) for x in rows.all_inner_texts()) and "Approved by Fixture Manager" in pg.get_by_test_id("fa-criteria").inner_text())
    pg.get_by_test_id("fa-crit-filter").select_option("indicative"); pg.wait_for_timeout(200)
    check("P4: the Indicative filter shows only the banker's words", rows.count() == 1 and "Banker-indicative" in rows.first.inner_text())
    pg.get_by_test_id("fa-crit-filter").select_option("live"); pg.wait_for_timeout(200)
    check("P4: the four kinds of criteria are explained", all(s in pg.get_by_test_id("fa-crit-kinds").inner_text() for s in ["internal baseline", "Official bank criteria", "Banker-provided indicative", "Case-specific"]))
    # add an official criterion
    pg.get_by_test_id("fa-crit-add").click(); pg.wait_for_timeout(600)
    fm = pg.get_by_test_id("fa-crit-form")
    fm.get_by_test_id("fa-crit-bank").select_option("1"); fm.get_by_test_id("fa-crit-source").fill("Fixture: product sheet 12-11-2026")
    check("P4 add: a rule without a confidence cannot be saved", fm.get_by_test_id("fa-crit-save").is_disabled())
    fm.get_by_test_id("fa-crit-confidence").select_option("high")
    n0 = len(posts(CEO)); fm.get_by_test_id("fa-crit-save").click(); pg.wait_for_timeout(900)
    sp = [x for x in posts(CEO)[n0:] if x["path"] == "/staff/fa/criteria"]
    check("P4 add: it posts an OFFICIAL draft with its confidence", len(sp) == 1 and sp[0]["body"].get("category") == "official" and sp[0]["body"].get("confidence") == "high" and sp[0]["body"].get("bank_id") == 1, sp)
    # record a banker update
    pg.get_by_test_id("fa-crit-banker-update").click(); pg.wait_for_timeout(600)
    fm = pg.get_by_test_id("fa-crit-form")
    fm.get_by_test_id("fa-crit-bank").select_option("1"); fm.get_by_test_id("fa-crit-source").fill("Fixture: phone call note"); fm.get_by_test_id("fa-crit-confidence").select_option("low")
    check("P4 banker update: needs the banker and their words", fm.get_by_test_id("fa-crit-save").is_disabled())
    fm.get_by_test_id("fa-crit-banker").select_option("1"); fm.get_by_test_id("fa-crit-words").fill("Fixture: prefers six months of statements")
    n0 = len(posts(CEO)); fm.get_by_test_id("fa-crit-save").click(); pg.wait_for_timeout(900)
    sp = [x for x in posts(CEO)[n0:] if x["path"] == "/staff/fa/criteria"]
    check("P4 banker update: it posts a banker-indicative entry with the banker, day, channel and words", len(sp) == 1 and sp[0]["body"].get("category") == "banker_indicative" and sp[0]["body"].get("banker_id") == 1 and sp[0]["body"].get("channel") and sp[0]["body"].get("heard_on") and "six months" in sp[0]["body"].get("exact_feedback", ""), sp)
    # verify the draft from Bank B
    drow = pg.get_by_test_id("fa-criterion").filter(has_text="Fixture Bank B").first
    drow.get_by_role("button", name="Verify", exact=True).click(); pg.wait_for_timeout(300)
    vf = pg.get_by_test_id("fa-crit-verify-form")
    n0 = len(posts(CEO)); vf.get_by_role("button", name="Verify and publish").click(); pg.wait_for_timeout(900)
    sv = [x for x in posts(CEO)[n0:] if x["path"].endswith("/verify")]
    check("P4 verify: management verifies with the day it was confirmed", len(sv) == 1 and sv[0]["path"] == "/staff/fa/criteria/2/verify" and sv[0]["body"].get("last_verified_on"), sv)
    check("no page error (P4 CEO)", not errs, errs[:2])
    c.close()
    c = ctx_for(b, 1280); pg = c.new_page(); go(pg, SALES, "&view=criteria")
    check("P4 Sales: no Verify on any rule", pg.get_by_test_id("fa-criteria").get_by_role("button", name="Verify", exact=True).count() == 0)
    n0 = len(posts(SALES)); pg.get_by_test_id("fa-crit-ask").first.click(); pg.wait_for_timeout(700)
    sr = [x for x in posts(SALES)[n0:] if x["path"].endswith("/request-verification")]
    check("P4 Sales: asks management to verify a draft", len(sr) == 1, sr)
    c.close()
    for w in (390, 360):
        c = ctx_for(b, w, 800); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, CEO, "&view=criteria")
        short = pg.evaluate("[...document.querySelectorAll('[data-testid=fa-criterion] button')].filter(x => x.offsetParent && x.getBoundingClientRect().height < 43.5).length")
        check(f"P4 phone {w}: compact rule cards, 44 px actions, no sideways page", short == 0 and no_hscroll(pg), short)
        check(f"P4 phone {w}: no page error", not errs, errs[:2])
        c.close()

    # ---------------- v1.302.0 - Phase 5 (photo 5): the agreement builder, the fee after a disbursement, the library ----------------
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO, "&view=agreements"); n0 = len(posts(CEO))
    bd = pg.get_by_test_id("fa-agr-builder")
    check("P5: the builder sits beside its preview on a wide screen", bd.is_visible() and pg.get_by_test_id("fa-agr-preview").bounding_box()["x"] > pg.get_by_test_id("fa-agr-case").bounding_box()["x"] + 300)
    pg.get_by_test_id("fa-agr-case").select_option("1"); pg.wait_for_timeout(900)
    vt = pg.get_by_test_id("fa-agr-version").evaluate("s => s.options[s.selectedIndex].text")
    check("P5: the case's published template is chosen for it", "Fixture personal financing agreement v2" in vt and "Published" in vt, vt)
    fl = pg.get_by_test_id("fa-agr-fields").inner_text()
    check("P5: the fields fill from the records - the client, the company, the rate; the IC MASKED", "Fixture Client Satu" in fl and "A2Z CREATIVE MARKETING" in fl and "15.00%" in fl and "••••••-••-5678" in fl and "Masked" in fl, fl[:400])
    pv = pg.get_by_test_id("fa-agr-preview").inner_text()
    check("P5: the preview is the draft - DRAFT watermark, not for signing or sending", "DRAFT" in pv and "Draft - not for signing or sending" in pv and "Fixture Client Satu" in pv, pv[:300])
    tr = pg.get_by_test_id("fa-agr-track").inner_text()
    check("P5: the tracker ends with e-sign switched off", "E-sign: switched off" in tr, tr)
    check("P5: Send for e-sign is locked, with the reason", pg.get_by_test_id("fa-agr-send").is_disabled() and "Locked: sending and signing stay off" in bd.inner_text())
    with pg.expect_download() as dl:
        pg.get_by_test_id("fa-agr-pdf").click()
    path = dl.value.path(); pdf = open(path, "rb").read()
    check("P5: Prepare draft PDF downloads a real PDF with the DRAFT watermark and the IC masked", dl.value.suggested_filename.startswith("DRAFT-FA-000001") and pdf[:5] == b"%PDF-" and b"(DRAFT) Tj" in pdf and b"XXXXXX" in pdf and b"880101" not in pdf, dl.value.suggested_filename)
    rec = [x for x in posts(CEO)[n0:] if x["path"].endswith("/agreement/preview") and x["body"].get("record")]
    check("P5: preparing the PDF records the draft on the case", len(rec) == 1 and rec[0]["body"].get("version_id") == 11, rec)
    pg.get_by_test_id("fa-agr-ic").fill("880101-14-5679"); pg.get_by_test_id("fa-agr-ic-use").click(); pg.wait_for_timeout(900)
    check("P5: a typed IC that is not the client's is refused - the draft stays masked", "••••••-••-5678" in pg.get_by_test_id("fa-agr-fields").inner_text() and "not the one on the client's profile" in pg.locator("body").inner_text())
    pg.get_by_test_id("fa-agr-ic").fill("880101145678"); pg.get_by_test_id("fa-agr-ic-use").click(); pg.wait_for_timeout(900)
    check("P5: the client's own IC, typed for this document, fills it in full", "880101-14-5678" in pg.get_by_test_id("fa-agr-fields").inner_text() and "880101-14-5678" in pg.get_by_test_id("fa-agr-preview").inner_text())
    pg.get_by_test_id("fa-agr-case").select_option("3"); pg.wait_for_timeout(900)
    check("P5: another case forgets the typed IC", pg.get_by_test_id("fa-agr-ic").input_value() == "" and "880101-14-5678" not in pg.get_by_test_id("fa-agr-builder").inner_text())
    ms = pg.get_by_test_id("fa-agr-missing").inner_text()
    check("P5: missing fields are listed and the draft cannot be prepared - nothing invented", "IC number" in ms and "Client email" in ms and "nothing is invented" in ms and pg.get_by_test_id("fa-agr-pdf").is_disabled(), ms)
    check("P5: a missing field shows in the preview, marked", pg.get_by_test_id("fa-agr-preview").locator("mark[data-field=ic_number]").count() == 1)
    pg.get_by_test_id("fa-agr-case").select_option("2"); pg.wait_for_timeout(500)
    check("P5: nothing published for that company and service - nothing chosen for it", pg.get_by_test_id("fa-agr-version").input_value() == "")
    pg.get_by_test_id("fa-agr-version").select_option("12"); pg.wait_for_timeout(900)
    check("P5: management may check a version under review against a case - never prepare from it", "not published - a check only" in bd.inner_text() and pg.get_by_test_id("fa-agr-pdf").is_disabled())
    fr = pg.get_by_test_id("fa-fee-row").first; ft = fr.inner_text()
    opt = fr.locator("select").evaluate("s => s.options[s.selectedIndex].text")
    check("P5 fee: the recorded disbursement with the bank's evidence, and the fee at the published rate (half up)", "RM 33,333.33" in ft and "Bank evidence" in ft and "15.00% = RM 5,000.00" in opt, [ft[:200], opt])
    fr.get_by_test_id("fa-fee-prepare").click(); pg.wait_for_timeout(1500)
    pf = pg.evaluate("localStorage.getItem('azone-qt-prefill')"); fp = [x for x in posts(CEO)[n0:] if x["path"] == "/staff/fa/cases/1/fee"]
    check("P5 fee: Prepare fee quotation hands one fee line to Sales and opens Sales", len(fp) == 1 and fp[0]["body"].get("version_id") == 11 and fp[0]["body"].get("decision_note_id") == 77 and "Sales" in pg.url and (pf is None or '"source":"fa_fee"' in pf), [fp, pg.url, pf])
    go(pg, CEO, "&view=agreements")
    lb = pg.get_by_test_id("fa-agr-library")
    check("P5 library: management adds templates; every version with its state, source hash and legal basis", pg.get_by_test_id("fa-tpl-add").is_visible() and lb.get_by_test_id("fa-tpl-version").count() == 3 and all(s in lb.inner_text() for s in ["Published", "Archived", "Waiting for publishing", "SHA-256 abababababab", "WITHOUT a legal review"]), lb.inner_text()[:500])
    pg.get_by_test_id("fa-tpl-publish").click(); fm = pg.get_by_test_id("fa-tpl-publish-form")
    check("P5 library: publishing names the legal basis", "Reviewed by counsel" in fm.inner_text() and "without a legal review" in fm.inner_text())
    fm.get_by_test_id("fa-tpl-no-review").check()
    check("P5 library: without a legal review, the owner must confirm it", fm.get_by_test_id("fa-tpl-publish-save").is_disabled())
    fm.get_by_test_id("fa-tpl-ack").check(); fm.get_by_test_id("fa-tpl-publish-save").click(); pg.wait_for_timeout(900)
    pp = [x for x in posts(CEO)[n0:] if x["path"].endswith("/12/publish")]
    check("P5 library: the CEO publishes with the basis recorded", len(pp) == 1 and pp[0]["body"] == {"legal_basis": "ceo_without_review", "acknowledge": True}, pp)
    check("no page error (P5 CEO)", not errs, errs[:2])
    c.close()
    c = ctx_for(b, 1280, 1000); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, SALES, "&view=agreements")
    lb = pg.get_by_test_id("fa-agr-library")
    check("P5 Sales: no New template, only the published version, no Publish", pg.get_by_test_id("fa-tpl-add").count() == 0 and lb.get_by_test_id("fa-tpl-version").count() == 1 and pg.get_by_test_id("fa-tpl-publish").count() == 0 and pg.get_by_test_id("fa-tpl-upload").count() == 0, lb.inner_text()[:300])
    pg.get_by_test_id("fa-agr-case").select_option("2"); pg.wait_for_timeout(700)
    check("P5 Sales: a case with no published template is told so", "No published template for this company and service" in pg.get_by_test_id("fa-agr-version").inner_text())
    check("no page error (P5 Sales)", not errs, errs[:2])
    c.close()
    for w in (390, 360):
        c = ctx_for(b, w, 800); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        go(pg, CEO, "&view=agreements"); pg.get_by_test_id("fa-agr-case").select_option("1"); pg.wait_for_timeout(900)
        short = pg.evaluate("[...document.querySelectorAll('[data-testid=fa-agr-builder] button, [data-testid=fa-fee-bills] button, [data-testid=fa-agr-library] button, [data-testid=fa-agr-library] label[class]')].filter(x => x.offsetParent && x.getBoundingClientRect().height < 43.5).map(x => x.innerText)")
        wide = pg.evaluate("[...document.querySelectorAll('[data-testid=fa-fee-row] *, [data-testid=fa-agr-builder] *')].filter(x => !x.closest('[aria-hidden=true]') && x.getBoundingClientRect().right > window.innerWidth + 1).length")
        check(f"P5 phone {w}: builder, preview, fee and library stacked, 44 px actions, nothing past the edge", short == [] and wide == 0 and no_hscroll(pg), [short, wide])
        check(f"P5 phone {w}: the preview follows the fields (one column)", pg.get_by_test_id("fa-agr-preview").bounding_box()["y"] > pg.get_by_test_id("fa-agr-fields").bounding_box()["y"])
        check(f"P5 phone {w}: no page error", not errs, errs[:2])
        c.close()

    for w in WIDTHS:
        for q in ["", "&view=dsr", "&view=clients", "&view=bankers", "&view=criteria", "&view=agreements"]:
            c = ctx_for(b, w); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            go(pg, CEO, q, 2400)
            check(f"ceo @{w} {q or 'overview'}: no sideways page, no error card, no page error",
                  no_hscroll(pg) and "Something went wrong on this screen" not in pg.locator("main").inner_text() and not errs, errs[:1])
            c.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\nfa2: {len(res) - len(failed)}/{len(res)} passed")
if failed: raise SystemExit(1)

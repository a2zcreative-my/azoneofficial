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

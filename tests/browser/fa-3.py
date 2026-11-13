"""v1.288.0 - THE DSR PRE-CHECK in a browser (the CEO, 12-11-2026: DSR blueprint
v1.2, "D1 to D4 proceed as per suggestions, D5 proceed without lawyers"; the
layout from his photo). The rules are proven by direct request in
tests/fa-dsr.mjs; the fixture (tests/browser/fa-fixture.mjs) answers the
pre-check with the real engine (worker/src/fa-engine.ts), so every figure on
these screens is the engine's own. Here:

  - Financial Advisory has the six tabs (Overview, DSR Pre-Check, Clients &
    Cases, Bankers, Bank Criteria, Agreements) and "+ New DSR Assessment";
  - a desktop shows three columns side by side: figures, result, case;
  - Quick Check: no name, IC or phone is asked; what is sent carries none;
    nothing is saved (no figures, assess or case request); unverified income
    gives Information Incomplete; the result is the engine's numbers; the
    instalment is labelled Assumption; never "approved";
  - Client Case: the case's figures load, Save sends one figure set and then
    the assessment; Match a banker opens the case at Banker matching;
  - Management review: the queue on Overview; the COO decides Proceed with a
    reason; Sales sees no decision form;
  - Banker matching: the shortlist, Propose, the CEO approves, the enquiry,
    the documents sent under the consent; Sales cannot approve;
  - the Kelayakan notes filter shows the Management entries, "not a loan
    approval";
  - a phone or tablet: one step at a time with the DSR strip on top; Back and
    Next at least 44 px; no sideways page at any width.
Screenshots: $FA_OUT (default /tmp/fa-shots), outside the repo.
Servers: the fa-1 set (4280 CEO, 4281 COO, 4282 Sales, 4283 CCO), FA=1.
Invented fixture data only."""
import os, json, re, urllib.request
from playwright.sync_api import sync_playwright

CEO, COO, SALES, CCO = 4280, 4281, 4282, 4283
OUT = os.environ.get("FA_OUT", "/tmp/fa-shots"); os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

OUTCOMES = ["Potentially Suitable — Subject to Review", "Management Review Required", "Information Incomplete", "Affordability Concern", "No Suitable Product Currently Identified"]
def posts(port): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/__fixture-status").read())["fa_posts"]
def preview(port, body):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/v1/staff/fa/preview", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    return json.loads(urllib.request.urlopen(req).read())["result"]

def fa_view(pg, long):
    """v1.298.0 - FA 2.0 Phase 1: the tab row on a wide screen, the Dashboard's view switch on a phone"""
    row = pg.get_by_test_id("fa-tabs")
    if row.count() and row.is_visible():
        row.get_by_role("tab", name=re.compile("^" + re.escape(long))).first.click()
    else:
        pg.get_by_test_id("fa-view-bar").get_by_test_id("view-switch").click(); pg.wait_for_timeout(250)
        pg.get_by_role("menuitemradio", name=re.compile("^" + re.escape(long))).first.click()

def open_fa(b, port, w):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": 900 if w >= 768 else 800}, is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Financial%20Advisory"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs
sideways = lambda pg: pg.evaluate("document.scrollingElement.scrollWidth <= window.innerWidth + 1")
visible = lambda loc: loc.count() > 0 and loc.first.is_visible()
def tab(pg, long, short):
    fa_view(pg, long); pg.wait_for_timeout(700)
def case_tab(pg, long, short):
    d = pg.get_by_test_id("fa-case")
    d.get_by_role("tab", name=long).or_(d.get_by_role("tab", name=short, exact=True)).first.click(); pg.wait_for_timeout(600)
def open_case(pg, ref):
    tab(pg, "Clients & Cases", "Cases")
    pg.get_by_test_id("fa-case-row").filter(has_text=ref).first.click(); pg.wait_for_timeout(1200)
def fill_quick(pg, verified):
    ws = pg.get_by_test_id("fa-dsr")
    ws.get_by_test_id("dsr-mode-quick").click(); pg.wait_for_timeout(200)
    ws.get_by_test_id("dsr-gross").fill("5000"); ws.get_by_test_id("dsr-epf").fill("550")
    if verified: ws.get_by_label("Seen on a payslip").check()
    row = ws.get_by_test_id("dsr-commitment").first
    row.get_by_label("Monthly amount (RM)").fill("1000")
    ws.get_by_test_id("dsr-amount").fill("30000"); ws.get_by_test_id("dsr-rate").fill("6")
    pg.wait_for_timeout(1200)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- desktop: the CEO ----------------
    for w in (1440, 1280):
        tag = f"CEO {w}"
        ctx, pg, errs = open_fa(b, CEO, w)
        tabs = pg.get_by_test_id("fa-panel").get_by_role("tablist").first.get_by_role("tab").all_inner_texts()
        want = ["Overview", "DSR Pre-Check", "Clients & Cases", "Bankers", "Bank Criteria", "Agreements"]
        check(f"{tag}: the six tabs, in order", [re.sub(r"\d+$", "", t.split("\n")[0].strip()) for t in tabs] == want, tabs)
        check(f"{tag}: + New DSR Assessment is on the page", pg.get_by_test_id("fa-new-dsr").count() == 1)
        q = pg.get_by_test_id("fa-review-queue")
        check(f"{tag}: Overview lists the case waiting for review (FA-000002)", q.count() == 1 and "FA-000002" in q.inner_text() and "Fixture Client Satu" not in q.inner_text(), q.inner_text() if q.count() else "")
        pg.get_by_test_id("fa-new-dsr").click(); pg.wait_for_timeout(900)
        ws = pg.get_by_test_id("fa-dsr")
        check(f"{tag}: + New DSR Assessment opens the DSR Pre-Check", ws.count() == 1)
        panes = ws.evaluate("w => [...w.children].filter(c => c.tagName === 'SECTION' && c.offsetParent).map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; })")
        # v1.298.0 - FA 2.0 photo 1: the inputs on the left, the result on the right with the case under it
        check(f"{tag}: two columns - figures left; result, then the case, on the right", len(panes) == 3 and panes[0][0] < panes[1][0] and panes[1][0] == panes[2][0] and panes[2][1] > panes[1][1] and abs(panes[0][1] - panes[1][1]) < 4, panes)
        check(f"{tag}: the phone steps and footer are not drawn on a desktop", not ws.get_by_test_id("dsr-next").is_visible())

        # ---- Quick Check ----
        before = len(posts(CEO))
        fill_quick(pg, verified=False)
        out = ws.get_by_test_id("dsr-outcome").inner_text()
        check(f"{tag}: declared (unverified) income reads Information Incomplete, no DSR", "Information Incomplete" in out and ws.get_by_test_id("dsr-current").inner_text().strip() == "—", out)
        ws.get_by_label("Seen on a payslip").check(); pg.wait_for_timeout(1200)
        eng = preview(CEO, {"product": "personal_financing", "items": [{"side": "income", "kind": "gross_salary", "monthly_cents": 500000, "verified": True}, {"side": "deduction", "kind": "epf", "monthly_cents": 55000}, {"side": "commitment", "kind": "personal_financing", "monthly_cents": 100000}], "proposal": {"amount_cents": 3000000, "tenure_months": 60, "rate_bp": 600, "rate_type": "flat"}})
        pct = lambda bp: f"{bp / 100:.1f}%"
        cur, proj = ws.get_by_test_id("dsr-current").inner_text().strip(), ws.get_by_test_id("dsr-projected").inner_text().strip()
        check(f"{tag}: the screen shows the engine's own DSR ({pct(eng['current_dsr_bp'])} now, {pct(eng['projected_dsr_bp'])} projected)", cur == pct(eng["current_dsr_bp"]) and proj == pct(eng["projected_dsr_bp"]), (cur, proj, eng["current_dsr_bp"], eng["projected_dsr_bp"]))
        check(f"{tag}: net income is gross less deductions (4450.00)", ws.get_by_test_id("dsr-net").input_value() == "4450.00", ws.get_by_test_id("dsr-net").input_value())
        check(f"{tag}: the instalment is the engine's ({eng['instalment_cents'] / 100:.2f}) and labelled Assumption", ws.get_by_test_id("dsr-instalment").input_value() == f"{eng['instalment_cents'] / 100:.2f}" and "Assumption" in ws.inner_text())
        res = ws.get_by_test_id("dsr-result").inner_text()
        check(f"{tag}: the outcome is one of the five directive phrases", any(o in res for o in OUTCOMES), res[:300])
        check(f"{tag}: the result never says approved, eligible or a probability", not re.search(r"approv|eligib|probab|chance", res, re.I), res[:500])
        check(f"{tag}: the Fixture Bank A verified rule is compared, no score", "Fixture Bank A" in res and "no score" in res)
        check(f"{tag}: no living cost declared - no residual is invented", "no living cost declared" in res)
        ws.get_by_test_id("dsr-calc").click(); pg.wait_for_timeout(700)
        mine = posts(CEO)[before:]
        pv = [x for x in mine if x["path"] == "/staff/fa/preview"]
        check(f"{tag}: Quick Check asks the server engine (POST /staff/fa/preview)", len(pv) >= 2, [x["path"] for x in mine])
        check(f"{tag}: what is sent carries no name, IC, phone or email", all(not ({"name", "ic", "nric", "phone", "email", "customer", "client", "customer_id"} & set(x["body"].keys())) for x in pv), [list(x["body"].keys()) for x in pv])
        check(f"{tag}: Calculate DSR sends final: true once", sum(1 for x in pv if x["body"].get("final") is True) == 1)
        check(f"{tag}: nothing is saved - no case, figures or assessment request", not [x for x in mine if x["path"] != "/staff/fa/preview"], [x["path"] for x in mine])
        check(f"{tag}: the Quick Check page has no name, IC or phone field", ws.get_by_label(re.compile(r"name|IC|phone", re.I)).count() == 0)
        check(f"{tag}: no sideways page (Quick Check)", sideways(pg))
        pg.screenshot(path=f"{OUT}/dsr-{w}-quick.png", full_page=True)

        # ---- Client Case ----
        ws.get_by_test_id("dsr-mode-case").click(); pg.wait_for_timeout(300)
        ws.get_by_test_id("dsr-case").select_option("1"); pg.wait_for_timeout(1300)
        check(f"{tag}: the case's own figures load (gross 5600.00, commitment 2000.00, lender, last 4)", ws.get_by_test_id("dsr-gross").input_value() == "5600.00" and ws.get_by_test_id("dsr-commitment").first.get_by_label("Monthly amount (RM)").input_value() == "2000.00" and ws.get_by_test_id("dsr-commitment").first.get_by_label("Account last 4 digits").input_value() == "4321")
        cp = ws.get_by_test_id("dsr-case-pane").inner_text()
        check(f"{tag}: the case pane shows the client and the Proceed (not a loan approval)", "Fixture Client Satu" in cp and "not a loan approval" in cp, cp[:400])
        ws.get_by_test_id("dsr-amount").fill("20000"); pg.wait_for_timeout(500)
        n0 = len(posts(CEO))
        ws.get_by_test_id("dsr-save").click(); pg.wait_for_timeout(1300)
        sv = [x for x in posts(CEO)[n0:] if x["path"] != "/staff/fa/preview"]
        check(f"{tag}: Save sends one figure set (PUT figures) and then the assessment", [(x["method"], x["path"]) for x in sv] == [("PUT", "/staff/fa/cases/1/figures"), ("POST", "/staff/fa/cases/1/assess")], [(x["method"], x["path"]) for x in sv])
        fig = sv[0]["body"]["items"] if sv else []
        check(f"{tag}: the figure set keeps each line's id (no duplicate re-entry)", {11, 12, 13, 14} <= {x.get("id") for x in fig}, fig)
        check(f"{tag}: no password, OTP or online-banking field anywhere", ws.get_by_label(re.compile(r"password|otp|pin", re.I)).count() == 0)
        pg.screenshot(path=f"{OUT}/dsr-{w}-case.png", full_page=True)
        match = ws.get_by_test_id("dsr-match")
        check(f"{tag}: Match a banker is open after the Proceed", match.is_enabled())
        match.click(); pg.wait_for_timeout(1400)
        m = pg.get_by_test_id("fa-matching")
        check(f"{tag}: Match a banker opens the case at Banker matching", m.count() >= 1 and m.first.is_visible())

        # ---- Banker matching (the CEO proposes and approves; owner exception, as the server allows) ----
        m.get_by_test_id("fa-match-state").select_option("JOHOR"); m.get_by_test_id("fa-match-run").click(); pg.wait_for_timeout(900)
        sl = m.get_by_test_id("fa-shortlist")
        check(f"{tag}: the shortlist names the verified banker, Ready, with reasons and no score", sl.count() == 1 and "Fixture Banker Satu" in sl.inner_text() and "Ready" in sl.inner_text() and not re.search(r"score|probab|%", sl.inner_text(), re.I), sl.inner_text() if sl.count() else "")
        check(f"{tag}: a banker who is not shortlisted says why", "Identity re-verification is due" in m.first.inner_text() or m.get_by_text("Not shortlisted").count() == 1)
        sl.get_by_test_id("fa-propose").click(); pg.wait_for_timeout(1100)
        a = pg.get_by_test_id("fa-allocation")
        check(f"{tag}: the proposal waits for the CEO/COO", a.count() == 1 and "waiting for CEO/COO" in a.inner_text())
        a.get_by_test_id("fa-approve-allocation").click(); pg.wait_for_timeout(1100)
        a = pg.get_by_test_id("fa-allocation")
        check(f"{tag}: approved with the client's disclosure consent for the bank - Ready", "Ready" in a.inner_text(), a.inner_text())
        pg.get_by_test_id("fa-enquiry-summary").fill("Fixture: asked whether the profile fits the personal financing guideline")
        pg.get_by_test_id("fa-enquiry-send").click(); pg.wait_for_timeout(1100)
        d = pg.get_by_test_id("fa-disclose")
        check(f"{tag}: after the enquiry the documents can be sent, to the work contact, under consent", d.count() == 1 and "disclosure consent" in d.inner_text())
        d.get_by_label(re.compile("payslip")).check(); d.get_by_label("Purpose").fill("Fixture: indicative review")
        d.get_by_test_id("fa-disclose-send").click(); pg.wait_for_timeout(1100)
        ds = [x for x in posts(CEO) if x["path"] == "/staff/fa/cases/1/disclosures"]
        check(f"{tag}: the send records the enquiry, the document and the channel - no recipient typed by staff", len(ds) == 1 and ds[0]["body"].get("document_ids") == [101] and "recipient" not in ds[0]["body"], ds)
        check(f"{tag}: the recorded send shows the banker's registry contact", "satu@fixturebank.test" in pg.get_by_test_id("fa-disclose").inner_text())
        check(f"{tag}: no sideways page (matching)", sideways(pg))
        pg.screenshot(path=f"{OUT}/dsr-{w}-matching.png", full_page=False)
        case_tab(pg, "Kelayakan notes", "Notes")
        pg.get_by_test_id("fa-case").get_by_role("tab", name="Management", exact=True).click(); pg.wait_for_timeout(400)
        mg = pg.get_by_test_id("fa-notes-management")
        check(f"{tag}: the notes filter shows the Management entries only", mg.count() == 1 and pg.get_by_test_id("fa-notes-banker").count() == 0 and "not a loan approval" in mg.inner_text(), mg.inner_text() if mg.count() else "")
        check(f"{tag}: no page error", not errs, errs)
        ctx.close()

    # ---------------- the COO decides the pending review ----------------
    ctx, pg, errs = open_fa(b, COO, 1280)
    q = pg.get_by_test_id("fa-review-queue")
    check("COO: the queue says it waits for your review", q.count() == 1 and "Waiting for your review" in q.inner_text())
    # v1.298.0 - the Overview's one list: the review row opens the case at its DSR assessment
    pg.get_by_test_id("fa-action-row").filter(has_text="FA-000002").first.click(); pg.wait_for_timeout(1400)
    dc = pg.get_by_test_id("fa-decide")
    check("COO: the case opens at the DSR assessment with the decision form", dc.count() == 1 and "never a loan approval" in dc.inner_text())
    save = dc.get_by_test_id("fa-decide-save")
    dc.get_by_test_id("fa-decision-reason").fill("Too short")
    check("COO: a reason under 10 characters cannot be recorded", save.is_disabled())
    dc.get_by_test_id("fa-decision-reason").fill("Fixture: overlap explained, settlement letter on file")
    save.click(); pg.wait_for_timeout(1200)
    pv = [x for x in posts(COO) if x["path"] == "/staff/fa/cases/2/review"]
    check("COO: Proceed is sent as a decision with its reason", len(pv) == 1 and pv[0]["method"] == "PUT" and pv[0]["body"].get("decision") == "proceed", pv)
    hist = pg.get_by_test_id("fa-history").inner_text() if pg.get_by_test_id("fa-history").count() else ""
    check("COO: the history keeps the assessment and its review", "Proceed" in hist, hist[:300])
    check("COO: no page error", not errs, errs)
    ctx.close()

    # ---------------- Sales: no decision, no approval ----------------
    ctx, pg, errs = open_fa(b, SALES, 1280)
    q = pg.get_by_test_id("fa-review-queue")
    check("Sales: the queue reads Waiting for management review", q.count() == 1 and "Waiting for management review" in q.inner_text())
    open_case(pg, "FA-000002"); case_tab(pg, "DSR assessment", "DSR")
    check("Sales: no decision form on a pending review", pg.get_by_test_id("fa-decide").count() == 0)
    check("Sales: no second submission while one waits", pg.get_by_test_id("fa-submit-review").count() == 0)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(600)
    open_case(pg, "FA-000001"); case_tab(pg, "Banker matching", "Bankers")
    m = pg.get_by_test_id("fa-matching")
    m.get_by_test_id("fa-match-state").select_option("JOHOR"); m.get_by_test_id("fa-match-run").click(); pg.wait_for_timeout(900)
    m.get_by_test_id("fa-propose").first.click(); pg.wait_for_timeout(1100)
    check("Sales: can propose, cannot approve the allocation", pg.get_by_test_id("fa-allocation").count() == 1 and pg.get_by_test_id("fa-approve-allocation").count() == 0)
    check("Sales: no page error", not errs, errs)
    ctx.close()

    # ---------------- a phone or tablet: one step at a time ----------------
    for w in (768, 430, 390, 360, 320):
        tag = f"phone {w}" if w < 768 else f"tablet {w}"
        ctx, pg, errs = open_fa(b, SALES, w)
        tab(pg, "DSR Pre-Check", "DSR")
        ws = pg.get_by_test_id("fa-dsr")
        check(f"{tag}: step 1 of 5 with the DSR strip on top", "Step 1 / 5" in ws.inner_text() and "Projected" in ws.inner_text())
        check(f"{tag}: step 1 shows the income, not the commitments or the result", visible(ws.get_by_test_id("dsr-gross")) and not visible(ws.get_by_test_id("dsr-add-commitment")) and not visible(ws.get_by_test_id("dsr-result")))
        nx = ws.get_by_test_id("dsr-next")
        h = nx.bounding_box()["height"] if nx.count() else 0
        check(f"{tag}: Next is at least 44 px tall", h >= 43.5, h)
        ws.get_by_test_id("dsr-mode-quick").click(); ws.get_by_test_id("dsr-gross").fill("5000"); ws.get_by_label("Seen on a payslip").check()
        nx.click(); pg.wait_for_timeout(300)
        check(f"{tag}: step 2 shows the commitments and hides the income", visible(ws.get_by_test_id("dsr-add-commitment")) and not visible(ws.get_by_test_id("dsr-gross")))
        ws.get_by_test_id("dsr-commitment").first.get_by_label("Monthly amount (RM)").fill("1500")
        nx.click(); pg.wait_for_timeout(300); nx.click(); pg.wait_for_timeout(1300)
        check(f"{tag}: step 4 is the result alone", visible(ws.get_by_test_id("dsr-result")) and not visible(ws.get_by_test_id("dsr-amount")))
        check(f"{tag}: the strip carries the current DSR (30.0%)", "30.0%" in ws.inner_text().split("Step")[1][:120] if "Step" in ws.inner_text() else False, ws.inner_text()[:200])
        check(f"{tag}: no sideways page (DSR)", sideways(pg))
        foot = pg.evaluate("(() => { const n = document.querySelector('[data-testid=dsr-next]'); const r = n.getBoundingClientRect(); return r.bottom <= window.innerHeight && r.top >= 0; })()")
        check(f"{tag}: Next stays on the screen", foot)
        pg.screenshot(path=f"{OUT}/dsr-{w}-step4.png", full_page=False)
        nx.click(); pg.wait_for_timeout(300)
        check(f"{tag}: step 5 is the keep-or-clear step", visible(ws.get_by_test_id("dsr-case-pane")) and not visible(ws.get_by_test_id("dsr-result")))
        check(f"{tag}: no page error", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nfa-3: {len(results) - len(failed)}/{len(results)} passed")
if failed: raise SystemExit(1)

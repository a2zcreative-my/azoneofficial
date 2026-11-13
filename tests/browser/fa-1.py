"""v1.284.0 - FINANCIAL ADVISORY in a browser (the CEO, 11-11-2026: "proceed
with Financial Advisory"; claude/FINANCIAL-ADVISORY-BLUEPRINT.md). The rules
are proven by direct request in tests/fa-api.mjs and tests/fa-engine.mjs;
here, the screens, at the seven widths (1440, 1280, 768, 430, 390, 360, 320):

  - the tab is in Revenue for the CEO, COO, CCO and Sales, and not for HR;
  - Overview: four counts, the switched-off list, the disclaimer;
  - the pipeline shows three status chips per case, never one Eligible flag;
  - the case sheet: DSR 40.0% / 50.0% with "Preliminary only", the bank
    match with its checks and "Banker review required" and no score; banker
    feedback reads "Not a bank approval"; the agreement is switched off;
  - the debt-consolidation case shows the three periods;
  - a banker note can only pick feedback words; an official decision needs
    the bank's document (the button stays off without one) and is offered to
    the CEO, COO and CCO only (v1.288.0, D1);
  - a new case with an existing phone offers the existing customer;
  - no sideways page; buttons at least 44 px tall on a phone.
Screenshots: $FA_OUT (default /tmp/fa-shots), outside the repo.

Servers (servers):
    ROLE=ceo OWNER=1 FA=1 node tests/browser/serve.mjs out 4280
    ROLE=coo FA=1 ...4281   ROLE=sales_marketing FA=1 ...4282
    ROLE=cco FA=1 ...4283   ROLE=hr_admin FA=1 ...4284
Invented fixture data only (tests/browser/fa-fixture.mjs)."""
import os, json, re, urllib.request
from playwright.sync_api import sync_playwright

CEO, COO, SALES, CCO, HR = 4280, 4281, 4282, 4283, 4284
WIDTHS = [1440, 1280, 768, 430, 390, 360, 320]
OUT = os.environ.get("FA_OUT", "/tmp/fa-shots"); os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))


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
def short_buttons(pg, scope):
    return pg.evaluate(f"""[...document.querySelectorAll('{scope} button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5 && !b.closest('[role=tablist]')).map(b => b.innerText.trim() + ':' + Math.round(b.getBoundingClientRect().height)).slice(0, 6)""")
def open_case(pg, ref):
    fa_view(pg, "Clients & Cases"); pg.wait_for_timeout(500)
    pg.get_by_test_id("fa-case-row").filter(has_text=ref).first.click(); pg.wait_for_timeout(1200)
    return pg.get_by_test_id("fa-case")

with sync_playwright() as p:
    b = p.chromium.launch()
    for w in WIDTHS:
        tag = f"CEO {w}"
        ctx, pg, errs = open_fa(b, CEO, w)
        panel = pg.get_by_test_id("fa-panel")
        check(f"{tag}: the Financial Advisory panel opens", panel.count() == 1, pg.url)
        txt = panel.inner_text() if panel.count() else ""
        # v1.298.0 - FA 2.0 section 9: the directive's four figures
        check(f"{tag}: four figures (active, requiring action, management reviews, banker responses pending)", all(s in txt for s in ["Active cases", "Cases requiring action", "Management reviews", "Banker responses pending"]), txt[:400])
        # v1.288.0 - the CEO's D5 (12-11-2026) opened sending documents to a banker under the client's consent; the other three stay off
        lg = pg.get_by_test_id("fa-legal").inner_text() if pg.get_by_test_id("fa-legal").count() == 1 else ""
        # v1.298.0 - the CEO switched the fee on (13-11-2026); agreements and commission stay off
        check(f"{tag}: the legal line keeps agreements and commission off and says the fee is on, billed only after a disbursement", all(s in lg for s in ["agreements", "commission", "fee is ON", "disbursement", "No CTOS"]), lg)
        check(f"{tag}: sending documents is no longer listed as off, and says it needs the client's disclosure consent", "Sending client documents" not in lg and "disclosure consent" in lg, lg)
        check(f"{tag}: the disclaimer is on the page", "Indicative only. Subject to official bank approval." in txt and "not affiliated with any bank" in txt)
        check(f"{tag}: no word Eligible or Approved as a status on the overview", "Eligible" not in txt and "Bank Approved" not in txt)
        check(f"{tag}: no sideways page (overview)", sideways(pg))
        spill = pg.evaluate("[...document.querySelectorAll('[data-testid=fa-panel] section')].filter(s => s.scrollWidth > s.clientWidth + 1).map(s => s.getAttribute('aria-label'))")
        check(f"{tag}: no card's content spills into its neighbour", not spill, spill)
        pg.screenshot(path=f"{OUT}/ceo-{w}-overview.png", full_page=True)

        sheet = open_case(pg, "FA-000001")
        st = sheet.inner_text() if sheet.count() else ""
        chips = pg.get_by_test_id("fa-statuses").inner_text() if pg.get_by_test_id("fa-statuses").count() else ""
        check(f"{tag}: three status chips - pre-screen, banker, application", "Potentially suitable" in chips and "Banker: under review" in chips and "Application: not submitted" in chips, chips)
        check(f"{tag}: the DSR reads 40.0% now and 50.0% projected, preliminary", "40.0%" in st and "50.0%" in st and "Preliminary only" in st, st[:500])
        check(f"{tag}: the progress strip keeps the agreement and application behind legal clearance; the fee waits for a disbursement", st.count("needs legal clearance") >= 2 and "after a recorded disbursement" in st, st[:600])
        check(f"{tag}: no sideways page (case sheet)", sideways(pg))
        pg.screenshot(path=f"{OUT}/ceo-{w}-case.png", full_page=False)
        sheet.get_by_role("tab", name="DSR assessment").or_(sheet.get_by_role("tab", name="DSR", exact=True)).first.click(); pg.wait_for_timeout(500)
        mt = pg.get_by_test_id("fa-matches").inner_text() if pg.get_by_test_id("fa-matches").count() else ""
        check(f"{tag}: the bank match shows its checks, the missing EPF statement and Banker review required", "within the 60.0% guideline" in mt and "Missing: EPF statement" in mt and "Banker review required" in mt, mt[:400])
        check(f"{tag}: no score, probability or amount on the match", not any(s in mt.lower().replace("no score", "") for s in ["score", "probab", "eligible amount", "chance"]))
        pg.screenshot(path=f"{OUT}/ceo-{w}-dsr.png", full_page=False)
        pg.get_by_role("tab", name="Kelayakan notes").or_(pg.get_by_role("tab", name="Notes", exact=True)).first.click(); pg.wait_for_timeout(500)
        nb = pg.get_by_test_id("fa-notes-banker").inner_text()
        check(f"{tag}: banker feedback says Not a bank approval", "Not a bank approval." in nb and "Fixture Bank A" in nb, nb[:300])
        check(f"{tag}: the official decision group waits for the bank's written decision", "needs the bank's written decision" in pg.get_by_test_id("fa-notes-decision").inner_text())
        if w in (1440, 390):
            pg.get_by_role("button", name="Add banker feedback").click(); pg.wait_for_timeout(700)
            form = pg.get_by_test_id("fa-note-form")
            opts = form.get_by_label("Indicative assessment").locator("option").all_inner_texts()
            check(f"{tag}: banker feedback offers feedback words only, never approved", len(opts) == 5 and not any("approv" in o.lower() for o in opts), opts)
            # v1.286.0 - the banker and the bank come from the registry, never typed
            check(f"{tag}: the note form has no typed bank - it picks from the registry", form.get_by_test_id("fa-note-banker").count() == 1 and form.get_by_test_id("fa-note-bank").count() == 1)
            form.get_by_test_id("fa-note-banker").select_option("1"); form.get_by_label("Indicative assessment").select_option("documents_required"); form.locator("textarea").fill("Fixture: send the last three payslips.")
            form.get_by_role("button", name="Save note").click(); pg.wait_for_timeout(900)
            posts = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{CEO}/__fixture-status").read())["fa_posts"]
            sent = [x for x in posts if x["path"] == "/staff/fa/cases/1/notes"]
            check(f"{tag}: saving banker feedback posts to the case's notes route as type banker", len(sent) == 1 and sent[0]["method"] == "POST" and sent[0]["body"].get("type") == "banker" and sent[0]["body"].get("status") == "documents_required" and sent[0]["body"].get("banker_id") == 1 and "bank" not in sent[0]["body"], posts)
            check(f"{tag}: the banker status chip follows the feedback", "Banker: documents required" in pg.get_by_test_id("fa-statuses").inner_text())
            pg.get_by_role("button", name="Record official bank decision").click(); pg.wait_for_timeout(500)
            form = pg.get_by_test_id("fa-note-form")
            form.get_by_test_id("fa-note-bank").select_option("1"); form.locator("textarea").fill("Fixture letter says approved.")
            save = form.get_by_role("button", name="Save note")
            check(f"{tag}: an official decision cannot be saved without the bank's document", save.is_disabled())
            pg.get_by_role("button", name="Cancel").click(); pg.wait_for_timeout(200)
        # v1.299.0 - FA 2.0 section 4D: the agreement now sits in Documents & agreements
        pg.get_by_test_id("fa-case").get_by_role("tab", name=re.compile("^(Documents & agreements|Docs)")).first.click(); pg.wait_for_timeout(300)
        ag = pg.get_by_test_id("fa-agreement").inner_text()
        check(f"{tag}: the agreement is switched off; the fee is on by the CEO's decision and nothing is payable before a disbursement", "Switched off" in ag and "ON - CEO decision 13-11-2026" in ag and "Nothing" in ag and "15% PROPOSED" not in ag, ag[:400])
        if w < 500: check(f"{tag}: case sheet buttons at least 44 px on a phone", not short_buttons(pg, "[role=dialog]"), short_buttons(pg, "[role=dialog]"))
        pg.keyboard.press("Escape"); pg.wait_for_timeout(600)

        sheet = open_case(pg, "FA-000002")
        sheet.get_by_role("tab", name="DSR assessment").or_(sheet.get_by_role("tab", name="DSR", exact=True)).first.click(); pg.wait_for_timeout(500)
        cons = pg.get_by_test_id("fa-consolidation").inner_text() if pg.get_by_test_id("fa-consolidation").count() else ""
        check(f"{tag}: debt consolidation shows before / overlap / after (30.8%, 50.8%, 36.7%)", all(s in cons for s in ["A · Before", "B · Overlap", "C · After", "30.8%", "50.8%", "36.7%"]), cons[:400])
        check(f"{tag}: no sideways page (consolidation)", sideways(pg))
        pg.screenshot(path=f"{OUT}/ceo-{w}-consolidation.png", full_page=False)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(600)
        check(f"{tag}: no page error", not errs, errs)
        ctx.close()

    # ---- a new case: the existing phone finds the existing customer ----
    ctx, pg, errs = open_fa(b, CEO, 1280)
    pg.get_by_role("button", name="New case").first.click(); pg.wait_for_timeout(500)
    new = pg.get_by_test_id("fa-new")
    new.locator("input").nth(0).fill("Fixture Somebody"); new.locator("input").nth(1).fill("012-345 6789")
    new.locator("select").nth(1).select_option("a2z")
    new.get_by_role("button", name="Open case").click(); pg.wait_for_timeout(700)
    check("new case: an existing phone offers that customer instead of a second record", pg.get_by_test_id("fa-duplicate").count() == 1 and "Fixture Client Satu" in pg.get_by_test_id("fa-duplicate").inner_text())
    pg.get_by_role("button", name="Open the case on this customer").click(); pg.wait_for_timeout(700)
    check("new case: an open case of the same product is offered instead of a second one", pg.get_by_role("button", name="Open the existing case").count() == 1)
    posts = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{CEO}/__fixture-status").read())["fa_posts"]
    check("new case: the request carries no figures, IC or document", all(set(x["body"].keys()) <= {"product", "issuer_code", "purpose", "customer_id", "new_customer"} for x in posts if x["path"] == "/staff/fa/cases"), posts)
    ctx.close()

    # ---- roles ----
    for port, role in [(COO, "COO"), (CCO, "CCO"), (SALES, "Sales")]:
        for w in (1280, 390):
            ctx, pg, errs = open_fa(b, port, w)
            check(f"{role} {w}: opens Financial Advisory", pg.get_by_test_id("fa-panel").count() == 1)
            open_case(pg, "FA-000001"); pg.get_by_role("tab", name="Kelayakan notes").or_(pg.get_by_role("tab", name="Notes", exact=True)).first.click(); pg.wait_for_timeout(400)
            dec = pg.get_by_role("button", name="Record official bank decision").count()
            # v1.288.0 - D1: the CCO holds fa_decide with the CEO and COO
            check(f"{role} {w}: official decision offered only to management (CEO, COO, CCO)", dec == (1 if role in ("COO", "CCO") else 0))
            check(f"{role} {w}: no sideways page", sideways(pg))
            pg.screenshot(path=f"{OUT}/{role.lower()}-{w}-notes.png", full_page=False)
            check(f"{role} {w}: no page error", not errs, errs)
            ctx.close()
    ctx, pg, errs = open_fa(b, HR, 1280)
    check("HR: the Financial Advisory panel is not drawn", pg.get_by_test_id("fa-panel").count() == 0)
    nav = pg.evaluate("document.body.innerText")
    check("HR: no Financial Advisory in the navigation", "Financial Advisory" not in nav)
    ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nfa-1: {len(results) - len(failed)}/{len(results)} passed")
if failed: raise SystemExit(1)

"""v1.282.0 - SALES PAYMENT VERIFICATION 3.0 in a browser (the CEO, 11-11-2026:
"Proceed" on claude/PAYMENT-VERIFICATION-3.0-BLUEPRINT.md, P1-P9 as
recommended). The rules themselves are proven by direct request in
tests/payment-verify.mjs; here, the screen, for four roles at the seven
widths of the brief (1440, 1280, 768, 430, 390, 360, 320):

  - the title row says Verification: Required; only the owner has Settings,
    and its sheet warns how many reports still wait;
  - four tiles, verified outstanding never less what is pending, the same
    figures on a desktop and a phone;
  - v1.285.0 (the CEO, 12-11-2026): the CEO's own report waits only for the
    CEO - his sheet has the gold Verify and says it is his own sale; no
    evidence review anywhere;
  - one action per invoice: Review payment / View pending payment / Report
    payment / Report remaining payment; settlement and review are two chips;
  - a second report on a fully pending invoice sits behind a warning and a tick;
  - the COO, the CCO and Sales never Verify and never check evidence; the Audit Trail is read by the CEO, COO and CCO, not by Sales;
  - no sideways page, sheet actions on screen and at least 44 px on a phone.
Screenshots: $PAY3_OUT (default /tmp/pay3-shots), outside the repo.

Servers (servers):
    ROLE=ceo OWNER=1 PAYV=1 PAYOWN=1 node tests/browser/serve.mjs out 4270
    ROLE=coo PAYV=1 PAYOWN=1 node tests/browser/serve.mjs out 4271
    ROLE=sales_marketing PAYV=1 PAYOWN=1 node tests/browser/serve.mjs out 4272
    ROLE=cco PAYV=1 PAYOWN=1 node tests/browser/serve.mjs out 4273
Invented people only."""
import os, re, urllib.request
from playwright.sync_api import sync_playwright

CEO, COO, SALES, CCO = 4270, 4271, 4272, 4273
WIDTHS = [1440, 1280, 768, 430, 390, 360, 320]
OUT = os.environ.get("PAY3_OUT", "/tmp/pay3-shots"); os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_pay(b, port, w):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": 900 if w >= 768 else 800}, is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales"); pg.wait_for_timeout(2400)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    sales_view(pg, "Payments", "Payments"); pg.wait_for_timeout(1100)
    return ctx, pg, errs

sideways = lambda pg: pg.evaluate("document.scrollingElement.scrollWidth <= window.innerWidth + 1")
def inside(pg, loc):
    bb = loc.bounding_box(); vh = pg.evaluate("innerHeight"); vw = pg.evaluate("innerWidth")
    return bool(bb) and bb["y"] >= 0 and bb["y"] + bb["height"] <= vh + 1 and bb["x"] >= 0 and bb["x"] + bb["width"] <= vw + 1
def tiles(pg):
    return pg.evaluate("[...document.querySelectorAll('[data-testid=pay-head] ~ * .erp-card, section')].length") and [
        re.sub(r"\s+", " ", t) for t in pg.locator("text=/^RM [0-9,]+\\.[0-9]{2}$/").all_inner_texts()[:3]]
def drawer_for(pg, invoice):
    pg.get_by_test_id("pay-tab-needs").click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("payment-row").filter(has_text=invoice).get_by_role("button").first.click(); pg.wait_for_timeout(1000)
    return pg.get_by_role("dialog").last


def sales_view(pg, wide, short):
    """v1.292.0 (Sales Workspace 4.0) - a Sales view: the tab on a wide screen, the Views selector on a phone"""
    t = pg.get_by_test_id("sales-tabs").get_by_role("tab", name=wide, exact=True)
    if t.count() and t.first.is_visible():
        t.first.click()
    else:
        pg.get_by_test_id("view-switch").filter(visible=True).first.click(); pg.wait_for_timeout(250)
        pg.get_by_role("menuitemradio", name=re.compile("^" + re.escape(short))).first.click()

with sync_playwright() as p:
    b = p.chromium.launch()
    figures = {}
    # ================= the CEO, every width =================
    for w in WIDTHS:
        tag = f"CEO {w}"
        ctx, pg, errs = open_pay(b, CEO, w)
        head = pg.get_by_test_id("pay-head").inner_text()
        check(f"{tag}: the title row says Verification: Required, with the owner's Settings", "Payment Verification" in head and "Verification: Required" in head and pg.get_by_role("button", name="Settings").count() == 1, head)
        check(f"{tag}: no Switch off on the daily page", pg.get_by_role("button", name="Switch off").count() == 0)
        body = pg.inner_text("body")
        check(f"{tag}: the four tiles", all(x in body for x in ["Pending CEO verification", "Verified this month", "Verified outstanding", "Partially paid"]))
        # v1.285.0 (the CEO, 12-11-2026) - no report waits for a second person's evidence check any more
        check(f"{tag}: nothing waits for an independent evidence review", "awaiting independent review" not in body.lower())
        # 501 RM 1,200 + 502 RM 300 + 503 RM 37.50 + (504 RM 1,200 - RM 600 verified) = RM 2,137.50; pending (RM 637.50) never deducted
        check(f"{tag}: verified outstanding is RM 2,137.50 - the RM 637.50 pending is not deducted", "RM 2,137.50" in body and "RM 637.50" in body, body[:600])
        figures[w] = [x for x in ["RM 637.50", "RM 600.00", "RM 2,137.50"] if x in body]
        own = pg.get_by_test_id("payment-row").filter(has_text="INV-AZOO-503")
        check(f"{tag}: the CEO's own report waits only for the CEO", own.count() == 1 and "Pending CEO verification" in own.inner_text(), own.inner_text() if own.count() else "none")
        check(f"{tag}: Sales' report reads Pending CEO verification", "Pending CEO verification" in pg.get_by_test_id("payment-row").filter(has_text="INV-A2Z-501").inner_text())
        check(f"{tag}: no sideways page (Needs)", sideways(pg), pg.evaluate("document.scrollingElement.scrollWidth"))
        pg.screenshot(path=os.path.join(OUT, f"ceo-needs-{w}.png"), full_page=True)
        # Invoice Balances: one action each, two chips
        pg.get_by_test_id("pay-tab-balances").click(); pg.wait_for_timeout(400)
        act = lambda inv: pg.get_by_test_id("inv-row").filter(has_text=inv).get_by_test_id("inv-action")
        kinds = {i: (act(i).get_attribute("data-kind") if act(i).count() else None) for i in ["INV-A2Z-501", "INV-AZOO-502", "INV-AZOO-503", "INV-A2Z-504"]}
        check(f"{tag}: one action per invoice - Review (his own too) / Mark paid / Review / Mark paid (remaining)", kinds == {"INV-A2Z-501": "review", "INV-AZOO-502": "report", "INV-AZOO-503": "review", "INV-A2Z-504": "report_remaining"}, kinds)
        check(f"{tag}: the owner's report action reads Mark paid", act("INV-AZOO-502").inner_text().strip() == "Mark paid", act("INV-AZOO-502").inner_text())
        r504 = pg.get_by_test_id("inv-row").filter(has_text="INV-A2Z-504")
        check(f"{tag}: settlement and review are two chips (Partially paid; Unpaid + Pending CEO verification)", r504.get_by_test_id("inv-settlement").inner_text() == "Partially paid" and pg.get_by_test_id("inv-row").filter(has_text="INV-AZOO-503").get_by_test_id("inv-settlement").inner_text() == "Unpaid" and "Pending CEO verification" in pg.get_by_test_id("inv-row").filter(has_text="INV-AZOO-503").get_by_test_id("inv-review").inner_text())
        if w < 500:
            hb = act("INV-AZOO-502").bounding_box()
            check(f"{tag}: a phone's row action is at least 44 px tall", hb and hb["height"] >= 43.5, hb)
        check(f"{tag}: no sideways page (Balances)", sideways(pg))
        if w in (1440, 1280, 390):
            pg.screenshot(path=os.path.join(OUT, f"ceo-balances-{w}.png"), full_page=True)
        # v1.285.0 - the CEO's own report: he verifies it himself; nobody else checks it
        dlg = drawer_for(pg, "INV-AZOO-503")
        vb = dlg.get_by_test_id("payment-decide").get_by_role("button", name="Verify payment")
        check(f"{tag}: the own-report sheet has the gold Verify at the foot, on screen", vb.count() == 1 and inside(pg, vb))
        check(f"{tag}: ...no lock and no evidence review", dlg.get_by_test_id("verify-locked").count() == 0 and dlg.get_by_test_id("evidence-waiting").count() == 0)
        check(f"{tag}: ...it says whose sale it is", "your own sale" in (dlg.get_by_test_id("own-sale-banner").inner_text() if dlg.get_by_test_id("own-sale-banner").count() else ""))
        check(f"{tag}: ...Ask a question and Reject stay on screen", all(inside(pg, dlg.get_by_test_id("payment-decide").get_by_role("button", name=n)) for n in ["Ask a question", "Reject"]))
        check(f"{tag}: ...the amounts and the receipt", dlg.get_by_test_id("receipt-preview").count() == 1 and dlg.get_by_test_id("payment-outstanding").inner_text() == "RM 37.50")
        tl = dlg.get_by_test_id("payment-timeline").inner_text()
        check(f"{tag}: ...the timeline shows only the CEO ahead", all(x in tl for x in ["CEO verification", "Invoice settlement"]) and "Independent evidence review" not in tl, tl)
        if w < 500:
            bb = dlg.bounding_box()
            check(f"{tag}: the sheet fills the phone", bb and bb["width"] >= w - 2, bb)
        check(f"{tag}: no sideways page (sheet)", sideways(pg))
        if w in (1440, 768, 390, 320):
            pg.screenshot(path=os.path.join(OUT, f"ceo-own-sheet-{w}.png"))
        if w == 1440:
            # a second report on a fully pending invoice: behind a warning and a tick
            dlg.get_by_test_id("report-additional").click(); pg.wait_for_timeout(600)
            sh = pg.get_by_role("dialog").last
            nxt = sh.get_by_role("button", name="Next: proof")
            sh.get_by_label("Bank or payment reference").fill("MBB 99887766")
            sh.get_by_label("Amount received (RM)").fill("10.00")
            check(f"{tag}: Report an additional payment warns, and waits for the tick", sh.get_by_test_id("additional-warning").count() == 1 and nxt.is_disabled())
            sh.get_by_test_id("additional-warning").locator("input[type=checkbox]").check()
            check(f"{tag}: ...then moves on", nxt.is_enabled())
            sh.get_by_role("button", name="Cancel").click(); pg.wait_for_timeout(300)
            if pg.get_by_role("button", name="Discard").count(): pg.get_by_role("button", name="Discard").first.click(); pg.wait_for_timeout(300)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            # Sales' report: Verify at the foot for the CEO
            dlg = drawer_for(pg, "INV-A2Z-501")
            check(f"{tag}: on someone else's report the gold Verify is at the foot", dlg.get_by_test_id("payment-decide").get_by_role("button", name="Verify payment").count() == 1)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
            # the audit trail and the policy sheet
            pg.get_by_test_id("pay-tab-audit").click(); pg.wait_for_timeout(700)
            check(f"{tag}: the Audit Trail lists the payment events", "Payment reported" in pg.get_by_test_id("pay-audit").inner_text())
            pg.get_by_role("button", name="Settings").click(); pg.wait_for_timeout(500)
            ps = pg.get_by_test_id("policy-sheet").inner_text()
            check(f"{tag}: the policy sheet warns that 2 reported payments still wait", "2 reported payments are still waiting" in ps, ps)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        check(f"{tag}: no page errors", not errs, errs)
        ctx.close()
    check("desktop and phone show the same figures", figures[1440] == figures[390] == figures[320] and len(figures[1440]) == 3, figures)

    # ================= the COO, the CCO, Sales =================
    for port, who in [(COO, "COO"), (CCO, "CCO"), (SALES, "Sales")]:
        for w in (1440, 390):
            tag = f"{who} {w}"
            ctx, pg, errs = open_pay(b, port, w)
            check(f"{tag}: no policy Settings", pg.get_by_role("button", name="Settings").count() == 0)
            check(f"{tag}: the tab is Waiting for review, not Needs My Verification", pg.get_by_test_id("pay-tab-needs").inner_text().split("\n")[0].strip() in ("Waiting for review", "Pending"))
            own = pg.get_by_test_id("payment-row").filter(has_text="INV-AZOO-503")
            btn = own.get_by_role("button").first.inner_text().strip()
            check(f"{tag}: the CEO's report is read only (Review)", btn == "Review", btn)
            dlg = drawer_for(pg, "INV-AZOO-503")
            check(f"{tag}: never a Verify button", dlg.get_by_role("button", name="Verify payment").count() == 0)
            check(f"{tag}: no evidence check (the CEO's own payment needs none)", dlg.get_by_role("button", name="Check bank evidence").count() == 0)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
            pg.get_by_test_id("pay-tab-audit").click(); pg.wait_for_timeout(700)
            au = pg.get_by_test_id("pay-audit").inner_text()
            check(f"{tag}: the Audit Trail {'is read' if who != 'Sales' else 'is not available to Sales'}", ("Payment reported" in au) if who != "Sales" else ("not available" in au), au[:200])
            check(f"{tag}: no sideways page", sideways(pg))
            if w == 390:
                pg.get_by_test_id("pay-tab-needs").click(); pg.wait_for_timeout(300)
                pg.screenshot(path=os.path.join(OUT, f"{who.lower()}-needs-{w}.png"), full_page=True)
            check(f"{tag}: no page errors", not errs, errs)
            ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\npayments-3: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

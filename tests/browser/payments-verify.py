"""v1.272.0 - Sales -> Payments on screen (the CEO, 10-11-2026: "build it";
claude/PAYMENT-VERIFICATION-AUDIT.md, answers P1-P9 as recommended).

What the server decides is proven by direct request in tests/payment-verify.mjs.
Here: the Payments tab, the four tiles, Record payment with its proof (the
report is posted, then the proof), no verify button for a salesperson, the
CEO's review drawer (proof, bank account of the invoice's company, the code,
Verify), the timeline, Reject with a reason, the owner's switch; and on a
phone: no sideways page, the sheet and the drawer full screen, their
buttons on screen.

Servers (servers):
    ROLE=sales_marketing PAYV=1 node tests/browser/serve.mjs out 4261
    ROLE=ceo OWNER=1 PAYV=1 node tests/browser/serve.mjs out 4262
Invented people only."""
import json, os, tempfile, urllib.request
from playwright.sync_api import sync_playwright

SALES, CEO = 4261, 4262
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def state(port):
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/__payments").read())

def open_page(b, port, w=1440, h=1000):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    pg.get_by_role("tab", name="Payments", exact=True).first.click(); pg.wait_for_timeout(1200)
    return ctx, pg, errs

def no_sideways(pg):
    return pg.evaluate("document.scrollingElement.scrollWidth <= window.innerWidth + 1")

def on_screen(pg, loc):
    bb = loc.bounding_box()
    vh = pg.evaluate("window.innerHeight"); vw = pg.evaluate("window.innerWidth")
    return bool(bb) and bb["y"] >= 0 and bb["y"] + bb["height"] <= vh + 1 and bb["x"] >= 0 and bb["x"] + bb["width"] <= vw + 1

png = os.path.join(tempfile.mkdtemp(), "slip.png")
with open(os.path.join(os.path.dirname(__file__), "..", "..", "public", "icon-192.png"), "rb") as src, open(png, "wb") as dst:
    dst.write(src.read())

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(1440, 1000, "desktop"), (402, 874, "phone")]:
        # ---------- the salesperson reports a payment ----------
        ctx, pg, errs = open_page(b, SALES, w, h)
        body = pg.inner_text("body")
        check(f"{tag}: the Payments tab shows the switch On and the four tiles", "Payment verification" in body and "Pending CEO verification" in body and "Verified this month" in body and "Verified outstanding" in body and "Partially paid" in body, body[:400])
        check(f"{tag}: a salesperson has no switch button", pg.get_by_role("button", name="Switch off").count() == 0)
        check(f"{tag}: the open invoices list the A2Z and AZ ONE invoices", "INV-A2Z-501" in body and "INV-AZOO-502" in body)
        check(f"{tag}: no sideways page", no_sideways(pg))
        pg.get_by_role("button", name="Record payment").first.click(); pg.wait_for_timeout(700)
        sheet = pg.get_by_role("dialog").last
        check(f"{tag}: the sheet says the report is not counted until the CEO verifies it", "not counted as received until the CEO verifies it" in sheet.inner_text())
        send_btn = sheet.get_by_role("button", name="Report payment")
        check(f"{tag}: Report payment waits for a reference and the proof", send_btn.is_disabled())
        sheet.get_by_label("Amount received (RM)").fill("300.00")
        sheet.get_by_label("Bank or payment reference").fill("MBB 241104 7788")
        sheet.locator("input[type=file]").set_input_files(png)
        pg.wait_for_timeout(300)
        check(f"{tag}: Report payment is on screen in the sheet", on_screen(pg, send_btn), send_btn.bounding_box())
        send_btn.click(); pg.wait_for_timeout(1500)
        posts = state(SALES)["posts"]
        rep = [x for x in posts if x["path"] == "/staff/docs/501/payment-reports"]
        check(f"{tag}: the report is posted in sen with the method and reference", rep and rep[-1]["body"].get("amount_cents") == 30000 and rep[-1]["body"].get("reference") == "MBB 241104 7788" and rep[-1]["body"].get("method") == "bank_transfer", posts)
        check(f"{tag}: ...then its proof", any(x["path"].endswith("/proof") for x in posts), posts)
        body = pg.inner_text("body")
        check(f"{tag}: the toast says it waits for the CEO", "waiting for the CEO" in body, body[-300:])
        pg.get_by_role("button", name="View").first.click(); pg.wait_for_timeout(900)
        dlg = pg.get_by_role("dialog").last
        check(f"{tag}: a salesperson is never offered Verify", dlg.get_by_role("button", name="Verify payment").count() == 0)
        # v1.282.0 - the photo's words: Verified, Reported · waiting, Outstanding (after verify)
        check(f"{tag}: the drawer shows verified, reported-and-waiting and outstanding", all(x in dlg.inner_text() for x in ["Verified", "Reported · waiting", "Outstanding"]))
        check(f"{tag}: no page errors (sales)", not errs, errs)
        ctx.close()

        # ---------- the CEO verifies ----------
        ctx, pg, errs = open_page(b, CEO, w, h)
        check(f"{tag}: the owner sees Switch off", pg.get_by_role("button", name="Switch off").count() == 1)
        row = pg.get_by_test_id("payment-row").first
        check(f"{tag}: the reported payment waits for review", "Awaiting CEO verification" in row.inner_text() and "Review" in row.inner_text(), row.inner_text())
        row.get_by_role("button", name="Review").click(); pg.wait_for_timeout(900)
        dlg = pg.get_by_role("dialog").last
        check(f"{tag}: the drawer offers the proof", dlg.get_by_role("button", name="View proof").count() >= 1)
        dlg.get_by_role("button", name="Verify payment").first.click(); pg.wait_for_timeout(400)
        form = dlg.get_by_test_id("payment-action")
        sel = form.get_by_label("Received in account")
        check(f"{tag}: the invoice's company account is chosen; the other company's is disabled", sel.input_value() == "1" and form.locator("option[value='2']").evaluate("e => e.disabled") is True, sel.input_value())
        go = form.get_by_role("button", name="Verify payment")
        check(f"{tag}: Verify waits for the authenticator code", go.is_disabled())
        form.get_by_label("Authenticator code").fill("123456")
        go.scroll_into_view_if_needed()
        check(f"{tag}: Verify is on screen", on_screen(pg, go), go.bounding_box())
        go.click(); pg.wait_for_timeout(1300)
        s = state(CEO)
        v = [x for x in s["posts"] if x["path"] == "/staff/payment-reports/1/verify"]
        check(f"{tag}: verify posts the account, method, amount and code", v and v[-1]["body"].get("bank_id") == 1 and v[-1]["body"].get("verify_method") == "bank_statement" and v[-1]["body"].get("amount_cents") == 60000 and v[-1]["body"].get("totp") == "123456", v)
        dlg = pg.get_by_role("dialog").last
        txt = dlg.inner_text()
        check(f"{tag}: the payment shows Verified by CEO and the invoice Partially paid", "Verified by CEO" in txt and "Partially paid" in txt, txt[:500])
        tl = dlg.get_by_test_id("payment-timeline")
        check(f"{tag}: the timeline shows reported, proof, verified, outstanding", all(x in tl.inner_text() for x in ["Payment reported", "Proof uploaded", "CEO verified payment", "Outstanding updated"]), tl.inner_text()[:400])
        check(f"{tag}: Reverse is offered on a verified payment", dlg.get_by_role("button", name="Reverse").count() == 1)
        if tag == "phone":
            check(f"{tag}: the drawer fills the screen", (dlg.bounding_box() or {}).get("width", 0) >= w - 2, dlg.bounding_box())
        check(f"{tag}: no sideways page (CEO)", no_sideways(pg))
        check(f"{tag}: no page errors (CEO)", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\npayments-verify: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

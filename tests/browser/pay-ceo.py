"""v1.285.0 - THE CEO'S PAID IS FINAL, AND SAYS WHOSE SALE IT IS (the CEO,
12-11-2026: "COO and CCO able to click paid and verify by me (CEO). If I
update the paid status, no further verification are required since I am a
CEO!" and "need to know that when I click paid it is behalf of someone or it
is belong to my own sales"). The rules are proven by direct request in
tests/payment-verify.mjs; here, the screen, desktop and phone:

  - the owner's action reads Mark paid; the sheet asks for the account the
    money landed in and his code; proof is optional for him;
  - before he confirms, it says whose sale it is: "This is Aina Seller's
    sale - you are marking it paid on their behalf" or "This is your own sale";
  - it sends the report and his own verification, and the invoice is Paid;
    the timeline says "on behalf of Aina Seller";
  - the COO's action reads Request paid, and its sheet says the CEO verifies it;
  - the CCO's Sales list offers Request paid too.
Servers (servers):
    ROLE=ceo OWNER=1 PAYV=1 CEOPAY=1 node tests/browser/serve.mjs out 4274
    ROLE=coo PAYV=1 CEOPAY=1 node tests/browser/serve.mjs out 4275
    ROLE=cco PAYV=1 PAYDOCS=1 node tests/browser/serve.mjs out 4276
Invented people only."""
import json, re, urllib.request
from playwright.sync_api import sync_playwright

CEO, COO, CCO = 4274, 4275, 4276
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_pay(b, port, w):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": 900 if not phone else 800}, is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales"); pg.wait_for_timeout(2400)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    sales_view(pg, "Payments", "Payments"); pg.wait_for_timeout(1100)
    pg.get_by_test_id("pay-tab-balances").click(); pg.wait_for_timeout(400)
    return ctx, pg, errs

sideways = lambda pg: pg.evaluate("document.scrollingElement.scrollWidth <= window.innerWidth + 1")
act = lambda pg, inv: pg.get_by_test_id("inv-row").filter(has_text=inv).get_by_test_id("inv-action")


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
    for w in (1440, 390):
        tag = f"CEO {w}"
        ctx, pg, errs = open_pay(b, CEO, w)
        a = act(pg, "INV-A2Z-506")
        check(f"{tag}: the owner's action on Aina's invoice reads Mark paid", a.count() == 1 and a.inner_text().strip() == "Mark paid", a.inner_text() if a.count() else "none")
        a.click(); pg.wait_for_timeout(700)
        sh = pg.get_by_role("dialog").last
        check(f"{tag}: the sheet is Mark paid - INV-A2Z-506", "Mark paid - INV-A2Z-506" in sh.inner_text(), sh.inner_text()[:160])
        sh.get_by_label("Bank or payment reference").fill("MBB 50601")
        acct = sh.get_by_label("Received in account")
        check(f"{tag}: the A2Z account is chosen for an A2Z invoice", acct.count() == 1 and acct.input_value() == "1", acct.input_value() if acct.count() else "none")
        sh.get_by_role("button", name="Next: proof").click(); pg.wait_for_timeout(300)
        nx = sh.get_by_role("button", name=re.compile(r"^Next: review"))
        check(f"{tag}: proof is optional for the owner", nx.count() == 1 and nx.is_enabled() and "no proof" in nx.inner_text())
        nx.click(); pg.wait_for_timeout(300)
        ban = sh.get_by_test_id("sale-banner")
        check(f"{tag}: before he confirms, it says it is Aina's sale, on her behalf", ban.count() == 1 and "Aina Seller's sale" in ban.inner_text() and "on their behalf" in ban.inner_text(), ban.inner_text() if ban.count() else "none")
        send = sh.get_by_test_id("record-send")
        check(f"{tag}: the button reads Mark paid and waits for the code", send.inner_text().strip() == "Mark paid" and send.is_disabled())
        check(f"{tag}: it says the Paid is final", "Your Paid is final" in sh.inner_text())
        sh.get_by_label("Authenticator code").fill("123456")
        check(f"{tag}: no sideways page (sheet)", sideways(pg))
        if w < 500:
            bb = send.bounding_box()
            check(f"{tag}: the Mark paid button is on screen and at least 44 px", bb and bb["height"] >= 43.5 and bb["y"] + bb["height"] <= 801, bb)
        send.click(); pg.wait_for_timeout(1200)
        state = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{CEO}/__payments").read())
        posts = [x["path"] for x in state["posts"]]
        inv506 = next((i for i in state["invoices"] if i["id"] == 506), None)
        check(f"{tag}: it sent the report, then his own verification", any(x.endswith("/docs/506/payment-reports") for x in posts) and any(re.search(r"/payment-reports/\d+/verify$", x) for x in posts), posts)
        check(f"{tag}: INV-A2Z-506 is Paid", inv506 and inv506["paid"] is True, inv506)
        verified_ev = [e for e in state["events"] if e["event"] == "verified" and e["invoice_id"] == 506]
        check(f"{tag}: the record says it was on behalf of Aina", verified_ev and json.loads(verified_ev[0]["detail"]).get("salesperson") == "Aina Seller")
        # own sale: INV-AZOO-502 belongs to the signed-in person
        act(pg, "INV-AZOO-502").click(); pg.wait_for_timeout(700)
        sh = pg.get_by_role("dialog").last
        sh.get_by_label("Bank or payment reference").fill("MBB 50201")
        sh.get_by_role("button", name="Next: proof").click(); pg.wait_for_timeout(300)
        sh.get_by_role("button", name=re.compile(r"^Next: review")).click(); pg.wait_for_timeout(300)
        ban = sh.get_by_test_id("sale-banner")
        check(f"{tag}: on his own invoice it says This is your own sale", ban.count() == 1 and "This is your own sale" in ban.inner_text(), ban.inner_text() if ban.count() else "none")
        check(f"{tag}: no page errors", not errs, errs)
        ctx.close()

    # the COO: Request paid, waits for the CEO
    for w in (1440, 390):
        tag = f"COO {w}"
        ctx, pg, errs = open_pay(b, COO, w)
        a = act(pg, "INV-A2Z-506")
        check(f"{tag}: the COO's action reads Request paid", a.count() == 1 and a.inner_text().strip() == "Request paid", a.inner_text() if a.count() else "none")
        a.click(); pg.wait_for_timeout(700)
        sh = pg.get_by_role("dialog").last
        check(f"{tag}: the sheet is Request paid, with no account and no code", "Request paid - INV-A2Z-506" in sh.inner_text() and sh.get_by_label("Received in account").count() == 0 and sh.get_by_label("Authenticator code").count() == 0)
        check(f"{tag}: no page errors", not errs, errs)
        ctx.close()

    # the CCO: the Sales list offers Request paid (verification on)
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    urllib.request.urlopen(f"http://127.0.0.1:{CCO}/__reset").read()
    pg.goto(f"http://127.0.0.1:{CCO}/portal?tab=Sales"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    sales_view(pg, "Quotations & Invoices", "Documents"); pg.wait_for_timeout(1500)
    r = pg.locator("[role='row']:has-text('INV-AZO050926-3')").first
    btn = r.get_by_test_id("pv-record")
    check("CCO: the Sales list offers Request paid", btn.count() == 1 and btn.inner_text().strip() == "Request paid", btn.inner_text() if btn.count() else r.inner_text()[:200])
    check("CCO: no Paid dropdown", r.locator("select").count() == 0)
    check("CCO: no page errors", not errs, errs)
    ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\npay-ceo: {len(results) - len(failed)}/{len(results)} passed")
if failed: raise SystemExit(1)

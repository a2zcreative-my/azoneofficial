"""A LEAD'S QUOTATIONS AND INVOICES, LINKED (v1.406.0, the CEO 21-11-2026: "all this have their own Quotation and
Invoice, link it!") - in a browser.

  Lead     its quotations and invoices, each with where it stands (Invoiced as / Paid / Expired / Open), each opening
           the document in Quotations & Invoices; the deal one is on opens the deal
  Link     a manager sees how many quotations are on no deal and Link quotations: one drawer, grouped Invoiced (Won
           deals on their invoice) / Open / Expired; invoiced and open start ticked, expired never
  Others   a consultant does not link; phones: no sideways page

Servers: ROLE=ceo 4177 · ROLE=sales_marketing 4182   (node tests/browser/serve.mjs out <port>)
"""
from playwright.sync_api import sync_playwright
import os

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, SALES = 4177, 4182
SHOTS = os.environ.get("SHOTS", "/tmp/lead-docs-shots"); os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_lead(b, port, w=1440, h=1000):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    ctx.add_init_script("try{localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang','en')}catch(e){}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales&view=customers"); pg.wait_for_timeout(4500)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    pg.get_by_test_id("lead-row").first.click(); pg.wait_for_timeout(1500)
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    ctx, pg, errs = open_lead(b, CEO)
    docs = pg.get_by_test_id("lead-docs").filter(visible=True).first
    txt = docs.inner_text() if docs.count() else ""
    check("the lead lists its quotations and invoices, counted", docs.count() == 1 and "Quotations & invoices (3 · 1)" in txt, txt[:200])
    check("each says where it stands", all(s in txt for s in ["Invoiced as INV-0037", "Paid", "Expired", "Open"]), txt)
    check("…and what it is, and when", "Quotation" in txt and "Invoice" in txt)
    check("a quotation on a deal opens that deal", docs.get_by_test_id("lead-doc-deal").count() == 1)
    hint = pg.get_by_test_id("lead-link-hint").filter(visible=True)
    check("a manager is told how many quotations are on no deal", hint.count() == 1 and "2 quotations are on no deal yet" in hint.first.inner_text(), hint.first.inner_text() if hint.count() else "")
    pg.screenshot(path=f"{SHOTS}/01-lead-docs-1440.png", full_page=False)
    pg.get_by_test_id("lead-link-quotes").filter(visible=True).first.click(); pg.wait_for_timeout(1500)
    inv = pg.get_by_test_id("deal-suggest-group-invoiced"); exp = pg.get_by_test_id("deal-suggest-group-expired")
    check("Link quotations opens this lead's quotations only, grouped", inv.count() == 1 and exp.count() == 1 and pg.get_by_test_id("deal-suggest-row").count() == 2
          and "Aina Boutique" not in pg.get_by_test_id("deal-suggest-list").first.inner_text())
    check("an invoiced quotation becomes a Won deal on its invoice", "QT-0036 → INV-0037" in inv.inner_text() and "Won" in inv.inner_text() and "Won deals" in inv.inner_text())
    check("invoiced starts ticked, expired never", pg.get_by_test_id("deal-suggest-36").is_checked() and not pg.get_by_test_id("deal-suggest-33").is_checked())
    check("the drawer says won is never revenue", "never revenue" in pg.locator("body").inner_text())
    pg.screenshot(path=f"{SHOTS}/02-link-quotations-1440.png", full_page=False)
    pg.get_by_test_id("deal-suggest-reason").fill("Link the lead's history")
    check("Make 1 deal is ready once the reason is written", not pg.get_by_test_id("deal-suggest-confirm").is_disabled() and "Make 1 deal" in pg.get_by_test_id("deal-suggest-confirm").inner_text())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    if pg.get_by_role("button", name="Discard").count(): pg.get_by_role("button", name="Discard").first.click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("lead-doc-open").filter(has_text="QT-0042").first.click(); pg.wait_for_timeout(1500)
    check("a document opens in Quotations & Invoices", "view=documents" in pg.url, pg.url)
    check("no page errors (CEO)", not errs, errs)
    ctx.close()

    ctx, pg, errs = open_lead(b, SALES)
    check("a consultant sees the documents, but does not link", pg.get_by_test_id("lead-docs").filter(visible=True).count() == 1 and pg.get_by_test_id("lead-link-quotes").count() == 0)
    check("no page errors (consultant)", not errs, errs)
    ctx.close()

    ctx, pg, errs = open_lead(b, CEO, 390, 844)
    check("phone: no sideways page with the lead open", no_hscroll(pg))
    pg.screenshot(path=f"{SHOTS}/03-phone-lead-390.png", full_page=True)
    check("no page errors (phone)", not errs, errs)
    ctx.close()
    b.close()

ok = sum(1 for _, c in res if c)
print(f"\nlead-docs: {ok}/{len(res)} passed")
raise SystemExit(0 if ok == len(res) else 1)

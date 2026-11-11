"""v1.278.0 - the CEO, 11-11-2026: "paid seem doesnt change the status on
sales for COO".

Cause: with payment verification ON (1.272.0) nobody marks an invoice paid -
it becomes paid when the CEO verifies payments up to its total - but the
Sales documents list still offered the COO the Paid dropdown, the server
refused it (409), and the toast only said "try again".

Here, in a browser, as the COO:
  verification ON  - the invoice row shows where its money stands (Partially
                     paid, RM 3,000 verified) instead of the dropdown, and its
                     Record payment button opens Payments with that invoice's
                     Record payment sheet; a paid invoice says Paid;
  verification OFF - the dropdown is still there, as before.
The server's refusal itself is proven in tests/payment-verify.mjs.

Servers (servers):
    ROLE=coo PAYV=1 PAYDOCS=1 node tests/browser/serve.mjs out 4266
    ROLE=coo node tests/browser/serve.mjs out 4267
Invented people only."""
import re
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_docs(b, port, w, h):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    pg.get_by_role("tab", name=re.compile(r"^(Quotations & Invoices|Documents)$")).first.click(); pg.wait_for_timeout(1500)
    return ctx, pg, errs

def row(pg, number):
    return pg.locator(f"[role='row']:has-text('{number}')").first

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(1440, 1000, "desktop"), (402, 874, "phone")]:
        ctx, pg, errs = open_docs(b, 4266, w, h)
        r = row(pg, "INV-AZO050926-3")
        check(f"{tag}: verification on - the COO is not offered a Paid dropdown that the server refuses", r.locator("select").count() == 0, r.inner_text()[:200])
        st = r.get_by_test_id("pv-status")
        check(f"{tag}: ...the row says where the money stands: Partially paid, RM 3,000.00 verified", st.count() == 1 and "Partially paid" in st.inner_text() and "3,000.00" in st.inner_text(), st.inner_text() if st.count() else "none")
        paid = row(pg, "INV-AZO100926-2")
        check(f"{tag}: ...a paid invoice says Paid", "Paid" in paid.inner_text() and paid.locator("select").count() == 0)
        btn = r.get_by_test_id("pv-record")
        # v1.282.0 (Payment Verification 3.0) - RM 3,000 of RM 9,900 verified, nothing pending: Report remaining payment
        check(f"{tag}: ...and offers Report remaining payment", btn.count() == 1 and btn.inner_text().strip() == "Report remaining payment", btn.inner_text() if btn.count() else "none")
        btn.scroll_into_view_if_needed(); btn.click(); pg.wait_for_timeout(1500)
        dlg = pg.get_by_role("dialog").last
        check(f"{tag}: Report remaining payment opens Payments with that invoice's sheet",
              pg.get_by_role("tab", name="Payments", exact=True).first.get_attribute("aria-selected") == "true" and dlg.count() == 1 and "Report payment - INV-AZO050926-3" in dlg.inner_text(),
              dlg.inner_text()[:200] if dlg.count() else "no dialog")
        check(f"{tag}: ...the sheet still asks for the reference (then the proof) before it moves on (the 1.272.0 rules)", dlg.get_by_role("button", name="Next: proof").count() == 1 and dlg.get_by_role("button", name="Next: proof").is_disabled())
        dlg.get_by_role("button", name="Close").first.click(); pg.wait_for_timeout(500)
        check(f"{tag}: ...and closes", pg.get_by_role("dialog").filter(has_text="Report payment - INV-AZO050926-3").count() == 0)
        check(f"{tag}: no sideways page", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
        check(f"{tag}: no page errors (on)", not errs, errs)
        ctx.close()

        ctx, pg, errs = open_docs(b, 4267, w, h)
        r = row(pg, "INV-AZO050926-3")
        sel = r.locator("select")
        check(f"{tag}: verification off - the COO keeps the Paid dropdown, as before", sel.count() == 1 and "paid" in sel.evaluate("e => [...e.options].map(o => o.value).join()"))
        check(f"{tag}: ...and no verification state is drawn", r.get_by_test_id("pv-status").count() == 0)
        check(f"{tag}: no page errors (off)", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\npaid-status: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

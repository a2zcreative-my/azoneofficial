"""RELEASE B OF THE GO-LIVE PLAN (v1.242.0) - the client side, in a browser.

B2  an unpaid invoice offers Void (with a reason), never Delete; a paid one
    offers neither; a voided row stays, struck through, chip "Void", no
    payment pick; the convert button is busy until the answer and a double
    press sends ONE request; a second conversion is told "Already invoiced".
C1  a returned loan shows no Edit / Revert.
D-6 the locked matrix cells carry the lock tag and no switch in edit mode.

Servers (tests/browser/serve.mjs on a production build in out/):
    ROLE=ceo SLOW_CONVERT=1500    node tests/browser/serve.mjs out 4204
    OWNER=1 ROLE=ceo              node tests/browser/serve.mjs out 4191

    xvfb-run -a python3 tests/browser/release-b.py
"""
from playwright.sync_api import sync_playwright
import json, re, sys

S = "/home/claude/work"
res = []
def check(n, c, x=""): res.append(("PASS " if c else "FAIL ") + n + (f" — {x}" if x and not c else ""))

def page(b, port, path="/portal", w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(2500)
    return pg, errs, reqs

def tab(pg, name):
    btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count() == 0:
        m = pg.get_by_role("button", name="More").filter(visible=True)
        if m.count(): m.first.click(); pg.wait_for_timeout(500)
        btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count(): btn.first.click(); pg.wait_for_timeout(1800); return True
    return False

def row(pg, number): return pg.locator(f"[role='row']:has-text('{number}')").first

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- B2: Sales -> Quotations & Invoices ----------------
    pg, errs, reqs = page(b, 4204)
    check("Sales opens", tab(pg, "Sales"))
    pg.get_by_role("tab", name="Quotations & Invoices", exact=True).first.click(); pg.wait_for_timeout(1500)
    unpaid = row(pg, "INV-AZO050926-3"); paid = row(pg, "INV-AZO100926-2"); qt = row(pg, "QT-AZO150926-1")
    check("an UNPAID invoice offers Void and not Delete", unpaid.get_by_role("button", name="Void", exact=True).count() == 1 and unpaid.get_by_role("button", name="Delete", exact=True).count() == 0)
    check("a PAID invoice offers neither Void nor Delete", paid.get_by_role("button", name="Void", exact=True).count() == 0 and paid.get_by_role("button", name="Delete", exact=True).count() == 0)
    check("a quotation still offers Delete", qt.get_by_role("button", name="Delete", exact=True).count() == 1)
    # void with too short a reason -> the server refuses, nothing changes
    unpaid.get_by_role("button", name="Void", exact=True).click(); pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog").filter(has_text="Void INV-AZO050926-3")
    check("Void asks for a reason, says the row stays and the quotation reopens", dlg.count() == 1 and "struck through" in dlg.inner_text() and "open to invoice again" in dlg.inner_text())
    dlg.get_by_label(re.compile("Reason")).fill("too short")
    dlg.get_by_role("button", name="Void invoice", exact=True).click(); pg.wait_for_timeout(1200)
    check("a 9-character reason is refused by the server and said so", "at least 10 characters" in pg.inner_text("body"))
    voids = lambda: [r for r in reqs if r[0] == "POST" and r[1].endswith("/docs/3/void")]
    check("one POST /void was sent for it", len(voids()) == 1 and json.loads(voids()[0][2])["reason"] == "too short")
    # a proper void
    unpaid.get_by_role("button", name="Void", exact=True).click(); pg.wait_for_timeout(400)
    dlg = pg.get_by_role("dialog").filter(has_text="Void INV-AZO050926-3")
    dlg.get_by_label(re.compile("Reason")).fill("Raised by mistake, the customer cancelled the order")
    dlg.get_by_role("button", name="Void invoice", exact=True).click(); pg.wait_for_timeout(2000)
    body = pg.inner_text("body")
    check("the toast says Voided and that it stays on record", "Voided" in body and "stays on record" in body)
    unpaid = row(pg, "INV-AZO050926-3")
    check("after the reload the row is still there, marked void (struck through), with the Void chip", unpaid.count() == 1 and unpaid.get_attribute("data-void") == "1" and unpaid.locator(".erp-chip", has_text="Void").count() >= 1)
    check("a voided row has no payment pick, no Void, no Edit and no Delete - PDF stays", unpaid.get_by_role("combobox").count() == 0 and unpaid.get_by_role("button", name="Void", exact=True).count() == 0 and unpaid.get_by_role("button", name="Edit", exact=True).count() == 0 and unpaid.get_by_role("button", name="Delete", exact=True).count() == 0 and unpaid.get_by_role("button", name="PDF", exact=True).count() == 1)
    struck = unpaid.locator("span[role='cell']").first.evaluate("e => getComputedStyle(e).textDecorationLine")
    check("the number cell is struck through", "line-through" in struck, struck)
    pg.screenshot(path=f"{S}/rb-void.png")
    # convert: busy until the answer, one request for a double press
    conv = qt.get_by_role("button", name=re.compile("Invoice"))
    check("the quotation offers -> Invoice", conv.count() == 1)
    box = conv.bounding_box()
    pg.mouse.dblclick(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)  # two presses, as fast as a finger
    pg.wait_for_timeout(300)
    converts = lambda: [r for r in reqs if r[0] == "POST" and r[1].endswith("/docs/1/convert")]
    busy = qt.get_by_role("button", name=re.compile("Invoicing"))
    check("while the answer is pending the button is busy and says Invoicing…", busy.count() == 1 and busy.is_disabled())
    check("a double press sent ONE convert request", len(converts()) == 1, str(len(converts())))
    pg.wait_for_timeout(2500)
    check("the toast says Saved with the new number", "INV-AZOO311026-9" in pg.inner_text("body"))
    qt = row(pg, "QT-AZO150926-1")
    check("the quotation now reads Invoiced and offers no second click", "Invoiced" in qt.inner_text() and qt.get_by_role("button", name=re.compile("^→ Invoice")).count() == 0)
    check("no page errors", not errs, str(errs)[:200])
    pg.screenshot(path=f"{S}/rb-converted.png")
    pg.context.close()

    # ---------------- C1: a returned loan is closed ----------------
    pg, errs, reqs = page(b, 4204)
    check("Inventory opens", tab(pg, "Inventory"))
    pg.get_by_role("tab", name="Stock In & Out", exact=True).first.click(); pg.wait_for_timeout(1500)
    pg.get_by_role("button", name=re.compile("Show records")).first.click(); pg.wait_for_timeout(800)
    rowOf = lambda text: pg.locator("span.erp-row-actions").filter(has_text=re.compile(".")).locator("xpath=..").filter(has_text=text).first
    closed = rowOf("02-09-2026 · ELFIA002 · −3")
    openLoan = rowOf("12-09-2026 · ELFIA001 · −2")
    check("the returned loan says ✓ returned and offers neither Edit nor Revert", closed.count() == 1 and "returned" in closed.inner_text() and closed.get_by_role("button", name="Edit", exact=True).count() == 0 and closed.get_by_role("button", name=re.compile("Revert")).count() == 0, closed.inner_text()[:160] if closed.count() else "no row")
    check("an open loan still offers Edit and Revert", openLoan.count() == 1 and openLoan.get_by_role("button", name="Edit", exact=True).count() == 1 and openLoan.get_by_role("button", name=re.compile("Revert")).count() == 1)
    pg.screenshot(path=f"{S}/rb-loan.png")
    pg.context.close()

    # ---------------- D-6: locked cells in the matrix ----------------
    pg, errs, reqs = page(b, 4191)
    check("Users opens (the owner)", tab(pg, "Users"))
    pg.get_by_role("tab", name="Roles & Permissions", exact=True).first.click(); pg.wait_for_timeout(1500)
    card = pg.locator("[aria-label='Access policy matrix']")
    card.get_by_role("button", name="Edit matrix").click(); pg.wait_for_timeout(600)
    tbl = pg.get_by_role("table", name="Permissions by module and role")
    t = tbl.inner_text()
    check("the two super-admin-only rows carry the lock tag", t.count("Locked: super admin only") == 2, str(t.count("Locked: super admin only")))
    check("in edit mode the owner cell has no switch for the CEO", tbl.get_by_role("switch", name=re.compile(r"^CEO - Name the company owner")).count() == 0 and tbl.get_by_role("switch", name=re.compile(r"^CEO - Download the database backup")).count() == 0)
    check("while an ordinary cell still has one", tbl.get_by_role("switch", name=re.compile(r"^COO - Mark paid")).count() == 1)
    pg.screenshot(path=f"{S}/rb-locks.png")
    check("no page errors", not errs, str(errs)[:200])
    pg.context.close()
    b.close()

for r in res: print(r)
fails = [r for r in res if r.startswith("FAIL")]
print(f"\n{len(res) - len(fails)} of {len(res)} passed")
sys.exit(1 if fails else 0)

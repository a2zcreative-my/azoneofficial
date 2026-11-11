"""v1.248.0 - Signatures & Stamps on screen, and task start dates.

Servers (servers.txt): ROLE=ceo on 4177 (day one: nothing switched on),
ROLE=ceo SIGN=1 on 4219, ROLE=coo SIGN=1 on 4220, ROLE=sales_marketing SIGN=1
on 4221 (A2Z signs personally, its stamp on file, quotation 1 waiting for the
CEO's approval)."""
import re
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def page(b, port, w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}/portal"); pg.wait_for_timeout(2500)
    return ctx, pg, errs, reqs

def tab(pg, name):
    btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count() == 0:
        m = pg.get_by_role("button", name="More").filter(visible=True)
        if m.count(): m.first.click(); pg.wait_for_timeout(500)
        btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count(): btn.first.click(); pg.wait_for_timeout(1800); return True
    return False

def signing_tab(pg):
    # v1.251.0 - Signatures & Stamps moved from Users to Companies > Document & Signing
    if not tab(pg, "Companies"): return False
    t = pg.get_by_role("tab", name="Document & Signing", exact=True)
    if t.count() == 0: return False
    t.first.click(); pg.wait_for_timeout(1500); return True

def open_quotation(pg):
    tab(pg, "Sales")
    pg.get_by_role("tab", name=re.compile(r"^(Quotations & Invoices|Documents)$")).first.click(); pg.wait_for_timeout(1500)
    btn = pg.locator("[role='row']:has-text('QT-AZO150926-1')").first.get_by_test_id("open-quotation")
    if btn.count() != 1: return False
    btn.click(); pg.wait_for_timeout(2200)
    ov = pg.get_by_test_id("quotation-page").get_by_role("tab", name="Overview", exact=True)
    if ov.count(): ov.first.click(); pg.wait_for_timeout(1200)
    return True

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- day one: nothing switched on ----
    ctx, pg, errs, reqs = page(b, 4177)
    check("the CEO has Document & Signing under Companies (moved from Users, v1.251.0)", signing_tab(pg))
    panel = pg.get_by_test_id("signing-panel")
    txt = panel.inner_text() if panel.count() else ""
    check("day one: both companies print as today (personal signing off), no approval limit", "Off - documents print as today" in txt and "Not required - no approval limit is set in Sales" in txt, txt[:300])
    check("the screen says a scanned signature is a visual mark, not a digital certificate", "visual mark, not a digital certificate" in txt)
    check("the CEO can turn personal signing on", panel.get_by_role("button", name="Turn personal signing on").count() == 1)
    check("no page errors (day one)", not errs, errs)
    ctx.close()

    # ---- the CEO, A2Z signing personally ----
    ctx, pg, errs, reqs = page(b, 4219)
    signing_tab(pg)
    panel = pg.get_by_test_id("signing-panel")
    txt = panel.inner_text()
    check("A2Z: personal signing on, stamp on quotations, the approval limit from Sales", "On - documents carry the preparer's own signature" in txt and "Quotations" in txt and "Above RM 5,000.00" in txt, txt[:400])
    check("A2Z's stamp is on file and can be replaced", "Version 1" in txt and panel.get_by_role("button", name="Replace stamp").count() == 1)
    aisyah = pg.get_by_test_id("signer-9002")
    check("Nur Aisyah: active signature, prepares quotations and delivery orders", aisyah.count() == 1 and "Active" in aisyah.inner_text() and "Quotations, Delivery orders" in aisyah.inner_text(), aisyah.inner_text() if aisyah.count() else "")
    farid = pg.get_by_test_id("signer-9003")
    check("a signature its person confirmed waits for the CEO, with Approve signature", farid.count() == 1 and "Waiting for the CEO" in farid.inner_text() and farid.get_by_role("button", name="Approve signature").count() == 1)
    pg.get_by_role("tab", name="AZ ONE OFFICIAL").click(); pg.wait_for_timeout(600)
    txt2 = panel.inner_text()
    check("AZ ONE: its own stamp card says none - it never borrows A2Z's", "No stamp uploaded for this company" in txt2 and "Off - documents print as today" in txt2, txt2[:300])
    pg.get_by_role("tab", name="A2Z CREATIVE MARKETING").click(); pg.wait_for_timeout(400)
    reqs.clear()
    farid.get_by_role("button", name="Approve signature").click(); pg.wait_for_timeout(900)
    sent = [r for r in reqs if r[0] == "POST" and "/staff/signing/assets/23/approve" in r[1]]
    check("Approve signature asks the CEO's code (the request goes, the server asks for the code)", len(sent) >= 1, [r[1] for r in reqs])
    dlg = pg.get_by_role("dialog")
    if dlg.count(): pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("no page errors (CEO, signing)", not errs, errs)

    # the quotation page: Approve and sign
    open_quotation(pg)
    card = pg.get_by_test_id("doc-signing")
    ct = card.inner_text() if card.count() else ""
    check("the quotation page says who prepared it, that approval is required, and that it is not issued", "Nur Aisyah binti Rahman" in ct and "Required - not yet approved" in ct and "Not yet - fixed at the first share" in ct, ct[:300])
    check("it says plainly it is a draft until approved", "Waiting for management approval" in ct)
    check("the CEO (with approval authority) sees Approve and sign", card.get_by_role("button", name="Approve and sign").count() == 1)
    reqs.clear()
    card.get_by_role("button", name="Approve and sign").click(); pg.wait_for_timeout(900)
    check("Approve and sign goes to the ONE approval route", any(r[0] == "POST" and r[1].endswith("/staff/docs/1/approve") for r in reqs), [r[1] for r in reqs][-5:])
    if pg.get_by_role("dialog").count(): pg.keyboard.press("Escape")
    ctx.close()

    # Profile: my signature waiting for my confirmation
    ctx, pg, errs, reqs = page(b, 4219)
    tab(pg, "Profile")
    st = pg.get_by_role("tab", name="Security & Account", exact=True)
    if st.count(): st.first.click(); pg.wait_for_timeout(1200)
    my = pg.get_by_test_id("my-signature")
    mt = my.inner_text() if my.count() else ""
    check("Profile shows My signature, waiting for me, with a confirm button", "Waiting for the person" in mt and my.get_by_role("button", name="This is my signature - confirm").count() == 1, mt[:300])
    check("it lists what I may sign", "Approves · A2Z CREATIVE MARKETING · Quotations" in mt, mt[-200:])
    check("no page errors (Profile)", not errs, errs)
    ctx.close()

    # ---- the COO: read only ----
    ctx, pg, errs, reqs = page(b, 4220)
    check("the COO sees the tab", signing_tab(pg))
    panel = pg.get_by_test_id("signing-panel")
    check("...read only: no upload, approve or grant buttons", "Read only - the CEO manages" in panel.inner_text() and panel.get_by_role("button", name=re.compile("Register|Replace|Approve|Allow|Turn")).count() == 0)
    ctx.close()

    # ---- a salesperson ----
    ctx, pg, errs, reqs = page(b, 4221)
    has_co = tab(pg, "Companies")
    check("a salesperson has no Document & Signing view", not has_co or pg.get_by_role("tab", name="Document & Signing").count() == 0)
    open_quotation(pg)
    card = pg.get_by_test_id("doc-signing")
    check("a salesperson sees the signatures on her quotation but no Approve button", card.count() == 1 and card.get_by_role("button", name="Approve and sign").count() == 0)
    check("no page errors (sales)", not errs, errs)
    ctx.close()

    # ---- phone: the panel fits ----
    ctx, pg, errs, reqs = page(b, 4219, 390, 844)
    signing_tab(pg)
    check("on a phone Document & Signing fits the screen", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    ctx.close()

    # ---- task dates ----
    ctx, pg, errs, reqs = page(b, 4177)
    tab(pg, "Tasks")
    pg.get_by_role("tab", name="All Tasks", exact=True).first.click(); pg.wait_for_timeout(1200)
    body = pg.locator("main").inner_text()
    check("the task list's column is Dates, with a start date beside the due date", "Dates" in body and re.search(r"Start \d{2}-\d{2}-\d{4}", body) is not None and re.search(r"(Due|was due) \d{2}-\d{2}-\d{4}", body) is not None, body[:200])
    pg.get_by_role("button", name="Create Task").first.click(); pg.wait_for_timeout(900)
    check("Create Task asks for a start date and a due date", pg.get_by_text("Start date (optional)").count() >= 1 and pg.get_by_text("Due date (optional)").count() >= 1)
    check("no page errors (tasks)", not errs, errs)
    ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"signing: {passed} of {len(results)} passed")

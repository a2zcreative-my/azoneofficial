"""v1.310.0 - CLAIMS WORKSPACE 4.0, on screen (the CEO, 15-11-2026: "approve
as recommended", C-0 ... C-13 in claude/CLAIMS-WORKSPACE-4.0-BLUEPRINT.md;
references 1 Overview, 2 Submit Claim, 3 My Claims).

What the server decides is proven by direct request in tests/claims4.mjs.
Here: the five views in the address (Back / Forward, a view a person does not
have falls back to the Overview), the Overview's five figures with approval
and payment apart, Claims by Category, Requires Attention and Recent Claims;
Submit Claim in three steps beside My Claim Info and Required Documents (the
receipt asked for at Attachments, not for mileage only; the review; one
submission with the receipt sent to the new claim); My Claims holding only
one's own claims with the stages left to right; Approvals with Ready for
payment and the register, never one's own claim; the override asking for
its reason (C-3); the COO deciding and paying the CEO's own claim (C-1);
Reports by claim date and by bank date with each payment's Finance status;
and eight widths with no sideways page.

Servers (servers.txt): 4310 ROLE=ceo OWNER=1, 4311 ROLE=sales_marketing,
4312 ROLE=coo. The browser clock is fixed at 16-09-2026, the fixture's month.
Invented people only."""
from playwright.sync_api import sync_playwright
import re, json, urllib.parse, datetime

CEO, STAFF, COO = 4310, 4311, 4312
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
NOW = datetime.datetime(2026, 9, 16, 4, 0, 0, tzinfo=datetime.timezone.utc)

def page(b, w=1440, h=1100):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.clock.set_fixed_time(NOW)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data, r.headers.get("content-type"))))
    return ctx, pg, errs, reqs
def go(pg, port, view="overview", wait=2600):
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Claims&view={view}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None
def posts(reqs, path):
    out = []
    for m, u, d, t in reqs:
        if m == "POST" and urllib.parse.urlparse(u).path.endswith(path):
            try: out.append(json.loads(d or "{}") if (t or "").startswith("application/json") else {"_raw": True, "type": t})
            except Exception: out.append({})
    return out
def visible(pg, sel):
    return pg.locator(sel).filter(visible=True)
def tile(pg, label):
    t = pg.locator("main").get_by_text(label, exact=True).filter(visible=True).first
    return t.locator("xpath=ancestor::*[self::button or self::div][1]/..").inner_text()

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------- the CEO: Overview ----------
    ctx, pg, errs, reqs = page(b)
    go(pg, CEO)
    names = ["Overview", "Submit Claim", "My Claims", "Approvals", "Reports & Payments"]
    check("C-0: five views, in the references' order", [t.strip() for t in pg.get_by_role("tab").all_inner_texts()][:5] == names, pg.get_by_role("tab").all_inner_texts())
    check("the Overview is in the address", view_of(pg) == "overview", pg.url)
    kpi = pg.locator("main").inner_text()
    check("ref 1: Total Claims, Pending Approval, Approved, Paid, Rejected", all(s in kpi for s in ["Total Claims", "Pending Approval", "Approved", "Paid", "Rejected"]))
    check("the month by claim date: total RM 525.30 = pending 274.30 + approved 62.00 + paid 189.00", all(s in kpi for s in ["RM 525.30", "RM 274.30", "RM 62.00", "RM 189.00"]) and "1 awaiting payment" in kpi, kpi[:500])
    cat = pg.get_by_test_id("claims-by-category")
    check("Claims by Category: a donut of the month's lines with their share", cat.count() == 1 and "Travel" in cat.inner_text() and "%" in cat.inner_text(), cat.inner_text()[:200] if cat.count() else "")
    att = pg.get_by_test_id("claims-attention")
    keys = [x.get_attribute("data-attention") for x in att.locator("[data-attention]").all()]
    check("Requires Attention: waiting for your approval, ready for payment, the missing receipt, the question", keys[:4] == ["waiting", "pay", "receipt", "returned"], keys)
    check("...waiting for the CEO: one claim (the COO's), RM 130.00 - never his own", "1 · RM 130.00" in att.inner_text(), att.inner_text()[:300])
    check("Recent Claims lists the latest claims with approval and payment apart", "Recent Claims" in kpi and "Payment due" in kpi and "Paid 06-09-2026" in kpi)
    # a figure opens what it counts
    pg.locator("main").get_by_text("Pending Approval", exact=True).filter(visible=True).first.click(); pg.wait_for_timeout(900)
    check("the Pending Approval figure opens Approvals on All pending", view_of(pg) == "approvals" and pg.get_by_role("button", name="All pending (3)").get_attribute("aria-pressed") == "true", pg.url)
    # Back / Forward
    pg.get_by_role("tab", name="My Claims", exact=True).first.click(); pg.wait_for_timeout(600)
    pg.go_back(); pg.wait_for_timeout(700)
    check("Back returns to Approvals", view_of(pg) == "approvals", pg.url)
    pg.go_forward(); pg.wait_for_timeout(700)
    check("Forward to My Claims", view_of(pg) == "mine", pg.url)

    # ---------- My Claims (ref 3) ----------
    cards = pg.get_by_test_id("my-claims")
    recs = [x.get_attribute("data-record") for x in cards.locator("[data-record]").all()]
    check("C-4: My Claims holds the CEO's own claim only - nobody else's", recs == ["claim:13"], recs)
    tr = cards.get_by_test_id("claim-track").first
    states = [li.get_attribute("data-state") for li in tr.locator("li").all()]
    check("the stages left to right from the server: submitted, returned at the COO's approval, payment to come", states == ["done", "returned", "todo"] and "Approval - COO" in tr.inner_text(), [states, tr.inner_text()])
    ct = cards.inner_text()
    check("the card says what it waits on, the missing receipt and the question", all(s in ct for s in ["Waiting on the claimant", "Receipt missing", "Question waiting for you"]), ct[:300])
    check("...and its own buttons: View, Attach receipt, Edit, Delete, Print form", all(cards.get_by_role("button", name=n_).count() >= 1 for n_ in ["View", "Edit", "Delete", "Print form"]) and "Attach receipt" in ct)
    check("C-1: no Approve, Reject or Mark paid on one's own claim", not any(re.match(r"^(Approve|Reject|Mark paid)", t.strip()) for t in cards.locator("button").all_inner_texts()))

    # ---------- Approvals ----------
    pg.get_by_role("tab", name="Approvals", exact=True).first.click(); pg.wait_for_timeout(800)
    segs = [t.strip() for t in pg.locator("[aria-label='Which claims'] button").all_inner_texts()]
    check("Approvals: Waiting for my approval, All pending, Ready for payment, All claims", segs == ["Waiting for my approval (1)", "All pending (3)", "Ready for payment (1)", "All claims (6)"], segs)
    go(pg, CEO, "approvals")  # a fresh page: the Pending figure's filter is gone
    pg.get_by_role("button", name="All claims (6)").click(); pg.wait_for_timeout(600)
    shown = [x.get_attribute("data-record") for x in visible(pg, "#claims-pending [data-record]").all()]
    check("C-1: the register never holds one's own claim", "claim:13" not in shown and len(shown) == 6, shown)
    pg.get_by_role("button", name="All pending (3)").click(); pg.wait_for_timeout(600)
    r7 = visible(pg, "[data-record='claim:7']").first
    reqs.clear()
    r7.get_by_role("button", name=re.compile(r"^Approve \(skip")).click(); pg.wait_for_timeout(700)
    dlg = pg.get_by_role("dialog").filter(has_text="Approve past the incomplete chain").last
    check("C-3: approving past HR and the COO asks for the reason first", dlg.count() == 1 and "at least 5 characters" in dlg.inner_text())
    dlg.locator("input, textarea").first.fill("Client deadline today")
    dlg.get_by_role("button", name="Approve as CEO").click(); pg.wait_for_timeout(1000)
    sent = posts(reqs, "/claims/7/decide")
    check("...and sends it as the decision's note", len(sent) >= 1 and sent[0].get("action") == "approve" and sent[0].get("note") == "Client deadline today", sent)
    check("no page errors (CEO)", not errs, errs)
    ctx.close()

    # ---------- Submit Claim (ref 2) ----------
    ctx, pg, errs, reqs = page(b)
    go(pg, STAFF, "submit")
    steps = pg.get_by_test_id("claim-steps").inner_text()
    check("ref 2: three steps - Claim Details, Attachments, Review & Submit", all(s in steps for s in ["Claim Details", "Attachments", "Review & Submit"]))
    info = pg.get_by_test_id("claim-info").inner_text()
    check("My Claim Info: the company mileage rate, and approved is not paid", "RM 0.60/km" in info and "Approved is not paid" in info, info)
    docs = pg.get_by_test_id("claim-documents-required").inner_text()
    check("Required Documents: the receipt, required", "Receipt - required" in docs, docs)
    form = visible(pg, "#claim-form").first
    form.get_by_role("button", name="Next").click(); pg.wait_for_timeout(400)
    check("Next checks the details first", "at least one item" in form.inner_text())
    form.locator("input[type=date]").filter(visible=True).first.fill("2026-09-15")
    form.locator("select").filter(visible=True).last.select_option("meal")
    form.locator("input[placeholder^='e.g. Grab']").filter(visible=True).first.fill("Client lunch")
    form.locator("input[type=number][placeholder='0.00']").filter(visible=True).first.fill("25")
    form.get_by_role("button", name="Next").click(); pg.wait_for_timeout(400)
    check("step 2: Attachments", pg.get_by_test_id("claim-receipt-drop").is_visible())
    form.get_by_role("button", name="Next").click(); pg.wait_for_timeout(400)
    check("C-8: a reimbursement does not go on without its receipt", "Attach the receipt" in form.inner_text() and pg.get_by_test_id("claim-review").count() == 0)
    pg.get_by_test_id("claim-receipt-drop").locator("input[type=file]").set_input_files({"name": "lunch-receipt.png", "mimeType": "image/png", "buffer": bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) + bytes(200)})
    pg.wait_for_timeout(300)
    check("...the file is named once chosen", "lunch-receipt.png" in pg.get_by_test_id("claim-receipt-drop").inner_text())
    form.get_by_role("button", name="Next").click(); pg.wait_for_timeout(400)
    rv = pg.get_by_test_id("claim-review").inner_text() if pg.get_by_test_id("claim-review").count() else ""
    check("step 3: the review - type, the line, the receipt, the total", all(s in rv for s in ["Reimbursement", "Meal", "Client lunch", "lunch-receipt.png", "RM 25.00"]), rv)
    reqs.clear()
    form.get_by_role("button", name="Submit claim").click(); pg.wait_for_timeout(1800)
    sent = posts(reqs, "/staff/claims")
    check("one submission: the line as entered, no status, no approver, no amount the server would trust", len(sent) == 1 and sent[0].get("items", [{}])[0].get("amount") == 25 and not any(k in sent[0] for k in ["status", "decided_by", "user_id"]), sent)
    up = posts(reqs, "/staff/claims/31/receipt")
    check("...then the receipt goes to the new claim", len(up) == 1 and up[0].get("_raw"), up)
    check("after submitting, My Claims", view_of(pg) == "mine", pg.url)
    # mileage only
    go(pg, STAFF, "submit")
    form = visible(pg, "#claim-form").first
    form.locator("input[type=date]").filter(visible=True).first.fill("2026-09-15")
    form.locator("input[placeholder='0.0']").filter(visible=True).first.fill("42")
    form.get_by_role("button", name="Next").click(); pg.wait_for_timeout(400)
    check("C-8: a mileage-only claim says no receipt is needed", "no receipt is needed" in pg.get_by_test_id("claim-receipt-drop").inner_text() and "No receipt for mileage" in pg.get_by_test_id("claim-documents-required").inner_text())
    form.get_by_role("button", name="Next").click(); pg.wait_for_timeout(400)
    rv = pg.get_by_test_id("claim-review").inner_text() if pg.get_by_test_id("claim-review").count() else ""
    check("...and goes on to the review: 42 km at RM 0.60 = RM 25.20", "42 km" in rv and "RM 25.20" in rv and "Not needed" in rv, rv)
    # the employee
    check("an employee has no Approvals view", pg.get_by_role("tab", name="Approvals", exact=True).count() == 0)
    go(pg, STAFF, "approvals")
    check("...a link to it opens the Overview, never a blank page", view_of(pg) == "overview" and pg.get_by_test_id("claims-attention").is_visible(), pg.url)
    go(pg, STAFF, "mine")
    recs = [x.get_attribute("data-record") for x in pg.get_by_test_id("my-claims").locator("[data-record]").all()]
    check("C-4: the employee's My Claims is their own claim only", recs == ["claim:13"], recs)
    check("no page errors (employee)", not errs, errs)
    ctx.close()

    # ---------- the COO: the CEO's own claims (C-1) ----------
    ctx, pg, errs, reqs = page(b)
    go(pg, COO, "approvals")
    w = visible(pg, "[data-record='claim:14']").first
    check("C-1: the CEO's pending claim waits for the COO's approval", w.count() == 1 and pg.get_by_role("button", name=re.compile(r"^Waiting for my approval")).get_attribute("aria-pressed") == "true", pg.locator("main").inner_text()[:300])
    reqs.clear()
    w.get_by_role("button", name="Approve", exact=True).click(); pg.wait_for_timeout(1000)
    sent = posts(reqs, "/claims/14/decide")
    check("...the COO approves it, in one step (no skipped stage, no reason asked)", len(sent) >= 1 and sent[0].get("action") == "approve", sent)
    pg.get_by_role("button", name=re.compile(r"^Ready for payment")).click(); pg.wait_for_timeout(600)
    r15 = visible(pg, "[data-record='claim:15']").first
    check("C-1: the CEO's approved claim is ready for the COO's payment", r15.count() == 1)
    r15.get_by_test_id("claim-view-15").click(); pg.wait_for_timeout(1200)
    tt = pg.get_by_test_id("claim-timeline").inner_text()
    check("its timeline names the COO's approval and the payment due", "Approval - COO" in tt and "Payment due" in tt, tt[:300])
    reqs.clear()
    pg.get_by_test_id("claim-actions").get_by_role("button", name="Mark paid").click(); pg.wait_for_timeout(600)
    d = pg.get_by_role("dialog").filter(has_text="Bank date").filter(has_not=pg.get_by_test_id("claim-drawer")).last
    d.locator("input[type=date]").first.fill("2026-09-15")
    d.get_by_role("button", name="Mark paid").click(); pg.wait_for_timeout(1000)
    sent = posts(reqs, "/claims/15/paid")
    check("...and the COO marks it paid with the bank date", len(sent) == 1 and sent[0].get("paid_on") == "2026-09-15", sent)
    check("no page errors (COO)", not errs, errs)
    ctx.close()

    # ---------- Reports & Payments (C-10) ----------
    ctx, pg, errs, reqs = page(b)
    go(pg, CEO, "reports")
    t = pg.locator("main").inner_text()
    check("Reports: by claim date - submitted, approved, paid, approved not paid", all(s in t for s in ["Submitted", "Approved", "Paid", "Approved, Not Paid", "Claims of the Month"]), t[:400])
    lst = pg.get_by_test_id("claims-report-list").inner_text()
    check("...each claim with its bank date and Finance status", "06-09-2026" in lst and "Booked in Finance" in lst and "Payment due" in lst, lst[:400])
    pg.get_by_role("button", name="By bank date").click(); pg.wait_for_timeout(600)
    lst = pg.get_by_test_id("claims-report-list").inner_text()
    check("By bank date: the payments whose money left the bank this month, with Finance status", "Payment Records" in lst and "06-09-2026" in lst and "Booked in Finance" in lst and "Grab to client" not in lst, lst[:400])
    with pg.expect_download() as dl:
        pg.get_by_role("button", name="CSV").click()
    csv = open(dl.value.path(), encoding="utf-8").read()
    check("the CSV says its basis and carries both dates", "by bank date" in csv and "Claim date" in csv and "Bank date" in csv and "2026-09-06" in csv, csv[:300])
    check("no page errors (reports)", not errs, errs)
    ctx.close()

    # ---------- widths ----------
    for wd in WIDTHS:
        ctx, pg, errs, _ = page(b, wd, 900)
        bad = []
        for v in ["overview", "submit", "mine", "approvals", "reports"]:
            go(pg, CEO, v, wait=1800)
            if not no_hscroll(pg): bad.append(v)
        check(f"{wd}px: no view scrolls sideways", not bad, bad)
        if wd < 768:
            check(f"{wd}px: the phone view switch replaces the tab row", pg.get_by_test_id("claims-view-bar").is_visible() and pg.get_by_test_id("view-switch").is_visible())
        check(f"no page errors ({wd}px)", not errs, errs)
        ctx.close()
    b.close()

passed = sum(1 for _, ok in res if ok)
print(f"claims4: {passed} of {len(res)} passed")
raise SystemExit(0 if passed == len(res) else 1)

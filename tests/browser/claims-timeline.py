"""v1.254.0 - the Claims approval and payment timeline, on screen (the owner,
02-11-2026: "Claims Approval & Payment Timeline Upgrade";
claude/CLAIMS-TIMELINE-AUDIT.md, D1-D3 and "approved").

What the server decides is proven by direct request in tests/go-live-k.mjs.
Here: Waiting for my approval vs All pending, the row's status chip and
progress dots, the Claim drawer (Progress, Details, Documents, Comments,
Activity), Approve (skip CCO pre-approval) said before the click, Return
for info and Reject asking first, Mark paid asking for the bank date,
Payment due vs Payment confirmed, the claimant's answer box, internal notes
never shown to the claimant, the employee with no decision buttons, and on
a phone: no sideways page, the drawer full screen, the actions on screen.

Servers (servers.txt): 4177 ROLE=ceo (decides; claim 13 is his own and
returned with a question), 4181 ROLE=hr_admin, 4182 ROLE=sales_marketing.
Invented people only."""
import json, urllib.parse
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_page(b, port, w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Claims"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs, reqs

def approvals(pg):
    pg.get_by_role("tab", name="Approvals", exact=True).first.click(); pg.wait_for_timeout(1000)

def posts(reqs, path):
    out = []
    for m, u, d in reqs:
        if m == "POST" and urllib.parse.urlparse(u).path.endswith(path):
            try: out.append(json.loads(d or "{}"))
            except Exception: out.append({})
    return out

def drawer(pg, cid):
    pg.get_by_test_id(f"claim-view-{cid}").filter(visible=True).first.click(); pg.wait_for_timeout(1300)
    return pg.locator("[role=dialog]").filter(has=pg.get_by_test_id("claim-drawer"))

def close(pg):
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)

def states(pg):
    return [li.get_attribute("data-state") for li in pg.get_by_test_id("claim-timeline").locator("li").all()]

def answer_dialog(pg, label, button, value):
    d = pg.get_by_role("dialog").filter(has_text=label).filter(has_not=pg.get_by_test_id("claim-drawer")).last
    d.locator("input:not([type=date]), textarea").first.fill(value)
    d.get_by_role("button", name=button, exact=True).last.click(); pg.wait_for_timeout(1000)

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the CEO ----
    ctx, pg, errs, reqs = open_page(b, 4177)
    approvals(pg)
    mine = pg.get_by_role("button", name="Waiting for my approval (2)")
    check("Approvals opens on Waiting for my approval: the claims at the CEO's own stage", mine.count() == 1 and mine.get_attribute("aria-pressed") == "true"
          and pg.locator("[data-record='claim:12']").count() >= 1 and pg.locator("[data-record='claim:11']").filter(visible=True).count() == 0)
    pg.get_by_role("button", name="All pending (4)").click(); pg.wait_for_timeout(600)
    r11 = pg.locator("[data-record='claim:11']").filter(visible=True).first
    t11 = r11.inner_text()
    check("All pending shows every pending claim; an HR claim says it waits on the CCO, with the progress dots", "Waiting on CCO" in t11 and r11.get_by_test_id("stage-dots").count() == 1, t11[:200])
    check("the CEO's early approval says what it skips, on the button", r11.get_by_role("button", name="Approve (skip CCO pre-approval)").count() == 1)
    dlg = drawer(pg, 11)
    check("View opens the Claim drawer on Progress: the timeline from the server", states(pg) == ["done", "now", "todo", "todo"], states(pg))
    tt = pg.get_by_test_id("claim-timeline").inner_text()
    check("...submitted with who and when, the CCO's step current, the CEO's next, payment last and not done", "Claim submitted" in tt and "Tan Mei Ling" in tt and "Pre-approval - CCO" in tt and "Currently waiting" in tt and "Approval - CEO" in tt and "Payment" in tt, tt[:300])
    for t in ["Progress", "Details", "Documents", "Comments", "Activity"]:
        check(f"the drawer has {t}", dlg.get_by_role("tab", name=t, exact=True).count() == 1)
    foot = pg.get_by_test_id("claim-actions").inner_text()
    check("the drawer's actions: Approve (skip CCO pre-approval), Return for info, Reject - no Mark paid on a pending claim", "Approve (skip CCO pre-approval)" in foot and "Return for info" in foot and "Reject" in foot and "Mark paid" not in foot, foot)
    reqs.clear(); pg.get_by_test_id("claim-actions").get_by_role("button", name="Return for info").click(); pg.wait_for_timeout(600)
    answer_dialog(pg, "Your question to the claimant", "Return", "Which client was the paper for?")
    sent = posts(reqs, "/claims/11/return")
    check("Return for info asks the question first and sends it", len(sent) == 1 and sent[0].get("comment") == "Which client was the paper for?", sent)
    reqs.clear(); pg.get_by_test_id("claim-actions").get_by_role("button", name="Reject").click(); pg.wait_for_timeout(600)
    answer_dialog(pg, "Reason - the claimant reads it", "Reject", "Personal purchase")
    sent = posts(reqs, "/claims/11/decide")
    check("Reject asks for the reason the claimant reads, and sends it", len(sent) == 1 and sent[0].get("action") == "reject" and sent[0].get("note") == "Personal purchase", sent)
    dlg.get_by_role("tab", name="Comments", exact=True).click(); pg.wait_for_timeout(900)
    ct = pg.get_by_test_id("claim-comments").inner_text()
    check("management reads the thread with the internal note marked, and may choose who sees a comment", "Internal" in ct and pg.get_by_role("radio", name="Internal - management only").count() == 1, ct[:200])
    dlg.get_by_role("tab", name="Activity", exact=True).click(); pg.wait_for_timeout(900)
    check("Activity lists the audit trail, apart from comments", "Submitted" in pg.get_by_test_id("claim-activity").inner_text())
    close(pg)
    # approved, not paid
    dlg = drawer(pg, 9)
    check("an approved claim reads Payment due - the payment step is current, not done", states(pg) == ["done", "done", "now"] and "Payment due" in pg.get_by_test_id("claim-timeline").inner_text(), states(pg))
    reqs.clear(); pg.get_by_test_id("claim-actions").get_by_role("button", name="Mark paid").click(); pg.wait_for_timeout(600)
    d = pg.get_by_role("dialog").filter(has_text="Bank date").filter(has_not=pg.get_by_test_id("claim-drawer")).last
    check("Mark paid asks for the bank date (today by default), saying approval alone is not payment", d.count() == 1 and d.locator("input[type=date]").count() == 1 and "not payment" in d.inner_text())
    d.locator("input[type=date]").first.fill("2026-11-01")
    d.get_by_role("button", name="Mark paid").click(); pg.wait_for_timeout(1000)
    sent = posts(reqs, "/claims/9/paid")
    check("...and sends the bank date", len(sent) == 1 and sent[0].get("paid_on") == "2026-11-01", sent)
    close(pg)
    # paid
    dlg = drawer(pg, 8)
    tt = pg.get_by_test_id("claim-timeline").inner_text()
    check("a paid claim: Payment confirmed, who recorded it and the bank date", states(pg)[-1] == "done" and "Payment confirmed" in tt and "bank date" in tt, tt[-200:])
    dlg.get_by_role("tab", name="Documents", exact=True).click(); pg.wait_for_timeout(600)
    check("Documents gives the payout proof", pg.get_by_test_id("claim-documents").get_by_role("button", name="View payout proof").count() == 1)
    close(pg)
    # rejected, in the history
    dlg = drawer(pg, 10)
    check("a rejected claim ends red at its stage, with the reason; no payment", "rejected" in states(pg) and states(pg)[-1] == "off" and "Personal parking" in pg.get_by_test_id("claim-timeline").inner_text(), states(pg))
    close(pg)
    # his own claim, returned to him
    dlg = drawer(pg, 13)
    box = pg.get_by_test_id("claim-resubmit")
    check("the claimant sees the question and Answer & resubmit", box.count() == 1 and "Which client attended the lunch" in box.inner_text() and "returned" in states(pg))
    box.locator("textarea").fill("Kasih Rabiah's team")
    reqs.clear(); box.get_by_role("button", name="Answer & resubmit").click(); pg.wait_for_timeout(1000)
    sent = posts(reqs, "/claims/13/resubmit")
    check("...and the answer is sent", len(sent) == 1 and sent[0].get("comment") == "Kasih Rabiah's team", sent)
    dlg.get_by_role("tab", name="Comments", exact=True).click(); pg.wait_for_timeout(900)
    ct = pg.get_by_test_id("claim-comments").inner_text()
    check("on their own claim the claimant never sees an internal note, nor the choice", "Receipt matches" not in ct and pg.get_by_role("radio", name="Internal - management only").count() == 0, ct[:200])
    close(pg)
    check("no page errors (CEO)", not errs, errs)
    ctx.close()

    # ---- HR: claim 7 waits on HR ----
    ctx, pg, errs, reqs = open_page(b, 4181)
    approvals(pg)
    r7 = pg.locator("[data-record='claim:7']").filter(visible=True).first
    check("HR's Waiting for my approval holds the staff claim at HR review, with the stage action", r7.count() == 1 and r7.get_by_role("button", name="✔ HR review OK — pass to COO").count() == 1 and "Your action" in r7.inner_text())
    check("...and HR has no final Approve on it", r7.get_by_role("button", name="Approve").count() == 0 and r7.get_by_role("button", name="Approve (skip HR review and COO pre-approval)").count() == 0)
    ctx.close()

    # ---- an employee ----
    ctx, pg, errs, reqs = open_page(b, 4182)
    pg.get_by_role("tab", name="My Claims", exact=True).first.click(); pg.wait_for_timeout(900)
    import re
    btns = [t.strip() for t in pg.locator("main button").all_inner_texts()]
    check("an employee has no Approve, Reject or Mark paid button anywhere on Claims", not any(re.match(r"^(Approve( \(|$)|Reject$|Mark paid|Return for info)", t) for t in btns), btns)
    pg.get_by_test_id("claim-view-7").filter(visible=True).first.click(); pg.wait_for_timeout(1200)
    check("...and the drawer of a claim they read has no decision actions", pg.get_by_test_id("claim-drawer").count() == 1 and pg.get_by_test_id("claim-actions").count() == 0)
    check("no page errors (employee)", not errs, errs)
    ctx.close()

    # ---- phones ----
    for w in [320, 375, 390, 430]:
        ctx, pg, errs, _ = open_page(b, 4177, w=w, h=860)
        approvals(pg)
        pg.get_by_role("button", name="All pending (4)").click(); pg.wait_for_timeout(600)
        check(f"phone {w}px: Approvals does not scroll sideways", pg.evaluate(FITS))
        drawer(pg, 11)
        check(f"phone {w}px: the drawer fits, with the vertical timeline", pg.evaluate(FITS) and pg.get_by_test_id("claim-timeline").is_visible())
        btn = pg.get_by_test_id("claim-actions").get_by_role("button", name="Reject")
        box = btn.bounding_box() or {"y": 9999, "height": 0, "x": 0, "width": 0}
        check(f"phone {w}px: the actions are on screen", btn.is_visible() and box["y"] + box["height"] <= 860 and box["x"] + box["width"] <= w, box)
        check(f"no page errors (phone {w})", not errs, errs)
        ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"claims-timeline: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

"""v1.281.0 - A2Z OS MINIMAL EXECUTIVE WORKSPACE, phase E4: the task sheet
and the payment verification sheet in the photo's layout (the CEO approved
the photo and all eight decisions, 11-11-2026; claude/MINIMAL-EXECUTIVE-
WORKSPACE-BLUEPRINT.md sections 5.6 - 5.7). The rules themselves are proven
where they live (tests/browser/task-progress.py, task-closure.py,
payments-verify.py; the worker's own guards); here only that the new layout
keeps them:

  the task sheet opens full screen on a phone; Details leads with the latest
  update, then all five stages (Acknowledged included); the tabs are their
  words with the counts as badges; the gold Add update opens the update sheet
  and records nothing by itself;
  the payment sheet is titled Payment verification with the invoice under it;
  the money reads Invoice total, Verified, Reported - waiting, Outstanding
  after verify (the balance less what waits); the reported payment reads as
  facts; the first waiting payment's decision sits at the foot - Verify, Ask
  a question (was Request clarification), Reject - and opening a decision
  records nothing: Verify still waits for the authenticator code, Reject for
  a reason; no sideways page; no page errors.

Servers (servers.txt): 4213 ROLE=ceo TASKP=1, 4262 ROLE=ceo OWNER=1 PAYV=1.
Invented people only."""
import json, urllib.request
from playwright.sync_api import sync_playwright
import re

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
fx = lambda port, path: json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())
TITLE = "Financing application - Maybank SME"

def page(b, port, tab, w, h):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab={tab}"); pg.wait_for_timeout(3000)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs


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
    for w, h, tag in [(1440, 1000, "desktop"), (402, 874, "phone")]:
        # ================= the task sheet =================
        ctx, pg, errs = page(b, 4213, "Tasks", w, h)
        pg.get_by_role("tab", name="All Tasks", exact=True).first.click(); pg.wait_for_timeout(1000)
        before = len(fx(4213, "/__tasks")["posts"])
        pg.get_by_role("button", name=TITLE).first.click(); pg.wait_for_timeout(2200)
        dr = pg.get_by_role("dialog").filter(has_text=TITLE).first
        bb = dr.bounding_box()
        if tag == "phone":
            check("phone: the task opens full screen", bb and bb["width"] >= w - 2 and bb["height"] >= h * 0.95, bb)
        latest = dr.get_by_test_id("summary-latest")
        stages = dr.get_by_test_id("task-stages")
        check(f"{tag}: Details leads with the latest update, labelled as such", latest.count() == 1 and "LATEST UPDATE" in latest.inner_text())
        check(f"{tag}: ...then the stages", stages.count() == 1 and latest.bounding_box()["y"] < stages.bounding_box()["y"])
        st = stages.inner_text()
        check(f"{tag}: all five stages stay, Acknowledged included - the history is never shortened", all(x in st for x in ["Created", "Acknowledged", "In progress", "Ready for review", "Closed"]), st[:300])
        tabs = dr.get_by_role("tablist", name="Task sections")
        check(f"{tag}: the tabs are found by their words, whatever their counts", tabs.get_by_role("tab", name="Files", exact=True).count() == 1 and tabs.get_by_role("tab", name="Details", exact=True).count() == 1)
        add = dr.get_by_test_id("add-update")
        bg = add.evaluate("e => getComputedStyle(e).backgroundColor")
        check(f"{tag}: the sticky main action is the gold Add update", add.inner_text().strip() == "Add update" and "201, 162, 39" in bg, [add.inner_text(), bg])
        add.click(); pg.wait_for_timeout(800)
        check(f"{tag}: Add update opens the update sheet", dr.get_by_role("button", name="Post Update").count() >= 1 or "Post Update" in dr.inner_text())
        check(f"{tag}: ...and records nothing by itself", len(fx(4213, "/__tasks")["posts"]) == before)
        check(f"{tag}: no sideways page (task)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
        check(f"{tag}: no page errors (task)", not errs, errs)
        ctx.close()

        # ================= the payment verification sheet =================
        ctx, pg, errs = page(b, 4262, "Sales", w, h)
        sales_view(pg, "Payments", "Payments"); pg.wait_for_timeout(1500)
        posts0 = len(fx(4262, "/__payments")["posts"])
        pg.get_by_test_id("payment-row").first.get_by_role("button", name="Review").click(); pg.wait_for_timeout(1200)
        dlg = pg.get_by_role("dialog").last
        txt = dlg.inner_text()
        check(f"{tag}: titled Payment verification, the invoice under it", txt.startswith("Payment verification") and "INV-" in [l for l in txt.split("\n") if l.strip()][1], txt[:120])
        money = dlg.get_by_test_id("payment-money").inner_text()
        # v1.282.0 (Payment Verification 3.0, brief section 6) - verified outstanding; pending beside it, never deducted
        check(f"{tag}: the money: Invoice total, Verified, Pending, Verified outstanding", all(x in money for x in ["Invoice total", "Verified", "Pending", "Verified outstanding"]), money)
        nums = [float(x.replace("RM", "").replace(",", "").strip()) for x in money.split("\n") if x.strip().startswith("RM")]
        check(f"{tag}: ...Verified outstanding = total - verified (pending not deducted)", len(nums) == 4 and nums[2] > 0 and abs(nums[3] - max(0, nums[0] - nums[1])) < 0.01, nums)
        facts = dlg.locator("article").first.inner_text()
        check(f"{tag}: the reported payment reads as facts (Submitted by, Method, Bank reference, Issuing company, the receipt)", all(x in facts for x in ["Reported payment", "Submitted by", "Method", "Bank reference", "Issuing company", "View proof"]), facts[:300])
        foot = dlg.get_by_test_id("payment-decide")
        check(f"{tag}: the decision sits at the foot: Verify, Ask a question, Reject", foot.count() == 1 and [x.strip() for x in foot.locator("button").all_inner_texts()] == ["Verify payment", "Ask a question", "Reject"], foot.inner_text() if foot.count() else "none")
        check(f"{tag}: ...on screen without scrolling", foot.bounding_box() and foot.bounding_box()["y"] + foot.bounding_box()["height"] <= h + 1, foot.bounding_box())
        check(f"{tag}: 'Request clarification' is now 'Ask a question'", "Request clarification" not in dlg.inner_text())
        foot.get_by_role("button", name="Ask a question").click(); pg.wait_for_timeout(500)
        form = dlg.get_by_test_id("payment-action")
        check(f"{tag}: Ask a question opens the question form in the payment, and the foot steps aside", form.count() == 1 and "Your question" in form.inner_text() and dlg.get_by_test_id("payment-decide").count() == 0)
        form.get_by_role("button", name="Cancel").click(); pg.wait_for_timeout(400)
        dlg.get_by_test_id("payment-decide").get_by_role("button", name="Verify payment").click(); pg.wait_for_timeout(500)
        form = dlg.get_by_test_id("payment-action")
        go = form.get_by_role("button", name="Verify payment")
        check(f"{tag}: Verify still waits for the authenticator code (1.272 rules)", form.get_by_label("Authenticator code").count() == 1 and go.is_disabled())
        form.get_by_role("button", name="Cancel").click(); pg.wait_for_timeout(400)
        dlg.get_by_test_id("payment-decide").get_by_role("button", name="Reject").click(); pg.wait_for_timeout(500)
        form = dlg.get_by_test_id("payment-action")
        check(f"{tag}: Reject still asks for a reason and the code", "Reason" in form.inner_text() and form.get_by_role("button", name="Reject payment").is_disabled())
        check(f"{tag}: opening the decisions recorded nothing", len(fx(4262, "/__payments")["posts"]) == posts0)
        check(f"{tag}: no sideways page (payment)", pg.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
        check(f"{tag}: no page errors (payment)", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nsheets-e4: {len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

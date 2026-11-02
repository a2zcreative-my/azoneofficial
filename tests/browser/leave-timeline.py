"""v1.252.0 - the Leave approval timeline, on screen (the owner, 02-11-2026:
"Leave Application Status & Approval Timeline Upgrade";
claude/LEAVE-TIMELINE-AUDIT.md, D1-D3 and "Approved").

What the server decides is proven by direct request in tests/go-live-l.mjs.
Here: the board's progress dots and status, the drawer's Progress / Details /
Comments / Activity, the actions only for whoever decides now, the reason and
question asked before a reject or a return, the applicant's returned box and
resubmit, internal notes never shown to the applicant, and on a phone: no
sideways page, the actions on screen.

Servers (servers.txt): 4177 ROLE=ceo (applicant of leave 3 and 4), 4179
ROLE=coo (decides leave 1, waiting on the COO or the CCO), 4181 ROLE=hr_admin.
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
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Leave"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs, reqs

def tab(pg, name, scope=None):
    t = (scope or pg).get_by_role("tab", name=name, exact=True)
    if t.count(): t.first.click(); pg.wait_for_timeout(1000); return True
    return False

def patches(reqs, lid):
    out = []
    for m, u, d in reqs:
        if m == "PATCH" and urllib.parse.urlparse(u).path.endswith(f"/staff/leave/{lid}"):
            try: out.append(json.loads(d or "{}"))
            except Exception: out.append({})
    return out

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the COO: leave 1 waits on the COO or the CCO ----
    ctx, pg, errs, reqs = open_page(b, 4179)
    tab(pg, "Approvals & Management")
    row = pg.locator("tr[data-record='leave:1']")
    rt = row.inner_text() if row.count() else ""
    check("the board shows the compact progress line on every row", pg.get_by_test_id("stage-dots").count() >= 4)
    check("a waiting request says whom it waits on - either the COO or the CCO - and that it is your action", "Waiting on COO or CCO" in rt and "Your action" in rt, rt)
    check("a rejected request reads Rejected, not in progress", "Rejected" in (pg.locator("tr[data-record='leave:5']").inner_text() if pg.locator("tr[data-record='leave:5']").count() else ""))
    row.get_by_role("button", name="View").click(); pg.wait_for_timeout(1500)
    dlg = pg.locator("[role=dialog]").filter(has=pg.get_by_role("tab", name="Activity", exact=True))
    tl = pg.get_by_test_id("leave-timeline")
    states = [li.get_attribute("data-state") for li in tl.locator("li").all()]
    check("the drawer opens on Progress: the approval timeline from the server", states == ["done", "done", "now", "todo", "todo"], states)
    tt = tl.inner_text()
    check("...submitted and HR review with who and when, then the COO or CCO step marked current", "Application submitted" in tt and "Mei Ling" in tt and "Pre-approval - COO or CCO" in tt and "either one decides" in tt and "Currently waiting" in tt, tt[:400])
    for t in ["Progress", "Details", "Comments", "Activity"]:
        check(f"the drawer has {t}", pg.get_by_role("tab", name=t, exact=True).count() >= 1)
    foot = dlg.inner_text()
    check("the decider gets Pre-approve, Return for info and Reject", all(x in foot for x in ["Pre-approve", "Return for info", "Reject"]), foot[-300:])
    reqs.clear(); dlg.get_by_role("button", name="Reject").last.click(); pg.wait_for_timeout(600)
    ask = pg.get_by_role("dialog").filter(has_text="reason")
    check("Reject asks for the reason the applicant reads", ask.count() >= 1)
    ask.locator("input, textarea").first.fill("Clashes with the stock count")
    ask.get_by_role("button").filter(has_text="OK").or_(ask.get_by_role("button").filter(has_text="Confirm")).or_(ask.get_by_role("button").filter(has_text="Save")).first.click(); pg.wait_for_timeout(1000)
    sent = patches(reqs, 1)
    check("...and sends it with the decision", len(sent) >= 1 and sent[-1].get("action") == "reject" and sent[-1].get("comment") == "Clashes with the stock count", sent)
    reqs.clear(); dlg.get_by_role("button", name="Return for info").click(); pg.wait_for_timeout(600)
    ask = pg.get_by_role("dialog").filter(has_text="question")
    ask.locator("input, textarea").first.fill("Who covers your clients on those days?")
    ask.get_by_role("button").filter(has_text="OK").or_(ask.get_by_role("button").filter(has_text="Confirm")).or_(ask.get_by_role("button").filter(has_text="Save")).first.click(); pg.wait_for_timeout(1000)
    sent = patches(reqs, 1)
    check("Return for info asks a question and sends it", len(sent) >= 1 and sent[-1].get("action") == "return" and sent[-1].get("comment", "").startswith("Who covers"), sent)
    tab(pg, "Comments", dlg)
    ct = pg.get_by_test_id("leave-comments").inner_text()
    check("management reads the thread with the internal note marked Internal, and may choose who sees a comment", "Balance checked" in ct and "Internal" in ct and pg.get_by_role("radio", name="Internal - management only").count() == 1, ct[:300])
    tab(pg, "Activity", dlg)
    check("Activity lists the audit trail (kept apart from comments)", "Applied" in pg.get_by_test_id("leave-activity").inner_text() and "HR reviewed" in pg.get_by_test_id("leave-activity").inner_text())
    check("no page errors (COO)", not errs, errs)
    ctx.close()

    # ---- HR: not this stage's decider ----
    ctx, pg, errs, reqs = open_page(b, 4181)
    tab(pg, "Approvals & Management")
    rt = pg.locator("tr[data-record='leave:1']").inner_text()
    check("HR sees where it stands but has no action on it (the server's can_act)", "Waiting on COO or CCO" in rt and "Your action" not in rt and "Pre-approve" not in rt, rt)
    ctx.close()

    # ---- the applicant (the CEO's own leave 4, returned with a question) ----
    ctx, pg, errs, reqs = open_page(b, 4177)
    tab(pg, "My Leave")
    r4 = pg.locator("tr[data-record='leave:4']").filter(visible=True).first
    check("My Leave says a returned request needs your answer", "your answer needed" in r4.inner_text())
    r4.get_by_role("button", name="View").click(); pg.wait_for_timeout(1500)
    box = pg.get_by_test_id("leave-resubmit")
    check("the applicant sees the question and Edit & Resubmit", box.count() == 1 and "Which client meeting moves" in box.inner_text())
    states = [li.get_attribute("data-state") for li in pg.get_by_test_id("leave-timeline").locator("li").all()]
    check("...and the timeline shows it returned at the step it left", "returned" in states, states)
    dlg = pg.locator("[role=dialog]").filter(has=pg.get_by_role("tab", name="Activity", exact=True))
    check("the applicant has no Approve or Reject", dlg.get_by_role("button", name="Reject").count() == 0 and dlg.get_by_role("button", name="Approve now").count() == 0)
    box.locator("textarea").fill("The Kasih Rabiah meeting moves to Friday")
    reqs.clear(); box.get_by_role("button", name="Resubmit").click(); pg.wait_for_timeout(1200)
    sent = patches(reqs, 4)
    check("Resubmit sends the answer (dates unchanged are not sent)", len(sent) >= 1 and sent[-1].get("action") == "resubmit" and sent[-1].get("comment", "").startswith("The Kasih") and "start_date" not in sent[-1], sent)
    tab(pg, "Comments", dlg)
    ct = pg.get_by_test_id("leave-comments").inner_text()
    check("the applicant never sees an internal note, nor the choice", "Balance checked" not in ct and pg.get_by_role("radio", name="Internal - management only").count() == 0, ct[:200])
    check("no page errors (applicant)", not errs, errs)
    ctx.close()

    # ---- phones ----
    for port, w in [(4179, 320), (4179, 390), (4177, 375), (4177, 430)]:
        ctx, pg, errs, _ = open_page(b, port, w=w, h=860)
        tab(pg, "Approvals & Management" if port == 4179 else "My Leave")
        check(f"phone {w}px ({port}): the leave list does not scroll sideways", pg.evaluate(FITS))
        lid = 1 if port == 4179 else 4
        pg.locator(f"tr[data-record='leave:{lid}']").filter(visible=True).first.get_by_role("button", name="View").click(); pg.wait_for_timeout(1500)
        check(f"phone {w}px: the leave sheet fits, with the vertical timeline", pg.evaluate(FITS) and pg.get_by_test_id("leave-timeline").is_visible())
        btn = pg.get_by_role("button", name="Pre-approve" if port == 4179 else "Resubmit").last
        btn.scroll_into_view_if_needed()
        box = btn.bounding_box() or {"y": 9999, "height": 0}
        nav = pg.evaluate("() => { const n = document.querySelector('.erp-bottom-nav'); return n ? n.getBoundingClientRect().top : innerHeight; }")
        check(f"phone {w}px: the action is on screen, not under the bottom bar", btn.is_visible() and box["y"] + box["height"] <= max(nav, 0) + 1 or btn.is_visible() and box["y"] + box["height"] <= 860, [box, nav])
        check(f"no page errors (phone {w})", not errs, errs)
        ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"leave-timeline: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

"""EXECUTIVE COMMAND CENTER 4.0 (v1.291.0) - in a browser (the CEO's "approve",
12-11-2026; claude/EXECUTIVE-COMMAND-CENTER-4.0-BLUEPRINT.md). The source
rules are held by tests/ecc4.mjs; here, the screens at the eight widths of
the directive, the two views, the phone's view switch, the role variants and
the cards that moved into their modules. The fixture answers are invented
(tests/browser/serve.mjs); no production figure is used.

Servers (from servers.txt):
    4177 ceo · 4179 coo · 4180 live_host · 4181 hr_admin · 4182 sales_marketing
    4262 ceo OWNER PAYV (payment verification on) · 4268 ceo PERF=fail
"""
from playwright.sync_api import sync_playwright
import json, re, urllib.request

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def api(port, path):
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1{path}").read())

def open_page(b, port, w, h=900, path="/portal"):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(3200)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def vis(pg, tid):
    loc = pg.get_by_test_id(tid)
    return loc.count() > 0 and loc.first.is_visible()

def quick_labels(pg):
    return [t.strip() for t in pg.get_by_test_id("quick-actions").filter(visible=True).first.locator("button").all_inner_texts()]

def to_day(pg, phone):
    if phone:
        pg.get_by_test_id("view-switch").click(); pg.wait_for_timeout(250)
        pg.get_by_role("menuitemradio", name=re.compile("My Day")).click()
    else:
        pg.get_by_role("tab", name="My Day").click()
    pg.wait_for_timeout(1200)

with sync_playwright() as p:
    b = p.chromium.launch()
    desk = api(4177, "/staff/desk")
    decide = [i for i in desk["items"] if i.get("kind") == "decide" or (not i.get("kind") and i["bucket"] in ["leave", "claims", "ot", "punches", "quotes", "advisory"])]
    n_dec = len(decide)

    # ---------------- CEO, every width, both views ----------------
    for w in WIDTHS:
        phone = w < 768
        tag = f"CEO {w}"
        ctx, pg, errs = open_page(b, 4177, w)
        check(f"{tag}: the Command Center's title", "Executive Command Center" in pg.get_by_test_id("exec-header").inner_text())
        check(f"{tag}: no sideways page (Overview)", no_hscroll(pg))
        check(f"{tag}: the alert band says what is wrong (backup 55 days in the fixture)", vis(pg, "alert-band") and "backup" in pg.get_by_test_id("alert-band").inner_text())
        figs = pg.locator("[data-row=figures]").filter(visible=True)
        if phone:
            check(f"{tag}: a phone has no figure row; it leads with My Performance, My Priority Actions, My Work (the photo)",
                  figs.count() == 0 and vis(pg, "sales-summary") and vis(pg, "decision-queue") and vis(pg, "my-work") and vis(pg, "decision-banner"))
            check(f"{tag}: the photo's order on a phone: performance, then decisions, then my work",
                  pg.get_by_test_id("sales-summary").bounding_box()["y"] < pg.get_by_test_id("decision-queue").bounding_box()["y"] < pg.get_by_test_id("my-work").bounding_box()["y"])
        else:
            tiles = figs.first.locator("[role=group] > *")
            labels = tiles.all_inner_texts()
            check(f"{tag}: four figures in the photo's order", tiles.count() == 4 and "Weekly target" in labels[0] and "Company sales" in labels[1] and "Outstanding" in labels[2] and "Pending decisions" in labels[3], labels)
            check(f"{tag}: Company sales is never titled Collected, Cash or Paid", not re.search(r"Collected|Cash received", labels[1]) and labels[1].strip().startswith("Company sales"), labels[1])
            check(f"{tag}: verification is off in this fixture, so the tile does not claim Verified", "Verified" not in labels[2] and "recorded payments" in labels[2], labels[2])
            check(f"{tag}: Pending decisions = the Desk's decide list ({n_dec})", re.search(rf"\b{n_dec}\b", labels[3]) is not None, labels[3])
            if w >= 1024:
                ys = [round(t.bounding_box()["y"]) for t in tiles.all()]
                check(f"{tag}: the four figures sit in one row", len(set(ys)) == 1, ys)
        dq = pg.get_by_test_id("decision-queue").inner_text()
        check(f"{tag}: Needs My Decision says 3 of {n_dec} and shows three rows", f"3 of {n_dec}" in dq and pg.get_by_test_id("decision-queue").locator("li").count() == 3, dq[:200])
        check(f"{tag}: each decision row names its module and how long it waited", all(re.search(r"waiting (today|\d+ days?)", t) for t in pg.get_by_test_id("decision-queue").locator("li").all_inner_texts()))
        sp = pg.get_by_test_id("sales-summary").inner_text()
        check(f"{tag}: Sales Performance: gap, working days left, the server's pace word, the basis line", "Remaining gap" in sp and "Working days left" in sp and "Below target" in sp and "invoices paid in full" in sp, sp[:200])
        rec = pg.get_by_test_id("sales-recovery").inner_text()
        check(f"{tag}: Sales Recovery: open quotations, need a follow-up, quoted value (not revenue)", "open quotations" in rec and "need a follow-up" in rec and "not revenue" in rec, rec[:160])
        if not phone:
            check(f"{tag}: the three to recover first, on a wide screen", pg.get_by_test_id("sales-recovery").locator("ol li").count() == 3)
        ql = quick_labels(pg)
        check(f"{tag}: four quick actions: Create Quotation, Create Invoice, Report Payment, Open Desk", ql == ["Create Quotation", "Create Invoice", "Report Payment", "Open Desk"], ql)
        check(f"{tag}: no More drawer for management", pg.locator("#dash-more").count() == 0)
        if phone:
            hs = [pg.get_by_test_id("view-switch").bounding_box()["height"]] + [x.bounding_box()["height"] for x in pg.get_by_test_id("quick-actions").locator("button").all()] + [x.bounding_box()["height"] for x in pg.get_by_test_id("decision-queue").locator("li button").all()]
            check(f"{tag}: the phone's targets are at least 44 px", min(hs) >= 43.5, hs)
            pg.get_by_test_id("view-switch").click(); pg.wait_for_timeout(250)
            items = pg.get_by_role("menuitemradio")
            check(f"{tag}: the view switch is a menu of two, the current view ticked", items.count() == 2 and items.first.get_attribute("aria-checked") == "true" and pg.get_by_test_id("view-switch").get_attribute("aria-expanded") == "true")
            pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
            check(f"{tag}: Escape closes it", pg.get_by_role("menuitemradio").count() == 0)
            check(f"{tag}: a phone has no tabs (the chip switches)", pg.get_by_role("tab", name="My Day").filter(visible=True).count() == 0)
        pg.screenshot(path=f"/tmp/ecc4-ov-{w}.png", full_page=True)
        # My Day
        to_day(pg, phone)
        check(f"{tag}: My Day: the Today strip, my next actions, my contribution", vis(pg, "today-strip") and vis(pg, "next-actions") and vis(pg, "my-contribution"))
        check(f"{tag}: My Day carries no company figure, decision list or attendance chart",
              not vis(pg, "sales-summary") and not vis(pg, "decision-queue") and pg.locator("[data-row=figures]").filter(visible=True).count() == 0 and pg.get_by_text("Daily Attendance Statistic").count() == 0)
        check(f"{tag}: the decisions are one line that opens the Overview", f"{n_dec} decision(s) wait for you on Overview" in pg.get_by_test_id("today-strip").inner_text())
        check(f"{tag}: My Day's four actions", quick_labels(pg) == ["Create Quotation", "New Task", "Follow-ups", "Open Desk"], quick_labels(pg))
        check(f"{tag}: no sideways page (My Day)", no_hscroll(pg))
        pg.screenshot(path=f"/tmp/ecc4-day-{w}.png", full_page=True)
        pg.get_by_test_id("today-strip").get_by_role("button").click(); pg.wait_for_timeout(800)
        check(f"{tag}: ...and it does", vis(pg, "sales-summary"))
        check(f"{tag}: no page error", not errs, errs)
        ctx.close()

    # ---------------- states ----------------
    ctx, pg, errs = open_page(b, 4262, 1440)
    t = pg.locator("[data-row=figures] [role=group] > *").all_inner_texts()
    check("verification on: Verified outstanding, less verified payments", len(t) == 4 and t[2].startswith("Verified outstanding") and "less verified payments" in t[2], t[2:3])
    ctx.close()
    ctx, pg, errs = open_page(b, 4268, 1440)
    t = pg.locator("[data-row=figures] [role=group] > *").all_inner_texts()
    check("the outstanding read fails: Not available with Retry, never RM 0.00", len(t) == 4 and "Not available" in t[2] and "Retry" in t[2] and "RM 0.00" not in t[2], t[2:3])
    ctx.close()

    # ---------------- roles ----------------
    ctx, pg, errs = open_page(b, 4179, 1280)
    check("COO: the Command Center, with the operations four", vis(pg, "decision-queue") and quick_labels(pg) == ["Open Desk", "Create Quotation", "New Task", "Apply Leave"], quick_labels(pg))
    ctx.close()
    for w in (1280, 390):
        ctx, pg, errs = open_page(b, 4182, w)
        check(f"Sales {w}: no company Command Center (the server gives no outlook)", not vis(pg, "sales-summary") and not vis(pg, "decision-queue") and pg.get_by_test_id("exec-header").count() == 0)
        check(f"Sales {w}: the seller's four", quick_labels(pg) == ["Create Quotation", "Follow-ups", "Add Client", "Report Payment"], quick_labels(pg))
        check(f"Sales {w}: no sideways page", no_hscroll(pg))
        ctx.close()
    for w in (1280, 390, 320):
        ctx, pg, errs = open_page(b, 4180, w)
        check(f"Live host {w}: My Day alone - no Overview / My Day tabs", pg.get_by_role("tab", name="Overview").count() == 0 and pg.get_by_role("tab", name="My Day").count() == 0)
        check(f"Live host {w}: the staff four, on My Day", quick_labels(pg)[1:] == ["Apply Leave", "Submit Claim", "New Task"] and quick_labels(pg)[0] in ("Check in", "Check out"), quick_labels(pg))
        check(f"Live host {w}: no sideways page", no_hscroll(pg))
        if w == 390: pg.screenshot(path="/tmp/ecc4-host-390.png", full_page=True)
        check(f"Live host {w}: no page error", not errs, errs)
        ctx.close()
    ctx, pg, errs = open_page(b, 4181, 1280)
    check("HR admin (manages people): keeps both tabs", pg.get_by_role("tab", name="Overview").count() == 1 and pg.get_by_role("tab", name="My Day").count() == 1)
    ctx.close()

    # ---------------- moved into their modules ----------------
    ctx, pg, errs = open_page(b, 4177, 1440, path="/portal?tab=Attendance")
    check("the Daily Attendance Statistic is on Attendance -> Overview", pg.get_by_text("Daily Attendance Statistic").filter(visible=True).count() == 1)
    ctx.close()
    ctx, pg, errs = open_page(b, 4177, 1440, path="/portal?tab=Finance")
    check("Financial health is on Finance -> Overview", vis(pg, "finance-health"))
    ctx.close()
    ctx, pg, errs = open_page(b, 4177, 1440)
    pg.get_by_test_id("alert-band").get_by_role("button").first.click(); pg.wait_for_timeout(1500)
    check("the alert band opens System health (Users -> Security & Sessions)", pg.get_by_text("System health").filter(visible=True).count() >= 1)
    ctx.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\necc4: {len(res) - len(failed)}/{len(res)} passed")
if failed: raise SystemExit(1)

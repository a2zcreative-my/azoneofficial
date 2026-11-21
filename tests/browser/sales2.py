"""SALES 2.0, STAGES 1 AND 2 (v1.320.0) - in a browser (the CEO's six pictures,
"Proceed the recommend" and "approve with recommend", 15-11-2026;
claude/SALES-2.0-STAGE-0-AUDIT.md).

  Overview (picture 01)  six figures in one row; the Sales Pipeline with a
                         count per step; pressing a step narrows the one
                         worklist (and says so); pressing it again clears it;
                         CEO Verified and Closed Sale open Closed Sales;
                         the rail - Important Follow-Ups, Recent Payment
                         Activity, Team Sales Performance (management)
  The words (S2-4)       Paid / Partially paid / Unpaid on the invoices; no
                         Mark paid anywhere on the Overview (S2-1)
  A consultant           their own week and target; no team panel
  A phone                the pipeline scrolls inside itself; no sideways
                         page at any of the eight widths

The fixture's figures are invented (tests/browser/fixture.mjs).

Servers (from servers.txt):
    4177 ceo · 4182 sales_marketing
"""
from playwright.sync_api import sync_playwright
import re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, SALES = 4177, 4182
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url); return m.group(1) if m else None
def open_page(b, port, w=1440, h=1100, view="overview"):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales&view={view}"); pg.wait_for_timeout(4000)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg, errs = open_page(b, CEO)
    ov = pg.get_by_test_id("sales-overview-2")
    figs = pg.get_by_role("group", name="Sales at a glance")
    tiles = figs.locator(":scope > *")
    tops = set(round(t.bounding_box()["y"]) for t in tiles.all())
    check("six figures, in one row at 1440px", tiles.count() == 6 and len(tops) == 1, tops)
    txt = figs.inner_text()
    check("the picture's six: Sales This Week, Weekly Target, Outstanding, Pending CEO Verification, Due Follow-Ups, Open Quotations",
          all(w in txt for w in ["Sales This Week", "Weekly Target", "Outstanding", "Pending CEO Verification", "Due Follow-Ups", "Open Quotations"]), txt[:300])
    check("no change is drawn against a period it does not know (no '+22%')", re.search(r"[+\-]\d+%", txt) is None, txt[:200])
    pipe = pg.get_by_test_id("sales-pipeline")
    steps = pipe.locator("li[data-step]")
    keys = [s.get_attribute("data-step") for s in steps.all()]
    check("the Sales Pipeline: Enquiry, Quotation, Follow-Up, Invoice, Payment Reported, CEO Verified, Closed Sale",
          keys == ["enquiry", "quotation", "follow_up", "invoice", "reported", "verified", "closed"] and "Payment Reported" in pipe.inner_text(), keys)
    counts = {s.get_attribute("data-step"): int(s.get_by_test_id("flow-count").inner_text()) for s in steps.all()}
    check("each step carries a count", all(isinstance(v, int) for v in counts.values()) and len(counts) == 7, counts)
    clipped = pg.evaluate("[...document.querySelectorAll('[data-testid=sales-pipeline] strong')].filter(e => e.scrollWidth > e.clientWidth + 1).length")
    check("no step's word is cut off", clipped == 0, clipped)
    # v1.397.0 (Sales Command Center, Phase 1) - the pipeline is a SUMMARY in the rail: a step opens
    # the records it counts; the one worklist and the rail panels are now My Sales Action Center,
    # the week's target and Recent Activities (sales-today.tsx; tests/browser/sales-today.py)
    def press(step):
        pg.get_by_test_id("sales-pipeline").locator(f"li[data-step={step}] button").click(); pg.wait_for_timeout(1200)
        v = view_of(pg); pg.goto(f"http://127.0.0.1:{CEO}/portal?tab=Sales&view=overview"); pg.wait_for_timeout(3000)
        return v
    check("Invoice opens Quotations & Invoices", press("invoice") == "documents")
    check("Quotation opens Quotations & Invoices", press("quotation") == "documents")
    check("Payment Reported opens Payments", press("reported") == "payments")
    check("CEO Verified opens Closed Sales", press("verified") == "closed")
    pipe = pg.get_by_test_id("sales-pipeline")
    ac = pg.get_by_test_id("action-center")
    check("the main column is My Sales Action Center (the one list)", ac.is_visible() and pg.get_by_test_id("sales-worklist").count() == 0)
    for tid, what in [("recent-list", "Recent Activities"), ("team-table", "Team Performance")]:
        check(f"below: {what}", pg.get_by_test_id(tid).is_visible())
    # v1.407.0 (the CEO's Overview picture) - the rail is the week's target; the pipeline summary is its own row below
    wl = ac.bounding_box(); wt = pg.get_by_test_id("weekly-target").bounding_box(); rp = pg.get_by_test_id("pipeline-panel").bounding_box()
    check("the rail (Weekly Target Progress) sits beside the Action Center at 1440px, narrower", wt["x"] > wl["x"] + wl["width"] - 1 and wt["width"] < wl["width"], (wl, wt))
    check("the pipeline summary is a row across the page, under the Action Center", rp["y"] >= wl["y"] + wl["height"] - 1 and rp["width"] > wl["width"] + wt["width"], (wl, rp))
    steps = pipe.locator("button").all(); last = steps[-1].bounding_box() if steps else None
    check("all seven pipeline steps are on screen at 1440px, no sideways scroll", len(steps) == 7 and last and last["x"] + last["width"] <= rp["x"] + rp["width"] + 1, (len(steps), last, rp))
    pg.get_by_test_id("recent-filter").get_by_role("button", name=re.compile("^Payments")).click(); pg.wait_for_timeout(300)
    check("Recent Activities: the Payments filter keeps the payment activity (S2-4 moved here)", pg.get_by_test_id("recent-row").count() >= 1)
    check("S2-1: nothing on the Overview says Mark paid", re.search(r"\bmark paid\b", ov.inner_text(), re.I) is None)
    tm = pg.get_by_test_id("team-table").inner_text()
    check("Team Performance: each person with an amount and a team total", "Team total" in tm and re.search(r"RM [\d,]+\.\d\d", tm) is not None, tm[:200])
    check("no sideways page (1440)", no_hscroll(pg))
    pg.get_by_test_id("sales-pipeline").locator("li[data-step=closed] button").click(); pg.wait_for_timeout(1200)
    check("Closed Sale opens Closed Sales (said in the address)", view_of(pg) == "closed", pg.url)
    pg.go_back(); pg.wait_for_timeout(900)
    check("Back returns to the Overview", view_of(pg) == "overview" and pg.get_by_test_id("sales-pipeline").is_visible(), pg.url)
    ctx.close()
    check("no page error (CEO)", not errs, errs[:3])

    # a consultant: their own
    ctx, pg, errs = open_page(b, SALES)
    txt = pg.get_by_role("group", name="Sales at a glance").inner_text()
    check("a consultant: My Sales This Week and My Weekly Target; no team panel", "My Sales This Week" in txt and "My Weekly Target" in txt and pg.get_by_test_id("team-table").count() == 0, txt[:200])
    ctx.close()
    check("no page error (consultant)", not errs, errs[:3])

    # the widths
    for w in WIDTHS:
        ctx, pg, errs = open_page(b, CEO, w=w, h=900)
        ps = pg.get_by_test_id("sales-pipeline")
        inside = pg.evaluate("(() => { const s = document.querySelector('[data-testid=sales-pipeline]').parentElement; return s.getBoundingClientRect().right <= window.innerWidth + 1; })()")
        check(f"{w}px: no sideways page; the pipeline stays inside the screen (it scrolls inside itself)", no_hscroll(pg) and inside and ps.is_visible())
        if w < 640:
            small = pg.evaluate("[...document.querySelectorAll('[data-testid=sales-pipeline] button, [data-testid=sales-overview-2] [role=group] button')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 43.5).length")
            check(f"{w}px: the pipeline's steps and the figures are 44 px targets", small == 0, small)
        ctx.close()
        check(f"{w}px: no page error", not errs, errs[:3])
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

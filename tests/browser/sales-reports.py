"""SALES COMMAND CENTER, PHASE 6: REPORTS (v1.403.0) - in a browser.

  Reports      the five reports, then Team Performance (management only), Pipeline, Win / Loss, Lead Sources
  Team         activity and results in two column groups; a CSV
  Pipeline     open deals by stage (quoted and estimated apart), moves, days in a stage, won and lost ("not revenue")
  Win / Loss   won on, lost because, with the written reasons; a deal opens in the Sales Pipeline
  Sources      leads by source; a count opens Leads & CRM
  Phones       no sideways page at 390; BM words

Servers: ROLE=ceo 4177 · ROLE=sales_marketing 4182   (node tests/browser/serve.mjs out <port>)
"""
from playwright.sync_api import sync_playwright
import os, re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, SALES = 4177, 4182
SHOTS = os.environ.get("SHOTS", "/tmp/reports-shots"); os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, port, w=1440, h=1000, lang="en"):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone, accept_downloads=True)
    ctx.add_init_script(f"try{{localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang','{lang}')}}catch(e){{}}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales&view=reports"); pg.wait_for_timeout(4000)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def pick(pg, key):
    pg.get_by_test_id("report-type").filter(visible=True).first.select_option(key); pg.wait_for_timeout(1400)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    ctx, pg, errs = open_page(b, CEO)
    opts = pg.get_by_test_id("report-type").filter(visible=True).first.locator("option").all_inner_texts()
    check("the five reports stay, and the four new ones follow them", all(o in opts for o in ["Team Performance", "Pipeline", "Win / Loss", "Lead Sources"])
          and opts.index("Team Performance") > opts.index("Commission"), opts)
    pick(pg, "team_performance")
    t = pg.get_by_test_id("report-team")
    check("Team Performance: activity and results in two column groups", t.get_by_test_id("team-activity-head").count() == 1 and t.get_by_test_id("team-results-head").count() == 1
          and t.get_by_test_id("team-row").count() == 3, t.inner_text()[:200])
    check("…with the totals", "41" in t.get_by_test_id("team-total").inner_text() and "7,300.00" in t.get_by_test_id("team-total").inner_text())
    with pg.expect_download() as dl:
        pg.get_by_test_id("team-csv").click()
    path = dl.value.path(); txt = open(path, encoding="utf-8-sig").read()
    check("Team Performance exports a CSV that names its period", "Team Performance · 01-09-2026 to 30-09-2026" in txt and "Nur Aisyah binti Rahman" in txt, txt[:200])
    pg.screenshot(path=f"{SHOTS}/01-ceo-team-performance-1440.png", full_page=False)
    pg.get_by_test_id("team-period-last_month").click(); pg.wait_for_timeout(1000)
    check("the period switches the report", "01-08-2026 – 31-08-2026" in pg.get_by_test_id("report-team").inner_text())

    pick(pg, "pipeline")
    pp = pg.get_by_test_id("report-pipeline")
    check("Pipeline: the four open stages, quoted and estimated apart", pp.get_by_test_id("pipe-stage").count() == 4 and "Quoted" in pp.inner_text() and "Estimated" in pp.inner_text())
    check("…moves, days in a stage, and won marked not revenue", pp.get_by_test_id("pipe-moves").count() == 1 and "4 days" in pp.inner_text() and "not revenue" in pp.get_by_test_id("pipe-closed").inner_text())
    pg.screenshot(path=f"{SHOTS}/02-ceo-pipeline-report-1440.png", full_page=False)
    pp.get_by_test_id("report-count").first.click(); pg.wait_for_timeout(1500)
    check("a count opens the Sales Pipeline", "view=pipeline" in pg.url and pg.get_by_test_id("sales-pipeline").count() == 1, pg.url)
    ctx.close()

    ctx, pg, errs = open_page(b, CEO)
    pick(pg, "winloss")
    wl = pg.get_by_test_id("report-winloss")
    check("Win / Loss: won on and lost because, with the written reason", wl.get_by_test_id("wl-won").count() == 1 and wl.get_by_test_id("wl-lost").locator("li").count() == 7
          and "Went with a cheaper printer" in wl.inner_text())
    pg.screenshot(path=f"{SHOTS}/03-ceo-win-loss-1440.png", full_page=False)
    wl.get_by_role("button", name="Shop signage").click(); pg.wait_for_timeout(1800)
    check("a deal opens in the Sales Pipeline", "view=pipeline" in pg.url and pg.get_by_test_id("deal-record").count() >= 1, pg.url)
    ctx.close()

    ctx, pg, errs = open_page(b, CEO)
    pick(pg, "sources")
    so = pg.get_by_test_id("report-sources")
    check("Lead Sources: by source, with Not recorded", so.get_by_test_id("src-row").count() == 4 and "Not recorded" in so.inner_text() and "Website" in so.inner_text(), so.inner_text()[:200])
    pg.screenshot(path=f"{SHOTS}/04-ceo-lead-sources-1440.png", full_page=False)
    so.get_by_test_id("report-count").first.click(); pg.wait_for_timeout(1500)
    check("a lead count opens Leads & CRM", "view=customers" in pg.url and pg.get_by_test_id("crm-leads").count() == 1, pg.url)
    check("no page errors (CEO)", not errs, errs[:2])
    ctx.close()

    ctx, pg, errs = open_page(b, SALES)
    opts = pg.get_by_test_id("report-type").filter(visible=True).first.locator("option").all_inner_texts()
    check("a consultant does not get Team Performance", "Team Performance" not in opts and "Pipeline" in opts, opts)
    pick(pg, "pipeline")
    check("a consultant has no Everyone switch", pg.get_by_test_id("pipe-scope").count() == 0)
    ctx.close()

    ctx, pg, errs = open_page(b, CEO, w=390, h=860)
    pick(pg, "team_performance")
    check("390px: no sideways page (the table scrolls in its box)", no_hscroll(pg))
    pg.screenshot(path=f"{SHOTS}/05-ceo-390-team.png", full_page=True)
    ctx.close()
    ctx, pg, errs = open_page(b, CEO, lang="ms")
    pick(pg, "team_performance")
    tt = pg.get_by_test_id("report-team").inner_text()
    check("BM words", "Prestasi Pasukan" in tt and "Aktiviti" in tt and "Hasil" in tt, tt[:200])
    ctx.close()
    b.close()

bad = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(bad)}/{len(res)} passed")
raise SystemExit(1 if bad else 0)

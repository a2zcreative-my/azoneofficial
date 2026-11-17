"""PAYROLL HISTORY RELEASE (v1.339.0) - in a browser. The source rules are held
by tests/payroll-history-release.mjs. Here, the screen:

  Payroll > Reports & Export > Payroll History, as the CEO, over the PAYHIST
  fixture (tests/browser/serve.mjs): July, September and October are out by their
  automatic date and must read "Released · automatic", never "Not released";
  August has a release row and reads "Released"; October (the CEO's
  screenshot) is out by its date too; November is saved and its date is still
  ahead, so it carries a Release button; pressing it asks first (the same
  early-release question as the Payslips box), posts ONE release for November,
  and History then reads November as released.

Server: PAYHIST=1 ROLE=ceo node tests/browser/serve.mjs out 4200
(PORT= to change it). Screenshots go to SHOTS= when set.
"""
from playwright.sync_api import sync_playwright
import os

PORT = int(os.environ.get("PORT", "4200"))
SHOTS = os.environ.get("SHOTS")
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

def status(pg, m):
    loc = pg.get_by_test_id(f"hist-status-{m}")
    return loc.first.inner_text().strip() if loc.count() else ""

with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    pg = c.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    posts = []; pg.on("request", lambda r: posts.append((r.url, r.post_data)) if r.method == "POST" and "/payroll/release" in r.url else None)
    pg.goto(f"http://127.0.0.1:{PORT}/portal?tab=Payroll&view=reports"); pg.wait_for_timeout(3500)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    if pg.get_by_role("tab", name="Reports & Export").count():
        pg.get_by_role("tab", name="Reports & Export").first.click(); pg.wait_for_timeout(2500)
    pg.get_by_label("Payroll month").first.fill("2026-11") if pg.get_by_label("Payroll month").count() else None
    pg.wait_for_timeout(2500)
    sec = pg.locator("section[aria-label='Payroll history']")
    check("the Payroll History table is drawn", sec.count() == 1 and "Payroll month" in sec.inner_text())
    if SHOTS: sec.screenshot(path=os.path.join(SHOTS, "payroll-history-before.png"))
    check("July (past its automatic date) reads released, not Not released", status(pg, "2026-07") == "Released · automatic", status(pg, "2026-07"))
    check("September (past its automatic date) reads released", status(pg, "2026-09") == "Released · automatic", status(pg, "2026-09"))
    check("August (released by hand) reads Released", status(pg, "2026-08") == "Released", status(pg, "2026-08"))
    check("October (past its automatic date, 5 November) reads released - the CEO's screenshot", status(pg, "2026-10") == "Released · automatic", status(pg, "2026-10"))
    check("November (saved, its date still ahead) reads Not released", status(pg, "2026-11") == "Not released", status(pg, "2026-11"))
    check("a month with nothing saved reads Nothing saved, never released", status(pg, "2026-06") == "Nothing saved", status(pg, "2026-06"))
    check("no Release button on a month already out", all(pg.get_by_test_id(f"hist-release-{m}").count() == 0 for m in ["2026-07", "2026-08", "2026-09", "2026-10"]))
    btn = pg.get_by_test_id("hist-release-2026-11")
    check("November carries a Release button for the CEO", btn.count() == 1)
    if btn.count():
        btn.click(); pg.wait_for_timeout(800)
        dlg = pg.get_by_role("dialog")
        check("Release asks first (the early-release question)", dlg.count() > 0 and "release" in dlg.first.inner_text().lower(), dlg.first.inner_text()[:200] if dlg.count() else "")
        check("nothing is posted before the answer", posts == [], posts)
        if dlg.count():
            dlg.first.get_by_role("button").filter(has_text="Release").last.click(); pg.wait_for_timeout(3000)
        check("one release is posted, for November", len(posts) == 1 and '"month":"2026-11"' in (posts[0][1] or "").replace(" ", ""), posts)
        check("History re-reads: November now reads Released", status(pg, "2026-11") == "Released", status(pg, "2026-11"))
        check("and its Release button is gone", pg.get_by_test_id("hist-release-2026-11").count() == 0)
        if SHOTS: sec.screenshot(path=os.path.join(SHOTS, "payroll-history-after.png"))
    check("no page error", not errs, errs[:2])
    c.close(); b.close()

bad = [n for n, ok in res if not ok]
print(f"payroll-history-release (browser): {len(res) - len(bad)}/{len(res)} passed")
raise SystemExit(1 if bad else 0)

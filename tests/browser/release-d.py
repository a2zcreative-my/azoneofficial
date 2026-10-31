"""RELEASE D OF THE GO-LIVE PLAN (v1.244.0) - the client side, in a browser.

System health (Users -> Security & Settings) says where the media copy
stands: off while the backups bucket is not bound, "still to copy" while the
first passes run, "every object matches" after the weekly check, and the
damaged copies in warning colour; the Off-site copy link still downloads the
newest backup; nothing breaks without the new field (an older worker).

Server (tests/browser/serve.mjs on a production build in out/):
    ROLE=super_admin node tests/browser/serve.mjs out 4207

    xvfb-run -a python3 tests/browser/release-d.py
"""
from playwright.sync_api import sync_playwright
import sys, urllib.request

PORT = 4207
BASE = f"http://127.0.0.1:{PORT}"
S = "/home/claude/work"
res = []
def check(n, c, x=""): res.append(("PASS " if c else "FAIL ") + n + (f" — {x}" if x and not c else ""))
def state(s): urllib.request.urlopen(f"{BASE}/__mediabk?state={s}").read()

urllib.request.urlopen(f"{BASE}/__reset").read()

def open_health(b, w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{BASE}/portal"); pg.wait_for_timeout(2500)
    btn = pg.get_by_role("button", name="Users", exact=True).filter(visible=True)
    if btn.count() == 0:
        m = pg.get_by_role("button", name="More").filter(visible=True)
        if m.count(): m.first.click(); pg.wait_for_timeout(500)
        btn = pg.get_by_role("button", name="Users", exact=True).filter(visible=True)
    btn.first.click(); pg.wait_for_timeout(1800)
    pg.get_by_role("tab", name="Security & Settings", exact=True).first.click(); pg.wait_for_timeout(1800)
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()

    # an older worker: no media field - the card is as before
    ctx, pg, errs = open_health(b)
    check("System health shows the last backup as before", "Last backup" in pg.inner_text("body"))
    check("without the new field there is no media line (an older worker)", pg.get_by_test_id("media-backup").count() == 0)
    link = pg.get_by_role("link", name="Off-site copy")
    check("Off-site copy still downloads the newest backup", link.count() == 1 and link.first.get_attribute("href").endswith("/system/backup/download"))
    check("no page errors (as before)", not errs, str(errs)[:200])
    ctx.close()

    for st, expect, warn in [
        ("unbound", "Media copy is off — the backups bucket (azoneofficial-backups) is not bound to the API yet.", True),
        ("pending", "1240 objects · 120 still to copy", True),
        ("ok", "1240 objects · all copied", False),
        ("damaged", "0 without a current copy, 2 damaged", True),
    ]:
        state(st)
        ctx, pg, errs = open_health(b)
        line = pg.get_by_test_id("media-backup")
        t = line.inner_text() if line.count() else ""
        check(f"{st}: the media line says it", expect in t, t[:200])
        check(f"{st}: {'a warning' if warn else 'no warning'} colour", (line.locator(".text-warning").count() > 0) == warn)
        if st == "ok": check("ok: the weekly check reads every object matches", "weekly check" in t and "every object matches" in t, t[:200])
        if st in ("ok", "damaged") and line.count(): line.scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=f"{S}/rd-health-{st}.png")
        check(f"{st}: no page errors", not errs, str(errs)[:200])
        ctx.close()

    # a phone: the line wraps, the page does not scroll sideways
    state("pending")
    ctx, pg, errs = open_health(b, 390, 844)
    line = pg.get_by_test_id("media-backup")
    check("phone: the media line is shown", line.count() == 1 and "still to copy" in line.inner_text())
    check("phone: no sideways scroll", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    if line.count(): line.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{S}/rd-health-phone.png")
    ctx.close()
    state("")
    b.close()

for r in res: print(r)
fails = [r for r in res if r.startswith("FAIL")]
print(f"\n{len(res) - len(fails)} of {len(res)} passed")
sys.exit(1 if fails else 0)

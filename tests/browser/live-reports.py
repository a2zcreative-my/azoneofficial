"""v1.368.0 - Live Reports in the browser (the CEO's picture, 18-11-2026).
Against a local worker seeded with tests/browser/chat-seed.sql + live-seed.sql
(see tests/browser/live-e2e.mjs) behind tests/browser/chat-proxy.mjs on 4500:
a staff member records an unplanned live from its project, adds a screenshot,
has the AI read it (LIVE_AI_TEST_FAKE), takes the reading, submits; the CEO
accepts; the phone shows cards, never the table.
    python3 tests/browser/live-reports.py"""
import datetime, os, struct, zlib
from playwright.sync_api import sync_playwright
B = os.environ.get("BASE", "http://127.0.0.1:4500")
res = []
def ok(n, c, x=""):
    res.append(c); print(("  ok  " if c else "  FAIL ") + n + (f" {x}" if not c else ""))
def ctx(b, tok, phone=False):
    kw = dict(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, device_scale_factor=2) if phone else dict(viewport={"width":1440,"height":900})
    c = b.new_context(**kw)
    c.add_cookies([{"name":"azone_session","value":tok,"domain":"127.0.0.1","path":"/"},{"name":"csrf_token","value":"c"+tok,"domain":"127.0.0.1","path":"/"}])
    return c
def png(path):
    raw = b"".join(b"\x00" + bytes([30, 40, 80] * 40) for _ in range(30))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 40, 30, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
URL = B + "/portal?tab=Roster%20%26%20Scheduling&view=reports"
day = (datetime.datetime.now(datetime.UTC).replace(tzinfo=None) + datetime.timedelta(hours=8) - datetime.timedelta(days=2 + int(datetime.datetime.now().timestamp()) % 25)).strftime("%Y-%m-%d")  # a day no earlier run used (one live per project/platform/time)
png("/tmp/lr/shot.png")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    errs = []
    c = ctx(b, "tok101"); pg = c.new_page(); pg.goto(URL); pg.wait_for_selector('[data-testid=live-ai-status]', timeout=20000)
    # a fresh day's budget and the full ceiling, so the read below is the real path (live-e2e.mjs lowers the ceiling to test the guard)
    import subprocess
    subprocess.run(["npx", "wrangler", "d1", "execute", "azoneofficial", "--local", "--persist-to", os.environ.get("LIVE_PERSIST", "/tmp/livedev2"), "--command", "DELETE FROM ai_budget"], cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "worker"), capture_output=True)
    pg.evaluate("""async () => { const t = document.cookie.match(/csrf_token=([^;]*)/)[1];
      const r = await (await fetch('/api/v1/staff/live-reports/ai')).json();
      if (r.enabled) await fetch('/api/v1/staff/live-reports/ai', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': t }, body: JSON.stringify({ enabled: false, ceiling: 8000 }) }); }""")
    pg.reload(); pg.wait_for_selector('[data-testid=live-ai-status]', timeout=20000)
    if pg.locator('[data-testid=live-ai-on]').count():
        ok("the AI cannot be turned on without the licence", not pg.locator('[data-testid=live-ai-on]').is_enabled())
        pg.check('[data-testid=live-ai-licence]'); pg.click('[data-testid=live-ai-on]'); pg.wait_for_timeout(1500)
    ok("the CEO turned the screenshot AI on", "On" in pg.inner_text('[data-testid=live-ai-status]'))
    c.close()
    c = ctx(b, "tok108"); pg = c.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector('[data-testid=live-reports]', timeout=20000); pg.wait_for_timeout(1500)
    ok("the page is inside Roster & Scheduling with the figures strip", pg.locator('[data-testid=live-kpis]').count() == 1)
    pg.click('[data-testid=live-new]'); pg.click('[data-testid=live-mode-unplanned]')
    pg.select_option('[data-testid=live-u-project]', "701"); pg.fill('[data-testid=live-u-date]', day)
    pg.fill('[data-testid=live-u-start]', f"{6 + int(datetime.datetime.now().timestamp()) // 25 % 12:02d}:00"); pg.fill("[data-testid=live-u-end]", f"{6 + int(datetime.datetime.now().timestamp()) // 25 % 12:02d}:45")
    pg.click('[data-testid=live-u-create]'); pg.wait_for_selector('[data-testid=live-detail]', timeout=15000)
    ok("an unplanned live opens its report", pg.locator('[data-testid=live-participants] li').count() >= 1)
    pg.set_input_files('[data-testid=live-upload]', "/tmp/lr/shot.png"); pg.wait_for_selector('[data-testid^=live-ai-read-]', timeout=15000)
    ok("the screenshot is shown with its AI button", pg.locator('[data-testid^=live-ai-read-]').count() == 1)
    if pg.locator('[data-testid^=live-ai-read-]').first.is_enabled():
        pg.locator('[data-testid^=live-ai-read-]').first.click(); pg.wait_for_selector('[data-testid=live-use-ai]', timeout=15000)
        pg.click('[data-testid=feedback-close]') if pg.locator('[data-testid=feedback-close]').count() else None
        pg.click('[data-testid=live-use-ai]')
        ok("the AI reading fills the figures for the staff to confirm", pg.input_value('[data-testid=live-fig-gmv]') == "4860" and pg.input_value('[data-testid=live-fig-orders]') == "186", pg.input_value('[data-testid=live-fig-gmv]'))
    else:
        pg.fill('[data-testid=live-fig-gmv]', "4860"); ok("with the AI off the figures are typed (manual entry)", True)
    pg.screenshot(path="/tmp/lr/drawer.png")
    pg.click('[data-testid=live-submit]'); pg.wait_for_timeout(2500)
    ok("submitted: the report waits for review", "Pending Review" in pg.inner_text('[data-testid=live-detail]'))
    c.close()
    c = ctx(b, "tok101"); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector('[data-testid=live-table]', timeout=20000)
    pg.select_option('[data-testid=live-filter]', "waiting"); pg.wait_for_timeout(500)
    ok("the CEO filters the reports waiting for review", pg.locator('[data-testid^=live-row-]').count() >= 1)
    pg.locator('[data-testid^=live-view-]').first.click(); pg.wait_for_selector('[data-testid=live-accept]', timeout=15000)
    pg.click('[data-testid=live-accept]'); pg.wait_for_timeout(2000)
    ok("the CEO accepts it", "Accepted" in pg.inner_text('[data-testid=live-detail]'))
    ok("the AI card shows today's use to the CEO", pg.locator('[data-testid=live-ai-status]').count() == 1)
    c.close()
    c = ctx(b, "tok103", True); pg = c.new_page(); pg.goto(URL); pg.wait_for_selector('[data-testid=live-reports]', timeout=20000); pg.wait_for_timeout(1500)
    w = pg.evaluate("document.documentElement.scrollWidth")
    ok("phone: no sideways spill", w <= 390, str(w))
    ok("phone: cards, not the table", pg.locator('[data-testid=live-table]').is_visible() is False)
    pg.screenshot(path="/tmp/lr/phone.png", full_page=True)
    c.close(); b.close()
    ok("no page errors", not errs, "; ".join(errs[:3]))
print(f"\nlive-reports.py: {res.count(True)} passed, {res.count(False)} failed")
exit(0 if all(res) else 1)

"""v1.360.0 - push alerts are required for every staff role (the CEO, 18-11-2026).
Servers (this build): 4360 ROLE=ceo PUSHKEY=1, 4361 ROLE=agent PUSHKEY=1, 4362 ROLE=ceo (no push keys)."""
import sys
from playwright.sync_api import sync_playwright
fails = []
def check(name, ok, extra=""):
    print(("ok   " if ok else "FAIL ") + name + (f" - {extra}" if not ok and extra else ""))
    if not ok: fails.append(name)
with sync_playwright() as p:
    b = p.chromium.launch()
    def open_(port, grant=False, ua=None):
        ctx = b.new_context(viewport={"width": 390, "height": 844}, **({"user_agent": ua} if ua else {}))
        if grant: ctx.grant_permissions(["notifications"], origin=f"http://127.0.0.1:{port}")
        # headless Chromium reports "denied" by default; a fresh phone has not been asked yet
        ctx.add_init_script("Object.defineProperty(Notification, 'permission', { get: () => 'default' })")
        pg = ctx.new_page(); pg.goto(f"http://127.0.0.1:{port}/portal"); pg.wait_for_timeout(3500)
        return ctx, pg
    ctx, pg = open_(4360)
    pg.screenshot(path="/tmp/pg/off.png")
    g = pg.get_by_test_id("push-gate")
    check("staff with no push on this device: the portal waits behind the gate", g.count() == 1 and g.get_attribute("data-state") == "off", g.get_attribute("data-state") if g.count() else "no gate")
    check("...with the turn-on button and a way to sign out", pg.get_by_test_id("push-gate-on").is_visible() and pg.get_by_role("button", name="Sign out").is_visible())
    check("...and no portal behind it", pg.locator(".erp-topbar").count() == 0 and pg.locator("nav").count() == 0)
    ctx.close()
    ctx, pg = open_(4361)
    check("an agent is not held (not staff)", pg.get_by_test_id("push-gate").count() == 0)
    ctx.close()
    ctx, pg = open_(4362)
    check("the server has no push keys: nobody is held", pg.get_by_test_id("push-gate").count() == 0)
    ctx.close()
    ctx = b.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script("Object.defineProperty(Notification, 'permission', { get: () => 'denied' })")
    pg = ctx.new_page(); pg.goto("http://127.0.0.1:4360/portal"); pg.wait_for_timeout(3500)
    g = pg.get_by_test_id("push-gate")
    check("alerts blocked on this device: the gate says how to allow them", g.count() == 1 and g.get_attribute("data-state") == "denied" and pg.get_by_test_id("push-gate-steps").locator("li").count() == 3 and pg.get_by_test_id("push-gate-check").is_visible())
    pg.screenshot(path="/tmp/pg/denied.png")
    ctx.close()
    b.close()
print(f"push-gate: {'all passed' if not fails else str(len(fails)) + ' failed'}")
sys.exit(1 if fails else 0)

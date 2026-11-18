"""v1.362.0 - the phone's photo opens the SAME account menu as the desktop's name card (the CEO, 18-11-2026).
Server (this build): 4370 ROLE=ceo."""
import sys
from playwright.sync_api import sync_playwright
fails = []
def check(name, ok, extra=""):
    print(("ok   " if ok else "FAIL ") + name + (f" - {extra}" if not ok and extra else ""))
    if not ok: fails.append(name)
with sync_playwright() as p:
    b = p.chromium.launch()
    d = b.new_page(viewport={"width": 1440, "height": 900}); d.goto("http://127.0.0.1:4370/portal"); d.wait_for_timeout(3500)
    d.locator("[aria-controls=rail-account-menu]").click(); d.wait_for_timeout(400)
    desk = [t.strip() for t in d.locator("#rail-account-menu button").all_inner_texts()]
    pg = b.new_page(viewport={"width": 390, "height": 844}); pg.goto("http://127.0.0.1:4370/portal"); pg.wait_for_timeout(3500)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    pg.get_by_test_id("phone-profile").click(); pg.wait_for_timeout(600)
    m = pg.get_by_test_id("phone-account-menu")
    phone = [t.strip() for t in m.locator("button").all_inner_texts() if t.strip()]
    check("the photo opens the account menu (not Profile straight away)", m.is_visible())
    check("the phone lists exactly what the desktop lists", phone == desk, f"{phone} vs {desk}")
    check("...including Sign out", any("Sign out" in t for t in phone))
    m.get_by_role("button", name="Profile").click(); pg.wait_for_timeout(800)
    check("Profile is one tap away and closes the menu", pg.get_by_test_id("phone-account-menu").count() == 0)
    pg.get_by_test_id("phone-profile").click(); pg.wait_for_timeout(500)
    pg.get_by_test_id("account-signout").click(); pg.wait_for_timeout(1500)
    check("Sign out signs out", pg.get_by_text("Sign in required").count() > 0 or "login" in pg.url)
    b.close()
print(f"account-menu: {'all passed' if not fails else str(len(fails)) + ' failed'}")
sys.exit(1 if fails else 0)

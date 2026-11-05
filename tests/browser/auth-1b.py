"""SECURE AUTHENTICATION 2.0, PHASE 1b (v1.265.0) - Connect Google, in a browser.

claude/AUTH-2.0-AUDIT.md revision 3 sec. 3.3: Profile -> Security -> Google
sign-in. Not connected: Connect Google asks for the authenticator code, then
the browser goes to Google (the fixture answers with Google's address; the
probe stops the navigation there). Back from Google (?google=connected) the
Profile opens on Security and says how it went, and the address is cleaned.
Connected (GLINKED=1): the pill says so and there is no Connect button. The
admin console's Account tab carries the same panel. Nothing is wider than the
screen at 390 / 320 px.

What the worker decides (PKCE, the ID token, same session, single use) is
proven by direct request in tests/go-live-x.mjs.

    ROLE=ceo node tests/browser/serve.mjs out 4231
    ROLE=ceo GLINKED=1 node tests/browser/serve.mjs out 4243
    ROLE=super_admin node tests/browser/serve.mjs out 4244
    python3 tests/browser/auth-1b.py
"""
from playwright.sync_api import sync_playwright
import json

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
CEO, LINKED, ROOT = 4231, 4243, 4244
FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"

def page(b, port, path, w=1440, h=1000, dark=False):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500, reduced_motion="reduce", color_scheme="dark" if dark else "light")
    went = []
    ctx.route("https://accounts.google.com/**", lambda route: (went.append(route.request.url), route.fulfill(status=200, content_type="text/html", body="<p>Google (fixture)</p>")))
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(3000)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs, reqs, went

def panel(pg): return pg.locator("section[aria-label='Connected Google account']")

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- not connected: connect with the code ----
    ctx, pg, errs, reqs, went = page(b, CEO, "/portal?tab=Profile")
    pg.get_by_role("tab", name="Security & Account").first.click() if pg.get_by_role("tab", name="Security & Account").count() else pg.get_by_role("button", name="Security & Account").first.click()
    pg.wait_for_timeout(800)
    gp = panel(pg)
    t = gp.inner_text() if gp.count() else ""
    check("Profile -> Security shows Connected Google account, Not connected", gp.count() == 1 and "Not connected" in t, t[:200])
    gp.get_by_role("button", name="Connect Google", exact=True).click(); pg.wait_for_timeout(300)
    go = gp.get_by_role("button", name="Continue to Google")
    check("Connect Google asks for the authenticator code first (Continue is off until six digits)", gp.get_by_label("Authenticator code").count() == 1 and go.is_disabled())
    gp.get_by_label("Authenticator code").fill("111111"); go.click(); pg.wait_for_timeout(900)
    check("a wrong code says so and stays on the page", "not correct" in gp.inner_text() and not went, gp.inner_text()[:300])
    gp.get_by_label("Authenticator code").fill("123456"); gp.get_by_role("button", name="Continue to Google").click(); pg.wait_for_timeout(1500)
    posts = [json.loads(x[2]) for x in reqs if x[0] == "POST" and x[1].endswith("/auth/google/connect")]
    check("the right code sends only the code and where to come back to", posts and posts[-1] == {"totp": "123456", "return_to": "portal"}, posts)
    check("...and the browser goes to Google", went and went[-1].startswith("https://accounts.google.com/o/oauth2/v2/auth"), went)
    check("no page error (connect)", not errs, errs)
    ctx.close()

    # ---- back from Google ----
    for outcome, words in [("connected", "Google is connected"), ("refused", "could not be connected"), ("failed", "nothing was changed")]:
        ctx, pg, errs, reqs, went = page(b, CEO, f"/portal?tab=Profile&google={outcome}")
        gp = panel(pg)
        t = gp.inner_text() if gp.count() and gp.is_visible() else ""
        check(f"back from Google ({outcome}): Profile opens on Security and says how it went", words in t, t[:300])
        check(f"...the address is cleaned ({outcome})", "google=" not in pg.url, pg.url)
        check(f"no page error ({outcome})", not errs, errs)
        ctx.close()

    # ---- already connected ----
    ctx, pg, errs, reqs, went = page(b, LINKED, "/portal?tab=Profile&google=connected")
    gp = panel(pg)
    t = gp.inner_text() if gp.count() else ""
    check("connected: the pill says Connected, no Connect button, Disconnect offered (1.266.0)", "Connected" in t and "Not connected" not in t and gp.get_by_role("button", name="Connect Google", exact=True).count() == 0 and gp.get_by_role("button", name="Disconnect Google").count() == 1, t[:300])
    ctx.close()

    # ---- the admin console ----
    ctx, pg, errs, reqs, went = page(b, ROOT, "/admin?google=connected")
    gp = panel(pg)
    check("the admin console opens its Account tab with the same panel", gp.count() == 1 and gp.is_visible() and "Google is connected" in gp.inner_text(), pg.url)
    ctx.close()

    # ---- phones, both themes ----
    for port, w, dark in [(CEO, 390, False), (CEO, 320, True), (LINKED, 390, True)]:
        ctx, pg, errs, reqs, went = page(b, port, "/portal?tab=Profile&google=failed", w, 844, dark)
        gp = panel(pg)
        if gp.count() and gp.get_by_role("button", name="Connect Google", exact=True).count():
            gp.get_by_role("button", name="Connect Google", exact=True).click(); pg.wait_for_timeout(300)
            check(f"{w}px: the code field and both buttons are touch-sized", all(x.bounding_box()["height"] >= 40 for x in [gp.get_by_label("Authenticator code"), gp.get_by_role("button", name="Continue to Google"), gp.get_by_role("button", name="Cancel")]))
        check(f"{w}px {'dark' if dark else 'light'}: no sideways page", pg.evaluate(FITS), pg.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]"))
        if gp.count(): gp.screenshot(path=f"/tmp/auth1b-{w}-{'dark' if dark else 'light'}-{port}.png")
        check(f"{w}px: no page error", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nauth-1b: {len(results) - len(failed)} of {len(results)} passed")
raise SystemExit(1 if failed else 0)

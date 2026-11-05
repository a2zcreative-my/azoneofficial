"""SECURE AUTHENTICATION 2.0, PHASE 1a (v1.264.0) - the login page, in a browser.

claude/AUTH-2.0-AUDIT.md revision 3 (approved by phase), G4 and sec. 10:
a Google sign-in that owes a code lands on /login?2fa=1 with its challenge in
an HttpOnly cookie scoped to /api/v1/auth/2fa. The page cannot read it and
never asks for it: it shows the code screen and sends ONLY the code; the
browser carries the cookie. A challenge that lapsed sends the person back to
the sign-in form, which says why. The Google button follows GET /auth/methods;
with Google switched off it is gone and ?error=google_off says so. Password
sign-in is unchanged. Nothing is wider than the screen at 390 / 320 px.

What the worker decides is proven by direct request in tests/go-live-x.mjs.

    TWOFA=1 LOGIN_FIRST=1 node tests/browser/serve.mjs out 4241
    GOOGLE_OFF=1 LOGIN_FIRST=1 node tests/browser/serve.mjs out 4242
    python3 tests/browser/auth-1a.py
"""
from playwright.sync_api import sync_playwright
import json, urllib.request

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
ON, OFF = 4241, 4242
FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"

def page(b, port, path, w=1440, h=1000, dark=False, cookie=None):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500, reduced_motion="reduce", color_scheme="dark" if dark else "light")
    if cookie:
        ctx.add_cookies([{"name": "twofa_ch", "value": cookie, "domain": "127.0.0.1", "path": "/api/v1/auth/2fa", "httpOnly": True, "secure": False, "sameSite": "Lax"}])
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()  # signed out again
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data, r.headers)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(2200)
    return ctx, pg, errs, reqs

def verifies(reqs): return [r for r in reqs if r[0] == "POST" and r[1].endswith("/auth/2fa/verify")]

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- a Google sign-in that owes a code ----
    ctx, pg, errs, reqs = page(b, ON, "/login?2fa=1", cookie="ch-google")
    body = pg.inner_text("body")
    check("?2fa=1 opens the code screen", "Two-factor verification" in body, body[:200])
    check("the page's script cannot read the challenge (HttpOnly)", "twofa_ch" not in pg.evaluate("document.cookie"), pg.evaluate("document.cookie"))
    pg.locator("#code").press_sequentially("123456"); pg.wait_for_timeout(1800)
    v = verifies(reqs)
    sent = json.loads(v[0][2]) if v else {}
    check("the sixth digit sends ONLY the code - no challenge in the body", len(v) == 1 and sent == {"code": "123456"}, sent)
    check("...the browser carries the cookie itself, and the person is signed in", "/portal" in pg.url, pg.url)
    check("no page error (code via cookie)", not errs, errs)
    ctx.close()

    # ---- the challenge lapsed while the code was typed ----
    ctx, pg, errs, reqs = page(b, ON, "/login?2fa=1", cookie="ch-google")
    pg.locator("#code").press_sequentially("999999"); pg.wait_for_timeout(1500)
    body = pg.inner_text("body")
    check("a lapsed challenge goes back to the sign-in form and says why", "Two-factor verification" not in body and "expired" in body and pg.locator("#email").count() == 1, body[:300])
    ctx.close()

    # ---- password sign-in is as it was ----
    ctx, pg, errs, reqs = page(b, ON, "/login")
    check("with Google on, Continue with Google shows", pg.get_by_role("link", name="Continue with Google").count() == 1)
    pg.locator("#email").fill("fixture@example.test"); pg.locator("#password").fill("correct horse")
    pg.get_by_role("button", name="Sign in").first.click(); pg.wait_for_timeout(1200)
    pg.locator("#code").press_sequentially("123456"); pg.wait_for_timeout(1800)
    v = verifies(reqs)
    check("a password sign-in still sends its challenge in the body", len(v) == 1 and json.loads(v[0][2]) == {"challenge": "ch-fixture", "code": "123456"} and "/portal" in pg.url, [v[0][2] if v else None, pg.url])
    check("GET /auth/methods is read once", len([r for r in reqs if r[0] == "GET" and r[1].endswith("/auth/methods")]) == 1)
    check("no page error (password)", not errs, errs)
    ctx.close()

    # ---- Google switched off by the owner ----
    ctx, pg, errs, reqs = page(b, OFF, "/login")
    check("with Google off, the button is gone and the form stays", pg.get_by_role("link", name="Continue with Google").count() == 0 and pg.locator("#email").count() == 1 and pg.locator("#password").count() == 1)
    ctx.close()
    ctx, pg, errs, reqs = page(b, OFF, "/login?error=google_off")
    body = pg.inner_text("body")
    check("?error=google_off says Google is off and to use email and password", "Google sign-in is switched off for now" in body and pg.get_by_role("link", name="Continue with Google").count() == 0, body[:300])
    check("no page error (Google off)", not errs, errs)
    ctx.close()
    ctx, pg, errs, reqs = page(b, ON, "/login?error=oauth")
    check("?error=oauth still says the one neutral sentence", "Unable to sign in with the provided credentials." in pg.inner_text("body"))
    ctx.close()
    # v1.266.1 - the reference and the staff line under a failed Google sign-in
    ctx, pg, errs, reqs = page(b, ON, "/login?error=oauth&ref=A-1B2C3D")
    body = pg.inner_text("body")
    check("a failed Google sign-in shows its reference and tells staff to connect Google from Profile", "Reference: A-1B2C3D" in body and "connect Google once from Profile" in body, body[:400])
    ctx.close()
    ctx, pg, errs, reqs = page(b, ON, "/login?error=oauth&ref=<script>x")
    check("...a malformed reference is not shown", "Reference:" not in pg.inner_text("body"))
    ctx.close()

    # ---- phones, both themes ----
    for port, path, w, dark in [(ON, "/login", 390, False), (OFF, "/login?error=google_off", 320, True), (ON, "/login?2fa=1", 390, True)]:
        ctx, pg, errs, reqs = page(b, port, path, w, 844, dark, cookie="ch-google" if "2fa" in path else None)
        check(f"{path} {w}px {'dark' if dark else 'light'}: no sideways page", pg.evaluate(FITS), pg.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]"))
        pg.screenshot(path=f"/tmp/auth1a-{w}-{'dark' if dark else 'light'}-{path.split('?')[-1].replace('=', '-').replace('/', '')}.png")
        check(f"{w}px: no page error", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nauth-1a: {len(results) - len(failed)} of {len(results)} passed")
raise SystemExit(1 if failed else 0)

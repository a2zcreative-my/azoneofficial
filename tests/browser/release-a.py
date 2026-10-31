"""RELEASE A OF THE GO-LIVE PLAN (v1.241.0) - the three client fixes, in a browser.

A1  the 2FA sign-in box takes a BACKUP CODE (letters, digits, dash), and a
    six-digit authenticator code still signs in by itself.
A3  after enrolling 2FA on the gate, the portal opens without a sign-out
    (the backup codes stay on screen until "I have saved them - continue").
F6  a deploy under an open portal: a dead chunk reloads the page once, a
    second dead chunk shows the "new version" screen (no loop), and the
    ten-minute health poll offers "Update available".

Servers (tests/browser/serve.mjs on a production build in out/):
    TWOFA=1 ROLE=ceo            node tests/browser/serve.mjs out 4199
    TWOFA=1 LOGIN_FIRST=1       node tests/browser/serve.mjs out 4203   (A1: signed out until the code)
    HEALTH_VERSION=9.9.9        node tests/browser/serve.mjs out 4200
    ROLE=ceo                    node tests/browser/serve.mjs out 4201   (chunks broken by /__break)
    ROLE=ceo                    node tests/browser/serve.mjs out 4202   (chunks broken for good)

    xvfb-run -a python3 tests/browser/release-a.py
"""
from playwright.sync_api import sync_playwright
import json, re, sys, urllib.request

S = "/home/claude/work"
res = []
def check(n, c, x=""): res.append(("PASS " if c else "FAIL ") + n + (f" — {x}" if x and not c else ""))
def status(port): return json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/__fixture-status"))
def brk(port, on, once=False): urllib.request.urlopen(f"http://127.0.0.1:{port}/__break?on={'1' if on else '0'}{'&once=1' if once else ''}").read()

def page(b, port, path="/portal", w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(2500)
    return pg, errs, reqs

def tab(pg, name):
    btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count() == 0:
        m = pg.get_by_role("button", name="More").filter(visible=True)
        if m.count(): m.first.click(); pg.wait_for_timeout(500)
        btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count(): btn.first.click(); return True
    return False

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- A1: the sign-in code box ----------------
    pg, errs, reqs = page(b, 4203, "/login")
    pg.locator("#email").fill("fixture@example.test")
    pg.locator("#password").fill("correct horse")
    pg.get_by_role("button", name=re.compile("Sign in", re.I)).first.click(); pg.wait_for_timeout(1200)
    body = pg.inner_text("body")
    check("A1 the password is accepted and the code screen opens", "Two-factor verification" in body and "backup code" in body.lower(), body[:200].replace("\n", " | "))
    code = pg.locator("#code")
    check("A1 the box is labelled for both kinds of code and takes eleven characters", pg.get_by_label("Authenticator or backup code").count() == 1 and code.get_attribute("maxlength") == "11" and code.get_attribute("pattern") is None)
    verifies = lambda: [r for r in reqs if r[0] == "POST" and r[1].endswith("/auth/2fa/verify")]
    code.press_sequentially("11111"); pg.wait_for_timeout(400)
    check("A1 five digits do not submit", len(verifies()) == 0 and pg.get_by_role("button", name=re.compile("Verify and sign in")).is_disabled())
    code.press_sequentially("1"); pg.wait_for_timeout(900)
    v = verifies()
    check("A1 the sixth digit signs in by itself (one POST, code 111111)", len(v) == 1 and json.loads(v[0][2])["code"] == "111111", str(v))
    check("A1 a wrong code says so and offers a backup code", "not correct" in pg.inner_text("body") and "backup code" in pg.inner_text("body").lower())
    code.fill(""); code.press_sequentially("aaaa21111b"); pg.wait_for_timeout(400)
    check("A1 a backup code typed in lower case without its dash becomes AAAA2-1111B", code.input_value() == "AAAA2-1111B", code.input_value())
    check("A1 letters switch the keyboard to text", code.get_attribute("inputmode") == "text", str(code.get_attribute("inputmode")))
    check("A1 a backup code waits for Verify (no auto-submit) and Verify is enabled", len(verifies()) == 1 and pg.get_by_role("button", name=re.compile("Verify and sign in")).is_enabled())
    pg.get_by_role("button", name=re.compile("Verify and sign in")).click(); pg.wait_for_timeout(2500)
    v = verifies()
    check("A1 Verify sends the backup code exactly as issued and signs in", len(v) == 2 and json.loads(v[1][2])["code"] == "AAAA2-1111B" and "/portal" in pg.url, f"{[json.loads(x[2])['code'] for x in v]} {pg.url}")
    pg.screenshot(path=f"{S}/ra-a1.png")
    check("A1 no page errors", not errs, str(errs)[:200])
    pg.context.close()

    # ---------------- A3: the 2FA gate clears without a sign-out ----------------
    pg, errs, reqs = page(b, 4199, "/portal")
    loads0 = status(4199)["portal_loads"]
    body = pg.inner_text("body")
    check("A3 the gate shows for an account that owes 2FA", "Two-Factor Authentication Required" in body, body[:160].replace("\n", " | "))
    pg.get_by_label("Current password").fill("correct horse")
    pg.get_by_role("button", name="Turn on two-factor").click(); pg.wait_for_timeout(800)
    check("A3 setup shows the key and asks for the code", "JBSWY3DPEHPK3PXP" in pg.inner_text("body") and "Enter the 6-digit code" in pg.inner_text("body"))
    pg.get_by_placeholder("000000").fill("123456")
    pg.get_by_role("button", name="Confirm and turn on").click(); pg.wait_for_timeout(1200)
    body = pg.inner_text("body")
    check("A3 the backup codes are on screen, inside the gate, after enabling", "Save these backup codes now" in body and "AAAA-1111" in body and "HHHH-8888" in body and "Two-Factor Authentication Required" in body, body[:300].replace("\n", " | "))
    cont = pg.get_by_role("button", name="I have saved them — continue")
    check("A3 the way on is 'I have saved them — continue'", cont.count() == 1)
    me_before = len([r for r in reqs if r[0] == "GET" and r[1].endswith("/auth/me")])
    pg.screenshot(path=f"{S}/ra-a3-codes.png")
    cont.click(); pg.wait_for_timeout(2500)
    body = pg.inner_text("body")
    me_after = len([r for r in reqs if r[0] == "GET" and r[1].endswith("/auth/me")])
    check("A3 /auth/me is read again and the gate clears", me_after == me_before + 1 and "Two-Factor Authentication Required" not in body, f"me {me_before}->{me_after}; {body[:160]!r}")
    check("A3 the portal opens: Dashboard with its tabs, no sign-out, no page reload", pg.get_by_role("tab", name="Overview", exact=True).filter(visible=True).count() == 1 and status(4199)["portal_loads"] == loads0 and status(4199)["twofa_on"])
    pg.screenshot(path=f"{S}/ra-a3-open.png")
    check("A3 no page errors", not errs, str(errs)[:200])
    pg.context.close()

    # ---------------- F6a: Update available ----------------
    pg, errs, reqs = page(b, 4200, "/portal")
    pg.wait_for_timeout(5500)
    bar = pg.get_by_test_id("update-available")
    check("F6 within seconds of opening, 'Update available' names both versions", bar.count() == 1 and "v9.9.9" in bar.inner_text() and re.search(r"this screen is on v\d+\.\d+\.\d+", bar.inner_text()) is not None, bar.inner_text() if bar.count() else "no bar")
    health = [r for r in reqs if r[1].endswith("/api/v1/health")]
    check("F6 one unauthenticated health read so far", len(health) == 1, str(len(health)))
    check("F6 the bar offers Reload and Later", bar.get_by_role("button", name="Reload").count() == 1 and bar.get_by_role("button", name="Later").count() == 1)
    pg.screenshot(path=f"{S}/ra-f6-update.png")
    bar.get_by_role("button", name="Later").click(); pg.wait_for_timeout(300)
    check("F6 Later puts it away", pg.get_by_test_id("update-available").count() == 0)
    check("F6 no page errors", not errs, str(errs)[:200])
    pg.context.close()
    # the same version: no bar
    pg, errs, reqs = page(b, 4201, "/portal")
    pg.wait_for_timeout(5500)
    check("F6 on the current version there is no bar", pg.get_by_test_id("update-available").count() == 0)
    pg.context.close()

    # ---------------- F6b: a dead chunk reloads once, and the reload fixes it ----------------
    pg, errs, reqs = page(b, 4201, "/portal")
    loads0 = status(4201)["portal_loads"]
    brk(4201, True, once=True)
    check("F6 the tab to open has not been visited (its chunk is unserved)", tab(pg, "Inventory"))
    pg.wait_for_timeout(4000)
    st = status(4201)
    body = pg.inner_text("body")
    check("F6 the dead chunk was asked for (404) and the page reloaded itself exactly once", st["chunk_404s"] >= 1 and st["portal_loads"] == loads0 + 1, json.dumps(st))
    check("F6 after the reload the tab opens on the new build", "Inventory" in body and "Something went wrong" not in body and "new version" not in body.lower(), body[:200].replace("\n", " | "))
    pg.screenshot(path=f"{S}/ra-f6-reloaded.png")
    pg.context.close()
    brk(4201, False)

    # ---------------- F6c: a chunk dead for good: one reload, then the screen, no loop ----------------
    pg, errs, reqs = page(b, 4202, "/portal")
    loads0 = status(4202)["portal_loads"]
    brk(4202, True)
    tab(pg, "Inventory"); pg.wait_for_timeout(5000)
    st = status(4202)
    body = pg.inner_text("body")
    check("F6 one self-reload only, although the chunk is still dead", st["portal_loads"] == loads0 + 1 and st["chunk_404s"] >= 2, json.dumps(st))
    check("F6 the second failure shows the 'new version' screen with a Reload button, not 'Try again'", "A new version of the portal was published" in body and pg.get_by_test_id("chunk-reload").count() == 1 and "Try again" not in body, body[:200].replace("\n", " | "))
    pg.wait_for_timeout(3000)
    check("F6 and it stays put - no reload loop", status(4202)["portal_loads"] == loads0 + 1)
    pg.screenshot(path=f"{S}/ra-f6-screen.png")
    brk(4202, False)
    pg.get_by_test_id("chunk-reload").click(); pg.wait_for_timeout(4000)
    check("F6 the manual Reload fetches the working chunks", status(4202)["portal_loads"] == loads0 + 2 and "Inventory" in pg.inner_text("body") and "new version" not in pg.inner_text("body").lower())
    pg.context.close()

    b.close()

for r in res: print(r)
fails = [r for r in res if r.startswith("FAIL")]
print(f"\n{len(res) - len(fails)} of {len(res)} passed")
sys.exit(1 if fails else 0)

"""SECURE AUTHENTICATION 2.0, PHASE 1c (v1.266.0) - customers and Google, in a browser.

claude/AUTH-2.0-AUDIT.md revision 3 sec. 3.3, 3.4, R8, R9, R11:
  - the customer account page: Connected Google account; Connect asks for the
    password, then the code emailed to them, then goes to Google;
  - Profile -> Security for the company owner: Sign-in settings (Google,
    customer sign-up, the legacy window) - Save waits for a reason and the
    authenticator code; the legacy notice is shown word for word;
  - Users -> Customers & Agents: Recover sign-in - who checked the identity,
    how, a reason, then the authenticator code; a set-password link shown
    once when email sending is not set up.
Nothing is wider than the screen at 390 / 320 px.

What the worker decides is proven by direct request in tests/go-live-x.mjs.

    ROLE=customer node tests/browser/serve.mjs out 4245
    ROLE=ceo OWNER=1 node tests/browser/serve.mjs out 4246
    python3 tests/browser/auth-1c.py
"""
from playwright.sync_api import sync_playwright
import json

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
CUST, OWNER = 4245, 4246
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
def posts(reqs, end): return [json.loads(x[2] or "{}") for x in reqs if x[0] in ("POST", "PUT") and x[1].split("?")[0].endswith(end)]

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the customer: password, emailed code, Google ----
    ctx, pg, errs, reqs, went = page(b, CUST, "/account")
    gp = pg.locator("section[aria-label='Connected Google account']")
    t = gp.inner_text() if gp.count() else ""
    check("the account page shows Connected Google account, with the password + emailed code wording", gp.count() == 1 and "Not connected" in t and "code we email you" in t, t[:300])
    gp.get_by_role("button", name="Connect Google", exact=True).click(); pg.wait_for_timeout(300)
    check("Connect asks for the password first (no authenticator code for a customer)", gp.get_by_label("Your password").count() == 1 and gp.get_by_label("Authenticator code").count() == 0)
    gp.get_by_label("Your password").fill("wrong"); gp.get_by_role("button", name="Email me a code").click(); pg.wait_for_timeout(700)
    check("a wrong password says so", "not correct" in gp.inner_text(), gp.inner_text()[:200])
    gp.get_by_label("Your password").fill("correct horse"); gp.get_by_role("button", name="Email me a code").click(); pg.wait_for_timeout(700)
    t = gp.inner_text()
    check("the right password: we emailed a code to the masked address", "fi***@example.test" in t and gp.get_by_label("Code from the email").count() == 1, t[:300])
    check("...the password went only to /auth/google/code, with what it is for", posts(reqs, "/auth/google/code")[-1] == {"purpose": "connect", "password": "correct horse"}, posts(reqs, "/auth/google/code"))
    gp.get_by_label("Code from the email").fill("123456"); gp.get_by_role("button", name="Continue to Google").click(); pg.wait_for_timeout(1500)
    check("the code alone goes to Connect (no return_to for a customer), then the browser goes to Google", posts(reqs, "/auth/google/connect")[-1] == {"code": "123456"} and went, [posts(reqs, "/auth/google/connect"), went])
    check("no page error (customer)", not errs, errs)
    ctx.close()
    ctx, pg, errs, reqs, went = page(b, CUST, "/account?google=connected")
    gp = pg.locator("section[aria-label='Connected Google account']")
    check("back from Google on the account page, it says so and cleans the address", "Google is connected" in (gp.inner_text() if gp.count() else "") and "google=" not in pg.url, pg.url)
    ctx.close()

    # ---- the owner: Sign-in settings ----
    ctx, pg, errs, reqs, went = page(b, OWNER, "/portal?tab=Profile&google=failed")
    sp = pg.locator("section[aria-label='Sign-in settings']")
    t = sp.inner_text() if sp.count() else ""
    check("Profile -> Security shows the owner's Sign-in settings: Google on, the legacy window closed, how many remain", sp.count() == 1 and "Google on" in t and "Legacy window closed" in t and "4 customer(s)" in t, t[:400])
    save = sp.get_by_role("button", name="Save settings")
    sp.get_by_label("New customers may sign up with Google").uncheck(); pg.wait_for_timeout(200)
    check("Save waits for a reason and the authenticator code", save.is_disabled())
    sp.get_by_label("Reason (kept in the audit history)").fill("Customers by invitation for now"); sp.get_by_label("Authenticator code").fill("123456"); pg.wait_for_timeout(200)
    save.click(); pg.wait_for_timeout(900)
    put = posts(reqs, "/staff/auth/settings")
    check("...and sends only what changed (the window untouched), the reason and the code", put and put[-1] == {"google": {"enabled": True, "customer_signup": False}, "reason": "Customers by invitation for now", "totp": "123456"}, put)
    sp.get_by_role("button", name="Read the legacy notice").click(); pg.wait_for_timeout(700)
    letter = sp.locator("pre")
    check("the legacy notice is shown word for word, with the reminder to open the window first", letter.count() == 1 and "You created your A2Z Creative Marketing account" in letter.inner_text() and "Open the window first" in sp.inner_text())
    check("no page error (owner settings)", not errs, errs)
    ctx.close()

    # ---- customer recovery ----
    ctx, pg, errs, reqs, went = page(b, OWNER, "/portal?tab=Users")
    tabs = pg.get_by_role("tab", name="Customers & Agents")
    if tabs.count(): tabs.first.click(); pg.wait_for_timeout(800)
    btn = pg.get_by_test_id("recover-9101")
    check("a customer row carries Recover sign-in", btn.count() == 1)
    if btn.count():
        btn.click(); pg.wait_for_timeout(1200)
        dlg = pg.locator("[role=dialog]").filter(has_text="Recover access")
        check("the sheet shows the customer's sign-in state", dlg.count() == 1 and "Legacy Google customer" in dlg.inner_text() and "Google only" in dlg.inner_text(), dlg.inner_text()[:300] if dlg.count() else "")
        check("Disconnect Google is off when Google is not connected", dlg.get_by_role("button", name="Disconnect Google").is_disabled())
        dlg.get_by_role("button", name="Send a set-password link").first.click(); pg.wait_for_timeout(300)
        go = dlg.get_by_role("button", name="Send a set-password link").last
        check("the action waits for who checked, how, and a reason", go.is_disabled())
        dlg.get_by_label("Who checked their identity").fill("Fixture Person"); dlg.get_by_label("WhatsApp video call").check()
        dlg.get_by_label("Reason (at least 10 characters, kept in the audit history)").fill("Lost access to the Gmail account")
        check("...email sending not set up: the sheet says the link is shown once", "shown here once" in dlg.inner_text())
        go.click(); pg.wait_for_timeout(900)
        code = pg.get_by_label("Your 6-digit authenticator code - this changes how this customer signs in")
        check("the authenticator code is asked for, saying what it is for", code.count() == 1)
        if code.count():
            code.fill("123456"); pg.keyboard.press("Enter"); pg.wait_for_timeout(1200)
        sent = posts(reqs, "/password-link")
        check("the server gets who, how, the reason and the code", sent and sent[-1].get("identity_checked") == "Fixture Person" and sent[-1].get("identity_method") == "whatsapp_video" and sent[-1].get("totp") == "123456", sent)
        check("...and the link is shown once to hand over", pg.locator("input[aria-label='Set-password link']").count() == 1)
    check("no page error (recovery)", not errs, errs)
    ctx.close()

    # ---- phones, both themes ----
    for port, path, w, dark in [(CUST, "/account", 390, False), (CUST, "/account", 320, True), (OWNER, "/portal?tab=Profile&google=failed", 390, True)]:
        ctx, pg, errs, reqs, went = page(b, port, path, w, 844, dark)
        check(f"{path} {w}px {'dark' if dark else 'light'}: no sideways page", pg.evaluate(FITS), pg.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]"))
        sec = pg.locator("section[aria-label='Sign-in settings'], section[aria-label='Connected Google account']").first
        if sec.count(): sec.screenshot(path=f"/tmp/auth1c-{w}-{'dark' if dark else 'light'}-{port}.png")
        check(f"{w}px: no page error", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nauth-1c: {len(results) - len(failed)} of {len(results)} passed")
raise SystemExit(1 if failed else 0)

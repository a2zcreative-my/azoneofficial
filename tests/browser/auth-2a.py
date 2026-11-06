"""SECURE AUTHENTICATION 2.0, PHASE 2A (v1.269.0) - passkeys, in a REAL browser.

Chromium's virtual authenticator (DevTools WebAuthn domain: a platform
authenticator with user verification, like Face ID or Windows Hello) makes and
uses a real passkey; what the page posts is then run through the worker's own
verifier (worker/src/webauthn.ts, tests/browser/verify-webauthn.mjs). This is
NOT the real-device test the rollout needs (iPhone, Android, Windows Hello, a
security key) - that stays open until done by hand.

  - Profile -> Security (the company owner, stage A): the Passkeys card; Add
    needs the authenticator code; the device makes the passkey; it is listed;
    Remove asks for a code first; the owner's Sign-in settings show the stage
  - the login page: "Continue with passkey" signs in (twice: the counter moves)
  - stage off: no passkey button; at stage A an editor sees no Passkeys card
  - v1.270.0: at stage C an editor and an agent each see the card and can add
    one; the owner's Sign-in settings choose the stage (off / A / B / C) and,
    for B, the pilots; the account sheet removes a person's passkeys (identity
    check + reason) and marks the devices a passkey signed in
  - what the browser posted verifies in the worker's verifier; the same answer
    for another origin or another challenge does not
Nothing is wider than the screen at 390 / 320 px.

    ROLE=ceo OWNER=1 PASSKEYS=1 node tests/browser/serve.mjs out 4252
    ROLE=ceo PASSKEYS=1 LOGIN_FIRST=1 node tests/browser/serve.mjs out 4253
    ROLE=ceo LOGIN_FIRST=1 node tests/browser/serve.mjs out 4254
    ROLE=editor PASSKEYS=1 node tests/browser/serve.mjs out 4255
    ROLE=editor PASSKEYS=C node tests/browser/serve.mjs out 4256
    ROLE=agent PASSKEYS=C node tests/browser/serve.mjs out 4257
    python3 tests/browser/auth-2a.py
"""
from playwright.sync_api import sync_playwright
import json, subprocess, urllib.request, os, base64

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
OWNER, LOGIN, OFF, ED, EDC, AGC = 4252, 4253, 4254, 4255, 4256, 4257
FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def fx(port, path): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}").read())

def security(pg, port):
    pg.goto(f"http://localhost:{port}/portal?tab=Profile"); pg.wait_for_timeout(2800)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    if pg.get_by_role("tab", name="Security & Account").count() == 0 and pg.get_by_role("button", name="Security & Account").count() == 0:
        pg.get_by_role("button", name="Profile").first.click(); pg.wait_for_timeout(1500)  # an agent reaches Profile from their menu
    t = pg.get_by_role("tab", name="Security & Account")
    (t if t.count() else pg.get_by_role("button", name="Security & Account")).first.click(); pg.wait_for_timeout(900)
def card(pg): return pg.locator("section[aria-label='Passkeys']")

with sync_playwright() as p:
    b = p.chromium.launch()
    fx(OWNER, "/__reset"); fx(LOGIN, "/__reset")

    # ---- the owner adds a passkey (a virtual platform authenticator with user verification) ----
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    cdp = ctx.new_cdp_session(pg)
    cdp.send("WebAuthn.enable")
    auth = cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {"protocol": "ctap2", "transport": "internal", "hasResidentKey": True, "hasUserVerification": True, "isUserVerified": True, "automaticPresenceSimulation": True}})["authenticatorId"]
    security(pg, OWNER)
    c = card(pg); t = c.inner_text() if c.count() else ""
    check("the owner sees the Passkeys card, stage A on", c.count() == 1 and "On - owner only" in t and "Face ID" in t, t[:300])
    add = c.get_by_role("button", name="Add a passkey")
    check("Add a passkey waits for the authenticator code", add.count() == 1 and add.is_disabled())
    c.get_by_label("Name (e.g. iPhone 15, office laptop)").fill("Fixture phone")
    c.get_by_label("Authenticator code").fill("123456"); pg.wait_for_timeout(150)
    add.click(); pg.wait_for_timeout(2000)
    t = c.inner_text()
    check("the device makes the passkey and it is listed", 'Passkey "Fixture phone" added.' in t and "Fixture phone" in t, t[:400])
    st = fx(OWNER, "/__passkeys")
    opts = [x for x in st["posts"] if x["path"] == "/auth/passkey/register/options"]
    ver = [x for x in st["posts"] if x["path"] == "/auth/passkey/register/verify"]
    check("...the code went with the options request, never with the passkey", opts and opts[-1]["body"] == {"totp": "123456"} and ver and "totp" not in ver[-1]["body"], st["posts"][:3])
    reg = ver[-1]["body"]["credential"] if ver else {}
    check("...the page posted the browser's attestation (client data, attestation object, transports)", reg.get("type") == "public-key" and reg.get("response", {}).get("attestationObject") and reg["response"].get("clientDataJSON") and isinstance(reg["response"].get("transports"), list), json.dumps(reg)[:200])
    creds = cdp.send("WebAuthn.getCredentials", {"authenticatorId": auth})["credentials"]
    check("...a discoverable (resident) credential for rp localhost", len(creds) == 1 and creds[0]["isResidentCredential"] and creds[0]["rpId"] == "localhost", creds)
    c.get_by_role("button", name="Remove").first.click(); pg.wait_for_timeout(300)
    check("Remove asks for the code first (button off until then) and says what it does", c.get_by_role("button", name="Remove passkey").is_disabled() and "signs out every device it signed in" in c.inner_text())
    c.get_by_role("button", name="Keep it").click(); pg.wait_for_timeout(200)
    s = pg.locator("section[aria-label='Sign-in settings']"); stx = s.inner_text() if s.count() else ""
    check("the owner's Sign-in settings show the passkey stage and every stage to choose (off, A, B, C)", "Stage A - company owner only" in stx and all(s.get_by_label(x).count() == 1 for x in ("Off", "A - company owner only", "B - owner and named pilots", "C - all staff and agents")), stx[-400:])
    check("no page error (owner)", not errs, errs)

    # ---- the login page, same browser and authenticator ----
    pg.goto(f"http://localhost:{LOGIN}/login"); pg.wait_for_timeout(1500)
    btn = pg.get_by_role("button", name="Continue with passkey")
    check("the login page offers Continue with passkey when it is on", btn.count() == 1)
    btn.click(); pg.wait_for_timeout(2500)
    check("...the passkey signs the owner in (to the portal)", "/portal" in pg.url, pg.url)
    first = fx(LOGIN, "/__passkeys")
    fx(LOGIN, "/__reset")  # signed out again (this also empties what the fixture kept)
    pg.goto(f"http://localhost:{LOGIN}/login"); pg.wait_for_timeout(1500)
    pg.get_by_role("button", name="Continue with passkey").click(); pg.wait_for_timeout(2500)
    check("...and again", "/portal" in pg.url, pg.url)
    second = fx(LOGIN, "/__passkeys")
    ls = {"posts": first["posts"] + second["posts"], "issued": first["issued"] + second["issued"]}
    logins = [x["body"]["credential"] for x in ls["posts"] if x["path"] == "/auth/passkey/login/verify"]
    issued = [x["challenge"] for x in ls["issued"] if x["path"] == "/auth/passkey/login/options"]
    check("...the page posted two assertions (no password, no code)", len(logins) == 2 and len(issued) >= 2 and all("password" not in json.dumps(l) for l in logins), ls["posts"])

    # ---- the worker's verifier accepts the real browser's answers ----
    reg_ch = [x["challenge"] for x in st["issued"] if x["path"] == "/auth/passkey/register/options"][-1]
    payload = {"rpId": "localhost",
               "reg": {"credential": reg, "challenge": reg_ch, "origin": f"http://localhost:{OWNER}", "userHandle": base64.urlsafe_b64encode(bytes([9]) * 32).decode().rstrip("=")},
               "logins": [{"credential": l, "challenge": issued[i], "origin": f"http://localhost:{LOGIN}"} for i, l in enumerate(logins[:2])]}
    r = subprocess.run(["node", os.path.join(ROOT, "tests/browser/verify-webauthn.mjs")], input=json.dumps(payload), capture_output=True, text=True, cwd=ROOT)
    v = json.loads(r.stdout or "{}") if r.returncode == 0 else {}
    check("the worker's verifier accepts Chromium's real passkey (ES256, user verified)", v.get("registration", {}).get("ok") and v["registration"].get("alg") == -7, (r.stdout + r.stderr)[:400])
    check("...and both real sign-ins, the counter moving forward", len(v.get("logins", [])) == 2 and all(x.get("ok") for x in v["logins"]) and v["logins"][1]["signCount"] > v["logins"][0]["signCount"], v.get("logins"))
    check("...and refuses the same answer for another origin or another challenge", v.get("wrongOrigin", {}).get("reason") == "client_origin" and v.get("wrongChallenge", {}).get("reason") == "client_challenge", v)
    ctx.close()

    # ---- switched off: no button ----
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page()
    pg.goto(f"http://localhost:{OFF}/login"); pg.wait_for_timeout(1500)
    check("with passkeys off the login page has no passkey button", pg.get_by_role("button", name="Continue with passkey").count() == 0 and pg.get_by_role("link", name="Continue with Google").count() == 1)
    ctx.close()
    # ---- without WebAuthn in the browser: no button either ----
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page()
    pg.add_init_script("delete window.PublicKeyCredential")
    pg.goto(f"http://localhost:{LOGIN}/login"); pg.wait_for_timeout(1500)
    check("a browser without passkeys sees no passkey button", pg.get_by_role("button", name="Continue with passkey").count() == 0)
    ctx.close()

    # ---- an editor ----
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page()
    security(pg, ED)
    check("an editor sees no Passkeys card at stage A (and no empty section)", card(pg).count() == 0 and pg.get_by_text("Passkeys", exact=True).count() == 0)
    ctx.close()

    # ---- v1.270.0 stage C: an editor and an agent ----
    for port, who in ((EDC, "an editor"), (AGC, "an agent")):
        ctx = b.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        cdp = ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
        cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {"protocol": "ctap2", "transport": "internal", "hasResidentKey": True, "hasUserVerification": True, "isUserVerified": True, "automaticPresenceSimulation": True}})
        fx(port, "/__reset"); security(pg, port)
        c = card(pg); t = c.inner_text() if c.count() else ""
        check(f"stage C: {who} sees the Passkeys card, on", c.count() == 1 and "On" in t, t[:200])
        if c.count():
            c.get_by_label("Authenticator code").fill("123456"); pg.wait_for_timeout(150)
            c.get_by_role("button", name="Add a passkey").click(); pg.wait_for_timeout(2000)
            check(f"...and {who} adds their own passkey", "added." in c.inner_text(), c.inner_text()[:200])
        check(f"no page error ({who})", not errs, errs)
        ctx.close()

    # ---- v1.270.0 the owner chooses the stage and the pilots ----
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page(); reqs = []
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    security(pg, OWNER)
    s = pg.locator("section[aria-label='Sign-in settings']")
    s.get_by_label("B - owner and named pilots").check(); pg.wait_for_timeout(200)
    grp = s.get_by_role("group", name="Pilots"); gt = grp.inner_text() if grp.count() else ""
    check("choosing stage B lists the staff and agents to pick as pilots, with who lacks two-factor", "Hakim Rosli" in gt and "Siti Ejen" in gt and "no two-factor yet" in gt, gt[:300])
    save = s.get_by_role("button", name="Save passkey stage")
    check("...Save waits for a pilot, the reason and the code", save.is_disabled())
    grp.get_by_label("Hakim Rosli", exact=False).check()
    s.get_by_label("Reason (kept in the audit history)").fill("Passkey pilot with the COO")
    s.get_by_label("Authenticator code").fill("123456"); pg.wait_for_timeout(150)
    save.click(); pg.wait_for_timeout(900)
    put = [json.loads(x[2] or "{}") for x in reqs if x[0] == "PUT" and x[1].endswith("/staff/auth/settings/passkeys")]
    check("...and sends the stage, the pilots, the reason and the code", put and put[-1] == {"stage": "B", "pilot_user_ids": [9003], "reason": "Passkey pilot with the COO", "totp": "123456"}, put)
    ctx.close()

    # ---- v1.270.0 the account sheet: a lost phone ----
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page(); reqs = []
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://localhost:{OWNER}/portal?tab=Users"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    st_tab = pg.get_by_role("tab", name="Staff Accounts", exact=True)
    if st_tab.count(): st_tab.first.click(); pg.wait_for_timeout(1200)
    pg.get_by_test_id("manage-9002").click(); pg.wait_for_timeout(1200)
    sheet = pg.locator("[role=dialog]").filter(has=pg.get_by_test_id("sheet-role")).first
    st_txt = sheet.inner_text() if sheet.count() else ""
    check("the account sheet shows the passkeys and which device a passkey signed in", "Passkey (2)" in st_txt and "· passkey" in st_txt, st_txt[:400])
    sheet.get_by_role("button", name="Remove passkeys (2)").click(); pg.wait_for_timeout(300)
    go = sheet.get_by_role("button", name="Continue")
    check("removing them asks who checked the identity and why (Continue off until both)", go.is_disabled() and "lost or stolen" in sheet.inner_text())
    sheet.get_by_label("Who checked their identity").fill("Fixture Person, video call")
    sheet.get_by_label("Reason (kept in the audit history)").fill("Phone stolen on the way home")
    go.click(); pg.wait_for_timeout(1200)
    rv = [json.loads(x[2] or "{}") for x in reqs if x[0] == "POST" and x[1].endswith("/staff/accounts/9002/passkeys/revoke")]
    check("...and sends them to the account's passkey door", rv and rv[-1].get("identity_checked") == "Fixture Person, video call" and rv[-1].get("reason") == "Phone stolen on the way home", rv)
    ctx.close()

    # ---- phone widths, both themes ----
    for w, dark in ((390, False), (320, True)):
        ctx = b.new_context(viewport={"width": w, "height": 860}, is_mobile=True, has_touch=True, reduced_motion="reduce", color_scheme="dark" if dark else "light"); pg = ctx.new_page()
        security(pg, OWNER)
        check(f"Passkeys card fits at {w}px{' (dark)' if dark else ''}", card(pg).count() == 1 and pg.evaluate(FITS))
        if w == 390: card(pg).screenshot(path="/tmp/auth-2a-card-390.png")
        fx(LOGIN, "/__reset")
        pg.goto(f"http://localhost:{LOGIN}/login"); pg.wait_for_timeout(1200)
        check(f"login page with the passkey button fits at {w}px", "/login" in pg.url and pg.get_by_role("button", name="Continue with passkey").count() == 1 and pg.evaluate(FITS), pg.url)
        if w == 390: pg.screenshot(path="/tmp/auth-2a-login-390.png")
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

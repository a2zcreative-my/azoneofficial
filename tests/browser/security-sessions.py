"""SECURITY & SESSIONS 2 + THE CLOUDFLARE BOT CHECK (v1.341.0) - in a browser.
The source rules are held by tests/security-sessions.mjs. Here, the screens.

Servers (tests/browser/serve.mjs over a production build):
  4200  OWNER=1 SECCF=1 BOTKEY=1x00000000000000000000AA ROLE=ceo  - check on, Cloudflare token set
  4201  OWNER=1 BOTOFF=1 ROLE=ceo                                  - no Turnstile keys, no token
  4202  LOGIN_FIRST=1 BOTKEY=1x00000000000000000000AA              - the sign-in page, check on
  4203  LOGIN_FIRST=1                                              - the sign-in page, check off
Cloudflare's widget script cannot be fetched in the sandbox, so it is stubbed
with one that renders and hands a token, the way Turnstile's callback does.
SHOTS= saves screenshots.
"""
from playwright.sync_api import sync_playwright
import json, os, re

SHOTS = os.environ.get("SHOTS")
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

STUB = """window.turnstile = { _n: 0,
  render(el, o) { const d = document.createElement('div'); d.setAttribute('data-stub-turnstile', o.action); el.appendChild(d);
    setTimeout(() => o.callback('STUB-TOKEN-' + (++this._n) + '-' + o.action), 50); this._o = o; return 'w1'; },
  reset() { setTimeout(() => this._o.callback('STUB-TOKEN-' + (++this._n) + '-' + this._o.action), 50); }, remove() {} };"""

def sub(pg, name):
    pg.get_by_role("tab", name=name, exact=True).last.click(); pg.wait_for_timeout(1500)

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- the sign-in page, check on ----------
    c = b.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce"); pg = c.new_page()
    pg.route(re.compile(r"https://challenges\.cloudflare\.com/.*"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=STUB))
    posts = []; pg.on("request", lambda r: posts.append((r.url, r.post_data)) if r.method == "POST" else None)
    pg.goto("http://127.0.0.1:4202/login"); pg.wait_for_timeout(2500)
    check("the sign-in page draws the Cloudflare check when the worker sends a site key", pg.get_by_test_id("bot-check").count() == 1)
    check("the widget is asked for the sign-in action", pg.locator("[data-stub-turnstile=signin]").count() == 1)
    href = pg.locator("a[href*='/auth/google']").first.get_attribute("href") or ""
    check("the Google door carries the token (?bt=)", "bt=STUB-TOKEN" in href, href)
    pg.fill("#email", "fixture@example.test"); pg.fill("#password", "correct horse battery")
    pg.get_by_role("button", name=re.compile("^Sign in$|^Log masuk$")).first.click(); pg.wait_for_timeout(1500)
    login = [json.loads(d or "{}") for u, d in posts if u.endswith("/auth/login")]
    check("the password sign-in sends its bot token", login and str(login[0].get("bot_token", "")).startswith("STUB-TOKEN-"), login)
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "login-bot-check.png"))
    c.close()
    # ---------- the sign-in page, check off ----------
    c = b.new_context(viewport={"width": 1280, "height": 900}); pg = c.new_page()
    posts = []; pg.on("request", lambda r: posts.append((r.url, r.post_data)) if r.method == "POST" else None)
    pg.goto("http://127.0.0.1:4203/login"); pg.wait_for_timeout(2500)
    check("with no site key nothing is drawn and the Google link is unchanged", pg.get_by_test_id("bot-check").count() == 0 and "bt=" not in (pg.locator("a[href*='/auth/google']").first.get_attribute("href") or ""))
    pg.fill("#email", "fixture@example.test"); pg.fill("#password", "correct horse battery")
    pg.get_by_role("button", name=re.compile("^Sign in$|^Log masuk$")).first.click(); pg.wait_for_timeout(1500)
    login = [json.loads(d or "{}") for u, d in posts if u.endswith("/auth/login")]
    check("and the sign-in still goes, with no token", login and login[0].get("bot_token") is None, login)
    c.close()

    # ---------- Security & Sessions, check on + Cloudflare token ----------
    for w in (1440, 390):
        phone = w < 500
        c = b.new_context(viewport={"width": w, "height": 1000 if not phone else 844}, reduced_motion="reduce", is_mobile=phone, has_touch=phone); pg = c.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        writes = []; pg.on("request", lambda r: writes.append(r.url) if r.method != "GET" else None)
        pg.goto("http://127.0.0.1:4200/portal?tab=Users&view=security"); pg.wait_for_timeout(3500)
        pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
        tabs = [t.strip() for t in pg.get_by_role("tab").all_inner_texts()]
        check(f"[{w}] the five sub-tabs are kept", all(n in tabs for n in ["Overview", "Company owner", "Office location", "Problem reports", "System health"]), tabs)
        strip = pg.get_by_test_id("security-strip")
        txt = strip.inner_text()
        check(f"[{w}] Overview: one strip of six (2FA, sign-ins, sessions, bot check, backup, alerts)", strip.count() == 1 and int(strip.get_attribute("data-cells") or 0) == 6 and all(t in txt for t in ["2FA Protection", "Recent Sign-ins", "Active Sessions", "Bot Check", "Backup Status", "Security Alerts"]), txt[:200])
        check(f"[{w}] the bot check and backup come from the status read", "On" in pg.get_by_test_id("tile-bot").inner_text() and "OK" in pg.get_by_test_id("tile-backup").inner_text())
        check(f"[{w}] the existing panes stay (controls, sign-in log, attention) and the recovery panel is in the controls",
              all(pg.get_by_test_id(t).count() == 1 for t in ["auth-controls", "signin-log", "security-attention", "control-2fa", "control-passkeys", "control-recovery"]))
        check(f"[{w}] the protection line says the bot check is on", "bot check" in pg.get_by_test_id("protection-line").inner_text().lower())
        pg.get_by_test_id("tile-sessions").click(); pg.wait_for_timeout(800)
        dlg = pg.get_by_role("dialog")
        check(f"[{w}] Active Sessions opens a drawer listing who is signed in, on what", dlg.count() > 0 and "Mohamad Izzudin" in dlg.first.inner_text() and "Chrome · Windows" in dlg.first.inner_text(), dlg.first.inner_text()[:200] if dlg.count() else "")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"overview-{w}.png"), full_page=phone)
        sub(pg, "System health")
        hs = pg.get_by_test_id("health-strip").inner_text()
        check(f"[{w}] System health: one strip with platform, bot check, firewall, threats, file checks, backup", all(t in hs for t in ["Platform", "Bot check", "Cloudflare firewall", "Threats seen", "File checks", "Backup"]) and "128" in hs, hs[:200])
        check(f"[{w}] the file tile says it is not antivirus", "Not antivirus" in hs)
        check(f"[{w}] the protection list and the existing errors and backups card are both there", pg.get_by_test_id("infra-protection").count() == 1 and pg.locator("#system-health").count() == 1)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"health-{w}.png"), full_page=phone)
        sub(pg, "Problem reports")
        rs = pg.get_by_test_id("reports-strip").inner_text()
        check(f"[{w}] Problem reports: one strip (open, in progress, resolved, critical, average resolution)", all(t in rs for t in ["Open", "In Progress", "Resolved", "Critical", "Avg Resolution"]), rs[:200])
        check(f"[{w}] the register lists the reports, a security incident marked critical", "Suspicious login" in pg.get_by_test_id("reports-table").inner_text() and "Critical" in pg.get_by_test_id("reports-table").inner_text())
        pg.get_by_test_id("new-report").click(); pg.wait_for_timeout(1000)
        opts = pg.get_by_role("dialog").first.locator("select option").all_inner_texts()
        check(f"[{w}] New report is the same Report a problem sheet, with Security incident as a kind", "Security incident" in opts, opts)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        check(f"[{w}] the receiver card is kept", pg.locator("section[aria-label='Problem reports']").count() == 1)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"reports-{w}.png"), full_page=phone)
        sub(pg, "Company owner"); check(f"[{w}] Company owner unchanged (the owner card)", "Company owner" in pg.locator("main").inner_text())
        sub(pg, "Office location"); check(f"[{w}] Office location unchanged (the geofence card)", "Office check-in" in pg.locator("main").inner_text())
        check(f"[{w}] no page wider than the screen", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
        check(f"[{w}] nothing was written by reading", writes == [], writes[:3])
        check(f"[{w}] no page error", not errs, errs[:2])
        c.close()

    # ---------- no keys, no token: said, never shown as on ----------
    c = b.new_context(viewport={"width": 1440, "height": 1000}); pg = c.new_page()
    pg.goto("http://127.0.0.1:4201/portal?tab=Users&view=security"); pg.wait_for_timeout(3500)
    check("[off] the bot check tile says Off", "Off" in pg.get_by_test_id("tile-bot").inner_text())
    check("[off] the attention list names it", "Bot check before sign-in is off" in pg.get_by_test_id("security-attention").inner_text())
    sub(pg, "System health")
    hs = pg.get_by_test_id("health-strip").inner_text()
    check("[off] Cloudflare figures say Not connected, never a number", "Not connected" in hs and "128" not in hs, hs[:200])
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "health-off-1440.png"))
    c.close(); b.close()

bad = [n for n, ok in res if not ok]
print(f"security-sessions (browser): {len(res) - len(bad)}/{len(res)} passed")
raise SystemExit(1 if bad else 0)

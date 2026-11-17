"""/ADMIN, THE SUPER ADMIN'S CONSOLE (v1.348.0 lock, v1.349.0 Overview and Users) - in a browser.
The source rules are held by tests/admin-super-only.mjs. Here, the screens and the requests.

Servers (tests/browser/serve.mjs over a production build):
  4210  ROLE=super_admin
  4211  ROLE=admin
  4212  OWNER=1 ROLE=ceo       - the verified company owner
SHOTS= saves screenshots.
"""
import json, os, re
from playwright.sync_api import sync_playwright

SHOTS = os.environ.get("SHOTS")
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- who opens /admin ----------
    for port, who in [(4211, "the admin role"), (4212, "the owner CEO")]:
        pg = b.new_page(); pg.goto(f"http://127.0.0.1:{port}/admin"); pg.wait_for_timeout(3000)
        check(f"{who} is sent to /portal", "/portal" in pg.url and "/admin" not in pg.url, pg.url)
        pg.close()

    for w in (1440, 390):
        phone = w < 500
        c = b.new_context(viewport={"width": w, "height": 900 if not phone else 844}, is_mobile=phone, has_touch=phone, reduced_motion="reduce"); pg = c.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        sent = []; pg.on("request", lambda r: sent.append((r.method, r.url.split("/api/v1", 1)[-1], r.post_data)) if r.method != "GET" and "/api/v1" in r.url else None)
        pg.goto("http://127.0.0.1:4210/admin"); pg.wait_for_timeout(3500)
        # ---------- Overview ----------
        strip = pg.get_by_test_id("admin-strip")
        txt = strip.inner_text()
        check(f"[{w}] Overview: one strip - accounts, super admins, backup, errors, database updates",
              strip.count() == 1 and int(strip.get_attribute("data-cells") or 0) == 5 and all(t in txt for t in ["Active Accounts", "Super Admins", "Last Backup", "Errors (24 h)", "Database Updates"]), txt[:200])
        check(f"[{w}] the figures are the reads': 4 accounts, 0 of 1 super admin with 2FA, the backup's own date", "4 in all" in txt and "0 of 1 with 2FA" in txt and "17-09-2026" in txt, txt[:300])
        check(f"[{w}] recent account activity from the audit history, the console's links", pg.get_by_test_id("activity-row").count() >= 1 and pg.get_by_test_id("admin-console").count() == 1)
        check(f"[{w}] no retired tab on the rail", pg.get_by_role("button", name="Enquiries", exact=True).count() == 0 and pg.get_by_role("button", name="Staff", exact=True).count() == 0)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"admin-overview-{w}.png"), full_page=phone)
        # ---------- Users ----------
        pg.get_by_test_id("go-users").get_by_role("button").click(); pg.wait_for_timeout(2500)
        us = pg.get_by_test_id("users-strip").inner_text()
        check(f"[{w}] Users: one strip - all, active, suspended, staff without 2FA, super admins", all(t in us for t in ["All Accounts", "Active", "Suspended", "Staff Without 2FA", "Super Admins"]), us[:200])
        check(f"[{w}] the register lists every account", pg.get_by_test_id("account-row").count() == 4)
        pg.get_by_test_id("users-search").fill("aisyah"); pg.wait_for_timeout(300)
        check(f"[{w}] search narrows the register", pg.get_by_test_id("account-row").count() == 1)
        pg.get_by_test_id("account-row").first.click(); pg.wait_for_timeout(500)
        check(f"[{w}] a row opens the account beside the register", "aisyah@example.test" in pg.get_by_test_id("user-detail").inner_text())
        pg.get_by_test_id("user-role").select_option("coo"); pg.wait_for_timeout(500)
        pg.get_by_role("dialog").get_by_role("button", name="Change Role").click(); pg.wait_for_timeout(1200)
        role = [json.loads(d or "{}") for m, u, d in sent if m == "PATCH" and re.match(r"^/users/\d+$", u)]
        check(f"[{w}] a role change asks first, then PATCHes /users/:id with the role", role and role[-1].get("role") == "coo", sent[-3:])
        pg.get_by_test_id("user-signout").click(); pg.wait_for_timeout(800)
        check(f"[{w}] Sign out everywhere POSTs /users/:id/revoke-sessions", any(m == "POST" and u.endswith("/revoke-sessions") for m, u, d in sent), sent[-3:])
        pg.get_by_test_id("user-reset").click(); pg.wait_for_timeout(300)
        pg.get_by_test_id("reset-box").locator("input").fill("a-new-password-123"); pg.get_by_test_id("reset-box").get_by_role("button", name="Set password").click(); pg.wait_for_timeout(800)
        check(f"[{w}] Set password PATCHes /users/:id with the password", any(m == "PATCH" and '"password"' in (d or "") for m, u, d in sent), sent[-3:])
        pg.get_by_test_id("user-suspend").click(); pg.wait_for_timeout(500)
        pg.get_by_role("dialog").get_by_role("button", name="Suspend").click(); pg.wait_for_timeout(800)
        check(f"[{w}] Suspend asks first, then PATCHes is_active 0", any(m == "PATCH" and '"is_active":0' in (d or "") for m, u, d in sent), sent[-3:])
        pg.get_by_test_id("add-user").click(); pg.wait_for_timeout(600)
        dlg = pg.get_by_role("dialog").first
        check(f"[{w}] Add user opens in a drawer", dlg.count() > 0 and "Add user" in dlg.inner_text())
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        check(f"[{w}] the company owner card is on the page", pg.get_by_test_id("admin-owner").count() == 1)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"admin-users-{w}.png"), full_page=phone)
        check(f"[{w}] no page wider than the screen (Users)", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
        # ---------- Phase 3: Security & Audit, My Account, Signatures (v1.351.0) ----------
        def open_from_overview(testid):
            pg.goto("http://127.0.0.1:4210/admin"); pg.wait_for_timeout(2500)
            pg.get_by_test_id(testid).get_by_role("button").click(); pg.wait_for_timeout(2500)
        open_from_overview("go-audit")
        check(f"[{w}] Security & Audit opens on the audit trail with its register", pg.locator("h1").first.inner_text().strip() == "Security & Audit" and pg.get_by_test_id("view-trail").is_visible() and not pg.get_by_test_id("view-backups").is_visible())
        pg.get_by_test_id("security-view-backups").click(); pg.wait_for_timeout(1200)
        bs = pg.get_by_test_id("backup-strip").inner_text()
        check(f"[{w}] Backups & Errors: one strip from the server's reads, then the backup card", all(t in bs for t in ["Nightly Backup", "Off-site Copy", "Errors (24 h)", "Database Updates"]) and "17-09-2026" in bs and pg.locator("#system-health").is_visible(), bs[:200])
        check(f"[{w}] the trail stays mounted while hidden", pg.get_by_test_id("view-trail").count() == 1)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"admin-security-{w}.png"), full_page=phone)
        open_from_overview("go-account")
        ac = pg.get_by_test_id("account-strip").inner_text()
        check(f"[{w}] My Account: one strip - two-factor, Google, passkeys, recovery panel", all(t in ac for t in ["Two-Factor", "Google Sign-in", "Passkeys", "Recovery Panel"]) and "Not ready" in ac, ac[:200])
        check(f"[{w}] the five panels are there: password, two-factor, Google, recovery", pg.get_by_test_id("change-password").count() == 1 and pg.get_by_text("Two-factor authentication").count() >= 1 and pg.get_by_text("Connected Google account").count() >= 1)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"admin-account-{w}.png"), full_page=phone)
        open_from_overview("go-signatures")
        vs = pg.get_by_test_id("vault-strip").inner_text()
        check(f"[{w}] Signatures: one strip of what is on file", all(t in vs for t in ["On File", "Missing", "Old Files", "Versions Kept"]) and "3 / 10" in vs, vs[:200])
        check(f"[{w}] both companies, five roles each, every cell with its upload", pg.locator("[data-testid^=cell-a2z-]").count() == 5 and pg.locator("[data-testid^=cell-azoo-]").count() == 5 and pg.locator("[data-testid^=cell-] input[type=file]").count() == 10)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"admin-signatures-{w}.png"), full_page=phone)
        check(f"[{w}] no page wider than the screen (Signatures)", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
        # ---------- Phase 4: Website Content (v1.352.0) ----------
        open_from_overview("go-website")
        ws = pg.get_by_test_id("website-strip").inner_text()
        check(f"[{w}] Website Content: one strip - keys, posts, portfolio, testimonials, media", all(t in ws for t in ["Content Keys", "Posts", "Portfolio", "Testimonials", "Media Files"]), ws[:200])
        check(f"[{w}] the five other website tabs are gone from the rail", all(pg.get_by_role("button", name=n, exact=True).count() == 0 for n in ["Portfolio", "Testimonials", "Posts", "Media", "Advanced"]))
        check(f"[{w}] Website Text opens first, its sections as panes", pg.get_by_test_id("view-text").is_visible() and pg.get_by_test_id("site-home.hero.headline").count() == 1)
        pg.get_by_test_id("website-view-posts").click(); pg.wait_for_timeout(800)
        pg.get_by_test_id("posts-row").first.click(); pg.wait_for_timeout(400)
        check(f"[{w}] a post opens in the editor beside the list", "Edit #3" in pg.get_by_test_id("posts-editor").inner_text())
        pg.get_by_test_id("posts-save").click(); pg.wait_for_timeout(800)
        check(f"[{w}] Save changes PUTs /posts/:id", any(m == "PUT" and u == "/posts/3" for m, u, d in sent), sent[-3:])
        pg.get_by_test_id("posts-row").first.click(); pg.wait_for_timeout(400)
        pg.get_by_test_id("posts-delete").click(); pg.wait_for_timeout(500)
        check(f"[{w}] Delete asks first", pg.get_by_role("dialog").count() > 0)
        pg.get_by_role("dialog").get_by_role("button", name="Delete").click(); pg.wait_for_timeout(800)
        check(f"[{w}] then DELETEs /posts/:id", any(m == "DELETE" and u == "/posts/3" for m, u, d in sent), sent[-3:])
        pg.get_by_test_id("website-view-media").click(); pg.wait_for_timeout(800)
        check(f"[{w}] Media: the library with its tiles and the upload", pg.get_by_test_id("media-tile").count() == 3 and pg.get_by_test_id("media-upload").count() == 1)
        pg.get_by_test_id("website-view-keys").click(); pg.wait_for_timeout(800)
        check(f"[{w}] Advanced Keys: the keys register and the key editor", pg.get_by_test_id("key-row").count() == 3 and pg.get_by_test_id("keys-editor").count() == 1)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, f"admin-website-{w}.png"), full_page=phone)
        check(f"[{w}] no page wider than the screen", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
        check(f"[{w}] no page error", not errs, errs[:2])
        c.close()
    b.close()

bad = [n for n, ok in res if not ok]
print(f"admin-console (browser): {len(res) - len(bad)}/{len(res)} passed")
raise SystemExit(1 if bad else 0)

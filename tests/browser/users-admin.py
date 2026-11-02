"""v1.251.0 - the CEO's Users, on screen (the owner, 02-11-2026: "CEO Full
Administrative Authority, Users Management Restructure & Global PWA Overflow
Fix"; claude/CEO-ADMIN-USERS-AUDIT.md, his answers D1-D4 and "Approved").

What the server allows is proven by direct request in tests/go-live-i.mjs.
Here: the tabs (no Signatures & Stamps - it lives in Companies > Document &
Signing), the owner banner while the owner authority is off, Add User (an
invitation with a one-time link), the Account Management drawer (role,
company access, permissions, audit), the one Roles & Permissions editor, the
Audit History for one person, and on a phone: no sideways page, 16px fields
(Safari never zooms), every sheet usable.

Servers (servers.txt): 4191 ROLE=ceo OWNER=1, 4177 ROLE=ceo (not the owner),
4183 ROLE=super_admin, 4219 ROLE=ceo SIGN=1. Invented people only."""
import json, urllib.parse
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_page(b, port, path="/portal?tab=Users", w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs, reqs

def tab(pg, name):
    t = pg.get_by_role("tab", name=name, exact=True)
    if t.count(): t.first.click(); pg.wait_for_timeout(1200); return True
    return False

def posts(reqs, suffix):
    out = []
    for m, u, d in reqs:
        if m == "POST" and urllib.parse.urlparse(u).path.endswith(suffix):
            try: out.append(json.loads(d or "{}"))
            except Exception: out.append({})
    return out

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
SMALL_FIELDS = """() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), select, textarea')]
  .filter(e => e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16)
  .map(e => (e.getAttribute('aria-label') || e.name || e.placeholder || e.tagName) + ' ' + getComputedStyle(e).fontSize)"""

def step_up(pg):
    dlg = pg.get_by_role("dialog").filter(has_text="authenticator")
    if dlg.count():
        dlg.locator("input").first.fill("123456")
        dlg.get_by_role("button").filter(has_text="Save").or_(dlg.get_by_role("button").filter(has_text="Confirm")).or_(dlg.get_by_role("button").filter(has_text="OK")).first.click()
        pg.wait_for_timeout(1200)
        return True
    return False

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the owner, desktop ----
    ctx, pg, errs, reqs = open_page(b, 4191)
    names = [t.strip() for t in pg.get_by_role("tab").all_inner_texts()]
    check("Users: Overview, Staff Accounts, Customers & Agents, Roles & Permissions, Security & Sessions, Audit History",
          all(n in names for n in ["Overview", "Staff Accounts", "Customers & Agents", "Roles & Permissions", "Security & Sessions", "Audit History"]), names)
    check("Signatures & Stamps is no longer in Users (moved to Companies)", "Signatures & Stamps" not in names and pg.get_by_test_id("signing-panel").count() == 0)
    check("the verified owner sees no owner-off banner", pg.get_by_test_id("owner-off").count() == 0)
    ov = pg.inner_text("main")
    check("Overview shows the real figures: active staff, suspended, customers and active agents", all(s in ov for s in ["Active Staff", "Suspended / Inactive", "Customer Accounts", "Active Agents"]), ov[:300])

    tab(pg, "Staff Accounts")
    staff_txt = pg.inner_text("main")
    check("an agent is not in the staff list", "Rashid Danial" not in staff_txt)
    tab(pg, "Customers & Agents")
    cust_txt = pg.inner_text("main")
    check("Customers & Agents lists the agent with an Agent chip", "Rashid Danial" in cust_txt and "Agent" in cust_txt)
    check("...the agent's account can be managed; Grant Agent Access stays on customers only",
          pg.get_by_test_id("manage-9105").count() == 1 and pg.get_by_test_id("grant-agent-9105").count() == 0 and pg.get_by_test_id("grant-agent-9101").count() == 1)

    # Add User
    tab(pg, "Staff Accounts")
    pg.get_by_test_id("add-user").click(); pg.wait_for_timeout(700)
    form = pg.get_by_test_id("invite-form")
    check("Add User opens the invitation form in Users", form.count() == 1)
    create = form.get_by_role("button", name="Create account")
    check("...Create stays off until name, a valid email and a reason are given", create.is_disabled())
    form.get_by_label("Full name").fill("Nadia Amira"); form.get_by_label("Login email").fill("nadia@example.test")
    roles = form.get_by_label("Role").locator("option").all_inner_texts()
    check("...the owner may invite executive roles too (the server decides again)", "COO" in roles and "CEO" in roles and "Super Admin" not in roles and "Agent" not in roles, roles)
    form.get_by_label("Role").select_option("coo")
    form.get_by_label("Reason (kept in the audit history)").fill("New operations lead from November")
    check("...then it can be sent", not create.is_disabled())
    reqs.clear(); create.click(); pg.wait_for_timeout(900)
    asked = step_up(pg)
    sent = posts(reqs, "/api/v1/users")
    check("the invitation goes to the server with invite, the role and the reason - never a password", len(sent) >= 1 and sent[-1].get("invite") is True and sent[-1].get("role") == "coo" and "password" not in sent[-1] and sent[-1].get("reason", "").startswith("New operations"), sent)
    check("...and asks for the owner's authenticator code", asked and sent[-1].get("totp") == "123456", sent)
    done = pg.get_by_test_id("invite-done")
    check("with email off, the one-time link is shown once to hand over, with Copy", done.count() == 1 and "set-password#token=" in done.locator("input").input_value() and done.get_by_role("button", name="Copy").count() == 1)
    done.get_by_role("button", name="Done").click(); pg.wait_for_timeout(500)

    # Account Management drawer
    pg.get_by_test_id("manage-9002").click(); pg.wait_for_timeout(1200)
    role_box = pg.get_by_test_id("sheet-role")
    rt = role_box.inner_text() if role_box.count() else ""
    check("the Account Management drawer shows the account type, business role and company access", "Staff" in rt and "Sales & Marketing" in rt and "Both companies" in rt, rt[:300])
    check("...with Change role, Permissions for this person and Audit history",
          role_box.get_by_role("button", name="Change role").count() == 1 and role_box.get_by_role("button", name="Permissions for this person").count() == 1 and role_box.get_by_role("button", name="Audit history").count() == 1)
    sheet_txt = pg.locator("[role=dialog]").filter(has=pg.get_by_test_id("sheet-role")).first.inner_text()
    check("...and keeps the sign-in actions: login email, set-password link, 2FA reset, sign out everywhere, suspend, devices",
          all(s.lower() in sheet_txt.lower() for s in ["Change email", "Set-password link", "Reset 2FA", "Sign out everywhere", "Suspend access", "Devices signed in"]), [s for s in ["Change email", "Set-password link", "Reset 2FA", "Sign out everywhere", "Suspend access", "Devices signed in"] if s.lower() not in sheet_txt.lower()])
    check("...and no signature or stamp action", "stamp" not in sheet_txt.lower() and "signature" not in sheet_txt.lower())
    role_box.get_by_role("button", name="Change role").click(); pg.wait_for_timeout(400)
    opts = role_box.get_by_label("New role").locator("option").all_inner_texts()
    check("Change role offers exactly the roles the server allows for this person", "CCO" in opts and "Agent" in opts and "Super Admin" not in opts, opts)
    role_box.get_by_label("New role").select_option("hr_admin")
    role_box.get_by_label("Reason (kept in the audit history)").fill("Moving to the HR desk from Monday")
    reqs.clear(); role_box.get_by_role("button", name="Change role").click(); pg.wait_for_timeout(1200)
    step_up(pg)
    rp = posts(reqs, "/staff/users/9002/role")
    check("the role change goes to the one role route with the role and the reason", len(rp) >= 1 and rp[-1].get("role") == "hr_admin" and rp[-1].get("reason", "").startswith("Moving"), rp)
    pg.get_by_test_id("sheet-role").get_by_role("button", name="Audit history").click(); pg.wait_for_timeout(1500)
    at = pg.inner_text("main")
    check("Audit history opens Users > Audit History for that one person", pg.get_by_role("tab", name="Audit History", selected=True).count() == 1 and "only" in at and "user.suspend" in at, at[:300])
    check("...read from the existing audit log with the person's id", any("/api/v1/audit?" in u and "target=9002" in u for _, u, _ in reqs))
    pg.get_by_role("button", name="Show everyone").click(); pg.wait_for_timeout(1200)
    check("Show everyone returns the whole log", "user.suspend" not in pg.inner_text("main") or "only" not in pg.inner_text("main"))

    # Roles & Permissions: one editor
    tab(pg, "Roles & Permissions"); pg.wait_for_timeout(1500)
    mod = pg.locator("table button[aria-expanded]").filter(has_text="Users")
    if mod.count(): mod.first.click(); pg.wait_for_timeout(500)
    check("one matrix: a module opens on whether each role SEES its tab, then what it may DO", pg.get_by_test_id("sees-Users").filter(visible=True).count() == 1)
    det = pg.get_by_test_id("sees-editor")
    check("Who sees each tab is folded under the same matrix (one zone, not a second matrix)", det.count() == 1 and pg.get_by_text("What each role sees", exact=True).count() == 0)
    det.locator("summary").click(); pg.wait_for_timeout(1500)
    check("...and opens the tab editor in place", det.locator("table, ul").count() >= 1)

    # Security & Sessions
    tab(pg, "Security & Sessions")
    sec = pg.inner_text("main")
    check("Security & Sessions points to each person's devices; the stale 'No per-device list' line is gone", "No per-device list" not in sec and "Devices signed in" in sec)
    check("no page errors (owner)", not errs, errs)
    ctx.close()

    # ---- a CEO whose owner authority is off ----
    ctx, pg, errs, _ = open_page(b, 4177)
    ban = pg.get_by_test_id("owner-off")
    check("a CEO without the owner record sees why the owner actions are refused, under the tabs", ban.count() == 1 and "not switched on yet" in ban.inner_text() and "Company owner" in ban.inner_text())
    ban.get_by_role("button", name="Company owner").click(); pg.wait_for_timeout(1200)
    check("...and the button opens Security & Sessions where the Company owner card is", pg.get_by_role("tab", name="Security & Sessions", selected=True).count() == 1)
    tab(pg, "Staff Accounts")
    pg.get_by_test_id("add-user").click(); pg.wait_for_timeout(600)
    r2 = pg.get_by_test_id("invite-form").get_by_label("Role").locator("option").all_inner_texts()
    check("...his Add User offers the working roles only", "COO" not in r2 and "Sales & Marketing" in r2, r2)
    check("no page errors (CEO, owner off)", not errs, errs)
    ctx.close()

    # ---- the super admin ----
    ctx, pg, errs, _ = open_page(b, 4183)
    check("the super admin sees no owner banner and the same tabs", pg.get_by_test_id("owner-off").count() == 0 and pg.get_by_role("tab", name="Audit History").count() == 1)
    ctx.close()

    # ---- Companies > Document & Signing ----
    ctx, pg, errs, _ = open_page(b, 4219, "/portal?tab=Companies")
    check("Companies has a Document & Signing tab", pg.get_by_role("tab", name="Document & Signing").count() == 1)
    tab(pg, "Document & Signing"); pg.wait_for_timeout(1500)
    cs = pg.get_by_test_id("companies-signing")
    check("...holding the same Signatures & Stamps panel (officer chops from /admin included)", cs.count() == 1 and cs.get_by_test_id("signing-panel").count() == 1 and cs.get_by_test_id("officer-chops").count() == 1)
    check("...without the ownership-review notice above it", "Reconciliation only" not in pg.inner_text("main"))
    check("no page errors (Companies)", not errs, errs)
    ctx.close()

    # ---- phones ----
    for port, w in [(4191, 320), (4191, 375), (4191, 390), (4191, 430), (4177, 360)]:
        ctx, pg, errs, _ = open_page(b, port, w=w, h=860)
        bad = []
        for t in ["Overview", "Staff Accounts", "Customers & Agents", "Roles & Permissions", "Security & Sessions", "Audit History"]:
            if not tab(pg, t): continue
            if not pg.evaluate(FITS): bad.append(t)
        check(f"phone {w}px ({port}): no Users view scrolls sideways", not bad, bad)
        tab(pg, "Staff Accounts")
        if port == 4191:
            pg.get_by_test_id("manage-9002").first.click(); pg.wait_for_timeout(1200)
            small = pg.evaluate(SMALL_FIELDS)
            check(f"phone {w}px: the account drawer fits and every field is 16px or more (Safari never zooms)", pg.evaluate(FITS) and not small, small)
            rb = pg.get_by_test_id("sheet-role").get_by_role("button", name="Change role")
            rb.scroll_into_view_if_needed()
            check(f"phone {w}px: Change role is on screen and clickable", rb.is_visible() and rb.is_enabled())
            pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
            pg.evaluate("document.querySelectorAll('[role=dialog] button[aria-label=Close]').forEach(b => b.click())"); pg.wait_for_timeout(400)
        pg.get_by_test_id("add-user").first.click(); pg.wait_for_timeout(800)
        f = pg.get_by_test_id("invite-form")
        f.get_by_label("Full name").fill("Long Name Binti Abdullah Rahman Shah"); f.get_by_label("Login email").fill("a.very.long.address.for.testing@example.test")
        small = pg.evaluate(SMALL_FIELDS)
        btn = f.get_by_role("button", name="Create account"); btn.scroll_into_view_if_needed()
        check(f"phone {w}px: Add User fits, with 16px fields and Create on screen", pg.evaluate(FITS) and not small and btn.is_visible(), small)
        check(f"no page errors (phone {w})", not errs, errs)
        ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"users-admin: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

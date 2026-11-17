"""v1.331.0 - Users & Security -> Roles & Permissions, a role at a time (the CEO,
17-11-2026: "REPLACE LEGACY ROLES & PERMISSIONS UI").

What it proves, in a real browser against the built site:
  - the old wide Access policy matrix, the "Who sees each tab" fold and the
    stacked Per-user exceptions zone are gone from the route; the connected
    strip, the Role Directory (left) and the chosen role's editor (right)
    replace them, held to one screen from 1024px, no sideways overflow at 390px
  - choosing a role changes the editor; the verbs are the server's catalogue
    actions grouped, a locked cell has no switch
  - a change is SAVED through POST /staff/access/policy (reason + the
    authenticator code) and is still there after a reload (the fixture keeps
    it as system_meta.role_permissions does; the worker's enforcement of the
    saved cell is tests/matrix-edit.mjs)
  - Assign a user goes through the role door (POST /staff/users/:id/role) and
    the person is in the role after a reload
  - Set from template / Reset / Per-user exceptions / Tab visibility work
  - a CEO who is not the verified owner reads it without one switch

Servers (servers.txt): 4320 ROLE=ceo OWNER=1 ROLESX=1 (saves are kept),
4321 ROLE=super_admin ROLESX=1, 4177 ROLE=ceo (not the owner).
Invented people only.  python3 tests/browser/roles-permissions.py"""
import json, os, sys, urllib.parse
from playwright.sync_api import sync_playwright

S = os.environ.get("SHOTS", "/tmp/rp-shots"); os.makedirs(S, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_roles(b, port, w=1440, h=900, scale=1):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500, device_scale_factor=scale)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Users&view=roles"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs, reqs

def posts(reqs, suffix):
    out = []
    for m, u, d in reqs:
        if m == "POST" and urllib.parse.urlparse(u).path.endswith(suffix):
            try: out.append(json.loads(d or "{}"))
            except Exception: out.append({})
    return out

def pick_role(pg, label):
    rows = pg.get_by_test_id("roles-table").locator("[data-record^='role:']")
    for i in range(rows.count()):
        r = rows.nth(i)
        if r.locator("strong").first.inner_text().strip() == label:
            r.click(); pg.wait_for_timeout(350); return True
    return False

def answer(pg, has, value):
    dlg = pg.get_by_role("dialog").filter(has_text=has).filter(has=pg.get_by_role("button", name="Save", exact=True))
    if not dlg.count(): return False
    dlg = dlg.last
    dlg.locator("input").first.fill(value)
    dlg.get_by_role("button", name="Save", exact=True).click(); pg.wait_for_timeout(1200)
    return True

def ok_feedback(pg):
    b = pg.get_by_test_id("feedback-ok")
    if b.count(): b.first.click(); pg.wait_for_timeout(300)

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
TOGGLE = lambda pg, tid: pg.get_by_test_id(tid).get_attribute("aria-checked")

import urllib.request
for port in (4320, 4321):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__rolesx-reset").read()

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- the owner, desktop ----------------
    ctx, pg, errs, reqs = open_roles(b, 4320)
    main = pg.inner_text("main")
    check("the route opens on the new editor", pg.get_by_test_id("roles-permissions").is_visible())
    check("the old wide matrix is gone (no 'Access policy matrix', no role-by-module table, no Edit matrix)",
          "Access policy matrix" not in main and pg.get_by_role("table", name="Permissions by module and role").count() == 0 and pg.get_by_role("button", name="Edit matrix").count() == 0)
    check("Who sees each tab and Per-user exceptions are no longer stacked on the page",
          pg.get_by_test_id("sees-editor").count() == 0 and not pg.get_by_test_id("exceptions-card").is_visible())
    strip = pg.get_by_test_id("roles-strip")
    check("one connected strip of five: Total Roles, Assigned Users, Modules Controlled, Edited Permissions, CEO Access",
          strip.get_attribute("data-cells") == "5" and all(x in strip.inner_text() for x in ["Total Roles", "Assigned Users", "Modules Controlled", "Edited Permissions", "CEO Access"]), strip.inner_text())
    check("Total Roles is the server's role count (10) and Assigned Users its active headcount (12)", "10" in strip.locator("[data-cell=roles]").inner_text() and "12" in strip.locator("[data-cell=assigned]").inner_text(), strip.inner_text())
    check("CEO Access: Equivalent to Super Admin, except the protected cells (the owner is verified)", "Equivalent" in strip.locator("[data-cell=ceo]").inner_text(), strip.locator("[data-cell=ceo]").inner_text())
    dirp, edp = pg.get_by_test_id("role-directory"), pg.get_by_test_id("role-editor")
    db, eb = dirp.bounding_box(), edp.bounding_box()
    check("Role Directory on the left, about a third; the editor on the right, about two thirds",
          db["x"] < eb["x"] and 0.28 < db["width"] / (db["width"] + eb["width"]) < 0.42, (db, eb))
    vh = pg.evaluate("window.innerHeight"); sh = pg.evaluate("document.documentElement.scrollHeight")
    check("one viewport at 1440x900: the page does not scroll (the panes scroll inside)", sh <= vh + 2, (sh, vh))
    check("no sideways overflow at 1440", pg.evaluate(FITS))
    check("the CEO is chosen first", pg.get_by_test_id("role-title").inner_text() == "CEO")
    head = pg.get_by_test_id("role-perms").locator("[role=columnheader]").all_inner_texts()
    check("the editor's columns: Module, View, Create, Edit, Approve, Delete, Export, Manage", head == ["Module", "View", "Create", "Edit", "Approve", "Delete", "Export", "Manage"], head)
    pg.screenshot(path=f"{S}/rp-desktop-ceo.png")

    check("choosing COO updates the editor", pick_role(pg, "COO") and pg.get_by_test_id("role-title").inner_text() == "COO")
    check("search finds a role", (pg.get_by_test_id("roles-search").fill("live"), pg.wait_for_timeout(300), pg.get_by_test_id("roles-table").locator("[data-record^='role:']").count())[2] == 1)
    pg.get_by_test_id("roles-search").fill("")
    pg.get_by_test_id("roles-group-tech").click(); pg.wait_for_timeout(300)
    techs = pg.get_by_test_id("roles-table").locator("[data-record^='role:'] strong").all_inner_texts()
    check("the Technical filter shows Admin and Super Admin only", sorted(techs) == ["Admin", "Super Admin"], techs)
    pg.get_by_test_id("roles-group-all").click(); pg.wait_for_timeout(300)

    # a locked cell has no switch
    pick_role(pg, "CEO")
    sysmod = pg.get_by_test_id("perm-mod-System"); sysmod.locator("button[aria-expanded]").click(); pg.wait_for_timeout(300)
    check("locked for the CEO: naming the owner and the backup have no switch, marked Protected",
          sysmod.get_by_test_id("act-toggle-owner_designate").count() == 0 and sysmod.get_by_test_id("act-toggle-backup").count() == 0 and sysmod.inner_text().count("Protected") == 2)

    # change one cell, save it, reload, it is still there
    pick_role(pg, "Live Host")
    before = TOGGLE(pg, "perm-Payroll-export")
    check("Live Host may not export payroll today", before == "false", before)
    pg.get_by_test_id("perm-Payroll-export").click(); pg.wait_for_timeout(250)
    check("the switch turns on and the change is counted, unsaved", TOGGLE(pg, "perm-Payroll-export") == "true" and "1 unsaved" in pg.get_by_test_id("perm-pending").inner_text())
    pg.get_by_test_id("perm-save").click(); pg.wait_for_timeout(600)
    check("Save Changes opens the review: who gains", pg.get_by_test_id("review-payroll_export").is_visible() and "Gains: Live Host (2)" in pg.get_by_test_id("review-payroll_export").inner_text(), pg.get_by_test_id("review-payroll_export").inner_text() if pg.get_by_test_id("review-payroll_export").count() else "")
    check("Save waits for a reason of 10 characters", pg.get_by_test_id("perm-confirm").is_disabled())
    pg.get_by_test_id("perm-reason").fill("Live hosts close the payroll export for their shifts")
    pg.get_by_test_id("perm-confirm").click(); pg.wait_for_timeout(900)
    check("...and asks for the authenticator code", answer(pg, "authenticator", "123456"))
    sent = posts(reqs, "/staff/access/policy")
    check("ONE request to the existing route: the changed cap, its whole role list and the reason, with the code",
          len(sent) == 2 and sent[-1].get("changes") == [{"cap": "payroll_export", "roles": ["ceo", "coo", "live_host", "admin", "super_admin"]}] and sent[-1].get("totp") == "123456" and sent[-1].get("reason", "").startswith("Live hosts"), sent)
    check("nothing is left unsaved", pg.get_by_test_id("perm-pending").count() == 0)
    ok_feedback(pg)
    pg.goto("http://127.0.0.1:4320/portal?tab=Users&view=roles"); pg.wait_for_timeout(2600)  # a fresh load of the route
    pick_role(pg, "Live Host")
    check("after a reload the saved cell is still on (read back from the server)", TOGGLE(pg, "perm-Payroll-export") == "true", TOGGLE(pg, "perm-Payroll-export"))
    check("...and the strip counts it as an edited permission", "1" in pg.get_by_test_id("roles-strip").locator("[data-cell=edited]").inner_text())
    pg.get_by_test_id("role-part-details").click(); pg.wait_for_timeout(300)
    check("Role Details lists the edit with its reason", "Live hosts close the payroll export" in pg.get_by_test_id("role-details").inner_text())

    # template + reset
    pg.get_by_test_id("role-part-perms").click(); pg.wait_for_timeout(200)
    pick_role(pg, "Editor")
    pg.get_by_test_id("perm-template").select_option("ceo"); pg.wait_for_timeout(300)
    n = pg.get_by_test_id("perm-pending").inner_text() if pg.get_by_test_id("perm-pending").count() else ""
    check("Set from template drafts the CEO's switches onto the Editor (unsaved)", "unsaved" in n and TOGGLE(pg, "perm-Sales-approve") in ("true", "mixed"), n)
    pg.get_by_test_id("perm-reset").click(); pg.wait_for_timeout(250)
    check("Reset discards the draft", pg.get_by_test_id("perm-pending").count() == 0 and TOGGLE(pg, "perm-Sales-approve") == "false")

    # assign a user
    pick_role(pg, "Marketing")
    pg.get_by_test_id("role-part-users").click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("assign-pick").select_option("9003"); pg.get_by_test_id("assign-go").click(); pg.wait_for_timeout(600)
    check("Assign asks why", answer(pg, "Farid", "Moving to the marketing team this month"))
    check("...and for the code", answer(pg, "authenticator", "123456"))
    rs = posts(reqs, "/staff/users/9003/role")
    check("the role door is the existing route, with the reason and the code", rs and rs[-1].get("role") == "marketing" and rs[-1].get("totp") == "123456" and len(rs[-1].get("reason", "")) >= 10, rs)
    ok_feedback(pg)
    pg.goto("http://127.0.0.1:4320/portal?tab=Users&view=roles"); pg.wait_for_timeout(2600)  # a fresh load of the route
    pick_role(pg, "Marketing"); pg.get_by_test_id("role-part-users").click(); pg.wait_for_timeout(300)
    check("after a reload Farid is in Marketing", pg.get_by_test_id("role-user-9003").count() == 1)

    # drawers
    pg.get_by_test_id("open-exceptions").click(); pg.wait_for_timeout(900)
    check("Per-user exceptions open in their own drawer", pg.get_by_test_id("exceptions-card").is_visible())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    pg.get_by_test_id("open-tab-visibility").click(); pg.wait_for_timeout(1200)
    check("Tab visibility opens in its own drawer", pg.get_by_role("dialog").filter(has_text="Tab visibility").count() == 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    pick_role(pg, "CEO"); pg.get_by_test_id("role-part-perms").click()
    pg.screenshot(path=f"{S}/rp-desktop-final.png")
    check("no page errors (owner)", not errs, errs)
    ctx.close()

    # ---------------- the owner, a 2x screenshot for the record ----------------
    ctx, pg, errs, _ = open_roles(b, 4320, 1440, 900, 2)
    pg.screenshot(path=f"{S}/rp-desktop-2x.png"); ctx.close()

    # ---------------- the owner, iPhone width ----------------
    ctx, pg, errs, _ = open_roles(b, 4320, 390, 844, 2)
    check("390px: no sideways overflow", pg.evaluate(FITS), pg.evaluate("document.documentElement.scrollWidth"))
    dirp, edp = pg.get_by_test_id("role-directory"), pg.get_by_test_id("role-editor")
    check("390px: the directory, then the editor, one column", dirp.bounding_box()["y"] < edp.bounding_box()["y"])
    pick_role(pg, "COO")
    check("390px: each verb carries its word beside the switch", pg.get_by_test_id("perm-mod-Sales").locator("text=Approve").first.is_visible())
    over = pg.evaluate("""() => [...document.querySelectorAll('[data-testid=roles-permissions] *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length""")
    check("390px: nothing in the editor runs off the screen", over == 0, over)
    edp.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{S}/rp-phone.png", full_page=False)
    check("no page errors (phone)", not errs, errs)
    ctx.close()

    # ---------------- a CEO who is not the verified owner: read only ----------------
    ctx, pg, errs, _ = open_roles(b, 4177)
    check("not the owner: no switch anywhere", pg.get_by_test_id("role-perms").locator("[role=checkbox], [role=switch]").count() == 0)
    ceo = pg.get_by_test_id("roles-strip").locator("[data-cell=ceo]").inner_text()
    check("CEO Access says the gap honestly: the owner rights are closed until an owner is verified", "gap" in ceo and "Owner not verified" in ceo, ceo)
    check("no page errors (CEO, not owner)", not errs, errs)
    ctx.close()

    # ---------------- the super admin edits too ----------------
    ctx, pg, errs, _ = open_roles(b, 4321)
    check("the super admin has the switches", pg.get_by_test_id("role-perms").locator("[role=checkbox], [role=switch]").count() > 0)
    check("no page errors (super admin)", not errs, errs)
    ctx.close()
    b.close()

fails = [n for n, c in results if not c]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)

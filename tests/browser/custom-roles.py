"""v1.350.0 - Users & Security -> Roles & Permissions: CUSTOM ROLES (the CEO,
17-11-2026, "A2Z OS - CUSTOM ROLE MANAGEMENT").

What it proves, in a real browser against the built site:
  - the existing page is kept: the same strip (five tiles, Total Roles still the
    server's 10 built-in roles), the Role Directory beside the editor
  - + Create Role sits beside the Role Directory heading (CEO and Super Admin;
    not the COO) and opens the Create Custom Role drawer on the right
  - the drawer: Role name, Description, Base role, Start from, the module
    permissions it starts with, the reason, the protected-roles note; Create
    waits for a name and a reason, asks for the authenticator code, and sends
    ONE request to POST /staff/access/custom-roles
  - the new role is in the directory (Custom), chosen, and its switches are the
    existing editor's, saved through POST /staff/access/policy with its key
  - Assigned Users gives it through the one role door with its key
  - Role Details: Edit, Duplicate, Deactivate / Activate, Delete with a
    reassignment - each to the custom-role routes with a reason and the code
  - the Super Admin does the same; a CEO who is not the verified owner has the
    same Create Role; the COO has none
  - no sideways overflow at 390px, the drawer included
Then screenshots: before (the v1.347.0 build) and after, desktop and phone.

Servers: 4320 ROLE=ceo OWNER=1 ROLESX=1, 4321 ROLE=super_admin ROLESX=1,
4177 ROLE=ceo, 4178 ROLE=coo (this build); 4330 ROLE=ceo OWNER=1 ROLESX=1 (the
v1.347.0 build, for the before picture).  python3 tests/browser/custom-roles.py"""
import json, os, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

S = os.environ.get("SHOTS", "/tmp/cr-shots"); os.makedirs(S, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_roles(b, port, w=1440, h=900):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Users&view=roles"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs, reqs

def sent(reqs, method, suffix):
    out = []
    for m, u, d in reqs:
        if m == method and urllib.parse.urlparse(u).path.endswith(suffix):
            try: out.append(json.loads(d or "{}"))
            except Exception: out.append({})
    return out

def rows(pg):
    return pg.get_by_test_id("roles-table").locator("[data-record^='role:']")

def pick_role(pg, label):
    r = rows(pg)
    for i in range(r.count()):
        if r.nth(i).locator("strong").first.inner_text().strip() == label:
            r.nth(i).click(); pg.wait_for_timeout(350); return True
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
    if b.count() and b.first.is_visible(): b.first.click(); pg.wait_for_timeout(300)

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"

for port in (4320, 4321, 4330):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__rolesx-reset").read()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    # ---------------- BEFORE: the v1.347.0 build ----------------
    ctx, pg, _, _ = open_roles(b, 4330)
    pg.screenshot(path=f"{S}/before-desktop-ceo.png")
    check("before: no Create Role on v1.347.0", pg.get_by_test_id("role-create").count() == 0)
    ctx.close()
    ctx, pg, _, _ = open_roles(b, 4330, 390, 844)
    pg.screenshot(path=f"{S}/before-phone-ceo.png", full_page=True)
    ctx.close()

    # ---------------- AFTER: the owner (CEO), desktop ----------------
    ctx, pg, errs, reqs = open_roles(b, 4320)
    strip = pg.get_by_test_id("roles-strip")
    check("the strip is unchanged: five tiles, Total Roles is still the 10 built-in roles", strip.get_attribute("data-cells") == "5" and "10" in strip.locator("[data-cell=roles]").inner_text(), strip.inner_text())
    head = pg.get_by_test_id("role-directory").locator("header")
    btn = head.get_by_test_id("role-create")
    check("+ Create Role sits in the Role Directory's heading, beside its title", btn.is_visible() and "Role Directory (10)" in head.inner_text() and "Create Role" in btn.inner_text(), head.inner_text())
    check("...in the gold action style of the house", "erp-button-accent" in (btn.get_attribute("class") or ""))
    pg.screenshot(path=f"{S}/after-desktop-ceo.png")
    btn.click(); pg.wait_for_timeout(700)
    # v1.354.0 - + Create Role opens an own role (no base role); the 1.350.0 custom role is one press inside it
    pg.get_by_test_id("own-use-base").click(); pg.wait_for_timeout(700)
    dr = pg.get_by_test_id("cr-form")
    dlg = pg.get_by_role("dialog").filter(has=dr)
    box = dlg.bounding_box() if dlg.count() else None
    check("the Create Custom Role drawer opens on the right", dr.is_visible() and "Create Custom Role" in dlg.inner_text() and box and box["x"] > 700, box)
    txt = dr.inner_text()
    check("the drawer: Role name, Description, Base role, Start from, module permissions, reason", all(x in txt for x in ["Role name *", "Description", "Base role *", "Start permissions from", "Module permissions it starts with", "Reason"]), txt[:400])
    check("the protected-roles note, word for word", "Protected system roles cannot be deleted. CEO and Super Admin share custom-role management." in pg.get_by_test_id("cr-note").inner_text())
    check("only working base roles are offered", pg.get_by_test_id("cr-base").locator("option").all_inner_texts() == ["HR Admin", "Sales & Marketing", "Marketing", "Editor", "Live Host"], pg.get_by_test_id("cr-base").locator("option").all_inner_texts())
    pg.get_by_test_id("cr-base").select_option("sales_marketing"); pg.wait_for_timeout(200)
    mods = pg.get_by_test_id("cr-modules").inner_text()
    check("the module list says what it starts with (Sales & Marketing: Sales View, Claims Create; Payroll No access)", "Sales\nView" in mods and "Payroll\nNo access" in mods and "Claims\nCreate" in mods, mods)
    check("Create waits for a name and a reason", pg.get_by_test_id("cr-submit").is_disabled())
    pg.get_by_test_id("cr-name-input").fill("Sales Coordinator")
    pg.get_by_test_id("cr-desc-input").fill("Prepares quotations and follows up leads")
    pg.get_by_test_id("cr-reason").fill("A coordinator role for the sales desk")
    pg.screenshot(path=f"{S}/after-drawer-create.png")
    pg.get_by_test_id("cr-submit").click(); pg.wait_for_timeout(900)
    check("...and asks for the authenticator code", answer(pg, "authenticator", "123456"))
    cr = sent(reqs, "POST", "/staff/access/custom-roles")
    check("ONE request: name, description, base role, template, reason and the code", len(cr) == 2 and cr[-1] == {"name": "Sales Coordinator", "description": "Prepares quotations and follows up leads", "reason": "A coordinator role for the sales desk", "base_role": "sales_marketing", "template": "sales_marketing", "totp": "123456"}, cr)
    ok_feedback(pg); pg.wait_for_timeout(800)
    check("the drawer closes", pg.get_by_test_id("cr-form").count() == 0 or not pg.get_by_test_id("cr-form").is_visible())
    check("the new role is in the directory, counted in its title, marked Custom", "Role Directory (11)" in pg.get_by_test_id("role-directory").locator("header").inner_text() and pick_role(pg, "Sales Coordinator") and "Custom" in pg.get_by_test_id("roles-table").inner_text())
    check("...and the strip still counts the 10 built-in roles", "10" in pg.get_by_test_id("roles-strip").locator("[data-cell=roles]").inner_text())
    check("it is chosen, on the editor", pg.get_by_test_id("role-title").inner_text() == "Sales Coordinator" and "Custom role on Sales & Marketing" in pg.get_by_test_id("role-editor").inner_text())
    check("it starts with its template's switches (Sales view on, Payroll export off)", pg.get_by_test_id("perm-Sales-view").get_attribute("aria-checked") == "true" and pg.get_by_test_id("perm-Payroll-export").get_attribute("aria-checked") == "false")
    sysm = pg.get_by_test_id("perm-mod-System"); sysm.locator("button[aria-expanded]").click(); pg.wait_for_timeout(300)
    check("a protected capability has no switch for a custom role", sysm.get_by_test_id("act-toggle-backup").count() == 0 and sysm.get_by_test_id("act-toggle-owner_designate").count() == 0 and "Protected" in sysm.inner_text())
    pg.get_by_test_id("perm-Payroll-export").click(); pg.wait_for_timeout(250)
    pg.get_by_test_id("perm-save").click(); pg.wait_for_timeout(500)
    pg.get_by_test_id("perm-reason").fill("The coordinator prepares the payroll export")
    pg.get_by_test_id("perm-confirm").click(); pg.wait_for_timeout(900)
    answer(pg, "authenticator", "123456")
    pol = sent(reqs, "POST", "/staff/access/policy")
    check("its switch is saved through the existing matrix route, with its key", pol and pol[-1].get("changes") == [{"cap": "payroll_export", "roles": ["ceo", "coo", "admin", "super_admin", "cr_sales_coordinator"]}], pol)
    ok_feedback(pg)
    pg.goto("http://127.0.0.1:4320/portal?tab=Users&view=roles"); pg.wait_for_timeout(2600)
    pick_role(pg, "Sales Coordinator")
    check("after a reload the role and its saved switch are still there", pg.get_by_test_id("perm-Payroll-export").get_attribute("aria-checked") == "true")
    check("...and Edited Permissions does not count a custom column", pg.get_by_test_id("roles-strip").locator("[data-cell=edited]").inner_text().strip().splitlines()[1].strip() == "0", pg.get_by_test_id("roles-strip").locator("[data-cell=edited]").inner_text())

    # assign
    pg.get_by_test_id("role-part-users").click(); pg.wait_for_timeout(300)
    opts = pg.get_by_test_id("assign-pick").locator("option")
    check("Assigned Users offers staff accounts", opts.count() > 1)
    pg.get_by_test_id("assign-pick").select_option(index=1); pg.wait_for_timeout(200)
    pg.get_by_test_id("assign-go").click(); pg.wait_for_timeout(700)
    dlg2 = pg.get_by_role("dialog").filter(has_text="Sales Coordinator").last
    dlg2.locator("input").first.fill("Moves to the sales coordinator desk"); dlg2.get_by_role("button", name="Save", exact=True).click(); pg.wait_for_timeout(900)
    answer(pg, "authenticator", "123456")
    asg = [x for x in sent(reqs, "POST", "/role") if x.get("role")]
    check("given through the one role door with its key, a reason and the code", asg and asg[-1].get("role") == "cr_sales_coordinator" and asg[-1].get("totp") == "123456" and asg[-1].get("reason", "").startswith("Moves"), asg)
    ok_feedback(pg); pg.wait_for_timeout(1500)
    pick_role(pg, "Sales Coordinator"); pg.get_by_test_id("role-part-users").click(); pg.wait_for_timeout(400)
    check("the person is listed under the custom role", pg.get_by_test_id("role-users").locator("[data-testid^=role-user-]").count() == 1, pg.get_by_test_id("role-users").inner_text()[:300])
    pg.screenshot(path=f"{S}/after-assigned-users.png")

    # details: edit, duplicate, deactivate, activate, delete
    pg.get_by_test_id("role-part-details").click(); pg.wait_for_timeout(300)
    det = pg.get_by_test_id("role-details").inner_text()
    check("Role Details: name, Custom role, base role, description, created", all(x in det for x in ["Sales Coordinator", "Custom role", "Sales & Marketing", "Prepares quotations", "Fixture Person"]), det[:400])
    pg.screenshot(path=f"{S}/after-role-details.png")
    pg.get_by_test_id("cr-edit").click(); pg.wait_for_timeout(500)
    pg.get_by_test_id("cr-name-input").fill("Sales Desk Coordinator")
    pg.get_by_test_id("cr-reason").fill("A clearer name for the desk role")
    pg.get_by_test_id("cr-submit").click(); pg.wait_for_timeout(800); answer(pg, "authenticator", "123456")
    pat = sent(reqs, "PATCH", "/staff/access/custom-roles/500")
    check("Edit details: PATCH the role with its name, description and a reason", pat and pat[-1].get("name") == "Sales Desk Coordinator" and pat[-1].get("reason"), pat)
    ok_feedback(pg); pg.wait_for_timeout(800)
    check("the new name reads in the directory", pick_role(pg, "Sales Desk Coordinator"))
    pg.get_by_test_id("role-part-details").click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("cr-duplicate").click(); pg.wait_for_timeout(500)
    check("Duplicate opens the drawer with a copy name", pg.get_by_test_id("cr-name-input").input_value() == "Sales Desk Coordinator (copy)" and "Duplicate Custom Role" in pg.get_by_role("dialog").filter(has=pg.get_by_test_id("cr-form")).inner_text())
    pg.get_by_test_id("cr-name-input").fill("Sales Desk Night")
    pg.get_by_test_id("cr-reason").fill("A night-shift copy of the desk role")
    pg.get_by_test_id("cr-submit").click(); pg.wait_for_timeout(800); answer(pg, "authenticator", "123456")
    check("Duplicate: POST .../500/duplicate", sent(reqs, "POST", "/staff/access/custom-roles/500/duplicate"))
    ok_feedback(pg); pg.wait_for_timeout(800)
    check("the copy is chosen", pg.get_by_test_id("role-title").inner_text() == "Sales Desk Night")
    pick_role(pg, "Sales Desk Coordinator"); pg.get_by_test_id("role-part-details").click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("cr-toggle").click(); pg.wait_for_timeout(500)
    dlg3 = pg.get_by_role("dialog").filter(has_text="Deactivate").last
    check("Deactivate says the holders fall back to the base role", "fall back to Sales & Marketing" in dlg3.inner_text(), dlg3.inner_text()[:300])
    dlg3.locator("input").first.fill("Paused while the desk is reorganised"); dlg3.get_by_role("button", name="Save", exact=True).click(); pg.wait_for_timeout(900)
    answer(pg, "authenticator", "123456")
    ok_feedback(pg); pg.wait_for_timeout(800)
    pick_role(pg, "Sales Desk Coordinator")
    check("deactivated: marked in the directory and on the editor", "Deactivated" in pg.get_by_test_id("roles-table").inner_text() and pg.get_by_test_id("role-deactivated").is_visible())
    pg.get_by_test_id("role-part-users").click(); pg.wait_for_timeout(300)
    check("a deactivated role cannot be given", pg.get_by_test_id("assign-pick").count() == 0 and "Activate this role" in pg.get_by_test_id("role-users").inner_text())
    pg.get_by_test_id("role-part-details").click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("cr-toggle").click(); pg.wait_for_timeout(500)
    dlg4 = pg.get_by_role("dialog").filter(has_text="Activate").last
    dlg4.locator("input").first.fill("The desk is running again"); dlg4.get_by_role("button", name="Save", exact=True).click(); pg.wait_for_timeout(900)
    answer(pg, "authenticator", "123456"); ok_feedback(pg); pg.wait_for_timeout(800)
    acts = [x.get("active") for x in sent(reqs, "PATCH", "/staff/access/custom-roles/500") if "active" in x and x.get("totp")]
    check("Deactivate then Activate: PATCH active false, then true", acts[-2:] == [False, True], acts)
    pick_role(pg, "Sales Desk Coordinator"); pg.get_by_test_id("role-part-details").click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("cr-delete").click(); pg.wait_for_timeout(500)
    df = pg.get_by_test_id("cr-delete-form")
    check("Delete asks where the 1 holder goes: the base role, or a custom role on the same base", "1 account(s) hold this role" in df.inner_text() and pg.get_by_test_id("cr-reassign").locator("option").all_inner_texts() == ["Back to Sales & Marketing (the base role)", "Sales Desk Night"], pg.get_by_test_id("cr-reassign").locator("option").all_inner_texts())
    pg.screenshot(path=f"{S}/after-drawer-delete.png")
    pg.get_by_test_id("cr-reassign").select_option(label="Sales Desk Night")
    pg.get_by_test_id("cr-delete-reason").fill("Merged into the night desk role")
    pg.get_by_test_id("cr-delete-confirm").click(); pg.wait_for_timeout(800); answer(pg, "authenticator", "123456")
    dl = sent(reqs, "POST", "/staff/access/custom-roles/500/delete")
    check("Delete: POST .../500/delete with the reassignment and a reason", dl and dl[-1].get("reassign_to") == 501 and dl[-1].get("reason", "").startswith("Merged"), dl)
    ok_feedback(pg); pg.wait_for_timeout(1000)
    check("the role is gone from the directory; the moved person holds the other", not pick_role(pg, "Sales Desk Coordinator") and pick_role(pg, "Sales Desk Night") and (pg.get_by_test_id("role-part-users").click(), pg.wait_for_timeout(300), pg.get_by_test_id("role-users").locator("[data-testid^=role-user-]").count())[2] == 1)
    check("no page errors", not errs, errs)
    ctx.close()

    # ---------------- the owner, phone ----------------
    ctx, pg, errs, _ = open_roles(b, 4320, 390, 844)
    check("phone: no sideways overflow", pg.evaluate(FITS))
    pg.get_by_test_id("role-create").scroll_into_view_if_needed()
    check("phone: + Create Role is in the directory heading", pg.get_by_test_id("role-create").is_visible())
    pg.screenshot(path=f"{S}/after-phone-ceo.png", full_page=True)
    pg.get_by_test_id("role-create").click(); pg.wait_for_timeout(700)
    pg.get_by_test_id("own-use-base").click(); pg.wait_for_timeout(700)
    check("phone: the drawer opens and nothing spills sideways", pg.get_by_test_id("cr-form").is_visible() and pg.evaluate(FITS))
    pg.screenshot(path=f"{S}/after-phone-drawer.png")
    ctx.close()

    # ---------------- the Super Admin: the same door ----------------
    ctx, pg, errs, reqs = open_roles(b, 4321)
    check("super admin: + Create Role", pg.get_by_test_id("role-create").is_visible())
    pg.get_by_test_id("role-create").click(); pg.wait_for_timeout(600)
    pg.get_by_test_id("own-use-base").click(); pg.wait_for_timeout(600)
    pg.get_by_test_id("cr-name-input").fill("Stock Clerk"); pg.get_by_test_id("cr-base").select_option("editor")
    pg.get_by_test_id("cr-reason").fill("Receives and counts stock in the store")
    pg.get_by_test_id("cr-submit").click(); pg.wait_for_timeout(800); answer(pg, "authenticator", "654321")
    check("super admin: the same POST, with the code", sent(reqs, "POST", "/staff/access/custom-roles")[-1].get("totp") == "654321")
    ok_feedback(pg); pg.wait_for_timeout(800)
    check("super admin: the role is chosen and its switches can be turned", pg.get_by_test_id("role-title").inner_text() == "Stock Clerk" and pg.get_by_test_id("perm-Payroll-export").count() == 1)
    pg.get_by_test_id("role-part-details").click(); pg.wait_for_timeout(300)
    check("super admin: Edit, Duplicate, Deactivate and Delete", all(pg.get_by_test_id(t).is_visible() for t in ["cr-edit", "cr-duplicate", "cr-toggle", "cr-delete"]))
    pg.get_by_test_id("cr-delete").click(); pg.wait_for_timeout(400)
    check("super admin: an unused role needs no reassignment", "Nobody holds this role." in pg.get_by_test_id("cr-delete-form").inner_text() and pg.get_by_test_id("cr-reassign").count() == 0)
    pg.get_by_test_id("cr-delete-reason").fill("Created to test the door only")
    pg.get_by_test_id("cr-delete-confirm").click(); pg.wait_for_timeout(800); answer(pg, "authenticator", "654321"); ok_feedback(pg); pg.wait_for_timeout(800)
    check("super admin: deleted", not pick_role(pg, "Stock Clerk"))
    pg.screenshot(path=f"{S}/after-desktop-superadmin.png")
    check("super admin: no page errors", not errs, errs)
    ctx.close()

    # ---------------- a CEO who is not the owner; the COO ----------------
    ctx, pg, errs, _ = open_roles(b, 4177)
    check("a CEO-role account (not the owner) has the same + Create Role", pg.get_by_test_id("role-create").is_visible())
    ctx.close()
    ctx, pg, errs, _ = open_roles(b, 4178)
    check("the COO has no Create Role", pg.get_by_test_id("roles-permissions").count() == 0 or pg.get_by_test_id("role-create").count() == 0)
    ctx.close()
    b.close()

bad = [n for n, ok in results if not ok]
print(f"\ncustom-roles (browser): {len(results) - len(bad)} of {len(results)} passed; shots in {S}")
raise SystemExit(1 if bad else 0)

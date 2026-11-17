"""ROLES V2, STAGE 1 (v1.355.0, docs/ROLES-V2-PLAN.md) - the browser.

The CEO, 17-11-2026: "permission roles that for me to create by myself or super
admin without hardcoded ... add or remove the roles based on the operation needed".
Users & Security -> Roles & Permissions:
  - + Create Role opens YOUR role: no base role - a name, a description, the
    counts-as-staff switch (on by default), the pages it sees, permissions
    blank or copied from any role; a reason and the authenticator code
  - the new role is chosen, marked "Setting up", and never offered to a person
  - its switches save through the one policy door, with its own column
  - Role Details: Edit (PATCH) and Delete (reason, then the code)
  - the 1.350.0 custom role is one press inside the drawer
  - the COO has no Create Role; nothing spills sideways at 390px

Servers: 4340 ROLE=ceo OWNER=1 ROLESX=1, 4341 ROLE=coo, 4342 ROLE=r_packing_crew ROLE_TABS=Inventory,Tasks (this build).
    python3 tests/browser/roles-v2.py"""
import json, re, os, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

S = os.environ.get("SHOTS", "/tmp/rv2-shots"); os.makedirs(S, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"

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

urllib.request.urlopen("http://127.0.0.1:4340/__rolesx-reset").read()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    # ---------------- the owner (CEO), desktop ----------------
    ctx, pg, errs, reqs = open_roles(b, 4340)
    pg.get_by_test_id("role-create").click(); pg.wait_for_timeout(700)
    dr = pg.get_by_test_id("own-form")
    dlg = pg.get_by_role("dialog").filter(has=dr)
    txt = dr.inner_text()
    check("+ Create Role opens YOUR role: no base role", dr.is_visible() and "Create Role" in dlg.inner_text() and pg.get_by_test_id("cr-base").count() == 0, txt[:300])
    check("the drawer: name, description, the staff switch, the pages, blank or a copy, reason",
          all(x in txt for x in ["Role name *", "Description", "Counts as company staff", "Pages it sees", "Permissions start", "Reason"]), txt[:500])
    sw = pg.get_by_test_id("own-staff-switch")
    check("counts as staff is on by default (R-4)", sw.get_attribute("aria-checked") == "true")
    check("the permissions start blank by default", pg.get_by_test_id("own-from").input_value() == "")
    check("Create waits for a name and a reason", pg.get_by_test_id("own-submit").is_disabled())
    pg.get_by_test_id("own-name-input").fill("Warehouse Clerk")
    pg.get_by_test_id("own-desc-input").fill("Receives and counts stock")
    sw.click(); pg.wait_for_timeout(150)
    check("the staff switch turns off", sw.get_attribute("aria-checked") == "false")
    pg.get_by_test_id("own-tab-Inventory").check(); pg.get_by_test_id("own-tab-Payroll").check()
    check("the pages chosen are counted", "2 chosen" in pg.get_by_test_id("own-pages-pick").inner_text())
    pg.get_by_test_id("own-reason").fill("A role for the new warehouse desk")
    pg.screenshot(path=f"{S}/create-drawer.png")
    pg.get_by_test_id("own-submit").click(); pg.wait_for_timeout(900)
    check("...and asks for the authenticator code", answer(pg, "authenticator", "123456"))
    c = sent(reqs, "POST", "/staff/access/roles")
    check("POST /staff/access/roles with the name, the staff switch, the pages and blank cells",
          c and c[-1].get("name") == "Warehouse Clerk" and c[-1].get("counts_as_staff") is False and c[-1].get("tabs") == ["Inventory", "Payroll"] and c[-1].get("copy_from") == "" and c[-1].get("totp") and len(c[-1].get("reason", "")) >= 10, c)
    check("no base role was sent", c and "base_role" not in c[-1], c)
    ok_feedback(pg); pg.wait_for_timeout(800)
    check("the new role is chosen", pg.get_by_test_id("role-title").inner_text() == "Warehouse Clerk")
    check("it is marked Setting up", pg.get_by_test_id("role-setting-up").is_visible())
    check("the directory says Your role", "Your role" in pg.get_by_test_id("roles-table").inner_text())
    pg.screenshot(path=f"{S}/created.png")

    # its switches: one column, the one save door
    tog = pg.get_by_test_id("perm-Claims-create")
    check("its permissions are blank and switchable", tog.count() == 1 and tog.get_attribute("aria-checked") == "false")
    tog.click(); pg.wait_for_timeout(200)
    pg.get_by_test_id("perm-save").click(); pg.wait_for_timeout(500)
    pg.get_by_test_id("perm-reason").fill("The clerk files stock claims")
    pg.get_by_role("dialog").get_by_role("button", name="Save", exact=False).last.click(); pg.wait_for_timeout(800)
    answer(pg, "authenticator", "123456")
    pol = sent(reqs, "POST", "/staff/access/policy")
    check("a switch saves through /staff/access/policy with its own column", pol and any("r_warehouse_clerk" in (ch.get("roles") or []) for ch in pol[-1].get("changes", [])), pol)
    ok_feedback(pg); pg.wait_for_timeout(800)

    # v1.358.0 - stage 3: given to a person through the role door (a reason, then the code)
    pg.get_by_test_id("role-part-users").click(); pg.wait_for_timeout(300)
    check("Assigned Users: the account picker and the approval note", pg.get_by_test_id("own-in-force").is_visible() and pg.get_by_test_id("assign-pick").count() == 1 and pg.get_by_test_id("own-not-yet").count() == 0)
    pg.get_by_test_id("assign-pick").select_option(index=1); pg.get_by_test_id("assign-go").click(); pg.wait_for_timeout(600)
    check("Assign asks why", answer(pg, "Why", "Moving to the warehouse desk this month"))
    check("...and for the code", answer(pg, "authenticator", "123456"))
    asg = [json.loads(d or "{}") for m, u, d in reqs if m == "POST" and re.search(r"/staff/users/\d+/role$", urllib.parse.urlparse(u).path)]
    check("the role door carries the own role's key, the reason and the code", asg and asg[-1].get("role") == "r_warehouse_clerk" and asg[-1].get("totp") == "123456" and len(asg[-1].get("reason", "")) >= 10, asg[-1:])
    ok_feedback(pg); pg.wait_for_timeout(600)
    pg.get_by_test_id("role-part-preview").click(); pg.wait_for_timeout(300)
    prev = pg.get_by_test_id("role-preview").inner_text()
    check("Access Preview reads the chosen pages (Payroll seen, Users not)", prev.index("Payroll") < prev.index("Does not see") < prev.index("Users"), prev[:300])

    # details: edit and delete
    pg.get_by_test_id("role-part-details").click(); pg.wait_for_timeout(300)
    det = pg.get_by_test_id("role-details").inner_text()
    check("Role Details: name, no base role, staff No, the pages, the description", all(x in det for x in ["Warehouse Clerk", "no base role", "No", "Inventory", "Receives and counts stock"]), det[:400])
    pg.get_by_test_id("own-edit").click(); pg.wait_for_timeout(500)
    check("Edit opens the same drawer with the role's values", pg.get_by_test_id("own-name-input").input_value() == "Warehouse Clerk" and pg.get_by_test_id("own-tab-Inventory").is_checked() and pg.get_by_test_id("own-from").count() == 0)
    pg.get_by_test_id("own-name-input").fill("Stock Clerk")
    pg.get_by_test_id("own-reason").fill("A clearer name for the warehouse role")
    pg.get_by_test_id("own-submit").click(); pg.wait_for_timeout(800); answer(pg, "authenticator", "123456")
    pat = sent(reqs, "PATCH", "/staff/access/roles/r_warehouse_clerk")
    check("Edit: PATCH the role with its name, the pages and a reason", pat and pat[-1].get("name") == "Stock Clerk" and pat[-1].get("tabs") == ["Inventory", "Payroll"], pat)
    ok_feedback(pg); pg.wait_for_timeout(800)
    check("the new name reads in the title", pg.get_by_test_id("role-title").inner_text() == "Stock Clerk")
    pg.get_by_test_id("role-part-details").click(); pg.wait_for_timeout(300)
    pg.get_by_test_id("own-delete").click(); pg.wait_for_timeout(500)
    dl = pg.get_by_role("dialog").filter(has_text="Delete Stock Clerk")
    check("Delete asks for a reason first", dl.count() == 1)
    dl.locator("input, textarea").first.fill("The warehouse desk was folded into Sales")
    dl.get_by_role("button", name="Save", exact=True).click(); pg.wait_for_timeout(900)
    answer(pg, "authenticator", "123456")
    check("Delete: POST .../r_warehouse_clerk/delete", sent(reqs, "POST", "/staff/access/roles/r_warehouse_clerk/delete"))
    ok_feedback(pg); pg.wait_for_timeout(800)
    check("the role is gone from the directory", "Stock Clerk" not in pg.get_by_test_id("roles-table").inner_text())

    # the 1.350.0 custom role, one press away
    pg.get_by_test_id("role-create").click(); pg.wait_for_timeout(600)
    pg.get_by_test_id("own-use-base").click(); pg.wait_for_timeout(600)
    check("the 1.350.0 custom role (on a base role) is one press inside the drawer", pg.get_by_test_id("cr-form").is_visible() and pg.get_by_test_id("cr-base").count() == 1)
    check("no page errors", not errs, errs)
    ctx.close()

    # ---------------- the COO ----------------
    ctx, pg, errs, _ = open_roles(b, 4341)
    check("the COO has no Create Role", pg.get_by_test_id("role-create").count() == 0)
    ctx.close()

    # ---------------- stage 2: a person on an own role (4342 ROLE=r_packing_crew ROLE_TABS=Inventory,Tasks) ----------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:4342/portal"); pg.wait_for_timeout(2800)
    nav = pg.locator("nav").first.inner_text()
    check("stage 2: the sidebar shows the role's own pages", "Inventory" in nav and "Tasks" in nav, nav[:400])
    check("stage 2: ...and the pages every role sees", "Dashboard" in nav and "Desk" in nav and "On Shift" in nav, nav[:400])
    check("stage 2: the account chip names the role as the owner wrote it", "Packing Crew" in pg.locator("body").inner_text())
    check("stage 2: ...and nothing else", all(x not in nav for x in ["Payroll", "Sales", "Users & Security", "Claims", "Leave"]), nav[:400])
    pg.screenshot(path=f"{S}/stage2-sidebar.png")
    check("stage 2: no page errors", not errs, errs)
    ctx.close()

    # ---------------- the owner, phone ----------------
    ctx, pg, errs, _ = open_roles(b, 4340, 390, 844)
    check("phone: no sideways overflow", pg.evaluate(FITS))
    pg.get_by_test_id("role-create").scroll_into_view_if_needed()
    pg.get_by_test_id("role-create").click(); pg.wait_for_timeout(700)
    check("phone: the drawer opens and nothing spills sideways", pg.get_by_test_id("own-form").is_visible() and pg.evaluate(FITS))
    pg.screenshot(path=f"{S}/phone-drawer.png")
    check("phone: no page errors", not errs, errs)
    ctx.close()
    b.close()

bad = [n for n, c in results if not c]
print(f"\nroles-v2 (browser): {len(results) - len(bad)}/{len(results)} passed")
raise SystemExit(1 if bad else 0)

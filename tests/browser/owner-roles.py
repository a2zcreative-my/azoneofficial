"""v1.249.2 - the owner's three corrections of 01-11-2026, on screen.

1. Tasks: the Dates cell is a real table cell (it was display:grid, which left
   a white box in an overdue row).
2. /admin > Users: the verified owner-CEO gives and takes every role, Super
   Admin and CEO included - reason, then authenticator code, then the PATCH;
   the Admin account sees roles read only; any other CEO goes to /portal.
3. Companies > Document & Signing (Users > Signatures & Stamps until 1.251.0) shows the officer chops already in the /admin
   vault, per company, with the person holding each role today and the new
   flow's Register button; COO (no vault access) does not get the block.

Servers (servers.txt): 4177 ROLE=ceo, 4191 ROLE=ceo OWNER=1, 4186 ROLE=admin,
4183 ROLE=super_admin, 4219 ROLE=ceo SIGN=1, 4220 ROLE=coo SIGN=1. Who may do
what is proven by direct request in tests/owner-access.mjs."""
import json
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_page(b, port, path="/portal", w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h})
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(2500)
    return ctx, pg, errs, reqs

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- 1. Tasks: the Dates cell ----
    for sub in ["My Tasks", "All Tasks"]:
        ctx, pg, errs, _ = open_page(b, 4177, "/portal?tab=Tasks")
        t = pg.get_by_role("tab", name=sub, exact=True)
        if t.count(): t.first.click(); pg.wait_for_timeout(1500)
        bad = pg.evaluate("""() => [...document.querySelectorAll('td[data-label="Dates"]')]
            .filter(td => getComputedStyle(td).display !== 'table-cell').length""")
        n = pg.evaluate("""() => document.querySelectorAll('td[data-label="Dates"]').length""")
        check(f"{sub}: every Dates cell is a table cell ({n} rows)", n > 0 and bad == 0, f"{bad} of {n}")
        same = pg.evaluate("""() => [...document.querySelectorAll('tr')].filter(tr => tr.querySelector('td[data-label="Dates"]'))
            .every(tr => { const tds = [...tr.children]; const h = tds.map(td => td.getBoundingClientRect().height);
                           return Math.max(...h) - Math.min(...h) < 1; })""")
        check(f"{sub}: the Dates cell is as tall as its row (no box inside the row)", same)
        check(f"no page errors (tasks, {sub})", not errs, errs)
        ctx.close()

    # ---- 2. /admin > Users ----
    ctx, pg, errs, reqs = open_page(b, 4191, "/admin")
    check("the owner-CEO opens /admin (not sent back to /portal)", "/admin" in pg.url, pg.url)
    txt = pg.locator("main").inner_text() if pg.locator("main").count() else ""
    check("...on Users, with the owner's rule said where it is decided", "As the company owner you give and take every role here" in txt, txt[:300])
    selects = pg.locator("main select")
    opts = selects.nth(1).locator("option").all_inner_texts() if selects.count() > 1 else []
    check("the role list offers Super Admin and CEO", "super_admin" in opts and "ceo" in opts, opts)
    root_row = pg.locator("main div.rounded-lg", has_text="root@azoneofficial.com").first
    check("a super admin's role can be changed by the owner", root_row.locator("select").is_enabled())
    check("...but not their password or sign-in (no Reset password / Suspend)", root_row.get_by_role("button", name="Reset password").count() == 0)
    me_row = pg.locator("main div.rounded-lg", has_text="fixture@example.test").first
    check("never the owner's own role", me_row.locator("select").is_disabled())
    row = pg.locator("main div.rounded-lg", has_text="aisyah@example.test").first
    row.locator("select").select_option("super_admin"); pg.wait_for_timeout(500)
    pg.get_by_role("button", name="Change Role").click(); pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog")
    check("a role change asks the owner why", dlg.count() == 1 and "Why" in dlg.inner_text(), dlg.inner_text()[:200] if dlg.count() else "")
    dlg.locator("input, textarea").first.fill("Aisyah runs the system while I travel")
    reqs.clear(); dlg.get_by_role("button", name="Save").click(); pg.wait_for_timeout(900)
    dlg = pg.get_by_role("dialog")
    check("...then for the authenticator code", dlg.count() == 1 and "authenticator" in dlg.inner_text().lower(), dlg.inner_text()[:200] if dlg.count() else "")
    dlg.locator("input").first.fill("123456"); dlg.get_by_role("button", name="Save").click(); pg.wait_for_timeout(1200)
    sent = [json.loads(r[2] or "{}") for r in reqs if r[0] == "PATCH" and r[1].endswith("/api/v1/users/9002")]
    check("the change goes to the server with the role, the reason and the code", len(sent) == 2 and sent[-1].get("role") == "super_admin" and sent[-1].get("reason", "").startswith("Aisyah") and sent[-1].get("totp") == "123456" and "totp" not in sent[0], sent)
    check("no page errors (owner /admin)", not errs, errs)
    ctx.close()

    ctx, pg, errs, _ = open_page(b, 4191, "/admin", 390, 844)
    check("on a phone /admin > Users fits the screen", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    ctx.close()

    ctx, pg, errs, _ = open_page(b, 4177, "/admin")
    pg.wait_for_timeout(1000)
    check("a CEO who is not the verified owner is sent to /portal", "/portal" in pg.url, pg.url)
    ctx.close()

    ctx, pg, errs, _ = open_page(b, 4186, "/admin")
    for name in ["Users", "Pengguna"]:
        btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
        if btn.count(): btn.first.click(); pg.wait_for_timeout(1500); break
    t = pg.locator("main").inner_text()
    sel = pg.locator("main div.rounded-lg select")
    check("the Admin account sees roles read only", "Read only for roles" in t and sel.count() > 0 and all(sel.nth(i).is_disabled() for i in range(sel.count())), t[:200])
    ctx.close()

    ctx, pg, errs, _ = open_page(b, 4183, "/admin")
    for name in ["Users", "Pengguna"]:
        btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
        if btn.count(): btn.first.click(); pg.wait_for_timeout(1500); break
    sel = pg.locator("main div.rounded-lg", has_text="aisyah@example.test").first.locator("select")
    check("the super admin still changes roles in /admin", sel.count() == 1 and sel.is_enabled())
    ctx.close()

    # ---- 3. Signatures & Stamps: the /admin chops (v1.251.0 - in Companies > Document & Signing) ----
    ctx, pg, errs, _ = open_page(b, 4219, "/portal?tab=Companies")
    st = pg.get_by_role("tab", name="Document & Signing")
    if st.count(): st.first.click(); pg.wait_for_timeout(2000)
    oc = pg.get_by_test_id("officer-chops")
    check("Signatures & Stamps shows the officer chops from /admin", oc.count() == 1)
    t = oc.inner_text() if oc.count() else ""
    check("...per officer role, with the version on file and who holds the role today", "CEO" in t and "Version 2" in t and "Fixture Person" in t and "Nur Aisyah" in t, t[:400])
    imgs = oc.locator("img")
    check("...the pictures come from the /admin vault for this company", imgs.count() == 3 and all("/api/v1/staff/signature/a2z/" in (imgs.nth(i).get_attribute("src") or "") for i in range(imgs.count())), [imgs.nth(i).get_attribute("src") for i in range(imgs.count())])
    check("...a role with nothing on file says so", "Missing - prints a blank space" in pg.get_by_test_id("chop-cco").inner_text())
    check("...and each holder has the new flow's button", pg.get_by_test_id("chop-sales_marketing").get_by_role("button", name="Replace Nur Aisyah's signature").count() == 1)
    pg.get_by_role("tab", name="AZ ONE OFFICIAL").click(); pg.wait_for_timeout(800)
    imgs = oc.locator("img")
    check("switching company shows that company's chops only", imgs.count() == 1 and "/signature/azoo/ceo-sign.png" in (imgs.first.get_attribute("src") or ""), imgs.count())
    check("no page errors (signing)", not errs, errs)
    ctx.close()

    ctx, pg, errs, _ = open_page(b, 4220, "/portal?tab=Companies")
    st = pg.get_by_role("tab", name="Document & Signing")
    if st.count(): st.first.click(); pg.wait_for_timeout(2000)
    check("the COO (no vault access) sees the panel without the chops block", pg.get_by_test_id("signing-panel").count() == 1 and pg.get_by_test_id("officer-chops").count() == 0)
    ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"owner-roles: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

"""v1.252.1 - where the Super Admin names the company owner (the owner,
02-11-2026: "inside the /Admin User I cant see anything for me to update").

The Super Admin finds the Company owner card in /admin > Users as well as
in the portal, where it is the first thing in Security & Sessions while no
owner is verified. A CEO without the owner record is told the Super Admin
does it, and where. The server decides (tests/go-live-i.mjs and the owner
guards). Servers (servers.txt): 4183 ROLE=super_admin (no owner yet),
4177 ROLE=ceo (not the owner), 4191 ROLE=ceo OWNER=1. Invented people only."""
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"

def open_page(b, port, path, w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()
    for w in [1440, 390]:
        ctx, pg, errs = open_page(b, 4183, "/admin", w=w, h=900)
        t = pg.get_by_role("button", name="Users", exact=True).or_(pg.get_by_role("tab", name="Users", exact=True)).or_(pg.get_by_role("link", name="Users", exact=True))
        if w < 500:  # on a phone Users sits under More in the bottom bar
            pg.get_by_role("button", name="More", exact=True).first.click(); pg.wait_for_timeout(800)
            t = pg.get_by_role("button", name="Users", exact=True).filter(visible=True).or_(pg.get_by_role("link", name="Users", exact=True).filter(visible=True)).or_(pg.get_by_role("menuitem", name="Users").filter(visible=True))
        if t.count(): t.first.click(); pg.wait_for_timeout(1500)
        card = pg.get_by_test_id("admin-owner")
        ct = card.inner_text() if card.count() else ""
        check(f"/admin {w}px: the Super Admin sees the Company owner card in Users", card.count() == 1 and "Company owner" in ct, ct[:200])
        check(f"/admin {w}px: ...with the CEO account to pick, the reason and Name as company owner", card.locator("select").count() == 1 and card.get_by_role("button", name="Name as company owner").count() == 1)
        check(f"/admin {w}px: ...and the accounts list still below it", pg.get_by_role("heading", name="Add user").count() == 1)
        check(f"/admin {w}px: the page does not scroll sideways", pg.evaluate(FITS))
        if w == 1440:
            pg.screenshot(path="/tmp/claude-0/-home-claude/0ecda43f-f8f0-517b-9346-19977e887fa5/scratchpad/admin-owner.png", full_page=False)
        check(f"/admin {w}px: no page errors", not errs, errs)
        ctx.close()

    ctx, pg, errs = open_page(b, 4183, "/portal?tab=Users")
    pg.get_by_role("tab", name="Security & Sessions", exact=True).first.click(); pg.wait_for_timeout(1200)
    sec = pg.locator("div:not([hidden])").filter(has=pg.get_by_test_id("owner-zone")).last
    check("portal: the security view is titled Security & Sessions, like its tab", pg.get_by_role("heading", name="Security & Sessions").count() >= 1 and pg.get_by_role("heading", name="Security & Settings").count() == 0)
    oz = pg.get_by_test_id("owner-zone"); log = pg.get_by_text("User log", exact=False).first
    check("portal: with no owner yet, Company owner is the first card in Security & Sessions", oz.is_visible() and oz.bounding_box()["y"] < log.bounding_box()["y"], [oz.bounding_box(), log.bounding_box()])
    check("portal: no page errors (super admin)", not errs, errs)
    ctx.close()

    ctx, pg, errs = open_page(b, 4177, "/portal?tab=Users")
    ban = pg.get_by_test_id("owner-off").inner_text() if pg.get_by_test_id("owner-off").count() else ""
    check("CEO without the owner record: the banner says the Super Admin does it, not this account, and where (/admin > Users)", "Super Admin (not this CEO account)" in ban and "/admin → Users → Company owner" in ban, ban)
    ctx.close()

    ctx, pg, errs = open_page(b, 4191, "/portal?tab=Users")
    pg.get_by_role("tab", name="Security & Sessions", exact=True).first.click(); pg.wait_for_timeout(1200)
    oz = pg.get_by_test_id("owner-zone"); log = pg.get_by_text("User log", exact=False).first
    check("verified owner: Company owner goes back below the sign-in log", oz.count() == 1 and oz.bounding_box()["y"] > log.bounding_box()["y"])
    check("verified owner: no designate form for the CEO (super admin only)", pg.get_by_role("button", name="Name as company owner").count() == 0)
    ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"owner-door: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

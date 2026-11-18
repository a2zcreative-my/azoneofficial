"""v1.376.0 - Users -> Staff Accounts -> Move staff to @a2zcreative.my, on screen.

Server (serve.mjs over out/): ROLE=super_admin EMAILMOVE=1 on 4375. The fixture
(email-move-fixture.mjs) mirrors the list, the preview and the send; the
worker's own rules are proven by tests/staff-email-move.mjs.  SHOTS=dir writes
the screenshots."""
import json, os, re, urllib.request
from playwright.sync_api import sync_playwright

SHOTS = os.environ.get("SHOTS", "")
PORT = int(os.environ.get("PORT", "4375"))
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
def shot(pg, name, full=False):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name), full_page=full)
def fits(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def t(pg, i): return pg.get_by_test_id(i)
def reset(): urllib.request.urlopen(f"http://127.0.0.1:{PORT}/__emailmove-reset").read()
URL = "/portal?tab=Users&view=staff"

def page(b, w, h):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    ctx.add_init_script("try { localStorage.setItem('azone-lang', 'en') } catch (e) {}")
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{PORT}{URL}"); pg.wait_for_timeout(2500)
    return ctx, pg, errs, reqs

def answer(pg, has, value):
    dlg = pg.get_by_role("dialog").filter(has_text=has).filter(has=pg.get_by_role("button", name="Save", exact=True))
    if not dlg.count(): return False
    dlg = dlg.last
    dlg.locator("input").first.fill(value)
    dlg.get_by_role("button", name="Save", exact=True).click(); pg.wait_for_timeout(1200)
    return True

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    reset()
    ctx, pg, errs, reqs = page(b, 1440, 1000)
    card = t(pg, "email-move")
    card.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    check("the move card is on Staff Accounts", card.is_visible())
    txt = card.inner_text()
    check("it says only @azoneofficial.com staff move and Gmail is not touched", "Only staff who sign in with @azoneofficial.com" in txt and "Gmail and other addresses are not touched" in txt, txt[:300])
    check("the counts: 6 to move, 1 link sent, 1 moved", re.search(r"6\s*to move", t(pg, "email-move-counts").inner_text()) and re.search(r"1\s*moved", t(pg, "email-move-counts").inner_text()), t(pg, "email-move-counts").inner_text())
    check("no Gmail address is listed in the card", "@gmail" not in txt.lower())
    check("the proposal keeps the name on the new domain", t(pg, "email-move-row-9002").locator("input[aria-label^='New login email']").input_value() == "aina@a2zcreative.my")
    check("a waiting link shows Link sent and its address", "Link sent" in t(pg, "email-move-row-9006").inner_text() and t(pg, "email-move-row-9006").locator("input[aria-label^='New login email']").input_value() == "iman@a2zcreative.my")
    check("an expired link offers Resend", t(pg, "email-move-resend-9007").is_visible())
    check("a Google-only account is flagged", "Google only" in t(pg, "email-move-row-9005").inner_text())
    check("the CEO account cannot be ticked here", t(pg, "email-move-row-9001").locator("input[type=checkbox]").is_disabled())
    check("Review is off until somebody is chosen", t(pg, "email-move-review").is_disabled())
    shot(pg, "em-desktop.png")
    # choose three, one with a different name, one bad
    for i in (9002, 9003, 9005): t(pg, f"email-move-row-{i}").locator("input[type=checkbox]").check()
    t(pg, "email-move-row-9005").locator("input[aria-label^='New login email']").fill("haziq@gmail.com"); pg.wait_for_timeout(200)
    check("a wrong domain is caught on the row and blocks Review", "Must end @a2zcreative.my" in t(pg, "email-move-row-9005").inner_text() and t(pg, "email-move-review").is_disabled())
    t(pg, "email-move-row-9005").locator("input[aria-label^='New login email']").fill("haziq@a2zcreative.my"); pg.wait_for_timeout(200)
    check("a corrected different name is accepted", t(pg, "email-move-review").is_enabled())
    shot(pg, "em-desktop-selected.png")
    t(pg, "email-move-review").click(); pg.wait_for_timeout(800)
    pv = t(pg, "email-move-preview")
    check("the review drawer lists every person, old -> new", pv.is_visible() and "aina@azoneofficial.com → aina@a2zcreative.my" in pv.inner_text() and "haziq.imran@azoneofficial.com → haziq@a2zcreative.my" in pv.inner_text(), pv.inner_text()[:400])
    posts = [r for r in reqs if r[0] == "POST" and "email-move" in r[1]]
    check("the first ask is a dry run", posts and json.loads(posts[-1][2]).get("dry_run") is True)
    check("Send is off until a reason is given", t(pg, "email-move-confirm").is_disabled())
    t(pg, "email-move-reason").fill("Company email moving to a2zcreative.my")
    shot(pg, "em-review.png")
    t(pg, "email-move-confirm").click(); pg.wait_for_timeout(800)
    check("Send asks for the authenticator code", answer(pg, "authenticator", "123456"))
    pg.wait_for_timeout(800)
    check("it reports three links sent", "3 links sent" in t(pg, "email-move-done").inner_text(), t(pg, "email-move").inner_text()[:300])
    check("those rows now show Link sent", all("Link sent" in t(pg, f"email-move-row-{i}").inner_text() for i in (9002, 9003, 9005)))
    last = json.loads([r for r in reqs if r[0] == "POST" and "email-move" in r[1]][-1][2])
    check("the send carries the reason and the code, not dry run", last.get("totp") == "123456" and last.get("reason") and not last.get("dry_run"), last)
    shot(pg, "em-desktop-sent.png")
    check("no script error", not errs, errs)
    ctx.close()

    # the phone
    reset()
    ctx, pg, errs, reqs = page(b, 390, 844)
    t(pg, "email-move").scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    check("phone: the card shows and the page does not scroll sideways", t(pg, "email-move").is_visible() and fits(pg))
    check("phone: the current address sits under the name", t(pg, "email-move-row-9002").locator("text=aina@azoneofficial.com").first.is_visible())
    shot(pg, "em-phone.png")
    t(pg, "email-move-resend-9007").click(); pg.wait_for_timeout(800)
    check("phone: Resend opens the review for that one person", t(pg, "email-move-preview").is_visible() and "kavitha@a2zcreative.my" in t(pg, "email-move-preview").inner_text())
    shot(pg, "em-phone-review.png")
    check("phone: no script error", not errs, errs)
    ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
raise SystemExit(1 if failed else 0)

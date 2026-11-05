"""SECURE AUTHENTICATION 2.0, PHASE R (v1.268.0) - the Executive recovery card, in a browser.

claude/PHASE-R-GOVERNANCE.md revision 2. Profile -> Security:
  - the company owner sees the panel (COO and CCO, who has accepted, when each
    counts), "Panel not ready" until two members are active, and an open request;
    can cancel it with a code;
  - a COO named but not accepted sees Accept, which asks for their own code;
  - an active CCO can ask for a recovery (whose account, reason, in person or
    video, what was checked, optional Google disconnect, code);
  - an editor does not see the card.
Nothing is wider than the screen at 390 / 320 px.

What the worker decides is proven by direct request in tests/go-live-y.mjs.

    ROLE=ceo OWNER=1 node tests/browser/serve.mjs out 4246
    ROLE=coo node tests/browser/serve.mjs out 4248
    ROLE=cco node tests/browser/serve.mjs out 4249
    ROLE=editor node tests/browser/serve.mjs out 4250
    python3 tests/browser/auth-r.py
"""
from playwright.sync_api import sync_playwright
import json

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))
OWNER, COO, CCO, ED = 4246, 4248, 4249, 4250
FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"

def page(b, port, w=1440, h=1000, dark=False):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500, reduced_motion="reduce", color_scheme="dark" if dark else "light")
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Profile"); pg.wait_for_timeout(2800)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    t = pg.get_by_role("tab", name="Security & Account")
    (t if t.count() else pg.get_by_role("button", name="Security & Account")).first.click(); pg.wait_for_timeout(900)
    return ctx, pg, errs, reqs
def card(pg): return pg.locator("section[aria-label='Executive recovery']")
def posts(reqs, part): return [(x[1].split("/api/v1")[-1], json.loads(x[2] or "{}")) for x in reqs if x[0] == "POST" and part in x[1]]

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the owner ----
    ctx, pg, errs, reqs = page(b, OWNER)
    c = card(pg); t = c.inner_text() if c.count() else ""
    check("the owner sees Executive recovery: panel not ready, both members with their state, the open request", c.count() == 1 and "Panel not ready" in t and "Farid Zulkifli" in t and "waiting for them to accept" in t and "Waiting for a second member" in t, t[:500])
    check("...it says what it never changes", "never changes roles, ownership, permissions, payroll or finance" in t)
    c.get_by_role("button", name="Cancel").first.click(); pg.wait_for_timeout(300)
    go = c.get_by_role("button", name="Cancel the request")
    check("cancelling asks for a reason and the code (button off until both)", go.is_disabled())
    c.get_by_label("Reason (kept in the audit history)").fill("This was not agreed"); c.get_by_label("Your authenticator code").fill("123456"); pg.wait_for_timeout(200)
    go.click(); pg.wait_for_timeout(900)
    ps = posts(reqs, "/staff/recovery/requests/7/cancel")
    check("...and sends the reason and the code to the request", ps and ps[-1][1] == {"reason": "This was not agreed", "totp": "123456"}, ps)
    check("no page error (owner)", not errs, errs)
    ctx.close()

    # ---- a COO named, not accepted ----
    ctx, pg, errs, reqs = page(b, COO)
    c = card(pg)
    c.get_by_role("button", name="Accept the panel role").click(); pg.wait_for_timeout(300)
    check("a named COO accepts with their OWN code", "Accept with your own code" in c.inner_text() and c.get_by_role("button", name="Accept").last.is_disabled())
    c.get_by_label("Your authenticator code").fill("123456"); c.get_by_role("button", name="Accept", exact=True).click(); pg.wait_for_timeout(800)
    check("...sent to accept", posts(reqs, "/staff/recovery/panel/accept")[-1][1] == {"totp": "123456"}, posts(reqs, "/staff/recovery/panel/accept"))
    check("...and cannot ask for a recovery yet", c.get_by_role("button", name="Ask for an executive recovery").count() == 0)
    ctx.close()

    # ---- an active CCO asks ----
    ctx, pg, errs, reqs = page(b, CCO)
    c = card(pg)
    c.get_by_role("button", name="Ask for an executive recovery").click(); pg.wait_for_timeout(300)
    ask = c.get_by_role("button", name="Ask for the recovery")
    c.get_by_label("Whose account").select_option(label="Fixture Person (CEO)")
    c.get_by_label("Reason (kept in the audit history)").fill("Lost the phone with the authenticator")
    c.get_by_label("Video call").check()
    check("asking waits for what was checked and the code", ask.is_disabled())
    c.get_by_label("What you checked (ID document seen, by whom)").fill("Video call, MyKad shown to me")
    c.get_by_label("Your authenticator code").fill("123456"); pg.wait_for_timeout(200)
    ask.click(); pg.wait_for_timeout(900)
    ps = posts(reqs, "/staff/recovery/requests")
    check("...sends whose account, the reason, how and what was checked, no Google disconnect unless ticked, and the code", ps and ps[-1][1] == {"target_id": 9001, "reason": "Lost the phone with the authenticator", "identity_checked": "Video call, MyKad shown to me", "identity_method": "video_call", "unlink_google": False, "totp": "123456"}, ps)
    check("no page error (CCO)", not errs, errs)
    ctx.close()

    # ---- an editor ----
    ctx, pg, errs, reqs = page(b, ED)
    check("an editor does not see the card", card(pg).count() == 0)
    ctx.close()

    # ---- phones, both themes ----
    for port, w, dark in [(OWNER, 390, False), (CCO, 320, True), (COO, 390, True)]:
        ctx, pg, errs, reqs = page(b, port, w, 844, dark)
        check(f"{w}px {'dark' if dark else 'light'}: no sideways page", pg.evaluate(FITS), pg.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]"))
        if card(pg).count(): card(pg).screenshot(path=f"/tmp/authr-{w}-{port}.png")
        check(f"{w}px: no page error", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nauth-r: {len(results) - len(failed)} of {len(results)} passed")
raise SystemExit(1 if failed else 0)

"""v1.255.0 - agent partnership commission, on screen.

The agent's "My Commission" (their rate and their own sales only), Commission >
Agent deals for management (the review queue, payouts with dual control,
disputes, the switch), the policy's agent rates, and the standing assignment
on the Agents list. Desktop and phone; nothing wider than the screen, inside
or outside a drawer.

Servers (servers.txt): ROLE=agent on 4222, ROLE=agent AGENT_EMPTY=1 on 4223,
ROLE=ceo on 4177, ROLE=super_admin on 4183, ROLE=cco on 4185,
ROLE=sales_marketing on 4182. The fixture stands in for the worker; who may
see what is proven by direct request in tests/go-live-n.mjs."""
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def page(b, port, w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal"); pg.wait_for_timeout(2500)
    return ctx, pg, errs

def tab(pg, name):
    btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count() == 0:
        m = pg.get_by_role("button", name="More").filter(visible=True)
        if m.count(): m.first.click(); pg.wait_for_timeout(500)
        btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count(): btn.first.click(); pg.wait_for_timeout(1800); return True
    return False

def sub(pg, name):
    t = pg.get_by_role("tab", name=name, exact=True).filter(visible=True)
    if t.count(): t.first.click(); pg.wait_for_timeout(1200); return True
    return False

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the agent: their own rate and sales ----
    for w in (1440, 390):
        ctx, pg, errs = page(b, 4222, w=w, h=900)
        ok = sub(pg, "My Commission")
        mc = pg.get_by_test_id("agent-commission")
        text = mc.inner_text() if mc.count() else ""
        check(f"{w}px: the agent has a My Commission view", ok and mc.count() == 1, text[:120])
        check(f"{w}px: it says 'Your commission rate: 7%'", "Your commission rate: 7%" in pg.get_by_test_id("agent-rate").inner_text())
        check(f"{w}px: estimated, eligible, payout authorised and paid - their own amounts", all(k in text for k in ["Estimated", "Eligible", "Payout authorised", "Paid", "RM 70.00"]), text[:300])
        check(f"{w}px: a held sale shows Under review with no amount", "Under review" in text and "The amount shows once A2Z completes its review" in text)
        check(f"{w}px: a paid sale shows the bank date and reference", "MBB-77821" in text and "02-11-2026" in text)
        check(f"{w}px: never the closer's 3%, the direct 10% or a split", "3%" not in text and "10%" not in text and "closer" not in text.lower(), text[:300])
        check(f"{w}px: no Submit Client Request on the commission view", pg.get_by_test_id("submit-client-request").filter(visible=True).count() == 0)
        check(f"{w}px: nothing wider than the screen", pg.evaluate(FITS))
        check(f"{w}px: no script errors", not errs, errs)
        ctx.close()
    ctx, pg, errs = page(b, 4223)
    sub(pg, "My Commission")
    check("an agent with nothing yet sees the empty state", "No commission yet" in pg.get_by_test_id("agent-commission").inner_text())
    ctx.close()

    # ---- the CEO: Agent deals ----
    for w in (1440, 390):
        ctx, pg, errs = page(b, 4177, w=w, h=900)
        tab(pg, "Commission")
        check(f"{w}px: management has an Agent deals view in Commission", sub(pg, "Agent deals"))
        q = pg.get_by_test_id("attribution-queue")
        qt = q.inner_text() if q.count() else ""
        check(f"{w}px: the held sale shows with its reasons and evidence", "INV-A2Z031126-9" in qt and "The agent request is not Won" in qt and "No client acceptance on the published revision" in qt and "AGR-0012" in qt, qt[:300])
        check(f"{w}px: the decision needs a choice and a reason", pg.get_by_role("button", name="Record decision").first.is_disabled())
        pg.get_by_label("Decision for INV-A2Z031126-9").select_option("partnership"); pg.wait_for_timeout(300)
        check(f"{w}px: a partnership is decided on a version with agent rates (7% + 3%)", "v2 · agent 7% + closer 3%" in pg.get_by_label("Policy version").inner_text())
        check(f"{w}px: a payment before v2 started asks to confirm a retrospective allocation", pg.get_by_text("I confirm this retrospective allocation", exact=False).count() == 1)
        po = pg.get_by_test_id("payout-7")
        check(f"{w}px: dual control - the authoriser is told another approver confirms the settlement", po.count() == 1 and "Dual control" in po.inner_text() and po.get_by_role("button", name="Confirm settlement").count() == 0)
        check(f"{w}px: an agent's eligible total can be authorised", pg.get_by_role("button", name="Authorise payout").count() == 1)
        check(f"{w}px: the payout history shows the bank reference", "MBB-77821" in pg.locator("body").inner_text())
        check(f"{w}px: an open dispute is listed and can be cleared", "Syarikat Dipertikai" in pg.locator("body").inner_text() and pg.get_by_role("button", name="Clear", exact=True).count() >= 1)
        check(f"{w}px: nothing wider than the screen", pg.evaluate(FITS))
        check(f"{w}px: no script errors", not errs, errs)
        ctx.close()

    # ---- the super admin settles a payout the CEO authorised ----
    ctx, pg, errs = page(b, 4183)
    tab(pg, "Commission"); sub(pg, "Agent deals")
    po = pg.get_by_test_id("payout-7")
    btn = po.get_by_role("button", name="Confirm settlement")
    check("a second approver sees Confirm settlement, off until the bank reference is entered", btn.count() == 1 and btn.is_disabled())
    po.get_by_label("Bank reference").fill("MBB-12345")
    check("...and on once it is", btn.is_enabled())
    ctx.close()

    # ---- the CCO reads only ----
    ctx, pg, errs = page(b, 4185)
    tab(pg, "Commission"); sub(pg, "Agent deals")
    check("the CCO reads the queue but cannot decide, authorise or settle",
          "INV-A2Z031126-9" in pg.locator("body").inner_text() and pg.get_by_role("button", name="Record decision").count() == 0 and pg.get_by_role("button", name="Authorise payout").count() == 0 and pg.get_by_role("button", name="Confirm settlement").count() == 0)
    ctx.close()

    # ---- a salesperson: no Agent deals ----
    ctx, pg, errs = page(b, 4182)
    tab(pg, "Commission")
    check("a salesperson has no Agent deals view", pg.get_by_role("tab", name="Agent deals", exact=True).count() == 0)
    ctx.close()

    # ---- the policy's agent rates, the standing assignment ----
    ctx, pg, errs = page(b, 4177)
    tab(pg, "Commission"); sub(pg, "Policy Settings")
    d = pg.get_by_role("button", name="Draft a new version")
    if d.count():
        d.first.click(); pg.wait_for_timeout(500)
        box = pg.get_by_test_id("agent-rates")
        check("a draft offers the agent partnership rates", box.count() == 1 and "Agent partnership deals" in box.inner_text())
        box.get_by_role("checkbox").check(); pg.wait_for_timeout(200)
        check("...7% and 3% by default, summed against the direct rate", pg.get_by_label("Agent rate percent").input_value() == "7" and pg.get_by_label("Closer rate percent").input_value() == "3" and "Agent deals: agent 7% + closer 3% = 10%" in box.inner_text(), box.inner_text()[:200])
    else:
        check("a draft offers the agent partnership rates", False, "no Draft button")
    ctx.close()
    ctx, pg, errs = page(b, 4177)
    tab(pg, "Agents"); sub(pg, "Agents")
    a = pg.get_by_test_id("agent-assigned-9005")
    check("each agent shows their standing salesperson", a.count() == 1 and "Fixture Person" in a.inner_text(), a.inner_text() if a.count() else "")
    a.get_by_role("button", name="Change").click(); pg.wait_for_timeout(300)
    save = pg.get_by_role("button", name="Save", exact=True)
    check("changing it needs the salesperson and a reason", save.count() == 1 and save.is_disabled())
    check("nothing wider than the screen", pg.evaluate(FITS))
    ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"agent-commission: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

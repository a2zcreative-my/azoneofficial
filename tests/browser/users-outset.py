"""v1.253.0 - Users > Staff Accounts and Customers & Agents, the subtle
outset refinement (the owner, 02-11-2026; claude/USERS-OUTSET-AUDIT.md,
D1 Grant Agent Access beside Access, D2 cards below 1024px, D3 one page
scroll with 25 then Show more).

Measured, not looked at: at every width the page never scrolls sideways,
no account list scrolls inside the page, every button and chip stays on
screen, no action spills past its row. On a desk the rows are one line,
the Manage icons sit side by side, and the column heads line up with the
cells. Below 1024px each account is a card whose name and email keep the
first line. Server 4191 ROLE=ceo OWNER=1 (the owner sees Grant Agent
Access). Invented people only."""
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

MEASURE = r"""() => {
  const vw = document.documentElement.clientWidth;
  const view = [...document.querySelectorAll('div[hidden]')].length >= 0 ? [...document.querySelectorAll('[class*=users-panel_body]')].find(d => !d.hidden) : null;
  const root = view || document.body;
  const nested = [...root.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1; }).length;
  const outside = [...root.querySelectorAll('button, a, [class*=chip]')].filter(e => e.offsetParent !== null).filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).length;
  const rows = [...root.querySelectorAll('li[class*=users-panel_row]')].filter(li => li.offsetParent !== null);
  const spill = Math.max(0, ...rows.map(r => { const rr = r.getBoundingClientRect(); return Math.max(0, ...[...r.querySelectorAll('button, [class*=chip]')].map(b => b.getBoundingClientRect().right - rr.right)); }));
  const actLines = rows.map(r => { const a = r.querySelector('[class*=users-panel_act]'); return a ? new Set([...a.children].map(c => Math.round(c.getBoundingClientRect().top))).size : 1; });
  const heights = rows.map(r => Math.round(r.getBoundingClientRect().height));
  const head = root.querySelector('[class*=users-panel_header]');
  let dx = [];
  if (head && head.offsetParent !== null && rows[0]) {
    const hs = [...head.children].map(c => c.getBoundingClientRect());
    const cells = [rows[0].querySelector('[class*=users-panel_identity]'), ...rows[0].querySelectorAll('[class*=users-panel_cell]')].map(c => Math.round(c.getBoundingClientRect().left));
    dx = cells.map((c, i) => Math.abs(c - Math.round(hs[i].left)));
    const act = rows[0].querySelector('[class*=users-panel_act]');
    if (act) dx.push(Math.abs(Math.round(act.getBoundingClientRect().right) - Math.round(hs[hs.length - 1].right)));
  }
  const nameCut = rows.map(r => { const n = r.querySelector('[class*=users-panel_email]'); return n ? n.scrollWidth - n.clientWidth : 0; });
  return { overflow: document.documentElement.scrollWidth - vw, nested, outside, spill: Math.round(spill), actLines: Math.max(1, ...actLines), hmax: Math.max(...heights), dx, emailCut: Math.max(0, ...nameCut), rows: rows.length };
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(1440, 900, "desktop"), (1024, 768, "tablet 1024"), (768, 1024, "tablet 768"), (430, 932, "430"), (390, 844, "390"), (375, 812, "375"), (320, 640, "320")]:
        ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://127.0.0.1:4191/portal?tab=Users"); pg.wait_for_timeout(2600)
        for name in ["Staff Accounts", "Customers & Agents"]:
            pg.get_by_role("tab", name=name, exact=True).first.click(); pg.wait_for_timeout(1000)
            m = pg.evaluate(MEASURE)
            k = f"{tag} {name}"
            check(f"{k}: no sideways page, nothing off screen, nothing past its row", m["overflow"] <= 0 and m["outside"] == 0 and m["spill"] <= 0, m)
            check(f"{k}: one scroll - no list scrolls inside the page", m["nested"] == 0, m)
            check(f"{k}: the Manage icons sit side by side", m["actLines"] == 1, m)
            if w >= 1024:
                check(f"{k}: rows stay one compact line (under 90px) and the column heads line up within 2px", m["hmax"] < 90 and all(d <= 2 for d in m["dx"]) and len(m["dx"]) >= 4, m)
            else:
                check(f"{k}: an account is a card whose email is never cut (the first line is the identity's)", m["emailCut"] <= 0 and m["dx"] == [] and m["hmax"] <= 160, m)
            if name == "Customers & Agents":
                g = pg.locator("[data-testid^='grant-agent-']").filter(visible=True).first
                acc = g.locator("xpath=..")
                check(f"{k}: Grant Agent Access sits beside No staff access, not in Manage", g.count() == 1 and "No staff access" in acc.inner_text() and pg.locator("[class*=users-panel_act] [data-testid^='grant-agent-']").count() == 0)
        check(f"{tag}: no page errors", not errs, errs)
        ctx.close()

    # the card lift and the Show more pattern come from the source of truth
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    pg.goto("http://127.0.0.1:4191/portal?tab=Users"); pg.wait_for_timeout(2600)
    pg.get_by_role("tab", name="Staff Accounts", exact=True).first.click(); pg.wait_for_timeout(800)
    sh = pg.evaluate("() => { const s = [...document.querySelectorAll('section[class*=users-panel_outset]')].find(e => e.offsetParent !== null); return s ? getComputedStyle(s).boxShadow : ''; }")
    check("the account card is lifted with the existing raised elevation", sh not in ("", "none"), sh)
    check("five accounts need no Show more", pg.get_by_role("button", name="Show more").count() == 0)
    ctx.close()

    # a long list: 32 invented staff and 28 invented customers, served in
    # place of the fixture's few - 25 show, then Show more, still one scroll
    import json as _j
    def long_list(route):
        r = route.fetch(); d = r.json(); base = d.get("users") or d.get("staff") or []
        extra = [{"id": 70000 + i, "name": f"Test Person {i}", "full_name": f"Test Person {i}", "email": f"person{i}@example.test", "role": "sales_marketing", "is_active": 1, "totp_enabled": 1, "employment_status": "permanent"} for i in range(32)]
        extra += [{"id": 80000 + i, "name": f"Test Customer {i}", "full_name": f"Test Customer {i}", "email": f"cust{i}@example.test", "role": "customer", "is_active": 1, "totp_enabled": 0} for i in range(28)]
        route.fulfill(response=r, body=_j.dumps({**d, "users": base + extra}), headers={**r.headers, "content-type": "application/json"})
    for w in [1440, 390]:
        ctx = b.new_context(viewport={"width": w, "height": 900}, is_mobile=w < 500, has_touch=w < 500); pg = ctx.new_page()
        pg.route("**/staff/users", long_list)
        pg.goto("http://127.0.0.1:4191/portal?tab=Users"); pg.wait_for_timeout(2800)
        pg.get_by_role("tab", name="Staff Accounts", exact=True).first.click(); pg.wait_for_timeout(800)
        vis = lambda: pg.locator("li[class*=users-panel_row]").filter(visible=True).count()
        n0 = vis(); more = pg.get_by_role("button", name="Show more").filter(visible=True)
        label = more.first.inner_text() if more.count() else ""
        check(f"{w}px long staff list: 25 rows, then Show more with the rest counted", n0 == 25 and "(12)" in label, [n0, label])
        more.first.click(); pg.wait_for_timeout(600)
        check(f"{w}px ...Show more brings the other 12 and goes away", vis() == 37 and pg.get_by_role("button", name="Show more").filter(visible=True).count() == 0, vis())
        check(f"{w}px ...still one scroll and no sideways page", pg.evaluate(MEASURE)["nested"] == 0 and pg.evaluate(MEASURE)["overflow"] <= 0)
        pg.get_by_role("tab", name="Customers & Agents", exact=True).first.click(); pg.wait_for_timeout(800)
        check(f"{w}px long customer list: 25, then Show more (7)", vis() == 25 and "(7)" in pg.get_by_role("button", name="Show more").filter(visible=True).first.inner_text())
        pg.get_by_placeholder("Find by name, email or role").filter(visible=True).first.fill("Test Customer 2"); pg.wait_for_timeout(500)
        check(f"{w}px ...a search narrows it and starts again", vis() == 9, vis())  # 2 and 20-27
        ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"users-outset: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

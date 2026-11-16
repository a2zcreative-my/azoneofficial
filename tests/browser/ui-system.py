"""THE GLOBAL UI SYSTEM (v1.323.0, the CEO's Global UI System brief, D-1..D-7
approved 16-11-2026; claude/UI-SYSTEM-STAGE-0-AUDIT.md) - in a browser.

  every tab, every view   each KPI strip on screen is ONE card: connected
  (1440 x 900)            segments with no gap, none of them a card of its own,
                          as many segments as it says (data-cells), inside the
                          page; no sideways page; no page error
  every tab (390 x 844)   the same strips two a row (an odd last one across),
                          nothing past the screen's edge
  dark (D-7)              the strip reads on the dark ground: its card is not
                          the page's colour, its text is not its background
  the pilot (D-4)         the Desk's Action Inbox and the Tasks Overview (queue
                          and panel) fill the screen at 1440 x 900 with the
                          pager on it and no sideways scroll, and do nothing on
                          a phone (the page scrolls)

Invented fixtures (tests/browser/fixture.mjs, serve.mjs). Servers: 4177 ceo
(and 4280 / 4300 / 4310 for the tabs that need their own fixture).
"""
from playwright.sync_api import sync_playwright
import re, urllib.request, urllib.parse

TABS = ["Dashboard", "Desk", "Announcements", "Sales", "Ecommerce", "Agents", "Financial Advisory", "Tasks", "Inventory", "Assets", "Hotels", "HR",
        "Staff Details", "Attendance", "On Shift", "Leave", "Claims", "Payroll", "Finance", "Accounting", "Commission", "ELFIA Store", "ELFIA Traffic",
        "Companies", "Users", "Automation & Rules", "Cards", "Profile"]
PORT = {"Financial Advisory": 4280, "Staff Details": 4300, "Leave": 4310}
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:400]}]"), flush=True)

STRIPS = r"""() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'); };
  return [...document.querySelectorAll('[data-kpi-strip]')].filter(vis).map((row) => {
    const cs = getComputedStyle(row), r = row.getBoundingClientRect();
    const kids = [...row.children].filter(vis);
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
    const rad = (e) => parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0;
    const tops = [...new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top)))];
    const last = kids[kids.length - 1];
    return {
      id: row.dataset.testid || row.getAttribute('aria-label') || '?',
      cells: +row.dataset.cells, kids: kids.length, cols,
      gap: [cs.columnGap, cs.rowGap].every((g) => g === 'normal' || parseFloat(g) === 0),
      radius: rad(row), shadow: cs.boxShadow !== 'none', bg: cs.backgroundColor,
      kidCards: kids.filter((k) => k.classList.contains('erp-card') || rad(k) > 0).length,
      right: r.right, width: r.width,
      lastAcross: kids.length > 1 && kids.length % 2 === 1 ? last.getBoundingClientRect().width >= r.width - 4 : true,
      textOk: kids.every((k) => { const c = getComputedStyle(k); return c.color !== c.backgroundColor; }),
      rows: tops.length,
    };
  });
}"""
PAGE = """() => ({ wide: document.scrollingElement.scrollWidth > window.innerWidth + 1, ground: getComputedStyle(document.body).backgroundColor })"""

def open_tab(b, tab, w, h, phone, theme="light"):
    port = PORT.get(tab, 4177)
    try: urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    except Exception: pass
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    if theme == "dark": ctx.add_init_script("try { localStorage.setItem('azone-theme', 'dark') } catch (e) {}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab={urllib.parse.quote(tab)}"); pg.wait_for_timeout(3000)
    pg.add_style_tag(content="[data-testid=update-available]{display:none!important}")
    return ctx, pg, errs

def judge(tag, strips, w, phone):
    bad = []
    for s in strips:
        why = []
        if s["cells"] != s["kids"]: why.append(f"says {s['cells']} cells, draws {s['kids']}")
        if not s["gap"]: why.append("a gap between segments")
        if s["radius"] < 16: why.append(f"radius {s['radius']}")
        if not s["shadow"]: why.append("no card shadow")
        if s["kidCards"]: why.append(f"{s['kidCards']} segment(s) drawn as cards")
        if s["right"] > w + 1: why.append("past the screen")
        if not s["textOk"]: why.append("text the colour of its ground")
        if phone and s["kids"] > 1 and s["cols"] != 2: why.append(f"{s['cols']} columns on a phone")
        if phone and not s["lastAcross"]: why.append("an odd last one stranded at half width")
        if not phone and s["kids"] <= 6 and w >= 1280 and s["rows"] != 1: why.append(f"{s['rows']} rows at {w}px")
        if why: bad.append(f"{s['id']}: " + "; ".join(why))
    return bad

with sync_playwright() as p:
    b = p.chromium.launch()
    seen = 0
    # ================= the desk: every view of every tab =================
    for tab in TABS:
        ctx, pg, errs = open_tab(b, tab, 1440, 900, False)
        tl = pg.locator("main [role=tablist]").first
        names = [re.sub(r"\s*\d+$", "", t.split("\n")[0]).strip() for t in tl.locator("[role=tab]").all_inner_texts()][:9] if tl.count() else []
        views = names or ["(single)"]
        bad, wide = [], []
        for n in views:
            if n != "(single)":
                t = tl.locator("[role=tab]").filter(has_text=n).first
                try:
                    if t.is_visible(): t.click(timeout=4000)
                except Exception: continue
                pg.wait_for_timeout(1200)
            strips = pg.evaluate(STRIPS); seen += len(strips)
            bad += [f"{n} / {x}" for x in judge(tab, strips, 1440, False)]
            if pg.evaluate(PAGE)["wide"]: wide.append(n)
        check(f"1440 {tab}: every KPI strip is one connected card ({len(views)} view(s))", not bad, bad)
        check(f"1440 {tab}: no sideways page", not wide, wide)
        check(f"1440 {tab}: no page error", not errs, errs)
        ctx.close()
    check(f"the sweep saw strips (not an empty fixture): {seen}", seen >= 40, seen)

    # ================= the phone: the first view of every tab =================
    seen = 0
    for tab in TABS:
        ctx, pg, errs = open_tab(b, tab, 390, 844, True)
        strips = pg.evaluate(STRIPS); seen += len(strips)
        bad = judge(tab, strips, 390, True)
        check(f"390 {tab}: strips two a row, inside the screen", not bad, bad)
        check(f"390 {tab}: no sideways page", not pg.evaluate(PAGE)["wide"])
        check(f"390 {tab}: no page error", not errs, errs)
        ctx.close()
    check(f"the phone sweep saw strips: {seen}", seen >= 15, seen)

    # ================= dark (D-7) =================
    for tab in ["Dashboard", "Desk", "Tasks", "Payroll", "Sales"]:
        for w, phone in [(1440, False), (390, True)]:
            ctx, pg, errs = open_tab(b, tab, w, 844 if phone else 900, phone, "dark")
            dark = pg.evaluate("document.documentElement.classList.contains('dark')")
            strips = pg.evaluate(STRIPS); ground = pg.evaluate(PAGE)["ground"]
            bad = judge(tab, strips, w, phone) + [f"{s['id']}: the card is the page's colour" for s in strips if s["bg"] == ground]
            # the phone Dashboard opens on the week's target (v1.240.0): no strip in its first screen
            check(f"dark {w} {tab}: the dark theme is on and its strips read", dark and (strips or (phone and tab == "Dashboard")) and not bad, [dark, len(strips), bad])
            check(f"dark {w} {tab}: no page error", not errs, errs)
            ctx.close()

    # ================= the pilot: the Desk's inbox fills the panel =================
    ctx, pg, errs = open_tab(b, "Desk", 1440, 900, False)
    pg.goto("http://127.0.0.1:4177/portal?tab=Desk&view=inbox"); pg.wait_for_timeout(2600)
    pg.add_style_tag(content="[data-testid=update-available]{display:none!important}")
    fp = pg.get_by_test_id("inbox-panel")
    info = pg.evaluate("""() => { const p = document.querySelector('[data-testid=inbox-panel]'); const r = p.getBoundingClientRect();
      const pager = document.querySelector('[data-testid=action-inbox] nav'); return { fill: p.dataset.fill, bottom: r.bottom, h: window.innerHeight,
      scrolls: p.scrollHeight > p.clientHeight + 1, pager: pager ? pager.getBoundingClientRect().bottom : null, rows: p.querySelectorAll('[data-testid=inbox-row]').length }; }""")
    check("Desk 1440: the inbox fills the panel and scrolls inside it", fp.count() == 1 and info["fill"] == "on" and info["bottom"] <= info["h"], info)
    check("Desk 1440: the pager (when there are pages) stays on the screen", info["pager"] is None or info["pager"] <= info["h"] + 1, info)
    head = pg.evaluate("() => { const p = document.querySelector('[data-testid=inbox-panel]'); p.scrollTop = 200; const t = p.querySelector('[role=row]'); return Math.round(t.getBoundingClientRect().top - p.getBoundingClientRect().top); }")
    check("Desk 1440: the column names stay in view while the rows scroll", head <= 1, head)
    pills = pg.get_by_test_id("inbox")
    check("Desk: the inbox filters are the one view switch, with counts", pills.get_attribute("role") == "group" and pg.get_by_test_id("inbox-all").get_attribute("aria-pressed") == "true" and re.search(r"\d+$", pg.get_by_test_id("inbox-all").inner_text().strip()))
    pg.screenshot(path="/home/claude/out/ui323/desk-inbox-desk.png")
    ctx.close()
    check("no page error (Desk inbox 1440)", not errs, errs)
    # the Tasks Overview: the queue and the panel beside it each fill, side by side
    ctx, pg, errs = open_tab(b, "Tasks", 1440, 900, False)
    t = pg.evaluate("""() => { const q = document.querySelector('[data-testid=overview-fill]'), r = document.querySelector('[data-testid=overview-panel-body]');
      const tw = document.querySelector('[data-testid=overview-table]').parentElement; const sc = document.querySelector('[class*=app-shell_scroll]');
      const pager = document.querySelector('[data-testid=overview-pages]');
      return { q: q.dataset.fill, r: r.dataset.fill, qb: q.getBoundingClientRect().bottom, rb: r.getBoundingClientRect().bottom, h: innerHeight,
        sideways: tw.scrollWidth - tw.clientWidth, frame: sc.scrollHeight - sc.clientHeight, pager: pager.getBoundingClientRect().bottom }; }""")
    check("Tasks 1440: the queue and its panel fill the screen side by side; the frame does not scroll", t["q"] == "on" and t["r"] == "on" and t["qb"] <= t["h"] and t["rb"] <= t["h"] and t["frame"] <= 1, t)
    check("Tasks 1440: the queue's pager on the screen, every column in view (no sideways scroll)", t["pager"] <= t["h"] and t["sideways"] <= 1, t)
    pg.screenshot(path="/home/claude/out/ui323/tasks-overview-desk.png")
    ctx.close()
    check("no page error (Tasks 1440)", not errs, errs)
    ctx, pg, errs = open_tab(b, "Tasks", 390, 844, True)
    check("Tasks 390: nothing scrolls inside the page - the page does", pg.get_by_test_id("overview-fill").get_attribute("data-fill") == "off" and pg.get_by_test_id("overview-panel-body").get_attribute("data-fill") == "off")
    ctx.close()
    # ================= v1.324.0: the Dashboard fits; Phase D group 1 (Sales, Payroll, Finance) =================
    ctx, pg, errs = open_tab(b, "Dashboard", 1440, 900, False)
    fr = pg.evaluate("() => { const s = document.querySelector('[class*=app-shell_scroll]'); return [s.scrollHeight, s.clientHeight, !!document.querySelector('[data-testid=alert-band]')]; }")
    check("Dashboard 1440 x 900: the Overview fits the screen, with the alert band showing (the CEO: tighten the space)", fr[2] and fr[0] <= fr[1] + 1, fr)
    ctx.close()
    # Payroll's views are chosen on the page (its address names only the tab), so the tab row is pressed
    def to_view(pg, tab, view, label, phone):
        pg.goto(f"http://127.0.0.1:4177/portal?tab={tab}&view={view}"); pg.wait_for_timeout(2800)
        pg.add_style_tag(content="[data-testid=update-available]{display:none!important}"); pg.wait_for_timeout(300)
        if not label:
            return
        t = pg.locator("main [role=tablist]").first.get_by_role("tab", name=re.compile("^" + re.escape(label))).first
        if t.count() and t.is_visible():
            t.click(); pg.wait_for_timeout(1200)
        else:
            pg.get_by_test_id("view-switch").first.click(); pg.wait_for_timeout(300)
            pg.get_by_role("menuitemradio", name=re.compile(label)).click(); pg.wait_for_timeout(1200)
    FILL = [("Sales", "documents", None, "docs-fill"), ("Payroll", "process", "Payroll Processing", "payroll-fill"), ("Finance", "transactions", None, "tx-fill")]
    for tab, view, label, tid in FILL:
        for w, h, phone in [(1440, 900, False), (390, 844, True)]:
            ctx, pg, errs = open_tab(b, tab, w, h, phone)
            to_view(pg, tab, view, label, phone)
            el = pg.get_by_test_id(tid)
            st = el.get_attribute("data-fill") if el.count() else None
            if phone:
                check(f"{tab} 390: the list does not scroll inside the page - the page does", st in (None, "off"), st)
            else:
                info = pg.evaluate(f"() => {{ const p = document.querySelector('[data-testid={tid}]'); const r = p.getBoundingClientRect(); return {{ fill: p.dataset.fill, bottom: r.bottom, h: innerHeight, inner: p.scrollHeight > p.clientHeight + 1 }}; }}")
                # a short list simply fits (the panel stays off); a long one fills and scrolls inside - either way its end is on the screen
                check(f"{tab} 1440: the main list ends on the screen (it fills and scrolls inside, or it fits)", info["bottom"] > 0 and info["bottom"] <= info["h"] and (info["fill"] == "on" or not info["inner"]), info)
            check(f"{tab} {w}: no sideways page, no page error", not pg.evaluate("document.scrollingElement.scrollWidth > innerWidth + 1") and not errs, errs)
            ctx.close()
    # the inline forms open in the drawer (and close back to the page)
    ctx, pg, errs = open_tab(b, "Finance", 1440, 900, False)
    pg.goto("http://127.0.0.1:4177/portal?tab=Finance&view=expenses"); pg.wait_for_timeout(2800)
    pg.add_style_tag(content="[data-testid=update-available]{display:none!important}")
    shut = pg.get_by_test_id("expense-description").count() == 0
    pg.get_by_test_id("expense-open").click(); pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog")
    check("Finance: Add Expense is a button; its form opens in the drawer with the same fields", shut and dlg.count() == 1 and dlg.get_by_test_id("expense-description").count() == 1 and dlg.get_by_test_id("expense-record").count() == 1)
    dlg.get_by_test_id("expense-description").fill("Printer paper"); pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    check("…typing then Escape asks before throwing the words away", pg.get_by_test_id("drawer-discard").count() == 1 and pg.get_by_test_id("expense-description").count() == 1)
    ctx.close()
    ctx, pg, errs = open_tab(b, "Payroll", 1440, 900, False)
    to_view(pg, "Payroll", "settings", "Settings & Audit", False)
    lst = pg.get_by_test_id("payroll-base")
    check("Payroll: the base salaries read as a list, no field on the page", lst.count() == 1 and lst.locator("input").count() == 0 and "RM" in lst.inner_text())
    pg.get_by_test_id("payroll-base-edit").click(); pg.wait_for_timeout(500)
    check("…Edit base salaries opens the same fields and Save in the drawer", pg.get_by_role("dialog").locator("input[type=number]").count() >= 1 and pg.get_by_role("dialog").get_by_role("button", name="Save base salaries").count() == 1)
    ctx.close()
    ctx, pg, errs = open_tab(b, "Sales", 1440, 900, False)
    pg.goto("http://127.0.0.1:4177/portal?tab=Sales&view=documents"); pg.wait_for_timeout(2800)
    pg.add_style_tag(content="[data-testid=update-available]{display:none!important}")
    qa = pg.get_by_test_id("qa-limit")
    if qa.count():
        shut = qa.locator("input").count() == 0
        pg.get_by_test_id("qa-limit-open").click(); pg.wait_for_timeout(500)
        check("Sales: the quotation approval limit reads as one line; its field opens in the drawer", shut and pg.get_by_role("dialog").locator("input").count() == 1)
    else:
        check("Sales: the quotation approval line is shown to the CEO", False, "no qa-limit")
    tabs = [t.strip() for t in pg.get_by_role("tablist", name="Documents").get_by_role("tab").all_inner_texts()]
    check("Sales: the Documents row is the one tab row (All, Quotations, Invoices) with More at its end", len(tabs) == 3 and tabs[0].startswith("All Documents") and pg.get_by_test_id("docs-more").count() == 1, tabs)
    ctx.close()
    ctx, pg, errs = open_tab(b, "Desk", 390, 844, True)
    pg.goto("http://127.0.0.1:4177/portal?tab=Desk&view=inbox"); pg.wait_for_timeout(2600)
    check("Desk 390: the inbox does not scroll inside itself - the page does", pg.get_by_test_id("inbox-panel").get_attribute("data-fill") == "off")
    tops = pg.evaluate("() => [...new Set([...document.querySelectorAll('[data-testid=inbox] button')].map(b => Math.round(b.getBoundingClientRect().top)))].length")
    check("Desk 390: the filters are one row that slides sideways, not a block", tops == 1 and not pg.evaluate("document.scrollingElement.scrollWidth > innerWidth + 1"), tops)
    ctx.close()
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

"""FINANCE WORKSPACE 5.0 (v1.312.0) - in a browser (the CEO's "approve as per
recommend", 15-11-2026; claude/FINANCE-WORKSPACE-5.0-BLUEPRINT.md). The source
and server rules are held by tests/finance5.mjs; here, the screens: the five
views and their addresses, Back/Forward, the company selector, Recent
Transactions (three rows), the reconciliation difference (-RM 5.00, not
RM 13,161.66), reviewed shown as still open, the expense steps per role, the
phone's view switch with its folded filters and form, and the eight widths
with no sideways page. The fixture answers are invented
(tests/browser/fixture.mjs); no production figure is used.

Servers (from servers.txt):
    4177 ceo · 4179 coo · 4183 super_admin · 4186 admin
"""
from playwright.sync_api import sync_playwright
import re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, COO, SUPER, ADMIN = 4177, 4179, 4183, 4186
VIEWS = ["overview", "transactions", "expenses", "reconciliation", "reports"]
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def open_page(b, port, w=1440, h=900, view=None):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Finance" + (f"&view={view}" if view else "")); pg.wait_for_timeout(3200)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def vis(pg, tid):
    loc = pg.locator(f'[data-testid="{tid}"]:visible')
    return loc.count() > 0

def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None

def due_buttons(pg):
    items = pg.locator('[data-testid="expense-due"] [data-testid="due-item"]')
    out = {}
    for i in range(items.count()):
        it = items.nth(i)
        title = it.locator("strong").first.inner_text().strip()
        out[title] = sorted(t for t in ["exp-approve", "exp-authorise", "exp-pay"] if it.get_by_test_id(t).count())
    return out

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- CEO, desktop: the five views and the address ----------------
    ctx, pg, errs = open_page(b, CEO)
    tabs = [t.strip() for t in pg.get_by_role("tab").filter(visible=True).all_inner_texts()]
    check("exactly five tabs: Overview, Transactions, Expenses, Reconciliation, Reports", tabs == ["Overview", "Transactions", "Expenses", "Reconciliation", "Reports"], tabs)
    check("arriving writes view=overview to the address", view_of(pg) == "overview", pg.url)
    check("Overview: the four cash tiles, no Financial health card (CEO-9)", vis(pg, "finance-overview") and not vis(pg, "finance-health")
          and all(w in pg.get_by_test_id("finance-overview").inner_text() for w in ["Money In", "Money Out", "Net Cash Movement", "Needs Attention"]), pg.get_by_test_id("finance-overview").inner_text()[:300])
    check("Overview: trend, out by category, account balances, recent and attention", all(vis(pg, t) for t in ["finance-trend", "finance-out-by-category", "finance-accounts", "finance-recent", "finance-attention"]))
    check("Recent Transactions shows three rows", pg.locator('[data-testid="recent-row"]:visible').count() == 3, pg.locator('[data-testid="recent-row"]:visible').count())
    ov = pg.get_by_test_id("finance-overview").inner_text()
    check("Money In counts verified receipts only (INV:2 and PART:1 awaiting are not in it)", "awaiting" in ov.lower() or "Awaiting" in ov, ov[:400])
    check("the company selector starts at A2Z, one company at a time", pg.locator('[data-testid="finance-company"]:visible').first.input_value() == "a2z")
    for k in VIEWS[1:]:
        pg.get_by_role("tab", name=re.compile("^" + k.capitalize())).click(); pg.wait_for_timeout(900)
        check(f"the {k} tab writes view={k}", view_of(pg) == k, pg.url)
    pg.go_back(); pg.wait_for_timeout(900)
    check("Back returns to Reconciliation", view_of(pg) == "reconciliation" and vis(pg, "finance-recon"), pg.url)
    pg.go_forward(); pg.wait_for_timeout(900)
    check("Forward returns to Reports", view_of(pg) == "reports" and vis(pg, "finance-reports"), pg.url)
    ctx.close()
    check("no page error (CEO views)", not errs, errs)

    # ---------------- Reconciliation: the right difference, reviewed is still open ----------------
    ctx, pg, errs = open_page(b, CEO, view="reconciliation")
    check("a link with view=reconciliation opens Reconciliation", vis(pg, "finance-recon"))
    diff = pg.get_by_test_id("recon-difference-value").inner_text().strip()
    check("Total Difference is -RM 5.00 (source - cash book), not RM 13,161.66", diff.replace("−", "-") == "-RM 5.00", diff)
    cards = pg.get_by_test_id("recon-card")
    check("A2Z alone: one mismatch record (AZ ONE's reviewed one is not shown under A2Z)", cards.count() == 1, cards.count())
    pg.locator('[data-testid="finance-company"]:visible').first.select_option("all"); pg.wait_for_timeout(1200)
    states = [cards.nth(i).get_attribute("data-state") for i in range(cards.count())]
    check("both companies: two mismatch records, one open, one reviewed", sorted(states) == ["open", "reviewed"], states)
    rev = pg.locator('[data-testid="recon-card"][data-state="reviewed"]')
    check("a reviewed record says Reviewed - still open, and offers no second review", rev.count() == 1 and "Reviewed - still open" in rev.inner_text() and rev.get_by_test_id("recon-review").count() == 0, rev.inner_text()[:300] if rev.count() else "")
    opn = pg.locator('[data-testid="recon-card"][data-state="open"]')
    check("the open payroll record shows -RM 5.00 and offers Mark Reviewed", opn.count() == 1 and opn.get_by_test_id("recon-card-difference").inner_text().replace("−", "-") == "-RM 5.00" and opn.get_by_test_id("recon-review").count() == 1)
    opn.get_by_role("button", name=re.compile("^More")).click(); pg.wait_for_timeout(250)
    check("the CEO alone has Accept the difference under More", opn.get_by_role("menuitem", name=re.compile("Accept the difference")).count() == 1)
    check("Other checks are folded away", vis(pg, "recon-other"))
    ctx.close()
    check("no page error (Reconciliation)", not errs, errs)

    # ---------------- the company selector ----------------
    ctx, pg, errs = open_page(b, CEO, view="transactions")
    a2z = pg.locator('[data-testid="tx-row"]:visible').count()
    rows = pg.locator('[data-testid="finance-transactions"]').inner_text()
    check("A2Z: AZ ONE's movement (INV-AZO090926-5) is not in A2Z's list", a2z > 0 and "INV-AZO090926-5" not in rows, rows[:300])
    pg.locator('[data-testid="finance-company"]:visible').first.select_option("azoo"); pg.wait_for_timeout(1200)
    rows = pg.locator('[data-testid="finance-transactions"]').inner_text()
    check("AZ ONE: only AZ ONE's movement", "INV-AZO090926-5" in rows and "PAYROLL-2026-08" not in rows and "Payroll" not in rows, rows[:300])
    check("one company: no consolidated notice", not vis(pg, "finance-consolidated"))
    pg.locator('[data-testid="finance-company"]:visible').first.select_option("all"); pg.wait_for_timeout(1200)
    check("both companies: labelled consolidated, never silently combined", vis(pg, "finance-consolidated") and "Consolidated" in pg.get_by_test_id("finance-consolidated").inner_text())
    ctx.close()
    check("no page error (company selector)", not errs, errs)

    # ---------------- the expense steps, per role ----------------
    seen = {}
    for name, port in [("CEO", CEO), ("COO", COO), ("Admin", ADMIN), ("Super Admin", SUPER)]:
        ctx, pg, errs = open_page(b, port, view="expenses")
        check(f"{name}: the Expenses view opens", vis(pg, "finance-expenses"))
        seen[name] = due_buttons(pg)
        seen[name + ":form"] = vis(pg, "expense-form")
        if name == "CEO":
            t = pg.get_by_test_id("finance-expenses").inner_text()
            check("scheduled items are commitments, never cash (the cash-basis banner)", "commitments, never cash" in t, t[:300])
        ctx.close()
        check(f"no page error (Expenses, {name})", not errs, errs)
    d = seen["CEO"]
    check("CEO: approves Canva (recorded by the admin), authorises Printing Co; never pays", d.get("Canva") == ["exp-approve"] and d.get("Printing Co") == ["exp-authorise"] and d.get("Landlord") == [], d)
    d = seen["COO"]
    check("COO: approves Canva, pays the Landlord (authorised by the CEO); never authorises", d.get("Canva") == ["exp-approve"] and d.get("Printing Co") == [] and d.get("Landlord") == ["exp-pay"], d)
    d = seen["Admin"]
    check("Admin: records expenses, approves nothing, authorises nothing, pays nothing", seen["Admin:form"] and all(v == [] for v in d.values()) and len(d) > 0, d)
    d = seen["Super Admin"]
    check("Super Admin: reads only - no form, no step", not seen["Super Admin:form"] and all(v == [] for v in d.values()), d)

    ctx, pg, errs = open_page(b, SUPER, view="reconciliation")
    check("Super Admin: no Mark Reviewed, no Accept, no Add transaction (CEO-10)", pg.get_by_test_id("recon-review").count() == 0 and pg.get_by_role("button", name=re.compile("^More")).count() == 0
          and pg.get_by_role("button", name=re.compile("Add transaction")).filter(visible=True).count() == 0)
    ctx.close()
    ctx, pg, errs = open_page(b, COO, view="reconciliation")
    opn = pg.locator('[data-testid="recon-card"][data-state="open"]')
    check("COO: Mark Reviewed, but no Accept (CEO only)", opn.get_by_test_id("recon-review").count() == 1 and opn.get_by_role("button", name=re.compile("^More")).count() == 0)
    ctx.close()

    # ---------------- Reports: one selector, one export ----------------
    ctx, pg, errs = open_page(b, CEO, view="reports")
    check("Reports: one report selector, an account filter and one export", pg.locator('[data-testid="report-select"]:visible').count() == 1 and vis(pg, "report-account") and pg.locator('[data-testid="report-export"]:visible').count() == 1)
    check("Reports: no P&L in Finance", "Profit" not in pg.get_by_test_id("finance-reports").inner_text() and "P&L" not in pg.get_by_test_id("finance-reports").inner_text())
    ctx.close()

    # ---------------- the phone ----------------
    ctx, pg, errs = open_page(b, CEO, w=390)
    check("phone: the view switch, not the line tabs", vis(pg, "finance-view-bar") and pg.get_by_role("tab").filter(visible=True).count() == 0)
    check("phone: Recent Transactions shows three rows", pg.locator('[data-testid="recent-row"]:visible').count() == 3)
    pg.get_by_test_id("finance-view-bar").get_by_test_id("view-switch").click(); pg.wait_for_timeout(250)
    pg.get_by_role("menuitemradio", name=re.compile("Transactions")).click(); pg.wait_for_timeout(1000)
    check("phone: the switch opens Transactions and writes the address", view_of(pg) == "transactions" and vis(pg, "tx-cards"), pg.url)
    f = pg.locator('[data-testid="finance-filters-phone"]')
    check("phone: the filters are folded until opened", f.count() == 1 and f.get_attribute("open") is None and not vis(pg, "finance-filters"))
    check("phone: no duplicate Add transaction on the view bar", pg.get_by_test_id("finance-view-bar").get_by_role("button", name=re.compile("Add transaction")).count() == 0)
    ctx.close()
    ctx, pg, errs = open_page(b, COO, w=390, view="expenses")
    ef = pg.locator('[data-testid="expense-form"]')
    check("phone: Add Expense is folded until opened", ef.count() == 1 and ef.get_attribute("open") is None)
    ctx.close()
    ctx, pg, errs = open_page(b, CEO, w=390, view="reports")
    check("phone: the months are a list, not a wide table", vis(pg, "report-months-phone"))
    ctx.close()
    check("no page error (phone)", not errs, errs)

    # ---------------- eight widths, every view: no sideways page ----------------
    for w in WIDTHS:
        bad = []
        for k in VIEWS:
            ctx, pg, errs = open_page(b, CEO, w=w, view=k)
            if not no_hscroll(pg): bad.append(k)
            if errs: bad.append(k + ":error")
            ctx.close()
        check(f"{w}px: no sideways page on any of the five views", not bad, bad)

    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

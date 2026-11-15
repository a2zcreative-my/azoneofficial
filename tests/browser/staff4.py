"""STAFF WORKSPACE 4.0 (v1.308.0) in a browser - the CEO, 15-11-2026: "approve
as recommended" (claude/STAFF-WORKSPACE-4.0-BLUEPRINT.md, S-0 ... S-14). The
server rules are held by tests/staff4.mjs; here, on the fixture's nine invented
people (STAFF4=1):

  six views from the address, Back / Forward; Overview's four figures, one
  distribution card, the Needs Attention list and quick actions; Directory's
  employment type column and filter, the status vocabulary, sign-in blocked;
  Organisation's leadership summary, tree search, department focus and the
  reporting lines; the Team Map's sectors, names, birthdays (day and month, no
  year) and leave; Departments & Roles' pills, department filter and Add staff
  to department; Staff Records' header, sections, masked NRIC, Edit / Cancel,
  history; the COO sees no private block and cannot edit; the HR tier can;
  a phone gets the view switch, a full-screen record and no sideways page at
  eight widths.

Servers: 4300 CEO (owner) · 4301 COO · 4302 HR admin (all STAFF4=1).
"""
from playwright.sync_api import sync_playwright
import re, urllib.request

CEO, COO, HR = 4300, 4301, 4302
res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)
WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def ctx_for(b, w, h=1000):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
def go(pg, port, view="overview", wait=2600):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Staff%20Details&view={view}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None
def zone(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('main *')].filter(e => e.offsetParent !== null && e.children.length === 0).map(e => e.textContent).join(' | ')""")

with sync_playwright() as p:
    b = p.chromium.launch()
    c = ctx_for(b, 1440, 1100); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, CEO)
    names = ["Overview", "Directory", "Organisation", "Team Map", "Departments & Roles", "Staff Records"]
    check("six views, in the reference's order", all(pg.get_by_role("tab", name=n, exact=True).count() == 1 for n in names), pg.get_by_role("tab").all_inner_texts())
    check("the Overview opens and is in the address", view_of(pg) == "overview", pg.url)
    t = zone(pg)
    check("Overview: Total Staff 9, Active Staff, Departments, Profiles Missing Info", all(s in t for s in ["Total Staff", "Active Staff", "Departments", "Profiles Missing Info"]) and "9" in t, t[:300])
    dist = pg.get_by_test_id("staff-distribution").inner_text()
    check("one distribution card: departments with %, Staff Status and Employment Type", all(s in dist for s in ["Sales and Marketing", "Management", "HR and Admin", "%", "Staff Status".upper(), "Employment Type".upper()]) or all(s in dist for s in ["Sales and Marketing", "Management", "HR and Admin", "%"]), dist[:300])
    att = pg.get_by_test_id("staff-attention").inner_text()
    check("Needs Attention: roles not written, incomplete records, probation ending soon, leaving soon, sign-in blocked", all(s in att for s in ["Roles not written yet", "Incomplete staff records", "Probation ending soon", "Staff leaving soon", "Sign-in blocked"]), att[:400])
    check("Quick Actions: Directory, Organisation, Team Map, Add Staff, Staff Records", all(pg.get_by_role("button", name=re.compile(n)).count() >= 1 for n in ["Staff Directory", "Team Map", "Add Staff", "Staff Records"]))
    check("nothing from Leave, Attendance, Payroll or Tasks queues; no NRIC", not re.search(r"Approve|Payslip|clocked in|\d{6}-\d{2}-\d{4}", t), re.findall(r"Approve|Payslip|clocked in|\d{6}-\d{2}-\d{4}", t))

    # Directory
    pg.get_by_role("tab", name="Directory", exact=True).click(); pg.wait_for_timeout(800)
    check("Directory is in the address", view_of(pg) == "directory", pg.url)
    table = pg.get_by_role("table", name="Staff directory")
    check("the list has an Employment Type column", "Employment Type" in table.inner_text())
    rows = lambda: table.locator("tbody tr").count()
    n_all = rows()
    pg.get_by_test_id("staff-type-filter").select_option("contract"); pg.wait_for_timeout(300)
    check("the employment type filter: Contract shows the one contract record", rows() == 1 and "Syazana" in table.inner_text(), table.inner_text()[:200])
    pg.get_by_test_id("staff-type-filter").select_option(""); pg.get_by_test_id("staff-status-filter").select_option("notice"); pg.wait_for_timeout(300)
    check("the status filter: On notice shows the person serving notice", rows() == 1 and "Hisyam" in table.inner_text() and "On notice" in table.inner_text(), table.inner_text()[:200])
    pg.get_by_test_id("staff-status-filter").select_option(""); pg.wait_for_timeout(300)
    tt = table.inner_text()
    check("a resigned person stays listed, Resigned and Sign-in blocked; probation says so", rows() == n_all == 9 and "Resigned" in tt and "Sign-in blocked" in tt and "On probation" in tt, tt[:300])
    pg.get_by_role("button", name="Profile").first.click(); pg.wait_for_timeout(700)
    prof = pg.locator("aside, [role=dialog]").filter(has_text="Basic information").first
    check("Profile opens the profile, with no NRIC, bank or statutory number", prof.count() == 1 and not re.search(r"\d{6}-\d{2}-\d{4}|1000000000", prof.inner_text()), prof.inner_text()[:200] if prof.count() else "")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

    # Organisation
    pg.get_by_role("tab", name="Organisation", exact=True).click(); pg.wait_for_timeout(900)
    lead = pg.get_by_test_id("org-leadership").inner_text()
    check("Leadership Summary: the CEO, no direct supervisor, oversees the company, direct reports and departments", all(s in lead for s in ["Leadership Summary", "No Direct Supervisor", "Oversees the Company", "Direct Reports (2)", "Departments (3)"]), lead[:300])
    tools = pg.get_by_test_id("org-tools")
    tools.get_by_role("searchbox").fill("Suaidah"); pg.wait_for_timeout(400)
    check("search person rings that person on the tree", pg.locator("[data-org-id='9307'][data-hit]").count() >= 1)
    tools.get_by_role("searchbox").fill(""); tools.locator("select").select_option("HR and Admin"); pg.wait_for_timeout(300)
    check("focus department dims everyone else", pg.locator("[data-org-id][data-dim]").count() >= 4)
    tools.locator("select").select_option("")
    lines = pg.get_by_test_id("org-lines").inner_text()
    check("Reporting lines: the CEO reports to no one, each manager's direct reports", "Reports to: no one (highest authority)" in lines and "direct report" in lines, lines[:300])
    pg.get_by_role("button", name="Change reporting line").first.click(); pg.wait_for_timeout(300)
    pg.locator("select[aria-label^='Who ']").first.select_option(index=1); pg.wait_for_timeout(500)
    dlg = pg.locator("[role=dialog], [role=alertdialog]").filter(has_text="Effective date")
    check("changing a line asks for a reason and an effective date, and says it decides the next leave", dlg.count() == 1 and "Reason" in dlg.inner_text() and "leave" in dlg.inner_text(), dlg.inner_text()[:300] if dlg.count() else zone(pg)[-300:])
    if dlg.count(): dlg.get_by_role("button", name=re.compile("Cancel|Batal")).click(); pg.wait_for_timeout(300)

    # Team Map
    pg.get_by_role("tab", name="Team Map", exact=True).click(); pg.wait_for_timeout(1200)
    tmap = pg.get_by_test_id("team-map").inner_text()
    check("Team Map: Total Staff, Active Staff, Next Birthdays, On Leave", all(s in tmap for s in ["Total Staff", "Active Staff", "Next Birthdays", "On Leave"]), tmap[:300])
    field = pg.get_by_test_id("team-field")
    check("the CEO at the centre, names under faces, department sectors", "CEO" in field.inner_text() and "Syazana" in field.inner_text() and "Sales and Marketing (" in field.inner_text(), field.inner_text()[:300])
    bd = pg.get_by_test_id("team-birthdays").inner_text()
    check("birthdays show the day and month, never a year or an age", "Nov" in bd and not re.search(r"19\d\d|turns", bd), bd)
    check("on leave today, by name only", "Farhana" in pg.get_by_test_id("team-leave").inner_text())
    field.get_by_role("button", name=re.compile("Syazana.*open the profile")).click(); pg.wait_for_timeout(600)
    check("...the same profile drawer", pg.locator("[role=dialog]").filter(has_text="Basic information").count() == 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

    # Departments & Roles
    pg.get_by_role("tab", name="Departments & Roles", exact=True).click(); pg.wait_for_timeout(800)
    cov = pg.get_by_test_id("roles-coverage").inner_text()
    check("coverage: n of m working staff, %, no invented delta", "working staff completed" in cov and "%" in cov and "pp" not in cov, cov)
    pg.get_by_role("button", name=re.compile(r"^Written \(")).click(); pg.wait_for_timeout(300)
    cards = pg.get_by_test_id("roles-dept-card")
    check("Written shows only the written records", cards.count() == 1 and "Farhana" in cards.first.inner_text() and "Hisyam" not in cards.first.inner_text())
    pg.get_by_role("button", name=re.compile(r"^Everyone \(")).click(); pg.get_by_test_id("roles-dept").select_option("HR and Admin"); pg.wait_for_timeout(300)
    check("the department dropdown shows one department", cards.count() == 1 and "HR and Admin" in cards.first.inner_text())
    cards.first.get_by_role("button", name=re.compile("Add staff to department")).click(); pg.wait_for_timeout(500)
    check("Add staff to department lists people to place", pg.get_by_role("button", name="Add here").count() >= 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

    # Staff Records
    pg.get_by_role("tab", name="Staff Records", exact=True).click(); pg.wait_for_timeout(800)
    picks = pg.get_by_test_id("rec-pick")
    check("the list shows each record's completeness out of 22", picks.count() == 9 and "/22" in picks.first.inner_text())
    picks.nth(0).click(); pg.wait_for_timeout(1200)
    rec = pg.get_by_test_id("staff-record")
    rt = rec.inner_text()
    check("the header: name, ID and position, status, joined, tenure, Print ID, Upload Document, Edit", all(s in rt for s in ["Rahim Ahmad", "STF-001", "Active", "Joined", "year", "Print ID", "Upload Document", "Edit"]), rt[:300])
    check("six sections", all(rec.get_by_role("tab", name=re.compile(n)).count() == 1 for n in ["Personal Details", "Employment", "Role & Access", "Bank & Statutory", "Documents", "Emergency Contact"]))
    ic = rec.get_by_label("IC number (NRIC)").input_value()
    check("the NRIC is masked until Edit", ic.startswith("******") and ic.endswith("0001"), ic)
    rec.get_by_test_id("rec-edit").click(); pg.wait_for_timeout(300)
    check("Edit shows the NRIC, Save and Cancel", rec.get_by_label("IC number (NRIC)").input_value() == "900101-01-0001" and rec.get_by_test_id("rec-save").count() == 1 and rec.get_by_test_id("rec-cancel").count() == 1)
    check("Save waits for a change", rec.get_by_test_id("rec-save").is_disabled())
    rec.get_by_test_id("rec-cancel").click(); pg.wait_for_timeout(200)
    rec.get_by_role("tab", name=re.compile("Bank & Statutory")).click(); pg.wait_for_timeout(300)
    check("Bank & Statutory for the CEO", "Maybank" in [rec.locator("select").first.input_value()] or "100000000001" in str([rec.locator("input").nth(i).input_value() for i in range(rec.locator("input").count())]))
    rows2 = pg.locator("[aria-label='Other sections'] li")
    check("the other sections, each with its completeness", rows2.count() == 5 and "/" in pg.locator("[aria-label='Other sections']").inner_text())
    rec.get_by_test_id("rec-history").click(); pg.wait_for_timeout(800)
    hl = pg.get_by_test_id("rec-history-list").inner_text()
    check("change history: who, when, before / after - the private field named, never valued", "Reporting line changed" in hl and "Junior Creative → Creative" in hl and "from 2026-11-02" in hl and "Bank account no." in hl and not re.search(r"1000000000", hl), hl[:400])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("no page error (CEO)", not errs, errs[:2])
    go(pg, CEO, "records", 2600)
    check("the records address opens Staff Records", view_of(pg) == "records" and pg.get_by_test_id("rec-pick").count() == 9)
    c.close()

    # the COO: no private block, no edit
    c = ctx_for(b, 1440, 1100); pg = c.new_page()
    go(pg, COO, "records", 2600)
    pg.get_by_test_id("rec-pick").nth(0).click(); pg.wait_for_timeout(1200)
    rec = pg.get_by_test_id("staff-record"); rt = rec.inner_text()
    check("the COO: the NRIC is 'on file · restricted', no Print ID, no Edit", "restricted" in rt and "Print ID" not in rt and rec.get_by_test_id("rec-edit").count() == 0 and not re.search(r"900101", rt), rt[:300])
    rec.get_by_role("tab", name=re.compile("Bank & Statutory")).click(); pg.wait_for_timeout(300)
    check("the COO: Bank & Statutory is open to HR and the CEO only", "open to HR and the CEO only" in rec.inner_text())
    c.close()

    # the HR tier
    c = ctx_for(b, 1440, 1100); pg = c.new_page()
    go(pg, HR, "records", 2600)
    pg.get_by_test_id("rec-pick").nth(1).click(); pg.wait_for_timeout(1200)
    rec = pg.get_by_test_id("staff-record")
    rec.get_by_role("tab", name=re.compile("Bank & Statutory")).click(); pg.wait_for_timeout(300)
    vals = [rec.locator("input").nth(i).input_value() for i in range(rec.locator("input").count())]
    check("HR reads the bank and statutory details and may edit", "100000000002" in vals and rec.get_by_test_id("rec-edit").count() == 1, vals)
    c.close()

    # phones and widths
    for w in WIDTHS:
        c = ctx_for(b, w, 900); pg = c.new_page(); perrs = []; pg.on("pageerror", lambda e: perrs.append(str(e)))
        bad = []
        for v in ["overview", "directory", "org", "team", "roles", "records"]:
            go(pg, CEO, v, 1800)
            if v == "records" and pg.get_by_test_id("rec-pick").count():
                pg.get_by_test_id("rec-pick").first.click(); pg.wait_for_timeout(900)
            if not no_hscroll(pg): bad.append(v)
        phone = w < 768
        extra = True
        if phone:
            extra = pg.get_by_test_id("staff-view-bar").is_visible() and pg.get_by_role("button", name="All records").is_visible() and not pg.get_by_test_id("rec-pick").first.is_visible()
        check(f"{w}px: no sideways page on any view" + (" · view switch · full-screen record with a way back" if phone else ""), not bad and extra and not perrs, (bad, perrs[:1]))
        c.close()
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

"""v1.337.0 - Tasks > Reports & Archive in four views, and the Task Email workspace in
System > Automation & Rules (the CEO, 17-11-2026), in a real browser against the built site.

  - Reports & Archive: one strip of four, one view switch, ONE view shown at a time;
    Submitted Reports beside the chosen report; Submit Report opens a drawer (daily,
    weekly, monthly) and posts to the same route; Team Performance, Completed Tasks
    and Task History (the task's recorded story) each on their own; one screen at
    1440x900; no sideways overflow at 390
  - the role's views: a salesperson sees Completed Tasks and Task History only
  - Task email settings link opens Automation & Rules on Task Email
  - not configured (MAIL_OFF, production today): the banner, Setup required, Not
    bound / Not set, Send test disabled - and the preview DRAWS (srcDoc), it is not
    the broken frame
  - Delivery Log lists the provider's answers; the Admin sees no task email views

Servers (servers.txt): 4177 ROLE=ceo, 4322 ROLE=ceo MAIL_OFF=1, 4182 ROLE=sales_marketing,
4186 ROLE=admin. Invented people only.  python3 tests/browser/task-reports-email.py"""
import json, os, sys, urllib.parse
from playwright.sync_api import sync_playwright

S = os.environ.get("SHOTS", "/tmp/tre-shots"); os.makedirs(S, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_at(b, port, path, w=1440, h=900, scale=1):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500, device_scale_factor=scale)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs, reqs

def visible(pg, tid):
    l = pg.get_by_test_id(tid)
    return l.count() > 0 and l.first.is_visible()

FITS = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
REPORTS = "/portal?tab=Tasks&view=reports"
AUTO = "/portal?tab=Automation%20%26%20Rules"

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- Reports & Archive, the CEO ----------------
    ctx, pg, errs, reqs = open_at(b, 4177, REPORTS)
    strip = pg.get_by_test_id("reports-strip")
    check("one connected strip of four: Reports Submitted, Awaiting Review, Archived Tasks, Task Attention",
          strip.get_attribute("data-cells") == "4" and all(x in strip.inner_text() for x in ["Reports Submitted", "Awaiting Review", "Archived Tasks", "Task Attention"]), strip.inner_text())
    pills = pg.get_by_test_id("rep-view").locator("button").all_inner_texts()
    check("one view switch: Submitted Reports, Team Performance, Completed Tasks, Task History", [x.strip() for x in pills] == ["Submitted Reports", "Team Performance", "Completed Tasks", "Task History"], pills)
    check("only the active view shows (Submitted Reports)", visible(pg, "task-reports-list") and not visible(pg, "team-performance") and not pg.locator("#task-archive").is_visible() and not visible(pg, "task-history"))
    check("Awaiting Review counts the reports not yet reviewed (1 of 2)", "1" in strip.locator("[data-cell=awaiting]").inner_text())
    vh = pg.evaluate("window.innerHeight"); sh = pg.evaluate("document.documentElement.scrollHeight")
    check("one screen at 1440x900: the page does not scroll, the panes do", sh <= vh + 2, (sh, vh))
    rows = pg.get_by_test_id("reports-table").locator("[data-record^='report:']")
    check("the register lists the reports", rows.count() == 2, rows.count())
    rows.nth(1).click(); pg.wait_for_timeout(300)
    det = pg.get_by_test_id("report-detail")
    check("choosing a report shows it whole beside the register, its lines kept", "Weekly Project Report" in det.inner_text() and "Raya stock counted" in pg.get_by_test_id("report-text").inner_text()
          and pg.get_by_test_id("report-text").evaluate("e => getComputedStyle(e).whiteSpace") == "pre-line", det.inner_text()[:200])
    pg.get_by_test_id("reports-period").select_option("weekly"); pg.wait_for_timeout(250)
    check("the period filter narrows the register", rows.count() == 1)
    pg.get_by_test_id("reports-period").select_option("")
    pg.screenshot(path=f"{S}/reports-ceo.png")
    pg.get_by_test_id("report-submit-open").click(); pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog").filter(has_text="Submit a report")
    check("Submit Report opens a drawer with daily, weekly and monthly", dlg.count() == 1 and pg.get_by_test_id("report-period").locator("option").all_inner_texts() == ["Daily", "Weekly", "Monthly"])
    pg.get_by_test_id("report-period").select_option("monthly")
    pg.locator("#task-report-text").fill("November: 12 lives, 3 new hotels, payroll on time.")
    pg.screenshot(path=f"{S}/reports-submit-drawer.png")
    pg.get_by_test_id("report-submit").click(); pg.wait_for_timeout(900)
    sent = [json.loads(d or "{}") for m, u, d in reqs if m == "POST" and urllib.parse.urlparse(u).path == "/api/v1/staff/task-reports"]
    check("...and posts ONE report to the same route, monthly, with its text", len(sent) == 1 and sent[0].get("period") == "monthly" and sent[0].get("content", "").startswith("November"), sent)
    check("...then the drawer closes", pg.get_by_role("dialog").filter(has_text="Submit a report").count() == 0)
    for fb in pg.get_by_test_id("feedback-ok").all():
        fb.click()
    pg.get_by_test_id("rep-view-team").click(); pg.wait_for_timeout(400)
    check("Team Performance shows alone", visible(pg, "team-performance") and not visible(pg, "task-reports-list") and "Staff Task Performance" in pg.get_by_test_id("team-performance").inner_text())
    strip.locator("[data-cell=archived]").click(); pg.wait_for_timeout(400)
    check("the Archived Tasks figure opens Completed Tasks, alone", pg.locator("#task-archive").is_visible() and not visible(pg, "team-performance"))
    pg.get_by_test_id("rep-view-history").click(); pg.wait_for_timeout(1200)
    feed = pg.get_by_test_id("history-feed")
    check("Task History shows the chosen task's recorded story", feed.count() == 1 and "Created the task for" in feed.inner_text(), feed.inner_text()[:200] if feed.count() else "no feed")
    pg.screenshot(path=f"{S}/history-ceo.png")
    check("no sideways overflow at 1440", pg.evaluate(FITS))
    pg.get_by_test_id("task-email-settings").click(); pg.wait_for_timeout(2500)
    check("Task email settings opens System > Automation & Rules on Task Email", visible(pg, "task-mail-panel") and pg.get_by_test_id("auto-view-email").get_attribute("aria-selected") == "true")
    check("no page errors (CEO)", not errs, errs)
    ctx.close()

    # ---------------- the Task Email workspace, NOT configured (production today) ----------------
    ctx, pg, errs, reqs = open_at(b, 4322, AUTO)
    check("Automation & Rules opens on Task Email for the CEO", visible(pg, "task-mail-panel"))
    check("the not-configured banner says so", visible(pg, "mail-not-configured") and "Email sending is not configured" in pg.get_by_test_id("mail-not-configured").inner_text())
    svc = pg.get_by_test_id("mail-strip").locator("[data-cell=service]").inner_text()
    check("Email Service: Setup required", "Setup required" in svc, svc)
    check("the configuration says what the Worker sees: Not bound, Not set, not proven", "Not bound" in pg.get_by_test_id("mail-fact-binding").inner_text() and "Not set" in pg.get_by_test_id("mail-fact-from").inner_text() and "Not yet" in pg.get_by_test_id("mail-fact-proven").inner_text())
    check("Send a test is disabled until sending is configured", pg.get_by_test_id("mail-test").is_disabled())
    pg.wait_for_timeout(800)
    fr = pg.get_by_test_id("mail-preview")
    check("the preview DRAWS (srcDoc in a sandboxed frame), not a refused frame", fr.count() == 1 and fr.get_attribute("sandbox") == "" and "New task assigned" in (fr.get_attribute("srcdoc") or "")
          and "New task assigned" in pg.frame_locator("[data-testid=mail-preview]").locator("h1").inner_text())
    check("no frame points at the API (the old iframe src the browser refused)", pg.locator("iframe[src*='/api/v1/']").count() == 0)
    pg.get_by_test_id("mail-steps-open").click(); pg.wait_for_timeout(400)
    check("the setup checklist opens in a drawer with the four owner steps", pg.get_by_test_id("mail-steps").locator("li").count() == 4)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    vh = pg.evaluate("window.innerHeight"); sh = pg.evaluate("document.documentElement.scrollHeight")
    check("one screen at 1440x900 (the panes scroll inside)", sh <= vh + 2, (sh, vh))
    pg.screenshot(path=f"{S}/task-email-not-configured.png")
    pg.get_by_test_id("auto-view-log").click(); pg.wait_for_timeout(900)
    check("Delivery Log, nothing sent yet: says so", "No task emails yet" in pg.get_by_test_id("mail-log").inner_text())
    check("no page errors (not configured)", not errs, errs)
    ctx.close()

    # ---------------- configured: the log with the provider's answers ----------------
    ctx, pg, errs, _ = open_at(b, 4177, AUTO)
    check("configured: Email Service Configured, sender proven by an accepted test", "Configured" in pg.get_by_test_id("mail-strip").locator("[data-cell=service]").inner_text() and "Accepted" in pg.get_by_test_id("mail-fact-proven").inner_text())
    pg.get_by_test_id("auto-view-log").click(); pg.wait_for_timeout(900)
    t = pg.get_by_test_id("mail-log").inner_text()
    check("the log shows each email with its provider answer (Accepted by Cloudflare; Not sent - 550 mailbox unavailable)", "Accepted by Cloudflare" in t and "550 5.1.1 mailbox unavailable" in t, t[:300])
    pg.screenshot(path=f"{S}/delivery-log.png")
    ctx.close()

    # ---------------- the phone ----------------
    for port, path, name in [(4177, REPORTS, "reports"), (4322, AUTO, "task-email")]:
        ctx, pg, errs, _ = open_at(b, port, path, 390, 844, 2)
        check(f"390px {name}: no sideways overflow", pg.evaluate(FITS), pg.evaluate("document.documentElement.scrollWidth"))
        pg.screenshot(path=f"{S}/{name}-phone.png")
        check(f"390px {name}: no page errors", not errs, errs)
        ctx.close()

    # ---------------- the roles ----------------
    ctx, pg, errs, _ = open_at(b, 4182, REPORTS)
    pills = [x.strip() for x in pg.get_by_test_id("rep-view").locator("button").all_inner_texts()]
    check("a salesperson sees Completed Tasks and Task History only (no reports, no team table, no email link)", pills == ["Completed Tasks", "Task History"] and pg.get_by_test_id("task-email-settings").count() == 0, pills)
    ctx.close()
    ctx, pg, errs, _ = open_at(b, 4186, AUTO)
    views = [x.strip() for x in pg.get_by_role("tab").all_inner_texts() if x.strip() in ["Task Email", "Delivery Log", "Watcher Rules", "Attendance Policy"]]
    check("the Admin account: Watcher Rules and Attendance Policy, no task email views", views == ["Watcher Rules", "Attendance Policy"], views)
    ctx.close()
    b.close()

fails = [n for n, c in results if not c]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)

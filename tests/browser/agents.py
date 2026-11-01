"""v1.249.0 - the Agent desk and the CEO's task-update email, on screen.

Servers (servers.txt): ROLE=agent on 4222, ROLE=sales_marketing on 4182,
ROLE=ceo on 4177, ROLE=live_host on 4180. The fixture is a stand-in for the
worker; who may see what is proven by direct request in tests/go-live-g.mjs."""
import json, re
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def page(b, port, w=1440, h=1000):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}/portal"); pg.wait_for_timeout(2500)
    return ctx, pg, errs, reqs

def tab(pg, name):
    btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count() == 0:
        m = pg.get_by_role("button", name="More").filter(visible=True)
        if m.count(): m.first.click(); pg.wait_for_timeout(500)
        btn = pg.get_by_role("button", name=name, exact=True).filter(visible=True)
    if btn.count(): btn.first.click(); pg.wait_for_timeout(1800); return True
    return False

def rail(pg):
    return [t.strip() for t in pg.locator("nav button, aside button").all_inner_texts() if t.strip()]

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- an agent ----
    ctx, pg, errs, reqs = page(b, 4222)
    names = set(rail(pg))
    check("an agent's menu is Tasks, Agents and Profile - no Dashboard, Sales, HR, Payroll or Users",
          {"Tasks", "Agents", "Profile"} <= names and not ({"Dashboard", "Desk", "Sales", "HR", "Payroll", "Users", "Finance", "Commission", "On Shift"} & names), sorted(names))
    check("an agent lands on the Agent desk (they have no Dashboard)", pg.get_by_test_id("agents-panel").count() == 1)
    check("an agent opens the Agent desk", tab(pg, "Agents"))
    panel = pg.get_by_test_id("agents-panel")
    txt = panel.inner_text() if panel.count() else ""
    check("the desk shows the active packages with their prices and contents", "10 Video Content" in txt and "RM 700.00" in txt.replace("RM ", "RM ") and "10 × Video Content 30s" in txt, txt[:400])
    pg.get_by_test_id("agent-pkg-11").get_by_role("button", name="Submit a client").click(); pg.wait_for_timeout(700)
    send = pg.get_by_role("button", name="Send to Sales")
    check("Send stays off until the client's name and a phone or email are given", send.is_disabled())
    pg.get_by_label("Client name *").fill("Puan Rina"); pg.get_by_label("Phone").fill("0129998888")
    check("...then it can be sent", not send.is_disabled())
    reqs.clear(); send.click(); pg.wait_for_timeout(1200)
    posted = [json.loads(r[2] or "{}") for r in reqs if r[0] == "POST" and r[1].endswith("/staff/agent/requests")]
    check("the request goes to the server with the chosen package", len(posted) == 1 and posted[0].get("package_id") == 11 and posted[0].get("client_name") == "Puan Rina", posted)
    txt2 = panel.inner_text()
    check("then My requests shows the agent's own requests and what happened (Quoted, the quotation)", "My requests" in txt2 and "Puan Rina" in txt2 and "Quoted" in txt2 and "QT-AZO150926-1" in txt2, txt2[:400])
    check("an agent sees no Agent column and no Edit button", panel.get_by_role("button", name="Edit").count() == 0 and "Ros Agent" not in txt2)
    check("no page errors (agent)", not errs, errs)
    ctx.close()
    ctx, pg, errs, reqs = page(b, 4222, 390, 844)
    tab(pg, "Agents")
    check("on a phone the agent desk fits the screen", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    ctx.close()

    # ---- Sales & Marketing: read only ----
    ctx, pg, errs, reqs = page(b, 4182)
    check("Sales & Marketing have the Agents tab", tab(pg, "Agents"))
    panel = pg.get_by_test_id("agents-panel")
    t = panel.inner_text()
    check("they see every agent's request with the agent's name", "Ros Agent" in t and "Zul Agent" in t and "Cik Lina" in t, t[:300])
    check("...read only (no Edit)", panel.get_by_role("button", name="Edit").count() == 0)
    check("no page errors (sales)", not errs, errs)
    ctx.close()

    # ---- the CEO: edits requests, sends task updates ----
    ctx, pg, errs, reqs = page(b, 4177)
    tab(pg, "Agents")
    panel = pg.get_by_test_id("agents-panel")
    check("management can edit a request", panel.get_by_role("button", name="Edit").count() >= 3)
    panel.get_by_test_id("agent-req-2").get_by_role("button", name="Edit").click(); pg.wait_for_timeout(900)
    pg.get_by_label("Status").last.select_option("contacted")
    reqs.clear(); pg.get_by_role("button", name="Save", exact=True).click(); pg.wait_for_timeout(900)
    patched = [json.loads(r[2] or "{}") for r in reqs if r[0] == "PATCH" and r[1].endswith("/staff/agent/requests/2")]
    check("Save sends the new status", len(patched) == 1 and patched[0].get("status") == "contacted", patched)
    tab(pg, "Tasks")
    pg.get_by_role("tab", name="Reports & Archive", exact=True).first.click(); pg.wait_for_timeout(1500)
    bc = pg.get_by_test_id("task-broadcast")
    check("Reports & Archive offers the CEO Send a task update", bc.count() == 1)
    bc.get_by_label("Subject").fill("Week plan"); bc.get_by_label("Message").fill("Please update every task today")
    bc.get_by_role("button", name="Preview").click(); pg.wait_for_timeout(900)
    check("Preview shows how many receive it and the email itself", "4 people" in bc.inner_text() and bc.locator("iframe").count() == 1, bc.inner_text()[-200:])
    reqs.clear(); bc.get_by_role("button", name="Send the update").click(); pg.wait_for_timeout(900)
    sentb = [json.loads(r[2] or "{}") for r in reqs if r[0] == "POST" and r[1].endswith("/staff/tasks/mail-broadcast")]
    check("Send posts the subject, message and 'everyone with open tasks'", len(sentb) == 1 and sentb[0].get("to") == "open_work" and sentb[0].get("subject") == "Week plan" and "preview" not in sentb[0], sentb)
    check("no page errors (CEO)", not errs, errs)
    ctx.close()

    # ---- other staff ----
    ctx, pg, errs, reqs = page(b, 4180)
    check("a live host has no Agents tab", "Agents" not in set(rail(pg)) and not tab(pg, "Agents"))
    ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"agents: {passed} of {len(results)} passed")

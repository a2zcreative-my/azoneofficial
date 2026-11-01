"""v1.249.0 - the Agent desk and the CEO's task-update email, on screen.
v1.250.0 - the agent portal workflow: the agent's workspace (Overview,
Packages, My Requests, My Quotations, Updates), the shared request drawer,
Sales read-only, management handling, Grant Agent Access.

Servers (servers.txt): ROLE=agent on 4222, ROLE=sales_marketing on 4182,
ROLE=ceo on 4177, ROLE=live_host on 4180, ROLE=ceo OWNER=1 on 4191. The
fixture is a stand-in for the worker; who may see what is proven by direct
request in tests/go-live-g.mjs and tests/go-live-h.mjs."""
import json
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def page(b, port, w=1440, h=1000, path="/portal"):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(2500)
    return ctx, pg, errs, reqs

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
    if t.count(): t.first.click(); pg.wait_for_timeout(900); return True
    return False

def rail(pg):
    return [t.strip() for t in pg.locator("nav button, aside button").all_inner_texts() if t.strip()]

def posts(reqs, suffix, method="POST"):
    out = []
    for r in reqs:
        if r[0] == method and r[1].split("?")[0].endswith(suffix):
            try: out.append(json.loads(r[2] or "{}"))
            except Exception: out.append({})
    return out

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- an agent ----
    ctx, pg, errs, reqs = page(b, 4222)
    names = set(rail(pg))
    check("an agent's menu is Tasks, Agents and Profile - no Dashboard, Sales, HR, Payroll or Users",
          {"Tasks", "Agents", "Profile"} <= names and not ({"Dashboard", "Desk", "Sales", "HR", "Payroll", "Users", "Finance", "Commission", "On Shift"} & names), sorted(names))
    panel = pg.get_by_test_id("agents-panel")
    check("an agent lands on the Agent workspace", panel.count() == 1 and "Agent workspace" in panel.inner_text())
    ov = panel.inner_text()
    check("Overview counts the agent's own requests - one needs their reply, one quotation ready", "Need your reply" in ov and "Quotations ready" in ov, ov[:300])
    check("the agent workspace has Overview, Packages, My Requests, My Quotations and Updates",
          all(pg.get_by_role("tab", name=n, exact=True).count() == 1 for n in ["Overview", "Packages", "My Requests", "My Quotations", "Updates"]))
    sub(pg, "Packages")
    txt = panel.inner_text()
    check("Packages shows the active packages with prices and contents", "10 Video Content" in txt and "RM 700.00" in txt and "10 × Video Content 30s" in txt, txt[:400])
    pg.get_by_test_id("agent-pkg-11").get_by_role("button", name="Submit a client").click(); pg.wait_for_timeout(700)
    send = pg.get_by_role("button", name="Send to Sales")
    check("Send stays off until the client, a phone or email and a package are given", send.is_disabled())
    pg.get_by_label("Client or company *").fill("Puan Rina"); pg.get_by_label("Phone").fill("0129998888")
    pg.get_by_label("Contact person").fill("Puan Rina binti Ali")
    check("...then it can be sent (the package came from the card)", not send.is_disabled())
    reqs.clear(); send.click(); pg.wait_for_timeout(1200)
    posted = posts(reqs, "/staff/agent/requests")
    check("the request goes to the server with the package, the contact and a retry key - never a price",
          len(posted) == 1 and posted[0].get("package_id") == 11 and posted[0].get("client_name") == "Puan Rina" and posted[0].get("contact_person") == "Puan Rina binti Ali" and posted[0].get("client_key") and posted[0].get("draft") is False and "total_cents" not in posted[0], posted)
    sub(pg, "My Requests")
    t2 = panel.inner_text()
    check("My Requests lists the agent's requests with the latest update and their quotation once published",
          "AGR-0001" in t2 and "AGR-0002" in t2 and "Quotation ready" in t2 and "QT-AZO150926-1" in t2 and "Ros Agent" not in t2, t2[:400])
    check("...never an internal note", "deposit term" not in t2)
    panel.get_by_role("button", name="AGR-0001").click(); pg.wait_for_timeout(1200)
    dr = pg.get_by_test_id("agent-request-drawer")
    dt = dr.inner_text() if dr.count() else ""
    check("the request drawer shows the published quotation: number, company, total, valid-until",
          "QT-AZO150926-1" in dt and "AZ ONE OFFICIAL" in dt and "RM 700.00" in dt and "30-11-2026" in dt, dt[:400])
    link = dr.get_by_role("link", name="Open quotation")
    check("...opens the official customer link (no copy, no portal token)", link.count() == 1 and "/doc?t=" in (link.get_attribute("href") or ""))
    check("...says the agent cannot change price, company, signature or payment", "Price, issuing company, signature and payment are Sales'" in dt)
    check("...no internal entries and no who-sees-it labels for an agent", "deposit term" not in dt and "Internal" not in dt and "Agent can see" not in dt)
    check("...and nothing a handler does (no Publish, no Create quotation, no Move to)", dr.get_by_role("button", name="Publish to Agent").count() == 0 and dr.get_by_role("button", name="Create quotation in Sales").count() == 0 and "Move to" not in dt)
    check("email from the portal says it is not switched on yet", "Email from the portal is not switched on yet" in dt)
    reqs.clear(); dr.get_by_role("button", name="I shared it").click(); pg.wait_for_timeout(900)
    sh = posts(reqs, "/staff/agent/requests/1/shared")
    check("I shared it records the channel (self-reported)", len(sh) == 1 and sh[0].get("channel") == "whatsapp", sh)
    dr.get_by_role("button", name="Says yes").click(); pg.wait_for_timeout(400)
    dr.get_by_label("What the client said").fill("Go ahead with the ten videos")
    check("Says yes cannot be sent without evidence", dr.get_by_role("button", name="Send to Sales").first.is_disabled())
    dr.get_by_role("button", name="Wants changes").click(); pg.wait_for_timeout(300)
    dr.get_by_label("What the client said").fill("Wants twelve videos")
    reqs.clear(); dr.get_by_role("button", name="Send to Sales").first.click(); pg.wait_for_timeout(900)
    fbk = posts(reqs, "/staff/agent/requests/1/feedback")
    check("Wants changes goes to Sales as a revision request", len(fbk) == 1 and fbk[0].get("kind") == "revision", fbk)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    panel.get_by_role("button", name="AGR-0002").click(); pg.wait_for_timeout(1200)
    dr = pg.get_by_test_id("agent-request-drawer")
    check("a More info request shows Sales' question and asks for the answer", "Which products?" in dr.inner_text() and pg.get_by_label("Your answer to Sales *").count() == 1)
    pg.get_by_label("Your answer to Sales *").fill("Bakery boxes and cakes")
    reqs.clear(); pg.get_by_role("button", name="Send the answer").click(); pg.wait_for_timeout(900)
    an = posts(reqs, "/staff/agent/requests/2", "PATCH")
    check("...the answer goes back to Sales", len(an) == 1 and an[0].get("submit") is True and "Bakery" in an[0].get("answer", ""), an)
    check("no page errors (agent)", not errs, errs)
    ctx.close()

    ctx, pg, errs, reqs = page(b, 4222, 390, 844)
    sub(pg, "My Requests")
    check("on a phone the agent workspace fits the screen", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    pg.get_by_test_id("agents-panel").get_by_role("button", name="AGR-0001").click(); pg.wait_for_timeout(1200)
    check("...and the request opens full screen without sideways scroll", pg.get_by_test_id("agent-request-drawer").count() == 1 and pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    ctx.close()

    # ---- Sales & Marketing: read and comment ----
    ctx, pg, errs, reqs = page(b, 4182)
    check("Sales & Marketing have the Agents tab", tab(pg, "Agents"))
    panel = pg.get_by_test_id("agents-panel")
    t = panel.inner_text()
    check("they see every agent's request with the agent, Sales and the latest update", "Ros Agent" in t and "Zul Agent" in t and "Lina Spa" in t and "Client says yes" in t and "Draft Co" not in t, t[:400])
    panel.get_by_role("button", name="AGR-0003").click(); pg.wait_for_timeout(1200)
    dr = pg.get_by_test_id("agent-request-drawer")
    check("...read only for an unassigned salesperson (no Move to, no Publish, no Verify)", "Move to" not in dr.inner_text() and dr.get_by_role("button", name="Record and verify").count() == 0)
    check("no page errors (sales)", not errs, errs)
    ctx.close()

    # ---- the CEO: handles requests, sends task updates ----
    ctx, pg, errs, reqs = page(b, 4177)
    tab(pg, "Agents")
    panel = pg.get_by_test_id("agents-panel")
    sub(pg, "Overview")
    ov = panel.inner_text()
    check("management's Overview shows the request statuses and overdue follow-ups", "Acceptance to verify" in ov and "Overdue follow-up" in ov, ov[:300])
    sub(pg, "Requests")
    panel.get_by_role("button", name="AGR-0003").click(); pg.wait_for_timeout(1200)
    dr = pg.get_by_test_id("agent-request-drawer")
    dt = dr.inner_text()
    check("management sees internal notes marked Internal and the agent's evidence", "deposit term" in dt and "Internal" in dt and "whatsapp-yes.png" in dt, dt[:400])
    check("Verify needs who agreed and how - the quotation's own acceptance record", dr.get_by_role("button", name="Record and verify").count() == 1 and dr.get_by_role("button", name="Record and verify").is_disabled())
    dr.get_by_label("Who agreed").fill("Cik Lina")
    reqs.clear(); dr.get_by_role("button", name="Record and verify").click(); pg.wait_for_timeout(1500)
    acc = posts(reqs, "/staff/docs/1/acceptance"); ver = posts(reqs, "/staff/agent/requests/3/verify")
    check("...records the acceptance on the quotation, then verifies the request", len(acc) == 1 and acc[0].get("accepted_name") == "Cik Lina" and acc[0].get("channel") == "whatsapp" and len(ver) == 1, (acc, ver))
    dr.get_by_label("Comment").fill("Please send the signed order too")
    dr.get_by_role("radio", name="Agent can see").click()
    reqs.clear(); dr.get_by_role("button", name="Post").click(); pg.wait_for_timeout(900)
    cm = posts(reqs, "/staff/agent/requests/3/events")
    check("a comment says who sees it (here: the agent)", len(cm) == 1 and cm[0].get("visibility") == "agent" and cm[0].get("kind") == "comment", cm)
    check("Create quotation in Sales and Publish (the current revision, for one already published) are offered to the handler", dr.get_by_role("button", name="New quotation in Sales").count() == 1 and dr.get_by_role("button", name="Publish the current revision").count() == 1)
    dr.get_by_role("button", name="New quotation in Sales").click(); pg.wait_for_timeout(3000)
    check("...which opens Sales' own Create Quotation form, prefilled with the request reference", pg.evaluate("[...document.querySelectorAll('input')].some(i => i.value === 'AGR-0003')"), pg.url)
    tab(pg, "Tasks")
    pg.get_by_role("tab", name="Reports & Archive", exact=True).first.click(); pg.wait_for_timeout(1500)
    bc = pg.get_by_test_id("task-broadcast")
    check("Reports & Archive offers the CEO Send a task update", bc.count() == 1)
    bc.get_by_label("Subject").fill("Week plan"); bc.get_by_label("Message").fill("Please update every task today")
    bc.get_by_role("button", name="Preview").click(); pg.wait_for_timeout(900)
    reqs.clear(); bc.get_by_role("button", name="Send the update").click(); pg.wait_for_timeout(900)
    sentb = posts(reqs, "/staff/tasks/mail-broadcast")
    check("Send posts the subject, message and 'everyone with open tasks'", len(sentb) == 1 and sentb[0].get("to") == "open_work" and sentb[0].get("subject") == "Week plan" and "preview" not in sentb[0], sentb)
    check("no page errors (CEO)", not errs, errs)
    ctx.close()

    # ---- the owner: Grant Agent Access ----
    ctx, pg, errs, reqs = page(b, 4191)
    tab(pg, "Users")
    sub(pg, "Customer Accounts")
    check("Users › Customer Accounts offers the owner Grant Agent Access", pg.locator("[data-testid^='grant-agent-']").count() >= 1)
    ctx.close()

    # ---- other staff ----
    ctx, pg, errs, reqs = page(b, 4180)
    check("a live host has no Agents tab", "Agents" not in set(rail(pg)) and not tab(pg, "Agents"))
    ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"agents: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

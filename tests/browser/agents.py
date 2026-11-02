"""v1.249.0 - the Agent desk and the CEO's task-update email, on screen.
v1.250.0 - the agent portal workflow.
v1.250.2 - "every action has a clear button": no Tasks for agents, the agent's
own phone bar (Overview, Packages, Requests, Quotations), Submit Client
Request on every view and in the empty state, a request opening on Overview /
Updates & Comments / Files with Add Status Update, Manage Agent Access for the
owner, role-specific empty states.

Servers (servers.txt): ROLE=agent on 4222, ROLE=agent AGENT_EMPTY=1 on 4223,
ROLE=ceo OWNER=1 AGENT_EMPTY=1 on 4224, ROLE=sales_marketing on 4182,
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

def sub(pg, name, scope=None):
    t = (scope or pg).get_by_role("tab", name=name, exact=True).filter(visible=True)
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

def fits(pg):
    return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- an agent, desktop ----
    ctx, pg, errs, reqs = page(b, 4222)
    names = set(rail(pg))
    check("an agent's menu is their workspace and Profile - no Tasks, Dashboard, On Shift, HR, Staff, Users",
          {"Agents", "Profile"} <= names and not ({"Tasks", "Dashboard", "Desk", "Sales", "HR", "Payroll", "Users", "Finance", "On Shift", "Staff Details"} & names), sorted(names))
    panel = pg.get_by_test_id("agents-panel")
    check("an agent lands on the Agent workspace", panel.count() == 1 and "Agent workspace" in panel.inner_text())
    big = pg.get_by_test_id("submit-client-request")
    check("+ Submit Client Request is a prominent button on the workspace", big.count() == 1 and big.is_visible())
    check("the workspace views are Overview, Packages, My Requests and My Quotations",
          all(pg.get_by_role("tab", name=n, exact=True).count() == 1 for n in ["Overview", "Packages", "My Requests", "My Quotations"]))
    big.click(); pg.wait_for_timeout(700)
    send = pg.get_by_role("button", name="Send to Sales")
    check("Send stays off until the client, a phone or email and a package are given", send.is_disabled())
    pg.get_by_label("Client or company *").fill("Puan Rina"); pg.get_by_label("Phone").fill("0129998888")
    pg.get_by_label("Contact person").fill("Puan Rina binti Ali")
    pg.get_by_label("Package *").select_option("11")
    pg.get_by_label("What the client needs").fill("Ten videos before CNY")
    check("...then it can be sent", not send.is_disabled())
    check("the form takes notes, budget, timeline and an attachment", pg.get_by_label("Your notes for Sales (optional)").count() == 1 and pg.get_by_label("Budget (optional)").count() == 1 and pg.get_by_label("Attachment (optional - PDF, image or Word)").count() == 1)
    reqs.clear(); send.click(); pg.wait_for_timeout(1200)
    posted = posts(reqs, "/staff/agent/requests")
    check("the request goes to the authoritative backend with the package, contact and a retry key - never a price or an agent id",
          len(posted) == 1 and posted[0].get("package_id") == 11 and posted[0].get("client_name") == "Puan Rina" and posted[0].get("client_key") and posted[0].get("draft") is False and "total_cents" not in posted[0] and "agent_id" not in posted[0], posted)
    check("...the form closes with a Sent toast and the agent is on My Requests", pg.get_by_role("button", name="Send to Sales").count() == 0 and "Sent to the sales team" in pg.inner_text("body"))
    sub(pg, "My Requests")
    t2 = panel.inner_text()
    check("My Requests lists the agent's requests with status, quotation and latest update", "AGR-0001" in t2 and "AGR-0002" in t2 and "Quotation ready" in t2 and "QT-AZO150926-1" in t2 and "Ros Agent" not in t2 and "deposit term" not in t2, t2[:300])
    check("...as one table on a desktop - the phone cards stay hidden", panel.locator("table").filter(visible=True).count() == 1 and pg.get_by_test_id("agent-card-1").is_hidden() and panel.get_by_role("button", name="AGR-0001").filter(visible=True).count() == 1)
    panel.get_by_role("button", name="AGR-0001").filter(visible=True).first.click(); pg.wait_for_timeout(1200)
    dr = pg.get_by_test_id("agent-request-drawer")
    check("a request opens on Overview, Updates & Comments, Files", all(dr.get_by_role("tab", name=n).count() == 1 for n in ["Overview", "Files (0)"]) and dr.get_by_role("tab", name="Updates & Comments", exact=False).count() == 1)
    dt = dr.inner_text()
    check("...with the progress line, the assigned salesperson and the published quotation", "Quotation ready" in dt and "Assigned Sales" in dt and "Nur Aisyah" in dt and "QT-AZO150926-1" in dt and "RM 700.00" in dt, dt[:300])
    check("...View approved quotation opens the official customer link", "/doc?t=" in (dr.get_by_role("link", name="View approved quotation").get_attribute("href") or ""))
    check("...Add Status Update, I shared it, Request revision and Report client acceptance are visible buttons",
          all(dr.get_by_role("button", name=n).count() == 1 for n in ["Add Status Update", "I shared it with the client", "Request revision", "Report client acceptance"]))
    check("...and nothing a handler does (no Publish, Create quotation, Move to)", dr.get_by_role("button", name="Publish to Agent").count() == 0 and dr.get_by_role("button", name="Create quotation in Sales").count() == 0 and "Move to" not in dt)
    dr.get_by_role("button", name="I shared it with the client").click(); pg.wait_for_timeout(600)
    form = pg.get_by_test_id("add-update-form")
    check("I shared it opens the one Add Status Update form, type preset", form.count() == 1 and form.get_by_label("Update type *").input_value() == "shared")
    form.get_by_label("What happened *").fill("Sent on WhatsApp to Puan Rina")
    form.get_by_label("Next action (optional)").fill("Call on Monday")
    reqs.clear(); form.get_by_role("button", name="Submit Update").click(); pg.wait_for_timeout(1000)
    sh = posts(reqs, "/staff/agent/requests/1/shared")
    check("...which records the share (channel, note, next action) - self-reported", len(sh) == 1 and sh[0].get("channel") == "whatsapp" and "WhatsApp" in sh[0].get("note", "") and sh[0].get("next_action") == "Call on Monday", sh)
    sub(pg, "Updates & Comments (4)", dr) or dr.get_by_role("tab", name="Updates & Comments", exact=False).first.click(); pg.wait_for_timeout(600)
    dr.get_by_test_id("add-status-update").click(); pg.wait_for_timeout(500)
    form = pg.get_by_test_id("add-update-form")
    types = form.get_by_label("Update type *").locator("option").all_inner_texts()
    check("the update types: progress, client feedback, shared, interested, revision, declined, acceptance", all(any(x in t for t in types) for x in ["General progress update", "Client feedback", "Quotation shared with client", "Client interested", "Revision requested", "Client declined", "Client acceptance reported"]), types)
    form.get_by_label("Update type *").select_option("accepted"); pg.wait_for_timeout(300)
    form.get_by_label("What happened *").fill("Client said yes on WhatsApp")
    check("a reported acceptance needs evidence and says Sales verifies it", form.get_by_role("button", name="Submit Update").is_disabled() and "Sales verifies it" in form.inner_text())
    form.get_by_label("Update type *").select_option("general"); pg.wait_for_timeout(300)
    form.get_by_label("What happened *").fill("Client is comparing with another agency")
    form.get_by_label("Follow-up date (optional)").fill("2026-11-06")
    reqs.clear(); form.get_by_role("button", name="Submit Update").click(); pg.wait_for_timeout(1000)
    up = posts(reqs, "/staff/agent/requests/1/events")
    check("a general update is an append-only event with the follow-up date", len(up) == 1 and up[0].get("kind") == "update" and "comparing" in up[0].get("body", "") and up[0].get("follow_up_on") == "2026-11-06", up)
    check("the agent sees no who-sees-it choice and no internal note", dr.get_by_role("radio", name="Internal only").count() == 0 and "deposit term" not in dr.inner_text())
    dr.get_by_label("Write a comment", exact=True).fill("Thank you, will update after the call")
    reqs.clear(); dr.get_by_role("button", name="Post").click(); pg.wait_for_timeout(900)
    rp = posts(reqs, "/staff/agent/requests/1/events")
    check("the agent replies to comments in their own request", len(rp) == 1 and rp[0].get("kind") == "comment", rp)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    panel.get_by_role("button", name="AGR-0002").filter(visible=True).first.click(); pg.wait_for_timeout(1200)
    dr = pg.get_by_test_id("agent-request-drawer")
    check("a More info request shows Sales' question and asks for the answer", "Which products?" in dr.inner_text() and pg.get_by_label("Your answer to Sales *").count() == 1)
    pg.get_by_label("Your answer to Sales *").fill("Bakery boxes and cakes")
    reqs.clear(); pg.get_by_role("button", name="Send the answer").click(); pg.wait_for_timeout(900)
    an = posts(reqs, "/staff/agent/requests/2", "PATCH")
    check("...the answer goes back to Sales", len(an) == 1 and an[0].get("submit") is True, an)
    check("no page errors (agent)", not errs, errs)
    ctx.close()

    # ---- an agent on a phone ----
    ctx, pg, errs, reqs = page(b, 4222, 390, 844)
    bar = [t.strip() for t in pg.locator(".erp-bottom-nav-item").all_inner_texts()]
    check("an agent's phone bar is Overview, Packages, Requests, Quotations (+ More) - no Tasks, Dashboard or On Shift", bar[:4] == ["Overview", "Packages", "Requests", "Quotations"] and not ({"Tasks", "Dashboard", "On Shift", "Desk"} & set(bar)), bar)
    pg.locator(".erp-bottom-nav-item", has_text="Requests").click(); pg.wait_for_timeout(1000)
    card = pg.get_by_test_id("agent-card-1")
    check("Requests on a phone are touch cards with the status and the latest update time", card.is_visible() and "Quotation ready" in card.inner_text() and "Updated" in card.inner_text() and pg.get_by_test_id("submit-client-request").is_visible())
    check("...the phone bar marks Requests", pg.locator(".erp-bottom-nav-item[aria-current='page']").inner_text().strip() == "Requests")
    check("...no sideways scroll", fits(pg))
    card.click(); pg.wait_for_timeout(1200)
    add = pg.get_by_test_id("add-status-update")
    check("on a phone the request opens with Add Status Update visible", add.is_visible() and fits(pg))
    add.click(); pg.wait_for_timeout(600)
    form = pg.get_by_test_id("add-update-form")
    form.get_by_label("What happened *").fill("Met the client at the expo")
    reqs.clear(); form.get_by_role("button", name="Submit Update").click(); pg.wait_for_timeout(1000)
    check("...and an update is submitted from the phone", len(posts(reqs, "/staff/agent/requests/1/events")) == 1 and fits(pg))
    check("no page errors (agent phone)", not errs, errs)
    ctx.close()

    # ---- an agent with nothing yet ----
    ctx, pg, errs, reqs = page(b, 4223, 390, 844)
    pg.locator(".erp-bottom-nav-item", has_text="Requests").click(); pg.wait_for_timeout(1000)
    em = pg.get_by_test_id("agent-empty")
    check("an agent with no requests sees the invitation and Submit Client Request", em.count() == 1 and "No client requests yet. Submit your first client request to get started." in em.inner_text() and em.get_by_test_id("submit-client-request").is_visible())
    ctx.close()

    # ---- management with nothing yet ----
    ctx, pg, errs, reqs = page(b, 4224)
    tab(pg, "Agents")
    em = pg.get_by_test_id("staff-empty")
    check("management with no submissions sees their own empty state with Manage Agent Access", em.count() == 1 and "No Agent submissions have been received yet." in em.inner_text() and em.get_by_role("button", name="Manage Agent Access").count() == 1)
    check("...never the agent's Submit button", pg.get_by_test_id("submit-client-request").count() == 0)
    sub(pg, "Agents")
    ae = pg.get_by_test_id("agents-empty")
    check("the Agents view says No active agents yet, with Manage Agent Access", ae.count() == 1 and "No active agents yet." in ae.inner_text() and ae.get_by_role("button", name="Manage Agent Access").count() == 1)
    ae.get_by_role("button", name="Manage Agent Access").click(); pg.wait_for_timeout(2000)
    check("Manage Agent Access opens Users > Customers & Agents, where access is given", pg.get_by_role("tab", name="Customers & Agents", selected=True).count() == 1 and pg.locator("[data-testid^='grant-agent-']").count() >= 1)
    ctx.close()

    # ---- the owner with agents ----
    ctx, pg, errs, reqs = page(b, 4191)
    tab(pg, "Agents")
    check("the owner has Manage Agent Access in the Agents header", pg.get_by_test_id("manage-agent-access").count() == 1)
    sub(pg, "Agents")
    zr = pg.get_by_test_id("agent-acct-9005").inner_text(); rr = pg.get_by_test_id("agent-acct-9006").inner_text()
    check("each agent shows the account, verified email, active or suspended, scope, requests and latest activity",
          "Zul Agent" in zr and "Verified email" in zr and "Active" in zr and "AZ ONE OFFICIAL" in zr and "2 requests" in zr and "Latest activity" in zr and "Suspended" in rr, zr)
    ctx.close()

    # ---- Sales & Marketing: read and comment ----
    ctx, pg, errs, reqs = page(b, 4182)
    check("Sales & Marketing have the Agents tab", tab(pg, "Agents"))
    panel = pg.get_by_test_id("agents-panel")
    t = panel.inner_text()
    check("they see every agent's request with the agent, Sales and the latest update", "Ros Agent" in t and "Zul Agent" in t and "Lina Spa" in t and "Client says yes" in t and "Draft Co" not in t, t[:400])
    check("...and no Manage Agent Access (only the owner gives access)", pg.get_by_test_id("manage-agent-access").count() == 0)
    panel.get_by_role("button", name="AGR-0003").filter(visible=True).first.click(); pg.wait_for_timeout(1200)
    dr = pg.get_by_test_id("agent-request-drawer")
    check("...read only for an unassigned salesperson (no Move to, no Verify)", "Move to" not in dr.inner_text() and dr.get_by_role("button", name="Record and verify").count() == 0)
    check("no page errors (sales)", not errs, errs)
    ctx.close()

    # ---- the CEO: handles requests ----
    ctx, pg, errs, reqs = page(b, 4177)
    tab(pg, "Agents")
    panel = pg.get_by_test_id("agents-panel")
    sub(pg, "Overview")
    ov = panel.inner_text()
    check("management's Overview shows the request statuses and overdue follow-ups", "Acceptance to verify" in ov and "Overdue follow-up" in ov, ov[:300])
    sub(pg, "Requests")
    panel.get_by_role("button", name="AGR-0003").filter(visible=True).first.click(); pg.wait_for_timeout(1200)
    dr = pg.get_by_test_id("agent-request-drawer")
    check("Verify needs who agreed and how - the quotation's own acceptance record", dr.get_by_role("button", name="Record and verify").count() == 1 and dr.get_by_role("button", name="Record and verify").is_disabled())
    dr.get_by_label("Who agreed").fill("Cik Lina")
    reqs.clear(); dr.get_by_role("button", name="Record and verify").click(); pg.wait_for_timeout(1500)
    acc = posts(reqs, "/staff/docs/1/acceptance"); ver = posts(reqs, "/staff/agent/requests/3/verify")
    check("...records the acceptance on the quotation, then verifies the request", len(acc) == 1 and acc[0].get("accepted_name") == "Cik Lina" and len(ver) == 1, (acc, ver))
    dr.get_by_role("tab", name="Files (1)").click(); pg.wait_for_timeout(500)
    check("the agent's evidence is in Files", "whatsapp-yes.png" in dr.inner_text())
    dr.get_by_role("tab", name="Updates & Comments", exact=False).first.click(); pg.wait_for_timeout(500)
    dt = dr.inner_text()
    check("management sees internal notes marked Internal", "deposit term" in dt and "Internal" in dt, dt[:300])
    check("management has no agent-only Add Status Update", dr.get_by_test_id("add-status-update").count() == 0)
    dr.get_by_label("Write a comment", exact=True).fill("Please send the signed order too")
    dr.get_by_role("radio", name="Agent can see").click()
    reqs.clear(); dr.get_by_role("button", name="Post").click(); pg.wait_for_timeout(900)
    cm = posts(reqs, "/staff/agent/requests/3/events")
    check("a comment says who sees it (here: the agent)", len(cm) == 1 and cm[0].get("visibility") == "agent" and cm[0].get("kind") == "comment", cm)
    dr.get_by_role("tab", name="Overview").click(); pg.wait_for_timeout(500)
    dr.get_by_role("button", name="New quotation in Sales").click(); pg.wait_for_timeout(3000)
    check("Create quotation in Sales opens Sales' own form, prefilled with the request reference", pg.evaluate("[...document.querySelectorAll('input')].some(i => i.value === 'AGR-0003')"), pg.url)
    check("no page errors (CEO)", not errs, errs)
    ctx.close()

    # ---- other staff ----
    ctx, pg, errs, reqs = page(b, 4180)
    check("a live host has no Agents tab", "Agents" not in set(rail(pg)) and not tab(pg, "Agents"))
    ctx.close()
    # v1.254.1 - the agent's own name is the header title, 'A2Z agent' beside it
    for w in [1440, 390, 320]:
        ctx, pg, errs, _ = page(b, 4222, w=w, h=900)
        tid = "agent-name" if w > 500 else "agent-name-phone"
        t = pg.get_by_test_id(tid)
        top = pg.locator("header.erp-topbar").inner_text()
        check(f"{w}px: the header shows the agent's own name, not the word Agents", t.count() == 1 and t.is_visible() and t.inner_text().strip() == "Fixture Person" and "a2z agent" in top.lower() and "Agents" not in top.replace("A2Z agent", ""), top[:120])
        check(f"{w}px: the header fits", pg.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"))
        ctx.close()
    ctx, pg, errs, _ = page(b, 4177, w=390, h=900)
    check("staff headers are unchanged (no agent name line)", pg.get_by_test_id("agent-name-phone").count() == 0)
    ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"agents: {passed} of {len(results)} passed")
raise SystemExit(0 if passed == len(results) else 1)

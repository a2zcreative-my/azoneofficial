"""v1.351.0 - the public Partner Interest Application and its home in Agents ->
Requests, on screen.
v1.354.0 - STAFF ONLY, per role: Sales picks up, contacts and shortlists; the
COO and the CCO pre-approve, return or reject; the CEO alone approves and
activates; an external agent sees nothing. The bell opens the exact application.

Servers: ROLE=ceo OWNER=1 on 4320, ROLE=sales_marketing on 4340, ROLE=editor
on 4341, ROLE=coo on 4342, ROLE=cco on 4343, ROLE=agent on 4344 (serve.mjs over out/). The fixture (partner-fixture.mjs) keeps what the
browser posts; the worker's own rules - one record, no account, the claim lock,
the approval - are proven by tests/partner-applications.mjs.

SHOTS=dir writes the screenshots the brief asks for."""
import json, os, re
from playwright.sync_api import sync_playwright

SHOTS = os.environ.get("SHOTS", "")
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def shot(pg, name, full=True):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name), full_page=full)

def fits(pg):
    return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def ctx_page(b, port, w, h, path):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(1800)
    return ctx, pg, errs, reqs

def t(pg, id_): return pg.get_by_test_id(id_)

def step1(pg):
    t(pg, "pa-full_name").fill("Siti Nurhaliza Test")
    t(pg, "pa-gender-female").click()
    t(pg, "pa-age_range").select_option(index=2)
    t(pg, "pa-phone").fill("12 345 6789")
    t(pg, "pa-email").fill("siti.partner@example.test")
    t(pg, "pa-location").select_option("johor")
    t(pg, "pa-contact_method").select_option("whatsapp")
    t(pg, "pa-best_time").select_option(index=2)

def step2(pg):
    t(pg, "pa-referred_before-yes").click()
    t(pg, "pa-intro_per_week").select_option(index=3)
    t(pg, "pa-customer_groups-sme").click()
    t(pg, "pa-lead_channels-personal").click()
    t(pg, "pa-approach").fill("I introduce SME owners from my business association, with their permission.")

def step3(pg):
    t(pg, "pa-time_available-2-5").click()
    t(pg, "pa-screening_window").select_option(index=2)
    for k in ("ack_independent", "ack_terms", "privacy_ack"): t(pg, f"pa-{k}").check()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    import urllib.request
    urllib.request.urlopen("http://127.0.0.1:4320/__partners-reset").read()

    # ---------- the public form, desktop ----------
    ctx, pg, errs, reqs = ctx_page(b, 4320, 1440, 1000, "/apply/partner?utm_source=facebook&utm_medium=paid_social&utm_campaign=partner_nov")
    check("form: opens with no sign-in", t(pg, "partner-application").count() == 1 and "/login" not in pg.url, pg.url)
    check("form: no sidebar / portal shell", pg.locator(".erp-rail, .erp-bottom-nav, nav[aria-label='Portal']").count() == 0)
    check("form: no WhatsApp bubble on /apply", pg.locator("[data-testid='whatsapp-fab'], a[href*='wa.me'][aria-label*='WhatsApp']").count() == 0)
    check("form: step 1 shown first", t(pg, "pa-step-1").is_visible() and not t(pg, "pa-step-2").is_visible())
    check("form: 12 recruitment sources", pg.locator("[data-testid^='pa-source-']").filter(has_not=pg.locator("input")).count() >= 12)
    shot(pg, "partner-step1-desktop.png")
    t(pg, "pa-continue").click(); pg.wait_for_timeout(300)
    check("validation: Continue with nothing filled stays on step 1", t(pg, "pa-step-1").is_visible())
    check("validation: errors are announced", pg.locator("[id^='err-']").count() >= 5, pg.locator("[id^='err-']").count())
    step1(pg)
    t(pg, "pa-continue").click(); pg.wait_for_timeout(300)
    check("validation: a source is required", t(pg, "pa-step-1").is_visible() and pg.locator("#err-source").count() == 1)
    t(pg, "pa-source-referral").click()
    check("source: Referral asks for a short description", t(pg, "pa-source_detail").is_visible())
    t(pg, "pa-source_detail").fill("A friend from my business association")
    t(pg, "pa-continue").click(); pg.wait_for_timeout(400)
    check("step 2 after a valid step 1", t(pg, "pa-step-2").is_visible())
    check("step 2: no CV or salary question", pg.locator("input[type=file]").count() == 0 and "salary" not in pg.inner_text("body").lower())
    step2(pg)
    shot(pg, "partner-step2-desktop.png")
    t(pg, "pa-back").click(); pg.wait_for_timeout(300)
    check("Back keeps the answers", t(pg, "pa-full_name").input_value() == "Siti Nurhaliza Test" and t(pg, "pa-source_detail").input_value().startswith("A friend"))
    t(pg, "pa-continue").click(); pg.wait_for_timeout(300)
    check("Continue again keeps step 2", t(pg, "pa-approach").input_value().startswith("I introduce"))
    t(pg, "pa-continue").click(); pg.wait_for_timeout(400)
    check("step 3", t(pg, "pa-step-3").is_visible())
    check("step 3: button says Submit for Screening", "Submit for Screening" in t(pg, "pa-submit").inner_text())
    t(pg, "pa-submit").click(); pg.wait_for_timeout(400)
    check("validation: the privacy notice is required", t(pg, "pa-step-3").is_visible() and pg.locator("#err-privacy_ack, [data-invalid='true']").count() >= 1)
    step3(pg)
    shot(pg, "partner-step3-desktop.png")
    t(pg, "pa-submit").click(); pg.wait_for_timeout(1500)
    check("submit: confirmation with a reference", t(pg, "pa-done").is_visible() and t(pg, "pa-ref").inner_text().startswith("AGT-APP-"), pg.inner_text("body")[:300])
    shot(pg, "partner-confirmation-desktop.png")
    sent = [json.loads(r[2] or "{}") for r in reqs if r[0] == "POST" and "/public/partner-applications" in r[1]]
    check("submit: one POST", len(sent) == 1, len(sent))
    body = sent[0] if sent else {}
    check("posted: phone normalised client side or raw", "345" in body.get("phone", ""), body.get("phone"))
    check("posted: UTM captured separately", body.get("utm", {}).get("campaign") == "partner_nov" and body.get("utm", {}).get("source") == "facebook", body.get("utm"))
    check("posted: a client key for retries", len(str(body.get("client_key", ""))) >= 16)
    check("posted: source + detail", body.get("source") == "referral" and body.get("source_detail", "").startswith("A friend"))
    check("posted: no password / role / account field", not any(k in body for k in ("password", "role", "user_id", "account")))
    check("posted: marketing consent optional and off", body.get("marketing_opt_in") in (False, 0, None))
    check("desktop: no sideways scroll", fits(pg))
    check("desktop: no page error", not errs, errs)
    ctx.close()

    # ---------- the public form, phone + BM ----------
    ctx, pg, errs, reqs = ctx_page(b, 4320, 390, 844, "/apply/partner")
    pg.evaluate("sessionStorage.clear()"); pg.reload(); pg.wait_for_timeout(1500)
    check("phone: step 1 fits 390px", fits(pg), pg.evaluate("document.documentElement.scrollWidth"))
    check("phone: inputs are 16px (no iOS zoom)", pg.evaluate("parseFloat(getComputedStyle(document.querySelector('[data-testid=pa-full_name]')).fontSize)") >= 16)
    shot(pg, "partner-step1-phone.png")
    t(pg, "pa-lang-ms").click(); pg.wait_for_timeout(400)
    check("BM: the form switches language", "Teruskan" in t(pg, "pa-continue").inner_text() or "Seterusnya" in t(pg, "pa-continue").inner_text(), t(pg, "pa-continue").inner_text())
    shot(pg, "partner-step1-phone-bm.png")
    t(pg, "pa-lang-en").click(); pg.wait_for_timeout(300)
    step1(pg); t(pg, "pa-source-tiktok").click(); t(pg, "pa-continue").click(); pg.wait_for_timeout(400)
    check("phone: step 2 fits", t(pg, "pa-step-2").is_visible() and fits(pg))
    step2(pg); shot(pg, "partner-step2-phone.png")
    t(pg, "pa-continue").click(); pg.wait_for_timeout(400)
    step3(pg)
    check("phone: step 3 fits", t(pg, "pa-step-3").is_visible() and fits(pg))
    shot(pg, "partner-step3-phone.png")
    t(pg, "pa-submit").click(); pg.wait_for_timeout(1500)
    check("phone: confirmation", t(pg, "pa-done").is_visible())
    shot(pg, "partner-confirmation-phone.png")
    check("phone: no page error", not errs, errs)
    ctx.close()

    st = json.loads(urllib.request.urlopen("http://127.0.0.1:4320/__partners").read())
    check("fixture: two new applications landed", len(st["apps"]) == 10, len(st["apps"]))

    # ---------- staff: Agents -> Requests -> Partner Applications ----------
    def reset(port): urllib.request.urlopen(f"http://127.0.0.1:{port}/__partners-reset").read()
    def state(port): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/__partners").read())
    def app_of(port, i): return next(a for a in state(port)["apps"] if a["id"] == i)
    def requests_tab(pg):
        pg.get_by_test_id("agents-tab-requests").click(); pg.wait_for_timeout(600)
    def partners(pg):
        requests_tab(pg)
        pg.get_by_role("button", name="Partner Applications").filter(visible=True).first.click(); pg.wait_for_timeout(800)
    def select(pg, name):
        t(pg, "partner-table").get_by_text(name, exact=True).first.click(); pg.wait_for_timeout(1000)
    def reason(pg, text):
        dlg = pg.get_by_role("dialog").filter(visible=True).last
        dlg.locator("textarea, input").first.fill(text)
        dlg.get_by_role("button").filter(has_not_text="Cancel").last.click(); pg.wait_for_timeout(1000)
    def quick(pg): return [x.strip() for x in t(pg, "partner-quick").locator("button").all_inner_texts()]
    def agents_page(port, w=1440, h=900):
        return ctx_page(b, port, w, h, "/portal?tab=Agents")

    # --- Overview, the pipeline and Conversion Performance are unchanged; recruitment is not on them
    ctx, pg, errs, reqs = agents_page(4320)
    ov = pg.get_by_test_id("agents-overview")
    check("overview: no recruitment panel, no partner figures", "Partner" not in ov.inner_text() and t(pg, "partner-strip").count() == 0)
    check("overview: Conversion Performance has its original columns", "Verified paid" not in ov.inner_text() and "Quotations" not in ov.locator("thead").first.inner_text() if ov.locator("thead").count() else True)
    check("tabs: Overview, Requests, Agents, Packages - nothing added", [x.strip().split("\n")[0] for x in t(pg, "agents-tab-overview").locator("xpath=..").locator("[role=tab]").all_inner_texts()] == ["Overview", "Requests", "Agents", "Packages"])
    requests_tab(pg)
    check("requests: Client Requests still the default", t(pg, "requests-inbox").is_visible() and t(pg, "partner-split").count() == 0)
    check("requests: the selector Client Requests | Partner Applications", t(pg, "request-type").is_visible())
    partners(pg)
    check("partner view: status row in the picture's order", [x.split(" (")[0] for x in t(pg, "partner-tab-all").locator("xpath=..").locator("[role=tab]").all_inner_texts()] == ["All Requests", "New", "Assigned", "Screening", "Shortlisted", "Pre-Approved", "Approved", "Rejected"])
    heads = [x.strip() for x in t(pg, "partner-table").locator("thead th").all_inner_texts()]
    check("partner view: Ref. ID, Name, Source, Status, Assigned To, Submitted", heads[:6] == ["Ref. ID", "Name", "Source", "Status", "Assigned To", "Submitted"], heads)
    check("partner view: AGT-APP references", "AGT-APP-1008" in t(pg, "partner-table").inner_text())
    check("partner view: the status definitions beside the list", t(pg, "partner-defs").is_visible() and "waiting for the CEO" in t(pg, "partner-defs").inner_text())
    t(pg, "partner-tab-pre_approved").click(); pg.wait_for_timeout(300)
    check("status tab filters", t(pg, "partner-table").locator("tbody tr").count() == 1)
    t(pg, "partner-tab-all").click(); pg.wait_for_timeout(300)
    check("desktop: no sideways scroll", fits(pg))
    shot(pg, "partner-requests-ceo.png", full=False)
    # the CEO: final decision on a pre-approved one only
    select(pg, "Nadia Salleh")
    check("CEO on Shortlisted: no Pre-Approve (that is the COO's / CCO's)", t(pg, "partner-quick-preapprove").count() == 0 and t(pg, "partner-quick-approve").count() == 0, quick(pg))
    select(pg, "Faizal Karim")
    check("CEO on Pre-Approved: Approve, Return, Reject", all(t(pg, f"partner-quick-{k}").is_visible() for k in ("approve", "return", "reject")), quick(pg))
    shot(pg, "partner-preview-ceo.png", full=False)
    t(pg, "partner-quick-approve").click(); pg.wait_for_timeout(400); reason(pg, "Strong network, the COO's pre-approval stands")
    check("CEO approves: recorded, not activated", app_of(4320, 4)["status"] == "approved" and not app_of(4320, 4)["activated_at"])
    check("CEO then sees Activate as a separate step", t(pg, "partner-quick-activate").is_visible())
    t(pg, "partner-quick-activate").click(); pg.wait_for_timeout(1000)
    check("activate: the drawer opens on the activation form", t(pg, "partner-activate-form").is_visible())
    check("activate: needs account, salesperson and agreement", t(pg, "partner-activate-save").is_disabled())
    t(pg, "partner-agent-account").select_option("9105"); pg.wait_for_timeout(200)
    check("activate: the responsible salesperson is shown", "Hafiz Rahman" in t(pg, "partner-salesperson").inner_text())
    t(pg, "partner-agreement-note").fill("Signed copy in the HR cabinet")
    shot(pg, "partner-activate-ceo.png", full=False)
    t(pg, "partner-activate-save").click(); pg.wait_for_timeout(1200)
    check("CEO activates: recorded", app_of(4320, 4)["status"] == "activated")
    check("CEO: no page error", not errs, errs)
    ctx.close()

    # --- the bell opens the exact application (CEO)
    reset(4320)
    ctx, pg, errs, reqs = ctx_page(b, 4320, 1440, 900, "/portal?tab=Dashboard")
    pg.get_by_role("button", name=re.compile("^Notifications")).first.click(); pg.wait_for_timeout(800)
    item = pg.get_by_text(re.compile("AGT-APP-1004.*final decision")).first
    check("bell: the CEO is asked for the final decision", item.is_visible())
    shot(pg, "partner-bell-ceo.png", full=False)
    item.click(); pg.wait_for_timeout(2200)
    check("bell: opens Agents > Requests > Partner Applications on that application", t(pg, "partner-preview").is_visible() and "AGT-APP-1004" in t(pg, "partner-preview").inner_text(), pg.url)
    shot(pg, "partner-bell-opened.png", full=False)
    ctx.close()

    # --- Sales / agent staff: Pick Up, Contact, Add Note, Shortlist - and nothing above that
    reset(4340)
    ctx, pg, errs, reqs = agents_page(4340); partners(pg)
    select(pg, "Danial Hakim")
    check("Sales: Pick Up on a new one", t(pg, "partner-pickup").is_visible())
    shot(pg, "partner-preview-sales.png", full=False)
    t(pg, "partner-pickup").click(); pg.wait_for_timeout(1200)
    check("Sales: picked up - owner and Assigned", app_of(4340, 8)["owner_id"] == 9001 and app_of(4340, 8)["status"] == "assigned")
    r = pg.evaluate("""async () => { const x = await fetch('/api/v1/staff/partner-applications/8/pickup', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({version: 1})}); return [x.status, await x.text()]; }""")
    check("double claim: a second Pick Up is refused", r[0] == 409, r)
    check("Sales: Shortlist waits for a recorded contact", t(pg, "partner-quick-shortlist").count() == 0 and "Record a contact" in t(pg, "partner-quick").inner_text())
    t(pg, "partner-contact").click(); pg.wait_for_timeout(1000)
    t(pg, "partner-contact-note").fill("WhatsApp sent, screening call booked for Thursday"); t(pg, "partner-contact-save").click(); pg.wait_for_timeout(1200)
    check("Sales: contact recorded - Screening", app_of(4340, 8)["status"] == "screening" and app_of(4340, 8)["first_response_at"])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    select(pg, "Danial Hakim")
    t(pg, "partner-quick-shortlist").click(); pg.wait_for_timeout(400); reason(pg, "Three SME introductions a week, clear approach")
    check("Sales: shortlisted for management review", app_of(4340, 8)["status"] == "shortlisted")
    check("Sales: no Pre-Approve, Approve or Activate anywhere", all(t(pg, f"partner-quick-{k}").count() == 0 for k in ("preapprove", "approve", "activate")), quick(pg))
    r = pg.evaluate("""async () => { const x = await fetch('/api/v1/staff/partner-applications/8/preapprove', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({version: 4, decision:'preapprove', reason:'Self approving'})}); return x.status; }""")
    check("Sales: pre-approve by direct request is refused", r == 403, r)
    check("Sales: no page error", not errs, errs)
    ctx.close()

    # --- COO and CCO: pre-approve, return or reject a shortlisted one; never the final approval
    for port, who in ((4342, "COO"), (4343, "CCO")):
        reset(port)
        ctx, pg, errs, reqs = agents_page(port); partners(pg)
        select(pg, "Faizal Karim")
        check(f"{who} on Pre-Approved: no final approval", t(pg, "partner-quick-approve").count() == 0 and "waiting for the CEO" in t(pg, "partner-quick").inner_text(), quick(pg))
        select(pg, "Nadia Salleh")
        check(f"{who} on Shortlisted: Pre-Approve, Return, Reject", all(t(pg, f"partner-quick-{k}").is_visible() for k in ("preapprove", "return", "reject")), quick(pg))
        if who == "COO": shot(pg, "partner-preview-coo.png", full=False)
        r = pg.evaluate("""async () => { const x = await fetch('/api/v1/staff/partner-applications/4/approve', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({version: 6, decision:'approve', reason:'Final from the COO'})}); return x.status; }""")
        check(f"{who}: the final approval by direct request is refused", r == 403, r)
        if who == "COO":
            t(pg, "partner-quick-preapprove").click(); pg.wait_for_timeout(400); reason(pg, "Eligible: network and availability confirmed")
            check("COO pre-approves - it now waits for the CEO", app_of(port, 5)["preapproved_at"] and app_of(port, 5)["status"] == "shortlisted")
        else:
            t(pg, "partner-quick-return").click(); pg.wait_for_timeout(400); reason(pg, "Ask about their referral pipeline first")
            check("CCO returns it to screening with the reason", app_of(port, 5)["status"] == "screening")
        check(f"{who}: no page error", not errs, errs)
        ctx.close()
    # the COO's bell
    ctx, pg, errs, reqs = ctx_page(b, 4342, 1440, 900, "/portal?tab=Dashboard")
    pg.get_by_role("button", name=re.compile("^Notifications")).first.click(); pg.wait_for_timeout(800)
    check("bell: the COO is asked to pre-approve", pg.get_by_text(re.compile("AGT-APP-1005.*pre-approval")).first.is_visible())
    check("bell: the COO is not asked for the CEO's decision", pg.get_by_text(re.compile("final decision")).count() == 0)
    ctx.close()

    # --- an external agent: nothing - no view, no switch, no data, no notice
    ctx, pg, errs, reqs = ctx_page(b, 4344, 1440, 900, "/portal?tab=Agents")
    body = pg.inner_text("body")
    check("agent: no Partner Applications switch or list", t(pg, "request-type").count() == 0 and t(pg, "partner-inbox").count() == 0 and "Partner Applications" not in body)
    check("agent: no applicant data in the page", "AGT-APP" not in body and "Danial Hakim" not in body)
    check("agent: the screen never asked for applications", not any("/partner-applications" in r[1] for r in reqs))
    for path, method in (("/api/v1/staff/partner-applications", "GET"), ("/api/v1/staff/partner-applications/8", "GET"), ("/api/v1/staff/partner-applications/8/pickup", "POST"), ("/api/v1/staff/partner-applications/4/approve", "POST")):
        r = pg.evaluate("""async ([p, m]) => { const x = await fetch(p, {method: m, headers:{'content-type':'application/json'}, body: m === 'POST' ? JSON.stringify({version: 1, decision:'approve', reason:'Agent approving'}) : undefined}); return [x.status, await x.text()]; }""", [path, method])
        check(f"agent: {method} {path.replace('/api/v1/staff', '')} refused", r[0] == 403 and "AGT-APP" not in r[1], r)
    pg.goto("http://127.0.0.1:4344/portal?tab=Agents&view=requests&type=partners"); pg.wait_for_timeout(2000)
    check("agent: a crafted link shows nothing either", t(pg, "partner-inbox").count() == 0 and "AGT-APP" not in pg.inner_text("body"))
    pg.get_by_role("button", name=re.compile("^Notifications")).first.click(); pg.wait_for_timeout(800)
    check("agent: no recruitment notification", "partner application" not in pg.inner_text("body").lower())
    shot(pg, "partner-agent-view.png", full=False)
    ctx.close()

    # --- a role without the permission (editor): no switch
    ctx, pg, errs, reqs = ctx_page(b, 4341, 1440, 900, "/portal?tab=Agents")
    check("editor: no partner applications shown", t(pg, "partner-inbox").count() == 0)
    ctx.close()

    # --- phone (Sales): the list fits; choosing one opens the full application
    reset(4340)
    ctx, pg, errs, reqs = agents_page(4340, 390, 844); partners(pg)
    check("phone: the partner view fits 390px", fits(pg), pg.evaluate("document.documentElement.scrollWidth"))
    shot(pg, "partner-requests-phone.png", full=False)
    t(pg, "partner-table").get_by_text("Danial Hakim").first.click(); pg.wait_for_timeout(1300)
    check("phone: choosing one opens the full application", t(pg, "partner-drawer").is_visible())
    shot(pg, "partner-drawer-phone.png", full=False)
    ctx.close()
    b.close()

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} passed")
raise SystemExit(1 if bad else 0)

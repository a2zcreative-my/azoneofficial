"""v1.351.0 - the public Partner Interest Application and its home in Agents ->
Requests, on screen.

Servers: ROLE=ceo OWNER=1 on 4320, ROLE=sales_marketing on 4340, ROLE=editor
on 4341 (serve.mjs over out/). The fixture (partner-fixture.mjs) keeps what the
browser posts; the worker's own rules - one record, no account, the claim lock,
the approval - are proven by tests/partner-applications.mjs.

SHOTS=dir writes the screenshots the brief asks for."""
import json, os
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
    check("submit: confirmation with a reference", t(pg, "pa-done").is_visible() and t(pg, "pa-ref").inner_text().startswith("PIA-"), pg.inner_text("body")[:300])
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
    check("fixture: two new applications landed", len(st["apps"]) == 6, len(st["apps"]))

    # ---------- staff: Agents -> Requests -> Partner Applications ----------
    urllib.request.urlopen("http://127.0.0.1:4340/__partners-reset").read()
    ctx, pg, errs, reqs = ctx_page(b, 4340, 1440, 900, "/portal?tab=Agents")
    pg.wait_for_timeout(1500)
    rq = pg.get_by_role("tab", name="Requests").filter(visible=True)
    if rq.count() == 0: rq = pg.get_by_role("button", name="Requests").filter(visible=True)
    rq.first.click(); pg.wait_for_timeout(900)
    check("staff: request-type switch present", t(pg, "request-type").count() == 1)
    check("staff: client requests still default", t(pg, "partner-split").count() == 0 or not t(pg, "partner-split").is_visible())
    pg.get_by_role("button", name="Partner Applications").filter(visible=True).first.click(); pg.wait_for_timeout(900)
    check("staff: partner list beside the workflow", t(pg, "partner-inbox").is_visible() and t(pg, "partner-workflow").is_visible())
    check("staff: 4 applications listed", t(pg, "partner-table").locator("tbody tr").count() == 4, t(pg, "partner-table").locator("tbody tr").count())
    check("staff: source, age range, contact shown", all(x in t(pg, "partner-table").inner_text() for x in ("Facebook", "25-34", "+60123456789")))
    check("staff desktop: no sideways scroll", fits(pg))
    shot(pg, "partner-requests-desktop.png", full=False)
    t(pg, "partner-flow-3").click(); pg.wait_for_timeout(300)
    check("workflow: a step filters the list", t(pg, "partner-table").locator("tbody tr").count() == 1)
    t(pg, "partner-flow-3").click(); pg.wait_for_timeout(300)
    pg.get_by_text("Aina Rahman").first.click(); pg.wait_for_timeout(1200)
    check("drawer: opens", t(pg, "partner-drawer").is_visible())
    check("drawer: Pick Up offered for a new one", t(pg, "partner-pickup").is_visible())
    check("drawer: sales cannot approve", t(pg, "partner-approve").count() == 0)
    shot(pg, "partner-drawer-desktop.png", full=False)
    t(pg, "partner-pickup").click(); pg.wait_for_timeout(1200)
    check("pick up: then Contact is offered", t(pg, "partner-contact").is_visible())
    t(pg, "partner-contact").click(); t(pg, "partner-contact-note").fill("WhatsApp sent, call booked for Thursday"); t(pg, "partner-contact-save").click(); pg.wait_for_timeout(1200)
    st = json.loads(urllib.request.urlopen("http://127.0.0.1:4340/__partners").read())
    a1 = next(a for a in st["apps"] if a["id"] == 1)
    check("contact: application moved to screening with first response", a1["status"] == "screening" and a1["first_response_at"], a1)
    pk = [json.loads(r[2] or "{}") for r in reqs if r[0] == "POST" and r[1].endswith("/1/pickup")]
    check("pick up: sent with its version (no double claim)", pk and pk[0].get("version") == 1, pk)
    # a second press (another tab, a retry) on an application already claimed is told
    r = pg.evaluate("""async () => { const x = await fetch('/api/v1/staff/partner-applications/1/pickup', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({version: 1})}); return [x.status, await x.text()]; }""")
    check("double claim: the second Pick Up is refused", r[0] == 409, r)
    check("staff: no page error", not errs, errs)
    ctx.close()

    # a second person claiming the same one is told
    ctx, pg, errs, reqs = ctx_page(b, 4320, 1440, 900, "/portal?tab=Agents")
    # the CEO approves the shortlisted one
    pg.evaluate("history.replaceState(null,'','/portal?tab=Agents')")
    rq = pg.get_by_role("tab", name="Requests").filter(visible=True)
    if rq.count() == 0: rq = pg.get_by_role("button", name="Requests").filter(visible=True)
    rq.first.click(); pg.wait_for_timeout(700)
    pg.get_by_role("button", name="Partner Applications").filter(visible=True).first.click(); pg.wait_for_timeout(800)
    pg.get_by_text("Mei Ling Tan").first.click(); pg.wait_for_timeout(1200)
    check("CEO: Approve (final) offered on a shortlisted one", t(pg, "partner-approve").is_visible())
    check("CEO: Activate not offered before approval", t(pg, "partner-activate").count() == 0)
    t(pg, "partner-approve").click(); pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog").filter(visible=True).last
    dlg.locator("textarea, input").first.fill("Strong SME network, screening call went well")
    dlg.get_by_role("button", name="OK").or_(dlg.get_by_role("button", name="Confirm")).or_(dlg.get_by_role("button", name="Save")).first.click(); pg.wait_for_timeout(1400)
    st = json.loads(urllib.request.urlopen("http://127.0.0.1:4320/__partners").read())
    a3 = next(a for a in st["apps"] if a["id"] == 3)
    check("approve: recorded, not activated", a3["status"] == "approved" and not a3.get("activated_at"), a3["status"])
    check("approve: Activate now offered as a separate step", t(pg, "partner-activate").is_visible())
    t(pg, "partner-activate").click(); pg.wait_for_timeout(400)
    check("activate: needs an Agent account + agreement", t(pg, "partner-activate-save").is_disabled())
    shot(pg, "partner-activate-desktop.png", full=False)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    ov = pg.get_by_role("tab", name="Overview").filter(visible=True)
    if ov.count() == 0: ov = pg.get_by_role("button", name="Overview").filter(visible=True)
    ov.first.click(); pg.wait_for_timeout(900)
    check("overview: partner recruitment strip", t(pg, "partner-strip").is_visible())
    check("overview: by source + campaign", t(pg, "partner-by-source").is_visible() and t(pg, "partner-by-campaign").is_visible())
    check("overview: no sideways scroll", fits(pg))
    t(pg, "partner-overview").scroll_into_view_if_needed(); shot(pg, "partner-overview-desktop.png", full=False)
    check("CEO: no page error", not errs, errs)
    ctx.close()

    # phone, staff side
    ctx, pg, errs, reqs = ctx_page(b, 4340, 390, 844, "/portal?tab=Agents")
    rq = pg.get_by_role("tab", name="Requests").filter(visible=True)
    if rq.count(): rq.first.click(); pg.wait_for_timeout(700)
    pt = pg.get_by_role("button", name="Partner Applications").filter(visible=True)
    if pt.count(): pt.first.click(); pg.wait_for_timeout(800)
    check("staff phone: partner list fits 390px", t(pg, "partner-inbox").count() == 1 and fits(pg), pg.evaluate("document.documentElement.scrollWidth"))
    shot(pg, "partner-requests-phone.png", full=False)
    ctx.close()

    # a role without the view gets no partner switch
    ctx, pg, errs, reqs = ctx_page(b, 4341, 1440, 900, "/portal?tab=Agents")
    check("editor: no partner applications shown", t(pg, "partner-inbox").count() == 0)
    ctx.close()
    b.close()

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} passed")
raise SystemExit(1 if bad else 0)

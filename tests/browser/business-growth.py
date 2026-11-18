"""v1.369.0 - the public A2Z Business Growth Check and its home in Sales ->
Customers & Follow-ups, on screen.

Servers (serve.mjs over out/): ROLE=ceo OWNER=1 GROWTH=1 on 4360,
ROLE=sales_marketing GROWTH=1 on 4361, ROLE=editor on 4362, ROLE=agent on 4363.
The fixture (growth-fixture.mjs) keeps what the browser posts; the worker's own
rules - one enquiry, no account / customer / sale, the claim lock, the same
WhatsApp added to the open enquiry, Qualified is not a sale - are proven by
tests/business-growth.mjs.

SHOTS=dir writes the screenshots the brief asks for."""
import json, os, re, urllib.request, urllib.parse
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

def ctx_page(b, port, w, h, path, lang=None):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
    if lang: ctx.add_init_script(f"try {{ localStorage.setItem('azone-lang', '{lang}') }} catch (e) {{}}")
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.goto(f"http://127.0.0.1:{port}{path}"); pg.wait_for_timeout(1800)
    return ctx, pg, errs, reqs

def t(pg, id_): return pg.get_by_test_id(id_)
def reset(port): urllib.request.urlopen(f"http://127.0.0.1:{port}/__growth-reset").read()
def state(port): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/__growth").read())
def row_of(port, i): return next(a for a in state(port)["rows"] if a["id"] == i)

def step1(pg, phone="12 345 6789"):
    t(pg, "bg-full_name").fill("Siti Aminah")
    t(pg, "bg-phone").fill(phone)
    t(pg, "bg-business_name").fill("Aminah Kek & Pastri")
    t(pg, "bg-industry").select_option("food_beverage")
    t(pg, "bg-city").fill("Johor Bahru")
    t(pg, "bg-state").select_option("johor")

def step2(pg):
    for c in ("low_sales", "content", "social_reach"): t(pg, f"bg-challenges-{c}").click()
    t(pg, "bg-urgent_problem").fill("Jualan menurun sejak dua bulan lepas dan kami tidak pasti puncanya.")
    t(pg, "bg-goal_90d").fill("Tiga puluh pelanggan baharu sebulan daripada Instagram dan TikTok.")
    t(pg, "bg-platforms-instagram").click(); t(pg, "bg-platforms-whatsapp").click()
    t(pg, "bg-interests-ai_video").click()

def step3(pg):
    t(pg, "bg-contact_time").select_option("evening")
    t(pg, "bg-consent_contact").check(); t(pg, "bg-consent_privacy").check()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    reset(4360)

    # ---------- the public form, desktop, Bahasa Malaysia first ----------
    ctx, pg, errs, reqs = ctx_page(b, 4360, 1440, 1000, "/apply/business?utm_source=facebook&utm_medium=paid_social&utm_campaign=growth_nov")
    pg.evaluate("localStorage.removeItem('azone-lang'); sessionStorage.clear()"); pg.reload(); pg.wait_for_timeout(1500)
    check("form: opens with no sign-in", t(pg, "business-growth-check").count() == 1 and "/login" not in pg.url, pg.url)
    check("form: no sidebar / portal shell", pg.locator(".erp-rail, .erp-bottom-nav, nav[aria-label='Portal']").count() == 0)
    check("form: the CEO's headline, in BM first", "Kenal Pasti Cabaran Bisnes Anda" in pg.inner_text("h1") and "PERCUMA" in pg.inner_text("h1"), pg.inner_text("h1"))
    check("form: three steps", pg.locator("[data-testid=bg-stepper] li").count() == 3)
    check("form: step 1 shown first", t(pg, "bg-step-1").is_visible() and t(pg, "bg-step-2").count() == 0)
    check("form: twelve discovery sources", pg.locator("[data-testid^='bg-source-']").filter(has_not=pg.locator("input")).count() == 12)
    check("form: email and social are optional", "(pilihan)" in pg.locator("label[for=bg-email]").inner_text() and "(pilihan)" in pg.locator("label[for=bg-social]").inner_text())
    shot(pg, "growth-step1-desktop-bm.png")
    t(pg, "bg-continue").click(); pg.wait_for_timeout(300)
    check("validation: Continue with nothing filled stays on step 1", t(pg, "bg-step-1").is_visible())
    errs_shown = pg.locator("[id^='err-']").count()
    check("validation: name, WhatsApp, business, industry, city, state and source are required", errs_shown >= 7, errs_shown)
    check("validation: email is not required", pg.locator("#err-email").count() == 0)
    shot(pg, "growth-step1-validation.png")
    step1(pg)
    t(pg, "bg-source-tiktok").click()
    t(pg, "bg-continue").click(); pg.wait_for_timeout(400)
    check("step 2 after a valid step 1", t(pg, "bg-step-2").is_visible())
    step2(pg)
    check("step 2: at most three challenges - the rest cannot be chosen", t(pg, "bg-challenges-competition").is_disabled() and "3" in t(pg, "bg-challenge-count").inner_text(), t(pg, "bg-challenge-count").inner_text())
    t(pg, "bg-challenges-content").click()
    check("step 2: un-choosing one frees the others", not t(pg, "bg-challenges-competition").is_disabled())
    t(pg, "bg-challenges-content").click()
    t(pg, "bg-platforms-none").click()
    check("step 2: 'None yet' clears the other platforms", t(pg, "bg-platforms-none").get_attribute("aria-pressed") == "true" and t(pg, "bg-platforms-instagram").get_attribute("aria-pressed") == "false")
    t(pg, "bg-platforms-instagram").click(); t(pg, "bg-platforms-whatsapp").click()
    check("step 2: no budget question and nothing to buy", "bajet anda" not in pg.inner_text("body").lower() and pg.locator("input[type=number]").count() == 0)
    shot(pg, "growth-step2-desktop-bm.png")
    t(pg, "bg-back").click(); pg.wait_for_timeout(300)
    check("Back keeps the answers", t(pg, "bg-business_name").input_value() == "Aminah Kek & Pastri")
    t(pg, "bg-continue").click(); pg.wait_for_timeout(300)
    check("Continue again keeps step 2", t(pg, "bg-urgent_problem").input_value().startswith("Jualan"))
    t(pg, "bg-continue").click(); pg.wait_for_timeout(400)
    check("step 3", t(pg, "bg-step-3").is_visible())
    check("step 3: the CTA says Hantar untuk Semakan Percuma", "Hantar untuk Semakan Percuma" in t(pg, "bg-submit").inner_text(), t(pg, "bg-submit").inner_text())
    exp = t(pg, "bg-expect").inner_text()
    check("step 3: free review, may suggest, never mandatory, separate quotation, no guarantee", all(w in exp for w in ("percuma", "mencadangkan", "tidak sekali-kali diwajibkan", "sebut harga berasingan", "Tiada hasil yang dijamin")), exp)
    check("step 3: the marketing consent starts unticked", not t(pg, "bg-consent_marketing").is_checked())
    check("step 3: the two required consents are separate boxes", t(pg, "bg-consent_contact").count() == 1 and t(pg, "bg-consent_privacy").count() == 1)
    t(pg, "bg-submit").click(); pg.wait_for_timeout(400)
    check("validation: both consents are required", t(pg, "bg-step-3").is_visible() and pg.locator("#err-consent_contact").count() == 1 and pg.locator("#err-consent_privacy").count() == 1)
    t(pg, "bg-consent_contact").check(); t(pg, "bg-submit").click(); pg.wait_for_timeout(400)
    check("validation: the Privacy Notice is its own consent", pg.locator("#err-consent_privacy").count() == 1 and pg.locator("#err-consent_contact").count() == 0)
    step3(pg)
    shot(pg, "growth-step3-desktop-bm.png")
    t(pg, "bg-submit").click(); pg.wait_for_timeout(1500)
    check("submit: confirmation with a BG- reference", t(pg, "bg-done").is_visible() and t(pg, "bg-ref").inner_text().startswith("BG-"), pg.inner_text("body")[:300])
    shot(pg, "growth-confirmation-desktop-bm.png")
    sent = [json.loads(r[2] or "{}") for r in reqs if r[0] == "POST" and "/public/business-growth" in r[1]]
    check("submit: one POST", len(sent) == 1, len(sent))
    body = sent[0] if sent else {}
    check("posted: UTM captured separately from the source", body.get("utm", {}).get("campaign") == "growth_nov" and body.get("source") == "tiktok", body.get("utm"))
    check("posted: the landing page kept", "/apply/business" in body.get("landing_path", ""), body.get("landing_path"))
    check("posted: a client key for retries", len(str(body.get("client_key", ""))) >= 16)
    check("posted: three challenges, platforms, interests", sorted(body.get("challenges", [])) == ["content", "low_sales", "social_reach"] and body.get("platforms") == ["instagram", "whatsapp"] and body.get("interests") == ["ai_video"], body)
    check("posted: both consents yes, marketing no", body.get("consent_contact") is True and body.get("consent_privacy") is True and body.get("consent_marketing") is False)
    check("posted: no password, role, account or budget field", not any(k in body for k in ("password", "role", "user_id", "account", "budget")))
    check("desktop: no sideways scroll", fits(pg))
    check("desktop: no page error", not errs, errs)
    ctx.close()

    # ---------- the same WhatsApp again: added to the open enquiry ----------
    ctx, pg, errs, reqs = ctx_page(b, 4360, 1440, 1000, "/apply/business", lang="en")
    pg.evaluate("sessionStorage.clear()"); pg.reload(); pg.wait_for_timeout(1500)
    check("EN: the headline in English", "FREE First Review" in pg.inner_text("h1"), pg.inner_text("h1"))
    step1(pg); t(pg, "bg-source-instagram").click(); t(pg, "bg-continue").click(); pg.wait_for_timeout(300)
    step2(pg); t(pg, "bg-continue").click(); pg.wait_for_timeout(300)
    step3(pg)
    check("EN: Submit for a Free Review", "Submit for a Free Review" in t(pg, "bg-submit").inner_text())
    shot(pg, "growth-step3-desktop-en.png")
    t(pg, "bg-submit").click(); pg.wait_for_timeout(1500)
    rows = state(4360)["rows"]
    check("again: the same WhatsApp is the same enquiry, not a second one", t(pg, "bg-done").is_visible() and "already have" in t(pg, "bg-done").inner_text() and sum(1 for r in rows if r["whatsapp"] == "+60123456789" and r["status"] != "not_interested") == 1, [r["ref"] for r in rows])
    shot(pg, "growth-confirmation-again-en.png")
    ctx.close()

    # ---------- the public form, phone ----------
    ctx, pg, errs, reqs = ctx_page(b, 4360, 390, 844, "/apply/business")
    pg.evaluate("localStorage.removeItem('azone-lang'); sessionStorage.clear()"); pg.reload(); pg.wait_for_timeout(1500)
    check("phone: step 1 fits 390px", fits(pg), pg.evaluate("document.documentElement.scrollWidth"))
    check("phone: inputs are 16px (no iOS zoom)", pg.evaluate("parseFloat(getComputedStyle(document.querySelector('[data-testid=bg-full_name]')).fontSize)") >= 16)
    shot(pg, "growth-step1-phone.png")
    step1(pg, "13 999 8888"); t(pg, "bg-source-facebook").click(); t(pg, "bg-continue").click(); pg.wait_for_timeout(400)
    check("phone: step 2 fits", t(pg, "bg-step-2").is_visible() and fits(pg))
    step2(pg); shot(pg, "growth-step2-phone.png")
    t(pg, "bg-continue").click(); pg.wait_for_timeout(400)
    step3(pg)
    check("phone: step 3 fits", t(pg, "bg-step-3").is_visible() and fits(pg))
    shot(pg, "growth-step3-phone.png")
    t(pg, "bg-submit").click(); pg.wait_for_timeout(1500)
    check("phone: confirmation", t(pg, "bg-done").is_visible())
    shot(pg, "growth-confirmation-phone.png")
    check("phone: no page error", not errs, errs)
    ctx.close()

    # ---------- staff: Sales -> Customers & Follow-ups -> Business Growth ----------
    def growth(pg):
        t(pg, "cust-growth").click(); pg.wait_for_timeout(900)
    def select(pg, name):
        t(pg, "growth-table").get_by_text(name, exact=True).first.click(); pg.wait_for_timeout(1000)
    def sales_page(port, w=1440, h=900, lang="en"):
        return ctx_page(b, port, w, h, "/portal?tab=Sales&view=customers", lang=lang)

    reset(4360)
    ctx, pg, errs, reqs = sales_page(4360)
    tabs = [x.split(" (")[0].strip() for x in t(pg, "cust-action").locator("xpath=..").locator("[role=tab]").all_inner_texts()]
    check("Customers & Follow-ups: Business Growth sits in the existing tab row, nothing else moved", tabs == ["Needs Action", "Enquiries", "Business Growth", "Follow-ups", "All Customers", "Board"], tabs)
    growth(pg)
    check("growth: the connected KPI strip", t(pg, "growth-strip").is_visible() and t(pg, "growth-strip").locator("[data-cell]").count() == 5, t(pg, "growth-strip").inner_text() if t(pg, "growth-strip").count() else "")
    heads = [x.strip() for x in t(pg, "growth-table").locator("thead th").all_inner_texts()]
    check("growth: Ref., Business · main challenge, Source, Status, Owner, Submitted", heads[:6] == ["Ref.", "Business · main challenge", "Source", "Status", "Owner", "Submitted"], heads)
    check("growth: open enquiries listed with BG references; Not Interested left out of Open", "BG-1006" in t(pg, "growth-table").inner_text() and "Zaki Agro" not in t(pg, "growth-table").inner_text())
    check("growth: the pipeline definitions beside the list", t(pg, "growth-defs").is_visible() and "Free Advice Delivered" in t(pg, "growth-defs").inner_text())
    check("desktop: no sideways scroll", fits(pg))
    shot(pg, "growth-sales-ceo.png", full=False)
    t(pg, "growth-tab-closed").click(); pg.wait_for_timeout(300)
    check("filter: Closed shows the Not Interested one", "Zaki Agro" in t(pg, "growth-table").inner_text())
    t(pg, "growth-tab-open").click(); pg.wait_for_timeout(300)
    select(pg, "Kopi Hafiz")
    rec = t(pg, "growth-record")
    check("preview: the enquiry beside the list, with Pick Up", rec.is_visible() and t(pg, "growth-pickup").is_visible() and t(pg, "growth-whatsapp").count() == 0, rec.inner_text()[:300])
    check("preview: the answers - challenges, urgent problem, 90-day goal, consent evidence", "Low reach on social media" in rec.inner_text() and "90-day goal" in rec.inner_text() and "Privacy Notice (2026-07-24): yes" in t(pg, "growth-consent").inner_text())
    shot(pg, "growth-preview-new-ceo.png", full=False)
    t(pg, "growth-pickup").click(); pg.wait_for_timeout(1400)
    check("Pick Up: the CEO owns it, Assigned", row_of(4360, 6)["owner_id"] == 9001 and row_of(4360, 6)["status"] == "assigned")
    r = pg.evaluate("""async () => { const x = await fetch('/api/v1/staff/business-growth/6/pickup', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({version: 1})}); return [x.status, await x.text()]; }""")
    check("double claim: a second Pick Up is refused", r[0] == 409, r)
    wa = t(pg, "growth-whatsapp")
    href = wa.get_attribute("href") or ""
    msg = urllib.parse.unquote(href.split("text=", 1)[-1]) if "text=" in href else ""
    check("WhatsApp Usahawan: the official click-to-chat link to the entrepreneur", href.startswith("https://wa.me/60173334444?text="), href)
    check("WhatsApp Usahawan: the CEO's message, with the name, the staff member and the business", msg == "Salam Hafiz Ismail, saya Fixture Person daripada A2Z Creative Marketing. Terima kasih kerana mengisi Business Growth Check. Saya ingin memahami cabaran yang dihadapi oleh Kopi Hafiz supaya kami boleh berikan cadangan awal secara percuma.", msg)
    check("WhatsApp Usahawan: opens in a new tab, sends nothing by itself", wa.get_attribute("target") == "_blank")
    with ctx.expect_page() as newp: wa.click()
    newp.value.close(); pg.wait_for_timeout(400)
    check("WhatsApp Usahawan: opening it is not a record - the screen says so", t(pg, "growth-wa-hint").is_visible() and row_of(4360, 6)["contact_attempts"] == 0)
    shot(pg, "growth-preview-picked-ceo.png", full=False)
    t(pg, "growth-contact").click(); pg.wait_for_timeout(400)
    t(pg, "growth-contact-note").fill("Sent the WhatsApp; he replied and asked for a call tomorrow")
    t(pg, "growth-contact-save").click(); pg.wait_for_timeout(1400)
    check("contact recorded: one attempt, Contacted", row_of(4360, 6)["contact_attempts"] == 1 and row_of(4360, 6)["status"] == "contacted")
    t(pg, "growth-problem-btn").click(); pg.wait_for_timeout(300)
    t(pg, "growth-problem-text").fill("Ads are boosted without a target audience and there is no offer.")
    t(pg, "growth-problem-save").click(); pg.wait_for_timeout(1300)
    t(pg, "growth-advice").click(); pg.wait_for_timeout(300)
    check("free advice: the screen says a paid service is never required", "never required" in t(pg, "growth-advice-form").inner_text())
    t(pg, "growth-advice-text").fill("Run one offer per month to a 10 km audience; reply to every comment within an hour.")
    t(pg, "growth-advice-save").click(); pg.wait_for_timeout(1300)
    check("problem and free advice recorded", row_of(4360, 6)["status"] == "advice_delivered" and row_of(4360, 6)["advice_at"])
    t(pg, "growth-outcome").click(); pg.wait_for_timeout(300)
    check("outcome: Qualified is explained as not a sale", "It is not a sale" in t(pg, "growth-outcome-form").inner_text())
    t(pg, "growth-outcome-reason").fill("Wants a monthly content and ads package quoted")
    shot(pg, "growth-outcome-ceo.png", full=False)
    t(pg, "growth-outcome-save").click(); pg.wait_for_timeout(1300)
    check("outcome: Qualified with its reason", row_of(4360, 6)["status"] == "qualified" and row_of(4360, 6)["outcome_reason"].startswith("Wants"))
    check("Qualified: Create quotation and Link quotation offered", t(pg, "growth-quote").is_visible() and t(pg, "growth-link-quote").is_visible())
    t(pg, "growth-link-quote").click(); pg.wait_for_timeout(300)
    t(pg, "growth-quote-pick").select_option("520"); t(pg, "growth-quote-save").click(); pg.wait_for_timeout(1200)
    check("Link quotation: the Sales quotation is linked", row_of(4360, 6)["quotation_id"] == 520)
    hist = t(pg, "growth-history").inner_text()
    check("history: every step, in order", all(w in hist for w in ("Submitted", "Picked up", "Contact - reached", "Problem identified", "Free advice given", "Qualified", "Quotation linked")), hist)
    shot(pg, "growth-history-ceo.png", full=False)
    # analytics
    t(pg, "growth-mode-analytics").click(); pg.wait_for_timeout(600)
    an = t(pg, "growth-analytics").inner_text()
    check("analytics: sources, challenges, response time, free assessments, qualified, accepted, CEO-verified", all(w in an for w in ("Where they came from", "Most common challenges", "First response", "Free assessments completed", "Qualified leads", "Quotations accepted", "CEO-verified sales")), an[:400])
    shot(pg, "growth-analytics-ceo.png", full=False)
    check("CEO: no page error", not errs, errs)
    ctx.close()

    # Create quotation from a qualified enquiry: the normal Sales form, prefilled with the reference
    ctx, pg, errs, reqs = sales_page(4360)
    growth(pg); select(pg, "RK Tuition Centre")
    t(pg, "growth-quote").click(); pg.wait_for_timeout(1500)
    page_text = pg.inner_text("body")
    check("Create quotation: the normal Sales path, prefilled from the enquiry", "Prefilled from Business Growth BG-1002" in page_text, page_text[:400])
    shot(pg, "growth-create-quotation.png", full=False)
    ctx.close()

    # --- the bell and the Desk open the exact enquiry
    reset(4360)
    ctx, pg, errs, reqs = ctx_page(b, 4360, 1440, 900, "/portal?tab=Dashboard", lang="en")
    pg.get_by_role("button", name=re.compile("^Notifications")).first.click(); pg.wait_for_timeout(800)
    item = pg.get_by_text(re.compile("BG-1006.*Kopi Hafiz")).first
    check("bell: the new Business Growth Check", item.is_visible())
    shot(pg, "growth-bell.png", full=False)
    item.click(); pg.wait_for_timeout(2400)
    check("bell: opens Sales > Customers & Follow-ups > Business Growth on that enquiry", t(pg, "growth-record").is_visible() and "Kopi Hafiz" in t(pg, "growth-record").inner_text(), pg.url)
    shot(pg, "growth-bell-opened.png", full=False)
    ctx.close()
    ctx, pg, errs, reqs = ctx_page(b, 4360, 1440, 900, "/portal?tab=Desk", lang="en")
    pg.get_by_role("tab", name=re.compile("^Action Inbox")).first.click(); pg.wait_for_timeout(900)
    pg.get_by_text(re.compile("^Requires My Response")).first.click(); pg.wait_for_timeout(600)
    di = pg.get_by_text("BG-1006 - Kopi Hafiz").first
    check("Desk: the enquiry waits in the Action Inbox", di.is_visible())
    shot(pg, "growth-desk.png", full=False)
    pg.locator("[data-testid=inbox-row]", has_text="BG-1006 - Kopi Hafiz").get_by_role("button", name=re.compile("^Open")).first.click(); pg.wait_for_timeout(2400)
    check("Desk: opens the enquiry itself", t(pg, "growth-record").is_visible() and "Kopi Hafiz" in t(pg, "growth-record").inner_text(), pg.url)
    ctx.close()

    # --- Sales staff: own work only; no reassigning
    reset(4361)
    ctx, pg, errs, reqs = sales_page(4361)
    growth(pg); select(pg, "LWJ Auto Care")
    check("Sales: somebody else's enquiry - no WhatsApp, no contact, no Give to", t(pg, "growth-whatsapp").count() == 0 and t(pg, "growth-contact").count() == 0 and t(pg, "growth-assign").count() == 0)
    select(pg, "Butik Nurul")
    check("Sales: their own - WhatsApp Usahawan and Record contact", t(pg, "growth-whatsapp").is_visible() and t(pg, "growth-contact").is_visible())
    shot(pg, "growth-preview-sales.png", full=False)
    check("Sales: no page error", not errs, errs)
    ctx.close()

    # --- phone: the list, then the full record in a drawer
    ctx, pg, errs, reqs = sales_page(4361, 390, 844)
    growth(pg)
    check("phone: Business Growth fits 390px", fits(pg), pg.evaluate("document.documentElement.scrollWidth"))
    shot(pg, "growth-sales-phone.png", full=False)
    select(pg, "Butik Nurul")
    check("phone: the enquiry opens full screen", t(pg, "growth-drawer").is_visible())
    shot(pg, "growth-drawer-phone.png", full=False)
    check("phone: no page error", not errs, errs)
    ctx.close()

    # --- an editor has no Business Growth tab; an agent is refused
    ctx, pg, errs, reqs = sales_page(4362)
    check("editor: no Business Growth tab", t(pg, "cust-growth").count() == 0)
    r = pg.evaluate("""async () => (await fetch('/api/v1/staff/business-growth')).status""")
    check("editor: the list is refused", r == 403, r)
    ctx.close()
    ctx, pg, errs, reqs = ctx_page(b, 4363, 1440, 900, "/portal")
    r = pg.evaluate("""async () => { const x = await fetch('/api/v1/staff/business-growth'); return [x.status, await x.text()]; }""")
    check("agent: refused, and nothing about an enquiry comes back", r[0] == 403 and "Hafiz" not in r[1], r)
    ctx.close()
    b.close()

fails = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(fails)} of {len(results)} passed")
if fails: raise SystemExit(1)

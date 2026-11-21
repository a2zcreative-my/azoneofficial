"""SALES COMMAND CENTER, PHASE 7: THE SALES PLAYBOOK (v1.404.0) - in a browser.

  Reader     the eighth Sales view; four doors, ten sections, the rail; ONLY published words (a draft's changes,
             a never-published draft and an archived entry are not there); Product Knowledge shows the Packages
             library live; a linked package shows its live price; search; a file; no gold action, no management
  Deal       a deal opens "the Playbook for this stage"
  Manager    New entry (gold); drafts and archived; a price in the text is named and Publish stays off; publishing
             with a note puts the entry in front of staff; the versions of an entry and bringing one back
  Phones     no sideways page at 390; the sections in one picker; BM words

Servers: ROLE=ceo 4177 · ROLE=sales_marketing 4182   (node tests/browser/serve.mjs out <port>)
"""
from playwright.sync_api import sync_playwright
import os, re, json, urllib.request

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, SALES = 4177, 4182
SHOTS = os.environ.get("SHOTS", "/tmp/playbook-shots"); os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def reset(port):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()

def open_page(b, port, w=1440, h=1000, lang="en", view="playbook"):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)
    ctx.add_init_script(f"try{{localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang','{lang}')}}catch(e){{}}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Sales&view={view}"); pg.wait_for_timeout(4000)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def nav(pg, key):
    pg.get_by_test_id(f"pb-nav-{key}").click(); pg.wait_for_timeout(500)

def entries(pg):
    return pg.get_by_test_id("pb-entry")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])

    # ------------------------------------------------------------- a consultant reads
    reset(SALES)
    ctx, pg, errs = open_page(b, SALES)
    tabs = pg.get_by_test_id("sales-tabs").inner_text()
    check("the Sales Playbook is the eighth Sales view, after Reports", tabs.index("Sales Playbook") > tabs.index("Reports"), tabs)
    check("the Playbook opens", pg.get_by_test_id("playbook").count() == 1)
    check("four doors and ten sections", pg.get_by_test_id("pb-shortcuts").locator("button").count() == 4 and pg.get_by_test_id("pb-nav").locator("li").count() == 10)
    check("it opens on the Quick Guide", pg.get_by_test_id("pb-heading").inner_text() == "Quick Guide" and entries(pg).count() == 1)
    check("a consultant has no gold action and nothing to manage", pg.locator("[data-testid=sales-tabs] button:has-text('New entry')").count() == 0
          and pg.get_by_test_id("pb-mode").count() == 0 and pg.get_by_test_id("pb-manage").count() == 0)
    rail = pg.get_by_test_id("pb-rail")
    check("the rail: the first published Discovery Questions, Proposal & Follow-up and Quick Guide lists",
          rail.get_by_test_id("pb-rail-discovery").count() == 1 and rail.get_by_test_id("pb-rail-proposal").count() == 1 and rail.get_by_test_id("pb-rail-quick").count() == 1
          and "Bila anda mahu mula?" in rail.inner_text())
    nav(pg, "objections")
    txt = pg.get_by_test_id("pb-main").inner_text()
    check("Objection Handling: what the customer says, the answer and the focus points", entries(pg).count() == 2 and "Suggested answer" in txt and "Focus points" in txt, txt[:200])
    check("staff read the published words - never a draft's changes", "tanya apa yang tidak berjaya" not in txt and "Dengar pengalaman lepas" in txt)
    linked = pg.locator("[data-entry='4'] [data-testid=pb-linked]")
    check("a linked package shows its live price from the library", linked.count() == 1 and "Fixture Video Pack" in linked.inner_text() and "650.00" in linked.inner_text(), linked.inner_text() if linked.count() else "")
    pg.screenshot(path=f"{SHOTS}/01-consultant-objections-1440.png", full_page=False)
    pg.get_by_test_id("pb-short-product").click(); pg.wait_for_timeout(600)
    pk = pg.get_by_test_id("pb-packages")
    check("Product Knowledge opens with the Packages library, live", pk.count() == 1 and pk.get_by_test_id("pb-package").count() == 1 and "650.00" in pk.inner_text() and "A2Z Creative · AZ ONE" in pk.inner_text(), pk.inner_text()[:200] if pk.count() else "")
    nav(pg, "training")
    check("a draft never published is not shown to staff", pg.get_by_test_id("pb-empty").count() == 1 and entries(pg).count() == 0)
    nav(pg, "practices")
    check("an archived entry is not shown to staff", pg.get_by_test_id("pb-empty").count() == 1)
    nav(pg, "sop")
    check("an SOP carries its file", pg.get_by_test_id("pb-file").count() == 1 and "senarai-semak" in pg.get_by_test_id("pb-file").inner_text())
    pg.get_by_test_id("pb-search").fill("rakan kongsi"); pg.wait_for_timeout(500)
    check("search covers every published word, and says which section", entries(pg).count() == 1 and "Objection Handling" in entries(pg).first.inner_text() and "Search" in pg.get_by_test_id("pb-heading").inner_text())
    pg.get_by_test_id("pb-search").fill("tanya apa yang tidak berjaya"); pg.wait_for_timeout(400)
    check("a draft's words are not found by staff", entries(pg).count() == 0)
    pg.get_by_test_id("pb-search").fill("")
    check("no page errors (consultant)", not errs, errs)
    ctx.close()

    # ------------------------------------------------------------- a deal opens the Playbook for its stage
    ctx, pg, errs = open_page(b, CEO, view="pipeline")
    pg.get_by_test_id("pipeline-scope-all").click(); pg.wait_for_timeout(1000)
    pg.locator("[data-deal='71'] [data-testid=deal-open]").click(); pg.wait_for_timeout(1300)
    btn = pg.get_by_test_id("deal-playbook").filter(visible=True)
    check("an open deal offers the Playbook for its stage", btn.count() == 1)
    if btn.count():
        btn.first.click(); pg.wait_for_timeout(1200)
        h = pg.get_by_test_id("pb-heading").inner_text() if pg.get_by_test_id("pb-heading").count() else ""
        check("…and it lists the entries tagged with that stage, from every section", h == "For the stage: Negotiation" and entries(pg).count() == 1 and "rakan kongsi" in entries(pg).first.inner_text(), h)
        pg.screenshot(path=f"{SHOTS}/02-deal-stage-1440.png", full_page=False)
        pg.get_by_test_id("pb-stage-clear").click(); pg.wait_for_timeout(400)
        check("All sections goes back to the sections", pg.get_by_test_id("pb-heading").inner_text() == "Quick Guide")
    ctx.close()

    # ------------------------------------------------------------- the CEO writes and publishes
    reset(CEO)
    ctx, pg, errs = open_page(b, CEO)
    gold = pg.locator("[data-testid=sales-tabs] button:has-text('New entry')")
    check("the CEO has New entry as the gold action, and the three modes", gold.count() == 1 and pg.get_by_test_id("pb-mode").count() == 1)
    pg.get_by_test_id("pb-mode").get_by_role("button", name="Drafts & changes").click(); pg.wait_for_timeout(400)
    nav(pg, "objections")
    dr = pg.get_by_test_id("pb-main").inner_text()
    check("Drafts & changes: the draft's words, marked not published yet", entries(pg).count() == 1 and "tanya apa yang tidak berjaya" in dr and "changes not published" in dr, dr[:240])
    check("…with a note that staff do not see them", pg.get_by_test_id("pb-staff-note").count() == 1)
    nav(pg, "training")
    check("a draft never published is listed for the managers", entries(pg).count() == 1 and "never published" in pg.get_by_test_id("pb-main").inner_text())
    pg.screenshot(path=f"{SHOTS}/03-ceo-drafts-1440.png", full_page=False)
    pg.get_by_test_id("pb-mode").get_by_role("button", name="Archived").click(); pg.wait_for_timeout(400)
    nav(pg, "practices")
    check("Archived: kept with its reason, and Bring back", entries(pg).count() == 1 and "Replaced by the Quick Guide" in pg.get_by_test_id("pb-main").inner_text() and pg.get_by_test_id("pb-unarchive").count() == 1)
    pg.get_by_test_id("pb-mode").get_by_role("button", name="Published").click(); pg.wait_for_timeout(300)

    nav(pg, "objections")
    gold.click(); pg.wait_for_timeout(800)
    check("New entry opens the form on the section in view", pg.get_by_test_id("pb-ed-section").input_value() == "objections" and pg.get_by_test_id("pb-ed-kind").input_value() == "objection")
    pg.get_by_test_id("pb-ed-title").fill("Bajet kami terhad tahun ini.")
    pg.get_by_test_id("pb-ed-answer").fill("Faham. Pakej asas hanya RM 500 sebulan dan boleh ditambah kemudian.")
    pg.get_by_test_id("pb-ed-items").fill("Mula kecil\nUkur hasil")
    pg.get_by_test_id("pb-ed-note").fill("Answer for a tight budget")
    pg.wait_for_timeout(300)
    check("a price in the text is named, and Publish stays off", pg.get_by_test_id("pb-ed-price").count() == 1 and "RM 500" in pg.get_by_test_id("pb-ed-price").inner_text()
          and pg.get_by_test_id("pb-ed-publish").is_disabled() and pg.get_by_test_id("pb-ed-save").is_disabled())
    pg.screenshot(path=f"{SHOTS}/04-editor-price-1440.png", full_page=False)
    pg.get_by_test_id("pb-ed-answer").fill("Faham. Kita boleh mula dengan pakej terkecil dalam pustaka dan tambah selepas melihat hasil.")
    pg.get_by_test_id("pb-ed-pkg").first.check()
    pg.wait_for_timeout(200)
    check("with the price gone and a package linked, Publish is on", pg.get_by_test_id("pb-ed-price").count() == 0 and not pg.get_by_test_id("pb-ed-publish").is_disabled())
    pg.get_by_test_id("pb-ed-publish").click(); pg.wait_for_timeout(1500)
    body = pg.locator("body").inner_text()
    check("publishing says which version, and that the other managers were told", "Published as version 1" in body and "other managers were told" in body, body[-300:])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    pg.get_by_test_id("pb-search").fill("Bajet kami terhad"); pg.wait_for_timeout(1200)
    check("the published entry is in the Playbook", entries(pg).count() == 1)
    pg.get_by_test_id("pb-search").fill(""); pg.wait_for_timeout(300)

    nav(pg, "quick")
    pg.get_by_test_id("pb-history").first.click(); pg.wait_for_timeout(1200)
    vs = pg.get_by_test_id("pb-version")
    check("Versions: every published version with its note, newest first; the live one marked", vs.count() == 2 and "Version 2" in vs.first.inner_text() and "Staff read this" in vs.first.inner_text() and "First version" in vs.nth(1).inner_text())
    vs.nth(1).get_by_test_id("pb-version-view").click(); pg.wait_for_timeout(300)
    check("an earlier version can be read", "(earlier)" in vs.nth(1).inner_text())
    pg.screenshot(path=f"{SHOTS}/05-versions-1440.png", full_page=False)
    vs.nth(1).get_by_test_id("pb-version-restore").click(); pg.wait_for_timeout(1200)
    body = pg.locator("body").inner_text()
    check("bringing one back puts it in the draft, to publish again", "Version 1 is in the draft" in body and pg.get_by_test_id("pb-mode").get_by_role("button", name="Drafts & changes").get_attribute("aria-pressed") == "true", body[-200:])
    check("no page errors (CEO)", not errs, errs)
    ctx.close()

    # ------------------------------------------------------------- phones
    for lang, port in (("en", SALES), ("ms", SALES), ("en", CEO)):
        ctx, pg, errs = open_page(b, port, 390, 844, lang)
        tag = f"{lang}/{port}"
        check(f"phone {tag}: no sideways page", no_hscroll(pg))
        check(f"phone {tag}: the sections are one picker; the list is not drawn", pg.get_by_test_id("pb-section-select").is_visible() and not pg.get_by_test_id("pb-nav").is_visible())
        pg.get_by_test_id("pb-section-select").select_option("objections"); pg.wait_for_timeout(500)
        check(f"phone {tag}: picking a section opens it", entries(pg).count() >= 2 and no_hscroll(pg))
        if lang == "ms":
            check("phone BM: the words are Malay", pg.get_by_test_id("pb-heading").inner_text() == "Menangani Bantahan" and "Cadangan jawapan" in pg.get_by_test_id("pb-main").inner_text())
        pg.screenshot(path=f"{SHOTS}/06-phone-{lang}-{port}.png", full_page=True)
        check(f"phone {tag}: no page errors", not errs, errs)
        ctx.close()

    b.close()

ok = sum(1 for _, c in res if c)
print(f"\nsales-playbook: {ok}/{len(res)} passed")
raise SystemExit(0 if ok == len(res) else 1)

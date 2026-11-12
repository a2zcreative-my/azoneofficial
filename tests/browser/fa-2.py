"""v1.286.0 - FINANCIAL ADVISORY -> BANKERS in a browser (the CEO,
12-11-2026: "proceed with Banker Registration, Branch Network & Smart
Allocation Blueprint v1.1"; stage 1). The rules are proven by direct request
in tests/fa-registry.mjs; here, the screens at the seven widths:

  - Bankers has four views: Banker directory, Branch registry, Bank registry,
    Audit history;
  - the directory shows each banker once with a status worked out from the
    record (Verified, Pending verification, Requires reverification) and
    availability only for a verified banker; a banker who left is hidden from
    Current bankers; the state filter keeps a national banker;
  - Register banker is four steps; a known work email stops at the review
    with Open that record and no save; a shared work phone asks why and saves
    only with the reason; it posts no login, only POST /fa/bankers;
  - one banker's record shows identity and referral as two facts, the current
    and earlier assignments, and the history;
  - the COO is refused verifying a banker they registered; the CEO verifies;
  - Sales registers, but adds no bank or branch and verifies nobody;
  - a branch postcode in another state asks for the reason;
  - no sideways page; sheet buttons at least 44 px on a phone.
Servers (servers): the FA=1 ones of tests/browser/fa-1.py.
Invented fixture data only (tests/browser/fa-fixture.mjs)."""
import os, json, urllib.request
from playwright.sync_api import sync_playwright

CEO, COO, SALES = 4280, 4281, 4282
WIDTHS = [1440, 1280, 768, 430, 390, 360, 320]
OUT = os.environ.get("FA_OUT", "/tmp/fa-shots"); os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

def open_bankers(b, port, w):
    urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": 900 if w >= 768 else 800}, is_mobile=phone, has_touch=phone)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Financial%20Advisory"); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    pg.get_by_test_id("fa-panel").get_by_role("tab", name="Bankers", exact=True).first.click(); pg.wait_for_timeout(900)
    return ctx, pg, errs

posts = lambda port: json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/__fixture-status").read())["fa_posts"]
sideways = lambda pg: pg.evaluate("document.scrollingElement.scrollWidth <= window.innerWidth + 1")
def short_buttons(pg, scope):
    return pg.evaluate(f"""[...document.querySelectorAll('{scope} button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5 && !b.closest('[role=tablist]')).map(b => b.innerText.trim() + ':' + Math.round(b.getBoundingClientRect().height)).slice(0, 6)""")
def sub(pg, long, short):
    pg.get_by_test_id("fa-registry").get_by_role("tab", name=long).or_(pg.get_by_test_id("fa-registry").get_by_role("tab", name=short, exact=True)).first.click(); pg.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch()
    for w in WIDTHS:
        tag = f"CEO {w}"
        ctx, pg, errs = open_bankers(b, CEO, w)
        reg = pg.get_by_test_id("fa-registry")
        tabs = reg.get_by_role("tab").all_inner_texts()
        check(f"{tag}: Bankers has four views", len(tabs) == 4 and any("irector" in t for t in tabs) and any("ranch" in t for t in tabs) and any("ank" in t for t in tabs) and any("istory" in t for t in tabs), tabs)
        rows = pg.get_by_test_id("fa-banker")
        texts = rows.all_inner_texts()
        check(f"{tag}: Current bankers lists three, the one who left is hidden", rows.count() == 3 and not any("Empat" in t for t in texts), texts)
        satu = next((t for t in texts if "Banker Satu" in t), "")
        check(f"{tag}: a verified banker reads Verified and Available", "Verified" in satu and "Available" in satu, satu)
        dua = next((t for t in texts if "Banker Dua" in t), "")
        check(f"{tag}: a new banker reads Pending verification, with no availability", "Pending verification" in dua and "Available" not in dua and "unknown" not in dua.lower(), dua)
        tiga = next((t for t in texts if "Banker Tiga" in t), "")
        check(f"{tag}: a lapsed review reads Requires reverification", "Requires reverification" in tiga, tiga)
        pg.get_by_test_id("fa-directory").get_by_label("State").select_option("SELANGOR"); pg.wait_for_timeout(200)
        check(f"{tag}: the state filter keeps a national banker only", rows.count() == 1 and "Banker Tiga" in rows.first.inner_text(), rows.all_inner_texts())
        pg.get_by_test_id("fa-directory").get_by_label("State").select_option(""); pg.wait_for_timeout(150)
        pg.get_by_test_id("fa-directory").get_by_label("Status").select_option("no_longer_available"); pg.wait_for_timeout(150)
        check(f"{tag}: the banker who left is kept, under No longer available", rows.count() == 1 and "Empat" in rows.first.inner_text())
        pg.get_by_test_id("fa-directory").get_by_label("Status").select_option("current"); pg.wait_for_timeout(150)
        check(f"{tag}: no sideways page (directory)", sideways(pg))
        if w in (1440, 390): pg.screenshot(path=f"{OUT}/fa2-directory-{w}.png", full_page=True)

        # one banker's record
        rows.filter(has_text="Banker Satu").first.click(); pg.wait_for_timeout(900)
        rec = pg.get_by_test_id("fa-banker-record")
        ident = rec.get_by_test_id("fa-fact-identity").inner_text() if rec.count() else ""
        refr = rec.get_by_test_id("fa-fact-referral").inner_text() if rec.count() else ""
        check(f"{tag}: the record shows identity and referral as two confirmed facts", "Contact identity" in ident and "Confirmed" in ident and "Referral permission" in refr and "Personal financing only" in refr, ident + " | " + refr)
        check(f"{tag}: it shows where they work now and earlier", "Fixture JB City" in rec.inner_text() and "Earlier assignments (1)" in rec.inner_text())
        check(f"{tag}: no password, login or portal access is offered", not any(k in rec.inner_text().lower() for k in ("password", "invite", "portal access", "create login")))
        if w < 500: check(f"{tag}: record sheet buttons at least 44 px on a phone", not short_buttons(pg, "[role=dialog]"), short_buttons(pg, "[role=dialog]"))
        check(f"{tag}: no sideways page (record)", sideways(pg))
        pg.keyboard.press("Escape"); pg.wait_for_timeout(500)

        if w in (1440, 390):
            # the CEO verifies a pending banker
            rows.filter(has_text="Banker Dua").first.click(); pg.wait_for_timeout(900)
            rec = pg.get_by_test_id("fa-banker-record")
            rec.get_by_test_id("fa-fact-identity").get_by_role("button", name="Verify").click(); pg.wait_for_timeout(300)
            save = rec.get_by_test_id("fa-verify-save")
            check(f"{tag}: verifying waits for the evidence", save.is_disabled())
            rec.get_by_test_id("fa-verify-evidence").fill("Fixture: called the branch official line, manager confirmed")
            save.click(); pg.wait_for_timeout(900)
            vp = [x for x in posts(CEO) if x["path"] == "/staff/fa/bankers/2/verify"]
            check(f"{tag}: it posts the identity fact with method, evidence and day", len(vp) == 1 and vp[0]["body"].get("fact") == "identity" and vp[0]["body"].get("method") == "call_branch_line" and len(vp[0]["body"].get("evidence", "")) >= 10 and vp[0]["body"].get("verified_on"), vp)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(500)

            # Register banker - four steps, duplicates stopped
            pg.get_by_test_id("fa-register").click(); pg.wait_for_timeout(600)
            sh = pg.get_by_role("dialog").last
            nx = sh.get_by_test_id("fa-reg-next")
            check(f"{tag}: step 1 waits for the bank and the name", "Step 1 / 4" in sh.inner_text() and nx.is_disabled())
            sh.get_by_test_id("fa-reg-bank").select_option("1"); sh.get_by_test_id("fa-reg-name").fill("Fixture Banker Satu")
            check(f"{tag}: a name already in the directory is a warning, not a merge", sh.get_by_test_id("fa-reg-samename").count() == 1 and "never merges" in sh.get_by_test_id("fa-reg-samename").inner_text())
            nx.click(); pg.wait_for_timeout(200)
            check(f"{tag}: step 2 asks for work contact only", "Step 2 / 4" in sh.inner_text() and "never a personal number" in sh.inner_text() and nx.is_disabled())
            sh.get_by_test_id("fa-reg-email").fill("satu@fixturebank.test"); nx.click(); pg.wait_for_timeout(200)
            branch = sh.get_by_test_id("fa-reg-branch")
            check(f"{tag}: step 3 offers only this bank's open branches and its central channel", branch.count() == 1 and "Fixture JB City" in branch.inner_text() and "Shah Alam" not in branch.inner_text() and "Central channel" in branch.inner_text(), branch.inner_text() if branch.count() else "")
            check(f"{tag}: step 3 waits for a product", nx.is_disabled())
            sh.get_by_label("Personal financing").check(); branch.select_option("1"); pg.wait_for_timeout(100)
            nx.click(); pg.wait_for_timeout(200)
            sv = sh.get_by_test_id("fa-reg-save")
            check(f"{tag}: step 4 reviews and says it saves as Pending, sends nothing", "Step 4 / 4" in sh.inner_text() and "Pending verification" in sh.inner_text() and "Nothing is sent" in sh.inner_text() and sv.inner_text().strip() == "Register as pending")
            sv.click(); pg.wait_for_timeout(700)
            dup = sh.get_by_test_id("fa-reg-dup")
            check(f"{tag}: a known work email stops with Open that record, and no save", dup.count() == 1 and "already has this work email" in dup.inner_text() and dup.get_by_role("button", name="Open that record").count() == 1 and sv.is_disabled(), dup.inner_text() if dup.count() else sh.inner_text()[:300])
            sh.get_by_role("button", name="Back").click(); pg.wait_for_timeout(100); sh.get_by_role("button", name="Back").click(); pg.wait_for_timeout(100)
            sh.get_by_test_id("fa-reg-email").fill("lima@fixturebank.test"); sh.get_by_test_id("fa-reg-phone").fill("07-111 2222")
            nx.click(); pg.wait_for_timeout(100); nx.click(); pg.wait_for_timeout(200)
            sv.click(); pg.wait_for_timeout(700)
            pos = sh.get_by_test_id("fa-reg-possible")
            check(f"{tag}: a shared work phone asks why this is a different person", pos.count() == 1 and "same work phone" in pos.inner_text() and sv.is_disabled())
            sh.get_by_test_id("fa-reg-reason").fill("Fixture: shared branch line, a different officer")
            check(f"{tag}: the reason lets it save", sv.is_enabled())
            if w < 500: check(f"{tag}: register sheet buttons at least 44 px on a phone", not short_buttons(pg, "[role=dialog]"), short_buttons(pg, "[role=dialog]"))
            check(f"{tag}: no sideways page (register)", sideways(pg))
            if w in (1440, 390): pg.screenshot(path=f"{OUT}/fa2-register-{w}.png", full_page=False)
            sv.click(); pg.wait_for_timeout(1200)
            rp = [x for x in posts(CEO) if x["path"] == "/staff/fa/bankers"]
            last = rp[-1]["body"] if rp else {}
            check(f"{tag}: it posts the banker with the reason, products and one primary assignment", len(rp) == 3 and last.get("different_reason", "").startswith("Fixture") and last.get("products") == ["personal_financing"] and last.get("assignments", [{}])[0].get("branch_id") == 1 and last.get("assignments")[0].get("primary") is True, last)
            check(f"{tag}: nothing but the registry was written (no user, no invite)", all(x["path"].startswith("/staff/fa/") for x in posts(CEO)), [x["path"] for x in posts(CEO)])
            rec = pg.get_by_test_id("fa-banker-record")
            check(f"{tag}: the new record opens, Pending verification", rec.count() == 1 and "Pending verification" in rec.inner_text())
            pg.keyboard.press("Escape"); pg.wait_for_timeout(500)

        # branches, banks, history
        sub(pg, "Branch registry", "Branches")
        br = pg.get_by_test_id("fa-branch")
        check(f"{tag}: the branch registry lists three, with a temporarily closed one", br.count() == 3 and "Temporarily closed" in pg.get_by_test_id("fa-branches").inner_text())
        check(f"{tag}: an unverified branch says Not verified", "Not verified" in br.filter(has_text="Fixture Skudai").first.inner_text())
        check(f"{tag}: no sideways page (branches)", sideways(pg))
        if w == 1440:
            pg.get_by_test_id("fa-branches").get_by_role("button", name="Add branch").click(); pg.wait_for_timeout(500)
            sh = pg.get_by_role("dialog").last
            sh.locator("select").nth(0).select_option("1"); sh.get_by_label("Official branch name").fill("Fixture Wrong Postcode")
            sh.get_by_label("Postcode").fill("50000"); sh.locator("select").nth(1).select_option("1")
            sh.get_by_role("button", name="Add branch").click(); pg.wait_for_timeout(700)
            mm = sh.get_by_test_id("fa-postcode-mismatch")
            check(f"{tag}: a postcode that reads as another state asks why", mm.count() == 1 and "reads as KUALA LUMPUR" in mm.inner_text() and sh.get_by_role("button", name="Add branch").is_disabled())
            sh.get_by_label("Official branch name").fill(""); sh.get_by_label("Postcode").fill("")
            pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
        sub(pg, "Bank registry", "Banks")
        bk = pg.get_by_test_id("fa-bank")
        bt = pg.get_by_test_id("fa-banks").inner_text()
        check(f"{tag}: the bank registry lists two, one Pending, with products and channel", bk.count() == 2 and "Pending" in bk.filter(has_text="Fixture Bank B").first.inner_text() and "Debt consolidation (central)" in bk.filter(has_text="Fixture Bank A").first.inner_text(), bt[:300])
        check(f"{tag}: it says adding a bank is not a partnership claim", "not a partnership claim" in bt)
        sub(pg, "Audit history", "History")
        ev = pg.get_by_test_id("fa-reg-event")
        check(f"{tag}: the audit history lists the registry events", ev.count() >= 3 and "Contact identity verified" in pg.get_by_test_id("fa-reg-history").inner_text())
        check(f"{tag}: no sideways page (history)", sideways(pg))
        check(f"{tag}: no page errors", not errs, errs)
        ctx.close()

    # the COO: refused on his own registration
    for w in (1440, 390):
        tag = f"COO {w}"
        ctx, pg, errs = open_bankers(b, COO, w)
        pg.get_by_test_id("fa-banker").filter(has_text="Banker Dua").first.click(); pg.wait_for_timeout(900)
        rec = pg.get_by_test_id("fa-banker-record")
        rec.get_by_test_id("fa-fact-identity").get_by_role("button", name="Verify").click(); pg.wait_for_timeout(300)
        rec.get_by_test_id("fa-verify-evidence").fill("Fixture: called the branch official line, manager confirmed")
        rec.get_by_test_id("fa-verify-save").click(); pg.wait_for_timeout(900)
        body = pg.locator("body").inner_text()
        check(f"{tag}: the COO is refused verifying a banker he registered", "You registered this banker" in body and "Pending" in rec.get_by_test_id("fa-fact-identity").inner_text(), body[-400:])
        check(f"{tag}: no page errors", not errs, errs)
        ctx.close()

    # Sales: registers, but manages nothing
    for w in (1440, 390):
        tag = f"Sales {w}"
        ctx, pg, errs = open_bankers(b, SALES, w)
        check(f"{tag}: Sales may register a banker", pg.get_by_test_id("fa-register").count() == 1)
        pg.get_by_test_id("fa-banker").filter(has_text="Banker Dua").first.click(); pg.wait_for_timeout(900)
        rec = pg.get_by_test_id("fa-banker-record")
        check(f"{tag}: Sales sees no Verify, Transfer or Change status", rec.get_by_role("button", name="Verify").count() == 0 and rec.get_by_role("button", name="Transfer").count() == 0 and rec.get_by_role("button", name="Change status").count() == 0)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        sub(pg, "Branch registry", "Branches")
        check(f"{tag}: no Add branch for Sales", pg.get_by_test_id("fa-branches").get_by_role("button", name="Add branch").count() == 0)
        sub(pg, "Bank registry", "Banks")
        check(f"{tag}: no Add bank for Sales", pg.get_by_test_id("fa-banks").get_by_role("button", name="Add bank").count() == 0 and pg.get_by_test_id("fa-banks").get_by_role("button", name="Verify").count() == 0)
        check(f"{tag}: no page errors", not errs, errs)
        ctx.close()
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\nfa-2: {len(results) - len(failed)}/{len(results)} passed")
if failed: raise SystemExit(1)

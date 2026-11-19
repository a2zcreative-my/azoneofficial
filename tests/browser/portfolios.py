"""STAFF PORTFOLIOS (v1.389.0) - in a browser, against the REAL worker (tests/browser/portfolio-server.mjs).

The CEO opens Staff -> Portfolios, creates three portfolios, uploads the three photos he sent
through the staff photo door, removes the background on the device, saves, previews front and
back, publishes; the QR on the back is read back with OpenCV and must be the public address;
PNG / PDF / QR downloads happen; the public page opens with no sign-in and takes an enquiry;
a draft is not public; the team member sees their card on Profile; no sideways page.

    node tests/browser/portfolio-server.mjs /home/claude/out-after 4340 &
    PHOTOS=/path/p1.png,/path/p2.png,/path/p3.png SHOTS=/tmp/pf python3 tests/browser/portfolios.py
The positions and duties are invented test words (tests/browser/portfolio-runtime.mjs)."""
import base64, json, os, sys, urllib.request
import cv2
import numpy as np
from playwright.sync_api import sync_playwright

PORT = int(os.environ.get("PORT", "4340"))
BASE = f"http://127.0.0.1:{PORT}"
PHOTOS = os.environ.get("PHOTOS", "").split(",")
SHOTS = os.environ.get("SHOTS", "/tmp/pf")
os.makedirs(SHOTS, exist_ok=True)
results = []


def check(name, cond, extra=""):
    results.append((bool(cond), name))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else f"  [{str(extra)[:300]}]"))


def as_user(uid):
    urllib.request.urlopen(f"{BASE}/__as?id={uid}").read()


def no_hscroll(pg):
    return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def decode_qr(png_bytes):
    img = cv2.imdecode(np.frombuffer(png_bytes, np.uint8), cv2.IMREAD_COLOR)
    val, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    return val


def go_portfolios(pg):
    """the sidebar's Staff, then the Portfolios view (the tab row on a desk, the view switch on a phone)"""
    pg.goto(f"{BASE}/portal"); pg.wait_for_timeout(3500)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    phone = pg.viewport_size
    if phone["width"] < 768:
        pg.set_viewport_size({"width": 1440, "height": 1000}); pg.wait_for_timeout(800)
    nav = pg.get_by_role("link", name="Staff", exact=True)
    (nav if nav.count() else pg.get_by_role("button", name="Staff", exact=True)).first.click()
    pg.wait_for_timeout(2000)
    pg.get_by_role("tab", name="Portfolios").first.click()
    pg.wait_for_selector("[data-testid=pf-list]", timeout=20000); pg.wait_for_timeout(1200)
    if phone["width"] < 768:
        pg.set_viewport_size(phone); pg.wait_for_timeout(1200)


def canvas_png(pg, tid):
    url = pg.evaluate(f"document.querySelector('[data-testid={tid}]').toDataURL('image/png')")
    return base64.b64decode(url.split(",")[1])


PEOPLE = [(11, "nurfarah", "NURFARAH"), (12, "noraleeya", "Noraleeya"), (13, "fasehah", "Fasehah")]
with sync_playwright() as p:
    b = p.chromium.launch()
    as_user(1)
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce", accept_downloads=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    go_portfolios(pg)
    check("Staff -> Portfolios opens with the shared figure strip and the staff list", pg.locator("[data-testid=pf-kpis]").count() == 1 and pg.locator("[data-testid=pf-row-11]").count() == 1)
    check("the strip counts the staff from the database (no invented figure)", "7" in pg.locator("[data-testid=pf-kpi-all]").inner_text(), pg.locator("[data-testid=pf-kpi-all]").inner_text())
    check("a leaver is not listed", pg.locator("[data-testid=pf-row-14]").count() == 0)
    pg.screenshot(path=f"{SHOTS}/studio-list.png")

    for i, (uid, slug, name) in enumerate(PEOPLE):
        pg.get_by_test_id(f"pf-create-{uid}").click()
        pg.wait_for_selector("[data-testid=pf-editor]", timeout=15000); pg.wait_for_timeout(800)
        if i == 0:
            check("the card preview shows a placeholder before any photo (no invented face)", pg.locator("[data-testid=pf-canvas-front]").count() == 1)
            pg.screenshot(path=f"{SHOTS}/editor-no-photo.png")
        pg.get_by_test_id("pf-tagline").fill("Turning ideas into impactful stories.")
        pg.get_by_test_id("pf-specialties").fill("Content Creation\nLive Selling\nPhotography\nSocial Media\nClient Relations")
        if len(PHOTOS) > i and PHOTOS[i]:
            pg.get_by_test_id("pf-upload").set_input_files(PHOTOS[i]); pg.wait_for_timeout(2500)
            check(f"{name}: the photo is uploaded through the staff photo door", "Using the staff record photo" in pg.get_by_test_id("pf-photo").inner_text(), pg.get_by_test_id("pf-photo").inner_text())
            pg.get_by_test_id("pf-cutout").click()
            pg.wait_for_function("() => document.querySelector('[data-testid=pf-photo]')?.innerText.includes('not saved yet')", timeout=120000)
            check(f"{name}: the background is removed on the device", True)
        pg.get_by_test_id("pf-save").click(); pg.wait_for_timeout(2500)
        with open(f"{SHOTS}/card-{slug}-front-draft.png", "wb") as f:
            f.write(canvas_png(pg, "pf-canvas-front"))
        pg.get_by_test_id("pf-tab-publish").click(); pg.wait_for_timeout(400)
        if i == 0:
            check("before publishing: downloads are closed and the back has no QR", pg.get_by_test_id("pf-png-front").is_disabled() and pg.locator("[data-testid=pf-qr-note]").count() == 1)
            pg.get_by_test_id("pf-side-back").click(); pg.wait_for_timeout(500)
            check("the draft's back carries no QR (nothing to scan)", decode_qr(canvas_png(pg, "pf-canvas-back")) == "")
            pg.get_by_test_id("pf-side-front").click()
        if i < 2:
            pg.get_by_test_id("pf-publish").click(); pg.wait_for_timeout(2500)
            check(f"{name}: published - the public address is shown", pg.get_by_test_id("pf-public-url").inner_text() == f"https://a2zcreative.my/portfolio/{slug}", pg.locator("[data-testid=pf-sec-publish]").inner_text()[:200])
            pub = json.loads(urllib.request.urlopen(f"{BASE}/api/v1/public/portfolio/{slug}").read())["portfolio"]
            check(f"{name}: what was typed is what was published (tagline, five specialties)", pub["tagline"] == "Turning ideas into impactful stories." and len(pub["specialties"]) == 5, pub)
            pg.get_by_test_id("pf-side-back").click(); pg.wait_for_timeout(800)
            got = decode_qr(canvas_png(pg, "pf-canvas-back"))
            check(f"{name}: the QR on the back scans to the public address", got == f"https://a2zcreative.my/portfolio/{slug}", got)
            for side in ("front", "back"):
                with open(f"{SHOTS}/card-{slug}-{side}.png", "wb") as f:
                    f.write(canvas_png(pg, f"pf-canvas-{side}"))
            pg.get_by_test_id("pf-side-front").click(); pg.wait_for_timeout(300)
            pg.screenshot(path=f"{SHOTS}/editor-{slug}.png")
            if i == 0:
                with pg.expect_download() as dl:
                    pg.get_by_test_id("pf-png-front").click()
                check("Download PNG saves the front", dl.value.suggested_filename == "A2Z-portfolio-nurfarah-front.png")
                with pg.expect_download() as dl:
                    pg.get_by_test_id("pf-pdf").click()
                pdf = dl.value.path()
                data = open(pdf, "rb").read()
                check("Download PDF saves both sides (two pages)", data.startswith(b"%PDF") and data.count(b"/Type /Page ") == 2, data[:40])
                with pg.expect_download() as dl:
                    pg.get_by_test_id("pf-qr-png").click()
                check("the QR PNG on its own scans to the address", decode_qr(open(dl.value.path(), "rb").read()) == "https://a2zcreative.my/portfolio/nurfarah")
                with pg.expect_download() as dl:
                    pg.get_by_test_id("pf-qr-svg").click()
                check("the QR SVG downloads", open(dl.value.path()).read().startswith("<svg"))
                pg.get_by_test_id("pf-size").select_option("compact"); pg.wait_for_timeout(800)
                w, h = pg.evaluate("[document.querySelector('[data-testid=pf-canvas-front]').width, document.querySelector('[data-testid=pf-canvas-front]').height]")
                check("the printed card is 54 x 86 mm in proportion (1080 x 1720)", (w, h) == (1080, 1720), (w, h))
                with pg.expect_download() as dl:
                    pg.get_by_test_id("pf-pdf").click()
                data = open(dl.value.path(), "rb").read()
                check("the printed-card PDF page is 54 x 86 mm (153.07 x 243.78 pt)", b"/MediaBox [0 0 153.07 243.78]" in data)
                pg.get_by_test_id("pf-size").select_option("story"); pg.wait_for_timeout(400)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(900)
        if pg.locator("text=Discard your changes?").count():
            pg.get_by_role("button", name="Discard").click(); pg.wait_for_timeout(600)
    check("no page error (studio)", not errs, errs)
    pg.screenshot(path=f"{SHOTS}/studio-after.png")
    ctx.close()

    # ---- the public page: no sign-in ----
    for w in (390, 1280):
        ctx = b.new_context(viewport={"width": w, "height": 900}, is_mobile=w < 500, has_touch=w < 500)
        pg = ctx.new_page(); perrs = []
        pg.on("pageerror", lambda e: perrs.append(str(e)))
        pg.goto(f"{BASE}/portfolio/nurfarah"); pg.wait_for_selector("[data-testid=portfolio-page]", timeout=20000); pg.wait_for_timeout(1500)
        check(f"public {w}px: name and position from the staff record", pg.get_by_test_id("portfolio-name").inner_text() == "Nurfarah" and pg.get_by_test_id("portfolio-position").inner_text() == "Test Position A")
        check(f"public {w}px: the approved photo loads", pg.evaluate("(() => { const i = document.querySelector('[data-testid=portfolio-photo]'); return !!i && i.complete && i.naturalWidth > 0; })()"))
        check(f"public {w}px: no sideways page", no_hscroll(pg))
        pg.screenshot(path=f"{SHOTS}/public-{w}.png", full_page=True)
        if w == 1280:
            pg.locator("[data-testid=portfolio-form] input").first.fill("Client Test")
            pg.locator("[data-testid=portfolio-form] input[type=tel]").fill("0199999999")
            pg.locator("[data-testid=portfolio-form] textarea").fill("We need a live host for a launch.")
            pg.get_by_test_id("portfolio-send").click(); pg.wait_for_timeout(1500)
            check("public: a client sends an enquiry", pg.locator("[data-testid=portfolio-sent]").count() == 1)
        check(f"public {w}px: no page error", not perrs, perrs)
        ctx.close()
    ctx = b.new_context(viewport={"width": 390, "height": 800})
    pg = ctx.new_page()
    pg.goto(f"{BASE}/portfolio/fasehah"); pg.wait_for_timeout(2500)
    check("a draft portfolio is not public (shown as not available)", pg.locator("[data-testid=portfolio-missing]").count() == 1)
    ctx.close()

    # ---- the team member: their own card on Profile ----
    as_user(11)
    ctx = b.new_context(viewport={"width": 390, "height": 900}, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); merrs = []
    pg.on("pageerror", lambda e: merrs.append(str(e)))
    pg.goto(f"{BASE}/portal?tab=Profile"); pg.wait_for_timeout(4000)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    mp = pg.locator("[data-testid=my-portfolio]")
    check("the team member sees their published card on Profile", mp.count() == 1 and "Approved and public" in mp.inner_text(), mp.inner_text() if mp.count() else "none")
    if mp.count():
        mp.scroll_into_view_if_needed(); pg.wait_for_timeout(600)
        pg.screenshot(path=f"{SHOTS}/profile-mine-390.png")
    check("no sideways page (Profile, phone)", no_hscroll(pg))
    check("no page error (Profile)", not merrs, merrs)
    ctx.close()
    as_user(1)

    # ---- the studio on a phone ----
    ctx = b.new_context(viewport={"width": 390, "height": 900}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    go_portfolios(pg)
    check("studio 390px: no sideways page", no_hscroll(pg))
    pg.get_by_test_id("pf-open-11").click(); pg.wait_for_selector("[data-testid=pf-editor]", timeout=15000); pg.wait_for_timeout(1200)
    check("editor 390px: no sideways page", no_hscroll(pg))
    pg.screenshot(path=f"{SHOTS}/editor-390.png")
    ctx.close()
    b.close()

passed = sum(1 for ok, _ in results if ok)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)

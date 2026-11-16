"""THE CLOCK-IN / CLOCK-OUT CONFIRMATION (v1.318.0) - in a browser (the CEO's
picture and words, 15-11-2026: "update for clock in and clock out when staff
click the button. make sure it is fit with PWA", then "A2Z OS change to my
own logo. make it standardize").

On Shift's one punch: while it is on its way a card says "Recording
attendance..."; when the server has recorded it, a sheet says what was
recorded - the time (Malaysia time), the hours or the shift, where it was by
the record's own outcome, who - and Done closes it. The company's own logo
(public/logo.png) heads both. v1.328.0: one compact modal centred in the
viewport at every width (90% up to 360 px, inside the safe areas), no
sideways page at 320-430 px, 44 px targets; outside the geofence is the
warning band and says Not GPS verified.

The fixture answers a clean punch as the worker does (/__punch?status=201):
outside the geofence by 17.4 km, 1h15 of overtime on a clock-out, a late
clock-in. The fixture's figures are invented (tests/browser/serve.mjs).

Servers: 4177 ceo, 4180 live_host
"""
from playwright.sync_api import sync_playwright
import re, urllib.request

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

CEO, HOST = 4177, 4180
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def arm(port, code=201, fresh=False): urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read(); urllib.request.urlopen(f"http://127.0.0.1:{port}/__punch?status={code}" + ("&fresh=1" if fresh else "")).read()

def open_shift(b, port, w, h=900):
    phone = w < 500
    ctx = b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone,
                        geolocation={"latitude": 3.139, "longitude": 101.6869, "accuracy": 12}, permissions=["geolocation"])
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=On%20Shift"); pg.wait_for_timeout(3600)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")
    return ctx, pg, errs

def press(pg, word):
    btn = pg.get_by_role("button", name=re.compile(rf"^\s*{word}", re.I)).filter(visible=True)
    if btn.count() == 0: return False
    btn.first.click(); return True

def run(b, port, who, w, exempt):
    tag = f"{who} {w}"
    arm(port)
    ctx, pg, errs = open_shift(b, port, w)
    ok = press(pg, "Clock Out")
    check(f"{tag}: Clock Out is there to press", ok, pg.locator("main").inner_text()[:200])
    if not ok: ctx.close(); return
    pg.wait_for_timeout(350)
    rec = pg.get_by_test_id("punch-recording")
    t = rec.first.inner_text() if rec.count() else ""
    check(f"{tag}: while the punch is on its way - 'Recording attendance...' under the company's logo", rec.count() == 1 and "Recording attendance" in t and "Please wait a moment." in t and rec.get_by_test_id("brand-logo").locator("img").get_attribute("src") == "/logo.png", t)
    pg.wait_for_timeout(2600)
    sheet = pg.get_by_test_id("punch-receipt")
    check(f"{tag}: the recording card is gone and the confirmation is shown", pg.get_by_test_id("punch-recording").count() == 0 and sheet.count() == 1)
    if sheet.count() == 0: ctx.close(); return
    st = sheet.inner_text()
    check(f"{tag}: Clock-Out Recorded!, in words", "Clock-Out Recorded!" in st and "You have clocked out for today." in st, st[:200])
    logo = sheet.get_by_test_id("brand-logo")
    check(f"{tag}: headed by the company's own logo and 'Attendance' - not a drawn 'A2Z OS' mark", logo.locator("img").get_attribute("src") == "/logo.png" and "Attendance" in logo.inner_text() and "A2Z OS" not in st, logo.inner_text())
    nat = pg.evaluate("(() => { const i = document.querySelector('[data-testid=punch-receipt] [data-testid=brand-logo] img'); return i ? i.naturalWidth : 0; })()")
    check(f"{tag}: the logo file loads", nat > 0, nat)
    check(f"{tag}: the date and the clock-out time in Malaysia time", re.search(r"(Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d{1,2} \w{3} \d{4}", st) is not None and re.search(r"^\d{2}:\d{2} MYT$", pg.get_by_test_id("punch-time").inner_text().strip()) is not None, st[:300])
    check(f"{tag}: Total Hours from the day's sessions", re.search(r"^\d+h \d{2}m$", pg.get_by_test_id("punch-hours").inner_text().strip()) is not None, pg.get_by_test_id("punch-hours").inner_text())
    place = pg.get_by_test_id("punch-place").inner_text()
    check(f"{tag}: the place is the record's own outcome - Outside Geofence (17.4 km), {'not tagged' if exempt else 'tagged for HR'}",
          "Outside Geofence (17.4 km)" in place and (("Recorded, not tagged" in place) if exempt else ("Recorded and tagged for HR" in place)), place)
    # v1.328.0 - recorded is not verified: outside is the warning band for everyone (the CEO is only never tagged)
    check(f"{tag}: outside the geofence is the warning band and says Not GPS verified - never green, never 'verified'",
          pg.get_by_test_id("punch-place").get_attribute("data-tone") == "warn" and "Not GPS verified" in place and "Location verified" not in place, place)
    check(f"{tag}: the overtime the clock-out measured is said on the same sheet", pg.get_by_test_id("punch-ot").count() == 1 and "1h15 overtime sent for approval" in pg.get_by_test_id("punch-ot").inner_text())
    check(f"{tag}: who recorded it, and when", re.search(r"Recorded by \S+", st) is not None)
    box = pg.evaluate("(() => { const s = document.querySelector('[data-testid=punch-receipt] [role=dialog]').getBoundingClientRect(); const d = document.querySelector('[data-testid=punch-done]').getBoundingClientRect(); const c = document.querySelector('[data-testid=punch-receipt] button[aria-label=Close]').getBoundingClientRect(); return { l: s.left, r: s.right, b: s.bottom, t: s.top, w: innerWidth, h: innerHeight, dh: d.height, ch: c.height, cw: c.width, db: d.bottom }; })()")
    # v1.328.0 (the CEO, 16-11-2026): a compact centred modal at EVERY width - never a bottom sheet or a full screen
    sw = box["r"] - box["l"]
    check(f"{tag}: a compact modal centred in the viewport - at most 360 px and 90% wide, floating off every edge",
          sw <= 361 and sw <= box["w"] * 0.9 + 1 and box["l"] >= 8 and box["r"] <= box["w"] - 8 and box["t"] >= 8 and box["b"] <= box["h"] - 8
          and abs((box["l"] + box["r"]) / 2 - box["w"] / 2) < 12 and abs((box["t"] + box["b"]) / 2 - box["h"] / 2) < 3, box)  # 12: the page's scrollbar gutter
    check(f"{tag}: it is as tall as what it holds (no full-height sheet)", box["b"] - box["t"] < box["h"] * 0.8, box)
    tap = pg.evaluate("(() => { const c = document.querySelector('[data-testid=punch-receipt] button[aria-label=Close]'); const a = getComputedStyle(c, '::after'); const r = c.getBoundingClientRect(); const i = parseFloat(a.top); return { w: r.width - 2 * i, h: r.height - 2 * i }; })()")
    check(f"{tag}: Done is a 44 px target and on screen; the X's tap ring is 44 px", box["dh"] >= 44 and tap["w"] >= 44 and tap["h"] >= 44 and box["db"] <= box["h"] + 1, (box, tap))
    check(f"{tag}: no sideways page", no_hscroll(pg))
    check(f"{tag}: focus is on Done", pg.evaluate("document.activeElement?.dataset?.testid") == "punch-done")
    pg.get_by_test_id("punch-done").click(); pg.wait_for_timeout(400)
    check(f"{tag}: Done closes it", pg.get_by_test_id("punch-receipt").count() == 0)

    ctx.close()
    check(f"{tag}: no page error", not errs, errs)

    # a day with no clock-in yet: the clock-in is late, so the verdict is said; the shift and its hours
    arm(port, fresh=True)
    ctx, pg, errs = open_shift(b, port, w)
    if press(pg, "Clock In"):
        pg.wait_for_timeout(3200)
        sheet = pg.get_by_test_id("punch-receipt")
        st = sheet.inner_text() if sheet.count() else ""
        sh = pg.get_by_test_id("punch-shift").inner_text() if sheet.count() else ""
        check(f"{tag}: Clock-In Recorded!, with the shift and its hours", "Clock-In Recorded!" in st and "You have clocked in for today." in st and "Shift 1" in sh and "10:00–18:00" in sh, st[:300])
        check(f"{tag}: the server's verdict keeps its words (Marked late)", pg.get_by_test_id("punch-note").count() == 1 and "Marked late" in pg.get_by_test_id("punch-note").inner_text())
        check(f"{tag}: clock-in wears the green, clock-out the gold", sheet.count() == 1 and sheet.get_attribute("data-kind") == "in")
        check(f"{tag}: clock-in: no sideways page", no_hscroll(pg))
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        check(f"{tag}: Escape closes it", pg.get_by_test_id("punch-receipt").count() == 0)
    else:
        check(f"{tag}: Clock In is there to press on a day with no clock-in", False, pg.locator("main").inner_text()[:200])
    ctx.close()
    check(f"{tag}: no page error (clock-in)", not errs, errs)

with sync_playwright() as p:
    b = p.chromium.launch()
    run(b, CEO, "ceo", 1440, True)
    run(b, HOST, "live_host", 390, False)

    # the narrow phones: the sheet fits, nothing runs off the side
    for w in [320, 360, 430]:
        arm(HOST)
        ctx, pg, errs = open_shift(b, HOST, w, h=640)
        if press(pg, "Clock Out"):
            pg.wait_for_timeout(3000)
            fit = pg.evaluate("(() => { const s = document.querySelector('[data-testid=punch-receipt] [role=dialog]'); if (!s) return null; const r = s.getBoundingClientRect(); const over = [...s.querySelectorAll('*')].filter(e => { const x = e.getBoundingClientRect(); return x.width > 0 && (x.right > innerWidth + 1 || x.left < -1); }).length; return { top: r.top, bottom: r.bottom, h: innerHeight, over, scrolls: s.scrollHeight > s.clientHeight }; })()")
            check(f"{w}x640: the modal is inside the screen and centred, nothing runs off the side, and it scrolls inside itself if it is taller", fit is not None and fit["top"] >= 8 and fit["bottom"] <= fit["h"] - 8 and fit["over"] == 0 and no_hscroll(pg) and abs((fit["top"] + fit["bottom"]) / 2 - fit["h"] / 2) < 3, fit)
        else:
            check(f"{w}x640: Clock Out is there to press", False)
        ctx.close()

    # a punch the server refuses is not "recorded": no sheet, the refusal keeps its words
    arm(CEO, 409)
    ctx, pg, errs = open_shift(b, CEO, 1440)
    if press(pg, "Clock Out"):
        pg.wait_for_timeout(2200)
        check("a refused punch shows no confirmation sheet", pg.get_by_test_id("punch-receipt").count() == 0)
    ctx.close()
    b.close()

fails = [n for n, ok in res if not ok]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
raise SystemExit(1 if fails else 0)

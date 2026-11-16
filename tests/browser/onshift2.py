"""ON SHIFT v2.0, RELEASE 1 (v1.294.0) - in a browser (the CEO's directive
"A2Z OS - ON SHIFT v2.0", 12-11-2026, with its photo; "approve
continuously", 13-11-2026). The source rules are held by tests/onshift2.mjs;
here, the screens:

  the photo's layout on a wide screen (My Shift beside Location Verification,
  then Today's Schedule / Punch Details / Quick Actions, the week, Team On
  Shift beside Recent Attendance) and the phone's order (My Shift, the punch,
  the location); no sideways page at eight widths; the location card's
  status, information panel and diagram (zoom works, and the map folds away
  on a phone); each punch's location word; the week's counts and an opened
  day; five recent days; Team On Shift's counts against its rows, its
  filters, sort and drawer - and no coordinates anywhere on the page, no
  request to any other host.

The fixture answers are invented (tests/browser/fixture.mjs); no production
record is used. Servers (servers.txt): 4177 ceo · 4179 coo · 4180 live_host
· 4182 sales_marketing.
"""
from playwright.sync_api import sync_playwright
import re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
COORD = re.compile(r"-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}")
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def ctx_for(b, w, h=900):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone)

def go(pg, port, wait=3200):
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=On%20Shift"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")

def top(pg, sel):
    loc = pg.locator(sel).first
    if loc.count() == 0: return None
    bb = loc.bounding_box()
    return bb

def openloc(pg):
    """v1.328.0 - the location card opens from My Shift's GPS line (a drawer)"""
    if pg.get_by_test_id("location-card").count() == 0 and pg.get_by_test_id("location-open").count():
        pg.get_by_test_id("location-open").click(); pg.wait_for_timeout(900)

def closeloc(pg):
    if pg.locator("[role=dialog] [data-testid=location-card]").count():
        pg.keyboard.press("Escape"); pg.wait_for_timeout(500)

def main_text(pg):
    return pg.locator("main").inner_text()

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the CEO at 1440: the photo's layout ----
    c = ctx_for(b, 1440, 1000)
    c.route("https://tile.openstreetmap.org/**", lambda r: r.abort())  # v1.297.0 - this run reads the distance diagram (the map's fallback); the map has its own run below
    pg = c.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    hosts = set(); pg.on("request", lambda r: hosts.add(re.sub(r"^https?://([^/]+).*$", r"\1", r.url)))
    go(pg, 4177)
    # v1.328.0 - R-3 (the CEO, 16-11-2026): five cards - My Shift (with the punch), Today, the team line, My days
    shift = top(pg, "section[aria-label='My shift']"); today = top(pg, "[data-testid=today-card]"); quick = top(pg, "[data-testid=shift-actions]")
    days = top(pg, "[data-testid=my-days]"); team = top(pg, "[data-testid=team-line]")
    check("every card of the page is drawn", all([shift, today, quick, days, team]))
    if all([shift, today, quick, days, team]):
        check("row 1: My Shift beside Today", abs(shift["y"] - today["y"]) < 4 and today["x"] > shift["x"] + shift["width"] - 4, (shift, today))
        check("the punch is inside My Shift", shift["y"] < quick["y"] < shift["y"] + shift["height"], (shift, quick))
        check("row 2: the team line across the page, then My days", team["y"] > shift["y"] + 100 and days["y"] > team["y"] and team["width"] > 1000 and days["width"] > 1000, (team, days))
    check("the location card is not on the page until asked for", pg.get_by_test_id("location-card").count() == 0)
    check("no sideways page at 1440", no_hscroll(pg))
    # the location card (v1.328.0: opened from the GPS line)
    openloc(pg)
    st = pg.get_by_test_id("location-status").inner_text() if pg.get_by_test_id("location-status").count() else ""
    check("the location card states the latest punch's verification", "geofence" in st.lower() or "pending" in st.lower(), st)
    lt = pg.get_by_test_id("location-card").inner_text()
    check("the information panel: site, radius, distance, verification, captured, accuracy",
          all(w in lt for w in ["Assigned work location", "Geofence radius", "Your distance", "Verification", "Location captured", "GPS accuracy"]) and "150 metres" in lt, lt[:300])
    check("the diagram is drawn with its legend and its honest caption", pg.get_by_test_id("fence-diagram").count() == 1 and "direction of the punch is not shown" in lt)
    svg = pg.locator("[data-testid=fence-diagram] svg[role=img]")
    lab0 = svg.get_attribute("aria-label") or ""
    check("the diagram says the distance in words", "metres away" in lab0, lab0)
    r0 = pg.evaluate("document.querySelector('[data-testid=fence-diagram] svg[role=img] circle').getAttribute('r')")
    pg.get_by_role("button", name="Zoom in").click(); pg.wait_for_timeout(200)
    r1 = pg.evaluate("document.querySelector('[data-testid=fence-diagram] svg[role=img] circle').getAttribute('r')")
    pg.get_by_role("button", name="Fit the site and the punch").click(); pg.wait_for_timeout(200)
    r2 = pg.evaluate("document.querySelector('[data-testid=fence-diagram] svg[role=img] circle').getAttribute('r')")
    check("zoom in enlarges the fence, and fit restores it", float(r1) > float(r0) and abs(float(r2) - float(r0)) < 0.01, (r0, r1, r2))
    check("the existing Check my location control lives in the card", pg.get_by_test_id("location-card").get_by_role("button", name="Check my location").count() == 1)
    closeloc(pg)
    # My Shift facts and the schedule
    ft = pg.get_by_test_id("shift-facts").inner_text()
    check("My Shift: status, break, overtime, work location and GPS status", all(w in ft.upper() for w in ["STATUS", "BREAK", "OVERTIME", "WORK LOCATION", "GPS STATUS"]) and "60 min" in ft, ft[:200])
    check("My Shift: the scheduled hours under the clock", "09:00" in pg.get_by_test_id("shift-scheduled").inner_text())
    sf = pg.get_by_test_id("schedule-facts").inner_text()
    check("Today's Schedule: location, expected work, the late rule and overtime eligibility", all(w in sf.upper() for w in ["WORK LOCATION", "EXPECTED WORK", "LATE AND HALF DAY", "OVERTIME"]) and "13:00" in sf, sf[:200])
    # punch details
    pd = pg.get_by_test_id("punch-details").inner_text()
    # the fixture's punches are outside the geofence on the 3rd, 10th, 17th and 24th: either way the location word is said
    check("Punch Details: the clock-in with its location and the clock-out still pending", "Clock In" in pd and ("Within geofence" in pd or "Outside geofence" in pd) and "Not yet recorded" in pd, pd[:200])
    check("one Clock Out button, in My Shift", pg.get_by_role("button", name=re.compile("^Clock Out")).count() == 1 and pg.get_by_test_id("shift-actions").get_by_role("button", name=re.compile("Clock Out")).count() == 1)
    # the week (v1.328.0: My days, This week first)
    figs = {k: pg.get_by_test_id(f"week-{k}").inner_text() for k in ["scheduled", "attended", "completed", "late", "missing", "leave", "pending"]}
    check("the week: seven counts", all(v.strip().isdigit() for v in figs.values()), figs)
    days = pg.get_by_test_id("week-day")
    check("the week: seven days", days.count() == 7, days.count())
    days.nth(0).click(); pg.wait_for_timeout(300)
    check("picking a day opens its detail", pg.get_by_test_id("week-detail").count() == 1 and "Status" in pg.get_by_test_id("week-detail").inner_text())
    days.nth(0).click(); pg.wait_for_timeout(300)
    check("...and picking it again closes it", pg.get_by_test_id("week-detail").count() == 0)
    # recent (v1.328.0: the second tab of My days)
    pg.get_by_test_id("days-tab-recent").click(); pg.wait_for_timeout(400)
    check("This week and Recent share one card: Recent shows, the week hides", pg.get_by_test_id("recent-attendance").is_visible() and not pg.get_by_test_id("week-summary").is_visible())
    rows = pg.get_by_test_id("recent-row")
    check("Recent Attendance: five rows at most, each with a location word", 0 < rows.count() <= 5 and all(rows.nth(i).locator("[data-loc]").count() == 1 or "—" in rows.nth(i).inner_text() for i in range(rows.count())), rows.count())
    rt = pg.get_by_test_id("recent-attendance").inner_text()
    # the fixture's outside days are fixed dates (the 3rd, 10th, 17th, 24th), so one is in the last five days only on some dates
    check("an outside day is said as recorded for the CEO (exempt), never red", ("Recorded · 132 m" in rt) or ("132 m" not in rt and "Outside" not in rt), rt[:300])
    # team (v1.328.0 - R-3: one line; the full register is Attendance > Overview)
    tl = pg.get_by_test_id("team-line").inner_text()
    check("Team: one line - on shift, not yet clocked in, clocked out, of the scheduled", all(w in tl for w in ["on shift", "not yet clocked in", "clocked out", "scheduled"]) and pg.get_by_test_id("team-on-shift").count() == 0, tl)
    on_n = int(pg.get_by_test_id("team-line-on").inner_text().split()[0])
    check("Team: the on-shift count is a number the monitor holds", on_n >= 0, on_n)
    pg.get_by_test_id("team-line-open").click(); pg.wait_for_timeout(1500)
    check("Team: View in Attendance opens Attendance", "Attendance" in pg.locator("main").inner_text()[:400] or pg.get_by_test_id("att-overview").count() == 1)
    go(pg, 4177)
    check("no coordinates anywhere on the page", not COORD.search(main_text(pg)))
    # v1.297.0 - the CEO asked for a real map: OpenStreetMap's tile host is the one other host, and only for map images
    check("no request to any other host but the map's tiles", all(h.startswith("127.0.0.1") or h.startswith("localhost") or h == "tile.openstreetmap.org" for h in hosts), hosts)
    check("no page error (CEO)", not errs, errs[:2])
    c.close()

    # ---- v1.297.0 - the real map (OpenStreetMap tiles; served here by a stub, the sandbox has no outside network) ----
    import struct, zlib
    def png1(r, g, b):
        raw = b"\x00" + bytes([r, g, b])
        def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
        return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    tile = png1(236, 233, 226)
    c = ctx_for(b, 1440, 1000)
    tiles = []
    c.route("https://tile.openstreetmap.org/**", lambda r: (tiles.append(r.request.url), r.fulfill(status=200, content_type="image/png", body=tile)))
    pg = c.new_page(); go(pg, 4177); openloc(pg)
    check("map: the location card draws the real map for the person's own day", pg.get_by_test_id("punch-map").count() == 1 and pg.get_by_test_id("fence-diagram").count() == 0)
    check("map: its tiles are OpenStreetMap's, and it says so", len(tiles) > 0 and all(t.startswith("https://tile.openstreetmap.org/") for t in tiles) and "© OpenStreetMap" in pg.get_by_test_id("punch-map").inner_text())
    lab = pg.get_by_test_id("punch-map").get_by_role("img").first.get_attribute("aria-label") or ""
    check("map: it names the site, the fence and the punch in words", "Setia Tropika office" in lab and "150 metre" in lab and "punch" in lab, lab)
    z0 = sorted({t.split("/")[3] for t in tiles}); n0 = len(tiles)
    pg.get_by_test_id("punch-map").get_by_role("button", name="Zoom in").click(); pg.wait_for_timeout(500)
    z1 = sorted({t.split("/")[3] for t in tiles[n0:]})
    check("map: zoom in asks for the next zoom's tiles", z1 and int(z1[-1]) == int(z0[-1]) + 1, (z0, z1))
    check("map: no coordinates are printed on the page", not COORD.search(pg.locator("main").inner_text()))
    c.close()
    c = ctx_for(b, 1440, 1000)
    c.route("https://tile.openstreetmap.org/**", lambda r: r.abort())
    pg = c.new_page(); go(pg, 4177, 5000); openloc(pg); pg.wait_for_timeout(1500)
    check("map: when the tiles cannot load, the distance diagram is shown and it says why",
          pg.get_by_test_id("fence-diagram").count() == 1 and "The map could not load" in pg.get_by_test_id("location-card").inner_text())
    c.close()

    # ---- the widths: no sideways page, no error card ----
    for port, who in [(4177, "ceo"), (4180, "host")]:
        for w in WIDTHS:
            c = ctx_for(b, w); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            go(pg, port)
            check(f"{who} @{w}: no sideways page, no error card, no page error",
                  no_hscroll(pg) and "Something went wrong on this screen" not in main_text(pg) and not errs, errs[:1])
            c.close()

    # ---- the live host on a phone: the order, the folded map, no team ----
    c = ctx_for(b, 390, 844)
    c.route("https://tile.openstreetmap.org/**", lambda r: r.fulfill(status=200, content_type="image/png", body=tile))
    pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, 4180)
    s = top(pg, "section[aria-label='My shift']"); q = top(pg, "[data-testid=shift-actions]"); t = top(pg, "[data-testid=today-card]")
    check("phone: My Shift with the punch inside it, then Today", s and q and t and s["y"] < q["y"] < t["y"] and q["y"] < s["y"] + s["height"], (s, q, t))
    openloc(pg)
    check("phone: the map is folded behind its button", not pg.get_by_test_id("punch-map").is_visible())
    pg.get_by_role("button", name="Show the map").click(); pg.wait_for_timeout(500)
    check("phone: ...and opens on a tap", pg.get_by_test_id("punch-map").is_visible())
    zb = pg.get_by_role("button", name="Zoom in").bounding_box()
    check("phone: the zoom buttons are 44 px targets", zb and zb["height"] >= 43.5 and zb["width"] >= 43.5, zb)
    closeloc(pg)
    check("phone: a host has no team line", pg.get_by_test_id("team-line").count() == 0 and pg.get_by_test_id("team-on-shift").count() == 0)
    check("phone: no page error", not errs, errs[:2])
    c.close()

    # ---- the COO reads the team; sales staff do not ----
    for port, who, team_expected in [(4179, "coo", True), (4182, "sales", False)]:
        c = ctx_for(b, 1280); pg = c.new_page(); go(pg, port)
        check(f"{who}: the team line {'shown' if team_expected else 'not shown'}", (pg.get_by_test_id("team-line").count() == 1) == team_expected)
        c.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\nonshift2: {len(res) - len(failed)}/{len(res)} passed")
if failed: raise SystemExit(1)

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

def main_text(pg):
    return pg.locator("main").inner_text()

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the CEO at 1440: the photo's layout ----
    c = ctx_for(b, 1440, 1000); pg = c.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    hosts = set(); pg.on("request", lambda r: hosts.add(re.sub(r"^https?://([^/]+).*$", r"\1", r.url)))
    go(pg, 4177)
    shift = top(pg, "section[aria-label='My shift']"); locc = top(pg, "[data-testid=location-card]")
    sched = top(pg, "section[aria-label=\"Today's schedule\"]"); punch = top(pg, "[data-testid=punch-details]"); quick = top(pg, "[data-testid=shift-actions]")
    week = top(pg, "[data-testid=week-summary]"); team = top(pg, "[data-testid=team-on-shift]"); recent = top(pg, "[data-testid=recent-attendance]")
    check("every card of the page is drawn", all([shift, locc, sched, punch, quick, week, team, recent]))
    if all([shift, locc, sched, punch, quick, week, team, recent]):
        check("row 1: My Shift beside Location Verification (location on the right)", abs(shift["y"] - locc["y"]) < 4 and locc["x"] > shift["x"] + shift["width"] - 4, (shift, locc))
        check("row 2: Schedule, Punch Details, Quick Actions side by side, under row 1",
              abs(sched["y"] - punch["y"]) < 4 and abs(punch["y"] - quick["y"]) < 4 and sched["x"] < punch["x"] < quick["x"] and sched["y"] > shift["y"] + 100)
        check("row 3: the week across the page", week["y"] > sched["y"] + 100 and week["width"] > 1000)
        check("row 4: Team On Shift beside Recent Attendance", abs(team["y"] - recent["y"]) < 4 and recent["x"] > team["x"] and team["width"] > recent["width"], (team, recent))
    check("no sideways page at 1440", no_hscroll(pg))
    # the location card
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
    # My Shift facts and the schedule
    ft = pg.get_by_test_id("shift-facts").inner_text()
    check("My Shift: status, break, overtime, work location and GPS status", all(w in ft.upper() for w in ["STATUS", "BREAK", "OVERTIME", "WORK LOCATION", "GPS STATUS"]) and "60 min" in ft, ft[:200])
    check("My Shift: the scheduled hours under the clock", "09:00" in pg.get_by_test_id("shift-scheduled").inner_text())
    sf = pg.get_by_test_id("schedule-facts").inner_text()
    check("Today's Schedule: location, expected work, the late rule and overtime eligibility", all(w in sf.upper() for w in ["WORK LOCATION", "EXPECTED WORK", "LATE AND HALF DAY", "OVERTIME"]) and "13:00" in sf, sf[:200])
    # punch details
    pd = pg.get_by_test_id("punch-details").inner_text()
    check("Punch Details: the clock-in with its location and the clock-out still pending", "Clock In" in pd and "Within geofence" in pd and "Not yet recorded" in pd, pd[:200])
    check("one Clock Out button, in Quick Actions", pg.get_by_role("button", name=re.compile("^Clock Out")).count() == 1 and pg.get_by_test_id("shift-actions").get_by_role("button", name=re.compile("Clock Out")).count() == 1)
    # the week
    figs = {k: pg.get_by_test_id(f"week-{k}").inner_text() for k in ["scheduled", "attended", "completed", "late", "missing", "leave", "pending"]}
    check("the week: seven counts", all(v.strip().isdigit() for v in figs.values()), figs)
    days = pg.get_by_test_id("week-day")
    check("the week: seven days", days.count() == 7, days.count())
    days.nth(0).click(); pg.wait_for_timeout(300)
    check("picking a day opens its detail", pg.get_by_test_id("week-detail").count() == 1 and "Status" in pg.get_by_test_id("week-detail").inner_text())
    days.nth(0).click(); pg.wait_for_timeout(300)
    check("...and picking it again closes it", pg.get_by_test_id("week-detail").count() == 0)
    # recent
    rows = pg.get_by_test_id("recent-row")
    check("Recent Attendance: five rows at most, each with a location word", 0 < rows.count() <= 5 and all(rows.nth(i).locator("[data-loc]").count() == 1 or "—" in rows.nth(i).inner_text() for i in range(rows.count())), rows.count())
    check("the outside day is said as recorded for the CEO (exempt), never red", "Recorded · 132 m" in pg.get_by_test_id("recent-attendance").inner_text())
    # team
    tr = pg.get_by_test_id("team-row")
    n = tr.count()
    fig = lambda k: int(pg.get_by_test_id(f"team-fig-{k}").inner_text())
    states = [tr.nth(i).inner_text() for i in range(n)]
    check("Team: On shift now equals the rows that say On Shift", fig("on") == sum("On Shift" in s for s in states), (fig("on"), states))
    check("Team: Clocked out equals the rows that say Clocked Out", fig("out") == sum("Clocked Out" in s for s in states))
    check("Team: scheduled headcount is not the on-shift headcount", fig("scheduled") >= fig("on"))
    pg.get_by_test_id("team-location").select_option("outside"); pg.wait_for_timeout(300)
    out_rows = pg.get_by_test_id("team-row").count()
    check("Team: the Outside filter keeps only the outside punches", out_rows >= 1 and all("Outside" in pg.get_by_test_id("team-row").nth(i).inner_text() or "Recorded" in pg.get_by_test_id("team-row").nth(i).inner_text() for i in range(out_rows)), out_rows)
    pg.get_by_test_id("team-location").select_option(""); pg.wait_for_timeout(200)
    pg.get_by_test_id("team-sort").select_option("name"); pg.wait_for_timeout(200)
    names = [pg.get_by_test_id("team-row").nth(i).locator("strong").first.inner_text() for i in range(pg.get_by_test_id("team-row").count())]
    check("Team: sort by name", names == sorted(names), names)
    pg.get_by_role("searchbox", name="Search staff on shift").fill("zzzz-nobody"); pg.wait_for_timeout(200)
    check("Team: a search with no match says so", "Nobody matches." in pg.get_by_test_id("team-on-shift").inner_text())
    pg.get_by_role("searchbox", name="Search staff on shift").fill(""); pg.wait_for_timeout(200)
    pg.get_by_test_id("team-row").first.click(); pg.wait_for_timeout(700)
    det = pg.get_by_test_id("team-detail")
    dt = det.inner_text() if det.count() else ""
    check("Team: a row opens the detail drawer with the attendance timeline", det.count() == 1 and "attendance timeline" in dt.lower() and "location exceptions" in dt.lower(), dt[:200])
    check("Team: the drawer shows distances only, never a position", not COORD.search(dt) and "exact positions are not shown" in dt)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    check("Team: Escape closes the drawer", pg.get_by_test_id("team-detail").count() == 0)
    check("no coordinates anywhere on the page", not COORD.search(main_text(pg)))
    check("no request to any other host (no map service)", hosts <= {"127.0.0.1", "localhost"} or all(h in ("127.0.0.1", "localhost") or h.startswith("127.0.0.1") or h.startswith("localhost") or h.startswith("data:") for h in hosts), hosts)
    check("no page error (CEO)", not errs, errs[:2])
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
    c = ctx_for(b, 390, 844); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    go(pg, 4180)
    s = top(pg, "section[aria-label='My shift']"); q = top(pg, "[data-testid=shift-actions]"); l = top(pg, "[data-testid=location-card]")
    check("phone: My Shift, then the punch, then the location", s and q and l and s["y"] < q["y"] < l["y"], (s, q, l))
    check("phone: the diagram is folded behind its button", not pg.get_by_test_id("fence-diagram").is_visible())
    pg.get_by_role("button", name="Show the location diagram").click(); pg.wait_for_timeout(300)
    check("phone: ...and opens on a tap", pg.get_by_test_id("fence-diagram").is_visible())
    zb = pg.get_by_role("button", name="Zoom in").bounding_box()
    check("phone: the zoom buttons are 44 px targets", zb and zb["height"] >= 43.5 and zb["width"] >= 43.5, zb)
    check("phone: a host has no Team On Shift", pg.get_by_test_id("team-on-shift").count() == 0)
    check("phone: no page error", not errs, errs[:2])
    c.close()

    # ---- the COO reads the team; sales staff do not ----
    for port, who, team_expected in [(4179, "coo", True), (4182, "sales", False)]:
        c = ctx_for(b, 1280); pg = c.new_page(); go(pg, port)
        check(f"{who}: Team On Shift {'shown' if team_expected else 'not shown'}", (pg.get_by_test_id("team-on-shift").count() == 1) == team_expected)
        c.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\nonshift2: {len(res) - len(failed)}/{len(res)} passed")
if failed: raise SystemExit(1)

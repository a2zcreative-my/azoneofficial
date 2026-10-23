"""PAYROLL FIGURES - the regression for the v1.198.0 Payroll redesign.

The owner, 23-10-2026: "Do not change ANY existing salary calculations ...
verify existing calculations with regression tests." The figures below were
captured from the payroll screen BEFORE the redesign (v1.197.0), on the
fixture's September 2026 run (tests/browser/fixture.mjs): a full month, OT
approved after the row was saved, half a day unpaid, a mid-month joiner with
a public holiday worked and a salary advance, and a part-time live host paid
by the hour. The test types the same manual deduction into every row, presses
Save all, and asserts the TOTAL row and every POSTed body - net, OT pay, days
- are the same to the cent.

Run against the static build with the fixture server (ROLE defaults to ceo):
    node tests/browser/serve.mjs out 4177 &
    xvfb-run -a python3 tests/browser/payroll-figures.py
"""

import json
import re
import sys

from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "4177"
NAMES = {9001: "Fixture Person", 9002: "Nur Aisyah binti Rahman", 9003: "Farid Zulkifli", 9004: "Tan Mei Ling"}

# captured from v1.197.0 (the screen before the redesign)
TOTALS_BEFORE = ["RM 9,000.00", "RM 153.85", "RM 200.00", "RM 37.86", "RM 801.67", "RM 8,590.04"]
TOTALS_AFTER = ["RM 9,000.00", "RM 153.85", "RM 200.00", "RM 37.86", "RM 851.03", "RM 8,540.68"]
SAVED = {
    9001: {"basic_cents": 400000, "allowance_cents": 0, "deduction_cents": 1234, "ot_cents": 0, "net_cents": 398766, "worked_days": 20, "month_working_days": 22, "salary_advance_cents": 0},
    9002: {"basic_cents": 210000, "allowance_cents": 15000, "deduction_cents": 1234, "ot_hours": 2.5, "ot_cents": 3786, "net_cents": 224052, "worked_days": 19, "month_working_days": 22, "salary_advance_cents": 0},
    9003: {"basic_cents": 0, "allowance_cents": 5000, "deduction_cents": 1234, "ot_cents": 0, "net_cents": 93766, "worked_days": None, "month_working_days": None, "salary_advance_cents": 0},
    9004: {"basic_cents": 200000, "allowance_cents": 0, "deduction_cents": 1234, "ot_cents": 0, "net_cents": 137484, "worked_days": 14, "month_working_days": 22, "salary_advance_cents": 10000},
}

failed = 0


def check(name, ok, extra=""):
    global failed
    print(("PASS " if ok else "FAIL ") + name + (f" — {extra}" if extra and not ok else ""))
    if not ok:
        failed += 1


money = lambda t: re.findall(r"RM\s?[\d,]+\.\d\d", t)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    pg.clock.set_fixed_time("2026-09-18T02:00:00Z")
    posts, errs = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: posts.append((r.url, r.post_data)) if r.method == "POST" and r.url.endswith("/staff/payroll") else None)
    pg.goto(f"http://127.0.0.1:{PORT}/portal")
    pg.wait_for_timeout(2500)
    pg.get_by_role("button", name="Payroll", exact=True).first.click()
    pg.wait_for_timeout(3500)
    pg.get_by_role("tab", name="Payroll Processing").first.click()
    pg.wait_for_timeout(800)
    check("TOTAL row as before the redesign", money(pg.locator("#payroll-table tfoot").inner_text()) == TOTALS_BEFORE)
    for name in NAMES.values():
        pg.get_by_label(f"Deduction (manual) — {name}", exact=True).fill("12.34")
    pg.wait_for_timeout(400)
    check("TOTAL row after the same edit", money(pg.locator("#payroll-table tfoot").inner_text()) == TOTALS_AFTER)
    posts.clear()
    pg.get_by_role("button", name="Save all").first.click()
    pg.wait_for_timeout(2500)
    bodies = {json.loads(d)["user_id"]: json.loads(d) for _, d in posts if d}
    check("Save all posts every row", sorted(bodies) == sorted(SAVED), str(sorted(bodies)))
    for uid, want in SAVED.items():
        got = bodies.get(uid, {})
        diff = {k: (got.get(k), v) for k, v in want.items() if got.get(k) != v}
        check(f"{NAMES[uid]}: net, OT pay and days to the cent", not diff, str(diff))
    check("no page errors", not errs, str(errs[:2]))
    b.close()

if failed:
    print(f"\n{failed} check(s) failed.")
    sys.exit(1)
print("PASS - every payroll figure is the one the screen gave before the redesign")

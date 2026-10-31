"""RELEASE C OF THE GO-LIVE PLAN (v1.243.0) - the client side, in a browser.

E1  the Payroll screen shows the server's Exceptions block: who the bank file
    cannot carry and why, the file and run totals; "Paid by hand..." records
    a manual payment (method - reference, the payslip's net) and a bad entry
    is refused before it is sent; a suspended login is a note with no button.
E3  Mark salary paid, refused by the server while someone is left behind,
    says who.
F3  a punch the server answers 401 is HELD for sign-in (shown, kept) and is
    sent again after the next sign-in with the same Idempotency-Key and
    pressed time; a punch older than the server's 48-hour window is handed to
    HR without being sent; a refused (409) punch is handed to HR with the
    server's reason; "HR has it" clears it.

Servers (tests/browser/serve.mjs on a production build in out/):
    POP=1 ROLE=ceo node tests/browser/serve.mjs out 4205
    POP=1 ROLE=ceo node tests/browser/serve.mjs out 4206     (fresh: nothing paid by hand)

    xvfb-run -a python3 tests/browser/release-c.py
"""
from playwright.sync_api import sync_playwright
import json, re, sys, urllib.request

PORT = 4205
BASE = f"http://127.0.0.1:{PORT}"
S = "/home/claude/work"
res = []
def check(n, c, x=""): res.append(("PASS " if c else "FAIL ") + n + (f" — {x}" if x and not c else ""))
def status(): return json.loads(urllib.request.urlopen(f"{BASE}/__fixture-status").read())
def punch(code): urllib.request.urlopen(f"{BASE}/__punch?status={code}").read()
def onshift(pg):
    pg.get_by_role("button", name="On Shift", exact=True).first.click(); pg.wait_for_timeout(1500)

SEED = """async (entries) => {
  const db = await new Promise((ok, bad) => {
    const r = indexedDB.open("azone-outbox", 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore("queue", { keyPath: "id" }); s.createIndex("createdAt", "createdAt"); };
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  });
  await new Promise((ok) => { const t = db.transaction("queue", "readwrite"); const s = t.objectStore("queue");
    const now = Date.now();
    for (const e of entries) {
      const at = now - e.agoMin * 60000;
      s.put({ id: e.id, path: "/staff/attendance", method: "POST", body: JSON.stringify({ type: e.type }), kind: "punch",
              clientAt: new Date(at).toISOString(), createdAt: at, attempts: 0, scope: "9001", nextAt: 0, state: "queued" });
    }
    t.oncomplete = ok; });
  db.close();
  return true;
}"""
COUNT = """async () => {
  const db = await new Promise((ok) => { const r = indexedDB.open("azone-outbox", 1); r.onsuccess = () => ok(r.result); });
  const all = await new Promise((ok) => { const g = db.transaction("queue").objectStore("queue").getAll(); g.onsuccess = () => ok(g.result); });
  db.close();
  return all.map((e) => ({ id: e.id, state: e.state ?? null, reason: e.reason ?? null }));
}"""

for port in (4205, 4206): urllib.request.urlopen(f"http://127.0.0.1:{port}/__reset").read()

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- E1: the Exceptions block on the Payroll screen ----------------
    ctx = b.new_context(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.clock.set_fixed_time("2026-09-18T02:00:00Z")
    pg.goto(f"{BASE}/portal"); pg.wait_for_timeout(2500)
    pg.get_by_role("button", name="Payroll", exact=True).first.click(); pg.wait_for_timeout(3500)
    # the block sits on the Payroll Overview, with the other alerts (the default tab)
    check("Payroll opens on Overview", pg.get_by_role("tab", name="Overview", selected=True).count() >= 1)
    blk = pg.locator("[aria-label='Payroll exceptions']")
    blk.wait_for(state="visible", timeout=8000)
    check("the Exceptions block is shown", blk.count() == 1)
    t = blk.inner_text() if blk.count() else ""
    check("it says how many the bank file cannot pay", "1 in this run cannot be paid by the bank file" in t, t[:200])
    check("it gives the bank file and run totals", "Bank file: 2 payees, RM 6,240.52" in t and "run total RM 7,190.52" in t, t[:300])
    check("Farid: no bank details, blocks Paid", "Farid Zulkifli - no bank details" in t and "blocks Paid" in t)
    check("Tan: a suspended login is a note - still paid", "Tan Mei Ling - login suspended, still paid" in t)
    lines = blk.locator("li")
    farid = lines.filter(has_text="Farid Zulkifli"); tan = lines.filter(has_text="Tan Mei Ling")
    check("only the blocking line offers Paid by hand", farid.get_by_role("button", name=re.compile("Paid by hand")).count() == 1 and tan.get_by_role("button").count() == 0)
    pg.screenshot(path=f"{S}/rc-exceptions.png")
    # a bad entry is refused on the phone, nothing sent
    farid.get_by_role("button", name=re.compile("Paid by hand")).click(); pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog").filter(has_text="Paid Farid Zulkifli by hand?")
    check("the dialog says the amount is the payslip's net", dlg.count() == 1 and "net pay" in dlg.inner_text())
    dlg.get_by_role("textbox").fill("handed over in the office")
    dlg.get_by_role("button", name="Record manual payment").click(); pg.wait_for_timeout(800)
    sent = lambda: [r for r in reqs if r[0] == "POST" and r[1].endswith("/staff/payroll/manual-payment")]
    check("without a method it is refused before it is sent", len(sent()) == 0 and "Start with the method" in pg.inner_text("body"))
    farid.get_by_role("button", name=re.compile("Paid by hand")).click(); pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog").filter(has_text="Paid Farid Zulkifli by hand?")
    dlg.get_by_role("textbox").fill("cash - voucher 12")
    dlg.get_by_role("button", name="Record manual payment").click(); pg.wait_for_timeout(2500)
    body = json.loads(sent()[0][2]) if sent() else {}
    check("one POST /payroll/manual-payment with method, reference and the net (RM 950.00)", len(sent()) == 1 and body.get("user_id") == 9003 and body.get("method") == "cash" and body.get("reference") == "voucher 12" and body.get("month") == "2026-09" and body.get("amount_cents") == 95000, str(body))  # Farid: 60 h x RM 15.00 + RM 50.00 allowance
    check("the toast says it is recorded", "manual payment recorded" in pg.inner_text("body"))
    blk = pg.locator("[aria-label='Payroll exceptions']"); t = blk.inner_text() if blk.count() else ""
    check("after the reload Farid reads paid by hand, with the method and reference, and no button", "Farid Zulkifli - paid by hand" in t and "cash - voucher 12" in t and blk.get_by_role("button", name=re.compile("Paid by hand")).count() == 0, t[:300])
    check("nothing blocks any more", "cannot be paid by the bank file" not in t, t[:200])
    pg.screenshot(path=f"{S}/rc-manual.png")
    check("no page errors (Payroll)", not errs, str(errs)[:200])
    ctx.close()

    # ---------------- E3: Mark salary paid is refused, saying who ----------------
    # a second, fresh fixture server (POP=1, port 4206): nothing paid by hand yet
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)))
    pg.clock.set_fixed_time("2026-10-06T02:00:00Z")  # October: the card is September's payroll
    pg.goto("http://127.0.0.1:4206/portal"); pg.wait_for_timeout(2500)
    pg.get_by_role("button", name="Finance", exact=True).first.click(); pg.wait_for_timeout(2500)
    pg.get_by_role("tab", name="Expenses", exact=True).first.click(); pg.wait_for_timeout(2500)
    btn = pg.get_by_role("button", name="Mark salary paid")
    check("Finance -> Expenses offers Mark salary paid for September", btn.count() == 1)
    if btn.count():
        btn.first.click(); pg.wait_for_timeout(1500)
    paid = [r for r in reqs if r[0] == "POST" and r[1].endswith("/staff/payroll/paid")]
    check("one POST /payroll/paid for 2026-09", len(paid) == 1 and json.loads(paid[0][2]).get("month") == "2026-09", str(paid))
    t = pg.inner_text("body")
    check("the refusal says who cannot be paid and what to do", "Not recorded" in t and "Farid Zulkifli (no bank details)" in t and "record a manual payment" in t)
    check("the card still reads DUE, not PAID", "PAID" not in pg.locator("text=Staff payroll").first.locator("xpath=ancestor::div[2]").inner_text())
    pg.screenshot(path=f"{S}/rc-paid-refused.png")
    check("no page errors (Expenses)", not errs, str(errs)[:200])
    ctx.close()

    # ---------------- F3: offline punches ----------------
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{BASE}/portal"); pg.wait_for_timeout(2500)
    before = len(status()["punch_log"])
    punch(401)
    pg.evaluate(SEED, [{"id": "held-0001", "type": "clock_in", "agoMin": 10}, {"id": "late-0002", "type": "clock_out", "agoMin": 3 * 24 * 60}])
    pg.reload(); pg.wait_for_timeout(3000); onshift(pg)
    log = status()["punch_log"][before:]
    check("the 10-minute-old punch was sent once and answered 401", len(log) == 1 and log[0]["key"] == "held-0001" and log[0]["status"] == 401, str(log))
    check("the 3-day-old punch was not sent at all", all(x["key"] != "late-0002" for x in log))
    q = {e["id"]: e for e in pg.evaluate(COUNT)}
    check("both are still on the phone: held for sign-in, and with HR", q.get("held-0001", {}).get("state") == "held_signin" and q.get("late-0002", {}).get("state") == "needs_hr", str(q))
    held = pg.get_by_test_id("held-signin")
    check("On Shift says: Sign in to send 1 waiting punch", held.count() == 1 and "Sign in to send 1 waiting punch" in held.inner_text())
    hr = pg.get_by_test_id("needs-hr")
    check("and: Tell HR, with the pressed time and the reason", hr.count() == 1 and "Tell HR" in hr.inner_text() and "Clock out pressed" in hr.inner_text() and "older than 48 hours" in hr.inner_text(), hr.inner_text()[:200] if hr.count() else "none")
    check("nothing is called recorded", "recorded" not in pg.get_by_test_id("waiting-punches").inner_text().lower())
    check("the connection line does not call them sending", "kept while you were offline" not in pg.inner_text("body"))
    pg.screenshot(path=f"{S}/rc-held.png")
    # signed in again: the held punch goes, same key, same pressed time
    punch(200)
    first = log[0]
    pg.reload(); pg.wait_for_timeout(3500); onshift(pg)
    log2 = status()["punch_log"][before + 1:]
    check("after the next sign-in the held punch is sent again", len(log2) == 1 and log2[0]["status"] == 200, str(log2))
    check("with the same Idempotency-Key and the same pressed time, as a replay", bool(log2) and log2[0]["key"] == first["key"] and log2[0]["client_at"] == first["client_at"] and log2[0]["replay"] == "1", str(log2))
    q = {e["id"]: e for e in pg.evaluate(COUNT)}
    check("it has left the phone; the HR one stays", "held-0001" not in q and q.get("late-0002", {}).get("state") == "needs_hr", str(q))
    check("the sign-in line is gone", pg.get_by_test_id("held-signin").count() == 0)
    pg.get_by_test_id("needs-hr").get_by_role("button", name="HR has it").click(); pg.wait_for_timeout(1200)
    q = pg.evaluate(COUNT)
    check("HR has it clears it from the phone and the screen", not q and pg.get_by_test_id("needs-hr").count() == 0, str(q))
    # a refused punch (409) goes to HR with the server's reason
    punch(409)
    pg.evaluate(SEED, [{"id": "leave-0003", "type": "clock_in", "agoMin": 5}])
    pg.reload(); pg.wait_for_timeout(3000); onshift(pg)
    q = {e["id"]: e for e in pg.evaluate(COUNT)}
    hr = pg.get_by_test_id("needs-hr")
    check("a refused punch is kept for HR with the server's reason", q.get("leave-0003", {}).get("state") == "needs_hr" and hr.count() == 1 and "approved annual leave" in hr.inner_text(), str(q))
    pg.screenshot(path=f"{S}/rc-needs-hr.png")
    punch(200)
    check("no page errors (On Shift)", not errs, str(errs)[:200])
    ctx.close()
    b.close()

for r in res: print(r)
fails = [r for r in res if r.startswith("FAIL")]
print(f"\n{len(res) - len(fails)} of {len(res)} passed")
sys.exit(1 if fails else 0)

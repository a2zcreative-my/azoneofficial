"""v1.332.0 - the Payment & No Refund Policy on the customer's shared link (the
CEO, 17-11-2026), for BOTH companies, in a real browser against the built site.

  - a shared INVOICE of each company shows the approved policy, word for
    word, ABOVE the PAYMENT heading, under that company's own letterhead and
    bank account, on one A4 page when printed
  - a shared QUOTATION shows it above COMMITMENT ORDER CONFIRMATION, and the
    online acceptance shows it above the tick box, which names it
  - the two companies print the same words

Server (servers.txt): 4177 ROLE=ceo. Invented customer only.
  python3 tests/browser/payment-policy.py"""
import os, subprocess, sys
from playwright.sync_api import sync_playwright

S = os.environ.get("SHOTS", "/tmp/pp-shots"); os.makedirs(S, exist_ok=True)
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{str(detail)[:300]}]"))

P1 = "Upon receipt and confirmation of payment, the Company will commence or continue the agreed services according to the approved project scope and timeline."
P2 = "All payments are non-refundable once work has commenced, except where required by applicable law. Any changes to the agreed scope or timeline must be mutually agreed upon in writing."
TOK = {("a2z", "QT"): "a1" + "0" * 30, ("a2z", "INV"): "a2" + "0" * 30, ("azoo", "QT"): "b1" + "0" * 30, ("azoo", "INV"): "b2" + "0" * 30}
NAME = {"a2z": "A2Z CREATIVE MARKETING", "azoo": "AZ ONE OFFICIAL"}
BANK = {"a2z": "MAYBANK 5511 0086 5300", "azoo": "MAYBANK 5516 2328 7032"}

seen = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for (co, kind), tok in TOK.items():
        ctx = b.new_context(viewport={"width": 1280, "height": 1000}); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:4177/doc?t={tok}"); pg.wait_for_timeout(2200)
        fr = pg.frame_locator("iframe").first
        body = fr.locator("body").inner_text()
        pol = fr.locator("[data-policy=payment-no-refund]")
        txt = pol.inner_text() if pol.count() else ""
        seen[(co, kind)] = " ".join(txt.split())
        check(f"{co} {kind}: the policy is on the shared document, word for word", pol.count() == 1 and P1 in " ".join(txt.split()) and P2 in " ".join(txt.split()) and "PAYMENT & NO REFUND POLICY" in txt, txt[:200])
        hdr = "PAYMENT" if kind == "INV" else "COMMITMENT ORDER CONFIRMATION"
        above = fr.locator(".accept").evaluate(f"""(a) => {{ const p = a.querySelector('.policy'), h = [...a.querySelectorAll('.hdr')].find(x => x.textContent.trim() === {hdr!r}); return !!(p && h && p.getBoundingClientRect().bottom <= h.getBoundingClientRect().top); }}""")
        check(f"{co} {kind}: it sits above the {hdr} heading", above)
        check(f"{co} {kind}: under the company's own letterhead" + (" and bank account" if kind == "INV" else ""), NAME[co] in body and (kind != "INV" or BANK[co] in body) and NAME["azoo" if co == "a2z" else "a2z"] not in body)
        if kind == "QT":
            acc = pg.get_by_test_id("accept-policy")
            check(f"{co} QT: the online acceptance shows the policy above the tick box", acc.count() == 1 and P2 in " ".join(acc.inner_text().split()) and acc.bounding_box()["y"] < pg.locator("input[type=checkbox]").bounding_box()["y"])
            check(f"{co} QT: the tick box accepts the policy by name", "including the Payment & No Refund Policy" in pg.locator("label").filter(has=pg.locator("input[type=checkbox]")).inner_text())
            check(f"{co} QT: the paper's acceptance clause names it", "including the Payment & No Refund Policy" in " ".join(body.split()))
        # printed: one A4 page
        html = fr.locator("html").evaluate("e => e.outerHTML")
        pp = ctx.new_page(); pp.set_content(html); pp.wait_for_timeout(200)
        pdf = f"{S}/{co}-{kind}-print.pdf"; pp.pdf(path=pdf, format="A4", print_background=True)
        pages = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout.split("Pages:")[1].split()[0]
        check(f"{co} {kind}: prints on ONE A4 page", pages == "1", pages)
        pg.screenshot(path=f"{S}/{co}-{kind}-shared.png", full_page=True)
        check(f"{co} {kind}: no page errors", not errs, errs)
        ctx.close()
    b.close()

check("both companies print the same policy words", seen[("a2z", "INV")] == seen[("azoo", "INV")] == seen[("a2z", "QT")] == seen[("azoo", "QT")])
fails = [n for n, c in results if not c]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)

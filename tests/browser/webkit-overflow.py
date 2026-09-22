"""WebKitGTK (Safari's engine) overflow probe — v1.175.0, in the repo.

Chromium cannot stand in for this: the CEO's phone is Safari, and the v1.174.1
grid blowout was only reproducible in WebKit. Prerequisites (system packages,
NOT repository dependencies): webkit2gtk-driver, xvfb, python3-selenium.

    pnpm build && node tests/browser/serve.mjs out 4177 &
    WIDTH=402 xvfb-run -a python3 tests/browser/webkit-overflow.py

Original docstring: open the portal at a phone width,
walk the tabs, report every element past the page's content box - the check
Chromium cannot stand in for. Needs: serve-mock.mjs on PORT, Xvfb (run via
xvfb-run), WebKitWebDriver + MiniBrowser (webkit2gtk-driver)."""
import json, os, sys, time
from selenium import webdriver
from selenium.webdriver.common.by import By

BASE = os.environ.get("PREVIEW_URL", "http://127.0.0.1:4177")
WIDTH = int(os.environ.get("WIDTH", "402"))
TABS = os.environ.get("TABS", "Ecommerce,Sales,Enquiries,Sales Performance,Hankei's,Inventory,Assets,Hotels,ELFIA Store,Web Orders,ELFIA Traffic,HR,Attendance,On Shift,Tasks,News,Staff,Leave,Claims,Payroll,Finance,Commission,Accounting,Companies,Cards,Profile,Users").split(",")
SHOT = os.environ.get("SHOT")  # directory for screenshots, optional

opts = webdriver.WebKitGTKOptions()
opts.binary_location = "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser"
opts.add_argument("--automation")
driver = webdriver.WebKitGTK(options=opts)
driver.set_window_size(WIDTH, 900)
driver.get(BASE + "/portal")
driver.execute_script("try{localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang','en');localStorage.setItem('azone-theme','light')}catch(e){}")
driver.get(BASE + "/portal")
time.sleep(4)
inner = driver.execute_script("return [window.innerWidth, document.documentElement.clientWidth]")
print("viewport", inner, "ua", driver.execute_script("return navigator.userAgent")[:80])
if inner[0] != WIDTH:
    # the window includes MiniBrowser chrome; correct so the CONTENT is WIDTH wide
    driver.set_window_size(WIDTH + (WIDTH - inner[0]), 900)
    time.sleep(1)
    print("viewport now", driver.execute_script("return [window.innerWidth, document.documentElement.clientWidth]"))

MEASURE = r"""
const w0 = window.innerWidth;
const out = [];
const path = (el) => { const parts = []; let e = el; for (let i = 0; e && e !== document.body && i < 4; i++) { const cls = (typeof e.className === "string" ? e.className : "").split(/\s+/).filter(Boolean).slice(0, 3).join("."); parts.unshift(e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (cls ? "." + cls : "")); e = e.parentElement; } return parts.join(" > "); };
const scroll = document.querySelector("main") ?? document.body;
const mr = scroll.getBoundingClientRect();
const edge = mr.right - parseFloat(getComputedStyle(scroll).paddingRight || "0");
const w = Math.min(w0, edge);
const clipped = (el) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") { if (a.getBoundingClientRect().right <= w + 1) return true; } } return false; };
for (const el of document.querySelectorAll("main *")) {
  const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
  const cs = getComputedStyle(el); if (cs.position === "fixed" || cs.position === "sticky") continue; if (el.closest("header, nav, [role=dialog]")) continue;
  if ((r.right > w + 1 || r.left < -1) && !clipped(el)) out.push({ right: Math.round(r.right), left: Math.round(r.left), width: Math.round(r.width), path: path(el), text: (el.textContent || "").trim().slice(0, 60) });
}
out.sort((a, b) => b.right - a.right);
const paths = new Set(out.map((o) => o.path));
const top = out.filter((o) => { const parent = o.path.split(" > ").slice(0, -1).join(" > "); const p = out.find((x) => x.path === parent); return !(p && p.right === o.right); });
const cards = [...document.querySelectorAll("main .erp-card, main [class*=card]")].slice(0, 3).map((c) => Math.round(c.getBoundingClientRect().width));
return { docW: document.documentElement.scrollWidth, innerW: w0, mainW: Math.round(mr.width), mainClient: scroll.clientWidth, mainScroll: scroll.scrollWidth, edge: Math.round(edge), offenders: top.slice(0, 5), count: out.length, cards, shell: (() => { const s = document.getElementById("shell-scroll"); return s ? [s.clientWidth, s.scrollWidth] : null; })() };
"""

def measure(tab):
    m = driver.execute_script(MEASURE)
    # v1.174.3 - bool(): `A or B or (None)` returned None and crashed the sum.
    # A MISSING shell is itself a finding, not a pass: the tab did not render
    # the app shell (the Sales tab, 21-09-2026).
    bad = bool(m["docW"] > m["innerW"] + 1 or m["mainScroll"] > m["mainClient"] + 1 or m["count"] > 0
               or m["shell"] is None or (m["shell"] and m["shell"][1] > m["shell"][0] + 1))
    flag = "OVERFLOW" if bad else "ok"
    print(f"[{WIDTH}] {tab}: {flag} doc {m['docW']} inner {m['innerW']} main {m['mainW']} ({m['mainClient']}/{m['mainScroll']}) shell {m['shell']} cards {m['cards']} edge {m['edge']} past-edge {m['count']}")
    for o in m["offenders"]:
        print(f"    right={o['right']} left={o['left']} w={o['width']}  {o['path']}  \"{o['text']}\"")
    if SHOT:
        os.makedirs(SHOT, exist_ok=True)
        driver.save_screenshot(os.path.join(SHOT, f"wk-{tab.replace(' ', '_').replace(chr(39), '')}-{WIDTH}.png"))
    return bad

def click_tab(name):
    js = r"""
    const name = arguments[0];
    const btns = [...document.querySelectorAll('nav button')].filter((b) => b.textContent.trim() === name);
    if (btns.length) { btns[0].click(); return "primary"; }
    const more = [...document.querySelectorAll('button')].find((b) => /^(More|Lagi)$/.test(b.textContent.trim()));
    if (!more) return "no-more";
    more.click();
    return "more-opened";
    """
    r = driver.execute_script(js, name)
    if r == "more-opened":
        time.sleep(0.8)
        r2 = driver.execute_script(r"""
        const name = arguments[0];
        const dlg = document.querySelector('[role=dialog]');
        if (!dlg) return "no-dialog";
        const b = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
        if (!b) { const c = [...dlg.querySelectorAll('button')].find((b) => /close|tutup/i.test(b.getAttribute('aria-label') || '')); if (c) c.click(); return "not-in-more"; }
        b.click(); return "clicked";
        """, name)
        return r2
    return r

total = 0
total += measure("Dashboard")
for t in TABS:
    r = click_tab(t)
    if r not in ("primary", "clicked"):
        print(f"skip {t}: {r}")
        continue
    time.sleep(1.2)
    total += measure(t)
print(f"\n{total} tab(s) with overflow in WebKit at {WIDTH}px")
driver.quit()

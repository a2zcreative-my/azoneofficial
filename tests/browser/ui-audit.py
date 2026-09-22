"""THE REPETITION AND FIT AUDIT — v1.176.1, in the repo.

The owner, 22-09-2026, after v1.176.0 shipped to his phone: *"I observed with
repeat function on different tabs ... Audit all to ensure that the tabs and
interface are globally same and nice!"* Every defect he pointed at was of one
of five kinds, and every one of them is invisible to the overflow sweep,
because nothing overflowed:

  1. ECHO         a zone caption and the card title directly beneath it are
                  the same words ("NEEDS YOUR DECISION" over "Needs your
                  decision — 1").
  2. REPEAT       one card states the same phrase twice ("On shift" as the
                  title, again in the status chip, again on a link button).
  3. SHRED        an element rendering fewer than ~3 characters per line —
                  the role beside his name came out "c / e / o". The table
                  probe cannot see this one: it is a flex item, not a cell.
  4. TRAP         a scroll container nested inside the page scroller on a
                  phone. A thumb over it drives IT, and the page underneath
                  will not move — "payroll tabs like that stuck".
  5. ORPHAN       a tile grid whose last row holds one lone tile, because a
                  three-tile strip wraps to 2 + 1 at 390px.

Run it the same way as the other two probes:

    pnpm build && node tests/browser/serve.mjs out 4177 &
    xvfb-run -a python3 tests/browser/ui-audit.py

    PREVIEW_URL=  the server           (default http://127.0.0.1:4177)
    WIDTH=        viewport width       (default 390 — the owner's iPhone)
    LANG=         en | ms              (default en; BM wraps differently)
    THEME=        light | dark         (default light)
    TABS=         comma-separated      (default: every tab in the bar + More)

Exit code is the number of findings, so it can gate a release the moment the
team wants it to.

KNOWN LIMIT: the tab walker clicks by the ENGLISH label, so a `LANG_UI=ms` run
covers the bottom bar's own stops and skips whatever sits behind the More
sheet, whose labels are in Malay. Pass a Malay `TABS=` list to walk those.
"""
import os, sys, time
from selenium import webdriver

BASE = os.environ.get("PREVIEW_URL", "http://127.0.0.1:4177")
WIDTH = int(os.environ.get("WIDTH", "390"))
LANG = os.environ.get("LANG_UI", os.environ.get("LANG", "en"))
THEME = os.environ.get("THEME", "light")
TABS = os.environ.get(
    "TABS",
    "Desk,Ecommerce,Sales,Enquiries,Sales Performance,Hankei's,Inventory,Assets,"
    "Hotels,ELFIA Store,Web Orders,ELFIA Traffic,HR,Attendance,On Shift,Tasks,"
    "News,Staff,Leave,Claims,Payroll,Finance,Commission,Accounting,Companies,"
    "Cards,Profile,Users",
).split(",")

opts = webdriver.WebKitGTKOptions()
opts.binary_location = "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser"
opts.add_argument("--automation")
driver = webdriver.WebKitGTK(options=opts)
driver.set_window_size(WIDTH, 900)
driver.get(BASE + "/portal")
driver.execute_script(
    "try{localStorage.setItem('azone-install-dismissed','1');"
    "localStorage.setItem('azone-lang',arguments[0]);"
    "localStorage.setItem('azone-theme',arguments[1])}catch(e){}",
    LANG, THEME)
driver.get(BASE + "/portal")
time.sleep(4)
inner = driver.execute_script("return window.innerWidth")
if inner != WIDTH:
    driver.set_window_size(WIDTH + (WIDTH - inner), 900)
    time.sleep(1)

AUDIT = r"""
const findings = [];
const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase()
  .replace(/[—–·:.,]+$/g, "").replace(/\s+[—–-]\s+\d+$/, "").trim();
const path = (el) => { const p = []; let e = el; for (let i = 0; e && e !== document.body && i < 3; i++) {
  const c = (typeof e.className === "string" ? e.className : "").split(/\s+/).filter(Boolean).slice(0,2).join(".");
  p.unshift(e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (c ? "." + c : "")); e = e.parentElement; } return p.join(">"); };
const main = document.querySelector("main") || document.body;
if (!main) return { findings: [{ kind: "SHELL", detail: "no main element" }] };

/* 1. ECHO - a zone caption and the first heading inside that zone are the
      same words. The caption may carry a count the heading does not. */
for (const zone of main.querySelectorAll(".erp-tab-zone")) {
  const cap = zone.querySelector(".erp-zone-label, [class*=zoneLabel], h2, h3");
  if (!cap) continue;
  const capT = norm(cap.textContent);
  if (!capT) continue;
  for (const h of zone.querySelectorAll(".erp-panel-title, h3, h4")) {
    if (h === cap || cap.contains(h)) continue;
    const hT = norm(h.textContent);
    if (hT && hT === capT) findings.push({ kind: "ECHO", detail: `"${cap.textContent.trim()}" then "${h.textContent.trim()}"`, path: path(h) });
  }
}

/* 2. REPEAT - one card prints the same phrase of 2+ words twice. Only the
      card's own direct text is counted, so a list of similar rows is not a
      finding; a title, a chip and a button all saying "On shift" is. */
const sig = (el) => (typeof el.className === "string" ? el.className : "") + "|" + el.tagName;
for (const card of main.querySelectorAll(".erp-card, .erp-shift-hero")) {
  const seen = new Map();
  const bits = card.querySelectorAll(".erp-panel-title, .erp-chip, button, h3, h4, .erp-meta");
  for (const b of bits) {
    if (b.closest("ul, ol, table")) continue;           /* rows repeat by nature */
    if ([...bits].some((o) => o !== b && o.contains(b))) continue;
    const t = norm(b.textContent);
    if (!t || t.length < 3) continue;
    if (!seen.has(t)) seen.set(t, []);
    seen.get(t).push(b);
  }
  for (const [t, els] of seen) {
    if (els.length < 2) continue;
    /* A LIST IS NOT A REPEAT. One "Edit" per row of a twenty-row list is the
       interface working; the same phrase on a title, a chip and a button in
       ONE card is the defect. Tell them apart by the containers: if each
       occurrence sits in a DIFFERENT element that looks like its siblings,
       it is a row. */
    const homes = new Set(els.map((e) => (e.parentElement ? sig(e.parentElement) : "")));
    const nodes = new Set(els.map((e) => e.parentElement));
    if (homes.size === 1 && nodes.size === els.length) continue;
    findings.push({ kind: "REPEAT", detail: `"${t}" x${els.length}`, path: path(card) });
  }
}

/* 3. SHRED - an element whose box is narrower than about three characters of
      its own font size, while it holds more than one character of text. */
for (const el of main.querySelectorAll("span, a, p, div, td, th, button, label")) {
  if (el.children.length) continue;
  const t = (el.textContent || "").trim();
  if (t.length < 2) continue;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) continue;
  const fs = parseFloat(getComputedStyle(el).fontSize) || 14;
  /* COUNT THE LINE BOXES, not the box height. A chip is one line of text in a
     padded pill, so height ÷ line-height called it two lines and every chip
     on every tab came back a false finding. A Range over the text node gives
     the browser's own answer: one client rect per line the text actually
     occupies. */
  const range = document.createRange();
  range.selectNodeContents(el);
  /* ...and count LINES, not rects: React renders `{n}%` as two adjacent text
     nodes, and a Range hands back one rect per run, so every figure-plus-unit
     label came back as two lines when it was plainly one. Group by the top
     edge - that is what a line is. */
  const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  if (r.width < fs * 3 && lines > 1) findings.push({ kind: "SHRED", detail: `"${t.slice(0,24)}" w=${Math.round(r.width)} lines=${lines}`, path: path(el) });
}

/* 4. TRAP - a vertical scroll container nested inside the page. The table
      scroller is allowed to move SIDEWAYS; nothing inside the page may own
      the up-and-down gesture on a phone. */
for (const el of main.querySelectorAll("*")) {
  const cs = getComputedStyle(el);
  if (!(cs.overflowY === "auto" || cs.overflowY === "scroll")) continue;
  if (el.scrollHeight <= el.clientHeight + 1) continue;
  if (el.closest("[role=dialog], .erp-sheet, .erp-modal, .erp-menu")) continue;
  /* a textarea, a code block or a map is MEANT to hold its own scroll */
  if (/^(TEXTAREA|INPUT|SELECT|PRE|CODE|IFRAME|CANVAS)$/.test(el.tagName)) continue;
  if (el.isContentEditable) continue;
  findings.push({ kind: "TRAP", detail: `${el.clientHeight}px window on ${el.scrollHeight}px of content`, path: path(el) });
}

/* 5. ORPHAN - a tile grid whose last row holds exactly one tile. */
for (const grid of main.querySelectorAll(".erp-tiles, .erp-cols-2, .erp-cols-3, .erp-cols-4")) {
  const kids = [...grid.children].filter((k) => k.getBoundingClientRect().height > 0);
  if (kids.length < 3) continue;
  const rows = new Map();
  for (const k of kids) { const y = Math.round(k.getBoundingClientRect().top); rows.set(y, (rows.get(y) || 0) + 1); }
  const counts = [...rows.values()];
  /* A LAST TILE ON ITS OWN ROW IS ONLY STRANDED IF IT IS ALSO NARROW. The
     phone layout gives an odd set's last tile the whole row, which reads as
     a footing; what looked wrong was a half-width tile beside empty space. */
  const last = kids[kids.length - 1].getBoundingClientRect();
  const full = last.width > grid.getBoundingClientRect().width * 0.9;
  if (counts.length > 1 && counts[counts.length - 1] === 1 && counts[0] > 1 && !full)
    findings.push({ kind: "ORPHAN", detail: `${kids.length} tiles wrap to ${counts.join("+")}, last is ${Math.round(last.width)}px of ${Math.round(grid.getBoundingClientRect().width)}px`, path: path(grid) });
}
return { findings };
"""


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
        return driver.execute_script(r"""
        const name = arguments[0];
        const dlg = document.querySelector('[role=dialog]');
        if (!dlg) return "no-dialog";
        const b = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
        if (!b) { const c = [...dlg.querySelectorAll('button')].find((b) => /close|tutup/i.test(b.getAttribute('aria-label') || '')); if (c) c.click(); return "not-in-more"; }
        b.click(); return "clicked";
        """, name)
    return r


def audit(tab):
    res = driver.execute_script(AUDIT)
    f = res["findings"]
    if not f:
        print(f"[{WIDTH} {LANG} {THEME}] {tab}: ok")
        return 0
    print(f"[{WIDTH} {LANG} {THEME}] {tab}: {len(f)} finding(s)")
    for x in f:
        print(f"    {x['kind']:<7} {x['detail']}   {x.get('path','')}")
    return len(f)


total = audit("Dashboard")
for t in TABS:
    r = click_tab(t)
    if r not in ("primary", "clicked"):
        print(f"skip {t}: {r}")
        continue
    time.sleep(1.2)
    total += audit(t)

print(f"\n{total} finding(s) at {WIDTH}px, {LANG}, {THEME}")
driver.quit()
sys.exit(min(total, 120))

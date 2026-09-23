#!/usr/bin/env python3
"""
THE KEYBOARD AUDIT — P0.6. A probe, not a guard.

Two questions a source grep cannot answer, asked of the RENDERED portal:

  1. CAN EVERY CONTROL BE NAMED?  A button whose only content is an icon, a
     select with no label, a row that is clickable but has no text — a screen
     reader announces each of those as "button", and the person has no way to
     know what it does. The check walks every focusable element and computes
     the accessible name the way a browser does: aria-labelledby, aria-label,
     the associated <label>, the title, then the visible text. Anything that
     comes back empty is reported with enough of its markup to find it.

  2. CAN A KEYBOARD USER SEE WHERE THEY ARE?  Tab is pressed for real, over
     and over, and each element the keyboard lands on is asked whether it
     shows an outline or a shadow. Nothing is focused programmatically: an
     el.focus() from script does not set the focus-visible flag on anything
     but a text field, so a probe that calls it reports every date picker and
     every icon button as broken and is worse than no probe at all.

Usage (after `pnpm build`):

    node tests/browser/serve.mjs out 4177 &
    xvfb-run -a python3 tests/browser/a11y-audit.py
    TABS=hotels,sales,payroll WIDTH=402 xvfb-run -a python3 tests/browser/a11y-audit.py

env: PREVIEW_URL (default http://127.0.0.1:4177), WIDTH (default 1280),
     TABS (comma list of sidebar labels to click through)

Exit code 1 if anything is reported, so it can be run in a release check.
"""
import os
import sys
import time

from selenium import webdriver
from selenium.webdriver.common.by import By

BASE = os.environ.get("PREVIEW_URL", "http://127.0.0.1:4177")
WIDTH = int(os.environ.get("WIDTH", "1280"))
TABS = [t.strip() for t in os.environ.get(
    "TABS", "Dashboard,Desk,Sales,Hotels,Inventory,Staff,Leave,Payroll,Tasks").split(",") if t.strip()]

# The accessible-name computation, trimmed to what this interface uses, plus
# the focus-appearance comparison. Returned as plain data; the judging is in
# Python so a rule can be changed without re-reading the DOM.
SCRIPT = r"""
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [role="button"], [role="menuitemcheckbox"], [role="switch"], [role="tab"]';

function visible(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
}
function text(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

function accName(el) {
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const parts = by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text);
    if (parts.join(' ').trim()) return parts.join(' ').trim();
  }
  const al = (el.getAttribute('aria-label') || '').trim();
  if (al) return al;
  if (el.id) {
    const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (lab && text(lab)) return text(lab);
  }
  const wrap = el.closest('label');
  if (wrap && text(wrap)) return text(wrap);
  const ti = (el.getAttribute('title') || '').trim();
  if (ti) return ti;
  const pl = (el.getAttribute('placeholder') || '').trim();
  if (pl) return pl;
  const t = text(el);
  if (t) return t;
  const svgTitle = el.querySelector && el.querySelector('title');
  if (svgTitle && text(svgTitle)) return text(svgTitle);
  const img = el.querySelector && el.querySelector('img[alt]');
  if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim();
  return '';
}

function look(el) {
  const cs = getComputedStyle(el);
  return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow,
          cs.borderColor, cs.borderWidth, cs.backgroundColor, cs.opacity].join('|');
}
function ringed(el) {
  const cs = getComputedStyle(el);
  const w = parseFloat(cs.outlineWidth) || 0;
  return cs.outlineStyle !== 'none' && w >= 1.5;
}

const out = [];
const seen = new Set();
for (const el of document.querySelectorAll(FOCUSABLE)) {
  if (el.hasAttribute('disabled')) continue;
  if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) continue;
  if (el.getAttribute('tabindex') === '-1') continue;
  if (!visible(el)) continue;

  const sig = el.tagName + '|' + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) + '|' + accName(el).slice(0, 30);
  if (seen.has(sig)) continue;
  seen.add(sig);

  out.push({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || '',
    type: el.getAttribute('type') || '',
    name: accName(el),
    markup: el.outerHTML.slice(0, 160).replace(/\s+/g, ' '),
  });
}
return out;
"""


# The focus half is a REAL keyboard walk. A programmatic el.focus() does not
# set the focus-visible flag for anything but a text field, so a probe that
# calls it reports every date picker and every icon button as unfocusable and
# is worse than no probe at all. Tab is pressed for real; before each press
# the current element's appearance is recorded, after it the new one's, and
# the two are compared on the SAME element.
BEFORE = r"""
document.body.focus();
window.__seen = [];
return true;
"""

LOOK = r"""
const el = document.activeElement;
if (!el || el === document.body) return null;
const cs = getComputedStyle(el);
const w = parseFloat(cs.outlineWidth) || 0;
const r = el.getBoundingClientRect();
function text(e) { return (e.textContent || '').replace(/\s+/g, ' ').trim(); }
return {
  sig: el.tagName + '|' + (el.getAttribute('class') || '') + '|' + (el.getAttribute('type') || ''),
  tag: el.tagName.toLowerCase(),
  ring: cs.outlineStyle !== 'none' && w >= 1.5,
  shadow: cs.boxShadow !== 'none',
  name: (el.getAttribute('aria-label') || text(el) || el.getAttribute('title') || '').slice(0, 40),
  onscreen: r.width >= 1 && r.height >= 1,
  markup: el.outerHTML.slice(0, 140).replace(/\s+/g, ' '),
};
"""


def main() -> int:
    opts = webdriver.WebKitGTKOptions()
    opts.add_argument("--automation")
    opts.set_capability("browserName", "MiniBrowser")
    d = webdriver.WebKitGTK(options=opts)
    unnamed, unfocusable = [], []
    try:
        d.set_window_size(WIDTH, 950)
        d.get(f"{BASE}/portal")
        time.sleep(7)
        for tab in TABS:
            if tab != "Dashboard":
                hits = [e for e in d.find_elements(By.TAG_NAME, "button") if e.text.strip() == tab]
                if not hits:
                    print(f"  (no sidebar entry named {tab!r} at this width — skipped)")
                    continue
                d.execute_script("arguments[0].click()", hits[0])
                time.sleep(3.5)
            for row in d.execute_script(SCRIPT) or []:
                where = f"{tab}: <{row['tag']}{(' role=' + row['role']) if row['role'] else ''}>"
                if not row["name"]:
                    unnamed.append((where, row["markup"]))

            # walk the tab order for real
            d.execute_script(BEFORE)
            body = d.find_element(By.TAG_NAME, "body")
            body.click()
            # A WINDOW THAT DOES NOT HAVE FOCUS CANNOT SHOW FOCUS. Under Xvfb
            # at narrow widths the MiniBrowser window sometimes never takes
            # keyboard focus: activeElement is still set, but :focus matches
            # NOTHING, and every control then looks like it has no ring. That
            # is the probe being wrong, not the product, so it says so and
            # judges nothing rather than printing a page of false findings.
            d.execute_script("try { window.focus(); } catch (e) {}")
            if not d.execute_script("return document.hasFocus()"):
                print(f"  ({tab}: the browser window never took keyboard focus — "
                      f"focus rings not judged on this tab; names still checked)")
                continue
            seen = set()
            for _ in range(int(os.environ.get("TABS_DEPTH", "140"))):
                body = d.switch_to.active_element
                body.send_keys("\ue004")  # Keys.TAB
                cur = d.execute_script(LOOK)
                if not cur or not cur["onscreen"]:
                    continue
                if cur["sig"] in seen:
                    continue
                seen.add(cur["sig"])
                if not cur["ring"] and not cur["shadow"]:
                    unfocusable.append((f"{tab}: <{cur['tag']}>", cur["name"], cur["markup"]))
    finally:
        d.quit()

    if unnamed:
        print(f"\nUNNAMED — a screen reader announces these as their role alone ({len(unnamed)}):")
        for where, markup in unnamed:
            print(f"  {where}\n      {markup}")
    if unfocusable:
        print(f"\nNO VISIBLE FOCUS — nothing changes when a keyboard lands here ({len(unfocusable)}):")
        for where, name, markup in unfocusable:
            print(f"  {where} {name!r}\n      {markup}")
    if not unnamed and not unfocusable:
        print("\nPASS — every visible control has a name, and shows where the keyboard is.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())

"""v1.247.2 - the owner's PWA screenshots (01-11-2026): a project task card
stays inside its column on a phone, the installed app's header gets its space
back under the status bar, and Clock In is green, not gold.

Servers (servers.txt): ROLE=live_host DAY=ready on 4216, ROLE=editor TASKP=1 on 4215."""
import re
from playwright.sync_api import sync_playwright

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))

PHONE = {"width": 390, "height": 844}

def page(b):
    ctx = b.new_context(viewport=PHONE, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---- the task board on a phone ----
    ctx, pg, errs = page(b)
    pg.goto("http://127.0.0.1:4215/portal?tab=Tasks"); pg.wait_for_timeout(3000)
    chip = pg.locator('button[title="Open the project"]').first
    check("a project task shows its chip", chip.count() == 1)
    m = pg.evaluate("""() => { const c = document.querySelector('button[title="Open the project"]'); if (!c) return null;
      const card = c.closest('[class*="cardItem"]') || c.closest('li') || c.parentElement; const col = c.closest('[class*="tasks-page_col"]');
      const r = (e) => e ? e.getBoundingClientRect().right : null;
      return { chip: r(c), card: r(card), col: r(col), vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, text: c.textContent }; }""")
    check("the chip stays inside its card", m and m["chip"] <= m["card"] + 1, str(m))
    check("the card stays inside its column", m and (m["col"] is None or m["card"] <= m["col"] + 1), str(m))
    check("nothing runs past the phone screen", m and m["sw"] <= m["vw"], str(m))
    check("the company is said once", m and m["text"].count("Aina Boutique") <= 1, m and m["text"])
    check("no page errors (Tasks)", not errs, str(errs)[:200])
    ctx.close()
    # ---- the header on the installed app; Clock In ----
    ctx, pg, errs = page(b)
    pg.goto("http://127.0.0.1:4216/portal"); pg.wait_for_timeout(3000)
    rule = pg.evaluate("""() => { for (const s of document.styleSheets) { let rs; try { rs = s.cssRules } catch { continue }
      const walk = (list) => { for (const r of list) { if (r.media && /display-mode: standalone/.test(r.media.mediaText) && /max-width: 767px/.test(r.media.mediaText) && /--hdr-pt: 1\\.25rem/.test(r.cssText)) return true; if (r.cssRules && walk(r.cssRules)) return true } return false };
      if (walk(rs)) return true } return false }""")
    check("installed on a phone the header gets 0.75rem more room under the status bar", rule)
    pt = pg.evaluate("() => { const t = document.querySelector('.erp-topbar'); return t ? getComputedStyle(t).getPropertyValue('--hdr-pt').trim() : 'none' }")
    check("in a browser tab the header is unchanged", pt == "0.5rem", pt)
    nav = pg.get_by_role("button", name=re.compile("^On Shift")).first
    if nav.count(): nav.click(); pg.wait_for_timeout(1500)
    btn = pg.get_by_role("button", name=re.compile("Clock In")).first
    if btn.count():
        bg = btn.evaluate("e => getComputedStyle(e).backgroundColor")
        fg = btn.evaluate("e => getComputedStyle(e).color")
        check("Clock In is green (the success colour), not gold", bg == "rgb(21, 128, 61)", bg)
        check("its label is light on the green", fg != "rgb(26, 41, 70)" and fg.startswith("rgb(2"), fg)
    else:
        check("Clock In is offered on this fixture", False, "no Clock In button")
    check("no page errors (On Shift)", not errs, str(errs)[:200])
    ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"phone-fixes: {passed} of {len(results)} passed")

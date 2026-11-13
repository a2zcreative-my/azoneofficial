"""NEWS v2.0, RELEASE N1 (v1.295.0) - in a browser (the CEO's directive
"A2Z OS - NEWS v2.0", 12-11-2026, with its photo; "approve continuously",
13-11-2026). The source rules are held by tests/news2.mjs; the routes by
tests/news-acks.mjs. Here, the screens:

  the four tabs from the address and Back / Forward between them; staff see
  two tabs and a management address opens the feed; the feed's own figures,
  filters (category, flag, status, date), sort and ten a page; the reader
  beside the list on a wide screen and in a drawer on a phone, and opening a
  post acknowledges nothing; My Acknowledgements' three sections; Publish &
  Manage's list and composer (preview, confirm, draft on this device);
  Reports' strip, filters and CSV; no sideways page at eight widths; no
  invented views, likes or comments.

The fixture answers are invented (tests/browser/fixture.mjs). Servers
(servers.txt): 4177 ceo · 4180 live_host · 4182 sales_marketing.
"""
from playwright.sync_api import sync_playwright
import re

res = []
def check(n, c, x=""):
    res.append((n, bool(c)))
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  [{str(x)[:300]}]"), flush=True)

WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440]
no_hscroll = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def ctx_for(b, w, h=900):
    phone = w < 500
    return b.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce", is_mobile=phone, has_touch=phone, accept_downloads=True)

def go(pg, port, q="", wait=3000):
    pg.goto(f"http://127.0.0.1:{port}/portal?tab=Announcements{q}"); pg.wait_for_timeout(wait)
    pg.evaluate("document.querySelector('[data-testid=update-available]')?.remove()")

def view_of(pg):
    m = re.search(r"[?&]view=([a-z_]+)", pg.url)
    return m.group(1) if m else None

def tab(pg, name):
    pg.get_by_role("tab", name=re.compile("^" + re.escape(name))).filter(visible=True).first.click(); pg.wait_for_timeout(600)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- the CEO at 1440 ----
    c = ctx_for(b, 1440, 1000); pg = c.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    acks = []; pg.on("request", lambda r: acks.append(r.url) if r.method == "POST" and r.url.endswith("/ack") else None)
    go(pg, 4177)
    check("the feed opens and its view is in the address", view_of(pg) == "feed", pg.url)
    names = [re.sub(r"\d+$", "", t.inner_text().split("\n")[0].strip()) for t in pg.get_by_role("tab").filter(visible=True).all()]
    check("management sees the four tabs in order", names[:4] == ["News Feed", "My Acknowledgements", "Publish & Manage", "Reports & Archive"], names)
    check("the feed's own four figures", all(pg.get_by_test_id("news-stats").filter(visible=True).first.get_by_text(t).count() for t in ["Posts for you", "Waiting on you", "Acknowledged", "Important"]))
    cards = pg.get_by_test_id("news-card").filter(visible=True)
    check("ten posts a page, with the pager", cards.count() == 10 and pg.get_by_test_id("news-pager").filter(visible=True).count() == 1, cards.count())
    check("pinned first: the pinned post leads", "Pinned" in cards.first.inner_text(), cards.first.inner_text()[:80])
    check("the reader sits beside the list on a wide screen", pg.get_by_test_id("news-reader-inline").count() == 1)
    cards.nth(1).get_by_role("button").first.click(); pg.wait_for_timeout(500)
    rd = pg.get_by_test_id("news-reader-inline").inner_text()
    check("choosing a post shows it in the reader", cards.nth(1).locator("strong").first.inner_text() in rd, rd[:100])
    check("opening posts acknowledged nothing", acks == [], acks)
    check("the reader carries the acknowledge button for a waiting post", pg.get_by_test_id("news-reader-inline").get_by_role("button", name="I have read this - acknowledge").count() == 1)
    pg.get_by_test_id("news-filter-category").select_option("memo"); pg.wait_for_timeout(300)
    check("the category filter", cards.count() >= 1 and all("Memo" in cards.nth(i).inner_text() for i in range(cards.count())), cards.count())
    pg.get_by_test_id("news-filter-category").select_option(""); pg.get_by_test_id("news-filter-flag").select_option("important"); pg.wait_for_timeout(300)
    check("the important filter", cards.count() >= 1 and all("Important" in cards.nth(i).inner_text() for i in range(cards.count())))
    pg.get_by_test_id("news-filter-flag").select_option(""); pg.get_by_test_id("news-filter-status").select_option("acked"); pg.wait_for_timeout(300)
    check("my status: acknowledged", cards.count() >= 1 and all("Acknowledged" in cards.nth(i).inner_text() for i in range(cards.count())))
    pg.get_by_test_id("news-filter-status").select_option(""); pg.get_by_test_id("news-filter-date").select_option("7"); pg.wait_for_timeout(300)
    check("the date filter narrows the feed", cards.count() < 10, cards.count())
    pg.get_by_test_id("news-filter-date").select_option(""); pg.get_by_role("searchbox", name="Search announcements").fill("zzz-none"); pg.wait_for_timeout(300)
    check("no match says so, with a way to clear", "Nothing matches these filters." in pg.locator("main").inner_text() and pg.get_by_role("button", name="Clear the filters").count() == 1)
    pg.get_by_role("button", name="Clear the filters").click(); pg.wait_for_timeout(300)
    check("clearing brings the posts back", cards.count() == 10)
    txt = pg.locator("main").inner_text()
    check("no invented views, likes or comments", not re.search(r"\b\d+ (views|likes|comments)\b", txt, re.I))
    # My Acknowledgements
    tab(pg, "My Acknowledgements")
    check("My Acknowledgements is its own view in the address", view_of(pg) == "mine", pg.url)
    nact = pg.get_by_test_id("news-mine-row-action").count()
    check("Requires action lists the waiting posts (the tab's count)", nact > 0 and str(nact) in pg.get_by_role("tab", name=re.compile("^My Acknowledgements")).first.inner_text(), nact)
    pg.get_by_test_id("news-mine-done").click(); pg.wait_for_timeout(300)
    check("Acknowledged lists the acknowledged posts with their version", pg.get_by_test_id("news-mine-row-done").count() > 0 and " v1" in pg.get_by_test_id("news-mine-row-done").first.inner_text())
    pg.get_by_test_id("news-mine-history").click(); pg.wait_for_timeout(300)
    ht = " ".join(pg.get_by_test_id("news-mine-row-history").all_inner_texts())
    check("History says why each needs nothing", "Your post" in ht and pg.get_by_test_id("news-mine-row-history").count() >= 2, ht[:200])
    pg.get_by_test_id("news-mine-action").click(); pg.wait_for_timeout(200)
    pg.get_by_test_id("news-mine-row-action").first.click(); pg.wait_for_timeout(700)
    check("a row opens the reader in a drawer", pg.get_by_role("dialog").get_by_test_id("news-reader").count() == 1)
    check("...and still acknowledged nothing", acks == [], acks)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    # Publish & Manage
    tab(pg, "Publish & Manage")
    check("Publish & Manage in the address", view_of(pg) == "publish")
    check("the posts list with its actions", pg.get_by_test_id("news-manage-row").count() == 15 and pg.get_by_test_id("news-manage-row").first.get_by_role("button", name="Report").count() == 1)
    pg.get_by_test_id("news-manage-compose").click(); pg.wait_for_timeout(300)
    comp = pg.get_by_test_id("news-compose")
    check("the composer: basic information, audience, publishing, preview", all(t in comp.inner_text() for t in ["Basic information", "Audience", "Publishing", "Preview"]))
    comp.get_by_label(re.compile("^Subject")).fill("Fixture draft subject"); comp.locator("textarea").fill("A line\n* a point")
    pg.wait_for_timeout(900)
    pv = pg.get_by_test_id("news-preview").inner_text()
    check("the preview shows the words as staff will read them", "Fixture draft subject" in pv and "a point" in pv)
    pg.get_by_test_id("news-preview").get_by_role("button", name="Phone").click(); pg.wait_for_timeout(200)
    fw = pg.evaluate("document.querySelector('[data-testid=news-preview] [data-size]').getBoundingClientRect().width")
    check("the phone preview is phone-width", fw <= 380, fw)
    check("the draft is kept on this device", pg.evaluate("!!localStorage.getItem('a2z:news-draft')"))
    posts = []; pg.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/staff/announcements") else None)
    comp.get_by_role("button", name="Publish").click(); pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog")
    check("Publish asks first and names who will be notified", dlg.count() >= 1 and "all staff" in dlg.last.inner_text().lower(), dlg.last.inner_text()[:160] if dlg.count() else "")
    dlg.last.get_by_role("button", name="Cancel").click(); pg.wait_for_timeout(300)
    check("cancelling sends nothing and keeps the words", posts == [] and comp.get_by_label(re.compile("^Subject")).input_value() == "Fixture draft subject")
    pg.reload(); pg.wait_for_timeout(3000)
    pg.get_by_test_id("news-manage-compose").click(); pg.wait_for_timeout(300)
    check("after a reload the draft is offered back", pg.get_by_test_id("news-draft-found").count() == 1)
    pg.get_by_role("button", name="Discard it").click(); pg.wait_for_timeout(200)
    check("...and discarding removes it", not pg.evaluate("!!localStorage.getItem('a2z:news-draft')"))
    # Reports
    tab(pg, "Reports & Archive")
    check("Reports in the address", view_of(pg) == "reports")
    st = " ".join(pg.get_by_test_id("news-stats").filter(visible=True).all_inner_texts())
    check("the report's own five figures", all(t in st for t in ["Published", "To acknowledge", "Expected", "Acknowledged", "Outstanding"]) and "Posts for you" not in st, st[:200])
    rows = pg.get_by_test_id("news-report-row")
    check("fifteen report rows a page", rows.count() == 15, rows.count())
    pg.get_by_test_id("news-filter-rstate").select_option("done"); pg.wait_for_timeout(300)
    check("the completion filter keeps the complete posts", rows.count() >= 1 and all("100%" in rows.nth(i).inner_text() for i in range(rows.count())))
    with pg.expect_download() as d:
        pg.get_by_test_id("news-report-csv").click()
    dl = d.value
    check("the report exports as CSV", dl.suggested_filename.startswith("news-acknowledgement-report-") and dl.suggested_filename.endswith("-done.csv"), dl.suggested_filename)
    rows.first.get_by_role("button", name="Who").click(); pg.wait_for_timeout(800)
    check("Who opens the recipients with the version", pg.get_by_test_id("news-recipients").count() == 1 and "not yet" in pg.get_by_test_id("news-recipients").inner_text().lower())
    with pg.expect_download() as d2:
        pg.get_by_test_id("news-recipients-csv").click()
    check("the recipients export as CSV", d2.value.suggested_filename.startswith("news-recipients-"), d2.value.suggested_filename)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    pg.go_back(); pg.wait_for_timeout(800)
    check("Back returns to the previous tab", view_of(pg) == "publish", pg.url)
    pg.go_forward(); pg.wait_for_timeout(800)
    check("Forward returns again", view_of(pg) == "reports", pg.url)
    check("no page error (CEO)", not errs, errs[:2])
    c.close()

    # ---- staff ----
    c = ctx_for(b, 1280); pg = c.new_page(); go(pg, 4182, "&view=reports")
    names = [re.sub(r"\d+$", "", t.inner_text().split("\n")[0].strip()) for t in pg.get_by_role("tab").filter(visible=True).all()]
    check("staff see two tabs and no publishing", names[:2] == ["News Feed", "My Acknowledgements"] and "Publish & Manage" not in names and pg.get_by_role("button", name="New announcement").count() == 0, names)
    check("a Reports address opens the feed for staff", view_of(pg) == "feed" and pg.get_by_test_id("news-report").count() == 0, pg.url)
    c.close()

    # ---- the phone ----
    c = ctx_for(b, 390, 844); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); go(pg, 4180)
    check("phone: the filters fold behind one button", pg.get_by_test_id("news-filter-category").is_visible() is False)
    pg.get_by_test_id("news-filter-toggle").click(); pg.wait_for_timeout(200)
    check("phone: ...and open on a tap", pg.get_by_test_id("news-filter-category").is_visible())
    check("phone: no reader beside the list", pg.get_by_test_id("news-reader-inline").count() == 0)
    pg.get_by_test_id("news-card").first.get_by_role("button").first.click(); pg.wait_for_timeout(700)
    check("phone: a post opens in a drawer", pg.get_by_role("dialog").get_by_test_id("news-reader").count() == 1)
    check("phone: no page error", not errs, errs[:2])
    c.close()

    for port, who in [(4177, "ceo"), (4180, "host")]:
        for w in WIDTHS:
            for q in (["", "&view=mine", "&view=publish", "&view=reports"] if who == "ceo" else ["", "&view=mine"]):
                c = ctx_for(b, w); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
                go(pg, port, q, 2500)
                check(f"{who} @{w} {q or 'feed'}: no sideways page, no error card, no page error",
                      no_hscroll(pg) and "Something went wrong on this screen" not in pg.locator("main").inner_text() and not errs, errs[:1])
                c.close()
    b.close()

failed = [n for n, ok in res if not ok]
print(f"\nnews2: {len(res) - len(failed)}/{len(res)} passed")
if failed: raise SystemExit(1)

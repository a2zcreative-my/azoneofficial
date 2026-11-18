# v1.364.0 - staff chat in a real browser against a real local worker (the CEO on a
# desktop, the COO on a phone): send, files, unread, read ticks, a group, an agent,
# expiry on screen without a reload, and suspension. Needs the local worker of
# tests/browser/chat-e2e.mjs (CHAT_TEST_TTL_MS:150000) and the built site served
# with /api forwarded to it on 127.0.0.1:4500 (tests/browser/chat-proxy.mjs out 4500).
# Writes screenshots to /tmp/p2/.
import subprocess, time, json, os
from playwright.sync_api import sync_playwright
B="http://127.0.0.1:4500"
def ctx_for(b, tok, phone=False):
    kw = dict(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, device_scale_factor=2) if phone else dict(viewport={"width":1440,"height":900})
    c = b.new_context(**kw)
    c.add_cookies([{"name":"azone_session","value":tok,"domain":"127.0.0.1","path":"/"},{"name":"csrf_token","value":"c"+tok,"domain":"127.0.0.1","path":"/"}])
    return c
res=[]
def ok(name, cond, extra=""):
    res.append((name, bool(cond))); print(("  ok  " if cond else "  FAIL ")+name+(" "+str(extra) if not cond and extra else ""))
def d1(sql):
    subprocess.run(["npx","wrangler","d1","execute","azoneofficial","--local","--persist-to","/tmp/chatdev","--command",sql],cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "worker"),capture_output=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ceo = ctx_for(b,"tok101").new_page(); coo = ctx_for(b,"tok102",True).new_page()
    import urllib.request
    def live():
        rq=urllib.request.Request("http://127.0.0.1:8787/api/v1/staff/chat/inbox", headers={"Cookie":"azone_session=tok102"})
        d=json.load(urllib.request.urlopen(rq)); return [c for c in d["conversations"] if c["last"]], d
    for _ in range(40):
        l,_d = live()
        if not l: break
        time.sleep(5)
    groups_before = sum(1 for c in live()[1]["conversations"] if c["kind"]=="group")
    print("   starting clean; groups already there:", groups_before)
    errs=[]; [pg.on("pageerror", lambda e: errs.append(str(e))) for pg in (ceo,coo)]
    ceo.goto(B+"/portal"); coo.goto(B+"/portal"); ceo.wait_for_timeout(4000); coo.wait_for_timeout(2000)
    print("1. Desktop: the CEO starts a chat")
    ceo.get_by_test_id("chat-button").click(); ceo.wait_for_timeout(800)
    ok("the drawer opens with the 12-hour notice", ceo.get_by_test_id("chat-expiry-notice").is_visible())
    ceo.get_by_test_id("chat-new").click(); ceo.wait_for_timeout(500)
    ok("the people list has no agent or customer", ceo.get_by_test_id("chat-person-104").count()==0 and ceo.get_by_test_id("chat-person-105").count()==0)
    ok("a leaver cannot be picked", ceo.get_by_test_id("chat-person-106").count()==0)
    ceo.get_by_test_id("chat-person-102").click(); ceo.wait_for_timeout(800)
    ceo.get_by_test_id("chat-input").fill("Hi, file briefing untuk meeting petang dah siap?")
    ceo.get_by_test_id("chat-send").click(); ceo.wait_for_timeout(700)
    ceo.get_by_test_id("chat-file-input").set_input_files(["/tmp/p2/Briefing_Meeting.pdf","/tmp/p2/photo.png"]); ceo.wait_for_timeout(1500)
    ceo.get_by_test_id("chat-input").fill("Dah siap. Saya share di sini.")
    ceo.get_by_test_id("chat-send").click(); ceo.wait_for_timeout(1500)
    ok("the CEO's two messages show", ceo.get_by_test_id("chat-message").count()==2, ceo.get_by_test_id("chat-message").count())
    ok("the PDF shows as a file", ceo.get_by_test_id("chat-file").count()>=1)
    print("2. Phone: the COO")
    coo.wait_for_timeout(1500)
    badge = coo.get_by_test_id("chat-unread")
    ok("the COO's header shows 2 unread", badge.count()==1 and badge.inner_text()=="2", badge.inner_text() if badge.count() else "none")
    coo.screenshot(path="/tmp/p2/phone-header.png")
    coo.get_by_test_id("chat-button").click(); coo.wait_for_timeout(800)
    coo.screenshot(path="/tmp/p2/phone-inbox.png")
    box = coo.locator(".erp-drawer").bounding_box()
    ok("on a phone the chat is the whole screen", box and box["width"]>=389 and box["height"]>=840, box)
    coo.locator("[data-testid^=chat-conv-]").first.click(); coo.wait_for_timeout(1500)
    ok("the COO reads both messages", coo.get_by_test_id("chat-message").count()==2)
    ok("the picture arrives", coo.locator("[data-testid=chat-message] img").count()==1)
    coo.get_by_test_id("chat-input").fill("Terima kasih! Saya semak sekarang.")
    coo.get_by_test_id("chat-send").click(); coo.wait_for_timeout(1200)
    coo.screenshot(path="/tmp/p2/phone-conv.png")
    sw = coo.evaluate("document.documentElement.scrollWidth"); ok("no sideways overflow on the phone", sw<=390, sw)
    print("3. Live back on the desktop")
    ceo.wait_for_timeout(1200)
    ok("the CEO sees the reply live", ceo.get_by_test_id("chat-message").count()==3)
    ok("the CEO's messages show read", ceo.locator("text=✓✓").count()>=2)
    ceo.screenshot(path="/tmp/p2/desk-conv.png")
    print("4. A group")
    ceo.get_by_test_id("chat-new").click(); ceo.wait_for_timeout(400)
    ceo.get_by_test_id("chat-new-kind-group").click()
    ceo.get_by_test_id("chat-group-name").fill("Operations Team")
    for i in (102,109,103): ceo.get_by_test_id(f"chat-person-{i}").click()
    ceo.get_by_test_id("chat-group-create").click(); ceo.wait_for_timeout(1000)
    ceo.get_by_test_id("chat-input").fill("Team, briefing at 3pm today.")
    ceo.get_by_test_id("chat-send").click(); ceo.wait_for_timeout(1000)
    ok("the group is in the list", ceo.locator("text=Operations Team").count()>=1)
    ceo.get_by_test_id("chat-filter-group").click(); ceo.wait_for_timeout(300)
    ok("the Groups filter shows only groups", ceo.locator("[data-testid^=chat-conv-]").count()==groups_before+1, ceo.locator("[data-testid^=chat-conv-]").count())
    ceo.get_by_test_id("chat-filter-all").click(); ceo.wait_for_timeout(300)
    ceo.screenshot(path="/tmp/p2/desk-group.png")
    sw = ceo.evaluate("document.documentElement.scrollWidth"); ok("no sideways overflow on the desktop", sw<=1440, sw)
    print("5. An agent and a customer")
    ag = ctx_for(b,"tok104").new_page(); ag.goto(B+"/portal"); ag.wait_for_timeout(3500)
    ok("an agent has no chat button", ag.get_by_test_id("chat-button").count()==0)
    r = ag.request.get(B+"/api/v1/staff/chat/inbox"); ok("an agent's call is refused", r.status==403, r.status)
    cu = ctx_for(b,"tok105").new_page(); r = cu.request.get(B+"/api/v1/staff/chat/inbox"); ok("a customer's call is refused", r.status in (401,403), r.status)
    print("6. Expiry on screen, without a reload")
    # back to the one-to-one chat on the desktop
    ceo.locator("[data-testid^=chat-conv-]", has_text="Zolkefli").first.click(); ceo.wait_for_timeout(800)
    exps = [int(e.get_attribute("data-expires")) for e in ceo.get_by_test_id("chat-message").all()]
    now_ms = ceo.evaluate("Date.now()")
    first_exp = max(exps) - now_ms
    print(f"   {len(exps)} messages on screen; waiting {int(first_exp/1000)+3} s for the last to expire...")
    ceo.wait_for_timeout(int(first_exp)+3000)
    left = ceo.get_by_test_id("chat-message").count()
    ok("every expired message leaves the open screen by itself (no reload)", left == 0, left)
    ok("the conversation says nothing is left", ceo.get_by_test_id("chat-messages").locator("text=No messages in the last 12 hours").count()==1)
    ceo.screenshot(path="/tmp/p2/desk-expired.png")
    print("7. Suspension")
    d1("UPDATE users SET is_active = 0 WHERE id = 102")
    gone=False
    for _ in range(80):
        coo.wait_for_timeout(1000)
        if coo.get_by_test_id("chat-revoked").count() or coo.get_by_test_id("chat-button").count()==0: gone=True; break
    ok("the suspended COO's chat closes within the minute check", gone)
    coo.screenshot(path="/tmp/p2/phone-revoked.png")
    d1("UPDATE users SET is_active = 1 WHERE id = 102")
    ok("no page errors", not errs, errs[:3])
    b.close()
print(f"\nchat-ui: {sum(1 for _,c in res if c)} passed, {sum(1 for _,c in res if not c)} failed")

/* TIKTOK SHOP TOKEN RENEWAL (v1.225.1) - guard.
 *
 * The owner's screenshot, 29-10-2026: Ecommerce said "Your sign-in does not
 * allow a sync." for the CEO. The cause was not his sign-in: TikTok's token
 * answer gives `access_token_expire_in` as the MOMENT the 7-day token expires
 * (a Unix time, e.g. 1722342011). The worker added it to 'now' as seconds,
 * so the stored expiry sat decades away, the token was never renewed, and
 * after a week TikTok refused every sync (401) - which the page then
 * worded as the person's own sign-in. The owner approved the fix ("Build
 * the fix"). This guard holds:
 *
 *   A tiktokExpiresAt reads a Unix moment as that moment, and a small
 *     number as seconds from now (the old reading) - never decades away;
 *   B both writes (first authorisation, renewal) store tiktokExpiresAt;
 *   C the "expiring" test renews a token within a day of expiry AND one
 *     stored more than 60 days away (what the old reading left behind),
 *     and leaves a normal 7-day token alone;
 *   D a sync refused for an expired token renews ONCE and retries page 1;
 *     a second refusal returns not_authorized (no loop);
 *   E the page words not_authorized as the shop's TikTok sign-in, before
 *     the generic 401/403 "your sign-in" branch.
 *
 * v1.226.1: esbuild is run through npx (as every other guard does) - the
 * owner's PC has no bare `esbuild` command, so PUSH.bat stopped here.
 *
 * Negative-tested by: the old datetime('now','+'||?3||' seconds') write;
 * dropping the 60-day clause; dropping the renewal retry; dropping the
 * `renewed` once-flag; the UI branch after the 401 branch.
 *
 *   node tests/tiktok-token.mjs
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ui = readFileSync(new URL("../components/portal/tiktok-orders.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.error("FAIL", m); } };

/* A - the expiry reading, run for real */
const fnSrc = (src.match(/export function tiktokExpiresAt[\s\S]*?\n}\n/) ?? [""])[0];
ok(fnSrc, "A tiktokExpiresAt exists");
const js = execSync("npx esbuild --loader=ts --format=esm --log-level=error", { input: fnSrc, cwd: fileURLToPath(new URL("..", import.meta.url)) }).toString();
const { tiktokExpiresAt } = await import("data:text/javascript," + encodeURIComponent(js));
const now = Date.UTC(2026, 9, 29, 9, 0, 0);
ok(tiktokExpiresAt(1793869200, now) === new Date(1793869200 * 1000).toISOString().slice(0, 19).replace("T", " "), "A a Unix moment is read as that moment");
ok(tiktokExpiresAt(1722342011, now) === "2024-07-30 12:20:11", "A TikTok's documented sample reads as 30-07-2024");
ok(tiktokExpiresAt(604800, now) === "2026-11-05 09:00:00", "A a small number is seconds from now");
ok(tiktokExpiresAt(undefined, now) === "2026-11-05 09:00:00", "A missing falls back to 7 days");
ok(Number(tiktokExpiresAt(1793869200, now).slice(0, 4)) < 2030, "A never decades away");

/* B - both writes use it; the old reading is gone */
const tokenWrites = src.match(/integration_tokens[\s\S]{0,400}?\.run\(\)/g) ?? [];
const tiktokWrites = tokenWrites.filter((w) => /tiktok/.test(w) && /access_token = \?1/.test(w));
ok(tiktokWrites.length >= 2, `B two TikTok token writes found (${tiktokWrites.length})`);
for (const w of tiktokWrites) {
  ok(/tiktokExpiresAt\(/.test(w), "B the write stores tiktokExpiresAt");
  ok(!/'\+' \|\| \?3 \|\| ' seconds'/.test(w), "B the old seconds-from-now reading is gone");
}

/* C - the expiring test, run against SQLite */
const sel = (src.match(/async function tiktokToken[\s\S]*?`(SELECT access_token, refresh_token, shop_cipher,[\s\S]*?)`/) ?? [])[1];
ok(sel, "C tiktokToken's SELECT found");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE integration_tokens (provider TEXT PRIMARY KEY, access_token TEXT, refresh_token TEXT, shop_cipher TEXT, expires_at TEXT)");
const expiring = (sqlExpiry) => {
  db.exec("DELETE FROM integration_tokens");
  db.exec(`INSERT INTO integration_tokens VALUES ('tiktok','a','r',NULL,${sqlExpiry})`);
  return db.prepare(sel).get().expiring;
};
ok(expiring("datetime('now','+5 hours')") === 1, "C within a day of expiry renews");
ok(expiring("datetime('now','-2 days')") === 1, "C already expired renews");
ok(expiring("datetime('now','+1793000000 seconds')") === 1, "C an expiry decades away (old reading) renews");
ok(expiring("datetime('now','+6 days')") === 0, "C a normal 7-day token is left alone");
ok(expiring("NULL") === 0, "C no expiry stored: unchanged behaviour");
ok(/\(force \|\| row\.expiring\) && row\.refresh_token/.test(src), "C `force` renews regardless");

/* D - one renewal and retry inside the sync */
const sync = (src.match(/async function runTikTokSync[\s\S]*?\n}\n/) ?? [""])[0];
ok(/let renewed = false/.test(sync), "D a once-flag");
ok(/authExpired && !renewed\)[\s\S]{0,200}renewed = true;[\s\S]{0,120}tiktokToken\(env, true\)[\s\S]{0,80}refreshed\) \{ pg = -1; continue; \}/.test(sync), "D renew once, then page 1 again");
const iRetry = sync.indexOf("authExpired && !renewed"), iFail = sync.indexOf('code: "not_authorized", message: "TikTok sign-in has expired');
ok(iRetry > 0 && iFail > iRetry, "D the not_authorized answer comes after the one retry");

/* E - the page names the right sign-in */
const iCode = ui.indexOf('res.data?.error?.code === "not_authorized"'), i401 = ui.indexOf("res.status === 401 || res.status === 403");
ok(iCode > 0 && i401 > iCode, "E not_authorized is worded before the generic 401/403 branch");
ok(/TikTok Shop needs to be re-authorised by a manager/.test(ui.slice(iCode, i401)), "E staff are told a manager re-authorises the shop");
ok(/error\?: \{ code\?: string; message\?: string \}/.test(ui), "E the sync answer's error code is read");

console.log(fail ? `tiktok-token: ${fail}/${n} FAILED` : `tiktok-token: ${n} checks OK`);
process.exit(fail ? 1 : 0);

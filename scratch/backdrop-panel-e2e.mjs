/**
 * The "Catalog hover background" card, driven in a REAL browser against the
 * REAL portal worker (v1.61.0) — upload the CEO's own image through the
 * card's file input, watch the feed pick it up, then remove it.
 *
 *   node /tmp/proxy8301.mjs               (static out/ + API -> :8300)
 *   (worker on :8300 per catalog-portal-e2e.mjs)
 *   node scratch/backdrop-panel-e2e.mjs [path-to-image.png]
 */
import { chromium } from "playwright";
const IMG = process.argv[2] ?? "/tmp/backdrop-sample.png";
const FEED = async () => (await (await fetch("http://127.0.0.1:8300/api/v1/bridge/elfia-inventory", {
  headers: { "X-Bridge-Key": "shared-bridge-secret" } })).json());

let pass = 0, fail = 0;
const ok = (l, c, e = "") => { if (c) { pass++; console.log("  ok  " + l); } else { fail++; console.log("  XX  " + l + (e ? ` -- ${e}` : "")); } };

/* State-agnostic: a previous run may have left an upload behind. */
await fetch("http://127.0.0.1:8300/api/v1/staff/elfia/backdrop", {
  method: "DELETE",
  headers: { Cookie: "azone_session=e2etoken; csrf_token=e2ecsrf", "X-CSRF-Token": "e2ecsrf" },
}).catch(() => null);

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([
  { name: "azone_session", value: "e2etoken", url: "http://localhost:8301" },
  { name: "csrf_token", value: "e2ecsrf", url: "http://localhost:8301" },
]);
const pg = await ctx.newPage();
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
await pg.goto("http://localhost:8301/portal", { waitUntil: "domcontentloaded" });
await pg.waitForTimeout(2500);
try { await pg.locator('[title="ELFIA Store"]').first().click({ timeout: 4000 }); }
catch {
  await pg.locator('button[aria-label="Expand navigation"]').click({ timeout: 4000 }).catch(() => {});
  await pg.waitForTimeout(600);
  await pg.locator("text=ELFIA Store").first().click({ timeout: 6000 });
}
await pg.waitForTimeout(2000);

const card = pg.locator("div", { has: pg.locator("p", { hasText: "Catalog hover background" }) }).last();
ok("the card is on the tab", await pg.locator("text=Catalog hover background").count() >= 1);
ok("it starts honest: nothing uploaded", await pg.locator("text=No background uploaded").count() === 1);

/* Upload his image through the card's own input. */
await pg.locator("label", { hasText: "Add background" }).locator('input[type="file"]').setInputFiles(IMG);
await pg.waitForSelector("text=Background uploaded", { timeout: 20000 });
ok("the toast confirms the upload", true);
await pg.waitForTimeout(1500);
ok("the circle preview appears", await pg.locator('img[src*="uploads/elfia/backdrop-"]').count() === 1);
ok("and a remove line with it", await pg.locator("text=shipped ELFIA backdrop").count() >= 1);

const f1 = await FEED();
ok("the feed now advertises the backdrop", f1.backdrop && typeof f1.backdrop.url === "string", JSON.stringify(f1.backdrop ?? null));
const served = await fetch(f1.backdrop.url);
ok("and its URL serves the image publicly", served.ok && (served.headers.get("content-type") ?? "").startsWith("image/"),
   `${served.status} ${served.headers.get("content-type")}`);

/* Remove, from the same card. */
await pg.locator("text=remove — the shop returns to its shipped ELFIA backdrop").first().click();
await pg.waitForSelector("text=Background removed", { timeout: 20000 });
await pg.waitForTimeout(1500);
ok("remove returns the card to its empty state", await pg.locator("text=No background uploaded").count() === 1);
ok("and the feed key is gone", (await FEED()).backdrop === undefined);
ok("no page errors", errs.length === 0, errs.join(" | "));

await pg.screenshot({ path: "/root/shots/backdrop-card.png" });
await b.close();
console.log(fail === 0 ? `PASS - ${pass} checks: the backdrop card works end to end.` : `${fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);

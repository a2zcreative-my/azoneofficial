/**
 * Bulk discount, proven on the REAL portal worker (v1.54.0).
 *
 * The CEO, 26-08-2026: "for the discount, I want to perform bulk discount
 * instead of one by one. but I need to have 1 by 1 update also."
 *
 * A discount is a price a customer is charged, and a BULK discount is that
 * mistake multiplied by however many products were ticked. So the checks
 * here are mostly about the ways it can go quietly wrong:
 *
 *   - a percentage must come off each product's OWN price, not an average;
 *   - a flat RM off must refuse the products it cannot come off, and SAY
 *     WHICH — a bulk action that silently leaves rows alone is worse than
 *     one that refuses, because nobody re-checks thirty rows;
 *   - clearing must be its own action, not "apply 0";
 *   - and the whole point: the result has to reach the shop, so the last
 *     step reads feed A and checks the prices a customer would see.
 *
 * Setup (see wrangler.e2e.toml):
 *   cd worker
 *   npx wrangler d1 migrations apply azoneofficial --local --config wrangler.e2e.toml
 *   cd .. && node scratch/seed-e2e.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8300
 *   node scratch/bulk-discount-e2e.mjs
 */
const API = process.env.PORTAL_API ?? "http://127.0.0.1:8300/api/v1";
const CSRF = "e2ecsrf";
const COOKIES = `azone_session=e2etoken; csrf_token=${CSRF}`;
const BRIDGE_KEY = process.env.ELFIA_BRIDGE_KEY ?? "shared-bridge-secret";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

const staff = (path, init = {}) => fetch(`${API}/staff${path}`, {
  ...init,
  headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "application/json", ...(init.headers ?? {}) },
});
const items = async () => (await (await staff("/inventory")).json()).items;
const bySku = async (sku) => (await items()).find((x) => x.sku === sku);
const bulk = (ids, mode, value) =>
  staff("/elfia/bulk-discount", { method: "POST", body: JSON.stringify({ ids, mode, value }) });

step("the rig can see the seeded products");
let all;
{
  all = await items();
  ok("inventory reads", Array.isArray(all) && all.length >= 3, `${all?.length} items`);
  if (!all || all.length < 3) process.exit(1);
}

/* Give the three seeded items known, DIFFERENT prices, so a percentage that
   was quietly worked out from one price and applied to all would show up. */
step("set up three products at different prices");
{
  const prices = [4900, 5500, 1000];
  for (const [i, it] of all.slice(0, 3).entries()) {
    await staff(`/inventory/${it.id}/bridge`, {
      method: "PATCH", body: JSON.stringify({ bridge_enabled: true, elfia_price: prices[i] / 100 }),
    });
  }
  const after = (await items()).slice(0, 3);
  ok("all three carry their own web price",
     after.every((x, i) => x.elfia_price_cents === prices[i]),
     JSON.stringify(after.map((x) => x.elfia_price_cents)));
}

step("a percentage comes off each product's OWN price");
{
  const three = (await items()).slice(0, 3);
  const r = await bulk(three.map((x) => x.id), "percent", 20);
  const j = await r.json();
  ok("the request succeeds", r.ok, JSON.stringify(j).slice(0, 160));

  const after = (await items()).slice(0, 3);
  /* 20% of 4900 / 5500 / 1000 — three different answers, which is the whole
     point. One number applied to all three would be the bug. */
  ok("RM 49.00 -> RM 9.80 off", after[0].elfia_discount_cents === 980, String(after[0].elfia_discount_cents));
  ok("RM 55.00 -> RM 11.00 off", after[1].elfia_discount_cents === 1100, String(after[1].elfia_discount_cents));
  ok("RM 10.00 -> RM 2.00 off", after[2].elfia_discount_cents === 200, String(after[2].elfia_discount_cents));
  ok("all three were reported as applied", (j.applied ?? []).length === 3, JSON.stringify(j.applied));
  ok("and nothing was skipped", (j.skipped ?? []).length === 0, JSON.stringify(j.skipped));
}

step("a flat RM off names what it could not apply to");
{
  const three = (await items()).slice(0, 3);
  /* RM 15 off is fine on the RM 49 and RM 55 shades and impossible on the
     RM 10 one. The impossible one must be REPORTED, not passed over. */
  const j = await (await bulk(three.map((x) => x.id), "amount", 15)).json();
  const after = (await items()).slice(0, 3);

  ok("it applied where it could", after[0].elfia_discount_cents === 1500 && after[1].elfia_discount_cents === 1500,
     JSON.stringify([after[0].elfia_discount_cents, after[1].elfia_discount_cents]));
  ok("the cheap one was left alone", after[2].elfia_discount_cents === 200, String(after[2].elfia_discount_cents));
  ok("and it is named in the reply", (j.skipped ?? []).length === 1, JSON.stringify(j.skipped));
  ok("with a reason a human can act on",
     /not less than/.test(j.skipped?.[0]?.why ?? ""), JSON.stringify(j.skipped?.[0]));
  ok("the skipped one is the RM 10 shade", j.skipped?.[0]?.sku === after[2].sku,
     `${j.skipped?.[0]?.sku} vs ${after[2].sku}`);
}

step("one by one still works, untouched");
{
  const it = (await items())[2];
  const r = await staff(`/inventory/${it.id}/elfia`, { method: "PATCH", body: JSON.stringify({ discount: 1.5 }) });
  ok("a single product can still be set on its own", r.ok, String(r.status));
  ok("and it took", (await bySku(it.sku)).elfia_discount_cents === 150,
     String((await bySku(it.sku)).elfia_discount_cents));
}

step("clearing is its own action, not 'apply 0'");
{
  const three = (await items()).slice(0, 3);
  const j = await (await bulk(three.map((x) => x.id), "clear", 0)).json();
  const after = (await items()).slice(0, 3);
  ok("every discount is gone", after.every((x) => (x.elfia_discount_cents ?? null) === null),
     JSON.stringify(after.map((x) => x.elfia_discount_cents)));
  ok("all three reported", (j.applied ?? []).length === 3, JSON.stringify(j.applied));

  /* 0 is refused as a discount, because "no discount" is what clear is for
     and a box meaning both is a box that gets misread. */
  const zero = await bulk(three.map((x) => x.id), "amount", 0);
  ok("apply 0 is refused", zero.status === 400, String(zero.status));
}

step("bad input cannot reach the shop");
{
  const three = (await items()).slice(0, 3);
  ok("no selection is refused", (await bulk([], "percent", 10)).status === 400);
  ok("100% is refused", (await bulk(three.map((x) => x.id), "percent", 100)).status === 400);
  ok("a negative amount is refused", (await bulk(three.map((x) => x.id), "amount", -5)).status === 400);
  ok("an unknown mode is refused", (await bulk(three.map((x) => x.id), "halve", 2)).status === 400);
  const after = (await items()).slice(0, 3);
  ok("and none of that changed a single price",
     after.every((x) => (x.elfia_discount_cents ?? null) === null),
     JSON.stringify(after.map((x) => x.elfia_discount_cents)));
}

step("the discount actually reaches the shop (feed A)");
{
  const three = (await items()).slice(0, 3);
  await bulk(three.map((x) => x.id), "percent", 10);
  const feed = await (await fetch(`${API}/bridge/elfia-inventory`, { headers: { "X-Bridge-Key": BRIDGE_KEY } })).json();
  const line = (sku) => (feed.items ?? []).find((i) => i.sku === sku);

  const a = line(three[0].sku);
  ok("the feed carries the discounted price", a?.price_cents === 4410, JSON.stringify(a));
  /* The pre-discount number travels alongside so the shop can draw
     "RM 49.00 -> RM 44.10". Without it there is no sale to show. */
  ok("and the price it was struck down from", a?.list_price_cents === 4900, JSON.stringify(a));

  const c = line(three[2].sku);
  ok("the RM 10 shade is discounted too, by its own 10%", c?.price_cents === 900, JSON.stringify(c));
}

step("tidy up");
{
  const three = (await items()).slice(0, 3);
  await bulk(three.map((x) => x.id), "clear", 0);
  ok("the shelf is back to no discounts",
     (await items()).slice(0, 3).every((x) => (x.elfia_discount_cents ?? null) === null));
}

console.log(fail === 0
  ? `\nPASS - ${pass} checks: a discount for many is as careful as a discount for one.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);

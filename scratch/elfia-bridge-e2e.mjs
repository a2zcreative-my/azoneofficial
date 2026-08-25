/**
 * v1.45.0 — the ELFIA tab, proven end to end on the REAL portal worker
 * (wrangler dev --local, real D1, real R2, real CSRF path):
 *
 *   staff sets photo + description + collection  →  feed A carries them
 *   →  photo URL is genuinely public  →  editing updates the marker
 *   →  clearing hides the field again.
 *
 * Setup (see wrangler.e2e.toml):
 *   cd worker
 *   npx wrangler d1 migrations apply azoneofficial --local --config wrangler.e2e.toml
 *   (seed a ceo user + session 'e2etoken' + a few inventory_items)
 *   npx wrangler dev --local --config wrangler.e2e.toml --port 8300
 *   node scratch/elfia-bridge-e2e.mjs
 */
const API = process.env.PORTAL_API ?? "http://127.0.0.1:8300/api/v1";
const CSRF = "e2ecsrf";
const COOKIES = `azone_session=e2etoken; csrf_token=${CSRF}`;

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

const staff = (path, init = {}) => fetch(`${API}/staff${path}`, {
  ...init,
  headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "application/json", ...(init.headers ?? {}) },
});
const feed = () => fetch(`${API}/bridge/elfia-inventory`, { headers: { "X-Bridge-Key": "shared-bridge-secret" } }).then((r) => r.json());

// a real 1x1 PNG — the worker checks type and byte length
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

step("the session works and the inventory lists the seeded items");
const inv = await (await staff(`/inventory`)).json();
ok("inventory readable as staff", Array.isArray(inv.items) && inv.items.length >= 3, JSON.stringify(inv).slice(0, 120));
const shawl = inv.items.find((x) => x.sku === "SHWL 001");
const bawal = inv.items.find((x) => x.sku === "LUMI 001");
const hidden = inv.items.find((x) => x.sku === "SHWL 002");
ok("the shawl is there", Boolean(shawl));

step("collection + description save through the new /elfia route");
{
  const r = await staff(`/inventory/${shawl.id}/elfia`, {
    method: "PATCH",
    body: JSON.stringify({ category: "shawl", description: "  Long-cut, lightweight and opaque. Finished by hand.  " }),
  });
  ok("PATCH accepted", r.status === 200, `${r.status}`);
  const bad = await staff(`/inventory/${shawl.id}/elfia`, { method: "PATCH", body: JSON.stringify({ category: "premium" }) });
  ok("an unknown category is refused", bad.status === 400, `${bad.status}`);
  const empty = await staff(`/inventory/${shawl.id}/elfia`, { method: "PATCH", body: JSON.stringify({}) });
  ok("an empty patch is refused", empty.status === 400, `${empty.status}`);
}

step("the photo uploads through the real CSRF binary path");
let photoUrl = "";
{
  const r = await fetch(`${API}/staff/inventory/${shawl.id}/elfia/photo`, {
    method: "POST",
    headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "image/png" },
    body: PNG,
  });
  const j = await r.json();
  ok("upload accepted", r.status === 201, `${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  ok("key lives under the public prefix", typeof j.image_key === "string" && j.image_key.startsWith("uploads/elfia/"), j.image_key);
  photoUrl = `${API}/media/file/${j.image_key}`;

  const wrongType = await fetch(`${API}/staff/inventory/${shawl.id}/elfia/photo`, {
    method: "POST",
    headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "text/html" },
    body: "<h1>nope</h1>",
  });
  ok("a non-image is refused", wrongType.status === 400, `${wrongType.status}`);

  const noCsrf = await fetch(`${API}/staff/inventory/${shawl.id}/elfia/photo`, {
    method: "POST", headers: { Cookie: COOKIES, "Content-Type": "image/png" }, body: PNG,
  });
  ok("no CSRF token, no upload", noCsrf.status === 403, `${noCsrf.status}`);
}

step("the photo really is public — the ELFIA store fetches with no session");
{
  const r = await fetch(photoUrl);
  ok("served without a cookie", r.status === 200, `${r.status}`);
  ok("as the uploaded type", (r.headers.get("content-type") ?? "").startsWith("image/"), r.headers.get("content-type"));
  const bytes = new Uint8Array(await r.arrayBuffer());
  ok("byte-for-byte the uploaded file", bytes.length === PNG.length && bytes.every((b, i) => b === PNG[i]));
}

step("feed A now dresses the item");
let marker1 = "";
{
  const f = await feed();
  const it = f.items.find((x) => x.sku === "SHWL 001");
  ok("category travels", it?.category === "shawl", JSON.stringify(it));
  ok("description travels, trimmed", it?.description === "Long-cut, lightweight and opaque. Finished by hand.", it?.description);
  ok("image_url is absolute and public", typeof it?.image_url === "string" && it.image_url.startsWith("http") && it.image_url.includes("/media/file/uploads/elfia/"), it?.image_url);
  ok("image_updated_at rides with it", typeof it?.image_updated_at === "string" && it.image_updated_at !== "");
  marker1 = it?.image_updated_at ?? "";
  const plain = f.items.find((x) => x.sku === "LUMI 001");
  ok("an undressed item is unchanged (no new keys)",
    plain && !("category" in plain) && !("description" in plain) && !("image_url" in plain), JSON.stringify(plain));
  ok("an unpublished item stays out of the feed", !f.items.some((x) => x.sku === "SHWL 002"));
}

step("replacing the photo moves the marker; an untouched one keeps it");
{
  await new Promise((r) => setTimeout(r, 1100)); // markers are ISO timestamps
  const f0 = await feed();
  const same = f0.items.find((x) => x.sku === "SHWL 001")?.image_updated_at;
  ok("marker is stable between polls", same === marker1, `${marker1} -> ${same}`);
  await fetch(`${API}/staff/inventory/${shawl.id}/elfia/photo`, {
    method: "POST", headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "image/png" }, body: PNG,
  });
  const f1 = await feed();
  const next = f1.items.find((x) => x.sku === "SHWL 001")?.image_updated_at;
  ok("a re-upload moves the marker", typeof next === "string" && next !== marker1, `${marker1} -> ${next}`);
}

step("clearing the dressing hides the fields again");
{
  await staff(`/inventory/${bawal.id}/elfia`, { method: "PATCH", body: JSON.stringify({ description: "temp" }) });
  await staff(`/inventory/${bawal.id}/elfia`, { method: "PATCH", body: JSON.stringify({ description: "" }) });
  const f = await feed();
  const it = f.items.find((x) => x.sku === "LUMI 001");
  ok("a cleared description is absent, not empty", it && !("description" in it), JSON.stringify(it));
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

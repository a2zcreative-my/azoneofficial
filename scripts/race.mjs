#!/usr/bin/env node
/**
 * RACE DRILL ON A STAGING WORKER - v1.242.0 (go-live plan §5, Release B).
 *
 * Fires N identical writes at the same instant against a STAGING API and
 * reports what landed, so the one-live-invoice-per-quotation rule (B2) and
 * the parts-never-exceed-the-total rule (B3) are proven on a real D1, not
 * only on the SQLite shim in tests/go-live-b.mjs.
 *
 * It WRITES. It therefore refuses any host that looks like production
 * (a2zcreative.my, azoneofficial-api.*.workers.dev) and runs only when the
 * base URL carries "staging" or is a localhost / 127.0.0.1 address.
 *
 *   node scripts/race.mjs --base https://staging-api.example.test --cookie "azone_session=...; csrf_token=c1" \
 *        --quotation 123 --invoice 456 --n 10
 *
 * Prints: converts -> how many 201 / 409 / other, the live invoices for the
 * quotation; parts -> how many 201 / 400, the total received vs the total.
 */
const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const base = (arg("--base") ?? "").replace(/\/$/, "");
const cookie = arg("--cookie") ?? "";
const qt = Number(arg("--quotation") ?? 0);
const inv = Number(arg("--invoice") ?? 0);
const n = Number(arg("--n") ?? 10);
const amount = Number(arg("--amount") ?? 6000);
if (!base || !cookie) { console.error("usage: --base <staging api> --cookie <session cookie> [--quotation id] [--invoice id] [--n 10] [--amount 6000]"); process.exit(2); }
if (/a2zcreative\.my|azoneofficial-api\.[a-z0-9-]+\.workers\.dev/i.test(base) || !/staging|localhost|127\.0\.0\.1/i.test(base)) {
  console.error("[X] race.mjs writes: it runs only against a staging or local API (the base URL must say staging, or be localhost)."); process.exit(2);
}
const csrf = /csrf_token=([^;]+)/.exec(cookie)?.[1] ?? "c1";
const hit = (path, body) => fetch(`${base}/api/v1/staff${path}`, { method: "POST", headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf, origin: base }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }));
const tally = (rs) => rs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});

if (qt) {
  const rs = await Promise.all(Array.from({ length: n }, () => hit(`/docs/${qt}/convert`, {})));
  const live = await fetch(`${base}/api/v1/staff/docs?type=INV`, { headers: { cookie } }).then((r) => r.json()).catch(() => null);
  const mine = (live?.docs ?? live?.results ?? []).filter((d) => d.converted_from === qt && d.payment_status !== "void");
  console.log(`converts x${n} on quotation ${qt}: ${JSON.stringify(tally(rs))}; live invoices for it now: ${mine.length} (${mine.map((d) => d.doc_number).join(", ")})`);
  if ((tally(rs)[201] ?? 0) > 1 || mine.length > 1) { console.error("[X] more than one live invoice"); process.exitCode = 1; }
}
if (inv) {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const rs = await Promise.all(Array.from({ length: n }, () => hit(`/docs/${inv}/payments`, { amount_cents: amount, received_on: today, method: "bank_transfer", note: "race drill" })));
  const pay = await fetch(`${base}/api/v1/staff/docs/${inv}/payments`, { headers: { cookie } }).then((r) => r.json()).catch(() => null);
  console.log(`parts x${n} of RM ${(amount / 100).toFixed(2)} on invoice ${inv}: ${JSON.stringify(tally(rs))}; received ${pay?.received_cents} of total ${pay?.invoice?.total_cents}`);
  if (pay && pay.received_cents > pay.invoice?.total_cents) { console.error("[X] received exceeds the total"); process.exitCode = 1; }
}
if (!qt && !inv) console.log("nothing to do: give --quotation and/or --invoice");

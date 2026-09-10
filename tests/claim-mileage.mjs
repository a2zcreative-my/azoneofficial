/**
 * THE KILOMETRE IS THE CLAIM — guard #70, v1.150.0.
 *
 * The CEO, 09-09-2026, on the Claims form: *"for claim, if travel they will
 * claim for Mileage which is I set 0.70cent / km which is they need to insert
 * their KM based on Google maps km to their destination and back to the HQ
 * (office)"*. Before this, a travel line was a typed amount like any other,
 * and a mileage claim was whatever number the claimant felt like multiplying
 * out — nothing on the form said what rate it was at, and nothing checked.
 *
 * THE PROPERTIES, not the implementation:
 *   1. THE RATE IS A SETTING, NOT A CONSTANT. It lives in system_meta under
 *      one key, read by the worker, with 70 sen as the value before the CEO
 *      has ever set one. A rate baked into the code is a deploy every time
 *      petrol moves.
 *   2. THE SERVER PRICES THE KILOMETRE. A travel line that carries km has its
 *      amount computed from km x rate ON THE WORKER; the amount the browser
 *      sends is ignored for that line. Money that the client gets to name is
 *      money the client gets to invent.
 *   3. THE LINE REMEMBERS ITS OWN RATE. km and rate_cents_per_km are stored
 *      on the item, so a claim from June still reads 0.60/km after the rate
 *      moves to 0.70 — a paid claim never re-prices itself.
 *   4. ONE PARSER, TWO DOORS. Create and edit price the line through the same
 *      function. Two copies of a rule that decides money are two chances to
 *      disagree.
 *   5. A TRAVEL RECEIPT IS STILL TRAVEL. km is optional on a travel line — a
 *      Grab ride, a toll, a parking ticket are travel without mileage.
 *   6. ONLY THE CLAIMS DECIDER SETS THE RATE, AND EVERY CHANGE IS AUDITED
 *      with what it was before. Anyone who can claim may READ the rate, since
 *      the form computes with it.
 *   7. THE FORM SHOWS ITS WORKING. The rate is on the form before the first
 *      line is typed; a mileage line shows km x rate; the amount box on a
 *      mileage line is not typeable; and the printed AZOO-HR-CLM form carries
 *      the basis so paper can be checked against Google Maps.
 *   8. THE KILOMETRE IS BOUNDED. A negative, zero, or thousand-km-a-day figure
 *      is refused, not priced.
 *
 * Negative-tested by: hardcoding 70 in place of the setting read (1);
 * keeping the client amount on a km line (2); dropping rate_cents_per_km from
 * the stored item (3); giving /edit its own parser (4); requiring km on every
 * travel line (5); opening the POST to claims_submit and dropping the audit
 * (6); removing the readOnly amount box and the printed basis (7); and
 * removing the 2000 km ceiling (8).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const staff = read("worker/src/staff.ts");
const panel = read("components/portal/role-panels.tsx");

/* the claims region of the worker: from the mileage helpers to the end of
   the claim create route */
const wStart = staff.indexOf("MILEAGE_KEY");
ok("the worker has a mileage section", wStart > 0);
const W = staff.slice(Math.max(0, wStart - 2000));

/* ---- 1. the rate is a setting ---- */
{
  ok("the rate has one system_meta key", /const MILEAGE_KEY = "claim_mileage_rate"/.test(W));
  ok("the worker reads the rate from system_meta", /FROM system_meta WHERE key = \?1`\)\.bind\(MILEAGE_KEY\)/.test(W));
  ok("70 sen is the value before the CEO sets one", /MILEAGE_DEFAULT_CENTS = 70\b/.test(W));
  const fn = W.match(/const mileageRate = async[\s\S]*?\n  \};/);
  ok("mileageRate falls back to the default, never to zero", !!fn && /return MILEAGE_DEFAULT_CENTS/.test(fn[0]) && !/return 0\b/.test(fn[0]));
}

/* ---- 2 + 3 + 5 + 8. the server prices the kilometre, remembers the rate,
   keeps km optional, bounds it ---- */
{
  const parser = W.match(/const parseClaimItems = [\s\S]*?\n  \};/);
  ok("there is a shared item parser", !!parser);
  const P = parser ? parser[0] : "";
  ok("the parser takes the rate as an argument (no hidden constant)", /parseClaimItems = \(raw: unknown, rate: number\)/.test(P));
  ok("a km travel line is priced km x rate on the worker", /amount_cents: Math\.round\(km \* rate\)/.test(P));
  ok("the priced line stores km AND the rate it was paid at", /\{ \.\.\.base, km, rate_cents_per_km: rate, amount_cents: Math\.round\(km \* rate\) \}/.test(P));
  ok("the client amount is what a NON-mileage line gets, not a km line",
     /amount_cents: Math\.round\(Number\(i\.amount\) \* 100\)/.test(P) && P.indexOf("Number(i.amount)") < P.indexOf("km * rate"));
  ok("km is only mileage on a TRAVEL line", /category === "travel" && Number\.isFinite\(kmRaw\) && kmRaw > 0/.test(P));
  /* a travel line without km must take the SAME path as every other line:
     the only place the parser mentions "travel" is the km conjunction, so
     there is no branch that could zero or refuse a travel receipt. */
  const travelMentions = (P.match(/"travel"/g) ?? []).length;
  ok("a travel line without km is still accepted (no travel-only branch)",
     /return base;/.test(P) && travelMentions === 1, `"travel" appears ${travelMentions}x in the parser`);
  ok("the kilometre is bounded above", /i\.km > 2000/.test(P));
  ok("zero and negative km are refused", /i\.km <= 0/.test(P));
  ok("km is rounded to one decimal, as Google Maps shows it", /Math\.round\(kmRaw \* 10\) \/ 10/.test(P));
}

/* ---- 4. one parser, two doors ---- */
{
  const calls = (W.match(/parseClaimItems\(body!?\??\.items, await mileageRate\(\)\)/g) ?? []).length;
  ok("create and edit both go through the shared parser", calls >= 2, `${calls} call(s)`);
  /* the edit route runs from its match line to the next route's match line */
  const eStart = W.indexOf("const claimEdit = path.match");
  const eEnd = W.indexOf("path.match(", eStart + 40);
  const edit = W.slice(eStart, eEnd > 0 ? eEnd : undefined);
  ok("edit has no private item parser (no category list, no item map of its own)",
     !/\["travel", "meal"/.test(edit) && !/\.map\(\(i(?:: [^)]*)?\) => \(\{\s*claim_date:/.test(edit));
  const create = W.slice(W.indexOf('if (path === "/claims" && method === "POST")'));
  ok("create has no private item parser either",
     create.length > 0 && !/\["travel", "meal"/.test(create.slice(0, 5000)) && !/\.map\(\(i(?:: [^)]*)?\) => \(\{\s*claim_date:/.test(create.slice(0, 5000)));
}

/* ---- 6. the rate door ---- */
{
  const get = W.match(/if \(path === "\/claims\/mileage-rate" && method === "GET"\) \{[\s\S]*?\n  \}/);
  const post = W.match(/if \(path === "\/claims\/mileage-rate" && method === "POST"\) \{[\s\S]*?\n  \}/);
  ok("GET rate is open to anyone who can claim", !!get && /can\(user\.role, "claims_submit"\)/.test(get[0]));
  ok("GET rate says whether the caller may set it", !!get && /can_set: can\(user\.role, "claims_decide"\)/.test(get[0]));
  ok("POST rate is the claims decider only", !!post && /can\(user\.role, "claims_decide"\)/.test(post[0]) && !/claims_submit/.test(post[0]));
  ok("POST rate is bounded (RM 0.01 - RM 100)", !!post && /centsPerKm <= 0 \|\| centsPerKm > 10000/.test(post[0]));
  ok("POST rate is audited with the previous value", !!post && /audit\(env, user\.id, "claim\.mileage_rate_set"[\s\S]*was_cents_per_km/.test(post[0]));
  ok("POST rate upserts the one key", !!post && /ON CONFLICT\(key\) DO UPDATE/.test(post[0]));
}

/* ---- 7. the form shows its working ---- */
{
  const cStart = panel.indexOf("export function ClaimsPanel(");
  const C = panel.slice(cStart, panel.indexOf("\n}\n", cStart));
  ok("the form fetches the rate", /api<\{ cents_per_km: number; can_set: boolean \}>\(`\/claims\/mileage-rate`\)/.test(C));
  ok("the rate is on the form before any line is typed", /Mileage rate:/.test(C) && /rmBare\(rateCents\)/.test(C));
  ok("a travel line has a km box, other lines do not", /it\.category === "travel" && \([\s\S]*?km: e\.target\.value/.test(C));
  ok("the km hint says round trip to HQ per Google Maps", /back to HQ/.test(C) && /round trip/.test(C));
  ok("the amount box on a mileage line is not typeable", (C.match(/readOnly[^\n]*rmBare\(mileageCents\(it\.km\)\)/g) ?? []).length >= 2);
  ok("the line shows km x rate = RM", /km × RM \$\{rmBare\(rateCents\)\}\/km = RM/.test(C));
  ok("the total adds priced lines, not typed amounts", /items\.reduce\(\(a, i\) => a \+ lineCents\(i\), 0\)/.test(C));
  ok("the payload carries km on a mileage line", /isMileage\(i\) \? \{ km: Math\.round\(Number\(i\.km\) \* 10\) \/ 10 \}/.test(C));
  ok("the details line shows the stored basis (km x stored rate)", /it\.km != null \? ` · \$\{it\.km\} km × RM \$\{rmBare\(it\.rate_cents_per_km \?\? 0\)\}\/km`/.test(C));
  ok("editing a claim brings the km back", /km: it\.km != null \? String\(it\.km\) : ""/.test(C));
  ok("only a rate-setter sees Change", /mileage\?\.can_set && <button/.test(C));
  ok("saving the rate posts rate_rm and toasts", /`\/claims\/mileage-rate`, \{ method: "POST", body: JSON\.stringify\(\{ rate_rm: Number\(rateDraft\) \}\)/.test(C) && /showToast\(L\("Saved", "Disimpan"\), `\$\{L\("Mileage rate is now RM"/.test(C));
  /* the printed form */
  const pStart = panel.indexOf("async function printClaimForm(");
  const P = panel.slice(pStart, panel.indexOf("\n}\n", pStart));
  ok("the printed AZOO-HR-CLM form carries the mileage basis", /km x RM \$\{rmv\(it\.rate_cents_per_km \?\? 0\)\}\/km/.test(P));
}

console.log(failed === 0
  ? `claim-mileage: ${passed} checks passed.`
  : `\n${failed} claim-mileage check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;

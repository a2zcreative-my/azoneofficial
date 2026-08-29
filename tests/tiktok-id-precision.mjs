/**
 * TikTok id precision guard (v1.70.2) — guard #18.
 *
 * TikTok ids are 19-digit snowflakes. Number.MAX_SAFE_INTEGER is 16 digits.
 * The analytics endpoints send ids as JSON NUMBERS, so a plain res.json()
 * rounds them:
 *
 *     1736703643101529119  ->  1736703643101529000
 *
 * Every id ending in 00 on the analytics panel was a corrupted id. The
 * catalogue returns ITS ids as strings, precise, so the name join compared a
 * real id against a rounded one and matched nothing; the per-product lookup
 * then asked for an id that does not exist and was told "Precondition
 * Required. This operation requires an existing product ID". That refusal
 * was read as "the product was deleted", and a release shipped telling the
 * CEO that sixteen live products were gone.
 *
 * The corruption is silent, the downstream symptom is a plausible-sounding
 * lie, and nothing anywhere throws. Hence a guard that runs the SHIPPED
 * parser — extracted from the worker so the test cannot drift from it —
 * against the real response shapes.
 *
 *   node tests/tiktok-id-precision.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
const src = readFileSync(path.join(new URL("..", import.meta.url).pathname, "worker/src/index.ts"), "utf8");
const start = src.indexOf("function ttParse(raw: string): unknown {");
if (start < 0) { console.log("  FAIL ttParse is gone from the worker — every TikTok id is being rounded again"); process.exit(1); }
const end = src.indexOf("\n}", start) + 2;
const body = src.slice(start, end).replace("function ttParse(raw: string): unknown", "function ttParse(raw)");
const ttParse = eval(`(${body.replace(/^function ttParse/, "function")})`);

let bad = 0;
const eq = (label, got, want) => {
  if (got === want) return;
  console.log(`  FAIL ${label}\n       got  ${got}\n       want ${want}`);
  bad++;
};

/* 1. the exact shape the analytics endpoints send — id as a bare number */
const sku = ttParse('{"data":{"skus":[{"id":1736703725188121631,"product_id":1736703643101529119,"gmv":116.37}]}}');
eq("sku id survives", sku.data.skus[0].id, "1736703725188121631");
eq("product_id survives", sku.data.skus[0].product_id, "1736703643101529119");
eq("a normal number is untouched", sku.data.skus[0].gmv, 116.37);

/* 2. two ids adjacent in an array — the lookahead case */
const arr = ttParse('{"ids":[1736703643101529119,1737184156551578655]}');
eq("first of two adjacent", arr.ids[0], "1736703643101529119");
eq("second of two adjacent", arr.ids[1], "1737184156551578655");

/* 3. ids TikTok already sends as strings must be left exactly alone */
const str = ttParse('{"id":"1736703643101529119","title":"BAWAL LUMI AURORA"}');
eq("a quoted id is unchanged", str.id, "1736703643101529119");
eq("text is unchanged", str.title, "BAWAL LUMI AURORA");

/* 4. digits INSIDE a string must never be quoted twice or mangled */
const inside = ttParse('{"note":"order 1736703643101529119 paid","n":5}');
eq("digits inside text are untouched", inside.note, "order 1736703643101529119 paid");
eq("a small number stays a number", inside.n, 5);

/* 5. the whole-response shape, with nesting and a trailing brace */
const full = ttParse('{"code":0,"message":"Success","data":{"products":[{"id":1737184156551578655,"skus":[{"id":1737184623356052537}]}],"total":2}}');
eq("nested product id", full.data.products[0].id, "1737184156551578655");
eq("nested sku id", full.data.products[0].skus[0].id, "1737184623356052537");
eq("code is still a number", full.code, 0);

/* 6. malformed input must not throw */
eq("garbage returns null", ttParse("not json"), null);
eq("empty returns null", ttParse(""), null);

/* 7. the regression proof: plain JSON.parse LOSES these */
const naive = JSON.parse('{"id":1736703643101529119}');
eq("naive parse really does corrupt (control)", String(naive.id), "1736703643101529000");

/* ---- the other two ways a row loses its name or its number ----
   Same file because they are the same failure in the reader's eyes: a panel
   that shows an id, or a dash, where it should show a fact. */
const has = (label, re, why) => {
  if (re.test(src)) return;
  console.log(`  FAIL ${label}\n       ${why}`);
  bad++;
};

has("36009003 is retried once",
    /res\.code === 36009003\) continue;/,
    "TikTok's own message for this code is 'Retry later' and it is often transient — refusing on the first answer shows four dashes for a shop that has sales");
has("the retry pauses before asking again",
    /attempt > 0\) await new Promise\(\(r\) => setTimeout\(r, \d+\)\)/,
    "an immediate retry lands inside the same failing moment");
has("the retry stops at two attempts",
    /attempt < 2; attempt\+\+/,
    "hammering a service that is genuinely down helps nobody, and the panel is honest about a refusal");
has("a SKU with no attributes falls back to the product title",
    /attrs\.length > 0 \? attrs\.join\(", "\) : seller \|\| title/,
    "a product with one unnamed SKU has no variant identity, and printing a 19-digit id for it is worse than repeating the title");

console.log(bad === 0 ? "PASS — ids survive the parse, refusals are retried, every SKU gets a label" : `\n${bad} failure(s)`);
process.exit(bad === 0 ? 0 : 1);

#!/usr/bin/env node
/* Guard #59 — v1.132.0: a box that shows a saved figure must show the SAVED one.
 *
 * CEO, 07-09-2026, a screenshot of the ELFIA tab: Web price 39.00, Discount
 * 11.00, and on the same row "Customer pays RM 29.00 — RM 39.00". 39 minus 11
 * is 28. The sentence was right and the BOX was lying: the stored discount was
 * RM 10.00 from a bulk "RM 10 off", and 11.00 was text typed into the box
 * earlier that never became data.
 *
 * THE MECHANISM, because it is not obvious and it is easy to reintroduce.
 *
 * These fields are UNCONTROLLED: `<input defaultValue={row.x}>` with an
 * onBlur that saves. React reads `defaultValue` exactly once — when it first
 * mounts that DOM node. Every save then calls load(), which replaces the rows,
 * but each row is keyed by its id, so React REUSES the same <input> element
 * and never touches its value again. From that moment the box is a scratchpad:
 * it keeps whatever is in it, while the figures computed BESIDE it come from
 * fresh server data. Bulk tools make it worse, because they change the stored
 * number without the person going near the box.
 *
 * The damage is not cosmetic. Someone reads the box, believes it, and reasons
 * about prices from it. Two of these were the ELFIA web price and the list
 * price — the numbers a customer is charged.
 *
 * THE RULE THIS GUARD HOLDS: an uncontrolled input whose `defaultValue` comes
 * from server data must carry a `key` that folds that same data in. The node
 * is then remounted (and `defaultValue` re-read) exactly when the stored value
 * changes, and left alone — mid-typing undisturbed — when it does not.
 *
 * Deliberately NOT asserted: that these become controlled inputs. Saving on
 * blur is a house rule, and a controlled input re-rendering a 22-row list on
 * every keystroke is the reason they are uncontrolled in the first place. The
 * key is the cheap fix that keeps both properties.
 *
 * Run: node --experimental-strip-types tests/input-truth.mjs
 *
 * Negative-tested by: removing the key from the ELFIA discount box; removing
 * it from the Inventory web price; keying an input on something constant
 * (`key="price"`), which remounts never and is the bug wearing a key.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* Every .tsx under components/ and app/. */
const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === "out") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (p.endsWith(".tsx")) files.push(p);
  }
};
walk(join(root, "components"));
walk(join(root, "app"));

/* A `defaultValue={...}` reading a FIELD OFF AN OBJECT is one bound to data —
   `it.elfia_price_cents`, `sl.title`, `w.threshold`. A literal or a bare local
   (`defaultValue={"tiktok"}`, `defaultValue={today}`) is a starting value that
   nothing on the server will contradict, so it is out of scope. */
const BOUND = /defaultValue=\{([^}]*\b\w+\.\w+[^}]*)\}/g;

/* The element this defaultValue sits in, so the key can be looked for in the
   same tag rather than anywhere in the file. Walk back to the opening `<`. */
const tagAround = (src, at) => {
  const start = src.lastIndexOf("<", at);
  if (start < 0) return "";
  /* Forward to the tag's own end, not into its children. */
  let i = at, depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) break;
    i++;
  }
  return src.slice(start, i + 1);
};

const offenders = [];
const constKeyed = [];
let checked = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  BOUND.lastIndex = 0;
  let m;
  while ((m = BOUND.exec(src)) !== null) {
    const tag = tagAround(src, m.index);
    if (!/^<(input|textarea|select)\b/.test(tag)) continue;   // not a form control
    checked++;
    const rel = f.slice(root.length);
    const line = src.slice(0, m.index).split("\n").length;
    const key = tag.match(/\bkey=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}|\bkey="([^"]*)"/);
    if (!key) { offenders.push(`${rel}:${line}`); continue; }
    /* A key that cannot change is the bug wearing a key: it must interpolate
       something, and specifically something off an object, like the value. */
    const expr = key[1] ?? key[2] ?? "";
    if (!/\$\{[^}]*\b\w+\.\w+/.test(expr)) constKeyed.push(`${rel}:${line}`);
  }
}

ok("there are bound uncontrolled inputs to check at all", checked >= 10,
   `found ${checked} — if this fell to zero the guard is asserting nothing`);
ok("every box bound to server data is keyed on that data",
   offenders.length === 0,
   `unkeyed: ${offenders.join(", ")}`);
ok("no box is keyed on something that never changes",
   constKeyed.length === 0,
   `constant keys: ${constKeyed.join(", ")} — remounts never, so the box still lies`);

/* The two that started it, named so a future edit cannot quietly drop them. */
const elfia = readFileSync(join(root, "components/portal/elfia-store-panel.tsx"), "utf8");
ok("the ELFIA web price box is keyed on the stored web price",
   /key=\{`webprice:\$\{it\.elfia_price_cents \?\? ""\}`\}/.test(elfia));
ok("the ELFIA discount box is keyed on the stored discount",
   /key=\{`discount:\$\{it\.elfia_discount_cents \?\? ""\}`\}/.test(elfia),
   "this is the box that showed 11.00 over a stored 10.00");
const inv = readFileSync(join(root, "components/portal/role-panels.tsx"), "utf8");
ok("the Inventory list price and web price boxes are keyed too",
   /key=\{`unitprice:/.test(inv) && /key=\{`webprice:/.test(inv),
   "these are the numbers a customer is charged");

/* The figure BESIDE the box is derived from server data, not from the box —
   that is what made the lie visible, and it must stay that way. */
ok("\"Customer pays\" is computed from the stored price and discount",
   /const base = it\.elfia_price_cents \?\? it\.unit_price_cents \?\? 0;[\s\S]{0,160}const disc = it\.elfia_discount_cents \?\? 0;/.test(elfia),
   "computing it from the input would hide the disagreement instead of showing it");

/* ---- the second half of the same lie ---------------------------------
   The panel promised "Customer pays RM 29.00" on a product the shop was
   charging RM 39.00 for, and both were right: the discount carried a FLASH
   DEADLINE that had passed, and the feed stops applying a discount once its
   deadline is behind it. The panel had never heard of deadlines.

   bridge-feed.ts owns that rule. The panel cannot import worker code, so it
   carries a second copy — and this is the check that pays for the duplication:
   the two must parse the same stamp the same way and draw the same line. */
const feed = readFileSync(join(root, "worker/src/bridge-feed.ts"), "utf8");
ok("the panel reads the flash deadline at all",
   /it\.elfia_flash_until/.test(elfia),
   "a deadline the panel cannot see is a discount it will promise for ever");
/* The PROPERTY, not the spelling: a bare SQLite stamp ("2026-09-09 18:00:00")
   is turned into a T-separated UTC one before Date.parse, on both sides. If
   one side forgets the Z it reads the deadline in the browser's zone and the
   two disagree by eight hours — right at the moment the sale ends. */
const utcParse = /includes\("T"\) \? [\w.]+ : `\$\{[\w.]+\.replace\(" ", "T"\)\}Z`/;
ok("the feed reads the stamp as UTC", utcParse.test(feed));
ok("the panel reads the stamp the same way", utcParse.test(elfia),
   "a zone difference makes the two disagree for exactly the eight hours that matter");
ok("both treat a deadline at or before now as ENDED",
   /t <= now/.test(feed) && /at <= Date\.now\(\)/.test(elfia));
ok("an ended flash sale drops the discount in the feed",
   /const over = flashExpired\(row\.elfia_flash_until\);[\s\S]{0,120}if \(!over &&/.test(feed));
ok("...and the panel says so instead of promising the discounted price",
   /if \(ended\) \{/.test(elfia) && /Flash sale ended/.test(elfia) && /Jualan kilat tamat/.test(elfia),
   "this is the sentence that would have explained the whole thing on sight");
ok("the panel names the price the shop is ACTUALLY charging",
   /the shop charges RM \$\{rmBare\(base\)\}, not RM \$\{rmBare\(base - disc\)\}/.test(elfia),
   "\"the sale ended\" still leaves you working out what the customer pays");
ok("a running flash sale shows its deadline rather than hiding it",
   /flash until \$\{flashWhen\(at\)\}/.test(elfia));

console.log(`${failed ? "✗" : "✓"} input-truth: ${passed} passed, ${failed} failed (${checked} bound inputs)`);
process.exit(failed ? 1 : 0);

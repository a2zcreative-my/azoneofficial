/**
 * Web-order tracking guard (v1.73.0) — guard #21.
 *
 * THE RULE THIS EXISTS FOR: the portal does not build courier URLs.
 *
 * The shop keeps one map of six Malaysian couriers and the shape of each
 * one's tracking URL, and sends the FINISHED link on feed C. The portal
 * holds the courier key too, so writing `https://www.jtexpress.my/...` here
 * would work today — and would be wrong tomorrow, because the day J&T
 * changes its URL the fix has to happen in two repositories and the one
 * nobody remembers keeps sending customers to a dead page for months.
 * Nothing is louder about that than a build failure, so: no courier domain
 * may appear anywhere in this repository's client or worker code.
 *
 * Also checked: the link survives the trip (parsed, https-only, stored
 * armored), the correction action is forwarded, and the WhatsApp message
 * that hands the number to a customer reads the shop's address from the
 * brand registry rather than typing it — which is the same rule, one level
 * up, and is separately enforced by brands-guard.
 *
 *   node tests/web-order-tracking.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- 1. no courier URL is built anywhere in this repository ---- */
{
  const COURIER_HOSTS = /jtexpress|ninjavan\.co|track\.pos\.com|flashexpress|citylinkexpress|dhl\.com/i;
  const DIRS = ["app", "components", "lib", "constants", "worker/src"];
  const offenders = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(path.join(root, dir)); } catch { return; }
    for (const e of entries) {
      if (e === "node_modules" || e === ".next") continue;
      const rel = `${dir}/${e}`;
      if (statSync(path.join(root, rel)).isDirectory()) { walk(rel); continue; }
      if (!/\.(ts|tsx)$/.test(e)) continue;
      for (const [i, line] of read(rel).split(/\r?\n/).entries()) {
        /* Comments may name a courier freely — the rule is about code. */
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (COURIER_HOSTS.test(line)) offenders.push(`${rel}:${i + 1}`);
      }
    }
  };
  for (const d of DIRS) walk(d);
  ok("no courier tracking URL is assembled in this repository", offenders.length === 0,
     `${offenders.join(", ")} — the shop owns that map and sends the finished link on feed C (spec C)`);
}

/* ---- 2. the link survives the trip from the shop ---- */
{
  const core = read("worker/src/bridge-core.ts");
  ok("the feed parser reads tracking_url", /tracking_url: \(\(\) => \{/.test(core));
  ok("only an https link is accepted",
     /u && u\.startsWith\("https:\/\/"\) \? u : null/.test(core),
     "this URL is put in front of a customer — anything else the feed sends is dropped");
  ok("WebOrderInput carries it", /tracking_url\?: string \| null;/.test(core));

  const bridge = read("worker/src/bridge.ts");
  ok("the poller stores it",
     /UPDATE web_orders SET tracking_url = \?2 WHERE store = 'elfia' AND order_number = \?1/.test(bridge));
  ok("storing it cannot break a pre-0098 sync",
     /tracking_url = \?2[\s\S]{0,300}?\.catch\(\(\) => null\)/.test(bridge),
     "the armored-statement pattern the consent field already uses");
  ok("the poller re-checks https rather than trusting the parse",
     /o\.tracking_url === "string" && o\.tracking_url\.startsWith\("https:\/\/"\)/.test(bridge));
}

/* ---- 3. the correction action is forwarded ---- */
{
  const staff = read("worker/src/staff.ts");
  ok("update_tracking is an allowed action",
     /"confirm_paid", "ship", "complete", "cancel", "update_tracking"/.test(staff));
  ok("the error message lists it too",
     /confirm_paid, ship, complete, cancel or update_tracking/.test(staff),
     "a message that names four actions when five are legal sends the next reader hunting");
}

/* ---- 4. the panel ---- */
{
  const panel = read("components/portal/web-orders-panel.tsx");
  ok("the tracking column links the shop's URL, not one of its own",
     /href=\{o\.tracking_url\}/.test(panel));
  ok("a number with no link is still shown as a number",
     /\$\{o\.tracking_courier \?\? ""\} \$\{o\.tracking_no\}/.test(panel),
     "a wrong link is worse than none, but so is hiding the number");
  ok("a shipped order can have its number corrected",
     /act\(o, "update_tracking", \{ tracking_no: tracking\.trim\(\), tracking_courier: courier \}\)/.test(panel),
     "a tracking number is typed off a label by hand — a typo used to be permanent");
  ok("the correction is refused client-side when nothing changed",
     /tracking\.trim\(\) === o\.tracking_no/.test(panel));
  ok("there is a way to hand the tracking to the customer",
     /wa\.me\/\$\{digits\}\?text=/.test(panel),
     "marking a parcel shipped updates the shop's page, but nothing reaches the customer until somebody sends it");
  ok("the WhatsApp message carries the link the SHOP built",
     /const link = url \?\? o\.tracking_url \?\? "";/.test(panel));
  ok("the fallback page comes from the brand registry",
     /brandByCode\("elfia"\)\?\.url/.test(panel),
     "a client domain typed into a component is what brands-guard exists to stop");
  ok("the link is available immediately after shipping",
     /setFreshUrl\(\(m\) => \(\{ \.\.\.m, \[o\.order_number\]: back\.tracking_url! \}\)\)/.test(panel),
     "otherwise the send button has no link until the next five-minute poll — exactly when somebody sends a bare number");
  /* The keys are a contract with the shop: it drops one it does not know. */
  const keys = [...panel.matchAll(/\{ key: "([a-z]+)", label:/g)].map((m) => m[1]).sort();
  ok("the courier keys still match the shop's list",
     JSON.stringify(keys) === JSON.stringify(["citylink", "dhl", "flash", "jnt", "ninjavan", "poslaju"]),
     `${keys.join(", ")} — a key the shop does not recognise is dropped, and the customer gets a number with no link`);
}

/* ---- 5. the migration is registered and probed ---- */
{
  const index = read("worker/src/index.ts");
  ok("0098 is in EXPECTED_MIGRATIONS", /"0098_web_order_tracking_url",/.test(index));
  ok("0098 has a health probe", /0098 \(courier tracking link on a web order\)/.test(index));
}

console.log(
  fails.length === 0
    ? `PASS — the shop owns the courier map, the portal only carries the link (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);

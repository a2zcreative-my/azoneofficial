/* v1.360.0 - PUSH ALERTS ARE REQUIRED FOR STAFF (the CEO, 18-11-2026: block until on, every staff role).
   Holds: the gate covers every role but agent and customer; it never holds anyone when the server has no
   push keys; it re-checks when the app returns to the front; the portal sits behind it (after 2FA); sign
   out always works; staff cannot switch push off from the menu. Browser: tests/browser/push-gate.py. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = { gate: "components/portal/push-gate.tsx", prov: "components/portal/portal-provider.tsx", shell: "components/portal/portal-shell.tsx", css: "components/portal/push-gate.module.css" };
const read = (f) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n");
function run(src) {
  const out = [];
  const ok = (name, cond) => out.push([name, Boolean(cond)]);
  ok("every staff role, not agents or customers", /export const pushRequiredFor = \(role: string \| undefined \| null\) => Boolean\(role\) && !\["agent", "customer"\]\.includes\(String\(role\)\);/.test(src.gate));
  ok("never held when the server has no push keys", /if \(key\.ok && !key\.data\?\.key\) \{ setState\("ok"\); return; \}/.test(src.gate));
  ok("on means this device AND this person (devicePushStatus)", /const d = await devicePushStatus\(\);\s*setState\(d === "on" \? "ok" : d\);/.test(src.gate));
  ok("re-checked whenever the app comes back to the front", /addEventListener\("visibilitychange", again\)/.test(src.gate) && /addEventListener\("focus", again\)/.test(src.gate));
  ok("sign out always works from the gate", /signOutRequest\(\)\.then/.test(src.gate));
  ok("blocked and unsupported devices are told how to fix it, with Check again", /state === "denied"/.test(src.gate) && /Add to Home Screen/.test(src.gate) && /push-gate-check/.test(src.gate));
  ok("the portal is behind the gate, after the 2FA screen", /const pushGate = usePushGate\(user && !user\.requires_2fa \? user\.role : null, onPushOn\);/.test(src.prov)
    && src.prov.indexOf("if (user.requires_2fa) {") < src.prov.indexOf('if (pushGate.state !== "ok" && pushGate.state !== "checking") {')
    && src.prov.indexOf('if (pushGate.state !== "ok" && pushGate.state !== "checking") {') < src.prov.indexOf("const activeTab: TabName"));
  /* v1.367.0 - the CEO's System health: ui_overflow on the gate (the card's foot at 789px in a 749px window) */
  ok("the gate never grows the document past the window (its page is the scroller)", /\.page \{[^}]*height: 100dvh;[^}]*overflow-y: auto;/.test(src.css) && !/\.page \{[^}]*min-height: 100dvh/.test(src.css));
  ok("staff cannot switch push off from the menu", /if \(pushRequiredFor\(user\?\.role\)\) \{[\s\S]{0,300}return;\s*\}\s*await disablePush\(\);/.test(src.shell));
  return out;
}
const base = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)]));
const res = run(base);
let failed = 0;
for (const [n, ok] of res) { if (!ok) { failed++; console.log("  ✗ " + n); } }
const MUT = [
  ["gate", "agents held too", '!["agent", "customer"].includes', '!["customer"].includes'],
  ["gate", "held when the server cannot push", 'if (key.ok && !key.data?.key) { setState("ok"); return; }', ""],
  ["gate", "permission alone counts as on", 'setState(d === "on" ? "ok" : d);', 'setState(d === "on" || d === "off" ? "ok" : d);'],
  ["gate", "never re-checked", 'document.addEventListener("visibilitychange", again);', ""],
  ["prov", "the portal not behind the gate", 'if (pushGate.state !== "ok" && pushGate.state !== "checking") {', 'if (false) {'],
  ["shell", "staff switch it off", "if (pushRequiredFor(user?.role)) {", "if (false) {"],
  ["css", "the gate page grows with its content", "  height: 100dvh;\n  overflow-y: auto;", "  min-height: 100dvh;"],
];
let caught = 0;
if (process.env.NOMUT !== "1") for (const [k, name, from, to] of MUT) {
  if (!base[k].includes(from)) { failed++; console.log(`  ✗ mutation did not apply: ${name}`); continue; }
  const r = run({ ...base, [k]: base[k].replace(from, to) });
  if (r.some(([, ok]) => !ok)) caught++; else { failed++; console.log(`  ✗ mutation not caught: ${name}`); }
}
if (failed) { console.log(`push-gate: ${failed} failed`); process.exit(1); }
console.log(`push-gate: ${res.length} checks passed (${caught} mutations caught) - push alerts are required for every staff role, on every device`);

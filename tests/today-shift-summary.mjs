/* TODAY'S SHIFT - ONE FUNCTION, ONE OWNER (v1.229.0) - guard.
 *
 * The owner's brief, 30-10-2026: "ONE FUNCTION. ONE OWNER. MULTIPLE
 * READ-ONLY SUMMARY VIEWS." Answers: "Yes, summary only", "Open On Shift",
 * "My Shift card like Image 1", "Phone header subtitle", "Tiles open My
 * attendance". On Shift is the only place a punch is pressed; the Dashboard
 * (My Day and the Overview) draws Today's Shift, read-only, from the same
 * state, and opens On Shift. This guard holds:
 *
 *   A TodayShiftCard is read-only: no punch, no request, no outbox, one
 *     button and it calls onOpen;
 *   B its state is decided from existing values only (todayShiftKind, run
 *     for real): loading/error before the server answers, a held punch is
 *     "not confirmed", review before anything else, open/between/done from
 *     the server's state, leave/holiday/rest from the month, never invented;
 *   C My Day draws the card and no punch control; the Overview's My Shift
 *     is the same element; every Dashboard way in opens On Shift;
 *   D the card is built from the state the page already has - no fetch of
 *     its own;
 *   E On Shift's tiles and My attendance open Attendance only for those who
 *     may; the phone header carries the subtitle on Today and On Shift.
 *
 * Negative-tested below: a punch button on My Day, a request in the card,
 * the open state read as done, the summary's link sent back to My Day, a
 * tile that opens Attendance for everybody, the subtitle on every tab.
 *
 *   node tests/today-shift-summary.mjs
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\{\s*\}/g, "");

const real = {
  onShift: read("components/portal/on-shift.tsx"),
  dash: read("components/portal/dashboard.tsx"),
  overview: read("components/portal/dashboard-overview.tsx"),
  shell: read("components/portal/portal-shell.tsx"),
  shellCss: read("app/portal/portal.module.css"),
};

async function kindOf(onShift) {
  const fn = (onShift.match(/export function todayShiftKind[\s\S]*?\n}\n/) ?? [""])[0];
  if (!fn) return null;
  const ts = `type ShiftState = string; type MonthDay = { status: string };\n${fn}`;
  const js = execSync("npx esbuild --loader=ts --format=esm --log-level=error", { input: ts, cwd: root }).toString();
  return (await import("data:text/javascript," + encodeURIComponent(js))).todayShiftKind;
}

async function checks(f) {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const on = strip(f.onShift), dash = strip(f.dash), ov = strip(f.overview);

  /* A */
  const card = on.slice(on.indexOf("export function TodayShiftCard"));
  ok(card.length > 100, "A TodayShiftCard exists");
  ok(!/punch(Ot)?\(|press\(|api\.|fetch\(|enqueue|outbox|navigator\.geolocation|useEffect/.test(card), "A the card makes no punch, request or outbox entry of its own");
  ok((card.match(/<button\b/g) ?? []).length === 1 && /<button type="button" className=\{css\.tsBtn\} onClick=\{onOpen\}>/.test(card), "A its one button opens On Shift (onOpen)");
  ok(!/\d{1,2}:\d{2}/.test(card.replace(/"\d{2}:\d{2}-\d{2}:\d{2}"/g, "")), "A no time is written into the card - every figure is passed in");

  /* B - run for real */
  const kind = await kindOf(f.onShift);
  ok(typeof kind === "function", "B todayShiftKind compiles");
  if (typeof kind === "function") {
    const base = { known: true, error: false, waiting: 0, state: "idle", canClockIn: true, dayStatus: null, leaveReview: false, hasSlots: true };
    const k = (o) => kind({ ...base, ...o });
    ok(k({ known: false }) === "loading" && k({ known: false, error: true }) === "error", "B nothing is said before the server answers");
    ok(k({ waiting: 1, state: "open" }) === "waiting", "B a punch held on the phone is not confirmed - whatever else is true");
    ok(k({ leaveReview: true, state: "open" }) === "review" && k({ dayStatus: "awaiting_approval" }) === "review", "B review is said before the shift state");
    ok(k({ state: "open" }) === "open", "B the server's open shift is On shift");
    ok(k({ state: "done", canClockIn: true }) === "between" && k({ state: "done", canClockIn: false }) === "done", "B out with a shift left is between shifts; nothing left is completed");
    ok(k({ dayStatus: "leave" }) === "leave" && k({ dayStatus: "holiday" }) === "holiday", "B leave and holidays from the month");
    ok(k({ hasSlots: false }) === "rest" && k({ dayStatus: "rest_day" }) === "rest", "B no shift today is said, not invented");
    ok(k({}) === "idle", "B a scheduled day not yet started is Not started");
    ok(k({ state: "open", dayStatus: "rest_day" }) === "open", "B a rest day worked still shows the open shift");
  }

  /* C */
  const zoneDay = dash.slice(dash.indexOf("const zoneDay = ("), dash.indexOf("const zoneDesk = ("));
  const zoneShift = dash.slice(dash.indexOf("const zoneShift = ("), dash.indexOf("const ZONES: Record"));
  ok(/\{todayShiftCard\}/.test(zoneDay), "C My Day draws Today's Shift");
  ok(!/punch|<button|otButtons|punchFeedback|clockOutNote|erp-shift-hero|AnalogClock/.test(zoneDay), "C My Day draws no punch control");
  ok((dash.match(/punch\("clock_(in|out)"/g) ?? []).length === (zoneShift.match(/punch\("clock_(in|out)"/g) ?? []).length
     && (zoneShift.match(/punch\("clock_(in|out)"/g) ?? []).length === 3, "C every punch is pressed on On Shift");
  ok((dash.match(/<TodayShiftCard\b/g) ?? []).length === 1 && /todayShift=\{todayShiftCard\}/.test(dash), "C the Overview's My Shift is the same element");
  ok(/onOpen=\{\(\) => go\("On Shift"\)\}/.test(dash) && /<WelcomeHeader [^>]*onOpenDay=\{\(\) => go\("On Shift"\)\}/.test(dash) && /onOpenShift=\{\(\) => go\("On Shift"\)\}/.test(dash), "C the card, the header chip and the quick action open On Shift");
  ok(/todayShift \? \(\s*<div className=\{ov\.card\}>\{todayShift\}<\/div>\s*\) :/.test(ov) && /onOpenShift \?\? onOpenDay/.test(ov), "C the Overview draws what it is handed and opens On Shift");

  /* D */
  const build = dash.slice(dash.indexOf("const todayStatus ="), dash.indexOf("const zoneDay = ("));
  ok(build.length > 100 && !/api\.|fetch\(|useEffect|cacheRead|setState|set[A-Z]\w*\(/.test(build), "D the summary reads the page's own state - no request of its own");
  ok(/state: shiftState, canClockIn/.test(build) && /waiting: waitingPunches\.length/.test(build) && /workedMinutes=\{workedToday\}/.test(build) && /openSince=\{openSinceRaw\}/.test(build), "D the same shift state, outbox and hours On Shift reads");

  /* E */
  ok(/return canAtt\s*\? <button key=\{k\} type="button" className=\{shiftCss\.tileBtn\} onClick=\{\(\) => go\("Attendance"\)\}/.test(zoneShift)
     && /: <div key=\{k\} className=\{shiftCss\.tileBtn\}>/.test(zoneShift), "E On Shift's tiles open My attendance only for those who may");
  ok(/\{canAtt && <button [^>]*onClick=\{\(\) => go\("Attendance"\)\}>/.test(zoneShift), "E the My attendance button is drawn only for those who may");
  ok(/\{\(activeTab === "Dashboard" \|\| activeTab === "On Shift"\) && \(?\s*<p className=\{`erp-phone-only \$\{css\.phoneSub\}`\}>/.test(strip(f.shell))
     && /\.phoneSub \{/.test(f.shellCss), "E the phone header's subtitle, on Today and On Shift only");
  return out;
}

let fail = 0, n = 0;
for (const [pass, m] of await checks(real)) { n++; if (!pass) { fail++; console.error("FAIL", m); } }

/* negative tests: each mutation must be caught */
const mutations = [
  ["a punch button on My Day", { dash: real.dash.replace("{todayShiftCard}", '{todayShiftCard}<button type="button" onClick={() => void punch("clock_in")}>In</button>') }],
  ["a request in the card", { onShift: real.onShift.replace("const showTimes =", 'void api.post("/staff/attendance", {});\n  const showTimes =') }],
  ["the open state read as done", { onShift: real.onShift.replace('if (p.state === "open") return "open";', 'if (p.state === "open") return "done";') }],
  ["the summary sent back to My Day", { dash: real.dash.replace('onOpen={() => go("On Shift")}', 'onOpen={() => setDashView("day")}') }],
  ["a held punch shown as done", { onShift: real.onShift.replace('if (p.waiting > 0) return "waiting";', "") }],
  ["tiles open Attendance for everybody", { dash: real.dash.replace("return canAtt\n                ? <button key={k}", "return true\n                ? <button key={k}") }],
  ["the subtitle on every tab", { shell: real.shell.replace('{(activeTab === "Dashboard" || activeTab === "On Shift") && (', "{(") }],
];
for (const [name, patch] of mutations) {
  const f = { ...real, ...patch };
  const changed = Object.keys(patch).every((k) => patch[k] !== real[k]);
  n++;
  if (!changed) { fail++; console.error("FAIL mutation did not apply:", name); continue; }
  const caught = (await checks(f)).some(([pass]) => !pass);
  if (!caught) { fail++; console.error("FAIL mutation not caught:", name); }
}

if (fail) { console.error(`today-shift-summary: ${fail} of ${n} failed`); process.exit(1); }
console.log(`today-shift-summary: ${n} checks passed (${mutations.length} mutations caught)`);

/**
 * v1.294.0 - ON SHIFT v2.0, RELEASE 1 (CEO directive "A2Z OS - ON SHIFT
 * v2.0", 12-11-2026, with its photo; "approve continuously", 13-11-2026;
 * O3: a drawn diagram, no third-party map and no key).
 *
 * What must stay true:
 *   A  a punch's location reaches the page as the server's OUTCOME - a word,
 *      a distance, an accuracy - judged by the punch gate's own rule, and
 *      never as coordinates; run for real against the rule below
 *   B  GET /staff/attendance and the monitor gain read-only fields only:
 *      no write, no new route, the same readers, coordinates never added
 *   C  the page keeps ONE punch, ONE location read (the punch and the tap),
 *      no background tracking, no map service, no key
 *   D  the layout is the photo's: My Shift beside Location Verification;
 *      Schedule, Punch Details, Quick Actions; the week; Team beside Recent
 *   E  Team On Shift: five counts from the rows drawn, search, filters,
 *      sort, paging, a detail drawer - status words, never a position
 *   F  the week and the recent days read the server's verdicts; nothing is
 *      classified on the page
 *
 * Every rule has a mutation that must turn it red.
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const FILES = {
  loc: "worker/src/punch-location.ts",
  staff: "worker/src/staff.ts",
  dash: "components/portal/dashboard.tsx",
  on: "components/portal/on-shift.tsx",
  sl: "components/portal/shift-location.tsx",
  oncss: "components/portal/on-shift.module.css",
  shared: "components/portal/page-shared.tsx",
};

const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ""; const j = s.indexOf(b, i + a.length); return s.slice(i, j < 0 ? s.length : j); };

function checks(f) {
  const out = [];
  const ok = (name, c, d = "") => out.push([name, Boolean(c), d]);
  const loc = strip(f.loc), staff = f.staff, dash = strip(f.dash), on = strip(f.on), sl = strip(f.sl);

  /* A - the outcome rule */
  ok("A the outcome uses the gate's grace: radius plus the accuracy, capped at 150 m",
    /export const ACCURACY_GRACE_CAP_M = 150;/.test(loc) && /const grace = acc === null \? 0 : Math\.min\(acc, ACCURACY_GRACE_CAP_M\);/.test(loc)
    && /if \(dist > fence\.radius_m \+ grace\) return \{ status: "outside"/.test(loc));
  ok("A low accuracy is said only for a reading wider than the fence, after the outside test",
    /if \(acc !== null && acc > fence\.radius_m\) return \{ status: "low_accuracy"/.test(loc) && loc.indexOf('status: "outside"') < loc.indexOf('status: "low_accuracy"'));
  ok("A a punch with no location says why (denied / unavailable), never verified",
    /startsWith\("no_location:"\)/.test(loc) && /status: why === "denied" \? "denied" : "unavailable"/.test(loc));
  ok("A no fence means recorded, never verified", /if \(!fence\) return \{ status: "recorded"/.test(loc));
  ok("A the outcome carries no coordinates", /export interface LocOutcome \{ status: LocStatus; distance_m: number \| null; accuracy_m: number \| null \}/.test(loc) && !/\blat:|\blng:/.test(between(loc, "export function locOutcome", "\n}\n")));
  ok("A one haversine, shared by the check route and the outcome", (staff.match(/function haversineM\(/g) ?? []).length === 0 && /import \{ haversineM, locOutcome, LOC_FLAG_EXEMPT_ROLES, type LocOutcome \} from "\.\/punch-location";/.test(staff));
  ok("A the flag exemption stays CEO, COO and CCO only", /export const LOC_FLAG_EXEMPT_ROLES: readonly string\[\] = \["ceo", "coo", "cco"\];/.test(loc));

  /* B - the routes */
  const get = between(staff, 'if (path === "/attendance" && method === "GET") {', 'if (path === "/attendance/monitor" && method === "GET") {');
  const mon = between(staff, 'if (path === "/attendance/monitor" && method === "GET") {', "/* ============ v1.84.0");
  ok("B GET /attendance: each record carries its outcome, and the stored gps is not passed on",
    /const records = results\.map\(\(r\) => \(\{\s*type: r\.type, ip: r\.ip, created_at: r\.created_at,\s*pending: r\.pending_approval === 1,\s*loc: locOutcome\(r\.gps, fenceA\) as LocOutcome,\s*\}\)\);/.test(get)
    && /records, ot, ot_eligible, today_shift, days,/.test(get) && !/records: results/.test(get));
  ok("B GET /attendance: the site goes out as its label and radius only", /fence: fenceA \? \{ label: fenceA\.label, radius_m: fenceA\.radius_m \} : null,/.test(get));
  ok("B GET /attendance: still read-only (no INSERT, UPDATE or DELETE added)", !/\b(INSERT|UPDATE|DELETE)\b/.test(get.replace(/deriveOtForDay/g, "")));
  ok("B the monitor still answers hr_manage or exec_view only", /if \(!can\(user\.role, "hr_manage"\) && !can\(user\.role, "exec_view"\)\)/.test(mon));
  ok("B the monitor's additions are outcomes and words: no coordinate leaves in a punch",
    /const punches = mine\.map\(\(p\) => \(\{ type: p\.type, at: p\.created_at, pending: p\.pending_approval === 1, loc: locOutcome\(p\.gps, fenceM\) as LocOutcome \}\)\);/.test(mon)
    && !/gps: p\.gps|lat: fenceM|lng: fenceM/.test(mon) && /site: fenceM \? \{ label: fenceM\.label, radius_m: fenceM\.radius_m \} : null,/.test(mon));
  ok("B the monitor reads today's shift from the one schedule rule (shiftResolver with the roster, daySlots)",
    /const asgM = await assignedResolver\(env, todayM, todayM\);\s*const shiftAtM = await shiftResolver\(env, asgM\);/.test(mon) && /daySlots\(sh\.windows, asgM\.list\(id, todayM\)/.test(mon));
  ok("B the monitor writes nothing", !/\b(INSERT|UPDATE|DELETE)\b/.test(mon));

  /* C - one punch, one location read, no tracking, no map service */
  ok("C one punch function, and On Shift still presses it three ways", (dash.match(/const punch = async/g) ?? []).length === 1
    && /void press\(\(\) => punch\("clock_out"\)\)/.test(dash) && /void press\(\(\) => punch\("clock_in"\)\)/.test(dash) && /void press\(\(\) => punch\("clock_out", forgotArmed\)\)/.test(dash));
  ok("C location is read by the punch and the tap only", (dash.match(/navigator\.geolocation\.getCurrentPosition/g) ?? []).length === 1 && !/geolocation|watchPosition/.test(on + sl) && !/watchPosition/.test(dash));
  ok("C the new drawing makes no request and loads no map", !/\bapi\(|fetch\(|useCachedApi|csrfFetch/.test(sl) && !/tile|leaflet|maps\.google|openstreetmap|mapbox|apikey|api_key/i.test(sl));
  ok("C the diagram says it shows distance, not direction", /The direction of the punch is not shown/.test(f.sl));
  ok("C the existing location check is the one control, inside the location card", /<LocationCard [\s\S]{0,300}?\{fenceStrip && \(/.test(dash) && (dash.match(/checkLocation\(\)/g) ?? []).length === 1);

  /* D - the layout */
  const css = f.oncss;
  ok("D the photo's grid: My Shift beside the location; schedule, punches, actions; the week; team beside recent",
    /"shift shift shift shift shift loc loc loc loc loc loc loc"\s*"sched sched sched sched punch punch punch punch quick quick quick quick"\s*"week week week week week week week week week week week week"\s*"team team team team team team team team recent recent recent recent";/.test(css));
  ok("D on a phone the punch follows My Shift directly", /\.aShift \{ order: 1; \}\s*\.aQuick \{ order: 2; \}\s*\.aLoc \{ order: 3; \}/.test(css));
  ok("D every card of the page is drawn", ["aShift", "aQuick", "aLoc", "aSched", "aPunch", "aRecent", "aWeek"].every((k) => dash.includes(`shiftCss.${k}`)));

  /* E - Team On Shift */
  const team = between(on, "export function TeamOnShift(", "\nfunction TeamDetail(");
  ok("E five counts, counted from the rows themselves", /scheduled: 0, on: 0, notIn: 0, out: 0, exceptions: 0/.test(team) && /for \(const m of rows \?\? \[\]\)/.test(team));
  ok("E scheduled headcount is not the on-shift headcount", /if \(sched\) c\.scheduled\+\+;/.test(team) && /if \(st === "on"\) c\.on\+\+;/.test(team));
  ok("E search, status, location, department, shift type and sort", ["team-status", "team-location", "team-dept", "team-shift", "team-sort"].every((t) => team.includes(`data-testid="${t}"`)));
  ok("E pages of ten", /const PAGE = 10;/.test(on) && /shown\.slice\(at \* PAGE, at \* PAGE \+ PAGE\)/.test(team));
  ok("E a row opens the detail drawer", /onClick=\{\(\) => setOpen\(m\)\}/.test(team) && /<SideDrawer open=\{!!open\}/.test(team));
  ok("E the team never draws a position", !/in_gps|geofence|\blat\b|\blng\b/.test(on));
  ok("E the exempt roles are not flagged in the team", /const flaggedToday = \(m: TeamRow\) => !m\.loc_exempt &&/.test(on));

  /* F - the week and the recent days */
  const week = between(on, "export function WeekSchedule(", "\n}\n");
  ok("F the week counts the server's verdicts", /late: vs\.filter\(\(v\) => v\.status === "late" \|\| v\.status === "half_day"\)\.length/.test(week) && /leave: vs\.filter\(\(v\) => v\.status === "leave"\)\.length/.test(week)
    && !/lateAgainst|halfDay|clock_in.*<=/.test(week));
  ok("F the roster rows are still the person's own", /s\.host_user_id === userId/.test(week) && /b\.user_id === userId/.test(week));
  ok("F a day can be opened", /setPick\(sel === d \? null : d\)/.test(week) && /data-testid="week-detail"/.test(week));
  ok("F recent attendance is five rows with the day's location", /const recent = paired\.slice\(0, 5\);/.test(on) && /data-testid="recent-row"/.test(on) && /<LocChip loc=\{fi\.loc\}/.test(on));
  ok("F the previous month is read only when the week began in it", /const prevMonthNeeded = shiftOnly && weekMon\.slice\(0, 7\) !== mytToday\(\)\.slice\(0, 7\);/.test(dash));
  return out;
}

/* ---- the outcome rule, run for real ---- */
async function runtime() {
  const out = [];
  const ok = (name, c, d = "") => out.push([name, Boolean(c), d]);
  const dir = mkdtempSync(join(tmpdir(), "onshift2-"));
  const bundle = join(dir, "loc.mjs");
  execSync(`npx esbuild "${join(root, FILES.loc)}" --bundle --format=esm --platform=neutral --outfile="${bundle}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const { locOutcome } = await import(pathToFileURL(bundle).href + `?v=${Math.random()}`);
  const fence = { lat: 1.56, lng: 103.72, radius_m: 100, label: "HQ" };
  const north = (m) => (1.56 + m / 111195).toFixed(7);
  const r1 = locOutcome(`${north(24)},103.72,8`, fence);
  ok("run: 24 m away, ±8 m - verified, 24 m", r1.status === "verified" && r1.distance_m === 24 && r1.accuracy_m === 8, JSON.stringify(r1));
  const r2 = locOutcome(`${north(132)},103.72,10`, fence);
  ok("run: 132 m away, ±10 m - outside (110 m allowed)", r2.status === "outside" && r2.distance_m === 132, JSON.stringify(r2));
  const r3 = locOutcome(`${north(132)},103.72,40`, fence);
  ok("run: 132 m away, ±40 m - inside the grace, not flagged", r3.status !== "outside", JSON.stringify(r3));
  const r4 = locOutcome(`${north(60)},103.72,400`, fence);
  ok("run: a 400 m reading inside the fence is low accuracy, not verified", r4.status === "low_accuracy", JSON.stringify(r4));
  const r5 = locOutcome(`${north(400)},103.72,900`, fence);
  ok("run: the grace stops at 150 m - 400 m away is outside however wide the reading", r5.status === "outside", JSON.stringify(r5));
  ok("run: no_location:denied is denied; timeout is unavailable", locOutcome("no_location:denied", fence).status === "denied" && locOutcome("no_location:timeout", fence).status === "unavailable");
  ok("run: nothing stored is none; a fence-less office is recorded", locOutcome(null, fence).status === "none" && locOutcome(`${north(5)},103.72,5`, null).status === "recorded");
  ok("run: garbage is none, never verified", locOutcome("91,200", fence).status === "none" && locOutcome("abc", fence).status === "none");
  ok("run: the outcome has exactly status, distance and accuracy", JSON.stringify(Object.keys(r1).sort()) === JSON.stringify(["accuracy_m", "distance_m", "status"]));
  return out;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = [...checks(base), ...(await runtime())];
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

const MUT = [
  ["the grace uncapped", "loc", "Math.min(acc, ACCURACY_GRACE_CAP_M)", "acc"],
  ["low accuracy called verified", "loc", 'if (acc !== null && acc > fence.radius_m) return { status: "low_accuracy", distance_m, accuracy_m };', ""],
  ["a denied punch called verified", "loc", 'status: why === "denied" ? "denied" : "unavailable"', 'status: "verified"'],
  ["coordinates in the outcome", "loc", "export interface LocOutcome { status: LocStatus; distance_m: number | null; accuracy_m: number | null }", "export interface LocOutcome { status: LocStatus; distance_m: number | null; accuracy_m: number | null; lat?: number }"],
  ["the COO flagged again", "loc", '["ceo", "coo", "cco"]', '["ceo", "cco"]'],
  ["raw records sent", "staff", "records, ot, ot_eligible, today_shift, days,", "records: results, ot, ot_eligible, today_shift, days,"],
  ["the gps passed on", "staff", "pending: r.pending_approval === 1,\n      loc: locOutcome(r.gps, fenceA) as LocOutcome,", "pending: r.pending_approval === 1, gps: r.gps,\n      loc: locOutcome(r.gps, fenceA) as LocOutcome,"],
  ["the monitor opened to everyone", "staff", 'if (!can(user.role, "hr_manage") && !can(user.role, "exec_view")) {\n      return err("forbidden", "HR access required", 403);\n    }\n    const todayM', 'if (false) {\n      return err("forbidden", "HR access required", 403);\n    }\n    const todayM'],
  ["a write in the monitor", "staff", "const staffM = (results", "await env.DB.prepare(`UPDATE users SET department = NULL`).run();\n    const staffM = (results"],
  ["a second location read", "dash", "const lastLocPunch =", "const watch = () => navigator.geolocation.watchPosition(() => {});\n  const lastLocPunch ="],
  ["a map service", "sl", "const NICE = [", 'const TILE = "https://tile.openstreetmap.org";\nconst NICE = ['],
  ["the direction claimed", "sl", "The direction of the punch is not shown", "The punch is shown where it was"],
  ["the punch after the location on a phone", "oncss", ".aQuick { order: 2; }", ".aQuick { order: 4; }"],
  ["team beside recent dropped", "oncss", '"team team team team team team team team recent recent recent recent";', '"team team team team team team team team team team team team";'],
  ["scheduled counted as on shift", "on", "if (sched) c.scheduled++;", "if (st === \"on\") c.scheduled++;"],
  ["no paging", "on", "const PAGE = 10;", "const PAGE = 1000;"],
  ["a position in the team", "on", "const job = (m: TeamRow) =>", "const pos = (m: TeamRow) => (m as unknown as { in_gps?: string }).in_gps;\n  const job = (m: TeamRow) =>"],
  ["the exempt flagged in the team", "on", "const flaggedToday = (m: TeamRow) => !m.loc_exempt &&", "const flaggedToday = (m: TeamRow) =>"],
  ["late classified on the page", "on", 'late: vs.filter((v) => v.status === "late" || v.status === "half_day").length,', "late: vs.filter((v) => v.in !== null && v.in > \"09:00\").length,"],
  ["seven recent days", "on", "const recent = paired.slice(0, 5);", "const recent = paired.slice(0, 7);"],
  ["the previous month read always", "dash", "const prevMonthNeeded = shiftOnly && weekMon.slice(0, 7) !== mytToday().slice(0, 7);", "const prevMonthNeeded = shiftOnly;"],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\nonshift2: ${failed.length} failed`); process.exit(1); }
console.log(`onshift2: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);

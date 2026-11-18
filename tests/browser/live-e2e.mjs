/* v1.368.0 - LIVE REPORTS, END TO END against a real local worker (real
   migrations through 0210, real D1, local R2). Not a release guard (it needs
   a running server). Seed: tests/browser/chat-seed.sql then
   tests/browser/live-seed.sql. Start the worker with
     --var ALLOWED_ORIGINS:http://127.0.0.1:4500 --var ALLOWED_ORIGIN:http://127.0.0.1:4500
     --var 'LIVE_AI_TEST_FAKE:<a JSON reading>'
   (LIVE_AI_TEST_FAKE stands in for Workers AI on a 127.0.0.1 origin only). */
import { execFileSync } from "node:child_process";

const BASE = process.env.LIVE_BASE ?? "http://127.0.0.1:8787";
const ID = { ceo: 101, coo: 102, sales: 103, agent: 104, customer: 105, leaver: 106, editor: 108, cco: 109, designer: 110 };
let pass = 0, failN = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ok  ${name}`); } else { failN++; console.log(`  FAIL ${name} ${extra}`); } };
const hdr = (who, extra = {}) => ({ Cookie: `azone_session=tok${ID[who]}; csrf_token=t${ID[who]}`, "X-CSRF-Token": `t${ID[who]}`, Origin: "http://127.0.0.1:4500", ...extra });
async function api(who, method, path, body, extra = {}) {
  const bin = body instanceof Uint8Array;
  const r = await fetch(`${BASE}/api/v1/staff${path}`, { method, headers: hdr(who, bin ? extra : { "Content-Type": "application/json", ...extra }), body: body === undefined ? undefined : bin ? body : JSON.stringify(body) });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, d };
}
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "azoneofficial", "--local", "--persist-to", process.env.LIVE_PERSIST ?? "/tmp/chatdev", "--command", sql], { cwd: new URL("../../worker", import.meta.url).pathname, stdio: "pipe" }).toString();
const png = () => { const b = new Uint8Array(3000); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const day = (n) => new Date(Date.now() + 8 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);
const today = day(0);

/* clean slate for the reports of the test lives (the test database only) */
d1(`DELETE FROM ai_budget; DELETE FROM system_meta WHERE key = 'live_ai_settings'`);

console.log("1. Who may report a live");
const list = await api("sales", "GET", "/live-reports");
ok("the roster host sees her live to report", list.d.sessions_to_report?.some((s) => s.id === 801));
ok("a staff member who was not in it cannot start its report", (await api("editor", "POST", "/live-reports", { session_id: 801 })).status === 403);
const join = await api("editor", "POST", "/live-reports/sessions/801/participants", { role: "co_host" });
ok("a co-host who performed it adds himself", join.status === 201 && join.d.participants.length === 2, JSON.stringify(join.d));
ok("joining twice is refused", (await api("editor", "POST", "/live-reports/sessions/801/participants", { role: "co_host" })).status === 409);
const start = await api("editor", "POST", "/live-reports", { session_id: 801 });
ok("the co-host starts the report", start.status === 201);
const rid = start.d.id;
const again = await api("sales", "POST", "/live-reports", { session_id: 801 });
ok("the host gets the SAME report, never a second one", again.d.id === rid && again.d.existing === true);
ok("an agent is refused", (await api("agent", "GET", "/live-reports")).status === 403);
ok("a customer is refused", [401, 403].includes((await api("customer", "GET", "/live-reports")).status));
ok("an agent cannot join a live", (await api("agent", "POST", "/live-reports/sessions/801/participants", { role: "sales" })).status === 403);
ok("a leaver cannot be added", (await api("sales", "POST", `/live-reports/${rid}/participants`, { user_id: ID.leaver, role: "assistant" })).status === 409);
ok("someone outside the live (and not a roster manager) cannot add a colleague", (await api("designer", "POST", "/live-reports/sessions/801/participants", { user_id: ID.cco, role: "sales" })).status === 403);
const addD = await api("sales", "POST", `/live-reports/${rid}/participants`, { user_id: ID.designer, role: "assistant" });
ok("a participant adds a colleague (a custom-role staff member) as assistant", addD.status === 201 && addD.d.participants.some((p) => p.user_id === ID.designer && p.role === "assistant"));
ok("a roster manager (the COO) may add who performed it", (await api("coo", "POST", `/live-reports/${rid}/participants`, { user_id: ID.cco, role: "sales" })).status === 201);
const rm = await api("sales", "POST", `/live-reports/${rid}/participants/${ID.cco}/remove`);
ok("a participant row is removed before submission", rm.status === 200 && !rm.d.participants.some((p) => p.user_id === ID.cco));
ok("the host cannot be removed", (await api("editor", "POST", `/live-reports/${rid}/participants/${ID.sales}/remove`)).status === 409);

console.log("2. Project, company and figures");
ok("a completed project is refused", (await api("sales", "PUT", `/live-reports/${rid}/draft`, { project_id: 703 })).status === 400);
ok("an active project is accepted", (await api("sales", "PUT", `/live-reports/${rid}/draft`, { project_id: 701 })).status === 200);
let det = await api("editor", "GET", `/live-reports/${rid}`);
ok("client and company come from the project (A2Z quotation -> a2z)", det.d.project?.client === "ELFIA Official" && det.d.report.company === "a2z", JSON.stringify(det.d.project));
ok("the company cannot be typed once a project is set", (await api("sales", "PUT", `/live-reports/${rid}/draft`, { company: "azoo" })).status === 400);
ok("a CTR over 100% is refused", (await api("sales", "PUT", `/live-reports/${rid}/draft`, { ctr: 140 })).status === 400);

console.log("3. Screenshot AI - Workers AI only, capped, never required");
const up = await api("editor", "POST", `/live-reports/${rid}/files`, png(), { "Content-Type": "image/png", "X-File-Name": "summary.png" });
ok("a participant uploads the GMV screenshot", up.status === 201);
const fid = up.d.id;
let rd = await api("editor", "POST", `/live-reports/${rid}/files/${fid}/read`);
ok("with the AI off, the answer is: type the figures", rd.status === 200 && rd.d.manual === true && rd.d.reason === "off");
ok("staff cannot turn the AI on", (await api("sales", "PUT", "/live-reports/ai", { enabled: true, accept_licence: true })).status === 403);
ok("the COO cannot turn the AI on (the CEO alone)", (await api("coo", "PUT", "/live-reports/ai", { enabled: true, accept_licence: true })).status === 403);
ok("turning it on needs the licence confirmed", (await api("ceo", "PUT", "/live-reports/ai", { enabled: true, cap: 2 })).d?.error?.code === "licence_required");
ok("a ceiling above 8,000 Neurons is refused", (await api("ceo", "PUT", "/live-reports/ai", { enabled: true, cap: 2, ceiling: 9500, accept_licence: true })).status === 400);
ok("the CEO turns it on with a cap of 2", (await api("ceo", "PUT", "/live-reports/ai", { enabled: true, cap: 2, accept_licence: true })).status === 200);
rd = await api("editor", "POST", `/live-reports/${rid}/files/${fid}/read`);
ok("a read returns the ten figures", rd.d.manual === false && rd.d.figures?.gmv === 4860 && rd.d.figures.avg_watch_sec === 156 && rd.d.figures.duration_min === 89 && rd.d.figures.conversion === 1.5, JSON.stringify(rd.d));
det = await api("editor", "GET", `/live-reports/${rid}`);
ok("the AI reading is stored apart from the draft", det.d.readings.length === 1 && det.d.report.draft_gmv_cents === null);
await api("editor", "POST", `/live-reports/${rid}/files/${fid}/read`);
rd = await api("editor", "POST", `/live-reports/${rid}/files/${fid}/read`);
ok("past the CEO's cap: manual entry, at once", rd.d.manual === true && rd.d.reason === "cap_reached", JSON.stringify(rd.d));
await api("ceo", "PUT", "/live-reports/ai", { cap: 5 });
d1(`UPDATE ai_budget SET calls = 0, neurons = 0`);
const burst = await Promise.all(Array.from({ length: 9 }, () => api("editor", "POST", `/live-reports/${rid}/files/${fid}/read`)));
const read = burst.filter((r) => r.d.manual === false).length;
ok(`nine reads at once: exactly the cap of 5 go through (${read}), the rest fall back`, read === 5 && burst.filter((r) => r.d.reason === "cap_reached").length === 4);
await api("ceo", "PUT", "/live-reports/ai", { cap: 30, ceiling: 1000 });
d1(`UPDATE ai_budget SET calls = 0, neurons = 700`);
rd = await api("editor", "POST", `/live-reports/${rid}/files/${fid}/read`);
ok("near the Neuron ceiling: refused before the call, manual entry", rd.d.manual === true && rd.d.reason === "ceiling_reached");
const usage = await api("ceo", "GET", "/live-reports/ai");
ok("today's usage, the cap and the fallback are reported", usage.status === 200 && usage.d.cap === 30 && usage.d.refused >= 5 && usage.d.fallback === "ceiling_reached", JSON.stringify(usage.d));
ok("staff cannot read the AI usage", (await api("editor", "GET", "/live-reports/ai")).status === 403);

console.log("4. Confirm and submit");
ok("submitting with no GMV is refused", (await api("sales", "POST", `/live-reports/${rid}/submit`)).status === 400);
ok("staff confirm the figures (corrected GMV)", (await api("sales", "PUT", `/live-reports/${rid}/draft`, { gmv: 4900, viewers: 12430, peak_viewers: 2860, avg_watch_sec: 156, orders: 186, items_sold: 240, product_clicks: 3100, ctr: 3.2, conversion: 1.5, duration_min: 89, highlights: "Strong opening" })).status === 200);
const sub = await api("editor", "POST", `/live-reports/${rid}/submit`);
ok("a co-host submits", sub.status === 200 && sub.d.state === "submitted");
det = await api("ceo", "GET", `/live-reports/${rid}`);
const v1 = det.d.versions[0];
ok("the version keeps the confirmed figures, project and participants", v1.gmv_cents === 490000 && v1.viewers === 12430 && v1.ctr_bp === 320 && v1.project_id === 701 && JSON.parse(v1.participants).length === 3, JSON.stringify(v1));
ok("the AI reading stays as it was read (4,860, not the confirmed 4,900)", JSON.parse(det.d.readings.at(-1).figures).gmv === 4860);
ok("after submission nobody edits it", (await api("sales", "PUT", `/live-reports/${rid}/draft`, { gmv: 1 })).status === 409);
ok("after submission nobody joins it", (await api("coo", "POST", "/live-reports/sessions/801/participants", { role: "sales" })).status === 409);
let caught = false; try { d1(`UPDATE live_report_ai_readings SET figures = '{}'`); } catch { caught = true; }
ok("the database refuses to rewrite an AI reading", caught);

console.log("5. Review: CEO, COO or CCO - never someone who took part");
ok("staff cannot review", (await api("editor", "POST", `/live-reports/${rid}/review`, { action: "accept" })).status === 403);
const mk = await api("cco", "POST", "/live-reports/unplanned", { project_id: 702, session_date: day(2), start_time: "21:00", end_time: "22:00", platform: "tiktok" });
ok("the CCO reports an unplanned live of his own", mk.status === 201, JSON.stringify(mk.d));
await api("cco", "PUT", `/live-reports/${mk.d.id}/draft`, { gmv: 1200, viewers: 3000, orders: 40, duration_min: 60 });
await api("cco", "POST", `/live-reports/${mk.d.id}/files`, png(), { "Content-Type": "image/png" });
await api("cco", "POST", `/live-reports/${mk.d.id}/submit`);
ok("he can never review his own live", (await api("cco", "POST", `/live-reports/${mk.d.id}/review`, { action: "accept" })).d?.error?.code === "self_approval");
ok("the CEO, who was not in it, accepts it", (await api("ceo", "POST", `/live-reports/${mk.d.id}/review`, { action: "accept" })).status === 200);
ok("the CEO accepts the co-hosted report", (await api("ceo", "POST", `/live-reports/${rid}/review`, { action: "accept" })).status === 200);

console.log("6. Unplanned lives: project first, never twice");
ok("an unplanned live needs an active project", (await api("sales", "POST", "/live-reports/unplanned", { project_id: 703, session_date: today, start_time: "10:00", end_time: "11:00", platform: "tiktok" })).d?.error?.code === "project_required");
ok("a future live is refused", (await api("sales", "POST", "/live-reports/unplanned", { project_id: 701, session_date: day(-2), start_time: "10:00", end_time: "11:00", platform: "tiktok" })).status === 409);
const dupA = await api("sales", "POST", "/live-reports/unplanned", { project_id: 702, session_date: day(2), start_time: "21:30", end_time: "22:30", platform: "tiktok" });
ok("the same project, platform and overlapping time is the SAME live - join it", dupA.status === 409 && dupA.d.existing === true && dupA.d.session_id === mk.d.session_id, JSON.stringify(dupA.d));
const sameTime = await Promise.all([
  api("sales", "POST", "/live-reports/unplanned", { project_id: 701, session_date: day(5), start_time: "20:00", end_time: "21:00", platform: "shopee" }),
  api("editor", "POST", "/live-reports/unplanned", { project_id: 701, session_date: day(5), start_time: "20:15", end_time: "21:15", platform: "shopee" }),
]);
const made = d1(`SELECT COUNT(*) AS n FROM live_sessions WHERE project_id = 701 AND session_date = '${day(5)}' AND platform = 'shopee'`);
ok("two reporters at the same moment make ONE live", /"n": 1/.test(made) && sameTime.filter((r) => r.status === 201).length === 1, made.replace(/\s+/g, " ").slice(-60));

console.log("7. Rule-based analysis");
/* three earlier lives on project 701, GMV falling, then one with many viewers and few orders */
const lives = [[9, 6000, 8000, 160], [8, 5200, 8000, 150], [7, 4400, 8000, 140]];
for (const [ago, gmv, viewers, orders] of lives) {
  const u = await api("sales", "POST", "/live-reports/unplanned", { project_id: 701, session_date: day(ago), start_time: "20:00", end_time: "21:00", platform: "tiktok" });
  await api("sales", "PUT", `/live-reports/${u.d.id}/draft`, { gmv, viewers, orders, duration_min: 60 });
  await api("sales", "POST", `/live-reports/${u.d.id}/files`, png(), { "Content-Type": "image/png" });
  await api("sales", "POST", `/live-reports/${u.d.id}/submit`);
}
const last = await api("sales", "POST", "/live-reports/unplanned", { project_id: 701, session_date: day(6), start_time: "20:00", end_time: "21:30", platform: "tiktok" });
await api("sales", "PUT", `/live-reports/${last.d.id}/draft`, { gmv: 3600, viewers: 12000, orders: 120, duration_min: 90 });
await api("sales", "POST", `/live-reports/${last.d.id}/files`, png(), { "Content-Type": "image/png" });
await api("sales", "POST", `/live-reports/${last.d.id}/submit`);
const an = (await api("ceo", "GET", `/live-reports/${last.d.id}`)).d.analysis;
const keys = (an?.flags ?? []).map((f) => f.key);
ok("GMV/hour, conversion and average order value", an?.gmv_per_hour_cents === 240000 && Math.abs(an.conversion - 0.01) < 1e-9 && an.aov_cents === 3000, JSON.stringify(an && { g: an.gmv_per_hour_cents, c: an.conversion, a: an.aov_cents }));
ok("flag: viewers high, orders low", keys.includes("viewers_high_orders_low"), keys.join(","));
ok("flag: conversion below project average", keys.includes("conversion_below_project"), keys.join(","));
ok("flag: GMV declining for three consecutive lives", keys.includes("gmv_down_three"), keys.join(","));
ok("each flag carries fixed suggestions", (an?.flags ?? []).every((f) => f.tips.length === 3));

console.log("8. The overview");
const ov = await api("ceo", "GET", "/live-reports/overview");
const f = ov.d.figures;
ok("the month's figures add up from confirmed reports only", ov.status === 200 && f.reported >= 1 && typeof f.gmv_cents === "number", JSON.stringify(f));
ok("a waiting-for-review count for management", typeof ov.d.waiting_review === "number");
const ovs = await api("editor", "GET", "/live-reports/overview");
ok("staff see only the lives they took part in", ovs.status === 200 && ovs.d.waiting_review === null && ovs.d.figures.reported <= f.reported);
ok("an agent cannot read the overview", (await api("agent", "GET", "/live-reports/overview")).status === 403);
ok("an agent cannot open a screenshot", (await api("agent", "GET", `/live-reports/${rid}/files/${fid}`)).status === 403);
ok("a reviewer opens a screenshot", (await api("coo", "GET", `/live-reports/${rid}/files/${fid}`)).status === 200);
ok("staff outside the live cannot open its screenshot", (await api("designer", "GET", `/live-reports/${mk.d.id}/files/${fid}`)).status === 403);
/* v1.369.0 - the document tag: the live invoice of the project's quotation, else the quotation (a voided invoice never counts) */
{ const pr = (await api("sales", "GET", "/live-reports/projects")).d?.projects ?? [];
  const a = pr.find((x) => x.id === 701), b = pr.find((x) => x.id === 702);
  ok("an invoiced project is tagged with its invoice", a?.inv_number === "INV-TEST-603" && a?.qt_number === "QT-TEST-601", JSON.stringify(a));
  ok("a project whose only invoice is voided is tagged with its quotation", b?.inv_number === null && b?.qt_number === "QT-TEST-602", JSON.stringify(b)); }
/* v1.368.0 - the drawer's "a live you performed but are not listed in" read */
{ const mine = await api("sales", "GET", "/live-reports/recent-lives"), other = await api("coo", "GET", "/live-reports/recent-lives");
  ok("recent lives leaves out the lives you are already on", mine.status === 200 && !mine.d.sessions.some((x) => x.id === 801), JSON.stringify(mine.d).slice(0, 200));
  ok("recent lives lists a roster live you are not on, with its host", other.status === 200 && other.d.sessions.some((x) => x.id === 801 && x.host_name), JSON.stringify(other.d).slice(0, 200));
  ok("an agent cannot list recent lives", (await api("agent", "GET", "/live-reports/recent-lives")).status === 403); }

console.log(`\nlive-e2e: ${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);

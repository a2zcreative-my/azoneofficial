#!/usr/bin/env node
/* Guard #45 — v1.110.0 (roadmap phase 05): the hotel directory is a pipeline.
 *
 * 442 hotels and 690 named contacts were a phone book; now each hotel has a
 * stage, a call log, a follow-up date and a link to the client it became.
 * The two rules that make that a pipeline rather than a form are RUN here:
 *
 *   1. THE STAGE MOVES BY WHAT HAPPENED. stageAfter() only ever advances by
 *      itself - a no-answer after a quotation does not un-quote the hotel -
 *      and lost / not_interested / won are terminal by intent, except that a
 *      call revives a hotel somebody marked lost or dormant.
 *   2. "DUE" MEANS A LAPSE, NOT A BACKLOG. A follow-up date that has passed
 *      is due; a worked hotel quiet for ninety days is due; a lead nobody
 *      has ever rung is NOT due - it is the worklist, and 300 of them would
 *      bury the ten real lapses.
 *   3. LOGGING A CALL, against a fake database: refuses an unknown outcome,
 *      refuses a contact from another hotel, writes the call, advances the
 *      stage, keeps an existing owner, audits.
 *   4. THE WIRING: the pipeline door in hotels.ts sits before the list route
 *      so /:id/calls is not read as a hotel id; the list carries the pipeline
 *      columns with a pre-0116 fallback; a call is queueable on BOTH sides of
 *      the outbox and the panel says "kept" when it queues; the panel's
 *      vocabulary is the worker's (same stages, same outcomes); the panel's
 *      inner component is module-scope; the follow-up watcher exists and
 *      points at the Hotels tab; every mutation is audited and behind
 *      hotels_manage while the read is not; 0116 is probed.
 *
 * Negative-tested by: letting a no-answer set stage = contacted regardless
 * (1 - the quoted hotel regresses); making a lead due when last_contact_at
 * is null (2); dropping the contact-ownership check (3); moving the door
 * below the list route (4).
 */
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const src = read("worker/src/hotel-pipeline.ts");
const hotels = read("worker/src/hotels.ts");
const watchers = read("worker/src/watchers.ts");
const index = read("worker/src/index.ts");
const workerOutbox = read("worker/src/outbox.ts");
const clientOutbox = read("lib/outbox.ts");
const panel = read("components/portal/hotels-panel.tsx");
const banner = read("components/ui/offline-banner.tsx");
const migration = read("worker/migrations/0116_hotel_pipeline.sql");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- bundle with shared and permissions stubbed ---- */
const dir = mkdtempSync(join(tmpdir(), "hpipe-"));
writeFileSync(join(dir, "shared.js"), `
export const audits = [];
export function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }); }
export function err(code, message, status) { return json({ error: { code, message } }, status); }
export async function audit(env, userId, action, table, id, meta) { audits.push({ userId, action, table, id, meta }); }
`);
writeFileSync(join(dir, "permissions.js"), `export function can(role, perm) { return role === "ceo"; }`);
const rewritten = src
  .replace('from "./shared"', `from "${join(dir, "shared.js")}"`)
  .replace('from "./permissions"', `from "${join(dir, "permissions.js")}"`);
writeFileSync(join(dir, "hotel-pipeline.ts"), rewritten);
const out = join(dir, "hotel-pipeline.mjs");
execSync(`npx esbuild ${join(dir, "hotel-pipeline.ts")} --bundle --format=esm --platform=neutral --external:*/shared.js --external:*/permissions.js --outfile=${out} --log-level=error`, { cwd: root, stdio: "inherit" });
const P = await import(pathToFileURL(out).href);
const { audits } = await import(pathToFileURL(join(dir, "shared.js")).href);

/* ---- 1. the stage moves by what happened ---- */
{
  const { stageAfter } = P;
  ok("a call moves a lead to contacted", stageAfter("lead", "spoke") === "contacted");
  ok("a no-answer still counts as contact", stageAfter("lead", "no_answer") === "contacted");
  ok("a no-answer after a quotation does not un-quote it", stageAfter("quoted", "no_answer") === "quoted", "the stage went backwards");
  ok("sending a quotation moves contacted to quoted", stageAfter("contacted", "sent_quote") === "quoted");
  ok("winning is winning from anywhere", stageAfter("lead", "won") === "won" && stageAfter("quoted", "won") === "won");
  ok("a won hotel stays won on an ordinary call", stageAfter("won", "callback") === "won");
  ok("not interested is lost", stageAfter("quoted", "not_interested") === "lost");
  ok("a call revives a lost hotel", stageAfter("lost", "spoke") === "contacted");
  ok("a call revives a dormant hotel", stageAfter("dormant", "sent_quote") === "quoted");
  ok("an unknown current stage is treated as a lead", stageAfter("garbage", "spoke") === "contacted");
  ok("STAGES and OUTCOMES are the migration's CHECK lists",
     P.STAGES.every((s) => migration.includes(`'${s}'`)) && P.OUTCOMES.every((o) => migration.includes(`'${o}'`)));
}

/* ---- 2. due means a lapse ---- */
{
  const { isDue } = P;
  const today = "2026-09-05";
  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  ok("a follow-up date that has passed is due", isDue({ stage: "contacted", next_at: "2026-09-04", last_contact_at: daysAgo(3) }, today));
  ok("a follow-up date of today is due", isDue({ stage: "contacted", next_at: "2026-09-05", last_contact_at: daysAgo(3) }, today));
  ok("a follow-up date ahead is not due", !isDue({ stage: "contacted", next_at: "2026-09-06", last_contact_at: daysAgo(3) }, today));
  ok("a contacted hotel quiet 91 days is due", isDue({ stage: "contacted", next_at: null, last_contact_at: daysAgo(91) }, today));
  ok("a quoted hotel quiet 91 days is due", isDue({ stage: "quoted", next_at: null, last_contact_at: daysAgo(91) }, today));
  ok("a contacted hotel quiet 30 days is not", !isDue({ stage: "contacted", next_at: null, last_contact_at: daysAgo(30) }, today));
  ok("the quiet threshold is a parameter", isDue({ stage: "contacted", next_at: null, last_contact_at: daysAgo(31) }, today, 30));
  ok("a lead never rung is NOT due - it is the worklist", !isDue({ stage: "lead", next_at: null, last_contact_at: null }, today), "300 never-called hotels would bury the real lapses");
  ok("a won hotel gone quiet is not due", !isDue({ stage: "won", next_at: null, last_contact_at: daysAgo(200) }, today));
  ok("a lost hotel gone quiet is not due", !isDue({ stage: "lost", next_at: null, last_contact_at: daysAgo(200) }, today));
}

/* ---- 3. logging a call against a fake database ---- */
{
  const state = {
    hotel: { id: 7, hotel_name: "Hotel Seri", state: "JOHOR", stage: "quoted", customer_id: null, last_contact_at: null, next_at: null, owner_id: 3 },
    contacts: { 21: 7, 22: 8 }, // contact id -> hotel id
    calls: [], updates: [],
  };
  const fakeDb = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/FROM hotels WHERE id = \?1 AND is_active = 1/.test(sql)) return args[0] === 7 ? state.hotel : null;
              if (/FROM hotel_contacts WHERE id = \?1 AND hotel_id = \?2/.test(sql)) return state.contacts[args[0]] === args[1] ? { id: args[0] } : null;
              if (/INSERT INTO hotel_calls/.test(sql)) { state.calls.push(args); return { id: 100 + state.calls.length, called_at: "2026-09-05 08:00:00" }; }
              return null;
            },
            async run() { if (/UPDATE hotels SET stage/.test(sql)) state.updates.push(args); return {}; },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  const env = { DB: fakeDb };
  const ceo = { id: 9, role: "ceo" };
  const call = (body, user = ceo) => P.handleHotelPipeline(env, "/7/calls", "POST", body, user, new URLSearchParams());

  let r = await call({ outcome: "dance" });
  ok("an unknown outcome is refused", r?.status === 400, String(r?.status));
  r = await call({ outcome: "spoke", contact_id: 22 });
  ok("a contact from another hotel is refused", r?.status === 400 && state.calls.length === 0, "the call was written with a stranger's contact");
  r = await call({ outcome: "no_answer", contact_id: 21, notes: "  rang twice  ", next_at: "2026-09-12" });
  const body = await r.json();
  ok("a good call is written", r.status === 200 && body.ok === true && state.calls.length === 1);
  ok("...with the contact, the user, trimmed notes and the date", state.calls[0]?.[1] === 21 && state.calls[0]?.[2] === 9 && state.calls[0]?.[4] === "rang twice" && state.calls[0]?.[5] === "2026-09-12");
  ok("...the stage did not regress from quoted", body.stage === "quoted" && state.updates[0]?.[0] === "quoted");
  ok("...last_contact_at is the call's time and next_at the follow-up", state.updates[0]?.[1] === "2026-09-05 08:00:00" && state.updates[0]?.[2] === "2026-09-12");
  ok("...the owner is kept when one is set (COALESCE)", /owner_id = COALESCE\(owner_id, \?4\)/.test(src));
  ok("...and it is audited as hotel.call", audits.some((a) => a.action === "hotel.call" && a.id === "7" && a.meta?.outcome === "no_answer"));
  r = await call({ outcome: "spoke" }, { id: 2, role: "hr_admin" });
  ok("a role without hotels_manage is refused", r?.status === 403);
  r = await call({ outcome: "spoke", next_at: "12/09/2026" });
  ok("a date not in ISO form is dropped, not stored", r.status === 200 && state.calls.at(-1)?.[5] === null);
  const missing = await P.handleHotelPipeline(env, "/8/calls", "POST", { outcome: "spoke" }, ceo, new URLSearchParams());
  ok("an unknown hotel is 404", missing?.status === 404);
  const notMine = await P.handleHotelPipeline(env, "/7/edit", "POST", {}, ceo, new URLSearchParams());
  ok("a leaf the module does not own falls through (null)", notMine === null);
}

/* ---- 4. the wiring ---- */
{
  const door = hotels.indexOf("handleHotelPipeline(env, path, method");
  const list = hotels.search(/if \(\(path === "" \|\| path === "\/"\) && method === "GET"\)/);
  ok("the pipeline door is in hotels.ts and before the list route", door > 0 && list > 0 && door < list, "/7/calls must not be read as hotel 7");
  ok("the door covers every leaf the module answers", /\/\^\\\/\\d\+\\\/\(calls\|link\|client\|stage\|pipeline\)\$\//.test(hotels) && hotels.includes('path === "/pipeline"'));
  ok("the list carries the pipeline columns", /SELECT id, state, hotel_name, company, address, rooms, stars, mof_validity, halal_validity, notes, updated_at,\s*stage, customer_id, last_contact_at, next_at, owner_id/.test(hotels)
     || /stage, customer_id, last_contact_at, next_at, owner_id[\s\S]{0,80}FROM hotels/.test(hotels));
  ok("...with a pre-0116 fallback", /no such column/.test(hotels));
  ok("the list filters by ?stage= and ?due=1", /params\.get\("stage"\)/.test(hotels) && /params\.get\("due"\) === "1"/.test(hotels));
  ok("the list carries per-state money for the map", /state_money: stateMoney/.test(hotels));

  ok("a call is queueable on the client", /path: \/\^\\\/staff\\\/hotels\\\/\\d\+\\\/calls\$\/,\s*kind: "hotel_call"/.test(clientOutbox));
  ok("...and on the worker", /path: \/\^\\\/hotels\\\/\\d\+\\\/calls\$\//.test(workerOutbox));
  ok("the banner names a refused call note", /hotel_call: \["call note"/.test(banner));
  ok("the panel says 'kept' when the call queues", /r\.queued\b[\s\S]{0,300}?Kept — no signal/.test(panel), "a queued call that looks like a failure gets logged twice");
  ok("the panel reports every other answer too", /Call logged/.test(panel) && /Not logged/.test(panel) && /Stage set/.test(panel) && /Client linked/.test(panel) && /Client created/.test(panel));

  const stageKeys = [...(panel.match(/const STAGE_LABEL[\s\S]*?\};/)?.[0] ?? "").matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
  const outcomeKeys = [...(panel.match(/const OUTCOME_LABEL[\s\S]*?\};/)?.[0] ?? "").matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
  ok("the panel's stages are the worker's", JSON.stringify(stageKeys) === JSON.stringify([...P.STAGES]), stageKeys.join(","));
  ok("the panel's outcomes are the worker's", JSON.stringify(outcomeKeys) === JSON.stringify([...P.OUTCOMES]), outcomeKeys.join(","));
  const filterKeys = [...(panel.match(/const FILTERS[\s\S]*?\];/)?.[0] ?? "").matchAll(/key: "([a-z_]*)"/g)].map((m) => m[1]);
  ok("every filter chip is a stage, 'due' or all", filterKeys.length >= 4 && filterKeys.every((k) => k === "" || k === "due" || P.STAGES.includes(k)), filterKeys.join(","));
  ok("the chips include the worklist and the lapses", filterKeys.includes("lead") && filterKeys.includes("due"));
  ok("the inner component is module-scope (#30)", /^function HotelPipeline\(/m.test(panel));
  ok("the pipeline view is remembered and live", /useCachedApi<PipeData>\(`\/staff\/hotels\/\$\{hotel\.id\}\/pipeline`, true, \["hotels"\]\)/.test(panel));
  ok("the map has a revenue colouring", /mapMode === "revenue"/.test(panel) || /byRevenue/.test(panel));
  ok("a follow-up date is compared against Malaysian today", /Date\.now\(\) \+ 8 \* 3600 \* 1000/.test(panel) && /h\.next_at <= today/.test(panel));

  ok("the follow-up watcher exists and points at Hotels", /key: "hotel_followup"[\s\S]{0,400}?tab: "Hotels"/.test(watchers));
  ok("every mutation in the module is audited", ["hotel.call", "hotel.link", "hotel.client", "hotel.stage"].every((a) => src.includes(`"${a}"`)));
  const gate = src.indexOf("if (!manage) return err(\"forbidden\"");
  ok("the read is open to hotels_view, the writes behind hotels_manage", gate > 0 && src.indexOf('leaf === "pipeline" && method === "GET"') < gate && src.indexOf('leaf === "calls" && method === "POST"') > gate);
  ok("0116 is registered and probed", index.includes('"0116_hotel_pipeline",') && /\["0116 \(the hotel pipeline\)"/.test(index));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — the phone book is a pipeline: stages move by what happened, due means a lapse, a call is kept without signal (${passed} checks)`);

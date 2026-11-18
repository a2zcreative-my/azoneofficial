/* v1.368.0 - LIVE REPORTS, THE RULES THAT MUST NOT DRIFT (the CEO's directive
   "A2Z OS - Live Reports Audit Revision 18 Nov 2026" and picture; decisions
   C1 inside Roster & Scheduling, C2 AI use shown in System health, C3 one
   review by the CEO, COO or CCO who did not take part). Read from the source
   on every release; the behaviour is proven end to end against a local
   worker by tests/browser/live-e2e.mjs.

     node tests/live-reports-v2.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const F = {
  srv: "worker/src/live-reports.ts", perms: "worker/src/permissions.ts", toml: "worker/wrangler.toml",
  ui: "components/portal/live-reports.tsx", roster: "components/portal/roster-scheduling.tsx", health: "components/portal/security-status.tsx",
  mig: "worker/migrations/0210_live_participants.sql", tabs: "lib/portal-tabs.ts",
};

function checks(src) {
  const out = [];
  const ok = (name, cond) => out.push([Boolean(cond), name]);
  const s = src.srv;
  const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  /* one report per live, shared by everyone who took part */
  ok("one report per live (a second start returns the same report)", /ON CONFLICT\(session_id\) DO NOTHING/.test(s));
  ok("anyone who took part may start it - host or a participant row", /const tookPart = \(n: number, s = "s"\) => `\(\$\{s\}\.host_user_id = \?\$\{n\} OR EXISTS \(SELECT 1 FROM live_participants/.test(s));
  ok("an unplanned live is refused when the same live is already recorded", /existing: true/.test(s) && /unplanned/.test(s));
  /* project required; client and company from it */
  ok("submit needs a project", /project_required/.test(s));
  ok("the company comes from the project's quotation, never typed when a project is set", /issuer_code === "a2z" \? "a2z" : "azoo"/.test(s));
  /* review */
  ok("a reviewer who took part cannot review (self_approval)", /self_approval/.test(s));
  ok("review is the CEO, COO or CCO", /live_report_review/.test(s));
  /* AI: Workers AI only, capped, never needed */
  ok("the AI is the Workers AI binding only", /\[ai\]\nbinding = "AI"/.test(src.toml) && /ai!?\.run\(AI_MODEL/.test(code) && !/openai|anthropic|api\.google|generativelanguage|fetch\(/i.test(code));
  ok("the daily cap and the Neuron ceiling are reserved BEFORE the call, in one conditional write", /UPDATE ai_budget SET calls = calls \+ 1, neurons = neurons \+ \?\d WHERE day = \?\d AND calls < \?\d AND neurons \+ \?\d <= \?\d/.test(s));
  ok("the ceiling never exceeds the free allowance", /NEURON_CEILING_MAX = 8_000;/.test(s) && /FREE_NEURONS_A_DAY = 10_000;/.test(s) && /Math\.min\(s\.ceiling, NEURON_CEILING_MAX\)/.test(s));
  ok("the AI reading is kept apart from the confirmed figures (append-only)", /live_report_ai_readings/.test(s) && /BEFORE UPDATE ON live_report_ai_readings/.test(src.mig) && /BEFORE DELETE ON live_report_ai_readings/.test(src.mig));
  ok("submission never waits for the AI", !/submit[\s\S]{0,400}readScreenshot/.test(s));
  ok("only the CEO sets the AI", /live_ai_settings: \["ceo"\]/.test(src.perms));
  ok("the fake reading only works on a local test origin", /function testFake[\s\S]{0,300}127\\\.0\\\.0\\\.1[\s\S]{0,200}return local && v/.test(s));
  /* analysis: rules only */
  ok("the analysis has the three flags and no AI", /viewers_high_orders_low/.test(s) && /conversion_below_project/.test(s) && /gmv_down_three/.test(s) && !/function analysisOf[\s\S]{0,1200}env\.AI/.test(s));
  /* no new module */
  ok("no new tab or sidebar item", !/"Live Reports"/.test(src.tabs));
  ok("it lives in Roster & Scheduling's Live Reports view", /<div id="live-host-card"><LiveReports \/><\/div>/.test(src.roster));
  ok("the AI use is shown in the existing System health", /\/staff\/live-reports\/ai/.test(src.health) && /infra-live-ai/.test(src.health));
  ok("GMV is said to be the staff's own figure, not sales, cash, invoice or commission", /never verified sales, cash, an invoice or commission/.test(src.ui));
  ok("manual entry is always offered", /manual entry \(always allowed\)/.test(src.ui));
  ok("figures strip is the one KPI strip", /<KpiRow cols=\{6\}/.test(src.ui) && !/erp-stat|tileCard/.test(src.ui));
  /* v1.370.0 - nothing starts until the person has seen which live it is (the CEO, 18-11-2026) */
  ok("Report and I took part open the 'Check this is the right live' card first, never the report", /setConfirm\(\{ live: s, join: false \}\)/.test(src.ui) && /setConfirm\(\{ live: s, join: true \}\)/.test(src.ui) && !/onClick=\{\(\) => void (start|join)\(s\.id\)\}/.test(src.ui));
  ok("the lists send each live's project and document for its tags", /s\.unplanned, s\.project_id, pj\.title AS project_title, \$\{DOC_COLS\("pj"\)\}/.test(s));
  /* v1.370.0 - the image is a base64 data URL (Cloudflare's own Llama 3.2 Vision tutorial); the array of numbers was refused */
  ok("the screenshot goes to Workers AI as a base64 data URL, never an array of numbers", /data:\$\{type \|\| "image\/png"\};base64,/.test(s) && /image, max_tokens: 300/.test(s) && !/Array\.from\(bytes\)/.test(s));
  ok("a failed read is written to System health's error log", /logError\(env, "live_ai"/.test(s));
  /* v1.369.0 - the platform and document tags (the CEO, 18-11-2026) */
  ok("every live shows its platform as a tag", /function PlatformTag/.test(src.ui) && (src.ui.match(/<PlatformTag /g) ?? []).length >= 6);
  ok("every live shows its project's document: the live invoice, else the quotation, else 'no project yet'", /function DocTag/.test(src.ui) && (src.ui.match(/<DocTag /g) ?? []).length >= 6 && /No project yet/.test(src.ui));
  ok("the invoice tag never names a voided invoice", /i\.doc_type = 'INV' AND i\.converted_from = \$\{pj\}\.quotation_id AND COALESCE\(i\.payment_status, ''\) != 'void'/.test(s));
  ok("an unplanned live shows its tags before it is recorded", /data-testid="live-u-check"/.test(src.ui));
  return out;
}

const SRC = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, read(p)]));
const base = checks(SRC);
let failed = 0;
for (const [pass, name] of base) if (!pass) { failed++; console.log(`  ✗ ${name}`); }

const MUT = [
  ["perms", "the COO may switch the AI on", 'live_ai_settings: ["ceo"]', 'live_ai_settings: ["ceo", "coo"]'],
  ["srv", "a ceiling above the free allowance", "NEURON_CEILING_MAX = 8_000;", "NEURON_CEILING_MAX = 20_000;"],
  ["roster", "the old card back", "<div id=\"live-host-card\"><LiveReports /></div>", "<div id=\"live-host-card\"><LiveHostCard /></div>"],
  ["tabs", "a new Live Reports tab", '"Roster & Scheduling",', '"Roster & Scheduling",\n  "Live Reports",'],
  ["srv", "a voided invoice tagged", "AND COALESCE(i.payment_status, '') != 'void' ORDER BY i.id DESC LIMIT 1) AS inv_number", "ORDER BY i.id DESC LIMIT 1) AS inv_number"],
  ["srv", "the image sent as numbers again", "ai!.run(AI_MODEL, { messages: [{ role: \"user\", content: PROMPT }], image, max_tokens: 300", "ai!.run(AI_MODEL, { messages: [{ role: \"user\", content: PROMPT }], image: Array.from(bytes), max_tokens: 300"],
  ["ui", "the GMV disclaimer dropped", "never verified sales, cash, an invoice or commission", "verified sales"],
];
let caught = 0;
if (!process.env.NOMUT) {
  for (const [k, name, from, to] of MUT) {
    if (!SRC[k].includes(from)) { failed++; console.log(`  ✗ mutation did not apply: ${name}`); continue; }
    const res = checks({ ...SRC, [k]: SRC[k].replace(from, to) });
    if (res.some(([p]) => !p)) caught++; else { failed++; console.log(`  ✗ mutation not caught: ${name}`); }
  }
}
if (failed) { console.log(`live-reports-v2: ${failed} failed`); process.exit(1); }
console.log(`PASS - live reports: one report per live shared by its participants; project required; a participant never reviews; Workers AI only, capped under the free allowance, never needed; rule-based analysis; inside Roster & Scheduling (${base.length} checks${process.env.NOMUT ? "" : `, ${caught} mutations caught`})`);

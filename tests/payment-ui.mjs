/* v1.282.0 - SALES PAYMENT VERIFICATION 3.0, the screen (the CEO, 11-11-2026:
   "Proceed" on claude/PAYMENT-VERIFICATION-3.0-BLUEPRINT.md, P1-P9 as
   recommended). What the server decides is proven by direct request in
   tests/payment-verify.mjs; the browser half is tests/browser/payments-3.py.
   Here, in the source and by running the shared rules:

     - one main action per invoice (actionFor): Report payment, Report
       remaining payment, View pending payment, Review payment - a fully
       pending invoice never offers a second report as its main button (D1),
       and the Sales list and Overview use the same rule;
     - two separate words: the invoice's settlement and the report's review;
       the CEO's own report reads "Awaiting independent evidence review" (D2/D3);
     - the review sheet has NO Verify button on the reporter's own report
       until another person checked the bank - it says what it waits for;
     - verified outstanding never takes pending off;
     - "receipt only" is not offered (B4); the switch left the daily page for
       the owner's Settings sheet, which warns about waiting reports (P2);
     - the report sheet is three steps; the Audit Trail reads the new
       read-only route.

     node tests/payment-ui.mjs */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? `  [${String(detail).slice(0, 300)}]` : ""}`); } };

const partsSrc = read("components/portal/payment-parts.tsx");
const panel = strip(read("components/portal/payments-panel.tsx"));
const sales = strip(read("components/portal/sales.tsx"));
const sw = strip(read("components/portal/sales-workspace.tsx"));
const chips = read("components/ui/status-chip.tsx");

/* ---- the shared rules, run ---- */
const a = partsSrc.indexOf("export const PENDING_STATES"), b = partsSrc.indexOf("/** The four figures.");
ok("the shared rules are where the guard expects them", a > 0 && b > a);
const js = ts.transpileModule(partsSrc.slice(a, b), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const mod = {};
new Function("exports", "L", "statusOf", "css", "AppIcon", "React", "chipSmSuccess", "chipSmWarn", "chipSmDanger", "chipSmInfo", "chipSmNeutral", js)(
  mod, (en) => en, () => ({ tone: "neutral", label: "" }), {}, () => null, { createElement: () => null }, "", "", "", "", "");
const { actionFor, reviewOf, settlementOf } = mod;
const inv = (total, verified, pending, can = true) => ({ total_cents: total, verified_cents: verified, pending_cents: pending, can_report: can });
ok("D1: the whole outstanding already reported -> View pending payment, never a second report", actionFor(inv(3750, 0, 3750)).kind === "view_pending");
ok("D1: ...and for the person who decides it -> Review payment", actionFor(inv(3750, 0, 3750), true).kind === "review");
ok("nothing paid, nothing pending -> Report payment", actionFor(inv(15000, 0, 0)).kind === "report");
ok("a verified part and a balance left -> Report remaining payment", actionFor(inv(120000, 60000, 0)).kind === "report_remaining");
ok("part of the balance pending -> Report remaining payment", actionFor(inv(120000, 0, 30000)).kind === "report_remaining");
ok("a verified part and the rest pending -> View pending payment", actionFor(inv(120000, 60000, 60000)).kind === "view_pending");
ok("fully verified -> no action", actionFor(inv(10000, 10000, 0)).kind === "none");
ok("someone who cannot report sees no report button", actionFor(inv(15000, 0, 0, false)).kind === "none" && actionFor(inv(15000, 0, 5000, false)).kind === "view_pending");
ok("D2: the CEO's own report waits for the independent evidence review", reviewOf({ state: "reported", needs_evidence: true }) === "awaiting_independent");
ok("anyone else's report, or one whose evidence was checked, waits for the CEO", reviewOf({ state: "reported", needs_evidence: false }) === "pending_ceo" && reviewOf({ state: "evidence_checked", needs_evidence: true }) === "pending_ceo");
ok("clarify, verified, rejected, reversed keep their own words", ["clarify", "verified", "rejected", "reversed"].every((s) => reviewOf({ state: s }) === s));
ok("D3: settlement counts verified money only", settlementOf(3750, 0) === "unpaid" && settlementOf(120000, 60000) === "partial" && settlementOf(120000, 120000) === "paid" && settlementOf(100, 0, false, true) === "void");

/* ---- the words ---- */
ok("two status domains, used everywhere: settlement and review", /settlement: \{\s*unpaid:/.test(chips) && /review: \{\s*awaiting_independent: \["warning", "Awaiting independent evidence review"/.test(chips) && /pending_ceo: \["warning", "Pending CEO verification"/.test(chips));
ok("the panel no longer prints the mixed status words", !/Fully reported - awaiting CEO|Reported - awaiting CEO|STATUS_WORDS/.test(panel));

/* ---- the review sheet ---- */
ok("the foot's Verify only where the 1.272 rule allows; otherwise it says what it waits for", /\{mayVerify\(lead\)\s*\? <button type="button" className=\{css\.btnVerify\}/.test(panel) && /: <p className=\{css\.lock\} data-testid="verify-locked">/.test(panel) && /L\("Verify after the COO's check"/.test(panel));
ok("the sheet names the independent evidence review on the reporter's own report", /rv === "awaiting_independent" && \(\s*<div className=\{css\.evid\} data-testid="evidence-waiting">/.test(panel));
ok("the sheet's amounts are the shared summary (verified outstanding, pending beside it)", /<AmountSummary total=\{pic\.invoice\.total_cents\} verified=\{pic\.verified_cents\} pending=\{pic\.pending_cents\}/.test(panel) && /const outstanding = paid \? 0 : Math\.max\(0, total - verified\);/.test(partsSrc));
ok("the receipt is read through its own authorized proof URL", /\/api\/v1\/staff\/payment-reports\/\$\{reportId\}\/proof/.test(partsSrc) && /credentials: "same-origin", cache: "no-store"/.test(partsSrc) && /<ReceiptPreview reportId=\{r\.id\} \/>/.test(panel));
ok("B4: 'receipt only' is not offered for a new verification", !/<option value="receipt_only">/.test(panel));
ok("a second report on a fully pending invoice sits behind its own warning and tick", /data-testid="report-additional"/.test(panel) && /data-testid="additional-warning"/.test(panel) && /\(!extra \|\| sure\)/.test(panel));

/* ---- the page ---- */
ok("P2: the switch is the owner's Settings sheet, with the waiting count, not a banner button", /\{data\.can\.switch && <button type="button" className=\{btnSm\} onClick=\{\(\) => setPolicy\(true\)\}>/.test(panel) && /function PolicySheet\(/.test(panel) && /pending > 0 \?/.test(panel) && !/function SwitchCard/.test(panel));
ok("the four tabs, one dataset each", ["needs", "balances", "history", "audit"].every((k) => panel.includes(`["${k}", `)) && /\{tab === "needs" && \(/.test(panel) && /\{tab === "balances" && \(/.test(panel) && /\{tab === "history" && \(/.test(panel) && /\{tab === "audit" && <AuditTrail /.test(panel));
ok("the Audit Trail reads the read-only route", /api<\{ events: Ev\[\] \}>\("\/staff\/payments\/events\?limit=100"\)/.test(panel));
ok("the tiles: verified outstanding says pending is not deducted; the pending tile counts the independent reviews", /pending not deducted/.test(panel) && /awaiting independent review/.test(panel));
ok("the report sheet is three steps: Details, Proof, Review", /\[1, L\("Details", "Butiran"\)\], \[2, L\("Proof", "Bukti"\)\], \[3, L\("Review", "Semak"\)\]/.test(panel) && /data-testid="report-review"/.test(panel));
ok("success is said only after the server answered", /if \(!r\.ok \|\| !r\.data\?\.id\) \{ setBusy\(false\); onFail\(/.test(panel) && /if \(!r\.ok\) \{ onFail\(msg\(r, L\("Not saved - try again"/.test(panel));

/* ---- one rule across Sales ---- */
ok("the documents list uses actionFor (View pending payment opens the invoice's sheet)", /<InvoicePayAction className=\{rowBtn\} inv=\{\{ total_cents: d\.total_cents, verified_cents: verified, pending_cents: pending, can_report: v\.can_report \}\}/.test(sales) && /onReport=\{\(\) => \{ setRecordInv\(d\.id\); setWsView\("payments"\); \}\} onView=\{\(\) => \{ setViewInv\(d\.id\); setWsView\("payments"\); \}\}/.test(sales) && /const a = actionFor\(inv\);/.test(partsSrc) && /onClick=\{report \? onReport : onView\}/.test(partsSrc));
ok("the Overview's Needs action uses the same rule", /const a = v && pv\?\.on && p\.canPay \? actionFor\(/.test(sw) && /a\.kind === "view_pending" && p\.onView/.test(sw));
ok("'Record payment' is gone from Sales: the word is Report payment", !/L\("Record payment"/.test(sales + sw + panel));
ok("on Payments the header's gold action is Report payment", /wsView === "payments" && pv\?\.on && Object\.values\(pv\.inv\)\.some\(\(v\) => v\.can_report\) \?/.test(sales) && /reportTick=\{payReport\}/.test(sales));
ok("the guard is registered", /\["payment-ui", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }

#!/usr/bin/env node
/* Guard - v1.207.0: ONE PAYROLL CALCULATION. ONE AUTHORITATIVE PAYROLL
 * RECORD. MULTIPLE CONNECTED VIEWS.
 *
 * The owner's Payroll brief, 25-10-2026, and the audit before it. The owner
 * chose "not now, add a guard" for the engine and "warn only" for the old
 * fallbacks, so this guard holds the formulas where they are:
 *
 *   1. THE NET IS ONE FORMULA IN TWO PLACES. The browser's netFor (what Save
 *      stores, payroll-panel.tsx) and the server's Recompute nets
 *      (worker/src/staff.ts) must add and subtract the same terms - for
 *      salaried rows and for part-timers (the save route and the recompute
 *      route too). The month totals are netFor summed, not a third copy.
 *   2. OT IS PRICED ONCE (otPay: basic ÷ 26 ÷ 8 × 1.5 × hours), and the rates
 *      card says so.
 *   3. THE BANK FILES READ THE SAVED NET FIRST, and the screen warns, before
 *      either file is downloaded, about a saved row with no saved net (which
 *      the files would price with their older fallback) and a row not saved.
 *   4. THE NEW VIEWS ONLY READ: the history reads GET /payroll, month by
 *      month, never cached on the device; the drawer adds no line the system
 *      does not compute - the statutory line says it is not calculated.
 *   5. WHO MAY READ PAY is still the processors (PAYROLL_PROC) on the server.
 *
 * Negative-tested by: dropping "- advance" from netFor (1); a second inline
 * net in the totals (1); 1.5 changed to 2 in otPay (2); removing the export
 * warning (3); a POST from payroll-history.tsx (4).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const panel = read("components/portal/payroll-panel.tsx");
const code = strip(panel);
const staff = read("worker/src/staff.ts");

/* the signed terms of `Math.max(0, a + b - c ...)`, each named by what it is */
const NAME = [
  [/^(?:e\.basic_cents|basicR|basicH|hourly)$/, "BASIC"],
  [/^(?:phW|phH)$/, "PH"],
  /* v1.224.0 - the hourly save adds the SERVER's commission (commP: the
     ledger's sum with the owner's switch on, else the stored figure), never
     the screen's - commission-ledger.mjs holds that rule */
  [/^(?:e\.commission_cents|cents\(body\.commission_cents\)|commP)$/, "COMMISSION"],
  [/^(?:e\.allowance_cents|cents\(body\.allowance_cents\))$/, "ALLOWANCE"],
  [/^(?:ot|e\.ot_cents)$/, "OT"],
  [/^(?:e\.deduction_cents|cents\(body\.deduction_cents\))$/, "MANUAL"],
  [/^ulDed$/, "UNPAID"],
  [/^adj$/, "INCOMPLETE"],
  [/^(?:advance|advanceP|advanceAtR\(e\.user_id\))$/, "ADVANCE"],
];
const terms = (expr) => {
  if (!expr) return "(none)";
  const body = expr.replace(/^Math\.max\(0,\s*/, "").replace(/\);?$/, "");
  return [...body.matchAll(/([+-]?)\s*([A-Za-z_.()]+(?:\([^)]*\))?)/g)].map(([, sign, t]) => {
    const n = NAME.find(([re]) => re.test(t.trim()));
    return `${sign === "-" ? "-" : "+"}${n ? n[1] : `?${t.trim()}`}`;
  }).sort().join(" ");
};
const grab = (src, re) => (src.match(re) ?? [])[1] ?? "";

/* ---- 1. one net formula ---- */
{
  const netFor = code.slice(code.indexOf("const netFor = (id: number, override?: Entry): number => {"), code.indexOf("};", code.indexOf("const netFor = (id: number")));
  const clientSalaried = grab(netFor, /return (Math\.max\(0, e\.basic_cents[^;]+);/);
  const clientHourly = grab(netFor, /return (Math\.max\(0, hourly[^;]+);/);
  const serverRecompute = grab(staff, /const net = (Math\.max\(0, e\.basic_cents \+ phW[^;]+);/);
  const serverRecomputeH = grab(staff, /const netHR = (Math\.max\(0, basicR[^;]+);/);
  const serverSaveH = grab(staff, /const netH = (Math\.max\(0, basicH[^;]+);/);
  const SAL = "+ALLOWANCE +BASIC +COMMISSION +OT +PH -ADVANCE -INCOMPLETE -MANUAL -UNPAID";
  const HOUR = "+ALLOWANCE +BASIC +COMMISSION +PH -ADVANCE -MANUAL";
  ok("salaried: the browser's net (what Save stores) has every term", terms(clientSalaried) === SAL, terms(clientSalaried));
  ok("salaried: Recompute nets on the server adds the same terms", terms(serverRecompute) === terms(clientSalaried), `${terms(serverRecompute)} vs ${terms(clientSalaried)}`);
  ok("part-timers: the browser, the save route and Recompute agree", terms(clientHourly) === HOUR && terms(serverSaveH) === HOUR && terms(serverRecomputeH) === HOUR, `${terms(clientHourly)} | ${terms(serverSaveH)} | ${terms(serverRecomputeH)}`);
  ok("the incomplete month is the one shared function on both sides", /incompleteCents\(/.test(code) && /import \{[^}]*incompleteCents[^}]*\} from "@\/lib\/payroll-days"/.test(panel) && /incompleteCents\(e\.basic_cents/.test(staff));
  const totals = code.slice(code.indexOf("const tot = staff.reduce("), code.indexOf("const dedBy = staff.reduce("));
  ok("the month totals are netFor summed, not a third copy", (totals.match(/a\.net \+= netFor\(u\.id\)/g) ?? []).length === 2 && !/Math\.max\(0,/.test(totals));
  ok("no other net is composed in the panel", (code.match(/Math\.max\(0, (?:e\.basic_cents|hourly|hp) \+/g) ?? []).length === 2, String((code.match(/Math\.max\(0, (?:e\.basic_cents|hourly|hp) \+/g) ?? []).length));
}

/* ---- 2. OT priced once ---- */
{
  ok("otPay is written once", (code.match(/function otPay\(/g) ?? []).length === 1 && /return Math\.round\(\(basicCents \/ 26 \/ 8\) \* 1\.5 \* hours\);/.test(code));
  ok("the rates card says the same rate", /1\.5 × hourly ORP, where hourly ORP = basic ÷ 26 ÷ 8/.test(panel));
  ok("the server does not price OT a second way", !/\/ 26 \/ 8\) \* 1\.5/.test(staff));
}

/* ---- 3. the bank files and the warning ---- */
{
  ok("M2E and the CSV price a row by its saved net first", (staff.match(/const net = r\.net_cents \?\? Math\.max\(0,/g) ?? []).length === 2);
  ok("the screen knows which saved rows have no saved net", /setNoNetIds\(\(p\.data\?\.entries \?\? \[\]\)\.filter\(\(x\) => typeof \(x as Entry & \{ net_cents\?: number \| null \}\)\.net_cents !== "number"\)/.test(code));
  ok("…and warns beside the files and in the download question", /noNetRows\.length \+ notSavedRows\.length > 0 &&/.test(code) && /noNetRows\.length > 0 \? `\\n\$\{noNetRows\.length\} saved row/.test(panel));
  ok("both files still ask first", /if \(await confirmPaymentFile\("m2e"\)\)/.test(code) && /if \(!\(await confirmPaymentFile\("csv"\)\)\) return;/.test(code));
}

/* ---- 4. the new views only read ---- */
{
  const hist = strip(read("components/portal/payroll-history.tsx"));
  ok("the history reads GET /payroll, nothing else", /api<[^>]*>\(`\/payroll\?month=\$\{m\}`\)/.test(hist) && !/method:|csrfFetch|useCachedApi|localStorage/.test(hist));
  const drawer = code.slice(code.indexOf("const past = history.rows"), code.indexOf("</SideDrawer>"));
  ok("the drawer's lines are figs(): no new figure", /const f = figs\(detailUser\);/.test(code) && !/\bapi\(|postPay\(|csrfFetch/.test(drawer));
  ok("no statutory amount is computed anywhere on the page", !/(?:epf|socso|eis|pcb|kwsp)[a-z_]*_cents/i.test(code));
  ok("…and the drawer says the statutory line is not calculated", /Not calculated — registration pending/.test(panel));
  ok("the history and the warning are read only by those who already read payroll", /if \(!can\(user\.role, "payroll_process"\)\) \{\s*return err\("forbidden", "Payroll access required", 403\);/ /* v1.237.0 - PAYROLL_PROC is PERMS.payroll_process */.test(staff));
}

ok("no sample figure from the mockup", !/128,?450|Mohd Alif Farhan|14,250|AZZ001|Process Payroll/.test(panel + read("components/portal/payroll-history.tsx")));
ok("the guard is registered", /\["payroll-module", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }

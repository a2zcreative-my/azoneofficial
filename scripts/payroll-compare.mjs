#!/usr/bin/env node
/* scripts/payroll-compare.mjs - v1.243.0 (Release C, plan section 5).
 *
 * Compares two saved answers of GET /api/v1/staff/payroll?month=YYYY-MM -
 * one taken on the old release, one on the new - and prints every person
 * whose money changed, who joined or left the run, and the totals.
 *
 * It is OFFLINE and READ-ONLY: it reads two JSON files and writes nothing.
 * It never calls an API, so it cannot touch production or staging data.
 * Save each answer from the browser (Payroll tab open -> DevTools ->
 * Network -> the "payroll?month=" request -> Response -> save as JSON).
 *
 *   node scripts/payroll-compare.mjs before.json after.json
 *
 * Exit 0 when no saved money figure changed for anybody; 1 otherwise (a
 * change is not necessarily wrong - Release C pays an overnight session in
 * the clock-in month - but each one must be explained before payout).
 */
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: node scripts/payroll-compare.mjs before.json after.json");
  process.exit(2);
}
const load = (p) => {
  const j = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(j.entries)) throw new Error(`${p}: not a GET /payroll answer (no entries)`);
  return j;
};
const before = load(a);
const after = load(b);
if (before.month !== after.month) {
  console.error(`[!] different months: ${before.month} vs ${after.month}`);
  process.exit(2);
}
const rm = (c) => (c == null ? "-" : `RM ${(Number(c) / 100).toFixed(2)}`);
const byUser = (j) => new Map(j.entries.map((e) => [Number(e.user_id), e]));
const B = byUser(before);
const A = byUser(after);
const ids = [...new Set([...B.keys(), ...A.keys()])].sort((x, y) => x - y);
const moneyKeys = (e) => Object.keys(e ?? {}).filter((k) => k.endsWith("_cents") && typeof e[k] === "number");

let changed = 0;
console.log(`Payroll ${before.month}: ${B.size} rows before, ${A.size} after\n`);
for (const id of ids) {
  const x = B.get(id);
  const y = A.get(id);
  const name = (y ?? x)?.name ?? (y ?? x)?.full_name ?? `user ${id}`;
  if (!x) { console.log(`+ ${name} (#${id}) appears: net ${rm(y.net_cents)}`); changed++; continue; }
  if (!y) { console.log(`- ${name} (#${id}) is gone: net was ${rm(x.net_cents)}`); changed++; continue; }
  const diffs = [...new Set([...moneyKeys(x), ...moneyKeys(y)])]
    .filter((k) => (x[k] ?? null) !== (y[k] ?? null))
    .map((k) => `${k} ${rm(x[k])} -> ${rm(y[k])}`);
  if (diffs.length) { console.log(`~ ${name} (#${id}): ${diffs.join("; ")}`); changed++; }
  if (y.in_run === false) console.log(`  note: ${name} (#${id}) is listed but not in the run (${y.exception ?? "no reason given"})`);
  else if (y.exception) console.log(`  exception: ${name} (#${id}) ${y.exception}`);
}
const sum = (j) => j.entries.reduce((s, e) => s + (Number(e.net_cents) || 0), 0);
console.log(`\nNet of all rows: before ${rm(sum(before))}, after ${rm(sum(after))}`);
if (after.population) {
  const p = after.population;
  console.log(`After - in the run ${p.in_run}, bank file ${p.file_payees} payees ${rm(p.file_total_cents)}, manual ${rm(p.manual_total_cents)}, total ${rm(p.total_cents)}, blocking exceptions ${p.blocking ?? 0}`);
}
console.log(changed ? `\n[!] ${changed} person(s) differ - explain each before payout.` : "\n[OK] no money figure changed.");
process.exit(changed ? 1 : 0);

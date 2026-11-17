/* v1.339.0 - PAYROLL HISTORY SAYS WHAT STAFF CAN OPEN, AND THE CEO CAN RELEASE FROM IT.

   The CEO (17-11-2026), looking at Payroll > Reports & Export > Payroll
   History: July and October 2026 read "Not released" while their automatic
   moment (the 5th of the next month, payslipAvailableFromFor) had long
   passed - staff were already reading those payslips. History read only the
   manual release ROW. It now reads the server's own answer
   (population.payslips_out = payslipsOutFor), and a month that is not out
   yet carries a Release button that runs the SAME flow as the Payslips box
   (one function, releaseMonth) - the server still decides who may.

   Usage: node tests/payroll-history-release.mjs   (NOMUT=1 skips mutations) */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");

function run(src) {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); };
  const hist = src["components/portal/payroll-history.tsx"];
  const pan = src["components/portal/payroll-panel.tsx"];
  const wk = src["worker/src/staff.ts"];

  ok("H1 History reads the server's payslips_out (the automatic moment counts), not only the release row",
    /out: Boolean\(r\.data\?\.release\?\.released\) \|\| r\.data\?\.population\?\.payslips_out === true/.test(hist)
    && /availableFrom: r\.data\?\.release\?\.available_from \?\? ""/.test(hist));
  ok("H2 a month out by the automatic date reads as released, never \"Not released\"; a month with nothing saved reads Nothing saved, never released",
    /: h\.out \? <span className=\{chipSuccess\}[^>]*>\{L\("Released · automatic"/.test(pan)
    && pan.indexOf(": h.out ?") < pan.indexOf('L("Not released"')
    && /: h\.saved === 0 && !h\.released \? <span className=\{chipNeutral\}[^>]*>\{L\("Nothing saved"/.test(pan) && pan.indexOf("h.saved === 0 && !h.released") < pan.indexOf(": h.out ?"));
  ok("H3 the History Release button: release holders only, only for a saved month that is not out, through releaseMonth",
    /!readOnly && release\?\.can_release !== false && !h\.failed && !h\.out && h\.saved > 0 && h\.availableFrom\s*&& <button[^>]*data-testid=\{`hist-release-\$\{h\.month\}`\} onClick=\{\(\) => void releaseMonth\(h\.month, h\.availableFrom\)\}/.test(pan));
  ok("H4 one release flow: the Payslips box calls the same function, and the panel posts a release in exactly one place",
    /onClick=\{\(\) => void releaseMonth\(month, release\.available_from\)\}/.test(pan)
    && (pan.match(/api\(`\/payroll\/release`, \{ method: "POST", body: JSON\.stringify\(\{ month: m \}\) \}\)/g) ?? []).length === 1
    && !/JSON\.stringify\(\{ month \}\) \}\);\s*setMsg\(res\.ok \? L\("Payslips released/.test(pan));
  ok("H5 the early-release warnings are kept in the shared flow",
    /const releaseMonth = async \(m: string, availableFrom: string\) => \{[\s\S]*?if \(availableFrom > nowMYT\)[\s\S]*?L\("Early release — check the month"[\s\S]*?setHistNonce\(\(n\) => n \+ 1\)/.test(pan));
  ok("H6 History re-reads after a release (nonce in the key)",
    /const key = enabled \? `\$\{month\}\|\$\{count\}\|\$\{nonce\}` : "";/.test(hist) && /usePayrollHistory\(month, histWanted, 12, histNonce\)/.test(pan));
  ok("H7 the server still decides: release needs payroll_release, and the month list answers payslips_out",
    /if \(!can\(user\.role, "payroll_release"\)\) return err\("forbidden", "Only the CEO, COO or super admin releases payslips", 403\);/.test(wk)
    && /paid: paidRowG \?\? null, payslips_out: await payslipsOut\(month\)/.test(wk));
  return fails;
}

const FILES = ["components/portal/payroll-history.tsx", "components/portal/payroll-panel.tsx", "worker/src/staff.ts"];
const src = Object.fromEntries(FILES.map((f) => [f, read(f)]));
const fails = run(src);
for (const f of fails) console.log(`  ✗ ${f}`);

let caught = 0;
const MUT = [
  ["History reads only the release row", "components/portal/payroll-history.tsx", "|| r.data?.population?.payslips_out === true", ""],
  ["the automatic month shown as Not released", "components/portal/payroll-panel.tsx", ": h.out ? <span", ": false ? <span"],
  ["anybody may press Release in History", "components/portal/payroll-panel.tsx", "!readOnly && release?.can_release !== false && !h.failed", "!h.failed"],
  ["Release offered on a month already out", "components/portal/payroll-panel.tsx", "!h.failed && !h.out && h.saved > 0", "!h.failed && h.saved > 0"],
  ["an empty month called released", "components/portal/payroll-panel.tsx", ": h.saved === 0 && !h.released ?", ": false ?"],
  ["History never re-reads", "components/portal/payroll-panel.tsx", "usePayrollHistory(month, histWanted, 12, histNonce)", "usePayrollHistory(month, histWanted)"],
  ["the server release gate removed", "worker/src/staff.ts", 'if (!can(user.role, "payroll_release")) return err("forbidden", "Only the CEO, COO or super admin releases payslips", 403);', ""],
];
if (!process.env.NOMUT) {
  for (const [name, f, a, b] of MUT) {
    if (!src[f].includes(a)) { console.log(`  ✗ mutation anchor missing: ${name}`); fails.push(name); continue; }
    const m = { ...src, [f]: src[f].replace(a, b) };
    if (run(m).length > 0) caught++; else { console.log(`  ✗ mutation not caught: ${name}`); fails.push(name); }
  }
}
if (fails.length) { console.log(`payroll-history-release: ${fails.length} failed`); process.exit(1); }
console.log(`payroll-history-release: 7 checks passed (${caught} mutations caught)`);

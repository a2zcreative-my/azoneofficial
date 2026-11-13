/**
 * v1.298.0 - FINANCIAL ADVISORY 2.0, PHASE 1 (the CEO, 13-11-2026: "approve as
 * per recommendation, fees switched without waiting for lawyer";
 * claude/FINANCIAL-ADVISORY-2.0-BLUEPRINT.md, D-0 ... D-8 as recommended).
 * Source rules; the server behaviour is held by tests/fa-api.mjs,
 * tests/fa-dsr.mjs and tests/fa-engine.mjs, the screens by tests/browser/fa2.py.
 *
 * What must stay true:
 *   A  the six views are in the address; a phone gets the Dashboard's view
 *      switch, never a cut-off tab row
 *   B  the Overview is the directive's: four figures, ONE list to act on
 *   C  a DSR result never says "Proceed"; no fixed DSR limit anywhere; a flat
 *      or reducing illustrative rate, always an assumption; no verified rule
 *      means Unknown, never a yes
 *   D  the next follow-up is the case's own Task (no second follow-up engine)
 *   E  the fee is on by the CEO's decision but bills nothing from the case: no
 *      rate in code, nothing from an estimate; the agreement and commission
 *      stay off; no CTOS, blacklisting or penalty
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const FILES = {
  panel: "components/portal/financial-advisory.tsx", dsr: "components/portal/fa-dsr.tsx", kase: "components/portal/fa-case.tsx",
  css: "components/portal/financial-advisory.module.css", portal: "app/portal/page.tsx", fa: "worker/src/fa.ts", engine: "worker/src/fa-engine.ts",
};

function checks(f) {
  const out = [];
  const ok = (name, c, d = "") => out.push([name, Boolean(c), d]);
  const p = strip(f.panel), d = strip(f.dsr), w = strip(f.fa), e = strip(f.engine), k = strip(f.kase);

  ok("A the view is in the address", /useTabViewAddress\("Financial Advisory", view, setView, allowed\);/.test(p) && /<FinancialAdvisoryPanel startView=\{startOf\("Financial Advisory"\)\} \/>/.test(f.portal));
  ok("A the guard is stable", /const allowed = useCallback\(/.test(p));
  ok("A a phone switches views with the Dashboard's view switch", /<div className=\{`erp-desktop-only \$\{css\.head\}`\} data-testid="fa-tabs">\s*<LineTabs /.test(p) && /data-testid="fa-view-bar">\s*<ViewSwitch value=\{view\}/.test(p));
  ok("A the phone's + DSR is a 44 px target", /\.phoneNew \{[^}]*min-height: 2\.75rem/.test(f.css));

  const ov = p.slice(p.indexOf("function Overview("), p.indexOf("function CaseRow("));
  ok("B the directive's four figures, and only four", (ov.match(/<KpiTile /g) ?? []).length === 4 && ["Active cases", "Cases requiring action", "Management reviews", "Banker responses pending"].every((s) => ov.includes(`"${s}"`)));
  ok("B one list to act on: the next step, who, by when", /data-testid="fa-action-list"/.test(ov) && /n\.what/.test(ov) && /n\.who/.test(ov) && /n\.due/.test(ov) && (ov.match(/<ul /g) ?? []).length === 1);
  ok("B the four figures come from the server", /active: await one\(/.test(w) && /requiring_action: await one\(/.test(w) && /reviews: await one\(/.test(w) && /banker_pending: await one\(/.test(w));

  ok("C no result is called Proceed", !/potentially_suitable: \["[^"]*Proceed/.test(d) && /potentially_suitable: \["Potentially Suitable — Subject to Review"/.test(d) && /manual_review: \["Management Review Required"/.test(d));
  ok("C no fixed DSR limit in the engine or the screen", !/\b(6000|60(\.0)?\s*%|≤\s*60)\b/.test(e) && !/≤ 60|60%/.test(d));
  ok("C a flat or reducing rate, the server keeps only those two", /rate_type: f\.rateType/.test(d) && /const rateType = \(v: unknown\): "flat" \| "reducing" => \(v === "flat" \? "flat" : "reducing"\);/.test(w) && /if \(p\.rate_type === "flat"\)/.test(e));
  ok("C the flat instalment is whole sen, rounded up, in BigInt", /BigInt\(P\) \* \(120000n \+ BigInt\(bp\) \* BigInt\(n\)\)/.test(e) && /\(num \+ den - 1n\) \/ den/.test(e));
  ok("C no verified rule = Unknown, never a yes", /result\.matches\.length === 0 && <li[^>]*data-testid="dsr-unknown"/.test(d) && /data-testid="dsr-fit-unknown"/.test(d));

  ok("D the next follow-up is the case's own open Task", /\(SELECT t\.deadline FROM tasks t WHERE t\.link_kind = 'fa_case' AND t\.link_id = c\.id AND t\.status != 'completed'[^)]*\) AS next_follow_up/.test(w) && !/CREATE TABLE[^;]*follow/i.test(f.fa));

  ok("E the fee is on, the agreement and commission off", /export const FA_LEGAL = \{ agreement: false, fee: true, disclosure: true, commission: false \} as const;/.test(f.fa));
  ok("E the fee route bills nothing from a case", /if \(sub === "fee" && method === "POST"\) \{\s*return err\("fee_after_disbursement"/.test(w) && /if \(sub === "agreement" && method === "POST"\) \{\s*return err\("legal_gate"/.test(w));
  ok("E no fee rate written in code", !/0\.15\b|1500\b|15\s*%|fee_bp|fee_percent/.test(w) && !/15%/.test(strip(f.panel).replace(/\(15% (is your proposal|ialah cadangan anda)\)/g, "")));
  ok("E no CTOS reporting, blacklisting or penalty built", !/ctos_report|blacklist\(|penalty_/i.test(w));
  ok("E the case's progress strip opens only the fee step", /const locked = \(k: string\) => LOCKED_STEPS\.has\(k\) && !\(k === "fee" && pic\?\.legal\.fee\);/.test(k));
  return out;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);
const MUT = [
  ["the address forgotten", "panel", 'useTabViewAddress("Financial Advisory", view, setView, allowed);', ""],
  ["the tab row back on the phone", "panel", '<div className={`erp-desktop-only ${css.head}`} data-testid="fa-tabs">', '<div className={css.head} data-testid="fa-tabs">'],
  ["a fifth figure on the Overview", "panel", '      </KpiRow>\n      <section className={`${card} ${css.sec}`} aria-label={L("Needs action"', '        <KpiTile icon="document" tone="green" label="Official" value={0} />\n      </KpiRow>\n      <section className={`${card} ${css.sec}`} aria-label={L("Needs action"'],
  ["Proceed as a result", "dsr", 'potentially_suitable: ["Potentially Suitable — Subject to Review"', 'potentially_suitable: ["Potential Match — Proceed"'],
  ["a 60% limit", "engine", "export const NEAR_BP = 500;", "export const NEAR_BP = 500;\nexport const MAX_DSR_BP = 6000;"],
  ["any rate type accepted", "fa", 'const rateType = (v: unknown): "flat" | "reducing" => (v === "flat" ? "flat" : "reducing");', 'const rateType = (v: unknown) => String(v) as "flat" | "reducing";'],
  ["flat interest in floating point", "engine", "const num = BigInt(P) * (120000n + BigInt(bp) * BigInt(n));", "const num = BigInt(Math.round(P * (1 + (bp / 10000) * (n / 12))));"],
  ["Unknown dropped", "dsr", 'data-testid="dsr-fit-unknown"', 'data-x="y"'],
  ["a second follow-up engine", "fa", "FROM tasks t WHERE t.link_kind = 'fa_case' AND t.link_id = c.id AND t.status != 'completed' AND t.deadline IS NOT NULL ORDER BY t.deadline, t.id LIMIT 1) AS next_follow_up", "FROM fa_followups t WHERE t.case_id = c.id ORDER BY t.due LIMIT 1) AS next_follow_up"],
  ["the agreement switched on", "fa", "export const FA_LEGAL = { agreement: false, fee: true,", "export const FA_LEGAL = { agreement: true, fee: true,"],
  ["commission switched on", "fa", "disclosure: true, commission: false } as const;", "disclosure: true, commission: true } as const;"],
  ["the fee billed from the case", "fa", 'if (sub === "fee" && method === "POST") {\n    return err("fee_after_disbursement"', 'if (sub === "fee" && method === "POST") {\n    const rate = 0.15;\n    return err("fee_after_disbursement"'],
  ["the agreement gate gone", "fa", 'if (sub === "agreement" && method === "POST") {\n    return err("legal_gate"', 'if (sub === "agreement" && method === "POST") {\n    return json({ ok: true }); return err("legal_gate"'],
  ["every locked step opened", "kase", '!(k === "fee" && pic?.legal.fee)', "!pic?.legal.fee"],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\nfa2: ${failed.length} failed`); process.exit(1); }
console.log(`fa2: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);

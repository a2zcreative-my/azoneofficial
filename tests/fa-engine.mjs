/* v1.284.0 - Financial Advisory, the DSR engine on its own (worker/src/fa-engine.ts;
   claude/FINANCIAL-ADVISORY-BLUEPRINT.md sections 8-12). Pure calculations,
   so every case is exact; the routes around it are tests/fa-api.mjs.

     node tests/fa-engine.mjs */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "fae-"));
execSync(`npx esbuild "${join(root, "worker/src/fa-engine.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(dir, "e.mjs")}" --log-level=error`, { cwd: root, stdio: "inherit" });
const E = await import(pathToFileURL(join(dir, "e.mjs")).href);
rmSync(dir, { recursive: true, force: true });
let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? `  [${String(detail).slice(0, 300)}]` : ""}`); } };

let n = 0;
const it = (side, kind, cents, state = "verified", extra = {}) => ({ id: ++n, side, kind, monthly_cents: cents, state, ...extra });
const crit = (over = {}) => ({ id: 1, family: "bank-a:personal_financing", version: 1, bank: "Bank A", product: "personal_financing", income_definition: "net", commitment_definition: "all", dsr_guideline_bp: 6000, min_income_cents: null, employment_categories: null, min_service_months: null, required_documents: null, last_verified_on: "2026-11-01", state: "verified", ...over });
const run = (items, product = "personal_financing", criteria = [crit()], proposal = { instalment_cents: 50000 }, profile = null, docs = []) => E.assess({ product, items, profile, proposal, criteria, verifiedDocKinds: docs, today: "2026-11-11" });

/* the brief's example: RM 5,000 net, RM 2,000 commitments, RM 500 instalment */
const base = [it("income", "gross_salary", 560000), it("deduction", "epf", 60000, "declared"), it("commitment", "personal_financing", 200000, "declared")];
const r1 = run(base);
ok("net income = verified gross - deductions (RM 5,000)", r1.income_net_cents === 500000, r1.income_net_cents);
ok("current DSR 40% and projected 50% (basis points)", r1.current_dsr_bp === 4000 && r1.projected_dsr_bp === 5000, `${r1.current_dsr_bp} ${r1.projected_dsr_bp}`);
ok("disposable after commitments and instalment RM 2,500", r1.disposable_cents === 250000);
ok("50% under a verified 60% guideline: Potentially Suitable - preliminary", r1.outcome === "potentially_suitable", r1.outcome);
ok("never the word approved or eligible in the result", !/approv|eligible/i.test(JSON.stringify(r1)));

/* missing or declared-only income never qualifies */
const r2 = run([it("income", "gross_salary", 560000, "declared"), it("commitment", "car", 100000, "declared")]);
ok("declared income only: Insufficient Information (incomplete), no DSR", r2.outcome === "incomplete" && r2.current_dsr_bp === null && r2.missing.length > 0, r2.outcome);
ok("no income at all: incomplete", run([]).outcome === "incomplete");
ok("a declared deduction still lowers income (never richer than the evidence)", E.incomeOf([it("income", "gross_salary", 500000), it("deduction", "tax", 20000, "declared")]) === 480000);
ok("a verified net salary counts on its own", E.incomeOf([it("income", "net_salary", 450000)]) === 450000 && E.incomeOf([it("income", "net_salary", 450000)], "gross") === null);

/* no universal limit: every guideline is a verified row */
const src = readFileSync(join(root, "worker/src/fa-engine.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
ok("no DSR limit is written in the engine (no 3000-9000 bp or 30-90% constant)", !/\b[3-9]\d00\b/.test(src.replace("NEAR_BP = 500", "")) && !/\b(60|65|70)\s*%/.test(src));
ok("no criterion: manual review, not a rejection", run(base, "personal_financing", []).outcome === "manual_review");
ok("a DRAFT criterion is never matched", run(base, "personal_financing", [crit({ state: "draft" })]).matches.length === 0 && run(base, "personal_financing", [crit({ state: "draft" })]).outcome === "manual_review");
ok("another product's criterion is not used", run(base, "personal_financing", [crit({ product: "debt_consolidation" })]).outcome === "manual_review");

/* near the line, above it, and affordability */
ok("within 5 points of the guideline: manual review", run(base, "personal_financing", [crit({ dsr_guideline_bp: 5300 })]).outcome === "manual_review");
const r3 = run([...base, it("commitment", "car", 150000, "declared")]);
ok("projected 80% above a 60% guideline: Affordability Concern (a review path)", r3.outcome === "affordability_concern" && r3.projected_dsr_bp === 8000, `${r3.outcome} ${r3.projected_dsr_bp}`);
ok("disposable below living costs: Affordability Concern", run([...base, it("expense", "rent", 300000, "declared")]).outcome === "affordability_concern");
ok("arrears recorded: Affordability Concern", run([it("income", "gross_salary", 500000), it("commitment", "car", 50000, "verified", { arrears: 1 })]).outcome === "affordability_concern");

/* matching is transparent */
const r4 = run(base, "personal_financing", [crit({ min_income_cents: 300000, employment_categories: JSON.stringify(["permanent"]), min_service_months: 12, required_documents: JSON.stringify(["payslip", "epf"]) })], { instalment_cents: 50000 }, { employment_category: "permanent", service_months: null }, ["payslip"]);
const m4 = r4.matches[0];
const st = (k) => m4.checks.find((c) => c.key === k)?.state;
ok("match shows satisfied checks (DSR, income, employment)", st("dsr") === "ok" && st("income") === "ok" && st("employment") === "ok", JSON.stringify(m4.checks));
ok("...unverified ones (service not recorded; declared commitments)", st("service") === "unverified" && st("commitments") === "unverified");
ok("...the missing documents", JSON.stringify(m4.missing_documents) === '["epf"]');
ok("...and no score or amount", !("score" in m4) && !("amount" in m4) && !/probab/i.test(JSON.stringify(m4)));
ok("an old criterion is marked stale", run(base, "personal_financing", [crit({ last_verified_on: "2026-06-01" })]).matches[0].stale === true);
ok("a failed employment check: No Suitable Product", run(base, "personal_financing", [crit({ employment_categories: JSON.stringify(["government"]) })], { instalment_cents: 50000 }, { employment_category: "contract" }).outcome === "no_product");
ok("a gross-income criterion uses gross", run(base, "personal_financing", [crit({ income_definition: "gross" })]).matches[0].checks[0].text.includes("44.6%"), run(base, "personal_financing", [crit({ income_definition: "gross" })]).matches[0].checks[0].text);
ok("PTPTN excluded where the criterion says so", E.commitmentsOf([it("commitment", "ptptn", 20000), it("commitment", "car", 50000)], "exclude_ptptn") === 50000);

/* v1.286.0 - age, amount and tenure, only when the verified criterion states them */
const rA = run(base, "personal_financing", [crit({ min_age: 21, max_age: 58, min_amount_cents: 500000, max_amount_cents: 15000000, min_tenure_months: 12, max_tenure_months: 120 })], { instalment_cents: 50000, amount_cents: 3000000, tenure_months: 60 }, { employment_category: "permanent", age_years: 40 });
const sA = (k) => rA.matches[0].checks.find((c) => c.key === k)?.state;
ok("age, amount and tenure inside the ranges are satisfied", sA("age") === "ok" && sA("amount") === "ok" && sA("tenure") === "ok", JSON.stringify(rA.matches[0].checks));
const rB = run(base, "personal_financing", [crit({ max_age: 58 })], { instalment_cents: 50000 }, { age_years: 60 });
ok("an age above the bank's maximum fails the match (No Suitable Product)", rB.matches[0].checks.find((c) => c.key === "age")?.state === "failed" && rB.matches[0].fit === "fails");
const rC = run(base, "personal_financing", [crit({ max_tenure_months: 84, min_age: 21 })], { instalment_cents: 50000, tenure_months: 120 }, {});
ok("a tenure past the maximum fails; an unrecorded age is unverified, never assumed", rC.matches[0].checks.find((c) => c.key === "tenure")?.state === "failed" && rC.matches[0].checks.find((c) => c.key === "age")?.state === "unverified");
ok("no range stated: no age, amount or tenure check at all", !run(base, "personal_financing", [crit()]).matches[0].checks.some((c) => ["age", "amount", "tenure"].includes(c.key)));

/* v1.288.0 - effective dates, one version per family, residual and confidence */
ok("a rule effective tomorrow is not applied today", run(base, "personal_financing", [crit({ effective_from: "2026-11-12" })]).matches.length === 0);
const two = run(base, "personal_financing", [crit({ id: 1, version: 1 }), crit({ id: 2, version: 2, dsr_guideline_bp: 7000 })]);
ok("of two verified versions in force, only the newest counts", two.matches.length === 1 && two.matches[0].criterion_id === 2, JSON.stringify(two.matches.map((m) => m.criterion_id)));
const rr = run([...base, it("expense", "food", 100000)], "personal_financing", [crit()]);
ok("remaining = net - commitments - instalment; residual = remaining - declared living costs", rr.remaining_cents === rr.income_net_cents - rr.commitments_cents - rr.instalment_cents && rr.residual_cents === rr.remaining_cents - 100000, `${rr.remaining_cents} ${rr.residual_cents}`);
ok("no declared living cost: no residual is invented", run(base, "personal_financing", [crit()]).residual_cents === null);

/* illustrative instalment */
ok("annuity instalment (RM 30,000, 60 months, 8%): RM 608.30, rounded up to the sen", E.instalmentOf({ amount_cents: 3000000, tenure_months: 60, rate_bp: 800 }) === 60830, E.instalmentOf({ amount_cents: 3000000, tenure_months: 60, rate_bp: 800 }));
ok("a given instalment wins; nothing given = null", E.instalmentOf({ instalment_cents: 50000 }) === 50000 && E.instalmentOf({}) === null);
/* v1.298.0 - D-1: a flat rate, as Malaysian personal financing is usually quoted */
ok("flat instalment (RM 30,000, 5 years, 7%): (30,000 + 10,500) / 60 = RM 675.00", E.instalmentOf({ amount_cents: 3000000, tenure_months: 60, rate_bp: 700, rate_type: "flat" }) === 67500, E.instalmentOf({ amount_cents: 3000000, tenure_months: 60, rate_bp: 700, rate_type: "flat" }));
ok("flat instalment rounds UP to the sen (RM 10,000, 7 months, 5.55%)", E.instalmentOf({ amount_cents: 1000000, tenure_months: 7, rate_bp: 555, rate_type: "flat" }) === Math.ceil((1000000 * (120000 + 555 * 7)) / (120000 * 7)));
ok("a very large flat amount keeps every sen (BigInt)", E.instalmentOf({ amount_cents: 9_999_999_999, tenure_months: 600, rate_bp: 5000, rate_type: "flat" }) === Number((9_999_999_999n * (120000n + 5000n * 600n) + 120000n * 600n - 1n) / (120000n * 600n)));
ok("no rate type = the reducing annuity, as before", E.instalmentOf({ amount_cents: 3000000, tenure_months: 60, rate_bp: 800 }) === E.instalmentOf({ amount_cents: 3000000, tenure_months: 60, rate_bp: 800, rate_type: "reducing" }));
ok("the engine version says 1.298.0", E.ENGINE_VERSION === "1.298.0");

/* debt consolidation: before, overlap, after - each settled facility removed once, only with evidence */
const cons = [it("income", "gross_salary", 600000), it("commitment", "car", 65000), it("commitment", "personal_financing", 85000, "verified", { settle_in_consolidation: 1, settlement_doc_id: 7 }),
  it("commitment", "credit_card", 35000, "verified", { settle_in_consolidation: 1, settlement_doc_id: null })];
const cc = run(cons, "debt_consolidation", [crit({ product: "debt_consolidation" })], { instalment_cents: 120000 }).consolidation;
ok("A before: RM 1,850, 30.8%", cc.before.commitments_cents === 185000 && cc.before.dsr_bp === 3083, JSON.stringify(cc.before));
ok("B overlap: everything + the new instalment, 50.8%", cc.overlap.dsr_bp === 5083, cc.overlap.dsr_bp);
ok("C after: only the EVIDENCED settlement is removed (the card stays)", cc.after.commitments_cents === 100000 && cc.after.dsr_bp === 3666 && JSON.stringify(cc.after.settled_ids) === JSON.stringify([cons[2].id]), JSON.stringify(cc.after));
const twice = E.settledIds([...cons, { ...cons[2] }]);
ok("a facility listed twice is removed once", twice.size === 1);
const r5 = run(cons, "debt_consolidation", [crit({ product: "debt_consolidation", dsr_guideline_bp: 4500 })], { instalment_cents: 120000 });
ok("overlap above every guideline turns a fit into manual review", r5.outcome === "manual_review" && r5.reasons.some((x) => /overlap/i.test(x)), `${r5.outcome} ${r5.reasons}`);

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }

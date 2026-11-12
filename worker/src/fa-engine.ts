/* v1.284.0 - FINANCIAL ADVISORY, THE ONE DSR ENGINE (the CEO, 11-11-2026:
   "proceed with Financial Advisory" on claude/FINANCIAL-ADVISORY-BLUEPRINT.md
   sections 8-12). Pure functions: no database, no clock - the route passes
   the rows and today's Malaysian date, and stores what comes back as an
   immutable snapshot, so every assessment can be reproduced.

   Integers only: money in sen, DSR in basis points (5000 = 50.00%).

     income       Net = verified income - every deduction (declared ones
                  too: a deduction never makes a client look richer) +
                  verified net salary. Declared income never counts. No
                  verified income = Insufficient Information.
     commitments  every live commitment, declared or verified (a declared
                  debt still weighs); a criterion may exclude PTPTN
     instalment   given, or an ILLUSTRATIVE annuity from amount, tenure and
                  rate - never an offer
     consolidation  A before; B overlap = everything + the new instalment;
                  C after = removes only facilities marked for settlement
                  WITH a settlement document, each once
     outcome      against VERIFIED criteria only; no national DSR limit is
                  written anywhere in this file - every guideline is a row
                  someone verified, with its source
     matching     per criterion: what is satisfied, unverified, failed and
                  missing; never a score, never an amount, never "approved" */

/* v1.288.0 - DSR PRE-CHECK (the CEO approved blueprint v1.2, 12-11-2026):
   the same engine now also reports the breakdown with each figure's source,
   remaining and residual income (residual = after the living costs the
   client DECLARED - no reference figure is invented, decision D2), a
   confidence count, a criterion only from its effective date, and for a
   consolidation the monthly and total-repayment differences with the risks.
   ENGINE_VERSION is stored with every saved result. */
export const ENGINE_VERSION = "1.288.0";

export type Product = "personal_financing" | "debt_consolidation" | "advisory_only";
export type Outcome = "incomplete" | "potentially_suitable" | "manual_review" | "affordability_concern" | "no_product";

export interface FaItem {
  id: number; side: "income" | "deduction" | "commitment" | "expense"; kind: string; monthly_cents: number;
  state: string; settle_in_consolidation?: number | null; settlement_doc_id?: number | null; arrears?: number | null; voided_at?: string | null;
  source?: string | null; label?: string | null; remaining_months?: number | null;
}
export interface FaCriterion {
  id: number; family: string; version: number; bank: string; product: string; income_definition: string; commitment_definition: string;
  dsr_guideline_bp: number | null; min_income_cents: number | null; employment_categories: string | null; min_service_months: number | null;
  required_documents: string | null; last_verified_on: string | null; state: string; bank_id?: number | null; effective_from?: string | null;
  min_age?: number | null; max_age?: number | null; min_amount_cents?: number | null; max_amount_cents?: number | null; min_tenure_months?: number | null; max_tenure_months?: number | null;
}
export interface FaProfile { employment_category?: string | null; service_months?: number | null; age_years?: number | null }
export interface Proposal { instalment_cents?: number | null; amount_cents?: number | null; tenure_months?: number | null; rate_bp?: number | null }
export type CheckState = "ok" | "unverified" | "failed";
export interface Check { key: string; state: CheckState; text: string }
export interface Match { criterion_id: number; family: string; version: number; bank: string; checks: Check[]; missing_documents: string[]; stale: boolean; last_verified_on: string | null; fit: "fits" | "near" | "fails" | "unknown" }

/** "Near a threshold": within 5 points either side needs a person (blueprint 8) */
export const NEAR_BP = 500;
/** criteria older than this many days are shown as stale */
export const STALE_DAYS = 90;
const INCOME_KINDS = ["gross_salary", "allowance", "other_income"];

const live = (i: FaItem) => !i.voided_at && i.state !== "rejected";
const sum = (xs: FaItem[]) => xs.reduce((a, i) => a + Math.max(0, Math.round(Number(i.monthly_cents) || 0)), 0);
const parseList = (s: string | null | undefined): string[] => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

/** income under a definition: "net" (default) or "gross"; null = not known from verified evidence */
export function incomeOf(items: FaItem[], definition = "net"): number | null {
  const inc = items.filter((i) => live(i) && i.side === "income");
  const verifiedGross = sum(inc.filter((i) => i.state === "verified" && INCOME_KINDS.includes(i.kind)));
  const verifiedNet = sum(inc.filter((i) => i.state === "verified" && i.kind === "net_salary"));
  if (definition === "gross") return verifiedGross > 0 ? verifiedGross : null;
  if (verifiedGross === 0 && verifiedNet === 0) return null;
  const deductions = verifiedGross > 0 ? sum(items.filter((i) => live(i) && i.side === "deduction")) : 0;
  const net = verifiedGross - deductions + verifiedNet;
  return net > 0 ? net : null;
}

export function commitmentsOf(items: FaItem[], definition = "all", exclude: ReadonlySet<number> = new Set()): number {
  return sum(items.filter((i) => live(i) && i.side === "commitment" && !exclude.has(i.id) && !(definition === "exclude_ptptn" && i.kind === "ptptn")));
}

/** Illustrative monthly instalment: an annuity in sen, rounded up. Never an offer. */
export function instalmentOf(p: Proposal): number | null {
  if (p.instalment_cents != null && Number.isInteger(p.instalment_cents) && p.instalment_cents >= 0) return p.instalment_cents;
  const P = Number(p.amount_cents ?? 0), n = Number(p.tenure_months ?? 0), bp = Number(p.rate_bp ?? 0);
  if (!(P > 0) || !(n > 0) || !Number.isInteger(n)) return null;
  if (bp <= 0) return Math.ceil(P / n);
  const r = bp / 10000 / 12;
  return Math.ceil((P * r) / (1 - Math.pow(1 + r, -n)));
}

export const dsrBp = (commit: number, income: number | null): number | null => (income && income > 0 ? Math.floor((commit * 10000) / income) : null);

/** The facilities a consolidation removes in period C: marked AND evidenced, each once. */
export function settledIds(items: FaItem[]): Set<number> {
  return new Set(items.filter((i) => live(i) && i.side === "commitment" && Number(i.settle_in_consolidation) === 1 && i.settlement_doc_id != null).map((i) => i.id));
}

function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

export interface Assessment {
  income_net_cents: number | null; commitments_cents: number; instalment_cents: number | null; expenses_cents: number;
  current_dsr_bp: number | null; projected_dsr_bp: number | null; disposable_cents: number | null;
  consolidation: null | {
    before: { commitments_cents: number; dsr_bp: number | null };
    overlap: { commitments_cents: number; instalment_cents: number | null; dsr_bp: number | null };
    after: { commitments_cents: number; instalment_cents: number | null; dsr_bp: number | null; settled_ids: number[] };
  };
  unverified_commitments: number; arrears: boolean; missing: string[];
  outcome: Outcome; reasons: string[]; matches: Match[]; ruleset: { criteria: Array<{ id: number; family: string; version: number }> };
  /* v1.288.0 */
  engine_version: string;
  gross_cents: number | null; deductions_cents: number; remaining_cents: number | null; living_cents: number | null; residual_cents: number | null;
  confidence: { verified: number; declared: number };
  breakdown: Array<{ id: number; side: string; kind: string; label: string | null; monthly_cents: number; state: string; source: string | null; counted: boolean }>;
  consolidation_totals: null | {
    settled_monthly_cents: number; monthly_difference_cents: number | null; new_total_cents: number | null;
    settled_remaining_cents: number | null; total_difference_cents: number | null; risks: string[];
  };
}

export function assess(input: {
  product: Product; items: FaItem[]; profile: FaProfile | null; proposal: Proposal; criteria: FaCriterion[];
  verifiedDocKinds: string[]; today: string;
}): Assessment {
  const { product, items, profile, proposal, today } = input;
  /* v1.288.0 - a rule counts from its effective date, never before */
  const inForce = input.criteria.filter((c) => c.state === "verified" && c.product === product && (!c.effective_from || c.effective_from <= today));
  /* one version per family: the newest that is in force today (a verified future version waits for its date) */
  const criteria = inForce.filter((c) => !inForce.some((o) => o.family === c.family && o.version > c.version));
  const net = incomeOf(items, "net");
  const commit = commitmentsOf(items);
  const inst = product === "advisory_only" ? null : instalmentOf(proposal);
  const expenses = sum(items.filter((i) => live(i) && i.side === "expense"));
  const missing: string[] = [];
  if (net == null) missing.push("Verified income (payslip, statement or EPF) is missing");
  if (product !== "advisory_only" && inst == null) missing.push("Proposed instalment (or amount, tenure and an illustrative rate)");
  const unverified = items.filter((i) => live(i) && i.side === "commitment" && i.state !== "verified").length;
  const arrears = items.some((i) => live(i) && i.side === "commitment" && Number(i.arrears) === 1);

  let consolidation: Assessment["consolidation"] = null;
  const settled = settledIds(items);
  if (product === "debt_consolidation") {
    const after = commitmentsOf(items, "all", settled);
    consolidation = {
      before: { commitments_cents: commit, dsr_bp: dsrBp(commit, net) },
      overlap: { commitments_cents: commit, instalment_cents: inst, dsr_bp: inst == null ? null : dsrBp(commit + inst, net) },
      after: { commitments_cents: after, instalment_cents: inst, dsr_bp: inst == null ? null : dsrBp(after + inst, net), settled_ids: [...settled].sort((a, b) => a - b) },
    };
  }
  const current = dsrBp(commit, net);
  const projected = inst == null ? null : dsrBp((product === "debt_consolidation" ? commitmentsOf(items, "all", settled) : commit) + inst, net);
  const disposable = net == null ? null : net - commit - (inst ?? 0);

  /* matching: every verified criterion of the product, under its own definitions */
  const docs = new Set(input.verifiedDocKinds);
  const matches: Match[] = criteria.map((c) => {
    const income = incomeOf(items, c.income_definition);
    const exclude = product === "debt_consolidation" ? settled : new Set<number>();
    const commitC = commitmentsOf(items, c.commitment_definition, exclude);
    const dsr = inst == null ? dsrBp(commitC, income) : dsrBp(commitC + inst, income);
    const checks: Check[] = [];
    let fit: Match["fit"] = "unknown";
    if (c.dsr_guideline_bp == null) checks.push({ key: "dsr", state: "unverified", text: "DSR guideline not confirmed for this bank and product" });
    else if (dsr == null) checks.push({ key: "dsr", state: "unverified", text: "DSR cannot be computed without verified income" });
    else {
      const g = c.dsr_guideline_bp;
      fit = dsr <= g - NEAR_BP ? "fits" : dsr <= g + NEAR_BP ? "near" : "fails";
      checks.push({ key: "dsr", state: dsr <= g ? "ok" : "failed", text: `${product === "debt_consolidation" ? "After-settlement" : "Projected"} DSR ${(dsr / 100).toFixed(1)}% vs guideline ${(g / 100).toFixed(1)}%${fit === "near" ? " (near the line)" : ""}` });
    }
    if (c.min_income_cents != null) {
      if (income == null) checks.push({ key: "income", state: "unverified", text: "Minimum income: income not verified" });
      else checks.push({ key: "income", state: income >= c.min_income_cents ? "ok" : "failed", text: `Income RM ${(income / 100).toFixed(2)} vs minimum RM ${(c.min_income_cents / 100).toFixed(2)}` });
    }
    const cats = parseList(c.employment_categories);
    if (cats.length) {
      const cat = profile?.employment_category ?? null;
      checks.push(cat ? { key: "employment", state: cats.includes(cat) ? "ok" : "failed", text: `Employment: ${cat}` } : { key: "employment", state: "unverified", text: "Employment category not recorded" });
    }
    if (c.min_service_months != null) {
      const m = profile?.service_months ?? null;
      checks.push(m == null ? { key: "service", state: "unverified", text: "Length of service not recorded" } : { key: "service", state: m >= c.min_service_months ? "ok" : "failed", text: `Service ${m} months vs minimum ${c.min_service_months}` });
    }
    /* v1.286.0 - age, amount and tenure ranges, only when the verified criterion states them */
    const age = profile?.age_years ?? null;
    if (c.min_age != null || c.max_age != null) {
      const lo = c.min_age ?? 0, hi = c.max_age ?? 200;
      checks.push(age == null ? { key: "age", state: "unverified", text: "Age not recorded" } : { key: "age", state: age >= lo && age <= hi ? "ok" : "failed", text: `Age ${age} vs ${c.min_age ?? "-"} to ${c.max_age ?? "-"}` });
    }
    if (product !== "advisory_only" && (c.min_amount_cents != null || c.max_amount_cents != null)) {
      const a = proposal.amount_cents ?? null, lo = c.min_amount_cents ?? 0, hi = c.max_amount_cents ?? Number.MAX_SAFE_INTEGER;
      const rm = (x: number | null | undefined) => (x == null ? "-" : `RM ${(x / 100).toFixed(2)}`);
      checks.push(a == null ? { key: "amount", state: "unverified", text: "Amount not proposed" } : { key: "amount", state: a >= lo && a <= hi ? "ok" : "failed", text: `Amount ${rm(a)} vs ${rm(c.min_amount_cents)} to ${rm(c.max_amount_cents)}` });
    }
    if (product !== "advisory_only" && (c.min_tenure_months != null || c.max_tenure_months != null)) {
      const t = proposal.tenure_months ?? null, lo = c.min_tenure_months ?? 0, hi = c.max_tenure_months ?? 10000;
      checks.push(t == null ? { key: "tenure", state: "unverified", text: "Tenure not proposed" } : { key: "tenure", state: t >= lo && t <= hi ? "ok" : "failed", text: `Tenure ${t} months vs ${c.min_tenure_months ?? "-"} to ${c.max_tenure_months ?? "-"}` });
    }
    if (unverified > 0) checks.push({ key: "commitments", state: "unverified", text: `${unverified} commitment${unverified === 1 ? " is" : "s are"} declared, not verified` });
    const hardFail = checks.some((k) => k.state === "failed" && k.key !== "dsr");
    if (hardFail) fit = "fails";
    const stale = !c.last_verified_on || daysBetween(c.last_verified_on, today) > STALE_DAYS;
    return { criterion_id: c.id, family: c.family, version: c.version, bank: c.bank, checks, missing_documents: parseList(c.required_documents).filter((d) => !docs.has(d)), stale, last_verified_on: c.last_verified_on, fit };
  }).sort((a, b) => a.checks.filter((k) => k.state === "failed").length - b.checks.filter((k) => k.state === "failed").length
    || a.checks.filter((k) => k.state === "unverified").length - b.checks.filter((k) => k.state === "unverified").length || a.bank.localeCompare(b.bank));

  /* the outcome - a review path, never a rejection and never an approval */
  const reasons: string[] = [];
  let outcome: Outcome;
  if (net == null || (product !== "advisory_only" && inst == null)) {
    outcome = "incomplete"; reasons.push(...missing);
  } else if (product === "advisory_only") {
    outcome = "manual_review"; reasons.push("Advisory only: no product is matched");
  } else if (criteria.length === 0) {
    outcome = "manual_review"; reasons.push("No verified bank criterion exists for this product yet");
  } else if (matches.every((m) => m.fit === "fails" && m.checks.some((k) => k.state === "failed" && k.key !== "dsr"))) {
    outcome = "no_product"; reasons.push("No verified criterion matches this product or employment");
  } else if (matches.some((m) => m.fit === "fits")) {
    outcome = "potentially_suitable"; reasons.push("Within the verified guideline of at least one criterion");
  } else if (matches.some((m) => m.fit === "near" || m.fit === "unknown")) {
    outcome = "manual_review"; reasons.push("Near a guideline, or a guideline is not confirmed");
  } else {
    outcome = "affordability_concern"; reasons.push("Above every verified DSR guideline");
  }
  if (outcome === "potentially_suitable" || outcome === "manual_review") {
    if (disposable != null && expenses > 0 && disposable < expenses) { outcome = "affordability_concern"; reasons.push("Disposable income is below the declared living costs"); }
    else if (arrears) { outcome = "affordability_concern"; reasons.push("Arrears are recorded on an existing facility"); }
    else if (consolidation && consolidation.overlap.dsr_bp != null && criteria.every((c) => c.dsr_guideline_bp == null || consolidation!.overlap.dsr_bp! > c.dsr_guideline_bp) && outcome === "potentially_suitable") {
      outcome = "manual_review"; reasons.push("The overlap period (before settlement) is above every guideline");
    }
  }
  /* v1.288.0 - the breakdown, remaining and residual, confidence, consolidation totals */
  const liveItems = items.filter(live);
  const grossV = sum(liveItems.filter((i) => i.side === "income" && i.state === "verified" && INCOME_KINDS.includes(i.kind)));
  const dedAll = sum(liveItems.filter((i) => i.side === "deduction"));
  const remaining = net == null ? null : net - commit - (inst ?? 0);
  const residual = remaining == null || expenses === 0 ? null : remaining - expenses;
  const breakdown = liveItems.map((i) => ({
    id: i.id, side: i.side, kind: i.kind, label: i.label ?? null, monthly_cents: Math.max(0, Math.round(Number(i.monthly_cents) || 0)), state: i.state, source: i.source ?? null,
    counted: i.side === "income" ? i.state === "verified" : true,
  }));
  const confidence = { verified: liveItems.filter((i) => i.state === "verified").length, declared: liveItems.filter((i) => i.state !== "verified").length };
  let consolidation_totals: Assessment["consolidation_totals"] = null;
  if (product === "debt_consolidation") {
    const settledItems = liveItems.filter((i) => settled.has(i.id));
    const settledMonthly = sum(settledItems);
    const tenure = proposal.tenure_months ?? null;
    const newTotal = inst != null && tenure ? inst * tenure : null;
    const known = settledItems.every((i) => Number.isInteger(i.remaining_months) && Number(i.remaining_months) >= 0);
    const settledRemaining = settledItems.length && known ? settledItems.reduce((a, i) => a + Math.round(Number(i.monthly_cents) || 0) * Number(i.remaining_months), 0) : null;
    const risks: string[] = [];
    if (newTotal != null && settledRemaining != null && newTotal > settledRemaining) risks.push("The total repaid rises: the client pays more overall, even if the monthly amount falls");
    if (tenure && settledItems.some((i) => Number(i.remaining_months) > 0) && tenure > Math.max(...settledItems.map((i) => Number(i.remaining_months) || 0))) risks.push("The new tenure is longer than the longest debt it settles");
    if (consolidation?.overlap.dsr_bp != null && criteria.length && criteria.every((c) => c.dsr_guideline_bp == null || consolidation!.overlap.dsr_bp! > c.dsr_guideline_bp)) risks.push("Until the old debts are settled, both run together above every verified guideline");
    if (settledItems.length === 0) risks.push("No facility is marked for settlement with its settlement letter yet: nothing is removed");
    consolidation_totals = {
      settled_monthly_cents: settledMonthly, monthly_difference_cents: inst == null ? null : settledMonthly - inst,
      new_total_cents: newTotal, settled_remaining_cents: settledRemaining,
      total_difference_cents: newTotal != null && settledRemaining != null ? newTotal - settledRemaining : null, risks,
    };
  }
  return {
    engine_version: ENGINE_VERSION, gross_cents: grossV > 0 ? grossV : null, deductions_cents: dedAll, remaining_cents: remaining, living_cents: expenses > 0 ? expenses : null,
    residual_cents: residual, confidence, breakdown, consolidation_totals,
    income_net_cents: net, commitments_cents: commit, instalment_cents: inst, expenses_cents: expenses,
    current_dsr_bp: current, projected_dsr_bp: projected, disposable_cents: disposable, consolidation,
    unverified_commitments: unverified, arrears, missing, outcome, reasons, matches,
    ruleset: { criteria: criteria.map((c) => ({ id: c.id, family: c.family, version: c.version })) },
  };
}

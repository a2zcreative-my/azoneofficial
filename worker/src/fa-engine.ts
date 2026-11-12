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

export type Product = "personal_financing" | "debt_consolidation" | "advisory_only";
export type Outcome = "incomplete" | "potentially_suitable" | "manual_review" | "affordability_concern" | "no_product";

export interface FaItem {
  id: number; side: "income" | "deduction" | "commitment" | "expense"; kind: string; monthly_cents: number;
  state: string; settle_in_consolidation?: number | null; settlement_doc_id?: number | null; arrears?: number | null; voided_at?: string | null;
}
export interface FaCriterion {
  id: number; family: string; version: number; bank: string; product: string; income_definition: string; commitment_definition: string;
  dsr_guideline_bp: number | null; min_income_cents: number | null; employment_categories: string | null; min_service_months: number | null;
  required_documents: string | null; last_verified_on: string | null; state: string;
}
export interface FaProfile { employment_category?: string | null; service_months?: number | null }
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
}

export function assess(input: {
  product: Product; items: FaItem[]; profile: FaProfile | null; proposal: Proposal; criteria: FaCriterion[];
  verifiedDocKinds: string[]; today: string;
}): Assessment {
  const { product, items, profile, proposal, today } = input;
  const criteria = input.criteria.filter((c) => c.state === "verified" && c.product === product);
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
  return {
    income_net_cents: net, commitments_cents: commit, instalment_cents: inst, expenses_cents: expenses,
    current_dsr_bp: current, projected_dsr_bp: projected, disposable_cents: disposable, consolidation,
    unverified_commitments: unverified, arrears, missing, outcome, reasons, matches,
    ruleset: { criteria: criteria.map((c) => ({ id: c.id, family: c.family, version: c.version })) },
  };
}

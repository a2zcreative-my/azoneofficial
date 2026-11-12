/* v1.284.0 - FA=1: Financial Advisory for the browser fixture (serve.mjs).
   INVENTED test data only - the names say "Fixture" and the figures are the
   brief's own worked example (RM 5,000 net, RM 2,000 commitments, RM 500
   instalment: 40% now, 50% projected). The server's rules live in
   worker/src/fa.ts and are proven by tests/fa-api.mjs; this only lets the
   screens be drawn and clicked at every width. */

import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

/* v1.288.0 - the DSR Pre-Check is drawn from the ONE engine (worker/src/fa-engine.ts),
   bundled here exactly as tests/fa-engine.mjs does, never a copy of its formula */
async function bundleEngine() {
  const engDir = mkdtempSync(join(tmpdir(), "fa-eng-"));
  execSync(`npx esbuild "${join(import.meta.dirname, "..", "..", "worker/src/fa-engine.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(engDir, "e.mjs")}" --log-level=error`, { stdio: "inherit" });
  return import(pathToFileURL(join(engDir, "e.mjs")).href);
}
/* only an FA=1 server needs it */
const ENGINE = process.env.FA ? await bundleEngine() : null;

const ROLE = () => process.env.ROLE ?? "ceo";
const caps = () => {
  const r = ROLE();
  return { view: ["ceo", "coo", "cco", "sales_marketing"].includes(r), edit: ["ceo", "coo", "cco", "sales_marketing"].includes(r), decide: ["ceo", "coo", "cco"].includes(r), allocate: ["ceo", "coo"].includes(r) };
};
const LEGAL = { agreement: false, fee: false, disclosure: true, commission: false };
const result1 = {
  income_net_cents: 500000, income_gross_cents: 560000, commitments_cents: 200000, instalment_cents: 50000, expenses_cents: 150000,
  current_dsr_bp: 4000, projected_dsr_bp: 5000, disposable_cents: 250000, consolidation: null, unverified_commitments: 1, arrears: false, missing: [],
  outcome: "potentially_suitable", reasons: ["Projected DSR 50.0% is within Fixture Bank A's verified guideline of 60.0%", "Preliminary only - the bank decides"],
  matches: [{ criterion_id: 1, bank: "Fixture Bank A", fit: "fits", stale: false, last_verified_on: "2026-11-01", missing_documents: ["epf"], checks: [
    { key: "dsr", state: "ok", text: "Projected DSR 50.0% within the 60.0% guideline (net income)" },
    { key: "income", state: "ok", text: "Net income RM 5,000.00 meets the RM 3,000.00 minimum" },
    { key: "commitments", state: "unverified", text: "1 commitment declared, not yet verified" },
  ] }],
  ruleset: [{ id: 1, version: 1 }],
};
const result2 = {
  income_net_cents: 600000, commitments_cents: 185000, instalment_cents: 120000, expenses_cents: 0, current_dsr_bp: 3083, projected_dsr_bp: 3666, disposable_cents: 380000,
  consolidation: { before: { commitments_cents: 185000, dsr_bp: 3083 }, overlap: { commitments_cents: 185000, instalment_cents: 120000, dsr_bp: 5083 }, after: { commitments_cents: 100000, instalment_cents: 120000, dsr_bp: 3666, settled_ids: [22] } },
  unverified_commitments: 0, arrears: false, missing: [], outcome: "manual_review", reasons: ["The overlap period (50.8%) is above every verified guideline until settlement", "Preliminary only - the bank decides"], matches: [], ruleset: [],
};
const STATES = ["KUALA LUMPUR", "SELANGOR", "PUTRAJAYA", "NEGERI SEMBILAN", "JOHOR", "MELAKA", "KEDAH", "PERAK", "PERLIS", "TERENGGANU", "PULAU PINANG", "PAHANG", "KELANTAN", "SABAH", "SARAWAK", "LABUAN"];
const people = { owner: { id: 9001, name: "Fixture Person" } };

function asg(id, banker_id, branch_id, branch, state, district, coverage, coverage_areas) { return { id, banker_id, branch_id, is_primary: 1, coverage, coverage_areas, effective_from: "2026-11-01", branch, state, district }; }
function bk(id, bank_id, full_name, position, work_email, work_phone, status_now, availability_now, assignments, products, facts) {
  return { id, bank_id, bank: bank_id === 1 ? "Fixture Bank A Berhad" : "Fixture Bank B", full_name, position, work_email, work_phone, preferred_channel: work_email ? "work_email" : "work_phone", relationship_type: id === 3 ? "central_unit" : "direct",
    owner_id: 9001, owner: "Fixture Person", case_limit: id === 1 ? 5 : null, open_cases: id === 1 ? 1 : 0, status_now, availability_now, registered_by: id === 2 ? 9001 : 9002, identity: facts.identity ?? null, referral: facts.referral ?? null, assignments, products };
}
function freshState() {
  return {
    cases: [
      { id: 1, case_ref: "FA-000001", product: "personal_financing", stage: "matching", prescreen: "potentially_suitable", banker_status: "under_review", application_status: "not_submitted", override_result: null, override_reason: null, issuer_code: "a2z", purpose: "Fixture: renovate the family home", closed_reason: null, created_at: "2026-11-10 02:00:00", updated_at: "2026-11-11 03:10:00", customer_id: 701, client: "Fixture Client Satu", owner: "Fixture Person", projected_dsr_bp: 5000 },
      { id: 2, case_ref: "FA-000002", product: "debt_consolidation", stage: "review", prescreen: "manual_review", banker_status: "not_contacted", application_status: "not_submitted", override_result: null, override_reason: null, issuer_code: "azoo", purpose: null, closed_reason: null, created_at: "2026-11-09 02:00:00", updated_at: "2026-11-11 01:00:00", customer_id: 702, client: "Fixture Client Dua", owner: "Fixture Person", projected_dsr_bp: 3666 },
      { id: 3, case_ref: "FA-000003", product: "personal_financing", stage: "profile", prescreen: "incomplete", banker_status: "not_contacted", application_status: "not_submitted", override_result: null, override_reason: null, issuer_code: "a2z", purpose: null, closed_reason: null, created_at: "2026-11-11 05:00:00", updated_at: "2026-11-11 05:00:00", customer_id: 703, client: "Fixture Client Tiga Dengan Nama Yang Sangat Panjang Sdn Bhd", owner: "Fixture Person", projected_dsr_bp: null },
    ],
    items: {
      1: [
        { id: 11, side: "income", kind: "gross_salary", label: null, monthly_cents: 560000, outstanding_cents: null, arrears: 0, settle_in_consolidation: 0, settlement_doc_id: null, state: "verified", source: "payslip", voided_at: null },
        { id: 12, side: "deduction", kind: "epf", label: null, monthly_cents: 60000, outstanding_cents: null, arrears: 0, settle_in_consolidation: 0, settlement_doc_id: null, state: "declared", source: "payslip", voided_at: null },
        { id: 13, side: "commitment", kind: "car", label: "Fixture Lender", monthly_cents: 200000, outstanding_cents: 4800000, arrears: 0, settle_in_consolidation: 0, settlement_doc_id: null, state: "declared", source: "declared", voided_at: null },
        { id: 14, side: "expense", kind: "rent", label: null, monthly_cents: 150000, outstanding_cents: null, arrears: 0, settle_in_consolidation: 0, settlement_doc_id: null, state: "declared", source: "declared", voided_at: null },
      ],
      2: [
        { id: 21, side: "income", kind: "net_salary", label: null, monthly_cents: 600000, outstanding_cents: null, arrears: 0, settle_in_consolidation: 0, settlement_doc_id: null, state: "verified", source: "bank_statement", voided_at: null },
        { id: 22, side: "commitment", kind: "personal_financing", label: "Fixture Bank C", monthly_cents: 85000, outstanding_cents: 2100000, arrears: 0, settle_in_consolidation: 1, settlement_doc_id: 202, state: "verified", source: "facility_statement", voided_at: null },
        { id: 23, side: "commitment", kind: "car", label: null, monthly_cents: 65000, outstanding_cents: null, arrears: 0, settle_in_consolidation: 0, settlement_doc_id: null, state: "verified", source: "ccris_by_client", voided_at: null },
        { id: 24, side: "commitment", kind: "credit_card", label: null, monthly_cents: 35000, outstanding_cents: 900000, arrears: 0, settle_in_consolidation: 0, settlement_doc_id: null, state: "verified", source: "ccris_by_client", voided_at: null },
      ],
      3: [],
    },
    documents: {
      1: [{ id: 101, kind: "payslip", doc_date: "2026-10-31", verified: 1, uploaded_at: "2026-11-10 03:00:00", by_name: "Fixture Person" }],
      2: [{ id: 202, kind: "settlement_letter", doc_date: "2026-11-08", verified: 1, uploaded_at: "2026-11-09 03:00:00", by_name: "Fixture Person" }],
      3: [],
    },
    consents: {
      1: [{ id: 1, kind: "privacy_notice", notice_version: "v1-draft", institution: null, documents: null, captured_how: "signed_form", given_at: "2026-11-10", withdrawn_at: null, withdrawn_note: null }, { id: 2, kind: "assessment", notice_version: "v1-draft", institution: null, documents: null, captured_how: "signed_form", given_at: "2026-11-10", withdrawn_at: null, withdrawn_note: null }, { id: 9, kind: "disclosure", notice_version: null, institution: "Fixture Bank A Berhad", documents: JSON.stringify(["payslip"]), captured_how: "signed_form", given_at: "2026-11-11", withdrawn_at: null, withdrawn_note: null }],
      2: [{ id: 3, kind: "privacy_notice", notice_version: "v1-draft", institution: null, documents: null, captured_how: "email", given_at: "2026-11-09", withdrawn_at: null, withdrawn_note: null }, { id: 4, kind: "assessment", notice_version: "v1-draft", institution: null, documents: null, captured_how: "email", given_at: "2026-11-09", withdrawn_at: null, withdrawn_note: null }],
      3: [],
    },
    assessments: { 1: [{ id: 1, result: JSON.stringify(result1), outcome: "potentially_suitable", created_at: "2026-11-10 04:00:00", by_name: "Fixture Person" }], 2: [{ id: 2, result: JSON.stringify(result2), outcome: "manual_review", created_at: "2026-11-10 05:00:00", by_name: "Fixture Person" }], 3: [] },
    notes: {
      1: [
        { id: 2, note_type: "banker", bank: "Fixture Bank A", source: "call", status_value: "under_review", body: "Profile looks acceptable; please send the EPF statement.", conditions: null, missing_documents: "EPF statement", follow_up_on: "2026-11-14", bank_reference: null, approved_cents: null, evidence_id: null, corrects_id: null, author: "Fixture Person", author_role: "sales_marketing", created_at: "2026-11-11 03:10:00" },
        { id: 1, note_type: "system", bank: null, source: null, status_value: "potentially_suitable", body: "DSR pre-screen: current 40.0%, projected 50.0%. Potentially suitable - preliminary.", conditions: null, missing_documents: null, follow_up_on: null, bank_reference: null, approved_cents: null, evidence_id: null, corrects_id: null, author: null, author_role: "system", created_at: "2026-11-10 04:00:00" },
      ],
      2: [], 3: [],
    },
    events: {
      1: [{ id: 1, event: "case_created", detail: null, created_at: "2026-11-10 02:00:00", actor: "Fixture Person" }, { id: 2, event: "consent_recorded", detail: null, created_at: "2026-11-10 02:05:00", actor: "Fixture Person" }, { id: 3, event: "prescreen_completed", detail: null, created_at: "2026-11-10 04:00:00", actor: "Fixture Person" }, { id: 4, event: "banker_feedback", detail: null, created_at: "2026-11-11 03:10:00", actor: "Fixture Person" }],
      2: [{ id: 5, event: "case_created", detail: null, created_at: "2026-11-09 02:00:00", actor: "Fixture Person" }],
      3: [{ id: 6, event: "case_created", detail: null, created_at: "2026-11-11 05:00:00", actor: "Fixture Person" }],
    },
    tasks: { 1: [{ id: 1, title: "FA-000001: Request the EPF statement", deadline: "2026-11-14", status: "pending", assignee: "Fixture Person" }], 2: [], 3: [] },
    criteria: [
      { id: 1, family: "fixture-bank-a:personal_financing", version: 1, bank: "Fixture Bank A", product: "personal_financing", income_definition: "net", commitment_definition: "all", dsr_guideline_bp: 6000, min_income_cents: 300000, employment_categories: null, min_service_months: null, required_documents: JSON.stringify(["payslip", "epf"]), source: "Fixture: product sheet, 01-11-2026", last_verified_on: "2026-11-01", state: "verified" },
      { id: 2, family: "fixture-bank-b:debt_consolidation", version: 1, bank: "Fixture Bank B", product: "debt_consolidation", income_definition: "gross", commitment_definition: "exclude_ptptn", dsr_guideline_bp: null, min_income_cents: null, employment_categories: JSON.stringify(["permanent", "government"]), min_service_months: 6, required_documents: null, source: "Fixture: call with relationship manager, 05-11-2026", last_verified_on: null, state: "draft" },
    ],
    /* v1.286.0 - the registry: invented banks, branches and bankers only */
    banks: [
      { id: 1, name: "Fixture Bank A Berhad", kind: "commercial", status: "verified", website: null, source: "Fixture: invented test bank", last_verified_on: "2026-11-01", branches: 2, bankers: 3, retired_reason: null },
      { id: 2, name: "Fixture Bank B", kind: "islamic", status: "pending", website: null, source: null, last_verified_on: null, branches: 1, bankers: 1, retired_reason: null },
    ],
    products: [
      { id: 1, bank_id: 1, product: "personal_financing", channel: "branch", status: "active", source: "Fixture" },
      { id: 2, bank_id: 1, product: "debt_consolidation", channel: "central", status: "active", source: "Fixture" },
      { id: 3, bank_id: 2, product: "personal_financing", channel: "branch", status: "active", source: "Fixture" },
    ],
    localities: [{ id: 1, state: "JOHOR", district: "Johor Bahru", city: "Johor Bahru" }, { id: 2, state: "JOHOR", district: "Johor Bahru", city: "Skudai" }, { id: 3, state: "SELANGOR", district: "Petaling", city: "Shah Alam" }],
    branches: [
      { id: 1, bank_id: 1, bank: "Fixture Bank A Berhad", name: "Fixture JB City", code: "F01", address: "1 Jalan Fixture", postcode: "80000", state: "JOHOR", district: "Johor Bahru", city: "Johor Bahru", phone: "07-000 0001", status: "open", status_note: null, verified: 1, last_verified_on: "2026-11-01", source: "Fixture", bankers: 2 },
      { id: 2, bank_id: 1, bank: "Fixture Bank A Berhad", name: "Fixture Skudai", code: null, address: null, postcode: "81300", state: "JOHOR", district: "Johor Bahru", city: "Skudai", phone: null, status: "open", status_note: null, verified: 0, last_verified_on: null, source: null, bankers: 0 },
      { id: 3, bank_id: 2, bank: "Fixture Bank B", name: "Fixture Shah Alam", code: null, address: null, postcode: "40000", state: "SELANGOR", district: "Petaling", city: "Shah Alam", phone: null, status: "temporarily_closed", status_note: "Fixture: renovation", verified: 0, last_verified_on: null, source: null, bankers: 1 },
    ],
    bankers: [
      bk(1, 1, "Fixture Banker Satu", "Relationship manager", "satu@fixturebank.test", "07-111 2222", "verified", "available", [asg(1, 1, 1, "Fixture JB City", "JOHOR", "Johor Bahru", "districts", '["Johor Bahru"]')], ["personal_financing"], { identity: { verified_on: "2026-11-01", next_review_on: "2027-11-01", method: "call_branch_line", due: false }, referral: { verified_on: "2026-11-02", next_review_on: "2027-11-02", restrictions: "Personal financing only", due: false } }),
      bk(2, 1, "Fixture Banker Dua", "Personal financing executive", "dua@fixturebank.test", null, "pending_verification", "unknown", [asg(2, 2, 1, "Fixture JB City", "JOHOR", "Johor Bahru", "branch", null)], ["personal_financing"], {}),
      bk(3, 1, "Fixture Banker Tiga Dengan Nama Yang Sangat Panjang", "Central unit", "tiga@fixturebank.test", null, "requires_reverification", "limited", [asg(3, 3, null, null, null, null, "national", null)], ["debt_consolidation"], { identity: { verified_on: "2025-10-01", next_review_on: "2026-10-01", method: "written_letter", due: true } }),
      bk(4, 2, "Fixture Banker Empat", "Branch manager", "empat@fixturebankb.test", "03-555 0000", "no_longer_available", "unknown", [], ["personal_financing"], {}),
    ],
    regEvents: [
      { id: 3, entity: "banker", entity_id: 2, event: "registered", detail: JSON.stringify({ bank: "Fixture Bank A Berhad" }), created_at: "2026-11-10 03:00:00", actor: "Fixture Person", subject: "Fixture Banker Dua" },
      { id: 2, entity: "banker", entity_id: 1, event: "identity_verified", detail: JSON.stringify({ method: "call_branch_line", next_review_on: "2027-11-01" }), created_at: "2026-11-01 03:00:00", actor: "Fixture Person", subject: "Fixture Banker Satu" },
      { id: 1, entity: "bank", entity_id: 1, event: "added", detail: null, created_at: "2026-10-30 03:00:00", actor: "Fixture Person", subject: "Fixture Bank A Berhad" },
    ],
    posts: [],
    /* v1.288.0 - case 1 was submitted and decided Proceed; case 2 waits for review */
    reviews: {
      1: [{ id: 2, assessment_id: 1, action: "proceed", reason: "Verified income, commitments within the fixture guideline.", next_action: null, actor: "Fixture Manager", actor_role: "coo", created_at: "2026-11-10 06:00:00" },
        { id: 1, assessment_id: 1, action: "submitted", reason: null, next_action: null, actor: "Fixture Person", actor_role: "sales_marketing", created_at: "2026-11-10 05:00:00" }],
      2: [{ id: 3, assessment_id: 2, action: "submitted", reason: "Fixture: consolidation overlap needs a look", next_action: null, actor: "Fixture Person", actor_role: "sales_marketing", created_at: "2026-11-11 01:00:00" }],
      3: [],
    },
    allocations: { 1: [], 2: [], 3: [] },
    disclosures: { 1: [], 2: [], 3: [] },
    item_meta: { 1: [{ item_id: 13, lender_name: "Fixture Lender", lender_bank_id: null, account_last4: "4321", facility_ref: null, remaining_months: 24, duplicate_reason: null, created_at: "2026-11-10 03:00:00" }], 2: [], 3: [] },
    matchSeq: 0,
  };
}
export const fa = freshState();
export const resetFa = () => Object.assign(fa, freshState());

function reviewOf(id) {
  const rv = fa.reviews[id] ?? [], last = rv[0];
  const decided = rv.find((r) => r.action !== "submitted");
  return { pending: last?.action === "submitted", submitted_id: last?.action === "submitted" ? last.id : null, submitted_by: null, assessment_id: last?.assessment_id ?? null, decision: last && last.action !== "submitted" ? last.action : null, decided_at: decided?.created_at ?? null };
}

/** One fixture route: [status, body] or null when it is not ours. */
export function faRoute(p, method, b) {
  const c = caps();
  if (!c.view) return [403, { error: { code: "forbidden", message: "You cannot open Financial Advisory" } }];
  if (method !== "GET") fa.posts.push({ path: p, method, body: b });
  if (p === "/staff/fa/summary") {
    const open = fa.cases.filter((x) => x.stage !== "closed");
    return [200, { open: open.length, awaiting_banker: open.filter((x) => ["enquiry_sent", "under_review"].includes(x.banker_status)).length, incomplete: open.filter((x) => x.prescreen === "incomplete").length, official_decisions: 0, legal: LEGAL, can: { create: c.edit, decide: c.decide, criteria: c.decide } }];
  }
  if (p === "/staff/fa/cases" && method === "GET") return [200, { cases: fa.cases }];
  /* v1.288.0 - the stateless pre-check: the real engine on the fixture's criteria; nothing kept */
  if (p === "/staff/fa/preview" && method === "POST") {
    if (!c.edit) return [403, { error: { code: "forbidden", message: "You cannot run a DSR pre-check" } }];
    for (const k of ["name", "ic", "nric", "phone", "email", "customer", "client"]) if (b[k] !== undefined) return [400, { error: { code: "identity_refused", message: "A Quick Check takes figures only - no name, IC, phone or email." } }];
    const items = (b.items ?? []).map((r, i) => ({ id: i + 1, side: r.side, kind: r.kind, monthly_cents: r.monthly_cents, state: r.verified ? "verified" : "declared", settle_in_consolidation: r.settle ? 1 : 0, settlement_doc_id: r.settle ? -1 : null, arrears: 0, remaining_months: r.remaining_months ?? null }));
    const result = ENGINE.assess({ product: b.product ?? "personal_financing", items, profile: null, proposal: b.proposal ?? {}, criteria: fa.criteria, verifiedDocKinds: [], today: "2026-11-12" });
    return [200, { result, assumed_settlements: items.filter((i) => i.settlement_doc_id === -1).length, stored: false }];
  }
  if (p === "/staff/fa/reviews" && method === "GET") {
    const pending = fa.cases.flatMap((k) => { const r = fa.reviews[k.id]?.[0]; return r && r.action === "submitted" ? [{ id: r.id, case_id: k.id, assessment_id: r.assessment_id, reason: r.reason, created_at: r.created_at, submitted_by: r.actor, case_ref: k.case_ref, product: k.product, client: k.client, current_dsr_bp: null, projected_dsr_bp: k.projected_dsr_bp, outcome: k.prescreen }] : []; });
    return [200, { pending, can: { decide: c.decide } }];
  }
  const al = p.match(/^\/staff\/fa\/allocations\/(\d+)$/);
  if (al && method === "POST") {
    const a = Object.values(fa.allocations).flat().find((x) => x.id === Number(al[1]));
    if (!a) return [404, { error: { code: "not_found", message: "Allocation not found" } }];
    if (b.action === "approve") {
      if (!c.allocate) return [403, { error: { code: "forbidden", message: "Only the CEO or COO approves a banker allocation" } }];
      a.state = "awaiting_consent";
      const kc = fa.consents[a.case_id].some((x) => x.kind === "disclosure" && !x.withdrawn_at && x.institution === a.bank);
      if (kc) a.state = "ready";
    } else a.state = "cancelled";
    return [200, { ok: true, state: a.state }];
  }
  if (p === "/staff/fa/cases" && method === "POST") {
    const digits = String(b.new_customer?.phone ?? "").replace(/\D/g, "");
    if (!b.customer_id && digits === "0123456789") return [409, { error: { code: "duplicate_customer", message: "Fixture Client Satu already has this phone number - open the case on that customer." }, customer_id: 701, customer: "Fixture Client Satu" }];
    if (b.customer_id === 701 && b.product === "personal_financing") return [409, { error: { code: "case_exists", message: "This client already has an open personal financing case (FA-000001)." }, case_id: 1 }];
    const id = fa.cases.length + 1, ref = `FA-${String(id).padStart(6, "0")}`;
    fa.cases.unshift({ id, case_ref: ref, product: b.product, stage: "intake", prescreen: "incomplete", banker_status: "not_contacted", application_status: "not_submitted", override_result: null, override_reason: null, issuer_code: b.issuer_code, purpose: b.purpose ?? null, closed_reason: null, created_at: "2026-11-11 06:00:00", updated_at: "2026-11-11 06:00:00", customer_id: b.customer_id ?? 800 + id, client: b.customer_id === 701 ? "Fixture Client Satu" : b.new_customer?.name, owner: "Fixture Person", projected_dsr_bp: null });
    for (const k of ["items", "documents", "consents", "assessments", "notes", "tasks"]) fa[k][id] = [];
    fa.events[id] = [{ id: 100 + id, event: "case_created", detail: null, created_at: "2026-11-11 06:00:00", actor: "Fixture Person" }];
    return [201, { ok: true, id, case_ref: ref }];
  }
  const m = p.match(/^\/staff\/fa\/cases\/(\d+)(?:\/([a-z]+))?$/);
  if (m) {
    const k = fa.cases.find((x) => x.id === Number(m[1]));
    if (!k) return [404, { error: { code: "not_found", message: "Case not found" } }];
    const id = k.id, sub = m[2];
    if (!sub && method === "GET") return [200, {
      ok: true, case: k, customer: { id: k.customer_id, name: k.client, phone: "01X-XXX XXXX", email: null }, owner: people.owner,
      profile: id === 1 ? { version: 1, employment_status: "employed", employment_category: "permanent", employer_type: "Private company", service_months: 38, salary_pattern: "bank_credit", dependants: 2, age_years: 34, ic_masked: "XXXXXX-XX-1234" } : null,
      items: fa.items[id], documents: fa.documents[id], consents: fa.consents[id], assessments: fa.assessments[id], notes: fa.notes[id], events: fa.events[id], tasks: fa.tasks[id], members: [],
      can: { edit: c.edit, decide: c.decide, note: c.edit, allocate: c.allocate }, legal: LEGAL,
      reviews: fa.reviews[id] ?? [], item_meta: fa.item_meta[id] ?? [], allocations: fa.allocations[id] ?? [], disclosures: fa.disclosures[id] ?? [],
      review: reviewOf(id),
    }];
    if (sub === "assessments" && method === "GET") return [200, { assessments: (fa.assessments[id] ?? []).map((a) => { const r = JSON.parse(a.result); return { id: a.id, outcome: a.outcome, current_dsr_bp: r.current_dsr_bp, projected_dsr_bp: r.projected_dsr_bp, created_at: a.created_at, by_name: a.by_name, engine_version: r.engine_version ?? null, review: (fa.reviews[id] ?? []).find((x) => x.assessment_id === a.id)?.action ?? null }; }) }];
    if (sub === "figures" && method === "PUT") {
      const lines = b.items ?? [];
      const seen = new Map();
      for (const [i, l] of lines.entries()) {
        if (l.side !== "commitment") continue;
        const key = `${l.kind}|${(l.lender_name ?? "").toLowerCase()}|${l.account_last4 ?? ""}|${l.monthly_cents}`;
        if (seen.has(key) && String(l.duplicate_reason ?? "").trim().length < 10) return [409, { error: { code: "possible_duplicate", message: `Line ${i + 1} looks like the same facility as line ${seen.get(key) + 1}. Remove it, or say why it is a second facility.` }, line: i }];
        seen.set(key, i);
      }
      fa.items[id] = lines.map((l, i) => ({ id: l.id ?? 900 + i + fa.posts.length * 50, side: l.side, kind: l.kind, label: l.lender_name ?? null, monthly_cents: l.monthly_cents, outstanding_cents: null, arrears: 0, settle_in_consolidation: 0, settlement_doc_id: null, state: (fa.items[id] ?? []).find((x) => x.id === l.id && x.monthly_cents === l.monthly_cents)?.state ?? "declared", source: "declared", voided_at: null }));
      return [200, { ok: true, kept: 0, added: lines.length, voided: 0 }];
    }
    if (sub === "assess" && method === "POST") {
      const r = ENGINE.assess({ product: k.product, items: fa.items[id].map((x) => ({ ...x, remaining_months: (fa.item_meta[id] ?? []).find((mm) => mm.item_id === x.id)?.remaining_months ?? null })), profile: null, proposal: b, criteria: fa.criteria, verifiedDocKinds: [], today: "2026-11-12" });
      const aid = 10 + fa.posts.length;
      fa.assessments[id].unshift({ id: aid, result: JSON.stringify(r), outcome: r.outcome, created_at: "2026-11-12 03:00:00", by_name: "Fixture Person" });
      k.prescreen = r.outcome; k.projected_dsr_bp = r.projected_dsr_bp;
      return [201, { ok: true, id: aid, result: r }];
    }
    if (sub === "review" && method === "POST") {
      if (reviewOf(id).pending) return [409, { error: { code: "already_pending", message: "This case is already waiting for review." } }];
      fa.reviews[id].unshift({ id: 100 + fa.posts.length, assessment_id: b.assessment_id, action: "submitted", reason: b.note ?? null, next_action: null, actor: "Fixture Person", actor_role: ROLE(), created_at: "2026-11-12 03:10:00" });
      k.stage = "review";
      return [201, { ok: true }];
    }
    if (sub === "review" && method === "PUT") {
      if (!c.decide) return [403, { error: { code: "forbidden", message: "Only the CEO, COO or CCO decides a review" } }];
      const pend = reviewOf(id);
      if (!pend.pending) return [409, { error: { code: "nothing_pending", message: "Nothing is waiting for review on this case." } }];
      fa.reviews[id].unshift({ id: 100 + fa.posts.length, assessment_id: pend.assessment_id, action: b.decision, reason: b.reason, next_action: b.next_action ?? null, actor: "Fixture Manager", actor_role: ROLE(), created_at: "2026-11-12 03:20:00" });
      k.stage = b.decision === "proceed" ? "matching" : b.decision === "unsuitable" ? "closed" : b.decision === "request_info" ? "profile" : k.stage;
      return [200, { ok: true }];
    }
    if (sub === "match" && method === "POST") {
      if (reviewOf(id).decision !== "proceed") return [409, { error: { code: "review_required", message: "Banker matching opens after Management decides Proceed." } }];
      const shortlist = b.state === "JOHOR" ? [{ banker_id: 1, banker: "Fixture Banker Satu", bank: "Fixture Bank A Berhad", branch: "Fixture JB City", tier: "ready", reasons: ["Verified identity and referral permission", "Covers Johor Bahru", "Handles personal financing"] }] : [];
      const excluded = [{ banker: "Fixture Banker Tiga Dengan Nama Yang Sangat Panjang", bank: "Fixture Bank A Berhad", why: "Identity re-verification is due" }];
      return [201, { match_id: ++fa.matchSeq, shortlist, excluded }];
    }
    if (sub === "allocations" && method === "POST") {
      if ((fa.allocations[id] ?? []).some((a) => ["pending_review", "assigned", "awaiting_consent", "ready"].includes(a.state))) return [409, { error: { code: "already_allocated", message: "This case already has a banker." } }];
      const x = fa.bankers.find((y) => y.id === b.banker_id);
      fa.allocations[id].unshift({ id: 300 + fa.posts.length, case_id: id, bank: x?.bank ?? "", banker: x?.full_name ?? "", branch: "Fixture JB City", state: "pending_review", reason: b.reason ?? null, created_at: "2026-11-12 03:30:00", enquiry_id: null, enquiry_state: null, sent_at: null });
      return [201, { ok: true }];
    }
    if (sub === "enquiries" && method === "POST") {
      const a = (fa.allocations[id] ?? []).find((x) => x.id === b.allocation_id);
      if (!a || !fa.consents[id].some((x) => x.kind === "disclosure" && !x.withdrawn_at && x.institution === a.bank)) return [409, { error: { code: "consent_required", message: "Record the client's disclosure consent for this bank first." } }];
      a.enquiry_id = 400 + fa.posts.length; a.enquiry_state = "sent"; a.sent_at = "2026-11-12 03:40:00"; a.state = "ready"; k.banker_status = "enquiry_sent"; k.stage = "enquiry";
      return [201, { ok: true, id: a.enquiry_id }];
    }
    if (sub === "disclosures" && method === "POST") {
      for (const d of b.document_ids ?? []) fa.disclosures[id].unshift({ id: 500 + fa.posts.length + d, enquiry_id: b.enquiry_id, document_id: d, document_kind: fa.documents[id].find((x) => x.id === d)?.kind ?? null, channel: b.channel, recipient: "satu@fixturebank.test", purpose: b.purpose, sent_at: "2026-11-12 03:50:00", sent_by: "Fixture Person" });
      return [201, { ok: true }];
    }
    if (sub === "notes" && method === "POST") {
      if (b.type === "banker" && !["enquiry_sent", "under_review", "indicatively_suitable", "documents_required", "not_supported"].includes(b.status)) return [400, { error: { code: "invalid_input", message: "A banker's feedback is never an approval." } }];
      if (b.type === "decision" && !c.decide) return [403, { error: { code: "forbidden", message: "Only management records an official decision" } }];
      if (b.type === "decision" && !b.evidence_id) return [400, { error: { code: "evidence_required", message: "Attach the bank's letter." } }];
      fa.notes[id].unshift({ id: 50 + fa.posts.length, note_type: b.type, bank: (b.banker_id ? fa.bankers.find((x) => x.id === b.banker_id)?.bank : fa.banks.find((x) => x.id === b.bank_id)?.name) ?? null, source: b.source ?? null, status_value: b.status, body: b.body, conditions: b.conditions ?? null, missing_documents: b.missing_documents ?? null, follow_up_on: b.follow_up_on ?? null, bank_reference: b.bank_reference ?? null, approved_cents: b.approved_cents ?? null, evidence_id: b.evidence_id ?? null, corrects_id: null, author: "Fixture Person", author_role: ROLE(), created_at: "2026-11-11 06:30:00" });
      if (b.type === "banker") k.banker_status = b.status; else k.application_status = b.status;
      return [201, { ok: true }];
    }
    if (["agreement", "fee"].includes(sub)) return [409, { error: { code: "legal_gate", message: "Switched off until counsel clears it." } }];
    if (method !== "GET") return [method === "POST" ? 201 : 200, { ok: true }];
  }
  if (p === "/staff/fa/criteria" && method === "GET") return [200, { criteria: fa.criteria, can: { propose: c.edit, verify: c.decide } }];
  /* v1.286.0 - the registry (rules proven by tests/fa-registry.mjs) */
  if (p === "/staff/fa/registry" && method === "GET") return [200, { banks: fa.banks, products: fa.products, localities: fa.localities, branches: fa.branches, bankers: fa.bankers, states: STATES, today: "2026-11-12", can: { register: c.edit, manage: c.allocate } }];
  if (p === "/staff/fa/registry/events" && method === "GET") return [200, { events: fa.regEvents }];
  const one = p.match(/^\/staff\/fa\/bankers\/(\d+)$/);
  if (one && method === "GET") {
    const x = fa.bankers.find((y) => y.id === Number(one[1]));
    if (!x) return [404, { error: { code: "not_found", message: "Banker not found" } }];
    const verifications = [x.referral && { id: 2, fact: "referral", method: "written_letter", evidence: "Fixture: branch letter", restrictions: x.referral.restrictions, verified_on: x.referral.verified_on, next_review_on: x.referral.next_review_on, verified_by_name: "Fixture Person" },
      x.identity && { id: 1, fact: "identity", method: x.identity.method, evidence: "Fixture: called the official line", restrictions: null, verified_on: x.identity.verified_on, next_review_on: x.identity.next_review_on, verified_by_name: "Fixture Person" }].filter(Boolean);
    const assignments = [...x.assignments.map((a) => ({ ...a, ended_on: null, end_reason: null, city: null })), ...(x.id === 1 ? [{ ...asg(9, 1, 2, "Fixture Skudai", "JOHOR", "Johor Bahru", "branch", null), is_primary: 0, effective_from: "2025-01-01", ended_on: "2026-10-31", end_reason: "Transfer: Fixture move", city: null }] : [])];
    return [200, { banker: { ...x, notes: null, registered_by_name: "Fixture Person", status_reason: null, created_at: "2026-10-30 03:00:00", unavailable_until: null, duplicate_reason: null }, verifications, assignments,
      events: fa.regEvents.filter((e) => e.entity === "banker" && e.entity_id === x.id), today: "2026-11-12",
      owners: c.allocate ? [{ id: 9001, name: "Fixture Person" }, { id: 9002, name: "Fixture Manager" }] : [],
      can: { register: c.edit, manage: c.allocate, availability: c.allocate || x.owner_id === 9001, edit: (c.allocate || (c.edit && x.owner_id === 9001)) && x.status_now !== "no_longer_available" } }];
  }
  /* v1.290.0 - one banker's cases: counted for all, named only where the viewer may open them (rules: tests/fa-banker-pic.mjs) */
  const bc = p.match(/^\/staff\/fa\/bankers\/(\d+)\/cases$/);
  if (bc && method === "GET") {
    if (Number(bc[1]) !== 1) return [200, { counts: { allocated: 0, pending: 0, enquiry_open: 0, feedback: 0, outcome: 0 }, cases: [] }];
    const all = c.decide;
    return [200, { counts: { allocated: 2, pending: 0, enquiry_open: 1, feedback: 1, outcome: 0 }, cases: [
      { allocation_id: 31, state: "ready", mine: true, case_id: 1, case_ref: "FA-000001", client: "Fixture Client Satu", product: "personal_financing", projected_dsr_bp: 5000, application_status: "not_submitted", created_at: "2026-11-10 06:30:00", decided_at: "2026-11-10 07:00:00", decided_by: "Fixture Manager", enquiry_state: "feedback_received", sent_at: "2026-11-10 08:00:00",
        feedback: [{ id: 2, status_value: "under_review", body: "Profile looks acceptable; please send the EPF statement.", source: "call", missing_documents: "EPF statement", follow_up_on: "2026-11-14", created_at: "2026-11-11 03:10:00", contact_on: "2026-11-11", author: "Fixture Person" }], decisions: [] },
      all ? { allocation_id: 32, state: "pending_review", mine: true, case_id: 2, case_ref: "FA-000002", client: "Fixture Client Dua", product: "debt_consolidation", projected_dsr_bp: 3666, application_status: "not_submitted", created_at: "2026-11-11 06:30:00", decided_at: null, decided_by: null, enquiry_state: null, sent_at: null, feedback: [], decisions: [] }
        : { allocation_id: 32, state: "pending_review", mine: false },
    ] }];
  }
  if (p === "/staff/fa/bankers" && method === "POST") {
    const email = String(b.work_email ?? "").trim().toLowerCase(), phone = String(b.work_phone ?? "").replace(/\D/g, "").replace(/^60/, "0");
    const same = fa.bankers.find((x) => x.work_email && x.work_email.toLowerCase() === email);
    if (email && same) return [409, { error: { code: "duplicate_banker", message: `${same.full_name} (${same.bank}) already has this work email - open that record.` }, existing: { id: same.id, full_name: same.full_name, bank: same.bank } }];
    const sameP = fa.bankers.find((x) => x.work_phone && x.work_phone.replace(/\D/g, "") === phone);
    if (phone && sameP && String(b.different_reason ?? "").trim().length < 10) return [409, { error: { code: "possible_duplicate", message: `${sameP.full_name} (${sameP.bank}) has the same work phone. Open that record, or say why this is a different person.` }, existing: { id: sameP.id } }];
    const id = fa.bankers.length + 1;
    fa.bankers.push(bk(id, b.bank_id, b.full_name, b.position ?? null, b.work_email ?? null, b.work_phone ?? null, "pending_verification", "unknown", [], b.products ?? [], {}));
    return [201, { ok: true, id, status: "pending_verification", same_name_as: [] }];
  }
  const vf = p.match(/^\/staff\/fa\/bankers\/(\d+)\/verify$/);
  if (vf && method === "POST") {
    if (!c.allocate) return [403, { error: { code: "forbidden", message: "Only the CEO or COO verifies a banker" } }];
    const x = fa.bankers.find((y) => y.id === Number(vf[1]));
    if (ROLE() !== "ceo" && x?.registered_by === 9001) return [403, { error: { code: "self_approval", message: "You registered this banker - someone else verifies them." } }];
    if (x && b.fact === "identity") { x.identity = { verified_on: b.verified_on, next_review_on: "2027-11-12", method: b.method, due: false }; x.status_now = "verified"; }
    return [200, { ok: true, next_review_on: "2027-11-12" }];
  }
  if (p === "/staff/fa/branches" && method === "POST") {
    const loc = fa.localities.find((l) => l.id === b.locality_id);
    if (loc && String(b.postcode).startsWith("5") && loc.state === "JOHOR" && String(b.postcode_note ?? "").trim().length < 5) return [409, { error: { code: "postcode_state_mismatch", message: `Postcode ${b.postcode} reads as KUALA LUMPUR, not JOHOR. Check it, or say why it is right.` } }];
    return [201, { ok: true, id: 10 + fa.posts.length, same_name_elsewhere: [] }];
  }
  if (method !== "GET") return [method === "POST" ? 201 : 200, { ok: true }];
  return null;
}

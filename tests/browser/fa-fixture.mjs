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
/* v1.299.0 - the priority is worked out by the server's own rules (worker/src/fa-priority.ts), bundled the same way */
async function bundlePriority() {
  const d = mkdtempSync(join(tmpdir(), "fa-prio-"));
  execSync(`npx esbuild "${join(import.meta.dirname, "..", "..", "worker/src/fa-priority.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(d, "p.mjs")}" --log-level=error`, { stdio: "inherit" });
  return import(pathToFileURL(join(d, "p.mjs")).href);
}
const PRIO = process.env.FA ? await bundlePriority() : null;
/* v1.302.0 - phase 5: the merge, the template check and the fee rounding are the server's own (worker/src/fa-templates.ts), bundled the same way */
async function bundleTemplates() {
  const d = mkdtempSync(join(tmpdir(), "fa-tpl-"));
  execSync(`npx esbuild "${join(import.meta.dirname, "..", "..", "worker/src/fa-templates.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(d, "t.mjs")}" --log-level=error`, { stdio: "inherit" });
  return import(pathToFileURL(join(d, "t.mjs")).href);
}
const TPL = process.env.FA ? await bundleTemplates() : null;

const ROLE = () => process.env.ROLE ?? "ceo";
const caps = () => {
  const r = ROLE();
  return { view: ["ceo", "coo", "cco", "sales_marketing"].includes(r), edit: ["ceo", "coo", "cco", "sales_marketing"].includes(r), decide: ["ceo", "coo", "cco"].includes(r), allocate: ["ceo", "coo"].includes(r), priority: ["ceo", "coo", "cco"].includes(r) };
};
/* v1.298.0 - the fee on by the CEO's decision (13-11-2026); the agreement and commission stay off */
const LEGAL = { agreement: false, fee: true, disclosure: true, commission: false };
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
    owner_id: 9001, owner: "Fixture Person", case_limit: id === 1 ? 5 : null, open_cases: id === 1 ? 1 : 0, status_now, availability_now, registered_by: id === 2 ? 9001 : 9002, identity: facts.identity ?? null, referral: facts.referral ?? null, assignments, products,
    /* v1.300.0 (D-3) - a MEASURED reply time, invented: Satu has four answered enquiries, Dua one (not enough), the rest none */
    reply: id === 1 ? { median_hours: 5, n: 4 } : id === 2 ? { median_hours: null, n: 1 } : { median_hours: null, n: 0 }, last_contact_at: id === 1 ? "2026-11-11 03:00:00" : null };
}
const mytDay = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const mytNow = () => new Date().toISOString().replace("T", " ").slice(0, 19);
/* v1.298.0 - the case list as the server builds it: next follow-up from the case's open tasks, the banker from its allocation, the review state */
function caseRows() {
  return fa.cases.map((k) => {
    const open = (fa.tasks[k.id] ?? []).filter((x) => x.status !== "completed").sort((a, z) => (a.deadline ?? "9999").localeCompare(z.deadline ?? "9999"));
    const al = (fa.allocations[k.id] ?? []).find((a) => !["cancelled", "reassigned"].includes(a.state));
    const rv = (fa.reviews[k.id] ?? [])[0];
    const o = fa.ops[k.id] ?? {};
    const row = { ...k, owner_id: 9001, current_dsr_bp: k.projected_dsr_bp == null ? null : k.projected_dsr_bp - 1000, next_follow_up: open.find((x) => x.deadline)?.deadline ?? null, next_task: open[0]?.title ?? null, next_task_owner: open[0]?.assignee ?? null,
      banker: al ? `${al.bank} · ${al.banker}` : null, review_pending: rv?.action === "submitted" ? 1 : 0, review_at: rv?.created_at ?? null, review_action: rv?.action ?? null,
      allocation_state: al?.state ?? null, waiting_on: o.waiting_on ?? null, blocker: o.blocker ?? null, blocker_urgent: o.blocker_urgent ?? 0, ops_next_action: o.next_action ?? null, closed_kind: o.closed_kind ?? null,
      priority_override: o.priority_override ?? null, priority_reason: o.priority_reason ?? null, priority_by: o.priority_override ? "Fixture Manager" : null };
    /* v1.299.0 - the server's own priority rules on the fixture's records */
    const auto = PRIO ? PRIO.priorityOf({ stage: row.stage, next_follow_up: row.next_follow_up, review_pending: !!row.review_pending, review_at: row.review_at, banker_status: row.banker_status, banker_docs_at: null, last_update: mytNow(), waiting_on: row.waiting_on, blocker_urgent: !!row.blocker_urgent }, mytDay()) : null;
    return { ...row, priority: (row.stage !== "closed" && row.priority_override) || auto?.level || null, priority_auto: auto?.level ?? null, priority_why: auto?.reasons ?? [] };
  });
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
    /* v1.298.0 - case 3's follow-up is due TODAY (the browser's own Malaysian date), so "today's follow-ups" has a real row */
    tasks: { 1: [{ id: 1, title: "FA-000001: Request the EPF statement", deadline: "2026-11-14", status: "pending", assignee: "Fixture Person" }], 2: [], 3: [{ id: 2, title: "FA-000003: Collect the latest payslip", deadline: mytDay(), status: "pending", assignee: "Fixture Person" }] },
    criteria: [
      { id: 1, family: "fixture-bank-a:personal_financing", version: 1, bank: "Fixture Bank A", product: "personal_financing", income_definition: "net", commitment_definition: "all", dsr_guideline_bp: 6000, min_income_cents: 300000, employment_categories: null, min_service_months: null, required_documents: JSON.stringify(["payslip", "epf"]), source: "Fixture: product sheet, 01-11-2026", last_verified_on: "2026-11-01", state: "verified",
        category: "official", confidence: "high", review_due_on: "2027-02-01", expires_on: null, verified_by_name: "Fixture Manager", created_by_name: "Fixture Person", created_by: 9001, effective_from: "2026-11-01" },
      { id: 2, family: "fixture-bank-b:debt_consolidation", version: 1, bank: "Fixture Bank B", product: "debt_consolidation", income_definition: "gross", commitment_definition: "exclude_ptptn", dsr_guideline_bp: null, min_income_cents: null, employment_categories: JSON.stringify(["permanent", "government"]), min_service_months: 6, required_documents: null, source: "Fixture: call with relationship manager, 05-11-2026", last_verified_on: null, state: "draft",
        category: "official", confidence: "medium", created_by_name: "Fixture Person", created_by: 9001 },
      /* v1.301.0 - a banker's indicative words (invented): kept for review, never matched */
      { id: 3, family: "fixture-bank-a:personal_financing:indicative", version: 1, bank: "Fixture Bank A", product: "personal_financing", income_definition: "net", commitment_definition: "all", dsr_guideline_bp: 7000, min_income_cents: null, employment_categories: null, min_service_months: null, required_documents: null, source: "Fixture: phone call", last_verified_on: null, state: "draft",
        category: "banker_indicative", confidence: "medium", source_banker: "Fixture Banker Satu", heard_on: "2026-11-10", channel: "work_phone", exact_feedback: "Fixture: usually accepts up to 70% for government staff", created_by_name: "Fixture Person", created_by: 9001 },
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
    /* v1.299.0 - FA 2.0 phase 2: the case's operations row and its update history (invented) */
    ops: { 1: {}, 2: {}, 3: {} },
    /* v1.302.0 - FA 2.0 phase 5: one published template (A2Z, personal financing, an invented rate), one under review, and one disbursement on case 1 (invented) */
    templates: [{ id: 1, name: "Fixture personal financing agreement", issuer_code: "a2z", service_type: "personal_financing", created_by_name: "Fixture Manager" }, { id: 2, name: "Fixture consolidation agreement", issuer_code: "azoo", service_type: "debt_consolidation", created_by_name: "Fixture Manager" }],
    versions: [
      { id: 11, template_id: 1, version: 2, format: "docx", source_name: "Fixture agreement.docx", source_sha256: "ab".repeat(32), body: "# FIXTURE ADVISORY AGREEMENT\n\nThis fixture agreement is between {{company_name}} ({{company_registration}}) and {{client_name}}, IC {{ic_number}}, dated {{agreement_date}}.\n\nCase {{case_ref}}. Service fee {{fee_rate}} of the disbursed amount.\n\nContact: {{client_email}}", fee_bp: 1500, state: "approved", created_by: 9002, created_at: "2026-11-12 03:00:00", created_by_name: "Fixture Manager", submitted_at: "2026-11-12 03:10:00", submitted_by_name: "Fixture Manager", legal_basis: "ceo_without_review", legal_reviewer: null, legal_firm: null, legal_reviewed_on: null, legal_reference: null, published_at: "2026-11-12 04:00:00", published_by_name: "Fixture Owner", archived_at: null, archived_reason: null },
      { id: 10, template_id: 1, version: 1, format: "text", source_name: null, source_sha256: null, body: "# OLD FIXTURE TEXT\n\n{{client_name}} agrees with the fixture company on the old fixture terms.", fee_bp: 1500, state: "archived", created_by: 9002, created_at: "2026-11-11 03:00:00", created_by_name: "Fixture Manager", submitted_at: null, submitted_by_name: null, legal_basis: null, legal_reviewer: null, legal_firm: null, legal_reviewed_on: null, legal_reference: null, published_at: null, published_by_name: null, archived_at: "2026-11-12 04:00:00", archived_reason: "Superseded by version 2" },
      { id: 12, template_id: 2, version: 1, format: "text", source_name: null, source_sha256: null, body: "# FIXTURE CONSOLIDATION AGREEMENT\n\n{{client_name}} and {{company_name}} agree on the fixture consolidation advisory for case {{case_ref}} at {{fee_rate}}.", fee_bp: 1200, state: "review", created_by: 9002, created_at: "2026-11-12 05:00:00", created_by_name: "Fixture Manager", submitted_at: "2026-11-12 05:10:00", submitted_by_name: "Fixture Manager", legal_basis: null, legal_reviewer: null, legal_firm: null, legal_reviewed_on: null, legal_reference: null, published_at: null, published_by_name: null, archived_at: null, archived_reason: null },
    ],
    fees: [{ note_id: 77, case_id: 1, bank: "Fixture Bank A", approved_cents: 3333333, has_evidence: 1, recorded_at: "2026-11-12 06:00:00", corrected: 0, case_ref: "FA-000001", product: "personal_financing", issuer_code: "a2z", client: "Fixture Client Satu", bill_id: null, fee_bp: null, base_cents: null, fee_cents: null, reference: null, prepared_at: null, prepared_by: null }],
    updates: { 1: [{ id: 1, kind: "comment", body: "Fixture: client confirmed the EPF statement is coming", old_value: null, new_value: null, task_id: null, document_id: null, author: "Fixture Person", author_role: "sales_marketing", created_at: "2026-11-11 03:00:00" }], 2: [], 3: [] },
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
  /* v1.302.0 - FA 2.0 phase 5: the agreement library, the draft and the fee (rules proven by tests/fa-agreements.mjs) */
  const p5 = p5Route(p, method, b, c);
  if (p5) return p5;
  if (p === "/staff/fa/summary") {
    const open = fa.cases.filter((x) => x.stage !== "closed");
    const rows = caseRows().filter((x) => x.stage !== "closed");
    const act = rows.filter((x) => x.prescreen === "incomplete" || x.banker_status === "documents_required" || ["request_info", "concern"].includes(x.review_action) || (x.next_follow_up && x.next_follow_up <= mytDay()));
    return [200, { open: open.length, awaiting_banker: open.filter((x) => ["enquiry_sent", "under_review"].includes(x.banker_status)).length, incomplete: open.filter((x) => x.prescreen === "incomplete").length, official_decisions: 0,
      active: open.length, requiring_action: act.length, reviews: rows.filter((x) => x.review_pending).length, banker_pending: open.filter((x) => ["enquiry_sent", "under_review"].includes(x.banker_status)).length,
      legal: LEGAL, can: { create: c.edit, decide: c.decide, criteria: c.decide } }];
  }
  if (p === "/staff/fa/cases" && method === "GET") return [200, { cases: caseRows(), me: ROLE() === "sales_marketing" ? 9001 : 1 }];
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
      can: { edit: c.edit, decide: c.decide, note: c.edit, allocate: c.allocate, priority: c.priority }, legal: LEGAL,
      ops: { ...(fa.ops[id] ?? {}), priority_by_name: fa.ops[id]?.priority_override ? "Fixture Manager" : null }, updates: [...(fa.updates[id] ?? [])].reverse(), ready: true, row: caseRows().find((x) => x.id === id) ?? null,
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
    /* v1.299.0 - the case update and the priority override, as the server answers (rules proven by tests/fa-case-ops.mjs) */
    if (sub === "updates" && method === "POST") {
      const add = (kind, x) => fa.updates[id].push({ id: 500 + fa.posts.length * 10 + fa.updates[id].length, kind, body: x.body ?? null, old_value: x.old ?? null, new_value: x.now ?? null, task_id: x.task ?? null, document_id: x.doc ?? null, author: "Fixture Person", author_role: ROLE(), created_at: mytNow() });
      const o = (fa.ops[id] ??= {});
      if (b.follow_up_on !== undefined && (!b.follow_up_on || b.follow_up_on < mytDay() || String(b.follow_up_title ?? "").trim().length < 3)) return [400, { error: { code: "invalid_input", message: "A follow-up date is today or later, and says what it is." } }];
      if (b.waiting_on === "paused" && !c.decide) return [403, { error: { code: "forbidden", message: "Only management pauses a case." } }];
      if (b.comment) add("comment", { body: b.comment });
      let task = null;
      if (b.follow_up_on) { task = 900 + fa.posts.length; fa.tasks[id].push({ id: task, title: `${k.case_ref}: ${b.follow_up_title}`, deadline: b.follow_up_on, status: "pending", assignee: "Fixture Person" }); add("follow_up", { body: b.follow_up_title, now: b.follow_up_on, task }); }
      if (b.document_id !== undefined) add("document", { doc: b.document_id });
      if (b.blocker !== undefined) { add("blocker", { old: o.blocker ?? null, now: b.blocker ? `${b.blocker}${b.blocker_urgent ? " (urgent)" : ""}` : null }); o.blocker = b.blocker || null; o.blocker_urgent = b.blocker && b.blocker_urgent ? 1 : 0; }
      if (b.next_action !== undefined) { add("next_action", { old: o.next_action ?? null, now: b.next_action || null }); o.next_action = b.next_action || null; }
      if (b.waiting_on !== undefined) { add("waiting_on", { old: o.waiting_on ?? null, now: b.waiting_on || null }); o.waiting_on = b.waiting_on || null; }
      return [201, { ok: true, task_id: task }];
    }
    if (sub === "priority" && method === "PUT") {
      if (!c.priority) return [403, { error: { code: "forbidden", message: "Only management overrides a case's priority" } }];
      if (String(b.reason ?? "").trim().length < 10) return [400, { error: { code: "invalid_input", message: "Give the reason (at least 10 characters)." } }];
      const o = (fa.ops[id] ??= {});
      fa.updates[id].push({ id: 700 + fa.posts.length, kind: "priority", body: b.reason, old_value: o.priority_override ?? null, new_value: b.priority ?? null, task_id: null, document_id: null, author: "Fixture Manager", author_role: ROLE(), created_at: mytNow() });
      Object.assign(o, { priority_override: b.priority || null, priority_reason: b.priority ? b.reason : null, priority_at: b.priority ? mytNow() : null });
      return [200, { ok: true }];
    }
    if (sub === "agreement") return [409, { error: { code: "legal_gate", message: "Switched off until legal review and the CEO's separate approval." } }];
    if (sub === "fee") return [409, { error: { code: "fee_after_disbursement", message: "Billed only after a recorded disbursement, through Sales." } }];
    if (method !== "GET") return [method === "POST" ? 201 : 200, { ok: true }];
  }
  /* v1.301.0 - FA 2.0 phase 4: the state as the server shows it (worker/src/fa.ts criterionShows), and the routes' answers (rules proven by tests/fa-criteria2.mjs) */
  const shows = (x) => x.state === "retired" ? "archived" : x.category === "banker_indicative" ? "indicative" : x.state === "draft" ? "draft" : x.expires_on && x.expires_on < mytDay() ? "expired"
    : (!x.last_verified_on || (Date.parse(mytDay()) - Date.parse(x.last_verified_on)) / 864e5 > 90 || (x.review_due_on && x.review_due_on < mytDay())) ? "review_required" : "verified";
  if (p === "/staff/fa/criteria" && method === "GET") return [200, { criteria: fa.criteria.map((x) => ({ ...x, shows: shows(x) })), can: { propose: c.edit, verify: c.decide }, me: ROLE() === "sales_marketing" ? 9001 : 1 }];
  if (p === "/staff/fa/criteria" && method === "POST") {
    if (!["high", "medium", "low"].includes(b.confidence)) return [400, { error: { code: "invalid_input", message: "Say how sure this rule is." } }];
    const bank = fa.banks.find((x) => x.id === b.bank_id);
    const id = 10 + fa.criteria.length;
    fa.criteria.push({ id, family: `bank-${b.bank_id}:${b.product}${b.category === "banker_indicative" ? ":indicative" : ""}`, version: 1, bank: bank?.name ?? "?", product: b.product, income_definition: b.income_definition ?? "net", commitment_definition: b.commitment_definition ?? "all", dsr_guideline_bp: b.dsr_guideline_pct ? Math.round(b.dsr_guideline_pct * 100) : null, min_income_cents: b.min_income_cents ?? null,
      employment_categories: null, min_service_months: null, required_documents: null, source: b.source, last_verified_on: null, state: "draft", category: b.category ?? "official", confidence: b.confidence, review_due_on: b.review_due_on ?? null, expires_on: b.expires_on ?? null,
      source_banker: b.banker_id ? fa.bankers.find((x) => x.id === b.banker_id)?.full_name ?? null : null, heard_on: b.heard_on ?? null, channel: b.channel ?? null, exact_feedback: b.exact_feedback ?? null, created_by_name: "Fixture Person", created_by: ROLE() === "sales_marketing" ? 9001 : 1 });
    return [201, { ok: true, id }];
  }
  const cr = p.match(/^\/staff\/fa\/criteria\/(\d+)\/(verify|retire|request-verification)$/);
  if (cr && method === "POST") {
    const x = fa.criteria.find((y) => y.id === Number(cr[1]));
    if (!x) return [404, { error: { code: "not_found", message: "Criterion not found" } }];
    if (cr[2] === "request-verification") return x.state === "draft" ? [200, { ok: true, notified: 2 }] : [409, { error: { code: "invalid_state", message: "Only a draft waits for verification." } }];
    if (!c.decide) return [403, { error: { code: "forbidden", message: "Only management verifies bank criteria" } }];
    if (cr[2] === "verify") {
      if (x.category === "banker_indicative") return [409, { error: { code: "indicative_not_official", message: "A banker's indicative words are not the bank's official rule." } }];
      Object.assign(x, { state: "verified", last_verified_on: b.last_verified_on, verified_by_name: "Fixture Manager", ...(b.review_due_on ? { review_due_on: b.review_due_on } : {}) });
    } else x.state = "retired";
    return [200, { ok: true }];
  }
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

/* v1.302.0 - phase 5 answers: management drafts (CEO, COO, CCO), the CEO publishes; Sales see published versions only */
function p5Route(p, method, b, c) {
  const drafter = ["ceo", "coo", "cco"].includes(ROLE()), publisher = ROLE() === "ceo";
  const withCheck = (v) => ({ ...v, check: TPL.checkTemplate(v.body, v.fee_bp) });
  if (p === "/staff/fa/templates" && method === "GET") return [200, { templates: fa.templates, versions: fa.versions.filter((v) => drafter || v.state === "approved").map(withCheck), fields: TPL.MERGE_FIELDS, me: 1, owner: ROLE() === "ceo", can: { draft: drafter, publish: publisher }, legal: LEGAL }];
  if (p === "/staff/fa/templates" && method === "POST") {
    if (!drafter) return [403, { error: { code: "forbidden", message: "Only management drafts agreement templates" } }];
    const id = 1 + Math.max(...fa.templates.map((t) => t.id));
    fa.templates.push({ id, name: b.name, issuer_code: b.issuer_code, service_type: b.service_type, created_by_name: "Fixture Person" });
    return [201, { ok: true, id }];
  }
  const nv = p.match(/^\/staff\/fa\/templates\/(\d+)\/versions$/);
  if (nv && method === "POST") {
    if (!drafter) return [403, { error: { code: "forbidden", message: "Only management drafts agreement templates" } }];
    const tid = Number(nv[1]), id = 1 + Math.max(...fa.versions.map((v) => v.id)), version = 1 + Math.max(0, ...fa.versions.filter((v) => v.template_id === tid).map((v) => v.version));
    const from = fa.versions.find((v) => v.id === b.from_version_id);
    const body = from ? from.body : b.docx_base64 ? "# UPLOADED FIXTURE\n\nThe uploaded fixture text for {{client_name}}." : String(b.body ?? "");
    fa.versions.unshift({ ...fa.versions[0], id, template_id: tid, version, format: b.docx_base64 ? "docx" : "text", body, fee_bp: from?.fee_bp ?? b.fee_bp ?? null, state: "draft", created_by: 1, created_by_name: "Fixture Person", legal_basis: null, published_at: null, archived_at: null, archived_reason: null });
    return [201, { ok: true, id, version, check: TPL.checkTemplate(body, from?.fee_bp ?? null) }];
  }
  const ov = p.match(/^\/staff\/fa\/templates\/versions\/(\d+)(?:\/(submit|publish|archive))?$/);
  if (ov) {
    const v = fa.versions.find((x) => x.id === Number(ov[1]));
    if (!v) return [404, { error: { code: "not_found", message: "Template version not found" } }];
    if (!ov[2] && method === "PUT") { if (v.state !== "draft") return [409, { error: { code: "invalid_state", message: "Only a draft is edited." } }]; Object.assign(v, { body: b.body ?? v.body, fee_bp: b.fee_bp === undefined ? v.fee_bp : b.fee_bp }); return [200, { ok: true, check: TPL.checkTemplate(v.body, v.fee_bp) }]; }
    if (ov[2] === "submit") { const ck = TPL.checkTemplate(v.body, v.fee_bp); if (!ck.ok) return [422, { error: { code: "template_check", message: "The template is not ready.", check: ck } }]; v.state = "review"; return [200, { ok: true }]; }
    if (ov[2] === "publish") {
      if (!publisher) return [403, { error: { code: "forbidden", message: "Only the CEO publishes an agreement template" } }];
      for (const x of fa.versions) if (x.template_id === v.template_id && x.state === "approved") Object.assign(x, { state: "archived", archived_reason: `Superseded by version ${v.version}` });
      Object.assign(v, { state: "approved", legal_basis: b.legal_basis, legal_reviewer: b.legal_reviewer ?? null, legal_firm: b.legal_firm ?? null, legal_reviewed_on: b.legal_reviewed_on ?? null, legal_reference: b.legal_reference ?? null, published_by_name: "Fixture Owner", published_at: mytNow() });
      return [200, { ok: true }];
    }
    if (ov[2] === "archive") { Object.assign(v, { state: "archived", archived_reason: b.reason }); return [200, { ok: true }]; }
  }
  if (p === "/staff/fa/fees" && method === "GET") return [200, { fees: fa.fees.map((f) => ({ ...f, billable: !!f.has_evidence && f.approved_cents > 0 && !f.corrected })), fee_line: TPL.FEE_LINE, legal: LEGAL }];
  const ag = p.match(/^\/staff\/fa\/cases\/(\d+)\/(agreement\/preview|fee)$/);
  if (!ag) return null;
  const k = fa.cases.find((x) => x.id === Number(ag[1]));
  if (!k) return [404, { error: { code: "not_found", message: "Case not found" } }];
  if (ag[2] === "fee") {
    const f = fa.fees.find((x) => x.case_id === k.id);
    if (!f) return [409, { error: { code: "fee_after_disbursement", message: "Billed only after a recorded disbursement, through Sales." } }];
    const v = fa.versions.find((x) => x.id === b.version_id) ?? fa.versions.find((x) => x.id === f.version_id);
    if (!f.bill_id) Object.assign(f, { bill_id: 1, version_id: v.id, fee_bp: v.fee_bp, base_cents: f.approved_cents, fee_cents: TPL.feeOf(f.approved_cents, v.fee_bp), reference: `FA-FEE ${k.case_ref}`, prepared_at: mytNow(), prepared_by: "Fixture Person" });
    return [201, { ok: true, bill: f, prefill: { source: "fa_fee", company: k.client, reference: f.reference, doc_type: "QT", issuer: k.issuer_code, items: [{ name: TPL.FEE_LINE, qty: 1, unit_price_cents: f.fee_cents, sub: [`Case ${k.case_ref}`] }] } }];
  }
  const v = fa.versions.find((x) => x.id === b.version_id);
  if (!v) return [400, { error: { code: "invalid_input", message: "Choose a published template version." } }];
  let ic = k.id === 1 ? "••••••-••-5678" : null;
  if (b.full_ic) { if (String(b.full_ic).replace(/\D/g, "") !== "880101145678") return [400, { error: { code: "ic_mismatch", message: "That IC is not the one on the client's profile." } }]; ic = "880101-14-5678"; }
  const values = { client_name: k.client, ic_number: ic, client_phone: null, client_email: k.id === 1 ? "satu@fixture-client.test" : null, client_address: null, case_ref: k.case_ref, service_type: "Personal financing advisory", company_name: k.issuer_code === "a2z" ? "A2Z CREATIVE MARKETING" : "AZ ONE OFFICIAL", company_registration: "Fixture SSM 000000", company_address: null, agreement_date: "13-11-2026", fee_rate: v.fee_bp ? `${(v.fee_bp / 100).toFixed(2)}%` : null, bank_name: null, disbursed_amount: null, fee_amount: null };
  const m = TPL.mergeBlocks(v.body, values);
  const fields = TPL.fieldsIn(v.body).map((key) => ({ key, label: TPL.MERGE_FIELDS[key], value: values[key] ?? null, masked: key === "ic_number" && !b.full_ic && !!values[key], missing: !values[key] }));
  return [200, { blocks: m.blocks, fields, missing: m.missing, ready: v.state === "approved" && !m.missing.length, draft: true, draft_id: null, sha256: null, version: { id: v.id, version: v.version, name: fa.templates.find((t) => t.id === v.template_id)?.name, state: v.state, fee_bp: v.fee_bp }, company: { name: values.company_name, registration: values.company_registration }, case_ref: k.case_ref, legal: LEGAL }];
}

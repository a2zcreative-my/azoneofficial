/* v1.284.0 - FA=1: Financial Advisory for the browser fixture (serve.mjs).
   INVENTED test data only - the names say "Fixture" and the figures are the
   brief's own worked example (RM 5,000 net, RM 2,000 commitments, RM 500
   instalment: 40% now, 50% projected). The server's rules live in
   worker/src/fa.ts and are proven by tests/fa-api.mjs; this only lets the
   screens be drawn and clicked at every width. */

const ROLE = () => process.env.ROLE ?? "ceo";
const caps = () => {
  const r = ROLE();
  return { view: ["ceo", "coo", "cco", "sales_marketing"].includes(r), edit: ["ceo", "coo", "cco", "sales_marketing"].includes(r), decide: ["ceo", "coo"].includes(r) };
};
const LEGAL = { agreement: false, fee: false, disclosure: false, commission: false };
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
const people = { owner: { id: 9001, name: "Fixture Person" } };

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
      1: [{ id: 1, kind: "privacy_notice", notice_version: "v1-draft", institution: null, documents: null, captured_how: "signed_form", given_at: "2026-11-10", withdrawn_at: null, withdrawn_note: null }, { id: 2, kind: "assessment", notice_version: "v1-draft", institution: null, documents: null, captured_how: "signed_form", given_at: "2026-11-10", withdrawn_at: null, withdrawn_note: null }],
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
    contacts: [{ id: 1, bank: "Fixture Bank A", contact_name: "Fixture Banker", contact_role: "Relationship manager", branch: "Fixture Branch", channel: "banker@fixture.test", channel_confirmed: 1, relationship: "active", owner: "Fixture Person" }],
    log: { 1: [{ id: 1, channel: "call", summary: "Introduced A2Z; agreed to send enquiries only with consent.", created_at: "2026-11-05 02:00:00", actor: "Fixture Person" }] },
    posts: [],
  };
}
export const fa = freshState();
export const resetFa = () => Object.assign(fa, freshState());

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
      can: { edit: c.edit, decide: c.decide, note: c.edit }, legal: LEGAL,
    }];
    if (sub === "notes" && method === "POST") {
      if (b.type === "banker" && !["enquiry_sent", "under_review", "indicatively_suitable", "documents_required", "not_supported"].includes(b.status)) return [400, { error: { code: "invalid_input", message: "A banker's feedback is never an approval." } }];
      if (b.type === "decision" && !c.decide) return [403, { error: { code: "forbidden", message: "Only management records an official decision" } }];
      if (b.type === "decision" && !b.evidence_id) return [400, { error: { code: "evidence_required", message: "Attach the bank's letter." } }];
      fa.notes[id].unshift({ id: 50 + fa.posts.length, note_type: b.type, bank: b.bank, source: b.source ?? null, status_value: b.status, body: b.body, conditions: b.conditions ?? null, missing_documents: b.missing_documents ?? null, follow_up_on: b.follow_up_on ?? null, bank_reference: b.bank_reference ?? null, approved_cents: b.approved_cents ?? null, evidence_id: b.evidence_id ?? null, corrects_id: null, author: "Fixture Person", author_role: ROLE(), created_at: "2026-11-11 06:30:00" });
      if (b.type === "banker") k.banker_status = b.status; else k.application_status = b.status;
      return [201, { ok: true }];
    }
    if (["agreement", "fee", "disclosures"].includes(sub)) return [409, { error: { code: "legal_gate", message: "Switched off until counsel clears it." } }];
    if (method !== "GET") return [method === "POST" ? 201 : 200, { ok: true }];
  }
  if (p === "/staff/fa/criteria" && method === "GET") return [200, { criteria: fa.criteria, can: { propose: c.edit, verify: c.decide } }];
  if (p === "/staff/fa/contacts" && method === "GET") return [200, { contacts: fa.contacts, can: { manage: c.decide, log: c.edit } }];
  const lg = p.match(/^\/staff\/fa\/contacts\/(\d+)\/log$/);
  if (lg && method === "GET") return [200, { log: fa.log[Number(lg[1])] ?? [] }];
  if (method !== "GET") return [method === "POST" ? 201 : 200, { ok: true }];
  return null;
}

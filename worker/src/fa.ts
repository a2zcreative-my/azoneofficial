/* v1.284.0 - FINANCIAL ADVISORY, RELEASE 1 (the CEO, 11-11-2026: "proceed
   with Financial Advisory" on claude/FINANCIAL-ADVISORY-BLUEPRINT.md;
   decisions F1, F2, F3, F9, F11-F13 as recommended). INTERNAL USE ONLY.

   One module on the existing OS: the client is a `customers` row; the
   financial data lives in the restricted fa_* tables (migration 0183) and is
   read only through these routes, which check the role (fa_* caps) AND the
   case's own scope on every request:
     fa_decide holders (CEO, COO)  every case
     the case owner                their own cases
     assisting members             read, and banker-feedback notes
   Nobody else - not HR, not admin, not an agent - gets a byte of it.

   LEGAL GATES (Gate 0, L1-L10): the client agreement, the proposed fee,
   disclosure of client data to a bank (and so a formal application) and any
   commission are OFF IN CODE until counsel clears them. They are constants,
   not settings: switching one on is a reviewed release, never a click.

   The engine is fa-engine.ts. Rules here:
     - no profile, item or document before a live privacy-notice AND
       assessment consent;
     - a request carrying anything shaped like a password, OTP, PIN or
       online-banking login is refused;
     - the IC is stored masked plus a keyed hash (duplicate check), never whole;
     - notes are append only (triggers); a banker's feedback can never set an
       approval; an official decision needs the bank's document;
     - an override needs fa_decide, a reason and keeps the computed result;
     - tasks are the existing tasks (link_kind 'fa_case'); notifications
       carry the case reference only, never a figure or a name. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify } from "./staff";
import { json, err, audit, str, putGuarded } from "./shared";
import { can } from "./permissions";
import { handleFaRegistry } from "./fa-registry";
import { assess, ENGINE_VERSION, type FaItem, type FaCriterion, type Product } from "./fa-engine";
import { isExecutiveOwner } from "./decision-policy";
import { handleFaMatch } from "./fa-match";
import { priorityOf, PRIORITIES, type Priority } from "./fa-priority";

/** Off until counsel clears each one (blueprint section 4). A constant on purpose. */
/* v1.288.0 - the CEO, 12-11-2026, decision D5 of DSR blueprint v1.2: "proceed
   without lawyers" - sending a client's documents to an ALLOCATED, verified
   banker opens, behind the client's own disclosure consent naming that bank
   and those documents, a management Proceed and an approved allocation
   (worker/src/fa-match.ts). The agreement, the fee and commission stay off. */
/* v1.298.0 - the CEO, 13-11-2026, FA 2.0 blueprint: "approve as per
   recommendation, fees switched without waiting for lawyer". The FEE is on, by
   his decision and without a legal review (recorded so). What still holds: no
   rate is written in code (it is set on an agreement template, Phase 5); a fee
   is billed only after a disbursement is recorded with the bank's evidence and
   only through the existing quotation -> invoice -> CEO payment verification;
   never from an estimated eligibility; no CTOS, blacklisting or penalty. The
   client agreement (sending, signing) and commission stay OFF. */
export const FA_LEGAL = { agreement: false, fee: true, disclosure: true, commission: false } as const;

const PRODUCTS = ["personal_financing", "debt_consolidation", "advisory_only"] as const;
const STAGES = ["intake", "profile", "prescreen", "review", "matching", "agreement", "enquiry", "application", "decision", "disbursed", "fee", "closed"] as const;
/** where a case may go from each stage by hand (closing is always allowed, with a reason) */
const NEXT: Record<string, string[]> = {
  intake: ["profile"], profile: ["prescreen"], prescreen: ["profile", "review", "matching"], review: ["profile", "matching"],
  matching: ["review", "profile"], agreement: ["matching"], enquiry: ["matching"], application: [], decision: [], disbursed: [], fee: [], closed: [],
};
const OUTCOMES = ["incomplete", "potentially_suitable", "manual_review", "affordability_concern", "no_product"];
const BANKER_STATUS = ["enquiry_sent", "under_review", "indicatively_suitable", "documents_required", "not_supported"];
const DECISIONS = ["conditional_offer", "officially_approved", "declined", "disbursed"];
const SIDES = ["income", "deduction", "commitment", "expense"];
const KINDS: Record<string, string[]> = {
  income: ["gross_salary", "net_salary", "allowance", "other_income"],
  deduction: ["epf", "socso", "eis", "tax", "zakat", "other_deduction"],
  commitment: ["personal_financing", "car", "housing", "credit_card", "ptptn", "bnpl", "other_bank", "non_bank", "other"],
  expense: ["food", "rent", "utilities", "transport", "dependants", "insurance", "other"],
};
const SOURCES = ["declared", "payslip", "bank_statement", "epf", "facility_statement", "ccris_by_client", "ctos_by_client", "letter", "other"];
const DOC_KINDS = ["ic", "payslip", "bank_statement", "epf", "facility_statement", "settlement_letter", "ccris_by_client", "ctos_by_client", "consent", "bank_decision", "disbursement", "other"];
const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const DOC_MAX = 8 * 1024 * 1024;
/** anything shaped like a credential is refused, wherever it sits in the body */
const CREDENTIAL = /pass(word|wd)|otp|\bpin\b|tac\b|login|credential|secret|security.?(code|question)|online.?banking/i;

/** v1.298.0 (D-1) - flat or reducing; anything else is the reducing annuity, as before */
const rateType = (v: unknown): "flat" | "reducing" => (v === "flat" ? "flat" : "reducing");
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const validDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const skew = (e: unknown) => /no such (table|column)/i.test(String(e));
const cents = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000_000 ? v : null);
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;

export interface Case {
  id: number; case_ref: string | null; customer_id: number; owner_id: number; agent_request_id: number | null; issuer_code: string; product: Product;
  purpose: string | null; stage: string; prescreen: string; banker_status: string; application_status: string; override_result: string | null;
  override_reason: string | null; closed_reason: string | null; created_at: string; updated_at: string;
}

const isAll = (u: StaffUser) => can(u.role, "fa_decide");
/* v1.298.0 - FA 2.0: what "waiting for management review" and "requires action" mean, in SQL on fa_cases c (no figure, no name) */
const REVIEW_PENDING = `COALESCE((SELECT r.action FROM fa_reviews r WHERE r.case_id = c.id ORDER BY r.id DESC LIMIT 1), '') = 'submitted'`;
const NEEDS_ACTION = `c.prescreen = 'incomplete' OR c.banker_status = 'documents_required'
  OR COALESCE((SELECT r.action FROM fa_reviews r WHERE r.case_id = c.id ORDER BY r.id DESC LIMIT 1), '') IN ('request_info', 'concern')
  OR EXISTS (SELECT 1 FROM tasks t WHERE t.link_kind = 'fa_case' AND t.link_id = c.id AND t.status != 'completed' AND t.deadline IS NOT NULL AND substr(t.deadline, 1, 10) <= date('now', '+8 hours'))`;

async function caseOf(env: Env, id: number): Promise<Case | null> {
  return env.DB.prepare(`SELECT * FROM fa_cases WHERE id = ?1`).bind(id).first<Case>();
}
async function isMember(env: Env, caseId: number, userId: number): Promise<boolean> {
  return !!(await env.DB.prepare(`SELECT 1 AS x FROM fa_case_members WHERE case_id = ?1 AND user_id = ?2`).bind(caseId, userId).first());
}
/** may read the case: fa_view + (all, owner or member) */
async function mayOpen(env: Env, u: StaffUser, c: Case): Promise<boolean> {
  if (!can(u.role, "fa_view")) return false;
  return isAll(u) || c.owner_id === u.id || (await isMember(env, c.id, u.id));
}
/** may change the client's figures: fa_edit + (all or owner); assisting members may not */
const mayEdit = (u: StaffUser, c: Case) => can(u.role, "fa_edit") && (isAll(u) || c.owner_id === u.id);

async function event(env: Env, caseId: number, ev: string, actor: number | null, detail: Record<string, unknown> | null = null, key: string | null = null): Promise<void> {
  await env.DB.prepare(`INSERT OR IGNORE INTO fa_events (case_id, event, actor_id, detail, event_key) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(caseId, ev, actor, detail ? JSON.stringify(detail) : null, key).run();
}
async function touch(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`UPDATE fa_cases SET updated_at = datetime('now') WHERE id = ?1`).bind(id).run();
}
async function liveConsent(env: Env, caseId: number, kind: string, institution: string | null = null): Promise<boolean> {
  const r = await env.DB.prepare(
    `SELECT 1 AS x FROM fa_consents WHERE case_id = ?1 AND kind = ?2 AND withdrawn_at IS NULL AND (expires_at IS NULL OR expires_at >= ?3)
        AND (?4 IS NULL OR LOWER(institution) = LOWER(?4)) LIMIT 1`,
  ).bind(caseId, kind, mytToday(), institution).first();
  return !!r;
}
async function consentsReady(env: Env, caseId: number): Promise<boolean> {
  return (await liveConsent(env, caseId, "privacy_notice")) && (await liveConsent(env, caseId, "assessment"));
}
function hasCredential(body: unknown, depth = 0): boolean {
  if (!body || typeof body !== "object" || depth > 3) return false;
  return Object.entries(body as Record<string, unknown>).some(([k, v]) => CREDENTIAL.test(k) || (typeof v === "object" && hasCredential(v, depth + 1)));
}
async function icHash(env: Env, digits: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${env.SESSION_PEPPER}:fa-ic`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(digits));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const maskIc = (d: string) => `••••••-••-${d.slice(-4)}`;
async function docOnCase(env: Env, caseId: number, docId: unknown): Promise<number | null> {
  if (typeof docId !== "number" || !Number.isInteger(docId)) return null;
  const r = await env.DB.prepare(`SELECT id FROM fa_documents WHERE id = ?1 AND case_id = ?2 AND removed_at IS NULL`).bind(docId, caseId).first<{ id: number }>();
  return r?.id ?? null;
}
async function liveCriteria(env: Env): Promise<FaCriterion[]> {
  /* v1.286.0 - the registry bank and the ranges live beside the criterion (0184 fa_criteria_terms) */
  return ((await env.DB.prepare(
    `SELECT c.*, t.bank_id, t.bank_product_id, t.min_age, t.max_age, t.min_amount_cents, t.max_amount_cents, t.min_tenure_months, t.max_tenure_months
       FROM fa_criteria c LEFT JOIN fa_criteria_terms t ON t.criterion_id = c.id ORDER BY c.bank, c.family, c.version`,
  ).all<FaCriterion>()).results ?? []);
}

/** v1.288.0 - where a case stands with Management: the last submission, and the decision on it (if any) */
export async function reviewState(env: Env, caseId: number): Promise<{ pending: boolean; submitted_id: number | null; submitted_by: number | null; assessment_id: number | null; decision: string | null; decided_at: string | null }> {
  const last = await env.DB.prepare(`SELECT id, action, actor_id, assessment_id, created_at FROM fa_reviews WHERE case_id = ?1 ORDER BY id DESC LIMIT 1`).bind(caseId).first<{ id: number; action: string; actor_id: number; assessment_id: number | null; created_at: string }>();
  if (!last) return { pending: false, submitted_id: null, submitted_by: null, assessment_id: null, decision: null, decided_at: null };
  if (last.action === "submitted") return { pending: true, submitted_id: last.id, submitted_by: last.actor_id, assessment_id: last.assessment_id, decision: null, decided_at: null };
  const sub = await env.DB.prepare(`SELECT id, actor_id FROM fa_reviews WHERE case_id = ?1 AND action = 'submitted' AND id < ?2 ORDER BY id DESC LIMIT 1`).bind(caseId, last.id).first<{ id: number; actor_id: number }>();
  return { pending: false, submitted_id: sub?.id ?? null, submitted_by: sub?.actor_id ?? null, assessment_id: last.assessment_id, decision: last.action, decided_at: last.created_at };
}

/** The whole case, for someone who may open it. */
async function picture(env: Env, u: StaffUser, c: Case) {
  const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).all().then((r) => r.results ?? []);
  const customer = await env.DB.prepare(`SELECT id, company AS name, contact_person, phone, email FROM customers WHERE id = ?1`).bind(c.customer_id).first();
  const profile = await env.DB.prepare(`SELECT id, version, employment_status, employment_category, employer_type, service_months, salary_pattern, dependants, age_years, ic_masked, created_at FROM fa_profiles WHERE case_id = ?1 ORDER BY version DESC LIMIT 1`).bind(c.id).first();
  const assessments = await q(`SELECT a.id, a.ruleset, a.result, a.current_dsr_bp, a.projected_dsr_bp, a.outcome, a.created_at, ${PERSON("u")} AS by_name FROM fa_assessments a LEFT JOIN users u ON u.id = a.created_by WHERE a.case_id = ?1 ORDER BY a.id DESC LIMIT 10`, c.id);
  const owner = await env.DB.prepare(`SELECT id, ${PERSON("u")} AS name FROM users u WHERE id = ?1`).bind(c.owner_id).first();
  return {
    case: c, customer, owner, profile,
    items: await q(`SELECT * FROM fa_items WHERE case_id = ?1 ORDER BY side, id`, c.id),
    documents: await q(`SELECT d.id, d.kind, d.content_type, d.size_bytes, d.doc_date, d.verified, d.uploaded_at, ${PERSON("u")} AS by_name FROM fa_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.case_id = ?1 AND d.removed_at IS NULL ORDER BY d.id DESC`, c.id),
    consents: await q(`SELECT id, kind, notice_version, institution, documents, captured_how, given_at, expires_at, withdrawn_at, withdrawn_note, recorded_at FROM fa_consents WHERE case_id = ?1 ORDER BY id`, c.id),
    assessments,
    /* v1.290.0 - with the day of the contact and the tenure the letter states (0186) */
    notes: await q(`SELECT n.*, ${PERSON("u")} AS author, f.contact_on, f.tenure_months, l.banker_id AS linked_banker_id FROM fa_notes n LEFT JOIN users u ON u.id = n.author_id LEFT JOIN fa_note_facts f ON f.note_id = n.id LEFT JOIN fa_note_links l ON l.note_id = n.id WHERE n.case_id = ?1 ORDER BY n.id DESC`, c.id),
    events: await q(`SELECT e.id, e.event, e.detail, e.created_at, ${PERSON("u")} AS actor FROM fa_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.case_id = ?1 ORDER BY e.id`, c.id),
    tasks: await q(`SELECT t.id, t.title, t.deadline, t.status, ${PERSON("u")} AS assignee FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.link_kind = 'fa_case' AND t.link_id = ?1 ORDER BY t.id DESC`, c.id),
    members: await q(`SELECT m.user_id, ${PERSON("u")} AS name FROM fa_case_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.case_id = ?1`, c.id),
    /* v1.288.0 - the management review history (append only), the commitment details, the banker allocations */
    reviews: await q(`SELECT r.id, r.assessment_id, r.action, r.reason, r.next_action, r.actor_id, r.actor_role, r.created_at, ${PERSON("u")} AS actor FROM fa_reviews r LEFT JOIN users u ON u.id = r.actor_id WHERE r.case_id = ?1 ORDER BY r.id DESC`, c.id),
    item_meta: await q(`SELECT m.* FROM fa_item_meta m JOIN fa_items i ON i.id = m.item_id WHERE i.case_id = ?1`, c.id),
    allocations: await q(`SELECT a.id, a.product, a.bank_id, a.banker_id, a.branch_id, a.role, a.state, a.reason, a.created_by, a.created_at, a.decided_at, k.name AS bank, bk.full_name AS banker, br.name AS branch,
        e.id AS enquiry_id, e.state AS enquiry_state, e.sent_at
        FROM fa_allocations a JOIN fa_banks k ON k.id = a.bank_id JOIN fa_bankers bk ON bk.id = a.banker_id LEFT JOIN fa_branches br ON br.id = a.branch_id LEFT JOIN fa_enquiries e ON e.allocation_id = a.id
       WHERE a.case_id = ?1 ORDER BY a.id DESC`, c.id),
    disclosures: await q(`SELECT x.id, x.enquiry_id, x.document_id, x.channel, x.recipient, x.purpose, x.sent_at, d.kind AS document_kind, ${PERSON("u")} AS sent_by FROM fa_disclosures x LEFT JOIN fa_documents d ON d.id = x.document_id LEFT JOIN users u ON u.id = x.sent_by WHERE x.case_id = ?1 ORDER BY x.id DESC`, c.id),
    review: await reviewState(env, c.id),
    /* v1.299.0 - FA 2.0 phase 2: priority (computed, and any override), waiting-on, blocker, next action, the update history */
    ...(await opsOf(env, c.id)),
    row: (await caseRows(env, "c.id = ?1", [c.id]))[0] ?? null,
    can: { edit: mayEdit(u, c), decide: can(u.role, "fa_decide"), allocate: can(u.role, "fa_allocate"), note: can(u.role, "fa_edit") || (await isMember(env, c.id, u.id)), priority: can(u.role, "fa_priority") && (c.owner_id !== u.id || isExecutiveOwner(u)) },
    legal: FA_LEGAL,
  };
}

export async function handleFa(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams, request: Request): Promise<Response | null> {
  if (!path.startsWith("/fa/")) return null;
  if (!can(user.role, "fa_view")) return err("forbidden", "Financial Advisory is not open to your role", 403);
  if (body && hasCredential(body)) {
    await audit(env, user.id, "fa.credential_refused", "fa", path, { path });
    return err("credential_refused", "Never record a password, OTP, PIN or online-banking login. Remove that field.", 400);
  }
  try {
    return await route(env, path, method, body, user, params, request);
  } catch (e) {
    if (skew(e)) return err("migration_missing", "Run migrations 0183 and 0184 first (PUSH.bat).", 503);
    throw e;
  }
}

/* v1.299.0 - FA 2.0: the case list as one query, used by the pipeline and by
   a single case. Before migrations 0189-0190 are applied it falls back to the
   Phase 1 columns (no priority override, no waiting-on), never a broken page. */
async function caseRows(env: Env, where: string, binds: unknown[]): Promise<Record<string, unknown>[]> {
  const sqlOf = (ops: boolean) => `SELECT c.id, c.case_ref, c.product, c.stage, c.prescreen, c.banker_status, c.application_status, c.override_result, c.issuer_code, c.updated_at,
              cu.company AS client, ${PERSON("u")} AS owner,
              (SELECT a.projected_dsr_bp FROM fa_assessments a WHERE a.case_id = c.id ORDER BY a.id DESC LIMIT 1) AS projected_dsr_bp,
              (SELECT a.current_dsr_bp FROM fa_assessments a WHERE a.case_id = c.id ORDER BY a.id DESC LIMIT 1) AS current_dsr_bp,
              c.owner_id, c.created_at,
              /* v1.298.0 - FA 2.0: the next follow-up is the case's earliest open TASK (the Tasks module, never a second engine) */
              (SELECT t.deadline FROM tasks t WHERE t.link_kind = 'fa_case' AND t.link_id = c.id AND t.status != 'completed' AND t.deadline IS NOT NULL ORDER BY t.deadline, t.id LIMIT 1) AS next_follow_up,
              (SELECT t.title FROM tasks t WHERE t.link_kind = 'fa_case' AND t.link_id = c.id AND t.status != 'completed' ORDER BY CASE WHEN t.deadline IS NULL THEN 1 ELSE 0 END, t.deadline, t.id LIMIT 1) AS next_task,
              (SELECT ${PERSON("tu")} FROM tasks t JOIN users tu ON tu.id = t.assigned_to WHERE t.link_kind = 'fa_case' AND t.link_id = c.id AND t.status != 'completed' ORDER BY CASE WHEN t.deadline IS NULL THEN 1 ELSE 0 END, t.deadline, t.id LIMIT 1) AS next_task_owner,
              (SELECT bk.name || ' · ' || bb.full_name FROM fa_allocations al JOIN fa_bankers bb ON bb.id = al.banker_id JOIN fa_banks bk ON bk.id = al.bank_id
                WHERE al.case_id = c.id AND al.state NOT IN ('cancelled', 'reassigned') ORDER BY CASE WHEN al.role = 'primary' THEN 0 ELSE 1 END, al.id DESC LIMIT 1) AS banker,
              CASE WHEN ${REVIEW_PENDING} THEN 1 ELSE 0 END AS review_pending,
              (SELECT r.created_at FROM fa_reviews r WHERE r.case_id = c.id ORDER BY r.id DESC LIMIT 1) AS review_at,
              (SELECT r.action FROM fa_reviews r WHERE r.case_id = c.id ORDER BY r.id DESC LIMIT 1) AS review_action,
              /* v1.299.0 - FA 2.0 phase 2: what the priority is worked out from, and the case's own operations row (0189) */
              (SELECT n.created_at FROM fa_notes n WHERE n.case_id = c.id AND n.note_type = 'banker' AND n.status_value = 'documents_required' ORDER BY n.id DESC LIMIT 1) AS banker_docs_at,
              (SELECT al.state FROM fa_allocations al WHERE al.case_id = c.id AND al.state NOT IN ('cancelled', 'reassigned') ORDER BY CASE WHEN al.role = 'primary' THEN 0 ELSE 1 END, al.id DESC LIMIT 1) AS allocation_state${ops ? `,
              o.waiting_on, o.blocker, o.blocker_urgent, o.next_action AS ops_next_action, o.closed_kind, o.priority_override, o.priority_reason, o.priority_at,
              (SELECT ${PERSON("pu")} FROM users pu WHERE pu.id = o.priority_by) AS priority_by,
              MAX(c.updated_at, COALESCE((SELECT MAX(x.created_at) FROM fa_case_updates x WHERE x.case_id = c.id), c.updated_at)) AS last_update` : `, c.updated_at AS last_update`}
         FROM fa_cases c LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN users u ON u.id = c.owner_id${ops ? " LEFT JOIN fa_case_ops o ON o.case_id = c.id" : ""}
        WHERE ${where} ORDER BY CASE WHEN c.stage = 'closed' THEN 1 ELSE 0 END, c.updated_at DESC LIMIT 500`;
  let rows: Record<string, unknown>[];
  try { rows = ((await env.DB.prepare(sqlOf(true)).bind(...binds).all()).results ?? []) as Record<string, unknown>[]; }
  catch (e) { if (!skew(e)) throw e; rows = ((await env.DB.prepare(sqlOf(false)).bind(...binds).all()).results ?? []) as Record<string, unknown>[]; }
  const today = mytToday();
  return rows.map((r) => {
    const auto = priorityOf({
      stage: String(r.stage), next_follow_up: (r.next_follow_up as string | null) ?? null, review_pending: Number(r.review_pending) === 1, review_at: (r.review_at as string | null) ?? null,
      banker_status: String(r.banker_status), banker_docs_at: (r.banker_docs_at as string | null) ?? null, last_update: (r.last_update as string | null) ?? null,
      waiting_on: (r.waiting_on as string | null) ?? null, blocker_urgent: Number(r.blocker_urgent ?? 0) === 1,
    }, today);
    const over = r.stage !== "closed" && PRIORITIES.includes(r.priority_override as Priority) ? (r.priority_override as Priority) : null;
    return { ...r, priority: over ?? auto?.level ?? null, priority_auto: auto?.level ?? null, priority_why: auto?.reasons ?? [] };
  });
}
async function opsOf(env: Env, caseId: number) {
  try {
    const ops = await env.DB.prepare(`SELECT o.*, ${PERSON("pu")} AS priority_by_name FROM fa_case_ops o LEFT JOIN users pu ON pu.id = o.priority_by WHERE o.case_id = ?1`).bind(caseId).first();
    const updates = (await env.DB.prepare(`SELECT x.id, x.kind, x.body, x.old_value, x.new_value, x.task_id, x.document_id, x.author_role, x.created_at, ${PERSON("u")} AS author FROM fa_case_updates x LEFT JOIN users u ON u.id = x.author_id WHERE x.case_id = ?1 ORDER BY x.id DESC LIMIT 200`).bind(caseId).all()).results ?? [];
    return { ops: ops ?? null, updates, ready: true };
  } catch (e) { if (!skew(e)) throw e; return { ops: null, updates: [], ready: false }; }
}
async function logUpdate(env: Env, caseId: number, u: StaffUser, kind: string, x: { body?: string | null; old?: string | null; now?: string | null; task?: number | null; doc?: number | null }): Promise<void> {
  await env.DB.prepare(`INSERT INTO fa_case_updates (case_id, kind, body, old_value, new_value, task_id, document_id, author_id, author_role) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(caseId, kind, x.body ?? null, x.old ?? null, x.now ?? null, x.task ?? null, x.doc ?? null, u.id, u.role).run();
}
/** one row per case, created on first use; only the named columns change */
async function setOps(env: Env, caseId: number, u: StaffUser, cols: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(cols);
  await env.DB.prepare(`INSERT INTO fa_case_ops (case_id, ${keys.join(", ")}, updated_by, updated_at) VALUES (?1, ${keys.map((_, i) => `?${i + 2}`).join(", ")}, ?${keys.length + 2}, datetime('now'))
    ON CONFLICT(case_id) DO UPDATE SET ${keys.map((k) => `${k} = excluded.${k}`).join(", ")}, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(caseId, ...keys.map((k) => cols[k]), u.id).run();
}
const WAITING = ["client", "banker", "management", "paused"] as const;
const CLOSED_KINDS = ["completed", "not_proceeding", "withdrawn"] as const;

async function route(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams, request: Request): Promise<Response | null> {
  const b = body ?? {};

  /* ---- the overview's figures and the gates ---- */
  if (path === "/fa/summary" && method === "GET") {
    const scope = isAll(user) ? "" : " AND (c.owner_id = ?1 OR EXISTS (SELECT 1 FROM fa_case_members m WHERE m.case_id = c.id AND m.user_id = ?1))";
    const one = async (where: string) => Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM fa_cases c WHERE ${where}${scope}`).bind(...(isAll(user) ? [] : [user.id])).first<{ n: number }>())?.n ?? 0);
    return json({
      open: await one(`c.stage != 'closed'`),
      awaiting_banker: await one(`c.stage != 'closed' AND c.banker_status IN ('enquiry_sent', 'under_review')`),
      incomplete: await one(`c.stage != 'closed' AND c.prescreen = 'incomplete'`),
      official_decisions: await one(`c.application_status IN ('conditional_offer', 'officially_approved', 'declined', 'disbursed')`),
      /* v1.298.0 - FA 2.0 Overview: the directive's four figures */
      active: await one(`c.stage != 'closed'`),
      requiring_action: await one(`c.stage != 'closed' AND (${NEEDS_ACTION})`),
      reviews: await one(`c.stage != 'closed' AND ${REVIEW_PENDING}`),
      banker_pending: await one(`c.stage != 'closed' AND c.banker_status IN ('enquiry_sent', 'under_review')`),
      legal: FA_LEGAL,
      can: { create: can(user.role, "fa_edit"), decide: can(user.role, "fa_decide"), criteria: can(user.role, "fa_criteria") },
    });
  }

  /* ---- the client pipeline ---- */
  if (path === "/fa/cases" && method === "GET") {
    const scope = isAll(user) ? "" : " AND (c.owner_id = ?1 OR EXISTS (SELECT 1 FROM fa_case_members m WHERE m.case_id = c.id AND m.user_id = ?1))";
    const results = await caseRows(env, `1 = 1${scope}`, isAll(user) ? [] : [user.id]);
    return json({ cases: results ?? [], me: user.id });
  }

  if (path === "/fa/cases" && method === "POST") {
    if (!can(user.role, "fa_edit")) return err("forbidden", "You cannot open advisory cases", 403);
    const product = String(b.product ?? "");
    if (!(PRODUCTS as readonly string[]).includes(product)) return err("invalid_input", `product is one of ${PRODUCTS.join(", ")}`, 400);
    const issuer = b.issuer_code === "azoo" ? "azoo" : b.issuer_code === "a2z" ? "a2z" : null;
    if (!issuer) return err("invalid_input", "Choose the company that provides the service (a2z or azoo).", 400);
    let customerId = typeof b.customer_id === "number" && Number.isInteger(b.customer_id) ? b.customer_id : null;
    if (customerId) {
      if (!(await env.DB.prepare(`SELECT id FROM customers WHERE id = ?1`).bind(customerId).first())) return err("not_found", "Customer not found", 404);
    } else {
      const nc = (b.new_customer ?? {}) as Record<string, unknown>;
      const name = str(nc.name, 120) ? String(nc.name).trim() : "";
      const phone = typeof nc.phone === "string" ? nc.phone.replace(/[^0-9+]/g, "") : "";
      if (name.length < 2 || phone.replace(/\D/g, "").length < 9) return err("invalid_input", "Give the client's name and phone number.", 400);
      /* ONE client identity: an existing customer with this phone is that client */
      const { results } = await env.DB.prepare(`SELECT id, company, phone FROM customers WHERE phone IS NOT NULL`).all<{ id: number; company: string; phone: string }>();
      const digits = phone.replace(/\D/g, "").replace(/^60/, "0");
      const hit = (results ?? []).find((r) => String(r.phone).replace(/\D/g, "").replace(/^60/, "0") === digits);
      if (hit) return json({ error: { code: "duplicate_customer", message: `${hit.company} already has this phone number - open the case on that customer.` }, customer_id: hit.id, customer: hit.company }, 409);
      const email = str(nc.email, 160) ? String(nc.email).trim() : null;
      const row = await env.DB.prepare(`INSERT INTO customers (company, contact_person, phone, email, created_by) VALUES (?1, ?1, ?2, ?3, ?4) RETURNING id`)
        .bind(name, phone, email, user.id).first<{ id: number }>();
      customerId = Number(row?.id);
      await audit(env, user.id, "customer.create", "customers", String(customerId), { via: "financial_advisory" });
    }
    let owner = user.id;
    if (typeof b.owner_id === "number" && b.owner_id !== user.id) {
      if (!isAll(user)) return err("forbidden", "Only management assigns a case to someone else", 403);
      const o = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ?1 AND is_active = 1`).bind(b.owner_id).first<{ id: number; role: string }>();
      if (!o || !can(o.role as StaffUser["role"], "fa_edit")) return err("invalid_input", "That person cannot own an advisory case", 400);
      owner = o.id;
    }
    const agentReq = typeof b.agent_request_id === "number" ? b.agent_request_id : null;
    const purpose = str(b.purpose, 300) ? String(b.purpose).trim() : null;
    let id: number;
    try {
      const row = await env.DB.prepare(
        `INSERT INTO fa_cases (customer_id, owner_id, agent_request_id, issuer_code, product, purpose, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(customerId, owner, agentReq, issuer, product, purpose, user.id).first<{ id: number }>();
      id = Number(row?.id);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) {
        const ex = await env.DB.prepare(`SELECT id, case_ref FROM fa_cases WHERE customer_id = ?1 AND product = ?2 AND stage != 'closed'`).bind(customerId, product).first<{ id: number; case_ref: string }>();
        return json({ error: { code: "case_exists", message: `This client already has an open ${product.replace(/_/g, " ")} case (${ex?.case_ref ?? ""}).` }, case_id: ex?.id }, 409);
      }
      throw e;
    }
    const ref = `FA-${String(id).padStart(6, "0")}`;
    await env.DB.prepare(`UPDATE fa_cases SET case_ref = ?1 WHERE id = ?2`).bind(ref, id).run();
    await event(env, id, "case_created", user.id, { product, issuer }, `created:${id}`);
    await audit(env, user.id, "fa.case_create", "fa_cases", String(id), { case_ref: ref, product, issuer, customer_id: customerId });
    if (owner !== user.id) await notify(env, owner, "fa", `${ref}: an advisory case was assigned to you.`, `fa_owner:${id}:${owner}`, { once: true });
    return json({ ok: true, id, case_ref: ref, customer_id: customerId }, 201);
  }

  /* ---- bank criteria (the one verified directory) ---- */
  if (path === "/fa/criteria" && method === "GET") {
    return json({ criteria: await liveCriteria(env), can: { propose: can(user.role, "fa_edit"), verify: can(user.role, "fa_criteria") } });
  }
  if (path === "/fa/criteria" && method === "POST") {
    if (!can(user.role, "fa_edit")) return err("forbidden", "You cannot propose criteria", 403);
    /* v1.286.0 - the bank comes from the one bank registry, never typed (ONE BANK REGISTRY) */
    const bk = typeof b.bank_id === "number" ? await env.DB.prepare(`SELECT id, name, status FROM fa_banks WHERE id = ?1`).bind(b.bank_id).first<{ id: number; name: string; status: string }>() : null;
    const product = String(b.product ?? "");
    const source = str(b.source, 300) ? String(b.source).trim() : "";
    if (!bk || !["personal_financing", "debt_consolidation"].includes(product)) return err("invalid_input", "Choose the bank from the registry and the product.", 400);
    if (bk.status === "retired") return err("invalid_state", `${bk.name} is retired.`, 409);
    const bp = await env.DB.prepare(`SELECT id FROM fa_bank_products WHERE bank_id = ?1 AND product = ?2 AND status = 'active'`).bind(bk.id, product).first<{ id: number }>();
    if (!bp) return err("invalid_input", `${bk.name} has no ${product.replace(/_/g, " ")} in the registry - management adds the product first.`, 400);
    if (source.length < 5) return err("invalid_input", "Say where this rule comes from (document or contact, and date).", 400);
    const pct = typeof b.dsr_guideline_pct === "number" && b.dsr_guideline_pct > 0 && b.dsr_guideline_pct < 100 ? Math.round(b.dsr_guideline_pct * 100) : null;
    const bank = bk.name;
    const family = `bank-${bk.id}:${product}`;
    const last = await env.DB.prepare(`SELECT MAX(version) AS v FROM fa_criteria WHERE family = ?1`).bind(family).first<{ v: number | null }>();
    const list = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v.map(String).filter((x) => x.length <= 60).slice(0, 20)) : null);
    const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);
    const range = [int(b.min_age, 18, 99), int(b.max_age, 18, 99), cents(b.min_amount_cents), cents(b.max_amount_cents), int(b.min_tenure_months, 1, 600), int(b.max_tenure_months, 1, 600)] as const;
    if ((range[0] != null && range[1] != null && range[0] > range[1]) || (range[2] != null && range[3] != null && range[2] > range[3]) || (range[4] != null && range[5] != null && range[4] > range[5])) {
      return err("invalid_input", "A minimum is above its maximum.", 400);
    }
    const row = await env.DB.prepare(
      `INSERT INTO fa_criteria (family, version, bank, product, income_definition, commitment_definition, dsr_guideline_bp, min_income_cents, employment_categories, min_service_months, required_documents, source, effective_from, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) RETURNING id`,
    ).bind(family, Number(last?.v ?? 0) + 1, bank, product, b.income_definition === "gross" ? "gross" : "net", b.commitment_definition === "exclude_ptptn" ? "exclude_ptptn" : "all",
      pct, cents(b.min_income_cents), list(b.employment_categories), typeof b.min_service_months === "number" ? Math.max(0, Math.round(b.min_service_months)) : null,
      list(b.required_documents), source, validDay(b.effective_from) ? b.effective_from : null, user.id).first<{ id: number }>();
    await env.DB.prepare(
      `INSERT INTO fa_criteria_terms (criterion_id, bank_id, bank_product_id, min_age, max_age, min_amount_cents, max_amount_cents, min_tenure_months, max_tenure_months) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(Number(row?.id), bk.id, bp.id, ...range).run();
    await audit(env, user.id, "fa.criteria_draft", "fa_criteria", String(row?.id), { bank, bank_id: bk.id, product, family, dsr_guideline_bp: pct });
    return json({ ok: true, id: row?.id }, 201);
  }
  const mCr = path.match(/^\/fa\/criteria\/(\d+)\/(verify|retire)$/);
  if (mCr && method === "POST") {
    if (!can(user.role, "fa_criteria")) return err("forbidden", "Only management verifies bank criteria", 403);
    const c = await env.DB.prepare(`SELECT * FROM fa_criteria WHERE id = ?1`).bind(Number(mCr[1])).first<FaCriterion>();
    if (!c) return err("not_found", "Criterion not found", 404);
    if (mCr[2] === "verify") {
      if (!validDay(b.last_verified_on) || b.last_verified_on > mytToday()) return err("invalid_input", "Give the date you confirmed this rule with its source.", 400);
      const r = await env.DB.prepare(`UPDATE fa_criteria SET state = 'verified', last_verified_on = ?1, verified_by = ?2, verified_at = datetime('now') WHERE id = ?3 AND state = 'draft'`)
        .bind(b.last_verified_on, user.id, c.id).run();
      if (!Number(r.meta?.changes ?? 0)) return err("invalid_state", "Only a draft criterion can be verified.", 409);
      /* one verified version per family: the older one retires - v1.288.0: when the new one is in force; a
         version effective later leaves the current one in force until its date (the engine takes the newest in force) */
      const eff = (c as unknown as { effective_from?: string | null }).effective_from ?? null;
      if (!eff || eff <= mytToday()) await env.DB.prepare(`UPDATE fa_criteria SET state = 'retired' WHERE family = ?1 AND id != ?2 AND state = 'verified' AND version < ?3`).bind(c.family, c.id, c.version).run();
    } else {
      await env.DB.prepare(`UPDATE fa_criteria SET state = 'retired' WHERE id = ?1`).bind(c.id).run();
    }
    await audit(env, user.id, `fa.criteria_${mCr[2]}`, "fa_criteria", String(c.id), { family: c.family, version: c.version, bank: c.bank });
    return json({ ok: true });
  }

  /* ---- v1.290.0 (image 04, G2) one banker's cases: the counts for everyone
     who may open Financial Advisory; the case lines - client, DSR, feedback,
     the official outcome - only for the cases this person may open ---- */
  const mBc = path.match(/^\/fa\/bankers\/(\d+)\/cases$/);
  if (mBc && method === "GET") {
    if (!can(user.role, "fa_view")) return err("forbidden", "You cannot open Financial Advisory", 403);
    const bankerId = Number(mBc[1]);
    const bk = await env.DB.prepare(`SELECT id FROM fa_bankers WHERE id = ?1`).bind(bankerId).first();
    if (!bk) return err("not_found", "Banker not found", 404);
    const rows = (await env.DB.prepare(
      `SELECT a.id AS allocation_id, a.case_id, a.state, a.reason, a.created_at, a.decided_at, ${PERSON("d")} AS decided_by, c.case_ref, c.owner_id, c.product, c.stage, c.application_status, c.banker_status, cu.company AS client,
              (SELECT x.projected_dsr_bp FROM fa_assessments x WHERE x.case_id = c.id ORDER BY x.id DESC LIMIT 1) AS projected_dsr_bp,
              e.id AS enquiry_id, e.state AS enquiry_state, e.sent_at
         FROM fa_allocations a JOIN fa_cases c ON c.id = a.case_id LEFT JOIN customers cu ON cu.id = c.customer_id
         LEFT JOIN users d ON d.id = a.decided_by LEFT JOIN fa_enquiries e ON e.allocation_id = a.id
        WHERE a.banker_id = ?1 ORDER BY a.id DESC LIMIT 200`,
    ).bind(bankerId).all<{ allocation_id: number; case_id: number; state: string; reason: string | null; created_at: string; decided_at: string | null; decided_by: string | null; case_ref: string; owner_id: number; product: string; stage: string; application_status: string; banker_status: string; client: string | null; projected_dsr_bp: number | null; enquiry_id: number | null; enquiry_state: string | null; sent_at: string | null }>()).results ?? [];
    const OUTCOME = ["conditional_offer", "officially_approved", "declined", "disbursed"];
    const counts = {
      allocated: rows.filter((r) => ["assigned", "awaiting_consent", "ready"].includes(r.state)).length,
      pending: rows.filter((r) => r.state === "pending_review").length,
      enquiry_open: rows.filter((r) => ["sent", "acknowledged", "information_requested"].includes(r.enquiry_state ?? "")).length,
      feedback: rows.filter((r) => r.enquiry_state === "feedback_received").length,
      outcome: rows.filter((r) => OUTCOME.includes(r.application_status)).length,
    };
    const cases = [];
    for (const r of rows) {
      const may = isAll(user) || r.owner_id === user.id || (await isMember(env, r.case_id, user.id));
      if (!may) { cases.push({ allocation_id: r.allocation_id, state: r.state, mine: false }); continue; }
      const feedback = (await env.DB.prepare(
        `SELECT n.id, n.status_value, n.body, n.source, n.missing_documents, n.follow_up_on, n.created_at, f.contact_on, ${PERSON("u")} AS author
           FROM fa_note_links l JOIN fa_notes n ON n.id = l.note_id LEFT JOIN fa_note_facts f ON f.note_id = n.id LEFT JOIN users u ON u.id = n.author_id
          WHERE l.banker_id = ?1 AND n.case_id = ?2 AND n.note_type = 'banker' ORDER BY n.id DESC LIMIT 5`,
      ).bind(bankerId, r.case_id).all()).results ?? [];
      const decisions = (await env.DB.prepare(
        `SELECT n.id, n.bank, n.status_value, n.bank_reference, n.approved_cents, n.created_at, f.tenure_months, n.evidence_id IS NOT NULL AS has_letter
           FROM fa_notes n LEFT JOIN fa_note_facts f ON f.note_id = n.id WHERE n.case_id = ?1 AND n.note_type = 'decision' ORDER BY n.id DESC LIMIT 3`,
      ).bind(r.case_id).all()).results ?? [];
      cases.push({ ...r, mine: true, feedback, decisions });
    }
    return json({ counts, cases });
  }

  /* ---- v1.286.0 the bank, branch and banker registry ---- */
  if (path === "/fa/registry" || path.startsWith("/fa/registry/") || path.startsWith("/fa/banks") || path.startsWith("/fa/branches") || path.startsWith("/fa/bankers") || path === "/fa/localities") {
    return handleFaRegistry(env, path, method, b, user, params);
  }

  /* ---- one consent ---- */
  const mCw = path.match(/^\/fa\/consents\/(\d+)\/withdraw$/);
  if (mCw && method === "POST") {
    const k = await env.DB.prepare(`SELECT * FROM fa_consents WHERE id = ?1`).bind(Number(mCw[1])).first<{ id: number; case_id: number; kind: string; withdrawn_at: string | null }>();
    if (!k) return err("not_found", "Consent not found", 404);
    const c = await caseOf(env, k.case_id);
    if (!c || !mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    const note = str(b.note, 300) ? String(b.note).trim() : "";
    if (note.length < 5) return err("invalid_input", "Say how and when the client withdrew it.", 400);
    const r = await env.DB.prepare(`UPDATE fa_consents SET withdrawn_at = datetime('now'), withdrawn_by = ?1, withdrawn_note = ?2 WHERE id = ?3 AND withdrawn_at IS NULL`).bind(user.id, note, k.id).run();
    if (!Number(r.meta?.changes ?? 0)) return err("invalid_state", "This consent was already withdrawn.", 409);
    await event(env, c.id, "consent_withdrawn", user.id, { kind: k.kind });
    await audit(env, user.id, "fa.consent_withdrawn", "fa_consents", String(k.id), { case: c.case_ref, kind: k.kind });
    if (c.owner_id !== user.id) await notify(env, c.owner_id, "fa", `${c.case_ref}: a client consent was withdrawn.`, `fa_cw:${k.id}`, { once: true });
    await touch(env, c.id);
    return json({ ok: true });
  }

  /* ---- one item ---- */
  const mIt = path.match(/^\/fa\/items\/(\d+)\/(verify|void|settlement)$/);
  if (mIt && method === "POST") {
    const it = await env.DB.prepare(`SELECT * FROM fa_items WHERE id = ?1`).bind(Number(mIt[1])).first<FaItem & { case_id: number }>();
    if (!it) return err("not_found", "Item not found", 404);
    const c = await caseOf(env, it.case_id);
    if (!c || !mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    if (it.voided_at) return err("invalid_state", "This line was removed.", 409);
    if (mIt[2] === "verify") {
      const doc = await docOnCase(env, c.id, b.evidence_id);
      if (!doc) return err("evidence_required", "Choose the document on this case that proves it.", 400);
      await env.DB.prepare(`UPDATE fa_items SET state = 'verified', evidence_id = ?1, verified_by = ?2, verified_at = datetime('now') WHERE id = ?3`).bind(doc, user.id, it.id).run();
      /* the document that proves a figure is, by that act, a checked document */
      await env.DB.prepare(`UPDATE fa_documents SET verified = 1, verified_by = COALESCE(verified_by, ?1), verified_at = COALESCE(verified_at, datetime('now')) WHERE id = ?2`).bind(user.id, doc).run();
    } else if (mIt[2] === "void") {
      const reason = str(b.reason, 200) ? String(b.reason).trim() : "";
      if (reason.length < 5) return err("invalid_input", "Say why this line is removed.", 400);
      await env.DB.prepare(`UPDATE fa_items SET voided_at = datetime('now'), voided_by = ?1, void_reason = ?2 WHERE id = ?3 AND voided_at IS NULL`).bind(user.id, reason, it.id).run();
    } else {
      if (it.side !== "commitment") return err("invalid_input", "Only a commitment is settled.", 400);
      const doc = await docOnCase(env, c.id, b.settlement_doc_id);
      if (!doc) return err("evidence_required", "Choose the settlement letter on this case.", 400);
      await env.DB.prepare(`UPDATE fa_items SET settle_in_consolidation = 1, settlement_doc_id = ?1, settlement_cents = COALESCE(?2, settlement_cents) WHERE id = ?3`).bind(doc, cents(b.settlement_cents), it.id).run();
    }
    await event(env, c.id, `item_${mIt[2]}`, user.id, { side: it.side, kind: it.kind });
    await audit(env, user.id, `fa.item_${mIt[2]}`, "fa_items", String(it.id), { case: c.case_ref, side: it.side, kind: it.kind });
    await touch(env, c.id);
    return json({ ok: true });
  }

  /* ---- one document: serve (audited) or verify ---- */
  const mDoc = path.match(/^\/fa\/documents\/(\d+)(\/verify)?$/);
  if (mDoc) {
    const d = await env.DB.prepare(`SELECT * FROM fa_documents WHERE id = ?1 AND removed_at IS NULL`).bind(Number(mDoc[1])).first<{ id: number; case_id: number; r2_key: string; content_type: string; kind: string }>();
    if (!d) return err("not_found", "Document not found", 404);
    const c = await caseOf(env, d.case_id);
    if (!c || !(await mayOpen(env, user, c))) {
      await audit(env, user.id, "fa.document_refused", "fa_documents", String(d.id), { role: user.role });
      return err("forbidden", "Not a document you can open", 403);
    }
    if (!mDoc[2] && method === "GET") {
      const obj = await env.MEDIA.get(d.r2_key);
      if (!obj) return err("not_found", "File missing", 404);
      await audit(env, user.id, "fa.document_view", "fa_documents", String(d.id), { case: c.case_ref, kind: d.kind });
      return new Response(obj.body, { headers: { "Content-Type": d.content_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
    }
    if (mDoc[2] && method === "POST") {
      if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
      await env.DB.prepare(`UPDATE fa_documents SET verified = 1, verified_by = ?1, verified_at = datetime('now') WHERE id = ?2`).bind(user.id, d.id).run();
      await event(env, c.id, "document_verified", user.id, { kind: d.kind });
      await audit(env, user.id, "fa.document_verify", "fa_documents", String(d.id), { case: c.case_ref, kind: d.kind });
      return json({ ok: true });
    }
    return null;
  }

  /* ---- a note correction (append only: a new note pointing at the old) ---- */
  const mNc = path.match(/^\/fa\/notes\/(\d+)\/correct$/);
  if (mNc && method === "POST") {
    const n = await env.DB.prepare(`SELECT * FROM fa_notes WHERE id = ?1`).bind(Number(mNc[1])).first<{ id: number; case_id: number; note_type: string; bank: string | null; status_value: string | null; evidence_id: number | null }>();
    if (!n) return err("not_found", "Note not found", 404);
    if (n.note_type === "system") return err("invalid_input", "A system assessment is never edited - run a new assessment.", 400);
    const c = await caseOf(env, n.case_id);
    if (!c || !(await mayOpen(env, user, c))) return err("forbidden", "Not a case you can open", 403);
    if (n.note_type === "decision" ? !can(user.role, "fa_decide") : !(can(user.role, "fa_edit") || (await isMember(env, c.id, user.id)))) return err("forbidden", "You cannot correct this note", 403);
    const text = str(b.body, 2000) ? String(b.body).trim() : "";
    if (text.length < 5) return err("invalid_input", "Write the correction.", 400);
    const row = await env.DB.prepare(`INSERT INTO fa_notes (case_id, note_type, bank, status_value, body, evidence_id, corrects_id, author_id, author_role) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`)
      .bind(c.id, n.note_type, n.bank, n.status_value, text, n.evidence_id, n.id, user.id, user.role).first<{ id: number }>();
    await event(env, c.id, "note_corrected", user.id, { note: n.id });
    await audit(env, user.id, "fa.note_correct", "fa_notes", String(row?.id), { case: c.case_ref, corrects: n.id });
    return json({ ok: true, id: row?.id }, 201);
  }

  /* ---- v1.288.0 DSR pre-check: the one engine, stateless (Quick Check and the live result) ---- */
  if (path === "/fa/preview" && method === "POST") {
    if (!can(user.role, "fa_edit")) return err("forbidden", "You cannot run a DSR pre-check", 403);
    const product = String(b.product ?? "personal_financing") as Product;
    if (!["personal_financing", "debt_consolidation", "advisory_only"].includes(product)) return err("invalid_input", "Unknown product", 400);
    const raw = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];
    if (raw.length > 60) return err("invalid_input", "Too many figures.", 400);
    /* D3: a Quick Check carries no identity - a name, IC or phone is refused, not ignored */
    for (const k of ["name", "ic", "nric", "phone", "email", "customer", "client"]) if (b[k] !== undefined) return err("identity_refused", "A Quick Check takes figures only - no name, IC, phone or email.", 400);
    const items: FaItem[] = [];
    for (const [i, r] of raw.entries()) {
      const side = String(r.side ?? ""), kind = String(r.kind ?? "");
      if (!SIDES.includes(side) || !(KINDS[side] ?? []).includes(kind)) return err("invalid_input", `Line ${i + 1}: unknown ${side || "side"} ${kind}`, 400);
      const m = cents(r.monthly_cents);
      if (m === null) return err("invalid_input", `Line ${i + 1}: the monthly amount is in sen, zero or more.`, 400);
      items.push({ id: i + 1, side: side as FaItem["side"], kind, monthly_cents: m, state: r.verified === true ? "verified" : "declared",
        settle_in_consolidation: r.settle === true ? 1 : 0, settlement_doc_id: r.settle === true ? -1 : null, arrears: r.arrears === true ? 1 : 0,
        label: str(r.label, 80) ? String(r.label) : null, source: r.verified === true ? "preview" : "declared",
        remaining_months: typeof r.remaining_months === "number" && Number.isInteger(r.remaining_months) && r.remaining_months >= 0 && r.remaining_months <= 600 ? r.remaining_months : null });
    }
    const p = (b.proposal ?? {}) as Record<string, unknown>;
    const proposal = { instalment_cents: cents(p.instalment_cents), amount_cents: cents(p.amount_cents), tenure_months: typeof p.tenure_months === "number" && Number.isInteger(p.tenure_months) && p.tenure_months > 0 && p.tenure_months <= 600 ? p.tenure_months : null, rate_bp: typeof p.rate_bp === "number" && p.rate_bp >= 0 && p.rate_bp <= 5000 ? Math.round(p.rate_bp) : null, rate_type: rateType(p.rate_type) };
    const prof = (b.profile ?? null) as Record<string, unknown> | null;
    const profile = prof ? { employment_category: str(prof.employment_category, 40) ? String(prof.employment_category) : null, service_months: typeof prof.service_months === "number" ? prof.service_months : null, age_years: typeof prof.age_years === "number" ? prof.age_years : null } : null;
    const r = assess({ product, items, profile, proposal, criteria: await liveCriteria(env), verifiedDocKinds: [], today: mytToday() });
    /* nothing is stored; a pressed Calculate leaves one audit line with no figure in it */
    if (b.final === true) await audit(env, user.id, "fa.quick_check", "fa", "preview", { lines: items.length, product, outcome: r.outcome });
    return json({ result: r, assumed_settlements: items.filter((i) => i.settlement_doc_id === -1).length, stored: false });
  }

  /* ---- v1.288.0 the management review queue ---- */
  if (path === "/fa/reviews" && method === "GET") {
    const decide = can(user.role, "fa_decide");
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.case_id, r.assessment_id, r.reason, r.created_at, ${PERSON("u")} AS submitted_by, c.case_ref, c.product, c.prescreen, cu.company AS client,
              a.current_dsr_bp, a.projected_dsr_bp, a.outcome
         FROM fa_reviews r JOIN fa_cases c ON c.id = r.case_id LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN users u ON u.id = r.actor_id LEFT JOIN fa_assessments a ON a.id = r.assessment_id
        WHERE r.action = 'submitted' AND r.id = (SELECT MAX(id) FROM fa_reviews x WHERE x.case_id = r.case_id)
          ${decide ? "" : "AND (c.owner_id = ?1 OR EXISTS (SELECT 1 FROM fa_case_members m WHERE m.case_id = c.id AND m.user_id = ?1))"}
        ORDER BY r.id`,
    ).bind(...(decide ? [] : [user.id])).all();
    return json({ pending: results ?? [], can: { decide } });
  }

  /* ---- v1.288.0 banker matching, allocation, enquiry and disclosure (fa-match.ts) ---- */
  if (path.startsWith("/fa/allocations/") || /^\/fa\/cases\/\d+\/(match|allocations|enquiries|disclosures)$/.test(path)) {
    return handleFaMatch(env, path, method, b, user, { caseOf, mayOpen, mayEdit, event, touch, reviewState, liveCriteria, consentsReady, docOnCase });
  }

  /* ---- one case ---- */
  const m = path.match(/^\/fa\/cases\/(\d+)(?:\/([a-z]+))?$/);
  if (!m) return null;
  const c = await caseOf(env, Number(m[1]));
  if (!c) return err("not_found", "Case not found", 404);
  if (!(await mayOpen(env, user, c))) {
    await audit(env, user.id, "fa.case_refused", "fa_cases", String(c.id), { role: user.role, path });
    return err("forbidden", "Not a case you can open", 403);
  }
  const sub = m[2] ?? "";

  if (!sub && method === "GET") return json(await picture(env, user, c));

  if (!sub && method === "PATCH") {
    if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    const sets: string[] = [], vals: unknown[] = [];
    if (b.stage !== undefined) {
      const to = String(b.stage);
      if (!(STAGES as readonly string[]).includes(to)) return err("invalid_input", "Unknown stage", 400);
      if (to === "closed") {
        const why = str(b.closed_reason, 300) ? String(b.closed_reason).trim() : "";
        if (why.length < 5) return err("invalid_input", "Say why the case closes (no loan advised, declined, withdrawn, client stopped, completed).", 400);
        /* v1.299.0 - how it closed: completed, not proceeding or withdrawn (FA 2.0 case states) */
        if (b.closed_kind !== undefined && !(CLOSED_KINDS as readonly string[]).includes(String(b.closed_kind))) return err("invalid_input", "closed_kind is completed, not_proceeding or withdrawn", 400);
        sets.push(`stage = 'closed'`, `closed_reason = ?${vals.push(why)}`, `closed_at = datetime('now')`, `closed_by = ?${vals.push(user.id)}`);
      } else if (["agreement", "application", "fee"].includes(to)) {
        return err("legal_gate", "This step is switched off until counsel clears it (agreement, formal application, fee).", 409);
      } else if (to === "enquiry") {
        return err("invalid_transition", "A case moves to enquiry when an enquiry to its allocated banker is recorded.", 409);
      } else if (to === "matching" && (await reviewState(env, c.id)).decision !== "proceed") {
        /* v1.288.0 - banker matching only after Management decided Proceed (blueprint v1.2) */
        return err("review_required", "Banker matching opens only after Management decides Proceed on a submitted assessment.", 409);
      } else if (!(NEXT[c.stage] ?? []).includes(to)) {
        return err("invalid_transition", `A case in ${c.stage} cannot move to ${to}.`, 409);
      } else sets.push(`stage = ?${vals.push(to)}`);
    }
    if (b.purpose !== undefined) sets.push(`purpose = ?${vals.push(str(b.purpose, 300) ? String(b.purpose).trim() : null)}`);
    if (b.owner_id !== undefined) {
      if (!isAll(user)) return err("forbidden", "Only management reassigns a case", 403);
      const o = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ?1 AND is_active = 1`).bind(b.owner_id).first<{ id: number; role: string }>();
      if (!o || !can(o.role as StaffUser["role"], "fa_edit")) return err("invalid_input", "That person cannot own an advisory case", 400);
      sets.push(`owner_id = ?${vals.push(o.id)}`);
    }
    if (!sets.length) return err("invalid_input", "Nothing to change", 400);
    const r = await env.DB.prepare(`UPDATE fa_cases SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?${vals.push(c.id)} AND stage = ?${vals.push(c.stage)}`).bind(...vals).run();
    if (!Number(r.meta?.changes ?? 0)) return err("conflict", "This case changed - reload it.", 409);
    await event(env, c.id, b.stage === "closed" ? "case_closed" : b.stage ? "stage_changed" : "case_updated", user.id, { stage: b.stage ?? null, owner: b.owner_id ?? null });
    /* v1.299.0 - the same change on the case's update history (author and time); before 0190 the event above still holds it */
    try {
      if (b.stage === "closed") {
        if (b.closed_kind !== undefined) await setOps(env, c.id, user, { closed_kind: String(b.closed_kind) });
        await logUpdate(env, c.id, user, "closed", { body: String(b.closed_reason ?? "").trim(), old: c.stage, now: b.closed_kind !== undefined ? String(b.closed_kind) : "closed" });
      } else if (b.stage !== undefined) await logUpdate(env, c.id, user, "status", { old: c.stage, now: String(b.stage) });
      if (b.owner_id !== undefined) await logUpdate(env, c.id, user, "owner", { old: String(c.owner_id), now: String(b.owner_id) });
    } catch (e) { if (!skew(e)) throw e; }
    await audit(env, user.id, "fa.case_update", "fa_cases", String(c.id), { case: c.case_ref, stage: b.stage ?? null, owner_id: b.owner_id ?? null });
    return json({ ok: true, ...(await picture(env, user, (await caseOf(env, c.id))!)) });
  }

  if (sub === "members" && method === "POST") {
    if (!isAll(user) && c.owner_id !== user.id) return err("forbidden", "Only the owner or management adds assisting staff", 403);
    const mu = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ?1 AND is_active = 1`).bind(b.user_id).first<{ id: number; role: string }>();
    if (!mu || !can(mu.role as StaffUser["role"], "fa_view")) return err("invalid_input", "That person cannot be added to an advisory case", 400);
    await env.DB.prepare(`INSERT OR IGNORE INTO fa_case_members (case_id, user_id, added_by) VALUES (?1, ?2, ?3)`).bind(c.id, mu.id, user.id).run();
    await event(env, c.id, "member_added", user.id, { user_id: mu.id });
    await audit(env, user.id, "fa.member_add", "fa_cases", String(c.id), { user_id: mu.id });
    return json({ ok: true });
  }

  if (sub === "consents" && method === "POST") {
    if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    const kind = String(b.kind ?? "");
    if (!["privacy_notice", "assessment", "disclosure"].includes(kind)) return err("invalid_input", "kind is privacy_notice, assessment or disclosure", 400);
    const how = ["signed_form", "email", "whatsapp", "in_person_recorded"].includes(String(b.captured_how)) ? String(b.captured_how) : "";
    if (!how) return err("invalid_input", "Say how the consent was captured.", 400);
    if (!validDay(b.given_at) || b.given_at > mytToday()) return err("invalid_input", "Give the date the client consented.", 400);
    const version = str(b.notice_version, 40) ? String(b.notice_version).trim() : "";
    if (kind !== "disclosure" && !version) return err("invalid_input", "Name the notice version the client saw.", 400);
    const institution = kind === "disclosure" ? (str(b.institution, 80) ? String(b.institution).trim() : "") : null;
    const docs = kind === "disclosure" && Array.isArray(b.documents) ? b.documents.map(String).filter((d) => DOC_KINDS.includes(d)) : [];
    if (kind === "disclosure" && (!institution || docs.length === 0)) return err("invalid_input", "A disclosure consent names ONE institution and the documents it covers.", 400);
    const ev = b.evidence_id === undefined ? null : await docOnCase(env, c.id, b.evidence_id);
    const row = await env.DB.prepare(`INSERT INTO fa_consents (case_id, kind, notice_version, institution, documents, captured_how, evidence_id, given_at, expires_at, recorded_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`)
      .bind(c.id, kind, version || null, institution, docs.length ? JSON.stringify(docs) : null, how, ev, b.given_at, validDay(b.expires_at) ? b.expires_at : null, user.id).first<{ id: number }>();
    await event(env, c.id, "consent_recorded", user.id, { kind, institution });
    await audit(env, user.id, "fa.consent", "fa_consents", String(row?.id), { case: c.case_ref, kind, institution });
    await touch(env, c.id);
    return json({ ok: true, id: row?.id }, 201);
  }

  if (sub === "profile" && method === "PUT") {
    if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    if (!(await consentsReady(env, c.id))) return err("consent_required", "Record the privacy notice and the assessment consent first.", 409);
    let masked: string | null = null, hash: string | null = null;
    if (b.ic !== undefined && b.ic !== null && b.ic !== "") {
      const digits = String(b.ic).replace(/\D/g, "");
      if (!/^\d{12}$/.test(digits)) return err("invalid_input", "A MyKad number has 12 digits.", 400);
      masked = maskIc(digits); hash = await icHash(env, digits);
      const other = await env.DB.prepare(`SELECT c.case_ref, c.customer_id FROM fa_profiles p JOIN fa_cases c ON c.id = p.case_id WHERE p.ic_hash = ?1 AND c.customer_id != ?2 LIMIT 1`).bind(hash, c.customer_id).first<{ case_ref: string }>();
      if (other) return json({ error: { code: "ic_elsewhere", message: `This IC is already on another client's case (${other.case_ref}). One person, one client record.` } }, 409);
    } else {
      const prev = await env.DB.prepare(`SELECT ic_masked, ic_hash FROM fa_profiles WHERE case_id = ?1 ORDER BY version DESC LIMIT 1`).bind(c.id).first<{ ic_masked: string | null; ic_hash: string | null }>();
      masked = prev?.ic_masked ?? null; hash = prev?.ic_hash ?? null;
    }
    const int = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
    const s = (v: unknown) => (str(v, 60) ? String(v).trim() : null);
    const last = await env.DB.prepare(`SELECT MAX(version) AS v FROM fa_profiles WHERE case_id = ?1`).bind(c.id).first<{ v: number | null }>();
    const version = Number(last?.v ?? 0) + 1;
    await env.DB.prepare(`INSERT INTO fa_profiles (case_id, version, employment_status, employment_category, employer_type, service_months, salary_pattern, dependants, age_years, ic_masked, ic_hash, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
      .bind(c.id, version, s(b.employment_status), s(b.employment_category), s(b.employer_type), int(b.service_months, 720), s(b.salary_pattern), int(b.dependants, 30), int(b.age_years, 120), masked, hash, user.id).run();
    if (c.stage === "intake") await env.DB.prepare(`UPDATE fa_cases SET stage = 'profile' WHERE id = ?1 AND stage = 'intake'`).bind(c.id).run();
    await event(env, c.id, "profile_saved", user.id, { version });
    await audit(env, user.id, "fa.profile", "fa_cases", String(c.id), { case: c.case_ref, version, ic_changed: b.ic !== undefined && b.ic !== null && b.ic !== "" });
    await touch(env, c.id);
    return json({ ok: true, version });
  }

  if (sub === "items" && method === "POST") {
    if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    if (!(await consentsReady(env, c.id))) return err("consent_required", "Record the privacy notice and the assessment consent first.", 409);
    const side = String(b.side ?? ""), kind = String(b.kind ?? "");
    if (!SIDES.includes(side) || !(KINDS[side] ?? []).includes(kind)) return err("invalid_input", `For ${side || "this side"}, kind is one of ${(KINDS[side] ?? []).join(", ")}`, 400);
    const monthly = cents(b.monthly_cents);
    if (monthly === null) return err("invalid_input", "Enter the monthly amount in sen.", 400);
    const source = SOURCES.includes(String(b.source)) ? String(b.source) : "declared";
    const row = await env.DB.prepare(`INSERT INTO fa_items (case_id, side, kind, label, monthly_cents, outstanding_cents, arrears, source, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`)
      .bind(c.id, side, kind, str(b.label, 80) ? String(b.label).trim() : null, monthly, cents(b.outstanding_cents), b.arrears === true ? 1 : 0, source, user.id).first<{ id: number }>();
    await event(env, c.id, "item_added", user.id, { side, kind });
    await audit(env, user.id, "fa.item_add", "fa_items", String(row?.id), { case: c.case_ref, side, kind });
    await touch(env, c.id);
    return json({ ok: true, id: row?.id }, 201);
  }

  if (sub === "documents" && method === "POST") {
    if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    if (!(await consentsReady(env, c.id))) return err("consent_required", "Record the privacy notice and the assessment consent first.", 409);
    const kind = params.get("kind") ?? "";
    if (!DOC_KINDS.includes(kind)) return err("invalid_input", `kind is one of ${DOC_KINDS.join(", ")}`, 400);
    const ct = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!DOC_TYPES.includes(ct)) return err("invalid_input", "Only a PDF, JPEG or PNG is accepted", 400);
    if (!request.body) return err("invalid_input", "The file is missing", 400);
    const key = `fa/${c.id}/${Date.now()}-${kind}`;
    const rejected = await putGuarded(env.MEDIA, key, request, { max: DOC_MAX, contentType: ct });
    if (rejected) return rejected;
    const size = Number(request.headers.get("content-length") ?? 0) || 0;
    const date = params.get("date");
    const row = await env.DB.prepare(`INSERT INTO fa_documents (case_id, kind, r2_key, content_type, size_bytes, doc_date, uploaded_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`)
      .bind(c.id, kind, key, ct, size, validDay(date) ? date : null, user.id).first<{ id: number }>();
    await event(env, c.id, "document_uploaded", user.id, { kind });
    await audit(env, user.id, "fa.document_upload", "fa_documents", String(row?.id), { case: c.case_ref, kind });
    await touch(env, c.id);
    return json({ ok: true, id: row?.id }, 201);
  }

  if (sub === "assess" && method === "POST") {
    if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    if (!(await consentsReady(env, c.id))) return err("consent_required", "Record the privacy notice and the assessment consent first.", 409);
    const items = ((await env.DB.prepare(`SELECT i.*, m.remaining_months FROM fa_items i LEFT JOIN fa_item_meta m ON m.item_id = i.id WHERE i.case_id = ?1`).bind(c.id).all<FaItem>()).results ?? []);
    const profile = await env.DB.prepare(`SELECT employment_category, service_months, age_years FROM fa_profiles WHERE case_id = ?1 ORDER BY version DESC LIMIT 1`).bind(c.id).first<{ employment_category: string | null; service_months: number | null; age_years: number | null }>();
    const docs = ((await env.DB.prepare(`SELECT DISTINCT kind FROM fa_documents WHERE case_id = ?1 AND verified = 1 AND removed_at IS NULL`).bind(c.id).all<{ kind: string }>()).results ?? []).map((d) => d.kind);
    const proposal = { instalment_cents: cents(b.instalment_cents), amount_cents: cents(b.amount_cents), tenure_months: typeof b.tenure_months === "number" ? b.tenure_months : null, rate_bp: typeof b.rate_bp === "number" ? b.rate_bp : null, rate_type: rateType(b.rate_type) };
    const r = assess({ product: c.product, items, profile, proposal, criteria: await liveCriteria(env), verifiedDocKinds: docs, today: mytToday() });
    const row = await env.DB.prepare(`INSERT INTO fa_assessments (case_id, ruleset, inputs, result, current_dsr_bp, projected_dsr_bp, outcome, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`)
      .bind(c.id, JSON.stringify(r.ruleset), JSON.stringify({ engine_version: ENGINE_VERSION, proposal, items: items.map((i) => ({ id: i.id, side: i.side, kind: i.kind, monthly_cents: i.monthly_cents, state: i.state, voided: !!i.voided_at, settle: i.settle_in_consolidation, settlement_doc: i.settlement_doc_id })), profile, docs }), JSON.stringify(r), r.current_dsr_bp, r.projected_dsr_bp, r.outcome, user.id).first<{ id: number }>();
    const pct = (bp: number | null) => (bp == null ? "-" : `${(bp / 100).toFixed(1)}%`);
    const bodyText = [
      `Net income: ${r.income_net_cents == null ? "not verified" : `RM ${(r.income_net_cents / 100).toFixed(2)}`}; commitments RM ${(r.commitments_cents / 100).toFixed(2)}.`,
      `Current DSR ${pct(r.current_dsr_bp)}; projected ${pct(r.projected_dsr_bp)}${r.instalment_cents != null ? ` (illustrative instalment RM ${(r.instalment_cents / 100).toFixed(2)})` : ""}.`,
      `Result: ${r.outcome.replace(/_/g, " ")} - preliminary. ${r.reasons.join(". ")}.`,
      ...(r.missing.length ? [`Missing: ${r.missing.join("; ")}.`] : []),
    ].join("\n");
    await env.DB.prepare(`INSERT INTO fa_notes (case_id, note_type, assessment_id, status_value, body, author_id, author_role) VALUES (?1, 'system', ?2, ?3, ?4, NULL, 'system')`).bind(c.id, row?.id, r.outcome, bodyText).run();
    await env.DB.prepare(`UPDATE fa_cases SET prescreen = ?1, stage = CASE WHEN stage IN ('intake', 'profile') THEN 'prescreen' ELSE stage END, updated_at = datetime('now') WHERE id = ?2`).bind(r.outcome, c.id).run();
    await event(env, c.id, "prescreen_completed", user.id, { outcome: r.outcome, assessment: row?.id });
    await audit(env, user.id, "fa.assess", "fa_assessments", String(row?.id), { case: c.case_ref, outcome: r.outcome });
    return json({ ok: true, assessment_id: row?.id, result: r }, 201);
  }

  /* ---- v1.288.0 the DSR workspace writes the figures as one set: unchanged lines stay, a changed
     line is replaced (its verification does not carry over), a missing line is removed - never edited ---- */
  if (sub === "figures" && method === "PUT") {
    if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    if (!(await consentsReady(env, c.id))) return err("consent_required", "Record the privacy notice and the assessment consent first.", 409);
    const raw = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : null;
    if (!raw || raw.length > 60) return err("invalid_input", "Send the figures as a list (at most 60).", 400);
    const existing = ((await env.DB.prepare(`SELECT i.*, m.lender_bank_id, m.lender_name, m.account_last4, m.facility_ref, m.remaining_months, m.duplicate_reason FROM fa_items i LEFT JOIN fa_item_meta m ON m.item_id = i.id WHERE i.case_id = ?1 AND i.voided_at IS NULL`).bind(c.id).all<Record<string, unknown>>()).results ?? []);
    type Line = { id: number | null; side: string; kind: string; monthly: number; label: string | null; source: string; arrears: number; lender_bank_id: number | null; lender_name: string | null; last4: string | null; ref: string | null; remaining: number | null; dup: string | null };
    const lines: Line[] = [];
    for (const [i, r] of raw.entries()) {
      const side = String(r.side ?? ""), kind = String(r.kind ?? "");
      if (!SIDES.includes(side) || !(KINDS[side] ?? []).includes(kind)) return err("invalid_input", `Line ${i + 1}: for ${side || "this side"}, kind is one of ${(KINDS[side] ?? []).join(", ")}`, 400);
      const monthly = cents(r.monthly_cents);
      if (monthly === null) return err("invalid_input", `Line ${i + 1}: enter the monthly amount in sen.`, 400);
      const last4 = r.account_last4 == null || r.account_last4 === "" ? null : String(r.account_last4);
      if (last4 !== null && !/^\d{4}$/.test(last4)) return err("invalid_input", `Line ${i + 1}: the account's last four digits only.`, 400);
      const rem = r.remaining_months == null || r.remaining_months === "" ? null : Number(r.remaining_months);
      if (rem !== null && !(Number.isInteger(rem) && rem >= 0 && rem <= 600)) return err("invalid_input", `Line ${i + 1}: remaining months is 0 to 600.`, 400);
      lines.push({ id: typeof r.id === "number" ? r.id : null, side, kind, monthly, label: str(r.label, 80) ? String(r.label).trim() : null,
        source: SOURCES.includes(String(r.source)) ? String(r.source) : "declared", arrears: r.arrears === true ? 1 : 0,
        lender_bank_id: typeof r.lender_bank_id === "number" ? r.lender_bank_id : null, lender_name: str(r.lender_name, 80) ? String(r.lender_name).trim() : null,
        last4, ref: str(r.facility_ref, 60) ? String(r.facility_ref).trim() : null, remaining: rem, dup: str(r.duplicate_reason, 300) ? String(r.duplicate_reason).trim() : null });
    }
    const byId = new Map(existing.map((e) => [Number(e.id), e]));
    for (const l of lines) if (l.id !== null && !byId.has(l.id)) return err("invalid_input", "A line names a figure that is not on this case (or was removed).", 400);
    /* the same commitment twice: same kind, lender, last four and amount - refused unless a reason says why */
    const lenderKey = (bankId: unknown, name: unknown) => (bankId != null ? `b${bankId}` : String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, ""));
    const seen = new Map<string, number>();
    for (const [i, l] of lines.entries()) {
      if (l.side !== "commitment") continue;
      const key = [l.kind, lenderKey(l.lender_bank_id, l.lender_name), l.last4 ?? "", l.monthly].join("|");
      if (seen.has(key) && !(l.dup && l.dup.length >= 10)) {
        return json({ error: { code: "possible_duplicate", message: `Line ${i + 1} looks like line ${seen.get(key)! + 1}: the same ${l.kind.replace(/_/g, " ")} with the same lender, account and amount. Remove it, or say why it is a second facility.` }, line: i }, 409);
      }
      seen.set(key, i);
    }
    const same = (l: Line, e: Record<string, unknown>) => l.side === e.side && l.kind === e.kind && l.monthly === Number(e.monthly_cents) && (l.label ?? null) === (e.label ?? null)
      && l.arrears === Number(e.arrears) && (l.lender_bank_id ?? null) === (e.lender_bank_id ?? null) && (l.lender_name ?? null) === (e.lender_name ?? null)
      && (l.last4 ?? null) === (e.account_last4 ?? null) && (l.remaining ?? null) === (e.remaining_months ?? null);
    const keep = new Set<number>(), stmts: D1PreparedStatement[] = [];
    let added = 0, replaced = 0;
    const insert = (l: Line) => {
      stmts.push(env.DB.prepare(`INSERT INTO fa_items (case_id, side, kind, label, monthly_cents, arrears, source, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
        .bind(c.id, l.side, l.kind, l.label, l.monthly, l.arrears, l.source, user.id));
      if (l.side === "commitment" && (l.lender_bank_id != null || l.lender_name || l.last4 || l.ref || l.remaining != null || l.dup)) {
        stmts.push(env.DB.prepare(`INSERT INTO fa_item_meta (item_id, lender_bank_id, lender_name, account_last4, facility_ref, remaining_months, duplicate_reason) VALUES (last_insert_rowid(), ?1, ?2, ?3, ?4, ?5, ?6)`)
          .bind(l.lender_bank_id, l.lender_name, l.last4, l.ref, l.remaining, l.dup));
      }
    };
    for (const l of lines) {
      if (l.id !== null) {
        const e = byId.get(l.id)!;
        if (same(l, e)) { keep.add(l.id); continue; }
        keep.add(l.id);
        stmts.push(env.DB.prepare(`UPDATE fa_items SET voided_at = datetime('now'), voided_by = ?1, void_reason = 'Revised in the DSR workspace' WHERE id = ?2 AND voided_at IS NULL`).bind(user.id, l.id));
        insert(l); replaced++;
      } else { insert(l); added++; }
    }
    let removed = 0;
    for (const e of existing) if (!keep.has(Number(e.id))) {
      stmts.push(env.DB.prepare(`UPDATE fa_items SET voided_at = datetime('now'), voided_by = ?1, void_reason = 'Removed in the DSR workspace' WHERE id = ?2 AND voided_at IS NULL`).bind(user.id, e.id));
      removed++;
    }
    if (stmts.length) await env.DB.batch(stmts);
    await event(env, c.id, "figures_saved", user.id, { added, replaced, removed });
    await audit(env, user.id, "fa.figures_save", "fa_cases", String(c.id), { case: c.case_ref, added, replaced, removed });
    await touch(env, c.id);
    return json({ ok: true, added, replaced, removed });
  }

  /* ---- v1.288.0 every saved assessment, newest first, with where it stands in review ---- */
  if (sub === "assessments" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.outcome, a.current_dsr_bp, a.projected_dsr_bp, a.ruleset, a.created_at, ${PERSON("u")} AS by_name, json_extract(a.result, '$.engine_version') AS engine_version,
              (SELECT r.action FROM fa_reviews r WHERE r.assessment_id = a.id ORDER BY r.id DESC LIMIT 1) AS review
         FROM fa_assessments a LEFT JOIN users u ON u.id = a.created_by WHERE a.case_id = ?1 ORDER BY a.id DESC`,
    ).bind(c.id).all();
    return json({ assessments: results ?? [] });
  }

  /* ---- v1.288.0 submit an assessment to Management ---- */
  if (sub === "review" && method === "POST") {
    if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    if (c.stage === "closed") return err("invalid_state", "This case is closed.", 409);
    const aid = typeof b.assessment_id === "number" ? b.assessment_id : NaN;
    const a = await env.DB.prepare(`SELECT id, outcome FROM fa_assessments WHERE id = ?1 AND case_id = ?2`).bind(aid, c.id).first<{ id: number; outcome: string }>();
    if (!a) return err("invalid_input", "Choose a saved assessment of this case.", 400);
    if (a.outcome === "incomplete") return err("invalid_state", "An assessment with missing information cannot be reviewed - complete it first.", 409);
    const st = await reviewState(env, c.id);
    if (st.pending) return err("already_pending", "This case is already waiting for Management.", 409);
    const note = str(b.note, 600) ? String(b.note).trim() : null;
    await env.DB.prepare(`INSERT INTO fa_reviews (case_id, assessment_id, action, reason, actor_id, actor_role) VALUES (?1, ?2, 'submitted', ?3, ?4, ?5)`).bind(c.id, a.id, note, user.id, user.role).run();
    await env.DB.prepare(`UPDATE fa_cases SET stage = CASE WHEN stage IN ('intake', 'profile', 'prescreen', 'matching') THEN 'review' ELSE stage END, updated_at = datetime('now') WHERE id = ?1`).bind(c.id).run();
    await event(env, c.id, "review_submitted", user.id, { assessment: a.id });
    await audit(env, user.id, "fa.review_submit", "fa_cases", String(c.id), { case: c.case_ref, assessment: a.id });
    const deciders = ((await env.DB.prepare(`SELECT id, role FROM users WHERE is_active = 1`).all<{ id: number; role: string }>()).results ?? []).filter((x) => can(x.role as StaffUser["role"], "fa_decide") && x.id !== user.id);
    for (const d of deciders) await notify(env, d.id, "fa", `${c.case_ref}: a DSR assessment is waiting for your review.`, `fa_review:${c.id}:${a.id}:${d.id}`, { once: true });
    return json({ ok: true }, 201);
  }

  /* ---- v1.288.0 Management decides - an internal decision, never a loan approval ---- */
  if (sub === "review" && method === "PUT") {
    if (!can(user.role, "fa_decide")) return err("forbidden", "Only the CEO, COO or CCO decides a review", 403);
    const st = await reviewState(env, c.id);
    if (!st.pending) return err("invalid_state", "Nothing is waiting for a decision on this case.", 409);
    if (st.submitted_by === user.id && !isExecutiveOwner(user)) {
      await audit(env, user.id, "auth.self_approval_refused", "fa_cases", String(c.id), { action: "fa.review_decide" });
      return err("self_approval", "You submitted this review - another manager decides it.", 403);
    }
    const decision = String(b.decision ?? "");
    if (!["proceed", "request_info", "concern", "unsuitable"].includes(decision)) return err("invalid_input", "decision is proceed, request_info, concern or unsuitable", 400);
    const reason = str(b.reason, 1000) ? String(b.reason).trim() : "";
    const min = decision === "concern" || decision === "unsuitable" ? 20 : 10;
    if (reason.length < min) return err("invalid_input", `Give the reason (at least ${min} characters).`, 400);
    const next = str(b.next_action, 300) ? String(b.next_action).trim() : null;
    if (decision === "request_info" && !next) return err("invalid_input", "Say what information is needed.", 400);
    await env.DB.prepare(`INSERT INTO fa_reviews (case_id, assessment_id, action, reason, next_action, actor_id, actor_role) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(c.id, st.assessment_id, decision, reason, next, user.id, user.role).run();
    if (decision === "proceed") await env.DB.prepare(`UPDATE fa_cases SET stage = 'matching', updated_at = datetime('now') WHERE id = ?1 AND stage != 'closed'`).bind(c.id).run();
    else if (decision === "request_info") await env.DB.prepare(`UPDATE fa_cases SET stage = 'profile', updated_at = datetime('now') WHERE id = ?1 AND stage != 'closed'`).bind(c.id).run();
    else if (decision === "unsuitable") await env.DB.prepare(`UPDATE fa_cases SET stage = 'closed', closed_reason = ?1, closed_at = datetime('now'), closed_by = ?2, updated_at = datetime('now') WHERE id = ?3`).bind(`Not suitable for further borrowing assessment: ${reason}`.slice(0, 300), user.id, c.id).run();
    if (decision === "request_info" && next) {
      const row = await env.DB.prepare(`INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline, link_kind, link_id) VALUES (?1, ?2, ?3, ?4, 'normal', NULL, 'fa_case', ?5) RETURNING id`)
        .bind(`${c.case_ref}: ${next}`.slice(0, 140), "Management asked for more information - open the case for the details.", c.owner_id, user.id, c.id).first<{ id: number }>();
      await event(env, c.id, "task_created", user.id, { task: row?.id });
    }
    await event(env, c.id, `review_${decision}`, user.id, { assessment: st.assessment_id });
    await audit(env, user.id, `fa.review_${decision}`, "fa_cases", String(c.id), { case: c.case_ref, assessment: st.assessment_id, reason });
    const WORD: Record<string, string> = { proceed: "approved for internal progression to banker matching (not a loan approval)", request_info: "more information requested", concern: "an affordability concern was recorded", unsuitable: "not progressed" };
    if (st.submitted_by) await notify(env, st.submitted_by, "fa", `${c.case_ref}: ${WORD[decision]}.`, `fa_decided:${c.id}:${st.submitted_id}`, { once: true });
    if (c.owner_id !== st.submitted_by) await notify(env, c.owner_id, "fa", `${c.case_ref}: ${WORD[decision]}.`, `fa_decided_o:${c.id}:${st.submitted_id}`, { once: true });
    return json({ ok: true, decision });
  }

  if (sub === "override" && method === "POST") {
    if (!can(user.role, "fa_decide")) return err("forbidden", "Only management overrides a pre-screen", 403);
    const to = String(b.outcome ?? "");
    if (!OUTCOMES.includes(to) || to === "incomplete") return err("invalid_input", "Choose the outcome you set.", 400);
    const reason = str(b.reason, 600) ? String(b.reason).trim() : "";
    if (reason.length < 20) return err("invalid_input", "Explain the override (at least 20 characters).", 400);
    await env.DB.prepare(`UPDATE fa_cases SET override_result = ?1, override_reason = ?2, override_by = ?3, override_at = datetime('now'), updated_at = datetime('now') WHERE id = ?4`).bind(to, reason, user.id, c.id).run();
    await event(env, c.id, "prescreen_overridden", user.id, { computed: c.prescreen, set: to });
    await audit(env, user.id, "fa.override", "fa_cases", String(c.id), { case: c.case_ref, computed: c.prescreen, set: to, reason });
    return json({ ok: true });
  }

  if (sub === "notes" && method === "POST") {
    const type = String(b.type ?? "");
    const text = str(b.body, 2000) ? String(b.body).trim() : "";
    if (text.length < 5) return err("invalid_input", "Write the note.", 400);
    /* v1.286.0 - the bank is the registry's: from the banker, or a bank_id */
    let bank: string | null = null, bankerId: number | null = null, branchId: number | null = null;
    if (typeof b.banker_id === "number") {
      const bkr = await env.DB.prepare(`SELECT bk.id, k.name AS bank FROM fa_bankers bk JOIN fa_banks k ON k.id = bk.bank_id WHERE bk.id = ?1`).bind(b.banker_id).first<{ id: number; bank: string }>();
      if (!bkr) return err("invalid_input", "Choose the banker from the directory.", 400);
      bank = bkr.bank; bankerId = bkr.id;
      if (typeof b.branch_id === "number") {
        const br = await env.DB.prepare(`SELECT a.branch_id FROM fa_banker_branches a WHERE a.banker_id = ?1 AND a.branch_id = ?2`).bind(bkr.id, b.branch_id).first();
        if (!br) return err("invalid_input", "That branch is not one of the banker's.", 400);
        branchId = b.branch_id;
      }
    } else if (typeof b.bank_id === "number") {
      bank = (await env.DB.prepare(`SELECT name FROM fa_banks WHERE id = ?1`).bind(b.bank_id).first<{ name: string }>())?.name ?? null;
      if (!bank) return err("invalid_input", "Choose the bank from the registry.", 400);
    }
    /* v1.290.0 (G5, G6) - the day the banker was actually contacted (not after today, not before the case),
       and the tenure an official decision letter states */
    const contactOn = b.contact_on === undefined || b.contact_on === null || b.contact_on === "" ? null : validDay(b.contact_on) ? String(b.contact_on) : "bad";
    if (contactOn === "bad" || (contactOn && (contactOn > mytToday() || contactOn < c.created_at.slice(0, 10)))) return err("invalid_input", "The contact date is a real day between the case's opening and today.", 400);
    const tenure = b.tenure_months === undefined || b.tenure_months === null || b.tenure_months === "" ? null : typeof b.tenure_months === "number" && Number.isInteger(b.tenure_months) && b.tenure_months > 0 && b.tenure_months <= 600 ? b.tenure_months : -1;
    if (tenure === -1) return err("invalid_input", "The tenure is whole months, 1 to 600, as the bank's letter states.", 400);
    const facts = async (noteId: number, contact: string | null, months: number | null) => {
      if (contact === null && months === null) return;
      await env.DB.prepare(`INSERT INTO fa_note_facts (note_id, contact_on, tenure_months) VALUES (?1, ?2, ?3)`).bind(noteId, contact, months).run();
    };
    if (type === "banker") {
      if (!(mayEdit(user, c) || (await isMember(env, c.id, user.id)))) return err("forbidden", "You cannot add notes to this case", 403);
      const status = String(b.status ?? "");
      if (!BANKER_STATUS.includes(status)) return err("invalid_input", `A banker's feedback is one of ${BANKER_STATUS.join(", ")} - never an approval.`, 400);
      if (!bank) return err("invalid_input", "Choose the banker (or the bank) from the registry.", 400);
      const source = ["call", "email", "whatsapp", "meeting", "other"].includes(String(b.source)) ? String(b.source) : "other";
      const row = await env.DB.prepare(`INSERT INTO fa_notes (case_id, note_type, bank, product, source, status_value, body, conditions, missing_documents, follow_up_on, evidence_id, author_id, author_role) VALUES (?1, 'banker', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) RETURNING id`)
        .bind(c.id, bank, str(b.product, 60) ? String(b.product) : c.product, source, status, text,
          str(b.conditions, 600) ? String(b.conditions) : null, str(b.missing_documents, 600) ? String(b.missing_documents) : null,
          validDay(b.follow_up_on) ? b.follow_up_on : null, await docOnCase(env, c.id, b.evidence_id), user.id, user.role).first<{ id: number }>();
      /* v1.288.0 - feedback on an enquiry links to it (and to its banker) */
      const enq = typeof b.enquiry_id === "number" ? await env.DB.prepare(`SELECT id, banker_id FROM fa_enquiries WHERE id = ?1 AND case_id = ?2`).bind(b.enquiry_id, c.id).first<{ id: number; banker_id: number }>() : null;
      if (enq) await env.DB.prepare(`UPDATE fa_enquiries SET state = 'feedback_received', updated_at = datetime('now') WHERE id = ?1 AND state IN ('sent', 'acknowledged', 'information_requested')`).bind(enq.id).run();
      if (bankerId || enq) await env.DB.prepare(`INSERT INTO fa_note_links (note_id, banker_id, branch_id, enquiry_id) VALUES (?1, ?2, ?3, ?4)`).bind(Number(row?.id), bankerId ?? enq?.banker_id ?? null, branchId, enq?.id ?? null).run();
      await facts(Number(row?.id), contactOn ?? mytToday(), null);
      /* a banker's word moves the banker status only - never the application */
      await env.DB.prepare(`UPDATE fa_cases SET banker_status = ?1, updated_at = datetime('now') WHERE id = ?2`).bind(status, c.id).run();
      await event(env, c.id, "banker_feedback", user.id, { bank, status });
      await audit(env, user.id, "fa.note_banker", "fa_notes", String(row?.id), { case: c.case_ref, bank, status });
      if (c.owner_id !== user.id) await notify(env, c.owner_id, "fa", `${c.case_ref}: banker feedback recorded.`, `fa_bf:${row?.id}`, { once: true });
      return json({ ok: true, id: row?.id }, 201);
    }
    if (type === "decision") {
      if (!can(user.role, "fa_decide")) return err("forbidden", "Only management records an official bank decision", 403);
      const status = String(b.status ?? "");
      if (!DECISIONS.includes(status)) return err("invalid_input", `An official decision is one of ${DECISIONS.join(", ")}`, 400);
      const ev = await docOnCase(env, c.id, b.evidence_id);
      if (!ev) return err("evidence_required", "Attach the bank's written decision (or disbursement proof) to this case first, then choose it.", 400);
      if (!bank) return err("invalid_input", "Name the bank.", 400);
      const row = await env.DB.prepare(`INSERT INTO fa_notes (case_id, note_type, bank, product, status_value, body, conditions, bank_reference, approved_cents, expires_on, evidence_id, author_id, author_role) VALUES (?1, 'decision', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) RETURNING id`)
        .bind(c.id, bank, str(b.product, 60) ? String(b.product) : c.product, status, text, str(b.conditions, 600) ? String(b.conditions) : null,
          str(b.bank_reference, 80) ? String(b.bank_reference) : null, cents(b.approved_cents), validDay(b.expires_on) ? b.expires_on : null, ev, user.id, user.role).first<{ id: number }>();
      /* the disbursed amount is a fact on the case - never A2Z revenue, never a cash row */
      await facts(Number(row?.id), null, tenure);
      await env.DB.prepare(`UPDATE fa_cases SET application_status = ?1, stage = CASE WHEN ?1 = 'disbursed' THEN 'disbursed' WHEN stage != 'closed' THEN 'decision' ELSE stage END, updated_at = datetime('now') WHERE id = ?2`).bind(status, c.id).run();
      await event(env, c.id, "bank_decision", user.id, { bank, status });
      await audit(env, user.id, "fa.note_decision", "fa_notes", String(row?.id), { case: c.case_ref, bank, status, evidence_id: ev });
      return json({ ok: true, id: row?.id }, 201);
    }
    return err("invalid_input", "type is banker or decision (system notes come from an assessment)", 400);
  }

  /* ---- v1.299.0 - FA 2.0 phase 2: one case update (directive 4E) ----
     A comment, a follow-up (an ordinary Task with its deadline - never a
     second follow-up engine), a supporting document already on the case, a
     blocker (urgent or not), the next action, what the case waits on. Each
     part is one append-only row with its author and time. The owner and
     management change everything; an assisting member may only comment. */
  if (sub === "updates" && method === "POST") {
    const edit = mayEdit(user, c);
    const member = edit || (await isMember(env, c.id, user.id));
    if (!member || !can(user.role, "fa_edit")) return err("forbidden", "Not a case you can update", 403);
    if (c.stage === "closed") return err("invalid_state", "A closed case takes no updates.", 409);
    const comment = str(b.comment, 1000) ? String(b.comment).trim() : "";
    const want = { follow: b.follow_up_on !== undefined, doc: b.document_id !== undefined, blocker: b.blocker !== undefined, next: b.next_action !== undefined, waiting: b.waiting_on !== undefined };
    if (!edit && Object.values(want).some(Boolean)) return err("forbidden", "An assisting member may add a comment; the owner or management changes the rest.", 403);
    if (!comment && !Object.values(want).some(Boolean)) return err("invalid_input", "Write a comment or change something.", 400);
    let fuDay: string | null = null, fuTitle = "", assignee = user.id;
    if (want.follow) {
      if (!validDay(b.follow_up_on) || b.follow_up_on < mytToday()) return err("invalid_input", "A follow-up date is today or later.", 400);
      fuDay = b.follow_up_on;
      fuTitle = str(b.follow_up_title, 120) ? String(b.follow_up_title).trim() : "";
      if (fuTitle.length < 3) return err("invalid_input", "Say what the follow-up is.", 400);
      if (typeof b.follow_up_to === "number" && b.follow_up_to !== user.id) {
        if (!(b.follow_up_to === c.owner_id || (await isMember(env, c.id, b.follow_up_to)))) return err("invalid_input", "A follow-up goes to the case owner or an assisting member.", 400);
        assignee = b.follow_up_to;
      }
    }
    const doc = want.doc ? await docOnCase(env, c.id, b.document_id) : null;
    if (want.doc && doc == null) return err("invalid_input", "That document is not on this case.", 400);
    const waiting = want.waiting ? (b.waiting_on === "" || b.waiting_on === null ? null : String(b.waiting_on)) : undefined;
    if (waiting !== undefined && waiting !== null && !(WAITING as readonly string[]).includes(waiting)) return err("invalid_input", "waiting_on is client, banker, management, paused or empty", 400);
    if (waiting === "paused" && !isAll(user)) return err("forbidden", "Only management pauses a case.", 403);
    const blocker = want.blocker ? (str(b.blocker, 300) ? String(b.blocker).trim() : "") : undefined;
    if (blocker !== undefined && blocker.length > 0 && blocker.length < 5) return err("invalid_input", "Describe the blocker (at least 5 characters), or send it empty to clear it.", 400);
    const next = want.next ? (str(b.next_action, 200) ? String(b.next_action).trim() : "") : undefined;
    let prev: Record<string, unknown> | null;
    try { prev = await env.DB.prepare(`SELECT * FROM fa_case_ops WHERE case_id = ?1`).bind(c.id).first(); }
    catch (e) { if (skew(e)) return err("not_ready", "Case updates open once the database update (0189-0190) is applied.", 503); throw e; }
    let taskId: number | null = null;
    if (fuDay) {
      const row = await env.DB.prepare(`INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline, link_kind, link_id) VALUES (?1, ?2, ?3, ?4, 'normal', ?5, 'fa_case', ?6) RETURNING id`)
        .bind(`${c.case_ref}: ${fuTitle}`, "Financial Advisory follow-up - open the case for the details.", assignee, user.id, fuDay, c.id).first<{ id: number }>();
      taskId = row?.id ?? null;
      await event(env, c.id, "task_created", user.id, { task: taskId, follow_up: fuDay });
      if (assignee !== user.id) await notify(env, assignee, "task", `${c.case_ref}: a follow-up for you on ${fuDay}.`, `fa_task:${taskId}`, { once: true });
    }
    const cols: Record<string, unknown> = {};
    if (waiting !== undefined) cols.waiting_on = waiting;
    if (blocker !== undefined) { cols.blocker = blocker || null; cols.blocker_urgent = blocker && b.blocker_urgent === true ? 1 : 0; }
    if (next !== undefined) cols.next_action = next || null;
    if (Object.keys(cols).length) await setOps(env, c.id, user, cols);
    if (comment) await logUpdate(env, c.id, user, "comment", { body: comment });
    if (fuDay) await logUpdate(env, c.id, user, "follow_up", { body: fuTitle, now: fuDay, task: taskId });
    if (doc != null) await logUpdate(env, c.id, user, "document", { doc, body: str(b.document_note, 200) ? String(b.document_note).trim() : null });
    if (blocker !== undefined) await logUpdate(env, c.id, user, "blocker", { old: (prev?.blocker as string | null) ?? null, now: blocker ? `${blocker}${cols.blocker_urgent ? " (urgent)" : ""}` : null });
    if (next !== undefined) await logUpdate(env, c.id, user, "next_action", { old: (prev?.next_action as string | null) ?? null, now: next || null });
    if (waiting !== undefined) await logUpdate(env, c.id, user, "waiting_on", { old: (prev?.waiting_on as string | null) ?? null, now: waiting });
    await touch(env, c.id);
    await audit(env, user.id, "fa.case_updated", "fa_cases", String(c.id), { case: c.case_ref, parts: Object.entries({ comment: !!comment, ...want }).filter(([, v]) => v).map(([k]) => k), task: taskId });
    return json({ ok: true, task_id: taskId, ...(await picture(env, user, (await caseOf(env, c.id))!)) }, 201);
  }

  /* ---- v1.299.0 - a management priority override (D-6: fa_priority = CEO, COO, CCO) ----
     With a reason; the computed priority stays beside it; clearing returns to
     the computed one. Never on a case the decider owns, the verified owner
     account apart. */
  if (sub === "priority" && method === "PUT") {
    if (!can(user.role, "fa_priority")) return err("forbidden", "Only management overrides a case's priority", 403);
    if (c.owner_id === user.id && !isExecutiveOwner(user)) {
      await audit(env, user.id, "auth.self_approval_refused", "fa_cases", String(c.id), { action: "fa.priority_override" });
      return err("self_approval", "This is your own case - another manager sets its priority.", 403);
    }
    if (c.stage === "closed") return err("invalid_state", "A closed case has no priority.", 409);
    const to = b.priority === null || b.priority === "" ? null : String(b.priority);
    if (to !== null && !(PRIORITIES as readonly string[]).includes(to)) return err("invalid_input", "priority is critical, high, normal, low, or empty to clear", 400);
    const reason = str(b.reason, 300) ? String(b.reason).trim() : "";
    if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
    let prev: { priority_override: string | null } | null;
    try { prev = await env.DB.prepare(`SELECT priority_override FROM fa_case_ops WHERE case_id = ?1`).bind(c.id).first(); }
    catch (e) { if (skew(e)) return err("not_ready", "Priority opens once the database update (0189-0190) is applied.", 503); throw e; }
    await setOps(env, c.id, user, { priority_override: to, priority_reason: to ? reason : null, priority_by: to ? user.id : null, priority_at: to ? new Date().toISOString().replace("T", " ").slice(0, 19) : null });
    await logUpdate(env, c.id, user, "priority", { body: reason, old: prev?.priority_override ?? null, now: to });
    await audit(env, user.id, "fa.priority_override", "fa_cases", String(c.id), { case: c.case_ref, from: prev?.priority_override ?? null, to, reason });
    return json({ ok: true, ...(await picture(env, user, (await caseOf(env, c.id))!)) });
  }

  if (sub === "tasks" && method === "POST") {
    if (!mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
    const title = str(b.title, 120) ? String(b.title).trim() : "";
    if (title.length < 3) return err("invalid_input", "Write the next action.", 400);
    let assignee = user.id;
    if (typeof b.assigned_to === "number" && b.assigned_to !== user.id) {
      const ok = b.assigned_to === c.owner_id || (await isMember(env, c.id, b.assigned_to));
      if (!ok) return err("invalid_input", "A case task goes to its owner or an assisting member.", 400);
      assignee = b.assigned_to;
    }
    /* the existing task engine: one task, linked to the case; its title carries the reference, not the client */
    const row = await env.DB.prepare(`INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline, link_kind, link_id) VALUES (?1, ?2, ?3, ?4, 'normal', ?5, 'fa_case', ?6) RETURNING id`)
      .bind(`${c.case_ref}: ${title}`, "Financial Advisory case task - open the case for the details.", assignee, user.id, validDay(b.deadline) ? b.deadline : null, c.id).first<{ id: number }>();
    await event(env, c.id, "task_created", user.id, { task: row?.id });
    if (assignee !== user.id) await notify(env, assignee, "task", `${c.case_ref}: a new case task for you.`, `fa_task:${row?.id}`, { once: true });
    return json({ ok: true, id: row?.id }, 201);
  }

  /* v1.288.0 - disclosures moved to fa-match.ts (dispatched above), behind the allocation and the client's consent */
  if (sub === "agreement" && method === "POST") {
    return err("legal_gate", "The client agreement is switched off: sending and signing stay off until legal review and the CEO's separate approval.", 409);
  }
  /* v1.298.0 - the fee is ON by the CEO's decision (13-11-2026), but nothing is
     billed from here: no rate in code, no invoice from an estimated
     eligibility. The fee follows a disbursement recorded with the bank's
     evidence, through Sales (quotation -> invoice -> CEO payment
     verification) - Phase 5 of the FA 2.0 blueprint. */
  if (sub === "fee" && method === "POST") {
    return err("fee_after_disbursement", "The advisory fee is approved, but it is billed only after a disbursement is recorded with the bank's evidence, through a Sales quotation and invoice (Phase 5). Nothing was billed.", 409);
  }
  return null;
}

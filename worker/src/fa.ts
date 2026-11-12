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
import { assess, type FaItem, type FaCriterion, type Product } from "./fa-engine";

/** Off until counsel clears each one (blueprint section 4). A constant on purpose. */
export const FA_LEGAL = { agreement: false, fee: false, disclosure: false, commission: false } as const;

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

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const validDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const skew = (e: unknown) => /no such (table|column)/i.test(String(e));
const cents = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000_000 ? v : null);
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;

interface Case {
  id: number; case_ref: string | null; customer_id: number; owner_id: number; agent_request_id: number | null; issuer_code: string; product: Product;
  purpose: string | null; stage: string; prescreen: string; banker_status: string; application_status: string; override_result: string | null;
  override_reason: string | null; closed_reason: string | null; created_at: string; updated_at: string;
}

const isAll = (u: StaffUser) => can(u.role, "fa_decide");

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
    notes: await q(`SELECT n.*, ${PERSON("u")} AS author FROM fa_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.case_id = ?1 ORDER BY n.id DESC`, c.id),
    events: await q(`SELECT e.id, e.event, e.detail, e.created_at, ${PERSON("u")} AS actor FROM fa_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.case_id = ?1 ORDER BY e.id`, c.id),
    tasks: await q(`SELECT t.id, t.title, t.deadline, t.status, ${PERSON("u")} AS assignee FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.link_kind = 'fa_case' AND t.link_id = ?1 ORDER BY t.id DESC`, c.id),
    members: await q(`SELECT m.user_id, ${PERSON("u")} AS name FROM fa_case_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.case_id = ?1`, c.id),
    can: { edit: mayEdit(u, c), decide: can(u.role, "fa_decide"), note: can(u.role, "fa_edit") || (await isMember(env, c.id, u.id)) },
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
      legal: FA_LEGAL,
      can: { create: can(user.role, "fa_edit"), decide: can(user.role, "fa_decide"), criteria: can(user.role, "fa_criteria") },
    });
  }

  /* ---- the client pipeline ---- */
  if (path === "/fa/cases" && method === "GET") {
    const scope = isAll(user) ? "" : " AND (c.owner_id = ?1 OR EXISTS (SELECT 1 FROM fa_case_members m WHERE m.case_id = c.id AND m.user_id = ?1))";
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.case_ref, c.product, c.stage, c.prescreen, c.banker_status, c.application_status, c.override_result, c.issuer_code, c.updated_at,
              cu.company AS client, ${PERSON("u")} AS owner,
              (SELECT a.projected_dsr_bp FROM fa_assessments a WHERE a.case_id = c.id ORDER BY a.id DESC LIMIT 1) AS projected_dsr_bp
         FROM fa_cases c LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN users u ON u.id = c.owner_id
        WHERE 1 = 1${scope} ORDER BY CASE WHEN c.stage = 'closed' THEN 1 ELSE 0 END, c.updated_at DESC LIMIT 500`,
    ).bind(...(isAll(user) ? [] : [user.id])).all();
    return json({ cases: results ?? [] });
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
      /* one verified version per family: the older one retires */
      await env.DB.prepare(`UPDATE fa_criteria SET state = 'retired' WHERE family = ?1 AND id != ?2 AND state = 'verified'`).bind(c.family, c.id).run();
    } else {
      await env.DB.prepare(`UPDATE fa_criteria SET state = 'retired' WHERE id = ?1`).bind(c.id).run();
    }
    await audit(env, user.id, `fa.criteria_${mCr[2]}`, "fa_criteria", String(c.id), { family: c.family, version: c.version, bank: c.bank });
    return json({ ok: true });
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
        sets.push(`stage = 'closed'`, `closed_reason = ?${vals.push(why)}`, `closed_at = datetime('now')`, `closed_by = ?${vals.push(user.id)}`);
      } else if (["agreement", "enquiry", "application", "fee"].includes(to)) {
        return err("legal_gate", "This step is switched off until counsel clears it (agreement, disclosure to banks, fee).", 409);
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
    const items = ((await env.DB.prepare(`SELECT * FROM fa_items WHERE case_id = ?1`).bind(c.id).all<FaItem>()).results ?? []);
    const profile = await env.DB.prepare(`SELECT employment_category, service_months, age_years FROM fa_profiles WHERE case_id = ?1 ORDER BY version DESC LIMIT 1`).bind(c.id).first<{ employment_category: string | null; service_months: number | null; age_years: number | null }>();
    const docs = ((await env.DB.prepare(`SELECT DISTINCT kind FROM fa_documents WHERE case_id = ?1 AND verified = 1 AND removed_at IS NULL`).bind(c.id).all<{ kind: string }>()).results ?? []).map((d) => d.kind);
    const proposal = { instalment_cents: cents(b.instalment_cents), amount_cents: cents(b.amount_cents), tenure_months: typeof b.tenure_months === "number" ? b.tenure_months : null, rate_bp: typeof b.rate_bp === "number" ? b.rate_bp : null };
    const r = assess({ product: c.product, items, profile, proposal, criteria: await liveCriteria(env), verifiedDocKinds: docs, today: mytToday() });
    const row = await env.DB.prepare(`INSERT INTO fa_assessments (case_id, ruleset, inputs, result, current_dsr_bp, projected_dsr_bp, outcome, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`)
      .bind(c.id, JSON.stringify(r.ruleset), JSON.stringify({ proposal, items: items.map((i) => ({ id: i.id, side: i.side, kind: i.kind, monthly_cents: i.monthly_cents, state: i.state, voided: !!i.voided_at, settle: i.settle_in_consolidation, settlement_doc: i.settlement_doc_id })), profile, docs }), JSON.stringify(r), r.current_dsr_bp, r.projected_dsr_bp, r.outcome, user.id).first<{ id: number }>();
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
      if (bankerId) await env.DB.prepare(`INSERT INTO fa_note_links (note_id, banker_id, branch_id) VALUES (?1, ?2, ?3)`).bind(Number(row?.id), bankerId, branchId).run();
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
      await env.DB.prepare(`UPDATE fa_cases SET application_status = ?1, stage = CASE WHEN ?1 = 'disbursed' THEN 'disbursed' WHEN stage != 'closed' THEN 'decision' ELSE stage END, updated_at = datetime('now') WHERE id = ?2`).bind(status, c.id).run();
      await event(env, c.id, "bank_decision", user.id, { bank, status });
      await audit(env, user.id, "fa.note_decision", "fa_notes", String(row?.id), { case: c.case_ref, bank, status, evidence_id: ev });
      return json({ ok: true, id: row?.id }, 201);
    }
    return err("invalid_input", "type is banker or decision (system notes come from an assessment)", 400);
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

  if (sub === "disclosures" && method === "POST") {
    /* written for the day counsel clears it; off until then (L1, L4) */
    if (!FA_LEGAL.disclosure) return err("legal_gate", "Sending client data to a bank is switched off until counsel clears the consent wording.", 409);
    return null;
  }
  if ((sub === "agreement" || sub === "fee") && method === "POST") {
    return err("legal_gate", "The client agreement and the proposed fee are switched off until counsel clears them.", 409);
  }
  return null;
}

/* v1.272.0 - SALES PAYMENT VERIFICATION (the CEO, 10-11-2026: "COO, CCO and
   authorized sales staff can report payments. They must not self-finalize
   paid status. Every payment requires CEO verification."; the audit in
   claude/PAYMENT-VERIFICATION-AUDIT.md, answers P1-P9 all as recommended).

   ONE PAYMENT RECORD. A report (invoice_payment_reports, migration 0181) is
   what a person SAID arrived, with its proof. It is not money. Only the CEO's
   verification turns it into money, by writing ONE row into the existing
   payment record, invoice_payments (0140), through the same conditional
   insert that keeps parts within the invoice total. Every figure that
   already reads invoice_payments (balance, debtors, cash received, Finance)
   therefore counts verified money only, and a rejected report never reaches
   them.

   ONE FINANCE INTEGRATION, ONE COMMISSION ENGINE. When verified payments
   reach the invoice total, the SERVER marks the invoice paid the existing
   way (bookCash under INV-<id>, the day of the last verified payment) and
   writes the Confirm Paid row as the verifier, then ensureLedger - so
   commission starts exactly as it always has, once.

   THE OWNER'S SWITCH. business_settings.payment_verification {on}. Off (the
   default) = today's behaviour exactly; on = Mark Paid, born-paid invoices
   and direct part payments are refused, and payments go through here.

   Rules, all on the server:
     report    payment_report; the COO, CCO and CEO on every invoice, anyone
               else only where they are the invoice's salesperson; amounts in
               sen; a reference for every method but cash; a reference
               already used in the same company flags "possible duplicate";
               more than the balance is accepted and flagged (never applied
               to another invoice); a repeated identical report returns the
               first one
     evidence  a report by someone who can verify (the CEO) waits for another
               person's bank-evidence check (payment_evidence, the COO), with
               a fresh code - the CEO, 10-11-2026, P3
     verify    payment_verify (the CEO) with a fresh code; never one's own
               report unless its evidence was checked by someone else; proof
               required; the receiving account must belong to the invoice's
               company (Companies review); a flagged duplicate needs a reason;
               at most the balance; a retry changes nothing
     reject / clarify / answer / reverse - each kept, never deleted; the
               timeline (invoice_payment_events) is append only

   v1.283.0 - PAYMENT VERIFICATION 3.0, TRACK B (the CEO, 11-11-2026,
   "Proceed" on claude/PAYMENT-VERIFICATION-3.0-BLUEPRINT.md, P3-P5):
     B1 verify is ONE atomic batch - the claim, the payment row and their
        link commit together or not at all, so a failure in between can
        never leave a "verified" report without its money
     B2 settlement resumes: every step is idempotent, and a verify that
        finds its report already verified finishes whatever is missing
     B3 the switch cannot go off while reports wait (it never bypasses a
        pending approval); staff.ts / business.ts refuse Mark Paid and part
        payments on an invoice with a pending report even when it is off
     B4 a receipt alone is not proof: new verifications are checked on the
        bank statement or in the bank app ("receipt only" stays readable)
     B5 "Verified this month" is the Malaysian month, summed in SQL
     B6 GET /payments/events - the cross-invoice audit trail, read only

   v1.285.0 - THE CEO'S PAID IS FINAL (the CEO, 12-11-2026: "COO and CCO able
   to click paid and verify by me (CEO). If I update the paid status, no
   further verification are required since I am a CEO!" and "need to know
   that when I click paid it is behalf of someone or it is belong to my own
   sales"):
     - the verifier is the verified company owner (role ceo + is_owner from
       the session, decision-policy.ts isExecutiveOwner), not any account
       with the CEO role
     - his own report needs no second person: no COO evidence check (P3 is
       withdrawn), proof optional; he verifies it himself with his code
     - every verification records whose sale it is - his own, or on behalf
       of the invoice's salesperson - in the timeline and the audit; when he
       marks a payment himself, the COO and CCO get a "For the record"
       notice and the salesperson is told it was done on their behalf
     - COO, CCO and Sales report (request Paid) exactly as before; only the
       CEO turns a report into money */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify, requireFreshTotp, revokePaidConfirmation, currentStaffSql } from "./staff";
import { json, err, audit, str, putGuarded } from "./shared";
import { can } from "./permissions";
import { bookCash, reverseLive } from "./cashbook";
import { ensureLedger } from "./commission";
import { isExecutiveOwner } from "./decision-policy";

const SETTING = "payment_verification";
/** who reports on every invoice (P2); anyone else holding payment_report reports only on their own invoices */
const REPORT_ALL_ROLES = ["ceo", "coo", "cco"];
const METHODS = ["bank_transfer", "online", "cash", "cheque", "other"] as const;
/* v1.283.0 (B4) - "receipt_only" is no longer accepted for a new verification */
const VERIFY_METHODS = ["bank_statement", "bank_app"] as const;
const PENDING = ["reported", "evidence_checked", "clarify"];
const PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const PROOF_MAX = 8 * 1024 * 1024;
/** v1.285.0 - the one person who turns a report into money: the verified company owner */
const verifier = (u: StaffUser) => can(u.role, "payment_verify") && isExecutiveOwner(u);

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const validDay = (d: unknown): d is string =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const rm = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const companyOf = (issuer: string | null | undefined) => (issuer === "a2z" ? "a2z" : "azoo");
const COMPANY_NAME: Record<string, string> = { a2z: "A2Z CREATIVE MARKETING", azoo: "AZ ONE OFFICIAL" };
/** a reference as a bank prints it: letters and digits only, upper case */
const normRef = (r: string) => r.toUpperCase().replace(/[^A-Z0-9]/g, "");
const skew = (e: unknown) => /no such (table|column)/i.test(String(e));

interface Report {
  id: number; invoice_id: number; issuer_code: string; amount_cents: number; received_on: string; method: string;
  reference: string | null; note: string | null; ref_key: string | null; over_cents: number; dup_of: number | null;
  proof_key: string | null; proof_type: string | null; state: string; reported_by: number; reported_at: string;
  evidence_by: number | null; evidence_at: string | null; evidence_note: string | null; question: string | null; answer: string | null;
  decided_by: number | null; decided_at: string | null; verify_method: string | null; verified_cents: number | null; bank_id: number | null;
  dup_reason: string | null; reason: string | null; payment_id: number | null; reversed_by: number | null; reversed_at: string | null; reverse_reason: string | null;
}
interface Inv { id: number; doc_number: string; doc_type: string; total_cents: number; payment_status: string | null; salesperson_id: number | null; issuer_code: string | null; customer: string | null; salesperson?: string | null }

/** The owner's switch. Off unless saved on. */
export async function paymentVerificationOn(env: Env): Promise<boolean> {
  try {
    const r = await env.DB.prepare(`SELECT value FROM business_settings WHERE key = ?1`).bind(SETTING).first<{ value: string }>();
    return !!r && (JSON.parse(r.value) as { on?: unknown }).on === true;
  } catch { return false; }
}

async function invoiceOf(env: Env, id: number): Promise<Inv | null> {
  return env.DB.prepare(
    `SELECT d.id, d.doc_number, d.doc_type, d.total_cents, d.payment_status, d.salesperson_id, d.issuer_code, cu.company AS customer,
            COALESCE(NULLIF(TRIM(sp.full_name), ''), sp.name) AS salesperson
       FROM sales_documents d LEFT JOIN customers cu ON cu.id = d.customer_id LEFT JOIN users sp ON sp.id = d.salesperson_id WHERE d.id = ?1`,
  ).bind(id).first<Inv>();
}

/** Verified money on an invoice: its live rows in the one payment record. */
async function verifiedOf(env: Env, invId: number): Promise<number> {
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM invoice_payments WHERE invoice_id = ?1 AND voided_at IS NULL`)
    .bind(invId).first<{ c: number }>();
  return Number(r?.c ?? 0);
}
async function pendingOf(env: Env, invId: number, exceptId = 0): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS c FROM invoice_payment_reports WHERE invoice_id = ?1 AND state IN ('reported', 'evidence_checked', 'clarify') AND id != ?2`,
  ).bind(invId, exceptId).first<{ c: number }>();
  return Number(r?.c ?? 0);
}

/** The invoice's payment state - calculated, never chosen. */
export function settlementOf(total: number, verified: number, pending: number, paid: boolean): string {
  if (paid || (total > 0 && verified >= total)) return "paid";
  if (verified === 0) return pending > 0 ? "reported" : "unpaid";
  return verified + pending >= total ? "fully_reported" : "partial";
}

/** may this person read this invoice's payments */
function seesInvoice(user: StaffUser, inv: Inv): boolean {
  if (can(user.role, "payment_verify") || can(user.role, "payment_evidence") || REPORT_ALL_ROLES.includes(user.role)) return true;
  return inv.salesperson_id === user.id;
}
function reportsOn(user: StaffUser, inv: Inv): boolean {
  if (!can(user.role, "payment_report")) return false;
  return REPORT_ALL_ROLES.includes(user.role) || inv.salesperson_id === user.id;
}

async function event(env: Env, invId: number, reportId: number | null, ev: string, actor: number | null, amount: number | null, detail: Record<string, unknown> | null, key: string | null = null): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO invoice_payment_events (invoice_id, report_id, event, actor_id, amount_cents, detail, event_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(invId, reportId, ev, actor, amount, detail ? JSON.stringify(detail) : null, key).run();
}

/** active people holding a permission (the verifiers, the evidence checkers) */
async function holders(env: Env, cap: string, exceptId = 0): Promise<number[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, role FROM users WHERE is_active = 1 AND ${currentStaffSql()} AND id != ?1`,
  ).bind(exceptId).all<{ id: number; role: string }>();
  return (results ?? []).filter((u) => can(u.role as StaffUser["role"], cap)).map((u) => u.id);
}

async function reportOf(env: Env, id: number): Promise<Report | null> {
  return env.DB.prepare(`SELECT * FROM invoice_payment_reports WHERE id = ?1`).bind(id).first<Report>();
}

/** The company a bank account belongs to - the Companies review decision, never a guess. */
async function bankCompany(env: Env, bankId: number): Promise<{ ok: boolean; active: boolean; company: string | null; name: string }> {
  const b = await env.DB.prepare(`SELECT id, name, active FROM bank_accounts WHERE id = ?1`).bind(bankId).first<{ id: number; name: string; active: number }>();
  if (!b) return { ok: false, active: false, company: null, name: "" };
  let company: string | null = null;
  try {
    const d = await env.DB.prepare(`SELECT proposed_company FROM company_review_decisions WHERE record_kind = 'bank_accounts' AND record_id = ?1`)
      .bind(bankId).first<{ proposed_company: string | null }>();
    company = d?.proposed_company ?? null;
  } catch { company = null; }
  return { ok: true, active: b.active === 1, company, name: b.name };
}

/** When verified payments reach the total: the invoice is paid, the existing way, once. */
async function settle(env: Env, user: StaffUser, inv: Inv, bankId: number | null, ref: string | null): Promise<boolean> {
  const verified = await verifiedOf(env, inv.id);
  if (verified < inv.total_cents) return false;
  if (inv.payment_status === "void") return false;
  const last = await env.DB.prepare(`SELECT MAX(received_on) AS d, (SELECT method FROM invoice_payments WHERE invoice_id = ?1 AND voided_at IS NULL ORDER BY received_on DESC, id DESC LIMIT 1) AS m FROM invoice_payments WHERE invoice_id = ?1 AND voided_at IS NULL`)
    .bind(inv.id).first<{ d: string | null; m: string | null }>();
  const paidOn = last?.d && validDay(last.d) ? last.d : mytToday();
  const method = ["bank_transfer", "cash", "cheque"].includes(String(last?.m)) ? String(last?.m) : "other";
  /* the stored day at 04:00 UTC = midday MYT, as Mark Paid stores it */
  const r = await env.DB.prepare(
    `UPDATE sales_documents SET payment_status = 'paid', payment_method = ?1, payment_ref = ?2, paid_at = ?3
      WHERE id = ?4 AND doc_type = 'INV' AND COALESCE(payment_status, 'unpaid') NOT IN ('paid', 'void')`,
  ).bind(method, ref ? ref.slice(0, 120) : null, `${paidOn} 04:00:00`, inv.id).run();
  if (!Number(r.meta?.changes ?? 0)) {
    /* v1.283.0 (B2) - already paid: when verified payments paid it, the
       steps below are each idempotent, so a settlement that stopped half
       way (a Worker failure after "paid") is finished here, never doubled */
    const cur = await env.DB.prepare(`SELECT payment_status FROM sales_documents WHERE id = ?1`).bind(inv.id).first<{ payment_status: string | null }>();
    if (cur?.payment_status !== "paid") return false;
  }
  /* the one finance integration: the same booking Mark Paid makes (INV-<id>; never a second live row) */
  await bookCash(env, user.id, `INV-${inv.id}`, inv.total_cents, "sales", `Invoice ${inv.doc_number} paid`, "in", paidOn);
  if (bankId) {
    await env.DB.prepare(
      `INSERT INTO cashbook_marks (item_key, bank_id, bank_note, bank_by, bank_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))
       ON CONFLICT(item_key) DO UPDATE SET bank_id = excluded.bank_id, bank_note = excluded.bank_note, bank_by = excluded.bank_by, bank_at = excluded.bank_at`,
    ).bind(`INV:${inv.id}`, bankId, "Payment verification", user.id).run().catch(() => undefined);
  }
  /* the verification IS the confirmation: the CEO checked every payment */
  const conf = await env.DB.prepare(
    `INSERT OR IGNORE INTO invoice_paid_confirmations (invoice_id, amount_cents, payment_ref, paid_at, confirmed_by)
     SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM sales_documents WHERE id = ?1 AND doc_type = 'INV' AND payment_status = 'paid' AND total_cents = ?2)
     RETURNING id`,
  ).bind(inv.id, inv.total_cents, ref, `${paidOn} 04:00:00`, user.id).first<{ id: number }>();
  if (conf?.id) {
    await audit(env, user.id, "invoice.paid_confirm", "sales_documents", String(inv.id), {
      invoice: inv.doc_number, amount_cents: inv.total_cents, payment_ref: ref, paid_at: `${paidOn} 04:00:00`, via: "payment_verification",
    });
  }
  await ensureLedger(env, inv.id);
  if (conf?.id) {
    await event(env, inv.id, null, "invoice_paid", user.id, inv.total_cents, { paid_on: paidOn }, `paid:${inv.id}:${conf.id}`);
    if (inv.salesperson_id) await notify(env, inv.salesperson_id, "payment", `${inv.doc_number} is paid in full - every payment verified by the CEO.`, `pay_paid:${inv.id}:${conf.id}`, { once: true });
  }
  return true;
}

/** The figures of one invoice, for its drawer and after every action. */
async function picture(env: Env, inv: Inv, user: StaffUser) {
  const verified = await verifiedOf(env, inv.id);
  const pending = await pendingOf(env, inv.id);
  const { results: reports } = await env.DB.prepare(
    `SELECT r.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS reporter, COALESCE(NULLIF(TRIM(e.full_name), ''), e.name) AS evidence_name,
            COALESCE(NULLIF(TRIM(v.full_name), ''), v.name) AS decided_name, b.name AS bank_name, u.role AS reporter_role
       FROM invoice_payment_reports r LEFT JOIN users u ON u.id = r.reported_by LEFT JOIN users e ON e.id = r.evidence_by
       LEFT JOIN users v ON v.id = r.decided_by LEFT JOIN bank_accounts b ON b.id = r.bank_id
      WHERE r.invoice_id = ?1 ORDER BY r.id DESC`,
  ).bind(inv.id).all<Report & { reporter: string | null; reporter_role: string | null }>();
  const { results: events } = await env.DB.prepare(
    `SELECT ev.id, ev.report_id, ev.event, ev.amount_cents, ev.detail, ev.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS actor
       FROM invoice_payment_events ev LEFT JOIN users u ON u.id = ev.actor_id WHERE ev.invoice_id = ?1 ORDER BY ev.id`,
  ).bind(inv.id).all();
  const paid = inv.payment_status === "paid";
  return {
    invoice: { id: inv.id, doc_number: inv.doc_number, customer: inv.customer, total_cents: inv.total_cents, payment_status: inv.payment_status, company: companyOf(inv.issuer_code), company_name: COMPANY_NAME[companyOf(inv.issuer_code)], salesperson_id: inv.salesperson_id, salesperson: inv.salesperson ?? null },
    verified_cents: paid ? Math.max(verified, inv.total_cents) : verified,
    pending_cents: pending,
    outstanding_cents: paid ? 0 : Math.max(0, inv.total_cents - verified),
    status: settlementOf(inv.total_cents, verified, pending, paid),
    /* v1.285.0 - no report waits for a second person's evidence check any more */
    reports: (reports ?? []).map((r) => ({ ...r, proof_key: undefined, has_proof: !!r.proof_key, mine: r.reported_by === user.id, needs_evidence: false })),
    events: events ?? [],
    can_report: reportsOn(user, inv) && !paid && inv.payment_status !== "void",
  };
}

export async function handlePayments(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser,
  params: URLSearchParams, request: Request,
): Promise<Response | null> {
  /* ---- the owner's switch ---- */
  if (path === "/payments/settings" && method === "PUT") {
    if (user.role !== "ceo" || user.is_owner !== true) return err("forbidden", "Only the company owner switches payment verification on or off", 403);
    if (typeof body?.on !== "boolean") return err("invalid_input", "on is true or false", 400);
    const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
    if (reason.length < 5) return err("invalid_input", "Give a reason (5 to 300 characters)", 400);
    try { await env.DB.prepare(`SELECT id FROM invoice_payment_reports LIMIT 1`).first(); } catch (e) {
      if (skew(e)) return err("migration_missing", "Run migration 0181 first (PUSH.bat).", 503);
      throw e;
    }
    /* v1.283.0 (B3) - switching off never bypasses a pending approval */
    if (body!.on === false) {
      const waiting = await env.DB.prepare(`SELECT COUNT(*) AS n FROM invoice_payment_reports WHERE state IN ('reported', 'evidence_checked', 'clarify')`).first<{ n: number }>();
      const nWait = Number(waiting?.n ?? 0);
      if (nWait > 0) return err("pending_reports", `${nWait} reported payment${nWait === 1 ? " still waits" : "s still wait"} for a decision. Verify, reject or ask about ${nWait === 1 ? "it" : "them"} first - switching off never bypasses a pending verification.`, 409);
    }
    const stepUp = await requireFreshTotp(env, user, body?.totp, err, "switch payment verification");
    if (stepUp) return stepUp;
    const before = await paymentVerificationOn(env);
    await env.DB.prepare(`INSERT INTO business_settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(SETTING, JSON.stringify({ on: body!.on }), user.id).run();
    await audit(env, user.id, "payment.settings", "business_settings", SETTING, { before: { on: before }, after: { on: body!.on }, reason });
    return json({ ok: true, on: body!.on });
  }

  /* ---- v1.283.0 (B6) - the audit trail across invoices, newest first, read only ---- */
  if (path === "/payments/events" && method === "GET") {
    if (!can(user.role, "payment_verify") && !can(user.role, "payment_evidence") && !REPORT_ALL_ROLES.includes(user.role)) {
      return err("forbidden", "Only the CEO, COO and CCO read the payment audit trail", 403);
    }
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));
    const before = Number(params.get("before") ?? 0);
    try {
      const { results } = await env.DB.prepare(
        `SELECT ev.id, ev.invoice_id, ev.report_id, ev.event, ev.amount_cents, ev.detail, ev.created_at, d.doc_number,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS actor
           FROM invoice_payment_events ev LEFT JOIN users u ON u.id = ev.actor_id LEFT JOIN sales_documents d ON d.id = ev.invoice_id
          WHERE (?1 = 0 OR ev.id < ?1) ORDER BY ev.id DESC LIMIT ?2`,
      ).bind(before > 0 ? before : 0, limit).all();
      return json({ events: results ?? [] });
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run migration 0181 first (PUSH.bat).", 503);
      throw e;
    }
  }

  /* ---- the Payments tab: the queue, the open invoices, the tiles ---- */
  if (path === "/payments" && method === "GET") {
    if (!can(user.role, "sales") && !can(user.role, "exec_view") && !can(user.role, "payment_report")) return err("forbidden", "Sales access required", 403);
    const on = await paymentVerificationOn(env);
    const all = can(user.role, "payment_verify") || can(user.role, "payment_evidence") || REPORT_ALL_ROLES.includes(user.role);
    const caps = {
      report: can(user.role, "payment_report"), verify: verifier(user), evidence: false,
      switch: user.role === "ceo" && user.is_owner === true, all,
    };
    let reports: unknown[] = [];
    let invoices: Array<Record<string, unknown>> = [];
    let ready = true;
    try {
      const scope = all ? "" : " AND (d.salesperson_id = ?1 OR r.reported_by = ?1)";
      reports = (await env.DB.prepare(
        `SELECT r.id, r.invoice_id, r.issuer_code, r.amount_cents, r.received_on, r.method, r.reference, r.over_cents, r.dup_of, r.state,
                r.reported_by, r.reported_at, r.evidence_by, r.decided_at, r.verified_cents, r.question, r.proof_key IS NOT NULL AS has_proof,
                d.doc_number, d.total_cents, d.payment_status, d.salesperson_id, cu.company AS customer,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS reporter, u.role AS reporter_role, COALESCE(NULLIF(TRIM(s.full_name), ''), s.name) AS salesperson
           FROM invoice_payment_reports r JOIN sales_documents d ON d.id = r.invoice_id
           LEFT JOIN customers cu ON cu.id = d.customer_id LEFT JOIN users u ON u.id = r.reported_by LEFT JOIN users s ON s.id = d.salesperson_id
          WHERE 1 = 1${scope} ORDER BY CASE WHEN r.state IN ('reported', 'evidence_checked', 'clarify') THEN 0 ELSE 1 END, r.id DESC LIMIT 300`,
      ).bind(...(all ? [] : [user.id])).all()).results ?? [];
    } catch (e) {
      if (!skew(e)) throw e;
      ready = false;
    }
    {
      const scope = all ? "" : " AND d.salesperson_id = ?1";
      invoices = ((await env.DB.prepare(
        `SELECT d.id, d.doc_number, d.total_cents, d.payment_status, d.issuer_code, d.salesperson_id, d.created_at, cu.company AS customer,
                COALESCE(NULLIF(TRIM(s.full_name), ''), s.name) AS salesperson,
                COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL), 0) AS verified_cents
           FROM sales_documents d LEFT JOIN customers cu ON cu.id = d.customer_id LEFT JOIN users s ON s.id = d.salesperson_id
          WHERE d.doc_type = 'INV' AND COALESCE(d.payment_status, 'unpaid') NOT IN ('paid', 'void')${scope} ORDER BY d.id DESC LIMIT 300`,
      ).bind(...(all ? [] : [user.id])).all()).results ?? []) as Array<Record<string, unknown>>;
    }
    const pendingBy = new Map<number, number>();
    for (const r of reports as Array<{ invoice_id: number; amount_cents: number; state: string }>) {
      if (PENDING.includes(r.state)) pendingBy.set(r.invoice_id, (pendingBy.get(r.invoice_id) ?? 0) + Number(r.amount_cents));
    }
    invoices = invoices.map((i) => {
      const verified = Number(i.verified_cents ?? 0), pending = pendingBy.get(Number(i.id)) ?? 0, total = Number(i.total_cents ?? 0);
      return { ...i, company: companyOf(i.issuer_code as string | null), pending_cents: pending, outstanding_cents: Math.max(0, total - verified), status: settlementOf(total, verified, pending, false), can_report: reportsOn(user, i as unknown as Inv) };
    });
    const month = mytToday().slice(0, 7);
    const pend = (reports as Array<{ state: string; amount_cents: number }>).filter((r) => PENDING.includes(r.state));
    /* v1.283.0 (B5) - the Malaysian month (decided_at is UTC), every verified report, summed in SQL */
    let verifiedMonth = 0;
    if (ready) {
      const scopeM = all ? "" : " AND (d.salesperson_id = ?2 OR r.reported_by = ?2)";
      const vm = await env.DB.prepare(
        `SELECT COALESCE(SUM(r.verified_cents), 0) AS c FROM invoice_payment_reports r JOIN sales_documents d ON d.id = r.invoice_id
          WHERE r.state = 'verified' AND substr(datetime(r.decided_at, '+8 hours'), 1, 7) = ?1${scopeM}`,
      ).bind(...(all ? [month] : [month, user.id])).first<{ c: number }>();
      verifiedMonth = Number(vm?.c ?? 0);
    }
    let banks: unknown[] = [];
    if (caps.verify) {
      banks = ((await env.DB.prepare(`SELECT id, name, bank, number_masked FROM bank_accounts WHERE active = 1 ORDER BY name`).all<{ id: number; name: string; bank: string; number_masked: string }>()).results ?? []);
      const withCo = [];
      for (const b of banks as Array<{ id: number }>) withCo.push({ ...b, company: (await bankCompany(env, b.id)).company });
      banks = withCo;
    }
    return json({
      on, ready, can: caps, banks, reports: (reports as Array<Record<string, unknown>>).map((r) => ({ ...r, has_proof: !!r.has_proof, mine: r.reported_by === user.id, needs_evidence: false })),
      invoices,
      tiles: {
        pending_cents: pend.reduce((a, r) => a + Number(r.amount_cents), 0), pending_count: pend.length,
        verified_month_cents: verifiedMonth,
        outstanding_cents: invoices.reduce((a, i) => a + Number(i.outstanding_cents ?? 0), 0), outstanding_invoices: invoices.length,
        partial_invoices: invoices.filter((i) => i.status === "partial" || i.status === "fully_reported").length,
      },
    });
  }

  /* ---- one invoice: report a payment, or read its picture ---- */
  const mDoc = path.match(/^\/docs\/(\d+)\/payment-reports$/);
  if (mDoc) {
    const inv = await invoiceOf(env, Number(mDoc[1]));
    if (!inv || inv.doc_type !== "INV") return err("not_found", "Invoice not found", 404);
    if (method === "GET") {
      if (!seesInvoice(user, inv)) return err("forbidden", "Not an invoice you can see payments for", 403);
      try { return json(await picture(env, inv, user)); } catch (e) {
        if (skew(e)) return err("migration_missing", "Run migration 0181 first (PUSH.bat).", 503);
        throw e;
      }
    }
    if (method !== "POST") return null;
    if (!(await paymentVerificationOn(env))) return err("payment_verification_off", "Payment verification is switched off - payments are recorded the existing way.", 409);
    if (!can(user.role, "payment_report")) return err("forbidden", "You cannot report payments", 403);
    if (!reportsOn(user, inv)) return err("forbidden", `${inv.doc_number} is not your invoice - its salesperson, the COO or the CCO reports its payments.`, 403);
    if (inv.payment_status === "void") return err("voided", `${inv.doc_number} is void - no payment can be reported on it.`, 409);
    if (inv.payment_status === "paid") return err("invalid_input", `${inv.doc_number} is already paid in full.`, 400);
    const amount = typeof body?.amount_cents === "number" ? body.amount_cents : NaN;
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000_000) return err("invalid_input", "Enter the amount received, in sen, more than RM 0.00.", 400);
    const on = body?.received_on;
    if (!validDay(on) || on > mytToday()) return err("invalid_input", "The day the money was received must be a real date, today or earlier.", 400);
    const m = String(body?.method ?? "");
    if (!(METHODS as readonly string[]).includes(m)) return err("invalid_input", `method is one of ${METHODS.join(", ")}`, 400);
    const ref = typeof body?.reference === "string" ? body.reference.trim() : "";
    if (m !== "cash" && !/^[A-Za-z0-9][A-Za-z0-9 ./#_-]{2,59}$/.test(ref)) {
      return err("invalid_reference", "Enter the bank or payment reference (3 to 60 letters, digits, spaces, . / # _ -).", 400);
    }
    if (ref && !/^[A-Za-z0-9 ./#_-]{0,60}$/.test(ref)) return err("invalid_reference", "The reference has characters a bank does not print.", 400);
    const note = str(body?.note, 300) ? String(body!.note).trim() : null;
    const company = companyOf(inv.issuer_code);
    const refKey = ref && normRef(ref).length >= 3 ? `${company}|${normRef(ref)}` : null;
    try {
      /* the same report sent twice (a double tap, an offline retry) is the first one */
      const same = await env.DB.prepare(
        `SELECT id FROM invoice_payment_reports WHERE invoice_id = ?1 AND reported_by = ?2 AND amount_cents = ?3 AND received_on = ?4
            AND COALESCE(ref_key, '') = COALESCE(?5, '') AND state IN ('reported', 'evidence_checked', 'clarify') LIMIT 1`,
      ).bind(inv.id, user.id, amount, on, refKey).first<{ id: number }>();
      if (same) return json({ ok: true, id: same.id, repeated: true, ...(await picture(env, inv, user)) });
      /* a reference already used in this company: flagged, never refused (a review path) */
      let dupOf: number | null = null;
      if (refKey) {
        const d1 = await env.DB.prepare(`SELECT id FROM invoice_payment_reports WHERE ref_key = ?1 AND state NOT IN ('rejected') ORDER BY id LIMIT 1`).bind(refKey).first<{ id: number }>();
        dupOf = d1?.id ?? null;
        if (!dupOf) {
          const { results } = await env.DB.prepare(
            `SELECT p.reference, d.issuer_code FROM invoice_payments p JOIN sales_documents d ON d.id = p.invoice_id WHERE p.voided_at IS NULL AND p.reference IS NOT NULL`,
          ).all<{ reference: string; issuer_code: string | null }>();
          if ((results ?? []).some((p) => companyOf(p.issuer_code) === company && normRef(p.reference) === normRef(ref))) dupOf = 0;
        }
      }
      const verified = await verifiedOf(env, inv.id);
      const pending = await pendingOf(env, inv.id);
      const over = Math.max(0, amount - Math.max(0, inv.total_cents - verified - pending));
      const row = await env.DB.prepare(
        `INSERT INTO invoice_payment_reports (invoice_id, issuer_code, amount_cents, received_on, method, reference, note, ref_key, over_cents, dup_of, reported_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id`,
      ).bind(inv.id, company, amount, on, m, ref || null, note, refKey, over, dupOf, user.id).first<{ id: number }>();
      const id = Number(row?.id);
      await event(env, inv.id, id, "reported", user.id, amount, { method: m, reference: ref || null, received_on: on, over_cents: over, possible_duplicate: dupOf !== null }, `reported:${id}`);
      await audit(env, user.id, "payment.reported", "invoice_payment_reports", String(id), { invoice: inv.doc_number, amount_cents: amount, received_on: on, method: m, over_cents: over, possible_duplicate: dupOf !== null });
      /* who acts next: the CEO - unless the CEO reported it himself (v1.285.0: he decides it, nobody else checks it) */
      if (!verifier(user)) {
        for (const uid of await holders(env, "payment_verify", user.id)) await notify(env, uid, "payment", `Payment to verify: ${rm(amount)} on ${inv.doc_number}, reported by ${user.name}.`, `pay_report:${id}:${uid}`, { once: true });
      }
      return json({ ok: true, id, over_cents: over, possible_duplicate: dupOf !== null, ...(await picture(env, inv, user)) }, 201);
    } catch (e) {
      if (skew(e)) return err("migration_missing", "Run migration 0181 first (PUSH.bat).", 503);
      throw e;
    }
  }

  /* ---- one report ---- */
  const mR = path.match(/^\/payment-reports\/(\d+)\/(proof|evidence|verify|reject|clarify|answer|reverse)$/);
  if (!mR) return null;
  const rid = Number(mR[1]);
  const action = mR[2]!;
  let rep: Report | null;
  try { rep = await reportOf(env, rid); } catch (e) {
    if (skew(e)) return err("migration_missing", "Run migration 0181 first (PUSH.bat).", 503);
    throw e;
  }
  if (!rep) return err("not_found", "Payment report not found", 404);
  const inv = await invoiceOf(env, rep.invoice_id);
  if (!inv) return err("not_found", "Invoice not found", 404);

  if (action === "proof" && method === "GET") {
    if (rep.reported_by !== user.id && !seesInvoice(user, inv)) return err("forbidden", "Not a payment you can see", 403);
    if (!rep.proof_key) return err("not_found", "No proof attached", 404);
    const obj = await env.MEDIA.get(rep.proof_key);
    if (!obj) return err("not_found", "Proof file missing", 404);
    return new Response(obj.body, { headers: { "Content-Type": rep.proof_type ?? "application/octet-stream", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
  }
  if (method !== "POST") return null;
  if (!(await paymentVerificationOn(env))) return err("payment_verification_off", "Payment verification is switched off.", 409);

  if (action === "proof") {
    if (rep.reported_by !== user.id) return err("forbidden", "Only the person who reported the payment attaches its proof", 403);
    if (!["reported", "clarify"].includes(rep.state)) return err("invalid_state", "Proof can be attached only while the payment waits for review.", 409);
    const ct = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!PROOF_TYPES.includes(ct)) return err("invalid_input", "Only a PDF, JPEG or PNG proof is accepted", 400);
    if (!request.body) return err("invalid_input", "The proof file is missing", 400);
    const key = `payments/${rid}-proof-${Date.now()}`;
    const rejected = await putGuarded(env.MEDIA, key, request, { max: PROOF_MAX, contentType: ct });
    if (rejected) return rejected;
    await env.DB.prepare(`UPDATE invoice_payment_reports SET proof_key = ?1, proof_type = ?2, updated_at = datetime('now') WHERE id = ?3 AND state IN ('reported', 'clarify')`)
      .bind(key, ct, rid).run();
    await event(env, inv.id, rid, "proof_uploaded", user.id, null, { type: ct });
    await audit(env, user.id, "payment.proof", "invoice_payment_reports", String(rid), { invoice: inv.doc_number });
    return json({ ok: true });
  }

  if (action === "answer") {
    if (rep.reported_by !== user.id) return err("forbidden", "Only the person who reported the payment answers the question", 403);
    if (rep.state !== "clarify") return err("invalid_state", "There is no open question on this payment.", 409);
    const answer = str(body?.answer, 600) ? String(body!.answer).trim() : "";
    if (answer.length < 3) return err("invalid_input", "Write your answer.", 400);
    /* an answer may change the facts, so any evidence check is done again */
    const r = await env.DB.prepare(
      `UPDATE invoice_payment_reports SET state = 'reported', answer = ?1, evidence_by = NULL, evidence_at = NULL, evidence_note = NULL, updated_at = datetime('now') WHERE id = ?2 AND state = 'clarify'`,
    ).bind(answer, rid).run();
    if (!Number(r.meta?.changes ?? 0)) return err("conflict", "This payment changed - reload it.", 409);
    await event(env, inv.id, rid, "clarification_answered", user.id, null, { answer });
    await audit(env, user.id, "payment.answered", "invoice_payment_reports", String(rid), { invoice: inv.doc_number });
    const next = await holders(env, "payment_verify", user.id);
    for (const uid of next) await notify(env, uid, "payment", `${user.name} answered your question on ${inv.doc_number}.`, `pay_answer:${rid}:${uid}:${Date.now()}`);
    return json({ ok: true, ...(await picture(env, inv, user)) });
  }

  if (action === "evidence") {
    if (!can(user.role, "payment_evidence")) return err("forbidden", "You do not check payment evidence", 403);
    /* v1.285.0 - the CEO's own payment needs no second person's check */
    return err("not_needed", "No evidence check is needed: the CEO's own payment is final when the CEO verifies it.", 409);
  }

  /* everything below is the verifier's */
  if (!verifier(user)) {
    if (can(user.role, "payment_verify")) await audit(env, user.id, "auth.payment_verify_refused", "invoice_payment_reports", String(rid), { action, reason: "not the company owner" });
    return err("forbidden", "Only the CEO (the company owner) verifies payments", 403);
  }

  if (action === "clarify") {
    if (!["reported", "evidence_checked"].includes(rep.state)) return err("invalid_state", "Only a payment waiting for review can be questioned.", 409);
    const q = str(body?.question, 600) ? String(body!.question).trim() : "";
    if (q.length < 5) return err("invalid_input", "Write your question (at least 5 characters).", 400);
    const r = await env.DB.prepare(`UPDATE invoice_payment_reports SET state = 'clarify', question = ?1, answer = NULL, updated_at = datetime('now') WHERE id = ?2 AND state IN ('reported', 'evidence_checked')`)
      .bind(q, rid).run();
    if (!Number(r.meta?.changes ?? 0)) return err("conflict", "This payment changed - reload it.", 409);
    await event(env, inv.id, rid, "clarification_requested", user.id, null, { question: q });
    await audit(env, user.id, "payment.clarify", "invoice_payment_reports", String(rid), { invoice: inv.doc_number, question: q });
    if (rep.reported_by !== user.id) await notify(env, rep.reported_by, "payment", `Question on your payment for ${inv.doc_number}: ${q.slice(0, 120)}`, `pay_q:${rid}:${Date.now()}`);
    return json({ ok: true, ...(await picture(env, inv, user)) });
  }

  if (action === "reject") {
    if (!["reported", "evidence_checked", "clarify"].includes(rep.state)) return err("invalid_state", "Only a payment waiting for review can be rejected.", 409);
    const reason = str(body?.reason, 600) ? String(body!.reason).trim() : "";
    if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
    const stepUp = await requireFreshTotp(env, user, body?.totp, err, "reject this payment");
    if (stepUp) return stepUp;
    const r = await env.DB.prepare(
      `UPDATE invoice_payment_reports SET state = 'rejected', reason = ?1, decided_by = ?2, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?3 AND state IN ('reported', 'evidence_checked', 'clarify')`,
    ).bind(reason, user.id, rid).run();
    if (!Number(r.meta?.changes ?? 0)) return err("conflict", "This payment changed - reload it.", 409);
    await event(env, inv.id, rid, "rejected", user.id, rep.amount_cents, { reason }, `rejected:${rid}`);
    await audit(env, user.id, "payment.rejected", "invoice_payment_reports", String(rid), { invoice: inv.doc_number, amount_cents: rep.amount_cents, reason });
    if (rep.reported_by !== user.id) await notify(env, rep.reported_by, "payment", `Your payment of ${rm(rep.amount_cents)} on ${inv.doc_number} was not accepted: ${reason.slice(0, 120)}`, `pay_rej:${rid}`, { once: true });
    return json({ ok: true, ...(await picture(env, inv, user)) });
  }

  if (action === "verify") {
    /* v1.285.0 - the CEO's own report is his to decide: no second person (P3 withdrawn) */
    const ownReport = rep.reported_by === user.id;
    if (!["reported", "evidence_checked"].includes(rep.state)) {
      if (rep.state === "verified") {
        /* v1.283.0 (B2) - a retry finishes a settlement that stopped half way */
        const paidNow = rep.payment_id ? await settle(env, user, inv, rep.bank_id, rep.reference) : false;
        const fresh = (await invoiceOf(env, inv.id)) ?? inv;
        return json({ ok: true, repeated: true, invoice_paid: paidNow, ...(await picture(env, fresh, user)) });
      }
      return err("invalid_state", "Only a payment waiting for review can be verified.", 409);
    }
    if (inv.payment_status === "void") return err("voided", `${inv.doc_number} is void.`, 409);
    if (inv.payment_status === "paid") return err("invalid_input", `${inv.doc_number} is already paid in full - reject this report or ask the reporter.`, 409);
    if (!rep.proof_key && !ownReport) return err("proof_required", "No proof is attached to this payment - ask the reporter for it.", 409);
    const vm = String(body?.verify_method ?? "");
    if (!(VERIFY_METHODS as readonly string[]).includes(vm)) return err("invalid_input", `verify_method is one of ${VERIFY_METHODS.join(", ")}`, 400);
    if (rep.dup_of !== null) {
      const why = str(body?.dup_reason, 300) ? String(body!.dup_reason).trim() : "";
      if (why.length < 10) return err("duplicate_reason_required", "This reference was used before. Say why this is a different payment (at least 10 characters).", 409);
    }
    const bankId = typeof body?.bank_id === "number" ? body.bank_id : NaN;
    if (!Number.isInteger(bankId)) return err("invalid_input", "Choose the account the money arrived in.", 400);
    const bank = await bankCompany(env, bankId);
    if (!bank.ok || !bank.active) return err("invalid_input", "That account is not an active company account.", 400);
    if (!bank.company) return err("bank_company_unknown", `${bank.name} is not assigned to a company yet. Assign it in Companies (review), then verify.`, 409);
    if (bank.company !== rep.issuer_code) {
      return err("company_mismatch", `${inv.doc_number} is ${COMPANY_NAME[rep.issuer_code] ?? rep.issuer_code}'s invoice; ${bank.name} belongs to ${COMPANY_NAME[bank.company] ?? bank.company}. Company money is never combined.`, 409);
    }
    const verifiedSoFar = await verifiedOf(env, inv.id);
    const balance = Math.max(0, inv.total_cents - verifiedSoFar);
    const asked = body?.amount_cents === undefined ? Math.min(rep.amount_cents, balance) : body.amount_cents;
    if (typeof asked !== "number" || !Number.isInteger(asked) || asked <= 0) return err("invalid_input", "The verified amount must be more than RM 0.00.", 400);
    if (asked > rep.amount_cents) return err("invalid_input", `The verified amount cannot be more than was reported (${rm(rep.amount_cents)}).`, 400);
    if (asked > balance) return err("over_balance", `Only ${rm(balance)} is left on ${inv.doc_number}. Verify at most that; the rest stays with this report for review.`, 409);
    const stepUp = await requireFreshTotp(env, user, body?.totp, err, "verify this payment");
    if (stepUp) return stepUp;
    const dupReason = rep.dup_of !== null ? String(body!.dup_reason).trim() : null;
    /* v1.283.0 (B1) - ONE atomic batch. The claim (only while the report
       waits and the balance still holds it), the payment row (only for a
       claimed report with no payment yet) and their link commit together
       or not at all: a second verify, a retry or a failure in between can
       never pay twice or leave a "verified" report without its money. */
    const payNote = `Verified payment report #${rid}`;
    const steps = [
      env.DB.prepare(
        `UPDATE invoice_payment_reports SET state = 'verified', decided_by = ?1, decided_at = datetime('now'), verify_method = ?2, verified_cents = ?3, bank_id = ?4, dup_reason = ?5, updated_at = datetime('now')
          WHERE id = ?6 AND state = ?7 AND payment_id IS NULL
            AND (SELECT total_cents FROM sales_documents WHERE id = ?8) - COALESCE((SELECT SUM(amount_cents) FROM invoice_payments WHERE invoice_id = ?8 AND voided_at IS NULL), 0) >= ?3`,
      ).bind(user.id, vm, asked, bankId, dupReason, rid, rep.state, inv.id),
      env.DB.prepare(
        `INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, method, reference, note, created_by)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE EXISTS (SELECT 1 FROM invoice_payment_reports WHERE id = ?8 AND state = 'verified' AND payment_id IS NULL)`,
      ).bind(inv.id, asked, rep.received_on, rep.method === "online" ? "bank_transfer" : rep.method, rep.reference, payNote, user.id, rid),
      env.DB.prepare(
        `UPDATE invoice_payment_reports SET payment_id = (SELECT MAX(id) FROM invoice_payments WHERE invoice_id = ?1 AND note = ?2 AND voided_at IS NULL)
          WHERE id = ?3 AND state = 'verified' AND payment_id IS NULL`,
      ).bind(inv.id, payNote, rid),
    ];
    const done = await env.DB.batch(steps);
    if (!Number(done[0]?.meta?.changes ?? 0)) {
      /* nothing was written - say why, from the record as it is now */
      const now = await reportOf(env, rid);
      if (now?.state === "verified") {
        const paidNow = now.payment_id ? await settle(env, user, inv, now.bank_id, now.reference) : false;
        const fresh = (await invoiceOf(env, inv.id)) ?? inv;
        return json({ ok: true, repeated: true, invoice_paid: paidNow, ...(await picture(env, fresh, user)) });
      }
      if (now && now.state === rep.state) {
        return err("over_balance", `Another payment on ${inv.doc_number} was verified at the same moment and together they would pass its total. Nothing was verified - reload and check.`, 409);
      }
      return err("conflict", "This payment changed - reload it.", 409);
    }
    const pay = { id: Number((await reportOf(env, rid))?.payment_id ?? 0) };
    await env.DB.prepare(
      `INSERT INTO cashbook_marks (item_key, bank_id, bank_note, bank_by, bank_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))
       ON CONFLICT(item_key) DO UPDATE SET bank_id = excluded.bank_id, bank_note = excluded.bank_note, bank_by = excluded.bank_by, bank_at = excluded.bank_at`,
    ).bind(`PART:${pay.id}`, bankId, "Payment verification", user.id).run().catch(() => undefined);
    /* v1.285.0 - whose sale: the CEO's own, or on behalf of the invoice's salesperson (recorded as it is today, never re-read later) */
    const ownSale = inv.salesperson_id === user.id;
    const sale = { own_sale: ownSale, salesperson_id: inv.salesperson_id, salesperson: inv.salesperson ?? null, ceo_marked: ownReport, has_proof: !!rep.proof_key };
    await event(env, inv.id, rid, "verified", user.id, asked, { verify_method: vm, bank: bank.name, payment_id: pay.id, duplicate_reason: dupReason, evidence_by: rep.evidence_by, ...sale }, `verified:${rid}`);
    await audit(env, user.id, ownReport ? "payment.ceo_marked_paid" : "payment.verified", "invoice_payment_reports", String(rid), {
      invoice: inv.doc_number, amount_cents: asked, reported_cents: rep.amount_cents, verify_method: vm, bank_id: bankId, payment_id: pay.id,
      reported_by: rep.reported_by, evidence_by: rep.evidence_by, duplicate_reason: dupReason, ...sale,
    });
    const paid = await settle(env, user, inv, bankId, rep.reference);
    if (!paid) {
      const after = await verifiedOf(env, inv.id);
      await event(env, inv.id, rid, "outstanding_updated", user.id, Math.max(0, inv.total_cents - after), { verified_cents: after }, `outstanding:${rid}`);
    }
    if (rep.reported_by !== user.id) await notify(env, rep.reported_by, "payment", `The CEO verified ${rm(asked)} on ${inv.doc_number}.`, `pay_ok:${rid}`, { once: true });
    if (ownReport) {
      const whose = ownSale ? "his own sale" : inv.salesperson ? `on behalf of ${inv.salesperson}` : "no salesperson recorded";
      /* the salesperson is told it was done for them */
      if (inv.salesperson_id && !ownSale) await notify(env, inv.salesperson_id, "payment", `The CEO marked ${rm(asked)} paid on ${inv.doc_number}, on your behalf.`, `pay_ceo_sp:${rid}`, { once: true });
      /* the COO and CCO are told, for the record, as with every executive record */
      const { results: execs } = await env.DB.prepare(`SELECT id FROM users WHERE role IN ('coo', 'cco') AND is_active = 1 AND ${currentStaffSql()} AND id != ?1`).bind(user.id).all<{ id: number }>();
      for (const x of execs ?? []) await notify(env, x.id, "payment", `For the record: the CEO marked ${rm(asked)} paid on ${inv.doc_number} (${whose}).`, `pay_ceo_rec:${rid}:${x.id}`, { once: true });
    }
    if (inv.salesperson_id && inv.salesperson_id !== rep.reported_by && inv.salesperson_id !== user.id && !paid) {
      await notify(env, inv.salesperson_id, "payment", `${rm(asked)} verified on ${inv.doc_number}; ${rm(Math.max(0, inv.total_cents - (await verifiedOf(env, inv.id))))} is still outstanding.`, `pay_part:${rid}`, { once: true });
    }
    const fresh = (await invoiceOf(env, inv.id)) ?? inv;
    return json({ ok: true, invoice_paid: paid, ...(await picture(env, fresh, user)) });
  }

  if (action === "reverse") {
    if (rep.state !== "verified" || !rep.payment_id) return err("invalid_state", "Only a verified payment can be reversed.", 409);
    const reason = str(body?.reason, 600) ? String(body!.reason).trim() : "";
    if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters), e.g. the transfer bounced.", 400);
    const stepUp = await requireFreshTotp(env, user, body?.totp, err, "reverse this payment");
    if (stepUp) return stepUp;
    const r = await env.DB.prepare(
      `UPDATE invoice_payment_reports SET state = 'reversed', reversed_by = ?1, reversed_at = datetime('now'), reverse_reason = ?2, updated_at = datetime('now') WHERE id = ?3 AND state = 'verified'`,
    ).bind(user.id, reason, rid).run();
    if (!Number(r.meta?.changes ?? 0)) return err("conflict", "This payment changed - reload it.", 409);
    /* the payment row is voided with the reason, never deleted */
    await env.DB.prepare(`UPDATE invoice_payments SET voided_at = datetime('now'), voided_by = ?2, void_reason = ?3 WHERE id = ?1 AND voided_at IS NULL`)
      .bind(rep.payment_id, user.id, `Payment reversed: ${reason}`.slice(0, 300)).run();
    let unpaid = false;
    if (inv.payment_status === "paid" && (await verifiedOf(env, inv.id)) < inv.total_cents) {
      const u = await env.DB.prepare(`UPDATE sales_documents SET payment_status = 'unpaid', payment_method = NULL, payment_ref = NULL, paid_at = NULL WHERE id = ?1 AND payment_status = 'paid'`)
        .bind(inv.id).run();
      if (Number(u.meta?.changes ?? 0)) {
        unpaid = true;
        /* the existing undo: the confirmation is taken back, the cash row reversed, commission voided or reviewed */
        await revokePaidConfirmation(env, inv.id, user.id, `Payment reversed: ${reason}`.slice(0, 300));
        await reverseLive(env, user.id, `INV-${inv.id}`, `Payment reversed: ${reason}`.slice(0, 300));
        await ensureLedger(env, inv.id);
      }
    }
    await event(env, inv.id, rid, "reversed", user.id, rep.verified_cents, { reason, invoice_unpaid: unpaid }, `reversed:${rid}`);
    await audit(env, user.id, "payment.reversed", "invoice_payment_reports", String(rid), { invoice: inv.doc_number, amount_cents: rep.verified_cents, payment_id: rep.payment_id, reason, invoice_unpaid: unpaid });
    for (const uid of new Set([rep.reported_by, inv.salesperson_id ?? 0].filter((x) => x && x !== user.id))) {
      await notify(env, uid, "payment", `A verified payment of ${rm(rep.verified_cents ?? 0)} on ${inv.doc_number} was reversed: ${reason.slice(0, 120)}`, `pay_rev:${rid}:${uid}`, { once: true });
    }
    const fresh = (await invoiceOf(env, inv.id)) ?? inv;
    return json({ ok: true, invoice_unpaid: unpaid, ...(await picture(env, fresh, user)) });
  }
  return null;
}

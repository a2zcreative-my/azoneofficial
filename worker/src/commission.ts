/* v1.224.0 - SALES COMMISSION: the one engine (the owner's Commission brief
 * and answers, 29-10-2026; claude/COMMISSION-AUDIT.md).
 *
 *   verified closer -> invoice paid in full -> CEO/COO confirmation ->
 *   eligible -> payroll month (once) -> paid (bank run done)
 *
 * What is decided here, and what is not:
 *   - The POLICY is versioned (commission_policies, 0150): a draft by the
 *     CEO, COO or super admin; approved and made active only by the CEO or
 *     super admin; never edited after. The version in force for an invoice is
 *     the active one with the latest effective_from on or before the day the
 *     money landed (paid_at, Malaysia time). A new version can only start
 *     today or later, so no past entitlement is ever recalculated.
 *   - The BASIS (owner, 29-10): the sale after line and invoice discounts,
 *     excluding SST and delivery - or the invoice total, if a version says so.
 *     LIVE packages and every paid monthly renewal earn the same rate.
 *   - An ENTITLEMENT is written once per confirmation (commission_ledger,
 *     UNIQUE source_key), in the confirmation's own request and again by a
 *     catch-up pass, so a retry or a replay can never write two. A confirmation
 *     taken back before payroll voids it; after payroll it goes to review.
 *     A credit note opens a reversal for review. Nothing paid is ever taken
 *     back from wages automatically.
 *   - PAYROLL reads the ledger (commissionForPayroll): each eligible row is
 *     given to one month by a conditional write, never to a released month,
 *     and only while the owner's switch is on (shadow mode until then).
 *   - The weekly sales KPI never touches any of this (weekly-sales.ts).
 * No commission is estimated, stored or shown before COMMISSION_START_DAY. */

import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { audit, err, json, str } from "./shared";

export const COMMISSION_START_DAY = "2026-11-01"; // = staff.ts COMMISSION_START_MONTH (the owner, 28-10-2026)
const VIEW_ALL = ["super_admin", "admin", "ceo", "coo", "cco"]; // the CCO reviews only
const DRAFT_ROLES = ["super_admin", "ceo", "coo"];
const APPROVE_ROLES = ["super_admin", "ceo"];
const DECIDE_ROLES = ["super_admin", "ceo"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;

export interface Policy {
  id: number; version: number; name: string; status: string; effective_from: string;
  rate_kind: "percent" | "fixed"; rate_bp: number | null; fixed_cents: number | null;
  basis: "net_of_tax_delivery" | "invoice_total"; payment_rule: string; renewal_rule: string;
  refund_rule: string; cutoff_rule: string; leaver_rule: string; reason: string;
  created_by: number; created_at: string; approved_by: number | null; approved_at: string | null;
}
interface Inv { items: string | null; discount_cents: number | null; total_cents: number | null }

/** The commission basis of an invoice, in sen. */
export function basisOf(inv: Inv, basis: Policy["basis"]): number {
  if (basis === "invoice_total") return Math.max(0, Math.round(Number(inv.total_cents ?? 0)));
  let lines: { qty?: number; unit_price_cents?: number; disc_cents?: number }[] = [];
  try { const v = JSON.parse(inv.items ?? "[]"); if (Array.isArray(v)) lines = v; } catch { lines = []; }
  const sub = lines.reduce((s, l) => s + Number(l.qty ?? 0) * Number(l.unit_price_cents ?? 0) - Number(l.disc_cents ?? 0), 0);
  return Math.max(0, Math.round(sub - Number(inv.discount_cents ?? 0)));
}

/** The amount a policy pays on a basis: rate in basis points, half up, in sen. */
export function amountOf(basisCents: number, p: Pick<Policy, "rate_kind" | "rate_bp" | "fixed_cents">): number {
  if (p.rate_kind === "fixed") return Math.max(0, Math.round(Number(p.fixed_cents ?? 0)));
  return Math.floor((Math.max(0, basisCents) * Number(p.rate_bp ?? 0) + 5000) / 10000);
}

async function activePolicies(env: Env): Promise<Policy[]> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM commission_policies WHERE status = 'active' ORDER BY effective_from DESC, version DESC`,
    ).all<Policy>();
    return results ?? [];
  } catch { return []; }
}
/** The version in force on a day (the day the money landed). */
const inForce = (list: Policy[], day: string) => list.find((p) => p.effective_from <= day) ?? null;

export async function syncSwitch(env: Env): Promise<boolean> {
  try {
    const r = await env.DB.prepare(`SELECT value FROM business_settings WHERE key = 'commission_sync'`).first<{ value: string | null }>();
    return r?.value === "on";
  } catch { return false; }
}

/** Write what the confirmations owe and what was taken back - idempotent.
    Runs after every confirmation, take-back and credit note, and before any
    commission read, so a missed write heals itself. Returns rows written. */
export async function ensureLedger(env: Env, invoiceId?: number): Promise<number> {
  let written = 0;
  const one = invoiceId ? " AND c.invoice_id = ?2" : "";
  /* 1. an earn row for every live confirmation of money that landed on or
        after the start day */
  let conf: { conf_id: number; invoice_id: number; confirmed_at: string; items: string | null; discount_cents: number | null; total_cents: number | null; salesperson_id: number | null; paid_day: string }[] = [];
  try {
    const st = env.DB.prepare(
      `SELECT c.id AS conf_id, c.invoice_id, c.confirmed_at, d.items, d.discount_cents, d.total_cents, d.salesperson_id,
              date(COALESCE(d.paid_at, d.created_at), '+8 hours') AS paid_day
         FROM invoice_paid_confirmations c JOIN sales_documents d ON d.id = c.invoice_id
        WHERE c.revoked_at IS NULL AND date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= ?1${one}
          AND NOT EXISTS (SELECT 1 FROM commission_ledger l WHERE l.confirmation_id = c.id AND l.kind = 'earn')`,
    );
    conf = ((invoiceId ? await st.bind(COMMISSION_START_DAY, invoiceId).all() : await st.bind(COMMISSION_START_DAY).all()).results ?? []) as typeof conf;
  } catch { return 0; } // before 0145 / 0150: nothing to write to
  const policies = conf.length ? await activePolicies(env) : [];
  for (const c of conf) {
    const p = inForce(policies, c.paid_day);
    if (!p) continue; // no approved policy for that day: shown as an exception, nothing invented
    const basis = basisOf(c, p.basis);
    const amount = amountOf(basis, p);
    const noCloser = !c.salesperson_id;
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO commission_ledger (source_key, kind, invoice_id, confirmation_id, user_id, policy_id, basis_cents, rate_bp, fixed_cents, amount_cents, paid_day, status, eligible_at, note)
       VALUES (?1, 'earn', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    ).bind(`earn:${c.conf_id}`, c.invoice_id, c.conf_id, c.salesperson_id ?? null, p.id, basis,
      p.rate_kind === "percent" ? p.rate_bp : null, p.rate_kind === "fixed" ? p.fixed_cents : null, amount, c.paid_day,
      noCloser ? "review" : "eligible", c.confirmed_at, noCloser ? "No closer on the invoice - choose one, then apply" : null).run();
    written += Number(r.meta?.changes ?? 0);
  }
  /* 2. a confirmation taken back: void before payroll, review after */
  try {
    const st = env.DB.prepare(
      `SELECT l.id, l.invoice_id, l.user_id, l.amount_cents, l.status, l.payroll_month, c.revoke_reason
         FROM commission_ledger l JOIN invoice_paid_confirmations c ON c.id = l.confirmation_id
        WHERE l.kind = 'earn' AND c.revoked_at IS NOT NULL AND l.status != 'void'${invoiceId ? " AND l.invoice_id = ?1" : ""}
          AND NOT EXISTS (SELECT 1 FROM commission_ledger r WHERE r.source_key = 'rev:' || l.id)`,
    );
    const { results } = await (invoiceId ? st.bind(invoiceId) : st).all<{ id: number; invoice_id: number; user_id: number | null; amount_cents: number; status: string; payroll_month: string | null; revoke_reason: string | null }>();
    for (const l of results ?? []) {
      const v = await env.DB.prepare(
        `UPDATE commission_ledger SET status = 'void', note = COALESCE(note || ' · ', '') || 'Confirmation taken back before payroll'
          WHERE id = ?1 AND payroll_month IS NULL AND status IN ('eligible', 'review')`,
      ).bind(l.id).run();
      const before = Number(v.meta?.changes ?? 0) > 0;
      const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO commission_ledger (source_key, kind, invoice_id, parent_id, user_id, policy_id, basis_cents, amount_cents, status, note)
         SELECT ?1, 'reverse', invoice_id, id, user_id, policy_id, -basis_cents, -amount_cents, ?2, ?3 FROM commission_ledger WHERE id = ?4`,
      ).bind(`rev:${l.id}`, before ? "void" : "review",
        `${before ? "Confirmation taken back before payroll" : "Confirmation taken back after the commission went to payroll - review"}${l.revoke_reason ? `: ${l.revoke_reason}` : ""}`, l.id).run();
      written += Number(r.meta?.changes ?? 0);
    }
  } catch { /* pre-0150 */ }
  /* 3. a credit note against an invoice that earned: a reversal for review */
  try {
    const st = env.DB.prepare(
      `SELECT n.id AS cn_id, n.cn_number, n.amount_cents AS cn_cents, d.total_cents, l.id AS earn_id, l.amount_cents, l.basis_cents
         FROM credit_notes n JOIN sales_documents d ON d.id = n.invoice_id
         JOIN commission_ledger l ON l.invoice_id = n.invoice_id AND l.kind = 'earn' AND l.status != 'void'
        WHERE n.created_at >= l.created_at${invoiceId ? " AND n.invoice_id = ?1" : ""}
          AND NOT EXISTS (SELECT 1 FROM commission_ledger r WHERE r.source_key = 'cn:' || n.id || ':' || l.id)`,
    );
    const { results } = await (invoiceId ? st.bind(invoiceId) : st).all<{ cn_id: number; cn_number: string; cn_cents: number; total_cents: number; earn_id: number; amount_cents: number; basis_cents: number }>();
    for (const n of results ?? []) {
      const share = n.total_cents > 0 ? Math.min(1, Number(n.cn_cents) / Number(n.total_cents)) : 1;
      const back = Math.round(n.amount_cents * share);
      const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO commission_ledger (source_key, kind, invoice_id, credit_note_id, parent_id, user_id, policy_id, basis_cents, amount_cents, status, note)
         SELECT ?1, 'reverse', invoice_id, ?2, id, user_id, policy_id, ?3, ?4, 'review', ?5 FROM commission_ledger WHERE id = ?6`,
      ).bind(`cn:${n.cn_id}:${n.earn_id}`, n.cn_id, -Math.round(n.basis_cents * share), -back,
        `Credit note ${n.cn_number} - review`, n.earn_id).run();
      written += Number(r.meta?.changes ?? 0);
    }
  } catch { /* pre-0069 / pre-0150 */ }
  return written;
}

/** PAYROLL: the commission each person carries in a month, from the ledger.
    null = leave the stored figure alone (the switch is off, the month is
    before the start, or its payslips are released). Otherwise eligible rows
    confirmed by the month's last day are given to this month - once, by a
    conditional write - for people on that month's payroll (`staffSql`, the
    caller's payrollMonthStaffSql with alias "u."); a later month carries the
    rest forward. */
export async function commissionForPayroll(env: Env, month: string, staffSql: string): Promise<Map<number, number> | null> {
  if (!MONTH.test(month) || `${month}-01` < COMMISSION_START_DAY.slice(0, 7) + "-01") return null;
  if (!(await syncSwitch(env))) return null;
  try {
    const rel = await env.DB.prepare(`SELECT month FROM payslip_releases WHERE month = ?1`).bind(month).first();
    if (rel) return null;
    await ensureLedger(env);
    const [y, m] = month.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    await env.DB.prepare(
      `UPDATE commission_ledger SET payroll_month = ?1, status = 'included', included_at = datetime('now')
        WHERE status = 'eligible' AND payroll_month IS NULL AND user_id IS NOT NULL
          AND date(eligible_at, '+8 hours') <= ?2
          AND user_id IN (SELECT u.id FROM users u WHERE ${staffSql})`,
    ).bind(month, last).run();
    const { results } = await env.DB.prepare(
      `SELECT user_id, COALESCE(SUM(amount_cents), 0) AS c FROM commission_ledger
        WHERE payroll_month = ?1 AND status IN ('included', 'paid') AND user_id IS NOT NULL GROUP BY user_id`,
    ).bind(month).all<{ user_id: number; c: number }>();
    return new Map((results ?? []).map((r) => [r.user_id, Math.max(0, Number(r.c))]));
  } catch { return null; } // pre-0150: payroll as before
}

/** The bank run for a month is done: what it carried is paid. */
export async function markCommissionPaid(env: Env, month: string): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE commission_ledger SET status = 'paid', paid_out_at = datetime('now') WHERE payroll_month = ?1 AND status = 'included'`,
    ).bind(month).run();
  } catch { /* pre-0150 */ }
}

/* ------------------------------------------------------------------ */

const lineSummary = (items: string | null) => {
  try {
    const v = JSON.parse(items ?? "[]") as { name?: string }[];
    if (!Array.isArray(v) || !v.length) return "";
    return `${String(v[0]?.name ?? "").slice(0, 80)}${v.length > 1 ? ` +${v.length - 1}` : ""}`;
  } catch { return ""; }
};

interface Open { id: number; doc_number: string; items: string | null; discount_cents: number | null; total_cents: number | null; salesperson_id: number | null; payment_status: string | null; paid_day: string; created_at: string; company: string | null; closer_name: string | null; received: number }
/** Invoices that may earn but have not yet: unpaid, part-paid, or paid and
    waiting for the CEO/COO. The estimate is never stored. */
async function openInvoices(env: Env, me: number | null): Promise<Open[]> {
  const sql = (parts: boolean) => `SELECT d.id, d.doc_number, d.items, d.discount_cents, d.total_cents, d.salesperson_id, d.payment_status, d.created_at,
            date(COALESCE(d.paid_at, d.created_at), '+8 hours') AS paid_day, k.company, ${PERSON("u")} AS closer_name,
            ${parts ? "(SELECT COALESCE(SUM(p.amount_cents), 0) FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL)" : "0"} AS received
       FROM sales_documents d LEFT JOIN customers k ON k.id = d.customer_id LEFT JOIN users u ON u.id = d.salesperson_id
      WHERE d.doc_type = 'INV'
        AND NOT EXISTS (SELECT 1 FROM invoice_paid_confirmations c WHERE c.invoice_id = d.id AND c.revoked_at IS NULL)
        AND (COALESCE(d.payment_status, '') != 'paid' OR date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= ?1)
        ${me ? "AND d.salesperson_id = ?2" : ""}
      ORDER BY d.created_at DESC LIMIT 500`;
  try {
    const st = env.DB.prepare(sql(true));
    return ((me ? await st.bind(COMMISSION_START_DAY, me).all() : await st.bind(COMMISSION_START_DAY).all()).results ?? []) as unknown as Open[];
  } catch {
    try {
      const st = env.DB.prepare(sql(false));
      return ((me ? await st.bind(COMMISSION_START_DAY, me).all() : await st.bind(COMMISSION_START_DAY).all()).results ?? []) as unknown as Open[];
    } catch { return []; }
  }
}
function estimateOf(o: Open, policies: Policy[], today: string) {
  const day = o.payment_status === "paid" ? o.paid_day : (today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY);
  const p = inForce(policies, day);
  if (!p) return { estimate_cents: null as number | null, basis_cents: null as number | null, policy_version: null as number | null };
  const basis = basisOf(o, p.basis);
  return { estimate_cents: amountOf(basis, p), basis_cents: basis, policy_version: p.version };
}
const stageOf = (o: Open) => o.payment_status === "paid" ? "awaiting_confirmation" : o.received > 0 ? "part_paid" : "unpaid";

export async function handleCommission(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (!(path === "/commission/summary" || path === "/commission/entries" || path.startsWith("/commission/entries/")
    || path === "/commission/flow" || path === "/commission/policy" || path.startsWith("/commission/policy/")
    || path === "/commission/settings" || path.startsWith("/commission/ledger/"))) return null;
  const all = VIEW_ALL.includes(user.role);
  const today = mytToday();
  const wantAll = params.get("scope") === "all" && all; // everyone else only ever reads their own
  const me = wantAll ? null : user.id;

  /* ---- the four figures ---- */
  if (path === "/commission/summary" && method === "GET") {
    await ensureLedger(env);
    const policies = await activePolicies(env);
    const month = MONTH.test(params.get("month") ?? "") ? params.get("month")! : today.slice(0, 7);
    const open = await openInvoices(env, me);
    let est = 0, estN = 0;
    for (const o of open) { const e = estimateOf(o, policies, today); if (e.estimate_cents !== null && o.salesperson_id) { est += e.estimate_cents; estN++; } }
    const sum = async (where: string, ...b: unknown[]) => {
      try {
        return await env.DB.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c, COUNT(*) AS n FROM commission_ledger WHERE ${where}${me ? ` AND user_id = ${Number(me)}` : ""}`)
          .bind(...b).first<{ c: number; n: number }>() ?? { c: 0, n: 0 };
      } catch { return { c: 0, n: 0 }; }
    };
    const eligible = await sum(`status = 'eligible'`);
    const included = await sum(`status = 'included'`);
    const paid = await sum(`status = 'paid' AND payroll_month = ?1`, month);
    const review = await sum(`status = 'review'`);
    return json({
      scope: me ? "mine" : "all", month, start: COMMISSION_START_DAY, sync: await syncSwitch(env), can_view_all: all,
      policy: inForce(policies, today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY),
      estimated: { cents: est, n: estN }, eligible: { cents: Number(eligible.c), n: Number(eligible.n) },
      included: { cents: Number(included.c), n: Number(included.n) }, paid: { cents: Number(paid.c), n: Number(paid.n) },
      review: { cents: Number(review.c), n: Number(review.n) },
    });
  }

  /* ---- the entries: what earned (the ledger) and what may (estimates) ---- */
  if (path === "/commission/entries" && method === "GET") {
    await ensureLedger(env);
    const policies = await activePolicies(env);
    const status = params.get("status") ?? "";
    const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 60);
    let rows: Record<string, unknown>[] = [];
    try {
      const where: string[] = [];
      const b: unknown[] = [];
      if (me) { b.push(me); where.push(`l.user_id = ?${b.length}`); }
      if (["eligible", "review", "included", "paid", "void"].includes(status)) { b.push(status); where.push(`l.status = ?${b.length}`); }
      const { results } = await env.DB.prepare(
        `SELECT l.*, d.doc_number, d.total_cents AS invoice_total, d.payment_status, d.items, k.company,
                ${PERSON("u")} AS closer_name, p.version AS policy_version, p.name AS policy_name,
                c.confirmed_at, ${PERSON("cu")} AS confirmed_by_name
           FROM commission_ledger l JOIN sales_documents d ON d.id = l.invoice_id
           LEFT JOIN customers k ON k.id = d.customer_id LEFT JOIN users u ON u.id = l.user_id
           LEFT JOIN commission_policies p ON p.id = l.policy_id
           LEFT JOIN invoice_paid_confirmations c ON c.id = COALESCE(l.confirmation_id, (SELECT e.confirmation_id FROM commission_ledger e WHERE e.id = l.parent_id))
           LEFT JOIN users cu ON cu.id = c.confirmed_by
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.id DESC LIMIT 500`,
      ).bind(...b).all<Record<string, unknown>>();
      rows = (results ?? []).map((r) => ({ ...r, package: lineSummary(r.items as string | null), items: undefined }));
    } catch { rows = []; }
    const estimates = ["", "estimated"].includes(status) ? (await openInvoices(env, me)).map((o) => ({
      invoice_id: o.id, doc_number: o.doc_number, company: o.company, closer_name: o.closer_name, user_id: o.salesperson_id,
      invoice_total: o.total_cents, payment_status: o.payment_status, received_cents: o.received, stage: stageOf(o),
      package: lineSummary(o.items), created_at: o.created_at, ...estimateOf(o, policies, today),
    })) : [];
    const match = (r: Record<string, unknown>) => !q || [r.doc_number, r.company, r.closer_name, r.package].some((x) => String(x ?? "").toLowerCase().includes(q));
    return json({ scope: me ? "mine" : "all", entries: rows.filter(match), estimates: estimates.filter(match), can_decide: DECIDE_ROLES.includes(user.role) });
  }

  /* ---- one entry, with everything that happened to it ---- */
  const one = path.match(/^\/commission\/entries\/(\d+)$/);
  if (one && method === "GET") {
    let row: Record<string, unknown> | null = null;
    try {
      row = await env.DB.prepare(
        `SELECT l.*, d.doc_number, d.total_cents AS invoice_total, d.payment_status, d.items, d.discount_cents, d.tax_percent, d.delivery_cents, d.salesperson_id,
                k.company, ${PERSON("u")} AS closer_name, p.version AS policy_version, p.name AS policy_name, p.basis AS policy_basis
           FROM commission_ledger l JOIN sales_documents d ON d.id = l.invoice_id LEFT JOIN customers k ON k.id = d.customer_id
           LEFT JOIN users u ON u.id = l.user_id LEFT JOIN commission_policies p ON p.id = l.policy_id WHERE l.id = ?1`,
      ).bind(Number(one[1])).first<Record<string, unknown>>();
    } catch { row = null; }
    if (!row) return err("not_found", "Commission entry not found", 404);
    if (!all && row.user_id !== user.id) return err("forbidden", "You can see your own commission only", 403);
    const inv = Number(row.invoice_id);
    const related = ((await env.DB.prepare(
      `SELECT l.id, l.kind, l.status, l.amount_cents, l.payroll_month, l.note, l.created_at, l.source_key FROM commission_ledger l WHERE l.invoice_id = ?1 ORDER BY l.id`,
    ).bind(inv).all()).results ?? []);
    let confirmations: unknown[] = [];
    try {
      confirmations = (await env.DB.prepare(
        `SELECT c.id, c.amount_cents, c.payment_ref, c.confirmed_at, ${PERSON("cu")} AS confirmed_by_name, c.revoked_at, c.revoke_reason, ${PERSON("ru")} AS revoked_by_name
           FROM invoice_paid_confirmations c LEFT JOIN users cu ON cu.id = c.confirmed_by LEFT JOIN users ru ON ru.id = c.revoked_by WHERE c.invoice_id = ?1 ORDER BY c.id`,
      ).bind(inv).all()).results ?? [];
    } catch { confirmations = []; }
    const history = (await env.DB.prepare(
      `SELECT a.action, a.detail, a.created_at, ${PERSON("u")} AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE (a.entity = 'sales_documents' AND a.entity_id = ?1 AND (a.action LIKE 'doc.closer%' OR a.action LIKE 'invoice.paid_confirm%'))
           OR (a.entity = 'commission_ledger' AND a.entity_id IN (SELECT CAST(id AS TEXT) FROM commission_ledger WHERE invoice_id = ?2))
        ORDER BY a.id`,
    ).bind(String(inv), inv).all()).results ?? [];
    return json({ entry: { ...row, package: lineSummary(row.items as string | null) }, related, confirmations, history, can_decide: DECIDE_ROLES.includes(user.role) });
  }

  /* ---- decide an entry under review (CEO, super admin) ---- */
  const dec = path.match(/^\/commission\/ledger\/(\d+)\/decide$/);
  if (dec && method === "POST") {
    if (!DECIDE_ROLES.includes(user.role)) return err("forbidden", "Only the CEO decides a commission under review", 403);
    const id = Number(dec[1]);
    const decision = String(body?.decision ?? "");
    const note = str(body?.note, 500) ? String(body!.note).trim() : "";
    if (!["apply", "dismiss", "settled"].includes(decision)) return err("invalid_input", "decision is apply, dismiss or settled", 400);
    if (note.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
    const row = await env.DB.prepare(`SELECT * FROM commission_ledger WHERE id = ?1`).bind(id).first<{ id: number; kind: string; status: string; invoice_id: number; parent_id: number | null; user_id: number | null }>().catch(() => null);
    if (!row) return err("not_found", "Commission entry not found", 404);
    if (row.status !== "review") return err("conflict", "That entry is not under review.", 409);
    const stamp = `decided_by = ?2, decided_at = datetime('now'), decision_note = ?3`;
    if (decision !== "apply") {
      const r = await env.DB.prepare(`UPDATE commission_ledger SET status = 'void', ${stamp} WHERE id = ?1 AND status = 'review'`).bind(id, user.id, `${decision}: ${note}`).run();
      if (!r.meta?.changes) return err("conflict", "That entry changed while you were deciding. Reload.", 409);
      await audit(env, user.id, `commission.${decision}`, "commission_ledger", String(id), { note });
      return json({ ok: true, status: "void" });
    }
    if (row.kind === "earn") {
      /* an earn with no closer: apply once the invoice names one */
      const inv = await env.DB.prepare(`SELECT salesperson_id FROM sales_documents WHERE id = ?1`).bind(row.invoice_id).first<{ salesperson_id: number | null }>();
      if (!inv?.salesperson_id) return err("invalid_input", "The invoice still has no closer. Correct the closer on the invoice first.", 400);
      const r = await env.DB.prepare(`UPDATE commission_ledger SET status = 'eligible', user_id = ?4, ${stamp} WHERE id = ?1 AND status = 'review' AND user_id IS NULL`)
        .bind(id, user.id, note, inv.salesperson_id).run();
      if (!r.meta?.changes) return err("conflict", "That entry changed while you were deciding. Reload.", 409);
      await audit(env, user.id, "commission.apply", "commission_ledger", String(id), { note, user_id: inv.salesperson_id });
      return json({ ok: true, status: "eligible" });
    }
    /* a reversal: never taken from wages already paid */
    const parent = row.parent_id ? await env.DB.prepare(`SELECT id, status, payroll_month FROM commission_ledger WHERE id = ?1`).bind(row.parent_id).first<{ id: number; status: string; payroll_month: string | null }>() : null;
    if (!parent) return err("invalid_input", "This reversal has no original entry.", 400);
    if (parent.status === "paid") {
      return err("already_paid", "That commission was already paid out. Nothing is deducted from wages here - record any settlement with 'Settled outside payroll' and handle recovery through HR.", 409);
    }
    if (parent.status === "void") {
      await env.DB.prepare(`UPDATE commission_ledger SET status = 'void', ${stamp} WHERE id = ?1 AND status = 'review'`).bind(id, user.id, `apply: ${note} (original already void)`).run();
      return json({ ok: true, status: "void" });
    }
    if (parent.status === "eligible" || parent.status === "review") {
      /* not yet in payroll: both drop out */
      await env.DB.batch([
        env.DB.prepare(`UPDATE commission_ledger SET status = 'void', note = COALESCE(note || ' · ', '') || 'Reversed before payroll' WHERE id = ?1 AND status IN ('eligible', 'review') AND payroll_month IS NULL`).bind(parent.id),
        env.DB.prepare(`UPDATE commission_ledger SET status = 'void', ${stamp} WHERE id = ?1 AND status = 'review'`).bind(id, user.id, `apply: ${note}`),
      ]);
      await audit(env, user.id, "commission.apply", "commission_ledger", String(id), { note, parent: parent.id, before_payroll: true });
      return json({ ok: true, status: "void" });
    }
    /* included in a month that is not yet released: the reversal joins that
       same month, so it nets before anything is paid */
    const rel = parent.payroll_month ? await env.DB.prepare(`SELECT month FROM payslip_releases WHERE month = ?1`).bind(parent.payroll_month).first().catch(() => null) : null;
    if (rel) return err("already_paid", `The ${parent.payroll_month} payslips are released. Nothing is deducted from wages here - use 'Settled outside payroll'.`, 409);
    const r = await env.DB.prepare(`UPDATE commission_ledger SET status = 'included', payroll_month = ?4, included_at = datetime('now'), ${stamp} WHERE id = ?1 AND status = 'review'`)
      .bind(id, user.id, `apply: ${note}`, parent.payroll_month).run();
    if (!r.meta?.changes) return err("conflict", "That entry changed while you were deciding. Reload.", 409);
    await audit(env, user.id, "commission.apply", "commission_ledger", String(id), { note, parent: parent.id, payroll_month: parent.payroll_month });
    return json({ ok: true, status: "included", payroll_month: parent.payroll_month });
  }

  /* ---- the flow: where every invoice and entitlement stands ---- */
  if (path === "/commission/flow" && method === "GET") {
    if (!all) return err("forbidden", "Management access required", 403);
    await ensureLedger(env);
    const policies = await activePolicies(env);
    const open = await openInvoices(env, null);
    const s = (k: string) => open.filter((o) => stageOf(o) === k);
    const cents = (xs: Open[]) => xs.reduce((a, o) => a + Number(o.total_cents ?? 0), 0);
    const led = async (where: string) => {
      try { return await env.DB.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c, COUNT(*) AS n FROM commission_ledger WHERE ${where}`).first<{ c: number; n: number }>() ?? { c: 0, n: 0 }; } catch { return { c: 0, n: 0 }; }
    };
    let confirmedN = { n: 0, c: 0 };
    try {
      confirmedN = await env.DB.prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(d.total_cents), 0) AS c FROM invoice_paid_confirmations c JOIN sales_documents d ON d.id = c.invoice_id
          WHERE c.revoked_at IS NULL AND date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= ?1`,
      ).bind(COMMISSION_START_DAY).first<{ n: number; c: number }>() ?? confirmedN;
    } catch { /* pre-0145 */ }
    const eligible = await led(`status = 'eligible'`), included = await led(`status = 'included'`), paid = await led(`status = 'paid'`), review = await led(`status = 'review'`);
    let noPolicy = 0;
    try {
      const { results } = await env.DB.prepare(
        `SELECT date(COALESCE(d.paid_at, d.created_at), '+8 hours') AS day FROM invoice_paid_confirmations c JOIN sales_documents d ON d.id = c.invoice_id
          WHERE c.revoked_at IS NULL AND date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= ?1
            AND NOT EXISTS (SELECT 1 FROM commission_ledger l WHERE l.confirmation_id = c.id)`,
      ).bind(COMMISSION_START_DAY).all<{ day: string }>();
      noPolicy = (results ?? []).filter((r) => !inForce(policies, r.day)).length;
    } catch { noPolicy = 0; }
    let carried = { n: 0, c: 0 }, leavers = { n: 0, c: 0 };
    try {
      carried = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS c FROM commission_ledger WHERE status = 'eligible' AND strftime('%Y-%m', eligible_at, '+8 hours') < ?1`).bind(today.slice(0, 7)).first<{ n: number; c: number }>() ?? carried;
      leavers = await env.DB.prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(l.amount_cents), 0) AS c FROM commission_ledger l JOIN users u ON u.id = l.user_id
          WHERE l.status = 'eligible' AND u.left_on IS NOT NULL AND substr(u.left_on, 1, 10) < ?1 AND (u.rejoined_on IS NULL OR substr(u.rejoined_on, 1, 10) > ?1)`,
      ).bind(today).first<{ n: number; c: number }>() ?? leavers;
    } catch { /* pre-0150 */ }
    const noCloser = open.filter((o) => !o.salesperson_id);
    return json({
      start: COMMISSION_START_DAY, sync: await syncSwitch(env), policy: inForce(policies, today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY),
      stages: [
        { key: "closed", n: open.length - noCloser.length, cents: cents(open.filter((o) => o.salesperson_id)) },
        { key: "issued", n: s("unpaid").length, cents: cents(s("unpaid")) },
        { key: "verified", n: s("part_paid").length + s("awaiting_confirmation").length, cents: cents([...s("part_paid"), ...s("awaiting_confirmation")]) },
        { key: "confirmed", n: Number(confirmedN.n), cents: Number(confirmedN.c) },
        { key: "eligible", n: Number(eligible.n), cents: Number(eligible.c) },
        { key: "included", n: Number(included.n), cents: Number(included.c) },
        { key: "paid", n: Number(paid.n), cents: Number(paid.c) },
      ],
      exceptions: {
        review: { n: Number(review.n), cents: Number(review.c) },
        no_policy: noPolicy,
        no_closer: noCloser.length,
        awaiting_confirmation: s("awaiting_confirmation").length,
        carried_forward: { n: Number(carried.n), cents: Number(carried.c) },
        leavers: { n: Number(leavers.n), cents: Number(leavers.c) },
      },
    });
  }

  /* ---- the policy: versions, drafts, approval, preview, the switch ---- */
  if (path === "/commission/policy" && method === "GET") {
    if (!all) return err("forbidden", "Management access required", 403);
    let versions: unknown[] = [];
    let log: unknown[] = [];
    try {
      versions = (await env.DB.prepare(
        `SELECT p.*, ${PERSON("c")} AS created_by_name, ${PERSON("a")} AS approved_by_name, ${PERSON("r")} AS rejected_by_name
           FROM commission_policies p LEFT JOIN users c ON c.id = p.created_by LEFT JOIN users a ON a.id = p.approved_by LEFT JOIN users r ON r.id = p.rejected_by
          ORDER BY p.version DESC`,
      ).all()).results ?? [];
      log = (await env.DB.prepare(
        `SELECT s.setting, s.value, s.reason, s.changed_at, ${PERSON("u")} AS changed_by_name FROM commission_settings_log s LEFT JOIN users u ON u.id = s.changed_by ORDER BY s.id DESC LIMIT 20`,
      ).all()).results ?? [];
    } catch (e) {
      if (/no such table/i.test(String(e))) return json({ versions: [], log: [], in_force: null, sync: false, start: COMMISSION_START_DAY, today, can_draft: false, can_approve: false, can_switch: false, pending_migration: true });
      throw e;
    }
    const policies = await activePolicies(env);
    return json({
      versions, log, in_force: inForce(policies, today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY), sync: await syncSwitch(env),
      start: COMMISSION_START_DAY, today, can_draft: DRAFT_ROLES.includes(user.role), can_approve: APPROVE_ROLES.includes(user.role), can_switch: DECIDE_ROLES.includes(user.role),
    });
  }
  if (path === "/commission/policy" && method === "POST") {
    if (!DRAFT_ROLES.includes(user.role)) return err("forbidden", "Only the CEO, COO or super admin drafts a commission policy", 403);
    const name = str(body?.name, 80) ? String(body!.name).trim() : "";
    const from = String(body?.effective_from ?? "");
    const kind = body?.rate_kind === "fixed" ? "fixed" : "percent";
    const pct = Number(body?.rate_pct);
    const fixed = Math.round(Number(body?.fixed_cents));
    const basis = body?.basis === "invoice_total" ? "invoice_total" : "net_of_tax_delivery";
    const reason = str(body?.reason, 500) ? String(body!.reason).trim() : "";
    const floor = today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY;
    if (name.length < 3) return err("invalid_input", "Name the policy (at least 3 characters).", 400);
    if (!DAY.test(from) || from < floor) return err("invalid_input", `A policy starts on ${floor} or later - an earlier start would change commission already earned.`, 400);
    if (kind === "percent" && !(Number.isFinite(pct) && pct > 0 && pct <= 50)) return err("invalid_input", "The rate is a percentage above 0 and at most 50.", 400);
    if (kind === "fixed" && !(Number.isFinite(fixed) && fixed > 0 && fixed <= 10000000)) return err("invalid_input", "A fixed amount is above RM 0.00.", 400);
    if (reason.length < 10) return err("invalid_input", "Give the reason for this policy (at least 10 characters).", 400);
    if (body?.renewal_rule !== undefined && body.renewal_rule !== "every_paid") return err("invalid_input", "Renewals: only 'every paid month' is approved (29-10-2026). Other renewal rules need the owner's approval first.", 400);
    try {
      const r = await env.DB.prepare(
        `INSERT INTO commission_policies (version, name, status, effective_from, rate_kind, rate_bp, fixed_cents, basis, reason, created_by)
         SELECT COALESCE(MAX(version), 0) + 1, ?1, 'draft', ?2, ?3, ?4, ?5, ?6, ?7, ?8 FROM commission_policies RETURNING id, version`,
      ).bind(name, from, kind, kind === "percent" ? Math.round(pct * 100) : null, kind === "fixed" ? fixed : null, basis, reason, user.id).first<{ id: number; version: number }>();
      await audit(env, user.id, "commission.policy_draft", "commission_policies", String(r?.id), { version: r?.version, effective_from: from, rate_kind: kind, rate_pct: kind === "percent" ? pct : null, fixed_cents: kind === "fixed" ? fixed : null, basis, reason });
      return json({ ok: true, id: r?.id, version: r?.version }, 201);
    } catch (e) {
      if (/no such table/i.test(String(e))) return err("migration_missing", "Run migration 0150 first (PUSH.bat)", 503);
      throw e;
    }
  }
  const pol = path.match(/^\/commission\/policy\/(\d+)\/(approve|reject|preview)$/);
  if (pol) {
    const id = Number(pol[1]);
    const p = await env.DB.prepare(`SELECT * FROM commission_policies WHERE id = ?1`).bind(id).first<Policy>().catch(() => null);
    if (!p) return err("not_found", "Policy version not found", 404);
    if (pol[2] === "preview" && method === "GET") {
      if (!all) return err("forbidden", "Management access required", 403);
      /* what this version would pay on the last 60 days of confirmed
         invoices - nothing is written */
      const policies = await activePolicies(env);
      let rows: { invoice_id: number; doc_number: string; company: string | null; closer_name: string | null; items: string | null; discount_cents: number; total_cents: number; paid_day: string }[] = [];
      try {
        rows = ((await env.DB.prepare(
          `SELECT d.id AS invoice_id, d.doc_number, k.company, ${PERSON("u")} AS closer_name, d.items, d.discount_cents, d.total_cents,
                  date(COALESCE(d.paid_at, d.created_at), '+8 hours') AS paid_day
             FROM invoice_paid_confirmations c JOIN sales_documents d ON d.id = c.invoice_id
             LEFT JOIN customers k ON k.id = d.customer_id LEFT JOIN users u ON u.id = d.salesperson_id
            WHERE c.revoked_at IS NULL AND date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= date(?1, '-60 days')
            ORDER BY d.paid_at DESC LIMIT 200`,
        ).bind(today).all()).results ?? []) as typeof rows;
      } catch { rows = []; }
      const out = rows.map((r) => {
        const basis = basisOf(r, p.basis);
        const cur = inForce(policies, r.paid_day);
        return { ...r, items: undefined, package: lineSummary(r.items), basis_cents: basis, amount_cents: amountOf(basis, p), current_version: cur?.version ?? null, current_cents: cur ? amountOf(basisOf(r, cur.basis), cur) : null };
      });
      return json({ policy: p, rows: out, total_cents: out.reduce((a, r) => a + r.amount_cents, 0), note: "A preview only - nothing is written, and past entitlements keep their own version." });
    }
    if (pol[2] === "approve" && method === "POST") {
      if (!APPROVE_ROLES.includes(user.role)) return err("forbidden", "Only the CEO approves a commission policy", 403);
      if (p.status !== "draft") return err("conflict", "Only a draft is approved.", 409);
      if (p.effective_from < today) return err("invalid_input", `This draft starts on ${p.effective_from}, which has passed. Draft it again from today or later.`, 400);
      if (body?.confirm !== true) return err("invalid_input", "Tick that you approve this policy.", 400);
      try {
        const r = await env.DB.prepare(`UPDATE commission_policies SET status = 'active', approved_by = ?2, approved_at = datetime('now') WHERE id = ?1 AND status = 'draft'`).bind(id, user.id).run();
        if (!r.meta?.changes) return err("conflict", "That draft changed while you were approving it. Reload.", 409);
      } catch (e) {
        if (/UNIQUE/i.test(String(e))) return err("conflict", `Another active version already starts on ${p.effective_from}. Choose a different start day.`, 409);
        throw e;
      }
      await audit(env, user.id, "commission.policy_approve", "commission_policies", String(id), { version: p.version, effective_from: p.effective_from });
      return json({ ok: true });
    }
    if (pol[2] === "reject" && method === "POST") {
      if (!APPROVE_ROLES.includes(user.role)) return err("forbidden", "Only the CEO rejects a commission policy", 403);
      const reason = str(body?.reason, 500) ? String(body!.reason).trim() : "";
      if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
      const r = await env.DB.prepare(`UPDATE commission_policies SET status = 'rejected', rejected_by = ?2, rejected_at = datetime('now'), reject_reason = ?3 WHERE id = ?1 AND status = 'draft'`).bind(id, user.id, reason).run();
      if (!r.meta?.changes) return err("conflict", "Only a draft is rejected.", 409);
      await audit(env, user.id, "commission.policy_reject", "commission_policies", String(id), { version: p.version, reason });
      return json({ ok: true });
    }
  }
  if (path === "/commission/settings" && method === "POST") {
    if (!DECIDE_ROLES.includes(user.role)) return err("forbidden", "Only the CEO switches commission into payroll", 403);
    const value = body?.sync === "on" ? "on" : body?.sync === "off" ? "off" : "";
    const reason = str(body?.reason, 500) ? String(body!.reason).trim() : "";
    if (!value) return err("invalid_input", "sync is on or off", 400);
    if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
    if (value === "on" && !(await activePolicies(env)).length) return err("invalid_input", "Approve a commission policy before switching payroll on.", 400);
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO business_settings (key, value, updated_by, updated_at) VALUES ('commission_sync', ?1, ?2, datetime('now'))
                         ON CONFLICT(key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = datetime('now')`).bind(value, user.id),
        env.DB.prepare(`INSERT INTO commission_settings_log (setting, value, reason, changed_by) VALUES ('commission_sync', ?1, ?2, ?3)`).bind(value, reason, user.id),
      ]);
    } catch (e) {
      if (/no such table/i.test(String(e))) return err("migration_missing", "Run migration 0150 first (PUSH.bat)", 503);
      throw e;
    }
    await audit(env, user.id, "commission.sync", "business_settings", "commission_sync", { value, reason });
    return json({ ok: true, sync: value === "on" });
  }
  return err("not_found", "Unknown commission route", 404);
}

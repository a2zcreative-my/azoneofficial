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
 * No commission is estimated, stored or shown before COMMISSION_START_DAY.
 *
 * v1.227.0 - the owner's Commission Configuration brief and answers,
 * 30-10-2026 (claude/COMMISSION-CONFIG-AUDIT.md):
 *   - PACKAGE RULES per version (commission_policy_packages, 0152): a
 *     package can earn its own percentage, a fixed amount per unit sold, or
 *     nothing. Lines are matched by name (trimmed, any case); a line that
 *     matches nothing earns at the version's default. The invoice's basis
 *     is shared across its lines by their value, so the total basis is the
 *     same as before. A version with no package rules pays exactly as
 *     before (commissionOf falls through to amountOf).
 *   - CLOSER CORRECTION follows the money (reassignCloser): not yet in a
 *     payroll -> the entitlement moves to the corrected closer; in a month
 *     not yet released -> back to review; paid or released -> unchanged and
 *     flagged. Nothing is ever deducted from wages.
 *   - /commission/packages (names seen on recent invoices, to choose from)
 *     and /commission/audit (every commission decision, in one list). */

import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { audit, err, json, str } from "./shared";

export const COMMISSION_START_DAY = "2026-11-01"; // = staff.ts COMMISSION_START_MONTH (the owner, 28-10-2026)
export const VIEW_ALL = ["super_admin", "admin", "ceo", "coo", "cco"]; // the CCO reviews only
export const DRAFT_ROLES = ["super_admin", "ceo", "coo"];
export const APPROVE_ROLES = ["super_admin", "ceo"];
export const DECIDE_ROLES = ["super_admin", "ceo"];
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
  /** v1.232.0 (0154) - lines with no rule: services earn the default, a
      product earns only if a rule lists it ('listed_only', the owner's
      decision of 30-10-2026 before the start day). */
  product_rule?: string | null;
}
/** The invoice a calculation reads. v1.232.0: its kind (a product document
    earns only on listed lines) and the library package it was made from
    (a rule may name the package, 1.231.0). */
interface Inv { items: string | null; discount_cents: number | null; total_cents: number | null; doc_kind?: string | null; doc_package_id?: number | null }

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

/** v1.227.0 - one package rule of a policy version (0152). */
export interface PkgRule { policy_id: number; package_name: string; match_key: string; rule: "percent" | "fixed" | "none"; rate_bp: number | null; fixed_cents: number | null }
/** How a line's name is compared with a package name: trimmed, single spaces, any case. */
export const matchKey = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
export interface LineCalc { name: string; qty: number; basis_cents: number; package: string | null; rule: "percent" | "fixed" | "none" | "default" | "not_listed"; rate_bp: number | null; fixed_cents: number | null; amount_cents: number }
/** v1.232.0 - a rule that names a LIBRARY package (sales_packages, 1.231.0)
    is stored with this key; it covers every line of an invoice made from it. */
export const pkgKey = (id: number) => `pkg:${id}`;

/** The commission on an invoice under a version and its package rules, with
    the line-by-line working when rules apply. Which rule a line follows:
      1. the rule naming the library package the invoice was made from (all
         its lines, v1.232.0);
      2. the rule naming the line itself (name, trimmed, any case - 1.227.0);
      3. otherwise the version's default - except a PRODUCT line under
         'listed_only' (v1.232.0, the owner 30-10-2026), which earns nothing
         unless a rule lists it. A product line is one with an inventory SKU,
         or any line of a product document.
    A service invoice with no rules is the invoice-level calculation,
    unchanged since v1.224.0. */
export function commissionOf(inv: Inv, p: Pick<Policy, "basis" | "rate_kind" | "rate_bp" | "fixed_cents"> & { product_rule?: string | null }, pkgs: PkgRule[] = []): { basis: number; amount: number; lines: LineCalc[] | null } {
  const basis = basisOf(inv, p.basis);
  let raw: { name?: unknown; qty?: number; unit_price_cents?: number; disc_cents?: number; sku?: unknown }[] = [];
  try { const v = JSON.parse(inv.items ?? "[]"); if (Array.isArray(v)) raw = v; } catch { raw = []; }
  const listedOnly = (p.product_rule ?? "listed_only") === "listed_only";
  const isProduct = (l: { sku?: unknown }) => Boolean(String(l.sku ?? "").trim()) || inv.doc_kind === "product";
  if (!raw.length || (!pkgs.length && !(listedOnly && raw.some(isProduct)))) return { basis, amount: amountOf(basis, p), lines: null };
  const nets = raw.map((l) => Math.max(0, Number(l.qty ?? 0) * Number(l.unit_price_cents ?? 0) - Number(l.disc_cents ?? 0)));
  const sumNet = nets.reduce((a, b) => a + b, 0);
  const byKey = new Map(pkgs.map((r) => [r.match_key, r]));
  const whole = inv.doc_package_id ? byKey.get(pkgKey(Number(inv.doc_package_id))) : undefined;
  let defaultFixedUsed = false;
  let amount = 0;
  const lines: LineCalc[] = raw.map((l, i) => {
    const share = sumNet > 0 ? nets[i]! / sumNet : (i === 0 ? 1 : 0);
    const lb = Math.round(basis * share);
    const qty = Math.max(0, Number(l.qty ?? 0));
    const r = whole ?? byKey.get(matchKey(l.name));
    let a = 0;
    let out: LineCalc;
    if (r) {
      a = r.rule === "none" ? 0 : r.rule === "fixed" ? Math.max(0, Math.round(Number(r.fixed_cents ?? 0) * qty)) : Math.floor((lb * Number(r.rate_bp ?? 0) + 5000) / 10000);
      out = { name: String(l.name ?? ""), qty, basis_cents: lb, package: r.package_name, rule: r.rule, rate_bp: r.rule === "percent" ? r.rate_bp : null, fixed_cents: r.rule === "fixed" ? r.fixed_cents : null, amount_cents: a };
    } else if (listedOnly && isProduct(l)) {
      out = { name: String(l.name ?? ""), qty, basis_cents: lb, package: null, rule: "not_listed", rate_bp: null, fixed_cents: null, amount_cents: 0 };
    } else if (p.rate_kind === "fixed") {
      /* the version's fixed amount is per invoice: once, on the first unmatched line */
      a = defaultFixedUsed ? 0 : Math.max(0, Math.round(Number(p.fixed_cents ?? 0)));
      defaultFixedUsed = true;
      out = { name: String(l.name ?? ""), qty, basis_cents: lb, package: null, rule: "default", rate_bp: null, fixed_cents: p.fixed_cents, amount_cents: a };
    } else {
      a = Math.floor((lb * Number(p.rate_bp ?? 0) + 5000) / 10000);
      out = { name: String(l.name ?? ""), qty, basis_cents: lb, package: null, rule: "default", rate_bp: p.rate_bp, fixed_cents: null, amount_cents: a };
    }
    amount += a;
    return out;
  });
  return { basis, amount, lines };
}

/** v1.232.0 - the invoice's library-package column, or NULL before 0153
    (a calculation must never fail on a database a step behind). Cached
    only once it is known to exist. */
let pkgColOk = false;
async function docPkgCol(env: Env): Promise<string> {
  if (pkgColOk) return "d.package_id";
  try { await env.DB.prepare(`SELECT package_id FROM sales_documents LIMIT 1`).first(); pkgColOk = true; return "d.package_id"; } catch { return "NULL"; }
}

/** The package rules of these versions (none before 0152). */
export async function packagesOf(env: Env, ids: number[]): Promise<Map<number, PkgRule[]>> {
  const out = new Map<number, PkgRule[]>();
  const want = [...new Set(ids.filter((x) => Number.isInteger(x) && x > 0))];
  if (!want.length) return out;
  try {
    const { results } = await env.DB.prepare(
      `SELECT policy_id, package_name, match_key, rule, rate_bp, fixed_cents FROM commission_policy_packages WHERE policy_id IN (${want.map(() => "?").join(", ")}) ORDER BY id`,
    ).bind(...want).all<PkgRule>();
    for (const r of results ?? []) out.set(r.policy_id, [...(out.get(r.policy_id) ?? []), r]);
  } catch { /* pre-0152: no package rules */ }
  return out;
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
  let conf: { conf_id: number; invoice_id: number; confirmed_at: string; items: string | null; discount_cents: number | null; total_cents: number | null; salesperson_id: number | null; paid_day: string; doc_kind: string | null; doc_package_id: number | null }[] = [];
  const pkgC = await docPkgCol(env);
  try {
    const st = env.DB.prepare(
      `SELECT c.id AS conf_id, c.invoice_id, c.confirmed_at, d.items, d.discount_cents, d.total_cents, d.salesperson_id, d.kind AS doc_kind, ${pkgC} AS doc_package_id,
              date(COALESCE(d.paid_at, d.created_at), '+8 hours') AS paid_day
         FROM invoice_paid_confirmations c JOIN sales_documents d ON d.id = c.invoice_id
        WHERE c.revoked_at IS NULL AND date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= ?1${one}
          AND NOT EXISTS (SELECT 1 FROM commission_ledger l WHERE l.confirmation_id = c.id AND l.kind = 'earn')`,
    );
    conf = ((invoiceId ? await st.bind(COMMISSION_START_DAY, invoiceId).all() : await st.bind(COMMISSION_START_DAY).all()).results ?? []) as typeof conf;
  } catch { return 0; } // before 0145 / 0150: nothing to write to
  const policies = conf.length ? await activePolicies(env) : [];
  const pk = conf.length ? await packagesOf(env, policies.map((x) => x.id)) : new Map<number, PkgRule[]>();
  for (const c of conf) {
    const p = inForce(policies, c.paid_day);
    if (!p) continue; // no approved policy for that day: shown as an exception, nothing invented
    const { basis, amount } = commissionOf(c, p, pk.get(p.id));
    const noCloser = !c.salesperson_id;
    /* v1.232.0 - a confirmation that earns nothing under its version (a
       product line not listed, a rule of none, a zero basis) is recorded
       once, as void with the reason, so it is final and never joins a
       payroll as RM 0.00 */
    const nothing = !noCloser && amount <= 0;
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO commission_ledger (source_key, kind, invoice_id, confirmation_id, user_id, policy_id, basis_cents, rate_bp, fixed_cents, amount_cents, paid_day, status, eligible_at, note)
       VALUES (?1, 'earn', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    ).bind(`earn:${c.conf_id}`, c.invoice_id, c.conf_id, c.salesperson_id ?? null, p.id, basis,
      p.rate_kind === "percent" ? p.rate_bp : null, p.rate_kind === "fixed" ? p.fixed_cents : null, amount, c.paid_day,
      noCloser ? "review" : nothing ? "void" : "eligible", c.confirmed_at,
      noCloser ? "No closer on the invoice - choose one, then apply" : nothing ? `Nothing to earn under v${p.version}: no line earns (a product not listed, or a rule of none)` : null).run();
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
    before the start, or its payslips are released). Otherwise the month's
    sums by person.

    v1.232.0 (Commission 2.1 audit F1-F4, approved 30-10-2026): rows JOIN a
    month only when payroll WRITES that person's row for it - `include` is
    exactly the people being written (a Save: one; a Recompute: the month's
    entries). Reading the month (the Commission Sources list) attaches
    nothing. A month whose payslips are out (`released`: the release row OR
    the 5th-of-next-month moment the payslips themselves use) takes nothing,
    and nor does a month after the current one - so a row always lands in
    the month it was confirmed in, or the next one actually paid. Each row
    joins once (conditional write); it is never moved after. */
export async function commissionForPayroll(
  env: Env, month: string, staffSql: string,
  opts: { include: number[] | null; released: boolean },
): Promise<Map<number, number> | null> {
  if (!MONTH.test(month) || `${month}-01` < COMMISSION_START_DAY.slice(0, 7) + "-01") return null;
  if (!(await syncSwitch(env))) return null;
  if (opts.released) return null;
  try {
    const rel = await env.DB.prepare(`SELECT month FROM payslip_releases WHERE month = ?1`).bind(month).first();
    if (rel) return null;
    await ensureLedger(env);
    const ids = [...new Set((opts.include ?? []).filter((x) => Number.isInteger(x) && x > 0))];
    if (ids.length && month <= mytToday().slice(0, 7)) {
      const [y, m] = month.split("-").map(Number) as [number, number];
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      await env.DB.prepare(
        `UPDATE commission_ledger SET payroll_month = ?1, status = 'included', included_at = datetime('now')
          WHERE status = 'eligible' AND payroll_month IS NULL AND user_id IS NOT NULL
            AND date(eligible_at, '+8 hours') <= ?2
            AND user_id IN (${ids.map((_, i) => `?${i + 3}`).join(", ")})
            AND user_id IN (SELECT u.id FROM users u WHERE ${staffSql})`,
      ).bind(month, last, ...ids).run();
    }
    const { results } = await env.DB.prepare(
      `SELECT user_id, COALESCE(SUM(amount_cents), 0) AS c FROM commission_ledger
        WHERE payroll_month = ?1 AND status IN ('included', 'paid') AND user_id IS NOT NULL GROUP BY user_id`,
    ).bind(month).all<{ user_id: number; c: number }>();
    return new Map((results ?? []).map((r) => [r.user_id, Math.max(0, Number(r.c))]));
  } catch { return null; } // pre-0150: payroll as before
}

/** The bank run for a month is done: what it carried is paid.
    v1.232.0 (F2): only what a SAVED payslip carries - a person's included
    rows are paid when their payroll row for the month holds at least the
    sum; otherwise they stay included and show "not on a payslip" until the
    month is recomputed. Returns how many rows were paid and held. */
export async function markCommissionPaid(env: Env, month: string): Promise<{ paid: number; held: number }> {
  try {
    const r = await env.DB.prepare(
      `UPDATE commission_ledger SET status = 'paid', paid_out_at = datetime('now')
        WHERE payroll_month = ?1 AND status = 'included'
          AND user_id IN (SELECT e.user_id FROM payroll_entries e WHERE e.month = ?1
                AND COALESCE(e.commission_cents, 0) >= (SELECT COALESCE(SUM(l2.amount_cents), 0) FROM commission_ledger l2
                      WHERE l2.payroll_month = ?1 AND l2.user_id = e.user_id AND l2.status IN ('included', 'paid')))`,
    ).bind(month).run();
    const held = await env.DB.prepare(`SELECT COUNT(*) AS n FROM commission_ledger WHERE payroll_month = ?1 AND status = 'included'`).bind(month).first<{ n: number }>();
    return { paid: Number(r.meta?.changes ?? 0), held: Number(held?.n ?? 0) };
  } catch { return { paid: 0, held: 0 }; } // pre-0150
}

/* ------------------------------------------------------------------ */

const lineSummary = (items: string | null) => {
  try {
    const v = JSON.parse(items ?? "[]") as { name?: string }[];
    if (!Array.isArray(v) || !v.length) return "";
    return `${String(v[0]?.name ?? "").slice(0, 80)}${v.length > 1 ? ` +${v.length - 1}` : ""}`;
  } catch { return ""; }
};

interface Open { id: number; doc_number: string; items: string | null; discount_cents: number | null; total_cents: number | null; salesperson_id: number | null; payment_status: string | null; paid_day: string; created_at: string; company: string | null; closer_name: string | null; received: number; doc_kind: string | null; doc_package_id: number | null; issuer_code: string | null }
/** Invoices that may earn but have not yet: unpaid, part-paid, or paid and
    waiting for the CEO/COO. The estimate is never stored. */
async function openInvoices(env: Env, me: number | null, onlyId?: number): Promise<Open[]> {
  const pkgC = await docPkgCol(env);
  const sql = (parts: boolean) => `SELECT d.id, d.doc_number, d.items, d.discount_cents, d.total_cents, d.salesperson_id, d.payment_status, d.created_at,
            d.kind AS doc_kind, ${pkgC} AS doc_package_id, d.issuer_code,
            date(COALESCE(d.paid_at, d.created_at), '+8 hours') AS paid_day, k.company, ${PERSON("u")} AS closer_name,
            ${parts ? "(SELECT COALESCE(SUM(p.amount_cents), 0) FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL)" : "0"} AS received
       FROM sales_documents d LEFT JOIN customers k ON k.id = d.customer_id LEFT JOIN users u ON u.id = d.salesperson_id
      WHERE d.doc_type = 'INV'
        AND NOT EXISTS (SELECT 1 FROM invoice_paid_confirmations c WHERE c.invoice_id = d.id AND c.revoked_at IS NULL)
        AND (COALESCE(d.payment_status, '') != 'paid' OR date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= ?1)
        ${me ? "AND d.salesperson_id = ?2" : ""}
        ${onlyId ? `AND d.id = ${Number(onlyId)}` : ""}
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
function estimateOf(o: Open, policies: Policy[], today: string, pk: Map<number, PkgRule[]>) {
  const day = o.payment_status === "paid" ? o.paid_day : (today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY);
  const p = inForce(policies, day);
  if (!p) return { estimate_cents: null as number | null, basis_cents: null as number | null, policy_version: null as number | null };
  const c = commissionOf(o, p, pk.get(p.id));
  return { estimate_cents: c.amount, basis_cents: c.basis, policy_version: p.version };
}
const stageOf = (o: Open) => o.payment_status === "paid" ? "awaiting_confirmation" : o.received > 0 ? "part_paid" : "unpaid";
/** v1.232.0 (audit C6/C7) - the one next step for an open invoice, and who
    takes it. Keys; the panel words them. */
const nextOfOpen = (o: Open, hasPolicy: boolean): string =>
  !o.salesperson_id ? "choose_closer" : !hasPolicy ? "approve_policy"
    : o.payment_status === "paid" ? "confirm_paid" : o.received > 0 ? "await_balance" : "await_payment";
/** ... and for an entitlement, by its status and what payroll holds. */
async function entryContext(env: Env): Promise<{ onSlip: Set<string>; leavers: Set<number> }> {
  const onSlip = new Set<string>();
  const leavers = new Set<number>();
  try {
    const { results } = await env.DB.prepare(
      `SELECT l.user_id, l.payroll_month, SUM(l.amount_cents) AS c, COALESCE(e.commission_cents, -1) AS slip
         FROM commission_ledger l LEFT JOIN payroll_entries e ON e.user_id = l.user_id AND e.month = l.payroll_month
        WHERE l.status IN ('included', 'paid') AND l.payroll_month IS NOT NULL GROUP BY l.user_id, l.payroll_month`,
    ).all<{ user_id: number; payroll_month: string; c: number; slip: number }>();
    for (const r of results ?? []) if (r.slip >= 0 && Number(r.slip) >= Number(r.c)) onSlip.add(`${r.user_id}|${r.payroll_month}`);
    const today = mytToday();
    const lv = await env.DB.prepare(
      `SELECT id FROM users WHERE left_on IS NOT NULL AND substr(left_on, 1, 10) < ?1 AND (rejoined_on IS NULL OR substr(rejoined_on, 1, 10) > ?1)`,
    ).bind(today).all<{ id: number }>();
    for (const r of lv.results ?? []) leavers.add(Number(r.id));
  } catch { /* pre-0150 */ }
  return { onSlip, leavers };
}
const nextOfEntry = (e: { status: string; user_id: number | null; payroll_month: string | null }, sync: boolean, ctx: { onSlip: Set<string>; leavers: Set<number> }): string =>
  e.status === "review" ? "ceo_decides" : e.status === "void" ? "none" : e.status === "paid" ? "done"
    : e.status === "included" ? (ctx.onSlip.has(`${e.user_id}|${e.payroll_month}`) ? "await_bank_run" : "recompute_payroll")
    : e.user_id && ctx.leavers.has(e.user_id) ? "settle_leaver" : sync ? "next_payroll" : "payroll_off";

export async function handleCommission(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (!(path === "/commission/summary" || path === "/commission/entries" || path.startsWith("/commission/entries/")
    || path === "/commission/flow" || path === "/commission/policy" || path.startsWith("/commission/policy/")
    || path === "/commission/settings" || path.startsWith("/commission/ledger/")
    || path === "/commission/packages" || path === "/commission/audit" || path.startsWith("/commission/invoice/"))) return null;
  const all = VIEW_ALL.includes(user.role);
  const today = mytToday();
  const wantAll = params.get("scope") === "all" && all; // everyone else only ever reads their own
  const me = wantAll ? null : user.id;

  /* ---- the four figures ---- */
  if (path === "/commission/summary" && method === "GET") {
    await ensureLedger(env);
    const policies = await activePolicies(env);
    const pkS = await packagesOf(env, policies.map((x) => x.id));
    const month = MONTH.test(params.get("month") ?? "") ? params.get("month")! : today.slice(0, 7);
    const open = await openInvoices(env, me);
    let est = 0, estN = 0;
    for (const o of open) { const e = estimateOf(o, policies, today, pkS); if (e.estimate_cents !== null && o.salesperson_id) { est += e.estimate_cents; estN++; } }
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
    const pkE = await packagesOf(env, policies.map((x) => x.id));
    const status = params.get("status") ?? "";
    const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 60);
    let rows: Record<string, unknown>[] = [];
    try {
      const where: string[] = [];
      const b: unknown[] = [];
      if (me) { b.push(me); where.push(`l.user_id = ?${b.length}`); }
      if (["eligible", "review", "included", "paid", "void"].includes(status)) { b.push(status); where.push(`l.status = ?${b.length}`); }
      const { results } = await env.DB.prepare(
        `SELECT l.*, d.doc_number, d.total_cents AS invoice_total, d.payment_status, d.items, d.issuer_code, k.company,
                ${PERSON("u")} AS closer_name, p.version AS policy_version, p.name AS policy_name,
                c.confirmed_at, ${PERSON("cu")} AS confirmed_by_name
           FROM commission_ledger l JOIN sales_documents d ON d.id = l.invoice_id
           LEFT JOIN customers k ON k.id = d.customer_id LEFT JOIN users u ON u.id = l.user_id
           LEFT JOIN commission_policies p ON p.id = l.policy_id
           LEFT JOIN invoice_paid_confirmations c ON c.id = COALESCE(l.confirmation_id, (SELECT e.confirmation_id FROM commission_ledger e WHERE e.id = l.parent_id))
           LEFT JOIN users cu ON cu.id = c.confirmed_by
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.id DESC LIMIT 500`,
      ).bind(...b).all<Record<string, unknown>>();
      const sync = await syncSwitch(env);
      const ctx = await entryContext(env);
      rows = (results ?? []).map((r) => ({ ...r, package: lineSummary(r.items as string | null), items: undefined,
        next: nextOfEntry(r as { status: string; user_id: number | null; payroll_month: string | null }, sync, ctx) }));
    } catch { rows = []; }
    const estimates = ["", "estimated"].includes(status) ? (await openInvoices(env, me)).map((o) => {
      const e = estimateOf(o, policies, today, pkE);
      return {
        invoice_id: o.id, doc_number: o.doc_number, company: o.company, closer_name: o.closer_name, user_id: o.salesperson_id,
        invoice_total: o.total_cents, payment_status: o.payment_status, received_cents: o.received, stage: stageOf(o),
        package: lineSummary(o.items), created_at: o.created_at, issuer_code: o.issuer_code, ...e,
        next: nextOfOpen(o, e.policy_version !== null),
      };
    }) : [];
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
                d.kind AS doc_kind, ${await docPkgCol(env)} AS doc_package_id, d.issuer_code,
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
    /* v1.227.0 - the line-by-line working under the entry's own version
       (versions are never edited and a paid invoice's money is locked, so
       this is the calculation that wrote the row) */
    let breakdown: LineCalc[] | null = null;
    if (row.kind === "earn" && row.policy_id) {
      const pol = await env.DB.prepare(`SELECT * FROM commission_policies WHERE id = ?1`).bind(Number(row.policy_id)).first<Policy>().catch(() => null);
      if (pol) breakdown = commissionOf(row as unknown as Inv, pol, (await packagesOf(env, [pol.id])).get(pol.id)).lines;
    }
    const nextE = nextOfEntry(row as { status: string; user_id: number | null; payroll_month: string | null }, await syncSwitch(env), await entryContext(env));
    return json({ entry: { ...row, package: lineSummary(row.items as string | null), next: nextE }, related, confirmations, history, breakdown, can_decide: DECIDE_ROLES.includes(user.role) });
  }

  /* ---- decide an entry under review (CEO, super admin) ---- */
  const dec = path.match(/^\/commission\/ledger\/(\d+)\/decide$/);
  if (dec && method === "POST") {
    if (!DECIDE_ROLES.includes(user.role)) return err("forbidden", "Only the CEO decides a commission under review", 403);
    const id = Number(dec[1]);
    const decision = String(body?.decision ?? "");
    const note = str(body?.note, 500) ? String(body!.note).trim() : "";
    if (!["apply", "dismiss", "settled", "settle"].includes(decision)) return err("invalid_input", "decision is apply, dismiss, settled or settle", 400);
    if (note.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
    /* v1.232.0 (audit F6/C5) - THE LEAVER RULE'S "OR SETTLE": an eligible
       entitlement of someone no longer on payroll can never join a payroll
       month. The CEO records that it was paid in the final settlement (or
       outside payroll), with the reason. It is marked paid - never voided,
       never deducted - and stays in the history. */
    if (decision === "settle") {
      const lv = await env.DB.prepare(
        `SELECT l.id FROM commission_ledger l JOIN users u ON u.id = l.user_id
          WHERE l.id = ?1 AND l.kind = 'earn' AND l.status = 'eligible' AND l.payroll_month IS NULL
            AND u.left_on IS NOT NULL AND substr(u.left_on, 1, 10) < ?2 AND (u.rejoined_on IS NULL OR substr(u.rejoined_on, 1, 10) > ?2)`,
      ).bind(id, today).first().catch(() => null);
      if (!lv) return err("conflict", "Only an eligible commission of someone who has left, not in any payroll, is settled here.", 409);
      const r = await env.DB.prepare(
        `UPDATE commission_ledger SET status = 'paid', paid_out_at = datetime('now'), decided_by = ?2, decided_at = datetime('now'), decision_note = ?3,
                note = COALESCE(note || ' · ', '') || 'Settled outside payroll'
          WHERE id = ?1 AND status = 'eligible' AND payroll_month IS NULL`,
      ).bind(id, user.id, `settle: ${note}`).run();
      if (!r.meta?.changes) return err("conflict", "That entry changed while you were deciding. Reload.", 409);
      await audit(env, user.id, "commission.settle", "commission_ledger", String(id), { note });
      return json({ ok: true, status: "paid" });
    }
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
      /* an earn with no closer, or whose closer was corrected after it
         reached payroll (v1.227.0): apply to the closer the invoice names now */
      const inv = await env.DB.prepare(`SELECT salesperson_id FROM sales_documents WHERE id = ?1`).bind(row.invoice_id).first<{ salesperson_id: number | null }>();
      if (!inv?.salesperson_id) return err("invalid_input", "The invoice still has no closer. Correct the closer on the invoice first.", 400);
      const r = await env.DB.prepare(`UPDATE commission_ledger SET status = 'eligible', user_id = ?4, ${stamp} WHERE id = ?1 AND status = 'review' AND payroll_month IS NULL`)
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
    /* v1.232.0 (audit F7/C6) - TWO ROWS, NEVER ADDED TOGETHER. Invoices:
       each open invoice in exactly ONE current stage, counted once, valued
       at its invoice total. Entitlements: each ledger row in exactly one
       status, valued at its commission. Each stage names the next step. */
    const ctx = await entryContext(env);
    let notOnSlip = { n: 0, cents: 0 };
    try {
      const { results } = await env.DB.prepare(`SELECT user_id, payroll_month, amount_cents FROM commission_ledger WHERE status = 'included'`).all<{ user_id: number; payroll_month: string; amount_cents: number }>();
      for (const r of results ?? []) if (!ctx.onSlip.has(`${r.user_id}|${r.payroll_month}`)) { notOnSlip.n++; notOnSlip.cents += Number(r.amount_cents); }
    } catch { notOnSlip = { n: 0, cents: 0 }; }
    const sync = await syncSwitch(env);
    return json({
      start: COMMISSION_START_DAY, sync, policy: inForce(policies, today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY),
      invoices: [
        { key: "unpaid", n: s("unpaid").length, cents: cents(s("unpaid")), next: "await_payment" },
        { key: "part_paid", n: s("part_paid").length, cents: cents(s("part_paid")), next: "await_balance" },
        { key: "awaiting_confirmation", n: s("awaiting_confirmation").length, cents: cents(s("awaiting_confirmation")), next: "confirm_paid" },
        { key: "policy_review", n: noPolicy, cents: 0, next: "approve_policy" },
      ],
      entitlements: [
        { key: "eligible", n: Number(eligible.n), cents: Number(eligible.c), next: sync ? "next_payroll" : "payroll_off" },
        { key: "included", n: Number(included.n), cents: Number(included.c), next: "await_bank_run" },
        { key: "paid", n: Number(paid.n), cents: Number(paid.c), next: "done" },
        { key: "review", n: Number(review.n), cents: Number(review.c), next: "ceo_decides" },
      ],
      confirmed_total: { n: Number(confirmedN.n), cents: Number(confirmedN.c) },
      exceptions: {
        review: { n: Number(review.n), cents: Number(review.c) },
        no_policy: noPolicy,
        no_closer: noCloser.length,
        awaiting_confirmation: s("awaiting_confirmation").length,
        carried_forward: { n: Number(carried.n), cents: Number(carried.c) },
        leavers: { n: Number(leavers.n), cents: Number(leavers.c) },
        not_on_payslip: notOnSlip,
      },
    });
  }

  /* ---- v1.232.0 (audit C7) - one open invoice: the estimate, line by line,
     under the version that would apply, with what it is waiting for ---- */
  const invOne = path.match(/^\/commission\/invoice\/(\d+)$/);
  if (invOne && method === "GET") {
    const [o] = await openInvoices(env, all ? null : user.id, Number(invOne[1]));
    if (!o) return err("not_found", "No open invoice with an estimate (it may already be confirmed - see its entry)", 404);
    const policies = await activePolicies(env);
    const day = o.payment_status === "paid" ? o.paid_day : (today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY);
    const p = inForce(policies, day);
    const calc = p ? commissionOf(o, p, (await packagesOf(env, [p.id])).get(p.id)) : null;
    return json({
      invoice: { id: o.id, doc_number: o.doc_number, company: o.company, closer_name: o.closer_name, total_cents: o.total_cents, payment_status: o.payment_status,
        received_cents: o.received, issuer_code: o.issuer_code, doc_kind: o.doc_kind, package_id: o.doc_package_id, created_at: o.created_at },
      stage: stageOf(o), next: nextOfOpen(o, !!p), policy: p ? { version: p.version, name: p.name, rate_bp: p.rate_bp, fixed_cents: p.fixed_cents, rate_kind: p.rate_kind, basis: p.basis, product_rule: p.product_rule ?? "listed_only" } : null,
      basis_cents: calc?.basis ?? null, estimate_cents: calc?.amount ?? null, lines: calc?.lines ?? null,
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
    const pkV = await packagesOf(env, (versions as { id: number }[]).map((v) => v.id));
    versions = (versions as { id: number }[]).map((v) => ({ ...v, packages: pkV.get(v.id) ?? [] }));
    const inF = inForce(policies, today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY);
    return json({
      versions, log, in_force: inF ? { ...inF, packages: pkV.get(inF.id) ?? [] } : null, sync: await syncSwitch(env),
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
    for (const [k, v] of [["payment_rule", "paid_in_full_confirmed"], ["refund_rule", "review"], ["cutoff_rule", "month_end_carry_forward"], ["leaver_rule", "final_payroll_or_settle"], ["product_rule", "listed_only"]] as const) {
      if (body?.[k] !== undefined && body[k] !== v) return err("invalid_input", `${k.replace("_", " ")}: only the approved rule (${v.replace(/_/g, " ")}) can be chosen. Another rule needs the owner's approval first.`, 400);
    }
    /* v1.227.0 - package rules, written with this draft and never edited */
    const rawPk = Array.isArray(body?.packages) ? (body!.packages as unknown[]) : [];
    if (rawPk.length > 50) return err("invalid_input", "At most 50 package rules in one version.", 400);
    const pkgs: { name: string; key: string; rule: "percent" | "fixed" | "none"; bp: number | null; fc: number | null }[] = [];
    for (const x of rawPk) {
      const o = (x ?? {}) as Record<string, unknown>;
      /* v1.232.0 - a rule may name a LIBRARY package (1.231.0) instead of a
         line name: every line of an invoice made from it follows the rule */
      let libName: string | null = null;
      if (o.package_id !== undefined && o.package_id !== null) {
        const pid = Number(o.package_id);
        const lib = Number.isInteger(pid) && pid > 0 ? await env.DB.prepare(`SELECT name FROM sales_packages WHERE id = ?1`).bind(pid).first<{ name: string }>().catch(() => null) : null;
        if (!lib) return err("invalid_input", "That library package does not exist.", 400);
        libName = lib.name;
      }
      const pname = libName ?? String(o.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
      const rule = o.rule === "fixed" ? "fixed" : o.rule === "none" ? "none" : o.rule === "percent" ? "percent" : null;
      if (pname.length < 2 || !rule) return err("invalid_input", "Each package needs its name (as it is written on invoices) and a rule: percent, fixed or none.", 400);
      const key = libName ? pkgKey(Number(o.package_id)) : matchKey(pname);
      if (pkgs.some((q) => q.key === key)) return err("invalid_input", `"${pname}" is listed twice.`, 400);
      const rp = Number(o.rate_pct), fc = Math.round(Number(o.fixed_cents));
      if (rule === "percent" && !(Number.isFinite(rp) && rp >= 0 && rp <= 50)) return err("invalid_input", `${pname}: the rate is a percentage from 0 to 50.`, 400);
      if (rule === "fixed" && !(Number.isFinite(fc) && fc > 0 && fc <= 10000000)) return err("invalid_input", `${pname}: a fixed amount is above RM 0.00.`, 400);
      pkgs.push({ name: pname, key, rule, bp: rule === "percent" ? Math.round(rp * 100) : null, fc: rule === "fixed" ? fc : null });
    }
    try {
      /* the version and its package rules in ONE batch (one transaction):
         a draft is never stored without the rules it was drafted with */
      const ins = env.DB.prepare(
        `INSERT INTO commission_policies (version, name, status, effective_from, rate_kind, rate_bp, fixed_cents, basis, reason, created_by)
         SELECT COALESCE(MAX(version), 0) + 1, ?1, 'draft', ?2, ?3, ?4, ?5, ?6, ?7, ?8 FROM commission_policies`,
      ).bind(name, from, kind, kind === "percent" ? Math.round(pct * 100) : null, kind === "fixed" ? fixed : null, basis, reason, user.id);
      await env.DB.batch([ins, ...pkgs.map((q) => env.DB.prepare(
        `INSERT INTO commission_policy_packages (policy_id, package_name, match_key, rule, rate_bp, fixed_cents)
         VALUES ((SELECT MAX(id) FROM commission_policies), ?1, ?2, ?3, ?4, ?5)`,
      ).bind(q.name, q.key, q.rule, q.bp, q.fc))]);
      const r = await env.DB.prepare(`SELECT id, version FROM commission_policies WHERE created_by = ?1 ORDER BY id DESC LIMIT 1`).bind(user.id).first<{ id: number; version: number }>();
      await audit(env, user.id, "commission.policy_draft", "commission_policies", String(r?.id), { version: r?.version, effective_from: from, rate_kind: kind, rate_pct: kind === "percent" ? pct : null, fixed_cents: kind === "fixed" ? fixed : null, basis, reason, packages: pkgs.map((q) => ({ name: q.name, rule: q.rule, rate_bp: q.bp, fixed_cents: q.fc })) });
      return json({ ok: true, id: r?.id, version: r?.version }, 201);
    } catch (e) {
      if (/no such table: commission_policy_packages/i.test(String(e))) return err("migration_missing", "Run migration 0152 first (PUSH.bat)", 503);
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
      const pkP = await packagesOf(env, [...policies.map((x) => x.id), p.id]);
      let rows: { invoice_id: number; doc_number: string; company: string | null; closer_name: string | null; items: string | null; discount_cents: number; total_cents: number; paid_day: string; doc_kind: string | null; doc_package_id: number | null }[] = [];
      try {
        rows = ((await env.DB.prepare(
          `SELECT d.id AS invoice_id, d.doc_number, k.company, ${PERSON("u")} AS closer_name, d.items, d.discount_cents, d.total_cents,
                  d.kind AS doc_kind, ${await docPkgCol(env)} AS doc_package_id,
                  date(COALESCE(d.paid_at, d.created_at), '+8 hours') AS paid_day
             FROM invoice_paid_confirmations c JOIN sales_documents d ON d.id = c.invoice_id
             LEFT JOIN customers k ON k.id = d.customer_id LEFT JOIN users u ON u.id = d.salesperson_id
            WHERE c.revoked_at IS NULL AND date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= date(?1, '-60 days')
            ORDER BY d.paid_at DESC LIMIT 200`,
        ).bind(today).all()).results ?? []) as typeof rows;
      } catch { rows = []; }
      const out = rows.map((r) => {
        const mine = commissionOf(r, p, pkP.get(p.id));
        const cur = inForce(policies, r.paid_day);
        return { ...r, items: undefined, package: lineSummary(r.items), basis_cents: mine.basis, amount_cents: mine.amount, current_version: cur?.version ?? null, current_cents: cur ? commissionOf(r, cur, pkP.get(cur.id)).amount : null };
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
  /* v1.227.0 - package names as they are written on recent invoices (180
     days), most used first, with the latest unit price - so a package rule
     is typed exactly as the invoices spell it. Plus the public rate card's
     names. Nothing here is invented. */
  if (path === "/commission/packages" && method === "GET") {
    if (!all) return err("forbidden", "Management access required", 403);
    const seen = new Map<string, { name: string; n: number; last_price_cents: number | null; last_on: string }>();
    try {
      const { results } = await env.DB.prepare(
        `SELECT items, date(created_at, '+8 hours') AS d FROM sales_documents WHERE doc_type = 'INV' AND date(created_at, '+8 hours') >= date(?1, '-180 days') ORDER BY created_at DESC LIMIT 2000`,
      ).bind(today).all<{ items: string | null; d: string }>();
      for (const r of results ?? []) {
        let lines: { name?: unknown; unit_price_cents?: number }[] = [];
        try { const v = JSON.parse(r.items ?? "[]"); if (Array.isArray(v)) lines = v; } catch { lines = []; }
        for (const l of lines) {
          const name = String(l.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
          if (name.length < 2) continue;
          const k = matchKey(name);
          const cur = seen.get(k);
          if (cur) cur.n += 1;
          else seen.set(k, { name, n: 1, last_price_cents: Number.isFinite(Number(l.unit_price_cents)) ? Number(l.unit_price_cents) : null, last_on: r.d });
        }
      }
    } catch { /* nothing to suggest */ }
    let card: string[] = [];
    try {
      const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'packages_json'`).first<{ value: string }>();
      const v = row ? JSON.parse(row.value) : null;
      card = Array.isArray(v) ? v.map((t: { name?: unknown }) => String(t?.name ?? "").trim()).filter(Boolean) : [];
    } catch { card = []; }
    /* v1.232.0 - the sales packages library (1.231.0), for rules that name a whole package */
    let library: { id: number; name: string; status: string; current_version: number }[] = [];
    try {
      library = ((await env.DB.prepare(`SELECT id, name, status, current_version FROM sales_packages WHERE status != 'archived' ORDER BY name COLLATE NOCASE`).all<{ id: number; name: string; status: string; current_version: number }>()).results ?? []);
    } catch { library = []; }
    return json({ from_invoices: [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 60), rate_card: card, library });
  }

  /* v1.227.0 - THE AUDIT HISTORY: every commission decision and the steps
     that feed it (policy drafts, approvals, rejections, the payroll switch,
     reviews decided, closer corrections, payment confirmations), newest
     first. Read-only, management (the CCO included). */
  if (path === "/commission/audit" && method === "GET") {
    if (!all) return err("forbidden", "Management access required", 403);
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, ${PERSON("u")} AS who
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.action LIKE 'commission.%' OR a.action LIKE 'doc.closer%' OR a.action LIKE 'invoice.paid_confirm%'
        ORDER BY a.id DESC LIMIT 300`,
    ).all<{ id: number; action: string; entity: string | null; entity_id: string | null; detail: string | null; created_at: string; who: string | null }>();
    return json({ events: results ?? [] });
  }
  return err("not_found", "Unknown commission route", 404);
}

/* v1.227.0 - D1 of the Commission Configuration audit: a closer corrected
   AFTER the commission was written. The money follows the correction, by
   where it stands - never by taking anything back from wages:
     eligible / review, not in a payroll  -> moves to the corrected closer;
     included in a month NOT released     -> back to review (out of that
                                             payroll), for the CEO to apply;
     included in a released month, or paid -> unchanged; flagged.
   Reversals of a moved entitlement move with it. Every write is
   conditional on the row still being where it was read. */
export async function reassignCloser(env: Env, invoiceId: number, fromId: number | null, toId: number, note: string): Promise<{ moved: number; to_review: number; unchanged_paid: number }> {
  const out = { moved: 0, to_review: 0, unchanged_paid: 0 };
  let rows: { id: number; kind: string; status: string; payroll_month: string | null; user_id: number | null }[] = [];
  try {
    rows = ((await env.DB.prepare(
      `SELECT id, kind, status, payroll_month, user_id FROM commission_ledger WHERE invoice_id = ?1 AND status != 'void' ORDER BY id`,
    ).bind(invoiceId).all()).results ?? []) as typeof rows;
  } catch { return out; } // pre-0150
  const tag = `Closer corrected${fromId ? "" : " (none before)"}: ${note}`.slice(0, 400);
  for (const r of rows) {
    if (r.user_id === toId) continue;
    if ((r.status === "eligible" || r.status === "review") && !r.payroll_month) {
      const u = await env.DB.prepare(
        `UPDATE commission_ledger SET user_id = ?2, note = COALESCE(note || ' · ', '') || ?3 WHERE id = ?1 AND status IN ('eligible', 'review') AND payroll_month IS NULL AND user_id IS ?4`,
      ).bind(r.id, toId, tag, r.user_id).run();
      out.moved += Number(u.meta?.changes ?? 0);
      continue;
    }
    if (r.status === "included" && r.payroll_month) {
      const rel = await env.DB.prepare(`SELECT month FROM payslip_releases WHERE month = ?1`).bind(r.payroll_month).first().catch(() => null);
      if (!rel) {
        const u = await env.DB.prepare(
          `UPDATE commission_ledger SET status = 'review', payroll_month = NULL, included_at = NULL, note = COALESCE(note || ' · ', '') || ?2 WHERE id = ?1 AND status = 'included'`,
        ).bind(r.id, `${tag} - taken out of ${r.payroll_month} payroll for review`).run();
        out.to_review += Number(u.meta?.changes ?? 0);
        continue;
      }
    }
    await env.DB.prepare(`UPDATE commission_ledger SET note = COALESCE(note || ' · ', '') || ?2 WHERE id = ?1`)
      .bind(r.id, `${tag} - already paid or released to the previous closer; nothing is deducted, settle through HR if needed`).run();
    out.unchanged_paid += 1;
  }
  return out;
}

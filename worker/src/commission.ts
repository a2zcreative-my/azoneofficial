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
import { notify } from "./staff"; // v1.255.0 - review and payout notices
import { audit, err, json, str } from "./shared";
import { can } from "./permissions";
import { refuseSelf } from "./decision-policy"; // v1.271.0 - Phase 0
import { bookCash } from "./cashbook"; // v1.255.0 - the agent payout's one cash-book row, at settlement

export const COMMISSION_START_DAY = "2026-11-01"; // = staff.ts COMMISSION_START_MONTH (the owner, 28-10-2026)
/* v1.237.0 - VIEW_ALL, DRAFT_ROLES, APPROVE_ROLES and DECIDE_ROLES are PERMS
   commission_view_all, commission_draft, commission_approve and
   commission_settle (editable in Roles & Permissions; the CCO reviews only
   by default). */
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
  /** v1.255.0 (0168) - agent partnership rates on the eligible net sales
      value, in basis points (700 = 7%, 300 = 3%); NULL on v1 - nothing about
      agents applies until a version carries them. */
  agent_rate_bp?: number | null; agent_closer_rate_bp?: number | null; agent_renewal_rule?: string | null; agent_mismatch_reason?: string | null;
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
  let conf: { conf_id: number; invoice_id: number; confirmed_at: string; items: string | null; discount_cents: number | null; total_cents: number | null; salesperson_id: number | null; paid_day: string; doc_kind: string | null; doc_package_id: number | null; customer_id: number | null; converted_from: number | null }[] = [];
  const pkgC = await docPkgCol(env);
  try {
    const st = env.DB.prepare(
      `SELECT c.id AS conf_id, c.invoice_id, c.confirmed_at, d.items, d.discount_cents, d.total_cents, d.salesperson_id, d.kind AS doc_kind, ${pkgC} AS doc_package_id,
              d.customer_id, d.converted_from, date(COALESCE(d.paid_at, d.created_at), '+8 hours') AS paid_day
         FROM invoice_paid_confirmations c JOIN sales_documents d ON d.id = c.invoice_id
        WHERE c.revoked_at IS NULL AND date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= ?1${one}
          AND NOT EXISTS (SELECT 1 FROM commission_ledger l WHERE l.confirmation_id = c.id AND l.kind = 'earn')`,
    );
    conf = ((invoiceId ? await st.bind(COMMISSION_START_DAY, invoiceId).all() : await st.bind(COMMISSION_START_DAY).all()).results ?? []) as typeof conf;
  } catch { return 0; } // before 0145 / 0150: nothing to write to
  const policies = conf.length ? await activePolicies(env) : [];
  const pk = conf.length ? await packagesOf(env, policies.map((x) => x.id)) : new Map<number, PkgRule[]>();
  /* v1.255.0 - every confirmation is CLASSIFIED first (direct, agent
     partnership, or held for review) and written with its attribution in
     one batch. A direct sale writes exactly the row it always did. */
  const actx = conf.length ? await agentContext(env) : null;
  if (actx && !actx.ok) return 0; // 0168 not applied yet: nothing is written until it is (never a guess)
  for (const c of conf) {
    const p = inForce(policies, c.paid_day);
    const k = await classify(env, actx!, c, policies, pk);
    if (k.cls === "direct") {
      if (!p) continue; // no approved policy for that day: shown as an exception, nothing invented
      written += await writeClassified(env, c, k, commissionOf(c, p, pk.get(p.id)));
    } else {
      written += await writeClassified(env, c, k, null);
      if (k.cls === "partnership" && c.customer_id && k.agentId) actx!.partner.set(Number(c.customer_id), k.agentId);
    }
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
        `INSERT OR IGNORE INTO commission_ledger (source_key, kind, invoice_id, parent_id, user_id, policy_id, basis_cents, amount_cents, status, note, recipient_role, attribution_id, agent_request_id)
         SELECT ?1, 'reverse', invoice_id, id, user_id, policy_id, -basis_cents, -amount_cents, ?2, ?3, recipient_role, attribution_id, agent_request_id FROM commission_ledger WHERE id = ?4`,
      ).bind(`rev:${l.id}`, before ? "void" : "review",
        `${before ? "Confirmation taken back before payroll" : "Confirmation taken back after the commission went to payroll - review"}${l.revoke_reason ? `: ${l.revoke_reason}` : ""}`, l.id).run();
      written += Number(r.meta?.changes ?? 0);
    }
  } catch { /* pre-0150 */ }
  /* v1.255.0 - a held attribution whose confirmation was taken back closes
     with no rows (its RM 0.00 hold was voided above); nothing is decided */
  try {
    await env.DB.prepare(
      `UPDATE commission_attributions SET closed_at = datetime('now'), closed_reason = 'confirmation_revoked'
        WHERE classification = 'review' AND decision IS NULL AND closed_at IS NULL${invoiceId ? " AND invoice_id = ?1" : ""}
          AND confirmation_id IN (SELECT id FROM invoice_paid_confirmations WHERE revoked_at IS NOT NULL)`,
    ).bind(...(invoiceId ? [invoiceId] : [])).run();
  } catch { /* pre-0168 */ }
  /* 3. a credit note against an invoice that earned: a reversal for review */
  try {
    const st = env.DB.prepare(
      `SELECT n.id AS cn_id, n.cn_number, n.amount_cents AS cn_cents, d.total_cents, l.id AS earn_id, l.amount_cents, l.basis_cents
         FROM credit_notes n JOIN sales_documents d ON d.id = n.invoice_id
         JOIN commission_ledger l ON l.invoice_id = n.invoice_id AND l.kind = 'earn' AND l.status != 'void' AND l.amount_cents > 0
        WHERE n.created_at >= l.created_at${invoiceId ? " AND n.invoice_id = ?1" : ""}
          AND NOT EXISTS (SELECT 1 FROM commission_ledger r WHERE r.source_key = 'cn:' || n.id || ':' || l.id)`,
    );
    const { results } = await (invoiceId ? st.bind(invoiceId) : st).all<{ cn_id: number; cn_number: string; cn_cents: number; total_cents: number; earn_id: number; amount_cents: number; basis_cents: number }>();
    for (const n of results ?? []) {
      const share = n.total_cents > 0 ? Math.min(1, Number(n.cn_cents) / Number(n.total_cents)) : 1;
      const back = Math.round(n.amount_cents * share);
      const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO commission_ledger (source_key, kind, invoice_id, credit_note_id, parent_id, user_id, policy_id, basis_cents, amount_cents, status, note, recipient_role, attribution_id, agent_request_id)
         SELECT ?1, 'reverse', invoice_id, ?2, id, user_id, policy_id, ?3, ?4, 'review', ?5, recipient_role, attribution_id, agent_request_id FROM commission_ledger WHERE id = ?6`,
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
          WHERE status = 'eligible' AND payroll_month IS NULL AND user_id IS NOT NULL AND recipient_role = 'closer'
            AND date(eligible_at, '+8 hours') <= ?2
            AND user_id IN (${ids.map((_, i) => `?${i + 3}`).join(", ")})
            AND user_id IN (SELECT u.id FROM users u WHERE ${staffSql})`,
      ).bind(month, last, ...ids).run();
    }
    const { results } = await env.DB.prepare(
      `SELECT user_id, COALESCE(SUM(amount_cents), 0) AS c FROM commission_ledger
        WHERE payroll_month = ?1 AND status IN ('included', 'paid') AND user_id IS NOT NULL AND recipient_role = 'closer' GROUP BY user_id`,
    ).bind(month).all<{ user_id: number; c: number }>();
    return new Map((results ?? []).map((r) => [r.user_id, Math.max(0, Number(r.c))]));
  } catch { return null; } // pre-0150: payroll as before
}

/** The bank run for a month is done: what it carried is paid.
    v1.232.0 (F2): only what a SAVED payslip carries - a person's included
    rows are paid when their payroll row for the month holds at least the
    sum; otherwise they stay included and show "not on a payslip" until the
    month is recomputed. Returns how many rows were paid and held. */
/* v1.243.0 (go-live audit E4) - only the people THIS bank run paid (the
   ready subset plus recorded manual payments, passed in by /payroll/paid),
   and only rows included before the run was recorded: a row joined to the
   month after Paid is not paid by a run that did not carry it. Paid is once
   per month now (E3), so a second call cannot mark more. */
export async function markCommissionPaid(env: Env, month: string, paidUsers?: number[]): Promise<{ paid: number; held: number }> {
  try {
    const users = paidUsers && paidUsers.length ? ` AND user_id IN (${paidUsers.map((u) => Number(u)).join(",")})` : paidUsers ? " AND 0" : "";
    const r = await env.DB.prepare(
      `UPDATE commission_ledger SET status = 'paid', paid_out_at = datetime('now')
        WHERE payroll_month = ?1 AND status = 'included' AND COALESCE(included_at, '') <= datetime('now')${users}
          AND user_id IN (SELECT e.user_id FROM payroll_entries e WHERE e.month = ?1
                AND COALESCE(e.commission_cents, 0) >= (SELECT COALESCE(SUM(l2.amount_cents), 0) FROM commission_ledger l2
                      WHERE l2.payroll_month = ?1 AND l2.user_id = e.user_id AND l2.status IN ('included', 'paid')))
          AND recipient_role = 'closer'`,
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

interface Open { id: number; doc_number: string; items: string | null; discount_cents: number | null; total_cents: number | null; salesperson_id: number | null; payment_status: string | null; paid_day: string; created_at: string; company: string | null; closer_name: string | null; received: number; doc_kind: string | null; doc_package_id: number | null; issuer_code: string | null; customer_id: number | null; converted_from: number | null }
/** Invoices that may earn but have not yet: unpaid, part-paid, or paid and
    waiting for the CEO/COO. The estimate is never stored. */
async function openInvoices(env: Env, me: number | null, onlyId?: number): Promise<Open[]> {
  const pkgC = await docPkgCol(env);
  const sql = (parts: boolean) => `SELECT d.id, d.doc_number, d.items, d.discount_cents, d.total_cents, d.salesperson_id, d.payment_status, d.created_at,
            d.kind AS doc_kind, ${pkgC} AS doc_package_id, d.issuer_code, d.customer_id, d.converted_from,
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
interface Est { estimate_cents: number | null; basis_cents: number | null; policy_version: number | null; deal: "direct" | "partnership" | "review"; closer_rate_bp: number | null; agent_estimate_cents: number | null; agent_id: number | null; hold_reasons: string[] }
/** v1.255.0 - the estimate of each open invoice, classified the way its
    confirmation will be (never stored): a direct sale at the version's
    rate; an agent partnership at the closer's 3% (and the agent's 7%); a
    held sale has NO estimate - it is on hold until the CEO decides. */
async function estimateAll(env: Env, opens: Open[], policies: Policy[], today: string, pk: Map<number, PkgRule[]>): Promise<Map<number, Est>> {
  const out = new Map<number, Est>();
  const ctx = opens.length ? await agentContext(env) : null;
  for (const o of opens) {
    const day = o.payment_status === "paid" ? o.paid_day : (today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY);
    const p = inForce(policies, day);
    const none: Est = { estimate_cents: null, basis_cents: null, policy_version: p?.version ?? null, deal: "direct", closer_rate_bp: null, agent_estimate_cents: null, agent_id: null, hold_reasons: [] };
    const k = ctx?.ok ? await classify(env, ctx, { ...o, invoice_id: o.id, paid_day: day }, policies, pk) : null;
    if (k && k.cls === "review") { out.set(o.id, { ...none, deal: "review", agent_id: k.agentId, hold_reasons: k.reasons }); continue; }
    if (k && k.cls === "partnership" && p) {
      out.set(o.id, { ...none, estimate_cents: k.closerCents, basis_cents: k.eligible, deal: "partnership", closer_rate_bp: p.agent_closer_rate_bp ?? null, agent_estimate_cents: k.agentCents, agent_id: k.agentId });
      continue;
    }
    if (!p) { out.set(o.id, { ...none, policy_version: null }); continue; }
    const c = commissionOf(o, p, pk.get(p.id));
    out.set(o.id, { ...none, estimate_cents: c.amount, basis_cents: c.basis, closer_rate_bp: p.rate_kind === "percent" ? p.rate_bp : null });
  }
  return out;
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
const nextOfEntry = (e: { status: string; user_id: number | null; payroll_month: string | null; recipient_role?: string | null; hold?: number | null }, sync: boolean, ctx: { onSlip: Set<string>; leavers: Set<number> }): string =>
  e.status === "review" && e.hold ? "decide_attribution"
    : e.recipient_role === "agent" ? (e.status === "eligible" ? "authorise_payout" : e.status === "included" ? "confirm_settlement" : e.status === "paid" ? "done" : e.status === "void" ? "none" : "ceo_decides")
    : e.status === "review" ? "ceo_decides" : e.status === "void" ? "none" : e.status === "paid" ? "done"
    : e.status === "included" ? (ctx.onSlip.has(`${e.user_id}|${e.payroll_month}`) ? "await_bank_run" : "recompute_payroll")
    : e.user_id && ctx.leavers.has(e.user_id) ? "settle_leaver" : sync ? "next_payroll" : "payroll_off";

export async function handleCommission(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (!(path === "/commission/summary" || path === "/commission/entries" || path.startsWith("/commission/entries/")
    || path === "/commission/flow" || path === "/commission/policy" || path.startsWith("/commission/policy/")
    || path === "/commission/settings" || path.startsWith("/commission/ledger/")
    || path === "/commission/packages" || path === "/commission/audit" || path.startsWith("/commission/invoice/")
    || path === "/commission/attributions" || path.startsWith("/commission/attributions/") || path === "/commission/payouts" || path.startsWith("/commission/payouts/")
    || path === "/commission/disputes" || path.startsWith("/commission/disputes/"))) return null;
  /* v1.255.0 - an agent reads their own 7% at /agent/commission only; the Commission module is staff's */
  if (can(user.role, "agent_portal") || user.role === "agent") return err("forbidden", "Agents see their own commission in the agent portal", 403);
  const agentRes = await handleAgentDeals(env, path, method, body, user, params);
  if (agentRes) return agentRes;
  const all = can(user.role, "commission_view_all");
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
    const estM = await estimateAll(env, open, policies, today, pkS);
    for (const o of open) {
      const e = estM.get(o.id)!;
      if (e.estimate_cents !== null && o.salesperson_id) { est += e.estimate_cents; estN++; }
      if (!me && e.agent_estimate_cents) est += e.agent_estimate_cents; // management: the agent's 7% is commission too
    }
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
                c.confirmed_at, ${PERSON("cu")} AS confirmed_by_name,
                at.classification AS deal, CASE WHEN at.classification = 'review' AND at.decision IS NULL AND at.closed_at IS NULL AND l.kind = 'earn' AND l.amount_cents = 0 THEN 1 ELSE 0 END AS hold,
                (SELECT ${PERSON("ag")} FROM users ag WHERE ag.id = at.agent_id) AS agent_name
           FROM commission_ledger l JOIN sales_documents d ON d.id = l.invoice_id
           LEFT JOIN commission_attributions at ON at.id = l.attribution_id
           LEFT JOIN customers k ON k.id = d.customer_id LEFT JOIN users u ON u.id = l.user_id
           LEFT JOIN commission_policies p ON p.id = l.policy_id
           LEFT JOIN invoice_paid_confirmations c ON c.id = COALESCE(l.confirmation_id, (SELECT e.confirmation_id FROM commission_ledger e WHERE e.id = l.parent_id))
           LEFT JOIN users cu ON cu.id = c.confirmed_by
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.id DESC LIMIT 500`,
      ).bind(...b).all<Record<string, unknown>>();
      const sync = await syncSwitch(env);
      const ctx = await entryContext(env);
      rows = (results ?? []).map((r) => ({ ...r, package: lineSummary(r.items as string | null), items: undefined,
        /* the closer reads their own row: their rate, never the agent's request or payout */
        ...(me ? { agent_request_id: undefined, payout_id: undefined, attribution_id: undefined } : {}),
        next: nextOfEntry(r as { status: string; user_id: number | null; payroll_month: string | null; recipient_role: string; hold: number }, sync, ctx) }));
    } catch { rows = []; }
    const openE = ["", "estimated"].includes(status) ? await openInvoices(env, me) : [];
    const estE = await estimateAll(env, openE, policies, today, pkE);
    const estimates = openE.map((o) => {
      const { agent_estimate_cents, agent_id, hold_reasons, ...e } = estE.get(o.id)!;
      return {
        invoice_id: o.id, doc_number: o.doc_number, company: o.company, closer_name: o.closer_name, user_id: o.salesperson_id,
        invoice_total: o.total_cents, payment_status: o.payment_status, received_cents: o.received, stage: stageOf(o),
        package: lineSummary(o.items), created_at: o.created_at, issuer_code: o.issuer_code, ...e,
        /* the agent's estimate and the hold reasons are management's (the closer sees their own rate only) */
        ...(me ? {} : { agent_estimate_cents, agent_id, hold_reasons }),
        next: e.deal === "review" ? "attribution_hold" : nextOfOpen(o, e.policy_version !== null),
      };
    });
    const match = (r: Record<string, unknown>) => !q || [r.doc_number, r.company, r.closer_name, r.package].some((x) => String(x ?? "").toLowerCase().includes(q));
    return json({ scope: me ? "mine" : "all", entries: rows.filter(match), estimates: estimates.filter(match), can_decide: can(user.role, "commission_settle") });
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
    /* v1.255.0 (audit F1) - a reader who is not management sees THEIR OWN
       rows of the invoice only: never another recipient's amount, history
       or working (filtered here, in SQL) */
    const own = all ? "" : ` AND l.user_id = ${Number(user.id)}`;
    const related = ((await env.DB.prepare(
      `SELECT l.id, l.kind, l.status, l.amount_cents, l.payroll_month, l.note, l.created_at, l.source_key, l.recipient_role, l.rate_bp FROM commission_ledger l WHERE l.invoice_id = ?1${own} ORDER BY l.id`,
    ).bind(inv).all()).results ?? []);
    let attribution: Record<string, unknown> | null = null;
    try {
      attribution = row.attribution_id ? await env.DB.prepare(
        `SELECT a.*, ${PERSON("ag")} AS agent_name, ${PERSON("s")} AS assigned_name, ${PERSON("dd")} AS decided_by_name
           FROM commission_attributions a LEFT JOIN users ag ON ag.id = a.agent_id LEFT JOIN users s ON s.id = a.assigned_to LEFT JOIN users dd ON dd.id = a.decided_by WHERE a.id = ?1`,
      ).bind(Number(row.attribution_id)).first<Record<string, unknown>>() : null;
    } catch { attribution = null; }
    /* the closer of an agent deal is told the deal and the agent's name - never the agent's figures, the evidence or the key */
    const attrOut = !attribution ? null : all ? { ...attribution, write_key: undefined, decision_key: undefined }
      : { classification: attribution.classification, agent_name: attribution.agent_name ?? null, decision: attribution.decision ?? null };
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
           OR (a.entity = 'commission_ledger' AND a.entity_id IN (SELECT CAST(l.id AS TEXT) FROM commission_ledger l WHERE l.invoice_id = ?2${own}))
        ORDER BY a.id`,
    ).bind(String(inv), inv).all()).results ?? [];
    /* v1.227.0 - the line-by-line working under the entry's own version
       (versions are never edited and a paid invoice's money is locked, so
       this is the calculation that wrote the row) */
    let breakdown: LineCalc[] | null = null;
    /* the line working is at the version's DEFAULT rate: shown for a direct
       sale, and to management only for an agent deal (the closer's row
       carries its own 3%) */
    if (row.kind === "earn" && row.policy_id && (all || !attribution || attribution.classification === "direct")) {
      const pol = await env.DB.prepare(`SELECT * FROM commission_policies WHERE id = ?1`).bind(Number(row.policy_id)).first<Policy>().catch(() => null);
      if (pol) breakdown = commissionOf(row as unknown as Inv, pol, (await packagesOf(env, [pol.id])).get(pol.id)).lines;
    }
    const hold = attribution && attribution.classification === "review" && !attribution.decision && !attribution.closed_at && row.kind === "earn" && Number(row.amount_cents) === 0 ? 1 : 0;
    const nextE = nextOfEntry({ ...(row as { status: string; user_id: number | null; payroll_month: string | null; recipient_role: string }), hold }, await syncSwitch(env), await entryContext(env));
    const safeRow = all ? row : { ...row, agent_request_id: undefined, payout_id: undefined, attribution_id: undefined };
    return json({ entry: { ...safeRow, package: lineSummary(row.items as string | null), next: nextE, hold }, related, confirmations, history, breakdown, attribution: attrOut, can_decide: can(user.role, "commission_settle") });
  }

  /* ---- decide an entry under review (CEO, super admin) ---- */
  const dec = path.match(/^\/commission\/ledger\/(\d+)\/decide$/);
  if (dec && method === "POST") {
    if (!can(user.role, "commission_settle")) return err("forbidden", "Only the CEO decides a commission under review", 403);
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
          WHERE l.id = ?1 AND l.kind = 'earn' AND l.status = 'eligible' AND l.payroll_month IS NULL AND l.recipient_role = 'closer'
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
    const row = await env.DB.prepare(`SELECT * FROM commission_ledger WHERE id = ?1`).bind(id).first<{ id: number; kind: string; status: string; invoice_id: number; parent_id: number | null; user_id: number | null; recipient_role?: string; attribution_id?: number | null; amount_cents: number }>().catch(() => null);
    if (!row) return err("not_found", "Commission entry not found", 404);
    /* v1.271.0 (Phase 0) - never your own commission entry */
    const selfCom = await refuseSelf(env, user, "commission.decide", [row.user_id], "commission_ledger", id);
    if (selfCom) return selfCom;
    if (row.status !== "review") return err("conflict", "That entry is not under review.", 409);
    /* v1.255.0 - a HELD sale is decided on its attribution (partnership,
       direct or none, with the evidence) - never by applying its RM 0.00 hold */
    if (row.attribution_id && row.kind === "earn" && Number(row.amount_cents) === 0) {
      const at = await env.DB.prepare(`SELECT classification, decision, closed_at FROM commission_attributions WHERE id = ?1`).bind(row.attribution_id).first<{ classification: string; decision: string | null; closed_at: string | null }>().catch(() => null);
      if (at && at.classification === "review" && !at.decision && !at.closed_at) return err("attribution_review", "This sale is held for attribution review. Decide it under Commission > Agent deals (partnership, direct sale or no commission).", 409);
    }
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
    if (row.recipient_role === "agent" && (parent.status === "paid" || parent.status === "included")) {
      return err("already_paid", "That agent commission is in a payout already. Nothing is deducted automatically - record the recovery with the agent outside the system, then dismiss this reversal with the note.", 409);
    }
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
    let attrReview = 0, payoutsOpen = 0;
    try {
      attrReview = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM commission_attributions WHERE classification = 'review' AND decision IS NULL AND closed_at IS NULL`).first<{ n: number }>())?.n ?? 0);
      payoutsOpen = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM agent_payouts WHERE status = 'authorized'`).first<{ n: number }>())?.n ?? 0);
    } catch { /* pre-0168 */ }
    return json({
      agent: { attribution_review: attrReview, payouts_to_settle: payoutsOpen },
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
    const pkI = p ? await packagesOf(env, [p.id]) : new Map<number, PkgRule[]>();
    const calc = p ? commissionOf(o, p, pkI.get(p.id)) : null;
    /* v1.255.0 - an agent deal: the closer's own 3% (the line working, at the default rate, is management's) */
    const ei = (await estimateAll(env, [o], policies, today, pkI)).get(o.id)!;
    if (ei.deal !== "direct") {
      return json({
        invoice: { id: o.id, doc_number: o.doc_number, company: o.company, closer_name: o.closer_name, total_cents: o.total_cents, payment_status: o.payment_status,
          received_cents: o.received, issuer_code: o.issuer_code, doc_kind: o.doc_kind, package_id: o.doc_package_id, created_at: o.created_at },
        stage: stageOf(o), next: ei.deal === "review" ? "attribution_hold" : nextOfOpen(o, !!p), deal: ei.deal, closer_rate_bp: ei.closer_rate_bp,
        policy: p ? { version: p.version, name: p.name, rate_bp: p.rate_bp, fixed_cents: p.fixed_cents, rate_kind: p.rate_kind, basis: p.basis, product_rule: p.product_rule ?? "listed_only" } : null,
        basis_cents: ei.basis_cents, estimate_cents: ei.estimate_cents, lines: all ? calc?.lines ?? null : null,
        ...(all ? { agent_estimate_cents: ei.agent_estimate_cents, hold_reasons: ei.hold_reasons, agent_rate_bp: p?.agent_rate_bp ?? null } : {}),
      });
    }
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
    const agentSw = await env.DB.prepare(`SELECT value FROM business_settings WHERE key = 'agent_partnership'`).first<{ value: string | null }>().catch(() => null);
    return json({
      agent_partnership: agentSw?.value === "off" ? "off" : "on",
      versions, log, in_force: inF ? { ...inF, packages: pkV.get(inF.id) ?? [] } : null, sync: await syncSwitch(env),
      start: COMMISSION_START_DAY, today, can_draft: can(user.role, "commission_draft"), can_approve: can(user.role, "commission_approve"), can_switch: can(user.role, "commission_settle"),
    });
  }
  if (path === "/commission/policy" && method === "POST") {
    if (!can(user.role, "commission_draft")) return err("forbidden", "Only the CEO, COO or super admin drafts a commission policy", 403);
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
    /* v1.255.0 - the agent partnership rates (explicit rates on the eligible
       net sales value: agent 7% + closer 3%). Both or neither; percentage
       versions only; renewals and repeat orders of an agent customer go to
       review (R3) - the other rules need the owner's approval first. */
    let agentBp: number | null = null, closerBp: number | null = null;
    if (body?.agent_rate_pct !== undefined || body?.agent_closer_rate_pct !== undefined) {
      const ar = Number(body?.agent_rate_pct), cr = Number(body?.agent_closer_rate_pct);
      if (kind !== "percent") return err("invalid_input", "Agent partnership rates need a percentage policy.", 400);
      if (!(Number.isFinite(ar) && ar > 0 && ar <= 50 && Number.isFinite(cr) && cr > 0 && cr <= 50)) return err("invalid_input", "Give both agent partnership rates: the agent's and the closer's, each above 0 and at most 50 percent.", 400);
      if (body?.agent_renewal_rule !== undefined && body.agent_renewal_rule !== "review") return err("invalid_input", "Agent renewals: only 'review' is approved (03-11-2026). Another rule needs the owner's approval first.", 400);
      agentBp = Math.round(ar * 100); closerBp = Math.round(cr * 100);
    }
    try {
      /* the version and its package rules in ONE batch (one transaction):
         a draft is never stored without the rules it was drafted with */
      const ins = agentBp !== null ? env.DB.prepare(
        `INSERT INTO commission_policies (version, name, status, effective_from, rate_kind, rate_bp, fixed_cents, basis, reason, created_by, agent_rate_bp, agent_closer_rate_bp, agent_renewal_rule)
         SELECT COALESCE(MAX(version), 0) + 1, ?1, 'draft', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'review' FROM commission_policies`,
      ).bind(name, from, kind, Math.round(pct * 100), null, basis, reason, user.id, agentBp, closerBp) : env.DB.prepare(
        `INSERT INTO commission_policies (version, name, status, effective_from, rate_kind, rate_bp, fixed_cents, basis, reason, created_by)
         SELECT COALESCE(MAX(version), 0) + 1, ?1, 'draft', ?2, ?3, ?4, ?5, ?6, ?7, ?8 FROM commission_policies`,
      ).bind(name, from, kind, kind === "percent" ? Math.round(pct * 100) : null, kind === "fixed" ? fixed : null, basis, reason, user.id);
      await env.DB.batch([ins, ...pkgs.map((q) => env.DB.prepare(
        `INSERT INTO commission_policy_packages (policy_id, package_name, match_key, rule, rate_bp, fixed_cents)
         VALUES ((SELECT MAX(id) FROM commission_policies), ?1, ?2, ?3, ?4, ?5)`,
      ).bind(q.name, q.key, q.rule, q.bp, q.fc))]);
      const r = await env.DB.prepare(`SELECT id, version FROM commission_policies WHERE created_by = ?1 ORDER BY id DESC LIMIT 1`).bind(user.id).first<{ id: number; version: number }>();
      await audit(env, user.id, "commission.policy_draft", "commission_policies", String(r?.id), { version: r?.version, effective_from: from, rate_kind: kind, rate_pct: kind === "percent" ? pct : null, fixed_cents: kind === "fixed" ? fixed : null, basis, reason, packages: pkgs.map((q) => ({ name: q.name, rule: q.rule, rate_bp: q.bp, fixed_cents: q.fc })), agent_rate_bp: agentBp, agent_closer_rate_bp: closerBp });
      return json({ ok: true, id: r?.id, version: r?.version }, 201);
    } catch (e) {
      if (/no such table: commission_policy_packages/i.test(String(e))) return err("migration_missing", "Run migration 0152 first (PUSH.bat)", 503);
      if (/no such column: agent_/i.test(String(e))) return err("migration_missing", "Run migration 0168 first (PUSH.bat)", 503);
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
      if (!can(user.role, "commission_approve")) return err("forbidden", "Only the CEO approves a commission policy", 403);
      if (p.status !== "draft") return err("conflict", "Only a draft is approved.", 409);
      if (p.effective_from < today) return err("invalid_input", `This draft starts on ${p.effective_from}, which has passed. Draft it again from today or later.`, 400);
      if (body?.confirm !== true) return err("invalid_input", "Tick that you approve this policy.", 400);
      /* v1.255.0 - agent rates that do not add up to the version's direct
         rate are approved only with a typed reason (nothing is assumed) */
      const hasAgent = p.agent_rate_bp != null && p.agent_closer_rate_bp != null;
      const mismatch = hasAgent && (p.rate_kind !== "percent" || Number(p.agent_rate_bp) + Number(p.agent_closer_rate_bp) !== Number(p.rate_bp));
      const mReason = str(body?.mismatch_reason, 500) ? String(body!.mismatch_reason).trim() : "";
      if (mismatch && mReason.length < 10) return err("rate_mismatch", `Agent deals pay ${pctText(p.agent_rate_bp)} + ${pctText(p.agent_closer_rate_bp)} = ${pctText(Number(p.agent_rate_bp) + Number(p.agent_closer_rate_bp))}, but a direct sale pays ${p.rate_kind === "percent" ? pctText(p.rate_bp) : "a fixed amount"}. Give the reason to approve it anyway (at least 10 characters).`, 400);
      try {
        const r = mismatch
          ? await env.DB.prepare(`UPDATE commission_policies SET status = 'active', approved_by = ?2, approved_at = datetime('now'), agent_mismatch_reason = ?3 WHERE id = ?1 AND status = 'draft'`).bind(id, user.id, mReason).run()
          : await env.DB.prepare(`UPDATE commission_policies SET status = 'active', approved_by = ?2, approved_at = datetime('now') WHERE id = ?1 AND status = 'draft'`).bind(id, user.id).run();
        if (!r.meta?.changes) return err("conflict", "That draft changed while you were approving it. Reload.", 409);
      } catch (e) {
        if (/UNIQUE/i.test(String(e))) return err("conflict", `Another active version already starts on ${p.effective_from}. Choose a different start day.`, 409);
        throw e;
      }
      await audit(env, user.id, "commission.policy_approve", "commission_policies", String(id), { version: p.version, effective_from: p.effective_from, ...(hasAgent ? { agent_rate_bp: p.agent_rate_bp, agent_closer_rate_bp: p.agent_closer_rate_bp, mismatch_reason: mismatch ? mReason : null } : {}) });
      return json({ ok: true });
    }
    if (pol[2] === "reject" && method === "POST") {
      if (!can(user.role, "commission_approve")) return err("forbidden", "Only the CEO rejects a commission policy", 403);
      const reason = str(body?.reason, 500) ? String(body!.reason).trim() : "";
      if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
      const r = await env.DB.prepare(`UPDATE commission_policies SET status = 'rejected', rejected_by = ?2, rejected_at = datetime('now'), reject_reason = ?3 WHERE id = ?1 AND status = 'draft'`).bind(id, user.id, reason).run();
      if (!r.meta?.changes) return err("conflict", "Only a draft is rejected.", 409);
      await audit(env, user.id, "commission.policy_reject", "commission_policies", String(id), { version: p.version, reason });
      return json({ ok: true });
    }
  }
  if (path === "/commission/settings" && method === "POST") {
    if (!can(user.role, "commission_settle")) return err("forbidden", "Only the CEO switches commission into payroll", 403);
    /* v1.255.0 - THE AGENT KILL SWITCH: off holds every agent-linked sale
       for review (never direct); nothing already written changes */
    if (body?.agent_partnership !== undefined) {
      const v = body.agent_partnership === "on" ? "on" : body.agent_partnership === "off" ? "off" : "";
      const why = str(body?.reason, 500) ? String(body!.reason).trim() : "";
      if (!v) return err("invalid_input", "agent_partnership is on or off", 400);
      if (why.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO business_settings (key, value, updated_by, updated_at) VALUES ('agent_partnership', ?1, ?2, datetime('now'))
                         ON CONFLICT(key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = datetime('now')`).bind(v, user.id),
        env.DB.prepare(`INSERT INTO commission_settings_log (setting, value, reason, changed_by) VALUES ('agent_partnership', ?1, ?2, ?3)`).bind(v, why, user.id),
      ]);
      await audit(env, user.id, "commission.agent_switch", "business_settings", "agent_partnership", { value: v, reason: why });
      return json({ ok: true, agent_partnership: v });
    }
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
        `SELECT items, date(created_at, '+8 hours') AS d FROM sales_documents WHERE doc_type = 'INV' AND COALESCE(payment_status, '') != 'void' AND date(created_at, '+8 hours') >= date(?1, '-180 days') ORDER BY created_at DESC LIMIT 2000`,
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
      `SELECT id, kind, status, payroll_month, user_id FROM commission_ledger WHERE invoice_id = ?1 AND status != 'void' AND recipient_role = 'closer' ORDER BY id`, /* v1.255.0 (F3): the closer's rows only - never the agent's */
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

/* ================================================================== *
 * v1.255.0 - AGENT PARTNERSHIP COMMISSION (the owner's "Final CEO
 * Commission Policy Clarification", claude/AGENT-COMMISSION-AUDIT.md
 * revision 3, and his "approved", 03-11-2026). One engine, this one:
 *
 *   DIRECT_SALE                  no agent signal        closer 10%
 *   AGENT_PARTNERSHIP_SALE       verified agent sale    agent 7% + closer 3%
 *   ATTRIBUTION_REVIEW_REQUIRED  any doubt              held - nothing payable
 *
 * 7% and 3% are RATES ON THE ELIGIBLE NET SALES VALUE (the version's
 * agent_rate_bp and agent_closer_rate_bp), never shares of a commission.
 * A held sale is NEVER paid as a direct sale by itself: a held confirmation
 * keeps one closer row of RM 0.00 under review (its earn:<conf> key - so no
 * pass, old or new, can write a 10% row for it) until the CEO or super
 * admin decides, with a reason. Every classification is written once, with
 * its evidence (commission_attributions, 0168), in the same batch as the
 * rows it pays. The owner's open decisions, taken at their defaults with
 * his "approved": renewals and repeat orders of an agent customer go to
 * review (R3); an agent payout is settled by a different person than the
 * one who authorised it (dual control).
 * ================================================================== */

/** the reason codes, worded for the screens (commission-panel.tsx words them too) */
export const HOLD_REASONS = ["disputed", "agent_partnership_off", "multiple_requests", "agent_customer_repeat", "not_won", "not_published", "no_acceptance", "revision_mismatch", "agent_inactive", "agent_policy_missing", "policy_conflict"] as const;
interface ReqLite { id: number; agent_id: number; status: string; assigned_to: number | null; quotation_id: number | null; published_doc_id: number | null; published_revision: number | null }
export interface AgentCtx { ok: boolean; on: boolean; qts: Map<number, ReqLite[]>; partner: Map<number, number>; disputedInv: Set<number>; disputedCust: Set<number> }
/** What classification reads, loaded once per pass: the requests linked to a
    quotation, the customers of earlier partnership sales (S2), the open
    disputes (S3) and the kill switch. ok = false before 0168: nothing is
    classified, so nothing is written (never a guess). */
export async function agentContext(env: Env): Promise<AgentCtx> {
  const ctx: AgentCtx = { ok: false, on: true, qts: new Map(), partner: new Map(), disputedInv: new Set(), disputedCust: new Set() };
  try {
    const { results: ps } = await env.DB.prepare(
      `SELECT customer_id, agent_id FROM commission_attributions WHERE customer_id IS NOT NULL AND agent_id IS NOT NULL
          AND ((classification = 'partnership' AND decision IS NULL) OR decision = 'partnership') ORDER BY id`,
    ).all<{ customer_id: number; agent_id: number }>();
    for (const p of ps ?? []) ctx.partner.set(Number(p.customer_id), Number(p.agent_id));
    const { results: ds } = await env.DB.prepare(`SELECT scope, ref_id FROM commission_disputes WHERE cleared_at IS NULL`).all<{ scope: string; ref_id: number }>();
    for (const d of ds ?? []) (d.scope === "invoice" ? ctx.disputedInv : ctx.disputedCust).add(Number(d.ref_id));
    const sw = await env.DB.prepare(`SELECT value FROM business_settings WHERE key = 'agent_partnership'`).first<{ value: string | null }>().catch(() => null);
    ctx.on = sw?.value !== "off";
    ctx.ok = true;
  } catch { return ctx; }
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, agent_id, status, assigned_to, quotation_id, published_doc_id, published_revision FROM agent_requests
        WHERE status != 'draft' AND (quotation_id IS NOT NULL OR published_doc_id IS NOT NULL)`,
    ).all<ReqLite>();
    for (const r of results ?? []) {
      for (const q of new Set([r.quotation_id, r.published_doc_id].filter((x): x is number => x !== null && x !== undefined).map(Number))) {
        ctx.qts.set(q, [...(ctx.qts.get(q) ?? []), r]);
      }
    }
  } catch { /* pre-0165: no agent requests */ }
  return ctx;
}

/** The split of a partnership sale under a version, or a conflict. The
    eligible value is the basis of the lines that earn the version's DEFAULT
    rate; a line under a package percentage or fixed rule (or a fixed-amount
    version) is a conflict for the CEO - nothing is substituted. Rounding:
    total = value x (agent + closer) half up, agent = value x agent half up,
    closer = total - agent, so the two always reconcile to the total. */
export function agentSplit(inv: Inv, p: Policy, pkgs: PkgRule[] = []): { conflict: true } | { conflict: false; eligible: number; agent: number; closer: number; total: number } {
  if (p.rate_kind !== "percent" || p.agent_rate_bp == null || p.agent_closer_rate_bp == null) return { conflict: true };
  const c = commissionOf(inv, p, pkgs);
  if (c.lines && c.lines.some((l) => l.rule === "percent" || l.rule === "fixed")) return { conflict: true };
  const eligible = c.lines ? c.lines.filter((l) => l.rule === "default").reduce((s, l) => s + l.basis_cents, 0) : c.basis;
  const half = (bp: number) => Math.floor((Math.max(0, eligible) * bp + 5000) / 10000);
  const total = half(Number(p.agent_rate_bp) + Number(p.agent_closer_rate_bp));
  const agent = half(Number(p.agent_rate_bp));
  return { conflict: false, eligible, agent, closer: total - agent, total };
}

export interface ClassInv extends Inv { invoice_id: number; customer_id: number | null; converted_from: number | null; salesperson_id: number | null; paid_day: string }
export interface Classified {
  cls: "direct" | "partnership" | "review"; reasons: string[]; req: ReqLite | null; agentId: number | null; policy: Policy | null;
  eligible: number | null; agentCents: number | null; closerCents: number | null; closerStatus: "eligible" | "review" | "void"; closerNote: string | null;
  invoicedRevision: number | null; acceptance: { accepted_name: string; accepted_at: string } | null;
}
/** Classify one invoice at its paid day - the same function for the paid
    confirmation (written once) and for an estimate (never stored). */
export async function classify(env: Env, ctx: AgentCtx, inv: ClassInv, policies: Policy[], pk: Map<number, PkgRule[]>): Promise<Classified> {
  const reqs = inv.converted_from ? (ctx.qts.get(Number(inv.converted_from)) ?? []) : [];
  const s2 = inv.customer_id ? ctx.partner.get(Number(inv.customer_id)) : undefined;
  const disputed = ctx.disputedInv.has(Number(inv.invoice_id)) || (!!inv.customer_id && ctx.disputedCust.has(Number(inv.customer_id)));
  const p = inForce(policies, inv.paid_day);
  const base: Classified = { cls: "direct", reasons: [], req: null, agentId: null, policy: p, eligible: null, agentCents: null, closerCents: null, closerStatus: "eligible", closerNote: null, invoicedRevision: null, acceptance: null };
  if (!reqs.length && s2 === undefined && !disputed) return base;
  const reasons: string[] = [];
  if (disputed) reasons.push("disputed");
  if (!ctx.on) reasons.push("agent_partnership_off");
  if (reqs.length > 1) reasons.push("multiple_requests");
  const r = reqs.length === 1 ? reqs[0]! : null;
  if (!reqs.length && s2 !== undefined) reasons.push("agent_customer_repeat"); // R3: a renewal or repeat order of an agent customer
  let invoicedRevision: number | null = null;
  let acceptance: Classified["acceptance"] = null;
  if (r) {
    if (r.status !== "won") reasons.push("not_won");
    if (!r.published_doc_id || Number(r.published_doc_id) !== Number(inv.converted_from)) reasons.push("not_published");
    const qt = await env.DB.prepare(`SELECT revision FROM sales_documents WHERE id = ?1`).bind(Number(inv.converted_from)).first<{ revision: number | null }>().catch(() => null);
    invoicedRevision = qt ? Number(qt.revision ?? 0) : null;
    acceptance = r.published_doc_id ? await env.DB.prepare(`SELECT accepted_name, accepted_at FROM quotation_acceptances WHERE doc_id = ?1 AND revision = ?2`)
      .bind(Number(r.published_doc_id), Number(r.published_revision ?? 0)).first<{ accepted_name: string; accepted_at: string }>().catch(() => null) : null;
    if (!acceptance) reasons.push("no_acceptance");
    if (invoicedRevision === null || invoicedRevision !== Number(r.published_revision ?? -1)) reasons.push("revision_mismatch");
    const ag = await env.DB.prepare(`SELECT role, is_active FROM users WHERE id = ?1`).bind(r.agent_id).first<{ role: string; is_active: number }>().catch(() => null);
    if (!ag || ag.role !== "agent" || !Number(ag.is_active)) reasons.push("agent_inactive");
    if (!p || p.agent_rate_bp == null || p.agent_closer_rate_bp == null) reasons.push("agent_policy_missing");
    else if (agentSplit(inv, p, pk.get(p.id)).conflict) reasons.push("policy_conflict");
  }
  const agentId = r?.agent_id ?? s2 ?? null;
  if (reasons.length) return { ...base, cls: "review", reasons, req: r, agentId, closerStatus: "review", invoicedRevision, acceptance };
  const sp = agentSplit(inv, p!, pk.get(p!.id));
  if (sp.conflict) return { ...base, cls: "review", reasons: ["policy_conflict"], req: r, agentId, closerStatus: "review", invoicedRevision, acceptance };
  let closerStatus: Classified["closerStatus"] = "eligible";
  let closerNote: string | null = null;
  if (!inv.salesperson_id) { closerStatus = "review"; closerNote = "No closer on the invoice - choose one, then apply"; }
  else if (!r!.assigned_to || Number(r!.assigned_to) !== Number(inv.salesperson_id)) { closerStatus = "review"; closerNote = "Closer differs from the agent's assigned salesperson - verify"; }
  if (sp.total <= 0) { closerStatus = "void"; closerNote = `Nothing to earn under v${p!.version}: no line earns the default rate`; }
  return { ...base, cls: "partnership", reasons: [], req: r, agentId, eligible: sp.eligible, agentCents: sp.agent, closerCents: sp.closer, closerStatus, closerNote, invoicedRevision, acceptance };
}

const randKey = () => crypto.randomUUID();
const pctText = (bp: number | null | undefined) => `${(Number(bp ?? 0) / 100).toFixed(Number(bp ?? 0) % 100 ? 2 : 0)}%`;

/** Write one classified confirmation: its attribution and the rows it pays,
    in ONE batch. The rows are written only under this pass's own key, so a
    second pass that classified the same confirmation differently (a dispute
    raised in between) writes nothing - one attribution, its own rows. */
async function writeClassified(env: Env, c: { conf_id: number; invoice_id: number; confirmed_at: string; customer_id: number | null; salesperson_id: number | null; paid_day: string } & Inv, k: Classified, direct: { basis: number; amount: number } | null): Promise<number> {
  const p = k.policy;
  const key = randKey();
  const evidence = JSON.stringify({
    request: k.req ? { id: k.req.id, status: k.req.status, quotation_id: k.req.quotation_id, published_doc_id: k.req.published_doc_id, published_revision: k.req.published_revision, assigned_to: k.req.assigned_to } : null,
    invoiced_revision: k.invoicedRevision, acceptance: k.acceptance, policy_version: p?.version ?? null, rates: p ? { direct_bp: p.rate_bp, agent_bp: p.agent_rate_bp ?? null, closer_bp: p.agent_closer_rate_bp ?? null } : null,
  });
  const attrId = `(SELECT id FROM commission_attributions WHERE confirmation_id = ?1 AND write_key = ?2)`;
  const guard = `WHERE EXISTS (SELECT 1 FROM commission_attributions WHERE confirmation_id = ?1 AND write_key = ?2)`;
  const st = [env.DB.prepare(
    `INSERT OR IGNORE INTO commission_attributions (confirmation_id, invoice_id, customer_id, classification, reasons, agent_id, agent_request_id, quotation_id, published_revision, invoiced_revision,
       accepted_name, accepted_at, assigned_to, closer_id, policy_id, paid_day, eligible_cents, agent_cents, closer_cents, evidence, write_key)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`,
  ).bind(c.conf_id, c.invoice_id, c.customer_id ?? null, k.cls, k.reasons.join(",") || null, k.agentId, k.req?.id ?? null, k.req?.published_doc_id ?? null, k.req?.published_revision ?? null, k.invoicedRevision,
    k.acceptance?.accepted_name ?? null, k.acceptance?.accepted_at ?? null, k.req?.assigned_to ?? null, c.salesperson_id ?? null, p?.id ?? null, c.paid_day,
    k.cls === "direct" ? direct?.basis ?? null : k.eligible, k.agentCents, k.cls === "direct" ? direct?.amount ?? null : k.closerCents, evidence, key)];
  const row = (source: string, role: "closer" | "agent", user: number | null, basis: number, rate: number | null, amount: number, status: string, note: string | null) => env.DB.prepare(
    `INSERT OR IGNORE INTO commission_ledger (source_key, kind, invoice_id, confirmation_id, user_id, policy_id, basis_cents, rate_bp, fixed_cents, amount_cents, paid_day, status, eligible_at, note, recipient_role, attribution_id, agent_request_id)
     SELECT ?3, 'earn', ?4, ?1, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ${attrId}, ?16 ${guard}`,
  ).bind(c.conf_id, key, source, c.invoice_id, user, p?.id ?? null, basis, rate, role === "closer" && k.cls === "direct" && p?.rate_kind === "fixed" ? p.fixed_cents : null, amount, c.paid_day, status, c.confirmed_at, note, role, k.req?.id ?? null);
  if (k.cls === "direct" && p && direct) {
    const noCloser = !c.salesperson_id;
    const nothing = !noCloser && direct.amount <= 0;
    st.push(row(`earn:${c.conf_id}`, "closer", c.salesperson_id ?? null, direct.basis, p.rate_kind === "percent" ? p.rate_bp : null, direct.amount,
      noCloser ? "review" : nothing ? "void" : "eligible",
      noCloser ? "No closer on the invoice - choose one, then apply" : nothing ? `Nothing to earn under v${p.version}: no line earns (a product not listed, or a rule of none)` : null));
  } else if (k.cls === "partnership" && p) {
    st.push(row(`earn:${c.conf_id}`, "closer", c.salesperson_id ?? null, k.eligible ?? 0, p.agent_closer_rate_bp ?? null, k.closerCents ?? 0, k.closerStatus, k.closerNote));
    st.push(row(`agent:${c.conf_id}`, "agent", k.agentId, k.eligible ?? 0, p.agent_rate_bp ?? null, k.agentCents ?? 0, (k.agentCents ?? 0) > 0 ? "eligible" : "void", (k.agentCents ?? 0) > 0 ? null : "Nothing to earn: no line earns the default rate"));
  } else {
    /* HELD: one closer row of RM 0.00 under review holds earn:<conf>, so
       nothing - this engine, a catch-up pass, an older build - can write a
       direct 10% for it. It pays nothing until the decision. */
    st.push(row(`earn:${c.conf_id}`, "closer", c.salesperson_id ?? null, 0, null, 0, "review", `Held: attribution review (${k.reasons.join(", ")})`));
  }
  await env.DB.batch(st);
  const w = await env.DB.prepare(`SELECT COUNT(*) AS n FROM commission_ledger WHERE confirmation_id = ?1 AND attribution_id = (SELECT id FROM commission_attributions WHERE confirmation_id = ?1 AND write_key = ?2)`).bind(c.conf_id, key).first<{ n: number }>().catch(() => null);
  const n = Number(w?.n ?? 0);
  if (n && k.cls === "review") await tellDeciders(env, `Attribution review needed: ${await docNo(env, c.invoice_id)} (${k.reasons.join(", ")})`, `comm-attr:${c.conf_id}`);
  return n;
}
async function docNo(env: Env, id: number): Promise<string> {
  const d = await env.DB.prepare(`SELECT doc_number FROM sales_documents WHERE id = ?1`).bind(id).first<{ doc_number: string }>().catch(() => null);
  return d?.doc_number ?? `invoice ${id}`;
}
/** the people who decide a review (commission_settle), told once per ref */
async function tellDeciders(env: Env, text: string, ref: string): Promise<void> {
  try {
    const { results } = await env.DB.prepare(`SELECT id, role FROM users WHERE is_active = 1 AND role NOT IN ('customer', 'agent')`).all<{ id: number; role: string }>();
    for (const u of (results ?? []).filter((x) => can(x.role, "commission_settle"))) await notify(env, u.id, "commission", text, ref, { once: true }).catch(() => false);
  } catch { /* notifications are best effort */ }
}

/* ---- v1.255.0 - management's agent deals: the review queue and its
   decisions, the disputes (S3) and the agent payouts. Commission module
   only; every money write is conditional and in one batch. ---- */
const DAYRX = /^\d{4}-\d{2}-\d{2}$/;
async function handleAgentDeals(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  const all = can(user.role, "commission_view_all");
  const decider = can(user.role, "commission_settle");
  const today = mytToday();
  const reasonOf = (v: unknown) => (str(v, 500) ? String(v).trim() : "");
  const missingT = (e: unknown) => /no such table|no such column/i.test(String(e));

  /* ---------- the review queue ---------- */
  if (path === "/commission/attributions" && method === "GET") {
    if (!all) return err("forbidden", "Management access required", 403);
    await ensureLedger(env);
    const which = params.get("status") ?? "review";
    try {
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.confirmation_id, a.invoice_id, a.customer_id, a.classification, a.reasons, a.agent_id, a.agent_request_id, a.quotation_id, a.published_revision, a.invoiced_revision,
                a.accepted_name, a.accepted_at, a.assigned_to, a.closer_id, a.policy_id, a.paid_day, a.eligible_cents, a.agent_cents, a.closer_cents, a.evidence, a.created_at,
                a.decision, a.decision_policy_id, a.decided_at, a.decision_note, a.closed_at, a.closed_reason,
                d.doc_number, d.total_cents AS invoice_total, k.company, q.doc_number AS quotation_number, c.revoked_at,
                ${PERSON("ag")} AS agent_name, ${PERSON("s")} AS assigned_name, ${PERSON("cl")} AS closer_name, ${PERSON("dd")} AS decided_by_name, p.version AS policy_version
           FROM commission_attributions a JOIN sales_documents d ON d.id = a.invoice_id LEFT JOIN customers k ON k.id = a.customer_id
           LEFT JOIN sales_documents q ON q.id = a.quotation_id LEFT JOIN invoice_paid_confirmations c ON c.id = a.confirmation_id
           LEFT JOIN users ag ON ag.id = a.agent_id LEFT JOIN users s ON s.id = a.assigned_to LEFT JOIN users cl ON cl.id = a.closer_id LEFT JOIN users dd ON dd.id = a.decided_by
           LEFT JOIN commission_policies p ON p.id = a.policy_id
          ${which === "review" ? "WHERE a.classification = 'review' AND a.decision IS NULL AND a.closed_at IS NULL" : which === "agent" ? "WHERE a.classification != 'direct' OR a.decision IS NOT NULL" : ""}
          ORDER BY a.id DESC LIMIT 300`,
      ).all<Record<string, unknown>>();
      const versions = ((await env.DB.prepare(
        `SELECT id, version, name, effective_from, rate_bp, agent_rate_bp, agent_closer_rate_bp FROM commission_policies WHERE status = 'active' ORDER BY effective_from DESC`,
      ).all()).results ?? []);
      const disputes = ((await env.DB.prepare(
        `SELECT x.*, ${PERSON("u")} AS created_by_name, ${PERSON("cu")} AS cleared_by_name,
                CASE WHEN x.scope = 'invoice' THEN (SELECT doc_number FROM sales_documents WHERE id = x.ref_id) ELSE (SELECT company FROM customers WHERE id = x.ref_id) END AS ref_label
           FROM commission_disputes x LEFT JOIN users u ON u.id = x.created_by LEFT JOIN users cu ON cu.id = x.cleared_by ORDER BY x.id DESC LIMIT 100`,
      ).all()).results ?? []);
      const agents = ((await env.DB.prepare(`SELECT id, ${PERSON("u")} AS name, is_active FROM users u WHERE role = 'agent' ORDER BY name`).all()).results ?? []);
      return json({
        attributions: (results ?? []).map((r) => ({ ...r, reasons: String(r.reasons ?? "").split(",").filter(Boolean), evidence: (() => { try { return JSON.parse(String(r.evidence ?? "null")); } catch { return null; } })() })),
        versions, disputes, agents, can_decide: decider, can_flag: can(user.role, "commission_draft"), today,
      });
    } catch (e) {
      if (missingT(e)) return json({ attributions: [], versions: [], disputes: [], agents: [], can_decide: false, can_flag: false, today, pending_migration: true });
      throw e;
    }
  }

  const dec = path.match(/^\/commission\/attributions\/(\d+)\/decide$/);
  if (dec && method === "POST") {
    if (!decider) return err("forbidden", "Only the CEO or super admin decides an attribution review", 403);
    const id = Number(dec[1]);
    const decision = String(body?.decision ?? "");
    const note = reasonOf(body?.note);
    if (!["partnership", "direct", "none"].includes(decision)) return err("invalid_input", "decision is partnership, direct or none", 400);
    if (note.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
    const a = await env.DB.prepare(`SELECT * FROM commission_attributions WHERE id = ?1`).bind(id).first<{ id: number; confirmation_id: number; invoice_id: number; customer_id: number | null; classification: string; decision: string | null; closed_at: string | null; agent_id: number | null; agent_request_id: number | null; paid_day: string }>().catch(() => null);
    if (!a) return err("not_found", "Attribution not found", 404);
    if (a.classification !== "review" || a.decision || a.closed_at) return err("conflict", "This sale is not waiting for a decision (decided, closed, or never held).", 409);
    const conf = await env.DB.prepare(`SELECT revoked_at, confirmed_at FROM invoice_paid_confirmations WHERE id = ?1`).bind(a.confirmation_id).first<{ revoked_at: string | null; confirmed_at: string }>();
    if (!conf || conf.revoked_at) return err("conflict", "The paid confirmation was taken back - there is nothing to decide.", 409);
    const inv = await env.DB.prepare(
      `SELECT d.items, d.discount_cents, d.total_cents, d.salesperson_id, d.kind AS doc_kind, ${await docPkgCol(env)} AS doc_package_id FROM sales_documents d WHERE d.id = ?1`,
    ).bind(a.invoice_id).first<Inv & { salesperson_id: number | null }>();
    if (!inv) return err("not_found", "The invoice is gone", 404);
    if (decision !== "none" && !inv.salesperson_id) return err("invalid_input", "Name the closer on the invoice first (Sales), then decide.", 400);
    const key = randKey();
    const pols = await activePolicies(env);
    let p: Policy | null = null;
    if (decision !== "none") {
      const pid = Number(body?.policy_id);
      p = Number.isInteger(pid) && pid > 0 ? pols.find((x) => x.id === pid) ?? null : decision === "direct" ? inForce(pols, a.paid_day) : null;
      if (!p) return err("invalid_input", decision === "partnership" ? "Choose the approved policy version with agent rates that applies." : "No approved policy applies on the paid day.", 400);
    }
    let agentId = a.agent_id;
    if (decision === "partnership") {
      if (p!.agent_rate_bp == null || p!.agent_closer_rate_bp == null) return err("invalid_input", `v${p!.version} has no agent partnership rates. Choose a version that has them.`, 400);
      if (!agentId) {
        const want = Number(body?.agent_id);
        const ag = Number.isInteger(want) && want > 0 ? await env.DB.prepare(`SELECT id FROM users WHERE id = ?1 AND role = 'agent'`).bind(want).first<{ id: number }>() : null;
        if (!ag) return err("invalid_input", "Choose the agent this sale belongs to.", 400);
        agentId = ag.id;
      }
      if (p!.effective_from > a.paid_day && body?.confirm_retro !== true) {
        return err("retrospective", `The money landed on ${a.paid_day}, before v${p!.version} started (${p!.effective_from}). Confirming makes this a retrospective allocation, recorded as your decision - tick to confirm.`, 409);
      }
    }
    const stamp = env.DB.prepare(
      `UPDATE commission_attributions SET decision = ?2, decision_key = ?3, decision_policy_id = ?4, decided_by = ?5, decided_at = datetime('now'), decision_note = ?6
        WHERE id = ?1 AND decision IS NULL AND closed_at IS NULL AND classification = 'review'`,
    ).bind(id, decision, key, p?.id ?? null, user.id, note);
    const guard = `EXISTS (SELECT 1 FROM commission_attributions WHERE id = ?1 AND decision_key = ?2)`;
    const voidHold = env.DB.prepare(
      `UPDATE commission_ledger SET status = 'void', decided_by = ?3, decided_at = datetime('now'), decision_note = ?4
        WHERE attribution_id = ?1 AND kind = 'earn' AND status = 'review' AND amount_cents = 0 AND ${guard}`,
    ).bind(id, key, user.id, `${decision}: ${note}`.slice(0, 500));
    const ins = (source: string, role: "closer" | "agent", uid: number, basis: number, rate: number | null, fixedC: number | null, amount: number, why: string) => env.DB.prepare(
      `INSERT OR IGNORE INTO commission_ledger (source_key, kind, invoice_id, confirmation_id, user_id, policy_id, basis_cents, rate_bp, fixed_cents, amount_cents, paid_day, status, eligible_at, note,
         recipient_role, attribution_id, agent_request_id, decided_by, decided_at, decision_note)
       SELECT ?3, 'earn', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now'), ?14, ?15, ?1, ?16, ?17, datetime('now'), ?18 WHERE ${guard}`,
    ).bind(id, key, source, a.invoice_id, a.confirmation_id, uid, p!.id, basis, rate, fixedC, amount, a.paid_day, amount > 0 ? "eligible" : "void", why, role, a.agent_request_id, user.id, note);
    const st = [stamp, voidHold];
    let out: Record<string, unknown> = {};
    if (decision === "direct") {
      const c = commissionOf(inv, p!, (await packagesOf(env, [p!.id])).get(p!.id));
      st.push(ins(`earn:${a.confirmation_id}:d`, "closer", Number(inv.salesperson_id), c.basis, p!.rate_kind === "percent" ? p!.rate_bp : null, p!.rate_kind === "fixed" ? p!.fixed_cents : null, c.amount, `Direct sale by decision: ${note}`.slice(0, 400)));
      out = { closer_cents: c.amount };
    } else if (decision === "partnership") {
      const sp = agentSplit(inv, p!, (await packagesOf(env, [p!.id])).get(p!.id));
      if (sp.conflict) return err("policy_conflict", "A line of this invoice follows a package rule of its own, so the agent split cannot be applied. Decide it as a direct sale or no commission, or approve a version without that conflict.", 409);
      const retro = p!.effective_from > a.paid_day ? " (retrospective allocation)" : "";
      st.push(ins(`earn:${a.confirmation_id}:p`, "closer", Number(inv.salesperson_id), sp.eligible, p!.agent_closer_rate_bp ?? null, null, sp.closer, `Agent deal by decision${retro}: ${note}`.slice(0, 400)));
      st.push(ins(`agent:${a.confirmation_id}`, "agent", Number(agentId), sp.eligible, p!.agent_rate_bp ?? null, null, sp.agent, `Agent deal by decision${retro}: ${note}`.slice(0, 400)));
      out = { closer_cents: sp.closer, agent_cents: sp.agent };
    }
    await env.DB.batch(st);
    const mine = await env.DB.prepare(`SELECT decision_key FROM commission_attributions WHERE id = ?1`).bind(id).first<{ decision_key: string | null }>();
    if (mine?.decision_key !== key) return err("conflict", "Someone decided this sale while you were deciding. Reload.", 409);
    await audit(env, user.id, `commission.attribution_${decision}`, "commission_attributions", String(id), { note, policy_id: p?.id ?? null, agent_id: decision === "partnership" ? agentId : null, ...out });
    const dn = await docNo(env, a.invoice_id);
    if (decision !== "none") await notify(env, Number(inv.salesperson_id), "commission", `${dn}: the attribution review is decided - your commission is ${fmt(Number(out.closer_cents ?? 0))}`, `comm-attr-done:${id}`).catch(() => false);
    if (decision === "partnership") await notify(env, Number(agentId), "agent", `${dn}: your commission of ${fmt(Number(out.agent_cents ?? 0))} is confirmed`, `comm-attr-done:${id}:agent`).catch(() => false);
    return json({ ok: true, decision, ...out });
  }

  /* ---------- disputes (S3): flagged by management, cleared by the CEO ---------- */
  if (path === "/commission/disputes" && method === "POST") {
    if (!can(user.role, "commission_draft")) return err("forbidden", "Only the CEO, COO or super admin flags a disputed attribution", 403);
    const scope = body?.scope === "customer" ? "customer" : body?.scope === "invoice" ? "invoice" : "";
    let ref = Number(body?.ref_id);
    /* from the screen: an invoice number - the invoice itself, or its customer (renewals too) */
    if (!(ref > 0) && str(body?.doc_number, 60)) {
      const d = await env.DB.prepare(`SELECT id, customer_id FROM sales_documents WHERE doc_number = ?1 AND doc_type = 'INV'`).bind(String(body!.doc_number).trim()).first<{ id: number; customer_id: number | null }>();
      if (!d) return err("not_found", "No invoice with that number", 404);
      ref = scope === "customer" ? Number(d.customer_id ?? 0) : d.id;
    }
    const reason = reasonOf(body?.reason);
    if (!scope || !Number.isInteger(ref) || ref <= 0) return err("invalid_input", "scope (invoice or customer) and ref_id are required", 400);
    if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
    const exists = scope === "invoice"
      ? await env.DB.prepare(`SELECT id FROM sales_documents WHERE id = ?1 AND doc_type = 'INV'`).bind(ref).first()
      : await env.DB.prepare(`SELECT id FROM customers WHERE id = ?1`).bind(ref).first();
    if (!exists) return err("not_found", `That ${scope} does not exist`, 404);
    const open = await env.DB.prepare(`SELECT id FROM commission_disputes WHERE scope = ?1 AND ref_id = ?2 AND cleared_at IS NULL`).bind(scope, ref).first<{ id: number }>();
    if (open) return json({ ok: true, id: open.id, existing: true });
    const r = await env.DB.prepare(`INSERT INTO commission_disputes (scope, ref_id, reason, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`).bind(scope, ref, reason, user.id).first<{ id: number }>();
    await audit(env, user.id, "commission.dispute", "commission_disputes", String(r?.id), { scope, ref_id: ref, reason });
    return json({ ok: true, id: r?.id }, 201);
  }
  const clr = path.match(/^\/commission\/disputes\/(\d+)\/clear$/);
  if (clr && method === "POST") {
    if (!decider) return err("forbidden", "Only the CEO or super admin clears a dispute", 403);
    const reason = reasonOf(body?.reason);
    if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
    const r = await env.DB.prepare(`UPDATE commission_disputes SET cleared_by = ?2, cleared_at = datetime('now'), clear_reason = ?3 WHERE id = ?1 AND cleared_at IS NULL`).bind(Number(clr[1]), user.id, reason).run();
    if (!r.meta?.changes) return err("conflict", "That dispute is cleared already, or does not exist.", 409);
    await audit(env, user.id, "commission.dispute_clear", "commission_disputes", clr[1]!, { reason });
    return json({ ok: true });
  }

  /* ---------- agent payouts: authorise, then a DIFFERENT person confirms
     the settlement with the bank reference (dual control). One cash-book
     row at settlement, never before, never twice. ---------- */
  if (path === "/commission/payouts" && method === "GET") {
    if (!all) return err("forbidden", "Management access required", 403);
    await ensureLedger(env);
    try {
      const due = ((await env.DB.prepare(
        `SELECT l.user_id AS agent_id, ${PERSON("u")} AS agent_name, u.is_active, COUNT(*) AS n, COALESCE(SUM(l.amount_cents), 0) AS cents
           FROM commission_ledger l JOIN users u ON u.id = l.user_id
          WHERE l.recipient_role = 'agent' AND l.kind = 'earn' AND l.status = 'eligible' AND l.payout_id IS NULL AND l.amount_cents > 0
          GROUP BY l.user_id ORDER BY agent_name`,
      ).all()).results ?? []);
      const rows = ((await env.DB.prepare(
        `SELECT l.id, l.user_id AS agent_id, l.amount_cents, l.rate_bp, l.status, l.payout_id, l.created_at, d.doc_number, k.company
           FROM commission_ledger l JOIN sales_documents d ON d.id = l.invoice_id LEFT JOIN customers k ON k.id = d.customer_id
          WHERE l.recipient_role = 'agent' AND l.kind = 'earn' AND l.status IN ('eligible', 'included') ORDER BY l.id`,
      ).all()).results ?? []);
      const payouts = ((await env.DB.prepare(
        `SELECT o.*, ${PERSON("u")} AS agent_name, ${PERSON("a")} AS authorized_by_name, ${PERSON("s")} AS settled_by_name, ${PERSON("c")} AS cancelled_by_name
           FROM agent_payouts o LEFT JOIN users u ON u.id = o.agent_id LEFT JOIN users a ON a.id = o.authorized_by LEFT JOIN users s ON s.id = o.settled_by LEFT JOIN users c ON c.id = o.cancelled_by
          ORDER BY o.id DESC LIMIT 200`,
      ).all()).results ?? []);
      return json({ due, rows, payouts: payouts.map((o) => ({ ...(o as Record<string, unknown>), auth_key: undefined })), can_authorise: decider, can_settle: decider, me: user.id, today });
    } catch (e) {
      if (missingT(e)) return json({ due: [], rows: [], payouts: [], can_authorise: false, can_settle: false, me: user.id, today, pending_migration: true });
      throw e;
    }
  }
  if (path === "/commission/payouts" && method === "POST") {
    if (!decider) return err("forbidden", "Only the CEO or super admin authorises an agent payout", 403);
    const agentId = Number(body?.agent_id);
    const ag = Number.isInteger(agentId) && agentId > 0 ? await env.DB.prepare(`SELECT id, ${PERSON("u")} AS name FROM users u WHERE id = ?1 AND role = 'agent'`).bind(agentId).first<{ id: number; name: string }>() : null;
    if (!ag) return err("invalid_input", "Choose the agent", 400);
    const ids = Array.isArray(body?.entry_ids) ? [...new Set((body!.entry_ids as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 200) : [];
    const note = reasonOf(body?.note);
    const only = ids.length ? ` AND id IN (${ids.join(",")})` : "";
    const key = randKey();
    const pick = `recipient_role = 'agent' AND user_id = ?2 AND kind = 'earn' AND status = 'eligible' AND payout_id IS NULL AND amount_cents > 0${only}`;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO agent_payouts (auth_key, agent_id, note, authorized_by) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM commission_ledger WHERE ${pick})`).bind(key, ag.id, note || null, user.id),
      env.DB.prepare(`UPDATE commission_ledger SET status = 'included', included_at = datetime('now'), payout_id = (SELECT id FROM agent_payouts WHERE auth_key = ?1) WHERE ${pick} AND EXISTS (SELECT 1 FROM agent_payouts WHERE auth_key = ?1)`).bind(key, ag.id),
      env.DB.prepare(`UPDATE agent_payouts SET amount_cents = (SELECT COALESCE(SUM(l.amount_cents), 0) FROM commission_ledger l WHERE l.payout_id = agent_payouts.id), row_count = (SELECT COUNT(*) FROM commission_ledger l WHERE l.payout_id = agent_payouts.id) WHERE auth_key = ?1`).bind(key),
    ]);
    const o = await env.DB.prepare(`SELECT id, amount_cents, row_count FROM agent_payouts WHERE auth_key = ?1`).bind(key).first<{ id: number; amount_cents: number; row_count: number }>();
    if (!o) return err("conflict", "Nothing eligible to authorise for this agent (another payout may have taken it). Reload.", 409);
    await audit(env, user.id, "commission.payout_authorise", "agent_payouts", String(o.id), { agent_id: ag.id, amount_cents: o.amount_cents, rows: o.row_count, note });
    return json({ ok: true, id: o.id, ref: `AGT-${o.id}`, amount_cents: o.amount_cents, rows: o.row_count }, 201);
  }
  const po = path.match(/^\/commission\/payouts\/(\d+)\/(settle|cancel)$/);
  if (po && method === "POST") {
    if (!decider) return err("forbidden", "Only the CEO or super admin settles or cancels an agent payout", 403);
    const id = Number(po[1]);
    const o = await env.DB.prepare(`SELECT o.*, ${PERSON("u")} AS agent_name FROM agent_payouts o LEFT JOIN users u ON u.id = o.agent_id WHERE o.id = ?1`).bind(id).first<{ id: number; agent_id: number; agent_name: string | null; status: string; amount_cents: number; authorized_by: number; authorized_at: string; settled_by: number | null; settled_on: string | null; bank_ref: string | null }>();
    if (!o) return err("not_found", "Payout not found", 404);
    const ref = `AGT-${o.id}`;
    const book = (by: number, on: string, bank: string) => bookCash(env, by, ref, Number(o.amount_cents), "agent_commission", `Agent commission payout ${ref} - ${o.agent_name ?? "agent"} - ${bank}`, "out", on);
    if (po[2] === "cancel") {
      if (o.status !== "authorized") return err("conflict", o.status === "settled" ? "A settled payout is never cancelled - a correction is a reversal for review." : "This payout is cancelled already.", 409);
      const reason = reasonOf(body?.reason);
      if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
      await env.DB.batch([
        env.DB.prepare(`UPDATE agent_payouts SET status = 'cancelled', cancelled_by = ?2, cancelled_at = datetime('now'), cancel_reason = ?3 WHERE id = ?1 AND status = 'authorized'`).bind(id, user.id, reason),
        env.DB.prepare(`UPDATE commission_ledger SET status = 'eligible', payout_id = NULL, included_at = NULL WHERE payout_id = ?1 AND status = 'included' AND EXISTS (SELECT 1 FROM agent_payouts WHERE id = ?1 AND status = 'cancelled')`).bind(id),
      ]);
      const now = await env.DB.prepare(`SELECT status FROM agent_payouts WHERE id = ?1`).bind(id).first<{ status: string }>();
      if (now?.status !== "cancelled") return err("conflict", "That payout changed while you were cancelling. Reload.", 409);
      await audit(env, user.id, "commission.payout_cancel", "agent_payouts", String(id), { reason });
      return json({ ok: true, status: "cancelled" });
    }
    /* settle */
    if (o.status === "settled") {
      /* a retry after the money was confirmed: books the one cash row if it is missing - never a second */
      await book(Number(o.settled_by), String(o.settled_on), String(o.bank_ref ?? ""));
      return json({ ok: true, already_settled: true, status: "settled" });
    }
    if (o.status !== "authorized") return err("conflict", "A cancelled payout is not settled.", 409);
    if (Number(o.authorized_by) === user.id) return err("dual_control", "Dual control: the person who authorised this payout cannot also confirm its settlement. Another CEO or super admin confirms it.", 403);
    const bank = str(body?.bank_ref, 80) ? String(body!.bank_ref).trim() : "";
    const on = String(body?.settled_on ?? "");
    const authDay = new Date(Date.parse(`${o.authorized_at.replace(" ", "T")}Z`) + 8 * 3600 * 1000).toISOString().slice(0, 10);
    if (bank.length < 3) return err("invalid_input", "Enter the bank reference of the transfer.", 400);
    if (!DAYRX.test(on) || on > today || on < authDay) return err("invalid_input", `The settlement date is the day the bank paid - from ${authDay} to today.`, 400);
    const proof = str(body?.proof_note, 300) ? String(body!.proof_note).trim() : null;
    await env.DB.batch([
      env.DB.prepare(`UPDATE agent_payouts SET status = 'settled', settled_by = ?2, settled_at = datetime('now'), settled_on = ?3, bank_ref = ?4, proof_note = ?5 WHERE id = ?1 AND status = 'authorized'`).bind(id, user.id, on, bank, proof),
      env.DB.prepare(`UPDATE commission_ledger SET status = 'paid', paid_out_at = datetime('now') WHERE payout_id = ?1 AND status = 'included' AND EXISTS (SELECT 1 FROM agent_payouts WHERE id = ?1 AND status = 'settled')`).bind(id),
    ]);
    const after = await env.DB.prepare(`SELECT status, settled_by, bank_ref FROM agent_payouts WHERE id = ?1`).bind(id).first<{ status: string; settled_by: number | null; bank_ref: string | null }>();
    if (after?.status !== "settled" || Number(after.settled_by) !== user.id || after.bank_ref !== bank) return err("conflict", "That payout was settled or changed by someone else while you were confirming. Reload.", 409);
    await book(user.id, on, bank);
    await audit(env, user.id, "commission.payout_settle", "agent_payouts", String(id), { amount_cents: o.amount_cents, settled_on: on, bank_ref: bank });
    await notify(env, o.agent_id, "agent", `A payout of ${fmt(Number(o.amount_cents))} was settled (${on}, ref ${bank})`, `agent-payout:${id}`).catch(() => false);
    return json({ ok: true, status: "settled", ref });
  }
  return null;
}
const fmt = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** v1.255.0 - THE AGENT'S OWN COMMISSION (/agent/commission): their agent
    rows only - each referred sale, "Your commission rate: 7%", estimated,
    eligible, pending payout, paid (date and bank reference), held as "Under
    review" with no amount. Never the closer, the 3%, the 10%, a split, the
    basis or anyone else's row: the fields are listed here, nothing else
    leaves. */
export async function agentCommission(env: Env, agentId: number): Promise<Response> {
  const today = mytToday();
  try {
    await ensureLedger(env);
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.kind, l.status, l.amount_cents, l.rate_bp, l.created_at, l.agent_request_id, d.doc_number AS invoice_number, k.company, q.doc_number AS quotation_number,
              o.status AS payout_status, o.settled_on, o.bank_ref, o.id AS payout_ref
         FROM commission_ledger l JOIN sales_documents d ON d.id = l.invoice_id LEFT JOIN customers k ON k.id = d.customer_id
         LEFT JOIN sales_documents q ON q.id = d.converted_from LEFT JOIN agent_payouts o ON o.id = l.payout_id
        WHERE l.recipient_role = 'agent' AND l.user_id = ?1 AND l.status != 'void' ORDER BY l.id DESC LIMIT 300`,
    ).bind(agentId).all<{ id: number; kind: string; status: string; amount_cents: number; rate_bp: number | null; created_at: string; agent_request_id: number | null; invoice_number: string; company: string | null; quotation_number: string | null; payout_status: string | null; settled_on: string | null; bank_ref: string | null; payout_ref: number | null }>();
    const stage = (s: string) => s === "eligible" ? "eligible" : s === "included" ? "pending_payout" : s === "paid" ? "paid" : "under_review";
    const rows = (results ?? []).map((r) => {
      const st = stage(r.status);
      return {
        id: r.id, kind: r.kind, stage: st, request_ref: r.agent_request_id ? `AGR-${String(r.agent_request_id).padStart(4, "0")}` : null,
        client: r.company, quotation_number: r.quotation_number, invoice_number: r.invoice_number, rate_bp: r.rate_bp,
        amount_cents: st === "under_review" ? null : r.amount_cents, at: r.created_at,
        payout: r.payout_ref ? { ref: `AGT-${r.payout_ref}`, status: r.payout_status, settled_on: r.payout_status === "settled" ? r.settled_on : null, bank_ref: r.payout_status === "settled" ? r.bank_ref : null } : null,
      };
    });
    const held = ((await env.DB.prepare(
      `SELECT a.id, a.agent_request_id, a.created_at, d.doc_number AS invoice_number, k.company, q.doc_number AS quotation_number
         FROM commission_attributions a JOIN sales_documents d ON d.id = a.invoice_id LEFT JOIN customers k ON k.id = d.customer_id LEFT JOIN sales_documents q ON q.id = d.converted_from
        WHERE a.agent_id = ?1 AND a.classification = 'review' AND a.decision IS NULL AND a.closed_at IS NULL ORDER BY a.id DESC`,
    ).bind(agentId).all<{ id: number; agent_request_id: number | null; created_at: string; invoice_number: string; company: string | null; quotation_number: string | null }>()).results ?? []).map((h) => ({
      id: `held-${h.id}`, kind: "earn", stage: "under_review", request_ref: h.agent_request_id ? `AGR-${String(h.agent_request_id).padStart(4, "0")}` : null,
      client: h.company, quotation_number: h.quotation_number, invoice_number: h.invoice_number, rate_bp: null, amount_cents: null, at: h.created_at, payout: null,
    }));
    /* estimates: invoices made from this agent's quotations, not yet confirmed - only where the sale classifies as theirs */
    const ctx = await agentContext(env);
    const mineQ = [...ctx.qts.entries()].filter(([, rs]) => rs.some((r) => r.agent_id === agentId)).map(([q]) => q);
    const policies = await activePolicies(env);
    const pk = await packagesOf(env, policies.map((x) => x.id));
    const est: Record<string, unknown>[] = [];
    let estC = 0;
    if (mineQ.length) {
      const opens = (await openInvoices(env, null)).filter((o) => o.converted_from && mineQ.includes(Number(o.converted_from)));
      const em = await estimateAll(env, opens, policies, today, pk);
      for (const o of opens) {
        const e = em.get(o.id)!;
        if (e.agent_id !== agentId || e.deal === "direct") continue;
        const req = (ctx.qts.get(Number(o.converted_from)) ?? []).find((r) => r.agent_id === agentId);
        const amt = e.deal === "partnership" ? e.agent_estimate_cents : null;
        if (amt) estC += amt;
        est.push({ id: `est-${o.id}`, kind: "estimate", stage: e.deal === "partnership" ? "estimated" : "under_review", request_ref: req ? `AGR-${String(req.id).padStart(4, "0")}` : null,
          client: o.company, quotation_number: null, invoice_number: o.doc_number, rate_bp: e.deal === "partnership" ? (inForce(policies, today)?.agent_rate_bp ?? null) : null, amount_cents: amt, at: o.created_at, payout: null });
      }
    }
    const sum = (st: string) => rows.filter((r) => r.stage === st).reduce((a, r) => a + Number(r.amount_cents ?? 0), 0);
    const rate = inForce(policies, today > COMMISSION_START_DAY ? today : COMMISSION_START_DAY)?.agent_rate_bp ?? null;
    return json({
      rate_bp: rate, rows: [...est, ...held, ...rows],
      totals: { estimated: estC, eligible: sum("eligible"), pending_payout: sum("pending_payout"), paid: sum("paid"), under_review: rows.filter((r) => r.stage === "under_review").length + held.length },
    });
  } catch (e) {
    if (/no such table|no such column/i.test(String(e))) return json({ rate_bp: null, rows: [], totals: { estimated: 0, eligible: 0, pending_payout: 0, paid: 0, under_review: 0 }, pending_migration: true });
    throw e;
  }
}

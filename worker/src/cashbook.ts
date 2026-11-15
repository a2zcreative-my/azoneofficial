/* v1.219.0 - FINANCE & CASH FLOW 2.0 (the owner's brief and answers,
 * 28-10-2026; the audit is claude/FINANCE-AUDIT.md).
 *
 * The answers this file carries:
 *   - "Same as Sales": invoice money in is read from the invoices themselves -
 *     each part payment on the day it landed, the rest of a paid invoice on
 *     its paid day (the /docs/summary "cash received" rule, Malaysia time).
 *     The INV- rows the cash book already holds are not counted twice; they
 *     stay where they are, with their journal entries.
 *   - "Show true dates, flag issues": every row is shown on the day the money
 *     moved - read from its source (claim, expense, payroll run) when the row
 *     itself does not carry it - and anything out of step is listed under
 *     Reconciliation. No stored row is rewritten.
 *   - "Approve 0147": a booking is ONE atomic statement with a unique key; an
 *     undone payment adds a reversal row (never a delete); a transfer between
 *     two company accounts is one pair that money in and out leave alone; an
 *     account shows a book balance only from an opening balance a person
 *     entered.
 *
 * ONE AUTHORITATIVE RECORD. Nothing here keeps a second copy of an invoice,
 * claim, expense or payroll figure: the Finance view is computed from them on
 * every read. The only things stored here are the cash book's own rows and,
 * in cashbook_marks, what a person decided about an item (its bank, or that
 * an exception was reviewed).
 *
 * Who: reading is cashflow_manage (CEO, COO, admin, super admin - unchanged).
 * Corrections (reverse, assign a bank, mark reviewed, opening balance, edit
 * an account) are cashbook_correct: CEO, COO and super admin.
 */

import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { audit, cents, err, glCodeFor, json, logError, postJournal, str } from "./shared";
import { can } from "./permissions";

/* ------------------------------------------------------------------ *
 * Booking and reversing - used by every module that moves money.
 * ------------------------------------------------------------------ */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** True when the 0147 columns are there. A worker deployed before its
    migration must keep booking the v1.19.0 way, not fail. */
const noColumn = (e: unknown) => /no such column|has no column/i.test(String(e));

/**
 * Book one movement of money, once. `ref` names the event (INV-12, CLM-4,
 * EXP-9, PAYROLL-2026-10). A ref that already has a LIVE row (one that has
 * not been reversed) books nothing; after a reversal the same event can book
 * again, under the key `ref#n`, so paying an expense, undoing it and paying
 * it again leaves one live row and a visible trail.
 *
 * The check and the write are ONE statement, and the key is unique (0147),
 * so two simultaneous requests cannot both book. Returns true when a row was
 * written. Never throws: a payment that was recorded must not fail because
 * its cash row could not be.
 */
/** v1.312.0 (Finance 5.0, CEO-2) - which company a booking belongs to, and
    the account it went through when the source knows it. "a2z" = A2Z
    CREATIVE MARKETING, "azoo" = AZ ONE OFFICIAL (the issuer codes Sales uses). */
export type CompanyCode = "a2z" | "azoo";
export const COMPANIES: readonly CompanyCode[] = ["a2z", "azoo"];
export const companyOf = (v: unknown): CompanyCode | null => (v === "a2z" || v === "azoo" ? v : null);
/** an invoice's issuer as a company: a2z, or AZ ONE for azoo and legacy NULL */
export const issuerCompany = (issuer: string | null | undefined): CompanyCode => (issuer === "a2z" ? "a2z" : "azoo");

export async function bookCash(
  env: Env, userId: number, ref: string, amountCents: number, category: string, description: string,
  direction: "in" | "out" = "out", effectiveDate: string | null = null,
  opts: { company?: CompanyCode | null; bankId?: number | null } = {},
): Promise<boolean> {
  if (amountCents <= 0) return false;
  const eff = effectiveDate && ISO_DAY.test(effectiveDate) ? effectiveDate : null;
  const desc = description.slice(0, 200);
  let company = companyOf(opts.company);
  let bankId = Number.isInteger(opts.bankId) && Number(opts.bankId) > 0 ? Number(opts.bankId) : null;
  /* v1.312.0 (CEO-2) - the source names the company when the caller did not:
     an invoice or credit note by its issuer, an expense by its own company
     (and account), an agent payout by the issuer of the deals it pays (when
     they are all one company). Claims and payroll name none yet: they take
     the company of the account they are assigned to. */
  if (!company) {
    try {
      const n = Number(/^[A-Z]+-(\d+)$/.exec(ref)?.[1] ?? 0);
      if (n && ref.startsWith("INV-")) {
        const d = await env.DB.prepare(`SELECT issuer_code FROM sales_documents WHERE id = ?1`).bind(n).first<{ issuer_code: string | null }>();
        if (d) company = issuerCompany(d.issuer_code);
      } else if (n && ref.startsWith("CN-")) {
        const d = await env.DB.prepare(`SELECT d.issuer_code FROM credit_notes c JOIN sales_documents d ON d.id = c.invoice_id WHERE c.id = ?1`).bind(n).first<{ issuer_code: string | null }>();
        if (d) company = issuerCompany(d.issuer_code);
      } else if (n && ref.startsWith("EXP-")) {
        const e = await env.DB.prepare(`SELECT company, bank_id FROM expenses WHERE id = ?1`).bind(n).first<{ company: string | null; bank_id: number | null }>();
        company = companyOf(e?.company);
        if (!bankId && e?.bank_id) bankId = Number(e.bank_id);
      } else if (n && ref.startsWith("AGT-")) {
        const { results } = await env.DB.prepare(`SELECT DISTINCT d.issuer_code AS c FROM commission_ledger l JOIN sales_documents d ON d.id = l.invoice_id WHERE l.payout_id = ?1`).bind(n).all<{ c: string | null }>();
        const cos = [...new Set((results ?? []).map((r) => issuerCompany(r.c)))];
        if (cos.length === 1) company = cos[0]!;
      }
    } catch { /* a source table or column this database does not have */ }
  }
  try {
    let key = ref;
    let written = 0;
    try {
      const prior = await env.DB.prepare(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = ?1`)
        .bind(ref).first<{ n: number }>();
      key = (prior?.n ?? 0) === 0 ? ref : `${ref}#${(prior?.n ?? 0) + 1}`;
      const ONCE = `WHERE NOT EXISTS (SELECT 1 FROM cashflow_entries c WHERE c.ref = ?4
                              AND NOT EXISTS (SELECT 1 FROM cashflow_entries r WHERE r.reversal_of = c.id))`;
      let r;
      try {
        /* v1.312.0 - the company (0197) and the account, in the same one statement */
        r = await env.DB.prepare(
          `INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key, company, bank_id)
           SELECT date('now', '+8 hours'), ?6, ?1, ?2, ?3, ?4, ?5, COALESCE(?7, date('now', '+8 hours')), ?8, ?9, ?10
            ${ONCE}`,
        ).bind(category, amountCents, desc, ref, userId, direction, eff, key, company, bankId).run();
      } catch (e2) {
        if (!noColumn(e2)) throw e2;
        r = await env.DB.prepare( // pre-0197
          `INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key)
           SELECT date('now', '+8 hours'), ?6, ?1, ?2, ?3, ?4, ?5, COALESCE(?7, date('now', '+8 hours')), ?8
            ${ONCE}`,
        ).bind(category, amountCents, desc, ref, userId, direction, eff, key).run();
      }
      written = r.meta?.changes ?? 0;
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return false; // a twin request took the key first
      if (!noColumn(e)) throw e;
      /* before 0147: the v1.19.0 rule (one row per ref), in one statement */
      const r = await env.DB.prepare(
        `INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by)
         SELECT date('now', '+8 hours'), ?6, ?1, ?2, ?3, ?4, ?5
          WHERE NOT EXISTS (SELECT 1 FROM cashflow_entries WHERE ref = ?4)`,
      ).bind(category, amountCents, desc, ref, userId, direction).run();
      written = r.meta?.changes ?? 0;
      key = ref;
    }
    if (!written) return false;
    /* v1.20.0 C5: the movement drafts its journal entry under the same key.
       v1.222.0 (Accounting 2.0): dated the day the money moved, and a paid
       SERVICE invoice books to 4100 Sales - services, not 4000 products
       (the owner: "Service invoices -> 4100"; forward only - the cash book
       keeps its category). */
    let glCategory = category;
    const inv = /^INV-(\d+)$/.exec(ref);
    if (inv && direction === "in") {
      try {
        const doc = await env.DB.prepare(`SELECT kind FROM sales_documents WHERE id = ?1`).bind(Number(inv[1])).first<{ kind: string | null }>();
        if (doc?.kind === "service") glCategory = "service";
      } catch { /* pre-0061: no kind - products, as before */ }
    }
    await postJournal(env, userId, key, desc, glCategory, amountCents, direction, eff ?? null);
    return true;
  } catch {
    return false; // pre-0071: Finance is not in use on this database
  }
}

interface CashRow {
  id: number; type: "in" | "out"; category: string; amount_cents: number; description: string;
  ref: string; source_key: string | null; reversal_of: number | null; transfer_id: string | null;
}

/** The journal entry a row was posted under: its key, its ref, or CF-<id>
    for a typed movement (erp.ts). */
const journalRefOf = (r: CashRow) => r.source_key ?? (r.ref || `CF-${r.id}`);

/** Post the mirror of an existing journal entry (debits and credits swapped)
    under a new ref, once. Nothing is posted when the original was never
    posted - the books then had nothing to undo. */
async function mirrorJournal(env: Env, userId: number, fromRef: string, newRef: string, memo: string): Promise<void> {
  try {
    const dup = await env.DB.prepare(`SELECT id FROM journal_entries WHERE ref = ?1 LIMIT 1`).bind(newRef).first();
    if (dup) return;
    const orig = await env.DB.prepare(`SELECT id FROM journal_entries WHERE ref = ?1 ORDER BY id LIMIT 1`).bind(fromRef).first<{ id: number }>();
    if (!orig) return;
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM journal_lines WHERE entry_id = ?1`).bind(orig.id).first<{ n: number }>();
    if (!n?.n) return;
    /* v1.222.0 - the mirror and its lines are one batch: all or nothing */
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO journal_entries (entry_date, memo, ref, created_by) VALUES (date('now', '+8 hours'), ?1, ?2, ?3)`,
      ).bind(memo.slice(0, 200), newRef, userId),
      env.DB.prepare(
        `INSERT INTO journal_lines (entry_id, account_id, debit_cents, credit_cents)
         SELECT (SELECT MAX(id) FROM journal_entries WHERE ref = ?1), l.account_id, l.credit_cents, l.debit_cents
           FROM journal_lines l WHERE l.entry_id = ?2 ORDER BY l.id`,
      ).bind(newRef, orig.id),
    ]);
  } catch { /* pre-0071: no books to mirror */ }
}

/**
 * Reverse one cash-book row: a new row the other way, pointing at it, with
 * the reason. The original is never edited or deleted. A row can be reversed
 * once (the unique index on reversal_of); a reversal cannot itself be
 * reversed. A transfer is reversed as the pair it is.
 */
export async function reverseCashRow(
  env: Env, userId: number, rowId: number, reason: string,
): Promise<{ ok: true; ids: number[] } | { ok: false; code: "not_found" | "is_reversal" | "already_reversed" | "pending_migration" }> {
  let row: CashRow | null;
  try {
    row = await env.DB.prepare(
      `SELECT id, type, category, amount_cents, description, ref, source_key, reversal_of, transfer_id FROM cashflow_entries WHERE id = ?1`,
    ).bind(rowId).first<CashRow>();
  } catch (e) {
    if (noColumn(e)) return { ok: false, code: "pending_migration" };
    throw e;
  }
  if (!row) return { ok: false, code: "not_found" };
  if (row.reversal_of) return { ok: false, code: "is_reversal" };
  const rows: CashRow[] = row.transfer_id
    ? ((await env.DB.prepare(
        `SELECT id, type, category, amount_cents, description, ref, source_key, reversal_of, transfer_id FROM cashflow_entries WHERE transfer_id = ?1 AND reversal_of IS NULL`,
      ).bind(row.transfer_id).all<CashRow>()).results ?? [])
    : [row];
  const ids: number[] = [];
  for (const r of rows) {
    const key = `REV-${r.id}`;
    let res;
    try {
      res = await env.DB.prepare(
        `INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key, reversal_of, reverse_reason, transfer_id)
         SELECT date('now', '+8 hours'), ?1, ?2, ?3, ?4, ?5, ?6, date('now', '+8 hours'), ?5, ?7, ?8, ?9
          WHERE NOT EXISTS (SELECT 1 FROM cashflow_entries WHERE reversal_of = ?7)
         RETURNING id`,
      ).bind(r.type === "in" ? "out" : "in", r.category, r.amount_cents, `Reversal - ${r.description || r.ref || `entry ${r.id}`}`.slice(0, 200),
        key, userId, r.id, reason.slice(0, 300), r.transfer_id).first<{ id: number }>();
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) continue;
      throw e;
    }
    if (!res?.id) continue;
    ids.push(res.id);
    if (!r.transfer_id) await mirrorJournal(env, userId, journalRefOf(r), key, `Reversal of ${r.ref || `CF-${r.id}`}: ${reason}`);
  }
  if (ids.length === 0) return { ok: false, code: "already_reversed" };
  return { ok: true, ids };
}

/** Reverse whatever is still live for an event whose payment was undone or
    whose record was deleted (an expense marked unpaid, an invoice set back to
    unpaid). Silent on a database without 0147 - the undo itself must work. */
export async function reverseLive(env: Env, userId: number, ref: string, reason: string): Promise<number> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT c.id FROM cashflow_entries c
        WHERE c.ref = ?1 AND c.reversal_of IS NULL
          AND NOT EXISTS (SELECT 1 FROM cashflow_entries r WHERE r.reversal_of = c.id)`,
    ).bind(ref).all<{ id: number }>();
    let n = 0;
    for (const r of results ?? []) {
      const out = await reverseCashRow(env, userId, r.id, reason);
      if (out.ok) n += out.ids.length;
    }
    if (n) await audit(env, userId, "cashbook.auto_reverse", "cashflow_entries", ref, { reason, rows: n });
    return n;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * The Finance view: every movement, on the day it moved.
 * ------------------------------------------------------------------ */

type Source = "sales" | "part" | "elfia" | "live" | "claims" | "advance" | "payroll" | "expenses" | "commission" | "manual" | "transfer" | "reversal";
type Status = "verified" | "unverified" | "recorded" | "manual" | "transfer" | "reversed" | "reversal";

export interface CashItem {
  key: string;
  row_id: number | null;
  date: string;
  booked_on: string | null;
  type: "in" | "out";
  amount_cents: number;
  category: string;
  group: string;
  source: Source;
  status: Status;
  description: string;
  ref: string;
  link: { kind: "invoice" | "claim" | "payroll" | "expense" | "elfia"; id: number | string } | null;
  bank_id: number | null;
  bank_name: string | null;
  /** what money in / out it moves: null for a transfer or a reversal of an
      invoice row (neither is income or spending) */
  counts: "in" | "out" | null;
  sign: 1 | -1;
  reversal_of: number | null;
  reversed_by: number | null;
  reverse_reason: string | null;
  transfer_id: string | null;
  payment_ref: string | null;
  /** v1.220.2 - an invoice receipt's issuing company ("a2z", "azoo", or null = legacy AZ ONE) */
  issuer?: string | null;
  /** v1.312.0 (CEO-2) - the company it belongs to: its account's company,
      else the row's own, else (a receipt) the invoice issuer; null = not yet
      assigned (it then shows only under "Both companies") */
  company: CompanyCode | null;
  /** v1.312.0 (CEO-1) - a receipt recorded but not yet verified by the CEO:
      shown, and summed as "awaiting verification", never as Money In */
  awaiting: boolean;
}

const sourceOfRef = (ref: string): Source =>
  ref.startsWith("INV-") ? "sales"
  : ref.startsWith("CN-") ? "sales" // v1.225.0 - a refund paid back on a credit note
  : ref.startsWith("ELF-") ? "elfia"
  : ref.startsWith("RECON-") ? "live"
  : ref.startsWith("CLM-") ? "claims"
  : ref.startsWith("PAYROLL-") ? "payroll"
  : ref.startsWith("EXP-") ? "expenses"
  : ref.startsWith("REV-") ? "reversal"
  : ref.startsWith("TRF-") ? "transfer"
  : ref.startsWith("AGT-") ? "commission" // v1.312.0 (F-5) - an agent payout settled by Finance, not a typed row
  : "manual";

/** The category group the charts and reports use: the module for what a
    module books, the chart of accounts (glCodeFor - the same map the journal
    posts with) for expenses, and the typed category for a typed movement. */
function groupOf(source: Source, category: string, type: "in" | "out"): string {
  switch (source) {
    case "sales": case "part": return "sales";
    case "elfia": return "elfia";
    case "live": return "live";
    case "payroll": return "payroll";
    case "advance": return "advances";
    case "claims": return "claims";
    case "commission": return "agent_commission";
    case "expenses": return `gl${glCodeFor(category, "out")}`;
    default: {
      const c = category.trim();
      return c ? `manual:${c.slice(0, 40)}` : type === "in" ? "other_in" : "other_out";
    }
  }
}

/* v1.220.1 - the read is built from what THIS database has: a source table
   (or column) that is missing contributes NULLs instead of failing the whole
   tab. The live Finance tab answered "could not be read" on 28-10-2026; the
   cause was not visible from the screen, so the read no longer depends on
   every source being there, and a failure now says what it was. */
interface Has { v2: boolean; claims: boolean; expenses: boolean; payroll: boolean; web: boolean; customers: boolean; parts: boolean; confirm: boolean; reports: boolean; issuer: boolean; company: boolean }
const RAW_ROW_SQL = (h: Has) => `
  SELECT c.id, c.entry_date, c.type, c.category, c.bank_id, c.amount_cents, c.description, c.ref,
         ${h.v2 ? "c.effective_date, c.source_key, c.reversal_of, c.reverse_reason, c.transfer_id" : "NULL AS effective_date, NULL AS source_key, NULL AS reversal_of, NULL AS reverse_reason, NULL AS transfer_id"},
         ${h.company ? "c.company" : "NULL AS company"},
         b.name AS bank_name,
         ${h.claims ? "cl.id AS clm_id, date(cl.paid_at, '+8 hours') AS clm_paid, cl.amount_cents AS clm_amount, cl.claim_type AS clm_type, cl.payment_proof_key AS clm_proof" : "NULL AS clm_id, NULL AS clm_paid, NULL AS clm_amount, NULL AS clm_type, NULL AS clm_proof"},
         ${h.expenses ? "ex.id AS exp_id, date(ex.paid_at, '+8 hours') AS exp_paid, ex.amount_cents AS exp_amount" : "NULL AS exp_id, NULL AS exp_paid, NULL AS exp_amount"},
         ${h.payroll ? "date(pp.paid_at, '+8 hours') AS pay_paid, pp.month AS pay_month" : "NULL AS pay_paid, NULL AS pay_month"},
         d.id AS inv_id, d.payment_status AS inv_status, d.doc_number AS inv_number, d.total_cents AS inv_total,
         ${h.web ? "w.id AS web_id, w.refund_flagged_at AS web_refund" : "NULL AS web_id, NULL AS web_refund"}
    FROM cashflow_entries c
    LEFT JOIN bank_accounts b ON b.id = c.bank_id
    ${h.claims ? "LEFT JOIN claims cl ON c.ref LIKE 'CLM-%' AND cl.id = CAST(substr(c.ref, 5) AS INTEGER)" : ""}
    ${h.expenses ? "LEFT JOIN expenses ex ON c.ref LIKE 'EXP-%' AND ex.id = CAST(substr(c.ref, 5) AS INTEGER)" : ""}
    ${h.payroll ? "LEFT JOIN payroll_payments pp ON c.ref LIKE 'PAYROLL-%' AND pp.month = substr(c.ref, 9)" : ""}
    LEFT JOIN sales_documents d ON c.ref LIKE 'INV-%' AND d.id = CAST(substr(c.ref, 5) AS INTEGER) AND d.doc_type = 'INV'
    ${h.web ? "LEFT JOIN web_orders w ON c.ref LIKE 'ELF-%' AND w.store = 'elfia' AND w.order_number = substr(c.ref, 5)" : ""}`;

interface RawRow {
  id: number; entry_date: string; type: "in" | "out"; category: string; bank_id: number | null; amount_cents: number;
  description: string; ref: string; effective_date: string | null; source_key: string | null; reversal_of: number | null;
  reverse_reason: string | null; transfer_id: string | null; bank_name: string | null; company: string | null;
  clm_id: number | null; clm_paid: string | null; clm_amount: number | null; clm_type: string | null; clm_proof: string | null;
  exp_id: number | null; exp_paid: string | null; exp_amount: number | null;
  pay_paid: string | null; pay_month: string | null;
  inv_id: number | null; inv_status: string | null; inv_number: string | null; inv_total: number | null;
  web_id: number | null; web_refund: string | null;
}

interface Bank { id: number; name: string; bank: string; number_masked: string; active: number; opening_balance_cents: number | null; opening_on: string | null; company: string | null }
interface Mark { item_key: string; bank_id: number | null; bank_note: string | null; reviewed_note: string | null; reviewed_at: string | null; reviewed_by: number | null; accepted_note: string | null; accepted_at: string | null; accepted_by: number | null }

/** A first-pass read of everything the view is computed from. Sources that a
    database does not have yet contribute nothing (the tab still opens). */
async function loadAll(env: Env) {
  const probe = async (sql: string) => { try { await env.DB.prepare(sql).first(); return true; } catch { return false; } };
  const h: Has = {
    v2: (await probe(`SELECT effective_date, source_key, reversal_of, reverse_reason, transfer_id FROM cashflow_entries LIMIT 1`))
      && (await probe(`SELECT opening_balance_cents, opening_on FROM bank_accounts LIMIT 1`))
      && (await probe(`SELECT item_key, bank_id, reviewed_at FROM cashbook_marks LIMIT 1`)),
    claims: await probe(`SELECT id, paid_at, amount_cents, claim_type, payment_proof_key FROM claims LIMIT 1`),
    expenses: await probe(`SELECT id, paid_at, amount_cents FROM expenses LIMIT 1`),
    payroll: await probe(`SELECT month, paid_at FROM payroll_payments LIMIT 1`),
    web: await probe(`SELECT id, store, order_number, refund_flagged_at FROM web_orders LIMIT 1`),
    customers: await probe(`SELECT id, company FROM customers LIMIT 1`),
    parts: await probe(`SELECT id, invoice_id, amount_cents, received_on, method, reference, voided_at FROM invoice_payments LIMIT 1`),
    confirm: await probe(`SELECT invoice_id, revoked_at FROM invoice_paid_confirmations LIMIT 1`),
    reports: await probe(`SELECT payment_id, state FROM invoice_payment_reports LIMIT 1`),
    issuer: await probe(`SELECT issuer_code FROM sales_documents LIMIT 1`),
    company: await probe(`SELECT company FROM cashflow_entries LIMIT 1`) && await probe(`SELECT company FROM bank_accounts LIMIT 1`) && await probe(`SELECT accepted_at FROM cashbook_marks LIMIT 1`), // v1.312.0 - 0197
  };
  const v2 = h.v2;
  /* text columns are NOT NULL in the schema; a row written some other way
     must not take the whole tab down, so they are made strings here */
  const rows = ((await env.DB.prepare(RAW_ROW_SQL(h)).all<RawRow>()).results ?? [])
    .map((r) => ({ ...r, ref: r.ref ?? "", description: r.description ?? "", category: r.category ?? "", entry_date: String(r.entry_date ?? "").slice(0, 10) }));
  const CO = h.company ? "company" : "NULL AS company";
  const banks = v2
    ? ((await env.DB.prepare(`SELECT id, name, bank, number_masked, active, opening_balance_cents, opening_on, ${CO} FROM bank_accounts ORDER BY active DESC, name`).all<Bank>()).results ?? [])
    : ((await env.DB.prepare(`SELECT id, name, bank, number_masked, active, NULL AS opening_balance_cents, NULL AS opening_on, NULL AS company FROM bank_accounts ORDER BY active DESC, name`).all<Bank>()).results ?? []);
  let marks: Mark[] = [];
  if (v2) marks = (await env.DB.prepare(`SELECT item_key, bank_id, bank_note, reviewed_note, reviewed_at, reviewed_by, ${h.company ? "accepted_note, accepted_at, accepted_by" : "NULL AS accepted_note, NULL AS accepted_at, NULL AS accepted_by"} FROM cashbook_marks`).all<Mark>()).results ?? [];
  const hasParts = h.parts;
  const hasConfirm = h.confirm;
  const CUST = h.customers ? "cu.company" : "NULL AS company";
  const CUST_JOIN = h.customers ? "LEFT JOIN customers cu ON cu.id = d.customer_id" : "";
  /* v1.220.2 - which company issued the invoice: its letterhead prints the
     account the customer was told to pay into (lib/issuers.ts), which the
     screen offers as the suggested account - a suggestion, never assigned */
  const ISSUER = h.issuer ? "d.issuer_code" : "NULL AS issuer_code";
  const CONFIRMED = (alias: string) => hasConfirm
    ? `EXISTS (SELECT 1 FROM invoice_paid_confirmations k WHERE k.invoice_id = ${alias}.id AND k.revoked_at IS NULL)` : "0";
  const PARTS = (alias: string) => hasParts
    ? `COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = ${alias}.id AND p.voided_at IS NULL), 0)` : "0";
  /* the /docs/summary rule: a paid invoice's money is the part not already
     received in parts, on date(COALESCE(paid_at, created_at), +8 hours) */
  const invoices = (await env.DB.prepare(
    `SELECT d.id, d.doc_number, d.total_cents, ${PARTS("d")} AS parts_cents, d.payment_ref, d.payment_method,
            COALESCE(date(d.paid_at, '+8 hours'), date(d.created_at, '+8 hours'), substr(COALESCE(d.paid_at, d.created_at), 1, 10)) AS paid_day, ${CUST},
            ${CONFIRMED("d")} AS confirmed, ${ISSUER}
       FROM sales_documents d ${CUST_JOIN}
      WHERE d.doc_type = 'INV' AND d.payment_status = 'paid'`,
  ).all<{ id: number; doc_number: string; total_cents: number; parts_cents: number; payment_ref: string | null; payment_method: string | null; paid_day: string; company: string | null; confirmed: number; issuer_code: string | null }>()).results ?? [];
  const parts = hasParts ? ((await env.DB.prepare(
    `SELECT p.id, p.invoice_id, p.amount_cents, p.received_on, p.method, p.reference, d.doc_number, d.payment_status, ${CUST},
            ${CONFIRMED("d")} AS confirmed, ${ISSUER},
            ${h.reports ? "EXISTS (SELECT 1 FROM invoice_payment_reports x WHERE x.payment_id = p.id AND x.state = 'verified')" : "0"} AS verified_report
       FROM invoice_payments p JOIN sales_documents d ON d.id = p.invoice_id AND d.doc_type = 'INV'
       ${CUST_JOIN}
      WHERE p.voided_at IS NULL`,
  ).all<{ id: number; invoice_id: number; amount_cents: number; received_on: string; method: string | null; reference: string | null; doc_number: string; payment_status: string | null; company: string | null; confirmed: number; issuer_code: string | null; verified_report: number }>()).results ?? []) : [];
  return { v2, rows, banks, marks, invoices, parts, hasConfirm, has: h };
}

/** The day a row's money moved: the row's own date when it carries one;
    otherwise its source's paid day - but only when that day is not after the
    row was booked (a later paid day belongs to a later payment); otherwise
    the day it was booked. */
function dayOf(r: RawRow): string {
  const booked = String(r.entry_date ?? "").slice(0, 10);
  if (r.effective_date && ISO_DAY.test(r.effective_date)) return r.effective_date;
  const ref = r.ref ?? "";
  const src = ref.startsWith("CLM-") ? r.clm_paid : ref.startsWith("EXP-") ? r.exp_paid : ref.startsWith("PAYROLL-") ? r.pay_paid : null;
  return src && ISO_DAY.test(src) && src <= booked ? src : booked;
}

function buildItems(data: Awaited<ReturnType<typeof loadAll>>) {
  const bankName = new Map(data.banks.map((b) => [b.id, b.name]));
  const bankCo = new Map(data.banks.map((b) => [b.id, companyOf(b.company)]));
  const markOf = new Map(data.marks.map((m) => [m.item_key, m]));
  const byId = new Map(data.rows.map((r) => [r.id, r]));
  const reversedBy = new Map<number, number>();
  for (const r of data.rows) if (r.reversal_of) reversedBy.set(r.reversal_of, r.id);

  const items: CashItem[] = [];
  /* v1.312.0 - a reversal moves through the account its original did (its
     row or its mark), so a reversed movement leaves the book balance where
     it was before; it was counted against no account until now */
  const bankKeyOf = (r: RawRow): { key: string; bank: number | null } => {
    const o = r.reversal_of ? byId.get(r.reversal_of) : null;
    return o ? { key: `CF:${o.id}`, bank: o.bank_id } : { key: `CF:${r.id}`, bank: r.bank_id };
  };
  const withBank = (key: string, rowBank: number | null) => {
    const b = rowBank ?? markOf.get(key)?.bank_id ?? null;
    return { bank_id: b, bank_name: b ? bankName.get(b) ?? null : null };
  };
  /* the company: the account's, else the row's own (else, for a receipt, its invoice's issuer) */
  const coOf = (bank: number | null, own: string | null | undefined): CompanyCode | null => (bank ? bankCo.get(bank) ?? null : null) ?? companyOf(own);

  for (const r of data.rows) {
    const origin = r.reversal_of ? byId.get(r.reversal_of) ?? null : null;
    /* invoice rows: money in now comes from the invoices (below). The row and
       its reversal stay in the book and in Reconciliation, not in the view. */
    if (r.ref.startsWith("INV-") || (origin && origin.ref.startsWith("INV-"))) continue;
    let source = sourceOfRef(r.ref);
    if (source === "claims" && (r.category === "salary_advances" || r.clm_type === "salary_advance")) source = "advance";
    const originSource: Source = origin
      ? (sourceOfRef(origin.ref) === "claims" && origin.category === "salary_advances" ? "advance" : sourceOfRef(origin.ref))
      : source;
    const isTransfer = Boolean(r.transfer_id);
    const key = `CF:${r.id}`;
    const bk = bankKeyOf(r);
    const bankOf = withBank(bk.key, bk.bank);
    const status: Status = r.reversal_of ? "reversal" : reversedBy.has(r.id) ? "reversed" : isTransfer ? "transfer" : source === "manual" ? "manual" : "recorded";
    /* a transfer moves money between our own accounts: it is neither money
       in nor money out, and neither is its reversal */
    const counts = isTransfer ? null : origin ? origin.type : r.type;
    items.push({
      key, row_id: r.id, date: dayOf(r), booked_on: r.entry_date, type: r.type, amount_cents: r.amount_cents,
      category: r.category, group: groupOf(r.reversal_of ? originSource : source, origin?.category ?? r.category, origin?.type ?? r.type),
      source: isTransfer ? "transfer" : r.reversal_of ? "reversal" : source, status, description: r.description, ref: r.ref,
      link: r.ref.startsWith("CLM-") && r.clm_id ? { kind: "claim", id: r.clm_id }
        : r.ref.startsWith("EXP-") && r.exp_id ? { kind: "expense", id: r.exp_id }
        : r.ref.startsWith("PAYROLL-") ? { kind: "payroll", id: r.ref.slice(8) }
        : r.ref.startsWith("ELF-") ? { kind: "elfia", id: r.ref.slice(4) } : null,
      ...bankOf,
      counts, sign: r.reversal_of ? -1 : 1, reversal_of: r.reversal_of, reversed_by: reversedBy.get(r.id) ?? null,
      reverse_reason: r.reverse_reason, transfer_id: r.transfer_id, payment_ref: null,
      company: coOf(bankOf.bank_id, r.company ?? (origin ? origin.company : null)), awaiting: false,
    });
  }

  for (const inv of data.invoices) {
    const amount = (inv.total_cents ?? 0) - (inv.parts_cents ?? 0);
    if (amount <= 0 || !ISO_DAY.test(inv.paid_day ?? "")) continue;
    const key = `INV:${inv.id}`;
    const bInv = withBank(key, null);
    items.push({
      key, row_id: null, date: inv.paid_day, booked_on: null, type: "in", amount_cents: amount, category: "sales", group: "sales",
      source: "sales", status: inv.confirmed ? "verified" : "unverified",
      description: `${inv.doc_number}${inv.company ? ` - ${inv.company}` : ""}${inv.parts_cents > 0 ? " (balance)" : ""}`,
      ref: inv.doc_number, link: { kind: "invoice", id: inv.id }, ...bInv,
      /* v1.312.0 (CEO-1) - Money In is what the CEO verified; the rest waits, shown */
      counts: inv.confirmed ? "in" : null, sign: 1, reversal_of: null, reversed_by: null, reverse_reason: null, transfer_id: null, payment_ref: inv.payment_ref,
      issuer: inv.issuer_code ?? null, company: coOf(bInv.bank_id, issuerCompany(inv.issuer_code)), awaiting: !inv.confirmed,
    });
  }
  for (const p of data.parts) {
    if (!ISO_DAY.test(String(p.received_on ?? "").slice(0, 10))) continue;
    p.received_on = String(p.received_on).slice(0, 10);
    const key = `PART:${p.id}`;
    const bPart = withBank(key, null);
    /* verified: the CEO verified this payment (payment verification), or confirmed the invoice paid in full */
    const okPart = Boolean(p.verified_report) || (p.payment_status === "paid" && Boolean(p.confirmed));
    items.push({
      key, row_id: null, date: p.received_on, booked_on: null, type: "in", amount_cents: p.amount_cents, category: "sales", group: "sales",
      source: "part", status: okPart ? "verified" : "unverified",
      description: `${p.doc_number}${p.company ? ` - ${p.company}` : ""} (part payment)`,
      ref: p.doc_number, link: { kind: "invoice", id: p.invoice_id }, ...bPart,
      counts: okPart ? "in" : null, sign: 1, reversal_of: null, reversed_by: null, reverse_reason: null, transfer_id: null, payment_ref: p.reference,
      issuer: p.issuer_code ?? null, company: coOf(bPart.bank_id, issuerCompany(p.issuer_code)), awaiting: !okPart,
    });
  }
  items.sort((a, b) => (a.date === b.date ? (b.row_id ?? 0) - (a.row_id ?? 0) : a.date < b.date ? 1 : -1));
  return items;
}

/* ------------------------------------------------------------------ *
 * Reconciliation: what is out of step, from the records themselves.
 * ------------------------------------------------------------------ */

export interface Exception {
  kind: "unverified" | "no_bank" | "no_reference" | "out_of_step" | "duplicate" | "elfia_cancelled" | "not_booked";
  key: string;
  item_key: string;
  date: string;
  title: string;
  detail: string;
  amount_cents: number;
  type: "in" | "out";
  row_id: number | null;
  link: CashItem["link"];
  actions: ("bank" | "reverse" | "review" | "book" | "confirm" | "accept")[];
  /** v1.312.0 (F-2) - the source record's amount, the cash book's, and
      DIFFERENCE = SOURCE - CASH BOOK (negative: the cash book holds more).
      Set where the two records are compared; null for the other checks. */
  source_cents: number | null;
  booked_cents: number | null;
  difference_cents: number | null;
  /** "amount": both records exist and differ in amount (summed into the
      Total difference); "status": the source was deleted, unpaid or never
      booked (listed, its difference shown, never summed) */
  mismatch: "amount" | "status" | null;
  /** v1.312.0 (CEO-6) - REVIEWED IS NOT RESOLVED. A mismatch stays listed
      after review; it leaves only when the records agree again, or when the
      CEO accepts it with a reason. */
  state: "open" | "reviewed";
  reviewed: { note: string | null; at: string | null; by: number | null } | null;
  company: CompanyCode | null;
}

/** the kinds that compare two records: a review never hides them */
export const MISMATCH_KINDS: readonly Exception["kind"][] = ["out_of_step", "not_booked", "elfia_cancelled"];

async function exceptionsOf(env: Env, data: Awaited<ReturnType<typeof loadAll>>, items: CashItem[], from: string, to: string): Promise<Exception[]> {
  const markOf = new Map(data.marks.map((m) => [m.item_key, m]));
  const itemCo = new Map(items.map((i) => [i.key, i.company]));
  const out: Exception[] = [];
  type Draft = Omit<Exception, "state" | "reviewed" | "company" | "source_cents" | "booked_cents" | "difference_cents" | "mismatch">
    & Partial<Pick<Exception, "source_cents" | "booked_cents" | "difference_cents" | "mismatch">>;
  const add = (x: Draft) => {
    const m = markOf.get(`${x.kind}|${x.key}`);
    const isMismatch = MISMATCH_KINDS.includes(x.kind);
    if (m?.accepted_at) return; // accepted by the CEO, with a reason (resolved)
    if (!isMismatch && m?.reviewed_at) return; // the other checks: a review acknowledges them, as before
    out.push({
      source_cents: null, booked_cents: null, difference_cents: null, mismatch: null, ...x,
      actions: isMismatch ? [...new Set([...x.actions, "accept" as const])] : x.actions,
      state: m?.reviewed_at ? "reviewed" : "open",
      reviewed: m?.reviewed_at ? { note: m.reviewed_note, at: m.reviewed_at, by: m.reviewed_by } : null,
      company: itemCo.get(x.item_key) ?? null,
    });
  };
  /* the two records, compared: DIFFERENCE = SOURCE - CASH BOOK */
  const cmp = (source: number, booked: number, kind: "amount" | "status") => ({ source_cents: source, booked_cents: booked, difference_cents: source - booked, mismatch: kind });
  const inPeriod = (d: string) => d >= from && d <= to;
  /* v1.220.2 - "which account?" is only a question once there is an account
     to choose: with none set up, the tab asks for that first instead of
     listing every movement (the owner, 28-10-2026: "no account appear") */
  const anyAccount = data.banks.some((b) => b.active);
  const reversedIds = new Set(data.rows.filter((x) => x.reversal_of).map((x) => x.reversal_of as number));
  const live = (r: RawRow) => !r.reversal_of && !reversedIds.has(r.id);

  for (const it of items) {
    if (!inPeriod(it.date)) continue;
    if ((it.source === "sales" || it.source === "part") && it.status === "unverified") {
      add({ kind: "unverified", key: it.key, item_key: it.key, date: it.date, title: it.description, detail: "Recorded as received; awaiting the CEO's verification. It is not counted as Money In until verified.", amount_cents: it.amount_cents, type: "in", row_id: null, link: it.link, actions: ["confirm", "review"] });
    }
    if (anyAccount && (it.counts || it.awaiting) && !it.bank_id && it.status !== "reversal" && it.status !== "reversed") {
      add({ kind: "no_bank", key: it.key, item_key: it.key, date: it.date, title: it.description || it.category, detail: "Which account did this money move through?", amount_cents: it.amount_cents, type: it.type, row_id: it.row_id, link: it.link, actions: ["bank", "review"] });
    }
    if ((it.source === "sales" || it.source === "part") && !(it.payment_ref ?? "").trim()) {
      add({ kind: "no_reference", key: it.key, item_key: it.key, date: it.date, title: it.description, detail: "No payment reference was recorded.", amount_cents: it.amount_cents, type: "in", row_id: null, link: it.link, actions: ["review"] });
    }
  }

  for (const r of data.rows) {
    if (!live(r)) continue;
    const d = dayOf(r);
    const base = { item_key: `CF:${r.id}`, date: d, amount_cents: r.amount_cents, type: r.type, row_id: r.id, link: null } as const;
    if (r.ref.startsWith("EXP-") && data.has.expenses) {
      const link = r.exp_id ? { kind: "expense" as const, id: r.exp_id } : null;
      if (!r.exp_id) add({ ...base, link, kind: "out_of_step", key: `CF:${r.id}`, title: r.description || r.ref, detail: "The expense was deleted; its payment is still in the cash book.", actions: ["reverse", "review"], ...cmp(0, r.amount_cents, "status") });
      else if (!r.exp_paid) add({ ...base, link, kind: "out_of_step", key: `CF:${r.id}`, title: r.description || r.ref, detail: "The expense is no longer marked paid; its payment is still in the cash book.", actions: ["reverse", "review"], ...cmp(0, r.amount_cents, "status") });
      else if (r.exp_amount != null && r.exp_amount !== r.amount_cents) add({ ...base, link, kind: "out_of_step", key: `CF:${r.id}`, title: r.description || r.ref, detail: `The expense now says ${(r.exp_amount / 100).toFixed(2)}; the cash book paid ${(r.amount_cents / 100).toFixed(2)}.`, actions: ["reverse", "review"], ...cmp(r.exp_amount, r.amount_cents, "amount") });
    } else if (r.ref.startsWith("INV-")) {
      const link = r.inv_id ? { kind: "invoice" as const, id: r.inv_id } : null;
      if (!r.inv_id || r.inv_status !== "paid") add({ ...base, link, kind: "out_of_step", key: `CF:${r.id}`, title: r.inv_number ?? r.description ?? r.ref, detail: r.inv_id ? "The invoice is no longer marked paid. Finance does not count it; the cash book and the journal still hold it." : "The invoice was deleted. Finance does not count it; the cash book and the journal still hold it.", actions: ["reverse", "review"], ...cmp(0, r.amount_cents, "status") });
      /* v1.225.0 (Master Flow audit P0-1): a paid invoice whose total was
         edited after it was booked. Edits like that are refused from
         1.225.0; this lists the ones made before. */
      else if (r.inv_total != null && r.inv_total !== r.amount_cents) add({ ...base, link, kind: "out_of_step", key: `CF:${r.id}`, title: r.inv_number ?? r.description ?? r.ref, detail: `The invoice now totals ${(r.inv_total / 100).toFixed(2)}; the cash book and the journal received ${(r.amount_cents / 100).toFixed(2)}. Unmark and re-mark it paid to book the right amount, or review it.`, actions: ["reverse", "review"], ...cmp(r.inv_total, r.amount_cents, "amount") });
    } else if (r.ref.startsWith("CLM-") && data.has.claims && !r.clm_id) {
      add({ ...base, kind: "out_of_step", key: `CF:${r.id}`, title: r.description || r.ref, detail: "The claim this paid no longer exists.", actions: ["reverse", "review"], ...cmp(0, r.amount_cents, "status") });
    } else if (r.ref.startsWith("ELF-") && data.has.web && r.web_refund) {
      add({ ...base, kind: "elfia_cancelled", key: `CF:${r.id}`, title: r.description || r.ref, detail: "The ELFIA order was cancelled after it was paid. Decide the refund; reverse this when the money goes back.", actions: ["reverse", "review"], ...cmp(0, r.amount_cents, "status") });
    }
  }

  /* payroll: the run's saved net today against what was booked when it was paid.
     v1.312.0 (F-2) - the difference is net today minus booked (RM 13,156.66 -
     RM 13,161.66 = -RM 5.00), never the booked amount itself */
  const payRows = data.rows.filter((r) => r.ref.startsWith("PAYROLL-") && live(r));
  for (const r of payRows) {
    try {
      const net = await env.DB.prepare(`SELECT COALESCE(SUM(net_cents), 0) AS n FROM payroll_entries WHERE month = ?1`).bind(r.ref.slice(8)).first<{ n: number }>();
      if (net && net.n !== r.amount_cents) {
        add({ kind: "out_of_step", key: `CF:${r.id}`, item_key: `CF:${r.id}`, date: dayOf(r), title: r.description || r.ref, detail: `Payroll now totals ${(net.n / 100).toFixed(2)} net; the bank run booked ${(r.amount_cents / 100).toFixed(2)}.`, amount_cents: r.amount_cents, type: r.type, row_id: r.id, link: { kind: "payroll", id: r.ref.slice(8) }, actions: ["review", "reverse"], ...cmp(Number(net.n), r.amount_cents, "amount") });
      }
    } catch { /* pre-payroll */ }
  }

  /* a typed movement that matches something a module booked (v1.312.0 - a
     receipt still awaiting verification is matched too: typing it again
     would count it twice once it is verified) */
  const counted = items.filter((i) => (i.counts || i.awaiting) && i.status !== "reversed" && i.status !== "reversal");
  for (const m of counted) {
    if (m.source !== "manual" || !inPeriod(m.date)) continue;
    const twin = counted.find((o) => o.key !== m.key && o.date === m.date && o.type === m.type && o.amount_cents === m.amount_cents);
    if (twin) add({ kind: "duplicate", key: m.key, item_key: m.key, date: m.date, title: m.description || m.category || "Manual entry", detail: `Same day, direction and amount as: ${twin.description || twin.ref}.`, amount_cents: m.amount_cents, type: m.type, row_id: m.row_id, link: null, actions: ["reverse", "review"] });
  }

  /* paid in a module, but no live cash row (booked by "Book missing") */
  const liveRefs = new Set(data.rows.filter(live).map((r) => r.ref));
  const missing = async (sql: string, make: (r: Record<string, unknown>) => Draft) => {
    try { for (const r of (await env.DB.prepare(sql).all<Record<string, unknown>>()).results ?? []) { const x = make(r); if (!liveRefs.has(x.key)) add(x); } } catch { /* source table absent */ }
  };
  await missing(`SELECT id, amount_cents, date(paid_at, '+8 hours') AS d, COALESCE(vendor, description, category) AS t FROM expenses WHERE paid_at IS NOT NULL AND amount_cents > 0`,
    (r) => ({ kind: "not_booked", key: `EXP-${r.id}`, item_key: `EXP-${r.id}`, date: String(r.d), title: String(r.t ?? "Expense"), detail: "Marked paid, but not in the cash book.", amount_cents: Number(r.amount_cents), type: "out", row_id: null, link: { kind: "expense", id: Number(r.id) }, actions: ["book", "review"], ...cmp(Number(r.amount_cents), 0, "status") }));
  await missing(`SELECT id, amount_cents, date(paid_at, '+8 hours') AS d FROM claims WHERE paid_at IS NOT NULL AND amount_cents > 0`,
    (r) => ({ kind: "not_booked", key: `CLM-${r.id}`, item_key: `CLM-${r.id}`, date: String(r.d), title: `Claim ${r.id}`, detail: "Paid out, but not in the cash book.", amount_cents: Number(r.amount_cents), type: "out", row_id: null, link: { kind: "claim", id: Number(r.id) }, actions: ["book", "review"], ...cmp(Number(r.amount_cents), 0, "status") }));
  await missing(`SELECT pp.month, date(pp.paid_at, '+8 hours') AS d, (SELECT COALESCE(SUM(net_cents), 0) FROM payroll_entries e WHERE e.month = pp.month) AS n FROM payroll_payments pp`,
    (r) => ({ kind: "not_booked", key: `PAYROLL-${r.month}`, item_key: `PAYROLL-${r.month}`, date: String(r.d), title: `Payroll ${r.month}`, detail: "The bank run is marked done, but it is not in the cash book.", amount_cents: Number(r.n), type: "out", row_id: null, link: { kind: "payroll", id: String(r.month) }, actions: ["book", "review"], ...cmp(Number(r.n), 0, "status") }));

  return out.filter((x) => x.kind !== "not_booked" || x.amount_cents > 0);
}

/** v1.312.0 (F-2) - the Total difference: the sum of DIFFERENCE over the
    amount mismatches only (status mismatches and the other checks are
    counted, never summed) */
export const totalDifference = (xs: Exception[]): number =>
  xs.filter((x) => x.kind === "out_of_step" && x.mismatch === "amount").reduce((a, x) => a + Number(x.difference_cents ?? 0), 0);

/* ------------------------------------------------------------------ *
 * Routes, under /api/v1/staff/erp/cashbook (one door in staff.ts).
 * ------------------------------------------------------------------ */

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const monthStart = (d: string, back = 0) => {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 - back;
  const t = new Date(Date.UTC(y, m, 1));
  return t.toISOString().slice(0, 10);
};

/** "RM" typed as a number, possibly negative (an overdrawn account), in sen. */
const signedCents = (v: unknown): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 100_000_000) return null;
  return Math.round(v * 100);
};

const ITEM_KEY = /^(CF|PART|INV):\d+$/;

/** v1.312.0 - whether 0197 (the company columns) is applied on this database */
async function hasCompany(env: Env): Promise<boolean> {
  try { await env.DB.prepare(`SELECT company FROM bank_accounts LIMIT 1`).first(); return true; } catch { return false; }
}

/** v1.222.0 (Accounting 2.0) - Finance's own reconciliation list for a
    period, for the month-end checklist: the same items and the same rules
    as Finance > Reconciliation, never a second copy. null when the cash
    book cannot be read on this database. */
export async function cashExceptionsFor(env: Env, from: string, to: string): Promise<Exception[] | null> {
  try {
    const data = await loadAll(env);
    return await exceptionsOf(env, data, buildItems(data), from, to);
  } catch {
    return null;
  }
}

export async function handleCashbook(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams,
): Promise<Response | null> {
  const canRead = can(user.role, "cashflow_manage");
  const canFix = can(user.role, "cashbook_correct");

  /* ---- the view: one read for all five tabs ---- */
  if (path === "/cashbook" && method === "GET") {
    if (!canRead) return err("forbidden", "No access to cash flow", 403);
    const today = mytToday();
    const fromQ = params.get("from") ?? "", toQ = params.get("to") ?? "";
    const to = ISO_DAY.test(toQ) ? toQ : today;
    const from = ISO_DAY.test(fromQ) ? fromQ : monthStart(to);
    if (from > to) return err("validation", "The period starts after it ends", 400);
    /* v1.312.0 (CEO-2) - ONE COMPANY AT A TIME. "a2z" or "azoo" counts only
       that company's movements and accounts; "all" is the explicit
       consolidated view and says so in the answer. Nothing is combined
       unless it was asked for. */
    const coQ = params.get("company") ?? "all";
    if (coQ !== "all" && !companyOf(coQ)) return err("validation", "company is a2z, azoo or all", 400);
    const company = companyOf(coQ);
    const empty = { period: { from, to, today }, company: coQ, consolidated: !company, totals: { in_cents: 0, out_cents: 0, net_cents: 0, count: 0, awaiting_cents: 0, awaiting_count: 0, difference_cents: 0, no_company: 0 }, groups: { in: [], out: [] }, trend: [], items: [], banks: [], exceptions: [], can_correct: canFix, can_enter: canFix, can_accept: can(user.role, "cashbook_accept"), confirmations: false };
    try {
    let data;
    try { data = await loadAll(env); }
    catch (e) {
      /* no cash book table at all: an honest empty tab that says why */
      if (/no such table: cashflow_entries|no such table: bank_accounts/i.test(String(e))) return json({ ...empty, pending_migration: true });
      throw e;
    }
    const everything = buildItems(data);
    const mine = (i: CashItem) => !company || i.company === company;
    const all = everything.filter(mine);
    const items = all.filter((i) => i.date >= from && i.date <= to);
    const sum = (list: CashItem[], dir: "in" | "out") => list.filter((i) => i.counts === dir).reduce((a, i) => a + i.sign * i.amount_cents, 0);
    const groups = (dir: "in" | "out") => {
      const m = new Map<string, number>();
      for (const i of items) if (i.counts === dir) m.set(i.group, (m.get(i.group) ?? 0) + i.sign * i.amount_cents);
      return [...m.entries()].map(([group, cents]) => ({ group, cents })).filter((g) => g.cents !== 0).sort((a, b) => b.cents - a.cents);
    };
    /* six months ending with the period's last month (Malaysia time) */
    const months = parseInt(params.get("months") ?? "6", 10);
    const span = Number.isFinite(months) && months >= 3 && months <= 24 ? months : 6;
    const trend = Array.from({ length: span }, (_, k) => monthStart(to, span - 1 - k).slice(0, 7)).map((m) => {
      const list = all.filter((i) => i.date.slice(0, 7) === m);
      return { month: m, in_cents: sum(list, "in"), out_cents: sum(list, "out") };
    });
    /* a BOOK balance (not bank-verified): from an opening balance a person
       entered, plus every verified movement through the account since */
    const banks = data.banks.filter((b) => !company || companyOf(b.company) === company).map((b) => {
      const bal = b.opening_balance_cents != null && b.opening_on
        ? b.opening_balance_cents + everything.filter((i) => i.bank_id === b.id && !i.awaiting && i.date >= b.opening_on! && i.date <= today)
            .reduce((a, i) => a + (i.type === "in" ? i.amount_cents : -i.amount_cents), 0)
        : null;
      return { ...b, company: companyOf(b.company), book_balance_cents: bal };
    });
    const exceptions = (await exceptionsOf(env, data, everything, from, to)).filter((x) => !company || x.company === company);
    const moneyIn = sum(items, "in"), moneyOut = sum(items, "out");
    const waiting = items.filter((i) => i.awaiting);
    return json({
      period: { from, to, today }, company: coQ, consolidated: !company,
      totals: {
        in_cents: moneyIn, out_cents: moneyOut, net_cents: moneyIn - moneyOut, count: items.length,
        awaiting_cents: waiting.reduce((a, i) => a + i.amount_cents, 0), awaiting_count: waiting.length,
        difference_cents: totalDifference(exceptions),
        /* movements in the period that belong to no company yet (consolidated view only) */
        no_company: company ? 0 : items.filter((i) => !i.company && (i.counts || i.awaiting)).length,
      },
      groups: { in: groups("in"), out: groups("out") },
      trend,
      items,
      banks,
      exceptions,
      can_correct: canFix,
      can_enter: canFix,
      can_accept: can(user.role, "cashbook_accept"),
      /* v1.312.0 - what this person may do with an expense (the server checks again on each step) */
      expense_caps: { record: can(user.role, "expenses"), approve: can(user.role, "expense_approve"), authorise: can(user.role, "expense_authorise"), pay: can(user.role, "expense_pay") },
      me: { id: user.id, role: user.role },
      pending_migration: !data.v2,
      pending_company: !data.has.company,
      confirmations: data.hasConfirm,
    });
    } catch (e) {
      /* v1.220.1 - a failure says what it was (to the CEO/COO/admin who can
         read Finance) and lands in the error log, instead of a bare 500 */
      const msg = e instanceof Error ? e.message : String(e);
      await logError(env, "cashbook", `GET /erp/cashbook: ${msg}`);
      return err("cashbook_failed", `Finance could not be read: ${msg.slice(0, 240)}`, 500);
    }
  }

  /* ---- v1.312.0 - an item's history: who booked, verified, assigned,
     reviewed, accepted or reversed it, from the audit log ---- */
  if (path === "/cashbook/history" && method === "GET") {
    if (!canRead) return err("forbidden", "No access to cash flow", 403);
    const key = params.get("key") ?? "";
    const m = /^(?:([a-z_]+)\|)?(CF:\d+|INV:\d+|PART:\d+|(?:EXP|CLM|PAYROLL)-[\w-]+)$/.exec(key);
    if (!m) return err("validation", "Unknown item", 400);
    const item = m[2]!;
    const ids = new Set<string>([item, key]);
    for (const k of ["unverified", "no_bank", "no_reference", "out_of_step", "duplicate", "elfia_cancelled", "not_booked"]) ids.add(`${k}|${item}`);
    const cf = /^CF:(\d+)$/.exec(item);
    if (cf) {
      ids.add(cf[1]!);
      const rev = await env.DB.prepare(`SELECT id FROM cashflow_entries WHERE reversal_of = ?1`).bind(Number(cf[1])).first<{ id: number }>().catch(() => null);
      if (rev) ids.add(String(rev.id));
    }
    const list = [...ids];
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.action, a.entity_id, a.detail, a.created_at, COALESCE(u.full_name, u.name) AS who, u.role AS who_role
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE (a.action LIKE 'cashbook.%' OR a.action = 'erp.cashflow_create' OR a.action = 'erp.cashflow_manual')
          AND a.entity_id IN (${list.map((_, i) => `?${i + 1}`).join(", ")})
        ORDER BY a.id DESC LIMIT 50`,
    ).bind(...list).all();
    return json({ key, events: results ?? [] });
  }

  /* ---- v1.312.0 (CEO-6) - a mismatch the CEO accepts as it is: the only
     way one leaves the list while the records still differ ---- */
  if (path === "/cashbook/accept" && method === "POST") {
    if (!can(user.role, "cashbook_accept")) return err("forbidden", "Only the CEO accepts a difference that remains", 403);
    const key = typeof body?.key === "string" && /^(out_of_step|not_booked|elfia_cancelled)\|[A-Z]+[:-][\w:#-]+$/.test(body.key) && body.key.length <= 80 ? body.key : null;
    if (!key) return err("validation", "Only a mismatch is accepted", 400);
    const reason = str(body?.reason, 300) ? (body!.reason as string).trim() : "";
    if (reason.length < 10) return err("validation", "Give the reason (at least 10 characters)", 400);
    try {
      const r = await env.DB.prepare(
        `INSERT INTO cashbook_marks (item_key, accepted_note, accepted_by, accepted_at) VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(item_key) DO UPDATE SET accepted_note = excluded.accepted_note, accepted_by = excluded.accepted_by, accepted_at = excluded.accepted_at
          WHERE cashbook_marks.accepted_at IS NULL`,
      ).bind(key, reason, user.id).run();
      if (!(r.meta?.changes ?? 0)) return err("conflict", "This difference was already accepted", 409);
    } catch (e) {
      if (noColumn(e) || /no such table/i.test(String(e))) return err("pending_migration", "Run PUSH.bat so migration 0197 applies, then retry", 409);
      throw e;
    }
    await audit(env, user.id, "cashbook.accept", "cashbook_marks", key, { reason });
    return json({ ok: true });
  }

  /* ---- v1.312.0 - DUE PAYMENTS: commitments, never cash. Expenses
     approved or authorised and not yet paid, recurring expenses not yet
     recorded for this month, approved claims not yet paid, and payroll
     released but not yet paid - each read from its own module ---- */
  if (path === "/cashbook/due" && method === "GET") {
    if (!canRead) return err("forbidden", "No access to cash flow", 403);
    const coQ = params.get("company") ?? "all";
    const company = companyOf(coQ);
    if (coQ !== "all" && !company) return err("validation", "company is a2z, azoo or all", 400);
    const today = mytToday();
    const month = today.slice(0, 7);
    const due: { key: string; kind: "expense" | "recurring" | "claims" | "payroll"; title: string; sub: string; due_on: string | null; amount_cents: number; stage: string; company: CompanyCode | null; id: number | string | null }[] = [];
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, expense_date, category, amount_cents, vendor, description, status, due_on, company, created_by FROM expenses
          WHERE paid_at IS NULL AND COALESCE(status, 'recorded') IN ('recorded', 'approved', 'authorised') ORDER BY COALESCE(due_on, expense_date), id LIMIT 200`,
      ).all<{ id: number; expense_date: string; category: string; amount_cents: number; vendor: string | null; description: string | null; status: string | null; due_on: string | null; company: string | null }>();
      for (const e of results ?? []) {
        const co = companyOf(e.company);
        if (company && co !== company) continue;
        due.push({ key: `EXP-${e.id}`, kind: "expense", title: e.vendor || e.description || e.category, sub: e.description && e.vendor ? e.description : e.category, due_on: e.due_on ?? null, amount_cents: e.amount_cents, stage: e.status ?? "recorded", company: co, id: e.id });
      }
      /* recurring: the latest of each kind from an earlier month, not yet recorded this month */
      const rec = (await env.DB.prepare(
        `SELECT e.* FROM expenses e WHERE e.recurring = 1 AND e.expense_date < ?1 AND COALESCE(e.status, '') != 'cancelled'
           AND NOT EXISTS (SELECT 1 FROM expenses n WHERE n.category = e.category AND COALESCE(n.vendor, '') = COALESCE(e.vendor, '') AND COALESCE(n.description, '') = COALESCE(e.description, '') AND n.expense_date >= ?1)
         ORDER BY e.expense_date DESC, e.id DESC LIMIT 100`,
      ).bind(`${month}-01`).all<{ id: number; category: string; amount_cents: number; vendor: string | null; description: string | null; due_day: number | null; company: string | null }>()).results ?? [];
      const seen = new Set<string>();
      for (const r of rec) {
        const k = `${r.category}|${r.vendor ?? ""}|${r.description ?? ""}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const co = companyOf(r.company);
        if (company && co !== company) continue;
        const dd = r.due_day ? `${month}-${String(Math.min(28, r.due_day)).padStart(2, "0")}` : null;
        due.push({ key: `REC-${r.id}`, kind: "recurring", title: r.vendor || r.description || r.category, sub: "Recurring - to record for this month", due_on: dd, amount_cents: r.amount_cents, stage: "to_record", company: co, id: r.id });
      }
    } catch { /* expenses table variant */ }
    if (!company) {
      /* claims and payroll carry no company yet: they show in the consolidated view */
      try {
        const c = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, MIN(date(decided_at, '+8 hours')) AS d FROM claims WHERE status = 'approved' AND paid_at IS NULL`).first<{ n: number; cents: number; d: string | null }>();
        if (c && c.n > 0) due.push({ key: "CLAIMS", kind: "claims", title: `Staff claims (${c.n})`, sub: "Approved, not yet paid - paid in Claims", due_on: null, amount_cents: Number(c.cents), stage: "approved", company: null, id: null });
      } catch { /* pre-claims */ }
      try {
        const p = await env.DB.prepare(
          `SELECT r.month, (SELECT COALESCE(SUM(net_cents), 0) FROM payroll_entries e WHERE e.month = r.month) AS cents FROM payslip_releases r
            WHERE NOT EXISTS (SELECT 1 FROM payroll_payments pp WHERE pp.month = r.month) ORDER BY r.month DESC LIMIT 3`,
        ).all<{ month: string; cents: number }>();
        for (const r of p.results ?? []) if (Number(r.cents) > 0) due.push({ key: `PAYROLL-${r.month}`, kind: "payroll", title: `Payroll ${r.month}`, sub: "Released, bank run not yet recorded - paid in Payroll", due_on: null, amount_cents: Number(r.cents), stage: "released", company: null, id: r.month });
      } catch { /* pre-payroll */ }
    }
    return json({ company: coQ, today, due, total_cents: due.reduce((a, d) => a + d.amount_cents, 0) });
  }

  /* ---- reverse one row (and its transfer twin) ---- */
  const mRev = path.match(/^\/cashbook\/rows\/(\d+)\/reverse$/);
  if (mRev && method === "POST") {
    if (!canFix) return err("forbidden", "Only the CEO or COO can reverse a cash movement", 403);
    if (!str(body?.reason, 300) || (body!.reason as string).trim().length < 3) return err("validation", "Say why it is being reversed", 400);
    const r = await reverseCashRow(env, user.id, Number(mRev[1]), (body!.reason as string).trim());
    if (!r.ok) {
      const msg = { not_found: "Entry not found", is_reversal: "A reversal cannot itself be reversed", already_reversed: "This entry is already reversed", pending_migration: "Run PUSH.bat so migration 0147 applies, then retry" }[r.code];
      return err(r.code, msg, r.code === "not_found" ? 404 : 409);
    }
    await audit(env, user.id, "cashbook.reverse", "cashflow_entries", mRev[1], { reason: (body!.reason as string).trim(), reversal_ids: r.ids });
    return json({ ok: true, ids: r.ids });
  }

  /* ---- move money between two company accounts ---- */
  if (path === "/cashbook/transfer" && method === "POST") {
    /* v1.312.0 (F-12) - a transfer is a correction-level act: CEO and COO */
    if (!canFix) return err("forbidden", "Only the CEO or COO moves money between accounts", 403);
    const day = typeof body?.date === "string" && ISO_DAY.test(body.date) ? body.date : null;
    const amount = cents(body?.amount);
    const fromId = Number(body?.from_bank_id), toId = Number(body?.to_bank_id);
    if (!day || day > mytToday()) return err("validation", "A transfer needs a date, today or earlier", 400);
    if (amount === null || amount <= 0) return err("validation", "A transfer needs an amount above zero", 400);
    if (!Number.isInteger(fromId) || !Number.isInteger(toId) || fromId === toId) return err("validation", "Choose two different accounts", 400);
    let both: { id: number; name: string; company: string | null }[];
    try {
      both = (await env.DB.prepare(`SELECT id, name, company FROM bank_accounts WHERE id IN (?1, ?2) AND active = 1`).bind(fromId, toId).all<{ id: number; name: string; company: string | null }>()).results ?? [];
    } catch (e) {
      if (noColumn(e)) return err("pending_migration", "Run PUSH.bat so migration 0197 applies, then retry", 409);
      throw e;
    }
    if (both.length !== 2) return err("validation", "Both accounts must exist and be active", 400);
    /* v1.312.0 (CEO-2) - no money crosses between the two companies here */
    const coT = companyOf(both[0]!.company);
    if (!coT || coT !== companyOf(both[1]!.company)) return err("cross_company", "A transfer stays inside one company: both accounts must belong to the same company", 400);
    const nameOf = (id: number) => both.find((b) => b.id === id)?.name ?? "";
    const tid = `TRF-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const note = str(body?.description, 200) ? (body!.description as string).trim() : "";
    const ins = (type: "in" | "out", bank: number, desc: string) => env.DB.prepare(
      `INSERT INTO cashflow_entries (entry_date, type, category, bank_id, amount_cents, description, ref, created_by, effective_date, source_key, transfer_id, company)
       VALUES (date('now', '+8 hours'), ?1, 'transfer', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?5, ?9)`,
    ).bind(type, bank, amount, desc.slice(0, 200), tid, user.id, day, `${tid}/${type}`, coT);
    try {
      await env.DB.batch([
        ins("out", fromId, `Transfer to ${nameOf(toId)}${note ? ` - ${note}` : ""}`),
        ins("in", toId, `Transfer from ${nameOf(fromId)}${note ? ` - ${note}` : ""}`),
      ]);
    } catch (e) {
      if (noColumn(e)) return err("pending_migration", "Run PUSH.bat so migration 0147 applies, then retry", 409);
      throw e;
    }
    await audit(env, user.id, "cashbook.transfer", "cashflow_entries", tid, { from: fromId, to: toId, amount_cents: amount, day });
    return json({ ok: true, transfer_id: tid }, 201);
  }

  /* ---- which account an item moved through (evidence, never a guess) ---- */
  if (path === "/cashbook/assign-bank" && method === "POST") {
    /* v1.220.2 - one item (item_key) or many at once (item_keys, up to 500):
       the same rule for each - a row that was recorded with its own account
       is left as it is - and one audit line for the batch */
    if (!canFix) return err("forbidden", "Only the CEO or COO can assign an account", 403);
    const keys: string[] = Array.isArray(body?.item_keys)
      ? (body!.item_keys as unknown[]).filter((k): k is string => typeof k === "string" && ITEM_KEY.test(k)).slice(0, 500)
      : typeof body?.item_key === "string" && ITEM_KEY.test(body.item_key) ? [body.item_key] : [];
    const bankId = Number(body?.bank_id);
    if (!keys.length || !Number.isInteger(bankId)) return err("validation", "Choose an item and an account", 400);
    const withCo = await hasCompany(env);
    const bank = await env.DB.prepare(`SELECT id, ${withCo ? "company" : "NULL AS company"} FROM bank_accounts WHERE id = ?1 AND active = 1`).bind(bankId).first<{ id: number; company: string | null }>();
    if (!bank) return err("validation", "That account does not exist or is inactive", 400);
    /* v1.312.0 (CEO-2) - an item that already belongs to a company goes only
       to that company's account; an account must have its company first */
    const bankCompany = companyOf(bank.company);
    if (withCo && !bankCompany) return err("no_company", "Set this account's company first (Manage accounts)", 409);
    const knownCo = async (key: string): Promise<CompanyCode | null> => {
      const n = Number(key.split(":")[1]);
      try {
        if (key.startsWith("CF:")) return companyOf((await env.DB.prepare(`SELECT company FROM cashflow_entries WHERE id = ?1`).bind(n).first<{ company: string | null }>())?.company);
        if (key.startsWith("INV:")) { const d = await env.DB.prepare(`SELECT issuer_code FROM sales_documents WHERE id = ?1`).bind(n).first<{ issuer_code: string | null }>(); return d ? issuerCompany(d.issuer_code) : null; }
        if (key.startsWith("PART:")) { const d = await env.DB.prepare(`SELECT d.issuer_code FROM invoice_payments p JOIN sales_documents d ON d.id = p.invoice_id WHERE p.id = ?1`).bind(n).first<{ issuer_code: string | null }>(); return d ? issuerCompany(d.issuer_code) : null; }
      } catch { return null; }
      return null;
    };
    const note = str(body?.note, 200) ? (body!.note as string).trim() : null;
    let done = 0, skipped = 0;
    for (const key of keys) {
      const kc = bankCompany ? await knownCo(key) : null;
      if (kc && kc !== bankCompany) {
        if (keys.length === 1) return err("cross_company", "This movement belongs to the other company: choose that company's account", 409);
        skipped++;
        continue;
      }
      if (key.startsWith("CF:")) {
        const row = await env.DB.prepare(`SELECT bank_id FROM cashflow_entries WHERE id = ?1`).bind(Number(key.slice(3))).first<{ bank_id: number | null }>();
        if (!row || row.bank_id) {
          if (keys.length === 1) return row ? err("has_bank", "This entry was recorded with its account; it is not changed here", 409) : err("not_found", "Entry not found", 404);
          skipped++;
          continue;
        }
      }
      try {
        await env.DB.prepare(
          `INSERT INTO cashbook_marks (item_key, bank_id, bank_note, bank_by, bank_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))
           ON CONFLICT(item_key) DO UPDATE SET bank_id = excluded.bank_id, bank_note = excluded.bank_note, bank_by = excluded.bank_by, bank_at = excluded.bank_at`,
        ).bind(key, bankId, note, user.id).run();
        done++;
      } catch (e) {
        if (/no such table/i.test(String(e))) return err("pending_migration", "Run PUSH.bat so migration 0147 applies, then retry", 409);
        throw e;
      }
    }
    await audit(env, user.id, "cashbook.assign_bank", "cashbook_marks", keys.length === 1 ? keys[0] : `${keys.length} items`, { bank_id: bankId, items: keys.slice(0, 50), assigned: done, skipped, note });
    return json({ ok: true, assigned: done, skipped });
  }

  /* ---- an exception looked at and accepted, with a note ---- */
  if (path === "/cashbook/review" && method === "POST") {
    if (!canFix) return err("forbidden", "Only the CEO or COO can mark an item reviewed", 403);
    const key = typeof body?.key === "string" && /^[a-z_]+\|[A-Z]+[:-][\w:#-]+$/.test(body.key) && body.key.length <= 80 ? body.key : null;
    if (!key) return err("validation", "Unknown item", 400);
    if (!str(body?.note, 300) || (body!.note as string).trim().length < 3) return err("validation", "Add a short note: what was checked", 400);
    try {
      await env.DB.prepare(
        `INSERT INTO cashbook_marks (item_key, reviewed_note, reviewed_by, reviewed_at) VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(item_key) DO UPDATE SET reviewed_note = excluded.reviewed_note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`,
      ).bind(key, (body!.note as string).trim(), user.id).run();
    } catch (e) {
      if (/no such table/i.test(String(e))) return err("pending_migration", "Run PUSH.bat so migration 0147 applies, then retry", 409);
      throw e;
    }
    await audit(env, user.id, "cashbook.review", "cashbook_marks", key, { note: (body!.note as string).trim() });
    return json({ ok: true });
  }

  /* ---- an account: names, active, and its opening balance ---- */
  const mBank = path.match(/^\/cashbook\/banks\/(\d+)$/);
  if (mBank && method === "PATCH") {
    if (!canFix) return err("forbidden", "Only the CEO or COO can change an account", 403);
    const id = Number(mBank[1]);
    const cur = await env.DB.prepare(`SELECT id FROM bank_accounts WHERE id = ?1`).bind(id).first();
    if (!cur) return err("not_found", "Account not found", 404);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = ?${vals.length}`); };
    if (body && "name" in body) { if (!str(body.name, 100)) return err("validation", "The account needs a name", 400); put("name", (body.name as string).trim()); }
    if (body && "bank" in body) put("bank", typeof body.bank === "string" ? body.bank.trim().slice(0, 100) : "");
    if (body && "number_masked" in body) put("number_masked", typeof body.number_masked === "string" ? body.number_masked.trim().slice(0, 40) : "");
    if (body && "active" in body) put("active", body.active === false || body.active === 0 ? 0 : 1);
    if (body && "company" in body) {
      /* v1.312.0 (CEO-2) - an account's company is set once; it can change
         only while no movement has gone through it (history never moves) */
      const co = companyOf(body.company);
      if (!co) return err("validation", "company is a2z or azoo", 400);
      let curCo: string | null = null;
      try { curCo = (await env.DB.prepare(`SELECT company FROM bank_accounts WHERE id = ?1`).bind(id).first<{ company: string | null }>())?.company ?? null; }
      catch (e) { if (noColumn(e)) return err("pending_migration", "Run PUSH.bat so migration 0197 applies, then retry", 409); throw e; }
      if (curCo && curCo !== co) {
        const used = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM cashflow_entries WHERE bank_id = ?1) + (SELECT COUNT(*) FROM cashbook_marks WHERE bank_id = ?1) AS n`).bind(id).first<{ n: number }>();
        if (Number(used?.n ?? 0) > 0) return err("company_locked", "Movements already went through this account; its company is not changed", 409);
      }
      put("company", co);
    }
    if (body && "opening_balance" in body) {
      if (body.opening_balance === null) { put("opening_balance_cents", null); put("opening_on", null); }
      else {
        const ob = signedCents(body.opening_balance);
        const on = typeof body.opening_on === "string" && ISO_DAY.test(body.opening_on) && body.opening_on <= mytToday() ? body.opening_on : null;
        if (ob === null || !on) return err("validation", "An opening balance needs an amount and the date it was true (today or earlier)", 400);
        put("opening_balance_cents", ob); put("opening_on", on);
      }
    }
    if (!sets.length) return err("validation", "Nothing to change", 400);
    put("updated_at", new Date().toISOString().replace("T", " ").slice(0, 19));
    try {
      await env.DB.prepare(`UPDATE bank_accounts SET ${sets.join(", ")} WHERE id = ?${vals.length + 1}`).bind(...vals, id).run();
    } catch (e) {
      if (noColumn(e)) return err("pending_migration", "Run PUSH.bat so migration 0147 applies, then retry", 409);
      throw e;
    }
    await audit(env, user.id, "cashbook.bank_update", "bank_accounts", String(id), { fields: Object.keys(body ?? {}), ...(body && "company" in body ? { company: body.company } : {}) });
    return json({ ok: true });
  }

  return null;
}

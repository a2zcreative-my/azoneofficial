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
import { audit, cents, err, glCodeFor, json, postJournal, str } from "./shared";
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
export async function bookCash(
  env: Env, userId: number, ref: string, amountCents: number, category: string, description: string,
  direction: "in" | "out" = "out", effectiveDate: string | null = null,
): Promise<boolean> {
  if (amountCents <= 0) return false;
  const eff = effectiveDate && ISO_DAY.test(effectiveDate) ? effectiveDate : null;
  const desc = description.slice(0, 200);
  try {
    let key = ref;
    let written = 0;
    try {
      const prior = await env.DB.prepare(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE ref = ?1`)
        .bind(ref).first<{ n: number }>();
      key = (prior?.n ?? 0) === 0 ? ref : `${ref}#${(prior?.n ?? 0) + 1}`;
      const r = await env.DB.prepare(
        `INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key)
         SELECT date('now', '+8 hours'), ?6, ?1, ?2, ?3, ?4, ?5, COALESCE(?7, date('now', '+8 hours')), ?8
          WHERE NOT EXISTS (SELECT 1 FROM cashflow_entries c WHERE c.ref = ?4
                              AND NOT EXISTS (SELECT 1 FROM cashflow_entries r WHERE r.reversal_of = c.id))`,
      ).bind(category, amountCents, desc, ref, userId, direction, eff, key).run();
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
    // v1.20.0 C5: the movement drafts its journal entry under the same key
    await postJournal(env, userId, key, desc, category, amountCents, direction);
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
    const { results } = await env.DB.prepare(`SELECT account_id, debit_cents, credit_cents FROM journal_lines WHERE entry_id = ?1`)
      .bind(orig.id).all<{ account_id: number; debit_cents: number; credit_cents: number }>();
    if (!results?.length) return;
    const entry = await env.DB.prepare(
      `INSERT INTO journal_entries (entry_date, memo, ref, created_by) VALUES (date('now', '+8 hours'), ?1, ?2, ?3) RETURNING id`,
    ).bind(memo.slice(0, 200), newRef, userId).first<{ id: number }>();
    if (!entry?.id) return;
    for (const l of results) {
      await env.DB.prepare(`INSERT INTO journal_lines (entry_id, account_id, debit_cents, credit_cents) VALUES (?1, ?2, ?3, ?4)`)
        .bind(entry.id, l.account_id, l.credit_cents, l.debit_cents).run();
    }
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

type Source = "sales" | "part" | "elfia" | "live" | "claims" | "advance" | "payroll" | "expenses" | "manual" | "transfer" | "reversal";
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
}

const sourceOfRef = (ref: string): Source =>
  ref.startsWith("INV-") ? "sales"
  : ref.startsWith("ELF-") ? "elfia"
  : ref.startsWith("RECON-") ? "live"
  : ref.startsWith("CLM-") ? "claims"
  : ref.startsWith("PAYROLL-") ? "payroll"
  : ref.startsWith("EXP-") ? "expenses"
  : ref.startsWith("REV-") ? "reversal"
  : ref.startsWith("TRF-") ? "transfer"
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
    case "expenses": return `gl${glCodeFor(category, "out")}`;
    default: {
      const c = category.trim();
      return c ? `manual:${c.slice(0, 40)}` : type === "in" ? "other_in" : "other_out";
    }
  }
}

const RAW_ROW_SQL = (v2: boolean) => `
  SELECT c.id, c.entry_date, c.type, c.category, c.bank_id, c.amount_cents, c.description, c.ref,
         ${v2 ? "c.effective_date, c.source_key, c.reversal_of, c.reverse_reason, c.transfer_id" : "NULL AS effective_date, NULL AS source_key, NULL AS reversal_of, NULL AS reverse_reason, NULL AS transfer_id"},
         b.name AS bank_name,
         cl.id AS clm_id, date(cl.paid_at, '+8 hours') AS clm_paid, cl.amount_cents AS clm_amount, cl.claim_type AS clm_type, cl.payment_proof_key AS clm_proof,
         ex.id AS exp_id, date(ex.paid_at, '+8 hours') AS exp_paid, ex.amount_cents AS exp_amount,
         date(pp.paid_at, '+8 hours') AS pay_paid, pp.month AS pay_month,
         d.id AS inv_id, d.payment_status AS inv_status, d.doc_number AS inv_number,
         w.id AS web_id, w.refund_flagged_at AS web_refund
    FROM cashflow_entries c
    LEFT JOIN bank_accounts b ON b.id = c.bank_id
    LEFT JOIN claims cl ON c.ref LIKE 'CLM-%' AND cl.id = CAST(substr(c.ref, 5) AS INTEGER)
    LEFT JOIN expenses ex ON c.ref LIKE 'EXP-%' AND ex.id = CAST(substr(c.ref, 5) AS INTEGER)
    LEFT JOIN payroll_payments pp ON c.ref LIKE 'PAYROLL-%' AND pp.month = substr(c.ref, 9)
    LEFT JOIN sales_documents d ON c.ref LIKE 'INV-%' AND d.id = CAST(substr(c.ref, 5) AS INTEGER) AND d.doc_type = 'INV'
    LEFT JOIN web_orders w ON c.ref LIKE 'ELF-%' AND w.store = 'elfia' AND w.order_number = substr(c.ref, 5)`;

interface RawRow {
  id: number; entry_date: string; type: "in" | "out"; category: string; bank_id: number | null; amount_cents: number;
  description: string; ref: string; effective_date: string | null; source_key: string | null; reversal_of: number | null;
  reverse_reason: string | null; transfer_id: string | null; bank_name: string | null;
  clm_id: number | null; clm_paid: string | null; clm_amount: number | null; clm_type: string | null; clm_proof: string | null;
  exp_id: number | null; exp_paid: string | null; exp_amount: number | null;
  pay_paid: string | null; pay_month: string | null;
  inv_id: number | null; inv_status: string | null; inv_number: string | null;
  web_id: number | null; web_refund: string | null;
}

interface Bank { id: number; name: string; bank: string; number_masked: string; active: number; opening_balance_cents: number | null; opening_on: string | null }
interface Mark { item_key: string; bank_id: number | null; bank_note: string | null; reviewed_note: string | null; reviewed_at: string | null }

/** A first-pass read of everything the view is computed from. Sources that a
    database does not have yet contribute nothing (the tab still opens). */
async function loadAll(env: Env) {
  let v2 = true;
  try { await env.DB.prepare(`SELECT effective_date FROM cashflow_entries LIMIT 1`).first(); }
  catch (e) { if (noColumn(e)) v2 = false; else throw e; }
  const rows = (await env.DB.prepare(RAW_ROW_SQL(v2)).all<RawRow>()).results ?? [];
  const banks = v2
    ? ((await env.DB.prepare(`SELECT id, name, bank, number_masked, active, opening_balance_cents, opening_on FROM bank_accounts ORDER BY active DESC, name`).all<Bank>()).results ?? [])
    : ((await env.DB.prepare(`SELECT id, name, bank, number_masked, active, NULL AS opening_balance_cents, NULL AS opening_on FROM bank_accounts ORDER BY active DESC, name`).all<Bank>()).results ?? []);
  let marks: Mark[] = [];
  if (v2) marks = (await env.DB.prepare(`SELECT item_key, bank_id, bank_note, reviewed_note, reviewed_at FROM cashbook_marks`).all<Mark>()).results ?? [];

  let hasParts = true;
  try { await env.DB.prepare(`SELECT 1 FROM invoice_payments LIMIT 1`).first(); } catch { hasParts = false; }
  let hasConfirm = true;
  try { await env.DB.prepare(`SELECT 1 FROM invoice_paid_confirmations LIMIT 1`).first(); } catch { hasConfirm = false; }
  const CONFIRMED = (alias: string) => hasConfirm
    ? `EXISTS (SELECT 1 FROM invoice_paid_confirmations k WHERE k.invoice_id = ${alias}.id AND k.revoked_at IS NULL)` : "0";
  const PARTS = (alias: string) => hasParts
    ? `COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = ${alias}.id AND p.voided_at IS NULL), 0)` : "0";
  /* the /docs/summary rule: a paid invoice's money is the part not already
     received in parts, on date(COALESCE(paid_at, created_at), +8 hours) */
  const invoices = (await env.DB.prepare(
    `SELECT d.id, d.doc_number, d.total_cents, ${PARTS("d")} AS parts_cents, d.payment_ref, d.payment_method,
            date(COALESCE(d.paid_at, d.created_at), '+8 hours') AS paid_day, cu.company,
            ${CONFIRMED("d")} AS confirmed
       FROM sales_documents d LEFT JOIN customers cu ON cu.id = d.customer_id
      WHERE d.doc_type = 'INV' AND d.payment_status = 'paid'`,
  ).all<{ id: number; doc_number: string; total_cents: number; parts_cents: number; payment_ref: string | null; payment_method: string | null; paid_day: string; company: string | null; confirmed: number }>()).results ?? [];
  const parts = hasParts ? ((await env.DB.prepare(
    `SELECT p.id, p.invoice_id, p.amount_cents, p.received_on, p.method, p.reference, d.doc_number, d.payment_status, cu.company,
            ${CONFIRMED("d")} AS confirmed
       FROM invoice_payments p JOIN sales_documents d ON d.id = p.invoice_id AND d.doc_type = 'INV'
       LEFT JOIN customers cu ON cu.id = d.customer_id
      WHERE p.voided_at IS NULL`,
  ).all<{ id: number; invoice_id: number; amount_cents: number; received_on: string; method: string | null; reference: string | null; doc_number: string; payment_status: string | null; company: string | null; confirmed: number }>()).results ?? []) : [];
  return { v2, rows, banks, marks, invoices, parts, hasConfirm };
}

/** The day a row's money moved: the row's own date when it carries one;
    otherwise its source's paid day - but only when that day is not after the
    row was booked (a later paid day belongs to a later payment); otherwise
    the day it was booked. */
function dayOf(r: RawRow): string {
  if (r.effective_date) return r.effective_date;
  const src = r.ref.startsWith("CLM-") ? r.clm_paid : r.ref.startsWith("EXP-") ? r.exp_paid : r.ref.startsWith("PAYROLL-") ? r.pay_paid : null;
  return src && src <= r.entry_date ? src : r.entry_date;
}

function buildItems(data: Awaited<ReturnType<typeof loadAll>>) {
  const bankName = new Map(data.banks.map((b) => [b.id, b.name]));
  const markOf = new Map(data.marks.map((m) => [m.item_key, m]));
  const byId = new Map(data.rows.map((r) => [r.id, r]));
  const reversedBy = new Map<number, number>();
  for (const r of data.rows) if (r.reversal_of) reversedBy.set(r.reversal_of, r.id);

  const items: CashItem[] = [];
  const withBank = (key: string, rowBank: number | null) => {
    const b = rowBank ?? markOf.get(key)?.bank_id ?? null;
    return { bank_id: b, bank_name: b ? bankName.get(b) ?? null : null };
  };

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
      ...withBank(key, r.bank_id),
      counts, sign: r.reversal_of ? -1 : 1, reversal_of: r.reversal_of, reversed_by: reversedBy.get(r.id) ?? null,
      reverse_reason: r.reverse_reason, transfer_id: r.transfer_id, payment_ref: null,
    });
  }

  for (const inv of data.invoices) {
    const amount = inv.total_cents - inv.parts_cents;
    if (amount <= 0) continue;
    const key = `INV:${inv.id}`;
    items.push({
      key, row_id: null, date: inv.paid_day, booked_on: null, type: "in", amount_cents: amount, category: "sales", group: "sales",
      source: "sales", status: inv.confirmed ? "verified" : "unverified",
      description: `${inv.doc_number}${inv.company ? ` - ${inv.company}` : ""}${inv.parts_cents > 0 ? " (balance)" : ""}`,
      ref: inv.doc_number, link: { kind: "invoice", id: inv.id }, ...withBank(key, null),
      counts: "in", sign: 1, reversal_of: null, reversed_by: null, reverse_reason: null, transfer_id: null, payment_ref: inv.payment_ref,
    });
  }
  for (const p of data.parts) {
    const key = `PART:${p.id}`;
    items.push({
      key, row_id: null, date: p.received_on, booked_on: null, type: "in", amount_cents: p.amount_cents, category: "sales", group: "sales",
      source: "part", status: p.payment_status === "paid" && p.confirmed ? "verified" : "unverified",
      description: `${p.doc_number}${p.company ? ` - ${p.company}` : ""} (part payment)`,
      ref: p.doc_number, link: { kind: "invoice", id: p.invoice_id }, ...withBank(key, null),
      counts: "in", sign: 1, reversal_of: null, reversed_by: null, reverse_reason: null, transfer_id: null, payment_ref: p.reference,
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
  actions: ("bank" | "reverse" | "review" | "book" | "confirm")[];
}

async function exceptionsOf(env: Env, data: Awaited<ReturnType<typeof loadAll>>, items: CashItem[], from: string, to: string): Promise<Exception[]> {
  const reviewed = new Set(data.marks.filter((m) => m.reviewed_at).map((m) => m.item_key));
  const out: Exception[] = [];
  const add = (x: Exception) => { if (!reviewed.has(`${x.kind}|${x.key}`)) out.push(x); };
  const inPeriod = (d: string) => d >= from && d <= to;
  const reversedIds = new Set(data.rows.filter((x) => x.reversal_of).map((x) => x.reversal_of as number));
  const live = (r: RawRow) => !r.reversal_of && !reversedIds.has(r.id);

  for (const it of items) {
    if (!inPeriod(it.date)) continue;
    if ((it.source === "sales" || it.source === "part") && it.status === "unverified") {
      add({ kind: "unverified", key: it.key, item_key: it.key, date: it.date, title: it.description, detail: "Recorded as received; not yet confirmed by the CEO or COO.", amount_cents: it.amount_cents, type: "in", row_id: null, link: it.link, actions: ["confirm", "review"] });
    }
    if (it.counts && !it.bank_id && it.status !== "reversal" && it.status !== "reversed") {
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
    if (r.ref.startsWith("EXP-")) {
      if (!r.exp_id) add({ ...base, kind: "out_of_step", key: `CF:${r.id}`, title: r.description || r.ref, detail: "The expense was deleted; its payment is still in the cash book.", actions: ["reverse", "review"] });
      else if (!r.exp_paid) add({ ...base, kind: "out_of_step", key: `CF:${r.id}`, title: r.description || r.ref, detail: "The expense is no longer marked paid; its payment is still in the cash book.", actions: ["reverse", "review"] });
      else if (r.exp_amount != null && r.exp_amount !== r.amount_cents) add({ ...base, kind: "out_of_step", key: `CF:${r.id}`, title: r.description || r.ref, detail: `The expense now says ${(r.exp_amount / 100).toFixed(2)}; the cash book paid ${(r.amount_cents / 100).toFixed(2)}.`, actions: ["reverse", "review"] });
    } else if (r.ref.startsWith("INV-")) {
      if (!r.inv_id || r.inv_status !== "paid") add({ ...base, kind: "out_of_step", key: `CF:${r.id}`, title: r.inv_number ?? r.description ?? r.ref, detail: r.inv_id ? "The invoice is no longer marked paid. Finance does not count it; the cash book and the journal still hold it." : "The invoice was deleted. Finance does not count it; the cash book and the journal still hold it.", actions: ["reverse", "review"] });
    } else if (r.ref.startsWith("CLM-") && !r.clm_id) {
      add({ ...base, kind: "out_of_step", key: `CF:${r.id}`, title: r.description || r.ref, detail: "The claim this paid no longer exists.", actions: ["reverse", "review"] });
    } else if (r.ref.startsWith("ELF-") && r.web_refund) {
      add({ ...base, kind: "elfia_cancelled", key: `CF:${r.id}`, title: r.description || r.ref, detail: "The ELFIA order was cancelled after it was paid. Decide the refund; reverse this when the money goes back.", actions: ["reverse", "review"] });
    }
  }

  /* payroll: the run's saved net today against what was booked when it was paid */
  const payRows = data.rows.filter((r) => r.ref.startsWith("PAYROLL-") && live(r));
  for (const r of payRows) {
    try {
      const net = await env.DB.prepare(`SELECT COALESCE(SUM(net_cents), 0) AS n FROM payroll_entries WHERE month = ?1`).bind(r.ref.slice(8)).first<{ n: number }>();
      if (net && net.n !== r.amount_cents) {
        add({ kind: "out_of_step", key: `CF:${r.id}`, item_key: `CF:${r.id}`, date: dayOf(r), title: r.description || r.ref, detail: `Payroll now totals ${(net.n / 100).toFixed(2)} net; the bank run booked ${(r.amount_cents / 100).toFixed(2)}.`, amount_cents: r.amount_cents, type: r.type, row_id: r.id, link: { kind: "payroll", id: r.ref.slice(8) }, actions: ["review", "reverse"] });
      }
    } catch { /* pre-payroll */ }
  }

  /* a typed movement that matches something a module booked */
  const counted = items.filter((i) => i.counts && i.status !== "reversed" && i.status !== "reversal");
  for (const m of counted) {
    if (m.source !== "manual" || !inPeriod(m.date)) continue;
    const twin = counted.find((o) => o.key !== m.key && o.date === m.date && o.type === m.type && o.amount_cents === m.amount_cents);
    if (twin) add({ kind: "duplicate", key: m.key, item_key: m.key, date: m.date, title: m.description || m.category || "Manual entry", detail: `Same day, direction and amount as: ${twin.description || twin.ref}.`, amount_cents: m.amount_cents, type: m.type, row_id: m.row_id, link: null, actions: ["reverse", "review"] });
  }

  /* paid in a module, but no live cash row (booked by "Book missing") */
  const liveRefs = new Set(data.rows.filter(live).map((r) => r.ref));
  const missing = async (sql: string, make: (r: Record<string, unknown>) => Exception) => {
    try { for (const r of (await env.DB.prepare(sql).all<Record<string, unknown>>()).results ?? []) { const x = make(r); if (!liveRefs.has(x.key)) add(x); } } catch { /* source table absent */ }
  };
  await missing(`SELECT id, amount_cents, date(paid_at, '+8 hours') AS d, COALESCE(vendor, description, category) AS t FROM expenses WHERE paid_at IS NOT NULL AND amount_cents > 0`,
    (r) => ({ kind: "not_booked", key: `EXP-${r.id}`, item_key: `EXP-${r.id}`, date: String(r.d), title: String(r.t ?? "Expense"), detail: "Marked paid, but not in the cash book.", amount_cents: Number(r.amount_cents), type: "out", row_id: null, link: { kind: "expense", id: Number(r.id) }, actions: ["book", "review"] }));
  await missing(`SELECT id, amount_cents, date(paid_at, '+8 hours') AS d FROM claims WHERE paid_at IS NOT NULL AND amount_cents > 0`,
    (r) => ({ kind: "not_booked", key: `CLM-${r.id}`, item_key: `CLM-${r.id}`, date: String(r.d), title: `Claim ${r.id}`, detail: "Paid out, but not in the cash book.", amount_cents: Number(r.amount_cents), type: "out", row_id: null, link: { kind: "claim", id: Number(r.id) }, actions: ["book", "review"] }));
  await missing(`SELECT pp.month, date(pp.paid_at, '+8 hours') AS d, (SELECT COALESCE(SUM(net_cents), 0) FROM payroll_entries e WHERE e.month = pp.month) AS n FROM payroll_payments pp`,
    (r) => ({ kind: "not_booked", key: `PAYROLL-${r.month}`, item_key: `PAYROLL-${r.month}`, date: String(r.d), title: `Payroll ${r.month}`, detail: "The bank run is marked done, but it is not in the cash book.", amount_cents: Number(r.n), type: "out", row_id: null, link: { kind: "payroll", id: String(r.month) }, actions: ["book", "review"] }));

  return out.filter((x) => x.kind !== "not_booked" || x.amount_cents > 0);
}

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
    let data;
    try { data = await loadAll(env); }
    catch (e) {
      if (/no such table/i.test(String(e))) return json({ pending_migration: true, items: [], banks: [], exceptions: [] });
      throw e;
    }
    const all = buildItems(data);
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
    const banks = data.banks.map((b) => {
      const bal = b.opening_balance_cents != null && b.opening_on
        ? b.opening_balance_cents + all.filter((i) => i.bank_id === b.id && i.date >= b.opening_on! && i.date <= today)
            .reduce((a, i) => a + (i.type === "in" ? i.amount_cents : -i.amount_cents), 0)
        : null;
      return { ...b, book_balance_cents: bal };
    });
    const exceptions = await exceptionsOf(env, data, all, from, to);
    const moneyIn = sum(items, "in"), moneyOut = sum(items, "out");
    return json({
      period: { from, to, today },
      totals: { in_cents: moneyIn, out_cents: moneyOut, net_cents: moneyIn - moneyOut, count: items.length },
      groups: { in: groups("in"), out: groups("out") },
      trend,
      items,
      banks,
      exceptions,
      can_correct: canFix,
      can_enter: canRead,
      pending_migration: !data.v2,
      confirmations: data.hasConfirm,
    });
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
    if (!canRead) return err("forbidden", "No access to cash flow", 403);
    const day = typeof body?.date === "string" && ISO_DAY.test(body.date) ? body.date : null;
    const amount = cents(body?.amount);
    const fromId = Number(body?.from_bank_id), toId = Number(body?.to_bank_id);
    if (!day || day > mytToday()) return err("validation", "A transfer needs a date, today or earlier", 400);
    if (amount === null || amount <= 0) return err("validation", "A transfer needs an amount above zero", 400);
    if (!Number.isInteger(fromId) || !Number.isInteger(toId) || fromId === toId) return err("validation", "Choose two different accounts", 400);
    const both = (await env.DB.prepare(`SELECT id, name FROM bank_accounts WHERE id IN (?1, ?2) AND active = 1`).bind(fromId, toId).all<{ id: number; name: string }>()).results ?? [];
    if (both.length !== 2) return err("validation", "Both accounts must exist and be active", 400);
    const nameOf = (id: number) => both.find((b) => b.id === id)?.name ?? "";
    const tid = `TRF-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const note = str(body?.description, 200) ? (body!.description as string).trim() : "";
    const ins = (type: "in" | "out", bank: number, desc: string) => env.DB.prepare(
      `INSERT INTO cashflow_entries (entry_date, type, category, bank_id, amount_cents, description, ref, created_by, effective_date, source_key, transfer_id)
       VALUES (date('now', '+8 hours'), ?1, 'transfer', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?5)`,
    ).bind(type, bank, amount, desc.slice(0, 200), tid, user.id, day, `${tid}/${type}`);
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
    if (!canFix) return err("forbidden", "Only the CEO or COO can assign an account", 403);
    const key = typeof body?.item_key === "string" && ITEM_KEY.test(body.item_key) ? body.item_key : null;
    const bankId = Number(body?.bank_id);
    if (!key || !Number.isInteger(bankId)) return err("validation", "Choose an item and an account", 400);
    const bank = await env.DB.prepare(`SELECT id FROM bank_accounts WHERE id = ?1 AND active = 1`).bind(bankId).first();
    if (!bank) return err("validation", "That account does not exist or is inactive", 400);
    if (key.startsWith("CF:")) {
      const row = await env.DB.prepare(`SELECT bank_id FROM cashflow_entries WHERE id = ?1`).bind(Number(key.slice(3))).first<{ bank_id: number | null }>();
      if (!row) return err("not_found", "Entry not found", 404);
      if (row.bank_id) return err("has_bank", "This entry was recorded with its account; it is not changed here", 409);
    }
    const note = str(body?.note, 200) ? (body!.note as string).trim() : null;
    const before = await env.DB.prepare(`SELECT bank_id FROM cashbook_marks WHERE item_key = ?1`).bind(key).first<{ bank_id: number | null }>().catch(() => null);
    try {
      await env.DB.prepare(
        `INSERT INTO cashbook_marks (item_key, bank_id, bank_note, bank_by, bank_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(item_key) DO UPDATE SET bank_id = excluded.bank_id, bank_note = excluded.bank_note, bank_by = excluded.bank_by, bank_at = excluded.bank_at`,
      ).bind(key, bankId, note, user.id).run();
    } catch (e) {
      if (/no such table/i.test(String(e))) return err("pending_migration", "Run PUSH.bat so migration 0147 applies, then retry", 409);
      throw e;
    }
    await audit(env, user.id, "cashbook.assign_bank", "cashbook_marks", key, { bank_id: bankId, was: before?.bank_id ?? null, note });
    return json({ ok: true });
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
    await audit(env, user.id, "cashbook.bank_update", "bank_accounts", String(id), { fields: Object.keys(body ?? {}) });
    return json({ ok: true });
  }

  return null;
}

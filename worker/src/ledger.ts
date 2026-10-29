/* v1.222.0 - ACCOUNTING 2.0: THE LEDGER'S READS.
 *
 * The owner's brief and answers, 28-10-2026 (claude/ACCOUNTING-AUDIT.md):
 * "Four tabs, read-only", "Date by money-moved day", "Soft control", "Flag
 * it, don't restrict". This file only READS the one ledger that exists
 * (gl_accounts, journal_entries, journal_lines). It writes nothing, posts
 * nothing and has no second engine: every figure is a sum of journal lines.
 *
 * THE DATE A LINE BELONGS TO. Until v1.222.0 every automatic entry was dated
 * the day it was BOOKED, and the 1.219.0 backfill dated a whole history on
 * one day. Nothing is rewritten: an entry is read on the day its money moved
 * - the cash book row it was booked from (its key is the entry's ref) - and
 * a manual entry on the date it was given. That is `eff` below.
 *
 * THE BASIS. Every automatic entry is bank against income or expense, posted
 * when money moves: the books are CASH BASIS, and every report says so. No
 * balance sheet is drawn - there are no opening balances, no equity and no
 * receivables or payables posted, so one would mislead (the audit, sec. 7).
 *
 * Gate: accounting_manage (super admin, admin, CEO), as every /gl route.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { can } from "./permissions";
import { err, json } from "./shared";
import { cashExceptionsFor } from "./cashbook";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const monthLast = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y!, mo!, 0)).toISOString().slice(0, 10); };
const shiftMonth = (m: string, k: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y!, mo! - 1 + k, 1)); return d.toISOString().slice(0, 7); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);

/* ---- where an entry came from: its ref names the event ---- */
export type SourceKind = "sales" | "expenses" | "claims" | "payroll" | "finance" | "channel" | "elfia" | "reversal" | "manual";
const PREFIX: [RegExp, SourceKind][] = [
  [/^INV-\d+/, "sales"], [/^CN-\d+/, "sales"], [/^EXP-\d+/, "expenses"], [/^CLM-\d+/, "claims"], [/^PAYROLL-\d{4}-\d{2}/, "payroll"],
  [/^CF-\d+/, "finance"], [/^RECON-/, "channel"], [/^ELF-/, "elfia"], [/^REVJ?-\d+/, "reversal"],
];
export function sourceOf(ref: string): SourceKind {
  for (const [re, kind] of PREFIX) if (re.test(ref)) return kind;
  return "manual";
}
/** A manual entry - typed in Accounting, not booked by a source record. */
export const isManualRef = (ref: string) => sourceOf(ref) === "manual";
const SOURCE_TAB: Partial<Record<SourceKind, string>> = { sales: "Sales", expenses: "Finance", claims: "Claims", payroll: "Payroll", finance: "Finance", channel: "Finance", elfia: "ELFIA Store", reversal: "Finance" };

interface Account { id: number; code: string; name: string; type: "asset" | "liability" | "equity" | "income" | "expense"; active: number }
interface Entry { id: number; ref: string; memo: string; entry_date: string; created_at: string; created_by: number; eff: string; who: string | null }
interface Line { id: number; entry_id: number; account_id: number; debit_cents: number; credit_cents: number }
const normalOf = (t: Account["type"]) => (t === "asset" || t === "expense" ? "debit" : "credit");

async function has(env: Env, sql: string): Promise<boolean> {
  try { await env.DB.prepare(sql).first(); return true; } catch { return false; }
}

/** The whole book: accounts, every entry with the day it belongs to, every line. */
export async function loadBook(env: Env) {
  const cash = await has(env, `SELECT id FROM cashflow_entries LIMIT 1`);
  const effCols = cash && await has(env, `SELECT effective_date, source_key, reversal_of, transfer_id FROM cashflow_entries LIMIT 1`);
  const cashDay = effCols ? "COALESCE(c.effective_date, c.entry_date)" : "c.entry_date";
  const EFF = !cash ? "e.entry_date" : `COALESCE(
      ${effCols ? `(SELECT ${cashDay} FROM cashflow_entries c WHERE c.source_key = e.ref LIMIT 1),` : ""}
      (SELECT ${cashDay} FROM cashflow_entries c WHERE e.ref != '' AND c.ref = e.ref ORDER BY c.id LIMIT 1),
      CASE WHEN e.ref LIKE 'CF-%' THEN (SELECT ${cashDay} FROM cashflow_entries c WHERE c.id = CAST(substr(e.ref, 4) AS INTEGER)) END,
      e.entry_date)`;
  const accounts = (await env.DB.prepare(`SELECT id, code, name, type, active FROM gl_accounts ORDER BY code`).all<Account>()).results ?? [];
  let entries: Entry[];
  try {
    entries = (await env.DB.prepare(
      `SELECT e.id, e.ref, e.memo, e.entry_date, e.created_at, e.created_by, ${EFF} AS eff,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS who
         FROM journal_entries e LEFT JOIN users u ON u.id = e.created_by ORDER BY e.id`,
    ).all<Entry>()).results ?? [];
  } catch {
    entries = (await env.DB.prepare(
      `SELECT e.id, e.ref, e.memo, e.entry_date, e.created_at, e.created_by, ${EFF} AS eff, u.name AS who
         FROM journal_entries e LEFT JOIN users u ON u.id = e.created_by ORDER BY e.id`,
    ).all<Entry>()).results ?? [];
  }
  for (const e of entries) e.eff = DAY.test(String(e.eff ?? "")) ? String(e.eff).slice(0, 10) : String(e.entry_date).slice(0, 10);
  const lines = (await env.DB.prepare(`SELECT id, entry_id, account_id, debit_cents, credit_cents FROM journal_lines ORDER BY id`).all<Line>()).results ?? [];
  const byEntry = new Map<number, Line[]>();
  for (const l of lines) { const list = byEntry.get(l.entry_id) ?? []; list.push(l); byEntry.set(l.entry_id, list); }
  const entryOf = new Map(entries.map((e) => [e.id, e]));
  return { accounts, entries, lines, byEntry, entryOf, cash, effCols };
}
type Book = Awaited<ReturnType<typeof loadBook>>;

/** Debits and credits per account over the lines whose day passes `keep`. */
function totals(book: Book, keep: (eff: string) => boolean) {
  const t = new Map<number, { d: number; c: number }>();
  for (const l of book.lines) {
    const e = book.entryOf.get(l.entry_id);
    if (!e || !keep(e.eff)) continue;
    const x = t.get(l.account_id) ?? { d: 0, c: 0 };
    x.d += l.debit_cents; x.c += l.credit_cents;
    t.set(l.account_id, x);
  }
  return t;
}
const balanceOn = (a: Account, x: { d: number; c: number } | undefined) => (x ? (normalOf(a.type) === "debit" ? x.d - x.c : x.c - x.d) : 0);

function trialOf(book: Book, keep: (eff: string) => boolean) {
  const t = totals(book, keep);
  const rows = book.accounts.filter((a) => a.active || t.has(a.id)).map((a) => {
    const x = t.get(a.id) ?? { d: 0, c: 0 };
    return { id: a.id, code: a.code, name: a.name, type: a.type, active: a.active, normal: normalOf(a.type), debit_cents: x.d, credit_cents: x.c, balance_cents: balanceOn(a, x) };
  });
  const debit = rows.reduce((s, r) => s + r.debit_cents, 0), credit = rows.reduce((s, r) => s + r.credit_cents, 0);
  return { accounts: rows, debit_cents: debit, credit_cents: credit, balanced: debit === credit, difference_cents: debit - credit };
}

/** Money in (income accounts, net of credits) and out (expense accounts) in a range. */
function inOut(book: Book, from: string, to: string) {
  const t = totals(book, (d) => d >= from && d <= to);
  let inC = 0, outC = 0;
  for (const a of book.accounts) {
    const x = t.get(a.id);
    if (!x) continue;
    if (a.type === "income") inC += x.c - x.d;
    if (a.type === "expense") outC += x.d - x.c;
  }
  return { in_cents: inC, out_cents: outC, net_cents: inC - outC };
}

/* ---- the posting checks (the audit, sec. 3.3), all reads ---- */
async function integrity(env: Env, book: Book) {
  const unbalanced = book.entries.flatMap((e) => {
    const ls = book.byEntry.get(e.id) ?? [];
    const d = ls.reduce((s, l) => s + l.debit_cents, 0), c = ls.reduce((s, l) => s + l.credit_cents, 0);
    return d !== c || ls.length < 2 ? [{ id: e.id, ref: e.ref, eff: e.eff, debit_cents: d, credit_cents: c, lines: ls.length }] : [];
  });
  const refCount = new Map<string, number[]>();
  for (const e of book.entries) if (e.ref) refCount.set(e.ref, [...(refCount.get(e.ref) ?? []), e.id]);
  const duplicates = [...refCount.entries()].filter(([, ids]) => ids.length > 1).map(([ref, ids]) => ({ ref, ids }));
  const refs = new Set(book.entries.map((e) => e.ref).filter(Boolean));
  let unjournaled: { id: number; ref: string; type: string; amount_cents: number; date: string }[] = [];
  let payrollDrift: { month: string; booked_cents: number; payroll_cents: number }[] = [];
  if (book.cash) {
    try {
      const rows = (await env.DB.prepare(book.effCols
        ? `SELECT id, ref, source_key, type, amount_cents, COALESCE(effective_date, entry_date) AS d, transfer_id, reversal_of FROM cashflow_entries WHERE amount_cents > 0`
        : `SELECT id, ref, NULL AS source_key, type, amount_cents, entry_date AS d, NULL AS transfer_id, NULL AS reversal_of FROM cashflow_entries WHERE amount_cents > 0`,
      ).all<{ id: number; ref: string; source_key: string | null; type: string; amount_cents: number; d: string; transfer_id: string | null; reversal_of: number | null }>()).results ?? [];
      unjournaled = rows
        .filter((r) => !r.transfer_id && ![r.source_key, r.ref, `CF-${r.id}`].some((k) => k && refs.has(k)))
        .map((r) => ({ id: r.id, ref: r.source_key ?? r.ref, type: r.type, amount_cents: r.amount_cents, date: String(r.d).slice(0, 10) }));
      /* payroll: what the books hold for a month (live PAYROLL- rows) against what payroll says now */
      const reversed = new Set(rows.filter((r) => r.reversal_of).map((r) => r.reversal_of));
      const booked = new Map<string, number>();
      for (const r of rows) {
        const m = /^PAYROLL-(\d{4}-\d{2})$/.exec(r.ref ?? "");
        if (!m || r.type !== "out" || r.reversal_of || reversed.has(r.id)) continue;
        booked.set(m[1]!, (booked.get(m[1]!) ?? 0) + r.amount_cents);
      }
      if (booked.size) {
        const net = (await env.DB.prepare(`SELECT month, COALESCE(SUM(net_cents), 0) AS c FROM payroll_entries GROUP BY month`).all<{ month: string; c: number }>()).results ?? [];
        const now = new Map(net.map((n) => [n.month, Number(n.c)]));
        payrollDrift = [...booked.entries()].filter(([m, b]) => (now.get(m) ?? 0) !== b).map(([month, b]) => ({ month, booked_cents: b, payroll_cents: now.get(month) ?? 0 }));
      }
    } catch { /* a database without these tables: nothing to compare */ }
  }
  return { unbalanced, duplicates, unjournaled, payroll_drift: payrollDrift };
}

/** Part payments received on invoices not yet paid in full - cash that is
    real but enters the books only when the invoice is paid in full. */
async function partPayments(env: Env, from?: string, to?: string) {
  try {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(p.amount_cents), 0) AS c FROM invoice_payments p JOIN sales_documents d ON d.id = p.invoice_id
        WHERE p.voided_at IS NULL AND COALESCE(d.payment_status, 'unpaid') != 'paid'
          ${from && to ? "AND p.received_on BETWEEN ?1 AND ?2" : ""}`,
    ).bind(...(from && to ? [from, to] : [])).first<{ n: number; c: number }>();
    return { count: Number(r?.n ?? 0), cents: Number(r?.c ?? 0) };
  } catch { return { count: 0, cents: 0 }; }
}

/** Money records (expenses, cash movements, bank accounts) with no company
    decision yet - a count only, the review itself is in Companies. */
async function unassignedMoney(env: Env): Promise<number | null> {
  try {
    const r = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM expenses s WHERE NOT EXISTS (SELECT 1 FROM company_review_decisions d WHERE d.record_kind = 'expenses' AND d.record_id = s.id))
            + (SELECT COUNT(*) FROM cashflow_entries s WHERE NOT EXISTS (SELECT 1 FROM company_review_decisions d WHERE d.record_kind = 'cashflow_entries' AND d.record_id = s.id))
            + (SELECT COUNT(*) FROM bank_accounts s WHERE NOT EXISTS (SELECT 1 FROM company_review_decisions d WHERE d.record_kind = 'bank_accounts' AND d.record_id = s.id)) AS n`,
    ).first<{ n: number }>();
    return Number(r?.n ?? 0);
  } catch { return null; }
}

const amountOf = (book: Book, id: number) => (book.byEntry.get(id) ?? []).reduce((s, l) => s + l.debit_cents, 0);
const brief = (book: Book, e: Entry) => ({
  id: e.id, ref: e.ref, memo: e.memo, eff: e.eff, entry_date: e.entry_date, created_at: e.created_at, who: e.who,
  amount_cents: amountOf(book, e.id), lines: (book.byEntry.get(e.id) ?? []).length, source: sourceOf(e.ref),
});

/** v1.222.0 - the ledger's own figures for one month, for the month-close
    snapshot (business.ts): income, expense and entries by the day money moved. */
export async function glMonthFigures(env: Env, m: string): Promise<{ gl_income_cents: number; gl_expense_cents: number; gl_entries: number }> {
  try {
    const book = await loadBook(env);
    const io = inOut(book, `${m}-01`, monthLast(m));
    return { gl_income_cents: io.in_cents, gl_expense_cents: io.out_cents, gl_entries: book.entries.filter((e) => e.eff.slice(0, 7) === m).length };
  } catch { return { gl_income_cents: 0, gl_expense_cents: 0, gl_entries: 0 }; }
}

async function closeOf(env: Env, m: string) {
  try {
    return await env.DB.prepare(
      `SELECT p.id, p.closed_at, p.note, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS who
         FROM period_closes p LEFT JOIN users u ON u.id = p.closed_by WHERE p.month = ?1 AND p.reopened_at IS NULL ORDER BY p.id DESC LIMIT 1`,
    ).bind(m).first<{ id: number; closed_at: string; note: string | null; who: string | null }>();
  } catch { return null; }
}

/** Entries that belong to a closed month but were posted after it closed. */
async function postCloseAdjustments(env: Env, book: Book, m: string, closedAt: string) {
  /* at or after the close: one posted in the same second is listed, not hidden */
  const list = book.entries.filter((e) => e.eff.slice(0, 7) === m && e.created_at >= closedAt);
  const reasons = new Map<string, string>();
  if (list.length) {
    try {
      const rows = (await env.DB.prepare(
        `SELECT entity_id, detail FROM audit_log WHERE action = 'erp.journal_create' AND entity = 'journal_entries' AND detail LIKE '%post_close_reason%'`,
      ).all<{ entity_id: string; detail: string }>()).results ?? [];
      for (const r of rows) { try { const d = JSON.parse(r.detail) as { post_close_reason?: string }; if (d.post_close_reason) reasons.set(String(r.entity_id), d.post_close_reason); } catch { /* unreadable detail */ } }
    } catch { /* no audit table */ }
  }
  return list.map((e) => ({ ...brief(book, e), reason: reasons.get(String(e.id)) ?? null }));
}

export async function handleLedger(env: Env, path: string, method: string, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (method !== "GET" || !path.startsWith("/gl/")) return null;
  const owned = ["/gl/overview", "/gl/month-end", "/gl/ledger", "/gl/pnl"].includes(path)
    || /^\/gl\/journal\/\d+$/.test(path)
    || (path === "/gl/journal" && ["q", "source", "from", "to", "page"].some((k) => params.has(k)))
    || (path === "/gl/trial-balance" && params.has("as_of"));
  if (!owned) return null;
  if (!can(user.role, "accounting_manage")) return err("forbidden", "No access to accounting", 403);
  const today = mytToday();
  const book = await loadBook(env);

  if (path === "/gl/trial-balance") {
    const asOf = params.get("as_of") ?? "";
    if (!DAY.test(asOf)) return err("validation", "as_of must be a date (YYYY-MM-DD)", 400);
    return json({ as_of: asOf, basis: "cash", ...trialOf(book, (d) => d <= asOf) });
  }

  if (path === "/gl/overview") {
    const to = DAY.test(params.get("to") ?? "") ? params.get("to")! : today;
    const from = DAY.test(params.get("from") ?? "") ? params.get("from")! : `${to.slice(0, 7)}-01`;
    if (from > to) return err("validation", "The period starts after it ends", 400);
    const trial = trialOf(book, () => true);
    const t = totals(book, (d) => d >= from && d <= to);
    const top = book.accounts.filter((a) => a.type === "expense").map((a) => ({ id: a.id, code: a.code, name: a.name, cents: balanceOn(a, t.get(a.id)) }))
      .filter((x) => x.cents !== 0).sort((a, b) => b.cents - a.cents);
    const trend = Array.from({ length: 6 }, (_, k) => shiftMonth(to.slice(0, 7), k - 5)).map((m) => ({ month: m, ...inOut(book, `${m}-01`, monthLast(m)) }));
    const used = new Set(book.lines.map((l) => l.account_id));
    const checks = await integrity(env, book);
    const bank = book.accounts.find((a) => a.code === "1100");
    return json({
      period: { from, to, today }, basis: "cash",
      accounts: { total: book.accounts.length, used: book.accounts.filter((a) => used.has(a.id)).length },
      trial: { debit_cents: trial.debit_cents, credit_cents: trial.credit_cents, balanced: trial.balanced, difference_cents: trial.difference_cents },
      money: inOut(book, from, to),
      trend, top_expenses: top,
      balances: trial.accounts.filter((a) => a.debit_cents || a.credit_cents),
      bank: bank ? { code: bank.code, name: bank.name, balance_cents: balanceOn(bank, totals(book, () => true).get(bank.id)) } : null,
      exceptions: { ...checks, part_payments: await partPayments(env) },
      recent: [...book.entries].sort((a, b) => b.id - a.id).slice(0, 10).map((e) => brief(book, e)),
      entries: book.entries.length,
    });
  }

  if (path === "/gl/month-end") {
    const m = params.get("month") ?? shiftMonth(today.slice(0, 7), -1);
    if (!MONTH.test(m)) return err("validation", "month must be YYYY-MM", 400);
    const from = `${m}-01`, to = monthLast(m);
    const trial = trialOf(book, (d) => d <= to);
    const checks = await integrity(env, book);
    const unjMonth = checks.unjournaled.filter((r) => r.date >= from && r.date <= to);
    const rec = await cashExceptionsFor(env, from, to);
    const recBy: Record<string, number> = {};
    for (const x of rec ?? []) recBy[x.kind] = (recBy[x.kind] ?? 0) + 1;
    let payroll: { saved: number; paid: boolean; drift: { booked_cents: number; payroll_cents: number } | null } = { saved: 0, paid: false, drift: null };
    try {
      const s = await env.DB.prepare(`SELECT COUNT(*) AS n FROM payroll_entries WHERE month = ?1`).bind(m).first<{ n: number }>();
      let paid = false;
      try { paid = Boolean(await env.DB.prepare(`SELECT month FROM payroll_payments WHERE month = ?1`).bind(m).first()); } catch { /* pre-0037 */ }
      const d = checks.payroll_drift.find((x) => x.month === m) ?? null;
      payroll = { saved: Number(s?.n ?? 0), paid, drift: d ? { booked_cents: d.booked_cents, payroll_cents: d.payroll_cents } : null };
    } catch { /* no payroll table */ }
    const parts = await partPayments(env, from, to);
    const unassigned = await unassignedMoney(env);
    const close = await closeOf(env, m);
    const list = [
      { key: "balanced", level: "block", ok: trial.balanced, detail: { debit_cents: trial.debit_cents, credit_cents: trial.credit_cents, difference_cents: trial.difference_cents } },
      { key: "posting", level: "block", ok: checks.unbalanced.length === 0 && checks.duplicates.length === 0 && unjMonth.length === 0,
        detail: { unbalanced: checks.unbalanced.length, duplicates: checks.duplicates.length, unjournaled: unjMonth.length } },
      { key: "reconciliation", level: "warn", ok: rec !== null && rec.length === 0, detail: { readable: rec !== null, total: rec?.length ?? 0, by_kind: recBy } },
      { key: "payroll", level: "warn", ok: payroll.saved === 0 || (payroll.paid && !payroll.drift), detail: payroll },
      { key: "part_payments", level: "info", ok: parts.count === 0, detail: parts },
      { key: "ownership", level: "warn", ok: unassigned === 0, detail: { unassigned, readable: unassigned !== null } },
    ];
    return json({
      month: m, from, to, today, basis: "cash", ended: to < today,
      checks: list,
      ready: list.filter((c) => c.level === "block").every((c) => c.ok),
      close: close ? { id: close.id, closed_at: close.closed_at, by: close.who, note: close.note } : null,
      adjustments: close ? await postCloseAdjustments(env, book, m, close.closed_at) : [],
      figures: { ...inOut(book, from, to), entries: book.entries.filter((e) => e.eff >= from && e.eff <= to).length },
    });
  }

  if (path === "/gl/pnl") {
    const to = DAY.test(params.get("to") ?? "") ? params.get("to")! : today;
    const from = DAY.test(params.get("from") ?? "") ? params.get("from")! : `${to.slice(0, 7)}-01`;
    if (from > to) return err("validation", "The period starts after it ends", 400);
    /* the comparison: the same number of days straight before - a whole
       calendar month compares with the whole month before it */
    const wholeMonth = from.slice(8) === "01" && to === monthLast(to.slice(0, 7)) && from.slice(0, 7) <= to.slice(0, 7);
    let pFrom: string, pTo: string;
    if (wholeMonth) {
      const span = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
      pFrom = `${shiftMonth(from.slice(0, 7), -span)}-01`; pTo = monthLast(shiftMonth(to.slice(0, 7), -span));
    } else {
      const n = daysBetween(from, to) + 1; pTo = addDays(from, -1); pFrom = addDays(from, -n);
    }
    const now = totals(book, (d) => d >= from && d <= to), before = totals(book, (d) => d >= pFrom && d <= pTo);
    const side = (type: "income" | "expense") => book.accounts.filter((a) => a.type === type).map((a) => ({
      id: a.id, code: a.code, name: a.name, cents: balanceOn(a, now.get(a.id)), prev_cents: balanceOn(a, before.get(a.id)),
    })).filter((r) => r.cents !== 0 || r.prev_cents !== 0);
    const income = side("income"), expense = side("expense");
    const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);
    const sumP = (rows: { prev_cents: number }[]) => rows.reduce((s, r) => s + r.prev_cents, 0);
    return json({
      basis: "cash", period: { from, to }, previous: { from: pFrom, to: pTo },
      income, expense,
      totals: { income_cents: sum(income), expense_cents: sum(expense), net_cents: sum(income) - sum(expense),
        prev_income_cents: sumP(income), prev_expense_cents: sumP(expense), prev_net_cents: sumP(income) - sumP(expense) },
    });
  }

  if (path === "/gl/ledger") {
    const id = Number(params.get("account_id") ?? 0);
    const acc = book.accounts.find((a) => a.id === id);
    if (!acc) return err("not_found", "Account not found", 404);
    const to = DAY.test(params.get("to") ?? "") ? params.get("to")! : today;
    const from = DAY.test(params.get("from") ?? "") ? params.get("from")! : "0000-01-01";
    const page = Math.max(0, Math.min(100000, Number(params.get("page") ?? 0) || 0));
    const sign = normalOf(acc.type) === "debit" ? 1 : -1;
    const mine = book.lines.filter((l) => l.account_id === id).map((l) => ({ l, e: book.entryOf.get(l.entry_id)! })).filter((x) => x.e);
    const opening = mine.filter((x) => x.e.eff < from).reduce((s, x) => s + sign * (x.l.debit_cents - x.l.credit_cents), 0);
    const inRange = mine.filter((x) => x.e.eff >= from && x.e.eff <= to).sort((a, b) => (a.e.eff < b.e.eff ? -1 : a.e.eff > b.e.eff ? 1 : a.l.id - b.l.id));
    let run = opening;
    const rows = inRange.map((x) => {
      run += sign * (x.l.debit_cents - x.l.credit_cents);
      return { line_id: x.l.id, entry_id: x.e.id, ref: x.e.ref, memo: x.e.memo, eff: x.e.eff, source: sourceOf(x.e.ref), debit_cents: x.l.debit_cents, credit_cents: x.l.credit_cents, balance_cents: run };
    });
    return json({
      account: { id: acc.id, code: acc.code, name: acc.name, type: acc.type, normal: normalOf(acc.type) },
      period: { from: from === "0000-01-01" ? null : from, to }, opening_cents: opening, closing_cents: run,
      debit_cents: rows.reduce((s, r) => s + r.debit_cents, 0), credit_cents: rows.reduce((s, r) => s + r.credit_cents, 0),
      lines: rows.slice(page * 50, page * 50 + 50), total: rows.length, page,
    });
  }

  if (path === "/gl/journal") {
    const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 80);
    const source = params.get("source") ?? "";
    const from = params.get("from") ?? "", to = params.get("to") ?? "";
    const page = Math.max(0, Math.min(100000, Number(params.get("page") ?? 0) || 0));
    const reversedBy = new Map<number, number>();
    for (const e of book.entries) { const m = /^REVJ-(\d+)$/.exec(e.ref); if (m) reversedBy.set(Number(m[1]), e.id); }
    const list = [...book.entries]
      .filter((e) => (!source || sourceOf(e.ref) === source)
        && (!DAY.test(from) || e.eff >= from) && (!DAY.test(to) || e.eff <= to)
        && (!q || `${e.ref} ${e.memo} #${e.id}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.eff < b.eff ? 1 : a.eff > b.eff ? -1 : b.id - a.id));
    return json({ entries: list.slice(page * 25, page * 25 + 25).map((e) => ({ ...brief(book, e), reversed_by: reversedBy.get(e.id) ?? null })), total: list.length, page });
  }

  const one = /^\/gl\/journal\/(\d+)$/.exec(path);
  if (one) {
    const e = book.entryOf.get(Number(one[1]));
    if (!e) return err("not_found", "Journal entry not found", 404);
    const accOf = new Map(book.accounts.map((a) => [a.id, a]));
    const lines = (book.byEntry.get(e.id) ?? []).map((l) => ({ account_id: l.account_id, code: accOf.get(l.account_id)?.code ?? "", name: accOf.get(l.account_id)?.name ?? "", type: accOf.get(l.account_id)?.type ?? "", debit_cents: l.debit_cents, credit_cents: l.credit_cents }));
    const kind = sourceOf(e.ref);
    const rev = book.entries.find((x) => x.ref === `REVJ-${e.id}`);
    const of = /^REVJ-(\d+)$/.exec(e.ref);
    /* the source record, in a few words - read from the record itself */
    let detail: Record<string, string | number | null> | null = null;
    try {
      const n = Number((/^[A-Z]+-(\d+)/.exec(e.ref) ?? [])[1] ?? 0);
      if (kind === "sales" && n && e.ref.startsWith("CN-")) {
        /* v1.225.0 - a refund paid back on a credit note */
        const c = await env.DB.prepare(`SELECT cn_number, invoice_number, amount_cents, reason, date(created_at, '+8 hours') AS issued_on FROM credit_notes WHERE id = ?1`).bind(n)
          .first<{ cn_number: string; invoice_number: string | null; amount_cents: number; reason: string | null; issued_on: string }>();
        if (c) detail = { document: c.cn_number, invoice: c.invoice_number, total_cents: c.amount_cents, reason: c.reason, issued_on: c.issued_on };
      } else if (kind === "sales" && n) {
        const d = await env.DB.prepare(`SELECT doc_number, issuer_code, kind, payment_status, date(paid_at, '+8 hours') AS paid_on, total_cents FROM sales_documents WHERE id = ?1`).bind(n)
          .first<{ doc_number: string; issuer_code: string | null; kind: string | null; payment_status: string | null; paid_on: string | null; total_cents: number }>();
        let confirmed: string | null = null;
        try {
          const c = await env.DB.prepare(`SELECT date(confirmed_at, '+8 hours') AS d FROM invoice_paid_confirmations WHERE invoice_id = ?1 AND revoked_at IS NULL`).bind(n).first<{ d: string }>();
          confirmed = c?.d ?? null;
        } catch { /* pre-0145 */ }
        if (d) detail = { document: d.doc_number, issuer: d.issuer_code, kind: d.kind, payment_status: d.payment_status, paid_on: d.paid_on, total_cents: d.total_cents, confirmed_on: confirmed };
      } else if (kind === "expenses" && n) {
        const d = await env.DB.prepare(`SELECT vendor, description, category, expense_date FROM expenses WHERE id = ?1`).bind(n).first<Record<string, string | null>>();
        if (d) detail = { ...d };
      } else if (kind === "claims" && n) {
        const d = await env.DB.prepare(`SELECT c.claim_date, c.category, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS claimant FROM claims c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?1`).bind(n).first<Record<string, string | null>>();
        if (d) detail = { ...d };
      } else if (kind === "payroll") {
        detail = { month: e.ref.slice(8, 15) };
      }
    } catch { detail = null; }
    let reason: string | null = null;
    try {
      const a = await env.DB.prepare(`SELECT detail FROM audit_log WHERE entity = 'journal_entries' AND entity_id = ?1 AND action IN ('erp.journal_create') ORDER BY id DESC LIMIT 1`).bind(String(e.id)).first<{ detail: string }>();
      if (a?.detail) reason = (JSON.parse(a.detail) as { post_close_reason?: string }).post_close_reason ?? null;
    } catch { /* no audit */ }
    return json({
      entry: { ...brief(book, e), credit_cents: lines.reduce((s, l) => s + l.credit_cents, 0) },
      lines, manual: kind === "manual", tab: SOURCE_TAB[kind] ?? null, detail,
      reversed_by: rev ? { id: rev.id, ref: rev.ref, eff: rev.eff } : null,
      reverses: of ? Number(of[1]) : null, post_close_reason: reason,
    });
  }
  return null;
}

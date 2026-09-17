import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { can } from "./permissions";
import { err, json, str } from "./shared";
import { REVIEW_KINDS, isCompanyCode, type ReviewKind, type ReviewRecord, type ReviewDecision, type CompanyMembership } from "../../lib/company-review";

type Source = Record<string, string | number | null> & { id: number };
const LABELS: Record<ReviewKind, string[]> = {
  expenses: ["vendor", "description", "category"], purchase_orders: ["po_no"],
  bank_accounts: ["name", "bank", "number_masked"], cashflow_entries: ["description", "ref", "category"],
  reconciliations: ["order_no", "channel", "customer"], inventory_items: ["sku", "name"],
  manual_stockouts: ["sku", "item_name", "remark"], stock_ledger: ["sku", "reason", "source"],
  journal_entries: ["memo", "ref"],
};
const isKind = (v: string): v is ReviewKind => Object.hasOwn(REVIEW_KINDS, v);
const positiveId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const versionNumber = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const canonical = (row: Source) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
const title = (kind: ReviewKind, row: Source) => LABELS[kind].map(k => row[k]).filter(Boolean).join(" / ").slice(0, 240) || `#${row.id}`;
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
function record(kind: ReviewKind, row: Source, decision: ReviewDecision | null): ReviewRecord {
  return {
    id: row.id, title: title(kind, row), date: String(row.expense_date ?? row.entry_date ?? row.period ?? row.created_at ?? "") || null,
    amount_cents: typeof row.amount_cents === "number" ? row.amount_cents : typeof row.total_cents === "number" ? row.total_cents : null,
    quantity: typeof row.stock === "number" ? row.stock : typeof row.qty === "number" ? row.qty : typeof row.delta === "number" ? row.delta : null,
    state: !decision ? "unassigned" : decision.source_json !== canonical(row) ? "stale" : decision.proposed_company ? "proposed" : "deferred",
    decision,
  };
}
async function decisionFor(env: Env, kind: ReviewKind, id: number) {
  return env.DB.prepare(`SELECT d.*, u.name AS reviewed_by_name FROM company_review_decisions d LEFT JOIN users u ON u.id=d.reviewed_by WHERE d.record_kind=?1 AND d.record_id=?2`)
    .bind(kind, id).first<ReviewDecision>();
}
async function sourceFor(env: Env, kind: ReviewKind, id: number) {
  return env.DB.prepare(`SELECT * FROM ${kind} WHERE id=?1`).bind(id).first<Source>();
}
async function membershipsFor(env: Env, id: number) {
  return (await env.DB.prepare(`SELECT company_code, access_mode FROM company_memberships WHERE user_id=?1 ORDER BY company_code`).bind(id).all<CompanyMembership>()).results;
}

// Only stored foreign keys are relationships. Names, SKU and free-text refs are evidence, never ownership rules.
async function related(env: Env, kind: ReviewKind, source: Source) {
  const links: { kind: ReviewKind; id: number; title: string; proposed_company: string | null; stale: boolean }[] = [];
  let truncated = false;
  const add = async (target: ReviewKind, where: string, value: number) => {
    const rows = (await env.DB.prepare(`SELECT s.*, d.proposed_company AS review_company, d.source_json AS review_snapshot FROM ${target} s LEFT JOIN company_review_decisions d ON d.record_kind=?1 AND d.record_id=s.id WHERE ${where} ORDER BY s.id DESC LIMIT 51`).bind(target, value).all<Source>()).results;
    truncated ||= rows.length > 50;
    for (const row of rows.slice(0, 50)) {
      const { review_company, review_snapshot, ...original } = row;
      links.push({ kind: target, id: row.id, title: title(target, row), proposed_company: typeof review_company === "string" ? review_company : null, stale: typeof review_snapshot === "string" && review_snapshot !== canonical(original) });
    }
  };
  if (kind === "cashflow_entries" && positiveId(source.bank_id)) await add("bank_accounts", "s.id=?2", source.bank_id);
  if (kind === "bank_accounts") await add("cashflow_entries", "s.bank_id=?2", source.id);
  if ((kind === "manual_stockouts" || kind === "stock_ledger") && positiveId(source.item_id)) await add("inventory_items", "s.id=?2", source.item_id);
  if (kind === "inventory_items") {
    await add("manual_stockouts", "s.item_id=?2", source.id);
    await add("stock_ledger", "s.item_id=?2", source.id);
  }
  if (kind === "purchase_orders") {
    let items: unknown;
    try { items = JSON.parse(String(source.items)); } catch { items = null; }
    if (Array.isArray(items)) {
      const ids = [...new Set(items.map(item => item?.inventory_item_id).filter(positiveId))];
      truncated ||= ids.length > 50;
      for (const id of ids.slice(0,50)) await add("inventory_items", "s.id=?2", id);
    }
  }
  return { related: links, related_truncated: truncated };
}

async function replay(env: Env, requestId: string, userId: number, requestJson: string): Promise<Response | null> {
  const prior = await env.DB.prepare(`SELECT actor_id, request_json FROM company_review_events WHERE request_id=?1`).bind(requestId).first<{ actor_id: number; request_json: string }>();
  if (!prior) return null;
  return prior.actor_id === userId && prior.request_json === requestJson ? json({ ok: true, replayed: true }) : err("idempotency_conflict", "This request ID was already used for a different decision", 409);
}
function event(env: Env, user: StaffUser, requestId: string, kind: string, id: number, requestJson: string, before: unknown, after: unknown, guardSql: string, guardArgs: unknown[]) {
  return env.DB.prepare(`INSERT INTO company_review_events (request_id,actor_id,subject_kind,subject_id,request_json,before_json,after_json,guard) VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ${guardSql} THEN 1 ELSE 0 END)`)
    .bind(requestId, user.id, kind, id, requestJson, JSON.stringify(before), JSON.stringify(after), ...guardArgs);
}
function auditStatement(env: Env, user: StaffUser, kind: string, id: number, requestId: string) {
  return env.DB.prepare(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES (?1,'company.review',?2,?3,?4)`)
    .bind(user.id, kind, String(id), JSON.stringify({ request_id: requestId, mode: "reconciliation_only" }));
}

export async function handleCompanyReview(env: Env, url: URL, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser): Promise<Response> {
  if (!can(user.role, "company_review")) return err("forbidden", "Company review requires CEO authorization", 403);
  try {
    // Migration absence is not an empty queue.
    await env.DB.prepare(`SELECT record_id FROM company_review_decisions LIMIT 1`).first();
    if (path === "/records" && method === "GET") {
      const kind = url.searchParams.get("kind") ?? "expenses";
      if (!isKind(kind)) return err("validation", "Unknown record type", 400);
      const page = Number(url.searchParams.get("page") ?? 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return err("validation", "Invalid page", 400);
      const filter = url.searchParams.get("filter") ?? "unassigned";
      if (!["all", "unassigned", "reviewed"].includes(filter)) return err("validation", "Invalid filter", 400);
      const where = filter === "unassigned" ? "AND d.record_id IS NULL" : filter === "reviewed" ? "AND d.record_id IS NOT NULL" : "";
      const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${kind} s LEFT JOIN company_review_decisions d ON d.record_kind=?1 AND d.record_id=s.id WHERE 1=1 ${where}`).bind(kind).first<{ n: number }>();
      const rows = (await env.DB.prepare(`SELECT s.* FROM ${kind} s LEFT JOIN company_review_decisions d ON d.record_kind=?1 AND d.record_id=s.id WHERE 1=1 ${where} ORDER BY s.id DESC LIMIT 25 OFFSET ?2`).bind(kind, page * 25).all<Source>()).results;
      const decisions = (await env.DB.prepare(`SELECT d.*, u.name AS reviewed_by_name FROM company_review_decisions d LEFT JOIN users u ON u.id=d.reviewed_by WHERE d.record_kind=?1 AND d.record_id IN (SELECT s.id FROM ${kind} s LEFT JOIN company_review_decisions q ON q.record_kind=?1 AND q.record_id=s.id WHERE 1=1 ${where.replaceAll("d.", "q.")} ORDER BY s.id DESC LIMIT 25 OFFSET ?2)`).bind(kind, page * 25).all<ReviewDecision & { record_id: number }>()).results;
      return json({ records: rows.map(row => record(kind, row, decisions.find(d => d.record_id === row.id) ?? null)), total: total?.n ?? 0, page, mode: "reconciliation_only" });
    }
    const match = /^\/records\/([a-z_]+)\/(\d+)$/.exec(path);
    if (match && isKind(match[1]!)) {
      const kind = match[1] as ReviewKind, id = Number(match[2]);
      if (!positiveId(id)) return err("validation", "Invalid record ID", 400);
      if (method === "GET") {
        const source = await sourceFor(env, kind, id);
        if (!source) return err("not_found", "Source record no longer exists", 404);
        const decision = await decisionFor(env, kind, id);
        const history = (await env.DB.prepare(`SELECT e.created_at,e.after_json,u.name AS actor_name FROM company_review_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.subject_kind=?1 AND e.subject_id=?2 ORDER BY e.created_at DESC,e.rowid DESC LIMIT 30`).bind(kind, id).all()).results;
        return json({ ...record(kind, source, decision), kind, snapshot: await hash(canonical(source)), source, ...await related(env, kind, source), history });
      }
      if (method === "PUT") {
        if (!str(body?.request_id, 80) || !/^[a-zA-Z0-9-]{16,80}$/.test(body.request_id) || !str(body?.reason, 1000) || body.reason.trim().length < 8 || !versionNumber(body?.version) || typeof body?.snapshot !== "string" || !/^[a-f0-9]{64}$/.test(body.snapshot) || !(body?.proposed_company === null || isCompanyCode(body?.proposed_company))) return err("validation", "Choose a company or defer, and supply a reason of at least 8 characters", 400);
        const requestJson = JSON.stringify({ kind, id, company: body.proposed_company, reason: body.reason.trim(), version: body.version, snapshot: body.snapshot });
        const prior = await replay(env, body.request_id, user.id, requestJson);
        if (prior) return prior;
        const source = await sourceFor(env, kind, id);
        if (!source) return err("not_found", "Source record no longer exists", 404);
        const before = await decisionFor(env, kind, id);
        if ((before?.version ?? 0) !== body.version || await hash(canonical(source)) !== body.snapshot) return err("stale_review", "The source or review changed. Reload it before saving", 409);
        const after = { proposed_company: body.proposed_company, reason: body.reason.trim(), version: body.version + 1, source_json: canonical(source) };
        // The batch checks every source column as well as the review revision, closing the read/write race.
        const entries = Object.entries(source);
        const columns = entries.map(([key]) => `"${key.replaceAll('"', '""')}" IS ?`).join(" AND ");
        const guard = `EXISTS(SELECT 1 FROM ${kind} WHERE ${columns}) AND COALESCE((SELECT version FROM company_review_decisions WHERE record_kind=? AND record_id=?),0)=?`;
        await env.DB.batch([
          event(env, user, body.request_id, kind, id, requestJson, before, after, guard, [...entries.map(([, value]) => value), kind, id, body.version]),
          env.DB.prepare(`INSERT INTO company_review_decisions (record_kind,record_id,proposed_company,source_json,reason,version,reviewed_by) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(record_kind,record_id) DO UPDATE SET proposed_company=excluded.proposed_company,source_json=excluded.source_json,reason=excluded.reason,version=excluded.version,reviewed_by=excluded.reviewed_by,reviewed_at=datetime('now')`).bind(kind, id, after.proposed_company, canonical(source), after.reason, after.version, user.id),
          auditStatement(env, user, kind, id, body.request_id),
        ]);
        return json({ ok: true });
      }
    }
    if (path === "/staff" && method === "GET") {
      const staff = (await env.DB.prepare(`SELECT u.id,u.name,u.role,u.is_active,s.employer_code,COALESCE(s.version,0) AS version FROM users u LEFT JOIN company_staff_setup s ON s.user_id=u.id WHERE u.role!='customer' ORDER BY u.is_active DESC,u.name,u.id`).all()).results;
      const memberships = (await env.DB.prepare(`SELECT user_id,company_code,access_mode FROM company_memberships ORDER BY company_code`).all<CompanyMembership & { user_id: number }>()).results;
      return json({ staff: staff.map(s => ({ ...s, memberships: memberships.filter(m => m.user_id === s.id).map(({ company_code, access_mode }) => ({ company_code, access_mode })) })), mode: "reconciliation_only" });
    }
    const staffMatch = /^\/staff\/(\d+)$/.exec(path);
    if (staffMatch && method === "GET") {
      const id = Number(staffMatch[1]);
      if (!positiveId(id)) return err("validation", "Invalid staff ID", 400);
      const history = (await env.DB.prepare(`SELECT e.created_at,e.after_json,u.name AS actor_name FROM company_review_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.subject_kind='staff' AND e.subject_id=?1 ORDER BY e.created_at DESC,e.rowid DESC LIMIT 30`).bind(id).all()).results;
      return json({ history });
    }
    if (staffMatch && method === "PUT") {
      const id = Number(staffMatch[1]);
      const input = body?.memberships;
      if (!positiveId(id) || !str(body?.request_id,80) || !/^[a-zA-Z0-9-]{16,80}$/.test(body.request_id) || !versionNumber(body?.version) || !str(body?.reason,1000) || body.reason.trim().length < 8 || !(body.employer_code === null || isCompanyCode(body.employer_code)) || !Array.isArray(input) || input.length > 2) return err("validation", "Employer, memberships, revision and reason are required", 400);
      const memberships: CompanyMembership[] = [];
      for (const m of input) {
        if (!m || !isCompanyCode(m.company_code) || !["read","write"].includes(m.access_mode) || memberships.some(p => p.company_code === m.company_code)) return err("validation", "Invalid or duplicate company membership", 400);
        memberships.push({ company_code: m.company_code, access_mode: m.access_mode });
      }
      memberships.sort((a, b) => a.company_code.localeCompare(b.company_code));
      const requestJson = JSON.stringify({ kind: "staff", id, employer_code: body.employer_code, memberships, version: body.version, reason: body.reason.trim() });
      const prior = await replay(env, body.request_id, user.id, requestJson);
      if (prior) return prior;
      const employee = await env.DB.prepare(`SELECT id FROM users WHERE id=?1 AND role!='customer'`).bind(id).first();
      if (!employee) return err("not_found", "Staff member not found", 404);
      const setup = await env.DB.prepare(`SELECT employer_code,version FROM company_staff_setup WHERE user_id=?1`).bind(id).first<{ employer_code: string | null; version: number }>();
      if ((setup?.version ?? 0) !== body.version) return err("stale_review", "Staff setup changed. Reload before saving", 409);
      const before = { employer_code: setup?.employer_code ?? null, memberships: await membershipsFor(env,id), version: setup?.version ?? 0 };
      const after = { employer_code: body.employer_code, memberships, version: body.version + 1, reason: body.reason.trim() };
      await env.DB.batch([
        event(env,user,body.request_id,"staff",id,requestJson,before,after,`EXISTS(SELECT 1 FROM users WHERE id=? AND role!='customer') AND COALESCE((SELECT version FROM company_staff_setup WHERE user_id=?),0)=?`,[id,id,body.version]),
        env.DB.prepare(`INSERT INTO company_staff_setup (user_id,employer_code,version,updated_by) VALUES (?1,?2,?3,?4) ON CONFLICT(user_id) DO UPDATE SET employer_code=excluded.employer_code,version=excluded.version,updated_by=excluded.updated_by,updated_at=datetime('now')`).bind(id,after.employer_code,after.version,user.id),
        env.DB.prepare(`DELETE FROM company_memberships WHERE user_id=?1`).bind(id),
        ...memberships.map(m => env.DB.prepare(`INSERT INTO company_memberships (user_id,company_code,access_mode) VALUES (?1,?2,?3)`).bind(id,m.company_code,m.access_mode)),
        auditStatement(env,user,"staff",id,body.request_id),
      ]);
      return json({ ok: true });
    }
    return err("not_found", "Company review endpoint not found", 404);
  } catch (e) {
    if (/company_review_fresh|UNIQUE constraint failed: company_review_events/.test(String(e))) return err("stale_review", "Another change was saved. Reload before trying again", 409);
    if (/no such table|no such column/.test(String(e))) return err("migration_missing", "Company review migration 0134 is required", 503);
    console.error("company_review_failed", e);
    return err("review_failed", "The review could not be saved or loaded. No partial decision was committed", 500);
  }
}

import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { can } from "./permissions";
import { err, json, str } from "./shared";
import { COMPANY_CODES, COMPANY_NAMES, REVIEW_KINDS, isCompanyCode, type ReviewKind, type ReviewRecord, type ReviewDecision, type CompanyMembership } from "../../lib/company-review";

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
/* v1.221.0 - who the record is with, and its category, for the table and
   search (evidence on screen - never used to infer the owner) */
const PARTY = ["vendor", "customer", "supplier_name", "channel", "bank"];
const CATEGORY = ["category", "reason", "source"];
const firstOf = (row: Source, keys: string[]) => { for (const k of keys) { const v = row[k]; if (v !== null && v !== undefined && v !== "") return String(v); } return null; };
function record(kind: ReviewKind, row: Source, decision: ReviewDecision | null): ReviewRecord {
  return {
    party: firstOf(row, PARTY), category: firstOf(row, CATEGORY),
    id: row.id, title: title(kind, row), date: String(row.effective_date ?? row.expense_date ?? row.entry_date ?? row.out_date ?? row.period ?? row.created_at ?? "") || null,
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
    /* ================= v1.221.0 - Companies 2.0 (the owner's answers,
       28-10-2026: "Build the 3 tabs", "Bulk with preview", "Checklist now,
       enforce later", "Count them, read-only"). Read-only figures, the
       company-wide history, and a bulk review that is the single review
       repeated - one guarded event per record, all or nothing. ============ */
    if (path === "/summary" && method === "GET") {
      const registers: { kind: ReviewKind; total: number; unassigned: number; proposed: number; deferred: number; stale: number; by_company: Record<string, number> }[] = [];
      for (const kind of Object.keys(REVIEW_KINDS) as ReviewKind[]) {
        const rows = (await env.DB.prepare(`SELECT s.* FROM ${kind} s`).all<Source>().catch(() => ({ results: [] as Source[] }))).results ?? [];
        const decisions = (await env.DB.prepare(`SELECT record_id, proposed_company, source_json FROM company_review_decisions WHERE record_kind=?1`).bind(kind).all<{ record_id: number; proposed_company: string | null; source_json: string }>()).results ?? [];
        const byId = new Map(decisions.map(d => [d.record_id, d]));
        const reg = { kind, total: rows.length, unassigned: 0, proposed: 0, deferred: 0, stale: 0, by_company: {} as Record<string, number> };
        for (const row of rows) {
          const d = byId.get(row.id);
          if (!d) { reg.unassigned++; continue; }
          if (d.source_json !== canonical(row)) { reg.stale++; continue; }
          if (d.proposed_company) { reg.proposed++; reg.by_company[d.proposed_company] = (reg.by_company[d.proposed_company] ?? 0) + 1; }
          else reg.deferred++;
        }
        registers.push(reg);
      }
      const staff = (await env.DB.prepare(`SELECT u.id, u.role, s.employer_code, (SELECT COUNT(*) FROM company_memberships m WHERE m.user_id=u.id) AS memberships,
          (SELECT COUNT(*) FROM company_memberships m WHERE m.user_id=u.id AND m.access_mode='write') AS writes
        FROM users u LEFT JOIN company_staff_setup s ON s.user_id=u.id WHERE u.role!='customer' AND u.is_active=1`).all<{ id: number; role: string; employer_code: string | null; memberships: number; writes: number }>()).results ?? [];
      /* documents already stamped with their company when issued - counted
         only, never reviewed or changed here */
      const stamped: { register: string; company: string; n: number }[] = [];
      const count = async (register: string, sql: string) => {
        try { for (const r of (await env.DB.prepare(sql).all<{ company: string; n: number }>()).results ?? []) stamped.push({ register, company: r.company, n: r.n }); } catch { /* register not in this database */ }
      };
      await count("invoices", `SELECT COALESCE(issuer_code,'legacy') AS company, COUNT(*) AS n FROM sales_documents WHERE doc_type='INV' GROUP BY 1`);
      await count("quotations", `SELECT COALESCE(issuer_code,'legacy') AS company, COUNT(*) AS n FROM sales_documents WHERE doc_type='QT' GROUP BY 1`);
      await count("delivery_orders", `SELECT COALESCE(issuer_code,'legacy') AS company, COUNT(*) AS n FROM sales_documents WHERE doc_type='DO' GROUP BY 1`);
      await count("receipts", `SELECT COALESCE(issuer_code,'legacy') AS company, COUNT(*) AS n FROM receipts GROUP BY 1`);
      await count("credit_notes", `SELECT COALESCE(issuer_code,'legacy') AS company, COUNT(*) AS n FROM credit_notes GROUP BY 1`);
      await count("claims", `SELECT COALESCE(issuer_code,'legacy') AS company, COUNT(*) AS n FROM claims GROUP BY 1`);
      await count("payslip_months", `SELECT COALESCE(issuer_code,'legacy') AS company, COUNT(*) AS n FROM payslip_releases GROUP BY 1`);
      const sum = (k: "unassigned" | "proposed" | "deferred" | "stale") => registers.reduce((a, r) => a + r[k], 0);
      const mgmt = staff.filter(s => ["ceo", "coo", "super_admin"].includes(s.role));
      const checklist = [
        { key: "reviewed", done: sum("unassigned") === 0, detail: `${sum("unassigned")}` },
        /* v1.221.1 - "nothing deferred or changed" is only met once there is
           something reviewed to settle: with every record unreviewed it was
           counted done, and the page read "1 of 9 readiness steps" */
        { key: "settled", done: sum("unassigned") === 0 && sum("stale") === 0 && sum("deferred") === 0, detail: `${sum("stale")}/${sum("deferred")}` },
        { key: "staff_setup", done: staff.length > 0 && staff.every(s => s.employer_code && s.memberships > 0), detail: `${staff.filter(s => s.employer_code && s.memberships > 0).length}/${staff.length}` },
        { key: "management", done: mgmt.length > 0 && mgmt.every(s => s.writes >= 2), detail: `${mgmt.filter(s => s.writes >= 2).length}/${mgmt.length}` },
        { key: "ownership_columns", done: false, detail: "not_built" },
        { key: "scoped_queries", done: false, detail: "not_built" },
        { key: "jobs_scope", done: false, detail: "not_built" },
        { key: "pilot", done: false, detail: "not_run" },
        { key: "rollback_switch", done: false, detail: "not_built" },
      ];
      return json({
        companies: COMPANY_CODES.map(code => ({ code, name: COMPANY_NAMES[code] })),
        registers,
        totals: { unassigned: sum("unassigned"), proposed: sum("proposed"), deferred: sum("deferred"), stale: sum("stale"), pending: sum("proposed") + sum("deferred") + sum("stale") },
        staff: { active: staff.length, with_employer: staff.filter(s => s.employer_code).length, with_access: staff.filter(s => s.memberships > 0).length, without_access: staff.filter(s => s.memberships === 0).length },
        stamped, checklist, enforcement: "not_active", mode: "reconciliation_only",
      });
    }
    if (path === "/events" && method === "GET") {
      const page = Number(url.searchParams.get("page") ?? 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return err("validation", "Invalid page", 400);
      const type = url.searchParams.get("type") ?? "all";
      if (!["all", "ownership", "staff"].includes(type)) return err("validation", "Invalid activity type", 400);
      const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
      const day = /^\d{4}-\d{2}-\d{2}$/;
      const where: string[] = [];
      const args: unknown[] = [];
      if (type === "staff") where.push(`e.subject_kind = 'staff'`);
      if (type === "ownership") where.push(`e.subject_kind != 'staff'`);
      if (day.test(from)) { args.push(from); where.push(`date(e.created_at, '+8 hours') >= ?${args.length}`); }
      if (day.test(to)) { args.push(to); where.push(`date(e.created_at, '+8 hours') <= ?${args.length}`); }
      const sql = `FROM company_review_events e LEFT JOIN users u ON u.id = e.actor_id LEFT JOIN users w ON e.subject_kind = 'staff' AND w.id = e.subject_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
      const total = await env.DB.prepare(`SELECT COUNT(*) AS n ${sql}`).bind(...args).first<{ n: number }>();
      const rows = (await env.DB.prepare(`SELECT e.rowid AS seq, e.created_at, e.subject_kind, e.subject_id, e.before_json, e.after_json, u.name AS actor_name, w.name AS staff_name ${sql} ORDER BY e.created_at DESC, e.rowid DESC LIMIT 25 OFFSET ?${args.length + 1}`).bind(...args, page * 25).all()).results ?? [];
      return json({ events: rows, total: total?.n ?? 0, page, mode: "reconciliation_only" });
    }
    if (path === "/records/bulk" && method === "PUT") {
      const kind = typeof body?.kind === "string" && isKind(body.kind) ? body.kind as ReviewKind : null;
      const items = Array.isArray(body?.items) ? body!.items as { id?: unknown; snapshot?: unknown; version?: unknown }[] : [];
      if (!kind || items.length === 0 || items.length > 100 || !str(body?.request_id, 60) || !/^[a-zA-Z0-9-]{16,60}$/.test(body!.request_id as string)
        || !str(body?.reason, 1000) || (body!.reason as string).trim().length < 8 || !(body?.proposed_company === null || isCompanyCode(body?.proposed_company))
        || !items.every(i => positiveId(i.id) && typeof i.snapshot === "string" && /^[a-f0-9]{64}$/.test(i.snapshot) && versionNumber(i.version))
        || new Set(items.map(i => i.id)).size !== items.length) {
        return err("validation", "Choose records of one register, a company or defer, and a reason of at least 8 characters", 400);
      }
      const reason = (body!.reason as string).trim();
      const company = body!.proposed_company as string | null;
      const requestOf = (i: { id?: unknown; snapshot?: unknown; version?: unknown }) => JSON.stringify({ kind, id: i.id, company, reason, version: i.version, snapshot: i.snapshot, bulk: true });
      /* a retry of a save that already went through answers "done" before the
         records are re-checked (their versions have moved on since) - only
         for the same person and the very same decision */
      if (body?.dry_run !== true) {
        const prior = (await env.DB.prepare(`SELECT actor_id, subject_id, request_json FROM company_review_events WHERE request_id LIKE ?1`).bind(`${body!.request_id}-%`).all<{ actor_id: number; subject_id: number; request_json: string }>()).results ?? [];
        if (prior.length > 0) {
          const same = prior.length === items.length && prior.every(p => p.actor_id === user.id && items.some(i => i.id === p.subject_id && requestOf(i) === p.request_json));
          return same ? json({ ok: true, replayed: true, count: prior.length }) : err("idempotency_conflict", "This request ID was already used for a different decision", 409);
        }
      }
      const checked: { id: number; source: Source; before: ReviewDecision | null; version: number; requestJson: string; rid: string }[] = [];
      let total = 0;
      for (const i of items) {
        const id = i.id as number;
        const source = await sourceFor(env, kind, id);
        if (!source) return err("not_found", `Record #${id} no longer exists`, 404);
        const before = await decisionFor(env, kind, id);
        if ((before?.version ?? 0) !== i.version || await hash(canonical(source)) !== i.snapshot) return err("stale_review", `Record #${id} changed since it was listed. Reload before saving`, 409);
        const rid = `${body!.request_id}-${id}`;
        const requestJson = requestOf(i);
        checked.push({ id, source, before, version: i.version as number, requestJson, rid });
        total += typeof source.amount_cents === "number" ? source.amount_cents : typeof source.total_cents === "number" ? source.total_cents : 0;
      }
      /* the impact preview: what would be saved, nothing written */
      if (body?.dry_run === true) return json({ ok: true, dry_run: true, count: checked.length, total_cents: total, company });
      const statements = [];
      for (const c of checked) {
        const after = { proposed_company: company, reason, version: c.version + 1, source_json: canonical(c.source), bulk: true };
        const entries = Object.entries(c.source);
        const columns = entries.map(([key]) => `"${key.replaceAll('"', '""')}" IS ?`).join(" AND ");
        const guard = `EXISTS(SELECT 1 FROM ${kind} WHERE ${columns}) AND COALESCE((SELECT version FROM company_review_decisions WHERE record_kind=? AND record_id=?),0)=?`;
        statements.push(
          event(env, user, c.rid, kind, c.id, c.requestJson, c.before, after, guard, [...entries.map(([, value]) => value), kind, c.id, c.version]),
          env.DB.prepare(`INSERT INTO company_review_decisions (record_kind,record_id,proposed_company,source_json,reason,version,reviewed_by) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(record_kind,record_id) DO UPDATE SET proposed_company=excluded.proposed_company,source_json=excluded.source_json,reason=excluded.reason,version=excluded.version,reviewed_by=excluded.reviewed_by,reviewed_at=datetime('now')`).bind(kind, c.id, company, canonical(c.source), reason, after.version, user.id),
          auditStatement(env, user, kind, c.id, c.rid),
        );
      }
      await env.DB.batch(statements);
      return json({ ok: true, count: checked.length, total_cents: total });
    }
    if (path === "/records" && method === "GET") {
      const kind = url.searchParams.get("kind") ?? "expenses";
      if (!isKind(kind)) return err("validation", "Unknown record type", 400);
      const page = Number(url.searchParams.get("page") ?? 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return err("validation", "Invalid page", 400);
      const filter = url.searchParams.get("filter") ?? "unassigned";
      if (!["all", "unassigned", "reviewed"].includes(filter)) return err("validation", "Invalid filter", 400);
      /* v1.221.0 - by state (proposed / deferred / changed need the snapshot
         compared, so they are filtered here, not in SQL), search and dates */
      const state = url.searchParams.get("state");
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
      const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
      if (state !== null && !["all", "unassigned", "proposed", "deferred", "stale"].includes(state)) return err("validation", "Invalid state", 400);
      if (state !== null || q || from || to) {
        const all = (await env.DB.prepare(`SELECT s.* FROM ${kind} s ORDER BY s.id DESC LIMIT 20000`).all<Source>()).results ?? [];
        const decided = (await env.DB.prepare(`SELECT d.*, u.name AS reviewed_by_name FROM company_review_decisions d LEFT JOIN users u ON u.id=d.reviewed_by WHERE d.record_kind=?1`).bind(kind).all<ReviewDecision & { record_id: number }>()).results ?? [];
        const byId = new Map(decided.map(d => [d.record_id, d]));
        const list = all.map(row => record(kind, row, byId.get(row.id) ?? null)).filter(r =>
          (!state || state === "all" || r.state === state)
          && (!q || `${r.title} ${r.party ?? ""} ${r.category ?? ""} #${r.id}`.toLowerCase().includes(q))
          && (!/^\d{4}-\d{2}-\d{2}$/.test(from) || (r.date ?? "").slice(0, 10) >= from)
          && (!/^\d{4}-\d{2}-\d{2}$/.test(to) || ((r.date ?? "").slice(0, 10) !== "" && (r.date ?? "").slice(0, 10) <= to)));
        const shown = list.slice(page * 25, page * 25 + 25);
        const rowOf = new Map(all.map(row => [row.id, row]));
        return json({ records: await Promise.all(shown.map(async r => ({ ...r, snapshot: await hash(canonical(rowOf.get(r.id)!)) }))), total: list.length, page, mode: "reconciliation_only" });
      }
      const where = filter === "unassigned" ? "AND d.record_id IS NULL" : filter === "reviewed" ? "AND d.record_id IS NOT NULL" : "";
      const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${kind} s LEFT JOIN company_review_decisions d ON d.record_kind=?1 AND d.record_id=s.id WHERE 1=1 ${where}`).bind(kind).first<{ n: number }>();
      const rows = (await env.DB.prepare(`SELECT s.* FROM ${kind} s LEFT JOIN company_review_decisions d ON d.record_kind=?1 AND d.record_id=s.id WHERE 1=1 ${where} ORDER BY s.id DESC LIMIT 25 OFFSET ?2`).bind(kind, page * 25).all<Source>()).results;
      const decisions = (await env.DB.prepare(`SELECT d.*, u.name AS reviewed_by_name FROM company_review_decisions d LEFT JOIN users u ON u.id=d.reviewed_by WHERE d.record_kind=?1 AND d.record_id IN (SELECT s.id FROM ${kind} s LEFT JOIN company_review_decisions q ON q.record_kind=?1 AND q.record_id=s.id WHERE 1=1 ${where.replaceAll("d.", "q.")} ORDER BY s.id DESC LIMIT 25 OFFSET ?2)`).bind(kind, page * 25).all<ReviewDecision & { record_id: number }>()).results;
      /* v1.221.0 - each row carries its evidence snapshot, so a bulk review
         is refused if any record changed after it was listed */
      return json({ records: await Promise.all(rows.map(async row => ({ ...record(kind, row, decisions.find(d => d.record_id === row.id) ?? null), snapshot: await hash(canonical(row)) }))), total: total?.n ?? 0, page, mode: "reconciliation_only" });
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
      /* v1.221.1 - the evidence already in the portal: the employer printed on
         each person's latest released payslip (payslip_releases.issuer_code;
         an unstamped month prints AZ ONE OFFICIAL, as the payslip renderer
         does). Shown and offered as a suggestion only - never saved without
         a person confirming it with a reason. */
      const payslips = new Map<number, { month: string; company: string }>();
      try {
        const rows = (await env.DB.prepare(`SELECT p.user_id, r.month, r.issuer_code FROM payroll_entries p JOIN payslip_releases r ON r.month = p.month
          WHERE r.month = (SELECT MAX(r2.month) FROM payroll_entries p2 JOIN payslip_releases r2 ON r2.month = p2.month WHERE p2.user_id = p.user_id)`).all<{ user_id: number; month: string; issuer_code: string | null }>()).results ?? [];
        for (const r of rows) payslips.set(r.user_id, { month: r.month, company: isCompanyCode(r.issuer_code) ? r.issuer_code : "azoo" });
      } catch { /* no payroll tables in this database - no evidence to show */ }
      return json({ staff: staff.map(s => ({ ...s, payslip: payslips.get(s.id as number) ?? null, memberships: memberships.filter(m => m.user_id === s.id).map(({ company_code, access_mode }) => ({ company_code, access_mode })) })), mode: "reconciliation_only" });
    }
    /* v1.221.1 - staff setup for several people at once (the owner's answer,
       28-10-2026: "Suggest + bulk"): the single setup repeated - one employer,
       one access plan or "keep each person's", one reason; a dry run that
       writes nothing; one guarded event + setup + audit per person in one
       batch, all or nothing. Planning data only - nothing is enforced. */
    if (path === "/staff/bulk" && method === "PUT") {
      const items = Array.isArray(body?.items) ? body!.items as { id?: unknown; version?: unknown }[] : [];
      const keep = body?.memberships === null;
      const input = body?.memberships;
      if (items.length === 0 || items.length > 50 || !str(body?.request_id, 60) || !/^[a-zA-Z0-9-]{16,60}$/.test(body!.request_id as string)
        || !str(body?.reason, 1000) || (body!.reason as string).trim().length < 8 || !(body?.employer_code === null || isCompanyCode(body?.employer_code))
        || !(keep || (Array.isArray(input) && input.length <= 2))
        || !items.every(i => positiveId(i.id) && versionNumber(i.version)) || new Set(items.map(i => i.id)).size !== items.length) {
        return err("validation", "Choose staff, an employer or unassigned, an access plan, and a reason of at least 8 characters", 400);
      }
      const memberships: CompanyMembership[] = [];
      if (!keep) for (const m of input as { company_code?: unknown; access_mode?: unknown }[]) {
        if (!m || !isCompanyCode(m.company_code) || !["read", "write"].includes(m.access_mode as string) || memberships.some(p => p.company_code === m.company_code)) return err("validation", "Invalid or duplicate company membership", 400);
        memberships.push({ company_code: m.company_code, access_mode: m.access_mode as "read" | "write" });
      }
      memberships.sort((a, b) => a.company_code.localeCompare(b.company_code));
      const reason = (body!.reason as string).trim();
      const employer = body!.employer_code as string | null;
      const requestOf = (i: { id?: unknown; version?: unknown }) => JSON.stringify({ kind: "staff", id: i.id, employer_code: employer, memberships: keep ? "keep" : memberships, version: i.version, reason, bulk: true });
      if (body?.dry_run !== true) {
        const prior = (await env.DB.prepare(`SELECT actor_id, subject_id, request_json FROM company_review_events WHERE request_id LIKE ?1`).bind(`${body!.request_id}-%`).all<{ actor_id: number; subject_id: number; request_json: string }>()).results ?? [];
        if (prior.length > 0) {
          const same = prior.length === items.length && prior.every(p => p.actor_id === user.id && items.some(i => i.id === p.subject_id && requestOf(i) === p.request_json));
          return same ? json({ ok: true, replayed: true, count: prior.length }) : err("idempotency_conflict", "This request ID was already used for a different setup", 409);
        }
      }
      const checked: { id: number; name: string; version: number; before: { employer_code: string | null; memberships: CompanyMembership[]; version: number }; after: { employer_code: string | null; memberships: CompanyMembership[]; version: number; reason: string; bulk: true } }[] = [];
      for (const i of items) {
        const id = i.id as number;
        const employee = await env.DB.prepare(`SELECT id, name FROM users WHERE id=?1 AND role!='customer'`).bind(id).first<{ id: number; name: string }>();
        if (!employee) return err("not_found", `Staff member #${id} not found`, 404);
        const setup = await env.DB.prepare(`SELECT employer_code,version FROM company_staff_setup WHERE user_id=?1`).bind(id).first<{ employer_code: string | null; version: number }>();
        if ((setup?.version ?? 0) !== i.version) return err("stale_review", `${employee.name}'s setup changed since it was listed. Reload before saving`, 409);
        const current = await membershipsFor(env, id);
        checked.push({ id, name: employee.name, version: i.version as number,
          before: { employer_code: setup?.employer_code ?? null, memberships: current, version: setup?.version ?? 0 },
          after: { employer_code: employer, memberships: keep ? current : memberships, version: (i.version as number) + 1, reason, bulk: true } });
      }
      if (body?.dry_run === true) return json({ ok: true, dry_run: true, count: checked.length, changes: checked.map(c => ({ id: c.id, name: c.name, from: c.before.employer_code, to: c.after.employer_code, memberships_from: c.before.memberships, memberships_to: c.after.memberships })) });
      const statements = [];
      for (const c of checked) {
        const rid = `${body!.request_id}-${c.id}`;
        statements.push(
          event(env, user, rid, "staff", c.id, requestOf({ id: c.id, version: c.version }), c.before, c.after, `EXISTS(SELECT 1 FROM users WHERE id=? AND role!='customer') AND COALESCE((SELECT version FROM company_staff_setup WHERE user_id=?),0)=?`, [c.id, c.id, c.version]),
          env.DB.prepare(`INSERT INTO company_staff_setup (user_id,employer_code,version,updated_by) VALUES (?1,?2,?3,?4) ON CONFLICT(user_id) DO UPDATE SET employer_code=excluded.employer_code,version=excluded.version,updated_by=excluded.updated_by,updated_at=datetime('now')`).bind(c.id, c.after.employer_code, c.after.version, user.id),
          env.DB.prepare(`DELETE FROM company_memberships WHERE user_id=?1`).bind(c.id),
          ...c.after.memberships.map(m => env.DB.prepare(`INSERT INTO company_memberships (user_id,company_code,access_mode) VALUES (?1,?2,?3)`).bind(c.id, m.company_code, m.access_mode)),
          auditStatement(env, user, "staff", c.id, rid),
        );
      }
      await env.DB.batch(statements);
      return json({ ok: true, count: checked.length });
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

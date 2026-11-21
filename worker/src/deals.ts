/**
 * THE SALES PIPELINE - v1.399.0, Sales Command Center Phase 3 (the CEO, 21-11-2026: decisions 1
 * and 4, and "As recommended" on the seven Phase 3 decisions). Migration 0227.
 *
 * A deal (sales_opportunities) is the work of winning one piece of business from one customer.
 * It is kept APART from the money: a deal never writes a quotation, an invoice, a payment, a
 * verification, the closer or commission, and Won is never revenue. Its value is counted once
 * (lib/pipeline-words.ts dealValue): the newest linked quotation's latest total, or the
 * estimate while none is linked.
 *
 *   GET  /deals/options                 stages, lost reasons, services (names only), owners, rights
 *   GET  /deals?scope=&q=&owner=&stage=&priority=&customer=
 *                                          the deals (open ones, and those closed in 30 days)
 *   GET  /deals/:id                     one deal: quotations, candidates to link, stage history
 *   POST /deals                         a new deal (client_key: a double press is one deal)
 *   PUT  /deals/:id                     edit (owner or a manager; the owner only by crm_assign)
 *   POST /deals/:id/move                to an open stage (a move is confirmed by version)
 *   POST /deals/:id/won                 only with an acceptance of the current revision, a live
 *                                          invoice made from a linked quotation, or an override
 *                                          (pipeline_override) with a written reason
 *   POST /deals/:id/lost                with a reason from the list (Other needs words)
 *   POST /deals/:id/reopen              pipeline_override, with a reason
 *   POST /deals/:id/link | /unlink      a quotation of the same customer; one deal per quotation
 *   GET  /deals/suggestions             crm_assign: an open quotation without a deal, as a deal
 *   POST /deals/suggestions/confirm     crm_assign: make the ticked ones (once per quotation)
 *
 * WHO (decision 2, option A): everyone with Sales reads every deal; a deal is edited by its owner
 * or a manager (crm_assign); agents and customers are refused by role before anything is read.
 */
import type { Env } from "./index";
import { notify, currentStaffSql, type StaffUser } from "./staff";
import { can, canUser } from "./permissions";
import { audit, err, json, str } from "./shared";
import { LOST_REASONS, OPEN_STAGES, STUCK_DAYS, dealValue, type DealQuote } from "../../lib/pipeline-words";

const NAME = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const missing = (e: unknown) => /no such (table|column)/i.test(String(e));
const changed = () => err("changed", "Someone changed this deal a moment ago. Open it again and retry.", 409);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
interface Body { [k: string]: unknown }

/** people who may own a deal: current staff whose role holds Sales (the CRM's rule) */
async function owners(env: Env): Promise<{ id: number; name: string; role: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, ${NAME("u")} AS name, role FROM users u
      WHERE u.is_active = 1 AND (u.role NOT IN ('customer', 'agent') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)) AND ${currentStaffSql("u.")}
      ORDER BY name`,
  ).all<{ id: number; name: string; role: string }>();
  return (results ?? []).filter((u) => can(u.role, "sales"));
}

/** the quotations a deal is quoted with, each with whether its CURRENT revision is accepted and whether a live invoice was made from it */
export async function quotesOf(env: Env, ids: number[]) { // v1.403.0 - also read by sales-reports.ts
  if (!ids.length) return new Map<number, (DealQuote & { doc_number: string; accepted: boolean; invoiced: boolean; opportunity_id: number })[]>();
  const { results } = await env.DB.prepare(
    `SELECT l.opportunity_id, d.id, d.doc_number, COALESCE(d.revision, 0) AS revision, d.total_cents, d.created_at, l.linked_at, l.origin,
            EXISTS (SELECT 1 FROM quotation_acceptances a WHERE a.doc_id = d.id AND a.revision = COALESCE(d.revision, 0)) AS accepted,
            EXISTS (SELECT 1 FROM sales_documents i WHERE i.doc_type = 'INV' AND i.converted_from = d.id AND COALESCE(i.payment_status, '') != 'void' AND i.voided_at IS NULL) AS invoiced
       FROM opportunity_quotations l JOIN sales_documents d ON d.id = l.doc_id
      WHERE l.unlinked_at IS NULL AND l.opportunity_id IN (${ids.map(() => "?").join(",")})
      ORDER BY d.created_at DESC, d.id DESC`,
  ).bind(...ids).all<DealQuote & { opportunity_id: number; doc_number: string; accepted: number; invoiced: number }>();
  const out = new Map<number, (DealQuote & { doc_number: string; accepted: boolean; invoiced: boolean; opportunity_id: number })[]>();
  for (const r of results ?? []) {
    const list = out.get(r.opportunity_id) ?? [];
    list.push({ ...r, accepted: !!r.accepted, invoiced: !!r.invoiced });
    out.set(r.opportunity_id, list);
  }
  return out;
}

type DealRow = Record<string, unknown> & { id: number; stage: string; closed_at: string | null; est_value_cents: number | null; stage_since: string; last_activity_at: string | null; next_action_on: string | null; customer_last: string | null };
const ts = (s: string | null | undefined) => (s ? Date.parse(s.replace(" ", "T") + (/[zZ]$/.test(s) ? "" : "Z")) || 0 : 0);

async function shape(env: Env, rows: DealRow[]) {
  const quotes = await quotesOf(env, rows.map((r) => r.id));
  const today = mytToday();
  const now = Date.now();
  return rows.map((r) => {
    const q = quotes.get(r.id) ?? [];
    const v = dealValue(r.est_value_cents, q);
    const open = (OPEN_STAGES as readonly string[]).includes(r.stage);
    const lastMove = Math.max(ts(r.stage_since), ts(r.last_activity_at), ts(r.customer_last));
    return {
      ...r,
      quotes: q.map(({ opportunity_id: _o, ...x }) => x),
      value_cents: v.cents, value_basis: v.basis,
      days_in_stage: Math.max(0, Math.floor((now - ts(r.stage_since)) / 86400000)),
      stuck: open && now - lastMove >= STUCK_DAYS * 86400000,
      next_late: open && !!r.next_action_on && r.next_action_on < today,
      next_today: open && r.next_action_on === today,
      no_next: open && !r.next_action_on,
    };
  });
}

const DEAL_SQL = `SELECT o.*, c.company AS customer, c.phone AS customer_phone, ${NAME("u")} AS owner_name,
    (SELECT MAX(a.occurred_at) FROM sales_activities a WHERE a.customer_id = o.customer_id) AS customer_last
  FROM sales_opportunities o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.owner_id`;

async function cleanService(env: Env, v: unknown): Promise<string | null | Response> {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return err("invalid_input", "A service is a package or other words.", 400);
  const m = /^pkg:(\d+)$/.exec(v);
  if (m) {
    const p = await env.DB.prepare(`SELECT id FROM sales_packages WHERE id = ?1`).bind(Number(m[1])).first();
    return p ? v : err("invalid_input", "That package is not in the Packages library.", 400);
  }
  if (v.startsWith("other:") && v.slice(6).trim().length >= 2 && v.length <= 66) return `other:${v.slice(6).trim()}`;
  return err("invalid_input", "A service is a package or other words.", 400);
}
function cents(v: unknown): number | null | "bad" {
  if (v == null || v === "") return null;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100_000_000 ? Math.round(v) : "bad";
}
const day = (v: unknown): string | null | "bad" => (v == null || v === "" ? null : typeof v === "string" && DAY.test(v) ? v : "bad");

/** decision 3: an open quotation with no deal, offered as one (owner = its salesperson) */
async function suggestions(env: Env) {
  const today = mytToday();
  const { results } = await env.DB.prepare(
    `SELECT d.id AS doc_id, d.doc_number, d.customer_id, c.company, d.total_cents, d.created_at, d.salesperson_id AS owner_id, ${NAME("u")} AS owner_name, u.role AS owner_role,
            EXISTS (SELECT 1 FROM quotation_acceptances a WHERE a.doc_id = d.id AND a.revision = COALESCE(d.revision, 0)) AS accepted,
            (SELECT f.outcome FROM customer_followups f WHERE f.doc_id = d.id AND f.done_at IS NOT NULL ORDER BY f.done_at DESC, f.id DESC LIMIT 1) AS last_outcome
       FROM sales_documents d JOIN customers c ON c.id = d.customer_id JOIN users u ON u.id = d.salesperson_id
      WHERE d.doc_type = 'QT' AND d.created_at >= datetime('now', '-365 days')
        AND (d.valid_until IS NULL OR d.valid_until >= ?1)
        AND NOT EXISTS (SELECT 1 FROM sales_documents i WHERE i.doc_type = 'INV' AND i.converted_from = d.id AND COALESCE(i.payment_status, '') != 'void' AND i.voided_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM sales_documents r WHERE r.doc_type = 'QT' AND r.converted_from = d.id)
        AND NOT EXISTS (SELECT 1 FROM opportunity_quotations l WHERE l.doc_id = d.id AND l.unlinked_at IS NULL)
        AND u.is_active = 1 AND u.role NOT IN ('customer', 'agent') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0) AND ${currentStaffSql("u.")}
      ORDER BY d.created_at DESC LIMIT 500`,
  ).bind(today).all<{ doc_id: number; doc_number: string; customer_id: number; company: string; total_cents: number; created_at: string; owner_id: number; owner_name: string; owner_role: string; accepted: number; last_outcome: string | null }>();
  return (results ?? []).filter((s) => can(s.owner_role, "sales")).map(({ owner_role: _r, accepted, last_outcome, ...s }) => ({
    ...s, accepted: !!accepted, stage: accepted || last_outcome === "negotiating" || last_outcome === "accepted" ? "negotiation" : "proposal",
  }));
}

export async function handlePipeline(env: Env, path: string, method: string, user: StaffUser, params: URLSearchParams, body: Body | null): Promise<Response | null> {
  if (path !== "/deals" && !path.startsWith("/deals/")) return null;
  if (["agent", "customer"].includes(user.role)) return err("forbidden", "Sales access required", 403);
  if (!canUser(user, "sales") && !canUser(user, "exec_view")) return err("forbidden", "Sales access required", 403);
  const writes = canUser(user, "sales");
  const manager = canUser(user, "crm_assign");
  try {
    if (path === "/deals/options" && method === "GET") {
      const pk = await env.DB.prepare(`SELECT id, name, status FROM sales_packages WHERE status != 'draft' ORDER BY status, name COLLATE NOCASE`).all<{ id: number; name: string; status: string }>()
        .then((r) => r.results ?? []).catch(() => []);
      return json({ stages: [...OPEN_STAGES, "won", "lost"], lost_reasons: LOST_REASONS, packages: pk, owners: (await owners(env)).map(({ id, name }) => ({ id, name })),
        can_write: writes, can_assign: manager, can_override: canUser(user, "pipeline_override"), stuck_days: STUCK_DAYS, me: user.id });
    }
    if (path === "/deals" && method === "GET") {
      const where: string[] = ["(o.stage IN ('new', 'qualified', 'proposal', 'negotiation') OR o.closed_at >= datetime('now', '-30 days'))"];
      const b: (string | number)[] = [];
      if (params.get("scope") === "mine") { b.push(user.id); where.push(`o.owner_id = ?${b.length}`); }
      const cust = Number(params.get("customer"));
      if (Number.isInteger(cust) && cust > 0) { where.length = 0; b.push(cust); where.push(`o.customer_id = ?${b.length}`); }
      const owner = Number(params.get("owner"));
      if (Number.isInteger(owner) && owner > 0) { b.push(owner); where.push(`o.owner_id = ?${b.length}`); }
      const stage = params.get("stage") ?? "";
      if ((["new", "qualified", "proposal", "negotiation", "won", "lost"] as string[]).includes(stage)) { b.push(stage); where.push(`o.stage = ?${b.length}`); }
      const pr = params.get("priority") ?? "";
      if (["low", "normal", "high"].includes(pr)) { b.push(pr); where.push(`o.priority = ?${b.length}`); }
      const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 80);
      if (q) { b.push(`%${q}%`); where.push(`(LOWER(o.title) LIKE ?${b.length} OR LOWER(c.company) LIKE ?${b.length})`); }
      const { results } = await env.DB.prepare(`${DEAL_SQL} WHERE ${where.join(" AND ")} ORDER BY o.next_action_on IS NULL, o.next_action_on, o.created_at DESC LIMIT 500`)
        .bind(...b).all<DealRow>();
      const deals = await shape(env, results ?? []);
      const open = deals.filter((d) => (OPEN_STAGES as readonly string[]).includes(d.stage));
      const month = mytToday().slice(0, 7);
      const closedThisMonth = (s: string) => deals.filter((d) => d.stage === s && String(d.closed_at ?? "").slice(0, 7) === month).length;
      return json({
        today: mytToday(), deals,
        summary: {
          open: open.length,
          value_cents: open.reduce((t, d) => t + (d.value_cents ?? 0), 0),
          quoted_cents: open.filter((d) => d.value_basis === "quotation").reduce((t, d) => t + (d.value_cents ?? 0), 0),
          estimated_cents: open.filter((d) => d.value_basis === "estimate").reduce((t, d) => t + (d.value_cents ?? 0), 0),
          stuck: open.filter((d) => d.stuck).length, no_next: open.filter((d) => d.no_next).length, late: open.filter((d) => d.next_late).length,
          won_month: closedThisMonth("won"), lost_month: closedThisMonth("lost"),
          by_stage: Object.fromEntries(OPEN_STAGES.map((s) => [s, open.filter((d) => d.stage === s).length])),
        },
      });
    }
    if (path === "/deals/suggestions" && method === "GET") {
      if (!manager) return err("forbidden", "Only a manager confirms suggested deals", 403);
      return json({ rows: await suggestions(env) });
    }
    if (path === "/deals/suggestions/confirm" && method === "POST") {
      if (!manager) return err("forbidden", "Only a manager confirms suggested deals", 403);
      const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
      if (reason.length < 5) return err("invalid_input", "Say why, in a few words.", 400);
      const ids = Array.isArray(body?.items) ? (body!.items as unknown[]).map(Number) : [];
      if (!ids.length || ids.length > 100) return err("invalid_input", "Tick 1 to 100 quotations.", 400);
      const now = new Map((await suggestions(env)).map((s) => [s.doc_id, s]));
      let made = 0; const skipped: number[] = [];
      for (const id of ids) {
        const s = now.get(id);
        if (!s) { skipped.push(id); continue; }
        const key = `qt:${id}`;
        const [ins] = await env.DB.batch([
          env.DB.prepare(`INSERT INTO sales_opportunities (customer_id, title, owner_id, stage, origin, client_key, created_by)
                          SELECT ?1, ?2, ?3, ?4, 'suggestion', ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM sales_opportunities WHERE client_key = ?5)
                            AND NOT EXISTS (SELECT 1 FROM opportunity_quotations WHERE doc_id = ?7 AND unlinked_at IS NULL)`).bind(s.customer_id, `${s.company} - ${s.doc_number}`, s.owner_id, s.stage, key, user.id, id),
          env.DB.prepare(`INSERT INTO opportunity_quotations (opportunity_id, doc_id, linked_by, origin)
                          SELECT o.id, ?2, ?3, 'suggestion' FROM sales_opportunities o WHERE o.client_key = ?1
                            AND NOT EXISTS (SELECT 1 FROM opportunity_quotations WHERE doc_id = ?2 AND unlinked_at IS NULL)`).bind(key, id, user.id),
          env.DB.prepare(`INSERT INTO opportunity_stage_events (opportunity_id, from_stage, to_stage, reason, created_by)
                          SELECT o.id, NULL, o.stage, ?2, ?3 FROM sales_opportunities o WHERE o.client_key = ?1
                            AND NOT EXISTS (SELECT 1 FROM opportunity_stage_events e WHERE e.opportunity_id = o.id)`).bind(key, `Suggested from ${s.doc_number}: ${reason}`, user.id),
        ]);
        if (ins?.meta?.changes) made++; else skipped.push(id);
      }
      await audit(env, user.id, "pipeline.suggestions", "sales_opportunities", undefined, { made, skipped: skipped.length, reason });
      return json({ ok: true, made, skipped });
    }
    if (path === "/deals" && method === "POST") {
      if (!writes) return err("forbidden", "Sales access required", 403);
      const cid = Number(body?.customer_id);
      const cust = Number.isInteger(cid) ? await env.DB.prepare(`SELECT id, company FROM customers WHERE id = ?1 AND company != 'Walk-in Customer'`).bind(cid).first<{ id: number; company: string }>() : null;
      if (!cust) return err("invalid_input", "Choose the customer the deal is with.", 400);
      const title = str(body?.title, 160) ? String(body!.title).trim() : "";
      if (title.length < 3) return err("invalid_input", "Name the deal in a few words.", 400);
      const ck = typeof body?.client_key === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.client_key) ? body.client_key : null;
      if (!ck) return err("invalid_input", "client_key is required.", 400);
      let owner = body?.owner_id == null ? user.id : Number(body.owner_id);
      if (owner !== user.id && !manager) return err("forbidden", "Only a manager gives a deal to someone else", 403);
      if (!(await owners(env)).some((o) => o.id === owner)) { if (body?.owner_id == null) owner = 0; else return err("invalid_input", "The owner must be a current member of the sales team.", 400); }
      const est = cents(body?.est_value_cents); if (est === "bad") return err("invalid_input", "The estimate is an amount in sen, 0 or more.", 400);
      const svc = await cleanService(env, body?.service); if (svc instanceof Response) return svc;
      const pr = body?.priority == null ? "normal" : String(body.priority);
      if (!["low", "normal", "high"].includes(pr)) return err("invalid_input", "Priority is low, normal or high.", 400);
      const nd = day(body?.next_action_on), cd = day(body?.expected_close_on);
      if (nd === "bad" || cd === "bad") return err("invalid_input", "A date is YYYY-MM-DD.", 400);
      const na = str(body?.next_action, 200) ? String(body!.next_action).trim() : null;
      await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO sales_opportunities (customer_id, title, owner_id, est_value_cents, service, priority, next_action, next_action_on, expected_close_on, client_key, created_by)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`).bind(cid, title, owner || null, est, svc, pr, na, nd, cd, ck, user.id),
        env.DB.prepare(`INSERT INTO opportunity_stage_events (opportunity_id, from_stage, to_stage, created_by)
                        SELECT o.id, NULL, 'new', ?2 FROM sales_opportunities o WHERE o.client_key = ?1 AND NOT EXISTS (SELECT 1 FROM opportunity_stage_events e WHERE e.opportunity_id = o.id)`).bind(ck, user.id),
      ]);
      const row = await env.DB.prepare(`SELECT id, created_by, customer_id FROM sales_opportunities WHERE client_key = ?1`).bind(ck).first<{ id: number; created_by: number; customer_id: number }>();
      if (!row || row.created_by !== user.id || row.customer_id !== cid) return err("invalid_input", "That key was already used.", 409);
      await audit(env, user.id, "pipeline.create", "sales_opportunities", String(row.id), { customer_id: cid });
      if (owner && owner !== user.id) await notify(env, owner, "enquiry", `A deal is yours: ${title}`, `deal:${row.id}`);
      return json({ ok: true, id: row.id }, 201);
    }

    const m = /^\/deals\/(\d+)(?:\/(move|won|lost|reopen|link|unlink))?$/.exec(path);
    if (!m) return err("not_found", "Not found", 404);
    const id = Number(m[1]);
    const act = m[2] ?? "";
    const cur = await env.DB.prepare(`SELECT o.*, c.company FROM sales_opportunities o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?1`)
      .bind(id).first<{ id: number; customer_id: number; owner_id: number | null; stage: string; version: number; title: string; company: string }>();
    if (!cur) return err("not_found", "Deal not found", 404);
    if (!act && method === "GET") {
      const [deal] = await shape(env, (await env.DB.prepare(`${DEAL_SQL} WHERE o.id = ?1`).bind(id).all<DealRow>()).results ?? []);
      const { results: events } = await env.DB.prepare(
        `SELECT e.id, e.from_stage, e.to_stage, e.reason, e.basis, e.created_at, ${NAME("u")} AS by_name FROM opportunity_stage_events e LEFT JOIN users u ON u.id = e.created_by
          WHERE e.opportunity_id = ?1 ORDER BY e.id DESC LIMIT 50`).bind(id).all();
      const { results: candidates } = await env.DB.prepare(
        `SELECT d.id, d.doc_number, d.total_cents, COALESCE(d.revision, 0) AS revision, d.created_at FROM sales_documents d
          WHERE d.doc_type = 'QT' AND d.customer_id = ?1 AND NOT EXISTS (SELECT 1 FROM opportunity_quotations l WHERE l.doc_id = d.id AND l.unlinked_at IS NULL)
          ORDER BY d.created_at DESC LIMIT 20`).bind(cur.customer_id).all();
      return json({ deal, events, candidates });
    }
    if (!writes) return err("forbidden", "Sales access required", 403);
    const mayEdit = manager || cur.owner_id === user.id || (cur.owner_id === null && act === "link");
    const override = canUser(user, "pipeline_override");
    if (act === "reopen" ? !override : !mayEdit) return err("forbidden", act === "reopen" ? "Only the CEO, COO or CCO reopen a closed deal" : "Only the deal's owner or a manager changes it", 403);
    const v = typeof body?.version === "number" && Number.isInteger(body.version) ? body.version : null;
    if (v === null) return err("invalid_input", "version is required.", 400);
    const isOpen = (OPEN_STAGES as readonly string[]).includes(cur.stage);
    /* one batch: the history row only while the version holds, then the change itself */
    const step = async (sets: string, binds: unknown[], ev: { to: string; reason?: string | null; basis?: string | null } | null) => {
      const list = [];
      if (ev) list.push(env.DB.prepare(`INSERT INTO opportunity_stage_events (opportunity_id, from_stage, to_stage, reason, basis, created_by)
                                        SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM sales_opportunities WHERE id = ?1 AND version = ?7)`).bind(id, cur.stage, ev.to, ev.reason ?? null, ev.basis ?? null, user.id, v));
      list.push(env.DB.prepare(`UPDATE sales_opportunities SET ${sets}, version = version + 1, last_activity_at = datetime('now') WHERE id = ? AND version = ?`).bind(...binds, id, v));
      const res = await env.DB.batch(list);
      return !!res[res.length - 1]?.meta?.changes;
    };

    if (act === "" && method === "PUT") {
      if (!isOpen) return err("closed", "A closed deal is not edited. A manager may reopen it.", 409);
      const title = str(body?.title, 160) ? String(body!.title).trim() : "";
      if (title.length < 3) return err("invalid_input", "Name the deal in a few words.", 400);
      const est = cents(body?.est_value_cents); if (est === "bad") return err("invalid_input", "The estimate is an amount in sen, 0 or more.", 400);
      const svc = await cleanService(env, body?.service); if (svc instanceof Response) return svc;
      const pr = String(body?.priority ?? "normal"); if (!["low", "normal", "high"].includes(pr)) return err("invalid_input", "Priority is low, normal or high.", 400);
      const nd = day(body?.next_action_on), cd = day(body?.expected_close_on);
      if (nd === "bad" || cd === "bad") return err("invalid_input", "A date is YYYY-MM-DD.", 400);
      const na = str(body?.next_action, 200) ? String(body!.next_action).trim() : null;
      let owner = cur.owner_id;
      if (body?.owner_id !== undefined && (body.owner_id === null ? null : Number(body.owner_id)) !== cur.owner_id) {
        if (!manager) return err("forbidden", "Only a manager gives a deal to someone else", 403);
        owner = body.owner_id === null ? null : Number(body.owner_id);
        if (owner !== null && !(await owners(env)).some((o) => o.id === owner)) return err("invalid_input", "The owner must be a current member of the sales team.", 400);
      }
      const ok = await step(`title = ?, est_value_cents = ?, service = ?, priority = ?, next_action = ?, next_action_on = ?, expected_close_on = ?, owner_id = ?`, [title, est, svc, pr, na, nd, cd, owner], null);
      if (!ok) return changed();
      await audit(env, user.id, "pipeline.edit", "sales_opportunities", String(id), { owner_from: cur.owner_id, owner_to: owner });
      if (owner !== null && owner !== cur.owner_id) await notify(env, owner, "enquiry", `A deal is yours: ${title}`, `deal:${id}`);
      return json({ ok: true, version: v + 1 });
    }
    if (act === "move" && method === "POST") {
      const to = String(body?.to ?? "");
      if (!(OPEN_STAGES as readonly string[]).includes(to)) return err("invalid_input", "Won and Lost have their own steps; move to an open stage here.", 400);
      if (!isOpen) return err("closed", "A closed deal does not move. A manager may reopen it.", 409);
      if (to === cur.stage) return err("invalid_input", "It is already in that stage.", 400);
      if (!(await step(`stage = ?, stage_since = datetime('now')`, [to], { to }))) return changed();
      await audit(env, user.id, "pipeline.move", "sales_opportunities", String(id), { from: cur.stage, to });
      return json({ ok: true, version: v + 1 });
    }
    if (act === "won" && method === "POST") {
      if (!isOpen) return err("closed", "This deal is already closed.", 409);
      /* decision 4: the customer's acceptance of a linked quotation's CURRENT revision, or a live invoice made from one */
      const q = (await quotesOf(env, [id])).get(id) ?? [];
      const acc = q.find((x) => x.accepted), inv = q.find((x) => x.invoiced);
      let basis: "acceptance" | "invoice" | "override"; let doc: number | null = null; let reason: string | null = null;
      if (acc) { basis = "acceptance"; doc = acc.id; }
      else if (inv) { basis = "invoice"; doc = inv.id; }
      else {
        reason = str(body?.override_reason, 300) ? String(body!.override_reason).trim() : null;
        if (!override) return err("no_evidence", "Won needs the customer's acceptance of a linked quotation or an invoice made from one. The CEO, COO or CCO may decide otherwise, with a reason.", 409);
        if (!reason || reason.length < 10) return err("invalid_input", "Say why it is won without an acceptance or an invoice, in at least 10 characters.", 400);
        basis = "override";
      }
      if (!(await step(`stage = 'won', stage_since = datetime('now'), won_basis = ?, won_doc_id = ?, override_reason = ?, closed_at = datetime('now'), closed_by = ?`, [basis, doc, reason, user.id], { to: "won", reason, basis }))) return changed();
      await audit(env, user.id, basis === "override" ? "pipeline.won_override" : "pipeline.won", "sales_opportunities", String(id), { basis, doc_id: doc, reason });
      return json({ ok: true, basis, version: v + 1 });
    }
    if (act === "lost" && method === "POST") {
      if (!isOpen) return err("closed", "This deal is already closed.", 409);
      const reason = String(body?.reason ?? "");
      if (!(LOST_REASONS as readonly string[]).includes(reason)) return err("invalid_input", "Choose why it was lost.", 400);
      const note = str(body?.note, 300) ? String(body!.note).trim() : null;
      if (reason === "other" && (!note || note.length < 5)) return err("invalid_input", "Say why, in a few words.", 400);
      if (!(await step(`stage = 'lost', stage_since = datetime('now'), lost_reason = ?, lost_note = ?, closed_at = datetime('now'), closed_by = ?`, [reason, note, user.id], { to: "lost", reason: [reason, note].filter(Boolean).join(": ") }))) return changed();
      await audit(env, user.id, "pipeline.lost", "sales_opportunities", String(id), { reason, note });
      return json({ ok: true, version: v + 1 });
    }
    if (act === "reopen" && method === "POST") {
      if (isOpen) return err("invalid_input", "This deal is open.", 400);
      const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
      if (reason.length < 10) return err("invalid_input", "Say why it is reopened, in at least 10 characters.", 400);
      if (!(await step(`stage = 'negotiation', stage_since = datetime('now'), won_basis = NULL, won_doc_id = NULL, override_reason = NULL, lost_reason = NULL, lost_note = NULL, closed_at = NULL, closed_by = NULL`, [], { to: "negotiation", reason }))) return changed();
      await audit(env, user.id, "pipeline.reopen", "sales_opportunities", String(id), { from: cur.stage, reason });
      return json({ ok: true, version: v + 1 });
    }
    if (act === "link" && method === "POST") {
      if (!isOpen) return err("closed", "A closed deal takes no quotation.", 409);
      const doc = Number(body?.doc_id);
      const d = Number.isInteger(doc) ? await env.DB.prepare(`SELECT id, customer_id FROM sales_documents WHERE id = ?1 AND doc_type = 'QT'`).bind(doc).first<{ id: number; customer_id: number }>() : null;
      if (!d) return err("invalid_input", "Choose a quotation.", 400);
      if (d.customer_id !== cur.customer_id) return err("invalid_input", "The quotation is for another customer.", 400);
      try {
        const [, up] = await env.DB.batch([
          env.DB.prepare(`INSERT INTO opportunity_quotations (opportunity_id, doc_id, linked_by) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM sales_opportunities WHERE id = ?1 AND version = ?4)`).bind(id, doc, user.id, v),
          env.DB.prepare(`UPDATE sales_opportunities SET version = version + 1, last_activity_at = datetime('now') WHERE id = ?1 AND version = ?2`).bind(id, v),
        ]);
        if (!up?.meta?.changes) return changed();
      } catch (e) {
        if (/UNIQUE/i.test(String(e))) return err("linked", "That quotation already belongs to another deal.", 409);
        throw e;
      }
      await audit(env, user.id, "pipeline.link", "sales_opportunities", String(id), { doc_id: doc });
      return json({ ok: true, version: v + 1 });
    }
    if (act === "unlink" && method === "POST") {
      const doc = Number(body?.doc_id);
      const reason = str(body?.reason, 300) ? String(body!.reason).trim() : "";
      if (reason.length < 5) return err("invalid_input", "Say why, in a few words.", 400);
      const linked = await env.DB.prepare(`SELECT id FROM opportunity_quotations WHERE opportunity_id = ?1 AND doc_id = ?2 AND unlinked_at IS NULL`).bind(id, doc).first();
      if (!linked) return err("invalid_input", "That quotation is not linked to this deal.", 400);
      const [un] = await env.DB.batch([
        env.DB.prepare(`UPDATE opportunity_quotations SET unlinked_at = datetime('now'), unlinked_by = ?3, unlink_reason = ?4 WHERE opportunity_id = ?1 AND doc_id = ?2 AND unlinked_at IS NULL
                          AND EXISTS (SELECT 1 FROM sales_opportunities WHERE id = ?1 AND version = ?5)`).bind(id, doc, user.id, reason, v),
        env.DB.prepare(`UPDATE sales_opportunities SET version = version + 1, last_activity_at = datetime('now') WHERE id = ?1 AND version = ?2`).bind(id, v),
      ]);
      if (!un?.meta?.changes) return changed();
      await audit(env, user.id, "pipeline.unlink", "sales_opportunities", String(id), { doc_id: doc, reason });
      return json({ ok: true, version: v + 1 });
    }
    return err("method_not_allowed", "Not allowed", 405);
  } catch (e) {
    if (missing(e)) return err("migration_missing", "Run migration 0227 first (PUSH.bat)", 503);
    throw e;
  }
}

/**
 * v1.400.0 - Sales Command Center Phase 4 (decisions 3 and 4): a quotation made FOR a deal is linked to it
 * by the server when the quotation is saved (POST /docs with deal_id; migration 0228 records origin 'created').
 * A deal still in New or Qualified moves to Proposal sent, and the move is in its history; it never moves to
 * Won. The quotation is the primary record: anything wrong with the deal leaves the quotation saved and says
 * why, so creating a document can never fail because of a deal.
 */
export async function linkCreatedQuotation(env: Env, user: StaffUser, dealId: number, docId: number | undefined):
  Promise<{ ok: true; moved: boolean; deal_id: number } | { ok: false; reason: "not_found" | "closed" | "forbidden" | "other_customer" | "linked" | "changed" }> {
  if (!Number.isInteger(dealId) || dealId <= 0 || !docId) return { ok: false, reason: "not_found" };
  try {
    const deal = await env.DB.prepare(`SELECT id, customer_id, owner_id, stage, version FROM sales_opportunities WHERE id = ?1`).bind(dealId)
      .first<{ id: number; customer_id: number; owner_id: number | null; stage: string; version: number }>();
    if (!deal) return { ok: false, reason: "not_found" };
    if (!(OPEN_STAGES as readonly string[]).includes(deal.stage)) return { ok: false, reason: "closed" };
    if (!canUser(user, "sales") || !(canUser(user, "crm_assign") || deal.owner_id === user.id || deal.owner_id === null)) return { ok: false, reason: "forbidden" };
    const doc = await env.DB.prepare(`SELECT customer_id FROM sales_documents WHERE id = ?1 AND doc_type = 'QT'`).bind(docId).first<{ customer_id: number }>();
    if (!doc || doc.customer_id !== deal.customer_id) return { ok: false, reason: "other_customer" };
    const move = deal.stage === "new" || deal.stage === "qualified";
    const v = deal.version;
    const list = [
      env.DB.prepare(`INSERT INTO opportunity_quotations (opportunity_id, doc_id, linked_by, origin)
                      SELECT ?1, ?2, ?3, 'created' WHERE EXISTS (SELECT 1 FROM sales_opportunities WHERE id = ?1 AND version = ?4)
                        AND NOT EXISTS (SELECT 1 FROM opportunity_quotations WHERE doc_id = ?2 AND unlinked_at IS NULL)`).bind(dealId, docId, user.id, v),
    ];
    if (move) list.push(env.DB.prepare(`INSERT INTO opportunity_stage_events (opportunity_id, from_stage, to_stage, reason, created_by)
                      SELECT ?1, ?2, 'proposal', ?3, ?4 WHERE EXISTS (SELECT 1 FROM sales_opportunities WHERE id = ?1 AND version = ?5)
                        AND EXISTS (SELECT 1 FROM opportunity_quotations WHERE doc_id = ?6 AND opportunity_id = ?1 AND unlinked_at IS NULL)`)
      .bind(dealId, deal.stage, "A quotation was made for this deal", user.id, v, docId));
    list.push(env.DB.prepare(`UPDATE sales_opportunities SET version = version + 1, last_activity_at = datetime('now')
                      ${move ? ", stage = 'proposal', stage_since = datetime('now')" : ""}
                      WHERE id = ?1 AND version = ?2 AND EXISTS (SELECT 1 FROM opportunity_quotations WHERE doc_id = ?3 AND opportunity_id = ?1 AND unlinked_at IS NULL)`).bind(dealId, v, docId));
    const res = await env.DB.batch(list);
    if (!res[0]?.meta?.changes) return { ok: false, reason: (await env.DB.prepare(`SELECT 1 FROM opportunity_quotations WHERE doc_id = ?1 AND unlinked_at IS NULL`).bind(docId).first()) ? "linked" : "changed" };
    await audit(env, user.id, "pipeline.link", "sales_opportunities", String(dealId), { doc_id: docId, origin: "created", moved: move ? "proposal" : null });
    return { ok: true, moved: move, deal_id: dealId };
  } catch (e) {
    if (missing(e)) return { ok: false, reason: "not_found" };
    throw e;
  }
}

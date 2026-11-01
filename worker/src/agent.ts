/* v1.249.0 - THE AGENT DESK (the owner, 01-11-2026; claude/TASK-UPDATES-AGENT-AUDIT.md
   and his answers: agents sign in to the staff portal with a small menu, a real
   `agent` role, commission rules come separately).

   An Agent helps the sales team win clients. They see the ACTIVE packages to
   promote (what a client is offered - name, description, the issuing company,
   the price and the lines), submit a client with the package the client
   wants, and follow what happened to their own submissions. Sales & Marketing
   see every request; management (CEO, COO, CCO) also edits them - status,
   who follows it up, a note, the quotation it became.

   What an agent never gets: another agent's requests, customers' records,
   quotations, invoices, commission, payroll or any staff data. Nothing here
   writes a sales document, a customer, a commission or a payroll row: a
   request is a lead; the quotation is made in Sales with the existing engine.

   /agent/packages               GET   agent, sales readers, management
   /agent/requests               GET   agent: own; sales/management: all
   /agent/requests               POST  agent
   /agent/requests/:id           GET   agent (own) / sales / management, with history
   /agent/requests/:id           PATCH management
   /agent/agents                 GET   sales / management (the agents and their counts) */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit } from "./shared";
import { can } from "./permissions";

const STATUSES = ["new", "contacted", "quoted", "won", "lost"] as const;
const missing = (e: unknown) => /no such table|no such column/i.test(String(e));
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function handleAgent(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (path !== "/agent" && !path.startsWith("/agent/")) return null;
  const isAgent = can(user.role, "agent_portal");
  const viewer = can(user.role, "agent_requests_view");
  const manager = can(user.role, "agent_requests_manage");
  if (!isAgent && !viewer && !manager) return err("forbidden", "The agent desk is for agents, Sales and management", 403);
  try {
    /* ---- the packages an agent may promote: active ones only ---- */
    if (path === "/agent/packages" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.name, p.category, p.description, p.kind, p.issuers, p.current_version AS version, v.items, v.total_cents
           FROM sales_packages p JOIN sales_package_versions v ON v.package_id = p.id AND v.version = p.current_version
          WHERE p.status = 'active' ORDER BY p.category, p.name`,
      ).all<{ id: number; name: string; category: string | null; description: string | null; kind: string | null; issuers: string; version: number; items: string; total_cents: number }>();
      return json({
        packages: (results ?? []).map((r) => {
          let lines: { name: string; qty: number }[] = [];
          try { lines = (JSON.parse(r.items) as { name?: string; qty?: number }[]).map((l) => ({ name: String(l.name ?? ""), qty: Number(l.qty ?? 1) })); } catch { lines = []; }
          return { id: r.id, name: r.name, category: r.category, description: r.description, kind: r.kind, issuers: r.issuers.split(",").filter(Boolean), version: r.version, total_cents: r.total_cents, lines };
        }),
      });
    }

    /* ---- requests ---- */
    if (path === "/agent/requests" && method === "GET") {
      const status = params.get("status");
      const where: string[] = [];
      const binds: unknown[] = [];
      if (!viewer && !manager) { where.push(`r.agent_id = ?${binds.length + 1}`); binds.push(user.id); }
      else if (params.get("agent")) { where.push(`r.agent_id = ?${binds.length + 1}`); binds.push(Number(params.get("agent"))); }
      if (status && (STATUSES as readonly string[]).includes(status)) { where.push(`r.status = ?${binds.length + 1}`); binds.push(status); }
      const { results } = await env.DB.prepare(
        `SELECT r.id, r.agent_id, ${PERSON("a")} AS agent_name, r.client_name, r.client_phone, r.client_email, r.company, r.package_id, r.package_version,
                p.name AS package_name, r.note, r.status, r.assigned_to, ${PERSON("s")} AS assigned_name, r.quotation_id, d.doc_number AS quotation_number,
                r.manager_note, r.created_at, r.updated_at
           FROM agent_requests r
           LEFT JOIN users a ON a.id = r.agent_id LEFT JOIN users s ON s.id = r.assigned_to
           LEFT JOIN sales_packages p ON p.id = r.package_id LEFT JOIN sales_documents d ON d.id = r.quotation_id
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.id DESC LIMIT 300`,
      ).bind(...binds).all<Record<string, unknown>>();
      /* an agent reads their own request's progress, not the team's private note */
      const rows = (results ?? []).map((r) => (viewer || manager ? r : { ...r, manager_note: null }));
      return json({ requests: rows, can_manage: manager, can_submit: isAgent });
    }

    if (path === "/agent/requests" && method === "POST") {
      if (!isAgent) return err("forbidden", "Agents submit requests; Sales records leads in Sales", 403);
      const client = text(body?.client_name, 120);
      const phone = text(body?.client_phone, 40);
      const email = text(body?.client_email, 160).toLowerCase();
      if (client.length < 2) return err("invalid_input", "Give the client's name", 400);
      if (!phone && !email) return err("invalid_input", "Give the client's phone or email so Sales can reach them", 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("invalid_input", "That email does not look right", 400);
      const pid = Number(body?.package_id);
      const pkg = Number.isInteger(pid) && pid > 0
        ? await env.DB.prepare(`SELECT id, current_version FROM sales_packages WHERE id = ?1 AND status = 'active'`).bind(pid).first<{ id: number; current_version: number }>()
        : null;
      if (!pkg) return err("invalid_input", "Choose one of the active packages", 400);
      /* the same client and package from the same agent within a day is the same request */
      const dup = await env.DB.prepare(
        `SELECT id FROM agent_requests WHERE agent_id = ?1 AND package_id = ?2 AND lower(client_name) = lower(?3) AND created_at >= ?4 LIMIT 1`,
      ).bind(user.id, pkg.id, client, new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace("T", " ")).first<{ id: number }>();
      if (dup) return json({ ok: true, id: dup.id, existing: true });
      const t0 = now();
      const ins = await env.DB.prepare(
        `INSERT INTO agent_requests (agent_id, client_name, client_phone, client_email, company, package_id, package_version, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
      ).bind(user.id, client, phone || null, email || null, text(body?.company, 160) || null, pkg.id, pkg.current_version, text(body?.note, 1000) || null, t0).first<{ id: number }>();
      await env.DB.prepare(`INSERT INTO agent_request_events (request_id, actor_id, kind, detail, created_at) VALUES (?1, ?2, 'submitted', NULL, ?3)`).bind(ins!.id, user.id, t0).run();
      await audit(env, user.id, "agent.request", "agent_requests", String(ins!.id), { package_id: pkg.id });
      return json({ ok: true, id: ins!.id }, 201);
    }

    const one = path.match(/^\/agent\/requests\/(\d+)$/);
    if (one) {
      const r = await env.DB.prepare(`SELECT * FROM agent_requests WHERE id = ?1`).bind(Number(one[1])).first<{ id: number; agent_id: number; status: string; assigned_to: number | null; quotation_id: number | null; manager_note: string | null }>();
      if (!r || (!viewer && !manager && r.agent_id !== user.id)) return err("not_found", "Request not found", 404);
      if (method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT e.kind, e.detail, e.created_at, ${PERSON("u")} AS actor FROM agent_request_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.request_id = ?1 ORDER BY e.id`,
        ).bind(r.id).all();
        return json({ request: viewer || manager ? r : { ...r, manager_note: null }, history: results ?? [] });
      }
      if (method === "PATCH") {
        if (!manager) return err("forbidden", "Management (CEO, COO, CCO) edits agent requests; Sales reads them", 403);
        const sets: string[] = []; const vals: unknown[] = []; const changed: Record<string, [unknown, unknown]> = {};
        if (typeof body?.status === "string") {
          if (!(STATUSES as readonly string[]).includes(body.status)) return err("invalid_input", "Status is new, contacted, quoted, won or lost", 400);
          if (body.status !== r.status) { sets.push(`status = ?${sets.length + 1}`); vals.push(body.status); changed.status = [r.status, body.status]; }
        }
        if (body?.assigned_to !== undefined) {
          const to = body.assigned_to === null ? null : Number(body.assigned_to);
          if (to !== null) {
            const ok = await env.DB.prepare(`SELECT 1 AS x FROM users WHERE id = ?1 AND is_active = 1 AND role IN ('sales_marketing', 'ceo', 'coo', 'cco')`).bind(to).first();
            if (!ok) return err("invalid_input", "Follow-up goes to a salesperson or management", 400);
          }
          if (to !== r.assigned_to) { sets.push(`assigned_to = ?${sets.length + 1}`); vals.push(to); changed.assigned_to = [r.assigned_to, to]; }
        }
        if (body?.quotation_id !== undefined) {
          const q = body.quotation_id === null ? null : Number(body.quotation_id);
          if (q !== null && !(await env.DB.prepare(`SELECT 1 AS x FROM sales_documents WHERE id = ?1 AND doc_type = 'QT'`).bind(q).first())) return err("invalid_input", "That is not a quotation", 400);
          if (q !== r.quotation_id) { sets.push(`quotation_id = ?${sets.length + 1}`); vals.push(q); changed.quotation_id = [r.quotation_id, q]; }
        }
        if (typeof body?.manager_note === "string") {
          const note = text(body.manager_note, 1000) || null;
          if (note !== r.manager_note) { sets.push(`manager_note = ?${sets.length + 1}`); vals.push(note); changed.manager_note = [r.manager_note ? "(note)" : null, note ? "(note)" : null]; }
        }
        if (!sets.length) return json({ ok: true, unchanged: true });
        const t0 = now();
        sets.push(`updated_at = ?${sets.length + 1}`); vals.push(t0);
        sets.push(`updated_by = ?${sets.length + 1}`); vals.push(user.id);
        await env.DB.prepare(`UPDATE agent_requests SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`).bind(...vals, r.id).run();
        await env.DB.prepare(`INSERT INTO agent_request_events (request_id, actor_id, kind, detail, created_at) VALUES (?1, ?2, 'updated', ?3, ?4)`).bind(r.id, user.id, JSON.stringify(changed), t0).run();
        await audit(env, user.id, "agent.request_update", "agent_requests", String(r.id), changed);
        return json({ ok: true });
      }
      return null;
    }

    if (path === "/agent/agents" && method === "GET") {
      if (!viewer && !manager) return err("forbidden", "Sales and management only", 403);
      const { results } = await env.DB.prepare(
        `SELECT u.id, ${PERSON("u")} AS name, u.email, u.phone, u.is_active, u.created_at,
                (SELECT COUNT(*) FROM agent_requests r WHERE r.agent_id = u.id) AS requests,
                (SELECT COUNT(*) FROM agent_requests r WHERE r.agent_id = u.id AND r.status = 'won') AS won
           FROM users u WHERE u.role = 'agent' ORDER BY u.is_active DESC, name`,
      ).all();
      return json({ agents: results ?? [] });
    }
    return null;
  } catch (e) {
    if (missing(e)) return err("migration_missing", "Run the database migrations first (0164) - PUSH.bat does this", 503);
    throw e;
  }
}

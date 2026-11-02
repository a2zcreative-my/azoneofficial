/* v1.249.0 - THE AGENT DESK (the owner, 01-11-2026; claude/TASK-UPDATES-AGENT-AUDIT.md).
   v1.250.0 - THE AGENT PORTAL WORKFLOW (the owner's brief "Complete Agent
   Portal, Client Submission, Quotation Distribution & Collaboration", the
   audit claude/AGENT-PORTAL-AUDIT.md and his "Approved", 01-11-2026).

   An agent brings in a client. The request is a LEAD: it never writes a
   customer, a quotation, an invoice, a commission or a payroll row. Sales
   makes the quotation in Sales with the existing engine (prefilled from the
   request), management or the assigned salesperson PUBLISHES an issued,
   approved revision to the agent, the agent shares it and reports what the
   client said, and only an acceptance recorded on the quotation itself (the
   customer's shared link, or Sales recording it - business.ts) makes the
   request Won.

   Who (decided here from the session, never from the body):
     agent        own requests only; another request does not exist (404)
     Sales & Mkt  read every request; post comments; the assigned one handles
     handler      the assigned salesperson, or management (CEO, COO, CCO)
     management   assign, reopen, everything a handler does

   Visibility: every event and file is 'agent' or 'internal'. An agent's
   reads are filtered in SQL - an internal note never reaches their JSON.

   /agent/packages                       GET   everyone here
   /agent/requests                       GET   agent: own; staff: all, with counts
   /agent/requests                       POST  agent (draft or submit; client_key retry-safe)
   /agent/requests/:id                   GET   with timeline, files and the published quotation
   /agent/requests/:id                   PATCH agent: own draft / more-info answer; staff: status, assign, follow-up
   /agent/requests/:id/events            POST  an update or a comment (visibility)
   /agent/requests/:id/files             POST  raw upload (X-File-Name, ?visibility=)
   /agent/requests/:id/files/:fid        GET   stream, after the visibility check
   /agent/requests/:id/prefill           GET   staff: the Sales Create Quotation handoff
   /agent/requests/:id/publish           POST  handler: an issued, approved, valid quotation revision
   /agent/requests/:id/quotation         GET   agent-safe summary and the customer link
   /agent/requests/:id/shared            POST  agent: shared outside the system (self-reported)
   /agent/requests/:id/send              POST  agent: email from the portal (only when mail is set up)
   /agent/requests/:id/feedback          POST  agent: interest, wants changes, says yes (evidence), declined
   /agent/requests/:id/verify            POST  handler: Won, only with an acceptance on the published revision
   /agent/agents                         GET   staff: the agents and their counts */
import type { Env } from "./index";
import { primaryOrigin } from "./index";
import type { StaffUser } from "./staff";
import { notify } from "./staff";
import { json, err, audit, ensureShareToken, putGuarded } from "./shared";
import { can } from "./permissions";
import { approvalLimit, overLimit, loadDocForSigning, issueDoc } from "./signing";
import { FILE_TYPES, streamTaskFile } from "./tasks-progress";
import { mailReady, sendMailResult } from "./mail";

export const AGENT_STATUSES = ["draft", "submitted", "under_review", "more_info", "preparing", "quotation_ready", "with_client", "revision_requested", "acceptance_pending", "won", "not_proceeding"] as const;
type Status = (typeof AGENT_STATUSES)[number];
const LABEL: Record<Status, string> = {
  draft: "Draft", submitted: "Submitted", under_review: "Under review", more_info: "More info needed", preparing: "Preparing quotation",
  quotation_ready: "Quotation ready", with_client: "With client", revision_requested: "Revision requested", acceptance_pending: "Acceptance to verify",
  won: "Won", not_proceeding: "Not proceeding",
};
/** What a handler may move a request to, from each status. Quotation ready,
    With client, Revision, Acceptance and Won have their own actions. */
const STAFF_TO: Record<Status, readonly Status[]> = {
  draft: [], submitted: ["under_review", "more_info", "preparing", "not_proceeding"],
  under_review: ["more_info", "preparing", "not_proceeding"], more_info: ["under_review", "preparing", "not_proceeding"],
  preparing: ["under_review", "more_info", "not_proceeding"], quotation_ready: ["preparing", "not_proceeding"],
  with_client: ["preparing", "not_proceeding"], revision_requested: ["preparing", "not_proceeding"],
  acceptance_pending: ["with_client", "not_proceeding"], won: [], not_proceeding: ["under_review"],
};
/** The statuses in which the agent holds the published quotation. */
const HOLDS_QT: readonly Status[] = ["quotation_ready", "with_client", "revision_requested", "acceptance_pending", "won"];
const SHARE_FROM: readonly Status[] = ["quotation_ready", "with_client", "revision_requested"];
const CHANNELS = ["whatsapp", "email", "phone", "in_person", "other"] as const;
const missing = (e: unknown) => /no such table|no such column/i.test(String(e));
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const agentRef = (id: number) => `AGR-${String(id).padStart(4, "0")}`;

interface ReqRow {
  id: number; agent_id: number; client_name: string; contact_person: string | null; client_phone: string | null; client_email: string | null; company: string | null;
  package_id: number | null; package_version: number | null; custom: number; requirement: string | null; issuer_code: string | null; timeline: string | null; budget_text: string | null;
  note: string | null; status: Status; assigned_to: number | null; quotation_id: number | null; published_doc_id: number | null; published_revision: number | null;
  published_at: string | null; published_by: number | null; next_follow_up_on: string | null; manager_note: string | null; created_at: string; submitted_at: string | null;
}

/** The fields an agent may see of their own request. */
const AGENT_FIELDS = ["id", "agent_id", "client_name", "contact_person", "client_phone", "client_email", "company", "package_id", "package_version", "custom", "requirement", "issuer_code", "timeline", "budget_text", "note", "status", "created_at", "submitted_at"] as const;
const agentView = (r: Record<string, unknown>) => Object.fromEntries(AGENT_FIELDS.map((k) => [k, r[k] ?? null]));

export async function handleAgent(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams, request?: Request): Promise<Response | null> {
  if (path !== "/agent" && !path.startsWith("/agent/")) return null;
  const isAgent = can(user.role, "agent_portal");
  const viewer = can(user.role, "agent_requests_view");
  const manager = can(user.role, "agent_requests_manage");
  const staff = viewer || manager;
  if (!isAgent && !staff) return err("forbidden", "The agent desk is for agents, Sales and management", 403);
  try {
    /* ---- the packages an agent may promote: active ones only, the published price ---- */
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

    /* ---- the list ---- */
    if (path === "/agent/requests" && method === "GET") {
      const where: string[] = []; const binds: unknown[] = [];
      if (!staff) { where.push(`r.agent_id = ?${binds.length + 1}`); binds.push(user.id); }
      else {
        where.push(`r.status != 'draft'`); // a draft is the agent's own until sent
        if (params.get("agent")) { where.push(`r.agent_id = ?${binds.length + 1}`); binds.push(Number(params.get("agent"))); }
      }
      const vis = staff ? "" : "AND e.visibility = 'agent'";
      const { results } = await env.DB.prepare(
        `SELECT r.*, ${PERSON("a")} AS agent_name, ${PERSON("s")} AS assigned_name, p.name AS package_name,
                q.doc_number AS quotation_number, pd.doc_number AS published_number,
                (SELECT e.body FROM agent_request_events e WHERE e.request_id = r.id ${vis} ORDER BY e.id DESC LIMIT 1) AS last_text,
                (SELECT e.created_at FROM agent_request_events e WHERE e.request_id = r.id ${vis} ORDER BY e.id DESC LIMIT 1) AS last_at,
                (SELECT ${PERSON("w")} FROM agent_request_events e JOIN users w ON w.id = e.actor_id WHERE e.request_id = r.id ${vis} ORDER BY e.id DESC LIMIT 1) AS last_by
           FROM agent_requests r
           LEFT JOIN users a ON a.id = r.agent_id LEFT JOIN users s ON s.id = r.assigned_to
           LEFT JOIN sales_packages p ON p.id = r.package_id
           LEFT JOIN sales_documents q ON q.id = r.quotation_id
           LEFT JOIN sales_documents pd ON pd.id = r.published_doc_id
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY COALESCE(r.last_event_at, r.created_at) DESC, r.id DESC LIMIT 300`,
      ).bind(...binds).all<Record<string, unknown>>();
      const today = mytToday();
      const rows: Record<string, unknown>[] = (results ?? []).map((r) => {
        const st = r.status as Status;
        const base = {
          ref: agentRef(Number(r.id)), package_name: r.package_name ?? null, assigned_name: r.assigned_name ?? null,
          last_text: r.last_text ?? null, last_at: r.last_at ?? null, last_by: r.last_by ?? null,
          /* an agent sees a quotation only once it is PUBLISHED to them - never a draft Sales linked */
          published_number: HOLDS_QT.includes(st) ? (r.published_number ?? null) : null,
          published_revision: HOLDS_QT.includes(st) ? (r.published_revision ?? null) : null,
        };
        if (!staff) return { ...agentView(r), ...base };
        return { ...r, ...base, agent_name: r.agent_name ?? null, quotation_number: r.quotation_number ?? null,
          overdue: !!r.next_follow_up_on && String(r.next_follow_up_on) < today && !["won", "not_proceeding"].includes(st) };
      });
      const counts: Record<string, number> = {};
      for (const r of rows) counts[String(r.status)] = (counts[String(r.status)] ?? 0) + 1;
      return json({ requests: rows, counts, can_manage: manager, can_submit: isAgent, mail_ready: mailReady(env), me: user.id });
    }

    /* ---- submit (or save a draft) ---- */
    if (path === "/agent/requests" && method === "POST") {
      if (!isAgent) return err("forbidden", "Agents submit requests; Sales records leads in Sales", 403);
      const key = text(body?.client_key, 80) || null;
      if (key) {
        const again = await env.DB.prepare(`SELECT id FROM agent_requests WHERE agent_id = ?1 AND client_key = ?2`).bind(user.id, key).first<{ id: number }>();
        if (again) return json({ ok: true, id: again.id, existing: true });
      }
      const draft = body?.draft === true;
      const f = readFields(body);
      const ok = await checkFields(env, f, draft);
      if (typeof ok === "string") return err("invalid_input", ok, 400);
      if (!draft && f.package_id) {
        /* the same client and package from the same agent within a day is the same request */
        const dup = await env.DB.prepare(
          `SELECT id FROM agent_requests WHERE agent_id = ?1 AND package_id = ?2 AND lower(client_name) = lower(?3) AND created_at >= ?4 AND status != 'draft' LIMIT 1`,
        ).bind(user.id, f.package_id, f.client_name, new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace("T", " ")).first<{ id: number }>();
        if (dup) return json({ ok: true, id: dup.id, existing: true });
      }
      const t0 = now();
      const ins = await env.DB.prepare(
        `INSERT INTO agent_requests (agent_id, client_name, contact_person, client_phone, client_email, company, package_id, package_version, custom, requirement, issuer_code, timeline, budget_text, note, status, client_key, created_at, submitted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
         ON CONFLICT(agent_id, client_key) WHERE client_key IS NOT NULL DO NOTHING RETURNING id`,
      ).bind(user.id, f.client_name, f.contact_person, f.client_phone, f.client_email, f.company, f.package_id, ok.version, f.custom ? 1 : 0, f.requirement, ok.issuer,
        f.timeline, f.budget_text, f.note, draft ? "draft" : "submitted", key, t0, draft ? null : t0).first<{ id: number }>();
      if (!ins) {
        const again = await env.DB.prepare(`SELECT id FROM agent_requests WHERE agent_id = ?1 AND client_key = ?2`).bind(user.id, key).first<{ id: number }>();
        return json({ ok: true, id: again?.id, existing: true });
      }
      await event(env, ins.id, user.id, { kind: draft ? "draft" : "submitted", visibility: "agent", body: draft ? "Draft saved" : "Submitted to Sales", status_to: draft ? "draft" : "submitted" });
      await audit(env, user.id, draft ? "agent.request_draft" : "agent.request", "agent_requests", String(ins.id), { package_id: f.package_id, custom: f.custom });
      if (!draft) await tellTeam(env, ins.id, user.id, `${agentRef(ins.id)}: a new client from an agent - ${f.client_name}`, null);
      return json({ ok: true, id: ins.id, ref: agentRef(ins.id), status: draft ? "draft" : "submitted" }, 201);
    }

    /* ---- staff: the agents and their counts ---- */
    if (path === "/agent/agents" && method === "GET") {
      if (!staff) return err("forbidden", "Sales and management only", 403);
      /* v1.250.2 - what the owner asked to see per agent: the account, whether its
         email is proven, active or suspended, the scope (every active package,
         both companies - agents have no company restriction), the requests and
         the latest activity. Real rows only. */
      const { results } = await env.DB.prepare(
        `SELECT u.id, ${PERSON("u")} AS name, u.email, u.is_active,
                CASE WHEN u.google_sub IS NOT NULL OR u.email_verified_at IS NOT NULL OR u.password_hash LIKE 'oauth$%' THEN 1 ELSE 0 END AS email_verified,
                (SELECT COUNT(*) FROM agent_requests r WHERE r.agent_id = u.id AND r.status != 'draft') AS requests,
                (SELECT COUNT(*) FROM agent_requests r WHERE r.agent_id = u.id AND r.status NOT IN ('draft', 'won', 'not_proceeding')) AS open_requests,
                (SELECT COUNT(*) FROM agent_requests r WHERE r.agent_id = u.id AND r.status = 'won') AS won,
                (SELECT MAX(e.created_at) FROM agent_request_events e JOIN agent_requests r ON r.id = e.request_id WHERE r.agent_id = u.id AND e.actor_id = u.id) AS last_activity
           FROM users u WHERE u.role = 'agent' ORDER BY u.is_active DESC, name`,
      ).all();
      return json({ agents: (results ?? []).map((a) => ({ ...a, scope: "All active packages - A2Z CREATIVE MARKETING and AZ ONE OFFICIAL" })), can_grant: user.role === "super_admin" || (user.role === "ceo" && user.is_owner === true) });
    }

    const m = path.match(/^\/agent\/requests\/(\d+)(?:\/(events|files|prefill|publish|quotation|shared|send|feedback|verify)(?:\/(\d+))?)?$/);
    if (!m) return null;
    const r = await env.DB.prepare(`SELECT * FROM agent_requests WHERE id = ?1`).bind(Number(m[1])).first<ReqRow>();
    /* an agent asking for somebody else's request finds nothing - not "forbidden", which would confirm it exists */
    if (!r || (!staff && r.agent_id !== user.id) || (staff && r.status === "draft")) return err("not_found", "Request not found", 404);
    const own = r.agent_id === user.id;
    const handler = manager || (viewer && r.assigned_to === user.id);
    const sub = m[2] ?? "";

    /* ---- one request: details, timeline, files, quotation ---- */
    if (!sub && method === "GET") {
      const vis = staff ? "" : "AND e.visibility = 'agent'";
      const { results: history } = await env.DB.prepare(
        `SELECT e.id, e.kind, e.visibility, e.body, e.client_feedback, e.blockers, e.next_action, e.follow_up_on, e.status_from, e.status_to, e.channel, e.corrects_id, e.created_at,
                e.actor_id, ${PERSON("u")} AS actor, u.role AS actor_role
           FROM agent_request_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.request_id = ?1 ${vis} ORDER BY e.id`,
      ).bind(r.id).all<Record<string, unknown>>();
      const { results: files } = await env.DB.prepare(
        `SELECT f.id, f.event_id, f.file_name, f.content_type, f.size_bytes, f.visibility, f.created_at, ${PERSON("u")} AS uploader
           FROM agent_request_files f LEFT JOIN users u ON u.id = f.uploader_id WHERE f.request_id = ?1 ${staff ? "" : "AND f.visibility = 'agent'"} ORDER BY f.id`,
      ).bind(r.id).all<Record<string, unknown>>();
      const names = await env.DB.prepare(
        `SELECT ${PERSON("a")} AS agent_name, ${PERSON("s")} AS assigned_name, p.name AS package_name FROM agent_requests r
           LEFT JOIN users a ON a.id = r.agent_id LEFT JOIN users s ON s.id = r.assigned_to LEFT JOIN sales_packages p ON p.id = r.package_id WHERE r.id = ?1`,
      ).bind(r.id).first<{ agent_name: string | null; assigned_name: string | null; package_name: string | null }>();
      const qt = await publishedQuotation(env, r);
      const base = { ref: agentRef(r.id), package_name: names?.package_name ?? null, assigned_name: names?.assigned_name ?? null };
      if (!staff) {
        return json({ request: { ...agentView(r as unknown as Record<string, unknown>), ...base }, history: history ?? [], files: files ?? [], quotation: qt, mail_ready: mailReady(env),
          can: { edit: ["draft", "more_info"].includes(r.status), share: SHARE_FROM.includes(r.status) && !!qt?.link, feedback: SHARE_FROM.includes(r.status) && !!qt?.link } });
      }
      let linked: Record<string, unknown> | null = null;
      if (r.quotation_id) {
        linked = await env.DB.prepare(`SELECT d.id, d.doc_number, COALESCE(d.revision, 0) AS revision, d.total_cents, d.valid_until, d.voided_at, d.issuer_code, c.company AS customer
                                         FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id WHERE d.id = ?1`).bind(r.quotation_id).first<Record<string, unknown>>();
        if (linked) {
          const acc = await env.DB.prepare(`SELECT accepted_name, accepted_at, channel FROM quotation_acceptances WHERE doc_id = ?1 AND revision = ?2`).bind(r.quotation_id, Number(linked.revision)).first().catch(() => null);
          linked = { ...linked, acceptance: acc ?? null };
        }
      }
      return json({ request: { ...r, ...base, agent_name: names?.agent_name ?? null }, history: history ?? [], files: files ?? [], quotation: qt, linked,
        can: { handle: handler, manage: manager, to: handler ? STAFF_TO[r.status].filter(() => r.status !== "not_proceeding" || manager) : [], publish: handler && !!r.quotation_id && !["won", "not_proceeding"].includes(r.status), verify: handler && r.status === "acceptance_pending" } });
    }

    /* ---- edit: the agent's own draft or more-info answer; staff status, assignment, follow-up ---- */
    if (!sub && method === "PATCH") {
      if (!staff) {
        if (!["draft", "more_info"].includes(r.status)) return err("forbidden", "You change a request only while it is a draft or Sales asked you for more information", 403);
        const f = readFields({ ...pick(r), ...(body ?? {}) });
        const submit = body?.submit === true;
        const ok = await checkFields(env, f, !submit && r.status === "draft");
        if (typeof ok === "string") return err("invalid_input", ok, 400);
        const answer = text(body?.answer, 1000);
        if (r.status === "more_info" && submit && answer.length < 2) return err("invalid_input", "Write the information Sales asked for", 400);
        const to: Status = submit ? "submitted" : r.status;
        const t0 = now();
        await env.DB.prepare(
          `UPDATE agent_requests SET client_name = ?1, contact_person = ?2, client_phone = ?3, client_email = ?4, company = ?5, package_id = ?6, package_version = ?7, custom = ?8, requirement = ?9,
                  issuer_code = ?10, timeline = ?11, budget_text = ?12, note = ?13, status = ?14, submitted_at = COALESCE(submitted_at, ?15), updated_at = ?16, updated_by = ?17
            WHERE id = ?18`,
        ).bind(f.client_name, f.contact_person, f.client_phone, f.client_email, f.company, f.package_id, ok.version, f.custom ? 1 : 0, f.requirement, ok.issuer,
          f.timeline, f.budget_text, f.note, to, submit ? t0 : null, t0, user.id, r.id).run();
        if (submit) {
          await event(env, r.id, user.id, { kind: r.status === "more_info" ? "update" : "submitted", visibility: "agent", body: r.status === "more_info" ? `More information: ${answer}` : "Submitted to Sales", status_from: r.status, status_to: to });
          await tellTeam(env, r.id, user.id, r.status === "more_info" ? `${agentRef(r.id)}: the agent answered your question` : `${agentRef(r.id)}: a new client from an agent - ${f.client_name}`, r.assigned_to);
        }
        await audit(env, user.id, "agent.request_edit", "agent_requests", String(r.id), { submit });
        return json({ ok: true, status: to });
      }
      if (!handler) return err("forbidden", "The assigned salesperson or management changes a request; Sales & Marketing read and comment", 403);
      const sets: string[] = []; const vals: unknown[] = []; const changed: Record<string, [unknown, unknown]> = {};
      let statusTo: Status | null = null;
      const reason = text(body?.reason, 500);
      if (typeof body?.status === "string" && body.status !== r.status) {
        const want = body.status as Status;
        if (!(AGENT_STATUSES as readonly string[]).includes(want)) return err("invalid_input", "Unknown status", 400);
        if (!STAFF_TO[r.status].includes(want)) return err("invalid_state", `${LABEL[r.status]} cannot move to ${LABEL[want]} here${want === "quotation_ready" ? " - use Publish to Agent" : want === "won" ? " - use Verify acceptance" : ""}`, 409);
        if (r.status === "not_proceeding" && !manager) return err("forbidden", "Only management reopens a request", 403);
        if ((want === "not_proceeding" || want === "more_info") && reason.length < 5) return err("invalid_input", want === "more_info" ? "Say what the agent should tell you" : "Give the reason (kept in the history)", 400);
        sets.push(`status = ?${sets.length + 1}`); vals.push(want); changed.status = [r.status, want]; statusTo = want;
      }
      if (body?.assigned_to !== undefined && (body.assigned_to === null ? null : Number(body.assigned_to)) !== r.assigned_to) {
        if (!manager) return err("forbidden", "Management assigns the salesperson", 403);
        const to = body.assigned_to === null ? null : Number(body.assigned_to);
        if (to !== null) {
          const okU = await env.DB.prepare(`SELECT 1 AS x FROM users WHERE id = ?1 AND is_active = 1 AND role IN ('sales_marketing', 'ceo', 'coo', 'cco')`).bind(to).first();
          if (!okU) return err("invalid_input", "Assign a salesperson or management", 400);
        }
        sets.push(`assigned_to = ?${sets.length + 1}`); vals.push(to); changed.assigned_to = [r.assigned_to, to];
      }
      if (body?.next_follow_up_on !== undefined && (body.next_follow_up_on || null) !== r.next_follow_up_on) {
        const d = body.next_follow_up_on || null;
        if (d !== null && !validDay(d)) return err("invalid_input", "Follow-up date is YYYY-MM-DD", 400);
        sets.push(`next_follow_up_on = ?${sets.length + 1}`); vals.push(d); changed.next_follow_up_on = [r.next_follow_up_on, d];
      }
      if (typeof body?.issuer_code === "string" && body.issuer_code !== r.issuer_code) {
        if (!["a2z", "azoo"].includes(body.issuer_code)) return err("invalid_input", "Issuing company is a2z or azoo", 400);
        sets.push(`issuer_code = ?${sets.length + 1}`); vals.push(body.issuer_code); changed.issuer_code = [r.issuer_code, body.issuer_code];
      }
      if (body?.quotation_id !== undefined && (body.quotation_id === null ? null : Number(body.quotation_id)) !== r.quotation_id) {
        const q = body.quotation_id === null ? null : Number(body.quotation_id);
        if (q !== null && !(await env.DB.prepare(`SELECT 1 AS x FROM sales_documents WHERE id = ?1 AND doc_type = 'QT'`).bind(q).first())) return err("invalid_input", "That is not a quotation", 400);
        sets.push(`quotation_id = ?${sets.length + 1}`); vals.push(q); changed.quotation_id = [r.quotation_id, q];
      }
      if (typeof body?.manager_note === "string" && manager) {
        const note = text(body.manager_note, 1000) || null;
        if (note !== r.manager_note) { sets.push(`manager_note = ?${sets.length + 1}`); vals.push(note); changed.manager_note = [r.manager_note ? "(note)" : null, note ? "(note)" : null]; }
      }
      if (!sets.length) return json({ ok: true, unchanged: true });
      const t0 = now();
      sets.push(`updated_at = ?${sets.length + 1}`); vals.push(t0);
      sets.push(`updated_by = ?${sets.length + 1}`); vals.push(user.id);
      await env.DB.prepare(`UPDATE agent_requests SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`).bind(...vals, r.id).run();
      if (statusTo) {
        /* what the agent is told: the new status, and for More info and Not proceeding the reason - that is the question to them */
        await event(env, r.id, user.id, { kind: "status", visibility: "agent", status_from: r.status, status_to: statusTo,
          body: statusTo === "more_info" ? `More information needed: ${reason}` : statusTo === "not_proceeding" ? `Not proceeding: ${reason}` : `Status: ${LABEL[statusTo]}` });
        await notify(env, r.agent_id, "agent", `${agentRef(r.id)} (${r.client_name}): ${statusTo === "more_info" ? `Sales needs more information - ${reason}` : LABEL[statusTo]}`, `agent:${r.id}:st:${Date.now()}`).catch(() => false);
      }
      if (changed.assigned_to) {
        const who = changed.assigned_to[1] as number | null;
        const nm = who ? await env.DB.prepare(`SELECT ${PERSON("u")} AS n FROM users u WHERE u.id = ?1`).bind(who).first<{ n: string }>() : null;
        await event(env, r.id, user.id, { kind: "assign", visibility: "agent", body: who ? `Sales assigned: ${nm?.n ?? ""}` : "Sales unassigned" });
        if (who && who !== user.id) await notify(env, who, "agent", `${agentRef(r.id)}: you handle ${r.client_name} (from an agent)`, `agent:${r.id}:assign:${who}:${Date.now()}`).catch(() => false);
      }
      if (changed.next_follow_up_on || changed.quotation_id || changed.issuer_code || changed.manager_note) {
        await event(env, r.id, user.id, { kind: "update", visibility: "internal", body: [changed.next_follow_up_on ? `Next follow-up ${changed.next_follow_up_on[1] ?? "cleared"}` : "", changed.quotation_id ? "Quotation linked" : "", changed.issuer_code ? `Issuing company ${changed.issuer_code[1]}` : "", changed.manager_note ? "Private note changed" : ""].filter(Boolean).join(" · ") });
      }
      await audit(env, user.id, "agent.request_update", "agent_requests", String(r.id), { ...changed, ...(reason ? { reason } : {}) });
      return json({ ok: true });
    }

    /* ---- an update or a comment ---- */
    if (sub === "events" && method === "POST") {
      const kind = body?.kind === "comment" ? "comment" : "update";
      /* an agent's entries are always visible to the agent; staff choose, and default to internal */
      const visibility = !staff ? "agent" : body?.visibility === "agent" ? "agent" : "internal";
      const b = text(body?.body, 2000);
      if (b.length < 2) return err("invalid_input", "Write the update", 400);
      const follow = validDay(body?.follow_up_on) ? body!.follow_up_on as string : null;
      const corrects = Number.isInteger(Number(body?.corrects_id)) && Number(body?.corrects_id) > 0 ? Number(body!.corrects_id) : null;
      if (corrects && !(await env.DB.prepare(`SELECT 1 AS x FROM agent_request_events WHERE id = ?1 AND request_id = ?2 AND actor_id = ?3`).bind(corrects, r.id, user.id).first())) return err("invalid_input", "You correct only your own entry on this request", 400);
      const ev = await event(env, r.id, user.id, { kind, visibility, body: b, client_feedback: text(body?.client_feedback, 1000) || null, blockers: text(body?.blockers, 1000) || null,
        next_action: text(body?.next_action, 500) || null, follow_up_on: follow, corrects_id: corrects, client_key: text(body?.client_key, 80) || null });
      if (ev.existing) return json({ ok: true, id: ev.id, existing: true });
      if (follow && handler) await env.DB.prepare(`UPDATE agent_requests SET next_follow_up_on = ?1 WHERE id = ?2`).bind(follow, r.id).run();
      if (!staff) await tellTeam(env, r.id, user.id, `${agentRef(r.id)} (${r.client_name}): ${b.slice(0, 120)}`, r.assigned_to);
      else if (visibility === "agent") await notify(env, r.agent_id, "agent", `${agentRef(r.id)} (${r.client_name}): ${b.slice(0, 120)}`, `agent:${r.id}:ev:${ev.id}`).catch(() => false);
      return json({ ok: true, id: ev.id }, 201);
    }

    /* ---- files: stored like task files (private R2 + media) ---- */
    if (sub === "files" && method === "POST" && !m[3]) {
      if (!request) return err("invalid_input", "File body required", 400);
      const visibility = !staff ? "agent" : params.get("visibility") === "agent" ? "agent" : "internal";
      const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
      const ft = FILE_TYPES[ct];
      if (!ft) return err("invalid_input", "PDF, JPEG, PNG, WEBP or Word files only", 400);
      const name = (request.headers.get("X-File-Name") ?? "file").slice(0, 160);
      const ck = (request.headers.get("Idempotency-Key") ?? "").slice(0, 80) || null;
      if (ck) {
        const again = await env.DB.prepare(`SELECT id FROM agent_request_files WHERE uploader_id = ?1 AND client_key = ?2`).bind(user.id, ck).first<{ id: number }>();
        if (again) return json({ id: again.id, existing: true });
      }
      const key = `private/agent-requests/${r.id}/${Date.now()}-${name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      const rejected = await putGuarded(env.MEDIA, key, request, { max: ft.max, contentType: ct });
      if (rejected) return rejected;
      const len = Number(request.headers.get("Content-Length") ?? 0) || null;
      const media = await env.DB.prepare(`INSERT INTO media (r2_key, kind, alt, uploaded_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`).bind(key, ft.kind, name, user.id).first<{ id: number }>();
      const row = await env.DB.prepare(
        `INSERT INTO agent_request_files (request_id, media_id, uploader_id, file_name, content_type, size_bytes, visibility, client_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
      ).bind(r.id, media?.id ?? null, user.id, name, ct, len, visibility, ck).first<{ id: number }>();
      await event(env, r.id, user.id, { kind: "file", visibility, body: `File: ${name}` });
      await audit(env, user.id, "agent.request_file", "agent_requests", String(r.id), { file: row?.id, visibility });
      return json({ id: row?.id, name }, 201);
    }
    if (sub === "files" && method === "GET" && m[3]) {
      const f = await env.DB.prepare(`SELECT f.file_name, f.visibility, md.r2_key FROM agent_request_files f JOIN media md ON md.id = f.media_id WHERE f.request_id = ?1 AND f.id = ?2`)
        .bind(r.id, Number(m[3])).first<{ file_name: string; visibility: string; r2_key: string }>();
      if (!f || (!staff && f.visibility !== "agent")) return err("not_found", "File not found", 404);
      return streamTaskFile(env, f);
    }

    /* ---- the Sales handoff: Create Quotation prefilled from the request ---- */
    if (sub === "prefill" && method === "GET") {
      if (!staff) return err("not_found", "Request not found", 404);
      let items: unknown[] = [];
      if (r.package_id) {
        const v = await env.DB.prepare(`SELECT items FROM sales_package_versions WHERE package_id = ?1 AND version = ?2`).bind(r.package_id, r.package_version).first<{ items: string }>();
        try { items = v ? JSON.parse(v.items) as unknown[] : []; } catch { items = []; }
      }
      return json({ prefill: {
        source: "agent_request", agent_request_id: r.id, company: r.company || r.client_name, contact_person: r.contact_person || (r.company ? r.client_name : ""),
        phone: r.client_phone ?? "", email: r.client_email ?? "", reference: agentRef(r.id), doc_type: "QT", items,
        package_id: r.package_id, package_version: r.package_version, issuer: r.issuer_code ?? undefined, salesperson_id: r.assigned_to ?? undefined,
        notes: [r.requirement, r.timeline ? `Timeline: ${r.timeline}` : "", r.budget_text ? `Budget: ${r.budget_text}` : ""].filter(Boolean).join("\n"),
      } });
    }

    /* ---- publish an issued, approved, valid revision to the agent ---- */
    if (sub === "publish" && method === "POST") {
      if (!staff || !handler) return err("forbidden", "The assigned salesperson or management publishes a quotation to the agent", 403);
      if (["won", "not_proceeding"].includes(r.status)) return err("invalid_state", `A request that is ${LABEL[r.status]} takes no quotation`, 409);
      const docId = Number(body?.doc_id ?? r.quotation_id);
      if (!Number.isInteger(docId) || docId <= 0) return err("invalid_input", "Create the quotation in Sales first (Create quotation in Sales)", 400);
      const d = await env.DB.prepare(`SELECT id, doc_type, doc_number, issuer_code, COALESCE(revision, 0) AS revision, total_cents, created_at, revised_at, valid_until, voided_at FROM sales_documents WHERE id = ?1`)
        .bind(docId).first<{ id: number; doc_type: string; doc_number: string; issuer_code: string | null; revision: number; total_cents: number; created_at: string; revised_at: string | null; valid_until: string | null; voided_at: string | null }>();
      if (!d || d.doc_type !== "QT") return err("invalid_input", "That is not a quotation", 400);
      if (d.voided_at) return err("invalid_state", `${d.doc_number} is void - publish its replacement`, 409);
      if (!d.valid_until || d.valid_until.slice(0, 10) < mytToday()) return err("expired", `${d.doc_number} ${d.valid_until ? `was valid until ${d.valid_until.slice(0, 10)}` : "has no valid-until date"} - issue a revision with a new date first`, 409);
      if (r.issuer_code && d.issuer_code && r.issuer_code !== d.issuer_code) return err("invalid_input", "That quotation is from the other company than this request", 400);
      /* the approval limit applies whatever the signing mode: over it, the revision needs its approval */
      if (overLimit(d, await approvalLimit(env))) {
        const ap = await env.DB.prepare(`SELECT 1 AS x FROM quotation_approvals WHERE doc_id = ?1 AND revision = ?2`).bind(d.id, d.revision).first().catch(() => null);
        if (!ap) return err("approval_required", `${d.doc_number} is over the approval limit and this revision is not approved yet`, 409);
      }
      const full = await loadDocForSigning(env, d.id);
      if (full) {
        const iss = await issueDoc(env, full, user.id).catch((e) => { if (missing(e)) return { ok: true as const }; throw e; });
        if (!iss.ok) return iss.res;
      }
      await ensureShareToken(env, d.id, user.id);
      const t0 = now();
      await env.DB.prepare(
        `UPDATE agent_requests SET quotation_id = ?1, published_doc_id = ?1, published_revision = ?2, published_at = ?3, published_by = ?4, status = 'quotation_ready', issuer_code = COALESCE(issuer_code, ?5), updated_at = ?3, updated_by = ?4 WHERE id = ?6`,
      ).bind(d.id, d.revision, t0, user.id, d.issuer_code, r.id).run();
      await event(env, r.id, user.id, { kind: "published", visibility: "agent", body: `Quotation ${d.doc_number}${d.revision ? ` REV ${d.revision}` : ""} published to you`, status_from: r.status, status_to: "quotation_ready" });
      await audit(env, user.id, "agent.publish", "agent_requests", String(r.id), { doc_id: d.id, doc_number: d.doc_number, revision: d.revision });
      await notify(env, r.agent_id, "agent", `${agentRef(r.id)} (${r.client_name}): quotation ${d.doc_number} is ready to share`, `agent:${r.id}:pub:${d.id}:${d.revision}`).catch(() => false);
      return json({ ok: true, doc_number: d.doc_number, revision: d.revision });
    }

    /* ---- the quotation the agent holds ---- */
    if (sub === "quotation" && method === "GET") return json({ quotation: await publishedQuotation(env, r) });

    /* ---- the agent shares it ---- */
    if ((sub === "shared" || sub === "send") && method === "POST") {
      if (staff || !own) return err("forbidden", "The agent who brought the client shares the quotation", 403);
      if (!SHARE_FROM.includes(r.status)) return err("invalid_state", "There is no published quotation to share", 409);
      const qt = await publishedQuotation(env, r);
      if (!qt?.link) return err("invalid_state", qt?.notice ?? "There is no published quotation to share", 409);
      let channel: string; let summary: string;
      if (sub === "send") {
        if (!mailReady(env)) return err("mail_not_ready", "Email from the portal is not set up yet - share the link yourself and record it", 503);
        const to = text(body?.to, 160).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return err("invalid_input", "Give the client's email", 400);
        const sent = await sendMailResult(env, { to, subject: `Quotation ${qt.doc_number} from ${qt.issuer_name}`,
          text: `Dear ${r.contact_person || r.client_name},\n\nPlease find our quotation ${qt.doc_number}${qt.revision ? ` (revision ${qt.revision})` : ""} here:\n${qt.link}\n\nIt is valid until ${qt.valid_until}.\n\n${qt.issuer_name}` });
        if (!sent.ok) return err("mail_failed", sent.error ?? "The email was not sent", 502);
        channel = "email"; summary = `Sent from the portal to ${to}`;
      } else {
        channel = CHANNELS.includes(body?.channel as (typeof CHANNELS)[number]) ? String(body!.channel) : "";
        if (!channel) return err("invalid_input", "Say how you shared it: WhatsApp, email, phone, in person or other", 400);
        summary = `Shared by the agent (${channel.replace("_", " ")}) - self-reported`;
      }
      const note = text(body?.note, 500);
      await env.DB.prepare(`UPDATE agent_requests SET status = 'with_client', updated_at = ?1, updated_by = ?2 WHERE id = ?3`).bind(now(), user.id, r.id).run();
      await event(env, r.id, user.id, { kind: sub === "send" ? "sent" : "shared", visibility: "agent", channel, body: note ? `${summary}. ${note}` : summary, status_from: r.status, status_to: "with_client",
        next_action: text(body?.next_action, 500) || null, follow_up_on: validDay(body?.follow_up_on) ? body!.follow_up_on as string : null });
      await audit(env, user.id, sub === "send" ? "agent.quotation_sent" : "agent.quotation_shared", "agent_requests", String(r.id), { doc_id: r.published_doc_id, revision: r.published_revision, channel, verified: sub === "send" });
      await tellTeam(env, r.id, user.id, `${agentRef(r.id)} (${r.client_name}): ${summary}`, r.assigned_to);
      return json({ ok: true, status: "with_client" });
    }

    /* ---- what the client said ---- */
    if (sub === "feedback" && method === "POST") {
      if (staff || !own) return err("forbidden", "The agent who brought the client reports what the client said", 403);
      if (!SHARE_FROM.includes(r.status)) return err("invalid_state", "Report the client's answer once you hold a published quotation", 409);
      const kind = String(body?.kind ?? "");
      if (!["interest", "revision", "accepted", "declined"].includes(kind)) return err("invalid_input", "interest, revision, accepted or declined", 400);
      const b = text(body?.body, 2000);
      if (b.length < 2) return err("invalid_input", "Write what the client said", 400);
      const fid = Number(body?.evidence_file_id);
      if (kind === "accepted") {
        /* a claim needs evidence: a file the agent attached to this request */
        const okF = Number.isInteger(fid) && fid > 0 && await env.DB.prepare(`SELECT 1 AS x FROM agent_request_files WHERE id = ?1 AND request_id = ?2 AND uploader_id = ?3`).bind(fid, r.id, user.id).first();
        if (!okF) return err("invalid_input", "Attach the client's confirmation (a screenshot, an email or a signed order) as evidence", 400);
      }
      const to: Status = kind === "revision" ? "revision_requested" : kind === "accepted" ? "acceptance_pending" : r.status === "quotation_ready" ? "with_client" : r.status;
      const label = ({ interest: "Client is interested", revision: "Client wants changes", accepted: "Client says yes - to verify", declined: "Client declined" } as Record<string, string>)[kind]!;
      if (to !== r.status) await env.DB.prepare(`UPDATE agent_requests SET status = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4`).bind(to, now(), user.id, r.id).run();
      const ev = await event(env, r.id, user.id, { kind: "feedback", visibility: "agent", body: `${label}: ${b}`, client_feedback: kind, status_from: r.status, status_to: to, next_action: text(body?.next_action, 500) || null, follow_up_on: validDay(body?.follow_up_on) ? body!.follow_up_on as string : null });
      if (kind === "accepted") await env.DB.prepare(`UPDATE agent_request_files SET event_id = ?1 WHERE id = ?2 AND event_id IS NULL`).bind(ev.id, fid).run();
      await audit(env, user.id, "agent.feedback", "agent_requests", String(r.id), { kind, status: [r.status, to] });
      await tellTeam(env, r.id, user.id, `${agentRef(r.id)} (${r.client_name}): ${label}`, r.assigned_to);
      return json({ ok: true, status: to });
    }

    /* ---- Won, only on an acceptance recorded on the published revision ---- */
    if (sub === "verify" && method === "POST") {
      if (!staff || !handler) return err("forbidden", "The assigned salesperson or management verifies an acceptance", 403);
      if (r.status !== "acceptance_pending") return err("invalid_state", "Nothing to verify - the agent has not reported an acceptance", 409);
      if (!r.published_doc_id) return err("invalid_state", "No quotation was published to the agent", 409);
      const acc = await env.DB.prepare(`SELECT accepted_name, accepted_at, channel FROM quotation_acceptances WHERE doc_id = ?1 AND revision = ?2`).bind(r.published_doc_id, r.published_revision ?? 0)
        .first<{ accepted_name: string; accepted_at: string; channel: string | null }>().catch(() => null);
      if (!acc) return err("acceptance_missing", "Record the client's acceptance on the quotation first (who agreed and how) - then verify here", 409);
      const t0 = now();
      await env.DB.prepare(`UPDATE agent_requests SET status = 'won', updated_at = ?1, updated_by = ?2 WHERE id = ?3`).bind(t0, user.id, r.id).run();
      await event(env, r.id, user.id, { kind: "status", visibility: "agent", body: `Won - acceptance verified (${acc.accepted_name}${acc.channel ? `, ${acc.channel.replace("_", " ")}` : ", on the shared link"})`, status_from: r.status, status_to: "won" });
      await audit(env, user.id, "agent.won", "agent_requests", String(r.id), { doc_id: r.published_doc_id, revision: r.published_revision, accepted_name: acc.accepted_name });
      await notify(env, r.agent_id, "agent", `${agentRef(r.id)} (${r.client_name}): won - the client's acceptance is verified`, `agent:${r.id}:won`).catch(() => false);
      return json({ ok: true, status: "won" });
    }
    return null;
  } catch (e) {
    if (missing(e)) return err("migration_missing", "Run the database migrations (0164) - the agent desk tables are not there yet", 503);
    throw e;
  }
}

/* ------------------------------------------------------------------ helpers */

interface Fields { client_name: string; contact_person: string | null; client_phone: string | null; client_email: string | null; company: string | null; package_id: number | null; custom: boolean; requirement: string | null; issuer: string | null; timeline: string | null; budget_text: string | null; note: string | null }
function readFields(b: Record<string, unknown> | null): Fields {
  const pid = Number(b?.package_id);
  return {
    client_name: text(b?.client_name, 120), contact_person: text(b?.contact_person, 120) || null, client_phone: text(b?.client_phone, 40) || null,
    client_email: text(b?.client_email, 160).toLowerCase() || null, company: text(b?.company, 160) || null,
    package_id: Number.isInteger(pid) && pid > 0 ? pid : null, custom: b?.custom === true || b?.custom === 1, requirement: text(b?.requirement, 2000) || null,
    issuer: typeof b?.issuer_code === "string" && b.issuer_code ? b.issuer_code : null, timeline: text(b?.timeline, 120) || null, budget_text: text(b?.budget_text, 120) || null, note: text(b?.note, 1000) || null,
  };
}
function pick(r: ReqRow): Record<string, unknown> {
  return { client_name: r.client_name, contact_person: r.contact_person, client_phone: r.client_phone, client_email: r.client_email, company: r.company, package_id: r.package_id,
    custom: r.custom === 1, requirement: r.requirement, issuer_code: r.issuer_code, timeline: r.timeline, budget_text: r.budget_text, note: r.note };
}
/** Validate; returns the problem in words, or the package version and the issuer to keep. */
async function checkFields(env: Env, f: Fields, draft: boolean): Promise<string | { version: number | null; issuer: string | null }> {
  if (f.client_name.length < 2) return "Give the client's or company's name";
  if (f.client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.client_email)) return "That email does not look right";
  if (f.issuer && !["a2z", "azoo"].includes(f.issuer)) return "Issuing company is A2Z or AZ ONE";
  let version: number | null = null; let issuer = f.issuer;
  if (f.package_id) {
    const pkg = await env.DB.prepare(`SELECT id, current_version, issuers FROM sales_packages WHERE id = ?1 AND status = 'active'`).bind(f.package_id).first<{ id: number; current_version: number; issuers: string }>();
    if (!pkg) return "Choose one of the active packages";
    version = pkg.current_version;
    const offered = pkg.issuers.split(",").filter(Boolean);
    if (issuer && offered.length && !offered.includes(issuer)) return "That package is not offered by that company";
    if (!issuer && offered.length === 1) issuer = offered[0]!;
  }
  if (draft) return { version, issuer };
  if (!f.client_phone && !f.client_email) return "Give the client's phone or email so Sales can reach them";
  if (!f.package_id && !(f.custom && (f.requirement ?? "").length >= 10)) return "Choose a package, or Custom requirement and describe what the client needs (10+ characters)";
  return { version, issuer };
}

/** Append one event and keep the request's latest-update columns. */
async function event(env: Env, requestId: number, actorId: number, e: {
  kind: string; visibility: "agent" | "internal"; body?: string | null; client_feedback?: string | null; blockers?: string | null; next_action?: string | null; follow_up_on?: string | null;
  status_from?: string | null; status_to?: string | null; channel?: string | null; corrects_id?: number | null; client_key?: string | null;
}): Promise<{ id: number; existing: boolean }> {
  const t0 = now();
  const row = await env.DB.prepare(
    `INSERT INTO agent_request_events (request_id, actor_id, kind, visibility, body, client_feedback, blockers, next_action, follow_up_on, status_from, status_to, channel, corrects_id, client_key, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
     ON CONFLICT(actor_id, client_key) WHERE client_key IS NOT NULL DO NOTHING RETURNING id`,
  ).bind(requestId, actorId, e.kind, e.visibility, e.body ?? null, e.client_feedback ?? null, e.blockers ?? null, e.next_action ?? null, e.follow_up_on ?? null,
    e.status_from ?? null, e.status_to ?? null, e.channel ?? null, e.corrects_id ?? null, e.client_key ?? null, t0).first<{ id: number }>();
  if (!row) {
    const again = await env.DB.prepare(`SELECT id FROM agent_request_events WHERE actor_id = ?1 AND client_key = ?2`).bind(actorId, e.client_key).first<{ id: number }>();
    return { id: again?.id ?? 0, existing: true };
  }
  await env.DB.prepare(`UPDATE agent_requests SET last_event_at = ?1, last_event_by = ?2, last_event_text = ?3 WHERE id = ?4`).bind(t0, actorId, (e.body ?? e.kind).slice(0, 200), requestId).run();
  return { id: row.id, existing: false };
}

/** Tell the handler (or management when nobody is assigned) - never the actor. */
async function tellTeam(env: Env, requestId: number, actorId: number, message: string, assigned: number | null): Promise<void> {
  const ids = new Set<number>();
  if (assigned) ids.add(assigned);
  else {
    const { results } = await env.DB.prepare(`SELECT id FROM users WHERE is_active = 1 AND role IN ('ceo', 'coo', 'cco')`).all<{ id: number }>();
    for (const u of results ?? []) ids.add(u.id);
  }
  ids.delete(actorId);
  const stamp = Date.now();
  for (const id of ids) await notify(env, id, "agent", message, `agent:${requestId}:${stamp}:${id}`).catch(() => false);
}

const ISSUER_NAME: Record<string, string> = { a2z: "A2Z CREATIVE MARKETING", azoo: "AZ ONE OFFICIAL" };
/** What the agent holds: the PUBLISHED revision only. A newer revision Sales is still
    working on, a void, or an expiry withdraws the link until it is published again. */
async function publishedQuotation(env: Env, r: ReqRow): Promise<{ doc_number: string; revision: number; issuer_name: string; customer: string | null; total_cents: number; valid_until: string; lines: { name: string; qty: number }[]; link: string | null; notice: string | null; acceptance: { accepted_at: string } | null } | null> {
  if (!r.published_doc_id || !HOLDS_QT.includes(r.status)) return null;
  const d = await env.DB.prepare(`SELECT d.doc_number, COALESCE(d.revision, 0) AS revision, d.issuer_code, d.total_cents, d.valid_until, d.voided_at, d.share_token, d.items, c.company
                                    FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id WHERE d.id = ?1`).bind(r.published_doc_id)
    .first<{ doc_number: string; revision: number; issuer_code: string | null; total_cents: number; valid_until: string | null; voided_at: string | null; share_token: string | null; items: string; company: string | null }>();
  if (!d) return null;
  let lines: { name: string; qty: number }[] = [];
  try { lines = (JSON.parse(d.items) as { name?: string; qty?: number }[]).map((l) => ({ name: String(l.name ?? ""), qty: Number(l.qty ?? 1) })).slice(0, 12); } catch { lines = []; }
  const acc = await env.DB.prepare(`SELECT accepted_at FROM quotation_acceptances WHERE doc_id = ?1 AND revision = ?2`).bind(r.published_doc_id, r.published_revision ?? 0).first<{ accepted_at: string }>().catch(() => null);
  const notice = d.voided_at ? "This quotation was withdrawn - Sales will publish its replacement"
    : d.revision !== (r.published_revision ?? 0) ? "Sales is revising this quotation - wait for the new version"
    : r.status !== "won" && d.valid_until && d.valid_until.slice(0, 10) < mytToday() ? "This quotation has expired - ask Sales for a new date"
    : null;
  return {
    doc_number: d.doc_number, revision: r.published_revision ?? 0, issuer_name: ISSUER_NAME[d.issuer_code ?? "a2z"] ?? "A2Z CREATIVE MARKETING", customer: d.company,
    total_cents: d.total_cents, valid_until: (d.valid_until ?? "").slice(0, 10), lines,
    link: notice || !d.share_token ? null : `${primaryOriginSafe(env)}/doc?t=${d.share_token}`, notice, acceptance: acc ?? null,
  };
}
function primaryOriginSafe(env: Env): string { try { return primaryOrigin(env); } catch { return "https://a2zcreative.my"; } }

/** v1.250.0 - a quotation saved in Sales with an AGR-#### reference joins its request
    (staff.ts, after the create). The request moves to Preparing; nothing else. */
export async function linkAgentQuotation(env: Env, docId: number | undefined, docType: string, reference: string | null, actorId: number): Promise<void> {
  if (!docId || docType !== "QT" || !reference) return;
  const m = reference.trim().match(/^AGR-0*(\d+)$/i);
  if (!m) return;
  try {
    const r = await env.DB.prepare(`SELECT id, status FROM agent_requests WHERE id = ?1`).bind(Number(m[1])).first<{ id: number; status: Status }>();
    if (!r || ["draft", "won", "not_proceeding"].includes(r.status)) return;
    const moveTo: Status = ["submitted", "under_review", "more_info", "revision_requested"].includes(r.status) ? "preparing" : r.status;
    await env.DB.prepare(`UPDATE agent_requests SET quotation_id = ?1, status = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?5`).bind(docId, moveTo, now(), actorId, r.id).run();
    await event(env, r.id, actorId, { kind: "quotation", visibility: "internal", body: `Quotation created in Sales (#${docId}) - publish it once approved and issued` });
    if (moveTo !== r.status) await event(env, r.id, actorId, { kind: "status", visibility: "agent", body: `Status: ${LABEL[moveTo]}`, status_from: r.status, status_to: moveTo });
  } catch (e) { if (!missing(e)) throw e; }
}

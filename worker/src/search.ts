/**
 * SEARCH EVERYTHING — v1.107.0 (roadmap phase 04b).
 *
 * The roadmap, 05-09-2026: *"Type a phone number, get the hotel, the contact
 * and the last quotation you sent them. No vendor can sell you this because
 * no vendor has all of it."* Eight sources, one query, one answer.
 *
 * WHY THERE IS NO INDEX. The obvious build is an FTS5 table kept in step by
 * triggers. Two things argued against it. First, wrangler splits migrations on
 * semicolons, and a CREATE TRIGGER body is full of them - the migration that
 * built the index is the migration most likely to fail on the remote parser
 * that tests/migration-safety.mjs exists to protect against. Second, the
 * whole corpus is a few thousand rows: 442 hotels, 690 contacts, a dozen
 * staff, a few hundred orders, documents and stock lines. Eight LIKE queries
 * over that, each capped at six rows and sent in ONE batch, come back in a
 * few milliseconds and are always current - no index to rebuild, no trigger
 * to drift, nothing to forget when a table gains a column. If the company
 * grows past what that can carry, the index is a later, measured decision;
 * today it would be machinery guarding a rounding error.
 *
 * WHAT A PERSON MAY FIND is what they may SEE. Every source is gated by the
 * same permission its own tab is gated by - a live host searching a phone
 * number gets the staff member, not the hotel contact, because the hotel
 * directory is not hers to read. A search that leaks is worse than no search.
 *
 * PHONE NUMBERS ARE MATCHED BY DIGITS. "017-476 1019", "0174761019" and
 * "+60 17 476 1019" are one number; the query and every phone column are
 * stripped to digits before comparing, so whichever way it was typed finds
 * whichever way it was stored.
 *
 * v1.205.0 (the owner's Global Search brief, 25-10-2026) - the same tables,
 * the same gates, a little more of each row: the record's own status word,
 * its own last-change (or creation) date, the staff photo key. Two more
 * sources, each read by the rule its own list uses and not a copy of it:
 * leave requests (leaveSeesAll, the GET /leave?all=1 rule; everyone else
 * their own) and claims (claimScope, the GET /claims scope). Invoices are
 * their own kind, apart from quotations and delivery orders. `per` asks for
 * up to 25 a source (the results page), `only` narrows the sources - never
 * widens them past what the role may search.
 */

import type { Env } from "./index";
import { can } from "./permissions";
import { leaveSeesAll } from "./leave-chain";
import { claimScope } from "./claims-scope";

export interface Hit {
  kind: "hotel" | "contact" | "staff" | "client" | "document" | "invoice" | "stock" | "asset" | "task" | "leave" | "claim"; // v1.183.0 - "order" (Web Orders) retired; v1.205.0 invoice, leave, claim
  id: number;
  title: string;
  sub: string;
  /** the registry tab where this thing lives */
  tab: string;
  /** v1.205.0 - the record's own status word, as stored (the page labels it) */
  status?: string | null;
  /** v1.205.0 - the record's own last change, or when it was made, as stored */
  date?: string | null;
  /** v1.205.0 - "updated" or "created": which of the two `date` is */
  dateIs?: "updated" | "created" | "applied" | "due";
  /** v1.205.0 - a staff member's photo key (the Avatar resolves it) */
  photo?: string | null;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const PER_SOURCE = 6;
const PER_SOURCE_MAX = 25;
const MIN_CHARS = 2;

/** LIKE needs its own wildcards escaped, or "50%" matches everything. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The digits of a phone-shaped query, or null when it is not one. Six digits
    is the shortest run worth treating as a number - fewer than that and "2026"
    in a note would light up every phone with 2026 in it. */
export function phoneDigits(q: string): string | null {
  const d = q.replace(/\D/g, "");
  return d.length >= 6 && d.length >= q.replace(/\s/g, "").length * 0.6 ? d : null;
}

/** SQL that reduces a phone column to digits, for comparing against phoneDigits(). */
const DIGITS = (col: string) =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')`;

/** Which sources this role may search - one rule per source, the SAME rule
    the source's own tab and routes use. Exported so the guard can compare. */
export function sourcesFor(role: string): string[] {
  const out: string[] = [];
  if (can(role, "hotels_view")) out.push("hotel", "contact");
  if (can(role, "hr_manage") || can(role, "exec_view")) out.push("staff");
  if (can(role, "revenue_view")) out.push("client");
  if (can(role, "sales") || can(role, "exec_view")) out.push("document");
  /* v1.183.0 - "order" (web_orders, the Web Orders tab) retired with the tab */
  if (can(role, "inventory")) out.push("stock");
  if (can(role, "hr_manage") || can(role, "exec_view")) out.push("asset");
  out.push("task"); // everyone: their own; managers: all
  /* v1.205.0 - invoices are sales documents: the documents' rule */
  if (can(role, "sales") || can(role, "exec_view")) out.push("invoice");
  out.push("leave"); // everyone: their own; the HR tier and the approvers: all (leaveSeesAll)
  if (can(role, "claims_submit")) out.push("claim"); // GET /claims refuses anyone else; the scope is claimScope
  return out;
}

export async function handleSearch(env: Env, user: { id: number; role: string }, params: URLSearchParams): Promise<Response> {
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  if (q.length < MIN_CHARS) return json({ hits: [], q });
  const like = likePattern(q);
  const digits = phoneDigits(q);
  /* v1.205.0 - `only` NARROWS: a source it names that this role may not
     search stays out, because the set starts from sourcesFor(). */
  const only = (params.get("only") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const allowed = new Set(sourcesFor(user.role).filter((k) => only.length === 0 || only.includes(k)));
  const per = Math.min(PER_SOURCE_MAX, Math.max(1, Math.floor(Number(params.get("per"))) || PER_SOURCE));

  type Row = Record<string, string | number | null>;
  const stmts: { kind: Hit["kind"]; stmt: D1PreparedStatement; toHit: (r: Row) => Hit }[] = [];

  if (allowed.has("hotel")) {
    stmts.push({
      kind: "hotel",
      stmt: env.DB.prepare(
        `SELECT id, hotel_name, company, state, stage, updated_at FROM hotels
          WHERE is_active = 1 AND (hotel_name LIKE ?1 ESCAPE '\\' OR company LIKE ?1 ESCAPE '\\' OR address LIKE ?1 ESCAPE '\\')
          ORDER BY hotel_name LIMIT ${per}`,
      ).bind(like),
      toHit: (r) => ({ kind: "hotel", id: Number(r.id), title: String(r.hotel_name), sub: `${r.company ?? ""}${r.company ? " · " : ""}${r.state}`, tab: "Hotels", status: (r.stage as string | null) ?? "lead", date: r.updated_at as string | null, dateIs: "updated" }),
    });
    stmts.push({
      kind: "contact",
      stmt: env.DB.prepare(
        `SELECT c.id, c.person_name, c.phone, c.email, h.hotel_name, h.id AS hotel_id, h.state, h.stage FROM hotel_contacts c
           JOIN hotels h ON h.id = c.hotel_id AND h.is_active = 1
          WHERE c.person_name LIKE ?1 ESCAPE '\\' OR c.email LIKE ?1 ESCAPE '\\'
             ${digits ? `OR ${DIGITS("c.phone")} LIKE ?2 OR ${DIGITS("c.phone2")} LIKE ?2` : ""}
          ORDER BY c.person_name LIMIT ${per}`,
      ).bind(...(digits ? [like, `%${digits}%`] : [like])),
      toHit: (r) => ({ kind: "contact", id: Number(r.hotel_id), title: String(r.person_name ?? "(no name)"), sub: `${r.hotel_name}${r.phone ? ` · ${r.phone}` : ""}${r.state ? ` · ${r.state}` : ""}`, tab: "Hotels", status: (r.stage as string | null) ?? "lead" }),
    });
  }
  if (allowed.has("staff")) {
    stmts.push({
      kind: "staff",
      stmt: env.DB.prepare(
        `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role, position, department, employee_id, photo_key, employment_status FROM users
          WHERE is_active = 1 AND role NOT IN ('customer')
            AND (name LIKE ?1 ESCAPE '\\' OR full_name LIKE ?1 ESCAPE '\\' OR position LIKE ?1 ESCAPE '\\' OR department LIKE ?1 ESCAPE '\\'
                 ${digits ? `OR ${DIGITS("phone")} LIKE ?2` : ""})
          ORDER BY name LIMIT ${per}`,
      ).bind(...(digits ? [like, `%${digits}%`] : [like])),
      toHit: (r) => ({ kind: "staff", id: Number(r.id), title: String(r.name), sub: [r.position ?? String(r.role).replace(/_/g, " "), r.department, r.employee_id].filter(Boolean).join(" · "), tab: "Staff Details",
        /* the directory's own words: a leaver is "left", everyone else working */
        status: ["resigned", "terminated"].includes(String(r.employment_status ?? "")) ? "left" : "active", photo: r.photo_key as string | null }),
    });
  }
  if (allowed.has("client")) {
    stmts.push({
      kind: "client",
      stmt: env.DB.prepare(
        `SELECT id, company, contact_person, phone, created_at FROM customers
          WHERE company LIKE ?1 ESCAPE '\\' OR contact_person LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\'
             ${digits ? `OR ${DIGITS("phone")} LIKE ?2` : ""}
          ORDER BY company LIMIT ${per}`,
      ).bind(...(digits ? [like, `%${digits}%`] : [like])),
      toHit: (r) => ({ kind: "client", id: Number(r.id), title: String(r.company), sub: [r.contact_person, r.phone].filter(Boolean).join(" · "), tab: "Sales", date: r.created_at as string | null, dateIs: "created" }),
    });
  }
  /* v1.205.0 - one statement per kind, so invoices are not crowded out of
     the cap by quotations, and each carries the status its own list shows:
     an invoice its payment, a delivery order its delivery */
  const docStmt = (kind: "document" | "invoice") => env.DB.prepare(
    `SELECT d.id, d.doc_type, d.doc_number, d.total_cents, d.payment_status, d.delivery_status, d.created_at, d.due_date, c.company FROM sales_documents d
       LEFT JOIN customers c ON c.id = d.customer_id
      WHERE (d.doc_number LIKE ?1 ESCAPE '\\' OR c.company LIKE ?1 ESCAPE '\\') AND ${kind === "invoice" ? "d.doc_type = 'INV'" : "d.doc_type != 'INV'"}
      ORDER BY d.id DESC LIMIT ${per}`,
  ).bind(like);
  const docHit = (kind: "document" | "invoice") => (r: Row): Hit => ({
    kind, id: Number(r.id), title: `${r.doc_type} ${r.doc_number}`, sub: `${r.company ?? ""}${r.company ? " · " : ""}RM ${(Number(r.total_cents) / 100).toFixed(2)}`, tab: "Sales",
    status: (r.doc_type === "INV" ? r.payment_status : r.doc_type === "DO" ? r.delivery_status : null) as string | null,
    date: r.created_at as string | null, dateIs: "created",
  });
  if (allowed.has("document")) stmts.push({ kind: "document", stmt: docStmt("document"), toHit: docHit("document") });
  if (allowed.has("invoice")) stmts.push({ kind: "invoice", stmt: docStmt("invoice"), toHit: docHit("invoice") });
  if (allowed.has("stock")) {
    stmts.push({
      kind: "stock",
      stmt: env.DB.prepare(
        `SELECT id, sku, name, stock, reorder_level, updated_at FROM inventory_items
          WHERE sku LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\'
          ORDER BY name LIMIT ${per}`,
      ).bind(like),
      toHit: (r) => ({ kind: "stock", id: Number(r.id), title: String(r.name), sub: `${r.sku} · ${r.stock} in stock`, tab: "Inventory",
        /* low = at or under the item's own reorder level (no level, no flag) */
        status: Number(r.stock) <= 0 ? "out" : r.reorder_level != null && Number(r.stock) <= Number(r.reorder_level) ? "low" : "in_stock", date: r.updated_at as string | null, dateIs: "updated" }),
    });
  }
  /* v1.153.0 - a removed typo (its tag carries #DEL<id>) is not a hit; the
     tag test rather than deleted_at so the batch survives pre-0126. */
  if (allowed.has("asset")) {
    stmts.push({
      kind: "asset",
      stmt: env.DB.prepare(
        `SELECT id, asset_tag, name, brand_model, serial_no, location, status, updated_at FROM assets
          WHERE (asset_tag LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\' OR brand_model LIKE ?1 ESCAPE '\\' OR serial_no LIKE ?1 ESCAPE '\\')
            AND asset_tag NOT LIKE '%#DEL%'
          ORDER BY name LIMIT ${per}`,
      ).bind(like),
      toHit: (r) => ({ kind: "asset", id: Number(r.id), title: `${r.asset_tag} — ${r.name}`, sub: [r.brand_model, r.location].filter(Boolean).join(" · "), tab: "Assets", status: r.status as string | null, date: r.updated_at as string | null, dateIs: "updated" }),
    });
  }
  /* tasks: managers search every task; everyone else, their own */
  const allTasks = can(user.role, "team_manage");
  if (allowed.has("task")) stmts.push({
    kind: "task",
    stmt: env.DB.prepare(
      `SELECT t.id, t.title, t.status, t.deadline, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS assignee FROM tasks t
         JOIN users u ON u.id = t.assigned_to
        WHERE (t.title LIKE ?1 ESCAPE '\\' OR t.description LIKE ?1 ESCAPE '\\')
          ${allTasks ? "" : "AND (t.assigned_to = ?2 OR t.created_by = ?2)"}
        ORDER BY t.id DESC LIMIT ${per}`,
    ).bind(...(allTasks ? [like] : [like, user.id])),
    toHit: (r) => ({ kind: "task", id: Number(r.id), title: String(r.title), sub: String(r.assignee), tab: "Tasks", status: r.status as string | null, date: r.deadline as string | null, dateIs: "due" }),
  });

  /* v1.205.0 - leave: the Leave tab's own rule (leaveSeesAll), everyone
     else their own. Matched on the applicant and the type; the reason is
     never searched and never returned (it is medical half the time). */
  const allLeave = leaveSeesAll(user.role);
  if (allowed.has("leave")) {
    stmts.push({
      kind: "leave",
      stmt: env.DB.prepare(
        `SELECT l.id, l.type, l.start_date, l.end_date, l.days, l.status, l.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS applicant FROM leave_requests l
           JOIN users u ON u.id = l.user_id
          WHERE (u.name LIKE ?1 ESCAPE '\\' OR u.full_name LIKE ?1 ESCAPE '\\' OR l.type LIKE ?1 ESCAPE '\\')
            ${allLeave ? "" : "AND l.user_id = ?2"}
          ORDER BY l.created_at DESC LIMIT ${per}`,
      ).bind(...(allLeave ? [like] : [like, user.id])),
      toHit: (r) => ({ kind: "leave", id: Number(r.id), title: String(r.type), sub: `${r.applicant} · ${r.start_date}${r.end_date && r.end_date !== r.start_date ? ` – ${r.end_date}` : ""}`, tab: "Leave", status: r.status as string | null, date: r.created_at as string | null, dateIs: "applied" }),
    });
  }
  /* v1.205.0 - claims: the GET /claims scope itself (claimScope). The amount
     is not returned: a figure stays on the claim, behind its own screen. */
  if (allowed.has("claim")) {
    const allClaims = can(user.role, "claims_decide");
    const scope = claimScope(user.role, allClaims, true, "?2");
    const match = `(u.name LIKE ?1 ESCAPE '\\' OR u.full_name LIKE ?1 ESCAPE '\\' OR c.description LIKE ?1 ESCAPE '\\' OR c.category LIKE ?1 ESCAPE '\\')`;
    stmts.push({
      kind: "claim",
      stmt: env.DB.prepare(
        `SELECT c.id, c.category, c.claim_date, c.status, c.paid_at, c.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS claimant FROM claims c
           LEFT JOIN users u ON u.id = c.user_id
          ${scope ? `${scope} AND ${match}` : `WHERE ${match}`}
          ORDER BY c.created_at DESC LIMIT ${per}`,
      ).bind(...(allClaims ? [like] : [like, user.id])),
      toHit: (r) => ({ kind: "claim", id: Number(r.id), title: String(r.category), sub: `${r.claimant} · ${r.claim_date}`, tab: "Claims", status: r.paid_at ? "paid" : r.status as string | null, date: r.created_at as string | null, dateIs: "created" }),
    });
  }

  /* One round-trip. A source whose table a pending migration has not created
     yet is dropped from the answer, not from the request - the v1.4.218
     lesson: never let one column blank a whole surface. */
  let rows: Row[][];
  try {
    rows = (await env.DB.batch<Row>(stmts.map((s) => s.stmt))).map((r) => r.results ?? []);
  } catch {
    rows = [];
    for (const s of stmts) {
      try { rows.push((await s.stmt.all<Row>()).results ?? []); } catch { rows.push([]); }
    }
  }
  const hits: Hit[] = [];
  rows.forEach((list, i) => {
    const src = stmts[i]!;
    for (const r of list) hits.push(src.toHit(r));
  });
  return json({ hits, q, sources: [...allowed] });
}

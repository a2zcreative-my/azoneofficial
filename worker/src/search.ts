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
 */

import type { Env } from "./index";
import { can } from "./permissions";

export interface Hit {
  kind: "hotel" | "contact" | "staff" | "client" | "document" | "order" | "stock" | "asset" | "task";
  id: number;
  title: string;
  sub: string;
  /** the registry tab where this thing lives */
  tab: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const PER_SOURCE = 6;
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
  if (can(role, "sales") || can(role, "inventory") || can(role, "exec_view")) out.push("order");
  if (can(role, "inventory")) out.push("stock");
  if (can(role, "hr_manage") || can(role, "exec_view")) out.push("asset");
  out.push("task"); // everyone: their own; managers: all
  return out;
}

export async function handleSearch(env: Env, user: { id: number; role: string }, params: URLSearchParams): Promise<Response> {
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  if (q.length < MIN_CHARS) return json({ hits: [], q });
  const like = likePattern(q);
  const digits = phoneDigits(q);
  const allowed = new Set(sourcesFor(user.role));

  type Row = Record<string, string | number | null>;
  const stmts: { kind: Hit["kind"]; stmt: D1PreparedStatement; toHit: (r: Row) => Hit }[] = [];

  if (allowed.has("hotel")) {
    stmts.push({
      kind: "hotel",
      stmt: env.DB.prepare(
        `SELECT id, hotel_name, company, state FROM hotels
          WHERE is_active = 1 AND (hotel_name LIKE ?1 ESCAPE '\\' OR company LIKE ?1 ESCAPE '\\' OR address LIKE ?1 ESCAPE '\\')
          ORDER BY hotel_name LIMIT ${PER_SOURCE}`,
      ).bind(like),
      toHit: (r) => ({ kind: "hotel", id: Number(r.id), title: String(r.hotel_name), sub: `${r.company ?? ""}${r.company ? " · " : ""}${r.state}`, tab: "Hotels" }),
    });
    stmts.push({
      kind: "contact",
      stmt: env.DB.prepare(
        `SELECT c.id, c.person_name, c.phone, c.email, h.hotel_name, h.id AS hotel_id FROM hotel_contacts c
           JOIN hotels h ON h.id = c.hotel_id AND h.is_active = 1
          WHERE c.person_name LIKE ?1 ESCAPE '\\' OR c.email LIKE ?1 ESCAPE '\\'
             ${digits ? `OR ${DIGITS("c.phone")} LIKE ?2 OR ${DIGITS("c.phone2")} LIKE ?2` : ""}
          ORDER BY c.person_name LIMIT ${PER_SOURCE}`,
      ).bind(...(digits ? [like, `%${digits}%`] : [like])),
      toHit: (r) => ({ kind: "contact", id: Number(r.hotel_id), title: String(r.person_name ?? "(no name)"), sub: `${r.hotel_name}${r.phone ? ` · ${r.phone}` : ""}`, tab: "Hotels" }),
    });
  }
  if (allowed.has("staff")) {
    stmts.push({
      kind: "staff",
      stmt: env.DB.prepare(
        `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role, position FROM users
          WHERE is_active = 1 AND role NOT IN ('customer')
            AND (name LIKE ?1 ESCAPE '\\' OR full_name LIKE ?1 ESCAPE '\\' OR position LIKE ?1 ESCAPE '\\' OR department LIKE ?1 ESCAPE '\\'
                 ${digits ? `OR ${DIGITS("phone")} LIKE ?2` : ""})
          ORDER BY name LIMIT ${PER_SOURCE}`,
      ).bind(...(digits ? [like, `%${digits}%`] : [like])),
      toHit: (r) => ({ kind: "staff", id: Number(r.id), title: String(r.name), sub: String(r.position ?? String(r.role).replace(/_/g, " ")), tab: "Staff Details" }),
    });
  }
  if (allowed.has("client")) {
    stmts.push({
      kind: "client",
      stmt: env.DB.prepare(
        `SELECT id, company, contact_person, phone FROM customers
          WHERE company LIKE ?1 ESCAPE '\\' OR contact_person LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\'
             ${digits ? `OR ${DIGITS("phone")} LIKE ?2` : ""}
          ORDER BY company LIMIT ${PER_SOURCE}`,
      ).bind(...(digits ? [like, `%${digits}%`] : [like])),
      toHit: (r) => ({ kind: "client", id: Number(r.id), title: String(r.company), sub: [r.contact_person, r.phone].filter(Boolean).join(" · "), tab: "Sales" }),
    });
  }
  if (allowed.has("document")) {
    stmts.push({
      kind: "document",
      stmt: env.DB.prepare(
        `SELECT d.id, d.doc_type, d.doc_number, d.total_cents, c.company FROM sales_documents d
           LEFT JOIN customers c ON c.id = d.customer_id
          WHERE d.doc_number LIKE ?1 ESCAPE '\\' OR c.company LIKE ?1 ESCAPE '\\'
          ORDER BY d.id DESC LIMIT ${PER_SOURCE}`,
      ).bind(like),
      toHit: (r) => ({ kind: "document", id: Number(r.id), title: `${r.doc_type} ${r.doc_number}`, sub: `${r.company ?? ""}${r.company ? " · " : ""}RM ${(Number(r.total_cents) / 100).toFixed(2)}`, tab: "Sales" }),
    });
  }
  if (allowed.has("order")) {
    stmts.push({
      kind: "order",
      stmt: env.DB.prepare(
        `SELECT id, order_number, customer_name, status, total_cents FROM web_orders
          WHERE order_number LIKE ?1 ESCAPE '\\' OR customer_name LIKE ?1 ESCAPE '\\' OR tracking_no LIKE ?1 ESCAPE '\\'
             ${digits ? `OR ${DIGITS("phone")} LIKE ?2` : ""}
          ORDER BY id DESC LIMIT ${PER_SOURCE}`,
      ).bind(...(digits ? [like, `%${digits}%`] : [like])),
      toHit: (r) => ({ kind: "order", id: Number(r.id), title: `#${r.order_number} — ${r.customer_name ?? ""}`, sub: `${r.status} · RM ${(Number(r.total_cents) / 100).toFixed(2)}`, tab: "Web Orders" }),
    });
  }
  if (allowed.has("stock")) {
    stmts.push({
      kind: "stock",
      stmt: env.DB.prepare(
        `SELECT id, sku, name, stock FROM inventory_items
          WHERE sku LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\'
          ORDER BY name LIMIT ${PER_SOURCE}`,
      ).bind(like),
      toHit: (r) => ({ kind: "stock", id: Number(r.id), title: String(r.name), sub: `${r.sku} · ${r.stock} in stock`, tab: "Inventory" }),
    });
  }
  if (allowed.has("asset")) {
    stmts.push({
      kind: "asset",
      stmt: env.DB.prepare(
        `SELECT id, asset_tag, name, brand_model, serial_no, location FROM assets
          WHERE asset_tag LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\' OR brand_model LIKE ?1 ESCAPE '\\' OR serial_no LIKE ?1 ESCAPE '\\'
          ORDER BY name LIMIT ${PER_SOURCE}`,
      ).bind(like),
      toHit: (r) => ({ kind: "asset", id: Number(r.id), title: `${r.asset_tag} — ${r.name}`, sub: [r.brand_model, r.location].filter(Boolean).join(" · "), tab: "Assets" }),
    });
  }
  /* tasks: managers search every task; everyone else, their own */
  const allTasks = can(user.role, "team_manage");
  stmts.push({
    kind: "task",
    stmt: env.DB.prepare(
      `SELECT t.id, t.title, t.status, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS assignee FROM tasks t
         JOIN users u ON u.id = t.assigned_to
        WHERE (t.title LIKE ?1 ESCAPE '\\' OR t.description LIKE ?1 ESCAPE '\\')
          ${allTasks ? "" : "AND (t.assigned_to = ?2 OR t.created_by = ?2)"}
        ORDER BY t.id DESC LIMIT ${PER_SOURCE}`,
    ).bind(...(allTasks ? [like] : [like, user.id])),
    toHit: (r) => ({ kind: "task", id: Number(r.id), title: String(r.title), sub: `${r.assignee} · ${String(r.status).replace(/_/g, " ")}`, tab: "Tasks" }),
  });

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

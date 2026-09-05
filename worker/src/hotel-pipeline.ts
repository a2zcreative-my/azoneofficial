/**
 * THE HOTEL PIPELINE — v1.110.0 (roadmap phase 05).
 *
 * The roadmap: *"You have 442 hotels, 690 named contacts and their mobile
 * numbers on one tab, and enquiries, quotations and invoices on another.
 * Nothing connects them, so the most valuable asset in the system is
 * currently a phone book."* This module is the connection: a call log on
 * each hotel, a link from a hotel to the client it became, the stage each
 * hotel is at, and the two questions the map can then answer that a phone
 * book cannot - where is the money, and who has not been called.
 *
 * STAGES advance by what happened, not by somebody remembering to move a
 * card: a call moves a lead to contacted, a "sent quote" outcome (or a linked
 * client with a quotation) moves it to quoted, a "won" outcome or a paid
 * invoice moves it to won. Lost and dormant are a person's call and are set
 * by hand. stageAfter() is the whole rule and is pure, so the guard runs it.
 *
 * WHO OWNS A HOTEL: the person who last called it, unless an owner is set.
 * This is how "your hotels" and "who has not been called" become personal
 * without an assignment screen nobody would fill in.
 *
 * A CALL IS QUEUEABLE (lib/outbox.ts): logged from a hotel lobby with one
 * bar of signal, it is kept and sent when the signal is back, at the time it
 * was pressed - the CEO chose this on 05-09-2026.
 */

import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit } from "./shared";
import { can } from "./permissions";

export const STAGES = ["lead", "contacted", "quoted", "won", "lost", "dormant"] as const;
export type Stage = (typeof STAGES)[number];
export const OUTCOMES = ["spoke", "no_answer", "callback", "not_interested", "meeting", "sent_quote", "won", "lost"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Where a hotel stands after a call with this outcome. Only ever moves
    FORWARD by itself - a no-answer after a quotation does not un-quote it -
    except that lost and not_interested are terminal by intent and win is
    win. lost/dormant set by hand stay put on ordinary calls. */
export function stageAfter(current: string, outcome: Outcome): Stage {
  const order: Stage[] = ["lead", "contacted", "quoted", "won"];
  const cur = (STAGES as readonly string[]).includes(current) ? (current as Stage) : "lead";
  if (outcome === "won") return "won";
  if (outcome === "lost" || outcome === "not_interested") return "lost";
  const target: Stage = outcome === "sent_quote" ? "quoted" : "contacted";
  if (cur === "lost" || cur === "dormant") return target;       // a call revives it
  if (cur === "won") return "won";
  return order.indexOf(target) > order.indexOf(cur) ? target : cur;
}

/** "Due for a call": the follow-up date has passed, or a worked hotel has
    gone quiet for `quietDays`. A never-called lead is not due - it is the
    worklist, not a lapse. */
export function isDue(h: { stage: string; next_at: string | null; last_contact_at: string | null }, today: string, quietDays = 90): boolean {
  if (h.next_at && h.next_at.slice(0, 10) <= today) return true;
  if ((h.stage === "contacted" || h.stage === "quoted") && h.last_contact_at) {
    const last = new Date(h.last_contact_at.replace(" ", "T") + "Z").getTime();
    return (Date.now() - last) / 86_400_000 > quietDays;
  }
  return false;
}

const str = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};
const isoDay = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Revenue and quotes per linked hotel, from the documents table, in one query. */
export async function moneyByHotel(env: Env, hotelIds: number[]): Promise<Map<number, { invoiced: number; paid: number; quoted: number; docs: number }>> {
  const out = new Map<number, { invoiced: number; paid: number; quoted: number; docs: number }>();
  if (hotelIds.length === 0) return out;
  try {
    const { results } = await env.DB.prepare(
      `SELECT h.id AS hotel_id, d.doc_type, d.total_cents, d.payment_status
         FROM hotels h JOIN sales_documents d ON d.customer_id = h.customer_id
        WHERE h.customer_id IS NOT NULL AND h.id IN (${hotelIds.map(() => "?").join(",")})`,
    ).bind(...hotelIds).all<{ hotel_id: number; doc_type: string; total_cents: number; payment_status: string | null }>();
    for (const r of results) {
      const m = out.get(r.hotel_id) ?? { invoiced: 0, paid: 0, quoted: 0, docs: 0 };
      m.docs++;
      if (r.doc_type === "QT") m.quoted += r.total_cents;
      if (r.doc_type === "INV") { m.invoiced += r.total_cents; if (r.payment_status === "paid") m.paid += r.total_cents; }
      out.set(r.hotel_id, m);
    }
  } catch { /* pre-0116 or no documents table: no money to show */ }
  return out;
}

export async function handleHotelPipeline(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams,
): Promise<Response | null> {
  const manage = can(user.role, "hotels_manage");
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  /* ---- the pipeline view: counts by stage and state, the due list ---- */
  if (path === "/pipeline" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, state, hotel_name, stage, last_contact_at, next_at, owner_id, customer_id FROM hotels WHERE is_active = 1`,
    ).all<{ id: number; state: string; hotel_name: string; stage: string; last_contact_at: string | null; next_at: string | null; owner_id: number | null; customer_id: number | null }>();
    const money = await moneyByHotel(env, results.filter((h) => h.customer_id).map((h) => h.id));
    const byStage: Record<string, number> = {};
    for (const s of STAGES) byStage[s] = 0;
    const byState: Record<string, { hotels: number; contacted: number; won: number; paid_cents: number; invoiced_cents: number; quoted_cents: number }> = {};
    const due: typeof results = [];
    for (const h of results) {
      byStage[h.stage] = (byStage[h.stage] ?? 0) + 1;
      const s = byState[h.state] ?? (byState[h.state] = { hotels: 0, contacted: 0, won: 0, paid_cents: 0, invoiced_cents: 0, quoted_cents: 0 });
      s.hotels++;
      if (h.stage !== "lead") s.contacted++;
      if (h.stage === "won") s.won++;
      const m = money.get(h.id);
      if (m) { s.paid_cents += m.paid; s.invoiced_cents += m.invoiced; s.quoted_cents += m.quoted; }
      if (isDue(h, today)) due.push(h);
    }
    due.sort((a, b) => (a.next_at ?? a.last_contact_at ?? "").localeCompare(b.next_at ?? b.last_contact_at ?? ""));
    return json({ by_stage: byStage, by_state: byState, due: due.slice(0, 100), today });
  }

  const m = path.match(/^\/(\d+)\/(calls|link|client|stage|pipeline)$/);
  if (!m) return null;
  const id = Number(m[1]);
  const leaf = m[2];
  const hotel = await env.DB.prepare(
    `SELECT id, hotel_name, state, stage, customer_id, last_contact_at, next_at, owner_id FROM hotels WHERE id = ?1 AND is_active = 1`,
  ).bind(id).first<{ id: number; hotel_name: string; state: string; stage: string; customer_id: number | null; last_contact_at: string | null; next_at: string | null; owner_id: number | null }>();
  if (!hotel) return err("not_found", "No such hotel", 404);

  /* ---- one hotel's pipeline: calls, client, documents ---- */
  if (leaf === "pipeline" && method === "GET") {
    const { results: calls } = await env.DB.prepare(
      `SELECT c.id, c.contact_id, c.called_at, c.outcome, c.notes, c.next_at,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS by_name, hc.person_name AS contact_name
         FROM hotel_calls c JOIN users u ON u.id = c.user_id
         LEFT JOIN hotel_contacts hc ON hc.id = c.contact_id
        WHERE c.hotel_id = ?1 ORDER BY c.called_at DESC LIMIT 100`,
    ).bind(id).all();
    let client: { id: number; company: string; contact_person: string | null; phone: string | null } | null = null;
    let docs: unknown[] = [];
    if (hotel.customer_id) {
      client = await env.DB.prepare(`SELECT id, company, contact_person, phone FROM customers WHERE id = ?1`).bind(hotel.customer_id).first();
      ({ results: docs } = await env.DB.prepare(
        `SELECT id, doc_type, doc_number, total_cents, payment_status, delivery_status, created_at FROM sales_documents WHERE customer_id = ?1 ORDER BY id DESC LIMIT 50`,
      ).bind(hotel.customer_id).all());
    }
    const money = (await moneyByHotel(env, hotel.customer_id ? [id] : [])).get(id) ?? { invoiced: 0, paid: 0, quoted: 0, docs: 0 };
    return json({ hotel, calls, client, docs, money, outcomes: OUTCOMES, stages: STAGES });
  }

  if (!manage) return err("forbidden", "Only management works the hotel pipeline", 403);

  /* ---- log a call ---- */
  if (leaf === "calls" && method === "POST") {
    const outcome = typeof body?.outcome === "string" ? body.outcome : "";
    if (!(OUTCOMES as readonly string[]).includes(outcome)) {
      return err("invalid_input", `outcome must be one of: ${OUTCOMES.join(", ")}`, 400);
    }
    const contactId = typeof body?.contact_id === "number" ? body.contact_id : null;
    if (contactId !== null) {
      const c = await env.DB.prepare(`SELECT id FROM hotel_contacts WHERE id = ?1 AND hotel_id = ?2`).bind(contactId, id).first();
      if (!c) return err("invalid_input", "That contact is not at this hotel", 400);
    }
    const nextAt = isoDay(body?.next_at);
    const notes = str(body?.notes, 1000);
    const newStage = stageAfter(hotel.stage, outcome as Outcome);
    const row = await env.DB.prepare(
      `INSERT INTO hotel_calls (hotel_id, contact_id, user_id, outcome, notes, next_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id, called_at`,
    ).bind(id, contactId, user.id, outcome, notes, nextAt).first<{ id: number; called_at: string }>();
    /* the denormalised facts the list sorts and filters by, and the owner:
       whoever last worked it, unless somebody was set */
    await env.DB.prepare(
      `UPDATE hotels SET stage = ?1, last_contact_at = ?2, next_at = ?3, owner_id = COALESCE(owner_id, ?4), updated_at = datetime('now') WHERE id = ?5`,
    ).bind(newStage, row?.called_at ?? new Date().toISOString().slice(0, 19).replace("T", " "), nextAt, user.id, id).run();
    await audit(env, user.id, "hotel.call", "hotels", String(id), { hotel_name: hotel.hotel_name, outcome, next_at: nextAt, stage: newStage });
    return json({ ok: true, id: row?.id, stage: newStage, next_at: nextAt });
  }

  /* ---- link to an existing client, or unlink ---- */
  if (leaf === "link" && method === "PUT") {
    const raw = body?.customer_id;
    const customerId = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    if (customerId !== null) {
      const c = await env.DB.prepare(`SELECT id, company FROM customers WHERE id = ?1`).bind(customerId).first<{ id: number; company: string }>();
      if (!c) return err("not_found", "No such client", 404);
    }
    await env.DB.prepare(`UPDATE hotels SET customer_id = ?1, updated_at = datetime('now') WHERE id = ?2`).bind(customerId, id).run();
    await audit(env, user.id, "hotel.link", "hotels", String(id), { hotel_name: hotel.hotel_name, from: hotel.customer_id, to: customerId });
    return json({ ok: true, customer_id: customerId });
  }

  /* ---- make a client FROM the hotel, and link it ---- */
  if (leaf === "client" && method === "POST") {
    if (hotel.customer_id) return err("invalid_state", "This hotel already has a client - unlink it first", 400);
    const first = await env.DB.prepare(
      `SELECT person_name, phone, email FROM hotel_contacts WHERE hotel_id = ?1 ORDER BY slot LIMIT 1`,
    ).bind(id).first<{ person_name: string | null; phone: string | null; email: string | null }>();
    const addr = await env.DB.prepare(`SELECT address, company FROM hotels WHERE id = ?1`).bind(id).first<{ address: string | null; company: string | null }>();
    const c = await env.DB.prepare(
      `INSERT INTO customers (company, contact_person, phone, email, address, notes, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
    ).bind(
      addr?.company || hotel.hotel_name, first?.person_name ?? null, first?.phone ?? null, first?.email ?? null, addr?.address ?? null,
      `Created from the hotel directory: ${hotel.hotel_name}, ${hotel.state}`, user.id,
    ).first<{ id: number }>();
    if (!c?.id) return err("server_error", "The client was not created", 500);
    await env.DB.prepare(`UPDATE hotels SET customer_id = ?1, updated_at = datetime('now') WHERE id = ?2`).bind(c.id, id).run();
    await audit(env, user.id, "hotel.client", "hotels", String(id), { hotel_name: hotel.hotel_name, customer_id: c.id });
    return json({ ok: true, customer_id: c.id });
  }

  /* ---- set the stage by hand: lost, dormant, or back to any ---- */
  if (leaf === "stage" && method === "PUT") {
    const stage = typeof body?.stage === "string" ? body.stage : "";
    if (!(STAGES as readonly string[]).includes(stage)) return err("invalid_input", `stage must be one of: ${STAGES.join(", ")}`, 400);
    await env.DB.prepare(`UPDATE hotels SET stage = ?1, updated_at = datetime('now') WHERE id = ?2`).bind(stage, id).run();
    await audit(env, user.id, "hotel.stage", "hotels", String(id), { hotel_name: hotel.hotel_name, from: hotel.stage, to: stage });
    return json({ ok: true, stage });
  }

  return null;
}

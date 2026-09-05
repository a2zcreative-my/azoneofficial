/**
 * THE HOTEL PIPELINE — v1.110.0 (roadmap phase 05), re-spoken in v1.111.0.
 *
 * The roadmap read the hotel list as a sales list - 442 hotels to sell
 * marketing to - and v1.110.0 built a pipeline in that language: quoted,
 * won, invoices, revenue on the map. The CEO, 05-09-2026, corrected it the
 * same hour: Hotels is a SEPARATE VENTURE, the review-content business -
 * hotel and Airbnb stays reviewed and published, in the manner of a food
 * reviewer - not the operating company. So the shape stays and the words
 * change. This module is the outreach: a call log on each hotel, the stage
 * each hotel is at on the way to a published review, and the two questions
 * the map can then answer that a phone book cannot - who has not been asked,
 * and where the published reviews are.
 *
 * STAGES advance by what happened, not by somebody remembering to move a
 * card: a call moves a lead to contacted, "a stay is agreed" to agreed, "we
 * stayed" to reviewed, "the review is out" to published. Declined is a
 * person's word and a later call revives it. stageAfter() is the whole rule
 * and is pure, so the guard runs it.
 *
 * WHO OWNS A HOTEL: the person who last called it, unless an owner is set.
 *
 * A CALL IS QUEUEABLE (lib/outbox.ts): logged from a hotel lobby with one
 * bar of signal, it is kept and sent when the signal is back, at the time it
 * was pressed - the CEO chose this on 05-09-2026.
 *
 * NOT IN HERE, DELIBERATELY: money. The customers / sales_documents link
 * from v1.110.0 is gone; the hotels.customer_id column it used stays on the
 * table unread (see migration 0117). The Watchers do not look at hotels
 * either - the operating company's rules do not run over this venture.
 */

import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit } from "./shared";
import { can } from "./permissions";

export const STAGES = ["lead", "contacted", "agreed", "reviewed", "published", "declined"] as const;
export type Stage = (typeof STAGES)[number];
export const OUTCOMES = ["spoke", "no_answer", "callback", "declined", "agreed", "stayed", "published"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Where a hotel stands after a call with this outcome. Only ever moves
    FORWARD by itself - a no-answer after a stay is agreed does not un-agree
    it. Declined is terminal by intent, but a later call revives it: a hotel
    that said no in March may say yes in September. */
export function stageAfter(current: string, outcome: Outcome): Stage {
  const order: Stage[] = ["lead", "contacted", "agreed", "reviewed", "published"];
  const cur = (STAGES as readonly string[]).includes(current) ? (current as Stage) : "lead";
  if (outcome === "declined") return "declined";
  const target: Stage = outcome === "published" ? "published" : outcome === "stayed" ? "reviewed" : outcome === "agreed" ? "agreed" : "contacted";
  if (cur === "declined") return target;                          // a call revives it
  return order.indexOf(target) > order.indexOf(cur) ? target : cur;
}

/** "Due for a call": the follow-up date has passed, or a hotel in
    conversation (contacted, or a stay agreed but not yet taken) has gone
    quiet for `quietDays`. A never-called lead is not due - it is the
    worklist, not a lapse. A published or declined hotel is finished. */
export function isDue(h: { stage: string; next_at: string | null; last_contact_at: string | null }, today: string, quietDays = 90): boolean {
  if (h.next_at && h.next_at.slice(0, 10) <= today) return true;
  if ((h.stage === "contacted" || h.stage === "agreed") && h.last_contact_at) {
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
/** A review link is kept only if it is an http(s) URL - a note goes in notes. */
const httpUrl = (v: unknown): string | null => {
  const s = str(v, 500);
  if (!s) return null;
  try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:" ? s : null; } catch { return null; }
};

type HotelRow = { id: number; hotel_name: string; state: string; stage: string; last_contact_at: string | null; next_at: string | null; owner_id: number | null; review_url: string | null };

export async function handleHotelPipeline(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams,
): Promise<Response | null> {
  void params;
  const manage = can(user.role, "hotels_manage");
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  /* ---- the pipeline view: counts by stage and state, the due list ---- */
  if (path === "/pipeline" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, state, hotel_name, stage, last_contact_at, next_at, owner_id, review_url FROM hotels WHERE is_active = 1`,
    ).all<HotelRow>();
    const byStage: Record<string, number> = {};
    for (const s of STAGES) byStage[s] = 0;
    const byState: Record<string, { hotels: number; contacted: number; agreed: number; published: number }> = {};
    const due: HotelRow[] = [];
    for (const h of results) {
      byStage[h.stage] = (byStage[h.stage] ?? 0) + 1;
      const s = byState[h.state] ?? (byState[h.state] = { hotels: 0, contacted: 0, agreed: 0, published: 0 });
      s.hotels++;
      if (h.stage !== "lead") s.contacted++;
      if (h.stage === "agreed" || h.stage === "reviewed") s.agreed++;
      if (h.stage === "published") s.published++;
      if (isDue(h, today)) due.push(h);
    }
    due.sort((a, b) => (a.next_at ?? a.last_contact_at ?? "").localeCompare(b.next_at ?? b.last_contact_at ?? ""));
    return json({ by_stage: byStage, by_state: byState, due: due.slice(0, 100), today });
  }

  const m = path.match(/^\/(\d+)\/(calls|stage|pipeline)$/);
  if (!m) return null;
  const id = Number(m[1]);
  const leaf = m[2];
  const hotel = await env.DB.prepare(
    `SELECT id, hotel_name, state, stage, last_contact_at, next_at, owner_id, review_url FROM hotels WHERE id = ?1 AND is_active = 1`,
  ).bind(id).first<HotelRow>();
  if (!hotel) return err("not_found", "No such hotel", 404);

  /* ---- one hotel's pipeline: the call log ---- */
  if (leaf === "pipeline" && method === "GET") {
    const { results: calls } = await env.DB.prepare(
      `SELECT c.id, c.contact_id, c.called_at, c.outcome, c.notes, c.next_at,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS by_name, hc.person_name AS contact_name
         FROM hotel_calls c JOIN users u ON u.id = c.user_id
         LEFT JOIN hotel_contacts hc ON hc.id = c.contact_id
        WHERE c.hotel_id = ?1 ORDER BY c.called_at DESC LIMIT 100`,
    ).bind(id).all();
    return json({ hotel, calls, outcomes: OUTCOMES, stages: STAGES });
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
    const reviewUrl = httpUrl(body?.review_url);
    if (body?.review_url && !reviewUrl) return err("invalid_input", "The review link must be a full http(s) address", 400);
    const newStage = stageAfter(hotel.stage, outcome as Outcome);
    const row = await env.DB.prepare(
      `INSERT INTO hotel_calls (hotel_id, contact_id, user_id, outcome, notes, next_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id, called_at`,
    ).bind(id, contactId, user.id, outcome, notes, nextAt).first<{ id: number; called_at: string }>();
    /* the denormalised facts the list sorts and filters by, the owner
       (whoever last worked it, unless somebody was set) and, when the review
       is out, where it lives */
    await env.DB.prepare(
      `UPDATE hotels SET stage = ?1, last_contact_at = ?2, next_at = ?3, owner_id = COALESCE(owner_id, ?4), review_url = COALESCE(?5, review_url), updated_at = datetime('now') WHERE id = ?6`,
    ).bind(newStage, row?.called_at ?? new Date().toISOString().slice(0, 19).replace("T", " "), nextAt, user.id, reviewUrl, id).run();
    await audit(env, user.id, "hotel.call", "hotels", String(id), { hotel_name: hotel.hotel_name, outcome, next_at: nextAt, stage: newStage, review_url: reviewUrl });
    return json({ ok: true, id: row?.id, stage: newStage, next_at: nextAt, review_url: reviewUrl ?? hotel.review_url });
  }

  /* ---- set the stage by hand (declined, or a correction), and the review link ---- */
  if (leaf === "stage" && method === "PUT") {
    const stage = typeof body?.stage === "string" ? body.stage : hotel.stage;
    if (!(STAGES as readonly string[]).includes(stage)) return err("invalid_input", `stage must be one of: ${STAGES.join(", ")}`, 400);
    const hasUrl = body !== null && Object.prototype.hasOwnProperty.call(body, "review_url");
    const reviewUrl = hasUrl ? httpUrl(body?.review_url) : hotel.review_url;
    if (hasUrl && body?.review_url && !reviewUrl) return err("invalid_input", "The review link must be a full http(s) address", 400);
    await env.DB.prepare(`UPDATE hotels SET stage = ?1, review_url = ?2, updated_at = datetime('now') WHERE id = ?3`).bind(stage, reviewUrl, id).run();
    await audit(env, user.id, "hotel.stage", "hotels", String(id), { hotel_name: hotel.hotel_name, from: hotel.stage, to: stage, review_url: reviewUrl });
    return json({ ok: true, stage, review_url: reviewUrl });
  }

  return null;
}

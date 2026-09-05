/**
 * THE HOTEL DIRECTORY — v1.100.0.
 *
 * CEO, 05-09-2026, with 1. DATA HOTEL.xlsx: *"add new tabs for save all this
 * data list, make sure that it is being listed by State ... Validate the
 * state based on the tabsheet of the excel."*
 *
 * A sales list, not a CRM: who to call at 442 hotels, kept by state because
 * that is how the territory is worked. Everything here is a plain CRUD over
 * two tables (0111) with three rules that are worth the words:
 *
 *   1. STATE IS A CLOSED LIST. MY_STATES is the workbook's fifteen sheet
 *      names, and it is the SAME list the migration's CHECK constraint holds.
 *      A state that is not on it is refused at the route with the list in the
 *      message, rather than being written and quietly disappearing from every
 *      view that groups by state. tests/hotels-guard.mjs holds the two
 *      copies together.
 *
 *   2. A PHONE IS STORED IN MALAYSIAN FORM. `formatMyPhone` is the one place
 *      that decides what that means - 01X-XXX XXXX for a mobile, 0X-XXXX XXXX
 *      for a landline, +60 and 60 accepted on the way in - so the seeded rows
 *      and anything typed later look the same in the table and dial the same
 *      from a phone. A number it cannot make sense of is kept verbatim rather
 *      than mangled or dropped: a bad number somebody can read and fix beats
 *      a good number the parser ate.
 *
 *   3. DELETE IS SOFT. is_active = 0. A contact list is weeks of somebody's
 *      work and a mis-click is not a reason to lose it; the row stays,
 *      audited, and can be restored.
 *
 * Every mutation is audited (guard #25) and every one of them needs
 * hotels_manage; reading needs hotels_view. Both are the management tier the
 * CEO named: CEO, COO, CCO, hr_admin, admin, super_admin.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit } from "./shared";
import { can } from "./permissions";
import { handleHotelPipeline, moneyByHotel, isDue, STAGES } from "./hotel-pipeline"; // v1.110.0

/** The workbook's fifteen sheet names, in the workbook's own order. The
    migration's CHECK constraint carries the same fifteen; the guard fails
    the build if the two ever disagree. */
export const MY_STATES = [
  "KUALA LUMPUR", "SELANGOR", "PUTRAJAYA", "NEGERI SEMBILAN", "JOHOR",
  "MELAKA", "KEDAH", "PERAK", "PERLIS", "TERENGGANU", "PULAU PINANG",
  "PAHANG", "KELANTAN", "SABAH", "SARAWAK",
] as const;
export type MyState = (typeof MY_STATES)[number];

const isState = (v: unknown): v is MyState =>
  typeof v === "string" && (MY_STATES as readonly string[]).includes(v.trim().toUpperCase());

/**
 * A Malaysian number, written the way a Malaysian writes it.
 *
 * Accepts 0123456789, 60123456789, +60 12-345 6789, spaces, dashes and an
 * "ext" tail. Returns null for empty. Returns the input trimmed when it
 * cannot be understood - see rule 2 in the header: a number nobody can dial
 * is better than a number nobody can see.
 */
export function formatMyPhone(raw: string | null | undefined): string | null {
  const src = (raw ?? "").trim();
  if (!src) return null;
  const extMatch = /(?:ext|sambungan|samb)\.?\s*:?\s*(\d{1,6})/i.exec(src);
  const ext = extMatch ? extMatch[1] : "";
  const head = src.split(/ext|EXT|Ext|samb|Samb/)[0] ?? src;
  let d = head.replace(/\D/g, "");
  if (!d) return src.slice(0, 40);
  if (d.startsWith("60")) d = `0${d.slice(2)}`;
  if (!d.startsWith("0")) d = `0${d}`;
  let out = "";
  if (d.startsWith("01")) {
    if (d.length === 10) out = `${d.slice(0, 3)}-${d.slice(3, 6)} ${d.slice(6)}`;
    else if (d.length === 11) out = `${d.slice(0, 3)}-${d.slice(3, 7)} ${d.slice(7)}`;
  } else if (d.startsWith("03")) {
    if (d.length === 10) out = `${d.slice(0, 2)}-${d.slice(2, 6)} ${d.slice(6)}`;
    else if (d.length === 9) out = `${d.slice(0, 2)}-${d.slice(2, 5)} ${d.slice(5)}`;
  } else if (/^08[2-9]/.test(d)) {
    /* Sabah and Sarawak carry a three-digit area code. */
    if (d.length === 9 || d.length === 10) out = `${d.slice(0, 3)}-${d.slice(3, 6)} ${d.slice(6)}`;
  } else if (/^0[4-9]/.test(d)) {
    if (d.length === 9) out = `${d.slice(0, 2)}-${d.slice(2, 5)} ${d.slice(5)}`;
    else if (d.length === 10) out = `${d.slice(0, 2)}-${d.slice(2, 6)} ${d.slice(6)}`;
  }
  if (!out) return src.slice(0, 40);
  return ext ? `${out} ext ${ext}` : out;
}

/** An email, or null. Not a validator anyone can argue with - it refuses the
    things that are certainly not an address and keeps the rest. */
export function cleanEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s.slice(0, 160) : null;
}

interface ContactIn { person_name?: unknown; phone?: unknown; phone2?: unknown; email?: unknown }

const str = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

/** The contacts a request is asking to store, cleaned. At most six: the
    workbook's widest sheet has four and a hotel with six people to ring is a
    hotel somebody should be phoning, not filing. */
function contactsFrom(body: Record<string, unknown> | null): { person_name: string | null; phone: string | null; phone2: string | null; email: string | null }[] {
  const raw = Array.isArray(body?.contacts) ? (body!.contacts as ContactIn[]) : [];
  return raw.slice(0, 6).map((c) => ({
    person_name: str(c?.person_name, 120),
    phone: formatMyPhone(typeof c?.phone === "string" ? c.phone : null),
    phone2: formatMyPhone(typeof c?.phone2 === "string" ? c.phone2 : null),
    email: cleanEmail(typeof c?.email === "string" ? c.email : null),
  })).filter((c) => c.person_name || c.phone || c.phone2 || c.email);
}

interface HotelRow {
  id: number; state: string; hotel_name: string; company: string | null; address: string | null;
  rooms: number | null; stars: string | null; mof_validity: string | null; halal_validity: string | null;
  notes: string | null; updated_at: string;
  /* v1.110.0 - pipeline (0116); absent on a database without it */
  stage?: string; customer_id?: number | null; last_contact_at?: string | null; next_at?: string | null; owner_id?: number | null;
}

async function writeContacts(env: Env, hotelId: number, contacts: ReturnType<typeof contactsFrom>): Promise<void> {
  const stmts = [env.DB.prepare(`DELETE FROM hotel_contacts WHERE hotel_id = ?1`).bind(hotelId)];
  contacts.forEach((c, i) => {
    stmts.push(env.DB.prepare(
      `INSERT INTO hotel_contacts (hotel_id, slot, person_name, phone, phone2, email) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(hotelId, i + 1, c.person_name, c.phone, c.phone2, c.email));
  });
  await env.DB.batch(stmts);
}

export async function handleHotels(
  env: Env,
  path: string, // stripped of /hotels, starts with / (or is empty)
  method: string,
  body: Record<string, unknown> | null,
  user: StaffUser,
  params: URLSearchParams,
): Promise<Response | null> {
  if (!can(user.role, "hotels_view")) return err("forbidden", "No access to the hotel directory", 403);
  const manage = can(user.role, "hotels_manage");

  try {
    /* ---- v1.110.0 - the pipeline: calls, client link, stage, the due list.
       A door into hotel-pipeline.ts; this file stays the directory. ---- */
    if (path === "/pipeline" || /^\/\d+\/(calls|link|client|stage|pipeline)$/.test(path)) {
      const res = await handleHotelPipeline(env, path, method, body, user, params);
      if (res) return res;
    }

    /* ---- the list, and the per-state counts the map is drawn from ---- */
    if ((path === "" || path === "/") && method === "GET") {
      const stateQ = params.get("state");
      const state = stateQ && isState(stateQ) ? stateQ.trim().toUpperCase() : null;
      const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 80);

      /* v1.110.0 - the pipeline columns ride along (0116). A database without
         them yet answers the directory as it always did. */
      let hotels: HotelRow[];
      try {
        ({ results: hotels } = await env.DB.prepare(
          `SELECT id, state, hotel_name, company, address, rooms, stars, mof_validity, halal_validity, notes, updated_at,
                  stage, customer_id, last_contact_at, next_at, owner_id
             FROM hotels WHERE is_active = 1 ${state ? "AND state = ?1" : ""}
            ORDER BY state, hotel_name`,
        ).bind(...(state ? [state] : [])).all<HotelRow>());
      } catch (e116) {
        if (!String(e116).includes("no such column")) throw e116;
        ({ results: hotels } = await env.DB.prepare(
          `SELECT id, state, hotel_name, company, address, rooms, stars, mof_validity, halal_validity, notes, updated_at
             FROM hotels WHERE is_active = 1 ${state ? "AND state = ?1" : ""}
            ORDER BY state, hotel_name`,
        ).bind(...(state ? [state] : [])).all<HotelRow>());
      }

      const ids = hotels.map((h) => h.id);
      let contacts: { id: number; hotel_id: number; slot: number; person_name: string | null; phone: string | null; phone2: string | null; email: string | null }[] = [];
      if (ids.length) {
        /* One query for every contact on the page rather than one per hotel:
           442 hotels is 442 round trips the other way. */
        const { results } = await env.DB.prepare(
          `SELECT c.id, c.hotel_id, c.slot, c.person_name, c.phone, c.phone2, c.email
             FROM hotel_contacts c JOIN hotels h ON h.id = c.hotel_id
            WHERE h.is_active = 1 ${state ? "AND h.state = ?1" : ""}
            ORDER BY c.hotel_id, c.slot`,
        ).bind(...(state ? [state] : [])).all<typeof contacts[number]>();
        contacts = results;
      }
      const byHotel = new Map<number, typeof contacts>();
      for (const c of contacts) byHotel.set(c.hotel_id, [...(byHotel.get(c.hotel_id) ?? []), c]);

      const rows = hotels.map((h) => ({ ...h, contacts: byHotel.get(h.id) ?? [] }));
      /* The search runs over the hotel AND its people, because "who do we
         know at the Hilton" and "which hotel does Aida work at" are the same
         question asked from two ends. */
      let filtered = q
        ? rows.filter((h) =>
            [h.hotel_name, h.company, h.address, h.state].some((v) => (v ?? "").toLowerCase().includes(q))
            || h.contacts.some((c) => [c.person_name, c.phone, c.phone2, c.email].some((v) => (v ?? "").toLowerCase().includes(q))))
        : rows;
      /* v1.110.0 - the pipeline filters: ?stage=lead|contacted|quoted|won|lost|dormant
         and ?due=1 (follow-up date passed, or a worked hotel quiet 90 days). */
      const stageF = params.get("stage");
      if (stageF && (STAGES as readonly string[]).includes(stageF)) filtered = filtered.filter((h) => (h.stage ?? "lead") === stageF);
      if (params.get("due") === "1") {
        const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        filtered = filtered.filter((h) => isDue({ stage: h.stage ?? "lead", next_at: h.next_at ?? null, last_contact_at: h.last_contact_at ?? null }, today));
      }
      const money = await moneyByHotel(env, filtered.filter((h) => h.customer_id).map((h) => h.id));
      const withMoney = filtered.map((h) => ({ ...h, money: money.get(h.id) ?? null }));

      const { results: counts } = await env.DB.prepare(
        `SELECT state, COUNT(*) AS n FROM hotels WHERE is_active = 1 GROUP BY state`,
      ).all<{ state: string; n: number }>();
      const byState: Record<string, number> = {};
      for (const s of MY_STATES) byState[s] = 0;
      for (const c of counts) byState[c.state] = c.n;

      /* v1.110.0 - per-state money for the map's second colouring */
      const stateMoney: Record<string, { paid_cents: number; invoiced_cents: number; quoted_cents: number; contacted: number; won: number }> = {};
      try {
        const { results: pm } = await env.DB.prepare(
          `SELECT h.state, d.doc_type, d.total_cents, d.payment_status FROM hotels h JOIN sales_documents d ON d.customer_id = h.customer_id
            WHERE h.is_active = 1 AND h.customer_id IS NOT NULL`,
        ).all<{ state: string; doc_type: string; total_cents: number; payment_status: string | null }>();
        const { results: ps } = await env.DB.prepare(
          `SELECT state, SUM(CASE WHEN stage != 'lead' THEN 1 ELSE 0 END) AS contacted, SUM(CASE WHEN stage = 'won' THEN 1 ELSE 0 END) AS won FROM hotels WHERE is_active = 1 GROUP BY state`,
        ).all<{ state: string; contacted: number; won: number }>();
        for (const st of MY_STATES) stateMoney[st] = { paid_cents: 0, invoiced_cents: 0, quoted_cents: 0, contacted: 0, won: 0 };
        for (const r of ps) if (stateMoney[r.state]) { stateMoney[r.state]!.contacted = r.contacted; stateMoney[r.state]!.won = r.won; }
        for (const r of pm) {
          const sm = stateMoney[r.state]; if (!sm) continue;
          if (r.doc_type === "QT") sm.quoted_cents += r.total_cents;
          if (r.doc_type === "INV") { sm.invoiced_cents += r.total_cents; if (r.payment_status === "paid") sm.paid_cents += r.total_cents; }
        }
      } catch { /* pre-0116 */ }

      return json({
        hotels: withMoney, total: rows.length, states: MY_STATES, by_state: byState, state_money: stateMoney,
        can_manage: manage,
      });
    }

    /* ---- create ---- */
    if ((path === "" || path === "/") && method === "POST") {
      if (!manage) return err("forbidden", "Only management edits the hotel directory", 403);
      const state = typeof body?.state === "string" ? body.state.trim().toUpperCase() : "";
      if (!isState(state)) {
        return err("invalid_input", `state must be one of: ${MY_STATES.join(", ")}`, 400);
      }
      const name = str(body?.hotel_name, 160);
      if (!name) return err("invalid_input", "The hotel needs a name", 400);
      const rooms = typeof body?.rooms === "number" && body.rooms >= 0 ? Math.round(body.rooms) : null;
      const row = await env.DB.prepare(
        `INSERT INTO hotels (state, hotel_name, company, address, rooms, stars, mof_validity, halal_validity, notes, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
      ).bind(
        state, name, str(body?.company, 160), str(body?.address, 300), rooms,
        str(body?.stars, 20), str(body?.mof_validity, 40), str(body?.halal_validity, 40),
        str(body?.notes, 500), user.id,
      ).first<{ id: number }>();
      const id = row?.id ?? 0;
      if (!id) return err("server_error", "The hotel was not created", 500);
      await writeContacts(env, id, contactsFrom(body));
      await audit(env, user.id, "hotel.create", "hotels", String(id), { state, hotel_name: name });
      return json({ ok: true, id }, 201);
    }

    /* ---- edit ---- */
    {
      const m = path.match(/^\/(\d+)$/);
      if (m && (method === "PUT" || method === "POST")) {
        if (!manage) return err("forbidden", "Only management edits the hotel directory", 403);
        const id = Number(m[1]);
        const before = await env.DB.prepare(`SELECT id, state, hotel_name FROM hotels WHERE id = ?1 AND is_active = 1`)
          .bind(id).first<{ id: number; state: string; hotel_name: string }>();
        if (!before) return err("not_found", "No such hotel", 404);
        const state = typeof body?.state === "string" ? body.state.trim().toUpperCase() : "";
        if (!isState(state)) {
          return err("invalid_input", `state must be one of: ${MY_STATES.join(", ")}`, 400);
        }
        const name = str(body?.hotel_name, 160);
        if (!name) return err("invalid_input", "The hotel needs a name", 400);
        const rooms = typeof body?.rooms === "number" && body.rooms >= 0 ? Math.round(body.rooms) : null;
        await env.DB.prepare(
          `UPDATE hotels SET state = ?1, hotel_name = ?2, company = ?3, address = ?4, rooms = ?5,
                  stars = ?6, mof_validity = ?7, halal_validity = ?8, notes = ?9, updated_at = datetime('now')
            WHERE id = ?10`,
        ).bind(
          state, name, str(body?.company, 160), str(body?.address, 300), rooms,
          str(body?.stars, 20), str(body?.mof_validity, 40), str(body?.halal_validity, 40),
          str(body?.notes, 500), id,
        ).run();
        await writeContacts(env, id, contactsFrom(body));
        await audit(env, user.id, "hotel.update", "hotels", String(id), {
          state, hotel_name: name, was_state: before.state, was_name: before.hotel_name,
        });
        return json({ ok: true });
      }
    }

    /* ---- delete: soft, and audited with what it was ---- */
    {
      const m = path.match(/^\/(\d+)$/);
      if (m && method === "DELETE") {
        if (!manage) return err("forbidden", "Only management edits the hotel directory", 403);
        const id = Number(m[1]);
        const before = await env.DB.prepare(`SELECT hotel_name, state FROM hotels WHERE id = ?1 AND is_active = 1`)
          .bind(id).first<{ hotel_name: string; state: string }>();
        if (!before) return err("not_found", "No such hotel", 404);
        await env.DB.prepare(`UPDATE hotels SET is_active = 0, updated_at = datetime('now') WHERE id = ?1`).bind(id).run();
        await audit(env, user.id, "hotel.delete", "hotels", String(id), { hotel_name: before.hotel_name, state: before.state });
        return json({ ok: true, removed: before.hotel_name });
      }
    }

    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such table: hotels/.test(msg)) {
      return json({ hotels: [], states: MY_STATES, by_state: {}, pending_migration: true, migration: "0111_hotels" });
    }
    return err("server_error", msg, 500);
  }
}

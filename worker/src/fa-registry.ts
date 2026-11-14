/* v1.286.0 - FINANCIAL ADVISORY: BANK, BRANCH AND BANKER REGISTRY (the CEO,
   12-11-2026: "proceed with Banker Registration, Branch Network & Smart
   Allocation Blueprint v1.1", decisions B1-B12 as recommended; stage 1 of
   B2 - the registries and the directory. Matching and internal allocation
   are stage 2; sending anything to a banker stays switched off).

   ONE bank registry, ONE branch registry, ONE banker directory:
     - a bank is one row, found again by its name however it is written
       ("Bank A Berhad", "BANK  A" -> the same key); retired, never deleted
     - a branch belongs to one bank; placed by a controlled state, district
       and city (fa_localities, states from MY_STATE_NAMES) and a postcode
       checked against the state; coordinates only with their source; closed
       or renamed, never deleted
     - a banker has one stable record with work contact only; the same work
       email can never be registered twice, the same work phone needs a
       written reason, a name alone never merges anyone
     - where a banker works is a dated assignment (fa_banker_branches): a
       transfer ends one and starts another, history is never rewritten
     - four facts stay apart: contact identity verified and referral
       permission confirmed (fa_banker_verifications, append only, each with
       method, evidence, reviewer and a next review date), product criteria
       (fa_criteria), and availability (a dated statement, Unknown after 30
       days)
     - nobody verifies a banker they registered themselves, the verified
       company owner apart (B3); registering never verifies, never creates a
       login and never sends anything
   Every change writes fa_registry_events (append only) and the audit log. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit, str } from "./shared";
import { can } from "./permissions";
import { MY_STATE_NAMES, stateFromPostcode } from "./my-state";
import { isExecutiveOwner } from "./decision-policy";

const PRODUCTS = ["personal_financing", "debt_consolidation"] as const;
const BANK_KINDS = ["commercial", "islamic", "dfi", "cooperative", "other"];
const RELATIONSHIPS = ["direct", "referral", "central_unit", "other"];
const AVAILABILITY = ["available", "limited", "unavailable", "unknown"];
const COVERAGE = ["branch", "districts", "states", "national"];
const VERIFY_METHODS = ["call_branch_line", "bank_domain_email", "in_person", "written_letter", "other"];
const CHANNELS = ["work_email", "work_phone", "whatsapp_work", "in_person"];
const ACTIVE_ALLOC = ["draft", "pending_review", "assigned", "awaiting_consent", "ready"];
/** v1.300.0 (D-3) - how many measured replies a banker needs before a reply time is shown */
export const REPLY_MIN_N = 3;
/** the median hours from an enquiry sent to the first feedback recorded on it; null below REPLY_MIN_N - never a guess */
export function replyStats(hours: number[]): { median_hours: number | null; n: number } {
  const n = hours.length;
  if (n < REPLY_MIN_N) return { median_hours: null, n };
  const s = [...hours].sort((a, z) => a - z);
  const mid = Math.floor(n / 2);
  const med = n % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return { median_hours: Math.round(med * 10) / 10, n };
}

export const REVIEW_MONTHS = 12; // B4
export const AVAILABILITY_STALE_DAYS = 30; // B5

const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
/** v1.288.0 - the same Malaysian today, for fa-match.ts */
export const todayMyt = mytToday;
const validDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const addMonths = (d: string, m: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCMonth(t.getUTCMonth() + m); return t.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const text = (v: unknown, max: number) => (str(v, max) ? String(v).trim() : "");
const titleWords = (s: string) => s.trim().replace(/\s+/g, " ");

/** A bank's name as a key: case, spacing, punctuation and "Berhad"/"Bhd" do not make a second bank. */
export const bankKey = (name: string) => name.toLowerCase().replace(/\b(berhad|bhd|sdn|plc|limited|ltd)\b/g, " ").replace(/[^a-z0-9]+/g, "");
/** A branch's name as a key: "JB City Branch" and "jb city" are the same branch name. */
export const branchKey = (name: string) => name.toLowerCase().replace(/\b(branch|cawangan)\b/g, " ").replace(/[^a-z0-9]+/g, "");
export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, " ").trim();
export const emailKey = (e: string) => e.trim().toLowerCase();
/** a Malaysian phone as digits, +60 and 60 read as the leading 0 */
export const phoneKey = (p: string) => { const d = p.replace(/\D/g, ""); return d.startsWith("60") ? `0${d.slice(2)}` : d; };
const placeKey = (state: string, district: string, city: string) => [state, district, city].map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "")).join("|");

interface Bank { id: number; name: string; status: string }
interface Banker {
  id: number; bank_id: number; full_name: string; status: string; availability: string; availability_on: string | null; unavailable_until: string | null;
  case_limit: number | null; owner_id: number | null; registered_by: number; email_key: string | null; phone_key: string | null;
}
interface Verification { banker_id: number; fact: string; verified_on: string; next_review_on: string; method: string; restrictions: string | null; verified_by_name?: string | null; created_at?: string }

/** v1.290.0 (G3) - a contact identity confirmed BEFORE the banker's work
    email or phone last changed no longer counts: the new contact is verified
    again. The verification row itself stays as it was (append only). */
export function identityStands<T extends { created_at?: string } | null>(identity: T, contactChangedAt: string | null | undefined): T | null {
  if (!identity || !contactChangedAt) return identity;
  return identity.created_at && identity.created_at > contactChangedAt ? identity : null;
}
/** the last time a banker's work email or phone changed (null before 0186, or never) */
export async function contactChangedAt(env: Env, bankerId: number): Promise<string | null> {
  try { return (await env.DB.prepare(`SELECT MAX(created_at) AS at FROM fa_banker_contact_changes WHERE banker_id = ?1`).bind(bankerId).first<{ at: string | null }>())?.at ?? null; }
  catch { return null; }
}

/** The banker's directory status - worked out from the facts, never typed. */
export function bankerStatus(b: { status: string }, identity: Verification | null, referral: Verification | null, today: string, contactChanged: string | null = null): string {
  if (b.status === "left") return "no_longer_available";
  if (b.status === "inactive") return "inactive";
  identity = identityStands(identity, contactChanged);
  if (!identity) return "pending_verification";
  if (identity.next_review_on < today || (referral && referral.next_review_on < today)) return "requires_reverification";
  return "verified";
}
/** Availability as Sales may rely on it: a statement older than 30 days, or an ended absence, is Unknown. */
export function availabilityNow(b: { availability: string; availability_on: string | null; unavailable_until: string | null }, today: string): string {
  if (!b.availability_on || daysBetween(b.availability_on, today) > AVAILABILITY_STALE_DAYS) return "unknown";
  if (b.availability === "unavailable" && b.unavailable_until && b.unavailable_until < today) return "unknown";
  return b.availability;
}

async function regEvent(env: Env, entity: string, id: number, ev: string, actor: number, detail: Record<string, unknown> | null = null): Promise<void> {
  await env.DB.prepare(`INSERT INTO fa_registry_events (entity, entity_id, event, detail, actor_id) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(entity, id, ev, detail ? JSON.stringify(detail) : null, actor).run();
}
const bankOf = (env: Env, id: unknown) => (typeof id === "number" ? env.DB.prepare(`SELECT id, name, status FROM fa_banks WHERE id = ?1`).bind(id).first<Bank>() : Promise.resolve(null));
const bankerOf = (env: Env, id: number) => env.DB.prepare(`SELECT * FROM fa_bankers WHERE id = ?1`).bind(id).first<Banker>();
async function latestFacts(env: Env, bankerId: number): Promise<{ identity: Verification | null; referral: Verification | null }> {
  const { results } = await env.DB.prepare(
    `SELECT v.*, ${PERSON("u")} AS verified_by_name FROM fa_banker_verifications v LEFT JOIN users u ON u.id = v.verified_by WHERE v.banker_id = ?1 ORDER BY v.id DESC`,
  ).bind(bankerId).all<Verification>();
  const list = results ?? [];
  /* v1.290.0 - an identity confirmed before the contact last changed no longer counts */
  return { identity: identityStands(list.find((v) => v.fact === "identity") ?? null, await contactChangedAt(env, bankerId)), referral: list.find((v) => v.fact === "referral") ?? null };
}
/** areas a coverage names: states from the controlled list, districts as typed in the locality list */
function areasOf(v: unknown, coverage: string): string[] | null {
  if (coverage === "branch" || coverage === "national") return [];
  if (!Array.isArray(v) || v.length === 0 || v.length > 30) return null;
  const list = v.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  if (coverage === "states" && !list.every((s) => (MY_STATE_NAMES as readonly string[]).includes(s))) return null;
  return list;
}

export async function handleFaRegistry(env: Env, path: string, method: string, b: Record<string, unknown>, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  const manage = can(user.role, "fa_registry");
  const register = can(user.role, "fa_edit");
  const today = mytToday();

  /* ---- the whole registry, for the directory screens ---- */
  if (path === "/fa/registry" && method === "GET") {
    const banks = (await env.DB.prepare(
      `SELECT k.*, ${PERSON("u")} AS owner,
              (SELECT COUNT(*) FROM fa_branches br WHERE br.bank_id = k.id AND br.status != 'closed') AS branches,
              (SELECT COUNT(*) FROM fa_bankers bk WHERE bk.bank_id = k.id AND bk.status = 'active') AS bankers
         FROM fa_banks k LEFT JOIN users u ON u.id = k.owner_id ORDER BY CASE WHEN k.status = 'retired' THEN 1 ELSE 0 END, k.name`,
    ).all()).results ?? [];
    const products = (await env.DB.prepare(`SELECT id, bank_id, product, channel, status, source FROM fa_bank_products ORDER BY bank_id, product`).all()).results ?? [];
    const localities = (await env.DB.prepare(`SELECT id, state, district, city FROM fa_localities ORDER BY state, district, city`).all()).results ?? [];
    const branches = (await env.DB.prepare(
      `SELECT br.*, k.name AS bank, l.state, l.district, l.city,
              (SELECT COUNT(*) FROM fa_banker_branches a WHERE a.branch_id = br.id AND a.ended_on IS NULL) AS bankers
         FROM fa_branches br JOIN fa_banks k ON k.id = br.bank_id LEFT JOIN fa_localities l ON l.id = br.locality_id
        ORDER BY CASE WHEN br.status = 'closed' THEN 1 ELSE 0 END, k.name, l.state, br.name`,
    ).all()).results ?? [];
    const bankersRaw = (await env.DB.prepare(
      `SELECT bk.id, bk.bank_id, bk.full_name, bk.position, bk.work_email, bk.work_phone, bk.preferred_channel, bk.relationship_type, bk.owner_id,
              bk.availability, bk.availability_on, bk.unavailable_until, bk.case_limit, bk.status, bk.registered_by, bk.created_at, bk.updated_at,
              k.name AS bank, ${PERSON("u")} AS owner,
              (SELECT COUNT(*) FROM fa_allocations a WHERE a.banker_id = bk.id AND a.state IN ('draft', 'pending_review', 'assigned', 'awaiting_consent', 'ready')) AS open_cases
         FROM fa_bankers bk JOIN fa_banks k ON k.id = bk.bank_id LEFT JOIN users u ON u.id = bk.owner_id ORDER BY bk.full_name`,
    ).all<Banker & Record<string, unknown>>()).results ?? [];
    const verifs = (await env.DB.prepare(`SELECT banker_id, fact, verified_on, next_review_on, method, restrictions, created_at FROM fa_banker_verifications ORDER BY id DESC`).all<Verification>()).results ?? [];
    /* v1.290.0 - the last contact change per banker, and the last contact (an enquiry sent or feedback linked to the banker) */
    const changed = new Map<number, string>();
    try { for (const r of (await env.DB.prepare(`SELECT banker_id, MAX(created_at) AS at FROM fa_banker_contact_changes GROUP BY banker_id`).all<{ banker_id: number; at: string }>()).results ?? []) changed.set(r.banker_id, r.at); } catch { /* pre-0186 */ }
    const lastContact = new Map<number, string>();
    for (const r of (await env.DB.prepare(
      `SELECT banker_id, MAX(at) AS at FROM (
         SELECT e.banker_id, COALESCE(e.sent_at, e.created_at) AS at FROM fa_enquiries e WHERE e.state != 'not_sent'
         UNION ALL SELECT l.banker_id, n.created_at FROM fa_note_links l JOIN fa_notes n ON n.id = l.note_id WHERE l.banker_id IS NOT NULL
       ) GROUP BY banker_id`,
    ).all<{ banker_id: number; at: string }>()).results ?? []) lastContact.set(r.banker_id, r.at);
    /* v1.300.0 - FA 2.0 phase 3, the CEO's D-3: a MEASURED reply time, never an estimate - from each enquiry sent to the first
       feedback recorded against that enquiry. Shown only once there are at least REPLY_MIN_N of them. Never an approval rate. */
    const replies = new Map<number, { hours: number[] }>();
    for (const r of (await env.DB.prepare(
      `SELECT e.banker_id, e.sent_at, (SELECT MIN(n.created_at) FROM fa_note_links l JOIN fa_notes n ON n.id = l.note_id WHERE l.enquiry_id = e.id AND n.note_type = 'banker' AND n.created_at >= e.sent_at) AS first_reply
         FROM fa_enquiries e WHERE e.sent_at IS NOT NULL`,
    ).all<{ banker_id: number; sent_at: string; first_reply: string | null }>()).results ?? []) {
      if (!r.first_reply) continue;
      const h = (Date.parse(`${r.first_reply.replace(" ", "T")}Z`) - Date.parse(`${r.sent_at.replace(" ", "T")}Z`)) / 36e5;
      if (Number.isFinite(h) && h >= 0) (replies.get(r.banker_id) ?? replies.set(r.banker_id, { hours: [] }).get(r.banker_id)!).hours.push(h);
    }
    const assigns = (await env.DB.prepare(
      `SELECT a.id, a.banker_id, a.branch_id, a.is_primary, a.coverage, a.coverage_areas, a.effective_from, br.name AS branch, l.state, l.district
         FROM fa_banker_branches a LEFT JOIN fa_branches br ON br.id = a.branch_id LEFT JOIN fa_localities l ON l.id = br.locality_id
        WHERE a.ended_on IS NULL ORDER BY a.is_primary DESC, a.id`,
    ).all<{ banker_id: number }>()).results ?? [];
    const bprods = (await env.DB.prepare(`SELECT banker_id, product FROM fa_banker_products`).all<{ banker_id: number; product: string }>()).results ?? [];
    const bankers = bankersRaw.map((bk) => {
      const identity = identityStands(verifs.find((v) => v.banker_id === bk.id && v.fact === "identity") ?? null, changed.get(bk.id));
      const referral = verifs.find((v) => v.banker_id === bk.id && v.fact === "referral") ?? null;
      return {
        ...bk, status_now: bankerStatus(bk, identity, referral, today), availability_now: availabilityNow(bk, today), last_contact_at: lastContact.get(bk.id) ?? null,
        reply: replyStats(replies.get(bk.id)?.hours ?? []),
        identity: identity ? { verified_on: identity.verified_on, next_review_on: identity.next_review_on, method: identity.method, due: identity.next_review_on < today } : null,
        referral: referral ? { verified_on: referral.verified_on, next_review_on: referral.next_review_on, restrictions: referral.restrictions, due: referral.next_review_on < today } : null,
        assignments: assigns.filter((a) => a.banker_id === bk.id),
        products: bprods.filter((p) => p.banker_id === bk.id).map((p) => p.product),
      };
    });
    return json({ banks, products, localities, branches, bankers, states: MY_STATE_NAMES, today, can: { register, manage } });
  }

  /* ---- one banker, with history ---- */
  const mOne = path.match(/^\/fa\/bankers\/(\d+)$/);
  if (mOne && method === "GET") {
    const bk = await env.DB.prepare(`SELECT bk.*, k.name AS bank, ${PERSON("u")} AS owner, ${PERSON("r")} AS registered_by_name FROM fa_bankers bk JOIN fa_banks k ON k.id = bk.bank_id LEFT JOIN users u ON u.id = bk.owner_id LEFT JOIN users r ON r.id = bk.registered_by WHERE bk.id = ?1`)
      .bind(Number(mOne[1])).first<Banker & Record<string, unknown>>();
    if (!bk) return err("not_found", "Banker not found", 404);
    const verifications = (await env.DB.prepare(`SELECT v.*, ${PERSON("u")} AS verified_by_name FROM fa_banker_verifications v LEFT JOIN users u ON u.id = v.verified_by WHERE v.banker_id = ?1 ORDER BY v.id DESC`).bind(bk.id).all()).results ?? [];
    const assignments = (await env.DB.prepare(
      `SELECT a.*, br.name AS branch, l.state, l.district, l.city FROM fa_banker_branches a LEFT JOIN fa_branches br ON br.id = a.branch_id LEFT JOIN fa_localities l ON l.id = br.locality_id WHERE a.banker_id = ?1 ORDER BY a.id DESC`,
    ).bind(bk.id).all()).results ?? [];
    const events = (await env.DB.prepare(`SELECT e.id, e.event, e.detail, e.created_at, ${PERSON("u")} AS actor FROM fa_registry_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.entity = 'banker' AND e.entity_id = ?1 ORDER BY e.id DESC`).bind(bk.id).all()).results ?? [];
    const products = ((await env.DB.prepare(`SELECT product FROM fa_banker_products WHERE banker_id = ?1`).bind(bk.id).all<{ product: string }>()).results ?? []).map((p) => p.product);
    const f = await latestFacts(env, bk.id);
    /* v1.290.0 - when the contact last changed (an earlier identity confirmation no longer counts), the last contact, who may own the relationship */
    const changedAt = await contactChangedAt(env, bk.id);
    const last = await env.DB.prepare(
      `SELECT MAX(at) AS at FROM (SELECT COALESCE(e.sent_at, e.created_at) AS at FROM fa_enquiries e WHERE e.banker_id = ?1 AND e.state != 'not_sent'
         UNION ALL SELECT n.created_at FROM fa_note_links l JOIN fa_notes n ON n.id = l.note_id WHERE l.banker_id = ?1)`,
    ).bind(bk.id).first<{ at: string | null }>();
    const mayEdit = manage || (register && bk.owner_id === user.id);
    const owners = manage ? ((await env.DB.prepare(`SELECT id, ${PERSON("u")} AS name, role FROM users u WHERE is_active = 1 AND role IN ('ceo', 'coo', 'cco', 'sales_marketing') ORDER BY name`).all<{ id: number; name: string; role: string }>()).results ?? []).filter((o) => can(o.role as StaffUser["role"], "fa_edit")) : [];
    return json({ banker: { ...bk, status_now: bankerStatus(bk, f.identity, f.referral, today), availability_now: availabilityNow(bk, today), products, contact_changed_at: changedAt, last_contact_at: last?.at ?? null },
      verifications, assignments, events, today, owners, can: { register, manage, availability: manage || bk.owner_id === user.id, edit: mayEdit && bk.status !== "left" } });
  }

  /* ---- v1.290.0 (image 04, G3) edit a banker's details: the relationship
     owner, the CEO or the COO. A changed work email or phone is recorded
     (append only) and the contact identity must be verified again; the
     duplicate rules of registration apply again. ---- */
  if (mOne && method === "PATCH") {
    const bk = await env.DB.prepare(`SELECT * FROM fa_bankers WHERE id = ?1`).bind(Number(mOne[1])).first<Banker & { position: string | null; work_email: string | null; work_phone: string | null; preferred_channel: string | null; relationship_type: string; notes: string | null; duplicate_reason: string | null }>();
    if (!bk) return err("not_found", "Banker not found", 404);
    if (!(manage || (register && bk.owner_id === user.id))) return err("forbidden", "The banker's relationship owner, the CEO or the COO edits these details", 403);
    if (bk.status === "left") return err("invalid_state", "This banker has left the bank - their record is kept as it was.", 409);
    const sets: string[] = [], vals: unknown[] = [];
    const changed: Record<string, [unknown, unknown]> = {};
    const put = (col: string, from: unknown, to: unknown) => { if ((from ?? null) === (to ?? null)) return; sets.push(`${col} = ?${sets.length + 1}`); vals.push(to ?? null); changed[col] = [from ?? null, to ?? null]; };
    if (typeof b.position === "string") put("position", bk.position, text(b.position, 80) || null);
    if (typeof b.notes === "string") put("notes", bk.notes, text(b.notes, 600) || null);
    if (typeof b.preferred_channel === "string") { if (!CHANNELS.includes(b.preferred_channel)) return err("invalid_input", `preferred_channel is one of ${CHANNELS.join(", ")}`, 400); put("preferred_channel", bk.preferred_channel, b.preferred_channel); }
    if (typeof b.relationship_type === "string") { if (!RELATIONSHIPS.includes(b.relationship_type)) return err("invalid_input", `relationship_type is one of ${RELATIONSHIPS.join(", ")}`, 400); put("relationship_type", bk.relationship_type, b.relationship_type); }
    let email = bk.work_email, phone = bk.work_phone;
    if (typeof b.work_email === "string") {
      email = text(b.work_email, 160) || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("invalid_input", "That work email is not an email address.", 400);
    }
    if (typeof b.work_phone === "string") {
      phone = text(b.work_phone, 40) || null;
      const k = phone ? phoneKey(phone) : null;
      if (k && (k.length < 9 || k.length > 12)) return err("invalid_input", "That work phone is not a Malaysian number.", 400);
    }
    if (!email && !phone) return err("invalid_input", "Keep a work email or a work phone.", 400);
    const contact: Array<{ field: string; from: string | null; to: string | null }> = [];
    if ((email ?? null) !== (bk.work_email ?? null) && (email ? emailKey(email) : null) !== bk.email_key) {
      const eKey = email ? emailKey(email) : null;
      if (eKey) {
        const same = await env.DB.prepare(`SELECT bk.id, bk.full_name, k.name AS bank FROM fa_bankers bk JOIN fa_banks k ON k.id = bk.bank_id WHERE bk.email_key = ?1 AND bk.id != ?2`).bind(eKey, bk.id).first<{ id: number; full_name: string; bank: string }>();
        if (same) { return json({ error: { code: "duplicate_banker", message: `${same.full_name} (${same.bank}) already has this work email - open that record.` }, existing: same }, 409); }
      }
      put("work_email", bk.work_email, email); put("email_key", bk.email_key, eKey);
      contact.push({ field: "work_email", from: bk.work_email, to: email });
    } else if ((email ?? null) !== (bk.work_email ?? null)) put("work_email", bk.work_email, email);
    if ((phone ? phoneKey(phone) : null) !== bk.phone_key) {
      const pKey = phone ? phoneKey(phone) : null;
      const why = text(b.different_reason, 300);
      if (pKey) {
        const same = await env.DB.prepare(`SELECT bk.id, bk.full_name, k.name AS bank FROM fa_bankers bk JOIN fa_banks k ON k.id = bk.bank_id WHERE bk.phone_key = ?1 AND bk.id != ?2`).bind(pKey, bk.id).first<{ id: number; full_name: string; bank: string }>();
        if (same && why.length < 10) return json({ error: { code: "possible_duplicate", message: `${same.full_name} (${same.bank}) has the same work phone. Say why this is a different person.` }, existing: same }, 409);
        if (same) put("duplicate_reason", bk.duplicate_reason, why);
      }
      put("work_phone", bk.work_phone, phone); put("phone_key", bk.phone_key, pKey);
      contact.push({ field: "work_phone", from: bk.work_phone, to: phone });
    } else if ((phone ?? null) !== (bk.work_phone ?? null)) put("work_phone", bk.work_phone, phone);
    if (b.owner_id !== undefined && b.owner_id !== bk.owner_id) {
      if (!manage) return err("forbidden", "Only the CEO or COO changes the relationship owner", 403);
      const o = typeof b.owner_id === "number" ? await env.DB.prepare(`SELECT id, role FROM users WHERE id = ?1 AND is_active = 1`).bind(b.owner_id).first<{ id: number; role: string }>() : null;
      if (!o || !can(o.role as StaffUser["role"], "fa_edit")) return err("invalid_input", "That person cannot own a banker relationship.", 400);
      put("owner_id", bk.owner_id, o.id);
    }
    if (b.case_limit !== undefined) {
      const lim = b.case_limit === null || b.case_limit === "" ? null : typeof b.case_limit === "number" && Number.isInteger(b.case_limit) && b.case_limit > 0 && b.case_limit <= 500 ? b.case_limit : -1;
      if (lim === -1) return err("invalid_input", "A case limit is 1 to 500, or none.", 400);
      if (lim !== bk.case_limit && !manage) return err("forbidden", "Only the CEO or COO sets a case limit", 403);
      put("case_limit", bk.case_limit, lim);
    }
    if (!sets.length) return json({ ok: true, unchanged: true });
    sets.push("updated_at = datetime('now')");
    const stmts = [env.DB.prepare(`UPDATE fa_bankers SET ${sets.join(", ")} WHERE id = ?${vals.length + 1}`).bind(...vals, bk.id)];
    for (const x of contact) stmts.push(env.DB.prepare(`INSERT INTO fa_banker_contact_changes (banker_id, field, from_value, to_value, changed_by) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(bk.id, x.field, x.from, x.to, user.id));
    try { await env.DB.batch(stmts); }
    catch (e) {
      if (/UNIQUE/i.test(String(e))) return err("duplicate_banker", "Another banker has this work email.", 409);
      if (/no such table/i.test(String(e))) return err("pending_migration", "Editing a banker needs database change 0186 - run PUSH.bat", 503);
      throw e;
    }
    const fields = Object.keys(changed).filter((k) => !k.endsWith("_key"));
    await regEvent(env, "banker", bk.id, "edited", user.id, { fields, contact_changed: contact.map((x) => x.field) });
    await audit(env, user.id, "fa.banker_edit", "fa_bankers", String(bk.id), { changed: Object.fromEntries(Object.entries(changed).filter(([k]) => !k.endsWith("_key"))) });
    return json({ ok: true, fields, identity_reverify: contact.length > 0 });
  }

  /* ---- the registry's own history ---- */
  if (path === "/fa/registry/events" && method === "GET") {
    const limit = Math.min(300, Math.max(1, Number(params.get("limit") ?? 150) || 150));
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.entity, e.entity_id, e.event, e.detail, e.created_at, ${PERSON("u")} AS actor,
              CASE e.entity WHEN 'bank' THEN (SELECT name FROM fa_banks WHERE id = e.entity_id) WHEN 'branch' THEN (SELECT name FROM fa_branches WHERE id = e.entity_id)
                WHEN 'banker' THEN (SELECT full_name FROM fa_bankers WHERE id = e.entity_id) WHEN 'locality' THEN (SELECT city || ', ' || district FROM fa_localities WHERE id = e.entity_id) ELSE NULL END AS subject
         FROM fa_registry_events e LEFT JOIN users u ON u.id = e.actor_id ORDER BY e.id DESC LIMIT ?1`,
    ).bind(limit).all();
    return json({ events: results ?? [] });
  }

  if (method !== "POST") return null;

  /* ================= banks (management) ================= */
  if (path === "/fa/banks") {
    if (!manage) return err("forbidden", "Only the CEO or COO adds a bank", 403);
    const name = titleWords(text(b.name, 120));
    if (name.length < 2) return err("invalid_input", "Give the bank's official name.", 400);
    const key = bankKey(name);
    if (key.length < 2) return err("invalid_input", "That name has no letters or digits.", 400);
    const same = await env.DB.prepare(`SELECT id, name, status FROM fa_banks WHERE name_key = ?1`).bind(key).first<Bank>();
    if (same) return json({ error: { code: "duplicate_bank", message: `${same.name} is already in the registry - open it instead.` }, existing: same }, 409);
    const kind = BANK_KINDS.includes(String(b.kind)) ? String(b.kind) : "commercial";
    const row = await env.DB.prepare(
      `INSERT INTO fa_banks (name, name_key, kind, website, official_phone, official_email, owner_id, source, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
    ).bind(name, key, kind, text(b.website, 160) || null, text(b.official_phone, 40) || null, text(b.official_email, 160) || null, user.id, text(b.source, 300) || null, user.id).first<{ id: number }>();
    const id = Number(row?.id);
    await regEvent(env, "bank", id, "added", user.id, { name, kind });
    await audit(env, user.id, "fa.bank_add", "fa_banks", String(id), { name, kind });
    return json({ ok: true, id }, 201);
  }
  const mBank = path.match(/^\/fa\/banks\/(\d+)\/(verify|retire|products)$/);
  if (mBank) {
    if (!manage) return err("forbidden", "Only the CEO or COO changes a bank", 403);
    const bank = await bankOf(env, Number(mBank[1]));
    if (!bank) return err("not_found", "Bank not found", 404);
    if (mBank[2] === "verify") {
      const source = text(b.source, 300), on = b.verified_on;
      if (source.length < 5) return err("invalid_input", "Say where you confirmed it (the bank's website, an official letter) - at least 5 characters.", 400);
      if (!validDay(on) || on > today) return err("invalid_input", "Give the day you confirmed it, today or earlier.", 400);
      if (bank.status === "retired") return err("invalid_state", `${bank.name} is retired.`, 409);
      await env.DB.prepare(`UPDATE fa_banks SET status = 'verified', source = ?1, last_verified_on = ?2, verified_by = ?3, updated_at = datetime('now') WHERE id = ?4`).bind(source, on, user.id, bank.id).run();
      await regEvent(env, "bank", bank.id, "verified", user.id, { source, verified_on: on });
      await audit(env, user.id, "fa.bank_verify", "fa_banks", String(bank.id), { source, verified_on: on });
      return json({ ok: true });
    }
    if (mBank[2] === "retire") {
      const reason = text(b.reason, 300);
      if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
      await env.DB.prepare(`UPDATE fa_banks SET status = 'retired', retired_reason = ?1, updated_at = datetime('now') WHERE id = ?2`).bind(reason, bank.id).run();
      await regEvent(env, "bank", bank.id, "retired", user.id, { reason });
      await audit(env, user.id, "fa.bank_retire", "fa_banks", String(bank.id), { reason });
      return json({ ok: true });
    }
    /* products: what the bank offers, and whether at branches or through a central unit */
    const product = String(b.product ?? "");
    if (!(PRODUCTS as readonly string[]).includes(product)) return err("invalid_input", `product is one of ${PRODUCTS.join(", ")}`, 400);
    const channel = b.channel === "central" ? "central" : "branch";
    const status = b.status === "retired" ? "retired" : "active";
    const source = text(b.source, 300);
    if (status === "active" && source.length < 5) return err("invalid_input", "Say where this product is confirmed (at least 5 characters).", 400);
    if (bank.status === "retired" && status === "active") return err("invalid_state", `${bank.name} is retired.`, 409);
    await env.DB.prepare(
      `INSERT INTO fa_bank_products (bank_id, product, channel, status, source, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(bank_id, product) DO UPDATE SET channel = excluded.channel, status = excluded.status, source = COALESCE(excluded.source, fa_bank_products.source)`,
    ).bind(bank.id, product, channel, status, source || null, user.id).run();
    await regEvent(env, "bank", bank.id, status === "active" ? "product_set" : "product_retired", user.id, { product, channel, source });
    await audit(env, user.id, "fa.bank_product", "fa_banks", String(bank.id), { product, channel, status });
    return json({ ok: true });
  }

  /* ================= places (management) ================= */
  if (path === "/fa/localities") {
    if (!manage) return err("forbidden", "Only the CEO or COO adds to the place list", 403);
    const state = String(b.state ?? "").trim().toUpperCase();
    if (!(MY_STATE_NAMES as readonly string[]).includes(state)) return err("invalid_input", "Choose the state from the list.", 400);
    const district = titleWords(text(b.district, 60)), city = titleWords(text(b.city, 60));
    if (district.length < 2 || city.length < 2) return err("invalid_input", "Give the district and the city or town.", 400);
    const key = placeKey(state, district, city);
    const same = await env.DB.prepare(`SELECT id, state, district, city FROM fa_localities WHERE place_key = ?1`).bind(key).first<{ id: number }>();
    if (same) return json({ ok: true, id: same.id, existing: true });
    const row = await env.DB.prepare(`INSERT INTO fa_localities (state, district, city, place_key, created_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`).bind(state, district, city, key, user.id).first<{ id: number }>();
    await regEvent(env, "locality", Number(row?.id), "added", user.id, { state, district, city });
    return json({ ok: true, id: Number(row?.id) }, 201);
  }

  /* ================= branches (management) ================= */
  if (path === "/fa/branches") {
    if (!manage) return err("forbidden", "Only the CEO or COO adds a branch", 403);
    const bank = await bankOf(env, b.bank_id);
    if (!bank) return err("invalid_input", "Choose the bank from the registry - a bank cannot be created from here.", 400);
    if (bank.status === "retired") return err("invalid_state", `${bank.name} is retired.`, 409);
    const name = titleWords(text(b.name, 120));
    const key = branchKey(name);
    if (key.length < 2) return err("invalid_input", "Give the branch's official name.", 400);
    const postcode = String(b.postcode ?? "").trim();
    if (!/^\d{5}$/.test(postcode)) return err("invalid_input", "The postcode is five digits.", 400);
    const loc = typeof b.locality_id === "number" ? await env.DB.prepare(`SELECT id, state, district, city FROM fa_localities WHERE id = ?1`).bind(b.locality_id).first<{ id: number; state: string; district: string; city: string }>() : null;
    if (!loc) return err("invalid_input", "Choose the state, district and city from the place list.", 400);
    const fromCode = stateFromPostcode(postcode);
    const postNote = text(b.postcode_note, 200);
    if (fromCode && fromCode !== loc.state && postNote.length < 5) {
      return json({ error: { code: "postcode_state_mismatch", message: `Postcode ${postcode} reads as ${fromCode}, not ${loc.state}. Check it, or say why it is right.` } }, 409);
    }
    const same = await env.DB.prepare(`SELECT id, name, postcode FROM fa_branches WHERE bank_id = ?1 AND name_key = ?2 AND postcode = ?3`).bind(bank.id, key, postcode).first<{ id: number; name: string; postcode: string }>();
    if (same) return json({ error: { code: "duplicate_branch", message: `${bank.name} · ${same.name} (${same.postcode}) is already in the registry - open it instead.` }, existing: same }, 409);
    const lat = typeof b.latitude === "number" ? b.latitude : null, lng = typeof b.longitude === "number" ? b.longitude : null;
    const coordSource = text(b.coord_source, 200);
    if ((lat !== null || lng !== null) && (lat === null || lng === null || coordSource.length < 5 || lat < 0 || lat > 8 || lng < 99 || lng > 120)) {
      return err("invalid_input", "Coordinates need both numbers, inside Malaysia, and the source they were copied from.", 400);
    }
    const row = await env.DB.prepare(
      `INSERT INTO fa_branches (bank_id, name, name_key, code, address, postcode, locality_id, phone, latitude, longitude, coord_source, source, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id`,
    ).bind(bank.id, name, key, text(b.code, 20) || null, text(b.address, 300) || null, postcode, loc.id, text(b.phone, 40) || null, lat, lng, coordSource || null, text(b.source, 300) || null, user.id).first<{ id: number }>();
    const id = Number(row?.id);
    const similar = await env.DB.prepare(`SELECT id, postcode FROM fa_branches WHERE bank_id = ?1 AND name_key = ?2 AND id != ?3`).bind(bank.id, key, id).all<{ id: number; postcode: string }>();
    await regEvent(env, "branch", id, "added", user.id, { bank: bank.name, name, postcode, place: `${loc.city}, ${loc.district}, ${loc.state}`, postcode_note: postNote || null });
    await audit(env, user.id, "fa.branch_add", "fa_branches", String(id), { bank_id: bank.id, name, postcode });
    return json({ ok: true, id, same_name_elsewhere: (similar.results ?? []).map((x) => x.postcode) }, 201);
  }
  const mBr = path.match(/^\/fa\/branches\/(\d+)\/(verify|status|rename)$/);
  if (mBr) {
    if (!manage) return err("forbidden", "Only the CEO or COO changes a branch", 403);
    const br = await env.DB.prepare(`SELECT id, bank_id, name, status, postcode FROM fa_branches WHERE id = ?1`).bind(Number(mBr[1])).first<{ id: number; bank_id: number; name: string; status: string; postcode: string }>();
    if (!br) return err("not_found", "Branch not found", 404);
    if (mBr[2] === "verify") {
      const source = text(b.source, 300), on = b.verified_on;
      if (source.length < 5) return err("invalid_input", "Say how you confirmed it (the bank's branch locator, the branch's official line).", 400);
      if (!validDay(on) || on > today) return err("invalid_input", "Give the day you confirmed it, today or earlier.", 400);
      if (br.status === "closed") return err("invalid_state", "A closed branch is not verified.", 409);
      await env.DB.prepare(`UPDATE fa_branches SET verified = 1, source = ?1, last_verified_on = ?2, verified_by = ?3, updated_at = datetime('now') WHERE id = ?4`).bind(source, on, user.id, br.id).run();
      await regEvent(env, "branch", br.id, "verified", user.id, { source, verified_on: on });
      await audit(env, user.id, "fa.branch_verify", "fa_branches", String(br.id), { source, verified_on: on });
      return json({ ok: true });
    }
    const note = text(b.note, 300);
    if (note.length < 5) return err("invalid_input", "Say why (at least 5 characters).", 400);
    if (mBr[2] === "rename") {
      const name = titleWords(text(b.name, 120)), key = branchKey(name);
      if (key.length < 2) return err("invalid_input", "Give the new official name.", 400);
      const clash = await env.DB.prepare(`SELECT id FROM fa_branches WHERE bank_id = ?1 AND name_key = ?2 AND postcode = ?3 AND id != ?4`).bind(br.bank_id, key, br.postcode, br.id).first();
      if (clash) return err("duplicate_branch", "Another branch of this bank already has that name and postcode.", 409);
      await env.DB.prepare(`UPDATE fa_branches SET name = ?1, name_key = ?2, updated_at = datetime('now') WHERE id = ?3`).bind(name, key, br.id).run();
      await regEvent(env, "branch", br.id, "renamed", user.id, { from: br.name, to: name, note });
      await audit(env, user.id, "fa.branch_rename", "fa_branches", String(br.id), { from: br.name, to: name });
      return json({ ok: true });
    }
    const status = String(b.status ?? "");
    if (!["open", "temporarily_closed", "closed"].includes(status)) return err("invalid_input", "status is open, temporarily_closed or closed", 400);
    await env.DB.prepare(`UPDATE fa_branches SET status = ?1, status_note = ?2, updated_at = datetime('now') WHERE id = ?3`).bind(status, note, br.id).run();
    let ended = 0;
    if (status === "closed") {
      /* a closed branch ends its assignments today; the bankers keep their history */
      const r = await env.DB.prepare(`UPDATE fa_banker_branches SET ended_on = ?1, end_reason = ?2 WHERE branch_id = ?3 AND ended_on IS NULL`).bind(today, `Branch closed: ${note}`.slice(0, 200), br.id).run();
      ended = Number(r.meta?.changes ?? 0);
    }
    await regEvent(env, "branch", br.id, "status", user.id, { from: br.status, to: status, note, assignments_ended: ended });
    await audit(env, user.id, "fa.branch_status", "fa_branches", String(br.id), { from: br.status, to: status, assignments_ended: ended });
    return json({ ok: true, assignments_ended: ended });
  }

  /* ================= bankers ================= */
  if (path === "/fa/bankers") {
    if (!register) return err("forbidden", "You cannot register bankers", 403);
    const bank = await bankOf(env, b.bank_id);
    if (!bank) return err("invalid_input", "Choose the bank from the registry.", 400);
    if (bank.status === "retired") return err("invalid_state", `${bank.name} is retired.`, 409);
    const fullName = titleWords(text(b.full_name, 120));
    if (fullName.length < 3) return err("invalid_input", "Give the banker's full name.", 400);
    const email = text(b.work_email, 160), phone = text(b.work_phone, 40);
    if (!email && !phone) return err("invalid_input", "Give a work email or a work phone.", 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("invalid_input", "That work email is not an email address.", 400);
    const eKey = email ? emailKey(email) : null, pKey = phone ? phoneKey(phone) : null;
    if (pKey && (pKey.length < 9 || pKey.length > 12)) return err("invalid_input", "That work phone is not a Malaysian number.", 400);
    /* the same work email is the same person - never a second record */
    if (eKey) {
      const same = await env.DB.prepare(`SELECT bk.id, bk.full_name, k.name AS bank FROM fa_bankers bk JOIN fa_banks k ON k.id = bk.bank_id WHERE bk.email_key = ?1`).bind(eKey).first<{ id: number; full_name: string; bank: string }>();
      if (same) return json({ error: { code: "duplicate_banker", message: `${same.full_name} (${same.bank}) already has this work email - open that record.` }, existing: same }, 409);
    }
    /* the same work phone may be a shared line: it needs a written reason */
    const differentReason = text(b.different_reason, 300);
    if (pKey) {
      const same = await env.DB.prepare(`SELECT bk.id, bk.full_name, k.name AS bank FROM fa_bankers bk JOIN fa_banks k ON k.id = bk.bank_id WHERE bk.phone_key = ?1`).bind(pKey).first<{ id: number; full_name: string; bank: string }>();
      if (same && differentReason.length < 10) return json({ error: { code: "possible_duplicate", message: `${same.full_name} (${same.bank}) has the same work phone. Open that record, or say why this is a different person.` }, existing: same }, 409);
    }
    const products = Array.isArray(b.products) ? [...new Set(b.products.map(String))] : [];
    if (!products.length || !products.every((p) => (PRODUCTS as readonly string[]).includes(p))) return err("invalid_input", "Choose the products this banker handles.", 400);
    const offered = ((await env.DB.prepare(`SELECT product, channel FROM fa_bank_products WHERE bank_id = ?1 AND status = 'active'`).bind(bank.id).all<{ product: string; channel: string }>()).results ?? []);
    const notOffered = products.filter((p) => !offered.some((o) => o.product === p));
    if (notOffered.length) return err("invalid_input", `${bank.name} has no ${notOffered.join(", ").replace(/_/g, " ")} in the registry yet - management adds the product first.`, 400);
    const assignments = Array.isArray(b.assignments) ? b.assignments as Array<Record<string, unknown>> : [];
    if (!assignments.length || assignments.length > 10) return err("invalid_input", "Choose at least one branch, or the bank's central channel.", 400);
    const cleaned: Array<{ branch_id: number | null; is_primary: number; coverage: string; areas: string[] }> = [];
    for (const a of assignments) {
      const coverage = COVERAGE.includes(String(a.coverage)) ? String(a.coverage) : "branch";
      const areas = areasOf(a.areas, coverage);
      if (areas === null) return err("invalid_input", coverage === "states" ? "Choose the states from the list." : "List the districts this banker covers.", 400);
      if (a.branch_id === null || a.branch_id === undefined) {
        if (!offered.some((o) => o.channel === "central")) return err("invalid_input", `${bank.name} has no central channel in the registry - choose a branch.`, 400);
        cleaned.push({ branch_id: null, is_primary: a.primary === true ? 1 : 0, coverage: coverage === "branch" ? "national" : coverage, areas });
        continue;
      }
      const br = typeof a.branch_id === "number" ? await env.DB.prepare(`SELECT id, bank_id, status FROM fa_branches WHERE id = ?1`).bind(a.branch_id).first<{ id: number; bank_id: number; status: string }>() : null;
      if (!br || br.bank_id !== bank.id) return err("invalid_input", "Every branch must be one of this bank's branches in the registry.", 400);
      if (br.status === "closed") return err("invalid_state", "That branch is closed.", 409);
      cleaned.push({ branch_id: br.id, is_primary: a.primary === true ? 1 : 0, coverage, areas });
    }
    if (cleaned.filter((a) => a.is_primary).length > 1) return err("invalid_input", "Only one assignment is primary.", 400);
    if (!cleaned.some((a) => a.is_primary)) cleaned[0]!.is_primary = 1;
    const relationship = RELATIONSHIPS.includes(String(b.relationship_type)) ? String(b.relationship_type) : "direct";
    const channel = CHANNELS.includes(String(b.preferred_channel)) ? String(b.preferred_channel) : (email ? "work_email" : "work_phone");
    let owner = user.id;
    if (typeof b.owner_id === "number" && b.owner_id !== user.id) {
      if (!manage) return err("forbidden", "Only the CEO or COO names someone else as the relationship owner", 403);
      const o = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ?1 AND is_active = 1`).bind(b.owner_id).first<{ id: number; role: string }>();
      if (!o || !can(o.role as StaffUser["role"], "fa_edit")) return err("invalid_input", "That person cannot own a banker relationship.", 400);
      owner = o.id;
    }
    const avail = AVAILABILITY.includes(String(b.availability)) ? String(b.availability) : "unknown";
    const limit = typeof b.case_limit === "number" && Number.isInteger(b.case_limit) && b.case_limit > 0 && b.case_limit <= 500 ? b.case_limit : null;
    const nameMatches = ((await env.DB.prepare(`SELECT id FROM fa_bankers WHERE name_key = ?1`).bind(nameKey(fullName)).all<{ id: number }>()).results ?? []).map((x) => x.id);
    let id: number;
    try {
      const row = await env.DB.prepare(
        `INSERT INTO fa_bankers (bank_id, full_name, name_key, position, work_email, email_key, work_phone, phone_key, preferred_channel, relationship_type, owner_id, availability, availability_on, case_limit, notes, duplicate_reason, registered_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17) RETURNING id`,
      ).bind(bank.id, fullName, nameKey(fullName), text(b.position, 80) || null, email || null, eKey, phone || null, pKey, channel, relationship, owner, avail, avail === "unknown" ? null : today, limit, text(b.notes, 600) || null, differentReason || null, user.id).first<{ id: number }>();
      id = Number(row?.id);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return err("duplicate_banker", "Someone registered this work email a moment ago - open that record.", 409);
      throw e;
    }
    for (const p of products) await env.DB.prepare(`INSERT OR IGNORE INTO fa_banker_products (banker_id, product) VALUES (?1, ?2)`).bind(id, p).run();
    for (const a of cleaned) {
      await env.DB.prepare(`INSERT INTO fa_banker_branches (banker_id, branch_id, is_primary, coverage, coverage_areas, effective_from, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
        .bind(id, a.branch_id, a.is_primary, a.coverage, a.areas.length ? JSON.stringify(a.areas) : null, today, user.id).run();
    }
    await regEvent(env, "banker", id, "registered", user.id, { bank: bank.name, products, assignments: cleaned.length, duplicate_reason: differentReason || null, same_name_as: nameMatches });
    await audit(env, user.id, "fa.banker_register", "fa_bankers", String(id), { bank_id: bank.id, products, duplicate_reason: differentReason || null });
    return json({ ok: true, id, status: "pending_verification", same_name_as: nameMatches }, 201);
  }

  const mBk = path.match(/^\/fa\/bankers\/(\d+)\/(verify|availability|transfer|status|products|end-assignment)$/);
  if (!mBk) return null;
  const bk = await bankerOf(env, Number(mBk[1]));
  if (!bk) return err("not_found", "Banker not found", 404);
  const action = mBk[2]!;

  if (action === "verify") {
    if (!manage) return err("forbidden", "Only the CEO or COO verifies a banker", 403);
    /* B3 - never a banker you registered yourself, the verified owner apart */
    if (bk.registered_by === user.id && !isExecutiveOwner(user)) {
      await audit(env, user.id, "auth.self_approval_refused", "fa_bankers", String(bk.id), { action: "fa.banker_verify" });
      return err("self_approval", "You registered this banker - someone else verifies them.", 403);
    }
    if (bk.status !== "active") return err("invalid_state", "Only an active banker is verified.", 409);
    const fact = b.fact === "referral" ? "referral" : b.fact === "identity" ? "identity" : "";
    if (!fact) return err("invalid_input", "fact is identity or referral", 400);
    const m = String(b.method ?? "");
    if (!VERIFY_METHODS.includes(m)) return err("invalid_input", `method is one of ${VERIFY_METHODS.join(", ")}`, 400);
    const evidence = text(b.evidence, 400);
    if (evidence.length < 10) return err("invalid_input", "Describe the evidence: which official line or email, who confirmed, when (at least 10 characters).", 400);
    const on = b.verified_on;
    if (!validDay(on) || on > today) return err("invalid_input", "Give the day it was confirmed, today or earlier.", 400);
    const next = validDay(b.next_review_on) ? b.next_review_on : addMonths(on, REVIEW_MONTHS);
    if (next <= on) return err("invalid_input", "The next review is after the day it was confirmed.", 400);
    if (fact === "referral") {
      const f = await latestFacts(env, bk.id);
      if (!f.identity || f.identity.next_review_on < today) return err("invalid_state", "Verify the banker's contact identity first.", 409);
    }
    const restrictions = text(b.restrictions, 300) || null;
    await env.DB.prepare(`INSERT INTO fa_banker_verifications (banker_id, fact, method, evidence, restrictions, verified_on, next_review_on, verified_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
      .bind(bk.id, fact, m, evidence, restrictions, on, next, user.id).run();
    await regEvent(env, "banker", bk.id, `${fact}_verified`, user.id, { method: m, verified_on: on, next_review_on: next, restrictions });
    await audit(env, user.id, `fa.banker_${fact}_verified`, "fa_bankers", String(bk.id), { method: m, verified_on: on, next_review_on: next, own_registration: bk.registered_by === user.id });
    return json({ ok: true, next_review_on: next });
  }

  if (action === "availability") {
    if (!(manage || (register && bk.owner_id === user.id))) return err("forbidden", "The relationship owner or management updates availability", 403);
    const a = String(b.availability ?? "");
    if (!["available", "limited", "unavailable"].includes(a)) return err("invalid_input", "availability is available, limited or unavailable", 400);
    const until = a === "unavailable" ? (validDay(b.until) && b.until >= today ? b.until : null) : null;
    if (a === "unavailable" && !until) return err("invalid_input", "Say until when the banker is unavailable.", 400);
    const lim = b.case_limit === null ? null : typeof b.case_limit === "number" && Number.isInteger(b.case_limit) && b.case_limit > 0 && b.case_limit <= 500 ? b.case_limit : bk.case_limit;
    if (lim !== bk.case_limit && !manage) return err("forbidden", "Only the CEO or COO sets a case limit", 403);
    await env.DB.prepare(`UPDATE fa_bankers SET availability = ?1, availability_on = ?2, unavailable_until = ?3, case_limit = ?4, updated_at = datetime('now') WHERE id = ?5`).bind(a, today, until, lim, bk.id).run();
    await regEvent(env, "banker", bk.id, "availability", user.id, { availability: a, until, case_limit: lim });
    return json({ ok: true });
  }

  if (action === "products") {
    if (!(manage || (register && bk.owner_id === user.id))) return err("forbidden", "The relationship owner or management changes what a banker handles", 403);
    const products = Array.isArray(b.products) ? [...new Set(b.products.map(String))] : [];
    if (!products.length || !products.every((p) => (PRODUCTS as readonly string[]).includes(p))) return err("invalid_input", "Choose at least one product.", 400);
    const offered = ((await env.DB.prepare(`SELECT product FROM fa_bank_products WHERE bank_id = ?1 AND status = 'active'`).bind(bk.bank_id).all<{ product: string }>()).results ?? []).map((x) => x.product);
    if (!products.every((p) => offered.includes(p))) return err("invalid_input", "The bank does not offer that product in the registry.", 400);
    await env.DB.prepare(`DELETE FROM fa_banker_products WHERE banker_id = ?1`).bind(bk.id).run();
    for (const p of products) await env.DB.prepare(`INSERT INTO fa_banker_products (banker_id, product) VALUES (?1, ?2)`).bind(bk.id, p).run();
    await regEvent(env, "banker", bk.id, "products", user.id, { products });
    return json({ ok: true });
  }

  if (!manage) return err("forbidden", "Only the CEO or COO changes where a banker works or whether they are active", 403);

  if (action === "transfer") {
    /* a transfer ends the current assignment on the day and starts the new one; nothing is rewritten */
    const from = validDay(b.effective_from) ? b.effective_from : today;
    const reason = text(b.reason, 300);
    if (reason.length < 5) return err("invalid_input", "Say why (at least 5 characters).", 400);
    if (bk.status !== "active") return err("invalid_state", "Only an active banker moves.", 409);
    const coverage = COVERAGE.includes(String(b.coverage)) ? String(b.coverage) : "branch";
    const areas = areasOf(b.areas, coverage);
    if (areas === null) return err("invalid_input", "Choose the areas covered.", 400);
    let branchId: number | null = null;
    if (b.branch_id !== null && b.branch_id !== undefined) {
      const br = typeof b.branch_id === "number" ? await env.DB.prepare(`SELECT id, bank_id, status FROM fa_branches WHERE id = ?1`).bind(b.branch_id).first<{ id: number; bank_id: number; status: string }>() : null;
      if (!br || br.bank_id !== bk.bank_id) return err("invalid_input", "Choose one of the bank's branches.", 400);
      if (br.status === "closed") return err("invalid_state", "That branch is closed.", 409);
      branchId = br.id;
    }
    const replace = typeof b.replaces === "number" ? b.replaces : null;
    const ended = replace
      ? await env.DB.prepare(`UPDATE fa_banker_branches SET ended_on = ?1, end_reason = ?2 WHERE id = ?3 AND banker_id = ?4 AND ended_on IS NULL`).bind(from, `Transfer: ${reason}`.slice(0, 200), replace, bk.id).run()
      : await env.DB.prepare(`UPDATE fa_banker_branches SET ended_on = ?1, end_reason = ?2 WHERE banker_id = ?3 AND is_primary = 1 AND ended_on IS NULL`).bind(from, `Transfer: ${reason}`.slice(0, 200), bk.id).run();
    const primary = b.primary === false ? 0 : 1;
    if (primary) await env.DB.prepare(`UPDATE fa_banker_branches SET is_primary = 0 WHERE banker_id = ?1 AND ended_on IS NULL`).bind(bk.id).run();
    const row = await env.DB.prepare(`INSERT INTO fa_banker_branches (banker_id, branch_id, is_primary, coverage, coverage_areas, effective_from, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`)
      .bind(bk.id, branchId, primary, branchId === null && coverage === "branch" ? "national" : coverage, areas.length ? JSON.stringify(areas) : null, from, user.id).first<{ id: number }>();
    await regEvent(env, "banker", bk.id, "transferred", user.id, { to_branch_id: branchId, effective_from: from, reason, ended: Number(ended.meta?.changes ?? 0), assignment_id: row?.id });
    await audit(env, user.id, "fa.banker_transfer", "fa_bankers", String(bk.id), { to_branch_id: branchId, effective_from: from, reason });
    return json({ ok: true, assignment_id: row?.id });
  }

  if (action === "end-assignment") {
    const aid = typeof b.assignment_id === "number" ? b.assignment_id : NaN;
    const reason = text(b.reason, 300);
    if (reason.length < 5) return err("invalid_input", "Say why (at least 5 characters).", 400);
    const r = await env.DB.prepare(`UPDATE fa_banker_branches SET ended_on = ?1, end_reason = ?2 WHERE id = ?3 AND banker_id = ?4 AND ended_on IS NULL`).bind(today, reason, aid, bk.id).run();
    if (!Number(r.meta?.changes ?? 0)) return err("not_found", "No open assignment with that id.", 404);
    await regEvent(env, "banker", bk.id, "assignment_ended", user.id, { assignment_id: aid, reason });
    return json({ ok: true });
  }

  /* status: inactive, left (no longer available), or back to active */
  const status = String(b.status ?? "");
  if (!["active", "inactive", "left"].includes(status)) return err("invalid_input", "status is active, inactive or left", 400);
  const reason = text(b.reason, 300);
  if (reason.length < 5) return err("invalid_input", "Say why (at least 5 characters).", 400);
  await env.DB.prepare(`UPDATE fa_bankers SET status = ?1, status_reason = ?2, updated_at = datetime('now') WHERE id = ?3`).bind(status, reason, bk.id).run();
  let ended = 0;
  if (status === "left") {
    const r = await env.DB.prepare(`UPDATE fa_banker_branches SET ended_on = ?1, end_reason = ?2 WHERE banker_id = ?3 AND ended_on IS NULL`).bind(today, `Left: ${reason}`.slice(0, 200), bk.id).run();
    ended = Number(r.meta?.changes ?? 0);
  }
  /* open allocations on someone who is no longer active are flagged for reassignment (stage 2 acts on them) */
  const open = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM fa_allocations WHERE banker_id = ?1 AND state IN (${ACTIVE_ALLOC.map((s) => `'${s}'`).join(", ")})`).bind(bk.id).first<{ n: number }>())?.n ?? 0);
  await regEvent(env, "banker", bk.id, "status", user.id, { from: bk.status, to: status, reason, assignments_ended: ended, open_allocations: open });
  await audit(env, user.id, "fa.banker_status", "fa_bankers", String(bk.id), { from: bk.status, to: status, reason });
  return json({ ok: true, open_allocations: open });
}

/**
 * CRISCIKEE — the crispy chicken skin, and what customers make of it. v1.149.0.
 *
 * The CEO, 10-09-2026: *"WHO is buying/testing Criscikee → WHAT flavor they
 * prefer → HOW MUCH they like it → WHY they like/dislike it."*
 *
 * Two tables (0125): a short list of flavours, and one row per customer
 * review naming a flavour by id. Everything on the tab is a question asked of
 * those rows, and every question is answered HERE, in SQL, once - the browser
 * never adds up reviews itself. Five rules earn their words:
 *
 *   1. AGE GROUP IS DERIVED, NEVER ACCEPTED. The browser sends an age; the
 *      worker files it. ageGroupOf() is the one rule, lib/criscikee.ts has
 *      the same function for the form to preview, and tests/criscikee.mjs
 *      runs both over every age and fails on the first disagreement.
 *
 *   2. THE COMMENT IS THE CUSTOMER'S. Trimmed, length-capped, and otherwise
 *      stored exactly as typed. A machine reads it; nothing rewrites it.
 *
 *   3. SENTIMENT IS CLASSIFIED WITH ITS REASONS BESIDE IT. classifySentiment
 *      is a Malay + English lexicon with negation ("tak sedap" is not "sedap")
 *      and the star rating as the tie-breaker. The reasons it matched are
 *      stored, so a verdict can be checked by a person, and a person can
 *      overrule it (sentiment_source = manual) - after which an edit to the
 *      comment does NOT reclassify, because a human said otherwise. This is
 *      the same shape as the Threads study's my_signal / my_reasons, and it
 *      is what makes an AI classifier a drop-in later: same columns, a
 *      different function.
 *
 *   4. A FLAVOUR IS RETIRED, NEVER DELETED. New reviews may only name an
 *      ACTIVE flavour; old reviews keep naming the one they were given.
 *
 *   5. AN INSIGHT NEEDS A SAMPLE. "Best flavour" is only said of a flavour
 *      with at least MIN_SAMPLE reviews. Below that the figure is shown and
 *      the word "best" is withheld - one five-star review is not a winner.
 *
 * Reading needs criscikee_view; writing a review needs criscikee_review;
 * deleting one, and any change to the flavour list, needs criscikee_manage.
 * Every mutation is audited.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit } from "./shared";
import { can } from "./permissions";

/* ---- the closed lists, the same order and keys as lib/criscikee.ts ---- */
export const GENDERS = ["male", "female", "undisclosed"] as const;
export const AGE_GROUPS = ["under_18", "18_24", "25_34", "35_44", "45_54", "55_plus"] as const;
export const IMPRESSIONS = ["loved_it", "good", "average", "not_my_taste"] as const;
export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export const AGE_MIN = 3, AGE_MAX = 110, COMMENT_MAX = 1000, MIN_SAMPLE = 5;

type Gender = (typeof GENDERS)[number];
type AgeGroup = (typeof AGE_GROUPS)[number];
type Impression = (typeof IMPRESSIONS)[number];
type Sentiment = (typeof SENTIMENTS)[number];

const inList = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** Age 27 -> "25_34". IDENTICAL to lib/criscikee.ts - the guard checks. */
export function ageGroupOf(age: number): AgeGroup {
  if (age < 18) return "under_18";
  if (age <= 24) return "18_24";
  if (age <= 34) return "25_34";
  if (age <= 44) return "35_44";
  if (age <= 54) return "45_54";
  return "55_plus";
}

/* ---- sentiment -------------------------------------------------------
   Word lists, not a model. Bahasa Melayu first because that is how the
   customers write, then the English that gets mixed in. Each hit is
   recorded as a reason. A negation word within two tokens before a hit
   flips it: "tak sedap" scores negative, "sedap tak terkata" does not
   (the negation comes after). */
const POS = /\b(sedap|sangat sedap|terbaik|mantap|ngam|puas hati|suka|sukaa+|best|power|padu|marvelous|crispy|rangup|garing|sempurna|bagus|lazat|nyaman|syok|shiok|umph|umami|memang sedap|worth it|berbaloi|recommend|repeat|nak lagi|tambah lagi|love|loved|great|delicious|tasty|yummy|excellent|perfect|amazing|awesome|nice|good|enak|wow|fresh)\b/gi;
const NEG = /\b(tak sedap|hambar|tawar|lembik|lemau|masin sangat|terlalu masin|terlalu manis|manis sangat|terlalu pedas|pedas sangat|hangus|basi|keras|liat|berminyak|melekit|kurang|mengecewakan|hampeh|teruk|buruk|bosan|meh|bad|awful|terrible|horrible|bland|soggy|stale|burnt|greasy|oily|salty|too salty|too sweet|too spicy|disappointing|disappointed|not nice|not good|overpriced|mahal|pricey|weird|pelik)\b/gi;
const NEGATION = /^(tak|tidak|bukan|takde|tiada|not|no|never|kurang|jangan|belum)$/i;
/** Softeners: "boleh lagi", "okay je", "could be better" - a wish, not a complaint. */
const MILD = /\b(boleh lagi|boleh tambah|okay je|ok je|biasa je|so so|could be better|not bad|boleh tahan|sederhana|average|okay|ok)\b/gi;

export interface SentimentVerdict { sentiment: Sentiment; reasons: string }

export function classifySentiment(comment: string, rating: number): SentimentVerdict {
  const text = comment.toLowerCase();
  const tokens = text.split(/[^a-z0-9']+/).filter(Boolean);
  const hits: string[] = [];
  let score = 0;
  const scan = (re: RegExp, weight: number, tag: string) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const at = text.slice(0, m.index).split(/[^a-z0-9']+/).filter(Boolean).length;
      const before = tokens.slice(Math.max(0, at - 2), at);
      const negated = before.some((t) => NEGATION.test(t));
      /* A negated word flips sign and counts for HALF: "not bad" is a shrug,
         not praise, while "bad" on its own is a complaint. */
      const w = negated ? -Math.sign(weight) : weight;
      score += w;
      hits.push(`${negated ? "not " : ""}${m[0]} (${tag}${negated ? ", negated" : ""})`);
    }
  };
  scan(POS, 2, "+");
  scan(NEG, -2, "-");
  scan(MILD, 0, "~");
  /* The stars break a tie and temper a lone word: a 5-star "okay je" is
     positive, a 1-star "sedap" with nothing else is suspicious enough to
     stay neutral rather than be called positive. */
  const fromStars = rating >= 4 ? 1 : rating <= 2 ? -1 : 0;
  const total = score + fromStars;
  let sentiment: Sentiment;
  if (total >= 2) sentiment = "positive";
  else if (total <= -2) sentiment = "negative";
  else sentiment = "neutral";
  const reasons = [
    ...hits,
    `${rating} star${rating === 1 ? "" : "s"} (${fromStars > 0 ? "+" : fromStars < 0 ? "-" : "~"})`,
  ].join("; ");
  return { sentiment, reasons };
}

/* ---- rows ------------------------------------------------------------ */
interface FlavorRow {
  id: number; name: string; description: string | null; is_active: number; sort_order: number;
  created_at: string; updated_at: string;
}
interface ReviewRow {
  id: number; flavor_id: number; flavor_name: string | null; age: number; age_group: AgeGroup; gender: Gender;
  rating: number; comment: string; impression: Impression; sentiment: Sentiment; sentiment_source: "auto" | "manual";
  sentiment_reasons: string | null; reviewed_on: string; created_by: number | null; created_by_name: string | null;
  created_at: string; updated_at: string;
}

const todayMYT = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const trimTo = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

/** The one place a review body becomes columns. Used by POST and PATCH so
    the two cannot validate differently. `partial` lets PATCH omit fields. */
function readReview(body: Record<string, unknown> | null, partial: boolean): { ok: true; v: Partial<{
  flavor_id: number; age: number; gender: Gender; rating: number; comment: string; impression: Impression;
  sentiment: Sentiment | "auto"; reviewed_on: string;
}> } | { ok: false; msg: string } {
  const v: Record<string, unknown> = {};
  const has = (k: string) => body != null && k in body && body[k] !== undefined;

  if (has("flavor_id") || !partial) {
    const f = typeof body?.flavor_id === "number" ? Math.trunc(body.flavor_id) : Number(body?.flavor_id);
    if (!Number.isFinite(f) || f <= 0) return { ok: false, msg: "Pick a flavour" };
    v.flavor_id = f;
  }
  if (has("age") || !partial) {
    const a = typeof body?.age === "number" ? body.age : Number(body?.age);
    if (!Number.isFinite(a) || !Number.isInteger(a) || a < AGE_MIN || a > AGE_MAX) {
      return { ok: false, msg: `Age must be a whole number between ${AGE_MIN} and ${AGE_MAX}` };
    }
    v.age = a;
  }
  if (has("gender") || !partial) {
    if (!inList(GENDERS, body?.gender)) return { ok: false, msg: `gender must be one of: ${GENDERS.join(", ")}` };
    v.gender = body!.gender;
  }
  if (has("rating") || !partial) {
    const r = typeof body?.rating === "number" ? body.rating : Number(body?.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) return { ok: false, msg: "Rating must be 1 to 5 stars" };
    v.rating = r;
  }
  if (has("comment") || !partial) {
    const c = typeof body?.comment === "string" ? body.comment.trim() : "";
    if (!c) return { ok: false, msg: "The customer's comment is required - it is the WHY" };
    if (c.length > COMMENT_MAX) return { ok: false, msg: `The comment is too long (max ${COMMENT_MAX} characters)` };
    v.comment = c;
  }
  if (has("impression") || !partial) {
    if (!inList(IMPRESSIONS, body?.impression)) return { ok: false, msg: `impression must be one of: ${IMPRESSIONS.join(", ")}` };
    v.impression = body!.impression;
  }
  if (has("sentiment")) {
    const s = body?.sentiment;
    if (s === "auto" || s === null || s === "") v.sentiment = "auto";
    else if (inList(SENTIMENTS, s)) v.sentiment = s;
    else return { ok: false, msg: `sentiment must be auto or one of: ${SENTIMENTS.join(", ")}` };
  } else if (!partial) v.sentiment = "auto";
  if (has("reviewed_on")) {
    if (!isDay(body?.reviewed_on)) return { ok: false, msg: "reviewed_on must be YYYY-MM-DD" };
    if ((body!.reviewed_on as string) > todayMYT()) return { ok: false, msg: "A review cannot be dated in the future" };
    v.reviewed_on = body!.reviewed_on as string;
  } else if (!partial) v.reviewed_on = todayMYT();
  return { ok: true, v };
}

/* ---- the module ------------------------------------------------------ */
export async function handleCriscikee(
  env: Env,
  path: string, // stripped of /criscikee, starts with / (or is empty)
  method: string,
  body: Record<string, unknown> | null,
  user: StaffUser,
  params: URLSearchParams,
): Promise<Response | null> {
  if (!can(user.role, "criscikee_view")) return err("forbidden", "No access to Criscikee", 403);
  const canReview = can(user.role, "criscikee_review");
  const manage = can(user.role, "criscikee_manage");

  try {
    /* ================= flavours ================= */
    if (path === "/flavors" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT f.*, COALESCE(n.reviews, 0) AS reviews
           FROM criscikee_flavors f
           LEFT JOIN (SELECT flavor_id, COUNT(*) AS reviews FROM criscikee_reviews WHERE is_deleted = 0 GROUP BY flavor_id) n
             ON n.flavor_id = f.id
          ORDER BY f.is_active DESC, f.sort_order, f.name`,
      ).all<FlavorRow & { reviews: number }>();
      return json({ flavors: results ?? [], can_review: canReview, can_manage: manage });
    }

    if (path === "/flavors" && method === "POST") {
      if (!manage) return err("forbidden", "Only management changes the flavour list", 403);
      const name = trimTo(body?.name, 60);
      if (!name) return err("invalid_input", "The flavour needs a name", 400);
      const dup = await env.DB.prepare(`SELECT id FROM criscikee_flavors WHERE name = ?1 COLLATE NOCASE`).bind(name).first<{ id: number }>();
      if (dup) return err("invalid_input", `There is already a flavour called ${name}`, 400);
      const last = await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS n FROM criscikee_flavors`).first<{ n: number }>();
      const row = await env.DB.prepare(
        `INSERT INTO criscikee_flavors (name, description, sort_order, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
      ).bind(name, trimTo(body?.description, 200), (last?.n ?? 0) + 1, user.id).first<{ id: number }>();
      await audit(env, user.id, "criscikee.flavor_create", "criscikee_flavors", String(row?.id ?? 0), { name });
      return json({ ok: true, id: row?.id ?? 0 }, 201);
    }

    const fm = path.match(/^\/flavors\/(\d+)$/);
    if (fm && method === "PATCH") {
      if (!manage) return err("forbidden", "Only management changes the flavour list", 403);
      const id = Number(fm[1]);
      const before = await env.DB.prepare(`SELECT id, name, is_active FROM criscikee_flavors WHERE id = ?1`).bind(id).first<{ id: number; name: string; is_active: number }>();
      if (!before) return err("not_found", "No such flavour", 404);
      const sets: string[] = []; const vals: (string | number | null)[] = [];
      const put = (col: string, val: string | number | null) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(val); };
      if (body && "name" in body) {
        const name = trimTo(body.name, 60);
        if (!name) return err("invalid_input", "The flavour needs a name", 400);
        const dup = await env.DB.prepare(`SELECT id FROM criscikee_flavors WHERE name = ?1 COLLATE NOCASE AND id != ?2`).bind(name, id).first<{ id: number }>();
        if (dup) return err("invalid_input", `There is already a flavour called ${name}`, 400);
        put("name", name);
      }
      if (body && "description" in body) put("description", trimTo(body.description, 200));
      if (body && "is_active" in body) put("is_active", body.is_active ? 1 : 0);
      if (body && typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) put("sort_order", Math.trunc(body.sort_order));
      if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
      put("updated_at", new Date().toISOString().slice(0, 19).replace("T", " "));
      vals.push(id);
      await env.DB.prepare(`UPDATE criscikee_flavors SET ${sets.join(", ")} WHERE id = ?${vals.length}`).bind(...vals).run();
      await audit(env, user.id, "criscikee.flavor_update", "criscikee_flavors", String(id), { was: before, ...(body ?? {}) });
      return json({ ok: true });
    }

    /* ================= reviews ================= */
    if (path === "/reviews" && method === "GET") {
      const where: string[] = ["r.is_deleted = 0"]; const vals: (string | number)[] = [];
      const bind = (v: string | number) => { vals.push(v); return `?${vals.length}`; };
      const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 80);
      if (q) where.push(`(LOWER(r.comment) LIKE ${bind(`%${q}%`)} OR LOWER(f.name) LIKE ${bind(`%${q}%`)})`);
      const flavor = Number(params.get("flavor"));
      if (Number.isFinite(flavor) && flavor > 0) where.push(`r.flavor_id = ${bind(flavor)}`);
      const gender = params.get("gender"); if (inList(GENDERS, gender)) where.push(`r.gender = ${bind(gender)}`);
      const ag = params.get("age_group"); if (inList(AGE_GROUPS, ag)) where.push(`r.age_group = ${bind(ag)}`);
      const rating = Number(params.get("rating")); if (Number.isInteger(rating) && rating >= 1 && rating <= 5) where.push(`r.rating = ${bind(rating)}`);
      const sent = params.get("sentiment"); if (inList(SENTIMENTS, sent)) where.push(`r.sentiment = ${bind(sent)}`);
      const imp = params.get("impression"); if (inList(IMPRESSIONS, imp)) where.push(`r.impression = ${bind(imp)}`);
      const from = params.get("from"); if (isDay(from)) where.push(`r.reviewed_on >= ${bind(from)}`);
      const to = params.get("to"); if (isDay(to)) where.push(`r.reviewed_on <= ${bind(to)}`);
      /* Sort is a whitelist - a column name from the URL never reaches SQL. */
      const sortCol = ({ date: "r.reviewed_on", age: "r.age", rating: "r.rating" } as Record<string, string>)[params.get("sort") ?? "date"] ?? "r.reviewed_on";
      const dir = params.get("dir") === "asc" ? "ASC" : "DESC";
      const { results } = await env.DB.prepare(
        `SELECT r.*, f.name AS flavor_name, u.name AS created_by_name
           FROM criscikee_reviews r
           LEFT JOIN criscikee_flavors f ON f.id = r.flavor_id
           LEFT JOIN users u ON u.id = r.created_by
          WHERE ${where.join(" AND ")}
          ORDER BY ${sortCol} ${dir}, r.id DESC
          LIMIT 500`,
      ).bind(...vals).all<ReviewRow>();
      const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM criscikee_reviews WHERE is_deleted = 0`).first<{ n: number }>();
      return json({ reviews: results ?? [], total: total?.n ?? 0, shown: results?.length ?? 0, can_review: canReview, can_manage: manage });
    }

    if (path === "/reviews" && method === "POST") {
      if (!canReview) return err("forbidden", "Your role cannot add reviews", 403);
      const r = readReview(body, false);
      if (!r.ok) return err("invalid_input", r.msg, 400);
      const v = r.v;
      const fl = await env.DB.prepare(`SELECT id, name, is_active FROM criscikee_flavors WHERE id = ?1`).bind(v.flavor_id).first<{ id: number; name: string; is_active: number }>();
      if (!fl) return err("invalid_input", "That flavour does not exist", 400);
      if (!fl.is_active) return err("invalid_input", `${fl.name} is retired - reactivate it under Flavors to review it again`, 400);
      const verdict = v.sentiment === "auto" || v.sentiment === undefined
        ? { ...classifySentiment(v.comment!, v.rating!), source: "auto" as const }
        : { sentiment: v.sentiment, reasons: "set by hand", source: "manual" as const };
      const row = await env.DB.prepare(
        `INSERT INTO criscikee_reviews
           (flavor_id, age, age_group, gender, rating, comment, impression, sentiment, sentiment_source, sentiment_reasons, reviewed_on, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) RETURNING id`,
      ).bind(v.flavor_id!, v.age!, ageGroupOf(v.age!), v.gender!, v.rating!, v.comment!, v.impression!,
             verdict.sentiment, verdict.source, verdict.reasons, v.reviewed_on!, user.id).first<{ id: number }>();
      await audit(env, user.id, "criscikee.review_create", "criscikee_reviews", String(row?.id ?? 0),
        { flavor: fl.name, rating: v.rating, sentiment: verdict.sentiment, source: verdict.source });
      return json({ ok: true, id: row?.id ?? 0, sentiment: verdict.sentiment, sentiment_reasons: verdict.reasons, age_group: ageGroupOf(v.age!) }, 201);
    }

    const rm = path.match(/^\/reviews\/(\d+)$/);
    if (rm && method === "PATCH") {
      if (!canReview) return err("forbidden", "Your role cannot edit reviews", 403);
      const id = Number(rm[1]);
      const before = await env.DB.prepare(`SELECT * FROM criscikee_reviews WHERE id = ?1 AND is_deleted = 0`).bind(id).first<ReviewRow>();
      if (!before) return err("not_found", "No such review", 404);
      const r = readReview(body, true);
      if (!r.ok) return err("invalid_input", r.msg, 400);
      const v = r.v;
      if (v.flavor_id !== undefined && v.flavor_id !== before.flavor_id) {
        const fl = await env.DB.prepare(`SELECT id, name, is_active FROM criscikee_flavors WHERE id = ?1`).bind(v.flavor_id).first<{ id: number; name: string; is_active: number }>();
        if (!fl) return err("invalid_input", "That flavour does not exist", 400);
        if (!fl.is_active) return err("invalid_input", `${fl.name} is retired`, 400);
      }
      const sets: string[] = []; const vals: (string | number | null)[] = [];
      const put = (col: string, val: string | number | null) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(val); };
      if (v.flavor_id !== undefined) put("flavor_id", v.flavor_id);
      if (v.age !== undefined) { put("age", v.age); put("age_group", ageGroupOf(v.age)); }
      if (v.gender !== undefined) put("gender", v.gender);
      if (v.rating !== undefined) put("rating", v.rating);
      if (v.comment !== undefined) put("comment", v.comment);
      if (v.impression !== undefined) put("impression", v.impression);
      if (v.reviewed_on !== undefined) put("reviewed_on", v.reviewed_on);
      /* Sentiment, the interesting case:
           - a hand-set value is stored as manual;
           - "auto" asks for a fresh classification of whatever the comment
             and rating now are;
           - nothing said, and the comment or rating changed, reclassifies
             ONLY if nobody had overruled the machine before - a human verdict
             outlives an edit to the wording. */
      const textChanged = v.comment !== undefined || v.rating !== undefined;
      if (v.sentiment !== undefined && v.sentiment !== "auto") {
        put("sentiment", v.sentiment); put("sentiment_source", "manual"); put("sentiment_reasons", "set by hand");
      } else if (v.sentiment === "auto" || (textChanged && before.sentiment_source === "auto")) {
        const verdict = classifySentiment(v.comment ?? before.comment, v.rating ?? before.rating);
        put("sentiment", verdict.sentiment); put("sentiment_source", "auto"); put("sentiment_reasons", verdict.reasons);
      }
      if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
      put("updated_at", new Date().toISOString().slice(0, 19).replace("T", " "));
      vals.push(id);
      await env.DB.prepare(`UPDATE criscikee_reviews SET ${sets.join(", ")} WHERE id = ?${vals.length}`).bind(...vals).run();
      await audit(env, user.id, "criscikee.review_update", "criscikee_reviews", String(id),
        { was: { rating: before.rating, sentiment: before.sentiment, flavor_id: before.flavor_id }, changed: sets.map((s) => s.split(" ")[0]) });
      const after = await env.DB.prepare(`SELECT sentiment, sentiment_source, sentiment_reasons, age_group FROM criscikee_reviews WHERE id = ?1`).bind(id).first();
      return json({ ok: true, ...(after ?? {}) });
    }

    if (rm && method === "DELETE") {
      if (!manage) return err("forbidden", "Only management removes a review", 403);
      const id = Number(rm[1]);
      const before = await env.DB.prepare(
        `SELECT r.*, f.name AS flavor_name FROM criscikee_reviews r LEFT JOIN criscikee_flavors f ON f.id = r.flavor_id WHERE r.id = ?1 AND r.is_deleted = 0`,
      ).bind(id).first<ReviewRow>();
      if (!before) return err("not_found", "No such review", 404);
      await env.DB.prepare(`UPDATE criscikee_reviews SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1`).bind(id).run();
      await audit(env, user.id, "criscikee.review_delete", "criscikee_reviews", String(id), {
        snapshot: { flavor: before.flavor_name, age: before.age, gender: before.gender, rating: before.rating, comment: before.comment, sentiment: before.sentiment, reviewed_on: before.reviewed_on },
      });
      return json({ ok: true, removed: id });
    }

    /* ================= analytics - every figure the dashboard shows ================= */
    if (path === "/analytics" && method === "GET") {
      const from = params.get("from"), to = params.get("to");
      const where: string[] = ["r.is_deleted = 0"]; const vals: string[] = [];
      if (isDay(from)) { vals.push(from); where.push(`r.reviewed_on >= ?${vals.length}`); }
      if (isDay(to)) { vals.push(to); where.push(`r.reviewed_on <= ?${vals.length}`); }
      const W = where.join(" AND ");
      const SENT = `SUM(CASE WHEN r.sentiment = 'positive' THEN 1 ELSE 0 END) AS positive,
                    SUM(CASE WHEN r.sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral,
                    SUM(CASE WHEN r.sentiment = 'negative' THEN 1 ELSE 0 END) AS negative`;

      const totals = await env.DB.prepare(
        `SELECT COUNT(*) AS n, AVG(r.rating) AS avg_rating, ${SENT} FROM criscikee_reviews r WHERE ${W}`,
      ).bind(...vals).first<{ n: number; avg_rating: number | null; positive: number; neutral: number; negative: number }>();

      const { results: byFlavor } = await env.DB.prepare(
        `SELECT f.id AS flavor_id, f.name, f.is_active, COUNT(r.id) AS n, AVG(r.rating) AS avg_rating, ${SENT}
           FROM criscikee_flavors f
           LEFT JOIN criscikee_reviews r ON r.flavor_id = f.id AND ${W}
          GROUP BY f.id ORDER BY f.is_active DESC, f.sort_order, f.name`,
      ).bind(...vals).all<{ flavor_id: number; name: string; is_active: number; n: number; avg_rating: number | null; positive: number; neutral: number; negative: number }>();

      const { results: byGender } = await env.DB.prepare(
        `SELECT r.gender AS k, COUNT(*) AS n, AVG(r.rating) AS avg_rating FROM criscikee_reviews r WHERE ${W} GROUP BY r.gender`,
      ).bind(...vals).all<{ k: string; n: number; avg_rating: number }>();
      const { results: byAge } = await env.DB.prepare(
        `SELECT r.age_group AS k, COUNT(*) AS n, AVG(r.rating) AS avg_rating FROM criscikee_reviews r WHERE ${W} GROUP BY r.age_group`,
      ).bind(...vals).all<{ k: string; n: number; avg_rating: number }>();
      const { results: byImpression } = await env.DB.prepare(
        `SELECT r.impression AS k, COUNT(*) AS n FROM criscikee_reviews r WHERE ${W} GROUP BY r.impression`,
      ).bind(...vals).all<{ k: string; n: number }>();
      const { results: byRating } = await env.DB.prepare(
        `SELECT r.rating AS k, COUNT(*) AS n FROM criscikee_reviews r WHERE ${W} GROUP BY r.rating`,
      ).bind(...vals).all<{ k: number; n: number }>();

      /* The cube: flavour x gender x age group, with a count and an average
         and the sentiment split. Four flavours make 72 cells - small enough
         to ship whole, so the segment picker on the tab filters in the
         browser with no second request. Flavour x gender and flavour x age
         group are rolled up from the same rows below. */
      const { results: cube } = await env.DB.prepare(
        `SELECT r.flavor_id, r.gender, r.age_group, COUNT(*) AS n, AVG(r.rating) AS avg_rating, ${SENT}
           FROM criscikee_reviews r WHERE ${W}
          GROUP BY r.flavor_id, r.gender, r.age_group`,
      ).bind(...vals).all<{ flavor_id: number; gender: Gender; age_group: AgeGroup; n: number; avg_rating: number; positive: number; neutral: number; negative: number }>();

      const { results: fxg } = await env.DB.prepare(
        `SELECT r.flavor_id, r.gender AS k, COUNT(*) AS n, AVG(r.rating) AS avg_rating FROM criscikee_reviews r WHERE ${W} GROUP BY r.flavor_id, r.gender`,
      ).bind(...vals).all<{ flavor_id: number; k: string; n: number; avg_rating: number }>();
      const { results: fxa } = await env.DB.prepare(
        `SELECT r.flavor_id, r.age_group AS k, COUNT(*) AS n, AVG(r.rating) AS avg_rating FROM criscikee_reviews r WHERE ${W} GROUP BY r.flavor_id, r.age_group`,
      ).bind(...vals).all<{ flavor_id: number; k: string; n: number; avg_rating: number }>();

      /* The most recent comments per flavour, for Customer Voice - three each,
         so the section is real words on first paint without a second call. */
      /* The inner window carries the SAME date filter (W with the alias
         swapped), so "the three most recent" means within the period being
         looked at, not three that may all fall outside it. */
      const Wx = W.replace(/\br\./g, "x.");
      const { results: voice } = await env.DB.prepare(
        `SELECT r.id, r.flavor_id, r.comment, r.rating, r.sentiment, r.gender, r.age_group, r.reviewed_on
           FROM criscikee_reviews r
          WHERE ${W} AND r.id IN (
            SELECT id FROM (
              SELECT x.id, ROW_NUMBER() OVER (PARTITION BY x.flavor_id ORDER BY x.reviewed_on DESC, x.id DESC) AS rn
                FROM criscikee_reviews x WHERE ${Wx}
            ) WHERE rn <= 3)
          ORDER BY r.reviewed_on DESC, r.id DESC`,
      ).bind(...vals).all<{ id: number; flavor_id: number; comment: string; rating: number; sentiment: Sentiment; gender: Gender; age_group: AgeGroup; reviewed_on: string }>();

      /* ---- insights, with the sample rule ---- */
      const pct = (a: number, n: number) => (n > 0 ? Math.round((a / n) * 1000) / 10 : 0);
      const flavors = (byFlavor ?? []).map((f) => ({
        ...f, avg_rating: f.avg_rating == null ? null : Math.round(f.avg_rating * 100) / 100,
        positive_pct: pct(f.positive, f.n), neutral_pct: pct(f.neutral, f.n), negative_pct: pct(f.negative, f.n),
        enough: f.n >= MIN_SAMPLE,
      }));
      const nameOf = new Map(flavors.map((f) => [f.flavor_id, f.name]));
      const qualified = flavors.filter((f) => f.enough);
      const top = <T,>(rows: T[], key: (r: T) => number) => rows.length ? rows.reduce((a, b) => (key(b) > key(a) ? b : a)) : null;
      const bestRated = top(qualified, (f) => f.avg_rating ?? 0);
      const mostReviewed = top(flavors.filter((f) => f.n > 0), (f) => f.n);
      const mostPositive = top(qualified, (f) => f.positive_pct);
      const mostNegative = top(qualified.filter((f) => f.negative > 0), (f) => f.negative_pct);

      const bestByGender: Record<string, { flavor: string; avg_rating: number; n: number } | null> = {};
      for (const g of GENDERS) {
        const rows = (fxg ?? []).filter((x) => x.k === g && x.n >= MIN_SAMPLE);
        const b = top(rows, (x) => x.avg_rating);
        bestByGender[g] = b ? { flavor: nameOf.get(b.flavor_id) ?? "?", avg_rating: Math.round(b.avg_rating * 100) / 100, n: b.n } : null;
      }
      const bestByAge: Record<string, { flavor: string; avg_rating: number; n: number } | null> = {};
      for (const a of AGE_GROUPS) {
        const rows = (fxa ?? []).filter((x) => x.k === a && x.n >= MIN_SAMPLE);
        const b = top(rows, (x) => x.avg_rating);
        bestByAge[a] = b ? { flavor: nameOf.get(b.flavor_id) ?? "?", avg_rating: Math.round(b.avg_rating * 100) / 100, n: b.n } : null;
      }
      /* Opportunity: the segment cells with a strong rating AND enough
         reviews to believe it. Ranked by rating, then by volume, top five. */
      const opportunity = (cube ?? [])
        .filter((c) => c.n >= MIN_SAMPLE && c.avg_rating >= 4)
        .sort((a, b) => b.avg_rating - a.avg_rating || b.n - a.n)
        .slice(0, 5)
        .map((c) => ({ flavor: nameOf.get(c.flavor_id) ?? "?", flavor_id: c.flavor_id, gender: c.gender, age_group: c.age_group,
                       n: c.n, avg_rating: Math.round(c.avg_rating * 100) / 100, positive_pct: pct(c.positive, c.n) }));
      const topGroup = top(byAge ?? [], (x) => x.n);
      const topGender = top(byGender ?? [], (x) => x.n);

      return json({
        from: isDay(from) ? from : null, to: isDay(to) ? to : null,
        min_sample: MIN_SAMPLE,
        kpis: {
          total_reviews: totals?.n ?? 0,
          avg_rating: totals?.avg_rating == null ? null : Math.round(totals.avg_rating * 100) / 100,
          positive_pct: pct(totals?.positive ?? 0, totals?.n ?? 0),
          neutral_pct: pct(totals?.neutral ?? 0, totals?.n ?? 0),
          negative_pct: pct(totals?.negative ?? 0, totals?.n ?? 0),
          most_loved: bestRated ? { flavor: bestRated.name, avg_rating: bestRated.avg_rating, n: bestRated.n } : null,
          most_reviewed: mostReviewed ? { flavor: mostReviewed.name, n: mostReviewed.n } : null,
          top_age_group: topGroup ? { age_group: topGroup.k, n: topGroup.n } : null,
          top_gender: topGender ? { gender: topGender.k, n: topGender.n } : null,
        },
        flavors,
        by_gender: Object.fromEntries((byGender ?? []).map((x) => [x.k, { n: x.n, avg_rating: Math.round(x.avg_rating * 100) / 100 }])),
        by_age_group: Object.fromEntries((byAge ?? []).map((x) => [x.k, { n: x.n, avg_rating: Math.round(x.avg_rating * 100) / 100 }])),
        by_impression: Object.fromEntries((byImpression ?? []).map((x) => [x.k, x.n])),
        by_rating: Object.fromEntries((byRating ?? []).map((x) => [String(x.k), x.n])),
        flavor_by_gender: (fxg ?? []).map((x) => ({ ...x, avg_rating: Math.round(x.avg_rating * 100) / 100 })),
        flavor_by_age_group: (fxa ?? []).map((x) => ({ ...x, avg_rating: Math.round(x.avg_rating * 100) / 100 })),
        segments: (cube ?? []).map((c) => ({ ...c, avg_rating: Math.round(c.avg_rating * 100) / 100, positive_pct: pct(c.positive, c.n) })),
        voice: voice ?? [],
        insights: {
          best_rated: bestRated ? { flavor: bestRated.name, avg_rating: bestRated.avg_rating, n: bestRated.n } : null,
          most_popular: mostReviewed ? { flavor: mostReviewed.name, n: mostReviewed.n } : null,
          most_positive: mostPositive ? { flavor: mostPositive.name, positive_pct: mostPositive.positive_pct, n: mostPositive.n } : null,
          most_negative: mostNegative ? { flavor: mostNegative.name, negative_pct: mostNegative.negative_pct, n: mostNegative.n } : null,
          best_by_gender: bestByGender,
          best_by_age_group: bestByAge,
          opportunity,
          too_few: flavors.filter((f) => f.n > 0 && !f.enough).map((f) => ({ flavor: f.name, n: f.n })),
        },
        can_review: canReview, can_manage: manage,
      });
    }

    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such table: criscikee/.test(msg)) {
      return json({ pending_migration: true, migration: "0125_criscikee", flavors: [], reviews: [], can_review: canReview, can_manage: manage });
    }
    return err("server_error", msg, 500);
  }
}

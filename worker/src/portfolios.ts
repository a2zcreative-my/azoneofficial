/**
 * v1.389.0 - STAFF PORTFOLIOS (the CEO, 19-11-2026: the Staff Portfolio Card Generator).
 *
 * One portfolio per staff member, beside the staff record and never a copy of it.
 *   - Name, position, department and photo are READ from `users` every time they are
 *     shown; the responsibilities are the person's list (responsibilities.ts, 0215) - only
 *     the items ticked PUBLIC there ever reach a card or the public page. Nothing here writes a staff record: the only way
 *     to change a staff photo is the existing POST /users/:id/photo door.
 *   - A portfolio adds what the record does not hold: tagline, introduction,
 *     specialties, expertise, experience, the contact
 *     details the CEO approved for the public (email and phone are each OFF until
 *     ticked), socials, a processed portrait (crop or cut-out), and the work.
 *   - Draft -> Published -> Unpublished. Publishing freezes what the public sees
 *     (`published_json`); a later draft edit stays private until it is published.
 *   - The public address is /portfolio/<slug> and is fixed once published, so a
 *     printed QR never breaks. No QR is offered until there is a page behind it.
 *   - The public reads (index.ts) show ONLY the frozen public fields plus the live
 *     name / position / department - never a staff id, IC, salary, address,
 *     attendance or any HR field - and nothing at all for a draft, an
 *     unpublished portfolio, or someone who has left.
 *
 * Who: `portfolio_manage` builds and edits; `portfolio_publish` publishes and
 * unpublishes (the approval). Each person may read their own portfolio.
 * v1.390.0 (the CEO, 19-11-2026: "Portfolios should be able to visible by the staff for them to
 * generate and download it by themselves"): each person on staff may also CREATE and EDIT their
 * OWN portfolio (never anyone else's) and send it for approval. Still only the approver
 * publishes, ticks a personal email or phone for the public, or unpublishes - so what the
 * public sees is always approved, and an edit to a published card stays private until the
 * approver publishes it again.
 * The review (0219, the CEO 19-11-2026: "Pre-checked COO, CCO based on the flow reporting chart"):
 * Send for approval goes first to the nearest COO or CCO ABOVE the person on the Organisation chart,
 * who marks it pre-checked or returns it with a note; then the approvers (`portfolio_publish`: the
 * CEO and the super admin) are asked to publish. No COO / CCO above them (they report straight to
 * the CEO, or are one) = straight to the approvers. The approver may still publish at any time.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { currentStaffSql, leaveOrgList, notify } from "./staff";
import { leaveAbove } from "./leave-chain";
import { canUser, rolesFor } from "./permissions";
import { portfolioOf } from "./responsibilities";
import { audit, err, json, putGuarded } from "./shared";

export const PORTFOLIO_SITE = "https://a2zcreative.my";
/** words that are pages, or would read as one, never a person's address */
const RESERVED = new Set(["staff", "elfia", "new", "edit", "admin", "portal", "index", "page", "api", "media", "portfolio"]);
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];
const IMAGE_MAX = 8 * 1024 * 1024;
const VIDEO_MAX = 60 * 1024 * 1024;
const LIST_MAX = 8;

export type PortfolioRow = {
  id: number; user_id: number; slug: string; state: "draft" | "published" | "unpublished"; template: string;
  tagline: string | null; intro: string | null; specialties: string | null; expertise: string | null;
  /** 0217 - the name the card and the public page show (a nickname); NULL = the staff record's full name */
  display_name?: string | null;
  /** 0218 - 'upper' = CAPITAL LETTERS, 'normal' / NULL = normal letters */
  name_case?: string | null;
  experience: string | null; contact_email: string | null; contact_phone: string | null; show_email: number; show_phone: number;
  socials: string | null; portrait_key: string | null; portrait_source_key: string | null; photo_crop: string | null;
  published_json: string | null; published_at: string | null; published_by: number | null; published_version: number | null;
  unpublished_at: string | null; version: number; created_at: string; updated_at: string | null;
};
type StaffBits = {
  id: number; name: string; full_name: string | null; position: string | null; role_title: string | null; department: string | null;
  photo_key: string | null; email: string | null; phone: string | null; current: number;
};
export type PublicSnapshot = {
  /** 0217 - only when a nickname is set, so an older snapshot reads the same */
  display_name?: string;
  /** 0218 - only when set to capitals, so an older snapshot reads the same */
  name_case?: "upper";
  tagline: string | null; intro: string | null; specialties: string[]; expertise: string[];
  experience: string | null; email: string | null; phone: string | null; socials: Record<string, string>;
  portrait_key: string | null; template: string;
  items: { id: number; kind: string; title: string; description: string | null; video_url: string | null; has_media: boolean; media_type: string | null; featured: boolean; media_key?: string | null }[];
};

const trimTo = (v: unknown, n: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
/** a list of short phrases: trimmed, de-duplicated, at most LIST_MAX */
function listOf(v: unknown, each = 80): string[] | null {
  if (v === undefined) return null;
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = trimTo(x, each);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= LIST_MAX) break;
  }
  return out;
}
const parseList = (s: string | null): string[] => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const parseObj = (s: string | null): Record<string, string> => { try { const v = JSON.parse(s ?? "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const SOCIAL_HOSTS: Record<string, RegExp> = {
  instagram: /^https:\/\/(www\.)?instagram\.com\//i, tiktok: /^https:\/\/(www\.)?tiktok\.com\//i, facebook: /^https:\/\/(www\.|m\.)?facebook\.com\//i,
  linkedin: /^https:\/\/(www\.)?linkedin\.com\//i, youtube: /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i,
};
/** only https links to the five networks, so a portfolio can never carry a link elsewhere */
function socialsOf(v: unknown): Record<string, string> | null | "bad" {
  if (v === undefined) return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const t = trimTo(raw, 200);
    if (!t) continue;
    if (!SOCIAL_HOSTS[k] || !SOCIAL_HOSTS[k]!.test(t)) return "bad";
    out[k] = t;
  }
  return out;
}
/** a video link may only be a YouTube, TikTok, Instagram or Facebook page */
const videoUrlOk = (u: string) => /^https:\/\/(www\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|vimeo\.com)\//i.test(u);
/** the person's own name, before "bin" / "binti" / "a/l" / "a/p", at most three words: "Nur Farah binti Ali" -> nur-farah */
export function slugOf(name: string): string {
  const own = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s(?:bin|binti|bt|bte|a\/l|a\/p)\s/)[0] ?? "";
  return own.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).slice(0, 3).join("-").slice(0, 40).replace(/-+$/, "");
}
const slugOk = (s: string) => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s) && /[a-z]/.test(s) && !s.includes("--") && !RESERVED.has(s);
/* 19-11-2026 (the CEO: "I dont want to touch staff photo, just want to add another photo of them
   for their portfolio") - a photo uploaded FOR THE PORTFOLIO is its own: portrait_source_key holds
   this marker instead of the staff photo it was made from, so a later change to the staff record
   photo never makes it stale, and the staff record photo is never written. */
export const OWN_PORTRAIT = "own";
const portraitCurrent = (key: string | null, source: string | null, staffPhoto: string | null) =>
  Boolean(key && (source === OWN_PORTRAIT || source === staffPhoto));
export const publicUrl = (slug: string) => `${PORTFOLIO_SITE}/portfolio/${slug}`;

async function staffOf(env: Env, userId: number): Promise<StaffBits | null> {
  return env.DB.prepare(
    `SELECT u.id, u.name, u.full_name, u.position, u.role_title, u.department, u.photo_key, u.email, u.phone,
            CASE WHEN ${currentStaffSql("u.")} THEN 1 ELSE 0 END AS current
       FROM users u WHERE u.id = ?1 AND u.role NOT IN ('customer', 'agent') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)`,
  ).bind(userId).first<StaffBits>();
}
const displayName = (s: { name: string; full_name: string | null }) => (s.full_name ?? "").trim() || s.name;
const positionOf = (s: StaffBits) => (s.position ?? "").trim() || (s.role_title ?? "").trim() || null;

/** the responsibilities a card or the public page may show: the ones ticked Public on the
    person's list (responsibilities.ts), at most five, in their order. None ticked - none shown. */
export async function publicDuties(env: Env, userId: number): Promise<{ public: string[]; key: string[]; all: number }> {
  try {
    const pf = await portfolioOf(env, userId);
    return { public: (pf?.public ?? []).slice(0, 5), key: pf?.key ?? [], all: pf?.responsibilities.length ?? 0 };
  } catch { return { public: [], key: [], all: 0 }; } // 0215 not applied yet: show none, never guess
}

async function itemsOf(env: Env, pid: number) {
  return (await env.DB.prepare(
    `SELECT id, kind, title, description, media_key, media_type, video_url, featured, sort_order, created_at
       FROM staff_portfolio_items WHERE portfolio_id = ?1 AND removed_at IS NULL ORDER BY featured DESC, sort_order, id`,
  ).bind(pid).all<{ id: number; kind: string; title: string; description: string | null; media_key: string | null; media_type: string | null; video_url: string | null; featured: number; sort_order: number; created_at: string }>()).results;
}

/** what publishing freezes: only the fields meant for the public */
async function snapshotOf(env: Env, p: PortfolioRow, s: StaffBits): Promise<PublicSnapshot> {
  const items = await itemsOf(env, p.id);
  return {
    ...(p.display_name?.trim() ? { display_name: p.display_name.trim() } : {}),
    ...(p.name_case === "upper" ? { name_case: "upper" as const } : {}),
    tagline: p.tagline, intro: p.intro, specialties: parseList(p.specialties),
    expertise: parseList(p.expertise), experience: p.experience,
    email: p.show_email ? (p.contact_email ?? null) : null, phone: p.show_phone ? (p.contact_phone ?? null) : null,
    socials: parseObj(p.socials),
    /* the approved photo: the processed portrait, else the staff photo of that moment */
    portrait_key: portraitCurrent(p.portrait_key, p.portrait_source_key, s.photo_key) ? p.portrait_key : (s.photo_key ?? p.portrait_key ?? null),
    template: p.template,
    items: items.filter((i) => i.kind === "video" ? Boolean(i.media_key || i.video_url) : Boolean(i.media_key))
      .map((i) => ({ id: i.id, kind: i.kind, title: i.title, description: i.description, video_url: i.video_url, has_media: Boolean(i.media_key), media_type: i.media_type, featured: Boolean(i.featured), media_key: i.media_key })),
  };
}

/** what a draft would publish, compared with what is live */
const changedSincePublish = (snap: PublicSnapshot, live: string | null) => {
  if (!live) return true;
  try { return JSON.stringify(snap) !== JSON.stringify(JSON.parse(live)); } catch { return true; }
};

async function rowOf(env: Env, id: number): Promise<PortfolioRow | null> {
  return env.DB.prepare(`SELECT * FROM staff_portfolios WHERE id = ?1`).bind(id).first<PortfolioRow>();
}

async function uniqueSlug(env: Env, base: string): Promise<string> {
  let b = slugOk(base) ? base : `${base || "staff"}-team`.replace(/^-/, "");
  if (!slugOk(b)) b = "a2z-team";
  for (let n = 1; n < 50; n++) {
    const s = n === 1 ? b : `${b.slice(0, 36)}-${n}`;
    const hit = await env.DB.prepare(`SELECT 1 FROM staff_portfolios WHERE slug = ?1 COLLATE NOCASE`).bind(s).first();
    if (!hit && slugOk(s)) return s;
  }
  return `${b.slice(0, 30)}-${Date.now().toString(36)}`;
}

type ReviewRow = { id: number; version: number; step: "submitted" | "prechecked" | "returned"; actor_id: number; assignee_id: number | null; note: string | null; created_at: string; actor_name: string | null; assignee_name: string | null; assignee_role: string | null };
/** 0219 - where the portfolio's review stands: its latest step, unless a publish came after it */
async function reviewOf(env: Env, p: PortfolioRow): Promise<ReviewRow | null> {
  const r = await env.DB.prepare(
    `SELECT r.id, r.version, r.step, r.actor_id, r.assignee_id, r.note, r.created_at,
            COALESCE(NULLIF(TRIM(a.full_name), ''), a.name) AS actor_name, COALESCE(NULLIF(TRIM(b.full_name), ''), b.name) AS assignee_name, b.role AS assignee_role
       FROM staff_portfolio_reviews r LEFT JOIN users a ON a.id = r.actor_id LEFT JOIN users b ON b.id = r.assignee_id
      WHERE r.portfolio_id = ?1 ORDER BY r.id DESC LIMIT 1`,
  ).bind(p.id).first<ReviewRow>().catch(() => null); // before 0219: no review yet
  if (!r) return null;
  if (p.state === "published" && p.published_at && p.published_at >= r.created_at) return null; // published since: done
  return r;
}
/** the pre-checker: the nearest COO or CCO above the person on the Organisation chart, or null */
async function prechecker(env: Env, userId: number): Promise<{ id: number; name: string; role: string } | null> {
  const above = leaveAbove(await leaveOrgList(env), userId);
  for (const a of above) {
    if (a.role === "ceo") return null; // reached the top first: nobody to pre-check
    if (a.role === "coo" || a.role === "cco") return { id: a.id, name: a.name, role: a.role };
  }
  return null;
}
async function approversOf(env: Env, except: number): Promise<number[]> {
  const roles = rolesFor("portfolio_publish") as readonly string[];
  return ((await env.DB.prepare(`SELECT id, role FROM users WHERE is_active = 1`).all<{ id: number; role: string }>()).results ?? [])
    .filter((u) => roles.includes(u.role) && u.id !== except).map((u) => u.id);
}
function reviewView(r: ReviewRow | null, p: PortfolioRow, user: StaffUser) {
  if (!r) return null;
  const stage = r.step === "returned" ? "returned" : r.step === "submitted" && r.assignee_id ? "precheck" : "approval";
  return {
    stage, version: r.version, at: r.created_at, note: r.note, by: r.actor_name,
    prechecker: stage === "precheck" ? { name: r.assignee_name, role: r.assignee_role } : null,
    prechecked_by: r.step === "prechecked" ? r.actor_name : null,
    changed_since: p.version !== r.version,
    mine_to_precheck: stage === "precheck" && r.assignee_id === user.id,
  };
}

/** v1.390.0 - the person's own portfolio, while they are on staff: they may build and edit it, never publish it */
const isOwn = (p: { user_id: number }, s: { current: number } | null, user: StaffUser) => p.user_id === user.id && Boolean(s?.current);

function detailOf(p: PortfolioRow, s: StaffBits, snap: PublicSnapshot, items: Awaited<ReturnType<typeof itemsOf>>, user: StaffUser, duties: { public: string[]; key: string[]; all: number }, review: ReviewRow | null = null) {
  const own = isOwn(p, s, user);
  const rv = reviewView(review, p, user);
  const live = p.published_json ? (JSON.parse(p.published_json) as PublicSnapshot) : null;
  return {
    portfolio: {
      id: p.id, user_id: p.user_id, slug: p.slug, state: p.state, template: p.template, tagline: p.tagline, intro: p.intro,
      display_name: p.display_name ?? null,
      name_case: p.name_case === "upper" ? "upper" : "normal",
      specialties: parseList(p.specialties), expertise: parseList(p.expertise),
      experience: p.experience, contact_email: p.contact_email, contact_phone: p.contact_phone,
      show_email: Boolean(p.show_email), show_phone: Boolean(p.show_phone), socials: parseObj(p.socials),
      portrait_key: p.portrait_key, photo_crop: (() => { try { return p.photo_crop ? JSON.parse(p.photo_crop) : null; } catch { return null; } })(),
      /* the staff photo changed after the portrait was made from it: the card falls back to the new photo */
      portrait_stale: Boolean(p.portrait_key) && !portraitCurrent(p.portrait_key, p.portrait_source_key, s.photo_key),
      /* the portfolio's own photo (uploaded for it), not one made from the staff record photo */
      portrait_own: Boolean(p.portrait_key && p.portrait_source_key === OWN_PORTRAIT),
      version: p.version, published_at: p.published_at, unpublished_at: p.unpublished_at, updated_at: p.updated_at,
      public_url: p.state === "published" ? publicUrl(p.slug) : null,
      address: publicUrl(p.slug),
      unpublished_changes: p.state === "published" ? changedSincePublish(snap, p.published_json) : null,
      live_photo_differs: Boolean(live && live.portrait_key !== snap.portrait_key),
    },
    staff: {
      id: s.id, name: displayName(s), position: positionOf(s), department: (s.department ?? "").trim() || null,
      photo_key: s.photo_key, email: s.email, phone: s.phone, current: Boolean(s.current),
    },
    /* the Public ones are what the card and the page show; Key and the count say what is not public yet */
    duties,
    /* 0219 - where the review stands (null: not sent, or published since) */
    review: rv,
    items: items.map((i) => ({ ...i, featured: Boolean(i.featured) })),
    can: {
      edit: canUser(user, "portfolio_manage") || own, publish: canUser(user, "portfolio_publish"), upload_staff_photo: canUser(user, "hr_manage"),
      /* v1.390.0 - "Send for approval": the owner, when they cannot publish it themselves */
      submit: own && !canUser(user, "portfolio_publish"),
      /* 0219 - the COO / CCO this submission waits on */
      precheck: Boolean(rv?.mine_to_precheck),
    },
  };
}

/** one way to make a draft - by a manager for a person, or by the person for themselves (v1.390.0) */
async function createFor(env: Env, s: StaffBits, user: StaffUser): Promise<Response> {
  const uid = s.id;
  const had = await env.DB.prepare(`SELECT id FROM staff_portfolios WHERE user_id = ?1`).bind(uid).first<{ id: number }>();
  if (had) return json({ id: had.id, existed: true });
  const slug = await uniqueSlug(env, slugOf(displayName(s)));
  const email = s.email && /@a2zcreative\.my$/i.test(s.email) ? s.email : null;
  const row = await env.DB.prepare(
    `INSERT INTO staff_portfolios (user_id, slug, contact_email, contact_phone, created_by, updated_by, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?5, datetime('now') WHERE NOT EXISTS (SELECT 1 FROM staff_portfolios WHERE user_id = ?1) RETURNING id`,
  ).bind(uid, slug, email, s.phone ?? null, user.id).first<{ id: number }>();
  if (!row) {
    const again = await env.DB.prepare(`SELECT id FROM staff_portfolios WHERE user_id = ?1`).bind(uid).first<{ id: number }>();
    return json({ id: again?.id ?? null, existed: true });
  }
  await audit(env, user.id, "portfolio.create", "staff_portfolios", String(row.id), { user_id: uid, slug, ...(uid === user.id ? { self: true } : {}) });
  return json({ id: row.id, slug }, 201);
}

export async function handlePortfolios(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, request: Request,
): Promise<Response | null> {
  const manage = canUser(user, "portfolio_manage");
  const publish = canUser(user, "portfolio_publish");

  /* ---- your own portfolio, for the Profile tab: build it, send it for approval, download and share once published ---- */
  if (path === "/portfolios/mine" && method === "POST") {
    const s = await staffOf(env, user.id);
    if (!s || !s.current) return err("not_on_staff", "Only people on staff have a portfolio", 403);
    return createFor(env, s, user);
  }
  if (path === "/portfolios/mine/submit" && method === "POST") {
    const p = await env.DB.prepare(`SELECT * FROM staff_portfolios WHERE user_id = ?1`).bind(user.id).first<PortfolioRow>();
    if (!p) return err("not_found", "Create your portfolio first", 404);
    const s = await staffOf(env, user.id);
    if (!s || !s.current) return err("not_on_staff", "Only people on staff have a portfolio", 403);
    if (!positionOf(s)) return err("incomplete", "Your staff record has no position yet - ask HR to add it before sending for approval", 409);
    /* 0219 - first the nearest COO / CCO above on the chart; nobody there = straight to the approvers */
    const pc = await prechecker(env, user.id);
    /* already waiting on this very version (a second tap): the same submission, nobody told twice */
    const last = await reviewOf(env, p);
    if (last && last.step !== "returned" && last.version === p.version) {
      return json({ ok: true, already: true, stage: last.step === "submitted" && last.assignee_id ? "precheck" : "approval", prechecker: last.assignee_id ? { name: last.assignee_name, role: last.assignee_role } : null, sent_to: 0 });
    }
    const row = await env.DB.prepare(`INSERT INTO staff_portfolio_reviews (portfolio_id, version, step, actor_id, assignee_id) VALUES (?1, ?2, 'submitted', ?3, ?4) RETURNING id`)
      .bind(p.id, p.version, user.id, pc?.id ?? null).first<{ id: number }>();
    const who = pc ? [pc.id] : await approversOf(env, user.id);
    const msg = pc
      ? `${displayName(s)} sent their portfolio card for your pre-check - open Staff -> Portfolios, check it and mark it pre-checked or return it`
      : `${displayName(s)} sent their portfolio card for approval - open Staff -> Portfolios to check and publish it`;
    for (const id of who) await notify(env, id, "portfolio", msg, `portfolio:${p.id}:ask:${row?.id ?? p.version}`, { once: true });
    await audit(env, user.id, "portfolio.submit", "staff_portfolios", String(p.id), { version: p.version, prechecker: pc?.id ?? null, to: who.length });
    return json({ ok: true, stage: pc ? "precheck" : "approval", prechecker: pc ? { name: pc.name, role: pc.role } : null, sent_to: who.length });
  }
  if (path === "/portfolios/mine" && method === "GET") {
    const p = await env.DB.prepare(`SELECT * FROM staff_portfolios WHERE user_id = ?1`).bind(user.id).first<PortfolioRow>();
    if (!p) return json({ portfolio: null });
    const s = await staffOf(env, p.user_id);
    if (!s) return json({ portfolio: null });
    return json(detailOf(p, s, await snapshotOf(env, p, s), await itemsOf(env, p.id), user, await publicDuties(env, p.user_id), await reviewOf(env, p)));
  }

  /* v1.390.0 - without a portfolio permission, a person reaches only their OWN portfolio's record routes */
  if (!manage && !publish) {
    const own = /^\/portfolios\/(\d+)(\/.*)?$/.exec(path);
    const row = own ? await env.DB.prepare(`SELECT user_id FROM staff_portfolios WHERE id = ?1`).bind(Number(own[1])).first<{ user_id: number }>() : null;
    const assigned = row && row.user_id !== user.id
      ? await env.DB.prepare(`SELECT assignee_id FROM staff_portfolio_reviews WHERE portfolio_id = ?1 ORDER BY id DESC LIMIT 1`).bind(Number(own![1])).first<{ assignee_id: number | null }>().catch(() => null)
      : null;
    if (!row || (row.user_id !== user.id && assigned?.assignee_id !== user.id)) {
      if (path === "/portfolios" || path.startsWith("/portfolios/")) return err("forbidden", "Portfolio access required", 403);
      return null;
    }
  }

  /* ---- the list: every person on staff, with their portfolio if they have one ---- */
  if (path === "/portfolios" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.name, u.full_name, u.position, u.role_title, u.department, u.photo_key,
              (SELECT COUNT(*) FROM staff_responsibilities r WHERE r.user_id = u.id AND r.is_public = 1) AS public_duties,
              p.id AS pid, p.slug, p.state, p.updated_at, p.published_at, p.tagline, p.portrait_key, p.portrait_source_key, p.specialties
         FROM users u LEFT JOIN staff_portfolios p ON p.user_id = u.id
        WHERE u.role NOT IN ('customer', 'agent', 'super_admin') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0) AND ${currentStaffSql("u.")}
        ORDER BY COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) COLLATE NOCASE`,
    ).all<Record<string, unknown>>();
    const people = results.map((r) => ({
      user_id: r.id as number, name: displayName(r as { name: string; full_name: string | null }),
      position: ((r.position as string | null) ?? "").trim() || ((r.role_title as string | null) ?? "").trim() || null,
      department: ((r.department as string | null) ?? "").trim() || null, photo_key: (r.photo_key as string | null) ?? null, public_duties: Number(r.public_duties ?? 0),
      portfolio: r.pid ? {
        id: r.pid as number, slug: r.slug as string, state: r.state as string, updated_at: r.updated_at ?? null, published_at: r.published_at ?? null,
        tagline: r.tagline ?? null, specialties: parseList((r.specialties as string | null) ?? null).length,
        public_url: r.state === "published" ? publicUrl(r.slug as string) : null,
        portrait_stale: Boolean(r.portrait_key) && !portraitCurrent(r.portrait_key as string | null, r.portrait_source_key as string | null, r.photo_key as string | null),
      } : null,
    }));
    /* 0219 - where each review stands (the latest step, unless published since) */
    const revs = ((await env.DB.prepare(
      `SELECT r.portfolio_id, r.step, r.assignee_id, r.created_at, COALESCE(NULLIF(TRIM(b.full_name), ''), b.name) AS assignee_name, b.role AS assignee_role
         FROM staff_portfolio_reviews r LEFT JOIN users b ON b.id = r.assignee_id
        WHERE r.id IN (SELECT MAX(id) FROM staff_portfolio_reviews GROUP BY portfolio_id)`,
    ).all<{ portfolio_id: number; step: string; assignee_id: number | null; created_at: string; assignee_name: string | null; assignee_role: string | null }>().catch(() => ({ results: [] }))).results ?? []);
    const revOf = new Map(revs.map((r) => [r.portfolio_id, r]));
    for (const x of people) {
      const r = x.portfolio ? revOf.get(x.portfolio.id) : undefined;
      const pubAt = x.portfolio?.published_at as string | null | undefined;
      const live = r && !(x.portfolio?.state === "published" && pubAt && pubAt >= r.created_at);
      (x as Record<string, unknown>).review = live && r ? {
        stage: r.step === "returned" ? "returned" : r.step === "submitted" && r.assignee_id ? "precheck" : "approval",
        prechecker: r.step === "submitted" && r.assignee_id ? { name: r.assignee_name, role: r.assignee_role } : null,
        mine: r.step === "submitted" && r.assignee_id === user.id,
      } : null;
    }
    const n = (st: string) => people.filter((x) => x.portfolio?.state === st).length;
    return json({
      people,
      counts: { staff: people.length, published: n("published"), draft: n("draft"), unpublished: n("unpublished"), none: people.filter((x) => !x.portfolio).length, no_photo: people.filter((x) => !x.photo_key).length },
      can: { edit: manage, publish },
    });
  }

  /* ---- create a draft for a person on staff (no photo needed) ---- */
  if (path === "/portfolios" && method === "POST") {
    if (!manage) return err("forbidden", "Only portfolio managers create a portfolio", 403);
    const uid = Number(body?.user_id);
    const s = Number.isInteger(uid) ? await staffOf(env, uid) : null;
    if (!s || !s.current) return err("not_found", "That person is not on staff", 404);
    return createFor(env, s, user);
  }

  const m = /^\/portfolios\/(\d+)(\/.*)?$/.exec(path);
  if (!m) return null;
  const p = await rowOf(env, Number(m[1]));
  if (!p) return err("not_found", "Portfolio not found", 404);
  const s = await staffOf(env, p.user_id);
  if (!s) return err("not_found", "Staff record not found", 404);
  const rest = m[2] ?? "";
  /* v1.390.0 - a manager edits anyone's; a person on staff edits their own (publish stays the approver's) */
  const writer = manage || isOwn(p, s, user);

  if (rest === "" && method === "GET") {
    return json(detailOf(p, s, await snapshotOf(env, p, s), await itemsOf(env, p.id), user, await publicDuties(env, p.user_id), await reviewOf(env, p)));
  }

  /* ---- edit the draft (the version guards two editors) ---- */
  if (rest === "" && method === "PUT") {
    if (!writer) return err("forbidden", "Only portfolio managers edit a portfolio", 403);
    if (Number(body?.version) !== p.version) return err("stale", "Someone else changed this portfolio - reload it", 409);
    const sets: string[] = []; const vals: unknown[] = [];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = ?${vals.length}`); };
    const text = (k: string, n: number) => { if (body && k in body) put(k, trimTo(body[k], n)); };
    text("tagline", 120); text("intro", 1200); text("experience", 40);
    if (body && "name_case" in body) { // 0218 - capitals or normal letters for the name on the card
      if (!["upper", "normal", null].includes(body.name_case as string | null)) return err("invalid_input", "The name is shown in capitals or in normal letters", 400);
      put("name_case", body.name_case === "upper" ? "upper" : null);
    }
    text("display_name", 60); // 0217 - the nickname on the card and the page; the staff record is never changed
    for (const k of ["specialties", "expertise"] as const) {
      const l = listOf(body?.[k], 60);
      if (l) put(k, JSON.stringify(k === "specialties" ? l.slice(0, 5) : l));
    }
    if (body && "template" in body) {
      if (!["navy", "gold", "light"].includes(String(body.template))) return err("invalid_input", "Unknown template", 400);
      put("template", String(body.template));
    }
    if (body && "contact_email" in body) {
      const e = trimTo(body.contact_email, 160);
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return err("invalid_input", "That email does not look right", 400);
      put("contact_email", e);
    }
    if (body && "contact_phone" in body) {
      const ph = trimTo(body.contact_phone, 24);
      if (ph && !/^\+?[0-9 ()-]{7,20}$/.test(ph)) return err("invalid_input", "That phone number does not look right", 400);
      put("contact_phone", ph);
    }
    /* the public contact is the CEO's approval, one tick each; only the publisher may tick it */
    for (const k of ["show_email", "show_phone"] as const) {
      if (body && k in body) {
        const on = body[k] === true ? 1 : 0;
        if (on !== p[k] && !publish) return err("forbidden", "Only the approver may show a person's email or phone in public", 403);
        put(k, on);
      }
    }
    const so = socialsOf(body?.socials);
    if (so === "bad") return err("invalid_input", "Social links must be https links to Instagram, TikTok, Facebook, LinkedIn or YouTube", 400);
    if (so) put("socials", JSON.stringify(so));
    if (body && "photo_crop" in body) {
      const c = body.photo_crop as Record<string, unknown> | null;
      const ok = c && [c.zoom, c.x, c.y].every((v) => typeof v === "number" && Number.isFinite(v)) && (c.zoom as number) >= 1 && (c.zoom as number) <= 4 && Math.abs(c.x as number) <= 1 && Math.abs(c.y as number) <= 1;
      put("photo_crop", ok ? JSON.stringify({ zoom: c!.zoom, x: c!.x, y: c!.y }) : null);
    }
    if (body && "slug" in body && String(body.slug) !== p.slug) {
      /* the address is printed inside every QR: fixed from the first publish */
      if (p.published_at) return err("slug_locked", "The address is fixed once a portfolio has been published - printed QR codes point at it", 409);
      const sl = String(body.slug).toLowerCase().trim();
      if (!slugOk(sl)) return err("invalid_input", "Use 3-40 lowercase letters, numbers and dashes", 400);
      const taken = await env.DB.prepare(`SELECT 1 FROM staff_portfolios WHERE slug = ?1 COLLATE NOCASE AND id != ?2`).bind(sl, p.id).first();
      if (taken) return err("slug_taken", "Another portfolio already uses that address", 409);
      put("slug", sl);
    }
    if (!sets.length) return json({ ok: true, version: p.version });
    vals.push(user.id); sets.push(`updated_by = ?${vals.length}`);
    vals.push(p.id, p.version);
    const res = await env.DB.prepare(
      `UPDATE staff_portfolios SET ${sets.join(", ")}, updated_at = datetime('now'), version = version + 1 WHERE id = ?${vals.length - 1} AND version = ?${vals.length}`,
    ).bind(...vals).run();
    if (!res.meta.changes) return err("stale", "Someone else changed this portfolio - reload it", 409);
    await audit(env, user.id, "portfolio.edit", "staff_portfolios", String(p.id), { fields: Object.keys(body ?? {}).filter((k) => k !== "version") });
    return json({ ok: true, version: p.version + 1 });
  }

  /* ---- the processed portrait (cropped, or with the background removed) ---- */
  if (rest === "/portrait" && method === "POST") {
    if (!writer) return err("forbidden", "Only portfolio managers change the portrait", 403);
    const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
    if (!IMAGE_TYPES.includes(ct)) return err("invalid_input", "Only JPG, PNG or WebP images", 400);
    const key = `private/portfolio/${p.id}-portrait-${Date.now()}.${ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : "jpg"}`;
    const rejected = await putGuarded(env.MEDIA, key, request, { max: IMAGE_MAX, contentType: ct });
    if (rejected) return rejected;
    /* ?own=1 - the portfolio's own photo (or a cut-out of it): kept apart from the staff record photo */
    const own = new URL(request.url).searchParams.get("own") === "1";
    await env.DB.prepare(`UPDATE staff_portfolios SET portrait_key = ?1, portrait_source_key = ?2, updated_by = ?3, updated_at = datetime('now'), version = version + 1 WHERE id = ?4`)
      .bind(key, own ? OWN_PORTRAIT : s.photo_key, user.id, p.id).run();
    await audit(env, user.id, "portfolio.portrait", "staff_portfolios", String(p.id), { key, ...(own ? { own: true } : { from_photo: s.photo_key }) });
    return json({ portrait_key: key }, 201);
  }
  if (rest === "/portrait/reset" && method === "POST") {
    if (!writer) return err("forbidden", "Only portfolio managers change the portrait", 403);
    await env.DB.prepare(`UPDATE staff_portfolios SET portrait_key = NULL, portrait_source_key = NULL, updated_by = ?1, updated_at = datetime('now'), version = version + 1 WHERE id = ?2`).bind(user.id, p.id).run();
    await audit(env, user.id, "portfolio.portrait_reset", "staff_portfolios", String(p.id));
    return json({ ok: true });
  }

  /* ---- the work: a project image or a video ---- */
  if (rest === "/items" && method === "POST") {
    if (!writer) return err("forbidden", "Only portfolio managers add work", 403);
    const kind = body?.kind === "video" ? "video" : "image";
    const title = trimTo(body?.title, 120);
    if (!title) return err("invalid_input", "Give the work a title", 400);
    const vurl = trimTo(body?.video_url, 300);
    if (vurl && !videoUrlOk(vurl)) return err("invalid_input", "A video link may be YouTube, TikTok, Instagram, Facebook or Vimeo", 400);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM staff_portfolio_items WHERE portfolio_id = ?1 AND removed_at IS NULL`).bind(p.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= 24) return err("too_many", "A portfolio holds up to 24 pieces of work", 409);
    const row = await env.DB.prepare(
      `INSERT INTO staff_portfolio_items (portfolio_id, kind, title, description, video_url, featured, sort_order, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
    ).bind(p.id, kind, title, trimTo(body?.description, 600), kind === "video" ? vurl : null, body?.featured === true ? 1 : 0, (count?.n ?? 0) + 1, user.id).first<{ id: number }>();
    await audit(env, user.id, "portfolio.item_add", "staff_portfolios", String(p.id), { item: row?.id, kind });
    return json({ id: row?.id }, 201);
  }
  const it = /^\/items\/(\d+)(\/media|\/remove)?$/.exec(rest);
  if (it) {
    if (!writer) return err("forbidden", "Only portfolio managers change work", 403);
    const item = await env.DB.prepare(`SELECT id, kind FROM staff_portfolio_items WHERE id = ?1 AND portfolio_id = ?2 AND removed_at IS NULL`).bind(Number(it[1]), p.id).first<{ id: number; kind: string }>();
    if (!item) return err("not_found", "That work is not on this portfolio", 404);
    if (it[2] === "/media" && method === "POST") {
      const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
      const okType = item.kind === "video" ? [...VIDEO_TYPES, ...IMAGE_TYPES] : IMAGE_TYPES;
      if (!okType.includes(ct)) return err("invalid_input", item.kind === "video" ? "MP4 or WebM video, or a JPG, PNG or WebP cover" : "Only JPG, PNG or WebP images", 400);
      const ext = ct.split("/")[1]!.replace("jpeg", "jpg");
      const key = `private/portfolio/${p.id}-item-${item.id}-${Date.now()}.${ext}`;
      const rejected = await putGuarded(env.MEDIA, key, request, { max: VIDEO_TYPES.includes(ct) ? VIDEO_MAX : IMAGE_MAX, contentType: ct });
      if (rejected) return rejected;
      await env.DB.prepare(`UPDATE staff_portfolio_items SET media_key = ?1, media_type = ?2, updated_at = datetime('now') WHERE id = ?3`).bind(key, ct, item.id).run();
      await audit(env, user.id, "portfolio.item_media", "staff_portfolios", String(p.id), { item: item.id, type: ct });
      return json({ media_key: key }, 201);
    }
    if (it[2] === "/remove" && method === "POST") {
      await env.DB.prepare(`UPDATE staff_portfolio_items SET removed_at = datetime('now'), removed_by = ?1 WHERE id = ?2 AND removed_at IS NULL`).bind(user.id, item.id).run();
      await audit(env, user.id, "portfolio.item_remove", "staff_portfolios", String(p.id), { item: item.id });
      return json({ ok: true });
    }
    if (!it[2] && method === "PUT") {
      const sets: string[] = []; const vals: unknown[] = [];
      const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = ?${vals.length}`); };
      if (body && "title" in body) { const t = trimTo(body.title, 120); if (!t) return err("invalid_input", "Give the work a title", 400); put("title", t); }
      if (body && "description" in body) put("description", trimTo(body.description, 600));
      if (body && "featured" in body) put("featured", body.featured === true ? 1 : 0);
      if (body && "sort_order" in body && Number.isInteger(body.sort_order)) put("sort_order", body.sort_order);
      if (body && "video_url" in body) {
        const v = trimTo(body.video_url, 300);
        if (v && !videoUrlOk(v)) return err("invalid_input", "A video link may be YouTube, TikTok, Instagram, Facebook or Vimeo", 400);
        put("video_url", v);
      }
      if (!sets.length) return json({ ok: true });
      vals.push(item.id);
      await env.DB.prepare(`UPDATE staff_portfolio_items SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?${vals.length}`).bind(...vals).run();
      await audit(env, user.id, "portfolio.item_edit", "staff_portfolios", String(p.id), { item: item.id });
      return json({ ok: true });
    }
  }

  /* ---- 0219 the pre-check: only the COO / CCO the submission waits on ---- */
  if (rest === "/precheck" && method === "POST") {
    const r = await reviewOf(env, p);
    if (!r || r.step !== "submitted" || !r.assignee_id) return err("invalid_state", "This portfolio is not waiting for a pre-check", 409);
    if (r.assignee_id !== user.id) return err("forbidden", "Only the pre-checker on the reporting chart may pre-check it", 403);
    const ok = body?.decision === "ok";
    if (!ok && body?.decision !== "return") return err("invalid_input", "Mark it pre-checked or return it", 400);
    const note = trimTo(body?.note, 500);
    if (!ok && (!note || note.length < 5)) return err("invalid_input", "Say what needs changing (5 characters or more)", 400);
    /* the row is written only while the submission is still the latest step (two clicks, one step) */
    const res = await env.DB.prepare(
      `INSERT INTO staff_portfolio_reviews (portfolio_id, version, step, actor_id, assignee_id, note)
       SELECT ?1, ?2, ?3, ?4, NULL, ?5 WHERE (SELECT id FROM staff_portfolio_reviews WHERE portfolio_id = ?1 ORDER BY id DESC LIMIT 1) = ?6`,
    ).bind(p.id, p.version, ok ? "prechecked" : "returned", user.id, note, r.id).run();
    if (!res.meta.changes) return err("already_decided", "Someone already acted on this - reload it", 409);
    const me = displayName({ name: user.name, full_name: (user as { full_name?: string | null }).full_name ?? null });
    if (ok) {
      for (const id of await approversOf(env, user.id)) await notify(env, id, "portfolio", `${displayName(s)}'s portfolio card was pre-checked by ${me} - open Staff -> Portfolios to publish it`, `portfolio:${p.id}:pre:${r.id}`, { once: true });
      await notify(env, p.user_id, "portfolio", `${me} pre-checked your portfolio card - it now waits for the CEO's approval`, `portfolio:${p.id}:pre-own:${r.id}`, { once: true });
    } else {
      await notify(env, p.user_id, "portfolio", `${me} returned your portfolio card: ${note} - open Profile, edit it and send it again`, `portfolio:${p.id}:ret:${r.id}`, { once: true });
    }
    await audit(env, user.id, ok ? "portfolio.prechecked" : "portfolio.returned", "staff_portfolios", String(p.id), { version: p.version, ...(note ? { note } : {}) });
    return json({ ok: true, stage: ok ? "approval" : "returned" });
  }

  /* ---- publish: the approval. It freezes exactly what the public will see ---- */
  if (rest === "/publish" && method === "POST") {
    if (!publish) return err("forbidden", "Only the approver publishes a portfolio", 403);
    if (!s.current) return err("not_on_staff", "This person is no longer on staff", 409);
    if (Number(body?.version) !== p.version) return err("stale", "The portfolio changed - check it again before publishing", 409);
    if (!positionOf(s)) return err("incomplete", "Give this person a position on their staff record first", 409);
    const snap = await snapshotOf(env, p, s);
    const res = await env.DB.prepare(
      `UPDATE staff_portfolios SET state = 'published', published_json = ?1, published_at = datetime('now'), published_by = ?2, published_version = version,
              unpublished_at = NULL, unpublished_by = NULL WHERE id = ?3 AND version = ?4`,
    ).bind(JSON.stringify(snap), user.id, p.id, p.version).run();
    if (!res.meta.changes) return err("stale", "The portfolio changed - check it again before publishing", 409);
    await audit(env, user.id, "portfolio.publish", "staff_portfolios", String(p.id), { slug: p.slug, version: p.version, show_email: Boolean(snap.email), show_phone: Boolean(snap.phone), items: snap.items.length });
    if (p.user_id !== user.id) await notify(env, p.user_id, "portfolio", "Your portfolio is published - open Profile to download and share your card", `portfolio:${p.id}:pub:${p.version}`, { once: true });
    return json({ ok: true, public_url: publicUrl(p.slug) });
  }
  if (rest === "/unpublish" && method === "POST") {
    if (!publish) return err("forbidden", "Only the approver unpublishes a portfolio", 403);
    if (p.state !== "published") return err("invalid_state", "This portfolio is not published", 409);
    await env.DB.prepare(`UPDATE staff_portfolios SET state = 'unpublished', unpublished_at = datetime('now'), unpublished_by = ?1 WHERE id = ?2 AND state = 'published'`).bind(user.id, p.id).run();
    await audit(env, user.id, "portfolio.unpublish", "staff_portfolios", String(p.id), { slug: p.slug, reason: trimTo(body?.reason, 200) });
    return json({ ok: true });
  }
  return null;
}

/* ================= THE PUBLIC READS (index.ts calls these with no session) ================= */

/** a published portfolio of someone still on staff, or null: drafts, unpublished and leavers are never shown */
export async function publicPortfolio(env: Env, slug: string): Promise<{ p: PortfolioRow; s: StaffBits; snap: PublicSnapshot; duties: string[] } | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const p = await env.DB.prepare(`SELECT * FROM staff_portfolios WHERE slug = ?1 COLLATE NOCASE AND state = 'published' AND published_json IS NOT NULL`).bind(slug).first<PortfolioRow>();
  if (!p) return null;
  const s = await staffOf(env, p.user_id);
  if (!s || !s.current) return null;
  let snap: PublicSnapshot;
  try { snap = JSON.parse(p.published_json!) as PublicSnapshot; } catch { return null; }
  return { p, s, snap, duties: (await publicDuties(env, p.user_id)).public };
}

/** the page's data: the frozen public fields, the live name / position / department, and nothing else */
export function publicView(x: { p: PortfolioRow; s: StaffBits; snap: PublicSnapshot; duties: string[] }) {
  const { p, s, snap } = x;
  return {
    slug: p.slug, url: publicUrl(p.slug), name: snap.display_name?.trim() || displayName(s), name_case: snap.name_case === "upper" ? "upper" : "normal", position: positionOf(s), department: (s.department ?? "").trim() || null,
    tagline: snap.tagline, intro: snap.intro, specialties: snap.specialties, expertise: snap.expertise, experience: snap.experience,
    responsibilities: x.duties,
    email: snap.email, phone: snap.phone, socials: snap.socials, template: snap.template,
    has_photo: Boolean(snap.portrait_key),
    items: snap.items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, description: i.description, video_url: i.video_url, has_media: i.has_media, media_type: i.media_type, featured: i.featured })),
    published_at: p.published_at,
  };
}

/** the R2 key a public request may read: the approved portrait, or a published item's file */
export async function publicMediaKey(env: Env, x: { p: PortfolioRow; snap: PublicSnapshot }, what: "portrait" | number): Promise<string | null> {
  if (what === "portrait") return x.snap.portrait_key;
  /* the file frozen at publish, never a later replacement nobody approved */
  void env;
  return x.snap.items.find((i) => i.id === what && i.has_media)?.media_key ?? null;
}

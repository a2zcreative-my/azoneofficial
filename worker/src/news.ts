/* v1.217.0 - NEWS & ANNOUNCEMENTS 2.0 (the owner's brief, 28-10-2026, and his
 * answers to claude/NEWS-ANNOUNCEMENTS-AUDIT.md): the memo fix (migration
 * 0146), the publisher taken from the login, new joiners asked only for posts
 * since they joined, and the four options he ticked - important / pinned,
 * department targeting, edit with versions, attachments.
 *
 * ONE ANNOUNCEMENT RECORD. The routes below replace the three that lived in
 * staff.ts (GET/POST /announcements, POST /announcements/:id/ack) at the same
 * paths, over the same two tables, so the Dashboard, the Desk and the bell
 * keep reading what they always read.
 *
 * ACCURATE ACKNOWLEDGEMENT HISTORY. An acknowledgement is (post, person,
 * version), keyed once, timed by the server, for the person signed in. A
 * person acknowledges the version they were shown: if the post changed while
 * they read it, the server refuses and the screen shows the new text. An edit
 * that changes the words keeps the old text in announcement_versions and asks
 * for a fresh acknowledgement; the old one stays, tied to its version.
 *
 * ROLE-BASED VISIBILITY. A post is for everyone, or for the departments it
 * names. Management (team_manage) sees every post; a person sees the posts
 * for them and their own. A post needs acknowledging from a recipient who is
 * not its publisher and was employed when it went out. Customers never reach
 * /staff/*. */
import type { Env } from "./index";
import { json, err, audit, putGuarded, str } from "./shared";
import { can } from "./permissions";

export const ANN_CATS = ["news", "meeting", "holiday", "kpi", "training", "memo"] as const;
const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_FILES = 5;

type Me = { id: number; role: string; name: string };
interface Viewer { manager: boolean; dept: string | null; joined: string | null }

/** Is this post for the person? Everyone's, theirs, or a department they are in. */
export const annForMeSql = (a = "a", me = "?1", dept = "?2") =>
  `(${a}.audience IS NULL OR ${a}.created_by = ${me} OR EXISTS (SELECT 1 FROM json_each(${a}.audience) j WHERE j.value = ${dept}))`;
/** Does the post wait on the person's acknowledgement? For them, not theirs,
    and not from before they joined. */
export const annRequiredSql = (a = "a", me = "?1", dept = "?2", joined = "?3") =>
  `(COALESCE(${a}.created_by, 0) != ${me}
    AND (${a}.audience IS NULL OR EXISTS (SELECT 1 FROM json_each(${a}.audience) j WHERE j.value = ${dept}))
    AND (${joined} IS NULL OR date(${a}.created_at, '+8 hours') >= ${joined}))`;
/** ...and has the person acknowledged the version that stands? */
export const annAckedSql = (a = "a", me = "?1") =>
  `EXISTS (SELECT 1 FROM announcement_acks k WHERE k.announcement_id = ${a}.id AND k.user_id = ${me} AND k.version = ${a}.version)`;

export async function viewerOf(env: Env, user: { id: number; role: string }): Promise<Viewer> {
  const u = await env.DB.prepare(`SELECT department, joined_on FROM users WHERE id = ?1`).bind(user.id)
    .first<{ department: string | null; joined_on: string | null }>();
  const joined = u?.joined_on && /^\d{4}-\d{2}-\d{2}$/.test(u.joined_on) ? u.joined_on : null;
  return { manager: can(user.role, "team_manage"), dept: u?.department?.trim() || null, joined };
}

/** The people a post is for, today: current, active staff in its audience,
    not its publisher, employed on the day it went out. */
async function recipientsOf(env: Env, post: { created_by: number | null; created_at: string; audience: string | null }) {
  const { results } = await env.DB.prepare(
    `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, department, joined_on FROM users
      WHERE role NOT IN ('customer', 'super_admin') AND is_active = 1
        AND (left_on IS NULL OR left_on >= date('now', '+8 hours') OR (rejoined_on IS NOT NULL AND rejoined_on <= date('now', '+8 hours')))
        AND id != ?1
        AND (joined_on IS NULL OR joined_on = '' OR joined_on <= date(?2, '+8 hours'))
      ORDER BY name`,
  ).bind(post.created_by ?? 0, post.created_at).all<{ id: number; name: string; department: string | null; joined_on: string | null }>();
  const aud = audienceOf(post.audience);
  return aud ? results.filter((r) => r.department && aud.includes(r.department.trim())) : results;
}

const audienceOf = (raw: string | null): string[] | null => {
  if (!raw) return null;
  try { const a = JSON.parse(raw); return Array.isArray(a) && a.length ? a.filter((x): x is string => typeof x === "string") : null; } catch { return null; }
};

/** The departments a post can be sent to: those of the current staff. */
async function departments(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT TRIM(department) AS d FROM users
      WHERE department IS NOT NULL AND TRIM(department) != '' AND is_active = 1 AND role NOT IN ('customer', 'super_admin')
      ORDER BY d`,
  ).all<{ d: string }>();
  return results.map((r) => r.d);
}

async function publisherLine(env: Env, user: Me): Promise<string> {
  const u = await env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS n, position FROM users WHERE id = ?1`)
    .bind(user.id).first<{ n: string; position: string | null }>();
  const n = (u?.n ?? user.name).trim();
  return u?.position?.trim() ? `${n}, ${u.position.trim()}` : n;
}

/** The one post as this person may see it, or null. */
async function postFor(env: Env, id: number, user: Me, v: Viewer) {
  return env.DB.prepare(
    `SELECT a.id, a.title, a.body, a.category, a.created_by, a.created_at, a.audience, a.version, a.to_line, a.memo_date
       FROM announcements a WHERE a.id = ?3 AND (${v.manager ? "1" : annForMeSql("a", "?1", "?2")})`,
  ).bind(user.id, v.dept, id).first<{ id: number; title: string; body: string; category: string; created_by: number | null; created_at: string; audience: string | null; version: number; to_line: string | null; memo_date: string | null }>();
}

/** Validated fields from a publish or an edit body. `partial` leaves out what was not sent. */
async function readFields(env: Env, body: Record<string, unknown>, partial: boolean): Promise<{ ok: true; f: Record<string, unknown> } | { ok: false; res: Response }> {
  const f: Record<string, unknown> = {};
  const bad = (m: string) => ({ ok: false as const, res: err("invalid_input", m, 400) });
  if (!partial || body.title !== undefined) { if (!str(body.title, 200)) return bad("Write a subject (up to 200 characters)."); f.title = String(body.title).trim(); }
  if (!partial || body.body !== undefined) { if (!str(body.body, 5000)) return bad("Write the announcement (up to 5,000 characters)."); f.body = String(body.body).trim(); }
  if (!partial || body.category !== undefined) {
    if (typeof body.category !== "string" || !(ANN_CATS as readonly string[]).includes(body.category)) return bad("Choose a category.");
    f.category = body.category;
  }
  if (!partial || body.to !== undefined) f.to_line = typeof body.to === "string" && body.to.trim() ? body.to.trim().slice(0, 120) : null;
  if (!partial || body.memo_date !== undefined) f.memo_date = typeof body.memo_date === "string" && body.memo_date.trim() ? body.memo_date.trim().slice(0, 40) : null;
  if (!partial || body.important !== undefined) f.important = body.important === true ? 1 : 0;
  if (!partial || body.pinned !== undefined) f.pinned = body.pinned === true ? 1 : 0;
  if (!partial || body.audience !== undefined) {
    if (body.audience === null || body.audience === undefined || (Array.isArray(body.audience) && body.audience.length === 0)) f.audience = null;
    else {
      if (!Array.isArray(body.audience) || body.audience.length > 20) return bad("Choose the departments, or everyone.");
      const known = await departments(env);
      const picked = [...new Set(body.audience.map((d) => String(d).trim()))];
      if (!picked.every((d) => known.includes(d))) return bad("One of those departments has no current staff.");
      f.audience = JSON.stringify(picked);
    }
  }
  return { ok: true, f };
}

export async function handleNews(
  env: Env, request: Request, path: string, method: string, body: Record<string, unknown> | null, user: Me,
  notify: (env: Env, userId: number, kind: string, message: string, ref?: string) => Promise<void>,
): Promise<Response | null> {
  if (!path.startsWith("/announcements")) return null;

  /* ---- the feed: what this person may read, with their acknowledgement ---- */
  if (path === "/announcements" && method === "GET") {
    const v = await viewerOf(env, user);
    let rows: Record<string, unknown>[];
    try {
      ({ results: rows } = await env.DB.prepare(
        `SELECT a.id, a.title, a.body, a.category, a.created_by, a.created_at, a.important, a.pinned, a.audience,
                a.to_line, a.memo_date, a.from_name, a.version, a.updated_at,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS publisher_name, u.position AS publisher_position,
                (SELECT k.acked_at FROM announcement_acks k WHERE k.announcement_id = a.id AND k.user_id = ?1 AND k.version = a.version) AS acked_at,
                (SELECT MAX(k.version) FROM announcement_acks k WHERE k.announcement_id = a.id AND k.user_id = ?1) AS my_last_version,
                CASE WHEN ${annRequiredSql("a", "?1", "?2", "?3")} THEN 1 ELSE 0 END AS required
           FROM announcements a LEFT JOIN users u ON u.id = a.created_by
          WHERE ${v.manager ? "1" : annForMeSql("a", "?1", "?2")}
          ORDER BY a.pinned DESC, a.created_at DESC LIMIT 200`,
      ).bind(user.id, v.dept, v.joined).all());
    } catch (e) {
      if (!/no such column|no such table/.test(String(e))) throw e;
      /* before 0146: the old feed, unchanged */
      ({ results: rows } = await env.DB.prepare(
        `SELECT a.*, (SELECT COUNT(*) FROM announcement_acks k WHERE k.announcement_id = a.id AND k.user_id = ?1) AS acked
           FROM announcements a ORDER BY a.created_at DESC LIMIT 50`,
      ).bind(user.id).all());
      return json({ announcements: rows, pending_migration: true });
    }
    const files = new Map<number, { id: number; filename: string; content_type: string; size: number | null }[]>();
    try {
      const { results: fr } = await env.DB.prepare(
        `SELECT id, announcement_id, filename, content_type, size FROM announcement_files WHERE removed_at IS NULL ORDER BY id`,
      ).all<{ id: number; announcement_id: number; filename: string; content_type: string; size: number | null }>();
      for (const f of fr) { const l = files.get(f.announcement_id) ?? []; l.push({ id: f.id, filename: f.filename, content_type: f.content_type, size: f.size }); files.set(f.announcement_id, l); }
    } catch { /* pre-0146 */ }
    return json({
      announcements: rows.map((r) => ({ ...r, acked: r.acked_at ? 1 : 0, audience: audienceOf(r.audience as string | null), files: files.get(r.id as number) ?? [] })),
      can_publish: v.manager,
      ...(v.manager ? { departments: await departments(env) } : {}),
    });
  }

  /* ---- publish: management only; the publisher is the person signed in ---- */
  if (path === "/announcements" && method === "POST") {
    if (!can(user.role, "team_manage")) return err("forbidden", "Management access required", 403);
    const r = await readFields(env, body ?? {}, false);
    if (!r.ok) return r.res;
    const f = r.f;
    const from = await publisherLine(env, user);
    const res = await env.DB.prepare(
      `INSERT INTO announcements (title, body, category, created_by, important, pinned, audience, to_line, memo_date, from_name, version)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1) RETURNING id, created_at`,
    ).bind(f.title, f.body, f.category, user.id, f.important, f.pinned, f.audience, f.to_line, f.memo_date, from)
      .first<{ id: number; created_at: string }>();
    if (!res) return err("server_error", "The announcement was not saved.", 500);
    const people = await recipientsOf(env, { created_by: user.id, created_at: res.created_at, audience: f.audience as string | null });
    for (const p of people) {
      await notify(env, p.id, "announcement", `${f.important ? "Important: " : "New announcement: "}${f.title as string}`, `announcement:${res.id}`);
    }
    await audit(env, user.id, "announcement.create", "announcements", String(res.id), {
      category: f.category, important: f.important, pinned: f.pinned, audience: audienceOf(f.audience as string | null), recipients: people.length,
    });
    return json({ id: res.id, recipients: people.length }, 201);
  }

  const one = path.match(/^\/announcements\/(\d+)$/);

  /* ---- edit: management; a change of words is a new version ---- */
  if (one && method === "PATCH") {
    if (!can(user.role, "team_manage")) return err("forbidden", "Management access required", 403);
    const id = Number(one[1]);
    const cur = await env.DB.prepare(
      `SELECT id, title, body, category, to_line, memo_date, important, pinned, audience, version, created_by, created_at FROM announcements WHERE id = ?1`,
    ).bind(id).first<{ id: number; title: string; body: string; category: string; to_line: string | null; memo_date: string | null; important: number; pinned: number; audience: string | null; version: number; created_by: number | null; created_at: string }>();
    if (!cur) return err("not_found", "Announcement not found", 404);
    const seen = Number(body?.version);
    if (seen !== cur.version) return err("conflict", "Someone changed this announcement while you were editing it. Reload and check.", 409);
    const r = await readFields(env, body ?? {}, true);
    if (!r.ok) return r.res;
    const f = r.f;
    const next = { title: f.title ?? cur.title, body: f.body ?? cur.body, category: f.category ?? cur.category,
      to_line: f.to_line !== undefined ? f.to_line : cur.to_line, memo_date: f.memo_date !== undefined ? f.memo_date : cur.memo_date };
    const material = next.title !== cur.title || next.body !== cur.body || next.category !== cur.category
      || (next.to_line ?? null) !== (cur.to_line ?? null) || (next.memo_date ?? null) !== (cur.memo_date ?? null);
    const version = material ? cur.version + 1 : cur.version;
    if (material) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO announcement_versions (announcement_id, version, title, body, category, to_line, memo_date, replaced_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(id, cur.version, cur.title, cur.body, cur.category, cur.to_line, cur.memo_date, user.id).run();
    }
    const ran = await env.DB.prepare(
      `UPDATE announcements SET title = ?1, body = ?2, category = ?3, to_line = ?4, memo_date = ?5, important = ?6, pinned = ?7, audience = ?8,
              version = ?9, updated_at = datetime('now'), updated_by = ?10
        WHERE id = ?11 AND version = ?12`,
    ).bind(next.title, next.body, next.category, next.to_line, next.memo_date,
      f.important ?? cur.important, f.pinned ?? cur.pinned, f.audience !== undefined ? f.audience : cur.audience,
      version, user.id, id, cur.version).run();
    if (!ran.meta.changes) return err("conflict", "Someone changed this announcement while you were editing it. Reload and check.", 409);
    if (material) {
      const people = await recipientsOf(env, { created_by: cur.created_by, created_at: cur.created_at, audience: (f.audience !== undefined ? f.audience : cur.audience) as string | null });
      for (const p of people) await notify(env, p.id, "announcement", `Updated announcement: ${next.title} - please read it again`, `announcement:${id}`);
    }
    await audit(env, user.id, "announcement.edit", "announcements", String(id), {
      from_version: cur.version, to_version: version, material, fields: Object.keys(f),
    });
    return json({ ok: true, version });
  }

  /* ---- every version of a post, for whoever may read it ---- */
  const vers = path.match(/^\/announcements\/(\d+)\/versions$/);
  if (vers && method === "GET") {
    const v = await viewerOf(env, user);
    const post = await postFor(env, Number(vers[1]), user, v);
    if (!post) return err("not_found", "Announcement not found", 404);
    const { results } = await env.DB.prepare(
      `SELECT version, title, body, category, to_line, memo_date, replaced_at FROM announcement_versions WHERE announcement_id = ?1 ORDER BY version DESC`,
    ).bind(post.id).all();
    const { results: mine } = await env.DB.prepare(
      `SELECT version, acked_at FROM announcement_acks WHERE announcement_id = ?1 AND user_id = ?2 ORDER BY version DESC`,
    ).bind(post.id, user.id).all();
    return json({ current: post.version, versions: results, my_acks: mine });
  }

  /* ---- acknowledge: yourself, the version you read, once ---- */
  const ack = path.match(/^\/announcements\/(\d+)\/ack$/);
  if (ack && method === "POST") {
    const v = await viewerOf(env, user);
    const post = await postFor(env, Number(ack[1]), user, v);
    if (!post) return err("not_found", "Announcement not found", 404);
    const read = body?.version === undefined || body?.version === null ? post.version : Number(body.version);
    if (read !== post.version) {
      return err("conflict", "This announcement was updated after you opened it. Read the new version, then acknowledge it.", 409);
    }
    await env.DB.prepare(
      `INSERT INTO announcement_acks (announcement_id, user_id, version) VALUES (?1, ?2, ?3)
       ON CONFLICT(announcement_id, user_id, version) DO NOTHING`,
    ).bind(post.id, user.id, post.version).run();
    const row = await env.DB.prepare(`SELECT acked_at FROM announcement_acks WHERE announcement_id = ?1 AND user_id = ?2 AND version = ?3`)
      .bind(post.id, user.id, post.version).first<{ acked_at: string }>();
    return json({ ok: true, version: post.version, acked_at: row?.acked_at ?? null });
  }

  /* ---- who has acknowledged: management, read-only ---- */
  const acks = path.match(/^\/announcements\/(\d+)\/acks$/);
  if (acks && method === "GET") {
    if (!can(user.role, "team_manage")) return err("forbidden", "Management access required", 403);
    const post = await env.DB.prepare(`SELECT id, title, version, created_by, created_at, audience FROM announcements WHERE id = ?1`)
      .bind(Number(acks[1])).first<{ id: number; title: string; version: number; created_by: number | null; created_at: string; audience: string | null }>();
    if (!post) return err("not_found", "Announcement not found", 404);
    const people = await recipientsOf(env, post);
    const { results: k } = await env.DB.prepare(`SELECT user_id, version, acked_at FROM announcement_acks WHERE announcement_id = ?1`)
      .bind(post.id).all<{ user_id: number; version: number; acked_at: string }>();
    const rows = people.map((p) => {
      const mine = k.filter((x) => x.user_id === p.id);
      const now = mine.find((x) => x.version === post.version);
      return { id: p.id, name: p.name, department: p.department, acked_at: now?.acked_at ?? null,
        last_version: mine.length ? Math.max(...mine.map((x) => x.version)) : null };
    });
    return json({ id: post.id, title: post.title, version: post.version, recipients: rows,
      acknowledged: rows.filter((r) => r.acked_at).length, total: rows.length });
  }

  /* ---- the report: every post's completion, management, read-only ---- */
  if (path === "/announcements/report" && method === "GET") {
    if (!can(user.role, "team_manage")) return err("forbidden", "Management access required", 403);
    const { results: posts } = await env.DB.prepare(
      `SELECT a.id, a.title, a.category, a.version, a.created_by, a.created_at, a.audience, a.important, a.pinned,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS publisher_name
         FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.created_at DESC LIMIT 200`,
    ).all<{ id: number; title: string; category: string; version: number; created_by: number | null; created_at: string; audience: string | null; important: number; pinned: number; publisher_name: string | null }>();
    const { results: staffRows } = await env.DB.prepare(
      `SELECT id, department, joined_on FROM users
        WHERE role NOT IN ('customer', 'super_admin') AND is_active = 1
          AND (left_on IS NULL OR left_on >= date('now', '+8 hours') OR (rejoined_on IS NOT NULL AND rejoined_on <= date('now', '+8 hours')))`,
    ).all<{ id: number; department: string | null; joined_on: string | null }>();
    const { results: k } = await env.DB.prepare(`SELECT announcement_id, user_id, version FROM announcement_acks`)
      .all<{ announcement_id: number; user_id: number; version: number }>();
    const acked = new Set(k.map((x) => `${x.announcement_id}:${x.user_id}:${x.version}`));
    const myt = (ts: string) => new Date(new Date(ts.replace(" ", "T") + "Z").getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const out = posts.map((p) => {
      const aud = audienceOf(p.audience);
      const day = myt(p.created_at);
      const who = staffRows.filter((s) => s.id !== p.created_by && (!s.joined_on || s.joined_on <= day)
        && (!aud || (s.department && aud.includes(s.department.trim()))));
      const done = who.filter((s) => acked.has(`${p.id}:${s.id}:${p.version}`)).length;
      return { ...p, audience: aud, recipients: who.length, acknowledged: done };
    });
    return json({ posts: out });
  }

  /* ---- attachments: management uploads; whoever may read the post downloads ---- */
  const filesM = path.match(/^\/announcements\/(\d+)\/files$/);
  if (filesM && method === "POST") {
    if (!can(user.role, "team_manage")) return err("forbidden", "Management access required", 403);
    const id = Number(filesM[1]);
    const post = await env.DB.prepare(`SELECT id FROM announcements WHERE id = ?1`).bind(id).first<{ id: number }>();
    if (!post) return err("not_found", "Announcement not found", 404);
    if (!request.body) return err("invalid_input", "Choose a file.", 400);
    const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
    if (!FILE_TYPES.includes(ct)) return err("invalid_input", "Only PDF, JPEG, PNG or WebP files can be attached.", 400);
    const live = await env.DB.prepare(`SELECT COUNT(*) AS n FROM announcement_files WHERE announcement_id = ?1 AND removed_at IS NULL`)
      .bind(id).first<{ n: number }>();
    if ((live?.n ?? 0) >= MAX_FILES) return err("invalid_input", `An announcement can carry ${MAX_FILES} files.`, 400);
    const fname = (request.headers.get("X-File-Name") ?? "file").slice(0, 160);
    const key = `private/announcements/${id}-${Date.now()}-${fname.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const rejected = await putGuarded(env.MEDIA, key, request, { max: 10 * 1024 * 1024, contentType: ct });
    if (rejected) return rejected;
    const head = await env.MEDIA.head(key);
    const row = await env.DB.prepare(
      `INSERT INTO announcement_files (announcement_id, r2_key, filename, content_type, size, uploaded_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
    ).bind(id, key, fname, ct, head?.size ?? null, user.id).first<{ id: number }>();
    await audit(env, user.id, "announcement.file_add", "announcements", String(id), { file: fname, content_type: ct });
    return json({ ok: true, id: row?.id }, 201);
  }
  const fileOne = path.match(/^\/announcements\/(\d+)\/files\/(\d+)$/);
  if (fileOne && method === "GET") {
    const v = await viewerOf(env, user);
    const post = await postFor(env, Number(fileOne[1]), user, v);
    if (!post) return err("not_found", "Announcement not found", 404);
    const f = await env.DB.prepare(`SELECT r2_key, filename, content_type FROM announcement_files WHERE id = ?1 AND announcement_id = ?2 AND removed_at IS NULL`)
      .bind(Number(fileOne[2]), post.id).first<{ r2_key: string; filename: string; content_type: string }>();
    if (!f) return err("not_found", "File not found", 404);
    const obj = await env.MEDIA.get(f.r2_key);
    if (!obj) return err("not_found", "File missing from storage", 404);
    return new Response(obj.body, { headers: {
      "Content-Type": f.content_type,
      "Content-Disposition": `attachment; filename="${f.filename.replace(/[^A-Za-z0-9._ -]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    } });
  }
  if (fileOne && method === "DELETE") {
    if (!can(user.role, "team_manage")) return err("forbidden", "Management access required", 403);
    const f = await env.DB.prepare(`SELECT id, r2_key, filename FROM announcement_files WHERE id = ?1 AND announcement_id = ?2 AND removed_at IS NULL`)
      .bind(Number(fileOne[2]), Number(fileOne[1])).first<{ id: number; r2_key: string; filename: string }>();
    if (!f) return err("not_found", "File not found", 404);
    await env.DB.prepare(`UPDATE announcement_files SET removed_at = datetime('now'), removed_by = ?2 WHERE id = ?1 AND removed_at IS NULL`).bind(f.id, user.id).run();
    try { await env.MEDIA.delete(f.r2_key); } catch { /* best effort - the row is stamped */ }
    await audit(env, user.id, "announcement.file_remove", "announcements", fileOne[1]!, { file: f.filename });
    return json({ ok: true });
  }

  return null;
}

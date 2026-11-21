/**
 * v1.404.0 - THE SALES PLAYBOOK (Sales Command Center Phase 7; the CEO 21-11-2026, "As recommended" on the nine
 * Phase 7 decisions). Migration 0230. One door in staff.ts (/staff/playbook/*).
 *
 *   GET  /playbook                      readers: every PUBLISHED entry (its published version only); the CEO, COO and
 *                                       CCO (playbook_manage): every entry with its draft, status and lock
 *   GET  /playbook/:id/versions         managers: every published version of an entry, with its note
 *   POST /playbook                      managers: a new draft {section, kind, payload}
 *   PUT  /playbook/:id                  managers: save the draft {payload, files?, sort?, version}
 *   POST /playbook/:id/publish          managers: the draft becomes the next version {note, version}; the other
 *                                       managers are told; staff read it from that moment
 *   POST /playbook/:id/discard          managers: the draft goes back to the published version {version}
 *   POST /playbook/:id/restore          managers: an earlier version's words and files into the draft {from, version}
 *   POST /playbook/:id/archive          managers: hidden from staff {reason, version}; never deleted
 *   POST /playbook/:id/unarchive        managers: back as it was {version}
 *   POST /playbook/:id/files            managers: a raw PDF / image / Word body (X-File-Name), up to 10 MB, joins the draft
 *   GET  /playbook/files/:fid           a file of a published, unarchived version - or any file, for a manager
 *
 * THE RULES
 *   - Decision 1: anyone who may open Sales reads what is published; agents and customers never (by role). Only
 *     playbook_manage (the CEO, COO and CCO - not the super admin) writes.
 *   - Decision 2: staff read ONLY a published version. Publishing needs a note; every version is kept
 *     (playbook_versions is append-only by trigger) and an old one comes back by being published again.
 *   - Decision 3: no price is typed in. lib/playbook.ts checkPayload refuses a ringgit amount; an entry links
 *     packages (their live price is the Packages library's). Publishing re-checks that every linked package is
 *     active.
 *   - Every write carries the entry's version (409 `changed` when someone saved first) and is audited.
 *   - Nothing here touches a customer, a deal, a document, money or commission.
 */
import type { Env } from "./index";
import { notify, currentStaffSql, type StaffUser } from "./staff";
import { can, canUser } from "./permissions";
import { audit, err, json, putGuarded } from "./shared";
const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");
import { PB_FILE_TYPES, PB_KINDS, PB_LIMITS, PB_MAX_FILES, PB_MAX_FILE_BYTES, PB_SECTIONS, checkPayload, type PbPayload } from "../../lib/playbook";

type Row = {
  id: number; section: string; kind: string; status: string; draft: string; draft_files: string; has_draft: number;
  published_version: number | null; sort: number; version: number; created_at: string; updated_at: string;
  updated_by_name: string | null; archived_at: string | null; archive_reason: string | null;
  pub_payload: string | null; pub_files: string | null; pub_note: string | null; published_at: string | null; published_by_name: string | null;
};
type FileRow = { id: number; entry_id: number; filename: string; content_type: string; size: number | null };

const NEVER = ["agent", "customer"];
const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
const nameSql = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;

const ROW_SQL = `
  SELECT e.id, e.section, e.kind, e.status, e.draft, e.draft_files, e.has_draft, e.published_version, e.sort, e.version,
         e.created_at, e.updated_at, ${nameSql("ub")} AS updated_by_name, e.archived_at, e.archive_reason,
         v.payload AS pub_payload, v.files AS pub_files, v.note AS pub_note, v.published_at, ${nameSql("pb")} AS published_by_name
    FROM playbook_entries e
    LEFT JOIN playbook_versions v ON v.entry_id = e.id AND v.version = e.published_version
    LEFT JOIN users ub ON ub.id = e.updated_by
    LEFT JOIN users pb ON pb.id = v.published_by`;

export async function handlePlaybook(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, request: Request,
): Promise<Response | null> {
  if (path !== "/playbook" && !path.startsWith("/playbook/")) return null;
  if (NEVER.includes(user.role) || !canUser(user, "sales")) return err("forbidden", "Sales access required", 403);
  const manage = canUser(user, "playbook_manage");
  const managersOnly = () => err("forbidden", "Only the CEO, COO and CCO write the Sales Playbook", 403);
  const b = body ?? {};

  const filesOf = async (ids: number[]): Promise<FileRow[]> => {
    if (!ids.length) return [];
    const { results } = await env.DB.prepare(
      `SELECT id, entry_id, filename, content_type, size FROM playbook_files WHERE id IN (${ids.map(() => "?").join(",")})`,
    ).bind(...ids).all<FileRow>();
    const by = new Map((results ?? []).map((f) => [f.id, f]));
    return ids.map((i) => by.get(i)).filter((f): f is FileRow => !!f);
  };
  const shape = async (r: Row) => {
    const pubFiles = parse<number[]>(r.pub_files, []);
    const pub = r.published_version ? {
      version: r.published_version, payload: parse<PbPayload | null>(r.pub_payload, null), note: r.pub_note,
      published_at: r.published_at, published_by_name: r.published_by_name,
      files: (await filesOf(pubFiles)).map(({ entry_id: _e, ...f }) => f),
    } : null;
    if (!manage) return { id: r.id, section: r.section, kind: r.kind, sort: r.sort, published: pub };
    const draftFiles = parse<number[]>(r.draft_files, []);
    return {
      id: r.id, section: r.section, kind: r.kind, sort: r.sort, status: r.status, has_draft: r.has_draft === 1, lock: r.version,
      draft: parse<PbPayload | null>(r.draft, null), draft_files: (await filesOf(draftFiles)).map(({ entry_id: _e, ...f }) => f),
      updated_at: r.updated_at, updated_by_name: r.updated_by_name, archived_at: r.archived_at, archive_reason: r.archive_reason,
      published: pub,
    };
  };
  const loadRow = (id: number) => env.DB.prepare(`${ROW_SQL} WHERE e.id = ?1`).bind(id).first<Row>();
  const gone = () => err("not_found", "That Playbook entry does not exist", 404);
  const changed = () => err("changed", "Someone saved this entry while you were working on it. Reload it and try again.", 409);
  const skew = (e: unknown) => e instanceof Error && /no such (table|column)/.test(e.message);

  /* ---------------- the Playbook: published for everyone, everything for managers ---------------- */
  if (path === "/playbook" && method === "GET") {
    try {
      const { results } = await env.DB.prepare(
        `${ROW_SQL} ${manage ? "" : "WHERE e.status = 'published' AND e.published_version IS NOT NULL"}
          ORDER BY e.section, e.sort, e.id`,
      ).all<Row>();
      const entries = [];
      for (const r of results ?? []) entries.push(await shape(r));
      return json({ entries, can_manage: manage });
    } catch (e) {
      if (skew(e)) return json({ entries: [], can_manage: manage, pending_migration: true });
      throw e;
    }
  }

  /* ---------------- a file: the published version's for staff; any for a manager ---------------- */
  const fileM = path.match(/^\/playbook\/files\/(\d+)$/);
  if (fileM && method === "GET") {
    const fid = Number(fileM[1]);
    const f = await env.DB.prepare(`SELECT id, entry_id, r2_key, filename, content_type FROM playbook_files WHERE id = ?1`).bind(fid)
      .first<{ id: number; entry_id: number; r2_key: string; filename: string; content_type: string }>();
    if (!f) return err("not_found", "File not found", 404);
    if (!manage) {
      const e = await loadRow(f.entry_id);
      const listed = e && e.status === "published" && parse<number[]>(e.pub_files, []).includes(fid);
      if (!listed) return err("not_found", "File not found", 404);
    }
    const obj = await env.MEDIA.get(f.r2_key);
    if (!obj) return err("not_found", "File missing from storage", 404);
    return new Response(obj.body, { headers: {
      "Content-Type": f.content_type,
      "Content-Disposition": `attachment; filename="${f.filename.replace(/[^A-Za-z0-9._ -]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    } });
  }

  /* ---------------- everything below writes, or reads a manager's history ---------------- */
  if (!manage) return managersOnly();

  /* a new draft */
  if (path === "/playbook" && method === "POST") {
    const section = txt(b.section);
    const kind = txt(b.kind);
    if (!(PB_SECTIONS as readonly string[]).includes(section)) return err("invalid_input", "Choose a section.", 400);
    if (!(PB_KINDS as readonly string[]).includes(kind)) return err("invalid_input", "Choose a kind of entry.", 400);
    const chk = checkPayload(kind, b.payload);
    if (!chk.ok) return err("invalid_input", chk.problems.map((p) => p[0]).join(" "), 400);
    const pk = await packagesProblem(env, chk.payload.package_ids, false);
    if (pk) return err("invalid_input", pk, 400);
    const sort = await env.DB.prepare(`SELECT COALESCE(MAX(sort), 0) + 10 AS n FROM playbook_entries WHERE section = ?1`).bind(section).first<{ n: number }>();
    const row = await env.DB.prepare(
      `INSERT INTO playbook_entries (section, kind, status, draft, draft_files, has_draft, sort, version, created_by, updated_by)
       VALUES (?1, ?2, 'draft', ?3, '[]', 1, ?4, 1, ?5, ?5) RETURNING id`,
    ).bind(section, kind, JSON.stringify(chk.payload), sort?.n ?? 10, user.id).first<{ id: number }>();
    await audit(env, user.id, "playbook.create", "playbook_entries", String(row?.id), { section, kind, title: chk.payload.title });
    const r = row ? await loadRow(row.id) : null;
    return json({ ok: true, entry: r ? await shape(r) : null }, 201);
  }

  const one = path.match(/^\/playbook\/(\d+)(?:\/(versions|publish|discard|restore|archive|unarchive|files))?$/);
  if (!one) return null;
  const id = Number(one[1]);
  const act = one[2] ?? "";
  const cur = await loadRow(id);
  if (!cur) return gone();

  if (act === "versions" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT v.version, v.payload, v.files, v.note, v.restored_from, v.published_at, ${nameSql("u")} AS published_by_name
         FROM playbook_versions v LEFT JOIN users u ON u.id = v.published_by WHERE v.entry_id = ?1 ORDER BY v.version DESC`,
    ).bind(id).all<{ version: number; payload: string; files: string; note: string; restored_from: number | null; published_at: string; published_by_name: string | null }>();
    const out = [];
    for (const v of results ?? []) out.push({ ...v, payload: parse<PbPayload | null>(v.payload, null), files: (await filesOf(parse<number[]>(v.files, []))).map(({ entry_id: _e, ...f }) => f) });
    return json({ versions: out });
  }

  /* a file joins the draft (raw body; staff.ts leaves this path's body unread) */
  if (act === "files" && method === "POST") {
    if (cur.status === "archived") return err("archived", "Bring the entry back before adding a file.", 409);
    const lock = Number(new URL(request.url).searchParams.get("version"));
    if (lock !== cur.version) return changed();
    const draftFiles = parse<number[]>(cur.draft_files, []);
    if (draftFiles.length >= PB_MAX_FILES) return err("invalid_input", `An entry carries ${PB_MAX_FILES} files at most.`, 400);
    if (!request.body) return err("invalid_input", "Choose a file.", 400);
    const ct = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
    if (!(PB_FILE_TYPES as readonly string[]).includes(ct)) return err("invalid_input", "Only PDF, Word (.docx), JPEG, PNG or WebP files can be attached.", 400);
    const fname = (request.headers.get("X-File-Name") ?? "file").replace(/[\r\n"]/g, "").slice(0, 160) || "file";
    const key = `private/playbook/${id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${fname.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const rejected = await putGuarded(env.MEDIA, key, request, { max: PB_MAX_FILE_BYTES, contentType: ct });
    if (rejected) return rejected;
    const head = await env.MEDIA.head(key);
    const f = await env.DB.prepare(
      `INSERT INTO playbook_files (entry_id, r2_key, filename, content_type, size, uploaded_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
    ).bind(id, key, fname, ct, head?.size ?? null, user.id).first<{ id: number }>();
    const upd = await env.DB.prepare(
      `UPDATE playbook_entries SET draft_files = ?2, has_draft = 1, version = version + 1, updated_by = ?3, updated_at = datetime('now')
        WHERE id = ?1 AND version = ?4`,
    ).bind(id, JSON.stringify([...draftFiles, f!.id]), user.id, cur.version).run();
    if (!upd.meta?.changes) return changed(); // the file row stays, listed by no version - harmless and kept
    await audit(env, user.id, "playbook.file_add", "playbook_entries", String(id), { file: fname, content_type: ct, file_id: f!.id });
    const r = await loadRow(id);
    return json({ ok: true, file_id: f!.id, entry: r ? await shape(r) : null }, 201);
  }

  if (method !== "POST" && method !== "PUT") return null;
  if (Number(b.version) !== cur.version) return changed();

  /* save the draft */
  if (act === "" && method === "PUT") {
    if (cur.status === "archived") return err("archived", "Bring the entry back before editing it.", 409);
    const chk = checkPayload(cur.kind, b.payload);
    if (!chk.ok) return err("invalid_input", chk.problems.map((p) => p[0]).join(" "), 400);
    const pk = await packagesProblem(env, chk.payload.package_ids, false);
    if (pk) return err("invalid_input", pk, 400);
    const had = parse<number[]>(cur.draft_files, []);
    const files = Array.isArray(b.files) ? (b.files as unknown[]).map(Number) : had;
    if (files.some((f) => !had.includes(f))) return err("invalid_input", "A file can only be kept or removed here; add one with Attach file.", 400);
    const sort = b.sort === undefined ? cur.sort : Math.max(0, Math.min(100000, Math.round(Number(b.sort) || 0)));
    const upd = await env.DB.prepare(
      `UPDATE playbook_entries SET draft = ?2, draft_files = ?3, sort = ?4, has_draft = 1, version = version + 1, updated_by = ?5, updated_at = datetime('now')
        WHERE id = ?1 AND version = ?6`,
    ).bind(id, JSON.stringify(chk.payload), JSON.stringify(files), sort, user.id, cur.version).run();
    if (!upd.meta?.changes) return changed();
    await audit(env, user.id, "playbook.edit", "playbook_entries", String(id), { title: chk.payload.title, files_removed: had.filter((f) => !files.includes(f)) });
    const r = await loadRow(id);
    return json({ ok: true, entry: r ? await shape(r) : null });
  }

  /* publish: the draft becomes the next version, in one batch guarded by the lock */
  if (act === "publish" && method === "POST") {
    if (cur.status === "archived") return err("archived", "Bring the entry back before publishing it.", 409);
    if (cur.status === "published" && cur.has_draft !== 1) return err("nothing_to_publish", "There are no changes to publish.", 409);
    const note = txt(b.note).slice(0, PB_LIMITS.note + 1);
    if (note.length < 5) return err("invalid_input", "Say in a few words what changed (5 characters at least).", 400);
    if (note.length > PB_LIMITS.note) return err("invalid_input", `The note is longer than ${PB_LIMITS.note} characters.`, 400);
    const chk = checkPayload(cur.kind, parse(cur.draft, null));
    if (!chk.ok) return err("invalid_input", chk.problems.map((p) => p[0]).join(" "), 400);
    const pk = await packagesProblem(env, chk.payload.package_ids, true);
    if (pk) return err("invalid_input", pk, 400);
    const next = (cur.published_version ?? 0) + 1;
    const restored = Number.isInteger(Number(b.restored_from)) && Number(b.restored_from) > 0 && Number(b.restored_from) < next ? Number(b.restored_from) : null;
    const res = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO playbook_versions (entry_id, version, payload, files, note, restored_from, published_by)
         SELECT ?1, ?2, ?3, draft_files, ?4, ?5, ?6 FROM playbook_entries WHERE id = ?1 AND version = ?7`,
      ).bind(id, next, JSON.stringify(chk.payload), note, restored, user.id, cur.version),
      env.DB.prepare(
        `UPDATE playbook_entries SET status = 'published', published_version = ?2, has_draft = 0, version = version + 1, updated_by = ?3, updated_at = datetime('now')
          WHERE id = ?1 AND version = ?4 AND EXISTS (SELECT 1 FROM playbook_versions WHERE entry_id = ?1 AND version = ?2)`,
      ).bind(id, next, user.id, cur.version),
    ]);
    if (!res[1]?.meta?.changes) return changed();
    await audit(env, user.id, "playbook.publish", "playbook_entries", String(id), { version: next, note, title: chk.payload.title, restored_from: restored });
    try {
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.role FROM users u WHERE u.is_active = 1 AND u.id != ?1 AND u.role IN ('ceo', 'coo', 'cco', 'super_admin') AND ${currentStaffSql("u.")}`,
      ).bind(user.id).all<{ id: number; role: string }>();
      for (const m of results ?? []) {
        if (!can(m.role, "playbook_manage")) continue;
        await notify(env, m.id, "sales", `Sales Playbook: "${chk.payload.title}" published as version ${next} - ${note}`, `playbook:${id}:v${next}`, { once: true });
      }
    } catch { /* a notice never blocks the publish */ }
    const r = await loadRow(id);
    return json({ ok: true, version: next, entry: r ? await shape(r) : null });
  }

  /* throw the draft away: back to the published words and files */
  if (act === "discard" && method === "POST") {
    if (!cur.published_version) return err("never_published", "This entry has never been published; archive it instead.", 409);
    const upd = await env.DB.prepare(
      `UPDATE playbook_entries SET draft = ?2, draft_files = ?3, has_draft = 0, version = version + 1, updated_by = ?4, updated_at = datetime('now')
        WHERE id = ?1 AND version = ?5`,
    ).bind(id, cur.pub_payload, cur.pub_files ?? "[]", user.id, cur.version).run();
    if (!upd.meta?.changes) return changed();
    await audit(env, user.id, "playbook.discard", "playbook_entries", String(id), { back_to: cur.published_version });
    const r = await loadRow(id);
    return json({ ok: true, entry: r ? await shape(r) : null });
  }

  /* an earlier version's words and files into the draft (published again as a new version) */
  if (act === "restore" && method === "POST") {
    if (cur.status === "archived") return err("archived", "Bring the entry back first.", 409);
    const from = Number(b.from);
    const v = await env.DB.prepare(`SELECT payload, files FROM playbook_versions WHERE entry_id = ?1 AND version = ?2`).bind(id, from)
      .first<{ payload: string; files: string }>();
    if (!v) return err("not_found", "That version does not exist", 404);
    const upd = await env.DB.prepare(
      `UPDATE playbook_entries SET draft = ?2, draft_files = ?3, has_draft = 1, version = version + 1, updated_by = ?4, updated_at = datetime('now')
        WHERE id = ?1 AND version = ?5`,
    ).bind(id, v.payload, v.files, user.id, cur.version).run();
    if (!upd.meta?.changes) return changed();
    await audit(env, user.id, "playbook.restore", "playbook_entries", String(id), { from });
    const r = await loadRow(id);
    return json({ ok: true, restored_from: from, entry: r ? await shape(r) : null });
  }

  if (act === "archive" && method === "POST") {
    if (cur.status === "archived") return err("archived", "Already archived.", 409);
    const reason = txt(b.reason).slice(0, PB_LIMITS.reason + 1);
    if (reason.length < 5) return err("invalid_input", "Say why it is archived (5 characters at least).", 400);
    if (reason.length > PB_LIMITS.reason) return err("invalid_input", `The reason is longer than ${PB_LIMITS.reason} characters.`, 400);
    const upd = await env.DB.prepare(
      `UPDATE playbook_entries SET status = 'archived', archived_at = datetime('now'), archived_by = ?2, archive_reason = ?3, version = version + 1, updated_by = ?2, updated_at = datetime('now')
        WHERE id = ?1 AND version = ?4`,
    ).bind(id, user.id, reason, cur.version).run();
    if (!upd.meta?.changes) return changed();
    await audit(env, user.id, "playbook.archive", "playbook_entries", String(id), { reason });
    const r = await loadRow(id);
    return json({ ok: true, entry: r ? await shape(r) : null });
  }

  if (act === "unarchive" && method === "POST") {
    if (cur.status !== "archived") return err("not_archived", "This entry is not archived.", 409);
    const upd = await env.DB.prepare(
      `UPDATE playbook_entries SET status = CASE WHEN published_version IS NULL THEN 'draft' ELSE 'published' END,
              archived_at = NULL, archived_by = NULL, archive_reason = NULL, version = version + 1, updated_by = ?2, updated_at = datetime('now')
        WHERE id = ?1 AND version = ?3`,
    ).bind(id, user.id, cur.version).run();
    if (!upd.meta?.changes) return changed();
    await audit(env, user.id, "playbook.unarchive", "playbook_entries", String(id), {});
    const r = await loadRow(id);
    return json({ ok: true, entry: r ? await shape(r) : null });
  }

  return null;
}

/** Decision 3: an entry links packages from the ONE library. A draft may name any package that exists; a
    published version only active ones (staff then see each one's live price). */
async function packagesProblem(env: Env, ids: number[], publishing: boolean): Promise<string> {
  if (!ids.length) return "";
  const { results } = await env.DB.prepare(`SELECT id, status FROM sales_packages WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids).all<{ id: number; status: string }>();
  const found = new Map((results ?? []).map((r) => [r.id, r.status]));
  if (ids.some((i) => !found.has(i))) return "A linked package does not exist in the Packages library.";
  if (publishing && ids.some((i) => found.get(i) !== "active")) return "A linked package is not active in the Packages library. Remove it or make it active first.";
  return "";
}

/* v1.315.0 - TASKS WORKSPACE 5.0, GATE 4: THE LIVE HOST REPORT (the CEO,
 * 15-11-2026: "Approved as per recommendations", TK-1 and TK-14 in
 * claude/TASKS-WORKSPACE-5.0-BLUEPRINT.md; L2 and L3 of 12-11-2026 kept).
 *
 * One report per live session on the roster (L2: no report without a
 * session), written by that session's host - the host is read from the
 * session, never sent by the browser. Its life:
 *
 *   draft  --submit-->  submitted  --review-->  reviewed  --accept-->  accepted
 *     ^                     |                       |                     |
 *     +------ returned <----+--------return---------+        reopen (reason)
 *
 * - The host saves a draft (figures, notes, the company) and attaches the GMV
 *   screenshots (JPEG, PNG or WebP, 8 MB, up to 4 a version). Submitting
 *   freezes the figures as a new version and moves the screenshots onto it.
 * - The CEO, COO or CCO (live_report_review) reviews, accepts or returns it
 *   (a return needs the correction asked for), never on their own session
 *   (L3). An accepted report is reopened only with a reason.
 * - Versions, screenshots and reviews are kept: 0201's triggers refuse a
 *   rewrite or a delete.
 *
 * REPORTED GMV IS THE HOST'S OWN FIGURE. It is never verified sales, cash,
 * an invoice paid, commission or payroll: nothing here reads or writes those
 * tables (tests/live-reports.mjs counts their rows around every action).
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify } from "./staff";
import { can, canUser } from "./permissions";
import { audit, err, json, putGuarded } from "./shared";

type Report = {
  id: number; session_id: number; host_user_id: number; company: string | null; state: string; current_version: number;
  draft_gmv_cents: number | null; draft_duration_min: number | null; draft_highlights: string | null; draft_blockers: string | null; draft_next_actions: string | null;
  created_at: string; updated_at: string;
};
type Session = { id: number; session_date: string; start_time: string; end_time: string | null; platform: string; status: string; host_user_id: number; client_name: string | null };

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 4;
const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

function pending(e: unknown): Response | null {
  return /no such table|no such column/i.test(String(e)) ? err("pending_migration", "Run PUSH.bat so migration 0201 applies, then retry", 409) : null;
}

async function sessionOf(env: Env, id: number): Promise<Session | null> {
  return await env.DB.prepare(`SELECT id, session_date, start_time, end_time, platform, status, host_user_id, client_name FROM live_sessions WHERE id = ?1`).bind(id).first<Session>();
}
async function reportOf(env: Env, id: number): Promise<Report | null> {
  return await env.DB.prepare(`SELECT * FROM live_reports WHERE id = ?1`).bind(id).first<Report>();
}
/** The reviewers to tell (the CEO, COO and CCO on staff), never the host. */
async function reviewers(env: Env, except: number): Promise<number[]> {
  const rows = (await env.DB.prepare(`SELECT id FROM users WHERE is_active = 1 AND role IN ('ceo', 'coo', 'cco') AND id != ?1`).bind(except).all<{ id: number }>()).results ?? [];
  return rows.map((r) => r.id);
}

export async function handleLiveReports(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams, request: Request): Promise<Response | null> {
  if (path !== "/live-reports" && !path.startsWith("/live-reports/")) return null;
  const reviewer = canUser(user, "live_report_review");
  try {
    /* ---------------- the list: the host's own, or every report for a reviewer ---------------- */
    if (path === "/live-reports" && method === "GET") {
      const mine = params.get("mine") === "1" || !reviewer;
      const reports = (await env.DB.prepare(
        `SELECT r.*, s.session_date, s.start_time, s.end_time, s.platform, s.client_name,
                COALESCE(NULLIF(TRIM(h.full_name), ''), h.name) AS host_name,
                v.gmv_cents, v.duration_min, v.highlights, v.blockers, v.next_actions, v.submitted_at,
                (SELECT COUNT(*) FROM live_report_files f WHERE f.report_id = r.id AND (f.version = r.current_version OR (f.version IS NULL AND r.state IN ('draft', 'returned')))) AS file_count
           FROM live_reports r JOIN live_sessions s ON s.id = r.session_id JOIN users h ON h.id = r.host_user_id
           LEFT JOIN live_report_versions v ON v.report_id = r.id AND v.version = r.current_version
          ${mine ? "WHERE r.host_user_id = ?1" : "WHERE ?1 = ?1"}
          ORDER BY s.session_date DESC, s.start_time DESC LIMIT 200`,
      ).bind(user.id).all()).results ?? [];
      /* the host's lives with no report yet: the last 30 days up to today (L2: only sessions on the roster) */
      const open = (await env.DB.prepare(
        `SELECT s.id, s.session_date, s.start_time, s.end_time, s.platform, s.client_name, s.status
           FROM live_sessions s
          WHERE s.host_user_id = ?1 AND s.status != 'cancelled' AND s.session_date <= ?2 AND s.session_date >= date(?2, '-30 days')
            AND NOT EXISTS (SELECT 1 FROM live_reports r WHERE r.session_id = s.id)
          ORDER BY s.session_date DESC, s.start_time DESC LIMIT 30`,
      ).bind(user.id, mytToday()).all()).results ?? [];
      return json({ reports, sessions_to_report: open, can_review: reviewer, me: user.id });
    }

    /* ---------------- one report: its versions, screenshots and review trail ---------------- */
    const one = /^\/live-reports\/(\d+)$/.exec(path);
    if (one && method === "GET") {
      const r = await reportOf(env, Number(one[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (r.host_user_id !== user.id && !reviewer) return err("forbidden", "Not your report", 403);
      const s = await sessionOf(env, r.session_id);
      const versions = (await env.DB.prepare(`SELECT v.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS by_name FROM live_report_versions v LEFT JOIN users u ON u.id = v.submitted_by WHERE v.report_id = ?1 ORDER BY v.version DESC`).bind(r.id).all()).results ?? [];
      const files = (await env.DB.prepare(`SELECT id, version, file_name, content_type, size_bytes, created_at FROM live_report_files WHERE report_id = ?1 ORDER BY id`).bind(r.id).all()).results ?? [];
      const reviews = (await env.DB.prepare(`SELECT w.id, w.version, w.action, w.note, w.actor_role, w.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS by_name FROM live_report_reviews w LEFT JOIN users u ON u.id = w.actor_id WHERE w.report_id = ?1 ORDER BY w.id DESC`).bind(r.id).all()).results ?? [];
      const host = await env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS name FROM users WHERE id = ?1`).bind(r.host_user_id).first<{ name: string }>();
      return json({
        report: r, session: s, host: host?.name ?? null, versions, files, reviews,
        can: { edit: r.host_user_id === user.id && ["draft", "returned"].includes(r.state), review: reviewer && r.host_user_id !== user.id },
      });
    }

    /* ---------------- the host starts the report of one of their sessions (L2) ---------------- */
    if (path === "/live-reports" && method === "POST") {
      const sid = Number(body?.session_id);
      if (!Number.isInteger(sid) || sid <= 0) return err("invalid_input", "Choose the live session on the roster", 400);
      const s = await sessionOf(env, sid);
      if (!s) return err("not_found", "That live session is not on the roster", 404);
      if (s.host_user_id !== user.id) return err("forbidden", "Only the host of this live reports it", 403);
      if (s.status === "cancelled") return err("invalid_state", "This live was cancelled", 409);
      if (s.session_date > mytToday()) return err("invalid_state", "This live has not happened yet", 409);
      const had = await env.DB.prepare(`SELECT id FROM live_reports WHERE session_id = ?1`).bind(sid).first<{ id: number }>();
      if (had) return json({ id: had.id, existing: true });
      const row = await env.DB.prepare(`INSERT INTO live_reports (session_id, host_user_id) VALUES (?1, ?2) RETURNING id`).bind(sid, user.id).first<{ id: number }>();
      await audit(env, user.id, "live_report.start", "live_reports", String(row?.id), { session_id: sid });
      return json({ id: row?.id }, 201);
    }

    /* ---------------- the host keeps a draft ---------------- */
    const dr = /^\/live-reports\/(\d+)\/draft$/.exec(path);
    if (dr && method === "PUT") {
      const r = await reportOf(env, Number(dr[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (r.host_user_id !== user.id) return err("forbidden", "Only the host edits this report", 403);
      if (!["draft", "returned"].includes(r.state)) return err("invalid_state", `This report is ${r.state} - it is kept as submitted`, 409);
      const gmv = body?.gmv == null || body.gmv === "" ? null : Math.round(Number(body.gmv) * 100);
      if (gmv !== null && (!Number.isFinite(gmv) || gmv < 0 || gmv > 100_000_000_00)) return err("invalid_input", "GMV is an amount in RM, zero or more", 400);
      const dur = body?.duration_min == null || body.duration_min === "" ? null : Math.round(Number(body.duration_min));
      if (dur !== null && (!Number.isFinite(dur) || dur < 0 || dur > 24 * 60)) return err("invalid_input", "The duration is in minutes, up to 24 hours", 400);
      const company = body?.company == null || body.company === "" ? null : String(body.company);
      if (company !== null && !["a2z", "azoo"].includes(company)) return err("invalid_input", "The company is A2Z Creative Marketing or AZ ONE Official", 400);
      await env.DB.prepare(
        `UPDATE live_reports SET draft_gmv_cents = ?1, draft_duration_min = ?2, draft_highlights = ?3, draft_blockers = ?4, draft_next_actions = ?5, company = ?6, updated_at = datetime('now') WHERE id = ?7`,
      ).bind(gmv, dur, text(body?.highlights, 2000), text(body?.blockers, 2000), text(body?.next_actions, 2000), company, r.id).run();
      return json({ ok: true });
    }

    /* ---------------- the host attaches a GMV screenshot ---------------- */
    const up = /^\/live-reports\/(\d+)\/files$/.exec(path);
    if (up && method === "POST") {
      const r = await reportOf(env, Number(up[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (r.host_user_id !== user.id) return err("forbidden", "Only the host attaches the screenshots", 403);
      if (!["draft", "returned"].includes(r.state)) return err("invalid_state", `This report is ${r.state} - its screenshots are kept as submitted`, 409);
      const ct = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
      if (!IMAGE_TYPES.includes(ct)) return err("invalid_input", "A screenshot is a JPEG, PNG or WebP image", 400);
      if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return err("too_large", "A screenshot is at most 8 MB", 413);
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_report_files WHERE report_id = ?1 AND version IS NULL`).bind(r.id).first<{ n: number }>();
      if (Number(n?.n ?? 0) >= MAX_FILES) return err("too_many", `Up to ${MAX_FILES} screenshots a submission`, 409);
      if (!request.body) return err("invalid_input", "The screenshot is required", 400);
      const key = `live-reports/${r.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rejected = await putGuarded(env.MEDIA, key, request, { max: MAX_BYTES, contentType: ct });
      if (rejected) return rejected;
      const name = (request.headers.get("x-file-name") ?? "").replace(/[^\w.\- ]+/g, "").slice(0, 120) || null;
      const size = Number(request.headers.get("content-length") ?? 0) || null;
      const row = await env.DB.prepare(`INSERT INTO live_report_files (report_id, version, r2_key, file_name, content_type, size_bytes, uploaded_by) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6) RETURNING id`)
        .bind(r.id, key, name, ct, size, user.id).first<{ id: number }>();
      await audit(env, user.id, "live_report.file", "live_reports", String(r.id), { file_id: row?.id });
      return json({ id: row?.id }, 201);
    }

    /* ---------------- a screenshot, to the host and the reviewers only ---------------- */
    const fl = /^\/live-reports\/(\d+)\/files\/(\d+)$/.exec(path);
    if (fl && method === "GET") {
      const r = await reportOf(env, Number(fl[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (r.host_user_id !== user.id && !reviewer) return err("forbidden", "Not your report", 403);
      const f = await env.DB.prepare(`SELECT r2_key, content_type FROM live_report_files WHERE id = ?1 AND report_id = ?2`).bind(Number(fl[2]), r.id).first<{ r2_key: string; content_type: string }>();
      if (!f) return err("not_found", "Screenshot not found", 404);
      const obj = await env.MEDIA.get(f.r2_key);
      if (!obj) return err("not_found", "Screenshot not found", 404);
      return new Response(obj.body, { headers: { "Content-Type": f.content_type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
    }

    /* ---------------- the host submits: the figures freeze as a new version ---------------- */
    const sb = /^\/live-reports\/(\d+)\/submit$/.exec(path);
    if (sb && method === "POST") {
      const r = await reportOf(env, Number(sb[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (r.host_user_id !== user.id) return err("forbidden", "Only the host submits this report", 403);
      if (!["draft", "returned"].includes(r.state)) return err("invalid_state", `This report is already ${r.state}`, 409);
      if (r.draft_gmv_cents == null) return err("invalid_input", "Enter the GMV reported (RM) first", 400);
      if (!r.company) return err("invalid_input", "Choose the company the live was for", 400);
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_report_files WHERE report_id = ?1 AND version IS NULL`).bind(r.id).first<{ n: number }>();
      if (!Number(n?.n ?? 0)) return err("evidence_required", "Attach at least one screenshot of the GMV", 400);
      const v = r.current_version + 1;
      await env.DB.batch([
        env.DB.prepare(`UPDATE live_reports SET state = 'submitted', current_version = ?1, updated_at = datetime('now') WHERE id = ?2 AND current_version = ?3 AND state IN ('draft', 'returned')`).bind(v, r.id, r.current_version),
        env.DB.prepare(`INSERT INTO live_report_versions (report_id, version, company, gmv_cents, duration_min, highlights, blockers, next_actions, submitted_by)
                        SELECT id, ?1, company, draft_gmv_cents, draft_duration_min, draft_highlights, draft_blockers, draft_next_actions, ?2 FROM live_reports WHERE id = ?3 AND current_version = ?1`).bind(v, user.id, r.id),
        env.DB.prepare(`UPDATE live_report_files SET version = ?1 WHERE report_id = ?2 AND version IS NULL AND EXISTS (SELECT 1 FROM live_reports WHERE id = ?2 AND current_version = ?1)`).bind(v, r.id),
      ]);
      /* the batch is one transaction; whether it was this request that moved it is read back */
      const now = await env.DB.prepare(`SELECT state, current_version FROM live_reports WHERE id = ?1`).bind(r.id).first<{ state: string; current_version: number }>();
      const mine = await env.DB.prepare(`SELECT submitted_by FROM live_report_versions WHERE report_id = ?1 AND version = ?2`).bind(r.id, v).first<{ submitted_by: number }>();
      if (now?.state !== "submitted" || now.current_version !== v || mine?.submitted_by !== user.id) return err("conflict", "It changed while you were submitting it - reload", 409);
      await audit(env, user.id, "live_report.submit", "live_reports", String(r.id), { version: v, gmv_cents: r.draft_gmv_cents });
      for (const id of await reviewers(env, user.id)) {
        try { await notify(env, id, "task", `📺 Live Host Report to review: ${user.name} (v${v})`, `live_report:${r.id}:v${v}`, { once: true }); } catch { /* a bell never blocks the work */ }
      }
      return json({ ok: true, state: "submitted", version: v });
    }

    /* ---------------- management: review, accept, return, reopen (L3: never their own) ---------------- */
    const rv = /^\/live-reports\/(\d+)\/review$/.exec(path);
    if (rv && method === "POST") {
      if (!reviewer) return err("forbidden", "Only the CEO, COO or CCO reviews a Live Host Report", 403);
      const r = await reportOf(env, Number(rv[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (r.host_user_id === user.id) return err("self_approval", "A report is never reviewed by its own host", 403);
      const action = String(body?.action ?? "");
      const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : "";
      const MOVE: Record<string, { from: string[]; to: string; need: number }> = {
        review: { from: ["submitted"], to: "reviewed", need: 0 },
        accept: { from: ["submitted", "reviewed"], to: "accepted", need: 0 },
        return: { from: ["submitted", "reviewed"], to: "returned", need: 10 },
        reopen: { from: ["accepted"], to: "returned", need: 10 },
      };
      const m = MOVE[action];
      if (!m) return err("invalid_input", "The action is review, accept, return or reopen", 400);
      if (!m.from.includes(r.state)) return err("invalid_state", `A ${r.state} report cannot be ${action === "return" ? "returned" : action === "reopen" ? "reopened" : `${action}ed`}`, 409);
      if (note.length < m.need) return err("invalid_input", action === "return" ? "Say what to correct (at least 10 characters)" : "Say why it is reopened (at least 10 characters)", 400);
      const seen = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_report_reviews WHERE report_id = ?1`).bind(r.id).first<{ n: number }>())?.n ?? 0);
      await env.DB.batch([
        env.DB.prepare(`UPDATE live_reports SET state = ?1, updated_at = datetime('now') WHERE id = ?2 AND state = ?3`).bind(m.to, r.id, r.state),
        env.DB.prepare(`INSERT INTO live_report_reviews (report_id, version, action, note, actor_id, actor_role) SELECT id, current_version, ?1, ?2, ?3, ?4 FROM live_reports WHERE id = ?5 AND state = ?6`).bind(action, note || null, user.id, user.role, r.id, m.to),
      ]);
      const done = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_report_reviews WHERE report_id = ?1`).bind(r.id).first<{ n: number }>())?.n ?? 0);
      if (done !== seen + 1) return err("conflict", "It changed while you were reviewing it - reload", 409);
      await audit(env, user.id, `live_report.${action}`, "live_reports", String(r.id), { version: r.current_version, ...(note ? { note } : {}) });
      const word = action === "accept" ? "accepted" : action === "review" ? "reviewed" : "returned for correction";
      try { await notify(env, r.host_user_id, "task", `📺 Your Live Host Report was ${word}${note ? `: ${note.slice(0, 80)}` : ""}`, `live_report:${r.id}:${action}:${r.current_version}`, { once: true }); } catch { /* a bell never blocks the work */ }
      return json({ ok: true, state: m.to });
    }
    return null;
  } catch (e) {
    const p = pending(e);
    if (p) return p;
    throw e;
  }
}

/* v1.395.0 - DIGITAL CARD REVIEW AND PUBLISHING (Digital Cards Stage 6, the CEO 21-11-2026; migration 0225).
 *
 * The CEO's chain: the designer submits -> the COO or CCO pre-checks -> the CEO or the super admin
 * publishes. Nobody pre-checks or publishes their own design.
 *
 *   POST /card-templates/:id/submit      designer, a finished draft or returned template, at its version:
 *                                        the design is FROZEN as card_template_versions (manifest +
 *                                        content_hash) - what is reviewed is exactly what is published
 *   POST /card-templates/:id/precheck    card_template_precheck: {decision: pass | return, note}
 *   POST /card-templates/:id/publish     card_template_publish, only after a pre-check: {decision: publish | return, note}
 *                                        publish writes one card_template_sync row for AZ ONE to read
 *   POST /card-templates/:id/unpublish   card_template_publish, a live template, reason: a tombstone row
 *   POST /card-templates/:id/revise      the designer opens a published or unpublished template again as
 *                                        a draft - the live version stays on AZ ONE until the next publish
 *   POST /card-templates/:id/sync/:s/retry  card_template_publish: a failed sync row is repeated as a NEW row
 *
 * The portal shows what AZ ONE reported, never a guess: pending until the feed is read, sent once read,
 * imported / failed only from AZ ONE's own report (card-bridge.ts).
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify } from "./staff";
import { canUser, rolesFor } from "./permissions";
import { audit, err, json } from "./shared";
import { loadCardRules } from "./card-rules";
import { SELECT, changed, claim, detail, event, invalid, pageRows, zoneOf, zoneRows, type Row } from "./card-templates";
import { EDITABLE_STATES, pagesReady, specsKey, zonesReady } from "../../lib/card-templates";
import { pageFileProblems } from "../../lib/card-image";

export const NOTE_MIN = 10;
const sha256Hex = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** the people who hold a capability now (saved cells included), except one */
async function holders(env: Env, cap: Parameters<typeof rolesFor>[0], except: number): Promise<number[]> {
  const roles = rolesFor(cap) as readonly string[];
  return ((await env.DB.prepare(`SELECT id, role FROM users WHERE is_active = 1`).all<{ id: number; role: string }>()).results ?? [])
    .filter((u) => roles.includes(u.role) && u.id !== except).map((u) => u.id);
}

/** the version AZ ONE should have now: the last sync row decides (a publish, or an unpublish) */
export async function liveOf(env: Env, templateId: number): Promise<number | null> {
  const r = await env.DB.prepare(`SELECT action, version_no FROM card_template_sync WHERE template_id = ?1 ORDER BY id DESC LIMIT 1`).bind(templateId).first<{ action: string; version_no: number }>();
  return r && r.action === "publish" ? r.version_no : null;
}

/** what the reviewers and the designer see in the template drawer, and what each may do */
export async function reviewInfo(env: Env, t: Row & { review_version_no?: number | null; prechecked_by?: number | null; prechecked_at?: string | null }, user: StaffUser) {
  const [versions, sync, pre, ret, live] = await Promise.all([
    env.DB.prepare(`SELECT v.version_no, v.content_hash, v.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS by_name FROM card_template_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.template_id = ?1 ORDER BY v.version_no DESC LIMIT 20`).bind(t.id).all<{ version_no: number; content_hash: string; created_at: string; by_name: string | null }>(),
    env.DB.prepare(`SELECT id, version_no, action, status, attempts, last_error, retry_of, created_at, sent_at, acked_at FROM card_template_sync WHERE template_id = ?1 ORDER BY id DESC LIMIT 20`).bind(t.id).all<{ id: number; version_no: number; action: string; status: string; attempts: number; last_error: string | null; retry_of: number | null; created_at: string; sent_at: string | null; acked_at: string | null }>(),
    t.prechecked_by ? env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS name FROM users WHERE id = ?1`).bind(t.prechecked_by).first<{ name: string }>() : Promise.resolve(null),
    env.DB.prepare(`SELECT note, created_at FROM card_template_events WHERE template_id = ?1 AND kind = 'returned' ORDER BY id DESC LIMIT 1`).bind(t.id).first<{ note: string | null; created_at: string }>(),
    liveOf(env, t.id),
  ]);
  const own = t.designer_id === user.id;
  const inReview = t.state === "in_review";
  const rows = sync.results ?? [];
  /* a failed row is retried once: a newer row for the same version and action replaces it */
  const retried = new Set(rows.filter((r) => r.retry_of).map((r) => r.retry_of));
  return {
    version_no: t.review_version_no ?? null, prechecked_by: pre?.name ?? null, prechecked_at: t.prechecked_at ?? null,
    returned: t.state === "returned" && ret ? { note: ret.note, at: ret.created_at } : null,
    live_version: live, versions: versions.results ?? [], sync: rows,
    bridge_configured: Boolean((env as { CARD_BRIDGE_KEY?: string }).CARD_BRIDGE_KEY),
    can: {
      submit: own && canUser(user, "card_template_manage") && (EDITABLE_STATES as readonly string[]).includes(t.state),
      precheck: !own && inReview && !t.prechecked_by && canUser(user, "card_template_precheck"),
      publish: !own && inReview && Boolean(t.prechecked_by) && canUser(user, "card_template_publish"),
      unpublish: live != null && canUser(user, "card_template_publish"),
      revise: own && canUser(user, "card_template_manage") && (t.state === "published" || t.state === "unpublished"),
      retry: canUser(user, "card_template_publish") ? rows.filter((r) => r.status === "failed" && !retried.has(r.id)).map((r) => r.id) : [],
    },
  };
}

export async function handleCardReview(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser): Promise<Response | null> {
  const m = path.match(/^\/card-templates\/(\d+)\/(submit|precheck|publish|unpublish|revise)$/) ?? path.match(/^\/card-templates\/(\d+)\/sync\/(\d+)\/retry$/);
  if (!m || method !== "POST") return null;
  const id = Number(m[1]);
  const t = await env.DB.prepare(`${SELECT} WHERE t.id = ?1`).bind(id).first<Row & { review_version_no: number | null; prechecked_by: number | null }>();
  if (!t || (t.state === "archived" && t.designer_id !== user.id)) return err("not_found", "That template does not exist", 404);
  const isRetry = /\/retry$/.test(path);
  const action = isRetry ? "retry" : m[2]!;
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version !== t.version) return changed();
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  const own = t.designer_id === user.id;
  const me = user.name;

  if (action === "submit") {
    if (!own || !canUser(user, "card_template_manage")) return err("forbidden", "Only the designer of this template sends it for review", 403);
    if (!(EDITABLE_STATES as readonly string[]).includes(t.state)) return err("locked", "Only a draft or a returned template can be sent for review", 409);
    const rules = await loadCardRules(env);
    const format = rules.formats.find((f) => f.id === t.format_id), category = rules.categories.find((c) => c.id === t.category_id);
    if (!format || !category || !format.active || !category.active) return err("rules_off", "The format or category of this template is switched off", 409);
    const [pages, zones] = await Promise.all([pageRows(env, id), zoneRows(env, id).then((z) => z.map(zoneOf))]);
    const missing = [
      ...(t.specs_key !== specsKey(format, category) ? ["Confirm the design specs"] : []),
      ...pagesReady(pages.map((p) => ({ title: p.title, has_file: Boolean(p.r2_key), problems: p.r2_key ? pageFileProblems({ mime: (p.mime ?? "image/png") as "image/png", width: p.width_px ?? 0, height: p.height_px ?? 0, components: 3 }, p.bytes ?? 0, format) : [] })), category),
      ...zonesReady(zones, format),
    ];
    if (missing.length) return json({ error: { code: "not_ready", message: `Not ready to send: ${missing[0]}`, missing } }, 409);
    /* THE FROZEN DESIGN: everything AZ ONE needs, in a fixed order, and the SHA-256 of it */
    const position = new Map(pages.map((p) => [p.id, p.position]));
    const prev = await env.DB.prepare(`SELECT COALESCE(MAX(version_no), 0) AS n FROM card_template_versions WHERE template_id = ?1`).bind(id).first<{ n: number }>();
    const versionNo = (prev?.n ?? 0) + 1;
    const manifest = {
      schema: 1, code: t.code, version: versionNo, name: t.name, description: t.description, language: t.language,
      packages: (() => { try { return JSON.parse(t.packages); } catch { return []; } })(),
      category: { code: category.code, name: category.name, name_ms: category.name_ms },
      format: { code: format.code, width: format.width_px, height: format.height_px, margins: { top: format.margin_top, right: format.margin_right, bottom: format.margin_bottom, left: format.margin_left } },
      pages: pages.map((p) => ({ position: p.position, title: p.title, title_ms: p.title_ms, required: Boolean(p.required), sha256: p.sha256, mime: p.mime, width: p.width_px, height: p.height_px, bytes: p.bytes })),
      zones: zones.map((z) => ({ key: z.key, page: position.get(z.page_id), kind: z.kind, label: z.label, label_ms: z.label_ms, x: z.x, y: z.y, w: z.w, h: z.h, font: z.font, weight: z.weight, size: z.size, colour: z.colour, align: z.align, max_chars: z.max_chars, required: z.required, sample: z.sample, sample_ms: z.sample_ms })),
    };
    const text = JSON.stringify(manifest);
    const hash = await sha256Hex(text);
    if (!(await claim(env, t, user, `state = 'in_review', review_version_no = ?5, prechecked_by = NULL, prechecked_at = NULL`, [versionNo]))) return changed();
    await env.DB.prepare(`INSERT INTO card_template_versions (template_id, version_no, manifest_json, content_hash, created_by) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(id, versionNo, JSON.stringify({ manifest, files: pages.map((p) => p.r2_key) }), hash, user.id).run();
    await event(env, t, user, "submitted", note || null, { version_no: versionNo, content_hash: hash });
    await audit(env, user.id, "card_template.submit", "card_templates", String(id), { code: t.code, version_no: versionNo, content_hash: hash });
    for (const uid of await holders(env, "card_template_precheck", user.id))
      await notify(env, uid, "card_template", `${me} sent the card template "${t.name}" (v${versionNo}) for your pre-check - open Digital Cards -> Pending Review`, `card_template:${id}:submit:${versionNo}`, { once: true });
    return await detail(env, id, user);
  }

  if (action === "precheck" || action === "publish") {
    const cap = action === "precheck" ? "card_template_precheck" : "card_template_publish";
    if (!canUser(user, cap)) return err("forbidden", action === "precheck" ? "Only the COO or the CCO pre-checks a template" : "Only the CEO or the super admin publishes a template", 403);
    if (own) return err("self_review", "Someone else reviews your own design", 403);
    if (t.state !== "in_review") return err("locked", "This template is not waiting for review", 409);
    if (action === "precheck" && t.prechecked_by) return err("already", "This template is already pre-checked", 409);
    if (action === "publish" && !t.prechecked_by) return err("precheck_needed", "The COO or the CCO pre-checks a template before it is published", 409);
    const decision = String(body?.decision ?? "");
    const vno = t.review_version_no!;
    if (decision === "return") {
      if (note.length < NOTE_MIN) return invalid({ note: `Say what to change, in at least ${NOTE_MIN} characters` });
      if (!(await claim(env, t, user, `state = 'returned', prechecked_by = NULL, prechecked_at = NULL`))) return changed();
      await event(env, t, user, "returned", note, { version_no: vno, by_step: action });
      await audit(env, user.id, "card_template.return", "card_templates", String(id), { code: t.code, version_no: vno, step: action, note });
      await notify(env, t.designer_id, "card_template", `${me} returned your card template "${t.name}": ${note}`, `card_template:${id}:ret:${vno}:${t.version}`, { once: true });
      return await detail(env, id, user);
    }
    if (action === "precheck" && decision === "pass") {
      if (!(await claim(env, t, user, `prechecked_by = ?5, prechecked_at = datetime('now')`, [user.id]))) return changed();
      await event(env, t, user, "prechecked", note || null, { version_no: vno });
      await audit(env, user.id, "card_template.precheck", "card_templates", String(id), { code: t.code, version_no: vno });
      for (const uid of await holders(env, "card_template_publish", t.designer_id))
        await notify(env, uid, "card_template", `${me} pre-checked the card template "${t.name}" (v${vno}) - it waits for you to publish it`, `card_template:${id}:pre:${vno}`, { once: true });
      return await detail(env, id, user);
    }
    if (action === "publish" && decision === "publish") {
      const ver = await env.DB.prepare(`SELECT content_hash FROM card_template_versions WHERE template_id = ?1 AND version_no = ?2`).bind(id, vno).first<{ content_hash: string }>();
      if (!ver) return err("version_missing", "The submitted version is missing", 409);
      if (!(await claim(env, t, user, `state = 'published', published_version = ?5`, [vno]))) return changed();
      await env.DB.prepare(`INSERT INTO card_template_sync (template_id, code, version_no, action, content_hash, created_by) VALUES (?1, ?2, ?3, 'publish', ?4, ?5)`)
        .bind(id, t.code, vno, ver.content_hash, user.id).run();
      await event(env, t, user, "published", note || null, { version_no: vno, content_hash: ver.content_hash });
      await audit(env, user.id, "card_template.publish", "card_templates", String(id), { code: t.code, version_no: vno, content_hash: ver.content_hash });
      await notify(env, t.designer_id, "card_template", `${me} published your card template "${t.name}" (v${vno}) - it goes to AZ ONE next`, `card_template:${id}:pub:${vno}`, { once: true });
      return await detail(env, id, user);
    }
    return invalid({ decision: action === "precheck" ? "Choose pass or return" : "Choose publish or return" });
  }

  if (action === "unpublish") {
    if (!canUser(user, "card_template_publish")) return err("forbidden", "Only the CEO or the super admin unpublishes a template", 403);
    const live = await liveOf(env, id);
    if (live == null) return err("not_live", "This template is not on AZ ONE", 409);
    if (note.length < NOTE_MIN) return invalid({ note: `Say why, in at least ${NOTE_MIN} characters` });
    if (!(await claim(env, t, user, t.state === "published" ? `state = 'unpublished'` : ""))) return changed();
    await env.DB.prepare(`INSERT INTO card_template_sync (template_id, code, version_no, action, created_by) VALUES (?1, ?2, ?3, 'unpublish', ?4)`).bind(id, t.code, live, user.id).run();
    await event(env, t, user, "unpublished", note, { version_no: live });
    await audit(env, user.id, "card_template.unpublish", "card_templates", String(id), { code: t.code, version_no: live, reason: note });
    if (!own) await notify(env, t.designer_id, "card_template", `${me} took the card template "${t.name}" off AZ ONE: ${note}`, `card_template:${id}:unpub:${t.version}`, { once: true });
    return await detail(env, id, user);
  }

  if (action === "revise") {
    if (!own || !canUser(user, "card_template_manage")) return err("forbidden", "Only the designer of this template opens it again", 403);
    if (t.state !== "published" && t.state !== "unpublished") return err("locked", "Only a published or unpublished template is opened again", 409);
    if (!(await claim(env, t, user, `state = 'draft', review_version_no = NULL, prechecked_by = NULL, prechecked_at = NULL`))) return changed();
    await event(env, t, user, "revised", null, { live_version: await liveOf(env, id) });
    await audit(env, user.id, "card_template.revise", "card_templates", String(id), { code: t.code });
    return await detail(env, id, user);
  }

  /* retry: a failed row is repeated as a new row, so AZ ONE's cursor reaches it again */
  if (!canUser(user, "card_template_publish")) return err("forbidden", "Only the CEO or the super admin resends a template", 403);
  const row = await env.DB.prepare(`SELECT * FROM card_template_sync WHERE id = ?1 AND template_id = ?2`).bind(Number(m[2]), id)
    .first<{ id: number; code: string; version_no: number; action: string; content_hash: string | null; status: string }>();
  if (!row) return err("not_found", "That sync record does not exist", 404);
  if (row.status !== "failed") return err("not_failed", "Only a failed sync is sent again", 409);
  const again = await env.DB.prepare(`SELECT id FROM card_template_sync WHERE retry_of = ?1`).bind(row.id).first();
  if (again) return err("already", "This sync was already sent again", 409);
  if (!(await claim(env, t, user))) return changed();
  await env.DB.prepare(`INSERT INTO card_template_sync (template_id, code, version_no, action, content_hash, retry_of, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(id, row.code, row.version_no, row.action, row.content_hash, row.id, user.id).run();
  await audit(env, user.id, "card_template.sync_retry", "card_templates", String(id), { code: t.code, sync_id: row.id });
  return await detail(env, id, user);
}

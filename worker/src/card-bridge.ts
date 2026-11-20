/* v1.395.0 - THE AZ ONE CARD FEED (Digital Cards Stage 6, the CEO 21-11-2026; migration 0225).
 *
 * azoneofficial.com (AZ ONE OFFICIAL, the seller) PULLS published templates from A2Z OS - A2Z OS never
 * reaches into AZ ONE. Every request is signed (lib/card-bridge-sign.ts, CARD_BRIDGE_KEY on both
 * Workers); without the key the feed answers 501 and nothing leaves.
 *
 *   GET  /api/v1/bridge/card-templates?since=<cursor>      the publish / unpublish records after the
 *        cursor, oldest first, 20 at a time; a publish carries the frozen manifest and its file
 *        addresses. Reading marks a pending record "sent" - never "imported".
 *   GET  /api/v1/bridge/card-templates/<code>/<version>/page/<n>   the artwork of a page of a version
 *        that was published, byte for byte (AZ ONE copies it into its own storage)
 *   POST /api/v1/bridge/card-templates/ack   {id, status: imported | failed, content_hash, error?}
 *        AZ ONE's report. An import must name the record's own content_hash; a repeat changes nothing.
 *
 * Least exposure: only what a storefront needs to draw a card - no staff, no designer, no prices,
 * no storage keys, no session.
 */
import type { Env } from "./index";
import { err, json } from "./shared";
import { cardVerify } from "../../lib/card-bridge-sign";

const FEED = "/api/v1/bridge/card-templates";
interface SyncRow { id: number; template_id: number; code: string; version_no: number; action: string; content_hash: string | null; status: string }

export async function handleCardBridge(request: Request, env: Env & { CARD_BRIDGE_KEY?: string }, path: string, method: string): Promise<Response | null> {
  if (path !== FEED && !path.startsWith(`${FEED}/`)) return null;
  if (!env.CARD_BRIDGE_KEY) return err("not_configured", "The AZ ONE card feed is not switched on", 501);
  const url = new URL(request.url);
  const body = method === "POST" ? await request.text() : "";
  const v = await cardVerify(env.CARD_BRIDGE_KEY, { timestamp: request.headers.get("X-Card-Timestamp"), signature: request.headers.get("X-Card-Signature") }, method, url.pathname + url.search, body);
  if (v !== "ok") return err("unauthorized", v === "stale" ? "The request is too old or too new" : "The request is not signed by AZ ONE", 401);
  try {
    if (path === FEED && method === "GET") {
      const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
      const { results } = await env.DB.prepare(`SELECT id, template_id, code, version_no, action, content_hash, status FROM card_template_sync WHERE id > ?1 ORDER BY id LIMIT 21`).bind(since).all<SyncRow>();
      const rows = (results ?? []).slice(0, 20);
      const items = [];
      for (const r of rows) {
        if (r.action === "publish") {
          const ver = await env.DB.prepare(`SELECT manifest_json FROM card_template_versions WHERE template_id = ?1 AND version_no = ?2`).bind(r.template_id, r.version_no).first<{ manifest_json: string }>();
          const manifest = ver ? (JSON.parse(ver.manifest_json) as { manifest: { pages: { position: number }[] } }).manifest : null;
          items.push({ id: r.id, action: "publish", code: r.code, version: r.version_no, content_hash: r.content_hash, manifest,
            files: manifest ? manifest.pages.map((p) => ({ position: p.position, url: `${FEED}/${r.code}/${r.version_no}/page/${p.position}` })) : [] });
        } else items.push({ id: r.id, action: "unpublish", code: r.code, version: r.version_no });
      }
      const pending = rows.filter((r) => r.status === "pending").map((r) => r.id);
      if (pending.length) await env.DB.prepare(`UPDATE card_template_sync SET status = 'sent', sent_at = datetime('now') WHERE status = 'pending' AND id IN (${pending.map((_, i) => `?${i + 1}`).join(", ")})`).bind(...pending).run();
      return json({ items, cursor: rows.length ? rows[rows.length - 1]!.id : since, more: (results ?? []).length > 20 });
    }

    const pg = path.match(/^\/api\/v1\/bridge\/card-templates\/([a-z0-9-]{1,60})\/(\d+)\/page\/(\d+)$/);
    if (pg && method === "GET") {
      const ver = await env.DB.prepare(
        `SELECT v.manifest_json FROM card_template_versions v JOIN card_templates t ON t.id = v.template_id
          WHERE t.code = ?1 AND v.version_no = ?2
            AND EXISTS (SELECT 1 FROM card_template_sync s WHERE s.template_id = t.id AND s.version_no = v.version_no AND s.action = 'publish')`,
      ).bind(pg[1], Number(pg[2])).first<{ manifest_json: string }>();
      if (!ver) return err("not_found", "No published version", 404);
      const m = JSON.parse(ver.manifest_json) as { manifest: { pages: { position: number; mime: string; sha256: string }[] }; files: string[] };
      const i = m.manifest.pages.findIndex((p) => p.position === Number(pg[3]));
      const key = i >= 0 ? m.files[i] : null;
      const obj = key ? await env.MEDIA.get(key) : null;
      if (!obj) return err("not_found", "No such page", 404);
      return new Response(obj.body, { headers: { "Content-Type": m.manifest.pages[i]!.mime, "X-Content-SHA256": m.manifest.pages[i]!.sha256, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
    }

    if (path === `${FEED}/ack` && method === "POST") {
      let b: { id?: unknown; status?: unknown; content_hash?: unknown; error?: unknown };
      try { b = JSON.parse(body || "{}"); } catch { return err("invalid_input", "Send JSON", 400); }
      const row = await env.DB.prepare(`SELECT id, template_id, code, version_no, action, content_hash, status FROM card_template_sync WHERE id = ?1`).bind(Number(b.id)).first<SyncRow>();
      if (!row) return err("not_found", "No such sync record", 404);
      const status = b.status === "imported" || b.status === "failed" ? b.status : null;
      if (!status) return err("invalid_input", "status is imported or failed", 400);
      if (row.status === "imported") return json({ ok: true, already: true, status: "imported" });
      if (status === "imported") {
        if (row.action === "publish" && b.content_hash !== row.content_hash) {
          await env.DB.prepare(`UPDATE card_template_sync SET status = 'failed', attempts = attempts + 1, last_error = ?2 WHERE id = ?1 AND status != 'imported'`).bind(row.id, "AZ ONE reported a different content hash").run();
          return err("hash_mismatch", "The content hash does not match this version", 409);
        }
        await env.DB.prepare(`UPDATE card_template_sync SET status = 'imported', acked_at = datetime('now') WHERE id = ?1 AND status != 'imported'`).bind(row.id).run();
        return json({ ok: true, status: "imported" });
      }
      const why = typeof b.error === "string" ? b.error.slice(0, 300) : "AZ ONE could not import it";
      await env.DB.prepare(`UPDATE card_template_sync SET status = 'failed', attempts = attempts + 1, last_error = ?2 WHERE id = ?1 AND status != 'imported'`).bind(row.id, why).run();
      return json({ ok: true, status: "failed" });
    }
  } catch (e) {
    if (/no such table|no such column/i.test(String((e as Error)?.message ?? e))) return err("migration_needed", "Database update 0225 is not applied", 503);
    throw e;
  }
  return err("not_found", "Not found", 404);
}

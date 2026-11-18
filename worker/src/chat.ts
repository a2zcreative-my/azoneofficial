/* v1.364.0 - INTERNAL STAFF CHAT, MESSAGES EXPIRE 12 HOURS AFTER SENDING
   (the CEO, 18-11-2026; audit docs/STAFF-CHAT-STAGE-0-AUDIT.md, decisions there).

   WHERE THINGS LIVE
   - Who may chat is decided by the Worker on EVERY HTTP call and every socket
     connect, from the existing session and staff record (chatEligible):
     signed in, a staff role (never customer or agent), active, on staff today
     (currentStaffSql - a leaver keeps is_active for the final payroll), 2FA
     done, and the matrix capability chat_use.
   - Every message, membership and file record lives in ONE Durable Object
     (ChatHub, SQLite storage). NOTHING of chat is written to D1: no content,
     no preview, no who-to-whom. The D1 nightly export and the notifications
     table therefore never hold a chat message.
   - Files go to the private R2 bucket CHAT_FILES (a2z-chat-temp), never
     MEDIA: MEDIA is copied to BACKUPS within 30 minutes and kept 90 days.

   THE 12-HOUR RULE
   - created_at and expires_at = created_at + 12 h are set here, by the
     server, once. Nothing ever moves expires_at (not reading, not delivery).
   - EVERY read filters expires_at > now, so an expired message cannot be
     read through the API, the socket or a file download from the moment it
     expires - before it is physically deleted.
   - The hub's alarm runs at the next expiry (rounded up to 30 s) and deletes
     the rows and the R2 objects, then tells every open screen. A failed run
     is retried by the alarm and again by the 5-minute cron (chatCronSweep),
     which also removes R2 objects that have no record (orphans).

   NOT THE OFFICIAL RECORD: nothing in chat feeds approvals, payments, payroll,
   HR or any other module, and no module reads chat. */
import type { Env } from "./index";
import { allows, can, isOwnKey, needs2fa, setPermissionOverrides } from "./permissions";
import { currentStaffSql, pushToUser } from "./staff";

export const CHAT_TTL_MS = 12 * 60 * 60 * 1000;
export const CHAT_MAX_TEXT = 1500;
export const CHAT_MAX_FILE = 2 * 1024 * 1024;
export const CHAT_MAX_FILES = 3;
export const CHAT_MAX_TOTAL = 5 * 1024 * 1024;
export const CHAT_GROUP_MAX = 8;
/** The message lifetime. 12 hours, always - EXCEPT a local test server, which
    may shorten it to prove deletion without waiting 12 hours: it needs BOTH
    CHAT_TEST_TTL_MS and an allowed origin on 127.0.0.1, so it can never take
    effect on a2zcreative.my (tests/chat.mjs fails if wrangler.toml sets it). */
export function chatTtl(env: Env): number {
  const t = Number((env as unknown as { CHAT_TEST_TTL_MS?: string }).CHAT_TEST_TTL_MS ?? "");
  const local = /^http:\/\/127\.0\.0\.1:\d+$/.test(((env as unknown as { ALLOWED_ORIGINS?: string }).ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN ?? "").split(",")[0]!.trim());
  return local && Number.isFinite(t) && t >= 5000 && t < CHAT_TTL_MS ? t : CHAT_TTL_MS;
}
const PENDING_MS = 15 * 60 * 1000;
const RECHECK_MS = 60 * 1000;
const PUSH_GAP_MS = 2 * 60 * 1000;
const RATE = { msg: [30, 60_000], upload: [20, 600_000] } as const;
export const CHAT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};

export interface ChatUser {
  id: number; name: string; role: string;
  custom_role?: string; is_owner?: boolean; requires_2fa?: boolean;
}

type Json = Record<string, unknown>;
const j = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
const fail = (code: string, message: string, status: number) => j({ error: { code, message } }, status);

/* ------------------------------------------------------------------ */
/* Who may chat                                                        */
/* ------------------------------------------------------------------ */

/** A role that may hold chat: never a customer or an agent, never somebody
    who still owes the company a second factor. Then the matrix row chat_use of
    the person's CODE role - for a custom role, its base role (a custom role
    made before chat existed has no chat cell of its own, and leaving its
    holders out was the CEO's "missing 1 staff", 18-11-2026); an own role
    (Roles v2, no base role) that counts as staff may chat (the SQL already
    keeps out an own role that does not count as staff). */
function chatBlock(u: { role: string }, totpOn: boolean): "role" | "no_2fa" | "off" | null {
  if (u.role === "customer" || u.role === "agent") return "role";
  if (!totpOn && needs2fa(u.role)) return "no_2fa";
  if (isOwnKey(u.role)) return null;
  return can(u.role, "chat_use") ? null : "off";
}
function roleMayChat(u: { role: string }, totpOn: boolean): boolean { return chatBlock(u, totpOn) === null; }

export async function chatEligible(env: Env, user: ChatUser | null): Promise<boolean> {
  if (!user || user.role === "customer" || user.role === "agent" || user.requires_2fa) return false;
  if (!roleMayChat(user, true)) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM users u WHERE u.id = ?1 AND u.is_active = 1 AND ${currentStaffSql("u.")}
        AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)`,
  ).bind(user.id).first<{ ok: number }>();
  return Boolean(row);
}

interface StaffRow { id: number; name: string; role: string; photo_key: string | null; custom_role: string | null; totp: number; here: number; position: string | null }

/** Staff for the people picker and for naming senders. `eligible` is the same
    rule as chatEligible, for each person. Customers and agents never appear, nor
    an own role the owner set as not counting as staff (Roles v2's one switch). */
async function staffRows(env: Env, ids?: number[]): Promise<StaffRow[]> {
  const where = ids ? `AND u.id IN (${ids.map(() => "?").join(",")})` : "";
  const q = (cr: boolean) => env.DB.prepare(
    `SELECT u.id, u.name, u.role, u.photo_key, u.position,
            ${cr ? "(SELECT c.key FROM custom_roles c WHERE c.id = u.custom_role_id AND c.active = 1 AND c.base_role = u.role)" : "NULL"} AS custom_role,
            COALESCE(u.totp_enabled, 0) AS totp,
            CASE WHEN u.is_active = 1 AND ${currentStaffSql("u.")} THEN 1 ELSE 0 END AS here,
            (SELECT value FROM system_meta WHERE key = 'role_permissions') AS perm_meta
       FROM users u
      WHERE u.role NOT IN ('customer', 'agent') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0) ${where}
      ORDER BY u.name COLLATE NOCASE`,
  ).bind(...(ids ?? [])).all<StaffRow & { perm_meta: string | null }>();
  let res;
  try { res = await q(true); } catch (e) {
    if (!/no such (table|column)/.test(String(e))) throw e;
    try { res = await q(false); } catch (e2) {
      if (!/no such column: u.position/.test(String(e2))) throw e2;
      res = await env.DB.prepare(
        `SELECT u.id, u.name, u.role, u.photo_key, NULL AS position, NULL AS custom_role, COALESCE(u.totp_enabled, 0) AS totp,
                CASE WHEN u.is_active = 1 AND ${currentStaffSql("u.")} THEN 1 ELSE 0 END AS here,
                (SELECT value FROM system_meta WHERE key = 'role_permissions') AS perm_meta
           FROM users u WHERE u.role NOT IN ('customer', 'agent') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0) ${where} ORDER BY u.name COLLATE NOCASE`,
      ).bind(...(ids ?? [])).all<StaffRow & { perm_meta: string | null }>();
    }
  }
  const rows = res.results;
  const meta = rows[0]?.perm_meta;
  try { setPermissionOverrides(meta ? (JSON.parse(meta) as { perms?: unknown }).perms : null); } catch { setPermissionOverrides(null); }
  return rows;
}

const mayChat = (r: StaffRow) => r.here === 1 && roleMayChat(r, r.totp === 1);

/* ------------------------------------------------------------------ */
/* The Worker's side: /api/v1/staff/chat/*                             */
/* ------------------------------------------------------------------ */

function hub(env: Env) {
  const ns = (env as unknown as { CHAT?: DurableObjectNamespace }).CHAT;
  return ns ? ns.get(ns.idFromName("a2z")) : null;
}
function files(env: Env): R2Bucket | null {
  return (env as unknown as { CHAT_FILES?: R2Bucket }).CHAT_FILES ?? null;
}
async function call(env: Env, op: string, uid: number, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const h = hub(env);
  if (!h) return fail("chat_off", "Chat is not set up on this server yet", 503);
  return h.fetch(new Request(`https://hub/${op}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Chat-Uid": String(uid), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

/** The file signature must match the declared type: a renamed program is
    refused before anything is stored. */
export function signatureOk(type: string, b: Uint8Array): boolean {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (type === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  if (type === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === "image/webp") return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  if (type === "application/pdf") return at(0, 0x25, 0x50, 0x44, 0x46, 0x2d);
  return false;
}

/** A PDF that carries script, a launch action or embedded files is refused.
    A heuristic on the uncompressed dictionary keys, NOT a virus scan (the CEO
    chose PDFs without a scanner, 18-11-2026; the drawer says so). */
export function pdfActive(b: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(b);
  return /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|AA)\b/.test(text);
}

export function cleanName(raw: string | null, type: string): string {
  let n = "";
  try { n = decodeURIComponent(raw ?? ""); } catch { n = raw ?? ""; }
  n = n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120) || "file";
  const ext = CHAT_TYPES[type]!;
  const want = ext === "jpg" ? /\.(jpe?g)$/i : new RegExp(`\\.${ext}$`, "i");
  return want.test(n) ? n : `${n.replace(/\.[^.]*$/, "")}.${ext}`;
}

async function readCapped(req: Request, cap: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { try { await reader.cancel(); } catch { /* gone */ } return null; }
    parts.push(value);
  }
  const out = new Uint8Array(total); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

export async function handleChat(
  request: Request, env: Env, sub: string, user: ChatUser, sessHash: string, origins: string[],
): Promise<Response> {
  const method = request.method;
  if (!(await chatEligible(env, user))) return fail("forbidden", "Chat is for current A2Z staff only", 403);
  const uid = user.id;

  /* the live connection: same origin only (a cookie rides a socket too) */
  if (sub === "/ws" && method === "GET") {
    if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") return fail("upgrade_required", "WebSocket only", 426);
    const origin = request.headers.get("Origin");
    if (!origin || !origins.includes(origin)) return fail("forbidden_origin", "Origin not allowed", 403);
    const h = hub(env);
    if (!h) return fail("chat_off", "Chat is not set up on this server yet", 503);
    return h.fetch(new Request("https://hub/ws", {
      headers: { Upgrade: "websocket", "X-Chat-Uid": String(uid), "X-Chat-Sess": sessHash },
    }));
  }

  if (sub === "/people" && method === "GET") {
    const rows = await staffRows(env);
    const pres = await call(env, "presence", uid);
    const online = pres.ok ? new Set(((await pres.json()) as { online: number[] }).online) : new Set<number>();
    /* every current staff member is listed; one who cannot chat yet says why
       (no 2FA yet, or chat switched off for the role) instead of vanishing */
    return j({ me: uid, people: rows.map((r) => ({
      id: r.id, name: r.name, role: r.role, position: r.position, photo_key: r.photo_key,
      on_staff: r.here === 1, can_chat: mayChat(r), why: r.here === 1 ? chatBlock(r, r.totp === 1) : "left",
      online: mayChat(r) && online.has(r.id),
    })) });
  }

  if (sub === "/inbox" && method === "GET") return call(env, "inbox", uid);
  if (sub === "/health" && method === "GET") {
    if (!allows(user as Parameters<typeof allows>[0], "exec_view")) return fail("forbidden", "Management only", 403);
    return call(env, "health", uid);
  }

  const conv = /^\/c\/(\d+)\/(messages|read)$/.exec(sub);
  if (conv && conv[2] === "messages" && method === "GET") {
    const before = Number(new URL(request.url).searchParams.get("before") ?? "0") || 0;
    return call(env, "messages", uid, { conv: Number(conv[1]), before });
  }
  const body = (method === "POST" || method === "PATCH") && sub !== "/files" ? ((await request.clone().json().catch(() => null)) as Json | null) : null;

  if (conv && conv[2] === "messages" && method === "POST") {
    const text = typeof body?.text === "string" ? body.text.replace(/\r\n/g, "\n").trim() : "";
    const fileIds = Array.isArray(body?.files) ? (body!.files as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (!text && fileIds.length === 0) return fail("empty", "Write a message or attach a file", 400);
    if ([...text].length > CHAT_MAX_TEXT) return fail("too_long", `A message is at most ${CHAT_MAX_TEXT} characters`, 400);
    if (fileIds.length > CHAT_MAX_FILES) return fail("too_many_files", `At most ${CHAT_MAX_FILES} files a message`, 400);
    const res = await call(env, "send", uid, { conv: Number(conv[1]), text, files: fileIds, client_id: typeof body?.client_id === "string" ? body.client_id.slice(0, 40) : null });
    if (!res.ok) return res;
    const out = (await res.json()) as { message: unknown; push: number[] };
    /* a push names nothing: no sender, no text, no preview - a lock screen
       keeps what it was shown long after 12 hours (CEO decision) */
    for (const to of out.push) {
      try { await pushToUser(env, to, "A2Z Chat", "New message on A2Z Chat", "chat", "/portal?chat=1", { ttl: 3600, urgency: "normal" }); } catch { /* best effort */ }
    }
    return j({ message: out.message });
  }
  if (conv && conv[2] === "read" && method === "POST") {
    return call(env, "read", uid, { conv: Number(conv[1]), upto: Number(body?.upto) || 0 });
  }

  if (sub === "/direct" && method === "POST") {
    const other = Number(body?.user_id);
    if (!Number.isInteger(other) || other <= 0 || other === uid) return fail("invalid_input", "Choose a colleague", 400);
    const [row] = await staffRows(env, [other]);
    if (!row || !mayChat(row)) return fail("not_available", "That person cannot use chat", 409);
    return call(env, "direct", uid, { other });
  }

  const grp = /^\/groups(?:\/(\d+)(\/leave)?)?$/.exec(sub);
  if (grp && !grp[1] && method === "POST") {
    const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    const ids = [...new Set((Array.isArray(body?.member_ids) ? body!.member_ids as unknown[] : []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== uid))];
    if (!name || name.length > 60) return fail("invalid_input", "Name the group (60 characters at most)", 400);
    if (ids.length < 1 || ids.length + 1 > CHAT_GROUP_MAX) return fail("invalid_input", `A group is 2 to ${CHAT_GROUP_MAX} people`, 400);
    const rows = await staffRows(env, ids);
    if (rows.length !== ids.length || !rows.every(mayChat)) return fail("not_available", "Someone you chose cannot use chat", 409);
    return call(env, "group", uid, { name, members: ids });
  }
  if (grp && grp[1] && !grp[2] && method === "PATCH") {
    const add = [...new Set((Array.isArray(body?.add) ? body!.add as unknown[] : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const remove = [...new Set((Array.isArray(body?.remove) ? body!.remove as unknown[] : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : undefined;
    if (name !== undefined && (!name || name.length > 60)) return fail("invalid_input", "Name the group (60 characters at most)", 400);
    if (add.length) {
      const rows = await staffRows(env, add);
      if (rows.length !== add.length || !rows.every(mayChat)) return fail("not_available", "Someone you chose cannot use chat", 409);
    }
    return call(env, "group-edit", uid, { conv: Number(grp[1]), name, add, remove });
  }
  if (grp && grp[1] && grp[2] && method === "POST") return call(env, "group-leave", uid, { conv: Number(grp[1]) });

  /* a file: checked BEFORE anything is stored */
  if (sub === "/files" && method === "POST") {
    const bucket = files(env);
    if (!bucket || !hub(env)) return fail("chat_off", "Chat files are not set up on this server yet", 503);
    const type = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!CHAT_TYPES[type]) return fail("unsupported_type", "Only JPG, PNG, WebP or PDF", 415);
    const declared = Number(request.headers.get("Content-Length") ?? "0");
    if (declared > CHAT_MAX_FILE) return fail("too_large", "A file is at most 2 MB", 413);
    const bytes = await readCapped(request, CHAT_MAX_FILE);
    if (!bytes) return fail("too_large", "A file is at most 2 MB", 413);
    if (bytes.byteLength < 8) return fail("empty", "The file is empty", 400);
    if (!signatureOk(type, bytes)) return fail("bad_signature", "The file is not the type it claims to be", 415);
    if (type === "application/pdf" && pdfActive(bytes)) return fail("pdf_active", "This PDF carries scripts or embedded files and cannot be sent", 415);
    const name = cleanName(request.headers.get("X-File-Name"), type);
    const reg = await call(env, "file-new", uid, { name, type, size: bytes.byteLength });
    if (!reg.ok) return reg;
    const { id, key } = (await reg.json()) as { id: string; key: string };
    try {
      await bucket.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { owner: String(uid) } });
    } catch {
      await call(env, "file-drop", uid, { id });
      return fail("store_failed", "The file could not be stored - try again", 502);
    }
    await call(env, "file-stored", uid, { id });
    return j({ file: { id, name, type, size: bytes.byteLength } });
  }
  const fl = /^\/files\/([0-9a-f-]{36})$/.exec(sub);
  if (fl && method === "GET") {
    const bucket = files(env);
    if (!bucket) return fail("chat_off", "Chat files are not set up on this server yet", 503);
    const meta = await call(env, "file-get", uid, { id: fl[1] });
    if (!meta.ok) return meta;
    const f = (await meta.json()) as { key: string; name: string; type: string };
    const obj = await bucket.get(f.key);
    if (!obj) return fail("gone", "This file has expired", 410);
    const inline = f.type.startsWith("image/");
    return new Response(obj.body, { headers: {
      "Content-Type": f.type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  }

  return fail("not_found", "No such chat route", 404);
}

/** After a sign-out, an offboarding, a deactivation or a role change, the hub
    re-checks every open connection at once (the alarm also does it every
    minute while anyone is connected). */
export async function chatRecheck(env: Env): Promise<void> {
  const h = hub(env);
  if (!h) return;
  try { await h.fetch(new Request("https://hub/recheck", { method: "POST", headers: { "X-Chat-Uid": "0" } })); } catch { /* the minute check catches it */ }
}

/** The 5-minute cron: recovery for a missed alarm, and orphaned R2 objects. */
export async function chatCronSweep(env: Env): Promise<void> {
  const h = hub(env);
  if (!h) return;
  const r = await h.fetch(new Request("https://hub/sweep?orphans=1", { method: "POST", headers: { "X-Chat-Uid": "0" } }));
  if (!r.ok) throw new Error(`chat sweep answered ${r.status}`);
}

/* ------------------------------------------------------------------ */
/* The hub: one Durable Object, SQLite storage                         */
/* ------------------------------------------------------------------ */

interface Attach { uid: number; sess: string }
interface MsgRow { id: number; conv_id: number; sender_id: number; body: string; created_at: number; expires_at: number; client_id: string | null }
interface FileRow { id: string; msg_id: number | null; name: string; type: string; size: number }

export class ChatHub {
  private sql: SqlStorage;
  constructor(private ctx: DurableObjectState, private env: Env) {
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => { this.migrate(); });
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch { /* older runtime */ }
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
        name TEXT, direct_key TEXT UNIQUE, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS members (
        conv_id INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at INTEGER NOT NULL,
        last_read INTEGER NOT NULL DEFAULT 0, last_push INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (conv_id, user_id));
      CREATE INDEX IF NOT EXISTS members_user ON members (user_id);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER NOT NULL, sender_id INTEGER NOT NULL,
        body TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, client_id TEXT);
      CREATE INDEX IF NOT EXISTS messages_conv ON messages (conv_id, id);
      CREATE INDEX IF NOT EXISTS messages_exp ON messages (expires_at);
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, msg_id INTEGER, conv_id INTEGER,
        name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, r2_key TEXT NOT NULL,
        stored INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS files_exp ON files (expires_at);
      CREATE INDEX IF NOT EXISTS files_msg ON files (msg_id);
      CREATE TABLE IF NOT EXISTS rate (user_id INTEGER NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS rate_user ON rate (user_id, kind, at);
      CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }

  /* ---- small helpers ---- */
  private rows<T>(q: string, ...b: unknown[]): T[] { return this.sql.exec(q, ...b).toArray() as unknown as T[]; }
  private one<T>(q: string, ...b: unknown[]): T | null { return (this.rows<T>(q, ...b)[0]) ?? null; }
  private stat(key: string): string | null { return this.one<{ value: string }>(`SELECT value FROM stats WHERE key = ?`, key)?.value ?? null; }
  private setStat(key: string, value: string | number) { this.sql.exec(`INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, String(value)); }
  private bump(key: string, by = 1) { this.setStat(key, Number(this.stat(key) ?? "0") + by); }
  private day(now = Date.now()) { return new Date(now + 8 * 3600_000).toISOString().slice(0, 10); } // Malaysia day
  private isMember(conv: number, uid: number) { return Boolean(this.one(`SELECT 1 AS ok FROM members WHERE conv_id = ? AND user_id = ?`, conv, uid)); }
  private memberIds(conv: number) { return this.rows<{ user_id: number }>(`SELECT user_id FROM members WHERE conv_id = ?`, conv).map((r) => r.user_id); }
  private sockets(uid?: number) { return uid === undefined ? this.ctx.getWebSockets() : this.ctx.getWebSockets(`u:${uid}`); }
  private online(): number[] {
    const s = new Set<number>();
    for (const ws of this.sockets()) { const a = ws.deserializeAttachment() as Attach | null; if (a) s.add(a.uid); }
    return [...s];
  }
  private send(uid: number, data: unknown) {
    const msg = JSON.stringify(data);
    for (const ws of this.sockets(uid)) { try { ws.send(msg); } catch { /* closing */ } }
  }
  private sendAll(data: unknown) {
    const msg = JSON.stringify(data);
    for (const ws of this.sockets()) { try { ws.send(msg); } catch { /* closing */ } }
  }
  private allowRate(uid: number, kind: keyof typeof RATE): boolean {
    const [limit, win] = RATE[kind]; const now = Date.now();
    this.sql.exec(`DELETE FROM rate WHERE user_id = ? AND kind = ? AND at < ?`, uid, kind, now - win);
    const n = this.one<{ n: number }>(`SELECT COUNT(*) AS n FROM rate WHERE user_id = ? AND kind = ?`, uid, kind)?.n ?? 0;
    if (n >= limit) return false;
    this.sql.exec(`INSERT INTO rate (user_id, kind, at) VALUES (?, ?, ?)`, uid, kind, now);
    return true;
  }
  private unread(uid: number) {
    const now = Date.now();
    const by = this.rows<{ conv_id: number; n: number }>(
      `SELECT m.conv_id, COUNT(*) AS n FROM messages m JOIN members mb ON mb.conv_id = m.conv_id AND mb.user_id = ?
        WHERE m.id > mb.last_read AND m.sender_id != ? AND m.expires_at > ? GROUP BY m.conv_id`, uid, uid, now);
    const out: Record<number, number> = {}; let total = 0;
    for (const r of by) { out[r.conv_id] = r.n; total += r.n; }
    return { total, by_conv: out };
  }
  private filesFor(ids: number[]): Record<number, FileRow[]> {
    if (!ids.length) return {};
    const rows = this.rows<FileRow>(`SELECT id, msg_id, name, type, size FROM files WHERE msg_id IN (${ids.map(() => "?").join(",")}) AND expires_at > ?`, ...ids, Date.now());
    const out: Record<number, FileRow[]> = {};
    for (const f of rows) (out[f.msg_id!] ??= []).push({ id: f.id, msg_id: f.msg_id, name: f.name, type: f.type, size: f.size });
    return out;
  }
  private shape(m: MsgRow, f: Record<number, FileRow[]>) {
    return { id: m.id, conv_id: m.conv_id, sender_id: m.sender_id, text: m.body, created_at: m.created_at, expires_at: m.expires_at,
      client_id: m.client_id, files: (f[m.id] ?? []).map(({ id, name, type, size }) => ({ id, name, type, size })) };
  }
  private convSummary(conv: number, uid: number) {
    const c = this.one<{ id: number; kind: string; name: string | null; created_by: number; created_at: number }>(`SELECT id, kind, name, created_by, created_at FROM conversations WHERE id = ?`, conv);
    if (!c) return null;
    const now = Date.now();
    const members = this.rows<{ user_id: number; last_read: number }>(`SELECT user_id, last_read FROM members WHERE conv_id = ?`, conv);
    const last = this.one<MsgRow>(`SELECT * FROM messages WHERE conv_id = ? AND expires_at > ? ORDER BY id DESC LIMIT 1`, conv, now);
    const lastFiles = last ? (this.one<{ n: number }>(`SELECT COUNT(*) AS n FROM files WHERE msg_id = ? AND expires_at > ?`, last.id, now)?.n ?? 0) : 0;
    const unread = this.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages m JOIN members mb ON mb.conv_id = m.conv_id AND mb.user_id = ?
        WHERE m.conv_id = ? AND m.id > mb.last_read AND m.sender_id != ? AND m.expires_at > ?`, uid, conv, uid, now)?.n ?? 0;
    return { id: c.id, kind: c.kind, name: c.name, created_by: c.created_by, created_at: c.created_at,
      members: members.map((m) => ({ id: m.user_id, last_read: m.last_read })), unread,
      last: last ? { id: last.id, sender_id: last.sender_id, preview: last.body.slice(0, 90), files: lastFiles, at: last.created_at, expires_at: last.expires_at } : null };
  }

  /* ---- the alarm: expiry, and the minute re-check while anyone is connected ---- */
  private ensureAlarm() {
    const now = Date.now();
    const nextMsg = this.one<{ t: number | null }>(`SELECT MIN(expires_at) AS t FROM messages`)?.t ?? null;
    const nextFile = this.one<{ t: number | null }>(`SELECT MIN(expires_at) AS t FROM files`)?.t ?? null;
    const cands = [nextMsg, nextFile].filter((t): t is number => typeof t === "number").map((t) => Math.ceil(t / 30_000) * 30_000);
    if (this.sockets().length) cands.push(now + RECHECK_MS);
    if (!cands.length) return this.ctx.storage.deleteAlarm();
    return this.ctx.storage.setAlarm(Math.max(Math.min(...cands), now + 1000));
  }

  async alarm() {
    try { await this.sweep(false); } catch (e) { this.bump(`fail:${this.day()}`); this.setStat("last_error", String(e).slice(0, 200)); }
    if (this.sockets().length) { try { await this.recheck(); } catch { /* next minute */ } }
    await this.ensureAlarm();
  }

  /** Delete what has expired: message rows, file rows and the R2 objects. A
      file row is removed only once its object is gone, so a failed R2 delete
      is retried on the next run instead of being forgotten. */
  async sweep(orphans: boolean) {
    const now = Date.now();
    const bucket = files(this.env);
    const dead = this.rows<{ id: string; r2_key: string; stored: number }>(`SELECT id, r2_key, stored FROM files WHERE expires_at <= ? LIMIT 1000`, now);
    let filesGone = 0;
    if (dead.length) {
      let ok = true;
      if (bucket) {
        try { await bucket.delete(dead.map((d) => d.r2_key)); } catch (e) { ok = false; this.bump(`fail:${this.day()}`); this.setStat("last_error", String(e).slice(0, 200)); }
      }
      if (ok) {
        for (let i = 0; i < dead.length; i += 100) {
          const part = dead.slice(i, i + 100);
          this.sql.exec(`DELETE FROM files WHERE id IN (${part.map(() => "?").join(",")})`, ...part.map((d) => d.id));
        }
        filesGone = dead.length;
      }
    }
    const gone = this.rows<{ id: number; conv_id: number }>(`SELECT id, conv_id FROM messages WHERE expires_at <= ? LIMIT 5000`, now);
    if (gone.length) this.sql.exec(`DELETE FROM messages WHERE id <= ? AND expires_at <= ?`, Math.max(...gone.map((g) => g.id)), now);
    if (gone.length || filesGone) {
      this.bump(`deleted:${this.day()}`, gone.length);
      this.bump(`files_deleted:${this.day()}`, filesGone);
      this.sendAll({ type: "expired", ids: gone.map((g) => g.id), files: dead.map((d) => d.id) });
      for (const uid of this.online()) this.send(uid, { type: "unread", ...this.unread(uid) });
    }
    if (orphans && bucket) {
      /* an R2 object with no record (a store that answered after its record
         was swept, or a reset hub) older than 30 minutes is removed */
      const known = new Set(this.rows<{ r2_key: string }>(`SELECT r2_key FROM files`).map((r) => r.r2_key));
      const listed = await bucket.list({ prefix: "f/", limit: 1000 });
      const orphan = listed.objects.filter((o) => !known.has(o.key) && o.uploaded.getTime() < now - 30 * 60_000).map((o) => o.key);
      if (orphan.length) { await bucket.delete(orphan); this.bump(`orphans:${this.day()}`, orphan.length); }
    }
    /* keep 14 days of counters */
    const cutoff = this.day(now - 14 * 86400_000);
    this.sql.exec(`DELETE FROM stats WHERE key GLOB '*:20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(key, -10) < ?`, cutoff);
    this.sql.exec(`DELETE FROM rate WHERE at < ?`, now - 600_000);
    const overdue = this.one<{ n: number; t: number | null }>(`SELECT COUNT(*) AS n, MIN(expires_at) AS t FROM messages WHERE expires_at <= ?`, now);
    this.setStat("last_sweep_at", now);
    this.setStat("overdue", overdue?.n ?? 0);
    return { deleted: gone.length, files_deleted: filesGone, overdue: overdue?.n ?? 0 };
  }

  /** Close every connection whose session ended or whose person may no longer chat. */
  async recheck() {
    const socks = this.sockets();
    if (!socks.length) return;
    const atts = socks.map((ws) => ({ ws, a: ws.deserializeAttachment() as Attach | null }));
    const sess = [...new Set(atts.map((x) => x.a?.sess).filter((s): s is string => Boolean(s)))];
    const valid = new Set<string>();
    for (let i = 0; i < sess.length; i += 50) {
      const part = sess.slice(i, i + 50);
      const ph = part.map(() => "?").join(",");
      const q = (cr: boolean) => this.env.DB.prepare(
        `SELECT s.id AS sid, u.id, u.role, COALESCE(u.totp_enabled, 0) AS totp,
                ${cr ? "(SELECT c.key FROM custom_roles c WHERE c.id = u.custom_role_id AND c.active = 1 AND c.base_role = u.role)" : "NULL"} AS custom_role,
                (SELECT value FROM system_meta WHERE key = 'role_permissions') AS perm_meta
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id IN (${ph}) AND s.expires_at > datetime('now') AND u.is_active = 1 AND ${currentStaffSql("u.")}
            AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)`,
      ).bind(...part).all<{ sid: string; id: number; role: string; totp: number; custom_role: string | null; perm_meta: string | null }>();
      let res;
      try { res = await q(true); } catch (e) { if (!/no such (table|column)/.test(String(e))) throw e; res = await q(false); }
      const meta = res.results[0]?.perm_meta;
      try { setPermissionOverrides(meta ? (JSON.parse(meta) as { perms?: unknown }).perms : null); } catch { setPermissionOverrides(null); }
      for (const r of res.results) if (roleMayChat(r, r.totp === 1)) valid.add(r.sid);
    }
    const closed = new Set<number>();
    for (const { ws, a } of atts) {
      if (!a || !valid.has(a.sess)) {
        /* the screen clears itself on "revoked" at once; the close follows */
        try { ws.send(JSON.stringify({ type: "revoked" })); } catch { /* gone */ }
        try { ws.close(4001, "signed_out"); } catch { /* gone */ }
        if (a) closed.add(a.uid);
      }
    }
    for (const uid of closed) if (!this.sockets(uid).some((w) => w.readyState === 1 && valid.has((w.deserializeAttachment() as Attach).sess))) this.sendAll({ type: "presence", uid, online: false });
  }

  /* ---- the WebSocket handlers (hibernation API) ---- */
  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    /* the client only listens; "ping" is answered without waking the hub */
    if (msg === "hello") {
      const a = ws.deserializeAttachment() as Attach | null;
      if (a) ws.send(JSON.stringify({ type: "unread", ...this.unread(a.uid) }));
    }
  }
  async webSocketClose(ws: WebSocket) { this.left(ws); }
  async webSocketError(ws: WebSocket) { this.left(ws); }
  private left(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attach | null;
    if (!a) return;
    const still = this.sockets(a.uid).some((w) => w !== ws && w.readyState === 1);
    if (!still) this.sendAll({ type: "presence", uid: a.uid, online: false });
  }

  /* ---- requests from the Worker (already authorised there) ---- */
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const op = url.pathname.slice(1);
    const uid = Number(req.headers.get("X-Chat-Uid") ?? "0");
    const b = (req.method === "POST" ? ((await req.json().catch(() => ({}))) as Json) : {});
    const now = Date.now();

    if (op === "ws") {
      const sess = req.headers.get("X-Chat-Sess") ?? "";
      if (!uid || !sess) return fail("forbidden", "No identity", 403);
      const pair = new WebSocketPair();
      const first = this.sockets(uid).length === 0;
      this.ctx.acceptWebSocket(pair[1], [`u:${uid}`]);
      pair[1].serializeAttachment({ uid, sess } satisfies Attach);
      pair[1].send(JSON.stringify({ type: "hello", online: this.online(), ...this.unread(uid) }));
      if (first) this.sendAll({ type: "presence", uid, online: true });
      await this.ensureAlarm();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (op === "presence") return j({ online: this.online() });
    if (op === "recheck") { await this.recheck(); return j({ ok: true }); }
    if (op === "sweep") { const r = await this.sweep(url.searchParams.get("orphans") === "1"); await this.ensureAlarm(); return j(r); }
    if (op === "health") {
      const d = this.day();
      const live = this.one<{ n: number }>(`SELECT COUNT(*) AS n FROM messages WHERE expires_at > ?`, now)?.n ?? 0;
      const lf = this.one<{ n: number; bytes: number | null }>(`SELECT COUNT(*) AS n, SUM(size) AS bytes FROM files WHERE expires_at > ?`, now);
      const days = this.rows<{ key: string; value: string }>(`SELECT key, value FROM stats WHERE key LIKE '%:20%'`);
      const byDay: Record<string, Record<string, number>> = {};
      for (const r of days) { const [k, day] = [r.key.slice(0, r.key.lastIndexOf(":")), r.key.slice(-10)]; (byDay[day] ??= {})[k] = Number(r.value); }
      return j({ today: d, live_messages: live, live_files: lf?.n ?? 0, live_file_bytes: lf?.bytes ?? 0,
        last_sweep_at: Number(this.stat("last_sweep_at") ?? "0") || null, overdue: Number(this.stat("overdue") ?? "0"),
        last_error: this.stat("last_error"), online: this.online().length, days: byDay });
    }

    if (!uid) return fail("forbidden", "No identity", 403);

    if (op === "inbox") {
      const convs = this.rows<{ id: number; kind: string }>(`SELECT c.id, c.kind FROM conversations c JOIN members mb ON mb.conv_id = c.id AND mb.user_id = ?`, uid);
      const out = convs.map((c) => this.convSummary(c.id, uid)).filter((c): c is NonNullable<typeof c> => Boolean(c))
        .filter((c) => c.kind === "group" || c.last !== null || c.created_by === uid && c.created_at > now - chatTtl(this.env));
      out.sort((a, b2) => (b2.last?.at ?? b2.created_at) - (a.last?.at ?? a.created_at));
      return j({ conversations: out, ...this.unread(uid), ttl_ms: chatTtl(this.env), now });
    }

    if (op === "messages") {
      const conv = Number(b.conv); const before = Number(b.before) || Number.MAX_SAFE_INTEGER;
      if (!this.isMember(conv, uid)) return fail("not_found", "No such conversation", 404);
      const rows = this.rows<MsgRow>(`SELECT * FROM messages WHERE conv_id = ? AND expires_at > ? AND id < ? ORDER BY id DESC LIMIT 50`, conv, now, before).reverse();
      const f = this.filesFor(rows.map((r) => r.id));
      return j({ conversation: this.convSummary(conv, uid), messages: rows.map((r) => this.shape(r, f)), more: rows.length === 50, now });
    }

    if (op === "send") {
      const conv = Number(b.conv);
      if (!this.isMember(conv, uid)) return fail("not_found", "No such conversation", 404);
      if (!this.allowRate(uid, "msg")) return fail("rate_limited", "You are sending too fast - wait a moment", 429);
      const text = String(b.text ?? "");
      if ([...text].length > CHAT_MAX_TEXT) return fail("too_long", `A message is at most ${CHAT_MAX_TEXT} characters`, 400);
      const ids = (Array.isArray(b.files) ? b.files : []) as string[];
      let claim: { id: string; size: number }[] = [];
      if (ids.length) {
        claim = this.rows<{ id: string; size: number }>(
          `SELECT id, size FROM files WHERE id IN (${ids.map(() => "?").join(",")}) AND owner_id = ? AND msg_id IS NULL AND stored = 1 AND expires_at > ?`, ...ids, uid, now);
        if (claim.length !== new Set(ids).size) return fail("file_missing", "A file is missing or has already been sent - attach it again", 409);
        if (claim.reduce((s, f) => s + f.size, 0) > CHAT_MAX_TOTAL) return fail("too_large", "Files in one message are at most 5 MB together", 413);
      }
      const clientId = typeof b.client_id === "string" ? b.client_id : null;
      if (clientId) {
        const dup = this.one<MsgRow>(`SELECT * FROM messages WHERE conv_id = ? AND sender_id = ? AND client_id = ? AND expires_at > ?`, conv, uid, clientId, now);
        if (dup) return j({ message: this.shape(dup, this.filesFor([dup.id])), push: [] });
      }
      const exp = now + chatTtl(this.env);
      const row = this.one<MsgRow>(`INSERT INTO messages (conv_id, sender_id, body, created_at, expires_at, client_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`, conv, uid, text, now, exp, clientId)!;
      if (claim.length) this.sql.exec(`UPDATE files SET msg_id = ?, conv_id = ?, expires_at = ? WHERE id IN (${claim.map(() => "?").join(",")})`, row.id, conv, exp, ...claim.map((c) => c.id));
      this.sql.exec(`UPDATE members SET last_read = ? WHERE conv_id = ? AND user_id = ?`, row.id, conv, uid);
      this.bump(`sent:${this.day(now)}`);
      const shaped = this.shape(row, this.filesFor([row.id]));
      const members = this.memberIds(conv);
      const push: number[] = [];
      for (const m of members) {
        this.send(m, { type: "message", message: shaped, ...(m === uid ? {} : { unread: this.unread(m) }) });
        if (m !== uid && this.sockets(m).length === 0) {
          const lp = this.one<{ last_push: number }>(`SELECT last_push FROM members WHERE conv_id = ? AND user_id = ?`, conv, m)?.last_push ?? 0;
          if (now - lp >= PUSH_GAP_MS) { push.push(m); this.sql.exec(`UPDATE members SET last_push = ? WHERE conv_id = ? AND user_id = ?`, now, conv, m); }
        }
      }
      await this.ensureAlarm();
      return j({ message: shaped, push });
    }

    if (op === "read") {
      const conv = Number(b.conv);
      if (!this.isMember(conv, uid)) return fail("not_found", "No such conversation", 404);
      const max = this.one<{ m: number | null }>(`SELECT MAX(id) AS m FROM messages WHERE conv_id = ?`, conv)?.m ?? 0;
      const upto = Math.min(Number(b.upto) || max, max);
      this.sql.exec(`UPDATE members SET last_read = MAX(last_read, ?) WHERE conv_id = ? AND user_id = ?`, upto, conv, uid);
      for (const m of this.memberIds(conv)) this.send(m, { type: "read", conv_id: conv, uid, upto });
      this.send(uid, { type: "unread", ...this.unread(uid) });
      return j({ ok: true, upto });
    }

    if (op === "direct") {
      const other = Number(b.other);
      const key = `${Math.min(uid, other)}:${Math.max(uid, other)}`;
      let c = this.one<{ id: number }>(`SELECT id FROM conversations WHERE direct_key = ?`, key);
      if (!c) {
        c = this.one<{ id: number }>(`INSERT INTO conversations (kind, direct_key, created_by, created_at) VALUES ('direct', ?, ?, ?) RETURNING id`, key, uid, now)!;
        this.sql.exec(`INSERT INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?), (?, ?, ?)`, c.id, uid, now, c.id, other, now);
      }
      return j({ conversation: this.convSummary(c.id, uid) });
    }

    if (op === "group") {
      const ids = (b.members as number[]).filter((x) => x !== uid);
      if (ids.length + 1 > CHAT_GROUP_MAX) return fail("invalid_input", `A group is 2 to ${CHAT_GROUP_MAX} people`, 400);
      const c = this.one<{ id: number }>(`INSERT INTO conversations (kind, name, created_by, created_at) VALUES ('group', ?, ?, ?) RETURNING id`, String(b.name), uid, now)!;
      for (const m of [uid, ...ids]) this.sql.exec(`INSERT INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)`, c.id, m, now);
      for (const m of [uid, ...ids]) this.send(m, { type: "conv", conv_id: c.id });
      return j({ conversation: this.convSummary(c.id, uid) });
    }

    if (op === "group-edit") {
      const conv = Number(b.conv);
      const c = this.one<{ kind: string; created_by: number }>(`SELECT kind, created_by FROM conversations WHERE id = ?`, conv);
      if (!c || c.kind !== "group" || !this.isMember(conv, uid)) return fail("not_found", "No such group", 404);
      const before = this.memberIds(conv);
      const add = ((b.add as number[]) ?? []).filter((x) => !before.includes(x));
      const remove = ((b.remove as number[]) ?? []).filter((x) => before.includes(x) && x !== uid);
      if (remove.length && c.created_by !== uid) return fail("forbidden", "Only the person who made the group removes others", 403);
      if (before.length + add.length - remove.length > CHAT_GROUP_MAX) return fail("too_many", `A group is at most ${CHAT_GROUP_MAX} people`, 400);
      if (typeof b.name === "string") this.sql.exec(`UPDATE conversations SET name = ? WHERE id = ?`, b.name, conv);
      for (const m of add) this.sql.exec(`INSERT INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)`, conv, m, now);
      for (const m of remove) this.sql.exec(`DELETE FROM members WHERE conv_id = ? AND user_id = ?`, conv, m);
      for (const m of new Set([...before, ...add])) this.send(m, { type: "conv", conv_id: conv, removed: remove.includes(m) });
      return j({ conversation: this.convSummary(conv, uid) });
    }

    if (op === "group-leave") {
      const conv = Number(b.conv);
      const c = this.one<{ kind: string }>(`SELECT kind FROM conversations WHERE id = ?`, conv);
      if (!c || c.kind !== "group" || !this.isMember(conv, uid)) return fail("not_found", "No such group", 404);
      this.sql.exec(`DELETE FROM members WHERE conv_id = ? AND user_id = ?`, conv, uid);
      const left = this.memberIds(conv);
      if (!left.length) {
        /* nobody left: the group and everything in it end now */
        this.sql.exec(`UPDATE messages SET expires_at = ? WHERE conv_id = ?`, now, conv);
        this.sql.exec(`UPDATE files SET expires_at = ? WHERE conv_id = ?`, now, conv);
        this.sql.exec(`DELETE FROM conversations WHERE id = ?`, conv);
        await this.sweep(false);
      }
      for (const m of [...left, uid]) this.send(m, { type: "conv", conv_id: conv, removed: m === uid });
      await this.ensureAlarm();
      return j({ ok: true });
    }

    if (op === "file-new") {
      if (!this.allowRate(uid, "upload")) return fail("rate_limited", "Too many files in a short time - wait a few minutes", 429);
      const id = crypto.randomUUID();
      const key = `f/${id}`;
      this.sql.exec(`INSERT INTO files (id, owner_id, name, type, size, r2_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, uid, String(b.name), String(b.type), Number(b.size), key, now, now + PENDING_MS);
      await this.ensureAlarm();
      return j({ id, key });
    }
    if (op === "file-stored") { this.sql.exec(`UPDATE files SET stored = 1 WHERE id = ? AND owner_id = ?`, String(b.id), uid); return j({ ok: true }); }
    if (op === "file-drop") { this.sql.exec(`UPDATE files SET expires_at = ? WHERE id = ? AND owner_id = ? AND msg_id IS NULL`, now, String(b.id), uid); await this.ensureAlarm(); return j({ ok: true }); }
    if (op === "file-get") {
      const f = this.one<{ r2_key: string; name: string; type: string }>(
        `SELECT f.r2_key, f.name, f.type FROM files f JOIN members mb ON mb.conv_id = f.conv_id AND mb.user_id = ?
          WHERE f.id = ? AND f.msg_id IS NOT NULL AND f.expires_at > ?`, uid, String(b.id), now);
      if (!f) return fail("gone", "This file has expired or is not yours to open", 404);
      return j({ key: f.r2_key, name: f.name, type: f.type });
    }

    return fail("not_found", "Unknown hub operation", 404);
  }
}

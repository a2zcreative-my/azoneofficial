/* v1.389.0 - the REAL worker for the staff-portfolio checks: the bundled worker/src/index.ts on an
   in-memory SQLite built from every migration, with an in-memory R2 that keeps what is put in it.
   Used by tests/staff-portfolios.mjs (the guard) and tests/browser/portfolio-server.mjs (the
   browser walk). The people below are INVENTED test records - not anybody's real staff record. */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const root = fileURLToPath(new URL("../..", import.meta.url));
const sha = (s) => createHash("sha256").update(s).digest("hex");

export async function makeRuntime({ origin = "https://portal.a2z.test", bundle: given } = {}) {
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const out = given ?? join(mkdtempSync(join(tmpdir(), "pf-")), "worker.mjs");
  if (!given) execSync(`npx esbuild "${join(root, "worker/src/index.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(root, "worker/migrations", f), "utf8");
    /* the whole file first (a trigger body keeps its own semicolons); if one statement is read
       differently by SQLite, the rest statement by statement */
    try { db.exec(sql); } catch { for (const st of sql.split(/;\s*\n/)) { try { db.exec(st); } catch { /* skipped */ } } }
  }
  const shim = (sql) => {
    const st = db.prepare(sql); let b = [];
    const o = {
      bind: (...a) => { b = a.map((x) => (x === undefined ? null : typeof x === "boolean" ? (x ? 1 : 0) : x)); return o; },
      first: async () => st.get(...b) ?? null,
      all: async () => ({ results: st.all(...b) }),
      run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }),
      raw: async () => st.all(...b).map((r) => Object.values(r)),
      _run: () => st.run(...b),
    };
    return o;
  };
  const objects = new Map();
  const MEDIA = {
    put: async (key, body, opts = {}) => {
      let bytes;
      if (body instanceof ReadableStream) { const chunks = []; const rd = body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); } bytes = Buffer.concat(chunks.map((c) => Buffer.from(c))); }
      else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) bytes = Buffer.from(body);
      else bytes = Buffer.from(String(body ?? ""));
      objects.set(key, { bytes, type: opts.httpMetadata?.contentType ?? "application/octet-stream" });
      return { key };
    },
    head: async (key) => (objects.has(key) ? { key, size: objects.get(key).bytes.length } : null),
    get: async (key) => {
      const o = objects.get(key);
      if (!o) return null;
      return { body: new Blob([o.bytes]).stream(), size: o.bytes.length, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.length), writeHttpMetadata: (h) => h.set("Content-Type", o.type), httpMetadata: { contentType: o.type } };
    },
    delete: async (key) => { objects.delete(key); },
    list: async () => ({ objects: [...objects.keys()].map((key) => ({ key })) }),
  };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: origin, MEDIA,
  };
  /* invented people: a CEO, an HR admin, a COO, a sales executive with no rights here, and three
     team members to build portfolios for (positions and duties are test words, not real records) */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, department, position, employment_status, joined_on, phone, responsibilities) VALUES
    (1,'Alif','Alif Farhan','ceo@a2zcreative.my','ceo',1,'x',1,'Management','Chief Executive Officer','permanent','2020-01-01','0120000001',NULL),
    (2,'Hana','Hana HR','hr@a2zcreative.my','hr_admin',1,'x',1,'Human Resources','HR Executive','permanent','2020-01-01','0120000002',NULL),
    (3,'Zoll','Zolkefli','coo@a2zcreative.my','coo',1,'x',1,'Management','Chief Operating Officer','permanent','2020-01-01','0120000003',NULL),
    (4,'Sam','Sam Seller','sam@a2zcreative.my','sales_marketing',1,'x',1,'Sales','Sales Executive','permanent','2020-01-01','0120000004',NULL),
    (11,'NURFARAH','NURFARAH','nurfarah@a2zcreative.my','live_host',1,'x',1,'Test Department A','Test Position A','permanent','2025-01-01','0121111111','Test duty one\nTest duty two\nTest duty three\nTest duty four\nTest duty five\nTest duty six'),
    (12,'Noraleeya','Noraleeya','noraleeya@a2zcreative.my','live_host',1,'x',1,'Test Department B','Test Position B','permanent','2025-01-01','0122222222','Test duty one\nTest duty two\nTest duty three'),
    (13,'Fasehah','Fasehah','fasehah@a2zcreative.my','sales_marketing',1,'x',1,'Test Department C','Test Position C','permanent','2025-01-01','0123333333','Test duty one\nTest duty two'),
    (14,'Leaver','Lee Ver','lee@a2zcreative.my','live_host',1,'x',1,'Test Department D','Test Position D','resigned','2024-01-01',NULL,NULL)`);
  db.exec(`UPDATE users SET left_on = '2026-01-01' WHERE id = 14`);
  /* the responsibilities as records (0215): six for the first person, Public ticked on three; none Public for the third */
  const resp = db.prepare(`INSERT INTO staff_responsibilities (user_id, sort_order, text, is_key, is_public, batch_key, created_by) VALUES (?, ?, ?, ?, ?, 'seed', 1)`);
  [["Test duty one", 1], ["Test duty two", 1], ["Test duty three", 1], ["Test duty four", 0], ["Test duty five", 0], ["Test duty six", 0]].forEach(([t, pub], i) => resp.run(11, i, t, i < 5 ? 1 : 0, pub));
  [["Test duty one", 1], ["Test duty two", 0], ["Test duty three", 0]].forEach(([t, pub], i) => resp.run(12, i, t, 1, pub));
  [["Test duty one", 0], ["Test duty two", 0]].forEach(([t, pub], i) => resp.run(13, i, t, 1, pub));
  const worker = (await import(pathToFileURL(out).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 2, 3, 4, 11, 12, 13]) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const headersFor = (uid) => (uid ? { origin, cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" } : { origin });
  const call = async (path, uid, method = "GET", body, type = "application/json") => {
    const headers = { ...headersFor(uid), "content-type": type };
    const raw = body === undefined ? undefined : body instanceof Uint8Array || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const r = await worker.fetch(new Request(`${origin.replace("portal.", "api.")}/api/v1${path}`, { method, headers, body: raw }), env);
    const buf = Buffer.from(await r.arrayBuffer());
    let j = null; try { j = JSON.parse(buf.toString("utf8")); } catch { /* not json */ }
    return { status: r.status, j, text: buf.toString("utf8").slice(0, 400), buf, type: r.headers.get("content-type") };
  };
  return { db, env, worker, call, objects, headersFor, tok };
}

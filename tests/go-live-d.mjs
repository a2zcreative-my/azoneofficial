/* RELEASE D OF THE GO-LIVE PLAN (v1.244.0) - runtime guard: the WHOLE worker
 * (index.ts, bundled) against SQLite with every migration applied, with two
 * in-memory R2 buckets (MEDIA and BACKUPS), on a fixed clock: the nightly
 * backup moment, Sunday 01-11-2026 03:20 Malaysia time.
 *
 * claude/GO-LIVE-AUDIT.md (F2, F5, F7, F9, F10, F11 and the media gap),
 * claude/FINAL-RELEASE-GATE-PLAN-V2.md Release D, and the owner's decisions of
 * 31-10-2026: D-4 "backups bucket now; staging later"; D-9 "DB 30 nights,
 * media 90 days, audit never".
 *
 * Also runs the recovery scripts (verify-backup, restore-drill, restore-rows,
 * restore-media) on the backup the worker wrote, and source-checks the
 * release plumbing (wrangler.toml, PUSH.bat, .gitignore).
 *
 *   node tests/go-live-d.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/worker.mjs node tests/go-live-d.mjs   a given bundle (the pre-fix bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { loadBackup } from "../scripts/verify-backup.mjs";
import { restoreInto, restoreSql, figuresFromRows, figuresFromDb } from "../scripts/restore-drill.mjs";
import { rowStatements } from "../scripts/restore-rows.mjs";
import { plan as mediaPlan } from "../scripts/restore-media.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const md5 = (s) => createHash("md5").update(s).digest("hex");
const NOW = Date.parse("2026-10-31T19:20:00Z"); // Sun 01-11-2026 03:20 MYT - the nightly backup moment

/* ---- an in-memory R2 bucket: put/get/head/delete/list with cursor pages ---- */
function bucket(pageSize = 7) {
  const m = new Map();
  const bytesOf = async (v) => {
    if (v == null) return new Uint8Array();
    if (typeof v === "string") return new TextEncoder().encode(v);
    if (v instanceof ArrayBuffer) return new Uint8Array(v.slice(0));
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    if (typeof v.getReader === "function") return new Uint8Array(await new Response(v).arrayBuffer());
    throw new Error("unsupported body");
  };
  const view = (key, o) => ({
    key, size: o.bytes.byteLength, etag: o.etag, uploaded: o.uploaded, httpMetadata: o.httpMetadata ?? {}, customMetadata: o.customMetadata ?? {},
    get body() { return new Blob([o.bytes]).stream(); },
    arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength),
    text: async () => new TextDecoder().decode(o.bytes),
  });
  return {
    _m: m,
    async put(key, value, opts = {}) {
      const bytes = await bytesOf(value);
      if (opts.sha256 && sha(bytes) !== opts.sha256) throw new Error(`sha256 mismatch on put ${key}`);
      m.set(key, { bytes, etag: md5(bytes), uploaded: new Date(Date.now()), httpMetadata: opts.httpMetadata, customMetadata: opts.customMetadata });
      return view(key, m.get(key));
    },
    async get(key) { const o = m.get(key); return o ? view(key, o) : null; },
    async head(key) { const o = m.get(key); return o ? view(key, o) : null; },
    async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) m.delete(k); },
    async list(opts = {}) {
      const prefix = opts.prefix ?? "";
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const objects = [], prefixes = new Set();
      for (const k of keys) {
        if (opts.delimiter) {
          const rest = k.slice(prefix.length), i = rest.indexOf(opts.delimiter);
          if (i >= 0) { prefixes.add(prefix + rest.slice(0, i + 1)); continue; }
        }
        objects.push(k);
      }
      const all = [...[...prefixes].map((p) => ({ p })), ...objects.map((k) => ({ k }))];
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const slice = all.slice(start, start + Math.min(pageSize, opts.limit ?? 1000));
      const truncated = start + slice.length < all.length;
      return { objects: slice.filter((x) => x.k).map((x) => view(x.k, m.get(x.k))), delimitedPrefixes: slice.filter((x) => x.p).map((x) => x.p), truncated, ...(truncated ? { cursor: String(start + slice.length) } : {}) };
    },
  };
}

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`);
  db.exec(`INSERT INTO d1_migrations (name) VALUES ('0001_init.sql'), ('0158_payroll_population.sql')`);
  let failOn = null;
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null,
    all: async () => { if (failOn && sql.includes(failOn)) throw new Error("injected read failure"); return { results: st.all(...b) }; },
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const MEDIA = bucket(), BACKUPS = bucket();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA, BACKUPS,
  };
  const RealDate = globalThis.Date;
  let fixed = NOW;
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, department, employment_status, joined_on, left_on, birthday) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','Management','permanent','2020-01-01',NULL,'1990-05-05'),
    (2,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','Management','permanent','2020-01-01',NULL,NULL),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','Sales','permanent','2020-01-01',NULL,'1995-11-01'),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','Sales','permanent','2020-01-01',NULL,NULL),
    (7,'Gone','Gone Seller','gone@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','Sales','resigned','2020-01-01','2026-10-01','1991-11-01'),
    (8,'Root','Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP',NULL,'permanent','2020-01-01',NULL,NULL),
    (9,'Shop','Shop','shop@gmail.com','customer',1,'x',0,NULL,NULL,'permanent',NULL,NULL,NULL),
    (10,'Mira','Mira Seller','mira@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','Sales','permanent','2020-01-01',NULL,NULL)`);
  const worker = await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`);
  const app = worker.default;
  const tok = {};
  for (const id of [1, 2, 5, 6, 8]) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const buf = new Uint8Array(await r.arrayBuffer());
    const text = new TextDecoder().decode(buf);
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text, buf, headers: r.headers };
  };
  const cron = (c) => app.scheduled({ cron: c, scheduledTime: fixed }, env, { waitUntil() {} });
  const count = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const work = mkdtempSync(join(tmpdir(), "golive-d-run-"));
  const folderOf = (b, prefix) => {
    const d = mkdtempSync(join(work, "bk-"));
    for (const [k, o] of b._m) if (k.startsWith(prefix)) writeFileSync(join(d, k.slice(prefix.length)), o.bytes);
    return d;
  };

  try {
    /* ================= F7: a table past 50,000 rows is backed up, in pages ================= */
    db.exec(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 60000)
             INSERT INTO audit_log (user_id, action, entity, detail) SELECT 1, 'seed.bulk', 'row', 'row ' || x FROM c`);
    db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1, 'Kedai Satu', 1), (2, 'Kedai Dua', 1)`);
    db.exec(`INSERT INTO invoice_payments (id, invoice_id, amount_cents, received_on) VALUES (41, 9, 12345, '2026-10-20'), (42, 9, 500, '2026-10-21')`);
    const auditN = count(`SELECT COUNT(*) AS n FROM audit_log`);
    const liveTables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'`).all().map((r) => r.name);
    const before = Object.fromEntries(liveTables.map((t) => [t, count(`SELECT COUNT(*) AS n FROM "${t}"`)]));
    const bk = await worker.runBackup(env, null);
    ok(bk?.ok === true, "F7 a backup with a 60,000-row table succeeds (no 50,000-row cap)", JSON.stringify(bk).slice(0, 200));
    const prefixes = [...BACKUPS._m.keys()].filter((k) => k.endsWith("/manifest.json")).map((k) => k.slice(0, -"manifest.json".length));
    ok(prefixes.length === 1 && /^db\/db-2026-11-01-032000\/$/.test(prefixes[0]), "F7 it is written to the BACKUPS bucket under db/db-<MYT stamp>/, manifest last", JSON.stringify(prefixes));
    const pfx = prefixes[0] ?? "db/none/";
    const pageKeys = [...BACKUPS._m.keys()].filter((k) => k.startsWith(pfx) && k.endsWith(".ndjson.gz"));
    ok(pageKeys.length >= 4, "F7 the export is in pages of at most 20,000 rows", String(pageKeys.length));
    let loaded = null;
    try { loaded = loadBackup(folderOf(BACKUPS, pfx)); } catch (e) { ok(false, "F7 the written backup verifies", e.message); }
    if (loaded) {
      ok(loaded.tables.audit_log.length === auditN && loaded.tables.audit_log.length >= 60000, "F7 every audit row is in it (verified: page and table SHA-256)", `${loaded.tables.audit_log.length} vs ${auditN}`);
      const wrong = liveTables.filter((t) => before[t] !== (loaded.tables[t]?.length ?? -1));
      ok(wrong.length === 0 && Object.keys(loaded.tables).length === liveTables.length, "F7 every table's row count equals the database's at the time", wrong.slice(0, 5).join(","));
    }
    /* a damaged page fails verification */
    {
      const d = folderOf(BACKUPS, pfx);
      const f = readdirSync(d).find((x) => x.endsWith(".ndjson.gz"));
      if (!f) ok(false, "F7 a page changed after the backup fails verification", "no pages were written");
      else {
      const lines = gunzipSync(readFileSync(join(d, f))).toString().split("\n");
      const at = lines.findIndex((l) => l && !l.startsWith('{"$table"'));
      lines[at] = JSON.stringify({ ...JSON.parse(lines[at]), changed: 1 });
      const text = lines.join("\n");
      writeFileSync(join(d, f), (await import("node:zlib")).gzipSync(text));
      let failed = false; try { loadBackup(d); } catch { failed = true; }
      ok(failed, "F7 a page changed after the backup fails verification");
      }
    }
    /* the one-file download */
    const dl = await call("/system/backup/download", 8);
    let dlOk = false;
    if (dl.status === 200) {
      const f = join(work, "download.ndjson.gz"); writeFileSync(f, dl.buf);
      try { const v = loadBackup(f); dlOk = v.tables.audit_log.length === auditN && v.summary.format === 2; } catch (e) { ok(false, "F7 the download verifies", e.message); }
    }
    ok(dlOk && /azoo-db-2026-11-01-032000\.ndjson\.gz/.test(dl.headers.get("content-disposition") ?? ""), "F7 Download gives ONE file - manifest then every page - that verifies", `${dl.status} ${dl.headers.get("content-disposition")}`);
    ok((await call("/system/backup/download", 1)).status === 403, "F7 the download stays super-admin only");
    const hl = (await call("/system/health", 1)).j;
    ok(hl?.last_backup?.key === `${pfx}manifest.json` && hl?.media_backup?.bucket_bound === true, "F7 System Health names the newest complete backup and the backups bucket", JSON.stringify({ k: hl?.last_backup?.key, m: hl?.media_backup?.bucket_bound }));

    /* a backup that fails half way publishes nothing and keeps the earlier one */
    fixed += 3600000;
    failOn = `FROM "users" WHERE`;
    const bad = await worker.runBackup(env, null);
    failOn = null;
    const afterFail = [...BACKUPS._m.keys()].filter((k) => k.startsWith("db/db-2026-11-01-042000/"));
    ok(bad?.ok === false && afterFail.length === 0, "F7 a backup that fails half way leaves no pages and no manifest", JSON.stringify({ bad, left: afterFail.length }));
    ok(BACKUPS._m.has(`${pfx}manifest.json`) && count(`SELECT COUNT(*) AS n FROM error_log WHERE source = 'backup'`) >= 1, "F7 the earlier backup is untouched and the failure is in the error log");

    /* D-9 retention: the newest 30 complete; incomplete leftovers after two days */
    for (let i = 1; i <= 31; i++) {
      const d = new RealDate(Date.UTC(2026, 8, i)).toISOString().slice(0, 10);
      await BACKUPS.put(`db/db-${d}-032000/manifest.json`, "{}"); await BACKUPS.put(`db/db-${d}-032000/p00001.ndjson.gz`, "x");
    }
    await BACKUPS.put(`db/db-2026-10-20-032000/p00001.ndjson.gz`, "partial"); // no manifest, 12 days old
    await MEDIA.put("backups/db-2026-10-30.json.gz", "legacy");
    fixed += 3600000;
    const bk2 = await worker.runBackup(env, null);
    const complete = [...BACKUPS._m.keys()].filter((k) => /^db\/db-[\d-]+\/manifest\.json$/.test(k)).sort();
    ok(bk2?.ok === true && complete.length === 30 && !complete.some((k) => k.startsWith("db/db-2026-09-01") || k.startsWith("db/db-2026-09-02")), "D-9 the newest 30 complete backups are kept, older ones removed with their pages", `${complete.length} ${complete[0]}`);
    ok(![...BACKUPS._m.keys()].some((k) => k.startsWith("db/db-2026-09-01-") || k.startsWith("db/db-2026-10-20-")), "D-9 an old prefix's pages and an incomplete leftover are removed");
    ok(MEDIA._m.has("backups/db-2026-10-30.json.gz"), "D-9 the last single-file backup in the media bucket is left as it was");

    /* ================= the media copy ================= */
    for (let i = 0; i < 50; i++) await MEDIA.put(`staff/${String(i).padStart(2, "0")}/photo.jpg`, `photo-${i}-bytes`, { httpMetadata: { contentType: "image/jpeg" } });
    fixed = NOW + 6 * 3600000;
    await cron("*/30 * * * *");
    const cur = () => [...BACKUPS._m.keys()].filter((k) => k.startsWith("media/current/"));
    ok(cur().length === 40, "media: a 30-minute pass copies 40 new objects", String(cur().length));
    await cron("*/30 * * * *");
    ok(cur().length === 50 && !cur().some((k) => k.includes("backups/")), "media: the next pass copies the rest; database backups are not copied as media", String(cur().length));
    const c7 = BACKUPS._m.get("media/current/staff/07/photo.jpg");
    ok(c7 && c7.customMetadata?.sha256 === sha("photo-7-bytes") && c7.customMetadata?.src_etag === md5("photo-7-bytes") && c7.httpMetadata?.contentType === "image/jpeg", "media: each copy carries its SHA-256, source etag and content type", JSON.stringify(c7?.customMetadata));
    let last = JSON.parse(db.prepare(`SELECT value FROM system_meta WHERE key = 'media_backup_last'`).get()?.value ?? "{}");
    ok(last.pending === 0 && last.live === 50, "media: System Health reads the last pass (nothing pending)", JSON.stringify(last));
    await MEDIA.put("staff/03/photo.jpg", "photo-3-EDITED");
    await cron("*/30 * * * *");
    ok(new TextDecoder().decode(BACKUPS._m.get("media/current/staff/03/photo.jpg")?.bytes ?? new Uint8Array()) === "photo-3-EDITED"
      && new TextDecoder().decode(BACKUPS._m.get("media/versions/2026-11-01/staff/03/photo.jpg")?.bytes ?? new Uint8Array()) === "photo-3-bytes",
      "media: a changed object is copied again and the copy it replaced is kept under versions/<day>/");

    /* ================= the nightly cron: prune, reconcile (Sunday) ================= */
    db.exec(`INSERT INTO notifications (id, user_id, kind, message, is_read, created_at) VALUES
      (9001, 5, 'task', 'old and read', 1, datetime('now', '-120 days')),
      (9002, 5, 'task', 'old and unread', 0, datetime('now', '-120 days')),
      (9003, 5, 'task', 'recent and read', 1, datetime('now', '-10 days'))`);
    await MEDIA.delete("staff/49/photo.jpg");
    await BACKUPS.put("media/versions/2026-07-20/staff/01/photo.jpg", "very old version");
    await BACKUPS.put("media/versions/2026-10-25/staff/02/photo.jpg", "recent version");
    await BACKUPS.put("media/manifests/2026-07-20-101010.json", "{}");
    fixed = NOW + 3600000; // Sun 01-11 04:20 MYT
    const auditBefore = count(`SELECT COUNT(*) AS n FROM audit_log`);
    await cron("20 19 * * *");
    ok(count(`SELECT COUNT(*) AS n FROM notifications WHERE id = 9001`) === 0 && count(`SELECT COUNT(*) AS n FROM notifications WHERE id IN (9002, 9003)`) === 2, "D-9 read notifications older than 90 days are pruned; unread and recent ones stay");
    ok(count(`SELECT COUNT(*) AS n FROM audit_log`) >= auditBefore && count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'seed.bulk'`) === 60000, "D-9 audit_log is never pruned");
    ok(!BACKUPS._m.has("media/versions/2026-07-20/staff/01/photo.jpg") && BACKUPS._m.has("media/versions/2026-10-25/staff/02/photo.jpg") && !BACKUPS._m.has("media/manifests/2026-07-20-101010.json"), "D-9 media versions and pass records older than 90 days go; recent ones stay");
    ok(!BACKUPS._m.has("media/current/staff/49/photo.jpg") && new TextDecoder().decode(BACKUPS._m.get("media/deleted/2026-11-01/staff/49/photo.jpg")?.bytes ?? new Uint8Array()) === "photo-49-bytes", "media (weekly): the copy of a deleted object moves to deleted/<day>/ - kept 90 days, not lost");
    const idx = JSON.parse(new TextDecoder().decode(BACKUPS._m.get("media/index.json")?.bytes ?? new TextEncoder().encode("{}")));
    const rec = JSON.parse(db.prepare(`SELECT value FROM system_meta WHERE key = 'media_reconcile_last'`).get()?.value ?? "{}");
    ok(idx.objects?.length === 49 && rec.live === 49 && rec.missing === 0 && rec.stale === 0 && rec.bad === 0 && rec.sampled === 20, "media (weekly): the full index is written and every live object has a matching copy (20 re-hashed)", JSON.stringify(rec));
    /* a copy damaged in the bucket is caught by the weekly re-hash */
    for (const [k, o] of BACKUPS._m) if (k.startsWith("media/current/")) o.bytes = new TextEncoder().encode("damaged");
    fixed += 7 * 86400000; // the next Sunday
    await cron("20 19 * * *");
    const rec2 = JSON.parse(db.prepare(`SELECT value FROM system_meta WHERE key = 'media_reconcile_last'`).get()?.value ?? "{}");
    ok(rec2.bad > 0 && count(`SELECT COUNT(*) AS n FROM error_log WHERE source = 'media_backup'`) >= 1, "media (weekly): a damaged copy fails its SHA-256 and is reported in the error log", JSON.stringify({ bad: rec2.bad }));

    /* ================= F5: a leaver's phones stop receiving bells ================= */
    db.exec(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES
      (6, 'https://fcm.googleapis.com/fcm/send/lia1', 'p', 'a'), (6, 'https://fcm.googleapis.com/fcm/send/lia2', 'p', 'a'),
      (10, 'https://fcm.googleapis.com/fcm/send/mira', 'p', 'a')`);
    const off = await call("/users/6/offboard", 1, "POST", { left_on: "2026-10-31", status: "resigned" });
    ok(off.status === 200 && count(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 6`) === 0, "F5 offboarding removes the leaver's push subscriptions", `${off.status} ${off.text.slice(0, 120)}`);
    const de = await call("/users/10", 8, "PATCH", { is_active: 0 });
    ok(de.status === 200 && count(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 10`) === 0, "F5 deactivating an account removes its push subscriptions", `${de.status} ${de.text.slice(0, 120)}`);

    /* ================= F2 / F9: tasks ================= */
    const t1 = await call("/staff/tasks", 1, "POST", { title: "Call the hotel", assigned_to: 5 });
    const tid = t1.j?.id ?? db.prepare(`SELECT id FROM tasks ORDER BY id DESC LIMIT 1`).get()?.id;
    const re = await call(`/staff/tasks/${tid}`, 1, "PATCH", { assigned_to: 7 });
    ok(re.status === 400, "F2 a task cannot be reassigned to somebody who has left", `${re.status} ${re.text.slice(0, 120)}`);
    ok((await call(`/staff/tasks/${tid}`, 1, "PATCH", { assigned_to: 2 })).status === 200, "F2 reassigning to a current staff member still works");
    ok((await call("/staff/tasks", 1, "POST", { title: "Impossible", assigned_to: 5, deadline: "2026-02-31" })).status === 400, "F9 a task due on 31-02 is refused");
    ok((await call(`/staff/tasks/${tid}`, 1, "PATCH", { deadline: "2026-02-30" })).status === 400, "F9 nor can a deadline be changed to 30-02");
    ok((await call("/staff/tasks", 1, "POST", { title: "Real date", assigned_to: 5, deadline: "2026-11-20" })).status < 300, "F9 a real date is accepted");
    db.exec(`INSERT INTO tasks (id, title, assigned_to, created_by, status, deadline) VALUES (801, 'Leaver overdue', 7, 1, 'open', '2026-10-20'), (802, 'Staff overdue', 5, 1, 'open', '2026-10-20')`);
    db.exec(`DELETE FROM notifications`);
    await cron("*/30 * * * *");
    ok(count(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 7`) === 0 && count(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 5 AND message LIKE '%OVERDUE%'`) === 1, "F2 the overdue sweep rings the current assignee, never the leaver", JSON.stringify(db.prepare(`SELECT user_id, message FROM notifications`).all().slice(0, 4)));

    /* ================= F10 / F11: the morning brief and birthdays ================= */
    fixed = NOW + 3600000; // back to Sunday 01-11 (MYT): Aina's and Gone's birthday
    db.exec(`DELETE FROM notifications`);
    await cron("0 0 * * *"); await cron("0 0 * * *");
    ok(count(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'brief' AND user_id = 1`) === 1, "F10 the morning brief reaches each executive once a day, however often the cron runs", String(count(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'brief' AND user_id = 1`)));
    await cron("0 1 * * *"); await cron("0 1 * * *");
    const bd = db.prepare(`SELECT user_id, message FROM notifications WHERE kind = 'birthday'`).all();
    ok(bd.some((r) => r.user_id === 1 && /Aina/.test(r.message)), "F11 a current staff member's birthday is announced", JSON.stringify(bd.slice(0, 3)));
    ok(!bd.some((r) => /Gone/.test(r.message)) && !bd.some((r) => r.user_id === 7 || r.user_id === 6), "F11 a leaver's birthday is not announced, and leavers are not told", JSON.stringify(bd.filter((r) => /Gone/.test(r.message) || r.user_id === 7 || r.user_id === 6).slice(0, 3)));
    ok(bd.filter((r) => r.user_id === 1).length === 1, "F10 a birthday bell rings once per person, however often the cron runs", String(bd.filter((r) => r.user_id === 1).length));

    /* ================= the recovery scripts on the worker's own backup ================= */
    if (loaded) {
      const rdb = new DatabaseSync(":memory:");
      const r = restoreInto(rdb, loaded);
      const a = figuresFromRows(loaded.tables), b = figuresFromDb(rdb);
      ok(r.integrity === "ok" && a.every(([, v], i) => v === b[i][1]) && a.filter(([, v]) => v !== null).length >= 10, "restore drill: the backup rebuilds a database whose 12 figures equal the backup's", JSON.stringify(a.map(([l, v], i) => [l, v, b[i][1]]).filter(([, x, y]) => x !== y)));
      const n = Number(rdb.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get().n);
      ok(n === auditN, "restore drill: every audit row is back", `${n} vs ${auditN}`);
      /* the script for a fresh D1 loads into an empty database and carries the migration ledger */
      const sdb = new DatabaseSync(":memory:");
      let loadedSql = true; try { sdb.exec(`BEGIN;\n${restoreSql(loaded)}COMMIT;`); } /* one transaction, so PRAGMA defer_foreign_keys (the D1 import way) holds the key checks to the end */ catch (e) { loadedSql = false; ok(false, "restore drill: the SQL script loads into an empty database", e.message); }
      if (loadedSql) ok(Number(sdb.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get().n) === auditN && Number(sdb.prepare(`SELECT COUNT(*) AS n FROM d1_migrations`).get().n) === 2, "restore drill: the SQL script for a fresh D1 rebuilds every row and the migration ledger");
      sdb.close();
      /* a deleted part payment comes back from reviewed statements */
      const rr = rowStatements(loaded, "invoice_payments", "id", ["41", "99"]);
      ok(rr.found === 1 && rr.missing[0] === "99" && /^INSERT INTO "invoice_payments"/m.test(rr.sql) && !/OR REPLACE/.test(rr.sql), "restore-rows: a plain INSERT for the row asked for; a missing id is named");
      rdb.exec(`DELETE FROM invoice_payments WHERE id = 41`);
      for (const st of rr.sql.split("\n").filter((l) => l.startsWith("INSERT"))) rdb.exec(st);
      ok(Number(rdb.prepare(`SELECT amount_cents FROM invoice_payments WHERE id = 41`).get()?.amount_cents) === 12345, "restore-rows: applied to a copy, the deleted payment is back to the cent");
      let threw = false; try { rdb.exec(rr.sql.split("\n").find((l) => l.startsWith("INSERT"))); } catch { threw = true; }
      ok(threw, "restore-rows: applied again, the plain INSERT fails - an existing row is never overwritten");
      rdb.close();
    }
    let refused = false; try { mediaPlan(["../etc/passwd"]); } catch { refused = true; }
    ok(refused && mediaPlan(["staff/01/photo.jpg"], "deleted/2026-11-01")[0].source === "azoneofficial-backups/media/deleted/2026-11-01/staff/01/photo.jpg", "restore-media: a key outside media is refused; a deleted copy is named by day");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
    rmSync(work, { recursive: true, force: true });
  }
  return out;
}

function sourceChecks() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
  const toml = read("worker/wrangler.toml");
  ok(/\[\[r2_buckets\]\]\nbinding = "BACKUPS"\nbucket_name = "azoneofficial-backups"/.test(toml), "D-4 the API worker binds the backups bucket azoneofficial-backups");
  const push = read("PUSH.bat");
  const iCheck = push.indexOf("release-backup.mjs check-bucket"), iExp = push.indexOf("release-backup.mjs export"), iMig = push.indexOf("d1 migrations apply azoneofficial --remote");
  ok(iCheck > 0 && iExp > iCheck && iMig > iExp && /release-backup\.mjs export %PREEXPORT_ARG%\nif errorlevel 1 goto :failedpop/.test(push), "PUSH.bat checks the bucket and takes the full SQL export BEFORE the migrations, and stops if either fails");
  ok(push.indexOf("release-backup.mjs archive-site") > push.indexOf("call pnpm build") && push.indexOf("release-backup.mjs archive-site") < push.indexOf("set SITEREFUSED=1"), "PUSH.bat keeps the built site per version before publishing it");
  ok(/^\/backups\/$/m.test(read(".gitignore")), "the release backups folder (a full export with bank details) is never committed");
  const rb = read("scripts/release-backup.mjs");
  ok(/\["d1", "export", DB, "--remote"/.test(rb) && !/execute|migrations apply|r2 object put|bucket create/.test(rb.replace(/console\.(error|log)\([^)]*\)/g, "")), "release-backup only reads production (export, bucket list) - it creates and changes nothing");
  /* the 31-10-2026 PUSH.bat stop: Node refuses `npx.cmd` without a shell on
     Windows (EINVAL), and a shell would re-read the SQL. Every release script
     runs wrangler through scripts/wrangler-exec.mjs (node + wrangler.js). */
  const scripts = readdirSync(join(root, "scripts")).filter((f) => f.endsWith(".mjs") && f !== "wrangler-exec.mjs");
  const bad = scripts.filter((f) => { const t = read(`scripts/${f}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); return /wrangler/.test(t) && /npx\.cmd|"npx"\s*,\s*\[\s*"wrangler"|shell:\s*(true|process\.platform)/.test(t); });
  ok(bad.length === 0 && ["migration-preflight.mjs", "release-backup.mjs", "restore-media.mjs"].every((f) => /from "\.\/wrangler-exec\.mjs"/.test(read(`scripts/${f}`)))
     && /spawnSync\(process\.execPath, \[wranglerBin\(\), \.\.\.args\]/.test(read("scripts/wrangler-exec.mjs")) && !/shell/.test(read("scripts/wrangler-exec.mjs").replace(/\/\*[\s\S]*?\*\//g, "")),
     `release scripts run wrangler without npx.cmd or a shell (Windows EINVAL) ${bad.join(",")}`);
  const src = readdirSync(join(root, "worker/src")).filter((f) => f.endsWith(".ts")).map((f) => read(`worker/src/${f}`)).join("\n");
  ok(!/DELETE FROM audit_log/i.test(src), "D-9 nothing in the worker deletes from audit_log");
  ok(/FROM push_subscriptions s JOIN users u ON u\.id = s\.user_id\s+WHERE s\.user_id = \?1 AND u\.is_active = 1 AND \$\{currentStaffSql\("u\."\)\}/.test(read("worker/src/staff.ts")), "F5 a push is never sent to a phone of somebody who has left or is switched off (source check)");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const NOMUT = process.env.NOMUT === "1" || !!given;
const dir = mkdtempSync(join(tmpdir(), "golive-d-"));
if (!given) bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(given ?? join(dir, "worker.mjs")));
if (!given) report(sourceChecks());
const checks = n;

const MUT = [
  ["worker/src/backup-manifest.ts", "F7 reverted: one page never closes (no paging)", "      if (pageCount >= pageRows) await flush();", ""],
  ["worker/src/index.ts", "F7 a failed run keeps its pages", "    for (const k of written) { try { await bucket.delete(k); } catch { /* the sweep removes it after two days */ } }", ""],
  ["worker/src/backup-store.ts", "D-9 retention keeps everything", "  const doomed = complete.slice(keep);", "  const doomed = complete.slice(keep * 100);"],
  ["worker/src/backup-store.ts", "media: a changed object is not copied again", "    return !c || (c.customMetadata ?? {}).src_etag !== o.etag || Number((c.customMetadata ?? {}).src_size) !== o.size;", "    return !c;"],
  ["worker/src/backup-store.ts", "media: the replaced copy is not kept", "      if (old) { await B.put(`media/versions/${day}/${o.key}`, await bodyOf(old), { httpMetadata: old.httpMetadata, customMetadata: old.customMetadata }); replaced++; }", "      if (old) replaced++;"],
  ["worker/src/index.ts", "D-9 unread notifications pruned too", "WHERE is_read = 1 AND created_at < datetime('now', '-90 days')", "WHERE created_at < datetime('now', '-90 days')"],
  ["worker/src/index.ts", "F5 offboarding keeps the push subscriptions", "    try { pushRemoved = (await env.DB.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?1`).bind(idOb).run()).meta?.changes ?? 0; } catch { /* pre-0068 */ }", ""],
  ["worker/src/staff.ts", "F2 a leaver can be given a task again", "      if (!nu || !nu.is_active || !nu.on_staff || [", "      if (!nu || !nu.is_active || ["],
  ["worker/src/index.ts", "F11 a leaver's birthday is announced", "           AND substr(birthday, 6, 5) = ?1 AND ${staffRolesSql()} AND ${currentStaffSql()}`,", "           AND substr(birthday, 6, 5) = ?1 AND ${staffRolesSql()}`,"],
  ["worker/src/watchers.ts", "F10 the brief rings twice", "`brief:${day}`, { once: true })", "`brief:${day}`)"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-d-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${res.filter(([p]) => !p).slice(0, 2).map(([, m]) => m.split(" - ")[0]).join("; ")}`);
}
if (fail) { console.error(`go-live-d: ${fail} of ${n} failed${given ? ` (bundle: ${given})` : ""}`); process.exit(1); }
console.log(`go-live-d: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - paged backups with no cap, verified and downloadable as one file, kept 30 nights in their own bucket; media copied, versioned, reconciled weekly, kept 90 days; audit never pruned; leavers lose their bells and are given no tasks; briefs and birthdays once; the restore scripts rebuild what was backed up`);

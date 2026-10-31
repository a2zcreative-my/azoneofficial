/* RELEASE A OF THE GO-LIVE PLAN (v1.241.0) - runtime guard: the WHOLE worker
 * (index.ts, bundled) against SQLite with every migration applied, by direct
 * request and by a scheduled tick.
 *
 * claude/GO-LIVE-AUDIT.md and claude/FINAL-RELEASE-GATE-PLAN-V2.md, Release A
 * (the owner's "Approved", 31-10-2026). The three worker defects it fixes:
 *
 *   F1  GET /tasks/:id/items never bound the task id - every checklist read
 *       empty, so ticking (the progress report) was impossible.
 *   B9  docNumber() upserted the day counter and then read it in a second
 *       statement - two documents raised in the same second could share a
 *       number and the second INSERT failed on the UNIQUE doc_number (a 500).
 *       Now one statement with RETURNING.
 *   F4  one throw inside the TikTok sync aborted the rest of the 30-minute
 *       chain (task sweeps, low-stock sweep, housekeeping). Now caught and
 *       logged like the other steps.
 *
 * The SQLite shim here YIELDS before every statement (and pauses 25 ms on the
 * day-counter statements), so two requests in flight interleave the way two
 * D1 round trips do - that is what makes the B9 race reproducible on one
 * thread, every run.
 *
 *   node tests/go-live-a.mjs                              the current worker, then mutations
 *   WORKER_BUNDLE=/path/worker.mjs node tests/go-live-a.mjs   a given bundle (the "before" evidence must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const tick = () => new Promise((r) => setTimeout(r, 0));
/* the day counter's statements take a visible moment, so two requests that
   reach docNumber() within 25 ms of each other overlap there - the window
   two D1 round trips leave in production, made deterministic here */
const slow = () => new Promise((r) => setTimeout(r, 25));

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  /* F4: a D1 error inside the sync - every read of the TikTok token table throws */
  let breakTikTok = false;
  const shim = (sql) => {
    const st = db.prepare(sql); let b = [];
    const wait = /doc_counters_daily/.test(sql) ? slow : tick;
    const guard = () => { if (breakTikTok && /integration_tokens/.test(sql)) throw new Error("D1_ERROR: integration_tokens is unavailable (injected)"); };
    const o = {
      bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
      first: async () => { await wait(); guard(); return st.get(...b) ?? null; },
      all: async () => { await wait(); guard(); return { results: st.all(...b) }; },
      run: async () => { await wait(); guard(); return { meta: { changes: Number(st.run(...b).changes) } }; },
      _run: () => st.run(...b),
    };
    return o;
  };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    TIKTOK_APP_KEY: "k", TIKTOK_APP_SECRET: "s",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, department, employment_status, joined_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'Management','permanent','2020-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'Sales','permanent','2020-01-01'),
    (7,'Lia','Lia Host','lia@a2z.test','live_host',1,'x',1,'Live','permanent','2020-01-01')`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',5)`);
  db.exec(`INSERT INTO tasks (id, title, assigned_to, created_by, deadline, status, created_at) VALUES
    (31,'Prepare the launch kit',5,1,'${yesterday}','open',datetime('now','-2 days')),
    (32,'Somebody else''s task',7,1,NULL,'open',datetime('now','-2 days'))`);
  db.exec(`INSERT INTO task_items (task_id, title, done, sort) VALUES (31,'Brief',1,1),(31,'Design',0,2),(31,'Print',0,3),(32,'Other',0,1)`);

  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 5, 7]) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };

  try {
    /* F1 - the checklist reads its own task's items */
    let r = await call("/staff/tasks/31/items", 5);
    ok(r.status === 200 && Array.isArray(r.j?.items) && r.j.items.length === 3, "F1 the assignee reads the task's three checklist items", `${r.status} ${r.text.slice(0, 160)}`);
    ok(r.j?.items?.every((i) => ["Brief", "Design", "Print"].includes(i.title)) && !r.j?.items?.some((i) => i.title === "Other"), "F1 only this task's items, never another task's", r.text.slice(0, 160));
    r = await call("/staff/tasks/31/items", 1);
    ok(r.status === 200 && r.j?.items?.length === 3, "F1 the person who set the task reads them too");
    r = await call("/staff/tasks/31/items", 7);
    ok(r.status === 403, "F1 somebody else is still refused (403)", String(r.status));

    /* B9 - two documents in the same second get two numbers */
    const mk = () => call("/staff/docs", 1, "POST", { doc_type: "QT", customer_id: 1, kind: "service", items: [{ name: "Design retainer", qty: 1, unit_price_cents: 150000 }] });
    const [a, b] = await Promise.all([mk(), mk()]);
    ok([a.status, b.status].every((s) => s === 200 || s === 201), "B9 both quotations raised in the same second are created", `${a.status} ${a.text.slice(0, 120)} | ${b.status} ${b.text.slice(0, 120)}`);
    const nums = db.prepare(`SELECT doc_number FROM sales_documents WHERE doc_type = 'QT' ORDER BY id`).all().map((x) => x.doc_number);
    ok(nums.length === 2 && nums[0] !== nums[1], "B9 the two numbers differ", JSON.stringify(nums));
    ok(nums.every((n) => /^QT-AZOO\d{6}-\d+$/.test(n)) && nums.map((n) => Number(n.split("-").pop())).sort().join() === "1,2", "B9 the numbers are the day's 1 and 2, the format unchanged", JSON.stringify(nums));
    const [c, d, e] = await Promise.all([mk(), mk(), mk()]);
    ok([c, d, e].every((x) => x.status === 200 || x.status === 201) && db.prepare(`SELECT COUNT(DISTINCT doc_number) AS n, COUNT(*) AS t FROM sales_documents`).get().n === 5, "B9 three more at once: five documents, five numbers");

    /* F4 - a throw inside the TikTok sync does not stop the task sweep behind it */
    breakTikTok = true;
    let threw = null;
    try { await worker.scheduled({ cron: "*/30 * * * *", scheduledTime: Date.now(), noRetry() {} }, env, { waitUntil() {}, passThroughOnException() {} }); } catch (err) { threw = err; }
    breakTikTok = false;
    ok(threw === null, "F4 the 30-minute tick completes although the TikTok sync threw", String(threw).slice(0, 160));
    const od = db.prepare(`SELECT COUNT(*) AS n FROM task_events WHERE task_id = 31 AND kind = 'overdue_alert' AND on_date = ?1`).get(today).n;
    ok(od === 1, "F4 the overdue-task sweep after the sync still ran", `overdue_alert rows: ${od}`);
    const logged = db.prepare(`SELECT message FROM error_log WHERE source = 'tiktok_cron' ORDER BY id DESC LIMIT 1`).get();
    ok(!!logged && /threw: .*integration_tokens/.test(logged.message), "F4 the throw is in the error log under tiktok_cron", JSON.stringify(logged));
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const NOMUT = process.env.NOMUT === "1" || !!given;
const dir = mkdtempSync(join(tmpdir(), "golive-a-"));
if (!given) bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(given ?? join(dir, "worker.mjs")));
const checks = n;

const MUT = [
  ["worker/src/staff.ts", "F1 reverted: the id is not bound", "      ).bind(Number(taskItems[1])).all(); // v1.241.0 (go-live audit F1)", "      ).all(); // v1.241.0 (go-live audit F1)"],
  ["worker/src/staff.ts", "B9 reverted: upsert, then a second read", "  const row = await env.DB.prepare(\n    `INSERT INTO doc_counters_daily (doc_type, day, counter) VALUES (?1, ?2, 1)\n     ON CONFLICT(doc_type, day) DO UPDATE SET counter = counter + 1\n     RETURNING counter`,\n  ).bind(docType, day).first<{ counter: number }>();", "  await env.DB.prepare(\n    `INSERT INTO doc_counters_daily (doc_type, day, counter) VALUES (?1, ?2, 1)\n     ON CONFLICT(doc_type, day) DO UPDATE SET counter = counter + 1`,\n  ).bind(docType, day).run();\n  const row = await env.DB.prepare(`SELECT counter FROM doc_counters_daily WHERE doc_type = ?1 AND day = ?2`).bind(docType, day).first<{ counter: number }>();"],
  ["worker/src/index.ts", "F4 reverted: the sync's throw is not caught", "    } catch (e) {\n      await logError(env, \"tiktok_cron\", `threw: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});\n    }", "    } catch (e) {\n      throw e;\n    }"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-a-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${res.filter(([p]) => !p).map(([, m]) => m.split(" - ")[0]).join("; ")}`);
}
if (fail) { console.error(`go-live-a: ${fail} of ${n} failed${given ? ` (bundle: ${given})` : ""}`); process.exit(1); }
console.log(`go-live-a: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - F1 the checklist reads its task, B9 two documents in one second get two numbers, F4 a TikTok throw leaves the 30-minute chain running`);

#!/usr/bin/env node
/* Guard - v1.217.0: ONE ANNOUNCEMENT RECORD. ACCURATE ACKNOWLEDGEMENT
 * HISTORY. ROLE-BASED VISIBILITY. NO DUPLICATION.
 *
 * The owner's News & Announcements 2.0 brief (28-10-2026) and his answers to
 * claude/NEWS-ANNOUNCEMENTS-AUDIT.md: the memo fix (0146), the publisher
 * from the login, new joiners asked only for posts since they joined, and
 * important / pinned, department targeting, edit with versions and
 * attachments. This guard RUNS worker/src/news.ts (through staff.ts) against
 * SQLite built from every migration, and reads the screen:
 *
 *   1. THE MEMO SAVES, and 0146 keeps every post, id and acknowledgement.
 *   2. ONE ACKNOWLEDGEMENT per person per version, timed by the server, for
 *      the person signed in; a second press stores nothing; acknowledging a
 *      version you were not shown is refused.
 *   3. AN EDIT OF THE WORDS IS A NEW VERSION: the old text is kept, the old
 *      acknowledgement stays tied to it, and the post waits again. A pin or
 *      a chip is not a new version.
 *   4. WHO SEES WHAT: a department post is not shown to (or required of)
 *      another department; management sees all; a post from before you
 *      joined does not wait on you; the publisher is never asked.
 *   5. THE PUBLISHER IS THE LOGIN: a "from" in the request is ignored.
 *   6. ONLY MANAGEMENT publishes, edits, attaches and reads who acknowledged.
 *   7. THE SCREEN acknowledges only from the button, sends the version it
 *      showed, renders bodies as text, and uses no sample content.
 *
 * Negative-tested by: the old (post, person) key back (2); dropping the
 * version check on ack (2); an edit that does not snapshot (3); the feed
 * without the audience filter (4); dropping the joined-on rule (4); the
 * client's "from" stored (5); publishing without team_manage (6); an ack on
 * opening the drawer (7).
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const news = strip(read("worker/src/news.ts"));
const screen = read("components/portal/announcements.tsx");
const screenCode = strip(screen);
const mig = read("worker/migrations/0146_announcements_v2.sql").replace(/^--.*$/gm, "");

/* ---- static: the source says what the run below proves ---- */
ok("0146 allows memo and keys acknowledgements by version", /CHECK \(category IN \('news','meeting','holiday','kpi','training','memo'\)\)/.test(mig)
   && /PRIMARY KEY \(announcement_id, user_id, version\)/.test(mig) && /INSERT INTO announcements_new \(id, title, body, category, created_by, created_at\)\s*SELECT id, title, body, category, created_by, created_at FROM announcements;/.test(mig)
   && /INSERT INTO announcement_acks_new \(announcement_id, user_id, version, acked_at\)\s*SELECT announcement_id, user_id, 1, acked_at FROM announcement_acks;/.test(mig));
ok("0146 is registered and probed", /"0146_announcements_v2",/.test(read("worker/src/index.ts")) && /\["0146 \(news 2\.0/.test(read("worker/src/index.ts")));
ok("the acknowledgement is the session's person and the server's clock", /VALUES \(\?1, \?2, \?3\)\s*ON CONFLICT\(announcement_id, user_id, version\) DO NOTHING`,\s*\)\.bind\(post\.id, user\.id, post\.version\)/.test(news) && !/acked_at\s*[,)][^`]*VALUES[^`]*\?4/.test(news));
ok("the publisher is the login, never the request", /const from = await publisherLine\(env, user\);/.test(news) && !/body\.from|body\?\.from/.test(news));
ok("management only for publish, edit, attach, remove and the reports",
   (news.match(/if \(!can\(user\.role, "team_manage"\)\) return err\("forbidden"/g) ?? []).length === 6);
ok("staff.ts hands every /announcements route to news.ts and keeps none of its own",
   /const newsRes = await handleNews\(env, request, path, method, body, user, notify\);/.test(read("worker/src/staff.ts"))
   && !/INSERT INTO announcements|INSERT INTO announcement_acks/.test(strip(read("worker/src/staff.ts"))));
ok("the Desk asks with the same rules", /\$\{annRequiredSql\("a", "\?1", "\?2", "\?3"\)\}\s*AND NOT \$\{annAckedSql\("a", "\?1"\)\}/.test(read("worker/src/desk.ts")));

/* ---- the run ---- */
try {
  const dir = mkdtempSync(join(tmpdir(), "news-"));
  const out = join(dir, "staff.mjs");
  execSync(`npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const db = new DatabaseSync(":memory:");
  const migs = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort();
  const apply = (f) => { for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } } };
  for (const f of migs.filter((x) => x < "0146")) apply(f);
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, department, joined_on) VALUES
    (1,'Boss','b@x.t','ceo',1,'x','Management','2024-01-01'),(2,'Ani','a@x.t','sales_marketing',1,'x','Sales','2024-01-01'),
    (3,'Hadi','h@x.t','live_host',1,'x','Live','2024-01-01'),(4,'Nora','n@x.t','sales_marketing',1,'x','Sales','2026-10-20'),
    (5,'Cust','c@x.t','customer',1,'x',NULL,NULL)`);
  db.exec(`INSERT INTO announcements (id, title, body, category, created_by, created_at) VALUES (7,'Old','Old body','news',1,'2026-10-01 02:00:00')`);
  db.exec(`INSERT INTO announcement_acks (announcement_id, user_id, acked_at) VALUES (7,2,'2026-10-02 03:00:00')`);
  apply(migs.find((x) => x.startsWith("0146")));
  ok("0146 kept the old post, its id and its acknowledgement as version 1",
     db.prepare(`SELECT id, title, version FROM announcements WHERE id = 7`).get()?.version === 1
     && db.prepare(`SELECT acked_at FROM announcement_acks WHERE announcement_id = 7 AND user_id = 2 AND version = 1`).get()?.acked_at === "2026-10-02 03:00:00");
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const bucket = new Map();
  const env = { DB: { prepare: shim }, MEDIA: {
    put: async (k, v) => { bucket.set(k, v); }, head: async (k) => (bucket.has(k) ? { size: 3 } : null),
    get: async (k) => (bucket.has(k) ? { body: "pdf" } : null), delete: async (k) => { bucket.delete(k); } } };
  const { handleStaff } = await import(pathToFileURL(out).href);
  const call = async (method, p, who, body) => {
    const init = { method, headers: { "content-type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, init), env, p.split("?")[0], who);
    return { status: r?.status ?? 0, j: r ? await r.json().catch(() => ({})) : {} };
  };
  const boss = { id: 1, role: "ceo", name: "Boss" }, ani = { id: 2, role: "sales_marketing", name: "Ani" },
    hadi = { id: 3, role: "live_host", name: "Hadi" }, nora = { id: 4, role: "sales_marketing", name: "Nora" };
  const memo = await call("POST", "/announcements", boss, { title: "Waktu balik", body: "* 6 petang", category: "memo", to: "Semua pekerja", memo_date: "28 Oktober 2026", from: "Someone Else" });
  ok("a memo is published", memo.status === 201 && memo.j.id > 7, JSON.stringify(memo));
  const row = db.prepare(`SELECT from_name, created_by, category FROM announcements WHERE id = ?`).get(memo.j.id);
  ok("...signed by the login, not the request's from", row?.from_name === "Boss" && row.created_by === 1 && row.category === "memo", JSON.stringify(row));
  ok("staff cannot publish", (await call("POST", "/announcements", ani, { title: "x", body: "y", category: "news" })).status === 403);
  const sales = await call("POST", "/announcements", boss, { title: "Sales only", body: "Targets", category: "kpi", audience: ["Sales"], important: true, pinned: true });
  ok("a department post", sales.status === 201 && sales.j.recipients === 2, JSON.stringify(sales.j));
  const feedHadi = (await call("GET", "/announcements", hadi)).j.announcements ?? [];
  ok("another department does not see it", !feedHadi.some((a) => a.id === sales.j.id) && feedHadi.some((a) => a.id === memo.j.id));
  const feedAni = (await call("GET", "/announcements", ani)).j.announcements ?? [];
  const sAni = feedAni.find((a) => a.id === sales.j.id);
  ok("its department sees it pinned first, important, with the publisher", feedAni[0]?.id === sales.j.id && sAni?.important === 1 && sAni?.required === 1 && sAni?.publisher_name === "Boss");
  ok("management sees every post", (await call("GET", "/announcements", boss)).j.announcements.length === 3);
  ok("the publisher is not asked", (await call("GET", "/announcements", boss)).j.announcements.every((a) => a.required === 0));
  const feedNora = (await call("GET", "/announcements", nora)).j.announcements ?? [];
  ok("a post from before you joined does not wait on you", feedNora.find((a) => a.id === 7)?.required === 0 && feedNora.find((a) => a.id === sales.j.id)?.required === 1);
  ok("a person outside the audience cannot acknowledge it", (await call("POST", `/announcements/${sales.j.id}/ack`, hadi, { version: 1 })).status === 404);
  const a1 = await call("POST", `/announcements/${sales.j.id}/ack`, ani, { version: 1 });
  const a2 = await call("POST", `/announcements/${sales.j.id}/ack`, ani, { version: 1 });
  ok("one acknowledgement, however often it is pressed", a1.status === 200 && a2.status === 200
     && db.prepare(`SELECT COUNT(*) AS n FROM announcement_acks WHERE announcement_id = ? AND user_id = 2`).get(sales.j.id).n === 1 && /^\d{4}-\d{2}-\d{2} /.test(a1.j.acked_at ?? ""));
  ok("an edit needs the version the editor saw", (await call("PATCH", `/announcements/${sales.j.id}`, boss, { version: 9, body: "x" })).status === 409);
  const pin = await call("PATCH", `/announcements/${sales.j.id}`, boss, { version: 1, pinned: false });
  ok("unpinning is not a new version", pin.j.version === 1);
  const ed = await call("PATCH", `/announcements/${sales.j.id}`, boss, { version: 1, body: "Targets, revised" });
  ok("changing the words is version 2, and the old text is kept", ed.j.version === 2
     && db.prepare(`SELECT body FROM announcement_versions WHERE announcement_id = ? AND version = 1`).get(sales.j.id)?.body === "Targets");
  const after = ((await call("GET", "/announcements", ani)).j.announcements ?? []).find((a) => a.id === sales.j.id);
  ok("...it waits again, and the version-1 acknowledgement is still on record", after?.acked === 0 && after?.my_last_version === 1);
  ok("acknowledging the old version is refused", (await call("POST", `/announcements/${sales.j.id}/ack`, ani, { version: 1 })).status === 409);
  ok("staff cannot edit", (await call("PATCH", `/announcements/${sales.j.id}`, ani, { version: 2, body: "z" })).status === 403);
  const rep = await call("GET", `/announcements/${sales.j.id}/acks`, boss);
  ok("who has acknowledged: the recipients, by version", rep.j.total === 2 && rep.j.acknowledged === 0 && rep.j.recipients.find((r) => r.id === 2)?.last_version === 1, JSON.stringify(rep.j));
  ok("staff cannot read who acknowledged", (await call("GET", `/announcements/${sales.j.id}/acks`, ani)).status === 403);
  ok("the report counts each post", ((await call("GET", "/announcements/report", boss)).j.posts ?? []).find((p) => p.id === memo.j.id)?.recipients === 3);
  globalThis.__x = 1;
} catch (e) {
  ok("news routes run against SQLite", false, String(e).slice(0, 400));
}

/* ---- 7: the screen ---- */
ok("acknowledging is the button's, and sends the version shown",
   /api<[^>]*>\(`\/staff\/announcements\/\$\{a\.id\}\/ack`, \{ method: "POST", body: JSON\.stringify\(\{ version: a\.version \}\) \}\)/.test(screenCode)
   && (screenCode.match(/\/ack`/g) ?? []).length === 1);
ok("opening a post does not acknowledge it: the one call is the drawer's button",
   (screenCode.match(/\back\(/g) ?? []).length === 1 && /disabled=\{busy\} onClick=\{\(\) => void ack\(\)\}>\{busy \? L\("Saving…", "Menyimpan…"\) : L\("I have read this - acknowledge"/.test(screenCode));
ok("bodies are text, never HTML", !/dangerouslySetInnerHTML/.test(screenCode));
ok("no sample content from the reference", !/Office Relocation|Menara XYZ|Workplace Safety Reminder|Q4 Sales Target|152 views/.test(screen));
ok("the guard is registered", /\["news-acks", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }

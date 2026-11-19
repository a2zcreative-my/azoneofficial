#!/usr/bin/env node
/**
 * Guard: FORGOT PASSWORD BY EMAIL, FOR STAFF (19-11-2026, the CEO: "my staff should be able to
 * forgot password using email which is there is a template use globally in this OS").
 *
 * Runs the real worker (esbuild bundle) on every migration, in node:sqlite, with a stub
 * Cloudflare email binding that records what was sent. It holds:
 *   1. a working staff account gets ONE email, subject "A2Z OS: reset your password", drawn in
 *      the one A2Z OS frame (mail.ts osMailHtml: navy header, gold "Set My Password" button);
 *   2. the link is the existing single-use set-password token, one hour, hash only stored;
 *   3. the answer is byte-for-byte the same for an unknown address, a customer, an agent, a
 *      leaver and a disabled account - and none of them is emailed;
 *   4. at most 3 emails per account per hour (the rest dropped silently), 5 asks per IP per
 *      15 minutes (then 429);
 *   5. a newer link replaces the older one; using it sets the password, signs every device
 *      out, and works once;
 *   6. the request is audited (auth.password_reset_requested), never with the token.
 */
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = [];
const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
const sha = (s) => createHash("sha256").update(s).digest("hex");

const bundlePath = process.env.WORKER_BUNDLE || join(tmpdir(), `forgot-password-${process.pid}.mjs`);
if (!process.env.WORKER_BUNDLE) {
  const entry = join(root, "forgot-password-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${bundlePath}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
}

const db = new DatabaseSync(":memory:");
const migDir = join(root, "worker", "migrations");
for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
  let buf = "";
  for (const st of readFileSync(join(migDir, f), "utf8").split(/;\s*\n/)) {
    buf = buf ? `${buf};\n${st}` : st;
    if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
    try { db.exec(buf); } catch { /* an older statement a later one replaces */ }
    buf = "";
  }
}
const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
  bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
  first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
  run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
const sent = [];
const env = {
  DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
  SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
  MAIL_FROM: "A2Z Creative Marketing <hello@a2z.test>",
  EMAIL: { send: async (m) => { sent.push(m); return {}; } },
};

db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, employment_status, joined_on) VALUES
  (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'permanent','2024-01-01'),
  (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'permanent','2024-01-01'),
  (20,'Cust','Customer One','cust@a2z.test','customer',1,'x',0,'permanent',NULL),
  (21,'Agen','Agent One','agent@a2z.test','agent',1,'x',0,'permanent',NULL),
  (22,'Left','Leaver One','left@a2z.test','editor',1,'x',1,'resigned','2024-01-01'),
  (23,'Off','Disabled One','off@a2z.test','editor',0,'x',1,'permanent','2024-01-01')`);
db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 5, datetime('now', '+12 hours'), datetime('now'))`).run(sha("aina-session"));

const app = (await import(pathToFileURL(bundlePath).href + `?v=${Math.random()}`)).default;
const post = async (path, body, ip) => {
  const r = await app.fetch(new Request(`https://api.a2z.test/api/v1${path}`, {
    method: "POST",
    headers: { origin: "https://portal.a2z.test", cookie: "csrf_token=c1", "x-csrf-token": "c1", "content-type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  }), env, { waitUntil() {} });
  return { status: r.status, text: await r.text() };
};
const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);

try {
  /* 1 + 2 - a working staff member */
  const a = await post("/auth/forgot-password", { email: "  Aina@A2Z.test " }, "10.0.0.1");
  ok(a.status === 200 && JSON.parse(a.text).ok === true, "a staff member's request is answered ok", a.text);
  ok(sent.length === 1 && sent[0].to === "aina@a2z.test", "one email, to the account's own address", JSON.stringify(sent.map((m) => m.to)));
  const m = sent[0] ?? { subject: "", text: "", html: "" };
  ok(m.subject === "A2Z OS: reset your password", "the subject names A2Z OS (the one OS frame)", m.subject);
  ok(/A2Z <span style="color:#c8a96a">OS<\/span>/.test(m.html ?? "") && /Set My Password →<\/a>/.test(m.html ?? "") && /This is an automated email from A2Z OS/.test(m.html ?? ""),
    "the email is drawn in the global A2Z OS template (navy header, gold button, footer)");
  ok(/Hello Aina Seller,/.test(m.text) && /works once, for 1 hour/.test(m.text) && /authenticator code is still asked/.test(m.text), "it greets by name, says one hour and that 2FA stays", m.text.slice(0, 200));
  const tok = (m.text.match(/\/set-password#token=([0-9a-f]{64})/) ?? [])[1];
  ok(tok && /^https:\/\/portal\.a2z\.test\/set-password#token=/.test(m.text.match(/https:\S+/)?.[0] ?? ""), "the link is the portal's own set-password page, token in the fragment");
  const row = db.prepare(`SELECT token_hash, created_by, (julianday(expires_at) - julianday('now')) * 24 AS hours FROM account_tokens WHERE user_id = 5 AND kind = 'set_password' AND used_at IS NULL`).get();
  ok(row && row.token_hash === sha(tok ?? "") && row.created_by === 5 && row.hours > 0.95 && row.hours <= 1.01, "only the hash is stored, asked by the person, one hour", JSON.stringify(row));
  ok(!/[0-9a-f]{64}/.test(String(db.prepare(`SELECT detail FROM audit_log WHERE action = 'auth.password_reset_requested'`).get()?.detail ?? "")) && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.password_reset_requested' AND entity_id = '5'`) === 1,
    "the request is audited, without the token");

  /* 3 - every other address answers the same, and nobody is emailed */
  const same = [];
  for (const [e, ip] of [["nobody@a2z.test", "10.0.1.1"], ["cust@a2z.test", "10.0.1.2"], ["agent@a2z.test", "10.0.1.3"], ["left@a2z.test", "10.0.1.4"], ["off@a2z.test", "10.0.1.5"]]) {
    const r = await post("/auth/forgot-password", { email: e }, ip);
    same.push(r.status === a.status && r.text === a.text);
  }
  ok(same.every(Boolean), "unknown, customer, agent, leaver and disabled get the very same answer", JSON.stringify(same));
  ok(sent.length === 1, "and none of them is emailed", JSON.stringify(sent.map((x) => x.to)));
  ok((await post("/auth/forgot-password", { email: "not-an-email" }, "10.0.2.1")).status === 400, "a malformed email is refused");

  /* 5 - a newer link replaces the older one */
  await post("/auth/forgot-password", { email: "aina@a2z.test" }, "10.0.3.1");
  const tok2 = (sent[1]?.text.match(/token=([0-9a-f]{64})/) ?? [])[1];
  ok(sent.length === 2 && tok2 && tok2 !== tok, "a second request sends a new link");
  ok((await post("/auth/set-password", { token: tok, password: "NewPassword123" }, "10.0.4.1")).status === 400, "the older link no longer works");

  /* 4 - per account: 3 an hour, then silently nothing */
  await post("/auth/forgot-password", { email: "aina@a2z.test" }, "10.0.3.2");
  const fourth = await post("/auth/forgot-password", { email: "aina@a2z.test" }, "10.0.3.3");
  ok(sent.length === 3 && fourth.status === 200 && fourth.text === a.text, "the 4th request in an hour sends nothing and still answers the same", String(sent.length));
  /* per IP: 5 in 15 minutes, then 429 */
  const st = [];
  for (let i = 0; i < 6; i++) st.push((await post("/auth/forgot-password", { email: `x${i}@a2z.test` }, "10.0.9.9")).status);
  ok(st.slice(0, 5).every((s) => s === 200) && st[5] === 429, "a 6th ask from one IP in 15 minutes is refused", st.join(","));

  /* 5 - using the newest link */
  const tok3 = (sent[2]?.text.match(/token=([0-9a-f]{64})/) ?? [])[1];
  const use = await post("/auth/set-password", { token: tok3, password: "NewPassword123" }, "10.0.5.1");
  ok(use.status === 200, "the newest link sets the password", use.text);
  ok(db.prepare(`SELECT password_hash FROM users WHERE id = 5`).get().password_hash !== "x" && n(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 5`) === 0, "the password changed and every device is signed out");
  ok((await post("/auth/set-password", { token: tok3, password: "Another12345" }, "10.0.5.2")).status === 400, "the link works once");
} finally {
  if (!process.env.WORKER_BUNDLE) rmSync(bundlePath, { force: true });
}

const bad = out.filter(([p]) => !p);
for (const [p, msg] of out) console.log(`  ${p ? "✓" : "✗"} ${msg}`);
if (bad.length) { console.error(`\n${bad.length} forgot-password check(s) failed.`); process.exit(1); }
console.log(`\nforgot-password: ${out.length} checks passed.`);

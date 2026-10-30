#!/usr/bin/env node
/* Guard - v1.220.0: PROFILE 2.0. ONE EMPLOYEE IDENTITY, ONE AUTHENTICATION
 * SOURCE, ONE AUTHORITATIVE PAYROLL RECORD.
 *
 * The owner's answers to the Profile audit (claude/PROFILE-AUDIT.md,
 * 28-10-2026): "Phone only, name locked"; "Re-auth to turn 2FA on" and "Sign
 * out all devices button"; "Button notifies HR and CEO"; "History + slip
 * figures". This guard RUNS the worker against SQLite with every migration:
 *
 *   1. MY RECORD ONLY. GET /staff/profile, /payroll/self and
 *      /payroll/self/months read the session user; no id can be passed.
 *   2. PHONE ONLY. PATCH /staff/profile changes the phone (a real number,
 *      7-15 digits, audited with before and after) and refuses the name and
 *      every protected field.
 *   3. RELEASE RULE. A month before its release moment is listed as closed,
 *      with no figure, and /payroll/self answers it locked; a released month
 *      opens. A month that is not YYYY-MM is refused.
 *   4. A REQUEST, NOT AN EDIT. The update request rings active HR admins and
 *      the CEO (not the sender), opens the person on the Staff tab, writes
 *      nothing to the record, and is limited to three a day.
 *   5. RE-AUTH BEFORE A FACTOR IS ADDED. /auth/2fa/setup refuses without the
 *      current password (a Google-only account: a sign-in in the last ten
 *      minutes); /disable and /change-password keep needing the password.
 *   6. THE SCREEN computes no pay: My Payslips shows payslipData(), the same
 *      figures Print and the PDF use; Profile edits only the phone.
 *
 * Negative-tested by: accepting `name` again (2); a month list that ignores
 * the release (3); notifying everyone (4); setup without the password (5);
 * the old summary sum back in MyPayslip (6).
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const between = (s, a, b) => { const i = s.indexOf(a); return i < 0 ? "" : s.slice(i, s.indexOf(b, i + a.length)); };

const staff = strip(read("worker/src/staff.ts"));
const idx = strip(read("worker/src/index.ts"));
const prof = strip(read("components/portal/profile.tsx"));
const pay = strip(read("components/portal/payroll-panel.tsx"));

/* ---- static ---- */
const getProfile = between(staff, 'if (path === "/profile" && method === "GET") {', 'if (path === "/profile" && method === "PATCH") {');
ok("GET /profile reads the session user only", /FROM users WHERE id = \?1`,\s*\)\.bind\(user\.id\)/.test(getProfile) && !/searchParams|body\?/.test(getProfile));
const months = between(staff, 'if (path === "/payroll/self/months" && method === "GET") {', 'if (path === "/payroll/self" && method === "GET") {');
ok("the month list sends no figure and reads the session user", /SELECT month FROM payroll_entries WHERE user_id = \?1/.test(months) && /\.bind\(user\.id\)/.test(months) && !/cents|payslipExtras/.test(months));
ok("the month list uses the release rule of /payroll/self", /released\.has\(r\.month\) \|\| nowMyt >= availableFrom/.test(months) && /await payslipAvailableFrom\(r\.month\)/.test(months));
const setup = between(idx, 'if (path === "/api/v1/auth/2fa/setup" && method === "POST") {', 'if (path === "/api/v1/auth/2fa/enable" && method === "POST") {');
ok("2FA setup re-authenticates before any secret is made", setup.indexOf("twoFactorReauth(") > 0 && setup.indexOf("twoFactorReauth(") < setup.indexOf("randomSecret()"));
const reauth = between(idx, "async function twoFactorReauth(", "async function createSession(");
ok("re-auth: the password (rate-limited), or a Google sign-in within ten minutes", /checkRateLimit\(env, `2fa-reauth:\$\{userId\}`, 10, 900\)/.test(reauth) && /verifyPassword\(body\.password as string, row\.password_hash, env\.SESSION_PEPPER\)/.test(reauth) && /created_at >= datetime\('now', '-10 minutes'\)/.test(reauth));
ok("disable and change-password still need the password", /\/api\/v1\/auth\/2fa\/disable[\s\S]{0,900}verifyPassword\(body\.password as string, row\.password_hash/.test(idx) && /\/api\/v1\/auth\/change-password[\s\S]{0,1600}verifyPassword\(body\.current_password as string/.test(idx));
ok("nothing logs a password, code or secret", !/audit\([^)]*(password|totp_secret|backup)/i.test(reauth + setup));
ok("My Payslips shows payslipData(), and sums nothing itself", /const D = shown\?\.entry \? payslipData\(shown\.entry, shown\.entry, shown\.month, shown\.extras, shown\.issuer\) : null;/.test(pay) && !/entry\.basic_cents \+ \(extras\?\.ph_worked_cents/.test(pay));
ok("Profile edits only the phone", /JSON\.stringify\(\{ phone \}\)/.test(prof) && !/JSON\.stringify\(\{[^}]*\bname\b/.test(prof));
/* v1.226.0 - the same route, through signOutRequest, which also sends this
   device's push address so the server unbinds it (Shift Reminders brief) */
ok("sign out of all devices uses the existing route", /await signOutRequest\(\{ all: true \}\);/.test(prof)
   && /api\("\/auth\/logout", \{\s*method: "POST",\s*body: JSON\.stringify\(\{ \.\.\.\(opts\.all \? \{ all: true \} : \{\}\)/.test(read("lib/push-client.ts")));
ok("three tabs", ['L("My Profile", "Profil Saya")', 'L("Security & Account", "Keselamatan & Akaun")', 'L("My Payslips", "Slip Gaji Saya")'].every((t) => read("components/portal/profile.tsx").includes(t)));

/* ---- runtime ---- */
try {
  const dir = mkdtempSync(join(tmpdir(), "profile-"));
  const out = join(dir, "worker.mjs");
  execSync(`npx esbuild "${join(root, "worker/src/index.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const env = { DB: { prepare: shim, batch: async () => [] }, SESSION_PEPPER: "pepper-for-tests", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://x", MEDIA: { get: async () => null } };
  const mod = await import(pathToFileURL(out).href);
  const worker = mod.default;
  const hash = await mod.createPasswordHash("Correct-horse-1", env.SESSION_PEPPER);
  db.prepare(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, employee_id, position, department, phone, employment_status, joined_on) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(1, "Ani", "Nur Ani binti Ali", "ani@a2z.test", "sales_marketing", 1, hash, "A2Z007", "Sales Consultant", "Sales", "012-3456789", "permanent", "2026-01-05");
  db.prepare(`INSERT INTO users (id, name, email, role, is_active, password_hash) VALUES (2,'Boss','boss@a2z.test','ceo',1,?),(3,'Hana','hana@a2z.test','hr_admin',1,?),(4,'Old HR','oldhr@a2z.test','hr_admin',0,?),(5,'Ops','ops@a2z.test','coo',1,?),(6,'Gina','gina@a2z.test','editor',1,'oauth$google')`).run(hash, hash, hash, hash);
  /* staff routes need two-factor for these roles: Ani has it on; the setup checks use the COO, who has not */
  db.exec(`UPDATE users SET totp_enabled = 1, totp_secret = 'JBSWY3DPEHPK3PXP' WHERE id IN (1, 2)`);
  db.exec(`INSERT INTO payroll_entries (user_id, month, basic_cents, commission_cents, allowance_cents, deduction_cents) VALUES (1,'2026-08',250000,0,20000,0),(1,'2026-09',250000,12000,20000,0),(2,'2026-08',900000,0,0,0)`);
  db.exec(`INSERT INTO payslip_releases (month, released_at, released_by) VALUES ('2026-08', '2026-09-05 02:00:00', 2)`);
  const RealDate = Date; const fixed = new RealDate("2026-09-18T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const sess = (uid, token, minsAgo = 60) => {
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now', ?))`)
      .run(createHash("sha256").update(token).digest("hex"), uid, `-${minsAgo} minutes`);
    return token;
  };
  const tok = { 1: sess(1, "t-ani"), 2: sess(2, "t-boss"), 5: sess(5, "t-ops"), 6: sess(6, "t-gina-old", 60) };
  const call = async (path, uid, method = "GET", body, token) => {
    const t = token ?? tok[uid];
    const r = await worker.fetch(new Request(`https://api.a2z.test${path}`, { method, headers: { cookie: `azone_session=${t}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, j: await r.json().catch(() => null) };
  };

  /* 1 */
  const p = (await call("/api/v1/staff/profile", 1)).j?.profile;
  ok("my profile: the staff record, with official name, joined date and active", p?.employee_id === "A2Z007" && p?.full_name === "Nur Ani binti Ali" && p?.joined_on === "2026-01-05" && Number(p?.is_active) === 1, JSON.stringify(p)?.slice(0, 200));
  ok("...never another person's, whatever is asked", (await call("/api/v1/staff/profile?user_id=2", 1)).j?.profile?.id === 1);
  /* 2 */
  ok("the name is refused", (await call("/api/v1/staff/profile", 1, "PATCH", { name: "Queen Ani" })).status === 403 && db.prepare(`SELECT name FROM users WHERE id = 1`).get().name === "Ani");
  for (const k of ["position", "employee_id", "role", "base_salary_cents"]) ok(`${k} is refused`, (await call("/api/v1/staff/profile", 1, "PATCH", { phone: "0123456789", [k]: "x" })).status === 403);
  ok("a phone that is not a number is refused", (await call("/api/v1/staff/profile", 1, "PATCH", { phone: "call me maybe" })).status === 400 && (await call("/api/v1/staff/profile", 1, "PATCH", { phone: "12" })).status === 400);
  ok("a real phone is saved", (await call("/api/v1/staff/profile", 1, "PATCH", { phone: "+60 11-2233 4455" })).status === 200 && db.prepare(`SELECT phone FROM users WHERE id = 1`).get().phone === "+60 11-2233 4455");
  const aud = db.prepare(`SELECT detail FROM audit_log WHERE action = 'staff.profile_update' ORDER BY id DESC LIMIT 1`).get();
  ok("...and audited with the old and new number", aud && /"from":"012-3456789"/.test(aud.detail ?? "") && /"to":"\+60 11-2233 4455"/.test(aud.detail ?? ""), JSON.stringify(aud));
  /* 3 */
  const ms = (await call("/api/v1/staff/payroll/self/months", 1)).j;
  ok("my months: released August open, September closed until its release", JSON.stringify(ms?.months?.map((m) => [m.month, m.open])) === JSON.stringify([["2026-09", false], ["2026-08", true]]), JSON.stringify(ms));
  ok("...with no figures", !/cents/.test(JSON.stringify(ms)));
  ok("only my months (the CEO's August row is not mine)", ms?.months?.length === 2);
  const sep = (await call("/api/v1/staff/payroll/self?month=2026-09", 1)).j;
  ok("an unreleased month answers locked, with no entry", sep?.locked === true && sep?.entry === null);
  const aug = (await call("/api/v1/staff/payroll/self?month=2026-08", 1)).j;
  ok("a released month opens, mine", aug?.entry?.user_id === 1 && aug?.entry?.basic_cents === 250000);
  ok("a month that is not YYYY-MM is refused", (await call("/api/v1/staff/payroll/self?month=2026-13", 1)).status === 400 && (await call("/api/v1/staff/payroll/self?month=../x", 1)).status === 400);
  /* 4 */
  ok("a request needs a note", (await call("/api/v1/staff/profile/update-request", 1, "POST", { note: "" })).status === 400);
  const before = db.prepare(`SELECT responsibilities, role_title FROM users WHERE id = 1`).get();
  ok("a request rings HR and the CEO", (await call("/api/v1/staff/profile/update-request", 1, "POST", { note: "I now also run the TikTok live schedule" })).status === 200);
  const bells = db.prepare(`SELECT user_id, kind, ref FROM notifications WHERE kind = 'profile_request' ORDER BY user_id`).all();
  ok("...the active HR admin and the CEO only, opening me on the Staff tab", JSON.stringify(bells.map((b) => b.user_id)) === JSON.stringify([2, 3]) && bells.every((b) => b.ref === "staff:1"), JSON.stringify(bells));
  ok("...and changes nothing on the record", JSON.stringify(db.prepare(`SELECT responsibilities, role_title FROM users WHERE id = 1`).get()) === JSON.stringify(before));
  await call("/api/v1/staff/profile/update-request", 1, "POST", { note: "second request here" });
  await call("/api/v1/staff/profile/update-request", 1, "POST", { note: "third request here" });
  ok("three a day", (await call("/api/v1/staff/profile/update-request", 1, "POST", { note: "fourth request here" })).status === 429);
  /* 5 */
  ok("2FA setup without the password is refused", (await call("/api/v1/auth/2fa/setup", 5, "POST", {})).status === 401 && !db.prepare(`SELECT totp_secret FROM users WHERE id = 5`).get().totp_secret);
  ok("...with a wrong password too", (await call("/api/v1/auth/2fa/setup", 5, "POST", { password: "nope" })).status === 401);
  const good = await call("/api/v1/auth/2fa/setup", 5, "POST", { password: "Correct-horse-1" });
  ok("...and with it, the secret is handed out", good.status === 200 && typeof good.j?.secret === "string");
  ok("a Google account signed in an hour ago is asked to sign in again", (await call("/api/v1/auth/2fa/setup", 6, "POST", {})).status === 401);
  const fresh = sess(6, "t-gina-new", 2);
  ok("...and five minutes after signing in, it may", (await call("/api/v1/auth/2fa/setup", 6, "POST", {}, fresh)).status === 200);
  const st = (await call("/api/v1/auth/2fa/status", 5)).j;
  ok("status says what turning it on will ask for", st?.reauth === "password" && (await call("/api/v1/auth/2fa/status", 6, "GET", undefined, fresh)).j?.reauth === "recent_sign_in");
  globalThis.Date = RealDate;
} catch (e) {
  ok("the Profile routes run against SQLite", false, String(e?.stack ?? e).slice(0, 600));
}

ok("the guard is registered", /\["profile-self", "/.test(read("scripts/run-guards.mjs")));
console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }

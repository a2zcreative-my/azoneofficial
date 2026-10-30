/* SHIFT REMINDER DELIVERY (v1.226.0) - runtime guard: the real worker
 * (staff.ts and the reminder runner, bundled) against SQLite with EVERY
 * migration applied, and the push services stood in for by a recording
 * fetch.
 *
 * The owner's Shift Reminders brief, 30-10-2026, and his answers
 * (claude/SHIFT-REMINDERS-AUDIT.md): "15 minutes", "Keep 'ended' + 22:00
 * only", "add the switches", "Approve sign-out unbind", "Approve
 * push-service check". This guard holds:
 *
 *   ONE SEND   two runs at the same minute write ONE bell row and push each
 *              device ONCE; a later tick in the window sends nothing more;
 *   LIFETIME   a reminder push lives only until its moment (TTL = seconds
 *              left, never under 60) and asks for high urgency; every other
 *              push keeps its one day;
 *   DEVICES    two devices each get it; an address that is not a push
 *              service (stored before this release) is never posted to and
 *              is left in place; a 410 device is removed; a failure is
 *              counted with its status code;
 *   SWITCHES   Clock-in off -> no start reminder; on again -> it comes;
 *              Clock-out off -> no end reminder; only the person's own
 *              switches, only known keys, booleans only;
 *   MOVED      a shift moved after its reminder gets a new one at the new
 *              time;
 *   SUBSCRIBE  a non-push address, plain http, or malformed keys are
 *              refused; a real one is stored; /push/device answers only for
 *              the person's own device;
 *   SIGN-OUT   (source) the logout removes this session owner's device
 *              address, every device on "sign out everywhere"; every
 *              portal sign-out sends it.
 *
 * Negative-tested by: notify without `once`; the plain INSERT in the once
 * branch; TTL fixed at a day; dropping the endpoint check in sendPush;
 * dropping the switches read; the subscribe check removed; the logout
 * unbind removed.
 *
 *   node tests/shift-reminder-delivery.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let passed = 0, failed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* ---- source: the sign-out unbind and the push options ---- */
const index = read("worker/src/index.ts");
const logout = index.slice(index.indexOf('if (path === "/api/v1/auth/logout" && method === "POST")'), index.indexOf("/* ---- one-time super admin bootstrap ---- */"));
ok("SIGN-OUT: the session's owner is read before the session is deleted", logout.indexOf("SELECT user_id FROM sessions WHERE id = ?1") >= 0 && logout.indexOf("SELECT user_id FROM sessions WHERE id = ?1") < logout.indexOf("DELETE FROM sessions WHERE id = ?1"));
ok("SIGN-OUT: this device's address is removed for that owner only", /if \(owner\) \{\s*try \{\s*if \(bodyLo\?\.all\) \{[^}]*\} else if \(typeof bodyLo\?\.push_endpoint === "string" && bodyLo\.push_endpoint\.length <= 1024\) \{\s*await env\.DB\.prepare\(`DELETE FROM push_subscriptions WHERE endpoint = \?1 AND user_id = \?2`\)\s*\.bind\(bodyLo\.push_endpoint, owner\.user_id\)\.run\(\);/.test(logout));
ok("SIGN-OUT: 'sign out everywhere' removes every device of that person", /if \(bodyLo\?\.all\) \{\s*await env\.DB\.prepare\(`DELETE FROM push_subscriptions WHERE user_id = \?1`\)\.bind\(owner\.user_id\)/.test(logout));
const pc = read("lib/push-client.ts");
ok("SIGN-OUT: the browser sends its address and then drops the subscription", /push_endpoint: endpoint/.test(pc) && /await sub\?\.unsubscribe\(\)/.test(pc) && /getRegistration\(\)/.test(pc) && !/currentPushEndpoint[\s\S]{0,400}serviceWorker\.ready/.test(pc));
const outs = ["components/portal/portal-shell.tsx", "components/portal/portal-provider.tsx", "components/portal/profile.tsx", "app/admin/page.tsx"].map((f) => [f, read(f)]);
ok("SIGN-OUT: every staff sign-out goes through signOutRequest", outs.every(([, s]) => /signOutRequest\(/.test(s) && !/api\(["`]\/auth\/logout/.test(s)), outs.filter(([, s]) => /api\(["`]\/auth\/logout/.test(s)).map(([f]) => f).join(", "));
const wp = read("worker/src/webpush.ts");
ok("the TTL is the caller's, capped at a day, a day by default", /const ttl = Math\.max\(0, Math\.min\(86400, Math\.round\(opts\.ttl \?\? 86400\)\)\);/.test(wp) && /"TTL": String\(ttl\)/.test(wp));
ok("sendPush never posts to an address that is not a push service", /if \(!isPushEndpoint\(sub\.endpoint\)\) return 0;/.test(wp));
const staffSrc = read("worker/src/staff.ts");
ok("a reminder push carries its own title", /pushToUser\(env, userId, opts\.title \?\? "A2Z CREATIVE MARKETING", message, ref,/.test(staffSrc));
ok("the toggle's 'on' means registered for this person, not just permission", /devicePushStatus\(\)\.then\(\(d\) => \{\s*if \(alive\) setPushState\(d === "on" \? "granted"/.test(read("components/portal/portal-provider.tsx")));
ok("the Profile card is mounted on My Profile", /<ShiftReminderPrefs \/>/.test(read("components/portal/profile.tsx")));

/* ---- runtime ---- */
const dir = mkdtempSync(join(tmpdir(), "srd-"));
const bundle = (src, name) => { const out = join(dir, `${name}.mjs`); execSync(`npx esbuild "${join(root, src)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); return import(pathToFileURL(out).href); };
const db = new DatabaseSync(":memory:");
for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
}
const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
  bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
  first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
  run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };

/* real VAPID and device keys, so the encryption runs for real */
const b64u = (u8) => Buffer.from(u8).toString("base64url");
const vapid = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const vPub = new Uint8Array(await webcrypto.subtle.exportKey("raw", vapid.publicKey));
const vJwk = await webcrypto.subtle.exportKey("jwk", vapid.privateKey);
const devKey = async () => { const k = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]); return b64u(new Uint8Array(await webcrypto.subtle.exportKey("raw", k.publicKey))); };
const env = {
  DB: { prepare: shim, batch: async (list) => { for (const s of list) s._run(); return []; } },
  VAPID_PUBLIC_KEY: b64u(vPub), VAPID_PRIVATE_KEY: vJwk.d, VAPID_SUBJECT: "mailto:ops@example.test",
};

db.exec(`UPDATE shift_patterns SET tue_start = NULL, tue_end = NULL, tue_start2 = NULL, tue_end2 = NULL`); // 10-11-2026 is a Tuesday: a rest day on every pattern, so the day's shifts are the live session below
db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, employment_status) VALUES
  (4,'Aina','a@x.t','sales_marketing',1,'x','permanent'),(8,'Hr','r@x.t','hr_admin',1,'x','permanent'),(6,'Adm','d@x.t','admin',1,'x','permanent')`);
const D = "2026-11-10";
db.exec(`INSERT INTO live_sessions (id, session_date, start_time, end_time, host_user_id, client_name, status) VALUES (1,'${D}','10:00','13:00',4,'Sara Beauty','scheduled')`);
const FCM = "https://fcm.googleapis.com/fcm/send/aaa", APPLE = "https://web.push.apple.com/QbbB", EVIL = "https://evil.example/collect";
const ins = db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)`);
ins.run(4, FCM, await devKey(), b64u(webcrypto.getRandomValues(new Uint8Array(16))));
ins.run(4, APPLE, await devKey(), b64u(webcrypto.getRandomValues(new Uint8Array(16))));
ins.run(4, EVIL, await devKey(), b64u(webcrypto.getRandomValues(new Uint8Array(16)))); // stored before v1.226.0

/* the push services: record, answer per host */
const calls = []; const answer = new Map([["fcm.googleapis.com", 201], ["web.push.apple.com", 201]]);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const h = init.headers ?? {};
  calls.push({ host: u.hostname, ttl: h.TTL, urgency: h.Urgency ?? null, auth: /^vapid t=/.test(h.Authorization ?? ""), bytes: init.body?.byteLength ?? 0 });
  return new Response(null, { status: answer.get(u.hostname) ?? 599 });
};

const RealDate = Date; let fixed = 0;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
const at = (hhmm) => { fixed = new RealDate(`${D}T${hhmm}:00+08:00`).getTime(); return new RealDate(fixed); };

try {
  const { runShiftReminders } = await bundle("worker/src/shift-reminders-cron.ts", "cron");
  const { handleStaff } = await bundle("worker/src/staff.ts", "staff");
  const ROLE = { 4: "sales_marketing", 8: "hr_admin", 6: "admin" };
  const call = async (p, id, method = "GET", body) => {
    const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p, { id, role: ROLE[id], name: "x" });
    return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
  };
  const bells = (ref) => db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 4 AND ref = ?`).get(ref).n;

  /* ONE SEND, LIFETIME, DEVICES */
  const [a, b] = await Promise.all([runShiftReminders(env, at("09:45")), runShiftReminders(env, at("09:45"))]);
  ok("ONE SEND: two runs at 09:45 write ONE bell row", bells(`shift_start:${D}:1000`) === 1, String(bells(`shift_start:${D}:1000`)));
  ok("ONE SEND: and only one of them counts it sent", a.sent + b.sent === 1, `${a.sent}+${b.sent}`);
  ok("DEVICES: each real device is pushed once", calls.filter((c) => c.host === "fcm.googleapis.com").length === 1 && calls.filter((c) => c.host === "web.push.apple.com").length === 1, JSON.stringify(calls));
  ok("DEVICES: the stored non-push address is never posted to, and is left in place", !calls.some((c) => c.host === "evil.example") && db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?`).get(EVIL).n === 1);
  ok("DEVICES: ...and counted as not delivered", a.push.failed + b.push.failed === 1 && [...a.push.statuses, ...b.push.statuses].includes(0));
  ok("LIFETIME: the start reminder lives 15 minutes, high urgency, signed", calls.every((c) => c.ttl === "900" && c.urgency === "high" && c.auth && c.bytes > 0), JSON.stringify(calls));
  const msg = db.prepare(`SELECT message FROM notifications WHERE ref = ?`).get(`shift_start:${D}:1000`).message;
  ok("the bell says the brief's words and not the client", msg === "Your shift starts in 15 minutes at 10:00. Get ready to clock in.", msg);
  calls.length = 0;
  await runShiftReminders(env, at("09:50"));
  ok("ONE SEND: a later tick in the window sends nothing more", calls.length === 0 && bells(`shift_start:${D}:1000`) === 1);

  /* SWITCHES (the person's own) and a MOVED shift */
  ok("SWITCHES: defaults are on", JSON.stringify((await call("/notification-prefs", 4)).j?.prefs) === JSON.stringify({ shift_clock_in: true, shift_clock_out: true }));
  ok("SWITCHES: an unknown switch is refused", (await call("/notification-prefs", 4, "PUT", { key: "payroll", enabled: false })).status === 400);
  ok("SWITCHES: on/off must be true or false", (await call("/notification-prefs", 4, "PUT", { key: "shift_clock_in", enabled: "no" })).status === 400);
  ok("SWITCHES: Aina turns the clock-in reminder off", (await call("/notification-prefs", 4, "PUT", { key: "shift_clock_in", enabled: false })).j?.prefs?.shift_clock_in === false);
  ok("SWITCHES: nobody else's switches moved", (await call("/notification-prefs", 8)).j?.prefs?.shift_clock_in === true && db.prepare(`SELECT COUNT(*) AS n FROM notification_prefs`).get().n === 1);
  db.exec(`UPDATE live_sessions SET start_time = '11:00' WHERE id = 1`); // moved after the 09:45 reminder
  const off = await runShiftReminders(env, at("10:46"));
  ok("SWITCHES: off -> no start reminder for the moved shift", bells(`shift_start:${D}:1100`) === 0 && off.skipped_off === 1);
  await call("/notification-prefs", 4, "PUT", { key: "shift_clock_in", enabled: true });
  calls.length = 0;
  await runShiftReminders(env, at("10:50"));
  ok("MOVED: on again -> the moved shift gets its own reminder at the new time", bells(`shift_start:${D}:1100`) === 1 && /at 11:00/.test(db.prepare(`SELECT message FROM notifications WHERE ref = ?`).get(`shift_start:${D}:1100`).message));
  ok("LIFETIME: 10 minutes left -> 600 seconds", calls.length >= 1 && calls.every((c) => c.ttl === "600"), JSON.stringify(calls));

  /* the end, while clocked in; a dead device; a failing device */
  db.exec(`INSERT INTO attendance_records (user_id, type, created_at) VALUES (4, 'clock_in', '${D} 02:58:00')`);
  answer.set("web.push.apple.com", 410); answer.set("fcm.googleapis.com", 500);
  calls.length = 0;
  const end = await runShiftReminders(env, at("12:45"));
  ok("the clock-out reminder comes 15 minutes before the end, only while clocked in", bells(`shift_end_soon:${D}:1300`) === 1);
  ok("DEVICES: a 410 device is removed", db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?`).get(APPLE).n === 0 && end.push.pruned === 1);
  ok("DEVICES: a 500 is counted with its code", end.push.statuses.includes(500));
  await call("/notification-prefs", 4, "PUT", { key: "shift_clock_out", enabled: false });
  await runShiftReminders(env, at("13:05"));
  ok("SWITCHES: Clock-out off -> no 'shift ended' reminder", bells(`shift_ended:${D}:1300`) === 0);
  await call("/notification-prefs", 4, "PUT", { key: "shift_clock_out", enabled: true });
  answer.set("fcm.googleapis.com", 201); calls.length = 0;
  await runShiftReminders(env, at("13:59"));
  ok("LIFETIME: never under a minute", bells(`shift_ended:${D}:1300`) === 1 && calls.every((c) => c.ttl === "60"), JSON.stringify(calls));
  ok("the admin (an operator) is never reminded", db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 6`).get().n === 0);

  /* SUBSCRIBE */
  const sub = (endpoint, keys) => call("/push/subscribe", 8, "POST", { subscription: { endpoint, keys } });
  const good = { p256dh: await devKey(), auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) };
  ok("SUBSCRIBE: an address that is not a push service is refused", (await sub("https://evil.example/collect", good)).status === 400);
  ok("SUBSCRIBE: plain http is refused", (await sub("http://fcm.googleapis.com/fcm/send/x", good)).status === 400);
  ok("SUBSCRIBE: a look-alike host is refused", (await sub("https://web.push.apple.com.evil.example/x", good)).status === 400);
  ok("SUBSCRIBE: malformed keys are refused", (await sub("https://fcm.googleapis.com/fcm/send/hr", { p256dh: "<script>", auth: "x" })).status === 400);
  ok("SUBSCRIBE: a real Google, Apple, Mozilla or Microsoft address is stored",
     (await sub("https://fcm.googleapis.com/fcm/send/hr", good)).status === 200 && (await sub("https://web.push.apple.com/QhrX", good)).status === 200
     && (await sub("https://updates.push.services.mozilla.com/wpush/v2/x", good)).status === 200 && (await sub("https://wns2-sg2p.notify.windows.com/w/?token=x", good)).status === 200);
  ok("/push/device: yes for the person's own device", (await call("/push/device", 8, "POST", { endpoint: "https://fcm.googleapis.com/fcm/send/hr" })).j?.device === true);
  ok("/push/device: no for someone else's device", (await call("/push/device", 4, "POST", { endpoint: "https://fcm.googleapis.com/fcm/send/hr" })).j?.device === false);
  const nonShift = await (await bundle("worker/src/webpush.ts", "wp")).sendPush({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }, { endpoint: FCM, p256dh: good.p256dh, auth: good.auth }, { title: "x" });
  ok("every other push keeps its one day", nonShift === 201 && calls.at(-1)?.ttl === "86400" && calls.at(-1)?.urgency === null);
} finally {
  globalThis.fetch = realFetch; globalThis.Date = RealDate;
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed === 0 ? `shift-reminder-delivery: ${passed} checks passed.` : `\n${failed} shift-reminder-delivery check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;

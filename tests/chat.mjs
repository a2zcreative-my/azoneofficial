/* v1.364.0 - STAFF CHAT, THE RULES THAT MUST NOT DRIFT (the CEO's brief
   "Internal Staff Chat (12H auto-delete)", 18-11-2026; decisions in
   docs/STAFF-CHAT-STAGE-0-AUDIT.md). Read from the source on every release.
   The behaviour itself is proven end to end against a real local worker by
   tests/browser/chat-e2e.mjs (73 checks) and tests/browser/chat.py.

     node tests/chat.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const F = {
  chat: "worker/src/chat.ts", index: "worker/src/index.ts", perms: "worker/src/permissions.ts", toml: "worker/wrangler.toml",
  backup: "worker/src/backup-store.ts", client: "lib/chat-client.ts", outbox: "lib/outbox.ts", workerOutbox: "worker/src/outbox.ts",
  panel: "components/portal/chat/chat-panel.tsx", shell: "components/portal/portal-shell.tsx", headers: "public/_headers",
  release: "scripts/release-backup.mjs",
};

function checks(src) {
  const out = [];
  const ok = (name, cond) => out.push([Boolean(cond), name]);
  const c = src.chat;
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const code = strip(c);

  /* the 12-hour rule */
  ok("the lifetime is 12 hours", /export const CHAT_TTL_MS = 12 \* 60 \* 60 \* 1000;/.test(c));
  ok("a shorter lifetime needs BOTH the test variable and a 127.0.0.1 origin", /const local = \/\^http:\\\/\\\/127\\\.0\\\.0\\\.1:\\d\+\$\/\.test\(/.test(c) && /return local && Number\.isFinite\(t\) && t >= 5000 && t < CHAT_TTL_MS \? t : CHAT_TTL_MS;/.test(c));
  ok("wrangler.toml never sets the test lifetime", !/CHAT_TEST_TTL_MS/.test(src.toml.replace(/#.*$/gm, "")));
  ok("expires_at is set by the server, once, from its own clock", /const exp = now \+ chatTtl\(this\.env\);/.test(c) && /INSERT INTO messages \(conv_id, sender_id, body, created_at, expires_at, client_id\) VALUES \(\?, \?, \?, \?, \?, \?\) RETURNING \*`, conv, uid, text, now, exp, clientId/.test(c));
  /* the one UPDATE of a message ends it NOW (the last member left the group) */
  const ups = code.match(/UPDATE messages SET[^`]*`[^)]*\)/g) ?? [];
  ok("nothing ever moves a message's expires_at forward", ups.length === 1 && /UPDATE messages SET expires_at = \? WHERE conv_id = \?`, now, conv\)/.test(ups[0]));
  const reads = code.match(/SELECT[^`]*FROM messages[^`]*`/g) ?? [];
  const exempt = (q) => /expires_at <= \?/.test(q) || /MIN\(expires_at\)/.test(q) || /MAX\(id\) AS m FROM messages WHERE conv_id = \?`/.test(q);
  ok(`every read of a message hides an expired one (${reads.length} reads)`, reads.length >= 6 && reads.every((q) => /expires_at > \?/.test(q) || exempt(q)));
  ok("a file opens only while its message lives, and only for a member", /JOIN members mb ON mb\.conv_id = f\.conv_id AND mb\.user_id = \?\s+WHERE f\.id = \? AND f\.msg_id IS NOT NULL AND f\.expires_at > \?/.test(c));
  ok("the sweep deletes the R2 objects and keeps a file row until its object is gone", /await bucket\.delete\(dead\.map\(\(d\) => d\.r2_key\)\)/.test(c) && /if \(ok\) \{/.test(c));
  ok("the alarm follows the next expiry; the 5-minute cron is the recovery", /async alarm\(\)/.test(c) && /this\.ctx\.storage\.setAlarm\(/.test(c) && /chatCronSweep\(env\)/.test(src.index));
  ok("orphaned R2 objects older than 30 minutes are removed", /!known\.has\(o\.key\) && o\.uploaded\.getTime\(\) < now - 30 \* 60_000/.test(c));

  /* nothing of chat in D1, in MEDIA or in the notifications */
  ok("chat writes nothing to D1", !/env\.DB\.prepare\(\s*`\s*(INSERT|UPDATE|DELETE)/.test(code));
  ok("chat never uses notify() or the notifications table", !/\bnotify\(/.test(code) && !/notifications/.test(code));
  ok("a push names nothing: no sender, no text", /pushToUser\(env, to, "A2Z Chat", "New message on A2Z Chat", "chat", "\/portal\?chat=1", \{ ttl: 3600/.test(c));
  ok("chat files never touch MEDIA (it is backed up for 90 days)", !/\.MEDIA\b/.test(code) && /CHAT_FILES/.test(c));
  ok("the media backup never reads the chat bucket", !/CHAT_FILES/.test(src.backup));
  ok("wrangler binds the hub (SQLite) and the private chat bucket", /\[\[durable_objects\.bindings\]\]\nname = "CHAT"\nclass_name = "ChatHub"/.test(src.toml) && /new_sqlite_classes = \["ChatHub"\]/.test(src.toml) && /binding = "CHAT_FILES"\nbucket_name = "a2z-chat-temp"/.test(src.toml));

  ok("PUSH.bat stops before any migration when the chat bucket is missing", /const CHAT_BUCKET = "a2z-chat-temp";/.test(src.release) && /The staff chat bucket "\$\{CHAT_BUCKET\}" does not exist yet/.test(src.release));
  ok("the CSP lets the live connection reach our own domain", /connect-src 'self' wss:\/\/a2zcreative\.my wss:\/\/www\.a2zcreative\.my /.test(src.headers));

  /* who may chat */
  ok("eligibility: never customer or agent, 2FA done, chat_use, active and on staff today", /if \(!user \|\| user\.role === "customer" \|\| user\.role === "agent" \|\| user\.requires_2fa\) return false;/.test(c) && /if \(!roleMayChat\(user, true\)\) return false;/.test(c) && /return can\(u\.role, "chat_use"\) \? null : "off";/.test(c) && /WHERE u\.id = \?1 AND u\.is_active = 1 AND \$\{currentStaffSql\("u\."\)\}/.test(c));
  ok("every chat route is behind that check", /export async function handleChat\([\s\S]{0,200}?\n  const method = request\.method;\n  if \(!\(await chatEligible\(env, user\)\)\) return fail\("forbidden"/.test(c));
  const chatUse = /chat_use: \[([^\]]*)\]/.exec(src.perms)?.[1] ?? "";
  ok("chat_use is a matrix row that never holds a customer or an agent", chatUse && !/customer|agent/.test(chatUse) && /key: "chat_use"/.test(src.perms));
  ok("the socket needs the same origin", /if \(!origin \|\| !origins\.includes\(origin\)\) return fail\("forbidden_origin"/.test(c));
  ok("open connections are re-checked every minute and after any account change", /cands\.push\(now \+ RECHECK_MS\)/.test(c) && /CHAT_RECHECK\.test\(path\)/.test(src.index) && /auth\\\/logout/.test(src.index));
  ok("a revoked connection is told and closed", /type: "revoked"/.test(c) && /ws\.close\(4001, "signed_out"\)/.test(c));
  ok("the chat door sits before the staff dispatch, and a 101 is handed back untouched", src.index.indexOf('path.startsWith("/api/v1/staff/chat/")') < src.index.indexOf('if (path.startsWith("/api/v1/staff/")) {') && /if \(res\.status === 101\) return res;/.test(src.index));

  /* limits */
  ok("1,500 characters, 2 MB a file, 3 files, 5 MB together, 8 in a group", /CHAT_MAX_TEXT = 1500;/.test(c) && /CHAT_MAX_FILE = 2 \* 1024 \* 1024;/.test(c) && /CHAT_MAX_FILES = 3;/.test(c) && /CHAT_MAX_TOTAL = 5 \* 1024 \* 1024;/.test(c) && /CHAT_GROUP_MAX = 8;/.test(c));
  ok("only JPG, PNG, WebP and PDF, checked by signature before storage", /"image\/jpeg": "jpg", "image\/png": "png", "image\/webp": "webp", "application\/pdf": "pdf",\n\};/.test(c) && /if \(!signatureOk\(type, bytes\)\)/.test(c) && c.indexOf("signatureOk(type, bytes)") < c.indexOf("bucket.put(key, bytes"));
  ok("an over-size file is refused before it is read in full", /if \(declared > CHAT_MAX_FILE\) return fail\("too_large"/.test(c) && /readCapped\(request, CHAT_MAX_FILE\)/.test(c));
  ok("messages and uploads are rate-limited", /RATE = \{ msg: \[30, 60_000\], upload: \[20, 600_000\] \}/.test(c) && /allowRate\(uid, "msg"\)/.test(c) && /allowRate\(uid, "upload"\)/.test(c));
  ok("downloads are never cached and a PDF never opens inline", /"Cache-Control": "no-store, private"/.test(c) && /\$\{inline \? "inline" : "attachment"\}/.test(c) && /const inline = f\.type\.startsWith\("image\/"\);/.test(c));

  /* the screen */
  ok("the browser keeps chat in memory only", !/localStorage|sessionStorage|indexedDB|caches\./.test(strip(src.client)));
  ok("chat is never queued offline", !/chat/.test(src.outbox.slice(src.outbox.indexOf("QUEUEABLE"), src.outbox.indexOf("];", src.outbox.indexOf("QUEUEABLE")))) && !/chat/.test(src.workerOutbox));
  ok("the screen drops each message at its expiry, and on the hub's word", /function purgeExpired\(\)/.test(src.client) && /case "expired":\n\s+dropIds/.test(src.client));
  ok("the header icon is the only way in, never for an agent", /\{!isAgent && <ChatButton role=\{user\.role\} \/>\}/.test(src.shell) && /const may = role !== "agent" && role !== "customer";/.test(src.panel));
  ok("the drawer is the shared SideDrawer, drawn on the page (not in the header)", /createPortal\(\n\s+<SideDrawer open=\{open\} onClose=\{\(\) => setOpen\(false\)\} form icon="chat"/.test(src.panel));
  ok("'Messages expire after 12 hours' is always on screen", /L\("Messages expire after 12 hours"/.test(src.panel) && /<Notice \/>/.test(src.panel));
  ok("no calls, no video, no emoji picker, no reactions", !/name="(video|phone|call)"|emoji|reaction/i.test(strip(src.panel)));
  ok("chat says it is not the official record", /Not for approvals, payments, HR decisions or instructions/.test(src.panel));
  return out;
}

const SRC = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, read(p)]));
const base = checks(SRC);
let failed = 0;
for (const [pass, name] of base) if (!pass) { failed++; console.log(`  ✗ ${name}`); }

/* mutations: each break of a rule must be caught */
const MUT = [
  ["chat", "a 24-hour lifetime", "export const CHAT_TTL_MS = 12 * 60 * 60 * 1000;", "export const CHAT_TTL_MS = 24 * 60 * 60 * 1000;"],
  ["chat", "a read that shows expired messages", "SELECT * FROM messages WHERE conv_id = ? AND expires_at > ? AND id < ?", "SELECT * FROM messages WHERE conv_id = ? AND id < ?"],
  ["chat", "reading extends the life", "this.sql.exec(`UPDATE members SET last_read = MAX(last_read, ?) WHERE conv_id = ? AND user_id = ?`, upto, conv, uid);", "this.sql.exec(`UPDATE members SET last_read = MAX(last_read, ?) WHERE conv_id = ? AND user_id = ?`, upto, conv, uid); this.sql.exec(`UPDATE messages SET expires_at = expires_at + 3600000 WHERE conv_id = ?`, conv);"],
  ["chat", "the push carries the text", '"New message on A2Z Chat"', "text"],
  ["chat", "an agent may chat", 'user.role === "customer" || user.role === "agent" || user.requires_2fa', 'user.role === "customer" || user.requires_2fa'],
  ["chat", "a custom role judged by its own (empty) cells again", 'return can(u.role, "chat_use") ? null : "off";', 'return allows(u as never, "chat_use") ? null : "off";'],
  ["chat", "a leaver may chat", 'WHERE u.id = ?1 AND u.is_active = 1 AND ${currentStaffSql("u.")}', "WHERE u.id = ?1 AND u.is_active = 1"],
  ["chat", "files go to MEDIA", "await bucket.put(key, bytes,", "await env.MEDIA.put(key, bytes,"],
  ["chat", "no signature check", "if (!signatureOk(type, bytes)) return", "if (false) return"],
  ["chat", "the test lifetime works anywhere", "return local && Number.isFinite(t)", "return Number.isFinite(t)"],
  ["client", "messages kept on the device", "export async function refreshInbox(): Promise<void> {", "export async function refreshInbox(): Promise<void> {\n  localStorage.setItem('chat', JSON.stringify(state));"],
  ["panel", "a call button", '<AppIcon name="info" /></button>}', '<AppIcon name="info" /></button>}<button type="button"><AppIcon name="video" /></button>'],
  ["shell", "chat for agents", "{!isAgent && <ChatButton role={user.role} />}", "<ChatButton role={user.role} />"],
];
let caught = 0;
if (!process.env.NOMUT) {
  for (const [k, name, from, to] of MUT) {
    if (!SRC[k].includes(from)) { failed++; console.log(`  ✗ mutation did not apply: ${name}`); continue; }
    const res = checks({ ...SRC, [k]: SRC[k].replace(from, to) });
    if (res.some(([p]) => !p)) caught++; else { failed++; console.log(`  ✗ mutation not caught: ${name}`); }
  }
}
if (failed) { console.log(`chat: ${failed} failed`); process.exit(1); }
console.log(`PASS - staff chat: messages live 12 hours and every read hides an expired one; nothing of chat in D1, MEDIA or the notifications; staff only, re-checked every minute; files checked before storage (${base.length} checks${process.env.NOMUT ? "" : `, ${caught} mutations caught`})`);

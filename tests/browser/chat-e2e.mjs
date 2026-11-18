/* v1.364.0 - STAFF CHAT, END TO END against a real local worker
   (wrangler dev --local, the real D1 migrations, the real Durable Object and a
   local R2 bucket). Not part of the release guards (it needs a running
   server); run it after any chat change:

     cd worker
     npx wrangler d1 migrations apply azoneofficial --local --persist-to /tmp/chatdev
     npx wrangler d1 execute azoneofficial --local --persist-to /tmp/chatdev --file ../tests/browser/chat-seed.sql
     npx wrangler dev --local --persist-to /tmp/chatdev --port 8787 --ip 127.0.0.1 \
       --test-scheduled --var ALLOWED_ORIGINS:http://127.0.0.1:4500 \
       --var ALLOWED_ORIGIN:http://127.0.0.1:4500 --var CHAT_TEST_TTL_MS:40000
     node tests/browser/chat-e2e.mjs

   CHAT_TEST_TTL_MS only works on a 127.0.0.1 origin (chatTtl in chat.ts), so
   expiry is proven in 40 seconds instead of 12 hours. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(new URL("../../worker/package.json", import.meta.url));
const WebSocket = require("ws");

const BASE = process.env.CHAT_BASE ?? "http://127.0.0.1:8787";
const ORIGIN = "http://127.0.0.1:4500";
const TTL = Number(process.env.CHAT_TTL ?? "40000");
const ID = { ceo: 101, coo: 102, sales: 103, agent: 104, customer: 105, leaver: 106, no2fa: 107, editor: 108, cco: 109 };
let pass = 0, failN = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ok  ${name}`); } else { failN++; console.log(`  FAIL ${name} ${extra}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = (who, extra = {}) => ({ Cookie: `azone_session=tok${ID[who]}; csrf_token=t${ID[who]}`, "X-CSRF-Token": `t${ID[who]}`, Origin: ORIGIN, ...extra });
async function api(who, method, path, body, extra = {}) {
  const r = await fetch(`${BASE}/api/v1/staff/chat${path}`, {
    method, headers: hdr(who, body instanceof Uint8Array ? extra : { "Content-Type": "application/json", ...extra }),
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, d, headers: r.headers };
}
function sock(who, origin = ORIGIN) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/v1/staff/chat/ws`, { headers: { Cookie: `azone_session=tok${ID[who]}`, Origin: origin } });
    const s = { ws, events: [], closed: null, status: null };
    ws.on("message", (m) => s.events.push(JSON.parse(String(m))));
    ws.on("close", (code) => { s.closed = code; });
    ws.on("unexpected-response", (_req, res) => { s.status = res.statusCode; resolve(s); });
    ws.on("open", () => { s.status = 101; resolve(s); });
    ws.on("error", () => resolve(s));
  });
}
const waitFor = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(100); } return false; };
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "azoneofficial", "--local", "--persist-to", process.env.CHAT_PERSIST ?? "/tmp/chatdev", "--command", sql], { cwd: new URL("../../worker", import.meta.url).pathname, stdio: "pipe" });
const png = () => { const b = new Uint8Array(4000); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.4\n1 0 obj << /Type /Catalog ${extra} >> endobj\n%%EOF\n`);

console.log("1. Who may use chat");
ok("CEO opens the inbox", (await api("ceo", "GET", "/inbox")).status === 200);
ok("COO opens the inbox", (await api("coo", "GET", "/inbox")).status === 200);
ok("CCO opens the inbox", (await api("cco", "GET", "/inbox")).status === 200);
for (const who of ["agent", "customer", "leaver"]) ok(`${who} is refused (403)`, (await api(who, "GET", "/inbox")).status === 403);
const no2 = await api("no2fa", "GET", "/inbox");
ok("staff who owe 2FA are refused", no2.status === 403, JSON.stringify(no2.d));
ok("signed out is refused (401)", (await fetch(`${BASE}/api/v1/staff/chat/inbox`)).status === 401);
const people = (await api("ceo", "GET", "/people")).d.people;
ok("the people list never shows an agent or a customer", !people.some((p) => p.id === ID.agent || p.id === ID.customer));
ok("a leaver is listed but cannot be chatted to", people.find((p) => p.id === ID.leaver)?.can_chat === false);

console.log("2. The live connection");
const sCeo = await sock("ceo"); ok("CEO connects", sCeo.status === 101);
const sCoo = await sock("coo"); ok("COO connects", sCoo.status === 101);
ok("another site cannot open a connection", (await sock("ceo", "https://evil.example")).status === 403);
ok("an agent cannot open a connection", (await sock("agent")).status === 403);
ok("a customer cannot open a connection", (await sock("customer")).status === 403);
await waitFor(() => sCeo.events.some((e) => e.type === "presence" && e.uid === ID.coo && e.online));
ok("the CEO sees the COO come online", sCeo.events.some((e) => e.type === "presence" && e.uid === ID.coo && e.online));

console.log("3. One-to-one messages");
const dm = await api("ceo", "POST", "/direct", { user_id: ID.coo });
ok("CEO opens a chat with the COO", dm.status === 200 && dm.d.conversation.kind === "direct", JSON.stringify(dm.d));
const conv = dm.d.conversation.id;
ok("the same pair gets the same chat", (await api("coo", "POST", "/direct", { user_id: ID.ceo })).d.conversation.id === conv);
ok("nobody opens a chat with an agent", (await api("ceo", "POST", "/direct", { user_id: ID.agent })).status === 409);
ok("nobody opens a chat with a leaver", (await api("ceo", "POST", "/direct", { user_id: ID.leaver })).status === 409);
const t0 = Date.now();
const m1 = await api("ceo", "POST", `/c/${conv}/messages`, { text: "Hi, file briefing untuk meeting petang dah siap?", client_id: "a1" });
ok("a message is sent", m1.status === 200, JSON.stringify(m1.d));
const exp = m1.d.message.expires_at - m1.d.message.created_at;
ok(`the server sets expires_at = created_at + TTL (${TTL} ms here; 12 h in production)`, exp === TTL, String(exp));
ok("the server sets created_at, not the client", Math.abs(m1.d.message.created_at - t0) < 5000);
ok("a repeated send (same client_id) is one message", (await api("ceo", "POST", `/c/${conv}/messages`, { text: "Hi, file briefing untuk meeting petang dah siap?", client_id: "a1" })).d.message.id === m1.d.message.id);
await waitFor(() => sCoo.events.some((e) => e.type === "message" && e.message.id === m1.d.message.id));
const got = sCoo.events.find((e) => e.type === "message" && e.message.id === m1.d.message.id);
ok("the COO receives it live", Boolean(got));
ok("with an unread count of 1", got?.unread?.total === 1, JSON.stringify(got?.unread));
const tooLong = await api("ceo", "POST", `/c/${conv}/messages`, { text: "x".repeat(1501) });
ok("1,501 characters is refused", tooLong.status === 400 && tooLong.d.error.code === "too_long");
ok("1,500 characters is accepted", (await api("ceo", "POST", `/c/${conv}/messages`, { text: "y".repeat(1500) })).status === 200);
ok("an empty message is refused", (await api("ceo", "POST", `/c/${conv}/messages`, { text: "   " })).status === 400);
ok("a non-member cannot read the chat", (await api("sales", "GET", `/c/${conv}/messages`)).status === 404);
ok("a non-member cannot write to it", (await api("sales", "POST", `/c/${conv}/messages`, { text: "hello" })).status === 404);
const list = await api("coo", "GET", `/c/${conv}/messages`);
ok("the COO reads the history", list.status === 200 && list.d.messages.length === 2);
const rd = await api("coo", "POST", `/c/${conv}/read`, { upto: list.d.messages.at(-1).id });
ok("marking read clears the unread count", rd.status === 200 && (await api("coo", "GET", "/inbox")).d.total === 0);
await waitFor(() => sCeo.events.some((e) => e.type === "read" && e.uid === ID.coo));
ok("the sender sees it was read", sCeo.events.some((e) => e.type === "read" && e.uid === ID.coo));

console.log("4. Files");
const up = await api("ceo", "POST", "/files", png(), { "Content-Type": "image/png", "X-File-Name": "photo.png" });
ok("a PNG is accepted", up.status === 200, JSON.stringify(up.d));
ok("a program renamed .png is refused", (await api("ceo", "POST", "/files", new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0]), { "Content-Type": "image/png", "X-File-Name": "x.png" })).status === 415);
ok("a text file is refused", (await api("ceo", "POST", "/files", new TextEncoder().encode("hello world"), { "Content-Type": "text/plain" })).status === 415);
ok("a ZIP is refused", (await api("ceo", "POST", "/files", new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0]), { "Content-Type": "application/zip" })).status === 415);
ok("a video is refused", (await api("ceo", "POST", "/files", new Uint8Array(100), { "Content-Type": "video/mp4" })).status === 415);
const big = new Uint8Array(2 * 1024 * 1024 + 1); big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
ok("a file over 2 MB is refused before storage", (await api("ceo", "POST", "/files", big, { "Content-Type": "image/png" })).status === 413);
const okPdf = await api("ceo", "POST", "/files", pdf(), { "Content-Type": "application/pdf", "X-File-Name": "Briefing_Meeting.pdf" });
ok("a plain PDF is accepted", okPdf.status === 200);
ok("a PDF with JavaScript is refused", (await api("ceo", "POST", "/files", pdf("/OpenAction << /S /JavaScript /JS (app.alert(1)) >>"), { "Content-Type": "application/pdf" })).status === 415);
ok("a PDF with an embedded file is refused", (await api("ceo", "POST", "/files", pdf("/Names << /EmbeddedFiles 2 0 R >>"), { "Content-Type": "application/pdf" })).status === 415);
const ups = [up.d.file.id, okPdf.d.file.id];
const four = [];
for (let i = 0; i < 2; i++) four.push((await api("ceo", "POST", "/files", png(), { "Content-Type": "image/png" })).d.file.id);
ok("four files in one message are refused", (await api("ceo", "POST", `/c/${conv}/messages`, { text: "many", files: [...ups, ...four] })).status === 400);
const mf = await api("ceo", "POST", `/c/${conv}/messages`, { text: "Dah siap. Saya share di sini.", files: ups });
ok("a message carries its files", mf.status === 200 && mf.d.message.files.length === 2, JSON.stringify(mf.d));
ok("a file is sent only once", (await api("ceo", "POST", `/c/${conv}/messages`, { text: "again", files: [ups[0]] })).status === 409);
ok("a file nobody uploaded cannot be claimed", (await api("coo", "POST", `/c/${conv}/messages`, { text: "steal", files: [four[0]] })).status === 409);
const dl = await fetch(`${BASE}/api/v1/staff/chat/files/${ups[1]}`, { headers: hdr("coo") });
ok("the COO downloads the PDF", dl.status === 200 && (await dl.arrayBuffer()).byteLength > 10);
ok("the download is never cached", /no-store/.test(dl.headers.get("cache-control") ?? ""));
ok("a PDF downloads as an attachment, never inline", /^attachment/.test(dl.headers.get("content-disposition") ?? ""));
ok("a non-member cannot download it", (await fetch(`${BASE}/api/v1/staff/chat/files/${ups[1]}`, { headers: hdr("sales") })).status === 404);
ok("an agent cannot download it", (await fetch(`${BASE}/api/v1/staff/chat/files/${ups[1]}`, { headers: hdr("agent") })).status === 403);

console.log("5. Groups");
const g = await api("ceo", "POST", "/groups", { name: "Operations Team", member_ids: [ID.coo, ID.cco, ID.sales] });
ok("a group of four is made", g.status === 200 && g.d.conversation.members.length === 4);
ok("a group of nine is refused", (await api("ceo", "POST", "/groups", { name: "Too big", member_ids: [102, 103, 108, 109, 1, 2, 3, 4] })).status === 400);
ok("an agent cannot be put in a group", (await api("ceo", "POST", "/groups", { name: "X", member_ids: [ID.agent] })).status === 409);
ok("only the maker removes someone", (await api("coo", "PATCH", `/groups/${g.d.conversation.id}`, { remove: [ID.sales] })).status === 403);
ok("the maker removes someone", (await api("ceo", "PATCH", `/groups/${g.d.conversation.id}`, { remove: [ID.sales] })).status === 200);
ok("who is removed cannot read the group", (await api("sales", "GET", `/c/${g.d.conversation.id}/messages`)).status === 404);

console.log("6. Rate limit");
const rl = await api("ceo", "POST", "/direct", { user_id: ID.editor });
let codes = [];
for (let i = 0; i < 31; i++) codes.push((await api("ceo", "POST", `/c/${rl.d.conversation.id}/messages`, { text: `n${i}` })).status);
ok("sending is limited to 30 a minute (CEO had sent 4 before)", codes.includes(429), codes.join(","));

console.log("7. The 12-hour rule (here: the test TTL)");
const pre = (await api("coo", "GET", `/c/${conv}/messages`)).d.messages.length;
ok("before expiry the COO sees the messages", pre >= 3, String(pre));
const wait = Math.max(0, m1.d.message.expires_at + 500 - Date.now());
console.log(`   waiting ${Math.round(wait / 1000)} s for the first message to expire...`);
await sleep(wait);
const after = (await api("coo", "GET", `/c/${conv}/messages`)).d.messages;
ok("the moment it expires, the API stops returning it", !after.some((m) => m.id === m1.d.message.id));
const fileWait = Math.max(0, mf.d.message.expires_at + 500 - Date.now());
await sleep(fileWait);
const gone = await fetch(`${BASE}/api/v1/staff/chat/files/${ups[1]}`, { headers: hdr("coo") });
ok("the moment a file's message expires, the file cannot be downloaded", gone.status === 404 || gone.status === 410, String(gone.status));
await waitFor(() => sCeo.events.some((e) => e.type === "expired" && e.ids.includes(mf.d.message.id)), 45_000);
ok("the alarm deletes it and tells open screens", sCeo.events.some((e) => e.type === "expired" && e.ids.includes(mf.d.message.id)));
const h = await api("ceo", "GET", "/health");
ok("cleanup is recorded (deleted today, last sweep, nothing overdue)", h.status === 200 && (h.d.days[h.d.today]?.deleted ?? 0) >= 3 && h.d.last_sweep_at > 0 && h.d.overdue === 0, JSON.stringify(h.d));
ok("no live file remains for the deleted message", h.d.live_files <= 4, JSON.stringify(h.d));
let r2gone = false;
try { execFileSync("npx", ["wrangler", "r2", "object", "get", `a2z-chat-temp/f/${ups[1]}`, "--local", "--persist-to", "/tmp/chatdev", "--pipe"], { cwd: new URL("../../worker", import.meta.url).pathname, stdio: "pipe" }); } catch { r2gone = true; }
ok("the R2 object itself is deleted", r2gone);
ok("the inbox no longer previews it", !(await api("coo", "GET", "/inbox")).d.conversations.some((c) => c.last?.id === m1.d.message.id));

console.log("8. Sign-out and suspension end access");
const sSales = await sock("sales");
ok("sales connects", sSales.status === 101);
d1(`UPDATE users SET is_active = 0 WHERE id = ${ID.sales}`);
ok("suspended: the next call is refused at once", (await api("sales", "GET", "/inbox")).status === 401 || (await api("sales", "GET", "/inbox")).status === 403);
const closed = await waitFor(() => sSales.events.some((e) => e.type === "revoked") && sSales.ws.readyState >= 2, 75_000);
ok("suspended: the open connection is revoked and closed within the minute check", closed, String(sSales.ws.readyState));
d1(`UPDATE users SET is_active = 1 WHERE id = ${ID.sales}`);
const sEd = await sock("editor");
ok("editor connects", sEd.status === 101);
const lo = await fetch(`${BASE}/api/v1/auth/logout`, { method: "POST", headers: hdr("editor") });
ok("editor signs out", lo.status < 400, String(lo.status));
ok("signing out revokes and closes the connection at once", await waitFor(() => sEd.events.some((e) => e.type === "revoked") && sEd.ws.readyState >= 2, 4000), String(sEd.ws.readyState));

for (const s of [sCeo, sCoo]) try { s.ws.close(); } catch { /* */ }
console.log(`\nchat-e2e: ${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);

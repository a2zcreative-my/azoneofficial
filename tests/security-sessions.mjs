/* v1.341.0 - SECURITY & SESSIONS 2 AND THE CLOUDFLARE BOT CHECK (the CEO,
   17-11-2026). Two halves:

   RUN  worker/src/security-status.ts is bundled and its botCheck() and
        cloudflareFigures() run against a stubbed Cloudflare and a fake D1:
        off without keys; a missing token refused unless Cloudflare is
        unreachable (the owner's lenient-on-outage rule); a token for another
        door or another site refused; 5xx / network / internal-error = outage
        let through and counted; Cloudflare figures only with a token.
   SOURCE every sign-in door asks botCheck BEFORE any password, passkey,
        Google or link work; the secret never leaves the worker; the screens
        read the status and never state a protection the server did not read;
        the report register is read-only over the existing report flow.

   Usage: node tests/security-sessions.mjs   (NOMUT=1 skips the mutations) */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n"); // a Windows checkout has CRLF; the anchors are written with \n
const fails = [];
let passed = 0;
const ok = (name, cond, extra = "") => { if (cond) passed++; else { fails.push(name); console.log(`  ✗ ${name}${extra ? `  [${extra}]` : ""}`); } };

/* ---------------- RUN ---------------- */
const dir = mkdtempSync(join(tmpdir(), "secst-"));
execSync(`npx esbuild "${join(root, "worker/src/security-status.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(dir, "s.mjs")}" --log-level=error`, { cwd: root, stdio: "inherit" });
const S = await import(pathToFileURL(join(dir, "s.mjs")).href);
rmSync(dir, { recursive: true, force: true });

const meta = new Map();
const DB = {
  prepare(sql) {
    const st = { sql, args: [], bind(...a) { st.args = a; return st; },
      async run() { return exec(st); }, async first() { return null; }, async all() { return { results: [...meta].filter(([k]) => st.args.includes(k)).map(([key, value]) => ({ key, value })) }; } };
    return st;
  },
  async batch(list) { for (const st of list) exec(st); return []; },
};
function exec(st) {
  if (/^INSERT INTO system_meta/.test(st.sql)) { const k = st.args[0]; meta.set(k, String(Number(meta.get(k) ?? 0) + 1)); }
}
const env = (o = {}) => ({ DB, ALLOWED_ORIGIN: "https://a2zcreative.my", ALLOWED_ORIGINS: "https://a2zcreative.my", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET: "secret", ...o });
const req = new Request("https://a2zcreative.my/api/v1/auth/login", { headers: { "CF-Connecting-IP": "203.0.113.9" } });
let answer = null; let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: init?.body });
  if (answer === "network") throw new TypeError("network down");
  if (typeof answer === "number") return new Response("{}", { status: answer });
  return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
};
const TOKEN = "0.ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const counted = (k) => Number(meta.get(`${k}:${day}`) ?? 0);

{
  calls = [];
  const v = await S.botCheck(env({ TURNSTILE_SECRET: undefined }), req, undefined, "signin");
  ok("B1 no secret: the check is off, nothing is asked of Cloudflare", v.ok && v.mode === "off" && calls.length === 0);
  ok("B1 the page gets a site key only when both keys exist", S.botCheckPublic(env({ TURNSTILE_SECRET: undefined })) === null && S.botCheckPublic(env())?.site_key === "site" && !JSON.stringify(S.botCheckPublic(env())).includes("secret"));
}
{
  answer = { success: true, action: "signin", hostname: "a2zcreative.my" }; calls = [];
  const v = await S.botCheck(env(), req, TOKEN, "signin");
  const sent = calls[0]?.body;
  ok("B2 a good token for this door passes, verified server-side with the secret and the client IP", v.ok && v.mode === "passed" && calls[0]?.url === "https://challenges.cloudflare.com/turnstile/v0/siteverify" && sent?.get?.("secret") === "secret" && sent?.get?.("response") === TOKEN && sent?.get?.("remoteip") === "203.0.113.9");
}
{
  const before = counted("bot_refused");
  answer = { success: true, action: "set_password", hostname: "a2zcreative.my" };
  const a = await S.botCheck(env(), req, TOKEN, "signin");
  answer = { success: true, action: "signin", hostname: "evil.example" };
  const h = await S.botCheck(env(), req, TOKEN, "signin");
  answer = { success: false, "error-codes": ["invalid-input-response"] };
  const f = await S.botCheck(env(), req, TOKEN, "signin");
  ok("B3 a token for another door, another site, or a failed one is refused and counted", !a.ok && !h.ok && !f.ok && f.code === "bot_check_failed" && counted("bot_refused") === before + 3);
}
{
  const before = counted("bot_refused");
  answer = { success: false, "error-codes": ["invalid-input-response"] }; calls = [];
  const v = await S.botCheck(env(), req, undefined, "signin");
  ok("B4 no token while Cloudflare answers: refused (bot_check_required)", !v.ok && v.code === "bot_check_required" && calls.length === 1 && counted("bot_refused") === before + 1);
}
{
  const before = counted("bot_outage");
  answer = "network"; const a = await S.botCheck(env(), req, TOKEN, "signin");
  answer = 503; const b = await S.botCheck(env(), req, TOKEN, "signin");
  answer = { success: false, "error-codes": ["internal-error"] }; const c = await S.botCheck(env(), req, TOKEN, "signin");
  answer = "network"; const d = await S.botCheck(env(), req, undefined, "signin");
  ok("B5 Cloudflare unreachable (network, 5xx, its own internal-error), with or without a token: let through and counted - the owner's lenient rule",
    [a, b, c, d].every((v) => v.ok && v.mode === "outage") && counted("bot_outage") === before + 4);
}
{
  const nc = await S.cloudflareFigures(env());
  const cfEnv = env({ CF_API_TOKEN: "t", CF_ZONE_ID: "z" });
  /* both datasets answer */
  const both = async (body) => {
    const q = JSON.parse(body).query;
    return q.includes("httpRequests1hGroups")
      ? { data: { viewer: { zones: [{ http: [{ sum: { requests: 10000, threats: 2 } }, { sum: { requests: 2840, threats: 1 } }] }] } } }
      : { data: { viewer: { zones: [{ fw: [{ count: 96, dimensions: { action: "managed_challenge" } }, { count: 32, dimensions: { action: "block" } }] }] } } };
  };
  const real = globalThis.fetch;
  let mode = "both"; calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url) });
    const q = JSON.parse(init.body).query;
    const out = mode === "partial" && q.includes("firewallEventsAdaptiveGroups")
      ? { data: null, errors: [{ message: "zone 'z' does not have access to the path" }] }
      : await both(init.body);
    return new Response(JSON.stringify(out), { status: 200 });
  };
  const c = await S.cloudflareFigures(cfEnv);
  mode = "partial";
  const p = await S.cloudflareFigures(cfEnv);
  globalThis.fetch = real;
  ok("C1 Cloudflare figures: none without a token; with one, each dataset asked SEPARATELY and summed",
    nc.connected === false && calls.length >= 2 && calls.every((x) => x.url === "https://api.cloudflare.com/client/v4/graphql")
    && c.traffic.ok && c.traffic.value.requests_24h === 12840 && c.traffic.value.threats_24h === 3
    && c.firewall.ok && c.firewall.value.total_24h === 128 && c.firewall.value.by_action[0].action === "managed_challenge");
  ok("C3 one dataset refused (the CEO's zone, 17-11-2026) never hides the other: traffic read, the firewall's refusal kept as its reason",
    p.connected && p.traffic.ok && p.traffic.value.requests_24h === 12840 && p.firewall.ok === false && /does not have access to the path/.test(p.firewall.error));
}
ok("C2 the file status says it is not antivirus", S.FILE_CHECKS.antivirus === false && /not scanned for viruses/.test(S.FILE_CHECKS.note));

/* ---------------- SOURCE ---------------- */
const src = {
  idx: read("worker/src/index.ts"), staff: read("worker/src/staff.ts"), st: read("worker/src/security-status.ts"),
  login: read("app/login/page.tsx"), link: read("components/auth/link-page.tsx"), bot: read("components/security/bot-check.tsx"),
  sess: read("components/portal/security-sessions.tsx"), status: read("components/portal/security-status.tsx"),
  support: read("components/portal/support-card.tsx"), users: read("components/portal/users-panel.tsx"),
  headers: read("public/_headers"),
};
function source(s) {
  const f = [];
  const t = (name, cond) => { if (!cond) f.push(name); };
  const block = (start, end) => { const i = s.idx.indexOf(start); return i < 0 ? "" : s.idx.slice(i, s.idx.indexOf(end, i + start.length)); };
  const login = block('if (path === "/api/v1/auth/login" && method === "POST")', "verifyPassword(");
  t("S1 password sign-in: the bot check comes before any password work, and a refusal counts against the IP",
    /const botV = await botCheck\(env, request, body\.bot_token, "signin"\);\s*if \(!botV\.ok\) \{\s*await bumpRateLimit\(env, keyIp, 900\);\s*return errorResponse\(botV\.code, BOT_REFUSED_MESSAGE, 403\);/.test(login));
  t("S2 passkey sign-in: checked before the passkey ceremony starts",
    /if \(path === "\/api\/v1\/auth\/passkey\/login\/options" && method === "POST"\) \{[\s\S]{0,200}botCheck\(env, request, b\?\.bot_token, "signin"\);\s*if \(!v\.ok\) return errorResponse/.test(s.idx) && s.idx.indexOf('"/api/v1/auth/passkey/login/options" && method === "POST"') < s.idx.indexOf("return handlePasskeys("));
  t("S3 Google: checked before Google is asked", /const botG = await botCheck\(env, request, new URL\(request\.url\)\.searchParams\.get\("bt"\), "signin"\);\s*if \(!botG\.ok\) return new Response\(null, \{ status: 302, headers: \{ Location: "\/login\?error=bot" \} \}\);\s*const g = await beginGoogle\("signin"\);/.test(s.idx));
  t("S4 registration and set-password are checked before their work", /const botR = await botCheck\(env, request, body\?\.bot_token, "register"\);\s*if \(!botR\.ok\)/.test(s.idx) && /const botS = await botCheck\(env, request, b\?\.bot_token, "set_password"\);\s*if \(!botS\.ok\)[\s\S]{0,120}const tok =/.test(s.idx));
  t("S5 the page learns only the PUBLIC site key; the secret never leaves the worker",
    /bot_check: botCheckPublic\(env\)/.test(s.idx) && !/TURNSTILE_SECRET/.test(s.login + s.link + s.bot + s.sess + s.status + s.support + s.users));
  t("S6 the rate limits, 2FA and passkey rules are untouched (still before / after the check)",
    /isRateLimited\(env, keyAcct, 10, 900\) \|\| await isRateLimited\(env, keyIp, 30, 900\)/.test(login) && /twofa_required: true, challenge/.test(s.idx));
  t("S7 the status read is the System health door (CEO and up), read-only",
    /if \(path === "\/api\/v1\/system\/security" && method === "GET"\) \{\s*if \(!atLeast\(user, "ceo"\)\) return errorResponse\("forbidden"/.test(s.idx) && !/INSERT INTO sessions|DELETE FROM sessions|UPDATE sessions/.test(s.st));
  /* v1.341.1 - the site's security policy lets Cloudflare's widget load (script) and run its challenge (frame);
     without it the browser blocked the check and nobody could sign in (17-11-2026) */
  const csp = s.headers.match(/^\s*Content-Security-Policy: (.+)$/m)?.[1] ?? "";
  t("S8 the site's CSP allows Turnstile: script-src and frame-src name https://challenges.cloudflare.com",
    /script-src [^;]*https:\/\/challenges\.cloudflare\.com/.test(csp) && /frame-src [^;]*https:\/\/challenges\.cloudflare\.com/.test(csp));
  /* the screens */
  t("U1 the sign-in page and the set-password page use the one hook and send the token", /useBotCheck\(botKey, "signin"\)/.test(s.login) && /bot_token: bot\.token/.test(s.login) && /\?bt=\$\{encodeURIComponent\(bot\.token\)\}/.test(s.login) && /useBotCheck\(botKey, "set_password"\)/.test(s.link) && /bot_token: bot\.token/.test(s.link));
  /* v1.344.0 - the five sub-tabs follow the owner's five reference images (17-11-2026) */
  t("U2 Overview: one KPI strip of four, the 2FA, passkey and recovery controls kept",
    (s.sess.slice(s.sess.indexOf('<KpiRow label={L("Security figures"'), s.sess.indexOf("</KpiRow>")).match(/<KpiTile /g) ?? []).length === 4 && /"control-recovery"/.test(s.sess) && /"control-passkeys"/.test(s.sess) && /"control-2fa"/.test(s.sess));
  t("U3 the protection row never says Active unless the server says the bot check is on", /<span className=\{s\.bot_check\.enabled \? chipSmSuccess : chipSmWarn\}>\{s\.bot_check\.enabled \? L\("Active", "Aktif"\) : L\("Off", "Mati"\)\}<\/span>/.test(s.status));
  t("U4 each Cloudflare figure shown only from its own read answer - otherwise Not connected / Read failed, never a number",
    /const waf[^=]*= !cf\.connected\s*\? \{ value: L\("Not connected"/.test(s.status) && /: \{ value: L\("Read failed", "Gagal dibaca"\)/.test(s.status) && /value=\{tr\?\.ok \? fmt\(tr\.value\.threats_24h\) : "—"\}/.test(s.status)
      && /fw\?\.ok \? \{ value: L\("Reading", "Dibaca"\), sub: L\(`\$\{fmt\(fw\.value\.total_24h\)\}/.test(s.status)
      && /value=\{L\("Not scanning", "Tiada imbasan"\)\}/.test(s.status) /* no antivirus exists: never a scan figure */);
  t("U5 System health keeps the existing errors-and-backups card under the new strip", /<SecurityHealth s=\{secStatus\}[^\n]*\/>\s*<div id="system-health"><SystemHealthCard \/><\/div>/.test(s.users));
  t("U6 Problem reports: the register over the SAME report sheet, the receiver card kept, records open in Tasks", /<ReportsRegister \/>\s*<SupportCard \/>/.test(s.users) && /<ReportProblem tab="Users & Security" onSent=/.test(s.support) && /const openTask = \(id: number\) => portal\?\.openRecord\("Tasks", "task", id\);/.test(s.support)
    && (() => { const tr = s.staff.slice(s.staff.indexOf("const trailM = path.match"), s.staff.indexOf('if (path === "/support/report" && method === "POST")'));
      /* the resolution trail is a read: the register's own gate, never a write */
      return tr.length > 0 && !/INSERT|UPDATE|DELETE/.test(tr) && /const mayT = user\.role === "super_admin" \|\| user\.role === "ceo" \|\| user\.is_owner === true \|\| \(recvT !== null && recvT\.id === user\.id\);\s*if \(!mayT\) return err\("forbidden"/.test(tr); })());
  t("U7 Company owner and Office location: the same owner card and geofence save, now as pages", /\{secPart === "owner" && ownerState && ownerZone\}/.test(s.users) && /<OwnerPage state=\{ownerState\}/.test(s.users)
    && /<TabZone label=\{L\("Office location", "Lokasi pejabat"\)\}>\s*<GeofenceCard onAudit=/.test(s.users));
  /* strip above the sub-tabs (the CEO 21-11-2026) - the strip ABOVE the sub-tab row, on every part; the Overview hidden, never unmounted */
  const kpiAt = s.sess.indexOf('<KpiRow label={L("Security figures"'), tabsAt = s.sess.indexOf("{tabs}"), bodyAt = s.sess.indexOf('<div hidden={!overview} data-testid="security-sessions">'), partsAt = s.sess.indexOf("{children}");
  t("U8 the strip comes first, then the sub-tab row, the Overview (hidden when closed), then the other parts",
    kpiAt > 0 && kpiAt < tabsAt && tabsAt < bodyAt && bodyAt < partsAt && (s.sess.match(/<KpiRow /g) ?? []).length === 1
    && /tabs=\{<LineTabs value=\{secPart\} onChange=\{setSecPart\}[^\n]*testid="sec-part"/.test(s.users) && (s.users.match(/testid="sec-part"/g) ?? []).length === 1
    && /overview=\{secPart === "overview"\}/.test(s.users) && !/secPart === "overview" &&/.test(s.users));
  /* the register */
  const reg = s.staff.slice(s.staff.indexOf('if (path === "/support/reports" && method === "GET")'), s.staff.indexOf('if (path === "/support/report" && method === "POST")'));
  t("R1 a security incident is a kind of the existing report (a Task, high priority)", /security: \["Security incident", "high"\],/.test(s.staff));
  t("R2 the register is read-only and only for the receiver, the owner, the CEO and the super admin",
    reg.length > 0 && !/INSERT|UPDATE|DELETE/.test(reg) && /const may = user\.role === "super_admin" \|\| user\.role === "ceo" \|\| user\.is_owner === true \|\| \(recv !== null && recv\.id === user\.id\);\s*if \(!may\) return err\("forbidden"/.test(reg));
  return f;
}
const sf = source(src);
for (const n of sf) { fails.push(n); console.log(`  ✗ ${n}`); }
passed += 17 - sf.length;

let caught = 0;
const MUT = [
  ["the password door skips the check", "idx", 'const botV = await botCheck(env, request, body.bot_token, "signin");', 'const botV = { ok: true } as const;'],
  ["the Google door asks Google first", "idx", 'const botG = await botCheck(env, request, new URL(request.url).searchParams.get("bt"), "signin");\n    if (!botG.ok) return new Response(null, { status: 302, headers: { Location: "/login?error=bot" } });\n    const g = await beginGoogle("signin");', 'const g = await beginGoogle("signin");'],
  ["the secret sent to the page", "idx", "bot_check: botCheckPublic(env)", "bot_check: { site_key: env.TURNSTILE_SITE_KEY, secret: env.TURNSTILE_SECRET }"],
  ["a fifth tile stacked on the Overview", "sess", '<KpiTile icon="warning" tone="red" label={L("Security Alerts"', '<KpiTile icon="warning" label="x" value={0} /><KpiTile icon="warning" tone="red" label={L("Security Alerts"'],
  ["the WAF shown as protected without a read", "status", '= !cf.connected\n    ? { value: L("Not connected"', '= !cf.connected\n    ? { value: L("Active", "Aktif"), sub: "", tone: "green" } as never ?? { value: L("Not connected"'],
  ["a malware scan figure invented", "status", 'value={L("Not scanning", "Tiada imbasan")}', 'value={L("Clean", "Bersih")}'],
  ["the trail opened to every staff member", "staff", "    if (!mayT) return err(", "    if (false) return err("],
  ["the register may write", "staff", "    const labels = Object.fromEntries(Object.entries(SUPPORT_KINDS)", "    await env.DB.prepare(`UPDATE tasks SET status = 'completed'`).run();\n    const labels = Object.fromEntries(Object.entries(SUPPORT_KINDS)"],
  ["the CSP blocks Cloudflare's script again", "headers", " https://static.cloudflareinsights.com https://challenges.cloudflare.com;", " https://static.cloudflareinsights.com;"],
  ["the sub-tab row drawn above the strip again", "sess", '<KpiRow label={L("Security figures"', '{tabs}\n      <KpiRow label={L("Security figures"'],
  ["the Overview unmounted on the other parts again", "users", 'overview={secPart === "overview"}', 'overview={secPart === "overview"} {...(secPart === "overview" && {})}'],
  ["the old errors card dropped from System health", "users", '<div id="system-health"><SystemHealthCard /></div>', '<div id="system-health" />'],
];
if (!process.env.NOMUT) {
  for (const [name, k, a, b] of MUT) {
    if (!src[k].includes(a)) { fails.push(`mutation anchor missing: ${name}`); console.log(`  ✗ mutation anchor missing: ${name}`); continue; }
    if (source({ ...src, [k]: src[k].replace(a, b) }).length > 0) caught++; else { fails.push(`mutation not caught: ${name}`); console.log(`  ✗ mutation not caught: ${name}`); }
  }
}
if (fails.length) { console.log(`security-sessions: ${fails.length} failed`); process.exit(1); }
console.log(`security-sessions: ${passed} checks passed (${caught} mutations caught) - every sign-in door asks Cloudflare first, lenient only when Cloudflare is down, and the screens show only what the server read`);

/**
 * THE STATIC EXPORT PLUS A FIXTURE API ON ONE ORIGIN — v1.175.0, in the repo.
 *
 * A browser that cannot intercept requests (WebKitGTK via WebDriver) needs the
 * API on the same origin as the page, which is what this is for. Serve the
 * `out/` directory a production build produced, then point a probe at it.
 *
 *   pnpm build && node tests/browser/serve.mjs out 4177
 *   ROLE=live_host node tests/browser/serve.mjs out 4177
 *
 * env: ROLE (which role is signed in), ALREADY_PUNCHED=1 (the clock-out
 * endpoint answers "already punched", for checking that toast).
 *
 * No dependencies: plain Node.
 */
import http from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { fixture } from "./fixture.mjs";

const [dir, portS] = process.argv.slice(2);
const port = Number(portS ?? 4177);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".ttf": "font/ttf", ".webp": "image/webp", ".jpg": "image/jpeg" };
const missing = new Set();
/* v1.241.0 (go-live audit, Release A) - three fixtures the release-a probe
   drives:
   TWOFA=1        the signed-in person still owes 2FA (requires_2fa on
                  /auth/me) until POST /auth/2fa/enable with code 123456 (A3);
                  /auth/login answers twofa_required and /auth/2fa/verify takes
                  123456 or the backup code AAAA2-1111B (A1); with LOGIN_FIRST=1
                  /auth/me is 401 until that verify succeeds
   HEALTH_VERSION what /health reports as the worker's version (F6)
   /__break?on=1  from then on, a chunk this server has NOT yet served answers
                  404 - a deploy that replaced the chunks under an open page;
                  &once=1 ends it at the next /portal page load (the reload
                  "fetched the new site"). /__fixture-status counts the page
                  loads and the 404s. */
const pkgVersion = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8")).version;
let twofaOn = false;
let signedIn = !process.env.LOGIN_FIRST; // LOGIN_FIRST=1: nobody is signed in until /auth/2fa/verify succeeds
const servedChunks = new Set();
let chunksBroken = false, breakOnce = false, portalLoads = 0, chunk404s = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/__fixture-status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ role: process.env.ROLE ?? "ceo", missing: [...missing], portal_loads: portalLoads, chunk_404s: chunk404s, chunks_broken: chunksBroken, twofa_on: twofaOn })); return;
  }
  if (url.pathname === "/__break") {
    chunksBroken = url.searchParams.get("on") === "1";
    breakOnce = url.searchParams.get("once") === "1";
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ chunks_broken: chunksBroken, once: breakOnce })); return;
  }
  if (url.pathname.startsWith("/api/v1/")) {
    const p = url.pathname.replace("/api/v1", "");
    if ((req.headers.accept ?? "").includes("text/event-stream")) { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": fixture\n\n"); return; }
    /* v1.181.4 - a stored photo is an IMAGE, not JSON: answer every media
       file with the app icon, so an avatar drawn from a photo_key renders in
       the probes instead of silently falling back to the initial. */
    if (req.method === "GET" && p.startsWith("/media/file/")) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(readFileSync(join(dir, "icon-192.png")));
      return;
    }
    if (req.method === "GET" && p === "/auth/me" && !signedIn) {
      res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "unauthorized", message: "Sign in required" } })); return;
    }
    if (req.method === "GET" && p === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, db: true, version: process.env.HEALTH_VERSION ?? pkgVersion, elfia_bridge: { configured: false } })); return;
    }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (process.env.TWOFA && req.method === "POST" && p === "/auth/login") {
        /* the password is accepted; a code is owed (the worker's twofa_required + challenge) */
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ twofa_required: true, challenge: "ch-fixture" })); return;
      }
      if (process.env.TWOFA && p.startsWith("/auth/2fa/") && req.method === "POST") {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        if (p === "/auth/2fa/verify") {
          /* an authenticator code, or one of the backup codes exactly as issued (ABCDE-FGHIJ) */
          const good = b.challenge === "ch-fixture" && (b.code === "123456" || b.code === "AAAA2-1111B");
          if (good) signedIn = true;
          res.writeHead(good ? 200 : 401, { "content-type": "application/json" });
          res.end(JSON.stringify(good ? { user: { id: 9001, name: "Fixture Person", role: process.env.ROLE ?? "ceo", email: "fixture@example.test" } } : { error: { code: "invalid_code", message: "That code is not correct" } })); return;
        }
        if (p === "/auth/2fa/setup") {
          if (!b.password) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "password_required", message: "Your current password is required" } })); return; }
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ secret: "JBSWY3DPEHPK3PXP", otpauth: "otpauth://totp/A2Z%20CREATIVE%20MARKETING:fixture%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=A2Z%20CREATIVE%20MARKETING" })); return;
        }
        if (p === "/auth/2fa/enable") {
          if (b.code !== "123456") { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "invalid_code", message: "That code is not correct." } })); return; }
          twofaOn = true;
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, backup_codes: ["AAAA-1111", "BBBB-2222", "CCCC-3333", "DDDD-4444", "EEEE-5555", "FFFF-6666", "GGGG-7777", "HHHH-8888"] })); return;
        }
      }
      if (process.env.ALREADY_PUNCHED && req.method === "POST" && p === "/staff/attendance") {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "already_punched", message: "You already clocked out at 18:31 MYT. Clock in again when your next shift starts." }, already: true, at: "18:31" }));
        return;
      }
      /* v1.225.1 - TT_SYNC=expired: TikTok refused the shop's token (the
         worker's 401 not_authorized); TT_SYNC=forbidden: the role may not sync */
      if (process.env.TT_SYNC && req.method === "POST" && p === "/integrations/tiktok/sync") {
        const expired = process.env.TT_SYNC === "expired";
        res.writeHead(expired ? 401 : 403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: expired ? { code: "not_authorized", message: "TikTok sign-in has expired - re-authorize from the TikTok Partner Center and make sure TIKTOK_APP_SECRET matches." } : { code: "forbidden", message: "Inventory access required" } }));
        return;
      }
      /* v1.236.0 - OWNER=1: the owner's privileged changes and naming the
         owner answer 401 totp_required until an authenticator code is sent
         (the worker's ownerStepUp / requireFreshTotp) */
      /* v1.237.0 - a matrix edit asks for the code too (owner or super admin) */
      if (req.method === "POST" && p === "/staff/access/policy") {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        if (!b.totp) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "totp_required", message: "Enter your 6-digit authenticator code" } })); return; }
      }
      if (process.env.OWNER && req.method === "POST" && (/^\/staff\/users\/\d+\/role$/.test(p) || p === "/staff/owner")) {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        const priv = p === "/staff/owner" || ["customer", "coo", "cco", "admin", "ceo"].includes(b.role);
        if (priv && !b.totp) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "totp_required", message: "Enter your 6-digit authenticator code" } })); return; }
      }
      /* v1.238.0 - every account action asks for the editor's code first;
         a set-password link is shown once (email off); a report becomes task 77 */
      if (req.method === "POST" && /^\/staff\/accounts\//.test(p)) {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        if (!b.totp) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "totp_required", message: "Enter your 6-digit authenticator code" } })); return; }
        const out = p.endsWith("/password-link") ? { ok: true, emailed: false, expires_in_hours: 24, link: "https://portal.example.test/set-password#token=" + "ab".repeat(32) }
          : p.endsWith("/email") ? { ok: true, applied: b.route === "in_person", change_id: 4, needs_second: false, sent: false } : { ok: true };
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out)); return;
      }
      if (req.method === "POST" && p === "/enquiries/introduce") { res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, id: 501 })); return; }
      if (req.method === "POST" && p === "/staff/support/report") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, task_id: 77, assigned_to: "Fixture Person" })); return; }
      if (req.method === "POST" && /^\/users\/\d+\/offboard$/.test(p)) {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        if (process.env.OWNER && !b.totp) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "totp_required", message: "Enter your 6-digit authenticator code" } })); return; }
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, status: "resigned", left_on: b.left_on, moved: b.handover_to ? { tasks: 2, followups: 1 } : { tasks: 0, followups: 0 } })); return;
      }
      if (req.method === "POST" && (p === "/auth/email-verify" || p === "/auth/set-password")) {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        const good = b.token === "cd".repeat(32);
        res.writeHead(good ? 200 : 400, { "content-type": "application/json" });
        res.end(JSON.stringify(good ? { ok: true, email: "aisyah@a2zcreative.test" } : { error: { code: "link_invalid", message: "This link is not valid any more - it was used, it expired, or it was replaced. Ask for a new one." } })); return;
      }
      const data = req.method === "GET" ? fixture(p, url.toString(), { onMissing: path => missing.add(path) }) : { ok: true, ...(p.endsWith("/responsibilities") ? { role_title: "x", responsibilities: [] } : {}) };
      if (process.env.TWOFA && req.method === "GET") {
        if (p === "/auth/me" && data?.user) data.user.requires_2fa = !twofaOn;
        if (p === "/auth/2fa/status") Object.assign(data, { enabled: twofaOn, backup_codes_left: twofaOn ? 8 : 0 });
      }
      /* v1.199.0 - a fixture that answers { error: { code: "forbidden" } } is a
         refusal, sent with the worker's 403, so a role-gated read can be walked */
      res.writeHead(data?.error?.code === "forbidden" ? 403 : 200, { "content-type": "application/json" }); res.end(JSON.stringify(data));
    });
    return;
  }
  /* P0.2 - THE TOKEN SPECIMEN. A development page, not a route: it lives in
     tests/browser/ so no production build contains it and no URL on the live
     site can reach it. Served here because it must be judged against the CSS
     the build ACTUALLY produced, whose filenames are content-hashed - so the
     stylesheets are discovered and injected rather than named. */
  if (url.pathname === "/__tokens") {
    const cssDir = join(dir, "_next", "static", "chunks");
    const sheets = existsSync(cssDir)
      ? readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => `<link rel="stylesheet" href="/_next/static/chunks/${f}">`).join("\n")
      : "";
    const html = readFileSync(join(import.meta.dirname, "tokens.html"), "utf8").replace("</head>", `${sheets}\n</head>`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  if (url.pathname.startsWith("/_next/static/chunks/")) {
    if (chunksBroken && !servedChunks.has(url.pathname)) { chunk404s++; res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    servedChunks.add(url.pathname);
  }
  if (url.pathname === "/portal" || url.pathname === "/portal/") {
    portalLoads++;
    if (chunksBroken && breakOnce && portalLoads > 1) chunksBroken = false;
  }
  let file = join(dir, decodeURIComponent(url.pathname.replace(/\/+$/, "") || "/"));
  if (existsSync(file) && statSync(file).isDirectory()) file = existsSync(join(file, "index.html")) ? join(file, "index.html") : file + ".html";
  if (!existsSync(file)) { const alt = file + ".html"; if (existsSync(alt)) file = alt; else { const nf = join(dir, "404.html"); if (existsSync(nf)) { res.writeHead(404, { "content-type": "text/html" }); res.end(readFileSync(nf)); return; } res.writeHead(404); res.end("not found"); return; } }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log(`BROWSER_FIXTURE_READY ${server.address().port}`));

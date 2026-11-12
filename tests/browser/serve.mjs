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
import { fixture, projectFixture } from "./fixture.mjs";
import { fa, faRoute, resetFa } from "./fa-fixture.mjs";

/* v1.247.0 - the task email settings as the worker answers them by default (task-mail.ts DEFAULT_SETTINGS) */
const MAIL_SETTINGS = { enabled: true, triggers: { assigned: true, moved: true, update: true, mention: true, review: true, decision: true, due: true, overdue: true, escalation: true, reminder: true, digest: false, test: true }, lead_hours: 24, escalation_days: 2, overdue_days: [1, 3, 7], digest_on: false, digest_time: "08:30", quiet_from: "21:00", quiet_to: "08:00", cap_per_day: 8 };
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
/* v1.242.0 (go-live Release B) - the void / convert lifecycle, stateful:
   POST /docs/:id/void (reason >= 10) marks the row void; GET /docs shows it
   so; POST /docs/:id/convert answers once (201) and then 409
   already_invoiced; SLOW_CONVERT=<ms> makes the convert take that long, so a
   busy button can be observed; DELETE /docs/:id refuses an invoice. */
const voided = new Map();
const converted = new Set();
const slowConvert = Number(process.env.SLOW_CONVERT ?? 0);
/* v1.243.0 (go-live Release C) - two more, stateful:
   POP=1          GET /staff/payroll?month=2026-09 carries the server's payroll
                  population: Farid has no bank details (blocks Paid), Tan's
                  login is suspended (a note); POST /staff/payroll/manual-payment
                  resolves Farid's; POST /staff/payroll/paid is refused 409
                  exceptions_open while anything blocks
   /__punch?status=401|409|200   what POST /staff/attendance answers from then
                  on (default 200); /__fixture-status lists every punch POST
                  with its Idempotency-Key and X-Client-At (punch_log);
                  /__reset puts all of it back as at start */
/* v1.244.0 (go-live Release D) - /__mediabk?state=unbound|pending|ok|damaged
   adds that media-copy state to GET /system/health (none: as before) */
let mediaBk = null;
let punchStatus = 200;
const punchLog = [];
let manualPaid = null;
/* v1.245.0 - PROJECT=none: QT 1 has no brief until Create project brief is pressed; posted updates are kept (/__projects) */
let projectMade = false;
const projectPosts = [];
const taskPosts = []; // v1.246.0
const salesPosts = []; // v1.262.0 - Sales discipline writes, for the probe at /__sales
/* v1.269.0 - Phase 2A: PASSKEYS=1 means stage A; what the browser posted is kept for /__passkeys */
const pk = { creds: [], posts: [], issued: [], n: 0 };
/* v1.272.0 - PAYV=1: payment verification is on; two open invoices (A2Z and
   AZ ONE), one payment already reported by Aina with its proof (for the CEO's
   review). Every write is kept for /__payments. 123456 is the code. */
const payInit = () => ({
  on: !!process.env.PAYV, n: 2, posts: [],
  invoices: [
    { id: 501, doc_number: "INV-A2Z-501", total_cents: 120000, customer: "Maju Engineering", salesperson: "Fixture Person", company: "a2z", verified: 0, paid: false },
    { id: 502, doc_number: "INV-AZOO-502", total_cents: 30000, customer: "Putra Hotel", salesperson: "Fixture Person", company: "azoo", verified: 0, paid: false },
    /* v1.278.0 - PAYDOCS=1: the documents list's own unpaid invoice (id 3) is
       open in Payments too, RM 3,000 of it verified - the Sales list's money state */
    ...(process.env.PAYDOCS ? [{ id: 3, doc_number: "INV-AZO050926-3", total_cents: 990000, customer: "Casa del Rio Sdn Bhd", salesperson: "Fixture Person", company: "azoo", verified: 300000, paid: false }] : []),
    /* v1.282.0 - PAYOWN=1 (Payment Verification 3.0): an invoice the signed-in person
       reported themselves (the live RM 37.50 case, invented names) and one part-paid invoice */
    /* v1.285.0 - CEOPAY=1: Aina's invoice, for the CEO's Mark paid on her behalf */
    ...(process.env.CEOPAY ? [{ id: 506, doc_number: "INV-A2Z-506", total_cents: 45000, customer: "Kedai Aina", salesperson: "Aina Seller", company: "a2z", verified: 0, paid: false }] : []),
    ...(process.env.PAYOWN ? [
      { id: 503, doc_number: "INV-AZOO-503", total_cents: 3750, customer: "Kedai Contoh", salesperson: "Fixture Person", company: "azoo", verified: 0, paid: false },
      { id: 504, doc_number: "INV-A2Z-504", total_cents: 120000, customer: "Syarikat Contoh", salesperson: "Fixture Person", company: "a2z", verified: 60000, paid: false },
    ] : []),
  ],
  reports: [{ id: 1, invoice_id: 501, issuer_code: "a2z", amount_cents: 60000, received_on: "2026-11-04", method: "bank_transfer", reference: "MBB 0001", note: null, over_cents: 0, dup_of: null, state: "reported", reported_by: 77, reporter: "Aina Seller", reporter_role: "sales_marketing", reported_at: "2026-11-04 02:00:00", has_proof: true, evidence_by: null, decided_at: null, verified_cents: null, question: null }],
  ...(process.env.PAYOWN ? { n: 3, reports: [
    { id: 1, invoice_id: 501, issuer_code: "a2z", amount_cents: 60000, received_on: "2026-11-04", method: "bank_transfer", reference: "MBB 0001", note: null, over_cents: 0, dup_of: null, state: "reported", reported_by: 77, reporter: "Aina Seller", reporter_role: "sales_marketing", reported_at: "2026-11-04 02:00:00", has_proof: true, evidence_by: null, decided_at: null, verified_cents: null, question: null },
    { id: 2, invoice_id: 503, issuer_code: "azoo", amount_cents: 3750, received_on: "2026-11-11", method: "bank_transfer", reference: "8632221420", note: null, over_cents: 0, dup_of: null, state: "reported", reported_by: (process.env.ROLE ?? "ceo") === "ceo" ? 9001 : 1, reporter: (process.env.ROLE ?? "ceo") === "ceo" ? "Fixture Person" : "Owner Person", reporter_role: "ceo", reported_at: "2026-11-11 02:24:00", has_proof: true, evidence_by: null, decided_at: null, verified_cents: null, question: null },
    { id: 3, invoice_id: 504, issuer_code: "a2z", amount_cents: 60000, received_on: "2026-11-02", method: "bank_transfer", reference: "MBB 0003", note: null, over_cents: 0, dup_of: null, state: "verified", reported_by: 77, reporter: "Aina Seller", reporter_role: "sales_marketing", reported_at: "2026-11-02 02:00:00", has_proof: true, evidence_by: null, decided_at: "2026-11-03 03:00:00", decided_name: "Fixture Person", bank_name: "A2Z account", verify_method: "bank_statement", verified_cents: 60000, question: null },
  ] } : {}),
  events: [{ id: 1, invoice_id: 501, report_id: 1, event: "reported", amount_cents: 60000, detail: null, created_at: "2026-11-04 02:00:00", actor: "Aina Seller" }, { id: 2, invoice_id: 501, report_id: 1, event: "proof_uploaded", amount_cents: null, detail: null, created_at: "2026-11-04 02:01:00", actor: "Aina Seller" }],
});
let pay = payInit();
let signedIn = !process.env.LOGIN_FIRST; // LOGIN_FIRST=1: nobody is signed in until /auth/2fa/verify succeeds
const servedChunks = new Set();
let chunksBroken = false, breakOnce = false, portalLoads = 0, chunk404s = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/__fixture-status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ role: process.env.ROLE ?? "ceo", fa_posts: fa.posts, missing: [...missing], portal_loads: portalLoads, chunk_404s: chunk404s, chunks_broken: chunksBroken, twofa_on: twofaOn, punch_log: punchLog, manual_paid: manualPaid })); return;
  }
  if (url.pathname === "/__payments") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(pay)); return; }
  if (url.pathname === "/__passkeys") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(pk)); return; }
  if (url.pathname === "/__sales") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ posts: salesPosts })); return; }
  if (url.pathname === "/__tasks") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ posts: taskPosts })); return; }
  if (url.pathname === "/__projects") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ made: projectMade, posts: projectPosts })); return; }
  if (url.pathname === "/__reset") { // v1.243.0 - a probe starts from a clean fixture
    resetFa(); // v1.284.0
    signedIn = !process.env.LOGIN_FIRST; // v1.264.0 - signed out again for a LOGIN_FIRST probe
    pay = payInit(); // v1.272.0
    punchStatus = 200; punchLog.length = 0; manualPaid = null; mediaBk = null; voided.clear(); converted.clear(); projectMade = false; projectPosts.length = 0; taskPosts.length = 0; pk.creds = []; pk.posts = []; pk.issued = [];
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return;
  }
  if (url.pathname === "/__mediabk") {
    mediaBk = url.searchParams.get("state") || null;
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ media_backup: mediaBk })); return;
  }
  if (url.pathname === "/__punch") {
    punchStatus = Number(url.searchParams.get("status") ?? 200);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ punch_status: punchStatus })); return;
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
    /* v1.246.0 - a private task or project file streams like a media file */
    if (req.method === "GET" && /^\/staff\/(tasks|projects)\/\d+\/files\/\d+$/.test(p)) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(readFileSync(join(dir, "icon-192.png")));
      return;
    }
    /* v1.249.2 - an officer chop from the /admin vault is an image too */
    if (req.method === "GET" && /^\/staff\/signature\/(a2z|azoo)\/[a-z-]+-sign\.png$/.test(p)) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(readFileSync(join(dir, "icon-192.png")));
      return;
    }
    if (req.method === "GET" && p.startsWith("/media/file/")) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(readFileSync(join(dir, "icon-192.png")));
      return;
    }
    /* v1.264.0 - which ways in are on (GOOGLE_OFF=1: the owner turned Google off) */
    if (req.method === "GET" && p === "/auth/methods") {
      const on = !process.env.GOOGLE_OFF;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ password: true, google: on, google_customer_signup: on, passkeys: !!process.env.PASSKEYS })); return;
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
          /* v1.264.0 (G4) - a Google sign-in's challenge comes in the HttpOnly
             twofa_ch cookie, with no challenge in the body; 999999 plays a
             challenge that lapsed while the code was typed */
          const viaCookie = !b.challenge && /(?:^|; )twofa_ch=ch-google(?:;|$)/.test(req.headers.cookie ?? "");
          if (viaCookie && b.code === "999999") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "challenge_expired", message: "This sign-in attempt expired - start again" } })); return; }
          const good = (b.challenge === "ch-fixture" || viaCookie) && (b.code === "123456" || b.code === "AAAA2-1111B");
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
      /* v1.266.0 - Phase 1c: a customer's emailed code (password "correct horse"), the owner's
         settings and legacy notice, customer recovery (the link shown once) */
      const jb = () => { try { return JSON.parse(body || "{}"); } catch { return {}; } };
      const send = (st, o) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.method === "POST" && p === "/auth/google/code") {
        const b = jb();
        return b.password === "correct horse" ? send(200, { sent: true, to: "fi***@example.test" }) : send(401, { error: { code: "invalid_password", message: "That password is not correct." } });
      }
      if (req.method === "POST" && p === "/auth/google/disconnect") return send(200, { ok: true });
      /* v1.278.0 - with verification on, nobody marks an invoice paid (staff.ts PATCH /docs/:id, 409) */
      if (req.method === "PATCH" && /^\/staff\/docs\/\d+$/.test(p) && pay.on) {
        const b = jb();
        pay.posts.push({ path: p, method: "PATCH", body: b });
        if (b.payment_status === "paid") return send(409, { error: { code: "payment_verification_on", message: "INV-AZO050926-3 becomes paid when the CEO verifies its payments. Report the payment in Sales -> Payments." } });
      }
      /* v1.284.0 - Financial Advisory (FA=1), invented fixture data (fa-fixture.mjs) */
      if (process.env.FA && p.startsWith("/staff/fa/")) { const r = faRoute(p, req.method, jb()); if (r) return send(r[0], r[1]); }
      /* v1.272.0 - Sales -> Payments (PAYV=1), stateful, the server's rules in small */
      if (p === "/staff/payments" || p.startsWith("/staff/payments/") || /^\/staff\/docs\/\d+\/payment-reports$/.test(p) || p.startsWith("/staff/payment-reports/")) {
        const role = process.env.ROLE ?? "ceo";
        /* v1.285.0 - the owner alone verifies, his own reports included; no evidence check */
        const caps = { report: ["ceo", "coo", "cco", "sales_marketing"].includes(role), verify: role === "ceo" && !!process.env.OWNER, evidence: false, switch: role === "ceo" && !!process.env.OWNER, all: ["ceo", "coo", "cco"].includes(role) };
        const pend = (i) => pay.reports.filter((r) => r.invoice_id === i.id && ["reported", "evidence_checked", "clarify"].includes(r.state)).reduce((a, r) => a + r.amount_cents, 0);
        const statusOf = (i) => i.paid ? "paid" : i.verified === 0 ? (pend(i) ? "reported" : "unpaid") : i.verified + pend(i) >= i.total_cents ? "fully_reported" : "partial";
        const deco = (r) => ({ ...r, mine: r.reported_by === 9001, needs_evidence: false, doc_number: pay.invoices.find((i) => i.id === r.invoice_id)?.doc_number, customer: pay.invoices.find((i) => i.id === r.invoice_id)?.customer, total_cents: pay.invoices.find((i) => i.id === r.invoice_id)?.total_cents });
        const ev = (i, rid, event, amount, detail = null) => pay.events.push({ id: pay.events.length + 1, invoice_id: i, report_id: rid, event, amount_cents: amount, detail: detail ? JSON.stringify(detail) : null, created_at: "2026-11-05 02:00:00", actor: "Fixture Person" });
        const picture = (i) => ({ invoice: { id: i.id, doc_number: i.doc_number, customer: i.customer, total_cents: i.total_cents, payment_status: i.paid ? "paid" : "unpaid", company: i.company, company_name: i.company === "a2z" ? "A2Z CREATIVE MARKETING" : "AZ ONE OFFICIAL", salesperson: i.salesperson, salesperson_id: i.salesperson === "Fixture Person" ? 9001 : 77 },
          verified_cents: i.verified, pending_cents: pend(i), outstanding_cents: i.paid ? 0 : i.total_cents - i.verified, status: statusOf(i), reports: pay.reports.filter((r) => r.invoice_id === i.id).map(deco).reverse(), events: pay.events.filter((e) => e.invoice_id === i.id), can_report: caps.report && !i.paid });
        const b = jb();
        if (req.method !== "GET") pay.posts.push({ path: p, method: req.method, body: p.endsWith("/proof") ? "(file)" : b });
        if (req.method === "GET" && p === "/staff/payments") {
          const open = pay.invoices.filter((i) => !i.paid);
          const reps = pay.reports.map(deco);
          return send(200, { on: pay.on, ready: true, can: caps,
            banks: caps.verify ? [{ id: 1, name: "A2Z account", bank: "Maybank", number_masked: "****1111", company: "a2z" }, { id: 2, name: "AZ ONE account", bank: "Maybank", number_masked: "****2222", company: "azoo" }] : [],
            reports: reps, invoices: open.map((i) => ({ id: i.id, doc_number: i.doc_number, total_cents: i.total_cents, customer: i.customer, salesperson: i.salesperson, company: i.company, salesperson_id: i.salesperson === "Fixture Person" ? 9001 : 77, verified_cents: i.verified, pending_cents: pend(i), outstanding_cents: i.total_cents - i.verified, status: statusOf(i), can_report: caps.report })),
            tiles: { pending_cents: reps.filter((r) => ["reported", "evidence_checked", "clarify"].includes(r.state)).reduce((a, r) => a + r.amount_cents, 0), pending_count: reps.filter((r) => ["reported", "evidence_checked", "clarify"].includes(r.state)).length, verified_month_cents: reps.filter((r) => r.state === "verified").reduce((a, r) => a + (r.verified_cents ?? 0), 0), outstanding_cents: open.reduce((a, i) => a + i.total_cents - i.verified, 0), outstanding_invoices: open.length, partial_invoices: open.filter((i) => ["partial", "fully_reported"].includes(statusOf(i))).length } });
        }
        /* v1.283.0 (B6) - the cross-invoice audit trail, newest first, read only */
        if (req.method === "GET" && p === "/staff/payments/events") {
          if (!["ceo", "coo", "cco"].includes(role)) return send(403, { error: { code: "forbidden", message: "Only the CEO, COO and CCO read the payment audit trail" } });
          return send(200, { events: [...pay.events].reverse().map((e) => ({ ...e, doc_number: pay.invoices.find((i) => i.id === e.invoice_id)?.doc_number ?? null })) });
        }
        if (req.method === "PUT" && p === "/staff/payments/settings") {
          if (!caps.switch) return send(403, { error: { code: "forbidden", message: "Only the company owner switches payment verification on or off" } });
          if (b.totp !== "123456") return send(401, { error: { code: "totp_invalid", message: "That code is not valid" } });
          pay.on = b.on === true; return send(200, { ok: true, on: pay.on });
        }
        const md = p.match(/^\/staff\/docs\/(\d+)\/payment-reports$/);
        if (md) {
          const i = pay.invoices.find((x) => x.id === Number(md[1]));
          if (!i) return send(404, { error: { code: "not_found", message: "Invoice not found" } });
          if (req.method === "GET") return send(200, picture(i));
          if (!pay.on) return send(409, { error: { code: "payment_verification_off", message: "Payment verification is switched off" } });
          if (!caps.report) return send(403, { error: { code: "forbidden", message: "You cannot report payments" } });
          if (b.method !== "cash" && !/^[A-Za-z0-9][A-Za-z0-9 ./#_-]{2,59}$/.test(b.reference ?? "")) return send(400, { error: { code: "invalid_reference", message: "Enter the bank or payment reference" } });
          const id = ++pay.n;
          pay.reports.push({ id, invoice_id: i.id, issuer_code: i.company, amount_cents: b.amount_cents, received_on: b.received_on, method: b.method, reference: b.reference, note: b.note ?? null, over_cents: Math.max(0, b.amount_cents - (i.total_cents - i.verified - pend(i))), dup_of: null, state: "reported", reported_by: 9001, reporter: "Fixture Person", reporter_role: role, reported_at: "2026-11-05 02:00:00", has_proof: false, evidence_by: null, decided_at: null, verified_cents: null, question: null });
          ev(i.id, id, "reported", b.amount_cents);
          return send(201, { ok: true, id, over_cents: 0, possible_duplicate: false, ...picture(i) });
        }
        const mr = p.match(/^\/staff\/payment-reports\/(\d+)\/([a-z]+)$/);
        const r = mr ? pay.reports.find((x) => x.id === Number(mr[1])) : null;
        if (!r) return send(404, { error: { code: "not_found", message: "Payment report not found" } });
        const i = pay.invoices.find((x) => x.id === r.invoice_id);
        const a = mr[2];
        if (a === "proof" && req.method === "GET") { res.writeHead(200, { "content-type": "image/png" }); res.end(readFileSync(join(dir, "icon-192.png"))); return; }
        if (a === "proof") { if (r.reported_by !== 9001) return send(403, { error: { code: "forbidden", message: "Only the reporter attaches its proof" } }); r.has_proof = true; ev(i.id, r.id, "proof_uploaded", null); return send(200, { ok: true }); }
        if (["verify", "reject", "reverse", "evidence"].includes(a) && b.totp !== "123456") return send(401, { error: { code: "totp_invalid", message: "That code is not valid" } });
        if (["verify", "reject", "reverse", "clarify"].includes(a) && !caps.verify) return send(403, { error: { code: "forbidden", message: "Only the CEO verifies payments" } });
        if (a === "verify") {
          if (!r.has_proof && r.reported_by !== 9001) return send(409, { error: { code: "proof_required", message: "No proof is attached to this payment - ask the reporter for it." } });
          if (b.bank_id !== 1 && i.company === "a2z") return send(409, { error: { code: "company_mismatch", message: "Company money is never combined." } });
          r.state = "verified"; r.verified_cents = b.amount_cents; r.decided_at = "2026-11-05 02:00:00"; r.decided_name = "Fixture Person"; r.bank_name = "A2Z account"; r.verify_method = b.verify_method;
          i.verified += b.amount_cents;
          /* v1.285.0 - whose sale, recorded at the decision (the fixture's invoices are all the signed-in person's own, except SALEOF) */
          ev(i.id, r.id, "verified", b.amount_cents, i.salesperson === "Fixture Person" ? { own_sale: true, ceo_marked: r.reported_by === 9001 } : { own_sale: false, salesperson: i.salesperson, ceo_marked: r.reported_by === 9001 });
          if (i.verified >= i.total_cents) { i.paid = true; ev(i.id, null, "invoice_paid", i.total_cents); } else ev(i.id, r.id, "outstanding_updated", i.total_cents - i.verified);
          return send(200, { ok: true, ...picture(i) });
        }
        if (a === "reject") { if ((b.reason ?? "").length < 10) return send(400, { error: { code: "invalid_input", message: "Give the reason" } }); r.state = "rejected"; r.reason = b.reason; ev(i.id, r.id, "rejected", r.amount_cents, { reason: b.reason }); return send(200, { ok: true, ...picture(i) }); }
        if (a === "clarify") { r.state = "clarify"; r.question = b.question; ev(i.id, r.id, "clarification_requested", null, { question: b.question }); return send(200, { ok: true, ...picture(i) }); }
        if (a === "answer") { r.state = "reported"; r.answer = b.answer; ev(i.id, r.id, "clarification_answered", null, { answer: b.answer }); return send(200, { ok: true, ...picture(i) }); }
        if (a === "evidence") { if (!caps.evidence) return send(403, { error: { code: "forbidden", message: "You do not check payment evidence" } }); r.state = "evidence_checked"; ev(i.id, r.id, "evidence_checked", r.amount_cents, { note: b.note }); return send(200, { ok: true, ...picture(i) }); }
        if (a === "reverse") { r.state = "reversed"; r.reverse_reason = b.reason; i.verified -= r.verified_cents ?? 0; i.paid = false; ev(i.id, r.id, "reversed", r.verified_cents, { reason: b.reason }); return send(200, { ok: true, ...picture(i) }); }
        return send(404, { error: { code: "not_found", message: "Not found" } });
      }
      /* v1.268.0 - Phase R: every panel step needs a code (123456) */
      if (req.method === "POST" && p.startsWith("/staff/recovery")) {
        const b = jb();
        return b.totp === "123456" ? send(200, { ok: true }) : send(401, { error: { code: "totp_invalid", message: "That code is not valid" } });
      }
      /* v1.269.0 - Phase 2A passkeys: options for rp "localhost", every posted answer kept */
      if (p.startsWith("/auth/passkey")) {
        const b = jb();
        const ch = () => { const c = Buffer.from(`fixture-challenge-${++pk.n}-0123456789abcdef`).toString("base64url"); pk.issued.push({ path: p, challenge: c }); return c; };
        if (req.method === "GET" && p === "/auth/passkeys") {
          /* PASSKEYS=1 stage A (owner), =B (owner + PILOT=1), =C (every staff and agent role) */
          const st = !process.env.PASSKEYS ? "off" : ["B", "C"].includes(process.env.PASSKEYS) ? process.env.PASSKEYS : "A";
          const role = process.env.ROLE ?? "ceo", owner = !!process.env.OWNER && role === "ceo";
          const inStage = st === "C" ? role !== "customer" : st === "B" ? owner || !!process.env.PILOT : st === "A" ? owner : false;
          return send(200, { stage: st, can_add: inStage && pk.creds.length < 5, in_stage: inStage, eligible: inStage || owner, limit: 5, this_session: null, passkeys: pk.creds, removed: [] });
        }
        if (req.method !== "POST") return send(404, { error: { code: "not_found", message: "Not found" } });
        pk.posts.push({ path: p, body: b });
        if (p === "/auth/passkey/register/options") {
          if (b.totp !== "123456") return send(401, { error: { code: "totp_invalid", message: "That code is not valid (or has already been used) - open your authenticator and try the current one" } });
          return send(200, { publicKey: { challenge: ch(), rp: { id: "localhost", name: "A2Z OS" }, user: { id: Buffer.alloc(32, 9).toString("base64url"), name: "fixture@example.test", displayName: "Fixture Person" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: 300000, attestation: "none", authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" }, excludeCredentials: [] } });
        }
        if (p === "/auth/passkey/register/verify") {
          const name = (b.name || "Passkey").slice(0, 60);
          pk.creds.push({ id: pk.creds.length + 1, name, created_at: "2026-11-05 03:00:00", last_used_at: null, synced: false, transports: ["internal"] });
          return send(200, { ok: true, id: pk.creds.length, name });
        }
        if (p === "/auth/passkey/login/options") return send(200, { publicKey: { challenge: ch(), rpId: "localhost", timeout: 300000, userVerification: "required", allowCredentials: [] } });
        if (p === "/auth/passkey/login/verify") { signedIn = true; return send(200, { user: { id: 9001, name: "Fixture Person", role: process.env.ROLE ?? "ceo", email: "fixture@example.test" } }); }
        const rm = p.match(/^\/auth\/passkeys\/(\d+)\/(rename|remove)$/);
        if (rm && rm[2] === "remove") { if (b.totp !== "123456") return send(401, { error: { code: "totp_invalid", message: "That code is not valid" } }); pk.creds = pk.creds.filter((c) => c.id !== Number(rm[1])); return send(200, { ok: true, sessions_ended: 0 }); }
        if (rm) { const c = pk.creds.find((x) => x.id === Number(rm[1])); if (c) c.name = b.name; return send(200, { ok: true }); }
      }
      if (req.method === "PUT" && p === "/staff/auth/settings/passkeys") {
        const b = jb();
        return /^\d{6}$/.test(b.totp ?? "") && (b.reason ?? "").length >= 5 ? send(200, { ok: true }) : send(400, { error: { code: "invalid_input", message: "Give a reason" } });
      }
      if (req.method === "PUT" && p === "/staff/auth/settings") {
        const b = jb();
        return /^\d{6}$/.test(b.totp ?? "") && (b.reason ?? "").length >= 5 ? send(200, { ok: true }) : send(400, { error: { code: "invalid_input", message: "Give a reason" } });
      }
      if (req.method === "POST" && p === "/staff/auth/legacy-notice") {
        return send(200, { remaining: 4, not_yet_told: 4, window_open: false, legacy_link_until: null, subject: "Your A2Z account: sign in with Google once before {the last day of the window}", text: "Hello {name},\n\nYou created your A2Z Creative Marketing account by signing in with Google. (fixture)", can_send: true });
      }
      if (req.method === "POST" && /^\/staff\/customer-accounts\/\d+\/(password-link|google-unlink|suspend)$/.test(p)) {
        const b = jb();
        if (!b.identity_checked || !b.identity_method || (b.reason ?? "").length < 10) return send(400, { error: { code: "identity_required", message: "Record who checked the identity" } });
        if (!b.totp) return send(401, { error: { code: "totp_required", message: "Your authenticator code is required" } });
        return send(200, p.endsWith("password-link") ? { ok: true, emailed: false, link: "https://a2z.example/set-password#token=fixture", expires_in_hours: 24 } : { ok: true });
      }
      /* v1.265.0 - Connect Google: the authenticator code 123456 sends the person to Google */
      if (req.method === "POST" && p === "/auth/google/connect") {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        if (b.password !== undefined && b.password !== "correct horse") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "invalid_password", message: "That password is not correct." } })); return; }
        const good = b.totp === "123456" || b.code === "123456" || b.password === "correct horse";
        res.writeHead(good ? 200 : 401, { "content-type": "application/json" });
        res.end(JSON.stringify(good ? { url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&return_to=${encodeURIComponent(b.return_to ?? "")}` } : { error: { code: "totp_invalid", message: "That code is not correct." } })); return;
      }
      if (req.method === "POST" && p === "/staff/attendance") {
        punchLog.push({ key: req.headers["idempotency-key"] ?? null, client_at: req.headers["x-client-at"] ?? null, replay: req.headers["x-outbox-replay"] ?? null, status: punchStatus, body });
        if (punchStatus === 401) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "unauthorized", message: "Sign in required" } })); return; }
        if (punchStatus === 409) { res.writeHead(409, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "on_leave", message: "You are on approved annual leave today (31-10-2026) - there is no shift to clock in to." } })); return; }
      }
      if (process.env.POP && req.method === "POST" && p === "/staff/payroll/manual-payment") {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        const good = Number(b.user_id) === 9003 && ["cash", "cheque", "transfer", "other"].includes(b.method) && String(b.reference ?? "").trim().length >= 2 && Number.isInteger(b.amount_cents) && b.amount_cents > 0;
        if (good) manualPaid = { user_id: 9003, method: b.method, reference: String(b.reference).trim(), amount_cents: b.amount_cents };
        res.writeHead(good ? 200 : 400, { "content-type": "application/json" });
        res.end(JSON.stringify(good ? { ok: true } : { error: { code: "invalid_input", message: "Method, reference and the payslip's net are required." } })); return;
      }
      if (process.env.POP && req.method === "POST" && p === "/staff/payroll/paid" && !manualPaid) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "exceptions_open", message: "1 person in the September 2026 run cannot be paid by the bank file: Farid Zulkifli (no bank details). Fix the record or record a manual payment, then mark it paid." }, exceptions: [{ user_id: 9003, kind: "no_bank" }] })); return;
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
      /* v1.249.0 - the task-update preview and send answer like the worker */
      if (req.method === "POST" && p === "/staff/tasks/mail-broadcast") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, recipients: 4, sample_for: "Nur Aisyah binti Rahman", subject: "[A2Z OS] Week plan", html: "<!doctype html><html><body><h1>Task update from management</h1><p>Your open tasks</p></body></html>", queued: 4, skipped: [] }));
        return;
      }
      if (req.method === "POST" && p === "/staff/access/policy") {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        if (!b.totp) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "totp_required", message: "Enter your 6-digit authenticator code" } })); return; }
      }
      /* v1.249.2 - /admin > Users: the owner's role change asks for his code */
      if (process.env.OWNER && req.method === "PATCH" && /^\/users\/\d+$/.test(p)) {
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
      {
        const mv = /^\/staff\/docs\/(\d+)\/void$/.exec(p);
        if (mv && req.method === "POST") {
          let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
          const reason = String(b.reason ?? "").trim();
          if (reason.length < 10) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "invalid_input", message: "Say why this invoice is being voided (at least 10 characters)." } })); return; }
          if (mv[1] === "2") { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "invalid_input", message: "INV-AZO100926-2 is PAID: its money is in the books. Issue a credit note instead." } })); return; }
          voided.set(mv[1], reason);
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, voided: `doc ${mv[1]}` })); return;
        }
        const mc = /^\/staff\/docs\/(\d+)\/convert$/.exec(p);
        if (mc && req.method === "POST") {
          /* v1.273.0 - DEPOSIT=1: every convert body is kept (/__payments posts) and a part answers with what is left */
          if (process.env.DEPOSIT) {
            let bd = {}; try { bd = JSON.parse(body || "{}"); } catch { /* empty */ }
            pay.posts.push({ path: p, method: "POST", body: bd });
            res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ id: 9101, doc_number: "INV-AZOO311026-9", stock: null, replaces_doc_id: null, billed_cents: 225000, left_cents: 0 })); return;
          }
          const answer = () => {
            if (converted.has(mc[1])) { res.writeHead(409, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "already_invoiced", message: "QT-AZO150926-1 was already invoiced as INV-AZOO311026-9. Void that invoice first (with a reason) if it was a mistake." }, invoice_id: 9100, invoice_number: "INV-AZOO311026-9" })); return; }
            converted.add(mc[1]);
            res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ id: 9100, doc_number: "INV-AZOO311026-9", stock: null, replaces_doc_id: null }));
          };
          if (slowConvert) setTimeout(answer, slowConvert); else answer();
          return;
        }
        const md = /^\/staff\/docs\/(\d+)$/.exec(p);
        if (md && req.method === "DELETE" && ["2", "3", "4"].includes(md[1])) {
          res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "invalid_input", message: "Invoices are voided with a reason, never deleted (Void invoice)." } })); return;
        }
      }
      /* v1.246.4 - a project edit (the dates sheet): answered as the worker does */
      if (req.method === "PATCH" && /^\/staff\/projects\/\d+$/.test(p)) {
        projectPosts.push({ p, body });
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, version: 2 })); return;
      }
      /* v1.247.0 - a manual task reminder and the task email settings */
      if (req.method === "POST" && /^\/staff\/tasks\/\d+\/remind$/.test(p)) {
        taskPosts.push({ method: req.method, p, body });
        res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, bell: true, email: true, email_to: "farid@example.test", why: null })); return;
      }
      if (req.method === "PUT" && p === "/staff/tasks/mail-settings") {
        taskPosts.push({ method: req.method, p, body });
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ settings: { ...MAIL_SETTINGS, ...b }, sender: { ready: true, from: "A2Z Creative Marketing <hello@a2zcreative.my>" }, can_edit: true })); return;
      }
      if (req.method === "GET" && p.startsWith("/staff/tasks/mail-preview")) {
        res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>preview</title><h1>New task assigned</h1><p>View Task in A2Z OS</p>"); return;
      }
      /* v1.262.0 - Sales discipline: Do it, an outcome, a linked follow-up, the
         allocation, Copy last week and the advisory settings - answered as
         weekly-sales.ts / business.ts would, recorded at /__sales */
      if ((req.method === "POST" || req.method === "PUT") && (/^\/staff\/sales\/week\/(advisory\/act|advisory\/settings|targets|targets\/copy)$/.test(p) || /^\/staff\/followups\/\d+\/done$/.test(p) || /^\/staff\/customers\/\d+\/followups$/.test(p))) {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        salesPosts.push({ method: req.method, p, body: b });
        const J = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
        if (p.endsWith("/advisory/act")) { const again = salesPosts.filter((x) => x.p === p && x.body.key === b.key).length > 1; return J(again ? 200 : 201, { ok: true, kind: String(b.key).startsWith("pipe:") ? "task" : "followup", id: 610, existing: again }); }
        if (p.endsWith("/done")) { if (!b.outcome) return J(400, { error: { code: "invalid_input", message: "Choose what the customer said." } }); return J(200, { ok: true, outcome: b.outcome, doc_id: 41, next: b.outcome === "accepted" ? "record_acceptance" : null }); }
        if (p.endsWith("/targets/copy")) return J(b.dry_run ? 200 : 201, { ok: true, dry_run: Boolean(b.dry_run), source_week: "2026-09-07", changes: [{ scope: "person", user_id: 9005, name: "Farid Zulkifli", metric: "revenue", from_value: null, to_value: 200000 }], written: b.dry_run ? [] : [77] });
        if (p.endsWith("/advisory/settings")) return J(200, { ok: true, settings: { pipeline_multiple: 1.5, quote_age_days: 14, very_old_days: 60, invoice_fallback_days: 14, package_days: {}, ...b, updated_at: "2026-09-18 03:00:00", updated_by: "Fixture Person" } });
        if (p.endsWith("/followups")) return J(201, { ok: true, id: 611, existing: false });
        return J(201, { ok: true, id: 78 });
      }
      /* v1.246.3 - a staff-recorded quotation acceptance */
      if (req.method === "POST" && /^\/staff\/docs\/\d+\/acceptance$/.test(p)) {
        projectPosts.push({ p, body, key: req.headers["idempotency-key"] ?? null });
        res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, revision: 0 })); return;
      }
      if (req.method === "POST" && p === "/staff/projects") {
        projectMade = true; projectPosts.push({ p, body, key: req.headers["idempotency-key"] ?? null });
        res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ id: projectFixture.id, existing: false })); return;
      }
      /* v1.246.0 - a task's update, comment, review, helper or file: answered
         as the worker would (201), recorded for the probe at /__tasks */
      if ((req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") && (/^\/staff\/tasks\/\d+\/(updates|comments|review|close|reopen|files|assistants|items)(\/\d+)?$/.test(p) || /^\/staff\/tasks\/\d+\/updates\/\d+\/(edit|withdraw)$/.test(p)) && !p.endsWith("/toggle")) {
        taskPosts.push({ method: req.method, p, body: p.endsWith("/files") ? `<${body.length} bytes>` : body, key: req.headers["idempotency-key"] ?? null, name: req.headers["x-file-name"] ?? null, update: req.headers["x-update-id"] ?? null, comment: req.headers["x-comment-id"] ?? null });
        res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, id: 950 + taskPosts.length })); return;
      }
      if (req.method === "POST" && /^\/staff\/projects\/\d+\/(updates|files|owner|status)$/.test(p)) {
        projectPosts.push({ p, body: p.endsWith("/files") ? `<${body.length} bytes>` : body, key: req.headers["idempotency-key"] ?? null, name: req.headers["x-file-name"] ?? null, csrf: req.headers["x-csrf-token"] ?? null });
        res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, id: 900 + projectPosts.length })); return;
      }
      /* v1.251.0 - Add User (invite): the worker's answer with email sending off - the link shown once */
      if (req.method === "POST" && p === "/users") {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* empty */ }
        if (b.invite && !b.totp) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "totp_required", message: "Enter your 6-digit authenticator code to create this account" } })); return; }
        if (b.invite && ["coo", "cco", "admin", "ceo"].includes(b.role) && !process.env.OWNER) { res.writeHead(403, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "forbidden", message: `Only the company owner or the super admin can create a ${b.role} account. Your owner authority is off: the Super Admin names you company owner once (signed in as the Super Admin: /admin > Users > Company owner), then this works for you.` } })); return; }
        res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ id: 9200, invited: true, emailed: false, expires_in_hours: 24, link: "https://portal.example.test/set-password#token=" + "cd".repeat(32) })); return;
      }
      /* v1.250.2 - a new agent request and an agent file answer like agent.ts
         (201 with the new id - the form uploads the attachment to that id) */
      if (req.method === "POST" && p === "/staff/agent/requests") { res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, id: 9, ref: "AGR-0009", status: "submitted" })); return; }
      if (req.method === "POST" && /^\/staff\/agent\/requests\/\d+\/files$/.test(p)) { res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ id: 31, name: req.headers["x-file-name"] ?? "file" })); return; }
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
      const data = req.method === "GET" ? fixture(p, url.toString(), { onMissing: path => missing.add(path), made: projectMade }) : { ok: true, ...(p.endsWith("/responsibilities") ? { role_title: "x", responsibilities: [] } : {}) };
      if (req.method === "GET" && p === "/staff/docs" && Array.isArray(data?.docs) && (voided.size || converted.size)) {
        data.docs = data.docs.map((d) => voided.has(String(d.id)) ? { ...d, payment_status: "void", voided_at: "2026-10-31 05:00:00", void_reason: voided.get(String(d.id)) }
          : converted.has(String(d.id)) ? { ...d, invoiced_as: "INV-AZOO311026-9", invoiced_as_id: 9100 } : d);
      }
      if (process.env.POP && req.method === "GET" && p === "/staff/payroll" && url.searchParams.get("month") === "2026-09" && data?.entries) {
        const farid = manualPaid
          ? { user_id: 9003, name: "Farid Zulkifli", kind: "manual_payment", blocking: false, resolved: true, resolution: "manual_payment", amount_cents: manualPaid.amount_cents, detail: `${manualPaid.method} - ${manualPaid.reference}` }
          : { user_id: 9003, name: "Farid Zulkifli", kind: "no_bank", blocking: true, resolved: false, resolution: null, amount_cents: null, detail: null };
        data.population = { in_run: 3, file_payees: 2, file_total_cents: 624052, manual_total_cents: manualPaid ? manualPaid.amount_cents : 0, total_cents: 624052 + 95000,
          exceptions: [farid, { user_id: 9004, name: "Tan Mei Ling", kind: "login_suspended", blocking: false, resolved: false, resolution: null, amount_cents: null, detail: null }],
          blocking: manualPaid ? 0 : 1, out_of_run: [], paid: null, payslips_out: false };
      }
      if (mediaBk && req.method === "GET" && p === "/system/health" && data && !data.error) {
        const copy = { at: "2026-10-31T21:30:00.000Z", live: 1240, copied: mediaBk === "pending" ? 40 : 0, pending: mediaBk === "pending" ? 120 : 0 };
        data.media_backup = mediaBk === "unbound" ? { bucket_bound: false, last_copy: null, last_reconcile: null }
          : { bucket_bound: true, last_copy: copy, last_reconcile: mediaBk === "pending" ? null : { at: "2026-10-31T19:25:00.000Z", live: 1240, missing: 0, stale: 0, bad: mediaBk === "damaged" ? 2 : 0 } };
      }
      /* v1.265.0 - Connected Google account (Profile -> Security); GLINKED=1: already connected */
      if (req.method === "GET" && p === "/auth/2fa/status" && data && !data.error) {
        data.google = process.env.ROLE === "customer"
          ? { linked: !!process.env.GLINKED, proof: process.env.GMAIL_PW && !process.env.GLINKED ? "password_google" : "password_email", can_connect: !process.env.GLINKED, can_disconnect: !!process.env.GLINKED, why: null } /* v1.267.0 GMAIL_PW=1: no email sending, a Gmail address */
          : { linked: !!process.env.GLINKED, proof: "totp", can_connect: !process.env.GLINKED && (process.env.TWOFA ? twofaOn : true), can_disconnect: !!process.env.GLINKED, why: null };
      }
      if (process.env.TWOFA && req.method === "GET") {
        if (p === "/auth/me" && data?.user) data.user.requires_2fa = !twofaOn;
        if (p === "/auth/2fa/status") Object.assign(data, { enabled: twofaOn, backup_codes_left: twofaOn ? 8 : 0 });
      }
      /* v1.199.0 - a fixture that answers { error: { code: "forbidden" } } is a
         refusal, sent with the worker's 403, so a role-gated read can be walked */
      res.writeHead(data?.error?.code === "forbidden" ? 403 : data?.error?.code === "server_error" ? 500 : 200, { "content-type": "application/json" }); res.end(JSON.stringify(data)); /* v1.280.0 - a fixture "server_error" is a 500 (PERF=fail) */
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

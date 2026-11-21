/* v1.396.0 - DIGITAL CARDS END TO END (Digital Cards Stage 8, the CEO 21-11-2026).
 *
 * The REAL A2Z OS worker (every migration, in memory) and the REAL AZ ONE storefront (wrangler dev,
 * local D1/R2) talk over HTTP with one shared CARD_BRIDGE_KEY - no stand-ins on either side.
 *   designer builds -> COO pre-checks -> CEO publishes -> AZ ONE collects (hash-checked) and reports
 *   "imported" -> a customer personalises -> v2 is published (the customer's card stays on v1)
 *   -> the CEO unpublishes (it leaves the catalogue; the customer's card still opens)
 *
 *   AZONE_DIR=C:\Users\Alif\Desktop\azoneofficial node tests/browser/cards-e2e.mjs
 *   (AZONE_DIR = the AZ ONE storefront folder, with npm install done; SHOTS=dir saves screenshots
 *    when Playwright for Python is installed)
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRuntime, root } from "./portfolio-runtime.mjs";

const AZ = process.env.AZONE_DIR;
if (!AZ) { console.error("Set AZONE_DIR to the AZ ONE storefront folder."); process.exit(2); }
const KEY = "e2e-" + createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 32);
const A2Z_PORT = 8890, AZ_PORT = 8891, A2Z = `http://127.0.0.1:${A2Z_PORT}`, BASE = `http://127.0.0.1:${AZ_PORT}`;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const results = [];
const ok = (c, m, why = "") => { results.push([!!c, m]); console.log(`${c ? "PASS" : "FAIL"} ${m}${!c && why ? ` - ${String(why).slice(0, 300)}` : ""}`); };

/* ---------- A2Z OS: the real worker behind an HTTP port ---------- */
const rt = await makeRuntime();
const { call, db, env } = rt;
env.CARD_BRIDGE_KEY = KEY;
let feedReads = 0;
const a2z = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  if (req.url.startsWith("/api/v1/bridge/card-templates")) feedReads++;
  const r = await rt.worker.fetch(new Request(`https://api.a2z.test${req.url}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env);
  const out = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(out);
});
await new Promise((ok_) => a2z.listen(A2Z_PORT, "127.0.0.1", ok_));

/* ---------- AZ ONE: wrangler dev pointed at it ---------- */
const state = join(AZ, ".wrangler", `e2e-${Date.now()}`); mkdirSync(state, { recursive: true });
const azEnv = { ...process.env, TEST_STATE: state, WRANGLER_SEND_METRICS: "false" };
const cli = join(AZ, "node_modules/wrangler/bin/wrangler.js");
execFileSync(process.execPath, ["scripts/setup.mjs"], { cwd: AZ, env: azEnv, stdio: "pipe" });
const worker = spawn(process.execPath, [cli, "dev", "--port", String(AZ_PORT), "--persist-to", state, "--var", `APP_URL:${BASE}`, "--var", `A2Z_API_URL:${A2Z}`, "--var", `CARD_BRIDGE_KEY:${KEY}`], { cwd: AZ, env: azEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let logs = ""; worker.stdout.on("data", (b) => (logs += b)); worker.stderr.on("data", (b) => (logs += b));
const d1 = (sql) => JSON.parse(execFileSync(process.execPath, [cli, "d1", "execute", "DB", "--local", "--persist-to", state, "--command", sql, "--json"], { cwd: AZ, env: azEnv, encoding: "utf8" }))[0].results;
class Client {
  cookies = new Map(); csrf = "";
  async request(url, { method = "GET", form } = {}) {
    const headers = { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }; let body;
    if (form) { body = new URLSearchParams({ ...form, _csrf: this.csrf }); headers["content-type"] = "application/x-www-form-urlencoded"; }
    if (method !== "GET") { headers.origin = BASE; headers["x-csrf-token"] = this.csrf; }
    const send = () => fetch(BASE + url, { method, body, redirect: "manual", headers });
    let r; try { r = await send(); } catch (e) { if (!/ECONNRESET|UND_ERR_SOCKET|other side closed/.test(String(e?.cause?.code ?? e?.cause?.message ?? e))) throw e; await new Promise((z) => setTimeout(z, 300)); r = await send(); }
    for (const h of r.headers.getSetCookie()) { const [p] = h.split(";"), i = p.indexOf("="); this.cookies.set(p.slice(0, i), p.slice(i + 1)); }
    this.csrf = this.cookies.get("az_csrf") || this.csrf;
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, text: buf.toString(), buf, url: r.headers.get("location") };
  }
  get(u) { return this.request(u); } post(u, f) { return this.request(u, { method: "POST", form: f }); }
}

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE)).status === 200) break; } catch { /* starting */ } await new Promise((z) => setTimeout(z, 500)); }
  const pub = new Client(), admin = new Client(), cust = new Client();
  await admin.get("/login"); await admin.post("/login", { email: "admin@azone.test", password: "Celebration2027!" });
  const sync = async () => { await admin.post("/admin/cards/sync", {}); return JSON.parse(d1(`SELECT value FROM card_bridge_state WHERE key='last_run'`)[0].value); };

  ok((await pub.get("/cards")).text.includes("No digital cards are on sale yet"), "AZ ONE starts with an empty catalogue");
  let run = await sync();
  ok(run.state === "ok" && run.read === 0 && feedReads > 0, "AZ ONE reads the real A2Z OS feed with the shared key (nothing yet)", JSON.stringify(run));

  /* ---------- A2Z OS: the designer builds, COO pre-checks, CEO publishes ---------- */
  const SAM = (p, m, b, ty) => call(p, 4, m, b, ty), CEO = (p, m, b) => call(p, 1, m, b), COO = (p, m, b) => call(p, 3, m, b);
  const art = readFileSync(join(root, "tests/browser/card-art.png"));
  const rules = (await CEO("/staff/card-rules")).j;
  const wedding = rules.categories.find((x) => x.code === "wedding"), portrait = rules.formats.find((x) => x.code === "portrait");
  let r = await SAM("/staff/card-templates", "POST", { name: "Elegant Navy Wedding", description: "Navy and gold, with room for your words", category_id: wedding.id, format_id: portrait.id, language: "both", packages: ["silver", "gold", "diamond"] });
  const id = r.j?.template?.id; let v = r.j?.template?.version;
  ok(r.status < 300 && id, "A2Z OS: the designer (Sales & Marketing) starts a template", r.text);
  r = await SAM(`/staff/card-templates/${id}/step`, "PUT", { version: v, step: 3, specs_confirmed: true }); v = r.j.template.version;
  for (const p of r.j.editor.pages) { const u = await SAM(`/staff/card-templates/${id}/pages/${p.id}/file?version=${v}`, "PUT", new Uint8Array(art), "image/png"); v = u.j.template.version; }
  r = await SAM(`/staff/card-templates/${id}/step`, "PUT", { version: v, step: 4 }); v = r.j.template.version;
  const pages = r.j.editor.pages;
  const Z = (o) => ({ kind: "text", label_ms: null, w: 800, h: 160, font: "greatvibes", weight: 400, size: 108, colour: "#e9d9a6", align: "center", max_chars: 40, required: true, sample_ms: null, x: 140, y: 640, ...o });
  r = await SAM(`/staff/card-templates/${id}/zones`, "PUT", { version: v, page_id: pages[0].id, zones: [
    Z({ key: "names", label: "Couple's names", label_ms: "Nama pasangan", sample: "Aiman & Nadia" }),
    Z({ key: "date", label: "Event date", label_ms: "Tarikh", y: 1240, h: 90, font: "montserrat", weight: 600, size: 44, sample: "Sunday, 24 May 2026" }),
  ] }); v = r.j.template.version;
  r = await SAM(`/staff/card-templates/${id}/zones`, "PUT", { version: v, page_id: pages[1].id, zones: [
    Z({ key: "venue", kind: "multiline", label: "Venue", label_ms: "Tempat", y: 700, h: 260, font: "montserrat", size: 46, colour: "#f4efe2", max_chars: 120, sample: "Dewan Seri Melati, Shah Alam" }),
  ] }); v = r.j.template.version;
  ok(r.status === 200, "A2Z OS: artwork on every page and the fields placed", r.text);
  r = await SAM(`/staff/card-templates/${id}/submit`, "POST", { version: v, note: "Ready for review" });
  ok(r.j?.template?.state === "in_review", "A2Z OS: the designer submits it", r.text);
  r = await COO(`/staff/card-templates/${id}/precheck`, "POST", { version: r.j.template.version, decision: "pass" });
  ok(r.j?.template?.state === "in_review" && r.j.review.prechecked_by, "A2Z OS: the COO pre-checks it", r.text);
  r = await CEO(`/staff/card-templates/${id}/publish`, "POST", { version: r.j.template.version, decision: "publish" });
  ok(r.j?.template?.state === "published" && r.j.review.live_version === 1, "A2Z OS: the CEO publishes v1", r.text);
  const code = db.prepare(`SELECT code FROM card_templates WHERE id = ?`).get(id).code;

  /* ---------- AZ ONE collects it ---------- */
  run = await sync();
  ok(run.state === "ok" && run.imported === 1, "AZ ONE collects the published design", JSON.stringify(run));
  const st = db.prepare(`SELECT status, content_hash FROM card_template_sync WHERE template_id = ? ORDER BY id DESC`).get(id);
  const hash1 = db.prepare(`SELECT content_hash FROM card_template_versions WHERE template_id = ? AND version_no = 1`).get(id).content_hash;
  ok(st.status === "imported" && st.content_hash === hash1, "A2Z OS shows it Imported - from AZ ONE's report naming the right fingerprint", JSON.stringify(st));
  ok(d1(`SELECT content_hash FROM card_template_versions WHERE code='${code}' AND version=1`)[0]?.content_hash === hash1, "AZ ONE keeps the same fingerprint");
  const cat = await pub.get("/cards");
  ok(cat.text.includes("Elegant Navy Wedding") && cat.text.includes("From RM40"), "the design is in the AZ ONE catalogue, From RM40");
  ok((await pub.get("/")).text.includes("Elegant Navy Wedding"), "and on the landing page");
  const artA = await pub.get(`/card-art/${code}/1/1`);
  ok(artA.status === 200 && Buffer.compare(artA.buf, art) === 0, "the artwork AZ ONE serves is the designer's file, byte for byte");
  const page = await pub.get(`/cards/${code}`);
  ok(page.text.includes('data-zone="names"') && page.text.includes("Aiman &amp; Nadia") && page.text.includes("Dewan Seri Melati"), "the card page draws every page with the designer's fields and samples");
  ok((await pub.get(`/cards/${code}?lang=ms`)).text.includes("Nama pasangan"), "the Bahasa Melayu labels come across");

  /* ---------- a customer personalises ---------- */
  await cust.get("/register"); await cust.post("/register", { name: "Test Customer", email: "e2e@example.test", password: "A-long-test-password-2027" });
  r = await cust.post("/app/cards/new", { code, package_id: "gold", lang: "en", z_names: "Hafiz & Mira", z_venue: "Dewan Seri Harmoni, Johor Bahru" });
  const cardUrl = r.url;
  const ed = await cust.get(cardUrl);
  ok(r.status === 302 && ed.text.includes("Hafiz &amp; Mira</div>") && ed.text.includes("Dewan Seri Harmoni"), "a customer personalises and saves: their words are on the pages", ed.text.slice(0, 200));
  ok(/<button[^>]*disabled[^>]*data-testid="add-to-cart"/.test(ed.text) && !/billplz\.com/i.test(ed.text), "checkout stays off: Add to Cart is disabled, no payment is called");

  /* ---------- v2 ---------- */
  v = (await SAM(`/staff/card-templates/${id}`)).j.template.version;
  r = await SAM(`/staff/card-templates/${id}/revise`, "POST", { version: v }); v = r.j.template.version;
  r = await SAM(`/staff/card-templates/${id}`, "PUT", { version: v, name: "Elegant Navy Wedding II", description: "Navy and gold, with room for your words", category_id: wedding.id, format_id: portrait.id, language: "both", packages: ["silver", "gold", "diamond"] });
  ok(r.status === 200, "A2Z OS: the designer opens a new version and renames it", r.text);
  v = (await SAM(`/staff/card-templates/${id}`)).j.template.version;
  r = await SAM(`/staff/card-templates/${id}/submit`, "POST", { version: v });
  r = await COO(`/staff/card-templates/${id}/precheck`, "POST", { version: r.j.template.version, decision: "pass" });
  r = await CEO(`/staff/card-templates/${id}/publish`, "POST", { version: r.j.template.version, decision: "publish" });
  ok(r.j?.review?.live_version === 2, "A2Z OS: v2 is reviewed and published", r.text);
  run = await sync();
  ok(run.imported === 1 && d1(`SELECT current_version FROM card_catalog WHERE code='${code}'`)[0].current_version === 2, "AZ ONE moves the catalogue to v2", JSON.stringify(run));
  ok(d1(`SELECT version FROM customer_cards WHERE code='${code}'`)[0].version === 1 && (await cust.get(cardUrl)).text.includes(`/card-art/${code}/1/1`), "the customer's card stays on v1 (pinned)");

  if (process.env.SHOTS) {
    writeFileSync(join(process.env.SHOTS, "e2e.json"), JSON.stringify({ base: BASE, code, card: cardUrl, cookie: [...cust.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })) }));
    try { execFileSync("python3", [join(process.env.SHOTS, "shots.py")], { stdio: "inherit" }); } catch (e) { console.log("screenshots skipped:", e.message); }
  }

  /* ---------- unpublish ---------- */
  v = (await CEO(`/staff/card-templates/${id}`)).j.template.version;
  r = await CEO(`/staff/card-templates/${id}/unpublish`, "POST", { version: v, note: "End-to-end test: taking it down" });
  ok(r.j?.review?.live_version === null, "A2Z OS: the CEO unpublishes it", r.text);
  run = await sync();
  ok(!(await pub.get("/cards")).text.includes("Elegant Navy Wedding") && (await pub.get(`/cards/${code}`)).status === 404, "it leaves the AZ ONE catalogue", JSON.stringify(run));
  ok((await cust.get(cardUrl)).status === 200, "the customer's card still opens");
  ok(db.prepare(`SELECT status FROM card_template_sync WHERE template_id = ? ORDER BY id DESC`).get(id).status === "imported", "A2Z OS shows the unpublish as delivered");
} catch (e) { ok(false, "the run finished", e.stack); console.error(logs.slice(-1500)); }
finally { worker.kill(); a2z.close(); }

const failed = results.filter(([g]) => !g).length;
console.log(`\n${results.length - failed}/${results.length} end-to-end checks passed.`);
process.exit(failed ? 1 : 0);

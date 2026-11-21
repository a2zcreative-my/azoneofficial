/* THE A2Z BUSINESS GROWTH CHECK (v1.369.0) - runtime guard: the WHOLE worker
 * (index.ts, bundled) against SQLite with every migration applied, by direct
 * request; the hourly pass (growth.ts) bundled on its own.
 *
 * The CEO, 18-11-2026 ("A2Z Business Growth Check"; answers: who sees = the
 * same as website Enquiries, a second submission is added to the open enquiry,
 * reminders 4 / 24 / 48 hours):
 *   1 the public form needs no sign-in, validates every required answer on the
 *     server (up to three challenges; two separate required consents; marketing
 *     optional and off unless ticked) and asks Cloudflare's bot check first
 *   2 one submission is ONE enquiry with an A2Z-DDMM running reference (v1.371.0,
 *     one counter shared with the partner form); a retry or a double
 *     press is the same one; the same WhatsApp while one is open is ADDED to it
 *   3 it NEVER creates an account, a customer or a sales document
 *   4 the website Enquiries people are told once; the bell names the enquiry
 *   5 Sales -> Customers & Follow-ups: they list and open it; an editor, an
 *     agent or a customer cannot - an agent not even with a saved cell
 *   6 Pick Up once; contact attempts, problem, free advice, outcome - by the
 *     owner (or management), each recorded; a stale screen is refused
 *   7 Qualified is not a sale: a quotation is linked, and the analytics READ the
 *     acceptance and the CEO's verification from Sales
 *   8 the Desk shows what waits; the hourly pass reminds at 4 / 24 h and
 *     escalates at 48 h, once a day
 * Then mutated copies must each fail a check.  NOMUT=1 skips the mutations.
 *
 *   node tests/business-growth.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";

async function runtime(workerBundle, sweepBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  let barrier = null;
  const race = (sql, fn) => { let go; const p = new Promise((r) => { go = r; }); barrier = { sql, n: 0, p, go }; return fn().finally(() => { barrier = null; }); };
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => {
      if (barrier && sql.includes(barrier.sql)) { barrier.n += 1; if (barrier.n >= 2) barrier.go(); await barrier.p; }
      return st.get(...b) ?? null;
    }, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://x",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const ROLES = ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host", "admin", "super_admin"];
  const ID = Object.fromEntries(ROLES.map((r, i) => [r, i + 1]));
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents) VALUES ${ROLES.map((r, i) => `(${i + 1},'${r}','${r}@a2z.test','${r}',1,'x',1,'${SECRET}',200000)`).join(",")},
    (30,'Second Sales','sales2@a2z.test','sales_marketing',1,'x',1,'${SECRET}',0), (31,'Rashid','rashid@agent.test','agent',1,'oauth$x',0,NULL,0), (32,'Shop','shop@gmail.com','customer',1,'x',0,NULL,0)`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":10,"set_by_name":"super_admin","set_at":"2026-10-30 02:00:00","reason":"Founder and owner"}')`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-18T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const realFetch = globalThis.fetch;
  let cfAnswer = null;
  globalThis.fetch = async (u, o) => { if (String(u).includes("challenges.cloudflare.com")) { if (!cfAnswer) throw new Error("offline"); return new Response(JSON.stringify(cfAnswer), { status: 200 }); } return realFetch(u, o); };
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const growthMod = await import(pathToFileURL(sweepBundle).href + `?v=${Math.random()}`);
  const sweep = growthMod.growthSweep;
  const tok = {};
  for (const id of [...Object.values(ID), 30, 31, 32]) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[id]).digest("hex"), id);
  }
  const call = async (path, uid, method = "GET", body, ip = "1.1.1.1") => {
    const headers = { "content-type": "application/json", origin: "https://x", "CF-Connecting-IP": ip };
    if (uid) Object.assign(headers, { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  let k = 0;
  const form = (over = {}) => ({
    client_key: `bg-key-${String(++k).padStart(4, "0")}-abcdefghijkl`, full_name: "Aina Rahman", dial: "+60", phone: `012-345 ${String(6000 + k).padStart(4, "0")}`, email: "",
    business_name: "Aina Bakes", industry: "food_beverage", city: "Johor Bahru", state: "johor", social_url: "instagram.com/ainabakes", source: "facebook",
    utm: { source: "facebook", medium: "paid_social", campaign: "growth_nov" }, referrer: "https://facebook.com/", landing_path: "/apply/business?utm_source=facebook",
    challenges: ["low_sales", "content"], urgent_problem: "Sales dropped since last month and we do not know why.", goal_90d: "Thirty new customers a month from Instagram.",
    platforms: ["instagram", "whatsapp"], interests: ["creative_content"], contact_method: "whatsapp", contact_time: "evening",
    consent_contact: true, consent_privacy: true, consent_marketing: false, lang: "ms", ...over,
  });
  const submit = (b, ip) => call("/public/business-growth", null, "POST", b, ip);
  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const notes = (uid, like) => db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ref LIKE ?`).get(uid, like).n;
  const row = (id) => db.prepare(`SELECT * FROM business_growth_enquiries WHERE id = ?`).get(id);
  const act = (id, uid, a, body) => call(`/staff/business-growth/${id}/${a}`, uid, "POST", { version: row(id).version, ...body });

  try {
    const u0 = count("users"), c0 = count("customers"), d0 = count("sales_documents");
    /* 1, 2, 3 */
    const s1 = await submit(form({ phone: "012-345 6789" }), "9.9.9.9");
    ok(s1.status === 201 && s1.j?.ref === "A2Z-181101", "1 a complete check is accepted without signing in, with the reference A2Z-DDMM + the day's running number", JSON.stringify(s1));
    const a1 = db.prepare(`SELECT * FROM business_growth_enquiries WHERE ref = ?`).get(s1.j?.ref);
    ok(a1 && a1.status === "new" && a1.owner_id === null && a1.whatsapp === "+60123456789" && a1.business_name === "Aina Bakes" && a1.source === "facebook"
      && a1.utm_campaign === "growth_nov" && a1.utm_medium === "paid_social" && a1.referrer === "https://facebook.com/", "2 all three steps are one row: WhatsApp as one number, the source and the campaign apart", JSON.stringify(a1));
    ok(JSON.parse(a1.challenges).join() === "low_sales,content" && JSON.parse(a1.platforms).join() === "instagram,whatsapp" && a1.email === null, "2 the answers are kept");
    ok(a1.consent_contact === 1 && a1.consent_privacy === 1 && a1.consent_marketing === 0 && a1.privacy_version === "2026-07-24" && a1.consent_at && a1.consent_ip_hash && !String(a1.consent_ip_hash).includes("9.9.9.9"),
      "1 the consent evidence: both required consents, the notice version, the time, a hash of the address (never the address)", JSON.stringify(a1));
    ok(count("users") === u0 && count("customers") === c0 && count("sales_documents") === d0, "3 no account, no customer and no sales document is created");
    const again = await submit({ ...form(), client_key: a1.client_key });
    ok(again.status === 200 && again.j?.ref === "A2Z-181101" && again.j?.existing && count("business_growth_enquiries") === 1, "2 the same submission retried is the same enquiry");
    /* the same WhatsApp, another browser: added to the open enquiry */
    const twinBody = form({ phone: "0123456789", client_key: "another-browser-key-0001", challenges: ["ads_results"], consent_marketing: true });
    const twin = await submit(twinBody, "8.8.8.8");
    ok(twin.j?.ref === "A2Z-181101" && twin.j?.existing && count("business_growth_enquiries") === 1 && row(a1.id).resubmissions === 1 && row(a1.id).consent_marketing === 1, "2 the same WhatsApp while it is open is ADDED to that enquiry", JSON.stringify(twin));
    const ev1 = db.prepare(`SELECT body FROM business_growth_events WHERE enquiry_id = ? AND kind = 'resubmitted'`).all(a1.id);
    ok(ev1.length === 1 && ev1[0].body.includes("ads_results") && ev1[0].body.includes("marketing yes"), "2 the new answers and their consent are kept on the enquiry's history");
    await submit(twinBody, "8.8.8.8");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM business_growth_events WHERE enquiry_id = ? AND kind = 'resubmitted'`).get(a1.id).n === 1 && row(a1.id).resubmissions === 1, "2 a retry of that second submission adds nothing more");
    ok(notes(ID.sales_marketing, `growth:${a1.id}:new`) === 1 && notes(ID.marketing, `growth:${a1.id}:new`) === 1 && notes(ID.hr_admin, `growth:${a1.id}:new`) === 1 && notes(ID.ceo, `growth:${a1.id}:new`) === 1 && notes(30, `growth:${a1.id}:new`) === 1,
      "4 the website Enquiries people are told once, by the enquiry's own reference");
    ok(notes(ID.editor, "growth:%") === 0 && notes(ID.live_host, "growth:%") === 0 && notes(31, "growth:%") === 0 && notes(32, "growth:%") === 0, "4 nobody else is told - never an agent or a customer");
    ok(db.prepare(`SELECT kind FROM notifications WHERE ref = ? LIMIT 1`).get(`growth:${a1.id}:new`)?.kind === "enquiry", "4 the bell is an enquiry notice (it lands on Sales)");
    /* 1 validation */
    for (const [f, v] of [["full_name", ""], ["phone", "12"], ["business_name", ""], ["industry", "x"], ["city", ""], ["state", "mars"], ["source", "radio"],
      ["challenges", []], ["challenges", ["low_sales", "content", "competition", "no_time"]], ["urgent_problem", "short"], ["goal_90d", "short"], ["platforms", []], ["platforms", ["none", "instagram"]],
      ["contact_method", "pigeon"], ["contact_time", ""], ["consent_contact", false], ["consent_privacy", false], ["email", "nope"]]) {
      const r = await submit(form({ [f]: v }), `2.2.${f.length}.${Array.isArray(v) ? v.length : 0}`);
      ok(r.status === 400 && r.j?.error?.fields?.[f === "email" ? "email" : f], `1 the server refuses a missing or invalid ${f}${Array.isArray(v) ? ` (${v.length})` : ""}`, JSON.stringify(r.j));
    }
    const viaEmail = await submit(form({ contact_method: "email", email: "" }), "2.2.9.9");
    ok(viaEmail.status === 400 && viaEmail.j?.error?.fields?.email, "1 contact by email needs an email");
    ok((await submit(form({ client_key: "x" }), "2.2.2.3")).status === 400, "1 a form without its once-only key is refused");
    ok(count("business_growth_enquiries") === 1, "nothing refused was saved");
    const opt = await submit(form({ email: "", social_url: "", interests: [] }), "2.3.3.3");
    ok(opt.status === 201, "1 email, social media and the improvement interests are optional", JSON.stringify(opt.j));
    /* the bot check */
    env.TURNSTILE_SITE_KEY = "site"; env.TURNSTILE_SECRET = "secret";
    cfAnswer = { success: false };
    const n1 = count("business_growth_enquiries");
    const b1 = await submit(form({ bot_token: "x".repeat(40) }), "3.3.3.3");
    ok(b1.status === 403 && b1.j?.error?.code === "bot_check_failed" && count("business_growth_enquiries") === n1, "1 Cloudflare's bot check refuses a robot", JSON.stringify(b1.j));
    cfAnswer = { success: true, action: "partner_apply" };
    ok((await submit(form({ bot_token: "x".repeat(40) }), "3.3.3.3")).status === 403, "1 another form's token is not this form's");
    cfAnswer = { success: true, action: "growth_check" };
    const b3 = await submit(form({ bot_token: "x".repeat(40) }), "3.3.3.3");
    ok(b3.status === 201 && count("business_growth_enquiries") === n1 + 1, "1 a passed check is accepted", JSON.stringify(b3.j));
    delete env.TURNSTILE_SITE_KEY; delete env.TURNSTILE_SECRET;
    for (let i = 0; i < 10; i++) await submit(form(), "4.4.4.4");
    ok((await submit(form(), "4.4.4.4")).status === 429, "1 a burst from one connection is limited");
    /* a double press */
    const dbl = form({ phone: "019-888 7777", client_key: "double-press-key-0001" });
    const [d1, d2] = await race("WHERE whatsapp = ?1 AND status IN", () => Promise.all([submit(dbl, "3.3.3.1"), submit(dbl, "3.3.3.2")]));
    ok([d1.status, d2.status].sort().join() === "200,201" && d1.j?.ref && d1.j.ref === d2.j?.ref && db.prepare(`SELECT COUNT(*) AS n FROM business_growth_enquiries WHERE client_key = 'double-press-key-0001'`).get().n === 1,
      "2 two copies of one submission at the same moment are one enquiry", `${d1.status} ${d2.status}`);
    ok(count("users") === u0 && count("customers") === c0 && count("sales_documents") === d0, "3 still no account, customer or document after every submission");
    /* v1.371.0 - ONE counter for both public forms (public-ref.ts, 0212) */
    const refs = db.prepare(`SELECT ref FROM business_growth_enquiries ORDER BY id`).all().map((r) => r.ref);
    ok(refs.every((r) => /^A2Z-1811\d{2,}$/.test(r)) && new Set(refs).size === refs.length, "2 every reference is A2Z-1811 + a running number, none repeated", refs.join(","));
    const nBefore = db.prepare(`SELECT n FROM public_ref_counters WHERE day = '2026-11-18'`).get().n;
    const pa = await call("/public/partner-applications", null, "POST", { client_key: "partner-key-shared-0001", full_name: "Rizal Hamid", gender: "male", age_range: "25-34", dial: "+60", phone: "0177776666",
      email: "rizal@example.test", location: "johor", contact_method: "whatsapp", source: "facebook", referred_before: true, intro_per_week: "1-2", customer_groups: ["sme"], lead_channels: ["personal"],
      approach: "I introduce SME owners from my association with their permission.", time_available: "2-5", screening_window: "7d", ack_independent: true, ack_terms: true, privacy_ack: true }, "7.7.7.7");
    ok(pa.status === 201 && pa.j?.ref === `A2Z-1811${String(nBefore + 1).padStart(2, "0")}`, "2 a partner application the same day takes the NEXT number of the same counter", JSON.stringify(pa.j));
    const gNext = await submit(form(), "7.7.7.8");
    ok(gNext.j?.ref === `A2Z-1811${String(nBefore + 2).padStart(2, "0")}`, "2 ...and the next Business Growth Check the one after it - never the same reference twice", JSON.stringify(gNext.j));
    fixed += 24 * 3600_000;
    const tomorrow = await submit(form(), "7.7.7.9");
    ok(tomorrow.j?.ref === "A2Z-191101", "2 a new Malaysia day starts again at 01", JSON.stringify(tomorrow.j));
    fixed -= 24 * 3600_000;

    /* 5 the list */
    const L1 = await call("/staff/business-growth", ID.sales_marketing);
    ok(L1.status === 200 && L1.j?.enquiries?.some((e) => e.ref === "A2Z-181101") && L1.j?.analytics?.total === L1.j.enquiries.length, "5 Sales reads the enquiries and their figures", JSON.stringify(L1.j)?.slice(0, 200));
    for (const [uid, who] of [[ID.editor, "an editor"], [ID.live_host, "a live host"], [31, "an agent"], [32, "a customer"]]) ok([401, 403].includes((await call("/staff/business-growth", uid)).status), `5 ${who} cannot read the enquiries`);
    const D1 = await call(`/staff/business-growth/${a1.id}`, ID.sales_marketing);
    ok(D1.status === 200 && D1.j?.enquiry?.urgent_problem && D1.j?.can?.pickup === true && D1.j?.can?.contact === false && D1.j.events?.every((e) => !String(e.channel ?? "").startsWith("key:")), "5 the detail opens; Pick Up is offered, contact is not yet; the browser key is never shown");

    /* 6 pick up once, by a true race */
    const [p1, p2] = await race("SELECT * FROM business_growth_enquiries WHERE id = ?1", () => Promise.all([act(a1.id, ID.sales_marketing, "pickup"), act(a1.id, 30, "pickup")]));
    ok([p1.status, p2.status].sort().join() === "200,409" && row(a1.id).status === "assigned", "6 two people pressing Pick Up at once: one owns it, the other is told", `${p1.status} ${p2.status}`);
    const owner = row(a1.id).owner_id, other = owner === ID.sales_marketing ? 30 : ID.sales_marketing;
    ok((await act(a1.id, other, "contact", { channel: "whatsapp", reached: true, note: "Hi" })).status === 403, "6 only the owner records a contact");
    const w1 = await act(a1.id, owner, "contact", { channel: "whatsapp", reached: false, note: "WhatsApp sent, no reply yet" });
    ok(w1.status === 200 && row(a1.id).status === "assigned" && row(a1.id).contact_attempts === 1 && row(a1.id).first_response_at, "6 an attempt that did not reach them is counted, the status stays Assigned", JSON.stringify(w1.j));
    ok((await call(`/staff/business-growth/${a1.id}/contact`, owner, "POST", { version: 1, channel: "call", reached: true, note: "late" })).j?.error?.code === "stale", "6 a screen that is out of date is refused, not overwritten");
    ok((await act(a1.id, owner, "problem", { summary: "Too early" })).status === 403, "6 the problem is recorded only after they were reached");
    await act(a1.id, owner, "contact", { channel: "call", reached: true, note: "Spoke for 20 minutes", next_follow_up_on: "2026-11-20" });
    ok(row(a1.id).status === "contacted" && row(a1.id).contact_attempts === 2 && row(a1.id).next_follow_up_on === "2026-11-20", "6 reached: Contacted, two attempts, the follow-up kept");
    ok((await act(a1.id, owner, "advice", { summary: "Post daily reels with prices" })).status === 403, "6 free advice comes after the problem");
    await act(a1.id, owner, "problem", { summary: "No consistent content and no prices shown online" });
    ok(row(a1.id).status === "problem_identified", "6 Problem Identified");
    await act(a1.id, owner, "advice", { summary: "Post three reels a week showing the products with prices; reply within an hour." });
    ok(row(a1.id).status === "advice_delivered" && row(a1.id).advice_at && row(a1.id).advice_by === owner, "6 Free Advice Delivered, with who and when");
    ok((await act(a1.id, owner, "outcome", { outcome: "qualified", reason: "" })).status === 400, "6 an outcome needs its reason");
    ok((await act(a1.id, owner, "outcome", { outcome: "follow_up", reason: "Will decide after Raya" })).status === 400, "6 a follow-up needs its date");
    ok((await act(a1.id, owner, "quotation", { quotation_id: 1 })).status === 403, "7 a quotation is linked only to a qualified enquiry");
    await act(a1.id, owner, "outcome", { outcome: "qualified", reason: "Wants a content package quoted" });
    ok(row(a1.id).status === "qualified" && count("sales_documents") === d0, "7 Qualified - and still no sales document: qualifying is not a sale");

    /* 7 the existing Sales path - a quotation made in Sales with the enquiry's reference */
    db.exec(`INSERT INTO customers (id, company) VALUES (900, 'Aina Bakes')`);
    db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, reference) VALUES (500, 'QT', 'QT202600500', 900, '[]', 150000, 'A2Z-181101'), (501, 'QT', 'QT202600501', 900, '[]', 1000, 'other')`);
    const D2 = await call(`/staff/business-growth/${a1.id}`, owner);
    ok(D2.j?.candidates?.map((q) => q.id).join() === "500" && D2.j?.can?.quotation, "7 the quotation naming the enquiry is offered to link");
    ok((await act(a1.id, ID.editor, "quotation", { quotation_id: 500 })).status === 403, "7 an editor cannot link it");
    ok((await act(a1.id, owner, "quotation", { quotation_id: 500 })).status === 200 && row(a1.id).quotation_id === 500 && row(a1.id).status === "qualified", "7 linked; the enquiry stays Qualified");
    const An0 = (await call("/staff/business-growth", ID.ceo)).j?.analytics;
    ok(An0?.quotations === 1 && An0?.accepted === 0 && An0?.verified === 0, "7 linked, not accepted, not verified", JSON.stringify(An0));
    db.exec(`INSERT INTO quotation_acceptances (doc_id, accepted_name) VALUES (500, 'Aina')`);
    db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, converted_from, payment_status) VALUES (600, 'INV', 'INV202600600', 900, '[]', 150000, 500, 'paid')`);
    const An1 = (await call("/staff/business-growth", ID.ceo)).j?.analytics;
    ok(An1?.accepted === 1 && An1?.verified === 0, "7 accepted is read from Sales; a paid invoice without the CEO's verification is NOT a verified sale", JSON.stringify(An1));
    db.exec(`INSERT INTO invoice_paid_confirmations (invoice_id, amount_cents, confirmed_by) VALUES (600, 150000, 1)`);
    const An2 = (await call("/staff/business-growth", ID.ceo)).j?.analytics;
    ok(An2?.verified === 1 && An2?.verified_cents === 150000 && An2?.assessments >= 1 && An2?.qualified >= 1 && An2?.sources?.facebook >= 1 && An2?.challenges?.low_sales >= 1 && An2?.response_median_hours !== null,
      "7 the CEO-verified sale, the free assessments, the sources, the challenges and the response time are all counted from records", JSON.stringify(An2));
    db.exec(`UPDATE invoice_paid_confirmations SET revoked_at = datetime('now') WHERE invoice_id = 600`);
    ok((await call("/staff/business-growth", ID.ceo)).j?.analytics?.verified === 0, "7 a confirmation taken back is no longer a verified sale");

    /* management: give to someone, settings */
    const a2 = db.prepare(`SELECT id FROM business_growth_enquiries WHERE status = 'new' ORDER BY id LIMIT 1`).get().id;
    ok((await act(a2, ID.sales_marketing, "assign", { owner_id: 30, reason: "Second Sales covers Johor" })).status === 403, "6 Sales cannot give an enquiry to someone");
    ok((await act(a2, ID.coo, "assign", { owner_id: ID.editor, reason: "Editor helps" })).status === 400, "6 only to someone who answers website enquiries");
    ok((await act(a2, ID.coo, "assign", { owner_id: 30, reason: "Second Sales covers Johor" })).status === 200 && row(a2).owner_id === 30 && row(a2).status === "assigned" && notes(30, `growth:${a2}:assigned:%`) === 1, "6 management gives it to a named person, who is told");
    ok((await call("/staff/business-growth/settings", ID.ceo)).j?.settings?.unclaimed_hours === 4 && (await call("/staff/business-growth/settings", ID.ceo)).j?.settings?.escalate_hours === 48, "8 the reminders start at 4 / 24 / 48 hours");
    ok((await call("/staff/business-growth/settings", ID.sales_marketing, "PUT", { unclaimed_hours: 2, remind_hours: 12, escalate_hours: 24, reason: "faster" })).status === 403, "8 Sales cannot change the reminders");
    /* not interested closes it */
    await act(a2, 30, "contact", { channel: "call", reached: true, note: "Spoke" });
    ok((await act(a2, 30, "outcome", { outcome: "not_interested", reason: "Closing the shop next month" })).status === 200 && row(a2).status === "not_interested" && row(a2).closed_by === 30, "6 Not Interested closes it, with the reason and who");
    ok((await act(a2, 30, "contact", { channel: "call", reached: true, note: "again" })).status === 403, "6 a closed enquiry takes no more contact");
    /* a closed one does not swallow a new check */
    const fresh = await submit(form({ phone: db.prepare(`SELECT whatsapp FROM business_growth_enquiries WHERE id = ?`).get(a2).whatsapp.slice(3) }), "6.6.6.6");
    ok(fresh.status === 201 && fresh.j?.ref !== row(a2).ref, "2 after Not Interested, a new check is a new enquiry");

    /* history and audit */
    const kinds = db.prepare(`SELECT kind FROM business_growth_events WHERE enquiry_id = ? ORDER BY id`).all(a1.id).map((r) => r.kind).join(",");
    ok(kinds === "submitted,resubmitted,picked_up,attempt,contacted,problem,advice,qualified,quotation", "6 every step is in the history, in order", kinds);
    ok(["growth.pickup", "growth.contact", "growth.problem", "growth.advice", "growth.outcome", "growth.quotation", "growth.assign"].every((a) => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get(a).n >= 1), "6 every step is in the audit log");
    let rewrote = false; try { db.exec(`UPDATE business_growth_events SET body = 'x' WHERE enquiry_id = ${a1.id}`); rewrote = true; } catch { /* refused */ }
    let deleted = false; try { db.exec(`DELETE FROM business_growth_enquiries WHERE id = ${a1.id}`); deleted = true; } catch { /* refused */ }
    ok(!rewrote && !deleted, "6 the history cannot be rewritten and an enquiry cannot be deleted");

    /* 8 the Desk */
    const n3 = db.prepare(`SELECT id FROM business_growth_enquiries WHERE status = 'new' ORDER BY id LIMIT 1`).get().id;
    const desk = await call("/staff/desk", ID.marketing);
    const di = (desk.j?.items ?? []).filter((i) => i.bucket === "growth");
    ok(di.some((i) => i.id === `growth:${n3}` && i.tab === "Sales" && i.kind === "do"), "8 an unclaimed enquiry is on the Desk of the people who pick it up, and opens it in Sales", JSON.stringify(di).slice(0, 300));
    ok(!((await call("/staff/desk", ID.editor)).j?.items ?? []).some((i) => i.bucket === "growth"), "8 not on the Desk of someone who cannot work it");

    /* 5 agents are never staff here, even with a saved cell */
    db.prepare(`INSERT INTO system_meta (key, value) VALUES ('role_permissions', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify({ perms: { enquiry_manage: ["ceo", "sales_marketing", "agent", "customer"], exec_view: ["ceo", "agent"] }, meta: {} }));
    for (const [path, method, body] of [["/staff/business-growth", "GET"], [`/staff/business-growth/${a1.id}`, "GET"], [`/staff/business-growth/${n3}/pickup`, "POST", { version: 1 }]]) {
      const r = await call(path, 31, method, body);
      ok(r.status === 403 && !JSON.stringify(r.j).includes("Aina"), `5 an agent is refused ${method} ${path.replace(/\d+/, ":id")}`, `${r.status}`);
    }
    const direct = await growthMod.handleGrowth(env, "/business-growth", "GET", null, { id: 31, role: "agent", name: "Rashid" });
    ok(direct?.status === 403, "5 ...and refused by the growth routes themselves");
    ok(!((await call("/staff/desk", 31)).j?.items ?? []).some((i) => i.bucket === "growth"), "5 an agent's Desk never shows one");
    db.prepare(`DELETE FROM system_meta WHERE key = 'role_permissions'`).run();

    /* 8 the hourly pass: unclaimed 4 h -> the team, owner 24 h -> reminded, 48 h -> management */
    fixed += 5 * 3600_000;
    const sw1 = await sweep(env);
    const sw2 = await sweep(env);
    ok(sw1.reminded > 0 && sw2.reminded === 0 && notes(ID.sales_marketing, `growth:${n3}:unclaimed:%`) === 1 && notes(ID.coo, `growth:${n3}:escalate:%`) === 0, "8 unclaimed after 4 hours: the team is reminded, once a day; not escalated yet", JSON.stringify([sw1, sw2]));
    fixed += 44 * 3600_000;
    await sweep(env);
    ok(notes(ID.coo, `growth:${n3}:escalate:%`) === 1 && notes(ID.sales_marketing, `growth:${n3}:escalate:%`) === 0, "8 after 48 hours management is told");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id IN (31, 32) AND ref LIKE 'growth:%'`).get().n === 0, "5 no notice ever reaches an agent or a customer");

    /* the screens open the record the bell and the Desk name */
    const rf = readFileSync(join(root, "lib/record-focus.ts"), "utf8"), dp = readFileSync(join(root, "components/portal/desk-page.tsx"), "utf8"), page = readFileSync(join(root, "app/apply/business/page.tsx"), "utf8");
    ok(/\|growth(\|live_report)?(\|[a-z_]+)*\):\(\\d\+\)/ /* 21-11-2026 - lead and deal joined after it */.test(rf) /* 19-11-2026 - live_report joined the list after growth */ && /growth: "Sales"/.test(rf) && /case "growth": return \{ tab: "Sales", kind: "growth"/.test(dp), "4 a growth: bell and a growth Desk row open the enquiry in Sales");
    ok(/"\/public\/business-growth"[\s\S]{0,200}credentials: "omit"/.test(page) && page.includes("Hantar untuk Semakan Percuma") && page.includes("Kenal Pasti Cabaran Bisnes Anda") && !/["'`]budget|budget_|bajet_/i.test(page),
      "1 the page sends no session, says the CEO's words, and asks no budget");
    ok(/consent_marketing: false/.test(page), "1 the marketing consent starts unticked");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate; globalThis.fetch = realFetch;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const make = (srcRoot) => {
  const dir = mkdtempSync(join(tmpdir(), "growth-"));
  bundle(srcRoot, "worker/src/index.ts", join(dir, "worker.mjs"));
  bundle(srcRoot, "worker/src/growth.ts", join(dir, "growth.mjs"));
  return [join(dir, "worker.mjs"), join(dir, "growth.mjs")];
};
report(await runtime(...make(root)));
const checks = n;
const MUT = [
  ["worker/src/growth.ts", "a second Pick Up wins too", "WHERE id = ?3 AND status = 'new' AND owner_id IS NULL RETURNING version", "WHERE id = ?3 RETURNING version"],
  ["worker/src/growth.ts", "the bot check skipped", 'const bot = await botCheck(env, request, body.bot_token, "growth_check");', "const bot = { ok: true } as const;"],
  ["worker/src/growth.ts", "a retry makes a second enquiry", "ON CONFLICT(client_key) DO NOTHING RETURNING id, ref", "RETURNING id, ref"],
  ["worker/src/growth.ts", "a stale screen overwrites", "WHERE id = ?3 AND version = ?4 AND status IN", "WHERE id = ?3 AND (?4 IS NOT NULL) AND status IN"],
  ["worker/src/growth.ts", "the same WhatsApp makes a second enquiry", "WHERE whatsapp = ?1 AND status IN", "WHERE whatsapp = ?1 AND 0 AND status IN"],
  ["worker/src/growth.ts", "the privacy notice is not required", `if (body.consent_privacy !== true) errors.consent_privacy = "required";`, ""],
  ["worker/src/growth.ts", "four challenges allowed", `if (challenges.length > 3) errors.challenges = "too_many";`, ""],
  ["worker/src/growth.ts", "nobody is told", "await tell(env, await holders(env, \"enquiry_manage\"), `New Business Growth Check", "if (0) await tell(env, await holders(env, \"enquiry_manage\"), `New Business Growth Check"],
  ["worker/src/growth.ts", "a paid invoice counts as verified", "AND EXISTS (SELECT 1 FROM invoice_paid_confirmations c WHERE c.invoice_id = i.id AND c.revoked_at IS NULL) LIMIT 1) AS verified_cents", "LIMIT 1) AS verified_cents"],
  ["worker/src/growth.ts", "advice before the problem", `advice: works && ["problem_identified", "advice_delivered", "follow_up"].includes(a.status),`, `advice: works && reached,`],
  ["worker/src/growth.ts", "Sales gives enquiries away", "const growthManager = (user: StaffUser) => growthViewer(user) && canUser(user, \"exec_view\");", "const growthManager = (user: StaffUser) => growthViewer(user);"],
  ["worker/src/public-ref.ts", "the running number does not move", "ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n", "ON CONFLICT(day) DO UPDATE SET n = n RETURNING n"],
  ["worker/src/public-ref.ts", "the day and month swapped", "`A2Z-${mytDay.slice(8, 10)}${mytDay.slice(5, 7)}", "`A2Z-${mytDay.slice(5, 7)}${mytDay.slice(8, 10)}"],
  ["worker/src/desk.ts", "the Desk shows it to everyone", "  if (growthViewer(user)) {\n    await guard(\"growth\"", "  if (true) {\n    await guard(\"growth\""],
];
for (const [file, name, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "growth-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types", "components", "app"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  let b; try { b = make(mdir); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(...b);
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`business-growth: ${fail} of ${n} failed`); process.exit(1); }
console.log(`business-growth: ${checks} checks passed (${process.env.NOMUT === "1" ? "mutations skipped" : `${MUT.length} mutations caught`}) - one public check, never an account, customer or sale; the same WhatsApp added to the open enquiry; Pick Up once; contact, problem, free advice and outcome recorded; Qualified is not a sale - acceptance and the CEO's verification are read from Sales; no agent ever reaches it; reminded at 4 / 24 h and escalated at 48 h once a day`);

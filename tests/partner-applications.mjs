/* PARTNER INTEREST APPLICATION (v1.351.0) - runtime guard: the WHOLE worker
 * (index.ts, bundled) against SQLite with every migration applied, by direct
 * request; the hourly pass (partners.ts) bundled on its own.
 *
 * The CEO, 17-11-2026 ("A2Z OS - CREATE PARTNER INTEREST APPLICATION"):
 *   1 the public form needs no sign-in, validates every required answer on the
 *     server and asks Cloudflare's bot check first
 *   2 one submission is ONE application with a reference; a retry, a double
 *     press or the same person again is the same application
 *   3 it NEVER creates an account (users unchanged) and grants nothing
 *   4 the Sales / agent team is told once; the bell names the application
 *   5 Agents -> Requests: the team lists and opens it; an agent, an editor or
 *     a customer cannot; two people cannot both pick it up
 *   6 Contact, notes, shortlist, hold, reject - by the owner (or management),
 *     each recorded; a stale screen is refused
 *   7 the final approval is partner_approve's alone, from shortlisted only;
 *     activation is a SEPARATE recorded action that needs the agreement and an
 *     Agent account already given through the role door
 *   8 the Desk shows what waits on whom; the hourly pass reminds and escalates
 *     once a day; the Overview figures come from the records
 * Then mutated copies must each fail a check.  NOMUT=1 skips the mutations.
 *
 *   node tests/partner-applications.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
void b32; void createHmac;

async function runtime(workerBundle, sweepBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  /* A TRUE RACE: while `barrier` is set, the read named by barrier.sql waits
     until two requests have both made it - so both pass every check before
     either writes, and only the conditional write itself can keep them apart. */
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
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-17T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const realFetch = globalThis.fetch;
  let cfAnswer = null; // null = Cloudflare unreachable; else the siteverify JSON
  globalThis.fetch = async (u, o) => { if (String(u).includes("challenges.cloudflare.com")) { if (!cfAnswer) throw new Error("offline"); return new Response(JSON.stringify(cfAnswer), { status: 200 }); } return realFetch(u, o); };
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const partnersMod = await import(pathToFileURL(sweepBundle).href + `?v=${Math.random()}`);
  const sweep = partnersMod.partnerSweep;
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
    client_key: `key-${String(++k).padStart(4, "0")}-abcdefghijkl`, full_name: "Aina Rahman", gender: "female", age_range: "25-34", dial: "+60", phone: "012-345 6789",
    email: `aina${k}@example.test`, location: "johor", contact_method: "whatsapp", best_time: "evening", source: "facebook",
    utm: { source: "facebook", medium: "paid_social", campaign: "partner_nov" },
    referred_before: true, intro_per_week: "3-5", customer_groups: ["sme", "corporate"], lead_channels: ["personal", "business"],
    approach: "I meet SME owners at my business association every week and introduce them with their permission.", time_available: "2-5", screening_window: "7d",
    ack_independent: true, ack_terms: true, privacy_ack: true, marketing_opt_in: false, lang: "en", ...over,
  });
  const submit = (b, ip) => call("/public/partner-applications", null, "POST", b, ip);
  const apps = () => db.prepare(`SELECT COUNT(*) AS n FROM partner_applications`).get().n;
  const usersN = () => db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const notes = (uid, like) => db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ref LIKE ?`).get(uid, like).n;
  const row = (id) => db.prepare(`SELECT * FROM partner_applications WHERE id = ?`).get(id);
  const act = (id, uid, a, body) => call(`/staff/partner-applications/${id}/${a}`, uid, "POST", { version: row(id).version, ...body });

  try {
    const u0 = usersN();
    /* 1, 2, 3 */
    const s1 = await submit(form());
    ok(s1.status === 201 && s1.j?.ref === "A2Z-171101", "1 a complete application is accepted without signing in, with the A2Z-DDMM running reference (v1.371.0)", JSON.stringify(s1));
    const a1 = db.prepare(`SELECT * FROM partner_applications WHERE ref = ?`).get(s1.j?.ref);
    ok(a1 && a1.status === "new" && a1.owner_id === null && a1.phone === "+60123456789" && a1.source === "facebook" && a1.utm_campaign === "partner_nov" && a1.utm_medium === "paid_social", "2 all three steps are one row: the source, the campaign and the phone as one number", JSON.stringify(a1));
    ok(JSON.parse(a1.customer_groups).join() === "sme,corporate" && a1.privacy_ack === 1 && a1.marketing_opt_in === 0 && a1.created_at, "2 the answers, the consents and the time are kept");
    ok(usersN() === u0, "3 no account is created by a submission");
    const again = await submit({ ...form(), client_key: a1.client_key, email: a1.email });
    ok(again.status === 200 && again.j?.ref === s1.j.ref && again.j?.existing && apps() === 1, "2 the same submission retried is the same application");
    const twin = await submit(form({ email: a1.email, client_key: "another-browser-key-0001" }));
    ok(twin.j?.ref === s1.j.ref && apps() === 1, "2 the same person applying again while it is open is the same application");
    ok(notes(ID.sales_marketing, `partner:${a1.id}:new`) === 1 && notes(ID.ceo, `partner:${a1.id}:new`) === 1 && notes(30, `partner:${a1.id}:new`) === 1, "4 the Sales and agent team and management are told once");
    ok(notes(ID.editor, "partner:%") === 0 && notes(ID.hr_admin, "partner:%") === 0 && notes(31, "partner:%") === 0, "4 people outside the team, and agents, are not told");
    /* 1 validation */
    for (const [, [f, v]] of [["full_name", ""], ["gender", "x"], ["age_range", ""], ["phone", "12"], ["email", "nope"], ["location", ""], ["source", "radio"], ["referred_before", null],
      ["intro_per_week", "lots"], ["customer_groups", []], ["lead_channels", []], ["approach", "short"], ["time_available", ""], ["screening_window", ""],
      ["ack_independent", false], ["ack_terms", false], ["privacy_ack", false]].entries()) {
      const r = await submit(form({ [f]: v }), `2.2.2.${f.length}`);
      ok(r.status === 400 && r.j?.error?.fields?.[f], `1 the server refuses a missing or invalid ${f}`, JSON.stringify(r.j));
    }
    ok((await submit(form({ client_key: "x" }), "2.2.2.3")).status === 400, "1 a form without its once-only key is refused");
    ok(apps() === 1, "nothing refused was saved");
    /* the bot check */
    env.TURNSTILE_SITE_KEY = "site"; env.TURNSTILE_SECRET = "secret";
    cfAnswer = { success: false };
    const b1 = await submit(form({ bot_token: "x".repeat(40), phone: "0137778888" }), "3.3.3.3");
    ok(b1.status === 403 && b1.j?.error?.code === "bot_check_failed" && apps() === 1, "1 Cloudflare's bot check refuses a robot", JSON.stringify(b1.j));
    cfAnswer = { success: true, action: "signin" };
    ok((await submit(form({ bot_token: "x".repeat(40), phone: "0137778888" }), "3.3.3.3")).status === 403, "1 a sign-in token is not this form's");
    cfAnswer = { success: true, action: "partner_apply" };
    const b3 = await submit(form({ bot_token: "x".repeat(40), phone: "0137778888" }), "3.3.3.3");
    ok(b3.status === 201 && apps() === 2, "1 a passed check is accepted", JSON.stringify(b3.j));
    delete env.TURNSTILE_SITE_KEY; delete env.TURNSTILE_SECRET;
    for (let i = 0; i < 20; i++) await submit(form({ email: `burst${i}@example.test`, phone: `0199${String(i).padStart(2, "0")}0000` }), "4.4.4.4");
    ok((await submit(form({ email: "burst9@example.test", phone: "0198880000" }), "4.4.4.4")).status === 429, "1 a burst from one connection is limited");
    /* a double press: two copies of one submission in flight at once */
    const dbl = form({ email: "double.press@example.test", phone: "019-888 7777", client_key: "double-press-key-0001" });
    const [d1, d2] = await race("SELECT ref FROM partner_applications WHERE client_key = ?1", () => Promise.all([submit(dbl, "3.3.3.1"), submit(dbl, "3.3.3.2")]));
    ok([d1.status, d2.status].sort().join() === "200,201" && d1.j?.ref && d1.j.ref === d2.j?.ref && db.prepare(`SELECT COUNT(*) AS n FROM partner_applications WHERE client_key = 'double-press-key-0001'`).get().n === 1, "2 two copies of one submission at the same moment are one application, one reference", `${d1.status} ${d2.status} ${d1.j?.ref} ${d2.j?.ref}`);
    const n0 = apps();

    /* 5 the team's list */
    const L1 = await call("/staff/partner-applications", ID.sales_marketing);
    ok(L1.status === 200 && L1.j?.applications?.length === n0 && L1.j.counts?.new === n0, "5 Sales lists every application with its status", JSON.stringify(L1.j?.counts));
    for (const [uid, who] of [[ID.editor, "an editor"], [ID.hr_admin, "HR"], [31, "an agent"], [32, "a customer"]]) ok([401, 403].includes((await call("/staff/partner-applications", uid)).status), `5 ${who} cannot read the applications`);
    const D1 = await call(`/staff/partner-applications/${a1.id}`, ID.sales_marketing);
    ok(D1.j?.application?.ref === a1.ref && D1.j.application.approach.startsWith("I meet") && D1.j.events?.[0]?.kind === "submitted" && D1.j.can?.pickup === true, "5 the whole application opens, with its history and what I may do", JSON.stringify(D1.j?.can));
    /* claim, once - two at the same moment */
    const [p1, p2] = await race("SELECT * FROM partner_applications WHERE id = ?1", () => Promise.all([act(a1.id, ID.sales_marketing, "pickup"), act(a1.id, 30, "pickup")]));
    ok([p1.status, p2.status].sort().join() === "200,409" && row(a1.id).owner_id === ID.sales_marketing && row(a1.id).status === "assigned", "5 two people pressing Pick Up together: exactly one owns it", `${p1.status} ${p2.status} ${row(a1.id).owner_id}`);
    ok((await act(a1.id, 30, "pickup")).j?.error?.code === "already_claimed", "5 a second Pick Up says somebody already has it");

    /* 6 screening (Sales / agent staff: Pick Up, Contact, Screen, Add Notes, Shortlist) */
    ok((await act(a1.id, 30, "contact", { channel: "whatsapp", note: "Called" })).status === 403, "6 someone else cannot record the owner's contact");
    ok((await act(a1.id, ID.sales_marketing, "shortlist", { reason: "Looks promising already" })).status === 403, "6 nothing is submitted for review before the applicant is contacted");
    const c1 = await act(a1.id, ID.sales_marketing, "contact", { channel: "whatsapp", note: "WhatsApp intro sent, call booked", next_follow_up_on: "2026-11-19" });
    ok(c1.status === 200 && row(a1.id).status === "screening" && row(a1.id).first_response_at && row(a1.id).next_follow_up_on === "2026-11-19", "6 the first contact is recorded and screening starts", JSON.stringify(c1.j));
    ok((await call(`/staff/partner-applications/${a1.id}/contact`, ID.sales_marketing, "POST", { version: 1, channel: "call", note: "late" })).j?.error?.code === "stale", "6 a screen that is out of date is refused, not overwritten");
    ok((await act(a1.id, ID.sales_marketing, "note", { note: "Strong SME network in Johor" })).status === 200, "6 a review note is kept");
    ok((await act(a1.id, ID.sales_marketing, "shortlist", { reason: "" })).j?.error?.code === "reason_required", "6 a recommendation needs its reason");
    const sh = await act(a1.id, ID.sales_marketing, "shortlist", { reason: "Three SME introductions a week, clear approach" });
    ok(sh.status === 200 && row(a1.id).status === "shortlisted" && row(a1.id).recommended_by === ID.sales_marketing && row(a1.id).preapproved_at === null, "6 shortlisting records who recommended it");
    ok(notes(ID.coo, `partner:${a1.id}:shortlisted:%`) === 1 && notes(ID.cco, `partner:${a1.id}:shortlisted:%`) === 1 && notes(ID.ceo, `partner:${a1.id}:shortlisted:%`) === 0, "4 the COO and the CCO are told it waits on their pre-approval - not yet the CEO");

    /* 7 the authority split: COO / CCO pre-approve, the CEO decides and activates */
    ok((await act(a1.id, ID.sales_marketing, "preapprove", { decision: "preapprove", reason: "Self-approval" })).status === 403, "7 Sales cannot pre-approve");
    ok((await act(a1.id, ID.ceo, "preapprove", { decision: "preapprove", reason: "Skip the COO" })).status === 403, "7 the CEO does not pre-approve - that is the COO's or the CCO's");
    ok((await act(a1.id, ID.ceo, "approve", { decision: "approve", reason: "Straight through" })).j?.error?.code === "not_pre_approved", "7 the CEO's final decision waits for the pre-approval");
    for (const [uid, who] of [[ID.sales_marketing, "Sales"], [ID.coo, "the COO"], [ID.cco, "the CCO"], [ID.super_admin, "the super admin"]]) ok((await act(a1.id, uid, "approve", { decision: "approve", reason: "Final from the wrong desk" })).status === 403, `7 ${who} cannot give the final approval`);
    let desk = await call("/staff/desk", ID.coo);
    ok(desk.j?.items?.some((i) => i.bucket === "partners" && i.id === `partner:${a1.id}` && i.kind === "decide" && i.next.startsWith("Pre-approve")), "8 the COO's Desk lists it to pre-approve", JSON.stringify(desk.j?.items?.filter((i) => i.bucket === "partners")));
    desk = await call("/staff/desk", ID.ceo);
    ok(!desk.j?.items?.some((i) => i.id === `partner:${a1.id}` && i.kind === "decide"), "8 the CEO is not asked before the pre-approval");
    /* return, then pre-approve */
    const rt = await act(a1.id, ID.cco, "preapprove", { decision: "return", reason: "Ask about their referral pipeline first" });
    ok(rt.status === 200 && row(a1.id).status === "screening" && row(a1.id).owner_id === ID.sales_marketing && notes(ID.sales_marketing, `partner:${a1.id}:screening:%`) === 1, "7 the CCO returns it to the owner for more screening, with the reason", JSON.stringify(rt.j));
    await act(a1.id, ID.sales_marketing, "shortlist", { reason: "Pipeline confirmed: five SME owners this month" });
    const pa = await act(a1.id, ID.coo, "preapprove", { decision: "preapprove", reason: "Eligible: network and availability confirmed" });
    ok(pa.status === 200 && row(a1.id).status === "shortlisted" && row(a1.id).preapproved_by === ID.coo && row(a1.id).preapproved_at, "7 the COO pre-approves", JSON.stringify(pa.j));
    ok((await call("/staff/partner-applications", ID.ceo)).j?.applications?.find((a) => a.id === a1.id)?.status === "pre_approved", "7 it now reads Pre-Approved");
    ok((await act(a1.id, ID.cco, "preapprove", { decision: "preapprove", reason: "Twice" })).j?.error?.code === "not_shortlisted", "7 it is pre-approved once");
    ok(notes(ID.ceo, `partner:${a1.id}:pre_approved:%`) === 1 && notes(ID.coo, `partner:${a1.id}:pre_approved:%`) === 0, "4 the CEO receives the final decision request");
    desk = await call("/staff/desk", ID.ceo);
    ok(desk.j?.items?.some((i) => i.bucket === "partners" && i.id === `partner:${a1.id}` && i.kind === "decide" && i.next.startsWith("Approve")), "8 the CEO's Desk lists the pre-approved application to decide");
    ok((await act(a1.id, ID.ceo, "activate", { agent_user_id: 31, agreement_signed_on: "2026-11-17", agreement_note: "Signed copy in HR file" })).j?.error?.code === "not_approved", "7 nothing is activated before the CEO approves");
    const ap = await act(a1.id, ID.ceo, "approve", { decision: "approve", reason: "Approved after the screening call" });
    ok(ap.status === 200 && row(a1.id).status === "approved" && row(a1.id).approved_by === ID.ceo && row(a1.id).agent_user_id === null, "7 the CEO approves; approval alone grants nothing");
    ok(usersN() === u0 && db.prepare(`SELECT role FROM users WHERE email = ?`).get(a1.email) === undefined, "3 an approved application still has no account");
    ok((await act(a1.id, ID.coo, "activate", { agent_user_id: 31, agreement_signed_on: "2026-11-17", agreement_note: "Signed copy in HR file" })).status === 403, "7 only the CEO activates");
    ok((await act(a1.id, ID.ceo, "activate", { agent_user_id: 31, agreement_signed_on: "", agreement_note: "" })).j?.error?.code === "agreement_required", "7 activation needs the signed agreement recorded");
    ok((await act(a1.id, ID.ceo, "activate", { agent_user_id: 32, agreement_signed_on: "2026-11-17", agreement_note: "Signed copy in HR file" })).j?.error?.code === "agent_account_required", "7 ...and an Agent account given through the role door, not a customer account");
    ok((await act(a1.id, ID.ceo, "activate", { agent_user_id: 31, agreement_signed_on: "2026-11-17", agreement_note: "Signed copy in HR file" })).j?.error?.code === "salesperson_required", "7 ...and the responsible salesperson assigned");
    db.prepare(`INSERT INTO agent_assignments (agent_id, salesperson_id, effective_from, set_by, reason) VALUES (31, ?, '2026-11-17', ?, 'Partner onboarding')`).run(ID.sales_marketing, ID.ceo);
    const ac = await act(a1.id, ID.ceo, "activate", { agent_user_id: 31, agreement_signed_on: "2026-11-17", agreement_note: "Signed copy in HR file" });
    ok(ac.status === 200 && row(a1.id).status === "activated" && row(a1.id).agent_user_id === 31 && row(a1.id).activated_by === ID.ceo, "7 activation is its own recorded action", JSON.stringify(ac.j));
    ok(db.prepare(`SELECT role FROM users WHERE id = 31`).get().role === "agent" && usersN() === u0, "7 activation changes no account or role");
    const kinds = db.prepare(`SELECT kind FROM partner_application_events WHERE application_id = ? ORDER BY id`).all(a1.id).map((r) => r.kind).join(",");
    ok(kinds === "submitted,picked_up,contacted,note,recommended,returned,recommended,pre_approved,approved,activated", "6 every step is in the history, in order", kinds);
    ok(["partner.pickup", "partner.contact", "partner.note", "partner.pre_approve", "partner.return", "partner.approve", "partner.activate"].every((a) => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get(a).n === 1)
      && db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'partner.shortlisted'`).get().n === 2, "6 every step is in the audit log, with who did it");
    let rewrote = false; try { db.exec(`UPDATE partner_application_events SET body = 'x' WHERE application_id = ${a1.id}`); rewrote = true; } catch { /* refused */ }
    ok(!rewrote, "6 the history cannot be rewritten");
    /* reject */
    await act(2, 30, "pickup");
    await act(2, 30, "contact", { channel: "call", note: "Spoke briefly" });
    await act(2, 30, "shortlist", { reason: "Has a small network" });
    ok((await act(2, 30, "preapprove", { decision: "reject", reason: "Mine to reject" })).status === 403, "7 Sales cannot reject at management review");
    ok((await act(2, ID.cco, "preapprove", { decision: "reject", reason: "No referral network yet" })).status === 200 && row(2).status === "rejected", "7 the CCO rejects, with the reason kept");

    /* 9 EXTERNAL AGENTS ARE NOT STAFF - by direct request, even if a cell is saved for them */
    const grant = JSON.stringify({ perms: { agent_requests_view: ["ceo", "coo", "cco", "sales_marketing", "agent"], agent_requests_manage: ["ceo", "agent"], partner_preapprove: ["coo", "cco", "agent"], partner_approve: ["ceo", "agent"] }, meta: {} });
    db.prepare(`INSERT INTO system_meta (key, value) VALUES ('role_permissions', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(grant);
    for (const [path, method, body] of [["/staff/partner-applications", "GET"], [`/staff/partner-applications/${a1.id}`, "GET"], [`/staff/partner-applications/3/pickup`, "POST", { version: 1 }],
      [`/staff/partner-applications/${a1.id}/approve`, "POST", { version: 1, decision: "approve", reason: "Agent approving" }], ["/staff/partner-applications/settings", "GET"]]) {
      const r = await call(path, 31, method, body);
      ok(r.status === 403 && !JSON.stringify(r.j).includes("applicant"), `9 an agent is refused ${method} ${path.replace(/\d+/, ":id")}`, `${r.status} ${JSON.stringify(r.j).slice(0, 120)}`);
    }
    const direct = await partnersMod.handlePartners(env, "/partner-applications", "GET", null, { id: 31, role: "agent", name: "Rashid" }, new URLSearchParams());
    ok(direct?.status === 403 && (await direct.json()).error?.message === "Partner applications are for A2Z staff only", "9 ...and refused by the partner routes themselves, behind the agent gate");
    const agDesk = await call("/staff/agent/desk", 31);
    ok(!/AGT-APP|A2Z-17\d{4}/.test(JSON.stringify(agDesk.j ?? {})) && notes(31, "partner:%") === 0, "9 an agent is never told of, or shown, an application");
    db.prepare(`DELETE FROM system_meta WHERE key = 'role_permissions'`).run();
    /* the public form sends no session (app/apply/partner: credentials "omit"), so a person who is also
       signed in applies like anyone else, and the mandatory-2FA gate is left exactly as the audit set it */
    const selfApply = await call("/public/partner-applications", null, "POST", form({ email: "rashid.again@example.test", phone: "0171112222" }), "5.5.5.5");
    ok(/^A2Z-1711\d{2,}$/.test(selfApply.j?.ref ?? "") && usersN() === u0, "9 an agent applying through the public form gets a screening record, nothing else", JSON.stringify(selfApply));
    ok(/"\/public\/partner-applications"[\s\S]{0,400}credentials: "omit"/.test(readFileSync(join(root, "app/apply/partner/page.tsx"), "utf8"))
      && !/public\/partner-applications/.test((readFileSync(join(root, "worker/src/index.ts"), "utf8").match(/const TWOFA_EXEMPT_PATHS[\s\S]*?\]\);/) ?? [""])[0]), "9 the form sends no session and the 2FA exemptions are unchanged");

    /* 8 the hourly pass */
    fixed += 6 * 3600_000;
    const sw1 = await sweep(env);
    const sw2 = await sweep(env);
    const unclaimed = db.prepare(`SELECT id FROM partner_applications WHERE status = 'new' ORDER BY id LIMIT 1`).get().id;
    ok(sw1.escalated > 0 && sw2.escalated === 0 && notes(ID.coo, `partner:${unclaimed}:unclaimed:%`) === 1 && notes(ID.sales_marketing, `partner:${unclaimed}:unclaimed:%`) === 0, "8 an unclaimed application is escalated to management, once a day", JSON.stringify([sw1, sw2]));
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id IN (31, 32) AND ref LIKE 'partner:%'`).get().n === 0, "9 no recruitment notice ever reaches an agent or a customer");
    n = out.length;
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
  const dir = mkdtempSync(join(tmpdir(), "partner-"));
  bundle(srcRoot, "worker/src/index.ts", join(dir, "worker.mjs"));
  bundle(srcRoot, "worker/src/partners.ts", join(dir, "partners.mjs"));
  return [join(dir, "worker.mjs"), join(dir, "partners.mjs")];
};
report(await runtime(...make(root)));
const checks = n;
const MUT = [
  ["worker/src/partners.ts", "a second Pick Up wins too", "WHERE id = ?3 AND status = 'new' AND owner_id IS NULL RETURNING version", "WHERE id = ?3 RETURNING version"],
  ["worker/src/partners.ts", "the COO gives the final approval", `if (!approver) return err("forbidden", "The final approval is the CEO's"`, `if (!approver && !preapprover) return err("forbidden", "The final approval is the CEO's"`],
  ["worker/src/partners.ts", "the CEO skips the pre-approval", `if (stage !== "pre_approved") return err("not_pre_approved"`, `if (stage !== "pre_approved" && stage !== "shortlisted") return err("not_pre_approved"`],
  ["worker/src/partners.ts", "Sales pre-approves", `if (!preapprover) return err("forbidden", "Only the COO or the CCO`, `if (!preapprover && !viewer) return err("forbidden", "Only the COO or the CCO`],
  ["worker/src/partners.ts", "an agent reaches the routes", `if (NEVER.includes(user.role)) return err(`, `if (false) return err(`],
  ["worker/src/partners.ts", "submitted without a contact", "shortlist: works && screening && !!a.first_response_at,", "shortlist: works && screening,"],
  ["worker/src/partners.ts", "activation without an Agent account", "if (!acct || acct.role !== \"agent\" || acct.is_active !== 1) return err(", "if (!acct) return err("],
  ["worker/src/partners.ts", "activation without a salesperson", "if (!sp?.salesperson_id) return err(", "if (false) return err("],
  ["worker/src/partners.ts", "the bot check skipped", 'const bot = await botCheck(env, request, body.bot_token, "partner_apply");', "const bot = { ok: true } as const;"],
  ["worker/src/partners.ts", "a retry makes a second application", "ON CONFLICT(client_key) DO NOTHING RETURNING id, ref", "RETURNING id, ref"],
  ["worker/src/partners.ts", "a stale screen overwrites", "WHERE id = ?3 AND version = ?4 AND status IN", "WHERE id = ?3 AND (?4 IS NOT NULL) AND status IN"],
  ["worker/src/partners.ts", "nobody is told", "  await tell(env, ids, `New partner application", "  if (0) await tell(env, ids, `New partner application"],
  ["worker/src/desk.ts", "the CEO is asked before the pre-approval", `} else if (a.status === "shortlisted" && a.preapproved_at && approves) {`, `} else if (a.status === "shortlisted" && approves) {`],
];
for (const [file, name, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "partner-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  let b; try { b = make(mdir); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(...b);
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`partner-applications: ${fail} of ${n} failed`); process.exit(1); }
console.log(`partner-applications: ${checks} checks passed (${process.env.NOMUT === "1" ? "mutations skipped" : `${MUT.length} mutations caught`}) - one public application, never an account; staff pick it up once and screen it, the COO or CCO pre-approves, the CEO alone approves and activates; no agent ever reaches it; told, reminded and escalated once`);

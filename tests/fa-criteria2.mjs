/* v1.301.0 - FINANCIAL ADVISORY 2.0, PHASE 4: BANK CRITERIA 2.0 (the CEO,
   13-11-2026: "Go ahead" on claude/FINANCIAL-ADVISORY-2.0-BLUEPRINT.md section
   9; migration 0191). By DIRECT request against the whole worker on SQLite
   with every migration applied. Invented banks and people only. Each rule is
   also MUTATED.

   What must hold (directive section 6):
     - every rule says its category and confidence; an indicative entry names
       the banker, the day, the channel and their exact words;
     - a banker's indicative words are NEVER published as the bank's rule and
       never match; only an official, verified, in-date rule matches;
     - an expired rule never matches; a rule past its review day is flagged;
     - Sales cannot verify; nobody verifies a rule they proposed (the owner
       account apart);
     - the repository shows Draft / Indicative / Verified / Review required /
       Expired / Archived, and who approved it.

     node tests/fa-criteria2.mjs        (NOMUT=1 skips the mutations) */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4, 5, 6, 7, 8]);
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const store = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { const r = list.map((s) => s._run()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: {
      put: async (key, body, opts) => { store.set(key, { buf: Buffer.from(await new Response(body).arrayBuffer()), ct: opts?.httpMetadata?.contentType }); },
      head: async () => null, get: async (key) => (store.has(key) ? { body: store.get(key).buf, httpMetadata: { contentType: store.get(key).ct } } : null),
      list: async () => ({ objects: [] }), delete: async () => {},
    },
  };
  /* invented people: 1 CEO, 2 super admin, 3 COO, 6 CCO, 7 HR, 9 and 15 sales, 21 an agent, 22 admin */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP'), (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP'), (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP'), (9,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP'), (21,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (22,'Adm','Adm Person','adm@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP')`);
  db.exec(`INSERT INTO customers (id, company, phone) VALUES (1, 'Existing Client One', '019-888 7777')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 2, 3, 6, 7, 9, 15, 21, 22]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const hdr = (uid, ct = "application/json") => ({ "content-type": ct, origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
  const call = async (path, uid, method = "GET", body) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: hdr(uid), body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* a file */ }
    return { status: r.status, j, text };
  };
  const upload = async (caseId, uid, kind) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff/fa/cases/${caseId}/documents?kind=${kind}&date=2026-11-10`, { method: "POST", headers: { ...hdr(uid, "image/png"), "content-length": String(PNG.length) }, body: PNG }), env, { waitUntil() {} });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
    return { status: r.status, j, text: t };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const finance = () => ["cashflow_entries", "sales_documents", "invoice_payments", "commission_ledger", "journal_entries"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  const before = finance();

  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const later = (d) => new Date(Date.now() + 8 * 3600e3 + d * 864e5).toISOString().slice(0, 10);
  try {
    const bank = (await call("/fa/banks", 1, "POST", { name: "Bank A", kind: "commercial" })).j;
    const bankB = (await call("/fa/banks", 1, "POST", { name: "Bank B", kind: "islamic" })).j;
    for (const k of [bank, bankB]) await call(`/fa/banks/${k.id}/products`, 1, "POST", { product: "personal_financing", channel: "branch", source: "Invented test bank" });
    const loc = (await call("/fa/localities", 1, "POST", { state: "JOHOR", district: "Johor Bahru", city: "Johor Bahru" })).j;
    const br = (await call("/fa/branches", 1, "POST", { bank_id: bank.id, name: "JB City", postcode: "80000", locality_id: loc.id })).j;
    const brB = (await call("/fa/branches", 1, "POST", { bank_id: bankB.id, name: "JB B", postcode: "80000", locality_id: loc.id })).j;
    const bkA = (await call("/fa/bankers", 9, "POST", { bank_id: bank.id, full_name: "Banker Satu", work_email: "satu@bank-a.test", work_phone: "07-111 2222", products: ["personal_financing"], assignments: [{ branch_id: br.id, coverage: "branch", primary: true }] })).j.id;
    const bkB = (await call("/fa/bankers", 9, "POST", { bank_id: bankB.id, full_name: "Banker Dua", work_email: "dua@bank-b.test", work_phone: "07-333 4444", products: ["personal_financing"], assignments: [{ branch_id: brB.id, coverage: "branch", primary: true }] })).j.id;
    const crit = (uid, body) => call("/fa/criteria", uid, "POST", { bank_id: bank.id, product: "personal_financing", source: "Invented product sheet, test", ...body });
    const list = async (uid = 9) => (await call("/fa/criteria", uid)).j;
    const one = async (id, uid = 9) => (await list(uid)).criteria.find((x) => x.id === id);

    /* ---- every rule says what it is ---- */
    ok((await crit(9, { dsr_guideline_pct: 60 })).j?.error?.code === "invalid_input", "a rule without a confidence is refused");
    const off = await crit(9, { dsr_guideline_pct: 60, confidence: "high", review_due_on: later(60), expires_on: later(365) });
    ok(off.status === 201, "an official draft with its confidence, review day and expiry", off.text);
    let o = await one(off.j.id);
    ok(o?.category === "official" && o.confidence === "high" && o.review_due_on === later(60) && o.expires_on === later(365) && o.shows === "draft" && o.created_by_name === "Aina Seller", "the repository shows it as an official Draft, with its confidence, dates and who proposed it", JSON.stringify(o).slice(0, 300));
    ok((await crit(9, { confidence: "high", expires_on: later(-1) })).j?.error?.code === "invalid_input", "an expiry already past is refused");

    /* ---- verification ---- */
    ok((await call(`/fa/criteria/${off.j.id}/verify`, 9, "POST", { last_verified_on: today })).status === 403, "Sales cannot verify (direct request)");
    const own = await crit(3, { bank_id: bankB.id, dsr_guideline_pct: 55, confidence: "medium" });
    const self = await call(`/fa/criteria/${own.j.id}/verify`, 3, "POST", { last_verified_on: today });
    ok(self.status === 403 && self.j?.error?.code === "self_approval", "the COO cannot verify a rule the COO proposed", self.text);
    const v = await call(`/fa/criteria/${off.j.id}/verify`, 3, "POST", { last_verified_on: today, review_due_on: later(90) });
    o = await one(off.j.id);
    ok(v.status === 200 && o.shows === "verified" && o.verified_by_name === "Coo Person" && o.review_due_on === later(90), "the COO verifies Sales' rule: Verified, approved by the COO, next review day set", JSON.stringify(o).slice(0, 300));
    ok((await call(`/fa/criteria/${own.j.id}/verify`, 1, "POST", { last_verified_on: today })).status === 200, "the owner account may verify the COO's rule");

    /* ---- banker-provided indicative ---- */
    const ind = (body) => crit(9, { confidence: "medium", category: "banker_indicative", ...body });
    ok((await ind({ heard_on: today, channel: "work_phone", exact_feedback: "Usually wants six months of statements" })).j?.error?.code === "invalid_input", "an indicative entry names the banker");
    ok((await ind({ banker_id: bkB, heard_on: today, channel: "work_phone", exact_feedback: "Usually wants six months of statements" })).j?.error?.code === "invalid_input", "...a banker of THIS bank");
    ok((await ind({ banker_id: bkA, heard_on: later(1), channel: "work_phone", exact_feedback: "Usually wants six months of statements" })).j?.error?.code === "invalid_input", "...on a day already passed");
    ok((await ind({ banker_id: bkA, heard_on: today, channel: "telepathy", exact_feedback: "Usually wants six months of statements" })).j?.error?.code === "invalid_input", "...through a known channel");
    ok((await ind({ banker_id: bkA, heard_on: today, channel: "work_phone", exact_feedback: "short" })).j?.error?.code === "invalid_input", "...in their own words");
    const iv = await ind({ banker_id: bkA, heard_on: today, channel: "work_phone", exact_feedback: "Usually wants six months of statements", dsr_guideline_pct: 80 });
    const io = await one(iv.j?.id);
    ok(iv.status === 201 && io?.shows === "indicative" && io.source_banker === "Banker Satu" && io.exact_feedback === "Usually wants six months of statements" && io.channel === "work_phone", "the indicative entry is kept with the banker, day, channel and words", JSON.stringify(io).slice(0, 300));
    const iv2 = await call(`/fa/criteria/${iv.j.id}/verify`, 1, "POST", { last_verified_on: today });
    ok(iv2.status === 409 && iv2.j?.error?.code === "indicative_not_official", "a banker's words are never published as the bank's rule - even by the owner", iv2.text);

    /* ---- the ONE engine reads it ---- */
    const items = [{ side: "income", kind: "gross_salary", monthly_cents: 700000, verified: true }, { side: "commitment", kind: "car", monthly_cents: 100000 }];
    const pre = async () => (await call("/fa/preview", 9, "POST", { product: "personal_financing", items, proposal: { instalment_cents: 50000 } })).j?.result;
    let r = await pre();
    ok(r && r.matches.some((m) => m.criterion_id === off.j.id) && !r.matches.some((m) => m.criterion_id === iv.j.id), "the verified official rule matches; the indicative one never does", JSON.stringify(r?.matches?.map((m) => m.criterion_id)));
    db.prepare(`UPDATE fa_criteria SET state = 'verified', last_verified_on = ? WHERE id = ?`).run(today, iv.j.id); /* as if someone forced it past the route */
    r = await pre();
    ok(!r.matches.some((m) => m.criterion_id === iv.j.id), "even an indicative entry forced to verified in the database is never matched - the engine itself refuses it");
    db.prepare(`UPDATE fa_criteria_meta SET review_due_on = ? WHERE criterion_id = ?`).run(later(-1), off.j.id);
    r = await pre();
    ok((await one(off.j.id)).shows === "review_required" && r.matches.find((m) => m.criterion_id === off.j.id)?.stale === true, "past its review day: Review required, and the match is flagged for re-checking");
    db.prepare(`UPDATE fa_criteria_meta SET expires_on = ? WHERE criterion_id = ?`).run(later(-1), off.j.id);
    r = await pre();
    ok((await one(off.j.id)).shows === "expired" && !r.matches.some((m) => m.criterion_id === off.j.id), "expired: shown as Expired and never matched");

    /* ---- asking for verification ---- */
    const dr = await crit(15, { dsr_guideline_pct: 58, confidence: "low" });
    const n0 = n(`SELECT COUNT(*) AS n FROM notifications`);
    const rq = await call(`/fa/criteria/${dr.j.id}/request-verification`, 15, "POST", {});
    ok(rq.status === 200 && rq.j?.notified >= 2 && n(`SELECT COUNT(*) AS n FROM notifications`) - n0 === rq.j.notified, "Sales asks management to verify: the CEO and COO are told", rq.text);
    ok(!/58|Lia/.test(JSON.stringify(db.prepare(`SELECT * FROM notifications ORDER BY id DESC LIMIT 2`).all())), "the notification carries no figure and no name");
    ok((await call(`/fa/criteria/${off.j.id}/request-verification`, 15, "POST", {})).status === 409, "a verified rule is not sent for verification again");

    /* ---- archive, versions, roles ---- */
    await call(`/fa/criteria/${dr.j.id}/retire`, 1, "POST", {});
    ok((await one(dr.j.id)).shows === "archived", "a retired rule shows as Archived and stays in the history");
    const famKey = (await one(off.j.id)).family;
    const fam = (await list()).criteria.filter((x) => x.family === famKey);
    ok(fam.length >= 2 && new Set(fam.map((x) => x.version)).size === fam.length && fam.every((x) => x.category === "official"), "every official version of the family stays, each with its number", JSON.stringify(fam.map((x) => [x.version, x.shows])));
    ok(/:indicative$/.test(io.family) && io.family !== famKey, "a banker's words keep their own family - never a newer version of the official rule", io.family);
    ok((await call("/fa/criteria", 7)).status === 403 && (await call("/fa/criteria", 21)).status === 403 && (await call("/fa/criteria", 22)).status === 403, "HR, an agent and an admin cannot read the criteria");
    ok((await list(9)).can?.verify === false && (await list(3)).can?.verify === true, "the screen is told who may verify (server-decided)");
    ok(finance() === before, "Finance, invoices, payments, commission and journals untouched", `${before} -> ${finance()}`);
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "fac-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const F = "worker/src/fa.ts", E = "worker/src/fa-engine.ts";
const MUT = [
  [F, "a rule without confidence", [["    if (!confidence) return err(\"invalid_input\", \"Say how sure this rule is: high, medium or low confidence.\", 400);", ""]]],
  [F, "an indicative entry from any bank's banker", [["      if (!srcBanker || srcBanker.bank_id !== bk.id) return err(", "      if (!srcBanker) return err("]]],
  [F, "an indicative entry without the banker's words", [["      if (words.length < 10) return err(", "      if (false) return err("]]],
  [F, "a banker's words published as the bank's rule", [["      if ((c.category ?? \"official\") === \"banker_indicative\") return err(\"indicative_not_official\"", "      if (false) return err(\"indicative_not_official\""]]],
  [F, "verifying your own rule", [["      if (c.created_by === user.id && !isExecutiveOwner(user)) {\n        await audit(env, user.id, \"auth.self_approval_refused\", \"fa_criteria\"", "      if (false) {\n        await audit(env, user.id, \"auth.self_approval_refused\", \"fa_criteria\""]]],
  [F, "an expired rule shown as verified", [["  if (c.expires_on && c.expires_on < today) return \"expired\";", ""]]],
  [F, "a review day ignored on screen", [["  if (old || (c.review_due_on && c.review_due_on < today)) return \"review_required\";", "  if (old) return \"review_required\";"]]],
  [E, "an indicative entry matches", [["    && (c.category ?? \"official\") === \"official\" && !(c.expires_on && c.expires_on < today));", "    && !(c.expires_on && c.expires_on < today));"]]],
  [E, "an expired rule matches", [["    && (c.category ?? \"official\") === \"official\" && !(c.expires_on && c.expires_on < today));", "    && (c.category ?? \"official\") === \"official\");"]]],
  [E, "a review day never flags", [[" || (!!c.review_due_on && c.review_due_on < today);", ";"]]],
  [F, "a request names the rule's bank figures", [["`A bank criterion (${c.bank}) waits for your verification.`", "`A bank criterion (${c.bank}, ${c.dsr_guideline_bp}) from ${user.name} waits for your verification.`"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "fac-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  rmSync(mdir, { recursive: true, force: true });
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`fa-criteria2: ${fail} of ${n} failed`); process.exit(1); }
console.log(`fa-criteria2: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - every rule says its category and confidence; a banker's words never become the bank's rule and never match; expired never matches, review-due is flagged; Sales cannot verify and nobody verifies their own`);

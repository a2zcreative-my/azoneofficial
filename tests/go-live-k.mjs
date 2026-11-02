/* THE CLAIMS APPROVAL & PAYMENT TIMELINE (v1.254.0) - runtime guard: the
 * WHOLE worker bundled against SQLite with every migration applied (0167
 * included), by direct request as each role. Fixed clock: Monday
 * 02-11-2026, 12:00 Malaysia time.
 *
 * The owner's brief "Claims Approval & Payment Timeline Upgrade",
 * claude/CLAIMS-TIMELINE-AUDIT.md, his answers (D1 Return for info, D2 a
 * comment thread, D3 the bank date on Mark paid) and his "approved"
 * (02-11-2026). The chain is the one staff.ts always enforced, now read
 * from worker/src/claim-chain.ts: staff - HR, COO, CEO; HR - CCO, CEO;
 * COO and CCO - the CEO. APPROVED IS NOT PAID. The brief's section 12
 * tests are named in each check.
 *
 *   node tests/go-live-k.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-k.mjs   a given bundle (the 1.253.0 bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "golive-k-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const MIGS = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort();
const applyFile = (db, f) => {
  const src = readFileSync(join(root, "worker/migrations", f), "utf8");
  let buf = "";
  for (const st of src.split(/;\s*\n/)) {
    buf = buf ? `${buf};\n${st}` : st;
    if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
    try { db.exec(buf); } catch { /* an older statement the later ones replace */ }
    buf = "";
  }
};
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of MIGS) applyFile(db, f);
  /* A TRUE RACE: while `barrier` is set, the route's read of the claim
     (the SQL holding `barrier.sql`) waits until both requests have read it -
     so both act on the same state, as two people pressing at once. */
  let barrier = null;
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => {
      const r = st.get(...b) ?? null;
      if (barrier && sql.includes(barrier.sql)) { barrier.n += 1; if (barrier.n >= 2) barrier.go(); await barrier.p; }
      return r;
    }, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  let fixed = Date.parse("2026-11-02T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const U = { ceo: 1, sa: 2, coo: 3, cco: 4, aina: 5, hana: 6, lia: 7 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','permanent',900000),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}','permanent',0),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','permanent',800000),
    (4,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','permanent',800000),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',400000),
    (7,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',300000)`);
  /* a paid claim as production holds one: paid 02-08, its cash row back-dated
     to 15-08 by the Finance 2.0 back-fill, the CEO's audit line */
  db.exec(`INSERT INTO claims (id, user_id, claim_date, category, amount_cents, status, decided_by, decided_at, created_at, paid_at, claim_type)
             VALUES (90, 4, '2026-08-01', 'travel', 1870, 'approved', 1, '2026-08-02 06:45:00', '2026-08-02 04:45:00', '2026-08-02 06:52:18', 'reimbursement')`);
  db.exec(`INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key)
             VALUES ('2026-08-15', 'out', 'claims', 1870, 'Staff claim reimbursement', 'CLM-90', 1, '2026-08-15', 'CLM-90')`);
  db.exec(`INSERT INTO audit_log (user_id, action, entity, entity_id, created_at) VALUES (1, 'claim.paid', 'claims', '90', '2026-08-02 06:52:18')`);
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = worker.default;
  const tok = {};
  const session = (id) => { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); };
  for (const id of Object.values(U)) session(id);
  const call = async (path, uid, method = "GET", body) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const noticed = (uid, like) => n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ref LIKE ?`, uid, like);
  const rowOf = async (uid, id) => ((await call(`/claims`, uid)).j?.claims ?? []).find((c) => c.id === id);
  const states = (c) => (c?.timeline ?? []).map((s) => `${s.key}:${s.state}`).join(" ");
  let seq = 0;
  const submit = async (uid, amount = 11.3) => (await call(`/claims`, uid, "POST", { items: [{ claim_date: "2026-11-01", category: "stationery", description: "Printer paper", amount }], submission_key: `k-${uid}-${++seq}-0123456789abcdef` })).j?.id;
  const cash = (id) => db.prepare(`SELECT * FROM cashflow_entries WHERE ref = ? ORDER BY id`).all(`CLM-${id}`);
  const payroll = () => sha(JSON.stringify((() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })()));
  const payroll0 = payroll();
  const race = (sqlPart) => { let go; const p = new Promise((r) => { go = r; }); barrier = { n: 0, p, go, sql: sqlPart }; };
  try {
    /* ---------- 1. submitted: the first stage, the right approver ---------- */
    const A = await submit(U.aina);
    let c = await rowOf(U.aina, A);
    ok(A && states(c) === "submitted:done hr:now pre:todo final:todo payment:todo" && c.waiting_on === "hr" && c.timeline[0].at && c.timeline[0].who === "Aina Seller", "(1) a new staff claim shows Submitted (who, when) and waits on HR - not on the CCO, not paid", states(c));
    ok(noticed(U.hana, `claim:${A}`) === 1 && noticed(U.coo, `claim:${A}%`) === 0, "(2) HR is told it waits on them; the COO is not told yet");
    const asHana = await rowOf(U.hana, A), asCoo = await rowOf(U.coo, A), asCeo = await rowOf(U.ceo, A);
    ok(asHana.my_turn === true && asHana.actions.includes("review") && asHana.actions.includes("return") && !asHana.actions.includes("approve"), "(2) HR's turn: HR review and Return for info", JSON.stringify(asHana.actions));
    ok(asCoo.my_turn === false && !asCoo.actions.some((a) => ["review", "preapprove", "approve", "return"].includes(a)), "(3) the COO has nothing to do before HR", JSON.stringify(asCoo.actions));
    ok(asCeo.my_turn === false && asCeo.actions.includes("approve") && JSON.stringify(asCeo.skip_if_approved) === JSON.stringify(["hr", "pre"]), "(3) the CEO may approve early - and is told it skips HR and the COO (not his turn)", JSON.stringify([asCeo.actions, asCeo.skip_if_approved]));
    ok(c.actions.length === 0, "(5) the claimant may not approve, reject or pay their own claim", JSON.stringify(c.actions));
    /* ---------- 4. unauthorized decisions refused by the server ---------- */
    ok((await call(`/claims/${A}/decide`, U.lia, "POST", { action: "approve" })).status === 403 && (await call(`/claims/${A}/review`, U.coo, "POST", {})).status === 403
      && (await call(`/claims/${A}/preapprove`, U.coo, "POST", {})).status === 400 && (await call(`/claims/${A}/paid`, U.ceo, "POST", {})).status === 400
      && (await call(`/claims/${A}/return`, U.lia, "POST", { comment: "Why is this so expensive?" })).status === 403, "(4) a direct request outside the chain is refused: staff decide, COO review, COO before HR, paying a pending claim, a stranger's return");
    /* ---------- HR review ---------- */
    ok((await call(`/claims/${A}/review`, U.hana, "POST", {})).j?.ok === true, "HR reviews it");
    c = await rowOf(U.aina, A);
    ok(states(c) === "submitted:done hr:done pre:now final:todo payment:todo" && c.timeline[1].who === "Hana" && c.timeline[1].at && c.waiting_on === "coo", "(2) HR done (who, when); it waits on the COO", states(c));
    /* ---------- D1. returned for more information ---------- */
    ok((await call(`/claims/${A}/return`, U.coo, "POST", { comment: "Why?" })).status === 400, "a return needs a real question");
    ok((await call(`/claims/${A}/return`, U.coo, "POST", { comment: "Which client was the paper for?" })).j?.returned_from === "pre", "the COO returns it with a question");
    c = await rowOf(U.aina, A);
    ok(c.waiting_on === "applicant" && states(c) === "submitted:done hr:done pre:returned final:todo payment:todo" && c.timeline[2].text === "Which client was the paper for?" && c.status === "pending" && c.actions.join() === "resubmit", "the timeline shows it returned at the COO's step with the question, waiting on the claimant", states(c));
    ok(noticed(U.aina, `claim:${A}:return%`) === 1, "the claimant is told");
    ok((await call(`/claims/${A}/decide`, U.ceo, "POST", { action: "approve", totp: code() })).status === 409 && (await call(`/claims/${A}/preapprove`, U.coo, "POST", {})).status === 409, "a returned claim cannot be approved or pre-approved until it comes back");
    ok((await call(`/claims/${A}/resubmit`, U.lia, "POST", { comment: "Me" })).status === 403 && (await call(`/claims/${A}/resubmit`, U.aina, "POST", { comment: "" })).status === 400, "only the claimant answers, with an answer");
    ok((await call(`/claims/${A}/resubmit`, U.aina, "POST", { comment: "Kasih Rabiah's proposal" })).j?.ok === true, "the claimant answers");
    c = await rowOf(U.aina, A);
    ok(states(c) === "submitted:done hr:done pre:now final:todo payment:todo" && c.timeline[2].flags?.answered === true && one(`SELECT hr_reviewed_at FROM claims WHERE id = ?`, A).hr_reviewed_at, "back at the SAME stage (the COO's), HR's review kept, and it says it was answered", states(c));
    ok(noticed(U.coo, `claim:${A}`) >= 1, "the COO is told it waits on them again");
    const thread = (await call(`/claims/${A}/comments`, U.aina)).j?.comments ?? [];
    ok(thread.length === 2 && thread[0].body.includes("Which client") && thread[1].body.includes("Kasih Rabiah"), "the question and the answer are kept in the thread");
    /* ---------- 10. one pre-approval under a true race ---------- */
    race("c.pre_approved_at, u.role AS claimant_role, u.name AS claimant_name");
    const both = await Promise.all([call(`/claims/${A}/preapprove`, U.coo, "POST", {}), call(`/claims/${A}/preapprove`, U.sa, "POST", {})]);
    barrier = null;
    ok(both.map((r) => r.status).sort().join() === "200,409" && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.preapprove' AND entity_id = ?`, String(A)) === 1, "(10) the COO and the super admin pressing at once make ONE pre-approval - the other is refused (409)", JSON.stringify(both.map((r) => [r.status, r.text.slice(0, 80)])));
    c = await rowOf(U.ceo, A);
    ok(states(c) === "submitted:done hr:done pre:done final:now payment:todo" && c.waiting_on === "ceo" && c.my_turn === true && (c.skip_if_approved ?? []).length === 0, "now it is the CEO's turn, with nothing skipped", states(c));
    /* ---------- 5. approved is NOT paid ---------- */
    ok((await call(`/claims/${A}/decide`, U.ceo, "POST", { action: "approve", totp: code() })).j?.ok === true, "the CEO approves (with his code)");
    c = await rowOf(U.aina, A);
    ok(states(c) === "submitted:done hr:done pre:done final:done payment:now" && c.waiting_on === "payment" && c.paid_at == null && cash(A).length === 0, "(5) approved: Payment due - the payment step is NOT done and no money was booked", states(c));
    ok((await call(`/claims/${A}/decide`, U.ceo, "POST", { action: "reject", note: "Changed my mind" })).status === 400, "a decided claim is not decided again");
    /* ---------- D3 + 6, 7. the payment, with the bank date ---------- */
    fixed += 2 * 86400000; // two days later
    ok((await call(`/claims/${A}/paid`, U.aina, "POST", {})).status === 403, "the claimant cannot mark their claim paid");
    ok((await call(`/claims/${A}/paid`, U.ceo, "POST", { paid_on: "2026-11-09" })).status === 400 && (await call(`/claims/${A}/paid`, U.ceo, "POST", { paid_on: "2026-11-01" })).status === 400 && cash(A).length === 0, "the bank date can be neither after today nor before the approval");
    ok((await call(`/claims/${A}/paid`, U.ceo, "POST", { paid_on: "2026-11-03" })).j?.ok === true, "the CEO records the payment with the bank date");
    c = await rowOf(U.aina, A);
    const pay = c.timeline.at(-1);
    ok(states(c) === "submitted:done hr:done pre:done final:done payment:done" && pay.flags?.bank_date === "2026-11-03" && pay.who === "Alif Farhan" && pay.at === c.paid_at && c.waiting_on === null, "(6, 7) paid: the step is done with who recorded it and the bank date of the payout record", JSON.stringify(pay));
    const rows = cash(A);
    ok(rows.length === 1 && rows[0].effective_date === "2026-11-03" && rows[0].amount_cents === 1130 && rows[0].type === "out", "(7) ONE cash book row, dated the bank date, for the claimed amount", JSON.stringify(rows));
    const again = await call(`/claims/${A}/paid`, U.ceo, "POST", { paid_on: "2026-11-04" });
    ok(again.j?.already_paid === true && cash(A).length === 1 && n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.paid' AND entity_id = ?`, String(A)) === 1, "(10) Mark paid twice books nothing twice");
    ok(noticed(U.aina, `claim:${A}`) >= 2, "the claimant is told it was approved and paid");
    /* a Finance reversal of that cash row shows on the timeline */
    db.prepare(`INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by, effective_date, reversal_of, reverse_reason) VALUES ('2026-11-04', 'in', 'claims', 1130, 'Reversal', 'CLM-${A}', 1, '2026-11-04', ?, 'Paid to the wrong account')`).run(rows[0].id);
    c = await rowOf(U.aina, A);
    ok(c.timeline.at(-1).state === "rejected" && c.timeline.at(-1).flags?.reversed_on === "2026-11-04", "a payment reversed in Finance reads as reversed on its date - not as paid");
    /* ---------- 9. history kept ---------- */
    c = await rowOf(U.ceo, 90);
    ok(states(c) === "submitted:done final:done payment:done" && c.paid_at === "2026-08-02 06:52:18" && c.timeline.at(-1).flags?.bank_date === "2026-08-15" && c.timeline.at(-1).who === "Alif Farhan", "(9) an old paid claim keeps its paid time and its back-filled bank date - nothing invented", states(c));
    /* ---------- the HR chain: the CCO, and the CEO's recorded override ---------- */
    const B = await submit(U.hana, 50);
    c = await rowOf(U.ceo, B);
    ok(states(c) === "submitted:done pre:now final:todo payment:todo" && c.waiting_on === "cco" && JSON.stringify(c.skip_if_approved) === JSON.stringify(["pre"]) && c.my_turn === false, "(2) an HR claim waits on the CCO ('awaiting CCO'); the CEO's Approve would skip the CCO", states(c));
    ok((await rowOf(U.cco, B)).my_turn === true && noticed(U.cco, `claim:${B}`) === 1, "(3) it is the CCO's turn, and the CCO was told");
    ok((await call(`/claims/${B}/decide`, U.ceo, "POST", { action: "approve", totp: code() })).j?.ok === true, "the CEO approves it directly");
    c = await rowOf(U.hana, B);
    ok(states(c) === "submitted:done pre:skipped final:done payment:now" && c.timeline[1].flags?.override === true && c.timeline[2].flags?.override === true && /CCO pre-approval bypassed/.test(c.decision_note ?? ""), "the override shows the CCO's step as skipped - never signed - and the note records it", states(c));
    /* ---------- 8. rejection is terminal, with its reason ---------- */
    const C = await submit(U.lia, 20);
    ok((await call(`/claims/${C}/decide`, U.ceo, "POST", { action: "reject", note: "Personal purchase" })).j?.ok === true, "the CEO rejects a claim");
    c = await rowOf(U.lia, C);
    ok(states(c) === "submitted:done hr:rejected pre:off final:off payment:off" && c.timeline[1].text === "Personal purchase" && c.timeline[1].who === "Alif Farhan" && c.waiting_on === null, "(8) rejected: red at the stage it stood at, with who and why; nothing after it - no payment", states(c));
    /* ---------- 10. approve and reject at once ---------- */
    const D = await submit(U.lia, 30);
    race("c.pre_approved_at, u.role AS claimant_role\n       FROM claims c");
    const dr = await Promise.all([call(`/claims/${D}/decide`, U.ceo, "POST", { action: "approve", totp: code() }), call(`/claims/${D}/decide`, U.sa, "POST", { action: "reject", note: "Duplicate" })]);
    barrier = null;
    ok(dr.filter((r) => r.status === 200).length === 1 && dr.some((r) => r.status === 409) && n(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ? AND action IN ('claim.approve', 'claim.reject')`, String(D)) === 1 && noticed(U.lia, `claim:${D}`) === 1, "(10) an approval and a rejection pressed at once: one decision stands, one notice, the other refused (409)", JSON.stringify(dr.map((r) => [r.status, r.text.slice(0, 80)])));
    /* ---------- the COO's own claim: straight to the CEO ---------- */
    const E = await submit(U.coo, 40);
    c = await rowOf(U.ceo, E);
    ok(states(c) === "submitted:done final:now payment:todo" && c.waiting_on === "ceo" && c.my_turn === true, "a COO's claim goes straight to the CEO - his turn", states(c));
    /* ---------- D2 + 11. comments and who reads what ---------- */
    ok((await call(`/claims/${A}/comments`, U.hana, "POST", { body: "Receipt matches the supplier invoice", visibility: "internal" })).status === 201, "management writes an internal note");
    const seen = (await call(`/claims/${A}/comments`, U.aina)).j;
    ok(seen.comments.every((m) => m.visibility === "employee") && seen.can_internal === false, "(11) the claimant never reads an internal note");
    ok((await call(`/claims/${A}/comments`, U.aina, "POST", { body: "Sneaky", visibility: "internal" })).status === 403, "...nor writes one");
    ok((await call(`/claims/${A}/comments`, U.lia)).status === 404 && (await call(`/claims/${A}/activity`, U.lia)).status === 404, "(11) another employee reaches nothing of this claim");
    ok((await call(`/claims/${A}/comments`, U.coo)).j?.comments?.some((m) => m.visibility === "internal"), "the COO (who reads the staff chain) reads the internal note");
    const act = (await call(`/claims/${A}/activity`, U.aina)).j?.activity ?? [];
    ok(["claim.create", "claim.hr_review", "claim.return", "claim.answer", "claim.preapprove", "claim.approve", "claim.paid"].every((a) => act.some((x) => x.action === a)) && !act.some((x) => x.action === "claim.comment") && act.every((x) => x.detail === undefined), "Activity shows the claimant every official event, without internal notes or detail", JSON.stringify(act.map((x) => x.action)));
    const lia = (await call(`/claims`, U.lia)).j?.claims ?? [];
    ok(lia.length > 0 && lia.every((x) => x.user_id === U.lia), "(11) an employee lists only their own claims");
    ok(payroll() === payroll0, "no payroll row was written by any of it");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const dir = mkdtempSync(join(tmpdir(), "golive-k-"));
const main = given ?? join(dir, "worker.mjs");
if (!given) bundle(root, main);
report(await runtime(main));
const checks = n;
if (given || process.env.NOMUT) {
  if (fail) { console.error(`go-live-k: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`go-live-k: ${n} checks passed`); process.exit(0);
}

const MUT = [
  ["worker/src/staff.ts", "a decision does not check the claim is still pending", "decided_at = datetime('now'), decision_note = ?3 WHERE id = ?4 AND status = 'pending'`", "decided_at = datetime('now'), decision_note = ?3 WHERE id = ?4`"],
  ["worker/src/staff.ts", "a pre-approval does not check it was not given already", "WHERE id = ?2 AND status = 'pending' AND pre_approved_at IS NULL`", "WHERE id = ?2`"],
  ["worker/src/claim-chain.ts", "an approved claim shows as paid", "    if (!r.paid_at) steps.push({ key: \"payment\", state: \"now\"", "    if (!r.paid_at) steps.push({ key: \"payment\", state: \"done\""],
  ["worker/src/claim-chain.ts", "the page offers HR review to the COO", "chain === \"staff\" && !r.hr_reviewed_at && [\"hr_admin\", ...ADMIN_TIER].includes(actor.role)", "chain === \"staff\" && !r.hr_reviewed_at && [\"hr_admin\", \"coo\", ...ADMIN_TIER].includes(actor.role)"],
  ["worker/src/staff.ts", "the claimant reads internal notes", "WHERE m.claim_id = ?1 ${internalOk ? \"\" : \"AND m.visibility = 'employee'\"} ORDER BY m.id`", "WHERE m.claim_id = ?1 ORDER BY m.id`"],
  ["worker/src/staff.ts", "a bank date after today is taken", "      if (body.paid_on > todayMyt) return err(", "      if (false) return err("],
  ["worker/src/staff.ts", "a returned claim can be approved", "    if (action === \"approve\") { const st = await readClaimChain(clMatch[1]!); if (st && claimReturnOpen(st)) return claimReturnedErr(); }", ""],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-k-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`go-live-k: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-k: ${checks} checks passed (${MUT.length} mutations caught) - the claims approval and payment timeline: each chain's first stage and current approver from the one claim chain; what each person may do is exactly what the endpoints accept; unauthorized decisions refused; one decision per stage under a true race; returned for information and answered back to the same stage; approved is Payment due, never paid; Mark paid books one cash row on the bank date, never before approval or after today, never twice; a Finance reversal shows as reversed; old paid claims keep their dates; the override shown as skipped; rejection terminal with its reason; internal notes never reach the claimant; no payroll row written`);

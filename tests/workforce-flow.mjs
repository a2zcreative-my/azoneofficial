import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => readFileSync(path, "utf8");
const staff = read("worker/src/staff.ts");
const claims = read("components/portal/role-panels.tsx");
const payroll = read("components/portal/payroll-panel.tsx");
const ot = read("components/portal/live-cards.tsx");
const tabs = read("lib/portal-tabs.ts");
const migration = read("worker/migrations/0136_claim_advances.sql");

assert.match(tabs, /PARKED_TABS[^\n]+"Threads"/, "Threads must stay parked at the registry rail");
const whitelist = staff.match(/const TAB_ACCESS_TABS = \[([^\]]+)\]/)?.[1] ?? "";
assert(!whitelist.includes("Threads"), "a parked tab must not remain grantable by the API");

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE claims(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,claim_date TEXT,category TEXT,amount_cents INTEGER,description TEXT,receipt_key TEXT,status TEXT,decision_note TEXT,decided_by INTEGER,decided_at TEXT,created_at TEXT,items TEXT,paid_at TEXT,hr_reviewed_by INTEGER,hr_reviewed_at TEXT,pre_approved_by INTEGER,pre_approved_at TEXT,payment_proof_key TEXT,payee_user_id INTEGER,issuer_code TEXT);");
db.exec(migration);
db.prepare("INSERT INTO claims(user_id,submission_key) VALUES(?,?)").run(7,"same-request-key");
assert.throws(() => db.prepare("INSERT INTO claims(user_id,submission_key) VALUES(?,?)").run(7,"same-request-key"), /UNIQUE/, "a replay must not create a second claim");
db.prepare("INSERT INTO claims(user_id,submission_key) VALUES(?,?)").run(8,"same-request-key");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM claims").get().n,2,"idempotency is scoped to the claimant");

assert.match(claims, /submitLock\.current/, "the claim button needs an immediate double-tap lock");
assert.match(claims, /submission_key: submissionKey\.current/, "the request must carry a stable replay key");
assert.match(staff, /INSERT OR IGNORE INTO claims[\s\S]+submission_key/, "the API must enforce the replay key");
assert(staff.indexOf("return json({ id: res.id, duplicate: true })") < staff.indexOf("await notifyClaimFirstStage", staff.indexOf("return json({ id: res.id, duplicate: true })")), "a duplicate must return before notification and audit");

assert.match(staff, /claim_type = 'salary_advance'[\s\S]+status = 'approved' AND paid_at IS NOT NULL/, "only approved and paid advances reach payroll");
assert.match(staff, /claim_type = 'reimbursement'/, "advances must stay out of expense totals");
assert.match(staff, /advanceAtR\(e\.user_id\)/, "payroll recompute must recover advances");
assert.match(payroll, /SALARY ADVANCE \(\$\{month\}\)/, "the payslip must name the advance deduction");
assert.match(payroll, /salary_advance_cents[^\n]+autoDed|autoDed[\s\S]{0,180}salary_advance_cents/, "the employee payslip total must include the advance");

assert.match(staff, /decision === "replacement"[\s\S]+env\.DB\.batch/, "OT conversion must credit leave and decide OT atomically");
assert.match(staff, /status = 'replacement'/, "replacement OT must not be selected by payroll's approved-only query");
assert.match(ot, /Half-day leave/, "the CEO must be offered half-day replacement leave");
assert.match(ot, /Full-day leave/, "the CEO must be offered full-day replacement leave");

console.log("PASS - Threads retirement, claim idempotency, salary advances and OT replacement are one guarded workflow");

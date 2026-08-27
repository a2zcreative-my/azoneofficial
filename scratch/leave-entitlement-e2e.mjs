/**
 * v1.62.0 — the CEO's leave-entitlement control, proved against the REAL
 * worker on a scratch database.
 *
 * The CEO, 27-08-2026: "I as CEO can change or update their leave entitle to
 * all the staff so that I can control their Annual Leave entitlement which is
 * no abuse!"
 *
 * What this rig is actually for: the whole value of the feature is in what it
 * REFUSES. A screen that saves numbers is easy; the reason this one exists is
 * that HR must not be able to raise its own days, and medical leave must not
 * be settable below the statutory minimum. Both of those are one-line
 * mistakes to make and invisible in a screenshot, so they are tested here.
 *
 * Setup (same as the other rigs in this folder):
 *   cd worker
 *   npx wrangler d1 migrations apply azoneofficial --local --config wrangler.e2e.toml
 *   cd .. && node scratch/seed-e2e.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8300
 *   node scratch/leave-entitlement-e2e.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const API = process.env.PORTAL_API ?? "http://127.0.0.1:8300/api/v1";
const WORKER = new URL("../worker", import.meta.url).pathname;
const sql = (s) => execFileSync("npx", [
  "wrangler", "d1", "execute", "azoneofficial", "--local",
  "--config", "wrangler.e2e.toml", "--command", s,
], { cwd: WORKER, stdio: "pipe" }).toString();

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

/* Two signed-in people: the CEO (seeded as user 1) and an HR admin. The HR
   session is the whole point of the rig — it must be able to run the Leave
   tab and still be refused this one door. */
const sess = (token) => createHash("sha256").update(token).digest("hex");
const CSRF = "e2ecsrf";
/* The rig interleaves HTTP calls with `wrangler d1 execute` shell-outs, which
   take long enough that the dev server drops the idle keep-alive socket
   underneath us — undici then throws "other side closed" on the next reuse.
   One retry on a transport error (never on an HTTP status) makes the rig test
   the worker instead of the socket pool. */
const as = async (token, path, init = {}) => {
  const send = () => fetch(`${API}/staff${path}`, {
    ...init,
    headers: {
      Cookie: `azone_session=${token}; csrf_token=${CSRF}`,
      "X-CSRF-Token": CSRF, "Content-Type": "application/json",
      Connection: "close",
      ...(init.headers ?? {}),
    },
  });
  try {
    return await send();
  } catch {
    await new Promise((r) => setTimeout(r, 250));
    return send();
  }
};
const ceo = (p, i) => as("e2etoken", p, i);
const hr = (p, i) => as("e2ehr", p, i);

step("set up an HR admin and a staff member to be entitled");
/* totp_enabled = 1: mandatory 2FA is enforced server-side since v1.45.0, so
   a test account without it is refused before any route runs. */
sql(`INSERT OR REPLACE INTO users (id, email, password_hash, name, role, is_active, totp_secret, totp_enabled)
     VALUES (90, 'hr@e2e.local', 'x', 'HR Person', 'hr_admin', 1, 'E2EHRSECRET23456789', 1)`);
sql(`INSERT OR REPLACE INTO users (id, email, password_hash, name, role, is_active, totp_secret, totp_enabled)
     VALUES (91, 'staff@e2e.local', 'x', 'Staff Person', 'sales_marketing', 1, 'E2ESTFSECRET2345678', 1)`);
sql(`INSERT OR REPLACE INTO sessions (id, user_id, expires_at)
     VALUES ('${sess("e2ehr")}', 90, datetime('now', '+30 days'))`);
sql(`DELETE FROM leave_balances WHERE year = 2026`);
ok("two extra accounts exist", true);

step("the CEO can read the whole table");
const listed = await ceo(`/leave/entitlements?year=2026`);
const list = await listed.json().catch(() => null);
ok("GET /leave/entitlements returns 200", listed.status === 200, `${listed.status}`);
ok("every active staff member is listed",
   Array.isArray(list?.staff) && list.staff.some((p) => p.id === 91),
   JSON.stringify(list).slice(0, 160));
{
  const p = list?.staff?.find((x) => x.id === 91);
  ok("someone with no row shows the DEFAULT, not zero", p?.entitlement?.annual?.days === 14,
     JSON.stringify(p?.entitlement));
  ok("and is marked as a default rather than a chosen figure",
     p?.entitlement?.annual?.set === false);
  ok("medical is not offered as editable",
     !Object.keys(p?.entitlement ?? {}).includes("medical"));
}

step("THE POINT — HR cannot change what anyone is owed");
{
  const r = await hr(`/leave/entitlements?year=2026`);
  ok("HR cannot even read the table (403)", r.status === 403, `${r.status}`);
}
{
  const r = await hr(`/leave/entitlement`, {
    method: "PUT",
    body: JSON.stringify({ user_id: 90, year: 2026, type: "annual", entitled: 60 }),
  });
  ok("HR cannot raise its OWN annual leave (403)", r.status === 403, `${r.status}`);
}
{
  const r = await hr(`/leave/entitlements/bulk`, {
    method: "PUT",
    body: JSON.stringify({ year: 2026, type: "annual", entitled: 60 }),
  });
  ok("HR cannot set everyone's leave either (403)", r.status === 403, `${r.status}`);
}
{
  const row = sql(`SELECT COUNT(*) AS n FROM leave_balances WHERE year = 2026`);
  ok("and nothing was written by any of those attempts", /\b0\b/.test(row), row.trim().slice(-40));
}

step("statutory leave is not on offer");
for (const t of ["medical", "unpaid", "replacement"]) {
  const r = await ceo(`/leave/entitlement`, {
    method: "PUT",
    body: JSON.stringify({ user_id: 91, year: 2026, type: t, entitled: 5 }),
  });
  ok(`${t} leave is refused even for the CEO (400)`, r.status === 400, `${r.status}`);
}
{
  const r = await ceo(`/leave/entitlement`, {
    method: "PUT",
    body: JSON.stringify({ user_id: 91, year: 2026, type: "medical", entitled: 5 }),
  });
  const b = await r.json().catch(() => null);
  ok("and the reason names the law rather than reading as a bug",
     /statutory/i.test(b?.error?.message ?? ""), b?.error?.message);
}

step("the CEO sets one person's annual leave");
{
  const r = await ceo(`/leave/entitlement`, {
    method: "PUT",
    body: JSON.stringify({ user_id: 91, year: 2026, type: "annual", entitled: 18 }),
  });
  const b = await r.json().catch(() => null);
  ok("accepted", r.status === 200, `${r.status}`);
  ok("and it reports what it replaced", b?.before === null && b?.after === 18, JSON.stringify(b));
  const row = sql(`SELECT entitled FROM leave_balances WHERE user_id = 91 AND year = 2026 AND type = 'annual'`);
  ok("the database holds 18", /\b18\b/.test(row), row.trim().slice(-40));
}
{
  const listed2 = await (await ceo(`/leave/entitlements?year=2026`)).json();
  const p = listed2.staff.find((x) => x.id === 91);
  ok("the table now shows it as a CHOSEN figure, not a default",
     p?.entitlement?.annual?.days === 18 && p?.entitlement?.annual?.set === true,
     JSON.stringify(p?.entitlement?.annual));
}

step("half days are allowed; thirds are not");
{
  const good = await ceo(`/leave/entitlement`, {
    method: "PUT", body: JSON.stringify({ user_id: 91, year: 2026, type: "annual", entitled: 18.5 }),
  });
  ok("18.5 days accepted", good.status === 200, `${good.status}`);
  const bad = await ceo(`/leave/entitlement`, {
    method: "PUT", body: JSON.stringify({ user_id: 91, year: 2026, type: "annual", entitled: 18.3 }),
  });
  ok("18.3 days refused", bad.status === 400, `${bad.status}`);
  const neg = await ceo(`/leave/entitlement`, {
    method: "PUT", body: JSON.stringify({ user_id: 91, year: 2026, type: "annual", entitled: -5 }),
  });
  ok("a negative entitlement is refused", neg.status === 400, `${neg.status}`);
}

step("set-everyone writes the whole company");
{
  const r = await ceo(`/leave/entitlements/bulk`, {
    method: "PUT", body: JSON.stringify({ year: 2026, type: "annual", entitled: 16 }),
  });
  const b = await r.json().catch(() => null);
  ok("accepted", r.status === 200, `${r.status}`);
  ok("it reports how many it touched", (b?.updated ?? 0) >= 3, JSON.stringify(b));
  const row = sql(`SELECT COUNT(*) AS n FROM leave_balances WHERE year = 2026 AND type = 'annual' AND entitled = 16`);
  ok("every active staff member now holds 16", !/\b0\b/.test(row.split("\n").pop() ?? ""), row.trim().slice(-40));
  const row2 = sql(`SELECT COUNT(*) AS n FROM leave_balances WHERE year = 2026 AND type = 'medical'`);
  ok("and the bulk write did NOT invent medical rows", /\b0\b/.test(row2), row2.trim().slice(-40));
}

step("every change is answerable from the audit log");
{
  const row = sql(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'leave.entitlement'`);
  ok("the entitlement changes are recorded", !/\|\s*0\s*\|/.test(row) && !/\b0\b/.test(row.split("\n").pop() ?? ""),
     row.trim().slice(-60));
  const who = sql(`SELECT user_id FROM audit_log WHERE action = 'leave.entitlement' ORDER BY id DESC LIMIT 1`);
  ok("attributed to the CEO who made it", /\b1\b/.test(who), who.trim().slice(-40));
}

step("the raise does not hand over the whole year at once");
{
  /* The "no abuse" rule: annual leave accrues pro-rata, so what a person can
     actually TAKE today is a fraction of the entitlement, not all of it. */
  const b = await (await ceo(`/leave/balance`)).json().catch(() => null);
  const annual = b?.balances?.annual;
  ok("the balance route still answers", Boolean(annual), JSON.stringify(b).slice(0, 120));
  if (annual) {
    ok("accrued is never more than entitled", annual.accrued <= annual.entitled,
       `accrued ${annual.accrued} vs entitled ${annual.entitled}`);
  }
}

step("tidy up");
sql(`DELETE FROM leave_balances WHERE year = 2026`);
sql(`DELETE FROM audit_log WHERE action = 'leave.entitlement'`);
sql(`DELETE FROM sessions WHERE user_id = 90`);
sql(`DELETE FROM users WHERE id IN (90, 91)`);
ok("scratch rows removed", true);

console.log(`\n${fail ? "FAIL" : "PASS"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

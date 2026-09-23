/**
 * THE DASHBOARD IS A PROJECTION OF EXISTING AUTHORITY — v1.177.2.
 *
 * `GET /api/v1/staff/dashboard/summary` used to return everything to anyone
 * signed in and not a customer. Its own comment explained the reasoning:
 * "Counts are universal facts; the CARD decides per role what to show." The
 * card is a React component and curl does not run React, so a `live_host` —
 * holding neither `revenue_view` nor `finance`, with no finance tab in their
 * portal at all — could read the month's cash in and cash out with their own
 * valid session cookie. `components/portal/trading-desk.tsx` also fetched the
 * route UNCONDITIONALLY, before the role check that decides whether anything
 * is drawn, so the figures were written into every staff member's
 * localStorage whether or not a tile ever appeared.
 *
 * This file RUNS THE HANDLER. A source check can say the gate is written; only
 * a call can say it is reached. Each role below gets a real Request through
 * `handleStaff` against a stub D1, and the assertions are about the JSON that
 * comes back — which is what an attacker sees.
 *
 * THE RULE: a summary field may never reveal what the same person cannot get
 * from the feature that owns it. An absent field is OMITTED, never zeroed — a
 * 0 asserts "the authorised answer is zero", which is a different and false
 * statement.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- bundle the real worker module ---- */
const dir = mkdtempSync(join(tmpdir(), "dashauthz-"));
const out = join(dir, "staff.mjs");
execSync(
  `npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`,
  { cwd: root, stdio: "inherit" },
);
const mod = await import(pathToFileURL(out).href);

/* ---- a D1 stub: every COUNT answers 7, so a present field is unmistakable
        and an absent one cannot be confused with a real zero ---- */
const env = {
  DB: {
    prepare: () => ({
      bind() { return this; },
      first: async () => ({ c: 7 }),
      run: async () => ({ meta: { changes: 0 } }),
      all: async () => ({ results: [] }),
    }),
  },
};

const callSummary = async (role) => {
  const req = new Request("https://x/api/v1/staff/dashboard/summary", { method: "GET" });
  const res = await mod.handleStaff(req, env, "/dashboard/summary", { id: 1, role, email: "t@x.my", name: "T" });
  return res ? await res.json() : null;
};

/* Which fields each role must and must not receive. Derived from the owning
   endpoint of each figure, NOT from who happens to render a tile. */
const MONEY = ["cash_in_cents", "cash_out_cents"];
const OPEN = ["today", "lives_today", "staff_total"];

const CASES = [
  {
    role: "live_host",
    why: "no finance, no sales, no HR — the role the original hole exposed",
    must: OPEN,
    mustNot: [...MONEY, "clients", "low_stock", "open_quotations", "outstanding_invoices",
              "pending_leave", "pending_claims", "pending_ot", "attendance_today",
              "attendance_on_time", "attendance_late", "active_stokis"],
  },
  {
    role: "editor",
    why: "content only",
    must: OPEN,
    mustNot: [...MONEY, "clients", "pending_claims", "attendance_on_time"],
  },
  {
    role: "marketing",
    why: "holds revenue_view and inventory, but NOT sales, expenses, hr_manage or claims_decide",
    must: [...OPEN, "cash_in_cents", "low_stock", "active_stokis"],
    mustNot: ["cash_out_cents", "clients", "open_quotations", "outstanding_invoices",
              "pending_leave", "pending_claims", "pending_ot", "attendance_on_time"],
  },
  {
    role: "sales_marketing",
    why: "sales and revenue, but no expenses, no HR, no claims decision, no OT decision",
    must: [...OPEN, "cash_in_cents", "clients", "open_quotations", "outstanding_invoices", "low_stock"],
    mustNot: ["cash_out_cents", "pending_claims", "pending_ot", "pending_leave", "attendance_late"],
  },
  {
    role: "hr_admin",
    why: "the owner's call, 22-09-2026: tightened OUT of expenses, OT and claims decisions",
    must: [...OPEN, "pending_leave", "attendance_today", "attendance_on_time", "attendance_late",
           "clients", "low_stock", "cash_in_cents"],
    mustNot: ["cash_out_cents", "pending_ot", "pending_claims"],
  },
  {
    role: "cco",
    why: "exec_view and revenue, but expenses/OT/claims are not theirs",
    must: [...OPEN, "pending_leave", "attendance_on_time", "clients", "low_stock", "cash_in_cents"],
    mustNot: ["cash_out_cents", "pending_ot", "pending_claims"],
  },
  {
    role: "coo",
    why: "holds expenses and the OT decision; claims_decide is still only super_admin/ceo",
    must: [...OPEN, "cash_in_cents", "cash_out_cents", "pending_ot", "pending_leave", "clients"],
    mustNot: ["pending_claims"],
  },
  {
    role: "ceo",
    why: "everything",
    must: [...OPEN, ...MONEY, "pending_claims", "pending_ot", "pending_leave",
           "clients", "low_stock", "open_quotations", "outstanding_invoices",
           "attendance_today", "attendance_on_time", "attendance_late", "active_stokis"],
    mustNot: [],
  },
];

console.log("dashboard-authz — calling the handler as each role\n");
for (const c of CASES) {
  const body = await callSummary(c.role);
  ok(`${c.role}: the endpoint answers at all (a missing figure must not 403 the whole summary)`,
     body !== null && typeof body === "object", c.why);
  for (const f of c.must) {
    ok(`${c.role}: receives ${f}`, body?.[f] !== undefined,
       `${c.why} — an authorised figure must arrive`);
  }
  for (const f of c.mustNot) {
    ok(`${c.role}: CANNOT obtain ${f} by calling the endpoint directly`, body?.[f] === undefined,
       `${c.why} — this is the curl an attacker runs`);
    /* the sharper half of the rule: not merely falsy, ABSENT */
    ok(`${c.role}: ${f} is omitted, not zeroed`, !(f in (body ?? {})),
       "a 0 asserts the authorised answer is zero, which is a different and false statement");
  }
}

/* ---- the shape of the rule, so a future edit cannot quietly widen it ---- */
{
  const staff = read("worker/src/staff.ts");
  const h = staff.slice(staff.indexOf('if (path === "/dashboard/summary"'));
  const body = h.slice(0, h.indexOf("\n  /* v1.5.0: /trends/my"));
  ok("each money figure carries its OWN authority",
     /cash_in_cents: await gated\(can\(user\.role, "revenue_view"\)/.test(body)
     && /cash_out_cents: await gated\(can\(user\.role, "expenses"\)/.test(body),
     "revenue_view and expenses are held by different sets of roles");
  ok("the claims figure uses claims_decide, not a dashboard-only audience",
     /pending_claims: await gated\(can\(user\.role, "claims_decide"\)/.test(body),
     "the owner chose strict ownership over preserving accidental visibility");
  ok("the OT figure reuses the OT route's own rule rather than a second copy",
     /const otDecide = OT_DECIDE_ROLES\.includes\(user\.role\);/.test(body)
     && /OT_DECIDE_ROLES\.includes\(user\.role\)/.test(staff.slice(staff.indexOf('/attendance/ot/pending'))),
     "two copies of an authority list is how a dashboard becomes a softer route");
  ok("an unauthorised field is never computed",
     /allowed \? n\(sql\) : undefined/.test(staff),
     "no query, no figure, nothing to leak");
  ok("the handler cannot fall back to returning everything",
     !/return json\(\{\s*today: todayS,[\s\S]{0,200}pending_leave: await n\(/.test(staff));
}

/* ---- the cache transition: yesterday's answer must not outlive the fix ---- */
{
  const cache = read("lib/cached-api.ts");
  ok("the cache carries an epoch and enforces it at import",
     /const EPOCH = "2";/.test(cache)
     && /function enforceEpoch\(\)/.test(cache)
     && /^enforceEpoch\(\);$/m.test(cache),
     "securing the endpoint does not un-send what it already sent");
  ok("the epoch survives an ordinary cache clear",
     /k !== EPOCH_KEY/.test(cache),
     "wiping it would make every load think the deploy had just happened");

  /* run it: a pre-v1.177.2 cache holding cash figures, then the new build */
  const store = new Map([
    ["azone-cache:epoch", "1"],
    ["azone-cache:9:/staff/dashboard/summary", JSON.stringify({ v: 1, t: Date.now(), d: { cash_in_cents: 1234500, cash_out_cents: 90000 } })],
    ["azone-cache:9:/staff/tasks", JSON.stringify({ v: 1, t: Date.now(), d: [] })],
    ["azone-unrelated", "keep me"],
  ]);
  globalThis.window = {
    localStorage: {
      get length() { return store.size; },
      key: (i) => [...store.keys()][i] ?? null,
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
    },
  };
  const cOut = join(dir, "cache.mjs");
  execSync(
    `npx esbuild "${join(root, "lib/cached-api.ts")}" --bundle --format=esm --platform=neutral --outfile="${cOut}" --log-level=error`,
    { cwd: root, stdio: "inherit" },
  );
  await import(pathToFileURL(cOut).href);          // importing runs enforceEpoch()

  ok("a cached dashboard response from before the fix is gone after the upgrade",
     !store.has("azone-cache:9:/staff/dashboard/summary"),
     "otherwise the figures stay readable on the phone for 24h, and for ever offline");
  ok("...and so is every other entry written under the old epoch",
     !store.has("azone-cache:9:/staff/tasks"));
  ok("...while storage that is not ours is left alone",
     store.get("azone-unrelated") === "keep me");
  ok("...and the new epoch is recorded, so the sweep happens once",
     store.get("azone-cache:epoch") === "2");
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`\nPASS — the dashboard grants no authority of its own, and yesterday's answer does not outlive the fix (${passed} checks)`);

#!/usr/bin/env node
/* Guard #46 — v1.112.0: customer enquiries are staff work.
 *
 * The CEO, 05-09-2026: *"Customer enquiries - I think should create a new
 * tabs under customer/client inquiry which is require Staff action for
 * response their inquire either via apps or emails."* What makes an enquiry
 * WORK rather than a record, RUN here:
 *
 *   1. OVERDUE MEANS A CUSTOMER WAITED A DAY. A new enquiry older than 24h is
 *      overdue; an answered, closed or replied one never is, however old.
 *   2. ONE ENQUIRY, ONE PERSON. Taking it records who; handing it to someone
 *      who cannot answer enquiries is refused; the person handed it is told
 *      once, not when they handed it to themselves; a reply takes the
 *      enquiry for the replier unless somebody already has it.
 *   3. THE ANNOUNCER tells everyone with enquiry_manage - and only them -
 *      once, with the Enquiries tab as the landing, and bumps the live topic.
 *   4. THE WIRING: the tab is registered in every registry (the parity guard
 *      holds the order), its roles are the worker's enquiry_manage, both doors
 *      (website form and /account) announce, the desk has an enquiries bucket
 *      the card knows, the bell item is pressable, the old Sales card is gone,
 *      and every mutation reports.
 *
 * Negative-tested by: counting a replied enquiry as overdue (1); dropping the
 * enquiry_manage check on assigned_to (2); announcing to every active user (3).
 */
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const src = read("worker/src/enquiries.ts");
const index = read("worker/src/index.ts");
const staff = read("worker/src/staff.ts");
const desk = read("worker/src/desk.ts");
const deskCard = read("components/portal/one-desk.tsx");
const panel = read("components/portal/enquiries-panel.tsx");
const page = read("app/portal/page.tsx");
const tabs = read("lib/portal-tabs.ts");
const perms = read("worker/src/permissions.ts");
const lazy = read("components/portal/lazy-panels.tsx");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- bundle with shared, permissions (REAL) and staff stubbed ---- */
const dir = mkdtempSync(join(tmpdir(), "enq-"));
writeFileSync(join(dir, "shared.js"), `
export const audits = []; export const bumps = [];
export function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }); }
export function err(code, message, status) { return json({ error: { code, message } }, status); }
export async function audit(env, userId, action, table, id, meta) { audits.push({ userId, action, table, id, meta }); }
export async function bumpVersion(env, topic) { bumps.push(topic); }
`);
writeFileSync(join(dir, "staff.js"), `export const notified = []; export async function notify(env, userId, kind, message, ref) { notified.push({ userId, kind, message, ref }); }`);
const rewritten = src
  .replace('from "./shared"', `from "${join(dir, "shared.js")}"`)
  .replace('from "./staff"', `from "${join(dir, "staff.js")}"`)
  .replace('from "./permissions"', `from "${join(root, "worker/src/permissions.ts")}"`);
writeFileSync(join(dir, "enquiries.ts"), rewritten);
const out = join(dir, "enquiries.mjs");
execSync(`npx esbuild ${join(dir, "enquiries.ts")} --bundle --format=esm --platform=neutral --external:*/shared.js --external:*/staff.js --outfile=${out} --log-level=error`, { cwd: root, stdio: "inherit" });
const E = await import(pathToFileURL(out).href);
const { audits, bumps } = await import(pathToFileURL(join(dir, "shared.js")).href);
const { notified } = await import(pathToFileURL(join(dir, "staff.js")).href);

/* ---- 1. overdue ---- */
{
  const now = Date.parse("2026-09-05T10:00:00Z");
  const at = (hoursAgo) => new Date(now - hoursAgo * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
  ok("the threshold is one day", E.OVERDUE_HOURS === 24);
  ok("a new enquiry 25h old is overdue", E.isOverdue({ status: "new", created_at: at(25), replied_at: null }, now));
  ok("a new enquiry 23h old is not", !E.isOverdue({ status: "new", created_at: at(23), replied_at: null }, now));
  ok("an answered one is never overdue", !E.isOverdue({ status: "contacted", created_at: at(200), replied_at: null }, now));
  ok("a closed one is never overdue", !E.isOverdue({ status: "closed", created_at: at(200), replied_at: null }, now));
  ok("a replied one is never overdue, whatever its status says", !E.isOverdue({ status: "new", created_at: at(200), replied_at: at(100) }, now), "the customer has an answer");
  ok("hours waiting reads SQLite time as UTC", Math.round(E.hoursWaiting(at(6), now)) === 6);
  ok("an unreadable time waits zero, not NaN", E.hoursWaiting("garbage", now) === 0);
}

/* ---- 2. one enquiry, one person (fake database) ---- */
{
  const users = { 1: { id: 1, role: "ceo" }, 2: { id: 2, role: "sales_marketing" }, 9: { id: 9, role: "live_host" } };
  const state = { enq: { id: 5, name: "Aina", status: "new", assigned_to: null }, updates: [] };
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/FROM enquiries WHERE id = \?1/.test(sql)) return args[0] === 5 ? state.enq : null;
              if (/SELECT id, role FROM users WHERE id = \?1 AND is_active = 1/.test(sql)) return users[args[0]] ?? null;
              return null;
            },
            async run() { if (/UPDATE enquiries SET/.test(sql)) state.updates.push({ sql, args }); return {}; },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  const env = { DB: db };
  const me = { id: 1, role: "ceo", name: "Alif" };
  const patch = (body, user = me) => E.handleEnquiries(env, "/enquiries/5", "PATCH", body, user, new URLSearchParams());

  let r = await patch({ status: "dance" });
  ok("an unknown status alone is refused", r.status === 400);
  r = await patch({ assigned_to: 9 });
  ok("handing it to someone who cannot answer enquiries is refused", r.status === 400 && state.updates.length === 0, "a live host got a customer");
  notified.length = 0;
  r = await patch({ assigned_to: 2 });
  ok("handing it to a colleague writes and tells them once", r.status === 200 && /assigned_to = \?1/.test(state.updates.at(-1)?.sql ?? "") && state.updates.at(-1)?.args[0] === 2
     && notified.length === 1 && notified[0].userId === 2 && notified[0].ref === "enquiry:5", JSON.stringify(notified));
  notified.length = 0;
  r = await patch({ assigned_to: 1 });
  ok("taking it yourself tells nobody", r.status === 200 && notified.length === 0);
  ok("...and bumps the live topic each time", bumps.filter((t) => t === "enquiries").length >= 2);
  r = await patch({ reply: "  Hi Aina, yes we do.  " });
  const u = state.updates.at(-1);
  ok("a reply is trimmed, marks contacted unless told otherwise, and takes the enquiry for the replier if nobody has it",
     r.status === 200 && u.args[0] === "Hi Aina, yes we do." && u.args[1] === 1 && u.args[2] === null && /COALESCE\(assigned_to, \?2\)/.test(u.sql), u.sql);
  r = await patch({ reply: "Closing.", status: "closed" });
  ok("a reply with a status keeps that status", state.updates.at(-1).args[2] === "closed");
  ok("every change is audited", audits.filter((a) => a.action === "enquiry.update_status" && a.id === "5").length >= 4);
  r = await patch({ status: "closed" }, { id: 9, role: "live_host", name: "Nurul" });
  ok("a role without enquiry_manage is refused", r.status === 403);
  const missing = await E.handleEnquiries(env, "/enquiries/6", "PATCH", { status: "closed" }, me, new URLSearchParams());
  ok("an unknown enquiry is 404", missing.status === 404);
}

/* ---- 3. the announcer ---- */
{
  const roles = new Set(E_PERM_ROLES());
  function E_PERM_ROLES() {
    const m = perms.match(/enquiry_manage: \[([^\]]*)\]/);
    return [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  }
  const people = [{ id: 1, role: "ceo" }, { id: 2, role: "sales_marketing" }, { id: 3, role: "hr_admin" }, { id: 9, role: "live_host" }, { id: 10, role: "editor" }];
  let boundRoles = [];
  const db = { prepare(sql) { return { bind(...args) { boundRoles = args; return { async all() { return { results: people.filter((p) => args.includes(p.role)).map((p) => ({ id: p.id })) }; } }; } }; } };
  notified.length = 0; bumps.length = 0;
  await E.announceEnquiry({ DB: db }, 77, "Aina", "package_pricing", "account");
  ok("the announcer asks for exactly the enquiry_manage roles", boundRoles.length === roles.size && boundRoles.every((r) => roles.has(r)), boundRoles.join(","));
  ok("...tells each of them once", notified.map((n) => n.userId).sort().join(",") === "1,2,3", notified.map((n) => n.userId).join(","));
  ok("...as kind enquiry with the enquiry as ref", notified.every((n) => n.kind === "enquiry" && n.ref === "enquiry:77"));
  ok("...naming the customer and the category", notified[0]?.message.includes("Aina") && notified[0]?.message.includes("package & pricing"));
  ok("...and bumps the live topic", bumps.includes("enquiries"));
  ok("a live host or editor is not told", !notified.some((n) => n.userId === 9 || n.userId === 10));
}

/* ---- 4. the wiring ---- */
{
  const allTabs = [...(tabs.match(/const ALL_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  ok("Enquiries is a tab, one place after Sales", allTabs.indexOf("Enquiries") === allTabs.indexOf("Sales") + 1, allTabs.join(" · "));
  const enquiryRoles = [...(tabs.match(/export const ENQUIRY_ROLES[^=]*= \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const permRoles = [...(perms.match(/enquiry_manage: \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  ok("the tab's roles are the worker's enquiry_manage", JSON.stringify(enquiryRoles) === JSON.stringify(permRoles) && /Enquiries: ENQUIRY_ROLES/.test(tabs), `${enquiryRoles} vs ${permRoles}`);
  ok("the routes moved out of index.ts into the module", /handleEnquiries\(env, path\.slice/.test(index) && !/FROM enquiries ORDER BY created_at DESC LIMIT 100/.test(index));
  ok("the website form announces", /INSERT INTO enquiries \(name, company, phone, email, message\)\s*VALUES \(\?1, \?2, \?3, \?4, \?5\) RETURNING id[\s\S]{0,600}?announceEnquiry\(env, ins\?\.id \?\? null/.test(index), "a website enquiry used to be saved in silence");
  ok("the /account form announces through the same door", /announceEnquiry\(env, enqId, user\.name, category, "account"\)/.test(index) && !/INSERT INTO notifications \(user_id, kind, message, ref\) VALUES \(\?1, 'enquiry'/.test(index));
  ok("a push for an enquiry lands on the Enquiries tab", /enquiry: "Enquiries"/.test(staff));
  ok("the desk has an enquiries bucket, behind enquiry_manage", /if \(can\(user\.role, "enquiry_manage"\)\) \{\s*await guard\("enquiries"/.test(desk));
  ok("...a taken enquiry sits only on its taker's desk", /if \(e\.status === "new" && e\.assigned_to && e\.assigned_to !== user\.id\) continue;/.test(desk));
  ok("...using the module's overdue rule", /isEnquiryOverdue\(e\)/.test(desk) && /import \{ isOverdue as isEnquiryOverdue \} from "\.\/enquiries"/.test(desk));
  ok("the desk card knows the bucket and its topic", /enquiries: \["Enquiries", "Pertanyaan"\]/.test(deskCard) && /"users", "enquiries"\]\)/.test(deskCard) && /\| "enquiries";/.test(deskCard));
  ok("the panel is lazy and mounted on its tab", /EnquiriesPanel = lazy\(/.test(lazy) && /activeTab === "Enquiries" && <EnquiriesPanel userId=\{user\.id\} \/>/.test(page));
  ok("the old Sales card is gone", !/CustomerEnquiriesCard/.test(page));
  ok("a bell item for an enquiry opens the tab", /n\.kind === "enquiry" \? "Enquiries"/.test(page));
  ok("the panel is remembered and live", /useCachedApi<Data>\(`\/enquiries\$\{.*\}`, true, \["enquiries"\]\)/.test(panel));
  ok("the panel can take, hand over, reply, and set every status", /assigned_to: userId/.test(panel) && /Hand this enquiry to/.test(panel) && /reply: text/.test(panel)
     && ["contacted", "qualified", "closed", "new"].every((s) => panel.includes(`{ status: "${s}" }`)));
  ok("every mutation reports both ways", /Not sent — your text is still in the box/.test(panel) && /Not taken/.test(panel) && /Not changed/.test(panel));
  ok("the worklist chips lead with Waiting and include Overdue and Mine", /key: "new", en: "Waiting"/.test(panel) && /key: "overdue"/.test(panel) && /key: "mine"/.test(panel) && /useState<string>\("new"\)/.test(panel));
  const statuses = [...(panel.match(/const STATUS_LABEL[\s\S]*?\};/)?.[0] ?? "").matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
  ok("the panel's statuses are the worker's", JSON.stringify(statuses) === JSON.stringify([...E.STATUSES]), statuses.join(","));
  ok("the Sales hint no longer promises enquiries", !/Sales: \{ en: "enquiries/.test(tabs));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — an enquiry is work: overdue after a day, one person's, announced once to those who can answer (${passed} checks)`);

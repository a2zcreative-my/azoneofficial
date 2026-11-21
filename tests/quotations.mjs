/* v1.400.0 - SALES COMMAND CENTER, PHASE 4: QUOTATIONS & INVOICES (the CEO, 21-11-2026, "As recommended" on
 * the seven Phase 4 decisions). Migration 0228. Runtime guard on the tasks-gate4 harness: the WHOLE worker
 * bundled against SQLite with every migration, by direct request, then the same run against broken copies.
 *
 *   - a quotation made for a deal (POST /docs with deal_id) is linked by the server when it is saved, origin
 *     'created'; a deal in New or Qualified moves to Proposal sent with a history row; never to Won
 *   - a deal the person may not change, a closed deal or another customer's deal is NOT linked - the quotation
 *     is saved anyway and the answer says why; an invoice never links
 *   - GET /docs/more pages the whole table older than a document (25 + a "more" flag) and searches it, in the
 *     /docs row shape; it writes nothing
 *   - GET /docs says, for each open quotation, whether a follow-up is booked and whether the CURRENT revision
 *     is accepted; lib/quote-state.ts reads Open / Accepted / Expiring / Expired from that and valid_until
 *   - My Sales Action Center: a deal whose linked quotation is accepted and not invoiced is ONE row,
 *     "ready", in place of the quotation's own row
 *   - nothing here writes a payment, the cash book, the journal or commission
 *
 *   node tests/quotations.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "quotations-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const applyAll = (db, migDir) => {
  for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
    let buf = "";
    for (const st of readFileSync(join(migDir, f), "utf8").split(/;\s*\n/)) {
      buf = buf ? `${buf};\n${st}` : st;
      if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
      try { db.exec(buf); } catch { /* an older statement the later ones replace */ }
      buf = "";
    }
  }
};

async function runtime(workerBundle, migDir) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  const RealDate = globalThis.Date;
  const fixed = Date.parse("2026-11-10T04:00:00Z"); // Tuesday 10-11-2026, 12:00 in Malaysia
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  applyAll(db, migDir);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); const res = []; try { for (const s of list) res.push({ meta: { changes: Number(s._run().changes) } }); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return res; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const U = { ceo: 1, sa: 2, coo: 3, admin: 4, aina: 5, hr: 6, host: 7, cco: 8, bakar: 9, mkt: 10, agent: 11 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Adm','Admin Clerk','admin@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01'),
    (7,'Farid','Farid Host','farid@a2z.test','live_host',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',250000,'2024-01-01'),
    (8,'Chen','Chen CCO','chen@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',700000,'2024-01-01'),
    (9,'Bakar','Bakar Seller','bakar@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (10,'Mira','Mira Marketing','mira@a2z.test','marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (11,'Ros','Ros Agent','ros@agent.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  db.exec(`INSERT INTO sales_packages (id, name, status) VALUES (1, 'Live Selling Starter', 'active')`);
  for (let c = 1; c <= 9; c++) db.exec(`INSERT INTO customers (id, company, phone, created_by, created_at) VALUES (${c}, 'Client ${c} Sdn Bhd', '01220000${c}', 5, '2026-10-01 01:00:00')`);
  /* 60 old documents for customer 9, so the table runs well past one page */
  const old = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind, issuer_code, valid_until) VALUES (?, ?, ?, 9, '[]', 0, 0, ?, ?, ?, 5, 5, 'service', 'a2z', ?)`);
  for (let k = 1; k <= 60; k++) old.run(1000 + k, k % 3 ? "QT" : "INV", `${k % 3 ? "QT" : "INV"}-OLD-${String(k).padStart(3, "0")}`, 10000 + k, k % 3 ? null : "paid", `2025-0${1 + (k % 9)}-${String(1 + (k % 27)).padStart(2, "0")} 01:00:00`, k % 3 ? "2025-12-31" : null);
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, created_at, created_by, salesperson_id, kind, issuer_code, revision, valid_until)
    VALUES (700, 'QT', 'QT-Q-700', 3, '[]', 0, 0, 300000, '2026-11-01 01:00:00', 5, 5, 'service', 'a2z', 1, '2026-11-14'),
           (701, 'QT', 'QT-Q-701', 4, '[]', 0, 0, 400000, '2026-10-01 01:00:00', 5, 5, 'service', 'a2z', 0, '2026-12-31')`);
  db.exec(`INSERT INTO quotation_acceptances (doc_id, revision, accepted_name) VALUES (700, 0, 'Old revision'), (701, 0, 'Current')`);
  db.exec(`INSERT INTO customer_followups (id, customer_id, due_on, owner_id, note, created_by, doc_id) VALUES (1, 3, '2026-11-20', 5, 'Ask about rev 1', 5, 700)`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const money = () => sha(["invoice_payment_reports", "cash_book", "commission_ledger", "invoice_paid_confirmations", "journal_entries", "quotation_acceptances"].map((t) => { try { return JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all()); } catch { return "-"; } }).join("|"));
  const cnt = (sql) => db.prepare(sql).get().n;
  const deal = (id) => db.prepare(`SELECT * FROM sales_opportunities WHERE id = ?`).get(id);
  const qt = (cust, extra = {}) => ({ doc_type: "QT", customer_id: cust, kind: "service", items: [{ name: "Live session", qty: 1, unit_price_cents: 150000 }], discount_cents: 0, tax_percent: 0, issuer: "a2z", ...extra });
  try {
    const before = money();
    ok(db.prepare(`PRAGMA table_info(opportunity_quotations)`).all().some((c) => c.name === "origin"), "0228 records how a quotation joined its deal");

    /* the deals */
    const mkDeal = async (uid, b) => (await call("/deals", uid, "POST", { client_key: `k${Math.random().toString(36).slice(2, 12)}`, ...b })).j?.id;
    const D1 = await mkDeal(U.aina, { customer_id: 1, title: "Raya live" });          // New, Aina's
    const D2 = await mkDeal(U.aina, { customer_id: 2, title: "Already proposed" });
    db.exec(`UPDATE sales_opportunities SET stage = 'negotiation' WHERE id = ${D2}`);
    const D3 = await mkDeal(U.coo, { customer_id: 1, title: "Bakar's deal", owner_id: U.bakar });
    const D4 = await mkDeal(U.aina, { customer_id: 1, title: "Lost one" });
    db.exec(`UPDATE sales_opportunities SET stage = 'lost', lost_reason = 'price', closed_at = datetime('now') WHERE id = ${D4}`);
    ok(D1 && D2 && D3 && D4, "four deals to work with");

    /* decision 3/4: made for a deal */
    const v1 = deal(D1).version;
    const r1 = await call("/docs", U.aina, "POST", qt(1, { deal_id: D1 }));
    const l1 = db.prepare(`SELECT * FROM opportunity_quotations WHERE doc_id = ?`).get(r1.j?.id);
    ok(r1.status === 201 && r1.j.deal_link?.ok === true && r1.j.deal_link.moved === true && l1?.opportunity_id === D1 && l1.origin === "created", "a quotation made for a deal is linked when it is saved (origin created)", r1.text.slice(0, 200));
    ok(deal(D1).stage === "proposal" && deal(D1).version === v1 + 1 && cnt(`SELECT COUNT(*) AS n FROM opportunity_stage_events WHERE opportunity_id = ${D1} AND from_stage = 'new' AND to_stage = 'proposal'`) === 1, "a deal in New moves to Proposal sent, once, with its history row");
    const r2 = await call("/docs", U.aina, "POST", qt(2, { deal_id: D2 }));
    ok(r2.j?.deal_link?.ok === true && r2.j.deal_link.moved === false && deal(D2).stage === "negotiation", "a deal already past Qualified keeps its stage - and nothing ever moves it to Won");
    const r3 = await call("/docs", U.aina, "POST", qt(1, { deal_id: D3 }));
    ok(r3.status === 201 && r3.j?.deal_link?.ok === false && r3.j.deal_link.reason === "forbidden" && cnt(`SELECT COUNT(*) AS n FROM opportunity_quotations WHERE doc_id = ${r3.j.id}`) === 0, "someone else's deal is not linked - the quotation is saved anyway and says why", r3.text.slice(0, 200));
    const r4 = await call("/docs", U.aina, "POST", qt(1, { deal_id: D4 }));
    ok(r4.status === 201 && r4.j?.deal_link?.reason === "closed", "a closed deal is not linked");
    const r5 = await call("/docs", U.aina, "POST", qt(5, { deal_id: D1 }));
    ok(r5.status === 201 && r5.j?.deal_link?.reason === "other_customer" && cnt(`SELECT COUNT(*) AS n FROM opportunity_quotations WHERE doc_id = ${r5.j.id}`) === 0, "another customer's deal is not linked");
    const r6 = await call("/docs", U.coo, "POST", qt(1, { deal_id: D3 }));
    ok(r6.j?.deal_link?.ok === true && deal(D3).stage === "proposal", "a manager links to anyone's deal");
    const r7 = await call("/docs", U.aina, "POST", qt(6));
    ok(r7.status === 201 && r7.j?.deal_link === undefined, "a quotation with no deal is unchanged - no link, no answer about one");
    const r8 = await call("/docs", U.coo, "POST", { ...qt(1, { deal_id: D1 }), doc_type: "INV", salesperson_id: U.aina });
    ok(r8.status === 201 && r8.j?.deal_link === undefined && cnt(`SELECT COUNT(*) AS n FROM opportunity_quotations WHERE doc_id = ${r8.j.id}`) === 0, "an invoice never links to a deal", r8.text.slice(0, 160));

    /* decision 2: the whole table */
    const p1 = await call("/docs/more?before_id=" + r7.j.id, U.aina);
    ok(p1.status === 200 && p1.j.docs.length === 25 && p1.j.more === true, "older than a document: 25 rows and a 'more' flag", p1.text.slice(0, 120));
    let seen = new Set(p1.j.docs.map((d) => d.id)), last = p1.j.docs.at(-1).id, pages = 1, more = p1.j.more;
    while (more && pages < 10) { const pn = await call(`/docs/more?before_id=${last}`, U.aina); for (const d of pn.j.docs) seen.add(d.id); last = pn.j.docs.at(-1)?.id; more = pn.j.more; pages++; }
    const total = cnt(`SELECT COUNT(*) AS n FROM sales_documents WHERE (created_at, id) < (SELECT created_at, id FROM sales_documents WHERE id = ${r7.j.id})`);
    ok(seen.size === total && !more, "paging reaches every older document, none twice", `${seen.size} of ${total}`);
    const sq = await call("/docs/more?q=old-007", U.aina);
    ok(sq.j?.docs?.length === 1 && sq.j.docs[0].doc_number === "QT-OLD-007", "a search finds an old document by number");
    const sc = await call("/docs/more?q=client 9&type=INV", U.aina);
    ok(sc.j.docs.length > 0 && sc.j.docs.every((d) => d.doc_type === "INV" && d.company === "Client 9 Sdn Bhd"), "…by customer, and by type");
    ok((await call("/docs/more", U.host)).status === 403, "a live host is refused, as on /docs");

    /* decision 5: the state of an open quotation */
    const list = (await call("/docs?type=QT", U.aina)).j?.docs ?? [];
    const q700 = list.find((d) => d.id === 700), q701 = list.find((d) => d.id === 701);
    ok(q700?.followup_open === 1 && q700.accepted_current === 0, "a booked follow-up is shown; an acceptance of an OLDER revision is not the current one", JSON.stringify(q700 && { f: q700.followup_open, a: q700.accepted_current }));
    ok(q701?.followup_open === 0 && q701.accepted_current === 1, "the current revision's acceptance is shown");

    /* decision 4: the Action Center */
    const D5 = await mkDeal(U.aina, { customer_id: 4, title: "Accepted deal", next_action: "Wait", next_action_on: "2026-11-30" });
    await call(`/deals/${D5}/link`, U.aina, "POST", { doc_id: 701, version: 1 });
    const td = await call("/sales/today", U.aina);
    const items = td.j?.items ?? [];
    ok(items.some((i) => i.key === `deal:${D5}` && i.kind === "opportunity" && i.flag === "ready" && /Accepted/.test(i.note ?? "")) && !items.some((i) => i.kind === "quotation" && i.doc_id === 701),
      "an accepted, uninvoiced quotation on a deal is ONE row: the deal, ready to mark won or invoice", JSON.stringify(items.map((i) => `${i.key}/${i.flag}`)));
    ok(deal(D5).stage !== "won", "…and the deal is not marked won by it");

    ok(money() === before, "no payment report, cash row, journal, commission row or acceptance was touched");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 500)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res, tag = "") => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${tag}${m}`); } } };
const s = (c, m) => report([[c, m]]);

/* ---- lib/quote-state.ts, run as it is ---- */
{
  const dir0 = mkdtempSync(join(tmpdir(), "qstate-"));
  execSync(`npx esbuild "${join(root, "lib/quote-state.ts")}" --format=esm --platform=neutral --outfile="${join(dir0, "q.mjs")}" --log-level=error`, { cwd: root });
  const { quoteState, matchesQuoteFilter } = await import(pathToFileURL(join(dir0, "q.mjs")).href);
  const T = "2026-11-10";
  const st = (o) => quoteState({ doc_type: "QT", created_at: "2026-11-01 02:00:00", ...o }, T);
  s(st({ valid_until: "2026-11-09" }).expired && matchesQuoteFilter(st({ valid_until: "2026-11-09" }), "expired"), "a quotation past its validity is Expired");
  s(st({ valid_until: "2026-11-10" }).expiring && st({ valid_until: "2026-11-10" }).days_left === 0 && st({ valid_until: "2026-11-17" }).expiring && !st({ valid_until: "2026-11-18" }).expiring, "Expiring is today to 7 days ahead");
  s(st({}).age_days === 9 && st({ created_at: "2026-11-09 17:00:00" }).age_days === 0, "its age is counted in Malaysia days");
  s(matchesQuoteFilter(st({}), "needs_followup") && !matchesQuoteFilter(st({ followup_open: 1 }), "needs_followup") && !matchesQuoteFilter(st({ accepted_current: 1 }), "needs_followup"), "Needs follow-up: no follow-up booked, not accepted");
  s(matchesQuoteFilter(st({ accepted_current: 1, valid_until: "2026-11-01" }), "accepted") && !matchesQuoteFilter(st({ accepted_current: 1, valid_until: "2026-11-01" }), "expired"), "an accepted quotation is never listed as expired - it needs its invoice");
  s(quoteState({ doc_type: "QT", created_at: "2026-11-01", invoiced_as: "INV-1" }, T) === null && quoteState({ doc_type: "INV", created_at: "2026-11-01" }, T) === null, "an invoiced quotation or an invoice has no quotation state");
  rmSync(dir0, { recursive: true, force: true });
}

/* ---- source rules ---- */
const deals = read("worker/src/deals.ts"), staff = read("worker/src/staff.ts"), mig = read("worker/migrations/0228_quotation_deal_link.sql"), pick = read("components/portal/doc-pickers.tsx"), sales = read("components/portal/sales.tsx");
const link = deals.slice(deals.indexOf("export async function linkCreatedQuotation"));
s(!/stage = 'won'|INSERT INTO (sales_documents|quotation_acceptances|cash_book|journal_entries|commission_ledger)/.test(link), "linking a made-for quotation never marks a deal won and writes no money");
const more = staff.slice(staff.indexOf('if (path === "/docs/more" && method === "GET")'), staff.indexOf('if (path === "/docs" && method === "GET")'));
s(more.length > 100 && !/\b(INSERT|UPDATE|DELETE)\b/.test(more), "GET /docs/more is a pure read");
s(!/^\s*(UPDATE|DELETE|DROP|ALTER TABLE \w+ (RENAME|DROP))/im.test(mig.replace(/--.*$/gm, "")), "0228 is additive");
s(!/<select[^>]*aria-label=\{L\("Customer", "Pelanggan"\)\}/.test(sales) && /<CustomerPicker value=\{doc\.customer_id\}/.test(sales) && /\/staff\/crm\/leads\?view=all&sort=name&q=/.test(pick), "the Create form picks a customer by searching every customer, not a list cut at 300");
s(/doc\.doc_type === "QT" && !editingDoc && dealId \? \{ deal_id: dealId \}/.test(sales), "only a NEW quotation sends its deal; an edit or a revision never does");
/* v1.410.0 - every invoice a quotation became is a link to that invoice: the ids come with the list, same order, same filter */
{
  const staffSrc = read("worker/src/staff.ts");
  const lists = staffSrc.match(/AS invoiced_list,/g)?.length ?? 0;
  const ids = staffSrc.match(/\(SELECT GROUP_CONCAT\(x\.id, ','\) FROM \(SELECT i\.id FROM sales_documents i WHERE i\.converted_from = d\.id AND i\.doc_type = 'INV' AND COALESCE\(i\.payment_status, ''\) != 'void' ORDER BY i\.id\) x\) AS invoiced_ids,/g)?.length ?? 0;
  s(lists > 0 && ids === lists, "every /docs read that lists a quotation's invoices also sends their ids, in the same order and without void ones", `${ids}/${lists}`);
  s(/data-testid="qt-invoiced-list">\{invLinks\(d\)\}/.test(sales) && /data-testid="qt-partly-list">[^\n]*\{invLinks\(d\)\}/.test(sales) && /onClick=\{\(e\) => \{ e\.stopPropagation\(\); openDocRow\(\{ \.\.\.d, id, doc_number: n \}\); \}\}/.test(sales), "an invoiced or partly invoiced quotation draws each invoice number as a link that opens that invoice");
}

const dir = mkdtempSync(join(tmpdir(), "quotations-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;

const MUTANTS = [
  ["a made-for quotation is not linked", "worker/src/staff.ts", `const dealLink = docType === "QT" && body.deal_id != null ?`, `const dealLink = false && body.deal_id != null ?`],
  ["anyone's deal takes the quotation", "worker/src/deals.ts", `if (!canUser(user, "sales") || !(canUser(user, "crm_assign") || deal.owner_id === user.id || deal.owner_id === null)) return { ok: false, reason: "forbidden" };`, ""],
  ["another customer's deal takes it", "worker/src/deals.ts", `if (!doc || doc.customer_id !== deal.customer_id) return { ok: false, reason: "other_customer" };`, `if (!doc) return { ok: false, reason: "other_customer" };`],
  ["a closed deal takes it", "worker/src/deals.ts", `if (!(OPEN_STAGES as readonly string[]).includes(deal.stage)) return { ok: false, reason: "closed" };\n    if (!canUser`, `if (false) return { ok: false, reason: "closed" };\n    if (!canUser`],
  ["the deal does not move to Proposal sent", "worker/src/deals.ts", `const move = deal.stage === "new" || deal.stage === "qualified";`, `const move = false;`],
  ["every deal moves to Proposal sent", "worker/src/deals.ts", `const move = deal.stage === "new" || deal.stage === "qualified";`, `const move = true;`],
  ["paging repeats a page", "worker/src/staff.ts", "where.push(`(d.created_at, d.id) < (SELECT b.created_at, b.id FROM sales_documents b WHERE b.id = ?${bind.length})`);", "where.push(`?${bind.length} > 0`);"],
  ["any revision's acceptance counts", "worker/src/staff.ts", "EXISTS (SELECT 1 FROM quotation_acceptances a WHERE a.doc_id = d.id AND a.revision = COALESCE(d.revision, 0)) END) AS accepted_current", "EXISTS (SELECT 1 FROM quotation_acceptances a WHERE a.doc_id = d.id) END) AS accepted_current"],
  ["the accepted quotation is listed twice", "worker/src/sales-today.ts", `        for (let k = items.length - 1; k >= 0; k--) if (items[k]!.kind === "quotation" && docs.includes(items[k]!.doc_id ?? -1)) items.splice(k, 1);\n        items.push`, "        items.push"],
  ["the 'more' flag lies", "worker/src/staff.ts", "return json({ docs: rows, more: results.length > 25 });", "return json({ docs: rows, more: false });"],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const m = mkdtempSync(join(tmpdir(), "quotations-m-"));
  cpSync(join(root, "worker"), join(m, "worker"), { recursive: true });
  cpSync(join(root, "lib"), join(m, "lib"), { recursive: true });
  cpSync(join(root, "package.json"), join(m, "package.json"));
  const body = readFileSync(join(m, file), "utf8").replace(/\r\n/g, "\n"); // a Windows checkout has CRLF; the mutations are written with \n
  if (!body.includes(from)) { report([[false, `mutation "${name}" no longer applies - update the guard`]]); continue; }
  writeFileSync(join(m, file), body.replace(from, to));
  const mb = join(m, "w.mjs");
  const entry = join(m, "e.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${mb}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const res = await runtime(mb, join(m, "worker/migrations"));
  if (res.some(([p]) => !p)) caught++; else report([[false, `mutation "${name}" was NOT caught`]]);
  rmSync(m, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`quotations: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - quotations & invoices: a quotation made for a deal is linked on save (New/Qualified -> Proposal sent, never Won; refused deals reported, the quotation saved), the whole document table paged and searched 25 at a time, each open quotation's follow-up and current-revision acceptance shown, one Action Center row for an accepted deal; nothing touches money (${checks} checks, ${caught}/${MUTANTS.length} mutations caught)`);

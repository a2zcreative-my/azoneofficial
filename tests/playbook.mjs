/* v1.404.0 - SALES COMMAND CENTER, PHASE 7: THE SALES PLAYBOOK (the CEO, 21-11-2026, "As recommended" on the nine
 * Phase 7 decisions). Migration 0230, worker/src/playbook.ts, lib/playbook.ts. Runtime guard on the tasks-gate4
 * harness: the WHOLE worker bundled against SQLite with every migration, by direct request, then broken copies.
 *
 *   - readers (anyone with Sales; never an agent) get ONLY the published version - never a draft, a lock or an
 *     archived entry; only playbook_manage (CEO, COO, CCO - not the super admin) writes
 *   - publishing needs a note, makes the next version, tells the OTHER managers; every version is kept (the
 *     database refuses to change or delete one) and an old one comes back through the draft
 *   - no price is typed in: a ringgit amount is refused; linked packages must exist, and be active to publish
 *   - every write carries the entry's version (409 when someone saved first); a file is served to staff only
 *     when its published version lists it
 *   - nothing here touches a customer, a deal, a document, money, commission or the Packages library
 *
 *   node tests/playbook.mjs
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
  const entry = join(srcRoot, "playbook-entry.ts");
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
  const fixed = Date.parse("2026-11-10T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  applyAll(db, migDir);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const store = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); const res = []; try { for (const s of list) res.push({ meta: { changes: Number(s._run().changes) } }); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return res; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: {
      put: async (k, v) => { store.set(k, new Uint8Array(v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer())); },
      get: async (k) => (store.has(k) ? { body: store.get(k) } : null),
      head: async (k) => (store.has(k) ? { size: store.get(k).length } : null),
      list: async () => ({ objects: [] }), delete: async (k) => { store.delete(k); },
    },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const U = { ceo: 1, sa: 2, coo: 3, admin: 4, aina: 5, hr: 6, host: 7, cco: 8, agent: 11 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Adm','Admin Clerk','admin@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01'),
    (7,'Farid','Farid Host','farid@a2z.test','live_host',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',250000,'2024-01-01'),
    (8,'Chen','Chen CCO','chen@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',700000,'2024-01-01'),
    (11,'Ros','Ros Agent','ros@agent.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  db.exec(`INSERT INTO sales_packages (id, name, status) VALUES (1, 'Live Selling Starter', 'active'), (2, 'Brand Film', 'draft')`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid, ct = "application/json") => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": ct });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const upload = async (p, uid, bytes, ct, name) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method: "POST", headers: { ...hdr(uid, ct), "x-file-name": name }, body: bytes }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const snap = () => sha(["customers", "sales_documents", "sales_opportunities", "invoice_payments", "invoice_paid_confirmations", "cash_book", "journal_entries", "commission_ledger", "sales_packages", "sales_package_versions"].map((t) => { try { return JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all()); } catch { return "-"; } }).join("|"));
  const objection = (title, answer, items = ["Show the value", "Offer a smaller package"], extra = {}) => ({ title, lang: "ms", answer, items, stage: "negotiation", package_ids: [], ...extra });
  try {
    const before = snap();
    ok((await call("/playbook", U.agent)).status === 403, "an agent is refused");
    const r0 = await call("/playbook", U.aina);
    ok(r0.status === 200 && r0.j.entries.length === 0 && r0.j.can_manage === false, "a consultant reads the Playbook and may not manage it", r0.text.slice(0, 120));

    for (const [who, uid] of [["consultant", U.aina], ["super admin", U.sa], ["admin", U.admin]]) {
      ok((await call("/playbook", uid, "POST", { section: "objections", kind: "objection", payload: objection("Mahal.", "Saya faham, mari lihat nilai pakej ini.") })).status === 403, `a ${who} cannot write the Playbook`);
    }
    ok((await call("/playbook", U.ceo)).j?.can_manage === true && (await call("/playbook", U.cco)).j?.can_manage === true && (await call("/playbook", U.sa)).j?.can_manage === false, "playbook_manage is the CEO, COO and CCO - not the super admin");

    /* decision 3: no price is typed in */
    for (const money of ["RM 1,500", "RM1500", "rm 99.90", "MYR 200", "1,500 ringgit"]) {
      const r = await call("/playbook", U.ceo, "POST", { section: "objections", kind: "objection", payload: objection("Mahal.", `Pakej asas hanya ${money} sebulan, sangat berbaloi.`) });
      ok(r.status === 400 && /price/i.test(r.text), `a price ("${money}") is refused`, `${r.status} ${r.text.slice(0, 100)}`);
    }
    ok((await call("/playbook", U.ceo, "POST", { section: "objections", kind: "objection", payload: objection("Mahal.", "Fokus pada ROI dan hasil kempen sebelum ini.", [], { package_ids: [99] }) })).status === 400, "a package that does not exist is refused");
    ok((await call("/playbook", U.ceo, "POST", { section: "nowhere", kind: "objection", payload: objection("Mahal.", "Fokus pada nilai dan hasil kepada pelanggan.") })).status === 400, "a section outside the ten is refused");
    ok((await call("/playbook", U.ceo, "POST", { section: "discovery", kind: "questions", payload: { title: "Soalan", lang: "ms", items: [], package_ids: [] } })).status === 400, "a question list needs a line");

    const c1 = await call("/playbook", U.ceo, "POST", { section: "objections", kind: "objection", payload: objection("Mahal.", "Saya faham tentang bajet. Pakej kami fokus pada hasil yang boleh diukur.", undefined, { package_ids: [1] }) });
    const id = c1.j?.entry?.id;
    ok(c1.status === 201 && c1.j.entry.status === "draft" && c1.j.entry.published === null && c1.j.entry.draft?.package_ids?.[0] === 1, "a manager writes a draft with a linked package", c1.text.slice(0, 160));
    ok((await call("/playbook", U.aina)).j?.entries?.length === 0, "staff never see a draft");

    let lock = c1.j.entry.lock;
    ok((await call(`/playbook/${id}/publish`, U.ceo, "POST", { note: "", version: lock })).status === 400, "publishing needs a note");
    const p1 = await call(`/playbook/${id}/publish`, U.ceo, "POST", { note: "First answer for price", version: lock });
    ok(p1.status === 200 && p1.j.version === 1 && p1.j.entry.status === "published" && p1.j.entry.has_draft === false, "publishing makes version 1", p1.text.slice(0, 160));
    const told = db.prepare(`SELECT user_id FROM notifications WHERE ref = ?`).all(`playbook:${id}:v1`).map((r) => r.user_id).sort();
    ok(JSON.stringify(told) === JSON.stringify([U.coo, U.cco]), "the other managers are told - never the publisher, never the super admin", JSON.stringify(told));
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'playbook.publish'`).get().n === 1, "the publish is audited");

    const r1 = await call("/playbook", U.aina);
    const e1 = r1.j?.entries?.[0];
    ok(e1?.published?.version === 1 && /hasil yang boleh diukur/.test(e1.published.payload.answer) && e1.draft === undefined && e1.lock === undefined && e1.status === undefined, "staff read the published version, and nothing of the draft", r1.text.slice(0, 200));
    ok((await call(`/playbook/${id}/versions`, U.aina)).status === 403, "staff do not read the version history");

    lock = p1.j.entry.lock;
    ok((await call(`/playbook/${id}`, U.coo, "PUT", { payload: objection("Mahal.", "Jawapan baharu yang lebih jelas tentang nilai."), version: lock - 1 })).status === 409, "a save on an old version is refused (someone saved first)");
    const ed = await call(`/playbook/${id}`, U.coo, "PUT", { payload: objection("Mahal.", "Jawapan baharu yang lebih jelas tentang nilai."), version: lock });
    ok(ed.status === 200 && ed.j.entry.has_draft === true, "the COO edits the draft", ed.text.slice(0, 120));
    ok(/hasil yang boleh diukur/.test((await call("/playbook", U.aina)).j.entries[0].published.payload.answer), "staff keep reading version 1 while the draft changes");
    lock = ed.j.entry.lock;
    const p2 = await call(`/playbook/${id}/publish`, U.coo, "POST", { note: "Clearer answer", version: lock });
    ok(p2.status === 200 && p2.j.version === 2 && /lebih jelas/.test((await call("/playbook", U.aina)).j.entries[0].published.payload.answer), "version 2 is what staff read once it is published");
    ok((await call(`/playbook/${id}/publish`, U.coo, "POST", { note: "Nothing new here", version: p2.j.entry.lock })).status === 409, "nothing to publish when there is no change");

    const vs = await call(`/playbook/${id}/versions`, U.ceo);
    ok(JSON.stringify((vs.j?.versions ?? []).map((v) => v.version)) === "[2,1]" && vs.j.versions[1].note === "First answer for price", "every version is kept with its note", vs.text.slice(0, 160));
    let threw = false; try { db.exec(`UPDATE playbook_versions SET note = 'changed' WHERE entry_id = ${id}`); } catch { threw = true; }
    let threw2 = false; try { db.exec(`DELETE FROM playbook_versions WHERE entry_id = ${id}`); } catch { threw2 = true; }
    let threw3 = false; try { db.exec(`DELETE FROM playbook_entries WHERE id = ${id}`); } catch { threw3 = true; }
    ok(threw && threw2 && threw3, "the database refuses to change or delete a version, or delete an entry");

    const rs = await call(`/playbook/${id}/restore`, U.cco, "POST", { from: 1, version: p2.j.entry.lock });
    ok(rs.status === 200 && /hasil yang boleh diukur/.test(rs.j.entry.draft.answer) && rs.j.entry.published.version === 2, "an earlier version comes back into the draft - staff still read version 2", rs.text.slice(0, 160));
    const p3 = await call(`/playbook/${id}/publish`, U.cco, "POST", { note: "Back to the first answer", restored_from: 1, version: rs.j.entry.lock });
    ok(p3.j?.version === 3 && db.prepare(`SELECT restored_from FROM playbook_versions WHERE entry_id = ? AND version = 3`).get(id).restored_from === 1, "and is published again as version 3, marked as brought back");

    /* a draft package may be linked; publishing needs it active */
    const ed2 = await call(`/playbook/${id}`, U.ceo, "PUT", { payload: objection("Mahal.", "Cadangkan pakej yang lebih kecil dahulu.", [], { package_ids: [2] }), version: p3.j.entry.lock });
    ok(ed2.status === 200, "a draft may link a package that is not active yet", ed2.text.slice(0, 120));
    const p4 = await call(`/playbook/${id}/publish`, U.ceo, "POST", { note: "Smaller package", version: ed2.j.entry.lock });
    ok(p4.status === 400 && /not active/.test(p4.text), "publishing refuses a package that is not active", p4.text.slice(0, 120));
    const dc = await call(`/playbook/${id}/discard`, U.ceo, "POST", { version: ed2.j.entry.lock });
    ok(dc.status === 200 && dc.j.entry.has_draft === false && /hasil yang boleh diukur/.test(dc.j.entry.draft.answer), "discarding the draft goes back to the published words", dc.text.slice(0, 120));

    /* files: the published version's for staff, any for a manager */
    const sop = await call("/playbook", U.ceo, "POST", { section: "sop", kind: "guide", payload: { title: "SOP sebut harga", lang: "ms", body: "Langkah menyediakan sebut harga untuk pelanggan baharu.", package_ids: [] } });
    const sid = sop.j.entry.id;
    const pdf = new TextEncoder().encode("%PDF-1.4\n% a2z test\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
    ok((await upload(`/playbook/${sid}/files?version=${sop.j.entry.lock}`, U.ceo, new TextEncoder().encode("<html></html>"), "text/html", "x.html")).status === 400, "a web page cannot be attached");
    ok((await upload(`/playbook/${sid}/files?version=${sop.j.entry.lock}`, U.aina, pdf, "application/pdf", "sop.pdf")).status === 403, "staff cannot attach a file");
    const up = await upload(`/playbook/${sid}/files?version=${sop.j.entry.lock}`, U.ceo, pdf, "application/pdf", "sop.pdf");
    const fid = up.j?.file_id;
    ok(up.status === 201 && up.j.entry.draft_files.length === 1 && [...store.keys()].some((k) => k.startsWith(`private/playbook/${sid}/`)), "a manager attaches a PDF; it is stored privately", up.text.slice(0, 160));
    ok((await call(`/playbook/files/${fid}`, U.aina)).status === 404, "staff cannot open a file of an unpublished draft");
    ok((await call(`/playbook/files/${fid}`, U.ceo)).status === 200, "a manager can");
    const ps = await call(`/playbook/${sid}/publish`, U.ceo, "POST", { note: "SOP with its form", version: up.j.entry.lock });
    const fr = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff/playbook/files/${fid}`, { headers: hdr(U.aina) }), env, { waitUntil() {} });
    ok(ps.status === 200 && fr.status === 200 && /attachment/.test(fr.headers.get("content-disposition") ?? "") && fr.headers.get("x-content-type-options") === "nosniff", "once published, staff open it (as a download, nosniff)");
    ok((await call(`/playbook/${sid}`, U.ceo, "PUT", { payload: { title: "SOP sebut harga", lang: "ms", body: "Langkah menyediakan sebut harga untuk pelanggan baharu.", package_ids: [] }, files: [fid, 999], version: ps.j.entry.lock })).status === 400, "a save cannot slip in a file that was never attached");

    /* archive: hidden from staff, kept */
    ok((await call(`/playbook/${sid}/archive`, U.ceo, "POST", { reason: "x", version: ps.j.entry.lock })).status === 400, "archiving needs a reason");
    const ar = await call(`/playbook/${sid}/archive`, U.ceo, "POST", { reason: "Replaced by the new SOP", version: ps.j.entry.lock });
    ok(ar.status === 200 && !(await call("/playbook", U.aina)).j.entries.some((e) => e.id === sid), "an archived entry is hidden from staff", ar.text.slice(0, 100));
    ok((await call(`/playbook/files/${fid}`, U.aina)).status === 404, "and so are its files");
    ok((await call(`/playbook/${sid}`, U.ceo, "PUT", { payload: { title: "SOP", lang: "ms", body: "Teks yang cukup panjang untuk disimpan.", package_ids: [] }, version: ar.j.entry.lock })).status === 409, "an archived entry is not edited");
    const un = await call(`/playbook/${sid}/unarchive`, U.ceo, "POST", { version: ar.j.entry.lock });
    ok(un.status === 200 && un.j.entry.status === "published" && (await call("/playbook", U.aina)).j.entries.some((e) => e.id === sid), "brought back as it was");

    ok(snap() === before, "nothing outside the Playbook changes: no customer, deal, document, payment, cash, journal, commission or package");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 500)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res, tag = "") => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${tag}${m}`); } } };
const s = (c, m) => report([[c, m]]);
const lib = read("lib/playbook.ts"), pb = read("worker/src/playbook.ts"), ui = read("components/portal/sales-playbook.tsx"), mig = read("worker/migrations/0230_sales_playbook.sql");
const perm = read("worker/src/permissions.ts"), staff = read("worker/src/staff.ts"), idx = read("worker/src/index.ts"), shell = read("components/portal/sales-shell.tsx"), sales = read("components/portal/sales.tsx"), pipe = read("components/portal/sales-pipeline.tsx");
s(!/^\s*(UPDATE|DELETE|DROP|ALTER TABLE \w+ (RENAME|DROP))\b/m.test(mig.replace(/--.*$/gm, "").replace(/BEGIN[\s\S]*?END;/g, "")), "0230 is additive");
s(!/price|_cents/i.test(mig.replace(/--.*$/gm, "")), "0230 has no price column (decision 3)");
s(/playbook_manage: \["ceo", "coo", "cco"\],/.test(perm) && /key: "playbook_manage"/.test(perm), "playbook_manage is the CEO, COO and CCO, and it is in the action catalogue");
s(/!\/\^\\\/playbook\\\/\\d\+\\\/files\$\/\.test\(path\)/.test(staff), "staff.ts leaves a Playbook file's raw body unread");
s(/key\.startsWith\("private\/playbook\/"\)/.test(idx), "/media/file refuses a Playbook file - it opens only through the Playbook");
s(!/\b(sales_documents|invoice_payments|cash_book|journal_|commission_|customers|sales_opportunities)\b/.test(pb.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "playbook.ts never names a document, payment, cash, journal, commission, customer or deal table");
s(!/UPDATE sales_packages|INSERT INTO sales_packages/.test(pb), "the Packages library is read, never written");
s(/SALES_VIEWS = \[[^\]]*"reports", "playbook"\] as const/.test(shell), "the Sales Playbook is the eighth Sales view");
s(/wsView === "playbook" && <SalesPlaybook/.test(sales) && /onPlaybook=\{\(st\) =>/.test(sales) && /data-testid="deal-playbook"/.test(pipe), "Sales draws the Playbook and a deal opens it on its stage");
s(/const readable|e\.published\?\.payload/.test(ui) && /mode === "published" \|\| !manage \? e\.published\?\.payload : e\.draft/.test(ui), "the screen shows a reader the published words only");
s(/fmtRM\(p\.total_cents\)/.test(ui) && /fmtRM\(x\.total_cents\)/.test(ui), "every price on the screen is the Packages library's");
const libOut = join(mkdtempSync(join(tmpdir(), "playbook-lib-")), "playbook.mjs");
execSync(`npx esbuild "${join(root, "lib/playbook.ts")}" --format=esm --outfile="${libOut}" --log-level=error`, { cwd: root, stdio: "inherit" });
const { priceProblem } = await import(pathToFileURL(libOut).href);
{
  s(["RM 1,500", "RM1500", "rm 99.90", "MYR 200", "1,500 ringgit", "RM 1.5k", "harga 50 sen"].every((x) => priceProblem(`a ${x} b`)), "priceProblem catches ringgit amounts");
  s(["Tunjukkan ROI", "RM", "Pakej Gold", "3 bulan", "5 langkah", "Kempen 2026"].every((x) => !priceProblem(x)), "priceProblem leaves ordinary words and numbers alone");
}

const dir = mkdtempSync(join(tmpdir(), "playbook-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;

const MUTANTS = [
  ["staff read drafts", "worker/src/playbook.ts", `\${manage ? "" : "WHERE e.status = 'published' AND e.published_version IS NOT NULL"}`, `\${manage ? "" : ""}`],
  ["staff get the draft", "worker/src/playbook.ts", "if (!manage) return { id: r.id, section: r.section, kind: r.kind, sort: r.sort, published: pub };", "if (!manage) return { id: r.id, section: r.section, kind: r.kind, sort: r.sort, published: pub, draft: parse(r.draft, null) };"],
  ["the super admin writes", "worker/src/permissions.ts", `playbook_manage: ["ceo", "coo", "cco"],`, `playbook_manage: ["super_admin", "ceo", "coo", "cco"],`],
  ["a price slips in", "lib/playbook.ts", "return m ? m[0].trim() : \"\";", "return m ? \"\" : \"\";"],
  ["publishing without a note", "worker/src/playbook.ts", "if (note.length < 5) return err(", "if (note.length < 0) return err("],
  ["an old version saves over a newer one", "worker/src/playbook.ts", "if (Number(b.version) !== cur.version) return changed();", "if (false) return changed();"],
  ["a version can be changed", "worker/migrations/0230_sales_playbook.sql", "BEGIN SELECT RAISE(ABORT, 'a published playbook version is never changed'); END;", "BEGIN SELECT 1; END;"],
  ["the managers are not told", "worker/src/playbook.ts", "if (!can(m.role, \"playbook_manage\")) continue;", "continue;"],
  ["a draft file is served to staff", "worker/src/playbook.ts", "if (!listed) return err(\"not_found\", \"File not found\", 404);", "void listed;"],
  ["an inactive package is published", "worker/src/playbook.ts", "if (publishing && ids.some((i) => found.get(i) !== \"active\"))", "if (false && ids.some((i) => found.get(i) !== \"active\"))"],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const m = mkdtempSync(join(tmpdir(), "playbook-m-"));
  cpSync(join(root, "worker"), join(m, "worker"), { recursive: true });
  cpSync(join(root, "lib"), join(m, "lib"), { recursive: true });
  cpSync(join(root, "package.json"), join(m, "package.json"));
  const body = readFileSync(join(m, file), "utf8");
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
if (fail) { console.error(`playbook: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - playbook: staff read only published versions; the CEO, COO and CCO write (not the super admin); publishing needs a note, makes the next kept version and tells the other managers; an old version comes back through the draft; no price typed in (packages linked, active to publish); every write version-checked; files only through their published version; nothing outside the Playbook changes (${checks} checks, ${caught}/${MUTANTS.length} mutations caught)`);

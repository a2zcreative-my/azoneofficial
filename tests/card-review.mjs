/* v1.395.0 - GUARD: DIGITAL CARD REVIEW, PUBLISHING AND THE AZ ONE FEED (Digital Cards Stage 6, the CEO 21-11-2026; migration 0225).
 *
 * The real worker on every migration. Proves the CEO's chain and the hand-over to azoneofficial.com:
 *   - only the designer submits, only a finished design, and what is submitted is FROZEN (a numbered
 *     version whose content_hash is the SHA-256 of the manifest AZ ONE receives; never edited or deleted)
 *   - the COO or CCO pre-checks or returns (a note); the CEO or super admin publishes only after a
 *     pre-check; nobody reviews their own design
 *   - every step reaches the right Desk and bell, and the drawer's buttons are the server's flags
 *   - the feed answers only a signed, fresh request; carries the manifest and file addresses but no
 *     storage key and no person; reading marks a record "sent", never "imported"
 *   - "imported" comes only from AZ ONE's report naming the right content hash; a repeat changes
 *     nothing; a failed hand-over is resent as a NEW record the cursor reaches
 *   - unpublish is a tombstone; a live template cannot be archived; a new version is a new draft
 *
 *   node tests/card-review.mjs
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeRuntime, root } from "./browser/portfolio-runtime.mjs";

const read = (f) => readFileSync(join(root, f), "utf8");
const results = [];
const ok = (c, m, why = "") => results.push([!!c, why && !c ? `${m} - ${why}` : m]);
const sha = (b) => createHash("sha256").update(b).digest("hex");

const dir = mkdtempSync(join(tmpdir(), "cardrv-"));
execSync(`npx esbuild "${join(root, "lib/card-bridge-sign.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(dir, "s.mjs")}" --log-level=error`, { cwd: root, stdio: "inherit" });
const S = await import(pathToFileURL(join(dir, "s.mjs")).href);
rmSync(dir, { recursive: true, force: true });

const rt = await makeRuntime();
const { call, db, env } = rt;
db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, department, position, employment_status, joined_on) VALUES
  (22, 'Izz', 'Izz CCO', 'cco@a2zcreative.my', 'cco', 1, 'x', 1, 'Management', 'CCO', 'permanent', '2020-01-01')`);
db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha("t-22"), 22);
rt.tok[22] = "t-22";
const SAM = (p, m, b, ty) => call(p, 4, m, b, ty), CEO = (p, m, b) => call(p, 1, m, b), COO = (p, m, b) => call(p, 3, m, b), CCO = (p, m, b) => call(p, 22, m, b);
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const png = (fill) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(1080), ...be32(1920), 8, 6, 0, 0, 0, 0, 0, 0, 0, ...new Array(64).fill(fill)]);
const zone = { key: "names", kind: "text", label: "Names", label_ms: null, x: 140, y: 640, w: 800, h: 160, font: "greatvibes", weight: 400, size: 108, colour: "#e9d9a6", align: "center", max_chars: 40, required: true, sample: "Aiman & Nadia", sample_ms: null };
const rules = (await CEO("/staff/card-rules")).j;
const wedding = rules.categories.find((x) => x.code === "wedding"), portrait = rules.formats.find((x) => x.code === "portrait");

/** a template carried through every editor step by a designer (uid) */
async function finished(who, name, withZones = true) {
  let r = await call("/staff/card-templates", who, "POST", { name, category_id: wedding.id, format_id: portrait.id, language: "both", packages: ["gold"] });
  const id = r.j.template.id; let v = r.j.template.version;
  r = await call(`/staff/card-templates/${id}/step`, who, "PUT", { version: v, step: 3, specs_confirmed: true }); v = r.j.template.version;
  for (const [i, p] of r.j.editor.pages.entries()) { const u = await call(`/staff/card-templates/${id}/pages/${p.id}/file?version=${v}`, who, "PUT", png(i + 10 * id), "image/png"); v = u.j.template.version; }
  r = await call(`/staff/card-templates/${id}/step`, who, "PUT", { version: v, step: 4 }); v = r.j.template.version;
  if (withZones) { r = await call(`/staff/card-templates/${id}/zones`, who, "PUT", { version: v, page_id: r.j.editor.pages[0].id, zones: [zone] }); v = r.j.template.version; }
  return { id, v, pages: r.j.editor.pages };
}
const ver = async (id) => (await SAM(`/staff/card-templates/${id}`)).j.template.version;
const deskOf = async (uid) => ((await call("/staff/desk", uid)).j?.items ?? []).filter((x) => x.bucket === "cards");

/* ---- submit ---- */
const A = await finished(4, "Royal Gold Wedding", false);
let r = await SAM(`/staff/card-templates/${A.id}/submit`, "POST", { version: A.v });
ok(r.status === 409 && r.j?.error?.code === "not_ready" && /at least one field/i.test(r.j.error.message), "a design with no fields is not sent (409, named)", r.text);
r = await SAM(`/staff/card-templates/${A.id}/zones`, "PUT", { version: A.v, page_id: A.pages[0].id, zones: [zone] });
let v = r.j.template.version;
ok((await COO(`/staff/card-templates/${A.id}/submit`, "POST", { version: v })).status === 403, "only the designer submits (403)");
ok((await SAM(`/staff/card-templates/${A.id}/submit`, "POST", { version: v - 1 })).status === 409, "at the version they started from (409)");
r = await SAM(`/staff/card-templates/${A.id}/submit`, "POST", { version: v, note: "First version for review" });
ok(r.status === 200 && r.j.template.state === "in_review" && r.j.review.version_no === 1, "the designer sends it: in review as v1", r.text);
const row1 = db.prepare(`SELECT manifest_json, content_hash FROM card_template_versions WHERE template_id = ? AND version_no = 1`).get(A.id);
const man1 = JSON.parse(row1.manifest_json);
ok(row1.content_hash === sha(JSON.stringify(man1.manifest)) && man1.manifest.pages.length === 3 && man1.manifest.zones[0].page === 1 && man1.files.every((k) => k.startsWith("private/card-templates/")), "v1 is frozen: the manifest, its SHA-256, the page hashes and the fields by page");
let refused = false; try { db.exec(`UPDATE card_template_versions SET content_hash = 'x'`); } catch { refused = true; }
let refused2 = false; try { db.exec(`DELETE FROM card_template_versions`); } catch { refused2 = true; }
ok(refused && refused2, "a frozen version is never edited or deleted (0225 triggers)");
ok((await SAM(`/staff/card-templates/${A.id}/zones`, "PUT", { version: r.j.template.version, page_id: A.pages[0].id, zones: [] })).status === 409, "nothing on it changes while in review (409)");
ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE ref = ? AND user_id IN (3, 22)`).get(`card_template:${A.id}:submit:1`).n === 2, "the COO and the CCO are told");
ok((await deskOf(3)).some((x) => x.id === `card_template:${A.id}` && x.kind === "decide" && /not pre-checked/.test(x.sub)), "and it waits on the COO's Desk to pre-check");
ok((await deskOf(1)).every((x) => x.id !== `card_template:${A.id}`), "not yet on the CEO's Desk");

/* ---- pre-check: return, then pass ---- */
v = await ver(A.id);
ok((await CEO(`/staff/card-templates/${A.id}/publish`, "POST", { version: v, decision: "publish" })).j?.error?.code === "precheck_needed", "publishing waits for a pre-check (409)");
ok((await SAM(`/staff/card-templates/${A.id}/precheck`, "POST", { version: v, decision: "pass" })).status === 403, "the designer cannot pre-check (403)");
ok((await COO(`/staff/card-templates/${A.id}/precheck`, "POST", { version: v, decision: "return", note: "fix" })).status === 422, "a return needs a note of 10+ characters (422)");
r = await COO(`/staff/card-templates/${A.id}/precheck`, "POST", { version: v, decision: "return", note: "Make the names larger please" });
ok(r.status === 200 && r.j.template.state === "returned" && r.j.review.returned?.note === "Make the names larger please", "the COO returns it with a note", r.text);
ok((await deskOf(4)).some((x) => x.id === `card_template:${A.id}` && x.kind === "do"), "it waits on the designer's Desk");
v = r.j.template.version;
r = await SAM(`/staff/card-templates/${A.id}/zones`, "PUT", { version: v, page_id: A.pages[0].id, zones: [{ ...zone, size: 120 }] });
r = await SAM(`/staff/card-templates/${A.id}/submit`, "POST", { version: r.j.template.version });
ok(r.j.review.version_no === 2 && db.prepare(`SELECT COUNT(*) AS n FROM card_template_versions WHERE template_id = ?`).get(A.id).n === 2, "sent again as v2; v1 stays as it was");
v = r.j.template.version;
r = await CCO(`/staff/card-templates/${A.id}/precheck`, "POST", { version: v, decision: "pass" });
ok(r.status === 200 && r.j.review.prechecked_by === "Izz CCO", "the CCO pre-checks it", r.text);
ok((await deskOf(1)).some((x) => x.id === `card_template:${A.id}` && /pre-checked, not published/.test(x.sub)), "it waits on the CEO's Desk to publish");
ok((await COO(`/staff/card-templates/${A.id}/precheck`, "POST", { version: r.j.template.version, decision: "pass" })).status === 409, "a second pre-check is refused (409)");

/* nobody publishes their own design */
const B = await finished(1, "CEO's Own Design");
let rb = await CEO(`/staff/card-templates/${B.id}/submit`, "POST", { version: B.v });
rb = await COO(`/staff/card-templates/${B.id}/precheck`, "POST", { version: rb.j.template.version, decision: "pass" });
rb = await CEO(`/staff/card-templates/${B.id}/publish`, "POST", { version: rb.j.template.version, decision: "publish" });
ok(rb.status === 403 && rb.j?.error?.code === "self_review", "the CEO cannot publish the CEO's own design (403) - the super admin does", rb.text);

/* ---- publish ---- */
v = await ver(A.id);
ok((await COO(`/staff/card-templates/${A.id}/publish`, "POST", { version: v, decision: "publish" })).status === 403, "the COO cannot publish (403)");
r = await CEO(`/staff/card-templates/${A.id}/publish`, "POST", { version: v, decision: "publish" });
ok(r.status === 200 && r.j.template.state === "published" && r.j.template.published_version === 2 && r.j.review.sync[0]?.status === "pending" && r.j.review.live_version === 2, "the CEO publishes v2: one record waits for AZ ONE", r.text);
ok(r.j.review.bridge_configured === false, "the drawer says AZ ONE is not connected while there is no key");
const hash2 = db.prepare(`SELECT content_hash FROM card_template_versions WHERE template_id = ? AND version_no = 2`).get(A.id).content_hash;

/* ---- the feed ---- */
const feed = async (method, pathQ, body = "", opts = {}) => {
  const headers = opts.unsigned ? {} : await S.cardHeaders(opts.key ?? "test-card-key", method, pathQ, body, opts.now ?? Date.now());
  if (method === "POST") headers["content-type"] = "application/json";
  const res = await rt.worker.fetch(new Request(`https://api.a2z.test${pathQ}`, { method, headers, body: method === "POST" ? body : undefined }), env);
  const buf = Buffer.from(await res.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString()); } catch { /* bytes */ }
  return { status: res.status, j, buf, h: res.headers, text: buf.toString().slice(0, 300) };
};
ok((await feed("GET", "/api/v1/bridge/card-templates?since=0")).status === 501, "without CARD_BRIDGE_KEY the feed is off (501)");
env.CARD_BRIDGE_KEY = "test-card-key";
ok((await feed("GET", "/api/v1/bridge/card-templates?since=0", "", { unsigned: true })).status === 401, "an unsigned request is refused (401)");
ok((await feed("GET", "/api/v1/bridge/card-templates?since=0", "", { key: "wrong" })).status === 401, "a wrong key is refused (401)");
ok((await feed("GET", "/api/v1/bridge/card-templates?since=0", "", { now: Date.now() - 600_000 })).status === 401, "a request 10 minutes old is refused (401)");
r = await feed("GET", "/api/v1/bridge/card-templates?since=0");
const item = r.j?.items?.[0];
ok(r.status === 200 && r.j.items.length === 1 && item.action === "publish" && item.code === "royal-gold-wedding" && item.version === 2 && item.content_hash === hash2, "a signed read returns the published v2", r.text);
ok(sha(JSON.stringify(item.manifest)) === item.content_hash, "AZ ONE can check the manifest against its hash");
ok(!/private\/|designer|Sam Seller|r2_key/.test(r.text + JSON.stringify(item)), "no storage key and no person leaves in the feed");
ok(db.prepare(`SELECT status FROM card_template_sync WHERE template_id = ?`).get(A.id).status === "sent", "reading marks it sent - not imported");
const f1 = await feed("GET", item.files[0].url);
const k1 = JSON.parse(db.prepare(`SELECT manifest_json FROM card_template_versions WHERE template_id = ? AND version_no = 2`).get(A.id).manifest_json).files[0];
ok(f1.status === 200 && Buffer.compare(f1.buf, rt.objects.get(k1).bytes) === 0 && f1.h.get("x-content-sha256") === item.manifest.pages[0].sha256, "a page's artwork comes byte for byte, with its SHA-256");
ok((await feed("GET", "/api/v1/bridge/card-templates/royal-gold-wedding/1/page/1")).status === 404, "a version that was never published is not served (404)");
const cursor = r.j.cursor;
ok((await feed("GET", `/api/v1/bridge/card-templates?since=${cursor}`)).j.items.length === 0, "the cursor moves past what was read");

/* ---- AZ ONE reports ---- */
const ack = (b) => feed("POST", "/api/v1/bridge/card-templates/ack", JSON.stringify(b));
r = await ack({ id: item.id, status: "imported", content_hash: "0".repeat(64) });
ok(r.status === 409 && db.prepare(`SELECT status, last_error FROM card_template_sync WHERE id = ?`).get(item.id).status === "failed", "an import naming another hash is refused and recorded as failed", r.text);
ok((await deskOf(1)).some((x) => x.id === `card_template:${A.id}:sync:${item.id}`), "the failure waits on the CEO's Desk");
v = await ver(A.id);
ok((await COO(`/staff/card-templates/${A.id}/sync/${item.id}/retry`, "POST", { version: v })).status === 403, "the COO cannot resend (403)");
r = await CEO(`/staff/card-templates/${A.id}/sync/${item.id}/retry`, "POST", { version: v });
ok(r.status === 200 && r.j.review.sync[0].retry_of === item.id && r.j.review.sync[0].status === "pending", "the CEO sends it again as a new record", r.text);
ok((await CEO(`/staff/card-templates/${A.id}/sync/${item.id}/retry`, "POST", { version: r.j.template.version })).status === 409, "once (409)");
r = await feed("GET", `/api/v1/bridge/card-templates?since=${cursor}`);
const again = r.j.items[0];
ok(again?.id > item.id && again.content_hash === hash2, "AZ ONE's cursor reaches the resend");
ok((await ack({ id: again.id, status: "imported", content_hash: hash2 })).j?.status === "imported", "AZ ONE reports the import with the right hash");
ok((await ack({ id: again.id, status: "imported", content_hash: hash2 })).j?.already === true, "a repeated report changes nothing");
await ack({ id: again.id, status: "failed", error: "late" });
ok(db.prepare(`SELECT status FROM card_template_sync WHERE id = ?`).get(again.id).status === "imported", "a late failure never undoes an import");
r = await SAM(`/staff/card-templates/${A.id}`);
ok(r.j.review.sync[0].status === "imported" && r.j.review.sync[0].acked_at && r.j.review.bridge_configured, "the drawer shows AZ ONE has it - from AZ ONE's own report");

/* ---- a new version, archive, unpublish ---- */
v = r.j.template.version;
r = await SAM(`/staff/card-templates/${A.id}/revise`, "POST", { version: v });
ok(r.status === 200 && r.j.template.state === "draft" && r.j.review.live_version === 2, "the designer opens it again as a draft; v2 stays the AZ ONE version", r.text);
v = r.j.template.version;
ok((await SAM(`/staff/card-templates/${A.id}/archive`, "POST", { version: v, reason: "no longer wanted here" })).j?.error?.code === "live", "a template live on AZ ONE cannot be archived (409)");
ok((await COO(`/staff/card-templates/${A.id}/unpublish`, "POST", { version: v, note: "Season is over now" })).status === 403, "the COO cannot unpublish (403)");
ok((await CEO(`/staff/card-templates/${A.id}/unpublish`, "POST", { version: v, note: "short" })).status === 422, "unpublishing needs a reason (422)");
r = await CEO(`/staff/card-templates/${A.id}/unpublish`, "POST", { version: v, note: "The season for this design is over" });
ok(r.status === 200 && r.j.review.live_version === null && r.j.review.sync[0].action === "unpublish", "the CEO takes it off AZ ONE: a tombstone record", r.text);
r = await feed("GET", `/api/v1/bridge/card-templates?since=${again.id}`);
ok(r.j.items.length === 1 && r.j.items[0].action === "unpublish" && r.j.items[0].version === 2 && !r.j.items[0].manifest, "AZ ONE reads the tombstone (no design in it)");
let refused3 = false; try { db.exec(`DELETE FROM card_template_sync`); } catch { refused3 = true; }
ok(refused3, "a sync record is never deleted (0225 trigger)");
ok(["card_template.submit", "card_template.return", "card_template.precheck", "card_template.publish", "card_template.sync_retry", "card_template.revise", "card_template.unpublish"].every((a) => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get(a).n > 0), "every step is in the audit");

/* ---- wiring ---- */
const perms = read("worker/src/permissions.ts"), wr = read("worker/wrangler.toml"), signSrc = read("lib/card-bridge-sign.ts");
ok(/card_template_precheck: \["coo", "cco"\]/.test(perms) && /card_template_publish: \["super_admin", "ceo"\]/.test(perms), "pre-check is the COO and the CCO; publishing the CEO and the super admin");
ok(!/^\s*import\s/m.test(signSrc), "the signing file imports nothing - AZ ONE copies it");
ok(!/^\s*CARD_BRIDGE_KEY\s*=/m.test(wr) && /wrangler secret put CARD_BRIDGE_KEY/.test(wr), "the key is a secret, never a value in wrangler.toml");
ok(/\|card_template\|[a-z_|]*\):\(\\d\+\)/.test(read("lib/record-focus.ts")) && /case "card_template"/.test(read("components/portal/desk-page.tsx")), "a bell or Desk row opens the template");
ok(/focus=\{focusOf\("Digital Cards"\)\}/.test(read("app/portal/page.tsx")), "Digital Cards receives the record to open");
const idx = read("worker/src/index.ts");
ok(((s) => { const m = /const LATEST_MIGRATION = "(\d{4}_[a-z0-9_]+)";/.exec(s); const newest = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort().pop(); return !!m && m[1] >= "0225" && `${m[1]}.sql` === newest; })(idx) /* 21-11-2026 - follows the newest migration on disk, so a later module's migration no longer breaks this check */ && /"0225_card_template_publish",/.test(idx), "0225 is in the expected list (later migrations follow it)");
const mig = read("worker/migrations/0225_card_template_publish.sql").replace(/--.*$/gm, "");
ok(!/\bDROP\b/i.test(mig) && (mig.match(/ALTER TABLE card_templates ADD COLUMN/g) ?? []).length === 3 && (mig.match(/ALTER TABLE/g) ?? []).length === 3, "0225 is additive");

const failed = results.filter(([x]) => !x);
for (const [x, m] of results) console.log(`${x ? "  ✓" : "  ✗"} ${m}`);
if (failed.length) { console.log(`\n${failed.length} check(s) failed.`); process.exit(1); }
console.log(`\n${results.length} check(s) passed.`);

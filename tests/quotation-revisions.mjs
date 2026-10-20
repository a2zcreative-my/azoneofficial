/* tests/quotation-revisions.mjs - v1.181.11: A QUOTATION IS REVISED, NOT REPLACED.
 *
 * The CEO, 20-10-2026: "I want to add on the Quotation if there is anything
 * that I want to add based on customer request without require to create a
 * new one Quotation".
 *
 * Edit could already change a quotation's lines - it was built for typos, so
 * it overwrote the version the customer held and printed the same number
 * with a different total, with nothing to say which came first. Revise keeps
 * the number, prints REV n dated the day it was revised, restarts the 14
 * days, and keeps every replaced version whole so it can be printed again.
 *
 * Run, not only read: the three print helpers are bundled and called, and
 * the server rules are held from source.
 *
 *   node tests/quotation-revisions.mjs
 */
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const WIN = process.platform === "win32";
const qArg = (a) => (WIN && /[ &()^%!]/.test(a) ? `"${a}"` : a);

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` - ${why}` : ""}`); } };

/* ---- 1. what a revised quotation prints (run) ---- */
const out = path.join(mkdtempSync(path.join(tmpdir(), "qt-rev-")), "dt.mjs");
try {
  execFileSync("npx", ["esbuild", path.join(root, "lib/doc-template.ts"), "--bundle", "--format=esm",
    "--platform=neutral", `--outfile=${out}`].map(qArg), { stdio: "pipe", shell: WIN, cwd: root });
} catch (e) {
  console.log(`FAIL - lib/doc-template.ts does not bundle: ${e.message}`);
  process.exit(1);
}
const t = await import(pathToFileURL(out).href);
ok("an original prints its bare number", t.docRevisionLabel({ doc_number: "QT-AZO150926-1", revision: 0 }) === "QT-AZO150926-1");
ok("a revision keeps the number and says which version",
  t.docRevisionLabel({ doc_number: "QT-AZO150926-1", revision: 2 }) === "QT-AZO150926-1 REV 2");
ok("a revision is dated the day it was revised",
  t.docDateOf({ created_at: "2026-09-15 02:00:00", revision: 1, revised_at: "2026-10-20 09:30:00" }) === "2026-10-20 09:30:00");
ok("an original keeps its own date", t.docDateOf({ created_at: "2026-09-15 02:00:00", revision: 0, revised_at: null }) === "2026-09-15 02:00:00");
ok("a revision restarts the 14 days and prints the day",
  t.quoteValidUntil({ valid_until: null, revision: 1, revised_at: "2026-10-20 09:30:00" }) === "2026-11-03");
ok("an original still says 14 days", t.quoteValidUntil({ valid_until: null, revision: 0, revised_at: null }) === null);
ok("a quotation with its own valid-until keeps it", t.quoteValidUntil({ valid_until: "2026-12-31", revision: 3, revised_at: "2026-10-20" }) === "2026-12-31");
ok("the PDF file name has no space in it",
  t.docFileName({ doc_number: "QT-AZO150926-1", revision: 2 }) === "QT-AZO150926-1-REV2.pdf"
  && t.docFileName({ doc_number: "QT-AZO150926-1", revision: 0 }) === "QT-AZO150926-1.pdf");

/* ---- 2. every surface prints through those helpers ---- */
const tpl = read("lib/doc-template.ts"), pdf = read("lib/doc-pdf.ts"), pub = read("app/doc/page.tsx"), sales = read("components/portal/sales.tsx");
ok("the HTML document prints the revision number, date and validity",
  /\["Doc no\.", esc\(docRevisionLabel\(doc\)\), "23%"\]/.test(tpl) && /\["Date", dOnly\(docDateOf\(doc\)\), "14%"\]/.test(tpl)
  && /const vu = quoteValidUntil\(doc\);/.test(tpl));
ok("...and so does the PDF",
  /\["DOC NO\.", docRevisionLabel\(doc\), 0\.23\]/.test(pdf) && /\["DATE", dmy\(docDateOf\(doc\)\), 0\.14\]/.test(pdf)
  && /quoteValidUntil\(doc\) \? dmy\(quoteValidUntil\(doc\)\)/.test(pdf));
ok("...and the customer's shared link", /docRevisionLabel\(doc\)/.test(pub));
ok("the shared link learns the revision, and survives a database without it",
  /SELECT revision, revised_at FROM sales_documents WHERE share_token = \?1/.test(read("worker/src/index.ts")));

/* ---- 3. the server rules ---- */
const staff = read("worker/src/staff.ts");
const edit = staff.slice(staff.indexOf("const docEdit = path.match(/^\\/docs\\/(\\d+)\\/edit$/);"));
ok("only a quotation is revised", /if \(docE\.doc_type !== "QT"\) \{\s*return err\("invalid_input", "Only a quotation is revised/.test(edit));
ok("a quotation that is already an invoice is not revised",
  /converted_from = \?1 AND doc_type = 'INV'[\s\S]{0,200}?This quotation is already invoiced as/.test(edit));
ok("a revision that changes nothing is refused", /if \(unchanged\) \{\s*return err\("invalid_input", "Nothing changed/.test(edit));
ok("the version being replaced is kept whole, minus the share token, BEFORE it is overwritten",
  edit.indexOf("INSERT OR REPLACE INTO sales_document_revisions") > 0
  && edit.indexOf("INSERT OR REPLACE INTO sales_document_revisions") < edit.indexOf("UPDATE sales_documents SET ${baseSet}")
  && /const \{ share_token: _tok, \.\.\.snap \} = cur;/.test(edit));
ok("the new lines and the new revision number land in one batch",
  /await env\.DB\.batch\(\[\s*upd,\s*[\s\S]{0,300}?SET revision = \?2, revised_at = datetime\('now', '\+8 hours'\)/.test(edit));
ok("a revision keeps the original date on the row", /const dateE = !revise && /.test(edit));
ok("a revision is audited as one", /"doc\.revise"/.test(edit));
ok("the history route is for sales and never returns the share token",
  /const docRevs = path\.match[\s\S]{0,200}?if \(!can\(user\.role, "sales"\)\)/.test(staff)
  && !/"share_token"/.test(staff.slice(staff.indexOf("const docRevs"), staff.indexOf("const docEdit"))));
ok("a deleted quotation takes its history with it", /DELETE FROM sales_document_revisions WHERE doc_id = \?1/.test(staff));

/* ---- 4. the migration and its registration ---- */
const mig = "worker/migrations/0139_quotation_revisions.sql";
ok("0139 exists", existsSync(path.join(root, mig)));
const sql = existsSync(path.join(root, mig)) ? read(mig) : "";
ok("0139 adds revision and revised_at, and the history table",
  /ALTER TABLE sales_documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;/.test(sql)
  && /ALTER TABLE sales_documents ADD COLUMN revised_at TEXT;/.test(sql)
  && /CREATE TABLE IF NOT EXISTS sales_document_revisions/.test(sql)
  && /ON sales_document_revisions \(doc_id, revision\)/.test(sql));
const idx = read("worker/src/index.ts");
ok("0139 is expected and probed (a later migration may be the latest)",
  /"0139_quotation_revisions",/.test(idx)
  && /\["0139 \(quotation revisions\)"/.test(idx));

/* ---- 5. the portal ---- */
ok("an open quotation offers Revise; an invoiced one does not",
  /\{d\.doc_type === "QT" && !d\.invoiced_as && \(\s*<button[\s\S]{0,700}?onClick=\{\(\) => void openInForm\(d, true\)\}/.test(sales));
ok("saving a revision says so to the server", /editingDoc\.revise \? \{ \.\.\.payload, revise: true \} : payload/.test(sales));
ok("the form says what Revise will do before anything is typed", /prints as REV \$\{\(editingDoc\.revision \?\? 0\) \+ 1\} dated today/.test(sales));
ok("the list marks a revised quotation and its details list the history",
  /<RevisionChip revision=\{d\.revision\} \/>/.test(sales) && /<DocRevisions\s/.test(sales));

if (failed) {
  console.log(`\nquotation-revisions: ${failed} failed, ${passed} passed.`);
  process.exitCode = 1;
} else {
  console.log(`quotation-revisions: ${passed} checks passed - a quotation keeps its number, prints its revision, and keeps what the customer was sent.`);
}

/* v1.314.0 - A2Z OS ACCOUNTING WORKSPACE 5.0, Phase A (the CEO's "Approved as
   per recommendations both", 15-11-2026; claude/ACCOUNTING-WORKSPACE-5.0-BLUEPRINT.md).

   Phase A is the screens only: no figure, posting or record changes. What
   this holds, in the source (the browser half is tests/browser/accounting5.py):
     - four tabs in the reference's order, the view in the address, the
       phone's view switch;
     - a balanced trial balance is called arithmetic, never health, and the
       exceptions are counted beside it;
     - money in and out say they are cash basis; the P&L says it is a
       cash-basis receipts-and-payments statement; the Balance Sheet stays
       "not supported" (AC-5);
     - both companies are "combined", never a consolidated statement (AC-4);
     - a filtered chart of accounts never calls its sum the ledger total;
     - Close month is offered only on the month whose checks passed, and the
       screen says nothing is locked (Phase E is not built);
     - v1.316.0 (Phase B, AC-1): New account, the composer and Reverse are
       offered to the CEO and COO only, Close and Reopen to the CEO only.
   Each rule is also proven to catch its own breakage (the mutation pass).

     node tests/accounting5.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

const FILES = { acc: "components/portal/accounting-panel.tsx", books: "components/portal/books-panel.tsx", page: "app/portal/page.tsx", ledger: "worker/src/ledger.ts" };

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const a = src.acc;
  ok("four tabs in the reference's order", /const tabs: \[View, string\]\[\] = \[\["overview", L\("Overview", "Gambaran"\)\], \["ledger", L\("General Ledger", "Lejar Am"\)\], \["reports", L\("Financial Reports", "Laporan Kewangan"\)\], \["close", L\("Month-End & Audit"/.test(a));
  ok("the view is in the address (Back and Forward), and a link opens its view", /useTabViewAddress\("Accounting", view, open, isAccView\);/.test(a) && /<AccountingPanel startView=\{startOf\("Accounting"\)\} role=\{user\.role\} \/>/.test(src.page));
  ok("the phone reads the view switch", /<ViewSwitch value=\{view\} onChange=\{\(k\) => open\(k\)\} label=\{L\("Accounting view"/.test(a));
  ok("balanced is arithmetic, never health - the exceptions beside it", /label=\{L\("Trial Balance Status", "Status Imbangan Duga"\)\}/.test(a) && /Debits = credits \(arithmetic only\) · \$\{exceptions\} exception\(s\) to check/.test(a) && !/L\("Healthy"/.test(a));
  ok("money in and out say they are cash basis", /L\("Money In \(cash basis\)", "Wang Masuk \(asas tunai\)"\)/.test(a) && /L\("Money Out \(cash basis\)", "Wang Keluar \(asas tunai\)"\)/.test(a));
  ok("the exceptions count what they are, not accounts in use", /movement\(s\) not in the books · \$\{o\.exceptions\.unbalanced\.length\} unbalanced · \$\{o\.exceptions\.duplicates\.length\} posted twice/.test(a));
  ok("the P&L is a cash-basis receipts-and-payments statement", /L\("Profit & Loss - cash basis \(receipts and payments\)"/.test(a));
  ok("the Balance Sheet stays not supported (AC-5)", /aria-label=\{L\("Balance sheet not supported"/.test(a));
  ok("both companies are combined, never a consolidated statement (AC-4)", /const COMBINED = \(\) => L\("combined - one ledger for both companies, not a consolidated statement"/.test(a) && /cash basis · \$\{COMBINED\(\)\}/.test(a) && !/consolidated statement"\)[^]*?L\("Consolidated"/.test(a));
  ok("a filtered chart never calls its sum the ledger total", /\{aq\.trim\(\) \|\| atype \? L\("Shown accounts only \(filtered\) - not the ledger total"/.test(a));
  ok("the trial balance shows Total Debit, Total Credit and the arithmetic check", /data-testid="tb-totals"/.test(a) && /L\("Balanced \(arithmetic\)", "Seimbang \(aritmetik\)"\)/.test(a));
  ok("Close month only on the month whose checks passed", /\{canClose && !current && !m\.closed && \(gate && !\(gate\.month === m\.month && gate\.ready\)/.test(src.books) && /onReady\?\.\(d\.month, d\.ready && d\.ended && !d\.close\)/.test(a) && /<BooksPanel canClose=\{canClose\} gate=\{\{ month: closeMonth, ready: closeReady\?\.month === closeMonth && closeReady\.ready/.test(a));
  ok("the screen still says nothing is locked (Phase E not built)", /Nothing is locked/.test(src.books));
  ok("the ledger is still read-only cash basis on the server", /basis: "cash"/.test(src.ledger));
  /* v1.316.0 (Phase B, AC-1) - the screen offers posting and closing only to whom the server allows (tests/accounting-b.mjs holds the server) */
  ok("AC-1 posting is offered to the CEO and COO only (accounting_post)", /const canPost = holds\("accounting_post", \["ceo", "coo"\]\.includes\(role\)\);/.test(a)
    && /\{canPost && <button type="button" className=\{btnSmPrimary\} onClick=\{\(\) => setAdding\(true\)\}>/.test(a) && /\{canPost \? <Composer /.test(a) && /footer=\{canPost && d && d\.manual && !d\.reversed_by \?/.test(a));
  ok("AC-1 closing and reopening are offered to the CEO only (books_close)", /const canClose = holds\("books_close", role === "ceo"\);/.test(a) && /canClose = false \}/.test(src.books)
    && /\{canClose && m\.closed && <button/.test(src.books) && /<AccountingPanel startView=\{startOf\("Accounting"\)\} role=\{user\.role\} \/>/.test(src.page));
  return res;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

const MUT = [
  ["balanced called health again", "acc", 'Debits = credits (arithmetic only) · ${exceptions} exception(s) to check', "All healthy"],
  ["money in without its basis", "acc", 'L("Money In (cash basis)", "Wang Masuk (asas tunai)")', 'L("Revenue", "Hasil")'],
  ["the P&L presented as complete", "acc", 'L("Profit & Loss - cash basis (receipts and payments)"', 'L("Profit & Loss"'],
  ["the two companies called consolidated", "acc", 'L("combined - one ledger for both companies, not a consolidated statement"', 'L("consolidated statement"'],
  ["a filtered sum called the total", "acc", '{aq.trim() || atype ? L("Shown accounts only (filtered) - not the ledger total", "Akaun dipaparkan sahaja (ditapis) - bukan jumlah lejar") : L("Total", "Jumlah")}', '{L("Total", "Jumlah")}'],
  ["Close offered on any month", "books", "{canClose && !current && !m.closed && (gate && !(gate.month === m.month && gate.ready)", "{canClose && !current && !m.closed && (false"],
  ["the view taken off the address", "acc", 'useTabViewAddress("Accounting", view, open, isAccView);', ""],
  ["New account offered to every reader", "acc", '{canPost && <button type="button" className={btnSmPrimary} onClick={() => setAdding(true)}>', '{<button type="button" className={btnSmPrimary} onClick={() => setAdding(true)}>'],
  ["Reverse offered to every reader", "acc", "footer={canPost && d && d.manual && !d.reversed_by ?", "footer={d && d.manual && !d.reversed_by ?"],
  ["the COO offered Close", "acc", 'const canClose = holds("books_close", role === "ceo");', 'const canClose = holds("books_close", ["ceo", "coo"].includes(role));'],
  ["Reopen offered to every reader", "books", "{canClose && m.closed && <button", "{m.closed && <button"],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\naccounting5: ${failed.length} failed`); process.exit(1); }
console.log(`accounting5: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);

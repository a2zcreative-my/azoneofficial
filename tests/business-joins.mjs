/* tests/business-joins.mjs - THE ERP ROADMAP KEEPS ITS PROMISE. v1.181.13 onward.
 *
 * The CEO, 20-10-2026: "Proceed with the implementation phase by phase, and
 * also do not change any logic since my system are currently use by staff."
 *
 * Every phase lives in worker/src/business.ts and its screens, and every one
 * of them is ADDITIVE: it reads what the portal already records, or writes to
 * a table of its own. This guard holds that from source, phase by phase:
 *
 *   0. the contract - business.ts never writes to a table that carries
 *      today's money or pay (sales_documents, cashflow_entries, the journal,
 *      payroll, users), and the door in staff.ts only ever ADDS routes
 *   1. phase 1 - part payments are recorded, never mark an invoice paid,
 *      refuse an overpayment, a future date and a paid invoice, are voided
 *      with a reason and never deleted; the customer timeline asks each
 *      source only for the roles that source's own screen serves
 *   2. phase 2 - receiving stock moves the shelf relatively, through the
 *      manual movement log, and writes no expense, cash or journal line
 *   3. phase 3 - closing a month is a snapshot that locks nothing; a stock
 *      take posts differences against its snapshot as variances
 *   4. phase 4 - the client file writes only its own tables; a monthly
 *      invoice is never raised by itself; credit terms reach only a new
 *      invoice; accepting on the link is recorded and changes nothing
 *   5. phase 5 - the lifecycle writes only its own tables and never the
 *      employment status; letters are voided, never deleted, and signed by
 *      hand; the quotation approval limit is off until the owner sets it
 *
 * Later phases append their own block. A check is written so it FAILS on
 * the thing it guards against - the self-tests prove the readers see code.
 *
 *   node tests/business-joins.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const has = (p) => existsSync(path.join(root, p));

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` - ${why}` : ""}`); } };

const biz = read("worker/src/business.ts");
const staff = read("worker/src/staff.ts");
const idx = read("worker/src/index.ts");

/* ---- 0. the contract ---- */
{
  /* every write statement in business.ts, by the table it names */
  const writes = [...biz.matchAll(/\b(INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi)].map((m) => m[2].toLowerCase());
  ok("self-test: the write reader finds writes", writes.length >= 2, JSON.stringify(writes));
  const PROTECTED = ["sales_documents", "cashflow_entries", "journal_entries", "journal_lines", "payroll_entries",
    "payslip_releases", "users", "leave_requests", "attendance_records", "ot_records", "claims", "inventory_items", "receipts", "credit_notes"];
  /* phase 2 (receiving) and phase 3 (stock take) write stock through the
     movement table on purpose - each is held in its own block below */
  const allowedByPhase = new Set(["inventory_items"]);
  const bad = writes.filter((t) => PROTECTED.includes(t) && !(allowedByPhase.has(t) && /PHASE 2/.test(biz)));
  ok("business.ts never writes to a table that carries today's money, pay or people", bad.length === 0, bad.join(", "));
  ok("the door in staff.ts only hands named paths to business.ts and falls through otherwise",
    /const biz = await handleBusiness\(env, path, method, body, user, new URL\(request\.url\)\.searchParams\);\s*if \(biz\) return biz;/.test(staff));
  ok("the module says what it promises", /Every route here is\s+\* ADDITIVE/.test(biz));
}

/* ---- 1. phase 1: part payments ---- */
{
  ok("migration 0140 creates invoice_payments and never touches an existing table",
    has("worker/migrations/0140_part_payments.sql")
    && /CREATE TABLE IF NOT EXISTS invoice_payments/.test(read("worker/migrations/0140_part_payments.sql"))
    && !/ALTER TABLE|DROP |UPDATE |DELETE /.test(read("worker/migrations/0140_part_payments.sql").replace(/^--.*$/gm, "")));
  ok("0140 is registered and probed", /"0140_part_payments",/.test(idx) && /\["0140 \(part payments on an invoice\)"/.test(idx));
  const post = biz.slice(biz.indexOf('const mPay = path.match'), biz.indexOf('const mVoid = path.match'));
  ok("recording a part needs finance, like marking paid", /if \(!canInvoiceMoney\(user\)\) return err\("forbidden"/.test(post) && /const canInvoiceMoney = \(u: StaffUser\) => can\(u\.role, "finance"\);/.test(biz));
  ok("a paid invoice takes no part payment", /if \(inv\.payment_status === "paid"\) \{\s*return err\("invalid_input"/.test(post));
  ok("an overpayment is refused", /if \(amount > left\) \{\s*return err\("invalid_input"/.test(post));
  ok("a future date is refused", /!validDay\(on\) \|\| on > mytToday\(\)/.test(post));
  ok("a part is audited", /"invoice\.part_payment"/.test(post));
  ok("a part is voided with a reason, never deleted",
    /reason\.length < 3/.test(biz) && /UPDATE invoice_payments SET voided_at = datetime\('now'\)/.test(biz) && !/DELETE FROM invoice_payments/.test(biz));
  const ui = read("components/portal/invoice-payments.tsx");
  ok("the panel never marks an invoice paid", !/method: "PATCH"/.test(ui) && !/payment_status: "paid"/.test(ui));
  ok("...it says the parts cover the total and points at the existing Mark paid",
    /The parts cover the whole invoice\. Mark it paid with the status picker/.test(ui));
  const sales = read("components/portal/sales.tsx");
  ok("the Sales tab shows the panel on an invoice and the chip on its row",
    /<InvoicePayments docId=\{d\.id\}/.test(sales) && /<PartPaidChip totalCents=\{d\.total_cents\} receivedCents=\{partPaid\[d\.id\]\} \/>/.test(sales));
}

/* ---- 1. phase 1: the customer timeline ---- */
{
  const tl = biz.slice(biz.indexOf("const mTl = path.match"));
  ok("the timeline is for whoever may read Sales documents", /if \(!canReadDocs\(user\)\) return err\("forbidden", "Sales access required", 403\);/.test(tl)
    && /const canReadDocs = \(u: StaffUser\) => can\(u\.role, "sales"\) \|\| can\(u\.role, "exec_view"\);/.test(biz));
  ok("enquiries only for the business team", /if \(can\(user\.role, "enquiry_manage"\)\) \{/.test(tl) && /else hidden\.push\("enquiries"\)/.test(tl));
  ok("live sessions only for the management that schedules them", /if \(LIVE_MGR\.includes\(user\.role\)\) \{/.test(tl) && /else hidden\.push\("live_sessions"\)/.test(tl));
  ok("engagements as Sales Performance shows them: a seller sees only their own",
    /const mine = !can\(user\.role, "sales_perf_manage"\);/.test(tl) && /\$\{mine \? "AND e\.user_id = \?2" : ""\}/.test(tl));
  ok("the timeline only reads", !/\b(INSERT|UPDATE|DELETE)\b/.test(tl.slice(0, tl.indexOf("return json({ customer"))));
  ok("the Sales tab opens it from the client's row", /onClick=\{\(\) => openCustomerTimeline\(c\.id, c\.company\)\}/.test(read("components/portal/sales.tsx")));
}

/* ---- 2. phase 2: receiving stock ---- */
{
  const p2 = biz.slice(biz.indexOf("PHASE 2 (v1.181.14)"));
  ok("phase 2 and the phase 3 stock take are written down as the only writers to an existing table",
    /This phase and phase 3's stock take\s+are the only routes here that write to an existing table/.test(biz));
  ok("receiving stock needs the inventory permission, like a manual stock in",
    (p2.match(/if \(!can\(user\.role, "inventory"\)\) return err\("forbidden"/g) ?? []).length >= 5);
  ok("each line logs the same movement a manual stock in writes (direction in, purpose restock)",
    /INSERT INTO manual_stockouts \(item_id, sku, item_name, qty, unit_sale_cents, remark, out_date, created_by, direction, purpose\)\s*VALUES \(\?1, \?2, \?3, \?4, NULL, \?5, \?6, \?7, 'in', 'restock'\)/.test(p2));
  ok("stock moves relatively, so a movement in between is never lost", /SET stock = stock \+ \?1,/.test(p2) && /SET stock = stock - \?1,/.test(p2));
  /* the status rule is staff.ts stockStatus(), word for word */
  ok("the stock status rule is the one staff.ts uses",
    /return stock === 0 \? "out_of_stock" : stock <= 5 \? "low" : "in_stock";/.test(staff)
    && /CASE WHEN stock \+ \?1 = 0 THEN 'out_of_stock' WHEN stock \+ \?1 <= 5 THEN 'low' ELSE 'in_stock' END/.test(p2));
  ok("the low-stock alert resets above 5, as checkLowStock does", /low_alerted = CASE WHEN stock \+ \?1 > 5 THEN NULL ELSE low_alerted END/.test(p2)
    && /if \(it\.stock > 5\) \{\s*if \(it\.low_alerted != null\)/.test(staff));
  ok("the average cost moves only when the box is ticked, and a free line never drags it",
    /const updateCost = body\?\.update_cost !== false;/.test(p2) && /!updateCost \|\| l\.unit_cost_cents <= 0 \? costBefore/.test(p2));
  ok("a receipt is all or nothing", /await env\.DB\.batch\(stmts\);\s*\} catch \(e\) \{\s*\/\*[^*]*\*\/\s*await env\.DB\.prepare\(`DELETE FROM stock_receipts WHERE id = \?1`\)/.test(p2));
  ok("receiving writes no expense, no cash entry and no journal line",
    !/INSERT INTO (expenses|cashflow_entries|journal_entries|journal_lines)/.test(p2) && !/recordBankMovement|postJournal/.test(p2));
  ok("a void refuses stock that has already left, and restores cost only if nothing later set it",
    /const short = \(ls \?\? \[\]\)\.find\(\(l\) => l\.stock < l\.qty\);/.test(p2) && /const restoreCost = l\.later === 0 && l\.unit_cost_cents === l\.cost_after_cents;/.test(p2));
  ok("a reorder level changes no alert: the low-stock watcher still reads its own line",
    /WHERE stock <= \?1 AND COALESCE\(status, 'active'\) != 'discontinued'/.test(read("worker/src/watchers.ts")));
  const m141 = has("worker/migrations/0141_stock_receipts.sql") ? read("worker/migrations/0141_stock_receipts.sql").replace(/^--.*$/gm, "") : "";
  ok("0141 only adds: two tables and two nullable columns", /CREATE TABLE IF NOT EXISTS stock_receipts/.test(m141) && /CREATE TABLE IF NOT EXISTS stock_receipt_lines/.test(m141)
    && /ALTER TABLE inventory_items ADD COLUMN reorder_level INTEGER;/.test(m141) && !/DROP |UPDATE |DELETE |NOT NULL DEFAULT/.test(m141.split("ALTER TABLE")[1] ?? ""));
  ok("0141 is registered and probed", /"0141_stock_receipts",/.test(idx) && /\["0141 \(receiving stock, reorder levels\)"/.test(idx));
  ok("Inventory shows the form in its own zone", /<StockReceive items=\{items\} onStockChanged=\{\(\) => void load\(\)\} \/>/.test(read("components/portal/role-panels.tsx")));
  ok("Purchasing stays retired: no purchase-order screen came back", !has("components/portal/purchasing-panels.tsx") && !/purchase-orders/.test(read("components/portal/stock-receive.tsx")));
}

/* ---- 3. phase 3: the books and the stock take ---- */
{
  const p3 = biz.slice(biz.indexOf("PHASE 3 (v1.181.15) - THE BOOKS"), biz.indexOf("PHASE 3 (v1.181.15) - STOCK TAKE"));
  const st = biz.slice(biz.indexOf("PHASE 3 (v1.181.15) - STOCK TAKE"));
  ok("self-test: both phase 3 sections were found", p3.length > 500 && st.length > 500);
  /* the books only ever write their own snapshot table */
  const p3writes = [...p3.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi)].map((m) => m[2].toLowerCase());
  ok("the books write to period_closes and nothing else", p3writes.length >= 2 && p3writes.every((t) => t === "period_closes"), p3writes.join(", "));
  ok("closing a month locks nothing: no other route reads period_closes", (biz.match(/period_closes/g) ?? []).length === (p3.match(/period_closes/g) ?? []).length
    && !/period_closes/.test(staff) && !/period_closes/.test(read("worker/src/erp.ts")));
  ok("only a month that has ended can be closed", /if \(m >= thisMonth\(\)\) return err\("invalid_input"/.test(p3));
  ok("a reopen needs a reason and keeps the close on record", /reason\.length < 3/.test(p3) && /UPDATE period_closes SET reopened_at = datetime\('now'\)/.test(p3) && !/DELETE FROM period_closes/.test(biz));
  ok("the books are for the Accounting tab's own permission", /const BOOKS = can\(user\.role, "accounting_manage"\);/.test(p3)
    && (p3.match(/if \(!BOOKS\) return err\("forbidden"/g) ?? []).length >= 4);
  ok("the audit trail is for the CEO and super admin only", /const AUDIT_READERS = \["super_admin", "ceo"\];/.test(p3) && /if \(!AUDIT_READERS\.includes\(user\.role\)\) return err\("forbidden"/.test(p3));
  ok("the audit filters are bound, never spliced into the SQL", /binds\.push\(`%\$\{q\}%`\)/.test(p3) && !/LIKE '%\$\{/.test(p3));
  ok("debtors take part payments off, never mark anything paid", /SUM\(p\.amount_cents\) FROM invoice_payments p WHERE p\.invoice_id = d\.id AND p\.voided_at IS NULL/.test(p3) && !/payment_status = 'paid'\s*WHERE/.test(p3));
  /* stock take */
  ok("a stock take needs the inventory permission, like a manual adjustment",
    (st.match(/if \(!can\(user\.role, "inventory"\)\) return err\("forbidden"/g) ?? []).length >= 6);
  ok("one stock take open at a time", /SELECT id FROM stock_counts WHERE status = 'open'/.test(st));
  ok("posting moves stock by the difference against the snapshot, never to an absolute figure",
    /const d = l\.counted_qty - l\.system_qty;/.test(st) && /SET stock = stock \+ \?1,/.test(st) && !/SET stock = \?/.test(st));
  ok("each difference is a variance in the same movement log a manual correction uses",
    /d > 0 \? "variance_found" : "variance_missing"/.test(st) && /"variance_missing", "damaged"/.test(staff) && /"variance_found", "restock"/.test(staff));
  ok("the stock status rule is still staff.ts's word for word",
    /CASE WHEN stock \+ \?1 = 0 THEN 'out_of_stock' WHEN stock \+ \?1 <= 5 THEN 'low' ELSE 'in_stock' END/.test(st));
  ok("a difference that would take the shelf below zero is refused, not guessed", /l\.stock \+ \(l\.counted_qty - l\.system_qty\) < 0/.test(st) && /"insufficient_stock"/.test(st));
  ok("a posting is all or nothing", /stmts\.push\(env\.DB\.prepare\(`UPDATE stock_counts SET status = 'posted'[^`]*`\)\.bind\(cid, user\.id\)\);\s*await env\.DB\.batch\(stmts\);/.test(st));
  ok("a blank line is never touched", /AND l\.counted_qty IS NOT NULL AND l\.counted_qty != l\.system_qty/.test(st));
  ok("cancelling moves no stock", (() => { const c = st.slice(st.indexOf("const mCntCancel")); return !/inventory_items|manual_stockouts/.test(c); })());
  const m142 = has("worker/migrations/0142_books_stock_take.sql") ? read("worker/migrations/0142_books_stock_take.sql").replace(/^--.*$/gm, "") : "";
  ok("0142 only adds three tables", /CREATE TABLE IF NOT EXISTS period_closes/.test(m142) && /CREATE TABLE IF NOT EXISTS stock_counts/.test(m142)
    && /CREATE TABLE IF NOT EXISTS stock_count_lines/.test(m142) && !/ALTER TABLE|DROP |UPDATE |DELETE |INSERT /.test(m142));
  ok("0142 is registered and probed", /"0142_books_stock_take",/.test(idx) && /\["0142 \(month close, stock take\)"/.test(idx));
  const books = read("components/portal/books-panel.tsx");
  ok("Accounting shows the books in their own zone, between the trial balance and the journal composer",
    (() => { const a = read("components/portal/accounting-panel.tsx"); const i = a.indexOf("<BooksPanel />"); return i > a.indexOf('L("Trial balance"') && i < a.indexOf('L("New journal entry"'); })());
  ok("the screen says a close locks nothing", /Nothing is locked/.test(books));
  ok("the audit pane appears only when the server answers it", /setAuditAllowed\(r\.ok\)/.test(books) && /\{auditAllowed && \(/.test(books));
  ok("Inventory shows the stock take in its own zone", /<StockTake categories=\{/.test(read("components/portal/role-panels.tsx")));
}

/* ---- 4. phase 4: customers ---- */
{
  const p4 = biz.slice(biz.indexOf("PHASE 4 (v1.181.16) - CUSTOMERS"), biz.indexOf("PHASE 5 (v1.181.17) - PEOPLE"));
  const pub = biz.slice(biz.indexOf("export async function handlePublicAcceptance"));
  ok("self-test: the phase 4 section and the public handler were found", p4.length > 1000 && pub.length > 300);
  const OWN = ["customer_contacts", "customer_tags", "customer_followups", "customer_terms", "recurring_invoices", "quotation_acceptances"];
  const p4writes = [...p4.matchAll(/\b(INSERT\s+(?:OR\s+\w+\s+)?INTO|(?<!DO\s)UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi)].map((m) => m[2].toLowerCase());
  ok("phase 4 writes only to its own six tables - never customers, never a document", p4writes.length >= 8 && p4writes.every((t) => OWN.includes(t)), p4writes.filter((t) => !OWN.includes(t)).join(", "));
  ok("reads are for whoever may open Sales, writes need the sales permission POST /customers uses",
    /const CRM_WRITE = can\(user\.role, "sales"\);/.test(p4) && (p4.match(/if \(!CRM_WRITE\) return err\("forbidden"/g) ?? []).length >= 9
    && /if \(method === "GET" \? !can\(user\.role, "sales"\) && !can\(user\.role, "exec_view"\) : !can\(user\.role, "sales"\)\)/.test(staff));
  ok("a contact is removed by a stamp, never deleted", /UPDATE customer_contacts SET removed_at = datetime\('now'\)/.test(p4) && !/DELETE FROM customer_contacts/.test(biz));
  ok("a follow-up is closed by a stamp, never deleted, and its owner is on the sales team",
    !/DELETE FROM customer_followups/.test(biz) && /!can\(who\.role, "sales"\)\) return err\("invalid_input"/.test(p4));
  /* recurring invoices are never raised by a machine */
  const watchers = read("worker/src/watchers.ts");
  ok("a monthly invoice is never raised by itself: no scheduled job reads recurring_invoices, and business.ts creates no document",
    !/recurring_invoices/.test(watchers) && !/recurring_invoices/.test(idx.replace(/\["0143[^\n]*/, "")) && !/INSERT INTO sales_documents/.test(biz));
  ok("...its month is known raised by the reference the normal form saved", /x\.reference LIKE \?1 \|\| r\.id \|\| ' %'/.test(p4) && /reference: `\$\{recurringRef\(r\.id\)\} · \$\{thisYm\(\)\}`/.test(p4));
  const sales = read("components/portal/sales.tsx");
  ok("credit terms reach only a NEW unpaid invoice, through the normal form, and only for a client with terms",
    /due_date: !editingDoc && termsDue \? termsDue\.on : undefined,/.test(sales)
    && /if \(doc\.doc_type !== "INV" \|\| doc\.paid_received \|\| editingDoc\) return null;/.test(sales)
    && /const t = crm\.terms\.find\(\(x\) => x\.customer_id === doc\.customer_id\);\s*if \(!t\) return null;/.test(sales));
  ok("...and the edit route never takes a due date from this", !/due_date/.test(sales.slice(sales.indexOf("if (editingDoc) {"), sales.indexOf("type StockMove ="))));
  /* acceptance on the shared link */
  const pubWrites = [...pub.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi)].map((m) => m[2].toLowerCase());
  ok("accepting on the link records an acceptance and writes nothing else", pubWrites.length === 1 && pubWrites[0] === "quotation_acceptances", pubWrites.join(", "));
  ok("...only a quotation, once per revision, with a name and a ticked box",
    /if \(d\.doc_type !== "QT"\) return err/.test(pub) && /WHERE doc_id = \?1 AND revision = \?2/.test(pub) && /if \(body\?\.agree !== true\)/.test(pub) && /name\.length < 2/.test(pub));
  ok("...the public route is budgeted per address", /checkRateLimit\(env, `accept:\$\{clientIp\(request\)\}`, 10, 3600\)/.test(idx));
  ok("the shared page says it is not a payment", /This records your acceptance only - it is not a payment\./.test(read("components/public/doc-accept.tsx")));
  /* the desk */
  const desk = read("worker/src/desk.ts");
  ok("follow-ups and monthly invoices reach the Desk only for the sales team, and a follow-up only for its owner or nobody's",
    /if \(can\(user\.role, "sales"\)\) \{\s*await guard\("followups"/.test(desk) && /\(f\.owner_id = \?2 OR f\.owner_id IS NULL\)/.test(desk));
  ok("the Desk only reads them", !/(INSERT|UPDATE|DELETE)\s/.test(desk.slice(desk.indexOf('await guard("followups"'), desk.indexOf("news I have not acknowledged"))));
  /* the funnel */
  ok("the prospects pipeline stays retired: nothing here reads or writes prospects", !/prospects/.test(p4.slice(p4.indexOf("*/") + 2).replace(/\/\*[\s\S]*?\*\//g, "")) && !/\/pipeline/.test(staff.replace(/\/\*[\s\S]*?\*\//g, "")));
  /* v1.183.0 - Enquiries is retired, and with it the enquiry -> quotation
     handoff; the Sales prefill below is still the shape a quotation starts in */
  ok("...and a prefill with no source behaves as before (a quotation, customer matched by name)",
    /const existing = customers\.find\([\s\S]{0,200}?\);\s*setDoc\(\(d\) => \(\{\s*\.\.\.d,\s*doc_type: "QT",/.test(sales));
  const m143 = has("worker/migrations/0143_customer_joins.sql") ? read("worker/migrations/0143_customer_joins.sql").replace(/^--.*$/gm, "") : "";
  ok("0143 only adds six tables", OWN.every((t) => new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`).test(m143)) && !/ALTER TABLE|DROP |UPDATE |DELETE |INSERT /.test(m143));
  ok("0143 is registered and probed", /"0143_customer_joins",/.test(idx) && /\["0143 \(client file, follow-ups, recurring invoices, acceptance\)"/.test(idx));
}

/* ---- 5. phase 5: people, and the quotation approval limit ---- */
{
  const p5 = biz.slice(biz.indexOf("PHASE 5 (v1.181.17) - PEOPLE"), biz.indexOf("export async function handlePublicAcceptance"));
  ok("self-test: the phase 5 section was found", p5.length > 2000);
  const OWN5 = ["leaving_checklists", "probation_reviews", "hr_letters", "training_records", "business_settings", "quotation_approvals"];
  const w5 = [...p5.matchAll(/\b(INSERT\s+(?:OR\s+\w+\s+)?INTO|(?<!DO\s)UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi)].map((m) => m[2].toLowerCase());
  ok("phase 5 writes only its own six tables - never users, leave, payroll or a document", w5.length >= 8 && w5.every((t) => OWN5.includes(t)), w5.filter((t) => !OWN5.includes(t)).join(", "));
  ok("deciding a probation records it and never touches the employment status", !/SET[^`]*employment_status/.test(p5) && /UPDATE probation_reviews SET outcome = \?2/.test(p5));
  ok("people routes are for the Staff Details permission", /const HR = can\(user\.role, "hr_manage"\);/.test(p5) && (p5.match(/if \(!HR\) return err\("forbidden"/g) ?? []).length >= 7);
  ok("the leave calendar is for the roles that decide leave, and only reads",
    /if \(!can\(user\.role, "team_manage"\)\) return err\("forbidden"/.test(p5)
    && !/(INSERT|UPDATE|DELETE)\s/.test(p5.slice(p5.indexOf('path === "/people/leave-calendar"'), p5.indexOf("the quotation approval limit - OFF"))));
  /* the joining checklist is the one Staff Details already writes */
  const dir = read("components/staff/staff-directory.tsx");
  const dirKeys = [...(dir.slice(dir.indexOf("const ONBOARDING_ITEMS"), dir.indexOf("const ONBOARDING_MS")).matchAll(/\["([a-z_]+)", "/g))].map((m) => m[1]);
  const bizKeys = JSON.parse((biz.match(/export const JOINING_KEYS = (\[[^\]]*\]);/) ?? [, "[]"])[1].replace(/'/g, '"'));
  ok("the joining keys read are exactly the ones Staff Details ticks", dirKeys.length === 6 && JSON.stringify(dirKeys) === JSON.stringify(bizKeys), `${dirKeys} vs ${bizKeys}`);
  ok("...and phase 5 never writes the joining checklist", !/onboarding_json\s*=/.test(biz));
  ok("a letter is voided with a reason, never deleted", /reason\.length < 3\) return err\("invalid_input", "Say why the letter is voided\."/.test(p5) && !/DELETE FROM hr_letters/.test(biz));
  const letters = read("lib/hr-letters.ts");
  ok("a letter carries no signature image - it is signed by hand", !/<img|signature/i.test(letters.slice(letters.indexOf("export function letterHtml"))));
  ok("a letter with [blanks] left in cannot be issued from the screen", /disabled=\{busy \|\| \/\\\[\[\^\\\]\]\+\\\]\/\.test\(lt\.body\)/.test(read("components/portal/people-panel.tsx")));
  /* the approval limit: off until the owner sets it */
  ok("the approval limit is off until set: no row, no limit, nothing waits",
    /if \(!setting \|\| !\(setting\.limit_cents > 0\)\) return json\(\{ limit_cents: null, pending: \[\]/.test(p5)
    && /if \(!setting\.limit_cents \|\| !setting\.since\) return; \/\/ off: nothing waits/.test(read("worker/src/desk.ts"))
    && !/INSERT/.test(has("worker/migrations/0144_people.sql") ? read("worker/migrations/0144_people.sql").replace(/^--.*$/gm, "") : "INSERT"));
  ok("...only the CEO or super admin sets it or approves, and an approval is per revision",
    /const OWNER_ROLES = \["super_admin", "ceo"\];/.test(p5) && /if \(!OWNER_ROLES\.includes\(user\.role\)\) return err\("forbidden", "Only the CEO sets/.test(p5)
    && /if \(!OWNER_ROLES\.includes\(user\.role\)\) return err\("forbidden", "Only the CEO approves/.test(p5) && /a\.revision = COALESCE\(d\.revision, 0\)/.test(p5));
  /* revised_at is stored in Malaysia time (staff.ts writes datetime('now', '+8 hours')), created_at in UTC */
  ok("...it only reaches quotations raised or revised after it was turned on", /COALESCE\(datetime\(d\.revised_at, '-8 hours'\), d\.created_at\) >= \?2/.test(p5) && /revised_at = datetime\('now', '\+8 hours'\)/.test(staff));
  const sales = read("components/portal/sales.tsx");
  ok("...and with it off, Send PDF is exactly as before", /const awaiting = \(d: \{ id: number; doc_type: string \}\) => d\.doc_type === "QT" && qa\.limit_cents != null && qa\.pending\.some/.test(sales)
    && /\{awaiting\(d\) \? \(/.test(sales) && /onClick=\{\(\) => void shareDoc\(d\)\}/.test(sales));
  const m144 = has("worker/migrations/0144_people.sql") ? read("worker/migrations/0144_people.sql").replace(/^--.*$/gm, "") : "";
  ok("0144 only adds six tables", OWN5.every((t) => new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`).test(m144)) && !/ALTER TABLE|DROP |UPDATE |DELETE |INSERT /.test(m144));
  ok("0144 is registered and probed", /"0144_people",/.test(idx) && /\["0144 \(joining and leaving, probation, letters, training, approval limit\)"/.test(idx));
  ok("HR shows People in its own zone; Leave shows the calendar to managers", /<PeoplePanel \/>/.test(read("components/portal/role-panels.tsx")) && /<LeaveCalendar \/>/.test(read("components/portal/leave.tsx")));
}

/* ---- docs: what every AI tool reads keeps up with the code ---- */
{
  const latest = (idx.match(/const LATEST_MIGRATION = "([0-9a-z_]+)";/) ?? [])[1] ?? "";
  const num = latest.slice(0, 4);
  const agents = has("AGENTS.md") ? read("AGENTS.md") : "";
  ok("self-test: the latest migration was read", /^\d{4}$/.test(num), latest);
  ok("AGENTS.md exists and names the business.ts door and the latest ERP migration", /worker\/src\/business\.ts/.test(agents) && agents.includes(`(${num})`), num);
  ok("CLAUDE.md points to AGENTS.md and the ERP roadmap", /AGENTS\.md/.test(read("CLAUDE.md")) && /docs\/ERP-ROADMAP\.md/.test(read("CLAUDE.md")));
  ok("the ERP roadmap names the latest migration", read("docs/ERP-ROADMAP.md").includes(latest));
  /* .github/ is a folder the owner's desktop tools may not write, so the
     Copilot pointer is checked when it is there; GEMINI.md always is */
  ok("the tool pointers point to AGENTS.md", has("GEMINI.md") && /AGENTS\.md/.test(read("GEMINI.md"))
    && (!has(".github/copilot-instructions.md") || /AGENTS\.md/.test(read(".github/copilot-instructions.md"))));
}

if (failed) {
  console.log(`\nbusiness-joins: ${failed} failed, ${passed} passed.`);
  process.exitCode = 1;
} else {
  console.log(`business-joins: ${passed} checks passed - every phase adds, none changes what staff already rely on.`);
}

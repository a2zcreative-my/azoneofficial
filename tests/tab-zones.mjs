#!/usr/bin/env node
/* Guard #49 — v1.117.0: the Ecommerce tab reads in four zones; v1.119.0: the
 * Inventory tab reads in three, with a phone rendering of the stock rows.
 *
 * The CEO, 06-09-2026: *"Now review on Ecommerce"*, after the Dashboard was
 * reorganised the same way. Eight cards that had been stacked in the order
 * they were written are grouped: THIS MONTH (map with the leaderboard beside
 * it, then Sales revenue and Sales by hour side by side), THE WORK (the order
 * tracker with Fulfilment beside it), THE LONGER VIEW (targets / history /
 * lines, analytics), SETUP (the connection, last - v1.4.217's rule kept).
 *
 *   1. THE ORDER, in the page source.
 *   2. THE PHONE DIFFERS BY ONE CARD: the month's total before the map on a
 *      small screen, done with CSS order on the same tree - not a second
 *      copy of the cards.
 *   3. ONE CAPTION COMPONENT for both tabs (page-shared), so every tab
 *      teaches the same reading habit.
 *   4. NOTHING GATED DIFFERENTLY: the CEO-only analytics stays CEO-only, the
 *      tracker stays visible to every role on the tab, the connection stays
 *      last.
 *
 * Negative-tested by: moving the connection card above the tracker (1);
 * dropping the order classes (2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname.
   On Windows `new URL("..", import.meta.url).pathname` is "/C:/Users/..." -
   a URL path with a leading slash, not a file path - so join() produced
   "\\C:\\Users\\..." and every read failed with "C:\\C:\\Users\\...". These
   guards had only ever run in Cloudflare's Linux build container, where the
   two happen to be the same string; the day PUSH.bat started running them on
   the CEO's own PC, 49 of them failed at once on a bug that was never about
   the code they check. */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const page = read("app/portal/page.tsx");
const shared = read("components/portal/page-shared.tsx");
const styles = read("lib/ui-styles.ts");
const commission = read("components/portal/commission.tsx");
const trading = read("components/portal/trading-desk.tsx");
const dash = read("components/portal/dashboard.tsx");
const panels = read("components/portal/role-panels.tsx");
const sales = read("components/portal/sales.tsx");
const elfia = read("components/portal/elfia-store-panel.tsx");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const a = page.indexOf('{activeTab === "Ecommerce" && (');
const b = page.indexOf('{activeTab === "Assets" &&', a);
const tab = page.slice(a, b);
ok("the Ecommerce block was found", a > 0 && b > a);

/* 1. the order */
const seq = ["<RevenueAndHoursCard", "<TikTokOrdersCard", "<FulfilmentCard", "<OpsMapCard", "<MoneyCard", "<TikTokAnalyticsCard", "<ConnectionStatusCard"];
const pos = seq.map((s) => tab.indexOf(s));
ok("every card is still on the tab", pos.every((x) => x > 0), seq.filter((s, i) => pos[i] < 0).join(","));
ok("month summary, tracker, fulfilment, map, long view, analytics, connection - in that order", pos.every((x, i) => i === 0 || x > pos[i - 1]), pos.join(" < "));
ok("the connection is last, as v1.4.217 ordered", pos[6] === Math.max(...pos));
ok("the leaderboard rides in the map's side column", /<OpsMapCard aside=\{<LeaderboardCard user=\{user\} compact \/>\} \/>/.test(tab));
const caps = ["This month", "The work", "The longer view", "Setup"];
ok("the four zones are captioned", caps.every((c) => tab.includes(`<ZoneLabel>{L("${c}"`)), caps.filter((c) => !tab.includes(`<ZoneLabel>{L("${c}"`)).join(","));
ok("revenue stays one shared tabbed card", tab.split("<RevenueAndHoursCard").length === 2);
ok("the tracker is wide and fulfilment beside it", /md:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/.test(tab));

/* 2. visual and keyboard reading order agree on every viewport */
ok("Ecommerce uses DOM order, not viewport-dependent CSS reordering", !/\border-[12]\b/.test(tab));
ok("...and the cards appear once each", seq.every((s) => tab.split(s).length === 2));

/* 3. one caption component */
ok("ZoneLabel lives in page-shared and both tabs use it", /export function ZoneLabel\(/.test(shared) && /ZoneLabel/.test(dash) && !/^function ZoneLabel\(/m.test(dash) && tab.includes("<ZoneLabel>"));

/* 4. gates */
ok("analytics stays CEO-only", /\["ceo", "super_admin"\]\.includes\(user\.role\) && <TikTokAnalyticsCard \/>/.test(tab));
ok("the tracker is not behind the revenue gate", !/REVENUE_ROLES\.includes\(user\.role\) && \(?\s*<TikTokOrdersCard/.test(tab) && /<TikTokOrdersCard/.test(tab));
ok("fulfilment, the map, revenue and the long view stay behind it", /REVENUE_ROLES\.includes\(user\.role\) && <FulfilmentCard \/>/.test(tab) && /REVENUE_ROLES\.includes\(user\.role\) && \(\s*<section[\s\S]{0,120}?This month/.test(tab) && /REVENUE_ROLES\.includes\(user\.role\) && \(\s*<section[\s\S]{0,160}?The longer view/.test(tab));

/* ---- v1.119.0: Inventory - three zones, and one data source for two renderings ---- */
{
  const s = panels.indexOf("export function InventoryPanel(");
  const inv = panels.slice(s, panels.indexOf("\n}\n", s));
  ok("the Inventory panel was found", s > 0);
  const caps = ["Stock now", "Record", "What moved"];
  const cpos = caps.map((c) => inv.indexOf(`<ZoneLabel>{L("${c}"`));
  ok("Inventory has its three zones, in order", cpos.every((x) => x > 0) && cpos[0] < cpos[1] && cpos[1] < cpos[2], cpos.join(" < "));
  /* v1.125.0 — `fill` is gone (the component had two card contracts and only
   one was ever used), so this asks what it always meant: the strip is the
   page's to pass in, and only for the roles that manage stock. */
  ok("stock status stays permission-filtered", /\{statusCard\}/.test(inv) && /statusCard=\{MANAGE_ROLES\.includes\(user\.role\) \? <InventoryStatusCard \/> : undefined\}/.test(page));
  ok("bridge diagnostics follow daily work and movement history", inv.indexOf('id="inventory-bridge"') > inv.indexOf('L("Manual stock movements"') && inv.includes('href="#inventory-bridge"'));
  ok("bridge problems remain visible beside the stock summary", inv.indexOf('role="status"') < inv.indexOf('L("Inventory — live status & stock"') && inv.includes("bridgeHealth.unknown.length > 0"));
  const order = ["Inventory — live status & stock", "Supplier returns", "Postage tracking", "TikTok Live — stock out", "Manual stock movements"].map((t) => inv.indexOf(t));
  ok("table, then the two forms, then the two histories", order.every((x) => x > 0) && order.every((x, i) => i === 0 || x > order[i - 1]), order.join(" < "));
  ok("the table and the phone list draw from ONE filtered list", inv.split("{visibleItems.map((it) => (").length === 3 && !/\{sortedItems\.map\(\(it\) => \(/.test(inv),
     "two lists from two sources can disagree about what is in stock");
  ok("the phone list is phone-only and the table desk-only", /<ul className="[^"]*md:hidden">\s*\{visibleItems\.map/.test(inv) && /<div className="mt-3 hidden max-h-96 overflow-x-auto overflow-y-auto pr-1 md:block">/.test(inv));
  const inCalls = inv.split('setOutModal({ dir: "in", edit_id: null, item_id: it.id').length - 1;
  const outCalls = inv.split('setOutModal({ dir: "out", edit_id: null, item_id: it.id').length - 1;
  ok("In / Out on the phone are the table's own handlers", inCalls === 2 && outCalls === 2, `${inCalls} in, ${outCalls} out`);
  ok("the find box and the Low / Out chips filter the same list", /invQ/.test(inv) && /invFilter === "all" \|\|/.test(inv) && /\["low", L\("Low"/.test(inv) && /\["out", L\("Out"/.test(inv));
  ok("the add-item form is behind a button", /\{addOpen && \(/.test(inv) && /L\("\+ Add item", "\+ Tambah barang"\)/.test(inv));
  ok("a filter that leaves nothing says so", /Nothing is low\./.test(inv) && /Nothing is out of stock\./.test(inv));
}

/* ---- v1.120.0: Sales - the form is the paper, and the paper is previewed ---- */
{
  const s0 = sales.indexOf("export function Sales(");
  const comp = sales.slice(s0, sales.indexOf("\n}\n", s0));
  /* v1.123.0 - the tab bodies. The document form's own labels ("Billing
     address") also occur in the customer list, which now comes first, so
     every paper-form check reads the CREATE tab's slice, not the component. */
  const form = comp.slice(comp.indexOf('workTab === "create" ? "mt-3" : "hidden"'), comp.indexOf('workTab === "documents" ? "mt-3" : "hidden"'));
  ok("the Sales component was found", s0 > 0);
  /* the meta strip: the five cells, in the order the template prints them */
  const meta = ['L("Sales person", "Jurujual")', 'L("Doc no.", "No. dok.")', 'L("Date", "Tarikh")', 'L("Valid until", "Sah hingga")', 'L("Reference", "Rujukan")'].map((m) => form.indexOf(m));
  ok("the meta strip is the paper's: sales person, doc no., date, valid-until / due / delivery, reference", meta.every((x) => x > 0) && meta.every((x, i) => i === 0 || x > meta[i - 1]), meta.join(" < "));
  ok("the system's own fields are shown greyed, not as inputs", /L\("auto on save", "auto semasa simpan"\)/.test(form) && /L\("On receipt", "Semasa terima"\)/.test(comp));
  /* the parties: billing, with the customer inside it, before delivery */
  const bill = form.indexOf('L("Billing address", "Alamat bil")'), ship = form.indexOf('L("Delivery address", "Alamat penghantaran")'), custSel = form.indexOf("value={doc.customer_id}");
  ok("BILLING ADDRESS holds the customer and comes before DELIVERY ADDRESS", bill > 0 && custSel > bill && ship > custSel);
  ok("a customer without an address is warned about where it prints", /No address on the customer card/.test(comp));
  ok("a service document shows a service address, not a delivery one", /L\("Service address", "Alamat perkhidmatan"\)/.test(comp));
  /* the ladder, in print order */
  const ladder = ['L("Subtotal", "Subjumlah")', 'L("Less: discount (whole document)"', 'L("Tax %", "Cukai %")', 'L("Delivery / postage", "Penghantaran / pos")', 'L("TOTAL (RM)", "JUMLAH (RM)")'].map((m) => form.indexOf(m));
  ok("the totals ladder reads subtotal, discount, tax, delivery, total", ladder.every((x) => x > 0) && ladder.every((x, i) => i === 0 || x > ladder[i - 1]), ladder.join(" < "));
  ok("the lines stay under the paper's column headers", /L\("Description", "Keterangan"\)/.test(comp) && /L\("Unit price \(RM\)", "Harga seunit \(RM\)"\)/.test(comp) && /L\("Discount \(RM\)", "Diskaun \(RM\)"\)/.test(comp));
  ok("a Delivery Order says its prices are not printed", /prices are kept but not printed on a Delivery Order/.test(comp));
  /* every control the form had is still there */
  const controls = ["value={doc.doc_type}", "value={doc.customer_id}", "value={doc.issuer}", "value={docDate}", "value={paidDate}", "value={doc.salesperson_id}", "value={doc.reference}", "value={doc.delivery_address}", "checked={doc.paid_received}", "tax_percent: Number(e.target.value || 0)", "delivery_cents: Math.max(", "discount_cents: Math.max(", "onClick={() => void createDoc()}", "{doc.items.map((item, i) => {", "docPageFit(doc.items, doc.doc_type)"];
  ok("every control of the old form is on the paper", controls.every((c) => comp.includes(c)), controls.filter((c) => !comp.includes(c)).join(" | "));
  /* the preview is the real template, never auto-printing, same arithmetic */
  ok("the preview is drawn by the template that prints, and never prints by itself", /buildDocHtml\(full, false\)/.test(sales) && /sandbox="allow-same-origin"/.test(sales));
  const formula = "Math.round((subtotal - doc.discount_cents) * (1 + doc.tax_percent / 100))";
  ok("the preview totals the way the form totals", sales.split(formula).length >= 3, "two arithmetics would show two totals");
  ok("the preview is beside the form on a wide screen and behind a button below it", /<DocPreview/.test(comp) && /hidden xl:block/.test(sales) && /L\("Preview", "Pratonton"\)/.test(sales));
  ok("the preview scales to its box - nothing scrolls sideways", /el\.clientWidth \/ 794/.test(sales) && /transform: `scale\(\$\{scale\}\)`/.test(sales));
  /* the customer form is the billing block */
  const cb = comp.indexOf('L("Billing address — prints on every document for this customer"');
  const fields = ['L("Company *", "Syarikat *")', 'L("Contact person", "Orang hubungan")', 'L("Address", "Alamat")', 'L("Phone", "Telefon")', 'L("Email", "E-mel")', 'L("Not printed — for the portal only"', 'L("Their website", "Laman web mereka")'].map((m) => comp.indexOf(m, cb));
  ok("the customer form prints top to bottom: company, contact, address, phone, email; website and logo under 'not printed'", cb > 0 && fields.every((x) => x > 0) && fields.every((x, i) => i === 0 || x > fields[i - 1]), fields.join(" < "));
  /* the tab's zones */
  const st = page.slice(page.indexOf('{activeTab === "Sales" && ('), page.indexOf('{activeTab === "Content" &&'));
  const z = [st.indexOf("<Sales user={user}"), st.indexOf('L("This month"'), st.indexOf("<SalesMap />"), st.indexOf('L("The longer view"')];
  ok("the Sales workspace precedes the map and longer view", z.every((x) => x > 0) && z.every((x, i) => i === 0 || x > z[i - 1]) && /workExtra=\{<DocumentsPanel bare \/>\}/.test(st) && /customersExtra=\{<ClientsCard bare \/>\}/.test(st));
  const inner = [comp.indexOf('L("The work", "Kerja")'), comp.indexOf("{editingDoc ? ("), comp.indexOf("{workExtra}"), comp.indexOf('L("Customers", "Pelanggan")'), comp.indexOf("{editingCust ? ("), comp.indexOf("{customersExtra}")];
  ok("THE WORK precedes CUSTOMERS without duplicating their forms", inner.every((x) => x > 0) && inner.every((x, i) => i === 0 || x > inner[i - 1]), inner.join(" < "));
  ok("Sales opens records by default and keeps explicit creation intent", comp.includes('initialView = "documents"') && comp.includes('(initialView)') && page.includes('setSalesStart("create")') && dash.includes('onCreateQuotation()'));
  ok("editing a document opens its mounted form and scrolls the workspace", /setEditingDoc\(\{ id: d.id, doc_number: d.doc_number \}\);\s*setWorkTab\("create"\)/.test(comp) && comp.includes('getElementById("sales-work")?.scrollIntoView'));
  ok("Customers has two tabs and The work three", /value=\{custTab\} onChange=\{setCustTab\}/.test(comp) && ["add", "clients"].every((k) => comp.includes(`["${k}", L(`))
     && /value=\{workTab\} onChange=\{setWorkTab\}/.test(comp) && ["create", "documents", "receipts"].every((k) => comp.includes(`["${k}", L(`)));
  ok("every Sales tab body is hidden, never unmounted", ["add", "clients"].every((k) => comp.includes(`custTab === "${k}" ? "mt-3" : "hidden"`)) && ["create", "documents", "receipts"].every((k) => comp.includes(`workTab === "${k}" ? "mt-3" : "hidden"`)),
     "a half-written quotation must survive a look at the documents list");
}

/* ---- v1.121.0: the five history / record cards on Inventory are quiet ---- */
{
  const s = panels.indexOf("export function InventoryPanel(");
  const inv = panels.slice(s, panels.indexOf("\n}\n", s));
  /* v1.123.0 - the CEO replaced the five quiet cards with two tabbed cards:
     Record (returns / postage / materials) and What moved (TikTok / manual). */
  const recTabs = ["returns", "postage", "materials"], mvTabs = ["tiktok", "manual"];
  ok("Record is one card with three tabs", /value=\{recordTab\} onChange=\{setRecordTab\}/.test(inv) && recTabs.every((k) => new RegExp(`\\["${k}", L\\(`).test(inv)));
  ok("What moved is one card with two tabs", /value=\{movedTab\} onChange=\{setMovedTab\}/.test(inv) && mvTabs.every((k) => new RegExp(`\\["${k}", L\\(`).test(inv)));
  ok("each tab body is hidden, never unmounted - a half-typed return survives a look at postage",
     recTabs.every((k) => inv.includes(`recordTab === "${k}" ? "mt-3" : "hidden"`)) && mvTabs.every((k) => inv.includes(`movedTab === "${k}" ? "mt-3" : "hidden"`)),
     "unmounting would refetch and lose what was typed");
  ok("the five cards kept their bodies", ["Record rejected/defective items sent back to the supplier", "TikTok orders arrive automatically", "Track what sales needs", "Units deducted by TikTok orders", "Every manual In + and Out"].every((t) => inv.includes(t)));
  ok("the stock table is not behind a tab - it is the daily work", !/<QuietCard title=\{L\("Inventory — live status/.test(inv) && /L\("Inventory — live status & stock"/.test(inv));
}

/* ---- v1.122.0: ELFIA Store - the shop, the products, the shopfront, settings ---- */
{
  const s = elfia.indexOf("export function ElfiaStorePanel(");
  const el = elfia.slice(s, elfia.indexOf("\n}\n", s));
  const caps = ["The shop", "Products", "The shopfront", "Settings"].map((c) => el.indexOf(`<ZoneLabel>{L("${c}"`));
  ok("ELFIA Store has its four zones, in order", caps.every((x) => x > 0) && caps.every((x, i) => i === 0 || x > caps[i - 1]), caps.join(" < "));
  const order = ['L("ELFIA web store", "Kedai web ELFIA")', 'L("Products on the ELFIA store"', 'title={L("Homepage carousel"', 'title={L("Catalog PDF"', 'title={L("Catalog hover background"', 'title={L("Delivery charges"', 'title={L("Online payment (Bayarcash FPX)"'].map((m) => el.indexOf(m));
  ok("pulse, products, carousel, catalog PDF, hover backdrop, delivery, payment - in that order", order.every((x) => x > 0) && order.every((x, i) => i === 0 || x > order[i - 1]), order.join(" < "));
  ok("the products come before every set-once card", order[1] < Math.min(...order.slice(2)), "the daily work was last");
  ok("the five set-once cards are quiet, each with its figure", el.split("<QuietCard ").length === 6 && el.split("summary={").length === 6);
  ok("the products card is not quiet", !/<QuietCard title=\{L\("Products on the ELFIA store/.test(el));
  ok("the find box cuts the same list the Show chips cut", /const needle = q\.trim\(\)\.toLowerCase\(\);/.test(el) && /\.filter\(\(x\) => !needle \|\| x\.sku\.toLowerCase\(\)\.includes\(needle\)/.test(el) && /L\("Find by SKU, name or collection"/.test(el));
  ok("finding clears the selection so a bulk action cannot hit a hidden row", /onChange=\{\(e\) => \{ setQ\(e\.target\.value\); setPicked\(new Set\(\)\); \}\}/.test(el));
}

/* ---- v1.123.0: one tab component, one style, everywhere ---- */
{
  ok("the tab pill is a global style, not a per-card string", /export const tabPill =/.test(styles) && /export const tabPillOn =/.test(styles));
  ok("SectionTabs is the one component that draws it", /export function SectionTabs</.test(shared) && /className=\{value === k \? tabPillOn : tabPill\}/.test(shared));
  ok("...and it is a real tablist", /role="tablist"/.test(shared) && /role="tab" aria-selected=\{value === k\}/.test(shared));
  /* the two rows that had their own copy of this markup - the attendance card
     (v1.80.0) and MoneyCard - now use the component, so there is one style */
  const handRolled = [["role-panels.tsx", panels], ["commission.tsx", commission], ["sales.tsx", sales], ["elfia-store-panel.tsx", elfia], ["trading-desk.tsx", trading]]
    .filter(([, src]) => /rounded-full px-3 py-1 text-xs font-medium"/.test(src) || /!bg-primary !text-primary-foreground/.test(src));
  ok("no card hand-rolls the tab pill any more", handRolled.length === 0, handRolled.map(([f]) => f).join(", "));
  for (const [file, src] of [["role-panels.tsx", panels], ["commission.tsx", commission], ["sales.tsx", sales], ["trading-desk.tsx", trading]]) {
    if (src.includes("<SectionTabs")) ok(`${file} imports SectionTabs from page-shared`, /import \{[^}]*SectionTabs[^}]*\} from "@\/components\/portal\/page-shared"/.test(src));
  }
}

/* Approved work-first pilot: source order is shared by phone and desktop. */
{
  const ordered = (source, labels) => {
    const positions = labels.map(label => source.indexOf(label));
    return positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]));
  };
  ok("Dashboard actions and queue precede metrics and company reporting",
    ordered(dash, ['<PanelTitle icon="time"', '<OneDesk', '<WatchersCard', '<NextEventCard', 'L("My summary"', '<TradingDesk']));
  const attendance = page.slice(page.indexOf('{activeTab === "Attendance"'), page.indexOf('{activeTab === "Reconciliation"'));
  ok("Attendance records and decisions precede scheduling and setup",
    ordered(attendance, ['<Attendance user=', '<VerificationCard', '<OtApprovalsCard', '<RosterBoard', '<AttendanceAdminPanel']));
  const users = page.slice(page.indexOf('{activeTab === "Users"'), page.indexOf('{activeTab === "Profile"'));
  ok("Users starts with accounts, then review, permissions and locations",
    ordered(users, ['<UsersPanel', '<AccessReviewCard', '<TabAccessCard', '<GeofenceCard']));
}

/* The approved rollout retains already-correct tabs and reorders exceptions. */
{
  const ordered = (source, labels) => {
    const positions = labels.map(label => source.indexOf(label));
    return positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]));
  };
  const purchase = read("components/portal/purchasing-panels.tsx");
  const funds = read("components/portal/commission-panels.tsx");
  const finance = read("components/portal/finance-panels.tsx");
  const assets = read("components/portal/assets-panel.tsx");
  const hotels = read("components/portal/hotels-panel.tsx");
  const payroll = read("components/portal/payroll-panel.tsx");
  const leave = read("components/portal/leave.tsx");
  const tasks = read("components/portal/tasks.tsx");
  const announcements = read("components/portal/announcements.tsx");
  const sp = read("components/portal/sales-performance-panel.tsx");
  ok("Purchasing: register, creation, suppliers", ordered(purchase, ['rows={openOnly ? open : pos}', 'L("New purchase order"', 'id="purchasing-suppliers"']));
  ok("Accounting: balance before adjustment", ordered(purchase, ['L("Trial balance"', 'L("New journal entry"']));
  ok("Commission: decisions, calculation, rates", ordered(funds, ['rows={entries}', 'value={draft.basis}', 'id="commission-rates"']));
  ok("Ads Fund: spending before allocation and entry forms", ordered(funds, ['rows={claims}', 'value={allocDraft.period}', 'value={claimDraft.allocation_id}']));
  const reconciliation = finance.slice(finance.indexOf("export function ReconciliationPanel"));
  ok("Reconciliation: pull period, summary, register, manual entry", ordered(reconciliation, ['value={draft.period}', '<StatStrip>', 'rows={rows}', 'value={draft.order_no}']));
  ok("Assets: status, register, editor", ordered(assets, ['L("Company assets"', 'L("Register"', 'id="asset-form"']));
  ok("Asset edit scrolls to its relocated form", assets.includes('getElementById("asset-form")?.scrollIntoView'));
  ok("Hotels: filters and contact work before the map", ordered(hotels.slice(hotels.indexOf('export function HotelsPanel')), ['L("Search the directory"', 'L("Filter by state"', '<HotelPipeline', 'THE MAP']));
  ok("HR: task reports, gated administration, birthdays", ordered(panels, ['L("Task report"', '{administration}', 'L("Staff birthdays"']) && page.includes('<HrPanel administration={["hr_admin", "ceo", "super_admin", "admin"].includes('));
  ok("Finance: cash then expenses with reporting after payments due", page.includes('<ExpensesPanel reporting={<PnlCard />} />') && ordered(panels.slice(panels.indexOf('export function ExpensesPanel')), ['L("Payments due', '{reporting}', 'payments COMPLETED']));
  const pay = payroll.slice(payroll.indexOf('export function PayrollPanel'));
  ok("Payroll: review before save, payment export, release and setup", ordered(pay, ['<table className="tbl-sticky', 'L("Save all"', 'L("M2E salary file"', 'L("Release now"', 'id="payroll-base"', 'L("M2E setup']));
  ok("Claims: submission link, pending decisions, form, records", ordered(panels.slice(panels.indexOf('export function ClaimsPanel')), ['href="#claim-form"', 'id="claims-pending"', 'id="claim-form"', 'L("All claims"']));
  ok("Leave: application, pending company decisions, personal history", ordered(leave.slice(leave.indexOf('export function Leave({')), ['L("Apply for leave"', 'pending.map((l)', 'mine.map((l)']));
  ok("Tasks: active records before creation, progress, completion archive", ordered(tasks, ['{renderTasks(tasks.filter((t) => t.status !== "completed")', 'L("Create / assign a task"', '{progress}', '{renderTasks(tasks.filter((t) => t.status === "completed")']));
  ok("Announcements: unacknowledged, publishing, acknowledged archive", ordered(announcements, ['{renderAnnouncements(anns.filter((a) => !a.acked)', 'L("Publish news"', '{renderAnnouncements(anns.filter((a) => a.acked)']));
  ok("Sales Performance: records and closing before scores", ordered(sp, ['id="sp-shipments"', 'id="sp-closing"', 'L("Per staff"', 'id="sp-funnel"', 'id="sp-trend"']));
  ok("Profile already keeps personal details ahead of pay and security", ordered(page.slice(page.indexOf('{activeTab === "Profile"')), ['<Profile />', '<MyPayslip />', '<TwoFactorPanel />', 'href="/privacy"']));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — every tab reads in zones, one card shows one thing at a time through one shared tab component, and the document form is still the paper (${passed} checks)`);
